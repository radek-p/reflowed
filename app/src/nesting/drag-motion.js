// motion for dragging blocks. The dragged block (a container with its
// paragraphs) is lifted and follows the pointer; on drop, every block row in
// view glides from where it was drawn to its new place (FLIP, 150 ms), so
// nothing jumps. Transforms only (no layout during the drag); reduced motion:
// no transitions.
import { reduced } from '../motion/reduced.ts';
const MS = 150;

/** The rows' drawn tops (transforms included), by block id. */
export function snapshot(list) {
  const out = new Map();
  for (const el of list.querySelectorAll(':scope > .blk')) {
    if (el.offsetParent === null) continue;
    out.set(el.dataset.id, el.getBoundingClientRect().top);
  }
  return out;
}

/** Lift `roots` and let them follow the pointer: returns { follow(dx, dy), clear() }. */
export function lift(roots) {
  for (const r of roots) { r.classList.add('lifted'); r.style.transition = 'none'; }
  return {
    follow(dx, dy) { for (const r of roots) r.style.transform = `translate(${Math.round(dx * 0.15)}px, ${dy}px)`; },
    clear() { for (const r of roots) r.classList.remove('lifted'); },
  };
}

/** After the rows moved in the DOM: each glides from its old drawn top (`before`) to where it is now. */
export function glide(list, before) {
  const rows = [...list.querySelectorAll(':scope > .blk')];
  const moving = [];
  for (const el of rows) {
    const t0 = before.get(el.dataset.id);
    el.style.transition = 'none';
    el.style.transform = '';
    if (t0 === undefined || el.offsetParent === null) { el.style.transition = ''; continue; }
    const d = t0 - el.getBoundingClientRect().top;
    if (Math.abs(d) < 0.5) { el.style.transition = ''; continue; }   // a row that does not move keeps nothing of the drag
    el.style.transform = `translateY(${d}px)`;
    moving.push(el);
  }
  if (!moving.length) return Promise.resolve();
  if (reduced()) { for (const el of moving) { el.style.transform = ''; el.style.transition = ''; } return Promise.resolve(); }
  void list.offsetHeight;                                   // the start positions are drawn first
  return new Promise((done) => {
    for (const el of moving) { el.style.transition = `transform ${MS}ms cubic-bezier(0.2, 0, 0, 1)`; el.style.transform = ''; }
    setTimeout(() => { for (const el of moving) el.style.transition = ''; done(); }, MS + 30);
  });
}
