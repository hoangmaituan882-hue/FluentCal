<script setup lang="ts">
import { computed } from 'vue';
import { getGroupIcon } from '@/lib/groupIcons';
import { SOLAR_GROUP_ICONS } from './solarIcons';

const props = withDefaults(
  defineProps<{
    icon?: string;
    color?: string;
    size?: number;
  }>(),
  { size: 15 },
);

const solarBody = computed(() => (props.icon ? SOLAR_GROUP_ICONS[props.icon] : undefined));
const def = computed(() => getGroupIcon(props.icon));
const dotSize = computed(() => Math.max(6, Math.round(props.size * 0.54)));
</script>

<template>
  <svg
    v-if="solarBody"
    class="f-group-svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    v-html="solarBody"
  />
  <svg
    v-else-if="def"
    class="f-group-svg"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, idx) in def.paths" :key="idx" :d="d" />
  </svg>
  <span
    v-else
    class="f-group-dot"
    :style="{ width: `${dotSize}px`, height: `${dotSize}px`, background: color || '#9E9990' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.f-group-svg {
  display: inline-block;
  flex: none;
  color: inherit;
  vertical-align: middle;
}

.f-group-dot {
  display: inline-block;
  flex: none;
  border-radius: 50%;
}
</style>
