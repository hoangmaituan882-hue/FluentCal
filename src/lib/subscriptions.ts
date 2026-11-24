import type {
  ISODate,
  SubscriptionCategory,
  SubscriptionCurrency,
  SubscriptionCycle,
  SubscriptionMeta,
  SubscriptionStatus,
  Task,
} from '@/types';
import { addDays, addMonths, daysInMonth, diffDays, pad2, parts, ymd } from './date';

export const CURRENCY_META: Record<
  SubscriptionCurrency,
  { symbol: string; label: string; defaultRateCNY: number }
> = {
  CNY: { symbol: '¥', label: '人民币 CNY', defaultRateCNY: 1 },
  USD: { symbol: '$', label: '美元 USD', defaultRateCNY: 7.25 },
  HKD: { symbol: 'HK$', label: '港币 HKD', defaultRateCNY: 0.93 },
  EUR: { symbol: '€', label: '欧元 EUR', defaultRateCNY: 7.85 },
  JPY: { symbol: '¥', label: '日元 JPY', defaultRateCNY: 0.048 },
  GBP: { symbol: '£', label: '英镑 GBP', defaultRateCNY: 9.15 },
};

export const CYCLE_META: Record<
  SubscriptionCycle,
  { label: string; short: string; monthsPerYear: number; unitMonths?: number; unitDays?: number }
> = {
  weekly: { label: '每周', short: '周付', monthsPerYear: 52 / 12, unitDays: 7 },
  monthly: { label: '每月', short: '月付', monthsPerYear: 12, unitMonths: 1 },
  quarterly: { label: '每季', short: '季付', monthsPerYear: 4, unitMonths: 3 },
  semiannual: { label: '每半年', short: '半年付', monthsPerYear: 2, unitMonths: 6 },
  yearly: { label: '每年', short: '年付', monthsPerYear: 1, unitMonths: 12 },
};

export const CATEGORY_META: Record<
  SubscriptionCategory,
  { label: string; watermark: string; color: string; toneClass: string }
> = {
  life: { label: '生活与居住', watermark: '生活居住', color: '#3F7D58', toneClass: 'tone-life' },
  ai: { label: 'AI 工具', watermark: 'AI TOOLS', color: '#635BFF', toneClass: 'tone-ai' },
  cloud: { label: '服务器与云', watermark: 'CLOUD', color: '#0284C7', toneClass: 'tone-cloud' },
  media: { label: '影音音乐', watermark: 'MEDIA', color: '#E11D48', toneClass: 'tone-media' },
  work: { label: '效率软件', watermark: 'STUDIO', color: '#D97706', toneClass: 'tone-work' },
  other: { label: '其他订阅', watermark: 'MORE', color: '#64748B', toneClass: 'tone-other' },
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: '订阅中',
  trial: '试用中',
  paused: '已暂停',
  cancelled: '已取消',
};

export const SUBSCRIPTION_CATEGORIES: SubscriptionCategory[] = [
  'life',
  'ai',
  'cloud',
  'media',
  'work',
  'other',
];

export const SUBSCRIPTION_CURRENCIES: SubscriptionCurrency[] = [
  'CNY',
  'USD',
  'HKD',
  'EUR',
  'JPY',
  'GBP',
];

export const SUBSCRIPTION_CYCLES: SubscriptionCycle[] = [
  'monthly',
  'yearly',
  'quarterly',
  'semiannual',
  'weekly',
];

export const BRAND_COLOR_SWATCHES = [
  '#10A37F',
  '#FF2D55',
  '#2563EB',
  '#E85D2A',
  '#1DB954',
  '#FB7299',
  '#7C3AED',
  '#D97706',
  '#0EA5E9',
  '#17171A',
] as const;

export const EMBLEM_CHOICES = ['✦', '♫', '☁', '⚡', '⌘', '📺', '♪', '⌂', '✿', '🌐', '💎', '◈'] as const;

export interface SubscriptionPreset {
  key: string;
  title: string;
  watermark: string;
  emblem: string;
  brandColor: string;
  price: number;
  currency: SubscriptionCurrency;
  cycle: SubscriptionCycle;
  category: SubscriptionCategory;
  splitCount?: number;
  paymentMethod: string;
  status?: SubscriptionStatus;
  autoRenew?: boolean;
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
  {
    key: 'chatgpt',
    title: 'ChatGPT Plus',
    watermark: 'ChatGPT',
    emblem: '✦',
    brandColor: '#10A37F',
    price: 20,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: 'Apple 订阅',
    autoRenew: true,
  },
  {
    key: 'claude',
    title: 'Claude Pro',
    watermark: 'Claude',
    emblem: '✴',
    brandColor: '#D97757',
    price: 20,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: 'Visa 信用卡',
    autoRenew: true,
  },
  {
    key: 'apple-music',
    title: 'Apple Music',
    watermark: 'Apple Music',
    emblem: '♫',
    brandColor: '#FF2D55',
    price: 11,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'media',
    paymentMethod: 'Apple 订阅',
    autoRenew: true,
  },
  {
    key: 'icloud',
    title: 'iCloud+ 2TB 家庭组',
    watermark: 'iCloud+',
    emblem: '☁',
    brandColor: '#2563EB',
    price: 68,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'cloud',
    splitCount: 6,
    paymentMethod: 'Apple Pay',
    autoRenew: true,
  },
  {
    key: 'meituan',
    title: '美团神会员',
    watermark: 'Meituan',
    emblem: '美',
    brandColor: '#EAB308',
    price: 16.8,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'life',
    paymentMethod: '微信自动扣款',
    autoRenew: true,
  },
  {
    key: 'bilibili',
    title: 'B站大会员',
    watermark: 'Bilibili',
    emblem: '📺',
    brandColor: '#FB7299',
    price: 148,
    currency: 'CNY',
    cycle: 'yearly',
    category: 'media',
    paymentMethod: '支付宝代扣',
    autoRenew: true,
  },
  {
    key: 'spotify',
    title: 'Spotify 家庭组',
    watermark: 'Spotify',
    emblem: '♪',
    brandColor: '#1DB954',
    price: 38,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'media',
    splitCount: 6,
    paymentMethod: '支付宝',
    autoRenew: true,
  },
  {
    key: 'vps',
    title: 'Linux 云服务器 VPS',
    watermark: 'Server',
    emblem: '⌘',
    brandColor: '#0EA5E9',
    price: 65,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'cloud',
    paymentMethod: '微信支付',
    autoRenew: true,
  },
  {
    key: 'trial-app',
    title: '效率工具试用',
    watermark: 'Trial',
    emblem: '⚡',
    brandColor: '#E85D2A',
    price: 98,
    currency: 'CNY',
    cycle: 'yearly',
    category: 'work',
    paymentMethod: '试用护盾',
    status: 'trial',
    autoRenew: false,
  },
];

export function isSubscriptionTask(t: Task): t is Task & { subscription: SubscriptionMeta } {
  return !!t.subscriptionOnly && !!t.subscription;
}

export function effectiveSplit(meta: SubscriptionMeta): number {
  const n = Math.floor(meta.splitCount ?? 1);
  return n >= 1 ? n : 1;
}

/** Personal payable amount in original currency after dividing by splitCount. */
export function personalPriceOriginal(meta: SubscriptionMeta): number {
  const raw = Number.isFinite(meta.price) ? Math.max(0, meta.price) : 0;
  return raw / effectiveSplit(meta);
}

/** Converts an amount in `currency` to CNY using default reference rates. */
export function toCNY(amount: number, currency: SubscriptionCurrency): number {
  const rate = CURRENCY_META[currency]?.defaultRateCNY ?? 1;
  return amount * rate;
}

/** Personal payable amount per billing cycle converted to CNY. */
export function cycleCostCNY(meta: SubscriptionMeta): number {
  return toCNY(personalPriceOriginal(meta), meta.currency);
}

/** Amortized monthly cost in CNY (yearly / 12, quarterly / 3, weekly * 52/12). */
export function monthlyEquivalentCNY(meta: SubscriptionMeta): number {
  if (meta.status === 'paused' || meta.status === 'cancelled') return 0;
  const perCycle = cycleCostCNY(meta);
  if (meta.cycle === 'weekly') return (perCycle * 52) / 12;
  if (meta.cycle === 'monthly') return perCycle;
  if (meta.cycle === 'quarterly') return perCycle / 3;
  if (meta.cycle === 'semiannual') return perCycle / 6;
  return perCycle / 12;
}

/** Amortized yearly cost in CNY. */
export function yearlyEquivalentCNY(meta: SubscriptionMeta): number {
  return monthlyEquivalentCNY(meta) * 12;
}

/** Monthly savings in CNY from split-bill sharing (0 when splitCount === 1). */
export function monthlySplitSavingsCNY(meta: SubscriptionMeta): number {
  const split = effectiveSplit(meta);
  if (split <= 1 || meta.status === 'paused' || meta.status === 'cancelled') return 0;
  const fullMonthly = monthlyEquivalentCNY({ ...meta, splitCount: 1 });
  return Math.max(0, fullMonthly - monthlyEquivalentCNY(meta));
}

export function formatCurrencyAmount(amount: number, currency: SubscriptionCurrency, decimals?: number): string {
  const sym = CURRENCY_META[currency]?.symbol ?? '¥';
  const digits = decimals !== undefined ? decimals : Math.abs(amount - Math.round(amount)) < 0.005 ? 0 : 2;
  const formatted = amount.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${sym}${formatted}`;
}

/** Steps an anchor date forward by `step` cycles while keeping original anchor day-of-month clamped to month end. */
export function stepBillingDate(anchor: ISODate, cycle: SubscriptionCycle, step: number): ISODate {
  if (cycle === 'weekly') {
    return addDays(anchor, step * 7);
  }
  const monthsPerCycle =
    cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : cycle === 'semiannual' ? 6 : 12;
  return addMonths(anchor, step * monthsPerCycle);
}

export interface BillingCycleWindow {
  prevDate: ISODate;
  nextDate: ISODate;
  totalDays: number;
  elapsedDays: number;
  remainDays: number;
  progressPct: number;
}

/**
 * Computes the current billing cycle window `[prevDate, nextDate]` relative to `refToday`.
 * `nextDate` is always >= `refToday`.
 */
export function computeCycleWindow(
  anchor: ISODate,
  cycle: SubscriptionCycle,
  refToday: ISODate,
): BillingCycleWindow {
  if (anchor >= refToday) {
    const prevDate = stepBillingDate(anchor, cycle, -1);
    const totalDays = Math.max(1, diffDays(prevDate, anchor));
    const remainDays = Math.max(0, diffDays(refToday, anchor));
    const elapsedDays = Math.max(0, totalDays - remainDays);
    return {
      prevDate,
      nextDate: anchor,
      totalDays,
      elapsedDays,
      remainDays,
      progressPct: Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100))),
    };
  }

  // Estimate starting step quickly so ancient start dates never loop many times
  let step = 1;
  if (cycle === 'weekly') {
    step = Math.max(1, Math.floor(diffDays(anchor, refToday) / 7));
  } else {
    const [ay, am] = parts(anchor);
    const [ty, tm] = parts(refToday);
    const monthsDiff = (ty - ay) * 12 + (tm - am);
    const unit = cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : cycle === 'semiannual' ? 6 : 12;
    step = Math.max(1, Math.floor(monthsDiff / unit));
  }

  let nextDate = stepBillingDate(anchor, cycle, step);
  while (nextDate < refToday) {
    step++;
    nextDate = stepBillingDate(anchor, cycle, step);
  }
  while (step > 0 && stepBillingDate(anchor, cycle, step - 1) >= refToday) {
    step--;
    nextDate = stepBillingDate(anchor, cycle, step);
  }

  const prevDate = stepBillingDate(anchor, cycle, step - 1);
  const totalDays = Math.max(1, diffDays(prevDate, nextDate));
  const remainDays = Math.max(0, diffDays(refToday, nextDate));
  const elapsedDays = Math.max(0, totalDays - remainDays);

  return {
    prevDate,
    nextDate,
    totalDays,
    elapsedDays,
    remainDays,
    progressPct: Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100))),
  };
}

export interface ResolvedSubscription {
  task: Task & { subscription: SubscriptionMeta };
  meta: SubscriptionMeta;
  window: BillingCycleWindow;
  personalOrig: number;
  cycleCNY: number;
  monthlyCNY: number;
  yearlyCNY: number;
  monthlySavedCNY: number;
  emblem: string;
  brandColor: string;
  watermark: string;
}

export function resolveSubscription(
  task: Task & { subscription: SubscriptionMeta },
  refToday: ISODate,
): ResolvedSubscription {
  const meta = task.subscription;
  const window = computeCycleWindow(task.start, meta.cycle, refToday);
  const catMeta = CATEGORY_META[meta.category] ?? CATEGORY_META.other;
  return {
    task,
    meta,
    window,
    personalOrig: personalPriceOriginal(meta),
    cycleCNY: cycleCostCNY(meta),
    monthlyCNY: monthlyEquivalentCNY(meta),
    yearlyCNY: yearlyEquivalentCNY(meta),
    monthlySavedCNY: monthlySplitSavingsCNY(meta),
    emblem: meta.emblem || task.title.trim().slice(0, 1).toUpperCase() || '◈',
    brandColor: meta.brandColor || catMeta.color,
    watermark: meta.watermark?.trim() || task.title,
  };
}

/** Returns all billing dates for `sub` that fall inside the given `(year, month)` (1-based month). */
export function billingDatesInMonth(
  sub: ResolvedSubscription,
  year: number,
  month: number,
): ISODate[] {
  if (sub.meta.status === 'paused' || sub.meta.status === 'cancelled') return [];
  const monthStart = ymd(year, month, 1);
  const monthEnd = ymd(year, month, daysInMonth(year, month));
  const firstWindow = computeCycleWindow(sub.task.start, sub.meta.cycle, monthStart);
  const dates: ISODate[] = [];
  let cur = firstWindow.nextDate;
  let guard = 0;
  while (cur <= monthEnd && guard < 10) {
    if (cur >= monthStart) dates.push(cur);
    if (sub.meta.cycle !== 'weekly') break;
    cur = addDays(cur, 7);
    guard++;
  }
  return dates;
}

export interface MonthBillingSummary {
  /** Day number (1..31) -> subscriptions billed on that day. */
  byDay: Record<number, ResolvedSubscription[]>;
  /** Total actual charges occurring in this calendar month (CNY). */
  monthTotalCNY: number;
  /** Charges already billed on or before `refToday` within this month (CNY). */
  billedSoFarCNY: number;
  /** Remaining charges to be billed after `refToday` within this month (CNY). */
  remainingMonthCNY: number;
  /** Progress percentage (0..100) of this month's charges already billed. */
  billedProgressPct: number;
  /** Count of billing events occurring in this calendar month. */
  eventCount: number;
}

export function summarizeMonthBilling(
  subs: ResolvedSubscription[],
  year: number,
  month: number,
  refToday: ISODate,
): MonthBillingSummary {
  const byDay: Record<number, ResolvedSubscription[]> = {};
  let monthTotalCNY = 0;
  let billedSoFarCNY = 0;
  let eventCount = 0;

  for (const sub of subs) {
    const dates = billingDatesInMonth(sub, year, month);
    for (const d of dates) {
      const day = parts(d)[2];
      (byDay[day] ??= []).push(sub);
      const cost = sub.meta.status === 'trial' ? 0 : sub.cycleCNY;
      monthTotalCNY += cost;
      if (d <= refToday) billedSoFarCNY += cost;
      eventCount++;
    }
  }

  const remainingMonthCNY = Math.max(0, monthTotalCNY - billedSoFarCNY);
  const billedProgressPct =
    monthTotalCNY > 0 ? Math.min(100, Math.round((billedSoFarCNY / monthTotalCNY) * 100)) : 0;

  return {
    byDay,
    monthTotalCNY,
    billedSoFarCNY,
    remainingMonthCNY,
    billedProgressPct,
    eventCount,
  };
}

export interface CategorySlice {
  category: SubscriptionCategory;
  label: string;
  watermark: string;
  color: string;
  toneClass: string;
  count: number;
  amountCNY: number;
  percent: number;
}

export function buildCategoryBreakdown(
  subs: ResolvedSubscription[],
  period: 'month' | 'year',
): CategorySlice[] {
  const active = subs.filter((s) => s.meta.status === 'active' || s.meta.status === 'trial');
  const map = new Map<SubscriptionCategory, { count: number; amount: number }>();

  for (const s of active) {
    const cur = map.get(s.meta.category) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += period === 'month' ? s.monthlyCNY : s.yearlyCNY;
    map.set(s.meta.category, cur);
  }

  const total = Array.from(map.values()).reduce((sum, x) => sum + x.amount, 0);
  const slices: CategorySlice[] = [];
  for (const [cat, stats] of map.entries()) {
    const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
    slices.push({
      category: cat,
      label: meta.label,
      watermark: meta.watermark,
      color: meta.color,
      toneClass: meta.toneClass,
      count: stats.count,
      amountCNY: stats.amount,
      percent: total > 0 ? Math.round((stats.amount / total) * 1000) / 10 : 0,
    });
  }

  slices.sort((a, b) => b.amountCNY - a.amountCNY);
  return slices;
}

export function monthNameEnglish(month: number): string {
  const names = [
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER',
  ];
  return names[(month - 1 + 12) % 12] ?? 'MONTH';
}

export function formatShortDueDate(iso: ISODate): string {
  const [, m, d] = parts(iso);
  return `${m}月${d}日`;
}

export function formatDueCountdown(remainDays: number, status: SubscriptionStatus): string {
  if (status === 'trial') {
    if (remainDays === 0) return '试用今日结束';
    if (remainDays === 1) return '试用明天结束';
    return `${remainDays}天后试用结束`;
  }
  if (remainDays === 0) return '今日扣款';
  if (remainDays === 1) return '明天扣款';
  return `${remainDays}天后扣款`;
}

export function sampleSubscriptionPayloads(refToday: ISODate): Array<Partial<Task> & { title: string; start: ISODate }> {
  const [y, m] = parts(refToday);
  const clamp = (day: number): ISODate => ymd(y, m, Math.min(day, daysInMonth(y, m)));
  return [
    {
      title: 'Apple Music',
      start: addDays(refToday, 2),
      end: addDays(refToday, 2),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 11,
        currency: 'CNY',
        cycle: 'monthly',
        category: 'media',
        status: 'active',
        autoRenew: true,
        paymentMethod: 'Apple 订阅',
        emblem: '♫',
        brandColor: '#FF2D55',
        watermark: 'Apple Music',
        remindDaysBefore: 2,
      },
    },
    {
      title: '美团神会员',
      start: addDays(refToday, 4),
      end: addDays(refToday, 4),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 16.8,
        currency: 'CNY',
        cycle: 'monthly',
        category: 'life',
        status: 'active',
        autoRenew: true,
        paymentMethod: '微信自动扣款',
        emblem: '美',
        brandColor: '#D9A700',
        watermark: 'Meituan',
        remindDaysBefore: 2,
      },
    },
    {
      title: 'ChatGPT Plus',
      start: addDays(refToday, 2),
      end: addDays(refToday, 2),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 20,
        currency: 'USD',
        cycle: 'monthly',
        category: 'ai',
        status: 'active',
        autoRenew: true,
        paymentMethod: 'Visa · 4242',
        emblem: '✦',
        brandColor: '#10A37F',
        watermark: 'ChatGPT',
        remindDaysBefore: 3,
      },
    },
    {
      title: 'iCloud+ 2TB 家庭组',
      start: addDays(refToday, 6),
      end: addDays(refToday, 6),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 68,
        currency: 'CNY',
        cycle: 'monthly',
        category: 'cloud',
        status: 'active',
        autoRenew: true,
        splitCount: 6,
        paymentMethod: 'Apple Pay',
        emblem: '☁',
        brandColor: '#2563EB',
        watermark: 'iCloud+',
        remindDaysBefore: 2,
      },
    },
    {
      title: 'Raycast Pro 试用',
      start: addDays(refToday, 3),
      end: addDays(refToday, 3),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 96,
        currency: 'USD',
        cycle: 'yearly',
        category: 'work',
        status: 'trial',
        autoRenew: false,
        paymentMethod: '试用护盾',
        emblem: '⚡',
        brandColor: '#E85D2A',
        watermark: 'Raycast',
        remindDaysBefore: 1,
      },
    },
    {
      title: 'Linux 云服务器 VPS',
      start: clamp(18),
      end: clamp(18),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 65,
        currency: 'CNY',
        cycle: 'monthly',
        category: 'cloud',
        status: 'active',
        autoRenew: true,
        paymentMethod: '微信支付',
        emblem: '⌘',
        brandColor: '#0EA5E9',
        watermark: 'Server',
        remindDaysBefore: 3,
      },
    },
    {
      title: 'B站大会员',
      start: clamp(12),
      end: clamp(12),
      subscriptionOnly: true,
      sample: true,
      subscription: {
        price: 148,
        currency: 'CNY',
        cycle: 'yearly',
        category: 'media',
        status: 'active',
        autoRenew: true,
        paymentMethod: '支付宝代扣',
        emblem: '📺',
        brandColor: '#FB7299',
        watermark: 'Bilibili',
        remindDaysBefore: 5,
      },
    },
  ];
}

export { pad2 };
