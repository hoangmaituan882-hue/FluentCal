<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number | string;
    direction?: 'up' | 'down';
  }>(),
  { direction: 'up' },
);

interface DigitSlot {
  char: string;
  same: boolean;
  stagger: 0 | 1 | 2;
}

function buildSlots(str: string, prev: string): DigitSlot[] {
  let same = 0;
  if (prev && prev !== str) {
    while (same < prev.length && same < str.length && prev[same] === str[same]) same++;
  } else if (prev === str) {
    same = str.length;
  }
  const chars = str.split('');
  return chars.map((char, i) => ({
    char,
    same: i < same,
    stagger: i === chars.length - 1 ? 2 : i === chars.length - 2 ? 1 : 0,
  }));
}

const groupRef = ref<HTMLElement | null>(null);
const prevText = ref(String(props.value));
const slots = ref<DigitSlot[]>(buildSlots(String(props.value), String(props.value)));
const animating = ref(false);

watch(
  () => String(props.value),
  async (nextVal, oldVal) => {
    if (nextVal === oldVal) return;
    animating.value = false;
    slots.value = buildSlots(nextVal, prevText.value);
    prevText.value = nextVal;
    await nextTick();
    if (groupRef.value) void groupRef.value.offsetHeight;
    animating.value = true;
  },
);
</script>

<template>
  <span
    ref="groupRef"
    class="t-digit-group"
    :class="{ 'is-animating': animating }"
    :style="{ '--digit-dir-y': direction === 'down' ? '-1' : '1' }"
  >
    <span
      v-for="(slot, idx) in slots"
      :key="`${idx}:${slot.char}`"
      class="t-digit"
      :data-same="slot.same ? '' : undefined"
      :data-stagger="slot.stagger > 0 ? String(slot.stagger) : undefined"
    >
      {{ slot.char }}
    </span>
  </span>
</template>
