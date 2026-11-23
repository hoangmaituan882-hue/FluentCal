import type { ISODate } from '@/types';
import { addDays, diffDays } from './date';
import type { Occurrence } from './recur';

/** A task occurrence clipped to one week row. */
export interface Chip {
  key: string;
  occ: Occurrence;
  /** 0–6 */
  col: number;
  span: number;
  /** The first day of this piece (the task's start, or the week's when it began before). */
  segStart: ISODate;
  lane: number;
  /** Continues from the previous / into the next week. */
  contLeft: boolean;
  contRight: boolean;
  multiDay: boolean;
  visible: boolean;
}

export interface DraftChip {
  col: number;
  span: number;
  segStart: ISODate;
  lane: number;
  contLeft: boolean;
  contRight: boolean;
  /** True when the cell is too full to fit the draft bar above "+N" without colliding. */
  floating: boolean;
}

export interface WeekLayout {
  chips: Chip[];
  /** Hidden chip count per column ("+N"). */
  overflow: number[];
  /** Lane index where the "+N" button sits, per column. */
  overflowLane: number[];
  draft?: DraftChip;
}

export interface LayoutOptions {
  /** Lanes that fit in a cell; Infinity = unlimited. */
  capacity: number;
  completedLast: boolean;
  draft?: { start: ISODate; end: ISODate };
}

function sortKey(a: Occurrence, b: Occurrence, completedLast: boolean): number {
  const am = a.start !== a.end ? 0 : 1;
  const bm = b.start !== b.end ? 0 : 1;
  if (am !== bm) return am - bm; // multi-day bars first, so they get the top lanes
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  const al = diffDays(a.start, a.end);
  const bl = diffDays(b.start, b.end);
  if (al !== bl) return bl - al;
  if (completedLast && a.done !== b.done) return a.done ? 1 : -1;
  const at = a.task.time ?? '';
  const bt = b.task.time ?? '';
  if (at !== bt) return at === '' ? -1 : bt === '' ? 1 : at < bt ? -1 : 1; // all-day first, then by time
  return a.task.order - b.task.order;
}

/**
 * Lays out occurrences in a week row starting at `weekStart`: assigns each chip the lowest
 * lane free across all its columns, then hides what doesn't fit. A column that overflows
 * gives its last visible lane to a "+N" button.
 */
export function layoutWeek(weekStart: ISODate, occs: Occurrence[], opt: LayoutOptions): WeekLayout {
  const weekEnd = addDays(weekStart, 6);
  const sorted = occs
    .filter((o) => o.end >= weekStart && o.start <= weekEnd)
    .sort((a, b) => sortKey(a, b, opt.completedLast));

  const used: boolean[][] = Array.from({ length: 7 }, () => []);
  const chips: Chip[] = [];
  const placeOcc = (occ: Occurrence) => {
    const s = occ.start < weekStart ? weekStart : occ.start;
    const e = occ.end > weekEnd ? weekEnd : occ.end;
    const col = diffDays(weekStart, s);
    const span = diffDays(s, e) + 1;
    let lane = 0;
    while (Array.from({ length: span }, (_, i) => used[col + i][lane]).some(Boolean)) lane++;
    for (let i = 0; i < span; i++) used[col + i][lane] = true;
    chips.push({
      key: `${occ.task.id}@${occ.date}`,
      occ,
      col,
      span,
      segStart: s,
      lane,
      contLeft: occ.start < weekStart,
      contRight: occ.end > weekEnd,
      multiDay: occ.start !== occ.end,
      visible: true,
    });
  };

  const multiBars = sorted.filter((o) => o.start !== o.end);
  const singleDay = sorted.filter((o) => o.start === o.end);
  for (const occ of multiBars) placeOcc(occ);

  const cap = opt.capacity;
  let draft: DraftChip | undefined;
  if (opt.draft && opt.draft.end >= weekStart && opt.draft.start <= weekEnd) {
    const ds = opt.draft.start < weekStart ? weekStart : opt.draft.start;
    const de = opt.draft.end > weekEnd ? weekEnd : opt.draft.end;
    const dCol = diffDays(weekStart, ds);
    const dSpan = diffDays(ds, de) + 1;
    const contLeft = opt.draft.start < weekStart;
    const contRight = opt.draft.end > weekEnd;
    let dLane = 0;
    while (Array.from({ length: dSpan }, (_, i) => used[dCol + i][dLane]).some(Boolean)) dLane++;

    let fitsCleanly = true;
    if (Number.isFinite(cap)) {
      if (dLane >= cap) {
        fitsCleanly = false;
      } else {
        const singleCount = Array(7).fill(0);
        for (const o of singleDay) singleCount[diffDays(weekStart, o.start)]++;
        for (let c = dCol; c < dCol + dSpan; c++) {
          let colMaxLane = dLane;
          for (let l = 0; l < used[c].length; l++) {
            if (used[c][l]) colMaxLane = Math.max(colMaxLane, l);
          }
          let probe = 0;
          for (let n = 0; n < singleCount[c]; n++) {
            while (used[c][probe] || probe === dLane) probe++;
            colMaxLane = Math.max(colMaxLane, probe);
            probe++;
          }
          const colLimit = colMaxLane + 1 <= cap ? cap : Math.max(0, cap - 1);
          if (dLane >= colLimit) {
            fitsCleanly = false;
            break;
          }
        }
      }
    }

    if (fitsCleanly) {
      for (let i = 0; i < dSpan; i++) used[dCol + i][dLane] = true;
      draft = { col: dCol, span: dSpan, segStart: ds, lane: dLane, contLeft, contRight, floating: false };
    } else {
      draft = {
        col: dCol,
        span: dSpan,
        segStart: ds,
        lane: Math.min(dLane, Math.max(0, Number.isFinite(cap) ? cap - 1 : dLane)),
        contLeft,
        contRight,
        floating: true,
      };
    }
  }

  for (const occ of singleDay) placeOcc(occ);

  const overflow = Array(7).fill(0);
  const overflowLane = Array(7).fill(0);
  if (!Number.isFinite(cap)) return { chips, overflow, overflowLane, ...(draft ? { draft } : {}) };

  // Lanes each column may show: all when they fit, else one fewer (room for "+N").
  const maxLane = Array(7).fill(-1);
  for (const c of chips) for (let i = c.col; i < c.col + c.span; i++) maxLane[i] = Math.max(maxLane[i], c.lane);
  if (draft && !draft.floating) {
    for (let i = draft.col; i < draft.col + draft.span; i++) maxLane[i] = Math.max(maxLane[i], draft.lane);
  }
  const limit = maxLane.map((m) => (m + 1 <= cap ? cap : Math.max(0, cap - 1)));
  for (const c of chips) {
    for (let i = c.col; i < c.col + c.span; i++) {
      if (c.lane >= limit[i]) c.visible = false;
    }
  }
  for (const c of chips) {
    if (c.visible) continue;
    for (let i = c.col; i < c.col + c.span; i++) overflow[i]++;
  }
  for (let i = 0; i < 7; i++) {
    if (!overflow[i]) continue;
    // Put the button in the first lane of this column not used by a visible chip.
    const busy = new Set(chips.filter((c) => c.visible && c.col <= i && i < c.col + c.span).map((c) => c.lane));
    if (draft && !draft.floating && draft.col <= i && i < draft.col + draft.span) busy.add(draft.lane);
    let lane = 0;
    while (busy.has(lane)) lane++;
    overflowLane[i] = Math.min(lane, Math.max(0, cap - 1));
  }
  return { chips, overflow, overflowLane, ...(draft ? { draft } : {}) };
}
