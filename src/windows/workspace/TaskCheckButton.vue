<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    checked: boolean;
    inProgress?: boolean;
    accentColor?: string;
    size?: number;
    label?: string;
  }>(),
  {
    inProgress: false,
    accentColor: '',
    size: 19,
    label: '切换完成状态',
  },
);

const emit = defineEmits<{
  toggle: [e: MouseEvent];
}>();

const bursting = ref(false);
let burstTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.checked,
  (next, prev) => {
    if (next && !prev) {
      bursting.value = false;
      clearTimeout(burstTimer);
      requestAnimationFrame(() => {
        bursting.value = true;
        burstTimer = setTimeout(() => {
          bursting.value = false;
        }, 480);
      });
    }
  },
);

onBeforeUnmount(() => {
  clearTimeout(burstTimer);
});

function onClick(e: MouseEvent) {
  e.stopPropagation();
  emit('toggle', e);
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    class="t-check tcb-btn"
    :class="{
      done: checked,
      'in-progress': !checked && inProgress,
      bursting,
    }"
    :aria-checked="checked ? 'true' : 'false'"
    :aria-label="label"
    :style="{
      '--tcb-size': `${size}px`,
      '--tcb-accent': accentColor || 'var(--ws-ink)',
    }"
    @click="onClick"
  >
    <svg class="tcb-svg" viewBox="0 0 12 12" aria-hidden="true">
      <path class="tcb-path" d="M2.2 6.3L4.9 9L9.8 3.2" />
    </svg>
    <span v-if="bursting" class="tcb-sparks" aria-hidden="true">
      <i v-for="n in 5" :key="n" :style="{ '--i': n }" />
    </span>
  </button>
</template>

<style scoped>
.tcb-btn {
  position: relative;
  width: var(--tcb-size, 19px);
  height: var(--tcb-size, 19px);
  border-radius: 50%;
  border: 1.7px solid var(--ws-check-border);
  background: transparent;
  color: var(--ws-ink-inverse);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
  padding: 0;
  transition:
    background-color var(--check-box, 150ms) var(--check-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    border-color var(--check-box, 150ms) var(--check-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    box-shadow var(--check-box, 150ms) var(--check-ease, cubic-bezier(0.22, 1, 0.36, 1)),
    transform 240ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

.tcb-btn:hover {
  border-color: var(--tcb-accent, var(--ws-ink));
  background: color-mix(in srgb, var(--tcb-accent, var(--ws-ink)) 8%, transparent);
}

.tcb-btn:active {
  transform: scale(0.84);
}

.tcb-btn.in-progress {
  border-style: dashed;
  border-color: var(--ws-progress-ink);
  background: var(--ws-progress-bg);
}

.tcb-btn.done {
  background: var(--tcb-accent, var(--ws-ink));
  border-color: var(--tcb-accent, var(--ws-ink));
  box-shadow: 0 2px 7px color-mix(in srgb, var(--tcb-accent, var(--ws-ink)) 28%, transparent);
}

.tcb-btn.bursting {
  animation: tcb-pop 340ms var(--ease-bounce, cubic-bezier(0.34, 1.36, 0.64, 1));
}

@keyframes tcb-pop {
  0% {
    transform: scale(0.82);
  }
  52% {
    transform: scale(1.14);
  }
  100% {
    transform: scale(1);
  }
}

.tcb-svg {
  width: 62%;
  height: 62%;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  overflow: visible;
}

.tcb-path {
  stroke-dasharray: 14;
  stroke-dashoffset: 14;
  transition: stroke-dashoffset var(--check-uncheck, 150ms) var(--check-ease, cubic-bezier(0.22, 1, 0.36, 1));
}

.tcb-btn.done .tcb-path {
  stroke-dashoffset: 0;
  transition: stroke-dashoffset var(--check-draw, 320ms) var(--check-ease, cubic-bezier(0.22, 1, 0.36, 1)) var(--check-delay, 70ms);
}

.tcb-sparks {
  position: absolute;
  inset: 50%;
  pointer-events: none;
}

.tcb-sparks i {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--tcb-accent, var(--ws-ink));
  left: -1.5px;
  top: -1.5px;
  opacity: 0;
  animation: tcb-spark 420ms var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)) 60ms forwards;
}

@keyframes tcb-spark {
  0% {
    opacity: 0.9;
    transform: rotate(calc(var(--i) * 72deg - 24deg)) translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: rotate(calc(var(--i) * 72deg - 24deg)) translateY(-13px) scale(0.3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tcb-btn,
  .tcb-path,
  .tcb-sparks i {
    animation: none !important;
    transition: none !important;
  }
}
</style>
