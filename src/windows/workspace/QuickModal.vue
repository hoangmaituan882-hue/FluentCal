<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { FGroupIcon, FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { ISODate, RepeatFreq, RepeatRule, TaskPriority, TaskStatus } from '@/types';
import { addDays, formatFriendly, weekday } from '@/lib/date';
import { formatMinToHHMM, parseTimeMin } from '@/lib/dayLayout';
import { parseQuickTaskInput } from '@/lib/quickParse';
import {
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  taskShortCode,
} from '@/lib/taskMeta';
import { addTask } from '@/lib/tasks';
import { uid } from '@/lib/uid';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, groupList, taskList } from '@/stores/doc';
import { notify } from '../desk/state';
import GroupSquircle from './GroupSquircle.vue';
import NumberPop from './NumberPop.vue';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import { buildGroupSelectionMenuItems, STATUS_DOT_COLOR } from './workspaceMenus';
import type { WorkspacePageKind } from './workspaceModel';

const props = defineProps<{
  open: boolean;
  initialMode: 'search' | 'capture';
  defaultGroupId?: string;
}>();

const emit = defineEmits<{
  close: [];
  navigate: [kind: WorkspacePageKind, groupId?: string];
  openTask: [taskId: string];
}>();

const { isPhone, isTouch } = useViewport();

type CaptureKind = 'task' | 'event' | 'habit' | 'batch';
const CAPTURE_MODES: { key: CaptureKind; label: string; icon: string }[] = [
  { key: 'task', label: '待办', icon: 'checklist' },
  { key: 'event', label: '时间块', icon: 'calendar' },
  { key: 'habit', label: '循环习惯', icon: 'flame' },
  { key: 'batch', label: '批量多行', icon: 'layers' },
];

const mode = ref<'search' | 'capture'>('search');
const capKind = ref<CaptureKind>('task');
const switchRef = ref<HTMLElement>();
const capKindRef = ref<HTMLElement>();
const searchInput = ref('');
const searchBoxRef = ref<HTMLInputElement>();
const captureBoxRef = ref<HTMLInputElement>();
const batchBoxRef = ref<HTMLTextAreaElement>();
const titleWrapRef = ref<HTMLElement>();
const selectedIdx = ref(0);

const capTitle = ref('');
const capBatchText = ref('');
const capNote = ref('');
const capLink = ref('');
const capGroupId = ref('');
const capWhen = ref<'today' | 'tomorrow' | 'after' | 'someday' | 'custom'>('today');
const capCustomDate = ref<ISODate>(now.value);
const capTime = ref('09:00');
const capDuration = ref(60);
const capRepeatFreq = ref<RepeatFreq>('daily');
const capRepeatDays = ref<number[]>([1, 2, 3, 4, 5]);
const capStatus = ref<TaskStatus>('todo');
const capPriority = ref<TaskPriority>('none');
const capStarred = ref(false);
const capMoreOpen = ref(false);
const capContinue = ref(false);
const capToggleInit = ref(false);
const capTitleError = ref(false);
const capTitleShaking = ref(false);
let errTimer: ReturnType<typeof setTimeout> | undefined;
let shakeTimer: ReturnType<typeof setTimeout> | undefined;

const { style: swStyle, ready: swReady, visible: swVisible } = useSlidingIndicator(
  switchRef,
  '.qm-sw-btn.active',
  [mode, () => props.open],
);

const { style: ckStyle, ready: ckReady, visible: ckVisible } = useSlidingIndicator(
  capKindRef,
  '.qm-ck-btn.active',
  [capKind, mode, () => props.open],
);

const parsedQuick = computed(() =>
  capKind.value === 'task' ? parseQuickTaskInput(capTitle.value, now.value, groupList.value) : null,
);

const hasParsedTokens = computed(() => {
  const p = parsedQuick.value;
  return !!(p && (p.date || p.time || p.priority || p.groupId));
});

const batchLines = computed(() =>
  capBatchText.value
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.)、\s]+/, '').trim())
    .filter(Boolean),
);

const eventEndLabel = computed(() => {
  const s = parseTimeMin(capTime.value);
  const e = Math.min(24 * 60, s + capDuration.value);
  return `${capTime.value} – ${formatMinToHHMM(e)}`;
});

const DURATION_PRESETS = [
  { min: 30, label: '30m' },
  { min: 60, label: '1h' },
  { min: 90, label: '1.5h' },
  { min: 120, label: '2h' },
  { min: 180, label: '3h' },
];

const HABIT_PRESETS: { freq: RepeatFreq; label: string }[] = [
  { freq: 'daily', label: '每天' },
  { freq: 'workday', label: '工作日' },
  { freq: 'weekly', label: '每周' },
  { freq: 'monthly', label: '每月' },
];

const WD_CHIPS = [
  { wd: 1, label: '一' },
  { wd: 2, label: '二' },
  { wd: 3, label: '三' },
  { wd: 4, label: '四' },
  { wd: 5, label: '五' },
  { wd: 6, label: '六' },
  { wd: 0, label: '日' },
];

function applyStarterTemplate(kind: 'focus' | 'meeting' | 'habit' | 'urgent') {
  if (kind === 'focus') {
    capKind.value = 'event';
    capWhen.value = 'today';
    capTime.value = '10:00';
    capDuration.value = 60;
    capPriority.value = 'high';
    if (!capTitle.value.trim()) capTitle.value = '深度专注工作';
  } else if (kind === 'meeting') {
    capKind.value = 'event';
    capWhen.value = 'today';
    capTime.value = '14:30';
    capDuration.value = 60;
    capPriority.value = 'medium';
    if (!capTitle.value.trim()) capTitle.value = '项目同步会议';
  } else if (kind === 'habit') {
    capKind.value = 'habit';
    capRepeatFreq.value = 'daily';
    capWhen.value = 'today';
    if (!capTitle.value.trim()) capTitle.value = '每日复盘打卡';
  } else if (kind === 'urgent') {
    capKind.value = 'task';
    capWhen.value = 'today';
    capPriority.value = 'urgent';
    capStarred.value = true;
  }
  void nextTick(() => captureBoxRef.value?.focus());
}

function toggleHabitWeekday(wd: number) {
  const cur = capRepeatDays.value;
  if (cur.includes(wd)) {
    if (cur.length > 1) capRepeatDays.value = cur.filter((d) => d !== wd);
  } else {
    capRepeatDays.value = [...cur, wd].sort((a, b) => a - b);
  }
}

function toggleContinueSwitch() {
  capToggleInit.value = true;
  capContinue.value = !capContinue.value;
}

function triggerTitleShake() {
  capTitleError.value = true;
  capTitleShaking.value = false;
  clearTimeout(shakeTimer);
  clearTimeout(errTimer);
  void nextTick(() => {
    if (titleWrapRef.value) void titleWrapRef.value.offsetWidth;
    capTitleShaking.value = true;
    shakeTimer = setTimeout(() => {
      capTitleShaking.value = false;
    }, 300);
    errTimer = setTimeout(() => {
      capTitleError.value = false;
    }, 2400);
  });
}

onBeforeUnmount(() => {
  clearTimeout(errTimer);
  clearTimeout(shakeTimer);
});

watch(
  () => [props.open, props.initialMode] as const,
  async ([isOpen, m]) => {
    if (!isOpen) return;
    mode.value = m;
    capKind.value = 'task';
    searchInput.value = '';
    selectedIdx.value = 0;
    capTitle.value = '';
    capBatchText.value = '';
    capNote.value = '';
    capLink.value = '';
    capGroupId.value = props.defaultGroupId && props.defaultGroupId !== '__ungrouped__' ? props.defaultGroupId : '';
    capWhen.value = 'today';
    capCustomDate.value = now.value;
    capTime.value = '09:00';
    capDuration.value = 60;
    capRepeatFreq.value = 'daily';
    capRepeatDays.value = [weekday(now.value)];
    capStatus.value = 'todo';
    capPriority.value = 'none';
    capStarred.value = false;
    capMoreOpen.value = false;
    capTitleError.value = false;
    capTitleShaking.value = false;
    await nextTick();
    if (m === 'search') searchBoxRef.value?.focus();
    else captureBoxRef.value?.focus();
  },
);

watch([mode, capKind], async ([m, ck]) => {
  if (!props.open) return;
  await nextTick();
  if (m === 'search') searchBoxRef.value?.focus();
  else if (ck === 'batch') batchBoxRef.value?.focus();
  else captureBoxRef.value?.focus();
});

const capGroupLabel = computed(() =>
  capGroupId.value ? (doc.groups[capGroupId.value]?.name ?? '无分组') : '无分组',
);

const capGroupHex = computed(() =>
  capGroupId.value && doc.groups[capGroupId.value]
    ? taskColor(doc.groups[capGroupId.value].color, isDark.value).bar
    : '',
);

function openCapGroupMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items = buildGroupSelectionMenuItems(
    capGroupId.value || undefined,
    (gid) => (capGroupId.value = gid ?? ''),
  );
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

const CAP_STATUS_CHOICES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'backlog'];

function openCapStatusMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = CAP_STATUS_CHOICES.map((st) => ({
    label: STATUS_META[st].label,
    colorDot: STATUS_DOT_COLOR[st],
    radio: true,
    checked: capStatus.value === st,
    action: () => (capStatus.value = st),
  }));
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openCapPriorityMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = PRIORITY_ORDER.map((p) => ({
    label: PRIORITY_META[p].label,
    colorDot: PRIORITY_META[p].color,
    radio: true,
    checked: capPriority.value === p,
    action: () => (capPriority.value = p),
  }));
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function toggleCapStar() {
  capStarred.value = !capStarred.value;
}

interface SearchResult {
  id: string;
  kind: 'nav' | 'group' | 'task' | 'event' | 'create';
  category: string;
  title: string;
  sub?: string;
  icon: string;
  groupIcon?: string;
  groupColorKey?: string;
  taskStatus?: TaskStatus;
  taskPriority?: TaskPriority;
  taskCode?: string;
  page?: WorkspacePageKind;
  groupId?: string;
  taskId?: string;
  createText?: string;
}

function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  if (idx > 0) parts.push({ text: text.slice(0, idx), hit: false });
  parts.push({ text: text.slice(idx, idx + q.length), hit: true });
  if (idx + q.length < text.length) parts.push({ text: text.slice(idx + q.length), hit: false });
  return parts;
}

const searchResults = computed<SearchResult[]>(() => {
  const rawQ = searchInput.value.trim();
  const q = rawQ.toLowerCase();
  const navEntries: SearchResult[] = [
    { id: 'nav:daily', kind: 'nav', category: '视图', title: '今日聚焦', sub: '今日与收集箱', icon: 'today', page: 'daily' },
    { id: 'nav:calendar', kind: 'nav', category: '视图', title: '日历视图', sub: '多日与月历', icon: 'calendar', page: 'calendar' },
    { id: 'nav:inbox', kind: 'nav', category: '视图', title: '收集箱', sub: '不定日与待排期', icon: 'inbox', page: 'inbox' },
    { id: 'nav:tasks', kind: 'nav', category: '视图', title: '待办清单', sub: '列表与看板', icon: 'checklist', page: 'tasks' },
    { id: 'nav:subscriptions', kind: 'nav', category: '视图', title: '订阅日历', sub: '会员与扣费账单', icon: 'subscription', page: 'subscriptions' },
    { id: 'nav:countdowns', kind: 'nav', category: '视图', title: '倒数日', sub: '节假日与纪念日', icon: 'timer', page: 'countdowns' },
    { id: 'nav:gantt', kind: 'nav', category: '视图', title: '项目甘特', sub: '跨天排期', icon: 'gantt', page: 'gantt' },
    { id: 'nav:settings', kind: 'nav', category: '视图', title: '设置', sub: '系统偏好', icon: 'settings', page: 'settings' },
  ];
  const groupEntries: SearchResult[] = groupList.value.map((g) => ({
    id: `grp:${g.id}`,
    kind: 'group',
    category: '空间',
    title: g.name,
    sub: '分组空间',
    icon: 'group',
    groupIcon: g.icon,
    groupColorKey: g.color,
    page: 'area',
    groupId: g.id,
  }));

  const sortedTasks = taskList.value
    .filter((t) => !t.countdownOnly && !t.subscriptionOnly)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const taskEntries: SearchResult[] = [];
  const eventEntries: SearchResult[] = [];
  for (const t of sortedTasks) {
    const isTimed = !!t.time && !t.flex;
    const whenText = t.flex
      ? '收集箱'
      : t.start === now.value
        ? (t.time ? `今天 · ${t.time}` : '今天')
        : t.time
          ? `${t.start.slice(5)} · ${t.time}`
          : t.start.slice(5);
    const entry: SearchResult = {
      id: `tsk:${t.id}`,
      kind: isTimed ? 'event' : 'task',
      category: isTimed ? '日程' : '待办',
      title: t.title,
      sub: whenText,
      icon: isTimed ? 'calendar' : t.done ? 'completed' : 'checkboxEmpty',
      taskStatus: effectiveWorkspaceStatus(t),
      taskPriority: effectivePriority(t),
      taskCode: taskShortCode(t),
      taskId: t.id,
    };
    if (isTimed) eventEntries.push(entry);
    else taskEntries.push(entry);
  }

  if (!q) {
    return [...taskEntries.slice(0, 4), ...eventEntries.slice(0, 3), ...groupEntries.slice(0, 3), ...navEntries.slice(0, 4)];
  }

  const match = (r: SearchResult) =>
    r.title.toLowerCase().includes(q) ||
    r.sub?.toLowerCase().includes(q) ||
    r.taskCode?.toLowerCase().includes(q);

  const matchedTasks = taskEntries.filter(match).slice(0, 5);
  const matchedEvents = eventEntries.filter(match).slice(0, 4);
  const matchedGroups = groupEntries.filter(match).slice(0, 3);
  const matchedNav = navEntries.filter(match).slice(0, 3);

  const createRow: SearchResult = {
    id: 'create:instant',
    kind: 'create',
    category: '快速创建',
    title: `创建 "${rawQ}"…`,
    sub: '回车立即加入今日',
    icon: 'add',
    createText: rawQ,
  };

  return [...matchedTasks, ...matchedEvents, ...matchedGroups, ...matchedNav, createRow];
});

watch(searchResults, () => {
  selectedIdx.value = 0;
});

async function pickResult(r: SearchResult) {
  if (r.kind === 'create' && r.createText) {
    await addTask({
      title: r.createText,
      start: now.value,
      end: now.value,
      groupId: props.defaultGroupId && props.defaultGroupId !== '__ungrouped__' ? props.defaultGroupId : undefined,
    });
    emit('close');
    return;
  }
  if (r.kind === 'task' || r.kind === 'event') {
    if (r.taskId) emit('openTask', r.taskId);
  } else if (r.page) {
    emit('navigate', r.page, r.groupId);
  }
  emit('close');
}

function onSearchKey(e: KeyboardEvent) {
  const list = searchResults.value;
  if (!list.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx.value = (selectedIdx.value + 1) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx.value = (selectedIdx.value - 1 + list.length) % list.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    pickResult(list[selectedIdx.value] ?? list[0]);
  }
}

function resolveStartDate(): ISODate {
  if (capWhen.value === 'tomorrow') return addDays(now.value, 1);
  if (capWhen.value === 'after') return addDays(now.value, 2);
  if (capWhen.value === 'custom' && capCustomDate.value) return capCustomDate.value;
  return now.value;
}

async function saveCapture(keepOpenOverride?: boolean) {
  const keepOpen = keepOpenOverride ?? capContinue.value;

  if (capKind.value === 'batch') {
    const items = batchLines.value;
    if (!items.length) {
      triggerTitleShake();
      return;
    }
    const start = resolveStartDate();
    const isSomeday = capWhen.value === 'someday' || capStatus.value === 'backlog';
    for (const line of items) {
      const parsed = parseQuickTaskInput(line, now.value, groupList.value);
      const d = parsed.date ?? start;
      await addTask({
        title: parsed.cleanTitle,
        start: d,
        end: d,
        time: parsed.time,
        duration: parsed.time ? 60 : undefined,
        flex: !parsed.date && isSomeday ? 'someday' : undefined,
        status: capStatus.value === 'todo' ? undefined : capStatus.value,
        priority: parsed.priority ?? (capPriority.value === 'none' ? undefined : capPriority.value),
        starred: capStarred.value || undefined,
        groupId: parsed.groupId ?? (capGroupId.value || undefined),
      });
    }
    notify(`已批量创建 ${items.length} 条事项`, true);
    if (keepOpen) {
      capBatchText.value = '';
      await nextTick();
      batchBoxRef.value?.focus();
    } else {
      emit('close');
    }
    return;
  }

  const rawTitle = capTitle.value.trim();
  if (!rawTitle) {
    triggerTitleShake();
    return;
  }

  const parsed = capKind.value === 'task' ? parseQuickTaskInput(rawTitle, now.value, groupList.value) : null;
  const finalTitle = parsed?.cleanTitle || rawTitle;
  const start = parsed?.date ?? resolveStartDate();
  const link = capLink.value.trim();
  const isSomeday =
    capKind.value === 'task' && !parsed?.date && (capWhen.value === 'someday' || capStatus.value === 'backlog');

  let repeat: RepeatRule | undefined;
  if (capKind.value === 'habit') {
    repeat =
      capRepeatFreq.value === 'weekly'
        ? { freq: 'weekly', weekdays: capRepeatDays.value.length ? [...capRepeatDays.value] : [weekday(start)] }
        : { freq: capRepeatFreq.value };
  }

  const time =
    capKind.value === 'event'
      ? capTime.value || '09:00'
      : parsed?.time || (capKind.value === 'habit' && capTime.value ? capTime.value : undefined);

  const duration = capKind.value === 'event' ? capDuration.value : time ? 60 : undefined;

  await addTask({
    title: finalTitle,
    notes: capNote.value.trim() || undefined,
    start,
    end: start,
    time,
    duration,
    repeat,
    flex: isSomeday ? 'someday' : undefined,
    status: capStatus.value === 'todo' ? undefined : capStatus.value,
    priority: parsed?.priority ?? (capPriority.value === 'none' ? undefined : capPriority.value),
    starred: capStarred.value || undefined,
    progress: capStatus.value === 'in_review' ? 85 : capStatus.value === 'in_progress' ? 50 : 0,
    groupId: parsed?.groupId ?? (capGroupId.value || undefined),
    links: link ? [{ id: uid(), title: link.replace(/^https?:\/\//, '').split('/')[0] || link, url: link }] : undefined,
  });

  if (keepOpen) {
    notify(`已创建「${finalTitle}」，可继续添加`, true);
    capTitle.value = '';
    capNote.value = '';
    capLink.value = '';
    await nextTick();
    captureBoxRef.value?.focus();
  } else {
    emit('close');
  }
}
</script>

<template>
  <Transition name="ws-modal">
    <div
      v-if="open"
      class="ws-modal-backdrop"
      :class="{ phone: isPhone }"
      role="dialog"
      aria-modal="true"
      @mousedown.self="emit('close')"
    >
      <div class="ws-modal-card" :class="{ phone: isPhone }">
        <div v-if="isPhone" class="qm-grab" aria-hidden="true" />
        <div class="qm-head">
          <div ref="switchRef" class="qm-switch" role="tablist">
            <span
              v-if="swVisible"
              class="ws-slide-pill qm-sw-pill"
              :class="{ 'no-anim': !swReady }"
              :style="swStyle"
              aria-hidden="true"
            />
            <button
              type="button"
              class="qm-sw-btn"
              :class="{ active: mode === 'search' }"
              @click="mode = 'search'"
            >
              搜索与跳转
            </button>
            <button
              type="button"
              class="qm-sw-btn"
              :class="{ active: mode === 'capture' }"
              @click="mode = 'capture'"
            >
              快速新建
            </button>
          </div>
          <button type="button" class="ws-icon-circle" title="关闭 (Esc)" @click="emit('close')">
            <FIcon name="close" :size="12" />
          </button>
        </div>

        <!-- Command Search Mode -->
        <div v-if="mode === 'search'" class="qm-search-body">
          <div class="qm-search-bar">
            <FIcon name="search" :size="14" class="qm-ico" />
            <input
              ref="searchBoxRef"
              v-model="searchInput"
              type="text"
              class="qm-search-input"
              placeholder="搜索任务、分组或跳转视图…"
              @keydown="onSearchKey"
            />
          </div>
          <div class="qm-results">
            <template v-for="(r, i) in searchResults" :key="r.id">
              <div
                v-if="i === 0 || searchResults[i - 1]?.category !== r.category"
                class="qm-cat-label"
              >
                {{ r.category }}
              </div>
              <button
                type="button"
                class="qm-res-row"
                :class="{ active: selectedIdx === i, create: r.kind === 'create' }"
                @mouseenter="selectedIdx = i"
                @click="pickResult(r)"
              >
                <GroupSquircle v-if="r.kind === 'group'" :name="r.title" :color-key="r.groupColorKey" :icon="r.groupIcon" :size="16" />
                <span v-else-if="r.kind === 'event'" class="qm-event-dot" aria-hidden="true" />
                <StatusGlyph v-else-if="r.kind === 'task' && r.taskStatus" :status="r.taskStatus" :size="14" />
                <FIcon v-else :name="r.icon" :size="14" class="qm-r-ico" />
                <span class="qm-r-title">
                  <template v-for="(seg, si) in highlightParts(r.title, searchInput)" :key="si">
                    <mark v-if="seg.hit" class="qm-hit">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
                <PriorityGlyph v-if="r.taskPriority && r.taskPriority !== 'none'" :priority="r.taskPriority" :size="12" />
                <span v-if="r.sub" class="qm-r-sub">{{ r.sub }}</span>
              </button>
            </template>
            <div v-if="!searchResults.length" class="qm-empty">没有找到匹配的任务或视图</div>
          </div>
          <div v-if="!isPhone && !isTouch" class="qm-hint-bar">
            <span><kbd>↑↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 打开 / 跳转</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </div>
        </div>

        <!-- Multi-Mode Task Creation Studio -->
        <form
          v-else
          class="qm-cap-body"
          @submit.prevent="saveCapture()"
          @keydown.ctrl.enter.prevent="saveCapture(true)"
        >
          <!-- 4-Mode Sliding Tab Switcher (transitions.dev 16-tabs-sliding) -->
          <div class="qm-mode-bar">
            <div ref="capKindRef" class="qm-ck-tabs" role="tablist" aria-label="创建方式">
              <span
                v-if="ckVisible"
                class="ws-slide-pill qm-ck-pill"
                :class="{ 'no-anim': !ckReady }"
                :style="ckStyle"
                aria-hidden="true"
              />
              <button
                v-for="cm in CAPTURE_MODES"
                :key="cm.key"
                type="button"
                role="tab"
                :aria-selected="capKind === cm.key"
                class="qm-ck-btn"
                :class="{ active: capKind === cm.key }"
                @click="capKind = cm.key"
              >
                <FIcon :name="cm.icon" :size="12" />
                <span>{{ cm.label }}</span>
              </button>
            </div>
          </div>

          <!-- Quick Starter Templates Strip -->
          <div class="qm-tpl-strip">
            <button type="button" class="qm-tpl-chip" @click="applyStarterTemplate('focus')">⚡ 专注 1h</button>
            <button type="button" class="qm-tpl-chip" @click="applyStarterTemplate('meeting')">📅 会议日程</button>
            <button type="button" class="qm-tpl-chip" @click="applyStarterTemplate('habit')">🔁 每日打卡</button>
            <button type="button" class="qm-tpl-chip" @click="applyStarterTemplate('urgent')">📌 高优置顶</button>
          </div>

          <!-- Primary Input: Batch Textarea OR Smart NLP Title Input -->
          <div
            ref="titleWrapRef"
            class="qm-title-wrap t-input"
            :class="{ 'is-error': capTitleError, 'is-shaking': capTitleShaking }"
          >
            <template v-if="capKind === 'batch'">
              <textarea
                ref="batchBoxRef"
                v-model="capBatchText"
                class="qm-batch-area"
                rows="4"
                placeholder="每行一条事项（支持粘贴清单与自然语言，如：明天下午3点 对接设计 #官网改版 !高）…"
                @input="capTitleError = false"
              />
              <div class="qm-batch-bar">
                <span class="qm-batch-count">
                  将批量创建 <NumberPop :value="batchLines.length" /> 条事项
                </span>
                <button v-if="capBatchText" type="button" class="qm-clear-mini" @click="capBatchText = ''">
                  清空
                </button>
              </div>
            </template>

            <template v-else>
              <div class="qm-title-line">
                <input
                  ref="captureBoxRef"
                  v-model="capTitle"
                  type="text"
                  class="qm-cap-title"
                  :placeholder="
                    capKind === 'event'
                      ? '输入日程标题，例如：产品评审会…'
                      : capKind === 'habit'
                        ? '输入习惯名称，例如：晨跑 30 分钟…'
                        : '输入待办，支持「明天下午3点 写方案 #分组 !高」…'
                  "
                  @input="capTitleError = false"
                />
                <button
                  v-if="capTitle"
                  type="button"
                  class="qm-title-clear"
                  title="清空输入"
                  aria-label="清空输入"
                  @click="capTitle = ''"
                >
                  <FIcon name="close" :size="11" />
                </button>
              </div>

              <!-- Live NLP Recognition Pills -->
              <div v-if="hasParsedTokens && parsedQuick" class="qm-nlp-bar">
                <span class="qm-nlp-label">已识别</span>
                <span v-if="parsedQuick.dateLabel" class="qm-nlp-pill date">
                  {{ parsedQuick.dateLabel }} · {{ formatFriendly(parsedQuick.date!) }}
                </span>
                <span v-if="parsedQuick.time" class="qm-nlp-pill time">{{ parsedQuick.time }}</span>
                <span v-if="parsedQuick.groupName" class="qm-nlp-pill grp">#{{ parsedQuick.groupName }}</span>
                <span v-if="parsedQuick.priority" class="qm-nlp-pill pri">
                  {{ PRIORITY_META[parsedQuick.priority].label }}
                </span>
              </div>
            </template>
          </div>

          <!-- Event Time-Block Controls -->
          <div v-if="capKind === 'event'" class="qm-subpanel">
            <div class="qm-time-row">
              <label class="qm-mini-field">
                <span>开始时间</span>
                <input v-model="capTime" type="time" class="qm-time-input" />
              </label>
              <div class="qm-dur-pills">
                <button
                  v-for="dp in DURATION_PRESETS"
                  :key="dp.min"
                  type="button"
                  class="qm-pill sm"
                  :class="{ active: capDuration === dp.min }"
                  @click="capDuration = dp.min"
                >
                  {{ dp.label }}
                </button>
              </div>
              <span class="qm-end-readout">{{ eventEndLabel }}</span>
            </div>
          </div>

          <!-- Habit Repeat Cadence Controls -->
          <div v-if="capKind === 'habit'" class="qm-subpanel">
            <div class="qm-habit-row">
              <div class="qm-pills">
                <button
                  v-for="hp in HABIT_PRESETS"
                  :key="hp.freq"
                  type="button"
                  class="qm-pill sm"
                  :class="{ active: capRepeatFreq === hp.freq }"
                  @click="capRepeatFreq = hp.freq"
                >
                  {{ hp.label }}
                </button>
              </div>
              <label class="qm-mini-field inline">
                <span>提醒</span>
                <input v-model="capTime" type="time" class="qm-time-input" />
              </label>
            </div>
            <div v-if="capRepeatFreq === 'weekly'" class="qm-wd-row">
              <button
                v-for="w in WD_CHIPS"
                :key="w.wd"
                type="button"
                class="qm-wd-chip"
                :class="{ active: capRepeatDays.includes(w.wd) }"
                @click="toggleHabitWeekday(w.wd)"
              >
                {{ w.label }}
              </button>
            </div>
          </div>

          <!-- Date & Group Row -->
          <div class="qm-cap-row">
            <div class="qm-pills">
              <button type="button" class="qm-pill" :class="{ active: capWhen === 'today' }" @click="capWhen = 'today'">
                今天
              </button>
              <button
                type="button"
                class="qm-pill"
                :class="{ active: capWhen === 'tomorrow' }"
                @click="capWhen = 'tomorrow'"
              >
                明天
              </button>
              <button type="button" class="qm-pill" :class="{ active: capWhen === 'after' }" @click="capWhen = 'after'">
                后天
              </button>
              <button
                v-if="capKind === 'task' || capKind === 'batch'"
                type="button"
                class="qm-pill"
                :class="{ active: capWhen === 'someday' }"
                @click="capWhen = 'someday'"
              >
                收集箱
              </button>
              <label class="qm-pill qm-date-pick" :class="{ active: capWhen === 'custom' }">
                <span>{{ capWhen === 'custom' ? capCustomDate.slice(5) : '选日期' }}</span>
                <input
                  v-model="capCustomDate"
                  type="date"
                  class="qm-hidden-date"
                  @change="capWhen = 'custom'"
                />
              </label>
            </div>

            <button type="button" class="qm-group-pill" @click="openCapGroupMenu">
              <FGroupIcon
                :icon="capGroupId ? doc.groups[capGroupId]?.icon : undefined"
                :color="capGroupHex || '#9E9990'"
                :size="13"
              />
              <span>{{ capGroupLabel }}</span>
              <FIcon name="chevronDown" :size="9" />
            </button>
          </div>

          <!-- Status / Priority / Star Pills -->
          <div class="qm-cap-props">
            <button type="button" class="qm-group-pill" @click="openCapStatusMenu">
              <StatusGlyph :status="capStatus" :size="13" />
              <span>{{ STATUS_META[capStatus].label }}</span>
              <FIcon name="chevronDown" :size="9" />
            </button>
            <button type="button" class="qm-group-pill" @click="openCapPriorityMenu">
              <PriorityGlyph :priority="capPriority" :size="12" />
              <span>{{ PRIORITY_META[capPriority].label }}</span>
              <FIcon name="chevronDown" :size="9" />
            </button>
            <button type="button" class="qm-group-pill" :class="{ starred: capStarred }" @click="toggleCapStar">
              <FIcon :name="capStarred ? 'starFill' : 'star'" :size="12" />
              <span>{{ capStarred ? '已星标置顶' : '星标置顶' }}</span>
            </button>
          </div>

          <!-- Accordion Expand for Optional Notes & Link (transitions.dev 21-accordion) -->
          <div v-if="capKind !== 'batch'" class="t-acc qm-acc" :data-open="capMoreOpen ? 'true' : 'false'">
            <button
              type="button"
              class="qm-acc-head"
              :aria-expanded="capMoreOpen"
              @click="capMoreOpen = !capMoreOpen"
            >
              <span>{{ capNote || capLink ? '备注与链接（已填写）' : '添加备注、链接或参考路径' }}</span>
              <span class="t-acc-chevron">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 6.5L8 10.5L12 6.5" />
                </svg>
              </span>
            </button>
            <div class="t-acc-panel">
              <div class="t-acc-panel-inner qm-acc-body">
                <textarea
                  v-model="capNote"
                  class="qm-cap-note"
                  rows="2"
                  placeholder="补充说明或备注（可选）…"
                />
                <input
                  v-model="capLink"
                  type="text"
                  class="qm-cap-link"
                  placeholder="关联链接 https://... 或文件路径（可选）"
                />
              </div>
            </div>
          </div>

          <!-- Footer: Double-Bounce Continuous Toggle + Actions -->
          <div class="qm-cap-foot">
            <label class="qm-cont-wrap" title="开启后保存不关闭弹窗，保留分组与日期连续创建">
              <button
                type="button"
                role="switch"
                class="t-toggle"
                :class="{ 'is-init': capToggleInit }"
                :data-on="capContinue ? 'true' : 'false'"
                :aria-checked="capContinue"
                @click="toggleContinueSwitch"
              >
                <span class="t-toggle-thumb" />
              </button>
              <span class="qm-cont-lbl">连续创建</span>
            </label>

            <div class="qm-cap-btns">
              <button type="button" class="qm-cancel" @click="emit('close')">取消</button>
              <button type="submit" class="ws-cta-btn qm-save">
                {{ capKind === 'batch' ? `批量创建 (${batchLines.length})` : capContinue ? '创建并继续' : '创建事项' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ws-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--ws-scrim-bg, rgba(28, 25, 23, 0.24));
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 20px;
}

.ws-modal-card {
  width: 540px;
  max-width: 100%;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  border-radius: 20px;
  box-shadow: var(--ws-shadow-float);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.qm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--ws-hairline);
}

.qm-switch {
  position: relative;
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  gap: 2px;
}

.qm-sw-pill {
  border-radius: 999px;
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.qm-sw-btn {
  position: relative;
  z-index: 1;
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: color 140ms ease;
}

.qm-sw-btn.active {
  color: var(--ws-ink);
  font-weight: 600;
}

.qm-search-body {
  display: flex;
  flex-direction: column;
}

.qm-search-bar {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ws-hairline);
}

.qm-ico {
  color: var(--ws-ink-muted);
}

.qm-search-input {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 14.5px;
  outline: none;
}

.qm-results {
  max-height: 340px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qm-res-row {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 10px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.qm-res-row.active {
  background: var(--ws-card-subtle);
}

.qm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.qm-r-ico {
  color: var(--ws-ink-secondary);
  flex: none;
}

.qm-r-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.qm-r-code {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--ws-ink-muted);
  flex: none;
}

.qm-r-sub {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.qm-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--ws-ink-muted);
}

.qm-hint-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  font-size: 11px;
  color: var(--ws-ink-muted);
}

.qm-hint-bar kbd,
.qm-cap-hint kbd {
  display: inline-block;
  padding: 1px 5px;
  margin-right: 3px;
  border-radius: 4px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-bg);
  font-family: inherit;
  font-size: 10px;
  color: var(--ws-ink-secondary);
}

.qm-cap-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qm-cap-title {
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  outline: none;
}

.qm-cap-note {
  border: 1px solid var(--ws-hairline);
  border-radius: 10px;
  background: var(--ws-card-subtle);
  padding: 9px 11px;
  color: var(--ws-ink);
  font-size: 13px;
  resize: vertical;
  outline: none;
  transition: border-color 130ms ease;
}

.qm-cap-note:focus,
.qm-cap-link:focus {
  border-color: var(--ws-hairline-strong);
}

.qm-cap-link {
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--ws-hairline);
  border-radius: 10px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font-size: 12.5px;
  outline: none;
  transition: border-color 130ms ease;
}

.qm-cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.qm-pills {
  display: inline-flex;
  gap: 5px;
}

.qm-pill {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}

.qm-pill.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.qm-group-pill {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: border-color 130ms ease, background-color 130ms ease;
}

.qm-group-pill:hover {
  border-color: var(--ws-hairline-strong);
  background: var(--ws-card-hover);
}

.qm-group-pill.starred {
  color: #D97706;
  border-color: rgba(217, 119, 6, 0.35);
  background: rgba(245, 158, 11, 0.12);
}

.qm-cap-props {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.qm-group-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.qm-cap-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
}

.qm-cap-hint {
  font-size: 11px;
  color: var(--ws-ink-muted);
}

.qm-cap-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qm-cancel {
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.qm-cancel:hover {
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.qm-save {
  height: 34px;
  padding: 0 18px;
  font-size: 13px;
}

.ws-modal-backdrop.phone {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

.ws-modal-card.phone {
  width: 100%;
  max-width: 100%;
  max-height: 88dvh;
  border-radius: 22px 22px 0 0;
  border-bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
}

.qm-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong);
  margin: 8px auto 0;
  flex: none;
}

.ws-modal-card.phone .qm-results {
  max-height: 52dvh;
}

.ws-modal-card.phone .qm-res-row {
  height: 42px;
}

.ws-modal-card.phone .qm-cap-row {
  flex-wrap: wrap;
}

.qm-cat-label {
  padding: 7px 10px 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-ink-muted);
  letter-spacing: 0.01em;
}

.qm-cat-label:first-child {
  padding-top: 2px;
}

.qm-event-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e84c3d;
  margin: 0 3.5px;
  flex: none;
}

.qm-hit {
  background: color-mix(in srgb, #e84c3d 16%, transparent);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
}

.qm-res-row.create {
  margin-top: 4px;
  border-top: 1px solid var(--ws-hairline);
  padding-top: 4px;
  color: var(--ws-ink);
  font-weight: 600;
}

.ws-modal-card.phone .qm-cancel,
.ws-modal-card.phone .qm-save {
  height: 38px;
}

/* Multi-Mode Creation Studio Styles */
.qm-mode-bar {
  display: flex;
  align-items: center;
}

.qm-ck-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 11px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
}

.qm-ck-pill {
  border-radius: 8px;
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.qm-ck-btn {
  position: relative;
  z-index: 1;
  height: 27px;
  padding: 0 11px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
  transition: color 140ms ease;
}

.qm-ck-btn.active {
  color: var(--ws-ink);
  font-weight: 650;
}

.qm-tpl-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.qm-tpl-strip::-webkit-scrollbar {
  display: none;
}

.qm-tpl-chip {
  flex: none;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 560;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease, transform 120ms ease;
}

.qm-tpl-chip:hover {
  background: var(--ws-card-subtle);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.qm-tpl-chip:active {
  transform: scale(0.96);
}

.qm-title-wrap {
  border: 1px solid var(--ws-hairline);
  border-radius: 13px;
  background: var(--ws-card-subtle);
  padding: 8px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qm-title-wrap:focus-within {
  border-color: var(--ws-hairline-strong);
  background: var(--ws-card-bg);
}

.qm-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.qm-title-line .qm-cap-title {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 2px 0;
  font-size: 15px;
  font-weight: 620;
  color: var(--ws-ink);
  outline: none;
}

.qm-title-clear {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 0;
  background: var(--ws-pill-bg);
  color: var(--ws-ink-secondary);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
}

.qm-title-clear:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.qm-nlp-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding-top: 4px;
  border-top: 1px dashed var(--ws-hairline);
}

.qm-nlp-label {
  font-size: 10.5px;
  font-weight: 650;
  color: var(--ws-ink-muted);
}

.qm-nlp-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
}

.qm-nlp-pill.date {
  background: rgba(59, 130, 246, 0.14);
  color: #2563eb;
}

.qm-nlp-pill.time {
  background: rgba(232, 93, 42, 0.14);
  color: #d9481a;
}

.qm-nlp-pill.grp {
  background: rgba(16, 185, 129, 0.14);
  color: #0e8a62;
}

.qm-nlp-pill.pri {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.qm-batch-area {
  width: 100%;
  border: 0;
  background: transparent;
  resize: vertical;
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ws-ink);
  outline: none;
}

.qm-batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--ws-ink-secondary);
  padding-top: 4px;
  border-top: 1px dashed var(--ws-hairline);
}

.qm-batch-count {
  font-weight: 620;
}

.qm-clear-mini {
  border: 0;
  background: transparent;
  color: var(--ws-ink-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.qm-clear-mini:hover {
  color: var(--ws-ink);
}

.qm-subpanel {
  padding: 9px 11px;
  border-radius: 12px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qm-time-row,
.qm-habit-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}

.qm-mini-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
}

.qm-time-input {
  height: 26px;
  padding: 0 7px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
}

.qm-dur-pills {
  display: inline-flex;
  gap: 4px;
}

.qm-pill.sm {
  height: 24px;
  padding: 0 9px;
  font-size: 11.5px;
}

.qm-end-readout {
  font-size: 11.5px;
  font-weight: 680;
  color: var(--ws-ink);
  font-variant-numeric: tabular-nums;
}

.qm-wd-row {
  display: flex;
  gap: 5px;
}

.qm-wd-chip {
  width: 28px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.qm-wd-chip.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.qm-date-pick {
  position: relative;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
}

.qm-hidden-date {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.qm-acc {
  border-top: 1px solid var(--ws-hairline);
  padding-top: 4px;
}

.qm-acc-head {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 4px 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
}

.qm-acc-head:hover {
  color: var(--ws-ink);
}

.qm-acc-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
}

.qm-cont-wrap {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  user-select: none;
}

.qm-cont-lbl {
  font-size: 12px;
  font-weight: 560;
  color: var(--ws-ink-secondary);
}
</style>
