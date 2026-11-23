/** Analytical CSS linear() spring curves and pure rAF motion helpers for DayView. */

export const SPRING_COL_CSS =
  'linear(0.0000, 0.0817, 0.2565, 0.4521, 0.6293, 0.7716, 0.8756, 0.9455, 0.9881, 1.0111, 1.0208, 1.0226, 1.0202, 1.0161, 1.0116, 1.0078, 1.0047, 1.0025, 1.0000)';

export const SPRING_SNAP_CSS =
  'linear(0.0000, 0.1112, 0.3270, 0.5473, 0.7284, 0.8601, 0.9453, 0.9936, 1.0161, 1.0224, 1.0202, 1.0145, 1.0087, 1.0043, 1.0016, 1.0002, 1.0000)';

export const SPRING_PILL_CSS =
  'linear(0.0000, 0.0979, 0.2953, 0.5065, 0.6904, 0.8313, 0.9277, 0.9862, 1.0165, 1.0273, 1.0265, 1.0202, 1.0128, 1.0067, 1.0026, 1.0004, 1.0000)';

/** Frame-rate-independent exponential follow (`k` tightness in 1/s, `dt` in seconds). */
export function expFollow(current: number, target: number, k: number, dt: number): number {
  if (dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

/** Smooth bounded rubber-band offset between discrete 15-minute detents. */
export function magneticPullPx(rawPx: number, snappedPx: number, maxPull = 4.5, softness = 11): number {
  const delta = rawPx - snappedPx;
  if (delta === 0) return 0;
  return Math.tanh(delta / softness) * maxPull;
}

/** Subtle vertical stretch factor coupled to instantaneous vertical drag velocity (px/s). */
export function velocityScaleBias(velPxPerSec: number, maxBias = 0.007): number {
  const speed = Math.abs(velPxPerSec);
  if (speed === 0) return 0;
  return Math.tanh(speed / 1400) * maxBias;
}
