// The document editor's test surface: what tests and dev pages read and drive
// through `editorAPI` (app/src/wb/test-surface.ts forwards it), moved out of app.js. Product code never calls it.
// `x` is the editor's own parts, as createDocEditor (app.js) hands them over; its `let`s (backend, refreshTimer)
// through getters.
//
//   const api = createTestApi(x)
// @ts-check
import { kindsFor } from '../doc/kinds.ts';
import { pdfRequest } from './pdf-request.js';
import { next } from './page-state.ts';
import { advanced, setAdvanced } from '../settings/advanced.js';

/** @param {any} x the editor's parts (app.js createDocEditor) */
export function createTestApi(x) {
  return {
    async whenIdle() {
      for (;;) {
        if (x.edits.settling()) { await x.edits.settled(); continue; }          // a close's refresh after its motion
        if (x.S.follow.pending) { await x.S.follow.idle(); continue; }           // another tab's changes read and applied
        if (x.queue.busy() || x.edits.live.pending()) await x.queue.whenSettled();
        if (x.queue.draining()) { await x.queue.whenDrained(); continue; }
        if (!x.S.doc) return;
        const due = x.S.doc.blocks.filter((b) => !x.edits.isEditing(b.id) && x.viewResult(b)?.status === 'ok' && x.viewResult(b).nodelist && x.ui.get(b.id)?.mounted?.ck !== x.viewKey(b));
        // and every pane's view of what is shown (a pane opened: its views of the results on their way)
        const lag = x.S.doc.blocks.some((b) => { const u = x.ui.get(b.id); return u?.state === 'ok' && !x.edits.isEditing(b.id) && x.blocks.lags(u); });
        if (due.length || lag) { await next(x.root.state.displayed); continue; }     // the page's signals
        if (x.refreshTimer) { await next(x.root.state.refreshed); continue; }
        if (x.writer.pending) { await x.writer.idle(); continue; }
        await x.backend.fontsSettled?.();                   // patched fonts loaded and swapped in
        await (/** @type {any} */ (window)).reflowtex?.inspect?.idle?.();
        if (x.panes.widths.pinned) { await x.panes.widths.idle(); continue; }   // blocks still to re-break at a new width
        if (!x.queue.pending && !x.refreshTimer) return;
      }
    },
    currentDoc: () => (x.S.doc ? x.snapshotDoc() : null),
    /** this document's refs (refnav, tests): its labels, numbers, citations; the numbering's last run */
    refsState: () => x.refs.refsState(),
    numbering: () => x.refs.numbering?.() ?? null,
    widths: () => x.panes.widths,                                           // (tests) panes/widths.js
    lazyViews: () => x.blocks.lazy,                                         // (tests) panes/lazy-views.js
    blocks: () => (x.S.doc ? x.S.doc.blocks.map((b) => {
      const u = x.ui.get(b.id);
      return { id: b.id, kind: b.kind, source: b.source, state: x.edits.isEditing(b.id) ? 'editing' : u?.state, parentId: b.parentId ?? null, container: x.nest.isContainer(b),
        height: x.panes.first.viewOf(b.id)?.root.getBoundingClientRect().height ?? 0, mounted: !!u?.mounted, errors: x.cache.get(x.ck(b))?.errors ?? [],
        spacing: x.cache.get(x.ck(b))?.spacing ?? null };   // (tests) the engine's spacing data: integrate block-gaps
    }) : []),
    counters: () => ({ ...x.counters, compiledIds: [...x.counters.compiledIds] }),
    resetCounters() { x.counters.requests = 0; x.counters.partsSent = 0; x.counters.mounts = 0; x.counters.compiledIds = []; },
    kinds: () => kindsFor(x.S.doc?.preamble.source ?? '').map((/** @type {any} */ k) => ({ kind: k.env ?? k.kind, label: k.label })),
    edit: (id, caret) => x.enterEdit(id, null, caret ?? null),
    /** open block `id` in pane 'a' or 'b' (split view) */
    editIn: (pane, id, caret) => x.enterEdit(id, null, caret ?? null, null, null, pane),
    /** leave pane `pane`'s editor, or every editor */
    leave: (pane) => (pane ? x.edits.leave(pane) : x.edits.leaveAll()),
    /** the active editor's caret (or pane `pane`'s) */
    caret: (pane) => { const s = pane ? x.edits.session(pane) : x.edits.active; return s?.editor && s.id ? { id: s.id, offset: s.editor.caret, position: x.paneStates.of(s.pane).lastPosition, pane: s.pane } : null; },
    /** the open editors: [{ pane, id, real (on the block's own element, not a mirror), text, caret }] */
    sessions: () => x.edits.sessions().map((s) => ({ pane: s.pane, id: s.id, view: s.surface?.pane ?? null, text: s.editor?.text ?? null, caret: s.editor?.caret ?? null, mode: s.mode })),
    /** (tests) pane `pane`'s CodeMirror view */
    editorView: (pane) => x.edits.session(pane).editor?.view ?? null,
    warmStats: () => x.edits.warmStats(),                                 // tests: caret maps made ahead
    advanced: (on) => { if (on !== undefined) setAdvanced(on); return advanced.peek(); },   // tests: the advanced switch
    /** (tests) pane `pane`'s caret marked again as when a result lands (no caret move); is its caret followed? */
    remark: (pane) => x.edits.session(pane).caretSoon(),
    following: (pane) => x.edits.session(pane).follow,
    // the mutating calls take the UI's path: the commands, via 'test'
    setSource: (id, s) => x.command('block.setSource', { id, source: s }, 'test'),
    insert: (index, kind, source) => x.command('block.insert', { index, kind, source }, 'test'),
    remove: (id) => x.command('block.delete', { id }, 'test'),
    move: (id, to) => x.command('block.move', { id, to }, 'test'),
    split: (id, offset) => x.command('block.split', { id, offset }, 'test'),
    merge: (id) => x.command('block.merge', { id }, 'test') ?? false,
    setPreamble: (s) => x.command('doc.setPreamble', { source: s }, 'test'),
    commands: () => x.commands,                                          // (tests) the registry: list, recent
    settings: () => x.settings,                                           // tests
    outline: () => x.panels.outline(),
    outlineRuns: () => x.panels.outlineRuns(),                          // tests: the outline is memoised
    diagnostics: () => x.panels.diagnostics(),
    todos: () => x.panels.todos(),
    find: (q, o) => x.find.search(q, o),
    replaceAll: (q, r, o) => x.find.replaceAll(q, r, o),
    wordCount: () => { const c = x.countDoc(); return { words: c.words, characters: c.characters, blocks: c.blocks }; },
    backend: () => x.backend.id,
    /** the status: what was said last and what the top bar shows */
    status: () => ({ said: x.status.state(), shown: x.status.shown() }),
    selected: (pane) => (pane ? x.paneStates.of(pane).selected : x.selectedId()),   // the focused pane's, or pane `pane`'s
    editFigure: (id, name) => x.editFigure(id, name),
    ...x.feats.testApi(),
    /** client coordinates of a source offset in the open editor (tests: hover) */
    coordsAt: (offset) => {
      const v = x.edits.active?.editor?.view;
      let c = v?.coordsAtPos(offset);
      if (c && (c.top < 80 || c.bottom > innerHeight - 40)) { window.scrollBy(0, c.top - innerHeight / 2); c = v.coordsAtPos(offset); }
      return c ? { x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2 } : null;
    },
    /** (tests) a block's key now, and the key its view shows */
    keys: (id) => { const b = x.S.doc.blocks.find((y) => y.id === id); return b ? { now: x.viewKey(b), shown: x.ui.get(id)?.mounted?.ck ?? null } : null; },
    undo: () => x.command('doc.undo', {}, 'test'), redo: () => x.command('doc.redo', {}, 'test'),
    metaForm: () => x.metaForm,                                         // tests
    // nested blocks: containers and their paragraphs
    nest: () => x.nest.state(),
    pdfRequest: () => (x.S.doc ? pdfRequest(x.S.doc, x.nest.flatten) : null),   // what Export PDF compiles
    /** (tests) the panes, the layout model, a pane's anchor keeper, the warmer */
    panes: () => x.panes, layout: () => x.layout,
    keeper: (p) => (x.panes.get(p) ?? x.panes.focused())?.keeper ?? null,
    warmer: () => x.warmer,
    /** (tests) block `id`'s views: pane -> { el (its .blk), shows (the block's result) } */
    views: (id) => Object.fromEntries(x.panes.viewsOf(id).map((v) => [v.pane, { el: v.root, shows: !!v.mounted && v.mounted.ck === x.ui.get(id)?.mounted?.ck }])),
    sectionFocus: () => x.sectionFocus,
    nav: () => x.nav,                                                     // go-to and Back                                   // tests
    /** tests: the drop's glide done */
    dragSettled: () => x.drag.settled(),                                          // [{ id, kind, head, collapsed, children: [{ id, role }] }]
    nestSplit: (id) => x.nest.nestBlock(id),                             // a plain proof/theorem → container + paragraphs
    nestJoin: (id) => x.nest.join(id),                                   // a container (or a paragraph's) → one block
    nestCollapse: (id, on) => x.nest.collapse(id, on),
    nestMove: (id, index, parentId = null) => x.nest.moveTo(id, index, parentId),   // index in the list without the block
    nestMoveBy: (id, dir) => x.nest.moveBy(id, dir) || (x.moveBlock(id, x.indexOf(id) + dir), true),
    nestMoveOut: (id) => x.nest.moveOut(id),
    /** tests: each block's context prefix (what a move changes in its compile key) */
    contexts: () => Object.fromEntries(x.derived.contexts),
    /** typeset every block again (a notes setting changed what blocks compile to) */
    recompileAll: () => x.command('doc.recompileAll', {}, 'test'),
  };
}
