<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { FGroupIcon, FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { TaskPriority, TaskStatus } from '@/types';
import { addDays } from '@/lib/date';
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
import GroupSquircle from './GroupSquircle.vue';
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

const mode = ref<'search' | 'capture'>('search');
const switchRef = ref<HTMLElement>();
const searchInput = ref('');
const searchBoxRef = ref<HTMLInputElement>();
const captureBoxRef = ref<HTMLInputElement>();
const selectedIdx = ref(0);

const capTitle = ref('');
const capNote = ref('');
const capLink = ref('');
const capGroupId = ref('');
const capWhen = ref<'today' | 'tomorrow' | 'someday'>('today');
const capStatus = ref<TaskStatus>('todo');
const capPriority = ref<TaskPriority>('none');
const capStarred = ref(false);

const { style: swStyle, ready: swReady, visible: swVisible } = useSlidingIndicator(
  switchRef,
  '.qm-sw-btn.active',
  [mode, () => props.open],
);

watch(
  () => [props.open, props.initialMode] as const,
  async ([isOpen, m]) => {
    if (!isOpen) return;
    mode.value = m;
    searchInput.value = '';
    selectedIdx.value = 0;
    capTitle.value = '';
    capNote.value = '';
    capLink.value = '';
    capGroupId.value = props.defaultGroupId && props.defaultGroupId !== '__ungrouped__' ? props.defaultGroupId : '';
    capWhen.value = 'today';
    capStatus.value = 'todo';
    capPriority.value = 'none';
    capStarred.value = false;
    await nextTick();
    if (m === 'search') searchBoxRef.value?.focus();
    else captureBoxRef.value?.focus();
  },
);

watch(mode, async (m) => {
  if (!props.open) return;
  await nextTick();
  if (m === 'search') searchBoxRef.value?.focus();
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
  kind: 'nav' | 'group' | 'task';
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
}

const searchResults = computed<SearchResult[]>(() => {
  const q = searchInput.value.trim().toLowerCase();
  const navEntries: SearchResult[] = [
    { id: 'nav:daily', kind: 'nav', title: '今日聚焦', sub: '视图', icon: 'today', page: 'daily' },
    { id: 'nav:calendar', kind: 'nav', title: '日历视图', sub: '视图', icon: 'calendar', page: 'calendar' },
    { id: 'nav:inbox', kind: 'nav', title: '收集箱', sub: '视图', icon: 'flag', page: 'inbox' },
    { id: 'nav:tasks', kind: 'nav', title: '待办清单', sub: '视图', icon: 'checklist', page: 'tasks' },
    { id: 'nav:countdowns', kind: 'nav', title: '倒数日', sub: '视图', icon: 'timer', page: 'countdowns' },
    { id: 'nav:gantt', kind: 'nav', title: '项目甘特', sub: '视图', icon: 'gantt', page: 'gantt' },
    { id: 'nav:settings', kind: 'nav', title: '设置', sub: '系统', icon: 'settings', page: 'settings' },
  ];
  const groupEntries: SearchResult[] = groupList.value.map((g) => ({
    id: `grp:${g.id}`,
    kind: 'group',
    title: g.name,
    sub: '分组',
    icon: 'group',
    groupIcon: g.icon,
    groupColorKey: g.color,
    page: 'area',
    groupId: g.id,
  }));
  const taskEntries: SearchResult[] = taskList.value
    .filter((t) => !t.countdownOnly)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((t) => ({
      id: `tsk:${t.id}`,
      kind: 'task',
      title: t.title,
      sub: t.groupId && doc.groups[t.groupId] ? doc.groups[t.groupId].name : t.flex ? '收集箱' : t.start,
      icon: t.done ? 'completed' : 'checkboxEmpty',
      taskStatus: effectiveWorkspaceStatus(t),
      taskPriority: effectivePriority(t),
      taskCode: taskShortCode(t),
      taskId: t.id,
    }));

  const combined = [...taskEntries, ...groupEntries, ...navEntries];
  if (!q) {
    return [...navEntries, ...groupEntries.slice(0, 4), ...taskEntries.slice(0, 6)];
  }
  return combined
    .filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.sub?.toLowerCase().includes(q) ||
        r.taskCode?.toLowerCase().includes(q),
    )
    .slice(0, 12);
});

watch(searchResults, () => {
  selectedIdx.value = 0;
});

function pickResult(r: SearchResult) {
  if (r.kind === 'task' && r.taskId) emit('openTask', r.taskId);
  else if (r.page) emit('navigate', r.page, r.groupId);
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

async function saveCapture() {
  const title = capTitle.value.trim();
  if (!title) return;
  const start = capWhen.value === 'tomorrow' ? addDays(now.value, 1) : now.value;
  const link = capLink.value.trim();
  await addTask({
    title,
    notes: capNote.value.trim() || undefined,
    start,
    end: start,
    flex: capWhen.value === 'someday' || capStatus.value === 'backlog' ? 'someday' : undefined,
    status: capStatus.value === 'todo' ? undefined : capStatus.value,
    priority: capPriority.value === 'none' ? undefined : capPriority.value,
    starred: capStarred.value || undefined,
    progress: capStatus.value === 'in_review' ? 85 : capStatus.value === 'in_progress' ? 50 : 0,
    groupId: capGroupId.value || undefined,
    links: link ? [{ id: uid(), title: link.replace(/^https?:\/\//, '').split('/')[0] || link, url: link }] : undefined,
  });
  emit('close');
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
            <button
              v-for="(r, i) in searchResults"
              :key="r.id"
              type="button"
              class="qm-res-row"
              :class="{ active: selectedIdx === i }"
              @mouseenter="selectedIdx = i"
              @click="pickResult(r)"
            >
              <GroupSquircle v-if="r.kind === 'group'" :name="r.title" :color-key="r.groupColorKey" :icon="r.groupIcon" :size="16" />
              <StatusGlyph v-else-if="r.kind === 'task' && r.taskStatus" :status="r.taskStatus" :size="14" />
              <FIcon v-else :name="r.icon" :size="13" class="qm-r-ico" />
              <span class="qm-r-title">{{ r.title }}</span>
              <PriorityGlyph v-if="r.taskPriority && r.taskPriority !== 'none'" :priority="r.taskPriority" :size="12" />
              <span v-if="r.taskCode" class="qm-r-code">{{ r.taskCode }}</span>
              <span v-if="r.sub" class="qm-r-sub">{{ r.sub }}</span>
            </button>
            <div v-if="!searchResults.length" class="qm-empty">没有找到匹配的任务或视图</div>
          </div>
          <div v-if="!isPhone && !isTouch" class="qm-hint-bar">
            <span><kbd>↑↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 打开 / 跳转</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </div>
        </div>

        <!-- Folio Capture Modal -->
        <form
          v-else
          class="qm-cap-body"
          @submit.prevent="saveCapture"
          @keydown.ctrl.enter.prevent="saveCapture"
        >
          <input
            ref="captureBoxRef"
            v-model="capTitle"
            type="text"
            class="qm-cap-title"
            placeholder="任务或想法名称…"
          />
          <textarea
            v-model="capNote"
            class="qm-cap-note"
            rows="3"
            placeholder="补充说明或备注（可选）…"
          />
          <input
            v-model="capLink"
            type="text"
            class="qm-cap-link"
            placeholder="关联链接 https://... 或文件路径（可选）"
          />

          <div class="qm-cap-row">
            <div class="qm-pills">
              <button
                type="button"
                class="qm-pill"
                :class="{ active: capWhen === 'today' }"
                @click="capWhen = 'today'"
              >
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
              <button
                type="button"
                class="qm-pill"
                :class="{ active: capWhen === 'someday' }"
                @click="capWhen = 'someday'"
              >
                收集箱
              </button>
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

          <div class="qm-cap-foot">
            <span v-if="!isPhone && !isTouch" class="qm-cap-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 快速保存</span>
            <span v-else />
            <div class="qm-cap-btns">
              <button type="button" class="qm-cancel" @click="emit('close')">取消</button>
              <button type="submit" class="ws-cta-btn qm-save" :disabled="!capTitle.trim()">保存</button>
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

.ws-modal-card.phone .qm-cancel,
.ws-modal-card.phone .qm-save {
  height: 38px;
}
</style>
