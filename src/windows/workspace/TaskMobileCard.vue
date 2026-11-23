<script setup lang="ts">
import { computed } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { Task } from '@/types';
import {
  checklistStats,
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  taskShortCode,
} from '@/lib/taskMeta';
import { isDark } from '@/composables/theme';
import { doc } from '@/stores/doc';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';

const props = defineProps<{
  task: Task;
  scopedGroupId?: string;
  dateHintText: string;
  expandedKind?: 'sub' | 'blocked' | 'blocking';
  blockedBy: Task[];
  blocking: Task[];
  inlineStepDraft: string;
}>();

const emit = defineEmits<{
  openTask: [id: string];
  statusClick: [e: MouseEvent];
  priorityClick: [e: MouseEvent];
  toggleStar: [];
  openMenu: [e: MouseEvent];
  toggleExpand: [kind: 'sub' | 'blocked' | 'blocking'];
  toggleCheckStep: [stepId: string];
  'update:inlineStepDraft': [val: string];
  addInlineCheckStep: [];
  openRelatedTask: [id: string];
}>();

const status = computed(() => effectiveWorkspaceStatus(props.task));
const priority = computed(() => effectivePriority(props.task));
const isDone = computed(() => status.value === 'done');
const chkStats = computed(() => checklistStats(props.task.checklist));

const group = computed(() =>
  !props.scopedGroupId && props.task.groupId ? doc.groups[props.task.groupId] : undefined,
);

const groupHex = computed(() => {
  const gColor = group.value?.color;
  if (!props.task.color && !gColor) return '#9E9990';
  return taskColor(props.task.color || gColor, isDark.value).bar;
});

const hasDisclosures = computed(
  () => !!props.task.checklist?.length || props.blockedBy.length > 0 || props.blocking.length > 0,
);

function onDraftInput(e: Event) {
  emit('update:inlineStepDraft', (e.target as HTMLInputElement).value);
}
</script>

<template>
  <article
    class="tmc-card"
    :class="{ done: isDone }"
    @click="emit('openTask', task.id)"
  >
    <!-- Row 1: Tactile Status + Wrapping Title + Star + Menu -->
    <div class="tmc-head">
      <button
        type="button"
        class="tmc-status-hit"
        title="切换状态"
        aria-label="切换状态"
        @click.stop="emit('statusClick', $event)"
      >
        <StatusGlyph :status="status" :size="17" interactive />
      </button>

      <div class="tmc-title">{{ task.title }}</div>

      <div class="tmc-actions" @click.stop>
        <button
          type="button"
          class="tmc-act-btn"
          :class="{ starred: !!task.starred }"
          :title="task.starred ? '取消星标置顶' : '加入星标置顶'"
          :aria-label="task.starred ? '取消星标置顶' : '加入星标置顶'"
          @click="emit('toggleStar')"
        >
          <FIcon :name="task.starred ? 'starFill' : 'star'" :size="14" />
        </button>
        <button
          type="button"
          class="tmc-act-btn"
          title="更多操作"
          aria-label="更多操作"
          @click="emit('openMenu', $event)"
        >
          <FIcon name="more" :size="14" />
        </button>
      </div>
    </div>

    <!-- Row 2: Crisp Metadata Chips & Expand Disclosures -->
    <div class="tmc-meta">
      <button
        v-if="priority !== 'none'"
        type="button"
        class="tmc-chip interactive"
        @click.stop="emit('priorityClick', $event)"
      >
        <PriorityGlyph :priority="priority" :size="12" />
        <span>{{ PRIORITY_META[priority].label }}</span>
      </button>

      <button
        v-if="group"
        type="button"
        class="tmc-chip interactive"
        @click.stop="emit('openTask', task.id)"
      >
        <span class="tmc-dot" :style="{ background: groupHex }" />
        <span class="tmc-grp-lbl">{{ group.name }}</span>
      </button>

      <span class="tmc-chip muted">{{ dateHintText }}</span>

      <button
        v-if="task.checklist?.length"
        type="button"
        class="tmc-chip interactive disc"
        :class="{ open: expandedKind === 'sub' }"
        @click.stop="emit('toggleExpand', 'sub')"
      >
        <FIcon name="checklist" :size="11" />
        <span>子步骤 {{ chkStats.done }}/{{ task.checklist.length }}</span>
        <FIcon name="chevronDown" :size="9" class="tmc-chev" />
      </button>

      <button
        v-if="blockedBy.length"
        type="button"
        class="tmc-chip interactive disc blocked"
        :class="{ open: expandedKind === 'blocked' }"
        @click.stop="emit('toggleExpand', 'blocked')"
      >
        <FIcon name="error" :size="11" class="tmc-danger" />
        <span>被阻塞 {{ blockedBy.length }}</span>
        <FIcon name="chevronDown" :size="9" class="tmc-chev" />
      </button>

      <button
        v-if="blocking.length"
        type="button"
        class="tmc-chip interactive disc blocking"
        :class="{ open: expandedKind === 'blocking' }"
        @click.stop="emit('toggleExpand', 'blocking')"
      >
        <FIcon name="warning" :size="11" class="tmc-warn" />
        <span>阻塞他人 {{ blocking.length }}</span>
        <FIcon name="chevronDown" :size="9" class="tmc-chev" />
      </button>

      <span v-if="!hasDisclosures && priority === 'none' && !group" class="tmc-code-inline">{{ taskShortCode(task) }}</span>
    </div>

    <!-- Expanded Inline Sub-Checklist / Dependencies Drawer -->
    <div v-if="expandedKind === 'sub' && task.checklist?.length" class="tmc-drawer" @click.stop>
      <div
        v-for="step in task.checklist"
        :key="step.id"
        class="tmc-sub-row"
        :class="{ done: step.done }"
        @click="emit('toggleCheckStep', step.id)"
      >
        <span class="ws-check-circle tmc-chk" :class="{ done: step.done }">
          <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
        </span>
        <span class="tmc-sub-lbl">{{ step.text }}</span>
      </div>
      <form class="tmc-add-form" @submit.prevent="emit('addInlineCheckStep')">
        <FIcon name="add" :size="12" class="tmc-add-ico" />
        <input
          :value="inlineStepDraft"
          type="text"
          class="tmc-add-input"
          placeholder="添加子步骤，回车确认…"
          @input="onDraftInput"
        />
      </form>
    </div>

    <div v-else-if="expandedKind === 'blocked' && blockedBy.length" class="tmc-drawer" @click.stop>
      <button
        v-for="pred in blockedBy"
        :key="pred.id"
        type="button"
        class="tmc-dep-row"
        @click="emit('openRelatedTask', pred.id)"
      >
        <StatusGlyph :status="effectiveWorkspaceStatus(pred)" :size="13" />
        <span class="tmc-dep-title">{{ pred.title }}</span>
        <span class="tmc-dep-tag">前置</span>
      </button>
    </div>

    <div v-else-if="expandedKind === 'blocking' && blocking.length" class="tmc-drawer" @click.stop>
      <button
        v-for="succ in blocking"
        :key="succ.id"
        type="button"
        class="tmc-dep-row"
        @click="emit('openRelatedTask', succ.id)"
      >
        <StatusGlyph :status="effectiveWorkspaceStatus(succ)" :size="13" />
        <span class="tmc-dep-title">{{ succ.title }}</span>
        <span class="tmc-dep-tag">等待此项</span>
      </button>
    </div>
  </article>
</template>

<style scoped>
.tmc-card {
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  border-radius: 14px;
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--ws-shadow-sm);
  cursor: pointer;
  transition: transform 120ms var(--ws-ease-out), border-color 140ms ease, background-color 140ms ease;
}

.tmc-card:active {
  transform: scale(0.992);
  background: var(--ws-card-hover);
}

.tmc-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.tmc-status-hit {
  width: 30px;
  height: 30px;
  margin: -4px 0 -4px -5px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  cursor: pointer;
}

.tmc-title {
  flex: 1;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 560;
  line-height: 1.38;
  color: var(--ws-ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.tmc-card.done .tmc-title {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.tmc-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: -4px -4px -4px 0;
  flex: none;
}

.tmc-act-btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.tmc-act-btn:active {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.tmc-act-btn.starred {
  color: #F59E0B;
}

.tmc-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-left: 31px;
}

.tmc-chip {
  height: 24px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
}

.tmc-chip.muted {
  border-color: transparent;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
}

.tmc-chip.interactive {
  cursor: pointer;
}

.tmc-chip.disc.open {
  background: var(--ws-stone-pill-hover);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.tmc-chev {
  transition: transform 150ms var(--ws-ease-out);
}

.tmc-chip.disc.open .tmc-chev {
  transform: rotate(180deg);
}

.tmc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.tmc-grp-lbl {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tmc-danger {
  color: #E5484D;
}

.tmc-warn {
  color: #D97706;
}

.tmc-code-inline {
  font-family: ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace;
  font-size: 10.5px;
  color: var(--ws-ink-muted);
}

.tmc-drawer {
  margin-left: 31px;
  padding: 6px 0 2px 10px;
  border-left: 1.5px solid var(--ws-hairline-strong);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tmc-sub-row,
.tmc-dep-row {
  min-height: 34px;
  padding: 4px 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 9px;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.tmc-sub-row:active,
.tmc-dep-row:active {
  background: var(--ws-card-subtle);
}

.tmc-sub-row.done .tmc-sub-lbl {
  text-decoration: line-through;
  color: var(--ws-ink-muted);
}

.tmc-chk {
  width: 16px;
  height: 16px;
}

.tmc-sub-lbl,
.tmc-dep-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tmc-dep-tag {
  font-size: 11px;
  color: var(--ws-ink-muted);
  flex: none;
}

.tmc-add-form {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 8px;
  border-radius: 9px;
  background: var(--ws-card-subtle);
}

.tmc-add-ico {
  color: var(--ws-ink-muted);
}

.tmc-add-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
</style>
