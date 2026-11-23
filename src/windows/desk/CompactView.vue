<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { ISODate, Task } from '@/types';
import {
  addDays,
  addMonths,
  formatFriendly,
  isoWeek,
  monthWeeks,
  parts,
  startOfMonth,
} from '@/lib/date';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { agenda, listDayHeading } from '@/lib/agenda';
import {
  clampMinutes,
  computeCreateRange,
  DAY_MINUTES,
  DEFAULT_DURATION,
  floorMinutes,
  formatDurationLabel,
  formatMinToHHMM,
  formatRangeLabel,
  MIN_DURATION,
  parseTimeMin,
} from '@/lib/dayLayout';
import {
  clusterColors,
  clusterDayEvents,
  DEFAULT_HOUR_H,
  findNowOrNext,
  formatCompactDateLabel,
  MAX_HOUR_H,
  MIN_HOUR_H,
  stepZoomDays,
  visibleDatesForSpan,
  ZOOM_DAY_STEPS,
  type CompactEventInput,
  type CompactRenderedBlock,
  type ZoomDays,
} from '@/lib/compactTimeline';
import { occurrences, type Occurrence } from '@/lib/recur';
import { addTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, patchSettings, storeState } from '@/stores/doc';
import { isServer } from '@/api';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { syncNow, syncStatus, watchSync } from '@/composables/sync';
import { statusLine } from '@/lib/syncText';
import { chipMenu, moreMenu } from './menus';
import { goToday, openEditor, shownTasks, ui } from './state';

watchSync();

type CompactMode = 'list' | 'split' | 'timeline';
const MODE_KEY = 'fluentcal.compact.mode';
const DAYS_KEY = 'fluentcal.compact.days';
const HOUR_H_KEY = 'fluentcal.compact.hourH';

function readStored<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore storage errors */
  }
}

const mode = ref<CompactMode>(
  readStored<CompactMode>(MODE_KEY, (r) => (r === 'list' || r === 'split' || r === 'timeline' ? r : null), 'timeline'),
);
const daysCount = ref<ZoomDays>(
  readStored<ZoomDays>(DAYS_KEY, (r) => (ZOOM_DAY_STEPS.includes(Number(r) as ZoomDays) ? (Number(r) as ZoomDays) : null), 1),
);
const hourHeight = ref<number>(
  readStored<number>(
    HOUR_H_KEY,
    (r) => {
      const n = Number(r);
      return Number.isFinite(n) ? Math.max(MIN_HOUR_H, Math.min(MAX_HOUR_H, n)) : null;
    },
    DEFAULT_HOUR_H,
  ),
);

watch(mode, (v) => writeStored(MODE_KEY, v));
watch(daysCount, (v) => writeStored(DAYS_KEY, String(v)));
watch(hourHeight, (v) => writeStored(HOUR_H_KEY, String(Math.round(v))));

const trayOpen = ref(false);
let trayCloseTimer: ReturnType<typeof setTimeout> | undefined;

const zoomBadge = ref('');
let zoomBadgeTimer: ReturnType<typeof setTimeout> | undefined;
function showZoomBadge(text: string) {
  zoomBadge.value = text;
  clearTimeout(zoomBadgeTimer);
  zoomBadgeTimer = setTimeout(() => {
    zoomBadge.value = '';
  }, 1150);
}

const zoomRatio = computed(() =>
  Math.max(0, Math.min(1, (hourHeight.value - MIN_HOUR_H) / (MAX_HOUR_H - MIN_HOUR_H))),
);
const densityLabel = computed(() =>
  hourHeight.value < 42 ? '紧凑' : hourHeight.value > 68 ? '宽松' : '标准',
);

const reduceMotion = computed(() => doc.settings.theme.reduceMotion);
const locked = computed(() => doc.settings.desk.locked);

// Live current minute updated every 30s.
function currentMinuteOfDay(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
const nowMin = ref(currentMinuteOfDay());
let nowTimer: ReturnType<typeof setInterval> | undefined;

const HEADER_MONTH = computed(() => {
  const focus = mode.value === 'split' ? splitCursor.value : ui.selected;
  const [y, m] = parts(focus);
  return { y, m, week: isoWeek(ui.selected) };
});

function durationOf(task: Task): number {
  const raw = task.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(DAY_MINUTES, Math.max(MIN_DURATION, Math.round(raw)));
  }
  return DEFAULT_DURATION;
}

function occKey(occ: Occurrence): string {
  return `${occ.task.id}@${occ.date}`;
}

function taskAccentHex(task: Task): string {
  const g = task.groupId ? doc.groups[task.groupId]?.color : undefined;
  return taskColor(task.color || g, isDark.value).bar;
}

// ---------------------------------------------------------------- Timeline & Buffered Swipe Windows

const visibleDates = computed<ISODate[]>(() =>
  visibleDatesForSpan(ui.selected, daysCount.value, doc.settings.calendar.weekStart),
);

const bufferedDates = computed<ISODate[]>(() => {
  const vd = visibleDates.value;
  return [addDays(vd[0], -1), ...vd, addDays(vd[vd.length - 1], 1)];
});

const timelineOccurrences = computed(() => {
  const dates = bufferedDates.value;
  const s = dates[0];
  const e = dates[dates.length - 1];
  const showDone = doc.settings.tasks.showCompleted;
  const byDate = new Map<ISODate, Occurrence[]>();
  for (const d of dates) byDate.set(d, []);

  for (const t of shownTasks.value) {
    for (const o of occurrences(t, s, e)) {
      if (!showDone && o.done && t.id !== ui.revealTask) continue;
      for (const d of dates) {
        if (d >= o.start && d <= o.end) byDate.get(d)?.push(o);
      }
    }
  }
  return byDate;
});

const allDayByDate = computed(() => {
  const map = new Map<ISODate, Occurrence[]>();
  for (const d of visibleDates.value) {
    const list = (timelineOccurrences.value.get(d) ?? [])
      .filter((o) => !o.task.time)
      .sort((a, b) => Number(a.done) - Number(b.done) || a.task.order - b.task.order);
    map.set(d, list);
  }
  return map;
});

const hasAnyAllDay = computed(() => visibleDates.value.some((d) => (allDayByDate.value.get(d)?.length ?? 0) > 0));

const occLookup = computed(() => {
  const m = new Map<string, Occurrence>();
  for (const list of timelineOccurrences.value.values()) {
    for (const o of list) m.set(occKey(o), o);
  }
  return m;
});

const blocksByDate = computed(() => {
  const out = new Map<ISODate, CompactRenderedBlock[]>();
  const h = hourHeight.value;
  const dc = daysCount.value;
  for (const d of bufferedDates.value) {
    const inputs: CompactEventInput[] = (timelineOccurrences.value.get(d) ?? [])
      .filter((o) => !!o.task.time)
      .map((o) => {
        const s = parseTimeMin(o.task.time);
        const e = Math.min(DAY_MINUTES, s + durationOf(o.task));
        return {
          id: occKey(o),
          title: o.task.title,
          startMin: s,
          endMin: Math.max(s + MIN_DURATION, e),
          color: taskAccentHex(o.task),
          done: o.done,
          order: o.task.order,
        };
      });
    out.set(d, clusterDayEvents(inputs, h, dc));
  }
  return out;
});

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const timelineHeight = computed(() => Math.round(24 * hourHeight.value));

function isHourHidden(h: number): boolean {
  if (hourHeight.value < 34 && h % 2 === 1) return true;
  if (visibleDates.value.includes(now.value)) {
    const pillY = (nowMin.value / 60) * hourHeight.value;
    if (Math.abs(h * hourHeight.value - pillY) < 15) return true;
  }
  return false;
}

function blockPxHeight(b: { startMin: number; endMin: number }): number {
  const minH = daysCount.value >= 5 ? 16 : 20;
  return Math.max(minH, ((b.endMin - b.startMin) / 60) * hourHeight.value - 3);
}

function blockStyle(b: CompactRenderedBlock): Record<string, string> {
  const h = hourHeight.value;
  const topPx = (b.startMin / 60) * h + 1.5;
  const heightPx = blockPxHeight(b);
  const gap = daysCount.value >= 4 ? 2 : 4;
  const leftExpr =
    b.colCount <= 1 ? 'calc(0% + 1px)' : `calc(${(b.col / b.colCount) * 100}% + ${((b.col * gap) / b.colCount + 1).toFixed(2)}px)`;
  const widthExpr =
    b.colCount <= 1
      ? 'calc(100% - 2px)'
      : `calc(${100 / b.colCount}% - ${(((b.colCount - 1) * gap) / b.colCount + 2).toFixed(2)}px)`;

  const style: Record<string, string> = {
    top: `${topPx.toFixed(1)}px`,
    height: `${heightPx.toFixed(1)}px`,
    left: leftExpr,
    width: widthExpr,
  };
  if (b.kind === 'single') style['--ev-bar'] = b.item.color;
  return style;
}

function titleClampClass(b: CompactRenderedBlock): string {
  const px = blockPxHeight(b);
  if (px >= 54) return 'clamp-3';
  if (px >= 34) return 'clamp-2';
  return 'clamp-1';
}

function showBlockDuration(b: CompactRenderedBlock): boolean {
  if (daysCount.value >= 4) return false;
  const px = blockPxHeight(b);
  return b.kind === 'cluster' ? px >= 22 : b.endMin - b.startMin >= 30 && px >= 28;
}

function showBlockTimeRange(b: CompactRenderedBlock): boolean {
  if (daysCount.value >= 4) return false;
  return blockPxHeight(b) >= 40;
}

function cycleSpan() {
  const next: ZoomDays = daysCount.value === 1 ? 3 : daysCount.value < 7 ? 7 : 1;
  daysCount.value = next;
  showZoomBadge(`${next}天`);
}

function cycleDensity() {
  const next = hourHeight.value < 42 ? 74 : hourHeight.value > 68 ? 58 : 32;
  hourHeight.value = next;
  showZoomBadge(next < 42 ? '紧凑视图' : next > 68 ? '宽松视图' : '标准视图');
}

function focusDayFromMulti(date: ISODate) {
  ui.selected = date;
  ui.cursor = startOfMonth(date);
  if (daysCount.value > 1) {
    daysCount.value = 1;
    showZoomBadge('1天');
  }
}

function expandCluster(date: ISODate, startMin: number) {
  ui.selected = date;
  ui.cursor = startOfMonth(date);
  daysCount.value = 1;
  hourHeight.value = Math.max(hourHeight.value, 62);
  showZoomBadge('1天 · 展开');
  void nextTick(() => scrollToMinute(startMin, true));
}

function stepDay(delta: number) {
  ui.selected = addDays(ui.selected, delta);
  ui.cursor = startOfMonth(ui.selected);
}

function onBlockClick(date: ISODate, b: CompactRenderedBlock) {
  if (b.kind === 'cluster') {
    expandCluster(date, b.startMin);
    return;
  }
  const occ = occLookup.value.get(b.id);
  if (occ) openEditor({ mode: 'edit', taskId: occ.task.id, date: occ.date });
}

function onBlockMenu(b: CompactRenderedBlock, e: MouseEvent) {
  if (b.kind !== 'single') return;
  const occ = occLookup.value.get(b.id);
  if (occ) void chipMenu(occ, e);
}

function onColumnDblClick(date: ISODate, e: MouseEvent) {
  if (storeState.readOnly) return;
  if ((e.target as HTMLElement).closest('.cv-block')) return;
  const colRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const min = clampMinutes(floorMinutes(((e.clientY - colRect.top) / hourHeight.value) * 60), 0, DAY_MINUTES - DEFAULT_DURATION);
  openEditor({
    mode: 'new',
    start: date,
    end: date,
    time: formatMinToHHMM(min),
    duration: DEFAULT_DURATION,
  });
}

// ---------------------------------------------------------------- Empty-slot Mouse Drag-to-Create

const draftCreate = ref<{ date: ISODate; startMin: number; endMin: number } | null>(null);
let cleanupColDrag: (() => void) | null = null;

function onColPointerDown(date: ISODate, e: PointerEvent) {
  if (e.button !== 0 || storeState.readOnly || !locked.value || e.pointerType === 'touch') return;
  if ((e.target as HTMLElement).closest('.cv-block')) return;
  e.preventDefault();

  const colEl = e.currentTarget as HTMLElement;
  const anchorMin = clampMinutes(floorMinutes(((e.clientY - colEl.getBoundingClientRect().top) / hourHeight.value) * 60), 0, DAY_MINUTES - MIN_DURATION);
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let started = false;

  const update = (clientY: number) => {
    const rawCur = ((clientY - colEl.getBoundingClientRect().top) / hourHeight.value) * 60;
    const { startMin, endMin } = computeCreateRange(anchorMin, rawCur);
    if (!draftCreate.value) {
      draftCreate.value = { date, startMin, endMin };
    } else if (draftCreate.value.startMin !== startMin || draftCreate.value.endMin !== endMin) {
      draftCreate.value.startMin = startMin;
      draftCreate.value.endMin = endMin;
    }
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    cleanupColDrag = null;
    draftCreate.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    if (!started) {
      if (Math.abs(ev.clientY - startY) < 6) return;
      started = true;
    }
    update(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const cur = draftCreate.value;
    const ok = started && !!cur;
    cleanup();
    if (ok && cur) {
      openEditor({
        mode: 'new',
        start: cur.date,
        end: cur.date,
        time: formatMinToHHMM(cur.startMin),
        duration: Math.max(MIN_DURATION, cur.endMin - cur.startMin),
      });
    }
  };

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      cleanup();
    }
  };

  cleanupColDrag?.();
  cleanupColDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

// ---------------------------------------------------------------- Timeline Scroll, Buffered Swipe & Pinch Gestures

const scrollRef = ref<HTMLElement>();
const colsStageRef = ref<HTMLElement>();
const swipeOffsetX = ref(0);
const swipeActive = ref(false);
let swipeRaf = 0;
let wheelAccX = 0;
let wheelLockUntil = 0;
let wheelAltLockUntil = 0;

function onTimelineScroll() {
  if (trayOpen.value) trayOpen.value = false;
}

function scrollToMinute(min: number, smooth = false) {
  const el = scrollRef.value;
  if (!el) return;
  const targetMin = Math.max(0, min - 75);
  el.scrollTo({
    top: (targetMin / 60) * hourHeight.value,
    behavior: smooth && !reduceMotion.value ? 'smooth' : 'auto',
  });
}

function scrollInitial() {
  const dayTimed = (timelineOccurrences.value.get(ui.selected) ?? [])
    .filter((o) => !!o.task.time)
    .sort((a, b) => parseTimeMin(a.task.time) - parseTimeMin(b.task.time));
  const min = dayTimed.length
    ? Math.min(8 * 60, parseTimeMin(dayTimed[0].task.time))
    : ui.selected === now.value
      ? Math.max(6 * 60, nowMin.value - 90)
      : 8 * 60;
  scrollToMinute(min, false);
}

function commitAnimatedSwipe(dir: 1 | -1, currentOffsetPx: number) {
  const cw = colsStageRef.value ? colsStageRef.value.clientWidth / daysCount.value : 0;
  if (reduceMotion.value || !cw) {
    swipeOffsetX.value = 0;
    swipeActive.value = false;
    stepDay(dir);
    return;
  }
  swipeActive.value = true;
  stepDay(dir);
  swipeOffsetX.value = dir > 0 ? Math.max(0, cw + currentOffsetPx) : Math.min(0, currentOffsetPx - cw);
  cancelAnimationFrame(swipeRaf);
  swipeRaf = requestAnimationFrame(() => {
    swipeRaf = requestAnimationFrame(() => {
      swipeActive.value = false;
      swipeOffsetX.value = 0;
    });
  });
}

function onTimelineWheel(e: WheelEvent) {
  const el = scrollRef.value;
  if (!el) return;

  if (e.ctrlKey) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0024);
    const oldH = hourHeight.value;
    const newH = Math.max(MIN_HOUR_H, Math.min(MAX_HOUR_H, oldH * factor));
    if (Math.abs(newH - oldH) > 0.05) {
      const rect = el.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const anchorHour = (el.scrollTop + pointerY) / oldH;
      hourHeight.value = newH;
      void nextTick(() => {
        if (scrollRef.value) scrollRef.value.scrollTop = Math.max(0, anchorHour * newH - pointerY);
      });
    }
    showZoomBadge(`${Math.round((hourHeight.value / DEFAULT_HOUR_H) * 100)}%`);
    return;
  }

  if (e.altKey) {
    e.preventDefault();
    const t = performance.now();
    if (t < wheelAltLockUntil) return;
    if (Math.abs(e.deltaY) >= 4) {
      const next = stepZoomDays(daysCount.value, e.deltaY > 0 ? 1 : -1);
      if (next !== daysCount.value) {
        daysCount.value = next;
        showZoomBadge(`${next}天`);
        wheelAltLockUntil = t + 360;
      }
    }
    return;
  }

  // Trackpad horizontal swipe for day stepping with momentum cooldown guard.
  if (daysCount.value <= 3 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 && Math.abs(e.deltaX) > 6) {
    e.preventDefault();
    const t = performance.now();
    if (t < wheelLockUntil) return;
    if (Math.sign(e.deltaX) !== Math.sign(wheelAccX)) wheelAccX = 0;
    wheelAccX += e.deltaX;
    if (Math.abs(wheelAccX) >= 75) {
      commitAnimatedSwipe(wheelAccX > 0 ? 1 : -1, 0);
      wheelAccX = 0;
      wheelLockUntil = t + 540;
    }
  }
}

interface TouchGesture {
  kind: 'pending' | 'swipe' | 'pinch-x' | 'pinch-y';
  x0: number;
  y0: number;
  dx0: number;
  dy0: number;
  baseDays: ZoomDays;
  baseH: number;
  anchorHour: number;
  midOffsetY: number;
}
let touchG: TouchGesture | null = null;

function onTimelineTouchStart(e: TouchEvent) {
  const el = scrollRef.value;
  if (!el) return;
  if (e.touches.length === 2) {
    const a = e.touches[0];
    const b = e.touches[1];
    const dx = Math.abs(a.clientX - b.clientX);
    const dy = Math.abs(a.clientY - b.clientY);
    const midY = (a.clientY + b.clientY) / 2 - el.getBoundingClientRect().top;
    touchG = {
      kind: dx > dy * 1.15 ? 'pinch-x' : 'pinch-y',
      x0: (a.clientX + b.clientX) / 2,
      y0: (a.clientY + b.clientY) / 2,
      dx0: Math.max(20, dx),
      dy0: Math.max(20, dy),
      baseDays: daysCount.value,
      baseH: hourHeight.value,
      anchorHour: (el.scrollTop + midY) / hourHeight.value,
      midOffsetY: midY,
    };
    swipeActive.value = false;
    swipeOffsetX.value = 0;
  } else if (e.touches.length === 1 && daysCount.value <= 3) {
    const t = e.touches[0];
    touchG = {
      kind: 'pending',
      x0: t.clientX,
      y0: t.clientY,
      dx0: 0,
      dy0: 0,
      baseDays: daysCount.value,
      baseH: hourHeight.value,
      anchorHour: 0,
      midOffsetY: 0,
    };
  }
}

function onTimelineTouchMove(e: TouchEvent) {
  if (!touchG || !scrollRef.value) return;
  if (e.touches.length === 2) {
    e.preventDefault();
    const a = e.touches[0];
    const b = e.touches[1];
    if (touchG.kind === 'pending' || touchG.kind === 'swipe') {
      const dx0 = Math.max(20, Math.abs(a.clientX - b.clientX));
      const dy0 = Math.max(20, Math.abs(a.clientY - b.clientY));
      const midY = (a.clientY + b.clientY) / 2 - scrollRef.value.getBoundingClientRect().top;
      touchG = {
        ...touchG,
        kind: dx0 > dy0 * 1.15 ? 'pinch-x' : 'pinch-y',
        dx0,
        dy0,
        baseDays: daysCount.value,
        baseH: hourHeight.value,
        anchorHour: (scrollRef.value.scrollTop + midY) / hourHeight.value,
        midOffsetY: midY,
      };
    }
    if (touchG.kind === 'pinch-x') {
      const dx = Math.abs(a.clientX - b.clientX);
      const deltaPx = dx - touchG.dx0;
      const stepsOut = Math.round(-deltaPx / 34);
      const baseIdx = ZOOM_DAY_STEPS.indexOf(touchG.baseDays);
      const nextIdx = Math.max(0, Math.min(ZOOM_DAY_STEPS.length - 1, (baseIdx === -1 ? 0 : baseIdx) + stepsOut));
      const nextDays = ZOOM_DAY_STEPS[nextIdx];
      if (nextDays !== daysCount.value) daysCount.value = nextDays;
      showZoomBadge(`${nextDays}天`);
    } else if (touchG.kind === 'pinch-y') {
      const dy = Math.abs(a.clientY - b.clientY);
      const newH = Math.max(MIN_HOUR_H, Math.min(MAX_HOUR_H, touchG.baseH * (dy / touchG.dy0)));
      hourHeight.value = newH;
      scrollRef.value.scrollTop = Math.max(0, touchG.anchorHour * newH - touchG.midOffsetY);
      showZoomBadge(`${Math.round((newH / DEFAULT_HOUR_H) * 100)}%`);
    }
    return;
  }

  if (e.touches.length === 1 && (touchG.kind === 'pending' || touchG.kind === 'swipe')) {
    const t = e.touches[0];
    const dx = t.clientX - touchG.x0;
    const dy = t.clientY - touchG.y0;
    if (touchG.kind === 'pending') {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
        touchG = null;
        return;
      }
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        touchG.kind = 'swipe';
        swipeActive.value = true;
      }
    }
    if (touchG?.kind === 'swipe') {
      e.preventDefault();
      const colW = colsStageRef.value ? colsStageRef.value.clientWidth / daysCount.value : 180;
      const limit = Math.min(120, Math.max(64, colW * 0.42));
      swipeOffsetX.value = Math.max(-limit, Math.min(limit, dx * 0.65));
    }
  }
}

function onTimelineTouchEnd() {
  if (touchG?.kind === 'swipe' && Math.abs(swipeOffsetX.value) >= 34) {
    commitAnimatedSwipe(swipeOffsetX.value < 0 ? 1 : -1, swipeOffsetX.value);
  } else {
    swipeActive.value = false;
    swipeOffsetX.value = 0;
  }
  touchG = null;
}

const colsTransform = computed(() => {
  const shiftPct = (-100 / (daysCount.value + 2)).toFixed(4);
  const px = swipeOffsetX.value.toFixed(1);
  return {
    width: `${(((daysCount.value + 2) / daysCount.value) * 100).toFixed(4)}%`,
    transform: `translate3d(calc(${shiftPct}% + ${px}px), 0, 0)`,
  };
});

// ---------------------------------------------------------------- Split mode (mini-month + day list)

const splitCursor = ref<ISODate>(startOfMonth(ui.selected));
watch(
  () => ui.selected,
  (d) => {
    splitCursor.value = startOfMonth(d);
  },
);

const splitWeekHeaders = computed(() => {
  const ws = doc.settings.calendar.weekStart;
  return Array.from({ length: 7 }, (_, i) => ['日', '一', '二', '三', '四', '五', '六'][(ws + i) % 7]);
});

const splitWeeks = computed(() => {
  const [y, m] = parts(splitCursor.value);
  return monthWeeks(y, m, doc.settings.calendar.weekStart, 'auto');
});

const splitOccurrencesByDate = computed(() => {
  const ws = splitWeeks.value;
  const s = ws[0];
  const e = addDays(ws[ws.length - 1], 6);
  const showDone = doc.settings.tasks.showCompleted;
  const map = new Map<ISODate, Occurrence[]>();
  for (const t of shownTasks.value) {
    for (const o of occurrences(t, s, e)) {
      if (!showDone && o.done && t.id !== ui.revealTask) continue;
      for (let d = o.start < s ? s : o.start; d <= (o.end > e ? e : o.end); d = addDays(d, 1)) {
        let arr = map.get(d);
        if (!arr) {
          arr = [];
          map.set(d, arr);
        }
        arr.push(o);
      }
    }
  }
  return map;
});

const splitDays = computed(() => {
  const prefix = splitCursor.value.slice(0, 7);
  const out: { date: ISODate; dayNum: number; dim: boolean; today: boolean; selected: boolean; dots: string[] }[] = [];
  for (const w of splitWeeks.value) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(w, i);
      const list = splitOccurrencesByDate.value.get(date) ?? [];
      const dots: string[] = [];
      for (const o of list) {
        const hex = taskAccentHex(o.task);
        if (!dots.includes(hex)) dots.push(hex);
        if (dots.length >= 3) break;
      }
      out.push({
        date,
        dayNum: parts(date)[2],
        dim: date.slice(0, 7) !== prefix,
        today: date === now.value,
        selected: date === ui.selected,
        dots,
      });
    }
  }
  return out;
});

const selectedDayItems = computed(() => {
  const d = ui.selected;
  const showDone = doc.settings.tasks.showCompleted;
  const list = shownTasks.value.flatMap((t) => occurrences(t, d, d));
  const filtered = showDone ? list : list.filter((o) => !o.done || o.task.id === ui.revealTask);
  return filtered.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      Number(!a.task.time) - Number(!b.task.time) ||
      (a.task.time ?? '').localeCompare(b.task.time ?? '') ||
      a.task.order - b.task.order,
  );
});

const quickText = ref('');
async function addQuick() {
  const title = quickText.value.trim();
  if (!title || storeState.readOnly) return;
  quickText.value = '';
  await addTask({ title, start: ui.selected });
}

function toggleOccDone(o: Occurrence) {
  if (storeState.readOnly) return;
  void setOccurrenceDone(o.task, o.date, !o.done);
}

// ---------------------------------------------------------------- List mode (upcoming agenda)

const upcomingDays = computed(() =>
  agenda(shownTasks.value, now.value, addDays(now.value, 29), now.value, doc.settings.tasks.showCompleted),
);

function dayLunarSub(date: ISODate): string {
  const info = dayInfo(date);
  return info.festivals[0] ?? info.lunarLabel;
}

function timeBadgeText(o: Occurrence): string {
  if (!o.task.time) return '全天';
  const s = parseTimeMin(o.task.time);
  const dur = durationOf(o.task);
  return `${o.task.time} · ${formatDurationLabel(dur)} · 至 ${formatMinToHHMM(Math.min(DAY_MINUTES, s + dur))}`;
}

// ---------------------------------------------------------------- Floating Now/Next Pill & Switcher Tray

const todayAllOccurrences = computed(() => {
  const t = now.value;
  return shownTasks.value.flatMap((task) => occurrences(task, t, t));
});

const nowStatus = computed(() => findNowOrNext(todayAllOccurrences.value, nowMin.value));
const modeThumbIndex = computed(() => (mode.value === 'list' ? 0 : mode.value === 'split' ? 1 : 2));

function selectMode(next: CompactMode) {
  mode.value = next;
  clearTimeout(trayCloseTimer);
  trayCloseTimer = setTimeout(() => {
    trayOpen.value = false;
  }, 190);
}

function jumpNowPill() {
  goToday();
  if (mode.value !== 'timeline') mode.value = 'timeline';
  const target = nowStatus.value.occ?.task.time ? parseTimeMin(nowStatus.value.occ.task.time) : nowMin.value;
  void nextTick(() => scrollToMinute(target, true));
}

function createTitlePrompt(): void {
  openEditor({
    mode: 'new',
    start: ui.selected,
    end: ui.selected,
    ...(mode.value === 'timeline' ? { time: '09:00', duration: DEFAULT_DURATION } : {}),
  });
}

onMounted(() => {
  nowTimer = setInterval(() => {
    nowMin.value = currentMinuteOfDay();
  }, 30_000);
  void nextTick(scrollInitial);
});

watch(mode, (m) => {
  if (m === 'timeline') void nextTick(scrollInitial);
});

watch(
  () => ui.locateRevision,
  () => {
    if (mode.value !== 'timeline' || !ui.flashTask) return;
    const hit = (timelineOccurrences.value.get(ui.selected) ?? []).find((o) => o.task.id === ui.flashTask && !!o.task.time);
    if (hit) void nextTick(() => scrollToMinute(parseTimeMin(hit.task.time), true));
  },
);

onBeforeUnmount(() => {
  cleanupColDrag?.();
  cancelAnimationFrame(swipeRaf);
  if (nowTimer) clearInterval(nowTimer);
  clearTimeout(zoomBadgeTimer);
  clearTimeout(trayCloseTimer);
});
</script>

<template>
  <div class="compact-view" :class="{ dark: isDark, 'reduce-motion': reduceMotion }">
    <header class="cv-header">
      <button type="button" class="cv-month-btn" title="回到今天" @click="jumpNowPill">
        <span class="cv-month">{{ HEADER_MONTH.y }}年{{ HEADER_MONTH.m }}月</span>
        <span class="cv-week">W{{ HEADER_MONTH.week }} · 第{{ HEADER_MONTH.week }}周</span>
      </button>

      <div class="cv-actions">
        <template v-if="mode === 'timeline'">
          <button
            type="button"
            class="cv-span-btn"
            title="点击切换显示密度（紧凑/标准/宽松，或 Ctrl+滚轮/双指缩放）"
            @click="cycleDensity"
          >
            {{ densityLabel }}
          </button>
          <button
            type="button"
            class="cv-span-btn"
            title="点击切换 1/3/7 天（支持 Alt+滚轮或双指横向捏合）"
            @click="cycleSpan"
          >
            {{ daysCount }}天
          </button>
        </template>
        <button
          v-if="!storeState.readOnly"
          type="button"
          class="cv-icon-btn"
          title="新建日程"
          aria-label="新建日程"
          @click="createTitlePrompt"
        >
          <FIcon name="add" :size="15" />
        </button>
        <button
          type="button"
          class="cv-icon-btn"
          title="搜索 (Ctrl+F)"
          aria-label="搜索"
          @click="ui.searchOpen = !ui.searchOpen"
        >
          <FIcon name="search" :size="14" />
        </button>
        <button
          v-if="syncStatus.enabled"
          type="button"
          class="cv-icon-btn"
          :class="{ spinning: syncStatus.syncing, failed: !!syncStatus.error }"
          :title="`${statusLine(syncStatus)}（点击立即同步）`"
          aria-label="同步"
          @click="syncNow"
        >
          <FIcon :name="syncStatus.error ? 'warning' : 'sync'" :size="14" />
        </button>
        <button
          v-if="!isServer"
          type="button"
          class="cv-icon-btn"
          :class="{ accent: !locked }"
          :title="locked ? '解锁以移动/调整小窗' : '完成调整并锁定'"
          aria-label="调整窗口"
          @click="patchSettings({ desk: { locked: !locked } })"
        >
          <FIcon :name="locked ? 'lock' : 'unlock'" :size="14" />
        </button>
        <button
          type="button"
          class="cv-icon-btn"
          title="更多"
          aria-label="更多"
          @click="(e: MouseEvent) => moreMenu(e.currentTarget as HTMLElement)"
        >
          <FIcon name="more" :size="14" />
        </button>
      </div>
    </header>

    <!-- ================================================================ TIMELINE MODE -->
    <section v-if="mode === 'timeline'" class="cv-body timeline-mode">
      <div class="cv-daybar">
        <div class="cv-daybar-row">
          <div class="cv-gutter-stack">
            <span class="g-top">全天</span>
            <span class="g-sub">日程</span>
          </div>

          <div v-if="daysCount === 1" class="cv-single-nav">
            <button type="button" class="cv-nav-step" title="前一天" aria-label="前一天" @click="stepDay(-1)">
              <FIcon name="chevronLeft" :size="12" />
            </button>
            <button
              type="button"
              class="cv-single-pill"
              :class="{ today: ui.selected === now }"
              title="点击滚动定位"
              @click="scrollInitial"
            >
              {{ formatCompactDateLabel(ui.selected, 1, now).primary }}
            </button>
            <button type="button" class="cv-nav-step" title="后一天" aria-label="后一天" @click="stepDay(1)">
              <FIcon name="chevronRight" :size="12" />
            </button>
          </div>

          <div
            v-else
            class="cv-multi-head"
            :style="{ gridTemplateColumns: `repeat(${daysCount}, minmax(0, 1fr))` }"
          >
            <button
              v-for="d in visibleDates"
              :key="d"
              type="button"
              class="cv-day-tab"
              :class="{
                today: d === now,
                selected: d === ui.selected,
                stacked: formatCompactDateLabel(d, daysCount, now).stacked,
              }"
              @click="focusDayFromMulti(d)"
            >
              <template v-if="formatCompactDateLabel(d, daysCount, now).stacked">
                <span class="tab-wd">{{ formatCompactDateLabel(d, daysCount, now).secondary }}</span>
                <span class="tab-num">{{ formatCompactDateLabel(d, daysCount, now).primary }}</span>
              </template>
              <template v-else>
                <span class="tab-inline-pill">{{ formatCompactDateLabel(d, daysCount, now).primary }}</span>
              </template>
            </button>
          </div>
        </div>

        <div v-if="hasAnyAllDay" class="cv-allday-row">
          <span class="cv-gutter-spacer" aria-hidden="true" />
          <div
            class="cv-allday-cols"
            :style="{ gridTemplateColumns: `repeat(${daysCount}, minmax(0, 1fr))` }"
          >
            <div v-for="d in visibleDates" :key="`ad-${d}`" class="cv-allday-col">
              <button
                v-for="o in (allDayByDate.get(d) ?? []).slice(0, 2)"
                :key="occKey(o)"
                type="button"
                class="cv-allday-chip"
                :class="{ done: o.done }"
                :style="{ '--ev-bar': taskAccentHex(o.task) }"
                @click="openEditor({ mode: 'edit', taskId: o.task.id, date: o.date })"
                @contextmenu.prevent.stop="chipMenu(o, $event)"
              >
                <span class="ad-title">{{ o.task.title }}</span>
              </button>
              <span v-if="(allDayByDate.get(d)?.length ?? 0) > 2" class="cv-allday-more">
                +{{ (allDayByDate.get(d)?.length ?? 0) - 2 }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="cv-viewport">
        <Transition name="cv-badge">
          <div v-if="zoomBadge" class="cv-zoom-hud" aria-hidden="true">
            <div class="cv-zoom-badge">{{ zoomBadge }}</div>
            <div class="cv-zoom-rail">
              <span class="cv-zoom-thumb" :style="{ top: `${(zoomRatio * 74).toFixed(1)}%` }" />
            </div>
          </div>
        </Transition>

        <div
          ref="scrollRef"
          class="cv-scroll"
          @scroll="onTimelineScroll"
          @wheel="onTimelineWheel"
          @touchstart="onTimelineTouchStart"
          @touchmove="onTimelineTouchMove"
          @touchend="onTimelineTouchEnd"
          @touchcancel="onTimelineTouchEnd"
        >
          <div class="cv-canvas">
            <div class="cv-axis" :style="{ height: `${timelineHeight}px` }" aria-hidden="true">
              <div
                v-for="h in HOURS"
                :key="`ah-${h}`"
                class="cv-hour"
                :class="{ hidden: isHourHidden(h) }"
                :style="{ top: `${h * hourHeight}px` }"
              >
                {{ String(h).padStart(2, '0') }}:00
              </div>

              <div
                v-if="visibleDates.includes(now)"
                class="cv-now-pill-axis"
                :style="{ top: `${(nowMin / 60) * hourHeight}px` }"
              >
                {{ formatMinToHHMM(nowMin) }}
              </div>
            </div>

            <div ref="colsStageRef" class="cv-cols-stage" :style="{ height: `${timelineHeight}px` }">
              <div
                class="cv-cols"
                :class="{ swiping: swipeActive }"
                :style="{
                  ...colsTransform,
                  height: `${timelineHeight}px`,
                  gridTemplateColumns: `repeat(${daysCount + 2}, minmax(0, 1fr))`,
                }"
              >
                <div v-for="h in HOURS" :key="`gl-${h}`" class="cv-hline" :style="{ top: `${h * hourHeight}px` }" />
                <div class="cv-hline" :style="{ top: `${timelineHeight}px` }" />

                <div
                  v-for="(d, idx) in bufferedDates"
                  :key="`col-${d}`"
                  class="cv-day-col"
                  :class="{ today: d === now, bordered: idx > 0 }"
                  @pointerdown="onColPointerDown(d, $event)"
                  @dblclick="onColumnDblClick(d, $event)"
                >
                  <div
                    v-if="d === now"
                    class="cv-now-line"
                    :style="{ top: `${(nowMin / 60) * hourHeight}px` }"
                    aria-hidden="true"
                  />

                  <div
                    v-for="b in blocksByDate.get(d) ?? []"
                    :key="b.id"
                    class="cv-block"
                    :class="[
                      b.kind,
                      {
                        done: b.kind === 'single' && b.item.done,
                        dense: daysCount >= 4 || hourHeight < 42,
                      },
                    ]"
                    :style="blockStyle(b)"
                    @click="onBlockClick(d, b)"
                    @contextmenu.prevent.stop="onBlockMenu(b, $event)"
                  >
                    <template v-if="b.kind === 'cluster'">
                      <div class="blk-top">
                        <span class="blk-title-wrap">
                          <span class="blk-title">{{ b.count }} 项日程</span>
                          <span class="cluster-pips" aria-hidden="true">
                            <i v-for="(c, ci) in clusterColors(b.items, 3)" :key="ci" :style="{ background: c }" />
                          </span>
                        </span>
                        <span v-if="showBlockDuration(b)" class="blk-dur">
                          {{ formatDurationLabel(b.endMin - b.startMin) }}
                        </span>
                      </div>
                      <div v-if="showBlockTimeRange(b)" class="blk-time">
                        {{ formatRangeLabel(b.startMin, b.endMin) }}
                      </div>
                    </template>
                    <template v-else>
                      <div class="blk-top">
                        <span class="blk-title" :class="titleClampClass(b)">{{ b.item.title }}</span>
                        <span v-if="showBlockDuration(b)" class="blk-dur">
                          {{ formatDurationLabel(b.endMin - b.startMin) }}
                        </span>
                      </div>
                      <div v-if="showBlockTimeRange(b)" class="blk-time">
                        {{ formatRangeLabel(b.startMin, b.endMin) }}
                      </div>
                    </template>
                  </div>

                  <div
                    v-if="draftCreate && draftCreate.date === d"
                    class="cv-block single draft"
                    :style="{
                      top: `${((draftCreate.startMin / 60) * hourHeight + 1.5).toFixed(1)}px`,
                      height: `${Math.max(20, ((draftCreate.endMin - draftCreate.startMin) / 60) * hourHeight - 3).toFixed(1)}px`,
                      left: 'calc(0% + 1px)',
                      width: 'calc(100% - 2px)',
                      '--ev-bar': '#ee632c',
                    }"
                  >
                    <div class="blk-top">
                      <span class="blk-title">新建事项</span>
                      <span class="blk-dur">{{ formatDurationLabel(draftCreate.endMin - draftCreate.startMin) }}</span>
                    </div>
                    <div v-if="((draftCreate.endMin - draftCreate.startMin) / 60) * hourHeight >= 40" class="blk-time">
                      {{ formatRangeLabel(draftCreate.startMin, draftCreate.endMin) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ================================================================ SPLIT MODE -->
    <section v-else-if="mode === 'split'" class="cv-body split-mode">
      <div class="sp-month-card">
        <div class="sp-toolbar">
          <div class="sp-nav">
            <button type="button" class="cv-nav-step" title="上个月" @click="splitCursor = addMonths(splitCursor, -1)">
              <FIcon name="chevronLeft" :size="12" />
            </button>
            <button type="button" class="sp-today-btn" @click="goToday">今天</button>
            <button type="button" class="cv-nav-step" title="下个月" @click="splitCursor = addMonths(splitCursor, 1)">
              <FIcon name="chevronRight" :size="12" />
            </button>
          </div>
          <span class="sp-selected-label">{{ formatFriendly(ui.selected, now) }}</span>
        </div>

        <div class="sp-wds" aria-hidden="true">
          <span v-for="(w, i) in splitWeekHeaders" :key="i">{{ w }}</span>
        </div>

        <div class="sp-grid">
          <button
            v-for="d in splitDays"
            :key="d.date"
            type="button"
            class="sp-cell"
            :class="{ dim: d.dim, today: d.today, selected: d.selected }"
            @click="ui.selected = d.date; ui.cursor = startOfMonth(d.date)"
          >
            <span class="sp-num">{{ d.dayNum }}</span>
            <span v-if="d.dots.length" class="sp-dots" aria-hidden="true">
              <i v-for="(hex, idx) in d.dots" :key="idx" :style="{ background: hex }" />
            </span>
          </button>
        </div>
      </div>

      <div class="sp-agenda-wrap">
        <div class="sp-list">
          <div
            v-for="item in selectedDayItems"
            :key="occKey(item)"
            class="sp-item"
            :class="{ done: item.done }"
            :style="{ '--ev-bar': taskAccentHex(item.task) }"
            @click="openEditor({ mode: 'edit', taskId: item.task.id, date: item.date })"
            @contextmenu.prevent.stop="chipMenu(item, $event)"
          >
            <button
              type="button"
              class="sp-check"
              :class="{ checked: item.done }"
              :title="item.done ? '标记为未完成' : '标记为完成'"
              @click.stop="toggleOccDone(item)"
            >
              <FIcon v-if="item.done" name="checkMark" :size="9" />
            </button>
            <div class="sp-item-main">
              <div class="sp-item-title">{{ item.task.title }}</div>
              <div class="sp-item-meta">{{ timeBadgeText(item) }}</div>
            </div>
            <FIcon v-if="item.task.repeat" name="repeat" :size="11" class="sp-rep" />
          </div>

          <p v-if="!selectedDayItems.length" class="sp-empty">这一天暂无安排</p>
        </div>

        <div v-if="!storeState.readOnly" class="sp-quickadd">
          <input
            v-model="quickText"
            type="text"
            placeholder="添加当日事项，回车保存"
            maxlength="200"
            @keydown.enter.prevent="addQuick"
          />
          <button type="button" :disabled="!quickText.trim()" title="添加" @click="addQuick">
            <FIcon name="add" :size="13" />
          </button>
        </div>
      </div>
    </section>

    <!-- ================================================================ LIST MODE -->
    <section v-else class="cv-body list-mode">
      <div class="lv-scroll">
        <div v-for="d in upcomingDays" :key="d.date" class="lv-day">
          <div class="lv-day-head">
            <span class="lv-day-pill" :class="{ today: d.date === now }">{{ listDayHeading(d.date, now) }}</span>
            <span class="lv-day-sub">{{ dayLunarSub(d.date) }}</span>
          </div>
          <div v-if="d.items.length" class="lv-items">
            <div
              v-for="o in d.items"
              :key="occKey(o)"
              class="sp-item"
              :class="{ done: o.done }"
              :style="{ '--ev-bar': taskAccentHex(o.task) }"
              @click="openEditor({ mode: 'edit', taskId: o.task.id, date: o.date })"
              @contextmenu.prevent.stop="chipMenu(o, $event)"
            >
              <button
                type="button"
                class="sp-check"
                :class="{ checked: o.done }"
                :title="o.done ? '标记为未完成' : '标记为完成'"
                @click.stop="toggleOccDone(o)"
              >
                <FIcon v-if="o.done" name="checkMark" :size="9" />
              </button>
              <div class="sp-item-main">
                <div class="sp-item-title">{{ o.task.title }}</div>
                <div class="sp-item-meta">{{ timeBadgeText(o) }}</div>
              </div>
              <FIcon v-if="o.task.repeat" name="repeat" :size="11" class="sp-rep" />
            </div>
          </div>
          <p v-else class="lv-empty">暂无安排</p>
        </div>
      </div>
    </section>

    <!-- ================================================================ FLOATING CALICO DOCK -->
    <div class="cv-dock">
      <Transition name="cv-tray">
        <div v-if="trayOpen" class="cv-switcher" role="tablist" aria-label="切换视图模式">
          <div class="cv-seg-thumb" :style="{ transform: `translateX(${modeThumbIndex * 100}%)` }" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            class="cv-seg-btn"
            :class="{ active: mode === 'list' }"
            :aria-selected="mode === 'list'"
            @click="selectMode('list')"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M5.5 4h7M5.5 8h7M5.5 12h7" />
              <circle cx="2.7" cy="4" r="0.8" fill="currentColor" stroke="none" />
              <circle cx="2.7" cy="8" r="0.8" fill="currentColor" stroke="none" />
              <circle cx="2.7" cy="12" r="0.8" fill="currentColor" stroke="none" />
            </svg>
            <span>列表</span>
          </button>
          <button
            type="button"
            role="tab"
            class="cv-seg-btn"
            :class="{ active: mode === 'split' }"
            :aria-selected="mode === 'split'"
            @click="selectMode('split')"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round">
              <rect x="2.2" y="2.4" width="11.6" height="11.2" rx="2.2" />
              <path d="M2.2 7.8h11.6" />
            </svg>
            <span>分屏</span>
          </button>
          <button
            type="button"
            role="tab"
            class="cv-seg-btn"
            :class="{ active: mode === 'timeline' }"
            :aria-selected="mode === 'timeline'"
            @click="selectMode('timeline')"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round">
              <rect x="2.5" y="2.8" width="6.5" height="3.2" rx="1" />
              <rect x="7" y="7.8" width="6.5" height="3.2" rx="1" />
              <path d="M4.5 13.4h7" />
            </svg>
            <span>时间轴</span>
          </button>
        </div>
      </Transition>

      <div class="cv-now-pill">
        <button type="button" class="cv-now-main" title="点击定位今日当前时段" @click="jumpNowPill">
          <span class="now-pulse-dot" :class="nowStatus.state" aria-hidden="true" />
          <span class="now-copy">
            <strong>{{ nowStatus.prefix }}</strong>
            <template v-if="nowStatus.title">：{{ nowStatus.title }}</template>
          </span>
          <span v-if="nowStatus.timeHint" class="now-hint">{{ nowStatus.timeHint }}</span>
        </button>
        <span class="now-sep" aria-hidden="true" />
        <button
          type="button"
          class="cv-tray-toggle"
          :class="{ open: trayOpen }"
          :aria-expanded="trayOpen"
          title="切换紧凑视图模式"
          aria-label="切换紧凑视图模式"
          @click="trayOpen = !trayOpen"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path v-if="!trayOpen" d="M3 5.2h10M3 8h10M3 10.8h10" />
            <path v-else d="m4.5 6.5 3.5 3.5 3.5-3.5" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compact-view {
  --cv-bg: var(--desk-bg, #faf8f3);
  --cv-surface: #fffdf9;
  --cv-cream: #faf8f3;
  --cv-ink: var(--calendar-text, #1d1b1a);
  --cv-muted: rgba(43, 40, 37, 0.48);
  --cv-line: rgba(43, 40, 37, 0.065);
  --cv-col-sep: rgba(43, 40, 37, 0.055);
  --cv-pill-soft: rgba(43, 40, 37, 0.065);
  --cv-pill-hover: rgba(43, 40, 37, 0.11);
  --cv-coral: #ee632c;
  --cv-now-red: #e8453c;
  --cv-cluster-bg: #ececf0;
  --cv-cluster-bar: #8d8e98;
  --cv-cluster-border: rgba(43, 40, 37, 0.08);
  --cv-dock-bg: rgba(255, 253, 249, 0.88);
  --cv-dock-border: rgba(43, 40, 37, 0.09);
  --cv-dock-thumb: rgba(43, 40, 37, 0.075);

  --cv-spring: cubic-bezier(0.22, 1, 0.36, 1);

  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: var(--cv-bg);
  color: var(--cv-ink);
  --text-glow: none;
  text-shadow: none;
  user-select: none;
}

@supports (animation-timing-function: linear(0, 1)) {
  .compact-view {
    --cv-spring: linear(0.0000, 0.0979, 0.2953, 0.5065, 0.6904, 0.8313, 0.9277, 0.9862, 1.0165, 1.0273, 1.0265, 1.0202, 1.0128, 1.0067, 1.0026, 1.0004, 1.0000);
  }
}

.compact-view.dark {
  --cv-bg: var(--desk-bg, #201f1d);
  --cv-surface: #272522;
  --cv-cream: #22211f;
  --cv-ink: var(--calendar-text, #f4f1ea);
  --cv-muted: rgba(255, 250, 240, 0.52);
  --cv-line: rgba(255, 250, 240, 0.08);
  --cv-col-sep: rgba(255, 250, 240, 0.06);
  --cv-pill-soft: rgba(255, 250, 240, 0.085);
  --cv-pill-hover: rgba(255, 250, 240, 0.14);
  --cv-cluster-bg: rgba(255, 250, 240, 0.12);
  --cv-cluster-bar: rgba(255, 250, 240, 0.46);
  --cv-cluster-border: rgba(255, 250, 240, 0.12);
  --cv-dock-bg: rgba(38, 36, 33, 0.88);
  --cv-dock-border: rgba(255, 250, 240, 0.11);
  --cv-dock-thumb: rgba(255, 250, 240, 0.13);
}

/* ---------------------------------------------------------------- Header */

.cv-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 6px 14px;
}

.cv-month-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border: 0;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.cv-month-btn:hover {
  background: var(--cv-pill-soft);
}

.cv-month {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.cv-week {
  font-size: 10.5px;
  color: var(--cv-muted);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

.cv-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: none;
}

.cv-span-btn {
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--cv-line);
  background: var(--cv-pill-soft);
  color: var(--cv-ink);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color 140ms ease;
}
.cv-span-btn:hover {
  background: var(--cv-pill-hover);
}

.cv-icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--cv-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.85;
  transition: background-color 140ms ease, opacity 140ms ease;
}
.cv-icon-btn:hover {
  background: var(--cv-pill-soft);
  opacity: 1;
}
.cv-icon-btn.accent {
  color: var(--cv-coral);
  opacity: 1;
}
.cv-icon-btn.failed {
  color: #d97706;
}
.cv-icon-btn.spinning :deep(.f-icon) {
  animation: cv-spin 1s linear infinite;
}
@keyframes cv-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------------------------------------------------------------- Body Container */

.cv-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ---------------------------------------------------------------- Timeline Daybar */

.cv-daybar {
  flex: none;
  border-bottom: 1px solid var(--cv-line);
  padding: 4px 10px 6px 0;
}

.cv-daybar-row,
.cv-allday-row {
  display: flex;
  align-items: center;
}

.cv-allday-row {
  margin-top: 4px;
  align-items: flex-start;
}

.cv-gutter-stack {
  width: 44px;
  flex: none;
  padding-right: 7px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.05;
  color: var(--cv-muted);
}
.cv-gutter-stack .g-top {
  font-size: 9px;
}
.cv-gutter-stack .g-sub {
  font-size: 8.5px;
  opacity: 0.72;
}

.cv-gutter-spacer {
  width: 44px;
  flex: none;
}

.cv-single-nav {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.cv-nav-step {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--cv-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.cv-nav-step:hover {
  background: var(--cv-pill-soft);
  color: var(--cv-ink);
}

.cv-single-pill {
  height: 25px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid rgba(43, 40, 37, 0.13);
  background: var(--cv-surface);
  color: var(--cv-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
}
.compact-view.dark .cv-single-pill {
  border-color: rgba(255, 250, 240, 0.16);
}
.cv-single-pill.today {
  background: var(--cv-coral);
  border-color: var(--cv-coral);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(238, 99, 44, 0.28);
}

.cv-multi-head {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}

.cv-day-tab {
  border: 0;
  padding: 2px;
  border-radius: 8px;
  background: transparent;
  color: var(--cv-ink);
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}
.cv-day-tab:hover {
  background: var(--cv-pill-soft);
}
.tab-wd {
  font-size: 9.5px;
  color: var(--cv-muted);
  line-height: 1;
}
.tab-num {
  width: 24px;
  height: 21px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tab-inline-pill {
  width: 100%;
  height: 23px;
  border-radius: 8px;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--cv-pill-soft);
  padding: 0 4px;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv-day-tab.today .tab-inline-pill {
  background: var(--cv-coral);
  color: #ffffff;
}
.cv-day-tab.selected:not(.today) .tab-num {
  background: var(--cv-pill-soft);
}
.cv-day-tab.today .tab-num {
  background: var(--cv-coral);
  color: #ffffff;
}

.cv-allday-cols {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}

.cv-allday-col {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.cv-allday-chip {
  height: 19px;
  max-width: 100%;
  padding: 0 6px 0 8px;
  border: 0;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ev-bar) 15%, var(--cv-surface));
  position: relative;
  color: color-mix(in srgb, var(--ev-bar) 78%, #151412);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.cv-allday-chip::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  bottom: 2px;
  width: 2.5px;
  border-radius: 999px;
  background: var(--ev-bar);
}
.compact-view.dark .cv-allday-chip {
  background: color-mix(in srgb, var(--ev-bar) 24%, var(--cv-surface));
  color: color-mix(in srgb, var(--ev-bar) 24%, #ffffff);
}
.cv-allday-chip.done {
  opacity: 0.5;
  text-decoration: line-through;
}
.ad-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv-allday-more {
  font-size: 10px;
  color: var(--cv-muted);
  align-self: center;
}

/* ---------------------------------------------------------------- Timeline Canvas */

.cv-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.cv-zoom-hud {
  position: absolute;
  top: 10px;
  right: 8px;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
}

.cv-zoom-badge {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--cv-dock-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--cv-dock-border);
  box-shadow: 0 4px 12px rgba(20, 18, 16, 0.12);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--cv-ink);
}

.cv-zoom-rail {
  width: 3px;
  height: 76px;
  border-radius: 999px;
  background: var(--cv-pill-soft);
  position: relative;
  overflow: hidden;
}

.cv-zoom-thumb {
  position: absolute;
  left: 0;
  right: 0;
  height: 20px;
  border-radius: 999px;
  background: var(--cv-coral);
  transition: top 120ms ease;
}

.cv-badge-enter-active,
.cv-badge-leave-active {
  transition: opacity 160ms ease, transform 220ms var(--cv-spring);
}
.cv-badge-enter-from,
.cv-badge-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.9);
}

.cv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  touch-action: pan-y;
}

.cv-canvas {
  display: flex;
  align-items: flex-start;
  padding: 12px 10px 76px 0;
  position: relative;
}

.cv-axis {
  width: 44px;
  flex: none;
  position: relative;
}

.cv-hour {
  position: absolute;
  left: 0;
  right: 0;
  padding-right: 7px;
  transform: translateY(-50%);
  text-align: right;
  font-size: 9.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--cv-muted);
  pointer-events: none;
  transition: opacity 130ms ease;
}
.cv-hour.hidden {
  opacity: 0;
}

.cv-now-pill-axis {
  position: absolute;
  right: 4px;
  transform: translateY(-50%);
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--cv-now-red);
  color: #ffffff;
  font-size: 9.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 14;
  pointer-events: none;
}

.cv-cols-stage {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.cv-cols {
  position: relative;
  display: grid;
  transition: transform 220ms var(--cv-spring);
}
.cv-cols.swiping {
  transition: none;
}

.cv-hline {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--cv-line);
  pointer-events: none;
}

.cv-day-col {
  position: relative;
  min-width: 0;
  height: 100%;
}
.cv-day-col.bordered {
  border-left: 1px solid var(--cv-col-sep);
}

.cv-now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--cv-now-red);
  z-index: 12;
  pointer-events: none;
}

.cv-block {
  position: absolute;
  box-sizing: border-box;
  border-radius: 9px;
  padding: 4px 7px 4px 10px;
  overflow: hidden;
  cursor: pointer;
  z-index: 8;
  transition:
    top 240ms var(--cv-spring),
    height 240ms var(--cv-spring),
    left 260ms var(--cv-spring),
    width 260ms var(--cv-spring),
    opacity 150ms ease;
}

.cv-block::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 999px;
}

.cv-block.single {
  background: color-mix(in srgb, var(--ev-bar) 15%, var(--cv-surface));
  color: color-mix(in srgb, var(--ev-bar) 78%, #151412);
}
.cv-block.single::before {
  background: var(--ev-bar);
}
.compact-view.dark .cv-block.single {
  background: color-mix(in srgb, var(--ev-bar) 24%, var(--cv-surface));
  color: color-mix(in srgb, var(--ev-bar) 24%, #ffffff);
}

.cv-block.single.draft {
  pointer-events: none;
  box-shadow: 0 8px 20px rgba(238, 99, 44, 0.22);
  z-index: 20;
  transition:
    top 80ms cubic-bezier(0.2, 0, 0, 1),
    height 80ms cubic-bezier(0.2, 0, 0, 1);
}

.cv-block.cluster {
  background: var(--cv-cluster-bg);
  border: 1px solid var(--cv-cluster-border);
  box-shadow:
    0 2px 0 -1px rgba(43, 40, 37, 0.08),
    0 4px 0 -2px rgba(43, 40, 37, 0.04);
  color: var(--cv-ink);
}
.cv-block.cluster::before {
  background: var(--cv-cluster-bar);
}
.cv-block.cluster:hover {
  filter: brightness(0.97);
}

.cv-block.done {
  opacity: 0.52;
}
.cv-block.done .blk-title {
  text-decoration: line-through;
}

.cv-block.dense {
  padding: 2px 5px 2px 8px;
  border-radius: 7px;
}

.blk-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.blk-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.cluster-pips {
  display: inline-flex;
  align-items: center;
  gap: 2.5px;
  flex: none;
}
.cluster-pips i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  display: block;
}

.blk-title {
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.blk-title.clamp-1 {
  white-space: nowrap;
}
.blk-title.clamp-2,
.blk-title.clamp-3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  white-space: normal;
  word-break: break-word;
}
.blk-title.clamp-2 {
  -webkit-line-clamp: 2;
}
.blk-title.clamp-3 {
  -webkit-line-clamp: 3;
}

.cv-block.dense .blk-title {
  font-size: 10px;
}

.blk-dur {
  flex: none;
  font-size: 9.5px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  opacity: 0.68;
}
.cv-block.single .blk-dur,
.cv-block.single .blk-time {
  color: color-mix(in srgb, var(--ev-bar) 65%, var(--cv-muted));
}
.compact-view.dark .cv-block.single .blk-dur,
.compact-view.dark .cv-block.single .blk-time {
  color: color-mix(in srgb, var(--ev-bar) 18%, rgba(255, 250, 240, 0.7));
}

.blk-time {
  margin-top: 1px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--cv-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------------------------------------------------------------- Split Mode */

.split-mode {
  padding: 2px 12px 0;
  gap: 8px;
}

.sp-month-card {
  flex: none;
  border-radius: 14px;
  padding: 8px 10px 9px;
  background: var(--cv-surface);
  border: 1px solid var(--cv-line);
}

.sp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.sp-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sp-today-btn {
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--cv-line);
  background: var(--cv-cream);
  color: var(--cv-ink);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.sp-selected-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--cv-coral);
}

.sp-wds {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  text-align: center;
  font-size: 10px;
  color: var(--cv-muted);
  margin-bottom: 4px;
}

.sp-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}

.sp-cell {
  height: 34px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--cv-ink);
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}
.sp-cell:hover {
  background: var(--cv-pill-soft);
}
.sp-cell.dim {
  opacity: 0.42;
}
.sp-cell.today:not(.selected) .sp-num {
  color: var(--cv-coral);
  font-weight: 700;
}
.sp-cell.selected {
  background: color-mix(in srgb, var(--cv-coral) 16%, transparent);
  border-color: color-mix(in srgb, var(--cv-coral) 45%, transparent);
  color: var(--cv-coral);
  font-weight: 600;
}
.sp-num {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.sp-dots {
  display: flex;
  gap: 2px;
}
.sp-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  display: block;
}

.sp-agenda-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 0 8px;
}

.sp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--cv-surface);
  border: 1px solid var(--cv-line);
  border-left: 3.5px solid var(--ev-bar);
  cursor: pointer;
}
.sp-item:hover {
  filter: brightness(0.985);
}
.sp-item.done {
  opacity: 0.55;
}
.sp-item.done .sp-item-title {
  text-decoration: line-through;
}

.sp-check {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--cv-muted);
  background: transparent;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  cursor: pointer;
  padding: 0;
}
.sp-check.checked {
  border-color: var(--cv-coral);
  background: var(--cv-coral);
}

.sp-item-main {
  flex: 1;
  min-width: 0;
}
.sp-item-title {
  font-size: 12.5px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-item-meta {
  font-size: 10.5px;
  color: var(--cv-muted);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}
.sp-rep {
  color: var(--cv-muted);
  flex: none;
}
.sp-empty {
  margin: auto 0;
  text-align: center;
  font-size: 12px;
  color: var(--cv-muted);
}

.sp-quickadd {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px 5px 10px;
  margin-bottom: calc(60px + env(safe-area-inset-bottom, 0px));
  border-radius: 10px;
  background: var(--cv-surface);
  border: 1px solid var(--cv-line);
}
.sp-quickadd input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--cv-ink);
  font: inherit;
  font-size: 12px;
}
.sp-quickadd button {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 0;
  background: var(--cv-pill-soft);
  color: var(--cv-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.sp-quickadd button:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ---------------------------------------------------------------- List Mode */

.lv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 12px calc(76px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lv-day {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lv-day-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.lv-day-pill {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--cv-ink);
}
.lv-day-pill.today {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--cv-coral);
  color: #ffffff;
  font-size: 11.5px;
}
.lv-day-sub {
  font-size: 11px;
  color: var(--cv-muted);
}
.lv-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lv-empty {
  margin: 0;
  padding-left: 4px;
  font-size: 11.5px;
  color: var(--cv-muted);
}

/* ---------------------------------------------------------------- Floating Calico Bottom Dock */

.cv-dock {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: max(10px, env(safe-area-inset-bottom, 0px));
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.cv-switcher {
  pointer-events: auto;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(296px, 100%);
  padding: 4px;
  border-radius: 999px;
  background: var(--cv-dock-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--cv-dock-border);
  box-shadow: 0 10px 28px rgba(20, 18, 16, 0.14);
  box-sizing: border-box;
}

.cv-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / 3);
  border-radius: 999px;
  background: var(--cv-dock-thumb);
  transition: transform 280ms var(--cv-spring);
  pointer-events: none;
}

.cv-seg-btn {
  position: relative;
  z-index: 1;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--cv-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  transition: color 150ms ease;
}
.cv-seg-btn.active {
  color: var(--cv-ink);
  font-weight: 600;
}

.cv-tray-enter-active,
.cv-tray-leave-active {
  transition: opacity 160ms ease, transform 240ms var(--cv-spring);
}
.cv-tray-enter-from,
.cv-tray-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.95);
}

.cv-now-pill {
  pointer-events: auto;
  height: 38px;
  max-width: min(320px, 100%);
  min-width: 210px;
  padding: 0 5px 0 12px;
  border-radius: 999px;
  background: var(--cv-dock-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--cv-dock-border);
  box-shadow: 0 8px 24px rgba(20, 18, 16, 0.14);
  display: flex;
  align-items: center;
  gap: 6px;
}

.cv-now-main {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--cv-ink);
  font: inherit;
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.now-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--cv-muted);
}
.now-pulse-dot.now {
  background: var(--cv-coral);
  box-shadow: 0 0 0 3px rgba(238, 99, 44, 0.22);
}
.now-pulse-dot.next {
  background: #2f9e44;
}
.now-pulse-dot.allday {
  background: #3b82f6;
}

.now-copy {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.now-copy strong {
  font-weight: 600;
}

.now-hint {
  flex: none;
  font-size: 10.5px;
  color: var(--cv-muted);
  font-variant-numeric: tabular-nums;
}

.now-sep {
  width: 1px;
  height: 16px;
  background: var(--cv-line);
  flex: none;
}

.cv-tray-toggle {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 0;
  background: var(--cv-pill-soft);
  color: var(--cv-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
  transition: background-color 140ms ease;
}
.cv-tray-toggle:hover,
.cv-tray-toggle.open {
  background: var(--cv-pill-hover);
}

.compact-view.reduce-motion *,
.compact-view.reduce-motion .cv-block,
.compact-view.reduce-motion .cv-seg-thumb {
  transition: none !important;
  animation: none !important;
}
</style>
