import { describe, expect, it } from 'vitest';
import {
  applyDragField,
  resolveReleaseTarget,
  SIDEBAR_COLLAPSE_AT,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  stepSpring,
} from './useSidebarSpring';

describe('sidebar magnetic spring physics', () => {
  it('applies Gaussian magnetic detent pull toward SIDEBAR_DEFAULT', () => {
    const rightOfDefault = applyDragField(SIDEBAR_DEFAULT + 10);
    expect(rightOfDefault.nearDetent).toBe(true);
    expect(rightOfDefault.willCollapse).toBe(false);
    expect(rightOfDefault.target).toBeLessThan(SIDEBAR_DEFAULT + 10);
    expect(rightOfDefault.target).toBeGreaterThan(SIDEBAR_DEFAULT);

    const leftOfDefault = applyDragField(SIDEBAR_DEFAULT - 10);
    expect(leftOfDefault.nearDetent).toBe(true);
    expect(leftOfDefault.target).toBeGreaterThan(SIDEBAR_DEFAULT - 10);
    expect(leftOfDefault.target).toBeLessThan(SIDEBAR_DEFAULT);

    const far = applyDragField(SIDEBAR_DEFAULT + 50);
    expect(far.nearDetent).toBe(false);
  });

  it('applies rubber-band damping beyond SIDEBAR_MAX', () => {
    const over = applyDragField(SIDEBAR_MAX + 100);
    expect(over.target).toBeCloseTo(SIDEBAR_MAX + 22, 5);
    expect(over.willCollapse).toBe(false);
  });

  it('applies collapse resistance between COLLAPSE_AT and MIN, and triggers willCollapse below COLLAPSE_AT', () => {
    const resist = applyDragField(SIDEBAR_MIN - 40);
    expect(resist.willCollapse).toBe(false);
    expect(resist.target).toBeGreaterThan(SIDEBAR_MIN - 40);
    expect(resist.target).toBeLessThan(SIDEBAR_MIN);

    const collapse = applyDragField(SIDEBAR_COLLAPSE_AT - 25);
    expect(collapse.willCollapse).toBe(true);
    expect(collapse.target).toBeCloseTo((SIDEBAR_COLLAPSE_AT - 25) * 0.35, 5);
  });

  it('resolves release target using position, detent zone, and flick velocity', () => {
    expect(resolveReleaseTarget(SIDEBAR_COLLAPSE_AT - 10, 0)).toEqual({ open: false, width: 0 });
    expect(resolveReleaseTarget(SIDEBAR_MIN - 20, -500)).toEqual({ open: false, width: 0 });
    expect(resolveReleaseTarget(SIDEBAR_MIN - 20, 0)).toEqual({ open: true, width: SIDEBAR_MIN });
    expect(resolveReleaseTarget(SIDEBAR_DEFAULT + 15, 100)).toEqual({ open: true, width: SIDEBAR_DEFAULT });
    expect(resolveReleaseTarget(SIDEBAR_DEFAULT + 15, 600)).toEqual({ open: true, width: SIDEBAR_DEFAULT + 15 });
    expect(resolveReleaseTarget(SIDEBAR_MAX + 80, 0)).toEqual({ open: true, width: SIDEBAR_MAX });
  });

  it('converges spring cleanly from 0 to 308 and from 308 to 0', () => {
    let s = { x: 0, v: 0 };
    let maxOvershoot = 0;
    for (let i = 0; i < 120; i++) {
      const next = stepSpring(s, SIDEBAR_DEFAULT, 1 / 60, 300, 26);
      s = { x: next.x, v: next.v };
      maxOvershoot = Math.max(maxOvershoot, s.x);
      if (next.settled) break;
    }
    expect(Math.abs(s.x - SIDEBAR_DEFAULT)).toBeLessThan(1);
    expect(maxOvershoot).toBeGreaterThan(SIDEBAR_DEFAULT); // subtle natural underdamped overshoot

    let closing = { x: SIDEBAR_DEFAULT, v: 0 };
    for (let i = 0; i < 120; i++) {
      const next = stepSpring(closing, 0, 1 / 60, 300, 26);
      closing = { x: next.x, v: next.v };
      if (next.settled) break;
    }
    expect(Math.abs(closing.x)).toBeLessThan(1);
  });

  it('supports custom SidebarSpringBounds for workspace sidebar widths', () => {
    const wsBounds = { min: 204, defaultWidth: 236, max: 420, collapseAt: 128 };
    const detent = applyDragField(244, wsBounds);
    expect(detent.nearDetent).toBe(true);
    expect(detent.willCollapse).toBe(false);
    expect(detent.target).toBeLessThan(244);
    expect(detent.target).toBeGreaterThan(236);

    const over = applyDragField(470, wsBounds);
    expect(over.target).toBeCloseTo(420 + 50 * 0.22, 5);

    const resist = applyDragField(160, wsBounds);
    expect(resist.willCollapse).toBe(false);
    expect(resist.target).toBeGreaterThan(160);
    expect(resist.target).toBeLessThan(204);

    const collapsing = applyDragField(110, wsBounds);
    expect(collapsing.willCollapse).toBe(true);
    expect(collapsing.target).toBeCloseTo(110 * 0.35, 5);

    expect(resolveReleaseTarget(120, 0, wsBounds)).toEqual({ open: false, width: 0 });
    expect(resolveReleaseTarget(180, -450, wsBounds)).toEqual({ open: false, width: 0 });
    expect(resolveReleaseTarget(180, 0, wsBounds)).toEqual({ open: true, width: 204 });
    expect(resolveReleaseTarget(245, 50, wsBounds)).toEqual({ open: true, width: 236 });
    expect(resolveReleaseTarget(340, 0, wsBounds)).toEqual({ open: true, width: 340 });
    expect(resolveReleaseTarget(480, 0, wsBounds)).toEqual({ open: true, width: 420 });
  });
});
