// Popover: a floating panel on an anchor (an element, or anything with getBoundingClientRect): placed before the first
// paint, kept on the anchor as the page scrolls or resizes; Escape and an outside press close it (layers.js). The
// editor's kit API (Popover({ anchor, placement, onClose, pad, class, role, label, focus })).
import type { ComponentChildren, JSX } from 'preact';
import { html } from '../html.ts';
import { useLayoutEffect, useEffect, useRef } from 'preact/hooks';
import { pushLayer } from './layers.ts';
import { visibleBox } from '../viewport.ts';

const GAP = 6, EDGE = 8;
export const cx = (...a: (string | false | null | undefined | 0)[]): string => a.filter(Boolean).join(' ');
/** What a popover is placed on: an element, or anything with a box (a rect, or a stand-in: placeOf). */
export type Anchor = { getBoundingClientRect(): DOMRect | { left: number; right: number; top: number; bottom: number; width: number; height: number } ; contains?(n: Node | null): boolean; focus?(o?: FocusOptions): void; readonly isConnected?: boolean };
export type AnchorRect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
export type Placement = 'bottom-start' | 'bottom-end' | 'bottom-center' | 'top-start' | 'top-end' | 'top-center';
/** Place `el` (position: fixed) next to `anchor`. Aligned at the start, its first row (a menu item, a select row) is what
 *  lines up with the anchor: the panel sits that row's inset further out (a chip and the menu it opens share one edge) */
export function place(el: HTMLElement, anchor: Anchor | AnchorRect | null, { placement = 'bottom-start', keep = null }: { placement?: Placement; keep?: boolean | null } = {}): boolean | null {
  const r = anchor && 'getBoundingClientRect' in anchor ? anchor.getBoundingClientRect() : anchor;
  if (!r) return keep;
  const w = el.offsetWidth, hgt = el.offsetHeight;
  const [side, align] = placement.split('-') as [string, string];
  // (the visible part of the window: above an on-screen keyboard, viewport.ts)
  const { top: T, bottom: B } = visibleBox();
  const below = keep ?? (side === 'bottom' ? r.bottom + GAP + hgt <= B - EDGE || r.top < T + hgt + GAP + EDGE : !(r.top - GAP - hgt >= T + EDGE) && r.bottom + GAP + hgt <= B);
  let top = below ? r.bottom + GAP : r.top - GAP - hgt;
  top = Math.max(T + EDGE, Math.min(top, B - hgt - EDGE));
  // the row's inset in layout px: measured while the panel opens (wb-float-in scales it, 0.985 → 1), so the rects'
  // distance is divided by the panel's scale now (its transform, the animation's current value)
  const tf = getComputedStyle(el).transform, box = el.getBoundingClientRect(), scale = tf && tf !== 'none' ? new DOMMatrixReadOnly(tf).a || 1 : 1;
  const row = el.querySelector('.wb-row, .wb-menu-item'), inner = row ? (row.getBoundingClientRect().left - box.left) / scale : 0;
  let left = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left - inner;
  left = Math.max(EDGE, Math.min(left, innerWidth - w - EDGE));
  el.style.left = `${left}px`;     // not rounded: an edge it shares with the anchor (its ring's outer edge on the pill's) stays exact
  el.style.top = `${Math.round(top)}px`;
  return below;
}
export type PopoverProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'label'> & {
  anchor: Anchor; placement?: Placement; onClose?: (why: string) => void; pad?: boolean; class?: string; role?: string; label?: string;
  children?: ComponentChildren; focus?: boolean;
};
export function Popover({ anchor, placement = 'bottom-start', onClose, pad = true, class: c = '', role = 'dialog', label, children, focus = true, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null), side = useRef<boolean | null>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const el = ref.current!;
    side.current = place(el, anchor, { placement });
    let raf = 0;
    const follow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { side.current = place(el, anchor, { placement, keep: side.current }); }); };
    addEventListener('scroll', follow, { capture: true, passive: true });
    addEventListener('resize', follow);
    const ro = new ResizeObserver(follow); ro.observe(el);
    return () => { cancelAnimationFrame(raf); removeEventListener('scroll', follow, { capture: true }); removeEventListener('resize', follow); ro.disconnect(); };
  }, [anchor, placement]);
  useLayoutEffect(() => {
    const a = anchor as { contains?(n: Node | null): boolean; focus?(o?: FocusOptions): void };
    const l = pushLayer({ el: ref.current!, anchor: a.contains ? { contains: (n) => a.contains!(n) } : null, returnFocus: a.focus ? { focus: (o) => a.focus!(o) } : null, onDismiss: (why) => closeRef.current?.(why) });
    return () => l.remove();
  }, [anchor]);
  useEffect(() => {
    if (focus) (ref.current!.querySelector<HTMLElement>('[autofocus], input, button:not([disabled]), [tabindex="0"]') ?? ref.current!).focus({ preventScroll: true });
  }, [anchor]);
  // Tab past its last stop (Shift+Tab before its first) would leave the focus after the page's end: it closes the
  // popover and the focus goes back to its opener, as Escape (a list's own Tab between its cells comes first)
  const tab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement, F = Node.DOCUMENT_POSITION_FOLLOWING;
    if (!a) return;
    const stops = [...ref.current!.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input, a[href], [tabindex="0"]')];
    if (stops.some((x) => (e.shiftKey ? x.compareDocumentPosition(a) & F : a.compareDocumentPosition(x) & F))) return;
    e.preventDefault();
    closeRef.current?.('tab');
    anchor?.focus?.({ preventScroll: true });
  };
  return html`<div ref=${ref} role=${role} aria-label=${label} tabindex="-1" class=${cx('wb-pop wb-float-in', pad && 'wb-pop--pad', c)} onKeyDown=${tab} ...${rest}>${children}</div>`;
}
