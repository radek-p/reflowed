// The document editor: a document of LaTeX blocks, each shown reflowed by the
// Reflow TeX viewer on this page (one viewer, blocks mounted with
// reflowtex.host.mount), edited in place as source (CodeMirror). The document comes from a DocStore,
// compiles go to a Backend, numbers and references to Refs (all through
// ../contracts.d.ts), and the page has a sidebar (outline, problems, TODOs),
// find/replace, split/merge, keyboard navigation and focus mode.
//
// Flow: a block's look is its compile result, found in `cache` by its
// compile key (backend, preamble + bib, refs context, source: ck()). Leaving
// a block after an edit, a preamble change or a context change leaves blocks
// without a result; compileSoon() sends them, the ones in view first, in
// requests of at most BATCH blocks; display() mounts what comes back.
//
// createDocEditor(ctx) -> { open(id), close(), api }   (one document at a time, an editor per pane, ../edit/)
// One editor per open DOCUMENT: main.js's workspace makes the first one (the route's document, pane A and
// any pane showing it) and one for a pane that shows another document (ctx.only: that pane's <main>, made by the
// first editor's panes registry; ctx.widths: the page's width governor). The page's UI (top bar, sidebar panels,
// find, keys, Document settings) is the CURRENT editor's: ctx.active() says whether this one is (the focused
// pane's document); activate() / deactivate() hand the page over.
// the document is shown in N equal panes (../panes/: the layout model, each pane its own views of
// the blocks); this core owns the document and each block's STATE (ui), never an element.
import { createEditor } from './editor-entry.js';
import { signal } from '@preact/signals';
import { bump } from './page-state.ts';                    // the editor's signals (its container's, root.state)
import { advanced, registerAdvanced } from '../settings/advanced.js';
registerAdvanced({ id: 'menu-notes', label: 'Hide notes and Comments as notes in the ⋯ menu', where: 'Document menu' });
import { kindLabel, markerOf as markerKind } from '../doc/kinds.js';
import { createCommands, editorCommands, createEditorKeys } from '../commands/index.js';   // every intent: menus, keys, editorAPI
import { scanHeadings, scanTodos, todoMacros, countWords, texToText, blankComments } from '../tex/texscan.js';
import { createPanels } from './panels.ts';
import { createFind } from './find.js';
import { errorReport } from '../view/copy-errors.js';                         // copyable errors
import { createEditing, createUndo } from '../edit/index.js';                             // editing: a session per pane, two at once
import { renderErrors } from '../edit/panel.js';                               // error rows (Preact)
import { createBlockDrag } from '../docview/drag.js';                          // drag a block, in and between panes
import { createPanes, createPaneStates, closeSplitKeeping } from '../panes/index.ts';                               // the panes: equal views of the document
import { createLayout } from '../panes/layout.js';                             // the layout as data
import { createBlocks } from '../panes/blocks.js';                             // what each block shows, in every pane
import { createNesting } from '../nesting/index.js';       // nested blocks: containers and their paragraphs
import { createPerf } from '../perf/index.js';              // input first: background results in slices
import { createSvgFigureHooks } from '../svgfig/app-hooks.js';   // SVG figures, edited in the browser
import { createAnchorKeeper } from '../perf/anchor.js';     // the reader's place holds while blocks above typeset
import { createDocumentView } from '../docview/document-view.js';   // the document column (Preact)
import { createRouter } from './router.js';                          // the route as app state
import { createStatus } from '../chrome/status.js';
import { showToast } from '../chrome/toast.js';                      // the toast (Preact)
import { mountAddBlock, unmountAddBlock } from '../chrome/sidebar-chrome.ts';            // "Add a block" in every pane
import { isReadOnly, readOnlyNote } from './read-only.js';
import { onReadOnlyOpen, closeOlderCorePrompt } from './older-core.js';   // an older core: export and start anew
import { pdfRequest } from './pdf-request.js';                        // the PDF export's one document
import { reportQuota, isQuota } from '../../../engine/web/quota.js';             // out of space: said
import { openShortcuts } from '../chrome/shortcuts.js';                // the shortcuts dialog (Preact)
import { mountTopBar } from '../chrome/top-bar.js';
import { createDocSession, hash, GRAPHICS } from '../doc/index.js';   // the document: writes, block list, undo, operations
import { createCompileQueue } from './compile-queue.js';
import { createSectionFocus } from '../docview/focus.js';
import { createNavigator, createReveal } from '../nav/navigate.js';
import { installScrollKeys } from '../nav/keys.js';               // End/Home/PageUp/PageDown without passing every block
import { wirePaneBars } from '../docview/pane-bar.js';                // the panes' breadcrumb bars
import { createSettings, showPreambleErrors, preambleProblemsOf } from '../settings/index.js';   // Document settings: a side sheet
import { createWarmer } from '../perf/warm.js';
import { splitMeta, blockSource } from '../meta/compile.ts';           // the title data compiles with the title block
import { createMetaForm } from '../meta/form/index.js';               // the title and authors sheet
import { createTestApi } from './test-api.js';                        // editorAPI's test surface
import { createDocFiles } from './doc-files.ts';                       // versions, the seed reset, import, exports
import { createDocMeta } from './doc-meta.ts';                         // the preamble and the bibliography
import { createDocMenus } from './doc-menus.ts';                       // the block's, the document's and the slash menus
import { createRefresh } from './refresh.ts';                          // when the whole-document refresh runs
import { definitionOf } from './goto-definition.ts';                    // a \ref's label, a \cite's entry
import { createDocKeys } from './doc-keys.ts';                         // the page's keys, one table
import { composeFeatures } from './feature.ts';                        // the features' contributions, one list
import { reduced } from '../motion/reduced.ts';

const BATCH = 8;                       // blocks per compile request
const $ = (sel, root = document) => root.querySelector(sel);
export const h = (tag, cls, attrs = {}) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  return el;
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* not kept */ } }
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function createDocEditor(ctx) {
  const { store, refs, ids } = ctx;
  // the backend through the open document's state (engine forDoc, keyed by the document), released on close
  let base = ctx.backend, backend = base;
  const bindBackend = (id) => { try { backend.release?.(); } catch { /* */ } try { backend = (id && base?.forDoc?.(id)) || base; } catch { backend = base; } };
  const guest = !!ctx.only;                 // this editor shows another document in one pane
  // every pane is a host's (app/doc-tabs.ts: the workbench's tabs): no pane is the first, the tabs draw the
  // crumbs (the pane bars only follow the section in view), and the current document has what pane A's had
  const tabs = !!ctx.tabs;
  const lead = () => !guest || (tabs && active());          // the page's column, focus mode: pane A's, or the current tab's
  const active = () => ctx.active?.() ?? true;
  // every page listener this editor adds, owned: dispose() removes them (a second editor, a reload)
  const owned = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); owned.push(() => target.removeEventListener(type, fn, opts)); };

  // ── State ──────────────────────────────────────────────────────────────────
  let autoSnap = null;
  const ui = new Map();                  // block id -> view state
  const counters = { requests: 0, partsSent: 0, mounts: 0, compiledIds: [] };
  const perf = ctx.perf ?? createPerf();
  // the document column: a DocumentView (docview/document-view.js) places the block elements; ctx.docView
  // is the page's (main.js, mounted before the modules look up #blocks), else one is mounted here
  // the top bar (chrome/top-bar.js): main.js mounts it; a page without main.js gets its own
  const root = ctx.root, topbar = ctx.topbar ?? mountTopBar(root.part('topbar'));   // the editor's container (app/editor-root.ts)
  const docView = guest ? createDocumentView(ctx.only.host, { id: ctx.only.id, primary: false })
    : ctx.docView ?? createDocumentView(root.part('doc-view-host'), { id: 'main', primary: true, domId: root.id('blocks') });
  const title = guest ? signal('') : topbar.model.title;    // the pane bar's title: a guest's own
  const blocksBox = () => docView.container;
  // the layout (data: the panes, their documents, the focused one) and the route are the page's when main.js
  // makes them; the keepers are the panes' own (no page global: tests reach them through the api)
  const layout = ctx.layout ?? createLayout();
  const router = ctx.router ?? createRouter();
  const warmer = createWarmer({ root, backend: () => backend, key: () => (S.doc ? derived.preHash : null), perf });
  // each pane's own UI state (../panes/pane-state.js): its selection, its last caret (the References
  // pane's Cite) and its last click position; the focused pane's is the one the keys and the panels use
  const paneStates = createPaneStates({ viewOf: (p, id) => panes.viewOf(p, id) });
  const focusedState = () => paneStates.of(panes.focused().id);
  const selectedId = () => focusedState().selected;

  // nested blocks: a long proof or theorem as a container and one block per paragraph (../nesting/)
  const nest = createNesting({
    doc: () => S.doc, docId: () => S.doc?.id ?? '', ui, ids, toast,
    views: (id) => panes.viewsOf(id), panes: () => panes.list(),                    // a block's views, the panes
    blockById: (id) => blockById(id), indexOf: (id) => indexOf(id),
    applyBlocks: (label, plan, o) => applyBlocks(label, plan, o),
    enterEdit: (id, e, caret) => enterEdit(id, e ?? null, caret ?? null), display: (id) => display(id),
    refsState: () => refs.refsState(), kindOf: (src) => kindOf(src), kindLabel: (k) => kindLabel(k, S.doc?.preamble.source ?? ''),
    texToText,
  });
  // ── THE DOCUMENT (../doc/session.js, one per open document, no DOM): its writes (persist), block list
  // (model), undo history (history: Mod-Z in any pane undoes its last structural change; the editors close first, a
  // toast says what was undone), what its blocks compile against (derived), its results (results: the result map, the
  // preamble's problems, the word count) and its block operations (ops, each saved and one undo step); the page around
  // it through hooks
  const S = createDocSession({ store, ids, refs, backend: () => backend, nest, salt: () => ctx.notes?.keySalt?.(backend) ?? '',
    bibpane: ctx.bibpane ?? null, recallsOf: ctx.recallsOf ?? null, readOnly: (d) => isReadOnly(d), beforeDestructive: ctx.beforeDestructive ?? null,
    hooks: {
      saveChanged: () => showSave(), saveFailed: (e) => { console.error('store:', e); reportQuota(e); },
      // a block taken out: its editors, in any pane, go with it (nothing saved from them), and the selection
      unplaced: (id) => { edits.dropBlock(id); paneStates.forget(id); },
      beforeUndo: (u, how) => undoUi.before(u, how), afterUndo: (u, how) => undoUi.after(u, how),   // edit/undo.js
      ops: {
        edits: { leaveAll: (o) => edits.leaveAll(o), leaveBlock: (id, o) => edits.leaveBlock(id, o), editorOf: (id) => edits.editorOf(id), sessionsOf: (id) => edits.sessionsOf(id) },
        applied: (rec) => applied(rec),                     // one change record per change: drawn below
        enterEdit: (...a) => enterEdit(...a), kindOf: (src) => kindOf(src), toast: (t, u) => toast(t, u), undo: () => undo(),
        duplicateOwned: (id) => feats.duplicate(id), gone: (id) => paneStates.forget(id), meta: (f, v) => setMeta(f, v),
      },
    } });
  const { persist, model, history, derived, results, ops } = S;
  const cache = results.cache;           // compile key -> BlockResult
  const { writer, write, op, logOps, saveBlock, saveMeta, flushTyping, safety, settled } = persist;
  const { blockById, indexOf, newBlock, placeBlock, unplaceBlock } = model;
  const { contextOf, enginePreamble, compileSource, ck, viewKey, viewResult, assetOf, kindOf, computeContexts } = derived;
  const { moveBlocks, moveBlock, applyBlocks, setSource } = ops;   // (the hosts of nesting, find, the outline and the References pane; the rest goes through commands)

  // ── Saving through the store (../doc/persist.js, app/save-state.js) ──
  // writes in order; a failed one is kept and retried until it succeeds. The one save indicator is the
  // document's tab: its unsaved dot in the × slot while a write has failed (the status's unsaved, also the tab's status
  // word for a screen reader). The bar's save status ("Saving…", "Saved", "Not saved" with Retry, "Read-only") is gone;
  // a failure is told once, in the toast (role=status), with Retry now; read-only is told by its toast on opening.
  let failedShown = false;
  function showSave() {
    const st = writer.state(), failed = st.failed > 0;
    results.status.unsaved(failed);                         // as data: writes that failed (kept and retried until they succeed)
    // (out of space: the quota notice has said it already, with what to do: app/quota.js; one toast either way)
    if (failed && !failedShown && active() && !isQuota(st.error)) showToast(`Not saved: ${String(st.error?.message ?? st.error ?? 'a write failed')}. Retrying.`, () => writer.retry(), { label: 'Retry' });
    failedShown = failed;
  }
  listen(window, 'pagehide', () => flushTyping());
  listen(document, 'visibilitychange', () => { if (document.hidden) flushTyping(); });

  // ── Status and toast ───────────────────────────────────────────────────────
  // with hysteresis (chrome/status.js): a fast compile shows nothing; busy after 1 s; all typeset for a while
  const status = createStatus((text, kind) => { if (active()) topbar.setStatus(text, kind); });
  function setStatus(text, kind = '') { status.set(text, kind); }
  // the page's one toast (chrome/toast.js, Preact): a new one replaces the last, one timer
  function toast(text, undo) { showToast(text, undo); }

  // ── Undo (8: the document's history, S.history) ──
  function perform(label, doFn, tags) {   /* one undo step: what doFn changes, as data (doc/ops.ts change) */ return ops.change(label, doFn, tags); }
  const undo = () => !!history.undo();
  const redo = () => !!history.redo();
  // the title form: its preamble edit is one undoable step
  const metaForm = createMetaForm({
    doc: () => S.doc, readOnly: () => isReadOnly(S.doc), editSource: (id) => enterEdit(id), focusBlock: (id) => panes.focused().viewOf(id)?.render.focus({ preventScroll: true }),
    apply: (label, text) => {
      perform(label, () => meta.putPreamble(text));             // (perform does it now)
    },
    preview: async (pre, id) => {
      const b = blockById(id); const s = splitMeta(pre); const pid = `${id}~meta`;
      const res = await backend.compile({ preamble: s.preamble, blocks: [{ id: pid, source: blockSource('title', nest.compileSource(b), s), kind: 'title', context: contextOf(b) || undefined }], keep: [], priority: 'user' });
      return res?.blocks?.[pid] ?? null;
    },
    mount: (el, r, box) => { el.dataset.nodelistB64 = r.nodelist; if (ctx.view?.colorMap) el.dataset.colorMap = ctx.view.colorMap; box.append(el); return window.reflowtex.host.mount(el); },
  });

  // ── Fonts (server backends: /fonts/<served>) ───────────────────────────────
  const fontServed = new Map();
  const fontStyle = h('style', '', { id: 'doc-fonts' });
  const family = (file) => file.replace(/\.otf$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
  function applyFonts(map) {
    let css = '';
    for (const [orig, served] of Object.entries(map ?? {})) {
      const prev = fontServed.get(orig);
      if (prev !== undefined && prev !== served) css += `@font-face { font-family: '${family(orig)}'; src: url('/fonts/${served}'); }\n`;
      fontServed.set(orig, served);
    }
    if (css) fontStyle.textContent += css;
    if (fontStyle.textContent && document.head.lastElementChild !== fontStyle) document.head.appendChild(fontStyle);
  }

  // ── Blocks in the panes (../panes/) ─────────────────────────────
  // Each block has one STATE here (ui: its result, decor, live fields) and one VIEW per pane (panes/block-view.js),
  // all made, painted and given results the same way (panes/blocks.js). No pane's element is the block's.
  const INTERACTIVE = 'a, button, [role="button"], [tabindex], .latex-link, [data-link], .latex-action, .latex-stream[data-kind="hint"]';
  /** what a view does on a click, a focus, its + and focus icon, its handle: the same in every pane */
  const viewOn = {
    click(e, v) {
      const b = blockById(v.id);
      if (!b) return;
      const s = edits.session(v.pane);                                   // the editor of the pane clicked in
      const hit = e.target.closest(INTERACTIVE);
      if (hit && hit !== v.render && v.render.contains(hit)) { if (s.id && s.id !== b.id) s.leave(); return; }
      if (b.kind === 'title' && s.id !== b.id && metaForm.open(b.id)) { if (s.id) s.leave(); return; }
      enterEdit(b.id, e, null, null, null, v.pane);
    },
    dblclick: (e, v) => enterEdit(v.id, e, null, null, null, v.pane),
    focus: (v) => select(v.id, { focus: false, pane: v.pane }),   // the selection of the pane focused in
    preview: (e, v) => enterEdit(v.id, null, null, null, null, v.pane),
    /** the + (the slash menu; the new block opens in the pane of the button) */
    add(e, v) {
      e.stopPropagation();
      openSlashMenu(v.add, (t) => command('block.insertBelow', { id: v.id, kind: t.kind, source: t.source, caret: t.caret, pane: v.pane }));
    },
    focusIcon: (e, v) => { e.stopPropagation(); focusIn(v.pane, v.id); },
    action: (v) => ui.get(v.id)?.action.peek()?.run(v),            // the block's action button (a feature's)
    attachHandle: (handle, v) => drag.attach(handle, v.id),                         // docview/drag.js
  };
  const blocks = createBlocks({
    blocks: () => S.doc?.blocks ?? [], state: root.state, ui, get panes() { return panes; }, get edits() { return edits; }, nest, viewState: (p, id, el) => paneStates.applyTo(p, id, el), view: () => ctx.view, perf, counters, cache,
    blockById: (id) => blockById(id), kindOf: (src) => kindOf(src), viewKey: (b) => viewKey(b), viewResult: (b) => viewResult(b),
    ck: (b) => ck(b), recalled: (id) => derived.recalls.has(id), markerOf: (b) => markerOf(b), blockAction: (b) => feats.blockAction(b),
    changed: () => changed(), changedLater: () => changedLater(), userBlock: (id) => userBlock(id), compileSoon: () => compileSoon(),
    showErrors: (box, problems, id) => showErrors(box, problems, id), on: viewOn,
  });

  // the panes of this document: the layout's (panes/layout.js), each made and dropped as it changes
  const panes = createPanes({
    root, layout, docView,
    // a pane showing another document is a guest (ctx.guests: main.js's workspace gives it its editor)
    owns: (x) => x.doc == null || x.doc === S.doc?.id, guests: ctx.guests ?? null,
    only: guest ? { id: ctx.only.id, el: ctx.only.pane, docView } : null, widths: ctx.widths ?? null,
    keeperFor: (o) => (perf.disabled ? null : createAnchorKeeper(o)),
    host: {
      hasDoc: () => !!S.doc,
      blocks: () => S.doc?.blocks ?? [],
      makeView: (paneId, id) => blocks.makeView(paneId, id),
      // a pane opened: its views of every block, painted as the others, the results delivered (views of them)
      opened(p, o = {}) {
        if (o.near) blocks.lazy.open(p, o.near, o.heights);              // the views out of view made lazily
        p.sync(S.doc.blocks, (id) => blocks.makeView(p.id, id));
        nest.decorate();
        blocks.redisplay();
        sectionFocus.apply(p.id);
        warmer.watch(p.view.container);                                 // intent in any pane warms the engine
        const add = p.el.querySelector(':scope > .add-end-host');
        if (add) mountAddBlock(add).addEventListener('click', () => command('block.append', { pane: p.id }));
        p.onDispose?.(() => add && unmountAddBlock(add));
      },
      // a pane closing: its editor closes with it (the other panes' are untouched), its section focus goes
      closing(p) { edits.dropPane(p.id); paneStates.drop(p.id); layout.setFocus(p.id, null); nest.unwatch(p.view.container); for (const v of p.views.values()) nest.unwatch(v.root); },
      toggled(on) { topbar.setSplit(on); sectionFocus.apply(); paneBars.layout(on); },
      closeSplit: (keep) => closeSplitKeeping(keep, { layout, panes, edits, state: root.state }),   // the pane worked in stays
    },
  });

  // a guest's one pane: what host.opened does for a pane a registry opens (its "Add a block", the warmer)
  if (guest && ctx.only.add) {
    const add = ctx.only.add;
    listen(mountAddBlock(add), 'click', () => { if (S.doc) command('block.append', { pane: panes.first.id }); });
    owned.push(() => unmountAddBlock(add));
  }
  if (guest) panes.first.onDispose(() => docView.destroy?.());
  function renderAll() {
    for (const [id, u] of ui) if (!blockById(id)) { blocks.dispose(u); ui.delete(id); }
    for (const b of S.doc.blocks) blocks.state(b);
    panes.sync();                                                       // every pane: in order, fewest moves
    sectionFocus?.apply();                                              // a focused pane stays on its section
    computeContexts();
    nest.decorate();
    blocks.redisplay();
    changed();
    feats.sync();                                                       // svgfig: owned figure files follow their blocks
  }

  /** a change of the document (doc/ops.ts: its record), drawn and compiled once: a new order, a block added or
   *  removed, the whole list; sources only, what they display (the contexts first: a definition reaches later blocks) */
  function applied(rec) {
    if (rec.order || rec.added.length || rec.removed.length) renderAll();
    else if (rec.blocks.length) { const ids = new Set(rec.blocks); sourcesChanged((b) => ids.has(b.id) || blocks.stale(b)); }
    compileSoon();
  }

  const display = (id) => blocks.display(id);
  /** sources changed (or what blocks compile against): the contexts again, the blocks `which` names shown again
   *  (all by default; a block that shows another key than it would now is `blocks.stale`), the panels */
  function sourcesChanged(which = null) { computeContexts(); blocks.redisplay(which); changed(); }
  const mount = (id, r, key) => blocks.mount(id, r, key);

  function showErrors(box, problems, id) {
    // rows of selectable text (a click that ends a selection does not jump), and Copy; Preact, edit/panel.js
    renderErrors(box, problems, { report: (p) => problemReport(id, p), open: (p) => { if (id) enterEdit(id, null, null, p.line); else openSettings(true, p.line); } });
  }

  /** a plain-text report of a problem (view/copy-errors.js): the block, the line, the source, TeX's context */
  function problemReport(id, p) {
    const b = id ? blockById(id) : null;
    const r = b ? (cache.get(ck(b)) ?? viewResult(b)) : null;
    const i = b ? indexOf(id) : -1;
    const src = b ? (edits.editorOf(id)?.text ?? b.source) : S.doc?.preamble.source ?? '';
    const sec = b ? panels.outline().filter((it) => it.level >= 1 && indexOf(it.id) <= i).pop() : null;
    return errorReport({
      title: S.doc?.title ?? '', backend: backend.id, build: r?.capture?.build ?? [...cache.values()].find((x) => x?.capture?.build)?.capture?.build ?? '',
      where: b ? { kind: b.kind, id, index: i, count: S.doc.blocks.length, section: sec ? `${sec.number ? `§${sec.number} ` : ''}${sec.title}` : '' } : { preamble: true },
      problem: p, source: src, firstLine: r?.sourcemap?.firstLine ?? null, file: r?.sourcemap?.file ?? '',
    });
  }

  // ── Figures: an SVG figure has "Edit figure" (svgfig/); PDF figures are images (the Ipe editor is gone) ──
  const figureNames = (src) => derived.figureNames(src);
  async function editFigure(id, name = null, opts = {}, view = null) {
    const b = blockById(id);
    const f = b && figureNames(b.source).find((x) => !name || x.name === name);
    // an SVG figure; the editor opens from the view it was asked from (its picture), else the focused pane's
    if (f && svgFigs.isSvg(f.name)) return svgFigs.edit(b, view ?? panes.focused().viewOf(id), f, opts);
  }
  // SVG figures (svgfig/app-hooks.js): the editor, and drawn figures as files that follow their blocks
  const svgFigs = createSvgFigureHooks({ ctx, doc: () => S.doc, store, backend: () => backend, ids, write, op, logOps, perform, history, unplaceBlock, placeBlock,
    newBlock, indexOf, blockById, renderAll, compileSoon, display, redisplay: (w) => blocks.redisplay(w), leaveEdit: (o) => edits.leaveAll(o), editing: () => edits.activeId(), editFigure, saveBlock, toast, hash, assetHash: derived.assetHash, GRAPHICS, assetOf, figureNames: (s) => figureNames(s) });

  // ── Features (app/feature.ts): what each adds to every document editor; a new one is one entry here ──
  const feats = composeFeatures([
    { id: 'nesting', blockItems: (id, item) => nest.menuItems(id, item) },           // split into paragraphs / join into one block
    svgFigs,                                                                         // drawn figures
    { id: 'inspector', blockItems: (id, item, anchor) => (advanced.peek() && ctx.inspector?.available() ? [item('Inspect boxes and glue', 'inspect',   // advanced
      () => ctx.inspector.open({ block: id, pane: anchor?.closest?.('[data-pane]')?.dataset.pane ?? null }))] : []) },   // in the pane the menu was opened in
    { id: 'notes', docItems: (item) => (advanced.peek() ? (ctx.notes?.menuItems?.(item) ?? []) : []) },   // Hide notes, Comments as notes
  ]);

  // ── Editing (../edit/: an editing session per pane, two at once) ──
  // The sessions (edit/session.js: CodeMirror, the source panel, the error note, the mirrored caret) and the
  // block's live preview (edit/live.js) are out of here. a pane's session always edits on that
  // pane's view of the block: the same in every pane; the same block in two panes is two surfaces, one source.
  /** the pane's scroll host for an editor's caret and popover (the window while it is the only pane) */
  function paneScroll(p) {
    const P = paneFor(p);                                 // that pane, else the focused one (as everywhere)
    if (!P) return null;
    const b = P.box();
    return { ...b, origin: P.scroller ? b.top : 0, split: !!P.scroller, scrollBy: (dy) => P.scrollBy(dy) };   // (its scrollBy tells the keeper)
  }
  const editorHelpers = () => ({
    complete: { labels: (cmd) => panels.labelOptions(cmd), cites: () => panels.citeOptions() },
    hover: (k) => panels.hoverCard(k),
    goto: (k) => gotoDefinition(k),
  });
  const edits = createEditing({
    root, ui, get view() { return ctx.view; }, blockById: (id) => blockById(id), hasDoc: () => !!S.doc,
    viewOf: (p) => panes.get(p)?.view ?? null,
    select: (id, o) => select(id, o),
    // a press in a pane of another document is in a pane all the same: this editor's sessions stay open
    paneOf: (el) => panes.paneOf(el) ?? el?.closest?.('main[data-pane]')?.dataset.pane ?? null,
    /** the pane an editor opens in: the one asked for, else the one clicked in (null: the editing registry decides) */
    paneFor: (o) => { const p = o.pane ?? (o.event?.target ? panes.paneOf(o.event.target) : null); return p && panes.get(p) ? p : null; },
    hasPane: (p) => !!panes.get(p),
    paneCount: () => panes.list().length,
    /** a render's caret map made ahead (the pointer is over it): what a click on it will need */
    warmCaretMap: (render) => {
      const root = render.closest('.blk[data-id]'), id = root?.dataset.id, b = id && blockById(id), u = id && ui.get(id);
      if (!b || !u?.mounted || edits.isEditing(id) || u.mounted.ck !== viewKey(b)) return;
      ctx.view?.warmMap?.(render, cache.get(u.mounted.ck), b.source);
    },
    focusedPane: () => panes.focused().id,
    // where pane `pane` edits block `id`: its own view of it
    surfaceFor: (id, pane) => { const v = panes.viewOf(pane, id); return v ? { surface: v } : null; },
    blockOf: (id) => blocks.blockIn(id),
    queue: { left: (id) => queue.left(id) },
    setLastCaret: (c, pane) => { paneStates.of(pane ?? panes.focused().id).lastCaret = c; },
    leaving: (id, started) => { const b = blockById(id); if (b && b.source.trim() && b.source !== started) b.kind = kindOf(b.source); },
    typed: (b) => { saveBlock(b, { typing: true }); refresh.typed(); }, recordTyping: (s, update) => undoUi.typed(s, update),   // steps of the document's history
    closed: (id, started) => {
      const b = blockById(id);
      if (b) { const t = persist.typingOf(id); persist.cancel(id); if (t || b.source !== started) saveBlock(b); }
      sourcesChanged((x) => x.id !== id && blocks.stale(x));     // the others whose context moved
      compileSoon();
    },
    display: (id) => display(id),
    paneEls: () => panes.list().map((P) => ({ id: P.id, el: P.view.container?.parentElement ?? null })),   // where each pane's first editor is warmed
    // what a session asks for (edit/session.js)
    sessionHost: {
      ui, cache, get find() { return find; },
      blockById: (id) => blockById(id), indexOf: (id) => indexOf(id), viewKey: (b) => viewKey(b), ck: (b) => ck(b),
      createEditor, editorHelpers, editorKey: (s, name) => editorKey(s, name), display: (id) => display(id),
      /** does the surface (a pane's view) show the block's current result? */
      shows: (sf, u) => !!sf.mounted && !sf.render.hidden && sf.mounted.ck === u.mounted?.ck,
      viewerBlock: (sf) => sf.mounted?.block ?? null,
      setLastPosition: (p, pane) => { paneStates.of(pane ?? panes.focused().id).lastPosition = p; },
      scrollBy: (p, dy, o) => panes.get(p)?.scrollBy(dy, o),
      paneBox: (p) => paneFor(p).box(),                    // no invented 56 px: that pane, else the focused one
      keeperOf: (p) => panes.get(p)?.keeper ?? null,
      paneScroll: (p) => paneScroll(p),
      // a pane as the popover's motion sees it (motion/popover.js): its box, scroll range, what moves, its keeper
      motionPane: (p) => {
        const P = panes.get(p);
        return P ? { box: () => { const b = P.box(); return { ...b, origin: P.scroller ? b.top : 0 }; }, range: () => P.range(), moving: () => P.moving(),
          scrollBy: (dy) => P.scrollBy(dy), keeper: P.keeper, relayout: () => nest.layoutHeads?.() } : null;
      },
      problemReport: (id, p) => problemReport(id, p), openProblem: (id, p) => enterEdit(id, null, null, p.line),
      marksFor: (id, text) => panels.marksFor(id, text),
    },
    // what the live preview asks for (edit/live.js)
    liveHost: {
      ui, cache, get queue() { return queue; },
      blockById: (id) => blockById(id), viewKey: (b) => viewKey(b), viewResult: (b) => viewResult(b),
      mount: (id, r, key) => mount(id, r, key), display: (id) => display(id), compileSoon: () => compileSoon(),
      needsCompile: (b) => needsCompile(b), blocks: () => S.doc?.blocks ?? [], delay: () => ctx.view?.previewDelay,
    },
  });

  /** Open block `id` for editing: in `pane` (split view), else the pane clicked in, else the pane edited last. */
  function enterEdit(id, event = null, caret = null, line = null, range = null, pane = null) {
    if (isReadOnly(S.doc)) { toast(readOnlyNote(S.doc)); return; }
    nest.reveal(id);                                       // a paragraph of a collapsed container is shown first
    edits.enter(id, { event, caret, line, range, pane });
  }

  /** a key the block's editor does not handle itself, in the session `s` (its pane): ../commands/editor-keys.js */
  const editorKey = createEditorKeys({ command: (...a) => command(...a), doc: () => S.doc, indexOf, blockById, enterEdit: (...a) => enterEdit(...a),
    openSlashMenu: (...a) => openSlashMenu(...a), focusEditor: (pane) => edits.session(pane).editor?.view.focus() });

  // ── Drag to reorder (the handle), or click it for the block's menu (docview/drag.js, in and between panes) ──
  const drag = createBlockDrag({
    root, nest, leaveAll: () => edits.leaveAll(), openMenu: (handle, id) => openBlockMenu(handle, id),
    panes: () => panes.list().map((p) => p.id),
    paneOf: (el) => panes.paneOf(el),
    box: (p) => panes.get(p)?.view.container ?? null,
    scroller: (p) => panes.get(p)?.scroller ?? null,
    elementIn: (p, id) => panes.viewOf(p, id)?.root ?? null,
  });

  // ── Menus (app/doc-menus.ts): the block's, the document's, the slash menu; features add their entries here ──
  const menus = createDocMenus({ doc: () => S.doc, indexOf, get commands() { return commands; }, blockItems: feats.blockItems, docItems: feats.docItems, slash: feats.slash });
  const openSlashMenu = (anchor, onPick, onCancel) => menus.openSlash(anchor, onPick, onCancel);
  const openBlockMenu = (anchor, id) => menus.openBlock(anchor, id), openDocMenu = (anchor) => menus.openDoc(anchor), closeMenu = (c) => menus.close(c);

  // a press outside a menu and Escape: the kit's one overlay layer (chrome/menu.js)

  // ── Files: versions, the seed reset and banner, import, exports (app/doc-files.ts) ──
  const files = createDocFiles({ doc: () => S.doc, store, io: () => ctx.io, leaveEditors: () => edits.leaveAll(), settled, toast, setStatus, forExport: (d) => feats.forExport(d),
    pdf: () => (typeof backend.pdf === 'function' ? backend.pdf(pdfRequest(S.doc, nest.flatten)) : null), mountVersions: ctx.mountVersions, reopen: (id) => ctx.reopen?.(id),
    openDoc: (id) => router.openDoc(id), bannerHost: () => (guest && !tabs ? null : tabs ? ctx.only.pane : root.part('page')) });   // pane A's; each tab's first pane

  // ── Compiling (the scheduler is app/compile-queue.js) ───────
  const queue = createCompileQueue({
    doc: () => S.doc, backend: () => backend, cache, keyOf: (b) => ck(b), compileSource: (b) => compileSource(b), preamble: () => enginePreamble(), contextOf: (b) => contextOf(b),
    skip: (b) => !!markerOf(b) || derived.recalls.has(b.id), isEditing: (id) => edits.isEditing(id), visible: blocks.visible, indexOf: (id) => indexOf(id), perf, counters,
    display: (id) => display(id), redisplay: (w) => blocks.redisplay(w), stale: (b) => blocks.stale(b), token: (id) => ui.get(id)?.token, compiling: (id, on) => ui.get(id)?.cls('compiling', on),
    liveSending: (keys) => edits.live.sending(keys), liveLanded: (id, key) => edits.live.landed(id, key), persist: (key, r) => store.cache.put(key, r).catch(() => {}),
    setStatus: (t, k) => setStatus(t, k), progress: (left, nErr) => results.status.typesetting(left, nErr), preHash: () => derived.preHash, preambleLanded: (r) => { results.preamble.value = r; showPreambleState(); },
    applyFonts: (f) => applyFonts(f), changed: () => changed(), changedLater: () => changedLater(), batch: BATCH,
    shownStale: (b) => shownStale(b),
  });
  /** a block not being edited whose cached result is not what it shows (whenIdle waits for that display) */
  function shownStale(b) {
    const r = viewResult(b), u = ui.get(b.id);
    if (!r || !u || edits.isEditing(b.id)) return false;
    return u.state === 'pending' || (r.status === 'ok' && !!r.nodelist && blocks.stale(b));
  }
  function compileSoon() { queue.soon(); }
  function settle() { queue.settle(); }
  function needsCompile(b) { return queue.needsCompile(b); }
  function userBlock(id) { return queue.userBlock(id); }

  /** Blocks TeX typesets nothing for: shown as a marker or their source, never compiled. */
  function markerOf(b) { return markerKind(b, nest.isContainer); }   // (app/kinds.js) a block the page draws itself: not compiled

  // ── Refs, contexts, panels (the contexts: ../doc/derived.js) ───────────────

  // when the refresh runs: app/refresh.ts (never while the reader types or clicks); what it does: here
  const refresh = createRefresh({ hasDoc: () => !!S.doc, perf, work: () => {
    try {
      // one view of each block (the first pane's): the viewer sets the live text in every view of it
      refs.update({ preamble: S.doc.preamble.source, bib: S.doc.bib }, S.doc.blocks.map((b) => {
        const m = ui.get(b.id)?.mounted, block = m ? blocks.blockIn(b.id, panes.first.id) : null;
        return { id: b.id, kind: b.kind, source: b.source, el: block?.el ?? null, block, key: m?.key ?? null };
      }));
    } catch (e) { console.error('refs.update:', e); }
    nest.refreshHeads();                                   // "Theorem 3 · title" on container rows
    panels.refresh();
    edits.marks();                                          // the marks in every open editor
    find.refresh();
    bump(root.state.refreshed);                            // the container's signal (app/page-state.ts)
  } });
  /** Something changed (a mount, a structure change, a save): refs and the panels soon; a background result: later */
  function changed() { refresh.changed(); }
  function changedLater() { refresh.changedLater(); }

  /** a \ref's \label, a \cite's \bibitem (app/goto-definition.ts), revealed */
  function gotoDefinition(k) {
    const d = definitionOf(k, { blocks: S.doc.blocks, refs: refs.refsState() });
    if (d.block) revealBlock(d.block, d.range, d.edit === false ? { edit: false } : undefined);
    if (d.say) toast(d.say);
    return true;
  }

  /** the pane a jump, a find or a selection acts in: the one asked for, else the focused one */
  const paneFor = (p = null) => panes.get(p) ?? panes.focused();

  // ── Commands (../commands/): every intent, one registry; the menus, the page's keys, the block editor's
  // keys, the shortcuts dialog and editorAPI call it. The context is what a command acts on: this document's
  // DocSession, the selection and the focused pane, and the page's actions
  const commands = createCommands({ context: (via) => ({
    via, S, selected: () => selectedId(), editing: () => edits.active,   /* the block editor worked in (editor.bold) */ select: (id, o) => select(id, o), focusedPane: () => panes.focused().id,
    enterEdit: (...a) => enterEdit(...a), parentAt: (k) => nest.parentAt(k),
    /** the block after (dir 1) or before (-1) index `from` that is shown; from -1: the first one in view */
    selectStep: (from, dir) => selectIndex(from < 0 ? firstVisible() : nest.visibleStep(from, dir)),
    selectIndex: (k) => selectIndex(k),
    /** the slash menu at block `id` in pane `pane` (the focused one): the kind picked is a new block below it */
    slashBelow: (id, pane) => { const P = panes.get(pane) ?? panes.focused(); openSlashMenu(P.viewOf(id)?.root ?? P.el, (t) => command('block.insertBelow', { id, kind: t.kind, source: t.source, caret: t.caret, pane: P.id })); },
    page: {
      find: () => find.open(), toggleFocus: (on) => toggleFocus(on), focusSection: (id, pane) => sectionFocus.set(pane ?? panes.focused().id, id), toggleSidebar: () => ctx.shell.toggleSidebar(), shortcuts: () => showShortcuts(),
      settings: (open, line) => openSettings(open, line), versions: () => files.openVersions(), resetSeed: () => files.resetSeed(), importTex: () => files.importTex(),
      exportTex: () => files.exportTex(), exportZip: (o) => files.exportZip(o), exportPdf: () => files.exportPdf(), toggleSplit: () => (ctx.shell.toggleSplit ? ctx.shell.toggleSplit() : panes.toggle()),   /* the host splits (a tab beside) */
      gotoDefinition: (k) => gotoDefinition(k), setPreamble: (s) => meta.putPreamble(s), recompileAll: () => { if (S.doc) meta.onPreamble(); },
      scrollTo: (id, pane, o) => scrollToBlock(id, pane, o), reveal: (id, range, o) => revealBlock(id, range, o), openNote: (t) => ctx.notes?.openNote(t, root) || revealBlock(t.blockId, { from: t.offset, to: t.offset + t.length }),   // the panels' commands
      can: { versions: () => !!ctx.mountVersions, resetSeed: () => !!(S.doc && ctx.io?.isSeedDoc?.(S.doc.id)), importTex: () => !!ctx.io?.openImportTex,
        exportZip: () => !!ctx.modulesReal?.io, exportPdf: () => typeof backend.pdf === 'function' },
    },
  }) }).define(editorCommands(MOD));
  /** a command called from here: the menus and buttons ('ui'), the keys ('key'), editorAPI ('test') */
  const command = (id, input = {}, via = 'ui') => commands.call(id, input, { via });
  function selectIndex(k) { const b = S.doc.blocks[Math.max(0, Math.min(k, S.doc.blocks.length - 1))]; if (b) select(b.id); }

  // ── Keyboard navigation and focus mode ────────────────────────────────
  /** the keyboard selection: pane `pane`'s (the focused one's: per pane), shown on its view there;
   *  the focus goes to that view */
  function select(id, { focus = true, scroll = true, pane = null } = {}) {
    const P = paneFor(pane);
    paneStates.select(P.id, id && ui.get(id) ? id : null);
    nest.selected?.(id);                                // a selected container shows its paragraphs' handles
    const u = id && ui.get(id);
    if (!u) return;
    if (focus && !edits.isEditing(id)) {
      const v = P.viewOf(id);
      if (!v) return;
      // a container has no row: its handle (labelled with the kind and number) takes the focus
      const head = v.root.classList.contains('nest-head') ? v.root.querySelector(':scope > .gutter .g-handle') : null;
      const target = head ?? (v.render.hidden ? v.preview : v.render);
      if (v.preview === target) target.tabIndex = 0;
      target.focus({ preventScroll: true });
      const r = v.root.getBoundingClientRect(), bx = P.box();
      if (scroll && (r.top < bx.top + 4 || r.bottom > bx.bottom - 20)) nav.reveal(P.id, v.root, { align: 'nearest' });
    }
  }
  function toggleFocus(on = !root.has('focus-mode')) {
    void panes.widths.transition(() => root.flag('focus-mode', on), { animate: false });   // the columns go at once: lines kept, one re-break at the new width
    safeSet('rtx-editor.focus', on ? '1' : '');
    toast(on ? `Focus mode · ${MOD}⇧F or Esc to leave` : 'Focus mode off');
  }

  // the page's keys: one table, app/doc-keys.ts (the order of its rows is the keys' precedence)
  const keys = createDocKeys({ takes: (e) => !!S.doc && active() && root.takesKey(e) && root.part('view')?.hidden === false, menuOpen: () => menus.open,
    selected: () => selectedId(), indexOf, blocks: () => S.doc.blocks, focusedPane: () => panes.focused().id, focusMode: () => root.has('focus-mode'),
    clearSelection: () => { paneStates.select(panes.focused().id, null); document.activeElement?.blur(); nest.selected?.(null); }, select: (id) => select(id),
    command: (id, input = {}) => command(id, input, 'key') });
  listen(document, 'keydown', (e) => { keys.handle(e); });
  function firstVisible() {
    const P = panes.focused(), top = P.box().top + 4;
    const k = S.doc.blocks.findIndex((b) => { const v = P.viewOf(b.id); const r = v && v.root.offsetParent !== null ? v.root.getBoundingClientRect() : null; return r && r.bottom > top; });
    return Math.max(0, k);
  }

  function showShortcuts() {
    openShortcuts(commands.shortcuts());               // the kit's Dialog (chrome/shortcuts.js); its rows are the commands'
  }

  // ── The preamble and the bibliography (app/doc-meta.ts) ─────────
  const meta = createDocMeta({ doc: () => S.doc, saveMeta, backend: () => backend, enginePreamble: () => enginePreamble(), preambleChanged: () => derived.preambleChanged(),
    statusFull: () => results.status.full(), setPreambleResult: (r) => { results.preamble.value = r; }, showPreambleState: () => showPreambleState(),
    everyBlockChanged: () => { sourcesChanged(); compileSoon(); }, compileSoon: () => compileSoon(), warm: () => warmer.idle(), perform });
  function showPreambleState() {
    if (active()) showPreambleErrors(root, results.preambleErrors);    // the sheet's list and the outline entry's badge (it does not open by itself)
    panels.refresh();
  }
  // the preamble is in no pane: Document settings, a side sheet (settings/) the outline's first entry opens
  const settings = createSettings({ root,
    doc: () => S.doc, readOnly: () => isReadOnly(S.doc), notes: ctx.notes ?? null, bibInfo: () => meta.bibInfo(),
    backends: () => ctx.backends.map((b) => ({ id: b.id, label: b.label })), backend: () => backend.id, setBackend: (id) => setBackend(id),
    applyPreamble: (text) => { perform('Edit the preamble', () => meta.putPreamble(text)); },
  });
  function openSettings(open, line = null) { if (open) settings.open({ tab: 'preamble', line }); else settings.close(); }

  // ── Wiring the static page ─────────────────────────────────────────────────
  if (!guest) {
    listen(root.part('add-end'), 'click', (e) => { if (e.target.closest?.('.add-end')) command('block.append', { pane: 'a' }); });
    topbar.on.menu = (btn) => openDocMenu(btn);
  }
  // section focus: the heading's focus icon narrows the pane it is in to the section; its state is
  // the layout's (each pane entry's focus)
  const sectionFocus = createSectionFocus({
    state: root.state, outline: () => panels.outline(), doc: () => S.doc,
    ids: () => layout.ids().filter((p) => panes.get(p)), get: (p) => layout.pane(p)?.focus ?? null, put: (p, id) => layout.setFocus(p, id),
    elementIn: (p, id) => panes.viewOf(p, id)?.root ?? null,
    pane: (p) => panes.get(p) ?? null,                                 // the pane itself, not a copy of some of it
  });
  // the panes' breadcrumb bars
  // navigation: a target outside a pane's section focus leaves it first; Back comes back (nav/navigate.js)
  const nav = createNavigator({
    pane: (p) => panes.get(p) ?? null,
    focused: () => panes.focused().id, focus: sectionFocus, toast: (t) => toast(t),
  });
  // a block shown in a pane: a find's, a go-to's, the outline's jump, a flash (../nav/reveal.js)
  const { revealBlock, scrollToBlock, flashBlock } = createReveal({ pane: (p) => paneFor(p), has: (id) => !!ui.get(id), nav,
    session: (p) => edits.session(p), enterEdit: (...a) => enterEdit(...a), select: (id, o) => select(id, o) });
  const undoUi = createUndo({ S, edits, panes, revealBlock, toast, saveBlock, sourcesChanged: (id) => sourcesChanged((x) => x.id === id || blocks.stale(x)), compileSoon: () => compileSoon() });
  // a key in a pane of another document is that document's; one outside the panes, the current document's
  const NONE = '\u0000none';
  owned.push(installScrollKeys({ pane: (p) => panes.get(p) ?? null,
    paneOf: (el) => panes.paneOf(el) ?? (el?.closest?.('main[data-pane]') ? NONE : null), focused: () => (active() ? panes.focused().id : NONE) }));
  const paneBars = wirePaneBars({ sectionOf: (p) => paneStates.of(p).section, root, panes, layout, sectionFocus, topbar, title, onTitle: (t) => setTitle(t), split: guest, draw: !tabs,
    outline: () => panels.outline(), store, docId: () => S.doc?.id ?? null, scrollToBlock, router, nav });
  function focusIn(p, id) { sectionFocus.set(p, sectionFocus.get(p) === id ? null : id); }
  function setTitle(text) {
    if (!S.doc) return;
    S.doc.title = text;
    if (guest) title.value = text;
    if (active()) document.title = `${S.doc.title || 'Untitled'} · ReflowEd`;
    persist.setTitle();                                     // written after 400 ms of quiet
  }
  if (!guest) {
    topbar.on.split = () => panes.toggle();
    topbar.on.title = (text) => setTitle(text);
  }
  function setBackend(id) {
    base = ctx.backends.find((b) => b.id === id) ?? base; bindBackend(S.doc?.id ?? null);
    safeSet('rtx-editor.backend', backend.id);
    if (S.doc) { const id = S.doc.id; backend.setAssets?.((name) => store.getAssetByName?.(id, name) ?? Promise.resolve(null)); backend.setBib?.(S.doc.bib); }
    meta.onPreamble();
  }

  const panels = createPanels({
    root, get doc() { return S.doc; }, refs, ui, cache, ck: (b) => ck(b), active,   // drawn in the sidebar while current
    focusedView: (id) => panes.focused().viewOf(id), focusedBox: () => panes.focused().box(), focusedSection: () => sectionFocus.get(panes.focused().id),   // the outline follows the focused pane
    preambleProblems: () => results.preamble.peek().errors ?? [], words: results.words,
    thmSet: () => derived.thmSet,
    indexOf, commands: { call: (id, input) => command(id, input), enabled: (id, input) => commands.enabled(id, input) },   // the panels act through commands
    preambleEntry: { problems: preambleProblemsOf(root) }, get files() { return filesHost; },   // the preamble's entry;
    counts: () => countDoc(), noteColour: ctx.notes?.colour,
    extraBib: ctx.bibpane?.extraBib ? () => ctx.bibpane.extraBib(S.doc) : null, problemAction: ctx.bibpane?.problemAction,
    problemReport,                                                      // Copy / Copy all
  });
  // the Files panel: the export's own list (io/files.ts), after the pending writes; a click goes to the first use
  // one Files panel per page: the current document's (main.js installs it once, through filesHost)
  const filesHost = {
    list: async () => {
      if (!S.doc || !ctx.io?.files) return null;
      const id = S.doc.id;
      while (writer.pending) await writer.idle();
      if (S.doc?.id !== id) return null;
      return ctx.io.files(await files.exportDoc(), files.assetOf(id));
    },
    goTo: async (id) => { if (await nav.goTo(id, { align: 'center' })) flashBlock(id); },
    // where: the block's section and its kind ("§2.1 · Figure"); the outline's locator, its words left out
    locator: (id) => {
      const loc = panels.locator(id), b = S.doc?.blocks.find((x) => x.id === id);
      const sec = loc.includes(' · ') ? loc.slice(0, loc.indexOf(' · ')) : '';
      return [sec, b ? kindLabel(b.kind, S.doc.preamble.source) : ''].filter(Boolean).join(' · ') || loc;
    },
  };
  const find = createFind({ root, get doc() { return S.doc; }, ui, active, get editing() { return edits.activeId(); }, editorOf: (id) => edits.editorOf(id), setSource, revealBlock, perform, toast, blockById, safety, undo: () => command('doc.undo') });

  function countDoc() {
    let words = 0, inline = 0, displays = 0, characters = 0;
    for (const b of S.doc.blocks) {
      if (b.kind === 'bibliography') continue;
      const c = countWords(b.source);
      words += c.words; inline += c.inline; displays += c.displays;
      characters += texToText(blankComments(b.source)).length;
    }
    return { words, inline, displays, characters, blocks: S.doc.blocks.length };
  }

  // ── the bibliography: what src/bibpane/ (the References pane) may do ──
  function setMeta(f, v) {   /* an undo or a redo of the title, the preamble or the bibliography */ if (f === 'preamble') meta.putPreamble(v); else if (f === 'bib') meta.bibAgain(v); else if (f === 'title') { setTitle(v); if (!guest) topbar.setTitle(v ?? ''); } }
  function bibHost() {
    return {
      doc: () => S.doc, store,
      editing: () => { const s = edits.active; return s?.editor ? { id: s.id, view: s.editor.view } : null; },
      lastCaret: () => focusedState().lastCaret, setLastCaret: (c) => { focusedState().lastCaret = c; },
      editAtPoint: (id, ev) => enterEdit(id, ev),
      setSource: (id, s, o) => setSource(id, s, o),
      setBib: (b, l, a) => meta.setBibliography(b, l, a), applyBib: (b, a) => meta.applyBib(b, a),
      group: (label, doFn) => perform(label, doFn),
      putAsset: (a, bytes) => persist.putAsset(a, bytes),
      revealBlock, flash: flashBlock, toast, undo, safety,
      outline: () => panels.outline(), refsState: () => refs.refsState(),
    };
  }
  if (ctx.connectBib !== false) ctx.bibpane?.connect(bibHost());   // main.js's workspace connects the current editor's

  // ── Open / close ───────────────────────────────────────────────────────────
  async function open(id) {
    close();
    const w = ctx.writesSettled?.(id); if (w) await w;    // the last editor of this document wrote everything
    if (!(await S.load(id))) return false;                 // the document: read, sorted, its nesting repaired
    bindBackend(id); feats.loaded(S.doc);                                  // its SVG figures and their colours
    S.loaded();
    if (isReadOnly(S.doc)) { onReadOnlyOpen(S.doc, { store, io: ctx.io, prepare: (d) => feats.forExport(d), toast, open: (x) => router.openDoc(x) }); showSave(); }
    else try { autoSnap = ctx.AutoSnapshots ? new ctx.AutoSnapshots(store, id).start() : null; } catch (e) { console.warn('auto snapshots:', e.message); }
    persist.opened();
    if (guest) title.value = S.doc.title ?? ''; else topbar.setTitle(S.doc.title ?? '');
    if (active()) document.title = `${S.doc.title || 'Untitled'} · ReflowEd`;
    settings.close({ apply: false });
    // (integration) \includegraphics names → this document's assets in the store (contract Backend.setAssets)
    backend.setAssets?.((name) => store.getAssetByName?.(id, name) ?? Promise.resolve(null));
    await Promise.resolve(backend.setBib?.(S.doc.bib)).catch(() => {});
    derived.preambleChanged();
    // the paper column from the preamble's cached result, before the first paint; else once it warms
    const known = await Promise.resolve(backend.knownPreamble?.(enginePreamble())).catch(() => null);
    if (known?.textwidthPt && lead()) ctx.view?.textwidthHint?.(known.textwidthPt);      // the column is pane A's document's
    Promise.resolve(backend.setPreamble?.(enginePreamble())).then((r) => { if (r?.textwidthPt && S.doc?.id === id && lead()) ctx.view?.textwidthHint?.(r.textwidthPt); if (r?.errors?.length) { results.preamble.value = r; showPreambleState(); } }).catch(() => {});
    results.status.full();                                 // the document opened: the full bar for its first run
    renderAll();
    showSave();
    setStatus('');
    if (safeGet('rtx-editor.focus') === '1' && lead()) root.flag('focus-mode', true);
    compileSoon();
    files.showSeedBanner(id);
    panes.start();                                         // every pane's anchor keeper
    warmer.watch(blocksBox());
    warmer.idle();
    return true;
  }
  function close() {
    if (!S.doc) return;
    settings.close();                                      // an open sheet's changes apply to this document first
    panes.closeAll();                                      // split view ends with the document (its editor with it)
    panes.stop();
    closeOlderCorePrompt();
    files.removeSeedBanner();
    edits.leaveAll({ animate: false });
    flushTyping();
    closeMenu();
    find.close();
    for (const u of ui.values()) blocks.dispose(u);
    ui.clear();
    sectionFocus.reset();
    S.unload();
    panes.sync();                                                       // no views left
    results.clear();
    queue.reset();
    history.clear();
    paneStates.reset();                                                 // every pane's selection, caret, position
    autoSnap?.stop(); autoSnap = null;
    files.closeVersions();
    if (!guest) { root.flag('focus-mode', false); root.flag('editing', false); }
    bindBackend(null); settle();                                        // the engine's state of it released
  }

  /** The document as it is now (sources straight from an open editor). */
  function snapshotDoc() {
    const d = JSON.parse(JSON.stringify(S.doc));
    for (const sx of edits.sessions()) { const b = d.blocks.find((x) => x.id === sx.id); if (sx.editor && b) b.source = sx.editor.text; }
    return d;
  }

  // ── The test surface (contracts.d.ts EditorAPI, the doc part) ─────────────
  const api = createTestApi({ S, edits, queue, ui, viewResult, viewKey, blocks, root, writer, panes, snapshotDoc, refs, nest, cache, ck, counters, enterEdit, paneStates, command, commands, settings, panels, find, countDoc,
    status, selectedId, editFigure, feats, metaForm, layout, warmer, sectionFocus, nav, drag, moveBlock, indexOf, derived, get backend() { return backend; }, get refreshTimer() { return refresh.pending; } });   // app/test-api.js

  /** the editor's page listeners, its panes, its editing registry: gone (a second editor instance, a hot reload) */
  function dispose() {
    close();
    for (const off of owned.splice(0)) off();
    edits.dispose();
    panes.dispose();
    blocks.destroy();
    panels.dispose?.();
    paneBars.dispose?.();
    warmer.dispose?.();
    feats.dispose();
    if (!ctx.perf) perf.dispose();                         // its own (a guest shares the first editor's)
  }

  // the page's UI handed to this editor (its document is the focused pane's) and back
  function activate() {
    topbar.on.menu = (btn) => openDocMenu(btn);
    if (S.doc) document.title = `${S.doc.title || 'Untitled'} · ReflowEd`;
    showSave();
    const sh = status.shown(); topbar.setStatus(sh.text, sh.kind);
    showPreambleErrors(root, results.preambleErrors); root.state.panels.value = panels.host;   // the container's panels follow this document
    if (S.doc) panels.refresh();
  }
  function deactivate() {
    find.close();
    closeMenu();
    paneBars.closeMenu?.();
  }

  return { open, close, dispose, api, get doc() { return S.doc; }, session: S, status: results.status.value, title, section: (p) => paneStates.of(p ?? panes.first.id).section,   /* status and crumbs as data */ addPane: (id, c) => panes.add(id, c), removePane: (id) => panes.remove(id),   /* a guest's other panes */ writesIdle: () => { flushTyping(); return writer.idle(); }, run: command, nav,   /* app/doc-host.js */ backendId: () => backend?.id ?? null, setTitle: (t) => setTitle(t), outline: () => panels.outline(), focusedSection: (p) => sectionFocus.get(p ?? panes.focused().id),   /* a tab's section menu */ toggleFocus, get widths() { return panes.widths; }, activate, deactivate, bibHost, filesHost, panes: () => panes, perf };
}

export { scanHeadings, scanTodos, todoMacros };
