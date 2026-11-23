<script setup lang="ts">
import { t as tr } from '@/i18n';
import { computed, ref } from 'vue';
import { FIcon, taskColor, vTip } from '@/fluent';
import { countdowns } from '@/lib/countdown';
import { formatFriendly } from '@/lib/date';
import { doc, storeState, taskList } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { jumpTo, openCountdowns } from './state';

const expanded = ref(false);
const items = computed(() =>
  countdowns(
    taskList.value.map((t) => (t.groupId && !doc.groups[t.groupId] ? { ...t, groupId: undefined } : t)),
    now.value,
    doc.settings.calendar.holidayCountdown,
    doc.settings.calendar.countdownMarked,
    doc.settings.calendar.countdownGroups,
    doc.settings.calendar.countdownFestival,
    doc.settings.calendar.countdownTerm,
  ).map((c) => ({ ...c, label: c.taskId ? c.label : tr(c.label) })),
);

function onChipClick(c: (typeof items.value)[number]) {
  if (c.custom && !storeState.readOnly) {
    openCountdowns();
    return;
  }
  jumpTo(c.date, c.custom ? '' : c.taskId);
}
</script>

<template>
  <div v-if="items.length" class="countdown" :class="{ expanded }" role="group" :aria-label="tr('倒数日')">
    <button v-if="items.length > 6" class="cd" @click="expanded = !expanded">{{ expanded ? tr('收起') : tr('展开倒计时') }}</button>
    <button
      v-for="c in expanded ? items : items.slice(0, 6)"
      :key="c.key"
      type="button"
      class="cd"
      :class="{ pinned: c.pinned, up: c.mode === 'up' }"
      v-tip="formatFriendly(c.date)"
      @click="onChipClick(c)"
    >
      <span v-if="c.color" class="cd-dot" :style="{ background: taskColor(c.color, isDark).bar }" aria-hidden="true" />
      <FIcon :name="c.pinned ? 'pin' : c.taskId ? 'flag' : 'calendarDay'" :size="11" />
      <span v-if="c.mode === 'up'">{{ c.days === 0 ? `${c.label} 从今天开始` : `${c.label} 已 ${c.days} 天` }}</span>
      <span v-else>{{ c.days === 0 ? tr('{0} 就是今天', c.label) : tr('距{0}还有 {1} 天', c.label, c.days) }}</span>
    </button>
    <button
      v-if="!storeState.readOnly"
      type="button"
      class="cd cd-add"
      title="管理自定义倒数日"
      aria-label="管理自定义倒数日"
      @click="openCountdowns()"
    >
      <FIcon name="add" :size="10" />
    </button>
  </div>
</template>

<style scoped>
.countdown {
  flex: none;
  display: flex;
  gap: 4px;
  overflow: hidden;
  height: calc(22px * var(--fs));
}
.cd {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 0;
  border-radius: 11px;
  background: var(--cell-bg);
  color: var(--calendar-text-secondary);
  font: inherit;
  font-size: calc(12px * var(--fs));
  white-space: nowrap;
  text-shadow: var(--calendar-outline);
  cursor: pointer;
}
.countdown.expanded { flex-wrap: wrap; height: auto; max-height: 180px; overflow-y: auto; }
.cd:hover {
  background: var(--subtle-fill-hover);
  color: var(--calendar-text);
}
.cd.pinned {
  color: var(--calendar-text);
  font-weight: 550;
}
.cd-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.cd-add {
  padding: 0 6px;
  opacity: 0.72;
}
.cd-add:hover {
  opacity: 1;
}
.cd b {
  font-weight: 600;
  color: var(--calendar-text);
  margin: 0 2px;
}
.cd em {
  font-style: normal;
  font-weight: 700;
  color: var(--calendar-text);
  font-variant-numeric: tabular-nums;
}
</style>
