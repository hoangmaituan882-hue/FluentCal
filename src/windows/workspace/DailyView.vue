<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { ISODate, Task } from '@/types';
import { addDays, parts, startOfMonth, weekday, WEEKDAY_SHORT } from '@/lib/date';
import { flexKind } from '@/lib/flex';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { occurrences, type Occurrence } from '@/lib/recur';
import { countdowns } from '@/lib/countdown';
import {
  applyTaskStatus,
  checklistStats,
  effectivePriority,
  effectiveStatus,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  STATUS_META,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { addTask, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, taskList } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { goToday, ui } from '../desk/state';
import DayView from '../desk/DayView.vue';
import GroupSquircle from './GroupSquircle.vue';
import MobileCalicoStage from './MobileCalicoStage.vue';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import { buildWeekStrip } from './workspaceModel';
import { openTaskContextMenu, STATUS_DOT_COLOR } from './workspaceMenus';

const emit = defineEmits<{
  openTask: [taskId: string, date?: ISODate];
  openCountdowns: [];
}>();

const quickTitle = ref('');
const { width: vpWidth, isPhone, isTouch } = useViewport();
const isStackedDaily = computed(() => vpWidth.value < 880);
const mobilePane = ref<'overview' | 'timeline'>('overview');
const paneSwitchRef = ref<HTMLElement>();

const { style: panePillStyle, ready: panePillReady, visible: panePillVisible } = useSlidingIndicator(
  paneSwitchRef,
  '.dp-sw-btn.active',
  [mobilePane, isStackedDaily],
);

function setMobilePane(pane: 'overview' | 'timeline') {
  mobilePane.value = pane;
}

const selectedDate = computed(() => ui.selected || now.value);
const selectedParts = computed(() => parts(selectedDate.value));
const selectedInfo = computed(() => dayInfo(selectedDate.value));
const selectedEyebrow = computed(() => {
  const wd = `周${WEEKDAY_SHORT[weekday(selectedDate.value)]}`;
  const extra = selectedInfo.value.festivals[0] || selectedInfo.value.term || selectedInfo.value.lunarLabel;
  return `${wd} · 农历${selectedInfo.value.lunarLabel}${extra && extra !== selectedInfo.value.lunarLabel ? ` · ${extra}` : ''}`;
});

const weekDays = computed(() => buildWeekStrip(selectedDate.value, doc.settings.calendar.weekStart));

const taskDaysSet = computed(() => {
  const start = weekDays.value[0];
  const end = weekDays.value[weekDays.value.length - 1];
  const days = new Set<ISODate>();
  for (const t of taskList.value) {
    if (t.countdownOnly) continue;
    for (const o of occurrences(t, start, end)) {
      let d = o.start < start ? start : o.start;
      const limit = o.end > end ? end : o.end;
      while (d <= limit) {
        days.add(d);
        d = addDays(d, 1);
      }
    }
  }
  return days;
});

const dayOccurrences = computed<Occurrence[]>(() => {
  const d = selectedDate.value;
  const out: Occurrence[] = [];
  for (const t of taskList.value) {
    if (t.countdownOnly) continue;
    out.push(...occurrences(t, d, d));
  }
  out.sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    const aIp = effectiveStatus(a.task) === 'in_progress' ? 0 : 1;
    const bIp = effectiveStatus(b.task) === 'in_progress' ? 0 : 1;
    if (aIp !== bIp) return aIp - bIp;
    const at = a.task.time ?? '99:99';
    const bt = b.task.time ?? '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.task.order - b.task.order;
  });
  return out;
});

const inProgressTasks = computed<Task[]>(() =>
  taskList.value
    .filter((t) => {
      if (t.countdownOnly || t.done) return false;
      const st = effectiveWorkspaceStatus(t);
      return st === 'in_progress' || st === 'in_review';
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4),
);

const upcomingCountdowns = computed(() =>
  countdowns(
    taskList.value.map((t) => (t.groupId && !doc.groups[t.groupId] ? { ...t, groupId: undefined } : t)),
    now.value,
    doc.settings.calendar.holidayCountdown,
    doc.settings.calendar.countdownMarked,
    doc.settings.calendar.countdownGroups,
    doc.settings.calendar.countdownFestival,
    doc.settings.calendar.countdownTerm,
  ).slice(0, 4),
);

function selectDate(d: ISODate) {
  ui.selected = d;
  ui.cursor = startOfMonth(d);
}

function stepDay(delta: number) {
  selectDate(addDays(selectedDate.value, delta));
}

function groupColorOf(t: Task): string {
  const key = t.color || (t.groupId ? doc.groups[t.groupId]?.color : undefined);
  return key ? taskColor(key, isDark.value).bar : '#9E9990';
}

async function addTodayTask() {
  const title = quickTitle.value.trim();
  if (!title) return;
  quickTitle.value = '';
  await addTask({ title, start: selectedDate.value, end: selectedDate.value });
}

function toggleOcc(occ: Occurrence) {
  void setOccurrenceDone(occ.task, occ.date, !occ.done);
}

function occStatus(occ: Occurrence) {
  return occ.done ? 'done' : effectiveWorkspaceStatus(occ.task);
}

function onOccStatusClick(occ: Occurrence, e: MouseEvent) {
  if (e.shiftKey || occ.task.repeat || flexKind(occ.task)) {
    toggleOcc(occ);
    return;
  }
  const anchor = e.currentTarget as HTMLElement;
  const cur = occStatus(occ);
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
  const at =
    e.clientX || e.clientY
      ? { x: e.clientX, y: e.clientY }
      : ((e.currentTarget as HTMLElement) || { x: 24, y: 24 });
  void openTaskContextMenu(t, at, { date, onOpen: () => emit('openTask', t.id, date) });
}

onMounted(() => {
  ui.activeView = 'day';
});

onBeforeUnmount(() => {
  if (ui.activeView === 'day') ui.activeView = '';
});
</script>

<template>
  <div class="ws-daily" :class="{ stacked: isStackedDaily, phone: isPhone }">
    <!-- Dedicated Calico 3-Detent Split Calendar & Agenda Stage on Phone (< 640px) -->
    <MobileCalicoStage
      v-if="isPhone"
      @open-task="(id) => emit('openTask', id)"
      @open-countdowns="emit('openCountdowns')"
    />

    <template v-else>
    <!-- Folio Daily editorial header + Week Strip -->
    <div class="daily-top">
      <div class="daily-head-row">
        <div>
          <div class="ws-eyebrow">{{ selectedEyebrow }}</div>
          <h1 class="daily-date-title">
            <span>{{ selectedParts[1] }}月{{ selectedParts[2] }}日</span>
            <span class="daily-year">{{ selectedParts[0] }}</span>
          </h1>
        </div>
        <div class="daily-nav-pills">
          <button type="button" class="ws-icon-circle solid" title="前一天" @click="stepDay(-1)">
            <FIcon name="chevronLeft" :size="12" />
          </button>
          <button type="button" class="daily-today-btn" @click="goToday()">今天</button>
          <button type="button" class="ws-icon-circle solid" title="后一天" @click="stepDay(1)">
            <FIcon name="chevronRight" :size="12" />
          </button>
        </div>
      </div>

      <div class="week-strip" role="radiogroup" aria-label="本周日期">
        <button
          v-for="d in weekDays"
          :key="d"
          type="button"
          class="week-day-btn"
          :class="{ active: d === selectedDate, today: d === now }"
          @click="selectDate(d)"
        >
          <span class="wd-name">周{{ WEEKDAY_SHORT[weekday(d)] }}</span>
          <span class="wd-num">{{ parts(d)[2] }}</span>
          <span class="wd-dot" :class="{ on: taskDaysSet.has(d) }" aria-hidden="true" />
        </button>
      </div>

      <div v-if="isStackedDaily" ref="paneSwitchRef" class="dp-pane-switch" role="tablist" aria-label="今日视图切换">
        <span
          v-if="panePillVisible"
          class="ws-slide-pill dp-sw-pill"
          :class="{ 'no-anim': !panePillReady }"
          :style="panePillStyle"
          aria-hidden="true"
        />
        <button
          type="button"
          class="dp-sw-btn"
          :class="{ active: mobilePane === 'overview' }"
          role="tab"
          :aria-selected="mobilePane === 'overview'"
          @click="setMobilePane('overview')"
        >
          今日概览
        </button>
        <button
          type="button"
          class="dp-sw-btn"
          :class="{ active: mobilePane === 'timeline' }"
          role="tab"
          :aria-selected="mobilePane === 'timeline'"
          @click="setMobilePane('timeline')"
        >
          时间轴
        </button>
      </div>
    </div>

    <!-- Split Workspace: Reused DayView Timeline (left) + Focus & Tasks Panel (right) -->
    <div class="daily-grid" :class="{ stacked: isStackedDaily }">
      <div v-if="!isStackedDaily || mobilePane === 'timeline'" class="daily-timeline-card ws-card">
        <DayView />
      </div>

      <div v-if="!isStackedDaily || mobilePane === 'overview'" class="daily-side">
        <section class="ws-card daily-panel">
          <header class="dp-head">
            <h2 class="dp-title">当日待办</h2>
            <span class="dp-count">{{ dayOccurrences.filter((o) => !o.done).length }} 待办</span>
          </header>

          <div v-if="dayOccurrences.length" class="dp-list">
            <div
              v-for="occ in dayOccurrences"
              :key="`${occ.task.id}@${occ.date}`"
              class="dp-item"
              :class="{ done: occ.done }"
              @click="emit('openTask', occ.task.id, occ.date)"
              @contextmenu.prevent="openDayTaskMenu(occ.task, occ.date, $event)"
            >
              <button
                type="button"
                class="dp-glyph-btn"
                :title="`状态：${STATUS_META[occStatus(occ)].label}（Shift+点击快速完成）`"
                @click.stop="onOccStatusClick(occ, $event)"
              >
                <StatusGlyph :status="occStatus(occ)" :size="15" interactive />
              </button>
              <div class="dp-item-body">
                <div class="dp-item-title">{{ occ.task.title }}</div>
                <div class="dp-item-meta">
                  <span v-if="occ.task.time" class="dp-chip">{{ occ.task.time }}</span>
                  <span
                    v-if="!occ.done && (occStatus(occ) === 'in_progress' || occStatus(occ) === 'in_review')"
                    class="dp-chip"
                    :class="occStatus(occ)"
                  >
                    {{ STATUS_META[occStatus(occ)].label }}
                  </span>
                  <span v-if="occ.task.checklist?.length" class="dp-chip">
                    {{ checklistStats(occ.task.checklist).done }}/{{ occ.task.checklist.length }}
                  </span>
                </div>
              </div>
              <div class="dp-item-trail">
                <span
                  v-if="effectivePriority(occ.task) !== 'none'"
                  class="dp-pri-wrap"
                  :title="`优先级：${PRIORITY_META[effectivePriority(occ.task)].label}`"
                >
                  <PriorityGlyph
                    :priority="effectivePriority(occ.task)"
                    :size="13"
                  />
                </span>
                <GroupSquircle
                  v-if="occ.task.groupId && doc.groups[occ.task.groupId]"
                  :name="doc.groups[occ.task.groupId].name"
                  :color-key="doc.groups[occ.task.groupId].color"
                  :icon="doc.groups[occ.task.groupId].icon"
                  :size="17"
                />
                <button
                  v-if="isTouch || isPhone"
                  type="button"
                  class="dp-more-btn"
                  title="更多操作"
                  aria-label="更多操作"
                  @click.stop="openDayTaskMenu(occ.task, occ.date, $event)"
                >
                  <FIcon name="more" :size="13" />
                </button>
              </div>
            </div>
          </div>
          <div v-else class="dp-empty">今天还没有安排任务，直接在下方快速添加，或在左侧时间轴拖拽排程。</div>

          <form class="dp-quick-form" @submit.prevent="addTodayTask">
            <FIcon name="add" :size="12" class="dp-quick-ico" />
            <input
              v-model="quickTitle"
              type="text"
              class="dp-quick-input"
              placeholder="添加当天任务，按回车创建…"
            />
          </form>
        </section>

        <section v-if="inProgressTasks.length" class="ws-card daily-panel">
          <header class="dp-head">
            <h2 class="dp-title">进行中与待复核</h2>
            <span class="dp-count">{{ inProgressTasks.length }}</span>
          </header>
          <div class="dp-list">
            <div
              v-for="t in inProgressTasks"
              :key="t.id"
              class="dp-focus-row"
              @click="emit('openTask', t.id)"
              @contextmenu.prevent="openDayTaskMenu(t, undefined, $event)"
            >
              <div class="dp-focus-top">
                <span class="dp-focus-title-wrap">
                  <StatusGlyph :status="effectiveWorkspaceStatus(t)" :size="13" />
                  <span class="dp-focus-title">{{ t.title }}</span>
                </span>
                <span class="dp-focus-pct">{{ t.progress }}%</span>
              </div>
              <div class="dp-bar">
                <div class="dp-bar-fill" :style="{ width: `${t.progress}%`, background: groupColorOf(t) }" />
              </div>
            </div>
          </div>
        </section>

        <section class="ws-card daily-panel compact">
          <header class="dp-head">
            <h2 class="dp-title">近期倒数日</h2>
            <button
              type="button"
              class="dp-link-btn"
              @click="emit('openCountdowns')"
            >
              管理 / +
            </button>
          </header>
          <div v-if="upcomingCountdowns.length" class="dp-cd-list">
            <div
              v-for="c in upcomingCountdowns"
              :key="c.key"
              class="dp-cd-row"
              @click="c.custom ? emit('openCountdowns') : c.taskId ? emit('openTask', c.taskId, c.date) : selectDate(c.date)"
            >
              <span class="dp-cd-name">{{ c.label }}</span>
              <span class="dp-cd-days">
                {{ c.mode === 'up' ? (c.days === 0 ? '今日起算' : `已 ${c.days} 天`) : c.days === 0 ? '今天' : `${c.days} 天` }}
              </span>
            </div>
          </div>
          <div v-else class="dp-empty">暂无近期倒数日，点击右上角添加自定义倒数或纪念日。</div>
        </section>
      </div>
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
  gap: 12px;
}

.daily-top {
  flex: none;
  padding: 4px 6px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.daily-head-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.daily-date-title {
  margin: 2px 0 0;
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
  color: var(--ws-ink);
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.daily-year {
  font-weight: 400;
  color: var(--ws-ink-muted);
}

.daily-nav-pills {
  display: flex;
  align-items: center;
  gap: 6px;
}

.daily-today-btn {
  height: 30px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
  cursor: pointer;
  transition: background-color 140ms ease, transform 120ms var(--ws-ease-out);
}

.daily-today-btn:hover {
  background: var(--ws-card-hover);
}

.daily-today-btn:active {
  transform: scale(0.97);
}

.week-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  background: var(--ws-sidebar-bg);
  border: 1px solid var(--ws-hairline);
}

.week-day-btn {
  border: 0;
  background: transparent;
  padding: 6px 4px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--ws-ink-secondary);
  transition: background-color 140ms ease, color 140ms ease;
}

.week-day-btn:hover:not(.active) {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.wd-name {
  font-size: 11px;
  font-weight: 500;
}

.wd-num {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 13.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  transition: background-color 180ms var(--ws-ease-out), color 180ms ease, transform 160ms var(--ws-ease-spring);
}

.week-day-btn.today:not(.active) .wd-num {
  box-shadow: inset 0 0 0 1.4px var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.week-day-btn.active .wd-num {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  transform: scale(1.04);
}

.wd-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: transparent;
  transition: background-color 160ms ease;
}

.wd-dot.on {
  background: var(--ws-ink-muted);
}

.week-day-btn.active .wd-dot.on {
  background: var(--ws-ink);
}

.daily-grid {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}

.daily-timeline-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 2px 4px;
}

.daily-timeline-card :deep(.day-head) {
  padding: 6px 12px 4px;
  min-height: 30px;
}

.daily-timeline-card :deep(.day-title) {
  display: none;
}

.daily-timeline-card :deep(.day-head-main) {
  gap: 0;
}

.daily-side {
  width: clamp(280px, 31%, 352px);
  flex: none;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.dp-pane-switch {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border-radius: 12px;
  background: var(--ws-stone-pill);
}

.dp-sw-pill {
  border-radius: 9px;
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.dp-sw-btn {
  position: relative;
  z-index: 1;
  height: 30px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: color 140ms ease;
}

.dp-sw-btn.active {
  color: var(--ws-ink);
  font-weight: 650;
}

.daily-grid.stacked {
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.daily-grid.stacked .daily-timeline-card {
  min-height: 0;
  flex: 1;
}

.daily-grid.stacked .daily-side {
  width: 100%;
  min-height: 0;
  overflow-y: auto;
  flex: 1;
  padding-right: 0;
}

.ws-daily.phone .daily-top {
  padding: 2px 2px 0;
  gap: 8px;
}

.ws-daily.phone .daily-date-title {
  font-size: 24px;
}

.ws-daily.phone .week-strip {
  padding: 4px;
  gap: 3px;
}

.ws-daily.phone .week-day-btn {
  padding: 4px 2px;
}

.ws-daily.phone .daily-grid.stacked .daily-side {
  padding-bottom: calc(92px + env(safe-area-inset-bottom));
}

.ws-daily.phone .daily-grid.stacked .daily-timeline-card {
  margin-bottom: calc(74px + env(safe-area-inset-bottom));
}

.dp-more-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.dp-more-btn:active {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.daily-panel {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dp-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ws-ink);
}

.dp-count {
  font-size: 12px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.dp-link-btn {
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dp-link-btn:hover {
  color: var(--ws-ink);
}

.dp-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dp-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 130ms ease;
}

.dp-item:hover {
  background: var(--ws-card-subtle);
}

.dp-item.done .dp-item-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.dp-item-body {
  flex: 1;
  min-width: 0;
}

.dp-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-ink);
  word-break: break-word;
}

.dp-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.dp-chip {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ws-pill-bg);
  color: var(--ws-ink-secondary);
  font-variant-numeric: tabular-nums;
}

.dp-chip.in_progress {
  background: var(--ws-pill-progress-bg);
  color: var(--ws-pill-progress-ink);
}

.dp-chip.in_review {
  background: var(--ws-pill-review-bg);
  color: var(--ws-pill-review-ink);
}

.dp-glyph-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  margin-top: 1px;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}

.dp-item-trail {
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.dp-focus-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dp-empty {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ws-ink-muted);
  padding: 6px 2px;
}

.dp-quick-form {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border-radius: 10px;
  background: var(--ws-card-subtle);
  border: 1px solid transparent;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.dp-quick-form:focus-within {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline-strong);
}

.dp-quick-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.dp-quick-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 12.5px;
  outline: none;
}

.dp-focus-row {
  padding: 7px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 130ms ease;
}

.dp-focus-row:hover {
  background: var(--ws-card-subtle);
}

.dp-focus-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 5px;
}

.dp-focus-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dp-focus-pct {
  font-variant-numeric: tabular-nums;
  color: var(--ws-ink-secondary);
}

.dp-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--ws-pill-bg);
  overflow: hidden;
}

.dp-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 240ms var(--ws-ease-out);
}

.dp-cd-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dp-cd-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 8px;
  border-radius: 8px;
  font-size: 12.5px;
  cursor: pointer;
}

.dp-cd-row:hover {
  background: var(--ws-card-subtle);
}

.dp-cd-name {
  color: var(--ws-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dp-cd-days {
  color: var(--ws-ink-secondary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex: none;
}
</style>
