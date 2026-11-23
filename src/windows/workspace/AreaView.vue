<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { FIcon, showMenu, TASK_COLORS, taskColor } from '@/fluent';
import type { Task } from '@/types';
import { call } from '@/api';
import { flexKind, MONTH } from '@/lib/flex';
import { formatFriendly } from '@/lib/date';
import { checklistStats, effectiveStatus } from '@/lib/taskMeta';
import { addTask, saveGroup, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, taskList } from '@/stores/doc';
import MonthView from '../desk/MonthView.vue';
import { goToday, page, ui, viewTitle } from '../desk/state';
import { classifyTaskBucket, relativeTimeLabel } from './workspaceModel';

const props = defineProps<{
  groupId: string;
  searchQuery: string;
}>();

const emit = defineEmits<{
  openTask: [taskId: string];
  closeTab: [];
}>();

type SubTab = 'overview' | 'tasks' | 'calendar' | 'resources';
const subTab = ref<SubTab>('overview');
const quickTitle = ref('');
const showDone = ref(false);
const editingName = ref(false);
const nameDraft = ref('');

const group = computed(() => doc.groups[props.groupId]);

// Temporarily scope ui.groupFilter when the Area calendar tab is mounted, restoring on exit.
let savedFilterSnapshot: string[] | null = null;
watch(
  [subTab, () => props.groupId],
  ([tab, gid]) => {
    if (tab === 'calendar') {
      if (savedFilterSnapshot === null) savedFilterSnapshot = [...ui.groupFilter];
      ui.groupFilter = [gid];
      ui.activeView = 'month';
    } else if (savedFilterSnapshot !== null) {
      ui.groupFilter = savedFilterSnapshot;
      savedFilterSnapshot = null;
      if (ui.activeView === 'month') ui.activeView = '';
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (savedFilterSnapshot !== null) {
    ui.groupFilter = savedFilterSnapshot;
    savedFilterSnapshot = null;
  }
  if (ui.activeView === 'month') ui.activeView = '';
});

const groupTasks = computed(() => {
  const q = props.searchQuery.trim().toLowerCase();
  return taskList.value
    .filter((t) => {
      if (t.groupId !== props.groupId) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.notes?.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

const openTasks = computed(() => groupTasks.value.filter((t) => classifyTaskBucket(t, now.value) !== 'completed'));
const completedTasks = computed(() => groupTasks.value.filter((t) => classifyTaskBucket(t, now.value) === 'completed'));

const noteCards = computed(() =>
  groupTasks.value.filter((t) => !!t.notes?.trim() || !!t.checklist?.length).slice(0, 6),
);

const resourceTasks = computed(() =>
  groupTasks.value.filter((t) => !!t.links?.length || !!t.notes?.trim()),
);

const groupHex = computed(() => taskColor(group.value?.color, isDark.value).bar);

function startEditName() {
  if (!group.value) return;
  nameDraft.value = group.value.name;
  editingName.value = true;
}

async function commitName() {
  if (!editingName.value || !group.value) return;
  editingName.value = false;
  const trimmed = nameDraft.value.trim();
  if (trimmed && trimmed !== group.value.name) {
    await saveGroup({ ...group.value, name: trimmed });
  }
}

function pickColor(e: MouseEvent) {
  if (!group.value) return;
  const g = group.value;
  const anchor = e.currentTarget as HTMLElement;
  void showMenu(
    [
      {
        swatches: TASK_COLORS.map((c) => ({
          key: c.key,
          color: c.bar,
          title: c.label,
          selected: g.color === c.key,
        })),
        onSwatch: (k) => void saveGroup({ ...g, color: k || 'blue' }),
      },
    ],
    anchor,
    { placement: 'bottom-start' },
  );
}

async function addGroupTask() {
  const title = quickTitle.value.trim();
  if (!title) return;
  quickTitle.value = '';
  await addTask({ title, start: now.value, end: now.value, groupId: props.groupId });
}

function toggleTask(t: Task) {
  const isDone = effectiveStatus(t) === 'done';
  const fk = flexKind(t);
  if (fk) {
    const slot = fk === MONTH ? `m:${now.value.slice(0, 7)}` : 's:';
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

function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) {
    void call('open_url', { url });
  } else {
    void navigator.clipboard?.writeText(url);
  }
}
</script>

<template>
  <div v-if="group" class="area-page">
    <div class="area-head ws-container">
      <div class="ws-eyebrow">分组空间</div>
      <div class="area-title-row">
        <button type="button" class="area-color-btn" title="更换分组颜色" @click="pickColor">
          <span class="area-dot" :style="{ background: groupHex }" />
        </button>
        <input
          v-if="editingName"
          v-model="nameDraft"
          type="text"
          class="area-name-input"
          autofocus
          @keydown.enter.prevent="commitName"
          @keydown.esc.stop="editingName = false"
          @blur="commitName"
        />
        <h1 v-else class="ws-page-title area-title" title="点击重命名分组" @click="startEditName">{{ group.name }}</h1>
      </div>
      <p class="ws-page-sub">{{ openTasks.length }} 项待办 · {{ completedTasks.length }} 项已完成 · {{ resourceTasks.length }} 条笔记与资料</p>

      <!-- Folio Underline Sub-tabs -->
      <nav class="area-tabs" role="tablist">
        <button type="button" class="at-btn" :class="{ active: subTab === 'overview' }" @click="subTab = 'overview'">
          概览
        </button>
        <button type="button" class="at-btn" :class="{ active: subTab === 'tasks' }" @click="subTab = 'tasks'">
          <span>待办</span>
          <span class="at-count">{{ openTasks.length }}</span>
        </button>
        <button type="button" class="at-btn" :class="{ active: subTab === 'calendar' }" @click="subTab = 'calendar'">
          日历
        </button>
        <button type="button" class="at-btn" :class="{ active: subTab === 'resources' }" @click="subTab = 'resources'">
          <span>资料</span>
          <span class="at-count">{{ resourceTasks.length }}</span>
        </button>
      </nav>
    </div>

    <!-- Overview split -->
    <div v-if="subTab === 'overview'" class="ws-scroll-page">
      <div class="ws-container area-overview">
        <div class="ao-col">
          <div class="ao-sec-head">近期笔记与进展</div>
          <div v-if="noteCards.length" class="ao-notes-grid">
            <div v-for="t in noteCards" :key="t.id" class="ws-card ao-note-card" @click="emit('openTask', t.id)">
              <div class="anc-top">
                <span class="anc-title">{{ t.title }}</span>
                <span class="anc-time">{{ relativeTimeLabel(t.updatedAt || t.createdAt, Date.now()) }}</span>
              </div>
              <p v-if="t.notes" class="anc-body">{{ t.notes }}</p>
              <div v-if="t.checklist?.length" class="anc-chk">
                <span>清单进度 {{ checklistStats(t.checklist).done }}/{{ t.checklist.length }}</span>
                <div class="anc-bar">
                  <div class="anc-bar-fill" :style="{ width: `${checklistStats(t.checklist).percent}%`, background: groupHex }" />
                </div>
              </div>
            </div>
          </div>
          <div v-else class="ws-card ao-empty">该分组暂时没有带备注或清单的任务，点击右侧任务可补充细节。</div>
        </div>

        <div class="ao-col">
          <div class="ao-sec-head">未完成任务</div>
          <div class="ws-card ao-tasks-card">
            <form class="ao-quick" @submit.prevent="addGroupTask">
              <FIcon name="add" :size="12" class="ao-q-ico" />
              <input v-model="quickTitle" type="text" class="ao-q-input" :placeholder="`添加到「${group.name}」…`" />
            </form>
            <div v-if="openTasks.length" class="ao-task-list">
              <div v-for="t in openTasks" :key="t.id" class="ao-task-row" @click="emit('openTask', t.id)">
                <button
                  type="button"
                  class="ws-check-circle"
                  :class="{ 'in-progress': effectiveStatus(t) === 'in_progress' }"
                  @click.stop="toggleTask(t)"
                >
                  <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
                </button>
                <span class="ao-t-title">{{ t.title }}</span>
                <span class="ao-t-date">{{ t.flex ? '不定日' : formatFriendly(t.start, now) }}</span>
              </div>
            </div>
            <div v-else class="ao-empty-inline">全部完成！</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Group Tasks Tab -->
    <div v-else-if="subTab === 'tasks'" class="ws-scroll-page">
      <div class="ws-container area-tasks-col">
        <form class="ws-card ao-quick" @submit.prevent="addGroupTask">
          <FIcon name="add" :size="12" class="ao-q-ico" />
          <input v-model="quickTitle" type="text" class="ao-q-input" :placeholder="`添加到「${group.name}」并回车创建…`" />
        </form>

        <div v-if="openTasks.length" class="ws-card ao-task-list">
          <div v-for="t in openTasks" :key="t.id" class="ao-task-row" @click="emit('openTask', t.id)">
            <button
              type="button"
              class="ws-check-circle"
              :class="{ 'in-progress': effectiveStatus(t) === 'in_progress' }"
              @click.stop="toggleTask(t)"
            >
              <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
            </button>
            <span class="ao-t-title">{{ t.title }}</span>
            <span v-if="effectiveStatus(t) === 'in_progress'" class="ao-badge">进行中</span>
            <span class="ao-t-date">{{ t.flex ? '不定日' : formatFriendly(t.start, now) }}</span>
          </div>
        </div>

        <div v-if="completedTasks.length" class="ao-done-wrap">
          <button type="button" class="ao-done-toggle" @click="showDone = !showDone">
            <FIcon :name="showDone ? 'chevronDown' : 'chevronRight'" :size="10" />
            <span>已完成 ({{ completedTasks.length }})</span>
          </button>
          <div v-if="showDone" class="ws-card ao-task-list">
            <div v-for="t in completedTasks" :key="t.id" class="ao-task-row done" @click="emit('openTask', t.id)">
              <button type="button" class="ws-check-circle done" @click.stop="toggleTask(t)">
                <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
              </button>
              <span class="ao-t-title">{{ t.title }}</span>
              <span class="ao-t-date">{{ formatFriendly(t.end, now) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Reused Group-Scoped Month Calendar Tab -->
    <div v-else-if="subTab === 'calendar'" class="area-cal-wrap ws-container">
      <div class="area-cal-bar">
        <span class="acb-title">{{ viewTitle() }}</span>
        <div class="acb-btns">
          <button type="button" class="ws-icon-circle solid" @click="page(-1)"><FIcon name="chevronLeft" :size="11" /></button>
          <button type="button" class="acb-today" @click="goToday()">今天</button>
          <button type="button" class="ws-icon-circle solid" @click="page(1)"><FIcon name="chevronRight" :size="11" /></button>
        </div>
      </div>
      <div class="ws-card-frame">
        <MonthView mode="month" />
      </div>
    </div>

    <!-- Resources & Documents Tab -->
    <div v-else class="ws-scroll-page">
      <div class="ws-container res-grid">
        <div v-for="t in resourceTasks" :key="t.id" class="ws-card res-card" @click="emit('openTask', t.id)">
          <div class="res-title">{{ t.title }}</div>
          <p v-if="t.notes" class="res-notes">{{ t.notes }}</p>
          <div v-if="t.links?.length" class="res-links" @click.stop>
            <button
              v-for="lnk in t.links"
              :key="lnk.id"
              type="button"
              class="res-link-pill"
              :title="lnk.url"
              @click="openExternal(lnk.url)"
            >
              <FIcon name="link" :size="11" />
              <span>{{ lnk.title }}</span>
            </button>
          </div>
        </div>
        <div v-if="!resourceTasks.length" class="ws-card ao-empty res-empty">
          该分组暂无关联链接或文档备注，可在任务详情中添加链接或笔记。
        </div>
      </div>
    </div>
  </div>

  <div v-else class="ws-card area-missing">
    <p>该分组已被删除或不存在。</p>
    <button type="button" class="ws-cta-btn" @click="emit('closeTab')">关闭此标签页</button>
  </div>
</template>

<style scoped>
.area-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.area-head {
  flex: none;
  padding: 6px 8px 0;
}

.area-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.area-color-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.area-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}

.area-title {
  margin: 0;
  cursor: text;
}

.area-name-input {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  color: var(--ws-ink);
  border: 0;
  border-bottom: 2px solid var(--ws-ink);
  background: transparent;
  outline: none;
  padding: 0 2px;
}

.area-tabs {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 14px;
  border-bottom: 1px solid var(--ws-hairline);
}

.at-btn {
  position: relative;
  border: 0;
  background: transparent;
  padding: 8px 2px 10px;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13.5px;
  font-weight: 550;
  cursor: pointer;
  transition: color 140ms ease;
}

.at-btn:hover {
  color: var(--ws-ink);
}

.at-btn.active {
  color: var(--ws-ink);
  font-weight: 650;
}

.at-btn.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--ws-ink);
}

.at-count {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.area-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 16px;
  align-items: start;
}

.ao-sec-head {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
  margin-bottom: 8px;
}

.ao-notes-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ao-note-card {
  padding: 13px 15px;
  cursor: pointer;
  transition: border-color 140ms ease, box-shadow 150ms ease;
}

.ao-note-card:hover {
  border-color: var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
}

.anc-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.anc-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ws-ink);
}

.anc-time {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.anc-body {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: var(--ws-ink-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.anc-chk {
  margin-top: 8px;
  font-size: 11px;
  color: var(--ws-ink-muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.anc-bar {
  height: 3px;
  border-radius: 999px;
  background: var(--ws-pill-bg);
  overflow: hidden;
}

.anc-bar-fill {
  height: 100%;
  border-radius: 999px;
}

.ao-tasks-card {
  overflow: hidden;
}

.ao-quick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ws-hairline);
}

.ao-q-ico {
  color: var(--ws-ink-muted);
}

.ao-q-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 13px;
  outline: none;
}

.ao-task-list {
  overflow: hidden;
}

.ao-task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 13px;
  border-bottom: 1px solid var(--ws-hairline);
  cursor: pointer;
}

.ao-task-row:last-child {
  border-bottom: 0;
}

.ao-task-row:hover {
  background: var(--ws-card-hover);
}

.ao-task-row.done .ao-t-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.ao-t-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ao-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(181, 71, 13, 0.12);
  color: #9A3B08;
  font-weight: 600;
}

.ao-t-date {
  font-size: 12px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.ao-empty,
.ao-empty-inline {
  padding: 22px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--ws-ink-muted);
}

.area-tasks-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.area-tasks-col .ao-quick {
  border-bottom: 0;
}

.ao-done-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ao-done-toggle {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.area-cal-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.area-cal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.acb-title {
  font-size: 14px;
  font-weight: 650;
}

.acb-btns {
  display: flex;
  align-items: center;
  gap: 5px;
}

.acb-today {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.res-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.res-card {
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: border-color 140ms ease, box-shadow 150ms ease;
}

.res-card:hover {
  border-color: var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
}

.res-title {
  font-size: 14px;
  font-weight: 600;
}

.res-notes {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ws-ink-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.res-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.res-link-pill {
  height: 26px;
  max-width: 100%;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.res-link-pill span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.res-link-pill:hover {
  border-color: var(--ws-hairline-strong);
}

.res-empty {
  grid-column: 1 / -1;
}

.area-missing {
  margin: auto;
  padding: 28px 36px;
  text-align: center;
}
</style>
