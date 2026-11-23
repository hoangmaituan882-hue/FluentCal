<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FButton, FTextBox } from '@/fluent';
import type { ISODate } from '@/types';
import { call, currentWindow, isServer } from '@/api';
import { checkSession, loginServer, serverState } from '@/serverApi';
import { startThemeSync, setWindowThemeOverride } from '@/composables/theme';
import { now, startClock } from '@/composables/now';
import { startOfMonth } from '@/lib/date';
import { autoPostpone } from '@/lib/tasks';
import { doc, history, initStore, redo, storeState, taskList, undo, type ReplayResult } from '@/stores/doc';
import { updateHolidays } from '@/stores/holidays';
import {
  defaultWeeksStart,
  notify,
  setEditorHandler,
  setGanttHandler,
  setSettingsHandler,
  ui,
  type EditorPayload,
} from '../desk/state';
import {
  classifyTaskBucket,
  closeTab,
  openOrFocusTab,
  persistTabs,
  restoreTabs,
  type WorkspacePageKind,
  type WorkspaceTab,
} from './workspaceModel';
import WorkspaceSidebar from './WorkspaceSidebar.vue';
import WorkspaceTopBar from './WorkspaceTopBar.vue';
import DailyView from './DailyView.vue';
import CalendarStage from './CalendarStage.vue';
import TasksView from './TasksView.vue';
import InboxView from './InboxView.vue';
import AreaView from './AreaView.vue';
import TaskInspector from './TaskInspector.vue';
import QuickModal from './QuickModal.vue';
import './workspace.css';

const GanttView = defineAsyncComponent(() => import('../desk/gantt/GanttView.vue'));
const SettingsApp = defineAsyncComponent(() => import('../settings/SettingsApp.vue'));

// Force Folio Warm Light Mode inside this window without affecting the desktop pinned widget.
setWindowThemeOverride('light');
startThemeSync();

const SIDEBAR_OPEN_KEY = 'fluentcal.workspace.sidebarOpen';
const CAL_VIEW_KEY = 'fluentcal.workspace.calView';

const restored = restoreTabs();
const tabs = ref<WorkspaceTab[]>(restored.tabs);
const activeTabId = ref(restored.activeId);
const sidebarOpen = ref(
  (() => {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  })(),
);
const calView = ref<'day' | 'multiday' | 'month' | 'weeks'>(
  (() => {
    try {
      const v = localStorage.getItem(CAL_VIEW_KEY);
      if (v === 'day' || v === 'multiday' || v === 'month' || v === 'weeks') return v;
    } catch {
      /* ignore */
    }
    return 'multiday';
  })(),
);

const searchQuery = ref('');
const filterGroupId = ref('');
const settingsPage = ref<string | undefined>(undefined);
const inspectorPayload = ref<EditorPayload | null>(null);
const quickModalOpen = ref(false);
const quickModalMode = ref<'search' | 'capture'>('search');

const loginUser = ref('fluentcal');
const loginPass = ref('');

watch([tabs, activeTabId], () => persistTabs({ tabs: tabs.value, activeId: activeTabId.value }), { deep: true });
watch(sidebarOpen, (v) => {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
});
watch(calView, (v) => {
  try {
    localStorage.setItem(CAL_VIEW_KEY, v);
  } catch {
    /* ignore */
  }
});

const activeTab = computed<WorkspaceTab | undefined>(() => {
  if (activeTabId.value === 'tab:settings') {
    return { id: 'tab:settings', kind: 'settings', title: '设置' };
  }
  return tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0];
});

const activeKind = computed<WorkspacePageKind>(() => activeTab.value?.kind ?? 'daily');
const activeGroupId = computed(() => activeTab.value?.groupId);

const TITLE_MAP: Record<Exclude<WorkspacePageKind, 'area'>, string> = {
  daily: '今日聚焦',
  calendar: '日历视图',
  inbox: '收集箱',
  tasks: '待办清单',
  gantt: '项目甘特',
  settings: '设置',
};

function navigateTo(kind: WorkspacePageKind, groupId?: string) {
  if (kind === 'settings') {
    activeTabId.value = 'tab:settings';
    return;
  }
  const title = kind === 'area' ? (groupId ? (doc.groups[groupId]?.name ?? '分组') : '分组') : TITLE_MAP[kind];
  const res = openOrFocusTab(tabs.value, { kind, title, groupId, closable: true });
  tabs.value = res.tabs;
  activeTabId.value = res.activeId;
}

function handleCloseTab(id: string) {
  const res = closeTab(tabs.value, activeTabId.value, id);
  tabs.value = res.tabs;
  activeTabId.value = res.activeId;
}

// Keep Area tab titles synced when groups are renamed elsewhere
watch(
  () => doc.groups,
  (groups) => {
    for (const tab of tabs.value) {
      if (tab.kind === 'area' && tab.groupId && groups[tab.groupId]) {
        tab.title = groups[tab.groupId].name;
      }
    }
  },
  { deep: true },
);

const inboxCount = computed(() => {
  const todayIso = now.value;
  let n = 0;
  for (const t of taskList.value) {
    const b = classifyTaskBucket(t, todayIso);
    if (b === 'anytime' || b === 'overdue') n++;
  }
  return n;
});

const openCount = computed(() => {
  const todayIso = now.value;
  let n = 0;
  for (const t of taskList.value) {
    if (classifyTaskBucket(t, todayIso) !== 'completed') n++;
  }
  return n;
});

function openTaskInInspector(taskId: string, date?: ISODate) {
  inspectorPayload.value = { mode: 'edit', taskId, date };
}

function openQuick(mode: 'search' | 'capture') {
  quickModalMode.value = mode;
  quickModalOpen.value = true;
}

function openSettingsTab(page?: string) {
  settingsPage.value = page;
  activeTabId.value = 'tab:settings';
}

function summonDesk() {
  void call('desk_summon');
}

function undoFromToast() {
  void undo().then(() => (ui.toast = null));
}

function replayText(r: ReplayResult, verb: string): string {
  if (!r.done) return `没有可${verb}的操作`;
  return r.skipped ? `已${verb}（${r.skipped} 项已在其他窗口修改）` : `已${verb}`;
}

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  const typing = el?.matches?.('input, textarea, select, [contenteditable="true"]');
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openQuick('search');
  } else if (ctrl && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openQuick('capture');
  } else if (ctrl && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    sidebarOpen.value = !sidebarOpen.value;
  } else if (ctrl && e.key.toLowerCase() === 'w') {
    if (activeTabId.value !== 'tab:settings' && tabs.value.length > 1) {
      e.preventDefault();
      handleCloseTab(activeTabId.value);
    }
  } else if (e.key === 'Escape') {
    if (quickModalOpen.value) quickModalOpen.value = false;
    else if (inspectorPayload.value) inspectorPayload.value = null;
  } else if (!typing && ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    void undo().then((r) => notify(replayText(r, '撤销')));
  } else if (!typing && ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    void redo().then((r) => notify(replayText(r, '重做')));
  }
}

async function submitLogin() {
  if (!loginPass.value || serverState.loggingIn) return;
  const ok = await loginServer(loginUser.value.trim() || 'fluentcal', loginPass.value);
  if (ok) {
    loginPass.value = '';
    await bootWorkspace();
  }
}

let booted = false;
async function bootWorkspace() {
  if (booted) return;
  booted = true;
  await initStore();
  ui.weeksStart = defaultWeeksStart();
  void autoPostpone();
  void updateHolidays();
  startClock((day, prev) => {
    if (ui.cursor === startOfMonth(prev)) ui.cursor = startOfMonth(day);
    if (ui.weeksStart === defaultWeeksStart(prev)) ui.weeksStart = defaultWeeksStart(day);
    if (ui.selected === prev) ui.selected = day;
    void autoPostpone();
  });
}

onMounted(async () => {
  setEditorHandler((payload) => {
    inspectorPayload.value = payload;
  });
  setSettingsHandler((page) => openSettingsTab(page));
  setGanttHandler(() => navigateTo('gantt'));
  window.addEventListener('keydown', onKey);

  // Reveal the native OS window immediately so startup feels responsive.
  try {
    await currentWindow.show();
    await currentWindow.focus();
  } catch {
    /* ignore in browser */
  }

  if (isServer) {
    const authed = await checkSession();
    if (!authed) return;
  }
  await bootWorkspace();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  setEditorHandler(null);
  setSettingsHandler(null);
  setGanttHandler(null);
});
</script>

<template>
  <div class="ws-root">
    <WorkspaceSidebar
      :open="sidebarOpen"
      :active-kind="activeKind"
      :active-group-id="activeGroupId"
      :inbox-count="inboxCount"
      :open-count="openCount"
      @toggle="sidebarOpen = !sidebarOpen"
      @navigate="navigateTo"
      @new-task="openQuick('capture')"
      @open-task="openTaskInInspector"
      @summon-desk="summonDesk"
      @open-settings="openSettingsTab()"
    />

    <div class="ws-main">
      <WorkspaceTopBar
        :sidebar-open="sidebarOpen"
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :active-kind="activeKind"
        :cal-view="calView"
        :search-query="searchQuery"
        :filter-group-id="filterGroupId"
        @toggle-sidebar="sidebarOpen = !sidebarOpen"
        @select-tab="(id) => (activeTabId = id)"
        @close-tab="handleCloseTab"
        @open-tab="navigateTo"
        @open-home="navigateTo('daily')"
        @open-settings="openSettingsTab()"
        @update:cal-view="(v) => (calView = v)"
        @update:search-query="(q) => (searchQuery = q)"
        @update:filter-group-id="(g) => (filterGroupId = g)"
        @open-quick-modal="openQuick"
      />

      <main class="ws-stage">
        <template v-if="storeState.ready">
          <Transition name="ws-stage" mode="out-in">
            <DailyView
              v-if="activeKind === 'daily'"
              key="view:daily"
              @open-task="openTaskInInspector"
            />
            <CalendarStage
              v-else-if="activeKind === 'calendar'"
              key="view:calendar"
              :cal-view="calView"
            />
            <TasksView
              v-else-if="activeKind === 'tasks'"
              key="view:tasks"
              :search-query="searchQuery"
              :filter-group-id="filterGroupId"
              @open-task="openTaskInInspector"
            />
            <InboxView
              v-else-if="activeKind === 'inbox'"
              key="view:inbox"
              :search-query="searchQuery"
              :filter-group-id="filterGroupId"
              @open-task="openTaskInInspector"
            />
            <AreaView
              v-else-if="activeKind === 'area' && activeGroupId"
              :key="`view:area:${activeGroupId}`"
              :group-id="activeGroupId"
              :search-query="searchQuery"
              @open-task="openTaskInInspector"
              @close-tab="handleCloseTab(activeTabId)"
            />
            <div v-else-if="activeKind === 'gantt'" key="view:gantt" class="ws-card-frame">
              <GanttView />
            </div>
            <div v-else-if="activeKind === 'settings'" key="view:settings" class="ws-card-frame ws-settings-frame">
              <SettingsApp embedded :initial-page="settingsPage" />
            </div>
          </Transition>
        </template>

        <div v-else class="ws-loading">正在载入工作台数据…</div>

        <!-- Floating Right Inspector Drawer -->
        <Transition name="ws-inspector">
          <TaskInspector
            v-if="inspectorPayload"
            :payload="inspectorPayload"
            @close="inspectorPayload = null"
          />
        </Transition>
      </main>

      <!-- Bottom-left floating Toast with Undo -->
      <Transition name="toast">
        <div v-if="ui.toast" class="ws-toast" role="status">
          <span>{{ ui.toast.text }}</span>
          <FButton
            v-if="ui.toast.undo && history.canUndo"
            size="small"
            variant="accent"
            @click="undoFromToast"
          >
            撤销
          </FButton>
          <FButton size="icon" variant="subtle" icon="close" title="关闭" @click="ui.toast = null" />
        </div>
      </Transition>
    </div>

    <QuickModal
      :open="quickModalOpen"
      :initial-mode="quickModalMode"
      :default-group-id="activeGroupId || filterGroupId"
      @close="quickModalOpen = false"
      @navigate="navigateTo"
      @open-task="openTaskInInspector"
    />

    <!-- Standalone Server Login Gate -->
    <div v-if="isServer && !serverState.authenticated" class="ws-server-gate">
      <form class="ws-gate-card ws-card" @submit.prevent="submitLogin">
        <h2>FluentCal 云端工作台</h2>
        <p v-if="serverState.checking" class="gate-sub">正在检查登录状态…</p>
        <template v-else>
          <p class="gate-sub">登录后即可在网页、iPad 与电脑桌面同步日程和工作台数据。</p>
          <FTextBox v-model="loginUser" placeholder="用户名" />
          <FTextBox v-model="loginPass" type="password" placeholder="密码" @enter="submitLogin" />
          <p v-if="serverState.loginError" class="gate-err" role="alert">{{ serverState.loginError }}</p>
          <FButton variant="accent" :disabled="serverState.loggingIn" @click="submitLogin">
            {{ serverState.loggingIn ? '登录中…' : '登录' }}
          </FButton>
        </template>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ws-loading {
  margin: auto;
  font-size: 13.5px;
  color: var(--ws-ink-secondary);
}

.ws-toast {
  position: fixed;
  left: 254px;
  bottom: 18px;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 14px;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font-size: 12.5px;
  box-shadow: var(--ws-shadow-md);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 180ms var(--ws-ease-out), transform 180ms var(--ws-ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.ws-server-gate {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(239, 238, 234, 0.88);
  backdrop-filter: blur(12px);
  display: grid;
  place-items: center;
}

.ws-gate-card {
  width: 340px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ws-gate-card h2 {
  margin: 0;
  font-size: 18px;
}

.gate-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ws-ink-secondary);
}

.gate-err {
  margin: 0;
  font-size: 12px;
  color: var(--ws-danger);
}
</style>
