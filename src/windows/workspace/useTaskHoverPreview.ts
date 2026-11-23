import { reactive } from 'vue';
import type { Task } from '@/types';

export const taskHoverState = reactive({
  task: null as Task | null,
  anchor: null as HTMLElement | null,
  open: false,
});

let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

export function showTaskPreview(task: Task, anchor: HTMLElement) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches) {
    return;
  }
  clearTimeout(closeTimer);
  if (taskHoverState.open && taskHoverState.task?.id === task.id && taskHoverState.anchor === anchor) {
    return;
  }
  clearTimeout(openTimer);
  openTimer = setTimeout(() => {
    if (!anchor.isConnected) return;
    taskHoverState.task = task;
    taskHoverState.anchor = anchor;
    taskHoverState.open = true;
  }, 340);
}

export function hideTaskPreview() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    taskHoverState.open = false;
  }, 150);
}

export function keepTaskPreview() {
  clearTimeout(closeTimer);
}

export function cancelTaskPreview() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  taskHoverState.open = false;
  taskHoverState.task = null;
  taskHoverState.anchor = null;
}
