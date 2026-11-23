import type { ISODate, Task, TaskCheckItem, TaskLink, TaskPriority, TaskStatus } from '@/types';
import { diffDays } from './date';
import { DEFAULT_DURATION, formatDurationLabel, MIN_DURATION, parseTimeMin } from './dayLayout';
import { flexKind, MONTH } from './flex';
import { uid } from './uid';

export const WORKSPACE_STATUS_ORDER: readonly TaskStatus[] = [
  'in_review',
  'in_progress',
  'todo',
  'backlog',
  'done',
];

export const STATUS_META: Record<TaskStatus, { label: string; shortLabel: string }> = {
  in_review: { label: '待复核', shortLabel: '待复核' },
  in_progress: { label: '进行中', shortLabel: '进行中' },
  todo: { label: '待开始', shortLabel: '待开始' },
  backlog: { label: '待排期', shortLabel: '待排期' },
  done: { label: '已完成', shortLabel: '已完成' },
};

export const PRIORITY_ORDER: readonly TaskPriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: '紧急', color: '#E5484D' },
  high: { label: '高优先级', color: '#D97706' },
  medium: { label: '中优先级', color: '#0284C7' },
  low: { label: '低优先级', color: '#6E6A63' },
  none: { label: '无优先级', color: '#9E9990' },
};

export function effectiveStatus(t: Task): TaskStatus {
  if (t.done || t.status === 'done') return 'done';
  if (t.status === 'in_review') return 'in_review';
  if (t.status === 'in_progress') return 'in_progress';
  if (t.status === 'backlog') return 'backlog';
  return 'todo';
}

/** Workspace variant: unscheduled someday/monthly flex tasks without explicit status map to 'backlog'. */
export function effectiveWorkspaceStatus(t: Task): TaskStatus {
  const base = effectiveStatus(t);
  if (base === 'todo' && !t.status && !!flexKind(t)) return 'backlog';
  return base;
}

export function effectivePriority(t: Task): TaskPriority {
  return t.priority ?? 'none';
}

export function taskShortCode(t: Task): string {
  if (typeof t.order === 'number' && Number.isFinite(t.order) && t.order > 0) {
    return `TSK-${String(Math.round(t.order)).padStart(3, '0')}`;
  }
  const suffix = t.id.replace(/[^a-zA-Z0-9]/g, '').slice(-3).toUpperCase() || '001';
  return `TSK-${suffix.padStart(3, '0')}`;
}

export interface DependencyGraph {
  blockedBy: Map<string, Task[]>;
  blocking: Map<string, Task[]>;
}

export function buildDependencyGraph(tasks: readonly Task[]): DependencyGraph {
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const blockedBy = new Map<string, Task[]>();
  const blocking = new Map<string, Task[]>();

  for (const t of tasks) {
    if (!t.deps?.length) continue;
    const seen = new Set<string>();
    for (const depId of t.deps) {
      if (depId === t.id || seen.has(depId)) continue;
      const pred = byId.get(depId);
      if (!pred) continue;
      seen.add(depId);

      const bb = blockedBy.get(t.id) ?? [];
      bb.push(pred);
      blockedBy.set(t.id, bb);

      const bg = blocking.get(pred.id) ?? [];
      bg.push(t);
      blocking.set(pred.id, bg);
    }
  }

  return { blockedBy, blocking };
}

export function applyTaskStatus(t: Task, status: TaskStatus): Task {
  if (status === 'done') {
    return { ...t, done: true, status: 'done', progress: 100 };
  }
  if (status === 'in_review') {
    const progress = t.progress === 0 || t.progress === 100 ? 85 : t.progress;
    return { ...t, done: false, status: 'in_review', progress };
  }
  if (status === 'in_progress') {
    const progress = t.progress === 0 || t.progress === 100 ? 50 : t.progress;
    return { ...t, done: false, status: 'in_progress', progress };
  }
  if (status === 'backlog') {
    const progress = t.progress === 100 ? 0 : t.progress;
    return { ...t, done: false, status: 'backlog', progress };
  }
  const progress = t.progress === 100 ? 0 : t.progress;
  const next: Task = { ...t, done: false, progress };
  delete next.status;
  return next;
}

export function checklistStats(items?: TaskCheckItem[]): { done: number; total: number; percent: number } {
  if (!items?.length) return { done: 0, total: 0, percent: 0 };
  let done = 0;
  for (const item of items) {
    if (item.done) done++;
  }
  const total = items.length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

export function applyChecklist(t: Task, items: TaskCheckItem[]): Task {
  const clean: TaskCheckItem[] = [];
  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    clean.push({ id: item.id || uid(), text, done: !!item.done });
  }
  const next: Task = { ...t };
  if (clean.length) next.checklist = clean;
  else delete next.checklist;

  if (!t.repeat && clean.length > 0) {
    const { done, total, percent } = checklistStats(clean);
    next.progress = percent;
    if (done > 0 && done < total && !t.done && !t.status) {
      next.status = 'in_progress';
    }
  }
  return next;
}

function durationOfTask(t: Task): number {
  const raw = t.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(1440, Math.max(MIN_DURATION, Math.round(raw)));
  }
  return DEFAULT_DURATION;
}

export function remainingTimeLabel(t: Task, todayIso: ISODate, nowMinutes: number): string {
  if (t.done || t.status === 'done') return '已完成';
  const flex = flexKind(t);
  if (flex) return flex === MONTH ? '本月不定日事项' : '不定日 · 待排期';

  if (t.time && t.start === todayIso && t.end === todayIso) {
    const startMin = parseTimeMin(t.time);
    const endMin = Math.min(24 * 60, startMin + durationOfTask(t));
    if (nowMinutes < startMin) return `今日 ${t.time} 开始`;
    if (nowMinutes < endMin) return `进行中 · 剩余 ${formatDurationLabel(endMin - nowMinutes)}`;
    return '今日时段已结束';
  }

  if (todayIso < t.start) {
    const days = diffDays(todayIso, t.start);
    return days === 1 ? '明天开始' : `${days} 天后开始`;
  }
  if (todayIso <= t.end) {
    const left = diffDays(todayIso, t.end);
    if (left === 0) return '今天截止';
    return t.status === 'in_progress' || t.status === 'in_review'
      ? `${STATUS_META[t.status].label} · 距截止 ${left} 天`
      : `距截止 ${left} 天`;
  }
  const late = diffDays(t.end, todayIso);
  return `已逾期 ${late} 天`;
}

export function sanitizeStatus(raw: unknown): TaskStatus | undefined {
  return raw === 'backlog' || raw === 'todo' || raw === 'in_progress' || raw === 'in_review' || raw === 'done'
    ? raw
    : undefined;
}

export function sanitizePriority(raw: unknown): TaskPriority | undefined {
  return raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'urgent'
    ? raw
    : undefined;
}

export function sanitizeChecklist(raw: unknown): TaskCheckItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const clean: TaskCheckItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.text !== 'string') continue;
    const text = rec.text.trim();
    if (!text) continue;
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `chk_${clean.length + 1}`;
    clean.push({ id, text, done: rec.done === true });
  }
  return clean.length ? clean : undefined;
}

export function sanitizeLinks(raw: unknown): TaskLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const clean: TaskLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.url !== 'string') continue;
    const url = rec.url.trim();
    if (!url) continue;
    const rawTitle = typeof rec.title === 'string' ? rec.title.trim() : '';
    const title = rawTitle || url;
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `lnk_${clean.length + 1}`;
    clean.push({ id, title, url });
  }
  return clean.length ? clean : undefined;
}
