<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FIcon } from '@/fluent';
import type {
  ISODate,
  SubscriptionCategory,
  SubscriptionCycle,
  SubscriptionMeta,
  Task,
} from '@/types';
import { addMonths, daysInMonth, parts, startOfMonth, weekday, WEEKDAY_SHORT, ymd } from '@/lib/date';
import {
  buildCategoryBreakdown,
  CATEGORY_META,
  CYCLE_META,
  effectiveSplit,
  formatCurrencyAmount,
  formatDueCountdown,
  formatShortDueDate,
  isSubscriptionTask,
  monthNameEnglish,
  resolveSubscription,
  sampleSubscriptionPayloads,
  STATUS_LABELS,
  SUBSCRIPTION_CATEGORIES,
  summarizeMonthBilling,
  type ResolvedSubscription,
} from '@/lib/subscriptions';
import { addTask, deleteTask, saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { doc, taskList } from '@/stores/doc';
import SubscriptionEditorModal from './SubscriptionEditorModal.vue';
import { useSlidingIndicator } from './useSlidingIndicator';

type SubViewMode = 'insights' | 'master';

const { isPhone } = useViewport();

const subView = ref<SubViewMode>('insights');
const period = ref<'month' | 'year'>('month');
const calCursor = ref<ISODate>(startOfMonth(now.value));
const focusCategory = ref<SubscriptionCategory | null>(null);
const hoveredDayHint = ref('');

// Staggered gradient deck rotation offset
const deckOffset = ref(0);

// Master-detail state
const selectedId = ref<string>('');
const searchText = ref('');
const masterCat = ref<SubscriptionCategory | 'all'>('all');
const masterPay = ref<'all' | 'auto' | 'manual'>('all');
const masterCycle = ref<SubscriptionCycle | 'all'>('all');

// Editor modal state
const editorOpen = ref(false);
const editingTask = ref<(Task & { subscription: SubscriptionMeta }) | null>(null);
const editorDefaultDate = ref<ISODate>(now.value);

// Sliding indicators
const viewSegRef = ref<HTMLElement>();
const { style: viewPillStyle, ready: viewPillReady, visible: viewPillVisible } = useSlidingIndicator(
  viewSegRef,
  '.sv-seg-btn.active',
  [subView],
);

const allSubscriptions = computed<ResolvedSubscription[]>(() =>
  taskList.value
    .filter(isSubscriptionTask)
    .map((t) => resolveSubscription(t, now.value))
    .sort((a, b) => a.window.remainDays - b.window.remainDays || b.monthlyCNY - a.monthlyCNY),
);

const activeSubscriptions = computed(() =>
  allSubscriptions.value.filter((s) => s.meta.status === 'active' || s.meta.status === 'trial'),
);

watch(
  allSubscriptions,
  (list) => {
    if (!list.length) {
      selectedId.value = '';
      return;
    }
    if (!selectedId.value || !list.some((s) => s.task.id === selectedId.value)) {
      selectedId.value = list[0].task.id;
    }
  },
  { immediate: true },
);

// Totals & KPIs
const totalMonthlyCNY = computed(() =>
  activeSubscriptions.value.reduce((sum, s) => sum + s.monthlyCNY, 0),
);

const totalYearlyCNY = computed(() =>
  activeSubscriptions.value.reduce((sum, s) => sum + s.yearlyCNY, 0),
);

const totalSplitSavedMonthlyCNY = computed(() =>
  activeSubscriptions.value.reduce((sum, s) => sum + s.monthlySavedCNY, 0),
);

const cursorYear = computed(() => parts(calCursor.value)[0]);
const cursorMonth = computed(() => parts(calCursor.value)[1]);

const monthSummary = computed(() =>
  summarizeMonthBilling(allSubscriptions.value, cursorYear.value, cursorMonth.value, now.value),
);

const heroWatermarkText = computed(() =>
  period.value === 'month' ? monthNameEnglish(cursorMonth.value) : `${cursorYear.value} YEAR`,
);

const heroDisplayAmount = computed(() => {
  const val = period.value === 'month' ? totalMonthlyCNY.value : totalYearlyCNY.value;
  return Math.round(val).toLocaleString('zh-CN');
});

const heroSubDisplayDecimals = computed(() => {
  const val = period.value === 'month' ? totalMonthlyCNY.value : totalYearlyCNY.value;
  const dec = Math.round((val - Math.floor(val)) * 100);
  return dec > 0 ? `.${String(dec).padStart(2, '0')}` : '';
});

// Category Treemap Slices
const categorySlices = computed(() => buildCategoryBreakdown(allSubscriptions.value, period.value));
const primarySlice = computed(() => categorySlices.value[0] ?? null);
const secondarySlices = computed(() => categorySlices.value.slice(1, 5));

// Staggered Gradient Deck Cards (up to 3 upcoming active/trial subscriptions)
const deckCards = computed(() => activeSubscriptions.value.slice(0, 3));

function cardDeckPosition(idx: number): number {
  const len = deckCards.value.length;
  if (len <= 1) return 0;
  return (idx - (deckOffset.value % len) + len) % len;
}

function flipDeck() {
  if (deckCards.value.length <= 1) return;
  deckOffset.value = (deckOffset.value + 1) % deckCards.value.length;
}

function cardGradientBg(hex: string): string {
  return `linear-gradient(122deg, ${hex} 0%, color-mix(in srgb, ${hex} 72%, #ffffff) 100%)`;
}

// Pure-Icon Calendar Grid for (cursorYear, cursorMonth)
const weekStart = computed<0 | 1>(() => doc.settings.calendar.weekStart);

const weekdayLabels = computed(() =>
  Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart.value + i) % 7]),
);

const calendarCells = computed(() => {
  const y = cursorYear.value;
  const m = cursorMonth.value;
  const firstIso = ymd(y, m, 1);
  const offset = (weekday(firstIso) - weekStart.value + 7) % 7;
  const totalDays = daysInMonth(y, m);
  const cells: Array<{
    key: string;
    day: number | null;
    iso: ISODate | null;
    items: ResolvedSubscription[];
    filteredItems: ResolvedSubscription[];
    dimmed: boolean;
    isToday: boolean;
  }> = [];

  for (let i = 0; i < offset; i++) {
    cells.push({
      key: `pad-${i}`,
      day: null,
      iso: null,
      items: [],
      filteredItems: [],
      dimmed: false,
      isToday: false,
    });
  }

  for (let d = 1; d <= totalDays; d++) {
    const iso = ymd(y, m, d);
    const items = monthSummary.value.byDay[d] ?? [];
    const filteredItems = focusCategory.value
      ? items.filter((s) => s.meta.category === focusCategory.value)
      : items;
    cells.push({
      key: iso,
      day: d,
      iso,
      items,
      filteredItems,
      dimmed: !!focusCategory.value && items.length > 0 && filteredItems.length === 0,
      isToday: iso === now.value,
    });
  }
  return cells;
});

function stepCalMonth(delta: number) {
  calCursor.value = startOfMonth(addMonths(calCursor.value, delta));
  hoveredDayHint.value = '';
}

function jumpCalToday() {
  calCursor.value = startOfMonth(now.value);
}

function toggleFocusCat(cat: SubscriptionCategory) {
  focusCategory.value = focusCategory.value === cat ? null : cat;
}

function onCalendarCellClick(cell: (typeof calendarCells.value)[number]) {
  if (!cell.iso) return;
  const target = cell.filteredItems[0] ?? cell.items[0];
  if (target) {
    selectedId.value = target.task.id;
    subView.value = 'master';
  } else {
    openCreateModal(cell.iso);
  }
}

function onCalendarCellHover(cell: (typeof calendarCells.value)[number]) {
  const list = cell.filteredItems.length ? cell.filteredItems : cell.items;
  if (!list.length || !cell.day) {
    hoveredDayHint.value = '';
    return;
  }
  const names = list
    .map((s) => `${s.task.title} ${formatCurrencyAmount(s.personalOrig, s.meta.currency)}`)
    .join(' · ');
  hoveredDayHint.value = `${cursorMonth.value}月${cell.day}日 · ${names}`;
}

// Master-Detail Filtering
const masterFilteredList = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return allSubscriptions.value.filter((s) => {
    if (masterCat.value !== 'all' && s.meta.category !== masterCat.value) return false;
    if (masterPay.value === 'auto' && !s.meta.autoRenew) return false;
    if (masterPay.value === 'manual' && s.meta.autoRenew && s.meta.status !== 'trial') return false;
    if (masterCycle.value !== 'all' && s.meta.cycle !== masterCycle.value) return false;
    if (
      q &&
      !s.task.title.toLowerCase().includes(q) &&
      !(s.meta.paymentMethod ?? '').toLowerCase().includes(q) &&
      !CATEGORY_META[s.meta.category].label.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
});

const selectedSub = computed<ResolvedSubscription | null>(() => {
  if (!allSubscriptions.value.length) return null;
  return allSubscriptions.value.find((s) => s.task.id === selectedId.value) ?? allSubscriptions.value[0];
});

// Cadence 22-bar vertical-pill countdown scale
const GAUGE_BARS = 22;
const detailGaugeBars = computed(() => {
  const s = selectedSub.value;
  if (!s) return [];
  const ratio = s.window.remainDays / Math.max(1, s.window.totalDays);
  const remainBars = Math.max(1, Math.min(GAUGE_BARS, Math.round(ratio * GAUGE_BARS)));
  const elapsedBars = GAUGE_BARS - remainBars;
  return Array.from({ length: GAUGE_BARS }, (_, i) => ({
    idx: i,
    remain: i >= elapsedBars,
  }));
});

function openCreateModal(date?: ISODate) {
  editingTask.value = null;
  editorDefaultDate.value = date || now.value;
  editorOpen.value = true;
}

function openEditModal(sub: ResolvedSubscription) {
  editingTask.value = sub.task;
  editorDefaultDate.value = sub.task.start;
  editorOpen.value = true;
}

function openDetailFor(sub: ResolvedSubscription) {
  selectedId.value = sub.task.id;
  subView.value = 'master';
}

async function togglePauseSub(sub: ResolvedSubscription) {
  const nextStatus = sub.meta.status === 'paused' ? 'active' : 'paused';
  await saveTask({
    ...sub.task,
    subscription: { ...sub.meta, status: nextStatus },
  });
}

async function removeSub(sub: ResolvedSubscription) {
  await deleteTask(sub.task.id);
}

async function seedSampleSubscriptions() {
  const payloads = sampleSubscriptionPayloads(now.value);
  for (const p of payloads) {
    await addTask(p);
  }
}

function onEditorSaved(id?: string) {
  if (id) selectedId.value = id;
}

function miniDotsFor(sub: ResolvedSubscription): boolean[] {
  const ratio = sub.window.remainDays / Math.max(1, sub.window.totalDays);
  const lit = Math.max(1, Math.min(5, Math.round(ratio * 5)));
  return Array.from({ length: 5 }, (_, i) => i < lit);
}
</script>

<template>
  <div class="sub-page" :class="{ phone: isPhone }">
    <!-- Editorial Top Header Strip -->
    <header class="sv-head">
      <div class="sv-head-left">
        <div class="sv-eyebrow">订阅日历 · {{ cursorYear }}年{{ cursorMonth }}月</div>
        <h1 class="sv-title">{{ subView === 'insights' ? '数据洞察' : '清单与详情' }}</h1>
      </div>

      <div class="sv-head-right">
        <!-- Sliding Insights / Master-Detail Switcher -->
        <div ref="viewSegRef" class="sv-seg" role="tablist" aria-label="订阅视图切换">
          <span
            v-if="viewPillVisible"
            class="ws-slide-pill sv-seg-pill"
            :class="{ 'no-anim': !viewPillReady }"
            :style="viewPillStyle"
            aria-hidden="true"
          />
          <button
            type="button"
            role="tab"
            :aria-selected="subView === 'insights'"
            class="sv-seg-btn"
            :class="{ active: subView === 'insights' }"
            @click="subView = 'insights'"
          >
            数据洞察
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="subView === 'master'"
            class="sv-seg-btn"
            :class="{ active: subView === 'master' }"
            @click="subView = 'master'"
          >
            清单与详情
          </button>
        </div>

        <!-- Month / Year Toggle -->
        <div v-if="subView === 'insights'" class="sv-period-seg" role="radiogroup" aria-label="统计周期">
          <button
            type="button"
            class="sv-per-btn"
            :class="{ active: period === 'month' }"
            @click="period = 'month'"
          >
            月
          </button>
          <button
            type="button"
            class="sv-per-btn"
            :class="{ active: period === 'year' }"
            @click="period = 'year'"
          >
            年
          </button>
        </div>

        <button type="button" class="sv-add-btn" @click="openCreateModal()">
          <FIcon name="add" :size="14" />
          <span>添加订阅</span>
        </button>
      </div>
    </header>

    <!-- First-Run Inviting Empty State -->
    <div v-if="!allSubscriptions.length" class="sv-empty-stage">
      <div class="wm-card sv-empty-card tone-hero">
        <span class="wm-text sv-empty-wm" aria-hidden="true">SUBSCRIPTIONS</span>
        <div class="tilted-emblem sv-empty-emblem">
          <FIcon name="subscription" :size="28" />
        </div>
        <div class="sv-empty-copy">
          <h2>把所有会员、云服务与自动续费收进同一张日历</h2>
          <p>
            支持多币种自动折算人民币、家庭组拼车平摊、试用期到期护盾、纯图标扣费月历与周期竖条刻度倒计时。数据与电脑/网页/手机自动云同步。
          </p>
          <div class="sv-empty-acts">
            <button type="button" class="sv-btn-solid" @click="openCreateModal()">
              <FIcon name="add" :size="14" />
              <span>添加第一条订阅</span>
            </button>
            <button type="button" class="sv-btn-soft" @click="seedSampleSubscriptions">
              <FIcon name="sparkles" :size="14" />
              <span>一键导入 7 项示例体验</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== VIEW 1: 数据洞察 ==================== -->
    <div v-else-if="subView === 'insights'" class="sv-scroll">
      <div class="sv-insights-grid">
        <!-- LEFT COLUMN: Watermark Editorial Spend Hero + Watermark Proportional Treemap -->
        <div class="sv-col-left">
          <!-- HERO SPEND CARD (Monochrome Pastel + Oversized Watermark + -6deg Emblem + Thick Progress Track) -->
          <section class="wm-card sv-hero-card tone-hero">
            <span class="wm-text sv-hero-wm" aria-hidden="true">{{ heroWatermarkText }}</span>

            <div class="tilted-emblem sv-hero-emblem" aria-hidden="true">
              <span class="she-mon">{{ monthNameEnglish(cursorMonth).slice(0, 3) }}</span>
              <strong class="she-day">{{ parts(now)[2] }}</strong>
            </div>

            <div class="sv-hero-body">
              <div class="sv-hero-top">
                <div class="sv-hero-meta-col">
                  <div class="sv-hero-label">{{ period === 'month' ? '月均订阅实付' : '全年订阅实付' }}</div>
                  <div class="sv-hero-sub">
                    <span>折合 CNY · {{ activeSubscriptions.length }} 项生效</span>
                    <span v-if="totalSplitSavedMonthlyCNY >= 1" class="sv-save-pill">
                      拼车已省 ¥{{ Math.round(totalSplitSavedMonthlyCNY) }}/月
                    </span>
                  </div>
                </div>
                <div class="sv-hero-amount tabular">
                  ¥{{ heroDisplayAmount }}<small v-if="heroSubDisplayDecimals">{{ heroSubDisplayDecimals }}</small>
                </div>
              </div>

              <!-- Thick Monochrome Pill Progress Track -->
              <div class="sv-hero-progress">
                <div class="sv-hp-labels tabular">
                  <span>{{ cursorMonth }}月已扣进度 {{ monthSummary.billedProgressPct }}%</span>
                  <span>本月待扣 ¥{{ Math.round(monthSummary.remainingMonthCNY) }}</span>
                </div>
                <div class="sv-thick-track">
                  <div class="sv-thick-fill" :style="{ width: `${monthSummary.billedProgressPct}%` }" />
                </div>
              </div>
            </div>
          </section>

          <!-- Treemap Header -->
          <div class="sv-sec-row">
            <span class="sv-sec-hint">分类支出树图 · 点击卡片聚光右侧月历</span>
            <button
              v-if="focusCategory"
              type="button"
              class="sv-reset-link"
              @click="focusCategory = null"
            >
              显示全部分类
            </button>
          </div>

          <!-- PROPORTIONAL WATERMARK CATEGORY TREEMAP -->
          <div class="sv-treemap" :class="{ single: secondarySlices.length === 0 }">
            <!-- Primary Dominant Category Tile -->
            <button
              v-if="primarySlice"
              type="button"
              class="wm-card tm-tile tm-primary"
              :class="[primarySlice.toneClass, { active: focusCategory === primarySlice.category }]"
              @click="toggleFocusCat(primarySlice.category)"
            >
              <span class="wm-text tm-wm-lg" aria-hidden="true">{{ primarySlice.watermark }}</span>
              <div class="tm-top">
                <span class="tm-name">{{ primarySlice.label }}</span>
                <span class="tm-sub tabular">{{ primarySlice.count }} 项 · {{ primarySlice.percent }}%</span>
              </div>
              <div class="tm-bottom">
                <div class="tm-price tabular">¥{{ Math.round(primarySlice.amountCNY).toLocaleString('zh-CN') }}</div>
                <div class="tm-bar-track">
                  <div class="tm-bar-fill" :style="{ width: `${Math.max(8, primarySlice.percent)}%` }" />
                </div>
              </div>
            </button>

            <!-- Secondary Stacked Proportional Category Tiles -->
            <div v-if="secondarySlices.length" class="tm-stack">
              <button
                v-for="sl in secondarySlices"
                :key="sl.category"
                type="button"
                class="wm-card tm-tile tm-sub-tile"
                :class="[sl.toneClass, { active: focusCategory === sl.category }]"
                :style="{ flex: `${Math.max(0.75, Math.min(2.2, (sl.percent / 20)))}` }"
                @click="toggleFocusCat(sl.category)"
              >
                <span class="wm-text tm-wm-sm" aria-hidden="true">{{ sl.watermark }}</span>
                <div class="tm-top">
                  <span class="tm-name">{{ sl.label }}</span>
                  <span class="tm-sub tabular">{{ sl.count }} 项 · {{ sl.percent }}%</span>
                </div>
                <div class="tm-bottom-inline">
                  <span class="tm-price-sm tabular">¥{{ Math.round(sl.amountCNY).toLocaleString('zh-CN') }}</span>
                  <span class="tm-pct-tag tabular">{{ sl.percent }}%</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: RESTORED Staggered Gradient Membership Deck + Pure-Icon Visual Billing Calendar -->
        <div class="sv-col-right">
          <!-- RESTORED STAGGERED GRADIENT MEMBERSHIP DECK (Image 1 Signature + Watermark Typography!) -->
          <section class="sv-deck-panel">
            <div class="sv-deck-head">
              <div class="sv-deck-title-group">
                <span class="sv-deck-title">即将扣款</span>
                <span class="sv-deck-badge">{{ deckCards.length }} 张叠卡 · 点击翻牌</span>
              </div>
              <div class="sv-deck-actions">
                <button
                  v-if="deckCards.length > 1"
                  type="button"
                  class="sv-mini-pill"
                  @click="flipDeck"
                >
                  下一张 →
                </button>
                <button
                  v-if="deckCards[0]"
                  type="button"
                  class="sv-mini-pill"
                  @click="openDetailFor(deckCards[deckOffset % deckCards.length] ?? deckCards[0])"
                >
                  查看详情
                </button>
              </div>
            </div>

            <div class="stagger-deck" @click="flipDeck">
              <article
                v-for="(sub, idx) in deckCards"
                :key="sub.task.id"
                class="stagger-card"
                :data-pos="cardDeckPosition(idx)"
                :style="{ background: cardGradientBg(sub.brandColor) }"
                @dblclick.stop="openDetailFor(sub)"
              >
                <span class="stagger-wm" aria-hidden="true">{{ sub.watermark }}</span>

                <div class="sc-top">
                  <div class="sc-brand">
                    <span class="sc-emblem">{{ sub.emblem }}</span>
                    <div class="sc-brand-copy">
                      <div class="sc-name">{{ sub.task.title }}</div>
                      <div class="sc-cycle">
                        {{ CYCLE_META[sub.meta.cycle].label }}
                        <template v-if="effectiveSplit(sub.meta) > 1"> · {{ effectiveSplit(sub.meta) }}人拼车</template>
                        <template v-else-if="sub.meta.status === 'trial'"> · 试用护盾</template>
                        <template v-else> · {{ sub.meta.autoRenew ? '自动续费' : '主动付款' }}</template>
                      </div>
                    </div>
                  </div>
                  <span class="sc-due-pill">
                    {{ formatDueCountdown(sub.window.remainDays, sub.meta.status) }}
                  </span>
                </div>

                <div class="sc-bottom">
                  <div class="sc-kv">
                    <span class="sc-k">待扣款</span>
                    <strong class="sc-v tabular">
                      {{ formatCurrencyAmount(sub.personalOrig, sub.meta.currency) }}
                      <em v-if="sub.meta.currency !== 'CNY'">≈ ¥{{ Math.round(sub.cycleCNY) }}</em>
                    </strong>
                  </div>
                  <div class="sc-kv">
                    <span class="sc-k">下次扣款</span>
                    <strong class="sc-v tabular">{{ formatShortDueDate(sub.window.nextDate) }}</strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <!-- PURE-ICON VISUAL BILLING CALENDAR (Cadence Image 3 + Giant Month Watermark) -->
          <section class="wm-card sv-cal-card">
            <span class="wm-text sv-cal-wm" aria-hidden="true">{{ cursorMonth }}月</span>

            <div class="sv-cal-head">
              <div class="sv-cal-title-wrap">
                <span class="sv-cal-title">纯图标扣费月历</span>
                <span class="sv-cal-hint">{{ hoveredDayHint || '点击图标直达刻度详情' }}</span>
              </div>
              <div class="sv-cal-nav">
                <button type="button" class="sv-cal-btn" title="上个月" aria-label="上个月" @click="stepCalMonth(-1)">
                  <FIcon name="chevronLeft" :size="12" />
                </button>
                <button type="button" class="sv-cal-today" @click="jumpCalToday">
                  {{ cursorMonth }}月
                </button>
                <button type="button" class="sv-cal-btn" title="下个月" aria-label="下个月" @click="stepCalMonth(1)">
                  <FIcon name="chevronRight" :size="12" />
                </button>
              </div>
            </div>

            <div class="sv-cal-wds" aria-hidden="true">
              <span v-for="w in weekdayLabels" :key="w">{{ w }}</span>
            </div>

            <div class="sv-cal-grid">
              <div
                v-for="cell in calendarCells"
                :key="cell.key"
                class="sv-cal-cell"
                :class="{
                  empty: !cell.day,
                  today: cell.isToday,
                  'has-sub': cell.filteredItems.length > 0,
                  dimmed: cell.dimmed,
                }"
                @mouseenter="onCalendarCellHover(cell)"
                @mouseleave="hoveredDayHint = ''"
                @click="onCalendarCellClick(cell)"
              >
                <template v-if="cell.day">
                  <template v-if="cell.filteredItems.length > 0">
                    <span
                      class="sv-cell-icon"
                      :style="{ background: cell.filteredItems[0].brandColor }"
                      :title="cell.filteredItems.map((x) => x.task.title).join('、')"
                    >
                      {{ cell.filteredItems[0].emblem }}
                      <em v-if="cell.filteredItems.length > 1" class="sv-cell-more">
                        +{{ cell.filteredItems.length - 1 }}
                      </em>
                    </span>
                    <span class="sv-cell-day-sm tabular">{{ cell.day }}</span>
                  </template>
                  <span v-else class="sv-cell-day tabular">{{ cell.day }}</span>
                </template>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ==================== VIEW 2: 清单与详情 (Cadence Image 2 Master-Detail + Vertical-Pill Countdown Scale) ==================== -->
    <div v-else class="sv-scroll">
      <div class="sv-master-grid">
        <!-- LEFT LIST & MULTI-ROW FILTERS -->
        <section class="sv-master-left">
          <div class="sml-head">
            <span class="sml-sub">我的订阅清单</span>
            <span class="sml-total tabular">{{ allSubscriptions.length }} <small>项</small></span>
          </div>

          <div class="sml-search">
            <FIcon name="search" :size="14" class="sml-s-ico" />
            <input
              v-model="searchText"
              type="text"
              class="sml-s-input"
              placeholder="搜索订阅名称、分类或扣款渠道…"
            />
          </div>

          <!-- Multi-Dimension Filter Pills -->
          <div class="sml-filters">
            <div class="sml-pill-row">
              <button
                type="button"
                class="sml-chip"
                :class="{ active: masterCat === 'all' }"
                @click="masterCat = 'all'"
              >
                全部
              </button>
              <button
                v-for="cat in SUBSCRIPTION_CATEGORIES"
                :key="cat"
                type="button"
                class="sml-chip"
                :class="{ active: masterCat === cat }"
                @click="masterCat = cat"
              >
                {{ CATEGORY_META[cat].label }}
              </button>
            </div>

            <div class="sml-pill-row">
              <button
                type="button"
                class="sml-chip dark"
                :class="{ active: masterPay === 'all' }"
                @click="masterPay = 'all'"
              >
                全部扣款
              </button>
              <button
                type="button"
                class="sml-chip dark"
                :class="{ active: masterPay === 'auto' }"
                @click="masterPay = 'auto'"
              >
                自动扣款
              </button>
              <button
                type="button"
                class="sml-chip dark"
                :class="{ active: masterPay === 'manual' }"
                @click="masterPay = 'manual'"
              >
                主动 / 试用
              </button>

              <span class="sml-sep" aria-hidden="true" />

              <button
                v-for="cy in (['all', 'monthly', 'yearly', 'quarterly'] as const)"
                :key="cy"
                type="button"
                class="sml-chip dark"
                :class="{ active: masterCycle === cy }"
                @click="masterCycle = cy"
              >
                {{ cy === 'all' ? '全周期' : CYCLE_META[cy].label }}
              </button>
            </div>
          </div>

          <!-- Scrollable List -->
          <div class="sml-list">
            <button
              v-for="sub in masterFilteredList"
              :key="sub.task.id"
              type="button"
              class="sml-row"
              :class="{
                active: selectedSub?.task.id === sub.task.id,
                paused: sub.meta.status === 'paused' || sub.meta.status === 'cancelled',
              }"
              @click="selectedId = sub.task.id"
            >
              <span class="sml-emblem" :style="{ background: sub.brandColor }">{{ sub.emblem }}</span>

              <div class="sml-row-main">
                <div class="sml-row-title-line">
                  <span class="sml-row-title">{{ sub.task.title }}</span>
                  <span v-if="effectiveSplit(sub.meta) > 1" class="sml-tag split">
                    {{ effectiveSplit(sub.meta) }}人拼车
                  </span>
                  <span v-if="sub.meta.status === 'trial'" class="sml-tag trial">试用</span>
                  <span v-else-if="sub.meta.status === 'paused'" class="sml-tag muted">已暂停</span>
                </div>
                <div class="sml-row-sub">
                  <span class="sml-dots" aria-hidden="true">
                    <i v-for="(lit, di) in miniDotsFor(sub)" :key="di" :class="{ lit }" />
                  </span>
                  <span class="sml-due" :class="{ urgent: sub.window.remainDays <= 3 }">
                    {{ formatDueCountdown(sub.window.remainDays, sub.meta.status) }}
                  </span>
                </div>
              </div>

              <div class="sml-row-price">
                <strong class="tabular">{{ formatCurrencyAmount(sub.personalOrig, sub.meta.currency) }}</strong>
                <div class="sml-cur-line">
                  <span class="sml-cur-badge" :class="sub.meta.currency === 'CNY' ? 'cny' : 'fx'">
                    {{ sub.meta.currency }}
                  </span>
                  <span>/{{ CYCLE_META[sub.meta.cycle].short.replace('付', '') }}</span>
                </div>
              </div>
            </button>

            <div v-if="!masterFilteredList.length" class="sml-empty">没有符合筛选条件的订阅</div>
          </div>
        </section>

        <!-- RIGHT DETAIL STAGE (Watermark + -6deg Tilted Emblem + Cadence 22-Bar Vertical Countdown Scale) -->
        <section v-if="selectedSub" class="wm-card sv-detail-card">
          <span class="wm-text sv-det-wm" aria-hidden="true">{{ selectedSub.watermark }}</span>

          <div class="sv-det-hero">
            <span class="tilted-emblem sv-det-emblem" :style="{ background: selectedSub.brandColor }">
              {{ selectedSub.emblem }}
            </span>
            <div class="sv-det-title-wrap">
              <div class="sv-det-name">{{ selectedSub.task.title }}</div>
              <div class="sv-det-monthly tabular">
                <strong>¥{{ Math.round(selectedSub.monthlyCNY * 10) / 10 }}</strong>
                <span>/ 月均折合</span>
              </div>
            </div>
          </div>

          <!-- CADENCE SIGNATURE 22-BAR VERTICAL-PILL COUNTDOWN SCALE -->
          <div class="sv-gauge-block">
            <div class="sv-gauge-meta">
              <span>本周期倒计时刻度（亮柱 = 剩余天数）</span>
              <strong class="sv-gauge-remain">
                {{ formatDueCountdown(selectedSub.window.remainDays, selectedSub.meta.status) }}
              </strong>
            </div>

            <div class="sv-gauge-row">
              <div class="sv-gauge-bars" aria-hidden="true">
                <span
                  v-for="bar in detailGaugeBars"
                  :key="bar.idx"
                  class="sv-tick"
                  :class="{ remain: bar.remain }"
                  :style="{ transitionDelay: `${bar.idx * 10}ms` }"
                />
              </div>
              <div class="sv-gauge-date">
                <strong class="tabular">{{ parts(selectedSub.window.nextDate)[2] }}</strong>
                <span>{{ parts(selectedSub.window.nextDate)[1] }}月</span>
              </div>
            </div>
          </div>

          <!-- Structured Spec Sheet -->
          <div class="sv-spec-table">
            <div class="sv-spec-row">
              <span>分类</span>
              <strong>{{ CATEGORY_META[selectedSub.meta.category].label }}</strong>
            </div>
            <div class="sv-spec-row">
              <span>计费周期</span>
              <strong>{{ CYCLE_META[selectedSub.meta.cycle].label }}（{{ STATUS_LABELS[selectedSub.meta.status] }}）</strong>
            </div>
            <div class="sv-spec-row">
              <span>原始金额</span>
              <strong class="tabular">
                {{ formatCurrencyAmount(selectedSub.meta.price, selectedSub.meta.currency) }} {{ selectedSub.meta.currency }}
                <template v-if="effectiveSplit(selectedSub.meta) > 1">
                  （{{ effectiveSplit(selectedSub.meta) }}人平摊，实付 {{ formatCurrencyAmount(selectedSub.personalOrig, selectedSub.meta.currency) }}）
                </template>
              </strong>
            </div>
            <div class="sv-spec-row">
              <span>折合月支出</span>
              <strong class="tabular">¥{{ selectedSub.monthlyCNY.toFixed(1) }}</strong>
            </div>
            <div class="sv-spec-row">
              <span>折合年支出</span>
              <strong class="tabular">¥{{ Math.round(selectedSub.yearlyCNY).toLocaleString('zh-CN') }}</strong>
            </div>
            <div class="sv-spec-row">
              <span>扣款渠道</span>
              <strong>{{ selectedSub.meta.paymentMethod || '未设置' }}</strong>
            </div>
            <div class="sv-spec-row">
              <span>下次扣款日</span>
              <strong class="tabular">{{ selectedSub.window.nextDate }}</strong>
            </div>
          </div>

          <!-- Status Banner + Actions -->
          <div class="sv-det-footer">
            <div class="sv-renew-banner" :class="{ trial: selectedSub.meta.status === 'trial' }">
              <FIcon :name="selectedSub.meta.status === 'trial' ? 'warning' : 'clock'" :size="14" />
              <span v-if="selectedSub.meta.status === 'trial'">试用护盾已开启 · 到期前记得确认是否取消</span>
              <span v-else-if="selectedSub.meta.autoRenew">自动扣款 · 到期自动续费</span>
              <span v-else>主动付款 · 到期需手动续费</span>
            </div>

            <div class="sv-det-actions">
              <button type="button" class="sv-act-btn" @click="openEditModal(selectedSub)">
                <FIcon name="edit" :size="14" />
                <span>编辑订阅</span>
              </button>
              <button type="button" class="sv-act-btn" @click="togglePauseSub(selectedSub)">
                <FIcon :name="selectedSub.meta.status === 'paused' ? 'check' : 'timer'" :size="14" />
                <span>{{ selectedSub.meta.status === 'paused' ? '恢复订阅' : '暂停计费' }}</span>
              </button>
              <button type="button" class="sv-act-btn danger" @click="removeSub(selectedSub)">
                <FIcon name="delete" :size="14" />
                <span>删除</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Add / Edit Subscription Modal -->
    <SubscriptionEditorModal
      :open="editorOpen"
      :editing-task="editingTask"
      :default-date="editorDefaultDate"
      @close="editorOpen = false"
      @saved="onEditorSaved"
    />
  </div>
</template>

<style>
.sub-page {
  --sub-hero-bg: linear-gradient(135deg, #e5eaf5 0%, #d8e0ef 100%);
  --sub-hero-ink: #1a2030;
  --sub-hero-wm: rgba(26, 32, 48, 0.095);
  --sub-hero-track: rgba(26, 32, 48, 0.14);

  --tone-life-bg: linear-gradient(150deg, #e2ede4 0%, #d3e4d6 100%);
  --tone-life-ink: #1f3925;
  --tone-life-wm: rgba(31, 57, 37, 0.11);

  --tone-ai-bg: linear-gradient(150deg, #e8e5f9 0%, #dcd7f4 100%);
  --tone-ai-ink: #29205b;
  --tone-ai-wm: rgba(41, 32, 91, 0.105);

  --tone-cloud-bg: linear-gradient(150deg, #dceef3 0%, #cce4eb 100%);
  --tone-cloud-ink: #143a47;
  --tone-cloud-wm: rgba(20, 58, 71, 0.105);

  --tone-media-bg: linear-gradient(150deg, #f3dde2 0%, #ebd0d6 100%);
  --tone-media-ink: #4a1c26;
  --tone-media-wm: rgba(74, 28, 38, 0.115);

  --tone-work-bg: linear-gradient(150deg, #f7ecd6 0%, #f1e0bf 100%);
  --tone-work-ink: #4b310a;
  --tone-work-wm: rgba(75, 49, 10, 0.11);

  --tone-other-bg: linear-gradient(150deg, #eaedf2 0%, #dfe3eb 100%);
  --tone-other-ink: #272d38;
  --tone-other-wm: rgba(39, 45, 56, 0.1);

  --sub-cal-bg: linear-gradient(155deg, #ffffff 0%, #f3f5fa 100%);
  --sub-cal-wm: rgba(26, 32, 48, 0.055);
}

html[data-ws-theme='dark'] .sub-page {
  --sub-hero-bg: linear-gradient(135deg, #212738 0%, #181d2b 100%);
  --sub-hero-ink: #eef2ff;
  --sub-hero-wm: rgba(238, 242, 255, 0.085);
  --sub-hero-track: rgba(238, 242, 255, 0.14);

  --tone-life-bg: linear-gradient(150deg, #1d3124 0%, #16251b 100%);
  --tone-life-ink: #d4f0da;
  --tone-life-wm: rgba(212, 240, 218, 0.09);

  --tone-ai-bg: linear-gradient(150deg, #272244 0%, #1d1936 100%);
  --tone-ai-ink: #e4e0ff;
  --tone-ai-wm: rgba(228, 224, 255, 0.09);

  --tone-cloud-bg: linear-gradient(150deg, #162e37 0%, #11242b 100%);
  --tone-cloud-ink: #cceff8;
  --tone-cloud-wm: rgba(204, 239, 248, 0.09);

  --tone-media-bg: linear-gradient(150deg, #371e26 0%, #2a171e 100%);
  --tone-media-ink: #fad9e1;
  --tone-media-wm: rgba(250, 217, 225, 0.095);

  --tone-work-bg: linear-gradient(150deg, #352916 0%, #291f10 100%);
  --tone-work-ink: #f8e5bf;
  --tone-work-wm: rgba(248, 229, 191, 0.09);

  --tone-other-bg: linear-gradient(150deg, #23262f 0%, #1a1d24 100%);
  --tone-other-ink: #e2e6ef;
  --tone-other-wm: rgba(226, 230, 239, 0.085);

  --sub-cal-bg: linear-gradient(155deg, #1b1e28 0%, #141720 100%);
  --sub-cal-wm: rgba(255, 255, 255, 0.06);
}
</style>

<style scoped>
.sub-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ws-ink);
}

.tabular {
  font-variant-numeric: tabular-nums;
}

/* Header */
.sv-head {
  flex: none;
  padding: 16px 24px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.sv-eyebrow {
  font-size: 11.5px;
  font-weight: 700;
  color: #e85d2a;
  letter-spacing: 0.01em;
}

.sv-title {
  margin: 2px 0 0;
  font-family: var(--font-display);
  font-size: 25px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.sv-head-right {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.sv-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
}

.sv-seg-pill {
  border-radius: 999px;
  background: var(--ws-ink);
}

.sv-seg-btn {
  position: relative;
  z-index: 1;
  height: 27px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 640;
  cursor: pointer;
  transition: color 150ms ease;
}

.sv-seg-btn.active {
  color: var(--ws-ink-inverse);
}

.sv-period-seg {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
}

.sv-per-btn {
  width: 28px;
  height: 27px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.sv-per-btn.active {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sv-add-btn {
  height: 33px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 680;
  cursor: pointer;
  box-shadow: var(--ws-shadow-sm);
  transition: transform 120ms ease, opacity 140ms ease;
}

.sv-add-btn:active {
  transform: scale(0.96);
}

/* Shared Editorial Watermark Card & Tilted Emblem */
.wm-card {
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  box-shadow: 0 8px 26px rgba(20, 24, 38, 0.05), 0 1px 2px rgba(20, 24, 38, 0.04);
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease;
}

.wm-text {
  position: absolute;
  pointer-events: none;
  user-select: none;
  font-weight: 900;
  line-height: 0.88;
  letter-spacing: -0.045em;
  white-space: nowrap;
  z-index: 0;
}

.tilted-emblem {
  border-radius: 18px;
  transform: rotate(-6deg);
  box-shadow: 0 12px 24px rgba(15, 20, 35, 0.2), 0 2px 6px rgba(15, 20, 35, 0.12);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease;
}

.wm-card:hover .tilted-emblem {
  transform: rotate(-2deg) scale(1.04);
}

/* Tone Helpers */
.tone-hero { background: var(--sub-hero-bg); color: var(--sub-hero-ink); }
.tone-life { background: var(--tone-life-bg); color: var(--tone-life-ink); --tile-wm: var(--tone-life-wm); }
.tone-ai { background: var(--tone-ai-bg); color: var(--tone-ai-ink); --tile-wm: var(--tone-ai-wm); }
.tone-cloud { background: var(--tone-cloud-bg); color: var(--tone-cloud-ink); --tile-wm: var(--tone-cloud-wm); }
.tone-media { background: var(--tone-media-bg); color: var(--tone-media-ink); --tile-wm: var(--tone-media-wm); }
.tone-work { background: var(--tone-work-bg); color: var(--tone-work-ink); --tile-wm: var(--tone-work-wm); }
.tone-other { background: var(--tone-other-bg); color: var(--tone-other-ink); --tile-wm: var(--tone-other-wm); }

/* Empty Starter State */
.sv-empty-stage {
  flex: 1;
  padding: 20px 24px 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sv-empty-card {
  max-width: 680px;
  width: 100%;
  padding: 32px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.sv-empty-wm {
  font-size: 86px;
  top: -8px;
  right: -12px;
  color: var(--sub-hero-wm);
}

.sv-empty-emblem {
  width: 72px;
  height: 72px;
  flex: none;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #fff;
  display: inline-grid;
  place-items: center;
  position: relative;
  z-index: 1;
}

.sv-empty-copy {
  position: relative;
  z-index: 1;
}

.sv-empty-copy h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.sv-empty-copy p {
  margin: 8px 0 0;
  font-size: 13.5px;
  line-height: 1.6;
  opacity: 0.78;
}

.sv-empty-acts {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sv-btn-solid,
.sv-btn-soft {
  height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  border: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.sv-btn-solid {
  background: var(--sub-hero-ink);
  color: var(--ws-card-bg);
}

.sv-btn-soft {
  background: rgba(255, 255, 255, 0.55);
  color: var(--sub-hero-ink);
}

/* Main Scrollable Body */
.sv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 24px 28px;
}

.sub-page.phone .sv-head {
  padding: 10px 14px 8px;
}

.sub-page.phone .sv-scroll {
  padding: 4px 12px calc(106px + env(safe-area-inset-bottom));
}

/* VIEW 1: Insights Grid */
.sv-insights-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.94fr);
  gap: 16px;
  align-items: start;
}

.sv-col-left,
.sv-col-right {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

/* Hero Spend Card */
.sv-hero-card {
  padding: 20px 22px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.sv-hero-wm {
  font-size: 74px;
  top: -8px;
  right: 10px;
  color: var(--sub-hero-wm);
}

.sv-hero-emblem {
  width: 70px;
  height: 70px;
  flex: none;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}

.she-mon {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  opacity: 0.65;
}

.she-day {
  font-size: 24px;
  font-weight: 900;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}

.sv-hero-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}

.sv-hero-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.sv-hero-label {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.sv-hero-sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.72;
}

.sv-save-pill {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.18);
  color: #0e8a62;
  font-size: 11px;
  font-weight: 750;
}

.sv-hero-amount {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
}

.sv-hero-amount small {
  font-size: 18px;
  opacity: 0.58;
}

.sv-hero-progress {
  margin-top: 13px;
}

.sv-hp-labels {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 700;
  opacity: 0.78;
  margin-bottom: 6px;
}

.sv-thick-track {
  height: 9px;
  border-radius: 999px;
  background: var(--sub-hero-track);
  overflow: hidden;
}

.sv-thick-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--sub-hero-ink);
  transition: width 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Section Label Row */
.sv-sec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.sv-sec-hint {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink-muted);
}

.sv-reset-link {
  border: 0;
  background: transparent;
  color: #e85d2a;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
}

/* Proportional Watermark Category Treemap */
.sv-treemap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 360px;
}

.sv-treemap.single {
  grid-template-columns: 1fr;
  min-height: 200px;
}

.tm-tile {
  border: 0;
  text-align: left;
  font: inherit;
  padding: 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
}

.tm-tile:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px rgba(20, 24, 38, 0.1);
}

.tm-tile.active {
  box-shadow: 0 0 0 2.5px #e85d2a, 0 14px 28px rgba(232, 93, 42, 0.18);
}

.tm-wm-lg {
  font-size: 72px;
  top: 10px;
  right: -10px;
  color: var(--tile-wm);
}

.tm-wm-sm {
  font-size: 54px;
  top: -4px;
  right: -6px;
  color: var(--tile-wm);
}

.tm-top,
.tm-bottom,
.tm-bottom-inline {
  position: relative;
  z-index: 1;
}

.tm-name {
  display: block;
  font-size: 15.5px;
  font-weight: 820;
  letter-spacing: -0.02em;
}

.tm-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  font-weight: 640;
  opacity: 0.72;
}

.tm-price {
  font-size: 30px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

.tm-bar-track {
  margin-top: 10px;
  height: 7px;
  border-radius: 999px;
  background: var(--tile-wm);
  overflow: hidden;
}

.tm-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: currentColor;
}

.tm-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tm-sub-tile {
  padding: 15px 17px;
  min-height: 92px;
}

.tm-bottom-inline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.tm-price-sm {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.025em;
}

.tm-pct-tag {
  font-size: 11.5px;
  font-weight: 760;
  opacity: 0.75;
}

/* RESTORED Staggered Gradient Membership Deck (Image 1 Signature + Watermark!) */
.sv-deck-panel {
  border-radius: 24px;
  padding: 16px 18px 18px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  box-shadow: 0 8px 24px rgba(20, 24, 38, 0.04);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sv-deck-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sv-deck-title-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sv-deck-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--ws-ink);
}

.sv-deck-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, #e85d2a 13%, transparent);
  color: #e85d2a;
  font-size: 11px;
  font-weight: 700;
}

.sv-deck-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sv-mini-pill {
  height: 25px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 640;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.sv-mini-pill:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.stagger-deck {
  position: relative;
  height: 168px;
  border-radius: 20px;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.stagger-card {
  position: absolute;
  border-radius: 22px;
  padding: 15px 18px;
  color: #ffffff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition:
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
    top 360ms cubic-bezier(0.22, 1, 0.36, 1),
    left 360ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 260ms ease,
    box-shadow 260ms ease;
}

.stagger-card[data-pos='0'] {
  top: 38px;
  left: 0;
  right: -12px;
  height: 130px;
  z-index: 30;
  transform: translateY(0) scale(1);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
}

.stagger-card[data-pos='1'] {
  top: 8px;
  left: 48px;
  right: -14px;
  height: 118px;
  z-index: 20;
  opacity: 0.96;
  transform: translateY(0) scale(0.985);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
}

.stagger-card[data-pos='2'] {
  top: 0;
  left: 96px;
  right: -16px;
  height: 106px;
  z-index: 10;
  opacity: 0.72;
  transform: translateY(-4px) scale(0.95);
}

.stagger-deck:hover .stagger-card[data-pos='1'] {
  transform: translateY(-5px) scale(0.99);
}

.stagger-wm {
  position: absolute;
  right: 18px;
  top: -10px;
  font-size: 62px;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
  color: rgba(255, 255, 255, 0.16);
  pointer-events: none;
  white-space: nowrap;
}

.sc-top,
.sc-bottom {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sc-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.sc-emblem {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  color: #ffffff;
  font-size: 19px;
  font-weight: 900;
  display: inline-grid;
  place-items: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  flex: none;
}

.sc-brand-copy {
  min-width: 0;
}

.sc-name {
  font-size: 17px;
  font-weight: 820;
  line-height: 1.15;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-cycle {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 560;
  opacity: 0.86;
}

.sc-due-pill {
  flex: none;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(8px);
  font-size: 11px;
  font-weight: 760;
}

.sc-bottom {
  justify-content: flex-start;
  gap: 36px;
}

.sc-kv {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sc-k {
  font-size: 11px;
  font-weight: 560;
  opacity: 0.8;
}

.sc-v {
  font-size: 17px;
  font-weight: 850;
  line-height: 1.15;
}

.sc-v em {
  font-style: normal;
  font-size: 11.5px;
  font-weight: 650;
  opacity: 0.82;
  margin-left: 4px;
}

/* Pure-Icon Visual Billing Calendar */
.sv-cal-card {
  padding: 16px 18px 14px;
  background: var(--sub-cal-bg);
  border: 1px solid var(--ws-hairline);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sv-cal-wm {
  font-size: 112px;
  bottom: -18px;
  right: 4px;
  color: var(--sub-cal-wm);
}

.sv-cal-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sv-cal-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sv-cal-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--ws-ink);
}

.sv-cal-hint {
  font-size: 11.5px;
  font-weight: 560;
  color: var(--ws-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-cal-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.sv-cal-btn,
.sv-cal-today {
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.sv-cal-btn {
  width: 26px;
  padding: 0;
}

.sv-cal-today {
  padding: 0 10px;
  color: var(--ws-ink);
}

.sv-cal-wds {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  text-align: center;
  font-size: 11px;
  font-weight: 650;
  color: var(--ws-ink-muted);
}

.sv-cal-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.sv-cal-cell {
  min-height: 46px;
  padding: 3px 0;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  transition: transform 140ms ease, background-color 140ms ease, opacity 180ms ease, filter 180ms ease;
}

.sv-cal-cell.empty {
  cursor: default;
}

.sv-cal-cell:not(.empty):hover {
  background: var(--ws-pill-hover);
  transform: scale(1.07);
}

.sv-cal-cell.today {
  box-shadow: inset 0 0 0 1.8px #e85d2a;
  background: color-mix(in srgb, #e85d2a 8%, transparent);
}

.sv-cal-cell.dimmed {
  opacity: 0.22;
  filter: blur(0.6px);
}

.sv-cell-icon {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 900;
  display: inline-grid;
  place-items: center;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.14);
}

.sv-cell-more {
  position: absolute;
  top: -5px;
  right: -6px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font-style: normal;
  font-size: 8.5px;
  font-weight: 800;
  line-height: 14px;
  text-align: center;
}

.sv-cell-day {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink-muted);
}

.sv-cal-cell.today .sv-cell-day {
  color: #e85d2a;
  font-weight: 800;
}

.sv-cell-day-sm {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--ws-ink-secondary);
  line-height: 1;
}

/* ==================== VIEW 2: Master-Detail Split ==================== */
.sv-master-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.85fr) minmax(0, 1.15fr);
  gap: 18px;
  align-items: start;
}

.sv-master-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sml-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px;
}

.sml-sub {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ws-ink-muted);
}

.sml-total {
  font-size: 22px;
  font-weight: 850;
  color: var(--ws-ink);
}

.sml-total small {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink-muted);
}

.sml-search {
  height: 36px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  align-items: center;
  gap: 8px;
}

.sml-s-ico {
  color: var(--ws-ink-muted);
}

.sml-s-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.sml-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sml-pill-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.sml-sep {
  width: 1px;
  height: 14px;
  background: var(--ws-hairline-strong);
  margin: 0 2px;
}

.sml-chip {
  height: 25px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 620;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.sml-chip.active {
  background: #e85d2a;
  color: #ffffff;
}

.sml-chip.dark.active {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sml-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.sml-row {
  width: 100%;
  padding: 10px 12px;
  border-radius: 15px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 11px;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, transform 120ms ease;
}

.sml-row:hover {
  border-color: var(--ws-hairline-strong);
  background: var(--ws-card-subtle);
}

.sml-row.active {
  border-color: #e85d2a;
  box-shadow: 0 4px 14px rgba(232, 93, 42, 0.1);
}

.sml-row.paused {
  opacity: 0.56;
}

.sml-emblem {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  display: inline-grid;
  place-items: center;
  flex: none;
}

.sml-row-main {
  flex: 1;
  min-width: 0;
}

.sml-row-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sml-row-title {
  font-size: 13.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sml-tag {
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 750;
}

.sml-tag.split {
  background: rgba(37, 99, 235, 0.13);
  color: #2563eb;
}

.sml-tag.trial {
  background: rgba(232, 93, 42, 0.14);
  color: #e85d2a;
}

.sml-tag.muted {
  background: var(--ws-stone-pill);
  color: var(--ws-ink-muted);
}

.sml-row-sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--ws-ink-muted);
}

.sml-dots {
  display: inline-flex;
  gap: 2.5px;
}

.sml-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ws-hairline-strong);
}

.sml-dots i.lit {
  background: #e85d2a;
}

.sml-due.urgent {
  color: #e85d2a;
  font-weight: 700;
}

.sml-row-price {
  text-align: right;
  flex: none;
}

.sml-row-price strong {
  display: block;
  font-size: 14px;
  font-weight: 820;
}

.sml-cur-line {
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--ws-ink-muted);
}

.sml-cur-badge {
  padding: 1px 4.5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 800;
}

.sml-cur-badge.cny {
  background: rgba(232, 76, 61, 0.14);
  color: #d93e30;
}

.sml-cur-badge.fx {
  background: rgba(16, 185, 129, 0.15);
  color: #0e9f6e;
}

.sml-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--ws-ink-muted);
}

/* Right Detail Card (Cadence Image 2 + Watermark) */
.sv-detail-card {
  padding: 24px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sv-det-wm {
  font-size: 86px;
  top: 4px;
  right: -12px;
  color: var(--sub-cal-wm);
}

.sv-det-hero {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 18px;
}

.sv-det-emblem {
  width: 62px;
  height: 62px;
  color: #ffffff;
  font-size: 26px;
  font-weight: 900;
  display: inline-grid;
  place-items: center;
  flex: none;
}

.sv-det-name {
  font-size: 19px;
  font-weight: 820;
  letter-spacing: -0.02em;
}

.sv-det-monthly {
  margin-top: 3px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.sv-det-monthly strong {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
}

.sv-det-monthly span {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink-muted);
}

/* Cadence 22-Bar Vertical-Pill Countdown Scale */
.sv-gauge-block {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sv-gauge-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ws-ink-muted);
}

.sv-gauge-remain {
  color: #e85d2a;
  font-weight: 760;
}

.sv-gauge-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sv-gauge-bars {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(22, minmax(0, 1fr));
  gap: 4px;
}

.sv-tick {
  height: 30px;
  border-radius: 4.5px;
  background: var(--ws-stone-pill);
  transition: background-color 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.sv-tick.remain {
  background: var(--ws-ink);
  box-shadow: 0 0 10px color-mix(in srgb, #e85d2a 24%, transparent);
}

.sv-gauge-date {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: none;
}

.sv-gauge-date strong {
  font-size: 15px;
  font-weight: 850;
  line-height: 1;
}

.sv-gauge-date span {
  font-size: 10px;
  font-weight: 640;
  color: var(--ws-ink-muted);
  margin-top: 2px;
}

/* Spec Table */
.sv-spec-table {
  position: relative;
  z-index: 1;
  border-radius: 16px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  overflow: hidden;
}

.sv-spec-row {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  border-bottom: 1px solid var(--ws-hairline);
}

.sv-spec-row:last-child {
  border-bottom: 0;
}

.sv-spec-row span {
  color: var(--ws-ink-muted);
}

.sv-spec-row strong {
  font-weight: 700;
  text-align: right;
}

/* Detail Footer */
.sv-det-footer {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sv-renew-banner {
  height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 620;
}

.sv-renew-banner.trial {
  background: color-mix(in srgb, #e85d2a 11%, var(--ws-card-bg));
  border-color: color-mix(in srgb, #e85d2a 26%, transparent);
  color: #e85d2a;
}

.sv-det-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.sv-act-btn {
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 680;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: background-color 140ms ease, transform 120ms ease;
}

.sv-act-btn:hover {
  background: var(--ws-pill-hover);
}

.sv-act-btn:active {
  transform: scale(0.96);
}

.sv-act-btn.danger {
  background: rgba(232, 76, 61, 0.1);
  border-color: rgba(232, 76, 61, 0.22);
  color: #d93e30;
}

@media (max-width: 1020px) {
  .sv-insights-grid,
  .sv-master-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 639px) {
  .sv-hero-card {
    padding: 16px;
    gap: 14px;
  }

  .sv-hero-emblem {
    width: 58px;
    height: 58px;
  }

  .sv-hero-amount {
    font-size: 26px;
  }

  .sv-treemap {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .sv-empty-card {
    flex-direction: column;
    align-items: flex-start;
    padding: 22px;
  }

  .sv-det-actions {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
