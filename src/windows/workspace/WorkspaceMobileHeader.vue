<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { isoWeek, parts, weekday, WEEKDAY_SHORT } from '@/lib/date';
import { dayInfo } from '@/lib/lunar';
import { getGroupIcon } from '@/lib/groupIcons';
import { saveGroup } from '@/lib/tasks';
import { doc, groupList } from '@/stores/doc';
import { goToday, page, ui, viewTitle } from '../desk/state';
import YearMonthPicker from '../desk/YearMonthPicker.vue';
import GroupSquircle from './GroupSquircle.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import { buildGroupCustomizeChildren } from './workspaceMenus';
import type { WorkspacePageKind } from './workspaceModel';

type CalSubView = 'day' | 'multiday' | 'month' | 'weeks';
type AreaSubTab = 'overview' | 'tasks' | 'calendar' | 'resources';

const props = defineProps<{
  activeKind: WorkspacePageKind;
  activeGroupId?: string;
  areaSubTab: AreaSubTab;
  calView: CalSubView;
  searchQuery: string;
  filterGroupId: string;
  inboxCount: number;
  wsTheme: 'light' | 'dark';
}>();

const emit = defineEmits<{
  openDrawer: [];
  openQuickModal: [mode: 'search' | 'capture'];
  openTab: [kind: WorkspacePageKind, groupId?: string];
  openAreaSub: [groupId: string, sub: AreaSubTab];
  openSettings: [];
  toggleTheme: [];
  'update:calView': [v: CalSubView];
  'update:filterGroupId': [id: string];
}>();

const calTitleRef = ref<HTMLElement | null>(null);
const ymOpen = ref(false);
const segRef = ref<HTMLElement>();

const { style: segStyle, ready: segReady, visible: segVisible } = useSlidingIndicator(
  segRef,
  '.wmh-seg-btn.active',
  [() => props.calView, () => props.activeKind],
);

watch(
  () => [props.activeKind, props.calView] as const,
  ([kind]) => {
    if (kind !== 'calendar' && kind !== 'daily') ymOpen.value = false;
  },
);

const KIND_LABELS: Record<WorkspacePageKind, string> = {
  daily: '今日聚焦',
  calendar: '日历视图',
  inbox: '收集箱',
  tasks: '待办清单',
  habits: '每日习惯',
  subscriptions: '订阅日历',
  countdowns: '倒数日',
  gantt: '项目甘特',
  area: '分组空间',
  settings: '偏好设置',
};

const AREA_SUB_LABELS: Record<AreaSubTab, string> = {
  overview: '概览',
  tasks: '待办',
  calendar: '月历',
  resources: '资料',
};

const calOptions: { value: CalSubView; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'multiday', label: '多日' },
  { value: 'weeks', label: '多周' },
  { value: 'month', label: '月' },
];

const activeAreaGroup = computed(() =>
  props.activeKind === 'area' && props.activeGroupId ? doc.groups[props.activeGroupId] : undefined,
);

const isCalicoHeroMode = computed(
  () => props.activeKind === 'daily' || props.activeKind === 'calendar',
);

const heroMonthTitle = computed(() => {
  const [y, m] = parts(ui.cursor);
  return `${y}年${m}月`;
});

const weekBadgeText = computed(() => `w${isoWeek(ui.selected)}`);
const lunarSubText = computed(() => `农历${dayInfo(ui.selected).lunarLabel}`);
const nonCalSubText = computed(() => {
  const [, m, d] = parts(now.value);
  return `${m}月${d}日 周${WEEKDAY_SHORT[weekday(now.value)]}`;
});

const calTitle = computed(() => viewTitle());
const showRibbonTitle = computed(() => props.calView === 'weeks');

function groupDotHex(colorKey: string): string {
  return taskColor(colorKey, isDark.value).bar;
}

function onHeroTitleClick(e: MouseEvent) {
  if (props.activeKind === 'daily' || (props.activeKind === 'calendar' && props.calView === 'month')) {
    ymOpen.value = !ymOpen.value;
    return;
  }
  onViewSwitchClick(e);
}

function onViewSwitchClick(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const g = activeAreaGroup.value;
  if (g) {
    const items: MenuItem[] = [
      { label: '概览', icon: 'home', radio: true, checked: props.areaSubTab === 'overview', action: () => emit('openAreaSub', g.id, 'overview') },
      { label: '待办列表', icon: 'checklist', radio: true, checked: props.areaSubTab === 'tasks', action: () => emit('openAreaSub', g.id, 'tasks') },
      { label: '月历排期', icon: 'calendar', radio: true, checked: props.areaSubTab === 'calendar', action: () => emit('openAreaSub', g.id, 'calendar') },
      { label: '笔记资料', icon: 'folder', radio: true, checked: props.areaSubTab === 'resources', action: () => emit('openAreaSub', g.id, 'resources') },
      { separator: true },
      { label: '全部视图…', icon: 'layers', action: () => emit('openDrawer') },
    ];
    void showMenu(items, anchor, { placement: 'bottom-start' });
    return;
  }

  const items: MenuItem[] = [
    { label: '分栏日历（今日）', icon: 'today', radio: true, checked: props.activeKind === 'daily', action: () => emit('openTab', 'daily') },
    { label: '时间轴与多日视图', icon: 'calendar', radio: true, checked: props.activeKind === 'calendar', action: () => emit('openTab', 'calendar') },
    { label: '收集箱', icon: 'flag', radio: true, checked: props.activeKind === 'inbox', action: () => emit('openTab', 'inbox') },
    { label: '全部待办', icon: 'checklist', radio: true, checked: props.activeKind === 'tasks', action: () => emit('openTab', 'tasks') },
    { label: '每日习惯', icon: 'flame', radio: true, checked: props.activeKind === 'habits', action: () => emit('openTab', 'habits') },
    { label: '订阅日历', icon: 'subscription', radio: true, checked: props.activeKind === 'subscriptions', action: () => emit('openTab', 'subscriptions') },
    { label: '倒数日', icon: 'timer', radio: true, checked: props.activeKind === 'countdowns', action: () => emit('openTab', 'countdowns') },
    { label: '项目甘特', icon: 'gantt', radio: true, checked: props.activeKind === 'gantt', action: () => emit('openTab', 'gantt') },
    ...(groupList.value.length
      ? [
          { separator: true as const },
          ...groupList.value.map((grp) => {
            const def = getGroupIcon(grp.icon);
            return {
              label: grp.name,
              svgPaths: def?.paths,
              colorDot: def ? undefined : taskColor(grp.color, isDark.value).bar,
              action: () => emit('openTab', 'area', grp.id),
            };
          }),
        ]
      : []),
  ];
  void showMenu(items, anchor, { placement: 'bottom-start' });
}

function onMoreClick(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const g = activeAreaGroup.value;
  const groupItems: MenuItem[] = g
    ? (() => {
        const { iconItems, colorItems } = buildGroupCustomizeChildren(g);
        return [
          { separator: true },
          { label: '分组图标…', children: iconItems },
          { label: '分组颜色…', children: colorItems },
          {
            label: g.dividerAfter ? '移除侧栏分隔线' : '添加侧栏分隔线',
            action: () => void saveGroup({ ...g, dividerAfter: !g.dividerAfter || undefined }),
          },
        ];
      })()
    : [];

  const items: MenuItem[] = [
    { label: '新建任务…', icon: 'add', action: () => emit('openQuickModal', 'capture') },
    { label: '搜索与跳转…', icon: 'search', action: () => emit('openQuickModal', 'search') },
    { label: '回到今天', icon: 'today', action: () => goToday() },
    ...groupItems,
    { separator: true },
    {
      label: props.wsTheme === 'dark' ? '切换浅色工作台' : '切换深曜石暗色',
      icon: props.wsTheme === 'dark' ? 'sun' : 'moon',
      action: () => emit('toggleTheme'),
    },
    { label: '偏好设置…', icon: 'settings', action: () => emit('openSettings') },
  ];
  void showMenu(items, anchor, { placement: 'bottom-end' });
}
</script>

<template>
  <header class="wm-header">
    <div class="wmh-primary">
      <!-- Left Editorial Title Stack (Calico 'November 2026' + 'w45' layout) -->
      <div class="wmh-left">
        <div class="wmh-brand-stack">
          <button
            ref="calTitleRef"
            type="button"
            class="wmh-title-btn"
            @click="onHeroTitleClick"
          >
            <template v-if="activeAreaGroup">
              <GroupSquircle
                :name="activeAreaGroup.name"
                :color-key="activeAreaGroup.color"
                :icon="activeAreaGroup.icon"
                :size="22"
              />
              <span class="wmh-hero-title">{{ activeAreaGroup.name }}</span>
              <span class="wmh-sub-pill">{{ AREA_SUB_LABELS[areaSubTab] }}</span>
            </template>
            <template v-else-if="isCalicoHeroMode">
              <span class="wmh-hero-title">{{ heroMonthTitle }}</span>
            </template>
            <template v-else>
              <span class="wmh-hero-title">{{ KIND_LABELS[activeKind] }}</span>
            </template>
            <FIcon name="chevronDown" :size="11" class="wmh-chev" />
          </button>

          <YearMonthPicker
            v-if="isCalicoHeroMode"
            v-model:open="ymOpen"
            :anchor="calTitleRef"
          />

          <button type="button" class="wmh-sub-line" @click="onViewSwitchClick">
            <span class="wmh-week-tag">{{ weekBadgeText }}</span>
            <span class="wmh-sub-sep" aria-hidden="true">·</span>
            <span class="wmh-sub-context">
              {{ isCalicoHeroMode ? lunarSubText : nonCalSubText }}
            </span>
          </button>
        </div>
      </div>

      <!-- Right Unified Pill Action Capsule ([ + | 🔍 | ☰ | ··· ]) -->
      <div class="wmh-action-capsule">
        <button
          type="button"
          class="wmh-cap-btn"
          title="快速新建"
          aria-label="快速新建"
          @click="emit('openQuickModal', 'capture')"
        >
          <FIcon name="add" :size="17" />
        </button>

        <button
          type="button"
          class="wmh-cap-btn"
          title="搜索与命令"
          aria-label="搜索与命令"
          @click="emit('openQuickModal', 'search')"
        >
          <FIcon name="search" :size="15" />
        </button>

        <button
          type="button"
          class="wmh-drawer-btn wmh-cap-btn"
          title="打开导航与分组"
          aria-label="打开导航与分组"
          @click="emit('openDrawer')"
        >
          <FIcon name="sidebar" :size="15" />
          <span v-if="inboxCount > 0" class="wmh-dot" aria-hidden="true" />
        </button>

        <button
          type="button"
          class="wmh-circle-btn wmh-cap-btn"
          title="更多操作与主题"
          aria-label="更多操作与主题"
          @click="onMoreClick"
        >
          <FIcon name="more" :size="15" />
        </button>
      </div>
    </div>

    <!-- Contextual Sub-Ribbon: Calendar navigation & sub-view switch -->
    <div v-if="activeKind === 'calendar'" class="wmh-ribbon wmh-cal-ribbon">
      <div class="wmh-cal-nav">
        <span v-if="showRibbonTitle" class="wmh-cal-title">{{ calTitle }}</span>
        <div class="wmh-cal-steps">
          <button type="button" class="wmh-step-btn" title="上一页" aria-label="上一页" @click="page(-1)">
            <FIcon name="chevronLeft" :size="12" />
          </button>
          <button type="button" class="wmh-today-btn" @click="goToday()">今天</button>
          <button type="button" class="wmh-step-btn" title="下一页" aria-label="下一页" @click="page(1)">
            <FIcon name="chevronRight" :size="12" />
          </button>
        </div>
      </div>

      <div ref="segRef" class="wmh-seg" role="radiogroup" aria-label="日历子视图">
        <span
          v-if="segVisible"
          class="ws-slide-pill wmh-seg-pill"
          :class="{ 'no-anim': !segReady }"
          :style="segStyle"
          aria-hidden="true"
        />
        <button
          v-for="opt in calOptions"
          :key="opt.value"
          type="button"
          class="wmh-seg-btn"
          :class="{ active: calView === opt.value }"
          @click="emit('update:calView', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Contextual Sub-Ribbon: Quick group pills on Inbox -->
    <div v-else-if="activeKind === 'inbox' && groupList.length" class="wmh-ribbon wmh-inbox-ribbon">
      <div class="wmh-chip-strip" role="group" aria-label="按分组筛选收集箱">
        <button
          type="button"
          class="wmh-filter-chip"
          :class="{ active: !filterGroupId }"
          @click="emit('update:filterGroupId', '')"
        >
          <span>全部</span>
        </button>
        <button
          type="button"
          class="wmh-filter-chip"
          :class="{ active: filterGroupId === '__ungrouped__' }"
          @click="emit('update:filterGroupId', filterGroupId === '__ungrouped__' ? '' : '__ungrouped__')"
        >
          <span>未分组</span>
        </button>
        <button
          v-for="g in groupList"
          :key="g.id"
          type="button"
          class="wmh-filter-chip"
          :class="{ active: filterGroupId === g.id }"
          @click="emit('update:filterGroupId', filterGroupId === g.id ? '' : g.id)"
        >
          <span class="wfc-dot" :style="{ background: groupDotHex(g.color) }" />
          <span>{{ g.name }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.wm-header {
  flex: none;
  background: var(--ws-card-bg);
  padding: max(10px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) 6px max(16px, env(safe-area-inset-left));
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 15;
}

.wmh-primary {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wmh-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.wmh-brand-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
}

.wmh-title-btn {
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px 2px 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.wmh-hero-title {
  font-family: var(--font-display);
  font-size: 23px;
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wmh-sub-pill {
  font-size: 11px;
  font-weight: 650;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  flex: none;
}

.wmh-chev {
  color: var(--ws-ink-muted);
  opacity: 0.7;
  flex: none;
}

.wmh-sub-line {
  border: 0;
  background: transparent;
  padding: 0 4px 0 1px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  cursor: pointer;
  color: var(--ws-ink-muted);
  -webkit-tap-highlight-color: transparent;
}

.wmh-week-tag {
  font-size: 13px;
  font-weight: 700;
  color: var(--ws-ink-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.wmh-sub-sep {
  font-size: 11px;
  opacity: 0.55;
}

.wmh-sub-context {
  font-size: 12px;
  font-weight: 540;
  color: var(--ws-ink-muted);
}

/* Unified Calico Rounded Action Capsule */
.wmh-action-capsule {
  flex: none;
  height: 38px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-border-card);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.045);
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.wmh-cap-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 120ms var(--ws-ease-out), background-color 140ms ease;
  -webkit-tap-highlight-color: transparent;
}

.wmh-cap-btn:active {
  transform: scale(0.91);
  background: var(--ws-stone-pill);
}

.wmh-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e85d2a;
  box-shadow: 0 0 0 1.5px var(--ws-card-bg);
}

.wmh-ribbon {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 2px;
  border-top: 1px solid var(--ws-hairline);
}

.wmh-cal-ribbon {
  flex-wrap: wrap;
  row-gap: 6px;
}

.wmh-cal-nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wmh-cal-title {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ws-ink-secondary);
  white-space: nowrap;
}

.wmh-cal-steps {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.wmh-step-btn,
.wmh-today-btn {
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.wmh-step-btn {
  width: 26px;
  padding: 0;
}

.wmh-today-btn {
  padding: 0 9px;
}

.wmh-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--ws-stone-pill);
  margin-left: auto;
}

.wmh-seg-pill {
  border-radius: 7px;
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.wmh-seg-btn {
  position: relative;
  z-index: 1;
  height: 23px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
}

.wmh-seg-btn.active {
  color: var(--ws-ink);
  font-weight: 650;
}

.wmh-inbox-ribbon {
  overflow: hidden;
}

.wmh-chip-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  padding-bottom: 1px;
  width: 100%;
}

.wmh-chip-strip::-webkit-scrollbar {
  display: none;
}

.wmh-filter-chip {
  flex: none;
  scroll-snap-align: start;
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}

.wmh-filter-chip.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.wfc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
</style>
