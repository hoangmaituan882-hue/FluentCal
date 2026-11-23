<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import { countdowns } from '@/lib/countdown';
import { toggleFilter } from '@/lib/filter';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, groupList, taskList } from '@/stores/doc';
import { spotlightGroups, ui } from '../desk/state';
import DayView from '../desk/DayView.vue';
import MultiDayView from '../desk/MultiDayView.vue';
import MonthView from '../desk/MonthView.vue';
import CountdownBar from '../desk/CountdownBar.vue';

const props = defineProps<{
  calView: 'day' | 'multiday' | 'month' | 'weeks';
}>();

const { isPhone, isTouch } = useViewport();

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
  taskList.value.some((t) => !t.countdownOnly && (!t.groupId || !doc.groups[t.groupId])),
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
    <div class="ws-card-frame ws-cal-frame">
      <DayView v-if="calView === 'day'" />
      <MultiDayView v-else-if="calView === 'multiday'" />
      <MonthView v-else :mode="calView === 'weeks' ? 'weeks' : 'month'" />
      <CountdownBar v-if="calView === 'month' || calView === 'weeks'" />
    </div>

    <!-- 1:1 Hover Spotlight + Click Blur-Dissolve Floating Capsule -->
    <div
      v-if="filterPills.length >= 2 || groupList.length > 0"
      class="cal-filter-float"
      :class="{ 'has-cd': hasBottomCountdownBar }"
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

.ws-cal-stage.phone .ws-cal-frame {
  padding-bottom: calc(74px + env(safe-area-inset-bottom));
}

.ws-cal-stage.phone .cal-filter-float {
  bottom: calc(78px + env(safe-area-inset-bottom));
  max-width: calc(100% - 16px);
}

.ws-cal-stage.phone .cal-filter-float.has-cd {
  bottom: calc(104px + env(safe-area-inset-bottom));
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

:global(html[data-ws-theme='dark']) .cal-filter-float {
  background: rgba(23, 24, 28, 0.92);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.45),
    0 1px 3px rgba(0, 0, 0, 0.25);
}

:global(html[data-ws-theme='dark']) .cf-pill {
  color: rgba(242, 240, 235, 0.78);
}

:global(html[data-ws-theme='dark']) .cf-pill:hover:not(.active),
:global(html[data-ws-theme='dark']) .cf-pill.hovered:not(.active) {
  background: rgba(255, 255, 255, 0.085);
  color: #F2F0EB;
}

:global(html[data-ws-theme='dark']) .cf-pill.active {
  background: #F2F0EB;
  color: #141518;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.36);
}

:global(html[data-ws-theme='dark']) .cf-clear {
  background: rgba(255, 255, 255, 0.09);
  color: rgba(242, 240, 235, 0.72);
}

:global(html[data-ws-theme='dark']) .cf-clear:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #F2F0EB;
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
