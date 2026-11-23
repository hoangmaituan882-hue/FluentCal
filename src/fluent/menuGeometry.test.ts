import { describe, expect, it } from 'vitest';
import { isMovingTowardSubmenu, pointInTriangle } from './menuGeometry';

describe('menuGeometry Safe-Triangle helpers', () => {
  it('detects points inside or outside a triangle', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: -50 };
    const c = { x: 100, y: 50 };
    expect(pointInTriangle({ x: 50, y: 0 }, a, b, c)).toBe(true);
    expect(pointInTriangle({ x: 50, y: 40 }, a, b, c)).toBe(false);
  });

  it('allows diagonal pointer travel toward a right-hand submenu while rejecting vertical scanning', () => {
    const subRect = { left: 200, top: 80, right: 360, bottom: 320 };
    // Moving diagonally down-right across sibling items toward the open right submenu
    expect(isMovingTowardSubmenu({ x: 120, y: 120 }, { x: 155, y: 155 }, subRect, 'right')).toBe(true);
    // Pure vertical move down to inspect sibling rows should switch immediately
    expect(isMovingTowardSubmenu({ x: 120, y: 120 }, { x: 120, y: 148 }, subRect, 'right')).toBe(false);
    // Moving away from the submenu should not hold it open
    expect(isMovingTowardSubmenu({ x: 150, y: 120 }, { x: 130, y: 130 }, subRect, 'right')).toBe(false);
  });

  it('handles submenus flipped to the left edge cleanly', () => {
    const subRect = { left: 40, top: 80, right: 180, bottom: 260 };
    expect(isMovingTowardSubmenu({ x: 240, y: 130 }, { x: 205, y: 165 }, subRect, 'left')).toBe(true);
    expect(isMovingTowardSubmenu({ x: 240, y: 130 }, { x: 260, y: 130 }, subRect, 'left')).toBe(false);
  });
});
