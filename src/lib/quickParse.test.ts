import { describe, expect, it } from 'vitest';
import { parseQuickTaskInput } from './quickParse';
import type { Group } from '@/types';

const groups: Group[] = [
  { id: 'g1', name: '官网改版', color: 'blue', order: 0 },
  { id: 'g2', name: '生活日常', color: 'green', order: 1 },
];

describe('parseQuickTaskInput', () => {
  it('extracts date, time, group, and priority cleanly', () => {
    const r = parseQuickTaskInput('明天下午3点半 评审UI稿 #官网改版 !高', '2026-11-24', groups);
    expect(r.cleanTitle).toBe('评审UI稿');
    expect(r.date).toBe('2026-11-25');
    expect(r.dateLabel).toBe('明天');
    expect(r.time).toBe('15:30');
    expect(r.groupId).toBe('g1');
    expect(r.priority).toBe('high');
  });

  it('parses 24-hour HH:mm and weekday tokens', () => {
    const r = parseQuickTaskInput('周五 10:15 同步进度 !紧急', '2026-11-24', groups);
    expect(r.cleanTitle).toBe('同步进度');
    expect(r.date).toBe('2026-11-27');
    expect(r.time).toBe('10:15');
    expect(r.priority).toBe('urgent');
  });

  it('keeps plain titles intact when no tokens match', () => {
    const r = parseQuickTaskInput('买咖啡豆', '2026-11-24', groups);
    expect(r.cleanTitle).toBe('买咖啡豆');
    expect(r.date).toBeUndefined();
    expect(r.time).toBeUndefined();
    expect(r.priority).toBeUndefined();
    expect(r.groupId).toBeUndefined();
  });
});
