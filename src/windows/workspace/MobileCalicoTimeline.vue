<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import {
  addDays,
  formatMD,
  pad2,
  parts,
  startOfMonth,
  weekday,
  WEEKDAY_SHORT,
} from '@/lib/date';
import {
  CALICO_DEFAULT_HOUR_H,
  CALICO_MAX_DAYS,
  CALICO_MAX_HOUR_H,
  CALICO_MIN_DAYS,
  CALICO_MIN_HOUR_H,
  buildCalicoDayBlocks,
  buildDateBuffer,
  clamp,
  classifyPinchAxis,
  computePinchedDays,
  computePinchedHourHeight,
  expApproach,
  formatCalicoDuration,
  headerTierForDays,
  snapDayCount,
  toCalicoRawEvents,
  type CalicoDayStop,
  type CalicoEventBlock,
  type PinchAxis,
} from '@/lib/calicoTimeline';
import { DAY_MINUTES, floorMinutes, formatMinToHHMM } from '@/lib/dayLayout';
import { flexKind } from '@/lib/flex';
import { occurrences, type Occurrence } from '@/lib/recur';
import { projectSubscriptionForCalendar } from '@/lib/subscriptions';
import { setOccurrenceDone } from '@/lib/tasks';
import { doc, taskList } from '@/stores/doc';
import type { ISODate, Task } from '@/types';
import { goToday, openEditor, spotlightGroups, ui } from '../desk/state';
import TaskCheckButton from './TaskCheckButton.vue';

const props = withDefaults(
  defineProps<{
    initialDays?: CalicoDayStop;
  }>(),
  {
    initialDays: 1,
  },
);

const emit = defineEmits<{
  openTask: [taskId: string, date?: ISODate];
  dockCompact: [compact: boolean];
}>();

const BUFFER_BEFORE = 4;
const BUFFER_AFTER = 10;
const GUTTER_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const rootRef = ref<HTMLElement>();
const scrollRef = ref<HTMLElement>();
const trackWidth = ref(342);

// Continuous animated physics state (Calico 1:1 touch choreography)
const continuousDays = ref<number>(props.initialDays);
const targetDays = ref<CalicoDayStop>(props.initialDays);
const hourHeight = ref<number>(CALICO_DEFAULT_HOUR_H);
const targetHourHeight = ref<number>(CALICO_DEFAULT_HOUR_H);
const panOffsetPx = ref<number>(0);
const snapPanTargetPx = ref<number>(0);
const pendingDayShift = ref<number>(0);

// Zoom HUD pill ("1 天" .. "7 天")
const hudVisible = ref(false);
let hudTimer: ReturnType<typeof setTimeout> | undefined;

// All-day collapsible accordion drawer
const allDayOpen = ref(false);

// Active cluster inspection popover sheet + 1:1 swipe-down dismiss
interface ActiveClusterState {
  date: ISODate;
  block: CalicoEventBlock;
}
const activeCluster = ref<ActiveClusterState | null>(null);
const sheetDragY = ref(0);
const sheetDragging = ref(false);
let sheetTouchStartY = 0;

function onSheetTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return;
  sheetTouchStartY = e.touches[0].clientY;
  sheetDragging.value = true;
}

function onSheetTouchMove(e: TouchEvent) {
  if (!sheetDragging.value || e.touches.length !== 1) return;
  const dy = e.touches[0].clientY - sheetTouchStartY;
  if (dy > 0) {
    e.preventDefault();
    sheetDragY.value = dy;
  }
}

function onSheetTouchEnd() {
  if (!sheetDragging.value) return;
  const close = sheetDragY.value > 72;
  sheetDragging.value = false;
  sheetDragY.value = 0;
  if (close) activeCluster.value = null;
}

// Live red current-time indicator clock
const nowMin = ref(getCurrentMinutes());
let clockTimer: ReturnType<typeof setInterval> | undefined;

function getCurrentMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

const nowTimeText = computed(() => {
  const h = Math.floor(nowMin.value / 60);
  const m = nowMin.value % 60;
  return `${h}:${pad2(m)}`;
});

const nowTopPx = computed(() => (nowMin.value / 60) * hourHeight.value);
const totalCanvasHeight = computed(() => hourHeight.value * 24);

watch(
  () => props.initialDays,
  (next) => {
    targetDays.value = next;
    if (prefersReducedMotion()) {
      continuousDays.value = next;
    } else {
      startSpringLoop();
    }
  },
);

// Track width measurement via ResizeObserver
let ro: ResizeObserver | undefined;
function updateTrackWidth() {
  const el = scrollRef.value ?? rootRef.value;
  if (!el) return;
  const w = el.clientWidth - GUTTER_PX;
  if (w > 100) trackWidth.value = w;
}

const colWidth = computed(() => Math.max(36, trackWidth.value / Math.max(0.75, continuousDays.value)));
const baseTranslatePx = computed(() => -BUFFER_BEFORE * colWidth.value);
const stripTransform = computed(
  () => `translate3d(${(baseTranslatePx.value + panOffsetPx.value).toFixed(2)}px, 0, 0)`,
);
const headerTier = computed(() => headerTierForDays(continuousDays.value));
const hudDaysLabel = computed(() => `${Math.round(clamp(continuousDays.value, CALICO_MIN_DAYS, CALICO_MAX_DAYS))} 天`);

const anchorDate = computed<ISODate>(() => ui.selected || now.value);
const bufferDates = computed<ISODate[]>(() =>
  buildDateBuffer(anchorDate.value, BUFFER_BEFORE, BUFFER_AFTER, addDays),
);

const visibleDates = computed<ISODate[]>(() => {
  const count = Math.max(1, Math.min(7, Math.ceil(continuousDays.value)));
  return bufferDates.value.slice(BUFFER_BEFORE, BUFFER_BEFORE + count);
});

const visibleRangeStart = computed(() => bufferDates.value[0] ?? anchorDate.value);
const visibleRangeEnd = computed(() => bufferDates.value[bufferDates.value.length - 1] ?? anchorDate.value);

function accentOf(t: Task): string {
  const key = t.color || (t.groupId ? doc.groups[t.groupId]?.color : '') || 'blue';
  return taskColor(key, isDark.value).bar;
}

function isTaskDimmed(t: Task): boolean {
  const sp = spotlightGroups.value;
  if (!sp.length) return false;
  const gid = t.groupId && doc.groups[t.groupId] ? t.groupId : '';
  return !sp.includes(gid);
}

// Compute occurrences across the entire buffered range once so horizontal swipes have zero layout stutter
const dayDataMap = computed(() => {
  const start = visibleRangeStart.value;
  const end = visibleRangeEnd.value;
  const allDay: Record<ISODate, Occurrence[]> = {};
  const timed: Record<ISODate, Occurrence[]> = {};

  for (const raw of taskList.value) {
    if (raw.countdownOnly || raw.habitOnly || flexKind(raw)) continue;
    const t = raw.subscriptionOnly ? projectSubscriptionForCalendar(raw, now.value) : raw;
    if (!t) continue;
    const occs = occurrences(t, start, end);
    for (const o of occs) {
      const isAll = !o.task.time || o.start !== o.end;
      let cur = o.start < start ? start : o.start;
      const last = o.end > end ? end : o.end;
      while (cur <= last) {
        if (isAll) {
          (allDay[cur] ??= []).push(o);
        } else {
          (timed[cur] ??= []).push(o);
        }
        cur = addDays(cur, 1);
      }
    }
  }

  return { allDay, timed };
});

const visibleAllDayCount = computed(() => {
  let count = 0;
  for (const iso of visibleDates.value) {
    count += dayDataMap.value.allDay[iso]?.length ?? 0;
  }
  return count;
});

function allDayItemsFor(iso: ISODate): Occurrence[] {
  return dayDataMap.value.allDay[iso] ?? [];
}

function blocksFor(iso: ISODate): CalicoEventBlock[] {
  const raw = toCalicoRawEvents(dayDataMap.value.timed[iso] ?? [], accentOf);
  return buildCalicoDayBlocks(raw, hourHeight.value, continuousDays.value);
}

function blockStyle(blk: CalicoEventBlock): Record<string, string> {
  const topPx = (blk.startMin / 60) * hourHeight.value;
  const minH = blk.kind === 'cluster' && blk.clusterStyle === 'capsule' ? 28 : 22;
  const rawH = ((blk.endMin - blk.startMin) / 60) * hourHeight.value;
  const heightPx = Math.max(minH, rawH - 2);
  const gapPx = blk.colCount > 1 ? 2 : 0;
  const widthPct = 100 / blk.colCount;
  const leftPct = blk.col * widthPct;

  return {
    top: `${topPx.toFixed(1)}px`,
    height: `${heightPx.toFixed(1)}px`,
    left: `calc(${leftPct.toFixed(3)}% + 2px)`,
    width: `calc(${widthPct.toFixed(3)}% - ${4 + gapPx}px)`,
    '--ev-accent': blk.accent,
  };
}

function blockPixelHeight(blk: CalicoEventBlock): number {
  return ((blk.endMin - blk.startMin) / 60) * hourHeight.value;
}

function formatFullDayLabel(iso: ISODate): string {
  const [, m, d] = parts(iso);
  const wd = WEEKDAY_SHORT[weekday(iso)];
  return `周${wd}，${m}月${d}日`;
}

function formatCompactDayLabel(iso: ISODate): string {
  const [, m, d] = parts(iso);
  const wd = WEEKDAY_SHORT[weekday(iso)];
  return `周${wd} ${m}/${d}`;
}

function formatRangeShort(startMin: number, endMin: number): string {
  return `${formatMinToHHMM(startMin)} - ${formatMinToHHMM(endMin)}`;
}

function prefersReducedMotion(): boolean {
  if (doc.settings.theme.reduceMotion) return true;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  return false;
}

// ============================================================================
// Frame-rate-independent rAF Spring Loop (handfeel.md §1, §2, §7.1)
// ============================================================================
let springRaf = 0;
let lastSpringTs = 0;
let isPinchScrolling = false;
let springZoomAnchorMin: number | null = null;
let springZoomAnchorViewportY = 0;

function stopSpringLoop() {
  if (springRaf) {
    cancelAnimationFrame(springRaf);
    springRaf = 0;
  }
  lastSpringTs = 0;
}

function startSpringLoop() {
  if (springRaf) return;
  lastSpringTs = performance.now();
  springRaf = requestAnimationFrame(stepSpring);
}

function stepSpring(ts: number) {
  springRaf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (ts - lastSpringTs) / 1000));
  lastSpringTs = ts;

  if (activeGesture.value !== 'none') {
    return;
  }

  let keepRunning = false;

  // 1. Horizontal day-count spring
  const dDiff = targetDays.value - continuousDays.value;
  if (Math.abs(dDiff) > 0.008) {
    continuousDays.value = expApproach(continuousDays.value, targetDays.value, 16, dt);
    keepRunning = true;
  } else if (continuousDays.value !== targetDays.value) {
    continuousDays.value = targetDays.value;
  }

  // 2. Vertical hour-height spring (maintains focal minute anchor!)
  const hDiff = targetHourHeight.value - hourHeight.value;
  if (Math.abs(hDiff) > 0.12) {
    const nextH = expApproach(hourHeight.value, targetHourHeight.value, 15, dt);
    hourHeight.value = nextH;
    if (springZoomAnchorMin !== null && scrollRef.value) {
      isPinchScrolling = true;
      scrollRef.value.scrollTop = Math.max(0, (springZoomAnchorMin / 60) * nextH - springZoomAnchorViewportY);
      requestAnimationFrame(() => {
        isPinchScrolling = false;
      });
    }
    keepRunning = true;
  } else if (hourHeight.value !== targetHourHeight.value) {
    hourHeight.value = targetHourHeight.value;
    springZoomAnchorMin = null;
  } else {
    springZoomAnchorMin = null;
  }

  // 3. Horizontal day-pan snap spring
  const pDiff = snapPanTargetPx.value - panOffsetPx.value;
  if (Math.abs(pDiff) > 0.65) {
    panOffsetPx.value = expApproach(panOffsetPx.value, snapPanTargetPx.value, 18, dt);
    keepRunning = true;
  } else if (panOffsetPx.value !== 0 || pendingDayShift.value !== 0) {
    const shift = pendingDayShift.value;
    pendingDayShift.value = 0;
    snapPanTargetPx.value = 0;
    panOffsetPx.value = 0;
    if (shift !== 0) {
      const nextIso = addDays(anchorDate.value, shift);
      ui.selected = nextIso;
      ui.cursor = startOfMonth(nextIso);
    }
  }

  if (keepRunning) {
    springRaf = requestAnimationFrame(stepSpring);
  }
}

function showDaysHud(autoHideMs?: number) {
  hudVisible.value = true;
  if (hudTimer) clearTimeout(hudTimer);
  if (autoHideMs && autoHideMs > 0) {
    hudTimer = setTimeout(() => {
      hudVisible.value = false;
    }, autoHideMs);
  }
}

// ============================================================================
// Calico 4-Gesture Touch Choreography (1-finger swipe + 2-axis pinch + long-press)
// ============================================================================
const activeGesture = ref<'none' | 'h-swipe' | 'h-pinch' | 'v-pinch'>('none');

// 1-finger tracking
let touch1StartX = 0;
let touch1StartY = 0;
let touch1LastX = 0;
let touch1LastTs = 0;
let panVelPxPerSec = 0;
let touch1Moved = false;
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let lastTapTs = 0;
let lastTapX = 0;
let lastTapY = 0;

// 2-finger pinch tracking
let pinchAxis: PinchAxis | null = null;
let pinchStartDx = 0;
let pinchStartDy = 0;
let pinchStartDays = 1;
let pinchStartHourH = CALICO_DEFAULT_HOUR_H;
let pinchAnchorMin = 9 * 60;
let pinchAnchorOffsetY = 120;

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
}

function beginPinch(t0: Touch, t1: Touch) {
  stopSpringLoop();
  clearLongPress();

  // Commit any pending day shift cleanly before zooming
  if (pendingDayShift.value !== 0) {
    const nextIso = addDays(anchorDate.value, pendingDayShift.value);
    ui.selected = nextIso;
    ui.cursor = startOfMonth(nextIso);
    pendingDayShift.value = 0;
  }
  panOffsetPx.value = 0;
  snapPanTargetPx.value = 0;

  pinchAxis = null;
  pinchStartDx = Math.abs(t1.clientX - t0.clientX);
  pinchStartDy = Math.abs(t1.clientY - t0.clientY);
  pinchStartDays = continuousDays.value;
  pinchStartHourH = hourHeight.value;

  const sc = scrollRef.value;
  if (sc) {
    const rect = sc.getBoundingClientRect();
    const midClientY = (t0.clientY + t1.clientY) / 2;
    pinchAnchorOffsetY = clamp(midClientY - rect.top, 0, rect.height);
    pinchAnchorMin = clamp(((sc.scrollTop + pinchAnchorOffsetY) / hourHeight.value) * 60, 0, DAY_MINUTES);
  }
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length >= 2) {
    beginPinch(e.touches[0], e.touches[1]);
    return;
  }

  if (e.touches.length === 1) {
    stopSpringLoop();
    const t = e.touches[0];
    touch1StartX = t.clientX;
    touch1StartY = t.clientY;
    touch1LastX = t.clientX;
    touch1LastTs = performance.now();
    panVelPxPerSec = 0;
    touch1Moved = false;

    // Schedule long-press quick-create ONLY on empty timeline space (not on events/buttons)
    const target = e.target as HTMLElement | null;
    if (target && !target.closest('.ctl-ev, .ctl-cluster, button')) {
      const colEl = target.closest<HTMLElement>('[data-day-iso]');
      const iso = colEl?.dataset.dayIso as ISODate | undefined;
      if (iso) {
        const clientY = t.clientY;
        clearLongPress();
        longPressTimer = setTimeout(() => {
          createAtClientY(iso, clientY);
        }, 430);
      }
    }
  }
}

function onTouchMove(e: TouchEvent) {
  // 2-finger pinch (horizontal day-count zoom OR vertical hour-height zoom)
  if (e.touches.length >= 2) {
    e.preventDefault();
    clearLongPress();

    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const curDx = Math.abs(t1.clientX - t0.clientX);
    const curDy = Math.abs(t1.clientY - t0.clientY);

    if (!pinchAxis) {
      pinchAxis = classifyPinchAxis(pinchStartDx, pinchStartDy, curDx, curDy);
      if (!pinchAxis) return;
      activeGesture.value = pinchAxis === 'horizontal' ? 'h-pinch' : 'v-pinch';
      emit('dockCompact', true);
    }

    if (pinchAxis === 'horizontal') {
      continuousDays.value = computePinchedDays(pinchStartDays, pinchStartDx, curDx);
      showDaysHud();
    } else {
      const nextH = computePinchedHourHeight(pinchStartHourH, pinchStartDy, curDy);
      hourHeight.value = nextH;
      targetHourHeight.value = clamp(nextH, CALICO_MIN_HOUR_H, CALICO_MAX_HOUR_H);
      const sc = scrollRef.value;
      if (sc) {
        isPinchScrolling = true;
        sc.scrollTop = Math.max(0, (pinchAnchorMin / 60) * nextH - pinchAnchorOffsetY);
        requestAnimationFrame(() => {
          isPinchScrolling = false;
        });
      }
    }
    return;
  }

  // 1-finger gesture: classify horizontal 1:1 pan vs native vertical scroll
  if (e.touches.length === 1 && activeGesture.value !== 'h-pinch' && activeGesture.value !== 'v-pinch') {
    const t = e.touches[0];
    const dx = t.clientX - touch1StartX;
    const dy = t.clientY - touch1StartY;

    if (Math.abs(dx) > 7 || Math.abs(dy) > 7) {
      touch1Moved = true;
      clearLongPress();
    }

    if (activeGesture.value === 'none') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        activeGesture.value = 'h-swipe';
      } else {
        // Let native vertical scroll handle vertical motion at silky 60fps
        return;
      }
    }

    if (activeGesture.value === 'h-swipe') {
      e.preventDefault();
      const nowTs = performance.now();
      const dtSec = Math.max(0.004, (nowTs - touch1LastTs) / 1000);
      const instVel = (t.clientX - touch1LastX) / dtSec;
      panVelPxPerSec = panVelPxPerSec * 0.55 + instVel * 0.45;
      touch1LastX = t.clientX;
      touch1LastTs = nowTs;

      // Clamp drag within the pre-rendered day buffer with soft rubber-band resistance
      const maxDrag = colWidth.value * 3.4;
      panOffsetPx.value = clamp(dx, -maxDrag, maxDrag);
    }
  }
}

function onTouchEnd(e: TouchEvent) {
  clearLongPress();

  // Finishing a 2-finger pinch
  if ((activeGesture.value === 'h-pinch' || activeGesture.value === 'v-pinch') && e.touches.length < 2) {
    const prev = activeGesture.value;
    activeGesture.value = 'none';
    pinchAxis = null;

    if (prev === 'h-pinch') {
      targetDays.value = snapDayCount(continuousDays.value);
      showDaysHud(700);
      if (prefersReducedMotion()) {
        continuousDays.value = targetDays.value;
      } else {
        startSpringLoop();
      }
    } else {
      targetHourHeight.value = clamp(hourHeight.value, CALICO_MIN_HOUR_H, CALICO_MAX_HOUR_H);
      springZoomAnchorMin = pinchAnchorMin;
      springZoomAnchorViewportY = pinchAnchorOffsetY;
      if (prefersReducedMotion()) {
        hourHeight.value = targetHourHeight.value;
      } else {
        startSpringLoop();
      }
    }
    return;
  }

  // Finishing a 1-finger horizontal day swipe
  if (activeGesture.value === 'h-swipe' && e.touches.length === 0) {
    activeGesture.value = 'none';
    const cw = colWidth.value;
    const projectedPx = panOffsetPx.value + panVelPxPerSec * 0.16;

    let shift = 0;
    if (Math.abs(panOffsetPx.value) > cw * 0.22 || Math.abs(panVelPxPerSec) > 360) {
      if (continuousDays.value <= 1.55) {
        shift = projectedPx < 0 ? 1 : -1;
      } else {
        const rawCols = Math.round(-projectedPx / cw);
        shift = clamp(rawCols !== 0 ? rawCols : projectedPx < 0 ? 1 : -1, -3, 3);
      }
    }

    if (prefersReducedMotion()) {
      panOffsetPx.value = 0;
      snapPanTargetPx.value = 0;
      pendingDayShift.value = 0;
      if (shift !== 0) {
        const nextIso = addDays(anchorDate.value, shift);
        ui.selected = nextIso;
        ui.cursor = startOfMonth(nextIso);
      }
    } else {
      pendingDayShift.value = shift;
      snapPanTargetPx.value = -shift * cw;
      startSpringLoop();
    }
    return;
  }

  // Double-tap empty slot to quick-create timed event
  if (e.touches.length === 0 && !touch1Moved && e.changedTouches.length === 1) {
    const ct = e.changedTouches[0];
    const target = e.target as HTMLElement | null;
    if (target && !target.closest('.ctl-ev, .ctl-cluster, button')) {
      const nowTs = performance.now();
      if (
        nowTs - lastTapTs < 320 &&
        Math.hypot(ct.clientX - lastTapX, ct.clientY - lastTapY) < 28
      ) {
        lastTapTs = 0;
        const colEl = target.closest<HTMLElement>('[data-day-iso]');
        const iso = colEl?.dataset.dayIso as ISODate | undefined;
        if (iso) createAtClientY(iso, ct.clientY);
      } else {
        lastTapTs = nowTs;
        lastTapX = ct.clientX;
        lastTapY = ct.clientY;
      }
    }
  }
}

// ============================================================================
// Scroll-Linked Auto-Hide Bottom Dock (Calico video 00:00-00:03)
// ============================================================================
let lastScrollTop = 0;
let scrollDirAccum = 0;

function onTimelineScroll() {
  const sc = scrollRef.value;
  if (!sc || isPinchScrolling || activeGesture.value === 'v-pinch') return;
  const cur = sc.scrollTop;
  const delta = cur - lastScrollTop;
  lastScrollTop = cur;

  if (cur <= 28) {
    scrollDirAccum = 0;
    emit('dockCompact', false);
    return;
  }

  if ((delta > 0 && scrollDirAccum < 0) || (delta < 0 && scrollDirAccum > 0)) {
    scrollDirAccum = delta;
  } else {
    scrollDirAccum += delta;
  }

  if (scrollDirAccum > 24) {
    scrollDirAccum = 0;
    emit('dockCompact', true);
  } else if (scrollDirAccum < -20) {
    scrollDirAccum = 0;
    emit('dockCompact', false);
  }
}

// ============================================================================
// Trackpad / Desktop Wheel Parity (Ctrl+Wheel = vertical zoom, Alt+Wheel = days zoom)
// ============================================================================
let wheelSnapTimer: ReturnType<typeof setTimeout> | undefined;

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.altKey) return;
  e.preventDefault();

  if (e.altKey) {
    // Horizontal day-count continuous zoom
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    continuousDays.value = clamp(continuousDays.value * factor, CALICO_MIN_DAYS, CALICO_MAX_DAYS);
    showDaysHud();
    if (wheelSnapTimer) clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => {
      targetDays.value = snapDayCount(continuousDays.value);
      showDaysHud(650);
      if (prefersReducedMotion()) continuousDays.value = targetDays.value;
      else startSpringLoop();
    }, 200);
    return;
  }

  // Ctrl+Wheel vertical hour-height zoom anchored at cursor Y
  const sc = scrollRef.value;
  const rect = sc?.getBoundingClientRect();
  const offsetY = sc && rect ? clamp(e.clientY - rect.top, 0, rect.height) : 140;
  const anchorMin = sc ? ((sc.scrollTop + offsetY) / hourHeight.value) * 60 : 9 * 60;
  const nextH = clamp(hourHeight.value * (e.deltaY < 0 ? 1.1 : 0.9), CALICO_MIN_HOUR_H, CALICO_MAX_HOUR_H);
  hourHeight.value = nextH;
  targetHourHeight.value = nextH;
  if (sc) {
    isPinchScrolling = true;
    sc.scrollTop = Math.max(0, (anchorMin / 60) * nextH - offsetY);
    requestAnimationFrame(() => {
      isPinchScrolling = false;
    });
  }
}

// ============================================================================
// Event / Cluster / Slot Interactions
// ============================================================================
function createAtClientY(iso: ISODate, clientY: number) {
  const sc = scrollRef.value;
  if (!sc) return;
  const rect = sc.getBoundingClientRect();
  const contentY = sc.scrollTop + (clientY - rect.top);
  const rawMin = (contentY / hourHeight.value) * 60;
  const snapped = clamp(floorMinutes(rawMin, 15), 0, DAY_MINUTES - 30);
  openEditor({
    mode: 'new',
    start: iso,
    end: iso,
    time: formatMinToHHMM(snapped),
    duration: 60,
  });
}

function onColDblClick(iso: ISODate, e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.ctl-ev, .ctl-cluster, button')) return;
  createAtClientY(iso, e.clientY);
}

function onBlockClick(iso: ISODate, blk: CalicoEventBlock) {
  if (blk.kind === 'cluster') {
    activeCluster.value = { date: iso, block: blk };
    return;
  }
  if (blk.task) {
    emit('openTask', blk.task.id, iso);
  }
}

function zoomIntoActiveCluster() {
  const cur = activeCluster.value;
  if (!cur) return;
  const midMin = (cur.block.startMin + cur.block.endMin) / 2;
  const targetDate = cur.date;
  activeCluster.value = null;

  ui.selected = targetDate;
  ui.cursor = startOfMonth(targetDate);
  targetDays.value = 1;
  targetHourHeight.value = 68;
  showDaysHud(700);

  const sc = scrollRef.value;
  if (sc) {
    springZoomAnchorMin = midMin;
    springZoomAnchorViewportY = Math.round(sc.clientHeight * 0.42);
  }

  if (prefersReducedMotion()) {
    continuousDays.value = 1;
    hourHeight.value = 68;
    if (sc) sc.scrollTop = Math.max(0, (midMin / 60) * 68 - sc.clientHeight * 0.42);
  } else {
    startSpringLoop();
  }
}

function toggleClusterEventDone(ev: CalicoEventBlock['events'][number]) {
  void setOccurrenceDone(ev.task, ev.occ.date, !ev.done);
  // Keep sheet synced reactively via taskList recomputation
  nextTick(() => {
    if (!activeCluster.value) return;
    const latestBlocks = blocksFor(activeCluster.value.date);
    const match = latestBlocks.find((b) => b.kind === 'cluster' && b.id === activeCluster.value?.block.id);
    if (match) {
      activeCluster.value = { date: activeCluster.value.date, block: match };
    }
  });
}

function openClusterEvent(ev: CalicoEventBlock['events'][number]) {
  const date = activeCluster.value?.date;
  activeCluster.value = null;
  emit('openTask', ev.task.id, date);
}

function onHeaderDayClick(iso: ISODate) {
  ui.selected = iso;
  ui.cursor = startOfMonth(iso);
  if (continuousDays.value > 1.55) {
    targetDays.value = 1;
    showDaysHud(650);
    if (prefersReducedMotion()) continuousDays.value = 1;
    else startSpringLoop();
  }
}

function scrollToInitialHour() {
  const sc = scrollRef.value;
  if (!sc) return;
  // Scroll smoothly to ~7:30 or 1.5h before current time so daytime agenda is front and center
  const targetMin = anchorDate.value === now.value ? Math.max(7 * 60, nowMin.value - 120) : 7.5 * 60;
  sc.scrollTop = Math.max(0, (targetMin / 60) * hourHeight.value);
  lastScrollTop = sc.scrollTop;
}

onMounted(() => {
  updateTrackWidth();
  if (typeof ResizeObserver !== 'undefined' && scrollRef.value) {
    ro = new ResizeObserver(updateTrackWidth);
    ro.observe(scrollRef.value);
  }
  clockTimer = setInterval(() => {
    nowMin.value = getCurrentMinutes();
  }, 30_000);
  nextTick(() => {
    scrollToInitialHour();
  });
});

onBeforeUnmount(() => {
  stopSpringLoop();
  clearLongPress();
  if (hudTimer) clearTimeout(hudTimer);
  if (wheelSnapTimer) clearTimeout(wheelSnapTimer);
  if (clockTimer) clearInterval(clockTimer);
  ro?.disconnect();
  emit('dockCompact', false);
});
</script>

<template>
  <section
    ref="rootRef"
    class="ctl-root"
    :class="{
      gesturing: activeGesture !== 'none',
      'tier-squircle': headerTier === 'squircle',
    }"
    :data-days="Math.round(continuousDays)"
    :data-hour-h="Math.round(hourHeight)"
    aria-label="移动端触控时间轴"
  >
    <!-- Top-Right Floating Zoom Days HUD Pill (Calico 00:20-00:34: "1 天" .. "7 天") -->
    <Transition name="ctl-hud">
      <div v-if="hudVisible" class="ctl-days-hud" role="status" aria-live="polite">
        <span class="ctl-hud-dot" aria-hidden="true" />
        <span>{{ hudDaysLabel }}</span>
      </div>
    </Transition>

    <!-- Sticky Sub-Header: Left All-Day Toggle + Synchronized Sliding Day Headers -->
    <header
      class="ctl-subhead"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div class="ctl-gutter-head">
        <button
          type="button"
          class="ctl-allday-toggle"
          :class="{ open: allDayOpen, has: visibleAllDayCount > 0 }"
          :aria-expanded="allDayOpen ? 'true' : 'false'"
          title="展开或收起全天日程"
          @click="allDayOpen = !allDayOpen"
        >
          <span class="ctl-allday-top">
            <span class="ctl-allday-arrows" aria-hidden="true">↕</span>
            <span v-if="visibleAllDayCount > 0" class="ctl-allday-cnt">{{ visibleAllDayCount }}</span>
          </span>
          <span class="ctl-allday-lbl">全天</span>
        </button>
      </div>

      <div class="ctl-days-viewport">
        <div class="ctl-days-strip" :style="{ transform: stripTransform }">
          <div
            v-for="iso in bufferDates"
            :key="`hd:${iso}`"
            class="ctl-day-hd"
            :style="{ width: `${colWidth.toFixed(2)}px` }"
          >
            <!-- Tier 1: Full Centered Pill (1 day) -->
            <button
              v-if="headerTier === 'full'"
              type="button"
              class="ctl-pill-full"
              :class="{ today: iso === now }"
              @click="iso === now ? goToday() : onHeaderDayClick(iso)"
            >
              <span>{{ formatFullDayLabel(iso) }}</span>
            </button>

            <!-- Tier 2: Compact Day Pill (2-3 days) -->
            <button
              v-else-if="headerTier === 'compact'"
              type="button"
              class="ctl-pill-compact"
              :class="{ today: iso === now }"
              @click="onHeaderDayClick(iso)"
            >
              <span>{{ formatCompactDayLabel(iso) }}</span>
            </button>

            <!-- Tier 3: Calico Squircle Day Pill (4-7 days) -->
            <button
              v-else
              type="button"
              class="ctl-pill-squircle"
              :class="{ today: iso === now, selected: iso === anchorDate && iso !== now }"
              @click="onHeaderDayClick(iso)"
            >
              <span class="ctl-sq-wd">{{ WEEKDAY_SHORT[weekday(iso)] }}</span>
              <span class="ctl-sq-num">{{ parts(iso)[2] }}</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Collapsible All-Day Accordion Tray (transitions.dev 21-accordion grid-row reveal) -->
    <div class="ctl-allday-accordion" :class="{ open: allDayOpen }">
      <div class="ctl-allday-inner">
        <div class="ctl-allday-row">
          <div class="ctl-gutter-allday">全天</div>
          <div class="ctl-allday-viewport">
            <div class="ctl-allday-strip" :style="{ transform: stripTransform }">
              <div
                v-for="iso in bufferDates"
                :key="`ad:${iso}`"
                class="ctl-allday-col"
                :style="{ width: `${colWidth.toFixed(2)}px` }"
              >
                <button
                  v-for="o in allDayItemsFor(iso)"
                  :key="`ad-ev:${o.task.id}:${iso}`"
                  type="button"
                  class="ctl-ad-chip"
                  :class="{ done: o.done, dimmed: isTaskDimmed(o.task) }"
                  :style="{ '--ev-accent': accentOf(o.task) }"
                  @click="emit('openTask', o.task.id, iso)"
                >
                  <span class="ctl-ad-bar" aria-hidden="true" />
                  <span class="ctl-ad-title">{{ o.task.title }}</span>
                </button>
                <span v-if="!allDayItemsFor(iso).length" class="ctl-ad-empty">—</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main 24-Hour Touch Scroll & 2-Axis Pinch Canvas -->
    <div
      ref="scrollRef"
      class="ctl-scroll"
      @scroll.passive="onTimelineScroll"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @wheel="onWheel"
    >
      <div class="ctl-canvas" :style="{ height: `${totalCanvasHeight.toFixed(1)}px` }">
        <!-- Left Monospace Hour Gutter + Live Crimson Current-Time Pill -->
        <div class="ctl-gutter" aria-hidden="true">
          <div
            v-for="h in HOURS"
            :key="`hr:${h}`"
            class="ctl-hr-lbl"
            :style="{ top: `${(h * hourHeight).toFixed(1)}px` }"
          >
            <span v-if="h > 0 && (hourHeight >= 30 || h % 2 === 0)">{{ h }}:00</span>
          </div>

          <div class="ctl-now-pill" :style="{ top: `${nowTopPx.toFixed(1)}px` }">
            {{ nowTimeText }}
          </div>
        </div>

        <!-- Synchronized Sliding Multi-Day Grid Viewport -->
        <div class="ctl-grid-viewport">
          <!-- Horizontal Hour Gridlines (full width behind columns) -->
          <div class="ctl-grid-lines" aria-hidden="true">
            <div
              v-for="h in HOURS"
              :key="`gl:${h}`"
              class="ctl-grid-line"
              :style="{ top: `${(h * hourHeight).toFixed(1)}px` }"
            />
            <div class="ctl-now-hairline" :style="{ top: `${nowTopPx.toFixed(1)}px` }" />
          </div>

          <!-- Pre-Rendered Horizontal Day Columns Strip -->
          <div class="ctl-cols-strip" :style="{ transform: stripTransform }">
            <div
              v-for="iso in bufferDates"
              :key="`col:${iso}`"
              class="ctl-day-col"
              :class="{ today: iso === now }"
              :data-day-iso="iso"
              :style="{ width: `${colWidth.toFixed(2)}px` }"
              @dblclick="onColDblClick(iso, $event)"
            >
              <!-- Emphasized Crimson Now Line + Dot on Today Column -->
              <div
                v-if="iso === now"
                class="ctl-now-today-bar"
                :style="{ top: `${nowTopPx.toFixed(1)}px` }"
                aria-hidden="true"
              >
                <span class="ctl-now-dot" />
              </div>

              <!-- Event Cards & Dynamic Clusters -->
              <template v-for="blk in blocksFor(iso)" :key="blk.id">
                <!-- Calico Dynamic Cluster Block (Card on 1-3d, Slim Capsule on 4-7d) -->
                <button
                  v-if="blk.kind === 'cluster'"
                  type="button"
                  class="ctl-cluster"
                  :class="[
                    `style-${blk.clusterStyle}`,
                    { done: blk.done },
                  ]"
                  :style="blockStyle(blk)"
                  :aria-label="`${blk.events.length} 项日程，${formatRangeShort(blk.startMin, blk.endMin)}`"
                  @click.stop="onBlockClick(iso, blk)"
                >
                  <!-- 4-7d Slim Vertical Capsule with Circular Top Count Badge -->
                  <template v-if="blk.clusterStyle === 'capsule'">
                    <span class="ctl-cap-badge">{{ blk.events.length }}</span>
                    <span v-if="blockPixelHeight(blk) >= 54" class="ctl-cap-dots" aria-hidden="true">
                      <i v-for="(c, i) in blk.colors" :key="i" :style="{ background: c }" />
                    </span>
                  </template>

                  <!-- 1-3d Horizontal Light-Grey Cluster Card -->
                  <template v-else>
                    <div class="ctl-cl-main">
                      <div class="ctl-cl-top">
                        <span class="ctl-cl-dots" aria-hidden="true">
                          <i v-for="(c, i) in blk.colors" :key="i" :style="{ background: c }" />
                        </span>
                        <span class="ctl-cl-title">{{ blk.title }}</span>
                      </div>
                      <div v-if="blockPixelHeight(blk) >= 34 && continuousDays <= 2.4" class="ctl-cl-time">
                        {{ formatRangeShort(blk.startMin, blk.endMin) }}
                      </div>
                    </div>
                    <span
                      v-if="continuousDays <= 2.2 && blockPixelHeight(blk) >= 26"
                      class="ctl-cl-dur"
                    >
                      {{ formatCalicoDuration(blk.endMin - blk.startMin) }}
                    </span>
                  </template>
                </button>

                <!-- Individual Calico Pastel Event Card -->
                <button
                  v-else
                  type="button"
                  class="ctl-ev"
                  :class="{
                    done: blk.done,
                    dense: continuousDays > 2.6,
                    tiny: blockPixelHeight(blk) < 34,
                    'near-cluster': blk.nearCluster,
                    dimmed: blk.task ? isTaskDimmed(blk.task) : false,
                  }"
                  :style="blockStyle(blk)"
                  @click.stop="onBlockClick(iso, blk)"
                >
                  <span class="ctl-ev-bar" aria-hidden="true" />
                  <div class="ctl-ev-body">
                    <div class="ctl-ev-head">
                      <span class="ctl-ev-title">{{ blk.title }}</span>
                      <span
                        v-if="continuousDays <= 2.3 && blockPixelHeight(blk) >= 26"
                        class="ctl-ev-dur"
                      >
                        {{ formatCalicoDuration(blk.endMin - blk.startMin) }}
                      </span>
                    </div>
                    <div
                      v-if="continuousDays <= 2.5 && blockPixelHeight(blk) >= 42"
                      class="ctl-ev-time"
                    >
                      {{ formatRangeShort(blk.startMin, blk.endMin) }}
                    </div>
                  </div>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Cluster Inspection Bottom Sheet -->
    <Transition name="ctl-sheet">
      <div
        v-if="activeCluster"
        class="ctl-sheet-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="合并时段日程详情"
        @click.self="activeCluster = null"
      >
        <div
          class="ctl-sheet"
          :class="{ dragging: sheetDragging }"
          :style="sheetDragY > 0 ? { transform: `translate3d(0, ${sheetDragY.toFixed(1)}px, 0)` } : undefined"
        >
          <div
            class="ctl-sheet-drag-head"
            @touchstart="onSheetTouchStart"
            @touchmove="onSheetTouchMove"
            @touchend="onSheetTouchEnd"
            @touchcancel="onSheetTouchEnd"
          >
            <span class="ctl-sheet-grab" aria-hidden="true" />
            <header class="ctl-sheet-head">
              <div class="ctl-sheet-meta">
                <h3 class="ctl-sheet-title">
                  {{ formatMD(activeCluster.date) }} · {{ activeCluster.block.events.length }} 项日程
                </h3>
                <span class="ctl-sheet-sub">
                  {{ formatRangeShort(activeCluster.block.startMin, activeCluster.block.endMin) }}
                  · {{ formatCalicoDuration(activeCluster.block.endMin - activeCluster.block.startMin) }}
                </span>
              </div>
              <button type="button" class="ctl-sheet-zoom" @click="zoomIntoActiveCluster">
                <FIcon name="zoomIn" :size="13" />
                <span>放大查看</span>
              </button>
            </header>
          </div>

          <div class="ctl-sheet-list">
            <div
              v-for="ev in activeCluster.block.events"
              :key="ev.id"
              class="ctl-sheet-item"
              :class="{ done: ev.done }"
              :style="{ '--ev-accent': ev.accent }"
              @click="openClusterEvent(ev)"
            >
              <span class="ctl-si-bar" aria-hidden="true" />
              <div class="ctl-si-main">
                <div class="ctl-si-title">{{ ev.task.title }}</div>
                <div class="ctl-si-time">
                  {{ formatRangeShort(ev.startMin, ev.endMin) }}
                  · {{ formatCalicoDuration(ev.endMin - ev.startMin) }}
                </div>
              </div>
              <TaskCheckButton
                :checked="ev.done"
                :accent-color="ev.accent"
                :size="20"
                @toggle="toggleClusterEventDone(ev)"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.ctl-root {
  --ctl-bg: #ffffff;
  --ctl-card-base: #ffffff;
  --ctl-grid-line: rgba(15, 23, 42, 0.065);
  --ctl-col-line: rgba(15, 23, 42, 0.06);
  --ctl-gutter-ink: rgba(15, 23, 42, 0.44);
  --ctl-pill-bg: #f3f4f6;
  --ctl-pill-ink: #111827;
  --ctl-today-bg: #ea580c;
  --ctl-today-ink: #ffffff;
  --ctl-cluster-bg: #eef0f3;
  --ctl-cluster-border: rgba(15, 23, 42, 0.08);
  --ctl-cluster-ink: #1f2937;
  --ctl-cluster-sub: #6b7280;
  --ctl-cluster-badge-bg: #ffffff;
  --ctl-now-red: #ef4444;

  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--ctl-bg);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

/* Floating Zoom Days HUD ("1 天" .. "7 天") positioned cleanly below sticky header */
.ctl-days-hud {
  position: absolute;
  top: 56px;
  right: 10px;
  z-index: 30;
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.88);
  color: #ffffff;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.ctl-hud-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ctl-today-bg);
}

.ctl-hud-enter-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-fast, 220ms) var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1)),
    filter var(--duration-quick, 150ms) ease;
}

.ctl-hud-leave-active {
  transition:
    opacity var(--duration-quick, 160ms) ease,
    transform var(--duration-quick, 160ms) ease,
    filter var(--duration-quick, 160ms) ease;
}

.ctl-hud-enter-from,
.ctl-hud-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.92);
  filter: blur(2px);
}

/* Sticky Sub-Header */
.ctl-subhead {
  flex: none;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--ctl-grid-line);
  background: var(--ctl-bg);
  z-index: 10;
  position: relative;
}

.ctl-gutter-head {
  width: 48px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  box-sizing: border-box;
}

.ctl-allday-toggle {
  position: relative;
  min-width: 38px;
  padding: 3px 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ctl-gutter-ink);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font: inherit;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, transform 120ms ease;
  -webkit-tap-highlight-color: transparent;
}

.ctl-allday-top {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  line-height: 1;
}

.ctl-allday-lbl {
  font-size: 9.5px;
  font-weight: 680;
  line-height: 1.1;
  white-space: nowrap;
}

.ctl-allday-toggle.open,
.ctl-allday-toggle.has {
  color: var(--ctl-pill-ink);
}

.ctl-allday-toggle.open {
  background: var(--ctl-pill-bg);
}

.ctl-allday-toggle:active {
  transform: scale(0.93);
}

.ctl-allday-arrows {
  font-size: 10.5px;
  line-height: 1;
}

.ctl-allday-cnt {
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--ctl-today-bg);
  color: #ffffff;
  font-size: 8.5px;
  font-weight: 760;
  line-height: 13px;
  text-align: center;
}

.ctl-days-viewport {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.ctl-days-strip {
  display: flex;
  align-items: center;
  will-change: transform;
}

.ctl-day-hd {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  box-sizing: border-box;
}

/* Tier 1: Full Centered Pill */
.ctl-pill-full {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--ctl-pill-bg);
  color: var(--ctl-pill-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.015em;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, transform 120ms ease;
  -webkit-tap-highlight-color: transparent;
}

.ctl-pill-full.today {
  background: var(--ctl-today-bg);
  color: var(--ctl-today-ink);
  box-shadow: 0 2px 8px rgba(234, 88, 12, 0.28);
}

.ctl-pill-full:active {
  transform: scale(0.96);
}

/* Tier 2: Compact Day Pill (2-3d) */
.ctl-pill-compact {
  height: 28px;
  padding: 0 9px;
  max-width: 100%;
  border: 0;
  border-radius: 999px;
  background: var(--ctl-pill-bg);
  color: var(--ctl-pill-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background-color 160ms ease, transform 120ms ease;
  -webkit-tap-highlight-color: transparent;
}

.ctl-pill-compact.today {
  background: var(--ctl-today-bg);
  color: var(--ctl-today-ink);
  box-shadow: 0 2px 7px rgba(234, 88, 12, 0.28);
}

/* Tier 3: Calico Squircle Day Pill (4-7d) */
.ctl-pill-squircle {
  width: 36px;
  max-width: calc(100% - 2px);
  height: 44px;
  padding: 4px 0;
  border: 0;
  border-radius: 12px;
  background: var(--ctl-pill-bg);
  color: var(--ctl-pill-ink);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font: inherit;
  cursor: pointer;
  transition: background-color 160ms ease, transform 120ms ease;
  -webkit-tap-highlight-color: transparent;
}

.ctl-pill-squircle.selected {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ctl-today-bg) 55%, transparent);
}

.ctl-pill-squircle.today {
  background: var(--ctl-today-bg);
  color: var(--ctl-today-ink);
  box-shadow: 0 3px 9px rgba(234, 88, 12, 0.32);
}

.ctl-sq-wd {
  font-size: 10px;
  font-weight: 650;
  line-height: 1;
  opacity: 0.78;
}

.ctl-pill-squircle.today .ctl-sq-wd {
  opacity: 0.94;
}

.ctl-sq-num {
  font-size: 13.5px;
  font-weight: 780;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* All-Day Accordion Tray */
.ctl-allday-accordion {
  flex: none;
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--acc-expand, 240ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    opacity 180ms ease;
  background: var(--ctl-bg);
}

.ctl-allday-accordion.open {
  grid-template-rows: 1fr;
  opacity: 1;
  border-bottom: 1px solid var(--ctl-grid-line);
}

.ctl-allday-inner {
  overflow: hidden;
}

.ctl-allday-row {
  display: flex;
  padding: 6px 0;
}

.ctl-gutter-allday {
  width: 48px;
  flex: none;
  font-size: 10px;
  font-weight: 600;
  color: var(--ctl-gutter-ink);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ctl-allday-viewport {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.ctl-allday-strip {
  display: flex;
  will-change: transform;
}

.ctl-allday-col {
  flex: none;
  padding: 0 3px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  box-sizing: border-box;
}

.ctl-ad-chip {
  width: 100%;
  min-height: 24px;
  padding: 3px 6px 3px 4px;
  border: 1px solid color-mix(in srgb, var(--ev-accent) 26%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--ev-accent) 16%, var(--ctl-card-base));
  color: color-mix(in srgb, var(--ev-accent) 72%, #111827);
  display: flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}

.ctl-ad-chip.done {
  opacity: 0.56;
  text-decoration: line-through;
}

.ctl-ad-chip.dimmed {
  opacity: 0.24;
  filter: blur(1px);
}

.ctl-ad-bar {
  width: 3px;
  height: 13px;
  border-radius: 999px;
  background: var(--ev-accent);
  flex: none;
}

.ctl-ad-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctl-ad-empty {
  font-size: 11px;
  color: var(--ctl-gutter-ink);
  opacity: 0.45;
  text-align: center;
  padding: 3px 0;
}

/* Main 24-Hour Scroll Canvas */
.ctl-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  position: relative;
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
}

.ctl-canvas {
  position: relative;
  display: flex;
  width: 100%;
}

/* Left Time Gutter */
.ctl-gutter {
  width: 48px;
  flex: none;
  position: relative;
  border-right: 1px solid var(--ctl-col-line);
}

.ctl-hr-lbl {
  position: absolute;
  left: 0;
  right: 6px;
  transform: translateY(-50%);
  text-align: right;
  font-size: 10.5px;
  font-weight: 560;
  color: var(--ctl-gutter-ink);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  pointer-events: none;
}

.ctl-now-pill {
  position: absolute;
  right: 3px;
  transform: translateY(-50%);
  z-index: 8;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ctl-now-red);
  color: #ffffff;
  font-size: 9.5px;
  font-weight: 750;
  line-height: 17px;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.35);
  pointer-events: none;
}

/* Grid Viewport & Sliding Columns */
.ctl-grid-viewport {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.ctl-grid-lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.ctl-grid-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--ctl-grid-line);
}

.ctl-now-hairline {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(239, 68, 68, 0.28);
  z-index: 5;
}

.ctl-cols-strip {
  position: relative;
  z-index: 2;
  display: flex;
  height: 100%;
  will-change: transform;
}

.ctl-day-col {
  flex: none;
  height: 100%;
  position: relative;
  border-right: 1px solid var(--ctl-col-line);
  box-sizing: border-box;
}

.ctl-day-col.today {
  background: color-mix(in srgb, var(--ctl-today-bg) 2.5%, transparent);
}

.ctl-now-today-bar {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  transform: translateY(-1px);
  background: var(--ctl-now-red);
  z-index: 6;
  pointer-events: none;
}

.ctl-now-dot {
  position: absolute;
  left: -3.5px;
  top: -2.5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ctl-now-red);
}

/* Individual Calico Pastel Event Card */
.ctl-ev {
  position: absolute;
  z-index: 3;
  border: 1px solid color-mix(in srgb, var(--ev-accent) 26%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ev-accent) 16%, var(--ctl-card-base));
  color: color-mix(in srgb, var(--ev-accent) 72%, #111827);
  padding: 5px 7px 5px 5px;
  display: flex;
  align-items: stretch;
  gap: 6px;
  text-align: left;
  font: inherit;
  overflow: hidden;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    opacity 180ms ease,
    border-color 150ms ease;
  -webkit-tap-highlight-color: transparent;
}

.ctl-ev:active {
  transform: scale(0.975);
}

.ctl-ev.near-cluster {
  transform: scale(0.985);
  border-color: color-mix(in srgb, var(--ev-accent) 44%, transparent);
}

.ctl-ev.dense {
  border-radius: 7px;
  padding: 3px 4px 3px 3px;
  gap: 3px;
}

.ctl-ev.tiny {
  padding-top: 2px;
  padding-bottom: 2px;
  align-items: center;
}

.ctl-ev.done {
  opacity: 0.56;
}

.ctl-ev.done .ctl-ev-title {
  text-decoration: line-through;
}

.ctl-ev.dimmed {
  opacity: 0.22;
  filter: blur(1px);
}

.ctl-ev-bar {
  width: 3px;
  border-radius: 999px;
  background: var(--ev-accent);
  flex: none;
  min-height: 12px;
}

.ctl-ev.dense .ctl-ev-bar {
  width: 2.5px;
}

.ctl-ev-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctl-ev-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.ctl-ev-title {
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.24;
  letter-spacing: -0.01em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.ctl-ev.dense .ctl-ev-title {
  font-size: 10.5px;
  line-height: 1.18;
  -webkit-line-clamp: 3;
}

.ctl-ev.tiny .ctl-ev-title {
  -webkit-line-clamp: 1;
}

.ctl-ev-dur {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ev-accent) 18%, transparent);
  color: color-mix(in srgb, var(--ev-accent) 78%, #111827);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ctl-ev-time {
  font-size: 10.5px;
  font-weight: 560;
  opacity: 0.78;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============================================================================
   Calico Dynamic Cluster Blocks (Card on 1-3d, Slim Capsule on 4-7d)
   ============================================================================ */
.ctl-cluster {
  position: absolute;
  z-index: 4;
  border: 1px solid var(--ctl-cluster-border);
  background: var(--ctl-cluster-bg);
  color: var(--ctl-cluster-ink);
  font: inherit;
  cursor: pointer;
  box-sizing: border-box;
  overflow: hidden;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1)),
    background-color 150ms ease;
  -webkit-tap-highlight-color: transparent;
}

.ctl-cluster:active {
  transform: scale(0.965);
}

.ctl-cluster.done {
  opacity: 0.62;
}

/* Style A (1-3 days): Horizontal Light-Grey Cluster Card ("2 项日程 · 12:00 - 15:00 · 3h") */
.ctl-cluster.style-card {
  border-radius: 10px;
  padding: 5px 8px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  text-align: left;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.ctl-cl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctl-cl-top {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.ctl-cl-dots {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.ctl-cl-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.ctl-cl-title {
  font-size: 12px;
  font-weight: 720;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctl-cl-time {
  font-size: 10.5px;
  font-weight: 550;
  color: var(--ctl-cluster-sub);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctl-cl-dur {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ctl-cluster-badge-bg);
  color: var(--ctl-cluster-sub);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

/* Style B (4-7 days): Iconic Calico Slim Vertical Capsule with Circular Count Badge */
.ctl-cluster.style-capsule {
  border-radius: 999px;
  padding: 3px 2px 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.07);
}

.ctl-cap-badge {
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--ctl-cluster-badge-bg);
  color: var(--ctl-cluster-ink);
  font-size: 11px;
  font-weight: 800;
  line-height: 21px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
  flex: none;
}

.ctl-cap-dots {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.5px;
}

.ctl-cap-dots i {
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  display: block;
}

/* ============================================================================
   Cluster Inspection Bottom Sheet
   ============================================================================ */
.ctl-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: var(--ws-scrim-bg, rgba(15, 23, 42, 0.32));
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

.ctl-sheet {
  width: 100%;
  max-width: 460px;
  max-height: 68vh;
  border-radius: 24px 24px 0 0;
  background: var(--ws-card-bg, #ffffff);
  color: var(--ws-ink, #111827);
  border: 1px solid var(--ws-hairline, rgba(15, 23, 42, 0.08));
  border-bottom: 0;
  box-shadow: 0 -12px 42px rgba(0, 0, 0, 0.2);
  padding: 0 16px max(18px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  transition: transform 220ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.ctl-sheet.dragging {
  transition: none;
}

.ctl-sheet-drag-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  touch-action: none;
}

.ctl-sheet-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink, #111827) 18%, transparent);
  align-self: center;
}

.ctl-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ctl-sheet-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctl-sheet-title {
  margin: 0;
  font-size: 15px;
  font-weight: 760;
  letter-spacing: -0.015em;
}

.ctl-sheet-sub {
  font-size: 12px;
  color: var(--ws-ink-secondary, #6b7280);
  font-variant-numeric: tabular-nums;
}

.ctl-sheet-zoom {
  flex: none;
  height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: var(--ctl-today-bg);
  color: #ffffff;
  font: inherit;
  font-size: 12px;
  font-weight: 680;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(234, 88, 12, 0.26);
}

.ctl-sheet-zoom:active {
  transform: scale(0.95);
}

.ctl-sheet-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
}

.ctl-sheet-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 11px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--ev-accent) 12%, var(--ws-card-subtle, #f8fafc));
  border: 1px solid color-mix(in srgb, var(--ev-accent) 24%, transparent);
  cursor: pointer;
  transition: transform 130ms ease, background-color 140ms ease;
}

.ctl-sheet-item:active {
  transform: scale(0.985);
}

.ctl-sheet-item.done {
  opacity: 0.6;
}

.ctl-sheet-item.done .ctl-si-title {
  text-decoration: line-through;
}

.ctl-si-bar {
  width: 3.5px;
  height: 30px;
  border-radius: 999px;
  background: var(--ev-accent);
  flex: none;
}

.ctl-si-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctl-si-title {
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctl-si-time {
  font-size: 11.5px;
  color: var(--ws-ink-secondary, #6b7280);
  font-variant-numeric: tabular-nums;
}

.ctl-sheet-enter-active {
  transition: opacity 200ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.ctl-sheet-leave-active {
  transition: opacity 150ms ease;
}

.ctl-sheet-enter-from,
.ctl-sheet-leave-to {
  opacity: 0;
}

.ctl-sheet-enter-active .ctl-sheet {
  transition: transform 280ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

.ctl-sheet-leave-active .ctl-sheet {
  transition: transform 160ms ease;
}

.ctl-sheet-enter-from .ctl-sheet,
.ctl-sheet-leave-to .ctl-sheet {
  transform: translateY(28px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .ctl-hud-enter-active,
  .ctl-hud-leave-active,
  .ctl-allday-accordion,
  .ctl-ev,
  .ctl-cluster,
  .ctl-sheet-enter-active,
  .ctl-sheet-leave-active,
  .ctl-sheet-enter-active .ctl-sheet,
  .ctl-sheet-leave-active .ctl-sheet {
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
/* Unscoped Dark-Mode Tokens for MobileCalicoTimeline (Vite 8 + LightningCSS safe) */
html[data-ws-theme='dark'] .ctl-root {
  --ctl-bg: #111216;
  --ctl-card-base: #181a20;
  --ctl-grid-line: rgba(255, 255, 255, 0.075);
  --ctl-col-line: rgba(255, 255, 255, 0.065);
  --ctl-gutter-ink: rgba(242, 240, 235, 0.45);
  --ctl-pill-bg: #1f222a;
  --ctl-pill-ink: #f2f0eb;
  --ctl-today-bg: #ea580c;
  --ctl-today-ink: #ffffff;
  --ctl-cluster-bg: #222630;
  --ctl-cluster-border: rgba(255, 255, 255, 0.11);
  --ctl-cluster-ink: #f3f4f6;
  --ctl-cluster-sub: rgba(242, 240, 235, 0.62);
  --ctl-cluster-badge-bg: #15171d;
}

html[data-ws-theme='dark'] .ctl-root .ctl-ev {
  background: color-mix(in srgb, var(--ev-accent) 24%, #181a20);
  border-color: color-mix(in srgb, var(--ev-accent) 42%, transparent);
  color: color-mix(in srgb, var(--ev-accent) 24%, #ffffff);
}

html[data-ws-theme='dark'] .ctl-root .ctl-ev-dur {
  background: color-mix(in srgb, var(--ev-accent) 28%, rgba(255, 255, 255, 0.06));
  color: color-mix(in srgb, var(--ev-accent) 20%, #ffffff);
}

html[data-ws-theme='dark'] .ctl-root .ctl-ad-chip {
  background: color-mix(in srgb, var(--ev-accent) 26%, #181a20);
  border-color: color-mix(in srgb, var(--ev-accent) 44%, transparent);
  color: color-mix(in srgb, var(--ev-accent) 24%, #ffffff);
}

html[data-ws-theme='dark'] .ctl-root .ctl-days-hud {
  background: rgba(242, 240, 235, 0.92);
  color: #111216;
}
</style>
