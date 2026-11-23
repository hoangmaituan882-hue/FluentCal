<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  confirm,
  FCheckbox,
  FColorSwatches,
  FDatePicker,
  FGroupIcon,
  FIcon,
  FSlider,
  FTimePicker,
  showMenu,
  TASK_COLORS,
  taskColor,
  type MenuItem,
} from '@/fluent';
import { getGroupIcon } from '@/lib/groupIcons';
import type { Task, TaskPriority, TaskStatus } from '@/types';
import { call } from '@/api';
import { addDays, diffDays, today } from '@/lib/date';
import { applyTimelineDraftPatch, formatMinToHHMM, parseTimeMin, pendingDraftFromTask } from '@/lib/dayLayout';
import { flexKind } from '@/lib/flex';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { mergeEdit } from '@/lib/merge';
import {
  applyChecklist,
  applyTaskStatus,
  checklistStats,
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  PRIORITY_ORDER,
  remainingTimeLabel,
  STATUS_META,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { deleteOccurrence, deleteTask, makeGroup, makeTask, saveGroup, saveTask } from '@/lib/tasks';
import { uid } from '@/lib/uid';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, groupList } from '@/stores/doc';
import { clearPendingDraft, notify, setPendingDraft, ui, type EditorPayload } from '../desk/state';
import RepeatEditor from '../editor/RepeatEditor.vue';
import ReminderEditor from '../editor/ReminderEditor.vue';
import DepsEditor from '../editor/DepsEditor.vue';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import { STATUS_DOT_COLOR } from './workspaceMenus';

const props = defineProps<{
  payload: EditorPayload | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { isPhone, isTablet, isCompactNav } = useViewport();

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const draft = ref<Task | null>(null);
const isNew = ref(false);
const occDate = ref('');
const missing = ref(false);
const baseline = ref('');
let base: Task | null = null;

const titleInput = ref<HTMLInputElement>();
const newStepText = ref('');
const newLinkTitle = ref('');
const newLinkUrl = ref('');
const addingLink = ref(false);
const advancedOpen = ref(false);
const nowMinutes = ref(new Date().getHours() * 60 + new Date().getMinutes());
let minuteTimer: ReturnType<typeof setInterval> | undefined;

const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value);

function syncPendingFromInspector() {
  if (!isNew.value || !draft.value) return;
  const pd = pendingDraftFromTask(draft.value);
  if (!pd) {
    clearPendingDraft();
    return;
  }
  const cur = ui.pendingDraft;
  if (
    cur &&
    cur.date === pd.date &&
    cur.startMin === pd.startMin &&
    cur.endMin === pd.endMin &&
    cur.title === pd.title &&
    cur.color === pd.color &&
    cur.groupId === pd.groupId
  ) {
    return;
  }
  setPendingDraft(pd);
}

function loadPayload(p: EditorPayload | null) {
  missing.value = false;
  addingLink.value = false;
  newStepText.value = '';
  if (!p) {
    draft.value = null;
    base = null;
    baseline.value = '';
    clearPendingDraft();
    return;
  }
  if (p.mode === 'edit') {
    const t = doc.tasks[p.taskId];
    if (!t) {
      draft.value = null;
      base = null;
      missing.value = true;
      clearPendingDraft();
      return;
    }
    draft.value = clone(t);
    isNew.value = false;
    occDate.value = p.date ?? t.start;
    clearPendingDraft();
  } else {
    const start = p.start ?? today();
    draft.value = makeTask({
      title: p.title ?? '',
      start,
      end: p.end ?? start,
      time: p.time,
      duration: p.duration,
      groupId: p.groupId,
      milestone: p.milestone || undefined,
    });
    isNew.value = true;
    occDate.value = start;
    syncPendingFromInspector();
  }
  base = draft.value ? clone(draft.value) : null;
  baseline.value = JSON.stringify(draft.value);
  if (isNew.value) {
    void nextTick(() => titleInput.value?.focus());
  }
}

watch(() => props.payload, (p) => loadPayload(p), { immediate: true });

watch(
  [
    isNew,
    () => draft.value?.title,
    () => draft.value?.start,
    () => draft.value?.time,
    () => draft.value?.duration,
    () => draft.value?.color,
    () => draft.value?.groupId,
  ],
  () => {
    syncPendingFromInspector();
  },
);

watch(
  () => ui.pendingDraft,
  (pd) => {
    if (!isNew.value || !draft.value || !pd || pd.source !== 'timeline') return;
    const wasDirty = dirty.value;
    applyTimelineDraftPatch(draft.value, pd);
    if (!wasDirty) {
      base = clone(draft.value);
      baseline.value = JSON.stringify(draft.value);
    }
  },
);

// Sync external edits (e.g. toggling done in list/desk) when the user has no unsaved edits here.
watch(
  () => (draft.value && !isNew.value ? doc.tasks[draft.value.id] : undefined),
  (ext) => {
    if (isNew.value || !draft.value) return;
    if (!ext) {
      if (!dirty.value) {
        draft.value = null;
        base = null;
        missing.value = true;
      }
      return;
    }
    if (!dirty.value) {
      const serialized = JSON.stringify(ext);
      if (serialized !== baseline.value) {
        draft.value = clone(ext);
        base = clone(ext);
        baseline.value = serialized;
      }
    }
  },
  { deep: true },
);

const STATUS_CLS: Record<TaskStatus, string> = {
  in_review: 'review',
  in_progress: 'progress',
  todo: 'todo',
  backlog: 'backlog',
  done: 'done',
};

const currentStatus = computed<TaskStatus>(() => (draft.value ? effectiveWorkspaceStatus(draft.value) : 'todo'));
const currentPriority = computed<TaskPriority>(() => (draft.value ? effectivePriority(draft.value) : 'none'));

const statusMeta = computed(() => {
  const s = currentStatus.value;
  return {
    label: STATUS_META[s].label,
    dot: STATUS_DOT_COLOR[s],
    cls: STATUS_CLS[s],
  };
});

const countdownBadge = computed(() =>
  draft.value ? remainingTimeLabel(draft.value, now.value, nowMinutes.value) : '',
);

const groupLabel = computed(() => {
  const gid = draft.value?.groupId;
  return gid ? (doc.groups[gid]?.name ?? '无分组') : '无分组';
});

const groupHex = computed(() => {
  const gid = draft.value?.groupId;
  return gid && doc.groups[gid] ? taskColor(doc.groups[gid].color, isDark.value).bar : '#9E9990';
});

const accentProgressColor = computed(() => {
  const t = draft.value;
  if (!t) return 'var(--ws-ink)';
  if (t.color) return taskColor(t.color, isDark.value).bar;
  if (t.groupId && doc.groups[t.groupId]) return taskColor(doc.groups[t.groupId].color, isDark.value).bar;
  return 'var(--ws-ink)';
});

const start = computed({
  get: () => draft.value?.start ?? '',
  set: (v: string) => {
    const t = draft.value;
    if (!t || !v) return;
    const len = Math.max(0, diffDays(t.start, t.end));
    t.start = v;
    t.end = addDays(v, len);
  },
});

const end = computed({
  get: () => draft.value?.end ?? '',
  set: (v: string) => {
    if (draft.value && v) draft.value.end = v < draft.value.start ? draft.value.start : v;
  },
});

const isFlex = computed({
  get: () => !!draft.value && !!flexKind(draft.value),
  set: (v: boolean) => {
    if (!draft.value) return;
    if (v) {
      draft.value.flex = 'someday';
      draft.value.time = undefined;
      draft.value.duration = undefined;
    } else {
      draft.value.flex = undefined;
      draft.value.flexDone = undefined;
    }
  },
});

const allDay = computed({
  get: () => !draft.value?.time,
  set: (v: boolean) => {
    if (!draft.value) return;
    if (v) {
      draft.value.time = undefined;
      draft.value.duration = undefined;
    } else {
      draft.value.flex = undefined;
      draft.value.time = draft.value.time || '09:00';
      draft.value.duration = draft.value.duration ?? 60;
    }
  },
});

const time = computed({
  get: () => draft.value?.time ?? '',
  set: (v: string) => {
    if (draft.value) draft.value.time = v || undefined;
  },
});

const DURATION_PRESETS = [
  { mins: 30, label: '30m' },
  { mins: 60, label: '1h' },
  { mins: 90, label: '1.5h' },
  { mins: 120, label: '2h' },
];

const endTimeText = computed(() => {
  if (!draft.value?.time) return '';
  const m = parseTimeMin(draft.value.time);
  const dur = draft.value.duration ?? 60;
  return `至 ${formatMinToHHMM(Math.min(1440, m + dur))}`;
});

const color = computed({
  get: () => draft.value?.color ?? '',
  set: (v: string) => {
    if (draft.value) draft.value.color = v || undefined;
  },
});

const swatches = TASK_COLORS.map((c) => ({ key: c.key, color: c.bar, label: c.label }));

const notes = computed({
  get: () => draft.value?.notes ?? '',
  set: (v: string) => {
    if (draft.value) draft.value.notes = v || undefined;
  },
});

const chkStats = computed(() => checklistStats(draft.value?.checklist));

function setStatus(s: TaskStatus) {
  if (!draft.value) return;
  draft.value = applyTaskStatus(draft.value, s);
}

function toggleDoneQuick() {
  setStatus(currentStatus.value === 'done' ? 'todo' : 'done');
}

function toggleCountdownFlag() {
  if (!draft.value) return;
  draft.value.countdown = !draft.value.countdown || undefined;
}

function updateStepText(id: string, text: string, finalize = false) {
  if (!draft.value?.checklist) return;
  if (finalize && !text.trim()) {
    removeStep(id);
    return;
  }
  const nextText = finalize ? text.trim() : text;
  draft.value = applyChecklist(
    draft.value,
    draft.value.checklist.map((item) => (item.id === id ? { ...item, text: nextText } : item)),
  );
}

function onStepTextInput(id: string, e: Event) {
  updateStepText(id, (e.target as HTMLInputElement).value, false);
}

function onStepTextBlur(id: string, e: Event) {
  updateStepText(id, (e.target as HTMLInputElement).value, true);
}

function onStepTextEnter(e: KeyboardEvent) {
  (e.target as HTMLInputElement).blur();
}

function setPriority(p: TaskPriority) {
  if (!draft.value) return;
  draft.value.priority = p === 'none' ? undefined : p;
}

function openPriorityMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = PRIORITY_ORDER.map((p) => ({
    label: PRIORITY_META[p].label,
    colorDot: PRIORITY_META[p].color,
    radio: true,
    checked: currentPriority.value === p,
    action: () => setPriority(p),
  }));
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function toggleStar() {
  if (!draft.value) return;
  draft.value.starred = !draft.value.starred || undefined;
}

function openStatusMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = WORKSPACE_STATUS_ORDER.map((s) => ({
    label: STATUS_META[s].label,
    colorDot: STATUS_DOT_COLOR[s],
    radio: true,
    checked: currentStatus.value === s,
    action: () => setStatus(s),
  }));
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function openGroupMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '无分组', colorDot: '#9E9990', radio: true, checked: !draft.value?.groupId, action: () => draft.value && (draft.value.groupId = undefined) },
    ...groupList.value.map((g) => {
      const def = getGroupIcon(g.icon);
      return {
        label: g.name,
        svgPaths: def?.paths,
        colorDot: def ? undefined : taskColor(g.color, isDark.value).bar,
        radio: true,
        checked: draft.value?.groupId === g.id,
        action: () => draft.value && (draft.value.groupId = g.id),
      };
    }),
    { separator: true },
    {
      label: '+ 快速新建分组',
      icon: 'add',
      action: async () => {
        const idx = groupList.value.length + 1;
        const g = makeGroup(`新分组 ${idx}`, TASK_COLORS[idx % TASK_COLORS.length].key);
        await saveGroup(g);
        if (draft.value) draft.value.groupId = g.id;
      },
    },
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function toggleStep(id: string) {
  if (!draft.value?.checklist) return;
  const updated = draft.value.checklist.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
  draft.value = applyChecklist(draft.value, updated);
}

function addStep() {
  const text = newStepText.value.trim();
  if (!draft.value || !text) return;
  newStepText.value = '';
  const list = [...(draft.value.checklist ?? []), { id: uid(), text, done: false }];
  draft.value = applyChecklist(draft.value, list);
}

function removeStep(id: string) {
  if (!draft.value?.checklist) return;
  const list = draft.value.checklist.filter((c) => c.id !== id);
  draft.value = applyChecklist(draft.value, list);
}

function addLink() {
  const url = newLinkUrl.value.trim();
  if (!draft.value || !url) return;
  const title = newLinkTitle.value.trim() || url.replace(/^https?:\/\//, '').split('/')[0] || url;
  const next = [...(draft.value.links ?? []), { id: uid(), title, url }];
  draft.value.links = next;
  newLinkTitle.value = '';
  newLinkUrl.value = '';
  addingLink.value = false;
}

function removeLink(id: string) {
  if (!draft.value?.links) return;
  const next = draft.value.links.filter((l) => l.id !== id);
  draft.value.links = next.length ? next : undefined;
}

function openLink(url: string) {
  if (/^https?:\/\//i.test(url)) {
    void call('open_url', { url });
  } else {
    void navigator.clipboard?.writeText(url);
    notify('已复制路径到剪贴板');
  }
}

async function save(keepOpen = false) {
  const t = draft.value;
  if (!t) return;
  t.title = t.title.trim();
  if (!t.title) {
    titleInput.value?.focus();
    return;
  }
  if (t.milestone || t.end < t.start) t.end = t.start;
  if (!isNew.value) {
    const current = doc.tasks[t.id];
    if (!current) {
      await saveTask(clone(t));
    } else {
      await saveTask(base ? mergeEdit(base, clone(t), current) : clone(t));
    }
  } else {
    await saveTask(clone(t));
    clearPendingDraft();
  }
  if (keepOpen) {
    isNew.value = false;
    base = clone(t);
    baseline.value = JSON.stringify(t);
    notify('已保存更改');
  } else {
    emit('close');
  }
}

async function remove() {
  const t = draft.value && doc.tasks[draft.value.id];
  if (!t || isNew.value) return emit('close');
  if (t.repeat) {
    const r = await confirm({
      title: '删除重复任务',
      content: `“${t.title}”是重复任务，要删除哪些？`,
      primaryText: '全部删除',
      secondaryText: '仅这一次',
      danger: true,
    });
    if (r === 'close') return;
    await deleteOccurrence(t, occDate.value, r === 'primary' ? 'all' : 'this');
  } else {
    await deleteTask(t.id);
  }
  notify(`已删除“${t.title.length > 16 ? `${t.title.slice(0, 16)}…` : t.title}”`, !t.repeat);
  emit('close');
}

async function tryClose() {
  if (dirty.value) {
    const r = await confirm({
      title: '放弃未保存的修改？',
      primaryText: '放弃并关闭',
      closeText: '继续编辑',
    });
    if (r !== 'primary') return;
  }
  if (isNew.value) clearPendingDraft();
  emit('close');
}

const lunarOf = (iso: string) => dayInfo(iso).text;

function onKey(e: KeyboardEvent) {
  if (!draft.value) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save(true);
  } else if (ctrl && e.key === 'Enter') {
    e.preventDefault();
    void save(false);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  minuteTimer = setInterval(() => {
    const d = new Date();
    nowMinutes.value = d.getHours() * 60 + d.getMinutes();
  }, 30_000);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  clearInterval(minuteTimer);
  if (isNew.value) clearPendingDraft();
});

defineExpose({ requestClose: tryClose });
</script>

<template>
  <div class="ws-ins-host" :class="{ phone: isPhone, tablet: isTablet, compact: isCompactNav }">
    <div v-if="isCompactNav" class="ws-ins-scrim" @click="tryClose" />
    <aside class="ws-inspector" role="dialog" :aria-modal="isCompactNav ? 'true' : undefined" aria-label="任务详情抽屉">
      <div v-if="isPhone" class="ins-grab" aria-hidden="true" />
      <div v-if="missing" class="ins-missing">
        <p>该任务已被删除或不再存在。</p>
        <button type="button" class="ws-cta-btn" @click="emit('close')">关闭</button>
      </div>

      <template v-else-if="draft">
      <div v-if="!draft.milestone && !draft.repeat" class="ins-progress-rail" aria-hidden="true">
        <div
          class="ins-progress-fill"
          :style="{ width: `${draft.progress}%`, background: accentProgressColor }"
        />
      </div>

      <!-- Top Bar: Group + Status Dropdown + Close -->
      <header class="ins-header">
        <button type="button" class="ins-group-pill" @click="openGroupMenu">
          <span class="ig-ico" :style="{ color: groupHex }">
            <FGroupIcon
              :icon="draft.groupId ? doc.groups[draft.groupId]?.icon : undefined"
              :color="groupHex"
              :size="13"
            />
          </span>
          <span class="ins-group-name">{{ groupLabel }}</span>
          <FIcon name="chevronDown" :size="9" />
        </button>

        <div class="ins-head-right">
          <button
            type="button"
            class="ins-prio-pill"
            :title="`优先级：${PRIORITY_META[currentPriority].label}`"
            @click="openPriorityMenu"
          >
            <PriorityGlyph :priority="currentPriority" :size="12" />
            <span v-if="currentPriority !== 'none'" class="ins-prio-txt">{{ PRIORITY_META[currentPriority].label }}</span>
          </button>

          <button type="button" class="ins-status-pill" :class="statusMeta.cls" @click="openStatusMenu">
            <StatusGlyph :status="currentStatus" :size="12" />
            <span>{{ statusMeta.label }}</span>
            <FIcon name="chevronDown" :size="9" />
          </button>

          <button
            type="button"
            class="ins-star-btn"
            :class="{ active: !!draft.starred }"
            :title="draft.starred ? '取消星标置顶' : '加入星标置顶'"
            :aria-label="draft.starred ? '取消星标置顶' : '加入星标置顶'"
            @click="toggleStar"
          >
            {{ draft.starred ? '★' : '☆' }}
          </button>

          <button type="button" class="ws-icon-circle" title="关闭详情 (Esc)" aria-label="关闭详情" @click="tryClose">
            <FIcon name="close" :size="12" />
          </button>
        </div>
      </header>

      <div class="ins-scroll">
        <!-- Title + Inline Complete Toggle + Live Countdown -->
        <div class="ins-title-block">
          <div class="ins-title-row">
            <button
              type="button"
              class="ins-title-glyph"
              :title="currentStatus === 'done' ? '标为待开始' : '标为已完成'"
              @click="toggleDoneQuick"
            >
              <StatusGlyph :status="currentStatus" :size="20" interactive />
            </button>
            <input
              ref="titleInput"
              v-model="draft.title"
              type="text"
              class="ins-title-input"
              :class="{ done: currentStatus === 'done' }"
              placeholder="输入任务标题…"
              maxlength="200"
            />
          </div>
          <div class="ins-meta-strip">
            <span class="ins-countdown">
              <FIcon name="timer" :size="11" />
              <span>{{ countdownBadge }}</span>
            </span>
            <div class="ins-meta-right">
              <button
                type="button"
                class="ins-cd-chip"
                :class="{ active: !!draft.countdown }"
                title="开启或关闭底部倒数日显示"
                @click="toggleCountdownFlag"
              >
                <FIcon name="flag" :size="10" />
                <span>倒数日</span>
              </button>
              <span v-if="!draft.milestone && !draft.repeat" class="ins-pct">{{ draft.progress }}%</span>
            </div>
          </div>
        </div>

        <!-- Schedule & Color Section -->
        <section class="ins-sec">
          <div class="ins-sec-label">时间与排期</div>
          <div class="ins-row-wrap">
            <label class="ins-toggle">
              <FCheckbox v-model="isFlex" label="放入收集箱（不定日）" />
            </label>
          </div>

          <template v-if="!isFlex">
            <div class="ins-date-grid">
              <FDatePicker v-model="start" :lunar="lunarOf" :width="isPhone ? '100%' : 148" />
              <span v-if="!draft.milestone" class="ins-to">至</span>
              <FDatePicker v-if="!draft.milestone" v-model="end" :lunar="lunarOf" :width="isPhone ? '100%' : 148" />
            </div>

            <div class="ins-time-row">
              <FCheckbox v-model="allDay" label="全天" />
              <template v-if="!allDay">
                <FTimePicker v-model="time" :width="isPhone ? 114 : 104" />
                <div class="ins-dur-chips">
                  <button
                    v-for="p in DURATION_PRESETS"
                    :key="p.mins"
                    type="button"
                    class="ins-dur-btn"
                    :class="{ active: (draft.duration ?? 60) === p.mins }"
                    @click="draft.duration = p.mins"
                  >
                    {{ p.label }}
                  </button>
                </div>
              </template>
            </div>
            <div v-if="!allDay && endTimeText" class="ins-hint">{{ endTimeText }} · 农历{{ dayInfo(draft.start).lunarLabel }}</div>
          </template>

          <div class="ins-swatches">
            <FColorSwatches v-model="color" :colors="swatches" allow-none custom :size="20" />
          </div>
        </section>

        <!-- Connected Vertical Checklist (ShopWrk / Folio style) -->
        <section class="ins-sec">
          <div class="ins-sec-head">
            <span class="ins-sec-label">执行清单</span>
            <span v-if="chkStats.total" class="ins-chk-ratio">{{ chkStats.done }}/{{ chkStats.total }}</span>
          </div>

          <div v-if="draft.checklist?.length" class="chk-timeline">
            <div
              v-for="item in draft.checklist"
              :key="item.id"
              class="chk-node"
              :class="{ done: item.done }"
            >
              <span class="chk-rail" aria-hidden="true" />
              <button
                type="button"
                class="ws-check-circle chk-circle"
                :class="{ done: item.done }"
                @click="toggleStep(item.id)"
              >
                <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
              </button>
              <input
                :value="item.text"
                type="text"
                class="chk-text-input"
                placeholder="步骤内容…"
                @input="onStepTextInput(item.id, $event)"
                @blur="onStepTextBlur(item.id, $event)"
                @keydown.enter.prevent="onStepTextEnter"
              />
              <button
                type="button"
                class="chk-del"
                title="移除此步骤"
                aria-label="移除此步骤"
                @click="removeStep(item.id)"
              >
                <FIcon name="close" :size="9" />
              </button>
            </div>
          </div>

          <form class="chk-add-form" @submit.prevent="addStep">
            <FIcon name="add" :size="11" class="chk-add-ico" />
            <input
              v-model="newStepText"
              type="text"
              class="chk-add-input"
              placeholder="添加子步骤，按回车确认…"
            />
          </form>
        </section>

        <!-- Notes & Linked Documents -->
        <section class="ins-sec">
          <div class="ins-sec-head">
            <span class="ins-sec-label">备注与资料</span>
            <button type="button" class="ins-mini-link" @click="addingLink = !addingLink">
              {{ addingLink ? '取消' : '+ 添加链接' }}
            </button>
          </div>

          <textarea
            v-model="notes"
            class="ins-notes"
            rows="3"
            placeholder="记录想法、要点或跟进事项…"
          />

          <div v-if="addingLink" class="ins-link-form">
            <input v-model="newLinkTitle" type="text" class="ins-link-input" placeholder="显示名称（可选）" />
            <div class="ins-link-row">
              <input
                v-model="newLinkUrl"
                type="text"
                class="ins-link-input"
                placeholder="https://... 或本地文件路径"
                @keydown.enter.prevent="addLink"
              />
              <button type="button" class="ws-cta-btn ins-link-ok" @click="addLink">添加</button>
            </div>
          </div>

          <div v-if="draft.links?.length" class="ins-links-list">
            <div v-for="lnk in draft.links" :key="lnk.id" class="ins-doc-item">
              <button type="button" class="ins-doc-open" :title="lnk.url" @click="openLink(lnk.url)">
                <FIcon name="link" :size="12" />
                <span>{{ lnk.title }}</span>
              </button>
              <button type="button" class="chk-del" title="移除链接" @click="removeLink(lnk.id)">
                <FIcon name="close" :size="9" />
              </button>
            </div>
          </div>
        </section>

        <!-- Collapsible Advanced Editors (Reusing RepeatEditor, ReminderEditor, DepsEditor) -->
        <section class="ins-sec">
          <button
            type="button"
            class="ins-adv-toggle"
            :aria-expanded="advancedOpen"
            @click="advancedOpen = !advancedOpen"
          >
            <span>高级设置（重复 · 提醒 · 依赖 · 进度）</span>
            <FIcon class="adv-chev" :class="{ open: advancedOpen }" name="chevronRight" :size="10" />
          </button>

          <div class="ins-accordion" :class="{ open: advancedOpen }">
            <div class="ins-accordion-body">
              <div class="adv-group">
                <div class="adv-lbl">重复规则</div>
                <RepeatEditor v-model="draft.repeat" :start="draft.start" />
              </div>

              <div class="adv-group">
                <div class="adv-lbl">提醒通知</div>
                <ReminderEditor
                  v-model="draft.reminders"
                  :all-day="allDay"
                  :all-day-time="doc.settings.reminders.allDayTime"
                  :enabled="doc.settings.reminders.enabled"
                />
              </div>

              <div class="adv-group">
                <div class="adv-lbl">前置任务依赖</div>
                <DepsEditor v-model="draft.deps" :self="draft.id" :group-id="draft.groupId" />
              </div>

              <div v-if="!draft.repeat && !draft.milestone" class="adv-group">
                <div class="adv-lbl">完成进度 ({{ draft.progress }}%)</div>
                <FSlider
                  v-model="draft.progress"
                  :min="0"
                  :max="100"
                  :step="5"
                  :width="isPhone ? 200 : 240"
                  show-value
                  :format="(v: number) => `${v}%`"
                  @change="(v: number) => draft && (draft.done = v >= 100)"
                />
              </div>

              <div class="adv-checks">
                <FCheckbox
                  :model-value="!!draft.countdown"
                  label="显示为倒数日"
                  @update:model-value="(v: boolean) => draft && (draft.countdown = v || undefined)"
                />
                <FCheckbox
                  :model-value="!!draft.milestone"
                  label="甘特图里程碑"
                  @update:model-value="(v: boolean) => draft && (draft.milestone = v || undefined)"
                />
                <FCheckbox
                  v-if="!draft.repeat && draft.start === draft.end"
                  :model-value="draft.autoPostpone ?? doc.settings.tasks.autoPostpone"
                  label="未完成自动顺延"
                  @update:model-value="(v: boolean) => draft && (draft.autoPostpone = v)"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Footer -->
      <footer class="ins-footer">
        <button v-if="!isNew" type="button" class="ins-del-btn" @click="remove">
          <FIcon name="delete" :size="12" />
          <span>删除</span>
        </button>
        <span class="ins-grow" />
        <button type="button" class="ins-cancel-btn" @click="tryClose">取消</button>
        <button
          type="button"
          class="ws-cta-btn ins-save-btn"
          :disabled="!draft.title.trim()"
          @click="save(false)"
        >
          {{ isNew ? '创建任务' : dirty ? '保存修改' : '完成' }}
        </button>
      </footer>
    </template>
    </aside>
  </div>
</template>

<style scoped>
.ws-ins-host {
  position: absolute;
  top: 12px;
  right: 14px;
  bottom: 14px;
  z-index: 30;
  pointer-events: none;
  display: flex;
}

.ws-ins-host.tablet {
  position: fixed;
  inset: 0;
  z-index: 65;
  padding: 12px;
  justify-content: flex-end;
  pointer-events: auto;
}

.ws-ins-host.phone {
  position: fixed;
  inset: 0;
  z-index: 65;
  flex-direction: column;
  justify-content: flex-end;
  pointer-events: auto;
}

.ws-ins-scrim {
  position: absolute;
  inset: 0;
  background: var(--ws-scrim-bg, rgba(18, 17, 15, 0.28));
  backdrop-filter: blur(6px);
}

.ws-inspector {
  position: relative;
  width: 436px;
  max-width: calc(100vw - 28px);
  height: 100%;
  pointer-events: auto;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  border-radius: 18px;
  box-shadow: var(--ws-shadow-float);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-ins-host.tablet .ws-inspector {
  width: min(440px, 88vw);
  max-width: 100%;
}

.ws-ins-host.phone .ws-inspector {
  width: 100%;
  max-width: 100%;
  height: 92dvh;
  max-height: 92dvh;
  border-radius: 22px 22px 0 0;
  border-bottom: 0;
}

.ins-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong);
  margin: 8px auto 0;
  flex: none;
}

.ins-missing {
  margin: auto;
  padding: 24px;
  text-align: center;
}

.ins-progress-rail {
  height: 2.5px;
  flex: none;
  width: 100%;
  background: var(--ws-hairline);
  overflow: hidden;
}

.ins-progress-fill {
  height: 100%;
  transition: width 240ms var(--ws-ease-out), background-color 180ms ease;
}

.ins-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--ws-hairline);
}

.ins-head-right {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.ins-group-pill,
.ins-status-pill,
.ins-prio-pill {
  height: 28px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 130ms ease, border-color 130ms ease;
}

.ins-group-pill {
  min-width: 0;
  max-width: 140px;
}

.ins-group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ins-prio-pill {
  padding: 0 8px;
  color: var(--ws-ink-secondary);
}

.ins-prio-txt {
  font-size: 11.5px;
}

.ins-star-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 130ms ease, border-color 130ms ease, color 130ms ease;
}

.ins-star-btn:hover {
  border-color: var(--ws-hairline-strong);
  background: var(--ws-card-hover);
  color: var(--ws-ink);
}

.ins-star-btn.active {
  color: #D97706;
  border-color: rgba(217, 119, 6, 0.35);
  background: rgba(245, 158, 11, 0.12);
}

.ins-group-pill:hover,
.ins-status-pill:hover,
.ins-prio-pill:hover {
  border-color: var(--ws-hairline-strong);
  background: var(--ws-card-hover);
}

.ins-status-pill.review {
  background: var(--ws-pill-review-bg);
  border-color: transparent;
  color: var(--ws-pill-review-ink);
}

.ins-status-pill.progress {
  background: var(--ws-progress-bg);
  border-color: var(--ws-progress-border);
  color: var(--ws-progress-ink);
}

.ins-status-pill.backlog {
  background: var(--ws-pill-backlog-bg);
  border-color: transparent;
  color: var(--ws-pill-backlog-ink);
}

.ins-status-pill.done {
  background: var(--ws-success-bg);
  border-color: var(--ws-success-border);
  color: var(--ws-success);
}

.ig-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.ig-dot,
.is-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.ins-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ins-title-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ins-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ins-title-glyph {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}

.ins-title-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  outline: none;
  padding: 2px 0;
}

.ins-title-input.done {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.ins-meta-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ins-meta-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ins-cd-chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.ins-cd-chip:hover {
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.ins-cd-chip.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.ins-countdown {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font-size: 11.5px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}

.ins-pct {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.ins-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-hairline);
}

.ins-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ins-sec-label {
  font-size: 11.5px;
  font-weight: 650;
  color: var(--ws-ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.ins-chk-ratio {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
  font-variant-numeric: tabular-nums;
}

.ins-date-grid {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ins-to {
  font-size: 12px;
  color: var(--ws-ink-muted);
}

.ins-time-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.ins-dur-chips {
  display: inline-flex;
  gap: 3px;
}

.ins-dur-btn {
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
}

.ins-dur-btn.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.ins-hint {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.ins-swatches {
  padding-top: 2px;
}

/* Connected Vertical Checklist */
.chk-timeline {
  display: flex;
  flex-direction: column;
  position: relative;
}

.chk-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 4px;
  border-radius: 8px;
}

.chk-node:hover {
  background: var(--ws-card-subtle);
}

.chk-rail {
  position: absolute;
  left: 12px;
  top: -6px;
  bottom: -6px;
  width: 1.5px;
  background: var(--ws-hairline-strong);
}

.chk-node:first-child .chk-rail {
  top: 14px;
}

.chk-node:last-child .chk-rail {
  bottom: 14px;
}

.chk-node:only-child .chk-rail {
  display: none;
}

.chk-circle {
  position: relative;
  z-index: 1;
  background: var(--ws-card-bg);
}

.chk-circle.done {
  background: var(--ws-ink);
}

.chk-text-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 2px 4px;
  border-radius: 6px;
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: color 140ms ease, background-color 120ms ease;
}

.chk-text-input:focus {
  background: var(--ws-card-bg);
  box-shadow: 0 0 0 1px var(--ws-hairline-strong);
}

.chk-node.done .chk-text-input {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.chk-del {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: grid;
  place-items: center;
  opacity: 0;
  cursor: pointer;
}

.chk-node:hover .chk-del,
.chk-node:focus-within .chk-del,
.ins-doc-item:hover .chk-del {
  opacity: 1;
}

.chk-del:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.chk-add-form {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border-radius: 10px;
  background: var(--ws-card-subtle);
}

.chk-add-ico {
  color: var(--ws-ink-muted);
}

.chk-add-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 12.5px;
  outline: none;
}

/* Notes & Documents */
.ins-notes {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.ins-notes:focus {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline-strong);
}

.ins-mini-link {
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.ins-mini-link:hover {
  color: var(--ws-ink);
}

.ins-link-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  background: var(--ws-card-subtle);
}

.ins-link-row {
  display: flex;
  gap: 6px;
}

.ins-link-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-size: 12px;
  outline: none;
}

.ins-link-ok {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
}

.ins-links-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ins-doc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 8px;
  background: var(--ws-card-subtle);
}

.ins-doc-open {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 7px;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.ins-doc-open span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Accordion */
.ins-adv-toggle {
  border: 0;
  background: transparent;
  padding: 4px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.ins-adv-toggle:hover {
  color: var(--ws-ink);
}

.adv-chev {
  transition: transform 200ms var(--ws-ease-out);
}

.adv-chev.open {
  transform: rotate(90deg);
}

.ins-accordion {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 240ms var(--ws-ease-out), opacity 180ms ease;
}

.ins-accordion.open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.ins-accordion-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 6px;
}

.adv-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.adv-lbl {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
  font-weight: 550;
}

.adv-checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Footer */
.ins-footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
}

.ins-grow {
  flex: 1;
}

.ins-del-btn {
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-danger);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
}

.ins-del-btn:hover {
  background: var(--ws-danger-bg);
}

.ins-cancel-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.ins-save-btn {
  height: 32px;
  padding: 0 16px;
  font-size: 12.5px;
}

.ws-ins-host.phone .ins-header {
  flex-wrap: wrap;
  row-gap: 6px;
  padding: 8px 14px 10px;
}

.ws-ins-host.phone .ins-scroll {
  padding: 12px 14px 24px;
}

.ws-ins-host.phone .ins-date-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
}

.ws-ins-host.phone .ins-footer {
  padding: 10px 14px max(12px, env(safe-area-inset-bottom));
}

.ws-ins-host.phone .ins-save-btn,
.ws-ins-host.phone .ins-cancel-btn,
.ws-ins-host.phone .ins-del-btn {
  height: 38px;
}

@media (hover: none) {
  .chk-del {
    opacity: 0.55;
  }
}
</style>
