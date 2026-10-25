// THE EDITOR, MOUNTED INTO A GIVEN ELEMENT: the editor's own parts — its container
// (app/editor-root.ts), the document column, the layout and the panes, the top bar, the sidebar with its panels, the
// find bar, the References pane, the Files panel, reference navigation, the block controls — made in `el` and gone
// with unmount(). What the page shares between its editors comes in as `services`: the store, the backends (one engine
// worker per page), the refs module, notes (the viewer's kind and the compile wrapper), the View options and the
// inspector (one public panel). main.js is the standalone page's host: it makes the services, mounts one editor on
// its markup and adds the Documents view, the URL and window.editorAPI; a workbench tab or a VS Code webview is
// another host.
//
//   const ed = mountEditor(el, services, { root?, windowScroll?, ids?, router?, onSidebar?, sidebar? })
//     sidebar false: the document part alone (no sidebar markup or chrome; the panels are registered views a
//                   host draws with panelContext(root, id): app/view-context.ts)
//     el            the element to mount into: with the editor's markup in it (the standalone page: index.html), or
//                   empty (an embedded editor: the markup is made here, data-embedded on el)
//     root          an editor container already made on el (main.js makes it first: its signals dispatch the tests' events)
//     router        app/router.js's (the standalone page's: the URL); default, one in memory (no URL)
//     onSidebar     (open) the sidebar shown or hidden (the standalone page keeps the choice)
//   ed.root · ed.layout · ed.router · ed.ws (app/workspace.js) · ed.editor (the first document editor) · ed.current()
//   ed.bibpane · ed.refnav · ed.docView · ed.shell
//   ed.status the current document's status as data (doc/status.ts): { typesetting: { done, total } | false, errors, unsaved }
//   ed.crumbs(paneId?) a pane's crumbs as data (docview/crumbs.ts): { doc: { id, title }, section } (default: the focused pane)
//   ed.open(docId) -> Promise<boolean> (the whole editor on that document) · ed.close() · ed.unmount()
import { createEditorRoot, type EditorRoot } from './editor-root.ts';
import { createDocEditor, h } from './app.js';
import { createWorkspace } from './workspace.js';
import { createRouter } from './router.js';
import { createLayout } from '../panes/layout.js';
import { createDocumentView } from '../docview/document-view.js';
import { mountTopBar } from '../chrome/top-bar.js';
import { mountSidebarChrome, mountAddEnd } from '../chrome/sidebar-chrome.ts';
import { installControls } from '../docview/controls.js';
import { createBibPane } from '../bibpane/index.js';
import { installRefNav } from '../refnav/index.js';
import '../files/index.ts';                     // the Files panel (advanced): a registered side panel
import { featureFailed } from './release-mode.js';
import { computed, type ReadonlySignal } from '@preact/signals';
import { crumbsOf, type Crumbs } from '../docview/crumbs.ts';
import type { DocStatus } from '../doc/status.ts';
import type { OutlineItem } from '../doc/panels.ts';

/** the page's View options (view/index.js), as an editor uses them */
export interface ViewService {
  attach?(root: EditorRoot, o?: { widths?: () => { transition(change: () => unknown, o: { animate: boolean }): unknown; restyle(): unknown } | null }): () => void;
}
/** the page's notes (notes/index.js), as an editor uses them */
export interface NotesService { attach?(hosts: object): () => void }
/** the page's inspector (inspector/index.ts), as an editor uses it */
export interface InspectorService { attach(o: { layout: object; root: EditorRoot }): () => void }
/** a router (app/router.js) */
export interface Router {
  route: { peek(): { name: string; id?: string } };
  openDoc(id: string, o?: { pane?: string | null }): void;
  home(): void;
  onChange(fn: (r: { name: string; id?: string }) => void): () => void;
  setPaneOpener(fn: (id: string, pane: string) => boolean): void;
  dispose(): void;
}

/** what every editor on the page shares (made once by the host) */
export interface EditorServices {
  store: object;
  ids: object;
  refs: object;
  makeRefs(): object;
  backends: { id: string }[];
  backend: object;
  io: object;
  notes: NotesService | null;
  view: ViewService | null;
  inspector: InspectorService | null;
  numberingState: (() => unknown) | null;
  /** the rest of a document editor's context (app/app.js createDocEditor), passed as it is */
  editorContext: Record<string, unknown>;
}
export interface MountOptions {
  /** false: the document part alone, no sidebar (the host draws the panels) */
  sidebar?: boolean;
  root?: EditorRoot;
  windowScroll?: boolean;
  ids?: boolean;
  router?: Router;
  onSidebar?(open: boolean): void;
}

/** the editor's markup, for an embedded editor (the standalone page has it in index.html, with its ids) */
const SKELETON = `<aside class="sidebar" data-part="sidebar" aria-label="Document panels" data-ui-chrome>
  <div class="sb-top" data-part="sb-top"></div>
  <div class="sb-tabs" data-part="sb-tabs" role="tablist" aria-label="Panels"></div>
  <div class="sb-foot" data-part="word-count"></div>
</aside>
<div class="shell" data-part="shell">
  <div data-part="view">
    <header class="topbar" data-part="topbar" data-ui-chrome></header>
    <div data-part="find" data-ui-chrome></div>
    <main data-part="page"><div data-part="doc-view-host"></div><div class="add-end-host" data-part="add-end"></div></main>
  </div>
</div>`;

/** the document part alone: the top bar, the find bar, the page (no sidebar) */
const DOCUMENT_PART = SKELETON.slice(SKELETON.indexOf('<div class="shell"'));

interface DocEditor {
  readonly doc: { id: string } | null;
  readonly status: ReadonlySignal<DocStatus>;
  readonly title: ReadonlySignal<string>;
  section(pane?: string | null): ReadonlySignal<OutlineItem | null>;
  open(id: string): Promise<boolean>;
  close(): void;
  dispose(): void;
  readonly widths: { transition(change: () => unknown, o: { animate: boolean }): unknown; restyle(): unknown };
  bibHost(): Record<string | symbol, unknown>;

}

export function mountEditor(el: HTMLElement, services: EditorServices, o: MountOptions = {}) {
  const embedded = !el.querySelector('[data-part="view"]');
  if (embedded) el.innerHTML = o.sidebar === false ? DOCUMENT_PART : SKELETON;
  const root = o.root ?? createEditorRoot(el, { windowScroll: o.windowScroll ?? !embedded, ids: o.ids ?? !embedded });
  if (embedded) root.flag('embedded', true);
  const docHost = root.part('doc-view-host');
  if (!docHost) throw new Error('mountEditor: no [data-part=doc-view-host]');
  const docView = createDocumentView(docHost, { id: 'main', primary: true, domId: root.id('blocks') });
  const layout = createLayout();
  const router: Router = o.router ?? createRouter({ loc: { hash: '#/' }, win: null });
  // the page's one inspector inspects the editor worked in: this one when it is pressed or focused in
  const offInspector = services.inspector?.attach({ layout, root }) ?? null;
  const inspectHere = () => { services.inspector?.attach({ layout, root }); };
  root.listen(root.el, 'pointerdown', inspectHere, true);
  root.listen(root.el, 'focusin', inspectHere);

  let editor: DocEditor | null = null;
  const shell = {
    toggleSidebar(open = root.has('sidebar-closed')) {
      const change = () => root.flag('sidebar-closed', !open);
      // the blocks keep their lines while the sidebar slides, then those in view are re-broken once (panes/widths.js)
      const w = editor?.widths ?? null;
      if (w && open === root.has('sidebar-closed')) w.transition(change, { animate: true });
      else change();
      o.onSidebar?.(open);
    },
  };
  const topbar = mountTopBar(root.part('topbar'), { ids: (n: string) => root.id(n) });
  topbar.on.sidebar = () => shell.toggleSidebar();
  // the References pane: this editor's, before the sidebar draws its panels (its view's mount draws it)
  let bibpane: ReturnType<typeof createBibPane> | null = null;
  try { bibpane = createBibPane({ h }); bibpane.installDom(root); } catch (e) { bibpane = featureFailed('bibpane', e); }
  // the sidebar part: the brand, close, tabs, panels, word count; without it (o.sidebar false) the panels are the
  // host's to draw (registered views, panelContext(root, id): app/view-context.ts; the workbench's and VS Code's)
  if (o.sidebar !== false) mountSidebarChrome(root, { onClose: () => shell.toggleSidebar(false) });
  else mountAddEnd(root);
  services.view?.attach?.(root, { widths: () => editor?.widths ?? null });   // this editor's View button; its widths

  // ── the workspace (app/workspace.js): one document editor per open document; the editor's UI is the
  // current one's (the focused pane's document's)
  const common = { ...services.editorContext, root, store: services.store, ids: services.ids, backends: services.backends, io: services.io,
    shell, notes: services.notes, bibpane, view: services.view, topbar, layout, router, connectBib: false, inspector: services.inspector };
  const ws = createWorkspace({ layout, router, createEditor: (c: object) => createDocEditor(c), common, refs: services.refs, makeRefs: services.makeRefs,
    backend: services.backend, backends: services.backends, docView });
  editor = ws.editor as DocEditor;
  const first = editor;
  const current = () => ws.current() as DocEditor;
  bibpane?.connect(new Proxy({}, { get: (_, k) => current().bibHost()[k] }));
  installControls(root);
  const offNotes = services.notes?.attach?.(ws.hosts) ?? null;   // each note acts in the document of the pane it is in
  // reference navigation; its host is the workspace's, not the test surface
  let refnav: unknown = null;
  try { refnav = installRefNav({ root, api: { forPane: (p: string | null) => ws.hosts.forPane(p), bibpane: () => bibpane }, numberingState: services.numberingState }); } catch (e) { featureFailed('refnav', e); }

  // status and crumbs as data: the current document's (the focused pane's), followed as it changes
  const status = computed(() => { void root.state.current.value; return current().status.value; });
  const crumbs = (pane: string | null = null): ReadonlySignal<Crumbs> => computed(() => {
    void root.state.current.value;
    const p = pane ?? layout.focused.value;
    const ed = (ws.forPane(p) as DocEditor | null) ?? current();
    return crumbsOf({ docId: ed.doc?.id ?? null, title: ed.title.value, section: ed.section(p).value });
  });

  let gone = false;
  return {
    root, layout, router, ws, docView, shell, topbar, bibpane, status, crumbs,
    get refnav() { return refnav; },
    get editor() { return first; },
    current,
    /** the whole editor on document `id` (pane A, and the panes that showed the last one) */
    async open(id: string): Promise<boolean> {
      if (first.doc?.id === id) return true;
      const prev = first.doc?.id ?? layout.panes.peek()[0]?.doc ?? null;
      const ok = await first.open(id);
      if (ok) layout.replaceDoc(prev, id);
      return ok;
    },
    close() { first.close(); },
    /** everything this editor made goes: its document editors (their sessions, panes, listeners), its chrome, its
     *  container's listeners and state; the page's services stay */
    unmount() {
      if (gone) return;
      gone = true;
      ws.dispose();
      for (const ed of new Set(ws.editors().map(([, e]) => e as DocEditor))) { try { ed.dispose(); } catch (e) { console.error('unmount:', e); } }
      offNotes?.();
      offInspector?.();
      if (!o.router) router.dispose();
      docView.destroy();
      root.dispose();
      if (embedded) el.replaceChildren();
    },
  };
}
export type MountedEditor = ReturnType<typeof mountEditor>;
