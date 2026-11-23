<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import FIcon from './FIcon.vue';
import type { MenuItem, MenuPlacement } from './menu';
import { isMovingTowardSubmenu, type Point2D, type RectBox } from './menuGeometry';
import { uid } from './field';
import { anchorRect, place, pushPopup, type Anchor } from './placement';
import { bestTextOn } from './theme';

const props = defineProps<{
  items: MenuItem[];
  anchor: Anchor;
  placement: MenuPlacement;
  depth: number;
  /** Opened from the keyboard: highlight the first item. */
  keyboard?: boolean;
}>();

const emit = defineEmits<{
  'close-all': [];
  'close-self': [];
  'pointer-in': [];
  'panel-el': [el: HTMLElement | undefined];
  'panel-side': [side: 'left' | 'right'];
}>();

const panel = ref<HTMLElement>();
const listRef = ref<HTMLElement>();
const hi = ref(-1);
const sub = ref(-1);
const subAnchor = ref<DOMRect | null>(null);
const subKeyboard = ref(false);
const subPanelEl = ref<HTMLElement | undefined>(undefined);
const subPanelSide = ref<'left' | 'right'>('right');
const swatchHi = ref(-1);
const side = ref('bottom');

const hiTop = ref(0);
const hiHeight = ref(30);
const hiVisible = ref(false);
const hiAnim = ref(false);

let release: (() => void) | null = null;
let timer = 0;
let hiRaf = 0;
let prevPtr: Point2D | null = null;
const pid = uid('fm');

function activeId(): string | undefined {
  const it = props.items[hi.value];
  if (!it) return undefined;
  if (it.swatches) return swatchHi.value >= 0 ? `${pid}-${hi.value}-${swatchHi.value}` : undefined;
  return `${pid}-${hi.value}`;
}

const hasLeftVisual = computed(() =>
  props.items.some((i) => !i.swatches && !i.separator && !i.header && (!!i.icon || !!i.svgPaths?.length || !!i.colorDot)),
);

const enabled = (i: number) => {
  const it = props.items[i];
  return !!it && !it.separator && !it.header && !it.disabled;
};

const isNone = (c: string) => !c || c === 'transparent';

const effectiveHi = computed(() => {
  if (hi.value >= 0) return hi.value;
  return sub.value >= 0 ? sub.value : -1;
});

const hiDanger = computed(() => {
  const it = props.items[effectiveHi.value];
  return !!it?.danger;
});

function measureHi() {
  const idx = effectiveHi.value;
  const it = props.items[idx];
  const container = listRef.value;
  if (idx < 0 || !it || it.swatches || it.separator || it.header || !container) {
    hiVisible.value = false;
    hiAnim.value = false;
    return;
  }
  const rowEl = container.querySelector<HTMLElement>(`[data-i="${idx}"]`);
  if (!rowEl) {
    hiVisible.value = false;
    return;
  }
  const wasVisible = hiVisible.value;
  hiTop.value = rowEl.offsetTop;
  hiHeight.value = rowEl.offsetHeight;
  hiVisible.value = true;
  if (!wasVisible) {
    hiAnim.value = false;
    if (typeof cancelAnimationFrame !== 'undefined' && hiRaf) cancelAnimationFrame(hiRaf);
    if (typeof requestAnimationFrame !== 'undefined') {
      hiRaf = requestAnimationFrame(() => {
        hiAnim.value = true;
      });
    } else {
      hiAnim.value = true;
    }
  }
}

watch(effectiveHi, () => nextTick(measureHi), { flush: 'post' });

watch(hi, (idx) => {
  if (idx >= 0) {
    props.items[idx]?.onHover?.();
  }
});

function position() {
  const el = panel.value;
  if (!el) return;
  const a = anchorRect(props.anchor);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const isSub = props.depth > 0 || props.placement === 'right-start';
  const p = isSub
    ? place({ ...a, top: a.top - 5 }, w, h, 'right-start', -3)
    : place(a, w, h, props.placement, a.width ? 4 : 0);
  // Context menus at a point open to the left of the cursor when there is no room on the right.
  if (!isSub && a.width === 0 && p.left < a.left) p.left = Math.max(8, a.left - w);
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
  side.value = p.side;
  emit('panel-side', p.side === 'left' ? 'left' : 'right');
}

function firstEnabled(from = -1, dir: 1 | -1 = 1): number {
  const n = props.items.length;
  for (let k = 1; k <= n; k++) {
    const j = (from + dir * k + n * 2) % n;
    if (enabled(j)) return j;
  }
  return -1;
}

onMounted(() => {
  position();
  emit('panel-el', panel.value);
  const anchorEl = props.depth === 0 && props.anchor instanceof HTMLElement ? props.anchor : null;
  release = pushPopup({
    el: () => panel.value,
    close: () => (props.depth === 0 ? emit('close-all') : emit('close-self')),
    anchor: anchorEl ? () => anchorEl : undefined,
  });
  if (props.keyboard) hi.value = firstEnabled();
  nextTick(() => {
    measureHi();
    panel.value?.focus({ preventScroll: true });
  });
});

onBeforeUnmount(() => {
  release?.();
  clearTimeout(timer);
  if (typeof cancelAnimationFrame !== 'undefined' && hiRaf) cancelAnimationFrame(hiRaf);
  emit('panel-el', undefined);
});

watch(sub, (v) => v < 0 && panel.value?.focus({ preventScroll: true }));

function openSub(i: number, keyboard: boolean) {
  const el = panel.value?.querySelector<HTMLElement>(`[data-i="${i}"]`);
  if (!el) return;
  subAnchor.value = el.getBoundingClientRect();
  subKeyboard.value = keyboard;
  sub.value = i;
}

function onPanelPointerMove(e: PointerEvent) {
  const x = e.clientX;
  const y = e.clientY;
  if (!prevPtr) {
    prevPtr = { x, y };
    return;
  }
  if (Math.hypot(x - prevPtr.x, y - prevPtr.y) >= 2) {
    prevPtr = { x, y };
  }
}

function commitEnter(i: number) {
  if (!enabled(i)) return;
  hi.value = i;
  swatchHi.value = -1;
  const it = props.items[i];
  if (it.children?.length) {
    if (sub.value !== i) {
      timer = window.setTimeout(() => openSub(i, false), 90);
    }
  } else if (sub.value >= 0) {
    timer = window.setTimeout(() => {
      sub.value = -1;
    }, 45);
  }
}

function enter(i: number, e?: PointerEvent) {
  clearTimeout(timer);
  if (!enabled(i)) return;

  if (sub.value >= 0 && sub.value !== i && e && subPanelEl.value) {
    const r = subPanelEl.value.getBoundingClientRect();
    const box: RectBox = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (isMovingTowardSubmenu(prevPtr, { x: e.clientX, y: e.clientY }, box, subPanelSide.value)) {
      timer = window.setTimeout(() => commitEnter(i), 260);
      return;
    }
  }

  commitEnter(i);
}

function leave() {
  clearTimeout(timer);
  if (sub.value < 0) hi.value = -1;
}

function subPointerIn() {
  clearTimeout(timer);
  if (sub.value >= 0) hi.value = sub.value;
}

function closeSub() {
  sub.value = -1;
}

function onChildEl(el: HTMLElement | undefined) {
  subPanelEl.value = el;
}

function onChildSide(s: 'left' | 'right') {
  subPanelSide.value = s;
}

function activate(i: number, keyboard = false) {
  const it = props.items[i];
  if (!it || it.separator || it.header || it.disabled || it.swatches) return;
  if (it.children?.length) {
    openSub(i, keyboard);
    return;
  }
  emit('close-all');
  it.action?.();
}

function swatch(it: MenuItem, key: string) {
  emit('close-all');
  it.onSwatch?.(key);
}

function key(e: KeyboardEvent) {
  const it = props.items[hi.value];
  const move = (dir: 1 | -1) => {
    const j = firstEnabled(hi.value, dir);
    if (j >= 0) {
      hi.value = j;
      swatchHi.value = props.items[j].swatches ? 0 : -1;
    }
  };
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      move(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      move(-1);
      break;
    case 'Home':
      e.preventDefault();
      hi.value = -1;
      move(1);
      break;
    case 'End':
      e.preventDefault();
      hi.value = 0;
      move(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (it?.swatches) swatchHi.value = Math.min(it.swatches.length - 1, swatchHi.value + 1);
      else if (it?.children?.length) openSub(hi.value, true);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (it?.swatches) swatchHi.value = Math.max(0, swatchHi.value - 1);
      else if (props.depth > 0) emit('close-self');
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (it?.swatches && swatchHi.value >= 0) swatch(it, it.swatches[swatchHi.value].key);
      else if (hi.value >= 0) activate(hi.value, true);
      break;
    case 'Tab':
      e.preventDefault();
      emit('close-all');
      break;
  }
}
</script>

<template>
  <div
    ref="panel"
    class="f-menu"
    :class="{ 'is-sub': depth > 0 }"
    :data-side="side"
    :style="{ zIndex: 1100 + depth * 10 }"
    role="menu"
    tabindex="-1"
    :aria-activedescendant="activeId()"
    data-f-popup
    @keydown="key"
    @pointermove="onPanelPointerMove"
    @pointerenter="emit('pointer-in')"
    @pointerleave="leave"
    @contextmenu.prevent
  >
    <div ref="listRef" class="f-menu-list">
      <span
        v-if="hiVisible"
        class="f-menu-hi"
        :class="{ danger: hiDanger, anim: hiAnim }"
        :style="{ transform: `translate3d(0, ${hiTop}px, 0)`, height: `${hiHeight}px` }"
        aria-hidden="true"
      />

      <template v-for="(it, i) in items" :key="it.key ?? i">
        <div v-if="it.separator" class="sep" role="separator" />
        <div v-else-if="it.header" class="hdr" role="presentation">{{ it.header }}</div>
        <div
          v-else-if="it.swatches"
          class="swatch-row"
          role="group"
          :aria-label="it.label"
          :data-i="i"
          @pointerenter="enter(i, $event)"
        >
          <span v-if="it.label" class="sw-label">{{ it.label }}</span>
          <div class="sws">
            <button
              v-for="(s, k) in it.swatches"
              :id="`${pid}-${i}-${k}`"
              :key="s.key"
              type="button"
              role="menuitemradio"
              :aria-checked="!!s.selected"
              class="sw"
              :class="{ sel: s.selected, kb: i === hi && k === swatchHi, none: isNone(s.color) }"
              :style="isNone(s.color) ? undefined : { background: s.color, color: bestTextOn(s.color) }"
              :title="s.title"
              :aria-label="s.title ?? s.key"
              tabindex="-1"
              @click="swatch(it, s.key)"
            >
              <FIcon v-if="s.selected && !isNone(s.color)" name="checkMark" :size="10" />
            </button>
          </div>
        </div>
        <div
          v-else
          :id="`${pid}-${i}`"
          class="item"
          :class="{ active: i === effectiveHi, open: i === sub, disabled: it.disabled, danger: it.danger }"
          :data-i="i"
          :role="it.checked !== undefined ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'"
          :aria-checked="it.checked"
          :aria-disabled="it.disabled"
          :aria-haspopup="it.children?.length ? 'menu' : undefined"
          :aria-expanded="it.children?.length ? i === sub : undefined"
          @pointerenter="enter(i, $event)"
          @click="activate(i)"
        >
          <span v-if="hasLeftVisual" class="lvis" aria-hidden="true">
            <svg
              v-if="it.svgPaths?.length"
              class="lvis-svg"
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.35"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path v-for="(d, pi) in it.svgPaths" :key="pi" :d="d" />
            </svg>
            <span v-else-if="it.colorDot" class="lvis-dot" :style="{ background: it.colorDot }" />
            <FIcon v-else-if="it.icon" :name="it.icon" :size="14" />
          </span>

          <span class="lbl">{{ it.label }}</span>
          <span v-if="it.shortcut" class="sc">{{ it.shortcut }}</span>
          <span v-if="it.checked" class="r-chk" aria-hidden="true">
            <svg
              viewBox="0 0 12 12"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M2.2 6.4 4.8 9 9.8 3.5" />
            </svg>
          </span>
          <FIcon v-if="it.children?.length" name="chevronRight" :size="11" class="subi" />
        </div>
      </template>
    </div>
  </div>

  <MenuPanel
    v-if="sub >= 0 && items[sub]?.children"
    :items="items[sub].children!"
    :anchor="subAnchor"
    placement="right-start"
    :depth="depth + 1"
    :keyboard="subKeyboard"
    @close-all="emit('close-all')"
    @close-self="closeSub"
    @pointer-in="subPointerIn"
    @panel-el="onChildEl"
    @panel-side="onChildSide"
  />
</template>

<style scoped>
.f-menu {
  --menu-bg: rgba(252, 252, 251, 0.94);
  --menu-border: rgba(24, 24, 27, 0.085);
  --menu-shadow:
    0 12px 32px -4px rgba(15, 14, 13, 0.14),
    0 4px 10px -2px rgba(15, 14, 13, 0.06),
    0 0 0 0.5px rgba(15, 14, 13, 0.04);
  --menu-sub-shadow:
    0 18px 42px -6px rgba(15, 14, 13, 0.2),
    0 6px 16px -3px rgba(15, 14, 13, 0.09),
    0 0 0 0.5px rgba(15, 14, 13, 0.05);
  --menu-ink: #1C1B19;
  --menu-muted: rgba(28, 25, 23, 0.52);
  --menu-disabled: rgba(28, 25, 23, 0.32);
  --menu-sep: rgba(28, 25, 23, 0.075);
  --menu-hi-bg: #3B82F6;
  --menu-hi-danger: #E5484D;
  --menu-hi-ink: #FFFFFF;
  --menu-danger: #D13438;

  position: fixed;
  left: 0;
  top: 0;
  min-width: 176px;
  max-width: min(360px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 5px;
  background: var(--menu-bg);
  -webkit-backdrop-filter: blur(26px) saturate(145%);
  backdrop-filter: blur(26px) saturate(145%);
  border: 1px solid var(--menu-border);
  border-radius: 13px;
  box-shadow: var(--menu-shadow);
  color: var(--menu-ink);
  font-family: var(--font-ui);
  font-size: 13px;
  user-select: none;
  scrollbar-width: thin;
  animation: f-menu-in 175ms cubic-bezier(0.22, 1, 0.36, 1);
}

.f-menu.is-sub {
  box-shadow: var(--menu-sub-shadow);
}

:global(html[data-theme='dark']) .f-menu {
  --menu-bg: rgba(26, 27, 32, 0.94);
  --menu-border: rgba(255, 255, 255, 0.105);
  --menu-shadow:
    0 16px 38px -4px rgba(0, 0, 0, 0.5),
    0 4px 12px -2px rgba(0, 0, 0, 0.28),
    0 0 0 0.5px rgba(255, 255, 255, 0.06);
  --menu-sub-shadow:
    0 24px 52px -6px rgba(0, 0, 0, 0.62),
    0 8px 20px -4px rgba(0, 0, 0, 0.38),
    0 0 0 0.5px rgba(255, 255, 255, 0.08);
  --menu-ink: #F2F0EB;
  --menu-muted: rgba(242, 240, 235, 0.54);
  --menu-disabled: rgba(242, 240, 235, 0.32);
  --menu-sep: rgba(255, 255, 255, 0.085);
  --menu-danger: #FF6B6B;
}

.f-menu[data-side='top'] { --mdy: 6px; }
.f-menu[data-side='left'] { --mdx: 6px; --mdy: 0px; }
.f-menu[data-side='right'] { --mdx: -6px; --mdy: 0px; }
.f-menu:focus-visible { outline: none; }

@keyframes f-menu-in {
  from {
    opacity: 0;
    transform: translate(var(--mdx, 0px), var(--mdy, -6px)) scale(0.965);
  }
}

.f-menu-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.f-menu-hi {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  border-radius: 8px;
  background: var(--menu-hi-bg);
  pointer-events: none;
  z-index: 0;
}

.f-menu-hi.anim {
  transition:
    transform 90ms cubic-bezier(0.22, 1, 0.36, 1),
    height 90ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 110ms ease;
}

.f-menu-hi.danger {
  background: var(--menu-hi-danger);
}

.item {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  white-space: nowrap;
  cursor: pointer;
  color: var(--menu-ink);
  transition: color 70ms ease;
}

.item.active {
  color: var(--menu-hi-ink);
}

.item:active:not(.disabled) {
  transform: scale(0.992);
}

.item.disabled {
  color: var(--menu-disabled);
  cursor: default;
}

.item.danger:not(.disabled):not(.active) {
  color: var(--menu-danger);
}

.lvis {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  opacity: 0.84;
}

.item.active .lvis {
  opacity: 1;
  color: var(--menu-hi-ink);
}

.lvis-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.item.active .lvis-dot {
  box-shadow: 0 0 0 1.2px rgba(255, 255, 255, 0.72);
}

.lbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 450;
}

.sc {
  margin-left: 18px;
  font-size: 11.5px;
  color: var(--menu-muted);
  font-variant-numeric: tabular-nums;
}

.item.active .sc {
  color: rgba(255, 255, 255, 0.86);
}

.item.disabled .sc {
  color: var(--menu-disabled);
}

.r-chk {
  margin-left: 10px;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--menu-ink);
}

.item.active .r-chk {
  color: var(--menu-hi-ink);
}

.subi {
  margin-left: 6px;
  color: var(--menu-muted);
  flex: none;
}

.item.active .subi {
  color: var(--menu-hi-ink);
}

.sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--menu-sep);
}

.hdr {
  padding: 5px 10px 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--menu-muted);
  letter-spacing: 0.02em;
}

.swatch-row {
  position: relative;
  z-index: 1;
  padding: 6px 10px 8px;
}

.sw-label {
  display: block;
  margin-bottom: 6px;
  font-size: 11.5px;
  line-height: 16px;
  color: var(--menu-muted);
}

.sws {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 232px;
}

.sw {
  position: relative;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--control-stroke);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease);
}

.sw:hover {
  transform: scale(1.14);
}

.sw.sel,
.sw.kb {
  outline: 2px solid var(--menu-ink);
  outline-offset: 1px;
}

.sw.none {
  background: transparent;
  border-color: var(--control-strong-stroke);
}

.sw.none::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -10%;
  width: 1.5px;
  height: 120%;
  background: var(--menu-danger);
  transform: rotate(45deg);
}

@media (pointer: coarse) {
  .item {
    height: auto;
    min-height: 36px;
    padding: 5px 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .f-menu {
    animation: none !important;
  }
  .f-menu-hi.anim {
    transition-duration: 0.01ms !important;
  }
}
</style>
