<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon } from '@/fluent';
import type { HabitWidgetStyle } from '@/types';
import { getHabitWidgetStyleSpec, HABIT_WIDGET_STYLES } from '@/lib/habits';
import HabitWidgetStyleGlyph from './HabitWidgetStyleGlyph.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchorRect: DOMRect | null;
    cardRect?: DOMRect | null;
    currentStyle: HabitWidgetStyle;
    recommendedStyle: HabitWidgetStyle;
    tint: string;
    habitTitle: string;
    isPhone?: boolean;
  }>(),
  {
    cardRect: null,
    isPhone: false,
  },
);

const emit = defineEmits<{
  preview: [style: HabitWidgetStyle | null];
  select: [style: HabitWidgetStyle];
  close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const focusedIndex = ref(0);
const hoveringStyle = ref<HabitWidgetStyle | null>(null);

const activeIndex = computed(() =>
  Math.max(0, HABIT_WIDGET_STYLES.findIndex((s) => s.key === props.currentStyle)),
);

const activePreviewStyle = computed<HabitWidgetStyle>(
  () => hoveringStyle.value ?? props.currentStyle,
);

const activePreviewSpec = computed(() => getHabitWidgetStyleSpec(activePreviewStyle.value));

const isUsingRecommended = computed(() => props.currentStyle === props.recommendedStyle);

const placement = computed(() => {
  if (props.isPhone || !props.anchorRect || typeof window === 'undefined') {
    return {
      style: {} as Record<string, string>,
      side: 'sheet' as const,
    };
  }
  const rect = props.anchorRect;
  const card = props.cardRect;
  const popW = 308;
  const popH = 382;
  const pad = 12;
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer side-docking BESIDE the habit card so the live-previewing widget stays 100% unobstructed!
  if (card) {
    const fitsRight = card.right + gap + popW <= vw - pad;
    const fitsLeft = card.left - gap - popW >= pad;
    if (fitsRight || fitsLeft) {
      const putRight = fitsRight && (!fitsLeft || card.left < vw / 2);
      const left = putRight ? card.right + gap : card.left - gap - popW;
      const idealTop = card.top + (card.height - popH) / 2;
      const top = Math.max(pad, Math.min(vh - popH - pad, idealTop));
      const originY = Math.max(24, Math.min(popH - 24, Math.round(rect.top + rect.height / 2 - top)));
      return {
        side: putRight ? ('right' as const) : ('left' as const),
        style: {
          left: `${Math.round(left)}px`,
          top: `${Math.round(top)}px`,
          width: `${popW}px`,
          '--hwsp-ox': putRight ? '0%' : '100%',
          '--hwsp-oy': `${originY}px`,
          '--hwsp-sx': putRight ? '-8px' : '8px',
          '--hwsp-sy': '0px',
        } as Record<string, string>,
      };
    }
  }

  // Fallback for narrow single-column desktop: cleanly below or above the trigger button
  const spaceBelow = vh - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const above = spaceBelow < popH && spaceAbove > spaceBelow;

  let left = rect.right - popW;
  left = Math.max(pad, Math.min(vw - popW - pad, left));

  let top = above ? rect.top - popH - 8 : rect.bottom + 8;
  top = Math.max(pad, Math.min(vh - popH - pad, top));

  const originX = Math.max(18, Math.min(popW - 18, Math.round(rect.left + rect.width / 2 - left)));
  const originY = above ? '100%' : '0%';

  return {
    side: above ? ('above' as const) : ('below' as const),
    style: {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${popW}px`,
      '--hwsp-ox': `${originX}px`,
      '--hwsp-oy': originY,
      '--hwsp-sx': '0px',
      '--hwsp-sy': above ? '6px' : '-6px',
    } as Record<string, string>,
  };
});

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      focusedIndex.value = activeIndex.value;
      hoveringStyle.value = null;
      await nextTick();
      panelRef.value?.focus({ preventScroll: true });
    } else {
      hoveringStyle.value = null;
    }
  },
);

function setPreview(style: HabitWidgetStyle | null) {
  hoveringStyle.value = style;
  emit('preview', style);
}

function choose(style: HabitWidgetStyle) {
  hoveringStyle.value = null;
  emit('select', style);
}

function onTileEnter(style: HabitWidgetStyle, idx: number, e: PointerEvent) {
  if (props.isPhone || e.pointerType === 'touch') return;
  focusedIndex.value = idx;
  setPreview(style);
}

function onGridLeave() {
  if (props.isPhone) return;
  setPreview(null);
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.open) return;
  const total = HABIT_WIDGET_STYLES.length;
  const cols = 2;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    emit('close');
    return;
  }

  let next = focusedIndex.value;
  if (e.key === 'ArrowRight') next = (focusedIndex.value + 1) % total;
  else if (e.key === 'ArrowLeft') next = (focusedIndex.value - 1 + total) % total;
  else if (e.key === 'ArrowDown') next = (focusedIndex.value + cols) % total;
  else if (e.key === 'ArrowUp') next = (focusedIndex.value - cols + total) % total;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = total - 1;
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    choose(HABIT_WIDGET_STYLES[focusedIndex.value].key);
    return;
  } else {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  focusedIndex.value = next;
  setPreview(HABIT_WIDGET_STYLES[next].key);
}

function onGlobalPointerDown(e: PointerEvent) {
  if (!props.open) return;
  const el = e.target as HTMLElement | null;
  if (panelRef.value?.contains(el)) return;
  if (el?.closest('[data-hv-style-trigger]')) return;
  emit('close');
}

function onWindowResize() {
  if (props.open && !props.isPhone) emit('close');
}

onMounted(() => {
  window.addEventListener('pointerdown', onGlobalPointerDown, true);
  window.addEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalPointerDown, true);
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template>
  <Teleport to="body">
    <!-- Subtle Mobile Sheet Scrim -->
    <Transition name="hwsp-scrim">
      <div
        v-if="open && isPhone"
        class="hwsp-backdrop"
        aria-hidden="true"
        @click="emit('close')"
      />
    </Transition>

    <Transition :name="isPhone ? 'hwsp-sheet' : 'hwsp-pop'">
      <div
        v-if="open"
        ref="panelRef"
        class="hwsp-panel"
        :class="[`side-${placement.side}`, { phone: isPhone }]"
        :style="[placement.style, { '--pop-tint': tint }]"
        role="dialog"
        aria-label="选择小组件样式"
        tabindex="-1"
        @keydown="onKeyDown"
        @mousedown.stop
      >
        <div v-if="isPhone" class="hwsp-grab" aria-hidden="true" />

        <header class="hwsp-head">
          <div class="hwsp-head-left">
            <span class="hwsp-title">小组件视图</span>
            <span class="hwsp-habit-chip">{{ habitTitle }}</span>
          </div>
          <button
            v-if="!isUsingRecommended"
            type="button"
            class="hwsp-reset-btn"
            @pointerenter="!isPhone && setPreview(recommendedStyle)"
            @pointerleave="!isPhone && setPreview(null)"
            @click="choose(recommendedStyle)"
          >
            恢复推荐
          </button>
          <span v-else class="hwsp-live-hint">
            {{ isPhone ? '轻点切换' : '悬停实时预览' }}
          </span>
        </header>

        <div
          class="hwsp-grid"
          role="radiogroup"
          aria-label="8 种小组件样式画廊"
          @pointerleave="onGridLeave"
        >
          <button
            v-for="(st, idx) in HABIT_WIDGET_STYLES"
            :key="st.key"
            type="button"
            role="radio"
            :aria-checked="currentStyle === st.key"
            class="hwsp-tile"
            :class="{
              active: currentStyle === st.key,
              previewed: hoveringStyle === st.key && currentStyle !== st.key,
              kbd: !isPhone && focusedIndex === idx && hoveringStyle === st.key,
            }"
            :style="{ '--tile-i': idx }"
            @pointerenter="onTileEnter(st.key, idx, $event)"
            @click="choose(st.key)"
          >
            <span v-if="currentStyle === st.key" class="hwsp-check" aria-hidden="true">
              <FIcon name="check" :size="9" />
            </span>
            <span
              v-else-if="st.key === recommendedStyle"
              class="hwsp-rec-badge"
            >
              推荐
            </span>

            <HabitWidgetStyleGlyph :style-key="st.key" class="hwsp-glyph" />

            <div class="hwsp-tile-copy">
              <span class="hwsp-tile-name">{{ st.label }}</span>
              <span class="hwsp-tile-tag">{{ st.tagline }}</span>
            </div>
          </button>
        </div>

        <footer class="hwsp-foot">
          <Transition name="hwsp-desc" mode="out-in">
            <span :key="activePreviewSpec.key" class="hwsp-desc">
              {{ activePreviewSpec.desc }}
            </span>
          </Transition>
          <span v-if="!isPhone" class="hwsp-kbd-hint">↑↓←→ · ↵</span>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.hwsp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 235;
  background: rgba(15, 16, 20, 0.32);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.hwsp-scrim-enter-active {
  transition: opacity var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwsp-scrim-leave-active {
  transition: opacity var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwsp-scrim-enter-from,
.hwsp-scrim-leave-to {
  opacity: 0;
}

.hwsp-panel {
  position: fixed;
  z-index: 240;
  padding: 11px;
  border-radius: 18px;
  border: 1px solid var(--ws-hairline-strong, rgba(28, 25, 23, 0.12));
  background: color-mix(in srgb, var(--ws-card-bg, #ffffff) 92%, transparent);
  backdrop-filter: blur(22px) saturate(1.45);
  -webkit-backdrop-filter: blur(22px) saturate(1.45);
  box-shadow:
    0 20px 44px rgba(15, 16, 20, 0.16),
    0 4px 12px rgba(15, 16, 20, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.55);
  display: flex;
  flex-direction: column;
  gap: 8px;
  outline: none;
  transform-origin: var(--hwsp-ox, 85%) var(--hwsp-oy, 0%);
  will-change: transform, opacity;
}

html[data-ws-theme='dark'] .hwsp-panel {
  background: color-mix(in srgb, var(--ws-card-bg, #1f1e1c) 90%, transparent);
  box-shadow:
    0 24px 52px rgba(0, 0, 0, 0.45),
    0 4px 14px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.hwsp-panel.phone {
  left: 10px;
  right: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom));
  top: auto;
  width: auto;
  max-width: 440px;
  margin: 0 auto;
  padding: 10px 12px 13px;
  border-radius: 22px;
  transform-origin: 50% 100%;
}

.hwsp-grab {
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong, rgba(28, 25, 23, 0.16));
  margin: 0 auto 2px;
}

.hwsp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}

.hwsp-head-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.hwsp-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--ws-ink, #1c1b19);
  white-space: nowrap;
}

.hwsp-habit-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pop-tint, #10a37f) 12%, transparent);
  color: var(--pop-tint, #10a37f);
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 118px;
}

.hwsp-live-hint {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ws-ink-muted, #8e8a82);
  white-space: nowrap;
}

.hwsp-reset-btn {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--pop-tint, #10a37f) 28%, transparent);
  background: color-mix(in srgb, var(--pop-tint, #10a37f) 10%, transparent);
  color: var(--pop-tint, #10a37f);
  font: inherit;
  font-size: 10.5px;
  font-weight: 720;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hwsp-reset-btn:hover {
  background: color-mix(in srgb, var(--pop-tint, #10a37f) 18%, transparent);
}

.hwsp-reset-btn:active {
  transform: scale(0.95);
}

.hwsp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.hwsp-tile {
  position: relative;
  padding: 8px 8px 7px;
  border-radius: 13px;
  border: 1px solid var(--ws-hairline, rgba(28, 25, 23, 0.08));
  background: color-mix(in srgb, var(--ws-card-subtle, #f5f4f1) 76%, transparent);
  color: var(--ws-ink-secondary, #5c5952);
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition:
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    background-color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    color var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

@media (hover: hover) {
  .hwsp-tile:hover {
    background: color-mix(in srgb, var(--pop-tint, #10a37f) 10%, var(--ws-card-bg, #ffffff));
    border-color: color-mix(in srgb, var(--pop-tint, #10a37f) 42%, transparent);
    color: var(--pop-tint, #10a37f);
    transform: translateY(-1px);
  }

  .hwsp-tile:hover .hwsp-glyph {
    transform: scale(1.04);
  }
}

.hwsp-tile.previewed {
  background: color-mix(in srgb, var(--pop-tint, #10a37f) 10%, var(--ws-card-bg, #ffffff));
  border-color: color-mix(in srgb, var(--pop-tint, #10a37f) 42%, transparent);
  color: var(--pop-tint, #10a37f);
  transform: translateY(-1px);
}

.hwsp-tile:active {
  transform: scale(0.97);
}

.hwsp-tile.active {
  background: color-mix(in srgb, var(--pop-tint, #10a37f) 14%, var(--ws-card-bg, #ffffff));
  border-color: color-mix(in srgb, var(--pop-tint, #10a37f) 62%, transparent);
  color: var(--pop-tint, #10a37f);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--pop-tint, #10a37f) 24%, transparent);
}

.hwsp-tile.kbd {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pop-tint, #10a37f) 48%, transparent);
}

.hwsp-glyph {
  width: 60px;
  height: 28px;
  transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.hwsp-tile.active .hwsp-glyph,
.hwsp-tile.previewed .hwsp-glyph {
  transform: scale(1.04);
}

.hwsp-tile-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  line-height: 1.15;
}

.hwsp-tile-name {
  font-size: 11.5px;
  font-weight: 760;
  color: var(--ws-ink, #1c1b19);
}

.hwsp-tile-tag {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--ws-ink-muted, #8e8a82);
}

.hwsp-check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--pop-tint, #10a37f);
  color: #ffffff;
  display: inline-grid;
  place-items: center;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--pop-tint, #10a37f) 42%, transparent);
  animation: hwsp-check-pop var(--duration-fast, 250ms) var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

@keyframes hwsp-check-pop {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.hwsp-rec-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  padding: 1px 5px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--pop-tint, #10a37f) 14%, transparent);
  color: var(--pop-tint, #10a37f);
  font-size: 9px;
  font-weight: 760;
  line-height: 1.3;
}

.hwsp-foot {
  padding: 6px 3px 0;
  border-top: 1px solid var(--ws-hairline, rgba(28, 25, 23, 0.08));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}

.hwsp-desc {
  font-size: 10.5px;
  font-weight: 560;
  color: var(--ws-ink-muted, #8e8a82);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hwsp-kbd-hint {
  flex: none;
  font-size: 10px;
  font-weight: 660;
  color: var(--ws-ink-muted, #8e8a82);
  opacity: 0.78;
  font-variant-numeric: tabular-nums;
}

/* Soft in-place description swap (transitions-polish: text swap 150ms) */
.hwsp-desc-enter-active,
.hwsp-desc-leave-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out),
    filter var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out),
    transform var(--duration-quick, 150ms) var(--ease-in-out, ease-in-out);
}
.hwsp-desc-enter-from {
  opacity: 0;
  filter: blur(var(--blur-small, 2px));
  transform: translateY(3px);
}
.hwsp-desc-leave-to {
  opacity: 0;
  filter: blur(var(--blur-small, 2px));
  transform: translateY(-3px);
}

/* Asymmetric Dropdown Open (250ms, scale 0.97) -> Close (150ms, scale 0.99) per transitions-polish */
.hwsp-pop-enter-active {
  transition:
    opacity var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwsp-pop-leave-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwsp-pop-enter-from {
  opacity: 0;
  transform: translate(var(--hwsp-sx, 0px), var(--hwsp-sy, -6px)) scale(var(--scale-medium, 0.97));
}
.hwsp-pop-leave-to {
  opacity: 0;
  transform: scale(var(--scale-tiny, 0.99));
}

/* Mobile Floating Gallery Sheet Open (250ms) -> Close (150ms) */
.hwsp-sheet-enter-active {
  transition:
    opacity var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwsp-sheet-leave-active {
  transition:
    opacity var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}
.hwsp-sheet-enter-from,
.hwsp-sheet-leave-to {
  opacity: 0;
  transform: translateY(18px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .hwsp-panel,
  .hwsp-tile,
  .hwsp-glyph,
  .hwsp-check,
  .hwsp-pop-enter-active,
  .hwsp-pop-leave-active,
  .hwsp-sheet-enter-active,
  .hwsp-sheet-leave-active,
  .hwsp-desc-enter-active,
  .hwsp-desc-leave-active {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
