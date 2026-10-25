// The editing popover opens and closes in ONE motion, decided before anything is shown.
//
// Open:  1. where every block of the pane is seen now (flip.first);
//        2. the change, in the same task: the editor mounted in its popover and laid out (not painted yet), the
//           caret marked in the result;
//        3. the final place (place.js): the scroll that keeps the block where it was seen, the caret's line visible
//           and uncovered, the popover whole on screen — applied at once, in the same task;
//        4. one animation: every block that is on screen before or after slides from where it was seen to its
//           place (transforms only, flip.play), the popover fades in (190 ms, from the slide's first frame). Nothing corrects it later: the
//           anchor keeper is quiet until it ends, then holds where it is.
// Close: the mirror: the popover leaves the flow where it is (frozen, out of the flow, still drawn); the
//        heights seen in the pane decide what stays (place.js closeAnchor): A (the pane's top to the preview), B (the
//        preview seen above the popover), D (the popover's bottom to the pane's bottom); A + B < D: the page scrolls so
//        what is below the popover stays and the top part comes down; otherwise the top stays and what is below slides
//        up into the space; the popover fades out (120 ms), then the editor goes. Not while typing (edit/session.js
//        holdPopover).
// prefers-reduced-motion: the same change and scroll, no animation.
//
//   const m = openMotion(P, sf, { change, caret, float })   -> { finished, dy, moved, renderH }
//     renderH: the result's height in its new layout, read with the other rects before any animation starts (an
//     animation on a block changes its style: a read after it lays the page out in this task); null when not read
//   const m = closeMotion(P, sf, { change, teardown })      -> { finished, finish(), ended() }
//   P: { box(), range(), moving(), scrollBy(dy), keeper, relayout?() }   (panes/pane.js + the core)
import { first, stop, play, reduced, DURATION, EASING } from './flip.js';
import { place, closeAnchor } from './place.js';

export const FADE_MS = 120;                         // the close's fade out
export const FADE_IN_MS = 190;                      // the open's fade in: 120 ms could not be seen beside the 220 ms slide
const FADE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
const container = (sf) => sf.root.parentElement ?? sf.root;

/**
 * @param {any} P   the pane
 * @param {any} sf  the surface (panes/block-view.js): root, main, render, source
 * @param {{ change(): void, caret?(): DOMRect | null, float?(): boolean, onPlaced?(dy: number): void }} o
 */
export function openMotion(P, sf, o) {
  const els = P.moving();
  const snap = first(els);
  const seen = snap.get(sf.root) ?? sf.root.getBoundingClientRect().top;
  stop(container(sf));                               // a motion going on ends where it is seen (the snapshot has it)
  o.change();
  P.relayout?.();                                    // what is laid over the blocks by script (nesting heads), in this task
  const box = P.box();
  const float = !!o.float?.();
  const now = sf.root.getBoundingClientRect().top;
  const shows = !sf.render.hidden && sf.render.getClientRects().length > 0;
  const c = shows ? o.caret?.() ?? null : null;
  const render = shows ? rect(sf.render) : null;
  const dy = shows && !sf.source.hidden ? place({
    box, pop: rect(sf.source), render, caret: c ? { top: c.top, bottom: c.bottom } : null,
    float, base: now - seen, range: P.range(),
  }) : Math.max(P.range().min, Math.min(P.range().max, now - seen));
  if (Math.abs(dy) >= 0.5) P.scrollBy(dy);
  o.onPlaced?.(dy);
  const fade = () => (!reduced() && !sf.source.hidden ? [sf.source.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: FADE_EASING })] : []);
  const m = play(container(sf), snap, els, box, { extra: fade });
  sf.root.classList.add('rtx-moving');
  const finished = m.finished.then(() => { if (!sf.root._motion || sf.root._motion === finished) sf.root.classList.remove('rtx-moving'); });
  sf.root._motion = finished;
  P.keeper?.quiet?.(finished);
  return { finished, dy, moved: m.moved, renderH: render ? render.bottom - render.top : null };
}

/**
 * @param {any} P
 * @param {any} sf
 * @param {{ change(): void, teardown(): void }} o
 *   change: the block is no longer edited (its layout and caret marks go, the block is displayed again), the
 *   popover kept as it is; teardown: the popover's editor and panel go (after the fade)
 */
export function closeMotion(P, sf, o) {
  const els = P.moving();
  const snap = first(els);
  stop(container(sf));
  // the heights seen before the change decide; what is below the popover is the next block shown
  const shownEl = (el) => el && el.getClientRects().length > 0 && !el.classList.contains('nest-head');
  const sib = (el) => { let e = el; do e = e.nextElementSibling; while (e && !shownEl(e)); return e; };
  const C = sib(sf.root);
  const popShown = !sf.source.hidden && sf.source.getClientRects().length > 0;
  const renderShown = !sf.render.hidden && sf.render.getClientRects().length > 0;
  const keepEl = C && popShown && closeAnchor({ box: P.box(), render: renderShown ? rect(sf.render) : null, pop: rect(sf.source) }) === 'below' ? C : null;
  const keepY = keepEl ? keepEl.getBoundingClientRect().top : null;
  const pop = sf.source;
  const was = pop.getBoundingClientRect();
  const shown = !pop.hidden && was.height > 0 && !reduced();
  if (shown) {
    // out of the flow, where it is seen, as it is drawn (the editing classes stay until the teardown: its look)
    pop.inert = true;
    pop.classList.add('rtx-pop-leaving');
    sf.root.classList.add('rtx-leaving');            // the view keeps its editing look until the teardown (panes/blocks.js display)
    pop.style.setProperty('--leave-w', `${was.width}px`);
    pop.style.setProperty('--leave-h', `${was.height}px`);
    pop.style.setProperty('--leave-x', '0px');
    pop.style.setProperty('--leave-y', '0px');
  }
  o.change();
  P.relayout?.();
  if (keepEl?.isConnected) {
    const dy = keepEl.getBoundingClientRect().top - keepY;
    if (Math.abs(dy) >= 0.5) { P.scrollBy(dy); P.relayout?.(); }
  }
  if (shown) {
    const at = pop.getBoundingClientRect();
    pop.style.setProperty('--leave-x', `${was.left - at.left}px`);
    pop.style.setProperty('--leave-y', `${was.top - at.top}px`);
  }
  const box = P.box();
  // the block slides (the page scrolled to keep the one below): the popover in it stays where it was seen, the
  // block's slide undone on it (the same timing: `translate` composes with its transform)
  const slid = shown && snap.has(sf.root) ? snap.get(sf.root) - sf.root.getBoundingClientRect().top : 0;
  const m = play(container(sf), snap, els, box, { extra: () => !shown ? [] : [
    pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: FADE_EASING, fill: 'forwards' }),
    ...(Math.abs(slid) >= 0.5 ? [pop.animate([{ translate: `0 ${-slid}px` }, { translate: '0 0' }], { duration: DURATION, easing: EASING })] : []),
  ] });
  const extra = m.extra;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    for (const a of extra) { try { a.cancel(); } catch { /* gone */ } }
    pop.inert = false;
    pop.classList.remove('rtx-pop-leaving');
    sf.root.classList.remove('rtx-leaving');
    for (const p of ['--leave-w', '--leave-h', '--leave-x', '--leave-y']) pop.style.removeProperty(p);
    o.teardown();
  };
  // the popover's own fade ends the editor; the blocks may still be sliding (they need nothing more)
  const faded = extra.length ? extra[0].finished.then(end, end) : Promise.resolve().then(end);
  if (!extra.length) end();
  const finished = Promise.all([faded, m.finished]).then(() => {});
  P.keeper?.quiet?.(finished);
  return { finished, finish: end, ended: () => ended, moved: m.moved };
}
