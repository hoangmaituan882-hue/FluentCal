import { describe, expect, it } from 'vitest';
import type { Group, Task } from '@/types';
import { buildDependencyGraph } from '@/lib/taskMeta';
import {
  formatTokenValueSummary,
  matchesFilterTokens,
  toggleGroupQuickFilter,
  upsertFilterToken,
  type FilterToken,
} from './filterModel';

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? 't1',
    title: over.title ?? 'Task',
    start: '2026-11-23',
    end: '2026-11-23',
    progress: 0,
    done: false,
    order: over.order ?? 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe('filterModel tokenized filtering', () => {
  const g1: Group = { id: 'g1', name: 'Engineering', color: 'green', order: 1 };
  const g2: Group = { id: 'g2', name: 'Design', color: 'purple', order: 2 };
  const groups = { g1, g2 };

  const tasks: Task[] = [
    makeTask({
      id: 't1',
      title: 'Create user accounts',
      status: 'in_review',
      priority: 'high',
      groupId: 'g1',
      order: 196,
      starred: true,
    }),
    makeTask({
      id: 't2',
      title: 'Slack documentation',
      status: 'in_progress',
      priority: 'medium',
      groupId: 'g2',
      checklist: [{ id: 'c1', text: 'Write guide', done: false }],
    }),
    makeTask({
      id: 't3',
      title: 'Gmail OAuth approval',
      flex: 'someday',
      priority: 'low',
      deps: ['t1'],
    }),
    makeTask({
      id: 't4',
      title: 'Finished migration',
      done: true,
      priority: 'urgent',
      countdown: true,
    }),
  ];
  const graph = buildDependencyGraph(tasks);

  it('matches multi-value status/priority/group tokens and is_not operator', () => {
    const tPri = upsertFilterToken([], 'priority', ['high', 'low']);
    expect(tasks.filter((t) => matchesFilterTokens(t, tPri, '', graph)).map((t) => t.id)).toEqual([
      't1',
      't3',
    ]);

    const tNotDone = upsertFilterToken(tPri, 'status', ['done', 'backlog'], 'is_not');
    expect(tasks.filter((t) => matchesFilterTokens(t, tNotDone, '', graph)).map((t) => t.id)).toEqual([
      't1',
    ]);

    const tBlocked = upsertFilterToken([], 'blocked', ['yes']);
    expect(tasks.filter((t) => matchesFilterTokens(t, tBlocked, '', graph)).map((t) => t.id)).toEqual([
      't3',
    ]);

    const tBlocking = upsertFilterToken([], 'blocking', ['yes']);
    expect(tasks.filter((t) => matchesFilterTokens(t, tBlocking, '', graph)).map((t) => t.id)).toEqual([
      't1',
    ]);

    expect(tasks.filter((t) => matchesFilterTokens(t, [], 'TSK-196', graph)).map((t) => t.id)).toEqual([
      't1',
    ]);
  });

  it('toggles group quick-filter tokens and summarizes token values cleanly', () => {
    let tokens: FilterToken[] = toggleGroupQuickFilter([], 'g1');
    tokens = toggleGroupQuickFilter(tokens, 'g2');
    expect(tokens).toHaveLength(1);
    expect(formatTokenValueSummary(tokens[0], groups)).toBe('2 个分组');

    tokens = toggleGroupQuickFilter(tokens, 'g2');
    expect(formatTokenValueSummary(tokens[0], groups)).toBe('Engineering');

    tokens = toggleGroupQuickFilter(tokens, 'g1');
    expect(tokens).toHaveLength(0);
  });
});
