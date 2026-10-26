// INSPECTOR: the public Reflow TeX inspector (reflowtex src/inspector: boxes and glue, resources, colours) inside
// ReflowEd, on ONE pane, as a SIDE PANEL. Behind "Show advanced features" (settings/advanced.js).
// The shortcut ⌥⇧I / Alt+Shift+I toggles it with the advanced switch on; otherwise the key goes on (inspector/shortcut.ts).
//
// AVAILABLE where the page has the public panel's files (panelFiles(), the one rule): the dev page beside it
// (lib/viewer/inspector/: scripts/w3-build.ts copies them), the multi-file release where its boot object says
// (__rtxEditor.inspector: the loader reads it from the manifest; scripts/lib/multifile.ts puts the files in the release).
// The single file has none and none of this code either: its build puts a stub in this module's place
// (scripts/lib/app-bundle.ts, inspector: false), so app/services.ts gets no inspector there. Where it is not available
// there is no menu row (wb/host.ts and the block menu, app.js, ask available()), no setting, and the key goes on.
//
// LOADED ON DEMAND: this module and its hosting part (inspector/panel.ts) are what the page has of it before it is
// opened (its state, its view, its key, its setting: about 11 KB in the app's start, 4 KB gzipped). Opening it (the advanced switch on: ⌥⇧I, View › Inspector, a block's Inspect)
// shows its view at once, which shows "Loading the inspector…" (after a moment: a quick load shows nothing)
// while the public panel's files load, once; a load that fails (offline) says so in the panel, and opening it again
// tries again.
//
// The panel is a registered side-panel view (design/ui/views.ts, panel: right, a third of the window wide), offered on
// demand while it can show (the advanced switch on and available(): panel.onDemand, so the main menu's View has its
// row; open only when asked for: ⌥⇧I, that row, a block's Inspect; closed by the close on its tab or the row): its
// container draws its tab and its content (the workbench's side column: app/src/wb/host.ts; the user moves and resizes
// it there, and the workbench keeps the place and the width). Opened by the menu's row (openPanel), its content's
// being shown is what loads it (the same path as ⌥⇧I). Its content: a bar (which pane: Focused, or one picked by its place;
// with two panes or more) and an element the public panel is hosted in (inspector/panel.ts), edge to edge: its side
// panel's inset and padding are taken away here (a rule on the workbench's panel element for this view,
// .rtx-wb-panel[data-panel-view="inspector"]), the public panel's own frame there.
//
//   inspector.attach({ layout, root }) -> detach
//                                   the editor it inspects: its layout (panes/layout.js), whose panes it follows, and its
//                                   container (app/editor-root.ts). The panel is the page's (one public panel, one
//                                   agent on window.reflowtex.inspect): it inspects one editor at a time, the one
//                                   attached last (the editor the reader works in: main.js, the mount)
//   inspector.available()           the public panel's files are on this page (panelFiles())
//   inspector.on                    computed: shown (its view open and shown in its container)
//   inspector.phase                 signal: 'idle' (not loaded) · 'loading' · 'ready' · 'failed' (problem: why)
//   inspector.target                computed: the pane inspected: the one picked in its bar, else the focused one
//   inspector.pinned                signal: the pane picked in its bar (null: follow the focused pane)
//   inspector.open({ block?, pane? }) · inspector.close() · inspector.toggle() · inspector.pick(paneId | null)
//   inspector.whenReady()           a promise: the panel's last open, close or move has landed
//   panelFiles()                    where the public panel's files are here (a folder's URL), or null
//
// Cost: the side column narrows the documents (they re-break once, as for any side panel). Once hosted, the public
// panel stays open in its element (its API has no way back out of an element): hidden, it polls an agent that lists
// no blocks.
import { signal, computed, effect, untracked, type ReadonlySignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html, Segmented, Frame } from '../design/ui/index.js';
import { registerView, slotsOf, openPanel, closePanel, panelOpen, type ViewContext } from '../design/ui/views.ts';
import { advanced, registerAdvanced } from '../settings/advanced.js';
import { editorRoots, type EditorRoot } from '../app/editor-root.ts';
import { shortcutAction } from './shortcut.ts';
import { hostPanel, type HostedPanel } from './panel.ts';

export const VIEW_ID = 'inspector';
/** the dev page's copy of the public panel's files, beside the page */
const DEV_FILES = 'lib/viewer/inspector/';
/** its column's default width: a third of the window (wider than the left column's SIDE_SIZE), at least 320 px */
const WIDTH = { share: 1 / 3, min: 320 };
const FAILED = 'The inspector could not be loaded. Check your connection, then open it again.';

/** where the public panel's files are on this page (a folder's URL), or null: none here. A release says (its boot
 *  object: the multi-file release's loader, from its manifest; the single file names none); the dev page has them beside it */
export function panelFiles(): string | null {
  const boot = (globalThis as { __rtxEditor?: { inspector?: string | null } }).__rtxEditor;
  if (boot) return boot.inspector ?? null;
  return typeof document === 'undefined' ? null : new URL(DEV_FILES, document.baseURI).href;
}

/** the public panel's script on the page (its API: its own key listener is in place) */
const panelLoaded = () => !!(window as Window & { reflowtex?: { inspector?: unknown } }).reflowtex?.inspector;
/** the editor's pane layout (panes/layout.js), as far as it is read here */
interface LayoutLike { panes: ReadonlySignal<{ id: string; view?: string | null }[]>; focused: ReadonlySignal<string> }
export type Phase = 'idle' | 'loading' | 'ready' | 'failed';

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
  const docked = computed(() => panelOpen(VIEW_ID));     // its view open (its container has it)
  const at = signal<HTMLElement | null>(null);           // the element of the container showing it now (none: hidden)
  const on = computed(() => docked.value && !!at.value);
  const pinned = signal<string | null>(null);
  const panes = signal<string[]>([]);
  const focused = signal('');
  const target = computed(() => (pinned.value && panes.value.includes(pinned.value) ? pinned.value : focused.value));
  const phase = signal<Phase>('idle');
  const problem = signal<string | null>(null);
  /** the pane the panel lists (null: none: it is hidden) */
  const live = () => (on.peek() ? target.peek() : null);
  let ready: Promise<unknown> = Promise.resolve();
  let stopEffects: (() => void) | null = null;
  const available = () => panelFiles() != null;

  // ── the hosting part: made the first time it is shown (it loads the public panel's files) ──
  let hosted: HostedPanel | null = null;
  const host = () => (hosted ??= hostPanel({ base: panelFiles()!, listed: () => paneEl(live()) }));

  // ── its view closed (it is offered below, opened in show) ──
  function undock() {
    if (!docked.peek()) return;
    for (const r of editorRoots()) { const a = slotsOf(r).active('sidebar'); if (a.peek() === VIEW_ID) a.value = 'outline'; }
    closePanel(VIEW_ID);
  }
  /** the container's element showing it (its content's), or none */
  function shownIn(el: HTMLElement, shown: boolean) {
    if (shown) at.value = el;
    else if (at.peek() === el) at.value = null;
  }

  // ── following: the panel hosted in the shown element, on the target pane; hidden, it lists nothing ──
  async function sync() {
    const p = live(), el = at.peek();
    if (!p || !el) { hosted?.hide(); return; }
    if (phase.peek() === 'failed') return;   // (its message stays until it is opened again)
    if (phase.peek() !== 'ready') phase.value = 'loading';
    try {
      await host().show(el, p);
      phase.value = 'ready';
    } catch (e) {
      problem.value = String((e as Error)?.message ?? e);
      phase.value = 'failed';
      console.warn('inspector:', problem.peek());
    }
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
    if (phase.peek() === 'failed') { phase.value = 'idle'; problem.value = null; }   // opened again: another try
    openPanel(VIEW_ID);
    slotsOf(scope).show(VIEW_ID);             // its container shows it (the workbench: its column opened, its tab active)
    if (!(await until(() => on.value))) return false;
    await sync();
    const el = block && phase.peek() === 'ready' ? blockElIn(target.peek(), block) : null;
    if (el && hosted) await hosted.open(el);
    return true;
  }
  async function hide() {
    undock();
    if (phase.peek() === 'failed') { phase.value = 'idle'; problem.value = null; }
    await sync();
  }
  const queue = (fn: () => Promise<unknown>) => (ready = ready.then(fn, fn).catch((e: unknown) => console.warn('inspector:', (e as Error)?.message ?? e)));

  function attach({ layout: l, root }: { layout: object; root: EditorRoot | null }) {
    const ll = l as LayoutLike;
    if (layout === ll && scope === root) return () => detach(ll);
    stopEffects?.();
    // (here, not at import: a release's boot object may be set after the bundle is evaluated)
    if (available()) registerAdvanced({ id: VIEW_ID, label: 'The inspector (boxes and glue)', where: 'Main menu, View; block menu; ⌥⇧I' });
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

  // ── its view: offered while it can show (the advanced switch on, its files on the page), open while it is ──
  let unregister: (() => void) | null = null;
  effect(() => {
    const can = advanced.value && available();
    untracked(() => {
      if (can) unregister ??= registerView({ id: VIEW_ID, title: 'Inspector', label: 'Inspector', icon: 'inspect',
        tip: 'The boxes and glue behind the blocks of one pane (the Reflow TeX inspector; ⌥⇧I)',
        panel: { side: 'right', order: 60, width: WIDTH, onDemand: true, keys: 'alt+shift+i', onClose: () => { void queue(hide); } }, Component: InspectorView });
      else { unregister?.(); unregister = null; }
    });
  });

  return {
    on, pinned, target, phase, problem, attach, available, shownIn,
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
/** while it loads, or when it could not: one line where the panel will be (the panel's element kept, hidden) */
function Status() {
  const ph = inspector.phase.value;
  if (ph === 'loading') return html`<p class="rtx-insp-msg" role="status" data-phase="loading">Loading the inspector…</p>`;
  if (ph === 'failed') return html`<p class="rtx-insp-msg" role="alert" data-phase="failed" title=${inspector.problem.value ?? ''}>${FAILED}</p>`;
  return null;
}
function InspectorView({ ctx }: { ctx: ViewContext }) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    installCss();                             // (before its first paint, however it was opened)
    const el = body.current!;
    const stop = effect(() => { const v = ctx.visible.value; untracked(() => inspector.shownIn(el, v)); });
    return () => { stop(); inspector.shownIn(el, false); };
  }, []);
  // (data-rtx-ui: the inspector's own UI: a pick does not see it)
  return html`<${Frame} title="Inspector"><div class="rtx-insp" data-rtx-ui="" data-phase=${inspector.phase.value}>
    <${PaneBar} />
    <${Status} />
    <div class="rtx-insp-body" ref=${body}></div>
  </div><//>`;
}

/** its styles, once it is first shown: its content edge to edge in its side panel (the workbench's panel element's
 *  inset and padding taken away for this view), the pane bar a strip, the status line */
function installCss() {
  if (document.getElementById('rtx-insp-css')) return;
  const css = document.createElement('style');
  css.id = 'rtx-insp-css';
  css.textContent = `
.rtx-wb .rtx-wb-panel.sb-panel[data-panel-view="${VIEW_ID}"] { inset: 0; padding: 0; overflow: hidden; }
.rtx-insp { position: relative; height: 100%; display: flex; flex-direction: column; }
.rtx-insp-bar { flex: 0 0 auto; display: flex; align-items: center; min-width: 0; overflow-x: auto; padding: var(--ui-1, 4px) var(--ui-2, 8px);
  border-bottom: 1px solid var(--ui-border-soft); font: var(--ui-text-sm, 12px) / 1 var(--ui-font); }
.rtx-insp-seg > button { white-space: nowrap; }
.rtx-insp-body { position: relative; flex: 1 1 auto; min-height: 0; }
.rtx-insp:not([data-phase="ready"]) > .rtx-insp-body { visibility: hidden; }
.rtx-insp-msg { position: absolute; left: 0; right: 0; margin: 0; padding: var(--ui-3, 12px) var(--ui-4, 16px);
  color: var(--ui-ink-3); font: var(--ui-text-sm, 12px) / var(--ui-leading, 1.4) var(--ui-font); }
.rtx-insp-msg[data-phase="loading"] { animation: rtx-insp-in var(--ui-mid, 180ms) var(--ui-ease-out, ease-out) 300ms both; }
.rtx-insp-msg[data-phase="failed"] { color: var(--ui-ink-2); }
@keyframes rtx-insp-in { from { opacity: 0; } }
@media print { .rtx-insp { display: none; } }`;
  document.head.append(css);
}

// The shortcut, Alt+Shift+I: taken only when it toggles the inspector (inspector/shortcut.ts). This listener is in
// place before the public panel's script loads, so it runs before that script's own listener for the key.
// (Not a row of a page key table: those run after the public panel's capture listener on the window.)
if (typeof window !== 'undefined') {
  addEventListener('keydown', (e) => {
    const act = shortcutAction(e, { canShow: advanced.peek() && inspector.available(), panelLoaded: panelLoaded() });
    if (!act) return;
    e.stopImmediatePropagation();
    if (act === 'toggle') { e.preventDefault(); void inspector.toggle(); }
  }, true);
}
