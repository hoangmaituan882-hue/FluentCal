<script setup lang="ts">
import { computed } from 'vue';
import { bestTextOn, FGroupIcon, taskColor } from '@/fluent';
import { getGroupIcon } from '@/lib/groupIcons';
import { isDark } from '@/composables/theme';

const props = withDefaults(
  defineProps<{
    name?: string;
    colorKey?: string;
    icon?: string;
    size?: number;
    active?: boolean;
  }>(),
  { size: 20, active: false },
);

const bgHex = computed(() => (props.colorKey ? taskColor(props.colorKey, isDark.value).bar : '#78716C'));
const fgHex = computed(() => bestTextOn(bgHex.value));
const hasCustomIcon = computed(() => !!getGroupIcon(props.icon));

const monogram = computed(() => {
  const clean = (props.name ?? '').trim();
  if (!clean) return '•';
  // Use uppercase initials for multi-word Latin titles, or first char for CJK
  if (/^[\x20-\x7E]+$/.test(clean)) {
    const words = clean.split(/[\s\-_/]+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }
  return Array.from(clean)[0] ?? '•';
});
</script>

<template>
  <span
    class="group-squircle"
    :class="{ active }"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${Math.max(4, Math.round(size * 0.3))}px`,
      background: bgHex,
      color: fgHex,
      fontSize: `${Math.max(8, Math.round(size * 0.46))}px`,
    }"
    :title="name"
  >
    <FGroupIcon v-if="hasCustomIcon" :icon="icon" :color="fgHex" :size="Math.round(size * 0.65)" />
    <span v-else class="gs-mono">{{ monogram }}</span>
  </span>
</template>

<style scoped>
.group-squircle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 140ms ease;
}

.group-squircle.active {
  box-shadow:
    0 0 0 2px var(--ws-card-bg, #ffffff),
    0 0 0 3.5px #3B82F6;
}

.gs-mono {
  user-select: none;
}
</style>
