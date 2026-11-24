<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FGroupIcon, FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { Task, TaskStatus } from '@/types';
import { call } from '@/api';
import { flexKind, MONTH } from '@/lib/flex';
import { formatFriendly } from '@/lib/date';
import {
  applyChecklist,
  applyTaskStatus,
  buildDependencyGraph,
  checklistStats,
  effectivePriority,
  effectiveStatus,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { addTask, saveGroup, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, taskList } from '@/stores/doc';
import MonthView from '../desk/MonthView.vue';
import YearMonthPicker from '../desk/YearMonthPicker.vue';
import { goToday, page, ui, viewTitle } from '../desk/state';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import TasksView from './TasksView.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import { cancelTaskPreview, hideTaskPreview, showTaskPreview } from './useTaskHoverPreview';
import { classifyTaskBucket, relativeTimeLabel } from './workspaceModel';
import { buildGroupCustomizeChildren, openTaskContextMenu, STATUS_DOT_COLOR } from './workspaceMenus';

type SubTab = 'overview' | 'tasks' | 'calendar' | 'resources';

const props = defineProps<{
  groupId: string;
  searchQuery: string;
  activeSubTab?: SubTab;
}>();

const emit = defineEmits<{
  openTask: [taskId: string];
  closeTab: [];
  'update:subTab': [tab: SubTab];
  'update:searchQuery': [q: string];
}>();

const subTab = ref<SubTab>(props.activeSubTab ?? 'overview');
watch(
  () => props.activeSubTab,
  (next) => {
    if (next && next !== subTab.value) subTab.value = next;
  },
);
function setSubTab(tab: SubTab) {
  subTab.value = tab;
  emit('update:subTab', tab);
}
function onTasksSearchUpdate(q: string) {
  emit('update:searchQuery', q);
}
function onTasksOpenTask(id: string) {
  emit('openTask', id);
}
const quickTitle = ref('');
const editingName = ref(false);
const nameDraft = ref('');
const nameInputRef = ref<HTMLInputElement>();
const tabsRef = ref<HTMLElement>();
const calTitleRef = ref<HTMLElement | null>(null);
const ymOpen = ref(false);
const nowTick = ref(Date.now());
let relTimer: ReturnType<typeof setInterval> | undefined;

const group = computed(() => doc.groups[props.groupId]);

const { style: tabStyle, ready: tabReady, visible: tabVisible } = useSlidingIndicator(
  tabsRef,
  '.at-btn.active',
  [subTab, () => props.groupId],
  { horizontalOnly: true },
);

onMounted(() => {
  relTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 60_000);
});

// Temporarily scope ui.groupFilter when the Area calendar tab is mounted, restoring on exit.
let savedFilterSnapshot: string[] | null = null;
watch(
  [subTab, () => props.groupId],
  ([tab, gid]) => {
    if (tab !== 'calendar') ymOpen.value = false;
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
  clearInterval(relTimer);
  cancelTaskPreview();
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
      if (t.countdownOnly || t.subscriptionOnly || t.habitOnly || t.groupId !== props.groupId) return false;
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

async function startEditName() {
  if (!group.value) return;
  nameDraft.value = group.value.name;
  editingName.value = true;
  await nextTick();
  nameInputRef.value?.focus();
  nameInputRef.value?.select();
}

async function commitName() {
  if (!editingName.value || !group.value) return;
  editingName.value = false;
  const trimmed = nameDraft.value.trim();
  if (trimmed && trimmed !== group.value.name) {
    await saveGroup({ ...group.value, name: trimmed });
  }
}

const areaPreview = ref<{ icon?: string; iconOverride?: boolean; color?: string } | null>(null);
const displayGroupHex = computed(() =>
  taskColor(areaPreview.value?.color || group.value?.color, isDark.value).bar,
);
const displayGroupIcon = computed(() =>
  areaPreview.value?.iconOverride ? areaPreview.value.icon : group.value?.icon,
);

function pickAppearance(e: MouseEvent) {
  if (!group.value) return;
  const g = group.value;
  const anchor = e.currentTarget as HTMLElement;
  const reset = () => {
    areaPreview.value = null;
  };
  const { iconItems, colorItems } = buildGroupCustomizeChildren(g, {
    onPreviewIcon: (k) => (areaPreview.value = { icon: k, iconOverride: true }),
    onPreviewColor: (c) => (areaPreview.value = { color: c }),
    onResetPreview: reset,
  });
  void showMenu(
    [
      { key: 'icon', label: '分组图标…', children: iconItems },
      { key: 'color', label: '分组颜色…', children: colorItems },
      { separator: true },
      {
        key: 'divider',
        label: g.dividerAfter ? '移除侧栏分隔线' : '在侧栏添加分隔线',
        onHover: reset,
        action: () => void saveGroup({ ...g, dividerAfter: !g.dividerAfter || undefined }),
      },
    ],
    anchor,
    { placement: 'bottom-start', onClose: reset },
  );
}

function openAreaTaskMenu(t: Task, e: MouseEvent) {
  void openTaskContextMenu(t, { x: e.clientX, y: e.clientY }, { onOpen: () => emit('openTask', t.id) });
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

const depGraph = computed(() => buildDependencyGraph(taskList.value));
const expandedSection = ref<Record<string, 'sub' | 'blocked' | null>>({});

function toggleExpand(taskId: string, which: 'sub' | 'blocked') {
  expandedSection.value[taskId] = expandedSection.value[taskId] === which ? null : which;
}

function blockerTasksOf(t: Task): Task[] {
  return depGraph.value.blockedBy.get(t.id) ?? [];
}

function setAreaTaskStatus(t: Task, next: TaskStatus) {
  if (flexKind(t) || t.repeat) {
    const isDone = effectiveWorkspaceStatus(t) === 'done';
    if ((next === 'done') !== isDone) toggleTask(t);
    return;
  }
  void saveTask(applyTaskStatus(t, next));
}

function openStatusPicker(t: Task, e: MouseEvent) {
  const st = effectiveWorkspaceStatus(t);
  const items: MenuItem[] = WORKSPACE_STATUS_ORDER.map((s) => ({
    label: STATUS_META[s].label,
    colorDot: STATUS_DOT_COLOR[s],
    radio: true,
    checked: st === s,
    action: () => setAreaTaskStatus(t, s),
  }));
  void showMenu(items, e.currentTarget as HTMLElement, { placement: 'bottom-start' });
}

function openPriorityPicker(t: Task, e: MouseEvent) {
  const cur = effectivePriority(t);
  const items: MenuItem[] = PRIORITY_ORDER.map((p) => ({
    label: PRIORITY_META[p].label,
    colorDot: PRIORITY_META[p].color,
    radio: true,
    checked: cur === p,
    action: () => void saveTask({ ...t, priority: p === 'none' ? undefined : p }),
  }));
  void showMenu(items, e.currentTarget as HTMLElement, { placement: 'bottom-start' });
}

function toggleStar(t: Task) {
  void saveTask({ ...t, starred: !t.starred || undefined });
}

function toggleSubStep(t: Task, itemId: string) {
  if (!t.checklist) return;
  const next = t.checklist.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item));
  void saveTask(applyChecklist(t, next));
}

function onBlockerEnter(blocker: Task, e: MouseEvent) {
  showTaskPreview(blocker, e.currentTarget as HTMLElement);
}

function openBlockerRow(blocker: Task) {
  cancelTaskPreview();
  emit('openTask', blocker.id);
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
    <div class="area-head ws-container" :class="{ compact: subTab === 'tasks' }">
      <div class="ws-eyebrow">分组空间</div>
      <div class="area-title-row">
        <button
          type="button"
          class="area-color-btn"
          :style="{ color: displayGroupHex }"
          title="更换分组图标与颜色"
          @click="pickAppearance"
        >
          <FGroupIcon :icon="displayGroupIcon" :color="displayGroupHex" :size="15" />
        </button>
        <input
          v-if="editingName"
          ref="nameInputRef"
          v-model="nameDraft"
          type="text"
          class="area-name-input"
          @keydown.enter.prevent="commitName"
          @keydown.esc.stop="editingName = false"
          @blur="commitName"
        />
        <h1 v-else class="ws-page-title area-title" title="点击重命名分组" @click="startEditName">{{ group.name }}</h1>
      </div>
      <p class="ws-page-sub">{{ openTasks.length }} 项待办 · {{ completedTasks.length }} 项已完成 · {{ resourceTasks.length }} 条笔记与资料</p>

      <!-- Folio Underline Sub-tabs -->
      <nav ref="tabsRef" class="area-tabs" role="tablist">
        <span
          v-if="tabVisible"
          class="ws-slide-underline at-underline"
          :class="{ 'no-anim': !tabReady }"
          :style="tabStyle"
          aria-hidden="true"
        />
        <button type="button" class="at-btn" :class="{ active: subTab === 'overview' }" @click="setSubTab('overview')">
          概览
        </button>
        <button type="button" class="at-btn" :class="{ active: subTab === 'tasks' }" @click="setSubTab('tasks')">
          <span>待办</span>
          <span class="at-count">{{ openTasks.length }}</span>
        </button>
        <button type="button" class="at-btn" :class="{ active: subTab === 'calendar' }" @click="setSubTab('calendar')">
          日历
        </button>
        <button type="button" class="at-btn" :class="{ active: subTab === 'resources' }" @click="setSubTab('resources')">
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
            <div
              v-for="t in noteCards"
              :key="t.id"
              class="ws-card ao-note-card"
              @click="emit('openTask', t.id)"
              @contextmenu.prevent="openAreaTaskMenu(t, $event)"
            >
              <div class="anc-top">
                <span class="anc-title">{{ t.title }}</span>
                <span class="anc-time">{{ relativeTimeLabel(t.updatedAt || t.createdAt, nowTick) }}</span>
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
              <div v-for="t in openTasks" :key="t.id" class="ao-task-item">
                <div
                  class="ao-task-row"
                  @click="emit('openTask', t.id)"
                  @contextmenu.prevent="openAreaTaskMenu(t, $event)"
                >
                  <button
                    type="button"
                    class="ao-glyph-btn"
                    :title="STATUS_META[effectiveWorkspaceStatus(t)].label"
                    @click.stop="openStatusPicker(t, $event)"
                  >
                    <StatusGlyph :status="effectiveWorkspaceStatus(t)" :size="15" interactive />
                  </button>
                  <div class="ao-t-main">
                    <span class="ao-t-title">{{ t.title }}</span>
                    <div v-if="t.checklist?.length || blockerTasksOf(t).length" class="ao-disc-row">
                      <button
                        v-if="t.checklist?.length"
                        type="button"
                        class="ao-disc-pill"
                        :class="{ expanded: expandedSection[t.id] === 'sub' }"
                        @click.stop="toggleExpand(t.id, 'sub')"
                      >
                        <span>子步骤 {{ checklistStats(t.checklist).done }}/{{ t.checklist.length }}</span>
                        <FIcon :name="expandedSection[t.id] === 'sub' ? 'chevronDown' : 'chevronRight'" :size="9" />
                      </button>
                      <button
                        v-if="blockerTasksOf(t).length"
                        type="button"
                        class="ao-disc-pill blocked"
                        :class="{ expanded: expandedSection[t.id] === 'blocked' }"
                        @click.stop="toggleExpand(t.id, 'blocked')"
                      >
                        <span class="ao-blk-dot" />
                        <span>被阻塞 {{ blockerTasksOf(t).length }}</span>
                        <FIcon :name="expandedSection[t.id] === 'blocked' ? 'chevronDown' : 'chevronRight'" :size="9" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="ao-prio-btn"
                    :title="PRIORITY_META[effectivePriority(t)].label"
                    @click.stop="openPriorityPicker(t, $event)"
                  >
                    <PriorityGlyph :priority="effectivePriority(t)" :size="13" />
                  </button>
                  <button
                    type="button"
                    class="ao-star-btn"
                    :class="{ active: !!t.starred }"
                    :title="t.starred ? '取消星标置顶' : '加入星标置顶'"
                    @click.stop="toggleStar(t)"
                  >
                    {{ t.starred ? '★' : '☆' }}
                  </button>
                  <span class="ao-t-date">{{ t.flex ? '不定日' : formatFriendly(t.start, now) }}</span>
                </div>

                <div v-if="expandedSection[t.id] === 'sub' && t.checklist?.length" class="ao-exp-tree">
                  <button
                    v-for="item in t.checklist"
                    :key="item.id"
                    type="button"
                    class="ao-exp-row"
                    :class="{ done: item.done }"
                    @click.stop="toggleSubStep(t, item.id)"
                  >
                    <span class="ao-sub-chk" :class="{ checked: item.done }">{{ item.done ? '✓' : '' }}</span>
                    <span class="ao-exp-title">{{ item.text }}</span>
                  </button>
                </div>

                <div v-else-if="expandedSection[t.id] === 'blocked' && blockerTasksOf(t).length" class="ao-exp-tree">
                  <div
                    v-for="b in blockerTasksOf(t)"
                    :key="b.id"
                    class="ao-exp-row"
                    @mouseenter="onBlockerEnter(b, $event)"
                    @mouseleave="hideTaskPreview"
                    @click.stop="openBlockerRow(b)"
                  >
                    <StatusGlyph :status="effectiveWorkspaceStatus(b)" :size="12" />
                    <span class="ao-exp-title">{{ b.title }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="ao-empty-inline">全部完成！</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Group Tasks Tab (Embedded 1:1 Tegon TasksView) -->
    <div v-else-if="subTab === 'tasks'" class="area-tasks-host">
      <TasksView
        :scoped-group-id="group.id"
        :search-query="searchQuery"
        filter-group-id=""
        @update:search-query="onTasksSearchUpdate"
        @open-task="onTasksOpenTask"
      />
    </div>

    <!-- Reused Group-Scoped Month Calendar Tab -->
    <div v-else-if="subTab === 'calendar'" class="area-cal-wrap ws-container">
      <div class="area-cal-bar">
        <button
          ref="calTitleRef"
          type="button"
          class="acb-title-btn"
          title="点击切换年份与月份"
          @click="ymOpen = !ymOpen"
        >
          <span>{{ viewTitle() }}</span>
          <FIcon name="chevronDown" :size="10" />
        </button>
        <YearMonthPicker v-model:open="ymOpen" :anchor="calTitleRef" />
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
        <div
          v-for="t in resourceTasks"
          :key="t.id"
          class="ws-card res-card"
          @click="emit('openTask', t.id)"
          @contextmenu.prevent="openAreaTaskMenu(t, $event)"
        >
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

.area-head.compact {
  padding-top: 2px;
}

.area-head.compact .ws-page-sub {
  margin-top: 2px;
  font-size: 12px;
}

.area-head.compact .area-tabs {
  margin-top: 8px;
}

.area-tasks-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  padding: 6px 8px 0;
  box-sizing: border-box;
  overflow: hidden;
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 14px;
  border-bottom: 1px solid var(--ws-hairline);
}

.at-underline {
  top: auto;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--ws-ink);
}

.at-btn {
  position: relative;
  z-index: 1;
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

.ao-task-item {
  border-bottom: 1px solid var(--ws-hairline);
}

.ao-task-item:last-child {
  border-bottom: 0;
}

.ao-task-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 13px;
  cursor: pointer;
}

.ao-task-row:hover {
  background: var(--ws-card-hover);
}

.ao-task-row.done .ao-t-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.ao-glyph-btn,
.ao-prio-btn,
.ao-star-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
  border-radius: 6px;
}

.ao-glyph-btn {
  width: 22px;
  height: 22px;
}

.ao-prio-btn {
  width: 22px;
  height: 22px;
  opacity: 0.72;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.ao-task-row:hover .ao-prio-btn,
.ao-prio-btn:hover {
  opacity: 1;
  background: var(--ws-stone-pill);
}

.ao-star-btn {
  width: 22px;
  height: 22px;
  font-size: 13px;
  line-height: 1;
  color: var(--ws-ink-muted);
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, background-color 120ms ease;
}

.ao-task-row:hover .ao-star-btn,
.ao-star-btn.active {
  opacity: 1;
}

.ao-star-btn.active {
  color: #D97706;
}

.ao-star-btn:hover {
  background: var(--ws-stone-pill);
}

.ao-t-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ao-t-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ao-disc-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.ao-disc-pill {
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
}

.ao-disc-pill:hover,
.ao-disc-pill.expanded {
  background: var(--ws-stone-pill-hover);
  color: var(--ws-ink);
}

.ao-blk-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #E5484D;
  flex: none;
}

.ao-exp-tree {
  padding: 2px 13px 9px 44px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--ws-card-subtle);
}

.ao-exp-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ao-exp-row:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.ao-exp-row.done .ao-exp-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.ao-sub-chk {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1.5px solid var(--ws-hairline-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: #FFFFFF;
  flex: none;
}

.ao-sub-chk.checked {
  background: #107C10;
  border-color: #107C10;
}

.ao-exp-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ao-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ws-progress-bg);
  color: var(--ws-progress-ink);
  font-weight: 600;
  flex: none;
}

.ao-badge.in_review {
  background: var(--ws-pill-review-bg);
  color: var(--ws-pill-review-ink);
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

.acb-title-btn {
  height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.acb-title-btn:hover {
  background: var(--ws-pill-bg);
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

@media (max-width: 820px) {
  .area-overview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 639px) {
  .area-head {
    padding: 2px 4px 0;
  }

  .area-tabs {
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
    gap: 14px;
    margin-top: 10px;
  }

  .area-tabs::-webkit-scrollbar {
    display: none;
  }

  .at-btn {
    flex: none;
  }

  .area-tasks-host {
    padding: 4px 2px 0;
  }

  .area-cal-wrap {
    padding-bottom: calc(74px + env(safe-area-inset-bottom));
  }
}

@media (hover: none) {
  .ao-star-btn {
    opacity: 0.72;
  }
}
</style>
