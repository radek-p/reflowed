// The live preview's click and caret paths, moved here as they were from app/app.js (the render's click rule),
// panes/block-view.js (its listeners) and edit/session.js (a click's place in the source, the caret marked, a caret
// in a wide display revealed). What they asked of the app is given to them: the host's callbacks and the values the
// app computed. No app state of their own.
//
//   INTERACTIVE                                      what a click on a typeset block leaves to the element clicked
//   listenRender({ root, main, render, preview }, on) -> detach   the gestures' listeners: on.click(e) (the render,
//                                                    and the frame just beside it), on.dblclick(e), on.focus(), on.preview(e)
//   renderClick(e, v, host)                          a click on a block's render: { blockById(id), session(pane) ->
//                                                    { id, leave() }, titleForm(id) -> bool, enterEdit(id, e, …, pane) }
//   renderDblclick(e, v, host)                       a double click: host.enterEdit
//   positionAt(render, { result, compiled, text, click, fuzzyResult })   a point of the render -> { offset, method,
//                                                    glyph } in `text` | null: the engine's map (preview-marks offsetAt)
//                                                    on a render of `compiled`, else app/source-position.js's ways
//   revealCaret(render, block, x, clip)              the display the caret bar is in scrolled to it; true when it moved
//   markPreview(render, { result, compiled, text, caret, sel, block, follow, clip })   the caret and selection marked;
//                                                    a caret in a wide display revealed and marked again there
import { screenCTM } from '../view/screen-ctm.ts';
import { shownBlock } from '../view/shown.ts';
import { sourcePositionFor } from '../app/source-position.js';
import { besideRender } from './frame-click.js';
import { markCaret, offsetAt } from './preview-marks.ts';

// (a reference, a citation or a link is refnav's unit: refnav/index.js decides its click before this does)
export const INTERACTIVE = 'a, button, [role="button"], [tabindex], .latex-action, .latex-stream[data-kind="hint"]';

/** the render's listeners: a click on it (and in the frame just beside it: its padding, where a hanging full stop
 *  ends: as on the render), a double click, its focus; a click on the source stand-in */
export function listenRender(g, on) {
  const click = (e) => on.click?.(e), dbl = (e) => on.dblclick?.(e), foc = () => on.focus?.(), prev = (e) => on.preview?.(e);
  g.render.addEventListener('click', click);
  const frame = (e) => { if (besideRender(g.render, g.root, g.main, e)) click(e); };
  g.root.addEventListener('click', frame);
  g.render.addEventListener('dblclick', dbl);
  g.render.addEventListener('focus', foc);
  g.preview?.addEventListener('click', prev);
  return () => {
    g.render.removeEventListener('click', click);
    g.root.removeEventListener('click', frame);
    g.render.removeEventListener('dblclick', dbl);
    g.render.removeEventListener('focus', foc);
    g.preview?.removeEventListener('click', prev);
  };
}

/** a click on a block's render (v: { id, render, pane }): an interactive element of it is left to itself (another
 *  block's editor in this pane closes); a title block opens its form when it has one; else the block is edited here */
export function renderClick(e, v, host) {
  const b = host.blockById(v.id);
  if (!b) return;
  const s = host.session(v.pane);                                   // the editor of the pane clicked in
  const hit = e.target.closest(INTERACTIVE);
  if (hit && hit !== v.render && v.render.contains(hit)) { if (s.id && s.id !== b.id) s.leave(); return; }
  if (b.kind === 'title' && s.id !== b.id && host.titleForm(b.id)) { if (s.id) s.leave(); return; }
  host.enterEdit(b.id, e, null, null, null, v.pane);
}
export const renderDblclick = (e, v, host) => host.enterEdit(v.id, e, null, null, null, v.pane);

/** a point of the render -> a place in `text`: the text editor's hit rule on a render of `compiled` (the engine's
 *  map: offsetAt); else the fuzzy ways (app/source-position.js) on `fuzzyResult` (default: `result`) */
export function positionAt(render, { result, compiled, text, click, fuzzyResult = result }) {
  const hit = compiled != null ? offsetAt(render, result, compiled, text, click.x, click.y) : null;
  return hit != null ? { offset: hit, method: 'boundary', glyph: '' } : sourcePositionFor({ source: text, el: render, result: fuzzyResult ?? null }, click);
}

/** the display the caret bar is in, scrolled so the caret is inside its visible width; true when it moved.
 *  clip(): the box of the pane the render is shown in, when that cuts the window (null: the window) */
export function revealCaret(render, block, x, clip = () => null) {
  const bar = render.querySelector('.rtx-caret-bar');
  if (!bar || !block?.revealInDisplay) return false;
  const el = shownBlock(render);
  const shown = el ? [...el.querySelectorAll('.latex-display')].filter((d) => !d.parentElement?.closest('.latex-display')) : [];
  const b = bar.getBoundingClientRect(), y = (b.top + b.bottom) / 2;
  const i = shown.findIndex((d) => { const r = d.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
  if (i < 0) return false;
  const d = shown[i], svg = d.querySelector('svg'), m = screenCTM(svg);   // (CSS zoom in it in every browser)
  if (!m) return false;
  const p = new DOMPoint(x, y).matrixTransform(m.inverse());
  const before = d.scrollLeft;
  // the visible width: the display's box, less what of it the window (or a pane) cuts off
  const box = clip();
  const r = d.getBoundingClientRect();
  const lo = Math.max(0, box ? box.left : 0), hi = Math.min(document.documentElement.clientWidth, box ? box.right : Infinity);
  const cut = Math.max(0, lo - r.left, r.right - hi);
  try { block.revealInDisplay(i, p.x, { margin: 24 + cut }); } catch { return false; }
  return d.scrollLeft !== before;
}

/** the caret and selection marked in the render; a caret in a wide display: the display scrolls (only as far as
 *  needed, while followed) so it stays in view, marked again there */
export function markPreview(render, { result, compiled, text, caret, sel, block, follow, clip }) {
  const mk = markCaret(render, result, compiled, text, caret, sel);
  if (follow && mk?.x != null && revealCaret(render, block, mk.x, clip)) markCaret(render, result, compiled, text, caret, sel);
  return mk;
}
