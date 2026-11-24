<script setup lang="ts">
import type { HabitWidgetStyle } from '@/types';

withDefaults(
  defineProps<{
    styleKey: HabitWidgetStyle;
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);
</script>

<template>
  <svg
    class="hwsg-svg"
    :class="{ compact }"
    viewBox="0 0 64 30"
    fill="none"
    aria-hidden="true"
  >
    <template v-if="styleKey === 'window'">
      <rect x="6" y="4" width="22" height="6.5" rx="3.25" fill="currentColor" />
      <rect x="40" y="5" width="18" height="4.5" rx="2.25" fill="currentColor" opacity=".28" />
      <rect x="6" y="15.5" width="52" height="10" rx="4" fill="currentColor" opacity=".16" />
      <rect x="20" y="15.5" width="16" height="10" rx="3.5" fill="currentColor" />
      <line x1="14" y1="13.5" x2="14" y2="27.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" />
    </template>

    <template v-else-if="styleKey === 'spectrum'">
      <rect x="6" y="3.5" width="20" height="5" rx="2.5" fill="currentColor" />
      <rect x="7" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".32" />
      <rect x="13" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".48" />
      <rect x="19" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".66" />
      <rect x="25" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".84" />
      <rect x="31" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" />
      <rect x="37" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".18" />
      <rect x="43" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".18" />
      <rect x="49" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".18" />
      <rect x="55" y="13" width="3.5" height="13.5" rx="1.75" fill="currentColor" opacity=".18" />
    </template>

    <template v-else-if="styleKey === 'rings'">
      <circle cx="14" cy="9" r="5" stroke="currentColor" stroke-width="2.1" />
      <circle cx="28" cy="9" r="5" stroke="currentColor" stroke-width="2.1" />
      <circle cx="42" cy="9" r="5" stroke="currentColor" stroke-width="2.1" opacity=".45" />
      <circle cx="56" cy="9" r="5" stroke="currentColor" stroke-width="2.1" opacity=".24" />
      <circle cx="21" cy="21" r="5" stroke="currentColor" stroke-width="2.1" />
      <circle cx="35" cy="21" r="5" stroke="currentColor" stroke-width="2.1" opacity=".62" />
      <circle cx="49" cy="21" r="5" stroke="currentColor" stroke-width="2.1" opacity=".24" />
    </template>

    <template v-else-if="styleKey === 'bars'">
      <rect x="6" y="4" width="30" height="5" rx="2.5" fill="currentColor" opacity=".42" />
      <rect x="6" y="12.5" width="42" height="5" rx="2.5" fill="currentColor" opacity=".68" />
      <rect x="6" y="21" width="50" height="5" rx="2.5" fill="currentColor" />
      <line x1="44" y1="2" x2="44" y2="28" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2" />
    </template>

    <template v-else-if="styleKey === 'gauge'">
      <path d="M8 18a7 7 0 1 1 12 0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      <path d="M44 18a7 7 0 1 1 12 0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".68" />
      <rect x="26" y="8" width="12" height="7" rx="2.2" fill="currentColor" />
      <line x1="8" y1="25" x2="56" y2="25" stroke="currentColor" stroke-width="2" stroke-dasharray="2 3" />
      <rect x="36" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" />
    </template>

    <template v-else-if="styleKey === 'pillars'">
      <rect x="7" y="10" width="14" height="5" rx="2" fill="currentColor" />
      <rect x="7" y="18" width="10" height="3" rx="1.5" fill="currentColor" opacity=".38" />
      <rect x="27" y="9" width="7" height="17" rx="3" fill="currentColor" opacity=".52" />
      <rect x="37" y="6" width="7" height="20" rx="3" fill="currentColor" opacity=".78" />
      <rect x="47" y="3" width="7" height="23" rx="3" fill="currentColor" />
    </template>

    <template v-else-if="styleKey === 'journey'">
      <rect x="6" y="4" width="18" height="8.5" rx="4.25" fill="currentColor" />
      <rect x="28" y="6" width="24" height="4" rx="2" fill="currentColor" opacity=".32" />
      <line x1="8" y1="22" x2="56" y2="22" stroke="currentColor" stroke-width="2" opacity=".28" />
      <line x1="8" y1="22" x2="38" y2="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      <circle cx="10" cy="22" r="2.6" fill="currentColor" />
      <circle cx="24" cy="22" r="2.6" fill="currentColor" />
      <circle cx="38" cy="22" r="3.4" fill="currentColor" />
      <circle cx="54" cy="22" r="2.6" stroke="currentColor" stroke-width="1.6" />
    </template>

    <template v-else>
      <rect x="8" y="4" width="7" height="7" rx="2" fill="currentColor" opacity=".34" />
      <rect x="18" y="4" width="7" height="7" rx="2" fill="currentColor" opacity=".72" />
      <rect x="28" y="4" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="38" y="4" width="7" height="7" rx="2" fill="currentColor" opacity=".56" />
      <rect x="48" y="4" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="8" y="15" width="7" height="7" rx="2" fill="currentColor" opacity=".62" />
      <rect x="18" y="15" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="28" y="15" width="7" height="7" rx="2" fill="currentColor" opacity=".38" />
      <rect x="38" y="15" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="48" y="15" width="7" height="7" rx="2" fill="currentColor" opacity=".82" />
    </template>
  </svg>
</template>

<style scoped>
.hwsg-svg {
  width: 64px;
  height: 30px;
  display: block;
  flex: none;
}

.hwsg-svg.compact {
  width: 18px;
  height: 11px;
}
</style>
