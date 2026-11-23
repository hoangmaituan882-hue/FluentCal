import { describe, expect, it } from 'vitest';
import { classifyViewport, effectiveMultiDaySpan } from './useViewport';

describe('useViewport helpers', () => {
  it('classifies phone, tablet, and desktop width boundaries cleanly', () => {
    expect(classifyViewport(320)).toBe('phone');
    expect(classifyViewport(390)).toBe('phone');
    expect(classifyViewport(639)).toBe('phone');
    expect(classifyViewport(640)).toBe('tablet');
    expect(classifyViewport(768)).toBe('tablet');
    expect(classifyViewport(1023)).toBe('tablet');
    expect(classifyViewport(1024)).toBe('desktop');
    expect(classifyViewport(1440)).toBe('desktop');
  });

  it('adapts MultiDayView span for phone and tablet without mutating saved desktop values', () => {
    expect(effectiveMultiDaySpan(7, 390)).toBe(3);
    expect(effectiveMultiDaySpan(5, 390, 2)).toBe(2);
    expect(effectiveMultiDaySpan(7, 768)).toBe(5);
    expect(effectiveMultiDaySpan(5, 768)).toBe(5);
    expect(effectiveMultiDaySpan(3, 768)).toBe(3);
    expect(effectiveMultiDaySpan(7, 1280)).toBe(7);
    expect(effectiveMultiDaySpan(5, 1280)).toBe(5);
    expect(effectiveMultiDaySpan(3, 1280)).toBe(3);
  });
});
