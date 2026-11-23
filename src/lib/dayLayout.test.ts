import { describe, expect, it } from 'vitest';
import {
  applyTimelineDraftPatch,
  computeCreateRange,
  floorMinutes,
  formatDurationLabel,
  formatMinToHHMM,
  formatRangeLabel,
  layoutDayEvents,
  parseTimeMin,
  pendingDraftFromTask,
  snapMinutes,
} from './dayLayout';
import type { Task } from '@/types';

describe('dayLayout helpers', () => {
  it('parses and formats HH:mm minutes safely', () => {
    expect(parseTimeMin('09:30')).toBe(570);
    expect(parseTimeMin('23:45')).toBe(1425);
    expect(parseTimeMin('invalid')).toBe(540);
    expect(parseTimeMin(undefined)).toBe(540);

    expect(formatMinToHHMM(0)).toBe('00:00');
    expect(formatMinToHHMM(570)).toBe('09:30');
    expect(formatMinToHHMM(1440)).toBe('24:00');
    expect(formatMinToHHMM(1500)).toBe('24:00');
  });

  it('snaps minutes to 15m increments and formats durations', () => {
    expect(snapMinutes(577)).toBe(570);
    expect(snapMinutes(578)).toBe(585);
    expect(formatDurationLabel(15)).toBe('15m');
    expect(formatDurationLabel(45)).toBe('45m');
    expect(formatDurationLabel(60)).toBe('1h');
    expect(formatDurationLabel(120)).toBe('2h');
    expect(formatDurationLabel(225)).toBe('3h 45m');

    expect(formatRangeLabel(795, 915)).toBe('13:15 – 15:15');
    expect(formatRangeLabel(795, 915, true)).toBe('13:15 – 15:15 · 2h');
    expect(formatRangeLabel(795, 1020, true)).toBe('13:15 – 17:00 · 3h 45m');
  });
});

describe('layoutDayEvents', () => {
  it('assigns full width when events do not overlap, including touching boundaries', () => {
    const res = layoutDayEvents([
      { id: 'lunch', startMin: 12 * 60, endMin: 13 * 60 },
      { id: 'review', startMin: 13 * 60, endMin: 14 * 60 },
    ]);
    expect(res).toEqual([
      { id: 'lunch', startMin: 720, endMin: 780, col: 0, colCount: 1 },
      { id: 'review', startMin: 780, endMin: 840, col: 0, colCount: 1 },
    ]);
  });

  it('splits two overlapping events into two columns', () => {
    const res = layoutDayEvents([
      { id: 'lunch', startMin: 12 * 60, endMin: 13 * 60 },
      { id: 'review', startMin: 12 * 60 + 15, endMin: 13 * 60 + 15 },
    ]);
    expect(res.find((x) => x.id === 'lunch')).toMatchObject({ col: 0, colCount: 2 });
    expect(res.find((x) => x.id === 'review')).toMatchObject({ col: 1, colCount: 2 });
  });

  it('keeps stationary events anchored on the left while preferRightId claims right column', () => {
    const res = layoutDayEvents(
      [
        { id: 'standup', startMin: 9 * 60 + 30, endMin: 9 * 60 + 45 },
        { id: 'roadmap', startMin: 10 * 60, endMin: 11 * 60 },
        { id: 'lunch', startMin: 12 * 60, endMin: 13 * 60 },
        { id: 'review', startMin: 9 * 60, endMin: 12 * 60 + 45 },
      ],
      'review',
    );

    expect(res.find((x) => x.id === 'standup')).toMatchObject({ col: 0, colCount: 2 });
    expect(res.find((x) => x.id === 'roadmap')).toMatchObject({ col: 0, colCount: 2 });
    expect(res.find((x) => x.id === 'lunch')).toMatchObject({ col: 0, colCount: 2 });
    expect(res.find((x) => x.id === 'review')).toMatchObject({ col: 1, colCount: 2 });
  });

  it('handles three simultaneously overlapping events across three columns', () => {
    const res = layoutDayEvents([
      { id: 'a', startMin: 600, endMin: 720 },
      { id: 'b', startMin: 630, endMin: 690 },
      { id: 'c', startMin: 645, endMin: 705 },
    ]);
    expect(res.map((x) => x.col).sort()).toEqual([0, 1, 2]);
    expect(res.every((x) => x.colCount === 3)).toBe(true);
  });
});

describe('computeCreateRange', () => {
  it('floors start slots and expands downward monotonically in 15m steps', () => {
    expect(floorMinutes(608)).toBe(600);
    expect(computeCreateRange(608, 608)).toEqual({ startMin: 600, endMin: 615, pillMin: 615 });
    expect(computeCreateRange(608, 616)).toEqual({ startMin: 600, endMin: 630, pillMin: 630 });
    expect(computeCreateRange(608, 631)).toEqual({ startMin: 600, endMin: 645, pillMin: 645 });
    expect(computeCreateRange(608, 650)).toEqual({ startMin: 600, endMin: 660, pillMin: 660 });
  });

  it('expands upward monotonically keeping anchor slot end fixed', () => {
    expect(computeCreateRange(608, 599)).toEqual({ startMin: 585, endMin: 615, pillMin: 585 });
    expect(computeCreateRange(608, 575)).toEqual({ startMin: 570, endMin: 615, pillMin: 570 });
  });

  it('clamps cleanly to day bounds 0..1440', () => {
    expect(computeCreateRange(-10, -20)).toEqual({ startMin: 0, endMin: 15, pillMin: 0 });
    expect(computeCreateRange(1435, 1460)).toEqual({ startMin: 1425, endMin: 1440, pillMin: 1440 });
  });
});

describe('pendingTimelineDraft helpers', () => {
  it('projects timed tasks to pending draft with default title fallback and null for all-day', () => {
    expect(
      pendingDraftFromTask({
        start: '2026-11-23',
        title: '',
        time: undefined,
        duration: undefined,
      }),
    ).toBeNull();

    expect(
      pendingDraftFromTask(
        {
          start: '2026-11-23',
          title: '  ',
          time: '16:30',
          duration: 135,
          color: 'blue',
          groupId: 'grp-1',
        },
        3,
      ),
    ).toEqual({
      date: '2026-11-23',
      startMin: 16 * 60 + 30,
      endMin: 18 * 60 + 45,
      title: '新建事项',
      color: 'blue',
      groupId: 'grp-1',
      source: 'editor',
      rev: 3,
    });

    expect(
      pendingDraftFromTask({
        start: '2026-11-23',
        title: '设计评审',
        time: '23:30',
        duration: 120,
      }),
    ).toMatchObject({
      startMin: 23 * 60 + 30,
      endMin: 1440,
      title: '设计评审',
    });
  });

  it('applies timeline drag patches onto editor task while preserving multi-day span', () => {
    const task = {
      id: 't1',
      title: '设计评审',
      start: '2026-11-23',
      end: '2026-11-25',
      time: '09:00',
      duration: 60,
      done: false,
      progress: 0,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    } as Task;

    applyTimelineDraftPatch(task, {
      date: '2026-11-24',
      startMin: 14 * 60 + 15,
      endMin: 16 * 60,
    });

    expect(task.start).toBe('2026-11-24');
    expect(task.end).toBe('2026-11-26');
    expect(task.time).toBe('14:15');
    expect(task.duration).toBe(105);
  });
});
