<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { ISODate, Task } from '@/types';
import { addDays, parts, startOfMonth, weekday, WEEKDAY_SHORT } from '@/lib/date';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { occurrences, type Occurrence } from '@/lib/recur';
import { countdowns } from '@/lib/countdown';
import { checklistStats, effectiveStatus } from '@/lib/taskMeta';
import { addTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, taskList } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { goToday, openEditor, ui } from '../desk/state';
import DayView from '../desk/DayView.vue';
import { buildWeekStrip } from './workspaceModel';

const emit = defineEmits<{
  openTask: [taskId: string, date?: ISODate];
}>();

const quickTitle = ref('');

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
    .filter((t) => !t.done && effectiveStatus(t) === 'in_progress')
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

onMounted(() => {
  ui.activeView = 'day';
});

onBeforeUnmount(() => {
  if (ui.activeView === 'day') ui.activeView = '';
});
</script>

<template>
  <div class="ws-daily">
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
    </div>

    <!-- Split Workspace: Reused DayView Timeline (left) + Focus & Tasks Panel (right) -->
    <div class="daily-grid">
      <div class="daily-timeline-card ws-card">
        <DayView />
      </div>

      <div class="daily-side">
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
            >
              <button
                type="button"
                class="ws-check-circle"
                :class="{
                  done: occ.done,
                  'in-progress': !occ.done && effectiveStatus(occ.task) === 'in_progress',
                }"
                :title="occ.done ? '标为未完成' : '标为完成'"
                @click.stop="toggleOcc(occ)"
              >
                <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
              </button>
              <div class="dp-item-body">
                <div class="dp-item-title">{{ occ.task.title }}</div>
                <div class="dp-item-meta">
                  <span v-if="occ.task.time" class="dp-chip">{{ occ.task.time }}</span>
                  <span v-if="!occ.done && effectiveStatus(occ.task) === 'in_progress'" class="dp-chip progress">进行中</span>
                  <span v-if="occ.task.checklist?.length" class="dp-chip">
                    {{ checklistStats(occ.task.checklist).done }}/{{ occ.task.checklist.length }}
                  </span>
                </div>
              </div>
              <span class="dp-dot" :style="{ background: groupColorOf(occ.task) }" />
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
            <h2 class="dp-title">正在进行</h2>
            <span class="dp-count">{{ inProgressTasks.length }}</span>
          </header>
          <div class="dp-list">
            <div
              v-for="t in inProgressTasks"
              :key="t.id"
              class="dp-focus-row"
              @click="emit('openTask', t.id)"
            >
              <div class="dp-focus-top">
                <span class="dp-focus-title">{{ t.title }}</span>
                <span class="dp-focus-pct">{{ t.progress }}%</span>
              </div>
              <div class="dp-bar">
                <div class="dp-bar-fill" :style="{ width: `${t.progress}%`, background: groupColorOf(t) }" />
              </div>
            </div>
          </div>
        </section>

        <section v-if="upcomingCountdowns.length" class="ws-card daily-panel compact">
          <header class="dp-head">
            <h2 class="dp-title">近期倒数日</h2>
            <button
              type="button"
              class="dp-link-btn"
              @click="openEditor({ mode: 'new', start: selectedDate })"
            >
              + 详情新建
            </button>
          </header>
          <div class="dp-cd-list">
            <div
              v-for="c in upcomingCountdowns"
              :key="c.key"
              class="dp-cd-row"
              @click="c.taskId ? emit('openTask', c.taskId, c.date) : selectDate(c.date)"
            >
              <span class="dp-cd-name">{{ c.label }}</span>
              <span class="dp-cd-days">{{ c.days === 0 ? '今天' : `${c.days} 天` }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
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

.daily-side {
  width: 344px;
  flex: none;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
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

.dp-chip.progress {
  background: rgba(181, 71, 13, 0.12);
  color: #9A3B08;
}

.dp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 6px;
  flex: none;
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
