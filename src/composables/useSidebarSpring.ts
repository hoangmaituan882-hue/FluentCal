import { ref } from 'vue';

export const SIDEBAR_MIN = 272;
export const SIDEBAR_DEFAULT = 324;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_COLLAPSE_AT = 175;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Maps raw pointer-dragged width through the video's magnetic detent & elastic collapse/edge
 * resistance fields:
 * - > MAX: rubber-band resistance
 * - [COLLAPSE_AT, MIN): elastic snap-back resistance before collapsing
 * - < COLLAPSE_AT: collapses inward toward 0
 * - [MIN, MAX]: Gaussian magnetic detent well centered on SIDEBAR_DEFAULT
 */
export function applyDragField(rawW: number): { target: number; willCollapse: boolean; nearDetent: boolean } {
  if (rawW > SIDEBAR_MAX) {
    return { target: SIDEBAR_MAX + (rawW - SIDEBAR_MAX) * 0.22, willCollapse: false, nearDetent: false };
  }
  if (rawW < SIDEBAR_COLLAPSE_AT) {
    return { target: Math.max(0, rawW * 0.35), willCollapse: true, nearDetent: false };
  }
  if (rawW < SIDEBAR_MIN) {
    return { target: SIDEBAR_MIN - (SIDEBAR_MIN - rawW) * 0.42, willCollapse: false, nearDetent: false };
  }
  const d = rawW - SIDEBAR_DEFAULT;
  const pull = -d * 0.34 * Math.exp(-(d * d) / (2 * 20 * 20));
  return {
    target: rawW + pull,
    willCollapse: false,
    nearDetent: Math.abs(d) < 18,
  };
}

/** Determines final open state and committed width on pointer release using position + flick velocity. */
export function resolveReleaseTarget(rawW: number, velX: number): { open: boolean; width: number } {
  if (rawW < SIDEBAR_COLLAPSE_AT || (rawW < SIDEBAR_MIN && velX < -420)) {
    return { open: false, width: 0 };
  }
  if (Math.abs(rawW - SIDEBAR_DEFAULT) < 22 && Math.abs(velX) < 350) {
    return { open: true, width: SIDEBAR_DEFAULT };
  }
  return { open: true, width: Math.round(clamp(rawW, SIDEBAR_MIN, SIDEBAR_MAX)) };
}

/** Frame-rate independent semi-implicit Euler damped spring step. */
export function stepSpring(
  state: { x: number; v: number },
  target: number,
  dt: number,
  stiffness: number,
  damping: number,
): { x: number; v: number; settled: boolean } {
  const h = Math.min(Math.max(dt, 0.001), 1 / 30);
  const a = (target - state.x) * stiffness - state.v * damping;
  const v = state.v + a * h;
  const x = state.x + v * h;
  const settled = Math.abs(target - x) < 0.25 && Math.abs(v) < 2;
  return { x, v, settled };
}

export interface SidebarSpringOptions {
  isOpen: () => boolean;
  savedWidth: () => number;
  reduceMotion: () => boolean;
  onCommit: (open: boolean, width?: number) => void;
}

export function useSidebarSpring(opts: SidebarSpringOptions) {
  const initialW = opts.isOpen() ? clamp(opts.savedWidth() || SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX) : 0;
  const width = ref(initialW);
  const dragging = ref(false);
  const willCollapse = ref(false);
  const nearDetent = ref(false);

  const spring = { x: initialW, v: 0 };
  let target = initialW;
  let rafId = 0;
  let lastFrameAt = 0;

  let startX = 0;
  let startW = initialW;
  let rawW = initialW;
  let lastMoveX = 0;
  let lastMoveAt = 0;
  let velX = 0;
  let activePointerId: number | null = null;

  function stopLoop() {
    if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
    rafId = 0;
    lastFrameAt = 0;
  }

  function tick(nowMs: number) {
    const dt = lastFrameAt ? (nowMs - lastFrameAt) / 1000 : 1 / 60;
    lastFrameAt = nowMs;

    const stiffness = dragging.value ? 520 : 300;
    const damping = dragging.value ? 38 : 26;
    const next = stepSpring(spring, target, dt, stiffness, damping);
    spring.x = Math.max(0, next.x);
    spring.v = next.v;
    width.value = spring.x;

    if (!dragging.value && next.settled) {
      spring.x = Math.max(0, target);
      spring.v = 0;
      width.value = spring.x;
      stopLoop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function ensureLoop() {
    if (opts.reduceMotion() || typeof requestAnimationFrame === 'undefined') {
      spring.x = Math.max(0, target);
      spring.v = 0;
      width.value = spring.x;
      return;
    }
    if (!rafId) {
      lastFrameAt = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function animateTo(open: boolean, targetW?: number) {
    if (dragging.value) return;
    const dest = open ? clamp(targetW ?? (opts.savedWidth() || SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX) : 0;
    target = dest;
    if (Math.abs(spring.x - dest) < 0.25 && Math.abs(spring.v) < 2) {
      spring.x = dest;
      spring.v = 0;
      width.value = dest;
      stopLoop();
      return;
    }
    ensureLoop();
  }

  function snapTo(open: boolean, targetW?: number) {
    stopLoop();
    const dest = open ? clamp(targetW ?? (opts.savedWidth() || SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX) : 0;
    target = dest;
    spring.x = dest;
    spring.v = 0;
    width.value = dest;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.value || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    const nowMs = performance.now();
    const dt = Math.max(0.001, (nowMs - lastMoveAt) / 1000);
    const instantV = (e.clientX - lastMoveX) / dt;
    const alpha = 1 - Math.exp(-22 * dt);
    velX = velX + (instantV - velX) * alpha;
    lastMoveX = e.clientX;
    lastMoveAt = nowMs;

    rawW = startW + (e.clientX - startX);
    const field = applyDragField(rawW);
    target = field.target;
    willCollapse.value = field.willCollapse;
    nearDetent.value = field.nearDetent;
    ensureLoop();
  }

  function cleanupDragListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    if (typeof document !== 'undefined') document.body.style.cursor = '';
    activePointerId = null;
  }

  function finishDrag(cancelled: boolean) {
    if (!dragging.value) return;
    dragging.value = false;
    willCollapse.value = false;
    nearDetent.value = false;
    cleanupDragListeners();

    if (cancelled) {
      const revert = opts.isOpen() ? clamp(opts.savedWidth() || SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX) : 0;
      target = revert;
      ensureLoop();
      return;
    }

    const res = resolveReleaseTarget(rawW, velX);
    spring.v = clamp(velX * 0.35, -1800, 1800);
    target = res.width;
    ensureLoop();
    opts.onCommit(res.open, res.open ? res.width : undefined);
  }

  function onPointerUp(e: PointerEvent) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    finishDrag(false);
  }

  function onPointerCancel(e: PointerEvent) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    finishDrag(true);
  }

  function onDividerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.value = true;
    startX = e.clientX;
    startW = width.value;
    rawW = startW;
    lastMoveX = e.clientX;
    lastMoveAt = performance.now();
    velX = 0;
    activePointerId = e.pointerId;
    if (typeof document !== 'undefined') document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onDividerDblClick() {
    target = SIDEBAR_DEFAULT;
    ensureLoop();
    opts.onCommit(true, SIDEBAR_DEFAULT);
  }

  function dispose() {
    cleanupDragListeners();
    stopLoop();
  }

  return {
    width,
    dragging,
    willCollapse,
    nearDetent,
    onDividerDown,
    onDividerDblClick,
    animateTo,
    snapTo,
    dispose,
  };
}
