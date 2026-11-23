<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import { addDays } from '@/lib/date';
import { addTask } from '@/lib/tasks';
import { uid } from '@/lib/uid';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, groupList, taskList } from '@/stores/doc';
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

const mode = ref<'search' | 'capture'>('search');
const searchInput = ref('');
const searchBoxRef = ref<HTMLInputElement>();
const captureBoxRef = ref<HTMLInputElement>();
const selectedIdx = ref(0);

const capTitle = ref('');
const capNote = ref('');
const capLink = ref('');
const capGroupId = ref('');
const capWhen = ref<'today' | 'tomorrow' | 'someday'>('today');

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
    await nextTick();
    if (m === 'search') searchBoxRef.value?.focus();
    else captureBoxRef.value?.focus();
  },
);

interface SearchResult {
  id: string;
  kind: 'nav' | 'group' | 'task';
  title: string;
  sub?: string;
  icon: string;
  color?: string;
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
    { id: 'nav:gantt', kind: 'nav', title: '项目甘特', sub: '视图', icon: 'gantt', page: 'gantt' },
    { id: 'nav:settings', kind: 'nav', title: '设置', sub: '系统', icon: 'settings', page: 'settings' },
  ];
  const groupEntries: SearchResult[] = groupList.value.map((g) => ({
    id: `grp:${g.id}`,
    kind: 'group',
    title: g.name,
    sub: '分组',
    icon: 'group',
    color: taskColor(g.color, isDark.value).bar,
    page: 'area',
    groupId: g.id,
  }));
  const taskEntries: SearchResult[] = taskList.value
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((t) => ({
      id: `tsk:${t.id}`,
      kind: 'task',
      title: t.title,
      sub: t.groupId && doc.groups[t.groupId] ? doc.groups[t.groupId].name : t.flex ? '收集箱' : t.start,
      icon: t.done ? 'completed' : 'checkboxEmpty',
      taskId: t.id,
    }));

  const combined = [...taskEntries, ...groupEntries, ...navEntries];
  if (!q) {
    return [...navEntries, ...groupEntries.slice(0, 4), ...taskEntries.slice(0, 6)];
  }
  return combined
    .filter((r) => r.title.toLowerCase().includes(q) || r.sub?.toLowerCase().includes(q))
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
    flex: capWhen.value === 'someday' ? 'someday' : undefined,
    groupId: capGroupId.value || undefined,
    links: link ? [{ id: uid(), title: link.replace(/^https?:\/\//, '').split('/')[0] || link, url: link }] : undefined,
  });
  emit('close');
}
</script>

<template>
  <Transition name="ws-modal">
    <div v-if="open" class="ws-modal-backdrop" role="dialog" aria-modal="true" @mousedown.self="emit('close')">
      <div class="ws-modal-card">
        <div class="qm-head">
          <div class="qm-switch" role="tablist">
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
              <span v-if="r.color" class="qm-dot" :style="{ background: r.color }" />
              <FIcon v-else :name="r.icon" :size="13" class="qm-r-ico" />
              <span class="qm-r-title">{{ r.title }}</span>
              <span v-if="r.sub" class="qm-r-sub">{{ r.sub }}</span>
            </button>
            <div v-if="!searchResults.length" class="qm-empty">没有找到匹配的任务或视图</div>
          </div>
        </div>

        <!-- Folio Capture Modal -->
        <form v-else class="qm-cap-body" @submit.prevent="saveCapture">
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

            <select v-model="capGroupId" class="qm-select" aria-label="选择分组">
              <option value="">无分组</option>
              <option v-for="g in groupList" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>

          <div class="qm-cap-foot">
            <button type="button" class="qm-cancel" @click="emit('close')">取消</button>
            <button type="submit" class="ws-cta-btn qm-save" :disabled="!capTitle.trim()">保存</button>
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
  background: rgba(28, 25, 23, 0.24);
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
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  gap: 2px;
}

.qm-sw-btn {
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
  transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}

.qm-sw-btn.active {
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
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
}

.qm-pill.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.qm-select {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font-size: 12px;
  outline: none;
}

.qm-cap-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
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

.qm-save {
  height: 34px;
  padding: 0 18px;
  font-size: 13px;
}
</style>
