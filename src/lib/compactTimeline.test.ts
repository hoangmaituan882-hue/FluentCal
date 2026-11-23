import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import type { Occurrence } from '@/lib/recur';
import {
  clusterColors,
  clusterDayEvents,
  findNowOrNext,
  formatCompactDateLabel,
  stepDesktopMultiDays,
  stepZoomDays,
  visibleDatesForSpan,
  type CompactEventInput,
} from './compactTimeline';

function makeOcc(id: string, title: string, time?: string, duration?: number, done = false): Occurrence {
  const task: Task = {
    id,
    title,
    start: '2026-11-23',
    end: '2026-11-23',
    time,
    duration,
    progress: done ? 100 : 0,
    done,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
  return { task, date: '2026-11-23', start: '2026-11-23', end: '2026-11-23', done };
}

describe('compactTimeline helpers', () => {
  it('steps zoom day spans across [1, 2, 3, 4, 5, 7] and clamps bounds', () => {
    expect(stepZoomDays(1, -1)).toBe(1);
    expect(stepZoomDays(1, 1)).toBe(2);
    expect(stepZoomDays(2, 1)).toBe(3);
    expect(stepZoomDays(5, 1)).toBe(7);
    expect(stepZoomDays(7, 1)).toBe(7);
    expect(stepZoomDays(7, -1)).toBe(5);
  });

  it('computes visible date windows for single, multi-day, and full-week spans', () => {
    expect(visibleDatesForSpan('2026-11-25', 1, 1)).toEqual(['2026-11-25']);
    expect(visibleDatesForSpan('2026-11-25', 3, 1)).toEqual(['2026-11-25', '2026-11-26', '2026-11-27']);
    expect(visibleDatesForSpan('2026-11-25', 5, 1)).toEqual([
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
    ]);
    // 2026-11-25 is Wednesday -> Monday weekStart gives Nov 23..29, Sunday weekStart gives Nov 22..28
    expect(visibleDatesForSpan('2026-11-25', 7, 1)[0]).toBe('2026-11-23');
    expect(visibleDatesForSpan('2026-11-25', 7, 0)[0]).toBe('2026-11-22');
  });

  it('keeps single cards expanded when zoomed in and clusters tightly packed cards when zoomed out', () => {
    const sample: CompactEventInput[] = [
      { id: 'a', title: 'Standup', startMin: 9 * 60, endMin: 9 * 60 + 30, color: '#3b82f6', done: false, order: 1 },
      { id: 'b', title: 'Lunch', startMin: 12 * 60, endMin: 13 * 60, color: '#22c55e', done: false, order: 2 },
      { id: 'c', title: 'Review', startMin: 13 * 60, endMin: 15 * 60, color: '#22c55e', done: false, order: 3 },
    ];

    const expanded = clusterDayEvents(sample, 58, 1);
    expect(expanded.every((x) => x.kind === 'single')).toBe(true);
    expect(expanded).toHaveLength(3);

    const collapsed = clusterDayEvents(sample, 32, 1);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]).toMatchObject({ kind: 'single', id: 'a' });
    expect(collapsed[1]).toMatchObject({ kind: 'cluster', count: 2, startMin: 720, endMin: 900 });

    const weekCollapsed = clusterDayEvents(sample, 58, 7);
    expect(weekCollapsed).toHaveLength(2);
    expect(weekCollapsed[1]).toMatchObject({ kind: 'cluster', count: 2 });
  });

  it('selects Now, Next, AllDay, and Idle live status cleanly', () => {
    const occs = [
      makeOcc('1', 'Morning Sync', '09:00', 60),
      makeOcc('2', 'Design Review', '14:00', 90),
      makeOcc('3', 'Buy Coffee'),
    ];

    expect(findNowOrNext(occs, 9 * 60 + 20)).toMatchObject({
      state: 'now',
      prefix: '进行中',
      title: 'Morning Sync',
      timeHint: '09:00 – 10:00',
    });

    expect(findNowOrNext(occs, 11 * 60)).toMatchObject({
      state: 'next',
      prefix: '接下来',
      title: 'Design Review',
      timeHint: '14:00',
    });

    expect(findNowOrNext(occs, 17 * 60)).toMatchObject({
      state: 'allday',
      prefix: '今日待办',
      title: 'Buy Coffee',
      timeHint: '1 项',
    });

    expect(findNowOrNext([makeOcc('done', 'Finished', '09:00', 60, true)], 9 * 60 + 10)).toMatchObject({
      state: 'idle',
      prefix: '今日日程已清空',
    });
  });

  it('steps desktop multiday spans, extracts cluster colors, and formats 4-tier date headers', () => {
    expect(stepDesktopMultiDays(2, -1)).toBe(2);
    expect(stepDesktopMultiDays(3, 1)).toBe(4);
    expect(stepDesktopMultiDays(5, 1)).toBe(7);
    expect(stepDesktopMultiDays(7, 1)).toBe(7);

    expect(
      clusterColors([
        { color: '#22c55e' },
        { color: '#22c55e' },
        { color: '#3b82f6' },
        { color: '#f59e0b' },
        { color: '#ef4444' },
      ]),
    ).toEqual(['#22c55e', '#3b82f6', '#f59e0b']);

    // 2026-11-23 is Monday
    expect(formatCompactDateLabel('2026-11-23', 1, '2026-11-23')).toEqual({
      primary: '11月23日 周一',
      stacked: false,
    });
    expect(formatCompactDateLabel('2026-11-23', 2, '2026-11-23')).toEqual({
      primary: '11/23 周一',
      stacked: false,
    });
    expect(formatCompactDateLabel('2026-11-23', 3, '2026-11-23')).toEqual({
      primary: '周一 23',
      stacked: false,
    });
    expect(formatCompactDateLabel('2026-11-23', 5, '2026-11-23')).toEqual({
      primary: '23',
      secondary: '周一',
      stacked: true,
    });
    expect(formatCompactDateLabel('2026-11-23', 7, '2026-11-23')).toEqual({
      primary: '23',
      secondary: '一',
      stacked: true,
    });
  });
});
