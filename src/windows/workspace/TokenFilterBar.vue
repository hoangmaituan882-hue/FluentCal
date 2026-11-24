<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FGroupIcon, FIcon, place, taskColor } from '@/fluent';
import type { Group, TaskPriority, TaskStatus } from '@/types';
import { getGroupIcon } from '@/lib/groupIcons';
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  WORKSPACE_STATUS_ORDER,
} from '@/lib/taskMeta';
import { isDark } from '@/composables/theme';
import { useViewport } from '@/composables/useViewport';
import { doc } from '@/stores/doc';
import GroupSquircle from './GroupSquircle.vue';
import PriorityGlyph from './PriorityGlyph.vue';
import StatusGlyph from './StatusGlyph.vue';
import { useSlidingIndicator } from './useSlidingIndicator';
import {
  FACET_LABEL,
  FILTER_FACETS,
  formatTokenValueSummary,
  operatorLabel,
  toggleGroupQuickFilter,
  upsertFilterToken,
  type FilterField,
  type FilterToken,
} from './filterModel';

const props = withDefaults(
  defineProps<{
    tokens: FilterToken[];
    searchQuery: string;
    groupBy: 'status' | 'time';
    groups: Group[];
    hideGroupQuickRow?: boolean;
    hideGroupFacet?: boolean;
    showEmptyStatuses?: boolean;
  }>(),
  {
    hideGroupQuickRow: false,
    hideGroupFacet: false,
    showEmptyStatuses: undefined,
  },
);

const emit = defineEmits<{
  'update:tokens': [tokens: FilterToken[]];
  'update:searchQuery': [q: string];
  'update:groupBy': [mode: 'status' | 'time'];
  'update:showEmptyStatuses': [val: boolean];
}>();

const { isPhone } = useViewport();

const barRef = ref<HTMLElement>();
const inputRef = ref<HTMLInputElement>();
const filterBtnRef = ref<HTMLElement>();
const popoverRef = ref<HTMLElement>();
const popSearchRef = ref<HTMLInputElement>();
const segRef = ref<HTMLElement>();

const popOpen = ref(false);
const popStage = ref<'facet' | 'values'>('facet');
const popField = ref<FilterField>('status');
const popQuery = ref('');
const popActiveIdx = ref(0);
const popPos = ref({ left: 0, top: 0 });
const barFocused = ref(false);

watch([popOpen, popStage, popField, popQuery], () => {
  popActiveIdx.value = 0;
});

function setPopActiveIdx(idx: number) {
  popActiveIdx.value = idx;
}

function closePopover() {
  popOpen.value = false;
}

function onBackdropClick() {
  if (isPhone.value) popOpen.value = false;
}

function onEmptyToggleClick() {
  emit('update:showEmptyStatuses', !props.showEmptyStatuses);
}

const { style: segStyle, ready: segReady, visible: segVisible } = useSlidingIndicator(
  segRef,
  '.gb-btn.active',
  () => props.groupBy,
);

const activeGroupIds = computed(() => {
  const tok = props.tokens.find((t) => t.field === 'group');
  return new Set(tok?.values ?? []);
});

const facetPrimary = computed(() => {
  const q = popQuery.value.trim().toLowerCase();
  return FILTER_FACETS.filter((f) => {
    if (f.section !== 'primary') return false;
    if (props.hideGroupFacet && f.field === 'group') return false;
    return !q || f.label.toLowerCase().includes(q);
  });
});

const facetRelation = computed(() => {
  const q = popQuery.value.trim().toLowerCase();
  return FILTER_FACETS.filter((f) => f.section === 'relation' && (!q || f.label.toLowerCase().includes(q)));
});

const visibleFacets = computed(() => [...facetPrimary.value, ...facetRelation.value]);

interface ValueOption {
  value: string;
  label: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  group?: Group;
  colorDot?: string;
}

const valueOptions = computed<ValueOption[]>(() => {
  const f = popField.value;
  const q = popQuery.value.trim().toLowerCase();
  let opts: ValueOption[] = [];

  if (f === 'status') {
    opts = WORKSPACE_STATUS_ORDER.map((st) => ({
      value: st,
      label: STATUS_META[st].label,
      status: st,
    }));
  } else if (f === 'priority') {
    opts = PRIORITY_ORDER.map((pr) => ({
      value: pr,
      label: PRIORITY_META[pr].label,
      priority: pr,
    }));
  } else if (f === 'group') {
    opts = [
      { value: '__ungrouped__', label: '未分组', colorDot: '#9E9990' },
      ...props.groups.map((g) => ({
        value: g.id,
        label: g.name,
        group: g,
      })),
    ];
  } else {
    opts = [
      { value: 'yes', label: '是（满足此条件）', colorDot: '#3B82F6' },
      { value: 'no', label: '否（不满足此条件）', colorDot: '#9E9990' },
    ];
  }

  return q ? opts.filter((o) => o.label.toLowerCase().includes(q)) : opts;
});

const selectedForPopField = computed(() => {
  const tok = props.tokens.find((t) => t.field === popField.value);
  return new Set(tok?.values ?? []);
});

function positionPopover(anchorEl: HTMLElement | undefined) {
  if (isPhone.value || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  const p = place(
    { left: r.left, top: r.top, width: r.width, height: r.height },
    236,
    300,
    'bottom-start',
    6,
  );
  popPos.value = { left: p.left, top: p.top };
}

async function openFacetPicker(anchorEl?: HTMLElement) {
  if (popOpen.value && popStage.value === 'facet' && anchorEl === filterBtnRef.value) {
    popOpen.value = false;
    return;
  }
  popStage.value = 'facet';
  popQuery.value = '';
  popOpen.value = true;
  await nextTick();
  positionPopover(anchorEl ?? filterBtnRef.value ?? barRef.value);
  if (!isPhone.value) popSearchRef.value?.focus();
}

async function openValuePicker(field: FilterField, anchorEl?: HTMLElement) {
  popField.value = field;
  popStage.value = 'values';
  popQuery.value = '';
  popOpen.value = true;
  await nextTick();
  positionPopover(anchorEl ?? barRef.value);
  if (!isPhone.value) popSearchRef.value?.focus();
}

function chooseFacet(field: FilterField) {
  const def = FILTER_FACETS.find((x) => x.field === field);
  if (def?.kind === 'bool') {
    const existing = props.tokens.find((t) => t.field === field);
    if (!existing) {
      emit('update:tokens', upsertFilterToken(props.tokens, field, ['yes'], 'is'));
    }
  }
  void openValuePicker(field);
}

function toggleOptionValue(val: string) {
  const existing = props.tokens.find((t) => t.field === popField.value);
  const prev = existing?.values ?? [];
  const next = prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val];
  emit('update:tokens', upsertFilterToken(props.tokens, popField.value, next, existing?.op ?? 'is'));
}

function toggleTokenOperator(tok: FilterToken) {
  const nextOp = tok.op === 'is' ? 'is_not' : 'is';
  emit('update:tokens', upsertFilterToken(props.tokens, tok.field, tok.values, nextOp));
}

function removeToken(field: FilterField) {
  emit('update:tokens', upsertFilterToken(props.tokens, field, []));
}

function clearAllTokens() {
  emit('update:tokens', []);
  emit('update:searchQuery', '');
}

function onQuickGroupClick(groupId: string) {
  emit('update:tokens', toggleGroupQuickFilter(props.tokens, groupId));
}

function onSearchInput(e: Event) {
  emit('update:searchQuery', (e.target as HTMLInputElement).value);
}

function backToFacetStage() {
  popStage.value = 'facet';
  popQuery.value = '';
  void nextTick(() => popSearchRef.value?.focus());
}

function onPopoverKeyDown(e: KeyboardEvent) {
  const listLen = popStage.value === 'facet' ? visibleFacets.value.length : valueOptions.value.length;
  if (e.key === 'ArrowDown' && listLen > 0) {
    e.preventDefault();
    popActiveIdx.value = (popActiveIdx.value + 1) % listLen;
  } else if (e.key === 'ArrowUp' && listLen > 0) {
    e.preventDefault();
    popActiveIdx.value = (popActiveIdx.value - 1 + listLen) % listLen;
  } else if (e.key === 'Enter' && listLen > 0) {
    e.preventDefault();
    const idx = Math.max(0, Math.min(listLen - 1, popActiveIdx.value));
    if (popStage.value === 'facet') {
      const f = visibleFacets.value[idx];
      if (f) chooseFacet(f.field);
    } else {
      const opt = valueOptions.value[idx];
      if (opt) toggleOptionValue(opt.value);
    }
  } else if (e.key === 'Backspace' && popStage.value === 'values' && !popQuery.value) {
    e.preventDefault();
    backToFacetStage();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    popOpen.value = false;
    inputRef.value?.focus();
  }
}

function onInputKeyDown(e: KeyboardEvent) {
  if (e.key === 'Backspace' && !props.searchQuery && props.tokens.length) {
    const last = props.tokens[props.tokens.length - 1];
    removeToken(last.field);
  } else if (e.key === 'Enter' && !props.searchQuery.trim() && !popOpen.value) {
    e.preventDefault();
    void openFacetPicker(inputRef.value);
  } else if (e.key === 'Escape' && popOpen.value) {
    e.stopPropagation();
    popOpen.value = false;
  }
}

function onGlobalPointerDown(e: PointerEvent) {
  if (!popOpen.value) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (popoverRef.value?.contains(target) || filterBtnRef.value?.contains(target)) return;
  if (target instanceof Element && target.closest('.tfb-token')) return;
  popOpen.value = false;
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && popOpen.value) {
    e.preventDefault();
    e.stopPropagation();
    popOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onGlobalPointerDown, true);
  window.addEventListener('keydown', onGlobalKeyDown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGlobalPointerDown, true);
  window.removeEventListener('keydown', onGlobalKeyDown, true);
});

function groupHex(g: Group): string {
  return taskColor(g.color, isDark.value).bar;
}
</script>

<template>
  <div class="tfb-wrap">
    <!-- Row 1: = Filter pill + Colored Group Squircle Quick-Filters + Status/Time Switch -->
    <div class="tfb-top">
      <div class="tfb-top-left">
        <button
          ref="filterBtnRef"
          type="button"
          class="tfb-filter-btn"
          :class="{ open: popOpen }"
          @click="openFacetPicker(filterBtnRef)"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round">
            <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
          </svg>
          <span>筛选</span>
        </button>

        <template v-if="!hideGroupQuickRow && groups.length">
          <span class="tfb-vsep" aria-hidden="true" />
          <div class="tfb-quick-groups" role="group" aria-label="快捷分组筛选">
            <button
              v-for="g in groups.slice(0, 10)"
              :key="g.id"
              type="button"
              class="tfb-qg-btn"
              :title="activeGroupIds.has(g.id) ? `取消筛选「${g.name}」` : `筛选「${g.name}」`"
              @click="onQuickGroupClick(g.id)"
            >
              <GroupSquircle
                :name="g.name"
                :color-key="g.color"
                :icon="g.icon"
                :size="22"
                :active="activeGroupIds.has(g.id)"
              />
            </button>
          </div>
        </template>
      </div>

      <div class="tfb-top-right">
        <button
          v-if="groupBy === 'status' && showEmptyStatuses !== undefined"
          type="button"
          class="tfb-empty-toggle"
          :class="{ active: showEmptyStatuses }"
          :title="showEmptyStatuses ? '隐藏没有任务的状态分组' : '显示全部状态分组（含空状态）'"
          @click="onEmptyToggleClick"
        >
          <span>{{ showEmptyStatuses ? '隐藏空组' : '显示空组' }}</span>
        </button>

        <div ref="segRef" class="gb-seg" role="radiogroup" aria-label="列表分组方式">
          <span
            v-if="segVisible"
            class="ws-slide-pill gb-seg-pill"
            :class="{ 'no-anim': !segReady }"
            :style="segStyle"
            aria-hidden="true"
          />
          <button
            type="button"
            class="gb-btn"
            :class="{ active: groupBy === 'status' }"
            @click="emit('update:groupBy', 'status')"
          >
            按状态
          </button>
          <button
            type="button"
            class="gb-btn"
            :class="{ active: groupBy === 'time' }"
            @click="emit('update:groupBy', 'time')"
          >
            按时间
          </button>
        </div>
      </div>
    </div>

    <!-- Row 2: Blue-ring Tokenized Compound Filter Input Bar -->
    <div
      ref="barRef"
      class="tfb-bar"
      :class="{ focused: barFocused || popOpen }"
      @click="inputRef?.focus()"
    >
      <FIcon v-if="isPhone" name="search" :size="14" class="tfb-phone-search-ico" />
      <svg v-else class="tfb-sparkle" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.5 9.35 5.65 13.5 7 9.35 8.35 8 12.5 6.65 8.35 2.5 7 6.65 5.65Z"
          fill="url(#tfbSpark)"
        />
        <circle cx="12.5" cy="11.8" r="1.2" fill="#818CF8" opacity="0.85" />
        <defs>
          <linearGradient id="tfbSpark" x1="2.5" y1="1.5" x2="13.5" y2="12.5" gradientUnits="userSpaceOnUse">
            <stop stop-color="#A855F7" />
            <stop offset="1" stop-color="#3B82F6" />
          </linearGradient>
        </defs>
      </svg>

      <!-- Active 3-part Token Pills -->
      <div v-for="tok in tokens" :key="tok.id" class="tfb-token" @click.stop>
        <span class="tok-field" @click="openValuePicker(tok.field, $event.currentTarget as HTMLElement)">
          <PriorityGlyph v-if="tok.field === 'priority'" priority="high" :size="12" />
          <StatusGlyph v-else-if="tok.field === 'status'" status="in_review" :size="12" />
          <FIcon v-else-if="tok.field === 'group'" name="group" :size="11" />
          <FIcon v-else-if="tok.field === 'starred'" name="starFill" :size="11" />
          <FIcon v-else-if="tok.field === 'countdown'" name="flag" :size="11" />
          <FIcon v-else name="filter" :size="11" />
          <span>{{ FACET_LABEL[tok.field] }}</span>
        </span>
        <button
          type="button"
          class="tok-op"
          title="点击切换「属于」/「排除」"
          @click="toggleTokenOperator(tok)"
        >
          {{ operatorLabel(tok.op, tok.values.length) }}
        </button>
        <button
          type="button"
          class="tok-val"
          title="修改筛选项"
          @click="openValuePicker(tok.field, $event.currentTarget as HTMLElement)"
        >
          {{ formatTokenValueSummary(tok, doc.groups) }}
        </button>
        <button type="button" class="tok-x" title="移除条件" @click="removeToken(tok.field)">
          <FIcon name="close" :size="8" />
        </button>
      </div>

      <input
        ref="inputRef"
        :value="searchQuery"
        type="text"
        class="tfb-input"
        :placeholder="isPhone ? '搜索任务…' : tokens.length ? '继续输入关键词或点击左侧“筛选”…' : '筛选或搜索任务标题、编号、备注…'"
        @focus="barFocused = true"
        @blur="barFocused = false"
        @input="onSearchInput"
        @keydown="onInputKeyDown"
      />

      <button
        v-if="tokens.length || searchQuery"
        type="button"
        class="tfb-clear-all"
        title="清空所有筛选条件"
        @click.stop="clearAllTokens"
      >
        清除
      </button>
    </div>

    <!-- Cascading Dual-Stage Concentric Filter Popover / Mobile Bottom Sheet -->
    <Teleport to="body">
      <Transition :name="isPhone ? 'tfb-sheet' : 'tfb-pop'">
        <div
          v-if="popOpen"
          :class="isPhone ? 'tfb-sheet-backdrop' : 'tfb-pop-layer'"
          @click.self="onBackdropClick"
        >
          <div
            ref="popoverRef"
            :class="isPhone ? 'tfb-sheet-card' : 'tfb-popover'"
            :style="isPhone ? undefined : { left: `${popPos.left}px`, top: `${popPos.top}px` }"
            :role="isPhone ? 'dialog' : undefined"
            :aria-modal="isPhone ? 'true' : undefined"
            aria-label="筛选条件"
            @contextmenu.prevent
          >
            <div v-if="isPhone" class="tfb-sheet-grab" aria-hidden="true" />
            <!-- Stage 1: Facet Picker -->
            <template v-if="popStage === 'facet'">
              <div class="pop-search">
                <FIcon name="search" :size="13" class="pop-s-ico" />
                <input
                  ref="popSearchRef"
                  v-model="popQuery"
                  type="text"
                  class="pop-s-input"
                  placeholder="筛选维度…"
                  @keydown="onPopoverKeyDown"
                />
              </div>

              <div class="pop-list">
                <button
                  v-for="(f, idx) in facetPrimary"
                  :key="f.field"
                  type="button"
                  class="pop-item"
                  :class="{ highlighted: popActiveIdx === idx }"
                  @mouseenter="setPopActiveIdx(idx)"
                  @click="chooseFacet(f.field)"
                >
                  <span class="pop-lvis">
                    <StatusGlyph v-if="f.field === 'status'" status="backlog" :size="14" />
                    <PriorityGlyph v-else-if="f.field === 'priority'" priority="medium" :size="14" />
                    <FIcon v-else-if="f.field === 'group'" name="group" :size="13" />
                    <FIcon v-else name="star" :size="13" />
                  </span>
                  <span class="pop-lbl">{{ f.label }}</span>
                  <FIcon name="chevronRight" :size="10" class="pop-chev" />
                </button>

                <div v-if="facetPrimary.length && facetRelation.length" class="pop-sep" />

                <button
                  v-for="(f, idx) in facetRelation"
                  :key="f.field"
                  type="button"
                  class="pop-item"
                  :class="{ highlighted: popActiveIdx === facetPrimary.length + idx }"
                  @mouseenter="setPopActiveIdx(facetPrimary.length + idx)"
                  @click="chooseFacet(f.field)"
                >
                  <span class="pop-lvis">
                    <FIcon v-if="f.field === 'has_subtasks'" name="checklist" :size="13" />
                    <FIcon v-else-if="f.field === 'countdown'" name="flag" :size="13" />
                    <FIcon v-else-if="f.field === 'blocked'" name="error" :size="13" class="rel-danger" />
                    <FIcon v-else name="warning" :size="13" class="rel-warn" />
                  </span>
                  <span class="pop-lbl">{{ f.label }}</span>
                  <FIcon name="chevronRight" :size="10" class="pop-chev" />
                </button>

                <div v-if="!facetPrimary.length && !facetRelation.length" class="pop-empty">无匹配维度</div>
              </div>
            </template>

            <!-- Stage 2: Multi-Select Option Picker with Blue Rounded Checkboxes -->
            <template v-else>
              <div class="pop-sub-head">
                <button type="button" class="pop-back" @click="backToFacetStage">
                  <FIcon name="chevronLeft" :size="10" />
                  <span>{{ FACET_LABEL[popField] }}</span>
                </button>
                <button
                  v-if="selectedForPopField.size"
                  type="button"
                  class="pop-reset"
                  @click="removeToken(popField)"
                >
                  清空
                </button>
              </div>

              <div class="pop-search compact">
                <FIcon name="search" :size="12" class="pop-s-ico" />
                <input
                  ref="popSearchRef"
                  v-model="popQuery"
                  type="text"
                  class="pop-s-input"
                  placeholder="搜索选项…"
                  @keydown="onPopoverKeyDown"
                />
              </div>

              <div class="pop-list">
                <button
                  v-for="(opt, idx) in valueOptions"
                  :key="opt.value"
                  type="button"
                  class="pop-item multi"
                  :class="{ checked: selectedForPopField.has(opt.value), highlighted: popActiveIdx === idx }"
                  @mouseenter="setPopActiveIdx(idx)"
                  @click="toggleOptionValue(opt.value)"
                >
                  <span class="pop-chk" :class="{ checked: selectedForPopField.has(opt.value) }">
                    <svg v-if="selectedForPopField.has(opt.value)" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M2.2 6.3 4.8 9 9.8 3.5" />
                    </svg>
                  </span>

                  <span class="pop-lvis">
                    <StatusGlyph v-if="opt.status" :status="opt.status" :size="14" />
                    <PriorityGlyph v-else-if="opt.priority" :priority="opt.priority" :size="14" />
                    <FGroupIcon
                      v-else-if="opt.group && getGroupIcon(opt.group.icon)"
                      :icon="opt.group.icon"
                      :color="groupHex(opt.group)"
                      :size="14"
                    />
                    <GroupSquircle
                      v-else-if="opt.group"
                      :name="opt.group.name"
                      :color-key="opt.group.color"
                      :size="17"
                    />
                    <span v-else-if="opt.colorDot" class="pop-dot" :style="{ background: opt.colorDot }" />
                  </span>

                  <span class="pop-lbl">{{ opt.label }}</span>
                </button>
                <div v-if="!valueOptions.length" class="pop-empty">无匹配选项</div>
              </div>
            </template>

            <footer v-if="isPhone" class="tfb-sheet-foot">
              <button v-if="tokens.length || searchQuery" type="button" class="tfb-sheet-clear" @click="clearAllTokens">
                重置条件
              </button>
              <span class="tfb-sheet-grow" />
              <button type="button" class="ws-cta-btn tfb-sheet-done" @click="closePopover">完成</button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.tfb-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tfb-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.tfb-top-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.tfb-filter-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  box-shadow: var(--ws-shadow-sm);
  transition: background-color 130ms ease, border-color 130ms ease;
}

.tfb-filter-btn:hover,
.tfb-filter-btn.open {
  border-color: var(--ws-hairline-strong);
  background: var(--ws-card-hover);
}

.tfb-vsep {
  width: 1px;
  height: 16px;
  background: var(--ws-hairline);
}

.tfb-quick-groups {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.tfb-qg-btn {
  position: relative;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  border-radius: 7px;
  box-shadow: 0 0 0 1.5px var(--ws-card-bg);
  transition: transform 130ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tfb-qg-btn:hover {
  z-index: 2;
  transform: translateY(-1px) scale(1.08);
}

.tfb-top-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.tfb-empty-toggle {
  height: 26px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}

.tfb-empty-toggle:hover {
  background: var(--ws-stone-pill);
  color: var(--ws-ink);
}

.tfb-empty-toggle.active {
  background: var(--ws-stone-pill);
  border-color: var(--ws-hairline-strong);
  color: var(--ws-ink);
}

.gb-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--ws-stone-pill, rgba(28, 25, 23, 0.06));
}

.gb-seg-pill {
  border-radius: 7px;
  background: var(--ws-card-bg);
  box-shadow: var(--ws-shadow-sm);
}

.gb-btn {
  position: relative;
  z-index: 1;
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  transition: color 140ms ease;
}

.gb-btn.active {
  color: var(--ws-ink);
  font-weight: 600;
}

/* Blue-ringed compound token input bar */
.tfb-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 36px;
  padding: 4px 10px;
  border-radius: 10px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  cursor: text;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.tfb-bar.focused {
  border-color: #60A5FA;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}

.tfb-sparkle {
  flex: none;
}

.tfb-phone-search-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.tfb-token {
  display: inline-flex;
  align-items: stretch;
  height: 24px;
  border-radius: 6px;
  background: var(--ws-card-subtle);
  border: 1px solid var(--ws-hairline-strong);
  overflow: hidden;
  font-size: 12px;
  color: var(--ws-ink);
}

.tok-field,
.tok-op,
.tok-val,
.tok-x {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0 7px;
}

.tok-field {
  font-weight: 550;
  cursor: pointer;
  border-right: 1px solid var(--ws-hairline);
}

.tok-field:hover {
  background: var(--ws-pill-bg);
}

.tok-op {
  color: var(--ws-ink-secondary);
  font-size: 11.5px;
  font-style: italic;
  background: var(--ws-stone-pill);
  cursor: pointer;
  border-right: 1px solid var(--ws-hairline);
}

.tok-op:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.tok-val {
  font-weight: 550;
  cursor: pointer;
  border-right: 1px solid var(--ws-hairline);
}

.tok-val:hover {
  background: var(--ws-pill-bg);
}

.tok-x {
  padding: 0 6px;
  color: var(--ws-ink-muted);
  cursor: pointer;
}

.tok-x:hover {
  background: var(--ws-pill-hover);
  color: var(--ws-ink);
}

.tfb-input {
  flex: 1 1 120px;
  min-width: 100px;
  height: 26px;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.tfb-clear-all {
  border: 0;
  background: transparent;
  color: var(--ws-ink-muted);
  font: inherit;
  font-size: 11.5px;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.tfb-clear-all:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

/* Dual-stage concentric filter popover */
.tfb-popover {
  position: fixed;
  z-index: 85;
  width: 236px;
  padding: 5px;
  border-radius: 13px;
  background: var(--ws-card-bg);
  border: 1px solid var(--ws-hairline-strong);
  box-shadow:
    0 14px 36px -4px rgba(15, 14, 13, 0.16),
    0 4px 10px -2px rgba(15, 14, 13, 0.06);
  color: var(--ws-ink);
  font-family: var(--font-ui);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pop-sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px;
}

.pop-back,
.pop-reset {
  border: 0;
  background: transparent;
  color: var(--ws-ink-secondary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.pop-back:hover,
.pop-reset:hover {
  background: var(--ws-pill-bg);
  color: var(--ws-ink);
}

.pop-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  background: var(--ws-card-subtle);
}

.pop-search.compact {
  height: 27px;
}

.pop-s-ico {
  color: var(--ws-ink-muted);
  flex: none;
}

.pop-s-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}

.pop-list {
  max-height: 248px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pop-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ws-ink);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background-color 90ms ease;
}

.pop-item:hover,
.pop-item.highlighted {
  background: var(--ws-pill-bg);
}

.pop-item.multi.checked {
  font-weight: 550;
}

.pop-chk {
  width: 15px;
  height: 15px;
  border-radius: 4.5px;
  border: 1.4px solid var(--ws-check-border, rgba(28, 25, 23, 0.28));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  transition: background-color 110ms ease, border-color 110ms ease;
}

.pop-chk.checked {
  background: #3B82F6;
  border-color: #3B82F6;
}

.pop-lvis {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.pop-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.pop-lbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pop-chev {
  color: var(--ws-ink-muted);
}

.pop-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--ws-hairline);
}

.pop-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--ws-ink-muted);
}

.rel-danger {
  color: #E5484D;
}

.rel-warn {
  color: #D97706;
}

.tfb-pop-layer {
  position: fixed;
  inset: 0;
  z-index: 85;
  pointer-events: none;
}

.tfb-pop-layer .tfb-popover {
  pointer-events: auto;
}

.tfb-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 85;
  background: var(--ws-scrim-bg, rgba(18, 17, 15, 0.3));
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
}

.tfb-sheet-card {
  width: 100%;
  max-height: 76dvh;
  background: var(--ws-card-bg);
  color: var(--ws-ink);
  border-top: 1px solid var(--ws-hairline);
  border-radius: 22px 22px 0 0;
  box-shadow: var(--ws-shadow-float);
  padding: 8px 14px max(12px, env(safe-area-inset-bottom));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tfb-sheet-grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--ws-hairline-strong);
  margin: 0 auto 2px;
  flex: none;
}

.tfb-sheet-card .pop-search {
  height: 36px;
  border-radius: 10px;
}

.tfb-sheet-card .pop-list {
  max-height: 48dvh;
  gap: 3px;
}

.tfb-sheet-card .pop-item {
  min-height: 42px;
  height: auto;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 13.5px;
}

.tfb-sheet-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ws-hairline);
}

.tfb-sheet-grow {
  flex: 1;
}

.tfb-sheet-clear {
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--ws-hairline);
  background: transparent;
  color: var(--ws-ink-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.tfb-sheet-done {
  height: 36px;
  padding: 0 20px;
}

.tfb-pop-enter-active {
  transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1), transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tfb-pop-leave-active {
  transition: opacity 100ms ease;
}

.tfb-pop-enter-from,
.tfb-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}

.tfb-sheet-enter-active {
  transition: opacity 220ms var(--ws-ease-out);
}

.tfb-sheet-leave-active {
  pointer-events: none;
  transition: opacity 150ms ease;
}

.tfb-sheet-enter-active .tfb-sheet-card {
  transition: transform 240ms var(--ws-ease-out);
}

.tfb-sheet-leave-active .tfb-sheet-card {
  transition: transform 150ms ease;
}

.tfb-sheet-enter-from,
.tfb-sheet-leave-to {
  opacity: 0;
}

.tfb-sheet-enter-from .tfb-sheet-card,
.tfb-sheet-leave-to .tfb-sheet-card {
  transform: translateY(28px);
}

@media (max-width: 639px) {
  .tfb-quick-groups {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px 0;
  }

  .tfb-quick-groups::-webkit-scrollbar {
    display: none;
  }

  .tfb-bar {
    min-height: 40px;
    border-radius: 12px;
    padding: 5px 10px;
  }
}
</style>
