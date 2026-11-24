<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { FIcon, showMenu, taskColor, type MenuItem } from '@/fluent';
import { countdowns } from '@/lib/countdown';
import { toggleFilter } from '@/lib/filter';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, groupList, taskList } from '@/stores/doc';
import type { ISODate } from '@/types';
import { goToday, page, spotlightGroups, ui, viewTitle } from '../desk/state';
import YearMonthPicker from '../desk/YearMonthPicker.vue';
import DayView from '../desk/DayView.vue';
import MultiDayView from '../desk/MultiDayView.vue';
import MonthView from '../desk/MonthView.vue';
import CountdownBar from '../desk/CountdownBar.vue';
import MobileCalicoTimeline from './MobileCalicoTimeline.vue';

type CalSubView = 'day' | 'multiday' | 'month' | 'weeks';

const props = withDefaults(
  defineProps<{
    calView: CalSubView;
    dockCompact?: boolean;
  }>(),
  {
    dockCompact: false,
  },
);

const emit = defineEmits<{
  'update:calView': [v: CalSubView];
  openTask: [taskId: string, date?: ISODate];
  dockCompact: [compact: boolean];
}>();

const { isPhone, isTouch } = useViewport();
const useMobileTimeline = computed(
  () => isPhone.value && (props.calView === 'day' || props.calView === 'multiday'),
);
const calTitleRef = ref<HTMLElement | null>(null);
const ymOpen = ref(false);

const CAL_LABELS: Record<CalSubView, string> = {
  day: '单日视图',
  multiday: '多日视图',
  weeks: '多周视图',
  month: '月视图',
};

const calTitle = computed(() => viewTitle());

function openCalViewMenu(e: MouseEvent) {
  const anchor = e.currentTarget as HTMLElement;
  const items: MenuItem[] = (['day', 'multiday', 'weeks', 'month'] as CalSubView[]).map((v) => ({
    label: CAL_LABELS[v],
    radio: true,
    checked: props.calView === v,
    action: () => emit('update:calView', v),
  }));
  void showMenu(items, anchor, { placement: 'bottom-end' });
}

function onPillHoverEnter(id: string) {
  if (!isTouch.value) ui.hoverGroup = id;
}

function onPillBlur(id: string) {
  if (ui.hoverGroup === id) ui.hoverGroup = null;
}

function onPillListLeave() {
  ui.hoverGroup = null;
}

function clearHoverOnly() {
  ui.hoverGroup = null;
}

watch(
  () => props.calView,
  (v) => {
    ui.activeView = v;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  ui.activeView = '';
  ui.hoverGroup = null;
  ui.spotlightGroups = [];
});

const hasUngrouped = computed(() =>
  taskList.value.some((t) => !t.countdownOnly && !t.subscriptionOnly && !t.habitOnly && (!t.groupId || !doc.groups[t.groupId])),
);

const filterPills = computed(() => {
  const pills = groupList.value.map((g) => ({
    id: g.id,
    name: g.name,
    color: taskColor(g.color, isDark.value).bar,
  }));
  if (hasUngrouped.value) {
    pills.push({ id: '', name: '未分组', color: '#8A857E' });
  }
  return pills;
});

const hasBottomCountdownBar = computed(() => {
  if (props.calView !== 'month' && props.calView !== 'weeks') return false;
  return (
    countdowns(
      taskList.value.map((t) => (t.groupId && !doc.groups[t.groupId] ? { ...t, groupId: undefined } : t)),
      now.value,
      doc.settings.calendar.holidayCountdown,
      doc.settings.calendar.countdownMarked,
      doc.settings.calendar.countdownGroups,
      doc.settings.calendar.countdownFestival,
      doc.settings.calendar.countdownTerm,
    ).length > 0
  );
});

function isSelected(id: string): boolean {
  return spotlightGroups.value.includes(id);
}

function toggleSpotlight(id: string) {
  let next = toggleFilter(doc.groups, spotlightGroups.value, id, !isSelected(id));
  if (!hasUngrouped.value && groupList.value.length > 0 && next.length >= groupList.value.length) {
    next = [];
  }
  ui.spotlightGroups = next;
}

function clearSpotlight() {
  ui.spotlightGroups = [];
  ui.hoverGroup = null;
}
</script>

<template>
  <div class="ws-cal-stage" :class="{ phone: isPhone }">
    <!-- Woday Minimal Calendar Header on Desktop / Tablet -->
    <header v-if="!isPhone" class="wd-cal-head">
      <div class="wch-left">
        <button
          v-if="calView === 'month'"
          ref="calTitleRef"
          type="button"
          class="wch-title clickable"
          @click="ymOpen = !ymOpen"
        >
          <span>{{ calTitle }}</span>
          <FIcon name="chevronDown" :size="13" class="wch-chev" />
        </button>
        <h1 v-else class="wch-title">{{ calTitle }}</h1>
        <YearMonthPicker v-if="calView === 'month'" v-model:open="ymOpen" :anchor="calTitleRef" />
      </div>

      <div class="wch-right">
        <button type="button" class="wch-pill" @click="openCalViewMenu">
          <span>{{ CAL_LABELS[calView] }}</span>
          <FIcon name="chevronDown" :size="11" />
        </button>
        <button type="button" class="wch-pill" @click="goToday()">今天</button>
        <button type="button" class="wch-circle" title="上一页" aria-label="上一页" @click="page(-1)">
          <FIcon name="chevronLeft" :size="13" />
        </button>
        <button type="button" class="wch-circle" title="下一页" aria-label="下一页" @click="page(1)">
          <FIcon name="chevronRight" :size="13" />
        </button>
      </div>
    </header>

    <div class="ws-card-frame ws-cal-frame" :class="{ 'calico-tl-host': useMobileTimeline }">
      <MobileCalicoTimeline
        v-if="useMobileTimeline"
        :initial-days="calView === 'day' ? 1 : 3"
        @open-task="(id, date) => emit('openTask', id, date)"
        @dock-compact="(v) => emit('dockCompact', v)"
      />
      <DayView v-else-if="calView === 'day'" />
      <MultiDayView v-else-if="calView === 'multiday'" />
      <MonthView v-else :mode="calView === 'weeks' ? 'weeks' : 'month'" />
      <CountdownBar v-if="calView === 'month' || calView === 'weeks'" />
    </div>

    <!-- 1:1 Hover Spotlight + Click Blur-Dissolve Floating Capsule -->
    <div
      v-if="filterPills.length >= 2 || groupList.length > 0"
      class="cal-filter-float"
      :class="{ 'has-cd': hasBottomCountdownBar, 'dock-compact': dockCompact }"
      role="group"
      aria-label="悬停聚光预览，点击筛选分类日程"
      @pointerleave="onPillListLeave"
    >
      <button
        v-for="p in filterPills"
        :key="p.id || '__ungrouped__'"
        type="button"
        class="cf-pill"
        :class="{ active: isSelected(p.id), hovered: ui.hoverGroup === p.id }"
        :style="{ '--pill-color': p.color }"
        :aria-pressed="isSelected(p.id)"
        @pointerenter="onPillHoverEnter(p.id)"
        @focus="onPillHoverEnter(p.id)"
        @blur="onPillBlur(p.id)"
        @click="toggleSpotlight(p.id)"
      >
        <span class="cf-indicator" aria-hidden="true">
          <span class="cf-dot" />
          <svg class="cf-check" viewBox="0 0 12 12">
            <path d="M2.2 6.4 4.8 9 9.8 3.4" />
          </svg>
        </span>
        <span class="cf-name">{{ p.name }}</span>
      </button>

      <button
        v-if="spotlightGroups.length > 0"
        type="button"
        class="cf-clear"
        title="清除筛选"
        aria-label="清除筛选"
        @pointerenter="clearHoverOnly"
        @click="clearSpotlight"
      >
        <FIcon name="close" :size="9" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.ws-cal-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.ws-cal-frame {
  padding-bottom: 10px;
}

/* Woday Minimalist Calendar Header */
.wd-cal-head {
  flex: none;
  padding: 14px 22px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wch-left {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.wch-title {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 780;
  letter-spacing: -0.03em;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wch-title.clickable {
  cursor: pointer;
  padding: 2px 8px 2px 2px;
  border-radius: 9px;
}

.wch-title.clickable:hover {
  background: var(--ws-card-subtle);
}

.wch-chev {
  color: var(--ws-ink-muted);
}

.wch-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wch-pill {
  height: 29px;
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
  font-weight: 600;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.wch-pill:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.wch-circle {
  width: 29px;
  height: 29px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.wch-circle:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

/* High-Craft Soft Pastel Full-Color Event Blocks inside Workspace Calendar (desk widget untouched) */
.ws-cal-frame :deep(.chip:not(.bar)) {
  background: color-mix(in srgb, var(--bar, #64748b) 22%, var(--ws-card-bg));
  border: 1px solid color-mix(in srgb, var(--bar, #64748b) 34%, transparent);
  color: color-mix(in srgb, var(--bar, #334155) 72%, #111111);
  border-radius: 6px;
  padding: 0 6px 0 4px;
  text-shadow: none;
  font-weight: 560;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    opacity 200ms ease;
}

.ws-cal-frame :deep(.chip:not(.bar):hover) {
  background: color-mix(in srgb, var(--bar, #64748b) 30%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--bar, #64748b) 48%, transparent);
  transform: translateY(-0.5px);
  box-shadow: 0 3px 8px color-mix(in srgb, var(--bar, #64748b) 18%, transparent);
}

.ws-cal-frame :deep(.chip.done:not(.bar)) {
  background: color-mix(in srgb, var(--bar, #64748b) 11%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--bar, #64748b) 18%, transparent);
  opacity: 0.72;
}

.ws-cal-frame :deep(.chip.bar) {
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}

.ws-cal-frame :deep(.allday-pill),
.ws-cal-frame :deep(.md-allday-chip) {
  background: color-mix(in srgb, var(--pill-accent, var(--ev-bar, #64748b)) 22%, var(--ws-card-bg));
  border: 1px solid color-mix(in srgb, var(--pill-accent, var(--ev-bar, #64748b)) 34%, transparent);
  color: color-mix(in srgb, var(--pill-accent, var(--ev-bar, #334155)) 72%, #111111);
  border-radius: 7px;
  padding-left: 8px;
}

.ws-cal-frame :deep(.md-allday-chip::before),
.ws-cal-frame :deep(.allday-pill .pill-dot) {
  display: none;
}

.ws-cal-frame :deep(.day-event:not(.selected):not(.draft)),
.ws-cal-frame :deep(.md-event.single:not(.selected):not(.draft)) {
  background: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 22%, var(--ws-card-bg));
  border: 1px solid color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 36%, transparent);
  color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #334155)) 72%, #111111);
  border-radius: 9px;
  padding-left: 10px;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 12%, transparent);
}

.ws-cal-frame :deep(.day-event .ev-accent),
.ws-cal-frame :deep(.md-event.single::before) {
  display: none;
}

.ws-cal-frame :deep(.day-event:not(.selected):not(.draft) .ev-title),
.ws-cal-frame :deep(.md-event.single:not(.selected):not(.draft) .blk-title) {
  color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #334155)) 74%, #0f172a);
  font-weight: 650;
}

.ws-cal-frame :deep(.day-event:not(.selected):not(.draft) .ev-time),
.ws-cal-frame :deep(.md-event.single:not(.selected):not(.draft) .blk-time),
.ws-cal-frame :deep(.md-event.single:not(.selected):not(.draft) .blk-dur) {
  color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #334155)) 60%, #334155);
}

.ws-cal-frame :deep(.day-event:not(.selected):not(.draft):hover),
.ws-cal-frame :deep(.md-event.single:not(.selected):not(.draft):hover) {
  background: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 30%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 50%, transparent);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 20%, transparent);
}

.ws-cal-frame :deep(.day-event.done:not(.selected)),
.ws-cal-frame :deep(.md-event.single.done:not(.selected)) {
  background: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 12%, var(--ws-card-bg));
  opacity: 0.72;
}

.ws-cal-stage.phone .ws-cal-frame {
  padding-bottom: calc(74px + env(safe-area-inset-bottom));
}

.ws-cal-stage.phone .ws-cal-frame.calico-tl-host {
  padding-bottom: 0;
}

.ws-cal-stage.phone .cal-filter-float {
  bottom: calc(98px + env(safe-area-inset-bottom));
  max-width: calc(100% - 16px);
}

.ws-cal-stage.phone .cal-filter-float.dock-compact {
  bottom: calc(56px + env(safe-area-inset-bottom));
}

.ws-cal-stage.phone .cal-filter-float.has-cd {
  bottom: calc(124px + env(safe-area-inset-bottom));
}

.cal-filter-float {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 25;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: calc(100% - 40px);
  overflow-x: auto;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(28, 25, 23, 0.08);
  box-shadow:
    0 8px 26px rgba(24, 22, 19, 0.09),
    0 1px 3px rgba(24, 22, 19, 0.05);
  scrollbar-width: none;
  transition: bottom 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cal-filter-float.has-cd {
  bottom: 42px;
}

.cal-filter-float::-webkit-scrollbar {
  display: none;
}

.cf-pill {
  height: 29px;
  padding: 0 11px 0 9px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #3A3834;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 150ms ease,
    transform 120ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 180ms ease;
}

.cf-pill:hover:not(.active),
.cf-pill.hovered:not(.active) {
  background: rgba(28, 25, 23, 0.065);
  color: #18181A;
}

.cf-pill:active {
  transform: scale(0.965);
}

.cf-pill.active {
  background: #18181A;
  color: #FFFFFF;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(24, 24, 26, 0.22);
}

.cf-indicator {
  position: relative;
  width: 14px;
  height: 14px;
  display: inline-grid;
  place-items: center;
  flex: none;
}

.cf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--pill-color);
  opacity: 0.78;
  transform: scale(1);
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.34, 1.36, 0.64, 1);
}

.cf-pill:hover:not(.active) .cf-dot,
.cf-pill.hovered:not(.active) .cf-dot {
  opacity: 1;
  transform: scale(1.1);
}

.cf-pill.active .cf-dot {
  opacity: 0;
  transform: scale(0.45);
}

.cf-check {
  position: absolute;
  inset: 0;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--pill-color);
  stroke-width: 2.15;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  transform: scale(0.55);
  transition:
    opacity 150ms ease,
    transform 200ms cubic-bezier(0.34, 1.36, 0.64, 1);
}

.cf-pill.active .cf-check {
  opacity: 1;
  transform: scale(1);
}

.cf-clear {
  width: 24px;
  height: 24px;
  margin-left: 1px;
  margin-right: 2px;
  border: 0;
  border-radius: 999px;
  background: rgba(28, 25, 23, 0.06);
  color: #5C5953;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
  transition: background-color 140ms ease, color 140ms ease, transform 120ms ease;
}

.cf-clear:hover {
  background: rgba(28, 25, 23, 0.12);
  color: #18181A;
}

.cf-clear:active {
  transform: scale(0.92);
}

@media (prefers-reduced-motion: reduce) {
  .cal-filter-float,
  .cf-pill,
  .cf-dot,
  .cf-check {
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
/* Unscoped Dark-Mode Floating Filter Pill & Soft Pastel Full-Color Blocks for Workspace Calendar */
html[data-ws-theme='dark'] .ws-cal-stage .cal-filter-float {
  background: rgba(23, 24, 28, 0.92);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.45),
    0 1px 3px rgba(0, 0, 0, 0.25);
}

html[data-ws-theme='dark'] .ws-cal-stage .cf-pill {
  color: rgba(242, 240, 235, 0.78);
}

html[data-ws-theme='dark'] .ws-cal-stage .cf-pill:hover:not(.active),
html[data-ws-theme='dark'] .ws-cal-stage .cf-pill.hovered:not(.active) {
  background: rgba(255, 255, 255, 0.085);
  color: #F2F0EB;
}

html[data-ws-theme='dark'] .ws-cal-stage .cf-pill.active {
  background: #F2F0EB;
  color: #141518;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.36);
}

html[data-ws-theme='dark'] .ws-cal-stage .cf-clear {
  background: rgba(255, 255, 255, 0.09);
  color: rgba(242, 240, 235, 0.72);
}

html[data-ws-theme='dark'] .ws-cal-stage .cf-clear:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #F2F0EB;
}

html[data-ws-theme='dark'] .ws-cal-frame .chip:not(.bar) {
  background: color-mix(in srgb, var(--bar, #64748b) 27%, #181a20);
  border-color: color-mix(in srgb, var(--bar, #64748b) 44%, transparent);
  color: color-mix(in srgb, var(--bar, #cbd5e1) 34%, #ffffff);
}

html[data-ws-theme='dark'] .ws-cal-frame .chip:not(.bar):hover {
  background: color-mix(in srgb, var(--bar, #64748b) 36%, #181a20);
  border-color: color-mix(in srgb, var(--bar, #64748b) 58%, transparent);
}

html[data-ws-theme='dark'] .ws-cal-frame .allday-pill,
html[data-ws-theme='dark'] .ws-cal-frame .md-allday-chip {
  background: color-mix(in srgb, var(--pill-accent, var(--ev-bar, #64748b)) 28%, #181a20);
  border-color: color-mix(in srgb, var(--pill-accent, var(--ev-bar, #64748b)) 44%, transparent);
  color: color-mix(in srgb, var(--pill-accent, var(--ev-bar, #cbd5e1)) 32%, #ffffff);
}

html[data-ws-theme='dark'] .ws-cal-frame .day-event:not(.selected):not(.draft),
html[data-ws-theme='dark'] .ws-cal-frame .md-event.single:not(.selected):not(.draft) {
  background: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 28%, #181a20);
  border-color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 46%, transparent);
  color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #cbd5e1)) 30%, #ffffff);
}

html[data-ws-theme='dark'] .ws-cal-frame .day-event:not(.selected):not(.draft):hover,
html[data-ws-theme='dark'] .ws-cal-frame .md-event.single:not(.selected):not(.draft):hover {
  background: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 38%, #181a20);
  border-color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #64748b)) 60%, transparent);
}

html[data-ws-theme='dark'] .ws-cal-frame .day-event:not(.selected):not(.draft) .ev-title,
html[data-ws-theme='dark'] .ws-cal-frame .md-event.single:not(.selected):not(.draft) .blk-title {
  color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #e2e8f0)) 26%, #ffffff);
}

html[data-ws-theme='dark'] .ws-cal-frame .day-event:not(.selected):not(.draft) .ev-time,
html[data-ws-theme='dark'] .ws-cal-frame .md-event.single:not(.selected):not(.draft) .blk-time,
html[data-ws-theme='dark'] .ws-cal-frame .md-event.single:not(.selected):not(.draft) .blk-dur {
  color: color-mix(in srgb, var(--ev-accent, var(--ev-bar, #cbd5e1)) 38%, rgba(255, 255, 255, 0.78));
}
</style>
