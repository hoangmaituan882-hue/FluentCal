<script setup lang="ts">
import { computed } from 'vue';
import { getBrandByKey, inferBrandFromTitle } from '@/lib/subscriptionIcons';

const props = withDefaults(
  defineProps<{
    brandKey?: string;
    iconData?: string;
    title?: string;
    emblem?: string;
    brandColor?: string;
    size?: number;
    radius?: number;
    /** Glass variant used inside colorful gradient membership deck cards */
    glass?: boolean;
  }>(),
  {
    brandColor: '#10A37F',
    size: 38,
    glass: false,
  },
);

const brand = computed(() => {
  if (props.iconData) return undefined;
  return getBrandByKey(props.brandKey) ?? (props.title ? inferBrandFromTitle(props.title) : undefined);
});

const isSvgData = computed(() => !!props.iconData && props.iconData.startsWith('data:image/svg+xml'));
const isRasterData = computed(() => !!props.iconData && !isSvgData.value);

const computedRadius = computed(() => props.radius ?? Math.round(props.size * 0.28));

const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${computedRadius.value}px`,
  background: isRasterData.value
    ? 'transparent'
    : props.glass
      ? 'rgba(255, 255, 255, 0.22)'
      : props.brandColor,
}));

const glyphText = computed(() => {
  if (brand.value?.glyphText) return brand.value.glyphText;
  return props.emblem || brand.value?.emblem || props.title?.trim().slice(0, 1).toUpperCase() || '✦';
});

const glyphFontSize = computed(() => {
  const len = Array.from(glyphText.value).length;
  if (len >= 4) return Math.max(9, Math.round(props.size * 0.27));
  if (len === 3) return Math.max(10, Math.round(props.size * 0.31));
  if (len === 2) return Math.max(11, Math.round(props.size * 0.37));
  return Math.max(12, Math.round(props.size * 0.48));
});
</script>

<template>
  <span
    class="sub-emblem"
    :class="{ raster: isRasterData, svg: isSvgData, glass }"
    :style="boxStyle"
  >
    <!-- Tier 2/3: Cached Inline Data URL (App Store / Iconify SVG / Uploaded Photo) -->
    <img
      v-if="iconData"
      :src="iconData"
      :alt="title || '订阅图标'"
      class="se-img"
      :class="{ 'is-svg': isSvgData }"
      draggable="false"
    />

    <!-- Tier 1: Built-in Curated Offline Brand Vector Mark -->
    <svg
      v-else-if="brand?.svgPaths?.length"
      class="se-svg"
      :class="{ stroked: brand.svgStroke }"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path v-for="(d, idx) in brand.svgPaths" :key="idx" :d="d" />
    </svg>

    <!-- Tier 1 Monogram / Fallback Glyph -->
    <span
      v-else
      class="se-glyph"
      :style="{ fontSize: `${glyphFontSize}px` }"
    >
      {{ glyphText }}
    </span>
  </span>
</template>

<style scoped>
.sub-emblem {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: #ffffff;
  overflow: hidden;
  user-select: none;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.sub-emblem.glass {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
}

.sub-emblem.raster {
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.14),
    inset 0 0 0 0.5px rgba(0, 0, 0, 0.08);
}

.se-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.se-img.is-svg {
  width: 64%;
  height: 64%;
  object-fit: contain;
}

.se-svg {
  width: 60%;
  height: 60%;
  fill: currentColor;
  stroke: none;
  display: block;
}

.se-svg.stroked {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.se-glyph {
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  white-space: nowrap;
}
</style>
