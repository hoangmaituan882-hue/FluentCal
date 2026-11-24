<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { ISODate, Task } from '@/types';
import { addDays, formatMD, parts, startOfMonth, weekday, WEEKDAY_SHORT } from '@/lib/date';
import { flexKind } from '@/lib/flex';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { occurrences, type Occurrence } from '@/lib/recur';
import { countdowns } from '@/lib/countdown';
import { isSubscriptionTask, resolveSubscription } from '@/lib/subscriptions';
import {
  applyTaskStatus,
  checklistStats,
  effectivePriority,
  effectiveWorkspaceStatus,
  STATUS_META,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { addTask, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, taskList } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { goToday, ui } from '../desk/state';
import { useSlidingIndicator } from './useSlidingIndicator';
import MobileCalicoStage from './MobileCalicoStage.vue';
import NumberPop from './NumberPop.vue';
import TaskCheckButton from './TaskCheckButton.vue';
import TodayHabitsStrip from './TodayHabitsStrip.vue';
import WorkspaceInboxRail from './WorkspaceInboxRail.vue';
import { openTaskContextMenu, STATUS_DOT_COLOR } from './workspaceMenus';
import {
  dropTaskToDate,
  endTaskDrag,
  getDraggedTaskId,
  hasTaskDragPayload,
  startTaskDrag,
  workspaceDrag,
} from './workspaceDrag';

const props = withDefaults(
  defineProps<{
    inboxRailOpen?: boolean;
  }>(),
  {
    inboxRailOpen: true,
  },
);

const emit = defineEmits<{
  openTask: [taskId: string, date?: ISODate];
  openGroup: [groupId: string];
  openCountdowns: [];
  openSubscriptions: [];
  openHabits: [];
  toggleInboxRail: [];
  dockCompact: [compact: boolean];
}>();

const quickTitle = ref('');
const summaryFilter = ref<'all' | 'events' | 'habits' | 'important'>('all');
const dragOverDay = ref<ISODate | null>(null);
const dragOverStream = ref(false);

const { width: vpWidth, isPhone } = useViewport();
const showRightRail = computed(() => !isPhone.value && props.inboxRailOpen && vpWidth.value >= 920);

const selectedDate = computed(() => ui.selected || now.value);
const selectedParts = computed(() => parts(selectedDate.value));
const selectedInfo = computed(() => dayInfo(selectedDate.value));

const isViewingToday = computed(() => selectedDate.value === now.value);

const heroHeading = computed(() =>
  isViewingToday.value ? '今日' : `${selectedParts.value[1]}月${selectedParts.value[2]}日`,
);

const heroDateLine = computed(() => {
  const [y, m, d] = selectedParts.value;
  const wd = `周${WEEKDAY_SHORT[weekday(selectedDate.value)]}`;
  const extra = selectedInfo.value.festivals[0] || selectedInfo.value.term;
  return `${y}年${m}月${d}日 · ${wd} · 农历${selectedInfo.value.lunarLabel}${extra ? ` · ${extra}` : ''}`;
});

// 11-day open flowing date strip anchored cleanly from selectedDate (or today)
const stripStart = ref<ISODate>(now.value);
const dayStripRef = ref<HTMLElement>();
const daySlideDir = ref<'next' | 'prev'>('next');

const stripDays = computed<ISODate[]>(() => {
  const sel = selectedDate.value;
  const curStart = stripStart.value;
  const curEnd = addDays(curStart, 10);
  const base = sel < curStart || sel > curEnd ? addDays(sel, -1) : curStart;
  return Array.from({ length: 11 }, (_, i) => addDays(base, i));
});

const {
  style: dayPillStyle,
  visible: dayPillVisible,
  ready: dayPillReady,
} = useSlidingIndicator(dayStripRef, '.wd-day-cell.selected', [selectedDate, stripDays, vpWidth]);

function selectDate(d: ISODate) {
  if (d !== selectedDate.value) {
    daySlideDir.value = d > selectedDate.value ? 'next' : 'prev';
  }
  ui.selected = d;
  ui.cursor = startOfMonth(d);
  summaryFilter.value = 'all';
}

function stepDay(delta: number) {
  const next = addDays(selectedDate.value, delta);
  selectDate(next);
}

function jumpToday() {
  daySlideDir.value = now.value >= selectedDate.value ? 'next' : 'prev';
  goToday();
  stripStart.value = now.value;
  summaryFilter.value = 'all';
}

// Plan 1: Damped Mouse Wheel / Trackpad Day Switching (Header & Date Strip direct + Shift+Wheel / Horizontal anywhere)
let wheelAccum = 0;
let wheelCooldownUntil = 0;
let wheelResetTimer: ReturnType<typeof setTimeout> | undefined;

function consumeDayWheel(delta: number) {
  const ts = performance.now();
  if (ts < wheelCooldownUntil) return;
  wheelAccum += delta;
  clearTimeout(wheelResetTimer);
  wheelResetTimer = setTimeout(() => {
    wheelAccum = 0;
  }, 180);

  const THRESHOLD = 38;
  if (Math.abs(wheelAccum) >= THRESHOLD) {
    const dir = wheelAccum > 0 ? 1 : -1;
    wheelAccum = 0;
    wheelCooldownUntil = ts + 210;
    stepDay(dir);
  }
}

function onStripZoneWheel(e: WheelEvent) {
  const primary = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!primary) return;
  e.preventDefault();
  consumeDayWheel(primary);
}

function onSheetWheel(e: WheelEvent) {
  // Anywhere on Today sheet: Shift+Wheel OR horizontal trackpad swipe switches days without fighting vertical list scroll
  if (e.shiftKey) {
    const primary = e.deltaY || e.deltaX;
    if (!primary) return;
    e.preventDefault();
    consumeDayWheel(primary);
    return;
  }
  if (Math.abs(e.deltaX) > 12 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.35) {
    e.preventDefault();
    consumeDayWheel(e.deltaX);
  }
}

const stripDotColors = computed<Record<ISODate, string[]>>(() => {
  const start = stripDays.value[0];
  const end = stripDays.value[stripDays.value.length - 1];
  const map: Record<ISODate, string[]> = {};
  for (const t of taskList.value) {
    if (t.countdownOnly || t.subscriptionOnly || t.habitOnly || flexKind(t)) continue;
    const key = t.color || (t.groupId ? doc.groups[t.groupId]?.color : '') || '';
    const hex = key ? taskColor(key, isDark.value).bar : '#E84C3D';
    for (const o of occurrences(t, start, end)) {
      if (o.done) continue;
      let d = o.start < start ? start : o.start;
      const limit = o.end > end ? end : o.end;
      while (d <= limit) {
        const arr = (map[d] ??= []);
        if (arr.length < 3 && !arr.includes(hex)) arr.push(hex);
        d = addDays(d, 1);
      }
    }
  }
  return map;
});

const dayOccurrences = computed<Occurrence[]>(() => {
  const d = selectedDate.value;
  const out: Occurrence[] = [];
  for (const t of taskList.value) {
    if (t.countdownOnly || t.subscriptionOnly || t.habitOnly || flexKind(t)) continue;
    out.push(...occurrences(t, d, d));
  }
  out.sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    const aEvent = isCalendarEventRow(a) ? 1 : 0;
    const bEvent = isCalendarEventRow(b) ? 1 : 0;
    if (aEvent !== bEvent) return aEvent - bEvent;
    const at = a.task.time ?? '99:99';
    const bt = b.task.time ?? '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.task.order - b.task.order;
  });
  return out;
});

function isCalendarEventRow(occ: Occurrence): boolean {
  if (occ.done) return false;
  const st = effectiveWorkspaceStatus(occ.task);
  const pri = effectivePriority(occ.task);
  return !!occ.task.time && !occ.task.repeat && st === 'todo' && pri === 'none' && !occ.task.checklist?.length;
}

const greetingText = computed(() => {
  const hr = new Date().getHours();
  if (hr < 12) return '早上好';
  if (hr < 18) return '下午好';
  return '晚上好';
});

const summaryStats = computed(() => {
  let events = 0;
  let habits = 0;
  let important = 0;
  let doneCount = 0;
  for (const o of dayOccurrences.value) {
    if (o.done) {
      doneCount++;
      continue;
    }
    if (o.task.time) events++;
    if (o.task.repeat) habits++;
    const p = effectivePriority(o.task);
    if (p === 'urgent' || p === 'high' || effectiveWorkspaceStatus(o.task) === 'in_progress') {
      important++;
    }
  }
  const totalCount = dayOccurrences.value.length;
  return {
    events,
    habits,
    important,
    doneCount,
    totalCount,
    openTotal: totalCount - doneCount,
  };
});

const summaryDialogue = computed(() => {
  const dayLabel = isViewingToday.value ? '今天' : `${selectedParts.value[1]}月${selectedParts.value[2]}日`;
  const { openTotal, totalCount } = summaryStats.value;
  if (totalCount === 0) return `${greetingText.value}，${dayLabel}安排清爽空闲`;
  if (openTotal === 0) return `${greetingText.value}，${dayLabel}事项已全部完成`;
  return `${greetingText.value}，${dayLabel}还有 ${openTotal} 项待处理`;
});

const filteredOccurrences = computed(() => {
  const f = summaryFilter.value;
  if (f === 'all') return dayOccurrences.value;
  return dayOccurrences.value.filter((o) => {
    if (o.done) return false;
    if (f === 'events') return !!o.task.time;
    if (f === 'habits') return !!o.task.repeat;
    if (f === 'important') {
      const p = effectivePriority(o.task);
      return p === 'urgent' || p === 'high' || effectiveWorkspaceStatus(o.task) === 'in_progress';
    }
    return true;
  });
});

const nextCountdown = computed(() => {
  const list = countdowns(
    taskList.value.map((t) => (t.groupId && !doc.groups[t.groupId] ? { ...t, groupId: undefined } : t)),
    now.value,
    doc.settings.calendar.holidayCountdown,
    doc.settings.calendar.countdownMarked,
    doc.settings.calendar.countdownGroups,
    doc.settings.calendar.countdownFestival,
    doc.settings.calendar.countdownTerm,
  );
  return list[0] ?? null;
});

const soonSubscription = computed(() => {
  const todayIso = now.value;
  const upcoming = taskList.value
    .filter(isSubscriptionTask)
    .filter((t) => t.subscription.status === 'active' || t.subscription.status === 'trial')
    .map((t) => resolveSubscription(t, todayIso))
    .filter((s) => s.window.remainDays <= 3)
    .sort((a, b) => a.window.remainDays - b.window.remainDays);
  return upcoming[0] ?? null;
});

function toggleSummaryFilter(kind: 'events' | 'habits' | 'important') {
  summaryFilter.value = summaryFilter.value === kind ? 'all' : kind;
}

function occGlyphVariant(occ: Occurrence): 'done' | 'event' | 'progress' | 'important' | 'regular' {
  if (occ.done) return 'done';
  if (isCalendarEventRow(occ)) return 'event';
  const st = effectiveWorkspaceStatus(occ.task);
  if (st === 'in_progress' || st === 'in_review') return 'progress';
  const pri = effectivePriority(occ.task);
  if (pri === 'urgent' || pri === 'high') return 'important';
  return 'regular';
}

function occDotColor(occ: Occurrence): string {
  const key = occ.task.color || (occ.task.groupId ? doc.groups[occ.task.groupId]?.color : '') || '';
  return key ? taskColor(key, isDark.value).bar : '#E84C3D';
}

function groupPill(t: Task) {
  if (!t.groupId || !doc.groups[t.groupId]) return null;
  const g = doc.groups[t.groupId];
  const hex = taskColor(g.color, isDark.value).bar;
  return {
    name: g.name,
    color: hex,
    bg: `color-mix(in srgb, ${hex} 13%, transparent)`,
  };
}

function attachedNotePreview(t: Task): { title: string; meta: string } | null {
  const note = t.notes?.trim();
  const chk = t.checklist ?? [];
  if (!note && !chk.length) return null;
  if (note) {
    const lines = note.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? note;
    const pts = chk.length ? `备注 · ${chk.length} 项子步骤` : `备注 · ${lines.length} 条要点`;
    return { title: first, meta: pts };
  }
  const stats = checklistStats(chk);
  return {
    title: chk[0]?.text ?? '执行清单',
    meta: `子步骤 · ${stats.done}/${stats.total} 已完成`,
  };
}

function shortDateStr(iso: ISODate): string {
  return `${formatMD(iso)} 周${WEEKDAY_SHORT[weekday(iso)]}`;
}

const completingKeys = ref<Set<string>>(new Set());

function occKeyStr(occ: Occurrence): string {
  return `${occ.task.id}@${occ.date}`;
}

function isVisualDone(occ: Occurrence): boolean {
  return occ.done || completingKeys.value.has(occKeyStr(occ));
}

function toggleOcc(occ: Occurrence) {
  const key = occKeyStr(occ);
  if (!occ.done) {
    if (completingKeys.value.has(key)) return;
    const next = new Set(completingKeys.value);
    next.add(key);
    completingKeys.value = next;
    setTimeout(() => {
      void setOccurrenceDone(occ.task, occ.date, true);
      const after = new Set(completingKeys.value);
      after.delete(key);
      completingKeys.value = after;
    }, 390);
    return;
  }
  void setOccurrenceDone(occ.task, occ.date, false);
}

function onGlyphClick(occ: Occurrence, e: MouseEvent) {
  if (e.shiftKey || occ.task.repeat || flexKind(occ.task)) {
    toggleOcc(occ);
    return;
  }
  // Single click completes immediately (Woday tactile delight); Shift/right-click opens status menu
  toggleOcc(occ);
}

function onGlyphContext(occ: Occurrence, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const anchor = e.currentTarget as HTMLElement;
  const cur = occ.done ? 'done' : effectiveWorkspaceStatus(occ.task);
  const items: MenuItem[] = WORKSPACE_STATUS_ORDER.map((st) => ({
    key: `st:${st}`,
    label: STATUS_META[st].label,
    colorDot: STATUS_DOT_COLOR[st],
    radio: true,
    checked: cur === st,
    action: () => void saveTask(applyTaskStatus(occ.task, st)),
  }));
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openDayTaskMenu(t: Task, date: ISODate | undefined, e: MouseEvent) {
  void openTaskContextMenu(t, { x: e.clientX, y: e.clientY }, {
    date,
    onOpen: () => emit('openTask', t.id, date),
  });
}

async function addTodayTask() {
  const title = quickTitle.value.trim();
  if (!title) return;
  quickTitle.value = '';
  await addTask({ title, start: selectedDate.value, end: selectedDate.value });
}

// Drag-and-Drop from Right Inbox Rail / Any View onto Today Stream or Any Day in the 11-Day Strip
function onStreamDragOver(e: DragEvent) {
  if (!hasTaskDragPayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverStream.value = true;
}

function onDayCellDragOver(d: ISODate, e: DragEvent) {
  if (!hasTaskDragPayload(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverDay.value = d;
}

function scheduleDroppedTask(e: DragEvent, targetDate: ISODate) {
  dragOverDay.value = null;
  dragOverStream.value = false;
  const id = getDraggedTaskId(e);
  if (!id) return;
  e.preventDefault();
  void dropTaskToDate(id, targetDate);
  if (targetDate !== selectedDate.value) {
    selectDate(targetDate);
  }
}

onMounted(() => {
  ui.activeView = 'day';
});

onBeforeUnmount(() => {
  clearTimeout(wheelResetTimer);
  if (ui.activeView === 'day') ui.activeView = '';
});
</script>

<template>
  <div class="ws-daily" :class="{ phone: isPhone, 'woday-dual': !isPhone }">
    <!-- Dedicated Calico 3-Detent Split Calendar & Agenda Stage on Phone (< 640px) -->
    <MobileCalicoStage
      v-if="isPhone"
      @open-task="(id, date) => emit('openTask', id, date)"
      @open-countdowns="emit('openCountdowns')"
      @open-habits="emit('openHabits')"
      @dock-compact="(v) => emit('dockCompact', v)"
    />

    <!-- Woday Dual Floating White Sheets on Desktop / Tablet -->
    <template v-else>
      <div class="wd-dual-layout">
        <!-- Main Left/Center Sheet: Today -->
        <section
          class="wd-today-sheet"
          :class="{ 'drop-active': dragOverStream }"
          @wheel="onSheetWheel"
          @dragover="onStreamDragOver"
          @dragleave="dragOverStream = false"
          @drop.prevent="scheduleDroppedTask($event, selectedDate)"
        >
          <div class="wd-today-inner">
            <!-- Header Row: 'Today' + Date + 'Today < >' (Wheel switches day smoothly) -->
            <header class="wd-head" @wheel.stop="onStripZoneWheel">
              <div class="wd-head-left">
                <Transition name="t-text-swap" mode="out-in">
                  <h1 :key="heroHeading" class="wd-title">{{ heroHeading }}</h1>
                </Transition>
                <Transition name="t-text-swap" mode="out-in">
                  <div :key="heroDateLine" class="wd-date-sub">{{ heroDateLine }}</div>
                </Transition>
              </div>
              <div class="wd-head-right">
                <button type="button" class="wd-today-pill" :class="{ away: !isViewingToday }" @click="jumpToday">
                  {{ isViewingToday ? '今天' : selectedDate > now ? '← 回到今天' : '回到今天 →' }}
                </button>
                <button type="button" class="wd-nav-circle" title="前一天" aria-label="前一天" @click="stepDay(-1)">
                  <FIcon name="chevronLeft" :size="13" />
                </button>
                <button type="button" class="wd-nav-circle" title="后一天" aria-label="后一天" @click="stepDay(1)">
                  <FIcon name="chevronRight" :size="13" />
                </button>
              </div>
            </header>

            <!-- 11-Day Open Borderless Horizontal Date Strip (Liquid Sliding Pill + Wheel Switch + Drop Target!) -->
            <div
              ref="dayStripRef"
              class="wd-date-strip"
              role="radiogroup"
              aria-label="近期日期导航（支持滚轮切换日期）"
              @wheel.stop="onStripZoneWheel"
            >
              <span
                v-if="dayPillVisible"
                class="ws-slide-pill wd-day-slide-pill"
                :class="{ 'no-anim': !dayPillReady }"
                :style="dayPillStyle"
                aria-hidden="true"
              />
              <button
                v-for="d in stripDays"
                :key="d"
                type="button"
                class="wd-day-cell"
                :class="{
                  selected: d === selectedDate,
                  today: d === now,
                  'drag-over': dragOverDay === d,
                }"
                @click="selectDate(d)"
                @dragover="onDayCellDragOver(d, $event)"
                @dragleave="dragOverDay === d && (dragOverDay = null)"
                @drop.prevent.stop="scheduleDroppedTask($event, d)"
              >
                <span class="wd-day-num">{{ parts(d)[2] }}</span>
                <span class="wd-day-wk">周{{ WEEKDAY_SHORT[weekday(d)] }}</span>
                <span class="wd-day-dots" aria-hidden="true">
                  <i
                    v-for="(hex, idx) in (stripDotColors[d] ?? [])"
                    :key="idx"
                    :style="{ background: hex }"
                  />
                </span>
              </button>
            </div>

            <!-- WWDC25 Interactive Snippets Deck (Overview Summary Card + Daily Habits Snippet) -->
            <div class="wd-snippets-deck">
              <section class="wd-summary-box" aria-label="今日安排摘要卡片">
                <header class="wd-sum-head">
                  <div class="wd-sum-dialogue-wrap">
                    <strong class="wd-sum-dialogue">{{ summaryDialogue }}</strong>
                    <span v-if="summaryStats.totalCount > 0" class="wd-sum-progress tabular">
                      已完成 <NumberPop :value="summaryStats.doneCount" />/{{ summaryStats.totalCount }}
                    </span>
                  </div>
                  <button
                    v-if="summaryFilter !== 'all'"
                    type="button"
                    class="wd-sum-clear"
                    @click="summaryFilter = 'all'"
                  >
                    显示全部
                  </button>
                </header>

                <!-- 3 Concentric Glanceable Filter Stat Tiles -->
                <div class="wd-sum-kpis" role="group" aria-label="按类型快速筛选当日事项">
                  <button
                    type="button"
                    class="wd-sum-kpi rose"
                    :class="{ active: summaryFilter === 'events', zero: summaryStats.events === 0 }"
                    :aria-pressed="summaryFilter === 'events'"
                    @click="toggleSummaryFilter('events')"
                  >
                    <span class="wd-kpi-ico">
                      <FIcon name="calendar" :size="13" />
                    </span>
                    <div class="wd-kpi-copy">
                      <strong class="wd-kpi-num tabular"><NumberPop :value="summaryStats.events" /></strong>
                      <span class="wd-kpi-lbl">日程安排</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    class="wd-sum-kpi slate"
                    :class="{ active: summaryFilter === 'habits', zero: summaryStats.habits === 0 }"
                    :aria-pressed="summaryFilter === 'habits'"
                    @click="toggleSummaryFilter('habits')"
                  >
                    <span class="wd-kpi-ico">
                      <FIcon name="repeat" :size="13" />
                    </span>
                    <div class="wd-kpi-copy">
                      <strong class="wd-kpi-num tabular"><NumberPop :value="summaryStats.habits" /></strong>
                      <span class="wd-kpi-lbl">循环日常</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    class="wd-sum-kpi amber"
                    :class="{ active: summaryFilter === 'important', zero: summaryStats.important === 0 }"
                    :aria-pressed="summaryFilter === 'important'"
                    @click="toggleSummaryFilter('important')"
                  >
                    <span class="wd-kpi-ico">
                      <FIcon name="warning" :size="13" />
                    </span>
                    <div class="wd-kpi-copy">
                      <strong class="wd-kpi-num tabular"><NumberPop :value="summaryStats.important" /></strong>
                      <span class="wd-kpi-lbl">重要优先</span>
                    </div>
                  </button>
                </div>

                <!-- Contextual WWDC25 Deep-Link Alert Mini-Snippets (Upcoming Subscription / Countdown) -->
                <div v-if="soonSubscription || nextCountdown" class="wd-context-snippets">
                  <button
                    v-if="soonSubscription"
                    type="button"
                    class="wd-ctx-tile sub-due"
                    title="前往订阅日历查看详情"
                    @click="emit('openSubscriptions')"
                  >
                    <span class="wd-ctx-ico">
                      <FIcon name="subscription" :size="12" />
                    </span>
                    <span class="wd-ctx-label">{{ soonSubscription.task.title }}</span>
                    <strong class="wd-ctx-badge tabular">
                      {{ soonSubscription.window.remainDays === 0 ? '今日扣款' : `${soonSubscription.window.remainDays}天后扣款` }}
                    </strong>
                    <FIcon name="chevronRight" :size="11" class="wd-ctx-chev" />
                  </button>

                  <button
                    v-if="nextCountdown"
                    type="button"
                    class="wd-ctx-tile cd-next"
                    title="前往倒数日查看全部"
                    @click="emit('openCountdowns')"
                  >
                    <span class="wd-ctx-ico">
                      <FIcon name="clock" :size="12" />
                    </span>
                    <span class="wd-ctx-label">{{ nextCountdown.label }}</span>
                    <strong class="wd-ctx-badge tabular">
                      {{ nextCountdown.days === 0 ? '就在今天' : `还剩 ${nextCountdown.days} 天` }}
                    </strong>
                    <FIcon name="chevronRight" :size="11" class="wd-ctx-chev" />
                  </button>
                </div>
              </section>

              <!-- WWDC25 Daily Habits Interactive Snippet Card (renders only when habits exist) -->
              <TodayHabitsStrip :date="selectedDate" @open-habits="emit('openHabits')" />
            </div>

            <!-- Unified Chronological Stream + Directional Day Carousel + FLIP Reflow -->
            <Transition :name="daySlideDir === 'next' ? 't-day-next' : 't-day-prev'" mode="out-in">
              <div :key="selectedDate" class="wd-stream">
                <TransitionGroup v-if="filteredOccurrences.length" name="t-list" tag="div" class="wd-stream-list">
                  <div
                    v-for="occ in filteredOccurrences"
                    :key="`${occ.task.id}@${occ.date}`"
                    class="wd-item-block"
                    :class="{
                      done: isVisualDone(occ),
                      dragging: workspaceDrag.active && workspaceDrag.taskId === occ.task.id,
                    }"
                    :draggable="!occ.task.repeat"
                    @dragstart="startTaskDrag(occ.task, $event, 'daily')"
                    @dragend="endTaskDrag"
                  >
                    <div
                      class="wd-row"
                      @click="emit('openTask', occ.task.id, occ.date)"
                      @contextmenu.prevent="openDayTaskMenu(occ.task, occ.date, $event)"
                    >
                      <!-- Left Semantic Glyph: transitions.dev Checkbox Check / Event Dot -->
                      <TaskCheckButton
                        v-if="occGlyphVariant(occ) !== 'event'"
                        :checked="isVisualDone(occ)"
                        :in-progress="occGlyphVariant(occ) === 'progress'"
                        :accent-color="occGlyphVariant(occ) === 'important' ? '#F59E0B' : occDotColor(occ)"
                        :size="19"
                        :label="occ.done ? '取消完成' : '标记完成'"
                        @toggle="onGlyphClick(occ, $event)"
                        @contextmenu="onGlyphContext(occ, $event)"
                      />

                      <button
                        v-else
                        type="button"
                        class="wd-event-dot-btn"
                        title="点击标记完成"
                        @click.stop="toggleOcc(occ)"
                      >
                        <span class="wd-event-dot" :style="{ background: occDotColor(occ) }" />
                      </button>

                      <!-- Content Column -->
                      <div class="wd-row-content">
                        <div class="wd-row-title">
                          <span class="t-strike-text" :class="{ 'is-struck': isVisualDone(occ) }">
                            {{ occ.task.title }}
                          </span>
                        </div>
                        <div class="wd-row-meta">
                          <FIcon v-if="occ.task.repeat" name="flame" :size="11" class="wd-meta-ico" />
                          <span class="wd-meta-date">{{ shortDateStr(occ.date) }}</span>
                          <span v-if="occ.task.time" class="wd-meta-time" :class="{ muted: occGlyphVariant(occ) === 'event' }">
                            {{ occ.task.time }}
                          </span>
                          <span
                            v-if="groupPill(occ.task)"
                            class="wd-meta-tag"
                            :style="{ background: groupPill(occ.task)!.bg, color: groupPill(occ.task)!.color }"
                          >
                            {{ groupPill(occ.task)!.name }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <!-- Woday Inline Attached Note / Checklist Branch ('└─ Notes stay with meetings') -->
                    <div
                      v-if="attachedNotePreview(occ.task)"
                      class="wd-note-branch"
                      @click="emit('openTask', occ.task.id, occ.date)"
                    >
                      <span class="wd-branch-line" aria-hidden="true" />
                      <div class="wd-note-card">
                        <span class="wd-note-ico">
                          <FIcon name="note" :size="14" />
                        </span>
                        <div class="wd-note-copy">
                          <div class="wd-note-title">{{ attachedNotePreview(occ.task)!.title }}</div>
                          <div class="wd-note-sub">{{ attachedNotePreview(occ.task)!.meta }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TransitionGroup>

                <div v-else class="wd-empty-stream">
                  <p>{{ summaryFilter === 'all' ? '这一天还没有安排事项，直接在下方输入，或从右侧收集箱拖入。' : '当前筛选下没有匹配的事项。' }}</p>
                </div>

                <!-- Quiet Inline Composer at Bottom of Stream -->
                <form class="wd-inline-add" @submit.prevent="addTodayTask">
                  <span class="wd-glyph regular ghost" aria-hidden="true" />
                  <input
                    v-model="quickTitle"
                    type="text"
                    class="wd-inline-input"
                    :placeholder="`添加${isViewingToday ? '今日' : '当天'}待办或日程，回车创建…`"
                  />
                  <button v-if="quickTitle.trim()" type="submit" class="wd-inline-submit">添加</button>
                </form>
              </div>
            </Transition>
          </div>
        </section>

        <!-- Permanent Collapsible Right Companion Sheet: Inbox -->
        <WorkspaceInboxRail
          v-if="showRightRail"
          :selected-date="selectedDate"
          @open-task="(id) => emit('openTask', id)"
          @open-group="(gid) => emit('openGroup', gid)"
          @collapse="emit('toggleInboxRail')"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ws-daily {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.wd-dual-layout {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  gap: 10px;
}

/* Main Floating White Sheet ('Today') */
.wd-today-sheet {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  overflow-y: auto;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.wd-today-sheet.drop-active {
  border-color: color-mix(in srgb, #e84c3d 55%, var(--ws-hairline));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #e84c3d 25%, transparent);
}

.wd-today-inner {
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
  padding: 26px 32px 44px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Header */
.wd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.wd-head-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wd-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 780;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--ws-ink);
}

.wd-date-sub {
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-ink-muted);
}

.wd-head-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.wd-today-pill {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.wd-today-pill:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.wd-nav-circle {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.wd-nav-circle:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

/* 11-Day Open Borderless Date Strip with Liquid Sliding Pill */
.wd-date-strip {
  position: relative;
  display: grid;
  grid-template-columns: repeat(11, minmax(0, 1fr));
  gap: 4px;
  align-items: center;
}

.wd-day-slide-pill {
  border-radius: 12px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.055);
  z-index: 0;
}

.wd-day-cell {
  position: relative;
  z-index: 1;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  padding: 8px 2px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  color: var(--ws-ink-secondary);
  font: inherit;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease;
}

.wd-day-cell:hover:not(.selected) {
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
}

.wd-day-cell.selected {
  color: var(--ws-ink);
}

.wd-today-pill.away {
  background: color-mix(in srgb, #e84c3d 10%, var(--ws-card-subtle));
  border-color: color-mix(in srgb, #e84c3d 28%, transparent);
  color: #d93f31;
}

.wd-stream-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wd-item-block.dragging {
  opacity: 0.42;
  transform: scale(0.985);
}

.wd-day-cell.drag-over {
  border-color: #e84c3d;
  background: color-mix(in srgb, #e84c3d 10%, transparent);
  transform: scale(1.04);
}

.wd-day-num {
  font-size: 16px;
  font-weight: 660;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.wd-day-cell.today .wd-day-num,
.wd-day-cell.selected.today .wd-day-num {
  color: #e84c3d;
}

.wd-day-wk {
  font-size: 11px;
  font-weight: 500;
  color: var(--ws-ink-muted);
}

.wd-day-cell.selected.today .wd-day-wk {
  color: color-mix(in srgb, #e84c3d 82%, var(--ws-ink-muted));
}

.wd-day-dots {
  height: 5px;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.wd-day-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

/* WWDC25 Interactive Snippets Deck (Overview Summary Card + Daily Habits Snippet) */
.wd-snippets-deck {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wd-summary-box {
  --wd-r-outer: 20px;
  --wd-r-inner: 13px;
  padding: 13px 14px 12px;
  border-radius: var(--wd-r-outer);
  border: 1px solid var(--ws-hairline);
  background: color-mix(in srgb, var(--ws-card-subtle) 58%, var(--ws-card-bg));
  box-shadow: 0 2px 10px rgba(15, 16, 20, 0.03);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wd-sum-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px;
}

.wd-sum-dialogue-wrap {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.wd-sum-dialogue {
  font-size: 14.5px;
  font-weight: 760;
  letter-spacing: -0.015em;
  line-height: 1.25;
  color: var(--ws-ink);
}

.wd-sum-progress {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 11px;
  font-weight: 700;
}

.wd-sum-clear {
  flex: none;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 660;
  cursor: pointer;
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out), color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.wd-sum-clear:hover {
  color: var(--ws-ink);
  background: var(--ws-pill-hover);
}

/* 3 Concentric Glanceable Interactive KPI Action Tiles */
.wd-sum-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.wd-sum-kpi {
  --kpi-tint: #64748b;
  padding: 9px 11px;
  border-radius: var(--wd-r-inner);
  border: 1px solid color-mix(in srgb, var(--kpi-tint) 16%, var(--ws-hairline));
  background: color-mix(in srgb, var(--kpi-tint) 7%, var(--ws-card-bg));
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 9px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out),
    opacity var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.wd-sum-kpi.rose {
  --kpi-tint: #e84c3d;
}

.wd-sum-kpi.slate {
  --kpi-tint: #4f46e5;
}

.wd-sum-kpi.amber {
  --kpi-tint: #d97706;
}

.wd-sum-kpi.zero:not(.active) {
  opacity: 0.72;
}

@media (hover: hover) {
  .wd-sum-kpi:hover {
    transform: translateY(-1px);
    opacity: 1;
    border-color: color-mix(in srgb, var(--kpi-tint) 42%, transparent);
    background: color-mix(in srgb, var(--kpi-tint) 12%, var(--ws-card-bg));
  }
}

.wd-sum-kpi:active {
  transform: scale(0.97);
}

.wd-sum-kpi.active {
  opacity: 1;
  border-color: color-mix(in srgb, var(--kpi-tint) 68%, transparent);
  background: color-mix(in srgb, var(--kpi-tint) 14%, var(--ws-card-bg));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--kpi-tint) 24%, transparent);
}

.wd-kpi-ico {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--kpi-tint) 14%, transparent);
  color: var(--kpi-tint);
  display: inline-grid;
  place-items: center;
  flex: none;
}

.wd-sum-kpi.active .wd-kpi-ico {
  background: var(--kpi-tint);
  color: #ffffff;
}

.wd-kpi-copy {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.wd-kpi-num {
  font-size: 18px;
  font-weight: 860;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--ws-ink);
}

.wd-kpi-lbl {
  font-size: 12px;
  font-weight: 660;
  color: var(--ws-ink-secondary);
  white-space: nowrap;
}

/* Contextual WWDC25 Deep-Link Alert Mini-Snippets */
.wd-context-snippets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.wd-ctx-tile {
  --ctx-tint: #0ea5e9;
  padding: 7px 10px;
  border-radius: var(--wd-r-inner);
  border: 1px solid color-mix(in srgb, var(--ctx-tint) 22%, var(--ws-hairline));
  background: color-mix(in srgb, var(--ctx-tint) 7%, var(--ws-card-bg));
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.wd-ctx-tile.sub-due {
  --ctx-tint: #e85d2a;
}

.wd-ctx-tile.cd-next {
  --ctx-tint: #6366f1;
}

@media (hover: hover) {
  .wd-ctx-tile:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--ctx-tint) 46%, transparent);
    background: color-mix(in srgb, var(--ctx-tint) 12%, var(--ws-card-bg));
  }
}

.wd-ctx-tile:active {
  transform: scale(0.98);
}

.wd-ctx-ico {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ctx-tint) 14%, transparent);
  color: var(--ctx-tint);
  display: inline-grid;
  place-items: center;
  flex: none;
}

.wd-ctx-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wd-ctx-badge {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ctx-tint) 14%, transparent);
  color: var(--ctx-tint);
  font-size: 11px;
  font-weight: 760;
}

.wd-ctx-chev {
  flex: none;
  color: var(--ws-ink-muted);
  opacity: 0.72;
}

.tabular {
  font-variant-numeric: tabular-nums;
}

/* Unified Chronological Stream */
.wd-stream {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wd-item-block {
  display: flex;
  flex-direction: column;
}

.wd-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 11px;
  cursor: pointer;
  transition: background-color 130ms ease;
}

.wd-row:hover {
  background: var(--ws-card-subtle);
}

.wd-item-block.done .wd-row-title {
  color: var(--ws-ink-muted);
  text-decoration: line-through;
}

.wd-row-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wd-row-title {
  font-size: 14.5px;
  font-weight: 560;
  line-height: 1.35;
  color: var(--ws-ink);
  word-break: break-word;
}

.wd-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
}

.wd-meta-ico {
  color: var(--ws-ink-muted);
}

.wd-meta-date {
  color: var(--ws-ink-muted);
}

.wd-meta-time {
  color: #e25343;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wd-meta-time.muted {
  color: var(--ws-ink-muted);
  font-weight: 500;
}

.wd-meta-tag {
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 620;
  line-height: 1.45;
}

/* Woday Semantic Status Glyphs */
.wd-glyph {
  width: 19px;
  height: 19px;
  margin-top: 1px;
  padding: 0;
  flex: none;
  border-radius: 6px;
  border: 1.6px solid color-mix(in srgb, var(--ws-ink-muted) 48%, transparent);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 120ms ease, border-color 140ms ease, background-color 140ms ease;
}

.wd-glyph:active {
  transform: scale(0.9);
}

.wd-glyph.ghost {
  opacity: 0.45;
  cursor: default;
}

.wd-glyph.important {
  border-color: #e59b28;
  border-width: 1.85px;
}

.wd-glyph.progress {
  border-radius: 999px;
  border-color: #e25343;
  border-width: 1.7px;
  overflow: hidden;
}

.wd-half {
  width: 52%;
  height: 100%;
  background: var(--ws-ink);
  margin-right: auto;
  border-radius: 999px 0 0 999px;
}

.wd-glyph.done {
  border-radius: 999px;
  border-color: var(--ws-ink);
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.wd-glyph.done svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.wd-event-dot-btn {
  width: 19px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}

.wd-event-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transition: transform 120ms ease;
}

.wd-event-dot-btn:hover .wd-event-dot {
  transform: scale(1.25);
}

/* Inline Attached Note Branch ('Notes stay with meetings') */
.wd-note-branch {
  display: flex;
  align-items: flex-start;
  padding: 0 10px 6px 19px;
  cursor: pointer;
}

.wd-branch-line {
  width: 16px;
  height: 24px;
  border-left: 1.3px solid var(--ws-hairline-strong);
  border-bottom: 1.3px solid var(--ws-hairline-strong);
  border-bottom-left-radius: 8px;
  margin-right: 8px;
  flex: none;
}

.wd-note-card {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: min(380px, 100%);
  padding: 9px 14px 9px 10px;
  border-radius: 14px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  box-shadow: 0 2px 10px rgba(15, 16, 20, 0.035);
  transition:
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.wd-note-branch:hover .wd-note-card {
  border-color: var(--ws-hairline-strong);
  box-shadow: 0 6px 16px rgba(15, 16, 20, 0.07);
  transform: translateY(-1px);
}

.wd-note-ico {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.wd-note-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.wd-note-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wd-note-sub {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.wd-empty-stream {
  padding: 20px 10px;
  color: var(--ws-ink-muted);
  font-size: 13.5px;
}

.wd-empty-stream p {
  margin: 0;
}

.wd-inline-add {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background-color 140ms ease;
}

.wd-inline-add:focus-within {
  background: var(--ws-card-subtle);
}

.wd-inline-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 14px;
  outline: none;
}

.wd-inline-input::placeholder {
  color: var(--ws-ink-muted);
}

.wd-inline-submit {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font: inherit;
  font-size: 12px;
  font-weight: 640;
  cursor: pointer;
}

@media (max-width: 900px) {
  .wd-today-inner {
    padding: 18px 18px 32px;
  }

  .wd-date-strip {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .wd-date-strip .wd-day-cell:nth-child(n + 8) {
    display: none;
  }

  .wd-sum-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .wd-sum-kpi {
    padding: 8px 8px;
    gap: 6px;
  }

  .wd-kpi-ico {
    width: 24px;
    height: 24px;
    border-radius: 7px;
  }

  .wd-kpi-copy {
    flex-direction: column;
    gap: 1px;
  }

  .wd-kpi-num {
    font-size: 16px;
  }

  .wd-kpi-lbl {
    font-size: 10.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wd-sum-kpi,
  .wd-ctx-tile,
  .wd-note-card {
    transition-duration: 0.01ms !important;
  }
}
</style>
