<script setup lang="ts">
import { computed } from 'vue';
import { getHabitIcon } from '@/lib/habits';

const props = withDefaults(
  defineProps<{
    iconKey?: string;
    color?: string;
    size?: number;
    radius?: number;
  }>(),
  {
    size: 40,
    radius: 12,
  },
);

const spec = computed(() => getHabitIcon(props.iconKey));
const bgHex = computed(() => props.color || spec.value.defaultColor);
const iconPx = computed(() => Math.max(12, Math.round(props.size * 0.56)));
</script>

<template>
  <span
    class="habit-emblem"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${radius}px`,
      background: bgHex,
    }"
    aria-hidden="true"
  >
    <svg
      class="he-svg"
      :width="iconPx"
      :height="iconPx"
      viewBox="0 0 24 24"
      :fill="spec.stroke ? 'none' : 'currentColor'"
      :stroke="spec.stroke ? 'currentColor' : 'none'"
      :stroke-width="spec.stroke ? 2.1 : 0"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path v-for="(d, i) in spec.paths" :key="i" :d="d" />
    </svg>
  </span>
</template>

<style scoped>
.habit-emblem {
  position: relative;
  display: inline-grid;
  place-items: center;
  color: #ffffff;
  flex: none;
  user-select: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

.he-svg {
  display: block;
}
</style>
