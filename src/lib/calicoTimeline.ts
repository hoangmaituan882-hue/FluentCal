import type { ISODate, Task } from '@/types';
import type { Occurrence } from '@/lib/recur';
import { clampMinutes, DAY_MINUTES, DEFAULT_DURATION, MIN_DURATION, parseTimeMin } from '@/lib/dayLayout';

export const CALICO_MIN_HOUR_H = 24;
export const CALICO_MAX_HOUR_H = 92;
export const CALICO_DEFAULT_HOUR_H = 60;

export const CALICO_MIN_DAYS = 1;
export const CALICO_MAX_DAYS = 7;
export const CALICO_DAY_STOPS = [1, 2, 3, 4, 5, 7] as const;
export type CalicoDayStop = (typeof CALICO_DAY_STOPS)[number];

export type PinchAxis = 'horizontal' | 'vertical';

export interface CalicoRawEvent {
  id: string;
  occ: Occurrence;
  task: Task;
  startMin: number;
  endMin: number;
  accent: string;
  done: boolean;
}

export interface CalicoEventBlock {
  kind: 'single' | 'cluster';
  id: string;
  startMin: number;
  endMin: number;
  /** Side-by-side lane index within the day column (0-based). */
  col: number;
  /** Total side-by-side lanes in this collision group. */
  colCount: number;
  /** Single-event fields */
  occ?: Occurrence;
  task?: Task;
  title: string;
  accent: string;
  done: boolean;
  /** Cluster fields */
  events: CalicoRawEvent[];
  colors: string[];
  /** Visual presentation style for clusters: full card on 1-3d, slim numbered capsule on 4-7d */
  clusterStyle: 'card' | 'capsule';
  /** True when vertical density is close to clustering threshold (subtle kiss/intensify cue) */
  nearCluster: boolean;
}

/** Rubber-band resistance outside [min, max] for tactile iOS/Calico boundary feel. */
export function rubberBand(value: number, min: number, max: number, factor = 0.28): number {
  if (value < min) return min - (min - value) * factor;
  if (value > max) return max + (value - max) * factor;
  return value;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Classifies a 2-finger touch gesture into horizontal (day-count zoom) vs vertical (hour-height zoom).
 * Uses BOTH finger geometry (initial dx/dy separation) and movement deltas so natural diagonal pinches
 * resolve deterministically without jitter.
 */
export function classifyPinchAxis(
  startDx: number,
  startDy: number,
  curDx: number,
  curDy: number,
): PinchAxis | null {
  const deltaX = Math.abs(curDx - startDx);
  const deltaY = Math.abs(curDy - startDy);
  const totalMove = deltaX + deltaY;
  if (totalMove < 10) return null;

  // Weight finger spread direction with actual change magnitude
  const horizScore = deltaX * 1.15 + (startDx > startDy * 1.25 ? 6 : 0);
  const vertScore = deltaY * 1.15 + (startDy > startDx * 1.25 ? 6 : 0);
  return horizScore >= vertScore ? 'horizontal' : 'vertical';
}

/**
 * Maps a horizontal pinch ratio (curDx / startDx) to continuous day count.
 * Pinching fingers INWARD (ratio < 1) zooms OUT to show MORE days (1 -> 7).
 * Spreading fingers OUTWARD (ratio > 1) zooms IN to show FEWER days (7 -> 1).
 */
export function computePinchedDays(startDays: number, startDx: number, curDx: number): number {
  const safeStart = Math.max(32, startDx);
  const safeCur = Math.max(18, curDx);
  const raw = startDays * (safeStart / safeCur);
  return clamp(rubberBand(raw, CALICO_MIN_DAYS, CALICO_MAX_DAYS, 0.22), 0.78, 7.6);
}

/**
 * Maps a vertical pinch ratio (curDy / startDy) to continuous hour height (px/hr).
 * Pinching fingers INWARD (ratio < 1) compresses hour height (compact 24h overview).
 * Spreading fingers OUTWARD (ratio > 1) expands hour height (spacious detail view).
 */
export function computePinchedHourHeight(startHourH: number, startDy: number, curDy: number): number {
  const safeStart = Math.max(32, startDy);
  const safeCur = Math.max(16, curDy);
  const raw = startHourH * (safeCur / safeStart);
  return clamp(rubberBand(raw, CALICO_MIN_HOUR_H, CALICO_MAX_HOUR_H, 0.2), 20, 100);
}

/** Snaps a continuous floating day count to the nearest Calico integer stop: 1, 2, 3, 4, 5, or 7. */
export function snapDayCount(continuousDays: number): CalicoDayStop {
  const clamped = clamp(continuousDays, CALICO_MIN_DAYS, CALICO_MAX_DAYS);
  let best: CalicoDayStop = 1;
  let bestDist = Infinity;
  for (const stop of CALICO_DAY_STOPS) {
    const d = Math.abs(stop - clamped);
    if (d < bestDist) {
      bestDist = d;
      best = stop;
    }
  }
  return best;
}

/** Compact duration label matching Calico's clean badges ("30m", "1h", "2h 30m", "9h 30m"). */
export function formatCalicoDuration(minutes: number): string {
  const m = Math.max(15, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h <= 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

/** Converts a list of timed occurrences for one day into raw minute-bounded events. */
export function toCalicoRawEvents(
  occs: Occurrence[],
  accentOf: (t: Task) => string,
): CalicoRawEvent[] {
  const out: CalicoRawEvent[] = [];
  for (const occ of occs) {
    if (!occ.task.time) continue;
    const startMin = clampMinutes(parseTimeMin(occ.task.time), 0, DAY_MINUTES - MIN_DURATION);
    const rawDur =
      typeof occ.task.duration === 'number' && Number.isFinite(occ.task.duration) && occ.task.duration > 0
        ? Math.max(MIN_DURATION, Math.round(occ.task.duration))
        : DEFAULT_DURATION;
    const endMin = Math.min(DAY_MINUTES, startMin + rawDur);
    out.push({
      id: `${occ.task.id}@${occ.date}`,
      occ,
      task: occ.task,
      startMin,
      endMin,
      accent: accentOf(occ.task),
      done: occ.done,
    });
  }
  out.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.task.order - b.task.order);
  return out;
}

function assignSideBySideLanes(blocks: CalicoEventBlock[]): CalicoEventBlock[] {
  if (!blocks.length) return [];
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Connected overlap components get independent lane counts so non-overlapping events take full width
  let i = 0;
  while (i < sorted.length) {
    const comp: CalicoEventBlock[] = [sorted[i]];
    let maxEnd = sorted[i].endMin;
    let j = i + 1;
    while (j < sorted.length && sorted[j].startMin < maxEnd) {
      comp.push(sorted[j]);
      if (sorted[j].endMin > maxEnd) maxEnd = sorted[j].endMin;
      j++;
    }

    const laneEnds: number[] = [];
    for (const blk of comp) {
      let lane = laneEnds.findIndex((end) => end <= blk.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(blk.endMin);
      } else {
        laneEnds[lane] = blk.endMin;
      }
      blk.col = lane;
    }
    const total = Math.max(1, laneEnds.length);
    for (const blk of comp) blk.colCount = total;
    i = j;
  }

  return sorted;
}

/**
 * Calico Dynamic Clustering + Lane Layout Engine:
 * - Spacious mode (hourHeight > 36 & effectiveDays < 4): individual pastel cards in clean side-by-side lanes.
 * - Compact vertical mode (hourHeight <= 36) OR high day density (effectiveDays >= 4):
 *   Overlapping or contiguous (gap <= 15m) short/dense events merge into Calico cluster cards:
 *   - 1..3 days -> light-grey horizontal card ("2 项日程 · 12:00 - 15:00 · 3h")
 *   - 4..7 days -> slim vertical grey capsule with circular count badge ("2", "4") at top!
 */
export function buildCalicoDayBlocks(
  rawEvents: CalicoRawEvent[],
  hourHeight: number,
  effectiveDays: number,
): CalicoEventBlock[] {
  if (!rawEvents.length) return [];

  const compactVert = hourHeight <= 36;
  const nearVertCluster = hourHeight > 36 && hourHeight <= 44;
  const denseHoriz = effectiveDays >= 3.6;
  const clusterStyle: 'card' | 'capsule' = effectiveDays >= 3.6 ? 'capsule' : 'card';

  const shouldCluster = compactVert || denseHoriz;
  if (!shouldCluster) {
    const singles: CalicoEventBlock[] = rawEvents.map((ev) => ({
      kind: 'single',
      id: ev.id,
      startMin: ev.startMin,
      endMin: ev.endMin,
      col: 0,
      colCount: 1,
      occ: ev.occ,
      task: ev.task,
      title: ev.task.title,
      accent: ev.accent,
      done: ev.done,
      events: [ev],
      colors: [ev.accent],
      clusterStyle,
      nearCluster: nearVertCluster,
    }));
    return assignSideBySideLanes(singles);
  }

  // Separate long background/all-day-like spanning events (e.g. "Work from Home 9h 30m") on 1-3d
  // when they sit beside shorter events, unless we are in 4-7d high-density capsule mode where
  // overlapping day stacks collapse cleanly into numbered vertical capsules (matching f_00_31_5.png!).
  const sorted = [...rawEvents].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const standalone: CalicoRawEvent[] = [];
  const candidates: CalicoRawEvent[] = [];

  for (const ev of sorted) {
    const dur = ev.endMin - ev.startMin;
    if (!denseHoriz && dur >= 300) {
      standalone.push(ev);
    } else {
      candidates.push(ev);
    }
  }

  const gapThreshold = denseHoriz ? 10 : 15;
  const groups: CalicoRawEvent[][] = [];
  for (const ev of candidates) {
    const prev = groups[groups.length - 1];
    if (!prev) {
      groups.push([ev]);
      continue;
    }
    const prevMaxEnd = Math.max(...prev.map((x) => x.endMin));
    const overlaps = ev.startMin < prevMaxEnd;
    const contiguous = ev.startMin - prevMaxEnd <= gapThreshold;
    // In 4-7d capsule mode, merge overlapping/tight chains; in 1-3d compact mode, merge overlapping or contiguous events
    if (overlaps || (compactVert && contiguous)) {
      prev.push(ev);
    } else {
      groups.push([ev]);
    }
  }

  const blocks: CalicoEventBlock[] = [];

  for (const ev of standalone) {
    blocks.push({
      kind: 'single',
      id: ev.id,
      startMin: ev.startMin,
      endMin: ev.endMin,
      col: 0,
      colCount: 1,
      occ: ev.occ,
      task: ev.task,
      title: ev.task.title,
      accent: ev.accent,
      done: ev.done,
      events: [ev],
      colors: [ev.accent],
      clusterStyle,
      nearCluster: false,
    });
  }

  for (const grp of groups) {
    if (grp.length === 1) {
      const ev = grp[0];
      blocks.push({
        kind: 'single',
        id: ev.id,
        startMin: ev.startMin,
        endMin: ev.endMin,
        col: 0,
        colCount: 1,
        occ: ev.occ,
        task: ev.task,
        title: ev.task.title,
        accent: ev.accent,
        done: ev.done,
        events: [ev],
        colors: [ev.accent],
        clusterStyle,
        nearCluster: false,
      });
    } else {
      const minStart = Math.min(...grp.map((x) => x.startMin));
      const maxEnd = Math.max(...grp.map((x) => x.endMin));
      const uniqueColors = Array.from(new Set(grp.map((x) => x.accent))).slice(0, 4);
      blocks.push({
        kind: 'cluster',
        id: `cluster:${grp.map((x) => x.id).join('|')}`,
        startMin: minStart,
        endMin: maxEnd,
        col: 0,
        colCount: 1,
        title: `${grp.length} 项日程`,
        accent: uniqueColors[0] ?? '#64748b',
        done: grp.every((x) => x.done),
        events: grp,
        colors: uniqueColors,
        clusterStyle,
        nearCluster: false,
      });
    }
  }

  return assignSideBySideLanes(blocks);
}

/** Adaptive header formatting tier based on continuous day count (matching Calico video!). */
export type CalicoHeaderTier = 'full' | 'compact' | 'squircle';

export function headerTierForDays(continuousDays: number): CalicoHeaderTier {
  if (continuousDays <= 1.55) return 'full';
  if (continuousDays <= 3.45) return 'compact';
  return 'squircle';
}

/** Frame-rate-independent exponential follow (handfeel.md §7.1). */
export function expApproach(current: number, target: number, tightness: number, dtSec: number): number {
  const dt = Math.min(0.05, Math.max(0, dtSec));
  return current + (target - current) * (1 - Math.exp(-tightness * dt));
}

export function buildDateBuffer(centerIso: ISODate, before = 6, after = 12, addDaysFn: (d: ISODate, n: number) => ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let i = -before; i <= after; i++) {
    out.push(addDaysFn(centerIso, i));
  }
  return out;
}
