<script setup lang="ts">
import { computed, ref } from 'vue';
import { FIcon, taskColor } from '@/fluent';
import type { Task } from '@/types';
import { formatYMD, weekday, WEEKDAY_SHORT } from '@/lib/date';
import { countdowns, customCountdownTasks, describeCustomCountdown, type CountdownItem } from '@/lib/countdown';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { deleteTask, saveTask } from '@/lib/tasks';
import { isDark } from '@/composables/theme';
import { now } from '@/composables/now';
import { doc, patchSettings, taskList } from '@/stores/doc';
import { notify } from '../desk/state';
import CountdownEditorModal from '../desk/CountdownEditorModal.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import { openCountdownContextMenu } from './workspaceMenus';

type FilterKind = 'all' | 'custom' | 'down' | 'up' | 'system';

const filter = ref<FilterKind>('all');
const filterRef = ref<HTMLElement>();
const editorOpen = ref(false);
const editingTask = ref<Task | null>(null);

const customItems = computed(() =>
  customCountdownTasks(taskList.value).map((t) => ({
    task: t,
    meta: describeCustomCountdown(t, now.value),
  })),
);

const systemItems = computed<CountdownItem[]>(() =>
  countdowns(
    [],
    now.value,
    doc.settings.calendar.holidayCountdown,
    false,
    [],
    doc.settings.calendar.countdownFestival,
    doc.settings.calendar.countdownTerm,
  ),
);

const filteredCustom = computed(() => {
  if (filter.value === 'system') return [];
  if (filter.value === 'down') return customItems.value.filter((x) => x.meta.mode === 'down');
  if (filter.value === 'up') return customItems.value.filter((x) => x.meta.mode === 'up');
  return customItems.value;
});

const showSystem = computed(() => filter.value === 'all' || filter.value === 'system');

const heroCustom = computed(() => {
  if (!customItems.value.length) return null;
  const pinned = customItems.value.find((x) => x.task.countdownPinned);
  if (pinned) return pinned;
  return customItems.value.find((x) => !x.meta.expired) ?? customItems.value[0];
});

const heroSystem = computed(() => (!heroCustom.value && systemItems.value.length ? systemItems.value[0] : null));

const filterTabs = computed<{ key: FilterKind; label: string; count: number }[]>(() => [
  { key: 'all', label: '全部', count: customItems.value.length + systemItems.value.length },
  { key: 'custom', label: '自定义', count: customItems.value.length },
  { key: 'down', label: '倒数日', count: customItems.value.filter((x) => x.meta.mode === 'down').length },
  { key: 'up', label: '纪念正数', count: customItems.value.filter((x) => x.meta.mode === 'up').length },
  { key: 'system', label: '节日节气', count: systemItems.value.length },
]);

const { style: filterStyle, ready: filterReady, visible: filterVisible } = useSlidingIndicator(
  filterRef,
  '.fp-btn.active',
  [filter, filterTabs],
);

const sourceToggles = computed(() => [
  {
    key: 'holidayCountdown' as const,
    label: '法定假日',
    on: doc.settings.calendar.holidayCountdown,
  },
  {
    key: 'countdownFestival' as const,
    label: '传统节日',
    on: doc.settings.calendar.countdownFestival,
  },
  {
    key: 'countdownTerm' as const,
    label: '二十四节气',
    on: doc.settings.calendar.countdownTerm,
  },
  {
    key: 'countdownMarked' as const,
    label: '同步底部栏',
    on: doc.settings.calendar.countdownMarked,
  },
]);

function toggleSource(key: 'holidayCountdown' | 'countdownFestival' | 'countdownTerm' | 'countdownMarked', current: boolean) {
  patchSettings({ calendar: { [key]: !current } });
}

function openCreate() {
  editingTask.value = null;
  editorOpen.value = true;
}

function openEdit(t: Task) {
  editingTask.value = t;
  editorOpen.value = true;
}

function openCountdownMenu(t: Task, e: MouseEvent) {
  void openCountdownContextMenu(t, { x: e.clientX, y: e.clientY }, { onEdit: () => openEdit(t) });
}

function togglePin(t: Task) {
  void saveTask({ ...t, countdownPinned: !t.countdownPinned || undefined });
}

async function removeCustom(t: Task) {
  await deleteTask(t.id);
  notify(`已删除倒数日“${t.title}”`, true);
}

function hexOf(t: Task): string {
  return t.color ? taskColor(t.color, isDark.value).bar : isDark.value ? '#EAEAEF' : '#1C1B19';
}

function dateSubtitle(iso: string): string {
  const wd = WEEKDAY_SHORT[weekday(iso)];
  const info = dayInfo(iso);
  return `${formatYMD(iso)} 周${wd} · 农历${info.lunarLabel}`;
}

function dayPhrase(days: number, mode: 'down' | 'up', expired: boolean): { prefix: string; num: string; unit: string } {
  if (mode === 'up') {
    return days === 0 ? { prefix: '起始日', num: '今天', unit: '' } : { prefix: '已经过去', num: String(days), unit: '天' };
  }
  if (expired) {
    return { prefix: '已过期', num: String(days), unit: '天' };
  }
  if (days === 0) return { prefix: '', num: '就是今天', unit: '' };
  return { prefix: '距离还有', num: String(days), unit: '天' };
}
</script>

<template>
  <div class="ws-scroll-page">
    <div class="ws-container cd-page">
      <!-- Editorial Header -->
      <header class="cd-page-head">
        <div>
          <h1 class="ws-page-title">倒数日</h1>
          <p class="ws-page-sub">{{ customItems.length }} 个自定义倒数与纪念日 · {{ systemItems.length }} 个近期节日节气</p>
        </div>
        <button type="button" class="ws-cta-btn" @click="openCreate">
          <FIcon name="add" :size="13" />
          <span>新建倒数日</span>
        </button>
      </header>

      <!-- Hero Spotlight Card -->
      <section
        v-if="heroCustom"
        class="ws-card cd-hero"
        :style="{ '--hero-accent': hexOf(heroCustom.task) }"
        @contextmenu.prevent="openCountdownMenu(heroCustom.task, $event)"
      >
        <span class="cd-hero-bar" aria-hidden="true" />
        <div class="cd-hero-main">
          <div class="cd-hero-badges">
            <span v-if="heroCustom.task.countdownPinned" class="cd-pill dark">
              <FIcon name="pin" :size="10" />
              <span>已置顶</span>
            </span>
            <span class="cd-pill">{{ heroCustom.meta.mode === 'up' ? '纪念正数日' : '目标倒数日' }}</span>
            <span v-if="heroCustom.task.repeat?.freq === 'yearly'" class="cd-pill">每年公历</span>
            <span v-else-if="heroCustom.task.repeat?.freq === 'lunarYearly'" class="cd-pill">每年农历</span>
          </div>
          <h2 class="cd-hero-title">{{ heroCustom.task.title }}</h2>
          <div class="cd-hero-date">{{ dateSubtitle(heroCustom.meta.nextDate) }}</div>
          <p v-if="heroCustom.task.notes" class="cd-hero-notes">{{ heroCustom.task.notes }}</p>
        </div>

        <div class="cd-hero-right">
          <div class="cd-hero-counter">
            <span v-if="dayPhrase(heroCustom.meta.days, heroCustom.meta.mode, heroCustom.meta.expired).prefix" class="ch-prefix">
              {{ dayPhrase(heroCustom.meta.days, heroCustom.meta.mode, heroCustom.meta.expired).prefix }}
            </span>
            <div class="ch-num-row">
              <span class="ch-num">{{ dayPhrase(heroCustom.meta.days, heroCustom.meta.mode, heroCustom.meta.expired).num }}</span>
              <span v-if="dayPhrase(heroCustom.meta.days, heroCustom.meta.mode, heroCustom.meta.expired).unit" class="ch-unit">
                {{ dayPhrase(heroCustom.meta.days, heroCustom.meta.mode, heroCustom.meta.expired).unit }}
              </span>
            </div>
          </div>
          <div class="cd-hero-actions">
            <button type="button" class="cd-act-pill" @click="togglePin(heroCustom.task)">
              <FIcon :name="heroCustom.task.countdownPinned ? 'unpin' : 'pin'" :size="11" />
              <span>{{ heroCustom.task.countdownPinned ? '取消置顶' : '置顶' }}</span>
            </button>
            <button type="button" class="cd-act-pill" @click="openEdit(heroCustom.task)">
              <FIcon name="edit" :size="11" />
              <span>编辑</span>
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="heroSystem" class="ws-card cd-hero system" style="--hero-accent: var(--ws-ink)">
        <span class="cd-hero-bar" aria-hidden="true" />
        <div class="cd-hero-main">
          <div class="cd-hero-badges">
            <span class="cd-pill">近期节日</span>
          </div>
          <h2 class="cd-hero-title">{{ heroSystem.label }}</h2>
          <div class="cd-hero-date">{{ dateSubtitle(heroSystem.date) }}</div>
        </div>
        <div class="cd-hero-right">
          <div class="cd-hero-counter">
            <span class="ch-prefix">{{ heroSystem.days === 0 ? '' : '距离还有' }}</span>
            <div class="ch-num-row">
              <span class="ch-num">{{ heroSystem.days === 0 ? '就是今天' : heroSystem.days }}</span>
              <span v-if="heroSystem.days > 0" class="ch-unit">天</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Filter Pills + Calendar Bottom Bar Source Toggles -->
      <div class="cd-toolbar">
        <div ref="filterRef" class="cd-filter-pills" role="tablist" aria-label="倒数日分类">
          <span
            v-if="filterVisible"
            class="ws-slide-pill fp-pill-bg"
            :class="{ 'no-anim': !filterReady }"
            :style="filterStyle"
            aria-hidden="true"
          />
          <button
            v-for="tab in filterTabs"
            :key="tab.key"
            type="button"
            class="fp-btn"
            :class="{ active: filter === tab.key }"
            @click="filter = tab.key"
          >
            <span>{{ tab.label }}</span>
            <span class="fp-num">{{ tab.count }}</span>
          </button>
        </div>

        <div class="cd-sources">
          <button
            v-for="s in sourceToggles"
            :key="s.key"
            type="button"
            class="src-chip"
            :class="{ on: s.on }"
            @click="toggleSource(s.key, s.on)"
          >
            <span class="src-dot" />
            <span>{{ s.label }}</span>
          </button>
        </div>
      </div>

      <!-- Custom Countdowns Card Grid -->
      <div v-if="filteredCustom.length" class="cd-grid">
        <div
          v-for="{ task, meta } in filteredCustom"
          :key="task.id"
          class="ws-card cd-card"
          @click="openEdit(task)"
          @contextmenu.prevent="openCountdownMenu(task, $event)"
        >
          <div class="cdc-top">
            <span class="cdc-dot" :style="{ background: hexOf(task) }" />
            <span class="cdc-title">{{ task.title }}</span>
            <div class="cdc-hover-acts" @click.stop>
              <button
                type="button"
                class="ws-icon-circle cdc-ico-btn"
                :title="task.countdownPinned ? '取消置顶' : '置顶'"
                @click="togglePin(task)"
              >
                <FIcon :name="task.countdownPinned ? 'unpin' : 'pin'" :size="11" />
              </button>
              <button type="button" class="ws-icon-circle cdc-ico-btn" title="删除" @click="removeCustom(task)">
                <FIcon name="delete" :size="11" />
              </button>
            </div>
          </div>

          <div class="cdc-mid">
            <div class="cdc-count" :class="{ up: meta.mode === 'up', expired: meta.expired }">
              <span v-if="dayPhrase(meta.days, meta.mode, meta.expired).prefix" class="cdc-pre">
                {{ dayPhrase(meta.days, meta.mode, meta.expired).prefix }}
              </span>
              <strong class="cdc-num">{{ dayPhrase(meta.days, meta.mode, meta.expired).num }}</strong>
              <span v-if="dayPhrase(meta.days, meta.mode, meta.expired).unit" class="cdc-unit">
                {{ dayPhrase(meta.days, meta.mode, meta.expired).unit }}
              </span>
            </div>
          </div>

          <div class="cdc-foot">
            <span class="cdc-date">{{ dateSubtitle(meta.nextDate) }}</span>
            <div class="cdc-tags">
              <span v-if="task.countdownPinned" class="cdc-tag pin">置顶</span>
              <span v-if="task.repeat?.freq === 'yearly'" class="cdc-tag">每年公历</span>
              <span v-else-if="task.repeat?.freq === 'lunarYearly'" class="cdc-tag">每年农历</span>
              <span v-if="!task.countdownOnly" class="cdc-tag">联动日历</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty CTA when user has no custom items under Custom filter -->
      <div v-else-if="filter !== 'system'" class="ws-card cd-empty">
        <div class="cde-title">还没有自定义倒数日</div>
        <div class="cde-sub">点击右上角“新建倒数日”记录考试、旅行、纪念日或重要截点，支持公历与农历每年自动重复。</div>
        <button type="button" class="ws-cta-btn" @click="openCreate">
          <FIcon name="add" :size="13" />
          <span>添加第一个倒数日</span>
        </button>
      </div>

      <!-- System Holidays / Festivals / Solar Terms Section -->
      <section v-if="showSystem && systemItems.length" class="sys-section">
        <h2 class="sys-head">近期节日与节气 ({{ systemItems.length }})</h2>
        <div class="sys-grid">
          <div v-for="c in systemItems.slice(0, 18)" :key="c.key" class="sys-card">
            <div class="sys-top">
              <span class="sys-name">{{ c.label }}</span>
              <span class="sys-days">{{ c.days === 0 ? '今天' : `${c.days} 天` }}</span>
            </div>
            <div class="sys-date">{{ dateSubtitle(c.date) }}</div>
          </div>
        </div>
      </section>
    </div>

    <CountdownEditorModal :open="editorOpen" :task="editingTask" @close="editorOpen = false" />
  </div>
</template>

<style scoped>
.cd-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}

.cd-page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.cd-hero {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 22px 20px 26px;
  border-radius: 18px;
  overflow: hidden;
}

.cd-hero-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  background: var(--hero-accent, #1c1b19);
}

.cd-hero-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cd-hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cd-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font-size: 11px;
  font-weight: 600;
}

.cd-pill.dark {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.cd-hero-title {
  margin: 2px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ws-ink);
}

.cd-hero-date {
  font-size: 13px;
  color: var(--ws-ink-secondary);
}

.cd-hero-notes {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ws-ink-secondary);
  max-width: 540px;
}

.cd-hero-right {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.cd-hero-counter {
  text-align: right;
}

.ch-prefix {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
  font-weight: 550;
}

.ch-num-row {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4px;
}

.ch-num {
  font-family: var(--font-display);
  font-size: 38px;
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--ws-ink);
}

.ch-unit {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
}

.cd-hero-actions {
  display: flex;
  gap: 6px;
}

.cd-act-pill {
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
  cursor: pointer;
}

.cd-act-pill:hover {
  background: var(--ws-card-hover);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.cd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.cd-filter-pills {
  position: relative;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 4px;
  border-radius: 16px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
}

.fp-pill-bg {
  border-radius: 999px;
  background: var(--ws-ink);
  box-shadow: var(--ws-shadow-sm);
}

.fp-btn {
  position: relative;
  z-index: 1;
  height: 29px;
  padding: 0 11px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 140ms ease, color 160ms var(--ws-ease-out);
}

.fp-btn:hover:not(.active) {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.fp-btn.active {
  color: var(--ws-ink-inverse);
}

.fp-num {
  font-size: 11px;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}

.cd-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.src-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease, border-color 130ms ease;
}

.src-chip.on {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.src-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ws-hairline-strong);
}

.src-chip.on .src-dot {
  background: var(--ws-success);
}

.cd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.cd-card {
  padding: 15px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  transition: border-color 140ms ease, box-shadow 160ms ease, transform 160ms var(--ws-ease-out);
}

.cd-card:hover {
  border-color: var(--ws-hairline-strong);
  box-shadow: var(--ws-shadow-md);
  transform: translateY(-1px);
}

.cdc-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cdc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.cdc-title {
  flex: 1;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 650;
  color: var(--ws-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cdc-hover-acts {
  display: inline-flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 130ms ease;
}

.cd-card:hover .cdc-hover-acts {
  opacity: 1;
}

.cdc-ico-btn {
  width: 24px;
  height: 24px;
}

.cdc-mid {
  display: flex;
  align-items: baseline;
}

.cdc-count {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--ws-ink);
}

.cdc-count.up {
  color: var(--ws-success);
}

.cdc-count.expired {
  color: var(--ws-danger);
}

.cdc-pre,
.cdc-unit {
  font-size: 12px;
  font-weight: 550;
  color: var(--ws-ink-secondary);
}

.cdc-num {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
}

.cdc-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cdc-date {
  font-size: 12px;
  color: var(--ws-ink-muted);
}

.cdc-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cdc-tag {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
}

.cdc-tag.pin {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.cd-empty {
  padding: 36px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
}

.cde-title {
  font-size: 15px;
  font-weight: 650;
}

.cde-sub {
  font-size: 12.5px;
  color: var(--ws-ink-secondary);
  max-width: 440px;
}

.sys-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}

.sys-head {
  margin: 0 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
}

.sys-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 8px;
}

.sys-card {
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--ws-sidebar-bg);
  border: 1px solid var(--ws-hairline);
}

.sys-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.sys-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ws-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sys-days {
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ws-ink);
  flex: none;
}

.sys-date {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

@media (max-width: 639px) {
  .cd-page-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .cd-hero {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    padding: 16px 16px 16px 20px;
  }

  .cd-hero-title {
    font-size: 20px;
  }

  .cd-hero-right {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
  }

  .cd-hero-counter {
    text-align: left;
  }

  .ch-num-row {
    justify-content: flex-start;
  }

  .ch-num {
    font-size: 32px;
  }

  .cd-filter-pills {
    width: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    box-sizing: border-box;
  }

  .cd-filter-pills::-webkit-scrollbar {
    display: none;
  }

  .fp-btn {
    flex: none;
  }

  .cd-grid {
    grid-template-columns: 1fr;
  }

  .sys-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (hover: none) {
  .cdc-hover-acts {
    opacity: 1;
  }
}
</style>
