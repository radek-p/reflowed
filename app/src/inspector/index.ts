// INSPECTOR: the public Reflow TeX inspector (reflowtex src/inspector: boxes and glue, resources, colours) inside
// ReflowEd, on ONE pane, as a SIDE PANEL. Behind "Show advanced features" (settings/advanced.js); the dev page only (the
// single file has no files beside it for the panel to load): app/services.ts imports this module outside a release
// only, so a release has none of what it installs at import (its setting, its key listener, its style element; its view
// is registered only while it is shown).
// The shortcut ⌥⇧I / Alt+Shift+I toggles it with the advanced switch on; otherwise the key goes on (inspector/shortcut.ts).
//
// The panel is a registered side-panel view (design/ui/views.ts, panel: right, a third of the window wide, closable),
// registered while it is open and unregistered when it closes (as the Files panel comes and goes): its container draws
// its tab and its content (the workbench's side column: app/src/wb/host.ts; the user moves and resizes it there, and
// the workbench keeps the place and the width). Its content: a bar (which pane: Focused, or one picked by its place) and
// an element the public panel is hosted in.
//
// The public panel is used as it is, through its host API (window.reflowtex.inspector: dock(el) puts the panel inside an
// element, open for good; inspect(win) starts it afresh; open(block, { scroll: false }) shows a block) and its page
// agent's documented contract (agent.js, "any other tool may evaluate it": cancelPick, clear). Nothing in it is forked.
// Limiting it to one pane: the agent reads the viewer through window.reflowtex.inspect, once, when it installs. We
// install it ourselves before the panel first asks for it, with an inspect object whose blocks() lists the target
// pane's blocks only while the panel is shown, none while it is hidden (so a hidden panel, which stays open in its
// element, has nothing to follow); the panel then finds the agent there and uses it. Another pane, or shown again:
// inspect(window) makes the panel start afresh on that pane's blocks.
//
//   inspector.attach({ layout, root }) -> detach
//                                   the editor it inspects: its layout (panes/layout.js), whose panes it follows, and its
//                                   container (app/editor-root.ts). The panel is the page's (one public panel, one
//                                   agent on window.reflowtex.inspect): it inspects one editor at a time, the one
//                                   attached last (the editor the reader works in: main.js, the mount)
//   inspector.available()           the files are beside the page (not in a release)
//   inspector.on                    computed: shown (its view registered and shown in its container)
//   inspector.target                computed: the pane inspected: the one picked in its bar, else the focused one
//   inspector.pinned                signal: the pane picked in its bar (null: follow the focused pane)
//   inspector.open({ block?, pane? }) · inspector.close() · inspector.toggle() · inspector.pick(paneId | null)
//   inspector.whenReady()           a promise: the panel's last open, close or move has landed
//
// Cost: the side column narrows the documents (they re-break once, as for any side panel). Once hosted, the public
// panel stays open in its element (its API has no way back out of an element): hidden, it polls an agent that lists
// no blocks.
import { signal, computed, effect, untracked, type ReadonlySignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html, Segmented, Frame } from '../design/ui/index.js';
import { registerView, slotsOf, type ViewContext } from '../design/ui/views.ts';
import { advanced, registerAdvanced } from '../settings/advanced.js';
import { registerSetting } from '../settings/registry.ts';
import { isRelease } from '../app/release-mode.js';
import { editorRoots, type EditorRoot } from '../app/editor-root.ts';
import { shortcutAction } from './shortcut.ts';

export const VIEW_ID = 'inspector';
const BASE = 'lib/viewer/inspector/';
/** its column's default width: a third of the window (wider than the left column's SIDE_SIZE), at least 320 px */
const WIDTH = { share: 1 / 3, min: 320 };

/** the public panel's host API (reflowtex src/inspector/src/inspector.ts), the part used here */
interface PanelApi {
  open(block?: Element, o?: { dock?: string; scroll?: boolean }): Promise<void>;
  dock(el: Element, block?: Element | null): Promise<void>;
  inspect(win: Window): Promise<void>;
}
/** the viewer's inspection object (window.reflowtex.inspect), as far as it is scoped here */
interface ViewerInspect { blocks(): Element[]; [k: string]: unknown }
/** the page agent (agent.js), the calls used here */
interface Agent { cancelPick(): void; clear(): void }
type RtxWindow = Window & { reflowtex?: { inspector?: PanelApi; inspect?: ViewerInspect }; __rtxInspector?: Agent };
const W = () => window as RtxWindow;
/** the editor's pane layout (panes/layout.js), as far as it is read here */
interface LayoutLike { panes: ReadonlySignal<{ id: string; view?: string | null }[]>; focused: ReadonlySignal<string> }

let scope: EditorRoot | null = null;                    // the editor's container attached
const paneEl = (id: string | null) => (id && scope ? scope.$(`main[data-pane="${id}"]`) : null);
/** the shown view of block `id` in pane `pane` (not one coming in) */
export function blockElIn(pane: string | null, id: string | null): Element | null {
  const root = paneEl(pane);
  if (!root || !id) return null;
  const blk = root.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
  return blk?.querySelector('.blk-render > .latex-block:not(.incoming)') ?? blk?.querySelector('.latex-block') ?? null;
}

function createInspector() {
  let layout: LayoutLike | null = null;
  const docked = signal(false);                          // its view registered (its container has it)
  const at = signal<HTMLElement | null>(null);           // the element of the container showing it now (none: hidden)
  const on = computed(() => docked.value && !!at.value);
  const pinned = signal<string | null>(null);
  const panes = signal<string[]>([]);
  const focused = signal('');
  const target = computed(() => (pinned.value && panes.value.includes(pinned.value) ? pinned.value : focused.value));
  /** the pane the panel lists (null: none: it is hidden) */
  const live = () => (on.peek() ? target.peek() : null);
  let api: PanelApi | null = null, loading: Promise<PanelApi> | null = null, ready: Promise<unknown> = Promise.resolve();
  let shownOn: string | null = null, hostEl: HTMLElement | null = null, stopEffects: (() => void) | null = null, unregister: (() => void) | null = null;

  // ── loading: the panel's script, and the agent installed on the shown pane's blocks ──
  function loadScript(src: string) {
    return new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.dataset.rtxInspectorLoader = '';
      s.onload = () => resolve(); s.onerror = () => reject(new Error(`the inspector could not load (${src})`));
      document.head.append(s);
    });
  }
  async function installAgent() {
    if (W().__rtxInspector) return;
    const rt = W().reflowtex, real = rt?.inspect;
    if (!rt || !real) throw new Error('no viewer to inspect');
    const src = await (await fetch(new URL(BASE + 'agent.js', document.baseURI))).text();
    const scoped = new Proxy(real, {
      get(t, k) {
        if (k === 'blocks') return () => { const root = paneEl(live()); return root ? t.blocks().filter((el) => root.contains(el)) : []; };
        const v: unknown = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    rt.inspect = scoped;                      // (for the install only: the agent keeps what it read)
    try { new Function(src)(); } finally { rt.inspect = real; }
  }
  function load(): Promise<PanelApi> {
    return loading ??= (async () => {
      if (!W().reflowtex?.inspector) await loadScript(new URL(BASE + 'inspector.js', document.baseURI).href);
      await installAgent();
      const a = W().reflowtex?.inspector;
      if (!a) throw new Error('the inspector did not install');
      return (api = a);
    })().catch((e: unknown) => { loading = null; throw e; });
  }

  // ── its view: registered while it is open ──
  function dock() {
    if (unregister) return;
    unregister = registerView({ id: VIEW_ID, title: 'Inspector', label: 'Inspector', icon: 'inspect',
      tip: 'The boxes and glue behind the blocks of one pane (the Reflow TeX inspector; ⌥⇧I)',
      panel: { side: 'right', order: 60, width: WIDTH, onClose: () => { void queue(hide); } }, Component: InspectorView });
    docked.value = true;
  }
  function undock() {
    if (!unregister) return;
    for (const r of editorRoots()) { const a = slotsOf(r).active('sidebar'); if (a.peek() === VIEW_ID) a.value = 'outline'; }
    unregister(); unregister = null;
    docked.value = false;
  }
  /** the container's element showing it (its content's), or none */
  function shownIn(el: HTMLElement, shown: boolean) {
    if (shown) at.value = el;
    else if (at.peek() === el) at.value = null;
  }

  // ── following: the panel hosted in the shown element, on the target pane; hidden, it lists nothing ──
  async function sync() {
    const p = live(), el = at.peek();
    if (!p || !el) {
      if (shownOn) { shownOn = null; const ag = W().__rtxInspector; try { ag?.cancelPick(); ag?.clear(); } catch { /* the agent's */ } }
      return;
    }
    const a = await load();
    if (hostEl !== el) {
      const first = !hostEl;
      hostEl = el;
      await a.dock(el);                       // (the first time it opens there, on the pane its agent lists)
      if (first) { shownOn = p; return; }
    }
    if (shownOn !== p) { shownOn = p; await a.inspect(window); }
  }
  /** until `ok` holds (signals it reads), at most `ms` */
  function until(ok: () => boolean, ms = 5000): Promise<boolean> {
    return new Promise((res) => {
      let stop: (() => void) | null = null, done = false;
      const finish = (v: boolean) => { if (done) return; done = true; clearTimeout(t); queueMicrotask(() => stop?.()); res(v); };
      const t = setTimeout(() => finish(false), ms);
      stop = effect(() => { if (ok()) finish(true); });
    });
  }

  // ── on and off ──
  async function show({ block = null, pane = null }: { block?: string | null; pane?: string | null } = {}) {
    if (!available() || !advanced.peek() || !scope) return false;
    if (pane && pane !== target.peek()) pinned.value = pane;
    await load();                             // (its script before the view: its key listener after ours)
    dock();
    slotsOf(scope).show(VIEW_ID);             // its container shows it (the workbench: its column opened, its tab active)
    if (!(await until(() => on.value))) return false;
    await sync();
    const el = block ? blockElIn(target.peek(), block) : null;
    if (el && api) await api.open(el, { scroll: false });
    return true;
  }
  async function hide() {
    undock();
    await sync();
  }
  const queue = (fn: () => Promise<unknown>) => (ready = ready.then(fn, fn).catch((e: unknown) => console.warn('inspector:', (e as Error)?.message ?? e)));

  function attach({ layout: l, root }: { layout: object; root: EditorRoot | null }) {
    const ll = l as LayoutLike;
    if (layout === ll && scope === root) return () => detach(ll);
    stopEffects?.();
    // (here, not at import: a release's boot object may be set after the bundle is evaluated)
    if (available()) registerAdvanced({ id: VIEW_ID, label: 'The inspector (boxes and glue)', where: 'View, block menu, ⌥⇧I' });
    if (layout && layout !== ll) pinned.value = null;    // another editor: its panes, not the last one's pick
    layout = ll;
    scope = root;
    const stops = [
      effect(() => { panes.value = ll.panes.value.filter((p) => !p.view).map((p) => p.id); }),   // a view pane has no blocks to inspect
      effect(() => { focused.value = ll.focused.value; }),
      effect(() => { on.value; target.value; at.value; void queue(sync); }),
      // the advanced switch off: the inspector goes
      effect(() => { if (!advanced.value) void queue(hide); }),
    ];
    stopEffects = () => stops.forEach((s) => s());
    return () => detach(ll);
  }
  /** the editor goes: the inspector with it, when it inspects that one */
  function detach(l: LayoutLike) {
    if (layout !== l) return;
    stopEffects?.(); stopEffects = null;
    layout = null; scope = null;
    void queue(hide);
  }
  const available = () => !isRelease();

  return {
    on, pinned, target, attach, available, shownIn,
    get root() { return scope; },
    open: (o?: { block?: string | null; pane?: string | null }) => queue(() => show(o)),
    close: () => queue(hide),
    toggle: () => queue(() => (on.peek() ? hide() : show())),
    pick: (id: string | null) => { pinned.value = id ?? null; return ready; },
    whenReady: () => ready.then(() => {}),
    get panes() { return panes.value; },
  };
}

export const inspector = createInspector();

// its switch in the View options, with the advanced ones (settings/registry.ts)
registerSetting({ id: 'view-inspector', where: 'view-switch', order: 30, advanced: true, shown: () => inspector.available(),
  Control: () => html`<label title=${'The boxes and glue behind the blocks of one pane (the Reflow TeX inspector; ⌥⇧I)'}>
    <input type="checkbox" id="rtx-vp-inspector" checked=${inspector.on.peek()} onChange=${(e: Event) => ((e.currentTarget as HTMLInputElement).checked ? inspector.open() : inspector.close())} /><span>Inspector</span></label>` });

/** the panes in their places on the page, left to right (then top to bottom): a pane is named by its place, not its id */
const byPlace = (ids: string[]) => ids.map((id) => ({ id, r: paneEl(id)?.getBoundingClientRect() })).sort((x, y) => (x.r?.left ?? 0) - (y.r?.left ?? 0) || (x.r?.top ?? 0) - (y.r?.top ?? 0)).map((x) => x.id);
// ── its content: which pane (with two or more), and the element the public panel is hosted in ──
function PaneBar() {
  const ids = inspector.panes;
  if (ids.length < 2) return null;
  const value = inspector.pinned.value && ids.includes(inspector.pinned.value) ? inspector.pinned.value : 'focused';
  const options = [{ value: 'focused', label: 'Focused', attrs: { 'data-pane-pick': 'focused', title: 'Inspect the pane you work in' } },
    ...byPlace(ids).map((id, k, all) => { const label = all.length === 2 ? ['Left', 'Right'][k]! : `Pane ${k + 1}`;
      return { value: id, label, attrs: { 'data-pane-pick': id, 'data-place': String(k), title: `Inspect the ${label.toLowerCase()} pane` } }; })];
  return html`<div class="rtx-insp-bar" role="toolbar" aria-label="Pane inspected" data-pane-of=${inspector.target.value}>
    <${Segmented} class="rtx-insp-seg" label="Pane inspected" options=${options} value=${value}
      onChange=${(v: string) => inspector.pick(v === 'focused' ? null : v)} /></div>`;
}
function InspectorView({ ctx }: { ctx: ViewContext }) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current!;
    const stop = effect(() => { const v = ctx.visible.value; untracked(() => inspector.shownIn(el, v)); });
    return () => { stop(); inspector.shownIn(el, false); };
  }, []);
  // (data-rtx-ui: the inspector's own UI: a pick does not see it)
  return html`<${Frame} title="Inspector"><div class="rtx-insp" data-rtx-ui="">
    <${PaneBar} />
    <div class="rtx-insp-body" ref=${body}></div>
  </div><//>`;
}

// The shortcut, Alt+Shift+I: taken only when it toggles the inspector (inspector/shortcut.ts). This listener is in
// place before the public panel's script loads, so it runs before that script's own listener for the key.
// (Not a row of a page key table: those run after the public panel's capture listener on the window.)
if (typeof window !== 'undefined') {
  addEventListener('keydown', (e) => {
    const act = shortcutAction(e, { canShow: advanced.peek() && inspector.available(), panelLoaded: !!W().reflowtex?.inspector });
    if (!act) return;
    e.stopImmediatePropagation();
    if (act === 'toggle') { e.preventDefault(); void inspector.toggle(); }
  }, true);
  const css = document.createElement('style');
  css.id = 'rtx-insp-css';
  css.textContent = `
.rtx-insp { height: 100%; display: flex; flex-direction: column; gap: var(--ui-2, 8px); }
.rtx-insp-bar { flex: 0 0 auto; display: flex; align-items: center; min-width: 0; overflow-x: auto; font: var(--ui-text-sm, 12px) / 1 var(--ui-font); }
.rtx-insp-seg > button { white-space: nowrap; }
.rtx-insp-body { position: relative; flex: 1 1 auto; min-height: 0; }
@media print { .rtx-insp { display: none; } }`;
  document.head.append(css);
}
