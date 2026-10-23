// the document column as a Preact component (DocumentView).
//
// The editor core (app/app.js) builds and drives each block's element (u.root:
// the viewer mount, CodeMirror, live preview, nesting's decorations); a block
// element is an island the view places, never re-creates. The view owns:
//   - its container (.blocks) and the order of the islands in it: sync() puts
//     the elements in document order with the fewest moves (a moved element
//     loses focus, selection and a CodeMirror's scroll; untouched ones never
//     move, so a result swap or an insert elsewhere cannot make them flicker);
//   - the block list as a signal (view.blocks: [{ id, kind }]) that chrome
//     rendered next to the list derives from.
//
// Nothing here is a module-level singleton: createDocumentView() can be called
// twice (split view); each view has
// its own container, list and, later, its own filter and scroller. Only the
// primary view's container carries id="blocks" (tests look it up; an embedded editor's is its own: domId).
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html, render } from '../design/ui/core.js';

/**
 * Put `want` (elements, in order) as the children of `box`, moving as few as
 * possible: the elements already in relative order (a longest increasing run
 * of their current indices) stay; only the others move. Other children go.
 * Returns the number of moves (tests).
 */
export function placeChildren(box, want) {
  const wanted = new Set(want);
  for (const el of [...box.children]) if (!wanted.has(el)) el.remove();
  const at = new Map([...box.children].map((el, i) => [el, i]));
  // longest increasing subsequence of the current indices (patience sorting), -1 for new elements
  const idx = want.map((el) => at.get(el) ?? -1);
  const tails = [], prev = new Array(idx.length).fill(-1), tailAt = [];
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (v < 0) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < v) lo = m + 1; else hi = m; }
    tails[lo] = v; tailAt[lo] = i;
    prev[i] = lo ? tailAt[lo - 1] : -1;
  }
  const keep = new Set();
  for (let i = tailAt[tails.length - 1] ?? -1; i >= 0; i = prev[i]) keep.add(i);
  let moves = 0;
  // from the end: each element goes before the one after it (already in place)
  let next = null;
  for (let i = want.length - 1; i >= 0; i--) {
    const el = want[i];
    if (!keep.has(i) || el.parentNode !== box) { box.insertBefore(el, next); moves++; }
    next = el;
  }
  return moves;
}

function DocumentViewRoot({ view }) {
  const ref = useRef(null);
  useLayoutEffect(() => { view._attach(ref.current); return () => view._attach(null); }, []);
  return html`<div class="doc-view" data-view=${view.id}>
    <div ref=${ref} class="blocks" id=${view.primary ? view.domId : undefined} aria-label=${view.label}></div>
  </div>`;
}

/**
 * Mount a DocumentView into `host`. Returns the view:
 *   view.container          its .blocks element (null once destroyed)
 *   view.blocks             signal: [{ id, kind }] in document order
 *   view.sync(list, elOf)   place the elements of `list` (blocks) in order; elOf(id) -> element | null
 *   view.destroy()
 */
export function createDocumentView(host, { id = 'main', primary = true, label = 'Blocks', domId = 'blocks' } = {}) {
  let container = null, elementOf = () => null, lastMoves = 0;
  const subs = new Map();                       // (split view) id -> the element this view shows instead
  const view = {
    id, primary, label, domId,
    blocks: signal([]),
    get container() { return container; },
    get lastMoves() { return lastMoves; },
    _attach(el) { container = el; if (el) place(); },
    sync(list, elOf) {
      if (elOf) elementOf = elOf;
      view.blocks.value = list.map((b) => ({ id: b.id, kind: b.kind }));
      place();
    },
    /** (split view) show `el` for block `id` in this view instead of its own element (null: its own again) */
    substitute(id, el) { if (el) subs.set(id, el); else subs.delete(id); },
    clearSubstitutes() { subs.clear(); },
    place: () => place(),
    destroy() { render(null, host); container = null; },
  };
  function place() {
    if (!container) return;
    const want = [];
    for (const b of view.blocks.peek()) { const el = subs.get(b.id) ?? elementOf(b.id); if (el) want.push(el); }
    lastMoves = placeChildren(container, want);
  }
  // the first render is synchronous: the container exists when this returns
  render(html`<${DocumentViewRoot} view=${view} />`, host);
  return view;
}
