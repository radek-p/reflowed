// The workbench's store and host API: the layout as a signal, the registered view types, the
// panel hosts (each tab's content in its own element and Preact root, owned here, so layout changes never
// remount a view), reopen-closed, events, the keymap and focus.
import { signal, computed, batch, effect } from '@preact/signals';
import { createProgressTicker } from './ticker.ts';
import { createContext, type ComponentChildren } from 'preact';
import { html, render } from './html.ts';
import * as M from './model.ts';
import { createContentDrag } from './drag.ts';
import { Crumbs } from './crumbs.ts';
import { SideToggle } from './sides.ts';
import { ShortcutsView } from './shortcuts.ts';
import { bindings, createMatcher, currentPlatform, label as keyLabel, keyId, KEYMAP, keyRows, rowKey, parseChord, evalWhen, WB_COMMAND, type Action, type ActionArgs, type Key, type KeyOverrides, type KeyRow, type Platform } from './keys.ts';
import type { DocStatus, DocStatusInput, OpenOpts, OpenSpec, PanelHint, TabDnd, TabHint, ViewContext, ViewType, WorkbenchEvents } from './types.ts';
import type { ViewState, Tab, Group, Layout, Side, SideName } from './model.ts';

export const WorkbenchContext = createContext<Workbench | null>(null);
export const TabContext = createContext<ViewContext | null>(null);
const EMPTY: ViewState = Object.freeze({});
const IDLE: DocStatus = Object.freeze({ typesetting: false, errors: 0, unsaved: false });
/** How long a document that has just become OK shows the success fill (css wb-status-done-fade runs as long). */
export const FLASH_MS = 1500;

/** Save the scroll offsets of `el` and its descendants (a host is moved between groups). Only HTML elements scroll: an
 *  SVG subtree is skipped (a document's typeset blocks are tens of thousands of SVG nodes; reading each one's offsets
 *  froze a tab move for seconds). */
export const SCROLLABLE = ':not(svg):not(svg *)';
function scrolls(el: Element): () => void {
  const out: [Element, number, number][] = [];
  const see = (n: Element) => { if (n.scrollTop || n.scrollLeft) out.push([n, n.scrollTop, n.scrollLeft]); };
  see(el);
  for (const n of el.querySelectorAll(SCROLLABLE)) see(n);
  return () => { for (const [n, t, l] of out) { n.scrollTop = t; n.scrollLeft = l; } };
}
/** Move `el` to the end of `parent`, keeping its state (moveBefore where the browser has it) and its scroll offsets
 *  (keepScroll false: a host about to go, whose offsets nobody will see; their read lays out the whole subtree). */
export function moveInto(parent: Element & { moveBefore?(node: Node, child: Node | null): void }, el: Element, { keepScroll = true } = {}): void {
  if (el.parentNode === parent) return;
  const back = keepScroll && el.isConnected ? scrolls(el) : null;
  const focused = (el.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
  const active = focused && el.contains(focused) ? focused : null;
  if (parent.moveBefore && el.isConnected && parent.isConnected && el.ownerDocument === parent.ownerDocument) {
    try { parent.moveBefore(el, null); } catch { parent.append(el); }
  } else parent.append(el);
  back?.();
  if (active && (el.getRootNode() as Document | ShadowRoot).activeElement !== active && active.isConnected) active.focus({ preventScroll: true });
}

/** createWorkbench's options: a saved layout, the home view type, key overrides, the platform, ids, timings. */
export type WorkbenchOptions = { layout?: string | object | null; home?: string; keymap?: KeyOverrides; platform?: Platform; idPrefix?: string; springDelay?: number; minSize?: number;
  /** A host's own key rows (the editor's commands), matched before the workbench's while their when clause holds. */
  keys?: readonly KeyRow[];
  /** Runs a host's command from a key row (false: it did not apply, the key goes on). */
  commands?: { run(command: string, args: unknown): boolean | void } | null;
};
/** A view's host element (owned here, outside the Preact tree), its context and type. */
export type ViewHost = { el: HTMLDivElement; ctx: ViewContext; type: ViewType | null; view: string; keepAlive: boolean; observed: boolean; panel: string | null };
/** The window bar the UI draws (ui.ts Workbench's bar prop): the host's items. */
export type BarSpec = { left?(): ComponentChildren; right?(): ComponentChildren; label?: string; mark?: { icon?(): ComponentChildren; text?(): ComponentChildren } };
type Focus = { tabId?: string; group?: string; where: 'tab' | 'content' };
/** The container a store is drawn in (ui.ts Workbench attaches it on mount, detaches on unmount): its root (every
 *  DOM lookup of the store goes through it), the park for hosts between groups, whether it has a window bar (the
 *  one-document header is in the bar then), and its section menu and switcher for the keymap (Ctrl+K S, Ctrl+K D). */
export type AttachOptions = { park?: HTMLElement | null; bar?: boolean; tabMenu?: ((kind: 'section' | 'document', tabId: string) => boolean) | null };
type Attached = { root: HTMLElement; park: HTMLElement | null; bar: boolean; tabMenu: AttachOptions['tabMenu'] };

export function createWorkbench({ layout: init = null, home = 'home', keymap = {}, platform = currentPlatform(), idPrefix = 'wb', springDelay = 450, minSize = 120, keys: hostKeys = [], commands = null }: WorkbenchOptions = {}) {
  const P = idPrefix;
  // a saved layout is a disposable preference: one that is not valid now (an old shape, a broken save) is dropped
  // quietly and the workbench starts anew (layoutDropped says so); never a throw at creation
  let start: Layout | null = null, layoutDropped = false;
  if (init) { try { start = M.deserialize(init); } catch { layoutDropped = true; } }
  const L = signal(start ?? M.emptyLayout(`${P}g1`));
  let seq = 0;
  const bumpSeq = () => { seq = Math.max(seq, M.maxId(L.peek(), `${P}t`), M.maxId(L.peek(), `${P}g`), M.maxId(L.peek(), `${P}s`)); };
  bumpSeq();
  const nid = (k: string): string => `${P}${k}${++seq}`;
  const types = signal(new Map<string, ViewType>());
  const left = new Map<string, M.Dock & { index: number }>();     // where each panel unregistered was docked (registerView)
  const inbar = signal(false);     // (with a window bar) the bar group's tabs sit in the bar
  const barGroupId = computed(() => M.barGroup(L.value)?.id ?? null);     // the group spanning the top edge (model.ts barGroup)
  // HOME: every group has its own home toggle, the first item of its strip (not a tab: it never counts in 1/n). Pressed,
  // the home panel shows over that group's content; the group's active tab stays active (both are highlighted). A
  // document opened from the panel replaces the active tab (or, "in a new tab", adds one); either way the panel closes,
  // as it does when the group's active tab changes. The set of groups showing it (UI state, never saved).
  const homeIn = signal(new Set<string>());
  // DOCUMENT STATUS: per document, set by the host (typesetting, failed blocks, unsaved changes);
  // every tab of the document shows it in its pill (its background layer, the unsaved dot)
  const docStatus = signal(new Map<string, DocStatus>());     // docId → { typesetting, errors, unsaved } (idle documents: absent)
  // a document that has just become OK (it was typesetting or had errors): docId → the time it did, for FLASH_MS (the
  // success fill); cleared when the time is up or the document is busy again
  const docFlash = signal(new Map<string, number>());
  const solo = computed(() => !M.isSplit(L.value.root) && L.value.root.tabs.length === 1);
  const closed: { tab: Tab; group: string; index: number }[] = [];
  const listeners = new Map<string, Set<(d: never) => void>>();
  const hosts = new Map<string, ViewHost>();          // tabId → { el, ctx, type, keepAlive }
  const announcement = signal('');
  const dnd = signal<TabDnd | null>(null);         // a tab drag's drop hint (for the UI): { tabId, group, kind: 'strip'|'body', index, side }
  const resizing = signal<{ split: string; groups: Set<string> } | null>(null);    // { split, groups: Set } while a separator is dragged
  const km = bindings(platform, keymap);       // [{ action, arg, chord, text }]
  // the one key table: the host's rows first (their when clauses decide), then the workbench's; matched on the
  // context keys the views and the host set (wb.setContext)
  type Row = KeyRow & { chord: Key[] };
  const rows: Row[] = [...hostKeys.filter((r) => !r.hosts || r.hosts.includes('standalone')), ...keyRows(platform, keymap)].map((r) => ({ ...r, chord: parseChord(rowKey(r, platform)) }));
  const matcher = createMatcher<Row>(rows);
  const contexts = new Map<string, unknown>();
  const setContext = (key: string, value: unknown): void => { if (value === undefined || value === false || value === null) contexts.delete(key); else contexts.set(key, value); };
  const applies = (r: Row) => evalWhen(r.when, (k) => contexts.get(k));
  const chord = signal<string | null>(null);       // the first key of a chord while the second is awaited (shown by a host)
  let pendingFocus: Focus | null = null;          // { tabId?, group?, where: 'tab' | 'content' }
  let ro: ResizeObserver | null = null;
  let park: HTMLElement | null = null;                  // a connected, hidden element for hosts between groups (the container's)
  const attached = signal<Attached | null>(null);
  /** An element of the container (none while no UI is attached: a store without its strip). */
  const find = <E extends Element = HTMLElement>(sel: string): E | null => attached.peek()?.root.querySelector<E>(sel) ?? null;
  /** The focused element where the container is (its document or shadow root). */
  const focusedEl = (): Element | null => ((attached.peek()?.root.getRootNode() ?? (typeof document !== 'undefined' ? document : null)) as Document | ShadowRoot | null)?.activeElement ?? null;

  // a width motion (a side column sliding, a splitter dragged: resizestart .. resizeend) locks every
  // shown tab's host at its width (the last its ResizeObserver saw: no layout read), on a layer of its own: nothing in
  // it lays out or paints again while the groups move (a document re-laid out its whole pane every frame). The lock comes
  // off after resizeend's listeners have run (a view holds what it must first: the editor pins its blocks), so each
  // view lays out once, at its new width. Motions nest (two at once): the last one's end unlocks. The host's left edge
  // stays, or it sits where its view type places it in the group meanwhile (lockedLeft: a document keeps its text centred).
  let locks = 0;
  const locked = new Set<HTMLElement>();
  const lockHosts = (): void => {
    for (const h of hosts.values()) {
      const w = h.ctx.size.peek().w;
      if (h.panel || !h.ctx.visible.peek() || !(w > 0)) continue;
      h.el.style.width = `${w}px`; h.el.style.right = 'auto';
      const left = h.type?.lockedLeft?.(h.ctx, w);
      if (left) h.el.style.left = left;
      h.el.classList.add('wb-panel--locked');
      locked.add(h.el);
    }
  };
  const unlockHosts = (): void => {
    for (const el of locked) { el.style.removeProperty('width'); el.style.removeProperty('right'); el.style.removeProperty('left'); el.classList.remove('wb-panel--locked'); }
    locked.clear();
  };
  const emit = <K extends keyof WorkbenchEvents>(name: K, detail: WorkbenchEvents[K]): void => {
    if (name === 'resizestart' && locks++ === 0) lockHosts();
    for (const f of listeners.get(name) ?? []) (f as (d: WorkbenchEvents[K]) => void)(detail);
    if (name === 'resizeend' && locks > 0 && --locks === 0) unlockHosts();
  };
  const on = <K extends keyof WorkbenchEvents>(name: K, f: (d: WorkbenchEvents[K]) => void): (() => boolean) => {
    let set = listeners.get(name); if (!set) listeners.set(name, set = new Set()); set.add(f as (d: never) => void); return () => set.delete(f as (d: never) => void);
  };
  function set(next: Layout, why = 'change'): boolean {
    const prev = L.peek();
    if (next === prev) return false;
    const errs = M.validate(next);
    if (errs.length) throw new Error(`workbench: ${why} broke the layout: ${errs.join('; ')}`);
    L.value = next;
    // a group whose active tab changed (or that is gone) leaves its home panel
    if (homeIn.peek().size) {
      const now = new Map(M.groups(next).map((g) => [g.id, g.active])), was = new Map(M.groups(prev).map((g) => [g.id, g.active]));
      const keep = [...homeIn.peek()].filter((id) => now.has(id) && now.get(id) === was.get(id));
      if (keep.length !== homeIn.peek().size) homeIn.value = new Set(keep);
    }
    emit('change', { layout: next, prev, why });
    return true;
  }

  // ── view types ──
  function registerView<S extends ViewState>(type: ViewType<S>): () => void {
    const t = type as unknown as ViewType;     // the registry holds every type alike; a type's own functions narrow its state
    if (!t?.id) throw new Error('registerView: an id');
    const m = new Map(types.peek()); m.set(t.id, t); types.value = m;
    // a sidebar panel: docked where it was when its type left (this session: its group, else its side), else on its
    // default side, unless the layout has it somewhere already: into the column's top group, or (below: true) as its own
    // group at the column's bottom
    if (t.panel && !M.sideOf(L.peek(), t.id)) {
      const was = left.get(t.id), l = L.peek();
      const back = was ? M.addPanel(l, t.id, was.side, was.index, was.group) : l;
      const side = was?.side ?? t.panel.side ?? 'left';
      set(back !== l ? back : was ? M.addPanel(l, t.id, side) : t.panel.below ? M.splitPanel(l, t.id, side, null, 'bottom', nid('g'), nid('s')) : M.addPanel(l, t.id, side, t.panel.index ?? null), 'panel');
    }
    // a panel unregistered leaves its column (a host's panel that comes and goes: the editor's Files panel, advanced);
    // where it was is remembered for its return
    return () => {
      const n = new Map(types.peek()); if (n.get(t.id) !== t) return; n.delete(t.id); types.value = n;
      if (!t.panel) return;
      const d = M.dockOf(L.peek(), t.id);
      if (d) left.set(t.id, { ...d, index: M.sideGroups(M.sides(L.peek())[d.side]).find((g) => g.id === d.group)!.panels.indexOf(t.id) });
      removePanel(t.id);
    };
  }
  const viewType = (id: string): ViewType | null => types.value.get(id) ?? null;
  /** A tab's document (the view type's docId(state, tab)), or null: a tab that shows no document has no status. */
  const docOf = (t: Tab): string | null => viewType(t.view)?.docId?.(t.state ?? {}, t) ?? null;
  // typesetting: true, or { done: k, total: n, bar? } (k of n blocks typeset: the progress fill).
  // bar: 'full' (the default: the active tab's progress fills its pill) or 'band' (the thin band on every tab, the
  // active one too: the host's choice, e.g. a re-render of a few blocks); a finished run's success fill keeps its bar
  // The status keeps when the run began (run) and when k last changed (since), for the progress's creep (progress.ts)
  const lastBar = new Map<string, 'full' | 'band'>();     // per document: the bar of its latest run (until its success fill ends)
  const timers = new Set<ReturnType<typeof setTimeout>>();     // the success fills' ends and the UI's tracked timers (cleared by dispose)
  const flashTimers = new Set<ReturnType<typeof setTimeout>>();     // those of them idle does not wait for
  const barOf = (docId: string): 'full' | 'band' => lastBar.get(docId) ?? 'full';
  function setDocStatus(docId: string, s: DocStatusInput = {}): void {
    const v: DocStatus = { typesetting: !!s.typesetting, errors: Math.max(0, Math.floor(Number(s.errors) || 0)), unsaved: !!s.unsaved };
    const was = docStatus.peek().get(docId) ?? IDLE, busy = (x: DocStatus) => x.typesetting || x.errors > 0;
    if (v.typesetting) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now(), p = s.typesetting;
      const done = typeof p === 'object' ? Math.max(0, Math.floor(Number(p.done) || 0)) : 0, total = typeof p === 'object' ? Math.max(1, Math.floor(Number(p.total) || 1)) : 1;
      v.progress = { done, total, bar: typeof p === 'object' && p.bar === 'band' ? 'band' : 'full', run: was.typesetting && was.progress ? was.progress.run : now, since: was.typesetting && was.progress?.done === done ? was.progress.since : now };
    }
    if (v.progress) lastBar.set(docId, v.progress.bar);     // kept after the run (the status itself goes), for its success fill
    if (busy(was) !== busy(v) || docFlash.peek().has(docId)) {
      const f = new Map(docFlash.peek());
      if (busy(was) && !busy(v)) {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        f.set(docId, t0);
        const timer = setTimeout(() => {
          timers.delete(timer); flashTimers.delete(timer);
          if (docFlash.peek().get(docId) !== t0) return;
          const g = new Map(docFlash.peek()); g.delete(docId); docFlash.value = g;
          lastBar.delete(docId);     // its run is over: the bar is a new run's again (one entry per document typesetting, not forever)
          emit('docflashend', { docId });
        }, FLASH_MS);
        timers.add(timer); flashTimers.add(timer);
      } else if (busy(v)) f.delete(docId);
      docFlash.value = f;
    }
    const m = new Map(docStatus.peek());
    if (v.typesetting || v.errors || v.unsaved) m.set(docId, v); else m.delete(docId);
    docStatus.value = m;
  }
  // the progress fill: one ticker for this store's container, running while a document of it typesets
  const ticker = createProgressTicker({ root: () => attached.peek()?.root ?? null, status: (doc) => docStatus.peek().get(doc)?.progress, busy: () => [...docStatus.peek().values()].some((x) => x.typesetting) });
  const unwatch = effect(() => { if ([...docStatus.value.values()].some((x) => x.typesetting)) ticker.start(); });
  const getDocStatus = (docId: string): DocStatus => docStatus.value.get(docId) ?? IDLE;
  /** The keyboard shortcuts (a built-in view type, 'shortcuts'): brought forward where it is open, else a new tab. */
  function openShortcuts(): string {
    const there = M.allTabs(L.peek()).find((x) => x.view === 'shortcuts');
    if (there) { activate(there.id, { focus: 'content' }); flushFocusSoon(); return there.id; }
    return open({ view: 'shortcuts', state: {} }, { focus: true });
  }

  // ── operations (the store's: ids made here, focus, events) ──
  function open(spec: OpenSpec, { group = null, index = null, activate = true, preview = false, focus = false }: OpenOpts = {}): string {
    const id = spec.id ?? nid('t');
    const g = group ?? L.peek().active;
    set(M.openTab(L.peek(), { id, view: spec.view, state: spec.state ?? {} }, { group: g, index, activate, preview }), 'open');
    if (focus) pendingFocus = { tabId: id, where: 'content' };
    emit('open', { tabId: id });
    return id;
  }
  /** A tab's Tab stop: its role=tab element, the first child of the tab's pill (ui.js Tab). */
  const tabStop = (tabId: string) => find(`[data-tab="${CSS.escape(tabId)}"] > [role="tab"]`);
  function focusKind(tabId: string): 'tab' | 'content' | null {
    const a = focusedEl();
    if (!a) return null;
    if (a.closest?.(`[data-tab="${tabId}"]`)) return 'tab';
    if (hosts.get(tabId)?.el.contains(a)) return 'content';
    return null;
  }
  function close(tabId: string): void {
    const before = L.peek(), g = M.groupOf(before, tabId);
    if (!g) return;
    const where = focusKind(tabId);
    const tab = g.tabs.find((t) => t.id === tabId)!;
    closed.push({ tab, group: g.id, index: g.tabs.indexOf(tab) });
    if (closed.length > 20) closed.shift();
    set(M.closeTab(before, tabId), 'close');
    if (where) pendingFocus = { group: L.peek().active, where };
    emit('close', { tabId });
  }
  function closeMany(ids: readonly string[], why: string): void {
    const where = ids.map(focusKind).find(Boolean);
    for (const id of ids) { const g = M.groupOf(L.peek(), id); const t = g?.tabs.find((x) => x.id === id); if (g && t) closed.push({ tab: t, group: g.id, index: g.tabs.indexOf(t) }); }
    while (closed.length > 20) closed.shift();
    const before = L.peek();
    set(M.closeTabs(before, ids), why);
    if (where) pendingFocus = { group: L.peek().active, where };
    for (const id of ids) if (!M.findTab(L.peek(), id)) emit('close', { tabId: id });
  }
  function reopen(): string | null {
    while (closed.length) {
      const c = closed.pop()!;
      if (M.findTab(L.peek(), c.tab.id)) continue;
      const g = M.findGroup(L.peek(), c.group) ? c.group : L.peek().active;
      const tab = { ...c.tab }; delete tab.preview;
      set(M.openTab(L.peek(), tab, { group: g, index: c.index }), 'reopen');
      pendingFocus = { tabId: tab.id, where: 'content' };
      return tab.id;
    }
    return null;
  }
  function activate(tabId: string, { focus = false }: { focus?: boolean | 'tab' | 'content' } = {}): void {
    const tg = M.groupOf(L.peek(), tabId); if (tg && homeIn.peek().has(tg.id)) { const s = new Set(homeIn.peek()); s.delete(tg.id); homeIn.value = s; }     // a press on a tab ends its group's home panel
    set(M.activateTab(L.peek(), tabId), 'activate');
    // the focus is placed after the render, or at once when nothing changes (an arrow key onto the active tab from
    // another tab: every tab is a Tab stop)
    if (focus) { pendingFocus = { tabId, where: focus === 'tab' ? 'tab' : 'content' }; flushFocusSoon(); }
    emit('activate', { tabId });
  }
  function focusGroup(gid: string, { focus = true }: { focus?: boolean } = {}): void {
    const g = M.findGroup(L.peek(), gid);
    if (!g) return;
    set(M.focusGroup(L.peek(), gid), 'focus');
    if (focus) pendingFocus = g.active ? { tabId: g.active, where: 'content' } : { group: gid, where: 'content' };
    flushFocusSoon();
  }
  const move = (tabId: string, group: string, index: number | null) => set(M.moveTab(L.peek(), tabId, group, index), 'move');
  /** A tab dropped where a drag hint says (tab/actions.ts tabHint): into a strip at an index, into a body (its centre:
   *  into that group; an edge: a split moving the tab). Every zone is offered; a drop whose result has the current
   *  layout's shape (model.ts sameShape: ids aside) commits nothing: no new group, no remount, no animation, the scroll
   *  kept. A tab dropped on its own group's centre stays where it is. Either way the tab ends active with the focus in
   *  its content. Returns false for a no-op. */
  function dropTab(tabId: string, h: TabHint | null): boolean {
    const l = L.peek(), from = M.groupOf(l, tabId);
    if (!h || !from) return false;
    let next = l;
    if (h.kind === 'strip') next = M.moveTab(l, tabId, h.group, h.index);
    else if (h.kind === 'body' && h.side) next = M.splitTab(l, tabId, h.group, h.side, '(probe-g)', '(probe-s)', null);
    else if (h.kind === 'body' && h.group !== from.id) next = M.moveTab(l, tabId, h.group, null);
    const done = commitIfChanged(next, () => {
      if (h.kind === 'strip') move(tabId, h.group, h.index);
      else if (h.side) split(tabId, h.side, h.group, { copy: false });
      else move(tabId, h.group, null);
    }, () => {});
    activate(tabId, { focus: 'content' });
    emit('tabdrop', { tabId, noop: !done });
    return done;
  }
  /** A drop (a tab's or a panel's, one rule): `apply` it, unless its result `next` has the current layout's shape (ids
   *  aside: model.ts sameShape), then `noop` (the dropped thing shown again) and nothing committed: no new group, no
   *  remount, no animation, the scroll kept. Every zone is offered; this is where a no-op is decided. */
  function commitIfChanged(next: Layout, apply: () => void, noop: () => void): boolean {
    const l = L.peek();
    if (next === l || M.sameShape(l, next)) { noop(); return false; }
    apply();
    return true;
  }
  /**
   * Split: a copy of the tab in a new group beside `group` (VS Code's Split Editor: the same document twice, two view
   * states), unless the view type says `split: 'move'` or `{ copy: false }` (a drag to an edge moves). Returns the new
   * group's id, or null.
   */
  const split = (tabId: string, side: Side, group: string | undefined = M.groupOf(L.peek(), tabId)?.id, { copy = null }: { copy?: boolean | null } = {}): string | null => {
    if (!group) return null;
    const t = M.findTab(L.peek(), tabId);
    if (!t) return null;
    const doCopy = copy ?? (types.peek().get(t.view)?.split !== 'move');
    const ok = set(M.splitTab(L.peek(), tabId, group, side, nid('g'), nid('s'), doCopy ? nid('t') : null), 'split');
    return ok ? L.peek().active : null;
  };
  /** Move a tab to the neighbouring group on `side`, or split that way if there is none. */
  function moveToward(tabId: string, side: Side): void {
    const g = M.groupOf(L.peek(), tabId);
    if (!g) return;
    const n = M.neighbour(L.peek(), g.id, side);
    const keepFocus = focusKind(tabId);
    if (n) move(tabId, n, null); else split(tabId, side, g.id, { copy: false });
    pendingFocus = { tabId, where: keepFocus ?? 'content' };
  }
  const resize = (splitId: string, sizes: readonly number[]) => set(M.resize(L.peek(), splitId, sizes), 'resize');
  const equalize = (splitId: string) => set(M.equalize(L.peek(), splitId), 'resize');
  const maximize = (gid?: string) => set(M.maximize(L.peek(), gid ?? L.peek().active), 'maximize');
  const restore = () => set(M.restore(L.peek()), 'restore');
  const toggleMaximize = (gid?: string) => set(M.toggleMaximize(L.peek(), gid ?? L.peek().active), 'maximize');
  const pin = (tabId: string, on = true) => set(M.pin(L.peek(), tabId, on), 'pin');
  const keep = (tabId: string) => set(M.keep(L.peek(), tabId), 'keep');
  const closeOthers = (tabId: string) => { const g = M.groupOf(L.peek(), tabId); if (g) closeMany(g.tabs.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id), 'close-others'); activate(tabId); };
  const closeRight = (tabId: string) => { const g = M.groupOf(L.peek(), tabId); if (!g) return; const i = g.tabs.findIndex((t) => t.id === tabId); closeMany(g.tabs.slice(i + 1).filter((t) => !t.pinned).map((t) => t.id), 'close-right'); };
  const setState = (tabId: string, patch: Partial<ViewState> | ((s: ViewState) => ViewState)) => {
    const t = M.findTab(L.peek(), tabId);
    if (!t) return;
    const next = typeof patch === 'function' ? patch(t.state) : { ...t.state, ...patch };
    set(M.setState(L.peek(), tabId, next), 'state');
  };
  const replace = (tabId: string, spec: { view: string; state?: ViewState }) => set(M.replaceTab(L.peek(), tabId, spec), 'replace');
  /** Home in a group (default: the focused one): shown over its content, hidden, or toggled (`on` omitted). An empty
   *  group always shows it. Showing it focuses the group and moves the focus into the panel. */
  const isHome = (gid: string): boolean => { const g = M.findGroup(L.peek(), gid); return !!g && (g.tabs.length === 0 || homeIn.value.has(gid)); };
  function toggleHome(gid: string = L.peek().active, on: boolean | null = null): boolean {
    const g = M.findGroup(L.peek(), gid);
    if (!g || !g.tabs.length) return false;
    const next = on ?? !homeIn.peek().has(gid), s = new Set(homeIn.peek());
    if (next) s.add(gid); else s.delete(gid);
    homeIn.value = s;
    set(M.focusGroup(L.peek(), gid), 'focus');
    requestAnimationFrame(() => (next ? find(`[data-home="${CSS.escape(gid)}"]`) : g.active ? tabStop(g.active) : null)?.focus({ preventScroll: true }));
    emit('home', { group: gid, on: next });
    return next;
  }
  const hideHome = (gid: string) => { if (homeIn.peek().has(gid)) toggleHome(gid, false); };

  // ── rename (a view type with rename(tab, name, ctx)): edited in place, in the tab or the one-document header ──
  const renaming = signal<string | null>(null);
  const canRename = (tabId: string): boolean => { const t = M.findTab(L.peek(), tabId); return !!(t && types.peek().get(t.view)?.rename); };
  const startRename = (tabId: string) => { if (canRename(tabId)) renaming.value = tabId; };
  function finishRename(tabId: string, name: string | null): void {
    if (renaming.peek() !== tabId) return;
    renaming.value = null;
    const t = M.findTab(L.peek(), tabId), type = t && types.peek().get(t.view);
    if (name != null && t && type?.rename) { type.rename(t, name, hosts.get(tabId)?.ctx); emit('rename', { tabId, name }); }
    pendingFocus = { tabId, where: 'tab' }; flushFocusSoon();
  }

  // ── sidebars ──
  const showPanel = (id: string, { focus = false }: { focus?: boolean } = {}) => { set(M.activatePanel(L.peek(), id), 'panel'); if (focus) { pendingFocus = { tabId: `side-${id}`, where: 'content' }; flushFocusSoon(); } };
  /** Into group `group` of `side` (default: its top group) at `index`. */
  const movePanel = (id: string, side: SideName, index: number | null = null, group: string | null = null) => set(M.movePanel(L.peek(), id, side, index, group), 'panel');
  /** Into a new group above or below (`where`) group `group` of `side` (null: the column's top or bottom group). */
  const splitPanel = (id: string, side: SideName, group: string | null, where: 'top' | 'bottom') => set(M.splitPanel(L.peek(), id, side, group, where, nid('g'), nid('s')), 'panel');
  /** A panel dropped where a drag hint says (sides.js panelHint): into a group's strip at an index, or a new group above
   *  or below a group (a group's half, or a closed column's edge zone). As dropTab: every zone is offered, and a drop
   *  whose result has the current layout's shape (ids aside) commits nothing. Returns false for such a no-op. */
  function dropPanel(id: string, h: PanelHint | null): boolean {
    const l = L.peek();
    if (!h || !M.dockOf(l, id)) return false;
    const next = h.index != null ? M.movePanel(l, id, h.side, h.index, h.group) : M.splitPanel(l, id, h.side, h.group, h.where ?? 'bottom', '(probe-g)', '(probe-s)');
    const done = commitIfChanged(next, () => { if (h.index != null) movePanel(id, h.side, h.index, h.group); else splitPanel(id, h.side, h.group, h.where ?? 'bottom'); }, () => showPanel(id));
    emit('paneldrop', { id, noop: !done });
    return done;
  }
  // the side's toggle (the hide button in the column, the show button in the bar) is one control that moves: its
  // place before the change, for the morph (sides.js)
  const collapseSide = (side: SideName, collapsed: boolean) => {
    set(M.collapseSide(L.peek(), side, collapsed), 'panel');
  };
  /** A panel out of its column (a host's panel no longer available: its type gone, or never registered on this load). */
  const removePanel = (id: string) => { if (M.dockOf(L.peek(), id)) set(M.removePanel(L.peek(), id), 'panel'); };
  const resizeSide = (side: SideName, size: number) => set(M.resizeSide(L.peek(), side, size), 'resize');
  /** The column back to its default width (its panels' widest default, else SIDE_SIZE: model.ts sideWidth). */
  const resetSide = (side: SideName) => set(M.resetSide(L.peek(), side), 'resize');
  /** Ctrl+B / Ctrl+Alt+B: open (and focus) or close a side; false when it has no panels. */
  function toggleSide(side: SideName): false | undefined {
    const sd = M.sides(L.peek())[side];
    if (!sd || !M.sidePanels(sd).length) return false;
    const opening = sd.collapsed;
    // the toggle moves (into the column when it opens, to the bar when it closes): a focused toggle keeps the focus
    const onToggle = !!focusedEl()?.closest?.(`[data-toggle="${side}"]`);
    collapseSide(side, !opening);
    if (onToggle) { requestAnimationFrame(() => find(`[data-toggle="${side}"]`)?.focus({ preventScroll: true })); return; }
    if (opening) pendingFocus = { tabId: `side-${M.sideGroups(sd)[0]!.active}`, where: 'content' };
    else if (focusedEl()?.closest?.(`[data-side="${side}"]`)) pendingFocus = { group: L.peek().active, where: 'content' };
  }
  /** F6 / Shift+F6: the left side, the groups in order, the right side (the open ones). */
  function focusPart(dir: number): void {
    const l = L.peek(), S = M.sides(l);
    const parts: ({ side: SideName; group?: undefined } | { group: string; side?: undefined })[] = [];
    if (M.sidePanels(S.left).length && !S.left.collapsed) parts.push({ side: 'left' });
    for (const g of M.groups(l)) parts.push({ group: g.id });
    if (M.sidePanels(S.right).length && !S.right.collapsed) parts.push({ side: 'right' });
    const a = focusedEl();
    let i = parts.findIndex((p) => (p.side ? a?.closest?.(`[data-side="${p.side}"]`) : a?.closest?.(`[data-group="${p.group}"]`)));
    if (i < 0) i = parts.findIndex((p) => p.group === l.active);
    const p = parts[(i + dir + parts.length) % parts.length]!;
    if (p.group) focusGroup(p.group);
    else if (p.side) { pendingFocus = { tabId: `side-${M.sideGroups(S[p.side])[0]!.active}`, where: 'content' }; flushFocusSoon(); }
  }

  const current = computed((): { group: Group; tab: Tab | null } => { const l = L.value; const g = M.activeGroup(l); return { group: g, tab: g.tabs.find((t) => t.id === g.active) ?? null }; });

  // ── persistence ──
  const serialize = () => M.serialize(L.peek());
  // the first frames after a mount or a restore: everything placed in its final state, nothing animated (no
  // transitions: .wb-booting; no FLIP: the moves check wb.booting); two frames, then the user's changes animate
  let booting = true, bootId = 0;
  function boot(): void {
    booting = true;
    const root = attached.peek()?.root;
    root?.classList.add('wb-booting');
    const id = ++bootId;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (bootId !== id) return; booting = false; root?.classList.remove('wb-booting'); }));
  }
  /** The UI attaches its container (ui.ts Workbench, on mount; again when its options change): the first time for a
   *  root, the layout is placed as it is (boot). Returns the detach. */
  function attach(root: HTMLElement, { park: p = null, bar = false, tabMenu = null }: AttachOptions = {}): () => void {
    const first = attached.peek()?.root !== root;
    attached.value = { root, park: p, bar, tabMenu };
    park = p;
    if (first) boot();
    return () => detach(root);
  }
  function detach(root?: HTMLElement): void {
    if (root && attached.peek()?.root !== root) return;
    attached.value = null; park = null;
  }
  // ── idle: the tests (and a host) wait on state, never on time ──
  /** A timer the UI starts for a reason a test must wait out (the name's switcher, NAME_WAIT): tracked, so wb.idle()
   *  waits for it; cancelled by the returned function and by dispose. */
  const later = (ms: number, f: () => void): (() => void) => {
    const t = setTimeout(() => { timers.delete(t); f(); }, ms);
    timers.add(t);
    return () => { clearTimeout(t); timers.delete(t); };
  };
  /** Resolves once the workbench is at rest: no pending focus, not booting, no tracked timer, and no finite animation
   *  running on the page (the tabs' FLIPs, the slides, the overlays' fades), for two frames in a row. Not the success
   *  fill's own timer: idle waits for its fade (an animation), not for its end event. */
  async function idle(): Promise<void> {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    let quiet = 0;
    while (quiet < 2 && !disposed) {
      await frame();
      // (an animation in a subtree not rendered, a hidden panel's content-visibility, never advances: not waited for)
      const shown = (a: Animation) => { const t = (a.effect as KeyframeEffect | null)?.target; return !t || !(t as Element).checkVisibility || (t as Element).checkVisibility(); };
      const anims = typeof document !== 'undefined' ? document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity && shown(a)) : [];
      const waiting = [...timers].length > flashTimers.size;
      if (anims.length) { quiet = 0; await Promise.all(anims.map((a) => a.finished.catch(() => {}))); }
      else if (pendingFocus || focusQueued || booting || waiting) quiet = 0;
      else quiet++;
    }
  }
  /** Release everything the store holds: the views' hosts and their Preact roots, the size observer, a pending
   *  chord's listener, the timers, the ticker and its watch, the listeners, the container. The layout stays readable
   *  (serialize); the store is not used after. A host that drops a workbench calls it (a test, a webview, hot reload). */
  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const id of [...hosts.keys()]) disposeHost(id);
    ro?.disconnect(); ro = null;
    if (typeof removeEventListener === 'function') removeEventListener('keydown', pendingKey, true);
    matcher.reset(); chord.value = null; pendingFocus = null;
    for (const t of timers) clearTimeout(t);
    timers.clear(); flashTimers.clear();
    ticker.stop(); unwatch();
    detach();
    listeners.clear();
  }
  function load(json: string | object): void {
    boot();
    const next = M.deserialize(json);
    batch(() => { set(next, 'load'); });
    bumpSeq();
    closed.length = 0;
  }

  // ── the view context: ONE shape for a tab, a side panel and the home panel; what a
  //    container cannot do is a capability (ctx.can), not a member of another shape ──
  const NO = signal<null>(null), NEVER = signal(false);
  type ContextSpec = {
    kind: ViewContext['kind']; viewId: string; tab: ViewContext['tab']; groupId?: ViewContext['groupId']; side?: ViewContext['side'];
    solo?: ViewContext['solo']; visible?: boolean;
    setState(patch: Parameters<ViewContext['setState']>[0]): void; open: ViewContext['open'];
    keep?(): void; replace?(spec: OpenSpec): void; close?(): void;
    /** The tab a content drag starts from or drops into (drag.ts): the view's id, or none. */
    dragKey: string | null;
  };
  function makeViewContext(s: ContextSpec): ViewContext {
    return {
      viewId: s.viewId, kind: s.kind, wb: api, tab: s.tab, state: computed(() => s.tab.value?.state ?? EMPTY),
      groupId: s.groupId ?? NO, side: s.side ?? NO, solo: s.solo ?? NEVER,
      visible: signal(s.visible ?? false), resizing: signal(false), size: signal({ w: 0, h: 0 }),
      can: { keep: !!s.keep, replace: !!s.replace, close: !!s.close, openBeside: true },
      setState: s.setState, open: s.open,
      keep: () => s.keep?.(), replace: (spec) => s.replace?.(spec), close: () => s.close?.(),
      announce: (text) => { announcement.value = text; },
      dropTarget: (el, handlers) => drag.dropTarget(el, handlers, s.dragKey),
      startDrag: (e, spec) => drag.start(e, spec, s.dragKey),
    };
  }
  /** A tab's context: its state in the layout; it opens beside itself in its group, replaces itself, closes. */
  function makeCtx(tabId: string): ViewContext {
    const groupId = computed(() => M.groupOf(L.value, tabId)?.id ?? null);
    return makeViewContext({ kind: 'tab', viewId: tabId, tab: computed(() => M.findTab(L.value, tabId)), groupId, solo, dragKey: tabId,
      setState: (patch) => setState(tabId, patch),
      open: (spec, opts) => { open(spec, { group: groupId.peek(), ...opts }); },
      keep: () => { keep(tabId); }, replace: (spec) => { replace(tabId, spec); }, close: () => close(tabId) });
  }
  /** The context of a tab that has no host now (not mounted): its type's crumbs and section read it (ui.ts). Made once
   *  per tab; dropped with the tab. */
  const spare = new Map<string, ViewContext>();
  function contextOf(tabId: string): ViewContext {
    const h = hosts.get(tabId);
    if (h) return h.ctx;
    let c = spare.get(tabId);
    if (!c) spare.set(tabId, c = makeCtx(tabId));
    return c;
  }
  /** The home panel's context (ui.ts HomeBody): over a group's active tab (`over`), a document opened there replaces that
   *  tab (`beside` or a preview: a new tab) and the panel closes; in an empty group (only the root), it opens there. Its
   *  state is its own (not saved). */
  function homeContext(gid: string, over: string | null): ViewContext {
    const homeState = signal<ViewState>(EMPTY);
    const tab = computed((): Tab => ({ id: `home:${gid}`, view: home, state: homeState.value }));
    const setHomeState = (patch: Parameters<ViewContext['setState']>[0]) => { homeState.value = typeof patch === 'function' ? patch(homeState.peek()) : { ...homeState.peek(), ...patch }; };
    const groupId = signal(gid);
    if (over) {
      const instead = (spec: OpenSpec) => { hideHome(gid); replace(over, spec); activate(over, { focus: 'content' }); flushFocusSoon(); };
      return makeViewContext({ kind: 'home', viewId: `home:${gid}`, tab, groupId, visible: true, dragKey: null, setState: setHomeState,
        open: (spec, o) => { if (o?.beside || o?.preview) { hideHome(gid); const { beside: _b, ...rest } = o; open(spec, { group: gid, focus: true, ...rest }); return; } instead(spec); },     // a preview is its own tab
        replace: instead, close: () => hideHome(gid) });
    }
    return makeViewContext({ kind: 'home', viewId: `home:${gid}`, tab, groupId, visible: true, dragKey: null, setState: setHomeState,
      open: (spec, o) => { const { beside: _b, ...rest } = o ?? {}; open(spec, { group: gid, focus: true, ...rest }); },
      replace: (spec) => { open(spec, { group: gid, focus: true }); } });
  }
  function TabContent({ ctx, type }: { ctx: ViewContext; type: ViewType | null }) {
    return html`<${WorkbenchContext.Provider} value=${api}><${TabContext.Provider} value=${ctx}><${Panel} ctx=${ctx} type=${type} /><//><//>`;
  }
  function Panel({ ctx, type }: { ctx: ViewContext; type: ViewType | null }) {
    const tab = ctx.tab.value;
    if (!tab) return null;
    if (!type) return html`<div class="wb-view"><div class="wb-missing">This view is not available (${tab.view}).</div></div>`;
    const alone = ctx.solo.value;
    const crumbs = type.crumbs ? type.crumbs(tab, ctx) : null;
    // the row: only when alone (no tab: the header names the document); beside tabs, the tab names it
    // (with a window bar, the one-document header is in the bar: no row here)
    const row = crumbs?.length && alone && !attached.value?.bar;
    // alone, there is no strip: the header row carries the show buttons of hidden sidebars
    return html`${row ? html`<${Crumbs} items=${crumbs} before=${alone ? html`<${SideToggle} wb=${api} side="left" />` : null} after=${alone ? html`<${SideToggle} wb=${api} side="right" />` : null} />` : null}
      <div class="wb-view" data-view=${type.id}><${type.Component} tab=${tab} ctx=${ctx} /></div>`;
  }
  /** A side panel's context: its state lives in the layout's panelState; it opens in the focused group; closing it hides
   *  its column; it is no tab (nothing to keep or replace). */
  function makePanelCtx(viewId: string, key: string): ViewContext {
    let last: Tab | null = null, lastState: ViewState | undefined;
    const tab = computed((): Tab => {
      const st = L.value.panelState?.[viewId] ?? EMPTY;
      if (!last || st !== lastState) { last = { id: key, view: viewId, state: st }; lastState = st; }
      return last;
    });
    const side = computed(() => M.sideOf(L.value, viewId));
    return makeViewContext({ kind: 'panel', viewId: key, tab, side, dragKey: key,
      setState: (patch) => { const cur = L.peek().panelState?.[viewId] ?? {}; set(M.setPanelState(L.peek(), viewId, typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }), 'state'); },
      open: (spec, opts) => { const { beside: _b, ...rest } = opts ?? {}; open(spec, rest); },
      close: () => { const s = side.peek(); if (s) collapseSide(s, true); } });
  }
  function createHost(tab: Tab, ctxIn: ViewContext | null = null): ViewHost {
    const type = types.peek().get(tab.view) ?? null;
    const el = document.createElement('div');
    el.className = 'wb-panel wb-panel--hidden';
    el.id = `${tab.id}-panel`;
    el.setAttribute('role', 'tabpanel');
    el.setAttribute('aria-labelledby', `${tab.id}-tab`);
    el.tabIndex = -1;
    el.inert = true;
    el.dataset.panel = tab.id;
    const ctx = ctxIn ?? spare.get(tab.id) ?? makeCtx(tab.id);
    spare.delete(tab.id);
    const h: ViewHost = { el, ctx, type, view: tab.view, keepAlive: !!type?.keepAlive || !!ctxIn, observed: false, panel: ctxIn ? tab.view : null };
    hosts.set(tab.id, h);
    render(html`<${TabContent} ctx=${ctx} type=${type} />`, el);
    emit('mount', { tabId: tab.id });
    return h;
  }
  function disposeHost(id: string): void {
    const h = hosts.get(id);
    if (!h) return;
    if (h.observed) ro?.unobserve(h.el);
    render(null, h.el);
    h.el.remove();
    hosts.delete(id);
    emit('unmount', { tabId: id });
  }
  function observe(h: ViewHost, on: boolean): void {
    if (!ro) ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const h2 = hosts.get((en.target as HTMLElement).dataset.panel ?? '');
        if (!h2?.ctx.visible.peek()) continue;
        const r = en.contentRect;
        const s = h2.ctx.size.peek();
        if (Math.round(r.width) !== s.w || Math.round(r.height) !== s.h) h2.ctx.size.value = { w: Math.round(r.width), h: Math.round(r.height) };
      }
    });
    if (on && !h.observed) { ro.observe(h.el); h.observed = true; }
    if (!on && h.observed) { ro.unobserve(h.el); h.observed = false; }
  }
  /** A host shown or hidden (one place): hidden it is kept (content-visibility: hidden), inert, not measured. */
  function showHost(h: ViewHost, vis: boolean): void {
    if (h.ctx.visible.peek() === vis) return;
    h.el.classList.toggle('wb-panel--hidden', !vis);
    h.el.inert = !vis;
    h.ctx.visible.value = vis;
    observe(h, vis);
  }
  /** A group's body: adopt its tabs' hosts; mount the active tab; hide (keep alive) or unmount the others. */
  function syncPanels(g: Group, container: HTMLElement, shown: boolean, solo = false): void {
    for (const tab of g.tabs) {
      const active = tab.id === g.active;
      let h = hosts.get(tab.id);
      if (h && h.view !== tab.view) { disposeHost(tab.id); h = undefined; }    // replaced in place (home → document)
      if (!h && active) h = createHost(tab);
      if (!h) continue;
      if (!active && !h.keepAlive) { disposeHost(tab.id); continue; }
      moveInto(container, h.el);
      // (integrated) one tab and no strip: the panel is a labelled region, not a tabpanel of a hidden tablist
      if (solo && active) { h.el.setAttribute('role', 'region'); h.el.removeAttribute('aria-labelledby'); h.el.setAttribute('aria-label', titleOf(tab)); }
      else if (h.el.getAttribute('role') !== 'tabpanel') { h.el.setAttribute('role', 'tabpanel'); h.el.setAttribute('aria-labelledby', `${tab.id}-tab`); h.el.removeAttribute('aria-label'); }
      showHost(h, active && shown);
    }
  }
  function titleOf(tab: Tab): string { const t = types.peek().get(tab.view); return (t?.title?.(tab.state ?? {}, tab) ?? t?.label ?? tab.view) || tab.view; }
  /** A group unmounts: its hosts wait in the park until their new group adopts them (no detach: no state loss). */
  function parkPanels(container: HTMLElement): void {
    if (!park) return;
    const l = L.peek();
    for (const el of [...container.children] as HTMLElement[]) if (el.dataset.panel) {
      const h = hosts.get(el.dataset.panel);
      // a closed tab's host goes after this render (afterRender): parked without saving its scroll offsets,
      // whose read laid out its whole subtree (a pane: 4,876 elements, 60 ms in the split's close)
      const gone = !h || (h.panel ? !M.sideOf(l, h.panel) : !M.findTab(l, el.dataset.panel));
      moveInto(park, el, { keepScroll: !gone });
      if (h) showHost(h, false);
    }
  }
  /** A sidebar's body: its panels' hosts (kept alive once shown); the active one visible while the side is open. */
  function syncSide(side: SideName, gid: string, container: HTMLElement): void {
    const sd = M.sides(L.peek())[side], pg = M.sideGroups(sd).find((x) => x.id === gid);
    for (const id of pg?.panels ?? []) {
      const key = `side-${id}`, active = id === pg!.active;
      let h = hosts.get(key);
      if (!h && active && !sd.collapsed) h = createHost({ id: key, view: id, state: {} }, makePanelCtx(id, key));
      if (!h) continue;
      moveInto(container, h.el);
      showHost(h, active && !sd.collapsed);
    }
  }
  /** After a render: hosts of closed tabs go; a pending focus is placed. */
  function afterRender(): void {
    const l = L.peek();
    for (const [id, h] of [...hosts]) if (h.panel ? !M.sideOf(l, h.panel) : !M.findTab(l, id)) disposeHost(id);
    for (const id of [...spare.keys()]) if (hosts.has(id) || !M.findTab(l, id)) spare.delete(id);
    flushFocus();
  }
  function flushFocus(): void {
    const f = pendingFocus;
    if (!f) return;
    if (f.tabId?.startsWith('side-')) {           // a sidebar panel
      const h = hosts.get(f.tabId);
      if (!h || !h.ctx.visible.peek()) return;     // not rendered yet: afterRender places it
      pendingFocus = null;
      if (h.type?.focus) h.type.focus(h.ctx); else h.el.focus({ preventScroll: true });
      return;
    }
    const l = L.peek();
    const g = f.tabId ? M.groupOf(l, f.tabId) : M.findGroup(l, f.group ?? null);
    if (!g) { pendingFocus = null; return; }
    const tabId = f.tabId ?? g.active;
    if (tabId && f.where !== 'tab' && !hosts.has(tabId)) return;     // not rendered yet: afterRender places it
    pendingFocus = null;
    if (f.where === 'tab' && tabId) { tabStop(tabId)?.focus({ preventScroll: true }); return; }
    const h = tabId ? hosts.get(tabId) : null;
    if (h) {
      if (h.type?.focus) h.type.focus(h.ctx); else h.el.focus({ preventScroll: true });
      return;
    }
    const body = find(`[data-group="${CSS.escape(g.id)}"] .wb-home`);
    (body?.querySelector<HTMLElement>('button, [href], input, [tabindex="0"]') ?? body)?.focus?.({ preventScroll: true });
  }
  let focusQueued = false;
  function flushFocusSoon(): void {
    if (focusQueued) return;
    focusQueued = true;
    // after the render Preact has queued (a microtask), and once more at the next frame
    Promise.resolve().then(() => Promise.resolve()).then(() => { focusQueued = false; flushFocus(); if (pendingFocus) requestAnimationFrame(flushFocus); });
  }

  // ── keyboard (chords: the first key arms, the next key decides; Escape or any other key cancels) ──
  let cycle: { group: string; order: string[]; i: number } | null = null;   // { group, order, i } while Ctrl is held (cycleMru, for a host that can bind Ctrl+Tab)
  // A chord's second key is the keymap's, wherever the focus is: while a chord is pending, one capture listener on the
  // window takes the next keys first (before any component's own keys: a tab's, a splitter's arrows, a menu's), runs
  // or cancels the chord, and swallows the key either way; it goes when the chord ends
  function pendingKey(e: KeyboardEvent): void {
    if (matcher.pending == null) { removeEventListener('keydown', pendingKey, true); return; }
    if (e.isComposing) return;
    handleKey(e, true);
    e.preventDefault(); e.stopPropagation();
    if (matcher.pending == null) { removeEventListener('keydown', pendingKey, true); chord.value = null; }
  }
  function handleKey(e: KeyboardEvent, mine = false): boolean {
    if (!mine && matcher.pending != null) return false;     // the pending chord's listener has it (pendingKey)
    if (e.defaultPrevented || e.isComposing) return false;
    const hit = matcher.feed(e, applies);
    if (hit === null) return false;
    if (hit === 'pending' || hit === 'cancelled') {
      e.preventDefault(); e.stopPropagation();
      if (hit === 'pending' && typeof addEventListener === 'function') addEventListener('keydown', pendingKey, true);
      chord.value = hit === 'pending' ? keyLabel(rowKey(rows.find((b) => b.chord.length === 2 && keyId(b.chord[0]!) === matcher.pending) ?? { key: '', command: '' }, platform).split(' ')[0] ?? '', platform) : null;
      if (hit === 'pending') announcement.value = `${chord.value} was pressed. Waiting for the second key.`;
      return true;
    }
    chord.value = null;
    if (hit.command.startsWith(WB_COMMAND)) { if (run(hit.command.slice(WB_COMMAND.length) as Action, hit.args as never) === false) return false; }
    else if (!commands || commands.run(hit.command, hit.args) === false) return false;
    e.preventDefault(); e.stopPropagation();
    flushFocusSoon();
    return true;
  }
  /** Run a keymap action (also for a host's own menus and commands). false: it did not apply. */
  function run<A extends Action>(action: A, arg?: ActionArgs[A]): false | undefined {
    const l = L.peek(), g = M.activeGroup(l), t = g.active;
    const after = (tabId: string | null) => { if (tabId) pendingFocus = { tabId, where: focusWhere() }; };
    switch (action) {
      case 'focusGroup': { const to = M.groups(l)[arg as number]; if (!to) return false; focusGroup(to.id); return; }
      case 'focusSide': { const n = M.neighbour(l, g.id, arg as Side); if (!n) return false; focusGroup(n); return; }
      case 'nextTab': case 'prevTab':
        if (g.tabs.length < 2) return false; set(M.cycleTab(l, action === 'nextTab' ? 1 : -1), 'activate'); after(M.activeGroup(L.peek()).active); return;
      case 'cycleMru': return cycleMru(1);
      case 'shiftLeft': case 'shiftRight': if (!t) return false; set(M.shiftTab(l, t, action === 'shiftRight' ? 1 : -1), 'move'); after(t); return;
      case 'moveToward': if (!t) return false; moveToward(t, arg as Side); return;
      case 'splitRight': case 'splitDown': { if (!t) return false; const id = split(t, action === 'splitRight' ? 'right' : 'bottom', g.id); if (!id) return false; pendingFocus = { tabId: M.activeGroup(L.peek()).active ?? undefined, where: 'content' }; return; }
      case 'close': if (!t) return false; close(t); return;
      case 'closeGroup': if (!g.tabs.length) return false; closeMany(g.tabs.filter((x) => !x.pinned).map((x) => x.id), 'close-group'); return;
      case 'closeOthers': if (!t) return false; closeOthers(t); return;
      case 'reopen': return reopen() ? undefined : false;
      case 'home': if (!g.tabs.length) return false; toggleHome(g.id); return;
      case 'sectionMenu': case 'docSwitcher': { const menu = attached.peek()?.tabMenu; if (!t || !menu) return false; return menu(action === 'sectionMenu' ? 'section' : 'document', t) ? undefined : false; }
      case 'shortcuts': openShortcuts(); return;
      case 'maximize': if (M.groups(l).length < 2) return false; toggleMaximize(); return;
      case 'pin': { if (!t) return false; pin(t, !M.findTab(l, t)?.pinned); return; }
      case 'keep': if (!t) return false; keep(t); return;
      case 'toggleSide': return toggleSide(arg as SideName);
      case 'focusPart': focusPart(arg as number); return;
      default: return false;
    }
  }
  const focusWhere = (): 'tab' | 'content' => (focusedEl()?.closest?.('[data-tab]') ? 'tab' : 'content');
  function cycleMru(dir: number): false | undefined {
    const l = L.peek(), g = M.activeGroup(l);
    if (g.tabs.length < 2) return false;
    if (!cycle || cycle.group !== g.id) cycle = { group: g.id, order: [...g.mru].reverse(), i: 0 };   // most recent first
    cycle.i = (cycle.i + dir + cycle.order.length) % cycle.order.length;
    const id = cycle.order[cycle.i]!;
    set(M.activateTab(l, id), 'activate');
    pendingFocus = { tabId: id, where: focusWhere() };
  }
  function keyup(e: KeyboardEvent): void {
    if (cycle && e.key === 'Control') {
      const c = cycle; cycle = null;
      const target = c.order[c.i]!;
      const mru = [...c.order].reverse().filter((x) => x !== target);
      const g = M.findGroup(L.peek(), c.group);
      if (g && mru.length + 1 === g.mru.length) set(M.setMru(L.peek(), c.group, [...mru, target]), 'activate');
    }
  }
  /** The keys of a command on this platform, as people read them (menus, tooltips, a shortcuts list): a workbench
   *  action (`close`, `toggleSide` with its side) or a host's command from its key rows, the first row of the key table
   *  that runs it (with `args`, those args). */
  function shortcut<A extends Action>(action: A, arg?: ActionArgs[A]): string | null;
  function shortcut(command: string, args?: unknown): string | null;
  function shortcut(command: string, args?: unknown): string | null {
    const r = rows.find((x) => (x.command === command || x.command === `${WB_COMMAND}${command}`) && (args == null || x.args === args));
    return r ? keyLabel(rowKey(r, platform), platform) : null;
  }

  const drag = createContentDrag({
    panelOf: (el) => { const p = el.closest?.<HTMLElement>('.wb-panel'); if (!p) return null; const id = p.dataset.panel ?? '', h = hosts.get(id); return { el: p, tabId: id, visible: !!h?.ctx.visible.peek() }; },
    tabAt: (el) => { const t = el.closest?.<HTMLElement>('[data-tab]'); return t ? { el: t, tabId: t.dataset.tab ?? '', active: t.classList.contains('wb-tab--on') } : null; },
    activate: (tabId) => activate(tabId),
    announce: (s) => { announcement.value = s; },
    emit, springDelay: () => springDelay,
  });

  const api = {
    get booting() { return booting; }, get disposed() { return disposed; }, attach, detach, dispose, idle, later, root: () => attached.peek()?.root ?? null, hasBar: () => !!attached.value?.bar, layoutDropped, layout: L, types, current, solo, inbar, barGroupId, homeIn, isHome, toggleHome, hideHome, registerView, viewType, home, minSize, keymapOverrides: keymap, keymap: km, keyRows: rows as readonly KeyRow[], setContext, context: (key: string) => contexts.get(key), platform, chord, shortcut, run, KEYMAP,
    open, close, closeMany, reopen, activate, focusGroup, move, split, moveToward, resize, equalize, maximize, restore, toggleMaximize,
    pin, keep, closeOthers, closeRight, setState, replace, dropTab, serialize, load, on, emit, handleKey, keyup,
    docStatus, setDocStatus, getDocStatus, barOf, docOf, docFlash,
    barMark: signal({ icon: true, text: true }),     // (with a window bar) which parts of the host's mark are in it (ui.ts barItems)
    renaming, canRename, rename: startRename, finishRename,
    showPanel, movePanel, splitPanel, dropPanel, removePanel, collapseSide, resizeSide, resetSide, toggleSide, focusPart, sides: computed(() => M.sides(L.value)),
    drag, hosts, announcement, dnd, pdnd: signal<PanelHint | { id: string } | null>(null), resizing, nid,
    get closedCount() { return closed.length; },
    // the container's side (ui.ts): the hosts placed into a group's body or a column, parked between groups; after a
    // render the closed tabs' hosts go and a pending focus is placed
    syncPanels, syncSide, parkPanels, afterRender, flushFocus, flushFocusSoon, ticker, contextOf, homeContext,
    announce: (t: string) => { announcement.value = t; },
  };
  registerView({ id: 'shortcuts', title: () => 'Keyboard shortcuts', icon: 'keyboard', Component: ShortcutsView });     // the keymap, generated
  return api;
}
/** The store: the layout, the views, the hosts, the keys, the status (createWorkbench). */
export type Workbench = ReturnType<typeof createWorkbench>;
