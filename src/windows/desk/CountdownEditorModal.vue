<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FColorSwatches, FDatePicker, FIcon, TASK_COLORS, taskColor } from '@/fluent';
import type { CountdownMode, RepeatRule, Task } from '@/types';
import { today } from '@/lib/date';
import { describeCustomCountdown } from '@/lib/countdown';
import { displayInfo as dayInfo } from '@/lib/lunar';
import { addTask, deleteTask, saveTask } from '@/lib/tasks';
import { now } from '@/composables/now';
import { isDark } from '@/composables/theme';
import { notify } from './state';

const props = defineProps<{
  open: boolean;
  task?: Task | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [task: Task];
}>();

type RepeatChoice = 'none' | 'yearly' | 'lunarYearly';

const titleRef = ref<HTMLInputElement>();
const title = ref('');
const mode = ref<CountdownMode>('down');
const date = ref(today());
const repeatChoice = ref<RepeatChoice>('none');
const color = ref('');
const pinned = ref(false);
const showInCal = ref(false);
const notes = ref('');
const saving = ref(false);

const isEdit = computed(() => !!props.task);

watch(
  () => [props.open, props.task] as const,
  async ([isOpen, t]) => {
    if (!isOpen) return;
    if (t) {
      title.value = t.title;
      mode.value = t.countdownMode === 'up' ? 'up' : 'down';
      date.value = t.start;
      repeatChoice.value =
        t.repeat?.freq === 'lunarYearly'
          ? 'lunarYearly'
          : t.repeat?.freq === 'yearly'
            ? 'yearly'
            : 'none';
      color.value = t.color ?? '';
      pinned.value = !!t.countdownPinned;
      showInCal.value = !t.countdownOnly;
      notes.value = t.notes ?? '';
    } else {
      title.value = '';
      mode.value = 'down';
      date.value = today();
      repeatChoice.value = 'none';
      color.value = '';
      pinned.value = false;
      showInCal.value = false;
      notes.value = '';
    }
    await nextTick();
    titleRef.value?.focus();
    titleRef.value?.select();
  },
);

const repeatRule = computed<RepeatRule | undefined>(() => {
  if (mode.value !== 'down' || repeatChoice.value === 'none') return undefined;
  return { freq: repeatChoice.value, interval: 1 };
});

const preview = computed(() => {
  const virtual: Task = {
    id: props.task?.id ?? 'preview',
    title: title.value.trim() || '预览',
    start: date.value,
    end: date.value,
    progress: 0,
    done: false,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    countdown: true,
    countdownMode: mode.value,
    repeat: repeatRule.value,
  };
  return describeCustomCountdown(virtual, now.value);
});

const previewLabel = computed(() => {
  const p = preview.value;
  if (p.mode === 'up') {
    return p.days === 0 ? '从今天开始计天' : `已经过 ${p.days} 天`;
  }
  if (p.expired) {
    return `已过期 ${p.days} 天`;
  }
  if (p.days === 0) return '就是今天';
  return `还有 ${p.days} 天`;
});

const accentHex = computed(() =>
  color.value ? taskColor(color.value, isDark.value).bar : 'var(--accent-fill)',
);

const swatches = TASK_COLORS.map((c) => ({ key: c.key, color: c.bar, label: c.label }));
const lunarOf = (iso: string) => dayInfo(iso).text;
const markerOf = (iso: string) => {
  const l = dayInfo(iso).legal;
  return l ? (l.work ? '班' : '休') : undefined;
};

async function submit() {
  const cleanTitle = title.value.trim();
  if (!cleanTitle || saving.value) return;
  saving.value = true;
  try {
    const cleanNotes = notes.value.trim() || undefined;
    const cleanRepeat =
      mode.value === 'down'
        ? repeatChoice.value === 'none'
          ? props.task?.repeat && props.task.repeat.freq !== 'yearly' && props.task.repeat.freq !== 'lunarYearly'
            ? props.task.repeat
            : undefined
          : repeatRule.value
        : undefined;

    if (props.task) {
      const updated: Task = {
        ...props.task,
        title: cleanTitle,
        start: date.value,
        end: date.value,
        notes: cleanNotes,
        color: color.value || undefined,
        repeat: cleanRepeat,
        countdown: true,
        countdownOnly: showInCal.value ? undefined : true,
        countdownMode: mode.value,
        countdownPinned: pinned.value || undefined,
      };
      await saveTask(updated);
      emit('saved', updated);
    } else {
      const created = await addTask({
        title: cleanTitle,
        start: date.value,
        end: date.value,
        notes: cleanNotes,
        color: color.value || undefined,
        repeat: cleanRepeat,
        countdown: true,
        countdownOnly: showInCal.value ? undefined : true,
        countdownMode: mode.value,
        countdownPinned: pinned.value || undefined,
        reminders: undefined,
      });
      emit('saved', created);
    }
    emit('close');
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!props.task || saving.value) return;
  const target = props.task;
  saving.value = true;
  try {
    await deleteTask(target.id);
    notify(`已删除倒数日“${target.title}”`, true);
    emit('close');
  } finally {
    saving.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape' && !document.querySelector('.f-flyout, [role="menu"]')) {
    e.preventDefault();
    e.stopPropagation();
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <Transition name="cd-modal">
      <div v-if="open" class="cd-backdrop" role="dialog" aria-modal="true" :aria-label="isEdit ? '编辑倒数日' : '新建倒数日'" @mousedown.self="emit('close')">
        <form class="cd-dialog" @submit.prevent="submit">
          <div class="cd-head">
            <div class="cd-title-wrap">
              <span class="cd-color-dot" :style="{ background: accentHex }" />
              <h3>{{ isEdit ? '编辑倒数日' : '添加自定义倒数日' }}</h3>
            </div>
            <button type="button" class="cd-close" title="关闭" aria-label="关闭" @click="emit('close')">
              <FIcon name="close" :size="12" />
            </button>
          </div>

          <div class="cd-body">
            <div class="cd-field">
              <label for="cd-name-input">名称</label>
              <input
                id="cd-name-input"
                ref="titleRef"
                v-model="title"
                type="text"
                class="cd-text-input"
                placeholder="例如：春节回家、结婚纪念日、考研初试…"
                maxlength="120"
              />
            </div>

            <div class="cd-field">
              <label>计天方式</label>
              <div class="cd-seg" role="radiogroup" aria-label="计天方式">
                <button
                  type="button"
                  class="cd-seg-btn"
                  :class="{ active: mode === 'down' }"
                  @click="mode = 'down'"
                >
                  倒数日 · 距离还有
                </button>
                <button
                  type="button"
                  class="cd-seg-btn"
                  :class="{ active: mode === 'up' }"
                  @click="mode = 'up'"
                >
                  纪念日 · 已经过去
                </button>
              </div>
            </div>

            <div class="cd-field">
              <label>{{ mode === 'up' ? '起始日期' : '目标日期' }}</label>
              <div class="cd-date-row">
                <FDatePicker v-model="date" :lunar="lunarOf" :markers="markerOf" :width="168" />
                <span class="cd-preview-pill" :class="{ expired: preview.expired, up: preview.mode === 'up' }">
                  {{ previewLabel }}
                </span>
              </div>
              <div class="cd-lunar-hint">农历{{ dayInfo(date).lunarLabel }} · {{ dayInfo(date).ganzhiYear }}</div>
            </div>

            <div v-if="mode === 'down'" class="cd-field">
              <label>每年重复</label>
              <div class="cd-chips">
                <button
                  type="button"
                  class="cd-chip"
                  :class="{ active: repeatChoice === 'none' }"
                  @click="repeatChoice = 'none'"
                >
                  不重复
                </button>
                <button
                  type="button"
                  class="cd-chip"
                  :class="{ active: repeatChoice === 'yearly' }"
                  @click="repeatChoice = 'yearly'"
                >
                  每年（公历）
                </button>
                <button
                  type="button"
                  class="cd-chip"
                  :class="{ active: repeatChoice === 'lunarYearly' }"
                  @click="repeatChoice = 'lunarYearly'"
                >
                  每年（农历）
                </button>
              </div>
            </div>

            <div class="cd-field">
              <label>标签颜色</label>
              <FColorSwatches v-model="color" :colors="swatches" allow-none custom :size="22" />
            </div>

            <div class="cd-checks">
              <label class="cd-check-row">
                <input v-model="pinned" type="checkbox" />
                <span>置顶显示（优先展示在桌面底部和工作台顶部）</span>
              </label>
              <label class="cd-check-row">
                <input v-model="showInCal" type="checkbox" />
                <span>同时在日历格子中显示为普通事项</span>
              </label>
            </div>

            <div class="cd-field">
              <label for="cd-notes-input">备注（可选）</label>
              <textarea
                id="cd-notes-input"
                v-model="notes"
                rows="2"
                class="cd-textarea"
                placeholder="补充说明、纪念意义或准备清单…"
                maxlength="1000"
              />
            </div>
          </div>

          <div class="cd-foot">
            <button v-if="isEdit" type="button" class="cd-del-btn" :disabled="saving" @click="remove">
              <FIcon name="delete" :size="12" />
              <span>删除</span>
            </button>
            <span class="cd-grow" />
            <button type="button" class="cd-cancel-btn" @click="emit('close')">取消</button>
            <button type="submit" class="cd-save-btn" :disabled="!title.trim() || saving">
              {{ isEdit ? '保存更改' : '添加倒数日' }}
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(20, 18, 16, 0.34);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 20px;
}

.cd-dialog {
  width: 460px;
  max-width: 100%;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background: var(--card-fill-secondary, var(--solid-quarternary, #ffffff));
  background-color: var(--solid-quarternary, #ffffff);
  color: var(--text-primary, #1c1b19);
  border: 1px solid var(--surface-stroke-flyout, rgba(0, 0, 0, 0.1));
  box-shadow: var(--shadow-dialog, 0 24px 56px rgba(0, 0, 0, 0.22));
  overflow: hidden;
}

.cd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--divider, rgba(0, 0, 0, 0.08));
}

.cd-title-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
}

.cd-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}

.cd-head h3 {
  margin: 0;
  font-size: 15.5px;
  font-weight: 650;
}

.cd-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.cd-close:hover {
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.06));
  color: var(--text-primary);
}

.cd-body {
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.cd-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cd-field > label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.cd-text-input,
.cd-textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--control-stroke-secondary, rgba(0, 0, 0, 0.16));
  background: var(--control-fill-input-active, rgba(255, 255, 255, 0.72));
  color: var(--text-primary);
  font: inherit;
  padding: 8px 11px;
  outline: none;
  transition: border-color 140ms ease;
}

.cd-text-input:focus,
.cd-textarea:focus {
  border-color: var(--accent-fill);
}

.cd-textarea {
  resize: vertical;
  font-size: 13px;
}

.cd-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border-radius: 11px;
  background: var(--control-alt-fill-hover, rgba(0, 0, 0, 0.055));
  gap: 3px;
}

.cd-seg-btn {
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}

.cd-seg-btn.active {
  background: var(--solid-quarternary, #ffffff);
  color: var(--text-primary);
  font-weight: 650;
  box-shadow: var(--shadow-card, 0 1px 3px rgba(0, 0, 0, 0.08));
}

.cd-date-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.cd-preview-pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--control-alt-fill-hover, rgba(0, 0, 0, 0.06));
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.cd-preview-pill.up {
  background: rgba(16, 124, 16, 0.12);
  color: #0F7B0F;
}

.cd-preview-pill.expired {
  background: rgba(196, 43, 28, 0.11);
  color: #C42B1C;
}

.cd-lunar-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.cd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cd-chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--control-stroke, rgba(0, 0, 0, 0.1));
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.cd-chip.active {
  background: var(--accent-fill);
  border-color: var(--accent-fill);
  color: var(--text-on-accent);
}

.cd-checks {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 2px 0;
}

.cd-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-primary);
  cursor: pointer;
}

.cd-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 16px;
  border-top: 1px solid var(--divider, rgba(0, 0, 0, 0.08));
}

.cd-grow {
  flex: 1;
}

.cd-del-btn {
  height: 32px;
  padding: 0 11px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--critical, #c42b1c);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.cd-del-btn:hover {
  background: var(--critical-bg, #fde7e9);
}

.cd-cancel-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--control-stroke-secondary, rgba(0, 0, 0, 0.15));
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.cd-save-btn {
  height: 32px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--accent-fill, #1c1b19);
  color: var(--text-on-accent, #ffffff);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.cd-save-btn:disabled {
  opacity: 0.42;
  cursor: default;
}

.cd-modal-enter-active {
  transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cd-modal-leave-active {
  transition: opacity 140ms ease;
}

.cd-modal-enter-active .cd-dialog {
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease;
}

.cd-modal-leave-active .cd-dialog {
  transition: transform 140ms ease, opacity 140ms ease;
}

.cd-modal-enter-from,
.cd-modal-leave-to {
  opacity: 0;
}

.cd-modal-enter-from .cd-dialog {
  opacity: 0;
  transform: scale(0.955) translateY(8px);
}

.cd-modal-leave-to .cd-dialog {
  opacity: 0;
  transform: scale(0.97);
}
</style>
