<script setup lang="ts">
import { t as tr } from '@/i18n';
import { computed } from 'vue';
import { FIcon } from '@/fluent';

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const items = computed(() => [
  { value: 'list', label: tr('列表'), icon: 'list' },
  { value: 'day', label: '日', icon: 'today' },
  { value: 'multiday', label: '多日', icon: 'calendarWeek' },
  { value: 'month', label: tr('月'), icon: 'calendar' },
  { value: 'gantt', label: tr('甘特'), icon: 'gantt' },
]);

function isActive(val: string): boolean {
  if (val === 'month' && props.modelValue === 'weeks') return true;
  return props.modelValue === val;
}

function selectView(val: string) {
  emit('update:modelValue', val);
}
</script>

<template>
  <nav class="web-mobile-nav" :aria-label="tr('视图')">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      class="wmn-btn"
      :class="{ active: isActive(item.value) }"
      @click="selectView(item.value)"
    >
      <FIcon :name="item.icon" :size="16" />
      <span class="wmn-lbl">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.web-mobile-nav {
  position: fixed;
  left: 50%;
  bottom: max(10px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  width: calc(100% - 24px);
  max-width: 420px;
  z-index: 35;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 5px;
  border-radius: 20px;
  background: var(--flyout-fill);
  -webkit-backdrop-filter: blur(20px) saturate(145%);
  backdrop-filter: blur(20px) saturate(145%);
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-flyout);
}

.wmn-btn {
  height: 44px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 2px;
  font: inherit;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, transform 120ms ease;
}

.wmn-btn:active {
  transform: scale(0.95);
}

.wmn-btn.active {
  background: var(--subtle-fill-hover);
  color: var(--accent-text);
  font-weight: 600;
}

.wmn-lbl {
  font-size: 10.5px;
  line-height: 1.1;
  white-space: nowrap;
}
</style>
