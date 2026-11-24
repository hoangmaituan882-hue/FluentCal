import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import type { Occurrence } from '@/lib/recur';
import {
  buildCalicoDayBlocks,
  classifyPinchAxis,
  computePinchedDays,
  computePinchedHourHeight,
  formatCalicoDuration,
  headerTierForDays,
  snapDayCount,
  toCalicoRawEvents,
} from './calicoTimeline';

function makeOcc(id: string, title: string, time: string, duration: number, order = 0): Occurrence {
  const task: Task = {
    id,
    title,
    start: '2026-11-09',
    end: '2026-11-09',
    time,
    duration,
    done: false,
    progress: 0,
    order,
    createdAt: 0,
    updatedAt: 0,
  };
  return { task, date: '2026-11-09', start: '2026-11-09', end: '2026-11-09', done: false };
}

describe('calicoTimeline gesture physics & dynamic clustering', () => {
  it('classifies horizontal vs vertical two-finger pinch cleanly', () => {
    expect(classifyPinchAxis(120, 18, 60, 20)).toBe('horizontal');
    expect(classifyPinchAxis(20, 140, 22, 70)).toBe('vertical');
    expect(classifyPinchAxis(100, 100, 102, 102)).toBeNull();
  });

  it('pinches day count continuously inward (more days) and snaps to Calico stops', () => {
    const moreDays = computePinchedDays(1, 200, 100);
    expect(moreDays).toBeCloseTo(2, 1);
    const sevenDays = computePinchedDays(2, 220, 62);
    expect(snapDayCount(sevenDays)).toBe(7);
    expect(snapDayCount(1.2)).toBe(1);
    expect(snapDayCount(2.8)).toBe(3);
    expect(snapDayCount(5.4)).toBe(5);
    expect(snapDayCount(6.2)).toBe(7);
  });

  it('pinches hourHeight vertically with rubber-band boundaries', () => {
    expect(computePinchedHourHeight(64, 180, 90)).toBeCloseTo(32, 0);
    expect(computePinchedHourHeight(64, 180, 10)).toBeGreaterThanOrEqual(20);
    expect(computePinchedHourHeight(64, 80, 400)).toBeLessThanOrEqual(100);
  });

  it('keeps back-to-back events separate when spacious, clusters them on vertical pinch, and switches to capsule on 4-7d', () => {
    const raw = toCalicoRawEvents(
      [
        makeOcc('a', 'Weekly Planning', '10:00', 45, 0),
        makeOcc('b', 'Lunch with maru', '12:00', 60, 1),
        makeOcc('c', 'Review user feedback', '13:00', 120, 2),
      ],
      () => '#22c55e',
    );

    // Spacious 1-day view -> 3 individual cards
    const spacious = buildCalicoDayBlocks(raw, 64, 1);
    expect(spacious.length).toBe(3);
    expect(spacious.every((b) => b.kind === 'single')).toBe(true);

    // Vertical pinch compact (hourHeight = 28, 1 day) -> Lunch + Review merge into 1 horizontal cluster card ("2 项日程", 12:00-15:00)
    const compact1d = buildCalicoDayBlocks(raw, 28, 1);
    expect(compact1d.length).toBe(2);
    const cluster1d = compact1d.find((b) => b.kind === 'cluster');
    expect(cluster1d).toBeDefined();
    expect(cluster1d?.clusterStyle).toBe('card');
    expect(cluster1d?.events.length).toBe(2);
    expect(cluster1d?.startMin).toBe(12 * 60);
    expect(cluster1d?.endMin).toBe(15 * 60);

    // Horizontal pinch to 7 days -> cluster switches to Calico slim numbered capsule
    const dense7d = buildCalicoDayBlocks(raw, 28, 7);
    const cluster7d = dense7d.find((b) => b.kind === 'cluster');
    expect(cluster7d?.clusterStyle).toBe('capsule');
    expect(headerTierForDays(1)).toBe('full');
    expect(headerTierForDays(2.5)).toBe('compact');
    expect(headerTierForDays(6.5)).toBe('squircle');
    expect(formatCalicoDuration(150)).toBe('2h 30m');
  });
});
