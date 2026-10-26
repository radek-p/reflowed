// THE DOCUMENT PART FOR A CONTAINER OF TABS: the editor's documents shown in panes a host gives
// it, every pane equal. The workbench (app/wb/) gives one host element per document tab; each becomes a pane (its
// <main data-pane>, its DocumentView, its block views), and every pane of a document is a view of ONE document editor
// (app/app.js createDocEditor: one DocSession, one undo history per document), made with the first pane that shows
// the document and gone with its last. No pane is the first: a document editor is made on the pane it is asked for
// (createDocEditor's `only`), any further pane of it joins (addPane), and any of them may close first.
//
// What the panes share is made here once (as app/mount.ts makes it for its own panes): the layout mirror (panes/
// layout.js: the panes in the host's order, the focused one), the width governor, the input clock (perf), the
// References pane, reference navigation, the block controls, the View button's widths, notes and the inspector. The
// CURRENT document is the focused pane's: the page's UI (the find bar, the panels, the document menu, the keys) is
// its editor's, handed over as the focus moves (activate / deactivate, as app/workspace.js).
//
//   const tabs = createDocTabs(root, services, { topbar, router, shell })
//     root      the container (app/editor-root.ts), holding every pane (the keys and the controls look there)
//     topbar    the document menu's and the status's model (chrome/top-bar.ts createTopBarModel): drawn by the host
//   tabs.mount(id, host, docId) -> DocPane   pane `id` (the tab's id) in `host`, showing document `docId`
//   tabs.unmount(id)                         its pane goes (the document editor with its last pane)
//   tabs.focus(id)                           pane `id` is the one worked in (the current document)
//   tabs.current                             signal: { pane, doc } of the focused pane (both null: none)
//   tabs.status(docId) · tabs.title(docId)   signals of an open document (doc/status.ts; its title)
//   tabs.section(id)                         signal: the outline entry in view in pane `id`
//   tabs.editorOf(id) · tabs.editors()       pane `id`'s document editor; [[pane, editor]] (tests)
//   tabs.sessions()                          Map docId -> { editor, panes } (tests)
//   tabs.hosts                               the document hosts of page features (app/doc-host.js)
//   tabs.layout · tabs.widths · tabs.perf    the shared parts
//   tabs.dispose()
//
//   DocPane: { id, el (its <main>), editor, ready (opened: true | false), section, unmount() }
import { computed, effect, signal, untracked, type ReadonlySignal, type Signal } from '@preact/signals';
import { createDocEditor } from './app.js';
import { docHost } from './doc-host.js';
import { createLayout } from '../panes/layout.js';
import { createWidths } from '../panes/widths.js';
import { createPerf } from '../perf/index.js';
import { relayout, layoutDone, laidAt } from '../view/viewer-host.ts';
import { createBibPane } from '../bibpane/index.js';
import { installRefNav } from '../refnav/index.ts';
import { installControls, controlsChanged } from '../docview/controls.js';
import { featureFailed } from './release-mode.js';
import { h } from './app.js';
import '../files/index.ts';                     // the Files panel (advanced): a registered side panel
import type { EditorRoot } from './editor-root.ts';
import type { DocCommands } from '../chrome/main-menu.ts';
import type { EditorServices, Router } from './mount.ts';
import type { DocStatus } from '../doc/status.ts';
import type { OutlineItem } from '../doc/panels.ts';
import type { Layout, Pane, Widths } from '../panes/types.ts';

/** a document editor (app/app.js createDocEditor), as this module uses it */
export interface DocEditor {
  readonly doc: { id: string; title?: string; preamble?: { source: string } } | null;
  /** its command registry (commands/registry.js): the main menu's entries */
  readonly commands: DocCommands;
  readonly status: ReadonlySignal<DocStatus>;
  readonly title: Signal<string>;
  readonly api: Record<string, (...a: never[]) => unknown>;
  outline(): OutlineItem[];
  /** pane `p`'s section focus: its heading's id (null: the whole document) */
  focusedSection(p?: string): string | null;
  ready?: Promise<boolean>;
  section(pane?: string | null): Signal<OutlineItem | null>;
  open(id: string): Promise<boolean>;
  close(): void;
  dispose(): void;
  activate(): void;
  deactivate(): void;
  addPane(id: string, chrome: { pane: HTMLElement; host: HTMLElement }): Pane;
  removePane(id: string): number;
  writesIdle(): Promise<unknown>;
  run(id: string, input?: object, via?: string): unknown;
  bibHost(): Record<string | symbol, unknown>;
  backendId(): string | null;
  panes(): { list(): Pane[]; paneOf(node: Node | null): string | null; get(id: string): Pane | null };
  readonly widths: Widths;
}
export interface DocPane {
  readonly id: string;
  readonly el: HTMLElement;
  readonly editor: DocEditor;
  readonly ready: Promise<boolean>;
  readonly section: ReadonlySignal<OutlineItem | null>;
  unmount(): void;
}
/** the top bar's model (chrome/top-bar.ts): what a document editor writes there (its save state, its status, its menu) */
export interface TopBarModel {
  on: { menu?: (button: Element) => void; sidebar?: () => void; split?: () => void; title?: (t: string) => void };
  setStatus(text: string, kind?: string): void;
  setTitle(text: string): void;
  setSplit(on: boolean): void;
  slot(name: string): Element | null;
  model: { title: Signal<string> };
}
export interface DocTabsOptions {
  topbar: TopBarModel;
  router: Router;
  /** the page's sidebar toggle (the command view.sidebar) */
  shell: { toggleSidebar(open?: boolean): void; toggleSplit?(): void; showPanel(id: string): void };
  /** document `docId` was deleted in another tab: the host closes its tabs */
  gone?(docId: string): void;
}

/** a pane's own chrome inside the host's element: its <main> (the scroller), the DocumentView's host, "Add a block" */
function paneChrome(host: HTMLElement, id: string) {
  const doc = host.ownerDocument;
  const main = doc.createElement('main');
  main.dataset.pane = id;
  main.className = 'rtx-pane';
  main.dataset.wbScroll = '';   // the workbench's scroller rule: its scrollbar's track starts below the strip and the bar (the glass), as a view's
  main.setAttribute('aria-label', 'Document');
  const view = doc.createElement('div');
  view.className = 'doc-view-host';
  const add = doc.createElement('div');
  add.className = 'add-end-host';
  main.append(view, add);
  host.append(main);
  return { pane: main, host: view, add };
}

export function createDocTabs(root: EditorRoot, services: EditorServices, o: DocTabsOptions) {
  const layout = createLayout({ empty: true }) as unknown as Layout & {
    setDoc(id: string, doc: string | null): void; setFocus(id: string, heading: string | null): void;
  };
  const perf = createPerf();
  const sessions = new Map<string, { ed: DocEditor; panes: Set<string> }>();   // docId -> its editor, the panes showing it
  const byPane = new Map<string, DocEditor>();
  const writes = new Map<string, Promise<unknown>>();                          // docId -> the writes of its last editor
  const panes = new Map<string, DocPane>();
  const focusedPane = signal<string | null>(null);
  // one width governor for every pane on the page (each document editor's panes registry is a guest's: it
  // shares this one)
  const allPanes = (): Pane[] => [...new Set(byPane.values())].flatMap((ed) => ed.panes().list());
  // only the panes shown: a tab kept alive behind another in its group is skipped (pinning its
  // blocks cost a hold 38 ms with four 60-block tabs; its layout is skipped while hidden, and the viewer lays it out at
  // its width when it is shown again)
  const shownPanes = (): Pane[] => allPanes().filter((p) => !p.el.closest('.wb-panel--hidden'));
  const widths: Widths = createWidths({ panes: shownPanes, relayout, layoutDone, laidAt, state: root.state });
  let shown: DocEditor | null = null;
  const current = (): DocEditor | null => (focusedPane.peek() ? byPane.get(focusedPane.peek()!) ?? null : null) ?? [...byPane.values()][0] ?? null;

  // the References pane (its DOM in the container: the bibpane's view), reference navigation, the block controls
  let bibpane: ReturnType<typeof createBibPane> | null = null;
  try { bibpane = createBibPane({ h }); bibpane.installDom(root); } catch (e) { bibpane = featureFailed('bibpane', e); }
  bibpane?.connect(new Proxy({}, { get: (_, k) => current()?.bibHost()[k] }));
  installControls(root);
  // (the View button: the host attaches the View options once its bar is drawn: tabs.attachView())
  const offInspector = services.inspector?.attach({ layout, root }) ?? null;

  const writesSettled = (docId: string) => {
    const live = sessions.get(docId)?.ed;
    const w = live ? live.writesIdle() : writes.get(docId);
    return w ? Promise.resolve(w).catch(() => {}) : null;
  };
  const common = { ...services.editorContext, root, store: services.store, ids: services.ids, backends: services.backends, io: services.io,
    shell: o.shell, notes: services.notes, bibpane, view: services.view, topbar: o.topbar, layout, router: o.router, connectBib: false,
    inspector: services.inspector, widths, perf, writesSettled, tabs: true, docGone: (docId: string) => o.gone?.(docId) };

  function makeEditor(id: string, docId: string, chrome: { pane: HTMLElement; host: HTMLElement; add: HTMLElement }): DocEditor {
    const refs = services.makeRefs() as { setSlots?(k: string): void };
    refs.setSlots?.('instances');           // two documents' "rtxC:lem:a" are two texts (refs/numbering.ts)
    let ed: DocEditor | null = null;
    ed = createDocEditor({ ...common, refs, backend: services.backends.find((b) => b.id === (services.backend as { id: string }).id) ?? services.backend,
      only: { id, pane: chrome.pane, host: chrome.host, add: chrome.add },
      active: () => !!ed && current() === ed,
      reopen: async (x: string) => { ed!.close(); await ed!.open(x); } }) as DocEditor;
    return ed;
  }

  /** the page's UI follows the focused pane's document */
  function follow() {
    markParts();
    const ed = current();
    if (ed === shown) return;
    shown?.deactivate();
    shown = ed;
    ed?.activate();
    root.state.current.value = { doc: ed?.doc?.id ?? null };
  }

  /** the focused pane is the container's [data-part=page] and its tab's panel the [data-part=shell]: what the page-wide
   *  parts measure (the View options' column, the References pane) is the pane worked in */
  function markParts() {
    const f = focusedPane.peek(), el = (f && panes.get(f)?.el) || null;
    for (const [name, want] of [['page', el], ['shell', el?.parentElement ?? null]] as const) {
      const was = root.part(name);
      if (was === want) continue;
      if (was) delete was.dataset.part;
      if (want) want.dataset.part = name;
    }
  }

  function mount(id: string, host: HTMLElement, docId: string): DocPane {
    const have = panes.get(id);
    if (have) return have;
    const chrome = paneChrome(host, id);
    layout.open(id, { doc: docId });
    const s = sessions.get(docId);
    let ed: DocEditor, ready: Promise<boolean>;
    if (s) {                                   // the document is open in another pane: the same editor
      ed = s.ed;
      s.panes.add(id);
      byPane.set(id, ed);
      ed.addPane(id, chrome);
      ready = ed.ready ?? Promise.resolve(true);
    } else {
      ed = makeEditor(id, docId, chrome);
      sessions.set(docId, { ed, panes: new Set([id]) });
      byPane.set(id, ed);
      ready = ed.ready = (async () => { const w = writes.get(docId); if (w) await w; return ed.open(docId); })();
    }
    const section = ed.section(id);
    const p: DocPane = { id, el: chrome.pane, editor: ed, ready, section, unmount: () => unmount(id) };
    panes.set(id, p);
    if (!focusedPane.peek() || wanted === id) focus(id);   // (a tab focused before its pane mounted: now)
    controlsChanged(root);
    ready.then(() => { if (panes.get(id) === p) { follow(); controlsChanged(root); } });
    return p;
  }

  function unmount(id: string) {
    const p = panes.get(id);
    if (!p) return;
    panes.delete(id);
    const ed = byPane.get(id);
    byPane.delete(id);
    const entry = [...sessions].find(([, x]) => x.ed === ed);
    if (entry && ed) {
      const [docId, s] = entry;
      s.panes.delete(id);
      if (s.panes.size) ed.removePane(id);
      else {
        sessions.delete(docId);
        if (shown === ed) shown = null;
        const w = Promise.resolve(ed.writesIdle()).catch(() => {}).finally(() => { if (writes.get(docId) === w) writes.delete(docId); });
        writes.set(docId, w);
        try { ed.dispose(); } catch (e) { console.error('doc tabs: dispose', e); }
      }
    }
    const was = focusedPane.peek() === id;
    p.el.remove();
    layout.close(id);              // (its focus moves to the first pane: the effect below follows it)
    if (focusedPane.peek() === id) focusedPane.value = panes.keys().next().value ?? null;
    // the focused pane gone: another meanwhile; a tab that shows another document (the switcher) mounts again under
    // its id and is the focused one again then (mount: wanted), not that first pane, which may be a hidden tab
    if (was) wanted = id;
    controlsChanged(root);
    follow();
  }

  /** the pane asked to be focused before it was mounted (the workbench activates a new tab, then draws it) */
  let wanted: string | null = null;
  function focus(id: string | null) {
    wanted = id;
    if (id && !panes.has(id)) return;
    if (focusedPane.peek() !== id) focusedPane.value = id;
    if (id) layout.focus(id);
    follow();
  }
  // a press or a focus in a pane makes it the one worked in (the layout's focus: panes/pane.ts onFocus)
  const offFocus = effect(() => { const f = layout.focused.value; untracked(() => { if (f && panes.has(f) && focusedPane.peek() !== f) { wanted = f; focusedPane.value = f; follow(); } }); });

  // reference navigation: its host the documents' (the pane a node is in, or the current one)
  const hosts = {
    at(node: Node | null) {
      for (const ed of new Set(byPane.values())) { const p = ed.panes().paneOf(node); if (p) return docHost(ed, p); }
      return null;
    },
    forPane: (pane: string | null) => { const ed = (pane && byPane.get(pane)) || current(); return ed ? docHost(ed, pane ?? focusedPane.peek()) : null; },
    current: () => { const ed = current(); return ed ? docHost(ed, focusedPane.peek()) : null; },
    all: () => [...new Set(byPane.values())].map((ed) => docHost(ed)),
  };
  let refnav: unknown = null;
  try { refnav = installRefNav({ root, api: { forPane: (p: string | null) => hosts.forPane(p), bibpane: () => bibpane }, numberingState: services.numberingState }); } catch (e) { featureFailed('refnav', e); }
  const offNotes = services.notes?.attach?.(hosts) ?? null;

  const statusOf = new Map<string, ReadonlySignal<DocStatus>>();
  const IDLE: DocStatus = { typesetting: false, errors: 0, unsaved: false };
  /** an open document's status (idle when it is not open), followed across its editor's life */
  const version = signal(0);
  function status(docId: string): ReadonlySignal<DocStatus> {
    let s = statusOf.get(docId);
    if (!s) statusOf.set(docId, s = computed(() => { void version.value; return sessions.get(docId)?.ed.status.value ?? IDLE; }));
    return s;
  }
  const bump = () => { version.value++; };

  let gone = false;
  const api = {
    root, layout, widths, perf, hosts, bibpane,
    get refnav() { return refnav; },
    current: computed(() => { const p = focusedPane.value; void version.value; const ed = p ? byPane.get(p) : null; return { pane: p, doc: ed?.doc?.id ?? null }; }),
    mount(id: string, host: HTMLElement, docId: string) { const p = mount(id, host, docId); bump(); p.ready.then(bump); return p; },
    unmount(id: string) { unmount(id); bump(); },
    focus,
    /** the View options' button (in the container's [data-part=topbar] slot "view") and their widths: once the
     *  host has drawn its bar */
    attachView: () => services.view?.attach?.(root, { widths: () => widths }) ?? (() => {}),
    pane: (id: string) => panes.get(id) ?? null,
    status,
    title: (docId: string): ReadonlySignal<string> => computed(() => { void version.value; return sessions.get(docId)?.ed.title.value ?? ''; }),
    section: (id: string): ReadonlySignal<OutlineItem | null> => panes.get(id)?.section ?? signal(null),
    editorOf: (id: string | null) => (id ? byPane.get(id) ?? null : null),
    currentEditor: current,
    editors: (): [string, DocEditor][] => [...byPane],
    sessions: () => new Map([...sessions].map(([d, x]) => [d, { editor: x.ed, panes: [...x.panes] }])),
    dispose() {
      if (gone) return;
      gone = true;
      offFocus();
      for (const id of [...panes.keys()]) unmount(id);
      offNotes?.();
      offInspector?.();
      widths.dispose();
      perf.dispose?.();
    },
  };
  return api;
}
export type DocTabs = ReturnType<typeof createDocTabs>;
