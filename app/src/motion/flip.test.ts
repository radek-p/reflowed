// FLIP and the popover's open (motion/flip.js, motion/popover.js), on stand-in elements: every layout read comes
// before the first animation. An animation started on a block changes its style, so a read after it lays the page out
// again, in the press that opens the popover (a block with much SVG text: ~10 ms each time).
//   node app/src/motion/flip.test.ts      (Node; exit 1 on a failure)
import { first, play } from './flip.js';
import { openMotion } from './popover.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail)}`}`);
};

type Log = string[];
interface Fake {
  name: string; top: number; height: number; hidden: boolean; isConnected: boolean; parentElement: object | null;
  _motion?: unknown;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  getClientRects(): unknown[];
  getBoundingClientRect(): { top: number; bottom: number; height: number; left: number; right: number; width: number };
  animate(): { finished: Promise<void>; cancel(): void };
}
/** an element at `top` (moved by `shift`), logging its reads and animations */
function fake(log: Log, name: string, top: number, height: number, shift: { y: number }, parent: object | null = null): Fake {
  const cls = new Set<string>();
  return {
    name, top, height, hidden: false, isConnected: true, parentElement: parent,
    classList: { add: (c) => { cls.add(c); }, remove: (c) => { cls.delete(c); }, contains: (c) => cls.has(c) },
    getClientRects: () => [{}],
    getBoundingClientRect() { log.push(`read ${name}`); const t = this.top - shift.y; return { top: t, bottom: t + this.height, height: this.height, left: 0, right: 100, width: 100 }; },
    animate() { log.push(`animate ${name}`); return { finished: Promise.resolve(), cancel() {} }; },
  };
}
const readAfterAnimate = (log: Log) => { const i = log.findIndex((x) => x.startsWith('animate')); return i < 0 ? [] : log.slice(i).filter((x) => x.startsWith('read')); };

{
  // three blocks that moved (the snapshot has them higher): each read once, then each animated
  const log: Log = [], shift = { y: 0 }, list = {};
  const els = [fake(log, 'a', 100, 50, shift), fake(log, 'b', 200, 50, shift), fake(log, 'c', 300, 50, shift)];
  const snap = first(els);
  for (const el of els) el.top += 40;
  log.length = 0;
  const m = play(list, snap, els, { top: 0, bottom: 900 });
  check('play: every block read before the first animation (no read between two animations)', readAfterAnimate(log).length === 0, log);
  check('play: the three moved blocks animated', m.moved === 3 && log.filter((x) => x.startsWith('animate')).length === 3, { moved: m.moved });
}
{
  // the open: the popover in place, the page scrolled, the slide and the fade; no read after an animation began,
  // and the result's height it read handed back (the session's popover hold starts from it: no read of its own)
  const log: Log = [], shift = { y: 0 }, list = {};
  const above = fake(log, 'above', 100, 80, shift, list), root = fake(log, 'root', 200, 120, shift, list), below = fake(log, 'below', 340, 80, shift, list);
  const render = fake(log, 'render', 200, 120, shift), source = fake(log, 'source', 330, 0, shift);
  source.hidden = true;
  const sf = { root, main: root, render, source };
  const P = {
    moving: () => [above, root, below],
    box: () => ({ top: 56, bottom: 600 }),
    range: () => ({ min: -1000, max: 1000 }),
    scrollBy: (dy: number) => { log.push(`scroll ${dy}`); shift.y += dy; },
    keeper: null,
  };
  const m = openMotion(P, sf, {
    change: () => { log.push('change'); source.hidden = false; source.height = 400; below.top += 410; },   // the popover in the flow pushes the block after it down
    caret: () => ({ top: 210, bottom: 230 }) as DOMRect,
  });
  const after = log.slice(log.indexOf('change'));
  check('openMotion: no layout read after an animation began', readAfterAnimate(after).length === 0, after);
  check('openMotion: the page scrolled to place the popover, the moved blocks slide', after.some((x) => x.startsWith('scroll')) && m.moved > 0, { dy: m.dy, moved: m.moved });
  check('openMotion: the result\'s height it read, handed back', m.renderH === 120, { renderH: m.renderH });
}
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
