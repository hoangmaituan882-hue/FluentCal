<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import type { Task } from '@/types';
import { addDays, formatFriendly } from '@/lib/date';
import { flexKind, MONTH } from '@/lib/flex';
import { addTask, saveTask, setOccurrenceDone } from '@/lib/tasks';
import { uid } from '@/lib/uid';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, groupList, taskList } from '@/stores/doc';
import { classifyTaskBucket } from './workspaceModel';

const props = defineProps<{
  searchQuery: string;
  filterGroupId: string;
}>();

const emit = defineEmits<{
  openTask: [taskId: string];
}>();

const captureText = ref('');
const captureLink = ref('');
const captureGroupId = ref('');
const showLinkInput = ref(false);
const activeIdx = ref(0);

const triageItems = computed<Task[]>(() => {
  const q = props.searchQuery.trim().toLowerCase();
  const todayIso = now.value;
  return taskList.value
    .filter((t) => {
      if (props.filterGroupId === '__ungrouped__' && t.groupId) return false;
      if (props.filterGroupId && props.filterGroupId !== '__ungrouped__' && t.groupId !== props.filterGroupId) return false;
      const b = classifyTaskBucket(t, todayIso);
      if (b !== 'anytime' && b !== 'overdue') return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.notes?.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
});

const selectedGroupLabel = computed(() =>
  captureGroupId.value ? (doc.groups[captureGroupId.value]?.name ?? '无分组') : '无分组',
);

async function submitCapture() {
  const title = captureText.value.trim();
  if (!title) return;
  const linkUrl = captureLink.value.trim();
  captureText.value = '';
  captureLink.value = '';
  showLinkInput.value = false;
  await addTask({
    title,
    start: now.value,
    end: now.value,
    flex: 'someday',
    groupId: captureGroupId.value || (props.filterGroupId && props.filterGroupId !== '__ungrouped__' ? props.filterGroupId : undefined),
    links: linkUrl ? [{ id: uid(), title: linkUrl.replace(/^https?:\/\//, '').split('/')[0] || linkUrl, url: linkUrl }] : undefined,
  });
}

function groupHex(t: Task): string {
  const gColor = t.groupId ? doc.groups[t.groupId]?.color : undefined;
  return t.color || gColor ? taskColor(t.color || gColor, isDark.value).bar : '#9E9990';
}

function kindLabel(t: Task): string {
  const fk = flexKind(t);
  if (fk === MONTH) return '本月待安排';
  if (fk) return '随时 / 收集箱';
  return `已逾期 · ${formatFriendly(t.end, now.value)}`;
}

function scheduleFor(t: Task, targetDate: string) {
  void saveTask({
    ...t,
    flex: undefined,
    flexDone: undefined,
    start: targetDate,
    end: targetDate,
  });
}

function completeItem(t: Task) {
  const fk = flexKind(t);
  if (fk) {
    const slot = fk === MONTH ? `m:${now.value.slice(0, 7)}` : 's:';
    void setOccurrenceDone(t, slot, true);
    return;
  }
  void saveTask({ ...t, done: true, status: 'done', progress: 100 });
}

function pickCaptureGroup(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '无分组', radio: true, checked: !captureGroupId.value, action: () => (captureGroupId.value = '') },
    ...groupList.value.map((g) => ({
      label: g.name,
      radio: true,
      checked: captureGroupId.value === g.id,
      action: () => (captureGroupId.value = g.id),
    })),
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function pickItemGroup(t: Task, e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    {
      label: '无分组',
      radio: true,
      checked: !t.groupId,
      action: () => void saveTask({ ...t, groupId: undefined }),
    },
    ...groupList.value.map((g) => ({
      label: g.name,
      radio: true,
      checked: t.groupId === g.id,
      action: () => void saveTask({ ...t, groupId: g.id }),
    })),
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (el?.matches?.('input, textarea, [contenteditable="true"]')) return;
  if (!triageItems.value.length) return;
  const max = triageItems.value.length - 1;
  const idx = Math.max(0, Math.min(max, activeIdx.value));
  const current = triageItems.value[idx];
  if (!current) return;

  if (e.key === 'ArrowDown') {
    activeIdx.value = Math.min(max, idx + 1);
  } else if (e.key === 'ArrowUp') {
    activeIdx.value = Math.max(0, idx - 1);
  } else if (e.key.toLowerCase() === 't') {
    scheduleFor(current, now.value);
  } else if (e.key.toLowerCase() === 'e') {
    completeItem(current);
  } else if (e.key === 'Enter') {
    emit('openTask', current.id);
  } else return;
  e.preventDefault();
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="ws-scroll-page">
    <div class="ws-container inbox-wrap">
      <header>
        <h1 class="ws-page-title">收集箱</h1>
        <p class="ws-page-sub">{{ triageItems.length }} 项待整理 · 随手捕捉想法、链接或逾期未排事项</p>
      </header>

      <!-- Folio Capture Card -->
      <form class="ws-card capture-card" @submit.prevent="submitCapture">
        <input
          v-model="captureText"
          type="text"
          class="cap-input"
          placeholder="捕捉一条想法、任务或备忘，回车快速收入收集箱…"
        />
        <input
          v-if="showLinkInput"
          v-model="captureLink"
          type="text"
          class="cap-link-input"
          placeholder="可选：粘贴网页链接或参考路径 https://..."
        />
        <div class="cap-foot">
          <div class="cap-opts">
            <button type="button" class="cap-chip" @click="showLinkInput = !showLinkInput">
              <FIcon name="link" :size="11" />
              <span>{{ showLinkInput ? '收起链接' : '附带链接' }}</span>
            </button>
            <button type="button" class="cap-chip" @click="pickCaptureGroup">
              <FIcon name="group" :size="11" />
              <span>{{ selectedGroupLabel }}</span>
            </button>
          </div>
          <button type="submit" class="ws-cta-btn cap-submit" :disabled="!captureText.trim()">捕捉</button>
        </div>
      </form>

      <!-- Triage Cards -->
      <div v-if="triageItems.length" class="triage-list">
        <div
          v-for="(t, i) in triageItems"
          :key="t.id"
          class="ws-card triage-card"
          :class="{ focused: activeIdx === i }"
          @mouseenter="activeIdx = i"
          @click="emit('openTask', t.id)"
        >
          <div class="tc-top">
            <div class="tc-meta">
              <span class="tc-badge">{{ kindLabel(t) }}</span>
              <span v-if="t.groupId && doc.groups[t.groupId]" class="tc-group">
                <i class="tc-dot" :style="{ background: groupHex(t) }" />
                {{ doc.groups[t.groupId].name }}
              </span>
            </div>
            <span class="tc-title">{{ t.title }}</span>
            <p v-if="t.notes" class="tc-notes">{{ t.notes }}</p>
          </div>

          <div class="tc-actions" @click.stop>
            <button type="button" class="tc-act-btn" @click="scheduleFor(t, now)">
              <FIcon name="today" :size="11" />
              <span>今天</span>
            </button>
            <button type="button" class="tc-act-btn" @click="scheduleFor(t, addDays(now, 1))">
              <FIcon name="forward" :size="11" />
              <span>明天</span>
            </button>
            <button type="button" class="tc-act-btn" @click="pickItemGroup(t, $event)">
              <FIcon name="group" :size="11" />
              <span>分组</span>
            </button>
            <button type="button" class="tc-act-btn" @click="emit('openTask', t.id)">
              <FIcon name="edit" :size="11" />
              <span>详情</span>
            </button>
            <button type="button" class="tc-act-btn done" @click="completeItem(t)">
              <FIcon name="checkMark" :size="11" />
              <span>完成</span>
            </button>
          </div>
        </div>
      </div>
      <div v-else class="ws-card empty-inbox">
        <div class="ei-title">收集箱已清空</div>
        <div class="ei-sub">没有待整理的不定日事项或逾期任务，随时在上方记录新想法。</div>
      </div>

      <footer class="inbox-legend">
        <span><kbd>↑</kbd> <kbd>↓</kbd> 移动</span>
        <span><kbd>T</kbd> 排入今天</span>
        <span><kbd>E</kbd> 标记完成</span>
        <span><kbd>Enter</kbd> 打开详情</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.inbox-wrap {
  max-width: 780px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}

.capture-card {
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 16px;
  transition: border-color 140ms ease, box-shadow 160ms ease;
}

.capture-card:focus-within {
  border-color: var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
}

.cap-input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 14.5px;
  outline: none;
}

.cap-link-input {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font-size: 12.5px;
  box-sizing: border-box;
  outline: none;
}

.cap-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cap-opts {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cap-chip {
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
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.cap-chip:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.cap-submit {
  height: 30px;
  padding: 0 16px;
  font-size: 12.5px;
}

.triage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.triage-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: border-color 140ms ease, transform 160ms var(--ws-ease-out), box-shadow 160ms ease;
}

.triage-card:hover,
.triage-card.focused {
  border-color: var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
}

.tc-top {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tc-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tc-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
}

.tc-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--ws-ink-secondary);
}

.tc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.tc-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ws-ink);
}

.tc-notes {
  margin: 0;
  font-size: 12.5px;
  color: var(--ws-ink-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tc-act-btn {
  height: 27px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}

.tc-act-btn:hover {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.tc-act-btn.done:hover {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.empty-inbox {
  padding: 40px 20px;
  text-align: center;
}

.ei-title {
  font-size: 14.5px;
  font-weight: 600;
}

.ei-sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--ws-ink-muted);
}

.inbox-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  padding-top: 6px;
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.inbox-legend kbd {
  display: inline-block;
  padding: 1px 5px;
  margin-right: 3px;
  border-radius: 4px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-bg);
  font-family: inherit;
  font-size: 10.5px;
  color: var(--ws-ink-secondary);
}
</style>
