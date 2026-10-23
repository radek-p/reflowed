// @ts-check
// PANES (the selection per pane): what is each pane's own UI state —
// its keyboard selection, the caret of the block last edited in it (the References pane's Cite) and where its last
// click into a render landed. A pane is (document, view state): the document's state is the DocSession's, this is
// the view's. The selection shows on that pane's view of the block only (the class `selected`), and a view made
// later there gets it (blocks.js viewState). No DOM of its own: it toggles the class on the views it is given, and
// `has-selected` on the block lists around a selected view (focus mode dims the others: app.css; it was
// a :has() on the list of blocks, which made any block's class change a candidate for restyling every block).
//
//   const states = createPaneStates({ viewOf(pane, blockId) -> BlockView | null })
//   states.of(pane) -> { selected, lastCaret, lastPosition, section }    made on first use; section: a signal, the
//                                                                outline entry of the section in view in the pane (the
//                                                                pane bar keeps it: docview/pane-bar.js), crumbs' data
//   states.select(pane, blockId | null)                          that pane's selection, its view marked
//   states.applyTo(pane, blockId, el)                            a view just made: marked when selected there
//   states.forget(blockId)                                       a block gone: no pane selects it
//   states.drop(pane) · states.reset()                           a pane closed · the document closed
import { signal } from '@preact/signals';

/** @param {{ viewOf: (pane: string, id: string) => any }} o */
export function createPaneStates({ viewOf }) {
  /** @type {Map<string, { selected: string | null, lastCaret: any, lastPosition: any, section: import('@preact/signals').Signal<any>, lists?: Element[] }>} */
  const states = new Map();
  const of = (pane) => { let s = states.get(pane); if (!s) states.set(pane, s = { selected: null, lastCaret: null, lastPosition: null, section: signal(null) }); return s; };
  /** the block lists a view is in (a nested block's, its container's, the pane's) @param {Element} el */
  const listsOf = (el) => { const out = []; for (let e = el.parentElement; e; e = e.parentElement) if (e.classList.contains('blocks')) out.push(e); return out; };
  /** @param {{ lists?: Element[] }} s */
  const unlist = (s) => { for (const l of s.lists ?? []) l.classList.remove('has-selected'); s.lists = []; };
  /** @param {string} pane @param {string | null} id @param {boolean} on */
  const mark = (pane, id, on) => {
    const el = id ? viewOf(pane, id)?.root : null, s = of(pane);
    if (!on) unlist(s);
    if (!el) return;
    el.classList.toggle('selected', on);
    if (on) { s.lists = listsOf(el); for (const l of s.lists) l.classList.add('has-selected'); }
  };
  return {
    of,
    select(pane, id) {
      const s = of(pane);
      if (s.selected && s.selected !== id) mark(pane, s.selected, false);
      s.selected = id ?? null;
      if (id) mark(pane, id, true);
    },
    applyTo(pane, id, el) { const s = states.get(pane); if (s?.selected === id) { el.classList.add('selected'); unlist(s); s.lists = listsOf(el); for (const l of s.lists) l.classList.add('has-selected'); } },
    forget(id) { for (const s of states.values()) if (s.selected === id) { s.selected = null; unlist(s); } },
    drop(pane) { const s = states.get(pane); if (s) unlist(s); states.delete(pane); },
    reset() { for (const s of states.values()) unlist(s); states.clear(); },
    panes: () => [...states.keys()],
  };
}
