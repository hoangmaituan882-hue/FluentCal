<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import {
  addDays,
  addMonths,
  diffDays,
  monthWeeks,
  pad2,
  parts,
  relativeDay,
  startOfMonth,
  startOfWeek,
  weekday,
  WEEKDAY_SHORT,
} from '@/lib/date';
import { dayInfo } from '@/lib/lunar';
import { flexKind } from '@/lib/flex';
import { occurrences, type Occurrence } from '@/lib/recur';
import { addTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, taskList } from '@/stores/doc';
import type { ISODate, Task } from '@/types';
import { goToday, openEditor, ui } from '../desk/state';
import DayView from '../desk/DayView.vue';
import { openTaskContextMenu } from './workspaceMenus';

export type CalicoDetent = 'week' | 'split' | 'month';
export type CalicoSubMode = 'split' | 'timeline';

const props = withDefaults(
  defineProps<{
    subMode?: CalicoSubMode;
  }>(),
  {
    subMode: 'split',
  },
);

const emit = defineEmits<{
  openTask: [id: string];
  openCountdowns: [];
  'update:subMode': [mode: CalicoSubMode];
}>();

const stageRef = ref<HTMLElement>();
const detent = ref<CalicoDetent>('split');
const activeMode = ref<CalicoSubMode>(props.subMode);

watch(
  () => props.subMode,
  (v) => {
    if (v && v !== activeMode.value) activeMode.value = v;
  },
);

function setMode(m: CalicoSubMode) {
  activeMode.value = m;
  emit('update:subMode', m);
}

// Transition direction for month/week/day animations
const monthSlideDir = ref<'next' | 'prev'>('next');
const dayFlipDir = ref<'next' | 'prev'>('next');
const monthBoundaryLabel = ref('');
let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => ui.selected,
  (next, prev) => {
    if (prev && next !== prev) {
      dayFlipDir.value = next > prev ? 'next' : 'prev';
    }
    // Keep cursor month aligned when selecting a date in another month during week paging
    if (next.slice(0, 7) !== ui.cursor.slice(0, 7) && detent.value === 'week') {
      ui.cursor = startOfMonth(next);
    }
  },
);

const weekStart = computed<0 | 1>(() => doc.settings.calendar.weekStart);

const weekdayHeaders = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const wd = (weekStart.value + i) % 7;
    return {
      wd,
      label: WEEKDAY_SHORT[wd],
      isRest: doc.settings.calendar.restDays.includes(wd),
    };
  }),
);

const cursorParts = computed(() => parts(ui.cursor));
const cursorYear = computed(() => cursorParts.value[0]);
const cursorMonth = computed(() => cursorParts.value[1]);

const monthRowStarts = computed(() =>
  monthWeeks(cursorYear.value, cursorMonth.value, weekStart.value, 'six'),
);

const monthRows = computed<ISODate[][]>(() =>
  monthRowStarts.value.map((ws) => Array.from({ length: 7 }, (_, i) => addDays(ws, i))),
);

const activeWeekDays = computed<ISODate[]>(() => {
  const start = startOfWeek(ui.selected, weekStart.value);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
});

const visibleRange = computed<[ISODate, ISODate]>(() => {
  const rows = monthRows.value;
  const first = rows[0]?.[0] ?? ui.cursor;
  const last = rows[rows.length - 1]?.[6] ?? ui.cursor;
  const wkFirst = activeWeekDays.value[0] ?? first;
  const wkLast = activeWeekDays.value[6] ?? last;
  return [first < wkFirst ? first : wkFirst, last > wkLast ? last : wkLast];
});

function occAccentHex(t: Task): string {
  const key = t.color || (t.groupId ? doc.groups[t.groupId]?.color : '') || 'blue';
  return taskColor(key, isDark.value).bar;
}

const occurrencesByDay = computed<Record<ISODate, Occurrence[]>>(() => {
  const [rangeStart, rangeEnd] = visibleRange.value;
  const map: Record<ISODate, Occurrence[]> = {};
  for (const t of taskList.value) {
    if (t.countdownOnly || flexKind(t)) continue;
    const occs = occurrences(t, rangeStart, rangeEnd);
    for (const o of occs) {
      let cur = o.start < rangeStart ? rangeStart : o.start;
      const end = o.end > rangeEnd ? rangeEnd : o.end;
      while (cur <= end) {
        (map[cur] ??= []).push(o);
        cur = addDays(cur, 1);
      }
    }
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => {
      const aAllDay = !a.task.time || a.start !== a.end;
      const bAllDay = !b.task.time || b.start !== b.end;
      if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
      if (a.task.time && b.task.time && a.task.time !== b.task.time) {
        return a.task.time.localeCompare(b.task.time);
      }
      return a.task.title.localeCompare(b.task.title);
    });
  }
  return map;
});

function dayOccurrences(iso: ISODate): Occurrence[] {
  return occurrencesByDay.value[iso] ?? [];
}

function dayDots(iso: ISODate): { id: string; color: string }[] {
  return dayOccurrences(iso)
    .slice(0, 5)
    .map((o, idx) => ({
      id: `${o.task.id}:${idx}`,
      color: occAccentHex(o.task),
    }));
}

function dayMiniEvents(iso: ISODate, limit = 3): { id: string; title: string; color: string; done: boolean }[] {
  return dayOccurrences(iso)
    .slice(0, limit)
    .map((o, idx) => ({
      id: `${o.task.id}:${idx}`,
      title: o.task.title,
      color: occAccentHex(o.task),
      done: o.done,
    }));
}

function isInCurrentMonth(iso: ISODate): boolean {
  return iso.slice(0, 7) === ui.cursor.slice(0, 7);
}

// Selected Day Agenda split into All-Day Banner Pills & Timed Event Rows
const selectedOccurrences = computed(() => dayOccurrences(ui.selected));

const selectedAllDayItems = computed(() =>
  selectedOccurrences.value.filter((o) => !o.task.time || o.start !== o.end),
);

const selectedTimedItems = computed(() =>
  selectedOccurrences.value.filter((o) => !!o.task.time && o.start === o.end),
);

const selectedLunar = computed(() => dayInfo(ui.selected));

const selectedDayHeadingText = computed(() => {
  const [, m, d] = parts(ui.selected);
  const wd = WEEKDAY_SHORT[weekday(ui.selected)];
  return `${m}月${d}日 周${wd}`;
});

const selectedDaySubText = computed(() => {
  const rel = relativeDay(ui.selected, now.value);
  const lunar = selectedLunar.value.lunarLabel;
  return `${rel} · 农历${lunar}`;
});

function allDayBadgeText(o: Occurrence): string {
  if (o.start !== o.end) {
    const total = diffDays(o.start, o.end) + 1;
    const cur = diffDays(o.start, ui.selected) + 1;
    return `全天 · ${cur}/${total}`;
  }
  return '全天';
}

function formatStartTime(time?: string): string {
  if (!time) return '';
  const [hh, mm] = time.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time;
  return `${hh}:${pad2(mm)}`;
}

function formatEndTime(time?: string, durationMins?: number): string {
  if (!time) return '';
  const [hh, mm] = time.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
  const dur = durationMins && durationMins > 0 ? durationMins : 60;
  const total = hh * 60 + mm + dur;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${eh}:${pad2(em)}`;
}

function taskSubtitle(t: Task): string {
  const pieces: string[] = [];
  if (t.groupId && doc.groups[t.groupId]) {
    pieces.push(doc.groups[t.groupId].name);
  }
  if (t.notes?.trim()) {
    pieces.push(t.notes.trim().split('\n')[0]);
  } else if (t.checklist?.length) {
    const done = t.checklist.filter((c) => c.done).length;
    pieces.push(`子步骤 ${done}/${t.checklist.length}`);
  }
  return pieces.join(' · ');
}

function toggleOccDone(o: Occurrence) {
  void setOccurrenceDone(o.task, o.date, !o.done);
}

function selectDay(iso: ISODate) {
  ui.selected = iso;
}

function openNew(iso: ISODate) {
  openEditor({ mode: 'new', start: iso, end: iso });
}

function onTaskMenu(e: MouseEvent, t: Task) {
  e.preventDefault();
  e.stopPropagation();
  void openTaskContextMenu(t, e.currentTarget as HTMLElement, {
    date: ui.selected,
    onOpen: () => emit('openTask', t.id),
  });
}

// Inline Quick Add for Selected Date
const quickTitle = ref('');
async function submitQuickTask() {
  const title = quickTitle.value.trim();
  if (!title) return;
  quickTitle.value = '';
  await addTask({
    title,
    start: ui.selected,
    end: ui.selected,
    color: '',
    notes: '',
    done: false,
  });
}

// Month & Week navigation with kinetic boundary banner
function flashMonthBanner(cursorIso: ISODate) {
  const [y, m] = parts(cursorIso);
  monthBoundaryLabel.value = `${y}年${m}月`;
  if (boundaryTimer) clearTimeout(boundaryTimer);
  boundaryTimer = setTimeout(() => {
    monthBoundaryLabel.value = '';
  }, 900);
}

function stepMonth(delta: -1 | 1) {
  monthSlideDir.value = delta > 0 ? 'next' : 'prev';
  const nextCursor = startOfMonth(addMonths(ui.cursor, delta));
  ui.cursor = nextCursor;
  const [, , curDay] = parts(ui.selected);
  const [ny, nm] = parts(nextCursor);
  const maxD = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  selectDay(`${ny}-${pad2(nm)}-${pad2(Math.min(curDay, maxD))}` as ISODate);
  flashMonthBanner(nextCursor);
}

function stepWeek(delta: -1 | 1) {
  monthSlideDir.value = delta > 0 ? 'next' : 'prev';
  const nextDay = addDays(ui.selected, delta * 7);
  selectDay(nextDay);
  ui.cursor = startOfMonth(nextDay);
}

function pickCell(iso: ISODate) {
  if (iso.slice(0, 7) !== ui.cursor.slice(0, 7)) {
    monthSlideDir.value = iso > ui.cursor ? 'next' : 'prev';
    ui.cursor = startOfMonth(iso);
  }
  selectDay(iso);
}

// Finger Scrub-to-Select & Swipe Month/Week Gesture on Calendar Grid
let gridPointerId: number | null = null;
let gridStartX = 0;
let gridStartY = 0;
let isScrubbingDays = false;
let swipeHandled = false;

function onGridPointerDown(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  gridPointerId = e.pointerId;
  gridStartX = e.clientX;
  gridStartY = e.clientY;
  isScrubbingDays = false;
  swipeHandled = false;
  const cell = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-iso]');
  if (cell?.dataset.iso) {
    pickCell(cell.dataset.iso as ISODate);
  }
}

function onGridPointerMove(e: PointerEvent) {
  if (gridPointerId !== e.pointerId || swipeHandled) return;
  const dx = e.clientX - gridStartX;
  const dy = e.clientY - gridStartY;

  // In week detent, a strong horizontal swipe pages to the previous/next week
  if (detent.value === 'week' && !isScrubbingDays && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    swipeHandled = true;
    stepWeek(dx < 0 ? 1 : -1);
    return;
  }

  // In split or month detent, a vertical swipe pages to the previous/next month
  if (detent.value !== 'week' && !isScrubbingDays && Math.abs(dy) > 44 && Math.abs(dy) > Math.abs(dx) * 1.35) {
    swipeHandled = true;
    stepMonth(dy < 0 ? 1 : -1);
    return;
  }

  // Horizontal/diagonal scrub across day cells selects dates live as the finger glides
  if (Math.abs(dx) > 10 || isScrubbingDays) {
    isScrubbingDays = true;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-iso]');
    const iso = hit?.dataset.iso as ISODate | undefined;
    if (iso && iso !== ui.selected) {
      pickCell(iso);
    }
  }
}

function onGridPointerUp(e: PointerEvent) {
  if (gridPointerId === e.pointerId) {
    gridPointerId = null;
    isScrubbingDays = false;
    swipeHandled = false;
  }
}

// 3-Detent Draggable Split Handle Choreography ('week' <-> 'split' <-> 'month')
const WEEK_HEIGHT = 96;
const SPLIT_HEIGHT = 258;
const draggingSplit = ref(false);
const dragHeightPx = ref<number | null>(null);
let grabPointerId: number | null = null;
let grabStartY = 0;
let grabStartH = SPLIT_HEIGHT;
let grabLastY = 0;
let grabLastT = 0;
let grabVelocityY = 0;

function getMonthFullHeight(): number {
  const stageH = stageRef.value?.clientHeight ?? 560;
  return Math.max(340, stageH - 144);
}

function detentTargetHeight(d: CalicoDetent): number {
  if (d === 'week') return WEEK_HEIGHT;
  if (d === 'month') return getMonthFullHeight();
  return SPLIT_HEIGHT;
}

const currentCalHeight = computed(() => {
  if (dragHeightPx.value !== null) return dragHeightPx.value;
  return detentTargetHeight(detent.value);
});

// Show inline mini event titles inside month cells when expanded past 330px or in 'month' detent
const showMonthMiniEvents = computed(() => {
  if (dragHeightPx.value !== null) return dragHeightPx.value > 330;
  return detent.value === 'month';
});

const showWeekStripOnly = computed(() => {
  if (dragHeightPx.value !== null) return dragHeightPx.value < 155;
  return detent.value === 'week';
});

function cycleDetent() {
  if (detent.value === 'split') detent.value = 'week';
  else if (detent.value === 'week') detent.value = 'month';
  else detent.value = 'split';
}

function onGrabberDown(e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture?.(e.pointerId);
  grabPointerId = e.pointerId;
  grabStartY = e.clientY;
  grabLastY = e.clientY;
  grabLastT = performance.now();
  grabVelocityY = 0;
  grabStartH = detentTargetHeight(detent.value);
  draggingSplit.value = true;
  dragHeightPx.value = grabStartH;
}

function onGrabberMove(e: PointerEvent) {
  if (!draggingSplit.value || grabPointerId !== e.pointerId) return;
  const nowT = performance.now();
  const dt = Math.max(1, nowT - grabLastT);
  grabVelocityY = (e.clientY - grabLastY) / dt; // px/ms
  grabLastY = e.clientY;
  grabLastT = nowT;

  const dy = e.clientY - grabStartY;
  const maxH = getMonthFullHeight();
  const nextH = Math.max(WEEK_HEIGHT - 8, Math.min(maxH + 10, grabStartH + dy));
  dragHeightPx.value = nextH;
}

function onGrabberUp(e: PointerEvent) {
  if (!draggingSplit.value || grabPointerId !== e.pointerId) return;
  const totalDy = Math.abs(e.clientY - grabStartY);
  const finalH = dragHeightPx.value ?? grabStartH;
  const vy = grabVelocityY;

  draggingSplit.value = false;
  dragHeightPx.value = null;
  grabPointerId = null;

  // A quick tap (< 6px drag) cycles through the 3 detents
  if (totalDy < 6) {
    cycleDetent();
    return;
  }

  const maxH = getMonthFullHeight();
  const projectedH = finalH + vy * 140;
  const midWeekSplit = (WEEK_HEIGHT + SPLIT_HEIGHT) / 2;
  const midSplitMonth = (SPLIT_HEIGHT + maxH) / 2;

  if (projectedH < midWeekSplit) {
    detent.value = 'week';
  } else if (projectedH > midSplitMonth) {
    detent.value = 'month';
  } else {
    detent.value = 'split';
  }
}

onBeforeUnmount(() => {
  if (boundaryTimer) clearTimeout(boundaryTimer);
});
</script>

<template>
  <div ref="stageRef" class="calico-stage">
    <!-- Hidden accessible role="tab" switchers so both dock and keyboard/assistive tools can toggle Split vs Timeline -->
    <div class="calico-sr-tabs" role="tablist" aria-label="今日视图切换">
      <button
        type="button"
        role="tab"
        :aria-selected="activeMode === 'split'"
        class="calico-sr-tab"
        @click="setMode('split')"
      >
        今日概览
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeMode === 'timeline'"
        class="calico-sr-tab"
        @click="setMode('timeline')"
      >
        时间轴
      </button>
    </div>

    <!-- MODE A: Calico 3-Detent Split Calendar + Day Agenda -->
    <template v-if="activeMode === 'split'">
      <!-- Sticky Weekday Header Row (S M T W T F S / 日 一 二 三 四 五 六) -->
      <div class="calico-weekdays" aria-hidden="true">
        <span
          v-for="w in weekdayHeaders"
          :key="w.wd"
          class="calico-wd"
          :class="{ rest: w.isRest }"
        >
          {{ w.label }}
        </span>
      </div>

      <!-- Resizable Upper Calendar Grid Pane -->
      <section
        class="calico-cal-pane"
        :class="[`detent-${detent}`, { dragging: draggingSplit }]"
        :style="{ height: `${Math.round(currentCalHeight)}px` }"
        aria-label="月历与周历视图"
        @pointerdown="onGridPointerDown"
        @pointermove="onGridPointerMove"
        @pointerup="onGridPointerUp"
        @pointercancel="onGridPointerUp"
      >
        <!-- Kinetic Month Boundary Pill (shown when swiping across months, like December / January in video) -->
        <Transition name="calico-fade">
          <div v-if="monthBoundaryLabel" class="calico-month-floater" aria-live="polite">
            {{ monthBoundaryLabel }}
          </div>
        </Transition>

        <!-- Detent 1 (Dragged UP): Single Active Week Row with Mini Event Title Lines -->
        <div v-if="showWeekStripOnly" class="calico-week-single">
          <button
            v-for="d in activeWeekDays"
            :key="d"
            type="button"
            class="calico-cell week-cell"
            :data-iso="d"
            :class="{
              today: d === now,
              selected: d === ui.selected,
              outside: !isInCurrentMonth(d),
            }"
            :aria-pressed="d === ui.selected"
            @click="pickCell(d)"
          >
            <span class="calico-num-pill">{{ parts(d)[2] }}</span>
            <div class="calico-mini-events">
              <span
                v-for="ev in dayMiniEvents(d, 3)"
                :key="ev.id"
                class="calico-mini-evt"
                :class="{ done: ev.done }"
                :style="{ color: ev.color }"
              >
                {{ ev.title }}
              </span>
            </div>
          </button>
        </div>

        <!-- Detent 2 (Split) & Detent 3 (Full Month): 6-Row Month Grid -->
        <div v-else class="calico-month-grid" :class="{ detailed: showMonthMiniEvents }">
          <div
            v-for="(row, rIdx) in monthRows"
            :key="row[0] ?? rIdx"
            class="calico-week-row"
          >
            <button
              v-for="d in row"
              :key="d"
              type="button"
              class="calico-cell"
              :data-iso="d"
              :class="{
                today: d === now,
                selected: d === ui.selected,
                outside: !isInCurrentMonth(d),
              }"
              :aria-pressed="d === ui.selected"
              @click="pickCell(d)"
            >
              <span class="calico-num-pill">{{ parts(d)[2] }}</span>

              <!-- Detent 3 (Expanded Full Month): Multi-line colored mini event titles -->
              <div v-if="showMonthMiniEvents" class="calico-mini-events">
                <span
                  v-for="ev in dayMiniEvents(d, 4)"
                  :key="ev.id"
                  class="calico-mini-evt"
                  :class="{ done: ev.done }"
                  :style="{ color: ev.color }"
                >
                  {{ ev.title }}
                </span>
              </div>

              <!-- Detent 2 (Default Split View): Multi-color event dots row -->
              <div v-else class="calico-dots" aria-hidden="true">
                <span
                  v-for="dot in dayDots(d)"
                  :key="dot.id"
                  class="calico-dot"
                  :style="{ background: dot.color }"
                />
              </div>
            </button>
          </div>
        </div>
      </section>

      <!-- Draggable Split Divider Handle (36x4.5px Grabber Pill) -->
      <div
        class="calico-divider"
        :class="{ active: draggingSplit, 'at-bottom': detent === 'month' && !draggingSplit }"
        role="separator"
        aria-orientation="horizontal"
        aria-label="上下拖动切换周历、分栏与全屏月历"
        title="上下拖动或轻点切换：周视图 / 分栏视图 / 全屏月历"
        @pointerdown="onGrabberDown"
        @pointermove="onGrabberMove"
        @pointerup="onGrabberUp"
        @pointercancel="onGrabberUp"
      >
        <span class="calico-grabber-pill" aria-hidden="true" />
        <span v-if="detent === 'month' && !draggingSplit" class="calico-detent-hint">
          {{ selectedDayHeadingText }} · {{ selectedOccurrences.length }} 项安排（向上拉或轻点展开）
        </span>
      </div>

      <!-- Lower Day Agenda Sheet -->
      <section v-show="detent !== 'month' || draggingSplit" class="calico-agenda-pane">
        <!-- Selected Day Header with Kinetic Vertical Text Flip -->
        <div class="calico-agenda-head">
          <Transition :name="dayFlipDir === 'next' ? 'calico-flip-up' : 'calico-flip-down'" mode="out-in">
            <div :key="ui.selected" class="calico-day-title-wrap">
              <h2 class="calico-day-title">{{ selectedDayHeadingText }}</h2>
              <span class="calico-day-sub">{{ selectedDaySubText }}</span>
            </div>
          </Transition>

          <div class="calico-head-tools">
            <button
              v-if="ui.selected !== now"
              type="button"
              class="calico-today-chip"
              @click="goToday()"
            >
              回到今天
            </button>
            <button
              type="button"
              class="calico-icon-add"
              title="在所选日期新建日程"
              aria-label="在所选日期新建日程"
              @click="openNew(ui.selected)"
            >
              <FIcon name="add" :size="14" />
            </button>
          </div>
        </div>

        <!-- Scrollable Day Events Feed -->
        <div class="calico-agenda-scroll">
          <!-- All-Day Banner Pills (1:1 'Release Day | All Day' style) -->
          <div v-if="selectedAllDayItems.length" class="calico-allday-list">
            <div
              v-for="o in selectedAllDayItems"
              :key="`all:${o.task.id}:${o.date}`"
              class="calico-allday-pill"
              :class="{ done: o.done }"
              :style="{ '--pill-color': occAccentHex(o.task) }"
              @click="emit('openTask', o.task.id)"
              @contextmenu="onTaskMenu($event, o.task)"
            >
              <button
                type="button"
                class="calico-allday-ico"
                :aria-label="o.done ? '标记未完成' : '标记已完成'"
                @click.stop="toggleOccDone(o)"
              >
                <FIcon :name="o.done ? 'check' : 'calendar'" :size="13" />
              </button>
              <span class="calico-allday-title">{{ o.task.title }}</span>
              <span class="calico-allday-badge">{{ allDayBadgeText(o) }}</span>
            </div>
          </div>

          <!-- Timed Event Rows (1:1 'Morning Run | 6:30 - 7:00' style with left vertical color bar) -->
          <div v-if="selectedTimedItems.length" class="calico-timed-list">
            <article
              v-for="o in selectedTimedItems"
              :key="`timed:${o.task.id}:${o.date}`"
              class="calico-timed-row"
              :class="{ done: o.done }"
              @click="emit('openTask', o.task.id)"
              @contextmenu="onTaskMenu($event, o.task)"
            >
              <span
                class="calico-row-bar"
                :style="{ background: occAccentHex(o.task) }"
                aria-hidden="true"
              />

              <div class="calico-row-main">
                <div class="calico-row-title">{{ o.task.title }}</div>
                <div v-if="taskSubtitle(o.task)" class="calico-row-sub">
                  <svg class="calico-nav-arrow" viewBox="0 0 12 12" aria-hidden="true">
                    <path
                      d="M1.8 5.6 10.2 1.8 6.4 10.2 5.2 6.8 1.8 5.6Z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>{{ taskSubtitle(o.task) }}</span>
                </div>
              </div>

              <div class="calico-row-right">
                <span class="calico-row-time">
                  <strong>{{ formatStartTime(o.task.time) }}</strong>
                  <em> - {{ formatEndTime(o.task.time, o.task.duration) }}</em>
                </span>
                <button
                  type="button"
                  class="calico-row-check"
                  :class="{ done: o.done }"
                  :aria-label="o.done ? '标记未完成' : '标记已完成'"
                  @click.stop="toggleOccDone(o)"
                >
                  <svg viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.8 9.5 3.6" /></svg>
                </button>
              </div>
            </article>
          </div>

          <!-- Empty Day State -->
          <div v-if="!selectedAllDayItems.length && !selectedTimedItems.length" class="calico-empty-day">
            <span class="calico-empty-txt">当天暂无日程安排</span>
          </div>

          <!-- Inline Quick Add Row -->
          <form class="calico-quick-form" @submit.prevent="submitQuickTask">
            <FIcon name="add" :size="13" class="calico-qf-ico" />
            <input
              v-model="quickTitle"
              type="text"
              class="calico-qf-input"
              placeholder="添加当天日程或任务，回车保存…"
            />
            <button v-if="quickTitle.trim()" type="submit" class="calico-qf-submit">添加</button>
          </form>
        </div>
      </section>
    </template>

    <!-- MODE B: Vertical Hourly Timeline View -->
    <section v-else class="calico-timeline-pane">
      <div class="calico-tl-bar">
        <div class="calico-day-title-wrap">
          <h2 class="calico-day-title">{{ selectedDayHeadingText }}</h2>
          <span class="calico-day-sub">{{ selectedDaySubText }}</span>
        </div>
        <div class="calico-tl-actions">
          <button type="button" class="calico-today-chip" @click="setMode('split')">
            返回月历分栏
          </button>
          <button
            type="button"
            class="calico-icon-add"
            title="新建时段事项"
            aria-label="新建时段事项"
            @click="openNew(ui.selected)"
          >
            <FIcon name="add" :size="14" />
          </button>
        </div>
      </div>
      <div class="calico-tl-stage">
        <DayView />
      </div>
    </section>
  </div>
</template>

<style scoped>
.calico-stage {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  overflow: hidden;
  user-select: none;
}

.calico-sr-tabs {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Weekday Strip: S M T W T F S */
.calico-weekdays {
  flex: none;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  padding: 4px 10px 7px;
  border-bottom: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
}

.calico-wd {
  text-align: center;
  font-size: 11px;
  font-weight: 650;
  color: var(--ws-ink-muted);
  letter-spacing: 0.02em;
}

.calico-wd.rest {
  color: color-mix(in srgb, var(--ws-ink-muted) 78%, transparent);
}

/* Upper Resizable Calendar Pane */
.calico-cal-pane {
  position: relative;
  flex: none;
  overflow: hidden;
  padding: 0 8px;
  background: var(--ws-card-bg);
  transition: height 320ms cubic-bezier(0.22, 1, 0.36, 1);
  touch-action: pan-x;
}

.calico-cal-pane.dragging {
  transition: none;
}

.calico-month-floater {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.01em;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
  pointer-events: none;
}

/* 6-Row Month Grid */
.calico-month-grid {
  height: 100%;
  display: grid;
  grid-template-rows: repeat(6, minmax(0, 1fr));
}

.calico-week-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid color-mix(in srgb, var(--ws-hairline) 75%, transparent);
}

.calico-week-row:last-child {
  border-bottom: 0;
}

/* Single Week Row (Detent 1) */
.calico-week-single {
  height: 100%;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  padding-top: 2px;
}

/* Day Cell */
.calico-cell {
  border: 0;
  background: transparent;
  padding: 4px 2px 3px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 3px;
  color: var(--ws-ink);
  font: inherit;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}

.calico-cell.outside {
  color: color-mix(in srgb, var(--ws-ink-muted) 45%, transparent);
}

.calico-cell.outside .calico-dots,
.calico-cell.outside .calico-mini-events {
  opacity: 0.42;
}

/* Squircle Day Number Pill (28x26 rounded-square squircle matching Calico) */
.calico-num-pill {
  width: 30px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15.5px;
  font-weight: 520;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  transition:
    background-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
    color 140ms ease,
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Today when not selected: bold numeral (like '13' in the reference image) */
.calico-cell.today:not(.selected) .calico-num-pill {
  font-weight: 820;
  color: #e85d2a;
}

/* Selected Day: Rounded Dark Charcoal Squircle (or Warm Vermilion when Today is selected) */
.calico-cell.selected .calico-num-pill {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font-weight: 720;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
}

.calico-cell.selected.today .calico-num-pill {
  background: #e85d2a;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(232, 93, 42, 0.32);
}

/* Multi-color Event Dots Row (Detent 2 Split View) */
.calico-dots {
  height: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2.5px;
}

.calico-dot {
  width: 4.5px;
  height: 4.5px;
  border-radius: 999px;
  flex: none;
}

/* Multi-line Mini Colored Event Titles (Detent 1 Week Strip & Detent 3 Full Month) */
.calico-mini-events {
  width: 100%;
  padding: 0 2px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1.5px;
  min-width: 0;
  overflow: hidden;
}

.calico-mini-evt {
  display: block;
  font-size: 9.5px;
  font-weight: 640;
  line-height: 1.22;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}

.calico-mini-evt.done {
  opacity: 0.48;
  text-decoration: line-through;
}

/* Draggable Split Grabber Handle */
.calico-divider {
  flex: none;
  min-height: 22px;
  padding: 6px 14px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: var(--ws-card-bg);
  border-top: 1px solid color-mix(in srgb, var(--ws-hairline) 85%, transparent);
  cursor: ns-resize;
  touch-action: none;
  z-index: 6;
}

.calico-divider.at-bottom {
  padding: 8px 14px;
  margin-bottom: calc(86px + env(safe-area-inset-bottom));
}

.calico-grabber-pill {
  width: 36px;
  height: 4.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink-muted) 42%, transparent);
  transition: transform 150ms ease, background-color 150ms ease, width 150ms ease;
}

.calico-divider:active .calico-grabber-pill,
.calico-divider.active .calico-grabber-pill {
  width: 44px;
  background: var(--ws-ink-secondary);
  transform: scaleY(1.15);
}

.calico-detent-hint {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
}

/* Lower Day Agenda Sheet */
.calico-agenda-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 2px 16px 0;
  background: var(--ws-card-bg);
}

.calico-agenda-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0 10px;
}

.calico-day-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.calico-day-title {
  margin: 0;
  font-size: 16.5px;
  font-weight: 760;
  letter-spacing: -0.02em;
  color: var(--ws-ink);
  white-space: nowrap;
}

.calico-day-sub {
  font-size: 12px;
  font-weight: 540;
  color: var(--ws-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calico-head-tools {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.calico-today-chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 640;
  cursor: pointer;
}

.calico-icon-add {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.calico-agenda-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: calc(104px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* All-Day Event Banner Pills (1:1 'Release Day | All Day') */
.calico-allday-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.calico-allday-pill {
  --pill-color: #d97706;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--pill-color) 13%, var(--ws-card-bg));
  cursor: pointer;
  transition: transform 120ms ease, opacity 140ms ease;
}

.calico-allday-pill:active {
  transform: scale(0.988);
}

.calico-allday-pill.done {
  opacity: 0.56;
}

.calico-allday-ico {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--pill-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  flex: none;
}

.calico-allday-title {
  flex: 1;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 680;
  color: var(--pill-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calico-allday-pill.done .calico-allday-title {
  text-decoration: line-through;
}

.calico-allday-badge {
  flex: none;
  font-size: 12.5px;
  font-weight: 720;
  color: var(--ws-ink);
  letter-spacing: -0.01em;
}

/* Timed Event Rows (1:1 'Morning Run | 6:30 - 7:00' with left vertical bar) */
.calico-timed-list {
  display: flex;
  flex-direction: column;
}

.calico-timed-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--ws-hairline);
  cursor: pointer;
  transition: background-color 120ms ease, opacity 140ms ease;
}

.calico-timed-row:active {
  background: var(--ws-card-subtle);
}

.calico-timed-row.done {
  opacity: 0.52;
}

.calico-row-bar {
  width: 3.5px;
  align-self: stretch;
  min-height: 30px;
  border-radius: 999px;
  flex: none;
}

.calico-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.calico-row-title {
  font-size: 15px;
  font-weight: 680;
  color: var(--ws-ink);
  line-height: 1.28;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calico-timed-row.done .calico-row-title {
  text-decoration: line-through;
}

.calico-row-sub {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ws-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calico-nav-arrow {
  width: 11px;
  height: 11px;
  flex: none;
  opacity: 0.72;
}

.calico-row-right {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.calico-row-time {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.calico-row-time strong {
  font-weight: 680;
  color: var(--ws-ink-secondary);
}

.calico-row-time em {
  font-style: normal;
  font-weight: 500;
  color: var(--ws-ink-muted);
}

.calico-row-check {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--ws-ink-muted) 42%, transparent);
  background: transparent;
  color: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition: all 140ms ease;
}

.calico-row-check svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.calico-row-check.done {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

/* Empty & Inline Quick Add */
.calico-empty-day {
  padding: 14px 4px 6px;
  color: var(--ws-ink-muted);
  font-size: 13px;
}

.calico-quick-form {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-radius: 11px;
  background: var(--ws-card-subtle);
  border: 1px solid transparent;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.calico-quick-form:focus-within {
  background: var(--ws-card-bg);
  border-color: var(--ws-border-card);
}

.calico-qf-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.calico-qf-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.calico-qf-input::placeholder {
  color: var(--ws-ink-muted);
}

.calico-qf-submit {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font: inherit;
  font-size: 11.5px;
  font-weight: 650;
  cursor: pointer;
}

/* Timeline Sub-Mode */
.calico-timeline-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 12px calc(98px + env(safe-area-inset-bottom));
  gap: 8px;
}

.calico-tl-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px;
}

.calico-tl-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.calico-tl-stage {
  flex: 1;
  min-height: 0;
  border-radius: 14px;
  border: 1px solid var(--ws-hairline);
  overflow: hidden;
  background: var(--ws-card-bg);
}

.calico-tl-stage :deep(.day-view) {
  height: 100%;
}

/* Kinetic Day Header Flip Transitions (matching video 00:01–00:09) */
.calico-flip-up-enter-active,
.calico-flip-up-leave-active,
.calico-flip-down-enter-active,
.calico-flip-down-leave-active {
  transition:
    transform 150ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 150ms ease,
    filter 150ms ease;
}

.calico-flip-up-enter-from {
  opacity: 0;
  transform: translateY(8px);
  filter: blur(2px);
}
.calico-flip-up-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  filter: blur(2px);
}

.calico-flip-down-enter-from {
  opacity: 0;
  transform: translateY(-8px);
  filter: blur(2px);
}
.calico-flip-down-leave-to {
  opacity: 0;
  transform: translateY(8px);
  filter: blur(2px);
}

.calico-fade-enter-active,
.calico-fade-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.calico-fade-enter-from,
.calico-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}
</style>
