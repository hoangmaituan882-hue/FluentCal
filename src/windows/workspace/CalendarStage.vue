<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { taskColor } from '@/fluent';
import { isDark } from '@/composables/theme';
import { groupList } from '@/stores/doc';
import { ui } from '../desk/state';
import DayView from '../desk/DayView.vue';
import MultiDayView from '../desk/MultiDayView.vue';
import MonthView from '../desk/MonthView.vue';
import CountdownBar from '../desk/CountdownBar.vue';

const props = defineProps<{
  calView: 'day' | 'multiday' | 'month' | 'weeks';
}>();

watch(
  () => props.calView,
  (v) => {
    ui.activeView = v;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  ui.activeView = '';
});

function groupHex(colorKey: string): string {
  return taskColor(colorKey, isDark.value).bar;
}

function toggleGroup(id: string) {
  if (!id) {
    ui.groupFilter = [];
    return;
  }
  const has = ui.groupFilter.includes(id);
  ui.groupFilter = has ? ui.groupFilter.filter((x) => x !== id) : [...ui.groupFilter, id];
}
</script>

<template>
  <div class="ws-cal-stage">
    <div class="ws-card-frame ws-cal-frame">
      <DayView v-if="calView === 'day'" />
      <MultiDayView v-else-if="calView === 'multiday'" />
      <MonthView v-else :mode="calView === 'weeks' ? 'weeks' : 'month'" />
      <CountdownBar v-if="calView === 'month' || calView === 'weeks'" />
    </div>

    <!-- Floating bottom-centered group filter capsule (ShopWrk / Folio style) -->
    <div v-if="groupList.length" class="cal-filter-float" role="group" aria-label="按分组筛选日程">
      <button
        type="button"
        class="cf-pill"
        :class="{ active: ui.groupFilter.length === 0 }"
        @click="toggleGroup('')"
      >
        全部
      </button>
      <button
        v-for="g in groupList"
        :key="g.id"
        type="button"
        class="cf-pill"
        :class="{ active: ui.groupFilter.includes(g.id) }"
        @click="toggleGroup(g.id)"
      >
        <span class="cf-dot" :style="{ background: groupHex(g.color) }" />
        <span>{{ g.name }}</span>
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

.cal-filter-float {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 12;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 40px);
  overflow-x: auto;
  padding: 4px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(14px);
  border: 1px solid var(--ws-hairline);
  box-shadow: var(--ws-shadow-md);
  scrollbar-width: none;
}

.cal-filter-float::-webkit-scrollbar {
  display: none;
}

.cf-pill {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, transform 120ms var(--ws-ease-out);
}

.cf-pill:hover:not(.active) {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.cf-pill.active {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font-weight: 600;
}

.cf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
</style>
