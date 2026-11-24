<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon, showMenu, type MenuItem } from '@/fluent';
import type { ISODate } from '@/types';
import {
  evaluateHabitWindow,
  formatClockHHMM,
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
const expandedAll = ref(false);
const collapsedDone = ref(false);
const pulsingId = ref<string | null>(null);
let pulseTimer: ReturnType<typeof setTimeout> | null = null;

// Live minute clock for fixed time-window habits right inside Today Focus
function readNowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
const nowMin = ref<number>(readNowMin());
let clockTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  clockTimer = setInterval(() => {
    nowMin.value = readNowMin();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (pulseTimer) clearTimeout(pulseTimer);
});

const habits = computed<ResolvedHabit[]>(() =>
  taskList.value
    .filter(isHabitTask)
    .filter((t) => !t.habit.archived)
    .map((t) => resolveHabit(t, props.date, now.value, weekStart.value))
    .sort((a, b) => a.task.order - b.task.order || a.task.createdAt - b.task.createdAt),
);

const isToday = computed(() => props.date === now.value);

// Evaluate live window telemetry per habit (only for habits with fixed windows)
const windowMap = computed(() => {
  const map = new Map<string, ReturnType<typeof evaluateHabitWindow>>();
  for (const h of habits.value) {
    if (h.meta.windowStart) {
      map.set(h.task.id, evaluateHabitWindow(h.meta, h.day, nowMin.value, now.value));
    }
  }
  return map;
});

// Active fixed-window habit currently open right now (WWDC25 contextual priority dialogue)
const activeWindowHabit = computed<ResolvedHabit | null>(() => {
  if (!isToday.value) return null;
  for (const h of habits.value) {
    const win = windowMap.value.get(h.task.id);
    if (win && win.phase === 'active' && h.day.state !== 'done' && h.day.state !== 'skip') {
      return h;
    }
  }
  return null;
});

const summary = computed(() => {
  let done = 0;
  let active = 0;
  for (const h of habits.value) {
    if (h.day.state === 'skip') continue;
    active++;
    if (h.day.state === 'done') done++;
  }
  const pct = active > 0 ? Math.round((done / active) * 100) : 0;
  return {
    done,
    active,
    remain: Math.max(0, active - done),
    pct,
    allDone: active > 0 && done === active,
  };
});

// Reset collapsedDone if user unchecks a habit or changes date
watch(
  () => [summary.value.allDone, props.date] as const,
  ([allDone]) => {
    if (!allDone) collapsedDone.value = false;
  },
);

// WWDC25 Height Discipline: show max 4 tiles on phone / 6 on desktop before expanding,
// prioritizing active time-window & incomplete habits when truncated so actionable items stay front-and-center.
const maxCollapsedCount = computed(() => (props.compact ? 4 : 6));

const orderedForSnippet = computed<ResolvedHabit[]>(() => {
  const list = habits.value;
  if (list.length <= maxCollapsedCount.value || expandedAll.value) return list;
  // Prioritize: active time-window -> incomplete -> done/skip, preserving original relative order within each bucket
  return [...list].sort((a, b) => {
    const score = (h: ResolvedHabit) => {
      if (activeWindowHabit.value?.task.id === h.task.id) return 0;
      if (h.day.state === 'done' || h.day.state === 'skip') return 2;
      return 1;
    };
    const d = score(a) - score(b);
    return d !== 0 ? d : a.task.order - b.task.order || a.task.createdAt - b.task.createdAt;
  });
});

const displayedHabits = computed(() =>
  expandedAll.value
    ? orderedForSnippet.value
    : orderedForSnippet.value.slice(0, maxCollapsedCount.value),
);

const hiddenCount = computed(() =>
  Math.max(0, habits.value.length - displayedHabits.value.length),
);

// Glanceable WWDC25 Dialogue Headline
const headlineText = computed(() => {
  if (summary.value.allDone) {
    return isToday.value ? '今日习惯全部达成' : '当日习惯全部达成';
  }
  if (activeWindowHabit.value) {
    const win = windowMap.value.get(activeWindowHabit.value.task.id);
    return `进行中 · ${activeWindowHabit.value.task.title}${win ? `（剩 ${win.primaryReadout}）` : ''}`;
  }
  return isToday.value
    ? `今日习惯 · 还差 ${summary.value.remain} 项`
    : `习惯补签 · ${summary.value.done}/${summary.value.active}`;
});

// Ring SVG geometry for glanceable top-left emblem
const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;
const ringOffset = computed(() => RING_C * (1 - summary.value.pct / 100));

function tileSubtitle(h: ResolvedHabit): string {
  if (h.day.state === 'skip') return '已标请假';
  const win = isToday.value ? windowMap.value.get(h.task.id) : undefined;
  if (win) {
    if (win.phase === 'active') return `窗口剩 ${win.primaryReadout}`;
    if (win.phase === 'done') {
      if (win.doneTime) return `准时 ${win.doneTime}`;
      return h.meta.kind === 'quit' ? `稳住 ${h.currentStreak} 天` : '窗内已达成';
    }
    if (win.phase === 'upcoming') return `距开始 ${win.primaryReadout}`;
  }
  if (h.meta.kind === 'quit') {
    return h.day.state === 'relapse' ? '当日破戒' : `稳住 ${h.currentStreak} 天`;
  }
  if (h.meta.kind === 'count') {
    return `${h.day.value}/${h.meta.target}${h.meta.unit ? ` ${h.meta.unit}` : ''}`;
  }
  if (h.day.state === 'done') {
    const times = h.meta.logTimes?.[props.date];
    const last = times?.length ? times[times.length - 1] : '';
    return last ? `完成于 ${last}` : '今日已完成';
  }
  return h.currentStreak > 0 ? `已连续 ${h.currentStreak} 天` : '轻点打卡';
}

function triggerPulse(taskId: string) {
  if (pulseTimer) clearTimeout(pulseTimer);
  pulsingId.value = taskId;
  pulseTimer = setTimeout(() => {
    pulsingId.value = null;
    pulseTimer = null;
  }, 360);
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(8);
    } catch {
      /* ignore unsupported */
    }
  }
}

async function onQuickTap(h: ResolvedHabit) {
  if (props.date > now.value) return;
  const clock = props.date === now.value ? formatClockHHMM() : undefined;
  let next = h.meta;
  if (h.meta.kind === 'check') {
    next = toggleCheckHabit(h.meta, props.date, clock);
  } else if (h.meta.kind === 'count') {
    next = stepCountHabit(h.meta, props.date, undefined, clock);
  } else {
    next = toggleQuitRelapse(h.meta, props.date);
  }
  await saveTask({ ...h.task, habitOnly: true, habit: next });
  triggerPulse(h.task.id);
}

async function onCountDelta(h: ResolvedHabit, delta: number) {
  if (props.date > now.value) return;
  const clock = props.date === now.value && delta > 0 ? formatClockHHMM() : undefined;
  const next = stepCountHabit(h.meta, props.date, delta, clock);
  await saveTask({ ...h.task, habitOnly: true, habit: next });
  if (delta > 0) triggerPulse(h.task.id);
}

async function onQuickSkip(h: ResolvedHabit) {
  if (props.date > now.value) return;
  const next = toggleSkipHabit(h.meta, props.date);
  await saveTask({ ...h.task, habitOnly: true, habit: next });
  notify(
    next.logs?.[props.date] === 'skip'
      ? `「${h.task.title}」已标请假`
      : `已取消「${h.task.title}」请假`,
    true,
  );
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
  <section
    v-if="habits.length"
    class="ths-wrap ths-snippet"
    :class="{ compact, 'all-done': summary.allDone, collapsed: collapsedDone }"
    aria-label="每日习惯交互式摘要卡片"
  >
    <!-- WWDC25 Snippet Header: Glanceable Progress Ring + Contextual Dialogue + Deep Link -->
    <header class="ths-head">
      <div class="ths-head-left">
        <div class="ths-ring-badge" :class="{ full: summary.allDone }" aria-hidden="true">
          <svg class="ths-ring-svg" viewBox="0 0 32 32">
            <circle class="ths-ring-track" cx="16" cy="16" :r="RING_R" />
            <circle
              class="ths-ring-fill"
              cx="16"
              cy="16"
              :r="RING_R"
              :stroke-dasharray="RING_C"
              :stroke-dashoffset="ringOffset"
            />
          </svg>
          <FIcon v-if="summary.allDone" name="check" :size="12" class="ths-ring-check" />
          <span v-else class="ths-ring-num tabular">
            <NumberPop :value="summary.done" />
          </span>
        </div>

        <div class="ths-head-copy">
          <div class="ths-headline-row">
            <Transition name="ths-swap" mode="out-in">
              <strong :key="headlineText" class="ths-headline">{{ headlineText }}</strong>
            </Transition>
            <span class="ths-ratio-pill tabular" :class="{ full: summary.allDone }">
              <template v-if="summary.allDone">100%</template>
              <template v-else><NumberPop :value="summary.done" />/{{ summary.active }}</template>
            </span>
          </div>

          <!-- Per-Habit Color-Coded Glanceable Spectrum Strip -->
          <div class="ths-spectrum" aria-hidden="true">
            <span
              v-for="h in habits"
              :key="h.task.id"
              class="ths-spec-seg"
              :class="{
                done: h.day.state === 'done',
                partial: h.day.state === 'partial',
                skip: h.day.state === 'skip',
                relapse: h.day.state === 'relapse',
              }"
              :style="{
                '--seg-tint': h.day.state === 'relapse' ? '#f59e0b' : h.meta.color,
              }"
            />
          </div>
        </div>
      </div>

      <div class="ths-head-acts">
        <button
          v-if="summary.allDone"
          type="button"
          class="ths-fold-btn"
          :aria-expanded="!collapsedDone"
          @click="collapsedDone = !collapsedDone"
        >
          <span>{{ collapsedDone ? '展开' : '收起' }}</span>
        </button>

        <button type="button" class="ths-more" @click="emit('openHabits')">
          <span>{{ compact ? '全部' : '全部习惯' }}</span>
          <FIcon name="chevronRight" :size="11" />
        </button>
      </div>
    </header>

    <!-- Concentric 2-Column Interactive Action Tiles (Zero Horizontal Scroll Clipping) -->
    <div class="ths-grid-acc" :class="{ open: !collapsedDone }">
      <div class="ths-grid-acc-inner">
        <div class="ths-grid">
          <div
            v-for="h in displayedHabits"
            :key="h.task.id"
            class="ths-tile"
            :class="{
              done: h.day.state === 'done',
              relapse: h.day.state === 'relapse',
              skip: h.day.state === 'skip',
              'win-live': isToday && windowMap.get(h.task.id)?.phase === 'active' && h.day.state !== 'done',
              pulsing: pulsingId === h.task.id,
              disabled: date > now,
            }"
            :style="{ '--hb-tint': h.meta.color }"
            role="button"
            tabindex="0"
            :aria-label="`${h.task.title}，${tileSubtitle(h)}`"
            @click="onQuickTap(h)"
            @keydown.enter.prevent="onQuickTap(h)"
            @keydown.space.prevent="onQuickTap(h)"
            @contextmenu.prevent="openStripMenu(h, $event)"
          >
            <HabitEmblem
              :icon-key="h.meta.iconKey"
              :color="h.meta.color"
              :size="compact ? 26 : 30"
              :radius="compact ? 8 : 9"
            />

            <div class="ths-copy">
              <strong class="ths-name">{{ h.task.title }}</strong>
              <span class="ths-sub tabular">{{ tileSubtitle(h) }}</span>
            </div>

            <!-- Actionable Control per Habit Kind -->
            <div v-if="h.meta.kind === 'count' && !compact" class="ths-stepper" @click.stop>
              <button
                type="button"
                class="ths-step-min"
                :disabled="date > now || h.day.value <= 0"
                aria-label="减少计数"
                @click="onCountDelta(h, -(h.meta.step ?? 1))"
              >
                −
              </button>
              <button
                type="button"
                class="ths-step-add"
                :class="{ met: h.day.state === 'done' }"
                :disabled="date > now"
                aria-label="增加计数"
                @click="onCountDelta(h, h.meta.step ?? 1)"
              >
                <span class="tabular">+{{ h.meta.step ?? 1 }}</span>
              </button>
            </div>

            <span v-else class="ths-check" :class="{ checked: h.day.state === 'done' }" aria-hidden="true">
              <svg v-if="h.day.state === 'done'" class="ths-chk-svg" viewBox="0 0 14 14" fill="none">
                <path
                  class="ths-chk-path"
                  d="M3 7.3 5.8 10 11 4.2"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <FIcon v-else-if="h.day.state === 'relapse'" name="warning" :size="11" />
              <span v-else-if="h.meta.kind === 'count'" class="ths-plus">+</span>
            </span>

            <!-- Smooth Bottom Progress Track for Quantitative Habits -->
            <span
              v-if="h.meta.kind === 'count' && h.day.ratio > 0"
              class="ths-micro-bar"
              aria-hidden="true"
            >
              <span class="ths-micro-fill" :style="{ width: `${Math.round(h.day.ratio * 100)}%` }" />
            </span>
          </div>
        </div>

        <!-- Discreet Expand / Collapse Footer when > maxCollapsedCount habits exist -->
        <button
          v-if="hiddenCount > 0 || (expandedAll && habits.length > maxCollapsedCount)"
          type="button"
          class="ths-expand-btn"
          @click="expandedAll = !expandedAll"
        >
          <span>{{ expandedAll ? '收起多余习惯' : `还有 ${hiddenCount} 项习惯 · 展开` }}</span>
          <FIcon name="chevronDown" :size="11" class="ths-exp-chev" :class="{ open: expandedAll }" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* WWDC25 Interactive Snippet Outer Concentric Container */
.ths-snippet {
  --ths-r-outer: 20px;
  --ths-pad: 12px;
  --ths-r-inner: 13px;
  border-radius: var(--ths-r-outer);
  padding: var(--ths-pad);
  border: 1px solid var(--ws-hairline);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, #10a37f 4.5%, var(--ws-card-bg)) 0%,
    var(--ws-card-bg) 100%
  );
  box-shadow: 0 2px 10px rgba(15, 16, 20, 0.035);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color var(--duration-fast, 250ms) var(--ease-smooth-out),
    background-color var(--duration-fast, 250ms) var(--ease-smooth-out),
    box-shadow var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.ths-snippet.all-done {
  border-color: color-mix(in srgb, #10a37f 32%, var(--ws-hairline));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #10a37f 10%, var(--ws-card-bg)) 0%,
    color-mix(in srgb, #0ea5e9 4%, var(--ws-card-bg)) 100%
  );
}

.ths-snippet.collapsed {
  gap: 0;
}

.ths-snippet.compact {
  --ths-r-outer: 18px;
  --ths-pad: 10px 10px;
  --ths-r-inner: 12px;
  margin: 2px 0 4px;
  gap: 8px;
}

/* Header: Glanceable Progress Ring + Dialogue + Deep Link */
.ths-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ths-head-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.ths-ring-badge {
  position: relative;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 999px;
  background: color-mix(in srgb, #10a37f 10%, var(--ws-card-subtle));
  display: inline-grid;
  place-items: center;
  color: #0e8a6b;
  transition: background-color var(--duration-fast, 250ms) var(--ease-smooth-out), color var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.ths-ring-badge.full {
  background: #10a37f;
  color: #ffffff;
  box-shadow: 0 3px 10px rgba(16, 163, 127, 0.28);
}

.ths-ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ths-ring-track {
  fill: none;
  stroke: color-mix(in srgb, #10a37f 18%, transparent);
  stroke-width: 2.5;
}

.ths-ring-fill {
  fill: none;
  stroke: #10a37f;
  stroke-width: 2.6;
  stroke-linecap: round;
  transition: stroke-dashoffset 380ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.ths-ring-badge.full .ths-ring-fill {
  stroke: rgba(255, 255, 255, 0.85);
}

.ths-ring-num {
  position: relative;
  z-index: 1;
  font-size: 11.5px;
  font-weight: 840;
  line-height: 1;
}

.ths-ring-check {
  position: relative;
  z-index: 1;
}

.ths-head-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ths-headline-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.ths-headline {
  font-size: 14px;
  font-weight: 780;
  letter-spacing: -0.015em;
  line-height: 1.2;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ths-snippet.compact .ths-headline {
  font-size: 13.5px;
}

.ths-ratio-pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 10.5px;
  font-weight: 760;
}

.ths-ratio-pill.full {
  background: color-mix(in srgb, #10a37f 16%, transparent);
  color: #0d8a6b;
}

/* Color-Coded Per-Habit Glanceable Spectrum Bar */
.ths-spectrum {
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: 240px;
}

.ths-spec-seg {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 9%, transparent);
  transition: background-color var(--duration-fast, 250ms) var(--ease-smooth-out), transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-spec-seg.partial {
  background: color-mix(in srgb, var(--seg-tint) 52%, transparent);
}

.ths-spec-seg.done,
.ths-spec-seg.relapse {
  background: var(--seg-tint);
}

.ths-spec-seg.skip {
  background: color-mix(in srgb, var(--seg-tint) 30%, transparent);
}

.ths-head-acts {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ths-fold-btn,
.ths-more {
  height: 26px;
  border: 0;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 5.5%, transparent);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 660;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-fold-btn:hover,
.ths-more:hover {
  background: color-mix(in srgb, var(--ws-ink) 10%, transparent);
  color: var(--ws-ink);
}

.ths-fold-btn:active,
.ths-more:active {
  transform: scale(0.95);
}

/* Smooth Accordion Wrapper for Result-Snippet Collapse */
.ths-grid-acc {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--duration-fast, 250ms) var(--ease-smooth-out),
    opacity var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-grid-acc.open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.ths-grid-acc-inner {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Concentric 2-Column Actionable Snippet Grid */
.ths-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ths-snippet.compact .ths-grid {
  gap: 7px;
}

.ths-tile {
  --hb-tint: #10a37f;
  position: relative;
  overflow: hidden;
  padding: 9px 10px 10px 10px;
  border-radius: var(--ths-r-inner);
  border: 1px solid color-mix(in srgb, var(--hb-tint) 20%, var(--ws-hairline));
  background: color-mix(in srgb, var(--hb-tint) 8.5%, var(--ws-card-subtle));
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 9px;
  text-align: left;
  cursor: pointer;
  user-select: none;
  outline: none;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-snippet.compact .ths-tile {
  padding: 8px 8px 9px 8px;
  gap: 7px;
}

@media (hover: hover) {
  .ths-tile:hover:not(.disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--hb-tint) 44%, transparent);
    background: color-mix(in srgb, var(--hb-tint) 13%, var(--ws-card-subtle));
    box-shadow: 0 4px 12px color-mix(in srgb, var(--hb-tint) 12%, transparent);
  }
}

.ths-tile:active:not(.disabled) {
  transform: scale(0.98);
}

.ths-tile:focus-visible {
  box-shadow: 0 0 0 2px var(--hb-tint);
}

.ths-tile.win-live {
  border-color: color-mix(in srgb, var(--hb-tint) 58%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--hb-tint) 22%, transparent);
}

.ths-tile.done {
  background: color-mix(in srgb, var(--hb-tint) 15%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--hb-tint) 38%, transparent);
}

.ths-tile.relapse {
  border-color: color-mix(in srgb, #f59e0b 48%, transparent);
  background: color-mix(in srgb, #f59e0b 11%, var(--ws-card-bg));
}

.ths-tile.skip {
  opacity: 0.72;
}

.ths-tile.pulsing {
  animation: ths-pop 320ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

@keyframes ths-pop {
  0% {
    transform: scale(0.975);
  }
  55% {
    transform: scale(1.015);
  }
  100% {
    transform: scale(1);
  }
}

.ths-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5px;
}

.ths-name {
  font-size: 13.5px;
  font-weight: 760;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ths-snippet.compact .ths-name {
  font-size: 12.5px;
}

.ths-sub {
  font-size: 11px;
  font-weight: 620;
  color: var(--ws-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ths-tile.win-live .ths-sub {
  color: var(--hb-tint);
  font-weight: 740;
}

/* Inline Quantitative Stepper Pill (Desktop) */
.ths-stepper {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hb-tint) 12%, var(--ws-card-bg));
  border: 1px solid color-mix(in srgb, var(--hb-tint) 26%, transparent);
}

.ths-step-min,
.ths-step-add {
  height: 22px;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-weight: 800;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-step-min {
  width: 22px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font-size: 13px;
}

.ths-step-min:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ws-ink) 8%, transparent);
  color: var(--ws-ink);
}

.ths-step-min:disabled {
  opacity: 0.3;
  cursor: default;
}

.ths-step-add {
  min-width: 28px;
  padding: 0 7px;
  background: var(--hb-tint);
  color: #ffffff;
  font-size: 11px;
}

.ths-step-add:active:not(:disabled),
.ths-step-min:active:not(:disabled) {
  transform: scale(0.92);
}

/* Tactile Check Circle with Animated Stroke Draw */
.ths-check {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1.6px solid color-mix(in srgb, var(--hb-tint) 48%, transparent);
  background: color-mix(in srgb, var(--ws-card-bg) 75%, transparent);
  display: inline-grid;
  place-items: center;
  color: var(--hb-tint);
  flex: none;
  font-size: 13.5px;
  font-weight: 800;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-fast, 250ms) var(--ease-bounce);
}

.ths-snippet.compact .ths-check {
  width: 22px;
  height: 22px;
}

.ths-tile.done .ths-check {
  background: var(--hb-tint);
  border-color: var(--hb-tint);
  color: #ffffff;
  box-shadow: 0 2px 7px color-mix(in srgb, var(--hb-tint) 36%, transparent);
}

.ths-tile.relapse .ths-check {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #ffffff;
}

.ths-chk-svg {
  width: 13px;
  height: 13px;
}

.ths-chk-path {
  stroke-dasharray: 16;
  stroke-dashoffset: 0;
  animation: ths-chk-draw 260ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

@keyframes ths-chk-draw {
  from {
    stroke-dashoffset: 16;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.ths-plus {
  line-height: 1;
}

.ths-micro-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
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

/* Expand / Collapse Remaining Habits Footer Pill */
.ths-expand-btn {
  align-self: center;
  height: 24px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 5%, transparent);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 660;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out), color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.ths-expand-btn:hover {
  background: color-mix(in srgb, var(--ws-ink) 9%, transparent);
  color: var(--ws-ink);
}

.ths-exp-chev {
  transition: transform var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.ths-exp-chev.open {
  transform: scaleY(-1);
}

/* Soft Cross-Blur Headline Swap */
.ths-swap-enter-active,
.ths-swap-leave-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out),
    filter var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out);
}
.ths-swap-enter-from,
.ths-swap-leave-to {
  opacity: 0;
  filter: blur(var(--blur-small, 2px));
}

.tabular {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 560px) {
  .ths-snippet:not(.compact) .ths-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ths-tile,
  .ths-tile.pulsing,
  .ths-chk-path,
  .ths-ring-fill,
  .ths-grid-acc,
  .ths-swap-enter-active,
  .ths-swap-leave-active {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
html[data-ws-theme='dark'] .ths-ratio-pill.full {
  background: rgba(52, 211, 153, 0.2);
  color: #6ee7b7;
}
html[data-ws-theme='dark'] .ths-ring-badge:not(.full) {
  color: #34d399;
}
</style>
