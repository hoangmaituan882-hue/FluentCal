<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { FIcon } from '@/fluent';
import { now } from '@/composables/now';
import { flexKind } from '@/lib/flex';
import { occurrences } from '@/lib/recur';
import { taskList } from '@/stores/doc';
import type { Task } from '@/types';
import { goToday, ui } from '../desk/state';
import { useSlidingIndicator } from './useSlidingIndicator';
import type { WorkspacePageKind } from './workspaceModel';

const props = defineProps<{
  activeKind: WorkspacePageKind;
  inboxCount: number;
  openCount: number;
}>();

const emit = defineEmits<{
  navigate: [kind: WorkspacePageKind];
  quickCapture: [];
  openDrawer: [];
  openTask: [id: string];
}>();

const trackRef = ref<HTMLElement>();
const clockTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    clockTick.value = Date.now();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const { style: thumbStyle, ready: thumbReady, visible: thumbVisible } = useSlidingIndicator(
  trackRef,
  '.wmd-tab.active',
  [() => props.activeKind],
);

const inboxBadge = computed(() => {
  if (props.inboxCount <= 0) return '';
  return props.inboxCount > 99 ? '99+' : String(props.inboxCount);
});

interface UpNextInfo {
  task?: Task;
  label: string;
}

const upNextInfo = computed<UpNextInfo>(() => {
  // Reference clockTick so the countdown refreshes every 30s
  void clockTick.value;
  const todayIso = now.value;
  const curDate = new Date();
  const curMinutes = curDate.getHours() * 60 + curDate.getMinutes();

  const todayTimed: { task: Task; diff: number; time: string }[] = [];
  const todayAny: Task[] = [];

  for (const t of taskList.value) {
    if (t.countdownOnly || flexKind(t)) continue;
    const occs = occurrences(t, todayIso, todayIso);
    for (const o of occs) {
      if (o.done) continue;
      todayAny.push(o.task);
      if (o.task.time) {
        const [hh, mm] = o.task.time.split(':').map(Number);
        if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
          const mins = hh * 60 + mm;
          const diff = mins - curMinutes;
          if (diff >= -15) {
            todayTimed.push({ task: o.task, diff, time: o.task.time });
          }
        }
      }
    }
  }

  if (todayTimed.length > 0) {
    todayTimed.sort((a, b) => a.diff - b.diff);
    const next = todayTimed[0];
    if (next.diff <= 0) {
      return {
        task: next.task,
        label: `正在进行 - ${next.task.title}`,
      };
    }
    const hrs = Math.floor(next.diff / 60);
    const mins = next.diff % 60;
    const timePart =
      hrs > 0
        ? mins > 0
          ? `${hrs}小时${mins}分后`
          : `${hrs}小时后`
        : `${Math.max(1, mins)}分钟后`;
    return {
      task: next.task,
      label: `${timePart} - ${next.task.title}`,
    };
  }

  if (todayAny.length > 0) {
    const first = todayAny[0];
    return {
      task: first,
      label: `今日 ${todayAny.length} 项安排 - ${first.title}`,
    };
  }

  // Fallback to selected date occurrences if viewing another day
  if (ui.selected !== todayIso) {
    for (const t of taskList.value) {
      if (t.countdownOnly || flexKind(t)) continue;
      const occs = occurrences(t, ui.selected, ui.selected);
      const openOcc = occs.find((o) => !o.done);
      if (openOcc) {
        return {
          task: openOcc.task,
          label: `所选日 - ${openOcc.task.title}`,
        };
      }
    }
  }

  return {
    label: props.openCount > 0 ? `待办清单共 ${props.openCount} 项未完成` : '轻点快速新建日程或待办',
  };
});

function onClockClick() {
  goToday();
  emit('navigate', 'daily');
}

function onUpNextClick() {
  const info = upNextInfo.value;
  if (info.task) {
    emit('openTask', info.task.id);
  } else {
    emit('quickCapture');
  }
}
</script>

<template>
  <nav class="wm-dock" aria-label="主导航">
    <!-- Tier 1: Calico Recessed Segmented View Switcher Track -->
    <div ref="trackRef" class="wmd-track">
      <span
        v-if="thumbVisible"
        class="ws-slide-pill wmd-thumb"
        :class="{ 'no-anim': !thumbReady }"
        :style="thumbStyle"
        aria-hidden="true"
      />

      <button
        type="button"
        class="wmd-tab"
        :class="{ active: activeKind === 'daily' }"
        @click="emit('navigate', 'daily')"
      >
        <span class="wmd-ico-wrap">
          <!-- Calico Split-View Icon (two stacked rounded panes) -->
          <svg class="wmd-calico-svg" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.6" />
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
          </svg>
        </span>
        <span class="wmd-lbl">今日</span>
      </button>

      <button
        type="button"
        class="wmd-tab"
        :class="{ active: activeKind === 'calendar' }"
        @click="emit('navigate', 'calendar')"
      >
        <span class="wmd-ico-wrap">
          <FIcon name="calendar" :size="15" />
        </span>
        <span class="wmd-lbl">日历</span>
      </button>

      <button
        type="button"
        class="wmd-tab"
        :class="{ active: activeKind === 'tasks' }"
        @click="emit('navigate', 'tasks')"
      >
        <span class="wmd-ico-wrap">
          <FIcon name="checklist" :size="15" />
        </span>
        <span class="wmd-lbl">待办</span>
      </button>

      <button
        type="button"
        class="wmd-tab"
        :class="{ active: activeKind === 'inbox' }"
        @click="emit('navigate', 'inbox')"
      >
        <span class="wmd-ico-wrap">
          <FIcon name="flag" :size="15" />
          <span v-if="inboxBadge" class="wmd-badge">{{ inboxBadge }}</span>
        </span>
        <span class="wmd-lbl">收集箱</span>
      </button>
    </div>

    <!-- Tier 2: Calico Live 'Up Next' Ticker & Quick Actions Bar -->
    <div class="wmd-status-row">
      <button
        type="button"
        class="wmd-clock-btn"
        title="回到今天"
        aria-label="回到今天"
        @click="onClockClick"
      >
        <svg viewBox="0 0 16 16" class="wmd-clock-svg" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.6V8l2.4 1.6" />
        </svg>
      </button>

      <button
        type="button"
        class="wmd-upnext-btn"
        :title="upNextInfo.label"
        @click="onUpNextClick"
      >
        <span class="wmd-upnext-txt">{{ upNextInfo.label }}</span>
      </button>

      <div class="wmd-right-btns">
        <button
          type="button"
          class="wmd-add"
          title="快速新建任务"
          aria-label="快速新建任务"
          @click="emit('quickCapture')"
        >
          <FIcon name="add" :size="14" />
        </button>

        <button
          type="button"
          class="wmd-more-btn"
          title="打开全部导航与分组"
          aria-label="打开全部导航与分组"
          @click="emit('openDrawer')"
        >
          <FIcon name="more" :size="15" />
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.wm-dock {
  position: fixed;
  left: 50%;
  bottom: max(8px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  width: calc(100% - 20px);
  max-width: 420px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border-radius: 26px;
  background: var(--ws-dock-bg);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
  backdrop-filter: blur(24px) saturate(165%);
  border: 1px solid var(--ws-dock-border);
  box-shadow: var(--ws-dock-shadow);
}

/* Tier 1: Recessed Segmented Pill Track */
.wmd-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  padding: 3px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--ws-ink) 7%, transparent);
}

.wmd-thumb {
  border-radius: 17px;
  background: var(--ws-card-bg);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 0.5px 1px rgba(0, 0, 0, 0.06);
}

.wmd-tab {
  position: relative;
  z-index: 1;
  height: 36px;
  border: 0;
  border-radius: 17px;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  font: inherit;
  cursor: pointer;
  transition: color 150ms ease, transform 120ms var(--ws-ease-out);
  -webkit-tap-highlight-color: transparent;
}

.wmd-tab:active {
  transform: scale(0.95);
}

.wmd-tab.active {
  color: var(--ws-ink);
  font-weight: 700;
}

.wmd-ico-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.wmd-calico-svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.wmd-badge {
  position: absolute;
  top: -6px;
  right: -10px;
  min-width: 14px;
  height: 14px;
  padding: 0 3.5px;
  border-radius: 999px;
  background: #e85d2a;
  color: #ffffff;
  font-size: 9px;
  font-weight: 750;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 1.5px var(--ws-card-bg);
}

.wmd-lbl {
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

/* Tier 2: Live Status Ticker Row (1:1 '🕒 In 2 hr 29 min - Client Meeting •••') */
.wmd-status-row {
  height: 32px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.wmd-clock-btn,
.wmd-more-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
  transition: background-color 140ms ease, transform 120ms ease;
  -webkit-tap-highlight-color: transparent;
}

.wmd-clock-btn:active,
.wmd-more-btn:active {
  background: var(--ws-stone-pill);
  transform: scale(0.92);
}

.wmd-clock-svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.wmd-upnext-btn {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.wmd-upnext-btn:active {
  background: var(--ws-stone-pill);
}

.wmd-upnext-txt {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wmd-right-btns {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.wmd-add {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 10%, transparent);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 120ms ease, background-color 140ms ease;
  -webkit-tap-highlight-color: transparent;
}

.wmd-add:active {
  transform: scale(0.91);
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}
</style>
