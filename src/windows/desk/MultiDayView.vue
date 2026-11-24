<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { ISODate, Task } from '@/types';
import {
  addDays,
  diffDays,
  formatMD,
  isoWeek,
  parts,
  startOfMonth,
  weekday,
  WEEKDAY_SHORT,
} from '@/lib/date';
import { displayInfo as dayInfo } from '@/lib/lunar';
import {
  clampMinutes,
  computeCreateRange,
  DAY_MINUTES,
  DEFAULT_DURATION,
  floorMinutes,
  formatDurationLabel,
  formatMinToHHMM,
  formatRangeLabel,
  layoutDayEvents,
  MIN_DURATION,
  parseTimeMin,
  snapMinutes,
  type DayLayoutItem,
} from '@/lib/dayLayout';
import {
  clusterColors,
  clusterDayEvents,
  DEFAULT_HOUR_H,
  findNowOrNext,
  MAX_HOUR_H,
  MIN_HOUR_H,
  stepDesktopMultiDays,
  visibleDatesForSpan,
  DESKTOP_MULTIDAY_STEPS,
  type CompactEventInput,
  type DesktopMultiDays,
} from '@/lib/compactTimeline';
import { occurrences, type Occurrence } from '@/lib/recur';
import { saveTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, patchSettings, storeState } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { effectiveMultiDaySpan, useViewport } from '@/composables/useViewport';
import { chipMenu, removeTask } from './menus';
import { clusterSpotlightStateOf, goToday, openEditor, page, setPendingDraft, shownTasks, spotlightStateOf, ui, updatePendingDraftFromTimeline } from './state';
import type { SpotlightVisualState } from '@/lib/filter';
import { dropTaskToDate, getDraggedTaskId, hasTaskDragPayload, workspaceDrag } from '../workspace/workspaceDrag';

const DAYS_KEY = 'fluentcal.multiday.days';
const HOUR_H_KEY = 'fluentcal.multiday.hourH';

function readNum(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStr(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

const initialDays = readNum(DAYS_KEY);
const daysCount = ref<DesktopMultiDays>(
  DESKTOP_MULTIDAY_STEPS.includes(initialDays as DesktopMultiDays) ? (initialDays as DesktopMultiDays) : 5,
);
const phoneDays = ref<2 | 3>(3);
const { width: vpWidth, isPhone } = useViewport();
const effectiveDays = computed(() => effectiveMultiDaySpan(daysCount.value, vpWidth.value, phoneDays.value));
const initialH = readNum(HOUR_H_KEY);
const hourHeight = ref<number>(
  initialH !== null ? Math.max(MIN_HOUR_H, Math.min(MAX_HOUR_H, initialH)) : DEFAULT_HOUR_H,
);

watch(daysCount, (v) => writeStr(DAYS_KEY, String(v)));
watch(
  effectiveDays,
  (v) => {
    ui.multidaySpan = v;
  },
  { immediate: true },
);
watch(hourHeight, (v) => writeStr(HOUR_H_KEY, String(Math.round(v))));

const scrollRef = ref<HTMLElement>();
const colsGridRef = ref<HTMLElement>();
const selectedKey = ref('');
const pinnedRightId = ref('');

const zoomBadge = ref('');
let zoomBadgeTimer: ReturnType<typeof setTimeout> | undefined;
function showZoomBadge(text: string) {
  zoomBadge.value = text;
  clearTimeout(zoomBadgeTimer);
  zoomBadgeTimer = setTimeout(() => {
    zoomBadge.value = '';
  }, 1150);
}

const reduceMotion = computed(() => doc.settings.theme.reduceMotion);

function currentMinuteOfDay(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
const nowMin = ref(currentMinuteOfDay());
let nowTimer: ReturnType<typeof setInterval> | undefined;

function occKey(occ: Occurrence): string {
  return `${occ.task.id}@${occ.date}`;
}

function durationOf(task: Task): number {
  const raw = task.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(DAY_MINUTES, Math.max(MIN_DURATION, Math.round(raw)));
  }
  return DEFAULT_DURATION;
}

function accentHexOf(task: Task): string {
  const g = task.groupId ? doc.groups[task.groupId]?.color : undefined;
  return taskColor(task.color || g, isDark.value).bar;
}

// ---------------------------------------------------------------- Visible Date Range

const visibleDates = computed<ISODate[]>(() =>
  visibleDatesForSpan(ui.selected, effectiveDays.value, doc.settings.calendar.weekStart),
);

const rangeSummary = computed(() => {
  const dates = visibleDates.value;
  const s = dates[0];
  const e = dates[dates.length - 1];
  const [sy] = parts(s);
  const [ey] = parts(e);
  const curYear = parts(now.value)[0];
  const left = sy !== curYear ? `${sy}年${formatMD(s)}` : formatMD(s);
  const right = ey !== sy ? `${ey}年${formatMD(e)}` : formatMD(e);
  return `${left} – ${right} · 第${isoWeek(s)}周`;
});

const visibleOccurrences = computed(() => {
  const dates = visibleDates.value;
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
    map.set(
      d,
      (visibleOccurrences.value.get(d) ?? [])
        .filter((o) => !o.task.time)
        .sort((a, b) => Number(a.done) - Number(b.done) || a.task.order - b.task.order),
    );
  }
  return map;
});

const hasAnyAllDay = computed(() => visibleDates.value.some((d) => (allDayByDate.value.get(d)?.length ?? 0) > 0));

function headerMeta(d: ISODate): { wd: string; num: number; tag: string; isRest: boolean } {
  const [, , dayNum] = parts(d);
  const wdIdx = weekday(d);
  const info = dayInfo(d);
  let tag = '';
  if (doc.settings.calendar.showHolidays && info.legal) {
    tag = info.legal.work ? '班' : '休';
  } else if (doc.settings.calendar.showLunar) {
    tag = info.festivals[0] ?? info.text;
  }
  const isRest = doc.settings.calendar.showHolidays && info.legal ? !info.legal.work : doc.settings.calendar.restDays.includes(wdIdx);
  return { wd: WEEKDAY_SHORT[wdIdx], num: dayNum, tag, isRest };
}

// ---------------------------------------------------------------- Active Drag State

type DragKind = 'move' | 'resize-top' | 'resize-bottom' | 'create';

interface DragState {
  kind: DragKind;
  key: string;
  origDate: ISODate;
  targetDate: ISODate;
  title: string;
  startMin: number;
  endMin: number;
  pillMin: number;
  color: string;
  occ: Occurrence | null;
}

const drag = ref<DragState | null>(null);
let cleanupActiveDrag: (() => void) | null = null;
let autoScrollRaf = 0;
let autoScrollDir = 0;
let onScrollRecompute: (() => void) | null = null;

function stopAutoScroll() {
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }
  autoScrollDir = 0;
}

function updateAutoScroll(clientY: number) {
  const scroller = scrollRef.value;
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  const zone = 44;
  let speed = 0;
  if (clientY < r.top + zone) speed = -Math.max(2, Math.round(((r.top + zone - clientY) / zone) * 10));
  else if (clientY > r.bottom - zone) speed = Math.max(2, Math.round(((clientY - (r.bottom - zone)) / zone) * 10));
  autoScrollDir = speed;
  if (speed !== 0 && !autoScrollRaf) {
    const step = () => {
      if (!autoScrollDir || !scrollRef.value) {
        autoScrollRaf = 0;
        return;
      }
      const prev = scrollRef.value.scrollTop;
      scrollRef.value.scrollTop += autoScrollDir;
      if (scrollRef.value.scrollTop !== prev) onScrollRecompute?.();
      autoScrollRaf = requestAnimationFrame(step);
    };
    autoScrollRaf = requestAnimationFrame(step);
  } else if (speed === 0) {
    stopAutoScroll();
  }
}

// ---------------------------------------------------------------- Per-Column Rendered Blocks (Stable DOM Order)

interface MultiDayRenderBlock {
  kind: 'single' | 'cluster';
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  col: number;
  colCount: number;
  color: string;
  colors: string[];
  count: number;
  done: boolean;
  occ: Occurrence | null;
  isDraft: boolean;
  isPendingDraft: boolean;
  isSelected: boolean;
  isMoving: boolean;
  isResizing: boolean;
  showDuration: boolean;
  spotlight: SpotlightVisualState;
}

const isClustered = computed(() => hourHeight.value < 42);

function pendingBlockColor(color?: string, groupId?: string): string {
  const k = color || (groupId ? doc.groups[groupId]?.color : undefined);
  return k ? taskColor(k, isDark.value).bar : '#ee632c';
}

const blocksByDate = computed(() => {
  const out = new Map<ISODate, MultiDayRenderBlock[]>();
  const d = drag.value;
  const h = hourHeight.value;
  const clustered = isClustered.value;
  const isDraftMoveOrResize = Boolean(
    d && d.key === '__draft__' && (d.kind === 'move' || d.kind === 'resize-top' || d.kind === 'resize-bottom'),
  );
  const pending = ui.pendingDraft && (!d || d.kind !== 'create') ? ui.pendingDraft : null;

  for (const date of visibleDates.value) {
    const occList = (visibleOccurrences.value.get(date) ?? []).filter((o) => !!o.task.time);
    const occByKey = new Map<string, Occurrence>();
    const inputs: CompactEventInput[] = [];

    for (const occ of occList) {
      const key = occKey(occ);
      // Exclude an event currently moving into a DIFFERENT day column so it doesn't duplicate.
      if (d && d.kind === 'move' && d.key === key && d.targetDate !== date) continue;

      occByKey.set(key, occ);
      const isOverride = d && d.key === key && (d.kind === 'move' || d.kind === 'resize-top' || d.kind === 'resize-bottom');
      const s = isOverride ? d.startMin : parseTimeMin(occ.task.time);
      const e = isOverride ? d.endMin : Math.min(DAY_MINUTES, s + durationOf(occ.task));
      inputs.push({
        id: key,
        title: occ.task.title,
        startMin: s,
        endMin: Math.max(s + MIN_DURATION, e),
        color: accentHexOf(occ.task),
        done: occ.done,
        order: occ.task.order,
      });
    }

    // If an event from another column is moving INTO this column, inject it here cleanly.
    const incomingMove = Boolean(d && d.kind === 'move' && d.targetDate === date && d.key !== '__draft__' && !occByKey.has(d.key));
    const hasCreateDraft = Boolean(d && d.kind === 'create' && d.targetDate === date);
    const hasPendingHere = Boolean(
      !hasCreateDraft &&
        ((isDraftMoveOrResize && d?.targetDate === date) || (!isDraftMoveOrResize && pending && pending.date === date)),
    );

    if (incomingMove && d) {
      inputs.push({
        id: d.key,
        title: d.title,
        startMin: d.startMin,
        endMin: d.endMin,
        color: d.color,
        done: d.occ?.done ?? false,
        order: 999_998,
      });
    }
    if (hasCreateDraft && d) {
      inputs.push({
        id: d.key,
        title: d.title,
        startMin: d.startMin,
        endMin: d.endMin,
        color: '#ee632c',
        done: false,
        order: 999_999,
      });
    } else if (hasPendingHere) {
      const s = isDraftMoveOrResize && d ? d.startMin : pending!.startMin;
      const e = isDraftMoveOrResize && d ? d.endMin : pending!.endMin;
      inputs.push({
        id: '__draft__',
        title: pending?.title || d?.title || '新建事项',
        startMin: s,
        endMin: Math.max(s + MIN_DURATION, e),
        color: pendingBlockColor(pending?.color, pending?.groupId),
        done: false,
        order: 999_999,
      });
    }

    if (clustered && !d && !hasPendingHere) {
      const blocks = clusterDayEvents(inputs, h, effectiveDays.value);
      out.set(
        date,
        blocks.map((b) => {
          if (b.kind === 'cluster') {
            const memberTasks = b.items
              .map((it) => occByKey.get(it.id)?.task)
              .filter((t): t is Task => !!t);
            return {
              kind: 'cluster',
              id: b.id,
              title: `${b.count} 项日程`,
              startMin: b.startMin,
              endMin: b.endMin,
              col: b.col,
              colCount: b.colCount,
              color: '#8d8e98',
              colors: clusterColors(b.items, 3),
              count: b.count,
              done: false,
              occ: null,
              isDraft: false,
              isPendingDraft: false,
              isSelected: false,
              isMoving: false,
              isResizing: false,
              showDuration: false,
              spotlight: clusterSpotlightStateOf(memberTasks),
            };
          }
          const occ = occByKey.get(b.id) ?? null;
          return {
            kind: 'single',
            id: b.id,
            title: b.item.title,
            startMin: b.startMin,
            endMin: b.endMin,
            col: b.col,
            colCount: b.colCount,
            color: b.item.color,
            colors: [b.item.color],
            count: 1,
            done: b.item.done,
            occ,
            isDraft: false,
            isPendingDraft: false,
            isSelected: selectedKey.value === b.id,
            isMoving: false,
            isResizing: false,
            showDuration: false,
            spotlight: occ ? spotlightStateOf(occ.task) : 'normal',
          };
        }),
      );
      continue;
    }

    const laid = layoutDayEvents(
      inputs.map((x) => ({ id: x.id, startMin: x.startMin, endMin: x.endMin, order: x.order })),
      pinnedRightId.value || (hasPendingHere ? '__draft__' : undefined),
    );
    const laidById = new Map<string, DayLayoutItem>(laid.map((x) => [x.id, x]));

    // Maintain stable key order so Vue never moves DOM nodes mid-drag.
    const stableKeys = [...occByKey.keys()].sort((a, b) => a.localeCompare(b));
    if (incomingMove && d) stableKeys.push(d.key);
    if (hasCreateDraft && d) stableKeys.push(d.key);
    else if (hasPendingHere) stableKeys.push('__draft__');

    const colBlocks: MultiDayRenderBlock[] = [];
    for (const id of stableKeys) {
      const l = laidById.get(id);
      if (!l) continue;
      const occ = occByKey.get(id) ?? (d?.key === id ? d.occ : null);
      const isCreate = Boolean(hasCreateDraft && d?.key === id);
      const isPendingDraft = Boolean(hasPendingHere && id === '__draft__');
      const isDraft = isCreate || isPendingDraft;
      const activeForThis = d?.key === id;
      const isMoving = Boolean(activeForThis && d?.kind === 'move');
      const isResizing = Boolean(activeForThis && (d?.kind === 'resize-top' || d?.kind === 'resize-bottom'));
      const isSelected = Boolean(isDraft || activeForThis || selectedKey.value === id);
      const showDuration = Boolean(
        isPendingDraft ||
          (activeForThis && (d?.kind === 'resize-top' || d?.kind === 'resize-bottom' || d?.kind === 'create')),
      );

      colBlocks.push({
        kind: 'single',
        id,
        title: occ
          ? occ.task.title
          : isPendingDraft
            ? pending?.title || d?.title || '新建事项'
            : d?.title || '新建事项',
        startMin: l.startMin,
        endMin: l.endMin,
        col: l.col,
        colCount: l.colCount,
        color: occ
          ? accentHexOf(occ.task)
          : isPendingDraft
            ? pendingBlockColor(pending?.color, pending?.groupId)
            : '#ee632c',
        colors: [],
        count: 1,
        done: occ ? occ.done : false,
        occ,
        isDraft,
        isPendingDraft,
        isSelected,
        isMoving,
        isResizing,
        showDuration,
        spotlight: occ && !isDraft ? spotlightStateOf(occ.task) : 'normal',
      });
    }
    out.set(date, colBlocks);
  }
  return out;
});

function blockPxHeight(b: MultiDayRenderBlock): number {
  return Math.max(20, ((b.endMin - b.startMin) / 60) * hourHeight.value - 3);
}

function blockStyle(b: MultiDayRenderBlock): Record<string, string> {
  const h = hourHeight.value;
  const topPx = (b.startMin / 60) * h + 1.5;
  const heightPx = blockPxHeight(b);
  const gap = effectiveDays.value >= 6 ? 2 : 4;
  const leftExpr =
    b.colCount <= 1 ? 'calc(0% + 2px)' : `calc(${(b.col / b.colCount) * 100}% + ${((b.col * gap) / b.colCount + 2).toFixed(2)}px)`;
  const widthExpr =
    b.colCount <= 1
      ? 'calc(100% - 4px)'
      : `calc(${100 / b.colCount}% - ${(((b.colCount - 1) * gap) / b.colCount + 4).toFixed(2)}px)`;
  return {
    top: `${topPx.toFixed(1)}px`,
    height: `${heightPx.toFixed(1)}px`,
    left: leftExpr,
    width: widthExpr,
    '--ev-bar': b.color,
  };
}

function titleClampClass(b: MultiDayRenderBlock): string {
  const px = blockPxHeight(b);
  if (px >= 54) return 'clamp-3';
  if (px >= 34) return 'clamp-2';
  return 'clamp-1';
}

function showBlockDuration(b: MultiDayRenderBlock): boolean {
  if (effectiveDays.value >= 7 && hourHeight.value < 44) return false;
  return blockPxHeight(b) >= 26 && (b.endMin - b.startMin >= 30 || b.showDuration);
}

function showBlockTime(b: MultiDayRenderBlock): boolean {
  return blockPxHeight(b) >= 40;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const timelineHeight = computed(() => Math.round(24 * hourHeight.value));

const pillState = computed(() => {
  const d = drag.value;
  if (!d) return null;
  const min = clampMinutes(d.pillMin, 0, DAY_MINUTES);
  return {
    y: (min / 60) * hourHeight.value,
    label: formatMinToHHMM(min),
  };
});

function isHourOccluded(h: number): boolean {
  if (hourHeight.value < 34 && h % 2 === 1) return true;
  const y = h * hourHeight.value;
  if (pillState.value && Math.abs(y - pillState.value.y) < 20) return true;
  if (visibleDates.value.includes(now.value)) {
    const nowY = (nowMin.value / 60) * hourHeight.value;
    if (Math.abs(y - nowY) < 16) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Coordinate & Pointer Helpers

function canEdit(): boolean {
  return !storeState.readOnly && doc.settings.desk.locked;
}

function minFromGrid(clientY: number): number {
  const rect = colsGridRef.value?.getBoundingClientRect();
  if (!rect) return 9 * 60;
  return ((clientY - rect.top) / hourHeight.value) * 60;
}

function dateAtClientX(clientX: number, fallback: ISODate): ISODate {
  const grid = colsGridRef.value;
  if (!grid) return fallback;
  const cols = grid.querySelectorAll<HTMLElement>('.md-day-col[data-date]');
  for (const col of cols) {
    const r = col.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) return col.dataset.date as ISODate;
  }
  return fallback;
}

function onBlockPointerDown(date: ISODate, b: MultiDayRenderBlock, e: PointerEvent) {
  if (e.button !== 0 || (b.isDraft && !b.isPendingDraft)) return;
  if ((e.target as HTMLElement).closest('button, .resize-handle')) return;
  e.stopPropagation();

  if (b.kind === 'cluster') {
    hourHeight.value = Math.max(hourHeight.value, 60);
    showZoomBadge('展开详情');
    void nextTick(() => scrollToMinute(b.startMin, true));
    return;
  }

  const occ = b.occ;
  if (!occ && !b.isPendingDraft) return;
  selectedKey.value = b.id;

  if (storeState.readOnly) {
    if (occ) openEditor({ mode: 'edit', taskId: occ.task.id, date: occ.date });
    return;
  }
  if (!canEdit()) return;
  if (e.pointerType !== 'touch') e.preventDefault();

  const cardRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const grabOffsetY = e.clientY - cardRect.top;
  const origStartMin = b.startMin;
  const origEndMin = b.endMin;
  const dur = Math.max(MIN_DURATION, origEndMin - origStartMin);
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  const isTouch = e.pointerType === 'touch';
  const allowCrossDay = b.isPendingDraft || !occ?.task.repeat;
  let lastClientX = e.clientX;
  let lastClientY = e.clientY;
  let started = false;

  const applyMove = () => {
    const rect = colsGridRef.value?.getBoundingClientRect();
    if (!rect) return;
    const rawMin = ((lastClientY - rect.top - grabOffsetY - 1.5) / hourHeight.value) * 60;
    const s = clampMinutes(snapMinutes(rawMin), 0, DAY_MINUTES - dur);
    const targetDate = allowCrossDay ? dateAtClientX(lastClientX, date) : date;
    if (!drag.value) {
      pinnedRightId.value = b.id;
      drag.value = {
        kind: 'move',
        key: b.id,
        origDate: date,
        targetDate,
        title: occ ? occ.task.title : b.title,
        startMin: s,
        endMin: s + dur,
        pillMin: s,
        color: b.color,
        occ,
      };
    } else if (drag.value.startMin !== s || drag.value.endMin !== s + dur || drag.value.targetDate !== targetDate) {
      drag.value.startMin = s;
      drag.value.endMin = s + dur;
      drag.value.pillMin = s;
      drag.value.targetDate = targetDate;
    }
  };

  onScrollRecompute = () => {
    if (started) applyMove();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientX = ev.clientX;
    lastClientY = ev.clientY;
    if (!started) {
      const thresh = isTouch ? 10 : 4;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < thresh) return;
      started = true;
    }
    applyMove();
    updateAutoScroll(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const finalStart = drag.value?.startMin ?? origStartMin;
    const finalDate = drag.value?.targetDate ?? date;
    const committed = started && (finalStart !== origStartMin || finalDate !== date);
    if (committed && b.isPendingDraft) {
      updatePendingDraftFromTimeline({
        date: finalDate,
        startMin: finalStart,
        endMin: finalStart + dur,
      });
    }
    cleanup();
    if (committed && occ && !b.isPendingDraft) {
      const timeStr = formatMinToHHMM(finalStart);
      if (allowCrossDay && finalDate !== date) {
        const offsetFromOcc = diffDays(occ.start, date);
        const newStart = addDays(finalDate, -offsetFromOcc);
        const span = Math.max(0, diffDays(occ.task.start, occ.task.end));
        selectedKey.value = `${occ.task.id}@${finalDate}`;
        pinnedRightId.value = selectedKey.value;
        void saveTask({
          ...occ.task,
          start: newStart,
          end: addDays(newStart, span),
          time: timeStr,
          duration: dur,
        });
      } else {
        void saveTask({ ...occ.task, time: timeStr, duration: dur });
      }
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

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onResizePointerDown(date: ISODate, b: MultiDayRenderBlock, edge: 'top' | 'bottom', e: PointerEvent) {
  if (e.button !== 0 || b.kind !== 'single' || (!b.occ && !b.isPendingDraft) || !canEdit()) return;
  e.stopPropagation();
  e.preventDefault();

  const occ = b.occ;
  selectedKey.value = b.id;
  const origStartMin = b.startMin;
  const origEndMin = b.endMin;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let lastClientY = e.clientY;
  let started = false;

  const applyResize = () => {
    const snapped = snapMinutes(minFromGrid(lastClientY));
    let s = origStartMin;
    let end = origEndMin;
    if (edge === 'bottom') end = clampMinutes(snapped, origStartMin + MIN_DURATION, DAY_MINUTES);
    else s = clampMinutes(snapped, 0, origEndMin - MIN_DURATION);
    const pillMin = edge === 'bottom' ? end : s;

    if (!drag.value) {
      pinnedRightId.value = b.id;
      drag.value = {
        kind: edge === 'top' ? 'resize-top' : 'resize-bottom',
        key: b.id,
        origDate: date,
        targetDate: date,
        title: occ ? occ.task.title : b.title,
        startMin: s,
        endMin: end,
        pillMin,
        color: b.color,
        occ,
      };
    } else if (drag.value.startMin !== s || drag.value.endMin !== end || drag.value.pillMin !== pillMin) {
      drag.value.startMin = s;
      drag.value.endMin = end;
      drag.value.pillMin = pillMin;
    }
  };

  onScrollRecompute = () => {
    if (started) applyResize();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientY = ev.clientY;
    if (!started) {
      if (Math.abs(ev.clientY - startY) < 2) return;
      started = true;
    }
    applyResize();
    updateAutoScroll(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const s = drag.value?.startMin ?? origStartMin;
    const end = drag.value?.endMin ?? origEndMin;
    const committed = started && (s !== origStartMin || end !== origEndMin);
    if (committed && b.isPendingDraft) {
      updatePendingDraftFromTimeline({ date, startMin: s, endMin: end });
    }
    cleanup();
    if (committed && occ && !b.isPendingDraft) {
      void saveTask({ ...occ.task, time: formatMinToHHMM(s), duration: end - s });
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

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onColPointerDown(date: ISODate, e: PointerEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('.md-event')) return;
  selectedKey.value = '';
  pinnedRightId.value = '';
  if (!canEdit() || e.pointerType === 'touch') return;
  e.preventDefault();

  const anchorMin = clampMinutes(floorMinutes(minFromGrid(e.clientY)), 0, DAY_MINUTES - MIN_DURATION);
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let lastClientY = e.clientY;
  let started = false;

  const applyCreate = () => {
    const rawCur = minFromGrid(lastClientY);
    const { startMin: s, endMin: end, pillMin: pill } = computeCreateRange(anchorMin, rawCur);
    if (!drag.value) {
      pinnedRightId.value = '__draft__';
      drag.value = {
        kind: 'create',
        key: '__draft__',
        origDate: date,
        targetDate: date,
        title: '新建事项',
        startMin: s,
        endMin: end,
        pillMin: pill,
        color: '#ee632c',
        occ: null,
      };
    } else if (drag.value.startMin !== s || drag.value.endMin !== end || drag.value.pillMin !== pill) {
      drag.value.startMin = s;
      drag.value.endMin = end;
      drag.value.pillMin = pill;
    }
  };

  onScrollRecompute = () => {
    if (started) applyCreate();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientY = ev.clientY;
    if (!started) {
      if (Math.abs(ev.clientY - startY) < 6) return;
      started = true;
    }
    applyCreate();
    updateAutoScroll(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const s = drag.value?.startMin ?? anchorMin;
    const end = drag.value?.endMin ?? Math.min(DAY_MINUTES, anchorMin + DEFAULT_DURATION);
    const dur = Math.max(MIN_DURATION, end - s);
    const ok = started;
    if (ok) {
      setPendingDraft({
        date,
        startMin: s,
        endMin: Math.min(DAY_MINUTES, s + dur),
        title: '新建事项',
        source: 'timeline',
      });
    }
    cleanup();
    if (ok) {
      openEditor({
        mode: 'new',
        start: date,
        end: date,
        time: formatMinToHHMM(s),
        duration: dur,
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

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onColDblClick(date: ISODate, e: MouseEvent) {
  if (!canEdit()) return;
  if ((e.target as HTMLElement).closest('.md-event')) return;
  const s = clampMinutes(floorMinutes(minFromGrid(e.clientY)), 0, DAY_MINUTES - DEFAULT_DURATION);
  setPendingDraft({
    date,
    startMin: s,
    endMin: Math.min(DAY_MINUTES, s + DEFAULT_DURATION),
    title: '新建事项',
    source: 'timeline',
  });
  openEditor({
    mode: 'new',
    start: date,
    end: date,
    time: formatMinToHHMM(s),
    duration: DEFAULT_DURATION,
  });
}

// ---------------------------------------------------------------- Wheel Zoom & Swipe

let wheelAccX = 0;
let wheelLockUntil = 0;
let wheelAltLockUntil = 0;

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
      const next = stepDesktopMultiDays(daysCount.value, e.deltaY > 0 ? 1 : -1);
      if (next !== daysCount.value) {
        daysCount.value = next;
        showZoomBadge(`${next}天`);
        wheelAltLockUntil = t + 340;
      }
    }
    return;
  }

  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 && Math.abs(e.deltaX) > 6) {
    e.preventDefault();
    const t = performance.now();
    if (t < wheelLockUntil) return;
    if (Math.sign(e.deltaX) !== Math.sign(wheelAccX)) wheelAccX = 0;
    wheelAccX += e.deltaX;
    if (Math.abs(wheelAccX) >= 85) {
      ui.selected = addDays(ui.selected, wheelAccX > 0 ? 1 : -1);
      ui.cursor = startOfMonth(ui.selected);
      wheelAccX = 0;
      wheelLockUntil = t + 420;
    }
  }
}

// ---------------------------------------------------------------- Header & Now Pill Actions

function selectSpan(n: DesktopMultiDays) {
  daysCount.value = n;
  showZoomBadge(`${n}天`);
}

function selectPhoneSpan(n: 2 | 3) {
  phoneDays.value = n;
  showZoomBadge(`${n}天`);
}

function selectDensity(h: number, label: string) {
  hourHeight.value = h;
  showZoomBadge(label);
}

function selectHeaderDay(d: ISODate) {
  ui.selected = d;
  ui.cursor = startOfMonth(d);
}

function openSingleDay(d: ISODate) {
  ui.selected = d;
  ui.cursor = startOfMonth(d);
  patchSettings({ calendar: { view: 'day' } });
}

function onEditBlock(b: MultiDayRenderBlock) {
  if (b.occ) openEditor({ mode: 'edit', taskId: b.occ.task.id, date: b.occ.date });
}

function onMenuBlock(b: MultiDayRenderBlock, e: MouseEvent) {
  if (!b.occ) return;
  selectedKey.value = b.id;
  void chipMenu(b.occ, { x: e.clientX, y: e.clientY });
}

function onToggleDone(occ: Occurrence) {
  if (storeState.readOnly) return;
  void setOccurrenceDone(occ.task, occ.date, !occ.done);
}

function onViewKeyDown(e: KeyboardEvent) {
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    page(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (!selectedKey.value) return;
  for (const list of blocksByDate.value.values()) {
    const hit = list.find((x) => x.id === selectedKey.value);
    if (!hit?.occ) continue;
    if (e.key === 'Enter') {
      e.preventDefault();
      openEditor({ mode: 'edit', taskId: hit.occ.task.id, date: hit.occ.date });
    } else if (e.key === ' ' && !storeState.readOnly) {
      e.preventDefault();
      onToggleDone(hit.occ);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit()) {
      e.preventDefault();
      const occ = hit.occ;
      selectedKey.value = '';
      void removeTask(occ.task, occ.date);
    } else if (e.key === 'Escape' && !drag.value) {
      selectedKey.value = '';
    }
    return;
  }
}

const todayAllOccurrences = computed(() => {
  const t = now.value;
  return shownTasks.value.flatMap((task) => occurrences(task, t, t));
});
const nowStatus = computed(() => findNowOrNext(todayAllOccurrences.value, nowMin.value));

function scrollToMinute(min: number, smooth = false) {
  const el = scrollRef.value;
  if (!el) return;
  const targetMin = Math.max(0, min - 90);
  el.scrollTo({
    top: (targetMin / 60) * hourHeight.value,
    behavior: smooth && !reduceMotion.value ? 'smooth' : 'auto',
  });
}

function scrollInitial() {
  let earliest = 8 * 60;
  let found = false;
  for (const d of visibleDates.value) {
    for (const o of visibleOccurrences.value.get(d) ?? []) {
      if (o.task.time) {
        const m = parseTimeMin(o.task.time);
        if (!found || m < earliest) {
          earliest = m;
          found = true;
        }
      }
    }
  }
  const target = found ? Math.min(8 * 60, earliest) : 7.5 * 60;
  scrollToMinute(target, false);
}

function jumpNowPill() {
  goToday();
  const min = nowStatus.value.occ?.task.time ? parseTimeMin(nowStatus.value.occ.task.time) : nowMin.value;
  void nextTick(() => scrollToMinute(min, true));
}

onMounted(() => {
  nowTimer = setInterval(() => {
    nowMin.value = currentMinuteOfDay();
  }, 30_000);
  void nextTick(scrollInitial);
});

watch([() => ui.flashTask, () => ui.locateRevision], () => {
  if (!ui.flashTask) return;
  for (const list of blocksByDate.value.values()) {
    const hit = list.find((x) => x.occ?.task.id === ui.flashTask);
    if (hit) {
      selectedKey.value = hit.id;
      void nextTick(() => scrollToMinute(hit.startMin, true));
      return;
    }
  }
});

onBeforeUnmount(() => {
  cleanupActiveDrag?.();
  stopAutoScroll();
  clearTimeout(zoomBadgeTimer);
  if (nowTimer) clearInterval(nowTimer);
});

// External HTML5 task drop onto MultiDayView columns & day headers
const extDropCol = ref<{ date: ISODate; min: number } | null>(null);
const extDropHeadDate = ref<ISODate | ''>('');

function onColExtDragOver(date: ISODate, e: DragEvent) {
  if (!canEdit() || !hasTaskDragPayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const raw = minFromGrid(e.clientY);
  const snapped = clampMinutes(snapMinutes(raw), 0, DAY_MINUTES - DEFAULT_DURATION);
  extDropCol.value = { date, min: snapped };
}

function onColExtDragLeave(date: ISODate, e: DragEvent) {
  const cur = e.currentTarget as HTMLElement | null;
  if (cur && e.relatedTarget instanceof Node && cur.contains(e.relatedTarget)) return;
  if (extDropCol.value?.date === date) extDropCol.value = null;
}

function onColExtDrop(date: ISODate, e: DragEvent) {
  const hit = extDropCol.value;
  extDropCol.value = null;
  if (!canEdit()) return;
  const taskId = getDraggedTaskId(e);
  if (!taskId) return;
  e.preventDefault();
  const s =
    hit && hit.date === date
      ? hit.min
      : clampMinutes(snapMinutes(minFromGrid(e.clientY)), 0, DAY_MINUTES - DEFAULT_DURATION);
  void dropTaskToDate(taskId, date, formatMinToHHMM(s), DEFAULT_DURATION);
}

function onDayHeadExtDragOver(date: ISODate, e: DragEvent) {
  if (!canEdit() || !hasTaskDragPayload(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  extDropHeadDate.value = date;
}

function onDayHeadExtDrop(date: ISODate, e: DragEvent) {
  extDropHeadDate.value = '';
  if (!canEdit()) return;
  const taskId = getDraggedTaskId(e);
  if (!taskId) return;
  e.preventDefault();
  void dropTaskToDate(taskId, date);
}
</script>

<template>
  <div
    class="multiday-view"
    :class="{
      dark: isDark,
      'reduce-motion': reduceMotion,
      dragging: !!drag,
      'dragging-move': drag?.kind === 'move',
      'dragging-resize': drag?.kind === 'resize-top' || drag?.kind === 'resize-bottom',
      'dragging-create': drag?.kind === 'create',
    }"
    tabindex="-1"
    @keydown="onViewKeyDown"
  >
    <div class="md-subbar">
      <span class="md-range">{{ rangeSummary }}</span>
      <div class="md-controls">
        <div v-if="isPhone" class="md-pill-group" role="group" aria-label="显示天数">
          <button
            v-for="n in ([2, 3] as const)"
            :key="n"
            type="button"
            class="md-seg-btn"
            :class="{ active: effectiveDays === n }"
            @click="selectPhoneSpan(n)"
          >
            {{ n }}天
          </button>
        </div>
        <div v-else class="md-pill-group" role="group" aria-label="显示天数">
          <button
            v-for="n in (vpWidth < 900 ? ([3, 5] as const) : ([3, 5, 7] as const))"
            :key="n"
            type="button"
            class="md-seg-btn"
            :class="{ active: effectiveDays === n }"
            @click="selectSpan(n)"
          >
            {{ n }}天
          </button>
        </div>
        <div class="md-pill-group md-density-group" role="group" aria-label="时间轴密度">
          <button
            type="button"
            class="md-seg-btn"
            :class="{ active: hourHeight < 42 }"
            title="紧凑视图（Ctrl+滚轮可无级缩放）"
            @click="selectDensity(34, '紧凑视图')"
          >
            紧凑
          </button>
          <button
            type="button"
            class="md-seg-btn"
            :class="{ active: hourHeight >= 42 && hourHeight <= 68 }"
            title="标准视图"
            @click="selectDensity(58, '标准视图')"
          >
            标准
          </button>
          <button
            type="button"
            class="md-seg-btn"
            :class="{ active: hourHeight > 68 }"
            title="宽松视图"
            @click="selectDensity(76, '宽松视图')"
          >
            宽松
          </button>
        </div>
        <button
          v-if="!storeState.readOnly"
          type="button"
          class="md-add-btn"
          title="在此日新建日程"
          aria-label="新建日程"
          @click="openEditor({ mode: 'new', start: ui.selected, end: ui.selected, time: '09:00', duration: 60 })"
        >
          <FIcon name="add" :size="12" />
        </button>
      </div>
    </div>

    <div class="md-head">
      <div class="md-head-row">
        <div class="md-axis-cap">全天</div>
        <div class="md-day-heads" :style="{ gridTemplateColumns: `repeat(${effectiveDays}, minmax(0, 1fr))` }">
          <button
            v-for="d in visibleDates"
            :key="`hd-${d}`"
            type="button"
            class="md-day-head"
            :class="{ today: d === now, selected: d === ui.selected, rest: headerMeta(d).isRest, 'ext-drop': extDropHeadDate === d }"
            title="单击选中，双击切到单日视图"
            @click="selectHeaderDay(d)"
            @dblclick="openSingleDay(d)"
            @dragover="onDayHeadExtDragOver(d, $event)"
            @dragleave="extDropHeadDate === d && (extDropHeadDate = '')"
            @drop="onDayHeadExtDrop(d, $event)"
          >
            <span class="hd-wd">周{{ headerMeta(d).wd }}</span>
            <span class="hd-num">{{ headerMeta(d).num }}</span>
            <span v-if="headerMeta(d).tag" class="hd-tag">{{ headerMeta(d).tag }}</span>
          </button>
        </div>
      </div>

      <div v-if="hasAnyAllDay" class="md-allday-row">
        <div class="md-axis-spacer" aria-hidden="true" />
        <div class="md-allday-grid" :style="{ gridTemplateColumns: `repeat(${effectiveDays}, minmax(0, 1fr))` }">
          <div v-for="d in visibleDates" :key="`mad-${d}`" class="md-allday-col">
            <button
              v-for="o in (allDayByDate.get(d) ?? []).slice(0, 3)"
              :key="occKey(o)"
              type="button"
              class="md-allday-chip"
              :class="{
                done: o.done,
                'sf-dimmed': spotlightStateOf(o.task) === 'dimmed',
                'sf-dissolved': spotlightStateOf(o.task) === 'dissolved',
              }"
              :style="{ '--ev-bar': accentHexOf(o.task) }"
              @click="openEditor({ mode: 'edit', taskId: o.task.id, date: o.date })"
              @contextmenu.prevent.stop="chipMenu(o, { x: $event.clientX, y: $event.clientY })"
            >
              <span class="ad-title">{{ o.task.title }}</span>
            </button>
            <span v-if="(allDayByDate.get(d)?.length ?? 0) > 3" class="md-allday-more">
              +{{ (allDayByDate.get(d)?.length ?? 0) - 3 }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="md-viewport">
      <Transition name="md-badge">
        <div v-if="zoomBadge" class="md-zoom-badge">{{ zoomBadge }}</div>
      </Transition>

      <div ref="scrollRef" class="md-scroll" @wheel="onTimelineWheel">
        <div class="md-canvas">
          <div class="md-axis" :style="{ height: `${timelineHeight}px` }" aria-hidden="true">
            <div
              v-for="h in HOURS"
              :key="`mh-${h}`"
              class="md-hour"
              :class="{ occluded: isHourOccluded(h) }"
              :style="{ top: `${h * hourHeight}px` }"
            >
              {{ String(h).padStart(2, '0') }}:00
            </div>
            <div
              class="md-hour end-label"
              :class="{ occluded: isHourOccluded(24) }"
              :style="{ top: `${timelineHeight}px` }"
            >
              24:00
            </div>

            <div
              v-if="visibleDates.includes(now)"
              class="md-now-axis-pill"
              :style="{ top: `${(nowMin / 60) * hourHeight}px` }"
            >
              {{ formatMinToHHMM(nowMin) }}
            </div>

            <Transition name="axis-pill">
              <div v-if="pillState" class="md-drag-pill" :style="{ top: `${pillState.y}px` }">
                {{ pillState.label }}
              </div>
            </Transition>
          </div>

          <div
            ref="colsGridRef"
            class="md-cols"
            :style="{
              height: `${timelineHeight}px`,
              gridTemplateColumns: `repeat(${effectiveDays}, minmax(0, 1fr))`,
            }"
          >
            <div v-for="h in HOURS" :key="`mhl-${h}`" class="md-hline" :style="{ top: `${h * hourHeight}px` }" />
            <div class="md-hline" :style="{ top: `${timelineHeight}px` }" />

            <div
              v-for="h in HOURS"
              :key="`mhh-${h}`"
              class="md-half-line"
              :style="{ top: `${(h + 0.5) * hourHeight}px` }"
            />

            <Transition name="guide-fade">
              <div v-if="pillState" class="md-snap-guide" :style="{ top: `${pillState.y}px` }" aria-hidden="true" />
            </Transition>

            <div
              v-for="(d, idx) in visibleDates"
              :key="`mcol-${d}`"
              :data-date="d"
              class="md-day-col"
              :class="{
                today: d === now,
                selected: d === ui.selected,
                bordered: idx > 0,
                'drop-target': (drag?.kind === 'move' && drag.targetDate === d) || extDropCol?.date === d,
              }"
              @pointerdown="onColPointerDown(d, $event)"
              @dblclick="onColDblClick(d, $event)"
              @dragover="onColExtDragOver(d, $event)"
              @dragleave="onColExtDragLeave(d, $event)"
              @drop="onColExtDrop(d, $event)"
            >
              <div
                v-if="extDropCol && extDropCol.date === d"
                class="md-ext-drop-ghost"
                :style="{
                  top: `${(extDropCol.min / 60) * hourHeight}px`,
                  height: `${(DEFAULT_DURATION / 60) * hourHeight}px`,
                  '--ghost-color': workspaceDrag.color || '#3b82f6',
                }"
                aria-hidden="true"
              >
                <span class="edg-title">{{ workspaceDrag.title || '松手安排到此时间' }}</span>
                <span class="edg-time">{{ formatRangeLabel(extDropCol.min, Math.min(DAY_MINUTES, extDropCol.min + DEFAULT_DURATION), false) }}</span>
              </div>
              <div
                v-if="d === now"
                class="md-now-line"
                :style="{ top: `${(nowMin / 60) * hourHeight}px` }"
                aria-hidden="true"
              />

              <div
                v-for="b in blocksByDate.get(d) ?? []"
                :key="b.id"
                class="md-event"
                :class="[
                  b.kind,
                  {
                    selected: b.isSelected,
                    moving: b.isMoving,
                    resizing: b.isResizing,
                    draft: b.isDraft,
                    'pending-draft': b.isPendingDraft,
                    done: b.done,
                    dense: isClustered || effectiveDays >= 7,
                    'sf-dimmed': b.spotlight === 'dimmed' && !b.isMoving && !b.isResizing && !b.isDraft,
                    'sf-dissolved': b.spotlight === 'dissolved' && !b.isMoving && !b.isResizing && !b.isDraft,
                  },
                ]"
                :style="blockStyle(b)"
                @pointerdown="onBlockPointerDown(d, b, $event)"
                @dblclick.stop="onEditBlock(b)"
                @contextmenu.prevent.stop="onMenuBlock(b, $event)"
              >
                <div
                  v-if="b.kind === 'single' && (!b.isDraft || b.isPendingDraft) && !isClustered && !storeState.readOnly"
                  class="resize-handle top"
                  @pointerdown.stop="onResizePointerDown(d, b, 'top', $event)"
                />

                <div class="blk-top">
                  <span v-if="b.kind === 'cluster'" class="blk-title-wrap">
                    <span class="blk-title">{{ b.title }}</span>
                    <span class="cluster-pips" aria-hidden="true">
                      <i v-for="(c, ci) in b.colors" :key="ci" :style="{ background: c }" />
                    </span>
                  </span>
                  <span v-else class="blk-title" :class="titleClampClass(b)">{{ b.title }}</span>

                  <span v-if="showBlockDuration(b)" class="blk-dur">
                    {{ formatDurationLabel(b.endMin - b.startMin) }}
                  </span>
                </div>

                <div v-if="showBlockTime(b)" class="blk-time">
                  <span>{{ formatRangeLabel(b.startMin, b.endMin, false) }}</span><span v-if="b.showDuration"> · {{ formatDurationLabel(b.endMin - b.startMin) }}</span>
                </div>

                <button
                  v-if="b.kind === 'single' && b.occ && !b.isDraft && !storeState.readOnly && blockPxHeight(b) >= 28"
                  type="button"
                  class="ev-check"
                  :class="{ checked: b.done }"
                  :title="b.done ? '标记为未完成' : '标记为完成'"
                  @pointerdown.stop
                  @click.stop="onToggleDone(b.occ)"
                >
                  <FIcon :name="b.done ? 'checkMark' : 'completed'" :size="10" />
                </button>

                <div
                  v-if="b.kind === 'single' && (!b.isDraft || b.isPendingDraft) && !isClustered && !storeState.readOnly"
                  class="resize-handle bottom"
                  @pointerdown.stop="onResizePointerDown(d, b, 'bottom', $event)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="md-now-float" title="定位到今日当前时段" @click="jumpNowPill">
        <span class="now-dot" :class="nowStatus.state" aria-hidden="true" />
        <span class="now-text">
          <strong>{{ nowStatus.prefix }}</strong>
          <template v-if="nowStatus.title">：{{ nowStatus.title }}</template>
        </span>
        <span v-if="nowStatus.timeHint" class="now-hint">{{ nowStatus.timeHint }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.multiday-view {
  --md-surface: #fffdf9;
  --md-ink: var(--calendar-text, #1d1b1a);
  --md-muted: rgba(43, 40, 37, 0.48);
  --md-line: rgba(43, 40, 37, 0.06);
  --md-half-line: rgba(43, 40, 37, 0.045);
  --md-col-sep: rgba(43, 40, 37, 0.055);
  --md-pill-bg: rgba(43, 40, 37, 0.055);
  --md-pill-hover: rgba(43, 40, 37, 0.095);
  --md-coral: #ee632c;
  --md-now-red: #e8453c;
  --md-active-top: #222225;
  --md-active: #171719;
  --md-active-ink: #ffffff;
  --md-active-muted: rgba(255, 255, 255, 0.68);
  --md-cluster-bg: #ececf0;
  --md-cluster-bar: #8d8e98;
  --md-cluster-border: rgba(43, 40, 37, 0.08);
  --md-float-bg: rgba(255, 253, 249, 0.9);
  --md-float-border: rgba(43, 40, 37, 0.09);

  --md-spring-col: cubic-bezier(0.22, 1, 0.36, 1);
  --md-spring-snap: cubic-bezier(0.22, 1, 0.36, 1);

  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  outline: none;
  text-shadow: none;
  --text-glow: none;
  user-select: none;
}

@supports (animation-timing-function: linear(0, 1)) {
  .multiday-view {
    --md-spring-col: linear(0.0000, 0.0817, 0.2565, 0.4521, 0.6293, 0.7716, 0.8756, 0.9455, 0.9881, 1.0111, 1.0208, 1.0226, 1.0202, 1.0161, 1.0116, 1.0078, 1.0047, 1.0025, 1.0000);
    --md-spring-snap: linear(0.0000, 0.1112, 0.3270, 0.5473, 0.7284, 0.8601, 0.9453, 0.9936, 1.0161, 1.0224, 1.0202, 1.0145, 1.0087, 1.0043, 1.0016, 1.0002, 1.0000);
  }
}

.multiday-view.dark {
  --md-surface: #252422;
  --md-ink: var(--calendar-text, #f4f1ea);
  --md-muted: rgba(255, 250, 240, 0.52);
  --md-line: rgba(255, 250, 240, 0.075);
  --md-half-line: rgba(255, 250, 240, 0.045);
  --md-col-sep: rgba(255, 250, 240, 0.06);
  --md-pill-bg: rgba(255, 250, 240, 0.08);
  --md-pill-hover: rgba(255, 250, 240, 0.13);
  --md-active-top: #faf8f3;
  --md-active: #ece8df;
  --md-active-ink: #191816;
  --md-active-muted: rgba(25, 24, 22, 0.62);
  --md-cluster-bg: rgba(255, 250, 240, 0.12);
  --md-cluster-bar: rgba(255, 250, 240, 0.46);
  --md-cluster-border: rgba(255, 250, 240, 0.12);
  --md-float-bg: rgba(38, 36, 33, 0.9);
  --md-float-border: rgba(255, 250, 240, 0.12);
}

.multiday-view.dragging-move,
.multiday-view.dragging-move * {
  cursor: grabbing !important;
}
.multiday-view.dragging-resize,
.multiday-view.dragging-resize * {
  cursor: ns-resize !important;
}
.multiday-view.dragging-create,
.multiday-view.dragging-create * {
  cursor: crosshair !important;
}

/* ---------------------------------------------------------------- Subbar */

.md-subbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 14px 6px 64px;
}

.md-range {
  font-size: 12.5px;
  font-weight: 550;
  color: var(--md-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.md-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.md-pill-group {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 999px;
  background: var(--md-pill-bg);
  gap: 1px;
}

.md-seg-btn {
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--md-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.md-seg-btn:hover:not(.active) {
  color: var(--md-ink);
}
.md-seg-btn.active {
  background: var(--md-surface);
  color: var(--md-ink);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(20, 18, 16, 0.08);
}

.md-add-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--md-line);
  background: transparent;
  color: var(--md-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.md-add-btn:hover {
  background: var(--md-pill-bg);
  color: var(--md-ink);
}

/* ---------------------------------------------------------------- Day Headers & All-day Strip */

.md-head {
  flex: none;
  border-bottom: 1px solid var(--md-line);
  padding: 2px 18px 6px 0;
}

.md-head-row,
.md-allday-row {
  display: flex;
  align-items: stretch;
}

.md-axis-cap {
  width: 64px;
  flex: none;
  padding-right: 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 10.5px;
  color: var(--md-muted);
}

.md-axis-spacer {
  width: 64px;
  flex: none;
}

.md-day-heads {
  flex: 1;
  min-width: 0;
  display: grid;
}

.md-day-head {
  border: 0;
  background: transparent;
  padding: 4px 6px;
  border-radius: 8px;
  font: inherit;
  color: var(--md-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: background-color 140ms ease;
}
.md-day-head:hover {
  background: var(--md-pill-bg);
}

.hd-wd {
  font-size: 11px;
  color: var(--md-muted);
}
.md-day-head.rest .hd-wd {
  color: var(--md-coral);
  opacity: 0.82;
}

.hd-num {
  min-width: 24px;
  height: 22px;
  padding: 0 5px;
  border-radius: 7px;
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.md-day-head.selected:not(.today) .hd-num {
  background: var(--md-pill-bg);
}
.md-day-head.today .hd-num {
  background: var(--md-coral);
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(238, 99, 44, 0.28);
}

.hd-tag {
  font-size: 10px;
  color: var(--md-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 56px;
}

.md-allday-row {
  margin-top: 4px;
}

.md-allday-grid {
  flex: 1;
  min-width: 0;
  display: grid;
}

.md-allday-col {
  min-width: 0;
  padding: 0 3px;
  display: flex;
  flex-direction: column;
  gap: 2.5px;
}

.md-allday-chip {
  height: 20px;
  padding: 0 6px 0 8px;
  border: 0;
  border-radius: 6px;
  position: relative;
  background: color-mix(in srgb, var(--ev-bar) 15%, var(--md-surface));
  color: color-mix(in srgb, var(--ev-bar) 78%, #151412);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  text-align: left;
  cursor: pointer;
  transition:
    filter 230ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 230ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 230ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 180ms ease,
    color 180ms ease;
}
.md-allday-chip::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2.5px;
  bottom: 2.5px;
  width: 2.5px;
  border-radius: 999px;
  background: var(--ev-bar);
}
.multiday-view.dark .md-allday-chip {
  background: color-mix(in srgb, var(--ev-bar) 24%, var(--md-surface));
  color: color-mix(in srgb, var(--ev-bar) 24%, #ffffff);
}
.md-allday-chip.done {
  opacity: 0.5;
  text-decoration: line-through;
}
.ad-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-allday-more {
  font-size: 10px;
  color: var(--md-muted);
  padding-left: 4px;
}

/* ---------------------------------------------------------------- Timeline Grid */

.md-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.md-zoom-badge {
  position: absolute;
  top: 10px;
  right: 18px;
  z-index: 25;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--md-float-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--md-float-border);
  box-shadow: 0 4px 12px rgba(20, 18, 16, 0.12);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--md-ink);
  pointer-events: none;
}

.md-badge-enter-active,
.md-badge-leave-active {
  transition: opacity 150ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.md-badge-enter-from,
.md-badge-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.92);
}

.md-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}

.md-canvas {
  display: flex;
  align-items: flex-start;
  padding: 14px 18px 56px 0;
  position: relative;
}

.md-axis {
  width: 64px;
  flex: none;
  position: relative;
}

.md-hour {
  position: absolute;
  left: 0;
  right: 0;
  padding-right: 12px;
  transform: translateY(-50%);
  text-align: right;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--md-muted);
  line-height: 1;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.md-hour.end-label {
  opacity: 0.52;
}
.md-hour.occluded {
  opacity: 0;
}

.md-now-axis-pill {
  position: absolute;
  right: 8px;
  transform: translateY(-50%);
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--md-now-red);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 16;
  pointer-events: none;
}

.md-drag-pill {
  position: absolute;
  right: 8px;
  transform: translateY(-50%);
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--md-active);
  color: var(--md-active-ink);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(18, 16, 15, 0.22);
  z-index: 22;
  pointer-events: none;
  transition: top 110ms cubic-bezier(0.2, 0, 0, 1);
}
.md-drag-pill::after {
  content: '';
  position: absolute;
  right: -2.5px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: inherit;
  transform: translateY(-50%) rotate(45deg);
}

.axis-pill-enter-active,
.axis-pill-leave-active {
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.axis-pill-enter-from,
.axis-pill-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(12px) scale(0.8);
}

.md-cols {
  flex: 1;
  min-width: 0;
  position: relative;
  display: grid;
}

.md-hline {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--md-line);
  pointer-events: none;
}

.md-half-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  border-top: 1px dashed var(--md-half-line);
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}
.multiday-view.dragging .md-half-line {
  opacity: 1;
}

.md-snap-guide {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(24, 24, 27, 0.14);
  z-index: 9;
  pointer-events: none;
  transition: top 110ms cubic-bezier(0.2, 0, 0, 1);
}
.multiday-view.dark .md-snap-guide {
  background: rgba(255, 250, 240, 0.18);
}

.guide-fade-enter-active,
.guide-fade-leave-active {
  transition: opacity 130ms ease;
}
.guide-fade-enter-from,
.guide-fade-leave-to {
  opacity: 0;
}

.md-day-col {
  position: relative;
  min-width: 0;
  height: 100%;
  transition: background-color 140ms ease;
}
.md-day-col.bordered {
  border-left: 1px solid var(--md-col-sep);
}
.md-day-col.today {
  background: rgba(238, 99, 44, 0.025);
}
.md-day-col.drop-target {
  background: rgba(238, 99, 44, 0.065);
}

.md-now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--md-now-red);
  z-index: 12;
  pointer-events: none;
}

/* ---------------------------------------------------------------- Multi-Day Event Cards */

.md-event {
  position: absolute;
  box-sizing: border-box;
  border-radius: 9px;
  padding: 5px 8px 5px 11px;
  overflow: hidden;
  cursor: grab;
  z-index: 10;
  transition:
    left 420ms var(--md-spring-col),
    width 420ms var(--md-spring-col),
    top 220ms var(--md-spring-snap),
    height 220ms var(--md-spring-snap),
    background-color 180ms ease,
    color 180ms ease,
    box-shadow 180ms ease,
    filter 230ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 230ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 230ms cubic-bezier(0.22, 1, 0.36, 1);
}

.md-event::before {
  content: '';
  position: absolute;
  left: 2.5px;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 999px;
}

.md-event.single {
  background: color-mix(in srgb, var(--ev-bar) 15%, var(--md-surface));
  color: color-mix(in srgb, var(--ev-bar) 78%, #151412);
}
.md-event.single::before {
  background: var(--ev-bar);
}
.multiday-view.dark .md-event.single {
  background: color-mix(in srgb, var(--ev-bar) 24%, var(--md-surface));
  color: color-mix(in srgb, var(--ev-bar) 24%, #ffffff);
}

.md-event.cluster {
  background: var(--md-cluster-bg);
  border: 1px solid var(--md-cluster-border);
  box-shadow:
    0 2px 0 -1px rgba(43, 40, 37, 0.08),
    0 4px 0 -2px rgba(43, 40, 37, 0.04);
  color: var(--md-ink);
  cursor: pointer;
}
.md-event.cluster::before {
  background: var(--md-cluster-bar);
}

.md-event.single.selected {
  background: linear-gradient(180deg, var(--md-active-top) 0%, var(--md-active) 100%);
  color: var(--md-active-ink);
  box-shadow: 0 3px 10px rgba(15, 14, 13, 0.16);
  z-index: 16;
}
.md-event.single.selected .blk-time,
.md-event.single.selected .blk-dur {
  color: var(--md-active-muted);
}

.md-event.moving,
.md-event.resizing {
  box-shadow:
    0 16px 32px -6px rgba(15, 14, 13, 0.28),
    0 4px 10px -2px rgba(15, 14, 13, 0.16);
  transition-property: left, width, top, height, background-color, box-shadow;
  z-index: 26;
}

.md-event.sf-dimmed,
.md-allday-chip.sf-dimmed {
  filter: grayscale(1) saturate(0.08);
  opacity: 0.62;
  background: #EAE9E6 !important;
  color: rgba(28, 25, 23, 0.5) !important;
}

.md-event.sf-dimmed::before,
.md-allday-chip.sf-dimmed::before {
  background: rgba(28, 25, 23, 0.16) !important;
}

.md-event.sf-dimmed .blk-time,
.md-event.sf-dimmed .blk-dur {
  color: rgba(28, 25, 23, 0.42);
}

.multiday-view.dark .md-event.sf-dimmed,
.multiday-view.dark .md-allday-chip.sf-dimmed {
  background: #22242B !important;
  color: rgba(242, 240, 235, 0.44) !important;
}

.multiday-view.dark .md-event.sf-dimmed::before,
.multiday-view.dark .md-allday-chip.sf-dimmed::before {
  background: rgba(255, 255, 255, 0.18) !important;
}

.multiday-view.dark .md-event.sf-dimmed .blk-time,
.multiday-view.dark .md-event.sf-dimmed .blk-dur {
  color: rgba(242, 240, 235, 0.36);
}

.md-event.sf-dissolved,
.md-allday-chip.sf-dissolved {
  filter: grayscale(1) blur(8px);
  opacity: 0;
  transform: scale(0.955);
  pointer-events: none;
}

.md-event.draft {
  pointer-events: none;
  transition:
    left 420ms var(--md-spring-col),
    width 420ms var(--md-spring-col),
    top 90ms cubic-bezier(0.2, 0, 0, 1),
    height 90ms cubic-bezier(0.2, 0, 0, 1);
}

.md-event.draft.pending-draft {
  pointer-events: auto;
  cursor: grab;
  outline: 1.5px dashed rgba(255, 255, 255, 0.5);
  outline-offset: -2.5px;
}

.md-event.draft.pending-draft.moving {
  cursor: grabbing;
}

.md-event.done {
  opacity: 0.54;
}
.md-event.done .blk-title {
  text-decoration: line-through;
}

.md-event.dense {
  padding: 2px 5px 2px 9px;
  border-radius: 7px;
}

.blk-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  padding-right: 14px;
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
  font-size: 12px;
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

.blk-dur {
  flex: none;
  font-size: 10px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  opacity: 0.72;
}

.blk-time {
  margin-top: 2px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--ev-bar) 65%, var(--md-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.multiday-view.dark .md-event.single .blk-time {
  color: color-mix(in srgb, var(--ev-bar) 18%, rgba(255, 250, 240, 0.72));
}

.ev-check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 130ms ease, background-color 130ms ease;
}
.md-event:hover .ev-check,
.ev-check.checked {
  opacity: 0.72;
}
.ev-check:hover {
  opacity: 1 !important;
  background: rgba(128, 128, 128, 0.16);
}

.resize-handle {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 7px;
  cursor: ns-resize;
  touch-action: none;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
}
.resize-handle.top {
  top: 0;
}
.resize-handle.bottom {
  bottom: 0;
}
.resize-handle::after {
  content: '';
  width: 22px;
  height: 2.5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0;
  transition: opacity 130ms ease;
}
.resize-handle:hover::after,
.md-event.resizing .resize-handle::after {
  opacity: 0.42;
}

/* ---------------------------------------------------------------- Floating Now Pill */

.md-now-float {
  position: absolute;
  right: 18px;
  bottom: 12px;
  z-index: 22;
  height: 32px;
  max-width: min(300px, calc(100% - 88px));
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--md-float-border);
  background: var(--md-float-bg);
  backdrop-filter: blur(18px);
  box-shadow: 0 6px 20px rgba(20, 18, 16, 0.12);
  color: var(--md-ink);
  font: inherit;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease;
}
.md-now-float:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(20, 18, 16, 0.16);
}

.now-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--md-muted);
}
.now-dot.now {
  background: var(--md-coral);
  box-shadow: 0 0 0 3px rgba(238, 99, 44, 0.22);
}
.now-dot.next {
  background: #2f9e44;
}
.now-dot.allday {
  background: #3b82f6;
}

.now-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.now-text strong {
  font-weight: 600;
}

.now-hint {
  flex: none;
  font-size: 10.5px;
  color: var(--md-muted);
  font-variant-numeric: tabular-nums;
}

.multiday-view.reduce-motion *,
.multiday-view.reduce-motion .md-event {
  transition: none !important;
  animation: none !important;
}

@media (max-width: 639px) {
  .md-subbar {
    padding: 4px 8px 6px 10px;
    gap: 6px;
  }
  .md-head {
    padding-right: 8px;
  }
  .md-canvas {
    padding-right: 8px;
  }
  .md-axis,
  .md-axis-cap,
  .md-axis-spacer {
    width: 44px;
  }
  .md-axis-cap,
  .md-hour {
    padding-right: 7px;
  }
  .md-now-float {
    display: none;
  }
}

@media (max-width: 520px) {
  .md-density-group {
    display: none;
  }
}

.md-day-head.ext-drop {
  background: color-mix(in srgb, #e85d2a 12%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #e85d2a 42%, transparent);
}

.md-ext-drop-ghost {
  position: absolute;
  left: 3px;
  right: 4px;
  z-index: 35;
  border-radius: 9px;
  padding: 5px 8px;
  background: color-mix(in srgb, var(--ghost-color, #3b82f6) 24%, var(--ws-card-bg, #ffffff));
  border: 1.5px dashed color-mix(in srgb, var(--ghost-color, #3b82f6) 72%, transparent);
  color: color-mix(in srgb, var(--ghost-color, #3b82f6) 76%, #111111);
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--ghost-color, #3b82f6) 20%, transparent);
  transition: top 90ms cubic-bezier(0.22, 1, 0.36, 1);
}

.multiday-view.dark .md-ext-drop-ghost {
  background: color-mix(in srgb, var(--ghost-color, #3b82f6) 30%, #181a20);
  color: #ffffff;
}

.md-ext-drop-ghost .edg-title {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.md-ext-drop-ghost .edg-time {
  font-size: 10.5px;
  font-weight: 600;
  opacity: 0.82;
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .md-event,
  .md-allday-chip {
    transition: opacity 80ms linear !important;
  }
  .md-event.sf-dissolved,
  .md-allday-chip.sf-dissolved {
    filter: none;
    transform: none;
  }
}
</style>
