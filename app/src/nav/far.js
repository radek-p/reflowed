// Far scrolls without painting the way there.
//
// A smooth scroll over a long way brings every block it passes into view for a frame, and the viewer lays out and
// paints each of them (thousands of nodes on a first pass; Firefox hangs). So a far scroll goes in two steps: at once
// to about one pane's height before the target, on the side the target lies (nothing in between is ever in view),
// then a short animation over that last stretch, so the reader still sees which way the page went. Reduced motion:
// at once. A scroll shorter than FAR × the pane's height animates the whole way, as before.
//
//   import { approach, glide, paneHeight } from './far.js';
//   approach(P, delta) -> the part jumped at once (0 when not far): before an animation that aims by itself
//                         (the anchor keeper's reveal re-aims each frame)
//   glide(P, toY, { ms, tail }) -> Promise: animate pane P's scroll to toY (the jump first when far); a newer glide or a
//                         reader's wheel, touch or press ends it. tail (px): jump at once to tail before toY and animate
//                         only that (PageDown/PageUp: a third of the pane)
//   endOf(P) -> End's place: the scroll position at which the document's end (its last block, "Add a block" after it)
//                         meets the pane's bottom (0 for a document shorter than the pane). Below the end the pane has one
//                         pane height of empty space (app.css: the end space), which End does not bring into view
//   P: { scroller: Element | null (null: the window), top(): the pane's top y, keeper?, el?, view?, box()? (panes/pane.ts) }
import { reduced } from '../motion/reduced.ts';
import { appScroll } from '../perf/anchor.js';
export const FAR = 1.5;                 // farther than this many pane heights: jump, then animate the last one
const GLIDE_MS = 260;

export const scrollOf = (P) => (P.scroller ? P.scroller.scrollTop : scrollY);
// the height the reader sees: a pane's top is under the workbench's glass strip (its scroll-padding-top, two lines with two
// groups), so a step of the whole clientHeight scrolled lines past that were never read, and a far jump came to more
// than one seen height before its target
export const paneHeight = (P) => (P.scroller ? P.scroller.clientHeight - (parseFloat(getComputedStyle(P.scroller).scrollPaddingTop) || 0)
  : Math.max(200, innerHeight - (P.top?.() ?? 0)));
const maxScroll = (P) => (P.scroller ? P.scroller.scrollHeight - P.scroller.clientHeight : document.documentElement.scrollHeight - innerHeight);
const setScroll = (P, y) => {
  const top = Math.max(0, Math.min(y, maxScroll(P)));
  appScroll(P, { to: top });                     // the keeper told
};

/** End's place in pane P: the document's end (the bottom of "Add a block", else of the blocks) at the pane's bottom */
export function endOf(P) {
  const parts = [P.el?.querySelector(':scope > .add-end-host'), P.view?.container].filter((el) => el && el.getClientRects().length > 0);
  if (!parts.length) return maxScroll(P);
  const end = Math.max(...parts.map((el) => el.getBoundingClientRect().bottom));
  const bottom = P.box ? P.box().bottom : P.scroller ? P.scroller.getBoundingClientRect().top + P.scroller.clientHeight : innerHeight;
  return Math.max(0, Math.min(maxScroll(P), scrollOf(P) + end - bottom));
}

/** the instant part of a far scroll by `delta`: to one pane height before the target. Returns what it jumped. */
export function approach(P, delta) {
  const V = paneHeight(P);
  if (reduced() || Math.abs(delta) <= FAR * V) return 0;
  const jump = delta - Math.sign(delta) * V;
  const y0 = scrollOf(P);
  setScroll(P, y0 + jump);
  return scrollOf(P) - y0;
}

let current = null;                       // the glide going on (one at a time, page-wide)
const stopOnInput = () => { if (current) current.stop(); };
if (typeof addEventListener === 'function') for (const t of ['wheel', 'touchstart', 'pointerdown']) addEventListener(t, stopOnInput, { passive: true, capture: true });

/** Animate pane P to scroll position toY: a far way jumps first, then the last pane height animates. */
export function glide(P, toY, { ms = GLIDE_MS, tail = 0 } = {}) {
  current?.stop();
  const target = Math.max(0, Math.min(toY, maxScroll(P)));
  if (reduced()) { setScroll(P, target); return Promise.resolve(); }
  approach(P, target - scrollOf(P));
  if (tail > 0 && Math.abs(target - scrollOf(P)) > tail) {
    setScroll(P, target - Math.sign(target - scrollOf(P)) * tail);
  }
  const from = scrollOf(P), d = target - from;
  if (Math.abs(d) < 0.5) return Promise.resolve();
  return new Promise((res) => {
    let raf = 0, done = false;
    const g = {
      target, P,
      stop() { if (done) return; done = true; cancelAnimationFrame(raf); if (current === g) current = null; res(); },
    };
    current = g;
    const t0 = performance.now();
    const step = () => {
      if (done) return;
      const t = Math.min(1, (performance.now() - t0) / ms);
      const ease = 1 - (1 - t) ** 3;
      setScroll(P, from + d * ease);         // the app scrolls on the reader's behalf: the keeper holds once it ends
      if (t >= 1) { g.stop(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
}
/** the target of the glide going on in pane P (a key held down adds to it), else P's scroll position */
export const pendingTarget = (P) => (current && current.P.scroller === P.scroller ? current.target : scrollOf(P));
