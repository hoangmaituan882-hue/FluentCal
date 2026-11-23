<script setup lang="ts">
import { t as tr } from '@/i18n';
import { computed, ref, watch } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { ISODate } from '@/types';
import {
  addDays,
  addMonths,
  diffDays,
  formatFriendly,
  monthWeeks,
  parts,
  startOfMonth,
  WEEKDAY_SHORT,
} from '@/lib/date';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { occurrences, type Occurrence } from '@/lib/recur';
import { addTask, setOccurrenceDone } from '@/lib/tasks';
import { doc, storeState } from '@/stores/doc';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { defaultWeeksStart, goToday, openEditor, openSettings, shownTasks, ui } from './state';
import { chipMenu, moreMenu } from './menus';

const miniCursor = ref<ISODate>(startOfMonth(ui.cursor));
watch(
  () => ui.cursor,
  (c) => {
    miniCursor.value = startOfMonth(c);
  },
);

const focusParts = computed(() => parts(miniCursor.value));
const focusPrefix = computed(() => miniCursor.value.slice(0, 7));

const weekHeaders = computed(() => {
  const ws = doc.settings.calendar.weekStart;
  return Array.from({ length: 7 }, (_, i) => tr(WEEKDAY_SHORT[(ws + i) % 7]));
});

const weeks = computed(() => {
  const [y, m] = focusParts.value;
  return monthWeeks(y, m, doc.settings.calendar.weekStart, 'auto');
});

const gridStart = computed(() => weeks.value[0]);
const gridEnd = computed(() => addDays(weeks.value[weeks.value.length - 1], 6));

const gridOccurrences = computed<Occurrence[]>(() => {
  const show = doc.settings.tasks.showCompleted;
  const s = gridStart.value;
  const e = gridEnd.value;
  const out: Occurrence[] = [];
  for (const t of shownTasks.value) {
    for (const o of occurrences(t, s, e)) {
      if (show || !o.done || t.id === ui.revealTask) out.push(o);
    }
  }
  return out;
});

function barHex(o: Occurrence): string {
  const groupColor = o.task.groupId ? doc.groups[o.task.groupId]?.color : undefined;
  return taskColor(o.task.color || groupColor, isDark.value).bar;
}

interface MiniDay {
  date: ISODate;
  dayNum: string;
  dim: boolean;
  today: boolean;
  selected: boolean;
  count: number;
  cornerKind: '' | 'pending' | 'multi' | 'done';
  singleBadge: { glyph: string; color: string } | null;
  dots: string[];
}

const byDate = computed(() => {
  const map = new Map<ISODate, Occurrence[]>();
  const gs = gridStart.value;
  const ge = gridEnd.value;
  for (const o of gridOccurrences.value) {
    const s = o.start < gs ? gs : o.start;
    const e = o.end > ge ? ge : o.end;
    for (let d = s; d <= e; d = addDays(d, 1)) {
      let arr = map.get(d);
      if (!arr) {
        arr = [];
        map.set(d, arr);
      }
      arr.push(o);
    }
  }
  return map;
});

const miniDays = computed<MiniDay[]>(() => {
  const out: MiniDay[] = [];
  const todayIso = now.value;
  const sel = ui.selected;
  const prefix = focusPrefix.value;
  for (const w of weeks.value) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(w, i);
      const [, , d] = parts(date);
      const list = byDate.value.get(date) ?? [];
      const hasPending = list.some((o) => !o.done);
      const hasMulti = list.some((o) => o.start !== o.end);
      let cornerKind: MiniDay['cornerKind'] = '';
      if (list.length) {
        if (hasMulti) cornerKind = 'multi';
        else if (hasPending) cornerKind = 'pending';
        else cornerKind = 'done';
      }
      let singleBadge: MiniDay['singleBadge'] = null;
      const dots: string[] = [];
      if (list.length === 1) {
        const first = list[0];
        const ch = Array.from(first.task.title.trim())[0] ?? '•';
        singleBadge = { glyph: ch, color: barHex(first) };
      } else if (list.length > 1) {
        for (const o of list) {
          const hex = barHex(o);
          if (!dots.includes(hex)) dots.push(hex);
          if (dots.length >= 3) break;
        }
      }
      out.push({
        date,
        dayNum: String(d),
        dim: date.slice(0, 7) !== prefix,
        today: date === todayIso,
        selected: date === sel,
        count: list.length,
        cornerKind,
        singleBadge,
        dots,
      });
    }
  }
  return out;
});

const monthStats = computed(() => {
  const monthStart = startOfMonth(miniCursor.value);
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const seen = new Map<string, boolean>();
  for (const o of gridOccurrences.value) {
    if (o.end < monthStart || o.start > monthEnd) continue;
    const key = `${o.task.id}@${o.date}`;
    const prev = seen.get(key);
    seen.set(key, prev === undefined ? o.done : prev && o.done);
  }
  let todo = 0;
  for (const done of seen.values()) if (!done) todo++;
  return { total: seen.size, todo };
});

function stepMonth(delta: number) {
  miniCursor.value = addMonths(miniCursor.value, delta);
  if (doc.settings.calendar.view === 'month') {
    ui.cursor = miniCursor.value;
  }
}

function jumpToday() {
  goToday();
  miniCursor.value = startOfMonth(now.value);
}

function pickDay(date: ISODate) {
  ui.selected = date;
  miniCursor.value = startOfMonth(date);
  const v = doc.settings.calendar.view;
  if ((v === 'month' || v === 'day' || v === 'multiday') && date.slice(0, 7) !== ui.cursor.slice(0, 7)) {
    ui.cursor = startOfMonth(date);
  } else if (v === 'weeks') {
    const ws = ui.weeksStart || defaultWeeksStart();
    const we = addDays(ws, Math.max(2, Math.min(10, doc.settings.calendar.weeksRows)) * 7 - 1);
    if (date < ws || date > we) ui.weeksStart = defaultWeeksStart(date);
  }
}

// ---------------------------------------------------------------- Extended day agenda

const dayItems = computed<Occurrence[]>(() => {
  const d = ui.selected;
  if (!d) return [];
  const show = doc.settings.tasks.showCompleted;
  const list = shownTasks.value.flatMap((t) => occurrences(t, d, d));
  const filtered = show ? list : list.filter((o) => !o.done);
  return filtered.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      Number(a.start === a.end) - Number(b.start === b.end) ||
      (a.task.time ?? '').localeCompare(b.task.time ?? '') ||
      a.task.order - b.task.order,
  );
});

const selectedInfo = computed(() => dayInfo(ui.selected));

function spanMeta(o: Occurrence): string {
  if (o.start === o.end) return '';
  const total = diffDays(o.start, o.end) + 1;
  const cur = diffDays(o.start, ui.selected) + 1;
  return `第 ${cur}/${total} 天`;
}

function groupName(o: Occurrence): string {
  return o.task.groupId ? (doc.groups[o.task.groupId]?.name ?? '') : '';
}

function toggleOcc(o: Occurrence) {
  if (storeState.readOnly) return;
  void setOccurrenceDone(o.task, o.date, !o.done);
}

const quickText = ref('');
const quickInput = ref<HTMLInputElement>();
async function addQuick() {
  const title = quickText.value.trim();
  if (!title || storeState.readOnly) return;
  quickText.value = '';
  await addTask({ title, start: ui.selected });
}
</script>

<template>
  <aside class="sidebar-card" :class="{ dark: isDark }" aria-label="侧边栏日历与当日事项">
    <header class="cal-header">
      <span class="cal-month">{{ focusParts[0] }}年{{ focusParts[1] }}月</span>
      <button class="today-pill" type="button" @click="jumpToday">今天</button>
      <div class="cal-nav">
        <button class="nav-btn" type="button" title="上个月" aria-label="上个月" @click="stepMonth(-1)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9.8 3.6 5.4 8l4.4 4.4" />
          </svg>
        </button>
        <button class="nav-btn" type="button" title="下个月" aria-label="下个月" @click="stepMonth(1)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6.2 3.6 10.6 8l-4.4 4.4" />
          </svg>
        </button>
      </div>
      <button
        v-if="!storeState.readOnly"
        class="add-pill"
        type="button"
        title="新建事项"
        aria-label="新建事项"
        @click="openEditor({ mode: 'new', start: ui.selected })"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true">
          <path d="M8 3.2v9.6M3.2 8h9.6" />
        </svg>
      </button>
    </header>

    <section class="cal-surface">
      <div class="cal-wds" aria-hidden="true">
        <span v-for="(w, i) in weekHeaders" :key="i" class="cal-wd">{{ w }}</span>
      </div>

      <div class="cal-grid" role="grid" aria-label="迷你月历">
        <button
          v-for="d in miniDays"
          :key="d.date"
          type="button"
          class="cal-day"
          :class="{ dim: d.dim, today: d.today, selected: d.selected }"
          :aria-pressed="d.selected"
          :aria-label="`${d.date}${d.count ? `，${d.count} 项事项` : ''}`"
          @click="pickDay(d.date)"
          @dblclick="!storeState.readOnly && openEditor({ mode: 'new', start: d.date })"
        >
          <span v-if="d.cornerKind" class="corner-dot" :class="d.cornerKind" aria-hidden="true" />
          <span class="day-num">{{ d.dayNum }}</span>
          <span v-if="d.singleBadge || d.dots.length" class="day-marks" aria-hidden="true">
            <span
              v-if="d.singleBadge"
              class="emblem"
              :style="{ color: d.singleBadge.color, background: `color-mix(in srgb, ${d.singleBadge.color} 15%, transparent)` }"
            >{{ d.singleBadge.glyph }}</span>
            <template v-else>
              <span v-for="(hex, idx) in d.dots" :key="idx" class="mark-dot" :style="{ background: hex }" />
            </template>
          </span>
        </button>
      </div>

      <div class="cal-legend">
        <div class="legend">
          <span class="leg-item"><i class="leg-dot pending" />待办</span>
          <span class="leg-item"><i class="leg-dot multi" />跨天</span>
        </div>
        <div class="counts">
          <strong>{{ monthStats.total }}</strong> 事项 <span class="slash">/</span> <strong>{{ monthStats.todo }}</strong> 待办
        </div>
      </div>
    </section>

    <div class="cal-footer">
      <div class="foot-actions">
        <button class="foot-btn" type="button" title="更多菜单" aria-label="更多菜单" @click="(e: MouseEvent) => moreMenu(e.currentTarget as HTMLElement)">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="3.5" r="1.05" />
            <circle cx="8" cy="8" r="1.05" />
            <circle cx="8" cy="12.5" r="1.05" />
          </svg>
        </button>
        <span class="v-sep" aria-hidden="true" />
        <button class="foot-btn" type="button" title="搜索事项" aria-label="搜索事项" @click="ui.searchOpen = !ui.searchOpen">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.3" />
            <path d="m10.4 10.4 3.1 3.1" />
          </svg>
        </button>
        <button class="foot-btn" type="button" title="数据与备份" aria-label="数据与备份" @click="openSettings('data')">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 2.5v7.2M5.2 7.2 8 10l2.8-2.8" />
            <path d="M2.6 10.5v2a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-2" />
          </svg>
        </button>
        <button class="foot-btn" type="button" title="外观主题设置" aria-label="外观主题设置" @click="openSettings('appearance')">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 1.8 9.45 6.55 14.2 8 9.45 9.45 8 14.2 6.55 9.45 1.8 8 6.55 6.55Z" />
          </svg>
        </button>
      </div>
      <div class="foot-metric">
        <span class="foot-label">当日事项:</span>
        <strong class="foot-val">{{ dayItems.length }} 项</strong>
      </div>
    </div>

    <section class="ext-section" aria-label="选中日期事项">
      <div class="ext-head">
        <div class="ext-title-wrap">
          <div class="ext-date">{{ formatFriendly(ui.selected) }}</div>
          <div class="ext-sub">
            农历{{ selectedInfo.lunarLabel }}
            <template v-if="selectedInfo.legal?.name"> · {{ selectedInfo.legal.name }}</template>
            <template v-else-if="selectedInfo.festivals.length"> · {{ selectedInfo.festivals[0] }}</template>
          </div>
        </div>
        <button
          v-if="!storeState.readOnly"
          class="tool-btn"
          type="button"
          title="在此日新建事项"
          aria-label="在此日新建事项"
          @click="openEditor({ mode: 'new', start: ui.selected })"
        >
          <FIcon name="add" :size="13" />
        </button>
      </div>

      <div class="ext-list">
        <div
          v-for="item in dayItems"
          :key="`${item.task.id}@${item.date}`"
          class="agenda-item"
          :class="{ done: item.done }"
          role="button"
          tabindex="0"
          @click="openEditor({ mode: 'edit', taskId: item.task.id, date: item.date })"
          @contextmenu.prevent="chipMenu(item, { x: $event.clientX, y: $event.clientY })"
          @keydown.enter="openEditor({ mode: 'edit', taskId: item.task.id, date: item.date })"
        >
          <span class="item-accent" :style="{ background: barHex(item) }" aria-hidden="true" />
          <button
            class="item-check"
            type="button"
            role="checkbox"
            :aria-checked="item.done"
            :aria-label="item.done ? '标记为未完成' : '标记为完成'"
            @click.stop="toggleOcc(item)"
          >
            <svg v-if="item.done" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.2 5 8.5l4.4-4.9" /></svg>
          </button>
          <div class="item-main">
            <div class="item-title">{{ item.task.title }}</div>
            <div v-if="item.task.time || spanMeta(item) || groupName(item) || item.task.repeat" class="item-meta">
              <span v-if="item.task.time" class="meta-time">{{ item.task.time }}</span>
              <span v-if="spanMeta(item)">{{ spanMeta(item) }}</span>
              <span v-if="groupName(item)" class="meta-group">{{ groupName(item) }}</span>
              <FIcon v-if="item.task.repeat" name="repeat" :size="10" class="meta-rep" />
            </div>
          </div>
        </div>

        <div v-if="!dayItems.length" class="ext-empty">
          <span>这一天暂无事项</span>
          <button v-if="!storeState.readOnly" type="button" class="empty-btn" @click="quickInput?.focus()">
            添加事项
          </button>
        </div>
      </div>

      <div v-if="!storeState.readOnly" class="ext-add">
        <div class="add-box">
          <input
            ref="quickInput"
            v-model="quickText"
            placeholder="添加当日事项，回车保存"
            maxlength="200"
            aria-label="添加当日事项"
            @keydown.enter.prevent="addQuick"
          />
          <button class="quick-btn" type="button" title="添加" :disabled="!quickText.trim()" @click="addQuick">
            <FIcon name="add" :size="12" />
          </button>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.sidebar-card {
  container-type: size;
  position: relative;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--desk-radius, 14px);
  --text-glow: none;
  text-shadow: none;
  font-family: var(--font-ui);
  --sb-mono: ui-monospace, 'Cascadia Mono', 'SF Mono', 'JetBrains Mono', Consolas, monospace;

  --sb-shell: #f5f5f7;
  --sb-border: rgba(43, 40, 37, 0.08);
  --sb-cream: #faf8f3;
  --sb-inner-border: rgba(43, 40, 37, 0.085);
  --sb-pill-border: rgba(43, 40, 37, 0.14);
  --sb-today-pill-bg: rgba(255, 255, 255, 0.6);
  --sb-today-pill-hover: #ffffff;
  --sb-divider: rgba(43, 40, 37, 0.075);
  --sb-wd-bg: #f2efe8;
  --sb-tile-bg: #f4f1ea;
  --sb-tile-hover: #ebe7de;
  --sb-dim-bg: #f7f5ef;
  --sb-agenda-border: rgba(43, 40, 37, 0.045);
  --sb-input-bg: #f4f1ea;
  --sb-input-border: rgba(43, 40, 37, 0.075);
  --sb-input-focus-bg: #ffffff;
  --sb-hatch: rgba(60, 52, 42, 0.038);
  --sb-text: #22201d;
  --sb-num: #726d66;
  --sb-text-sub: #8a857e;
  --sb-text-dim: #ada89f;
  --sb-icon: #7d7870;
  --sb-sel-bg: #fceee7;
  --sb-sel-border: #f0b499;
  --sb-sel-text: #d95e32;
  --sb-today-text: #e05524;

  background: var(--sb-shell);
  box-shadow: var(--desk-shadow, 0 1px 3px rgba(43, 40, 37, 0.04));
  color: var(--sb-text);
}

.sidebar-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px var(--desk-stroke, var(--sb-border));
  pointer-events: none;
  z-index: 5;
}

.sidebar-card.dark {
  --sb-shell: #2b2a28;
  --sb-border: rgba(255, 255, 255, 0.09);
  --sb-cream: #1f1e1c;
  --sb-inner-border: rgba(255, 250, 240, 0.09);
  --sb-pill-border: rgba(255, 250, 240, 0.16);
  --sb-today-pill-bg: rgba(255, 250, 240, 0.06);
  --sb-today-pill-hover: rgba(255, 250, 240, 0.12);
  --sb-divider: rgba(255, 255, 255, 0.08);
  --sb-wd-bg: rgba(255, 250, 240, 0.055);
  --sb-tile-bg: rgba(255, 250, 240, 0.045);
  --sb-tile-hover: rgba(255, 250, 240, 0.09);
  --sb-dim-bg: rgba(255, 250, 240, 0.015);
  --sb-agenda-border: rgba(255, 250, 240, 0.06);
  --sb-input-bg: rgba(255, 250, 240, 0.05);
  --sb-input-border: rgba(255, 250, 240, 0.08);
  --sb-input-focus-bg: rgba(255, 250, 240, 0.09);
  --sb-hatch: rgba(255, 250, 240, 0.038);
  --sb-text: #f3f1ec;
  --sb-num: #cbc6be;
  --sb-text-sub: #9a948b;
  --sb-text-dim: #625d55;
  --sb-icon: #a49e95;
  --sb-sel-bg: rgba(249, 99, 44, 0.22);
  --sb-sel-border: rgba(249, 99, 44, 0.58);
  --sb-sel-text: #ff946e;
  --sb-today-text: #ff8a65;
}

/* ---------------------------------------------------------------- Top Header (1:1) */

.cal-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 12px;
  position: relative;
  z-index: 1;
}

.cal-month {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--sb-text);
  white-space: nowrap;
}

.today-pill {
  height: 27px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid var(--sb-pill-border);
  background: var(--sb-today-pill-bg);
  color: var(--sb-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.today-pill:hover {
  background: var(--sb-today-pill-hover);
}

.cal-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
}

.nav-btn {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 0;
  background: transparent;
  color: var(--sb-text-sub);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.nav-btn:hover {
  background: var(--sb-tile-hover);
  color: var(--sb-text);
}

.add-pill {
  margin-left: auto;
  width: 44px;
  height: 28px;
  border-radius: 999px;
  border: 0;
  background: linear-gradient(180deg, #fa6b2b 0%, #f15b1d 100%);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow:
    0 4px 10px rgba(244, 96, 34, 0.34),
    0 1px 2px rgba(244, 96, 34, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: filter var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.add-pill:hover {
  filter: brightness(0.96);
}
.add-pill:active {
  transform: scale(0.95);
}

/* ---------------------------------------------------------------- Flush Nested Calendar Surface (1:1 Cream Card) */

.cal-surface {
  flex: none;
  position: relative;
  z-index: 2;
  margin: 0;
  border-radius: 18px;
  padding: 12px 12px 13px;
  background: var(--sb-cream);
  border: 0;
  box-shadow:
    0 0 0 1px var(--sb-inner-border),
    0 2px 6px rgba(43, 40, 37, 0.045);
}

.cal-wds {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
  margin-bottom: 6px;
}

.cal-wd {
  height: 22px;
  border-radius: 7px;
  background: var(--sb-wd-bg);
  color: var(--sb-text-sub);
  font-family: var(--sb-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
}

.cal-day {
  position: relative;
  aspect-ratio: 1 / 1;
  min-height: 36px;
  padding: 5px 2px 5px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: var(--sb-tile-bg);
  color: var(--sb-num);
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.cal-day:hover {
  background: var(--sb-tile-hover);
}

.cal-day.dim {
  background-color: var(--sb-dim-bg);
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 4px,
    var(--sb-hatch) 4px,
    var(--sb-hatch) 5px
  );
  color: var(--sb-text-dim);
}
.cal-day.dim:hover {
  background-color: var(--sb-tile-bg);
}

.cal-day.today:not(.selected) .day-num {
  color: var(--sb-today-text);
  font-weight: 600;
}

.cal-day.selected {
  background: var(--sb-sel-bg);
  background-image: none;
  border-color: var(--sb-sel-border);
  box-shadow: inset 0 0 0 0.5px rgba(240, 180, 153, 0.25);
  color: var(--sb-sel-text);
}
.cal-day.selected .day-num {
  font-weight: 600;
  color: inherit;
}

.day-num {
  font-family: var(--sb-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.corner-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.corner-dot.pending,
.leg-dot.pending {
  background: #9b6bff;
}
.corner-dot.multi,
.leg-dot.multi {
  background: #f2c94c;
}
.corner-dot.done {
  background: var(--sb-text-dim);
}

.day-marks {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2.5px;
  min-height: 16px;
}

.emblem {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  flex: none;
}

.mark-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  flex: none;
}

.cal-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 14px;
  padding: 0 4px;
  font-family: var(--sb-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--sb-text-sub);
}

.legend {
  display: flex;
  align-items: center;
  gap: 12px;
}
.leg-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.leg-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  display: inline-block;
}
.counts {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.counts strong {
  color: var(--sb-text);
  font-weight: 600;
}
.counts .slash {
  opacity: 0.45;
  margin: 0 2px;
}

/* ---------------------------------------------------------------- Utility Footer Strip (1:1) */

.cal-footer {
  flex: none;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.foot-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--sb-icon);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.foot-btn:hover {
  background: var(--sb-tile-hover);
  color: var(--sb-text);
}

.v-sep {
  width: 1px;
  height: 14px;
  background: var(--sb-divider);
  margin: 0 2px;
  flex: none;
}

.foot-metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--sb-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.foot-label {
  color: var(--sb-text-sub);
}
.foot-val {
  color: var(--sb-text);
  font-weight: 600;
}

/* ---------------------------------------------------------------- Elevated Creamy Lower Agenda Card */

.ext-section {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  background: var(--sb-cream);
  border-top: 0;
  border-radius: 18px 18px 0 0;
  box-shadow:
    0 0 0 1px var(--sb-inner-border),
    0 -1px 5px rgba(43, 40, 37, 0.035);
}

.ext-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 14px 6px;
}

.ext-title-wrap {
  min-width: 0;
  flex: 1;
}

.ext-date {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--sb-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-sub {
  font-size: 10.5px;
  color: var(--sb-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

.tool-btn {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 0;
  background: transparent;
  color: var(--sb-text-sub);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  flex: none;
}
.tool-btn:hover {
  background: var(--sb-tile-hover);
  color: var(--sb-text);
}

.ext-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 10px 8px;
}

.agenda-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 9px 7px 11px;
  border-radius: 10px;
  background: var(--sb-tile-bg);
  border: 1px solid var(--sb-agenda-border);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.agenda-item:hover {
  background: var(--sb-tile-hover);
}
.agenda-item:focus-visible {
  outline: 2px solid var(--accent-fill);
  outline-offset: -2px;
}

.item-accent {
  position: absolute;
  left: 3px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 999px;
}

.item-check {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border-radius: 50%;
  border: 1.5px solid var(--sb-text-sub);
  background: transparent;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.agenda-item.done .item-check {
  border-color: var(--accent-fill);
  background: var(--accent-fill);
}
.item-check svg {
  width: 9px;
  height: 9px;
  fill: none;
  stroke: var(--text-on-accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.item-main {
  min-width: 0;
  flex: 1;
}
.item-title {
  font-size: 12px;
  line-height: 1.35;
  color: var(--sb-text);
  word-break: break-word;
}
.agenda-item.done .item-title {
  text-decoration: line-through;
  opacity: 0.55;
}
.item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--sb-text-sub);
}
.meta-time {
  font-variant-numeric: tabular-nums;
}
.meta-group {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--sb-wd-bg);
}
.meta-rep {
  opacity: 0.75;
}

.ext-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px;
  font-size: 11.5px;
  color: var(--sb-text-sub);
}
.empty-btn {
  border: 1px solid var(--sb-pill-border);
  border-radius: 999px;
  background: var(--sb-tile-bg);
  color: var(--sb-text);
  font: inherit;
  font-size: 11px;
  padding: 3px 11px;
  cursor: pointer;
}
.empty-btn:hover {
  background: var(--sb-tile-hover);
}

.ext-add {
  flex: none;
  padding: 7px 10px 10px;
  border-top: 1px solid var(--sb-divider);
}

.add-box {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 4px 3px 9px;
  border-radius: 10px;
  background: var(--sb-input-bg);
  border: 1px solid var(--sb-input-border);
  transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.add-box:focus-within {
  background: var(--sb-input-focus-bg);
  border-color: var(--sb-pill-border);
}
.add-box input {
  flex: 1;
  min-width: 0;
  height: 24px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--sb-text);
  font: inherit;
  font-size: 12px;
}
.add-box input::placeholder {
  color: var(--sb-text-dim);
}
.quick-btn {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 0;
  background: var(--sb-wd-bg);
  color: var(--sb-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.quick-btn:hover:not(:disabled) {
  background: var(--sb-tile-hover);
}
.quick-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ---------------------------------------------------------------- Adaptive Height Queries */

@container (max-height: 620px) {
  .cal-header {
    padding: 10px 14px 9px;
  }
  .cal-surface {
    padding: 9px 10px 10px;
  }
  .cal-wds,
  .cal-grid {
    gap: 4px;
  }
  .cal-wd {
    height: 19px;
  }
  .cal-day {
    aspect-ratio: auto;
    min-height: 29px;
    padding: 3px 1px 3px;
    border-radius: 7px;
  }
  .day-marks {
    min-height: 12px;
  }
  .emblem {
    width: 13px;
    height: 13px;
    font-size: 8px;
    line-height: 13px;
  }
  .cal-legend {
    margin-top: 9px;
  }
  .cal-footer {
    padding: 7px 12px;
  }
  .ext-head {
    padding: 8px 12px 4px;
  }
}

@container (max-height: 460px) {
  .sidebar-card {
    overflow-y: auto;
  }
  .day-marks {
    display: none;
  }
  .cal-day {
    min-height: 22px;
    justify-content: center;
  }
  .ext-section {
    flex: 1 0 140px;
  }
}
</style>
