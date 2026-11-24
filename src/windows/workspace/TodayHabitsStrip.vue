<script setup lang="ts">
import { computed } from 'vue';
import { FIcon, showMenu, type MenuItem } from '@/fluent';
import type { ISODate } from '@/types';
import {
  isHabitTask,
  resolveHabit,
  stepCountHabit,
  toggleCheckHabit,
  toggleQuitRelapse,
  toggleSkipHabit,
  type ResolvedHabit,
} from '@/lib/habits';
import { saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { doc, taskList } from '@/stores/doc';
import { notify } from '../desk/state';
import HabitEmblem from './HabitEmblem.vue';
import NumberPop from './NumberPop.vue';

const props = withDefaults(
  defineProps<{
    date: ISODate;
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const emit = defineEmits<{
  openHabits: [];
}>();

const weekStart = computed<0 | 1>(() => doc.settings.calendar.weekStart);

const habits = computed<ResolvedHabit[]>(() =>
  taskList.value
    .filter(isHabitTask)
    .filter((t) => !t.habit.archived)
    .map((t) => resolveHabit(t, props.date, now.value, weekStart.value))
    .sort((a, b) => a.task.order - b.task.order || a.task.createdAt - b.task.createdAt),
);

const summary = computed(() => {
  let done = 0;
  let active = 0;
  for (const h of habits.value) {
    if (h.day.state === 'skip') continue;
    active++;
    if (h.day.state === 'done') done++;
  }
  return { done, active, allDone: active > 0 && done === active };
});

async function onQuickTap(h: ResolvedHabit) {
  if (props.date > now.value) return;
  let next = h.meta;
  if (h.meta.kind === 'check') {
    next = toggleCheckHabit(h.meta, props.date);
  } else if (h.meta.kind === 'count') {
    next = stepCountHabit(h.meta, props.date);
  } else {
    next = toggleQuitRelapse(h.meta, props.date);
  }
  await saveTask({ ...h.task, habitOnly: true, habit: next });
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(8);
    } catch {
      /* ignore */
    }
  }
}

async function onQuickSkip(h: ResolvedHabit) {
  if (props.date > now.value) return;
  const next = toggleSkipHabit(h.meta, props.date);
  await saveTask({ ...h.task, habitOnly: true, habit: next });
  notify(next.logs?.[props.date] === 'skip' ? `「${h.task.title}」已标请假` : `已取消「${h.task.title}」请假`, true);
}

function openStripMenu(h: ResolvedHabit, e: MouseEvent) {
  if (props.date > now.value) return;
  const primaryLabel =
    h.meta.kind === 'check'
      ? h.day.state === 'done'
        ? '取消当日打卡'
        : '打卡完成'
      : h.meta.kind === 'count'
        ? `增加 +${h.meta.step ?? 1}${h.meta.unit || ''}`
        : h.day.state === 'relapse'
          ? '恢复当日稳住'
          : '记录当日破戒';

  const items: MenuItem[] = [
    {
      label: primaryLabel,
      icon: 'check',
      action: () => void onQuickTap(h),
    },
    {
      label: h.day.state === 'skip' ? '取消请假跳过' : '今日请假跳过',
      icon: 'moon',
      action: () => void onQuickSkip(h),
    },
    { separator: true },
    {
      label: '打开每日习惯…',
      icon: 'flame',
      action: () => emit('openHabits'),
    },
  ];
  void showMenu(items, { x: e.clientX, y: e.clientY });
}
</script>

<template>
  <section v-if="habits.length" class="ths-wrap" :class="{ compact }" aria-label="每日习惯快捷打卡">
    <div class="ths-head">
      <div class="ths-title-group">
        <FIcon name="flame" :size="12" class="ths-ico" />
        <span class="ths-title">每日习惯</span>
        <span class="ths-badge tabular" :class="{ full: summary.allDone }">
          <template v-if="summary.allDone">全部达成 ✓</template>
          <template v-else><NumberPop :value="summary.done" />/{{ summary.active }}</template>
        </span>
      </div>
      <button type="button" class="ths-more" @click="emit('openHabits')">
        <span>全部</span>
        <FIcon name="chevronRight" :size="11" />
      </button>
    </div>

    <div class="ths-strip">
      <button
        v-for="h in habits"
        :key="h.task.id"
        type="button"
        class="ths-pill"
        :class="{
          done: h.day.state === 'done',
          relapse: h.day.state === 'relapse',
          skip: h.day.state === 'skip',
        }"
        :style="{ '--hb-tint': h.meta.color }"
        :disabled="date > now"
        @click="onQuickTap(h)"
        @contextmenu.prevent="openStripMenu(h, $event)"
      >
        <HabitEmblem :icon-key="h.meta.iconKey" :color="h.meta.color" :size="24" :radius="7" />
        <span class="ths-copy">
          <strong class="ths-name">{{ h.task.title }}</strong>
          <small class="ths-sub tabular">
            <template v-if="h.day.state === 'skip'">已跳过</template>
            <template v-else-if="h.meta.kind === 'quit'">
              {{ h.day.state === 'relapse' ? '已破戒' : `稳住 ${h.currentStreak}天` }}
            </template>
            <template v-else-if="h.meta.kind === 'count'">
              {{ h.day.value }}/{{ h.meta.target }}{{ h.meta.unit || '' }}
            </template>
            <template v-else>
              {{ h.day.state === 'done' ? '已完成' : '点我打卡' }}
            </template>
          </small>
        </span>
        <span class="ths-check" aria-hidden="true">
          <FIcon v-if="h.day.state === 'done'" name="check" :size="11" />
          <FIcon v-else-if="h.day.state === 'relapse'" name="warning" :size="11" />
          <span v-else-if="h.meta.kind === 'count'" class="ths-plus">+</span>
        </span>
        <!-- Subtle Bottom Micro-Progress Bar for Quantitative Habits -->
        <span
          v-if="h.meta.kind === 'count' && h.day.ratio > 0"
          class="ths-micro-bar"
          aria-hidden="true"
        >
          <span class="ths-micro-fill" :style="{ width: `${Math.round(h.day.ratio * 100)}%` }" />
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.ths-wrap {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 12px;
}

.ths-wrap.compact {
  padding: 0 14px;
  margin: 6px 0 8px;
}

.ths-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}

.ths-title-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ths-ico {
  color: #10a37f;
}

.ths-title {
  font-size: 12px;
  font-weight: 740;
  color: var(--ws-ink-secondary);
}

.ths-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
  font-size: 10.5px;
  font-weight: 760;
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out), color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-badge.full {
  background: rgba(16, 163, 127, 0.16);
  color: #0d8a6b;
}

.ths-more {
  border: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 640;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}

.ths-more:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.ths-strip {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 1px 4px;
  scrollbar-width: none;
}

.ths-strip::-webkit-scrollbar {
  display: none;
}

.ths-pill {
  --hb-tint: #10a37f;
  position: relative;
  overflow: hidden;
  flex: none;
  min-width: 138px;
  max-width: 196px;
  padding: 7px 9px 8px 8px;
  border-radius: 15px;
  border: 1px solid color-mix(in srgb, var(--hb-tint) 20%, transparent);
  background: color-mix(in srgb, var(--hb-tint) 10%, var(--ws-card-bg));
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-pill:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--hb-tint) 42%, transparent);
}

.ths-pill:active {
  transform: scale(0.96);
}

.ths-pill.done {
  background: color-mix(in srgb, var(--hb-tint) 18%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--hb-tint) 48%, transparent);
}

.ths-pill.relapse {
  border-color: color-mix(in srgb, #f59e0b 48%, transparent);
  background: color-mix(in srgb, #f59e0b 12%, var(--ws-card-bg));
}

.ths-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ths-name {
  font-size: 12.5px;
  font-weight: 740;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ths-sub {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
}

.ths-check {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--hb-tint) 45%, transparent);
  display: inline-grid;
  place-items: center;
  color: var(--hb-tint);
  flex: none;
  font-size: 13px;
  font-weight: 800;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-fast, 250ms) var(--ease-bounce);
}

.ths-pill.done .ths-check {
  background: var(--hb-tint);
  border-color: var(--hb-tint);
  color: #ffffff;
}

.ths-pill.relapse .ths-check {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.ths-plus {
  line-height: 1;
}

.ths-micro-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2.5px;
  background: color-mix(in srgb, var(--hb-tint) 14%, transparent);
  pointer-events: none;
}

.ths-micro-fill {
  display: block;
  height: 100%;
  background: var(--hb-tint);
  border-radius: 0 999px 999px 0;
  transition: width 320ms var(--ease-smooth-out);
}

.tabular {
  font-variant-numeric: tabular-nums;
}
</style>

<style>
html[data-ws-theme='dark'] .ths-badge.full {
  background: rgba(52, 211, 153, 0.2);
  color: #6ee7b7;
}
</style>
