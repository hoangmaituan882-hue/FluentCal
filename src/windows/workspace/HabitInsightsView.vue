<script setup lang="ts">
import { computed, ref } from 'vue';
import { FIcon } from '@/fluent';
import type { ISODate } from '@/types';
import {
  computeHabitTimeInsights,
  formatHabitShortDate,
  minutesToHHMM,
  type HabitHourBucket,
  type ResolvedHabit,
} from '@/lib/habits';
import HabitEmblem from './HabitEmblem.vue';
import NumberPop from './NumberPop.vue';
import { useSlidingIndicator } from './useSlidingIndicator';

const props = defineProps<{
  habits: ResolvedHabit[];
  today: ISODate;
  isPhone?: boolean;
}>();

const emit = defineEmits<{
  openHabit: [habit: ResolvedHabit];
}>();

// Scope filter: 'all' or specific habit ID
const scopeId = ref<string>('all');
const hoveredHour = ref<HabitHourBucket | null>(null);
const hoveredDayIdx = ref<number | null>(null);

// Sliding indicator for Scope Filter Bar (inner track scrolls cleanly together with pills)
const scopeTrackRef = ref<HTMLElement>();
const { style: scopePillStyle, ready: scopePillReady, visible: scopePillVisible } = useSlidingIndicator(
  scopeTrackRef,
  '.hi-scope-pill.active',
  [scopeId, () => props.habits.length, () => props.isPhone],
);

function selectScope(id: string, ev?: MouseEvent) {
  scopeId.value = id;
  hoveredHour.value = null;
  hoveredDayIdx.value = null;
  const btn = ev?.currentTarget as HTMLElement | null;
  btn?.scrollIntoView?.({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
}

const hoveredDayReadout = computed(() => {
  if (hoveredDayIdx.value === null) return null;
  const day = insights.value.recentDailyPoints[hoveredDayIdx.value];
  if (!day) return null;
  if (!day.timesMin.length) return `${day.label} · 无打卡时刻`;
  const preview = day.timesMin.slice(0, 3).map(minutesToHHMM).join(', ');
  const more = day.timesMin.length > 3 ? ` 等${day.timesMin.length}次` : '';
  return `${day.label} · ${preview}${more}`;
});

const scopedHabits = computed(() => {
  if (scopeId.value === 'all') return props.habits;
  const hit = props.habits.find((h) => h.task.id === scopeId.value);
  return hit ? [hit] : props.habits;
});

const activeScopeHabit = computed(() =>
  scopeId.value === 'all' ? null : (props.habits.find((h) => h.task.id === scopeId.value) ?? null),
);

const accentColor = computed(() => activeScopeHabit.value?.meta.color ?? '#0EA5E9');

const insights = computed(() => computeHabitTimeInsights(scopedHabits.value, props.today));

const avgStrength = computed(() => {
  const list = scopedHabits.value;
  if (!list.length) return 0;
  return Math.round(list.reduce((sum, h) => sum + h.strength, 0) / list.length);
});

const bestHistoricalStreak = computed(() =>
  scopedHabits.value.reduce((max, h) => Math.max(max, h.bestStreak), 0),
);

// 20-bar spectral consistency meter (Apple Health Stress/Energy aesthetic)
const SPEC_COUNT = 20;
const consistencyBarsLit = computed(() => {
  if (!insights.value.totalLogs) return 0;
  // Tight spread -> higher stability fill; flexible spread -> moderate energetic fill
  const score = Math.max(25, Math.min(100, Math.round(100 - insights.value.spreadMinutes / 4.2)));
  return Math.round((score / 100) * SPEC_COUNT);
});

const strengthBarsLit = computed(() => Math.round((avgStrength.value / 100) * 16));

// Per-habit summary list for right-hand Bento leaderboard
const habitLeaderboard = computed(() =>
  [...props.habits]
    .sort((a, b) => b.strength - a.strength)
    .map((h) => {
      const ti = computeHabitTimeInsights([h], props.today);
      return {
        habit: h,
        peakLabel: ti.peakHour ? ti.peakHour.rangeLabel : h.meta.windowStart ? `${h.meta.windowStart}–${h.meta.windowEnd ?? ''}` : '待记录',
        earliest: ti.earliest?.time ?? '--:--',
        latest: ti.latest?.time ?? '--:--',
      };
    }),
);

// 14-day timing scatter SVG geometry (05:00..24:00 vertical axis)
const SCATTER_MIN_HR = 5 * 60;
const SCATTER_MAX_HR = 24 * 60;
function timeMinToY(min: number): number {
  const clamped = Math.max(SCATTER_MIN_HR, Math.min(SCATTER_MAX_HR, min));
  const frac = (clamped - SCATTER_MIN_HR) / (SCATTER_MAX_HR - SCATTER_MIN_HR);
  return Math.round((10 + frac * 102) * 10) / 10;
}

const avgHorizonY = computed(() => {
  if (!insights.value.totalLogs) return null;
  const partsTime = insights.value.avgTimeLabel.split(':');
  if (partsTime.length !== 2) return null;
  const min = Number(partsTime[0]) * 60 + Number(partsTime[1]);
  if (!Number.isFinite(min)) return null;
  return timeMinToY(min);
});

function spectralTickColor(idx: number, totalLit: number, tint: string): string {
  const frac = totalLit > 1 ? idx / (totalLit - 1) : 1;
  const mixPct = Math.round(28 + frac * 72);
  return `color-mix(in srgb, ${tint} ${mixPct}%, transparent)`;
}

function hourBarBg(b: HabitHourBucket): string {
  if (b.level === 0) return 'color-mix(in srgb, var(--ws-ink) 5%, transparent)';
  const pct = b.level === 4 ? 95 : b.level === 3 ? 72 : b.level === 2 ? 48 : 26;
  return `color-mix(in srgb, ${accentColor.value} ${pct}%, var(--ws-card-subtle))`;
}

function formatTrend(delta: number): string {
  const abs = Math.abs(delta);
  return `${abs.toFixed(abs % 1 === 0 ? 0 : 1)}%`;
}
</script>

<template>
  <div class="hi-wrap" :class="{ phone: isPhone }" :style="{ '--hi-tint': accentColor }">
    <!-- Scope Filter Pills with Smooth Sliding Capsule -->
    <div class="hi-scope-bar" role="tablist" aria-label="习惯数据统计范围">
      <div ref="scopeTrackRef" class="hi-scope-track">
        <span
          v-if="scopePillVisible"
          class="ws-slide-pill hi-scope-slide"
          :class="{ 'no-anim': !scopePillReady }"
          :style="scopePillStyle"
          aria-hidden="true"
        />
        <button
          type="button"
          role="tab"
          :aria-selected="scopeId === 'all'"
          class="hi-scope-pill"
          :class="{ active: scopeId === 'all' }"
          @click="selectScope('all', $event)"
        >
          <FIcon name="sparkles" :size="12" />
          <span>全部习惯 ({{ habits.length }})</span>
        </button>

        <button
          v-for="h in habits"
          :key="h.task.id"
          type="button"
          role="tab"
          :aria-selected="scopeId === h.task.id"
          class="hi-scope-pill"
          :class="{ active: scopeId === h.task.id }"
          @click="selectScope(h.task.id, $event)"
        >
          <HabitEmblem :icon-key="h.meta.iconKey" :color="h.meta.color" :size="16" :radius="5" />
          <span>{{ h.task.title }}</span>
        </button>
      </div>
    </div>

    <!-- Row 1: 3 Swiss-Editorial Compact KPI Bento Cards (Echoing Reference Top Trio) -->
    <div class="hi-kpi-row">
      <!-- KPI 1: Habit Strength + Micro Trend Arrow + Mini Spectral Strip -->
      <section class="hi-bento hi-kpi-card">
        <div class="hi-kpi-top tabular">
          <strong class="hi-kpi-val"><NumberPop :value="avgStrength" />%</strong>
          <span
            class="hi-trend"
            :class="insights.weekDeltaPct >= 0 ? 'up' : 'down'"
          >
            {{ insights.weekDeltaPct >= 0 ? '▲' : '▼' }} {{ formatTrend(insights.weekDeltaPct) }}
          </span>
        </div>
        <div class="hi-mini-spec" aria-hidden="true">
          <span
            v-for="i in 16"
            :key="i"
            class="hi-mini-bar"
            :style="i - 1 < strengthBarsLit ? { background: spectralTickColor(i - 1, strengthBarsLit, accentColor) } : undefined"
          />
        </div>
        <div class="hi-kpi-foot">
          <FIcon name="flame" :size="12" class="hi-ico" />
          <span>综合习惯强度</span>
          <span class="hi-foot-right tabular">最长连胜 {{ bestHistoricalStreak }} 天</span>
        </div>
      </section>

      <!-- KPI 2: 30-Day Completions + Segmented Pill Strip -->
      <section class="hi-bento hi-kpi-card">
        <div class="hi-kpi-top tabular">
          <strong class="hi-kpi-val"><NumberPop :value="insights.last30DaysDone" /><small>次</small></strong>
          <span class="hi-trend neutral">近 30 天</span>
        </div>
        <div class="hi-mini-band" aria-hidden="true">
          <span
            v-for="(pt, pi) in insights.recentDailyPoints.slice(-10)"
            :key="pi"
            class="hi-mini-seg"
            :style="{
              background: pt.timesMin.length
                ? `color-mix(in srgb, ${accentColor} ${Math.min(95, 36 + pt.timesMin.length * 18)}%, var(--ws-card-subtle))`
                : undefined,
            }"
          />
        </div>
        <div class="hi-kpi-foot">
          <FIcon name="completed" :size="12" class="hi-ico" />
          <span>累计达成天数</span>
          <span class="hi-foot-right tabular">记录时刻 {{ insights.totalLogs }} 次</span>
        </div>
      </section>

      <!-- KPI 3: Rhythm Consistency Level (Reference "Medium / Stress Level" 20-Bar Spectral Card) -->
      <section class="hi-bento hi-kpi-card">
        <div class="hi-kpi-top">
          <Transition name="hi-swap" mode="out-in">
            <strong :key="insights.consistencyLabel" class="hi-kpi-word">{{ insights.consistencyLabel }}</strong>
          </Transition>
          <span class="hi-trend neutral tabular">
            {{ insights.totalLogs ? `±${insights.spreadMinutes}m` : '--' }}
          </span>
        </div>
        <div class="hi-spec20" aria-hidden="true">
          <span
            v-for="i in SPEC_COUNT"
            :key="i"
            class="hi-spec20-bar"
            :style="
              i - 1 < consistencyBarsLit
                ? { background: spectralTickColor(i - 1, consistencyBarsLit, '#EC4899') }
                : undefined
            "
          />
        </div>
        <div class="hi-kpi-foot">
          <FIcon name="clock" :size="12" class="hi-ico" />
          <span>打卡时间节律</span>
          <span class="hi-foot-right tabular">{{ insights.peakHour ? `峰值 ${insights.peakHour.sharePct}%` : '暂无时刻' }}</span>
        </div>
      </section>
    </div>

    <!-- Row 2: Signature Apple Health-Style "每日打卡时间分布" Chronotype Bento Card -->
    <section class="hi-bento hi-chrono-card">
      <header class="hi-card-head">
        <div class="hi-card-title">
          <span class="hi-title-dot" />
          <h3>每日打卡时间分布</h3>
          <span class="hi-scope-tag">{{ activeScopeHabit ? activeScopeHabit.task.title : '全部习惯聚合' }}</span>
        </div>
        <span class="hi-card-sub tabular">
          {{ hoveredHour ? `${hoveredHour.label}–${String((hoveredHour.hour + 1) % 24).padStart(2, '0')}:00 · ${hoveredHour.count} 次 (${hoveredHour.sharePct}%)` : `共分析 ${insights.totalLogs} 条打卡时刻` }}
        </span>
      </header>

      <!-- 2×2 Hairline Bento Sub-Cards (Echoing Reference Sleep Card 2×2 Grid) -->
      <div class="hi-chrono-grid">
        <div class="hi-sub-tile">
          <div class="hi-sub-top tabular">
            <Transition name="hi-swap" mode="out-in">
              <strong :key="insights.peakHour?.rangeLabel ?? 'none'">
                {{ insights.peakHour ? insights.peakHour.rangeLabel : '--:--' }}
              </strong>
            </Transition>
            <span v-if="insights.peakHour" class="hi-trend up">▲ {{ insights.peakHour.sharePct }}%</span>
          </div>
          <span class="hi-sub-lbl">最常打卡时段</span>
        </div>

        <div class="hi-sub-tile">
          <div class="hi-sub-top tabular">
            <Transition name="hi-swap" mode="out-in">
              <strong :key="insights.avgTimeLabel">{{ insights.avgTimeLabel }}</strong>
            </Transition>
            <span class="hi-sub-aux">中位 {{ insights.medianTimeLabel }}</span>
          </div>
          <span class="hi-sub-lbl">平均打卡时刻</span>
        </div>

        <div class="hi-sub-tile">
          <div class="hi-sub-top tabular">
            <Transition name="hi-swap" mode="out-in">
              <strong :key="insights.earliest?.time ?? 'none'">
                {{ insights.earliest ? insights.earliest.time : '--:--' }}
              </strong>
            </Transition>
            <span v-if="insights.earliest" class="hi-sub-aux">{{ formatHabitShortDate(insights.earliest.iso) }}</span>
          </div>
          <span class="hi-sub-lbl">历史最早打卡</span>
        </div>

        <div class="hi-sub-tile">
          <div class="hi-sub-top tabular">
            <Transition name="hi-swap" mode="out-in">
              <strong :key="insights.latest?.time ?? 'none'">
                {{ insights.latest ? insights.latest.time : '--:--' }}
              </strong>
            </Transition>
            <span v-if="insights.latest" class="hi-sub-aux">{{ formatHabitShortDate(insights.latest.iso) }}</span>
          </div>
          <span class="hi-sub-lbl">历史最迟打卡</span>
        </div>
      </div>

      <!-- Thick 24-Hour Segmented Chronotype Distribution Band (Echoing Reference Blue Segmented Band) -->
      <div class="hi-band-wrap" @pointerleave="hoveredHour = null">
        <div class="hi-band-24" role="list" aria-label="24 小时打卡密度分布">
          <button
            v-for="b in insights.hourBuckets"
            :key="b.hour"
            type="button"
            class="hi-hour-seg"
            :class="{ peak: insights.peakHour?.hour === b.hour, hovered: hoveredHour?.hour === b.hour }"
            :style="{ background: hourBarBg(b) }"
            :title="`${b.label} · ${b.count} 次打卡 (${b.sharePct}%)`"
            @pointerenter="hoveredHour = b"
            @focus="hoveredHour = b"
          />
        </div>

        <div class="hi-band-axis tabular">
          <span class="hi-axis-edge">
            <FIcon name="sun" :size="11" />
            <span>最早 {{ insights.earliest?.time ?? '06:00' }}</span>
          </span>
          <span class="hi-axis-mid">06:00</span>
          <span class="hi-axis-mid">12:00</span>
          <span class="hi-axis-mid">18:00</span>
          <span class="hi-axis-edge">
            <span>最迟 {{ insights.latest?.time ?? '23:00' }}</span>
            <FIcon name="moon" :size="11" />
          </span>
        </div>
      </div>

      <!-- 3-Column Period Summary Footer (Echoing Reference "Light / REM / Awake" Trio) -->
      <div class="hi-period-trio tabular">
        <div class="hi-period-col">
          <strong>{{ insights.periods.morning.pct }}%<small> · {{ insights.periods.morning.count }}次</small></strong>
          <span class="hi-period-lbl">
            <span class="hi-swatch morning" />
            <span>早晨 05–11</span>
          </span>
        </div>
        <div class="hi-period-col">
          <strong>{{ insights.periods.afternoon.pct }}%<small> · {{ insights.periods.afternoon.count }}次</small></strong>
          <span class="hi-period-lbl">
            <span class="hi-swatch afternoon" />
            <span>下午 12–17</span>
          </span>
        </div>
        <div class="hi-period-col">
          <strong>{{ insights.periods.evening.pct }}%<small> · {{ insights.periods.evening.count }}次</small></strong>
          <span class="hi-period-lbl">
            <span class="hi-swatch evening" />
            <span>晚间 18–04</span>
          </span>
        </div>
      </div>
    </section>

    <!-- Row 3: 2-Column Deep Analytics Bento Pair (14-Day Timing Drift Scatter + Habit Rhythm Leaderboard) -->
    <div class="hi-bottom-grid">
      <!-- Left: 14-Day Daily Check-In Time Scatter Drift -->
      <section class="hi-bento hi-scatter-card">
        <header class="hi-card-head">
          <div class="hi-card-title">
            <FIcon name="clock" :size="14" class="hi-ico" />
            <h3>近 14 天打卡时刻轨迹</h3>
          </div>
          <span class="hi-card-sub tabular" :class="{ active: !!hoveredDayReadout }">
            {{ hoveredDayReadout ?? `均值线 ${insights.avgTimeLabel}` }}
          </span>
        </header>

        <div class="hi-scatter-box" @pointerleave="hoveredDayIdx = null">
          <div class="hi-scatter-yaxis tabular" aria-hidden="true">
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
          <svg class="hi-scatter-svg" viewBox="0 0 320 124" preserveAspectRatio="none" aria-label="近 14 天打卡时刻散点图">
            <!-- Delicate horizontal hour guide hairlines -->
            <line x1="0" y1="15" x2="320" y2="15" class="hi-grid-line" />
            <line x1="0" y1="48" x2="320" y2="48" class="hi-grid-line" />
            <line x1="0" y1="80" x2="320" y2="80" class="hi-grid-line" />
            <line x1="0" y1="112" x2="320" y2="112" class="hi-grid-line" />

            <!-- Dashed Average Check-In Horizon Line -->
            <line
              v-if="avgHorizonY !== null"
              x1="0"
              :y1="avgHorizonY"
              x2="320"
              :y2="avgHorizonY"
              class="hi-avg-line"
            />

            <!-- Interactive Daily Hover Band + Check-In Timestamp Dots -->
            <g
              v-for="(day, di) in insights.recentDailyPoints"
              :key="day.iso"
              class="hi-day-col"
              :class="{ hovered: hoveredDayIdx === di }"
              @pointerenter="hoveredDayIdx = di"
            >
              <rect
                :x="Math.max(0, 14 + di * 22.4 - 11)"
                y="4"
                width="22"
                height="116"
                rx="6"
                class="hi-col-hit"
              />
              <line
                v-if="day.timesMin.length >= 2"
                :x1="14 + di * 22.4"
                :y1="timeMinToY(day.timesMin[0])"
                :x2="14 + di * 22.4"
                :y2="timeMinToY(day.timesMin[day.timesMin.length - 1])"
                class="hi-span-line"
              />
              <circle
                v-for="(tm, ti) in day.timesMin"
                :key="`${day.iso}:${ti}`"
                :cx="14 + di * 22.4"
                :cy="timeMinToY(tm)"
                :r="hoveredDayIdx === di ? 4.4 : 3.5"
                class="hi-dot"
              >
                <title>{{ day.label }} · {{ minutesToHHMM(tm) }}</title>
              </circle>
            </g>
          </svg>
        </div>

        <div class="hi-scatter-xaxis tabular" aria-hidden="true">
          <span>{{ insights.recentDailyPoints[0]?.label }}</span>
          <span>{{ insights.recentDailyPoints[4]?.label }}</span>
          <span>{{ insights.recentDailyPoints[9]?.label }}</span>
          <span>今日</span>
        </div>
      </section>

      <!-- Right: Habit Strength & Peak Rhythm Leaderboard -->
      <section class="hi-bento hi-rank-card">
        <header class="hi-card-head">
          <div class="hi-card-title">
            <FIcon name="chart" :size="14" class="hi-ico" />
            <h3>各习惯节律排行</h3>
          </div>
          <span class="hi-card-sub">点击查看月历详情</span>
        </header>

        <div class="hi-rank-list">
          <button
            v-for="row in habitLeaderboard"
            :key="row.habit.task.id"
            type="button"
            class="hi-rank-row"
            :class="{ scoped: scopeId === row.habit.task.id }"
            @click="emit('openHabit', row.habit)"
          >
            <HabitEmblem
              :icon-key="row.habit.meta.iconKey"
              :color="row.habit.meta.color"
              :size="28"
              :radius="8"
            />
            <div class="hi-rank-copy">
              <strong>{{ row.habit.task.title }}</strong>
              <span class="tabular">最常 {{ row.peakLabel }} · 早 {{ row.earliest }} / 晚 {{ row.latest }}</span>
            </div>
            <div class="hi-rank-meter" aria-hidden="true">
              <span
                v-for="b in 10"
                :key="b"
                class="hi-rm-bar"
                :style="
                  b <= Math.round(row.habit.strength / 10)
                    ? { background: row.habit.meta.color }
                    : undefined
                "
              />
            </div>
            <strong class="hi-rank-pct tabular">{{ row.habit.strength }}%</strong>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tabular {
  font-variant-numeric: tabular-nums;
}

.hi-wrap {
  --hi-tint: #0ea5e9;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Scope Filter Bar with Fluid Sliding Capsule */
.hi-scope-bar {
  overflow-x: auto;
  padding: 2px 1px 4px;
  scrollbar-width: none;
}

.hi-scope-bar::-webkit-scrollbar {
  display: none;
}

.hi-scope-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: max-content;
}

.hi-scope-slide {
  border-radius: 999px;
  background: var(--ws-ink);
  box-shadow: var(--ws-shadow-sm);
}

.hi-scope-pill {
  position: relative;
  z-index: 1;
  flex: none;
  height: 31px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 660;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    color var(--duration-quick, 150ms) var(--ease-smooth-out),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hi-scope-pill:hover:not(.active) {
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.hi-scope-pill:active {
  transform: scale(0.96);
}

.hi-scope-pill.active {
  background: transparent;
  border-color: transparent;
  color: var(--ws-ink-inverse);
}

/* Soft in-place cross-blur swap for telemetry values (transitions-polish: text swap 150ms) */
.hi-swap-enter-active,
.hi-swap-leave-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out),
    filter var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out);
}
.hi-swap-enter-from,
.hi-swap-leave-to {
  opacity: 0;
  filter: blur(var(--blur-small, 2px));
}

/* Swiss-Editorial Bento Base Surface (Reference Apple Health / Bevel Card) */
.hi-bento {
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Row 1: 3 Compact KPI Cards */
.hi-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.hi-kpi-card {
  padding: 14px 16px;
  gap: 10px;
}

.hi-kpi-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.hi-kpi-val {
  font-size: 26px;
  font-weight: 860;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--ws-ink);
}

.hi-kpi-val small {
  margin-left: 2px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ws-ink-muted);
}

.hi-kpi-word {
  font-size: 21px;
  font-weight: 840;
  letter-spacing: -0.025em;
  line-height: 1.1;
  color: var(--ws-ink);
}

.hi-trend {
  font-size: 11.5px;
  font-weight: 760;
  white-space: nowrap;
}

.hi-trend.up {
  color: #16a34a;
}

.hi-trend.down {
  color: #e11d48;
}

.hi-trend.neutral {
  color: var(--ws-ink-muted);
  font-weight: 660;
}

.hi-mini-spec {
  height: 22px;
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 3px;
}

.hi-mini-bar {
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 7%, transparent);
  transition: background-color var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.hi-mini-band {
  height: 22px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 2px;
}

.hi-mini-seg {
  background: color-mix(in srgb, var(--ws-ink) 7%, transparent);
  border-radius: 2px;
  transition: background-color var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.hi-spec20 {
  height: 22px;
  display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr));
  gap: 3px;
}

.hi-spec20-bar {
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 7%, transparent);
  transition: background-color var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.hi-kpi-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 640;
  color: var(--ws-ink-secondary);
}

.hi-ico {
  color: var(--hi-tint);
}

.hi-foot-right {
  margin-left: auto;
  color: var(--ws-ink-muted);
  font-size: 11px;
}

/* Row 2: Hero Chronotype Card (Reference Sleep Bento Card) */
.hi-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.hi-card-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.hi-title-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--hi-tint);
}

.hi-card-title h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.015em;
  color: var(--ws-ink);
}

.hi-scope-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font-size: 11px;
  font-weight: 660;
}

.hi-card-sub {
  font-size: 11.5px;
  font-weight: 640;
  color: var(--ws-ink-muted);
  transition: color var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hi-card-sub.active {
  color: var(--hi-tint);
  font-weight: 720;
}

.hi-chrono-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.hi-sub-tile {
  padding: 12px 14px;
  border-radius: 15px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hi-sub-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.hi-sub-top strong {
  font-size: 19px;
  font-weight: 860;
  letter-spacing: -0.025em;
  color: var(--ws-ink);
  white-space: nowrap;
}

.hi-sub-aux {
  font-size: 11px;
  font-weight: 640;
  color: var(--ws-ink-muted);
  white-space: nowrap;
}

.hi-sub-lbl {
  font-size: 11.5px;
  font-weight: 620;
  color: var(--ws-ink-secondary);
}

/* 24-Hour Thick Segmented Chronotype Band */
.hi-band-wrap {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.hi-band-24 {
  height: 44px;
  border-radius: 14px;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 2.5px;
  padding: 2px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
}

.hi-hour-seg {
  border: 0;
  padding: 0;
  height: 100%;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 140ms var(--ease-smooth-out), filter 140ms ease;
}

.hi-hour-seg:hover,
.hi-hour-seg.hovered {
  transform: scaleY(1.06);
  filter: brightness(1.06);
}

.hi-hour-seg.peak {
  box-shadow: inset 0 0 0 1.5px var(--ws-ink);
}

.hi-band-axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 660;
  color: var(--ws-ink-muted);
}

.hi-axis-edge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ws-ink-secondary);
}

/* 3-Column Period Summary Footer */
.hi-period-trio {
  padding-top: 4px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.hi-period-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.hi-period-col strong {
  font-size: 17px;
  font-weight: 860;
  color: var(--ws-ink);
}

.hi-period-col strong small {
  font-size: 11.5px;
  font-weight: 640;
  color: var(--ws-ink-muted);
}

.hi-period-lbl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 640;
  color: var(--ws-ink-secondary);
}

.hi-swatch {
  width: 10px;
  height: 4px;
  border-radius: 999px;
}

.hi-swatch.morning {
  background: color-mix(in srgb, var(--hi-tint) 42%, var(--ws-card-subtle));
}

.hi-swatch.afternoon {
  background: color-mix(in srgb, var(--hi-tint) 72%, var(--ws-card-subtle));
}

.hi-swatch.evening {
  background: var(--hi-tint);
}

/* Row 3: 2-Column Deep Analytics Bento Pair */
.hi-bottom-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 12px;
}

.hi-scatter-box {
  display: flex;
  align-items: stretch;
  gap: 8px;
  height: 128px;
}

.hi-scatter-yaxis {
  width: 34px;
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 660;
  color: var(--ws-ink-muted);
  padding: 6px 0;
}

.hi-scatter-svg {
  flex: 1;
  min-width: 0;
  height: 100%;
  border-radius: 12px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
}

.hi-grid-line {
  stroke: var(--ws-hairline);
  stroke-width: 1;
}

.hi-avg-line {
  stroke: var(--hi-tint);
  stroke-width: 1.4;
  stroke-dasharray: 4 3;
  opacity: 0.72;
  transition: y1 var(--duration-fast, 250ms) var(--ease-smooth-out), y2 var(--duration-fast, 250ms) var(--ease-smooth-out), stroke var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.hi-col-hit {
  fill: transparent;
  cursor: pointer;
  transition: fill var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hi-day-col.hovered .hi-col-hit {
  fill: color-mix(in srgb, var(--hi-tint) 10%, transparent);
}

.hi-span-line {
  stroke: var(--hi-tint);
  stroke-width: 1.6;
  opacity: 0.3;
  transition: opacity var(--duration-quick, 150ms) var(--ease-smooth-out);
}

.hi-day-col.hovered .hi-span-line {
  opacity: 0.65;
}

.hi-dot {
  fill: var(--hi-tint);
  transition: r var(--duration-quick, 150ms) var(--ease-smooth-out), fill var(--duration-fast, 250ms) var(--ease-smooth-out);
}

.hi-scatter-xaxis {
  padding-left: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 660;
  color: var(--ws-ink-muted);
}

/* Right: Leaderboard */
.hi-rank-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hi-rank-row {
  width: 100%;
  padding: 7px 9px;
  border-radius: 13px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  transition: border-color var(--duration-quick, 150ms) ease, transform var(--duration-quick, 150ms) ease;
}

.hi-rank-row:hover {
  border-color: var(--ws-hairline-strong);
  transform: translateY(-1px);
}

.hi-rank-row.scoped {
  border-color: color-mix(in srgb, var(--hi-tint) 46%, transparent);
  background: color-mix(in srgb, var(--hi-tint) 7%, var(--ws-card-subtle));
}

.hi-rank-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.hi-rank-copy strong {
  font-size: 12.5px;
  font-weight: 760;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hi-rank-copy span {
  font-size: 10.5px;
  color: var(--ws-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hi-rank-meter {
  width: 44px;
  height: 16px;
  flex: none;
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 2px;
}

.hi-rm-bar {
  border-radius: 999px;
  background: color-mix(in srgb, var(--ws-ink) 9%, transparent);
}

.hi-rank-pct {
  width: 34px;
  flex: none;
  text-align: right;
  font-size: 12.5px;
  font-weight: 820;
  color: var(--ws-ink);
}

@media (max-width: 960px) {
  .hi-kpi-row,
  .hi-bottom-grid {
    grid-template-columns: 1fr;
  }

  .hi-chrono-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .hi-bento {
    padding: 13px 14px;
    border-radius: 18px;
  }

  .hi-sub-tile {
    padding: 10px 10px;
  }

  .hi-sub-top {
    gap: 4px;
  }

  .hi-sub-top strong {
    font-size: 14.5px;
  }

  .hi-sub-delta {
    font-size: 10.5px;
  }

  .hi-axis-mid {
    display: none;
  }

  .hi-rank-meter {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hi-swap-enter-active,
  .hi-swap-leave-active,
  .hi-mini-bar,
  .hi-mini-seg,
  .hi-spec20-bar,
  .hi-hour-seg,
  .hi-dot,
  .hi-col-hit {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
