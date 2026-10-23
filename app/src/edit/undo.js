// UNDO AND REDO ON THE PAGE: the document's one history (doc/history.js, data) and
// what an undo or a redo does around it. CodeMirror's own history is off (app/editor-entry.js): an editor's changes
// are recorded here as 'text' steps (doc/text-step.js, CodeMirror's typing groups), so ⌘Z in an open editor and ⌘Z
// on the page undo the same stack, in any pane. EVERY undo and redo shows its change in the pane it was made in (
// editor shows this document):
//   - a text step: that block's editor opens there (every other editor closes), the caret or selection exactly where
//     the change was; an editor already open on it is changed in place (its own scroll keeps the caret in view);
//   - a structural step: the pane scrolls to its place, which is selected and flashed;
//   - a figure's drawing (svgfig) or the preamble or bibliography alone: the toast says what was undone.
// One per document editor (app/app.js).
//
//   const u = createUndo({ S, edits, panes, revealBlock, toast, saveBlock, sourcesChanged, compileSoon })
//     sourcesChanged(id): a block's source changed outside an editor (app.js: the contexts again, it and the blocks
//     that show another key now, an undo of a \newcommand reached the blocks after it)
//   u.typed(session, update)    an editor's update: its text changes recorded (not remote, not an undo's own)
//   u.before(step, how)          the history's before hook: the editors that must close, closed
//   u.after(step, how)           the history's after hook: the change shown
import { textSteps, applyText, changesOf, selectionOf } from '../doc/text-step.js';
import { Transaction } from '@codemirror/state';

export function createUndo({ S, edits, panes, revealBlock, toast, saveBlock, sourcesChanged, compileSoon }) {
  const rec = textSteps(S.history, { doc: () => S.doc?.id ?? null });
  const focused = () => panes.focused().id;
  /** where a step is shown: the pane it was made in while it is shown (a tab in front in its group), else the focused one */
  // (a tab behind another in its group keeps its size: its panel is visibility: hidden, workbench .wb-panel--hidden)
  const shown = (id) => { const p = panes.get(id), b = p?.box(); return !!b && b.bottom - b.top > 0 && !p.el.closest('.wb-panel--hidden'); };
  const paneOf = (step) => (step.pane && shown(step.pane) ? step.pane : focused());
  // each step done now: tagged with the pane it was made in (a text step has its own: the editor's pane)
  S.history.onRecord((step) => { if (step.pane == null) step.pane = focused(); });
  const inView = (P, id) => {
    const el = panes.viewOf(P, id)?.root, box = panes.get(P)?.box();
    if (!el || !box) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > box.top + 8 && r.top < box.bottom - 8;
  };

  // ── a text step undone or redone: through the block's editor in the focused pane, else the model ──
  S.history.define('text', (step, how) => {
    const b = S.model.blockById(step.block);
    if (!b) return false;
    const P = paneOf(step), sel = selectionOf(step, how);
    const range = { from: sel.anchor, to: sel.head };
    const s = edits.session(P);
    if (s.id === step.block && s.editor) {
      const ch = changesOf(step, how);
      if (ch.length !== s.editor.view.state.doc.length) return false;
      s.editor.applyHistory(ch, sel);                      // typed(): the model, the block's other editors, the save
      if (!inView(P, step.block)) revealBlock(step.block, range, { pane: P, flash: false });
      return true;
    }
    const next = applyText(b.source, step, how);
    if (next == null) return false;                        // the block changed outside the history: this step no longer fits
    b.source = next;
    saveBlock(b);
    sourcesChanged(b.id);
    compileSoon();
    revealBlock(step.block, range, { pane: P, flash: false });   // its editor opens there, the change selected
    return true;
  });

  return {
    typed(s, update) {
      if (!s.id || !update?.transactions) return;
      const own = update.transactions.filter((tr) => tr.docChanged && tr.annotation(Transaction.addToHistory) !== false);
      if (own.length) rec.typed(s.id, s.pane, own);
    },
    before(step) {
      rec.clearGroup();
      if (step.type === 'text') {
        const P = paneOf(step);
        for (const x of edits.sessions()) if (!(x.pane === P && x.id === step.block)) x.leave({ animate: false });
      } else edits.leaveAll({ animate: false });
    },
    after(step, how) {
      if (step.type === 'text') return;                    // the editor shows it
      if (step.type === 'doc') revealDoc(step, how);
      toast(`${how === 'undo' ? 'Undone' : 'Redone'}: ${step.label}`);
    },
  };

  /** a structural step's place: the first block it set (in document order), else where the blocks it took out were */
  function revealDoc(step, how) {
    const side = how === 'undo' ? step.before : step.after, other = how === 'undo' ? step.after : step.before;
    const blocks = S.doc?.blocks ?? [];
    const set = Object.keys(side.blocks).filter((id) => side.blocks[id] && S.model.blockById(id));
    // what the step is about: blocks it edited or put in or took out, or moved (both neighbours changed); not the ones
    // that only got new keys (a rekey around a move)
    const near = (order, id) => { const k = order?.indexOf(id) ?? -1; return k < 0 ? null : [order[k - 1] ?? null, order[k + 1] ?? null]; };
    const placed = [], edited = [];                         // put in, taken out or moved first; then edited
    for (const id of set) {
      const a = step.before.blocks[id], b = step.after.blocks[id];
      if (!a || !b) { placed.push(id); continue; }
      const n0 = near(step.before.order, id), n1 = near(step.after.order, id);
      if (n0 && n1 && n0[0] !== n1[0] && n0[1] !== n1[1]) { placed.push(id); continue; }
      const { pos: pa, ...ra } = a, { pos: pb, ...rb } = b;
      void pa; void pb;
      if (JSON.stringify(ra) !== JSON.stringify(rb)) edited.push(id);
    }
    const byIndex = (a, b) => S.model.indexOf(a) - S.model.indexOf(b);
    let id = placed.sort(byIndex)[0] ?? edited.sort(byIndex)[0] ?? set.sort(byIndex)[0] ?? null;
    if (!id && blocks.length) {
      const order = other.order ?? blocks.map((b) => b.id);
      const at = Math.min(...Object.keys(side.blocks).map((x) => order.indexOf(x)).filter((k) => k >= 0), blocks.length - 1);
      id = blocks[Math.max(0, Math.min(at, blocks.length - 1))]?.id ?? null;
    }
    if (id) revealBlock(id, null, { edit: false, pane: paneOf(step) });
  }
}
