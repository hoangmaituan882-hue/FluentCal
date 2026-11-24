import { describe, expect, it } from 'vitest';
import type { SubscriptionMeta, Task } from '@/types';
import {
  billingDatesInMonth,
  buildCategoryBreakdown,
  computeCycleWindow,
  formatDueCountdown,
  monthlyEquivalentCNY,
  monthlySplitSavingsCNY,
  normalizeHexColor,
  parseQuickSubscriptionText,
  projectSubscriptionForCalendar,
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

  it('defaults card watermark to the exact subscription title and projects due dates onto main calendar', () => {
    const netease = makeSubTask('网易云音乐', '2026-10-28', {
      price: 15,
      currency: 'CNY',
      cycle: 'monthly',
      category: 'media',
      showOnCalendar: true,
    });
    const resolved = resolveSubscription(netease, '2026-11-24');
    expect(resolved.watermark).toBe('网易云音乐');
    expect(resolved.brandKey).toBe('netease-music');

    const projected = projectSubscriptionForCalendar(netease, '2026-11-24');
    expect(projected?.start).toBe('2026-11-28');
    expect(projected?.end).toBe('2026-11-28');
    expect(projected?.title).toBe('网易云音乐 · 到期');

    const hidden = makeSubTask('HiddenSub', '2026-10-28', { showOnCalendar: false });
    expect(projectSubscriptionForCalendar(hidden, '2026-11-24')).toBeNull();
  });

  it('normalizes pasted #Hex color inputs and parses quick subscription shorthand safely', () => {
    expect(normalizeHexColor('#d43c33')).toBe('#D43C33');
    expect(normalizeHexColor(' 1db954 ')).toBe('#1DB954');
    expect(normalizeHexColor('#f0a')).toBe('#FF00AA');
    expect(normalizeHexColor('not-a-color')).toBeNull();

    expect(parseQuickSubscriptionText('网易云音乐 15')).toEqual({
      title: '网易云音乐',
      price: 15,
      currency: undefined,
      cycle: undefined,
    });
    expect(parseQuickSubscriptionText('ChatGPT Plus 20$')).toEqual({
      title: 'ChatGPT Plus',
      price: 20,
      currency: 'USD',
      cycle: undefined,
    });
    expect(parseQuickSubscriptionText('Netflix ¥68/年')).toEqual({
      title: 'Netflix',
      price: 68,
      currency: 'CNY',
      cycle: 'yearly',
    });
    // Must not falsely split product names like Office 365 or iCloud+ 2TB
    expect(parseQuickSubscriptionText('Office 365')).toBeNull();
    expect(parseQuickSubscriptionText('iCloud+ 2TB')).toBeNull();
  });

  it('calculates ending status, recurring discounts, first-month promos, and multi-account AI sub-subscriptions', () => {
    const promoSub = resolveSubscription(
      makeSubTask('美团神会员', '2026-11-10', {
        price: 19.8,
        discountAmount: 3,
        promoPrice: 6.8,
        promoPeriods: 1,
        currency: 'CNY',
        cycle: 'monthly',
        category: 'life',
        status: 'active',
        autoRenew: true,
      }),
      '2026-11-24',
    );
    expect(promoSub.originalListOrig).toBeCloseTo(19.8, 2);
    expect(promoSub.personalOrig).toBeCloseTo(16.8, 2);
    expect(promoSub.discountOrig).toBeCloseTo(3, 2);
    expect(promoSub.promoPersonalOrig).toBeCloseTo(6.8, 2);
    expect(promoSub.promoSavingsOrig).toBeCloseTo(10, 2);
    expect(promoSub.inPromoNow).toBe(true);
    expect(promoSub.monthlySavedCNY).toBeCloseTo(3, 2);

    const aiMulti = resolveSubscription(
      makeSubTask('ChatGPT Plus', '2026-11-26', {
        price: 20,
        currency: 'USD',
        cycle: 'monthly',
        category: 'ai',
        status: 'active',
        autoRenew: true,
        accounts: [
          { id: 'alt-1', label: '工作副号', plan: 'Plus', price: 20, status: 'ending', autoRenew: false },
          { id: 'alt-2', label: '已停号', plan: 'Pro', price: 200, status: 'paused', autoRenew: false },
        ],
      }),
      '2026-11-24',
    );
    expect(aiMulti.totalAccountsCount).toBe(3);
    expect(aiMulti.primaryMonthlyCNY).toBeCloseTo(20 * 7.25, 2);
    expect(aiMulti.subAccountsMonthlyCNY).toBeCloseTo(20 * 7.25, 2);
    expect(aiMulti.monthlyCNY).toBeCloseTo(40 * 7.25, 2);

    const endingSub = resolveSubscription(
      makeSubTask('B站大会员', '2026-11-28', {
        price: 148,
        currency: 'CNY',
        cycle: 'yearly',
        status: 'ending',
        autoRenew: false,
      }),
      '2026-11-24',
    );
    expect(formatDueCountdown(endingSub.window.remainDays, 'ending')).toBe('4天后止续');
    // Ending subscription does not charge on future dates in monthly billing summary
    const sum = summarizeMonthBilling([endingSub], 2026, 11, '2026-11-24');
    expect(sum.remainingMonthCNY).toBe(0);
    expect(sum.eventCount).toBe(1);
  });
});
