import { describe, expect, it } from 'vitest';
import type { HabitMeta, Task } from '@/types';
import { addDays } from './date';
import {
  buildHabitHeatmap,
  computeCurrentStreak,
  computeHabitStrength,
  computeHabitWeekdayRates,
  evaluateHabitDay,
  extractHeatmapMonthTicks,
  getHabitMilestone,
  guessHabitIcon,
  resolveHabit,
  stepCountHabit,
  toggleCheckHabit,
  toggleQuitRelapse,
  toggleSkipHabit,
} from './habits';

function makeHabitTask(id: string, start: string, meta: Partial<HabitMeta>): Task & { habit: HabitMeta } {
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
    habitOnly: true,
    habit: {
      kind: 'check',
      target: 1,
      weeklyTarget: 7,
      timeOfDay: 'anytime',
      iconKey: 'meditate',
      color: '#10A37F',
      logs: {},
      ...meta,
    },
  };
}

describe('habits engine (check, count, quit & anti-guilt strength)', () => {
  it('supports check, quantitative count stepping, skip rest days, and quit relapse toggling', () => {
    const today = '2026-11-24';

    // Check habit
    let checkMeta: HabitMeta = {
      kind: 'check',
      target: 1,
      weeklyTarget: 7,
      timeOfDay: 'morning',
      color: '#10A37F',
      logs: {},
    };
    checkMeta = toggleCheckHabit(checkMeta, today);
    expect(evaluateHabitDay(checkMeta, '2026-11-01', today, today).state).toBe('done');
    checkMeta = toggleSkipHabit(checkMeta, today);
    expect(evaluateHabitDay(checkMeta, '2026-11-01', today, today).state).toBe('skip');

    // Quantitative count habit (4-step intensity levels)
    let countMeta: HabitMeta = {
      kind: 'count',
      target: 8,
      step: 2,
      unit: '杯',
      weeklyTarget: 7,
      timeOfDay: 'anytime',
      color: '#0EA5E9',
      logs: {},
    };
    countMeta = stepCountHabit(countMeta, today); // 2/8 = 25% -> level 1
    expect(evaluateHabitDay(countMeta, '2026-11-01', today, today)).toMatchObject({ state: 'partial', value: 2, level: 1 });
    countMeta = stepCountHabit(countMeta, today, 6); // 8/8 = 100% -> level 4 done
    expect(evaluateHabitDay(countMeta, '2026-11-01', today, today)).toMatchObject({ state: 'done', value: 8, level: 4 });

    // Quit habit: clean days automatically accumulate from startDate; relapse marks cleanly without erasing history
    let quitMeta: HabitMeta = {
      kind: 'quit',
      target: 1,
      weeklyTarget: 7,
      timeOfDay: 'evening',
      color: '#4F46E5',
      logs: {},
    };
    const start = addDays(today, -9); // 10 clean days including today
    expect(computeCurrentStreak(quitMeta, start, today)).toBe(10);
    quitMeta = toggleQuitRelapse(quitMeta, addDays(today, -3));
    expect(evaluateHabitDay(quitMeta, start, addDays(today, -3), today).state).toBe('relapse');
    expect(computeCurrentStreak(quitMeta, start, today)).toBe(3); // 3 clean days since relapse
  });

  it('computes anti-guilt exponential smoothing habit strength and preserves streaks across skip days', () => {
    const today = '2026-11-24';
    const start = addDays(today, -29);
    const logs: HabitMeta['logs'] = {};
    for (let i = 29; i >= 0; i--) {
      logs[addDays(today, -i)] = 1;
    }
    const perfect: HabitMeta = {
      kind: 'check',
      target: 1,
      weeklyTarget: 7,
      timeOfDay: 'anytime',
      color: '#10A37F',
      logs,
    };
    const perfectStrength = computeHabitStrength(perfect, start, today);
    expect(perfectStrength).toBeGreaterThanOrEqual(75);

    // One single missed day only dips strength gently (anti-guilt, NOT reset to 0!)
    const oneMiss: HabitMeta = { ...perfect, logs: { ...logs } };
    delete oneMiss.logs[addDays(today, -1)];
    const dipStrength = computeHabitStrength(oneMiss, start, today);
    expect(dipStrength).toBeLessThan(perfectStrength);
    expect(dipStrength).toBeGreaterThan(perfectStrength - 12);

    // Skip rest day preserves both streak and strength cleanly
    const withSkip: HabitMeta = { ...perfect, logs: { ...logs, [addDays(today, -2)]: 'skip' } };
    expect(computeCurrentStreak(withSkip, start, today)).toBe(29);
    expect(computeHabitStrength(withSkip, start, today)).toBeGreaterThanOrEqual(perfectStrength - 2);
  });

  it('builds a HabitKit column-major heatmap aligned by weekday and resolves complete habit summary', () => {
    const today = '2026-11-24';
    const task = makeHabitTask('阅读 30 分钟', addDays(today, -40), {
      kind: 'count',
      target: 30,
      step: 10,
      unit: '分钟',
      logs: { [today]: 30, [addDays(today, -1)]: 15 },
    });
    const grid = buildHabitHeatmap(task.habit, task.start, today, 12, 1);
    expect(grid.length).toBe(12);
    expect(grid.every((col) => col.length === 7)).toBe(true);
    expect(grid.flat().some((c) => c.isToday && c.state === 'done')).toBe(true);

    const resolved = resolveHabit(task, today, today, 1);
    expect(resolved.day.state).toBe('done');
    expect(resolved.totalDoneDays).toBe(1);
    expect(resolved.currentStreak).toBe(1);
  });

  it('auto-matches habit icons from titles, computes weekday consistency rates, month ticks, and milestones', () => {
    expect(guessHabitIcon('每天喝水 8 杯')?.key).toBe('water');
    expect(guessHabitIcon('戒含糖奶茶')?.key).toBe('nosugar');
    expect(guessHabitIcon('LeetCode 每日一题')?.key).toBe('code');
    expect(guessHabitIcon('随便写点啥')).toBeNull();

    const today = '2026-11-24';
    const start = addDays(today, -27);
    const logs: HabitMeta['logs'] = {};
    for (let i = 0; i < 4; i++) {
      logs[addDays(today, -7 * i)] = 1;
    }
    const meta: HabitMeta = {
      kind: 'check',
      target: 1,
      weeklyTarget: 7,
      timeOfDay: 'morning',
      color: '#10A37F',
      logs,
    };
    const rates = computeHabitWeekdayRates(meta, start, today, 1);
    expect(rates).toHaveLength(7);
    expect(rates.find((r) => r.wd === 2)?.rate).toBe(100);
    expect(rates.find((r) => r.wd === 3)?.rate).toBe(0);

    const grid = buildHabitHeatmap(meta, start, today, 16, 1);
    const ticks = extractHeatmapMonthTicks(grid);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.some((t) => t.label === '11月')).toBe(true);

    expect(getHabitMilestone(21)).toBe(21);
    expect(getHabitMilestone(22)).toBeNull();
  });
});
