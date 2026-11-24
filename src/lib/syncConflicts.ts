import type { DayMark, Group, Task } from '@/types';
import { canonical, clone, SYNCED, type CloudView } from '@/mobile/sync-model';

export type SyncCollection = (typeof SYNCED)[number];
export type SyncConflictItemKind =
  | 'task'
  | 'habit'
  | 'subscription'
  | 'countdown'
  | 'group'
  | 'dayMark';

export type SyncBaseStamps = Record<SyncCollection, Record<string, number>>;

export interface SyncConflict {
  id: string;
  collection: SyncCollection;
  itemId: string;
  itemKind: SyncConflictItemKind;
  title: string;
  detectedAt: number;
  localDevice: string;
  remoteDevice: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  localValue: unknown | null;
  remoteValue: unknown | null;
  changedFields: string[];
  autoWinner: 'local' | 'remote';
}

export type ConflictResolutionChoice = 'local' | 'remote' | 'both';

export function emptyBaseStamps(): SyncBaseStamps {
  return { tasks: {}, groups: {}, dayMarks: {} };
}

export function extractBaseStamps(view: CloudView): SyncBaseStamps {
  const out = emptyBaseStamps();
  for (const col of SYNCED) {
    const src = view.meta?.[col] ?? {};
    for (const [id, ts] of Object.entries(src)) {
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
        out[col][id] = ts;
      }
    }
  }
  return out;
}

export function classifyConflictItemKind(
  col: SyncCollection,
  localVal: unknown | null,
  remoteVal: unknown | null,
): SyncConflictItemKind {
  if (col === 'groups') return 'group';
  if (col === 'dayMarks') return 'dayMark';
  const sample = (localVal ?? remoteVal) as Partial<Task> | null;
  if (sample?.habitOnly || sample?.habit) return 'habit';
  if (sample?.subscriptionOnly || sample?.subscription) return 'subscription';
  if (sample?.countdownOnly) return 'countdown';
  return 'task';
}

export function conflictItemKindLabel(kind: SyncConflictItemKind): string {
  switch (kind) {
    case 'habit':
      return '每日习惯';
    case 'subscription':
      return '订阅服务';
    case 'countdown':
      return '倒数日';
    case 'group':
      return '分组';
    case 'dayMark':
      return '日期标记';
    default:
      return '任务日程';
  }
}

export function describeConflictTitle(
  col: SyncCollection,
  itemId: string,
  localVal: unknown | null,
  remoteVal: unknown | null,
): string {
  if (col === 'tasks') {
    const a = localVal as Partial<Task> | null;
    const b = remoteVal as Partial<Task> | null;
    return a?.title?.trim() || b?.title?.trim() || `未命名事项 (${itemId.slice(0, 6)})`;
  }
  if (col === 'groups') {
    const a = localVal as Partial<Group> | null;
    const b = remoteVal as Partial<Group> | null;
    return a?.name?.trim() || b?.name?.trim() || `分组 (${itemId.slice(0, 6)})`;
  }
  return `日期色彩 · ${itemId}`;
}

const FIELD_LABELS: Record<string, string> = {
  title: '标题',
  name: '名称',
  notes: '备注',
  start: '开始日期',
  end: '截止日期',
  time: '具体时刻',
  done: '完成状态',
  status: '流转状态',
  priority: '优先级',
  progress: '进度',
  groupId: '所属分组',
  color: '主题色',
  starred: '星标置顶',
  checklist: '子任务清单',
  repeat: '重复规则',
  habit: '习惯打卡记录',
  subscription: '订阅账单信息',
  icon: '图标',
};

export function diffChangedFields(
  col: SyncCollection,
  localVal: unknown | null,
  remoteVal: unknown | null,
): string[] {
  if (localVal === null && remoteVal !== null) return ['本机删除 / 云端修改'];
  if (localVal !== null && remoteVal === null) return ['本机修改 / 云端删除'];
  if (!localVal || !remoteVal || typeof localVal !== 'object' || typeof remoteVal !== 'object') {
    return ['内容变更'];
  }
  if (col === 'dayMarks') return ['标记颜色'];

  const a = localVal as Record<string, unknown>;
  const b = remoteVal as Record<string, unknown>;
  const ignore = new Set(['updatedAt', 'createdAt', 'order']);
  const changed: string[] = [];

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ignore.has(key)) continue;
    if (canonical(a[key]) !== canonical(b[key])) {
      changed.push(FIELD_LABELS[key] ?? key);
    }
  }
  return changed.length ? changed.slice(0, 5) : ['属性微调'];
}

/**
 * Formats a concise human-readable summary of one side (local or remote) of a conflicted item.
 */
export function summarizeConflictSide(col: SyncCollection, value: unknown | null): string {
  if (value === null || value === undefined) return '此端已删除该条目';
  if (col === 'dayMarks') {
    const dm = value as Partial<DayMark>;
    return `日期标记色：${dm.color || '默认'}`;
  }
  if (col === 'groups') {
    const g = value as Partial<Group>;
    return `名称「${g.name || '未命名'}」 · 色彩 ${g.color || '默认'}`;
  }
  const t = value as Partial<Task>;
  const parts: string[] = [];
  if (t.title) parts.push(`「${t.title}」`);
  if (t.habit) {
    const logCount = Object.keys(t.habit.logs ?? {}).length;
    parts.push(`已记录 ${logCount} 天`);
    if (t.habit.windowStart) parts.push(`时段 ${t.habit.windowStart}`);
  } else if (t.subscription) {
    parts.push(`${t.subscription.currency} ${t.subscription.price}`);
    if (t.subscription.status) parts.push(`状态 ${t.subscription.status}`);
  } else {
    if (t.start) parts.push(t.time ? `${t.start} ${t.time}` : t.start);
    if (t.done) parts.push('已完成');
    else if (t.status && t.status !== 'todo') parts.push(`状态 ${t.status}`);
    if (t.notes?.trim()) parts.push(`备注：${t.notes.trim().slice(0, 26)}`);
  }
  return parts.join(' · ') || '已修改';
}

/**
 * Detects genuine concurrent modifications between `ours` (local) and `theirs` (remote)
 * relative to `baseStamps` (the last cleanly synced timestamp snapshot).
 *
 * A conflict is recorded when BOTH sides modified or deleted an item since the last sync
 * (or when no base exists and both devices have distinct non-zero timestamps for diverging content).
 */
export function detectSyncConflicts(
  ours: CloudView,
  theirs: CloudView,
  baseStamps: SyncBaseStamps | null | undefined,
  opts: { localDevice?: string; remoteDevice?: string; now?: number } = {},
): SyncConflict[] {
  const localDevice = opts.localDevice || '本机';
  const remoteDevice = opts.remoteDevice || '云端其他设备';
  const detectedAt = opts.now ?? Date.now();
  const conflicts: SyncConflict[] = [];

  for (const col of SYNCED) {
    const localCol = ours[col] as Record<string, unknown>;
    const remoteCol = theirs[col] as Record<string, unknown>;
    const localMeta = ours.meta?.[col] ?? {};
    const remoteMeta = theirs.meta?.[col] ?? {};
    const baseCol = baseStamps?.[col] ?? {};

    const ids = new Set([
      ...Object.keys(localCol),
      ...Object.keys(remoteCol),
      ...Object.keys(localMeta),
      ...Object.keys(remoteMeta),
    ]);

    for (const id of ids) {
      const aTs = localMeta[id] ?? 0;
      const bTs = remoteMeta[id] ?? 0;
      if (aTs === 0 || bTs === 0 || aTs === bTs) continue;

      const baseTs = baseCol[id] ?? 0;
      // Only a true concurrent divergence if BOTH sides moved past the shared base timestamp
      const bothChanged = baseStamps ? aTs > baseTs && bTs > baseTs : true;
      if (!bothChanged) continue;

      const localVal = id in localCol ? localCol[id] : null;
      const remoteVal = id in remoteCol ? remoteCol[id] : null;
      if (canonical(localVal) === canonical(remoteVal)) continue;

      // Skip identical delete-delete
      if (localVal === null && remoteVal === null) continue;

      const itemKind = classifyConflictItemKind(col, localVal, remoteVal);
      conflicts.push({
        id: `${col}:${id}:${aTs}:${bTs}`,
        collection: col,
        itemId: id,
        itemKind,
        title: describeConflictTitle(col, id, localVal, remoteVal),
        detectedAt,
        localDevice,
        remoteDevice,
        localUpdatedAt: aTs,
        remoteUpdatedAt: bTs,
        localValue: localVal !== null ? clone(localVal) : null,
        remoteValue: remoteVal !== null ? clone(remoteVal) : null,
        changedFields: diffChangedFields(col, localVal, remoteVal),
        autoWinner: bTs > aTs ? 'remote' : 'local',
      });
    }
  }

  return conflicts.sort((a, b) => Math.max(b.localUpdatedAt, b.remoteUpdatedAt) - Math.max(a.localUpdatedAt, a.remoteUpdatedAt));
}

/**
 * Merges newly detected conflicts into an existing list, deduplicating by (collection, itemId)
 * so the latest unresolved divergence for each item stays crisp without spam.
 */
export function mergeConflictList(existing: SyncConflict[], incoming: SyncConflict[]): SyncConflict[] {
  const byItem = new Map<string, SyncConflict>();
  for (const c of existing) byItem.set(`${c.collection}:${c.itemId}`, c);
  for (const c of incoming) byItem.set(`${c.collection}:${c.itemId}`, c);
  return [...byItem.values()].sort((a, b) => b.detectedAt - a.detectedAt);
}

/**
 * Builds the concrete mutation payload needed to resolve a conflict with `local`, `remote`, or `both`.
 */
export function buildConflictResolutionPatch(
  conflict: SyncConflict,
  choice: ConflictResolutionChoice,
  now = Date.now(),
): {
  collection: SyncCollection;
  items: Record<string, unknown | null>;
} {
  const { collection, itemId, localValue, remoteValue } = conflict;

  if (choice === 'local') {
    return {
      collection,
      items: { [itemId]: localValue !== null ? clone(localValue) : null },
    };
  }

  if (choice === 'remote') {
    return {
      collection,
      items: { [itemId]: remoteValue !== null ? clone(remoteValue) : null },
    };
  }

  // 'both': keep remote on the original ID (or local if remote deleted) and save the other as a clean copy
  if (collection === 'tasks' && localValue && remoteValue) {
    const copyId = `copy-${itemId.slice(0, 8)}-${now.toString(36)}`;
    const localCopy = clone(localValue) as Task;
    localCopy.id = copyId;
    localCopy.title = `${localCopy.title}（本机副本）`;
    localCopy.updatedAt = now;
    return {
      collection: 'tasks',
      items: {
        [itemId]: clone(remoteValue),
        [copyId]: localCopy,
      },
    };
  }

  if (collection === 'groups' && localValue && remoteValue) {
    const copyId = `grp-${itemId.slice(0, 6)}-${now.toString(36)}`;
    const localCopy = clone(localValue) as Group;
    localCopy.id = copyId;
    localCopy.name = `${localCopy.name}（本机）`;
    return {
      collection: 'groups',
      items: {
        [itemId]: clone(remoteValue),
        [copyId]: localCopy,
      },
    };
  }

  // Fallback if one side was deleted or item is a dayMark: preserve the surviving version
  const survivor = localValue ?? remoteValue;
  return {
    collection,
    items: { [itemId]: survivor !== null ? clone(survivor) : null },
  };
}
