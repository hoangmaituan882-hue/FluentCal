import { t as tr } from '@/i18n';
import { computed, reactive } from 'vue';
import type { ISODate, Task } from '@/types';
import { addDays, addMonths, parts, startOfMonth, startOfWeek } from '@/lib/date';
import type { PendingTimelineDraft } from '@/lib/dayLayout';
import { call, isTauri } from '@/api';
import {
  clusterSpotlightState,
  shown,
  taskSpotlightState,
  tidyFilter,
  type SpotlightVisualState,
} from '@/lib/filter';
import { doc, patchSettings, storeState, taskList } from '@/stores/doc';
import { now } from '@/composables/now';
import { occurrenceOn, occurrences } from '@/lib/recur';

/** UI state shared by the desk window's components (and the web view, which reuses them). */
export const ui = reactive({
  /** Month view: any day of the shown month. Weeks view: first shown week. */
  cursor: startOfMonth(now.value) as ISODate,
  weeksStart: '' as ISODate,
  /** Keyboard-focused day. */
  selected: now.value as ISODate,
  /** Day highlighted briefly after a search jump. */
  flash: '' as ISODate,
  flashEnd: '' as ISODate,
  flashTask: '',
  revealTask: '',
  activeView: '',
  locateRevision: 0,
  locateView: '',
  /** Search & gantt focus state. */
  quickAdd: null as null | { date: ISODate },
  searchOpen: false,
  /** Current column span in MultiDayView so TitleBar arrows step cleanly. */
  multidaySpan: 5,
  /** Task the Gantt view should scroll to and select. */
  ganttFocus: '',
  /** Transient message at the bottom of the calendar, e.g. after a delete. */
  toast: null as null | { text: string; undo: boolean },
  /** 按分组筛选 (the web view): the group ids that show, '' for 未分组; empty: everything.
   * Kept here only: it is for a look. */
  groupFilter: [] as string[],
  /** Two-stage Workspace calendar filter: locked spotlight group ids and currently hovered group pill. */
  spotlightGroups: [] as string[],
  hoverGroup: null as string | null,
  /** Live timeline draft kept visible while the new-task editor is open. */
  pendingDraft: null as PendingTimelineDraft | null,
});

export type { PendingTimelineDraft };
let draftRev = 0;

export function setPendingDraft(draft: Omit<PendingTimelineDraft, 'rev'> | null): void {
  ui.pendingDraft = draft ? { ...draft, rev: ++draftRev } : null;
}

export function clearPendingDraft(): void {
  ui.pendingDraft = null;
}

export function updatePendingDraftFromTimeline(patch: {
  date: ISODate;
  startMin: number;
  endMin: number;
}): void {
  const prev = ui.pendingDraft;
  ui.pendingDraft = {
    date: patch.date,
    startMin: patch.startMin,
    endMin: patch.endMin,
    title: prev?.title || '新建事项',
    color: prev?.color,
    groupId: prev?.groupId,
    source: 'timeline',
    rev: ++draftRev,
  };
  if (!editorHandler && isTauri) {
    void call('editor_draft_sync', { draft: ui.pendingDraft });
  }
}

/** The filter as it applies now (groups that are gone have left it). */
export const groupFilter = computed(() => tidyFilter(doc.groups, ui.groupFilter));
export const spotlightGroups = computed(() => tidyFilter(doc.groups, ui.spotlightGroups));

export function spotlightStateOf(t: Task): SpotlightVisualState {
  if (!spotlightGroups.value.length && ui.hoverGroup === null) return 'normal';
  return taskSpotlightState(doc.groups, spotlightGroups.value, ui.hoverGroup, t);
}

export function clusterSpotlightStateOf(tasks: readonly Task[]): SpotlightVisualState {
  if (!spotlightGroups.value.length && ui.hoverGroup === null) return 'normal';
  return clusterSpotlightState(doc.groups, spotlightGroups.value, ui.hoverGroup, tasks);
}
/** The tasks the month, the weeks, the list and "+N" show. Search, the countdowns and the
 * Gantt chart take all of them. */
export const shownTasks = computed(() => {
  const f = groupFilter.value;
  const visible = taskList.value.filter(
    (t) => !t.countdownOnly && (!t.subscriptionOnly || !!t.subscription?.showOnCalendar),
  );
  return f.length ? visible.filter((t) => t.id === ui.revealTask || shown(doc.groups, f, t)) : visible;
});

export function clearReveal(): void { ui.revealTask = ''; }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, undo = false): void {
  ui.toast = { text, undo };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast = null), undo ? 6000 : 2500);
}

/** "在浏览器中查看": the read-only web view in this PC's default browser. FluentCal starts a
 * server on 127.0.0.1 for it the first time (no firewall prompt, no other device can reach it). */
export async function openInBrowser(): Promise<void> {
  try {
    await call('open_url', { url: await call<string>('web_local_url') });
  } catch (e) {
    notify(tr("无法在浏览器中查看：{0}（端口在 设置 › 网页查看 中修改）", String(e)));
  }
}

export type EditorPayload =
  | { mode: 'edit'; taskId: string; date?: ISODate }
  | { mode: 'new'; start?: ISODate; end?: ISODate; time?: string; duration?: number; groupId?: string; title?: string; milestone?: boolean };

/** Web view: the task shown in the read-only details dialog. */
export const details = reactive({ open: false, taskId: '', date: '' as ISODate });

let editorHandler: ((payload: EditorPayload) => void) | null = null;
let settingsHandler: ((page?: string) => void) | null = null;
let ganttHandler: ((taskId?: string) => void) | null = null;
let countdownsHandler: (() => void) | null = null;

export function setEditorHandler(fn: ((payload: EditorPayload) => void) | null): void {
  editorHandler = fn;
}

export function setSettingsHandler(fn: ((page?: string) => void) | null): void {
  settingsHandler = fn;
}

export function setGanttHandler(fn: ((taskId?: string) => void) | null): void {
  ganttHandler = fn;
}

export function setCountdownsHandler(fn: (() => void) | null): void {
  countdownsHandler = fn;
}

export function openWorkspace(): void {
  void call('workspace_open');
}

export function openCountdowns(): void {
  if (countdownsHandler) {
    countdownsHandler();
    return;
  }
  openSettings('calendar');
}

export function openEditor(payload: EditorPayload): void {
  if (storeState.readOnly) {
    if (payload.mode === 'edit') Object.assign(details, { open: true, taskId: payload.taskId, date: payload.date ?? '' });
    return;
  }
  if (editorHandler) {
    editorHandler(payload);
    return;
  }
  void call('editor_open', { payload });
}

export function openSettings(page?: string): void {
  if (settingsHandler) {
    settingsHandler(page);
    return;
  }
  void call('settings_open', { page });
}

export function openGanttTask(taskId: string): void {
  ui.ganttFocus = taskId;
  if (ganttHandler) {
    ganttHandler(taskId);
    return;
  }
  patchSettings({ calendar: { view: 'gantt' } });
}

/** "2026年10月", the range of the weeks view, or "甘特图" (title bar and web view). */
export function viewTitle(): string {
  const view = ui.activeView || doc.settings.calendar.view;
  if (view === 'day' || view === 'multiday') {
    const [y, m] = parts(ui.selected);
    return tr("{0}年{1}月", y, m);
  }
  if (view === 'gantt') return tr("甘特图");
  if (view === 'weeks') {
    const s = ui.weeksStart || defaultWeeksStart();
    const e = addDays(s, doc.settings.calendar.weeksRows * 7 - 1);
    const [sy, sm, sd] = parts(s);
    const [ey, em, ed] = parts(e);
    const yr = sy === parts(now.value)[0] ? '' : tr("{0}年", sy);
    return sy === ey ? tr("{0}{1}月{2}日 – {3}月{4}日", yr, sm, sd, em, ed) : tr("{0}年{1}月{2}日 – {3}年{4}月{5}日", sy, sm, sd, ey, em, ed);
  }
  const [y, m] = parts(ui.cursor);
  return tr("{0}年{1}月", y, m);
}

/** First week of the rolling multi-week view (for today, or for `day`). */
export function defaultWeeksStart(day: ISODate = now.value): ISODate {
  const c = doc.settings.calendar;
  return addDays(startOfWeek(day, c.weekStart), -7 * c.weeksPast);
}

export function goToday(): void {
  clearReveal();
  ui.cursor = startOfMonth(now.value);
  ui.weeksStart = defaultWeeksStart();
  ui.selected = now.value;
  flash(now.value);
}

export function page(delta: number): void {
  clearReveal();
  const view = ui.activeView || doc.settings.calendar.view;
  if (view === 'day') {
    ui.selected = addDays(ui.selected, delta);
    ui.cursor = startOfMonth(ui.selected);
  } else if (view === 'multiday') {
    ui.selected = addDays(ui.selected, delta * Math.max(1, ui.multidaySpan));
    ui.cursor = startOfMonth(ui.selected);
  } else if (view === 'weeks') {
    ui.weeksStart = addDays(ui.weeksStart || defaultWeeksStart(), delta * 7);
  } else {
    ui.cursor = addMonths(startOfMonth(ui.cursor), delta);
  }
}

/** Shows `date` in the calendar (switching away from Gantt if needed) and highlights it. */
export function jumpTo(date: ISODate, taskId = ''): void {
  clearReveal();
  const view = ui.activeView || doc.settings.calendar.view;
  if (view === 'gantt' || view === 'list' && !taskId) {
    ui.locateView = 'month';
    if (!ui.activeView) patchSettings({ calendar: { view: 'month' } });
  }
  ui.cursor = startOfMonth(date);
  ui.weeksStart = addDays(startOfWeek(date, doc.settings.calendar.weekStart), -7 * doc.settings.calendar.weeksPast);
  ui.selected = date;
  const task = doc.tasks[taskId];
  const occurrence = task && (occurrenceOn(task, date) ?? occurrences(task, date, date)[0]);
  ui.revealTask = task ? taskId : '';
  ui.flashTask = task ? taskId : '';
  flash(occurrence?.start ?? date, occurrence?.end ?? date);
  ui.locateRevision++;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
export function flash(date: ISODate, end = date): void {
  ui.flash = date;
  ui.flashEnd = end;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { ui.flash = ''; ui.flashEnd = ''; ui.flashTask = ''; }, 3000);
}
