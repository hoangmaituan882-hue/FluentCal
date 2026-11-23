<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { FIcon, place, taskColor } from '@/fluent';
import type { Task } from '@/types';
import { formatFriendly } from '@/lib/date';
import {
  buildDependencyGraph,
  checklistStats,
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  STATUS_META,
  taskShortCode,
} from '@/lib/taskMeta';
import { saveTask } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, taskList } from '@/stores/doc';
import GroupSquircle from './GroupSquircle.vue';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import { cancelTaskPreview, hideTaskPreview, keepTaskPreview, taskHoverState } from './useTaskHoverPreview';

const emit = defineEmits<{
  openTask: [taskId: string];
}>();

const cardRef = ref<HTMLElement>();
const pos = ref({ left: 0, top: 0 });

const task = computed<Task | null>(() => {
  const t = taskHoverState.task;
  return t ? (doc.tasks[t.id] ?? t) : null;
});

const status = computed(() => (task.value ? effectiveWorkspaceStatus(task.value) : 'todo'));
const priority = computed(() => (task.value ? effectivePriority(task.value) : 'none'));
const group = computed(() => (task.value?.groupId ? doc.groups[task.value.groupId] : undefined));
const groupHex = computed(() => (group.value ? taskColor(group.value.color, isDark.value).bar : '#9E9990'));

const depGraph = computed(() => buildDependencyGraph(taskList.value));
const blockedByList = computed(() => (task.value ? depGraph.value.blockedBy.get(task.value.id) ?? [] : []));
const blockingList = computed(() => (task.value ? depGraph.value.blocking.get(task.value.id) ?? [] : []));
const chk = computed(() => checklistStats(task.value?.checklist));

async function reposition() {
  if (!taskHoverState.open || !taskHoverState.anchor) return;
  await nextTick();
  const cardEl = cardRef.value;
  if (!cardEl || !taskHoverState.anchor.isConnected) return;
  const a = taskHoverState.anchor.getBoundingClientRect();
  const placed = place(
    { left: a.left, top: a.top, width: a.width, height: a.height },
    cardEl.offsetWidth,
    cardEl.offsetHeight,
    'right-start',
    10,
  );
  pos.value = { left: placed.left, top: placed.top };
}

watch(
  () => [taskHoverState.open, taskHoverState.task?.id, taskHoverState.anchor] as const,
  ([isOpen]) => {
    if (isOpen) void reposition();
  },
  { flush: 'post' },
);

function openCardTask(id: string) {
  cancelTaskPreview();
  emit('openTask', id);
}

function toggleCardStar() {
  if (!task.value) return;
  void saveTask({ ...task.value, starred: !task.value.starred || undefined });
}
</script>

<template>
  <Teleport to="body">
    <Transition name="thc-pop">
      <div
        v-if="taskHoverState.open && task"
        ref="cardRef"
        class="task-hover-card"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
        role="tooltip"
        @pointerenter="keepTaskPreview"
        @pointerleave="hideTaskPreview"
      >
        <div class="thc-head">
          <div class="thc-status-row">
            <StatusGlyph :status="status" :size="15" />
            <span class="thc-status-lbl">{{ STATUS_META[status].label }}</span>
          </div>
          <div class="thc-head-right">
            <span class="thc-code">{{ taskShortCode(task) }}</span>
            <button
              type="button"
              class="thc-star-btn"
              :class="{ active: !!task.starred }"
              :title="task.starred ? '取消星标置顶' : '加入星标置顶'"
              @click.stop="toggleCardStar"
            >
              <FIcon :name="task.starred ? 'starFill' : 'star'" :size="12" />
            </button>
          </div>
        </div>

        <div class="thc-title" @click="openCardTask(task.id)">{{ task.title }}</div>

        <div class="thc-pills">
          <span v-if="group" class="thc-pill">
            <i class="thc-dot" :style="{ background: groupHex }" />
            <span>{{ group.name }}</span>
          </span>
          <span class="thc-pill muted">
            <span>{{ task.flex ? '待排期' : formatFriendly(task.start, now) }}</span>
          </span>
          <span v-if="chk.total > 0" class="thc-pill muted">
            <span>子步骤 {{ chk.done }}/{{ chk.total }}</span>
          </span>
        </div>

        <div v-if="blockingList.length || blockedByList.length" class="thc-deps">
          <button
            v-for="b in blockingList.slice(0, 2)"
            :key="`bg:${b.id}`"
            type="button"
            class="thc-dep-row"
            @click="openCardTask(b.id)"
          >
            <span class="dep-badge blocking">! 阻塞</span>
            <StatusGlyph :status="effectiveWorkspaceStatus(b)" :size="12" />
            <span class="dep-code">{{ taskShortCode(b) }}</span>
            <span class="dep-title">{{ b.title }}</span>
          </button>

          <button
            v-for="pred in blockedByList.slice(0, 2)"
            :key="`bb:${pred.id}`"
            type="button"
            class="thc-dep-row"
            @click="openCardTask(pred.id)"
          >
            <span class="dep-badge blocked">- 被阻塞</span>
            <StatusGlyph :status="effectiveWorkspaceStatus(pred)" :size="12" />
            <span class="dep-code">{{ taskShortCode(pred) }}</span>
            <span class="dep-title">{{ pred.title }}</span>
          </button>
        </div>

        <div class="thc-foot">
          <div class="thc-pri">
            <PriorityGlyph :priority="priority" :size="14" />
            <span>{{ PRIORITY_META[priority].label }}</span>
          </div>
          <GroupSquircle
            v-if="group"
            :name="group.name"
            :color-key="group.color"
            :icon="group.icon"
            :size="18"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.task-hover-card {
  position: fixed;
  z-index: 95;
  width: 286px;
  padding: 13px 14px 11px;
  border-radius: 14px;
  background: var(--ws-card-bg, #ffffff);
  border: 1px solid var(--ws-hairline, rgba(28, 25, 23, 0.09));
  box-shadow: var(--ws-shadow-float, 0 18px 48px rgba(24, 22, 19, 0.16), 0 2px 8px rgba(24, 22, 19, 0.06));
  color: var(--ws-ink, #1c1b19);
  font-family: var(--font-ui);
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.thc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.thc-status-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.thc-status-lbl {
  font-size: 11.5px;
  font-weight: 550;
  color: var(--ws-ink-secondary, #6e6a63);
}

.thc-code {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--ws-ink-muted, #9e9990);
}

.thc-head-right {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.thc-star-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ws-ink-muted, #9e9990);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.thc-star-btn:hover {
  background: var(--ws-stone-pill, rgba(0, 0, 0, 0.052));
  color: var(--ws-ink, #1c1b19);
}

.thc-star-btn.active {
  color: #F59E0B;
}

.thc-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ws-ink);
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.thc-title:hover {
  text-decoration: underline;
  text-decoration-color: var(--ws-hairline-strong);
}

.thc-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.thc-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 7px;
  background: var(--ws-card-subtle, #f4f3ef);
  border: 1px solid var(--ws-hairline);
  font-size: 11.5px;
  font-weight: 550;
  color: var(--ws-ink);
}

.thc-pill.muted {
  color: var(--ws-ink-secondary);
  font-weight: 500;
}

.thc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.thc-deps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.thc-dep-row {
  border: 0;
  background: var(--ws-card-subtle);
  border-radius: 8px;
  padding: 4px 7px;
  display: flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  color: var(--ws-ink);
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease;
}

.thc-dep-row:hover {
  background: var(--ws-pill-bg);
}

.dep-badge {
  font-size: 10.5px;
  font-weight: 650;
  padding: 1px 5px;
  border-radius: 5px;
  flex: none;
}

.dep-badge.blocking {
  color: #D97706;
  background: rgba(217, 119, 6, 0.14);
}

.dep-badge.blocked {
  color: #E5484D;
  background: rgba(229, 72, 77, 0.14);
}

.dep-code {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace;
  font-size: 10.5px;
  color: var(--ws-ink-muted);
  flex: none;
}

.dep-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--ws-hairline);
}

.thc-pri {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ws-ink-secondary);
}

.thc-pop-enter-active {
  transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.thc-pop-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}

.thc-pop-enter-from,
.thc-pop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}
</style>
