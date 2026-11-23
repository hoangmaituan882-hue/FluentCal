import { describe, expect, it } from 'vitest';
import { anchorRect, type Anchor } from './placement';

describe('anchorRect', () => {
  it('uses clientX/clientY for PointerEvent-like objects even when width/height exist on prototype', () => {
    const pointerEventLike = {
      clientX: 420,
      clientY: 310,
      x: 420,
      y: 310,
      width: 1,
      height: 1,
    } as unknown as Anchor;

    expect(anchorRect(pointerEventLike)).toEqual({
      left: 420,
      top: 310,
      width: 0,
      height: 0,
    });
  });

  it('reads left/top/width/height from DOMRect-like anchors', () => {
    const domRectLike = {
      left: 50,
      top: 80,
      width: 120,
      height: 32,
    } as DOMRect;

    expect(anchorRect(domRectLike)).toEqual({
      left: 50,
      top: 80,
      width: 120,
      height: 32,
    });
  });

  it('falls back cleanly to plain { x, y } point anchors', () => {
    expect(anchorRect({ x: 260, y: 190 })).toEqual({
      left: 260,
      top: 190,
      width: 0,
      height: 0,
    });
  });
});
