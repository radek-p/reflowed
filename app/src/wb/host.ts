// THE STANDALONE PAGE ON THE WORKBENCH: the editor's documents as workbench tabs (splits, groups,
// two documents side by side), its side panels as the workbench's side panels, its own Documents view in each group's
// home panel, the tab's status and crumbs from the document's data (doc/status.ts, docview/crumbs.ts), the layout kept
// as a disposable preference and restored on reload. The editor's part is app/doc-tabs.ts (a pane per document tab, one
// document editor per document); the workbench (workbench/src) owns the tabs, the groups, the columns and the keys.
//
//   await startWorkbench({ el, params })   el: the page's .rtx-editor (its old chrome replaced)
//
// View types: 'document' ({ doc, at? }: a pane of document `doc`; `at`, the section in view, restored on reload),
// 'home' (the editor's Documents view, home/screen.js, in the group's home panel), and one side panel per editor
// panel (design/ui/views.ts: Outline, Problems, TODOs, References; offered on demand, open only when asked for and
// closable: Files, the Inspector on the dev page, Settings) drawn with the editor's ViewContext, with the icon, the side,
// the place (below) and the default column width the view gives; an on-demand panel opened is shown.
// The window bar: at its left the main menu (the Re button: chrome/main-menu.ts, the current document's commands and
// the page's actions; its View › rows for the two side columns and the panels offered, from the workbench's sides and
// the registry), at its right the View options' button. Page commands (the key table's rows that act on the page, not
// on a document): app.panel <id>, an on-demand panel shown, or closed when it is (Ctrl/⌘ , for Settings).
import { effect, untracked } from '@preact/signals';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { createWorkbench, Workbench, html, render, kit, openRowMenu, ownViewport, VIEWPORT_CSS, model as M, sideOverlay, isIconName, Icon,
  type ViewContext as WbContext, type Tab, type Subtitle, type WorkbenchStore, type SelectRow } from '../../../workbench/src/index.ts';
import { createEditorRoot, editorRoots } from '../app/editor-root.ts';
import { createPageServices, pageReady } from '../app/services.ts';
import { createDocTabs, type DocTabs } from '../app/doc-tabs.ts';
import { seedStore, resolveAlias } from '../app/seeds.ts';
import { createRouter } from '../app/router.js';
import { createTopBarModel } from '../chrome/top-bar.js';
import { purgeRetiredSample } from '../app/purge-retired-sample.js';
import { onResetElsewhere } from '../store/wipe.js';
import { setAboutReset, openAbout } from '../app/about.js';
import { openResetDialog } from '../home/reset-dialog.js';
import { connectResources } from '../settings/resources.ts';
import { buildVersion } from '../app/build-version.js';
import { page, dispatchForTests } from '../app/page-state.ts';
import { views as editorViews, view as editorView, offered, openPanel, panelOpen, FrameContext, slotsOf, type ViewDef } from '../design/ui/views.ts';
import { panelContext } from '../app/view-context.ts';
import { crumbsOf } from '../docview/crumbs.ts';
import { WordCountStatus } from '../chrome/sidebar-chrome.ts';
import { LoadStatus, bootShown } from '../boot/load-status.ts';
import { WB_CSS, lockedLeft } from './css.ts';
import { installTestSurface, setLastHome } from './test-surface.ts';
import { createStatusHold } from './status-hold.ts';
import ICON_SVG from '../chrome/wordmark/icon.svg';   // the app's icon (ReIcon.svg): the main menu's button, no word
import { openMenu, type MenuHandle } from '../chrome/menu.ts';
import { mainMenu, panelToggles } from '../chrome/main-menu.ts';
import { SETTINGS_PANEL, openSettings } from '../settings/panel.ts';
import { shortcutLabel } from '../../../workbench/src/keys.ts';
import type { ComponentChildren } from 'preact';
import type { Router } from '../app/mount.ts';
import type { OutlineItem } from '../doc/panels.ts';
import { newTabLabel, pinLabel } from '../outline/index.ts';   // (the section menu's rows: the Outline's labels)

const LAYOUT_KEY = 'rtx-editor.workbench';
/** The editor's rows in the workbench's key table, before the workbench's own while their when holds:
 *  Ctrl/⌘B is bold in a LaTeX field, the sidebar elsewhere (the workbench's row); the editor's split key ⌘⌥\\ /
 *  Ctrl+Alt+\\ splits right as the workbench's ⌘K ⌘\\ does (the two sidebar keys Ctrl/⌘ \\ were one meaning already: the
 * */
export const KEY_ROWS = [
  { key: 'ctrl+b', mac: 'meta+b', command: 'editor.bold', when: 'reflowed.field', hosts: ['standalone', 'vscode'] as ('standalone' | 'vscode')[] },
  { key: 'ctrl+alt+\\', mac: 'meta+alt+\\', command: 'workbench.splitRight', hosts: ['standalone'] as ('standalone' | 'vscode')[] },
  { key: 'ctrl+,', mac: 'meta+,', command: 'app.panel', args: SETTINGS_PANEL as string, hosts: ['standalone'] as ('standalone' | 'vscode')[] },
];
type DocState = { doc?: string; at?: string | null };
const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } };

interface StoreLike { listDocs(o?: object): Promise<{ id: string; title?: string }[]>; kind?: string }

export async function startWorkbench({ el, params }: { el: HTMLElement; params: URLSearchParams }) {
  // the page never scrolls (the views do): the workbench's viewport, from the first frame
  if (!document.getElementById('wb-viewport-css')) { const st = document.createElement('style'); st.id = 'wb-viewport-css'; st.textContent = VIEWPORT_CSS; document.head.prepend(st); }
  ownViewport();
  const css = document.createElement('style');
  css.id = 'rtx-wb-css';
  css.textContent = WB_CSS;
  document.head.append(css);

  // the container: the editor's (app/editor-root.ts) around the workbench; [data-part=view] holds every pane
  el.replaceChildren();
  el.classList.add('rtx-wb');
  el.dataset.route = 'doc';
  const view = document.createElement('div');
  view.dataset.part = 'view';
  view.className = 'scrolls rtx-wb-view';
  const findHost = document.createElement('div');
  findHost.dataset.part = 'find';
  findHost.dataset.uiChrome = '';
  findHost.className = 'rtx-wb-find';
  el.append(view);
  const root = createEditorRoot(el, { windowScroll: false, ids: true });
  dispatchForTests(root.state);
  await pageReady();
  let currentRoute: { name: string; id?: string } = { name: 'home' };
  const { services, kinds, modules: { ioMod, mountHome } } = await createPageServices({ params, route: () => currentRoute });
  const store = services.store as StoreLike & Parameters<typeof seedStore>[0]['store'];
  onResetElsewhere(() => location.reload());
  setAboutReset(() => openResetDialog({ store }));
  await purgeRetiredSample(store);
  await seedStore({ store, ioMod: ioMod as Parameters<typeof seedStore>[0]['ioMod'], what: params.get('seed') });

  // ── the workbench ──
  const saved = params.has('fresh') ? null : safeGet(LAYOUT_KEY);
  const wb: WorkbenchStore = createWorkbench({ idPrefix: 'rw', layout: saved, home: 'home',
    keys: KEY_ROWS,
    commands: { run: (command: string, args: unknown) => runCommand(command, args) } });
  const topbar = createTopBarModel(() => root.part('topbar'));
  let tabs: DocTabs | null = null;
  const T = () => tabs!;

  // the URL: #/doc/<id> opens (or shows) that document's tab; the current document's tab writes it (no history entry)
  const urlRouter = createRouter();
  const router: Router = {
    route: urlRouter.route,
    openDoc: (id: string) => { void openDoc(id); },
    home: () => { wb.toggleHome(undefined, true); },
    onChange: (fn) => urlRouter.onChange(fn),
    setPaneOpener: () => {},
    dispose: () => urlRouter.dispose(),
  };
  /** a document in the focused group: its tab there shown, else a new tab (one already open elsewhere: shown there) */
  async function openDoc(id0: string, { beside = false }: { beside?: boolean } = {}): Promise<string> {
    const id = await resolveAlias(store, id0);
    const L = wb.layout.peek(), g = M.activeGroup(L);
    const here = g.tabs.find((t) => t.view === 'document' && (t.state as DocState).doc === id);
    const anywhere = here ?? M.allTabs(L).find((t) => t.view === 'document' && (t.state as DocState).doc === id);
    if (anywhere && !beside) { wb.activate(anywhere.id, { focus: true }); wb.hideHome(M.groupOf(wb.layout.peek(), anywhere.id)?.id ?? g.id); return anywhere.id; }
    const t = wb.open({ view: 'document', state: { doc: id } }, { focus: true });
    wb.hideHome(g.id);
    return t;
  }
  urlRouter.onChange((r: { name: string; id?: string }) => { if (r.name === 'doc' && r.id) void openDoc(r.id); else wb.toggleHome(undefined, true); });

  // ── view types (before the workbench is drawn: a restored layout mounts its tabs at once) ──
  registerDocument(wb, T, openDoc);
  registerHome(wb, store, services.io, mountHome as MountHome);
  const panelOff = registerPanels(wb, root);
  // a narrow window (a phone): the side columns float over the documents (workbench/src/sides.ts); they are
  // closed whenever the window is (or becomes) that narrow, whatever the saved layout says: an overlay is opened on purpose
  const stopNarrow = effect(() => { if (sideOverlay.value) untracked(() => { for (const s of M.SIDEBARS) wb.collapseSide(s, true); }); });

  const shell = {
    toggleSidebar: () => { wb.toggleSide('left'); },
    toggleSplit: () => { wb.run('splitRight'); },
    showPanel: (id: string) => { wb.showPanel(id); },
  };
  // drawn into its own element inside [data-part=view]
  const mountEl = document.createElement('div');
  mountEl.className = 'rtx-wb-mount';
  view.append(mountEl);
  // the workbench is drawn before the document part exists: the document tabs mount their panes once it does (below)
  tabsReady = new Promise<DocTabs>((res) => { resolveTabs = res; });
  render(html`<${Workbench} wb=${wb} label="ReflowEd" bar=${barSpec((anchor, focus) => openMainMenu(anchor, focus))} sideStatus=${() => html`<${SideStatus} root=${root} />`} />`, mountEl);
  // a document deleted in another tab: its tabs close (as a restored tab of a document that is gone)
  const gone = (docId: string) => { for (const t of M.allTabs(wb.layout.peek())) if (t.view === 'document' && (t.state as DocState).doc === docId) wb.close(t.id); };
  tabs = createDocTabs(root, services, { topbar, router, shell, gone });
  resolveTabs!(tabs);
  tabs.attachView();
  // the TeX resource server: the engine follows the setting; after a change, every open document
  // typesets again (only blocks that failed compile: the others come from the caches)
  connectResources(services.backends.find((b) => (b as { setResourceServer?: unknown }).setResourceServer) as Parameters<typeof connectResources>[0],
    () => { for (const { editor: ed } of T().sessions().values()) if (ed?.doc) ed.run('doc.recompileAll', {}); });

  // the current tab's document is the current document; its pane gets the find bar. The route is the Documents view
  // while the focused group shows it (#/), else the current tab's document
  effect(() => {
    const { group, tab: t } = wb.current.value;
    const home = wb.isHome(group.id);
    untracked(() => {
      if (t?.view === 'document') T().focus(t.id);
      const id = !home && t?.view === 'document' ? (t.state as DocState).doc ?? null : null;
      const r: { name: 'doc'; id: string } | { name: 'home' } = id ? { name: 'doc', id } : { name: 'home' };
      if (id !== (currentRoute.id ?? null) || r.name !== currentRoute.name) {
        currentRoute = r;
        page.route.value = { ...r };
        const want = id ? `#/doc/${encodeURIComponent(id)}` : '#/';
        if (location.hash !== want) history.replaceState(history.state, '', want);
        if (r.name !== 'doc') document.title = 'Documents · ReflowEd';
      }
    });
  });
  effect(() => {
    const p = T().current.value.pane;
    const frame = p ? T().pane(p)?.el.parentElement : null;
    if (frame && findHost.parentElement !== frame) frame.prepend(findHost);
  });
  // the status of every open document in its tabs (the workbench's status display); typesetting, once shown, held a
  // moment (a keystroke's live compile is a run of 80–200 ms, and the pills flickered while typing)
  const shown = createStatusHold((d, s) => wb.setDocStatus(d, s));
  effect(() => {
    const docs = new Set(M.allTabs(wb.layout.value).filter((t) => t.view === 'document').map((t) => (t.state as DocState).doc).filter((d): d is string => !!d));
    for (const d of docs) {
      const s = T().status(d).value;
      untracked(() => shown.put(d, { typesetting: s.typesetting ? { done: s.typesetting.done, total: s.typesetting.total, bar: s.typesetting.bar } : false, errors: s.errors, unsaved: s.unsaved }));
    }
  });
  // one hold for every motion of the panes' widths: a column sliding open or closed, a splitter or a column's
  // edge dragged. From the workbench's resizestart to its resizeend every pane's blocks keep their lines and width
  // (pinned: clipped where the pane narrows); then each pane reflows once, the reading point held by its keeper.
  wb.on('resizestart', () => T().widths.hold({ locked: true }));   // the workbench keeps the hosts' widths meanwhile (lockHosts)
  wb.on('resizeend', () => T().widths.release());
  // a document group come or gone (the split opened or closed, a group's last tab moved away): the panes
  // narrow or widen with no motion of their own. Held from the change (emitted before the groups render: pinned at the
  // viewer's last widths) to the next frame; then each pane reflows once, the blocks in view a frame's budget at a time
  // (the viewer re-laid out every block of the pane in one frame of its own: 113 ms closing a 30-block article's split,
  // 120 ms opening it)
  // The same for a side column that comes or goes with no slide of its own (its first panel opened, its last one closed or
  // moved away: the Settings panel's)
  const room = (l: M.Layout) => [M.groups(l).length, ...M.SIDEBARS.map((sd) => M.sidePanels(M.sides(l)[sd]).length > 0)].join();
  wb.on('change', ({ layout, prev }) => {
    if (room(layout) === room(prev)) return;
    T().widths.hold();
    requestAnimationFrame(() => T().widths.release());
  });
  wb.on('change', () => { safeSet(LAYOUT_KEY, wb.serialize()); });
  // the field context key: Ctrl/Cmd+B is bold in a LaTeX field, the sidebar elsewhere
  const isField = (n: EventTarget | null) => !!(n as Element | null)?.closest?.('.cm-editor');   // a LaTeX field: CodeMirror (a block, the preamble)
  root.listen(document, 'focusin', (e) => { wb.setContext('reflowed.field', isField(e.target)); }, true);
  root.listen(document, 'focusout', () => { requestAnimationFrame(() => wb.setContext('reflowed.field', isField(document.activeElement))); }, true);
  // keys pressed with the focus nowhere (on <body>) are its keys too; never a key inside an overlay (a sheet, a dialog,
  // a menu: their own keys, the page's behind them untouched)
  root.listen(document, 'keydown', (e) => { const t = e.target; if (t === document.body || t === document.documentElement || t === document) wb.handleKey(e); });

  // the main menu (the Re button): the current document's commands (disabled with none current) and the page's actions
  let menu: MenuHandle | null = null;
  function openMainMenu(anchor: HTMLElement, focus: boolean) {
    if (menu?.open) { menu.close(); return; }
    const ed = T().currentEditor(), d = ed?.doc;
    const view = services.view as { open?(): void } | null;
    const S = M.sides(wb.layout.peek());
    menu = openMenu({ anchor, cls: 'main-menu', label: 'Main menu', focus, items: mainMenu({
      doc: ed && d ? { commands: ed.commands, preamble: d.preamble?.source ?? '' } : null,
      documents: { run: () => wb.toggleHome(undefined, true), shortcut: wb.shortcut('home') ?? '' },
      viewOptions: { run: () => view?.open?.(), shortcut: shortcutLabel('mod+alt+v') },
      // the side columns (shown: open with a panel in it) and the panels offered (shown: open and in view)
      sides: M.SIDEBARS.map((side) => ({ side, on: !S[side].collapsed, empty: !M.sidePanels(S[side]).length, shortcut: wb.shortcut('toggleSide', side) ?? '', run: () => { wb.toggleSide(side); } })),
      panels: panelToggles(offered(), { shown: panelShown, keys: (k) => shortcutLabel(k), toggle: togglePanel }),
      settings: { run: () => { openSettings('general'); showPanel(SETTINGS_PANEL); }, shortcut: keyOf(SETTINGS_PANEL) },   // (on General)
      about: { run: () => openAbout() },
      focusMode: root.has('focus-mode'),
      splitKey: wb.shortcut('splitRight') ?? '',
    }), onClosed: () => { anchor.setAttribute('aria-expanded', 'false'); } });
    if (menu.open) anchor.setAttribute('aria-expanded', 'true');
  }
  /** an on-demand panel's key, as people read it (its view's keys), or none */
  const keyOf = (id: string) => { const k = editorView(id)?.panel?.keys; return k ? shortcutLabel(k) : ''; };
  /** an on-demand panel opened (docked on its side) and shown, focused */
  const showPanel = (id: string) => { if (openPanel(id)) wb.showPanel(id, { focus: true }); };
  /** an on-demand panel shown in its column now (open, its column open, its tab the active one) */
  const panelShown = (id: string) => {
    const l = wb.layout.peek(), d = M.dockOf(l, id);
    return panelOpen(id) && !!d && !M.sides(l)[d.side].collapsed && M.sideGroups(M.sides(l)[d.side]).some((g) => g.active === id);
  };
  /** shown: closed, as the close on its tab closes it; else opened and shown */
  const togglePanel = (id: string) => { if (panelShown(id)) editorView(id)?.panel?.onClose?.(); else showPanel(id); };
  /** the page's commands: what a key row runs on the page, not on the current document */
  const pageCommands: Record<string, (args: unknown) => void> = { 'app.panel': (id) => { if (typeof id === 'string') togglePanel(id); } };
  function runCommand(command: string, args: unknown): boolean {
    const own = pageCommands[command];
    if (own) { own(args); return true; }
    const ed = T().currentEditor();
    if (!ed) return false;
    return ed.run(command, {}, 'key') !== false;
  }

  // a restored tab whose document is gone (deleted in another window, a reset, another store) closes, shown or not
  const known = new Set((await store.listDocs()).map((d) => d.id));
  for (const t of M.allTabs(wb.layout.peek())) if (t.view === 'document' && !known.has((t.state as DocState).doc ?? '')) wb.close(t.id);
  // a document asked for by the URL at load
  const r0 = urlRouter.route.peek();
  if (r0.name === 'doc' && r0.id) await openDoc(r0.id);
  else if (!M.allTabs(wb.layout.peek()).length) wb.toggleHome(undefined, true);

  installTestSurface({ wb, tabs, store, services, kinds, openDoc, route: () => ({ ...currentRoute }), statusIdle: () => shown.idle() });
  void panelOff; void stopNarrow;   // (the page's lifetime)
  bootShown();          // (multi-file release) the loader's overlay hands over to the status line (boot/load-status.ts)
  document.dispatchEvent(new CustomEvent('editor:ready'));
  return { wb, tabs, root };
}
let tabsReady: Promise<DocTabs> | null = null;
let resolveTabs: ((t: DocTabs) => void) | null = null;

// ── the document view type ──
function registerDocument(wb: WorkbenchStore, tabs: () => DocTabs, openDoc: (id: string, o?: { beside?: boolean }) => Promise<string>) {
  const docOf = (s: DocState) => s.doc ?? null;
  wb.registerView<DocState>({
    id: 'document', icon: 'file', tabIcon: false, keepAlive: true,
    title: (s) => (s.doc ? (tabsOr(() => tabs().title(s.doc!).value) || 'Untitled') : 'Untitled'),
    docId: (s) => docOf(s),
    subtitle: (tab, ctx) => sectionChip(tab, ctx, tabs),
    switcher: (tab) => ({ onSelect: (e) => { void switcher(e.currentTarget ?? e.anchor!, tab, openDoc, wb); } }),
    rename: (tab, name) => { const ed = tabs().editorOf(tab.id) as unknown as { setTitle?(t: string): void } | null; ed?.setTitle?.(name); },
    focus: (ctx) => { const p = tabs().pane(ctx.viewId); (p?.el ?? null)?.focus?.({ preventScroll: true }); },
    // its text centred in the group while the groups' widths move (its column: the pane's --col, an inline style on its tab: no layout read)
    lockedLeft: (ctx, w) => lockedLeft(w, parseFloat(tabsOr(() => tabs().pane(ctx.viewId)?.el.parentElement?.style.getPropertyValue('--col') ?? ''))),
    Component: DocumentTab,
  });
  function DocumentTab({ tab, ctx }: { tab: Tab; ctx: WbContext }) {
    const doc = (tab.state as DocState).doc ?? '';
    return html`<${DocPaneHost} key=${doc} tab=${tab} ctx=${ctx} doc=${doc} />`;
  }
  function DocPaneHost({ tab, ctx, doc }: { tab: Tab; ctx: WbContext; doc: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      let off = () => {};
      let gone = false;
      void (tabsReady ?? Promise.resolve(tabs())).then((t) => {
        if (gone || !ref.current) return;
        const p = t.mount(tab.id, ref.current, doc);
        // the place it was read at (the section in view), restored once it opened; followed as it changes
        const at = (ctx.state.peek() as DocState).at ?? null;
        // a document that cannot be opened (gone: deleted, a reset, another store) closes its tab, as the old page went home
        void p.ready.catch(() => false).then((ok) => { if (gone || (ctx.state.peek() as DocState).doc !== doc) return; if (!ok) { ctx.close(); return; } if (at) p.editor.run('nav.scrollTo', { id: at, pane: tab.id, quiet: true }); });   // (the place only: no selection, no focus moved)
        off = effect(() => { const s = p.section.value; if (s && (ctx.state.peek() as DocState).at !== s.id) untracked(() => ctx.setState({ at: s.id })); });
      });
      return () => { gone = true; off(); tabs().unmount(tab.id); };
    }, []);
    return html`<div class="rtx-tab" ref=${ref} data-doc=${doc}></div>`;
  }
}
/** a signal read that tolerates the document part not made yet (a title before the tabs exist) */
function tabsOr<T>(f: () => T): T | '' { try { return f(); } catch { return ''; } }

function sectionChip(tab: Tab, ctx: WbContext, tabs: () => DocTabs): Subtitle | null {
  const sec = tabsOr(() => tabs().section(tab.id).value) || null;
  if (!sec) return null;
  const c = crumbsOf({ docId: (tab.state as DocState).doc ?? null, title: '', section: sec as OutlineItem }).section;
  if (!c) return null;
  return { label: c.label, num: c.num, text: c.text, kind: c.kind, title: `${c.title}: other sections…`,
    onSelect: (e) => { sectionMenu(e.currentTarget ?? e.anchor!, tab, ctx, tabs, e.returnFocus as HTMLElement | null | undefined); } };
}
/** a document at a section (its heading's block) in a new tab, focused: the section menu's row action, the Outline's */
function openSectionTab(wb: WorkbenchStore, doc: string, at: string) { wb.open({ view: 'document', state: { doc, at } }, { focus: true }); }
function sectionMenu(anchor: Element, tab: Tab, ctx: WbContext, tabs: () => DocTabs, returnFocus?: HTMLElement | null) {
  const ed = tabs().editorOf(tab.id);
  if (!ed) return;
  const items = ed.outline();
  const cur = tabs().section(tab.id).peek();
  const doc = (tab.state as DocState).doc;
  const toc = items.some((x) => x.kind);
  const go = (id: string) => { ctx.wb.activate(tab.id); tabs().focus(tab.id); ed.run('nav.scrollTo', { id }); };
  const inNew = (id: string) => { if (doc) openSectionTab(ctx.wb, doc, id); };
  // the pin: this tab's pane focused on the section (view.sectionFocus); the focused section's row leaves it
  const pinned = ed.focusedSection(tab.id);
  const pin = (id: string | null) => { ctx.wb.activate(tab.id); tabs().focus(tab.id); ed.run('view.sectionFocus', { id, pane: tab.id }); };
  const rows: SelectRow[] = [{ heading: toc ? 'Contents' : 'Sections' }, ...items.map((it) => ({
    id: `sec-${it.id}`, num: it.number || undefined, label: it.title, depth: Math.max(0, it.level - 1), active: it.id === cur?.id,
    onSelect: (ev?: MouseEvent) => ((ev?.ctrlKey || ev?.metaKey) ? inNew(it.id) : go(it.id)),
    actions: it.special ? [] : [{ key: 'pin', icon: it.id === pinned ? 'unfocus' as const : 'focus' as const, label: pinLabel(it, it.id === pinned), onSelect: () => pin(it.id === pinned ? null : it.id) }],
    action: { icon: 'newTab' as const, label: newTabLabel(it), onSelect: () => inNew(it.id) },
  }))];
  openRowMenu(anchor, rows, { label: toc ? 'Contents' : 'Sections', returnFocus: returnFocus ?? null });
}
async function switcher(anchor: Element, tab: Tab, openDoc: (id: string, o?: { beside?: boolean }) => Promise<string>, wb: WorkbenchStore) {
  const store = storeRef;
  if (!store) return;
  const list = await store.listDocs({ limit: 30 });
  const here = (id: string) => { wb.replace(tab.id, { view: 'document', state: { doc: id } }); wb.activate(tab.id, { focus: true }); };
  openRowMenu(anchor, [{ heading: 'Documents' }, ...list.map((d) => ({
    id: `doc-${d.id}`, label: d.title || 'Untitled', active: d.id === (tab.state as DocState).doc,
    onSelect: (ev?: MouseEvent) => { if (ev?.ctrlKey || ev?.metaKey) void openDoc(d.id, { beside: true }); else here(d.id); },
    action: { icon: 'newTab' as const, label: `Open ${d.title || 'Untitled'} in a new tab`, onSelect: () => { void openDoc(d.id, { beside: true }); } },
  }))], { label: 'Switch document' });
}
let storeRef: StoreLike | null = null;

// ── home: the editor's own Documents view (home/screen.js), in each group's home panel ──
type MountHome = (el: HTMLElement, ctx: { store: unknown; io: unknown; open(id: string): void; openBeside?(id: string): void }) => { destroy(): void; idle?(): Promise<void> };
function registerHome(wb: WorkbenchStore, store: StoreLike, io: unknown, mountHome: MountHome) {
  storeRef = store;
  wb.registerView({ id: 'home', title: () => 'Documents', icon: 'home', Component: ({ ctx }: { tab: Tab; ctx: WbContext }) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const spec = (id: string) => ({ view: 'document', state: { doc: id } });
      // open: in home's place (the tab it is over: replaced; an empty group: a new tab); in a new tab: beside it
      const h = mountHome(ref.current!, { store, io, open: (id) => ctx.open(spec(id)), openBeside: (id) => ctx.open(spec(id), { beside: true }) });
      setLastHome(h);
      document.title = 'Documents · ReflowEd';
      return () => { h.destroy(); setLastHome(null, h); };
    }, []);
    return html`<div class="home-view rtx-wb-home" ref=${ref}></div>`;
  } });
}

// ── the side panels: the editor's registered panels (design/ui/views.ts), drawn with its ViewContext ──
function registerPanels(wb: WorkbenchStore, root: ReturnType<typeof createEditorRoot>) {
  const mine = new Map<string, { def: ViewDef; off: () => void }>();
  const Frame = ({ children }: { children?: ComponentChildren }) => html`${children}`;
  const slots = slotsOf(root);
  function add(v: ViewDef) {
    const off = wb.registerView({
      id: v.id, title: () => (typeof v.title === 'function' ? v.title(null) : v.title ?? v.id), icon: isIconName(v.icon) ? v.icon : 'list',
      // a count on its tab (the Problems, the TODOs): the badge its content sets (app/panels.ts)
      ...(v.count ? { badge: () => { const b = slots.badge(v.id).value; return b?.n ? { n: b.n, ...(b.title ? { title: b.title } : {}), ...(b.tone === 'danger' ? { tone: 'danger' as const } : {}) } : null; } } : {}),
      // its side, its place (below: a group of its own at the column's bottom), its column's default width (a share of the
      // window: the workbench's sideWidth) and its close (a closable panel: an on-demand one's closes it) as the view gives them
      panel: { side: v.panel?.side ?? 'left', ...(v.panel?.below ? { below: true } : {}), ...(v.panel?.width ? { width: v.panel.width } : {}), ...(v.panel?.onClose ? { onClose: v.panel.onClose } : {}) },
      Component: ({ ctx }: { tab: Tab; ctx: WbContext }) => {
        const ref = useRef<HTMLDivElement>(null);
        const ectx = useMemo(() => panelContext(root, v.id, { visible: ctx.visible, openAt: (doc, at) => openSectionTab(wb, doc, at) }), []);
        // a mount view (References, Files) is mounted with the current document's panel host and again when it changes (a
        // switch, the first document after a reload): as a Component re-renders with it
        const cur = ectx.current.value;
        useLayoutEffect(() => {
          if (v.Component || !v.mount || !cur) return;
          const m = v.mount(ref.current!, ectx);
          return () => m.unmount();
        }, [cur]);
        const C = v.Component as unknown as ((p: { ctx: unknown }) => ComponentChildren) | undefined;
        // the app's chrome ([data-ui-chrome], design/ui/layers.js owns): a press in a panel (Copy all, an outline row) is
        // not "outside" for a block being edited, as on the old page's sidebar; it left the editor here
        return html`<div class="sb-panel rtx-wb-panel" data-panel-view=${v.id} id=${root.id(`panel-${v.id}`)} ref=${ref} data-ui-chrome>${C ? html`<${FrameContext.Provider} value=${Frame}><${C} ctx=${ectx} /><//>` : null}</div>`;
      },
    });
    mine.set(v.id, { def: v, off });
    if (v.panel?.onDemand) wb.showPanel(v.id);     // (an on-demand panel is here because it was opened: it is shown)
  }
  // the registry may change (an on-demand panel opened or closed; the Files panel offered with the advanced switch)
  const stop = effect(() => {
    const list = editorViews('sidebar');
    untracked(() => {
      for (const [id, m] of mine) if (!list.includes(m.def)) { m.off(); mine.delete(id); }
      for (const v of list) if (!mine.has(v.id)) add(v);
      // a restored layout's panel that is not registered now (the Files panel without the advanced switch)
      for (const id of [...M.sidePanels(M.sides(wb.layout.peek()).left), ...M.sidePanels(M.sides(wb.layout.peek()).right)]) if (!wb.viewType(id)) wb.removePanel(id);
    });
  });
  // a request to show a panel (slots.show: the References pane from a citation or the Settings panel's Open References; an
  // on-demand one is opened first): the workbench shows it where it is docked; the request is consumed, so the same one
  // later shows it again
  const want = slots.active('sidebar');
  const stopShow = effect(() => { const id = want.value; if (!id) return; untracked(() => { want.value = null; openPanel(id); if (wb.viewType(id)) wb.showPanel(id); }); });
  return () => { stop(); stopShow(); for (const m of mine.values()) m.off(); mine.clear(); };
}

// ── the window bar: the main menu (the Re button) at its left, the View options' button at its right (a split is the
//    tab's context menu, its key or the main menu's View › Split view: no button) ──
function barSpec(onMenu: (anchor: HTMLElement, focus: boolean) => void) {
  return {
    label: 'ReflowEd',
    // (data-ui-chrome: a press on it is not "outside" for a block being edited)
    left: () => html`<span class="rtx-wb-menu" data-ui-chrome><${kit.Button} id="btn-main-menu" class="rtx-main-menu" tip="Menu" aria-label="Main menu" aria-haspopup="menu" aria-expanded="false"
        onClick=${(e: MouseEvent) => { e.stopPropagation(); onMenu(e.currentTarget as HTMLElement, e.detail === 0); }}>
      <span class="rtx-wb-logo" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON_SVG }}></span><span class="rtx-main-menu-chev" aria-hidden="true"><${Icon} name="chevronDown" /></span>
    <//></span>`,
    right: () => html`<span class="rtx-wb-bar" data-part="topbar" data-ui-chrome><span class="topbar-slot" data-slot="view"></span></span>`,
  };
}
/** the left column's status line: the build (About), the current document's word count, and (multi-file release) the files
 *  still loading after the UI came (boot/load-status.ts) */
function SideStatus({ root }: { root: ReturnType<typeof createEditorRoot> }) {
  return html`<button class="rtx-preview-pill rtx-wb-version" type="button" data-about title="About and licence">${buildVersion().label}</button><${WordCountStatus} root=${root} /><${LoadStatus} />`;
}

