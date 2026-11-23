<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { Task, TaskPriority, TaskStatus } from '@/types';
import { addDays, formatFriendly } from '@/lib/date';
import { flexKind, MONTH } from '@/lib/flex';
import {
  applyChecklist,
  applyTaskStatus,
  buildDependencyGraph,
  checklistStats,
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  taskShortCode,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { addTask, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { uid } from '@/lib/uid';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, groupList, taskList } from '@/stores/doc';
import GroupSquircle from './GroupSquircle.vue';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import TaskMobileCard from './TaskMobileCard.vue';
import TokenFilterBar from './TokenFilterBar.vue';
import {
  matchesFilterTokens,
  upsertFilterToken,
  type FilterToken,
} from './filterModel';
import { cancelTaskPreview, hideTaskPreview, showTaskPreview } from './useTaskHoverPreview';
import { classifyTaskBucket, type TaskBucketKey } from './workspaceModel';
import { openTaskContextMenu } from './workspaceMenus';

const GROUP_BY_KEY = 'fluentcal.workspace.tasksGroupBy';
const SHOW_EMPTY_KEY = 'fluentcal.workspace.showEmptyStatuses';

const props = defineProps<{
  searchQuery: string;
  filterGroupId: string;
  scopedGroupId?: string;
}>();

const emit = defineEmits<{
  'update:searchQuery': [q: string];
  openTask: [taskId: string];
}>();

const { isPhone } = useViewport();

const groupBy = ref<'status' | 'time'>(
  (() => {
    try {
      return localStorage.getItem(GROUP_BY_KEY) === 'time' ? 'time' : 'status';
    } catch {
      return 'status';
    }
  })(),
);

const showEmptyStatuses = ref<boolean>(
  (() => {
    try {
      return localStorage.getItem(SHOW_EMPTY_KEY) === '1';
    } catch {
      return false;
    }
  })(),
);

watch(groupBy, (v) => {
  try {
    localStorage.setItem(GROUP_BY_KEY, v);
  } catch {
    /* ignore */
  }
});

watch(showEmptyStatuses, (v) => {
  try {
    localStorage.setItem(SHOW_EMPTY_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
});

const filterTokens = ref<FilterToken[]>(
  !props.scopedGroupId && props.filterGroupId ? upsertFilterToken([], 'group', [props.filterGroupId]) : [],
);

watch(
  () => props.filterGroupId,
  (gid) => {
    if (!props.scopedGroupId && gid) {
      filterTokens.value = upsertFilterToken(filterTokens.value, 'group', [gid]);
    }
  },
);

const expanded = ref<Record<string, 'sub' | 'blocked' | 'blocking' | undefined>>({});
const collapsedSecs = ref<Record<string, boolean>>({});
const draggingTaskId = ref<string | null>(null);
const dragOverSecKey = ref<string | null>(null);
const inlineStepText = ref<Record<string, string>>({});
const composerKey = ref<string | null>(null);
const composerTitle = ref('');

const depGraph = computed(() => buildDependencyGraph(taskList.value));

const filteredTasks = computed(() =>
  taskList.value.filter((t) => {
    if (props.scopedGroupId && t.groupId !== props.scopedGroupId) return false;
    return matchesFilterTokens(t, filterTokens.value, props.searchQuery, depGraph.value, now.value);
  }),
);

interface TaskSection {
  key: string;
  title: string;
  pillClass: string;
  status?: TaskStatus;
  tasks: Task[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const TIME_META: { key: TaskBucketKey; title: string; pillClass: string }[] = [
  { key: 'overdue', title: '已逾期', pillClass: 'overdue' },
  { key: 'today', title: '今天', pillClass: 'in_progress' },
  { key: 'tomorrow', title: '明天', pillClass: 'in_review' },
  { key: 'upcoming', title: '即将到来', pillClass: 'todo' },
  { key: 'anytime', title: '待排期 / 收集箱', pillClass: 'backlog' },
  { key: 'completed', title: '已完成', pillClass: 'done' },
];

const sections = computed<TaskSection[]>(() => {
  const todayIso = now.value;
  if (groupBy.value === 'status') {
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const st of WORKSPACE_STATUS_ORDER) byStatus.set(st, []);
    for (const t of filteredTasks.value) {
      const st = effectiveWorkspaceStatus(t);
      byStatus.get(st)?.push(t);
    }
    const out: TaskSection[] = [];
    for (const st of WORKSPACE_STATUS_ORDER) {
      const list = byStatus.get(st) ?? [];
      if (!list.length && composerKey.value !== st && !showEmptyStatuses.value && !draggingTaskId.value) continue;
      list.sort((a, b) => {
        if (st === 'done') return (b.updatedAt || 0) - (a.updatedAt || 0);
        const pa = PRIORITY_RANK[effectivePriority(a)];
        const pb = PRIORITY_RANK[effectivePriority(b)];
        if (pa !== pb) return pa - pb;
        return a.order - b.order;
      });
      out.push({
        key: st,
        title: STATUS_META[st].label,
        pillClass: st,
        status: st,
        tasks: list,
      });
    }
    return out;
  }

  const byBucket = new Map<TaskBucketKey, Task[]>();
  for (const t of filteredTasks.value) {
    const b = classifyTaskBucket(t, todayIso);
    const arr = byBucket.get(b) ?? [];
    arr.push(t);
    byBucket.set(b, arr);
  }
  const out: TaskSection[] = [];
  for (const meta of TIME_META) {
    const list = byBucket.get(meta.key) ?? [];
    if (!list.length && composerKey.value !== meta.key) continue;
    list.sort((a, b) => {
      if (meta.key === 'completed') return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      const at = a.time ?? '99:99';
      const bt = b.time ?? '99:99';
      if (at !== bt) return at < bt ? -1 : 1;
      return a.order - b.order;
    });
    out.push({
      key: meta.key,
      title: meta.title,
      pillClass: meta.pillClass,
      tasks: list,
    });
  }
  return out;
});

function groupHex(t: Task): string {
  const gColor = t.groupId ? doc.groups[t.groupId]?.color : undefined;
  if (!t.color && !gColor) return '#9E9990';
  return taskColor(t.color || gColor, isDark.value).bar;
}

function dateHint(t: Task): string {
  const flex = flexKind(t);
  if (flex) return flex === MONTH ? '本月' : '待排期';
  if (t.start === t.end) {
    return t.start === now.value ? (t.time ? t.time : '今天') : formatFriendly(t.start, now.value);
  }
  return `${formatFriendly(t.start, now.value)}–${formatFriendly(t.end, now.value)}`;
}

async function openSectionComposer(key: string) {
  collapsedSecs.value[key] = false;
  composerKey.value = key;
  composerTitle.value = '';
  await nextTick();
  const el = document.querySelector<HTMLInputElement>(`[data-sec-input="${key}"]`);
  el?.focus();
}

function toggleSection(key: string) {
  collapsedSecs.value[key] = !collapsedSecs.value[key];
}

function onTaskDragStart(t: Task, e: DragEvent) {
  if (groupBy.value !== 'status' || t.repeat) return;
  draggingTaskId.value = t.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.id);
  }
}

function onTaskDragEnd() {
  draggingTaskId.value = null;
  dragOverSecKey.value = null;
}

function onSecDragOver(key: string, e: DragEvent) {
  if (groupBy.value !== 'status' || !draggingTaskId.value) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dragOverSecKey.value = key;
}

function onSecDragLeave(key: string, e: DragEvent) {
  const host = e.currentTarget as HTMLElement | null;
  if (host && e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
  if (dragOverSecKey.value === key) dragOverSecKey.value = null;
}

function onSecDrop(sec: TaskSection) {
  const id = draggingTaskId.value;
  draggingTaskId.value = null;
  dragOverSecKey.value = null;
  if (!id || groupBy.value !== 'status' || !sec.status) return;
  const t = doc.tasks[id];
  if (!t || t.repeat) return;
  if (effectiveWorkspaceStatus(t) === sec.status) return;
  collapsedSecs.value[sec.key] = false;
  void saveTask(applyTaskStatus(t, sec.status));
}

function cancelComposer() {
  composerKey.value = null;
  composerTitle.value = '';
}

async function submitSectionTask(key: string) {
  const title = composerTitle.value.trim();
  if (!title) {
    cancelComposer();
    return;
  }
  composerTitle.value = '';
  composerKey.value = null;

  const grpToken = filterTokens.value.find((x) => x.field === 'group' && x.op === 'is');
  const defaultGroupId =
    props.scopedGroupId ||
    (grpToken?.values.length === 1 && grpToken.values[0] !== '__ungrouped__' ? grpToken.values[0] : undefined);
  const priToken = filterTokens.value.find((x) => x.field === 'priority' && x.op === 'is');
  const defaultPriority =
    priToken?.values.length === 1 ? (priToken.values[0] as TaskPriority) : undefined;

  const todayIso = now.value;
  if (groupBy.value === 'status') {
    const st = key as TaskStatus;
    await addTask({
      title,
      start: todayIso,
      end: todayIso,
      flex: st === 'backlog' ? 'someday' : undefined,
      status: st === 'todo' ? undefined : st,
      done: st === 'done',
      progress: st === 'done' ? 100 : st === 'in_review' ? 85 : st === 'in_progress' ? 50 : 0,
      groupId: defaultGroupId,
      priority: defaultPriority,
    });
    return;
  }

  const bucket = key as TaskBucketKey;
  const start = bucket === 'tomorrow' ? addDays(todayIso, 1) : todayIso;
  await addTask({
    title,
    start,
    end: start,
    flex: bucket === 'anytime' ? 'someday' : undefined,
    done: bucket === 'completed',
    status: bucket === 'completed' ? 'done' : undefined,
    progress: bucket === 'completed' ? 100 : 0,
    groupId: defaultGroupId,
    priority: defaultPriority,
  });
}

const STATUS_DOT_MAP: Record<TaskStatus, string> = {
  in_review: '#3B82F6',
  in_progress: '#D97706',
  todo: '#8E8A82',
  backlog: '#8B8862',
  done: '#22C55E',
};

function toggleDoneDirect(t: Task) {
  const isDone = effectiveWorkspaceStatus(t) === 'done';
  if (flexKind(t)) {
    const slot = flexKind(t) === MONTH ? `m:${now.value.slice(0, 7)}` : 's:';
    void setOccurrenceDone(t, slot, !isDone);
    return;
  }
  if (t.repeat) {
    void setOccurrenceDone(t, now.value, !isDone);
    return;
  }
  void saveTask(applyTaskStatus(t, isDone ? 'todo' : 'done'));
}

function onStatusClick(t: Task, e: MouseEvent) {
  if (e.shiftKey || t.repeat || flexKind(t)) {
    toggleDoneDirect(t);
    return;
  }
  const anchor = e.currentTarget as HTMLElement;
  const cur = effectiveWorkspaceStatus(t);
  const items: MenuItem[] = WORKSPACE_STATUS_ORDER.map((st) => ({
    key: `st:${st}`,
    label: STATUS_META[st].label,
    colorDot: STATUS_DOT_MAP[st],
    radio: true,
    checked: cur === st,
    action: () => void saveTask(applyTaskStatus(t, st)),
  }));
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openPriorityPicker(t: Task, e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const cur = effectivePriority(t);
  const items: MenuItem[] = PRIORITY_ORDER.map((p) => ({
    key: `pri:${p}`,
    label: PRIORITY_META[p].label,
    colorDot: PRIORITY_META[p].color,
    radio: true,
    checked: cur === p,
    action: () => void saveTask({ ...t, priority: p === 'none' ? undefined : p }),
  }));
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function toggleStar(t: Task) {
  void saveTask({ ...t, starred: !t.starred || undefined });
}

function toggleExpand(taskId: string, kind: 'sub' | 'blocked' | 'blocking') {
  expanded.value[taskId] = expanded.value[taskId] === kind ? undefined : kind;
}

function toggleCheckStep(t: Task, stepId: string) {
  if (!t.checklist) return;
  const updated = t.checklist.map((item) =>
    item.id === stepId ? { ...item, done: !item.done } : item,
  );
  void saveTask(applyChecklist(t, updated));
}

function addInlineCheckStep(t: Task) {
  const raw = (inlineStepText.value[t.id] ?? '').trim();
  if (!raw) return;
  inlineStepText.value[t.id] = '';
  const updated = [...(t.checklist ?? []), { id: uid(), text: raw, done: false }];
  void saveTask(applyChecklist(t, updated));
}

function openTaskDetail(id: string) {
  cancelTaskPreview();
  emit('openTask', id);
}

function openRowMenu(t: Task, e: MouseEvent) {
  cancelTaskPreview();
  const at =
    e.clientX || e.clientY
      ? { x: e.clientX, y: e.clientY }
      : ((e.currentTarget as HTMLElement) || { x: 24, y: 24 });
  void openTaskContextMenu(t, at, { onOpen: () => openTaskDetail(t.id) });
}

function blockedByOf(taskId: string): Task[] {
  return depGraph.value.blockedBy.get(taskId) ?? [];
}

function blockingOf(taskId: string): Task[] {
  return depGraph.value.blocking.get(taskId) ?? [];
}

function setInlineStepDraft(taskId: string, val: string) {
  inlineStepText.value[taskId] = val;
}

function onRelatedHover(t: Task, e: PointerEvent) {
  showTaskPreview(t, e.currentTarget as HTMLElement);
}

function onQueryUpdate(q: string) {
  emit('update:searchQuery', q);
}

function onTokensUpdate(next: FilterToken[]) {
  filterTokens.value = next;
}

function onGroupByUpdate(mode: 'status' | 'time') {
  groupBy.value = mode;
}

function onShowEmptyUpdate(val: boolean) {
  showEmptyStatuses.value = val;
}
</script>

<template>
  <div class="tasks-page">
    <TokenFilterBar
      :tokens="filterTokens"
      :search-query="searchQuery"
      :group-by="groupBy"
      :groups="groupList"
      :hide-group-quick-row="!!scopedGroupId"
      :hide-group-facet="!!scopedGroupId"
      :show-empty-statuses="showEmptyStatuses"
      @update:tokens="onTokensUpdate"
      @update:search-query="onQueryUpdate"
      @update:group-by="onGroupByUpdate"
      @update:show-empty-statuses="onShowEmptyUpdate"
    />

    <div class="tasks-scroll" :class="{ phone: isPhone }">
      <div v-if="sections.length" class="task-sections">
        <section
          v-for="sec in sections"
          :key="sec.key"
          class="task-sec"
          :class="{ 'drag-over': dragOverSecKey === sec.key }"
          @dragover="onSecDragOver(sec.key, $event)"
          @dragleave="onSecDragLeave(sec.key, $event)"
          @drop="onSecDrop(sec)"
        >
          <!-- 1:1 Tegon Pastel Header Pill + Pebble Count + Add Button -->
          <div class="sec-head">
            <button
              type="button"
              class="sec-pill"
              :class="[sec.pillClass, { collapsed: !!collapsedSecs[sec.key] }]"
              :title="collapsedSecs[sec.key] ? '展开分组' : '折叠分组'"
              @click="toggleSection(sec.key)"
            >
              <StatusGlyph v-if="sec.status" :status="sec.status" :size="14" on-pill />
              <span>{{ sec.title }}</span>
              <FIcon name="chevronDown" :size="9" class="sec-chev" />
            </button>
            <span class="sec-pebble">{{ sec.tasks.length }}</span>
            <button
              type="button"
              class="sec-add-btn"
              :title="`新建任务到「${sec.title}」`"
              @click="openSectionComposer(sec.key)"
            >
              <FIcon name="add" :size="12" />
            </button>
          </div>

          <!-- Inline Group Composer -->
          <form
            v-if="composerKey === sec.key"
            class="sec-composer"
            @submit.prevent="submitSectionTask(sec.key)"
          >
            <StatusGlyph :status="sec.status ?? 'todo'" :size="15" />
            <input
              v-model="composerTitle"
              :data-sec-input="sec.key"
              type="text"
              class="sc-input"
              :placeholder="`添加到「${sec.title}」，回车创建，Esc 取消…`"
              @keydown.esc.stop="cancelComposer"
            />
            <button type="submit" class="sc-btn ok" :disabled="!composerTitle.trim()">创建</button>
            <button type="button" class="sc-btn" @click="cancelComposer">取消</button>
          </form>

          <!-- Mobile Dedicated Card Stack -->
          <div v-if="isPhone" v-show="!collapsedSecs[sec.key]" class="sec-mobile-cards">
            <TaskMobileCard
              v-for="t in sec.tasks"
              :key="t.id"
              :task="t"
              :scoped-group-id="scopedGroupId"
              :date-hint-text="dateHint(t)"
              :expanded-kind="expanded[t.id]"
              :blocked-by="blockedByOf(t.id)"
              :blocking="blockingOf(t.id)"
              :inline-step-draft="inlineStepText[t.id] ?? ''"
              @open-task="openTaskDetail"
              @status-click="onStatusClick(t, $event)"
              @priority-click="openPriorityPicker(t, $event)"
              @toggle-star="toggleStar(t)"
              @open-menu="openRowMenu(t, $event)"
              @toggle-expand="toggleExpand(t.id, $event)"
              @toggle-check-step="toggleCheckStep(t, $event)"
              @update:inline-step-draft="setInlineStepDraft(t.id, $event)"
              @add-inline-check-step="addInlineCheckStep(t)"
              @open-related-task="openTaskDetail"
            />
          </div>

          <!-- Desktop / Tablet Task Rows -->
          <div v-else v-show="!collapsedSecs[sec.key]" class="sec-rows">
            <div
              v-for="t in sec.tasks"
              :key="t.id"
              class="task-item"
              :class="{
                done: effectiveWorkspaceStatus(t) === 'done',
                dragging: draggingTaskId === t.id,
              }"
              :draggable="groupBy === 'status' && !t.repeat"
              @dragstart="onTaskDragStart(t, $event)"
              @dragend="onTaskDragEnd"
            >
              <div
                class="task-row"
                @click="openTaskDetail(t.id)"
                @contextmenu.prevent="openRowMenu(t, $event)"
              >
                <button
                  type="button"
                  class="tr-status-btn"
                  title="点击切换状态（Shift+点击快速完成）"
                  @click.stop="onStatusClick(t, $event)"
                >
                  <StatusGlyph :status="effectiveWorkspaceStatus(t)" :size="15" interactive />
                </button>

                <div class="tr-main">
                  <div class="tr-title-line">
                    <span class="tr-title">{{ t.title }}</span>
                    <button
                      type="button"
                      class="tr-star-btn"
                      :class="{ active: !!t.starred }"
                      :title="t.starred ? '取消星标置顶' : '加入星标置顶'"
                      @click.stop="toggleStar(t)"
                    >
                      <FIcon :name="t.starred ? 'starFill' : 'star'" :size="12" />
                    </button>
                  </div>

                  <!-- Inline Expandable Disclosure Pills (Sub-Issues / Blockers) -->
                  <div
                    v-if="
                      t.checklist?.length ||
                      (depGraph.blockedBy.get(t.id)?.length ?? 0) > 0 ||
                      (depGraph.blocking.get(t.id)?.length ?? 0) > 0
                    "
                    class="tr-disclosures"
                    @click.stop
                  >
                    <button
                      v-if="t.checklist?.length"
                      type="button"
                      class="disc-pill"
                      :class="{ open: expanded[t.id] === 'sub' }"
                      @click="toggleExpand(t.id, 'sub')"
                    >
                      <FIcon name="checklist" :size="11" />
                      <span>子步骤 {{ checklistStats(t.checklist).done }}/{{ t.checklist.length }}</span>
                      <FIcon name="chevronDown" :size="9" class="disc-chev" />
                    </button>

                    <button
                      v-if="(depGraph.blockedBy.get(t.id)?.length ?? 0) > 0"
                      type="button"
                      class="disc-pill blocked"
                      :class="{ open: expanded[t.id] === 'blocked' }"
                      @click="toggleExpand(t.id, 'blocked')"
                    >
                      <FIcon name="error" :size="11" class="disc-danger" />
                      <span>被阻塞 {{ depGraph.blockedBy.get(t.id)!.length }}</span>
                      <FIcon name="chevronDown" :size="9" class="disc-chev" />
                    </button>

                    <button
                      v-if="(depGraph.blocking.get(t.id)?.length ?? 0) > 0"
                      type="button"
                      class="disc-pill blocking"
                      :class="{ open: expanded[t.id] === 'blocking' }"
                      @click="toggleExpand(t.id, 'blocking')"
                    >
                      <FIcon name="warning" :size="11" class="disc-warn" />
                      <span>阻塞他人 {{ depGraph.blocking.get(t.id)!.length }}</span>
                      <FIcon name="chevronDown" :size="9" class="disc-chev" />
                    </button>
                  </div>
                </div>

                <!-- Right Metadata Cluster -->
                <div class="tr-right" @click.stop>
                  <button
                    type="button"
                    class="tr-pri-btn"
                    :class="{ ghost: effectivePriority(t) === 'none' }"
                    :title="`优先级：${PRIORITY_META[effectivePriority(t)].label}（点击更改）`"
                    @click="openPriorityPicker(t, $event)"
                  >
                    <PriorityGlyph :priority="effectivePriority(t)" :size="14" />
                  </button>

                  <span
                    v-if="!scopedGroupId && t.groupId && doc.groups[t.groupId]"
                    class="tr-group-pill"
                    @click="openTaskDetail(t.id)"
                  >
                    <i class="tg-dot" :style="{ background: groupHex(t) }" />
                    <span>{{ doc.groups[t.groupId].name }}</span>
                  </span>

                  <span class="tr-code">{{ taskShortCode(t) }}</span>

                  <span class="tr-date">{{ dateHint(t) }}</span>

                  <GroupSquircle
                    v-if="!scopedGroupId && t.groupId && doc.groups[t.groupId]"
                    :name="doc.groups[t.groupId].name"
                    :color-key="doc.groups[t.groupId].color"
                    :icon="doc.groups[t.groupId].icon"
                    :size="19"
                  />
                </div>
              </div>

              <!-- Expanded Inline Checklist Sub-Issues -->
              <div v-if="expanded[t.id] === 'sub' && t.checklist?.length" class="tr-expanded">
                <div
                  v-for="step in t.checklist"
                  :key="step.id"
                  class="exp-row"
                  :class="{ done: step.done }"
                >
                  <button
                    type="button"
                    class="ws-check-circle exp-chk"
                    :class="{ done: step.done }"
                    @click="toggleCheckStep(t, step.id)"
                  >
                    <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
                  </button>
                  <span class="exp-title">{{ step.text }}</span>
                </div>
                <form class="exp-add" @submit.prevent="addInlineCheckStep(t)">
                  <FIcon name="add" :size="11" class="exp-add-ico" />
                  <input
                    v-model="inlineStepText[t.id]"
                    type="text"
                    class="exp-add-input"
                    placeholder="添加子步骤，回车确认…"
                  />
                </form>
              </div>

              <!-- Expanded Inline Dependency Rows (with Hover Preview Card!) -->
              <div
                v-else-if="expanded[t.id] === 'blocked' && depGraph.blockedBy.get(t.id)?.length"
                class="tr-expanded"
              >
                <div
                  v-for="pred in depGraph.blockedBy.get(t.id)"
                  :key="pred.id"
                  class="exp-row clickable"
                  @pointerenter="onRelatedHover(pred, $event)"
                  @pointerleave="hideTaskPreview"
                  @click="openTaskDetail(pred.id)"
                >
                  <StatusGlyph :status="effectiveWorkspaceStatus(pred)" :size="13" />
                  <span class="exp-code">{{ taskShortCode(pred) }}</span>
                  <span class="exp-title">{{ pred.title }}</span>
                  <span class="exp-hint">前置阻塞</span>
                </div>
              </div>

              <div
                v-else-if="expanded[t.id] === 'blocking' && depGraph.blocking.get(t.id)?.length"
                class="tr-expanded"
              >
                <div
                  v-for="succ in depGraph.blocking.get(t.id)"
                  :key="succ.id"
                  class="exp-row clickable"
                  @pointerenter="onRelatedHover(succ, $event)"
                  @pointerleave="hideTaskPreview"
                  @click="openTaskDetail(succ.id)"
                >
                  <StatusGlyph :status="effectiveWorkspaceStatus(succ)" :size="13" />
                  <span class="exp-code">{{ taskShortCode(succ) }}</span>
                  <span class="exp-title">{{ succ.title }}</span>
                  <span class="exp-hint">等待此项</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="tasks-empty">
        <div class="es-title">当前筛选条件没有匹配的任务</div>
        <div class="es-sub">可以在顶部尝试调整条件药丸，或点击各状态分组上的 + 快速新建任务。</div>
        <button type="button" class="ws-cta-btn es-btn" @click="openSectionComposer(groupBy === 'status' ? 'todo' : 'today')">
          <FIcon name="add" :size="13" />
          <span>新建第一条待办</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tasks-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tasks-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  padding-bottom: 28px;
}

.task-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-sec {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 12px;
  transition: background-color 130ms ease, box-shadow 130ms ease;
}

.task-sec.drag-over {
  background: rgba(59, 130, 246, 0.06);
  box-shadow: inset 0 0 0 1.5px rgba(59, 130, 246, 0.35);
}

/* 1:1 Tegon Section Pill Header + Pebble + Add */
.sec-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 2px 4px;
}

.sec-pill {
  height: 25px;
  padding: 0 9px 0 8px;
  border: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: opacity 120ms ease, filter 120ms ease;
}

.sec-pill:hover {
  filter: brightness(0.96);
}

.sec-chev {
  opacity: 0.7;
  transition: transform 160ms var(--ws-ease-out);
}

.sec-pill.collapsed {
  opacity: 0.8;
}

.sec-pill.collapsed .sec-chev {
  transform: rotate(-90deg);
}

.sec-pill.in_review {
  background: var(--ws-pill-review-bg);
  color: var(--ws-pill-review-ink);
}

.sec-pill.in_progress {
  background: var(--ws-pill-progress-bg);
  color: var(--ws-pill-progress-ink);
}

.sec-pill.todo {
  background: var(--ws-pill-todo-bg);
  color: var(--ws-pill-todo-ink);
}

.sec-pill.backlog {
  background: var(--ws-pill-backlog-bg);
  color: var(--ws-pill-backlog-ink);
}

.sec-pill.done {
  background: var(--ws-pill-done-bg);
  color: var(--ws-pill-done-ink);
}

.sec-pill.overdue {
  background: var(--ws-pill-overdue-bg);
  color: var(--ws-pill-overdue-ink);
}

.sec-pebble {
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sec-add-btn {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.sec-add-btn:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

/* Inline Composer inside Section */
.sec-composer {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 10px;
  margin-bottom: 4px;
  border-radius: 9px;
  background: var(--ws-card-subtle);
  border: 1px solid #60A5FA;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.sc-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.sc-btn {
  height: 24px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
}

.sc-btn.ok {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sc-btn.ok:disabled {
  opacity: 0.4;
  cursor: default;
}

.sec-rows {
  display: flex;
  flex-direction: column;
}

.task-item {
  border-bottom: 1px solid var(--ws-hairline);
  transition: opacity 140ms ease;
}

.task-item.dragging {
  opacity: 0.45;
}

.task-item:last-child {
  border-bottom: 0;
}

.task-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 110ms ease;
}

.task-row:hover {
  background: var(--ws-card-hover);
}

.task-item.done .tr-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.tr-status-btn {
  border: 0;
  background: transparent;
  padding: 2px 0 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
  transition: transform 110ms ease;
}

.tr-status-btn:hover {
  transform: scale(1.12);
}

.tr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tr-title-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.tr-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ws-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tr-star-btn {
  border: 0;
  background: transparent;
  padding: 2px;
  color: var(--ws-ink-muted);
  display: inline-flex;
  opacity: 0;
  cursor: pointer;
  flex: none;
  transition: opacity 120ms ease, color 120ms ease, transform 120ms ease;
}

.task-row:hover .tr-star-btn,
.tr-star-btn.active {
  opacity: 1;
}

.tr-star-btn.active {
  color: #F59E0B;
}

.tr-star-btn:hover {
  transform: scale(1.15);
}

/* Inline Expandable Disclosure Pills */
.tr-disclosures {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.disc-pill {
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.disc-pill:hover,
.disc-pill.open {
  background: var(--ws-stone-pill);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.disc-chev {
  transition: transform 150ms ease;
}

.disc-pill.open .disc-chev {
  transform: rotate(180deg);
}

.disc-danger {
  color: #E5484D;
}

.disc-warn {
  color: #D97706;
}

/* Right Metadata Cluster */
.tr-right {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  flex: none;
  padding-top: 1px;
}

.tr-pri-btn {
  border: 0;
  background: transparent;
  padding: 2px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.tr-pri-btn.ghost {
  opacity: 0;
}

.task-row:hover .tr-pri-btn.ghost {
  opacity: 0.55;
}

.tr-pri-btn:hover {
  background: var(--ws-stone-pill);
  opacity: 1 !important;
}

.tr-code {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tr-group-pill {
  height: 22px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  max-width: 116px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.tr-date {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Expanded Sub-Issues / Dependency Tree */
.tr-expanded {
  margin: 0 8px 8px 34px;
  padding: 4px 0 4px 12px;
  border-left: 1.5px solid var(--ws-hairline-strong);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.exp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 2px 8px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--ws-ink);
}

.exp-row.clickable {
  cursor: pointer;
}

.exp-row.clickable:hover {
  background: var(--ws-card-subtle);
}

.exp-row.done .exp-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.exp-chk {
  width: 15px;
  height: 15px;
}

.exp-code {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--ws-ink-muted);
  flex: none;
}

.exp-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exp-hint {
  font-size: 11px;
  color: var(--ws-ink-muted);
  flex: none;
}

.exp-add {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 8px;
}

.exp-add-ico {
  color: var(--ws-ink-muted);
}

.exp-add-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.tasks-empty {
  margin: 36px auto;
  max-width: 360px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.es-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ws-ink);
}

.es-sub {
  font-size: 12.5px;
  color: var(--ws-ink-muted);
}

.es-btn {
  margin-top: 4px;
  height: 32px;
  font-size: 12.5px;
}

.tasks-scroll.phone {
  padding-right: 0;
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
}

.tasks-scroll.phone .task-sections {
  gap: 18px;
}

.tasks-scroll.phone .task-sec {
  padding: 0;
  gap: 8px;
}

.sec-mobile-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 760px) {
  .tr-code {
    display: none;
  }
}

@media (hover: none) {
  .tr-star-btn,
  .tr-pri-btn.ghost {
    opacity: 0.72;
  }
}
</style>
