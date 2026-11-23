import type { ISODate, Task, TaskCheckItem, TaskLink, TaskStatus } from '@/types';
import { diffDays } from './date';
import { DEFAULT_DURATION, formatDurationLabel, MIN_DURATION, parseTimeMin } from './dayLayout';
import { flexKind, MONTH } from './flex';
import { uid } from './uid';

export function effectiveStatus(t: Task): TaskStatus {
  if (t.done || t.status === 'done') return 'done';
  if (t.status === 'in_progress') return 'in_progress';
  return 'todo';
}

export function applyTaskStatus(t: Task, status: TaskStatus): Task {
  if (status === 'done') {
    return { ...t, done: true, status: 'done', progress: 100 };
  }
  if (status === 'in_progress') {
    const progress = t.progress === 0 || t.progress === 100 ? 50 : t.progress;
    return { ...t, done: false, status: 'in_progress', progress };
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
    return t.status === 'in_progress' ? `进行中 · 距截止 ${left} 天` : `距截止 ${left} 天`;
  }
  const late = diffDays(t.end, todayIso);
  return `已逾期 ${late} 天`;
}

export function sanitizeStatus(raw: unknown): TaskStatus | undefined {
  return raw === 'todo' || raw === 'in_progress' || raw === 'done' ? raw : undefined;
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
