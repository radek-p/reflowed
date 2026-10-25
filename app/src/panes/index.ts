// PANES: the panes of one document editor, equal: each a Pane (panes/pane.ts) of its own BlockViews, made
// from the layout model (panes/layout.js) — the layout is the data, this module makes the DOM follow it: a
// pane in the layout gets its <main>, DocumentView, views and keeper; a pane taken out of it goes, with
// everything it added. No pane is special: the first one's scroller is the window while it is alone in a
// window-scrolled editor (the standalone page scrolls as it always did), and its <main> otherwise, like the others'.
//
// The panes live in the editor's container (app/editor-root.ts): the first pane's <main> is its
// [data-part=page], the split is a class on its [data-part=view], the reading line is under its top bar (root.inset());
// nothing is looked up by a page id.
//
//   const panes = createPanes({ root, layout, docView, keeperFor, host })
//     docView: pane 'a''s DocumentView (made on the container's [data-part=doc-view-host])
//     keeperFor(o) -> anchor keeper | null       o: { list(), inset?(), scroller?, lines? (view/line-anchor.ts) }
//     host: { makeView(paneId, blockId), blocks(), opened(pane, { near, heights }), closing(pane), toggled(split), hasDoc(), closeSplit?(keepId) }
//   panes.list() · panes.get(id) · panes.focused() (the Pane) · panes.paneOf(node) -> id | null
//   panes.viewOf(paneId, blockId) · panes.viewsOf(blockId) (layout order) · panes.isSplit
//   panes.open(id = 'b') · panes.close(id = 'b') · panes.toggle() · panes.sync() · panes.start() · panes.stop()
//   panes.widths (panes/widths.js, the blocks' widths while the panes change) · panes.dispose()
//
// Another document in a pane: a layout entry this editor does not own (`owns(entry)` false: its document is
// not this editor's) is a GUEST pane. This registry still makes its chrome (the divider and its <main>: the page's
// split is one), and `guests.open(id, { pane, host })` hands the <main> to the editor of that document, which
// makes its Pane there (a registry made with `only`); `guests.close(id)` takes it back. The guests' Panes are in
// the width governor's list and get their scrollers like this registry's own.
//   createPanes({ …, owns(entry) -> bool, guests: { open(id, chrome) -> Pane | null, close(id) } })
//   createPanes({ root, layout, only: { id, el, docView }, widths, keeperFor, host })   a guest registry: its first pane
//     on a <main> another registry made; the page's width governor (`widths`) is shared, not its own; every
//     other pane showing the same document is added to it (reg.add(id, chrome), reg.remove(id))
//   panes.guests() -> the guest Panes (layout order)
//
// A pane may show a registered VIEW instead of a document: a layout entry { id, view, of }
// gets the pane's chrome here and the view's content in it (panes/view-pane.js, a PaneFrame around it). It is no
// Pane: it has no blocks, keeper, scroller or selection, and the width governor does not see it.
//   panes.viewPanes() -> [{ id, view, el }] (layout order)
import { effect, untracked, signal } from '@preact/signals';
import { panelContext } from '../app/view-context.ts';
import { createDocumentView } from '../docview/document-view.js';
import { mountSplitChrome } from '../docview/split-chrome.js';
import { createPane } from './pane.ts';
import { createWidths } from './widths.js';
import { relayout, laidAt } from '../view/viewer-host.ts';
import { lineAnchor } from '../view/line-anchor.ts';
import { mountViewPane } from './view-pane.js';
import type { EditorRoot } from '../app/editor-root.ts';
import type { BlockRef, BlockView, DocView, Keeper, Layout, LayoutEntry, Owned, Pane, Widths } from './types.ts';
import { reduced } from '../motion/reduced.ts';

const MIN = 260;

/** a pane's chrome (docview/split-chrome.js): the divider and the <main> */
export interface Chrome { divider: HTMLElement; pane: HTMLElement; host: HTMLElement; add: HTMLElement | null; destroy(): void; wrap?: HTMLElement }
export interface Shown { near: Set<string>; heights: Map<string, number> }
export interface PanesHost {
  makeView(paneId: string, blockId: string): BlockView;
  blocks(): BlockRef[];
  opened(p: Pane, o?: Partial<Shown>): void;
  closing(p: Pane): void;
  toggled(split: boolean): void;
  hasDoc(): boolean;
  closeSplit?(keep: string): void;
}
export interface Guests { open(id: string, chrome: { pane: HTMLElement; host: HTMLElement; add: HTMLElement | null }): Pane | null; close(id: string): void }
/** lines: the reader's line, held across a width change (view/line-anchor.ts) */
export interface KeeperOptions { list(): HTMLElement | null; inset(): number; scroller: HTMLElement | null; lines?: typeof lineAnchor }
export interface PanesOptions {
  root: EditorRoot;
  layout: Layout;
  docView: DocView;
  keeperFor?: (o: KeeperOptions) => Keeper | null;
  host: PanesHost;
  owns?: (entry: LayoutEntry) => boolean;
  guests?: Guests | null;
  only?: { id: string; el: HTMLElement; docView: DocView } | null;
  widths?: Widths | null;
}
export interface Panes {
  list(): Pane[];
  get(id: string | null | undefined): Pane | null;
  readonly first: Pane;
  focused(): Pane;
  paneOf(node: Node | null): string | null;
  viewOf(pid: string, bid: string): BlockView | null;
  viewsOf(bid: string): BlockView[];
  readonly isSplit: boolean;
  guests(): Pane[];
  viewPanes(): { id: string; view: string; el: HTMLElement | null }[];
  widths: Widths;
  open(id?: string): void;
  close(id?: string): void;
  toggle(): void;
  sync(): void;
  start(): void;
  stop(): void;
  closeAll(): void;
  dispose(): void;
  /** a guest registry only: pane `id` shows this document too */
  add?(id: string, chrome: { pane: HTMLElement; host: HTMLElement }): Pane;
  /** a guest registry only: pane `id` no longer shows it; the number of panes left */
  remove?(id: string): number;
}
interface ViewPane { view: string; of: unknown; m: { update(of: unknown): void; destroy(): void } | null }
interface Place { el: HTMLElement; y: number }

export function createPanes({ root, layout, docView, keeperFor = () => null, host, owns = () => true, guests = null, only = null, widths: shared = null }: PanesOptions): Panes {
  const panes = new Map<string, Pane>();          // id -> Pane, layout order
  const chrome = new Map<string, Chrome>();       // id -> its divider and <main> (not for the first pane)
  const guestPanes = new Map<string, { doc: string | null; pane: Pane | null }>();   // id -> the other editor's Pane
  const viewPanes = new Map<string, ViewPane>();  // id -> { view, of, m (its mount) }
  const count = () => panes.size + guestPanes.size + viewPanes.size;
  let running = false;
  const shellEl = () => root.part('view');
  const ownScroll = !root.windowScroll;            // an embedded editor's first pane scrolls itself, alone too
  const alone = (p: Pane) => (ownScroll ? p.el : null);

  // the first pane: the container's [data-part=page] and its DocumentView (a guest registry: its one pane)
  const firstEl = only ? only.el : root.part('page');
  if (!firstEl) throw new Error('panes: the editor has no [data-part=page]');
  const first = makePane(only ? only.id : 'a', firstEl, only ? only.docView : docView, null);
  first.setScroller(only ? only.el : alone(first));
  // the view's classes: .split (more than one pane: the grid's columns), .scrolls (every pane its own scroller: split,
  // or an embedded editor's one pane)
  if (!only) shellEl()?.classList.toggle('scrolls', !!first.scroller);
  const guestList = () => [...guestPanes.values()].map((g) => g.pane).filter((p): p is Pane => !!p);
  // a change of the panes' widths re-breaks what is in view once, the rest lazily (panes/widths.js); one per editor
  const widths: Widths = shared ?? createWidths({ panes: () => [...panes.values(), ...guestList()], relayout, laidAt, state: root.state });
  if (only) return guestRegistry();
  const EASE = 'cubic-bezier(0.2, 0, 0, 1)', SLIDE_MS = 220;
  /** the first pane's column slides from where it was to where it is now (its lines kept: pinned) */
  const columnX = () => first.view.container?.getBoundingClientRect().left ?? 0;
  function slideColumn(from: number) {
    const list = first.view.container, dx = from - columnX();
    if (!list || Math.abs(dx) < 1 || reduced()) return null;
    return list.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE }).finished.catch(() => {});
  }

  function makePane(id: string, el: HTMLElement, view: DocView, owned: Owned | null): Pane {
    const keeper = keeperFor({ list: () => view.container, inset: () => root.inset(), scroller: null, lines: lineAnchor });
    const p = createPane({ id, el, docView: view, keeper, owned, inset: () => root.inset() });
    p.onFocus((pid) => layout.focus(pid));
    panes.set(id, p);
    return p;
  }

  // ── open / close, from the layout ──
  /** a pane's divider and <main> after the last pane's (its own or a guest's) */
  function mountChrome(id: string): Chrome {
    const ids = layout.ids(), at = ids.indexOf(id);
    const prevId = [...ids.slice(0, at)].reverse().find((x) => chrome.has(x) || x === first.id) ?? first.id;
    const after = chrome.get(prevId)?.wrap ?? first.el;
    const c: Chrome = mountSplitChrome(after, {
      pane: id, ids: root.id('page-'),
      onPointerDown: (e: PointerEvent) => dividerDrag(e, c.divider),
      onKeyDown: (e: KeyboardEvent) => {
        const d = e.key === 'ArrowLeft' ? -32 : e.key === 'ArrowRight' ? 32 : 0;
        if (!d) return;
        e.preventDefault();
        widths.transition(() => setWidth(first.el.getBoundingClientRect().width + d, c.divider), { animate: false });
      },
    });
    c.wrap = c.pane.parentElement ?? undefined;
    chrome.set(id, c);
    shellEl()?.classList.add('split', 'scrolls');
    return c;
  }
  function openPane(id: string) {
    if (panes.has(id) || !host.hasDoc()) return null;
    const a = first;
    const keepA = firstShown(a.el, 0);                     // pane A's place, kept as the window scroll becomes the pane's
    const seen = shownNow(a);                              // the new pane makes its views of these at once, the rest lazily
    const c = mountChrome(id);
    const view: DocView = createDocumentView(c.host, { id, primary: false });
    const p = makePane(id, c.pane, view, c);
    for (const q of panes.values()) q.setScroller(q.el);  // split: every pane scrolls on its own
    host.toggled(true);                                    // the panes' bars first: they move the panes' tops
    if (keepA) a.el.scrollTop += keepA.el.getBoundingClientRect().top - keepA.y;
    // the new pane's shells in a task of their own, after the switch's first frame: the switch (pane A's
    // restyle and layout) and the 195 shells were one 75–130 ms task. The pane is fading in from transparent
    // meanwhile; nothing reads its views before (the governor pins after `opening`, panes.sync makes them anyway)
    p.opening = new Promise<void>((res) => requestAnimationFrame(() => setTimeout(() => {
      if (panes.get(id) === p && !p.disposed) {
        host.opened(p, seen);                              // its views, their presentation, the results delivered
        p.el.scrollTop = a.el.scrollTop;
        if (running) p.keeper?.start();
      }
      p.opening = null;
      res();
    }, 0)));
    return p;
  }

  /** a pane showing another document: its chrome here, its Pane the other document's editor's */
  function openGuest(id: string, doc: string | null) {
    if (guestPanes.has(id) || !guests) return null;
    const keepA = firstShown(first.el, 0);
    const c = mountChrome(id);
    for (const q of panes.values()) q.setScroller(q.el);
    const g: { doc: string | null; pane: Pane | null } = { doc, pane: null };
    guestPanes.set(id, g);
    try { g.pane = guests.open(id, { pane: c.pane, host: c.host, add: c.add }) ?? null; } catch (e) { console.error('pane: another document:', e); }
    host.toggled(true);
    if (keepA) first.el.scrollTop += keepA.el.getBoundingClientRect().top - keepA.y;
    return g;
  }
  function closeGuest(id: string) {
    const g = guestPanes.get(id);
    if (!g) return;
    const keepA = firstShown(first.el, first.el.getBoundingClientRect().top);
    guestPanes.delete(id);
    try { guests?.close(id); } catch (e) { console.error('pane: another document:', e); }
    chrome.get(id)?.destroy();
    chrome.delete(id);
    splitEnded(keepA);
  }
  /** a pane showing a registered view: its chrome here, the view's content in its host */
  function openViewPane(id: string, entry: LayoutEntry) {
    if (viewPanes.has(id) || !entry.view) return null;
    const keepA = firstShown(first.el, 0);
    const c = mountChrome(id);
    c.pane.classList.add('view-pane-main');
    c.pane.setAttribute('aria-label', 'View pane');
    for (const q of panes.values()) q.setScroller(q.el);
    const v: ViewPane = { view: entry.view, of: entry.of ?? null, m: null };
    viewPanes.set(id, v);
    const ctx = panelContext(root, entry.view, { visible: signal(true), can: { close: true } });   // the pane's ViewContext: shown while it is open
    try { v.m = mountViewPane(c.host, { view: entry.view, of: entry.of ?? null, close: () => layout.close(id), ctx }); } catch (e) { console.error('pane: a view:', e); }
    host.toggled(true);
    if (keepA) first.el.scrollTop += keepA.el.getBoundingClientRect().top - keepA.y;
    return v;
  }
  function closeViewPane(id: string) {
    const v = viewPanes.get(id);
    if (!v) return;
    const keepA = firstShown(first.el, first.el.getBoundingClientRect().top);
    viewPanes.delete(id);
    try { v.m?.destroy(); } catch (e) { console.error('pane: a view:', e); }
    chrome.get(id)?.destroy();
    chrome.delete(id);
    splitEnded(keepA);
  }
  /** one pane left: the window scrolls again in a window-scrolled editor (else the bars laid out again) */
  function splitEnded(keepA: Place | null) {
    if (count() === 1) {
      first.setScroller(alone(first));                    // one pane: the window scrolls again (an embedded editor: the pane)
      shellEl()?.classList.remove('split');
      shellEl()?.classList.toggle('scrolls', !!first.scroller);
      host.toggled(false);                                 // the panes' bars go first: they moved the pane's top
      if (keepA && keepA.el.isConnected) {
        const dy = keepA.el.getBoundingClientRect().top - keepA.y;
        if (first.scroller) first.scroller.scrollTop += dy; else window.scrollBy({ top: dy, behavior: 'instant' });
      }
    } else host.toggled(true);
  }

  function closePane(id: string) {
    const p = panes.get(id);
    if (!p || p === first) return;
    const keepA = firstShown(first.el, first.el.getBoundingClientRect().top);
    host.closing(p);                                       // its editor closes (edit/: the session of that pane)
    p.dispose();                                           // its views, keeper, DocumentView and chrome
    panes.delete(id);
    chrome.delete(id);
    splitEnded(keepA);
  }
  // the layout is the source of truth: panes follow it (open, close), and so do the split's class and width
  const unwatch = effect(() => {
    const entries = layout.panes.value;
    const w = layout.width.value;
    // the work itself is not tracked: what opening a pane reads (the document, its signals) is not the layout
    untracked(() => {
      // a pane's entry is this editor's (its own Pane) or a guest's (another document: its key has the document)
      // an entry naming a view is neither: a view pane (the first pane is always a document's)
      const isView = (x: LayoutEntry) => x.id !== first.id && !!x.view;
      const wantOwn = entries.filter((x) => x.id === first.id || (!isView(x) && owns(x))).map((x) => x.id);
      const wantGuest = new Map(entries.filter((x) => x.id !== first.id && !isView(x) && !owns(x) && guests).map((x) => [x.id, x.doc]));
      const wantView = new Map(entries.filter(isView).map((x) => [x.id, x]));
      const goneV = [...viewPanes.keys()].filter((id) => wantView.get(id)?.view !== viewPanes.get(id)?.view);
      const comeV = [...wantView.keys()].filter((id) => (!viewPanes.has(id) || goneV.includes(id)) && host.hasDoc());
      // the same view with new props: drawn again in place
      for (const [id, x] of wantView) { const v = viewPanes.get(id); if (v && !goneV.includes(id) && v.of !== (x.of ?? null)) { v.of = x.of ?? null; v.m?.update(v.of); } }
      const goneG = [...guestPanes.keys()].filter((id) => wantGuest.get(id) !== guestPanes.get(id)?.doc);
      const comeG = [...wantGuest.keys()].filter((id) => (!guestPanes.has(id) || goneG.includes(id)) && host.hasDoc());
      const gone = [...panes.keys()].filter((id) => !wantOwn.includes(id)), come = wantOwn.filter((id) => !panes.has(id) && host.hasDoc());
      const apply = () => {
        for (const id of goneV) closeViewPane(id);
        for (const id of goneG) closeGuest(id);
        for (const id of gone) closePane(id);
        for (const id of come) openPane(id);
        for (const id of comeG) openGuest(id, wantGuest.get(id) ?? null);
        for (const id of comeV) { const e = wantView.get(id); if (e) openViewPane(id, e); }
        const sh = shellEl();
        if (sh) { if (w != null && count() > 1) sh.style.setProperty('--split-a', `${w}px`); else sh.style.removeProperty('--split-a'); }
      };
      if (!gone.length && !come.length && !goneG.length && !comeG.length && !goneV.length && !comeV.length) { apply(); return; }
      // the split on or off: the blocks keep their lines while the first pane's column slides to its new place
      // and a new pane fades in; then the blocks in view are re-broken once, cross-faded, the rest lazily
      let x0 = 0, motions: Promise<unknown>[] = [];
      widths.transition(() => {
        x0 = columnX();
        apply();
        motions = [slideColumn(x0), ...come.map((id) => fadeIn(panes.get(id)?.el)), ...[...comeG, ...comeV].map((id) => fadeIn(chrome.get(id)?.pane))]
          .filter((m): m is Promise<void> => !!m);
        // the new panes' shells, made in the next task: the governor waits for them before it pins
        const opening = come.map((id) => panes.get(id)?.opening).filter((o): o is Promise<void> => !!o);
        return opening.length ? Promise.all(opening) : undefined;
      }, { animate: true, motion: () => Promise.all(motions) });
    });
  });

  function fadeIn(el: HTMLElement | undefined) {
    if (!el || reduced()) return null;
    return el.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: SLIDE_MS, easing: EASE }).finished.catch(() => {});
  }

  function dividerDrag(e: PointerEvent, divider: HTMLElement) {
    if (e.button !== 0) return;
    const sh = shellEl();
    if (!sh) return;
    e.preventDefault();
    const r = sh.getBoundingClientRect();
    divider.setPointerCapture?.(e.pointerId);
    widths.begin();                                        // the blocks in view follow, a frame's budget at a time
    const move = (ev: PointerEvent) => { setWidth(ev.clientX - r.left, divider); widths.frame(); };
    const up = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', up); divider.removeEventListener('pointercancel', up); divider.classList.remove('dragging'); widths.end(); };
    divider.classList.add('dragging');
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
  }
  function setWidth(px: number, divider: HTMLElement | null) {
    const sh = shellEl();
    if (!sh) return;
    const w = sh.getBoundingClientRect().width;
    const a = Math.round(Math.max(MIN, Math.min(w - MIN - 7, px)));
    layout.setWidth(a);
    divider?.setAttribute('aria-valuenow', String(Math.round((a / w) * 100)));
  }

  /** pane P's blocks in view now (and half a view around), and every block's height there: one read pass */
  function shownNow(P: Pane): Shown {
    const box = P.box(), m = (box.bottom - box.top) / 2;
    const near = new Set<string>(), heights = new Map<string, number>();
    for (const [id, v] of P.views) {
      const r = v.root.getBoundingClientRect();
      heights.set(id, r.height);
      if (r.height > 0 && r.bottom > box.top - m && r.top < box.bottom + m) near.add(id);
    }
    return { near, heights };
  }

  /** the reading point of a pane's <main>: the first block element that starts at or below `top` (a viewport y), as
   *  the anchor keeper holds it, else the one across it; and its y */
  function firstShown(el: HTMLElement, top: number): Place | null {
    const list = el.querySelector('.blocks');
    if (!list) return null;
    const inset = top || root.inset();
    let across: Place | null = null;
    for (const b of list.children) {
      if (!(b instanceof HTMLElement) || b.offsetParent === null || b.classList.contains('nest-head')) continue;
      const r = b.getBoundingClientRect();
      if (r.bottom <= inset) continue;
      if (r.top >= inset - 0.5) return { el: b, y: r.top };
      across ??= { el: b, y: r.top };
    }
    return across;
  }

  // ⌘⌥\ (Ctrl+Alt+\ elsewhere): split view on and off (the page's keys: the editor's when it takes them)
  const offKey = root.listen(root.doc, 'keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === '\\' || e.code === 'Backslash') && root.takesKey(e)) { e.preventDefault(); toggle(); }
  });

  function open(id = 'b') { if (host.hasDoc()) layout.open(id); }
  function close(id = 'b') { layout.close(id); }
  // split view closed from a pane: that pane stays (host.closeSplit: panes/close-split.js); without one, the last goes
  function toggle() {
    if (count() < 2) { open('b'); return; }
    if (host.closeSplit) host.closeSplit(layout.focused.peek());
    else { const last = [...panes.keys()].at(-1); if (last) close(last); }
  }

  const api: Panes = {
    list: () => [...panes.values()],
    get: (id) => (id ? panes.get(id) ?? null : null),
    get first() { return first; },
    focused: () => panes.get(layout.focused.peek()) ?? first,
    paneOf(node) {
      if (!node) return null;
      for (const p of panes.values()) if (p.contains(node)) return p.id;
      return null;
    },
    viewOf: (pid, bid) => panes.get(pid)?.viewOf(bid) ?? null,
    viewsOf: (bid) => { const out: BlockView[] = []; for (const p of panes.values()) { const v = p.viewOf(bid); if (v) out.push(v); } return out; },
    get isSplit() { return count() > 1; },
    guests: () => guestList(),
    viewPanes: () => layout.ids().flatMap((id) => { const v = viewPanes.get(id); return v ? [{ id, view: v.view, el: chrome.get(id)?.pane ?? null }] : []; }),
    widths,
    open, close, toggle,
    /** every pane's views of the document's blocks, in order */
    sync() { const list = host.blocks(); for (const p of panes.values()) p.sync(list, (bid) => host.makeView(p.id, bid)); },
    start() { running = true; for (const p of panes.values()) p.keeper?.start(); },
    stop() { running = false; for (const p of panes.values()) p.keeper?.stop(); },
    /** the panes the layout has besides the first, closed (a document closed) */
    closeAll() { for (const id of layout.ids()) if (id !== first.id) layout.close(id); },
    dispose() {
      widths.dispose();
      unwatch();
      offKey();
      for (const id of [...guestPanes.keys()]) closeGuest(id);
      for (const id of [...viewPanes.keys()]) closeViewPane(id);
      for (const id of [...panes.keys()]) if (panes.get(id) !== first) closePane(id);
      first.dispose();
      panes.clear();
    },
  };
  return api;

  /** the registry of a guest: its Panes on the <main>s the page's registry made, the page's governor. One
   *  document's editor shows it in every pane that shows it: add(id, el, view) a pane more, remove(id) one less. */
  function guestRegistry(): Panes {
    const firstPane = () => panes.values().next().value ?? first;
    const reg: Panes = {
      list: () => [...panes.values()],
      get: (id) => (id ? panes.get(id) ?? null : null),
      get first() { return firstPane(); },
      focused: () => panes.get(layout.focused.peek()) ?? firstPane(),
      paneOf(node) { if (!node) return null; for (const p of panes.values()) if (p.contains(node)) return p.id; return null; },
      viewOf: (pid, bid) => panes.get(pid)?.viewOf(bid) ?? null,
      viewsOf: (bid) => { const out: BlockView[] = []; for (const p of panes.values()) { const v = p.viewOf(bid); if (v) out.push(v); } return out; },
      isSplit: true,
      guests: () => [],
      viewPanes: () => [],
      widths,
      open() {}, close() {}, toggle() {},
      /** pane `id` shows this document too: its Pane on the <main> the page's registry made (chrome.pane, .host) */
      add(id, ch) {
        const have = panes.get(id);
        if (have) return have;
        // (the workbench's split) as openPane: the new pane makes its views of the blocks the pane it comes from
        // shows at once and the rest lazily, each reserved at its height there (all of them in the click's task was one
        // 600 ms task for a 30-block document: a viewer mount and a layout read per block)
        const from = host.hasDoc() ? reg.focused() : null;
        const seen = from && from.views.size ? shownNow(from) : undefined;
        const el = ch.pane, view: DocView = createDocumentView(ch.host, { id, primary: false });
        const p = makePane(id, el, view, null);
        p.setScroller(el);
        p.onDispose(() => view.destroy?.());
        if (host.hasDoc()) host.opened(p, seen); else p.needsOpen = true;   // (the document still loading: on its first sync)
        if (running) p.keeper?.start();
        host.toggled(true);                                  // its bar
        return p;
      },
      /** pane `id` no longer shows it: its Pane goes; the number of panes left */
      remove(id) {
        const p = panes.get(id);
        if (!p) return panes.size;
        host.closing(p);
        p.dispose();
        panes.delete(id);
        host.toggled(true);
        return panes.size;
      },
      sync() {
        const list = host.blocks();
        for (const p of panes.values()) {
          if (p.needsOpen && host.hasDoc()) { p.needsOpen = false; host.opened(p); continue; }
          p.sync(list, (bid) => host.makeView(p.id, bid));
        }
      },
      start() { running = true; for (const p of panes.values()) p.keeper?.start(); },
      stop() { running = false; for (const p of panes.values()) p.keeper?.stop(); },
      closeAll() {},
      dispose() { for (const p of panes.values()) p.dispose(); panes.clear(); },
    };
    return reg;
  }
}
export { createPaneStates } from './pane-state.js';   // each pane's own UI state
export { closeSplitKeeping } from './close-split.js';   // split view closed from a pane
