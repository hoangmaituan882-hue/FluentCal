<script setup lang="ts">
import type { TaskStatus } from '@/types';

withDefaults(
  defineProps<{
    status: TaskStatus;
    size?: number;
    onPill?: boolean;
    interactive?: boolean;
  }>(),
  { size: 15, onPill: false, interactive: false },
);
</script>

<template>
  <svg
    class="status-glyph"
    :class="[status, { 'on-pill': onPill, interactive }]"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <!-- In review: concentric target ring (sky blue) -->
    <template v-if="status === 'in_review'">
      <circle
        cx="8"
        cy="8"
        r="5.8"
        :fill="onPill ? 'none' : 'var(--sg-review-fill, rgba(59, 130, 246, 0.14))'"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <circle cx="8" cy="8" r="2.7" fill="currentColor" />
    </template>

    <!-- In progress: warm amber ring with inner semicircle -->
    <template v-else-if="status === 'in_progress'">
      <circle
        cx="8"
        cy="8"
        r="5.8"
        :fill="onPill ? 'none' : 'var(--sg-progress-fill, rgba(217, 119, 6, 0.15))'"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <path d="M8 3.6a4.4 4.4 0 0 1 0 8.8Z" fill="currentColor" />
    </template>

    <!-- Backlog: dotted ring -->
    <template v-else-if="status === 'backlog'">
      <circle
        cx="8"
        cy="8"
        r="5.8"
        stroke="currentColor"
        stroke-width="1.45"
        stroke-dasharray="1.8 2.3"
        stroke-linecap="round"
      />
    </template>

    <!-- Done: solid circle + checkmark -->
    <template v-else-if="status === 'done'">
      <circle cx="8" cy="8" r="6.4" fill="currentColor" />
      <path
        class="done-chk"
        d="M5.1 8.2 7.1 10.2 11 5.9"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>

    <!-- Todo: crisp clean empty circle -->
    <template v-else>
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" stroke-width="1.45" />
    </template>
  </svg>
</template>

<style scoped>
.status-glyph {
  display: inline-block;
  flex: none;
}

.status-glyph.interactive {
  transition: transform 110ms ease;
}

.status-glyph.interactive:hover {
  transform: scale(1.12);
}

.status-glyph.in_review {
  color: #3B82F6;
}

.status-glyph.in_progress {
  color: #D97706;
}

.status-glyph.todo {
  color: #8E8A82;
}

.status-glyph.backlog {
  color: #8B8862;
}

.status-glyph.done {
  color: #22C55E;
}

.status-glyph.on-pill {
  color: currentColor;
}

.done-chk {
  stroke: #FFFFFF;
}

.status-glyph.on-pill .done-chk {
  stroke: var(--pill-done-chk, #B8E7BE);
}

:global(html[data-ws-theme='dark']) .status-glyph.todo {
  color: rgba(242, 240, 235, 0.48);
}

:global(html[data-ws-theme='dark']) .status-glyph.backlog {
  color: #C7BA6B;
}
</style>
