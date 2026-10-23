// Showing a block in a pane: the go-tos that act in one pane (the one asked for, else the
// focused one) through nav/navigate.js's one rule (out of a section focus first, Back comes back, a far
// way jumps, the last stretch animates). Out of app.js; one per document editor.
//
//   const r = createReveal({ pane(id | null) -> Pane, has(blockId), nav, session(paneId), enterEdit, select })
//   r.revealBlock(id, range, { edit, pane })   scrolled to and opened (a range selected), flashed: a find, a go-to-definition
//   r.scrollToBlock(id, pane)                   its heading to the top, selected, that pane's editor closed: the outline's jump
//   r.flashBlock(id)                            flashed in the focused pane, brought into view when it is out of it
/** @param {{ pane: (id?: string | null) => any, has: (id: string) => boolean, nav: any, session: (pane: string) => any,
 *   enterEdit: (...a: any[]) => any, select: (id: string, o: any) => void }} o */
export function createReveal({ pane: paneFor, has, nav, session, enterEdit, select }) {
  const flash = (el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
  /** Scroll to a block and open it (optionally selecting a range); flash it. In the focused pane (a find, a
   *  go-to-definition from pane B's editor stays in pane B), or `pane`. */
  function revealBlock(id, range = null, { edit = true, pane = null, flash: fl = true } = {}) {
    if (!has(id)) return;
    const P = paneFor(pane);
    nav.leaveFocusFor(P.id, id, { history: true });      // outside the section focus: leave it first (Back comes back)
    if (edit) {
      const s = session(P.id);
      if (s.id && s.id !== id) s.leave({ animate: false });
      enterEdit(id, null, range ? null : 0, null, range, P.id);
    } else select(id, { scroll: !P.keeper, pane: P.id });   // the keeper's reveal scrolls; a smooth scrollIntoView raced it
    // to the top, below the top bar, re-aimed while blocks above change height, then held there
    const el = P.viewOf(id)?.root;
    if (!el) return;
    nav.reveal(P.id, el, { align: P.keeper ? 'top' : 'center' });   // a far way jumps, the last stretch animates
    if (fl) flash(el);
  }
  /** The outline's jump: the block's heading to the top of the focused pane (or `pane`); that pane's editor closes.
   *  quiet (a tab's reading place restored): only the scroll, no selection, focus or history */
  function scrollToBlock(id, pane = null, { quiet = false } = {}) {
    if (!has(id)) return;
    const P = paneFor(pane);
    if (quiet) { const v = P.viewOf(id)?.root; if (v) nav.reveal(P.id, v, { align: 'top' }); return; }
    nav.leaveFocusFor(P.id, id, { history: true });
    { const s = session(P.id); if (s.id && s.id !== id) s.leave({ animate: false }); }
    const el = P.viewOf(id)?.root;
    if (!el) return;
    nav.reveal(P.id, el, { align: 'top' });              // the keeper's reveal, after a far jump
    select(id, { scroll: false, pane: P.id });         // a smooth scrollIntoView to "nearest" raced the reveal's glide (motion)
  }
  function flashBlock(id) {
    const P = paneFor(null), el = P.viewOf(id)?.root;            // in the focused pane
    if (!el) return;
    const r = el.getBoundingClientRect(), bx = P.box();
    if (r.bottom < bx.top + 4 || r.top > bx.bottom - 40) nav.reveal(P.id, el, { align: 'center' });
    flash(el);
  }
  return { revealBlock, scrollToBlock, flashBlock };
}
