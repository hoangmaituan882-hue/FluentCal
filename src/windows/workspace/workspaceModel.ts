import type { ISODate, Task } from '@/types';
import { addDays, startOfWeek } from '@/lib/date';
import { flexKind, MONTH, monthSlot, slotDone, SOMEDAY_SLOT } from '@/lib/flex';
import { occurrenceOn, occurrences } from '@/lib/recur';
import { effectiveStatus } from '@/lib/taskMeta';

export type WorkspacePageKind = 'daily' | 'calendar' | 'inbox' | 'tasks' | 'gantt' | 'countdowns' | 'area' | 'settings';

export interface WorkspaceTab {
  id: string;
  kind: WorkspacePageKind;
  title: string;
  groupId?: string;
  closable?: boolean;
}

export type TaskFilterKind = 'all' | 'today' | 'in_progress' | 'upcoming' | 'anytime' | 'completed';
export type TaskBucketKey = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'anytime' | 'completed';

const TABS_STORAGE_KEY = 'fluentcal.workspace.tabs.v1';

export function defaultWorkspaceTabs(): WorkspaceTab[] {
  return [
    { id: 'tab:daily', kind: 'daily', title: '今日聚焦', closable: true },
    { id: 'tab:calendar', kind: 'calendar', title: '日历视图', closable: true },
    { id: 'tab:tasks', kind: 'tasks', title: '待办清单', closable: true },
  ];
}

export function makeTabId(kind: WorkspacePageKind, groupId?: string): string {
  if (kind === 'area' && groupId) return `tab:area:${groupId}`;
  return `tab:${kind}`;
}

export function openOrFocusTab(
  tabs: WorkspaceTab[],
  next: Omit<WorkspaceTab, 'id'> & { id?: string },
): { tabs: WorkspaceTab[]; activeId: string } {
  const id = next.id ?? makeTabId(next.kind, next.groupId);
  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    const updated = tabs.map((t) => (t.id === id && t.title !== next.title ? { ...t, title: next.title } : t));
    return { tabs: updated, activeId: id };
  }
  const created: WorkspaceTab = { closable: true, ...next, id };
  return { tabs: [...tabs, created], activeId: id };
}

export function closeTab(
  tabs: WorkspaceTab[],
  activeId: string,
  targetId: string,
): { tabs: WorkspaceTab[]; activeId: string } {
  const idx = tabs.findIndex((t) => t.id === targetId);
  if (idx === -1) return { tabs, activeId };
  const target = tabs[idx];
  if (target.closable === false) return { tabs, activeId };

  const remaining = tabs.filter((t) => t.id !== targetId);
  if (!remaining.length) {
    const fallback = { id: 'tab:daily', kind: 'daily' as const, title: '今日聚焦', closable: true };
    return { tabs: [fallback], activeId: fallback.id };
  }
  if (activeId !== targetId) {
    return { tabs: remaining, activeId };
  }
  const nextActive = remaining[Math.min(idx, remaining.length - 1)];
  return { tabs: remaining, activeId: nextActive.id };
}

/** Cycles through open tabs (`Ctrl+Tab` / `Ctrl+Shift+Tab`), wrapping at ends. */
export function cycleTabId(tabs: WorkspaceTab[], activeId: string, delta: 1 | -1): string {
  if (!tabs.length) return activeId;
  const idx = tabs.findIndex((t) => t.id === activeId);
  if (idx === -1) {
    return delta > 0 ? tabs[0].id : tabs[tabs.length - 1].id;
  }
  const nextIdx = (idx + delta + tabs.length) % tabs.length;
  return tabs[nextIdx].id;
}

/** Keeps only `keepId` (and any non-closable tabs). */
export function closeOtherTabs(
  tabs: WorkspaceTab[],
  keepId: string,
): { tabs: WorkspaceTab[]; activeId: string } {
  const remaining = tabs.filter((t) => t.id === keepId || t.closable === false);
  if (!remaining.length) {
    const fallback = { id: 'tab:daily', kind: 'daily' as const, title: '今日聚焦', closable: true };
    return { tabs: [fallback], activeId: fallback.id };
  }
  const nextActive = remaining.some((t) => t.id === keepId) ? keepId : remaining[0].id;
  return { tabs: remaining, activeId: nextActive };
}

/** Closes tabs appearing to the right of `pivotId` (preserving non-closable tabs). */
export function closeTabsToRight(
  tabs: WorkspaceTab[],
  pivotId: string,
  activeId: string,
): { tabs: WorkspaceTab[]; activeId: string } {
  const idx = tabs.findIndex((t) => t.id === pivotId);
  if (idx === -1) return { tabs, activeId };
  const remaining = tabs.filter((t, i) => i <= idx || t.closable === false);
  const nextActive = remaining.some((t) => t.id === activeId) ? activeId : pivotId;
  return { tabs: remaining, activeId: nextActive };
}

const VALID_KINDS: WorkspacePageKind[] = ['daily', 'calendar', 'inbox', 'tasks', 'gantt', 'countdowns', 'area', 'settings'];

export function persistTabs(state: { tabs: WorkspaceTab[]; activeId: string }): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota/private mode */
  }
}

export function restoreTabs(): { tabs: WorkspaceTab[]; activeId: string } {
  const fallbackTabs = defaultWorkspaceTabs();
  try {
    if (typeof localStorage === 'undefined') return { tabs: fallbackTabs, activeId: fallbackTabs[0].id };
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return { tabs: fallbackTabs, activeId: fallbackTabs[0].id };
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeId?: unknown };
    if (!Array.isArray(parsed.tabs)) return { tabs: fallbackTabs, activeId: fallbackTabs[0].id };
    const cleanTabs: WorkspaceTab[] = [];
    for (const item of parsed.tabs) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== 'string' || typeof rec.title !== 'string') continue;
      if (!VALID_KINDS.includes(rec.kind as WorkspacePageKind)) continue;
      if (rec.kind === 'settings') continue; // settings has its own fixed compact pill in TopBar
      cleanTabs.push({
        id: rec.id,
        kind: rec.kind as WorkspacePageKind,
        title: rec.title,
        groupId: typeof rec.groupId === 'string' ? rec.groupId : undefined,
        closable: rec.closable !== false,
      });
    }
    if (!cleanTabs.length) return { tabs: fallbackTabs, activeId: fallbackTabs[0].id };
    const activeId =
      typeof parsed.activeId === 'string' &&
      (cleanTabs.some((t) => t.id === parsed.activeId) || parsed.activeId === 'tab:settings')
        ? parsed.activeId
        : cleanTabs[0].id;
    return { tabs: cleanTabs, activeId };
  } catch {
    return { tabs: fallbackTabs, activeId: fallbackTabs[0].id };
  }
}

export function classifyTaskBucket(t: Task, todayIso: ISODate): TaskBucketKey {
  const kind = flexKind(t);
  if (kind) {
    if (kind === MONTH) {
      return slotDone(t, monthSlot(todayIso)) ? 'completed' : 'anytime';
    }
    return t.done || !!slotDone(t, SOMEDAY_SLOT) ? 'completed' : 'anytime';
  }

  if (t.repeat) {
    const todayOcc = occurrenceOn(t, todayIso);
    if (todayOcc) {
      return todayOcc.done ? 'completed' : 'today';
    }
    const tomorrow = addDays(todayIso, 1);
    const tomorrowOcc = occurrences(t, tomorrow, tomorrow).find((o) => !o.done);
    if (tomorrowOcc) return 'tomorrow';
    const soonOcc = occurrences(t, addDays(todayIso, 2), addDays(todayIso, 30)).find((o) => !o.done);
    return soonOcc ? 'upcoming' : 'completed';
  }

  if (t.done || t.status === 'done') return 'completed';
  if (t.end < todayIso) return 'overdue';
  if (t.start <= todayIso && t.end >= todayIso) return 'today';
  if (t.start === addDays(todayIso, 1)) return 'tomorrow';
  return 'upcoming';
}

function matchesGroup(t: Task, groupId: string): boolean {
  if (!groupId) return true;
  if (groupId === '__ungrouped__') return !t.groupId;
  return t.groupId === groupId;
}

function matchesQuery(t: Task, q: string): boolean {
  if (!q) return true;
  if (t.title.toLowerCase().includes(q)) return true;
  if (t.notes?.toLowerCase().includes(q)) return true;
  if (t.checklist?.some((c) => c.text.toLowerCase().includes(q))) return true;
  if (t.links?.some((l) => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))) return true;
  return false;
}

export function filterWorkspaceTasks(
  tasks: Task[],
  filter: TaskFilterKind,
  groupId: string,
  query: string,
  todayIso: ISODate,
): Task[] {
  const q = query.trim().toLowerCase();
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.countdownOnly) continue;
    if (!matchesGroup(t, groupId) || !matchesQuery(t, q)) continue;
    const bucket = classifyTaskBucket(t, todayIso);
    if (filter === 'all') {
      if (bucket !== 'completed') out.push(t);
    } else if (filter === 'today') {
      if (bucket === 'today' || bucket === 'overdue') out.push(t);
    } else if (filter === 'in_progress') {
      if (effectiveStatus(t) === 'in_progress' && bucket !== 'completed') out.push(t);
    } else if (filter === 'upcoming') {
      if (bucket === 'tomorrow' || bucket === 'upcoming') out.push(t);
    } else if (filter === 'anytime') {
      if (bucket === 'anytime') out.push(t);
    } else if (filter === 'completed') {
      if (bucket === 'completed') out.push(t);
    }
  }
  return out;
}

export function taskCountsByFilter(
  tasks: Task[],
  groupId: string,
  todayIso: ISODate,
): Record<TaskFilterKind, number> {
  const counts: Record<TaskFilterKind, number> = {
    all: 0,
    today: 0,
    in_progress: 0,
    upcoming: 0,
    anytime: 0,
    completed: 0,
  };
  for (const t of tasks) {
    if (t.countdownOnly) continue;
    if (!matchesGroup(t, groupId)) continue;
    const bucket = classifyTaskBucket(t, todayIso);
    if (bucket === 'completed') {
      counts.completed++;
      continue;
    }
    counts.all++;
    if (effectiveStatus(t) === 'in_progress') counts.in_progress++;
    if (bucket === 'today' || bucket === 'overdue') counts.today++;
    else if (bucket === 'tomorrow' || bucket === 'upcoming') counts.upcoming++;
    else if (bucket === 'anytime') counts.anytime++;
  }
  return counts;
}

export function buildWeekStrip(anchor: ISODate, weekStart: 0 | 1): ISODate[] {
  const first = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function relativeTimeLabel(ts: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.max(1, Math.floor(days / 30))}mo`;
}
