<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon } from '@/fluent';
import { currentWindow, isTauri } from '@/api';
import type { WorkspacePageKind, WorkspaceTab } from './workspaceModel';

type CalSubView = 'day' | 'multiday' | 'month' | 'weeks';
type AreaSubTab = 'overview' | 'tasks' | 'calendar' | 'resources';

const props = defineProps<{
  sidebarOpen: boolean;
  compactNav?: boolean;
  inboxRailOpen?: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeKind: WorkspacePageKind;
  activeGroupId?: string;
  areaSubTab: AreaSubTab;
  canGoBack: boolean;
  canGoForward: boolean;
  calView: CalSubView;
  searchQuery: string;
  filterGroupId: string;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  toggleInboxRail: [];
  goBack: [];
  goForward: [];
  selectTab: [id: string];
  closeTab: [id: string];
  closeOtherTabs: [keepId: string];
  closeRightTabs: [pivotId: string];
  openTab: [kind: WorkspacePageKind, groupId?: string];
  openAreaSub: [groupId: string, sub: AreaSubTab];
  openHome: [];
  openSettings: [];
  'update:calView': [v: CalSubView];
  'update:searchQuery': [q: string];
  'update:filterGroupId': [id: string];
  openQuickModal: [mode: 'search' | 'capture'];
}>();

const maximized = ref(false);

async function syncMaximized() {
  if (!isTauri) return;
  try {
    maximized.value = await currentWindow.isMaximized();
  } catch {
    /* ignore */
  }
}

function onWinResize() {
  void syncMaximized();
}

async function onWinMinimize() {
  if (!isTauri) return;
  await currentWindow.minimize();
}

async function onWinMaximize() {
  if (!isTauri) return;
  await currentWindow.toggleMaximize();
  await syncMaximized();
}

async function onWinClose() {
  if (!isTauri) return;
  await currentWindow.close();
}

async function onHeaderDblClick(e: MouseEvent) {
  if (!isTauri) return;
  if ((e.target as HTMLElement | null)?.closest('button, input')) return;
  await onWinMaximize();
}

function focusSearch() {
  emit('openQuickModal', 'search');
}

onMounted(() => {
  void syncMaximized();
  if (isTauri) window.addEventListener('resize', onWinResize);
});

onBeforeUnmount(() => {
  if (isTauri) window.removeEventListener('resize', onWinResize);
});

defineExpose({ focusSearch });
</script>

<template>
  <header class="ws-topbar" data-tauri-drag-region @dblclick="onHeaderDblClick">
    <!-- Left Cluster: Sidebar Toggle (when collapsed/tablet), Quick Compose, Back/Forward -->
    <div class="tb-left">
      <button
        v-if="compactNav || !sidebarOpen"
        type="button"
        class="tb-nav-ico"
        :title="compactNav ? '打开导航抽屉' : '展开侧栏 (Ctrl+B)'"
        :aria-label="compactNav ? '打开导航抽屉' : '展开侧边栏'"
        @click="emit('toggleSidebar')"
      >
        <FIcon name="sidebar" :size="16" />
      </button>

      <button
        type="button"
        class="tb-nav-ico"
        title="快速新建事项 (Ctrl+N)"
        aria-label="快速新建事项"
        @click="emit('openQuickModal', 'capture')"
      >
        <FIcon name="compose" :size="15" />
      </button>

      <div class="tb-hist-group">
        <button
          type="button"
          class="tb-nav-ico"
          :disabled="!canGoBack"
          title="后退"
          aria-label="后退"
          @click="emit('goBack')"
        >
          <FIcon name="chevronLeft" :size="14" />
        </button>
        <button
          type="button"
          class="tb-nav-ico"
          :disabled="!canGoForward"
          title="前进"
          aria-label="前进"
          @click="emit('goForward')"
        >
          <FIcon name="chevronRight" :size="14" />
        </button>
      </div>
    </div>

    <!-- Center: Woday Unified Omnibar ('Search, or create anything...  Ctrl K') -->
    <div class="tb-center" data-tauri-drag-region>
      <button
        type="button"
        class="tb-omnibar"
        title="搜索任务、备注、日程，或直接新建 (Ctrl+K)"
        @click="emit('openQuickModal', 'search')"
      >
        <FIcon name="search" :size="14" class="tb-omni-ico" />
        <span class="tb-omni-placeholder">搜索，或新建任意事项…</span>
        <kbd class="tb-omni-kbd">Ctrl K</kbd>
      </button>
    </div>

    <!-- Right Cluster: Inbox Rail Toggle + Settings + Native Window Controls -->
    <div class="tb-right">
      <button
        v-if="activeKind === 'daily' && !compactNav"
        type="button"
        class="tb-rail-btn"
        :class="{ active: inboxRailOpen }"
        :title="inboxRailOpen ? '收起右侧收集箱' : '展开右侧收集箱'"
        :aria-label="inboxRailOpen ? '收起右侧收集箱' : '展开右侧收集箱'"
        @click="emit('toggleInboxRail')"
      >
        <FIcon name="panelRight" :size="15" :active="!!inboxRailOpen" />
        <span>收集箱</span>
      </button>

      <button
        type="button"
        class="tb-nav-ico"
        :class="{ active: activeKind === 'settings' }"
        title="偏好设置"
        aria-label="偏好设置"
        @click="emit('openSettings')"
      >
        <FIcon name="settings" :size="15" :active="activeKind === 'settings'" />
      </button>

      <div v-if="isTauri" class="tb-win-ctrls">
        <button type="button" class="tb-win-btn" title="最小化" aria-label="最小化" @click="onWinMinimize">
          <svg viewBox="0 0 12 12" width="11" height="11"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
        </button>
        <button type="button" class="tb-win-btn" :title="maximized ? '向下还原' : '最大化'" aria-label="最大化" @click="onWinMaximize">
          <svg v-if="!maximized" viewBox="0 0 12 12" width="11" height="11"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
          <svg v-else viewBox="0 0 12 12" width="11" height="11"><rect x="2" y="3.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.1" /><path d="M3.8 3.5V2.5a1 1 0 0 1 1-1h4.7a1 1 0 0 1 1 1v4.7a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" stroke-width="1.1" /></svg>
        </button>
        <button type="button" class="tb-win-btn close" title="关闭窗口" aria-label="关闭窗口" @click="onWinClose">
          <svg viewBox="0 0 12 12" width="11" height="11"><path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" /></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.ws-topbar {
  flex: none;
  height: 46px;
  padding: 0 12px 0 10px;
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(240px, 440px) minmax(140px, 1fr);
  align-items: center;
  gap: 10px;
  background: transparent;
  user-select: none;
  z-index: 20;
}

.tb-left {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tb-hist-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}

.tb-nav-ico {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, transform 120ms ease;
}

.tb-nav-ico:hover:not(:disabled) {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.tb-nav-ico:active:not(:disabled) {
  transform: scale(0.93);
}

.tb-nav-ico.active {
  background: var(--ws-pill-active);
  color: var(--ws-ink);
}

.tb-nav-ico:disabled {
  opacity: 0.32;
  cursor: default;
}

/* Center Woday Omnibar */
.tb-center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.tb-omnibar {
  width: 100%;
  height: 32px;
  padding: 0 8px 0 12px;
  border-radius: 10px;
  border: 1px solid var(--ws-hairline);
  background: color-mix(in srgb, var(--ws-card-bg) 82%, transparent);
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 12.5px;
  cursor: text;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.025);
  transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, color 150ms ease;
}

.tb-omnibar:hover {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink-secondary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.045);
}

.tb-omni-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.tb-omni-placeholder {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-omni-kbd {
  flex: none;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-muted);
  font-family: var(--font-ui);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.1;
}

/* Right Controls */
.tb-right {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.tb-rail-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}

.tb-rail-btn:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.tb-rail-btn.active {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline);
  color: var(--ws-ink);
  box-shadow: var(--ws-shadow-sm);
}

.tb-win-ctrls {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
  padding-left: 6px;
  border-left: 1px solid var(--ws-hairline);
}

.tb-win-btn {
  width: 28px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.tb-win-btn:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.tb-win-btn.close:hover {
  background: #e1493e;
  color: #ffffff;
}

@media (max-width: 820px) {
  .ws-topbar {
    grid-template-columns: auto minmax(160px, 1fr) auto;
  }

  .tb-omni-kbd {
    display: none;
  }
}
</style>
