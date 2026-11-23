import { afterEach, describe, expect, it } from 'vitest';
import { countdowns, customCountdownTasks, describeCustomCountdown } from './countdown';
import type { Task } from '@/types';
import { DEFAULT_SETTINGS, mergeDefaults } from '@/defaults';
import { setHolidayOverrides } from './lunar';

const task = (id: string, groupId?: string, countdown = false): Task => ({ id, title: id, groupId, countdown, start: '2026-11-25', end: '2026-11-25', progress: 0, done: false, order: 1, createdAt: 0, updatedAt: 0 });
describe('countdown sources', () => {
  afterEach(() => setHolidayOverrides({}));

  it('defaults to marked tasks and ordinary festivals', () => {
    expect(DEFAULT_SETTINGS.calendar.countdownMarked).toBe(true);
    expect(DEFAULT_SETTINGS.calendar.countdownFestival).toBe(true);
    expect(DEFAULT_SETTINGS.calendar.holidayCountdown).toBe(false);
    expect(DEFAULT_SETTINGS.calendar.countdownTerm).toBe(false);
    const savedLegacy = mergeDefaults(DEFAULT_SETTINGS, { calendar: { countdownMarked: true, countdownFestival: false, holidayCountdown: true } });
    expect(savedLegacy.calendar.countdownMarked).toBe(true);
    expect(savedLegacy.calendar.countdownFestival).toBe(false);
    expect(savedLegacy.calendar.holidayCountdown).toBe(true);
  });

  it('unions marked tasks and groups, and keeps an empty selection empty', () => {
    const tasks = [task('a', 'birthday', true), task('b', 'birthday'), task('c', undefined, true)];
    const ids = (marked: boolean, groups: string[]) => countdowns(tasks, '2026-11-21', false, marked, groups).map(c => c.key);
    expect(ids(true, [])).toEqual(['a', 'c']);
    expect(ids(false, ['birthday'])).toEqual(['a', 'b']);
    expect(ids(true, ['birthday'])).toEqual(['a', 'b', 'c']);
    expect(ids(false, [])).toEqual([]);
  });

  it('adds independently selected festival and solar-term sources', () => {
    const festivals = countdowns([], '2026-11-03', false, false, [], true, false);
    const terms = countdowns([], '2026-11-03', false, false, [], false, true);
    expect(festivals.length).toBeGreaterThan(1);
    expect(festivals.every(item => item.key.startsWith('festival:'))).toBe(true);
    expect(terms.length).toBeGreaterThan(10);
    expect(terms.every(item => item.key.startsWith('term:'))).toBe(true);
    expect(countdowns([], '2026-11-03', false, false, [])).toEqual([]);
  });

  it('keeps the statutory holiday-only legacy selection to one item', () => {
    expect(countdowns([], '2026-09-20', true, false, [], false, false).map(item => item.date)).toEqual(['2026-09-25']);
  });

  it('counts a multi-day statutory holiday from its first day only', () => {
    setHolidayOverrides({ '2027': { year: 2027, fetchedAt: 0, days: ['2027-01-01', '2027-01-02', '2027-01-03'].map(date => ({ date, name: '元旦', isOffDay: true })) } });
    const newYear = countdowns([], '2026-11-22', true, false, [], true, false).filter(item => item.date.startsWith('2027-01-') && item.label.includes('元旦'));
    expect(newYear).toHaveLength(1);
    expect(newYear[0]).toMatchObject({ date: '2027-01-01', days: 40 });
  });

  it('unions observances on the same day and treats ungrouped as opt-in', () => {
    const sameDay = countdowns([], '2026-04-04', true, false, [], false, true).filter(item => item.date === '2026-04-05');
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0]?.label).toContain('清明');
    expect(countdowns([task('u')], '2026-11-21', false, false, [])).toEqual([]);
    expect(countdowns([task('u')], '2026-11-21', false, false, ['']).map(item => item.key)).toEqual(['u']);
  });

  it('supports custom countdowns (down/up/pinned/yearly) and still returns them when holidayCountdown is on alone', () => {
    const anniv: Task = {
      ...task('anniv', undefined, true),
      title: '入职纪念日',
      start: '2025-11-23',
      end: '2025-11-23',
      countdownOnly: true,
      countdownMode: 'up',
      countdownPinned: true,
      color: 'orange',
    };
    const exam: Task = {
      ...task('exam', undefined, true),
      title: '考试',
      start: '2026-12-01',
      end: '2026-12-01',
      countdownOnly: true,
    };
    const yearlyBday: Task = {
      ...task('bday', undefined, true),
      title: '生日',
      start: '2025-11-30',
      end: '2025-11-30',
      countdownOnly: true,
      repeat: { freq: 'yearly', interval: 1 },
    };
    const futureUp: Task = {
      ...task('fut', undefined, true),
      title: '未来起算日',
      start: '2026-11-28',
      end: '2026-11-28',
      countdownOnly: true,
      countdownMode: 'up',
    };
    const res = countdowns([exam, yearlyBday, anniv, futureUp], '2026-11-23', true, true, [], false, false);
    // Pinned anniversary comes first despite higher elapsed day count, and holidayCountdown alone does not drop custom items
    expect(res[0]).toMatchObject({ key: 'anniv', mode: 'up', days: 365, pinned: true, color: 'orange', custom: true });
    expect(res.find(i => i.key === 'fut')).toMatchObject({ mode: 'down', days: 5 });
    expect(res.find(i => i.key === 'bday')).toMatchObject({ date: '2026-11-30', days: 7 });
    expect(res.find(i => i.key === 'exam')).toMatchObject({ date: '2026-12-01', days: 8 });
    expect(res.some(i => i.key.startsWith('holiday:'))).toBe(true);
  });

  it('lists custom countdowns and describes expired one-off targets', () => {
    const expired: Task = { ...task('old', undefined, true), start: '2026-11-10', end: '2026-11-10', countdownOnly: true };
    const regular = task('reg', undefined, false);
    const list = customCountdownTasks([regular, expired]);
    expect(list.map(t => t.id)).toEqual(['old']);
    expect(describeCustomCountdown(expired, '2026-11-23')).toEqual({
      days: 13,
      mode: 'down',
      expired: true,
      nextDate: '2026-11-10',
    });
  });
});
