<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon } from '@/fluent';
import type {
  ISODate,
  SubscriptionCategory,
  SubscriptionCurrency,
  SubscriptionCycle,
  SubscriptionMeta,
  SubscriptionStatus,
  SubscriptionSubAccount,
  Task,
} from '@/types';
import {
  BRAND_COLOR_SWATCHES,
  CATEGORY_META,
  CURRENCY_META,
  CYCLE_META,
  formatCurrencyAmount,
  monthlyEquivalentCNY,
  normalizeHexColor,
  parseQuickSubscriptionText,
  personalPriceOriginal,
  STATUS_LABELS,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CURRENCIES,
  SUBSCRIPTION_PRESETS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionPreset,
} from '@/lib/subscriptions';
import {
  compressUploadedIconFile,
  featuredLocalBrands,
  inferBrandFromTitle,
  materializeIconCandidate,
  searchLocalBrands,
  searchOnlineIcons,
  type IconSearchCandidate,
} from '@/lib/subscriptionIcons';
import { addTask, deleteTask, saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import FushiTonalCard from './FushiTonalCard.vue';
import SubscriptionEmblem from './SubscriptionEmblem.vue';

const SHOW_ON_CAL_PREF_KEY = 'fluentcal.sub.defaultShowOnCalendar';
const PAYMENT_QUICK_CHOICES = ['微信支付', '支付宝', 'Apple Pay', '银行卡', 'PayPal'] as const;
const PROMO_QUICK_LABELS = ['首月特惠', '首年特惠', '学生优惠', '教育折扣'] as const;
const QUICK_CYCLES: SubscriptionCycle[] = ['monthly', 'quarterly', 'yearly', 'weekly'];

const STATUS_HINTS: Record<SubscriptionStatus, string> = {
  active: '按计费周期持续订阅',
  ending: '已关自动续费，到期止续',
  trial: '试用期内，到期前提醒',
  paused: '暂停计费，不计入支出',
  cancelled: '已结束退订',
};

type PopoverKind =
  | 'icon'
  | 'color'
  | 'category'
  | 'status'
  | 'promo'
  | 'accounts'
  | 'split'
  | 'payment'
  | null;

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
const fileInputRef = ref<HTMLInputElement>();

const title = ref('');
const plan = ref('');
const brandKey = ref<string | undefined>(undefined);
const iconData = ref<string | undefined>(undefined);
const brandColor = ref<string>(BRAND_COLOR_SWATCHES[0]);
const iconAutoColor = ref<string>(BRAND_COLOR_SWATCHES[0]);
const priceStr = ref('15');
const discountStr = ref('');
const promoPriceStr = ref('');
const promoPeriods = ref(1);
const promoLabel = ref('');
const subAccounts = ref<SubscriptionSubAccount[]>([]);
const currency = ref<SubscriptionCurrency>('CNY');
const cycle = ref<SubscriptionCycle>('monthly');
const category = ref<SubscriptionCategory>('media');
const status = ref<SubscriptionStatus>('active');
const startDate = ref<ISODate>(now.value);
const autoRenew = ref(true);
const splitCount = ref(1);
const paymentMethod = ref('');
const notes = ref('');
const showOnCalendar = ref(false);
const saving = ref(false);

// Inline sub-account draft inside Accounts Popover
const newAccLabel = ref('');
const newAccPlan = ref('');
const newAccPriceStr = ref('');
const newAccStatus = ref<SubscriptionStatus>('active');

// Custom hex input state inside Color Popover
const hexInput = ref<string>(BRAND_COLOR_SWATCHES[0]);
const hexInvalid = ref(false);

// Floating Popover state (teleported to body, viewport-clamped, zero modal clipping)
const activePopover = ref<PopoverKind>(null);
const popoverStyle = ref<Record<string, string>>({});
const popoverRef = ref<HTMLElement>();

// 3-Tier Auto Icon Search + Curated Built-in Library State
const iconQueryOverride = ref('');
const iconQueryManual = ref(false);
const iconLocked = ref(false);
const colorLocked = ref(false);
const onlineCandidates = ref<IconSearchCandidate[]>([]);
const onlineLoading = ref(false);
const applyingIconId = ref<string | null>(null);
const iconFeedback = ref('');
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
let activeAbort: AbortController | null = null;
let searchSeq = 0;

const defaultLibraryCandidates = featuredLocalBrands(12);

const effectiveIconQuery = computed(() =>
  (iconQueryManual.value ? iconQueryOverride.value : title.value).trim(),
);

const localCandidates = computed<IconSearchCandidate[]>(() => {
  if (!effectiveIconQuery.value) return defaultLibraryCandidates;
  return searchLocalBrands(effectiveIconQuery.value, 6);
});

const allCandidates = computed<IconSearchCandidate[]>(() => {
  if (!effectiveIconQuery.value) return defaultLibraryCandidates;
  const seen = new Set<string>();
  const out: IconSearchCandidate[] = [];
  for (const c of [...localCandidates.value, ...onlineCandidates.value]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out.length ? out : defaultLibraryCandidates.slice(0, 8);
});

const previewWatermark = computed(() => title.value.trim() || '订阅卡片');
const quickParsed = computed(() => parseQuickSubscriptionText(title.value));

const visibleCycles = computed<SubscriptionCycle[]>(() =>
  cycle.value === 'semiannual' ? [...QUICK_CYCLES, 'semiannual'] : QUICK_CYCLES,
);

const parsedPrice = computed(() => {
  const n = Number.parseFloat(priceStr.value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
});

const parsedDiscount = computed(() => {
  const n = Number.parseFloat(discountStr.value);
  return Number.isFinite(n) && n > 0 ? Math.min(parsedPrice.value, n) : undefined;
});

const parsedPromoPrice = computed(() => {
  if (promoPriceStr.value.trim() === '') return undefined;
  const n = Number.parseFloat(promoPriceStr.value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
});

const hasPromoOrDiscount = computed(
  () => (parsedDiscount.value ?? 0) > 0 || parsedPromoPrice.value !== undefined,
);

const promoCapsuleText = computed(() => {
  const sym = CURRENCY_META[currency.value]?.symbol ?? '¥';
  if (parsedPromoPrice.value !== undefined && (parsedDiscount.value ?? 0) > 0) {
    return `首期${sym}${parsedPromoPrice.value} · 减${sym}${parsedDiscount.value}`;
  }
  if (parsedPromoPrice.value !== undefined) {
    const tag = promoLabel.value.trim() || (promoPeriods.value > 1 ? `前${promoPeriods.value}期` : '首期');
    return `${tag} ${sym}${parsedPromoPrice.value}`;
  }
  if ((parsedDiscount.value ?? 0) > 0) {
    return `立减 ${sym}${parsedDiscount.value}`;
  }
  return '优惠 / 首月';
});

function readRememberedShowOnCal(): boolean {
  try {
    return localStorage.getItem(SHOW_ON_CAL_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRememberedShowOnCal(val: boolean) {
  try {
    localStorage.setItem(SHOW_ON_CAL_PREF_KEY, val ? '1' : '0');
  } catch {
    /* ignore storage errors */
  }
}

function toggleShowOnCalendar() {
  showOnCalendar.value = !showOnCalendar.value;
  writeRememberedShowOnCal(showOnCalendar.value);
}

function toggleAutoRenew() {
  autoRenew.value = !autoRenew.value;
  // Sync effortless "subscribed but auto-renew turned off" state
  if (!autoRenew.value && status.value === 'active') {
    status.value = 'ending';
  } else if (autoRenew.value && status.value === 'ending') {
    status.value = 'active';
  }
}

function pickStatus(st: SubscriptionStatus) {
  status.value = st;
  if (st === 'ending' || st === 'trial' || st === 'paused' || st === 'cancelled') {
    autoRenew.value = false;
  } else if (st === 'active') {
    autoRenew.value = true;
  }
  closePopover();
}

function openPopover(kind: Exclude<PopoverKind, null>, event: MouseEvent) {
  if (activePopover.value === kind) {
    activePopover.value = null;
    return;
  }
  const trigger = event.currentTarget as HTMLElement | null;
  activePopover.value = kind;
  if (kind === 'color') {
    hexInput.value = brandColor.value.toUpperCase();
    hexInvalid.value = false;
  }
  if (kind === 'accounts' && !newAccPriceStr.value) {
    newAccPriceStr.value = priceStr.value || '20';
  }
  if (kind === 'icon' && effectiveIconQuery.value.length >= 2 && !onlineCandidates.value.length && !onlineLoading.value) {
    triggerOnlineSearch(effectiveIconQuery.value, true);
  }
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const estWidth =
    kind === 'icon'
      ? 324
      : kind === 'accounts'
        ? 316
        : kind === 'promo'
          ? 294
          : kind === 'color'
            ? 276
            : kind === 'status'
              ? 248
              : kind === 'payment'
                ? 248
                : 210;
  const estHeight =
    kind === 'icon'
      ? 260
      : kind === 'accounts'
        ? 276
        : kind === 'promo'
          ? 246
          : kind === 'status'
            ? 236
            : kind === 'color'
              ? 218
              : 196;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 12;

  let left = kind === 'color' ? rect.right - estWidth : rect.left;
  left = Math.max(margin, Math.min(vw - estWidth - margin, left));

  let top = rect.bottom + 8;
  if (top + estHeight > vh - margin && rect.top - estHeight - 8 >= margin) {
    top = rect.top - estHeight - 8;
  } else {
    top = Math.min(vh - estHeight - margin, top);
  }

  popoverStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(Math.max(margin, top))}px`,
    width: `${Math.min(estWidth, vw - margin * 2)}px`,
  };
}

function closePopover() {
  activePopover.value = null;
}

function onGlobalPointerDown(e: MouseEvent) {
  if (!activePopover.value) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (popoverRef.value?.contains(target)) return;
  if (target.closest('[data-pop-trigger]')) return;
  activePopover.value = null;
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    if (activePopover.value) {
      e.stopPropagation();
      activePopover.value = null;
    } else {
      emit('close');
    }
  }
}

onMounted(() => {
  window.addEventListener('mousedown', onGlobalPointerDown, true);
  window.addEventListener('keydown', onGlobalKeyDown);
});

onBeforeUnmount(() => {
  cancelIconSearch();
  window.removeEventListener('mousedown', onGlobalPointerDown, true);
  window.removeEventListener('keydown', onGlobalKeyDown);
});

function cancelIconSearch() {
  if (searchDebounce) {
    clearTimeout(searchDebounce);
    searchDebounce = undefined;
  }
  activeAbort?.abort();
  activeAbort = null;
  onlineLoading.value = false;
}

function triggerOnlineSearch(rawQuery: string, immediate = false) {
  cancelIconSearch();
  const q = rawQuery.trim();
  if (q.length < 2) {
    onlineCandidates.value = [];
    return;
  }

  const run = async () => {
    const seq = ++searchSeq;
    const ctrl = new AbortController();
    activeAbort = ctrl;
    onlineLoading.value = true;
    try {
      const list = await searchOnlineIcons(q, ctrl.signal);
      if (seq !== searchSeq) return;
      onlineCandidates.value = list;
    } catch {
      if (seq === searchSeq) onlineCandidates.value = [];
    } finally {
      if (seq === searchSeq) {
        onlineLoading.value = false;
        activeAbort = null;
      }
    }
  };

  if (immediate) {
    void run();
  } else {
    searchDebounce = setTimeout(() => void run(), 340);
  }
}

watch(effectiveIconQuery, (q) => {
  if (!props.open) return;
  iconFeedback.value = '';
  if (!iconLocked.value && !iconQueryManual.value) {
    const inferred = inferBrandFromTitle(q);
    if (inferred) {
      brandKey.value = inferred.key;
      iconAutoColor.value = inferred.brandColor;
      if (!colorLocked.value) {
        brandColor.value = inferred.brandColor;
        hexInput.value = inferred.brandColor.toUpperCase();
      }
      if (!props.editingTask) category.value = inferred.category;
    } else if (!iconData.value) {
      brandKey.value = undefined;
    }
  }
  triggerOnlineSearch(q, false);
});

async function pickIconCandidate(c: IconSearchCandidate) {
  if (applyingIconId.value) return;
  applyingIconId.value = c.id;
  iconFeedback.value = '';
  try {
    const res = await materializeIconCandidate(c);
    iconLocked.value = true;
    brandKey.value = res.brandKey;
    iconData.value = res.iconData;
    if (res.brandColor) {
      iconAutoColor.value = res.brandColor;
      brandColor.value = res.brandColor;
      hexInput.value = res.brandColor.toUpperCase();
      colorLocked.value = false;
    }
    if (res.category && !props.editingTask) category.value = res.category;
    closePopover();
  } catch {
    iconFeedback.value = '图标下载失败，可重试或本地上传';
  } finally {
    applyingIconId.value = null;
  }
}

function triggerFileUpload() {
  fileInputRef.value?.click();
}

async function onIconFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  iconFeedback.value = '';
  try {
    const res = await compressUploadedIconFile(file);
    iconLocked.value = true;
    brandKey.value = undefined;
    iconData.value = res.iconData;
    if (res.brandColor) {
      iconAutoColor.value = res.brandColor;
      brandColor.value = res.brandColor;
      hexInput.value = res.brandColor.toUpperCase();
      colorLocked.value = false;
    }
    closePopover();
  } catch {
    iconFeedback.value = '图片读取失败，请换一张常见格式图片';
  }
}

function selectBrandColor(hex: string) {
  const norm = normalizeHexColor(hex) ?? hex;
  brandColor.value = norm;
  hexInput.value = norm;
  hexInvalid.value = false;
  colorLocked.value = true;
}

function onHexInputChange(raw: string) {
  hexInput.value = raw;
  const norm = normalizeHexColor(raw);
  if (norm) {
    brandColor.value = norm;
    colorLocked.value = true;
    hexInvalid.value = false;
  } else {
    hexInvalid.value = raw.trim().length > 0;
  }
}

function onNativeColorInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  if (val) selectBrandColor(val);
}

function resetColorToIcon() {
  brandColor.value = iconAutoColor.value;
  hexInput.value = iconAutoColor.value.toUpperCase();
  hexInvalid.value = false;
  colorLocked.value = false;
}

function clearCustomIcon() {
  iconData.value = undefined;
  brandKey.value = undefined;
  iconLocked.value = false;
  const inferred = inferBrandFromTitle(title.value);
  if (inferred) {
    brandKey.value = inferred.key;
    iconAutoColor.value = inferred.brandColor;
    if (!colorLocked.value) {
      brandColor.value = inferred.brandColor;
      hexInput.value = inferred.brandColor.toUpperCase();
    }
  }
}

function isCandidateActive(c: IconSearchCandidate): boolean {
  if (c.source === 'local') return !iconData.value && brandKey.value === c.brandKey;
  return false;
}

function applyQuickParsed() {
  const p = quickParsed.value;
  if (!p) return;
  title.value = p.title;
  priceStr.value = String(p.price);
  if (p.currency) currency.value = p.currency;
  if (p.cycle) cycle.value = p.cycle;
}

function clearPromoFields() {
  discountStr.value = '';
  promoPriceStr.value = '';
  promoPeriods.value = 1;
  promoLabel.value = '';
}

function addSubAccount() {
  const label = newAccLabel.value.trim() || `副号 ${subAccounts.value.length + 1}`;
  const pr = Number.parseFloat(newAccPriceStr.value);
  const price = Number.isFinite(pr) && pr >= 0 ? pr : parsedPrice.value;
  subAccounts.value = [
    ...subAccounts.value,
    {
      id: `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      plan: newAccPlan.value.trim() || plan.value.trim() || undefined,
      price,
      currency: currency.value,
      cycle: cycle.value,
      status: newAccStatus.value,
      autoRenew: newAccStatus.value === 'active',
    },
  ];
  newAccLabel.value = '';
  newAccPlan.value = '';
}

function cycleSubAccountStatus(idx: number) {
  const order: SubscriptionStatus[] = ['active', 'ending', 'paused'];
  const cur = subAccounts.value[idx];
  if (!cur) return;
  const nextSt = order[(order.indexOf(cur.status ?? 'active') + 1) % order.length];
  subAccounts.value = subAccounts.value.map((a, i) =>
    i === idx ? { ...a, status: nextSt, autoRenew: nextSt === 'active' } : a,
  );
}

function removeSubAccount(idx: number) {
  subAccounts.value = subAccounts.value.filter((_, i) => i !== idx);
}

// 1:1 Swipe-Down Grabber to Dismiss on Phone Bottom Sheet
const smDragY = ref(0);
const smDragging = ref(false);
let smStartY = 0;

function onSmGrabTouchStart(e: TouchEvent) {
  if (!isPhone.value || e.touches.length !== 1) return;
  smStartY = e.touches[0].clientY;
  smDragging.value = true;
}

function onSmGrabTouchMove(e: TouchEvent) {
  if (!smDragging.value || e.touches.length !== 1) return;
  const dy = e.touches[0].clientY - smStartY;
  if (dy > 0) {
    e.preventDefault();
    smDragY.value = dy;
  }
}

function onSmGrabTouchEnd() {
  if (!smDragging.value) return;
  const close = smDragY.value > 76;
  smDragging.value = false;
  smDragY.value = 0;
  if (close) emit('close');
}

watch(
  () => [props.open, props.editingTask, props.defaultDate] as const,
  async ([isOpen, task, defDate]) => {
    cancelIconSearch();
    activePopover.value = null;
    onlineCandidates.value = [];
    iconFeedback.value = '';
    iconQueryOverride.value = '';
    iconQueryManual.value = false;
    applyingIconId.value = null;
    hexInvalid.value = false;
    newAccLabel.value = '';
    newAccPlan.value = '';
    newAccPriceStr.value = '';
    newAccStatus.value = 'active';

    if (!isOpen) return;
    if (task) {
      const m = task.subscription;
      const inferred = !m.iconData && !m.brandKey ? inferBrandFromTitle(task.title) : undefined;
      const resolvedColor =
        m.brandColor || inferred?.brandColor || CATEGORY_META[m.category]?.color || '#10A37F';
      title.value = task.title;
      plan.value = m.plan ?? '';
      brandKey.value = m.brandKey ?? inferred?.key;
      iconData.value = m.iconData;
      brandColor.value = resolvedColor;
      iconAutoColor.value = inferred?.brandColor || resolvedColor;
      hexInput.value = resolvedColor.toUpperCase();
      priceStr.value = String(m.price);
      discountStr.value = m.discountAmount ? String(m.discountAmount) : '';
      promoPriceStr.value = typeof m.promoPrice === 'number' ? String(m.promoPrice) : '';
      promoPeriods.value = Math.max(1, m.promoPeriods ?? 1);
      promoLabel.value = m.promoLabel ?? '';
      subAccounts.value = (m.accounts ?? []).map((a) => ({ ...a }));
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
      iconLocked.value = !!(m.iconData || m.brandKey);
      colorLocked.value = true;
      if (task.title.trim().length >= 2) {
        triggerOnlineSearch(task.title, false);
      }
    } else {
      title.value = '';
      plan.value = '';
      brandKey.value = undefined;
      iconData.value = undefined;
      brandColor.value = '#10A37F';
      iconAutoColor.value = '#10A37F';
      hexInput.value = '#10A37F';
      priceStr.value = '15';
      discountStr.value = '';
      promoPriceStr.value = '';
      promoPeriods.value = 1;
      promoLabel.value = '';
      subAccounts.value = [];
      currency.value = 'CNY';
      cycle.value = 'monthly';
      category.value = 'media';
      status.value = 'active';
      startDate.value = defDate || now.value;
      autoRenew.value = true;
      splitCount.value = 1;
      paymentMethod.value = '';
      notes.value = '';
      showOnCalendar.value = readRememberedShowOnCal();
      iconLocked.value = false;
      colorLocked.value = false;
    }
    await nextTick();
    titleInputRef.value?.focus();
  },
);

function applyPreset(p: SubscriptionPreset) {
  title.value = p.title;
  plan.value = p.plan ?? '';
  const inferred = inferBrandFromTitle(p.title);
  brandKey.value = p.brandKey ?? inferred?.key;
  iconData.value = undefined;
  brandColor.value = p.brandColor;
  iconAutoColor.value = p.brandColor;
  hexInput.value = p.brandColor.toUpperCase();
  priceStr.value = String(p.price);
  discountStr.value = p.discountAmount ? String(p.discountAmount) : '';
  promoPriceStr.value = typeof p.promoPrice === 'number' ? String(p.promoPrice) : '';
  promoPeriods.value = 1;
  promoLabel.value = p.promoLabel ?? '';
  currency.value = p.currency;
  cycle.value = p.cycle;
  category.value = p.category;
  splitCount.value = p.splitCount ?? 1;
  paymentMethod.value = p.paymentMethod;
  status.value = p.status ?? 'active';
  autoRenew.value = p.autoRenew ?? true;
  iconLocked.value = false;
  colorLocked.value = false;
  iconQueryManual.value = false;
}

const draftMeta = computed<SubscriptionMeta>(() => ({
  price: parsedPrice.value,
  currency: currency.value,
  cycle: cycle.value,
  category: category.value,
  status: status.value,
  autoRenew: autoRenew.value,
  plan: plan.value.trim() || undefined,
  discountAmount: parsedDiscount.value,
  promoPrice: parsedPromoPrice.value,
  promoPeriods: parsedPromoPrice.value !== undefined ? promoPeriods.value : undefined,
  promoLabel: promoLabel.value.trim() || undefined,
  accounts: subAccounts.value.length ? subAccounts.value : undefined,
  splitCount: splitCount.value > 1 ? splitCount.value : undefined,
  paymentMethod: paymentMethod.value.trim() || undefined,
  emblem: title.value.trim().slice(0, 1).toUpperCase() || '◈',
  brandKey: brandKey.value || undefined,
  iconData: iconData.value || undefined,
  brandColor: brandColor.value,
  watermark: undefined,
  showOnCalendar: showOnCalendar.value || undefined,
}));

const previewMonthlyCNY = computed(() => monthlyEquivalentCNY(draftMeta.value));
const previewPersonalOrig = computed(() => personalPriceOriginal(draftMeta.value));

async function onSubmit() {
  if (quickParsed.value) applyQuickParsed();
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
      <div
        class="sub-modal-card ws-modal-card"
        :class="{ phone: isPhone, dragging: smDragging }"
        :style="isPhone && smDragY > 0 ? { transform: `translate3d(0, ${smDragY.toFixed(1)}px, 0)` } : undefined"
      >
        <div
          v-if="isPhone"
          class="sm-grab-zone"
          aria-hidden="true"
          @touchstart="onSmGrabTouchStart"
          @touchmove="onSmGrabTouchMove"
          @touchend="onSmGrabTouchEnd"
          @touchcancel="onSmGrabTouchEnd"
        >
          <div class="sm-grab" />
        </div>

        <header
          class="sm-head"
          @touchstart="onSmGrabTouchStart"
          @touchmove="onSmGrabTouchMove"
          @touchend="onSmGrabTouchEnd"
          @touchcancel="onSmGrabTouchEnd"
        >
          <h2 class="sm-title">{{ editingTask ? '编辑订阅' : '添加订阅' }}</h2>
          <button type="button" class="ws-icon-circle" title="关闭" aria-label="关闭" @click="emit('close')">
            <FIcon name="close" :size="13" />
          </button>
        </header>

        <!-- Zero-Scroll Single-Screen Editorial Form -->
        <form id="sub-editor-form" class="sm-body" @submit.prevent="onSubmit">
          <!-- Interactive Fushi Hero Card -->
          <FushiTonalCard
            variant="preview"
            class="sm-preview-fushi"
            :tint="brandColor"
            :watermark="previewWatermark"
            :progress="48"
          >
            <template #emblem>
              <button
                type="button"
                class="sm-emblem-trigger"
                data-pop-trigger="icon"
                title="点击更换图标"
                aria-label="更换订阅图标"
                @click="openPopover('icon', $event)"
              >
                <div class="sm-pv-emblem-wrap">
                  <SubscriptionEmblem
                    :brand-key="brandKey"
                    :icon-data="iconData"
                    :title="title"
                    :brand-color="brandColor"
                    :size="50"
                    :radius="14"
                  />
                </div>
                <span class="sm-emblem-badge" aria-hidden="true">
                  <FIcon name="edit" :size="10" />
                </span>
              </button>
            </template>

            <div class="sm-pv-row">
              <div class="sm-pv-copy">
                <div class="sm-pv-name">{{ title || '未命名订阅' }}</div>
                <div class="sm-pv-meta">
                  <span>{{ formatCurrencyAmount(previewPersonalOrig, currency) }} / {{ CYCLE_META[cycle].short }}</span>
                  <span v-if="parsedPromoPrice !== undefined" class="sm-pv-tag">
                    {{ promoLabel || '首期' }} {{ formatCurrencyAmount(parsedPromoPrice, currency) }}
                  </span>
                  <span v-if="status !== 'active'" class="sm-pv-tag">{{ STATUS_LABELS[status] }}</span>
                  <span v-if="subAccounts.length" class="sm-pv-tag">共 {{ subAccounts.length + 1 }} 号</span>
                  <span v-else-if="splitCount > 1" class="sm-pv-tag">{{ splitCount }}人拼车</span>
                </div>
              </div>
              <div class="sm-pv-cny">
                <strong>¥{{ Math.round(previewMonthlyCNY * 10) / 10 }}</strong>
                <span>/ 月均</span>
              </div>
            </div>

            <template #progressEnd>
              <button
                type="button"
                class="sm-color-trigger"
                :class="{ active: activePopover === 'color' }"
                data-pop-trigger="color"
                title="更换卡片主题色 / 输入 #Hex"
                aria-label="更换卡片主题色"
                @click="openPopover('color', $event)"
              >
                <span class="sm-color-dot" :style="{ background: brandColor }" />
              </button>
            </template>
          </FushiTonalCard>

          <!-- Name Input + Contextual Detailed AI & Daily Presets / Shorthand Chip -->
          <div class="sm-name-group">
            <input
              ref="titleInputRef"
              v-model="title"
              type="text"
              class="sm-input lg"
              placeholder="输入订阅名称，如 ChatGPT Plus、网易云音乐（支持 名称+金额）"
              required
            />

            <button
              v-if="quickParsed"
              type="button"
              class="sm-shorthand-chip"
              @click="applyQuickParsed"
            >
              <FIcon name="sparkles" :size="12" />
              <span>
                速填：{{ quickParsed.title }} ·
                {{ formatCurrencyAmount(quickParsed.price, quickParsed.currency ?? currency) }}/{{ CYCLE_META[quickParsed.cycle ?? cycle].short }}
              </span>
            </button>

            <div v-else-if="!editingTask && !title.trim()" class="sm-presets">
              <button
                v-for="p in SUBSCRIPTION_PRESETS"
                :key="p.key"
                type="button"
                class="sm-preset-chip"
                @click="applyPreset(p)"
              >
                <SubscriptionEmblem
                  :brand-key="p.brandKey"
                  :title="p.title"
                  :emblem="p.emblem"
                  :brand-color="p.brandColor"
                  :size="18"
                  :radius="5"
                />
                <span>{{ p.title }}</span>
              </button>
            </div>
          </div>

          <!-- Core Finance Strip: [Currency+Price] + [Cycle Segmented] + [Due Date] -->
          <div class="sm-finance-row">
            <div class="sm-price-combo">
              <select v-model="currency" class="sm-cur-select" aria-label="币种">
                <option v-for="c in SUBSCRIPTION_CURRENCIES" :key="c" :value="c">
                  {{ c === 'JPY' ? 'JP¥' : CURRENCY_META[c].symbol }}
                </option>
              </select>
              <input
                v-model="priceStr"
                type="number"
                step="0.01"
                min="0"
                class="sm-price-input tabular"
                aria-label="原价金额"
                placeholder="0"
                required
              />
            </div>

            <div class="sm-cycle-seg" role="radiogroup" aria-label="计费周期">
              <button
                v-for="cy in visibleCycles"
                :key="cy"
                type="button"
                class="sm-cycle-btn"
                :class="{ active: cycle === cy }"
                @click="cycle = cy"
              >
                {{ CYCLE_META[cy].short.replace('付', '') }}
              </button>
            </div>

            <label class="sm-date-chip" title="下次到期 / 扣费日">
              <input v-model="startDate" type="date" class="sm-date-input tabular" aria-label="到期 / 扣费日" required />
            </label>
          </div>

          <!-- Lightweight Semantic Attribute Capsules (Zero Scroll, Progressive Disclosure) -->
          <div class="sm-attr-strip">
            <button
              type="button"
              class="sm-attr-pill"
              :class="{ open: activePopover === 'category' }"
              data-pop-trigger="category"
              @click="openPopover('category', $event)"
            >
              <span class="sm-cat-dot" :style="{ background: CATEGORY_META[category].color }" />
              <span>{{ CATEGORY_META[category].label }}</span>
              <FIcon name="chevronDown" :size="10" class="sm-pill-caret" />
            </button>

            <button
              type="button"
              class="sm-attr-pill"
              :class="{
                lit: status !== 'active',
                trial: status === 'trial' || status === 'ending',
                open: activePopover === 'status',
              }"
              data-pop-trigger="status"
              @click="openPopover('status', $event)"
            >
              <span>{{ STATUS_LABELS[status] }}</span>
              <FIcon name="chevronDown" :size="10" class="sm-pill-caret" />
            </button>

            <button
              type="button"
              class="sm-attr-pill"
              :class="{ lit: hasPromoOrDiscount, promo: hasPromoOrDiscount, open: activePopover === 'promo' }"
              data-pop-trigger="promo"
              @click="openPopover('promo', $event)"
            >
              <span>{{ promoCapsuleText }}</span>
              <FIcon name="chevronDown" :size="10" class="sm-pill-caret" />
            </button>

            <button
              type="button"
              class="sm-attr-pill"
              :class="{ lit: subAccounts.length > 0, open: activePopover === 'accounts' }"
              data-pop-trigger="accounts"
              @click="openPopover('accounts', $event)"
            >
              <span>{{ subAccounts.length ? `多账号 (${subAccounts.length + 1})` : '子订阅' }}</span>
              <FIcon name="chevronDown" :size="10" class="sm-pill-caret" />
            </button>

            <button
              type="button"
              class="sm-attr-pill"
              :class="{ lit: splitCount > 1, open: activePopover === 'split' }"
              data-pop-trigger="split"
              @click="openPopover('split', $event)"
            >
              <span>{{ splitCount === 1 ? '独享' : `${splitCount}人拼车` }}</span>
              <FIcon name="chevronDown" :size="10" class="sm-pill-caret" />
            </button>

            <button
              type="button"
              class="sm-attr-pill"
              :class="{ lit: !!paymentMethod.trim(), open: activePopover === 'payment' }"
              data-pop-trigger="payment"
              @click="openPopover('payment', $event)"
            >
              <span>{{ paymentMethod.trim() || '渠道' }}</span>
              <FIcon name="chevronDown" :size="10" class="sm-pill-caret" />
            </button>
          </div>

          <!-- Compact Side-by-Side Toggle Bar -->
          <div class="sm-toggle-strip" aria-label="续费与日历显示设置">
            <button
              type="button"
              role="switch"
              :aria-checked="autoRenew"
              class="sm-toggle-cell"
              @click="toggleAutoRenew"
            >
              <span class="sm-tc-label">自动续费</span>
              <span class="t-toggle sm-switch" :data-on="autoRenew ? 'true' : 'false'" aria-hidden="true">
                <span class="t-toggle-thumb" />
              </span>
            </button>

            <span class="sm-toggle-sep" aria-hidden="true" />

            <button
              type="button"
              role="switch"
              :aria-checked="showOnCalendar"
              aria-label="到期日显示在主日历网格中"
              class="sm-toggle-cell"
              @click="toggleShowOnCalendar"
            >
              <span class="sm-tc-label">{{ isPhone ? '到期日入主日历' : '到期日显示在主日历' }}</span>
              <span class="t-toggle sm-switch" :data-on="showOnCalendar ? 'true' : 'false'" aria-hidden="true">
                <span class="t-toggle-thumb" />
              </span>
            </button>
          </div>
        </form>

        <!-- Hidden File Input for Local Icon Upload -->
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="sm-hidden-file"
          @change="onIconFileChange"
        />

        <!-- Sticky Bottom Action Bar -->
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
            <button
              type="submit"
              form="sub-editor-form"
              class="sm-btn primary"
              :disabled="!title.trim() || saving"
            >
              {{ editingTask ? '保存修改' : '添加订阅' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Transition>

  <!-- Floating Popovers (Teleported to Body so never clipped & zero modal scroll!) -->
  <Teleport to="body">
    <Transition name="sm-pop">
      <div
        v-if="open && activePopover"
        ref="popoverRef"
        class="sm-popover"
        :class="`sm-pop-${activePopover}`"
        :style="[popoverStyle, { '--pop-tint': brandColor }]"
        @mousedown.stop
      >
        <!-- 1. ICON PICKER POPOVER (Refined Fushi Tonal Active State + Checkmark Badge!) -->
        <template v-if="activePopover === 'icon'">
          <div class="smp-icon-bar">
            <div class="smp-search">
              <FIcon name="search" :size="12" class="smp-s-ico" />
              <input
                :value="iconQueryManual ? iconQueryOverride : title"
                type="text"
                class="smp-s-input"
                placeholder="搜应用名或网址…"
                @input="
                  iconQueryManual = true;
                  iconQueryOverride = ($event.target as HTMLInputElement).value;
                "
                @keydown.enter.prevent="triggerOnlineSearch(effectiveIconQuery, true)"
              />
              <button
                v-if="effectiveIconQuery.length >= 2"
                type="button"
                class="smp-s-go"
                @click="triggerOnlineSearch(effectiveIconQuery, true)"
              >
                {{ onlineLoading ? '…' : '搜' }}
              </button>
            </div>
            <button type="button" class="smp-mini-btn" title="上传本地图片" @click="triggerFileUpload">
              <FIcon name="upload" :size="12" />
              <span>上传</span>
            </button>
            <button
              v-if="iconData || brandKey"
              type="button"
              class="smp-mini-btn muted"
              title="恢复自动匹配"
              @click="clearCustomIcon"
            >
              重置
            </button>
          </div>

          <div class="smp-icon-grid">
            <button
              v-for="c in allCandidates"
              :key="c.id"
              type="button"
              class="sm-ic-tile"
              :class="{ active: isCandidateActive(c), loading: applyingIconId === c.id }"
              :title="`${c.name}${c.subtitle ? ` (${c.subtitle})` : ''}`"
              @click="pickIconCandidate(c)"
            >
              <span v-if="isCandidateActive(c)" class="sm-ic-check" aria-hidden="true">
                <FIcon name="check" :size="9" />
              </span>
              <SubscriptionEmblem
                v-if="c.source === 'local'"
                :brand-key="c.brandKey"
                :emblem="c.emblem"
                :brand-color="c.brandColor"
                :size="34"
                :radius="10"
              />
              <span
                v-else
                class="sm-ic-remote"
                :class="{ mono: c.monochrome }"
                :style="c.monochrome ? { background: brandColor } : undefined"
              >
                <img :src="c.previewUrl" :alt="c.name" decoding="async" referrerpolicy="no-referrer" />
              </span>
              <span class="sm-ic-name">{{ c.name }}</span>
            </button>

            <div v-if="onlineLoading && !onlineCandidates.length" class="smp-skeleton" aria-hidden="true">
              <span /><span /><span />
            </div>
          </div>
          <div v-if="iconFeedback" class="smp-err">{{ iconFeedback }}</div>
        </template>

        <!-- 2. COLOR & CUSTOM #HEX POPOVER -->
        <template v-else-if="activePopover === 'color'">
          <div class="smp-head">
            <span class="smp-title">卡片主题色</span>
            <button
              type="button"
              class="smp-follow-btn"
              :class="{ active: !colorLocked }"
              @click="resetColorToIcon"
            >
              <span class="smp-follow-dot" :style="{ background: iconAutoColor }" />
              <span>跟随图标主色</span>
            </button>
          </div>

          <div class="smp-swatch-grid">
            <button
              v-for="hex in BRAND_COLOR_SWATCHES"
              :key="hex"
              type="button"
              class="smp-swatch"
              :class="{ active: brandColor.toUpperCase() === hex.toUpperCase() }"
              :style="{ background: hex }"
              :aria-label="`主题色 ${hex}`"
              @click="selectBrandColor(hex)"
            />
          </div>

          <div class="smp-hex-row">
            <label class="smp-wheel-btn" title="调色器自选颜色">
              <span class="smp-wheel-fill" :style="{ background: brandColor }" />
              <input
                type="color"
                class="smp-native-color"
                :value="normalizeHexColor(brandColor) ?? '#10A37F'"
                aria-label="自定义取色器"
                @input="onNativeColorInput"
              />
            </label>
            <input
              :value="hexInput"
              type="text"
              class="smp-hex-input tabular"
              :class="{ invalid: hexInvalid }"
              placeholder="#D43C33"
              maxlength="9"
              spellcheck="false"
              aria-label="自定义 Hex 色值"
              @input="onHexInputChange(($event.target as HTMLInputElement).value)"
            />
          </div>
        </template>

        <!-- 3. CATEGORY POPOVER -->
        <template v-else-if="activePopover === 'category'">
          <div class="smp-list">
            <button
              v-for="cat in SUBSCRIPTION_CATEGORIES"
              :key="cat"
              type="button"
              class="smp-opt"
              :class="{ active: category === cat }"
              @click="
                category = cat;
                closePopover();
              "
            >
              <span class="sm-cat-dot" :style="{ background: CATEGORY_META[cat].color }" />
              <span>{{ CATEGORY_META[cat].label }}</span>
            </button>
          </div>
        </template>

        <!-- 4. EXPANDED STATUS POPOVER (including '已关续费') -->
        <template v-else-if="activePopover === 'status'">
          <div class="smp-list">
            <button
              v-for="st in SUBSCRIPTION_STATUSES"
              :key="st"
              type="button"
              class="smp-opt status-opt"
              :class="{ active: status === st }"
              @click="pickStatus(st)"
            >
              <span class="smp-st-name">{{ STATUS_LABELS[st] }}</span>
              <span class="smp-st-hint">{{ STATUS_HINTS[st] }}</span>
            </button>
          </div>
        </template>

        <!-- 5. DISCOUNT & FIRST-MONTH PROMO POPOVER -->
        <template v-else-if="activePopover === 'promo'">
          <div class="smp-head">
            <span class="smp-title">优惠额度与首期特惠</span>
            <button v-if="hasPromoOrDiscount" type="button" class="smp-clear-link" @click="clearPromoFields">
              清空
            </button>
          </div>

          <div class="smp-field-row">
            <label class="smp-mini-field">
              <span>每期立减 ({{ CURRENCY_META[currency].symbol }})</span>
              <input
                v-model="discountStr"
                type="number"
                step="0.01"
                min="0"
                class="smp-num-input tabular"
                placeholder="如 5"
              />
            </label>
            <label class="smp-mini-field">
              <span>首期特惠价 ({{ CURRENCY_META[currency].symbol }})</span>
              <input
                v-model="promoPriceStr"
                type="number"
                step="0.01"
                min="0"
                class="smp-num-input tabular"
                placeholder="如 1"
              />
            </label>
          </div>

          <div v-if="parsedPromoPrice !== undefined" class="smp-promo-extra">
            <span class="smp-sub-lbl">特惠期数</span>
            <div class="smp-chip-grid">
              <button
                v-for="p in [1, 3, 6]"
                :key="p"
                type="button"
                class="smp-choice sm"
                :class="{ active: promoPeriods === p }"
                @click="promoPeriods = p"
              >
                {{ p === 1 ? '仅首期' : `前 ${p} 期` }}
              </button>
            </div>
          </div>

          <div class="smp-chip-grid">
            <button
              v-for="lbl in PROMO_QUICK_LABELS"
              :key="lbl"
              type="button"
              class="smp-choice sm"
              :class="{ active: promoLabel === lbl }"
              @click="promoLabel = promoLabel === lbl ? '' : lbl"
            >
              {{ lbl }}
            </button>
          </div>
        </template>

        <!-- 6. MULTI-ACCOUNT / SUB-SUBSCRIPTIONS POPOVER -->
        <template v-else-if="activePopover === 'accounts'">
          <div class="smp-head">
            <span class="smp-title">子订阅 / 多账号管理</span>
            <span class="smp-count-pill">主号 + {{ subAccounts.length }} 副号</span>
          </div>

          <div v-if="subAccounts.length" class="smp-acc-list">
            <div v-for="(acc, idx) in subAccounts" :key="acc.id" class="smp-acc-item">
              <div class="smp-acc-info">
                <strong>{{ acc.label }}</strong>
                <span class="tabular">
                  <template v-if="acc.plan">{{ acc.plan }} · </template>
                  {{ formatCurrencyAmount(acc.price, acc.currency ?? currency) }}/{{ CYCLE_META[acc.cycle ?? cycle].short.replace('付', '') }}
                </span>
              </div>
              <button
                type="button"
                class="smp-acc-st"
                :class="acc.status ?? 'active'"
                title="点击切换子账号状态"
                @click="cycleSubAccountStatus(idx)"
              >
                {{ STATUS_LABELS[acc.status ?? 'active'] }}
              </button>
              <button type="button" class="smp-acc-del" aria-label="删除子账号" @click="removeSubAccount(idx)">
                <FIcon name="close" :size="10" />
              </button>
            </div>
          </div>

          <div class="smp-acc-add">
            <input
              v-model="newAccLabel"
              type="text"
              class="smp-custom-input"
              placeholder="账号名（如 工作副号 / 美区号）"
            />
            <div class="smp-acc-add-row">
              <input
                v-model="newAccPlan"
                type="text"
                class="smp-custom-input"
                placeholder="档位 (Plus/Max)"
              />
              <input
                v-model="newAccPriceStr"
                type="number"
                step="0.01"
                min="0"
                class="smp-custom-input num tabular"
                :placeholder="`${CURRENCY_META[currency].symbol}金额`"
              />
              <button type="button" class="smp-add-go" @click="addSubAccount">+ 添加</button>
            </div>
          </div>
        </template>

        <!-- 7. SPLIT-BILL POPOVER -->
        <template v-else-if="activePopover === 'split'">
          <div class="smp-head">
            <span class="smp-title">拼车平摊人数</span>
          </div>
          <div class="smp-chip-grid">
            <button
              v-for="n in [1, 2, 3, 4, 6]"
              :key="n"
              type="button"
              class="smp-choice"
              :class="{ active: splitCount === n }"
              @click="
                splitCount = n;
                closePopover();
              "
            >
              {{ n === 1 ? '独享' : `${n}人` }}
            </button>
          </div>
          <div class="smp-stepper">
            <button type="button" class="smp-step-btn" :disabled="splitCount <= 1" @click="stepSplit(-1)">−</button>
            <span class="smp-step-val tabular">{{ splitCount === 1 ? '1 人独享' : `${splitCount} 人平摊` }}</span>
            <button type="button" class="smp-step-btn" :disabled="splitCount >= 12" @click="stepSplit(1)">+</button>
          </div>
        </template>

        <!-- 8. PAYMENT METHOD POPOVER -->
        <template v-else-if="activePopover === 'payment'">
          <div class="smp-chip-grid">
            <button
              v-for="pm in PAYMENT_QUICK_CHOICES"
              :key="pm"
              type="button"
              class="smp-choice"
              :class="{ active: paymentMethod === pm }"
              @click="
                paymentMethod = pm;
                closePopover();
              "
            >
              {{ pm }}
            </button>
            <button
              v-if="paymentMethod"
              type="button"
              class="smp-choice muted"
              @click="
                paymentMethod = '';
                closePopover();
              "
            >
              清除
            </button>
          </div>
          <input
            v-model="paymentMethod"
            type="text"
            class="smp-custom-input"
            placeholder="或自定义渠道，回车确认"
            @keydown.enter.prevent="closePopover"
          />
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sub-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: var(--ws-scrim-bg);
  backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 18px;
}

.sub-modal-backdrop.phone {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

.sub-modal-card {
  width: 100%;
  max-width: 512px;
  max-height: min(92dvh, 720px);
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  border-radius: 24px;
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
  transition: transform 220ms var(--ws-ease-out);
}

.sub-modal-card.phone.dragging {
  transition: none;
}

.sm-grab-zone {
  padding: 8px 0 2px;
  display: flex;
  justify-content: center;
  flex: none;
  touch-action: none;
}

.sm-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong);
  flex: none;
}

.sm-head {
  flex: none;
  padding: 14px 18px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sm-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16.5px;
  font-weight: 760;
  letter-spacing: -0.02em;
  color: var(--ws-ink);
}

/* Single-Screen Zero-Scroll Body */
.sm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: 2px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sm-body > * {
  flex: none;
}

.sm-preview-fushi {
  flex: none;
}

.sm-emblem-trigger {
  position: relative;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  border-radius: 15px;
  transition: transform 160ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

.sm-emblem-trigger:hover {
  transform: scale(1.04);
}

.sm-emblem-trigger:active {
  transform: scale(0.95);
}

.sm-pv-emblem-wrap {
  display: inline-flex;
}

.sm-emblem-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  display: inline-grid;
  place-items: center;
}

.sm-pv-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.sm-pv-copy {
  flex: 1;
  min-width: 0;
}

.sm-pv-name {
  font-size: 16.5px;
  font-weight: 820;
  letter-spacing: -0.02em;
  color: var(--fc-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-pv-meta {
  margin-top: 3px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 12px;
  font-weight: 620;
  color: var(--fc-sub);
}

.sm-pv-tag {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 740;
  background: color-mix(in srgb, var(--fc-ink) 12%, transparent);
  color: var(--fc-ink);
}

.sm-pv-cny {
  text-align: right;
  flex: none;
  padding-left: 6px;
}

.sm-pv-cny strong {
  display: block;
  font-size: 21px;
  font-weight: 880;
  letter-spacing: -0.025em;
  color: var(--fc-ink);
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
}

.sm-pv-cny span {
  font-size: 10.5px;
  font-weight: 620;
  color: var(--fc-sub);
}

/* Single Subtle Color Swatch Trigger beside Fushi Progress Bar */
.sm-color-trigger {
  width: 22px;
  height: 22px;
  padding: 2px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--fc-ink) 26%, #ffffff);
  background: rgba(255, 255, 255, 0.72);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  transition: transform 150ms ease, box-shadow 150ms ease;
}

.sm-color-trigger:hover,
.sm-color-trigger.active {
  transform: scale(1.12);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--fc-fill) 45%, transparent);
}

.sm-color-dot {
  width: 100%;
  height: 100%;
  border-radius: 999px;
}

/* Name Input + Contextual Presets / Shorthand */
.sm-name-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.sm-input {
  width: 100%;
  height: 40px;
  padding: 0 13px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 620;
  outline: none;
  box-sizing: border-box;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.sm-input:focus {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.sm-shorthand-chip {
  align-self: flex-start;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, #e85d2a 28%, transparent);
  background: color-mix(in srgb, #e85d2a 10%, var(--ws-card-bg));
  color: #e85d2a;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 680;
  cursor: pointer;
}

.sm-presets {
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
  height: 27px;
  padding: 0 9px 0 4px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 580;
  cursor: pointer;
  transition: background-color 140ms ease, transform 120ms ease;
}

.sm-preset-chip:hover {
  background: var(--ws-pill-hover);
}

.sm-preset-chip:active {
  transform: scale(0.96);
}

/* Core Finance Strip (Price+Currency | Cycle | Date) */
.sm-finance-row {
  display: grid;
  grid-template-columns: minmax(112px, 1.05fr) auto minmax(118px, 1fr);
  gap: 8px;
  align-items: center;
}

.sm-price-combo {
  height: 38px;
  border-radius: 11px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  align-items: center;
  overflow: hidden;
  transition: border-color 140ms ease, background-color 140ms ease;
}

.sm-price-combo:focus-within {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.sm-cur-select {
  height: 100%;
  width: 50px;
  padding: 0 4px 0 9px;
  border: 0;
  border-right: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 760;
  outline: none;
  cursor: pointer;
  flex: none;
}

.sm-price-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 9px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
  outline: none;
}

.sm-cycle-seg {
  height: 38px;
  padding: 3px;
  border-radius: 11px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.sm-cycle-btn {
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 660;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.sm-cycle-btn.active {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sm-date-chip {
  height: 38px;
  padding: 0 9px 0 11px;
  border-radius: 11px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  align-items: center;
  min-width: 0;
  transition: border-color 140ms ease;
}

.sm-date-chip:focus-within {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.sm-date-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 640;
  outline: none;
}

/* Semantic Attribute Capsules Row */
.sm-attr-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.sm-attr-pill {
  height: 30px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 620;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.sm-attr-pill:hover,
.sm-attr-pill.open {
  background: var(--ws-pill-hover);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.sm-attr-pill.lit {
  border-color: color-mix(in srgb, var(--ws-ink) 24%, transparent);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
}

.sm-attr-pill.trial {
  border-color: color-mix(in srgb, #e85d2a 34%, transparent);
  background: color-mix(in srgb, #e85d2a 10%, var(--ws-card-bg));
  color: #e85d2a;
}

.sm-attr-pill.promo {
  border-color: color-mix(in srgb, #0e9f6e 36%, transparent);
  background: color-mix(in srgb, #0e9f6e 10%, var(--ws-card-bg));
  color: #0e8a62;
}

.sm-cat-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
}

.sm-pill-caret {
  opacity: 0.55;
}

/* Compact Side-by-Side Toggle Strip */
.sm-toggle-strip {
  height: 42px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.sm-toggle-cell {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.sm-toggle-cell:hover {
  background: var(--ws-pill-hover);
}

.sm-tc-label {
  font-size: 12.5px;
  font-weight: 640;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-toggle-sep {
  width: 1px;
  background: var(--ws-hairline);
  margin: 8px 0;
  flex: none;
}

.sm-switch {
  flex: none;
  pointer-events: none;
}

.sm-hidden-file {
  display: none;
}

/* Footer */
.sm-foot {
  flex: none;
  padding: 11px 18px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
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
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 680;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: background-color 140ms ease, transform 120ms ease, opacity 140ms ease;
}

.sm-btn:active {
  transform: scale(0.96);
}

.sm-btn.primary {
  border-color: transparent;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.sm-btn.primary:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.sm-btn.danger {
  border-color: rgba(232, 76, 61, 0.24);
  background: rgba(232, 76, 61, 0.1);
  color: #d93e30;
}

.tabular {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 560px) {
  .sm-body {
    padding: 2px 15px 12px;
    gap: 10px;
  }

  .sm-finance-row {
    grid-template-columns: 1fr auto;
  }

  .sm-date-chip {
    grid-column: 1 / -1;
  }

  .sm-toggle-cell {
    padding: 0 10px;
  }
}
</style>

<style>
/* Teleported Floating Popovers (unscoped because rendered into document.body) */
.sm-popover {
  --pop-tint: #10a37f;
  position: fixed;
  z-index: 160;
  padding: 11px;
  border-radius: 16px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  box-shadow:
    0 18px 42px -8px rgba(15, 18, 28, 0.24),
    0 2px 8px rgba(15, 18, 28, 0.08);
  color: var(--ws-ink);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.sm-pop-enter-active,
.sm-pop-leave-active {
  transition:
    opacity 150ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: top center;
}

.sm-pop-enter-from,
.sm-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

.smp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.smp-title {
  font-size: 12px;
  font-weight: 720;
  color: var(--ws-ink-secondary);
}

.smp-clear-link {
  border: 0;
  background: transparent;
  color: #e85d2a;
  font: inherit;
  font-size: 11.5px;
  font-weight: 660;
  cursor: pointer;
}

.smp-count-pill {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink-secondary);
  font-size: 10.5px;
  font-weight: 680;
}

.smp-follow-btn {
  height: 24px;
  padding: 0 8px 0 6px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11px;
  font-weight: 640;
  cursor: pointer;
}

.smp-follow-btn.active {
  border-color: var(--ws-ink);
  color: var(--ws-ink);
}

.smp-follow-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.smp-swatch-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  justify-items: center;
  padding: 2px 0;
}

.smp-swatch {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 130ms ease, box-shadow 130ms ease;
}

.smp-swatch:hover {
  transform: scale(1.12);
}

.smp-swatch.active {
  box-shadow: 0 0 0 2px var(--ws-card-bg), 0 0 0 4px var(--ws-ink);
}

.smp-hex-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--ws-hairline);
}

.smp-wheel-btn {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 1px solid var(--ws-hairline-strong);
  padding: 3px;
  background: conic-gradient(#ff3b30, #ff9500, #ffcc00, #34c759, #007aff, #af52de, #ff3b30);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
  overflow: hidden;
}

.smp-wheel-fill {
  width: 100%;
  height: 100%;
  border-radius: 7px;
  border: 1.5px solid #ffffff;
}

.smp-native-color {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.smp-hex-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  font-weight: 700;
  text-transform: uppercase;
  outline: none;
}

.smp-hex-input:focus {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.smp-hex-input.invalid {
  border-color: #d93e30;
}

/* Icon Popover with Refined Tonal Active Selection + Corner Check Badge */
.smp-icon-bar {
  display: flex;
  align-items: center;
  gap: 5px;
}

.smp-search {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 4px 0 9px;
  border-radius: 9px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  align-items: center;
  gap: 5px;
}

.smp-search:focus-within {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.smp-s-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.smp-s-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.smp-s-go {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
  font: inherit;
  font-size: 11px;
  font-weight: 680;
  cursor: pointer;
}

.smp-mini-btn {
  height: 30px;
  padding: 0 8px;
  border-radius: 9px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 620;
  cursor: pointer;
  flex: none;
}

.smp-mini-btn.muted {
  color: var(--ws-ink-secondary);
}

.smp-icon-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
  max-height: 192px;
  overflow-y: auto;
  padding: 2px;
}

.sm-popover .sm-ic-tile {
  position: relative;
  padding: 7px 4px 6px;
  border-radius: 13px;
  border: 1.5px solid transparent;
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 180ms ease,
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sm-popover .sm-ic-tile:hover {
  background: color-mix(in srgb, var(--pop-tint) 7%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--pop-tint) 26%, transparent);
  transform: translateY(-1px);
}

.sm-popover .sm-ic-tile:active {
  transform: scale(0.95);
}

.sm-popover .sm-ic-tile.active {
  background: color-mix(in srgb, var(--pop-tint) 12%, var(--ws-card-bg));
  border-color: color-mix(in srgb, var(--pop-tint) 58%, transparent);
  box-shadow: 0 6px 14px -6px color-mix(in srgb, var(--pop-tint) 42%, transparent);
}

.sm-popover .sm-ic-tile.active .sm-ic-name {
  color: var(--ws-ink);
  font-weight: 720;
}

.sm-popover .sm-ic-check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  background: var(--pop-tint);
  color: #ffffff;
  display: inline-grid;
  place-items: center;
  box-shadow: 0 2px 5px color-mix(in srgb, var(--pop-tint) 45%, transparent);
}

.sm-popover .sm-ic-tile.loading {
  opacity: 0.6;
}

.sm-popover .sm-ic-remote {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--ws-card-bg);
  overflow: hidden;
  display: inline-grid;
  place-items: center;
}

.sm-popover .sm-ic-remote img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sm-popover .sm-ic-remote.mono img {
  width: 64%;
  height: 64%;
  object-fit: contain;
  filter: brightness(0) invert(1);
}

.sm-popover .sm-ic-name {
  width: 100%;
  font-size: 10px;
  font-weight: 600;
  color: var(--ws-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.smp-skeleton {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
}

.smp-skeleton span {
  flex: 1;
  height: 54px;
  border-radius: 10px;
  background: var(--ws-stone-pill);
  opacity: 0.6;
}

.smp-err {
  font-size: 11px;
  color: #d93e30;
}

/* List / Status / Promo / Accounts Popovers */
.smp-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.smp-opt {
  min-height: 32px;
  padding: 5px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ws-ink);
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 620;
  cursor: pointer;
  text-align: left;
}

.smp-opt.status-opt {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.smp-st-hint {
  font-size: 10.5px;
  font-weight: 500;
  opacity: 0.68;
}

.smp-opt:hover {
  background: var(--ws-pill-hover);
}

.smp-opt.active {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.smp-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.smp-mini-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.smp-mini-field span,
.smp-sub-lbl {
  font-size: 11px;
  font-weight: 640;
  color: var(--ws-ink-secondary);
}

.smp-num-input {
  width: 100%;
  height: 32px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 740;
  outline: none;
  box-sizing: border-box;
}

.smp-num-input:focus {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.smp-promo-extra {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.smp-chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.smp-choice {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 620;
  cursor: pointer;
}

.smp-choice.sm {
  height: 25px;
  padding: 0 8px;
  font-size: 11px;
}

.smp-choice.active {
  border-color: transparent;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.smp-choice.muted {
  color: var(--ws-ink-secondary);
}

/* Sub-Accounts Popover List & Inline Adder */
.smp-acc-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 120px;
  overflow-y: auto;
}

.smp-acc-item {
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
  display: flex;
  align-items: center;
  gap: 7px;
}

.smp-acc-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.smp-acc-info strong {
  font-size: 12px;
  font-weight: 720;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.smp-acc-info span {
  font-size: 10.5px;
  color: var(--ws-ink-secondary);
}

.smp-acc-st {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
  font: inherit;
  font-size: 10.5px;
  font-weight: 680;
  cursor: pointer;
  flex: none;
}

.smp-acc-st.ending {
  background: color-mix(in srgb, #e85d2a 14%, transparent);
  color: #e85d2a;
}

.smp-acc-del {
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

.smp-acc-del:hover {
  background: rgba(232, 76, 61, 0.12);
  color: #d93e30;
}

.smp-acc-add {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--ws-hairline);
}

.smp-acc-add-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.smp-custom-input {
  width: 100%;
  height: 31px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.smp-custom-input.num {
  width: 72px;
  flex: none;
}

.smp-custom-input:focus {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.smp-add-go {
  height: 31px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
  font: inherit;
  font-size: 11.5px;
  font-weight: 680;
  cursor: pointer;
  flex: none;
}

.smp-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px;
  border-radius: 10px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline);
}

.smp-step-btn {
  width: 28px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.smp-step-btn:disabled {
  opacity: 0.35;
}

.smp-step-val {
  font-size: 12px;
  font-weight: 700;
}
</style>
