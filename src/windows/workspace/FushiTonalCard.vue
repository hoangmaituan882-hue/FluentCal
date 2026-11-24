<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Base brand or category hex color from which the entire Fushi tonal surface, watermark, ink & progress bar derive. */
    tint?: string;
    /** Giant editorial watermark text (adaptively sized and anchored flush to the card's top-right corner). */
    watermark?: string;
    /** Visual shape & spacing density variant. */
    variant?: 'hero' | 'preview' | 'tile' | 'deck' | 'row';
    /** Optional 0..100 progress bar rendered in Fushi's signature deep tonal pill bar. */
    progress?: number | null;
    /** Enables Fushi hover lift & press scale feedback. */
    interactive?: boolean;
    /** Highlights active/focused card with a tonal focus ring. */
    active?: boolean;
    /** Optional tag name ('div' | 'section' | 'article' | 'button'). */
    as?: 'div' | 'section' | 'article' | 'button';
  }>(),
  {
    tint: '#D43C33',
    watermark: '',
    variant: 'hero',
    progress: null,
    interactive: false,
    active: false,
    as: 'div',
  },
);

const clampedProgress = computed(() => {
  if (typeof props.progress !== 'number' || !Number.isFinite(props.progress)) return null;
  return Math.max(0, Math.min(100, props.progress));
});

/**
 * Adaptive watermark scale derived from visual character width (CJK = 1.0, ASCII = 0.56)
 * so short titles stay grand while longer titles smoothly fit flush into the top-right corner.
 */
const watermarkScale = computed(() => {
  const txt = (props.watermark || '').trim();
  if (!txt) return 1;
  let units = 0;
  for (const ch of txt) {
    units += ch.charCodeAt(0) > 255 ? 1 : 0.56;
  }
  if (units <= 4.5) return 1;
  if (units <= 6.5) return 0.9;
  if (units <= 8.5) return 0.8;
  if (units <= 11) return 0.72;
  return 0.64;
});

const cardStyle = computed(() => ({
  '--fc-tint': props.tint || '#635BFF',
  '--fc-wm-scale': String(watermarkScale.value),
}));
</script>

<template>
  <component
    :is="as"
    :type="as === 'button' ? 'button' : undefined"
    class="fushi-card"
    :class="[
      `v-${variant}`,
      {
        interactive,
        active,
        'has-emblem': !!$slots.emblem,
        'has-progress': clampedProgress !== null,
      },
    ]"
    :style="cardStyle"
  >
    <!-- Giant Adaptive Watermark Anchored Flush to Card Top-Right Corner -->
    <span v-if="watermark" class="fc-wm" aria-hidden="true">{{ watermark }}</span>

    <!-- Tilted Left Cover / Emblem (Fushi -5.5deg ambient floating look) -->
    <div v-if="$slots.emblem" class="fc-emblem-slot">
      <slot name="emblem" />
    </div>

    <!-- Main Editorial Content Stage -->
    <div class="fc-stage">
      <div class="fc-body">
        <slot />
      </div>

      <!-- Optional Fushi Signature Deep-Tonal Rounded Progress Bar -->
      <div v-if="clampedProgress !== null" class="fc-bar-wrap">
        <div v-if="$slots.progressMeta" class="fc-bar-meta">
          <slot name="progressMeta" />
        </div>
        <div class="fc-bar-row">
          <div class="fc-bar-track" aria-hidden="true">
            <div class="fc-bar-fill" :style="{ width: `${Math.max(4, clampedProgress)}%` }" />
          </div>
          <div v-if="$slots.progressEnd" class="fc-bar-end">
            <slot name="progressEnd" />
          </div>
        </div>
      </div>
    </div>
  </component>
</template>

<style scoped>
.fushi-card {
  --fc-tint: #635bff;
  --fc-wm-scale: 1;
  --fc-bg: color-mix(in srgb, var(--fc-tint) 16%, #ffffff);
  --fc-wm: color-mix(in srgb, var(--fc-tint) 18%, rgba(36, 20, 24, 0.045));
  --fc-ink: color-mix(in srgb, var(--fc-tint) 34%, #1b1114);
  --fc-sub: color-mix(in srgb, var(--fc-ink) 74%, transparent);
  --fc-track: color-mix(in srgb, var(--fc-tint) 24%, rgba(36, 20, 24, 0.05));
  --fc-fill: color-mix(in srgb, var(--fc-tint) 44%, #1b1114);
  --fc-on-fill: #ffffff;
  --fc-shadow:
    0 14px 30px -10px color-mix(in srgb, var(--fc-tint) 26%, rgba(20, 18, 24, 0.16)),
    0 2px 6px rgba(20, 18, 24, 0.04);

  position: relative;
  width: 100%;
  container-type: inline-size;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 24px 20px;
  border: 0;
  border-radius: 30px;
  background: var(--fc-bg);
  color: var(--fc-ink);
  box-shadow: var(--fc-shadow);
  overflow: hidden;
  text-align: left;
  font: inherit;
  box-sizing: border-box;
  transition:
    transform 240ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    box-shadow 240ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)),
    background-color 200ms ease;
}

.fushi-card.interactive {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.fushi-card.interactive:hover {
  transform: translateY(-2px) scale(1.008);
  box-shadow:
    0 18px 36px -10px color-mix(in srgb, var(--fc-tint) 32%, rgba(20, 18, 24, 0.2)),
    0 4px 10px rgba(20, 18, 24, 0.06);
}

.fushi-card.interactive:active {
  transform: scale(0.986);
}

.fushi-card.active {
  box-shadow:
    0 0 0 2.2px var(--fc-fill),
    var(--fc-shadow);
}

/* Prevent flex-column scroll containers from collapsing hero/preview/row Fushi cards */
.fushi-card.v-hero,
.fushi-card.v-preview,
.fushi-card.v-row {
  flex-shrink: 0;
}

/* Variant: Preview Banner (Editor Live Preview & Master-Detail Hero) */
.fushi-card.v-preview {
  border-radius: 26px;
  padding: 14px 20px 15px;
  gap: 17px;
}

/* Variant: Treemap / Category Stat Tile */
.fushi-card.v-tile {
  border-radius: 24px;
  padding: 13px 17px 14px;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  gap: 0;
}

/* Variant: Staggered Deck Card */
.fushi-card.v-deck {
  border-radius: 24px;
  padding: 13px 18px 14px;
  gap: 16px;
}

/* Variant: Compact Master-Detail Subscription List Row Card */
.fushi-card.v-row {
  border-radius: 18px;
  padding: 11px 14px;
  gap: 12px;
  box-shadow:
    0 6px 16px -6px color-mix(in srgb, var(--fc-tint) 22%, rgba(20, 18, 24, 0.1)),
    0 1px 2px rgba(20, 18, 24, 0.03);
}

.fushi-card.v-row.interactive:hover {
  transform: translateY(-1px) scale(1.005);
}

.fushi-card.v-row.active {
  box-shadow:
    0 0 0 2px var(--fc-fill),
    0 10px 22px -6px color-mix(in srgb, var(--fc-tint) 32%, rgba(20, 18, 24, 0.16));
}

/* Giant Adaptive Watermark — Anchored Flush to Card's Top-Right Corner */
.fc-wm {
  position: absolute;
  top: -5px;
  right: 8px;
  left: 16px;
  display: flex;
  justify-content: flex-end;
  text-align: right;
  font-size: calc(clamp(32px, 13.5cqi, 64px) * var(--fc-wm-scale, 1));
  font-weight: 900;
  line-height: 0.96;
  letter-spacing: -0.03em;
  color: var(--fc-wm);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(270deg, #000 84%, transparent 100%);
  mask-image: linear-gradient(270deg, #000 84%, transparent 100%);
  z-index: 0;
}

.fushi-card.has-emblem .fc-wm {
  left: 72px;
}

.fushi-card.v-hero .fc-wm {
  top: -6px;
  right: 12px;
  font-size: calc(clamp(38px, 13.5cqi, 68px) * var(--fc-wm-scale, 1));
}

.fushi-card.v-preview .fc-wm {
  top: -4px;
  right: 10px;
  font-size: calc(clamp(34px, 13cqi, 56px) * var(--fc-wm-scale, 1));
}

.fushi-card.v-tile .fc-wm {
  top: -5px;
  right: 4px;
  left: 8px;
  font-size: calc(clamp(32px, 19cqi, 58px) * var(--fc-wm-scale, 1));
}

.fushi-card.v-deck .fc-wm {
  top: -4px;
  right: 8px;
  font-size: calc(clamp(34px, 14cqi, 54px) * var(--fc-wm-scale, 1));
}

.fushi-card.v-row .fc-wm {
  top: -5px;
  right: 6px;
  left: 52px;
  font-size: calc(clamp(28px, 14cqi, 44px) * var(--fc-wm-scale, 1));
  color: color-mix(in srgb, var(--fc-tint) 15%, rgba(36, 20, 24, 0.035));
}

/* Tilted Floating Emblem / Cover (matching Fushi's -5.5deg soft-shadow cover) */
.fc-emblem-slot {
  position: relative;
  z-index: 2;
  flex: none;
  transform: rotate(-5.5deg);
  filter: drop-shadow(0 10px 18px color-mix(in srgb, var(--fc-tint) 30%, rgba(0, 0, 0, 0.24)));
  transition: transform 260ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

.fushi-card.v-row .fc-emblem-slot {
  transform: rotate(-4deg);
  filter: drop-shadow(0 6px 10px color-mix(in srgb, var(--fc-tint) 24%, rgba(0, 0, 0, 0.16)));
}

.fushi-card.interactive:hover .fc-emblem-slot {
  transform: rotate(-2.4deg) scale(1.035);
}

/* Main Content Stage */
.fc-stage {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}

.fushi-card.v-row .fc-stage {
  gap: 0;
  justify-content: center;
}

.fc-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  padding-top: 26px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}

.fushi-card.v-preview .fc-body {
  padding-top: 22px;
}

.fushi-card.v-tile .fc-body {
  padding-top: 22px;
}

.fushi-card.v-deck .fc-body {
  padding-top: 18px;
}

.fushi-card.v-row .fc-body {
  padding-top: 2px;
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

/* Fushi Signature Thick Pill Progress Bar */
.fc-bar-wrap {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 2px;
}

.fc-bar-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 660;
  color: var(--fc-sub);
}

.fc-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fc-bar-track {
  flex: 1;
  min-width: 0;
  height: 7.5px;
  border-radius: 999px;
  background: var(--fc-track);
  overflow: hidden;
}

.fushi-card.v-tile .fc-bar-track,
.fushi-card.v-preview .fc-bar-track,
.fushi-card.v-deck .fc-bar-track {
  height: 6.5px;
}

.fc-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--fc-fill);
  transition: width 460ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.fc-bar-end {
  flex: none;
  display: inline-flex;
  align-items: center;
}

@media (max-width: 639px) {
  .fushi-card {
    padding: 15px 17px 16px;
    gap: 14px;
    border-radius: 24px;
  }

  .fushi-card.v-row {
    padding: 10px 12px;
    gap: 10px;
    border-radius: 16px;
  }

  .fc-body {
    padding-top: 20px;
  }

  .fushi-card.v-preview .fc-body,
  .fushi-card.v-tile .fc-body {
    padding-top: 18px;
  }

  .fushi-card.v-deck .fc-body {
    padding-top: 16px;
  }

  .fushi-card.v-row .fc-body {
    padding-top: 1px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fushi-card,
  .fc-emblem-slot,
  .fc-bar-fill {
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
/* Unscoped Dark-Mode Tonal Derivation (matching Fushi dark alpha restraint: calm chroma, high legibility) */
html[data-ws-theme='dark'] .fushi-card {
  --fc-bg: color-mix(in srgb, var(--fc-tint) 22%, #191b22);
  --fc-wm: color-mix(in srgb, var(--fc-tint) 28%, rgba(255, 255, 255, 0.06));
  --fc-ink: color-mix(in srgb, var(--fc-tint) 16%, #f8fafc);
  --fc-sub: color-mix(in srgb, var(--fc-ink) 74%, transparent);
  --fc-track: rgba(255, 255, 255, 0.13);
  --fc-fill: color-mix(in srgb, var(--fc-tint) 76%, #ffffff);
  --fc-on-fill: #10141c;
  --fc-shadow:
    0 14px 32px -8px rgba(0, 0, 0, 0.48),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

html[data-ws-theme='dark'] .fushi-card.v-row {
  --fc-bg: color-mix(in srgb, var(--fc-tint) 19%, #191b22);
  --fc-wm: color-mix(in srgb, var(--fc-tint) 24%, rgba(255, 255, 255, 0.05));
  --fc-shadow:
    0 8px 18px -6px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
</style>
