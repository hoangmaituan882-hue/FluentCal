import type { Group, ISODate, Task, TaskPriority, TaskStatus } from '@/types';
import {
  effectivePriority,
  effectiveWorkspaceStatus,
  PRIORITY_META,
  STATUS_META,
  taskShortCode,
  type DependencyGraph,
} from '@/lib/taskMeta';

export type FilterField =
  | 'status'
  | 'priority'
  | 'group'
  | 'has_subtasks'
  | 'blocked'
  | 'blocking'
  | 'starred'
  | 'countdown';

export type FilterOperator = 'is' | 'is_not';

export interface FilterToken {
  id: string;
  field: FilterField;
  op: FilterOperator;
  values: string[];
}

export interface FilterFacetDef {
  field: FilterField;
  label: string;
  section: 'primary' | 'relation';
  kind: 'multi' | 'bool';
}

export const FILTER_FACETS: readonly FilterFacetDef[] = [
  { field: 'status', label: '状态', section: 'primary', kind: 'multi' },
  { field: 'group', label: '分组', section: 'primary', kind: 'multi' },
  { field: 'priority', label: '优先级', section: 'primary', kind: 'multi' },
  { field: 'starred', label: '星标置顶', section: 'primary', kind: 'bool' },
  { field: 'has_subtasks', label: '含子步骤', section: 'relation', kind: 'bool' },
  { field: 'countdown', label: '倒数日', section: 'relation', kind: 'bool' },
  { field: 'blocked', label: '被阻塞', section: 'relation', kind: 'bool' },
  { field: 'blocking', label: '阻塞他人', section: 'relation', kind: 'bool' },
];

export const FACET_LABEL: Record<FilterField, string> = Object.fromEntries(
  FILTER_FACETS.map((f) => [f.field, f.label]),
) as Record<FilterField, string>;

function matchesSingleToken(t: Task, token: FilterToken, depGraph: DependencyGraph): boolean {
  if (!token.values.length) return true;
  let hit = false;
  switch (token.field) {
    case 'status':
      hit = token.values.includes(effectiveWorkspaceStatus(t));
      break;
    case 'priority':
      hit = token.values.includes(effectivePriority(t));
      break;
    case 'group': {
      const gKey = t.groupId ? t.groupId : '__ungrouped__';
      hit = token.values.includes(gKey);
      break;
    }
    case 'has_subtasks':
      hit = (t.checklist?.length ?? 0) > 0;
      hit = token.values.includes(hit ? 'yes' : 'no');
      break;
    case 'blocked':
      hit = (depGraph.blockedBy.get(t.id)?.length ?? 0) > 0;
      hit = token.values.includes(hit ? 'yes' : 'no');
      break;
    case 'blocking':
      hit = (depGraph.blocking.get(t.id)?.length ?? 0) > 0;
      hit = token.values.includes(hit ? 'yes' : 'no');
      break;
    case 'starred':
      hit = !!t.starred;
      hit = token.values.includes(hit ? 'yes' : 'no');
      break;
    case 'countdown':
      hit = !!t.countdown;
      hit = token.values.includes(hit ? 'yes' : 'no');
      break;
  }
  return token.op === 'is_not' ? !hit : hit;
}

function matchesSearchText(t: Task, q: string): boolean {
  if (!q) return true;
  if (t.title.toLowerCase().includes(q)) return true;
  if (taskShortCode(t).toLowerCase().includes(q)) return true;
  if (t.notes?.toLowerCase().includes(q)) return true;
  if (t.checklist?.some((c) => c.text.toLowerCase().includes(q))) return true;
  if (t.links?.some((l) => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))) return true;
  return false;
}

export function matchesFilterTokens(
  t: Task,
  tokens: readonly FilterToken[],
  query: string,
  depGraph: DependencyGraph,
  _todayIso?: ISODate,
): boolean {
  if (t.countdownOnly || t.subscriptionOnly) return false;
  const q = query.trim().toLowerCase();
  if (q && !matchesSearchText(t, q)) return false;
  for (const tok of tokens) {
    if (!matchesSingleToken(t, tok, depGraph)) return false;
  }
  return true;
}

export function upsertFilterToken(
  tokens: readonly FilterToken[],
  field: FilterField,
  values: string[],
  op: FilterOperator = 'is',
): FilterToken[] {
  const clean = [...new Set(values)];
  const idx = tokens.findIndex((t) => t.field === field);
  if (!clean.length) {
    return idx >= 0 ? tokens.filter((_, i) => i !== idx) : [...tokens];
  }
  if (idx >= 0) {
    return tokens.map((t, i) => (i === idx ? { ...t, op, values: clean } : t));
  }
  return [...tokens, { id: `ft:${field}`, field, op, values: clean }];
}

export function toggleGroupQuickFilter(tokens: readonly FilterToken[], groupId: string): FilterToken[] {
  const existing = tokens.find((t) => t.field === 'group');
  const prev = existing?.values ?? [];
  const next = prev.includes(groupId) ? prev.filter((x) => x !== groupId) : [...prev, groupId];
  return upsertFilterToken(tokens, 'group', next, existing?.op ?? 'is');
}

export function operatorLabel(op: FilterOperator, count: number): string {
  if (op === 'is_not') return count > 1 ? '排除任意' : '排除';
  return count > 1 ? '属于任意' : '属于';
}

export function formatTokenValueSummary(
  token: FilterToken,
  groups: Record<string, Group>,
): string {
  const vals = token.values;
  if (!vals.length) return '选择…';
  if (vals.length === 1) {
    const v = vals[0];
    if (token.field === 'status') return STATUS_META[v as TaskStatus]?.label ?? v;
    if (token.field === 'priority') return PRIORITY_META[v as TaskPriority]?.label ?? v;
    if (token.field === 'group') return v === '__ungrouped__' ? '未分组' : (groups[v]?.name ?? '未知分组');
    return v === 'yes' ? '是' : '否';
  }
  if (token.field === 'status') return `${vals.length} 个状态`;
  if (token.field === 'priority') return `${vals.length} 个优先级`;
  if (token.field === 'group') return `${vals.length} 个分组`;
  return `${vals.length} 项`;
}
