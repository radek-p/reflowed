// THE EDITOR'S CONTAINER: what an editor mounted into an element
// knows of its surroundings. Every lookup an editor module makes goes through it: its parts (the top bar, the find
// bar's host, the first pane's <main>, the sidebar …) are found inside the container, never by a page id; its
// state (focus mode, the sidebar closed, a block being edited or dragged, find open …) is data attributes on the
// container, never body classes; the listeners it adds to the document or the window are owned and removed by
// dispose(). Two editors on one page each have their own.
//
//   const root = createEditorRoot(el, { windowScroll, ids, inset })
//     el            the container (the standalone page's .rtx-editor; a plain div for an embedded editor)
//     windowScroll  the first pane, alone, scrolls the window (the standalone page) rather than itself
//     ids           the standalone page keeps its element ids (tests and app.css's old hooks): root.id(name) is the
//                   name itself; an embedded editor's ids get a prefix of their own, so two editors never share one
//     inset()       where a window-scrolled pane's text starts (the top bar's bottom); default: measured
//   root.part(name) · root.$(sel) · root.$$(sel)    lookups inside the container
//   root.flag(name, on?) · root.has(name)            container state: data-<name> on root.el
//   root.hold(name, owner, on)                       the same, held by several owners (two documents' editors in one
//                                                    container: data-editing while either edits)
//   root.listen(target, type, fn, opts) -> off       an owned listener (document, window or an element)
//   root.onScroll(fn) -> off                         a scroll anywhere in it (and the window's, when it scrolls it)
//   root.takesKey(e)                                 a page key event is this editor's (see below)
//   root.claim(key, owner) -> true when new          the container's shared chrome (the find bar, the panels' lists)
//                                                    is drawn by one document editor at a time: the last to claim it
//   root.id(name)                                    an element id, unique on the page
//   root.state                                       the container's signals (app/page-state.ts: the current document,
//                                                    results shown, refreshes, width changes, section focus …)
//   root.onDispose(fn) · root.dispose()              everything owned goes; nothing stays on the page
//
// Keys: an editor's page keys are dispatched from one document listener (keys pressed with the focus on <body>
// must reach it). takesKey(e) says whose they are: the editor whose container holds the event's target, else the
// editor last pressed or focused in (the only one, on the standalone page). That module-level "last" is the page's
// one fact about its editors, like document.activeElement.

import { createEditorState, type EditorState } from './page-state.ts';

export type Part = 'shell' | 'sidebar' | 'sb-top' | 'sb-tabs' | 'word-count' | 'view' | 'topbar' | 'find' | 'page' | 'doc-view-host' | 'add-end';
export type Flag = 'focus-mode' | 'sidebar-closed' | 'editing' | 'dragging' | 'finding' | 'embedded';

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type Listener = (e: Event) => void;

export interface EditorRoot {
  readonly el: HTMLElement;
  readonly doc: Document;
  readonly windowScroll: boolean;
  readonly disposed: boolean;
  readonly state: EditorState;
  part(name: Part): HTMLElement | null;
  $<E extends Element = HTMLElement>(sel: string): E | null;
  $$<E extends Element = HTMLElement>(sel: string): E[];
  flag(name: Flag, on?: boolean): boolean;
  has(name: Flag): boolean;
  hold(name: Flag, owner: object, on: boolean): void;
  listen<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): () => void;
  listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): () => void;
  listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): () => void;
  listen(target: Target, type: string, fn: Listener, opts?: boolean | AddEventListenerOptions): () => void;
  onScroll(fn: (e: Event) => void): () => void;
  takesKey(e: Event): boolean;
  claim(key: string, owner: object): boolean;
  owner(key: string): object | null;
  id(name: string): string;
  inset(): number;
  onDispose(fn: () => void): void;
  dispose(): void;
}

export interface RootOptions {
  windowScroll?: boolean;
  ids?: boolean;
  inset?: () => number;
}

const roots = new Set<EditorRoot>();
let last: EditorRoot | null = null;          // the editor last pressed or focused in (see takesKey)
let seq = 0;

/** the editor whose container holds `node`, if any */
export function rootOf(node: Node | null): EditorRoot | null {
  for (const r of roots) if (node && r.el.contains(node)) return r;
  return null;
}
/** the editors mounted now (tests: two editors, one gone) */
export const editorRoots = (): EditorRoot[] => [...roots];
/** the editor last pressed or focused in, else the only one: whose are the keys and commands from outside every editor */
export const activeRoot = (): EditorRoot | null => last ?? (roots.size === 1 ? roots.values().next().value ?? null : null);

export function createEditorRoot(el: HTMLElement, o: RootOptions = {}): EditorRoot {
  const doc = el.ownerDocument;
  const owned: (() => void)[] = [];
  const claims = new Map<string, object>();
  const holders = new Map<Flag, Set<object>>();
  const prefix = o.ids ? '' : `rtx${++seq}-`;
  let disposed = false;
  el.classList.add('rtx-editor');

  function listen(target: Target, type: string, fn: Listener, opts?: boolean | AddEventListenerOptions): () => void {
    target.addEventListener(type, fn, opts);
    let on = true;
    const off = () => { if (!on) return; on = false; target.removeEventListener(type, fn, opts); const k = owned.indexOf(off); if (k >= 0) owned.splice(k, 1); };
    owned.push(off);
    return off;
  }
  const part = (name: Part): HTMLElement | null => (el.dataset.part === name ? el : el.querySelector<HTMLElement>(`[data-part="${name}"]`));
  const topInset = () => {
    const bar = part('topbar');
    return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  };

  const root: EditorRoot = {
    el, doc,
    windowScroll: !!o.windowScroll,
    state: createEditorState(),
    get disposed() { return disposed; },
    part,
    $: <E extends Element = HTMLElement>(sel: string) => el.querySelector<E>(sel),
    $$: <E extends Element = HTMLElement>(sel: string) => [...el.querySelectorAll<E>(sel)],
    flag(name, on = !root.has(name)) {
      if (on) el.setAttribute(`data-${name}`, ''); else el.removeAttribute(`data-${name}`);
      return on;
    },
    has: (name) => el.hasAttribute(`data-${name}`),
    hold(name, owner, on) {
      let s = holders.get(name);
      if (!s) { s = new Set(); holders.set(name, s); }
      if (on) s.add(owner); else s.delete(owner);
      root.flag(name, s.size > 0);
    },
    listen,
    onScroll(fn) {
      // scroll events do not bubble: a capture listener on the container hears its scrollers; the window's own
      // scroll is the document's (the standalone page's single pane)
      const offs = [listen(el, 'scroll', fn, { capture: true, passive: true })];
      if (root.windowScroll) offs.push(listen(doc, 'scroll', (e) => { if (e.target === doc) fn(e); }, { capture: true, passive: true }));
      return () => { for (const off of offs) off(); };
    },
    takesKey(e) {
      if (disposed) return false;
      const t = e.target instanceof Node ? e.target : null;
      const holder = rootOf(t);
      return (holder ?? activeRoot()) === root;
    },
    claim(key, owner) { if (claims.get(key) === owner) return false; claims.set(key, owner); return true; },
    owner: (key) => claims.get(key) ?? null,
    id: (name) => `${prefix}${name}`,
    inset: o.inset ?? topInset,
    onDispose(fn) { owned.push(fn); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of owned.splice(0).reverse()) { try { fn(); } catch (e) { console.error('editor root dispose:', e); } }
      claims.clear();
      holders.clear();
      roots.delete(root);
      if (last === root) last = null;
      el.classList.remove('rtx-editor');
      for (const a of [...el.attributes]) if (a.name.startsWith('data-') && a.name !== 'data-part') el.removeAttribute(a.name);
    },
  };
  roots.add(root);
  // the editor last worked in takes the keys pressed outside every editor (on <body>, in an overlay)
  const mine = () => { last = root; };
  listen(el, 'pointerdown', mine, true);
  listen(el, 'focusin', mine);
  return root;
}
