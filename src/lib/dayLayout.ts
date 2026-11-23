import type { ISODate, Task } from '@/types';
import { addDays, diffDays } from './date';

export const STEP_MIN = 15;
export const MIN_DURATION = 15;
export const DEFAULT_DURATION = 60;
export const DAY_MINUTES = 1440;

export function clampMinutes(min: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, min));
}

export function snapMinutes(min: number, step = STEP_MIN): number {
  return Math.round(min / step) * step;
}

export function floorMinutes(min: number, step = STEP_MIN): number {
  return Math.floor(min / step) * step;
}

/**
 * Monotonic 15-minute slot range for empty-track drag-to-create.
 * `anchorMin` is the floored 15-min slot where pointerdown occurred.
 * Dragging downward expands `endMin` strictly monotonically (15m, 30m, 45m…);
 * dragging upward expands `startMin` strictly monotonically above the anchor slot.
 */
export function computeCreateRange(
  anchorMin: number,
  rawCurMin: number,
  step = STEP_MIN,
): { startMin: number; endMin: number; pillMin: number } {
  const a = clampMinutes(floorMinutes(anchorMin, step), 0, DAY_MINUTES - step);
  if (rawCurMin >= a) {
    const endMin = clampMinutes(Math.ceil(rawCurMin / step) * step, a + step, DAY_MINUTES);
    return { startMin: a, endMin, pillMin: endMin };
  }
  const startMin = clampMinutes(Math.floor(rawCurMin / step) * step, 0, a);
  const endMin = Math.min(DAY_MINUTES, a + step);
  return { startMin, endMin, pillMin: startMin };
}

/** Parses "HH:mm" into minutes from 00:00 (0..1439), defaulting to 09:00 on invalid input. */
export function parseTimeMin(hhmm: string | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return 9 * 60;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 9 * 60;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mins) || h < 0 || h > 23 || mins < 0 || mins > 59) {
    return 9 * 60;
  }
  return h * 60 + mins;
}

/** Formats minutes from 00:00 (0..1440) as "HH:mm" ("24:00" when 1440). */
export function formatMinToHHMM(min: number): string {
  const c = Math.round(clampMinutes(min, 0, DAY_MINUTES));
  if (c === DAY_MINUTES) return '24:00';
  const h = Math.floor(c / 60);
  const m = c % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Compact duration readout matching reference motion ("45m", "1h", "2h", "3h 45m"). */
export function formatDurationLabel(mins: number): string {
  const rounded = Math.max(MIN_DURATION, Math.round(mins));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Formats time range ("13:30 – 14:30") with optional live duration suffix ("· 3h 45m"). */
export function formatRangeLabel(startMin: number, endMin: number, showDuration = false): string {
  const range = `${formatMinToHHMM(startMin)} – ${formatMinToHHMM(endMin)}`;
  if (!showDuration) return range;
  return `${range} · ${formatDurationLabel(endMin - startMin)}`;
}

export interface DayLayoutInput {
  id: string;
  startMin: number;
  endMin: number;
  order?: number;
}

export interface DayLayoutItem {
  id: string;
  startMin: number;
  endMin: number;
  col: number;
  colCount: number;
}

function overlaps(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Interval-cluster overlap packing for single-day timeline events.
 * When `preferRightId` is provided (e.g. actively dragged/resized or recently dropped card),
 * stationary cards claim columns from left to right first so they stay anchored in col 0 while
 * the active card slides smoothly into the next available column without post-drop jumps.
 */
export function layoutDayEvents(items: DayLayoutInput[], preferRightId?: string): DayLayoutItem[] {
  if (!items.length) return [];

  const normalized = items.map((item) => {
    const startMin = clampMinutes(Math.round(item.startMin), 0, DAY_MINUTES - MIN_DURATION);
    const endMin = clampMinutes(Math.max(startMin + MIN_DURATION, Math.round(item.endMin)), startMin + MIN_DURATION, DAY_MINUTES);
    return {
      id: item.id,
      startMin,
      endMin,
      order: item.order ?? 0,
    };
  });

  const sorted = [...normalized].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.order - b.order || a.id.localeCompare(b.id),
  );

  // Connected overlap clusters using half-open [startMin, endMin) intervals.
  const clusters: (typeof sorted)[] = [];
  let current: typeof sorted = [];
  let clusterMaxEnd = -1;

  for (const item of sorted) {
    if (current.length === 0 || item.startMin < clusterMaxEnd) {
      current.push(item);
      if (item.endMin > clusterMaxEnd) clusterMaxEnd = item.endMin;
    } else {
      clusters.push(current);
      current = [item];
      clusterMaxEnd = item.endMin;
    }
  }
  if (current.length) clusters.push(current);

  const byId = new Map<string, DayLayoutItem>();

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      const only = cluster[0];
      byId.set(only.id, {
        id: only.id,
        startMin: only.startMin,
        endMin: only.endMin,
        col: 0,
        colCount: 1,
      });
      continue;
    }

    const pinned = preferRightId ? cluster.find((x) => x.id === preferRightId) : undefined;
    const others = pinned ? cluster.filter((x) => x.id !== pinned.id) : cluster;

    const cols: (typeof sorted)[] = [];
    const colOf = new Map<string, number>();

    const place = (ev: (typeof sorted)[number]) => {
      let placed = -1;
      for (let c = 0; c < cols.length; c++) {
        if (!cols[c].some((existing) => overlaps(existing, ev))) {
          placed = c;
          break;
        }
      }
      if (placed === -1) {
        placed = cols.length;
        cols.push([]);
      }
      cols[placed].push(ev);
      colOf.set(ev.id, placed);
    };

    for (const ev of others) place(ev);
    if (pinned) place(pinned);

    const colCount = cols.length;
    for (const ev of cluster) {
      byId.set(ev.id, {
        id: ev.id,
        startMin: ev.startMin,
        endMin: ev.endMin,
        col: colOf.get(ev.id) ?? 0,
        colCount,
      });
    }
  }

  return sorted.map((item) => byId.get(item.id)!);
}

export interface PendingTimelineDraft {
  date: ISODate;
  startMin: number;
  endMin: number;
  title: string;
  color?: string;
  groupId?: string;
  source: 'timeline' | 'editor';
  rev: number;
}

/** Projects a timed task draft into a live pending timeline block (`null` for all-day tasks). */
export function pendingDraftFromTask(
  t: Pick<Task, 'start' | 'time' | 'duration' | 'title' | 'color' | 'groupId'>,
  rev = 0,
): PendingTimelineDraft | null {
  if (!t.time) return null;
  const startMin = clampMinutes(parseTimeMin(t.time), 0, DAY_MINUTES - MIN_DURATION);
  const dur = Math.max(MIN_DURATION, typeof t.duration === 'number' && Number.isFinite(t.duration) ? Math.round(t.duration) : DEFAULT_DURATION);
  const endMin = Math.min(DAY_MINUTES, startMin + dur);
  return {
    date: t.start,
    startMin,
    endMin,
    title: t.title.trim() || '新建事项',
    color: t.color || undefined,
    groupId: t.groupId || undefined,
    source: 'editor',
    rev,
  };
}

/** Applies a timeline move/resize patch back onto an open editor draft task, preserving day span. */
export function applyTimelineDraftPatch(
  t: Task,
  patch: { date: ISODate; startMin: number; endMin: number },
): void {
  const span = Math.max(0, diffDays(t.start, t.end));
  t.start = patch.date;
  t.end = addDays(patch.date, span);
  t.time = formatMinToHHMM(patch.startMin);
  t.duration = Math.max(MIN_DURATION, patch.endMin - patch.startMin);
}
