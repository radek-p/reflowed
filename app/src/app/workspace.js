// THE WORKSPACE: the open documents, one document editor each (app/app.js, which
// makes the document's DocSession), and which one is CURRENT: the focused pane's document's. The page's UI — the top
// bar, the sidebar's panels, find, the keys, Document settings, the References pane, the Files panel — is the current
// editor's: it is handed over (activate / deactivate) when the focus moves to a pane of another document, and
// root.state.current (the container's: app/page-state.ts) says so to whoever reads it. Out of main.js.
//
// The first editor is the route's document: pane A, and any pane showing it. A pane whose layout entry names another
// document is a GUEST of the first editor's panes registry: the editor of THAT document shows it there (one
// editor, so one DocSession and one history, per document, however many panes show it), made on the <main> that
// registry gives it for its first pane (its own refs, the engine's state for its document), gone with its last pane.
//
//   const ws = createWorkspace({ layout, router, createEditor, common, refs, makeRefs, backend, backends, docView })
//   ws.editor        the first editor (pane A's)            ws.current()   the focused pane's document's editor
//   ws.forPane(p)    pane p's editor (tests: its api), else the current one
//   ws.sessions()    Map docId -> { editor, panes } of the open documents
//   ws.editors()     [[pane, editor]] of the open documents  ws.follow()    the page's UI handed to the current editor
//   ws.hosts         page features' hosts (app/doc-host.js): at(node) the document of the pane a node is in,
//                    forPane(p), current(), all() (one per open document)
import { effect } from '@preact/signals';
import { docHost } from './doc-host.js';

export function createWorkspace({ layout, router, createEditor, common, refs, makeRefs, backend, backends, docView }) {
  const guests = new Map();                                // pane id -> its editor (the editor of its document)
  // ONE editor (so one DocSession: one writer, one model, one history) per open DOCUMENT, shared by every pane
  // showing it: docId -> { ed, panes: Set(pane id) }. The first editor's document is its own (every pane showing it
  // is that editor's); a guest's goes when its last pane does, and a document opened again (in any pane) waits for
  // the writes of its last editor first (writesSettled).
  const sessions = new Map();
  const writes = new Map();                                // docId -> the writes of its last editor, still going
  let editor = null;                                       // pane A's (current while it is being made)
  let shownCurrent = null;
  const current = () => guests.get(layout.focused.peek()) ?? editor;
  const writesSettled = (docId) => {
    const live = sessions.get(docId)?.ed;                  // still open in a pane: what it typed written first
    const w = live ? live.writesIdle?.() : writes.get(docId);
    return w ? Promise.resolve(w).catch(() => {}) : null;
  };

  editor = createEditor({ ...common, refs, backend, docView, writesSettled,
    active: () => !editor || current() === editor,
    reopen: async (id) => { editor.close(); await editor.open(id); },
    guests: {
      open(id, chrome) {
        const docId = layout.pane(id)?.doc;
        const have = sessions.get(docId);
        if (have) {                                        // the document is open in another pane: the same editor
          have.panes.add(id);
          guests.set(id, have.ed);
          const p = have.ed.addPane(id, chrome);
          follow();
          return p;
        }
        const own = makeRefs();
        own.setSlots?.('instances');
        let ed = null;
        ed = createEditor({ ...common, refs: own, writesSettled, backend: backends.find((b) => b.id === editor.backendId()) ?? backend,
          only: { id, pane: chrome.pane, host: chrome.host, add: chrome.add }, widths: editor.widths, perf: editor.perf,   // the page's
          active: () => !!ed && current() === ed,
          reopen: async (x) => { ed.close(); await ed.open(x); } });
        sessions.set(docId, { ed, panes: new Set([id]) });
        guests.set(id, ed);
        // texts of reference slots per slot from now on: two documents' "rtxC:lem:a" are two texts (refs/numbering.ts)
        refs.setSlots?.('instances');
        ed.ready = ed.open(docId).then((ok) => {
          const s = sessions.get(docId);
          if (!ok && s?.ed === ed) for (const p of [...s.panes]) layout.setDoc(p, editor.doc?.id ?? null);   // gone: its panes show pane A's document
          else follow();
          return ok;
        });
        return ed.panes().first;
      },
      close(id) {
        const ed = guests.get(id);
        guests.delete(id);
        const entry = [...sessions].find(([, x]) => x.ed === ed);
        if (entry) {
          const [docId, s] = entry;
          s.panes.delete(id);
          if (s.panes.size) { ed.removePane(id); follow(); return; }   // another pane still shows it: the session stays
          sessions.delete(docId);
          if (shownCurrent === ed) shownCurrent = null;
          ed.dispose();                                    // its last pane: the editor, its session and engine state go
          const w = Promise.resolve(ed.writesIdle?.()).catch(() => {}).finally(() => { if (writes.get(docId) === w) writes.delete(docId); });
          writes.set(docId, w);
        } else if (ed) { if (shownCurrent === ed) shownCurrent = null; ed.dispose(); }
        follow();
      },
    } });
  // a pane's document menu: "open in that pane" (pane A's: the whole editor, the route); the route's own document in
  // another pane is the first editor's again
  router.setPaneOpener((id, pane) => {
    if (pane === layout.panes.peek()[0]?.id || !layout.pane(pane)) return false;
    layout.setDoc(pane, id);
    layout.focus(pane);
    return true;
  });
  // the page's UI follows the focused pane's document
  function follow() {
    const ed = current();
    if (ed === shownCurrent) return;
    shownCurrent?.deactivate?.();
    shownCurrent = ed;
    ed.activate?.();
    common.root.state.current.value = { doc: ed.doc?.id ?? null };   // the container's signal; tests get editor:current from it
  }
  const stopFollow = effect(() => { void layout.focused.value; void layout.panes.value; queueMicrotask(() => { if (!gone) follow(); }); });
  let gone = false;

  return {
    get editor() { return editor; },
    current, follow,
    /** the editor unmounted: the page's UI no longer follows its focus (the editors are disposed by the mount) */
    dispose() { gone = true; stopFollow(); router.setPaneOpener(null); },
    /** the editor of pane `pane` (a pane may show another document), else the current one */
    forPane: (pane) => (pane && guests.get(pane)) || (pane ? editor : current()),
    editors: () => [['a', editor], ...guests],
    /** the open documents: docId -> { editor, panes } (the first editor's: the panes showing its document) */
    sessions: () => new Map([...(editor.doc ? [[editor.doc.id, { editor, panes: layout.panes.peek().filter((p) => !p.view && p.doc === editor.doc.id).map((p) => p.id) }]] : []),
      ...[...sessions].map(([d, x]) => [d, { editor: x.ed, panes: [...x.panes] }])]),
    hosts: {
      at(node) {
        for (const [, ed] of [['a', editor], ...guests]) { const p = ed.panes?.().paneOf(node); if (p) return docHost(ed, p); }
        return null;
      },
      forPane: (pane) => docHost((pane && guests.get(pane)) || (pane ? editor : current()), pane ?? null),
      current: () => docHost(current(), layout.focused.peek()),
      all: () => [editor, ...[...sessions.values()].map((x) => x.ed)].map((ed) => docHost(ed)),
    },
  };
}
