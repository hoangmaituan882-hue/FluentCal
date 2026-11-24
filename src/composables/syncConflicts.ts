import { computed, reactive } from 'vue';
import { call, isServer } from '@/api';
import {
  buildConflictResolutionPatch,
  mergeConflictList,
  type ConflictResolutionChoice,
  type SyncConflict,
} from '@/lib/syncConflicts';

const STORAGE_KEY = 'fluentcal.sync.conflicts.v1';

function loadStoredConflicts(): SyncConflict[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncConflict[]) : [];
  } catch {
    return [];
  }
}

function saveStoredConflicts(list: SyncConflict[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* ignore storage quota */
  }
}

export const conflictStore = reactive<{
  items: SyncConflict[];
  resolvingId: string | null;
}>({
  items: typeof localStorage !== 'undefined' ? loadStoredConflicts() : [],
  resolvingId: null,
});

export const conflictCount = computed(() => conflictStore.items.length);

export function setSyncConflicts(list: SyncConflict[]) {
  conflictStore.items = [...list];
  saveStoredConflicts(conflictStore.items);
}

export function recordSyncConflicts(incoming: SyncConflict[]) {
  if (!incoming.length) return;
  conflictStore.items = mergeConflictList(conflictStore.items, incoming);
  saveStoredConflicts(conflictStore.items);
}

export function dismissSyncConflict(conflictId: string) {
  conflictStore.items = conflictStore.items.filter((c) => c.id !== conflictId);
  saveStoredConflicts(conflictStore.items);
}

export function clearAllSyncConflicts() {
  conflictStore.items = [];
  saveStoredConflicts([]);
}

/**
 * Resolves a single sync conflict by applying the chosen version (local / remote / both)
 * directly to the live store, persisting resolution on server if applicable, and triggering sync.
 */
export async function resolveSyncConflict(
  conflict: SyncConflict,
  choice: ConflictResolutionChoice,
): Promise<void> {
  conflictStore.resolvingId = conflict.id;
  try {
    const patch = buildConflictResolutionPatch(conflict, choice);
    await call('store_put', {
      collection: patch.collection,
      items: patch.items,
    });
    dismissSyncConflict(conflict.id);
    if (isServer) {
      await fetch(`/api/conflicts/${encodeURIComponent(conflict.id)}/resolve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice }),
      }).catch(() => {});
    }
    await call('sync_now').catch(() => {});
  } finally {
    conflictStore.resolvingId = null;
  }
}

export async function resolveAllSyncConflicts(choice: 'local' | 'remote'): Promise<void> {
  const snapshot = [...conflictStore.items];
  for (const c of snapshot) {
    await resolveSyncConflict(c, choice);
  }
}
