import { describe, expect, it } from 'vitest';
import type { HabitMeta, Task } from '@/types';
import { addDays } from './date';
import {
  buildHabitHeatmap,
  buildHabitMilestoneJourney,
  buildHabitRecentBars,
  buildHabitWeeklyPillars,
  buildHabitWeekRings,
  computeCurrentStreak,
  computeHabitStrength,
  computeHabitTimeInsights,
  computeHabitWeekdayRates,
  defaultWidgetStyleForHabit,
  evaluateHabitDay,
  evaluateHabitWindow,
  extractHeatmapMonthTicks,
  getHabitMilestone,
  guessHabitIcon,
  nextHabitWidgetStyle,
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

  it('maps tailored macOS widget defaults by habit type and builds Rings, Bars, Pillars & Journey data', () => {
    expect(defaultWidgetStyleForHabit({ kind: 'check', weeklyTarget: 7, iconKey: 'meditate' })).toBe('rings');
    expect(defaultWidgetStyleForHabit({ kind: 'check', weeklyTarget: 4, iconKey: 'dumbbell' })).toBe('pillars');
    expect(defaultWidgetStyleForHabit({ kind: 'count', weeklyTarget: 7, iconKey: 'water' })).toBe('gauge');
    expect(defaultWidgetStyleForHabit({ kind: 'count', weeklyTarget: 7, iconKey: 'book' })).toBe('bars');
    expect(defaultWidgetStyleForHabit({ kind: 'quit', weeklyTarget: 7, iconKey: 'moon' })).toBe('journey');

    const today = '2026-11-24';
    const start = addDays(today, -30);
    const countMeta: HabitMeta = {
      kind: 'count',
      target: 30,
      step: 10,
      unit: '分钟',
      weeklyTarget: 7,
      timeOfDay: 'evening',
      color: '#7C3AED',
      logs: {
        [today]: 20,
        [addDays(today, -1)]: 35,
        [addDays(today, -2)]: 30,
      },
    };
    const rings = buildHabitWeekRings(countMeta, start, today, today, 1);
    expect(rings).toHaveLength(7);
    expect(rings.find((r) => r.isToday)?.value).toBe(20);

    const bars = buildHabitRecentBars(countMeta, start, today, today, 4);
    expect(bars.rows).toHaveLength(4);
    expect(bars.targetLinePct).toBeGreaterThan(50);
    expect(bars.targetLinePct).toBeLessThan(95);

    const pillars = buildHabitWeeklyPillars(countMeta, start, today, 1, 4);
    expect(pillars).toHaveLength(4);
    expect(pillars[3].isCurrent).toBe(true);

    const journey = buildHabitMilestoneJourney(16);
    expect(journey.nextMilestone).toBe(21);
    expect(journey.daysToNext).toBe(5);
    expect(journey.stations).toHaveLength(5);
    expect(journey.stations.filter((s) => s.reached).length).toBeGreaterThanOrEqual(3);
  });

  it('computes fixed time-window live countdowns and aggregates chronotype check-in timestamps', () => {
    const today = '2026-11-24';
    const baseMeta: HabitMeta = {
      kind: 'check',
      target: 1,
      weeklyTarget: 7,
      timeOfDay: 'morning',
      windowStart: '07:15',
      windowEnd: '08:00',
      color: '#10A37F',
      logs: {},
      logTimes: {},
    };
    expect(defaultWidgetStyleForHabit(baseMeta)).toBe('window');

    const emptyDay = evaluateHabitDay(baseMeta, '2026-11-01', today, today);
    // 06:30 -> 45m before 07:15 window
    const upcoming = evaluateHabitWindow(baseMeta, emptyDay, 6 * 60 + 30, today);
    expect(upcoming.phase).toBe('upcoming');
    expect(upcoming.primaryReadout).toBe('45m');

    // 07:35 -> inside 07:15-08:00 window (25m left)
    const active = evaluateHabitWindow(baseMeta, emptyDay, 7 * 60 + 35, today);
    expect(active.phase).toBe('active');
    expect(active.primaryReadout).toBe('25m');

    // Check off with recorded clock timestamp "07:28"
    let logged = toggleCheckHabit(baseMeta, today, '07:28');
    logged = toggleCheckHabit(logged, addDays(today, -1), '07:45');
    logged = toggleCheckHabit(logged, addDays(today, -2), '07:12');
    logged = toggleCheckHabit(logged, addDays(today, -3), '21:10');
    const doneDay = evaluateHabitDay(logged, '2026-11-01', today, today);
    const doneWin = evaluateHabitWindow(logged, doneDay, 8 * 60 + 10, today);
    expect(doneWin.phase).toBe('done');
    expect(doneWin.primaryReadout).toBe('07:28');

    const task = makeHabitTask('晨间正念呼吸', '2026-11-01', logged);
    const resolved = resolveHabit(task, today, today, 1);
    const insights = computeHabitTimeInsights([resolved], today);
    expect(insights.totalLogs).toBe(4);
    expect(insights.earliest?.time).toBe('07:12');
    expect(insights.latest?.time).toBe('21:10');
    expect(insights.peakHour?.hour).toBe(7);
    expect(insights.hourBuckets).toHaveLength(24);
    expect(insights.recentDailyPoints).toHaveLength(14);

    // Quick-cycle widget styles forward & backward with clean wrap-around
    expect(nextHabitWidgetStyle('window', 1)).toBe('spectrum');
    expect(nextHabitWidgetStyle('heatmap', 1)).toBe('window');
    expect(nextHabitWidgetStyle('window', -1)).toBe('heatmap');
  });
});
