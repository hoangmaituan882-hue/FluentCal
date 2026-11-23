import { computed, ref } from 'vue';
import type { DesktopMultiDays } from '@/lib/compactTimeline';

export type ViewportTier = 'phone' | 'tablet' | 'desktop';

export const PHONE_MAX = 639;
export const TABLET_MAX = 1023;

export function classifyViewport(width: number): ViewportTier {
  if (!Number.isFinite(width) || width <= PHONE_MAX) return 'phone';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

export function effectiveMultiDaySpan(
  saved: DesktopMultiDays,
  width: number,
  phoneOverride?: 2 | 3,
): DesktopMultiDays {
  if (width < 640) return phoneOverride ?? 3;
  if (width < 900) return saved === 7 ? 5 : saved;
  return saved;
}

const widthRef = ref(1280);
const heightRef = ref(800);
const isTouchRef = ref(false);
let initialized = false;

function readWindowSize() {
  if (typeof window === 'undefined') return;
  const vv = window.visualViewport;
  widthRef.value = Math.round(vv?.width ?? window.innerWidth ?? 1280);
  heightRef.value = Math.round(vv?.height ?? window.innerHeight ?? 800);
}

function initViewportListeners() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  readWindowSize();

  const onResize = () => readWindowSize();
  window.addEventListener('resize', onResize, { passive: true });
  window.visualViewport?.addEventListener('resize', onResize, { passive: true });

  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)');
    isTouchRef.value = mq.matches;
    const onMq = (e: MediaQueryListEvent) => {
      isTouchRef.value = e.matches;
    };
    mq.addEventListener('change', onMq);
  }
}

const tier = computed<ViewportTier>(() => classifyViewport(widthRef.value));
const isPhone = computed(() => tier.value === 'phone');
const isTablet = computed(() => tier.value === 'tablet');
const isCompactNav = computed(() => tier.value !== 'desktop');
const isDesktop = computed(() => tier.value === 'desktop');

export function useViewport() {
  initViewportListeners();
  return {
    width: widthRef,
    height: heightRef,
    tier,
    isPhone,
    isTablet,
    isCompactNav,
    isDesktop,
    isTouch: isTouchRef,
  };
}
