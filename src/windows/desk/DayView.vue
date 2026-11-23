<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { Task } from '@/types';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { formatFriendly } from '@/lib/date';
import {
  clampMinutes,
  computeCreateRange,
  DAY_MINUTES,
  DEFAULT_DURATION,
  floorMinutes,
  formatDurationLabel,
  formatMinToHHMM,
  formatRangeLabel,
  layoutDayEvents,
  MIN_DURATION,
  parseTimeMin,
  snapMinutes,
  type DayLayoutItem,
} from '@/lib/dayLayout';
import { expFollow, magneticPullPx, velocityScaleBias } from '@/lib/dayMotion';
import { occurrences, type Occurrence } from '@/lib/recur';
import { saveTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, storeState } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { chipMenu, removeTask } from './menus';
import { openEditor, page, setPendingDraft, shownTasks, spotlightStateOf, ui, updatePendingDraftFromTimeline } from './state';

const HOUR_HEIGHT = 68;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TOTAL_HEIGHT = 24 * HOUR_HEIGHT;

const scrollRef = ref<HTMLElement>();
const trackRef = ref<HTMLElement>();

const selectedKey = ref('');
const pinnedRightId = ref('');
const dayTransitioning = ref(false);
let dayTransitionTimer: ReturnType<typeof setTimeout> | undefined;

function occKey(occ: Occurrence): string {
  return `${occ.task.id}@${occ.date}`;
}

function durationOf(task: Task): number {
  const raw = task.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(DAY_MINUTES, Math.max(MIN_DURATION, Math.round(raw)));
  }
  return DEFAULT_DURATION;
}

function accentHexOf(task: Task): string {
  const groupColor = task.groupId ? doc.groups[task.groupId]?.color : undefined;
  if (!task.color && !groupColor) return '';
  return taskColor(task.color || groupColor, isDark.value).bar;
}

const dayOccurrences = computed<Occurrence[]>(() => {
  const d = ui.selected;
  if (!d) return [];
  const show = doc.settings.tasks.showCompleted;
  const out: Occurrence[] = [];
  for (const t of shownTasks.value) {
    for (const o of occurrences(t, d, d)) {
      if (show || !o.done || t.id === ui.revealTask) out.push(o);
    }
  }
  return out;
});

const allDayOccs = computed(() =>
  dayOccurrences.value
    .filter((o) => !o.task.time)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.task.order - b.task.order),
);

const timedOccs = computed(() =>
  dayOccurrences.value
    .filter((o) => !!o.task.time)
    .sort((a, b) => parseTimeMin(a.task.time) - parseTimeMin(b.task.time) || a.task.order - b.task.order),
);

const totalCount = computed(() => allDayOccs.value.length + timedOccs.value.length);
const lunarBadge = computed(() => {
  if (!doc.settings.calendar.showLunar || !ui.selected) return '';
  const info = dayInfo(ui.selected);
  if (info.festivals.length) return info.festivals[0];
  return `农历${info.lunarLabel}`;
});

// Current time indicator updated every 30s.
function currentMinuteOfDay(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
const nowMin = ref(currentMinuteOfDay());
let nowTimer: ReturnType<typeof setInterval> | undefined;

const reduceMotion = computed(() => doc.settings.theme.reduceMotion);

// ---------------------------------------------------------------- Active drag & rAF spring state

type DragKind = 'move' | 'resize-top' | 'resize-bottom' | 'create' | 'allday';

interface DragState {
  kind: DragKind;
  key: string;
  title: string;
  startMin: number;
  endMin: number;
  pillMin: number;
  accent: string;
}

const drag = ref<DragState | null>(null);
let cleanupActiveDrag: (() => void) | null = null;
let autoScrollRaf = 0;
let autoScrollDir = 0;
let onScrollRecompute: (() => void) | null = null;

// Frame-rate-independent rAF magnetic rubber-band & velocity micro-lift while dragging/resizing.
let motionRaf = 0;
let motionPrevTs = 0;
let motionTargetPull = 0;
let motionVelY = 0;
let motionPrevClientY = 0;
let motionPrevMoveTs = 0;
const dragPullY = ref(0);
const dragStretch = ref(0);
const dragOrigin = ref<'center' | 'top' | 'bottom'>('center');

function feedMotionSample(clientY: number, rawPx: number, snappedPx: number, maxPull: number, softness: number) {
  if (reduceMotion.value) return;
  const nowTs = performance.now();
  const moveDt = motionPrevMoveTs ? Math.max(0.004, Math.min(0.1, (nowTs - motionPrevMoveTs) / 1000)) : 0;
  if (moveDt > 0) {
    const instVel = (clientY - motionPrevClientY) / moveDt;
    motionVelY = expFollow(motionVelY, instVel, 22, moveDt);
  }
  motionPrevClientY = clientY;
  motionPrevMoveTs = nowTs;
  motionTargetPull = magneticPullPx(rawPx, snappedPx, maxPull, softness);
}

function startMotionLoop(origin: 'center' | 'top' | 'bottom', trackVelocity: boolean) {
  if (reduceMotion.value) return;
  dragOrigin.value = origin;
  motionPrevTs = performance.now();
  const tick = (ts: number) => {
    const dt = Math.min(1 / 30, Math.max(0, (ts - motionPrevTs) / 1000));
    motionPrevTs = ts;
    dragPullY.value = expFollow(dragPullY.value, motionTargetPull, 28, dt);
    const sinceMove = motionPrevMoveTs ? (ts - motionPrevMoveTs) / 1000 : 0;
    if (sinceMove > 0.04) motionVelY = expFollow(motionVelY, 0, 14, dt);
    const targetStretch = trackVelocity ? velocityScaleBias(motionVelY, 0.006) : 0;
    dragStretch.value = expFollow(dragStretch.value, targetStretch, 18, dt);
    if (drag.value) motionRaf = requestAnimationFrame(tick);
    else motionRaf = 0;
  };
  if (!motionRaf) motionRaf = requestAnimationFrame(tick);
}

function stopMotionLoop() {
  if (motionRaf) {
    cancelAnimationFrame(motionRaf);
    motionRaf = 0;
  }
  motionVelY = 0;
  motionPrevMoveTs = 0;
  motionTargetPull = 0;
  dragPullY.value = 0;
  dragStretch.value = 0;
  dragOrigin.value = 'center';
}

function stopAutoScroll() {
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }
  autoScrollDir = 0;
}

function updateAutoScroll(clientY: number) {
  const scroller = scrollRef.value;
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  const zone = 44;
  let speed = 0;
  if (clientY < r.top + zone) {
    speed = -Math.max(2, Math.round(((r.top + zone - clientY) / zone) * 10));
  } else if (clientY > r.bottom - zone) {
    speed = Math.max(2, Math.round(((clientY - (r.bottom - zone)) / zone) * 10));
  }
  autoScrollDir = speed;
  if (speed !== 0 && !autoScrollRaf) {
    const step = () => {
      if (!autoScrollDir || !scrollRef.value) {
        autoScrollRaf = 0;
        return;
      }
      const prev = scrollRef.value.scrollTop;
      scrollRef.value.scrollTop += autoScrollDir;
      if (scrollRef.value.scrollTop !== prev) onScrollRecompute?.();
      autoScrollRaf = requestAnimationFrame(step);
    };
    autoScrollRaf = requestAnimationFrame(step);
  } else if (speed === 0) {
    stopAutoScroll();
  }
}

interface RenderItem {
  key: string;
  occ: Occurrence | null;
  title: string;
  startMin: number;
  endMin: number;
  col: number;
  colCount: number;
  done: boolean;
  repeating: boolean;
  accent: string;
  isDraft: boolean;
  isPendingDraft: boolean;
  isSelected: boolean;
  isMoving: boolean;
  isResizing: boolean;
  showDuration: boolean;
}

function pendingAccentHex(color?: string, groupId?: string): string {
  const k = color || (groupId ? doc.groups[groupId]?.color : undefined);
  return k ? taskColor(k, isDark.value).bar : '';
}

const positionedItems = computed<RenderItem[]>(() => {
  const d = drag.value;
  const occByKey = new Map<string, Occurrence>();
  const inputs: { id: string; startMin: number; endMin: number; order: number }[] = [];

  for (const occ of timedOccs.value) {
    const key = occKey(occ);
    occByKey.set(key, occ);
    const s =
      d && d.key === key && (d.kind === 'move' || d.kind === 'resize-top' || d.kind === 'resize-bottom')
        ? d.startMin
        : parseTimeMin(occ.task.time);
    const e =
      d && d.key === key && (d.kind === 'move' || d.kind === 'resize-top' || d.kind === 'resize-bottom')
        ? d.endMin
        : Math.min(DAY_MINUTES, s + durationOf(occ.task));
    inputs.push({ id: key, startMin: s, endMin: Math.max(s + MIN_DURATION, e), order: occ.task.order });
  }

  const pending =
    ui.pendingDraft && ui.pendingDraft.date === ui.selected && (!d || d.kind !== 'create')
      ? ui.pendingDraft
      : null;

  const isPendingActive = Boolean(
    d && d.key === '__draft__' && (d.kind === 'move' || d.kind === 'resize-top' || d.kind === 'resize-bottom'),
  );

  if (d && (d.kind === 'create' || d.kind === 'allday')) {
    inputs.push({ id: d.key, startMin: d.startMin, endMin: d.endMin, order: 999_999 });
  }
  if (pending) {
    const s = isPendingActive && d ? d.startMin : pending.startMin;
    const e = isPendingActive && d ? d.endMin : pending.endMin;
    inputs.push({ id: '__draft__', startMin: s, endMin: Math.max(s + MIN_DURATION, e), order: 999_999 });
  }

  const laid = layoutDayEvents(inputs, pinnedRightId.value || (pending ? '__draft__' : undefined));
  const laidById = new Map<string, DayLayoutItem>(laid.map((x) => [x.id, x]));

  // Keep DOM element order invariant across startMin changes so Vue never moves nodes and restarts CSS transitions.
  const orderedKeys = [...occByKey.keys()].sort((a, b) => a.localeCompare(b));
  if (d && (d.kind === 'create' || d.kind === 'allday')) orderedKeys.push(d.key);
  if (pending) orderedKeys.push('__draft__');

  const out: RenderItem[] = [];
  for (const id of orderedKeys) {
    const item = laidById.get(id);
    if (!item) continue;
    const occ = occByKey.get(item.id) ?? null;
    const isDraft = !occ;
    const isPendingDraft = Boolean(isDraft && pending && id === '__draft__');
    const activeForThis = d?.key === item.id;
    const isMoving = Boolean(activeForThis && (d?.kind === 'move' || d?.kind === 'allday'));
    const isResizing = Boolean(activeForThis && (d?.kind === 'resize-top' || d?.kind === 'resize-bottom'));
    const isSelected = Boolean(isDraft || activeForThis || selectedKey.value === item.id);
    const showDuration = Boolean(
      isPendingDraft ||
        (activeForThis && (d?.kind === 'resize-top' || d?.kind === 'resize-bottom' || d?.kind === 'create')),
    );

    out.push({
      key: item.id,
      occ,
      title: occ ? occ.task.title : isPendingDraft && pending ? pending.title || '新建事项' : d?.title || '新建事项',
      startMin: item.startMin,
      endMin: item.endMin,
      col: item.col,
      colCount: item.colCount,
      done: occ ? occ.done : false,
      repeating: Boolean(occ?.task.repeat),
      accent: occ
        ? accentHexOf(occ.task)
        : isPendingDraft && pending
          ? pendingAccentHex(pending.color, pending.groupId)
          : d?.accent || '',
      isDraft,
      isPendingDraft,
      isSelected,
      isMoving,
      isResizing,
      showDuration,
    });
  }
  return out;
});

function cardStyle(item: RenderItem): Record<string, string> {
  const durMin = item.endMin - item.startMin;
  const topPx = (item.startMin / 60) * HOUR_HEIGHT + 2;
  const heightPx = Math.max(25, (durMin / 60) * HOUR_HEIGHT - 4);
  const gap = 6;
  const leftExpr =
    item.colCount <= 1 ? 'calc(0% + 0px)' : `calc(${(item.col / item.colCount) * 100}% + ${((item.col * gap) / item.colCount).toFixed(2)}px)`;
  const widthExpr =
    item.colCount <= 1 ? 'calc(100% - 0px)' : `calc(${100 / item.colCount}% - ${(((item.colCount - 1) * gap) / item.colCount).toFixed(2)}px)`;

  const style: Record<string, string> = {
    top: `${topPx.toFixed(1)}px`,
    height: `${heightPx.toFixed(1)}px`,
    left: leftExpr,
    width: widthExpr,
    ...(item.accent ? { '--ev-accent': item.accent } : {}),
  };

  if (!reduceMotion.value) {
    if (item.isMoving) {
      const sx = 1.012 - dragStretch.value;
      const sy = 1.012 + dragStretch.value;
      style.transform = `translate3d(0, ${dragPullY.value.toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    } else if (item.isResizing) {
      const denom = Math.max(36, heightPx);
      const signed = dragOrigin.value === 'bottom' ? -dragPullY.value : dragPullY.value;
      const sy = Math.max(0.95, Math.min(1.06, 1 + signed / denom));
      style.transformOrigin = dragOrigin.value === 'bottom' ? 'center bottom' : 'center top';
      style.transform = `scaleY(${sy.toFixed(4)})`;
    }
  }

  return style;
}

function cardDensity(item: RenderItem): 'xs' | 'sm' | 'full' {
  const dur = item.endMin - item.startMin;
  if (dur <= 20) return 'xs';
  if (dur <= 40) return 'sm';
  return 'full';
}

function cardBaseTime(item: RenderItem): string {
  if (cardDensity(item) === 'xs') return formatMinToHHMM(item.startMin);
  return formatRangeLabel(item.startMin, item.endMin, false);
}

const pillState = computed(() => {
  const d = drag.value;
  if (!d) return null;
  const min = clampMinutes(d.pillMin, 0, DAY_MINUTES);
  return {
    y: (min / 60) * HOUR_HEIGHT,
    label: formatMinToHHMM(min),
  };
});

function isHourOccluded(hour: number): boolean {
  if (!pillState.value) return false;
  return Math.abs(hour * HOUR_HEIGHT - pillState.value.y) < 21;
}

// ---------------------------------------------------------------- Pointer helpers

function pointerMinFromTrack(clientY: number): number {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect) return 9 * 60;
  return ((clientY - rect.top) / HOUR_HEIGHT) * 60;
}

function canEdit(): boolean {
  return !storeState.readOnly && doc.settings.desk.locked;
}

function onEventPointerDown(item: RenderItem, e: PointerEvent) {
  if (e.button !== 0 || (!item.occ && !item.isPendingDraft)) return;
  if ((e.target as HTMLElement).closest('button, .resize-handle')) return;
  e.stopPropagation();
  if (e.pointerType !== 'touch') e.preventDefault();

  const occ = item.occ;
  const key = item.key;
  selectedKey.value = key;
  if (storeState.readOnly) {
    if (occ) openEditor({ mode: 'edit', taskId: occ.task.id, date: occ.date });
    return;
  }
  if (!canEdit()) return;

  const cardEl = e.currentTarget as HTMLElement;
  const cardRect = cardEl.getBoundingClientRect();
  const grabOffsetY = e.clientY - cardRect.top;
  const origStartMin = item.startMin;
  const origEndMin = item.endMin;
  const dur = Math.max(MIN_DURATION, origEndMin - origStartMin);
  const startY = e.clientY;
  const startX = e.clientX;
  const pointerId = e.pointerId;
  const isTouch = e.pointerType === 'touch';
  let lastClientY = e.clientY;
  let started = false;

  const computeStart = () => {
    const rect = trackRef.value?.getBoundingClientRect();
    if (!rect) return { s: origStartMin, rawTopPx: (origStartMin / 60) * HOUR_HEIGHT };
    const rawTopPx = lastClientY - rect.top - grabOffsetY - 2;
    const rawMin = (rawTopPx / HOUR_HEIGHT) * 60;
    const s = clampMinutes(snapMinutes(rawMin), 0, DAY_MINUTES - dur);
    return { s, rawTopPx };
  };

  const applyMove = (clientYForVel: number) => {
    const { s, rawTopPx } = computeStart();
    const snappedPx = (s / 60) * HOUR_HEIGHT;
    feedMotionSample(clientYForVel, rawTopPx, snappedPx, 4.5, 11);
    if (!drag.value) {
      pinnedRightId.value = key;
      drag.value = {
        kind: 'move',
        key,
        title: occ ? occ.task.title : item.title,
        startMin: s,
        endMin: s + dur,
        pillMin: s,
        accent: item.accent,
      };
      startMotionLoop('center', true);
    } else if (drag.value.startMin !== s || drag.value.endMin !== s + dur || drag.value.pillMin !== s) {
      drag.value.startMin = s;
      drag.value.endMin = s + dur;
      drag.value.pillMin = s;
    }
  };

  onScrollRecompute = () => {
    if (started) applyMove(lastClientY);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    stopMotionLoop();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientY = ev.clientY;
    if (!started) {
      const thresh = isTouch ? 10 : 4;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < thresh) return;
      started = true;
      motionPrevClientY = ev.clientY;
      motionPrevMoveTs = performance.now();
    }
    applyMove(ev.clientY);
    updateAutoScroll(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const finalStart = drag.value?.startMin ?? origStartMin;
    const committed = started && finalStart !== origStartMin;
    if (committed && item.isPendingDraft) {
      updatePendingDraftFromTimeline({
        date: ui.selected,
        startMin: finalStart,
        endMin: finalStart + dur,
      });
    }
    cleanup();
    if (committed && occ && !item.isPendingDraft) {
      void saveTask({
        ...occ.task,
        time: formatMinToHHMM(finalStart),
        duration: dur,
      });
    }
  };

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      cleanup();
    }
  };

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onResizePointerDown(item: RenderItem, edge: 'top' | 'bottom', e: PointerEvent) {
  if (e.button !== 0 || (!item.occ && !item.isPendingDraft) || !canEdit()) return;
  e.stopPropagation();
  e.preventDefault();

  const occ = item.occ;
  const key = item.key;
  selectedKey.value = key;

  const origStartMin = item.startMin;
  const origEndMin = item.endMin;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let lastClientY = e.clientY;
  let started = false;

  const applyResize = (clientYForVel: number) => {
    const rawMin = pointerMinFromTrack(lastClientY);
    const snapped = snapMinutes(rawMin);
    let s = origStartMin;
    let end = origEndMin;
    if (edge === 'bottom') {
      end = clampMinutes(snapped, origStartMin + MIN_DURATION, DAY_MINUTES);
    } else {
      s = clampMinutes(snapped, 0, origEndMin - MIN_DURATION);
    }
    const pillMin = edge === 'bottom' ? end : s;
    const rawEdgePx = (rawMin / 60) * HOUR_HEIGHT;
    const snappedEdgePx = (pillMin / 60) * HOUR_HEIGHT;
    feedMotionSample(clientYForVel, rawEdgePx, snappedEdgePx, 2.5, 10);

    if (!drag.value) {
      pinnedRightId.value = key;
      drag.value = {
        kind: edge === 'top' ? 'resize-top' : 'resize-bottom',
        key,
        title: occ ? occ.task.title : item.title,
        startMin: s,
        endMin: end,
        pillMin,
        accent: item.accent,
      };
      startMotionLoop(edge === 'top' ? 'bottom' : 'top', false);
    } else if (drag.value.startMin !== s || drag.value.endMin !== end || drag.value.pillMin !== pillMin) {
      drag.value.startMin = s;
      drag.value.endMin = end;
      drag.value.pillMin = pillMin;
    }
  };

  onScrollRecompute = () => {
    if (started) applyResize(lastClientY);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    stopMotionLoop();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientY = ev.clientY;
    if (!started) {
      if (Math.abs(ev.clientY - startY) < 2) return;
      started = true;
      motionPrevClientY = ev.clientY;
      motionPrevMoveTs = performance.now();
    }
    applyResize(ev.clientY);
    updateAutoScroll(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const s = drag.value?.startMin ?? origStartMin;
    const end = drag.value?.endMin ?? origEndMin;
    const committed = started && (s !== origStartMin || end !== origEndMin);
    if (committed && item.isPendingDraft) {
      updatePendingDraftFromTimeline({
        date: ui.selected,
        startMin: s,
        endMin: end,
      });
    }
    cleanup();
    if (committed && occ && !item.isPendingDraft) {
      void saveTask({
        ...occ.task,
        time: formatMinToHHMM(s),
        duration: end - s,
      });
    }
  };

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      cleanup();
    }
  };

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onTrackPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('.day-event')) return;
  selectedKey.value = '';
  pinnedRightId.value = '';
  if (!canEdit() || e.pointerType === 'touch') return;
  e.preventDefault();

  const anchorMin = clampMinutes(floorMinutes(pointerMinFromTrack(e.clientY)), 0, DAY_MINUTES - MIN_DURATION);
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let lastClientY = e.clientY;
  let started = false;

  const applyCreate = () => {
    const rawCur = pointerMinFromTrack(lastClientY);
    const { startMin: s, endMin: end, pillMin: pill } = computeCreateRange(anchorMin, rawCur);
    if (!drag.value) {
      pinnedRightId.value = '__draft__';
      drag.value = {
        kind: 'create',
        key: '__draft__',
        title: '新建事项',
        startMin: s,
        endMin: end,
        pillMin: pill,
        accent: '',
      };
    } else if (drag.value.startMin !== s || drag.value.endMin !== end || drag.value.pillMin !== pill) {
      drag.value.startMin = s;
      drag.value.endMin = end;
      drag.value.pillMin = pill;
    }
  };

  onScrollRecompute = () => {
    if (started) applyCreate();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    stopMotionLoop();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientY = ev.clientY;
    if (!started) {
      if (Math.abs(ev.clientY - startY) < 6) return;
      started = true;
    }
    applyCreate();
    updateAutoScroll(ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const s = drag.value?.startMin ?? anchorMin;
    const end = drag.value?.endMin ?? Math.min(DAY_MINUTES, anchorMin + DEFAULT_DURATION);
    const dur = Math.max(MIN_DURATION, end - s);
    const shouldCreate = started;
    if (shouldCreate) {
      setPendingDraft({
        date: ui.selected,
        startMin: s,
        endMin: Math.min(DAY_MINUTES, s + dur),
        title: '新建事项',
        source: 'timeline',
      });
    }
    cleanup();
    if (shouldCreate) {
      openEditor({
        mode: 'new',
        start: ui.selected,
        end: ui.selected,
        time: formatMinToHHMM(s),
        duration: dur,
      });
    }
  };

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      cleanup();
    }
  };

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onTrackDblClick(e: MouseEvent) {
  if (!canEdit()) return;
  if ((e.target as HTMLElement).closest('.day-event')) return;
  const s = clampMinutes(snapMinutes(pointerMinFromTrack(e.clientY)), 0, DAY_MINUTES - DEFAULT_DURATION);
  setPendingDraft({
    date: ui.selected,
    startMin: s,
    endMin: Math.min(DAY_MINUTES, s + DEFAULT_DURATION),
    title: '新建事项',
    source: 'timeline',
  });
  openEditor({
    mode: 'new',
    start: ui.selected,
    end: ui.selected,
    time: formatMinToHHMM(s),
    duration: DEFAULT_DURATION,
  });
}

// Allow dragging a single-day untimed all-day pill down onto the timeline to assign a time.
function onAllDayPointerDown(occ: Occurrence, e: PointerEvent) {
  if (e.button !== 0 || !canEdit() || occ.task.repeat || occ.start !== occ.end) return;
  if ((e.target as HTMLElement).closest('button')) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  const dur = durationOf(occ.task);
  const accent = accentHexOf(occ.task);
  let lastClientX = e.clientX;
  let lastClientY = e.clientY;
  let dragging = false;

  const inTimeline = () => {
    const sr = scrollRef.value?.getBoundingClientRect();
    return Boolean(sr && lastClientX >= sr.left && lastClientX <= sr.right && lastClientY >= sr.top && lastClientY <= sr.bottom);
  };

  const applyDropPreview = () => {
    if (!inTimeline()) {
      drag.value = null;
      return;
    }
    const rawMin = pointerMinFromTrack(lastClientY) - dur / 2;
    const s = clampMinutes(snapMinutes(rawMin), 0, DAY_MINUTES - dur);
    feedMotionSample(lastClientY, (rawMin / 60) * HOUR_HEIGHT, (s / 60) * HOUR_HEIGHT, 4.5, 11);
    if (!drag.value || drag.value.kind !== 'allday') {
      pinnedRightId.value = '__allday__';
      drag.value = {
        kind: 'allday',
        key: '__allday__',
        title: occ.task.title,
        startMin: s,
        endMin: s + dur,
        pillMin: s,
        accent,
      };
      startMotionLoop('center', true);
    } else if (drag.value.startMin !== s || drag.value.endMin !== s + dur || drag.value.pillMin !== s) {
      drag.value.startMin = s;
      drag.value.endMin = s + dur;
      drag.value.pillMin = s;
    }
  };

  onScrollRecompute = () => {
    if (dragging) applyDropPreview();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    stopAutoScroll();
    stopMotionLoop();
    onScrollRecompute = null;
    cleanupActiveDrag = null;
    drag.value = null;
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    lastClientX = ev.clientX;
    lastClientY = ev.clientY;
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
      dragging = true;
      motionPrevClientY = ev.clientY;
      motionPrevMoveTs = performance.now();
    }
    applyDropPreview();
    if (inTimeline()) updateAutoScroll(ev.clientY);
    else stopAutoScroll();
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const preview = drag.value;
    const wasDragging = dragging;
    cleanup();
    if (wasDragging && preview) {
      const timeStr = formatMinToHHMM(preview.startMin);
      const key = occKey(occ);
      pinnedRightId.value = key;
      selectedKey.value = key;
      void saveTask({ ...occ.task, time: timeStr, duration: dur });
    } else if (!wasDragging) {
      openEditor({ mode: 'edit', taskId: occ.task.id, date: occ.date });
    }
  };

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      cleanup();
    }
  };

  cleanupActiveDrag?.();
  cleanupActiveDrag = cleanup;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

function onToggleDone(occ: Occurrence) {
  if (storeState.readOnly) return;
  void setOccurrenceDone(occ.task, occ.date, !occ.done);
}

function onEditCard(occ: Occurrence) {
  openEditor({ mode: 'edit', taskId: occ.task.id, date: occ.date });
}

function onCardMenu(occ: Occurrence, e: MouseEvent) {
  selectedKey.value = occKey(occ);
  void chipMenu(occ, { x: e.clientX, y: e.clientY });
}

function onViewKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;

  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    page(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }

  if (!selectedKey.value) return;
  const item = positionedItems.value.find((x) => x.key === selectedKey.value);
  if (!item?.occ) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    onEditCard(item.occ);
  } else if (e.key === ' ' && !storeState.readOnly) {
    e.preventDefault();
    onToggleDone(item.occ);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit()) {
    e.preventDefault();
    const occ = item.occ;
    selectedKey.value = '';
    void removeTask(occ.task, occ.date);
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && canEdit()) {
    e.preventDefault();
    const dur = Math.max(MIN_DURATION, item.endMin - item.startMin);
    const step = e.key === 'ArrowUp' ? -15 : 15;
    const nextStart = clampMinutes(item.startMin + step, 0, DAY_MINUTES - dur);
    if (nextStart !== item.startMin) {
      pinnedRightId.value = item.key;
      void saveTask({ ...item.occ.task, time: formatMinToHHMM(nextStart), duration: dur });
    }
  } else if (e.key === 'Escape' && !drag.value) {
    selectedKey.value = '';
  }
}

// ---------------------------------------------------------------- Auto-scroll

function scrollToInitialHour(smooth = false) {
  const scroller = scrollRef.value;
  if (!scroller) return;
  let targetHour = 7.75;
  if (timedOccs.value.length) {
    const earliest = parseTimeMin(timedOccs.value[0].task.time);
    targetHour = Math.max(0, Math.min(Math.floor(earliest / 60) - 1, 16));
  } else if (ui.selected === now.value) {
    targetHour = Math.max(0, Math.min(Math.floor(nowMin.value / 60) - 2, 8));
  }
  scroller.scrollTo({
    top: targetHour * HOUR_HEIGHT,
    behavior: smooth && !reduceMotion.value ? 'smooth' : 'auto',
  });
}

function focusRevealedTask() {
  if (!ui.flashTask) return;
  const match = timedOccs.value.find((o) => o.task.id === ui.flashTask);
  if (!match) return;
  selectedKey.value = occKey(match);
  const scroller = scrollRef.value;
  if (!scroller) return;
  const min = parseTimeMin(match.task.time);
  const top = Math.max(0, (min / 60 - 1.5) * HOUR_HEIGHT);
  scroller.scrollTo({ top, behavior: reduceMotion.value ? 'auto' : 'smooth' });
}

onMounted(() => {
  nowTimer = setInterval(() => {
    nowMin.value = currentMinuteOfDay();
  }, 30_000);
  void nextTick(() => {
    scrollToInitialHour(false);
    focusRevealedTask();
  });
});

watch(
  () => ui.selected,
  () => {
    selectedKey.value = '';
    pinnedRightId.value = '';
    if (!reduceMotion.value) {
      dayTransitioning.value = false;
      clearTimeout(dayTransitionTimer);
      void nextTick(() => {
        dayTransitioning.value = true;
        dayTransitionTimer = setTimeout(() => {
          dayTransitioning.value = false;
        }, 180);
      });
    }
    void nextTick(() => scrollToInitialHour(true));
  },
);

watch([() => ui.flashTask, () => ui.locateRevision], () => {
  void nextTick(focusRevealedTask);
});

onBeforeUnmount(() => {
  cleanupActiveDrag?.();
  stopAutoScroll();
  stopMotionLoop();
  clearTimeout(dayTransitionTimer);
  if (nowTimer) clearInterval(nowTimer);
});
</script>

<template>
  <div
    class="day-view"
    :class="{
      dark: isDark,
      'reduce-motion': reduceMotion,
      dragging: !!drag,
      'dragging-move': drag?.kind === 'move' || drag?.kind === 'allday',
      'dragging-resize': drag?.kind === 'resize-top' || drag?.kind === 'resize-bottom',
      'dragging-create': drag?.kind === 'create',
    }"
    tabindex="-1"
    @keydown="onViewKeyDown"
  >
    <header class="day-head">
      <div class="day-head-main">
        <h2 class="day-title">{{ formatFriendly(ui.selected, now) }}</h2>
        <span class="day-count">{{ totalCount }} 项事项</span>
      </div>
      <div class="day-head-meta">
        <span v-if="lunarBadge" class="day-lunar">{{ lunarBadge }}</span>
        <button
          v-if="!storeState.readOnly"
          type="button"
          class="head-add-btn"
          title="在此日新建日程"
          aria-label="新建日程"
          @click="openEditor({ mode: 'new', start: ui.selected, end: ui.selected, time: '09:00', duration: 60 })"
        >
          <FIcon name="add" :size="13" />
        </button>
      </div>
    </header>

    <div v-if="allDayOccs.length" class="allday-strip">
      <span class="allday-label">全天</span>
      <div class="allday-list">
        <div
          v-for="occ in allDayOccs"
          :key="occKey(occ)"
          class="allday-pill"
          :class="{
            done: occ.done,
            draggable: !storeState.readOnly && !occ.task.repeat && occ.start === occ.end,
            'sf-dimmed': spotlightStateOf(occ.task) === 'dimmed',
            'sf-dissolved': spotlightStateOf(occ.task) === 'dissolved',
          }"
          :style="accentHexOf(occ.task) ? { '--pill-accent': accentHexOf(occ.task) } : undefined"
          @pointerdown="onAllDayPointerDown(occ, $event)"
          @click="(!canEdit() || occ.task.repeat || occ.start !== occ.end) && onEditCard(occ)"
          @contextmenu.prevent.stop="onCardMenu(occ, $event)"
        >
          <span v-if="accentHexOf(occ.task)" class="pill-dot" aria-hidden="true" />
          <span class="pill-title">{{ occ.task.title }}</span>
        </div>
      </div>
    </div>

    <div ref="scrollRef" class="day-scroll">
      <div class="day-canvas" :class="{ entering: dayTransitioning }">
        <div class="time-axis" :style="{ height: `${TOTAL_HEIGHT}px` }" aria-hidden="true">
          <div
            v-for="h in HOURS"
            :key="h"
            class="hour-label"
            :class="{ occluded: isHourOccluded(h) }"
            :style="{ top: `${h * HOUR_HEIGHT}px` }"
          >
            {{ String(h).padStart(2, '0') }}:00
          </div>
          <div
            class="hour-label end-label"
            :class="{ occluded: isHourOccluded(24) }"
            :style="{ top: `${TOTAL_HEIGHT}px` }"
          >
            24:00
          </div>

          <Transition name="axis-pill">
            <div v-if="pillState" class="axis-pill" :style="{ top: `${pillState.y}px` }">
              {{ pillState.label }}
            </div>
          </Transition>
        </div>

        <div
          ref="trackRef"
          class="timeline-track"
          :style="{ height: `${TOTAL_HEIGHT}px` }"
          @pointerdown="onTrackPointerDown"
          @dblclick="onTrackDblClick"
        >
          <div v-for="h in HOURS" :key="`hl-${h}`" class="hour-line" :style="{ top: `${h * HOUR_HEIGHT}px` }" />
          <div class="hour-line" :style="{ top: `${TOTAL_HEIGHT}px` }" />

          <div
            v-for="h in HOURS"
            :key="`hh-${h}`"
            class="half-line"
            :style="{ top: `${(h + 0.5) * HOUR_HEIGHT}px` }"
          />

          <Transition name="guide-fade">
            <div v-if="pillState" class="snap-guide" :style="{ top: `${pillState.y}px` }" aria-hidden="true" />
          </Transition>

          <div
            v-if="ui.selected === now"
            class="now-line"
            :style="{ top: `${(nowMin / 60) * HOUR_HEIGHT}px` }"
            aria-hidden="true"
          >
            <span class="now-dot" />
            <span class="now-rule" />
          </div>

          <div
            v-for="item in positionedItems"
            :key="item.key"
            class="day-event"
            :class="[
              `density-${cardDensity(item)}`,
              {
                selected: item.isSelected,
                moving: item.isMoving,
                resizing: item.isResizing,
                draft: item.isDraft,
                'pending-draft': item.isPendingDraft,
                done: item.done,
                'has-accent': !!item.accent,
                'sf-dimmed': !!item.occ && !item.isDraft && !item.isMoving && !item.isResizing && spotlightStateOf(item.occ.task) === 'dimmed',
                'sf-dissolved': !!item.occ && !item.isDraft && !item.isMoving && !item.isResizing && spotlightStateOf(item.occ.task) === 'dissolved',
              },
            ]"
            :style="cardStyle(item)"
            @pointerdown="onEventPointerDown(item, $event)"
            @dblclick.stop="item.occ && onEditCard(item.occ)"
            @contextmenu.prevent.stop="item.occ && onCardMenu(item.occ, $event)"
          >
            <span v-if="item.accent" class="ev-accent" aria-hidden="true" />

            <div
              v-if="(!item.isDraft || item.isPendingDraft) && !storeState.readOnly"
              class="resize-handle top"
              @pointerdown.stop="onResizePointerDown(item, 'top', $event)"
            />

            <div class="ev-content">
              <span class="ev-title">{{ item.title }}</span>
              <span class="ev-time">
                <span v-if="cardDensity(item) === 'xs'" class="ev-comma">, </span><span>{{ cardBaseTime(item) }}</span><Transition name="dur-chip"><span v-if="item.showDuration" class="ev-dur"> · {{ formatDurationLabel(item.endMin - item.startMin) }}</span></Transition>
              </span>
            </div>

            <button
              v-if="item.occ && !item.isDraft && !storeState.readOnly"
              type="button"
              class="ev-check"
              :class="{ checked: item.done }"
              :title="item.done ? '标记为未完成' : '标记为完成'"
              @pointerdown.stop
              @click.stop="onToggleDone(item.occ)"
            >
              <FIcon :name="item.done ? 'checkMark' : 'completed'" :size="11" />
            </button>

            <div
              v-if="(!item.isDraft || item.isPendingDraft) && !storeState.readOnly"
              class="resize-handle bottom"
              @pointerdown.stop="onResizePointerDown(item, 'bottom', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.day-view {
  --dv-ink: var(--calendar-text, #1d1b1a);
  --dv-muted: rgba(43, 40, 37, 0.45);
  --dv-axis: rgba(43, 40, 37, 0.4);
  --dv-line: rgba(43, 40, 37, 0.055);
  --dv-half-line: rgba(43, 40, 37, 0.042);
  --dv-card-bg: rgba(43, 40, 37, 0.052);
  --dv-card-hover: rgba(43, 40, 37, 0.082);
  --dv-active-bg-top: #212124;
  --dv-active-bg: #171719;
  --dv-active-ink: #ffffff;
  --dv-active-muted: rgba(255, 255, 255, 0.66);
  --dv-pill-bg: #18181a;
  --dv-pill-ink: #ffffff;
  --dv-now-dot: #e8453c;
  --dv-now-rule: rgba(43, 40, 37, 0.36);
  --dv-guide-line: rgba(24, 24, 27, 0.14);

  --dv-spring-col: cubic-bezier(0.22, 1, 0.36, 1);
  --dv-spring-snap: cubic-bezier(0.22, 1, 0.36, 1);
  --dv-spring-pill: cubic-bezier(0.22, 1, 0.36, 1);

  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  outline: none;
  text-shadow: none;
  --text-glow: none;
  user-select: none;
}

@supports (animation-timing-function: linear(0, 1)) {
  .day-view {
    --dv-spring-col: linear(0.0000, 0.0817, 0.2565, 0.4521, 0.6293, 0.7716, 0.8756, 0.9455, 0.9881, 1.0111, 1.0208, 1.0226, 1.0202, 1.0161, 1.0116, 1.0078, 1.0047, 1.0025, 1.0000);
    --dv-spring-snap: linear(0.0000, 0.1112, 0.3270, 0.5473, 0.7284, 0.8601, 0.9453, 0.9936, 1.0161, 1.0224, 1.0202, 1.0145, 1.0087, 1.0043, 1.0016, 1.0002, 1.0000);
    --dv-spring-pill: linear(0.0000, 0.0979, 0.2953, 0.5065, 0.6904, 0.8313, 0.9277, 0.9862, 1.0165, 1.0273, 1.0265, 1.0202, 1.0128, 1.0067, 1.0026, 1.0004, 1.0000);
  }
}

.day-view.dark {
  --dv-ink: var(--calendar-text, #f4f1ea);
  --dv-muted: rgba(255, 250, 240, 0.5);
  --dv-axis: rgba(255, 250, 240, 0.44);
  --dv-line: rgba(255, 250, 240, 0.072);
  --dv-half-line: rgba(255, 250, 240, 0.045);
  --dv-card-bg: rgba(255, 250, 240, 0.082);
  --dv-card-hover: rgba(255, 250, 240, 0.125);
  --dv-active-bg-top: #faf8f3;
  --dv-active-bg: #ece8df;
  --dv-active-ink: #191816;
  --dv-active-muted: rgba(25, 24, 22, 0.62);
  --dv-pill-bg: #f4f1ea;
  --dv-pill-ink: #191816;
  --dv-now-dot: #ff5a52;
  --dv-now-rule: rgba(255, 250, 240, 0.4);
  --dv-guide-line: rgba(255, 250, 240, 0.18);
}

.day-view.dragging-move,
.day-view.dragging-move * {
  cursor: grabbing !important;
}

.day-view.dragging-resize,
.day-view.dragging-resize * {
  cursor: ns-resize !important;
}

.day-view.dragging-create,
.day-view.dragging-create * {
  cursor: crosshair !important;
}

.day-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 22px 12px 72px;
}

.day-head-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.day-title {
  margin: 0;
  font-size: calc(18.5px * var(--fs));
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--dv-ink);
  white-space: nowrap;
}

.day-count {
  font-size: calc(13px * var(--fs));
  font-weight: 450;
  color: var(--dv-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.day-head-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.day-lunar {
  font-size: 11.5px;
  color: var(--dv-muted);
  white-space: nowrap;
}

.head-add-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--dv-line);
  background: transparent;
  color: var(--dv-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}

.head-add-btn:hover {
  background: var(--dv-card-bg);
  color: var(--dv-ink);
  border-color: var(--dv-card-hover);
}

.allday-strip {
  flex: none;
  display: flex;
  align-items: flex-start;
  padding: 2px 22px 8px 0;
}

.allday-label {
  width: 72px;
  flex: none;
  box-sizing: border-box;
  padding-right: 14px;
  padding-top: 4px;
  text-align: right;
  font-size: 11px;
  color: var(--dv-axis);
}

.allday-list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.allday-pill {
  height: 24px;
  max-width: 240px;
  padding: 0 10px;
  border-radius: 7px;
  background: var(--dv-card-bg);
  color: var(--dv-ink);
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition:
    background-color 140ms ease,
    filter 230ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 230ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 230ms cubic-bezier(0.22, 1, 0.36, 1);
}

.allday-pill.draggable {
  cursor: grab;
}

.allday-pill:hover {
  background: var(--dv-card-hover);
}

.allday-pill.done .pill-title {
  text-decoration: line-through;
  opacity: 0.55;
}

.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--pill-accent);
}

.pill-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}

.day-canvas {
  display: flex;
  align-items: flex-start;
  padding: 16px 0 24px;
  position: relative;
}

.day-canvas.entering {
  animation: day-enter 170ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes day-enter {
  from {
    opacity: 0.55;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.time-axis {
  width: 72px;
  flex: none;
  position: relative;
}

.hour-label {
  position: absolute;
  left: 0;
  right: 0;
  padding-right: 14px;
  transform: translateY(-50%);
  text-align: right;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--dv-axis);
  line-height: 1;
  pointer-events: none;
  transition: opacity 110ms ease;
}

.hour-label.end-label {
  opacity: 0.52;
}

.hour-label.occluded {
  opacity: 0;
}

.axis-pill {
  position: absolute;
  right: 10px;
  transform: translateY(-50%) scale(1);
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--dv-pill-bg);
  color: var(--dv-pill-ink);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(18, 16, 15, 0.22);
  z-index: 22;
  pointer-events: none;
  transition: top 110ms cubic-bezier(0.2, 0, 0, 1);
}

.axis-pill::after {
  content: '';
  position: absolute;
  right: -2.5px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: inherit;
  transform: translateY(-50%) rotate(45deg);
}

.axis-pill-enter-active,
.axis-pill-leave-active {
  transition:
    opacity 160ms ease,
    transform 240ms var(--dv-spring-pill);
}

.axis-pill-enter-from,
.axis-pill-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(18px) scale(0.76);
}

.timeline-track {
  flex: 1;
  min-width: 0;
  margin-right: 22px;
  position: relative;
}

.hour-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--dv-line);
  pointer-events: none;
}

.half-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  border-top: 1px dashed var(--dv-half-line);
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

.day-view.dragging .half-line {
  opacity: 1;
}

.snap-guide {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--dv-guide-line);
  z-index: 9;
  pointer-events: none;
  transition: top 110ms cubic-bezier(0.2, 0, 0, 1);
}

.guide-fade-enter-active,
.guide-fade-leave-active {
  transition: opacity 140ms ease;
}

.guide-fade-enter-from,
.guide-fade-leave-to {
  opacity: 0;
}

.now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  z-index: 8;
  pointer-events: none;
}

.now-dot {
  position: absolute;
  left: -3.5px;
  top: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dv-now-dot);
}

.now-rule {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--dv-now-rule);
}

.day-event {
  position: absolute;
  box-sizing: border-box;
  border-radius: 11px;
  padding: 9px 14px;
  background: var(--dv-card-bg);
  border: 1px solid transparent;
  color: var(--dv-ink);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 2px;
  overflow: hidden;
  cursor: grab;
  z-index: 12;
  transition:
    left 420ms var(--dv-spring-col),
    width 420ms var(--dv-spring-col),
    top 280ms var(--dv-spring-snap),
    height 280ms var(--dv-spring-snap),
    transform 280ms var(--dv-spring-snap),
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 200ms ease,
    filter 230ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 230ms cubic-bezier(0.22, 1, 0.36, 1);
}

.day-event.has-accent {
  padding-left: 16px;
}

.ev-accent {
  position: absolute;
  left: 5px;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 999px;
  background: var(--ev-accent);
  opacity: 0.78;
  pointer-events: none;
}

.day-event:hover:not(.selected) {
  background: var(--dv-card-hover);
}

.day-event.selected {
  background: linear-gradient(180deg, var(--dv-active-bg-top) 0%, var(--dv-active-bg) 100%);
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--dv-active-ink);
  box-shadow:
    0 2px 8px rgba(15, 14, 13, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  z-index: 16;
}

.day-view.dark .day-event.selected {
  border-color: rgba(25, 24, 22, 0.08);
  box-shadow:
    0 2px 10px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.day-event.moving {
  cursor: grabbing;
  will-change: transform;
  transition:
    left 420ms var(--dv-spring-col),
    width 420ms var(--dv-spring-col),
    top 280ms var(--dv-spring-snap),
    height 280ms var(--dv-spring-snap),
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 200ms ease;
  box-shadow:
    0 18px 38px -6px rgba(15, 14, 13, 0.28),
    0 6px 14px -4px rgba(15, 14, 13, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  z-index: 26;
}

.day-event.resizing {
  cursor: ns-resize;
  will-change: transform;
  transition:
    left 420ms var(--dv-spring-col),
    width 420ms var(--dv-spring-col),
    top 280ms var(--dv-spring-snap),
    height 280ms var(--dv-spring-snap),
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 200ms ease;
  box-shadow:
    0 14px 30px -6px rgba(15, 14, 13, 0.24),
    0 4px 10px -2px rgba(15, 14, 13, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.09);
  z-index: 26;
}

.day-event.draft {
  pointer-events: none;
  transition:
    left 420ms var(--dv-spring-col),
    width 420ms var(--dv-spring-col),
    top 95ms cubic-bezier(0.2, 0, 0, 1),
    height 95ms cubic-bezier(0.2, 0, 0, 1),
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 200ms ease;
  box-shadow:
    0 12px 28px -4px rgba(15, 14, 13, 0.22),
    0 4px 10px -2px rgba(15, 14, 13, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.09);
  z-index: 26;
}

.day-event.draft.pending-draft {
  pointer-events: auto;
  cursor: grab;
  outline: 1.5px dashed rgba(255, 255, 255, 0.45);
  outline-offset: -3px;
}

.day-event.draft.pending-draft.moving {
  cursor: grabbing;
}

.day-event.done {
  opacity: 0.56;
}

.day-event.done .ev-title {
  text-decoration: line-through;
}

.day-event.density-xs,
.day-event.density-sm {
  border-radius: 8px;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  padding: 0 26px 0 14px;
}

.day-event.density-xs.has-accent,
.day-event.density-sm.has-accent {
  padding-left: 16px;
}

.ev-content {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 2px;
  min-width: 0;
  width: 100%;
  padding-right: 22px;
  box-sizing: border-box;
}

.day-event.density-sm .ev-content {
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
  padding-right: 0;
}

.day-event.density-xs .ev-content {
  flex-direction: row;
  align-items: baseline;
  gap: 0;
  padding-right: 0;
}

.ev-title {
  font-size: calc(12.5px * var(--fs));
  font-weight: 550;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.day-event.selected .ev-title {
  font-weight: 600;
}

.ev-time {
  font-size: calc(11.5px * var(--fs));
  font-weight: 450;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  color: var(--dv-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.day-event.density-xs .ev-time,
.day-event.density-sm .ev-time {
  flex: none;
}

.day-event.selected .ev-time {
  color: var(--dv-active-muted);
}

.ev-dur {
  display: inline-block;
  font-variant-numeric: tabular-nums;
}

.dur-chip-enter-active,
.dur-chip-leave-active {
  transition:
    opacity 140ms ease,
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.dur-chip-enter-from,
.dur-chip-leave-to {
  opacity: 0;
  transform: translateX(-4px);
}

.ev-check {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 130ms ease, background-color 130ms ease;
}

.day-event.density-xs .ev-check,
.day-event.density-sm .ev-check {
  top: 50%;
  transform: translateY(-50%);
}

.day-event:hover .ev-check,
.ev-check.checked {
  opacity: 0.72;
}

.ev-check:hover {
  opacity: 1 !important;
  background: rgba(128, 128, 128, 0.16);
}

.resize-handle {
  position: absolute;
  left: 10px;
  right: 10px;
  height: 7px;
  cursor: ns-resize;
  touch-action: none;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
}

.resize-handle.top {
  top: 0;
}

.resize-handle.bottom {
  bottom: 0;
}

.resize-handle::after {
  content: '';
  width: 24px;
  height: 2.5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0;
  transition: opacity 130ms ease;
}

.resize-handle:hover::after,
.day-event.resizing .resize-handle::after {
  opacity: 0.42;
}

.day-view.reduce-motion *,
.day-view.reduce-motion .day-event,
.day-view.reduce-motion .axis-pill,
.day-view.reduce-motion .snap-guide {
  transition: none !important;
  animation: none !important;
}

.day-event.sf-dimmed,
.allday-pill.sf-dimmed {
  filter: grayscale(1) saturate(0.08);
  opacity: 0.56;
  background: #EAE9E6 !important;
  color: rgba(28, 25, 23, 0.52) !important;
}

.day-event.sf-dimmed .ev-accent,
.allday-pill.sf-dimmed .pill-dot {
  background: rgba(28, 25, 23, 0.22) !important;
}

.day-view.dark .day-event.sf-dimmed,
.day-view.dark .allday-pill.sf-dimmed {
  background: #22242B !important;
  color: rgba(242, 240, 235, 0.44) !important;
}

.day-view.dark .day-event.sf-dimmed .ev-accent,
.day-view.dark .allday-pill.sf-dimmed .pill-dot {
  background: rgba(255, 255, 255, 0.22) !important;
}

.day-event.sf-dissolved,
.allday-pill.sf-dissolved {
  filter: grayscale(1) blur(8px);
  opacity: 0;
  transform: scale(0.955);
  pointer-events: none;
}

@media (max-width: 639px) {
  .day-head {
    padding: 10px 12px 10px 50px;
  }
  .allday-strip {
    padding: 2px 12px 8px 0;
  }
  .allday-label,
  .time-axis {
    width: 50px;
  }
  .allday-label,
  .hour-label {
    padding-right: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .day-event,
  .allday-pill {
    transition: opacity 80ms linear !important;
  }
  .day-event.sf-dissolved,
  .allday-pill.sf-dissolved {
    filter: none;
    transform: none;
  }
}
</style>
