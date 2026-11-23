import { createApp, markRaw, shallowReactive } from 'vue';
import type { Anchor } from './placement';

export interface MenuItem {
  key?: string;
  label?: string;
  icon?: string;
  /** Optional 16x16 monoline outline SVG paths (left icon slot). */
  svgPaths?: readonly string[];
  /** Optional solid dot color shown in the left visual slot. */
  colorDot?: string;
  /** Quiet non-interactive section heading row. */
  header?: string;
  shortcut?: string;
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  swatches?: { key: string; color: string; title?: string; selected?: boolean }[];
  onSwatch?: (key: string) => void;
  children?: MenuItem[];
  action?: () => void;
  /** Fired when hovered/focused in menu; pair with showMenu({ onClose }) for live previews. */
  onHover?: () => void;
}

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'right-start';

export const menuState = shallowReactive({
  id: 0,
  open: false,
  items: [] as MenuItem[],
  at: null as Anchor,
  placement: 'bottom-start' as MenuPlacement,
  /** Element focused before the menu opened; focus returns there on close. */
  restore: null as HTMLElement | null,
});

let resolver: (() => void) | null = null;
let closeCallback: (() => void) | null = null;
let mounted = false;

async function mount() {
  if (mounted) return;
  mounted = true;
  const { default: MenuHost } = await import('./MenuHost.vue');
  const host = document.createElement('div');
  host.className = 'f-menu-host';
  document.body.appendChild(host);
  createApp(MenuHost).mount(host);
}

/** Opens a cascading MenuFlyout at a point, rect or element. Resolves when it closes. */
export async function showMenu(
  items: MenuItem[],
  at: { x: number; y: number } | DOMRect | MouseEvent | HTMLElement,
  opts?: { placement?: MenuPlacement; onClose?: () => void },
): Promise<void> {
  // Clicking the button that opened the menu again closes it (toggle flyout behaviour).
  if (menuState.open && typeof HTMLElement !== 'undefined' && at instanceof HTMLElement && menuState.at === at) {
    closeMenu();
    return;
  }
  closeMenu();
  await mount();
  menuState.items = markRaw(items);
  const normalizedAt =
    typeof HTMLElement !== 'undefined' && at instanceof HTMLElement
      ? markRaw(at)
      : 'clientX' in at && 'clientY' in at && typeof at.clientX === 'number' && typeof at.clientY === 'number'
        ? { x: at.clientX, y: at.clientY }
        : at;
  menuState.at = normalizedAt;
  menuState.placement = opts?.placement ?? 'bottom-start';
  menuState.restore = document.activeElement instanceof HTMLElement ? markRaw(document.activeElement) : null;
  closeCallback = opts?.onClose ?? null;
  menuState.id++;
  menuState.open = true;
  return new Promise((resolve) => (resolver = resolve));
}

export function closeMenu(): void {
  if (!menuState.open) {
    const stray = closeCallback;
    closeCallback = null;
    stray?.();
    return;
  }
  menuState.open = false;
  const r = menuState.restore;
  menuState.restore = null;
  if (r?.isConnected) r.focus({ preventScroll: true });
  const onClose = closeCallback;
  closeCallback = null;
  onClose?.();
  const done = resolver;
  resolver = null;
  done?.();
}
