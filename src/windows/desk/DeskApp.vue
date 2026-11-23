<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { FButton, FInfoBar, FTextBox } from '@/fluent';
import { call, currentWindow, isServer, isTauri, on, type DataDirInfo, type ResizeEdge } from '@/api';
import { checkSession, loginServer, logoutServer, serverModals, serverState } from '@/serverApi';
import { doc, history, patchSettings, put, redo, storeState, initStore, taskList, undo, type ReplayResult } from '@/stores/doc';
import { updateHolidays } from '@/stores/holidays';
import { startThemeSync, deskVars, isDark } from '@/composables/theme';
import { SIDEBAR_DEFAULT, SIDEBAR_MIN, useSidebarSpring } from '@/composables/useSidebarSpring';
import { now, startClock } from '@/composables/now';
import { computeReminders } from '@/lib/reminders';
import { sampleData } from '@/lib/seed';
import { autoPostpone, clearSampleData, sampleCount } from '@/lib/tasks';
import { startOfMonth } from '@/lib/date';
import { defaultWeeksStart, goToday, notify, openEditor, page, ui } from './state';
import TitleBar from './TitleBar.vue';
import LeftSidebar from './LeftSidebar.vue';
import CompactView from './CompactView.vue';
import DayView from './DayView.vue';
import MultiDayView from './MultiDayView.vue';
import MonthView from './MonthView.vue';
import SearchPanel from './SearchPanel.vue';
import CountdownBar from './CountdownBar.vue';
import '../window-shell.css';

const GanttView = defineAsyncComponent(() => import('./gantt/GanttView.vue'));
const EditorModal = defineAsyncComponent(() => import('../editor/EditorApp.vue'));
const SettingsModal = defineAsyncComponent(() => import('../settings/SettingsApp.vue'));

const loginUser = ref('fluentcal');
const loginPass = ref('');
async function submitLogin() {
  if (!loginPass.value || serverState.loggingIn) return;
  const ok = await loginServer(loginUser.value.trim() || 'fluentcal', loginPass.value);
  if (ok) {
    loginPass.value = '';
    await bootApp();
  }
}
async function doLogout() {
  serverModals.settings = null;
  await logoutServer();
  location.reload();
}

const view = computed(() => doc.settings.calendar.view);
const desk = computed(() => doc.settings.desk);
const hasFrame = computed(() => !!desk.value.frameColor && desk.value.frameColor !== 'auto' && !desk.value.acrylic);
const shellRef = ref<HTMLElement>();
const compact = ref(typeof window !== 'undefined' ? window.innerWidth <= 560 : false);
let shellRo: ResizeObserver | undefined;
const spring = useSidebarSpring({
  isOpen: () => doc.settings.desk.sidebarOpen,
  savedWidth: () => doc.settings.desk.sidebarWidth || SIDEBAR_DEFAULT,
  reduceMotion: () => doc.settings.theme.reduceMotion,
  onCommit: (open, w) =>
    patchSettings({
      desk: w && open ? { sidebarOpen: true, sidebarWidth: w } : { sidebarOpen: open },
    }),
});
const sidebarInnerStyle = computed(() => {
  const w = spring.width.value;
  const ratio = Math.max(0, Math.min(1, w / SIDEBAR_MIN));
  return {
    width: `${Math.max(SIDEBAR_MIN, w).toFixed(2)}px`,
    opacity: w < SIDEBAR_MIN ? ratio * ratio : 1,
    transform:
      w < SIDEBAR_MIN
        ? `translateX(${((w - SIDEBAR_MIN) * 0.25).toFixed(1)}px) scale(${(0.96 + 0.04 * ratio).toFixed(3)})`
        : 'none',
  };
});
let sidebarInitialized = false;
watch(
  () => [storeState.ready, doc.settings.desk.sidebarOpen, doc.settings.desk.sidebarWidth] as const,
  ([ready, open, w]) => {
    if (!ready) return;
    if (!sidebarInitialized) {
      sidebarInitialized = true;
      spring.snapTo(open, w);
      return;
    }
    spring.animateTo(open, w);
  },
  { immediate: true },
);
const notice = ref('');
// First run (REL-03): how to use the calendar, and a way out of the sample data.
const welcome = computed(() => storeState.ready && !storeState.readOnly && !doc.settings.general.onboarded && sampleCount() > 0);
async function clearSamples() {
  const n = await clearSampleData();
  patchSettings({ general: { onboarded: true } });
  notify(`已删除 ${n} 个示例任务`, true);
}
const saveError = ref<string | null>(null);

startThemeSync();

// Desk variables live on <html> so teleported flyouts and menus inherit them too.
watchEffect(() => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(deskVars.value)) root.style.setProperty(k, v);
});

// ---------------------------------------------------------------- reminders

let remTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReminders() {
  clearTimeout(remTimer);
  remTimer = setTimeout(() => {
    const r = doc.settings.reminders;
    const items = r.enabled ? computeReminders(taskList.value, Date.now(), r.allDayTime) : [];
    void call('reminders_set', { items });
  }, 400);
}

async function seedIfFirstRun() {
  if (doc.settings.general.seeded) return;
  if (!Object.keys(doc.tasks).length && !Object.keys(doc.groups).length) {
    const { groups, tasks } = sampleData(now.value);
    await put('groups', Object.fromEntries(groups.map((g) => [g.id, g])), { history: false });
    await put('tasks', Object.fromEntries(tasks.map((t) => [t.id, t])), { history: false });
  }
  patchSettings({ general: { seeded: true } });
}

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  const typing = el.matches?.('input, textarea, [contenteditable="true"]');
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'f') {
    ui.searchOpen = true;
  } else if (ctrl && e.key.toLowerCase() === 'n') {
    openEditor({ mode: 'new', start: ui.selected });
  } else if (typing) {
    return;
  } else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    void undo().then((r) => notify(replayText(r, '撤销')));
  } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    void redo().then((r) => notify(replayText(r, '重做')));
  } else if (e.key === 'Escape' && ui.searchOpen) {
    ui.searchOpen = false;
  } else if (e.key === 'Home' && view.value !== 'gantt') {
    goToday();
  } else if ((e.key === 'PageUp' || e.key === 'PageDown') && view.value !== 'gantt') {
    page(e.key === 'PageUp' ? -1 : 1);
  } else return;
  e.preventDefault();
}

function replayText(r: ReplayResult, verb: string): string {
  if (!r.done) return `没有可${verb}的操作`;
  return r.skipped ? `已${verb}（${r.skipped} 项已在其他窗口修改，保持不变）` : `已${verb}`;
}

/**
 * On the desktop layer the window is not activated by clicks (activating any window ends
 * Windows' "Show desktop" state, so the next Win+D would not restore the windows). Ask Rust
 * for the keyboard only when a text box is used; everything else works with the mouse.
 * Keyboard shortcuts are available after the hotkey (Ctrl+Alt+D) brings the calendar up.
 */
const EDITABLE = 'input, textarea, [contenteditable="true"]';
function wantsKeyboard(e: Event) {
  if ((e.target as HTMLElement | null)?.closest?.(EDITABLE)) void call('desk_activate');
}

/** Adjust mode (unlocked): press anywhere except a control to move the window; the calendar
 * itself ignores the mouse meanwhile (see .unlocked styles). */
function onAdjustDown(e: PointerEvent) {
  if (desk.value.locked || e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, a, [role="radio"], [role="tab"], [role="separator"], .grip')) return;
  e.preventDefault();
  void currentWindow.startDragging();
}
const GRIPS: [string, ResizeEdge][] = [
  ['n', 'North'], ['s', 'South'], ['e', 'East'], ['w', 'West'],
  ['ne', 'NorthEast'], ['nw', 'NorthWest'], ['se', 'SouthEast'], ['sw', 'SouthWest'],
];
function onGripDown(edge: ResizeEdge, e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  void currentWindow.startResizeDragging(edge);
}

const closeToast = () => (ui.toast = null);
const undoFromToast = () => void undo().then(closeToast);

let intervals: ReturnType<typeof setInterval>[] = [];
let booted = false;
async function bootApp() {
  if (booted) return;
  booted = true;
  await initStore();
  ui.weeksStart = defaultWeeksStart();
  void call<DataDirInfo>('data_dir_info').then((d) => {
    if (d?.missing) notice.value = `找不到数据文件夹 ${d.missing}（同步盘未启动？），本次使用本机默认文件夹。`;
  });
  void call('desk_ready');
  if (isTauri && doc.settings.desk.sidebarOpen && !doc.settings.desk.sidebarExternalSized) {
    void call('desk_set_sidebar', { open: true, delta: (doc.settings.desk.sidebarWidth || SIDEBAR_DEFAULT) + 18 });
    patchSettings({ desk: { sidebarExternalSized: true } });
  }
  await seedIfFirstRun();
  void autoPostpone();
  void updateHolidays();
  scheduleReminders();
  startClock((day, prev) => {
    // A calendar left on the desktop overnight follows the date, unless the user paged away.
    if (ui.cursor === startOfMonth(prev)) ui.cursor = startOfMonth(day);
    if (ui.weeksStart === defaultWeeksStart(prev)) ui.weeksStart = defaultWeeksStart(day);
    if (ui.selected === prev) ui.selected = day;
    void autoPostpone();
    scheduleReminders();
  });
  on<{ error: string | null }>('store://save-status', (p) => (saveError.value = p.error));
  intervals = [
    setInterval(scheduleReminders, 30 * 60_000),
    setInterval(() => void updateHolidays(), 6 * 3600_000),
  ];
  on('reminder://fired', () => scheduleReminders());
}

onMounted(async () => {
  if (shellRef.value && typeof ResizeObserver !== 'undefined') {
    shellRo = new ResizeObserver((entries) => {
      compact.value = entries[0].contentRect.width <= 560;
    });
    shellRo.observe(shellRef.value);
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('focusin', wantsKeyboard, true);
  window.addEventListener('pointerdown', wantsKeyboard, true);
  if (isServer) {
    const authed = await checkSession();
    if (!authed) return;
  }
  await bootApp();
});
onBeforeUnmount(() => {
  shellRo?.disconnect();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('focusin', wantsKeyboard, true);
  window.removeEventListener('pointerdown', wantsKeyboard, true);
  intervals.forEach(clearInterval);
  spring.dispose();
});

watch(() => [doc.tasks, doc.settings.reminders], scheduleReminders, { deep: true });
// Separate sources: a getter returning a new array would fire on every settings update.
watch(
  [() => doc.settings.calendar.weeksRows, () => doc.settings.calendar.weeksPast, () => doc.settings.calendar.weekStart],
  () => (ui.weeksStart = defaultWeeksStart()),
);
watch(
  () => storeState.recovered,
  (r) => {
    if (r === null) return;
    notice.value =
      r === 'last-saved.json'
        ? '数据文件已损坏，已恢复到最后一次保存的内容。'
        : r
          ? `数据文件已损坏，已从备份 ${r} 恢复。`
          : '数据文件已损坏且没有可用备份，已重新开始。';
  },
  { immediate: true },
);
</script>

<template>
  <div class="desk" :class="{ unlocked: !desk.locked, acrylic: desk.acrylic, mobileShell: isServer && compact }" @pointerdown="onAdjustDown">
    <template v-if="!desk.locked">
      <div v-for="[k, edge] in GRIPS" :key="k" class="grip" :class="k" aria-hidden="true" @pointerdown.stop="onGripDown(edge, $event)" />
    </template>
    <div ref="shellRef" class="shell" :class="{ framed: hasFrame, resizing: spring.dragging.value, dark: isDark, compact }">
      <div v-if="storeState.ready" class="sidebar-stage" :style="{ width: `${Math.max(0, spring.width.value).toFixed(2)}px` }">
        <div v-if="spring.width.value > 1" class="sidebar-inner" :style="sidebarInnerStyle">
          <LeftSidebar />
        </div>
      </div>
      <div
        v-if="storeState.ready"
        class="split-gutter"
        :class="{
          collapsed: spring.width.value <= 2,
          active: spring.dragging.value,
          detent: spring.nearDetent.value,
          collapsing: spring.willCollapse.value,
        }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整左侧边栏宽度"
        title="拖动调整宽度，双击恢复默认"
        @pointerdown.stop="spring.onDividerDown"
        @dblclick.stop="spring.onDividerDblClick"
      >
        <span class="gutter-pill" aria-hidden="true" />
        <span v-if="spring.dragging.value" class="resize-readout" aria-hidden="true">
          {{ spring.willCollapse.value ? '松开收起' : `${Math.round(spring.width.value)}px` }}
        </span>
      </div>
      <div class="card" :class="{ compact }">
      <TitleBar v-if="!compact" />
      <FInfoBar v-if="!desk.locked" class="bar" severity="info" title="调整模式">
        按住日历任意位置拖动来移动（可拖到其他屏幕），拖动四边或四角调整大小。
        <template #action>
          <FButton variant="accent" size="small" @click="patchSettings({ desk: { locked: true } })">完成</FButton>
        </template>
      </FInfoBar>
      <FInfoBar v-if="welcome && desk.locked" class="bar" severity="info" title="欢迎使用 FluentCal">
        双击日期添加任务，右键任务可完成、改颜色、删除；Ctrl+Alt+D 唤出日历。现在显示的是示例任务。
        <template #action>
          <FButton size="small" @click="clearSamples">清除示例数据</FButton>
          <FButton variant="accent" size="small" @click="patchSettings({ general: { onboarded: true } })">知道了</FButton>
        </template>
      </FInfoBar>
      <FInfoBar v-if="notice" class="bar" severity="warning" closable @close="notice = ''">{{ notice }}</FInfoBar>
      <FInfoBar v-if="saveError" class="bar" severity="error" title="无法保存">数据暂存在内存中，正在重试。请检查磁盘空间或是否有程序占用数据文件。（{{ saveError }}）</FInfoBar>
      <CompactView v-if="storeState.ready && compact" />
      <DayView v-else-if="storeState.ready && view === 'day'" />
      <MultiDayView v-else-if="storeState.ready && view === 'multiday'" />
      <MonthView v-else-if="storeState.ready && view !== 'gantt'" :mode="view === 'weeks' ? 'weeks' : 'month'" />
      <GanttView v-else-if="storeState.ready" />
      <CountdownBar v-if="storeState.ready && !compact && view !== 'gantt' && view !== 'day' && view !== 'multiday'" />
      <SearchPanel v-if="ui.searchOpen" />
      <Transition name="toast">
        <div v-if="ui.toast" class="toast" role="status">
          <span>{{ ui.toast.text }}</span>
          <FButton v-if="ui.toast.undo && history.canUndo" size="small" variant="accent" @click="undoFromToast">撤销</FButton>
          <FButton size="icon" variant="subtle" icon="close" title="关闭" @click="closeToast" />
        </div>
      </Transition>
      <div v-if="isServer && !serverState.authenticated" class="server-gate">
        <form class="gate-card" @submit.prevent="submitLogin">
          <h2>FluentCal 云端日历</h2>
          <p v-if="serverState.checking" class="gate-sub">正在检查登录状态…</p>
          <template v-else>
            <p class="gate-sub">登录后即可在 iPad / 网页与电脑同步日程和甘特图。</p>
            <FTextBox v-model="loginUser" placeholder="用户名" />
            <FTextBox v-model="loginPass" type="password" placeholder="密码" @enter="submitLogin" />
            <p v-if="serverState.loginError" class="gate-err" role="alert">{{ serverState.loginError }}</p>
            <FButton type="submit" variant="accent" :disabled="!loginPass || serverState.loggingIn">
              {{ serverState.loggingIn ? '登录中…' : '登录' }}
            </FButton>
          </template>
        </form>
      </div>
      <div v-if="isServer && serverModals.editor" class="modal-backdrop" @click.self="serverModals.editor = null">
        <div class="modal-sheet editor-sheet" role="dialog" aria-modal="true" aria-label="编辑任务">
          <EditorModal embedded :initial-payload="(serverModals.editor as any)" @close="serverModals.editor = null" />
        </div>
      </div>
      <div v-if="isServer && serverModals.settings" class="modal-backdrop" @click.self="serverModals.settings = null">
        <div class="modal-sheet settings-sheet" role="dialog" aria-modal="true" aria-label="设置">
          <div class="modal-bar">
            <span class="modal-title">设置</span>
            <FButton size="small" variant="subtle" @click="doLogout">退出登录</FButton>
            <FButton size="icon" variant="subtle" icon="close" title="关闭" @click="serverModals.settings = null" />
          </div>
          <SettingsModal embedded :initial-page="serverModals.settings.page" @close="serverModals.settings = null" />
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.desk {
  position: fixed;
  inset: 0;
  padding: var(--desk-pad);
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
}
.shell {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  container-type: inline-size;
}
.shell.framed {
  background: var(--desk-frame-bg);
  border: 1px solid var(--desk-frame-stroke);
  border-radius: calc(var(--desk-radius) + 6px);
  padding: 8px;
  box-shadow: var(--desk-frame-shadow);
}
.sidebar-stage {
  flex: none;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.sidebar-inner {
  height: 100%;
  transform-origin: left center;
  will-change: transform, opacity;
}
.split-gutter {
  width: 10px;
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}
.split-gutter.collapsed {
  width: 8px;
  margin-left: -2px;
}
.gutter-pill {
  width: 3px;
  height: 34px;
  border-radius: 999px;
  background: rgba(43, 40, 37, 0.24);
  opacity: 0;
  transition:
    opacity 140ms var(--ease),
    height 160ms var(--ease),
    background-color 140ms var(--ease);
}
.shell.dark .gutter-pill {
  background: rgba(255, 250, 240, 0.24);
}
.split-gutter:hover .gutter-pill,
.split-gutter.collapsed:hover .gutter-pill {
  opacity: 0.75;
}
.split-gutter.active .gutter-pill {
  opacity: 1;
  height: 48px;
}
.split-gutter.detent .gutter-pill,
.split-gutter.collapsing .gutter-pill {
  background: #e85a3c;
}
.resize-readout {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--flyout-fill);
  backdrop-filter: blur(16px);
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-flyout);
  color: var(--text-primary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  --text-glow: none;
  text-shadow: none;
}
.shell.resizing .card,
.shell.resizing .sidebar-stage {
  user-select: none;
}
.card {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 8px;
  border-radius: var(--desk-radius);
  background: var(--desk-bg);
  box-shadow:
    inset 0 0 0 1px var(--desk-stroke),
    var(--desk-shadow);
  overflow: hidden;
  font-family: var(--calendar-font-family);
  color: var(--calendar-text);
  font-size: calc(14px * var(--fs));
  text-shadow: var(--calendar-outline);
}
.unlocked .card,
.unlocked .sidebar-stage {
  outline: 2px dashed var(--accent-fill);
  outline-offset: -2px;
  cursor: move;
}
.unlocked .sidebar-stage,
.unlocked .split-gutter {
  pointer-events: none;
}
/* While adjusting, the calendar ignores the mouse so a press anywhere moves the window. */
.unlocked .card > :not(.titlebar, .bar, .grip) {
  pointer-events: none;
}
.grip {
  position: absolute;
  z-index: 40;
  --g: 8px;
}
.grip.n,
.grip.s {
  left: var(--g);
  right: var(--g);
  height: var(--g);
  cursor: ns-resize;
}
.grip.e,
.grip.w {
  top: var(--g);
  bottom: var(--g);
  width: var(--g);
  cursor: ew-resize;
}
.grip.n { top: 0; }
.grip.s { bottom: 0; }
.grip.e { right: 0; }
.grip.w { left: 0; }
.grip.ne,
.grip.nw,
.grip.se,
.grip.sw {
  width: calc(var(--g) * 2);
  height: calc(var(--g) * 2);
}
.grip.ne { top: 0; right: 0; cursor: nesw-resize; }
.grip.sw { bottom: 0; left: 0; cursor: nesw-resize; }
.grip.nw { top: 0; left: 0; cursor: nwse-resize; }
.grip.se { bottom: 0; right: 0; cursor: nwse-resize; }
.bar {
  flex: none;
}
@container (max-width: 620px) {
  .sidebar-stage,
  .split-gutter {
    display: none;
  }
}
.desk.mobileShell {
  padding: 0;
}
.shell.compact .sidebar-stage,
.shell.compact .split-gutter {
  display: none;
}
.desk.mobileShell .shell.framed {
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.card.compact {
  padding: 0;
  gap: 0;
}
.desk.mobileShell .card.compact {
  border-radius: 0;
  box-shadow: none;
}
.toast {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 30;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 14px;
  border-radius: 8px;
  background: var(--flyout-fill);
  backdrop-filter: blur(30px);
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-flyout);
  font-size: 13px;
  white-space: nowrap;
  --text-glow: none;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--dur-normal) var(--ease), transform var(--dur-normal) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
.server-gate {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--solid-base) 72%, transparent);
  backdrop-filter: blur(24px);
}
.gate-card {
  width: min(360px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  border-radius: 12px;
  background: var(--solid-base);
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-dialog);
  color: var(--text-primary);
  --text-glow: none;
}
.gate-card h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.gate-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.gate-err {
  margin: 0;
  font-size: 12px;
  color: var(--system-critical);
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(6px);
}
.modal-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(88vh, 760px);
  border-radius: 12px;
  overflow: hidden;
  background: var(--solid-base);
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-dialog);
  --text-glow: none;
}
.editor-sheet {
  max-width: 600px;
  height: min(86vh, 720px);
}
.settings-sheet {
  max-width: 960px;
  height: min(88vh, 740px);
}
.modal-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--divider);
  background: var(--solid-base);
}
.modal-title {
  margin-right: auto;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
