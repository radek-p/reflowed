// While a block is edited, its wide displays are shown whole: the viewer's natural fit (block.setDisplayFit,
// public viewer) on that block's view in that pane, bounded by the WHOLE PANE, with no fade; the glyphs stay
// where they are when the fit switches (the viewer keeps each display's glyphs in place). The viewer bounds a box by
// the padding box of the element the block sits in (.blk-render): the render is widened to the pane by padding with
// the same negative margin (--fit-l/--fit-r), so its content, the column, does not move. Beside a side-by-side source
// the room on the right is the render's own (the source is there). Back to the column on close (the close motion's
// change: edit/session.js). Measured again when the window is resized.
//
//   fitOn(sf, block, { side })   fitOff(sf, block)   (sf: a pane's surface, panes/block-view.js; block: its viewer view)
import { shownBlock } from '../view/shown.ts';
const fitted = new Map();               // render -> { sf, block, side }
let listening = false;

/** the box the pane shows its blocks in: a split pane's scroller (its <main data-pane>), the editor's view when one
 *  pane shows the page (its <main> is only the column's width then) */
function paneBox(root) {
  for (let p = root.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return p;
  return root.closest('[data-part="view"]') ?? document.documentElement;
}

function measure(sf, side) {
  const r = sf.render;
  const pane = paneBox(sf.root);
  r.style.removeProperty('--fit-l'); r.style.removeProperty('--fit-r');
  const rr = r.getBoundingClientRect(), pr = pane.getBoundingClientRect();
  const lo = pr.left + pane.clientLeft, hi = Math.min(lo + pane.clientWidth, document.documentElement.clientWidth);
  r.style.setProperty('--fit-l', `${Math.max(0, Math.floor(rr.left - lo))}px`);
  r.style.setProperty('--fit-r', `${side ? 0 : Math.max(0, Math.floor(hi - rr.right))}px`);
}

export function fitOn(sf, block, { side = false } = {}) {
  if (!sf?.render || !block?.setDisplayFit) return;
  // only a block with a display too wide for its column (the viewer gives only those a scroll box) has anything to fit
  if (!sf.root.classList.contains('rtx-fit') && !shownBlock(sf.render)?.querySelector('.latex-display')) return;
  measure(sf, side);
  sf.root.classList.add('rtx-fit');
  fitted.set(sf.render, { sf, block, side });
  try { block.setDisplayFit('natural'); } catch (e) { console.warn('display fit:', e.message); }
  if (!listening) {
    listening = true;
    addEventListener('resize', () => {
      for (const [r, f] of fitted) {
        if (!r.isConnected) { fitted.delete(r); continue; }
        measure(f.sf, f.side);
        try { f.block.setDisplayFit('natural'); } catch { /* gone */ }   // the viewer measures its room again
      }
    }, { passive: true });
  }
}

export function fitOff(sf, block) {
  if (!sf?.render) return;
  fitted.delete(sf.render);
  try { block?.setDisplayFit?.(null); } catch { /* gone */ }
  sf.root.classList.remove('rtx-fit');
  sf.render.style.removeProperty('--fit-l'); sf.render.style.removeProperty('--fit-r');
}
