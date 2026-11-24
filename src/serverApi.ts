import { reactive } from 'vue';
import type { Collection, Doc, Settings } from '@/types';
import { DEFAULT_SETTINGS, mergeDefaults } from '@/defaults';
import { canonical, cloudView, mergeCloud, SYNCED, type CloudView } from '@/mobile/sync-model';
import {
  detectSyncConflicts,
  extractBaseStamps,
  type SyncBaseStamps,
  type SyncConflict,
} from '@/lib/syncConflicts';
import { recordSyncConflicts } from '@/composables/syncConflicts';

type Json = Record<string, unknown>;
export interface AccountDeviceInfo {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: number;
  lastSyncAt: number | null;
}
export interface PersonalAccountProfile {
  username: string;
  displayName: string;
  title: string;
  passNumber: string;
  avatarColor: string;
  devices: AccountDeviceInfo[];
  backupCount: number;
  lastSyncAt: number | null;
  lastSyncDevice: string | null;
  conflictCount: number;
}
type SyncStatusPayload = {
  enabled: boolean;
  provider: string;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
  errorKind: 'network' | 'auth' | 'config' | 'remote' | 'server' | 'conflict' | null;
  halted: boolean;
  pending: boolean;
  remoteDevice: string | null;
  remoteSavedAt: number | null;
};

const DOC_KEY = 'fluentcal.server.doc.v1';
const BASE_KEY = 'fluentcal.server.sync-base.v1';
const listeners = new Map<string, Set<(p: unknown) => void>>();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const serverState = reactive({
  checking: true,
  authenticated: false,
  user: '',
  loginError: '',
  loggingIn: false,
  account: null as PersonalAccountProfile | null,
});

function loadBaseStamps(): SyncBaseStamps | null {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    return raw ? (JSON.parse(raw) as SyncBaseStamps) : null;
  } catch {
    return null;
  }
}

function saveBaseStamps(stamps: SyncBaseStamps) {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(stamps));
  } catch {
    /* ignore */
  }
}

let lastBaseStamps: SyncBaseStamps | null =
  typeof localStorage !== 'undefined' ? loadBaseStamps() : null;

export const serverModals = reactive({
  editor: null as null | Record<string, unknown>,
  settings: null as null | { page?: string },
});

const syncStatus: SyncStatusPayload = {
  enabled: true,
  provider: '个人云账号',
  syncing: false,
  lastSync: null,
  error: null,
  errorKind: null,
  halted: false,
  pending: false,
  remoteDevice: null,
  remoteSavedAt: null,
};

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

function updateSyncStatus(patch: Partial<SyncStatusPayload>) {
  Object.assign(syncStatus, patch);
  emit('sync://status', { ...syncStatus });
}

function emptyDoc(): Doc {
  return {
    version: 1,
    tasks: {},
    groups: {},
    dayMarks: {},
    holidays: {},
    settings: structuredClone(DEFAULT_SETTINGS),
    meta: { tasks: {}, groups: {}, dayMarks: {} },
  };
}

function loadLocal(): Doc {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return emptyDoc();
    const parsed = JSON.parse(raw) as Partial<Doc>;
    return {
      version: 1,
      tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {},
      groups: parsed.groups && typeof parsed.groups === 'object' ? parsed.groups : {},
      dayMarks: parsed.dayMarks && typeof parsed.dayMarks === 'object' ? parsed.dayMarks : {},
      holidays: parsed.holidays && typeof parsed.holidays === 'object' ? parsed.holidays : {},
      settings: mergeDefaults(DEFAULT_SETTINGS, parsed.settings),
      meta: {
        tasks: parsed.meta?.tasks ?? {},
        groups: parsed.meta?.groups ?? {},
        dayMarks: parsed.meta?.dayMarks ?? {},
      },
    };
  } catch {
    return emptyDoc();
  }
}

let cachedDoc: Doc | null = null;
function getDoc(): Doc {
  return (cachedDoc ??= loadLocal());
}

function saveLocal(d: Doc) {
  cachedDoc = d;
  localStorage.setItem(DOC_KEY, JSON.stringify(d));
}

function stamp(d: Doc, col: Collection, id: string) {
  const meta = ((d.meta ??= {})[col] ??= {});
  meta[id] = Math.max(Date.now(), (meta[id] ?? 0) + 1);
}

function deepMerge(target: Json, patch: Json) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete target[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k] as Json, v as Json);
    } else {
      target[k] = clone(v);
    }
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad Web';
  if (/iPhone/i.test(ua)) return 'iPhone Web';
  return 'Web Browser';
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | null = null;

function absorbRemoteView(
  remoteView: CloudView,
  remoteSettings?: Partial<Settings>,
  remoteDevice?: string | null,
) {
  const local = clone(getDoc());
  const localCloud = cloudView(local);
  const before = canonical(localCloud);

  // Detect true concurrent conflicts against last synced base before merging
  const localConflicts = detectSyncConflicts(localCloud, remoteView, lastBaseStamps, {
    localDevice: deviceLabel(),
    remoteDevice: remoteDevice || '云端其他设备',
  });
  if (localConflicts.length) {
    recordSyncConflicts(localConflicts);
  }

  const merged = mergeCloud(localCloud, remoteView);
  local.tasks = merged.tasks;
  local.groups = merged.groups;
  local.dayMarks = merged.dayMarks;
  local.meta = merged.meta;
  let settingsChanged = false;
  if (remoteSettings && typeof remoteSettings === 'object' && Object.keys(remoteSettings).length) {
    const mergedSettings = mergeDefaults(local.settings, remoteSettings);
    if (canonical(mergedSettings) !== canonical(local.settings)) {
      local.settings = mergedSettings;
      settingsChanged = true;
    }
  }
  const changed = canonical(cloudView(local)) !== before;
  if (changed || settingsChanged) {
    saveLocal(local);
    if (changed) emit('store://reload', { origin: 'server' });
    else emit('store://settings', { origin: 'server', settings: clone(local.settings) });
  }
  lastBaseStamps = extractBaseStamps(merged);
  saveBaseStamps(lastBaseStamps);
}

export async function fetchAccountProfile(): Promise<PersonalAccountProfile | null> {
  if (!serverState.authenticated) return null;
  try {
    const res = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as PersonalAccountProfile;
    serverState.account = data;
    return data;
  } catch {
    return null;
  }
}

export async function updateAccountProfile(patch: {
  displayName?: string;
  title?: string;
  avatarColor?: string;
  passNumber?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<{ ok: boolean; error?: string; account?: PersonalAccountProfile }> {
  try {
    const res = await fetch('/api/account', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      account?: PersonalAccountProfile;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || '更新账号资料失败' };
    }
    if (data.account) serverState.account = data.account;
    return { ok: true, account: data.account };
  } catch {
    return { ok: false, error: '无法连接服务器，请检查网络' };
  }
}

export async function syncWithServer(pushLocal = true): Promise<SyncStatusPayload> {
  if (!serverState.authenticated) return { ...syncStatus };
  if (inFlight) {
    await inFlight;
    return { ...syncStatus };
  }
  const run = (async () => {
    updateSyncStatus({ syncing: true, error: null, errorKind: null });
    try {
      const local = getDoc();
      const url = pushLocal ? '/api/sync' : '/api/doc';
      const res = await fetch(url, {
        method: pushLocal ? 'POST' : 'GET',
        credentials: 'same-origin',
        headers: pushLocal ? { 'Content-Type': 'application/json' } : undefined,
        body: pushLocal
          ? JSON.stringify({
              view: cloudView(local),
              device: deviceLabel(),
              baseStamps: lastBaseStamps,
            })
          : undefined,
        cache: 'no-store',
      });
      if (res.status === 401) {
        serverState.authenticated = false;
        updateSyncStatus({ syncing: false, error: '登录已过期，请重新登录', errorKind: 'auth' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        view: CloudView;
        savedAt: number | null;
        device: string | null;
        settings?: Partial<Settings>;
        conflicts?: SyncConflict[];
      };
      absorbRemoteView(data.view, data.settings, data.device);
      if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        recordSyncConflicts(data.conflicts);
      }
      updateSyncStatus({
        syncing: false,
        pending: false,
        lastSync: Date.now(),
        error: null,
        errorKind: null,
        remoteDevice: data.device,
        remoteSavedAt: data.savedAt,
      });
    } catch {
      updateSyncStatus({
        syncing: false,
        error: '无法连接服务器，修改已暂存本地',
        errorKind: 'network',
      });
    } finally {
      inFlight = null;
    }
  })();
  inFlight = run;
  await run;
  return { ...syncStatus };
}

function schedulePush() {
  updateSyncStatus({ pending: true });
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncWithServer(true), 500);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && serverState.authenticated) {
      void syncWithServer(syncStatus.pending);
    }
  }, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && serverState.authenticated) {
      void syncWithServer(syncStatus.pending);
    }
  });
  window.addEventListener('online', () => {
    if (serverState.authenticated) void syncWithServer(true);
  });
}

export async function checkSession(): Promise<boolean> {
  serverState.checking = true;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { authenticated: boolean; user?: string };
      serverState.authenticated = !!data.authenticated;
      serverState.user = data.user ?? '';
    } else {
      serverState.authenticated = false;
    }
  } catch {
    // Offline with cached data: allow viewing/editing cached local doc if previously seeded
    serverState.authenticated = Object.keys(getDoc().tasks).length > 0 || Object.keys(getDoc().groups).length > 0;
  } finally {
    serverState.checking = false;
  }
  if (serverState.authenticated) {
    startPolling();
    void fetchAccountProfile();
  }
  return serverState.authenticated;
}

export async function loginServer(user: string, password: string): Promise<boolean> {
  serverState.loggingIn = true;
  serverState.loginError = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password, device: deviceLabel() }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; user?: string; error?: string };
    if (!res.ok || !data.ok) {
      serverState.loginError = data.error || '登录失败';
      return false;
    }
    serverState.authenticated = true;
    serverState.user = data.user || user;
    startPolling();
    await Promise.all([syncWithServer(false), fetchAccountProfile()]);
    return true;
  } catch {
    serverState.loginError = '无法连接服务器，请检查网络';
    return false;
  } finally {
    serverState.loggingIn = false;
  }
}

export async function logoutServer(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  serverState.authenticated = false;
  serverState.user = '';
  serverState.account = null;
}

export async function call<T>(cmd: string, args: Json = {}): Promise<T> {
  let res: unknown;
  switch (cmd) {
    case 'store_get':
      if (serverState.authenticated) {
        await syncWithServer(false);
      }
      res = { doc: clone(getDoc()), recovered: null };
      break;
    case 'store_put': {
      const col = args.collection as Collection;
      const items = clone(args.items as Json);
      const next = clone(getDoc());
      const target = next[col] as Json;
      for (const [id, v] of Object.entries(items)) {
        if (v === null) delete target[id];
        else target[id] = v;
        if (col !== 'holidays') stamp(next, col, id);
      }
      saveLocal(next);
      emit('store://changed', { origin: 'server-local', collection: col, items });
      if (col !== 'holidays') schedulePush();
      break;
    }
    case 'store_patch_settings': {
      const patch = clone(args.patch as Json);
      const next = clone(getDoc());
      deepMerge(next.settings as unknown as Json, patch);
      saveLocal(next);
      emit('store://settings', { origin: 'server-local', settings: clone(next.settings) });
      if (serverState.authenticated) {
        void fetch('/api/settings', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch }),
        }).catch(() => {});
      }
      break;
    }
    case 'store_replace': {
      const incoming = clone(args.doc as Doc);
      const next = clone(getDoc());
      next.meta = clone(next.meta ?? {});
      for (const col of [...SYNCED, 'holidays'] as const) {
        const prevCol = next[col] as Json;
        const nextCol = (incoming[col] ?? {}) as Json;
        for (const id of new Set([...Object.keys(prevCol), ...Object.keys(nextCol)])) {
          if (canonical(prevCol[id]) !== canonical(nextCol[id]) && col !== 'holidays') {
            stamp(next, col, id);
          }
        }
        (next[col] as Json) = nextCol;
      }
      if (incoming.settings) next.settings = mergeDefaults(DEFAULT_SETTINGS, incoming.settings);
      saveLocal(next);
      emit('store://reload', { origin: 'server-local' });
      schedulePush();
      break;
    }
    case 'editor_open':
      serverModals.editor = clone(args.payload as Record<string, unknown>);
      break;
    case 'settings_open':
      serverModals.settings = { page: typeof args.page === 'string' ? args.page : undefined };
      break;
    case 'workspace_open':
      location.search = '?w=workspace';
      break;
    case 'app_info': {
      const t = new URLSearchParams(location.search).get('theme');
      res = {
        build: 26300,
        dark: t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches,
        transparency: false,
        accent: '#0078D4',
        accentPalette: [],
        version: '0.3.24-server',
        dataDir: '云端服务器（本地离线缓存已开启）',
        autostart: false,
        shortcutErrors: [],
        debug: false,
      };
      break;
    }
    case 'data_dir_info':
      res = { path: '云端服务器 + 浏览器离线缓存', custom: false, missing: null };
      break;
    case 'sync_status':
      res = { ...syncStatus };
      break;
    case 'sync_now':
      res = await syncWithServer(true);
      break;
    case 'backups_list':
      res = [];
      break;
    case 'backup_create':
      res = 'server-auto-backup';
      break;
    case 'open_url':
      window.open(String(args.url), '_blank', 'noopener');
      break;
    case 'file_save': {
      const bom = args.bom ? '\uFEFF' : '';
      const body = args.bytes ? new Uint8Array(args.bytes as number[]) : bom + String(args.content);
      const url = URL.createObjectURL(new Blob([body], { type: args.bytes ? 'application/octet-stream' : 'text/plain;charset=utf-8' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: String(args.defaultName) });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      res = String(args.defaultName);
      break;
    }
    case 'file_open':
      res = await new Promise<string | null>((resolve) => {
        const input = Object.assign(document.createElement('input'), {
          type: 'file',
          accept: (args.extensions as string[]).map((e) => `.${e}`).join(','),
        });
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          f.text().then((t) => resolve(t.replace(/^\uFEFF/, '')));
        };
        input.click();
      });
      break;
    default:
      break;
  }
  return res as T;
}

export function on(event: string, cb: (p: unknown) => void): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  if (event === 'system://theme') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => cb(null);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }
  return () => listeners.get(event)?.delete(cb);
}
