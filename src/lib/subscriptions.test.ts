import { describe, expect, it } from 'vitest';
import type { SubscriptionMeta, Task } from '@/types';
import {
  billingDatesInMonth,
  buildCategoryBreakdown,
  computeCycleWindow,
  monthlyEquivalentCNY,
  monthlySplitSavingsCNY,
  resolveSubscription,
  summarizeMonthBilling,
  yearlyEquivalentCNY,
} from './subscriptions';

function makeSubTask(id: string, start: string, meta: Partial<SubscriptionMeta>): Task & { subscription: SubscriptionMeta } {
  return {
    id,
    title: id,
    start,
    end: start,
    progress: 0,
    done: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    subscriptionOnly: true,
    subscription: {
      price: 20,
      currency: 'USD',
      cycle: 'monthly',
      category: 'ai',
      status: 'active',
      autoRenew: true,
      ...meta,
    },
  };
}

describe('subscriptions engine', () => {
  it('computes monthly/yearly CNY equivalents and family split-bill savings', () => {
    const icloud: SubscriptionMeta = {
      price: 68,
      currency: 'CNY',
      cycle: 'monthly',
      category: 'cloud',
      status: 'active',
      autoRenew: true,
      splitCount: 6,
    };
    expect(monthlyEquivalentCNY(icloud)).toBeCloseTo(68 / 6, 3);
    expect(monthlySplitSavingsCNY(icloud)).toBeCloseTo(68 - 68 / 6, 3);

    const usdYearly: SubscriptionMeta = {
      price: 120,
      currency: 'USD',
      cycle: 'yearly',
      category: 'ai',
      status: 'active',
      autoRenew: true,
    };
    expect(monthlyEquivalentCNY(usdYearly)).toBeCloseTo(10 * 7.25, 2);
    expect(yearlyEquivalentCNY(usdYearly)).toBeCloseTo(120 * 7.25, 2);
  });

  it('clamps month-end billing dates cleanly across February and computes cycle progress', () => {
    const win = computeCycleWindow('2026-01-31', 'monthly', '2026-02-20');
    expect(win.prevDate).toBe('2026-01-31');
    expect(win.nextDate).toBe('2026-02-28');
    expect(win.remainDays).toBe(8);
    expect(win.totalDays).toBe(28);
    expect(win.progressPct).toBe(Math.round((20 / 28) * 100));
  });

  it('maps monthly and weekly billing dates and summarizes month totals & category slices', () => {
    const s1 = resolveSubscription(
      makeSubTask('ChatGPT', '2026-10-26', { price: 20, currency: 'USD', cycle: 'monthly', category: 'ai' }),
      '2026-11-24',
    );
    const s2 = resolveSubscription(
      makeSubTask('WeeklyGym', '2026-11-02', { price: 50, currency: 'CNY', cycle: 'weekly', category: 'life' }),
      '2026-11-24',
    );
    const sPaused = resolveSubscription(
      makeSubTask('PausedApp', '2026-11-10', { price: 100, currency: 'CNY', status: 'paused', category: 'work' }),
      '2026-11-24',
    );

    expect(billingDatesInMonth(s1, 2026, 11)).toEqual(['2026-11-26']);
    expect(billingDatesInMonth(s2, 2026, 11)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    expect(billingDatesInMonth(sPaused, 2026, 11)).toEqual([]);

    const summary = summarizeMonthBilling([s1, s2, sPaused], 2026, 11, '2026-11-24');
    expect(summary.eventCount).toBe(6);
    expect(summary.monthTotalCNY).toBeCloseTo(20 * 7.25 + 250, 2);
    expect(summary.billedSoFarCNY).toBeCloseTo(200, 2);

    const breakdown = buildCategoryBreakdown([s1, s2, sPaused], 'month');
    expect(breakdown.map((b) => b.category)).toEqual(['life', 'ai']);
    expect(Math.round(breakdown.reduce((a, b) => a + b.percent, 0))).toBe(100);
  });
});
