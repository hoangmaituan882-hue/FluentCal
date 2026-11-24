<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { FIcon } from '@/fluent';
import type {
  ISODate,
  SubscriptionCategory,
  SubscriptionCurrency,
  SubscriptionCycle,
  SubscriptionMeta,
  SubscriptionStatus,
  Task,
} from '@/types';
import {
  BRAND_COLOR_SWATCHES,
  CATEGORY_META,
  CURRENCY_META,
  CYCLE_META,
  EMBLEM_CHOICES,
  formatCurrencyAmount,
  monthlyEquivalentCNY,
  personalPriceOriginal,
  STATUS_LABELS,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CURRENCIES,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_PRESETS,
  type SubscriptionPreset,
} from '@/lib/subscriptions';
import { addTask, deleteTask, saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';

const props = defineProps<{
  open: boolean;
  editingTask?: (Task & { subscription: SubscriptionMeta }) | null;
  defaultDate?: ISODate;
}>();

const emit = defineEmits<{
  close: [];
  saved: [taskId?: string];
}>();

const { isPhone } = useViewport();
const titleInputRef = ref<HTMLInputElement>();

const title = ref('');
const watermark = ref('');
const emblem = ref('✦');
const brandColor = ref<string>(BRAND_COLOR_SWATCHES[0]);
const priceStr = ref('20');
const currency = ref<SubscriptionCurrency>('CNY');
const cycle = ref<SubscriptionCycle>('monthly');
const category = ref<SubscriptionCategory>('ai');
const status = ref<SubscriptionStatus>('active');
const startDate = ref<ISODate>(now.value);
const autoRenew = ref(true);
const splitCount = ref(1);
const paymentMethod = ref('');
const notes = ref('');
const showOnCalendar = ref(false);
const saving = ref(false);

watch(
  () => [props.open, props.editingTask, props.defaultDate] as const,
  async ([isOpen, task, defDate]) => {
    if (!isOpen) return;
    if (task) {
      const m = task.subscription;
      title.value = task.title;
      watermark.value = m.watermark ?? '';
      emblem.value = m.emblem || task.title.slice(0, 1) || '✦';
      brandColor.value = m.brandColor || CATEGORY_META[m.category]?.color || '#10A37F';
      priceStr.value = String(m.price);
      currency.value = m.currency;
      cycle.value = m.cycle;
      category.value = m.category;
      status.value = m.status;
      startDate.value = task.start;
      autoRenew.value = m.autoRenew;
      splitCount.value = Math.max(1, m.splitCount ?? 1);
      paymentMethod.value = m.paymentMethod ?? '';
      notes.value = task.notes ?? '';
      showOnCalendar.value = !!m.showOnCalendar;
    } else {
      title.value = '';
      watermark.value = '';
      emblem.value = '✦';
      brandColor.value = '#10A37F';
      priceStr.value = '15';
      currency.value = 'CNY';
      cycle.value = 'monthly';
      category.value = 'media';
      status.value = 'active';
      startDate.value = defDate || now.value;
      autoRenew.value = true;
      splitCount.value = 1;
      paymentMethod.value = '';
      notes.value = '';
      showOnCalendar.value = false;
    }
    await nextTick();
    titleInputRef.value?.focus();
  },
);

function applyPreset(p: SubscriptionPreset) {
  title.value = p.title;
  watermark.value = p.watermark;
  emblem.value = p.emblem;
  brandColor.value = p.brandColor;
  priceStr.value = String(p.price);
  currency.value = p.currency;
  cycle.value = p.cycle;
  category.value = p.category;
  splitCount.value = p.splitCount ?? 1;
  paymentMethod.value = p.paymentMethod;
  status.value = p.status ?? 'active';
  autoRenew.value = p.autoRenew ?? true;
}

const parsedPrice = computed(() => {
  const n = Number.parseFloat(priceStr.value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
});

const draftMeta = computed<SubscriptionMeta>(() => ({
  price: parsedPrice.value,
  currency: currency.value,
  cycle: cycle.value,
  category: category.value,
  status: status.value,
  autoRenew: autoRenew.value,
  splitCount: splitCount.value > 1 ? splitCount.value : undefined,
  paymentMethod: paymentMethod.value.trim() || undefined,
  emblem: emblem.value.trim() || title.value.trim().slice(0, 1) || '◈',
  brandColor: brandColor.value,
  watermark: watermark.value.trim() || undefined,
  showOnCalendar: showOnCalendar.value || undefined,
}));

const previewMonthlyCNY = computed(() => monthlyEquivalentCNY(draftMeta.value));
const previewPersonalOrig = computed(() => personalPriceOriginal(draftMeta.value));

async function onSubmit() {
  const cleanTitle = title.value.trim();
  if (!cleanTitle || saving.value) return;
  saving.value = true;
  try {
    const meta = draftMeta.value;
    const date = startDate.value || now.value;
    if (props.editingTask) {
      await saveTask({
        ...props.editingTask,
        title: cleanTitle,
        start: date,
        end: date,
        notes: notes.value.trim() || undefined,
        subscriptionOnly: true,
        subscription: meta,
      });
      emit('saved', props.editingTask.id);
    } else {
      const created = await addTask({
        title: cleanTitle,
        start: date,
        end: date,
        notes: notes.value.trim() || undefined,
        subscriptionOnly: true,
        subscription: meta,
      });
      emit('saved', created.id);
    }
    emit('close');
  } finally {
    saving.value = false;
  }
}

async function onDelete() {
  if (!props.editingTask || saving.value) return;
  saving.value = true;
  try {
    await deleteTask(props.editingTask.id);
    emit('saved');
    emit('close');
  } finally {
    saving.value = false;
  }
}

function stepSplit(delta: number) {
  splitCount.value = Math.max(1, Math.min(12, splitCount.value + delta));
}
</script>

<template>
  <Transition name="ws-modal">
    <div
      v-if="open"
      class="sub-modal-backdrop"
      :class="{ phone: isPhone }"
      role="dialog"
      aria-modal="true"
      aria-label="编辑订阅项目"
      @mousedown.self="emit('close')"
    >
      <div class="sub-modal-card ws-modal-card" :class="{ phone: isPhone }">
        <div v-if="isPhone" class="sm-grab" aria-hidden="true" />

        <header class="sm-head">
          <h2 class="sm-title">{{ editingTask ? '编辑订阅' : '添加新订阅' }}</h2>
          <button type="button" class="ws-icon-circle" title="关闭" aria-label="关闭" @click="emit('close')">
            <FIcon name="close" :size="13" />
          </button>
        </header>

        <!-- Quick Presets Strip (for fast 3-second entry!) -->
        <div v-if="!editingTask" class="sm-presets">
          <button
            v-for="p in SUBSCRIPTION_PRESETS"
            :key="p.key"
            type="button"
            class="sm-preset-chip"
            @click="applyPreset(p)"
          >
            <span class="sm-p-dot" :style="{ background: p.brandColor }">{{ p.emblem }}</span>
            <span>{{ p.title }}</span>
          </button>
        </div>

        <!-- Live Tactile Preview Banner with Background Watermark + -6deg Tilted Emblem -->
        <div class="sm-preview" :style="{ '--pv-color': brandColor }">
          <span class="sm-pv-wm" aria-hidden="true">{{ watermark || title || 'SUBSCRIPTION' }}</span>
          <span class="sm-pv-emblem" :style="{ background: brandColor }">{{ emblem || '✦' }}</span>
          <div class="sm-pv-copy">
            <div class="sm-pv-name">{{ title || '未命名订阅' }}</div>
            <div class="sm-pv-meta">
              <span>{{ formatCurrencyAmount(previewPersonalOrig, currency) }} / {{ CYCLE_META[cycle].short }}</span>
              <span v-if="splitCount > 1" class="sm-pv-split">{{ splitCount }}人拼车</span>
              <span v-if="status === 'trial'" class="sm-pv-trial">试用护盾</span>
            </div>
          </div>
          <div class="sm-pv-cny">
            <strong>¥{{ Math.round(previewMonthlyCNY * 10) / 10 }}</strong>
            <span>/ 月均</span>
          </div>
        </div>

        <form class="sm-form" @submit.prevent="onSubmit">
          <!-- Name & Watermark -->
          <div class="sm-row-2">
            <label class="sm-field flex-2">
              <span>订阅名称</span>
              <input
                ref="titleInputRef"
                v-model="title"
                type="text"
                class="sm-input"
                placeholder="例如：ChatGPT Plus、iCloud+、Apple Music"
                required
              />
            </label>
            <label class="sm-field flex-1">
              <span>卡片水印字（可选）</span>
              <input
                v-model="watermark"
                type="text"
                class="sm-input"
                placeholder="如 ChatGPT"
              />
            </label>
          </div>

          <!-- Price + Currency + Cycle -->
          <div class="sm-row-3">
            <label class="sm-field">
              <span>原价金额</span>
              <input
                v-model="priceStr"
                type="number"
                step="0.01"
                min="0"
                class="sm-input tabular"
                required
              />
            </label>
            <label class="sm-field">
              <span>币种</span>
              <select v-model="currency" class="sm-input">
                <option v-for="c in SUBSCRIPTION_CURRENCIES" :key="c" :value="c">
                  {{ CURRENCY_META[c].label }}
                </option>
              </select>
            </label>
            <label class="sm-field">
              <span>计费周期</span>
              <select v-model="cycle" class="sm-input">
                <option v-for="cy in SUBSCRIPTION_CYCLES" :key="cy" :value="cy">
                  {{ CYCLE_META[cy].label }}（{{ CYCLE_META[cy].short }}）
                </option>
              </select>
            </label>
          </div>

          <!-- Next/Anchor Billing Date + Category + Payment Method -->
          <div class="sm-row-3">
            <label class="sm-field">
              <span>扣费 / 到期基准日</span>
              <input v-model="startDate" type="date" class="sm-input tabular" required />
            </label>
            <label class="sm-field">
              <span>分类</span>
              <select v-model="category" class="sm-input">
                <option v-for="cat in SUBSCRIPTION_CATEGORIES" :key="cat" :value="cat">
                  {{ CATEGORY_META[cat].label }}
                </option>
              </select>
            </label>
            <label class="sm-field">
              <span>扣款渠道 / 备注</span>
              <input
                v-model="paymentMethod"
                type="text"
                class="sm-input"
                placeholder="微信 / 支付宝 / Apple"
              />
            </label>
          </div>

          <!-- Status Pills + Split Bill Stepper -->
          <div class="sm-inline-section">
            <div class="sm-field">
              <span>订阅状态</span>
              <div class="sm-pill-group">
                <button
                  v-for="st in (['active', 'trial', 'paused', 'cancelled'] as const)"
                  :key="st"
                  type="button"
                  class="sm-pill"
                  :class="{ active: status === st, trial: st === 'trial' && status === 'trial' }"
                  @click="status = st"
                >
                  {{ STATUS_LABELS[st] }}
                </button>
              </div>
            </div>

            <div class="sm-field sm-split-box">
              <span>家庭拼车分摊</span>
              <div class="sm-stepper">
                <button type="button" class="sm-step-btn" :disabled="splitCount <= 1" @click="stepSplit(-1)">−</button>
                <span class="sm-step-val">{{ splitCount === 1 ? '独享 (1人)' : `${splitCount}人平摊` }}</span>
                <button type="button" class="sm-step-btn" :disabled="splitCount >= 12" @click="stepSplit(1)">+</button>
              </div>
            </div>
          </div>

          <!-- Brand Color & Emblem Picker -->
          <div class="sm-inline-section">
            <div class="sm-field">
              <span>卡片主题色</span>
              <div class="sm-swatches">
                <button
                  v-for="hex in BRAND_COLOR_SWATCHES"
                  :key="hex"
                  type="button"
                  class="sm-swatch"
                  :class="{ active: brandColor === hex }"
                  :style="{ background: hex }"
                  @click="brandColor = hex"
                />
              </div>
            </div>

            <div class="sm-field">
              <span>徽标符号</span>
              <div class="sm-emblems">
                <button
                  v-for="em in EMBLEM_CHOICES"
                  :key="em"
                  type="button"
                  class="sm-em-btn"
                  :class="{ active: emblem === em }"
                  @click="emblem = em"
                >
                  {{ em }}
                </button>
              </div>
            </div>
          </div>

          <!-- Switches -->
          <div class="sm-checks">
            <label class="sm-check-lbl">
              <input v-model="autoRenew" type="checkbox" />
              <span>自动扣款续费</span>
            </label>
            <label class="sm-check-lbl">
              <input v-model="showOnCalendar" type="checkbox" />
              <span>同时显示在主日历网格中</span>
            </label>
          </div>

          <footer class="sm-foot">
            <button
              v-if="editingTask"
              type="button"
              class="sm-btn danger"
              :disabled="saving"
              @click="onDelete"
            >
              <FIcon name="delete" :size="13" />
              <span>删除</span>
            </button>
            <div class="sm-foot-right">
              <button type="button" class="sm-btn ghost" @click="emit('close')">取消</button>
              <button type="submit" class="sm-btn primary" :disabled="!title.trim() || saving">
                {{ editingTask ? '保存修改' : '添加订阅' }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sub-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: var(--ws-scrim-bg);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.sub-modal-backdrop.phone {
  align-items: flex-end;
  padding: 0;
}

.sub-modal-card {
  width: 100%;
  max-width: 580px;
  max-height: min(90dvh, 760px);
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  border-radius: 22px;
  box-shadow: var(--ws-shadow-float);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sub-modal-card.phone {
  max-width: 100%;
  max-height: 92dvh;
  border-radius: 24px 24px 0 0;
  border-bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
}

.sm-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong);
  margin: 8px auto 0;
  flex: none;
}

.sm-head {
  flex: none;
  padding: 16px 20px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sm-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 760;
  letter-spacing: -0.02em;
  color: var(--ws-ink);
}

.sm-presets {
  flex: none;
  padding: 0 20px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.sm-presets::-webkit-scrollbar {
  display: none;
}

.sm-preset-chip {
  flex: none;
  height: 30px;
  padding: 0 10px 0 5px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
  transition: background-color 140ms ease, transform 120ms ease, border-color 140ms ease;
}

.sm-preset-chip:hover {
  background: var(--ws-pill-hover);
  border-color: var(--ws-hairline-strong);
}

.sm-preset-chip:active {
  transform: scale(0.96);
}

.sm-p-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  display: inline-grid;
  place-items: center;
}

/* Live Watermark Preview Strip */
.sm-preview {
  --pv-color: #10a37f;
  position: relative;
  margin: 0 20px 12px;
  padding: 13px 16px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--pv-color) 13%, var(--ws-card-bg));
  border: 1px solid color-mix(in srgb, var(--pv-color) 22%, transparent);
  display: flex;
  align-items: center;
  gap: 14px;
  overflow: hidden;
  flex: none;
}

.sm-pv-wm {
  position: absolute;
  right: 12px;
  top: -8px;
  font-size: 52px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.04em;
  color: color-mix(in srgb, var(--pv-color) 16%, transparent);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
}

.sm-pv-emblem {
  position: relative;
  z-index: 1;
  width: 44px;
  height: 44px;
  border-radius: 13px;
  color: #fff;
  font-size: 20px;
  font-weight: 900;
  display: inline-grid;
  place-items: center;
  transform: rotate(-6deg);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16);
  flex: none;
}

.sm-pv-copy {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}

.sm-pv-name {
  font-size: 15px;
  font-weight: 760;
  color: var(--ws-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-pv-meta {
  margin-top: 2px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
}

.sm-pv-split,
.sm-pv-trial {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 700;
}

.sm-pv-split {
  background: rgba(37, 99, 235, 0.14);
  color: #2563eb;
}

.sm-pv-trial {
  background: rgba(232, 93, 42, 0.15);
  color: #e85d2a;
}

.sm-pv-cny {
  position: relative;
  z-index: 1;
  text-align: right;
  flex: none;
}

.sm-pv-cny strong {
  display: block;
  font-size: 19px;
  font-weight: 850;
  color: var(--ws-ink);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.sm-pv-cny span {
  font-size: 11px;
  color: var(--ws-ink-muted);
}

.sm-form {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sm-row-2 {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 10px;
}

.sm-row-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.sm-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.sm-field > span {
  font-size: 11.5px;
  font-weight: 640;
  color: var(--ws-ink-muted);
}

.sm-input {
  height: 36px;
  padding: 0 11px;
  border-radius: 10px;
  border: 1px solid var(--ws-hairline-strong);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.sm-input:focus {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.tabular {
  font-variant-numeric: tabular-nums;
}

.sm-inline-section {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.sm-pill-group {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sm-pill {
  height: 29px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 130ms ease;
}

.sm-pill.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sm-pill.trial {
  background: #e85d2a;
  border-color: #e85d2a;
  color: #fff;
}

.sm-stepper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 4px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
}

.sm-step-btn {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
}

.sm-step-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.sm-step-val {
  min-width: 72px;
  text-align: center;
  font-size: 12px;
  font-weight: 640;
  color: var(--ws-ink);
}

.sm-swatches {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sm-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 130ms ease, box-shadow 130ms ease;
}

.sm-swatch.active {
  transform: scale(1.16);
  box-shadow: 0 0 0 2px var(--ws-card-bg), 0 0 0 4px var(--ws-ink);
}

.sm-emblems {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.sm-em-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font-size: 13px;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
}

.sm-em-btn.active {
  background: var(--ws-ink);
  border-color: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sm-checks {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 2px;
}

.sm-check-lbl {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 560;
  color: var(--ws-ink-secondary);
  cursor: pointer;
}

.sm-foot {
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--ws-hairline);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sm-foot-right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sm-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 660;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: transform 120ms ease, opacity 140ms ease, background-color 140ms ease;
}

.sm-btn:active {
  transform: scale(0.96);
}

.sm-btn.ghost {
  background: var(--ws-card-subtle);
  border-color: var(--ws-hairline);
  color: var(--ws-ink-secondary);
}

.sm-btn.primary {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sm-btn.primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.sm-btn.danger {
  background: rgba(232, 76, 61, 0.11);
  color: #d93e30;
}

@media (max-width: 639px) {
  .sm-row-2,
  .sm-row-3 {
    grid-template-columns: 1fr;
  }
}
</style>
