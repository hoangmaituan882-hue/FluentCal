import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import {
  applyChecklist,
  applyTaskStatus,
  checklistStats,
  effectiveStatus,
  remainingTimeLabel,
  sanitizeChecklist,
  sanitizeLinks,
  sanitizeStatus,
} from './taskMeta';

function baseTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Sample',
    start: '2026-11-23',
    end: '2026-11-23',
    progress: 0,
    done: false,
    order: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe('taskMeta helpers', () => {
  it('derives and applies workflow statuses cleanly', () => {
    const t = baseTask();
    expect(effectiveStatus(t)).toBe('todo');

    const ip = applyTaskStatus(t, 'in_progress');
    expect(ip.done).toBe(false);
    expect(ip.status).toBe('in_progress');
    expect(ip.progress).toBe(50);
    expect(effectiveStatus(ip)).toBe('in_progress');

    const done = applyTaskStatus(ip, 'done');
    expect(done.done).toBe(true);
    expect(done.status).toBe('done');
    expect(done.progress).toBe(100);
    expect(effectiveStatus(done)).toBe('done');

    const back = applyTaskStatus(done, 'todo');
    expect(back.done).toBe(false);
    expect(back.status).toBeUndefined();
    expect(back.progress).toBe(0);
    expect(effectiveStatus(back)).toBe('todo');
  });

  it('computes checklist stats and updates progress on non-repeating tasks', () => {
    const t = baseTask();
    const updated = applyChecklist(t, [
      { id: '1', text: ' Wash ', done: true },
      { id: '2', text: '   ', done: false },
      { id: '3', text: 'Dry', done: false },
      { id: '4', text: 'Inspect', done: false },
    ]);
    expect(updated.checklist).toHaveLength(3);
    expect(updated.checklist?.[0].text).toBe('Wash');
    expect(updated.progress).toBe(33);
    expect(updated.status).toBe('in_progress');
    expect(checklistStats(updated.checklist)).toEqual({ done: 1, total: 3, percent: 33 });

    const cleared = applyChecklist(updated, []);
    expect(cleared.checklist).toBeUndefined();
  });

  it('formats remainingTimeLabel across timed, spanning, overdue, and flex tasks', () => {
    const timed = baseTask({ time: '10:00', duration: 90 });
    expect(remainingTimeLabel(timed, '2026-11-23', 9 * 60 + 15)).toBe('今日 10:00 开始');
    expect(remainingTimeLabel(timed, '2026-11-23', 10 * 60 + 20)).toBe('进行中 · 剩余 1h 10m');
    expect(remainingTimeLabel(timed, '2026-11-23', 12 * 60)).toBe('今日时段已结束');

    expect(remainingTimeLabel(baseTask({ end: '2026-11-26', status: 'in_progress' }), '2026-11-23', 600)).toBe('进行中 · 距截止 3 天');
    expect(remainingTimeLabel(baseTask({ start: '2026-11-20', end: '2026-11-21' }), '2026-11-23', 600)).toBe('已逾期 2 天');
    expect(remainingTimeLabel(baseTask({ flex: 'someday' }), '2026-11-23', 600)).toBe('不定日 · 待排期');
    expect(remainingTimeLabel(baseTask({ done: true }), '2026-11-23', 600)).toBe('已完成');
  });

  it('sanitizes incoming metadata safely', () => {
    expect(sanitizeStatus('in_progress')).toBe('in_progress');
    expect(sanitizeStatus('unknown')).toBeUndefined();
    expect(sanitizeChecklist([{ id: '', text: ' Step 1 ', done: 1 }, { text: ' ' }])).toEqual([
      { id: 'chk_1', text: 'Step 1', done: false },
    ]);
    expect(sanitizeLinks([{ url: ' https://example.com ', title: '' }, { url: '   ' }])).toEqual([
      { id: 'lnk_1', title: 'https://example.com', url: 'https://example.com' },
    ]);
  });
});
