import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref, type WatchSource } from 'vue';

/**
 * Tracks the active item inside a segmented control or tab bar and returns
 * hardware-accelerated transform/size styles for a floating sliding indicator.
 */
export function useSlidingIndicator(
  containerRef: Ref<HTMLElement | undefined>,
  activeSelector: string,
  deps: WatchSource | WatchSource[],
  options: { horizontalOnly?: boolean } = {},
) {
  const style = ref<Record<string, string>>({});
  const ready = ref(false);
  const visible = ref(false);
  let observer: ResizeObserver | null = null;
  let raf1 = 0;
  let raf2 = 0;

  function cancelFrames() {
    if (typeof cancelAnimationFrame === 'undefined') return;
    if (raf1) cancelAnimationFrame(raf1);
    if (raf2) cancelAnimationFrame(raf2);
    raf1 = 0;
    raf2 = 0;
  }

  function measure() {
    const container = containerRef.value;
    if (!container) {
      visible.value = false;
      return;
    }
    const activeEl = container.querySelector<HTMLElement>(activeSelector);
    if (!activeEl || activeEl.offsetWidth === 0) {
      visible.value = false;
      return;
    }
    style.value = options.horizontalOnly
      ? {
          transform: `translate3d(${activeEl.offsetLeft}px, 0, 0)`,
          width: `${activeEl.offsetWidth}px`,
        }
      : {
          transform: `translate3d(${activeEl.offsetLeft}px, ${activeEl.offsetTop}px, 0)`,
          width: `${activeEl.offsetWidth}px`,
          height: `${activeEl.offsetHeight}px`,
        };
    visible.value = true;
  }

  function enableMotionAfterPaint() {
    cancelFrames();
    ready.value = false;
    if (typeof requestAnimationFrame === 'undefined') {
      ready.value = true;
      return;
    }
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        ready.value = true;
      });
    });
  }

  function attachObserver(el: HTMLElement | undefined) {
    observer?.disconnect();
    observer = null;
    if (!el) return;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure());
      observer.observe(el);
    }
    measure();
    enableMotionAfterPaint();
  }

  onMounted(() => {
    attachObserver(containerRef.value);
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(() => measure());
    }
  });

  watch(containerRef, async (el) => {
    await nextTick();
    attachObserver(el);
  });

  watch(
    Array.isArray(deps) ? deps : [deps],
    async () => {
      await nextTick();
      measure();
    },
    { flush: 'post' },
  );

  onBeforeUnmount(() => {
    cancelFrames();
    observer?.disconnect();
    observer = null;
  });

  return { style, ready, visible, measure };
}
