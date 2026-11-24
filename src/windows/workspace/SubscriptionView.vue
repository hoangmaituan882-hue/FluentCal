<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FIcon } from '@/fluent';
import type {
  ISODate,
  SubscriptionCategory,
  SubscriptionCycle,
  SubscriptionMeta,
  SubscriptionStatus,
  SubscriptionSubAccount,
  Task,
} from '@/types';
import { addMonths, daysInMonth, parts, startOfMonth, weekday, WEEKDAY_SHORT, ymd } from '@/lib/date';
import {
  buildCategoryBreakdown,
  CATEGORY_META,
  CURRENCY_META,
  CYCLE_META,
  effectiveSplit,
  formatCurrencyAmount,
  formatDueCountdown,
  formatShortDueDate,
  isSubscriptionActiveStatus,
  isSubscriptionTask,
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
import FushiTonalCard from './FushiTonalCard.vue';
import SubscriptionEditorModal from './SubscriptionEditorModal.vue';
import SubscriptionEmblem from './SubscriptionEmblem.vue';
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
const masterFiltersOpen = ref(false);
const hasSecondaryMasterFilter = computed(
  () => masterPay.value !== 'all' || masterCycle.value !== 'all',
);

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
  allSubscriptions.value.filter((s) => isSubscriptionActiveStatus(s.meta.status)),
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
  period.value === 'month' ? '月均订阅实付' : '全年订阅实付',
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
  const nextStatus: SubscriptionStatus = sub.meta.status === 'paused' ? 'active' : 'paused';
  await saveTask({
    ...sub.task,
    subscription: { ...sub.meta, status: nextStatus, autoRenew: nextStatus === 'active' ? sub.meta.autoRenew : false },
  });
}

async function toggleEndingSub(sub: ResolvedSubscription) {
  const isEnding = sub.meta.status === 'ending';
  const nextStatus: SubscriptionStatus = isEnding ? 'active' : 'ending';
  await saveTask({
    ...sub.task,
    subscription: { ...sub.meta, status: nextStatus, autoRenew: isEnding },
  });
}

// Inline multi-account / sub-subscription adder inside Detail Stage
const subAccAdderOpen = ref(false);
const draftSubLabel = ref('');
const draftSubPlan = ref('');
const draftSubPrice = ref('');

watch(selectedId, () => {
  subAccAdderOpen.value = false;
  draftSubLabel.value = '';
  draftSubPlan.value = '';
  draftSubPrice.value = '';
});

function openSubAccAdder(sub: ResolvedSubscription) {
  subAccAdderOpen.value = !subAccAdderOpen.value;
  if (subAccAdderOpen.value) {
    draftSubLabel.value = '';
    draftSubPlan.value = sub.meta.plan ?? '';
    draftSubPrice.value = String(sub.meta.price);
  }
}

async function addDetailSubAccount(sub: ResolvedSubscription) {
  const label = draftSubLabel.value.trim() || `副号 ${(sub.meta.accounts?.length ?? 0) + 1}`;
  const pr = Number.parseFloat(draftSubPrice.value);
  const price = Number.isFinite(pr) && pr >= 0 ? pr : sub.meta.price;
  const nextAcc: SubscriptionSubAccount = {
    id: `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    plan: draftSubPlan.value.trim() || sub.meta.plan || undefined,
    price,
    currency: sub.meta.currency,
    cycle: sub.meta.cycle,
    status: 'active',
    autoRenew: true,
  };
  await saveTask({
    ...sub.task,
    subscription: {
      ...sub.meta,
      accounts: [...(sub.meta.accounts ?? []), nextAcc],
    },
  });
  draftSubLabel.value = '';
  draftSubPlan.value = '';
  subAccAdderOpen.value = false;
}

async function cycleDetailSubAccountStatus(sub: ResolvedSubscription, accId: string) {
  const order: SubscriptionStatus[] = ['active', 'ending', 'paused'];
  const nextAccounts = (sub.meta.accounts ?? []).map((a) => {
    if (a.id !== accId) return a;
    const nextSt = order[(order.indexOf(a.status ?? 'active') + 1) % order.length];
    return { ...a, status: nextSt, autoRenew: nextSt === 'active' };
  });
  await saveTask({
    ...sub.task,
    subscription: { ...sub.meta, accounts: nextAccounts },
  });
}

async function removeDetailSubAccount(sub: ResolvedSubscription, accId: string) {
  const nextAccounts = (sub.meta.accounts ?? []).filter((a) => a.id !== accId);
  await saveTask({
    ...sub.task,
    subscription: {
      ...sub.meta,
      accounts: nextAccounts.length ? nextAccounts : undefined,
    },
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
    <!-- Enlarged Bold Black Display Header (zero red eyebrow!) -->
    <header class="sv-head" :class="{ phone: isPhone }">
      <div v-if="!isPhone" class="sv-head-left">
        <h1 class="sv-title">{{ subView === 'insights' ? '数据洞察' : '清单与详情' }}</h1>
        <span class="sv-date-chip tabular">{{ cursorYear }}年{{ cursorMonth }}月</span>
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

        <button
          type="button"
          class="sv-add-btn"
          :class="{ icon: isPhone }"
          title="添加订阅"
          aria-label="添加订阅"
          @click="openCreateModal()"
        >
          <FIcon name="add" :size="14" />
          <span v-if="!isPhone">添加订阅</span>
        </button>
      </div>
    </header>

    <!-- First-Run Inviting Empty State (Unified Fushi Tonal Card) -->
    <div v-if="!allSubscriptions.length" class="sv-empty-stage">
      <FushiTonalCard variant="hero" class="sv-empty-card" tint="#4E659E" watermark="订阅日历">
        <template #emblem>
          <div class="sv-empty-emblem">
            <FIcon name="subscription" :size="28" />
          </div>
        </template>
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
      </FushiTonalCard>
    </div>

    <!-- ==================== VIEW 1: 数据洞察 ==================== -->
    <div v-else-if="subView === 'insights'" class="sv-scroll">
      <div class="sv-insights-grid">
        <!-- LEFT COLUMN: Unified Fushi Tonal Hero + Unified Fushi Category Treemap -->
        <div class="sv-col-left">
          <!-- HERO SPEND CARD (Unified Fushi Tonal Template) -->
          <FushiTonalCard
            as="section"
            variant="hero"
            class="sv-hero-card"
            tint="#4E659E"
            :watermark="heroWatermarkText"
            :progress="monthSummary.billedProgressPct"
          >
            <template #emblem>
              <div class="sv-hero-emblem" aria-hidden="true">
                <span class="she-mon">{{ cursorMonth }}月</span>
                <strong class="she-day">{{ parts(now)[2] }}</strong>
              </div>
            </template>

            <div class="sv-hero-top">
              <div class="sv-hero-meta-col">
                <div class="sv-hero-label">{{ period === 'month' ? '月均订阅实付' : '全年订阅实付' }}</div>
                <div class="sv-hero-sub">
                  <span>折合 CNY · {{ activeSubscriptions.length }} 项生效</span>
                  <span v-if="totalSplitSavedMonthlyCNY >= 1" class="sv-save-pill">
                    优惠/拼车已省 ¥{{ Math.round(totalSplitSavedMonthlyCNY) }}/月
                  </span>
                </div>
              </div>
              <div class="sv-hero-amount tabular">
                ¥{{ heroDisplayAmount }}<small v-if="heroSubDisplayDecimals">{{ heroSubDisplayDecimals }}</small>
              </div>
            </div>

            <template #progressMeta>
              <span class="tabular">{{ cursorMonth }}月已扣进度 {{ monthSummary.billedProgressPct }}%</span>
              <span class="tabular">本月待扣 ¥{{ Math.round(monthSummary.remainingMonthCNY) }}</span>
            </template>
          </FushiTonalCard>

          <!-- Treemap Header -->
          <div class="sv-sec-row">
            <span class="sv-sec-hint">{{ isPhone ? '分类支出' : '分类支出树图' }}</span>
            <button
              v-if="focusCategory"
              type="button"
              class="sv-reset-link"
              @click="focusCategory = null"
            >
              全部
            </button>
          </div>

          <!-- PROPORTIONAL FUSHI TONAL CATEGORY TREEMAP -->
          <div class="sv-treemap" :class="{ single: secondarySlices.length === 0 }">
            <!-- Primary Dominant Category Tile -->
            <FushiTonalCard
              v-if="primarySlice"
              as="button"
              variant="tile"
              interactive
              :active="focusCategory === primarySlice.category"
              :tint="primarySlice.color"
              :watermark="primarySlice.watermark"
              :progress="primarySlice.percent"
              class="tm-tile tm-primary"
              @click="toggleFocusCat(primarySlice.category)"
            >
              <div class="tm-top">
                <span class="tm-name">{{ primarySlice.label }}</span>
                <span class="tm-sub tabular">{{ primarySlice.count }} 项 · {{ primarySlice.percent }}%</span>
              </div>
              <div class="tm-bottom">
                <div class="tm-price tabular">¥{{ Math.round(primarySlice.amountCNY).toLocaleString('zh-CN') }}</div>
              </div>
            </FushiTonalCard>

            <!-- Secondary Stacked Proportional Category Tiles -->
            <div v-if="secondarySlices.length" class="tm-stack">
              <FushiTonalCard
                v-for="sl in secondarySlices"
                :key="sl.category"
                as="button"
                variant="tile"
                interactive
                :active="focusCategory === sl.category"
                :tint="sl.color"
                :watermark="sl.watermark"
                :progress="sl.percent"
                class="tm-tile tm-sub-tile"
                :style="{ flex: `${Math.max(0.85, Math.min(2.2, sl.percent / 18))}` }"
                @click="toggleFocusCat(sl.category)"
              >
                <div class="tm-top">
                  <span class="tm-name">{{ sl.label }}</span>
                  <span class="tm-sub tabular">{{ sl.count }} 项 · {{ sl.percent }}%</span>
                </div>
                <div class="tm-bottom-inline">
                  <span class="tm-price-sm tabular">¥{{ Math.round(sl.amountCNY).toLocaleString('zh-CN') }}</span>
                  <span class="tm-pct-tag tabular">{{ sl.percent }}%</span>
                </div>
              </FushiTonalCard>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: Fushi Tonal Staggered Membership Deck + Pure-Icon Visual Billing Calendar -->
        <div class="sv-col-right">
          <section class="sv-deck-panel">
            <div class="sv-deck-head">
              <div class="sv-deck-title-group">
                <span class="sv-deck-title">即将扣款</span>
                <span class="sv-deck-badge">{{ isPhone ? `${deckCards.length} 项` : `${deckCards.length} 张叠卡` }}</span>
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
              <FushiTonalCard
                v-for="(sub, idx) in deckCards"
                :key="sub.task.id"
                as="article"
                variant="deck"
                :tint="sub.brandColor"
                :watermark="sub.watermark"
                :progress="sub.window.progressPct"
                class="stagger-card"
                :data-pos="cardDeckPosition(idx)"
                @dblclick.stop="openDetailFor(sub)"
              >
                <template #emblem>
                  <SubscriptionEmblem
                    :brand-key="sub.brandKey"
                    :icon-data="sub.iconData"
                    :title="sub.task.title"
                    :emblem="sub.emblem"
                    :brand-color="sub.brandColor"
                    :size="46"
                    :radius="14"
                  />
                </template>

                <div class="sc-top">
                  <div class="sc-brand-copy">
                    <div class="sc-name">{{ sub.task.title }}</div>
                    <div class="sc-cycle">
                      {{ CYCLE_META[sub.meta.cycle].label }}
                      <template v-if="effectiveSplit(sub.meta) > 1"> · {{ effectiveSplit(sub.meta) }}人拼车</template>
                      <template v-else-if="sub.meta.status === 'trial'"> · 试用护盾</template>
                      <template v-else> · {{ sub.meta.autoRenew ? '自动续费' : '主动付款' }}</template>
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
              </FushiTonalCard>
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
                      :title="cell.filteredItems.map((x) => x.task.title).join('、')"
                    >
                      <SubscriptionEmblem
                        :brand-key="cell.filteredItems[0].brandKey"
                        :icon-data="cell.filteredItems[0].iconData"
                        :title="cell.filteredItems[0].task.title"
                        :emblem="cell.filteredItems[0].emblem"
                        :brand-color="cell.filteredItems[0].brandColor"
                        :size="28"
                        :radius="9"
                      />
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
        <!-- LEFT LIST & STREAMLINED SINGLE-ROW FILTERS -->
        <section class="sv-master-left">
          <div class="sml-head">
            <span class="sml-sub">我的订阅清单</span>
            <span class="sml-total tabular">{{ allSubscriptions.length }} <small>项</small></span>
          </div>

          <div class="sml-search-row">
            <div class="sml-search">
              <FIcon name="search" :size="14" class="sml-s-ico" />
              <input
                v-model="searchText"
                type="text"
                class="sml-s-input"
                placeholder="搜索订阅名称、分类或扣款渠道…"
              />
            </div>
            <button
              type="button"
              class="sml-filter-btn"
              :class="{ active: masterFiltersOpen || hasSecondaryMasterFilter }"
              title="按扣款方式或周期筛选"
              aria-label="筛选扣款与周期"
              @click="masterFiltersOpen = !masterFiltersOpen"
            >
              <FIcon name="filter" :size="14" />
              <span v-if="hasSecondaryMasterFilter" class="sml-filter-dot" />
            </button>
          </div>

          <!-- Single-Line Scrollable Category Strip -->
          <div class="sml-cat-strip">
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

          <!-- Collapsible Secondary Filter Strip (Pay Type + Cycle) -->
          <div v-if="masterFiltersOpen" class="sml-pill-row sml-extra-filters">
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

          <!-- Scrollable List (Unified Fushi Tonal Row Cards with Adaptive Top-Right Watermarks!) -->
          <div class="sml-list">
            <FushiTonalCard
              v-for="sub in masterFilteredList"
              :key="sub.task.id"
              as="button"
              variant="row"
              interactive
              :active="selectedSub?.task.id === sub.task.id"
              :tint="sub.brandColor"
              :watermark="sub.watermark"
              class="sml-row"
              :class="{ paused: sub.meta.status === 'paused' || sub.meta.status === 'cancelled' }"
              @click="selectedId = sub.task.id"
            >
              <template #emblem>
                <SubscriptionEmblem
                  :brand-key="sub.brandKey"
                  :icon-data="sub.iconData"
                  :title="sub.task.title"
                  :emblem="sub.emblem"
                  :brand-color="sub.brandColor"
                  :size="38"
                  :radius="11"
                />
              </template>

              <div class="sml-row-main">
                <div class="sml-row-title-line">
                  <span class="sml-row-title">{{ sub.task.title }}</span>
                  <span v-if="sub.totalAccountsCount > 1" class="sml-tag">
                    共{{ sub.totalAccountsCount }}号
                  </span>
                  <span v-else-if="effectiveSplit(sub.meta) > 1" class="sml-tag">
                    {{ effectiveSplit(sub.meta) }}人拼车
                  </span>
                  <span v-if="sub.meta.status === 'ending'" class="sml-tag ending">已关续费</span>
                  <span v-else-if="sub.meta.status === 'trial'" class="sml-tag trial">试用</span>
                  <span v-else-if="sub.meta.status === 'paused'" class="sml-tag">已暂停</span>
                  <span v-else-if="sub.meta.status === 'cancelled'" class="sml-tag">已退订</span>
                  <span v-if="sub.promoPersonalOrig !== null" class="sml-tag promo">
                    {{ sub.meta.promoLabel || '首期' }} {{ formatCurrencyAmount(sub.promoPersonalOrig, sub.meta.currency) }}
                  </span>
                  <span v-else-if="sub.discountOrig > 0" class="sml-tag promo">
                    减{{ formatCurrencyAmount(sub.discountOrig, sub.meta.currency) }}
                  </span>
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
                  <s v-if="sub.discountOrig > 0" class="sml-list-orig tabular">
                    {{ formatCurrencyAmount(sub.originalListOrig, sub.meta.currency) }}
                  </s>
                  <span class="sml-cur-badge">{{ sub.meta.currency }}</span>
                  <span>/{{ CYCLE_META[sub.meta.cycle].short.replace('付', '') }}</span>
                </div>
              </div>
            </FushiTonalCard>

            <div v-if="!masterFilteredList.length" class="sml-empty">没有符合筛选条件的订阅</div>
          </div>
        </section>

        <!-- RIGHT DETAIL STAGE (Unified Fushi Hero + 22-Bar Scale + Financial Breakdown + Multi-Account Manager) -->
        <section v-if="selectedSub" class="wm-card sv-detail-card">
          <FushiTonalCard
            variant="preview"
            class="sv-det-fushi"
            :tint="selectedSub.brandColor"
            :watermark="selectedSub.watermark"
            :progress="selectedSub.window.progressPct"
          >
            <template #emblem>
              <SubscriptionEmblem
                :brand-key="selectedSub.brandKey"
                :icon-data="selectedSub.iconData"
                :title="selectedSub.task.title"
                :emblem="selectedSub.emblem"
                :brand-color="selectedSub.brandColor"
                :size="54"
                :radius="15"
              />
            </template>
            <div class="sv-det-title-row">
              <div class="sv-det-title-wrap">
                <div class="sv-det-name">{{ selectedSub.task.title }}</div>
                <div class="sv-det-sub">
                  {{ CYCLE_META[selectedSub.meta.cycle].label }} ·
                  {{ STATUS_LABELS[selectedSub.meta.status] }}
                  <template v-if="selectedSub.totalAccountsCount > 1"> · 共 {{ selectedSub.totalAccountsCount }} 个账号</template>
                  · {{ formatDueCountdown(selectedSub.window.remainDays, selectedSub.meta.status) }}
                </div>
              </div>
              <div class="sv-det-monthly tabular">
                <strong>¥{{ Math.round(selectedSub.monthlyCNY * 10) / 10 }}</strong>
                <span>/ 月均折合</span>
              </div>
            </div>
          </FushiTonalCard>

          <!-- CADENCE SIGNATURE 22-BAR VERTICAL-PILL COUNTDOWN SCALE -->
          <div class="sv-gauge-block">
            <div class="sv-gauge-meta">
              <span>本周期倒计时刻度</span>
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

          <!-- Compact 2-Column Financial & Status Spec Grid -->
          <div class="sv-spec-grid">
            <div class="sv-spec-cell">
              <span>订阅状态</span>
              <div class="sv-spec-val-line">
                <strong>{{ STATUS_LABELS[selectedSub.meta.status] }}</strong>
                <em class="sv-spec-pill" :class="selectedSub.meta.status">
                  <template v-if="selectedSub.meta.status === 'ending'">到期止续</template>
                  <template v-else-if="selectedSub.meta.status === 'trial'">试用护盾</template>
                  <template v-else-if="selectedSub.meta.autoRenew">自动扣款</template>
                  <template v-else>手动续费</template>
                </em>
              </div>
            </div>

            <div class="sv-spec-cell">
              <span>每期实付</span>
              <div class="sv-spec-val-line tabular">
                <strong>{{ formatCurrencyAmount(selectedSub.personalOrig, selectedSub.meta.currency) }}/{{ CYCLE_META[selectedSub.meta.cycle].short.replace('付', '') }}</strong>
                <s v-if="selectedSub.discountOrig > 0" class="sv-spec-strike">
                  {{ formatCurrencyAmount(selectedSub.originalListOrig, selectedSub.meta.currency) }}
                </s>
                <em v-if="selectedSub.discountOrig > 0" class="sv-spec-pill save">
                  省{{ formatCurrencyAmount(selectedSub.discountOrig, selectedSub.meta.currency) }}
                </em>
                <em v-else-if="effectiveSplit(selectedSub.meta) > 1" class="sv-spec-pill">
                  {{ effectiveSplit(selectedSub.meta) }}人拼车
                </em>
              </div>
            </div>

            <div class="sv-spec-cell">
              <span>优惠 / 首期特惠</span>
              <div class="sv-spec-val-line tabular">
                <template v-if="selectedSub.promoPersonalOrig !== null">
                  <strong>
                    {{ selectedSub.meta.promoLabel || '首期特惠' }}
                    {{ formatCurrencyAmount(selectedSub.promoPersonalOrig, selectedSub.meta.currency) }}
                  </strong>
                  <em v-if="selectedSub.promoSavingsOrig > 0" class="sv-spec-pill save">
                    首期省{{ formatCurrencyAmount(selectedSub.promoSavingsOrig, selectedSub.meta.currency) }}
                  </em>
                </template>
                <template v-else-if="selectedSub.monthlySavedCNY >= 0.5">
                  <strong>月均已省 ¥{{ Math.round(selectedSub.monthlySavedCNY * 10) / 10 }}</strong>
                </template>
                <template v-else>
                  <strong class="muted">无额外优惠</strong>
                </template>
              </div>
            </div>

            <div class="sv-spec-cell">
              <span>总月均 / 年化支出</span>
              <strong class="tabular">
                ¥{{ Math.round(selectedSub.monthlyCNY * 10) / 10 }}/月 · ¥{{ Math.round(selectedSub.yearlyCNY).toLocaleString('zh-CN') }}/年
              </strong>
            </div>

            <div class="sv-spec-cell">
              <span>分类 / 扣款渠道</span>
              <strong>{{ CATEGORY_META[selectedSub.meta.category].label }} · {{ selectedSub.meta.paymentMethod || '未设置' }}</strong>
            </div>

            <div class="sv-spec-cell">
              <span>{{ selectedSub.meta.status === 'ending' ? '到期停止日' : '下次扣款日' }}</span>
              <strong class="tabular">{{ selectedSub.window.nextDate }}</strong>
            </div>
          </div>

          <!-- Multi-Account / Sub-Subscriptions Section (e.g., Multiple AI Accounts under One Card!) -->
          <div class="sv-subacc-box">
            <div class="sv-subacc-head">
              <div class="sv-subacc-title">
                <span>多账号 / 子订阅</span>
                <em class="sv-subacc-count tabular">共 {{ selectedSub.totalAccountsCount }} 号</em>
              </div>
              <button type="button" class="sv-subacc-add-btn" @click="openSubAccAdder(selectedSub)">
                <FIcon name="add" :size="11" />
                <span>{{ subAccAdderOpen ? '收起' : '添加子订阅' }}</span>
              </button>
            </div>

            <div v-if="selectedSub.meta.accounts?.length" class="sv-subacc-list">
              <!-- Primary Account Row -->
              <div class="sv-subacc-row primary">
                <div class="sv-sa-info">
                  <strong>主账号</strong>
                  <span v-if="selectedSub.meta.plan" class="sv-sa-plan">{{ selectedSub.meta.plan }}</span>
                </div>
                <span class="sv-sa-price tabular">
                  {{ formatCurrencyAmount(selectedSub.personalOrig, selectedSub.meta.currency) }}/{{ CYCLE_META[selectedSub.meta.cycle].short.replace('付', '') }}
                </span>
                <span class="sv-sa-st" :class="selectedSub.meta.status">
                  {{ STATUS_LABELS[selectedSub.meta.status] }}
                </span>
              </div>

              <!-- Child Sub-Accounts -->
              <div v-for="acc in selectedSub.meta.accounts" :key="acc.id" class="sv-subacc-row">
                <div class="sv-sa-info">
                  <strong>{{ acc.label }}</strong>
                  <span v-if="acc.plan" class="sv-sa-plan">{{ acc.plan }}</span>
                </div>
                <span class="sv-sa-price tabular">
                  {{ formatCurrencyAmount(acc.price, acc.currency ?? selectedSub.meta.currency) }}/{{ CYCLE_META[acc.cycle ?? selectedSub.meta.cycle].short.replace('付', '') }}
                </span>
                <button
                  type="button"
                  class="sv-sa-st clickable"
                  :class="acc.status ?? 'active'"
                  title="点击切换状态（订阅中 / 已关续费 / 已暂停）"
                  @click="cycleDetailSubAccountStatus(selectedSub, acc.id)"
                >
                  {{ STATUS_LABELS[acc.status ?? 'active'] }}
                </button>
                <button
                  type="button"
                  class="sv-sa-del"
                  title="移除子订阅"
                  aria-label="移除子订阅"
                  @click="removeDetailSubAccount(selectedSub, acc.id)"
                >
                  <FIcon name="close" :size="10" />
                </button>
              </div>
            </div>

            <!-- Inline Quick Add Sub-Account Bar -->
            <form
              v-if="subAccAdderOpen"
              class="sv-subacc-form"
              @submit.prevent="addDetailSubAccount(selectedSub)"
            >
              <input
                v-model="draftSubLabel"
                type="text"
                class="sv-sa-input"
                placeholder="账号名（如 工作副号）"
              />
              <input
                v-model="draftSubPlan"
                type="text"
                class="sv-sa-input plan"
                placeholder="档位 (Plus/Max)"
              />
              <input
                v-model="draftSubPrice"
                type="number"
                step="0.01"
                min="0"
                class="sv-sa-input num tabular"
                :placeholder="`${CURRENCY_META[selectedSub.meta.currency].symbol}金额`"
              />
              <button type="submit" class="sv-sa-save">保存</button>
            </form>
          </div>

          <!-- Compact Actions Footer (with 1-Tap Stop-Renewal Toggle!) -->
          <div class="sv-det-actions">
            <button type="button" class="sv-act-btn" @click="openEditModal(selectedSub)">
              <FIcon name="edit" :size="13" />
              <span>编辑</span>
            </button>
            <button
              v-if="selectedSub.meta.status === 'active' || selectedSub.meta.status === 'ending'"
              type="button"
              class="sv-act-btn"
              :class="{ warm: selectedSub.meta.status === 'ending' }"
              @click="toggleEndingSub(selectedSub)"
            >
              <FIcon name="repeat" :size="13" />
              <span>{{ selectedSub.meta.status === 'ending' ? '恢复续费' : '关闭续费' }}</span>
            </button>
            <button type="button" class="sv-act-btn" @click="togglePauseSub(selectedSub)">
              <FIcon :name="selectedSub.meta.status === 'paused' ? 'check' : 'timer'" :size="13" />
              <span>{{ selectedSub.meta.status === 'paused' ? '恢复' : '暂停' }}</span>
            </button>
            <button type="button" class="sv-act-btn danger" @click="removeSub(selectedSub)">
              <FIcon name="delete" :size="13" />
              <span>删除</span>
            </button>
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
  --sub-cal-bg: linear-gradient(155deg, #ffffff 0%, #f3f5fa 100%);
  --sub-cal-wm: rgba(26, 32, 48, 0.055);
}

html[data-ws-theme='dark'] .sub-page {
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

/* Header (Enlarged Bold Black Editorial Display Typography, Zero Red Eyebrow) */
.sv-head {
  flex: none;
  padding: 18px 24px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.sv-head-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.sv-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 31px;
  font-weight: 880;
  letter-spacing: -0.038em;
  line-height: 1.06;
  color: var(--ws-ink);
}

.sv-date-chip {
  font-size: 13px;
  font-weight: 620;
  color: var(--ws-ink-muted);
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

/* Shared Calendar / Detail Shell Card */
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
  padding: 28px 30px;
  gap: 24px;
}

.sv-empty-emblem {
  width: 70px;
  height: 70px;
  border-radius: 18px;
  background: linear-gradient(135deg, #253456 0%, #141d33 100%);
  color: #fff;
  display: inline-grid;
  place-items: center;
}

.sv-empty-copy h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 820;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
}

.sv-empty-copy p {
  margin: 8px 0 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--fc-sub);
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
  background: var(--fc-fill);
  color: #ffffff;
}

.sv-btn-soft {
  background: color-mix(in srgb, var(--fc-ink) 11%, transparent);
  color: var(--fc-ink);
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

/* Hero Spend Card (FushiTonalCard inner typography) */
.sv-hero-emblem {
  width: 68px;
  height: 68px;
  border-radius: 18px;
  background: linear-gradient(145deg, #27375c 0%, #151f36 100%);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.she-mon {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  opacity: 0.72;
}

.she-day {
  font-size: 24px;
  font-weight: 900;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}

.sv-hero-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.sv-hero-label {
  font-size: 17px;
  font-weight: 840;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
}

.sv-hero-sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  font-weight: 620;
  color: var(--fc-sub);
}

.sv-save-pill {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, #10b981 18%, transparent);
  color: #0e8a62;
  font-size: 11px;
  font-weight: 750;
}

.sv-hero-amount {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--fc-ink);
}

.sv-hero-amount small {
  font-size: 18px;
  opacity: 0.58;
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

/* Proportional Fushi Tonal Category Treemap */
.sv-treemap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 392px;
}

.sv-treemap.single {
  grid-template-columns: 1fr;
  min-height: 200px;
}

.tm-tile {
  width: 100%;
  height: 100%;
}

.tm-name {
  display: block;
  font-size: 16px;
  font-weight: 840;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
}

.tm-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  font-weight: 640;
  color: var(--fc-sub);
}

.tm-bottom {
  margin-top: auto;
  padding-top: 12px;
}

.tm-price {
  font-size: 30px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--fc-ink);
}

.tm-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tm-sub-tile {
  min-height: 98px;
}

.tm-bottom-inline {
  margin-top: auto;
  padding-top: 6px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.tm-price-sm {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.025em;
  color: var(--fc-ink);
}

.tm-pct-tag {
  font-size: 11.5px;
  font-weight: 760;
  color: var(--fc-sub);
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
  height: 206px;
  border-radius: 24px;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.stagger-deck .stagger-card {
  position: absolute;
  transition:
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
    top 360ms cubic-bezier(0.22, 1, 0.36, 1),
    left 360ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 260ms ease,
    box-shadow 260ms ease;
}

.stagger-deck .stagger-card[data-pos='0'] {
  top: 42px;
  left: 0;
  right: 0;
  height: 162px;
  z-index: 30;
  transform: translateY(0) scale(1);
}

.stagger-deck .stagger-card[data-pos='1'] {
  top: 12px;
  left: 26px;
  right: 12px;
  height: 148px;
  z-index: 20;
  opacity: 0.96;
  transform: translateY(0) scale(0.985);
}

.stagger-deck .stagger-card[data-pos='2'] {
  top: 0;
  left: 52px;
  right: 24px;
  height: 134px;
  z-index: 10;
  opacity: 0.78;
  transform: translateY(-2px) scale(0.955);
}

.stagger-deck:hover .stagger-card[data-pos='1'] {
  transform: translateY(-4px) scale(0.99);
}

.sc-top,
.sc-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sc-brand-copy {
  min-width: 0;
  flex: 1;
}

.sc-name {
  font-size: 16.5px;
  font-weight: 840;
  line-height: 1.15;
  color: var(--fc-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-cycle {
  margin-top: 2px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fc-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-due-pill {
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 12%, transparent);
  color: var(--fc-ink);
  font-size: 11px;
  font-weight: 760;
}

.sc-bottom {
  justify-content: flex-start;
  gap: 28px;
}

.sc-kv {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sc-k {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--fc-sub);
}

.sc-v {
  font-size: 16px;
  font-weight: 860;
  line-height: 1.15;
  color: var(--fc-ink);
}

.sc-v em {
  font-style: normal;
  font-size: 11px;
  font-weight: 650;
  color: var(--fc-sub);
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

.sml-search-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.sml-search {
  flex: 1;
  min-width: 0;
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

.sml-filter-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}

.sml-filter-btn:hover,
.sml-filter-btn.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sml-filter-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #e85d2a;
}

.sml-cat-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 1px 0;
}

.sml-cat-strip::-webkit-scrollbar {
  display: none;
}

.sml-pill-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.sml-extra-filters {
  padding: 7px 9px;
  border-radius: 12px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
}

.sml-sep {
  width: 1px;
  height: 14px;
  background: var(--ws-hairline-strong);
  margin: 0 2px;
}

.sml-chip {
  flex: none;
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
  gap: 8px;
}

.sml-row.paused {
  opacity: 0.56;
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
  font-size: 14px;
  font-weight: 780;
  color: var(--fc-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sml-tag {
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 740;
  background: color-mix(in srgb, var(--fc-ink) 12%, transparent);
  color: var(--fc-ink);
}

.sml-tag.trial,
.sml-tag.ending {
  background: color-mix(in srgb, #e85d2a 18%, transparent);
  color: #c74315;
}

.sml-tag.promo {
  background: color-mix(in srgb, #0e9f6e 16%, transparent);
  color: #0b7a55;
}

.sml-list-orig {
  font-size: 10px;
  opacity: 0.55;
  margin-right: 2px;
}

.sml-row-sub {
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--fc-sub);
}

.sml-dots {
  display: inline-flex;
  gap: 2.5px;
}

.sml-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--fc-track);
}

.sml-dots i.lit {
  background: var(--fc-fill);
}

.sml-due.urgent {
  color: var(--fc-ink);
  font-weight: 760;
}

.sml-row-price {
  text-align: right;
  flex: none;
}

.sml-row-price strong {
  display: block;
  font-size: 15px;
  font-weight: 860;
  color: var(--fc-ink);
  line-height: 1.1;
}

.sml-cur-line {
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--fc-sub);
}

.sml-cur-badge {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 800;
  background: color-mix(in srgb, var(--fc-ink) 12%, transparent);
  color: var(--fc-ink);
}

.sml-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--ws-ink-muted);
}

/* Right Detail Card (Unified Fushi Tonal Hero + Cadence 22-Bar Scale) */
.sv-detail-card {
  padding: 20px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.sv-det-fushi {
  width: 100%;
}

.sv-det-title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.sv-det-title-wrap {
  min-width: 0;
  flex: 1;
}

.sv-det-name {
  font-size: 19px;
  font-weight: 840;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-det-sub {
  margin-top: 3px;
  font-size: 12px;
  font-weight: 620;
  color: var(--fc-sub);
}

.sv-det-monthly {
  text-align: right;
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex: none;
}

.sv-det-monthly strong {
  font-size: 30px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--fc-ink);
}

.sv-det-monthly span {
  font-size: 11.5px;
  font-weight: 620;
  color: var(--fc-sub);
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

/* Compact 2-Column Structured Spec Grid */
.sv-spec-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.sv-spec-cell {
  padding: 10px 13px;
  border-radius: 13px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sv-spec-cell span {
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-ink-muted);
}

.sv-spec-cell strong {
  font-size: 13px;
  font-weight: 740;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-spec-cell strong.muted {
  color: var(--ws-ink-muted);
  font-weight: 600;
}

.sv-spec-val-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.sv-spec-strike {
  font-size: 11.5px;
  color: var(--ws-ink-muted);
  opacity: 0.72;
}

.sv-spec-pill {
  font-style: normal;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 720;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
}

.sv-spec-pill.ending,
.sv-spec-pill.trial {
  background: color-mix(in srgb, #e85d2a 14%, transparent);
  color: #e85d2a;
}

.sv-spec-pill.save {
  background: color-mix(in srgb, #0e9f6e 15%, transparent);
  color: #0e8a62;
}

/* Multi-Account / Sub-Subscriptions Section */
.sv-subacc-box {
  position: relative;
  z-index: 1;
  padding: 11px 13px;
  border-radius: 15px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.sv-subacc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sv-subacc-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 720;
  color: var(--ws-ink);
}

.sv-subacc-count {
  font-style: normal;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 10.5px;
  font-weight: 700;
}

.sv-subacc-add-btn {
  height: 25px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 11px;
  font-weight: 660;
  cursor: pointer;
  transition: background-color 140ms ease, transform 120ms ease;
}

.sv-subacc-add-btn:hover {
  background: var(--ws-pill-hover);
}

.sv-subacc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sv-subacc-row {
  padding: 7px 10px;
  border-radius: 11px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  display: flex;
  align-items: center;
  gap: 8px;
}

.sv-subacc-row.primary {
  background: color-mix(in srgb, var(--ws-ink) 3.5%, var(--ws-card-bg));
}

.sv-sa-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sv-sa-info strong {
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-sa-plan {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 10px;
  font-weight: 700;
  flex: none;
}

.sv-sa-price {
  font-size: 12.5px;
  font-weight: 780;
  color: var(--ws-ink);
  flex: none;
}

.sv-sa-st {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 10.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  flex: none;
}

.sv-sa-st.clickable {
  cursor: pointer;
}

.sv-sa-st.active {
  background: color-mix(in srgb, #0e9f6e 15%, transparent);
  color: #0e8a62;
}

.sv-sa-st.ending,
.sv-sa-st.trial {
  background: color-mix(in srgb, #e85d2a 14%, transparent);
  color: #e85d2a;
}

.sv-sa-del {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ws-ink-muted);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
}

.sv-sa-del:hover {
  background: rgba(232, 76, 61, 0.12);
  color: #d93e30;
}

.sv-subacc-form {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sv-sa-input {
  flex: 1.2;
  min-width: 110px;
  height: 31px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.sv-sa-input.plan {
  flex: 0.9;
  min-width: 82px;
}

.sv-sa-input.num {
  flex: 0 0 74px;
  min-width: 74px;
}

.sv-sa-input:focus {
  border-color: var(--ws-ink);
}

.sv-sa-save {
  height: 31px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  flex: none;
}

.sv-det-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.sv-det-actions .sv-act-btn {
  flex: 1;
  min-width: 86px;
}

.sv-act-btn.warm {
  background: color-mix(in srgb, #e85d2a 11%, var(--ws-card-bg));
  border-color: color-mix(in srgb, #e85d2a 28%, transparent);
  color: #e85d2a;
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
  .sv-head.phone {
    padding: 0;
    margin-bottom: 10px;
  }

  .sv-head.phone .sv-head-right {
    width: 100%;
    justify-content: space-between;
    flex-wrap: nowrap;
    gap: 6px;
  }

  .sv-add-btn.icon {
    width: 34px;
    height: 34px;
    padding: 0;
    justify-content: center;
    flex: none;
  }

  .sv-hero-emblem {
    width: 56px;
    height: 56px;
  }

  .sv-hero-amount {
    font-size: 25px;
  }

  .sv-treemap {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .stagger-deck {
    height: 198px;
  }

  .stagger-deck .stagger-card[data-pos='0'] {
    height: 156px;
  }

  .sv-empty-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .sv-det-actions {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
