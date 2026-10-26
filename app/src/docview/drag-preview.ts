// THE PREVIEW OF A DRAGGED BLOCK: a static copy of the block as the pane it was taken from draws it (its renders,
// cloned once at the drag's start: app/motion.js staticCopy; the viewer never runs for it), in the drag's layer on
// <body> (docview/drag.ts), so it is drawn above the workbench's groups, splitters and side columns and below menus
// (--ui-z-drag), never clipped by a pane. It follows the pointer by transform only (no layout per move), the point
// grabbed staying under the pointer; it catches no pointer (pointer-events: none, inert). It reads as a handle on the
// block: at most MAX_W × MAX_H, fully drawn at its upper left and fading out towards its right and bottom (masks: two
// gradients, intersected; its page fades later than its text, so what is beneath stays covered while the text goes),
// a soft shadow that fades with it, the page's background and ink (both themes).
//
//   const pv = createPreview(rows, host)   rows: the block's rows (.blk) in that pane (a container: its paragraphs);
//                                          host: where the preview goes. null when no row of the block is drawn.
//   pv.move(dx, dy)          the pointer is (dx, dy) from where it was pressed: the preview as far from the block's place
//   pv.spot(id) -> { top, left } | null   where row `id` (its .blk box) is drawn with the preview now: a dropped row
//                                          glides from there (nesting/drag-motion.ts)
//   pv.home() -> { left, top, bottom } | null   the preview's place on the block as it is drawn now
//   pv.land(to) -> Promise   a cancelled drag: the preview glides back to `to` (pv.home()) or, with `to` null, fades
//                            where it is; then it is removed (reduced motion: removed at once)
//   pv.remove()              gone (a landing in progress too)
//   pv.el                    the preview's element (tests read its box)
import { staticCopy } from '../app/motion.js';
import { reduced } from '../motion/reduced.ts';

export const MAX_W = 560, MAX_H = 128;     // px: a few lines; the fade does the rest
const PAD_X = 10, PAD_Y = 6;               // the page around the copy (the corner is never cut at a glyph)
const MS = 180;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const CSS = `
.blk-drag-ghost { position: fixed; left: 0; top: 0; z-index: var(--ui-z-drag, 48); margin: 0; pointer-events: none; will-change: transform; contain: layout style; }
.blk-drag-ghost-card { filter: drop-shadow(0 1px 1.5px color-mix(in srgb, #000 10%, transparent)) drop-shadow(0 8px 18px color-mix(in srgb, #000 16%, transparent)); }
html.dark .blk-drag-ghost-card { filter: drop-shadow(0 0 0.5px color-mix(in srgb, #fff 30%, transparent)) drop-shadow(0 8px 20px color-mix(in srgb, #000 60%, transparent)); }
.blk-drag-ghost-body { position: relative; box-sizing: border-box; overflow: hidden; border-radius: var(--ui-r-md, 8px); }
/* two fades from the upper left: the page under the copy goes later (what is beneath stays covered), the text sooner */
.blk-drag-ghost-paper, .blk-drag-ghost-ink { position: absolute; inset: 0; -webkit-mask-composite: source-in; mask-composite: intersect; }
.blk-drag-ghost-paper {
  -webkit-mask-image: linear-gradient(to right, #000 65%, transparent), linear-gradient(to bottom, #000 max(65%, 40px), transparent);
  mask-image: linear-gradient(to right, #000 65%, transparent), linear-gradient(to bottom, #000 max(65%, 40px), transparent); }
.blk-drag-ghost-ink {
  -webkit-mask-image: linear-gradient(to right, #000 40%, transparent 95%), linear-gradient(to bottom, #000 max(40%, 30px), transparent 95%);
  mask-image: linear-gradient(to right, #000 40%, transparent 95%), linear-gradient(to bottom, #000 max(40%, 30px), transparent 95%); }
.blk-drag-ghost-ink > .blk-render { position: absolute; margin: 0; overflow: hidden; cursor: inherit; }
`;
let styled = false;
function installStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.id = 'rtx-drag-preview-style';
  st.textContent = CSS;
  document.head.append(st);
}

/** a computed colour with no transparency (rgb(), or any other form without an alpha below 1) */
const opaque = (c: string) => {
  if (!c || c === 'transparent') return false;
  const a = /^rgba\(.*,\s*([\d.]+)\)$/.exec(c) ?? /\/\s*([\d.]+%?)\s*\)$/.exec(c);
  return !a || (a[1]!.endsWith('%') ? parseFloat(a[1]!) >= 100 : parseFloat(a[1]!) >= 1);
};
/** the first opaque background behind `el` (its own or an ancestor's): the page the block is on (a block's own tint,
 *  a hover or the handle's mark, is see-through and not the page) */
function pageBehind(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (opaque(c)) return c;
  }
  return 'var(--bg, Canvas)';
}

export interface Preview {
  el: HTMLElement;
  move(dx: number, dy: number): void;
  spot(id: string): { top: number; left: number } | null;
  home(): { left: number; top: number; bottom: number } | null;
  land(to: { left: number; top: number } | null): Promise<void>;
  remove(): void;
}

export function createPreview(rows: HTMLElement[], host: HTMLElement): Preview | null {
  installStyle();
  const shown: { row: HTMLElement; render: HTMLElement }[] = [];
  for (const row of rows) {
    if (row.classList.contains('nest-head')) continue;           // a container has no row of its own: its paragraphs
    const render = row.querySelector<HTMLElement>(':scope > .blk-main > .blk-render');
    if (render && render.getClientRects().length) shown.push({ row, render });
  }
  if (!shown.length) return null;
  const first = shown[0]!.render;
  const r0 = first.getBoundingClientRect();
  const origin = { x: r0.left - PAD_X, y: r0.top - PAD_Y };          // the preview's corner at the press
  const el = document.createElement('div');
  el.className = 'blk-drag-ghost';
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  const card = document.createElement('div');
  card.className = 'blk-drag-ghost-card';
  const body = document.createElement('div');
  body.className = 'blk-drag-ghost-body';
  const paper = document.createElement('div'), ink = document.createElement('div');
  paper.className = 'blk-drag-ghost-paper';
  ink.className = 'blk-drag-ghost-ink';
  body.append(paper, ink);
  let w = 0, h = 0;
  for (const { render } of shown) {
    const r = render.getBoundingClientRect();
    const top = r.top - r0.top, left = r.left - r0.left;
    if (top >= MAX_H) break;
    const copy = staticCopy(render) as HTMLElement;
    for (const a of ['tabindex', 'role', 'aria-label']) copy.removeAttribute(a);
    copy.style.cssText += `;left:${PAD_X + left}px;top:${PAD_Y + top}px;width:${r.width}px;height:${r.height}px;`;
    ink.append(copy);
    w = Math.max(w, left + r.width); h = Math.max(h, top + r.height);
  }
  const cs = getComputedStyle(first);
  Object.assign(body.style, { width: `${Math.min(w + 2 * PAD_X, MAX_W)}px`, height: `${Math.min(h + 2 * PAD_Y, MAX_H)}px`, color: cs.color });
  paper.style.background = pageBehind(first);
  card.append(body);
  el.append(card);
  // each row's box from the preview's corner (the rows of a container below the cap too: they glide from there)
  const at = new Map<string, { top: number; left: number }>();
  for (const row of rows) {
    if (!row.dataset.id || !row.getClientRects().length) continue;
    const r = row.getBoundingClientRect();
    at.set(row.dataset.id, { top: r.top - origin.y, left: r.left - origin.x });
  }
  let x = origin.x, y = origin.y, anim: Animation | null = null, gone = false;
  const place = () => { el.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
  place();
  host.append(el);
  const remove = () => {
    if (gone) return;
    gone = true;
    anim?.cancel();
    el.remove();
  };
  return {
    el,
    move(dx, dy) { x = origin.x + dx; y = origin.y + dy; place(); },
    spot(id) { const s = at.get(id); return s ? { top: y + s.top, left: x + s.left } : null; },
    home() {
      if (!first.isConnected || !first.getClientRects().length) return null;
      const r = first.getBoundingClientRect();
      return { left: r.left - PAD_X, top: r.top - PAD_Y, bottom: r.bottom };
    },
    land(to) {
      if (gone) return Promise.resolve();
      if (reduced() || typeof el.animate !== 'function') { remove(); return Promise.resolve(); }
      const now = `translate3d(${x}px, ${y}px, 0)`;
      anim = to
        ? el.animate([{ transform: now }, { transform: `translate3d(${to.left}px, ${to.top}px, 0)` }], { duration: MS, easing: EASE, fill: 'forwards' })
        : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MS, easing: 'ease-out', fill: 'forwards' });
      return anim.finished.then(remove, remove);
    },
    remove,
  };
}
