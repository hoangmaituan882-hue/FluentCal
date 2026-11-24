import { reactive } from 'vue';
import type { ISODate, Task } from '@/types';
import { addDays, diffDays, formatFriendly } from '@/lib/date';
import { flexKind, SOMEDAY } from '@/lib/flex';
import { saveTask } from '@/lib/tasks';
import { doc, taskList } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { taskColor } from '@/fluent';
import { notify } from '../desk/state';

export const TASK_DRAG_MIME = 'application/x-fluentcal-task';
export const SPRING_NAV_DELAY_MS = 450;

export interface WorkspaceDragState {
  active: boolean;
  taskId: string;
  title: string;
  color: string;
  source: string;
  springKey: string;
  springStartedAt: number;
}

export const workspaceDrag = reactive<WorkspaceDragState>({
  active: false,
  taskId: '',
  title: '',
  color: '',
  source: '',
  springKey: '',
  springStartedAt: 0,
});

let springTimer: ReturnType<typeof setTimeout> | undefined;
let ghostEl: HTMLElement | null = null;

function resolveAccent(t: Task): string {
  const gColor = t.groupId ? doc.groups[t.groupId]?.color : undefined;
  return taskColor(t.color || gColor, isDark.value).bar;
}

function createDragGhost(title: string, color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'top:-9999px',
    'left:-9999px',
    'max-width:236px',
    'padding:8px 13px',
    'border-radius:12px',
    'display:inline-flex',
    'align-items:center',
    'gap:8px',
    'font-family:var(--font-sans,system-ui,-apple-system,sans-serif)',
    'font-size:12.5px',
    'font-weight:600',
    'letter-spacing:-0.01em',
    'color:#18181A',
    'background:rgba(255,255,255,0.96)',
    'border:1px solid rgba(28,25,23,0.12)',
    'box-shadow:0 12px 28px rgba(20,20,25,0.18),0 2px 6px rgba(0,0,0,0.08)',
    'transform:rotate(-1.5deg)',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'pointer-events:none',
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex:none;background:${color || '#18181A'};`;
  const text = document.createElement('span');
  text.textContent = title;
  text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
  el.append(dot, text);
  document.body.appendChild(el);
  return el;
}

function cleanupGhost() {
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
}

export function startTaskDrag(task: Task, e: DragEvent, source: string) {
  const color = resolveAccent(task);
  workspaceDrag.active = true;
  workspaceDrag.taskId = task.id;
  workspaceDrag.title = task.title;
  workspaceDrag.color = color;
  workspaceDrag.source = source;
  cancelSpringNav();

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TASK_DRAG_MIME, task.id);
    e.dataTransfer.setData('text/fluentcal-task-id', task.id);
    e.dataTransfer.setData('text/plain', task.id);
    try {
      cleanupGhost();
      ghostEl = createDragGhost(task.title, color);
      e.dataTransfer.setDragImage(ghostEl, 18, 18);
      requestAnimationFrame(() => cleanupGhost());
    } catch {
      cleanupGhost();
    }
  }
}

export function endTaskDrag() {
  cancelSpringNav();
  cleanupGhost();
  workspaceDrag.active = false;
  workspaceDrag.taskId = '';
  workspaceDrag.title = '';
  workspaceDrag.color = '';
  workspaceDrag.source = '';
}

export function getDraggedTaskId(e?: DragEvent): string {
  if (workspaceDrag.taskId) return workspaceDrag.taskId;
  if (!e?.dataTransfer) return '';
  return (
    e.dataTransfer.getData(TASK_DRAG_MIME) ||
    e.dataTransfer.getData('text/fluentcal-task-id') ||
    e.dataTransfer.getData('text/plain') ||
    ''
  );
}

export function hasTaskDragPayload(e: DragEvent): boolean {
  if (workspaceDrag.active && workspaceDrag.taskId) return true;
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return types.includes(TASK_DRAG_MIME) || types.includes('text/fluentcal-task-id') || types.includes('text/plain');
}

export function armSpringNav(key: string, onTrigger: () => void, delayMs = SPRING_NAV_DELAY_MS) {
  if (workspaceDrag.springKey === key && springTimer) return;
  cancelSpringNav();
  workspaceDrag.springKey = key;
  workspaceDrag.springStartedAt = Date.now();
  springTimer = setTimeout(() => {
    const stillSame = workspaceDrag.springKey === key && workspaceDrag.active;
    cancelSpringNav();
    if (stillSame) onTrigger();
  }, delayMs);
}

export function cancelSpringNav(onlyKey?: string) {
  if (onlyKey && workspaceDrag.springKey !== onlyKey) return;
  if (springTimer) {
    clearTimeout(springTimer);
    springTimer = undefined;
  }
  workspaceDrag.springKey = '';
  workspaceDrag.springStartedAt = 0;
}

export function findTaskById(taskId: string): Task | undefined {
  return taskList.value.find((t) => t.id === taskId);
}

export async function dropTaskToDate(
  taskId: string,
  targetDate: ISODate,
  time?: string,
  durationMin?: number,
): Promise<boolean> {
  const t = findTaskById(taskId);
  if (!t || t.subscriptionOnly || t.countdownOnly || t.habitOnly) return false;

  const isFlex = !!flexKind(t);
  const span = isFlex || !t.start || !t.end ? 0 : Math.max(0, diffDays(t.start, t.end));
  const nextEnd = addDays(targetDate, span);
  const next: Task = {
    ...t,
    flex: undefined,
    start: targetDate,
    end: nextEnd,
    ...(time ? { time, duration: durationMin ?? t.duration ?? 60 } : {}),
  };
  await saveTask(next);
  const timeSuffix = time ? ` ${time}` : '';
  notify(`已安排「${t.title}」到 ${formatFriendly(targetDate)}${timeSuffix}`, true);
  endTaskDrag();
  return true;
}

export async function dropTaskToInbox(taskId: string): Promise<boolean> {
  const t = findTaskById(taskId);
  if (!t || t.subscriptionOnly || t.countdownOnly || t.habitOnly) return false;
  if (flexKind(t) === SOMEDAY) {
    endTaskDrag();
    return false;
  }
  await saveTask({
    ...t,
    flex: SOMEDAY,
    time: undefined,
    duration: undefined,
  });
  notify(`已将「${t.title}」移入收集箱`, true);
  endTaskDrag();
  return true;
}

export async function dropTaskToGroup(taskId: string, groupId: string): Promise<boolean> {
  const t = findTaskById(taskId);
  if (!t || t.subscriptionOnly || t.countdownOnly || t.habitOnly) return false;
  const g = doc.groups[groupId];
  if (!g || t.groupId === groupId) {
    endTaskDrag();
    return false;
  }
  await saveTask({ ...t, groupId });
  notify(`已移入「${g.name}」`, true);
  endTaskDrag();
  return true;
}

export async function dropTaskToStarred(taskId: string): Promise<boolean> {
  const t = findTaskById(taskId);
  if (!t || t.subscriptionOnly || t.countdownOnly || t.habitOnly) return false;
  if (t.starred) {
    endTaskDrag();
    return false;
  }
  await saveTask({ ...t, starred: true });
  notify(`已星标置顶「${t.title}」`, true);
  endTaskDrag();
  return true;
}
