<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FButton, FTextBox } from '@/fluent';
import type { ISODate } from '@/types';
import { call, currentWindow, isMobile, isServer } from '@/api';
import { checkSession, loginServer, logoutServer, serverState } from '@/serverApi';
import { startThemeSync, setWindowThemeOverride } from '@/composables/theme';
import { useSidebarSpring } from '@/composables/useSidebarSpring';
import { useViewport } from '@/composables/useViewport';
import { now, startClock } from '@/composables/now';
import { startOfMonth } from '@/lib/date';
import { customCountdownTasks } from '@/lib/countdown';
import { evaluateHabitDay, isHabitTask } from '@/lib/habits';
import { isSubscriptionTask, resolveSubscription } from '@/lib/subscriptions';
import { autoPostpone } from '@/lib/tasks';
import { doc, history, initStore, redo, storeState, taskList, undo, type ReplayResult } from '@/stores/doc';
import { updateHolidays } from '@/stores/holidays';
import {
  clearPendingDraft,
  defaultWeeksStart,
  notify,
  setCountdownsHandler,
  setEditorHandler,
  setGanttHandler,
  setSettingsHandler,
  ui,
  type EditorPayload,
} from '../desk/state';
import {
  classifyTaskBucket,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  cycleTabId,
  openOrFocusTab,
  persistTabs,
  restoreTabs,
  type WorkspacePageKind,
  type WorkspaceTab,
} from './workspaceModel';
import { openStageContextMenu } from './workspaceMenus';
import WorkspaceSidebar from './WorkspaceSidebar.vue';
import WorkspaceTopBar from './WorkspaceTopBar.vue';
import WorkspaceMobileHeader from './WorkspaceMobileHeader.vue';
import WorkspaceMobileDock from './WorkspaceMobileDock.vue';
import WorkspaceMobileDrawer from './WorkspaceMobileDrawer.vue';
import GroupSquircle from './GroupSquircle.vue';
import DailyView from './DailyView.vue';
import CalendarStage from './CalendarStage.vue';
import TasksView from './TasksView.vue';
import InboxView from './InboxView.vue';
import CountdownView from './CountdownView.vue';
import HabitView from './HabitView.vue';
import SubscriptionView from './SubscriptionView.vue';
import AreaView from './AreaView.vue';
import TaskInspector from './TaskInspector.vue';
import QuickModal from './QuickModal.vue';
import TaskHoverCard from './TaskHoverCard.vue';
import { cancelTaskPreview } from './useTaskHoverPreview';
import { endTaskDrag } from './workspaceDrag';
import './transitions.css';
import './workspace.css';

const GanttView = defineAsyncComponent(() => import('../desk/gantt/GanttView.vue'));
const SettingsApp = defineAsyncComponent(() => import('../settings/SettingsApp.vue'));

const SIDEBAR_OPEN_KEY = 'fluentcal.workspace.sidebarOpen';
const SIDEBAR_WIDTH_KEY = 'fluentcal.workspace.sidebarWidth';
const CAL_VIEW_KEY = 'fluentcal.workspace.calView';
const WS_THEME_KEY = 'fluentcal.workspace.theme';
const WS_SIDEBAR_BOUNDS = {
  min: 204,
  defaultWidth: 236,
  max: 420,
  collapseAt: 128,
} as const;

const wsTheme = ref<'light' | 'dark'>(
  (() => {
    try {
      return localStorage.getItem(WS_THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  })(),
);

const { isPhone, isTablet, isCompactNav, isDesktop } = useViewport();
const mobileDrawerOpen = ref(false);
const mobileDockCompact = ref(false);

function applyWorkspaceTheme(theme: 'light' | 'dark') {
  setWindowThemeOverride(theme);
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.dataset.wsTheme = 'dark';
  } else {
    delete document.documentElement.dataset.wsTheme;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = theme === 'dark' ? '#0D0E12' : isPhone.value ? '#FFFFFF' : '#EBEBEB';
  }
}

applyWorkspaceTheme(wsTheme.value);
startThemeSync();

watch([wsTheme, isPhone], ([t]) => {
  applyWorkspaceTheme(t);
  try {
    localStorage.setItem(WS_THEME_KEY, t);
  } catch {
    /* ignore */
  }
});

watch(isDesktop, (desktop) => {
  if (desktop) mobileDrawerOpen.value = false;
});

function toggleWorkspaceTheme() {
  wsTheme.value = wsTheme.value === 'dark' ? 'light' : 'dark';
}

const restored = restoreTabs();
const tabs = ref<WorkspaceTab[]>(restored.tabs);
const activeTabId = ref(restored.activeId);
const sidebarOpen = ref(
  (() => {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  })(),
);
const sidebarWidth = ref(
  (() => {
    try {
      const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(raw) && raw > 0) {
        return Math.max(WS_SIDEBAR_BOUNDS.min, Math.min(WS_SIDEBAR_BOUNDS.max, raw));
      }
    } catch {
      /* ignore */
    }
    return WS_SIDEBAR_BOUNDS.defaultWidth;
  })(),
);
const sidebarSpring = useSidebarSpring({
  isOpen: () => sidebarOpen.value,
  savedWidth: () => sidebarWidth.value,
  reduceMotion: () => doc.settings.theme.reduceMotion,
  bounds: WS_SIDEBAR_BOUNDS,
  onCommit: (open, w) => {
    sidebarOpen.value = open;
    if (open && w) sidebarWidth.value = w;
  },
});
const sidebarInnerStyle = computed(() => {
  const w = sidebarSpring.width.value;
  const minW = WS_SIDEBAR_BOUNDS.min;
  const ratio = Math.max(0, Math.min(1, w / minW));
  return {
    width: `${Math.max(minW, w).toFixed(2)}px`,
    opacity: w < minW ? ratio * ratio : 1,
    transform:
      w < minW
        ? `translateX(${((w - minW) * 0.25).toFixed(1)}px) scale(${(0.96 + 0.04 * ratio).toFixed(3)})`
        : 'none',
  };
});
const calView = ref<'day' | 'multiday' | 'month' | 'weeks'>(
  (() => {
    try {
      const v = localStorage.getItem(CAL_VIEW_KEY);
      if (v === 'day' || v === 'multiday' || v === 'month' || v === 'weeks') return v;
    } catch {
      /* ignore */
    }
    return 'multiday';
  })(),
);

const INBOX_RAIL_KEY = 'fluentcal.workspace.inboxRail.v1';
const inboxRailOpen = ref<boolean>(
  (() => {
    try {
      const v = localStorage.getItem(INBOX_RAIL_KEY);
      if (v === '0') return false;
    } catch {
      /* ignore */
    }
    return true;
  })(),
);
function toggleInboxRail() {
  inboxRailOpen.value = !inboxRailOpen.value;
  try {
    localStorage.setItem(INBOX_RAIL_KEY, inboxRailOpen.value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const searchQuery = ref('');
const filterGroupId = ref('');
const settingsPage = ref<string | undefined>(undefined);
const areaSubTab = ref<'overview' | 'tasks' | 'calendar' | 'resources'>('overview');
const inspectorPayload = ref<EditorPayload | null>(null);
watch(inspectorPayload, (p) => {
  if (!p || p.mode !== 'new') clearPendingDraft();
});
const quickModalOpen = ref(false);
const quickModalMode = ref<'search' | 'capture'>('search');
const quickModalGroupOverride = ref('');
const topBarRef = ref<InstanceType<typeof WorkspaceTopBar>>();
const inspectorRef = ref<InstanceType<typeof TaskInspector>>();

type AreaSubTab = 'overview' | 'tasks' | 'calendar' | 'resources';
interface NavSnap {
  kind: WorkspacePageKind;
  groupId?: string;
  areaSubTab?: AreaSubTab;
}
const navHistory = ref<NavSnap[]>([]);
const navIndex = ref(-1);
const canGoBack = computed(() => navIndex.value > 0);
const canGoForward = computed(() => navIndex.value >= 0 && navIndex.value < navHistory.value.length - 1);

function pushNavSnap(snap: NavSnap) {
  const cur = navHistory.value[navIndex.value];
  if (
    cur &&
    cur.kind === snap.kind &&
    cur.groupId === snap.groupId &&
    (cur.kind !== 'area' || cur.areaSubTab === snap.areaSubTab)
  ) {
    return;
  }
  const sliced = navHistory.value.slice(0, navIndex.value + 1);
  sliced.push(snap);
  navHistory.value = sliced.slice(-40);
  navIndex.value = navHistory.value.length - 1;
}

const loginUser = ref('fluentcal');
const loginPass = ref('');

watch([tabs, activeTabId], () => persistTabs({ tabs: tabs.value, activeId: activeTabId.value }), { deep: true });
watch(sidebarOpen, (v) => {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
});
watch(sidebarWidth, (v) => {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(v)));
  } catch {
    /* ignore */
  }
});
watch([sidebarOpen, sidebarWidth], ([open, w]) => {
  sidebarSpring.animateTo(open, w);
});
watch(calView, (v) => {
  mobileDockCompact.value = false;
  try {
    localStorage.setItem(CAL_VIEW_KEY, v);
  } catch {
    /* ignore */
  }
});

const activeTab = computed<WorkspaceTab | undefined>(() => {
  if (activeTabId.value === 'tab:settings') {
    return { id: 'tab:settings', kind: 'settings', title: '设置' };
  }
  return tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0];
});

const activeKind = computed<WorkspacePageKind>(() => activeTab.value?.kind ?? 'daily');
const activeGroupId = computed(() => activeTab.value?.groupId);

const TITLE_MAP: Record<Exclude<WorkspacePageKind, 'area'>, string> = {
  daily: '今日聚焦',
  calendar: '日历视图',
  inbox: '收集箱',
  tasks: '待办清单',
  habits: '每日习惯',
  countdowns: '倒数日',
  subscriptions: '订阅日历',
  gantt: '项目甘特',
  settings: '设置',
};

function navigateTo(kind: WorkspacePageKind, groupId?: string, subTab?: AreaSubTab, record = true) {
  cancelTaskPreview();
  mobileDockCompact.value = false;
  if (kind === 'settings') {
    activeTabId.value = 'tab:settings';
    if (record) pushNavSnap({ kind: 'settings' });
    return;
  }
  if (kind === 'area' && subTab) {
    areaSubTab.value = subTab;
  }
  const title = kind === 'area' ? (groupId ? (doc.groups[groupId]?.name ?? '分组') : '分组') : TITLE_MAP[kind];
  const res = openOrFocusTab(tabs.value, { kind, title, groupId, closable: true });
  tabs.value = res.tabs;
  activeTabId.value = res.activeId;
  if (record) {
    pushNavSnap({ kind, groupId, areaSubTab: kind === 'area' ? areaSubTab.value : undefined });
  }
}

function openAreaSubTab(groupId: string, sub: AreaSubTab) {
  navigateTo('area', groupId, sub, true);
}

function selectTabFromBar(id: string) {
  cancelTaskPreview();
  activeTabId.value = id;
  if (id === 'tab:settings') {
    pushNavSnap({ kind: 'settings' });
    return;
  }
  const t = tabs.value.find((x) => x.id === id);
  if (t) pushNavSnap({ kind: t.kind, groupId: t.groupId, areaSubTab: t.kind === 'area' ? areaSubTab.value : undefined });
}

function goBack() {
  if (!canGoBack.value) return;
  navIndex.value--;
  const s = navHistory.value[navIndex.value];
  if (s) navigateTo(s.kind, s.groupId, s.areaSubTab, false);
}

function goForward() {
  if (!canGoForward.value) return;
  navIndex.value++;
  const s = navHistory.value[navIndex.value];
  if (s) navigateTo(s.kind, s.groupId, s.areaSubTab, false);
}

pushNavSnap({ kind: activeKind.value, groupId: activeGroupId.value, areaSubTab: areaSubTab.value });

function setSearchQuery(q: string) {
  searchQuery.value = q;
}

function setAreaSubTab(sub: AreaSubTab) {
  areaSubTab.value = sub;
  if (activeKind.value === 'area') {
    pushNavSnap({ kind: 'area', groupId: activeGroupId.value, areaSubTab: sub });
  }
}

function handleCloseTab(id: string) {
  const res = closeTab(tabs.value, activeTabId.value, id);
  tabs.value = res.tabs;
  activeTabId.value = res.activeId;
}

function handleCloseOtherTabs(keepId: string) {
  const res = closeOtherTabs(tabs.value, keepId);
  tabs.value = res.tabs;
  activeTabId.value = res.activeId;
}

function handleCloseRightTabs(pivotId: string) {
  const res = closeTabsToRight(tabs.value, pivotId, activeTabId.value);
  tabs.value = res.tabs;
  activeTabId.value = res.activeId;
}

function onStageContextMenu(e: MouseEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return;
  if (
    el.closest(
      'button, input, textarea, select, a, [contenteditable="true"], [role="button"], .ws-card, .ws-card-frame, .ws-inspector, .task-row, .triage-card, .cd-card, .dp-item, .dp-focus-row, .ao-task-row, .ao-note-card, .res-card, .cell, .chip, .md-event, .day-event, .cal-filter-float, .gantt, .tfb-bar, .tfb-token, .sec-pill, .sec-composer, .ao-task-item, .exp-row, .star-pill, .sb-help-pop, .ws-split-gutter',
    )
  ) {
    return;
  }
  e.preventDefault();
  void openStageContextMenu(
    { x: e.clientX, y: e.clientY },
    {
      wsTheme: wsTheme.value,
      sidebarOpen: sidebarOpen.value,
      onNewTask: () => openQuick('capture', activeGroupId.value || filterGroupId.value),
      onQuickSearch: () => openQuick('search'),
      onToggleTheme: toggleWorkspaceTheme,
      onToggleSidebar: () => (sidebarOpen.value = !sidebarOpen.value),
    },
  );
}

// Keep Area tab titles synced when groups are renamed elsewhere
watch(
  () => doc.groups,
  (groups) => {
    for (const tab of tabs.value) {
      if (tab.kind === 'area' && tab.groupId && groups[tab.groupId]) {
        tab.title = groups[tab.groupId].name;
      }
    }
  },
  { deep: true },
);

const inboxCount = computed(() => {
  const todayIso = now.value;
  let n = 0;
  for (const t of taskList.value) {
    if (t.countdownOnly || t.subscriptionOnly || t.habitOnly) continue;
    const b = classifyTaskBucket(t, todayIso);
    if (b === 'anytime' || b === 'overdue') n++;
  }
  return n;
});

const openCount = computed(() => {
  const todayIso = now.value;
  let n = 0;
  for (const t of taskList.value) {
    if (t.countdownOnly || t.subscriptionOnly || t.habitOnly) continue;
    if (classifyTaskBucket(t, todayIso) !== 'completed') n++;
  }
  return n;
});

const countdownCount = computed(() => customCountdownTasks(taskList.value).length);

const habitPendingCount = computed(() => {
  const todayIso = now.value;
  let n = 0;
  for (const t of taskList.value) {
    if (!isHabitTask(t) || t.habit.archived) continue;
    const st = evaluateHabitDay(t.habit, t.start, todayIso, todayIso);
    if (st.state !== 'done' && st.state !== 'skip') n++;
  }
  return n;
});

const subscriptionDueCount = computed(() => {
  const todayIso = now.value;
  let n = 0;
  for (const t of taskList.value) {
    if (!isSubscriptionTask(t)) continue;
    const r = resolveSubscription(t, todayIso);
    if (!r) continue;
    if (r.meta.status === 'active' || r.meta.status === 'trial') {
      if (r.window.remainDays <= 3) n++;
    }
  }
  return n;
});

function openTaskInInspector(taskId: string, date?: ISODate) {
  inspectorPayload.value = { mode: 'edit', taskId, date };
}

function openQuick(mode: 'search' | 'capture', groupId?: string) {
  quickModalMode.value = mode;
  quickModalGroupOverride.value = groupId ?? '';
  quickModalOpen.value = true;
}

function openQuickSearch() {
  openQuick('search');
}

function openQuickCapture() {
  openQuick('capture', activeGroupId.value || filterGroupId.value);
}

function toggleNavSurface() {
  if (isCompactNav.value) {
    mobileDrawerOpen.value = !mobileDrawerOpen.value;
  } else {
    sidebarOpen.value = !sidebarOpen.value;
  }
}

function openDrawer() {
  mobileDrawerOpen.value = true;
}

function closeDrawer() {
  mobileDrawerOpen.value = false;
}

function closeInspector() {
  inspectorPayload.value = null;
}

function closeQuickModal() {
  quickModalOpen.value = false;
}

function clearToast() {
  ui.toast = null;
}

function updateCalView(v: 'day' | 'multiday' | 'month' | 'weeks') {
  calView.value = v;
}

function updateFilterGroupId(g: string) {
  filterGroupId.value = g;
}

function navigateHome() {
  navigateTo('daily');
}

function openCountdownsPage() {
  navigateTo('countdowns');
}

function handleNewTask(groupId?: string) {
  openQuick('capture', groupId);
}

function openSettingsTab(page?: string) {
  settingsPage.value = page;
  activeTabId.value = 'tab:settings';
}

function openRootSettings() {
  openSettingsTab();
}

async function handleLogout() {
  await logoutServer();
  mobileDrawerOpen.value = false;
  booted = false;
}

function summonDesk() {
  void call('desk_summon');
}

function undoFromToast() {
  void undo().then(() => (ui.toast = null));
}

function replayText(r: ReplayResult, verb: string): string {
  if (!r.done) return `没有可${verb}的操作`;
  return r.skipped ? `已${verb}（${r.skipped} 项已在其他窗口修改）` : `已${verb}`;
}

const ALT_PAGES: WorkspacePageKind[] = ['daily', 'calendar', 'inbox', 'tasks', 'countdowns', 'gantt'];

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  const typing = el?.matches?.('input, textarea, select, [contenteditable="true"]');
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (document.querySelector('[data-f-popup], .f-flyout, [role="menu"], .cd-backdrop, .f-dlg-overlay, .tfb-popover, .sb-help-pop')) return;
    if (mobileDrawerOpen.value) {
      mobileDrawerOpen.value = false;
      return;
    }
    if (quickModalOpen.value) {
      quickModalOpen.value = false;
      return;
    }
    if (inspectorPayload.value) {
      e.preventDefault();
      void inspectorRef.value?.requestClose();
      return;
    }
    if (searchQuery.value) {
      searchQuery.value = '';
      return;
    }
    if (ui.spotlightGroups.length || ui.hoverGroup !== null) {
      ui.spotlightGroups = [];
      ui.hoverGroup = null;
    }
    return;
  }

  if (e.altKey && !ctrl && !e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    goBack();
  } else if (e.altKey && !ctrl && !e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault();
    goForward();
  } else if (e.altKey && !ctrl && !e.shiftKey && e.key >= '1' && e.key <= '6') {
    e.preventDefault();
    navigateTo(ALT_PAGES[Number(e.key) - 1]);
  } else if (e.ctrlKey && e.key === 'Tab' && tabs.value.length > 1) {
    e.preventDefault();
    activeTabId.value = cycleTabId(tabs.value, activeTabId.value, e.shiftKey ? -1 : 1);
  } else if (ctrl && e.key === ',') {
    e.preventDefault();
    openSettingsTab();
  } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (activeKind.value === 'tasks' || (activeKind.value === 'area' && areaSubTab.value === 'tasks')) {
      const tfb = document.querySelector<HTMLInputElement>('.tfb-input');
      if (tfb) {
        tfb.focus();
        tfb.select();
      } else {
        openQuick('search');
      }
    } else if (activeKind.value === 'inbox' || activeKind.value === 'area') {
      void topBarRef.value?.focusSearch();
    } else {
      openQuick('search');
    }
  } else if (ctrl && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openQuick('search');
  } else if (ctrl && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openQuick('capture');
  } else if (ctrl && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleNavSurface();
  } else if (ctrl && e.key.toLowerCase() === 'w') {
    if (activeTabId.value !== 'tab:settings' && tabs.value.length > 1) {
      e.preventDefault();
      handleCloseTab(activeTabId.value);
    }
  } else if (!typing && ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    void undo().then((r) => notify(replayText(r, '撤销')));
  } else if (!typing && ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    void redo().then((r) => notify(replayText(r, '重做')));
  }
}

async function submitLogin() {
  if (!loginPass.value || serverState.loggingIn) return;
  const ok = await loginServer(loginUser.value.trim() || 'fluentcal', loginPass.value);
  if (ok) {
    loginPass.value = '';
    await bootWorkspace();
  }
}

let booted = false;
let stopMobileSync: (() => void) | null = null;
let stopMobileListeners: (() => void) | null = null;

async function bootMobileNative() {
  if (!isMobile) return;
  const [{ Capacitor }, { App }, syncMod, notifMod] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor/app'),
    import('@/mobile/sync'),
    import('@/mobile/notifications'),
  ]);
  stopMobileSync = await syncMod.startSync();
  void notifMod.updateNotifications(doc);

  const stopNotifWatch = watch(
    () => [doc.tasks, doc.settings.reminders],
    () => {
      void notifMod.updateNotifications(doc);
    },
    { deep: true },
  );

  if (Capacitor.isNativePlatform()) {
    const backHandle = await App.addListener('backButton', () => {
      if (quickModalOpen.value) {
        quickModalOpen.value = false;
        return;
      }
      if (inspectorPayload.value) {
        inspectorPayload.value = null;
        return;
      }
      if (mobileDrawerOpen.value) {
        mobileDrawerOpen.value = false;
        return;
      }
      if (canGoBack.value) {
        goBack();
        return;
      }
      if (activeKind.value !== 'daily') {
        navigateTo('daily');
        return;
      }
      void App.minimizeApp();
    });
    const stateHandle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void syncMod.syncNow(false);
        void notifMod.updateNotifications(doc);
      } else {
        void syncMod.syncNow(false);
      }
    });
    stopMobileListeners = () => {
      stopNotifWatch();
      void backHandle.remove();
      void stateHandle.remove();
    };
  } else {
    stopMobileListeners = () => {
      stopNotifWatch();
    };
  }
}

async function bootWorkspace() {
  if (booted) return;
  booted = true;
  await initStore();
  ui.weeksStart = defaultWeeksStart();
  void autoPostpone();
  void updateHolidays();
  if (isMobile) {
    void bootMobileNative();
  }
  startClock((day, prev) => {
    if (ui.cursor === startOfMonth(prev)) ui.cursor = startOfMonth(day);
    if (ui.weeksStart === defaultWeeksStart(prev)) ui.weeksStart = defaultWeeksStart(day);
    if (ui.selected === prev) ui.selected = day;
    void autoPostpone();
  });
}

onMounted(async () => {
  setEditorHandler((payload) => {
    inspectorPayload.value = payload;
  });
  setSettingsHandler((page) => openSettingsTab(page));
  setGanttHandler(() => navigateTo('gantt'));
  setCountdownsHandler(() => navigateTo('countdowns'));
  window.addEventListener('keydown', onKey);
  window.addEventListener('dragend', endTaskDrag);
  window.addEventListener('drop', endTaskDrag);

  // Reveal the native OS window immediately so startup feels responsive.
  try {
    await currentWindow.show();
    await currentWindow.focus();
  } catch {
    /* ignore in browser */
  }

  if (isServer) {
    const authed = await checkSession();
    if (!authed) return;
  }
  await bootWorkspace();
});

onBeforeUnmount(() => {
  sidebarSpring.dispose();
  stopMobileSync?.();
  stopMobileListeners?.();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('dragend', endTaskDrag);
  window.removeEventListener('drop', endTaskDrag);
  setEditorHandler(null);
  setSettingsHandler(null);
  setGanttHandler(null);
  setCountdownsHandler(null);
});
</script>

<template>
  <div class="ws-root" :class="{ resizing: isDesktop && sidebarSpring.dragging.value }">
    <div
      v-if="isDesktop"
      class="ws-sidebar-stage"
      :style="{ width: `${Math.max(0, sidebarSpring.width.value).toFixed(2)}px` }"
    >
      <div v-if="sidebarSpring.width.value > 1" class="ws-sidebar-inner-host" :style="sidebarInnerStyle">
        <WorkspaceSidebar
          :open="sidebarOpen"
          :active-kind="activeKind"
          :active-group-id="activeGroupId"
          :area-sub-tab="areaSubTab"
          :inbox-count="inboxCount"
          :open-count="openCount"
          :countdown-count="countdownCount"
          :habit-pending-count="habitPendingCount"
          :subscription-due-count="subscriptionDueCount"
          :ws-theme="wsTheme"
          @toggle="toggleNavSurface"
          @navigate="navigateTo"
          @open-area-sub="openAreaSubTab"
          @new-task="handleNewTask"
          @quick-search="openQuickSearch"
          @open-task="openTaskInInspector"
          @summon-desk="summonDesk"
          @open-settings="openRootSettings"
          @toggle-theme="toggleWorkspaceTheme"
          @logout="handleLogout"
        />
      </div>
    </div>

    <div
      v-if="isDesktop"
      class="ws-split-gutter"
      :class="{
        collapsed: sidebarSpring.width.value <= 2,
        active: sidebarSpring.dragging.value,
        detent: sidebarSpring.nearDetent.value,
        collapsing: sidebarSpring.willCollapse.value,
      }"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左侧边栏宽度"
      title="拖动自由调整宽度，向左拉动可收起，双击恢复默认"
      @pointerdown.stop="sidebarSpring.onDividerDown"
      @dblclick.stop="sidebarSpring.onDividerDblClick"
    >
      <span class="ws-gutter-pill" aria-hidden="true" />
      <span v-if="sidebarSpring.dragging.value" class="ws-resize-readout" aria-hidden="true">
        {{ sidebarSpring.willCollapse.value ? '松开收起' : `${Math.round(sidebarSpring.width.value)}px` }}
      </span>
    </div>

    <div
      class="ws-main"
      :class="{
        'sb-closed': !isDesktop || sidebarSpring.width.value <= 2,
        'is-phone': isPhone,
        'is-tablet': isTablet,
      }"
    >
      <WorkspaceMobileHeader
        v-if="isPhone"
        :active-kind="activeKind"
        :active-group-id="activeGroupId"
        :area-sub-tab="areaSubTab"
        :cal-view="calView"
        :search-query="searchQuery"
        :filter-group-id="filterGroupId"
        :inbox-count="inboxCount"
        :ws-theme="wsTheme"
        @open-drawer="openDrawer"
        @open-quick-modal="openQuick"
        @open-tab="navigateTo"
        @open-area-sub="openAreaSubTab"
        @open-settings="openRootSettings"
        @toggle-theme="toggleWorkspaceTheme"
        @update:cal-view="updateCalView"
        @update:filter-group-id="updateFilterGroupId"
      />

      <WorkspaceTopBar
        v-else
        ref="topBarRef"
        :sidebar-open="sidebarOpen"
        :compact-nav="isCompactNav"
        :inbox-rail-open="inboxRailOpen"
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :active-kind="activeKind"
        :active-group-id="activeGroupId"
        :area-sub-tab="areaSubTab"
        :can-go-back="canGoBack"
        :can-go-forward="canGoForward"
        :cal-view="calView"
        :search-query="searchQuery"
        :filter-group-id="filterGroupId"
        @toggle-sidebar="toggleNavSurface"
        @toggle-inbox-rail="toggleInboxRail"
        @go-back="goBack"
        @go-forward="goForward"
        @select-tab="selectTabFromBar"
        @close-tab="handleCloseTab"
        @close-other-tabs="handleCloseOtherTabs"
        @close-right-tabs="handleCloseRightTabs"
        @open-tab="navigateTo"
        @open-area-sub="openAreaSubTab"
        @open-home="navigateHome"
        @open-settings="openRootSettings"
        @update:cal-view="updateCalView"
        @update:search-query="setSearchQuery"
        @update:filter-group-id="updateFilterGroupId"
        @open-quick-modal="openQuick"
      />

      <div class="ws-sheet" :class="{ 'dual-cards': !isPhone && activeKind === 'daily' }">
        <main class="ws-stage" @contextmenu="onStageContextMenu">
          <template v-if="storeState.ready">
            <Transition name="ws-stage" mode="out-in">
              <DailyView
                v-if="activeKind === 'daily'"
                key="view:daily"
                :inbox-rail-open="inboxRailOpen"
                @open-task="openTaskInInspector"
                @open-group="(gid) => navigateTo('area', gid)"
                @open-countdowns="openCountdownsPage"
                @open-subscriptions="navigateTo('subscriptions')"
                @open-habits="navigateTo('habits')"
                @toggle-inbox-rail="toggleInboxRail"
                @dock-compact="(v) => (mobileDockCompact = v)"
              />
              <CalendarStage
                v-else-if="activeKind === 'calendar'"
                key="view:calendar"
                :cal-view="calView"
                :dock-compact="mobileDockCompact"
                @update:cal-view="updateCalView"
                @open-task="openTaskInInspector"
                @dock-compact="(v) => (mobileDockCompact = v)"
              />
              <TasksView
                v-else-if="activeKind === 'tasks'"
                key="view:tasks"
                :search-query="searchQuery"
                :filter-group-id="filterGroupId"
                @update:search-query="setSearchQuery"
                @open-task="openTaskInInspector"
              />
              <InboxView
                v-else-if="activeKind === 'inbox'"
                key="view:inbox"
                :search-query="searchQuery"
                :filter-group-id="filterGroupId"
                @open-task="openTaskInInspector"
              />
              <CountdownView
                v-else-if="activeKind === 'countdowns'"
                key="view:countdowns"
              />
              <HabitView
                v-else-if="activeKind === 'habits'"
                key="view:habits"
              />
              <SubscriptionView
                v-else-if="activeKind === 'subscriptions'"
                key="view:subscriptions"
              />
              <AreaView
                v-else-if="activeKind === 'area' && activeGroupId"
                :key="`view:area:${activeGroupId}`"
                :group-id="activeGroupId"
                :search-query="searchQuery"
                :active-sub-tab="areaSubTab"
                @update:sub-tab="setAreaSubTab"
                @update:search-query="setSearchQuery"
                @open-task="openTaskInInspector"
                @close-tab="handleCloseTab(activeTabId)"
              />
              <div v-else-if="activeKind === 'gantt'" key="view:gantt" class="ws-card-frame">
                <GanttView />
              </div>
              <div v-else-if="activeKind === 'settings'" key="view:settings" class="ws-card-frame ws-settings-frame">
                <SettingsApp embedded :initial-page="settingsPage" />
              </div>
            </Transition>
          </template>

          <div v-else class="ws-loading">正在载入工作台数据…</div>

          <!-- Floating Right Inspector Drawer / Mobile Sheet -->
          <Transition name="ws-inspector">
            <TaskInspector
              v-if="inspectorPayload"
              ref="inspectorRef"
              :payload="inspectorPayload"
              @close="closeInspector"
            />
          </Transition>
        </main>
      </div>

      <WorkspaceMobileDock
        v-if="isPhone && storeState.ready"
        :active-kind="activeKind"
        :inbox-count="inboxCount"
        :open-count="openCount"
        :compact="mobileDockCompact"
        @navigate="navigateTo"
        @quick-capture="openQuickCapture"
        @open-drawer="openDrawer"
        @open-task="openTaskInInspector"
        @expand="mobileDockCompact = false"
      />

      <!-- Bottom-left floating Toast with Undo -->
      <Transition name="toast">
        <div v-if="ui.toast" class="ws-toast" role="status">
          <span>{{ ui.toast.text }}</span>
          <FButton
            v-if="ui.toast.undo && history.canUndo"
            size="small"
            variant="accent"
            @click="undoFromToast"
          >
            撤销
          </FButton>
          <FButton size="icon" variant="subtle" icon="close" title="关闭" @click="clearToast" />
        </div>
      </Transition>
    </div>

    <WorkspaceMobileDrawer
      v-if="isCompactNav"
      :open="mobileDrawerOpen"
      :active-kind="activeKind"
      :active-group-id="activeGroupId"
      :area-sub-tab="areaSubTab"
      :inbox-count="inboxCount"
      :open-count="openCount"
      :countdown-count="countdownCount"
      :habit-pending-count="habitPendingCount"
      :subscription-due-count="subscriptionDueCount"
      :ws-theme="wsTheme"
      @close="closeDrawer"
      @navigate="navigateTo"
      @open-area-sub="openAreaSubTab"
      @new-task="handleNewTask"
      @quick-search="openQuickSearch"
      @open-task="openTaskInInspector"
      @open-settings="openRootSettings"
      @toggle-theme="toggleWorkspaceTheme"
      @summon-desk="summonDesk"
      @logout="handleLogout"
    />

    <TaskHoverCard @open-task="openTaskInInspector" />

    <QuickModal
      :open="quickModalOpen"
      :initial-mode="quickModalMode"
      :default-group-id="quickModalGroupOverride || activeGroupId || filterGroupId"
      @close="closeQuickModal"
      @navigate="navigateTo"
      @open-task="openTaskInInspector"
    />

    <!-- Standalone Server Login Gate -->
    <div v-if="isServer && !serverState.authenticated" class="ws-server-gate">
      <form class="ws-gate-card ws-card" @submit.prevent="submitLogin">
        <div class="gate-brand">
          <GroupSquircle name="FC" color-key="gray" :size="36" />
          <div>
            <h2>FluentCal 云端工作台</h2>
            <p class="gate-tagline">多端日程与待办空间</p>
          </div>
        </div>
        <p v-if="serverState.checking" class="gate-sub">正在检查登录状态…</p>
        <template v-else>
          <p class="gate-sub">登录后即可在手机、iPad、浏览器与电脑桌面同步日程和工作台数据。</p>
          <FTextBox v-model="loginUser" placeholder="用户名" />
          <FTextBox v-model="loginPass" type="password" placeholder="密码" @enter="submitLogin" />
          <p v-if="serverState.loginError" class="gate-err" role="alert">{{ serverState.loginError }}</p>
          <FButton variant="accent" :disabled="serverState.loggingIn" @click="submitLogin">
            {{ serverState.loggingIn ? '登录中…' : '登录' }}
          </FButton>
        </template>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ws-root.resizing .ws-main,
.ws-root.resizing .ws-sidebar-stage {
  user-select: none;
}

.ws-sidebar-stage {
  flex: none;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.ws-sidebar-inner-host {
  height: 100%;
  transform-origin: left center;
  will-change: transform, opacity;
}

.ws-split-gutter {
  width: 10px;
  margin-left: -5px;
  margin-right: -5px;
  flex: none;
  position: relative;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}

.ws-split-gutter.collapsed {
  width: 10px;
  margin-left: 0;
  margin-right: -10px;
}

.ws-gutter-pill {
  width: 3px;
  height: 34px;
  border-radius: 999px;
  background: rgba(28, 25, 23, 0.24);
  opacity: 0;
  transition:
    opacity 140ms var(--ws-ease-out),
    height 160ms var(--ws-ease-out),
    background-color 140ms ease;
}

:global(html[data-ws-theme='dark']) .ws-gutter-pill {
  background: rgba(242, 240, 235, 0.26);
}

.ws-split-gutter:hover .ws-gutter-pill,
.ws-split-gutter.collapsed:hover .ws-gutter-pill {
  opacity: 0.75;
}

.ws-split-gutter.active .ws-gutter-pill {
  opacity: 1;
  height: 48px;
}

.ws-split-gutter.detent .ws-gutter-pill,
.ws-split-gutter.collapsing .ws-gutter-pill {
  background: #e85a3c;
}

.ws-resize-readout {
  position: absolute;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
  color: var(--ws-ink);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.ws-loading {
  margin: auto;
  font-size: 13.5px;
  color: var(--ws-ink-secondary);
}

.ws-toast {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 14px;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font-size: 12.5px;
  box-shadow: var(--ws-shadow-md);
}

.toast-enter-active {
  transition:
    opacity var(--toast-open, 350ms) var(--toast-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--toast-open, 350ms) var(--toast-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    filter var(--toast-open, 350ms) var(--toast-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.toast-leave-active {
  transition:
    opacity var(--toast-close, 250ms) var(--toast-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--toast-close, 250ms) var(--toast-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    filter var(--toast-close, 250ms) var(--toast-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(var(--toast-distance, 16px)) scale(var(--toast-scale, 0.97));
  filter: blur(var(--toast-blur, 2px));
}

.ws-main.is-phone .ws-toast {
  left: 50%;
  bottom: calc(78px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  max-width: calc(100vw - 28px);
}

.ws-main.is-phone .toast-enter-from,
.ws-main.is-phone .toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.ws-server-gate {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--ws-gate-bg);
  backdrop-filter: blur(16px);
  display: grid;
  place-items: center;
  padding:
    max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
}

.ws-gate-card {
  width: min(380px, calc(100vw - 32px));
  padding: 26px;
  border-radius: 22px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  box-shadow: var(--ws-shadow-float);
}

.gate-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ws-gate-card h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.gate-tagline {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--ws-ink-muted);
}

.gate-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ws-ink-secondary);
}

.gate-err {
  margin: 0;
  font-size: 12px;
  color: var(--ws-danger);
}
</style>
