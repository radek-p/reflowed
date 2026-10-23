// Tooltip: on its child (hover after 500 ms, keyboard focus at once), a text and an optional key hint; one bubble at a
// time, placed as a popover (the editor's kit API: Tooltip({ text, keys, placement, children })).
import type { ComponentChildren } from 'preact';
import { html } from '../html.ts';
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'preact/hooks';
import { place, type Placement } from './popover.ts';

let uid = 0;
/** `open`: shown from the start and kept (the gallery). */
export function Tooltip({ text, keys, placement = 'bottom-center', open = false, children }: { text: string; keys?: string; placement?: Placement; open?: boolean; children?: ComponentChildren }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { if (open) setAnchor(hostRef.current); }, [open]);
  const timer = useRef<ReturnType<typeof setTimeout> | 0>(0), id = useRef(`wb-tip-${++uid}`).current;
  const show = useCallback((e: Event, now: boolean) => { const t = e.currentTarget as HTMLElement; clearTimeout(timer.current); timer.current = setTimeout(() => setAnchor(t), now ? 0 : 500); }, []);
  const hide = useCallback(() => { clearTimeout(timer.current); if (!open) setAnchor(null); }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return html`<span ref=${hostRef} class="wb-tip-host" style="display: contents" onPointerEnter=${(e: PointerEvent) => show(e, false)} onPointerLeave=${hide}
      onFocusIn=${(e: FocusEvent) => { if ((e.target as Element).matches(':focus-visible')) show(e, true); }} onFocusOut=${hide} onPointerDown=${hide}>
    ${children}${anchor ? html`<${Bubble} anchor=${(anchor.firstElementChild as HTMLElement | null) ?? anchor} id=${id} text=${text} keys=${keys} placement=${placement} />` : null}</span>`;
}
function Bubble({ anchor, id, text, keys, placement }: { anchor: HTMLElement; id: string; text: string; keys?: string; placement: Placement }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { place(ref.current!, anchor, { placement }); anchor.setAttribute?.('aria-describedby', id); return () => anchor.removeAttribute?.('aria-describedby'); }, [anchor]);
  return html`<div ref=${ref} id=${id} role="tooltip" class="wb-tooltip">${text}${keys ? html`<kbd>${keys}</kbd>` : null}</div>`;
}
