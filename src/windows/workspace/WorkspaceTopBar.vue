<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { FIcon, showMenu, type MenuItem } from '@/fluent';
import { currentWindow, isTauri } from '@/api';
import { doc, groupList } from '@/stores/doc';
import { goToday, page, viewTitle } from '../desk/state';
import type { WorkspacePageKind, WorkspaceTab } from './workspaceModel';

type CalSubView = 'day' | 'multiday' | 'month' | 'weeks';

const props = defineProps<{
  sidebarOpen: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeKind: WorkspacePageKind;
  calView: CalSubView;
  searchQuery: string;
  filterGroupId: string;
}>();

const emit = defineEmits<{
  toggleSidebar: [];
  selectTab: [id: string];
  closeTab: [id: string];
  openTab: [kind: WorkspacePageKind, groupId?: string];
  openHome: [];
  openSettings: [];
  'update:calView': [v: CalSubView];
  'update:searchQuery': [q: string];
  'update:filterGroupId': [id: string];
  openQuickModal: [mode: 'search' | 'capture'];
}>();

const searchExpanded = ref(false);
const searchInputRef = ref<HTMLInputElement>();

const showSearchControls = computed(
  () => props.activeKind === 'tasks' || props.activeKind === 'inbox' || props.activeKind === 'area',
);

const isSearchOpen = computed(() => searchExpanded.value || props.searchQuery.length > 0);

const calOptions: { value: CalSubView; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'multiday', label: '多日' },
  { value: 'weeks', label: '多周' },
  { value: 'month', label: '月' },
];

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

function openNewTabMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    { label: '今日聚焦', icon: 'today', action: () => emit('openTab', 'daily') },
    { label: '日历视图', icon: 'calendar', action: () => emit('openTab', 'calendar') },
    { label: '收集箱', icon: 'flag', action: () => emit('openTab', 'inbox') },
    { label: '待办清单', icon: 'checklist', action: () => emit('openTab', 'tasks') },
    { label: '项目甘特', icon: 'gantt', action: () => emit('openTab', 'gantt') },
    ...(groupList.value.length
      ? [
          { separator: true as const },
          ...groupList.value.map((g) => ({
            label: g.name,
            icon: 'group',
            action: () => emit('openTab', 'area', g.id),
          })),
        ]
      : []),
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function openGroupFilterMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = [
    {
      label: '全部分组',
      radio: true,
      checked: props.filterGroupId === '',
      action: () => emit('update:filterGroupId', ''),
    },
    ...groupList.value.map((g) => ({
      label: g.name,
      radio: true,
      checked: props.filterGroupId === g.id,
      action: () => emit('update:filterGroupId', g.id),
    })),
    { separator: true },
    {
      label: '仅未分组',
      radio: true,
      checked: props.filterGroupId === '__ungrouped__',
      action: () => emit('update:filterGroupId', '__ungrouped__'),
    },
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function onBarPointerDown(e: PointerEvent) {
  if (!isTauri || e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, [role="button"], .tb-no-drag')) return;
  void currentWindow.startDragging();
}

function onBarDblClick(e: MouseEvent) {
  if (!isTauri) return;
  if ((e.target as HTMLElement).closest('button, input, .tb-no-drag')) return;
  void currentWindow.toggleMaximize();
}
</script>

<template>
  <header class="ws-topbar" @pointerdown="onBarPointerDown" @dblclick="onBarDblClick">
    <div class="tb-left">
      <button
        v-if="!sidebarOpen"
        type="button"
        class="ws-icon-circle solid"
        title="展开侧边栏 (Ctrl+B)"
        aria-label="展开侧边栏"
        @click="emit('toggleSidebar')"
      >
        <FIcon name="sidebar" :size="14" />
      </button>

      <button
        type="button"
        class="ws-icon-circle solid"
        title="回到今日聚焦"
        aria-label="回到今日聚焦"
        @click="emit('openHome')"
      >
        <FIcon name="home" :size="13" />
      </button>

      <button
        type="button"
        class="tb-pill compact"
        :class="{ active: activeTabId === 'tab:settings' }"
        title="工作台与全局设置"
        @click="emit('openSettings')"
      >
        <FIcon name="settings" :size="13" />
        <span>设置</span>
      </button>

      <div class="tb-tabs tb-no-drag" role="tablist">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tb-tab"
          :class="{ active: activeTabId === tab.id }"
          role="tab"
          :aria-selected="activeTabId === tab.id"
          @click="emit('selectTab', tab.id)"
        >
          <FIcon class="tb-tab-ico" :name="iconForKind(tab.kind)" :size="12" />
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

        <button
          type="button"
          class="ws-icon-circle tb-add-tab"
          title="打开新标签页"
          aria-label="打开新标签页"
          @click="openNewTabMenu"
        >
          <FIcon name="add" :size="12" />
        </button>
      </div>
    </div>

    <div class="tb-right tb-no-drag">
      <!-- Contextual calendar toolbar when Calendar view is active -->
      <template v-if="activeKind === 'calendar'">
        <div class="tb-cal-nav">
          <span class="tb-cal-title">{{ calTitle }}</span>
          <button type="button" class="tb-mini-btn" title="上一页" @click="page(-1)">
            <FIcon name="chevronLeft" :size="11" />
          </button>
          <button type="button" class="tb-mini-btn today" @click="goToday()">今天</button>
          <button type="button" class="tb-mini-btn" title="下一页" @click="page(1)">
            <FIcon name="chevronRight" :size="11" />
          </button>
        </div>

        <div class="tb-seg" role="radiogroup" aria-label="日历子视图">
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

      <!-- Folio morphing search pill + area filter pill on list/inbox/area -->
      <template v-else-if="showSearchControls">
        <div class="tb-search-morph" :class="{ open: isSearchOpen }">
          <button
            v-if="!isSearchOpen"
            type="button"
            class="tb-search-trigger"
            title="搜索当前列表"
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

      <button
        type="button"
        class="ws-icon-circle solid"
        title="搜索或全局跳转 (Ctrl+K)"
        aria-label="搜索或全局跳转"
        @click="emit('openQuickModal', 'search')"
      >
        <FIcon name="keyboard" :size="13" />
      </button>

      <button
        type="button"
        class="ws-icon-circle solid"
        title="快速新建 (Ctrl+N)"
        aria-label="快速新建"
        @click="emit('openQuickModal', 'capture')"
      >
        <FIcon name="add" :size="13" />
      </button>

      <div v-if="isTauri" class="tb-win-ctls">
        <button type="button" class="tb-win-btn" title="最小化" aria-label="最小化" @click="currentWindow.minimize()">
          <span class="win-glyph min" />
        </button>
        <button type="button" class="tb-win-btn" title="最大化 / 还原" aria-label="最大化" @click="currentWindow.toggleMaximize()">
          <span class="win-glyph max" />
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
  height: 48px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 14px 4px;
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

.tb-pill.compact {
  height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  flex: none;
  transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}

.tb-pill.compact:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.tb-pill.compact.active {
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
}

.tb-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tb-tabs::-webkit-scrollbar {
  display: none;
}

.tb-tab {
  height: 30px;
  max-width: 170px;
  padding: 0 9px 0 11px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  flex: none;
  transition:
    background-color 160ms var(--ws-ease-out),
    color 140ms ease,
    border-color 140ms ease,
    box-shadow 180ms ease;
}

.tb-tab:hover:not(.active) {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.tb-tab.active {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
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
  width: 17px;
  height: 17px;
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
  background: rgba(28, 25, 23, 0.08);
  color: var(--ws-ink);
}

.tb-add-tab {
  width: 26px;
  height: 26px;
}

/* Calendar contextual bar */
.tb-cal-nav {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 30px;
  padding: 0 5px 0 11px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  box-shadow: var(--ws-shadow-sm);
}

.tb-cal-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ws-ink);
  margin-right: 4px;
  white-space: nowrap;
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
  transition: background-color 120ms ease, color 120ms ease;
}

.tb-mini-btn:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.tb-mini-btn.today {
  padding: 0 8px;
}

.tb-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(28, 25, 23, 0.055);
}

.tb-seg-btn {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, box-shadow 160ms ease;
}

.tb-seg-btn:hover:not(.active) {
  color: var(--ws-ink);
}

.tb-seg-btn.active {
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-weight: 600;
  box-shadow: var(--ws-shadow-sm);
}

/* Folio Search Morph Pill */
.tb-search-morph {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  box-shadow: var(--ws-shadow-sm);
  overflow: hidden;
  transition: width 240ms var(--ws-ease-out), border-color 140ms ease, box-shadow 180ms ease;
}

.tb-search-morph.open {
  width: 210px;
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
  font-size: 12.5px;
  outline: none;
}

.tb-search-clear {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
  background: rgba(28, 25, 23, 0.08);
  color: var(--ws-ink-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: none;
}

.tb-filter-pill {
  height: 30px;
  padding: 0 11px;
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
  transition: border-color 140ms ease, color 140ms ease;
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
  background: var(--ws-pill-bg);
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
</style>
