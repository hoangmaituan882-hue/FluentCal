<script setup lang="ts">
import { computed, ref } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { Task } from '@/types';
import { addDays, formatFriendly } from '@/lib/date';
import { flexKind, MONTH } from '@/lib/flex';
import { checklistStats, effectiveStatus } from '@/lib/taskMeta';
import { addTask, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, groupList, taskList } from '@/stores/doc';
import {
  classifyTaskBucket,
  filterWorkspaceTasks,
  taskCountsByFilter,
  type TaskBucketKey,
  type TaskFilterKind,
} from './workspaceModel';

const props = defineProps<{
  searchQuery: string;
  filterGroupId: string;
}>();

const emit = defineEmits<{
  openTask: [taskId: string];
}>();

const activeFilter = ref<TaskFilterKind>('all');
const quickTitle = ref('');
const quickSchedule = ref<'today' | 'tomorrow' | 'someday'>('today');
const quickGroupId = ref('');

const counts = computed(() => taskCountsByFilter(taskList.value, props.filterGroupId, now.value));

const filterTabs = computed<{ key: TaskFilterKind; label: string; count: number }[]>(() => [
  { key: 'all', label: '全部', count: counts.value.all },
  { key: 'today', label: '今日', count: counts.value.today },
  { key: 'in_progress', label: '进行中', count: counts.value.in_progress },
  { key: 'upcoming', label: '即将到来', count: counts.value.upcoming },
  { key: 'anytime', label: '不定日', count: counts.value.anytime },
  { key: 'completed', label: '已完成', count: counts.value.completed },
]);

const filteredTasks = computed(() =>
  filterWorkspaceTasks(taskList.value, activeFilter.value, props.filterGroupId, props.searchQuery, now.value),
);

interface SectionGroup {
  key: TaskBucketKey;
  title: string;
  tasks: Task[];
}

const SECTION_META: { key: TaskBucketKey; title: string }[] = [
  { key: 'overdue', title: '已逾期' },
  { key: 'today', title: '今天' },
  { key: 'tomorrow', title: '明天' },
  { key: 'upcoming', title: '即将到来' },
  { key: 'anytime', title: '随时 / 不定日' },
  { key: 'completed', title: '已完成' },
];

const sections = computed<SectionGroup[]>(() => {
  const byBucket = new Map<TaskBucketKey, Task[]>();
  const todayIso = now.value;
  for (const t of filteredTasks.value) {
    const b = classifyTaskBucket(t, todayIso);
    const list = byBucket.get(b) ?? [];
    list.push(t);
    byBucket.set(b, list);
  }
  const out: SectionGroup[] = [];
  for (const meta of SECTION_META) {
    const list = byBucket.get(meta.key);
    if (!list?.length) continue;
    list.sort((a, b) => {
      if (meta.key === 'completed') return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      const at = a.time ?? '99:99';
      const bt = b.time ?? '99:99';
      if (at !== bt) return at < bt ? -1 : 1;
      return a.order - b.order;
    });
    out.push({ key: meta.key, title: meta.title, tasks: list });
  }
  return out;
});

const effectiveNewGroup = computed(() => {
  if (quickGroupId.value) return quickGroupId.value;
  if (props.filterGroupId && props.filterGroupId !== '__ungrouped__') return props.filterGroupId;
  return '';
});

const newGroupLabel = computed(() => {
  const id = effectiveNewGroup.value;
  return id ? (doc.groups[id]?.name ?? '无分组') : '无分组';
});

const scheduleLabel = computed(() => {
  if (quickSchedule.value === 'today') return '今天';
  if (quickSchedule.value === 'tomorrow') return '明天';
  return '不定日';
});

function groupHex(t: Task): string {
  const gColor = t.groupId ? doc.groups[t.groupId]?.color : undefined;
  if (!t.color && !gColor) return '#9E9990';
  return taskColor(t.color || gColor, isDark.value).bar;
}

function dateHint(t: Task): string {
  const flex = flexKind(t);
  if (flex) return flex === MONTH ? '本月' : '不定日';
  if (t.start === t.end) {
    return t.start === now.value ? (t.time ? t.time : '今天') : formatFriendly(t.start, now.value);
  }
  return `${formatFriendly(t.start, now.value)} – ${formatFriendly(t.end, now.value)}`;
}

async function submitQuickTask() {
  const title = quickTitle.value.trim();
  if (!title) return;
  quickTitle.value = '';
  const todayIso = now.value;
  const start = quickSchedule.value === 'tomorrow' ? addDays(todayIso, 1) : todayIso;
  await addTask({
    title,
    start,
    end: start,
    flex: quickSchedule.value === 'someday' ? 'someday' : undefined,
    groupId: effectiveNewGroup.value || undefined,
  });
}

function toggleTaskDone(t: Task) {
  const isDone = effectiveStatus(t) === 'done';
  if (flexKind(t)) {
    const slot = flexKind(t) === MONTH ? `m:${now.value.slice(0, 7)}` : 's:';
    void setOccurrenceDone(t, slot, !isDone);
    return;
  }
  if (t.repeat) {
    void setOccurrenceDone(t, now.value, !isDone);
    return;
  }
  void saveTask({
    ...t,
    done: !isDone,
    status: !isDone ? 'done' : undefined,
    progress: !isDone ? 100 : t.progress === 100 ? 0 : t.progress,
  });
}

function openGroupPicker(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '无分组', radio: true, checked: effectiveNewGroup.value === '', action: () => (quickGroupId.value = '') },
    ...groupList.value.map((g) => ({
      label: g.name,
      radio: true,
      checked: effectiveNewGroup.value === g.id,
      action: () => (quickGroupId.value = g.id),
    })),
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function openSchedulePicker(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '今天', radio: true, checked: quickSchedule.value === 'today', action: () => (quickSchedule.value = 'today') },
    { label: '明天', radio: true, checked: quickSchedule.value === 'tomorrow', action: () => (quickSchedule.value = 'tomorrow') },
    { label: '不定日 (收集箱)', radio: true, checked: quickSchedule.value === 'someday', action: () => (quickSchedule.value = 'someday') },
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}
</script>

<template>
  <div class="ws-scroll-page">
    <div class="ws-container tasks-wrap">
      <header class="tasks-header">
        <div>
          <h1 class="ws-page-title">待办清单</h1>
          <p class="ws-page-sub">{{ counts.all }} 项待办 · 今日 {{ counts.today }} 项 · 进行中 {{ counts.in_progress }} 项</p>
        </div>
      </header>

      <!-- Folio Sliding Filter Pills -->
      <div class="filter-pills" role="tablist" aria-label="任务筛选">
        <button
          v-for="tab in filterTabs"
          :key="tab.key"
          type="button"
          class="fp-btn"
          :class="{ active: activeFilter === tab.key }"
          @click="activeFilter = tab.key"
        >
          <span>{{ tab.label }}</span>
          <span class="fp-num">{{ tab.count }}</span>
        </button>
      </div>

      <!-- Inline Quick-Add Composer Card -->
      <form class="ws-card quick-composer" @submit.prevent="submitQuickTask">
        <span class="qc-plus"><FIcon name="add" :size="14" /></span>
        <input
          v-model="quickTitle"
          type="text"
          class="qc-input"
          placeholder="添加新待办并按回车创建…"
        />
        <button type="button" class="qc-chip" @click="openGroupPicker">
          <span>{{ newGroupLabel }}</span>
          <FIcon name="chevronDown" :size="10" />
        </button>
        <button type="button" class="qc-chip" @click="openSchedulePicker">
          <FIcon name="calendar" :size="11" />
          <span>{{ scheduleLabel }}</span>
        </button>
      </form>

      <!-- Grouped chronological sections -->
      <div v-if="sections.length" class="task-sections">
        <section v-for="sec in sections" :key="sec.key" class="task-sec">
          <h2 class="sec-title" :class="{ overdue: sec.key === 'overdue' }">
            <span>{{ sec.title }}</span>
            <span class="sec-count">{{ sec.tasks.length }}</span>
          </h2>
          <div class="ws-card sec-list">
            <div
              v-for="t in sec.tasks"
              :key="t.id"
              class="task-row"
              :class="{ done: effectiveStatus(t) === 'done' }"
              @click="emit('openTask', t.id)"
            >
              <button
                type="button"
                class="ws-check-circle"
                :class="{
                  done: effectiveStatus(t) === 'done',
                  'in-progress': effectiveStatus(t) === 'in_progress',
                }"
                @click.stop="toggleTaskDone(t)"
              >
                <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
              </button>

              <div class="row-main">
                <span class="row-title">{{ t.title }}</span>
                <div class="row-badges">
                  <span v-if="effectiveStatus(t) === 'in_progress'" class="r-badge progress">进行中</span>
                  <span v-if="t.checklist?.length" class="r-badge">
                    <FIcon name="checklist" :size="10" />
                    {{ checklistStats(t.checklist).done }}/{{ t.checklist.length }}
                  </span>
                  <span v-if="t.links?.length" class="r-badge">
                    <FIcon name="link" :size="10" />
                    {{ t.links.length }}
                  </span>
                  <span v-if="t.repeat" class="r-badge">
                    <FIcon name="repeat" :size="10" />
                  </span>
                </div>
              </div>

              <div class="row-right">
                <span class="row-date" :class="{ overdue: sec.key === 'overdue' }">{{ dateHint(t) }}</span>
                <span v-if="t.groupId && doc.groups[t.groupId]" class="row-group">
                  <span class="rg-dot" :style="{ background: groupHex(t) }" />
                  <span>{{ doc.groups[t.groupId].name }}</span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div v-else class="ws-card empty-state">
        <div class="es-title">当前筛选下没有待办</div>
        <div class="es-sub">可以在上方输入框直接添加，或切换筛选标签查看其他安排。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tasks-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 8px;
}

.tasks-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.filter-pills {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fp-btn {
  height: 31px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition:
    background-color 160ms var(--ws-ease-out),
    color 140ms ease,
    border-color 140ms ease,
    transform 120ms var(--ws-ease-out);
}

.fp-btn:hover:not(.active) {
  background: var(--ws-card-hover);
  color: var(--ws-ink);
  border-color: var(--ws-hairline-strong);
}

.fp-btn:active {
  transform: scale(0.97);
}

.fp-btn.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.fp-num {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.72;
}

.quick-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 14px;
  border-radius: 14px;
  transition: border-color 140ms ease, box-shadow 160ms ease;
}

.quick-composer:focus-within {
  border-color: var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
}

.qc-plus {
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
}

.qc-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 13.5px;
  outline: none;
}

.qc-chip {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  flex: none;
  transition: background-color 130ms ease, color 130ms ease;
}

.qc-chip:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.task-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sec-title {
  margin: 0 0 6px 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.sec-title.overdue {
  color: #C42B1C;
}

.sec-count {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.sec-list {
  overflow: hidden;
  border-radius: 14px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--ws-hairline);
  cursor: pointer;
  transition: background-color 120ms ease;
}

.task-row:last-child {
  border-bottom: 0;
}

.task-row:hover {
  background: var(--ws-card-hover);
}

.task-row.done .row-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ws-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-badges {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.r-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.r-badge.progress {
  background: rgba(181, 71, 13, 0.12);
  color: #9A3B08;
  font-weight: 600;
}

.row-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.row-date {
  font-size: 12px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.row-date.overdue {
  color: #C42B1C;
  font-weight: 550;
}

.row-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ws-ink-secondary);
  max-width: 130px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rg-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.empty-state {
  padding: 38px 20px;
  text-align: center;
  border-radius: 16px;
}

.es-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ws-ink);
}

.es-sub {
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--ws-ink-muted);
}
</style>
