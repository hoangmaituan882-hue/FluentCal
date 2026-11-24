import type {
  HabitKind,
  HabitLogValue,
  HabitMeta,
  HabitTimeOfDay,
  ISODate,
  Task,
} from '@/types';
import { addDays, daysInMonth, diffDays, parts, startOfWeek, weekday, WEEKDAY_SHORT, ymd } from './date';

export interface HabitIconSpec {
  key: string;
  label: string;
  defaultColor: string;
  /** 24x24 viewBox SVG paths rendered crisp white on colored emblem */
  paths: string[];
  stroke?: boolean;
}

export const HABIT_ICONS: HabitIconSpec[] = [
  {
    key: 'water',
    label: '喝水',
    defaultColor: '#0EA5E9',
    paths: ['M12 2.8C12 2.8 6 9.6 6 14a6 6 0 1 0 12 0c0-4.4-6-11.2-6-11.2Zm-1.8 12.7a2.8 2.8 0 0 1-1.6-2.5c0-.5.3-.9.8-.9s.8.4.8.9c0 .7.4 1.3 1 1.6.4.2.6.7.4 1.1-.2.4-.7.6-1.4-.2Z'],
  },
  {
    key: 'book',
    label: '阅读',
    defaultColor: '#7C3AED',
    stroke: true,
    paths: ['M4.5 5.5A2.5 2.5 0 0 1 7 3h5v16H7a2.5 2.5 0 0 0-2.5 2v-15.5Z', 'M19.5 5.5A2.5 2.5 0 0 0 17 3h-5v16h5a2.5 2.5 0 0 1 2.5 2v-15.5Z'],
  },
  {
    key: 'meditate',
    label: '冥想',
    defaultColor: '#10A37F',
    stroke: true,
    paths: ['M12 5.2a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z', 'M6.5 16.5c1.5-2.6 3.5-4.3 5.5-4.3s4 1.7 5.5 4.3', 'M4.8 18.2c2.2 0 4.4-.8 7.2-.8s5 .8 7.2.8', 'M9 13.5 6.2 15', 'M15 13.5l2.8 1.5'],
  },
  {
    key: 'dumbbell',
    label: '健身',
    defaultColor: '#E85D2A',
    stroke: true,
    paths: ['M6.5 8v8', 'M17.5 8v8', 'M4 9.8v4.4', 'M20 9.8v4.4', 'M6.5 12h11'],
  },
  {
    key: 'run',
    label: '跑步',
    defaultColor: '#16A34A',
    stroke: true,
    paths: ['M14.5 5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z', 'M8.5 11.2 12 9.5l2.8 2.4 3.2-.4', 'M12 9.5l-1.5 5 3.8 2.2-1 3.3', 'M10.5 14.5 7 17.5l-2-.4'],
  },
  {
    key: 'language',
    label: '学习',
    defaultColor: '#2563EB',
    stroke: true,
    paths: ['M4.5 6.5h9', 'M9 4.5v2', 'M6.2 6.5c.8 3.6 2.8 6.4 6 8.2', 'M11.6 6.5c-.9 3.6-3.1 6.4-6.4 8.2', 'M13.5 19.5l3-8.5 3 8.5', 'M14.5 17h4'],
  },
  {
    key: 'code',
    label: '编程',
    defaultColor: '#4F46E5',
    stroke: true,
    paths: ['M8.5 8 4.5 12l4 4', 'M15.5 8l4 4-4 4', 'M13.2 5.5 10.8 18.5'],
  },
  {
    key: 'pen',
    label: '写作',
    defaultColor: '#D97706',
    stroke: true,
    paths: ['M15.8 4.2 19.8 8.2 9 19H5v-4L15.8 4.2Z', 'M13.6 6.4l4 4'],
  },
  {
    key: 'sun',
    label: '早起',
    defaultColor: '#F59E0B',
    stroke: true,
    paths: ['M12 7.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4Z', 'M12 3.2v1.8M12 19v1.8M3.2 12H5M19 12h1.8M5.8 5.8l1.3 1.3M16.9 16.9l1.3 1.3M18.2 5.8l-1.3 1.3M7.1 16.9l-1.3 1.3'],
  },
  {
    key: 'moon',
    label: '早睡',
    defaultColor: '#4F46E5',
    paths: ['M18.6 14.9A7.4 7.4 0 0 1 9.1 5.4a7.8 7.8 0 1 0 9.5 9.5Z'],
  },
  {
    key: 'apple',
    label: '饮食',
    defaultColor: '#EF4444',
    stroke: true,
    paths: ['M12 7.5c-2.8-1.2-6 1-6 4.8 0 3.6 2.2 7.2 4.3 7.2 1 0 1.2-.6 1.7-.6s.7.6 1.7.6c2.1 0 4.3-3.6 4.3-7.2 0-3.8-3.2-6-6-4.8Z', 'M12 7.2c.2-1.8 1.4-3 3-3.2'],
  },
  {
    key: 'heart',
    label: '健康',
    defaultColor: '#EC4899',
    paths: ['M12 20.2s-7.4-4.7-7.4-10A4.4 4.4 0 0 1 12 6.9a4.4 4.4 0 0 1 7.4 3.3c0 5.3-7.4 10-7.4 10Z'],
  },
  {
    key: 'music',
    label: '音乐',
    defaultColor: '#DB2777',
    stroke: true,
    paths: ['M9.5 17.5a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0Z', 'M19 15.5a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0Z', 'M9.5 17.5V6.5l9.5-2v11'],
  },
  {
    key: 'clean',
    label: '整理',
    defaultColor: '#0D9488',
    stroke: true,
    paths: ['M12 3.5 13.7 8.8 19 10.5l-5.3 1.7L12 17.5l-1.7-5.3L5 10.5l5.3-1.7L12 3.5Z', 'M18 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z'],
  },
  {
    key: 'shield',
    label: '自律',
    defaultColor: '#0F766E',
    stroke: true,
    paths: ['M12 3.2 5 6.2v5.4c0 4.6 3 8.1 7 9.4 4-1.3 7-4.8 7-9.4V6.2l-7-3Z', 'M9.2 12.2 11.2 14.2 15.2 10'],
  },
  {
    key: 'nosugar',
    label: '戒糖',
    defaultColor: '#E11D48',
    stroke: true,
    paths: ['M7.5 8h9l-1 11.2a1.6 1.6 0 0 1-1.6 1.4h-3.8a1.6 1.6 0 0 1-1.6-1.4L7.5 8Z', 'M12 8V4.2l3.2-.8', 'M4.5 4.5 19.5 19.5'],
  },
  {
    key: 'phoneoff',
    label: '戒刷屏',
    defaultColor: '#D97706',
    stroke: true,
    paths: ['M8 4h8a1.8 1.8 0 0 1 1.8 1.8v12.4A1.8 1.8 0 0 1 16 20H8a1.8 1.8 0 0 1-1.8-1.8V5.8A1.8 1.8 0 0 1 8 4Z', 'M11 17h2', 'M4.2 4.2 19.8 19.8'],
  },
  {
    key: 'smokeoff',
    label: '克制',
    defaultColor: '#475569',
    stroke: true,
    paths: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M6.2 6.2 17.8 17.8'],
  },
];

const HABIT_ICON_MAP = new Map<string, HabitIconSpec>(HABIT_ICONS.map((x) => [x.key, x]));

export function getHabitIcon(key?: string): HabitIconSpec {
  return (key && HABIT_ICON_MAP.get(key)) || HABIT_ICONS[0];
}

export const HABIT_KIND_META: Record<HabitKind, { label: string; short: string; hint: string }> = {
  check: { label: '普通打卡', short: '打卡', hint: '完成后轻点一次即达成' },
  count: { label: '定量计数', short: '计数', hint: '支持饮水、阅读时长等目标累加' },
  quit: { label: '戒除习惯', short: '戒除', hint: '正向累计坚持天数，破戒轻记不清空' },
};

export const HABIT_TIME_META: Record<HabitTimeOfDay, { label: string }> = {
  anytime: { label: '全天' },
  morning: { label: '早晨' },
  afternoon: { label: '下午' },
  evening: { label: '晚间' },
};

export const HABIT_TIME_ORDER: HabitTimeOfDay[] = ['anytime', 'morning', 'afternoon', 'evening'];

export const HABIT_COLOR_SWATCHES = [
  '#0EA5E9',
  '#10A37F',
  '#7C3AED',
  '#E85D2A',
  '#E11D48',
  '#2563EB',
  '#16A34A',
  '#D97706',
  '#EC4899',
  '#4F46E5',
] as const;

export interface HabitPreset {
  key: string;
  title: string;
  kind: HabitKind;
  target: number;
  step?: number;
  unit?: string;
  weeklyTarget: number;
  timeOfDay: HabitTimeOfDay;
  iconKey: string;
  color: string;
}

export const HABIT_PRESETS: HabitPreset[] = [
  { key: 'water', title: '喝水 8 杯', kind: 'count', target: 8, step: 1, unit: '杯', weeklyTarget: 7, timeOfDay: 'anytime', iconKey: 'water', color: '#0EA5E9' },
  { key: 'read', title: '阅读 30 分钟', kind: 'count', target: 30, step: 10, unit: '分钟', weeklyTarget: 7, timeOfDay: 'evening', iconKey: 'book', color: '#7C3AED' },
  { key: 'meditate', title: '冥想 10 分钟', kind: 'check', target: 1, weeklyTarget: 7, timeOfDay: 'morning', iconKey: 'meditate', color: '#10A37F' },
  { key: 'workout', title: '力量训练', kind: 'check', target: 1, weeklyTarget: 4, timeOfDay: 'afternoon', iconKey: 'dumbbell', color: '#E85D2A' },
  { key: 'words', title: '背单词 30 个', kind: 'count', target: 30, step: 10, unit: '个', weeklyTarget: 6, timeOfDay: 'morning', iconKey: 'language', color: '#2563EB' },
  { key: 'sleep', title: '早睡不熬夜', kind: 'quit', target: 1, weeklyTarget: 7, timeOfDay: 'evening', iconKey: 'moon', color: '#4F46E5' },
  { key: 'nosugar', title: '戒含糖饮料', kind: 'quit', target: 1, weeklyTarget: 7, timeOfDay: 'anytime', iconKey: 'nosugar', color: '#E11D48' },
  { key: 'phoneoff', title: '少刷短视频', kind: 'quit', target: 1, weeklyTarget: 7, timeOfDay: 'evening', iconKey: 'phoneoff', color: '#D97706' },
  { key: 'walk', title: '每日快走', kind: 'count', target: 6000, step: 1000, unit: '步', weeklyTarget: 5, timeOfDay: 'afternoon', iconKey: 'run', color: '#16A34A' },
  { key: 'stretch', title: '早起拉伸', kind: 'check', target: 1, weeklyTarget: 7, timeOfDay: 'morning', iconKey: 'sun', color: '#EC4899' },
];

export function isHabitTask(t: Task): t is Task & { habit: HabitMeta } {
  return !!t.habitOnly && !!t.habit;
}

export type HabitDayState = 'done' | 'partial' | 'skip' | 'relapse' | 'empty' | 'future';

export interface HabitDayStatus {
  iso: ISODate;
  state: HabitDayState;
  value: number;
  ratio: number;
  /** 0 = empty, 1..4 = tonal fill intensity (HabitKit 4-step ramp) */
  level: 0 | 1 | 2 | 3 | 4;
}

/** Evaluates a habit's completion status on a given calendar day `iso`. */
export function evaluateHabitDay(
  habit: HabitMeta,
  startDate: ISODate,
  iso: ISODate,
  refToday: ISODate,
): HabitDayStatus {
  if (iso > refToday) {
    return { iso, state: 'future', value: 0, ratio: 0, level: 0 };
  }
  const raw = habit.logs?.[iso];
  if (raw === 'skip') {
    return { iso, state: 'skip', value: 0, ratio: 0, level: 0 };
  }

  if (habit.kind === 'quit') {
    if (iso < startDate && raw === undefined) {
      return { iso, state: 'empty', value: 0, ratio: 0, level: 0 };
    }
    if (raw === 'relapse') {
      return { iso, state: 'relapse', value: 0, ratio: 0, level: 0 };
    }
    // Every clean day on or after startDate up to refToday counts positively
    if (iso >= startDate || (typeof raw === 'number' && raw > 0)) {
      return { iso, state: 'done', value: 1, ratio: 1, level: 4 };
    }
    return { iso, state: 'empty', value: 0, ratio: 0, level: 0 };
  }

  const num = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
  const target = Math.max(1, habit.target || 1);

  if (habit.kind === 'check') {
    if (num >= 1) return { iso, state: 'done', value: 1, ratio: 1, level: 4 };
    return { iso, state: 'empty', value: 0, ratio: 0, level: 0 };
  }

  // Quantitative count habit
  if (num <= 0) return { iso, state: 'empty', value: 0, ratio: 0, level: 0 };
  const ratio = Math.min(1, num / target);
  if (ratio >= 1) return { iso, state: 'done', value: num, ratio: 1, level: 4 };
  const level: 1 | 2 | 3 = ratio >= 0.67 ? 3 : ratio >= 0.34 ? 2 : 1;
  return { iso, state: 'partial', value: num, ratio, level };
}

/**
 * Loop Habit Tracker-inspired Exponential Smoothing Habit Strength (0..100).
 * Anti-guilt by design: a single missed day gently dips the score instead of resetting months of progress to 0,
 * rest ('skip') days never penalize strength, and elastic weekly targets (e.g. 3x/week) evaluate smoothly.
 */
export function computeHabitStrength(
  habit: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
): number {
  const windowStart = addDays(refToday, -89);
  const firstDay = startDate > windowStart && startDate <= refToday ? startDate : windowStart;
  const freq = Math.max(1, Math.min(7, habit.weeklyTarget || 7)) / 7;
  const multiplier = Math.pow(0.5, Math.sqrt(freq) / 13);

  let score = 0;
  let cur = firstDay;
  // Rolling 7-day completion buffer for elastic weekly targets (< 7 days/week)
  const recent7: number[] = [];

  while (cur <= refToday) {
    const st = evaluateHabitDay(habit, startDate, cur, refToday);
    if (st.state === 'skip') {
      cur = addDays(cur, 1);
      continue;
    }

    const dayVal = st.state === 'done' ? 1 : st.state === 'partial' ? st.ratio : 0;
    recent7.push(dayVal);
    if (recent7.length > 7) recent7.shift();

    let effectiveDayVal = dayVal;
    if (habit.weeklyTarget < 7 && habit.kind !== 'quit') {
      const weekSum = recent7.reduce((a, b) => a + b, 0);
      const quotaRatio = Math.min(1, weekSum / Math.max(1, habit.weeklyTarget));
      effectiveDayVal = Math.max(dayVal, quotaRatio);
    }

    score = score * multiplier + effectiveDayVal * (1 - multiplier);
    cur = addDays(cur, 1);
  }

  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

/** Current consecutive days (skip-friendly; does not drop to 0 if today isn't logged yet). */
export function computeCurrentStreak(
  habit: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
): number {
  const todaySt = evaluateHabitDay(habit, startDate, refToday, refToday);
  let cur =
    todaySt.state === 'done' || todaySt.state === 'skip'
      ? refToday
      : todaySt.state === 'relapse'
        ? ''
        : addDays(refToday, -1);
  if (!cur) return 0;

  let streak = 0;
  let guard = 0;
  while (cur >= startDate && guard < 366) {
    const st = evaluateHabitDay(habit, startDate, cur, refToday);
    if (st.state === 'done') {
      streak++;
    } else if (st.state === 'skip') {
      // Planned rest day preserves streak cleanly
    } else {
      break;
    }
    cur = addDays(cur, -1);
    guard++;
  }
  return streak;
}

/** Longest streak within the last 365 days. */
export function computeBestStreak(
  habit: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
): number {
  const limitStart = addDays(refToday, -364);
  let cur = startDate > limitStart && startDate <= refToday ? startDate : limitStart;
  let best = 0;
  let run = 0;
  let guard = 0;
  while (cur <= refToday && guard < 366) {
    const st = evaluateHabitDay(habit, startDate, cur, refToday);
    if (st.state === 'done') {
      run++;
      if (run > best) best = run;
    } else if (st.state !== 'skip') {
      run = 0;
    }
    cur = addDays(cur, 1);
    guard++;
  }
  return best;
}

/** Current week completion progress relative to `weeklyTarget`. */
export function computeWeekProgress(
  habit: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
  weekStart: 0 | 1 = 1,
): { done: number; target: number; met: boolean } {
  const wkStart = startOfWeek(refToday, weekStart);
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(wkStart, i);
    if (d > refToday) break;
    const st = evaluateHabitDay(habit, startDate, d, refToday);
    if (st.state === 'done') done++;
  }
  const target = Math.max(1, Math.min(7, habit.weeklyTarget || 7));
  return { done, target, met: done >= target };
}

export interface HabitHeatmapCell extends HabitDayStatus {
  isToday: boolean;
}

/**
 * Builds a HabitKit / GitHub-style column-major heatmap grid (`weeks` columns × 7 weekday rows)
 * aligned to `weekStart` (Monday=1 or Sunday=0) ending at the week containing `refToday`.
 */
export function buildHabitHeatmap(
  habit: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
  weeks = 14,
  weekStart: 0 | 1 = 1,
): HabitHeatmapCell[][] {
  const curWkStart = startOfWeek(refToday, weekStart);
  const firstWkStart = addDays(curWkStart, -(weeks - 1) * 7);
  const cols: HabitHeatmapCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HabitHeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = addDays(firstWkStart, w * 7 + d);
      const st = evaluateHabitDay(habit, startDate, iso, refToday);
      col.push({ ...st, isToday: iso === refToday });
    }
    cols.push(col);
  }
  return cols;
}

/** Builds a monthly calendar cell list for the Detail Backfill calendar. */
export function buildHabitMonthCells(
  habit: HabitMeta,
  startDate: ISODate,
  year: number,
  month: number,
  refToday: ISODate,
  weekStart: 0 | 1 = 1,
): Array<{ key: string; day: number | null; status: HabitDayStatus | null; isToday: boolean }> {
  const firstIso = ymd(year, month, 1);
  const offset = (weekday(firstIso) - weekStart + 7) % 7;
  const total = daysInMonth(year, month);
  const out: Array<{ key: string; day: number | null; status: HabitDayStatus | null; isToday: boolean }> = [];
  for (let i = 0; i < offset; i++) {
    out.push({ key: `pad-${i}`, day: null, status: null, isToday: false });
  }
  for (let d = 1; d <= total; d++) {
    const iso = ymd(year, month, d);
    out.push({
      key: iso,
      day: d,
      status: evaluateHabitDay(habit, startDate, iso, refToday),
      isToday: iso === refToday,
    });
  }
  return out;
}

export interface ResolvedHabit {
  task: Task & { habit: HabitMeta };
  meta: HabitMeta;
  icon: HabitIconSpec;
  day: HabitDayStatus;
  strength: number;
  currentStreak: number;
  bestStreak: number;
  week: { done: number; target: number; met: boolean };
  totalDoneDays: number;
}

export function resolveHabit(
  task: Task & { habit: HabitMeta },
  selectedIso: ISODate,
  refToday: ISODate,
  weekStart: 0 | 1 = 1,
): ResolvedHabit {
  const meta = task.habit;
  const icon = getHabitIcon(meta.iconKey);
  const day = evaluateHabitDay(meta, task.start, selectedIso, refToday);
  const strength = computeHabitStrength(meta, task.start, refToday);
  const currentStreak = computeCurrentStreak(meta, task.start, refToday);
  const bestStreak = computeBestStreak(meta, task.start, refToday);
  const week = computeWeekProgress(meta, task.start, selectedIso, weekStart);

  let totalDoneDays = 0;
  if (meta.kind === 'quit') {
    const span = Math.max(0, diffDays(task.start, refToday) + 1);
    let nonClean = 0;
    for (const [iso, v] of Object.entries(meta.logs ?? {})) {
      if (iso >= task.start && iso <= refToday && (v === 'relapse' || v === 'skip')) {
        nonClean++;
      }
    }
    totalDoneDays = Math.max(0, span - nonClean);
  } else {
    const target = Math.max(1, meta.target || 1);
    for (const v of Object.values(meta.logs ?? {})) {
      if (typeof v === 'number' && v >= (meta.kind === 'check' ? 1 : target)) totalDoneDays++;
    }
  }

  return {
    task,
    meta,
    icon,
    day,
    strength,
    currentStreak,
    bestStreak,
    week,
    totalDoneDays,
  };
}

// ── Pure Mutation Helpers ───────────────────────────────────────────────────

export function toggleCheckHabit(meta: HabitMeta, iso: ISODate): HabitMeta {
  const nextLogs: Record<ISODate, HabitLogValue> = { ...(meta.logs ?? {}) };
  if (typeof nextLogs[iso] === 'number' && (nextLogs[iso] as number) >= 1) {
    delete nextLogs[iso];
  } else {
    nextLogs[iso] = 1;
  }
  return { ...meta, logs: nextLogs };
}

export function stepCountHabit(meta: HabitMeta, iso: ISODate, delta?: number): HabitMeta {
  const step = delta ?? Math.max(1, meta.step ?? 1);
  const nextLogs: Record<ISODate, HabitLogValue> = { ...(meta.logs ?? {}) };
  const cur = typeof nextLogs[iso] === 'number' ? (nextLogs[iso] as number) : 0;
  const next = Math.max(0, Math.round((cur + step) * 100) / 100);
  if (next <= 0) {
    delete nextLogs[iso];
  } else {
    nextLogs[iso] = next;
  }
  return { ...meta, logs: nextLogs };
}

export function toggleQuitRelapse(meta: HabitMeta, iso: ISODate): HabitMeta {
  const nextLogs: Record<ISODate, HabitLogValue> = { ...(meta.logs ?? {}) };
  if (nextLogs[iso] === 'relapse') {
    delete nextLogs[iso];
  } else {
    nextLogs[iso] = 'relapse';
  }
  return { ...meta, logs: nextLogs };
}

export function toggleSkipHabit(meta: HabitMeta, iso: ISODate): HabitMeta {
  const nextLogs: Record<ISODate, HabitLogValue> = { ...(meta.logs ?? {}) };
  if (nextLogs[iso] === 'skip') {
    delete nextLogs[iso];
  } else {
    nextLogs[iso] = 'skip';
  }
  return { ...meta, logs: nextLogs };
}

/** Formats a concise human label for a habit's progress on a given day. */
export function formatHabitDayProgress(meta: HabitMeta, st: HabitDayStatus): string {
  if (st.state === 'skip') return '已请假跳过';
  if (meta.kind === 'quit') {
    return st.state === 'relapse' ? '今日已记破戒' : '今日稳住';
  }
  if (meta.kind === 'check') {
    return st.state === 'done' ? '今日已完成' : '待打卡';
  }
  const u = meta.unit?.trim() || '';
  return `${st.value}/${meta.target}${u ? ` ${u}` : ''}`;
}

/** Builds realistic 10-week starter sample habits across Check, Count & Quit types for instant tryout. */
export function sampleHabitPayloads(refToday: ISODate): Array<Partial<Task> & { title: string; start: ISODate }> {
  const start = addDays(refToday, -68);

  const makeCheckLogs = (pattern: number[], skipOffsets: number[] = []): Record<ISODate, HabitLogValue> => {
    const logs: Record<ISODate, HabitLogValue> = {};
    for (let i = 68; i >= 1; i--) {
      const iso = addDays(refToday, -i);
      if (skipOffsets.includes(i)) {
        logs[iso] = 'skip';
      } else if (pattern[i % pattern.length] === 1) {
        logs[iso] = 1;
      }
    }
    return logs;
  };

  const makeCountLogs = (target: number, pattern: number[], todayVal: number): Record<ISODate, HabitLogValue> => {
    const logs: Record<ISODate, HabitLogValue> = {};
    for (let i = 68; i >= 1; i--) {
      const iso = addDays(refToday, -i);
      const frac = pattern[i % pattern.length];
      if (frac > 0) logs[iso] = Math.round(target * frac);
    }
    if (todayVal > 0) logs[refToday] = todayVal;
    return logs;
  };

  const waterLogs = makeCountLogs(8, [1, 1, 0.75, 1, 1, 0.5, 1, 1, 0, 1, 1, 1, 0.875], 5);
  const readLogs = makeCountLogs(30, [1, 1, 0.67, 1, 0, 1, 1, 1, 0.33, 1, 1], 20);
  const meditateLogs = makeCheckLogs([1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1], [14, 33]);
  meditateLogs[refToday] = 1;
  const workoutLogs = makeCheckLogs([1, 0, 1, 0, 1, 1, 0], [19]);
  const quitLogs: Record<ISODate, HabitLogValue> = {
    [addDays(refToday, -16)]: 'relapse',
    [addDays(refToday, -41)]: 'relapse',
  };

  return [
    {
      title: '喝水 8 杯',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'count',
        target: 8,
        step: 1,
        unit: '杯',
        weeklyTarget: 7,
        timeOfDay: 'anytime',
        iconKey: 'water',
        color: '#0EA5E9',
        logs: waterLogs,
      },
    },
    {
      title: '阅读 30 分钟',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'count',
        target: 30,
        step: 10,
        unit: '分钟',
        weeklyTarget: 7,
        timeOfDay: 'evening',
        iconKey: 'book',
        color: '#7C3AED',
        logs: readLogs,
      },
    },
    {
      title: '冥想 10 分钟',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'check',
        target: 1,
        weeklyTarget: 7,
        timeOfDay: 'morning',
        iconKey: 'meditate',
        color: '#10A37F',
        logs: meditateLogs,
      },
    },
    {
      title: '力量训练',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'check',
        target: 1,
        weeklyTarget: 4,
        timeOfDay: 'afternoon',
        iconKey: 'dumbbell',
        color: '#E85D2A',
        logs: workoutLogs,
      },
    },
    {
      title: '早睡不熬夜',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'quit',
        target: 1,
        weeklyTarget: 7,
        timeOfDay: 'evening',
        iconKey: 'moon',
        color: '#4F46E5',
        logs: quitLogs,
      },
    },
  ];
}

export function formatHabitShortDate(iso: ISODate): string {
  const [, m, d] = parts(iso);
  return `${m}月${d}日`;
}

export function formatHabitDateWithWeekday(iso: ISODate): string {
  const [, m, d] = parts(iso);
  return `${m}月${d}日 周${WEEKDAY_SHORT[weekday(iso)]}`;
}

const HABIT_ICON_KEYWORDS: Array<{ key: string; re: RegExp }> = [
  { key: 'nosugar', re: /戒糖|含糖|奶茶|可乐|甜食|饮料|糖分|soda|sugar/i },
  { key: 'phoneoff', re: /短视频|刷手机|抖音|小红书|戒网|少刷|屏幕|phone|scroll|social/i },
  { key: 'smokeoff', re: /戒烟|戒酒|抽烟|喝酒|咖啡因|熬夜游戏|smoke|alcohol/i },
  { key: 'water', re: /喝水|饮水|白开水|补水|水杯|water|hydrat/i },
  { key: 'book', re: /阅读|读书|看书|书籍|kindle|read|book/i },
  { key: 'meditate', re: /冥想|正念|深呼吸|静坐|放空|meditat|mindful|breath/i },
  { key: 'dumbbell', re: /健身|力量|撸铁|举铁|俯卧撑|引体|核心|平板支撑|锻炼|workout|gym|lift/i },
  { key: 'run', re: /跑步|快走|散步|步数|骑行|游泳|跳绳|有氧|运动|run|walk|jog|cycle/i },
  { key: 'language', re: /单词|英语|日语|外语|背诵|学习|听力|口语|考研|study|vocab|english|anki/i },
  { key: 'code', re: /编程|代码|刷题|算法|leetcode|github|commit|code|dev/i },
  { key: 'pen', re: /写作|日记|复盘|笔记|总结|手账|练字|write|journal|diary/i },
  { key: 'sun', re: /早起|晨练|拉伸|晒太阳|清晨|wake|morning|stretch/i },
  { key: 'moon', re: /早睡|熬夜|睡眠|入睡|午休|关灯|sleep|bed/i },
  { key: 'apple', re: /饮食|早餐|蔬菜|水果|轻食|减脂|沙拉|控卡|eat|diet|fruit|breakfast/i },
  { key: 'heart', re: /健康|维生素|吃药|护眼|护肤|防晒|牙线|刷牙|health|vitamin|skin/i },
  { key: 'music', re: /音乐|钢琴|吉他|练琴|唱歌|播客|music|piano|guitar/i },
  { key: 'clean', re: /整理|收纳|打扫|断舍离|桌面|家务|clean|tidy/i },
  { key: 'shield', re: /自律|克制|戒除|专注|戒|quit|focus|discipline/i },
];

/** Magic auto-matcher: infers the best matching geometric icon & color as the user types a habit title. */
export function guessHabitIcon(title: string): HabitIconSpec | null {
  const clean = title.trim();
  if (!clean) return null;
  for (const rule of HABIT_ICON_KEYWORDS) {
    if (rule.re.test(clean)) {
      return getHabitIcon(rule.key);
    }
  }
  return null;
}

/** Extracts clean month tick positions aligned to the column indices of a HabitKit contribution heatmap. */
export function extractHeatmapMonthTicks(grid: HabitHeatmapCell[][]): Array<{ col: number; label: string }> {
  const ticks: Array<{ col: number; label: string }> = [];
  let prevMonth = -1;
  let lastCol = -99;
  for (let c = 0; c < grid.length; c++) {
    const col = grid[c];
    if (!col?.length) continue;
    // Prefer the month of the first day of the week column, or a 1st-of-month inside that week
    const firstOfMonth = col.find((cell) => parts(cell.iso)[2] === 1);
    const refIso = firstOfMonth ? firstOfMonth.iso : col[0].iso;
    const month = parts(refIso)[1];
    if (month !== prevMonth) {
      if (c - lastCol >= 3) {
        ticks.push({ col: c, label: `${month}月` });
        lastCol = c;
      } else if (ticks.length > 0 && c <= 2) {
        // Replace initial partial month tick if a new month starts right at column 1-2
        ticks[ticks.length - 1] = { col: c, label: `${month}月` };
        lastCol = c;
      }
      prevMonth = month;
    }
  }
  return ticks;
}

export interface HabitWeekdayStat {
  wd: number;
  label: string;
  rate: number;
  done: number;
  total: number;
}

/** Computes Loop-style Mon-Sun weekday consistency rates across the last 12 weeks (84 days). */
export function computeHabitWeekdayRates(
  meta: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
  weekStart: 0 | 1 = 1,
): HabitWeekdayStat[] {
  const windowStart = addDays(refToday, -83);
  const effectiveStart = startDate > windowStart ? startDate : windowStart;
  const doneByWd = new Array<number>(7).fill(0);
  const totalByWd = new Array<number>(7).fill(0);

  if (effectiveStart <= refToday) {
    const span = diffDays(effectiveStart, refToday);
    for (let i = 0; i <= span; i++) {
      const iso = addDays(effectiveStart, i);
      const st = evaluateHabitDay(meta, startDate, iso, refToday);
      if (st.state === 'skip' || st.state === 'future') continue;
      const w = weekday(iso);
      totalByWd[w]++;
      if (st.state === 'done') doneByWd[w]++;
    }
  }

  return Array.from({ length: 7 }, (_, i) => {
    const wd = (weekStart + i) % 7;
    const total = totalByWd[wd];
    const done = doneByWd[wd];
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      wd,
      label: WEEKDAY_SHORT[wd],
      rate,
      done,
      total,
    };
  });
}

export const HABIT_MILESTONES = [7, 14, 21, 30, 50, 66, 100, 180, 365] as const;

export function getHabitMilestone(streak: number): number | null {
  return (HABIT_MILESTONES as readonly number[]).includes(streak) ? streak : null;
}
