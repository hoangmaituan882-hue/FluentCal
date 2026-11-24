<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon, showMenu, type MenuItem } from '@/fluent';
import type { HabitMeta, HabitTimeOfDay, ISODate, Task } from '@/types';
import { addDays, addMonths, parts, startOfMonth, weekday, WEEKDAY_SHORT } from '@/lib/date';
import {
  buildHabitHeatmap,
  buildHabitMonthCells,
  computeHabitWeekdayRates,
  extractHeatmapMonthTicks,
  formatHabitDateWithWeekday,
  formatHabitDayProgress,
  getHabitMilestone,
  HABIT_KIND_META,
  HABIT_TIME_META,
  isHabitTask,
  resolveHabit,
  sampleHabitPayloads,
  stepCountHabit,
  toggleCheckHabit,
  toggleQuitRelapse,
  toggleSkipHabit,
  type HabitHeatmapCell,
  type ResolvedHabit,
} from '@/lib/habits';
import { addTask, deleteTask, saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, taskList } from '@/stores/doc';
import { notify } from '../desk/state';
import FushiTonalCard from './FushiTonalCard.vue';
import HabitEditorModal from './HabitEditorModal.vue';
import HabitEmblem from './HabitEmblem.vue';
import NumberPop from './NumberPop.vue';
import { useSlidingIndicator } from './useSlidingIndicator';

type TimeFilter = 'all' | HabitTimeOfDay;

const { isPhone } = useViewport();
const weekStart = computed<0 | 1>(() => doc.settings.calendar.weekStart);

const selectedDay = ref<ISODate>(now.value);
const timeFilter = ref<TimeFilter>('all');

// Editor modal state
const editorOpen = ref(false);
const editingTask = ref<(Task & { habit: HabitMeta }) | null>(null);

// Detail & Monthly Backfill modal state
const detailHabitId = ref<string | null>(null);
const detailCalCursor = ref<ISODate>(startOfMonth(now.value));
const detailSkipMode = ref(false);

// Collapsible archived drawer
const archivedExpanded = ref(false);

// Tactile check-in ripple pulse tracking
const pulsingIds = ref<Set<string>>(new Set());
const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Keyboard-first navigation & Option-key shortcut affordance
const focusedHabitId = ref<string | null>(null);
const showKeyHints = ref(false);

// Pointer drag-to-reorder state (desktop)
const draggingId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

// Frosted glass floating heatmap HUD tooltip (80ms intent delay per transitions-polish)
interface HoverHudState {
  dateLabel: string;
  statusLabel: string;
  color: string;
  x: number;
  y: number;
  above: boolean;
}
const hoverHud = ref<HoverHudState | null>(null);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

// Sliding indicator for Time-of-Day filter
const timeSegRef = ref<HTMLElement>();
const { style: timePillStyle, ready: timePillReady, visible: timePillVisible } = useSlidingIndicator(
  timeSegRef,
  '.hv-seg-btn.active',
  [timeFilter],
);

const isTodaySelected = computed(() => selectedDay.value === now.value);
const selectedParts = computed(() => parts(selectedDay.value));
const todayParts = computed(() => parts(now.value));

// 7-day quick backfill ribbon ending on today
const recent7Days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(now.value, i - 6);
    const [, , d] = parts(iso);
    return {
      iso,
      day: d,
      wk: WEEKDAY_SHORT[weekday(iso)],
      isToday: iso === now.value,
    };
  }),
);

const allHabits = computed<ResolvedHabit[]>(() =>
  taskList.value
    .filter(isHabitTask)
    .filter((t) => !t.habit.archived)
    .map((t) => resolveHabit(t, selectedDay.value, now.value, weekStart.value))
    .sort((a, b) => a.task.order - b.task.order || a.task.createdAt - b.task.createdAt),
);

const archivedHabits = computed<ResolvedHabit[]>(() =>
  taskList.value
    .filter(isHabitTask)
    .filter((t) => !!t.habit.archived)
    .map((t) => resolveHabit(t, selectedDay.value, now.value, weekStart.value))
    .sort((a, b) => (b.task.updatedAt || 0) - (a.task.updatedAt || 0)),
);

const visibleHabits = computed(() => {
  if (timeFilter.value === 'all') return allHabits.value;
  return allHabits.value.filter(
    (h) => h.meta.timeOfDay === timeFilter.value || h.meta.timeOfDay === 'anytime',
  );
});

const selectedDayStats = computed(() => {
  const list = allHabits.value;
  let done = 0;
  let activeCount = 0;
  let strengthSum = 0;
  for (const h of list) {
    strengthSum += h.strength;
    if (h.day.state === 'skip') continue;
    activeCount++;
    if (h.day.state === 'done') done++;
  }
  const pct = activeCount > 0 ? Math.round((done / activeCount) * 100) : 0;
  const avgStrength = list.length > 0 ? Math.round(strengthSum / list.length) : 0;
  return { done, activeCount, total: list.length, pct, avgStrength };
});

// Streaks-inspired SVG ring geometry for Hero Emblem
const HERO_RING_R = 29;
const HERO_RING_C = 2 * Math.PI * HERO_RING_R;
const heroRingOffset = computed(() => HERO_RING_C * (1 - selectedDayStats.value.pct / 100));

const heatmapWeeks = computed(() => (isPhone.value ? 12 : 16));

const heatmapByHabitId = computed(() => {
  const map = new Map<string, { grid: HabitHeatmapCell[][]; ticks: Array<{ col: number; label: string }> }>();
  for (const h of visibleHabits.value) {
    const grid = buildHabitHeatmap(h.meta, h.task.start, now.value, heatmapWeeks.value, weekStart.value);
    const ticks = extractHeatmapMonthTicks(grid);
    map.set(h.task.id, { grid, ticks });
  }
  return map;
});

const detailHabit = computed<ResolvedHabit | null>(() => {
  if (!detailHabitId.value) return null;
  return (
    allHabits.value.find((h) => h.task.id === detailHabitId.value) ??
    archivedHabits.value.find((h) => h.task.id === detailHabitId.value) ??
    null
  );
});

const detailCalYear = computed(() => parts(detailCalCursor.value)[0]);
const detailCalMonth = computed(() => parts(detailCalCursor.value)[1]);

const weekdayHeaders = computed(() =>
  Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart.value + i) % 7]),
);

const detailMonthCells = computed(() => {
  const h = detailHabit.value;
  if (!h) return [];
  return buildHabitMonthCells(
    h.meta,
    h.task.start,
    detailCalYear.value,
    detailCalMonth.value,
    now.value,
    weekStart.value,
  );
});

const detailWeekdayRates = computed(() => {
  const h = detailHabit.value;
  if (!h) return [];
  return computeHabitWeekdayRates(h.meta, h.task.start, now.value, weekStart.value);
});

const detailBestWeekdayLabel = computed(() => {
  const list = detailWeekdayRates.value.filter((d) => d.total > 0 && d.rate > 0);
  if (!list.length) return '尚在积累数据';
  const best = [...list].sort((a, b) => b.rate - a.rate)[0];
  return `周${best.label}最稳 (${best.rate}%)`;
});

function tileStatusText(h: ResolvedHabit, cell: HabitHeatmapCell): string {
  if (cell.state === 'future') return '未来日期';
  if (cell.state === 'skip') return '请假跳过';
  if (cell.state === 'relapse') return '已记破戒';
  if (h.meta.kind === 'quit') return cell.state === 'done' ? '坚持稳住' : '未开始';
  if (h.meta.kind === 'count') {
    const u = h.meta.unit?.trim() || '';
    return `${cell.value}/${h.meta.target}${u ? ` ${u}` : ''}`;
  }
  return cell.state === 'done' ? '已完成' : '未打卡';
}

function onCellPointerEnter(h: ResolvedHabit, cell: HabitHeatmapCell, e: PointerEvent) {
  if (isPhone.value || e.pointerType === 'touch' || cell.state === 'future') return;
  const target = e.currentTarget as HTMLElement | null;
  if (!target) return;
  if (hoverTimer) clearTimeout(hoverTimer);
  const rect = target.getBoundingClientRect();
  const nextHud: HoverHudState = {
    dateLabel: formatHabitDateWithWeekday(cell.iso),
    statusLabel: tileStatusText(h, cell),
    color: cell.state === 'relapse' ? '#f59e0b' : h.meta.color,
    x: Math.max(88, Math.min(window.innerWidth - 88, rect.left + rect.width / 2)),
    y: rect.top > 72 ? rect.top - 8 : rect.bottom + 8,
    above: rect.top > 72,
  };
  // Instant reposition if HUD is already open; 80ms intent delay when opening fresh
  if (hoverHud.value) {
    hoverHud.value = nextHud;
  } else {
    hoverTimer = setTimeout(() => {
      hoverHud.value = nextHud;
      hoverTimer = null;
    }, 80);
  }
}

function clearHoverHud() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  hoverHud.value = null;
}

function triggerPulse(taskId: string) {
  const prev = pulseTimers.get(taskId);
  if (prev) clearTimeout(prev);
  const next = new Set(pulsingIds.value);
  next.add(taskId);
  pulsingIds.value = next;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(8);
    } catch {
      /* ignore unsupported */
    }
  }
  pulseTimers.set(
    taskId,
    setTimeout(() => {
      const cleaned = new Set(pulsingIds.value);
      cleaned.delete(taskId);
      pulsingIds.value = cleaned;
      pulseTimers.delete(taskId);
    }, 520),
  );
}

async function mutateHabit(h: ResolvedHabit, nextMeta: HabitMeta) {
  await saveTask({
    ...h.task,
    habitOnly: true,
    habit: nextMeta,
  });
}

async function onPrimaryAction(h: ResolvedHabit, iso = selectedDay.value, showToast = false) {
  const wasDone = h.day.state === 'done';
  let nextMeta: HabitMeta;
  if (h.meta.kind === 'check') {
    nextMeta = toggleCheckHabit(h.meta, iso);
  } else if (h.meta.kind === 'count') {
    nextMeta = stepCountHabit(h.meta, iso);
  } else {
    nextMeta = toggleQuitRelapse(h.meta, iso);
  }
  await mutateHabit(h, nextMeta);
  const after = resolveHabit({ ...h.task, habit: nextMeta }, iso, now.value, weekStart.value);
  if (after.day.state === 'done' || (h.meta.kind === 'count' && after.day.value > h.day.value)) {
    triggerPulse(h.task.id);
  }
  if (!wasDone && after.day.state === 'done' && iso === now.value) {
    const milestone = getHabitMilestone(after.currentStreak);
    if (milestone) {
      notify(`「${h.task.title}」达成连续 ${milestone} 天里程碑`, false);
      return;
    }
  }
  if (showToast) {
    notify(`「${h.task.title}」${formatHabitDayProgress(nextMeta, after.day)}`, true);
  }
}

async function onCountStep(h: ResolvedHabit, delta: number, iso = selectedDay.value) {
  const wasDone = h.day.state === 'done';
  const nextMeta = stepCountHabit(h.meta, iso, delta);
  await mutateHabit(h, nextMeta);
  if (delta > 0) {
    triggerPulse(h.task.id);
    if (!wasDone && iso === now.value) {
      const after = resolveHabit({ ...h.task, habit: nextMeta }, iso, now.value, weekStart.value);
      if (after.day.state === 'done') {
        const milestone = getHabitMilestone(after.currentStreak);
        if (milestone) notify(`「${h.task.title}」达成连续 ${milestone} 天里程碑`, false);
      }
    }
  }
}

async function onToggleSkip(h: ResolvedHabit, iso = selectedDay.value) {
  const nextMeta = toggleSkipHabit(h.meta, iso);
  await mutateHabit(h, nextMeta);
  const isNowSkipped = nextMeta.logs?.[iso] === 'skip';
  notify(
    isNowSkipped ? `「${h.task.title}」已标请假（不扣强度）` : `已取消「${h.task.title}」请假标记`,
    true,
  );
}

async function onDetailDayClick(h: ResolvedHabit, iso: ISODate) {
  if (iso > now.value) return;
  if (detailSkipMode.value) {
    await onToggleSkip(h, iso);
    return;
  }
  if (h.meta.kind === 'count') {
    const cur = typeof h.meta.logs?.[iso] === 'number' ? (h.meta.logs[iso] as number) : 0;
    const target = Math.max(1, h.meta.target || 1);
    const nextLogs = { ...(h.meta.logs ?? {}) };
    if (cur >= target) delete nextLogs[iso];
    else nextLogs[iso] = target;
    await mutateHabit(h, { ...h.meta, logs: nextLogs });
    return;
  }
  await onPrimaryAction(h, iso);
}

function openCreate() {
  clearHoverHud();
  editingTask.value = null;
  editorOpen.value = true;
}

function openEdit(h: ResolvedHabit) {
  clearHoverHud();
  detailHabitId.value = null;
  editingTask.value = h.task;
  editorOpen.value = true;
}

function openDetail(h: ResolvedHabit) {
  clearHoverHud();
  detailHabitId.value = h.task.id;
  detailCalCursor.value = startOfMonth(now.value);
  detailSkipMode.value = false;
}

function stepDetailMonth(delta: number) {
  detailCalCursor.value = startOfMonth(addMonths(detailCalCursor.value, delta));
}

async function archiveHabit(h: ResolvedHabit) {
  clearHoverHud();
  if (detailHabitId.value === h.task.id) detailHabitId.value = null;
  await mutateHabit(h, { ...h.meta, archived: true });
  notify(`已归档「${h.task.title}」`, true);
}

async function restoreHabit(h: ResolvedHabit) {
  await mutateHabit(h, { ...h.meta, archived: false });
  notify(`已恢复「${h.task.title}」`, true);
}

async function removeHabit(h: ResolvedHabit) {
  clearHoverHud();
  if (detailHabitId.value === h.task.id) detailHabitId.value = null;
  await deleteTask(h.task.id);
  notify(`已删除「${h.task.title}」`, true);
}

async function reorderHabit(sourceId: string, targetId: string) {
  if (sourceId === targetId) return;
  const list = [...allHabits.value];
  const from = list.findIndex((h) => h.task.id === sourceId);
  const to = list.findIndex((h) => h.task.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.task.order !== i) {
      await saveTask({ ...item.task, order: i });
    }
  }
}

async function moveHabitBy(h: ResolvedHabit, delta: -1 | 1) {
  const list = allHabits.value;
  const idx = list.findIndex((x) => x.task.id === h.task.id);
  const next = idx + delta;
  if (idx < 0 || next < 0 || next >= list.length) return;
  await reorderHabit(h.task.id, list[next].task.id);
}

function onCardDragStart(h: ResolvedHabit, e: DragEvent) {
  if (isPhone.value) return;
  clearHoverHud();
  draggingId.value = h.task.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', h.task.id);
  }
}

function onCardDragOver(h: ResolvedHabit) {
  if (!draggingId.value || draggingId.value === h.task.id) return;
  dragOverId.value = h.task.id;
}

async function onCardDrop(h: ResolvedHabit) {
  const src = draggingId.value;
  draggingId.value = null;
  dragOverId.value = null;
  if (src && src !== h.task.id) {
    await reorderHabit(src, h.task.id);
  }
}

function onCardDragEnd() {
  draggingId.value = null;
  dragOverId.value = null;
}

function openCardMenu(h: ResolvedHabit, event: MouseEvent, asAnchor = false) {
  clearHoverHud();
  const list = allHabits.value;
  const idx = list.findIndex((x) => x.task.id === h.task.id);
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
      icon: h.day.state === 'done' ? 'completed' : 'check',
      shortcut: 'Space',
      action: () => void onPrimaryAction(h, selectedDay.value, true),
    },
    {
      label: h.day.state === 'skip' ? '取消请假跳过' : '标记请假跳过',
      icon: 'moon',
      shortcut: 'S',
      action: () => void onToggleSkip(h),
    },
    {
      label: '月历与规律详情…',
      icon: 'calendar',
      shortcut: '↵',
      action: () => openDetail(h),
    },
    { separator: true },
    {
      label: '编辑习惯…',
      icon: 'edit',
      shortcut: 'E',
      action: () => openEdit(h),
    },
    {
      label: '上移排序',
      icon: 'chevronUp',
      disabled: idx <= 0,
      action: () => void moveHabitBy(h, -1),
    },
    {
      label: '下移排序',
      icon: 'chevronDown',
      disabled: idx < 0 || idx >= list.length - 1,
      action: () => void moveHabitBy(h, 1),
    },
    {
      label: '归档习惯',
      icon: 'inbox',
      action: () => void archiveHabit(h),
    },
    { separator: true },
    {
      label: '删除习惯',
      icon: 'delete',
      danger: true,
      action: () => void removeHabit(h),
    },
  ];
  const at = asAnchor ? (event.currentTarget as HTMLElement) : { x: event.clientX, y: event.clientY };
  void showMenu(items, at, asAnchor ? { placement: 'bottom-end' } : undefined);
}

async function seedSampleHabits() {
  const list = sampleHabitPayloads(now.value);
  for (const p of list) {
    await addTask(p);
  }
  notify('已导入 5 项习惯示例，按 1–5 可快速打卡', false);
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

function stepSelectedDay(delta: -1 | 1) {
  const days = recent7Days.value;
  const idx = days.findIndex((d) => d.iso === selectedDay.value);
  if (idx < 0) {
    selectedDay.value = now.value;
    return;
  }
  const next = Math.max(0, Math.min(days.length - 1, idx + delta));
  selectedDay.value = days[next].iso;
}

function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key === 'Alt' && !isPhone.value && !editorOpen.value && !detailHabitId.value) {
    showKeyHints.value = true;
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Detail modal keyboard navigation (Esc / Left / Right)
  if (detailHabitId.value) {
    if (e.key === 'Escape') {
      e.preventDefault();
      detailHabitId.value = null;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepDetailMonth(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepDetailMonth(1);
    }
    return;
  }

  if (editorOpen.value) return;
  if (isEditableTarget(e.target)) return;
  // Don't hijack keys when another global modal (e.g. Ctrl+K QuickModal) is open
  if (document.querySelector('.ws-modal-backdrop')) return;

  const list = visibleHabits.value;

  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    openCreate();
    return;
  }
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    selectedDay.value = now.value;
    return;
  }
  if (e.key === '[' || e.key === 'ArrowLeft') {
    e.preventDefault();
    stepSelectedDay(-1);
    return;
  }
  if (e.key === ']' || e.key === 'ArrowRight') {
    e.preventDefault();
    stepSelectedDay(1);
    return;
  }

  // Direct 1..9 instant habit check-in / +step
  if (/^[1-9]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    const h = list[idx];
    if (h) {
      e.preventDefault();
      focusedHabitId.value = h.task.id;
      void onPrimaryAction(h, selectedDay.value, true);
    }
    return;
  }

  if (!list.length) return;

  if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
    e.preventDefault();
    const cur = list.findIndex((h) => h.task.id === focusedHabitId.value);
    const next = cur < 0 ? 0 : (cur + 1) % list.length;
    focusedHabitId.value = list[next].task.id;
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
    e.preventDefault();
    const cur = list.findIndex((h) => h.task.id === focusedHabitId.value);
    const next = cur <= 0 ? list.length - 1 : cur - 1;
    focusedHabitId.value = list[next].task.id;
    return;
  }
  if (e.key === 'Escape' && focusedHabitId.value) {
    focusedHabitId.value = null;
    return;
  }

  const focused = list.find((h) => h.task.id === focusedHabitId.value);
  if (!focused) return;

  if (e.key === ' ') {
    e.preventDefault();
    void onPrimaryAction(focused, selectedDay.value, true);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    openDetail(focused);
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    void onToggleSkip(focused);
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    openEdit(focused);
  }
}

function onWindowKeyUp(e: KeyboardEvent) {
  if (e.key === 'Alt') showKeyHints.value = false;
}

function onWindowBlur() {
  showKeyHints.value = false;
  clearHoverHud();
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown);
  window.addEventListener('keyup', onWindowKeyUp);
  window.addEventListener('blur', onWindowBlur);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeyDown);
  window.removeEventListener('keyup', onWindowKeyUp);
  window.removeEventListener('blur', onWindowBlur);
  clearHoverHud();
  for (const t of pulseTimers.values()) clearTimeout(t);
  pulseTimers.clear();
});
</script>

<template>
  <div class="habit-page" :class="{ phone: isPhone }">
    <!-- Enlarged Bold Black Display Header (Consistent with SubscriptionView, Zero Red Eyebrow) -->
    <header class="hv-head" :class="{ phone: isPhone }">
      <div v-if="!isPhone" class="hv-head-left">
        <h1 class="hv-title">每日习惯</h1>
        <span class="hv-date-chip tabular">{{ todayParts[0] }}年{{ todayParts[1] }}月{{ todayParts[2] }}日</span>
      </div>

      <div class="hv-head-right">
        <!-- Time-of-Day Liquid Sliding Switcher -->
        <div ref="timeSegRef" class="hv-seg" role="tablist" aria-label="习惯时段筛选">
          <span
            v-if="timePillVisible"
            class="ws-slide-pill hv-seg-pill"
            :class="{ 'no-anim': !timePillReady }"
            :style="timePillStyle"
            aria-hidden="true"
          />
          <button
            v-for="f in (['all', 'morning', 'afternoon', 'evening'] as const)"
            :key="f"
            type="button"
            role="tab"
            :aria-selected="timeFilter === f"
            class="hv-seg-btn"
            :class="{ active: timeFilter === f }"
            @click="timeFilter = f"
          >
            {{ f === 'all' ? '全部' : HABIT_TIME_META[f].label }}
          </button>
        </div>

        <button
          type="button"
          class="hv-add-btn"
          :class="{ icon: isPhone }"
          title="新建习惯 (N)"
          aria-label="新建习惯"
          @click="openCreate"
        >
          <FIcon name="add" :size="14" />
          <span v-if="!isPhone">新建习惯</span>
        </button>
      </div>
    </header>

    <!-- First-Run Empty Starter State -->
    <div v-if="!allHabits.length && !archivedHabits.length" class="hv-empty-stage">
      <FushiTonalCard variant="hero" class="hv-empty-card" tint="#10A37F" watermark="每日习惯">
        <template #emblem>
          <div class="hv-empty-emblem">
            <FIcon name="flame" :size="28" />
          </div>
        </template>
        <div class="hv-empty-copy">
          <h2>用可视化热力矩阵，温和而坚定地养成好习惯</h2>
          <p>
            支持普通打卡、定量计数（喝水/阅读时长）与戒除习惯，采用反焦虑「习惯强度」算法与请假跳过保护，漏一天不清零。桌面、网页与安卓实时云同步。
          </p>
          <div class="hv-empty-acts">
            <button type="button" class="hv-btn-solid" @click="openCreate">
              <FIcon name="add" :size="14" />
              <span>创建第一个习惯</span>
            </button>
            <button type="button" class="hv-btn-soft" @click="seedSampleHabits">
              <FIcon name="sparkles" :size="14" />
              <span>一键导入 5 项示例体验</span>
            </button>
          </div>
        </div>
      </FushiTonalCard>
    </div>

    <!-- Main HabitKit × Fushi Card Grid Stage -->
    <div v-else class="hv-scroll" @scroll="clearHoverHud">
      <!-- Top Hero Overview Card + Streaks Completion Ring + 7-Day Quick Backfill Ribbon -->
      <FushiTonalCard
        as="section"
        variant="hero"
        class="hv-hero-card"
        tint="#10A37F"
        :watermark="isTodaySelected ? '今日习惯' : `${selectedParts[1]}月${selectedParts[2]}日`"
        :progress="selectedDayStats.pct"
      >
        <template #emblem>
          <div
            class="hv-hero-emblem"
            :class="{ full: selectedDayStats.pct === 100 && selectedDayStats.activeCount > 0 }"
          >
            <svg class="hv-hero-ring" viewBox="0 0 68 68" aria-hidden="true">
              <circle class="hv-ring-track" cx="34" cy="34" :r="HERO_RING_R" />
              <circle
                class="hv-ring-fill"
                cx="34"
                cy="34"
                :r="HERO_RING_R"
                :stroke-dasharray="HERO_RING_C"
                :stroke-dashoffset="heroRingOffset"
              />
            </svg>
            <strong class="tabular hv-hero-num">
              <NumberPop :value="selectedDayStats.done" />/{{ selectedDayStats.activeCount }}
            </strong>
            <span>{{ isTodaySelected ? '今日' : '补签' }}</span>
          </div>
        </template>

        <div class="hv-hero-top">
          <div class="hv-hero-copy">
            <div class="hv-hero-label">
              {{ isTodaySelected ? '今日习惯打卡' : `${selectedParts[1]}月${selectedParts[2]}日 补签视图` }}
            </div>
            <div class="hv-hero-sub">
              <span>平均习惯强度 <NumberPop :value="selectedDayStats.avgStrength" />%</span>
              <span>· {{ selectedDayStats.total }} 项习惯</span>
              <button
                v-if="!isTodaySelected"
                type="button"
                class="hv-back-today"
                @click="selectedDay = now"
              >
                回到今天
              </button>
            </div>
          </div>

          <!-- 7-Day Interactive Backfill Strip -->
          <div class="hv-7day" role="radiogroup" aria-label="近 7 天快速补签">
            <button
              v-for="d in recent7Days"
              :key="d.iso"
              type="button"
              class="hv-d-pill"
              :class="{ active: selectedDay === d.iso, today: d.isToday }"
              @click="selectedDay = d.iso"
            >
              <span class="hv-d-wk">{{ d.isToday ? '今' : d.wk }}</span>
              <strong class="hv-d-num tabular">{{ d.day }}</strong>
            </button>
          </div>
        </div>

        <template #progressMeta>
          <span class="tabular">完成进度 {{ selectedDayStats.pct }}%</span>
          <span>
            {{
              selectedDayStats.pct === 100 && selectedDayStats.activeCount > 0
                ? '今日全部达成 ✨'
                : `还差 ${Math.max(0, selectedDayStats.activeCount - selectedDayStats.done)} 项`
            }}
          </span>
        </template>
      </FushiTonalCard>

      <!-- HabitKit 2-Column Fushi Card Grid -->
      <div class="hv-grid">
        <FushiTonalCard
          v-for="(h, idx) in visibleHabits"
          :key="h.task.id"
          as="article"
          variant="tile"
          class="hv-card"
          :class="{
            done: h.day.state === 'done',
            skipped: h.day.state === 'skip',
            focused: focusedHabitId === h.task.id,
            dragging: draggingId === h.task.id,
            'drag-over': dragOverId === h.task.id,
          }"
          :style="{ '--stagger-idx': Math.min(idx, 6) }"
          :tint="h.meta.color"
          :watermark="h.task.title"
          :draggable="!isPhone"
          @contextmenu.prevent="openCardMenu(h, $event)"
          @dragstart="onCardDragStart(h, $event)"
          @dragover.prevent="onCardDragOver(h)"
          @drop.prevent="onCardDrop(h)"
          @dragend="onCardDragEnd"
        >
          <!-- Discreet macOS Option-key / Keyboard-Nav Shortcut Badge (invisible by default) -->
          <kbd v-if="!isPhone && idx < 9 && (showKeyHints || focusedHabitId)" class="hv-key-badge" aria-hidden="true">
            {{ idx + 1 }}
          </kbd>

          <!-- Top Bar: Emblem + Title + Inline Frictionless Check / Stepper / Quit Control -->
          <div class="hv-card-top">
            <button type="button" class="hv-card-identity" @click="openDetail(h)">
              <div class="hv-emblem-tilt">
                <HabitEmblem :icon-key="h.meta.iconKey" :color="h.meta.color" :size="40" :radius="12" />
              </div>
              <div class="hv-id-copy">
                <div class="hv-card-name">{{ h.task.title }}</div>
                <div class="hv-card-meta">
                  <template v-if="h.meta.kind === 'quit'">
                    <span>{{ h.day.state === 'relapse' ? '当日已记破戒' : `已克制 ${h.currentStreak} 天` }}</span>
                  </template>
                  <template v-else-if="h.meta.kind === 'count'">
                    <span class="tabular">{{ formatHabitDayProgress(h.meta, h.day) }}</span>
                  </template>
                  <template v-else>
                    <span>{{ h.meta.weeklyTarget >= 7 ? '每天' : `本周 ${h.week.done}/${h.week.target}` }}</span>
                  </template>
                  <span>· 强度 {{ h.strength }}%</span>
                </div>
              </div>
            </button>

            <!-- Inline Action Control per Habit Kind -->
            <div class="hv-card-act" :class="{ pulsing: pulsingIds.has(h.task.id) }">
              <!-- 1. CHECK HABIT: Tactile 38px Check Circle with Animated Check-Path Draw -->
              <button
                v-if="h.meta.kind === 'check'"
                type="button"
                class="hv-check-btn"
                :class="{ checked: h.day.state === 'done' }"
                :aria-pressed="h.day.state === 'done'"
                :aria-label="`打卡 ${h.task.title}`"
                @click="onPrimaryAction(h)"
              >
                <svg class="hv-check-svg" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path
                    class="hv-check-path"
                    d="M4.2 9.4 7.5 12.6 13.8 5.6"
                    stroke="currentColor"
                    stroke-width="2.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>

              <!-- 2. COUNT HABIT: Inline - / +Step Pill -->
              <div v-else-if="h.meta.kind === 'count'" class="hv-stepper">
                <button
                  type="button"
                  class="hv-step-btn"
                  :disabled="h.day.value <= 0"
                  aria-label="减少计数"
                  @click="onCountStep(h, -(h.meta.step ?? 1))"
                >
                  −
                </button>
                <button
                  type="button"
                  class="hv-step-plus"
                  :class="{ met: h.day.state === 'done' }"
                  aria-label="增加计数"
                  @click="onCountStep(h, h.meta.step ?? 1)"
                >
                  <span class="tabular">+{{ h.meta.step ?? 1 }}</span>
                </button>
              </div>

              <!-- 3. QUIT HABIT: Clean Positive Badge + Gentle Non-Shaming Relapse Toggle -->
              <button
                v-else
                type="button"
                class="hv-quit-btn"
                :class="{ relapse: h.day.state === 'relapse' }"
                @click="onPrimaryAction(h)"
              >
                <FIcon :name="h.day.state === 'relapse' ? 'warning' : 'check'" :size="12" />
                <span>{{ h.day.state === 'relapse' ? '已破戒' : '稳住' }}</span>
              </button>
            </div>
          </div>

          <!-- Quantitative Progress Bar (Count habits get an instant tactile liquid fill bar) -->
          <div v-if="h.meta.kind === 'count'" class="hv-count-track" aria-hidden="true">
            <div class="hv-count-fill" :style="{ width: `${Math.round(h.day.ratio * 100)}%` }" />
          </div>

          <!-- Subtle Month Axis Ticks above HabitKit Contribution Heatmap -->
          <div
            class="hv-hm-months"
            :style="{ '--hm-cols': heatmapWeeks }"
            aria-hidden="true"
          >
            <span
              v-for="tick in heatmapByHabitId.get(h.task.id)?.ticks ?? []"
              :key="tick.col"
              class="hv-hm-month-lbl"
              :style="{ gridColumn: `${tick.col + 1} / span 3` }"
            >
              {{ tick.label }}
            </span>
          </div>

          <!-- HabitKit Signature GitHub-Style Contribution Heatmap Matrix -->
          <div
            class="hv-heatmap"
            role="button"
            tabindex="0"
            :aria-label="`查看 ${h.task.title} 完整月历与补签`"
            @click="openDetail(h)"
            @keydown.enter.prevent="openDetail(h)"
            @pointerleave="clearHoverHud"
          >
            <div
              v-for="(col, ci) in heatmapByHabitId.get(h.task.id)?.grid ?? []"
              :key="ci"
              class="hv-hm-col"
            >
              <span
                v-for="cell in col"
                :key="cell.iso"
                class="hv-hm-cell"
                :class="[
                  `lv-${cell.level}`,
                  cell.state,
                  { today: cell.isToday, sel: cell.iso === selectedDay },
                ]"
                @pointerenter="onCellPointerEnter(h, cell, $event)"
              />
            </div>
          </div>

          <!-- Card Footer: Anti-Guilt Stats + Quick Skip, Edit & Native Context Menu -->
          <div class="hv-card-foot">
            <div class="hv-foot-stats tabular">
              <span class="hv-stat-pill">
                <FIcon name="flame" :size="11" />
                <span>{{ h.meta.kind === 'quit' ? `克制 ${h.currentStreak} 天` : `连续 ${h.currentStreak} 天` }}</span>
              </span>
              <span class="hv-stat-pill">累计 {{ h.totalDoneDays }} 天</span>
            </div>

            <div class="hv-foot-tools">
              <button
                type="button"
                class="hv-mini-tool"
                :class="{ active: h.day.state === 'skip' }"
                title="标记当天为请假/跳过（不扣习惯强度、不断连胜）"
                @click="onToggleSkip(h)"
              >
                {{ h.day.state === 'skip' ? '已跳过' : '跳过' }}
              </button>
              <button
                type="button"
                class="hv-mini-tool icon"
                title="编辑习惯"
                aria-label="编辑习惯"
                @click="openEdit(h)"
              >
                <FIcon name="edit" :size="12" />
              </button>
              <button
                type="button"
                class="hv-mini-tool icon"
                title="更多操作（右键卡片亦可打开）"
                aria-label="更多操作"
                @click="openCardMenu(h, $event, true)"
              >
                <FIcon name="more" :size="12" />
              </button>
            </div>
          </div>
        </FushiTonalCard>
      </div>

      <div v-if="!visibleHabits.length && allHabits.length" class="hv-filter-empty">
        当前时段暂无习惯，可切换「全部」查看或新建一条习惯
      </div>

      <!-- Discreet Collapsible Archived Habits Drawer (Only shown when archived habits exist) -->
      <section v-if="archivedHabits.length" class="hv-archived-box">
        <button
          type="button"
          class="hv-archived-toggle"
          :aria-expanded="archivedExpanded"
          @click="archivedExpanded = !archivedExpanded"
        >
          <FIcon :name="archivedExpanded ? 'chevronDown' : 'chevronRight'" :size="12" />
          <span>已归档习惯</span>
          <span class="hv-archived-cnt tabular">{{ archivedHabits.length }}</span>
        </button>

        <div v-if="archivedExpanded" class="hv-archived-list">
          <div v-for="ah in archivedHabits" :key="ah.task.id" class="hv-archived-row">
            <HabitEmblem :icon-key="ah.meta.iconKey" :color="ah.meta.color" :size="28" :radius="8" />
            <div class="hv-archived-copy">
              <strong>{{ ah.task.title }}</strong>
              <span class="tabular">累计 {{ ah.totalDoneDays }} 天 · 最长连续 {{ ah.bestStreak }} 天</span>
            </div>
            <button type="button" class="hv-archived-act" @click="restoreHabit(ah)">恢复</button>
            <button type="button" class="hv-archived-act danger" @click="removeHabit(ah)">删除</button>
          </div>
        </div>
      </section>
    </div>

    <!-- Teleported macOS Frosted Glass Floating Heatmap HUD Tooltip -->
    <Teleport to="body">
      <Transition name="hv-hud">
        <div
          v-if="hoverHud"
          class="hv-hud-tip"
          :class="{ below: !hoverHud.above }"
          :style="{ left: `${hoverHud.x}px`, top: `${hoverHud.y}px` }"
          role="tooltip"
        >
          <span class="hv-hud-date">{{ hoverHud.dateLabel }}</span>
          <span class="hv-hud-val">
            <span class="hv-hud-dot" :style="{ background: hoverHud.color }" aria-hidden="true" />
            <strong>{{ hoverHud.statusLabel }}</strong>
          </span>
        </div>
      </Transition>
    </Teleport>

    <!-- Habit Detail & Interactive Monthly Backfill Modal -->
    <Transition name="ws-modal">
      <div
        v-if="detailHabit"
        class="hd-backdrop"
        :class="{ phone: isPhone }"
        role="dialog"
        aria-modal="true"
        aria-label="习惯详情与月历补签"
        @mousedown.self="detailHabitId = null"
      >
        <div class="hd-card ws-modal-card" :class="{ phone: isPhone }">
          <FushiTonalCard
            variant="preview"
            class="hd-hero"
            :tint="detailHabit.meta.color"
            :watermark="detailHabit.task.title"
            :progress="detailHabit.strength"
          >
            <template #emblem>
              <HabitEmblem
                :icon-key="detailHabit.meta.iconKey"
                :color="detailHabit.meta.color"
                :size="50"
                :radius="14"
              />
            </template>
            <div class="hd-hero-row">
              <div>
                <div class="hd-hero-name">{{ detailHabit.task.title }}</div>
                <div class="hd-hero-sub">
                  {{ HABIT_KIND_META[detailHabit.meta.kind].label }} ·
                  {{ detailHabit.meta.weeklyTarget >= 7 ? '每天' : `每周 ${detailHabit.meta.weeklyTarget} 天` }}
                </div>
              </div>
              <div class="hd-hero-strength tabular">
                <strong>{{ detailHabit.strength }}%</strong>
                <span>习惯强度</span>
              </div>
            </div>
          </FushiTonalCard>

          <div class="hd-kpi-grid">
            <div class="hd-kpi">
              <span>当前连续</span>
              <strong class="tabular">{{ detailHabit.currentStreak }} 天</strong>
            </div>
            <div class="hd-kpi">
              <span>历史最长</span>
              <strong class="tabular">{{ detailHabit.bestStreak }} 天</strong>
            </div>
            <div class="hd-kpi">
              <span>本周达成</span>
              <strong class="tabular">{{ detailHabit.week.done }}/{{ detailHabit.week.target }} 天</strong>
            </div>
            <div class="hd-kpi">
              <span>累计完成</span>
              <strong class="tabular">{{ detailHabit.totalDoneDays }} 天</strong>
            </div>
          </div>

          <!-- Loop-Inspired Weekday Consistency Spark-Bars (Past 12 Weeks) -->
          <div class="hd-wd-box" :style="{ '--hd-tint': detailHabit.meta.color }">
            <div class="hd-wd-head">
              <span>周内规律 · 近 12 周</span>
              <strong class="tabular">{{ detailBestWeekdayLabel }}</strong>
            </div>
            <div class="hd-wd-bars" role="list" aria-label="周一至周日达成率">
              <div
                v-for="bar in detailWeekdayRates"
                :key="bar.wd"
                class="hd-wd-col"
                role="listitem"
                :title="`周${bar.label}：${bar.done}/${bar.total} 天 (${bar.rate}%)`"
              >
                <div class="hd-wd-track">
                  <div
                    class="hd-wd-fill"
                    :class="{ strong: bar.rate >= 80 }"
                    :style="{ height: `${Math.max(8, bar.rate)}%` }"
                  />
                </div>
                <span class="hd-wd-lbl">{{ bar.label }}</span>
              </div>
            </div>
          </div>

          <!-- Interactive Full Monthly Backfill Calendar -->
          <div class="hd-cal-box" :style="{ '--hd-tint': detailHabit.meta.color }">
            <div class="hd-cal-head">
              <div class="hd-cal-nav">
                <button type="button" class="hd-cal-btn" aria-label="上个月" @click="stepDetailMonth(-1)">
                  <FIcon name="chevronLeft" :size="12" />
                </button>
                <strong class="tabular">{{ detailCalYear }}年{{ detailCalMonth }}月</strong>
                <button type="button" class="hd-cal-btn" aria-label="下个月" @click="stepDetailMonth(1)">
                  <FIcon name="chevronRight" :size="12" />
                </button>
              </div>
              <button
                type="button"
                class="hd-skip-mode"
                :class="{ active: detailSkipMode }"
                @click="detailSkipMode = !detailSkipMode"
              >
                {{ detailSkipMode ? '请假标色中 ✓' : '点日期补签 / 标请假' }}
              </button>
            </div>

            <div class="hd-cal-wds" aria-hidden="true">
              <span v-for="w in weekdayHeaders" :key="w">{{ w }}</span>
            </div>

            <div class="hd-cal-grid">
              <button
                v-for="cell in detailMonthCells"
                :key="cell.key"
                type="button"
                class="hd-cal-cell"
                :class="[
                  cell.status ? `lv-${cell.status.level}` : '',
                  cell.status?.state ?? 'empty-pad',
                  { today: cell.isToday },
                ]"
                :disabled="!cell.day || cell.status?.state === 'future'"
                @click="cell.day && onDetailDayClick(detailHabit, cell.key)"
              >
                <span v-if="cell.day" class="tabular">{{ cell.day }}</span>
              </button>
            </div>
          </div>

          <footer class="hd-foot">
            <button type="button" class="hd-btn" @click="openEdit(detailHabit)">
              <FIcon name="edit" :size="13" />
              <span>编辑</span>
            </button>
            <button
              v-if="!detailHabit.meta.archived"
              type="button"
              class="hd-btn"
              @click="archiveHabit(detailHabit)"
            >
              <FIcon name="inbox" :size="13" />
              <span>归档</span>
            </button>
            <button type="button" class="hd-btn danger" @click="removeHabit(detailHabit)">
              <FIcon name="delete" :size="13" />
              <span>删除</span>
            </button>
            <button type="button" class="hd-btn primary" @click="detailHabitId = null">完成</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Create / Edit Zero-Scroll Modal -->
    <HabitEditorModal
      :open="editorOpen"
      :editing-task="editingTask"
      @close="editorOpen = false"
    />
  </div>
</template>

<style scoped>
.habit-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ws-ink);
}

.tabular {
  font-variant-numeric: tabular-nums;
}

/* Header (Enlarged Bold Black Editorial Display Typography) */
.hv-head {
  flex: none;
  padding: 18px 24px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.hv-head-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.hv-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 31px;
  font-weight: 880;
  letter-spacing: -0.038em;
  line-height: 1.06;
  color: var(--ws-ink);
}

.hv-date-chip {
  font-size: 13px;
  font-weight: 620;
  color: var(--ws-ink-muted);
}

.hv-head-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.hv-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
}

.hv-seg-pill {
  border-radius: 999px;
  background: var(--ws-ink);
}

.hv-seg-btn {
  position: relative;
  z-index: 1;
  height: 27px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 640;
  cursor: pointer;
  transition: color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-seg-btn.active {
  color: var(--ws-ink-inverse);
}

.hv-add-btn {
  height: 33px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 680;
  cursor: pointer;
  box-shadow: var(--ws-shadow-sm);
  transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-add-btn:active {
  transform: scale(0.96);
}

/* Empty Starter State */
.hv-empty-stage {
  flex: 1;
  padding: 20px 24px 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hv-empty-card {
  max-width: 680px;
  width: 100%;
  padding: 28px 30px;
  gap: 24px;
}

.hv-empty-emblem {
  width: 70px;
  height: 70px;
  border-radius: 18px;
  background: linear-gradient(135deg, #10a37f 0%, #0a6e56 100%);
  color: #ffffff;
  display: inline-grid;
  place-items: center;
}

.hv-empty-copy h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 820;
  color: var(--fc-ink);
}

.hv-empty-copy p {
  margin: 8px 0 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--fc-sub);
}

.hv-empty-acts {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hv-btn-solid,
.hv-btn-soft {
  height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  border: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.hv-btn-solid {
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
}

.hv-btn-soft {
  background: color-mix(in srgb, var(--fc-ink) 11%, transparent);
  color: var(--fc-ink);
}

/* Main Scrollable Content */
.hv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Hero Overview Card + Streaks SVG Completion Ring */
.hv-hero-card {
  flex: none;
}

.hv-hero-emblem {
  position: relative;
  width: 68px;
  height: 68px;
  border-radius: 18px;
  background: linear-gradient(145deg, #0f766e 0%, #094a44 100%);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: background 280ms var(--ease-smooth-out), box-shadow 280ms var(--ease-smooth-out);
}

.hv-hero-emblem.full {
  background: linear-gradient(145deg, #10b981 0%, #059669 100%);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.28);
}

.hv-hero-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  pointer-events: none;
}

.hv-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.16);
  stroke-width: 2.6;
}

.hv-ring-fill {
  fill: none;
  stroke: rgba(255, 255, 255, 0.88);
  stroke-width: 2.6;
  stroke-linecap: round;
  transition: stroke-dashoffset 440ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hv-hero-num {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: baseline;
  font-size: 18.5px;
  font-weight: 900;
  line-height: 1.05;
}

.hv-hero-emblem > span {
  position: relative;
  z-index: 1;
  font-size: 10px;
  font-weight: 740;
  opacity: 0.8;
}

.hv-hero-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.hv-hero-label {
  font-size: 17px;
  font-weight: 840;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
}

.hv-hero-sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  font-weight: 620;
  color: var(--fc-sub);
}

.hv-back-today {
  padding: 1px 8px;
  border: 0;
  border-radius: 999px;
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

/* 7-Day Interactive Backfill Strip */
.hv-7day {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--fc-ink) 8%, transparent);
}

.hv-d-pill {
  width: 36px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--fc-sub);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font: inherit;
  cursor: pointer;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-d-pill:hover {
  background: color-mix(in srgb, var(--fc-ink) 8%, transparent);
  color: var(--fc-ink);
}

.hv-d-pill.active {
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
}

.hv-d-wk {
  font-size: 9.5px;
  font-weight: 700;
  opacity: 0.78;
}

.hv-d-num {
  font-size: 12.5px;
  font-weight: 840;
  line-height: 1;
}

/* 2-Column HabitKit Card Grid */
.hv-grid {
  flex: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.hv-card {
  gap: 0;
  animation: hv-card-enter var(--duration-fast, 250ms) var(--ease-smooth-out) backwards;
  animation-delay: calc(var(--stagger-idx, 0) * var(--duration-stagger, 40ms));
}

@keyframes hv-card-enter {
  from {
    opacity: 0;
    transform: translateY(var(--distance-base, 8px)) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.hv-card.focused {
  box-shadow:
    0 0 0 2.2px var(--fc-fill),
    var(--fc-shadow);
}

.hv-card.dragging {
  opacity: 0.56;
  transform: scale(0.98);
}

.hv-card.drag-over {
  box-shadow:
    0 0 0 2.5px var(--fc-fill),
    var(--fc-shadow);
}

.hv-key-badge {
  position: absolute;
  top: -1px;
  left: 0;
  z-index: 4;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 5px;
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
  font-family: var(--font-ui);
  font-size: 9.5px;
  font-weight: 800;
  display: inline-grid;
  place-items: center;
  pointer-events: none;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.14);
}

.hv-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.hv-card-identity {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

/* Hover-in quick smooth-out; hover-out soft bouncy settle (transitions-polish) */
.hv-emblem-tilt {
  flex: none;
  transform: rotate(-5deg);
  filter: drop-shadow(0 6px 12px color-mix(in srgb, var(--fc-tint) 30%, rgba(0, 0, 0, 0.18)));
  transition: transform 320ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

.hv-card:hover .hv-emblem-tilt {
  transform: rotate(-2deg) scale(1.045);
  transition: transform 200ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hv-id-copy {
  flex: 1;
  min-width: 0;
}

.hv-card-name {
  font-size: 16px;
  font-weight: 840;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hv-card-meta {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 640;
  color: var(--fc-sub);
}

.hv-card-act {
  position: relative;
  flex: none;
}

.hv-card-act.pulsing::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 999px;
  border: 2px solid var(--fc-fill);
  pointer-events: none;
  animation: hv-ripple 500ms var(--ease-smooth-out) forwards;
}

@keyframes hv-ripple {
  0% {
    opacity: 0.72;
    transform: scale(0.92);
  }
  100% {
    opacity: 0;
    transform: scale(1.38);
  }
}

/* 1. Check Button with Animated SVG Check-Path Draw */
.hv-check-btn {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--fc-fill) 55%, transparent);
  background: rgba(255, 255, 255, 0.56);
  color: var(--fc-on-fill, #ffffff);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-fast, 250ms) var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1)),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-check-btn:hover {
  transform: scale(1.06);
  border-color: var(--fc-fill);
}

.hv-check-btn:active {
  transform: scale(0.9);
}

.hv-check-btn.checked {
  background: var(--fc-fill);
  border-color: var(--fc-fill);
  box-shadow: 0 6px 14px -4px color-mix(in srgb, var(--fc-tint) 55%, transparent);
}

.hv-check-svg {
  width: 18px;
  height: 18px;
}

.hv-check-path {
  stroke-dasharray: 22;
  stroke-dashoffset: 22;
  opacity: 0;
  transition:
    stroke-dashoffset var(--check-uncheck, 150ms) var(--ease-smooth-out),
    opacity var(--check-uncheck, 150ms) var(--ease-smooth-out);
}

.hv-check-btn.checked .hv-check-path {
  stroke-dashoffset: 0;
  opacity: 1;
  transition:
    stroke-dashoffset var(--check-draw, 320ms) var(--ease-smooth-out) var(--check-delay, 70ms),
    opacity 90ms ease var(--check-delay, 70ms);
}

/* 2. Count Inline Stepper */
.hv-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 9%, transparent);
}

.hv-step-btn,
.hv-step-plus {
  height: 30px;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-step-btn {
  width: 28px;
  background: rgba(255, 255, 255, 0.65);
  color: var(--fc-ink);
  font-size: 15px;
}

.hv-step-btn:disabled {
  opacity: 0.36;
  cursor: not-allowed;
}

.hv-step-plus {
  min-width: 44px;
  padding: 0 11px;
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
  font-size: 12.5px;
}

.hv-step-plus:active,
.hv-step-btn:active {
  transform: scale(0.92);
}

/* 3. Quit Action Button */
.hv-quit-btn {
  height: 32px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 740;
  cursor: pointer;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-quit-btn.relapse {
  background: #d97706;
  color: #ffffff;
}

.hv-quit-btn:active {
  transform: scale(0.94);
}

/* Quantitative Inline Fill Track */
.hv-count-track {
  margin-top: 8px;
  width: 100%;
  height: 5.5px;
  border-radius: 999px;
  background: var(--fc-track);
  overflow: hidden;
}

.hv-count-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--fc-fill);
  transition: width 320ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

/* Month Axis Labels above Contribution Matrix */
.hv-hm-months {
  margin-top: 9px;
  display: grid;
  grid-template-columns: repeat(var(--hm-cols, 16), minmax(0, 1fr));
  column-gap: 3.5px;
  align-items: center;
  height: 13px;
}

.hv-hm-month-lbl {
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  color: color-mix(in srgb, var(--fc-sub) 78%, transparent);
  white-space: nowrap;
  user-select: none;
}

/* HabitKit Contribution Heatmap Matrix */
.hv-heatmap {
  margin-top: 4px;
  display: flex;
  gap: 3.5px;
  width: 100%;
  cursor: pointer;
}

.hv-hm-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3.5px;
}

.hv-hm-cell {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 3.5px;
  background: var(--fc-track);
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out);
}

@media (hover: hover) {
  .hv-hm-cell:not(.future):hover {
    transform: scale(1.24);
    z-index: 2;
    position: relative;
    box-shadow: 0 0 0 1.6px var(--fc-ink);
  }
}

.hv-hm-cell.future {
  opacity: 0.34;
}

.hv-hm-cell.lv-1 {
  background: color-mix(in srgb, var(--fc-fill) 34%, var(--fc-track));
}

.hv-hm-cell.lv-2 {
  background: color-mix(in srgb, var(--fc-fill) 58%, var(--fc-track));
}

.hv-hm-cell.lv-3 {
  background: color-mix(in srgb, var(--fc-fill) 80%, var(--fc-track));
}

.hv-hm-cell.lv-4 {
  background: var(--fc-fill);
}

.hv-hm-cell.skip {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--fc-fill) 52%, transparent);
}

.hv-hm-cell.relapse {
  background: color-mix(in srgb, #f59e0b 78%, transparent);
}

.hv-hm-cell.sel {
  box-shadow: 0 0 0 1.6px var(--fc-ink);
}

/* Card Footer */
.hv-card-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hv-foot-stats {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.hv-stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 9%, transparent);
  color: var(--fc-ink);
  font-size: 10.5px;
  font-weight: 700;
}

.hv-foot-tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.hv-mini-tool {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 8%, transparent);
  color: var(--fc-sub);
  font: inherit;
  font-size: 10.5px;
  font-weight: 680;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hv-mini-tool.icon {
  width: 24px;
  padding: 0;
}

.hv-mini-tool:hover,
.hv-mini-tool.active {
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
}

.hv-filter-empty {
  flex: none;
  padding: 36px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--ws-ink-muted);
}

/* Collapsible Archived Drawer */
.hv-archived-box {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}

.hv-archived-toggle {
  align-self: flex-start;
  height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 660;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.hv-archived-cnt {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
  font-size: 10.5px;
  font-weight: 760;
}

.hv-archived-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.hv-archived-row {
  padding: 9px 11px;
  border-radius: 14px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  align-items: center;
  gap: 9px;
}

.hv-archived-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.hv-archived-copy strong {
  font-size: 13px;
  font-weight: 740;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hv-archived-copy span {
  font-size: 11px;
  color: var(--ws-ink-muted);
}

.hv-archived-act {
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font: inherit;
  font-size: 11px;
  font-weight: 680;
  cursor: pointer;
}

.hv-archived-act.danger {
  color: var(--ws-danger);
  border-color: color-mix(in srgb, var(--ws-danger) 24%, transparent);
}

/* Habit Detail & Monthly Backfill Modal */
.hd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
  background: var(--ws-scrim-bg);
  backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 18px;
}

.hd-backdrop.phone {
  display: flex;
  align-items: flex-end;
  padding: 0;
}

.hd-card {
  width: 100%;
  max-width: 472px;
  max-height: min(92dvh, 760px);
  padding: 18px;
  border-radius: 24px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-float);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  box-sizing: border-box;
}

.hd-card.phone {
  max-width: 100%;
  border-radius: 24px 24px 0 0;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}

.hd-hero {
  flex: none;
}

.hd-hero-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}

.hd-hero-name {
  font-size: 18px;
  font-weight: 840;
  color: var(--fc-ink);
}

.hd-hero-sub {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 620;
  color: var(--fc-sub);
}

.hd-hero-strength {
  text-align: right;
}

.hd-hero-strength strong {
  display: block;
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
  color: var(--fc-ink);
}

.hd-hero-strength span {
  font-size: 10.5px;
  font-weight: 640;
  color: var(--fc-sub);
}

.hd-kpi-grid {
  flex: none;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.hd-kpi {
  padding: 9px 10px;
  border-radius: 13px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hd-kpi span {
  font-size: 10.5px;
  color: var(--ws-ink-muted);
  font-weight: 600;
}

.hd-kpi strong {
  font-size: 14px;
  font-weight: 820;
  color: var(--ws-ink);
}

/* Weekday Pattern Spark-Bars */
.hd-wd-box {
  --hd-tint: #10a37f;
  flex: none;
  padding: 10px 13px;
  border-radius: 15px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hd-wd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ws-ink-muted);
  font-weight: 620;
}

.hd-wd-head strong {
  color: var(--ws-ink);
  font-weight: 740;
}

.hd-wd-bars {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  align-items: end;
}

.hd-wd-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.hd-wd-track {
  width: 100%;
  max-width: 24px;
  height: 30px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ws-ink) 6%, transparent);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.hd-wd-fill {
  width: 100%;
  border-radius: 6px;
  background: color-mix(in srgb, var(--hd-tint) 58%, var(--ws-card-bg));
  transition: height 320ms var(--ease-smooth-out);
}

.hd-wd-fill.strong {
  background: var(--hd-tint);
}

.hd-wd-lbl {
  font-size: 10px;
  font-weight: 660;
  color: var(--ws-ink-secondary);
}

.hd-cal-box {
  --hd-tint: #10a37f;
  flex: none;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hd-cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hd-cal-nav {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.hd-cal-btn {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
}

.hd-skip-mode {
  height: 25px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 640;
  cursor: pointer;
}

.hd-skip-mode.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.hd-cal-wds {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  text-align: center;
  font-size: 11px;
  font-weight: 640;
  color: var(--ws-ink-muted);
}

.hd-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
}

.hd-cal-cell {
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 680;
  cursor: pointer;
  transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out), background-color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hd-cal-cell:disabled {
  opacity: 0.35;
  cursor: default;
}

.hd-cal-cell.empty-pad {
  background: transparent;
}

.hd-cal-cell.lv-1,
.hd-cal-cell.lv-2,
.hd-cal-cell.lv-3 {
  background: color-mix(in srgb, var(--hd-tint) 36%, var(--ws-card-bg));
  color: var(--ws-ink);
}

.hd-cal-cell.lv-4 {
  background: var(--hd-tint);
  color: #ffffff;
}

.hd-cal-cell.skip {
  background: transparent;
  box-shadow: inset 0 0 0 1.6px var(--hd-tint);
  color: var(--ws-ink);
}

.hd-cal-cell.relapse {
  background: #f59e0b;
  color: #ffffff;
}

.hd-cal-cell.today {
  box-shadow: inset 0 0 0 2px var(--ws-ink);
}

.hd-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hd-btn {
  height: 36px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 680;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.hd-btn.danger {
  background: rgba(232, 76, 61, 0.1);
  border-color: rgba(232, 76, 61, 0.22);
  color: #d93e30;
}

.hd-btn.primary {
  margin-left: auto;
  border-color: transparent;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

@media (max-width: 820px) {
  .hv-grid,
  .hv-archived-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 639px) {
  .hv-head.phone {
    padding: 0 12px 6px;
  }

  .hv-head.phone .hv-head-right {
    width: 100%;
    justify-content: space-between;
  }

  .hv-add-btn.icon {
    width: 34px;
    height: 34px;
    padding: 0;
    justify-content: center;
    flex: none;
  }

  .hv-scroll {
    padding: 4px 12px calc(106px + env(safe-area-inset-bottom));
    gap: 12px;
  }

  .hv-hero-emblem {
    width: 54px;
    height: 54px;
    border-radius: 14px;
  }

  .hv-hero-num {
    font-size: 15px;
  }

  .hv-hero-top {
    gap: 8px;
  }

  .hv-7day {
    width: 100%;
    gap: 2px;
    padding: 2px;
    border-radius: 12px;
    justify-content: space-between;
  }

  .hv-d-pill {
    flex: 1;
    width: auto;
    height: 36px;
    border-radius: 9px;
  }

  .hv-empty-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .hd-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .hv-card,
  .hv-card-act.pulsing::after,
  .hv-check-path,
  .hv-ring-fill,
  .hv-hm-cell,
  .hv-emblem-tilt {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
/* Dark-mode surface tuning for translucent tactile controls on Fushi habit cards */
html[data-ws-theme='dark'] .hv-check-btn:not(.checked) {
  background: color-mix(in srgb, var(--fc-ink) 8%, transparent);
}

html[data-ws-theme='dark'] .hv-step-btn {
  background: color-mix(in srgb, var(--fc-ink) 12%, transparent);
}

/* Teleported macOS Frosted Glass Floating Heatmap HUD Tooltip */
.hv-hud-tip {
  position: fixed;
  z-index: 220;
  transform: translate(-50%, -100%);
  padding: 6px 10px;
  border-radius: 11px;
  border: 1px solid var(--ws-hairline-strong, rgba(28, 25, 23, 0.12));
  background: color-mix(in srgb, var(--ws-card-bg, #ffffff) 90%, transparent);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  box-shadow: 0 10px 26px rgba(15, 16, 20, 0.16), 0 1px 3px rgba(15, 16, 20, 0.08);
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  white-space: nowrap;
}

.hv-hud-tip.below {
  transform: translate(-50%, 0);
}

.hv-hud-date {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ws-ink-muted, #8e8a82);
}

.hv-hud-val {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ws-ink, #1c1b19);
}

.hv-hud-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex: none;
}

.hv-hud-enter-active {
  transition: opacity var(--duration-quick, 150ms) var(--ease-out, ease-out),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hv-hud-leave-active {
  transition: opacity 90ms ease-out;
}

.hv-hud-enter-from,
.hv-hud-leave-to {
  opacity: 0;
}

.hv-hud-enter-from {
  transform: translate(-50%, calc(-100% + 4px)) scale(0.98);
}

.hv-hud-tip.below.hv-hud-enter-from {
  transform: translate(-50%, -4px) scale(0.98);
}
</style>
