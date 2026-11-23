import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import {
  buildWeekStrip,
  classifyTaskBucket,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  cycleTabId,
  defaultWorkspaceTabs,
  filterWorkspaceTasks,
  openOrFocusTab,
  relativeTimeLabel,
  taskCountsByFilter,
} from './workspaceModel';

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: over.id ?? 't1',
    title: over.title ?? 'Task',
    start: over.start ?? '2026-11-23',
    end: over.end ?? over.start ?? '2026-11-23',
    progress: over.progress ?? 0,
    done: over.done ?? false,
    order: over.order ?? 1,
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 1000,
    ...over,
  };
}

describe('workspaceModel tabs', () => {
  it('opens new tabs without duplicates and focuses neighboring tab on close', () => {
    const start = defaultWorkspaceTabs();
    const added = openOrFocusTab(start, { kind: 'inbox', title: '收集箱' });
    expect(added.tabs).toHaveLength(4);
    expect(added.activeId).toBe('tab:inbox');

    const refocused = openOrFocusTab(added.tabs, { kind: 'inbox', title: '收集箱' });
    expect(refocused.tabs).toHaveLength(4);
    expect(refocused.activeId).toBe('tab:inbox');

    const closed = closeTab(refocused.tabs, 'tab:inbox', 'tab:inbox');
    expect(closed.tabs).toHaveLength(3);
    expect(closed.activeId).toBe('tab:tasks');
  });

  it('cycles open tabs forward and backward with wrap-around', () => {
    const start = defaultWorkspaceTabs();
    expect(cycleTabId(start, 'tab:daily', 1)).toBe('tab:calendar');
    expect(cycleTabId(start, 'tab:tasks', 1)).toBe('tab:daily');
    expect(cycleTabId(start, 'tab:daily', -1)).toBe('tab:tasks');
    expect(cycleTabId(start, 'tab:settings', 1)).toBe('tab:daily');
    expect(cycleTabId(start, 'tab:settings', -1)).toBe('tab:tasks');
    expect(cycleTabId([], 'tab:settings', 1)).toBe('tab:settings');

    const withFour = openOrFocusTab(start, { kind: 'inbox', title: '收集箱' }).tabs;
    const rightClosed = closeTabsToRight(withFour, 'tab:calendar', 'tab:inbox');
    expect(rightClosed.tabs.map((t) => t.id)).toEqual(['tab:daily', 'tab:calendar']);
    expect(rightClosed.activeId).toBe('tab:calendar');

    const othersClosed = closeOtherTabs(withFour, 'tab:inbox');
    expect(othersClosed.tabs.map((t) => t.id)).toEqual(['tab:inbox']);
    expect(othersClosed.activeId).toBe('tab:inbox');
  });
});

describe('workspaceModel tasks classification and filtering', () => {
  const today = '2026-11-23';
  const tasks: Task[] = [
    makeTask({ id: 'overdue', title: 'Overdue item', start: '2026-11-21', end: '2026-11-22', groupId: 'g1' }),
    makeTask({ id: 'today', title: 'Today focus', start: '2026-11-23', status: 'in_progress', groupId: 'g1' }),
    makeTask({ id: 'tomorrow', title: 'Tomorrow call', start: '2026-11-24' }),
    makeTask({ id: 'upcoming', title: 'Next week milestone', start: '2026-11-29', groupId: 'g2' }),
    makeTask({ id: 'someday', title: 'Someday idea', flex: 'someday', notes: 'research url', groupId: 'g1' }),
    makeTask({ id: 'done', title: 'Finished', start: '2026-11-23', done: true, groupId: 'g1' }),
    makeTask({ id: 'cdonly', title: 'Standalone countdown', start: '2026-12-01', countdown: true, countdownOnly: true, groupId: 'g1' }),
  ];

  it('classifies buckets accurately', () => {
    expect(classifyTaskBucket(tasks[0], today)).toBe('overdue');
    expect(classifyTaskBucket(tasks[1], today)).toBe('today');
    expect(classifyTaskBucket(tasks[2], today)).toBe('tomorrow');
    expect(classifyTaskBucket(tasks[3], today)).toBe('upcoming');
    expect(classifyTaskBucket(tasks[4], today)).toBe('anytime');
    expect(classifyTaskBucket(tasks[5], today)).toBe('completed');
  });

  it('counts and filters tasks by status, bucket, group, and query', () => {
    expect(taskCountsByFilter(tasks, '', today)).toEqual({
      all: 5,
      today: 2,
      in_progress: 1,
      upcoming: 2,
      anytime: 1,
      completed: 1,
    });
    expect(filterWorkspaceTasks(tasks, 'in_progress', '', '', today).map((t) => t.id)).toEqual(['today']);
    expect(filterWorkspaceTasks(tasks, 'all', 'g1', '', today).map((t) => t.id)).toEqual([
      'overdue',
      'today',
      'someday',
    ]);
    expect(filterWorkspaceTasks(tasks, 'all', '', 'research', today).map((t) => t.id)).toEqual(['someday']);
    expect(filterWorkspaceTasks(tasks, 'all', '__ungrouped__', '', today).map((t) => t.id)).toEqual(['tomorrow']);
  });
});

describe('workspaceModel date and time helpers', () => {
  it('builds 7-day week strips and compact relative timestamps', () => {
    // 2026-11-23 is Monday
    expect(buildWeekStrip('2026-11-25', 1)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
    expect(buildWeekStrip('2026-11-25', 0)[0]).toBe('2026-11-22');

    const base = 1_700_000_000_000;
    expect(relativeTimeLabel(base - 20_000, base)).toBe('刚刚');
    expect(relativeTimeLabel(base - 15 * 60_000, base)).toBe('15m');
    expect(relativeTimeLabel(base - 3 * 3600_000, base)).toBe('3h');
    expect(relativeTimeLabel(base - 2 * 86_400_000, base)).toBe('2d');
    expect(relativeTimeLabel(base - 14 * 86_400_000, base)).toBe('2w');
  });
});
