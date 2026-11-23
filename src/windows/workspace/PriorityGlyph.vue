<script setup lang="ts">
import type { TaskPriority } from '@/types';

withDefaults(
  defineProps<{
    priority: TaskPriority;
    size?: number;
  }>(),
  { size: 15 },
);
</script>

<template>
  <svg
    class="priority-glyph"
    :class="priority"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="1.6"
      y="1.6"
      width="12.8"
      height="12.8"
      rx="3.2"
      class="pg-box"
      stroke="currentColor"
      stroke-width="1.25"
    />

    <!-- Urgent: coral exclamation mark -->
    <template v-if="priority === 'urgent'">
      <path d="M8 4.4v4.3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
      <circle cx="8" cy="11.2" r="0.95" fill="currentColor" />
    </template>

    <!-- High / Medium / Low: 3 signal bars inside rounded square -->
    <template v-else-if="priority === 'high' || priority === 'medium' || priority === 'low'">
      <path d="M4.9 11.2V5.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <path
        d="M8 11.2V5.3"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        :opacity="priority === 'low' ? 0.24 : 1"
      />
      <path
        d="M11.1 11.2V5.3"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        :opacity="priority === 'high' ? 1 : 0.24"
      />
    </template>

    <!-- None: subtle dash -->
    <template v-else>
      <path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" opacity="0.55" />
    </template>
  </svg>
</template>

<style scoped>
.priority-glyph {
  display: inline-block;
  flex: none;
}

.priority-glyph.urgent {
  color: #E5484D;
}

.priority-glyph.urgent .pg-box {
  fill: rgba(229, 72, 77, 0.12);
}

.priority-glyph.high {
  color: #D97706;
}

.priority-glyph.medium {
  color: #0284C7;
}

.priority-glyph.low {
  color: #5C5953;
}

.priority-glyph.none {
  color: #9E9990;
}

:global(html[data-ws-theme='dark']) .priority-glyph.low {
  color: rgba(242, 240, 235, 0.65);
}

:global(html[data-ws-theme='dark']) .priority-glyph.none {
  color: rgba(242, 240, 235, 0.42);
}
</style>
