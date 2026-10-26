// motion for dragging blocks. On drop, every block row in view glides from where it was drawn to its new place
// (FLIP, 150 ms), so nothing jumps; the dropped block from where its preview was (docview/drag.ts: it hands the
// dropped rows' spots in). Transforms only, cleared when the glide ends (nothing of the drag stays on a row);
// reduced motion: no transitions. (No row follows the pointer: the preview does, docview/drag-preview.ts.)
//
//   snapshot(list) -> Map<id, Spot>      the rows' drawn places (transforms included), by block id
//   glide(list, before) -> Promise        after the rows moved in the DOM: each from its spot in `before` to where it is
import { reduced } from '../motion/reduced.ts';
const MS = 150;

export interface Spot { top: number; left: number }

export function snapshot(list: Element): Map<string, Spot> {
  const out = new Map<string, Spot>();
  for (const el of list.querySelectorAll<HTMLElement>(':scope > .blk')) {
    if (el.offsetParent === null || !el.dataset.id) continue;
    const r = el.getBoundingClientRect();
    out.set(el.dataset.id, { top: r.top, left: r.left });
  }
  return out;
}

export function glide(list: Element, before: Map<string, Spot>): Promise<void> {
  const rows = [...list.querySelectorAll<HTMLElement>(':scope > .blk')];
  const moving: HTMLElement[] = [];
  for (const el of rows) {
    const s = el.dataset.id ? before.get(el.dataset.id) : undefined;
    el.style.transition = 'none';
    el.style.transform = '';
    if (!s || el.offsetParent === null) { el.style.transition = ''; continue; }
    const r = el.getBoundingClientRect();
    const dy = s.top - r.top, dx = s.left - r.left;
    if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) { el.style.transition = ''; continue; }   // a row that does not move keeps nothing of the drag
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    moving.push(el);
  }
  if (!moving.length) return Promise.resolve();
  if (reduced()) { for (const el of moving) { el.style.transform = ''; el.style.transition = ''; } return Promise.resolve(); }
  void (list as HTMLElement).offsetHeight;                  // the start positions are drawn first
  return new Promise((done) => {
    for (const el of moving) { el.style.transition = `transform ${MS}ms cubic-bezier(0.2, 0, 0, 1)`; el.style.transform = ''; }
    setTimeout(() => { for (const el of moving) el.style.transition = ''; done(); }, MS + 30);
  });
}
