import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import {
  applyChecklist,
  applyTaskStatus,
  buildDependencyGraph,
  checklistStats,
  effectivePriority,
  effectiveStatus,
  effectiveWorkspaceStatus,
  remainingTimeLabel,
  sanitizeChecklist,
  sanitizeLinks,
  sanitizePriority,
  sanitizeStatus,
  taskShortCode,
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
  it('derives and applies all 5 workflow statuses cleanly', () => {
    const t = baseTask();
    expect(effectiveStatus(t)).toBe('todo');
    expect(effectiveWorkspaceStatus(baseTask({ flex: 'someday' }))).toBe('backlog');

    const backlog = applyTaskStatus(t, 'backlog');
    expect(backlog.done).toBe(false);
    expect(backlog.status).toBe('backlog');
    expect(effectiveStatus(backlog)).toBe('backlog');

    const ip = applyTaskStatus(t, 'in_progress');
    expect(ip.done).toBe(false);
    expect(ip.status).toBe('in_progress');
    expect(ip.progress).toBe(50);
    expect(effectiveStatus(ip)).toBe('in_progress');

    const review = applyTaskStatus(t, 'in_review');
    expect(review.done).toBe(false);
    expect(review.status).toBe('in_review');
    expect(review.progress).toBe(85);
    expect(effectiveStatus(review)).toBe('in_review');

    const done = applyTaskStatus(review, 'done');
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

  it('builds dependency graph and generates stable short codes', () => {
    const a = baseTask({ id: 'a', title: 'Auth API', order: 14 });
    const b = baseTask({ id: 'b', title: 'UI Login', order: 196, deps: ['a', 'missing', 'b'] });
    const c = baseTask({ id: 'c', title: 'Deploy', order: 7, deps: ['b'] });

    expect(taskShortCode(a)).toBe('TSK-014');
    expect(taskShortCode(b)).toBe('TSK-196');

    const graph = buildDependencyGraph([a, b, c]);
    expect(graph.blockedBy.get('b')?.map((x) => x.id)).toEqual(['a']);
    expect(graph.blocking.get('a')?.map((x) => x.id)).toEqual(['b']);
    expect(graph.blockedBy.get('c')?.map((x) => x.id)).toEqual(['b']);
    expect(graph.blocking.get('b')?.map((x) => x.id)).toEqual(['c']);
    expect(graph.blockedBy.get('a')).toBeUndefined();
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
    expect(remainingTimeLabel(baseTask({ end: '2026-11-26', status: 'in_review' }), '2026-11-23', 600)).toBe('待复核 · 距截止 3 天');
    expect(remainingTimeLabel(baseTask({ start: '2026-11-20', end: '2026-11-21' }), '2026-11-23', 600)).toBe('已逾期 2 天');
    expect(remainingTimeLabel(baseTask({ flex: 'someday' }), '2026-11-23', 600)).toBe('不定日 · 待排期');
    expect(remainingTimeLabel(baseTask({ done: true }), '2026-11-23', 600)).toBe('已完成');
  });

  it('sanitizes incoming metadata and priorities safely', () => {
    expect(sanitizeStatus('in_review')).toBe('in_review');
    expect(sanitizeStatus('backlog')).toBe('backlog');
    expect(sanitizeStatus('unknown')).toBeUndefined();
    expect(sanitizePriority('urgent')).toBe('urgent');
    expect(sanitizePriority('bogus')).toBeUndefined();
    expect(effectivePriority(baseTask())).toBe('none');
    expect(effectivePriority(baseTask({ priority: 'high' }))).toBe('high');
    expect(sanitizeChecklist([{ id: '', text: ' Step 1 ', done: 1 }, { text: ' ' }])).toEqual([
      { id: 'chk_1', text: 'Step 1', done: false },
    ]);
    expect(sanitizeLinks([{ url: ' https://example.com ', title: '' }, { url: '   ' }])).toEqual([
      { id: 'lnk_1', title: 'https://example.com', url: 'https://example.com' },
    ]);
  });
});
