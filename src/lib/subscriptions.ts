import type {
  ISODate,
  SubscriptionCategory,
  SubscriptionCurrency,
  SubscriptionCycle,
  SubscriptionMeta,
  SubscriptionStatus,
  SubscriptionSubAccount,
  Task,
} from '@/types';
import { addDays, addMonths, daysInMonth, diffDays, pad2, parts, ymd } from './date';
import { inferBrandFromTitle } from './subscriptionIcons';

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
  life: { label: '生活与居住', watermark: '生活与居住', color: '#3F7D58', toneClass: 'tone-life' },
  ai: { label: 'AI 工具', watermark: 'AI 工具', color: '#635BFF', toneClass: 'tone-ai' },
  cloud: { label: '服务器与云', watermark: '服务器与云', color: '#0284C7', toneClass: 'tone-cloud' },
  media: { label: '影音音乐', watermark: '影音音乐', color: '#E11D48', toneClass: 'tone-media' },
  work: { label: '效率软件', watermark: '效率软件', color: '#D97706', toneClass: 'tone-work' },
  other: { label: '其他订阅', watermark: '其他订阅', color: '#64748B', toneClass: 'tone-other' },
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: '订阅中',
  ending: '已关续费',
  trial: '试用中',
  paused: '已暂停',
  cancelled: '已退订',
};

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'active',
  'ending',
  'trial',
  'paused',
  'cancelled',
];

/** True when the subscription is currently providing benefits within its active window. */
export function isSubscriptionActiveStatus(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'ending' || status === 'trial';
}

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
  brandKey?: string;
  title: string;
  plan?: string;
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
  discountAmount?: number;
  promoPrice?: number;
  promoLabel?: string;
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
  {
    key: 'chatgpt',
    brandKey: 'chatgpt',
    title: 'ChatGPT Plus',
    plan: 'Plus',
    watermark: 'ChatGPT Plus',
    emblem: '✦',
    brandColor: '#10A37F',
    price: 20,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: 'Apple Pay',
    autoRenew: true,
  },
  {
    key: 'chatgpt-pro',
    brandKey: 'chatgpt',
    title: 'ChatGPT Pro',
    plan: 'Pro',
    watermark: 'ChatGPT Pro',
    emblem: '✦',
    brandColor: '#10A37F',
    price: 200,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'claude',
    brandKey: 'claude',
    title: 'Claude Pro',
    plan: 'Pro',
    watermark: 'Claude Pro',
    emblem: '✴',
    brandColor: '#D97757',
    price: 20,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'claude-max',
    brandKey: 'claude',
    title: 'Claude Max',
    plan: 'Max 5x',
    watermark: 'Claude Max',
    emblem: '✴',
    brandColor: '#D97757',
    price: 100,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'cursor',
    brandKey: 'cursor',
    title: 'Cursor Pro',
    plan: 'Pro',
    watermark: 'Cursor Pro',
    emblem: '▷',
    brandColor: '#18181B',
    price: 20,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'gemini',
    brandKey: 'gemini',
    title: 'Gemini AI Pro',
    plan: 'AI Pro',
    watermark: 'Gemini AI Pro',
    emblem: '✦',
    brandColor: '#4285F4',
    price: 19.99,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: 'Google Play',
    autoRenew: true,
  },
  {
    key: 'copilot',
    brandKey: 'github',
    title: 'GitHub Copilot',
    plan: 'Pro',
    watermark: 'GitHub Copilot',
    emblem: '⌘',
    brandColor: '#24292F',
    price: 10,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'perplexity',
    brandKey: 'perplexity',
    title: 'Perplexity Pro',
    plan: 'Pro',
    watermark: 'Perplexity Pro',
    emblem: '✳',
    brandColor: '#1FB8CD',
    price: 20,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: 'Apple Pay',
    autoRenew: true,
  },
  {
    key: 'grok',
    brandKey: 'grok',
    title: 'SuperGrok',
    plan: 'SuperGrok',
    watermark: 'SuperGrok',
    emblem: 'G',
    brandColor: '#141416',
    price: 30,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'windsurf',
    brandKey: 'windsurf',
    title: 'Windsurf Pro',
    plan: 'Pro',
    watermark: 'Windsurf Pro',
    emblem: 'W',
    brandColor: '#09B6A2',
    price: 15,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'midjourney',
    brandKey: 'midjourney',
    title: 'Midjourney',
    plan: 'Basic',
    watermark: 'Midjourney',
    emblem: '⛵',
    brandColor: '#1E293B',
    price: 10,
    currency: 'USD',
    cycle: 'monthly',
    category: 'ai',
    paymentMethod: '银行卡',
    autoRenew: true,
  },
  {
    key: 'netease-music',
    brandKey: 'netease-music',
    title: '网易云音乐',
    plan: '黑胶 VIP',
    watermark: '网易云音乐',
    emblem: '♫',
    brandColor: '#D43C33',
    price: 15,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'media',
    paymentMethod: '支付宝',
    autoRenew: true,
  },
  {
    key: 'apple-music',
    brandKey: 'apple-music',
    title: 'Apple Music',
    watermark: 'Apple Music',
    emblem: '♫',
    brandColor: '#FF2D55',
    price: 11,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'media',
    paymentMethod: 'Apple Pay',
    autoRenew: true,
  },
  {
    key: 'icloud',
    brandKey: 'icloud',
    title: 'iCloud+ 2TB 家庭组',
    watermark: 'iCloud+ 2TB 家庭组',
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
    brandKey: 'meituan',
    title: '美团神会员',
    watermark: '美团神会员',
    emblem: '美',
    brandColor: '#EAB308',
    price: 19.8,
    discountAmount: 3,
    promoPrice: 6.8,
    promoLabel: '首月特惠',
    currency: 'CNY',
    cycle: 'monthly',
    category: 'life',
    paymentMethod: '微信支付',
    autoRenew: true,
  },
  {
    key: 'bilibili',
    brandKey: 'bilibili',
    title: 'B站大会员',
    watermark: 'B站大会员',
    emblem: '📺',
    brandColor: '#FB7299',
    price: 148,
    currency: 'CNY',
    cycle: 'yearly',
    category: 'media',
    paymentMethod: '支付宝',
    autoRenew: true,
  },
  {
    key: 'spotify',
    brandKey: 'spotify',
    title: 'Spotify 家庭组',
    watermark: 'Spotify 家庭组',
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
    brandKey: 'vps',
    title: 'Linux 云服务器 VPS',
    watermark: 'Linux 云服务器 VPS',
    emblem: '⌘',
    brandColor: '#0EA5E9',
    price: 65,
    currency: 'CNY',
    cycle: 'monthly',
    category: 'cloud',
    paymentMethod: '微信支付',
    autoRenew: true,
  },
];

export function isSubscriptionTask(t: Task): t is Task & { subscription: SubscriptionMeta } {
  return !!t.subscriptionOnly && !!t.subscription;
}

export function effectiveSplit(meta: SubscriptionMeta): number {
  const n = Math.floor(meta.splitCount ?? 1);
  return n >= 1 ? n : 1;
}

/** Clamped per-cycle discount off original price in original currency. */
export function cycleDiscountOriginal(meta: Pick<SubscriptionMeta, 'price' | 'discountAmount'>): number {
  const raw = Number.isFinite(meta.price) ? Math.max(0, meta.price) : 0;
  const disc = Number.isFinite(meta.discountAmount ?? 0) ? Math.max(0, meta.discountAmount ?? 0) : 0;
  return Math.min(raw, disc);
}

/** Net regular cycle price (after recurring discount, before split-bill division). */
export function netPriceOriginal(meta: Pick<SubscriptionMeta, 'price' | 'discountAmount'>): number {
  const raw = Number.isFinite(meta.price) ? Math.max(0, meta.price) : 0;
  return Math.max(0, raw - cycleDiscountOriginal(meta));
}

/** Personal payable regular amount in original currency (after recurring discount & splitCount). */
export function personalPriceOriginal(meta: SubscriptionMeta): number {
  return netPriceOriginal(meta) / effectiveSplit(meta);
}

/** Personal original pre-discount list price in original currency (after splitCount). */
export function originalListPersonal(meta: SubscriptionMeta): number {
  const raw = Number.isFinite(meta.price) ? Math.max(0, meta.price) : 0;
  return raw / effectiveSplit(meta);
}

/** Personal first-period / introductory promo price in original currency, or null when unset. */
export function promoPersonalOriginal(meta: SubscriptionMeta): number | null {
  if (typeof meta.promoPrice !== 'number' || !Number.isFinite(meta.promoPrice) || meta.promoPrice < 0) {
    return null;
  }
  return meta.promoPrice / effectiveSplit(meta);
}

/** True if the subscription's intro/first-period promo is still active at `refToday`. */
export function isWithinPromoPeriod(
  anchor: ISODate,
  cycle: SubscriptionCycle,
  refToday: ISODate,
  promoPeriods?: number,
): boolean {
  const periods = Math.max(1, Math.floor(promoPeriods ?? 1));
  const promoEnd = stepBillingDate(anchor, cycle, periods);
  return refToday < promoEnd;
}

/** Converts an amount in `currency` to CNY using default reference rates. */
export function toCNY(amount: number, currency: SubscriptionCurrency): number {
  const rate = CURRENCY_META[currency]?.defaultRateCNY ?? 1;
  return amount * rate;
}

function amortizeToMonthly(perCycleCNY: number, cycle: SubscriptionCycle): number {
  if (cycle === 'weekly') return (perCycleCNY * 52) / 12;
  if (cycle === 'monthly') return perCycleCNY;
  if (cycle === 'quarterly') return perCycleCNY / 3;
  if (cycle === 'semiannual') return perCycleCNY / 6;
  return perCycleCNY / 12;
}

/** Personal payable amount per billing cycle for the primary subscription converted to CNY. */
export function cycleCostCNY(meta: SubscriptionMeta): number {
  return toCNY(personalPriceOriginal(meta), meta.currency);
}

/** Amortized monthly cost in CNY for a single child sub-account. */
export function subAccountMonthlyCNY(acc: SubscriptionSubAccount, parent: SubscriptionMeta): number {
  const st = acc.status ?? 'active';
  if (!isSubscriptionActiveStatus(st)) return 0;
  const cur = acc.currency ?? parent.currency;
  const cy = acc.cycle ?? parent.cycle;
  const netOrig = netPriceOriginal({ price: acc.price, discountAmount: acc.discountAmount });
  return amortizeToMonthly(toCNY(netOrig, cur), cy);
}

/** Amortized monthly cost in CNY for the primary subscription alone. */
export function primaryMonthlyCNY(meta: SubscriptionMeta): number {
  if (!isSubscriptionActiveStatus(meta.status)) return 0;
  return amortizeToMonthly(cycleCostCNY(meta), meta.cycle);
}

/** Amortized monthly cost in CNY for all active child sub-accounts combined. */
export function subAccountsTotalMonthlyCNY(meta: SubscriptionMeta): number {
  if (!meta.accounts?.length) return 0;
  return meta.accounts.reduce((sum, acc) => sum + subAccountMonthlyCNY(acc, meta), 0);
}

/** Total amortized monthly cost in CNY (primary subscription + all active child sub-accounts). */
export function monthlyEquivalentCNY(meta: SubscriptionMeta): number {
  return primaryMonthlyCNY(meta) + subAccountsTotalMonthlyCNY(meta);
}

/** Total amortized yearly cost in CNY. */
export function yearlyEquivalentCNY(meta: SubscriptionMeta): number {
  return monthlyEquivalentCNY(meta) * 12;
}

/** Monthly savings in CNY from split-bill sharing (0 when splitCount === 1). */
export function monthlySplitSavingsCNY(meta: SubscriptionMeta): number {
  const split = effectiveSplit(meta);
  if (split <= 1 || !isSubscriptionActiveStatus(meta.status)) return 0;
  const fullPrimary = primaryMonthlyCNY({ ...meta, splitCount: 1 });
  return Math.max(0, fullPrimary - primaryMonthlyCNY(meta));
}

/** Monthly savings in CNY from recurring cycle discounts (primary + sub-accounts). */
export function monthlyDiscountSavingsCNY(meta: SubscriptionMeta): number {
  let saved = 0;
  if (isSubscriptionActiveStatus(meta.status)) {
    const discOrig = cycleDiscountOriginal(meta) / effectiveSplit(meta);
    saved += amortizeToMonthly(toCNY(discOrig, meta.currency), meta.cycle);
  }
  for (const acc of meta.accounts ?? []) {
    if (!isSubscriptionActiveStatus(acc.status ?? 'active')) continue;
    const discOrig = cycleDiscountOriginal({ price: acc.price, discountAmount: acc.discountAmount });
    if (discOrig > 0) {
      saved += amortizeToMonthly(toCNY(discOrig, acc.currency ?? meta.currency), acc.cycle ?? meta.cycle);
    }
  }
  return saved;
}

/** Combined monthly savings in CNY (split-bill + recurring discounts). */
export function totalMonthlySavingsCNY(meta: SubscriptionMeta): number {
  return monthlySplitSavingsCNY(meta) + monthlyDiscountSavingsCNY(meta);
}

/** Count of accounts tracked under this subscription card (primary + child sub-accounts). */
export function totalAccountsCount(meta: SubscriptionMeta): number {
  return 1 + (meta.accounts?.length ?? 0);
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
  originalListOrig: number;
  discountOrig: number;
  promoPersonalOrig: number | null;
  promoSavingsOrig: number;
  inPromoNow: boolean;
  cycleCNY: number;
  primaryMonthlyCNY: number;
  subAccountsMonthlyCNY: number;
  monthlyCNY: number;
  yearlyCNY: number;
  monthlySavedCNY: number;
  totalAccountsCount: number;
  emblem: string;
  brandKey?: string;
  iconData?: string;
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
  const inferred = !meta.iconData && !meta.brandKey ? inferBrandFromTitle(task.title) : undefined;
  const personalOrig = personalPriceOriginal(meta);
  const originalListOrig = originalListPersonal(meta);
  const discountOrig = Math.max(0, originalListOrig - personalOrig);
  const promoPersonalOrig = promoPersonalOriginal(meta);
  const inPromoNow =
    promoPersonalOrig !== null && isWithinPromoPeriod(task.start, meta.cycle, refToday, meta.promoPeriods);
  const promoSavingsOrig = promoPersonalOrig !== null ? Math.max(0, personalOrig - promoPersonalOrig) : 0;
  const primaryMon = primaryMonthlyCNY(meta);
  const subAccMon = subAccountsTotalMonthlyCNY(meta);
  const totalMon = primaryMon + subAccMon;
  return {
    task,
    meta,
    window,
    personalOrig,
    originalListOrig,
    discountOrig,
    promoPersonalOrig,
    promoSavingsOrig,
    inPromoNow,
    cycleCNY: cycleCostCNY(meta),
    primaryMonthlyCNY: primaryMon,
    subAccountsMonthlyCNY: subAccMon,
    monthlyCNY: totalMon,
    yearlyCNY: totalMon * 12,
    monthlySavedCNY: totalMonthlySavingsCNY(meta),
    totalAccountsCount: totalAccountsCount(meta),
    emblem: meta.emblem || inferred?.emblem || task.title.trim().slice(0, 1).toUpperCase() || '◈',
    brandKey: meta.brandKey ?? inferred?.key,
    iconData: meta.iconData,
    brandColor: meta.brandColor || inferred?.brandColor || catMeta.color,
    watermark: meta.watermark?.trim() || task.title,
  };
}

/**
 * Projects a subscription task onto its upcoming billing/due date for display in main calendar grids
 * when `subscription.showOnCalendar` is enabled. Returns `null` when hidden, paused, or cancelled.
 */
export function projectSubscriptionForCalendar(task: Task, refToday: ISODate): Task | null {
  if (!isSubscriptionTask(task)) return null;
  const meta = task.subscription;
  if (!meta.showOnCalendar) return null;
  if (meta.status === 'paused' || meta.status === 'cancelled') return null;

  const win = computeCycleWindow(task.start, meta.cycle, refToday);
  const catMeta = CATEGORY_META[meta.category] ?? CATEGORY_META.other;
  const inferred = !meta.brandKey ? inferBrandFromTitle(task.title) : undefined;
  return {
    ...task,
    title: `${task.title} · 到期`,
    start: win.nextDate,
    end: win.nextDate,
    time: undefined,
    duration: undefined,
    repeat: undefined,
    color: task.color || meta.brandColor || inferred?.brandColor || catMeta.color,
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
      // Trials and 'ending' (auto-renew turned off) won't charge on future dates
      const willCharge =
        sub.meta.status === 'active' || (sub.meta.status === 'ending' && d <= refToday);
      const cost = willCharge ? sub.cycleCNY : 0;
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
  const active = subs.filter((s) => isSubscriptionActiveStatus(s.meta.status));
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

/** Normalize a pasted/typed hex string (#RGB, RGB, #RRGGBB, RRGGBB) into uppercase #RRGGBB, or null if invalid. */
export function normalizeHexColor(raw: string): string | null {
  const clean = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const [r, g, b] = clean.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean}`.toUpperCase();
  }
  return null;
}

export interface ParsedQuickSubscription {
  title: string;
  price: number;
  currency?: SubscriptionCurrency;
  cycle?: SubscriptionCycle;
}

/**
 * Lightweight shorthand parser for effortless entry:
 * e.g. "网易云 15", "ChatGPT 20$", "Netflix 68/年", "iCloud ¥21 月".
 * Carefully avoids false positives on product names like "iCloud+ 2TB" or "Office 365".
 */
export function parseQuickSubscriptionText(raw: string): ParsedQuickSubscription | null {
  const text = raw.trim();
  if (!text || text.length < 3) return null;

  // Match: <title> <sep> [currency-prefix] <number> [currency-suffix] [optional /cycle]
  const m = text.match(
    /^(.+?)\s+(HK\$|US\$|\$|¥|￥|€|£)?\s*(\d+(?:\.\d{1,2})?)\s*(元|块|rmb|cny|usd|hkd|eur|gbp|jpy|\$|¥|￥|€|£)?(?:\s*[/每]?\s*(周|月|季|半年|年|week|month|year))?$/i,
  );
  if (!m) return null;

  const title = m[1].trim();
  if (!title) return null;

  const numStr = m[3];
  const price = Number.parseFloat(numStr);
  if (!Number.isFinite(price) || price <= 0) return null;

  const pre = (m[2] ?? '').toUpperCase();
  const suf = (m[4] ?? '').toUpperCase();
  const cycRaw = (m[5] ?? '').toLowerCase();

  // Avoid false positives on model/plan numbers without explicit currency/cycle when title ends like "Office 365" or "GPT 4"
  if (!pre && !suf && !cycRaw && /^(365|202\d|100|4|4o|5)$/i.test(numStr) && /office|gpt|win|ios|android|pro|max/i.test(title)) {
    return null;
  }

  let currency: SubscriptionCurrency | undefined;
  const curTok = pre || suf;
  if (curTok === '$' || curTok === 'US$' || curTok === 'USD') currency = 'USD';
  else if (curTok === 'HK$' || curTok === 'HKD') currency = 'HKD';
  else if (curTok === '€' || curTok === 'EUR') currency = 'EUR';
  else if (curTok === '£' || curTok === 'GBP') currency = 'GBP';
  else if (curTok === 'JPY') currency = 'JPY';
  else if (curTok === '¥' || curTok === '￥' || curTok === '元' || curTok === '块' || curTok === 'RMB' || curTok === 'CNY') {
    currency = 'CNY';
  }

  let cycle: SubscriptionCycle | undefined;
  if (cycRaw === '周' || cycRaw === 'week') cycle = 'weekly';
  else if (cycRaw === '月' || cycRaw === 'month') cycle = 'monthly';
  else if (cycRaw === '季') cycle = 'quarterly';
  else if (cycRaw === '半年') cycle = 'semiannual';
  else if (cycRaw === '年' || cycRaw === 'year') cycle = 'yearly';

  return { title, price, currency, cycle };
}

export function formatDueCountdown(remainDays: number, status: SubscriptionStatus): string {
  if (status === 'paused') return '已暂停';
  if (status === 'cancelled') return '已退订';
  if (status === 'ending') {
    if (remainDays === 0) return '今日到期止续';
    if (remainDays === 1) return '明天到期止续';
    return `${remainDays}天后止续`;
  }
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
        paymentMethod: 'Apple Pay',
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
        price: 19.8,
        discountAmount: 3,
        promoPrice: 6.8,
        promoPeriods: 1,
        promoLabel: '首月特惠',
        currency: 'CNY',
        cycle: 'monthly',
        category: 'life',
        status: 'active',
        autoRenew: true,
        paymentMethod: '微信支付',
        emblem: '美',
        brandColor: '#D9A700',
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
        plan: 'Plus',
        price: 20,
        currency: 'USD',
        cycle: 'monthly',
        category: 'ai',
        status: 'active',
        autoRenew: true,
        paymentMethod: 'Visa · 4242',
        emblem: '✦',
        brandColor: '#10A37F',
        remindDaysBefore: 3,
        accounts: [
          {
            id: 'gpt-alt-1',
            label: '工作副号',
            plan: 'Plus',
            price: 20,
            currency: 'USD',
            cycle: 'monthly',
            status: 'ending',
            autoRenew: false,
            nextDate: addDays(refToday, 12),
          },
        ],
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
        status: 'ending',
        autoRenew: false,
        paymentMethod: '支付宝',
        emblem: '📺',
        brandColor: '#FB7299',
        remindDaysBefore: 5,
      },
    },
  ];
}

export { pad2 };
