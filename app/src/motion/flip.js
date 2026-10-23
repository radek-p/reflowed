// FLIP for a pane's blocks: First (where each block is seen now), Last (where the new layout
// puts it, after the pane scrolled to its final place), Invert (a transform that puts it back where it was seen),
// Play (the transform eases to none). Transforms only: the compositor runs it, nothing is laid out per frame.
// Blocks whose way from the old place to the new one never crosses the pane's visible box do not move (they are
// off screen before, during and after).
//
//   const snap = first(els)                     visual tops (transforms of a running motion included)
//   stop(container)                             a running motion of this list ends where it is now
//   const m = play(container, snap, els, box)   { finished: Promise, moved: number }
export const DURATION = 220;
export const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
import { reduced } from './reduced.ts';
export { reduced };

/** @param {Iterable<Element>} els @returns {Map<Element, number>} */
export function first(els) {
  const m = new Map();
  for (const el of els) { if (el.isConnected && el.getClientRects().length) m.set(el, el.getBoundingClientRect().top); }
  return m;
}

const running = new WeakMap();      // container -> Animation[]
/** a running motion of the container's blocks: finished at once (call after first(): the snapshot keeps where they were seen) */
export function stop(container) {
  const list = running.get(container);
  if (!list) return;
  running.delete(container);
  for (const a of list) { try { a.cancel(); } catch { /* gone */ } }
}

/**
 * @param {Element} container   the list (its running motion is replaced by this one)
 * @param {Map<Element, number>} snap
 * @param {Iterable<Element>} els
 * @param {{ top: number, bottom: number }} box   the pane's visible box
 * @param {{ duration?: number, easing?: string, extra?: Animation[] }} [o]
 */
export function play(container, snap, els, box, o = {}) {
  const anims = [...(o.extra ?? [])];
  let moved = 0;
  if (!reduced()) {
    const opts = { duration: o.duration ?? DURATION, easing: o.easing ?? EASING };
    for (const el of els) {
      const old = snap.get(el);
      if (old == null || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      const d = old - r.top;
      if (Math.abs(d) < 0.5) continue;
      const lo = Math.min(old, r.top), hi = Math.max(old, r.top) + r.height;
      if (hi < box.top || lo > box.bottom) continue;
      anims.push(el.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], opts));
      moved++;
    }
  }
  running.set(container, anims);
  const finished = Promise.all(anims.map((a) => a.finished.catch(() => null))).then(() => { if (running.get(container) === anims) running.delete(container); });
  return { finished, moved, anims };
}
