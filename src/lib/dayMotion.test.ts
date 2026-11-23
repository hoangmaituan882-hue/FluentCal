import { describe, expect, it } from 'vitest';
import { expFollow, magneticPullPx, velocityScaleBias } from './dayMotion';

describe('dayMotion helpers', () => {
  it('converges identically across 30/60/120fps with expFollow', () => {
    const sim = (fps: number) => {
      const steps = Math.round(0.5 * fps);
      const dt = 1 / fps;
      let x = 0;
      for (let i = 0; i < steps; i++) x = expFollow(x, 100, 18, dt);
      return x;
    };
    const r30 = sim(30);
    const r60 = sim(60);
    const r120 = sim(120);
    expect(Math.abs(r30 - r60)).toBeLessThan(1e-9);
    expect(Math.abs(r60 - r120)).toBeLessThan(1e-9);
    expect(r60).toBeCloseTo(100 * (1 - Math.exp(-18 * 0.5)), 9);
  });

  it('produces zero pull at exact detents, stays antisymmetric, and bounds overshoot', () => {
    expect(magneticPullPx(340, 340)).toBe(0);
    expect(magneticPullPx(348, 340)).toBeCloseTo(-magneticPullPx(332, 340), 10);
    expect(magneticPullPx(360, 340, 4.5, 11)).toBeLessThan(4.5);
    expect(magneticPullPx(360, 340, 4.5, 11)).toBeGreaterThan(4.2);
    expect(magneticPullPx(320, 340, 4.5, 11)).toBeGreaterThan(-4.5);
    expect(magneticPullPx(100, 340, 4.5, 11)).toBeGreaterThanOrEqual(-4.5);
  });

  it('maps drag velocity cleanly to bounded scale bias', () => {
    expect(velocityScaleBias(0)).toBe(0);
    expect(velocityScaleBias(100)).toBeGreaterThan(0);
    expect(velocityScaleBias(-100)).toEqual(velocityScaleBias(100));
    expect(velocityScaleBias(20_000, 0.007)).toBeLessThan(0.0070001);
  });
});
