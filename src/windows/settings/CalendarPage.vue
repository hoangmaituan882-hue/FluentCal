<script setup lang="ts">
import { computed, ref } from 'vue';
import { FButton, FColorSwatches, FNumberBox, FSelect, FSettingsCard, FSettingsGroup, FToggle, TASK_COLORS, taskColor } from '@/fluent';
import type { Task } from '@/types';
import { formatYMD, WEEKDAY_SHORT } from '@/lib/date';
import { customCountdownTasks, describeCustomCountdown } from '@/lib/countdown';
import { deleteTask, saveTask } from '@/lib/tasks';
import { doc, patchSettings, taskList, useSetting } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import CountdownEditorModal from '../desk/CountdownEditorModal.vue';

const view = useSetting<string>('calendar.view');
const weekStart = useSetting<number>('calendar.weekStart');
const monthRows = useSetting<string>('calendar.monthRows');
const weeksRows = useSetting<number>('calendar.weeksRows');
const weeksPast = useSetting<number>('calendar.weeksPast');
const showLunar = useSetting<boolean>('calendar.showLunar');
const showHolidays = useSetting<boolean>('calendar.showHolidays');
const showWeekNumbers = useSetting<boolean>('calendar.showWeekNumbers');
const showAlmanac = useSetting<boolean>('calendar.showAlmanac');
const holidayCountdown = useSetting<boolean>('calendar.holidayCountdown');
const countdownFestival = useSetting<boolean>('calendar.countdownFestival');
const countdownTerm = useSetting<boolean>('calendar.countdownTerm');
const countdownMarked = useSetting<boolean>('calendar.countdownMarked');
const showCompleted = useSetting<boolean>('tasks.showCompleted');
const completedLast = useSetting<boolean>('tasks.completedLast');
const autoPostpone = useSetting<boolean>('tasks.autoPostpone');
const defaultColor = useSetting<string>('tasks.defaultColor');
const colors = TASK_COLORS.map((c) => ({ key: c.key, color: c.bar, label: c.label }));

const editorOpen = ref(false);
const editingTask = ref<Task | null>(null);

const customList = computed(() =>
  customCountdownTasks(taskList.value).map((t) => ({
    task: t,
    meta: describeCustomCountdown(t, now.value),
  })),
);

function openNewCountdown() {
  editingTask.value = null;
  editorOpen.value = true;
}

function openEditCountdown(t: Task) {
  editingTask.value = t;
  editorOpen.value = true;
}

function togglePin(t: Task) {
  void saveTask({ ...t, countdownPinned: !t.countdownPinned || undefined });
}

function removeCountdown(t: Task) {
  void deleteTask(t.id);
}

function dayBadgeText(t: Task): string {
  const m = describeCustomCountdown(t, now.value);
  if (m.mode === 'up') return m.days === 0 ? '今日起始' : `已 ${m.days} 天`;
  if (m.expired) return `已过 ${m.days} 天`;
  if (m.days === 0) return '就是今天';
  return `还有 ${m.days} 天`;
}

function dotHex(t: Task): string {
  return t.color ? taskColor(t.color, isDark.value).bar : 'var(--accent-fill)';
}

function toggleRest(d: number) {
  const set = new Set(doc.settings.calendar.restDays);
  if (set.has(d)) set.delete(d);
  else set.add(d);
  patchSettings({ calendar: { restDays: [...set].sort() } });
}
const order = [1, 2, 3, 4, 5, 6, 0];
</script>

<template>
  <div class="page">
    <FSettingsGroup title="视图">
      <FSettingsCard icon="calendar" title="默认视图">
        <FSelect v-model="view" :width="150" :options="[{ value: 'day', label: '日视图' }, { value: 'multiday', label: '多日视图' }, { value: 'month', label: '月视图' }, { value: 'weeks', label: '多周视图' }, { value: 'gantt', label: '甘特图' }]" />
      </FSettingsCard>
      <FSettingsCard icon="calendarWeek" title="每周的第一天">
        <FSelect v-model="weekStart" :width="150" :options="[{ value: 1, label: '星期一' }, { value: 0, label: '星期日' }]" />
      </FSettingsCard>
      <FSettingsCard icon="calendarDay" title="月视图行数" description="自动：只显示本月所在的 4～6 周；固定：总是 6 周">
        <FSelect v-model="monthRows" :width="150" :options="[{ value: 'auto', label: '自动' }, { value: 'six', label: '固定 6 行' }]" />
      </FSettingsCard>
      <FSettingsCard icon="list" title="多周视图" description="显示的周数，以及其中已经过去的周数；日历每周自动向后滚动">
        <div class="row-ctl">
          <span class="note">显示</span><FNumberBox v-model="weeksRows" :min="2" :max="10" suffix="周" :width="96" />
          <span class="note">已过</span><FNumberBox v-model="weeksPast" :min="0" :max="Math.max(0, weeksRows - 1)" suffix="周" :width="96" />
        </div>
      </FSettingsCard>
    </FSettingsGroup>
    <FSettingsGroup title="显示">
      <FSettingsCard icon="moon" title="农历" description="在日期旁显示农历日；节日、节气始终显示">
        <FToggle v-model="showLunar" />
      </FSettingsCard>
      <FSettingsCard icon="flag" title="法定节假日" description="放假显示“休”，调休上班显示“班”">
        <FToggle v-model="showHolidays" />
      </FSettingsCard>
      <FSettingsCard icon="tag" title="周数" description="在每行左侧显示 ISO 周数">
        <FToggle v-model="showWeekNumbers" />
      </FSettingsCard>
      <FSettingsCard icon="info" title="宜忌" description="鼠标停在日期上时显示农历宜忌">
        <FToggle v-model="showAlmanac" />
      </FSettingsCard>
      <FSettingsCard icon="home" title="休息日" description="没有法定节假日时，这几天按休息日显示">
        <div class="chips" role="group" aria-label="休息日">
          <button v-for="d in order" :key="d" type="button" :class="{ on: doc.settings.calendar.restDays.includes(d) }" :aria-pressed="doc.settings.calendar.restDays.includes(d)" @click="toggleRest(d)">
            {{ WEEKDAY_SHORT[d] }}
          </button>
        </div>
      </FSettingsCard>
    </FSettingsGroup>
    <FSettingsGroup title="倒数日">
      <FSettingsCard icon="flag" title="法定节假日倒计时" description="显示距离下一个法定节假日的剩余天数">
        <FToggle v-model="holidayCountdown" />
      </FSettingsCard>
      <FSettingsCard icon="star" title="传统节日倒计时" description="显示农历及常见节日倒计时">
        <FToggle v-model="countdownFestival" />
      </FSettingsCard>
      <FSettingsCard icon="clock" title="二十四节气倒计时" description="在底部倒数日栏显示近期节气">
        <FToggle v-model="countdownTerm" />
      </FSettingsCard>
      <FSettingsCard icon="completed" title="自定义倒数日与标记任务" description="在日历底部与工作台显示你创建或标记的倒数日">
        <FToggle v-model="countdownMarked" />
      </FSettingsCard>
      <FSettingsCard icon="timer" title="自定义倒数日" description="添加独立的倒数日或纪念正数日，支持公历/农历每年重复与置顶">
        <FButton variant="accent" size="small" icon="add" @click="openNewCountdown">添加倒数日</FButton>
      </FSettingsCard>
      <div v-if="customList.length" class="cd-manage-list">
        <div v-for="{ task, meta } in customList" :key="task.id" class="cd-manage-row">
          <span class="cd-row-dot" :style="{ background: dotHex(task) }" />
          <div class="cd-row-info">
            <div class="cd-row-title">
              <span>{{ task.title }}</span>
              <span v-if="task.repeat?.freq === 'yearly'" class="cd-row-tag">每年公历</span>
              <span v-else-if="task.repeat?.freq === 'lunarYearly'" class="cd-row-tag">每年农历</span>
              <span v-if="!task.countdownOnly" class="cd-row-tag">联动任务</span>
            </div>
            <div class="cd-row-sub">{{ formatYMD(meta.nextDate) }}</div>
          </div>
          <span class="cd-row-days" :class="{ expired: meta.expired, up: meta.mode === 'up' }">{{ dayBadgeText(task) }}</span>
          <div class="cd-row-actions">
            <FButton
              size="icon"
              variant="subtle"
              :icon="task.countdownPinned ? 'unpin' : 'pin'"
              :title="task.countdownPinned ? '取消置顶' : '置顶显示'"
              @click="togglePin(task)"
            />
            <FButton size="icon" variant="subtle" icon="edit" title="编辑" @click="openEditCountdown(task)" />
            <FButton size="icon" variant="subtle" icon="delete" title="删除" @click="removeCountdown(task)" />
          </div>
        </div>
      </div>
    </FSettingsGroup>
    <FSettingsGroup title="任务">
      <FSettingsCard icon="completed" title="显示已完成的任务">
        <FToggle v-model="showCompleted" />
      </FSettingsCard>
      <FSettingsCard icon="list" title="已完成的任务排在最后">
        <FToggle v-model="completedLast" />
      </FSettingsCard>
      <FSettingsCard icon="forward" title="未完成自动顺延" description="过期 30 天内未完成的单日任务，每天自动移到今天（可在任务上单独设置）">
        <FToggle v-model="autoPostpone" />
      </FSettingsCard>
      <FSettingsCard icon="color" title="新任务默认颜色">
        <FColorSwatches v-model="defaultColor" :colors="colors" allow-none :size="22" />
      </FSettingsCard>
    </FSettingsGroup>
    <CountdownEditorModal :open="editorOpen" :task="editingTask" @close="editorOpen = false" />
  </div>
</template>

<style scoped>
.cd-manage-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.cd-manage-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--card-fill);
  border: 1px solid var(--card-stroke);
}

.cd-row-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.cd-row-info {
  flex: 1;
  min-width: 0;
}

.cd-row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 550;
  color: var(--text-primary);
}

.cd-row-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--control-alt-fill-hover);
  color: var(--text-secondary);
}

.cd-row-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 1px;
}

.cd-row-days {
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--control-alt-fill-hover);
  color: var(--text-primary);
  flex: none;
}

.cd-row-days.up {
  background: rgba(16, 124, 16, 0.12);
  color: #0F7B0F;
}

.cd-row-days.expired {
  background: var(--critical-bg);
  color: var(--critical);
}

.cd-row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
</style>
