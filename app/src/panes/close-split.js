// Split view closed while the reader works in a pane: THAT pane stays, the other one goes (as in a
// multi-tab mode: closing A closes A). Closing from the first pane closes the others, as
// before. Closing from another pane (B): the layout keeps one pane with B's view state (panes/layout.js keepOnly:
// its document, its section focus), and what else B had goes on in it, in the same task (one paint, no motion):
//   - its editor: the same block, text, selection and undo history (CodeMirror's state as JSON), its own scroll,
//     whether it followed the caret;
//   - its place: the caret's line (or, without an editor on screen, the first block shown) stays at the y it was
//     seen at, as far as the page can scroll;
//   - its section focus (the outline's focus): the layout entry's, applied and announced to the pane bar.
// The window's pane (#page) is the one left: the DOM of the first slot stays, so nothing else needs to know which
// pane was kept.
//
//   closeSplitKeeping(keep, { layout, panes, edits })   keep: the pane id to keep (the focused one) -> true if closed

import { bump } from '../app/page-state.ts';   // the container's signals

/** pane P's reading point: the first block element that starts at or below its top (as the anchor keeper holds it,
 * */
function firstShown(P) {
  const box = P.box();
  let across = null;
  for (const b of P.view.container?.children ?? []) {
    if (b.offsetParent === null || b.classList.contains('nest-head')) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom <= box.top) continue;
    if (r.top >= box.top - 0.5) return { id: b.dataset.id, el: b, y: r.top };
    across ??= { id: b.dataset.id, el: b, y: r.top };
  }
  return across;
}

/** the caret's line in a session's editor, when it is inside pane P's box */
function caretY(s, P) {
  const v = s?.editor?.view;
  if (!v) return null;
  const c = v.coordsAtPos(v.state.selection.main.head);
  if (!c) return null;
  const box = P.box();
  return c.bottom > box.top && c.top < box.bottom ? c.top : null;
}

/** the kept editor has the keyboard again, unless the reader is typing elsewhere (the find bar, a field) */
function refocus(s) {
  const v = s?.editor?.view, a = document.activeElement;
  if (!v || v.hasFocus) return;
  if (a && a !== document.body && !a.closest('.topbar') && a.matches('input, textarea, [contenteditable="true"]')) return;
  v.focus();
}

export function closeSplitKeeping(keep, { layout, panes, edits, state }) {
  if (!layout.split.peek()) return false;
  const first = panes.first;
  if (!keep || keep === first.id || !panes.get(keep)) {
    for (const id of layout.ids()) if (id !== first.id) layout.close(id);
    refocus(edits.sessions().find((x) => x.pane === first.id));
    return true;
  }
  const from = panes.get(keep);
  // what the kept pane has, read before anything changes
  const s = edits.sessions().find((x) => x.pane === keep) ?? null;
  const carry = s?.editor ? {
    id: s.id, json: s.editor.carry(), scrollTop: s.editor.view.scrollDOM.scrollTop, follow: s.follow,
  } : null;
  const cy = carry ? caretY(s, from) : null;
  const shown = cy == null ? firstShown(from) : null;
  const heading = layout.pane(keep)?.focus ?? null;

  // the first pane's own editor goes (no motion: it is not what the reader looks at), then the other pane
  const own = edits.sessions().find((x) => x.pane === first.id);
  if (own) { own.closing?.finish(); edits.leave(first.id, { animate: false }); }
  layout.keepOnly(keep);

  // the editor goes on in the pane that is left
  const t = carry ? edits.enter(carry.id, { pane: first.id, still: true, carry: carry.json, scrollTop: carry.scrollTop, follow: carry.follow }) : null;

  // the place: what the reader looked at stays at its y
  const box = first.box();
  let now = null, want = null;
  if (cy != null && t?.editor) {
    const v = t.editor.view, c = v.coordsAtPos(v.state.selection.main.head);
    if (c) { now = c.top; want = cy; }
  } else if (shown) {
    const el = first.viewOf(shown.id)?.root;
    if (el?.isConnected) { now = el.getBoundingClientRect().top; want = shown.y; }
  }
  if (now != null) {
    const dy = now - Math.max(box.top, want);
    if (Math.abs(dy) >= 0.5) first.scrollBy(dy);
    first.keeper?.moved?.();
  }
  bump(state.sectionFocus, { pane: first.id, id: heading });   // the pane's bar; app/page-state.js
  return true;
}
