<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FGroupIcon, FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import { currentWindow, isTauri } from '@/api';
import { getGroupIcon } from '@/lib/groupIcons';
import { saveGroup } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { doc, groupList } from '@/stores/doc';
import { goToday, page, viewTitle } from '../desk/state';
import YearMonthPicker from '../desk/YearMonthPicker.vue';
import GroupSquircle from './GroupSquircle.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import { buildGroupCustomizeChildren, buildGroupSelectionMenuItems, openTabContextMenu } from './workspaceMenus';
import type { WorkspacePageKind, WorkspaceTab } from './workspaceModel';

type CalSubView = 'day' | 'multiday' | 'month' | 'weeks';
type AreaSubTab = 'overview' | 'tasks' | 'calendar' | 'resources';

const props = defineProps<{
  sidebarOpen: boolean;
  compactNav?: boolean;
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

const searchExpanded = ref(false);
const searchInputRef = ref<HTMLInputElement>();
const segRef = ref<HTMLElement>();
const calTitleRef = ref<HTMLElement | null>(null);
const ymOpen = ref(false);
const maximized = ref(false);

const { style: segStyle, ready: segReady, visible: segVisible } = useSlidingIndicator(
  segRef,
  '.tb-seg-btn.active',
  [() => props.calView, () => props.activeKind],
);

watch(
  () => [props.activeKind, props.calView] as const,
  ([kind, cv]) => {
    if (kind !== 'calendar' || cv !== 'month') ymOpen.value = false;
  },
);

const showSearchControls = computed(
  () => props.activeKind === 'inbox' || (props.activeKind === 'area' && props.areaSubTab !== 'tasks'),
);

const isSearchOpen = computed(() => searchExpanded.value || props.searchQuery.length > 0);

const calOptions: { value: CalSubView; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'multiday', label: '多日' },
  { value: 'weeks', label: '多周' },
  { value: 'month', label: '月' },
];

const KIND_LABELS: Record<WorkspacePageKind, string> = {
  daily: '今日聚焦',
  calendar: '日历视图',
  inbox: '收集箱',
  tasks: '全部待办',
  countdowns: '倒数日',
  gantt: '项目甘特',
  area: '分组空间',
  settings: '偏好设置',
};

const AREA_SUB_LABELS: Record<AreaSubTab, string> = {
  overview: '概览',
  tasks: '待办列表',
  calendar: '月历排期',
  resources: '笔记资料',
};

const activeAreaGroup = computed(() =>
  props.activeKind === 'area' && props.activeGroupId ? doc.groups[props.activeGroupId] : undefined,
);

const calTitle = computed(() => viewTitle());

const selectedGroupLabel = computed(() => {
  if (!props.filterGroupId) return '全部分组';
  if (props.filterGroupId === '__ungrouped__') return '未分组';
  return doc.groups[props.filterGroupId]?.name ?? '全部分组';
});

function iconForKind(kind: WorkspacePageKind): string {
  if (kind === 'daily') return 'today';
  if (kind === 'calendar') return 'calendar';
  if (kind === 'inbox') return 'flag';
  if (kind === 'tasks') return 'checklist';
  if (kind === 'countdowns') return 'timer';
  if (kind === 'gantt') return 'gantt';
  if (kind === 'area') return 'group';
  return 'settings';
}

async function expandSearch() {
  searchExpanded.value = true;
  await nextTick();
  searchInputRef.value?.focus();
}

function clearSearch() {
  emit('update:searchQuery', '');
  searchExpanded.value = false;
}

function onSearchBlur() {
  if (!props.searchQuery) searchExpanded.value = false;
}

function closeMiddleTab(tab: WorkspaceTab) {
  if (tab.closable !== false && props.tabs.length > 1) {
    emit('closeTab', tab.id);
  }
}

function openNewTabMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '今日聚焦', icon: 'today', action: () => emit('openTab', 'daily') },
    { label: '日历视图', icon: 'calendar', action: () => emit('openTab', 'calendar') },
    { label: '收集箱', icon: 'flag', action: () => emit('openTab', 'inbox') },
    { label: '全部待办', icon: 'checklist', action: () => emit('openTab', 'tasks') },
    { label: '倒数日', icon: 'timer', action: () => emit('openTab', 'countdowns') },
    { label: '项目甘特', icon: 'gantt', action: () => emit('openTab', 'gantt') },
    ...(groupList.value.length
      ? [
          { separator: true as const },
          ...groupList.value.map((g) => {
            const def = getGroupIcon(g.icon);
            return {
              label: g.name,
              svgPaths: def?.paths,
              colorDot: def ? undefined : taskColor(g.color, isDark.value).bar,
              action: () => emit('openTab', 'area', g.id),
            };
          }),
        ]
      : []),
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openAreaBreadcrumbMenu(e: MouseEvent) {
  const gid = props.activeGroupId;
  if (!gid) return openNewTabMenu(e);
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '概览', icon: 'home', radio: true, checked: props.areaSubTab === 'overview', action: () => emit('openAreaSub', gid, 'overview') },
    { label: '待办列表', icon: 'checklist', radio: true, checked: props.areaSubTab === 'tasks', action: () => emit('openAreaSub', gid, 'tasks') },
    { label: '月历排期', icon: 'calendar', radio: true, checked: props.areaSubTab === 'calendar', action: () => emit('openAreaSub', gid, 'calendar') },
    { label: '笔记资料', icon: 'folder', radio: true, checked: props.areaSubTab === 'resources', action: () => emit('openAreaSub', gid, 'resources') },
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openContextActionMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const curTab = props.tabs.find((t) => t.id === props.activeTabId);
  const canClose = !!curTab && curTab.closable !== false && props.tabs.length > 1;
  const g = activeAreaGroup.value;
  if (g) {
    const { iconItems, colorItems } = buildGroupCustomizeChildren(g);
    const items: MenuItem[] = [
      { key: 'new', label: '新建任务到此分组', icon: 'add', shortcut: 'Ctrl+N', action: () => emit('openQuickModal', 'capture') },
      { separator: true },
      { key: 'icon', label: '分组图标…', children: iconItems },
      { key: 'color', label: '分组颜色…', children: colorItems },
      {
        key: 'div',
        label: g.dividerAfter ? '移除侧栏分隔线' : '添加分隔线',
        action: () => void saveGroup({ ...g, dividerAfter: !g.dividerAfter || undefined }),
      },
      ...(canClose
        ? [{ separator: true as const }, { key: 'close', label: '关闭当前标签页', shortcut: 'Ctrl+W', action: () => emit('closeTab', props.activeTabId) }]
        : []),
    ];
    void showMenu(items, anchor, { placement: 'bottom-start' });
    return;
  }

  const items: MenuItem[] = [
    { key: 'new', label: '新建任务…', icon: 'add', shortcut: 'Ctrl+N', action: () => emit('openQuickModal', 'capture') },
    { key: 'search', label: '搜索与跳转…', icon: 'search', shortcut: 'Ctrl+K', action: () => emit('openQuickModal', 'search') },
    { key: 'settings', label: '偏好设置…', icon: 'settings', shortcut: 'Ctrl+,', action: () => emit('openSettings') },
    ...(canClose
      ? [{ separator: true as const }, { key: 'close', label: '关闭当前标签页', shortcut: 'Ctrl+W', action: () => emit('closeTab', props.activeTabId) }]
      : []),
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openGroupFilterMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const isUngrouped = props.filterGroupId === '__ungrouped__';
  const items = buildGroupSelectionMenuItems(
    isUngrouped ? undefined : props.filterGroupId || undefined,
    (gid) => emit('update:filterGroupId', gid ?? ''),
    { allowNone: true, noneLabel: '全部分组', includeUngrouped: true, selectedIsUngrouped: isUngrouped },
  );
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function onTabMenu(tab: WorkspaceTab, e: MouseEvent) {
  void openTabContextMenu(tab, props.tabs, { x: e.clientX, y: e.clientY }, {
    onCloseSelf: () => emit('closeTab', tab.id),
    onCloseOthers: () => emit('closeOtherTabs', tab.id),
    onCloseRight: () => emit('closeRightTabs', tab.id),
    onOpenHome: () => emit('openHome'),
    onNewTask: () => emit('openQuickModal', 'capture'),
  });
}

async function syncMaximized() {
  if (!isTauri) return;
  try {
    maximized.value = await currentWindow.isMaximized();
  } catch {
    /* ignore */
  }
}

async function handleToggleMaximize() {
  if (!isTauri) return;
  await currentWindow.toggleMaximize();
  await syncMaximized();
}

function onBarPointerDown(e: PointerEvent) {
  if (!isTauri || e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, [role="button"], .tb-no-drag')) return;
  void currentWindow.startDragging();
}

function onBarDblClick(e: MouseEvent) {
  if (!isTauri) return;
  if ((e.target as HTMLElement).closest('button, input, .tb-no-drag')) return;
  void handleToggleMaximize();
}

onMounted(() => {
  if (!isTauri) return;
  void syncMaximized();
  window.addEventListener('resize', syncMaximized);
});

onBeforeUnmount(() => {
  if (isTauri) window.removeEventListener('resize', syncMaximized);
});

defineExpose({ focusSearch: expandSearch });
</script>

<template>
  <header class="ws-topbar" @pointerdown="onBarPointerDown" @dblclick="onBarDblClick">
    <div class="tb-left">
      <button
        v-if="compactNav || !sidebarOpen"
        type="button"
        class="tb-nav-ico"
        :title="compactNav ? '打开导航与分组 (Ctrl+B)' : '展开侧边栏 (Ctrl+B)'"
        :aria-label="compactNav ? '打开导航与分组' : '展开侧边栏'"
        @click="emit('toggleSidebar')"
      >
        <FIcon name="sidebar" :size="14" />
      </button>

      <!-- 1:1 Tegon History Back / Forward Arrows -->
      <div class="tb-hist tb-no-drag">
        <button
          type="button"
          class="tb-nav-ico"
          :disabled="!canGoBack"
          title="后退 (Alt+←)"
          aria-label="后退"
          @click="emit('goBack')"
        >
          <FIcon name="back" :size="13" />
        </button>
        <button
          type="button"
          class="tb-nav-ico"
          :disabled="!canGoForward"
          title="前进 (Alt+→)"
          aria-label="前进"
          @click="emit('goForward')"
        >
          <FIcon name="forward" :size="13" />
        </button>
      </div>

      <!-- 1:1 Tegon Breadcrumb Trail -->
      <nav class="tb-crumb tb-no-drag" aria-label="当前位置">
        <template v-if="activeAreaGroup">
          <button
            type="button"
            class="crumb-root"
            @click="emit('openAreaSub', activeAreaGroup.id, 'overview')"
          >
            <GroupSquircle
              :name="activeAreaGroup.name"
              :color-key="activeAreaGroup.color"
              :icon="activeAreaGroup.icon"
              :size="18"
            />
            <span>{{ activeAreaGroup.name }}</span>
          </button>
          <FIcon name="chevronRight" :size="10" class="crumb-sep" />
          <button type="button" class="crumb-cur" @click="openAreaBreadcrumbMenu">
            <span>{{ AREA_SUB_LABELS[areaSubTab] }}</span>
            <FIcon name="chevronDown" :size="9" class="crumb-chev" />
          </button>
          <button type="button" class="crumb-more-btn" title="分组与视图操作" aria-label="更多操作" @click="openContextActionMenu">
            <FIcon name="more" :size="12" />
          </button>
        </template>
        <template v-else>
          <button type="button" class="crumb-root" @click="emit('openHome')">
            <GroupSquircle name="FC" color-key="gray" :size="18" />
            <span>FluentCal</span>
          </button>
          <FIcon name="chevronRight" :size="10" class="crumb-sep" />
          <button type="button" class="crumb-cur" @click="openNewTabMenu">
            <span>{{ KIND_LABELS[activeKind] }}</span>
            <FIcon name="chevronDown" :size="9" class="crumb-chev" />
          </button>
          <button type="button" class="crumb-more-btn" title="当前视图操作" aria-label="更多操作" @click="openContextActionMenu">
            <FIcon name="more" :size="12" />
          </button>
        </template>
      </nav>

      <!-- Compact Open Tabs Strip -->
      <div class="tb-tabs tb-no-drag" role="tablist">
        <TransitionGroup name="tb-tab" tag="div" class="tb-tabs-list">
          <div
            v-for="tab in tabs"
            :key="tab.id"
            class="tb-tab"
            :class="{ active: activeTabId === tab.id }"
            role="tab"
            tabindex="0"
            :aria-selected="activeTabId === tab.id"
            @click="emit('selectTab', tab.id)"
            @contextmenu.prevent="onTabMenu(tab, $event)"
            @keydown.enter.space.prevent="emit('selectTab', tab.id)"
            @auxclick.middle.prevent="closeMiddleTab(tab)"
          >
            <FGroupIcon
              v-if="tab.kind === 'area' && tab.groupId && doc.groups[tab.groupId]"
              class="tb-tab-ico"
              :icon="doc.groups[tab.groupId].icon"
              :color="taskColor(doc.groups[tab.groupId].color, isDark).bar"
              :size="11"
            />
            <FIcon v-else class="tb-tab-ico" :name="iconForKind(tab.kind)" :size="11" />
            <span class="tb-tab-title">{{ tab.title }}</span>
            <button
              v-if="tab.closable !== false && tabs.length > 1"
              type="button"
              class="tb-tab-close"
              title="关闭标签页 (Ctrl+W)"
              aria-label="关闭标签页"
              @click.stop="emit('closeTab', tab.id)"
            >
              <FIcon name="close" :size="9" />
            </button>
          </div>
        </TransitionGroup>

        <button
          type="button"
          class="tb-nav-ico small"
          title="打开新标签页"
          aria-label="打开新标签页"
          @click="openNewTabMenu"
        >
          <FIcon name="add" :size="11" />
        </button>
      </div>
    </div>

    <div class="tb-right tb-no-drag">
      <!-- Contextual calendar toolbar when Calendar view is active -->
      <template v-if="activeKind === 'calendar'">
        <div class="tb-cal-nav">
          <button
            v-if="calView === 'month'"
            ref="calTitleRef"
            type="button"
            class="tb-cal-title clickable"
            title="点击切换年份与月份"
            @click="ymOpen = !ymOpen"
          >
            <span>{{ calTitle }}</span>
            <FIcon name="chevronDown" :size="9" />
          </button>
          <span v-else class="tb-cal-title">{{ calTitle }}</span>
          <YearMonthPicker v-if="calView === 'month'" v-model:open="ymOpen" :anchor="calTitleRef" />
          <button type="button" class="tb-mini-btn" title="上一页" @click="page(-1)">
            <FIcon name="chevronLeft" :size="11" />
          </button>
          <button type="button" class="tb-mini-btn today" @click="goToday()">今天</button>
          <button type="button" class="tb-mini-btn" title="下一页" @click="page(1)">
            <FIcon name="chevronRight" :size="11" />
          </button>
        </div>

        <div ref="segRef" class="tb-seg" role="radiogroup" aria-label="日历子视图">
          <span
            v-if="segVisible"
            class="ws-slide-pill tb-seg-pill"
            :class="{ 'no-anim': !segReady }"
            :style="segStyle"
            aria-hidden="true"
          />
          <button
            v-for="opt in calOptions"
            :key="opt.value"
            type="button"
            class="tb-seg-btn"
            :class="{ active: calView === opt.value }"
            @click="emit('update:calView', opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </template>

      <!-- Folio morphing search pill + area filter pill on inbox/area -->
      <template v-else-if="showSearchControls">
        <div class="tb-search-morph" :class="{ open: isSearchOpen }">
          <button
            v-if="!isSearchOpen"
            type="button"
            class="tb-search-trigger"
            title="搜索当前列表 (Ctrl+F)"
            aria-label="搜索当前列表"
            @click="expandSearch"
          >
            <FIcon name="search" :size="13" />
          </button>
          <div v-else class="tb-search-box">
            <FIcon class="tb-search-ico" name="search" :size="13" />
            <input
              ref="searchInputRef"
              :value="searchQuery"
              type="text"
              class="tb-search-input"
              placeholder="筛选任务…"
              @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
              @keydown.esc.stop="clearSearch"
              @blur="onSearchBlur"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="tb-search-clear"
              title="清除搜索"
              aria-label="清除搜索"
              @mousedown.prevent
              @click="clearSearch"
            >
              <FIcon name="close" :size="9" />
            </button>
          </div>
        </div>

        <button
          v-if="activeKind !== 'area'"
          type="button"
          class="tb-filter-pill"
          :class="{ active: !!filterGroupId }"
          @click="openGroupFilterMenu"
        >
          <span>{{ selectedGroupLabel }}</span>
          <FIcon name="chevronDown" :size="10" />
        </button>
      </template>

      <div v-if="isTauri" class="tb-win-ctls">
        <button type="button" class="tb-win-btn" title="最小化" aria-label="最小化" @click="currentWindow.minimize()">
          <span class="win-glyph min" />
        </button>
        <button
          type="button"
          class="tb-win-btn"
          :title="maximized ? '还原窗口' : '最大化'"
          :aria-label="maximized ? '还原窗口' : '最大化'"
          @click="handleToggleMaximize"
        >
          <span class="win-glyph" :class="maximized ? 'restore' : 'max'" />
        </button>
        <button type="button" class="tb-win-btn close" title="关闭工作台" aria-label="关闭" @click="currentWindow.close()">
          <FIcon name="close" :size="11" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.ws-topbar {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 12px 2px 10px;
}

.tb-left,
.tb-right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tb-left {
  flex: 1;
}

.tb-right {
  flex: none;
}

.tb-hist {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.tb-nav-ico {
  width: 26px;
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

.tb-nav-ico.small {
  width: 24px;
  height: 24px;
}

.tb-nav-ico:hover:not(:disabled) {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.tb-nav-ico:disabled {
  opacity: 0.35;
  cursor: default;
}

/* 1:1 Breadcrumb Trail */
.tb-crumb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  margin-right: 4px;
}

.crumb-root,
.crumb-cur {
  height: 26px;
  padding: 0 7px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.crumb-root:hover,
.crumb-cur:hover {
  background: var(--ws-stone-pill);
}

.crumb-sep {
  color: var(--ws-ink-muted);
}

.crumb-cur {
  font-weight: 600;
}

.crumb-chev {
  color: var(--ws-ink-muted);
  margin-left: 1px;
}

.crumb-more-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.crumb-more-btn:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

/* Compact Open Tabs beside breadcrumb */
.tb-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  padding-left: 8px;
  border-left: 1px solid var(--ws-hairline);
  overflow-x: auto;
  scrollbar-width: none;
}

.tb-tabs::-webkit-scrollbar {
  display: none;
}

.tb-tabs-list {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.tb-tab {
  height: 26px;
  max-width: 148px;
  padding: 0 7px 0 9px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  flex: none;
  outline: none;
  transition: background-color 140ms ease, color 130ms ease, box-shadow 140ms ease;
}

.tb-tab:hover:not(.active) {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.tb-tab.active {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
}

.tb-tab-enter-active {
  transition: opacity 180ms var(--ws-ease-out), transform 180ms var(--ws-ease-out);
}

.tb-tab-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.tb-tab-enter-from,
.tb-tab-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.tb-tab-ico {
  opacity: 0.72;
  flex: none;
}

.tb-tab.active .tb-tab-ico {
  opacity: 0.95;
}

.tb-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-tab-close {
  width: 15px;
  height: 15px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.tb-tab:hover .tb-tab-close,
.tb-tab.active .tb-tab-close {
  opacity: 1;
}

.tb-tab-close:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

/* Calendar contextual bar */
.tb-cal-nav {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 28px;
  padding: 0 5px 0 9px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  box-shadow: var(--ws-shadow-sm);
}

.tb-cal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink);
  margin-right: 4px;
  padding: 0 2px;
  white-space: nowrap;
}

.tb-cal-title.clickable {
  height: 22px;
  padding: 0 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.tb-cal-title.clickable:hover {
  background: var(--ws-pill-bg);
}

.tb-mini-btn {
  height: 22px;
  min-width: 22px;
  padding: 0 5px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
}

.tb-mini-btn:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.tb-mini-btn.today {
  padding: 0 8px;
}

.tb-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--ws-stone-pill);
}

.tb-seg-pill {
  border-radius: 7px;
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.tb-seg-btn {
  position: relative;
  z-index: 1;
  height: 22px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 150ms ease;
}

.tb-seg-btn.active {
  color: var(--ws-ink);
  font-weight: 600;
}

/* Search Morph Pill */
.tb-search-morph {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  box-shadow: var(--ws-shadow-sm);
  overflow: hidden;
  transition: width 240ms var(--ws-ease-out), border-color 140ms ease;
}

.tb-search-morph.open {
  width: 200px;
  border-color: var(--ws-hairline-strong);
}

.tb-search-trigger {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.tb-search-box {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  box-sizing: border-box;
}

.tb-search-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.tb-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font-size: 12px;
  outline: none;
}

.tb-search-clear {
  width: 17px;
  height: 17px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-pill-hover);
  color: var(--ws-ink-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: none;
}

.tb-filter-pill {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  box-shadow: var(--ws-shadow-sm);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.tb-filter-pill:hover,
.tb-filter-pill.active {
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.tb-win-ctls {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding-left: 6px;
  border-left: 1px solid var(--ws-hairline);
  gap: 2px;
}

.tb-win-btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.tb-win-btn:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.tb-win-btn.close:hover {
  background: #C42B1C;
  color: #FFFFFF;
}

.win-glyph.min {
  width: 10px;
  height: 1.5px;
  background: currentColor;
  border-radius: 1px;
}

.win-glyph.max {
  width: 9px;
  height: 9px;
  border: 1.4px solid currentColor;
  border-radius: 2px;
}

.win-glyph.restore {
  position: relative;
  width: 8px;
  height: 8px;
  border: 1.4px solid currentColor;
  border-radius: 1.5px;
  transform: translate(-1px, 1px);
}

.win-glyph.restore::before {
  content: '';
  position: absolute;
  top: -3.5px;
  right: -3.5px;
  width: 7px;
  height: 7px;
  border-top: 1.4px solid currentColor;
  border-right: 1.4px solid currentColor;
  border-top-right-radius: 1.5px;
}

@media (max-width: 1023px) {
  .tb-search-morph.open {
    width: min(200px, 34vw);
  }
}

@media (max-width: 900px) {
  .tb-tabs {
    display: none;
  }
}

@media (max-width: 740px) {
  .tb-hist {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tb-tab-enter-active,
  .tb-tab-leave-active {
    transition-duration: 0.01ms !important;
  }
}
</style>
