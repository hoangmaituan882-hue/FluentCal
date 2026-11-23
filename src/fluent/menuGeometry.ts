export interface Point2D {
  x: number;
  y: number;
}

export interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function crossSign(p1: Point2D, p2: Point2D, p3: Point2D): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

/** Returns true when point `p` lies inside (or on the boundary of) triangle ABC. */
export function pointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const d1 = crossSign(p, a, b);
  const d2 = crossSign(p, b, c);
  const d3 = crossSign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Safe-Triangle check for cascading context menus: returns `true` when pointer moves
 * monotonically horizontally toward the open submenu panel inside the cone spanned from
 * `prev` to the near edge corners of `subRect` (padded vertically by `padY`).
 */
export function isMovingTowardSubmenu(
  prev: Point2D | null,
  curr: Point2D,
  subRect: RectBox | null,
  side: 'left' | 'right',
  padY = 14,
): boolean {
  if (!prev || !subRect) return false;
  const dx = curr.x - prev.x;
  if (side === 'right' && dx <= 0) return false;
  if (side === 'left' && dx >= 0) return false;

  const edgeX = side === 'right' ? subRect.left : subRect.right;
  const topCorner: Point2D = { x: edgeX, y: subRect.top - padY };
  const bottomCorner: Point2D = { x: edgeX, y: subRect.bottom + padY };

  return pointInTriangle(curr, prev, topCorner, bottomCorner);
}
