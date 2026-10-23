// The gallery's own frame: a section (its id, title, lead; [data-ready] once drawn), a labelled row, a cell.
import { useLayoutEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { html } from '../design/ui/index.js';
import type { Gallery } from './main.ts';

/** A section. `auto`: drawn once rendered (a section that waits on something calls g.ready itself). */
export function Section({ g, id, title, lead, auto = true, children }: { g: Gallery; id: string; title: string; lead?: string; auto?: boolean; children?: ComponentChildren }) {
  useLayoutEffect(() => { if (auto) g.ready(id); }, []);
  return html`<section class="gal-sec" id=${`gal-${id}`} data-section=${id} aria-labelledby=${`gal-${id}-h`}>
    <h2 class="gal-h2" id=${`gal-${id}-h`}>${title}</h2>
    ${lead ? html`<p class="gal-lead">${lead}</p>` : null}
    ${children}
  </section>`;
}
/** A named group of components inside a section. */
export function Group({ title, note, children, g: name }: { title: string; note?: string; g?: string; children?: ComponentChildren }) {
  return html`<div class="gal-group" data-g=${name}>
    <h3 class="gal-h3">${title}</h3>${note ? html`<p class="gal-note">${note}</p>` : null}
    ${children}
  </div>`;
}
/** A row: a label at the left, the items. */
export function Row({ label, children }: { label: string; children?: ComponentChildren }) {
  return html`<div class="gal-row"><div class="gal-label">${label}</div><div class="gal-items">${children}</div></div>`;
}
/** One component and its state's name under it. */
export function Cell({ label, children, wide = false }: { label: string; wide?: boolean; children?: ComponentChildren }) {
  return html`<figure class=${`gal-cell${wide ? ' gal-cell--wide' : ''}`}><div class="gal-cell-body">${children}</div><figcaption>${label}</figcaption></figure>`;
}

/** Is `ref`'s element in the window? A floating specimen (a popover, a tooltip) shows only while its anchor is: the
 *  kit keeps a floating thing inside the window, so one whose anchor scrolled away would sit at the window's edge. */
export function useInView(ref: { current: Element | null }): boolean {
  const [on, setOn] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { for (const e of es) setOn(e.isIntersecting); });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return on;
}
