import { describe, expect, it } from 'vitest';
import type { CloudView } from '@/mobile/sync-model';
import {
  buildConflictResolutionPatch,
  detectSyncConflicts,
  extractBaseStamps,
  mergeConflictList,
  summarizeConflictSide,
} from './syncConflicts';

function makeView(
  tasks: CloudView['tasks'],
  stamps: Record<string, number>,
): CloudView {
  return {
    tasks,
    groups: {},
    dayMarks: {},
    meta: { tasks: stamps, groups: {}, dayMarks: {} },
  };
}

describe('syncConflicts', () => {
  it('detects concurrent edits after shared base while ignoring clean one-sided updates', () => {
    const baseView = makeView(
      {
        t1: { id: 't1', title: '旧标题', start: '2026-11-24', end: '2026-11-24', progress: 0, done: false, order: 0, createdAt: 100, updatedAt: 100 },
        t2: { id: 't2', title: '单端修改', start: '2026-11-24', end: '2026-11-24', progress: 0, done: false, order: 1, createdAt: 100, updatedAt: 100 },
      },
      { t1: 1000, t2: 1000 },
    );
    const base = extractBaseStamps(baseView);

    const ours = makeView(
      {
        t1: { id: 't1', title: '桌面修改的标题', start: '2026-11-24', end: '2026-11-24', progress: 50, done: false, order: 0, createdAt: 100, updatedAt: 2000 },
        t2: { id: 't2', title: '单端修改', start: '2026-11-24', end: '2026-11-24', progress: 0, done: false, order: 1, createdAt: 100, updatedAt: 100 },
      },
      { t1: 2000, t2: 1000 },
    );

    const theirs = makeView(
      {
        t1: { id: 't1', title: 'iPad 修改的标题', start: '2026-11-25', end: '2026-11-25', progress: 100, done: true, order: 0, createdAt: 100, updatedAt: 2500 },
        t2: { id: 't2', title: '云端更新的 t2', start: '2026-11-24', end: '2026-11-24', progress: 0, done: true, order: 1, createdAt: 100, updatedAt: 2200 },
      },
      { t1: 2500, t2: 2200 },
    );

    const conflicts = detectSyncConflicts(ours, theirs, base, {
      localDevice: 'Windows 桌面',
      remoteDevice: 'iPad Web',
      now: 3000,
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].itemId).toBe('t1');
    expect(conflicts[0].autoWinner).toBe('remote');
    expect(conflicts[0].changedFields).toContain('标题');
    expect(conflicts[0].changedFields).toContain('完成状态');
    expect(summarizeConflictSide('tasks', conflicts[0].remoteValue)).toContain('已完成');
  });

  it('detects delete vs modify divergence and builds local / remote / both resolution patches', () => {
    const base = { tasks: { t1: 1000 }, groups: {}, dayMarks: {} };
    const ours = makeView({}, { t1: 2100 });
    const theirs = makeView(
      {
        t1: { id: 't1', title: '保留在云端的习惯', habitOnly: true, start: '2026-11-24', end: '2026-11-24', progress: 0, done: false, order: 0, createdAt: 100, updatedAt: 2300 },
      },
      { t1: 2300 },
    );

    const conflicts = detectSyncConflicts(ours, theirs, base, { now: 4000 });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].itemKind).toBe('habit');
    expect(conflicts[0].changedFields).toEqual(['本机删除 / 云端修改']);

    const keepLocal = buildConflictResolutionPatch(conflicts[0], 'local');
    expect(keepLocal.items.t1).toBeNull();

    const keepRemote = buildConflictResolutionPatch(conflicts[0], 'remote');
    expect((keepRemote.items.t1 as { title: string }).title).toBe('保留在云端的习惯');

    const keepBoth = buildConflictResolutionPatch(
      {
        ...conflicts[0],
        localValue: { id: 't1', title: '本机版本', start: '2026-11-24', end: '2026-11-24', progress: 0, done: false, order: 0, createdAt: 100, updatedAt: 2100 },
      },
      'both',
      5000,
    );
    expect(Object.keys(keepBoth.items)).toHaveLength(2);

    const merged = mergeConflictList(conflicts, [{ ...conflicts[0], detectedAt: 6000 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].detectedAt).toBe(6000);
  });
});
