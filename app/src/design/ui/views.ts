// Views (the shape only, no workbench): a panel's CONTENT is a component apart from its CONTAINER, and
// panels are registered views with ids, not elements found by #id or a selector.
//
// ONE SHAPE for every view, the host-neutral contract both hosts implement (the
// standalone page here, the workbench, a VS Code webview):
//   registerView({ id, title, icon?, panel?: { side, order }, badge?, Component?({ ctx, close? }), mount?(host, ctx) })
//     title       a string, or (state) -> string
//     panel       a side panel: no document of its own, it follows the container's CURRENT document (ctx.current);
//                 { side: 'left' | 'right', order, width?, below?, onDemand?, keys?, onClose? }; width: its column's
//                 default width, { share, min?, max? } (a share of the window, within px bounds; a container with columns
//                 uses it); below: docked as a group of its own at its column's bottom; onClose: it is closable (its
//                 container offers a close on its tab that calls it). onDemand: OFFERED, not shown until asked for: it is
//                 in its slot only while open (openPanel), its close closes it (closePanel, then its onClose), and a
//                 container's View menu lists it (offered()); keys: the key that opens and closes it (as shortcutLabel
//                 reads it: 'mod+,'), shown beside that menu's row. (The older slot: 'sidebar' and order mean the same:
//                 panel left)
//     Component   the content, a Preact component of { ctx } (and close, in a sheet)
//     mount       or, for content that is not a component (an island, a pane of its own DOM): mount(host, ctx) ->
//                 { unmount(), focus?() }; a host element the container owns and never re-parents
//   ViewContext   what a container gives a view (below): its id, the current document (a signal), visible, the
//                 commands, the container's capabilities instead of no-op functions, announce
//
// The page's (definitions, one set per page, like VS Code's contributed views):
//   registerView(def) -> unregister()                 slot: where a view lives by default ('sheet', 'sidebar')
//   views(slot?)                                      the registered views in their slots now (an on-demand panel only
//                                                     while open; a signal's value: components re-render)
//   offered()                                         the on-demand panels registered, open or not (a View menu's rows)
//   openPanel(id) · closePanel(id) · panelOpen(id)     an on-demand panel opened, closed, open now (a signal's value);
//                                                     a view unregistered is closed
//   view(id)                                          one view, or null
//   defineSlot(slot, { host(v, owner) })              how a slot makes a view's host element (in that container)
//   openView(id, props, { in: 'sheet' })               the view's content in a container; returns { close, el }
//   isOpen(id)                                        open in some container (a sheet is modal: one page-wide stack)
//   <${Frame} title tabs footer note onClose …>        what a view's content renders around itself: the container
//                                                     it is in decides what that is (a Sheet now; a pane or a tab
//                                                     later), through FrameContext
//
// A container's (two editors on a page each have their own sidebar, its active tab, hosts and badges):
//   const s = slotsOf(owner)       owner: the editor's container (app/editor-root.ts: { doc, onDispose }); made once
//   s.active(slot) · s.host(id) · s.show(id) · s.badge(id)    the slot's active view (a signal), a view's host element
//                                  (made once, by its slot), make it the active one, its badge (a signal its content sets)
//
// A content component takes { close } (and its own props) and renders <Frame …>its content</Frame>; it never
// imports Sheet. A container is a component that takes the Frame's props: SheetFrame below; a pane or a tab can
// supply another without the content changing.
import { createContext, type ComponentType, type VNode } from 'preact';
import { useContext } from 'preact/hooks';
import { signal, type Signal, type ReadonlySignal } from '@preact/signals';
import { html } from './core.js';
import { openLayer } from './layers.js';
import { Sheet } from './overlays.js';

type Props = Record<string, unknown>;
/** what a container gives a view (the members every host has, `Current` is what a panel follows) */
export interface ViewContext<Current = unknown, Owner extends SlotOwner = SlotOwner> {
  readonly viewId: string;
  /** the container's current document, as a panel needs it (null: none) */
  readonly current: ReadonlySignal<Current | null>;
  /** shown in its container now (a hidden view keeps its state, does no work it need not) */
  readonly visible: ReadonlySignal<boolean>;
  /** every write goes through the commands of the current document */
  readonly commands: { call(id: string, input?: object): unknown; enabled(id: string, input?: object): boolean };
  /** what the container can do, instead of functions that do nothing */
  readonly can: { split: boolean; rename: boolean; close: boolean; openBeside: boolean };
  /** with can.openBeside: a document at a block (a section's heading) in a new tab, focused (the section menu's row action) */
  openAt?(doc: string, at: string): void;
  announce(text: string): void;
  /** the container (its document, its element ids, its lifetime) */
  readonly owner: Owner;
}
export interface Mounted { unmount(): void; focus?(): void }
/** a view's content: a component of its own props ({ ctx } in a container, { close, … } in a sheet); `never` takes any
 *  component, whatever props it declares (the container gives what the contract says) */
export type ViewComponent = ComponentType<never>;
export interface ViewDef {
  id: string;
  title?: string | ((state: unknown) => string);
  icon?: string;
  /** a side panel: it follows the container's current document; width: its column's default width (a share of the window);
   *  below: a group of its own at its column's bottom; onDemand: offered, open only when asked for (closable); keys: the
   *  key that opens and closes it (shortcutLabel's notation); onClose: closable, and what closing it does */
  panel?: { side: 'left' | 'right'; order?: number; width?: { share: number; min?: number; max?: number }; below?: boolean; onDemand?: boolean; keys?: string; onClose?(): void } | null;
  slot?: string | null;
  order?: number;
  label?: string;
  tip?: string;
  /** a count on its tab (the container's badge) */
  count?: boolean;
  Component?: ViewComponent;
  mount?(host: HTMLElement, ctx: ViewContext): Mounted;
}
export interface Badge { n: number; title?: string; tone?: string }
export interface SlotImpl { host?(v: ViewDef, owner: SlotOwner): HTMLElement }
export interface Slots {
  active(slot: string): Signal<string | null>;
  host(id: string): HTMLElement;
  show(id: string): void;
  badge(id: string): Signal<Badge | null>;
}
/** what a container is, to the kit: its document, its element ids, and a way to be told when it goes */
export interface SlotOwner { readonly doc: Document; id(name: string): string; onDispose(fn: () => void): void }

const registry = signal(new Map<string, ViewDef>());
const open = new Map<string, { close(): void; el: HTMLElement | null }>();
/** the on-demand panels open now (their ids): the registry's state (a change is a new registry value: its readers follow) */
const opened = new Set<string>();
const changed = () => { registry.value = new Map(registry.peek()); };

/** one shape: `panel` and the older `slot: 'sidebar'` + `order` are the same thing (a left side panel); an on-demand
 *  panel's close closes it (then does what its own onClose does) */
function normal(v: ViewDef): ViewDef {
  const p = v.panel ?? (v.slot === 'sidebar' ? { side: 'left' as const, order: v.order ?? 0 } : null);
  const own = p?.onClose;
  const panel = p?.onDemand ? { ...p, onClose: () => { closePanel(v.id); own?.(); } } : p;
  return { ...v, slot: panel ? 'sidebar' : v.slot ?? null, order: panel?.order ?? v.order, panel };
}
export function registerView(v: ViewDef): () => void {
  if (!v?.id) throw new Error('registerView: an id');
  if (!v.Component && !v.mount) throw new Error(`registerView ${v.id}: a Component or a mount (its content)`);
  const def = normal(v);
  const m = new Map(registry.peek());
  m.set(v.id, def);
  registry.value = m;
  return () => { const n = new Map(registry.peek()); if (n.get(v.id) !== def) return; n.delete(v.id); opened.delete(v.id); registry.value = n; };   // (unregistered: closed)
}
/** a view's title, given its state */
export const titleOf = (v: ViewDef, state: unknown = null): string => (typeof v.title === 'function' ? v.title(state) : v.title ?? v.id);
export const view = (id: string): ViewDef | null => registry.value.get(id) ?? null;
const byOrder = (a: ViewDef, b: ViewDef) => (a.order ?? 0) - (b.order ?? 0);
/** in its slot now: an on-demand panel only while it is open */
const placed = (v: ViewDef) => !v.panel?.onDemand || opened.has(v.id);
export const views = (slot?: string | null): ViewDef[] => [...registry.value.values()].filter((v) => (slot == null || v.slot === slot) && placed(v)).sort(byOrder);
export const offered = (): ViewDef[] => [...registry.value.values()].filter((v) => !!v.panel?.onDemand).sort(byOrder);
export function panelOpen(id: string): boolean { void registry.value; return opened.has(id); }   // (read through the registry: its readers follow)
/** on-demand panel `id` opened (its containers dock it); false: no such panel registered */
export function openPanel(id: string): boolean {
  if (!registry.peek().get(id)?.panel?.onDemand) return false;
  if (!opened.has(id)) { opened.add(id); changed(); }
  return true;
}
/** on-demand panel `id` closed (out of its containers) */
export function closePanel(id: string): void {
  if (opened.delete(id)) changed();
}
export const isOpen = (id: string): boolean => open.has(id);

type FrameComponent = (props: Props) => VNode | null;
/** The container a view's content is in (default: the sheet). */
export const FrameContext = createContext<FrameComponent | null>(null);
export function Frame(props: Props) {
  const F = useContext(FrameContext) ?? SheetFrame;
  return html`<${F} ...${props} />`;
}
/** The sheet container: the Frame's props are the kit Sheet's. */
export function SheetFrame(props: Props) { return html`<${Sheet} ...${props} />`; }

const CONTAINERS: Record<string, FrameComponent> = { sheet: SheetFrame };

/** Open view `id` with `props` in a container (default its slot, else the sheet). The content gets `close`. */
export function openView(id: string, props: Props = {}, { in: where = null }: { in?: string | null } = {}) {
  const v = registry.peek().get(id);
  if (!v?.Component) throw new Error(`openView: no view ${id}`);
  const have = open.get(id);
  if (have) return have;
  const F = CONTAINERS[where ?? 'sheet'] ?? SheetFrame;
  const C = v.Component;
  const handle: { close(): void; el: HTMLElement | null } = { close: () => {}, el: null };
  const layer = openLayer((close: () => void) => {
    handle.close = () => { open.delete(id); close(); };
    return html`<${FrameContext.Provider} value=${F}><${C} ...${props} close=${handle.close} /><//>`;
  });
  handle.el = layer.el;
  open.set(id, handle);
  return handle;
}

// ── slots: where views live by default (the sidebar's tabs) ──
// A slot is defined once for the page: how a view's host element is made. Its state — the hosts, the active view, the
// badges — is each container's (slotsOf).
const slotImpls = new Map<string, SlotImpl>();
export function defineSlot(slot: string, impl: SlotImpl): void { slotImpls.set(slot, impl); }

const owned = new WeakMap<SlotOwner, Slots>();
export function slotsOf(owner: SlotOwner): Slots {
  const have = owned.get(owner);
  if (have) return have;
  const hosts = new Map<string, HTMLElement>();
  const badges = new Map<string, Signal<Badge | null>>();
  const actives = new Map<string, Signal<string | null>>();
  const s: Slots = {
    active(slot) {
      let a = actives.get(slot);
      if (!a) { a = signal<string | null>(null); actives.set(slot, a); }
      return a;
    },
    host(id) {
      let el = hosts.get(id);
      if (!el) {
        const v = registry.peek().get(id);
        el = (v?.slot ? slotImpls.get(v.slot)?.host?.(v, owner) : undefined) ?? owner.doc.createElement('div');
        hosts.set(id, el);
      }
      return el;
    },
    show(id) { const v = registry.peek().get(id); if (v?.slot) s.active(v.slot).value = id; },
    badge(id) {
      let b = badges.get(id);
      if (!b) { b = signal<Badge | null>(null); badges.set(id, b); }
      return b;
    },
  };
  owned.set(owner, s);
  owner.onDispose(() => { for (const el of hosts.values()) el.remove(); hosts.clear(); badges.clear(); actives.clear(); owned.delete(owner); });
  return s;
}
