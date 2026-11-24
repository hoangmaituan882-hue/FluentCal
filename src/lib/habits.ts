import type {
  HabitKind,
  HabitLogValue,
  HabitMeta,
  HabitTimeOfDay,
  HabitWidgetStyle,
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

export interface HabitWidgetStyleSpec {
  key: HabitWidgetStyle;
  label: string;
  short: string;
  tagline: string;
  desc: string;
}

export const HABIT_WIDGET_STYLES: HabitWidgetStyleSpec[] = [
  { key: 'window', label: '时段倒计时', short: '时段', tagline: '24h 实时窗口', desc: '固定窗口实时距开始/剩余倒计时与 24h 光带' },
  { key: 'spectrum', label: '光谱刻度', short: '光谱', tagline: '20 格渐彩频谱', desc: '20 竖条渐彩强度频谱（Apple Health 风格）' },
  { key: 'gauge', label: '仪表标尺', short: '仪表', tagline: '双弧 + 游标尺', desc: '双弧仪表盘 + 精密刻度游标尺' },
  { key: 'bars', label: '基准横条', short: '横条', tagline: '4 日目标对比', desc: '近 4 日横向对比条 + 目标基准斜纹区' },
  { key: 'rings', label: '七日圆环', short: '圆环', tagline: '点环直接打卡', desc: '交错七日圆环表盘，点圆环直接打卡' },
  { key: 'pillars', label: '周度柱阵', short: '柱阵', tagline: '4 周液柱达成', desc: '近 4 周液态柱状达成率对比' },
  { key: 'journey', label: '里程轨迹', short: '轨迹', tagline: '连胜站点轨道', desc: '站点式连续天数与下一里程碑轨道' },
  { key: 'heatmap', label: '热力矩阵', short: '热力', tagline: '16 周贡献格', desc: '16 周 GitHub 风格贡献热力方块' },
];

const HABIT_WIDGET_STYLE_MAP = new Map<HabitWidgetStyle, HabitWidgetStyleSpec>(
  HABIT_WIDGET_STYLES.map((s) => [s.key, s]),
);

export function getHabitWidgetStyleSpec(style: HabitWidgetStyle): HabitWidgetStyleSpec {
  return HABIT_WIDGET_STYLE_MAP.get(style) ?? HABIT_WIDGET_STYLES[0];
}

/** Cycle smoothly through all 8 macOS widget styles (used by keyboard W or Alt+Click). */
export function nextHabitWidgetStyle(current: HabitWidgetStyle, step = 1): HabitWidgetStyle {
  const len = HABIT_WIDGET_STYLES.length;
  const idx = HABIT_WIDGET_STYLES.findIndex((s) => s.key === current);
  const base = idx < 0 ? 0 : idx;
  return HABIT_WIDGET_STYLES[((base + step) % len + len) % len].key;
}

/** Smart macOS widget default matched to habit semantics (non-heatmap by default for visual variety). */
export function defaultWidgetStyleForHabit(
  meta: Pick<HabitMeta, 'kind' | 'weeklyTarget' | 'iconKey' | 'windowStart'>,
): HabitWidgetStyle {
  if (meta.kind === 'quit') return 'journey';
  if (meta.windowStart && meta.kind === 'check') return 'window';
  if (meta.kind === 'count') {
    if (meta.iconKey === 'water' || meta.iconKey === 'apple') {
      return 'gauge';
    }
    if (meta.iconKey === 'heart' || meta.iconKey === 'sun' || meta.iconKey === 'clean' || meta.iconKey === 'run') {
      return 'spectrum';
    }
    return 'bars';
  }
  return meta.weeklyTarget < 7 ? 'pillars' : 'rings';
}

export function resolveHabitWidgetStyle(meta: HabitMeta): HabitWidgetStyle {
  if (meta.widgetStyle && HABIT_WIDGET_STYLE_MAP.has(meta.widgetStyle)) {
    return meta.widgetStyle;
  }
  return defaultWidgetStyleForHabit(meta);
}

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
  windowStart?: string;
  windowEnd?: string;
  widgetStyle?: HabitWidgetStyle;
  iconKey: string;
  color: string;
}

/** Curated, lifestyle-editorial presets (refined routines instead of bland generic labels). */
export const HABIT_PRESETS: HabitPreset[] = [
  { key: 'breath', title: '晨间正念呼吸', kind: 'check', target: 1, weeklyTarget: 7, timeOfDay: 'morning', windowStart: '07:15', windowEnd: '08:00', widgetStyle: 'window', iconKey: 'meditate', color: '#10A37F' },
  { key: 'eyes', title: '20-20-20 护眼远眺', kind: 'count', target: 6, step: 1, unit: '次', weeklyTarget: 7, timeOfDay: 'anytime', widgetStyle: 'spectrum', iconKey: 'heart', color: '#EC4899' },
  { key: 'water', title: '晨光补水 8 杯', kind: 'count', target: 8, step: 1, unit: '杯', weeklyTarget: 7, timeOfDay: 'anytime', widgetStyle: 'gauge', iconKey: 'water', color: '#0EA5E9' },
  { key: 'read', title: '深度纸质阅读', kind: 'count', target: 30, step: 10, unit: '分钟', weeklyTarget: 7, timeOfDay: 'evening', windowStart: '21:30', windowEnd: '22:30', widgetStyle: 'bars', iconKey: 'book', color: '#7C3AED' },
  { key: 'sunset', title: '日落散步放空', kind: 'check', target: 1, weeklyTarget: 7, timeOfDay: 'afternoon', windowStart: '17:30', windowEnd: '18:45', widgetStyle: 'rings', iconKey: 'sun', color: '#F59E0B' },
  { key: 'workout', title: '力量与核心训练', kind: 'check', target: 1, weeklyTarget: 4, timeOfDay: 'afternoon', windowStart: '18:00', windowEnd: '19:30', widgetStyle: 'pillars', iconKey: 'dumbbell', color: '#E85D2A' },
  { key: 'sleep', title: '23:00 零蓝光早睡', kind: 'quit', target: 1, weeklyTarget: 7, timeOfDay: 'evening', windowStart: '23:00', windowEnd: '23:45', widgetStyle: 'journey', iconKey: 'moon', color: '#4F46E5' },
  { key: 'review', title: '睡前 3 行复盘', kind: 'check', target: 1, weeklyTarget: 7, timeOfDay: 'evening', windowStart: '22:00', windowEnd: '22:45', widgetStyle: 'window', iconKey: 'pen', color: '#D97706' },
  { key: 'nosugar', title: '戒含糖奶茶饮品', kind: 'quit', target: 1, weeklyTarget: 7, timeOfDay: 'anytime', widgetStyle: 'journey', iconKey: 'nosugar', color: '#E11D48' },
  { key: 'nocaffeine', title: '午后零咖啡因', kind: 'quit', target: 1, weeklyTarget: 7, timeOfDay: 'afternoon', windowStart: '14:00', windowEnd: '23:59', widgetStyle: 'journey', iconKey: 'shield', color: '#0D9488' },
  { key: 'listen', title: '英语原声精听', kind: 'count', target: 20, step: 5, unit: '分钟', weeklyTarget: 6, timeOfDay: 'morning', windowStart: '08:00', windowEnd: '09:00', widgetStyle: 'bars', iconKey: 'language', color: '#2563EB' },
  { key: 'tidy', title: '桌面 3 分钟归位', kind: 'check', target: 1, weeklyTarget: 7, timeOfDay: 'evening', windowStart: '18:30', windowEnd: '19:30', widgetStyle: 'rings', iconKey: 'clean', color: '#16A34A' },
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

export function formatClockHHMM(date = new Date()): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function parseClockMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToHHMM(totalMin: number): string {
  const norm = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDurationCompact(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h <= 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

// ── Pure Mutation Helpers ───────────────────────────────────────────────────

export function toggleCheckHabit(meta: HabitMeta, iso: ISODate, clockHHMM?: string): HabitMeta {
  const nextLogs: Record<ISODate, HabitLogValue> = { ...(meta.logs ?? {}) };
  const nextTimes: Record<ISODate, string[]> = { ...(meta.logTimes ?? {}) };
  if (typeof nextLogs[iso] === 'number' && (nextLogs[iso] as number) >= 1) {
    delete nextLogs[iso];
    delete nextTimes[iso];
  } else {
    nextLogs[iso] = 1;
    if (clockHHMM && parseClockMinutes(clockHHMM) !== null) {
      nextTimes[iso] = [clockHHMM];
    }
  }
  return {
    ...meta,
    logs: nextLogs,
    logTimes: Object.keys(nextTimes).length ? nextTimes : undefined,
  };
}

export function stepCountHabit(meta: HabitMeta, iso: ISODate, delta?: number, clockHHMM?: string): HabitMeta {
  const step = delta ?? Math.max(1, meta.step ?? 1);
  const nextLogs: Record<ISODate, HabitLogValue> = { ...(meta.logs ?? {}) };
  const nextTimes: Record<ISODate, string[]> = { ...(meta.logTimes ?? {}) };
  const cur = typeof nextLogs[iso] === 'number' ? (nextLogs[iso] as number) : 0;
  const next = Math.max(0, Math.round((cur + step) * 100) / 100);
  if (next <= 0) {
    delete nextLogs[iso];
    delete nextTimes[iso];
  } else {
    nextLogs[iso] = next;
    const prevList = [...(nextTimes[iso] ?? [])];
    if (step > 0 && clockHHMM && parseClockMinutes(clockHHMM) !== null) {
      prevList.push(clockHHMM);
      nextTimes[iso] = prevList;
    } else if (step < 0 && prevList.length > 0) {
      prevList.pop();
      if (prevList.length) nextTimes[iso] = prevList;
      else delete nextTimes[iso];
    }
  }
  return {
    ...meta,
    logs: nextLogs,
    logTimes: Object.keys(nextTimes).length ? nextTimes : undefined,
  };
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

/** Builds 6 refined lifestyle-editorial starter habits showcasing all 6 distinct macOS widgets + realistic check-in timestamps. */
export function sampleHabitPayloads(refToday: ISODate): Array<Partial<Task> & { title: string; start: ISODate }> {
  const start = addDays(refToday, -68);

  const makeCheckWithTimes = (
    pattern: number[],
    baseMin: number,
    jitterPattern: number[],
    skipOffsets: number[] = [],
    doneToday = false,
  ): { logs: Record<ISODate, HabitLogValue>; logTimes: Record<ISODate, string[]> } => {
    const logs: Record<ISODate, HabitLogValue> = {};
    const logTimes: Record<ISODate, string[]> = {};
    for (let i = 68; i >= 1; i--) {
      const iso = addDays(refToday, -i);
      if (skipOffsets.includes(i)) {
        logs[iso] = 'skip';
      } else if (pattern[i % pattern.length] === 1) {
        logs[iso] = 1;
        logTimes[iso] = [minutesToHHMM(baseMin + jitterPattern[i % jitterPattern.length])];
      }
    }
    if (doneToday) {
      logs[refToday] = 1;
      logTimes[refToday] = [minutesToHHMM(baseMin + 6)];
    }
    return { logs, logTimes };
  };

  const makeCountWithTimes = (
    target: number,
    pattern: number[],
    todayVal: number,
    slotMins: number[],
  ): { logs: Record<ISODate, HabitLogValue>; logTimes: Record<ISODate, string[]> } => {
    const logs: Record<ISODate, HabitLogValue> = {};
    const logTimes: Record<ISODate, string[]> = {};
    for (let i = 68; i >= 1; i--) {
      const iso = addDays(refToday, -i);
      const frac = pattern[i % pattern.length];
      if (frac > 0) {
        const val = Math.round(target * frac);
        logs[iso] = val;
        const hits = Math.max(1, Math.min(slotMins.length, Math.round(slotMins.length * frac)));
        logTimes[iso] = slotMins.slice(0, hits).map((m, idx) => minutesToHHMM(m + ((i * 7 + idx * 11) % 34) - 14));
      }
    }
    if (todayVal > 0) {
      logs[refToday] = todayVal;
      const hits = Math.max(1, Math.min(slotMins.length, Math.round((todayVal / target) * slotMins.length)));
      logTimes[refToday] = slotMins.slice(0, hits).map((m) => minutesToHHMM(m));
    }
    return { logs, logTimes };
  };

  const breath = makeCheckWithTimes([1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1], 7 * 60 + 28, [-14, -6, 4, 12, -2, 18, 9, -9, 24], [14, 33], true);
  const eyes = makeCountWithTimes(6, [1, 1, 0.83, 1, 0.67, 1, 1, 0.5, 1, 1, 0.83], 4, [9 * 60 + 45, 11 * 60 + 20, 14 * 60 + 15, 16 * 60 + 25, 19 * 60 + 10, 21 * 60 + 5]);
  const water = makeCountWithTimes(8, [1, 1, 0.75, 1, 1, 0.5, 1, 1, 0, 1, 1, 1, 0.875], 5, [7 * 60 + 50, 9 * 60 + 30, 11 * 60 + 15, 13 * 60 + 40, 15 * 60 + 30, 17 * 60 + 20, 19 * 60 + 45, 21 * 60 + 10]);
  const read = makeCountWithTimes(30, [1, 1, 0.67, 1, 0, 1, 1, 1, 0.33, 1, 1], 20, [21 * 60 + 25, 21 * 60 + 50, 22 * 60 + 18]);
  const workout = makeCheckWithTimes([1, 0, 1, 0, 1, 1, 0], 18 * 60 + 15, [-25, -10, 15, 32, 8, -18, 40], [19], false);
  const quitLogs: Record<ISODate, HabitLogValue> = {
    [addDays(refToday, -16)]: 'relapse',
    [addDays(refToday, -41)]: 'relapse',
  };
  const quitTimes: Record<ISODate, string[]> = {};
  for (let i = 15; i >= 1; i--) {
    quitTimes[addDays(refToday, -i)] = [minutesToHHMM(22 * 60 + 48 + ((i * 9) % 24) - 10)];
  }

  return [
    {
      title: '晨间正念呼吸',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'check',
        target: 1,
        weeklyTarget: 7,
        timeOfDay: 'morning',
        windowStart: '07:15',
        windowEnd: '08:00',
        widgetStyle: 'window',
        iconKey: 'meditate',
        color: '#10A37F',
        logs: breath.logs,
        logTimes: breath.logTimes,
      },
    },
    {
      title: '20-20-20 护眼远眺',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'count',
        target: 6,
        step: 1,
        unit: '次',
        weeklyTarget: 7,
        timeOfDay: 'anytime',
        widgetStyle: 'spectrum',
        iconKey: 'heart',
        color: '#EC4899',
        logs: eyes.logs,
        logTimes: eyes.logTimes,
      },
    },
    {
      title: '晨光补水 8 杯',
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
        widgetStyle: 'gauge',
        iconKey: 'water',
        color: '#0EA5E9',
        logs: water.logs,
        logTimes: water.logTimes,
      },
    },
    {
      title: '深度纸质阅读',
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
        windowStart: '21:30',
        windowEnd: '22:30',
        widgetStyle: 'bars',
        iconKey: 'book',
        color: '#7C3AED',
        logs: read.logs,
        logTimes: read.logTimes,
      },
    },
    {
      title: '力量与核心训练',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'check',
        target: 1,
        weeklyTarget: 4,
        timeOfDay: 'afternoon',
        windowStart: '18:00',
        windowEnd: '19:30',
        widgetStyle: 'pillars',
        iconKey: 'dumbbell',
        color: '#E85D2A',
        logs: workout.logs,
        logTimes: workout.logTimes,
      },
    },
    {
      title: '23:00 零蓝光早睡',
      start,
      end: start,
      habitOnly: true,
      sample: true,
      habit: {
        kind: 'quit',
        target: 1,
        weeklyTarget: 7,
        timeOfDay: 'evening',
        windowStart: '23:00',
        windowEnd: '23:45',
        widgetStyle: 'journey',
        iconKey: 'moon',
        color: '#4F46E5',
        logs: quitLogs,
        logTimes: quitTimes,
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

// ── macOS Widget Visualization Data Builders ────────────────────────────────

export interface HabitWeekRingItem {
  iso: ISODate;
  label: string;
  dayNum: number;
  state: HabitDayState;
  value: number;
  ratio: number;
  isToday: boolean;
  isSelected: boolean;
  isFuture: boolean;
}

/** Builds 7 circular dial entries for the week containing `selectedIso` (Honeycomb 7-Day Rings widget). */
export function buildHabitWeekRings(
  meta: HabitMeta,
  startDate: ISODate,
  selectedIso: ISODate,
  refToday: ISODate,
  weekStart: 0 | 1 = 1,
): HabitWeekRingItem[] {
  const ws = startOfWeek(selectedIso, weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(ws, i);
    const st = evaluateHabitDay(meta, startDate, iso, refToday);
    const [, , d] = parts(iso);
    return {
      iso,
      label: WEEKDAY_SHORT[weekday(iso)],
      dayNum: d,
      state: st.state,
      value: st.value,
      ratio: st.ratio,
      isToday: iso === refToday,
      isSelected: iso === selectedIso,
      isFuture: iso > refToday,
    };
  });
}

export interface HabitRecentBarRow {
  iso: ISODate;
  label: string;
  value: number;
  ratio: number;
  /** 0..100 visual bar width percentage against `maxScale` */
  barPct: number;
  state: HabitDayState;
  isSelected: boolean;
  isToday: boolean;
}

export interface HabitRecentBarsModel {
  rows: HabitRecentBarRow[];
  target: number;
  maxScale: number;
  /** 0..100 vertical target threshold line position */
  targetLinePct: number;
  /** Scale tick labels with true proportional x-percentages along the bar axis */
  scaleTicks: Array<{ value: number; pct: number }>;
  avgValue: number;
  deltaFromAvg: number;
  selectedValue: number;
}

/** Builds Apple-Sleep-style multi-day horizontal comparison bars with goal line & hatched over-target zone. */
export function buildHabitRecentBars(
  meta: HabitMeta,
  startDate: ISODate,
  selectedIso: ISODate,
  refToday: ISODate,
  days = 4,
): HabitRecentBarsModel {
  const target = meta.kind === 'count' ? Math.max(1, meta.target || 1) : 1;
  const rowsRaw: Array<{ iso: ISODate; st: HabitDayStatus }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = addDays(selectedIso, -i);
    rowsRaw.push({ iso, st: evaluateHabitDay(meta, startDate, iso, refToday) });
  }

  // Compute 14-day rolling average for delta pill (+X vs avg)
  let sum14 = 0;
  let cnt14 = 0;
  for (let i = 0; i < 14; i++) {
    const iso = addDays(refToday, -i);
    if (iso < startDate) break;
    const st = evaluateHabitDay(meta, startDate, iso, refToday);
    if (st.state === 'skip' || st.state === 'future') continue;
    sum14 += st.value;
    cnt14++;
  }
  const avgValue = cnt14 > 0 ? Math.round((sum14 / cnt14) * 10) / 10 : 0;
  const peakRow = Math.max(target, ...rowsRaw.map((r) => r.st.value));
  // Reserve ~22% hatched bonus zone past the target threshold line
  const maxScale = Math.max(target * 1.28, peakRow * 1.08);
  const targetLinePct = Math.round((target / maxScale) * 100);

  const rows: HabitRecentBarRow[] = rowsRaw.map(({ iso, st }) => {
    const isToday = iso === refToday;
    return {
      iso,
      label: isToday ? '今日' : `周${WEEKDAY_SHORT[weekday(iso)]}`,
      value: st.value,
      ratio: st.ratio,
      barPct: Math.min(100, Math.round((st.value / maxScale) * 100)),
      state: st.state,
      isSelected: iso === selectedIso,
      isToday,
    };
  });

  const selectedValue = rows[rows.length - 1]?.value ?? 0;
  const deltaFromAvg = Math.round((selectedValue - avgValue) * 10) / 10;

  const stepTick = target >= 1000 ? Math.round(target / 3 / 500) * 500 || Math.round(target / 3) : Math.max(1, Math.round(target / 3));
  const rawTicks = meta.kind === 'count' ? [0, stepTick, stepTick * 2, target] : [0, 1];
  const dedupTicks = Array.from(new Set(rawTicks)).sort((a, b) => a - b);
  const scaleTicks = dedupTicks.map((value) => ({
    value,
    pct: Math.min(98, Math.round((value / maxScale) * 100)),
  }));

  return {
    rows,
    target,
    maxScale,
    targetLinePct,
    scaleTicks,
    avgValue,
    deltaFromAvg,
    selectedValue,
  };
}

export interface HabitWeeklyPillar {
  weekIso: ISODate;
  label: string;
  done: number;
  target: number;
  ratio: number;
  met: boolean;
  hasRelapse: boolean;
  isCurrent: boolean;
}

/** Builds Apple-Finance-style 4-week vertical liquid pill columns with completion badges. */
export function buildHabitWeeklyPillars(
  meta: HabitMeta,
  startDate: ISODate,
  refToday: ISODate,
  weekStart: 0 | 1 = 1,
  count = 4,
): HabitWeeklyPillar[] {
  const curWeekStart = startOfWeek(refToday, weekStart);
  const target = Math.max(1, Math.min(7, meta.weeklyTarget || 7));
  const labels = count === 4 ? ['前3周', '前2周', '上周', '本周'] : [];

  return Array.from({ length: count }, (_, idx) => {
    const offsetWeeks = count - 1 - idx;
    const ws = addDays(curWeekStart, -offsetWeeks * 7);
    let done = 0;
    let hasRelapse = false;
    for (let d = 0; d < 7; d++) {
      const iso = addDays(ws, d);
      if (iso > refToday) break;
      const st = evaluateHabitDay(meta, startDate, iso, refToday);
      if (st.state === 'done') done++;
      if (st.state === 'relapse') hasRelapse = true;
    }
    const ratio = Math.min(1, done / target);
    return {
      weekIso: ws,
      label: labels[idx] ?? `W-${offsetWeeks}`,
      done,
      target,
      ratio,
      met: done >= target,
      hasRelapse,
      isCurrent: offsetWeeks === 0,
    };
  });
}

export interface HabitMilestoneStation {
  days: number;
  label: string;
  reached: boolean;
  isNext: boolean;
}

export interface HabitMilestoneJourney {
  streak: number;
  prevMilestone: number;
  nextMilestone: number;
  daysToNext: number;
  /** 0..100 progress along the 5-station transit track */
  trackPct: number;
  stations: HabitMilestoneStation[];
}

const JOURNEY_LADDER = [1, 7, 14, 21, 30, 50, 66, 100, 180, 365];

/** Builds Apple-Transit-style milestone station timeline for Quit & Streak habits. */
export function buildHabitMilestoneJourney(streak: number): HabitMilestoneJourney {
  const clean = Math.max(0, Math.floor(streak));
  let nextIdx = JOURNEY_LADDER.findIndex((m) => m > clean);
  if (nextIdx === -1) nextIdx = JOURNEY_LADDER.length - 1;

  // Pick a balanced 5-station window showing completed milestones + upcoming goal
  const winStart = Math.max(0, Math.min(JOURNEY_LADDER.length - 5, nextIdx - 3));
  const windowVals = JOURNEY_LADDER.slice(winStart, winStart + 5);
  const nextMilestone = JOURNEY_LADDER[nextIdx];
  const prevMilestone = nextIdx > 0 ? JOURNEY_LADDER[nextIdx - 1] : 0;
  const daysToNext = Math.max(0, nextMilestone - clean);

  // Map `clean` smoothly across the 4 intervals between the 5 visible stations
  let trackPct = 0;
  if (clean >= windowVals[windowVals.length - 1]) {
    trackPct = 100;
  } else if (clean <= 0) {
    trackPct = 0;
  } else {
    let segIdx = 0;
    for (let i = 0; i < windowVals.length - 1; i++) {
      if (clean >= windowVals[i]) segIdx = i;
    }
    const lo = clean < windowVals[0] ? 0 : windowVals[segIdx];
    const hi = clean < windowVals[0] ? windowVals[0] : windowVals[segIdx + 1];
    const segFrac = hi > lo ? Math.max(0, Math.min(1, (clean - lo) / (hi - lo))) : 1;
    if (clean < windowVals[0]) {
      trackPct = Math.round(segFrac * 10);
    } else {
      trackPct = Math.round(((segIdx + segFrac) / (windowVals.length - 1)) * 100);
    }
  }

  const stations: HabitMilestoneStation[] = windowVals.map((days) => ({
    days,
    label: `${days}天`,
    reached: clean >= days,
    isNext: days === nextMilestone && clean < nextMilestone,
  }));

  return {
    streak: clean,
    prevMilestone,
    nextMilestone,
    daysToNext,
    trackPct,
    stations,
  };
}

// ── Fixed Time-Window Live Countdown Telemetry ──────────────────────────────

export const HABIT_WINDOW_PRESETS: Array<{ label: string; start: string; end: string; timeOfDay: HabitTimeOfDay }> = [
  { label: '清晨 07:15–08:00', start: '07:15', end: '08:00', timeOfDay: 'morning' },
  { label: '上午 09:00–10:30', start: '09:00', end: '10:30', timeOfDay: 'morning' },
  { label: '午间 12:30–14:00', start: '12:30', end: '14:00', timeOfDay: 'afternoon' },
  { label: '黄昏 17:30–19:00', start: '17:30', end: '19:00', timeOfDay: 'afternoon' },
  { label: '晚间 21:00–22:30', start: '21:00', end: '22:30', timeOfDay: 'evening' },
  { label: '睡前 22:30–23:30', start: '22:30', end: '23:30', timeOfDay: 'evening' },
];

export interface HabitWindowTelemetry {
  hasWindow: boolean;
  startLabel: string;
  endLabel: string;
  /** 'done' | 'active' | 'upcoming' | 'passed' | 'flex' */
  phase: 'done' | 'active' | 'upcoming' | 'passed' | 'flex';
  /** Headline countdown / completion text, e.g. "1h 12m", "24m", "07:34" */
  primaryReadout: string;
  /** Concise status tag, e.g. "距开始", "窗口进行中", "窗内达成", "距明日窗口" */
  phaseLabel: string;
  /** Secondary detail hint, e.g. "07:15–08:00 · 准时率 88%" */
  subHint: string;
  /** 0..100 position of window start/end & live clock cursor along 24h bar */
  startPct: number;
  endPct: number;
  nowPct: number;
  /** 0..100 fill inside the active window */
  windowProgressPct: number;
  /** Optional completion timestamp recorded today */
  doneTime?: string;
}

/** Evaluates live countdown / in-window progress / completion punctuality for fixed-window habits. */
export function evaluateHabitWindow(
  meta: HabitMeta,
  day: HabitDayStatus,
  nowMin: number,
  todayIso: ISODate,
): HabitWindowTelemetry {
  const sMin = parseClockMinutes(meta.windowStart);
  const eMin = parseClockMinutes(meta.windowEnd) ?? (sMin !== null ? Math.min(1439, sMin + 60) : null);
  const clampedNow = Math.max(0, Math.min(1439, Math.round(nowMin)));
  const nowPct = Math.round((clampedNow / 1440) * 1000) / 10;
  const todayTimes = meta.logTimes?.[day.iso] ?? [];
  const lastTime = todayTimes.length ? todayTimes[todayTimes.length - 1] : undefined;

  if (sMin === null || eMin === null) {
    // Graceful fallback when user selects 'window' widget on an anytime habit
    return {
      hasWindow: false,
      startLabel: '06:00',
      endLabel: '23:00',
      phase: day.state === 'done' ? 'done' : 'flex',
      primaryReadout: day.state === 'done' ? (lastTime ?? '已完成') : formatDurationCompact(Math.max(0, 24 * 60 - clampedNow)),
      phaseLabel: day.state === 'done' ? '今日已打卡' : '今日剩余',
      subHint: '全天任意时段可打卡',
      startPct: 25,
      endPct: 95.8,
      nowPct,
      windowProgressPct: day.state === 'done' ? 100 : Math.round(day.ratio * 100),
      doneTime: lastTime,
    };
  }

  const startLabel = minutesToHHMM(sMin);
  const endLabel = minutesToHHMM(eMin);
  const startPct = Math.round((sMin / 1440) * 1000) / 10;
  const endPct = Math.max(startPct + 3, Math.round((Math.max(eMin, sMin + 15) / 1440) * 1000) / 10);
  const isToday = day.iso === todayIso;

  // Compute historical punctuality rate across timestamped logs
  let timedTotal = 0;
  let onTime = 0;
  for (const list of Object.values(meta.logTimes ?? {})) {
    for (const t of list) {
      const m = parseClockMinutes(t);
      if (m === null) continue;
      timedTotal++;
      if (m >= sMin - 15 && m <= eMin + 15) onTime++;
    }
  }
  const punctualHint = timedTotal >= 3 ? `准时率 ${Math.round((onTime / timedTotal) * 100)}%` : `${startLabel}–${endLabel}`;

  if (day.state === 'done') {
    const doneMin = parseClockMinutes(lastTime);
    const punctualTag =
      doneMin !== null
        ? doneMin < sMin
          ? `提前 ${formatDurationCompact(sMin - doneMin)}`
          : doneMin <= eMin
            ? '窗内准时'
            : `延后 ${formatDurationCompact(doneMin - eMin)}`
        : '今日已达成';
    return {
      hasWindow: true,
      startLabel,
      endLabel,
      phase: 'done',
      primaryReadout: lastTime ?? '已达成',
      phaseLabel: punctualTag,
      subHint: `${startLabel}–${endLabel} · ${punctualHint}`,
      startPct,
      endPct,
      nowPct,
      windowProgressPct: 100,
      doneTime: lastTime,
    };
  }

  if (!isToday) {
    return {
      hasWindow: true,
      startLabel,
      endLabel,
      phase: 'passed',
      primaryReadout: `${startLabel}–${endLabel}`,
      phaseLabel: '补签视图',
      subHint: punctualHint,
      startPct,
      endPct,
      nowPct,
      windowProgressPct: 0,
    };
  }

  if (clampedNow < sMin) {
    const waitMins = sMin - clampedNow;
    return {
      hasWindow: true,
      startLabel,
      endLabel,
      phase: 'upcoming',
      primaryReadout: formatDurationCompact(waitMins),
      phaseLabel: '距离开始',
      subHint: `时段 ${startLabel}–${endLabel} · ${punctualHint}`,
      startPct,
      endPct,
      nowPct,
      windowProgressPct: 0,
    };
  }

  if (clampedNow <= eMin) {
    const remMins = Math.max(1, eMin - clampedNow);
    const span = Math.max(1, eMin - sMin);
    return {
      hasWindow: true,
      startLabel,
      endLabel,
      phase: 'active',
      primaryReadout: formatDurationCompact(remMins),
      phaseLabel: '窗口进行中 · 剩',
      subHint: `${startLabel}–${endLabel} · 黄金执行窗口`,
      startPct,
      endPct,
      nowPct,
      windowProgressPct: Math.round(((clampedNow - sMin) / span) * 100),
    };
  }

  // Passed today's window without completion -> show time until tomorrow's window
  const untilTomorrow = 1440 - clampedNow + sMin;
  return {
    hasWindow: true,
    startLabel,
    endLabel,
    phase: 'passed',
    primaryReadout: formatDurationCompact(untilTomorrow),
    phaseLabel: '距明日窗口',
    subHint: `今日 ${startLabel}–${endLabel} 已过 · 仍可补签`,
    startPct,
    endPct,
    nowPct,
    windowProgressPct: 100,
  };
}

// ── Chronotype & Time-of-Day Telemetry Analytics (Data Insights Page) ───────

export interface HabitHourBucket {
  hour: number;
  label: string;
  count: number;
  sharePct: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HabitDailyTimePoint {
  iso: ISODate;
  label: string;
  timesMin: number[];
  avgMin: number | null;
}

export interface HabitTimeInsights {
  totalLogs: number;
  hourBuckets: HabitHourBucket[];
  peakHour: { hour: number; rangeLabel: string; count: number; sharePct: number } | null;
  avgTimeLabel: string;
  medianTimeLabel: string;
  earliest: { time: string; iso: ISODate; min: number } | null;
  latest: { time: string; iso: ISODate; min: number } | null;
  periods: {
    morning: { count: number; pct: number };
    afternoon: { count: number; pct: number };
    evening: { count: number; pct: number };
  };
  recentDailyPoints: HabitDailyTimePoint[];
  consistencyLabel: string;
  spreadMinutes: number;
  weekDeltaPct: number;
  last30DaysDone: number;
}

/** Aggregates real check-in clock timestamps ("HH:MM") into 24h chronotype distribution, earliest/latest/peak & 14-day drift. */
export function computeHabitTimeInsights(
  habits: ResolvedHabit[],
  refToday: ISODate,
): HabitTimeInsights {
  const counts = new Array<number>(24).fill(0);
  const allPoints: Array<{ iso: ISODate; min: number; time: string }> = [];
  const byDay = new Map<ISODate, number[]>();

  let last30DaysDone = 0;
  let thisWeekDone = 0;
  let prevWeekDone = 0;
  const day7Start = addDays(refToday, -6);
  const day14Start = addDays(refToday, -13);

  for (const h of habits) {
    // Count completions in last 30 days & 7d vs prev 7d trend
    for (let i = 0; i < 30; i++) {
      const iso = addDays(refToday, -i);
      if (iso < h.task.start) break;
      const st = evaluateHabitDay(h.meta, h.task.start, iso, refToday);
      if (st.state === 'done') {
        last30DaysDone++;
        if (iso >= day7Start) thisWeekDone++;
        else if (iso >= day14Start) prevWeekDone++;
      }
    }

    for (const [iso, times] of Object.entries(h.meta.logTimes ?? {})) {
      if (iso > refToday) continue;
      for (const raw of times) {
        const min = parseClockMinutes(raw);
        if (min === null) continue;
        const hhmm = minutesToHHMM(min);
        const hr = Math.floor(min / 60);
        counts[hr]++;
        allPoints.push({ iso, min, time: hhmm });
        const arr = byDay.get(iso) ?? [];
        arr.push(min);
        byDay.set(iso, arr);
      }
    }
  }

  const totalLogs = allPoints.length;
  const maxHr = Math.max(1, ...counts);
  const hourBuckets: HabitHourBucket[] = counts.map((count, hour) => {
    const sharePct = totalLogs > 0 ? Math.round((count / totalLogs) * 100) : 0;
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (count > 0) {
      const r = count / maxHr;
      if (r >= 0.78) level = 4;
      else if (r >= 0.5) level = 3;
      else if (r >= 0.25) level = 2;
      else level = 1;
    }
    return {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      count,
      sharePct,
      level,
    };
  });

  let peakHour: HabitTimeInsights['peakHour'] = null;
  if (totalLogs > 0) {
    let bestHr = 0;
    for (let h = 1; h < 24; h++) {
      if (counts[h] > counts[bestHr]) bestHr = h;
    }
    const nextHr = (bestHr + 1) % 24;
    peakHour = {
      hour: bestHr,
      rangeLabel: `${String(bestHr).padStart(2, '0')}:00–${String(nextHr).padStart(2, '0')}:00`,
      count: counts[bestHr],
      sharePct: Math.round((counts[bestHr] / totalLogs) * 100),
    };
  }

  let earliest: HabitTimeInsights['earliest'] = null;
  let latest: HabitTimeInsights['latest'] = null;
  let avgTimeLabel = '--:--';
  let medianTimeLabel = '--:--';
  let spreadMinutes = 0;
  let consistencyLabel = '等待记录';

  let morningCount = 0;
  let afternoonCount = 0;
  let eveningCount = 0;

  if (totalLogs > 0) {
    const sorted = [...allPoints].sort((a, b) => a.min - b.min);
    earliest = sorted[0];
    latest = sorted[sorted.length - 1];

    const sum = sorted.reduce((acc, p) => acc + p.min, 0);
    const avg = sum / sorted.length;
    avgTimeLabel = minutesToHHMM(avg);
    medianTimeLabel = minutesToHHMM(sorted[Math.floor(sorted.length / 2)].min);

    const variance = sorted.reduce((acc, p) => acc + (p.min - avg) ** 2, 0) / sorted.length;
    spreadMinutes = Math.round(Math.sqrt(variance));
    consistencyLabel = spreadMinutes <= 45 ? '节律极稳' : spreadMinutes <= 110 ? '规律良好' : '全天弹性';

    for (const p of sorted) {
      const hr = Math.floor(p.min / 60);
      if (hr >= 5 && hr < 12) morningCount++;
      else if (hr >= 12 && hr < 18) afternoonCount++;
      else eveningCount++;
    }
  }

  const pctOf = (c: number) => (totalLogs > 0 ? Math.round((c / totalLogs) * 100) : 0);

  const recentDailyPoints: HabitDailyTimePoint[] = Array.from({ length: 14 }, (_, i) => {
    const iso = addDays(refToday, i - 13);
    const list = (byDay.get(iso) ?? []).slice().sort((a, b) => a - b);
    const avgMin = list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
    const [, m, d] = parts(iso);
    return {
      iso,
      label: `${m}/${d}`,
      timesMin: list,
      avgMin,
    };
  });

  const weekDeltaPct =
    prevWeekDone > 0
      ? Math.round(((thisWeekDone - prevWeekDone) / prevWeekDone) * 1000) / 10
      : thisWeekDone > 0
        ? 100
        : 0;

  return {
    totalLogs,
    hourBuckets,
    peakHour,
    avgTimeLabel,
    medianTimeLabel,
    earliest,
    latest,
    periods: {
      morning: { count: morningCount, pct: pctOf(morningCount) },
      afternoon: { count: afternoonCount, pct: pctOf(afternoonCount) },
      evening: { count: eveningCount, pct: pctOf(eveningCount) },
    },
    recentDailyPoints,
    consistencyLabel,
    spreadMinutes,
    weekDeltaPct,
    last30DaysDone,
  };
}
