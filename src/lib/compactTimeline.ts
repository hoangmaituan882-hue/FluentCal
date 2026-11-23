import type { ISODate } from '@/types';
import { addDays, formatFriendly, parts, startOfWeek, weekday, WEEKDAY_SHORT } from '@/lib/date';
import {
  clampMinutes,
  DAY_MINUTES,
  DEFAULT_DURATION,
  formatRangeLabel,
  layoutDayEvents,
  MIN_DURATION,
  parseTimeMin,
} from '@/lib/dayLayout';
import type { Occurrence } from '@/lib/recur';

export const ZOOM_DAY_STEPS = [1, 2, 3, 4, 5, 7] as const;
export type ZoomDays = (typeof ZOOM_DAY_STEPS)[number];

export const DESKTOP_MULTIDAY_STEPS = [2, 3, 4, 5, 7] as const;
export type DesktopMultiDays = (typeof DESKTOP_MULTIDAY_STEPS)[number];

export const MIN_HOUR_H = 26;
export const MAX_HOUR_H = 84;
export const DEFAULT_HOUR_H = 58;

export function stepZoomDays(current: ZoomDays, delta: 1 | -1): ZoomDays {
  const idx = ZOOM_DAY_STEPS.indexOf(current);
  const next = Math.max(0, Math.min(ZOOM_DAY_STEPS.length - 1, (idx === -1 ? 0 : idx) + delta));
  return ZOOM_DAY_STEPS[next];
}

export function stepDesktopMultiDays(current: DesktopMultiDays, delta: 1 | -1): DesktopMultiDays {
  const idx = DESKTOP_MULTIDAY_STEPS.indexOf(current);
  const next = Math.max(0, Math.min(DESKTOP_MULTIDAY_STEPS.length - 1, (idx === -1 ? 3 : idx) + delta));
  return DESKTOP_MULTIDAY_STEPS[next];
}

export function formatCompactDateLabel(
  date: ISODate,
  daysCount: ZoomDays,
  todayIso: ISODate,
): { primary: string; secondary?: string; stacked: boolean } {
  const [, m, d] = parts(date);
  const wd = WEEKDAY_SHORT[weekday(date)];
  if (daysCount === 1) return { primary: formatFriendly(date, todayIso), stacked: false };
  if (daysCount === 2) return { primary: `${m}/${d} 周${wd}`, stacked: false };
  if (daysCount === 3) return { primary: `周${wd} ${d}`, stacked: false };
  return { primary: String(d), secondary: daysCount === 7 ? wd : `周${wd}`, stacked: true };
}

export function clusterColors(items: Pick<CompactEventInput, 'color'>[], max = 3): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.color && !out.includes(item.color)) out.push(item.color);
    if (out.length >= max) break;
  }
  return out;
}

export function visibleDatesForSpan(anchor: ISODate, daysCount: ZoomDays, weekStart: 0 | 1): ISODate[] {
  if (daysCount === 1) return [anchor];
  if (daysCount === 7) {
    const start = startOfWeek(anchor, weekStart);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const offset = daysCount >= 4 ? -1 : 0;
  const start = addDays(anchor, offset);
  return Array.from({ length: daysCount }, (_, i) => addDays(start, i));
}

export interface CompactEventInput {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  color: string;
  done: boolean;
  order: number;
}

export type CompactRenderedBlock =
  | {
      kind: 'single';
      id: string;
      item: CompactEventInput;
      startMin: number;
      endMin: number;
      col: number;
      colCount: number;
    }
  | {
      kind: 'cluster';
      id: string;
      items: CompactEventInput[];
      count: number;
      startMin: number;
      endMin: number;
      col: number;
      colCount: number;
    };

/**
 * Computes day column blocks for compact/multi-day zoom levels.
 * At high vertical/horizontal zoom (`hourHeight >= 42 && daysCount <= 3`), returns individual
 * side-by-side events; when zoomed out vertically or across 4–7 days, tightly packed/overlapping
 * runs automatically fold into clean `"N 项日程"` summary clusters that expand on tap.
 */
export function clusterDayEvents(
  items: CompactEventInput[],
  hourHeight: number,
  daysCount: ZoomDays,
): CompactRenderedBlock[] {
  if (!items.length) return [];

  const normalized = items.map((x) => {
    const startMin = clampMinutes(Math.round(x.startMin), 0, DAY_MINUTES - MIN_DURATION);
    const endMin = clampMinutes(Math.max(startMin + MIN_DURATION, Math.round(x.endMin)), startMin + MIN_DURATION, DAY_MINUTES);
    return { ...x, startMin, endMin };
  });

  if (hourHeight >= 42 && daysCount <= 3) {
    const byId = new Map(normalized.map((x) => [x.id, x]));
    const laid = layoutDayEvents(normalized.map((x) => ({ id: x.id, startMin: x.startMin, endMin: x.endMin, order: x.order })));
    return laid.map((l) => {
      const item = byId.get(l.id)!;
      return {
        kind: 'single',
        id: item.id,
        item,
        startMin: l.startMin,
        endMin: l.endMin,
        col: l.col,
        colCount: l.colCount,
      };
    });
  }

  const sorted = [...normalized].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.order - b.order || a.id.localeCompare(b.id),
  );
  const gapThreshold = hourHeight < 34 ? 15 : 0;

  const groups: CompactEventInput[][] = [];
  let cur: CompactEventInput[] = [];
  let curMaxEnd = -1;

  for (const item of sorted) {
    if (!cur.length || item.startMin <= curMaxEnd + gapThreshold) {
      cur.push(item);
      if (item.endMin > curMaxEnd) curMaxEnd = item.endMin;
    } else {
      groups.push(cur);
      cur = [item];
      curMaxEnd = item.endMin;
    }
  }
  if (cur.length) groups.push(cur);

  const out: CompactRenderedBlock[] = [];
  for (const g of groups) {
    if (g.length === 1) {
      const only = g[0];
      out.push({
        kind: 'single',
        id: only.id,
        item: only,
        startMin: only.startMin,
        endMin: only.endMin,
        col: 0,
        colCount: 1,
      });
    } else {
      const startMin = Math.min(...g.map((x) => x.startMin));
      const endMin = Math.max(...g.map((x) => x.endMin));
      out.push({
        kind: 'cluster',
        id: `cluster:${g.map((x) => x.id).join('+')}`,
        items: g,
        count: g.length,
        startMin,
        endMin,
        col: 0,
        colCount: 1,
      });
    }
  }
  return out;
}

export interface NowStatusInfo {
  state: 'now' | 'next' | 'allday' | 'idle';
  prefix: string;
  title: string;
  timeHint: string;
  occ: Occurrence | null;
}

function durationMinutes(occ: Occurrence): number {
  const raw = occ.task.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(DAY_MINUTES, Math.max(MIN_DURATION, Math.round(raw)));
  }
  return DEFAULT_DURATION;
}

export function findNowOrNext(todayOccs: Occurrence[], nowMin: number): NowStatusInfo {
  const undoneTimed = todayOccs
    .filter((o) => !o.done && !!o.task.time)
    .map((occ) => {
      const startMin = parseTimeMin(occ.task.time);
      const endMin = Math.min(DAY_MINUTES, startMin + durationMinutes(occ));
      return { occ, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || a.occ.task.order - b.occ.task.order);

  const active = undoneTimed.find((x) => x.startMin <= nowMin && nowMin < x.endMin);
  if (active) {
    return {
      state: 'now',
      prefix: '进行中',
      title: active.occ.task.title,
      timeHint: formatRangeLabel(active.startMin, active.endMin),
      occ: active.occ,
    };
  }

  const upcoming = undoneTimed.find((x) => x.startMin > nowMin);
  if (upcoming) {
    return {
      state: 'next',
      prefix: '接下来',
      title: upcoming.occ.task.title,
      timeHint: upcoming.occ.task.time!,
      occ: upcoming.occ,
    };
  }

  const undoneAllDay = todayOccs
    .filter((o) => !o.done && !o.task.time)
    .sort((a, b) => a.task.order - b.task.order);
  if (undoneAllDay.length) {
    return {
      state: 'allday',
      prefix: '今日待办',
      title: undoneAllDay[0].task.title,
      timeHint: `${undoneAllDay.length} 项`,
      occ: undoneAllDay[0],
    };
  }

  return {
    state: 'idle',
    prefix: '今日日程已清空',
    title: '',
    timeHint: '',
    occ: null,
  };
}
