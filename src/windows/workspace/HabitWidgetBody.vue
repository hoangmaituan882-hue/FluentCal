<script setup lang="ts">
import { computed } from 'vue';
import type { HabitWidgetStyle, ISODate } from '@/types';
import {
  buildHabitHeatmap,
  buildHabitMilestoneJourney,
  buildHabitRecentBars,
  buildHabitWeeklyPillars,
  buildHabitWeekRings,
  evaluateHabitWindow,
  extractHeatmapMonthTicks,
  parseClockMinutes,
  type HabitHeatmapCell,
  type ResolvedHabit,
} from '@/lib/habits';
import NumberPop from './NumberPop.vue';

const props = withDefaults(
  defineProps<{
    habit: ResolvedHabit;
    widgetStyle: HabitWidgetStyle;
    selectedDay: ISODate;
    today: ISODate;
    weekStart: 0 | 1;
    heatmapWeeks: number;
    nowMin?: number;
    previewing?: boolean;
    previewLabel?: string;
  }>(),
  {
    nowMin: undefined,
    previewing: false,
    previewLabel: '',
  },
);

const emit = defineEmits<{
  openDetail: [];
  toggleDay: [iso: ISODate];
  selectDay: [iso: ISODate];
  cellEnter: [cell: HabitHeatmapCell, e: PointerEvent];
  cellLeave: [];
}>();

// 0. Window (Fixed Time-Window Live Countdown + 24h Segmented Rhythm Band)
const effectiveNowMin = computed(() => {
  if (typeof props.nowMin === 'number') return props.nowMin;
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
});

const windowTelemetry = computed(() =>
  props.widgetStyle === 'window'
    ? evaluateHabitWindow(props.habit.meta, props.habit.day, effectiveNowMin.value, props.today)
    : null,
);

const donePinPct = computed(() => {
  const t = windowTelemetry.value?.doneTime;
  const m = parseClockMinutes(t);
  return m !== null ? Math.round((m / 1440) * 1000) / 10 : null;
});

// 0b. Spectrum (Apple Health 20-Bar Pastel Vertical Spectral Tick Meter)
const SPECTRUM_BARS = 20;
const spectrumRatio = computed(() => {
  const h = props.habit;
  if (h.meta.kind === 'count') return Math.max(0, Math.min(1, h.day.ratio));
  if (h.meta.kind === 'quit') return h.day.state === 'relapse' ? 0.15 : Math.max(0.25, h.strength / 100);
  return h.day.state === 'done' ? 1 : Math.max(0.15, h.strength / 100);
});

const spectrumLitCount = computed(() => Math.round(spectrumRatio.value * SPECTRUM_BARS));

const spectrumHeadline = computed(() => {
  const h = props.habit;
  if (h.meta.kind === 'count') {
    const u = h.meta.unit?.trim() || '次';
    return `${formatCompactNum(h.day.value)}/${formatCompactNum(h.meta.target)} ${u}`;
  }
  if (h.meta.kind === 'quit') return h.day.state === 'relapse' ? '当日波动' : `克制 ${h.currentStreak} 天`;
  if (h.day.state === 'done') return '今日已达标';
  return h.strength >= 80 ? '高节律状态' : h.strength >= 55 ? '稳步养成中' : '轻量起步';
});

const spectrumLastTime = computed(() => {
  const list = props.habit.meta.logTimes?.[props.selectedDay];
  if (list?.length) return `最近 ${list[list.length - 1]}`;
  return props.habit.meta.windowStart ? `时段 ${props.habit.meta.windowStart}` : '全天弹性打卡';
});

function spectrumBarStyle(idx: number): Record<string, string> | undefined {
  if (idx >= spectrumLitCount.value) {
    return { transitionDelay: '0ms' };
  }
  // Smooth pastel-to-rich tonal ramp across the 20 bars (matching Apple Health Stress/Energy card)
  const frac = spectrumLitCount.value > 1 ? idx / (spectrumLitCount.value - 1) : 1;
  const mixPct = Math.round(34 + frac * 66);
  return {
    background: `color-mix(in srgb, var(--fc-fill) ${mixPct}%, var(--fc-track))`,
    transitionDelay: `${Math.min(idx, 14) * 12}ms`,
  };
}

// 1. Rings (7-day staggered circular dials)
const weekRings = computed(() =>
  props.widgetStyle === 'rings'
    ? buildHabitWeekRings(props.habit.meta, props.habit.task.start, props.selectedDay, props.today, props.weekStart)
    : [],
);
const ringsTopRow = computed(() => weekRings.value.slice(0, 4));
const ringsBottomRow = computed(() => weekRings.value.slice(4, 7));

const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

function ringOffset(ratio: number): number {
  return RING_C * (1 - Math.max(0, Math.min(1, ratio)));
}

// 2. Bars (multi-day horizontal comparison bars + goal threshold line + hatched zone)
const recentBars = computed(() =>
  props.widgetStyle === 'bars'
    ? buildHabitRecentBars(props.habit.meta, props.habit.task.start, props.selectedDay, props.today, 4)
    : null,
);

const barsUnit = computed(() => {
  if (props.habit.meta.kind === 'count') return props.habit.meta.unit?.trim() || '';
  return '次';
});

// 3. Gauge (dual 240deg semi-circular gauges + hero KPI + caliper tick ruler)
const ARC_R = 22;
const ARC_LEN = (240 / 360) * 2 * Math.PI * ARC_R; // ~92.15
const ARC_C = 2 * Math.PI * ARC_R;

const leftGaugeOffset = computed(() => ARC_LEN * (1 - Math.max(0, Math.min(1, props.habit.strength / 100))));
const rightGaugeRatio = computed(() =>
  props.habit.week.target > 0 ? Math.min(1, props.habit.week.done / props.habit.week.target) : 0,
);
const rightGaugeOffset = computed(() => ARC_LEN * (1 - rightGaugeRatio.value));

const rulerRatio = computed(() => {
  if (props.habit.meta.kind === 'count') return Math.max(0, Math.min(1, props.habit.day.ratio));
  if (props.habit.meta.kind === 'quit') return props.habit.day.state === 'relapse' ? 0 : 1;
  return props.habit.day.state === 'done' ? 1 : props.habit.strength / 100;
});

const RULER_TICKS = 22;
const activeTickIndex = computed(() => Math.round(rulerRatio.value * (RULER_TICKS - 1)));

const gaugeHeroValue = computed(() => {
  const h = props.habit;
  if (h.meta.kind === 'count') return `${h.day.value}/${h.meta.target}`;
  if (h.meta.kind === 'quit') return `${h.currentStreak}`;
  return h.day.state === 'done' ? '100%' : `${h.strength}%`;
});

const gaugeHeroLabel = computed(() => {
  const h = props.habit;
  if (h.meta.kind === 'count') return `${h.meta.unit?.trim() || '次'} · 今日`;
  if (h.meta.kind === 'quit') return h.day.state === 'relapse' ? '当日破戒' : '连续克制天';
  return h.day.state === 'done' ? '今日已完成' : '习惯强度';
});

const rulerRightLabel = computed(() => {
  const h = props.habit;
  if (h.meta.kind === 'count') return `${h.meta.target}${h.meta.unit?.trim() || ''}`;
  return '100%';
});

// 4. Journey (Apple Transit-style milestone station timeline)
const journey = computed(() =>
  props.widgetStyle === 'journey' ? buildHabitMilestoneJourney(props.habit.currentStreak) : null,
);

// 5. Pillars (4-week vertical liquid pill columns)
const pillars = computed(() =>
  props.widgetStyle === 'pillars'
    ? buildHabitWeeklyPillars(props.habit.meta, props.habit.task.start, props.today, props.weekStart, 4)
    : [],
);

const pillarsDelta = computed(() => {
  if (pillars.value.length < 2) return 0;
  const cur = pillars.value[pillars.value.length - 1];
  const prev = pillars.value[pillars.value.length - 2];
  return cur.done - prev.done;
});

// 6. Heatmap (16x7 or 12x7 contribution mosaic)
const heatmapData = computed(() => {
  if (props.widgetStyle !== 'heatmap') return null;
  const grid = buildHabitHeatmap(
    props.habit.meta,
    props.habit.task.start,
    props.today,
    props.heatmapWeeks,
    props.weekStart,
  );
  return { grid, ticks: extractHeatmapMonthTicks(grid) };
});

function formatCompactNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
</script>

<template>
  <div class="hwb-stage" :class="[`st-${widgetStyle}`, { previewing }]">
    <Transition name="hwb-badge">
      <span v-if="previewing && previewLabel" class="hwb-preview-pill" aria-hidden="true">
        <span class="hwb-preview-dot" />
        <span>预览 · {{ previewLabel }}</span>
      </span>
    </Transition>

    <Transition name="hwb-morph" mode="out-in">
      <!-- ══ 0. WINDOW: Fixed Time-Window Live Countdown + 24h Segmented Rhythm Band ══ -->
      <div
        v-if="widgetStyle === 'window' && windowTelemetry"
        key="window"
        class="hwb-win-deck"
        :class="`ph-${windowTelemetry.phase}`"
        role="button"
        tabindex="0"
        @click="emit('openDetail')"
        @keydown.enter.prevent="emit('openDetail')"
      >
      <div class="hwb-win-head">
        <div class="hwb-win-main">
          <span class="hwb-win-tag">{{ windowTelemetry.phaseLabel }}</span>
          <strong class="hwb-win-time tabular">
            <NumberPop :value="windowTelemetry.primaryReadout" />
          </strong>
        </div>
        <span class="hwb-win-range tabular">{{ windowTelemetry.startLabel }}–{{ windowTelemetry.endLabel }}</span>
      </div>

      <!-- 24h Thick Segmented Band (Echoing Apple Health Sleep Segmented Pill Bar) -->
      <div class="hwb-win-band" aria-hidden="true">
        <span v-for="s in 12" :key="s" class="hwb-win-seg" />
        <div
          class="hwb-win-slot"
          :style="{
            left: `${windowTelemetry.startPct}%`,
            width: `${Math.max(4, windowTelemetry.endPct - windowTelemetry.startPct)}%`,
          }"
        />
        <span
          class="hwb-win-now"
          :style="{ left: `${windowTelemetry.nowPct}%` }"
          title="当前时刻"
        />
        <span
          v-if="donePinPct !== null"
          class="hwb-win-done-pin"
          :style="{ left: `${donePinPct}%` }"
        />
      </div>

      <div class="hwb-win-foot tabular">
        <span class="hwb-win-ticks">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </span>
        <span class="hwb-win-hint">{{ windowTelemetry.subHint }}</span>
      </div>
    </div>

      <!-- ══ 0b. SPECTRUM: Apple Health 20-Bar Pastel Vertical Spectral Tick Meter ══ -->
      <div
        v-else-if="widgetStyle === 'spectrum'"
        key="spectrum"
        class="hwb-spec-deck"
      role="button"
      tabindex="0"
      @click="emit('openDetail')"
      @keydown.enter.prevent="emit('openDetail')"
    >
      <div class="hwb-spec-head tabular">
        <div class="hwb-spec-left">
          <strong class="hwb-spec-title">{{ spectrumHeadline }}</strong>
          <span class="hwb-spec-chip">强度 {{ habit.strength }}%</span>
        </div>
        <strong class="hwb-spec-pct">{{ Math.round(spectrumRatio * 100) }}%</strong>
      </div>

      <div class="hwb-spec-bars" aria-hidden="true">
        <span
          v-for="i in SPECTRUM_BARS"
          :key="i"
          class="hwb-spec-bar"
          :class="{ lit: i - 1 < spectrumLitCount }"
          :style="spectrumBarStyle(i - 1)"
        />
      </div>

      <div class="hwb-spec-foot tabular">
        <span>{{ spectrumLastTime }}</span>
        <span>本周 {{ habit.week.done }}/{{ habit.week.target }} 天</span>
      </div>
    </div>

      <!-- ══ 1. RINGS: Staggered 7-Day Circular Dials (Apple Watch / Habit Honeycomb) ══ -->
      <div v-else-if="widgetStyle === 'rings'" key="rings" class="hwb-rings-deck">
      <div class="hwb-rings-row">
        <button
          v-for="d in ringsTopRow"
          :key="d.iso"
          type="button"
          class="hwb-ring-btn"
          :class="[d.state, { today: d.isToday, sel: d.isSelected, future: d.isFuture }]"
          :disabled="d.isFuture"
          :title="`周${d.label} (${d.iso})`"
          @click.stop="emit('toggleDay', d.iso)"
        >
          <span v-if="d.isToday" class="hwb-ring-pip" aria-hidden="true" />
          <svg class="hwb-ring-svg" viewBox="0 0 46 46" aria-hidden="true">
            <circle class="hwb-ring-seg-bg" cx="23" cy="23" :r="RING_R" />
            <circle
              v-if="d.ratio > 0"
              class="hwb-ring-arc"
              cx="23"
              cy="23"
              :r="RING_R"
              :stroke-dasharray="RING_C"
              :stroke-dashoffset="ringOffset(d.ratio)"
            />
          </svg>
          <span class="hwb-ring-center tabular">
            <svg v-if="d.state === 'done'" class="hwb-ring-chk" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.3 5.8 10 11 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span v-else-if="d.state === 'skip'" class="hwb-ring-skip">休</span>
            <span v-else-if="d.state === 'relapse'" class="hwb-ring-warn">!</span>
            <span v-else-if="d.state === 'partial'" class="hwb-ring-val">{{ formatCompactNum(d.value) }}</span>
            <span v-else class="hwb-ring-wd">{{ d.label }}</span>
          </span>
        </button>
      </div>

      <div class="hwb-rings-row bottom">
        <button
          v-for="d in ringsBottomRow"
          :key="d.iso"
          type="button"
          class="hwb-ring-btn"
          :class="[d.state, { today: d.isToday, sel: d.isSelected, future: d.isFuture }]"
          :disabled="d.isFuture"
          :title="`周${d.label} (${d.iso})`"
          @click.stop="emit('toggleDay', d.iso)"
        >
          <span v-if="d.isToday" class="hwb-ring-pip" aria-hidden="true" />
          <svg class="hwb-ring-svg" viewBox="0 0 46 46" aria-hidden="true">
            <circle class="hwb-ring-seg-bg" cx="23" cy="23" :r="RING_R" />
            <circle
              v-if="d.ratio > 0"
              class="hwb-ring-arc"
              cx="23"
              cy="23"
              :r="RING_R"
              :stroke-dasharray="RING_C"
              :stroke-dashoffset="ringOffset(d.ratio)"
            />
          </svg>
          <span class="hwb-ring-center tabular">
            <svg v-if="d.state === 'done'" class="hwb-ring-chk" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.3 5.8 10 11 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span v-else-if="d.state === 'skip'" class="hwb-ring-skip">休</span>
            <span v-else-if="d.state === 'relapse'" class="hwb-ring-warn">!</span>
            <span v-else-if="d.state === 'partial'" class="hwb-ring-val">{{ formatCompactNum(d.value) }}</span>
            <span v-else class="hwb-ring-wd">{{ d.label }}</span>
          </span>
        </button>
      </div>
    </div>

      <!-- ══ 2. BARS: Multi-Day Horizontal Goal Bars + Vertical Target Line & Hatched Zone ══ -->
      <div
        v-else-if="widgetStyle === 'bars' && recentBars"
        key="bars"
        class="hwb-bars-deck"
      role="button"
      tabindex="0"
      @click="emit('openDetail')"
      @keydown.enter.prevent="emit('openDetail')"
    >
      <div class="hwb-bars-top tabular">
        <div class="hwb-bars-kpi">
          <strong class="hwb-bars-main">
            <NumberPop :value="formatCompactNum(recentBars.selectedValue)" />
            <small v-if="barsUnit">{{ barsUnit }}</small>
          </strong>
          <span
            class="hwb-bars-delta"
            :class="{ pos: recentBars.deltaFromAvg >= 0 }"
          >
            {{ recentBars.deltaFromAvg >= 0 ? `+${formatCompactNum(recentBars.deltaFromAvg)}` : formatCompactNum(recentBars.deltaFromAvg) }}
          </span>
        </div>
        <span class="hwb-bars-avg">日均 {{ formatCompactNum(recentBars.avgValue) }}{{ barsUnit }}</span>
      </div>

      <div class="hwb-bars-plot">
        <!-- Vertical Target Threshold Line & Diagonal Hatched Bonus Zone -->
        <div class="hwb-bars-canvas-bg" aria-hidden="true">
          <div
            class="hwb-bars-hatch"
            :style="{ left: `${recentBars.targetLinePct}%` }"
          />
          <div
            class="hwb-bars-goal-line"
            :style="{ left: `${recentBars.targetLinePct}%` }"
          />
        </div>

        <button
          v-for="row in recentBars.rows"
          :key="row.iso"
          type="button"
          class="hwb-bar-row"
          :class="{ current: row.isSelected, met: row.state === 'done' }"
          @click.stop="emit('selectDay', row.iso)"
        >
          <span class="hwb-bar-lbl">{{ row.label }}</span>
          <span class="hwb-bar-lane">
            <span
              class="hwb-bar-fill"
              :style="{ width: `${Math.max(row.value > 0 ? 5 : 0, row.barPct)}%` }"
            />
          </span>
        </button>
      </div>

      <div class="hwb-bars-scale tabular" aria-hidden="true">
        <span
          v-for="t in recentBars.scaleTicks"
          :key="t.value"
          class="hwb-bars-tick-lbl"
          :class="{ goal: t.value === recentBars.target, origin: t.value === 0 }"
          :style="{ left: `${t.pct}%` }"
        >
          {{ t.value }}
        </span>
      </div>
    </div>

      <!-- ══ 3. GAUGE: Dual Semi-Circular Instrument Arcs + Hero KPI + Precision Tick Ruler ══ -->
      <div
        v-else-if="widgetStyle === 'gauge'"
        key="gauge"
        class="hwb-gauge-deck"
      role="button"
      tabindex="0"
      @click="emit('openDetail')"
      @keydown.enter.prevent="emit('openDetail')"
    >
      <div class="hwb-gauge-top">
        <!-- Left Arc Gauge: Habit Strength -->
        <div class="hwb-dial">
          <svg class="hwb-dial-svg" viewBox="0 0 56 56" aria-hidden="true">
            <circle
              class="hwb-dial-track"
              cx="28"
              cy="28"
              :r="ARC_R"
              :stroke-dasharray="`${ARC_LEN} ${ARC_C}`"
            />
            <circle
              class="hwb-dial-fill"
              cx="28"
              cy="28"
              :r="ARC_R"
              :stroke-dasharray="`${ARC_LEN} ${ARC_C}`"
              :stroke-dashoffset="leftGaugeOffset"
            />
          </svg>
          <div class="hwb-dial-copy tabular">
            <strong>{{ habit.strength }}</strong>
            <span>强度%</span>
          </div>
        </div>

        <!-- Center Hero Metric -->
        <div class="hwb-gauge-center">
          <strong class="hwb-gauge-hero tabular">
            <NumberPop :value="gaugeHeroValue" />
          </strong>
          <span class="hwb-gauge-sub">{{ gaugeHeroLabel }}</span>
        </div>

        <!-- Right Arc Gauge: Weekly Quota -->
        <div class="hwb-dial">
          <svg class="hwb-dial-svg" viewBox="0 0 56 56" aria-hidden="true">
            <circle
              class="hwb-dial-track"
              cx="28"
              cy="28"
              :r="ARC_R"
              :stroke-dasharray="`${ARC_LEN} ${ARC_C}`"
            />
            <circle
              class="hwb-dial-fill"
              cx="28"
              cy="28"
              :r="ARC_R"
              :stroke-dasharray="`${ARC_LEN} ${ARC_C}`"
              :stroke-dashoffset="rightGaugeOffset"
            />
          </svg>
          <div class="hwb-dial-copy tabular">
            <strong>{{ habit.week.done }}/{{ habit.week.target }}</strong>
            <span>本周</span>
          </div>
        </div>
      </div>

      <!-- Bottom Precision Caliper Tick Ruler -->
      <div class="hwb-ruler" aria-hidden="true">
        <span class="hwb-ruler-end tabular">0</span>
        <div class="hwb-ruler-ticks">
          <span
            v-for="i in RULER_TICKS"
            :key="i"
            class="hwb-tick"
            :class="{
              lit: i - 1 <= activeTickIndex && rulerRatio > 0,
              thumb: i - 1 === activeTickIndex,
            }"
          />
        </div>
        <span class="hwb-ruler-end tabular">{{ rulerRightLabel }}</span>
      </div>
    </div>

      <!-- ══ 4. JOURNEY: Apple Transit-Style Clean-Day / Streak Milestone Track ══ -->
      <div
        v-else-if="widgetStyle === 'journey' && journey"
        key="journey"
        class="hwb-journey-deck"
      role="button"
      tabindex="0"
      @click="emit('openDetail')"
      @keydown.enter.prevent="emit('openDetail')"
    >
      <div class="hwb-j-head">
        <div class="hwb-j-pill tabular">
          <NumberPop :value="journey.streak" />
          <span>天</span>
        </div>
        <div class="hwb-j-dest">
          <span class="hwb-j-kicker">{{ habit.meta.kind === 'quit' ? '下一里程碑' : '连胜下一站' }}</span>
          <strong class="hwb-j-next tabular">→ {{ journey.nextMilestone }} 天</strong>
        </div>
        <span class="hwb-j-rem tabular">
          {{ journey.daysToNext > 0 ? `还差 ${journey.daysToNext} 天` : '已登顶' }}
        </span>
      </div>

      <div class="hwb-j-rail-wrap">
        <div class="hwb-j-rail" aria-hidden="true">
          <div class="hwb-j-rail-fill" :style="{ width: `${journey.trackPct}%` }" />
          <span class="hwb-j-cursor" :style="{ left: `${journey.trackPct}%` }" />
        </div>
        <div class="hwb-j-stations">
          <div
            v-for="st in journey.stations"
            :key="st.days"
            class="hwb-j-st"
            :class="{ reached: st.reached, next: st.isNext }"
          >
            <span class="hwb-j-dot" />
            <span class="hwb-j-lbl tabular">{{ st.label }}</span>
          </div>
        </div>
      </div>
    </div>

      <!-- ══ 5. PILLARS: Apple Finance 4-Week Vertical Liquid Pill Columns ══ -->
      <div
        v-else-if="widgetStyle === 'pillars'"
        key="pillars"
        class="hwb-pillars-deck"
      role="button"
      tabindex="0"
      @click="emit('openDetail')"
      @keydown.enter.prevent="emit('openDetail')"
    >
      <div class="hwb-p-left">
        <span class="hwb-p-kicker">{{ habit.meta.weeklyTarget >= 7 ? '本周进度' : `每周 ${habit.meta.weeklyTarget} 天目标` }}</span>
        <strong class="hwb-p-big tabular">
          <NumberPop :value="habit.week.done" /><small>/{{ habit.week.target }} 天</small>
        </strong>
        <div class="hwb-p-chips tabular">
          <span class="hwb-p-sub">强度 {{ habit.strength }}%</span>
          <span class="hwb-p-delta" :class="{ pos: pillarsDelta >= 0 }">
            {{ pillarsDelta > 0 ? `+${pillarsDelta} 天` : pillarsDelta < 0 ? `${pillarsDelta} 天` : '持平' }}
          </span>
        </div>
      </div>

      <div class="hwb-p-cols">
        <div
          v-for="p in pillars"
          :key="p.weekIso"
          class="hwb-p-col"
          :class="{ current: p.isCurrent, met: p.met, relapse: p.hasRelapse }"
          :title="`${p.label}：${p.done}/${p.target} 天`"
        >
          <span class="hwb-p-lbl">{{ p.label }}</span>
          <div class="hwb-p-capsule">
            <div class="hwb-p-fill" :style="{ height: `${Math.max(p.done > 0 ? 18 : 0, Math.round(p.ratio * 100))}%` }" />
            <span v-if="p.hasRelapse" class="hwb-p-badge warn" aria-hidden="true">!</span>
            <span v-else-if="p.met" class="hwb-p-badge ok" aria-hidden="true">✓</span>
          </div>
        </div>
      </div>
    </div>

      <!-- ══ 6. HEATMAP: Optional 16x7 / 12x7 Contribution Matrix ══ -->
      <div v-else-if="widgetStyle === 'heatmap' && heatmapData" key="heatmap" class="hwb-hm-wrap">
        <div
          class="hv-hm-months"
          :style="{ '--hm-cols': heatmapWeeks }"
          aria-hidden="true"
        >
          <span
            v-for="tick in heatmapData.ticks"
            :key="tick.col"
            class="hv-hm-month-lbl"
            :style="{ gridColumn: `${tick.col + 1} / span 3` }"
          >
            {{ tick.label }}
          </span>
        </div>

        <div
          class="hv-heatmap"
          role="button"
          tabindex="0"
          :aria-label="`查看 ${habit.task.title} 完整月历与补签`"
          @click="emit('openDetail')"
          @keydown.enter.prevent="emit('openDetail')"
          @pointerleave="emit('cellLeave')"
        >
          <div
            v-for="(col, ci) in heatmapData.grid"
            :key="ci"
            class="hv-hm-col"
          >
            <span
              v-for="cell in col"
              :key="cell.iso"
              class="hv-hm-cell"
              :class="[
                `lv-${cell.level}`,
                cell.state,
                { today: cell.isToday, sel: cell.iso === selectedDay },
              ]"
              @pointerenter="emit('cellEnter', cell, $event)"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tabular {
  font-variant-numeric: tabular-nums;
}

.hwb-stage {
  position: relative;
  margin-top: 10px;
  min-height: 126px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-radius: 17px;
  transition: box-shadow var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hwb-stage.previewing {
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--fc-fill) 52%, transparent);
}

.hwb-stage.st-heatmap {
  min-height: 126px;
  margin-top: 10px;
}

.hwb-hm-wrap {
  width: 100%;
}

/* Floating Live-Preview Frosted Pill inside Widget Stage */
.hwb-preview-pill {
  position: absolute;
  top: -9px;
  right: 10px;
  z-index: 6;
  padding: 2px 8px 2px 6px;
  border-radius: 999px;
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--fc-fill) 36%, transparent);
  font-size: 10px;
  font-weight: 760;
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  pointer-events: none;
}

.hwb-preview-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: hwb-live-pulse 1.4s ease-in-out infinite;
}

@keyframes hwb-live-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.75);
  }
}

.hwb-badge-enter-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-fast, 250ms) var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}
.hwb-badge-leave-active {
  transition:
    opacity 110ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform 110ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwb-badge-enter-from,
.hwb-badge-leave-to {
  opacity: 0;
  transform: translateY(3px) scale(0.92);
}

/* Cross-Blur Soft Widget Morph (transitions-polish: snappy for live gallery preview) */
.hwb-morph-enter-active {
  transition:
    opacity 200ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    filter 200ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform 200ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwb-morph-leave-active {
  transition:
    opacity 110ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    filter 110ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform 110ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwb-morph-enter-from {
  opacity: 0;
  filter: blur(var(--blur-small, 2px));
  transform: translateY(var(--distance-micro, 4px)) scale(0.985);
}
.hwb-morph-leave-to {
  opacity: 0;
  filter: blur(var(--blur-small, 2px));
  transform: translateY(-3px) scale(0.99);
}

/* Subtle tactile hover lift across clickable widget decks */
.hwb-win-deck,
.hwb-spec-deck,
.hwb-bars-deck,
.hwb-gauge-deck,
.hwb-journey-deck,
.hwb-pillars-deck {
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

@media (hover: hover) {
  .hwb-win-deck:hover,
  .hwb-spec-deck:hover,
  .hwb-bars-deck:hover,
  .hwb-gauge-deck:hover,
  .hwb-journey-deck:hover,
  .hwb-pillars-deck:hover {
    background: color-mix(in srgb, var(--fc-ink) 8.5%, transparent);
  }
}

.hwb-win-deck:active,
.hwb-spec-deck:active,
.hwb-bars-deck:active,
.hwb-gauge-deck:active,
.hwb-journey-deck:active,
.hwb-pillars-deck:active {
  transform: scale(0.992);
}

/* ── 0. WINDOW: Fixed Time-Window Live Countdown + 24h Segmented Band ── */
.hwb-win-deck {
  padding: 11px 12px 10px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
}

.hwb-win-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hwb-win-main {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.hwb-win-tag {
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-fill) 16%, transparent);
  color: var(--fc-ink);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;
}

.hwb-win-deck.ph-active .hwb-win-tag,
.hwb-win-deck.ph-done .hwb-win-tag {
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
}

.hwb-win-time {
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--fc-ink);
}

.hwb-win-range {
  flex: none;
  padding: 3px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--fc-ink) 8%, transparent);
  color: var(--fc-sub);
  font-size: 10.5px;
  font-weight: 740;
}

.hwb-win-band {
  position: relative;
  height: 24px;
  border-radius: 9px;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 2px;
}

.hwb-win-seg {
  height: 100%;
  background: color-mix(in srgb, var(--fc-track) 85%, transparent);
  border-radius: 2px;
}

.hwb-win-slot {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--fc-fill) 82%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fc-on-fill, #ffffff) 22%, transparent);
  transition:
    left var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    width var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hwb-win-now {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2.5px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--fc-ink);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--fc-bg) 75%, transparent);
  z-index: 2;
  transition: left var(--duration-slow, 400ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hwb-win-deck.ph-active .hwb-win-now {
  background: var(--fc-on-fill, #ffffff);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--fc-fill) 45%, transparent);
  animation: hwb-live-pulse 1.8s ease-in-out infinite;
}

.hwb-win-done-pin {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--fc-on-fill, #ffffff);
  border: 2px solid var(--fc-fill);
  z-index: 3;
}

.hwb-win-foot {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hwb-win-ticks {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  font-weight: 700;
  color: color-mix(in srgb, var(--fc-sub) 75%, transparent);
}

.hwb-win-hint {
  font-size: 10px;
  font-weight: 660;
  color: var(--fc-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 0b. SPECTRUM: Apple Health 20-Bar Pastel Spectral Meter ── */
.hwb-spec-deck {
  padding: 11px 12px 10px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
}

.hwb-spec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.hwb-spec-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.hwb-spec-title {
  font-size: 16.5px;
  font-weight: 880;
  letter-spacing: -0.025em;
  color: var(--fc-ink);
  white-space: nowrap;
}

.hwb-spec-chip {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-fill) 16%, transparent);
  color: var(--fc-ink);
  font-size: 10px;
  font-weight: 740;
}

.hwb-spec-pct {
  font-size: 15px;
  font-weight: 860;
  color: var(--fc-sub);
}

.hwb-spec-bars {
  height: 36px;
  display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr));
  gap: 4px;
  align-items: stretch;
}

.hwb-spec-bar {
  border-radius: 999px;
  background: var(--fc-track);
  transition: background-color 260ms var(--ease-smooth-out), transform 220ms var(--ease-smooth-out);
}

.hwb-spec-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 680;
  color: var(--fc-sub);
}

/* ── 1. RINGS: Staggered 7-Day Honeycomb Circular Dials ── */
.hwb-rings-deck {
  padding: 10px 10px 9px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.hwb-rings-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.hwb-rings-row.bottom {
  gap: 12px;
}

.hwb-ring-btn {
  position: relative;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-bg) 52%, transparent);
  color: var(--fc-ink);
  display: inline-grid;
  place-items: center;
  font: inherit;
  cursor: pointer;
  transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out), background-color var(--duration-quick, 150ms) ease;
}

.hwb-ring-btn:hover:not(:disabled) {
  transform: scale(1.08);
  background: color-mix(in srgb, var(--fc-ink) 8%, transparent);
}

.hwb-ring-btn:active:not(:disabled) {
  transform: scale(0.93);
}

.hwb-ring-btn.future {
  opacity: 0.42;
  cursor: default;
}

.hwb-ring-pip {
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--fc-fill);
  z-index: 2;
}

.hwb-ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.hwb-ring-seg-bg {
  fill: none;
  stroke: var(--fc-track);
  stroke-width: 3.4;
  stroke-dasharray: 26 4;
  stroke-linecap: round;
}

.hwb-ring-arc {
  fill: none;
  stroke: var(--fc-fill);
  stroke-width: 3.8;
  stroke-linecap: round;
  transition: stroke-dashoffset 360ms var(--ease-smooth-out);
}

.hwb-ring-btn.skip .hwb-ring-seg-bg {
  stroke: color-mix(in srgb, var(--fc-fill) 52%, transparent);
  stroke-dasharray: 4 4;
}

.hwb-ring-btn.relapse .hwb-ring-seg-bg {
  stroke: #f59e0b;
}

.hwb-ring-center {
  position: relative;
  z-index: 1;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.hwb-ring-chk {
  width: 15px;
  height: 15px;
  color: var(--fc-fill);
}

.hwb-ring-wd {
  font-size: 11px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-ring-btn.today .hwb-ring-wd {
  color: var(--fc-ink);
  font-weight: 840;
}

.hwb-ring-val {
  font-size: 11px;
  font-weight: 840;
  color: var(--fc-ink);
}

.hwb-ring-skip {
  font-size: 10.5px;
  color: var(--fc-sub);
}

.hwb-ring-warn {
  font-size: 12px;
  font-weight: 900;
  color: #d97706;
}

/* ── 2. BARS: Apple Sleep-Style Multi-Day Horizontal Goal Bars + Hatched Zone ── */
.hwb-bars-deck {
  padding: 10px 12px 9px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  flex-direction: column;
  gap: 7px;
  cursor: pointer;
}

.hwb-bars-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hwb-bars-kpi {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hwb-bars-main {
  font-size: 15.5px;
  font-weight: 880;
  color: var(--fc-ink);
  letter-spacing: -0.02em;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}

.hwb-bars-main small {
  font-size: 11px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-bars-delta {
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--fc-ink) 10%, transparent);
  color: var(--fc-sub);
  font-size: 10px;
  font-weight: 800;
}

.hwb-bars-delta.pos {
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
}

.hwb-bars-avg {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--fc-sub);
  letter-spacing: 0.01em;
}

.hwb-bars-plot {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.hwb-bars-canvas-bg {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 36px;
  right: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: 6px;
}

.hwb-bars-hatch {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background: repeating-linear-gradient(
    -52deg,
    color-mix(in srgb, var(--fc-fill) 19%, transparent) 0 1.8px,
    transparent 1.8px 6px
  );
}

.hwb-bars-goal-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.8px;
  background: color-mix(in srgb, var(--fc-fill) 86%, transparent);
  border-radius: 2px;
}

.hwb-bar-row {
  position: relative;
  z-index: 1;
  border: 0;
  padding: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font: inherit;
}

.hwb-bar-lbl {
  width: 28px;
  flex: none;
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-bar-row.current .hwb-bar-lbl {
  color: var(--fc-ink);
  font-weight: 860;
}

.hwb-bar-lane {
  flex: 1;
  height: 11px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--fc-ink) 7%, transparent);
  overflow: hidden;
  display: flex;
  align-items: center;
}

.hwb-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: color-mix(in srgb, var(--fc-fill) 52%, var(--fc-track));
  transition: width 320ms var(--ease-smooth-out);
}

.hwb-bar-row.current .hwb-bar-fill {
  background: var(--fc-fill);
}

.hwb-bars-scale {
  position: relative;
  margin-left: 36px;
  height: 12px;
  font-size: 9.5px;
  font-weight: 700;
  color: color-mix(in srgb, var(--fc-sub) 75%, transparent);
}

.hwb-bars-tick-lbl {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  line-height: 1;
}

.hwb-bars-tick-lbl.origin {
  transform: none;
}

.hwb-bars-tick-lbl.goal {
  color: var(--fc-ink);
  font-weight: 840;
}

/* ── 3. GAUGE: Dual Semi-Circular Arcs + Hero Readout + Caliper Tick Ruler ── */
.hwb-gauge-deck {
  padding: 10px 12px 9px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
}

.hwb-gauge-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hwb-dial {
  position: relative;
  width: 56px;
  height: 54px;
  flex: none;
  display: grid;
  place-items: center;
}

.hwb-dial-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(150deg);
}

.hwb-dial-track {
  fill: none;
  stroke: var(--fc-track);
  stroke-width: 4.5;
  stroke-linecap: round;
}

.hwb-dial-fill {
  fill: none;
  stroke: var(--fc-fill);
  stroke-width: 4.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 400ms var(--ease-smooth-out);
}

.hwb-dial-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 3px;
  line-height: 1.05;
}

.hwb-dial-copy strong {
  font-size: 12.5px;
  font-weight: 860;
  color: var(--fc-ink);
}

.hwb-dial-copy span {
  margin-top: 1px;
  font-size: 8.5px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-gauge-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 2px;
}

.hwb-gauge-hero {
  font-size: 23px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--fc-ink);
}

.hwb-gauge-sub {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-ruler {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hwb-ruler-end {
  font-size: 10px;
  font-weight: 740;
  color: var(--fc-sub);
  flex: none;
}

.hwb-ruler-ticks {
  flex: 1;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
}

.hwb-tick {
  width: 2px;
  height: 9px;
  border-radius: 999px;
  background: var(--fc-track);
  transition: background-color 200ms ease, height 200ms var(--ease-smooth-out);
}

.hwb-tick.lit {
  background: color-mix(in srgb, var(--fc-fill) 62%, transparent);
}

.hwb-tick.thumb {
  width: 4px;
  height: 16px;
  background: var(--fc-fill);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--fc-fill) 24%, transparent);
}

/* ── 4. JOURNEY: Apple Transit-Style Milestone Track ── */
.hwb-journey-deck {
  padding: 11px 12px 10px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  flex-direction: column;
  gap: 13px;
  cursor: pointer;
}

.hwb-j-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hwb-j-pill {
  flex: none;
  padding: 6px 11px;
  border-radius: 11px;
  background: var(--fc-fill);
  color: var(--fc-on-fill, #ffffff);
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
}

.hwb-j-pill span {
  font-size: 11px;
  font-weight: 740;
  opacity: 0.85;
}

.hwb-j-dest {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.hwb-j-kicker {
  font-size: 9.5px;
  font-weight: 740;
  color: var(--fc-sub);
  letter-spacing: 0.02em;
}

.hwb-j-next {
  font-size: 14px;
  font-weight: 860;
  color: var(--fc-ink);
  letter-spacing: -0.02em;
}

.hwb-j-rem {
  flex: none;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 9%, transparent);
  color: var(--fc-ink);
  font-size: 10.5px;
  font-weight: 760;
}

.hwb-j-rail-wrap {
  position: relative;
  padding-top: 6px;
}

.hwb-j-rail {
  position: relative;
  height: 4px;
  margin: 0 12px;
  border-radius: 999px;
  background: var(--fc-track);
}

.hwb-j-rail-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--fc-fill);
  transition: width 400ms var(--ease-smooth-out);
}

.hwb-j-cursor {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--fc-fill);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--fc-fill) 28%, var(--fc-bg));
  transition: left 400ms var(--ease-smooth-out);
}

.hwb-j-stations {
  margin-top: -7px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.hwb-j-st {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 26px;
}

.hwb-j-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--fc-bg);
  border: 2px solid var(--fc-track);
  box-sizing: border-box;
}

.hwb-j-st.reached .hwb-j-dot {
  background: var(--fc-fill);
  border-color: var(--fc-fill);
}

.hwb-j-st.next .hwb-j-dot {
  border-color: var(--fc-fill);
  transform: scale(1.15);
}

.hwb-j-lbl {
  font-size: 10px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-j-st.reached .hwb-j-lbl,
.hwb-j-st.next .hwb-j-lbl {
  color: var(--fc-ink);
  font-weight: 820;
}

/* ── 5. PILLARS: Apple Finance 4-Week Vertical Liquid Pill Columns ── */
.hwb-pillars-deck {
  padding: 10px 12px 9px;
  border-radius: 17px;
  background: color-mix(in srgb, var(--fc-ink) 6%, transparent);
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.hwb-p-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.hwb-p-kicker {
  font-size: 10px;
  font-weight: 740;
  color: var(--fc-sub);
}

.hwb-p-big {
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--fc-ink);
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}

.hwb-p-big small {
  font-size: 12px;
  font-weight: 740;
  color: var(--fc-sub);
}

.hwb-p-chips {
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.hwb-p-sub {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--fc-sub);
}

.hwb-p-delta {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 10%, transparent);
  color: var(--fc-sub);
  font-size: 10px;
  font-weight: 780;
}

.hwb-p-delta.pos {
  background: color-mix(in srgb, var(--fc-fill) 18%, transparent);
  color: var(--fc-ink);
}

.hwb-p-cols {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 7px;
}

.hwb-p-col {
  width: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.hwb-p-lbl {
  font-size: 9.5px;
  font-weight: 720;
  color: var(--fc-sub);
  white-space: nowrap;
}

.hwb-p-col.current .hwb-p-lbl {
  color: var(--fc-ink);
  font-weight: 860;
}

.hwb-p-capsule {
  position: relative;
  width: 100%;
  height: 76px;
  border-radius: 10px;
  background: var(--fc-track);
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}

.hwb-p-fill {
  width: 100%;
  background: color-mix(in srgb, var(--fc-fill) 78%, transparent);
  border-radius: 8px 8px 0 0;
  transition: height 360ms var(--ease-smooth-out);
}

.hwb-p-col.current .hwb-p-fill,
.hwb-p-col.met .hwb-p-fill {
  background: var(--fc-fill);
}

.hwb-p-badge {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  font-size: 10px;
  font-weight: 900;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
}

.hwb-p-badge.ok {
  background: var(--fc-on-fill, #ffffff);
  color: var(--fc-fill);
}

.hwb-p-badge.warn {
  background: #f59e0b;
  color: #ffffff;
}

/* ── 6. HEATMAP (Preserved Optional 6th Style) ── */
.hv-hm-months {
  margin-top: 9px;
  display: grid;
  grid-template-columns: repeat(var(--hm-cols, 16), minmax(0, 1fr));
  column-gap: 3.5px;
  align-items: center;
  height: 13px;
}

.hv-hm-month-lbl {
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  color: color-mix(in srgb, var(--fc-sub) 78%, transparent);
  white-space: nowrap;
  user-select: none;
}

.hv-heatmap {
  margin-top: 4px;
  display: flex;
  gap: 3.5px;
  width: 100%;
  cursor: pointer;
}

.hv-hm-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3.5px;
}

.hv-hm-cell {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 3.5px;
  background: var(--fc-track);
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out);
}

@media (hover: hover) {
  .hv-hm-cell:not(.future):hover {
    transform: scale(1.24);
    z-index: 2;
    position: relative;
    box-shadow: 0 0 0 1.6px var(--fc-ink);
  }
}

.hv-hm-cell.future {
  opacity: 0.34;
}

.hv-hm-cell.lv-1 {
  background: color-mix(in srgb, var(--fc-fill) 34%, var(--fc-track));
}

.hv-hm-cell.lv-2 {
  background: color-mix(in srgb, var(--fc-fill) 58%, var(--fc-track));
}

.hv-hm-cell.lv-3 {
  background: color-mix(in srgb, var(--fc-fill) 80%, var(--fc-track));
}

.hv-hm-cell.lv-4 {
  background: var(--fc-fill);
}

.hv-hm-cell.skip {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--fc-fill) 52%, transparent);
}

.hv-hm-cell.relapse {
  background: color-mix(in srgb, #f59e0b 78%, transparent);
}

.hv-hm-cell.sel {
  box-shadow: 0 0 0 1.6px var(--fc-ink);
}

@media (max-width: 639px) {
  .hwb-stage {
    min-height: 114px;
  }

  .hwb-rings-row,
  .hwb-rings-row.bottom {
    gap: 8px;
  }

  .hwb-ring-btn {
    width: 42px;
    height: 42px;
  }

  .hwb-p-col {
    width: 30px;
  }

  .hwb-p-big {
    font-size: 21px;
  }

  .hwb-gauge-hero {
    font-size: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hwb-morph-enter-active,
  .hwb-morph-leave-active,
  .hwb-badge-enter-active,
  .hwb-badge-leave-active,
  .hwb-preview-dot,
  .hwb-win-deck.ph-active .hwb-win-now,
  .hwb-spec-bar,
  .hwb-ring-arc,
  .hwb-bar-fill,
  .hwb-dial-fill,
  .hwb-j-rail-fill,
  .hwb-j-cursor,
  .hwb-p-fill,
  .hv-hm-cell {
    animation: none !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
  }
}
</style>
