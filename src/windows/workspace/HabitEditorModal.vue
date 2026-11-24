<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon } from '@/fluent';
import type { HabitKind, HabitMeta, HabitTimeOfDay, ISODate, Task } from '@/types';
import {
  getHabitIcon,
  guessHabitIcon,
  HABIT_COLOR_SWATCHES,
  HABIT_ICONS,
  HABIT_KIND_META,
  HABIT_PRESETS,
  HABIT_TIME_META,
  HABIT_TIME_ORDER,
  type HabitPreset,
} from '@/lib/habits';
import { normalizeHexColor } from '@/lib/subscriptions';
import { addTask, deleteTask, saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { useViewport } from '@/composables/useViewport';
import { notify } from '../desk/state';
import FushiTonalCard from './FushiTonalCard.vue';
import HabitEmblem from './HabitEmblem.vue';

type PopKind = 'icon' | 'color' | 'freq' | 'time' | null;

const props = defineProps<{
  open: boolean;
  editingTask?: (Task & { habit: HabitMeta }) | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [taskId?: string];
}>();

const { isPhone } = useViewport();
const titleInputRef = ref<HTMLInputElement>();

const title = ref('');
const kind = ref<HabitKind>('check');
const targetStr = ref('8');
const stepStr = ref('1');
const unit = ref('杯');
const weeklyTarget = ref(7);
const timeOfDay = ref<HabitTimeOfDay>('anytime');
const iconKey = ref('water');
const color = ref<string>('#0EA5E9');
const iconAutoColor = ref<string>('#0EA5E9');
const iconLocked = ref(false);
const colorLocked = ref(false);
const startDate = ref<ISODate>(now.value);
const saving = ref(false);

const hexInput = ref<string>('#0EA5E9');
const hexInvalid = ref(false);

// Floating Popover (teleported to body, zero modal clipping, zero scroll)
const activePop = ref<PopKind>(null);
const popStyle = ref<Record<string, string>>({});
const popRef = ref<HTMLElement>();

const parsedTarget = computed(() => {
  const n = Number.parseFloat(targetStr.value);
  return Number.isFinite(n) && n > 0 ? n : 1;
});

const parsedStep = computed(() => {
  const n = Number.parseFloat(stepStr.value);
  return Number.isFinite(n) && n > 0 ? n : 1;
});

const previewSubtitle = computed(() => {
  const freq = weeklyTarget.value >= 7 ? '每天' : `每周 ${weeklyTarget.value} 天`;
  if (kind.value === 'count') {
    const u = unit.value.trim();
    return `${freq} · 目标 ${parsedTarget.value}${u ? ` ${u}` : ''}`;
  }
  if (kind.value === 'quit') {
    return `${HABIT_KIND_META.quit.label} · 正向累计天数`;
  }
  return `${freq} · ${HABIT_TIME_META[timeOfDay.value].label}`;
});

function openPop(k: Exclude<PopKind, null>, event: MouseEvent) {
  if (activePop.value === k) {
    activePop.value = null;
    return;
  }
  const el = event.currentTarget as HTMLElement | null;
  activePop.value = k;
  if (k === 'color') {
    hexInput.value = color.value.toUpperCase();
    hexInvalid.value = false;
  }
  if (!el) return;
  const r = el.getBoundingClientRect();
  const estW = k === 'icon' ? 304 : k === 'color' ? 276 : k === 'freq' ? 234 : 180;
  const estH = k === 'icon' ? 250 : k === 'color' ? 216 : 186;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 12;

  let left = k === 'color' ? r.right - estW : r.left;
  left = Math.max(margin, Math.min(vw - estW - margin, left));

  let top = r.bottom + 8;
  if (top + estH > vh - margin && r.top - estH - 8 >= margin) {
    top = r.top - estH - 8;
  } else {
    top = Math.min(vh - estH - margin, top);
  }

  popStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(Math.max(margin, top))}px`,
    width: `${Math.min(estW, vw - margin * 2)}px`,
  };
}

function closePop() {
  activePop.value = null;
}

function onGlobalDown(e: MouseEvent) {
  if (!activePop.value) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (popRef.value?.contains(target)) return;
  if (target.closest('[data-hpop-trigger]')) return;
  activePop.value = null;
}

function onGlobalKey(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    if (activePop.value) {
      e.stopPropagation();
      activePop.value = null;
    } else {
      emit('close');
    }
  }
}

onMounted(() => {
  window.addEventListener('mousedown', onGlobalDown, true);
  window.addEventListener('keydown', onGlobalKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onGlobalDown, true);
  window.removeEventListener('keydown', onGlobalKey);
});

function pickIcon(key: string) {
  const spec = getHabitIcon(key);
  iconKey.value = spec.key;
  iconAutoColor.value = spec.defaultColor;
  iconLocked.value = true;
  // Default follows icon's signature color cleanly
  color.value = spec.defaultColor;
  hexInput.value = spec.defaultColor.toUpperCase();
  colorLocked.value = false;
  closePop();
}

function selectColor(hex: string) {
  const norm = normalizeHexColor(hex) ?? hex;
  color.value = norm;
  hexInput.value = norm;
  hexInvalid.value = false;
  colorLocked.value = true;
}

function onHexInput(raw: string) {
  hexInput.value = raw;
  const norm = normalizeHexColor(raw);
  if (norm) {
    color.value = norm;
    colorLocked.value = true;
    hexInvalid.value = false;
  } else {
    hexInvalid.value = raw.trim().length > 0;
  }
}

function onNativeColor(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  if (val) selectColor(val);
}

function resetColorToIcon() {
  color.value = iconAutoColor.value;
  hexInput.value = iconAutoColor.value.toUpperCase();
  hexInvalid.value = false;
  colorLocked.value = false;
}

function applyPreset(p: HabitPreset) {
  title.value = p.title;
  kind.value = p.kind;
  targetStr.value = String(p.target);
  stepStr.value = String(p.step ?? 1);
  unit.value = p.unit ?? '次';
  weeklyTarget.value = p.weeklyTarget;
  timeOfDay.value = p.timeOfDay;
  iconKey.value = p.iconKey;
  color.value = p.color;
  iconAutoColor.value = p.color;
  hexInput.value = p.color.toUpperCase();
  iconLocked.value = true;
  colorLocked.value = false;
}

// Magic auto-icon & color morphing as the user types a new habit title
watch(title, (raw) => {
  if (!props.open || props.editingTask || iconLocked.value) return;
  const spec = guessHabitIcon(raw);
  if (!spec) return;
  iconKey.value = spec.key;
  iconAutoColor.value = spec.defaultColor;
  if (!colorLocked.value) {
    color.value = spec.defaultColor;
    hexInput.value = spec.defaultColor.toUpperCase();
  }
});

// 1:1 Swipe-down grabber on phone
const dragY = ref(0);
const dragging = ref(false);
let startY = 0;

function onGrabStart(e: TouchEvent) {
  if (!isPhone.value || e.touches.length !== 1) return;
  startY = e.touches[0].clientY;
  dragging.value = true;
}

function onGrabMove(e: TouchEvent) {
  if (!dragging.value || e.touches.length !== 1) return;
  const dy = e.touches[0].clientY - startY;
  if (dy > 0) {
    e.preventDefault();
    dragY.value = dy;
  }
}

function onGrabEnd() {
  if (!dragging.value) return;
  const shouldClose = dragY.value > 76;
  dragging.value = false;
  dragY.value = 0;
  if (shouldClose) emit('close');
}

watch(
  () => [props.open, props.editingTask] as const,
  async ([isOpen, task]) => {
    activePop.value = null;
    hexInvalid.value = false;
    if (!isOpen) return;
    if (task) {
      const m = task.habit;
      const spec = getHabitIcon(m.iconKey);
      title.value = task.title;
      kind.value = m.kind;
      targetStr.value = String(m.target || 1);
      stepStr.value = String(m.step ?? 1);
      unit.value = m.unit ?? '次';
      weeklyTarget.value = m.weeklyTarget || 7;
      timeOfDay.value = m.timeOfDay || 'anytime';
      iconKey.value = spec.key;
      color.value = m.color || spec.defaultColor;
      iconAutoColor.value = spec.defaultColor;
      hexInput.value = (m.color || spec.defaultColor).toUpperCase();
      iconLocked.value = true;
      colorLocked.value = true;
      startDate.value = task.start;
    } else {
      title.value = '';
      kind.value = 'check';
      targetStr.value = '8';
      stepStr.value = '1';
      unit.value = '杯';
      weeklyTarget.value = 7;
      timeOfDay.value = 'anytime';
      iconKey.value = 'meditate';
      color.value = '#10A37F';
      iconAutoColor.value = '#10A37F';
      hexInput.value = '#10A37F';
      iconLocked.value = false;
      colorLocked.value = false;
      startDate.value = now.value;
    }
    await nextTick();
    titleInputRef.value?.focus();
  },
);

async function onSubmit() {
  const cleanTitle = title.value.trim();
  if (!cleanTitle || saving.value) return;
  saving.value = true;
  try {
    const existingLogs = props.editingTask?.habit.logs ?? {};
    const meta: HabitMeta = {
      kind: kind.value,
      target: kind.value === 'count' ? parsedTarget.value : 1,
      step: kind.value === 'count' ? parsedStep.value : undefined,
      unit: kind.value === 'count' ? unit.value.trim() || '次' : undefined,
      weeklyTarget: kind.value === 'quit' ? 7 : weeklyTarget.value,
      timeOfDay: timeOfDay.value,
      iconKey: iconKey.value,
      color: color.value,
      archived: props.editingTask?.habit.archived,
      logs: existingLogs,
    };

    if (props.editingTask) {
      await saveTask({
        ...props.editingTask,
        title: cleanTitle,
        start: startDate.value || props.editingTask.start,
        end: startDate.value || props.editingTask.start,
        habitOnly: true,
        habit: meta,
      });
      emit('saved', props.editingTask.id);
    } else {
      const created = await addTask({
        title: cleanTitle,
        start: startDate.value || now.value,
        end: startDate.value || now.value,
        habitOnly: true,
        habit: meta,
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
    const label = props.editingTask.title;
    await deleteTask(props.editingTask.id);
    notify(`已删除「${label}」`, true);
    emit('saved');
    emit('close');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Transition name="ws-modal">
    <div
      v-if="open"
      class="hm-backdrop"
      :class="{ phone: isPhone }"
      role="dialog"
      aria-modal="true"
      aria-label="编辑每日习惯"
      @mousedown.self="emit('close')"
    >
      <div
        class="hm-card ws-modal-card"
        :class="{ phone: isPhone, dragging }"
        :style="isPhone && dragY > 0 ? { transform: `translate3d(0, ${dragY.toFixed(1)}px, 0)` } : undefined"
      >
        <div
          v-if="isPhone"
          class="hm-grab-zone"
          aria-hidden="true"
          @touchstart="onGrabStart"
          @touchmove="onGrabMove"
          @touchend="onGrabEnd"
          @touchcancel="onGrabEnd"
        >
          <div class="hm-grab" />
        </div>

        <header
          class="hm-head"
          @touchstart="onGrabStart"
          @touchmove="onGrabMove"
          @touchend="onGrabEnd"
          @touchcancel="onGrabEnd"
        >
          <h2 class="hm-title">{{ editingTask ? '编辑习惯' : '新建习惯' }}</h2>
          <button type="button" class="ws-icon-circle" title="关闭" aria-label="关闭" @click="emit('close')">
            <FIcon name="close" :size="13" />
          </button>
        </header>

        <form
          id="habit-editor-form"
          class="hm-body"
          @submit.prevent="onSubmit"
          @keydown.ctrl.enter.prevent="onSubmit"
          @keydown.meta.enter.prevent="onSubmit"
        >
          <!-- Interactive Fushi Live Preview Card (Click Icon -> Icon Popover, Click Color Dot -> Color/#Hex Popover) -->
          <FushiTonalCard
            variant="preview"
            class="hm-preview-fushi"
            :tint="color"
            :watermark="title.trim() || '每日习惯'"
            :progress="kind === 'quit' ? 100 : 62"
          >
            <template #emblem>
              <button
                type="button"
                class="hm-emblem-trigger"
                data-hpop-trigger="icon"
                title="点击更换习惯图标"
                aria-label="更换习惯图标"
                @click="openPop('icon', $event)"
              >
                <HabitEmblem :icon-key="iconKey" :color="color" :size="50" :radius="14" />
                <span class="hm-emblem-badge" aria-hidden="true">
                  <FIcon name="edit" :size="10" />
                </span>
              </button>
            </template>

            <div class="hm-pv-row">
              <div class="hm-pv-copy">
                <div class="hm-pv-name">{{ title.trim() || '未命名习惯' }}</div>
                <div class="hm-pv-sub">{{ previewSubtitle }}</div>
              </div>
              <span class="hm-pv-kind-pill">{{ HABIT_KIND_META[kind].short }}</span>
            </div>

            <template #progressEnd>
              <button
                type="button"
                class="hm-color-trigger"
                :class="{ active: activePop === 'color' }"
                data-hpop-trigger="color"
                title="更换卡片主题色 / 输入 #Hex"
                aria-label="更换习惯主题色"
                @click="openPop('color', $event)"
              >
                <span class="hm-color-dot" :style="{ background: color }" />
              </button>
            </template>
          </FushiTonalCard>

          <!-- Name Input + Contextual Empty 1-Tap Presets -->
          <div class="hm-name-group">
            <input
              ref="titleInputRef"
              v-model="title"
              type="text"
              class="hm-input"
              placeholder="输入习惯名称，如喝水 8 杯、阅读 30 分钟、早睡不熬夜"
              required
            />

            <div v-if="!editingTask && !title.trim()" class="hm-presets">
              <button
                v-for="p in HABIT_PRESETS"
                :key="p.key"
                type="button"
                class="hm-preset-chip"
                @click="applyPreset(p)"
              >
                <HabitEmblem :icon-key="p.iconKey" :color="p.color" :size="18" :radius="5" />
                <span>{{ p.title }}</span>
              </button>
            </div>
          </div>

          <!-- Habit Kind 3-Segment Selector (Check | Count | Quit) -->
          <div class="hm-kind-seg" role="radiogroup" aria-label="习惯类型">
            <button
              v-for="k in (['check', 'count', 'quit'] as const)"
              :key="k"
              type="button"
              class="hm-kind-btn"
              :class="{ active: kind === k }"
              @click="kind = k"
            >
              {{ HABIT_KIND_META[k].label }}
            </button>
          </div>

          <!-- Quantitative Target Strip (Only when kind === 'count', compact 1 row!) -->
          <div v-if="kind === 'count'" class="hm-count-row">
            <label class="hm-mini-box">
              <span>每日目标</span>
              <input v-model="targetStr" type="number" min="1" step="any" class="hm-mini-in tabular" required />
            </label>
            <label class="hm-mini-box">
              <span>每次步进</span>
              <input v-model="stepStr" type="number" min="1" step="any" class="hm-mini-in tabular" required />
            </label>
            <label class="hm-mini-box">
              <span>单位</span>
              <input v-model="unit" type="text" maxlength="6" class="hm-mini-in" placeholder="杯/分钟" />
            </label>
          </div>

          <!-- Lightweight Semantic Attribute Capsules -->
          <div class="hm-attr-strip">
            <button
              v-if="kind !== 'quit'"
              type="button"
              class="hm-attr-pill"
              :class="{ open: activePop === 'freq', lit: weeklyTarget < 7 }"
              data-hpop-trigger="freq"
              @click="openPop('freq', $event)"
            >
              <FIcon name="repeat" :size="11" />
              <span>{{ weeklyTarget >= 7 ? '每天' : `每周 ${weeklyTarget} 天` }}</span>
              <FIcon name="chevronDown" :size="10" class="hm-caret" />
            </button>

            <button
              type="button"
              class="hm-attr-pill"
              :class="{ open: activePop === 'time', lit: timeOfDay !== 'anytime' }"
              data-hpop-trigger="time"
              @click="openPop('time', $event)"
            >
              <FIcon name="sun" :size="11" />
              <span>{{ HABIT_TIME_META[timeOfDay].label }}</span>
              <FIcon name="chevronDown" :size="10" class="hm-caret" />
            </button>

            <label class="hm-date-pill" title="开始日期">
              <span>始于</span>
              <input v-model="startDate" type="date" class="hm-date-in tabular" aria-label="习惯开始日期" required />
            </label>
          </div>
        </form>

        <footer class="hm-foot">
          <button
            v-if="editingTask"
            type="button"
            class="hm-btn danger"
            :disabled="saving"
            @click="onDelete"
          >
            <FIcon name="delete" :size="13" />
            <span>删除</span>
          </button>
          <div class="hm-foot-right">
            <button type="button" class="hm-btn ghost" @click="emit('close')">取消</button>
            <button
              type="submit"
              form="habit-editor-form"
              class="hm-btn primary"
              :disabled="!title.trim() || saving"
            >
              {{ editingTask ? '保存修改' : '创建习惯' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Transition>

  <!-- Teleported Floating Popovers -->
  <Teleport to="body">
    <Transition name="sm-pop">
      <div
        v-if="open && activePop"
        ref="popRef"
        class="sm-popover hm-popover"
        :class="`hm-pop-${activePop}`"
        :style="[popStyle, { '--pop-tint': color }]"
        @mousedown.stop
      >
        <!-- ICON PICKER POPOVER (Refined Tonal Active State + Checkmark Badge!) -->
        <template v-if="activePop === 'icon'">
          <div class="smp-head">
            <span class="smp-title">选择习惯图标</span>
          </div>
          <div class="hmp-icon-grid">
            <button
              v-for="ic in HABIT_ICONS"
              :key="ic.key"
              type="button"
              class="sm-ic-tile"
              :class="{ active: iconKey === ic.key }"
              @click="pickIcon(ic.key)"
            >
              <span v-if="iconKey === ic.key" class="sm-ic-check" aria-hidden="true">
                <FIcon name="check" :size="9" />
              </span>
              <HabitEmblem :icon-key="ic.key" :color="ic.defaultColor" :size="32" :radius="10" />
              <span class="sm-ic-name">{{ ic.label }}</span>
            </button>
          </div>
        </template>

        <!-- COLOR & CUSTOM #HEX POPOVER -->
        <template v-else-if="activePop === 'color'">
          <div class="smp-head">
            <span class="smp-title">习惯主题色</span>
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
              v-for="hex in HABIT_COLOR_SWATCHES"
              :key="hex"
              type="button"
              class="smp-swatch"
              :class="{ active: color.toUpperCase() === hex.toUpperCase() }"
              :style="{ background: hex }"
              :aria-label="`主题色 ${hex}`"
              @click="selectColor(hex)"
            />
          </div>

          <div class="smp-hex-row">
            <label class="smp-wheel-btn" title="调色器自选颜色">
              <span class="smp-wheel-fill" :style="{ background: color }" />
              <input
                type="color"
                class="smp-native-color"
                :value="normalizeHexColor(color) ?? '#10A37F'"
                aria-label="自定义取色器"
                @input="onNativeColor"
              />
            </label>
            <input
              :value="hexInput"
              type="text"
              class="smp-hex-input tabular"
              :class="{ invalid: hexInvalid }"
              placeholder="#0EA5E9"
              maxlength="9"
              spellcheck="false"
              aria-label="自定义 Hex 色值"
              @input="onHexInput(($event.target as HTMLInputElement).value)"
            />
          </div>
        </template>

        <!-- ELASTIC WEEKLY FREQUENCY POPOVER -->
        <template v-else-if="activePop === 'freq'">
          <div class="smp-head">
            <span class="smp-title">每周弹性目标天数</span>
          </div>
          <div class="smp-chip-grid">
            <button
              v-for="d in [7, 6, 5, 4, 3, 2, 1]"
              :key="d"
              type="button"
              class="smp-choice"
              :class="{ active: weeklyTarget === d }"
              @click="
                weeklyTarget = d;
                closePop();
              "
            >
              {{ d === 7 ? '每天' : `每周 ${d} 天` }}
            </button>
          </div>
        </template>

        <!-- TIME OF DAY POPOVER -->
        <template v-else-if="activePop === 'time'">
          <div class="smp-list">
            <button
              v-for="t in HABIT_TIME_ORDER"
              :key="t"
              type="button"
              class="smp-opt"
              :class="{ active: timeOfDay === t }"
              @click="
                timeOfDay = t;
                closePop();
              "
            >
              <span>{{ HABIT_TIME_META[t].label }}</span>
            </button>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.hm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: var(--ws-scrim-bg);
  backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 18px;
}

.hm-backdrop.phone {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

.hm-card {
  width: 100%;
  max-width: 486px;
  max-height: min(92dvh, 680px);
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  border-radius: 24px;
  box-shadow: var(--ws-shadow-float);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.hm-card.phone {
  max-width: 100%;
  max-height: 92dvh;
  border-radius: 24px 24px 0 0;
  border-bottom: 0;
  transition: transform 220ms var(--ws-ease-out);
}

.hm-card.phone.dragging {
  transition: none;
}

.hm-grab-zone {
  padding: 8px 0 2px;
  display: flex;
  justify-content: center;
  flex: none;
  touch-action: none;
}

.hm-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong);
}

.hm-head {
  flex: none;
  padding: 14px 18px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hm-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16.5px;
  font-weight: 760;
  letter-spacing: -0.02em;
  color: var(--ws-ink);
}

.hm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hm-body > * {
  flex: none;
}

.hm-emblem-trigger {
  position: relative;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  border-radius: 15px;
  transition: transform 160ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

.hm-emblem-trigger:hover {
  transform: scale(1.04);
}

.hm-emblem-badge {
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

.hm-pv-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}

.hm-pv-copy {
  flex: 1;
  min-width: 0;
}

.hm-pv-name {
  font-size: 16.5px;
  font-weight: 820;
  color: var(--fc-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hm-pv-sub {
  margin-top: 3px;
  font-size: 12px;
  font-weight: 620;
  color: var(--fc-sub);
}

.hm-pv-kind-pill {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-ink) 12%, transparent);
  color: var(--fc-ink);
  font-size: 11px;
  font-weight: 740;
}

.hm-color-trigger {
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
  transition: transform 150ms ease;
}

.hm-color-trigger:hover,
.hm-color-trigger.active {
  transform: scale(1.12);
}

.hm-color-dot {
  width: 100%;
  height: 100%;
  border-radius: 999px;
}

.hm-name-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.hm-input {
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
}

.hm-input:focus {
  border-color: var(--ws-ink);
  background: var(--ws-card-bg);
}

.hm-presets {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.hm-presets::-webkit-scrollbar {
  display: none;
}

.hm-preset-chip {
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
}

.hm-preset-chip:hover {
  background: var(--ws-pill-hover);
}

.hm-kind-seg {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
}

.hm-kind-btn {
  height: 32px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 660;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.hm-kind-btn.active {
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.hm-count-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.hm-mini-box {
  padding: 6px 10px;
  border-radius: 11px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hm-mini-box span {
  font-size: 10.5px;
  font-weight: 640;
  color: var(--ws-ink-muted);
}

.hm-mini-in {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 760;
  outline: none;
}

.hm-attr-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.hm-attr-pill {
  height: 31px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 620;
  cursor: pointer;
}

.hm-attr-pill:hover,
.hm-attr-pill.open,
.hm-attr-pill.lit {
  background: var(--ws-card-bg);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.hm-caret {
  opacity: 0.55;
}

.hm-date-pill {
  height: 31px;
  padding: 0 8px 0 10px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-subtle);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--ws-ink-muted);
}

.hm-date-in {
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 640;
  outline: none;
}

.hm-foot {
  flex: none;
  padding: 11px 18px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--ws-hairline);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.hm-foot-right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.hm-btn {
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
}

.hm-btn.primary {
  border-color: transparent;
  background: var(--ws-ink);
  color: var(--ws-ink-inverse);
}

.hm-btn.primary:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.hm-btn.danger {
  border-color: rgba(232, 76, 61, 0.24);
  background: rgba(232, 76, 61, 0.1);
  color: #d93e30;
}

.tabular {
  font-variant-numeric: tabular-nums;
}
</style>

<style>
.hmp-icon-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  max-height: 204px;
  overflow-y: auto;
  padding: 2px;
}
</style>
