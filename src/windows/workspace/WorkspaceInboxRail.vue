<script setup lang="ts">
import { computed, ref } from 'vue';
import { FGroupIcon, FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { ISODate, Task } from '@/types';
import { formatMD, weekday, WEEKDAY_SHORT } from '@/lib/date';
import { flexKind, flexOpen, newFlex, SOMEDAY_SLOT } from '@/lib/flex';
import { effectivePriority, effectiveWorkspaceStatus } from '@/lib/taskMeta';
import { addTask, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, groupList, taskList } from '@/stores/doc';
import { openTaskContextMenu } from './workspaceMenus';
import TaskCheckButton from './TaskCheckButton.vue';
import {
  dropTaskToInbox,
  endTaskDrag,
  getDraggedTaskId,
  hasTaskDragPayload,
  startTaskDrag,
  workspaceDrag,
} from './workspaceDrag';

const props = defineProps<{
  selectedDate: ISODate;
}>();

const emit = defineEmits<{
  openTask: [taskId: string];
  openGroup: [groupId: string];
  collapse: [];
}>();

type RailFilter = 'all' | 'tasks' | 'notes';
const filterKind = ref<RailFilter>('all');
const sortNewest = ref(true);
const quickText = ref('');

const FILTER_LABELS: Record<RailFilter, string> = {
  all: '全部',
  tasks: '待办',
  notes: '含备注',
};

function matchesFilter(t: Task): boolean {
  if (filterKind.value === 'notes') {
    return !!(t.notes?.trim() || t.checklist?.length || t.links?.length);
  }
  return true;
}

const overdueTasks = computed<Task[]>(() => {
  const todayIso = now.value;
  const list = taskList.value.filter(
    (t) =>
      !t.countdownOnly &&
      !t.subscriptionOnly &&
      !flexKind(t) &&
      !t.repeat &&
      !t.done &&
      t.status !== 'done' &&
      t.end < todayIso &&
      matchesFilter(t),
  );
  return list.sort((a, b) => (sortNewest.value ? b.end.localeCompare(a.end) : a.end.localeCompare(b.end)));
});

const inboxTasks = computed<Task[]>(() => {
  const todayIso = now.value;
  const list = taskList.value.filter(
    (t) => !t.countdownOnly && !t.subscriptionOnly && !!flexKind(t) && flexOpen(t, todayIso) && matchesFilter(t),
  );
  return list.sort((a, b) => (sortNewest.value ? b.updatedAt - a.updatedAt : a.title.localeCompare(b.title)));
});

const starredOrGroups = computed(() => groupList.value.slice(0, 5));

function openFilterMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = (['all', 'tasks', 'notes'] as RailFilter[]).map((k) => ({
    label: FILTER_LABELS[k],
    radio: true,
    checked: filterKind.value === k,
    action: () => (filterKind.value = k),
  }));
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

async function addInboxTask() {
  const title = quickText.value.trim();
  if (!title) return;
  quickText.value = '';
  await addTask(newFlex('someday', title, now.value));
}

const completingIds = ref<Set<string>>(new Set());
const dropOverRail = ref(false);

function isVisualDone(t: Task): boolean {
  return !!t.done || t.status === 'done' || completingIds.value.has(t.id);
}

function accentOf(t: Task): string {
  const gColor = t.groupId ? doc.groups[t.groupId]?.color : undefined;
  return taskColor(t.color || gColor, isDark.value).bar;
}

function toggleDone(t: Task) {
  const willDone = !t.done && t.status !== 'done';
  if (willDone) {
    if (completingIds.value.has(t.id)) return;
    const next = new Set(completingIds.value);
    next.add(t.id);
    completingIds.value = next;
    setTimeout(() => {
      if (flexKind(t)) {
        void setOccurrenceDone(t, SOMEDAY_SLOT, true);
      } else {
        void saveTask({ ...t, done: true, status: 'done' });
      }
      const after = new Set(completingIds.value);
      after.delete(t.id);
      completingIds.value = after;
    }, 380);
    return;
  }
  if (flexKind(t)) {
    void setOccurrenceDone(t, SOMEDAY_SLOT, false);
  } else {
    void saveTask({ ...t, done: false, status: 'todo' });
  }
}

function scheduleToSelected(t: Task) {
  const d = props.selectedDate || now.value;
  void saveTask({
    ...t,
    flex: undefined,
    start: d,
    end: d,
  });
}

function onDragStart(e: DragEvent, t: Task) {
  startTaskDrag(t, e, 'inbox-rail');
}

function onRailDragOver(e: DragEvent) {
  if (!hasTaskDragPayload(e) || workspaceDrag.source === 'inbox-rail') return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dropOverRail.value = true;
}

function onRailDrop(e: DragEvent) {
  dropOverRail.value = false;
  if (workspaceDrag.source === 'inbox-rail') return;
  const taskId = getDraggedTaskId(e);
  if (!taskId) return;
  e.preventDefault();
  void dropTaskToInbox(taskId);
}

function onContext(t: Task, e: MouseEvent) {
  void openTaskContextMenu(t, { x: e.clientX, y: e.clientY }, {
    onOpen: () => emit('openTask', t.id),
  });
}

function groupPillStyle(groupId?: string) {
  if (!groupId || !doc.groups[groupId]) return null;
  const g = doc.groups[groupId];
  const hex = taskColor(g.color, isDark.value).bar;
  return {
    name: g.name,
    color: hex,
    bg: `color-mix(in srgb, ${hex} 13%, transparent)`,
  };
}

function shortDateLabel(iso: ISODate): string {
  return `${formatMD(iso)} 周${WEEKDAY_SHORT[weekday(iso)]}`;
}

function glyphVariant(t: Task): 'done' | 'progress' | 'important' | 'regular' {
  if (t.done || t.status === 'done') return 'done';
  const st = effectiveWorkspaceStatus(t);
  if (st === 'in_progress' || st === 'in_review') return 'progress';
  const pri = effectivePriority(t);
  if (pri === 'urgent' || pri === 'high') return 'important';
  return 'regular';
}
</script>

<template>
  <aside
    class="wd-inbox-sheet"
    :class="{ 'drop-active': dropOverRail }"
    aria-label="收集箱伴随栏"
    @dragover="onRailDragOver"
    @dragleave="dropOverRail = false"
    @drop="onRailDrop"
  >
    <!-- Sheet Header -->
    <header class="wir-head">
      <h2 class="wir-title">收集箱</h2>
      <div class="wir-tools">
        <button type="button" class="wir-filter-pill" @click="openFilterMenu">
          <span>{{ FILTER_LABELS[filterKind] }}</span>
          <FIcon name="chevronDown" :size="11" />
        </button>
        <button
          type="button"
          class="wir-ico-btn"
          :title="sortNewest ? '当前：按最新排序（点击切换）' : '当前：按名称/日期排序（点击切换）'"
          aria-label="切换排序"
          @click="sortNewest = !sortNewest"
        >
          <FIcon name="sort" :size="14" />
        </button>
        <button
          type="button"
          class="wir-ico-btn"
          title="收起收集箱栏"
          aria-label="收起收集箱栏"
          @click="emit('collapse')"
        >
          <FIcon name="panelRight" :size="15" />
        </button>
      </div>
    </header>

    <!-- Inline Composer ('◯ New task') -->
    <form class="wir-composer" @submit.prevent="addInboxTask">
      <span class="wd-glyph regular" aria-hidden="true" />
      <input
        v-model="quickText"
        type="text"
        class="wir-input"
        placeholder="新建收集箱待办…"
      />
      <button v-if="quickText.trim()" type="submit" class="wir-add-btn">添加</button>
    </form>

    <!-- Scrollable Sections: Overdue -> Inbox -> Spaces -->
    <div class="wir-body">
      <!-- Overdue Section -->
      <section v-if="overdueTasks.length" class="wir-section">
        <div class="wir-sec-label">已逾期</div>
        <TransitionGroup name="t-list" tag="div" class="wir-list">
          <div
            v-for="t in overdueTasks"
            :key="t.id"
            class="wir-row"
            :class="{ dragging: workspaceDrag.active && workspaceDrag.taskId === t.id, 'is-completing': isVisualDone(t) }"
            draggable="true"
            @dragstart="onDragStart($event, t)"
            @dragend="endTaskDrag"
            @click="emit('openTask', t.id)"
            @contextmenu.prevent="onContext(t, $event)"
          >
            <TaskCheckButton
              :checked="isVisualDone(t)"
              :in-progress="glyphVariant(t) === 'progress'"
              :accent-color="accentOf(t)"
              :size="18"
              @toggle="toggleDone(t)"
            />

            <div class="wir-row-main">
              <div class="wir-row-title">
                <span class="t-strike-text" :class="{ 'is-struck': isVisualDone(t) }">{{ t.title }}</span>
              </div>
              <div class="wir-row-meta">
                <FIcon v-if="t.repeat" name="flame" :size="11" class="wir-meta-ico" />
                <span class="wir-date">{{ shortDateLabel(t.end) }}</span>
                <span v-if="t.time" class="wir-time">{{ t.time }}</span>
                <span
                  v-if="groupPillStyle(t.groupId)"
                  class="wir-tag"
                  :style="{ background: groupPillStyle(t.groupId)!.bg, color: groupPillStyle(t.groupId)!.color }"
                >
                  {{ groupPillStyle(t.groupId)!.name }}
                </span>
              </div>
            </div>

            <button
              type="button"
              class="wir-pull-btn"
              title="排入所选日期"
              @click.stop="scheduleToSelected(t)"
            >
              排入
            </button>
          </div>
        </TransitionGroup>
      </section>

      <!-- Unscheduled Inbox Section -->
      <section class="wir-section">
        <div class="wir-sec-label">收集箱</div>
        <TransitionGroup v-if="inboxTasks.length" name="t-list" tag="div" class="wir-list">
          <div
            v-for="t in inboxTasks"
            :key="t.id"
            class="wir-row"
            :class="{ dragging: workspaceDrag.active && workspaceDrag.taskId === t.id, 'is-completing': isVisualDone(t) }"
            draggable="true"
            @dragstart="onDragStart($event, t)"
            @dragend="endTaskDrag"
            @click="emit('openTask', t.id)"
            @contextmenu.prevent="onContext(t, $event)"
          >
            <TaskCheckButton
              :checked="isVisualDone(t)"
              :in-progress="glyphVariant(t) === 'progress'"
              :accent-color="accentOf(t)"
              :size="18"
              @toggle="toggleDone(t)"
            />

            <div class="wir-row-main">
              <div class="wir-row-title">
                <span class="t-strike-text" :class="{ 'is-struck': isVisualDone(t) }">{{ t.title }}</span>
              </div>
              <div v-if="t.groupId || t.notes?.trim() || t.checklist?.length" class="wir-row-meta">
                <span v-if="t.notes?.trim()" class="wir-note-pill">
                  <FIcon name="note" :size="10" />
                  <span>含备注</span>
                </span>
                <span
                  v-if="groupPillStyle(t.groupId)"
                  class="wir-tag"
                  :style="{ background: groupPillStyle(t.groupId)!.bg, color: groupPillStyle(t.groupId)!.color }"
                >
                  {{ groupPillStyle(t.groupId)!.name }}
                </span>
              </div>
            </div>

            <button
              type="button"
              class="wir-pull-btn"
              title="排入所选日期（或直接拖到左侧今日）"
              @click.stop="scheduleToSelected(t)"
            >
              排入
            </button>
          </div>
        </TransitionGroup>
        <div v-else class="wir-empty">
          收集箱已清空，随时在上方输入灵感或待办，也可直接拖入左侧日程。
        </div>
      </section>

      <!-- Spaces Quick Peek -->
      <section v-if="starredOrGroups.length" class="wir-section">
        <div class="wir-sec-label">项目空间</div>
        <div class="wir-spaces">
          <button
            v-for="g in starredOrGroups"
            :key="g.id"
            type="button"
            class="wir-space-row"
            @click="emit('openGroup', g.id)"
          >
            <span class="wir-sp-ico" :style="{ color: taskColor(g.color, isDark).bar }">
              <FGroupIcon :icon="g.icon || 'page'" :color="taskColor(g.color, isDark).bar" :size="15" />
            </span>
            <span class="wir-sp-name">{{ g.name }}</span>
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.wd-inbox-sheet {
  width: clamp(276px, 28%, 332px);
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  overflow: hidden;
  transition: box-shadow 180ms var(--ease-smooth-out, ease), border-color 180ms ease;
}

.wd-inbox-sheet.drop-active {
  border-color: color-mix(in srgb, #e85d2a 50%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, #e85d2a 13%, transparent);
}

.wir-row.dragging {
  opacity: 0.42;
  transform: scale(0.98);
}

.wir-row.is-completing {
  opacity: 0.6;
}

.wir-head {
  flex: none;
  padding: 18px 16px 10px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wir-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 760;
  letter-spacing: -0.025em;
  color: var(--ws-ink);
}

.wir-tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.wir-filter-pill {
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.wir-filter-pill:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.wir-ico-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.wir-ico-btn:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.wir-composer {
  flex: none;
  margin: 2px 14px 8px;
  padding: 6px 8px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background-color 140ms ease;
}

.wir-composer:focus-within {
  background: var(--ws-card-subtle);
}

.wir-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 13.5px;
  outline: none;
}

.wir-input::placeholder {
  color: var(--ws-ink-muted);
}

.wir-add-btn {
  height: 22px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.wir-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wir-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wir-sec-label {
  padding: 2px 8px 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ws-ink-muted);
}

.wir-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wir-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 10px;
  cursor: grab;
  transition: background-color 130ms ease;
}

.wir-row:active {
  cursor: grabbing;
}

.wir-row:hover {
  background: var(--ws-card-subtle);
}

.wir-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wir-row-title {
  font-size: 13.5px;
  font-weight: 540;
  color: var(--ws-ink);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wir-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.wir-meta-ico {
  color: var(--ws-ink-muted);
}

.wir-date {
  color: var(--ws-ink-muted);
}

.wir-time {
  color: #e25343;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wir-tag {
  padding: 1px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 620;
  line-height: 1.45;
}

.wir-note-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 11px;
}

.wir-pull-btn {
  opacity: 0;
  flex: none;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.wir-row:hover .wir-pull-btn {
  opacity: 1;
}

.wir-pull-btn:hover {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.wir-empty {
  padding: 8px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ws-ink-muted);
}

.wir-spaces {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wir-space-row {
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 9px;
  font: inherit;
  font-size: 13px;
  font-weight: 520;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.wir-space-row:hover {
  background: var(--ws-card-subtle);
}

.wir-sp-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.wir-sp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Woday Semantic Task Status Glyphs */
.wd-glyph {
  width: 18px;
  height: 18px;
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

.wd-glyph.important {
  border-color: #e59b28;
  border-width: 1.8px;
}

.wd-glyph.progress {
  border-radius: 999px;
  border-color: #e25343;
  border-width: 1.7px;
  overflow: hidden;
  position: relative;
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
</style>
