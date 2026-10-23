// INSPECTOR: the public Reflow TeX inspector (reflowtex src/inspector: boxes and glue, resources, colours) inside
// ReflowEd, on ONE pane. Behind "Show advanced features" (settings/advanced.js); the dev page only (the single file
// has no files beside it for the panel to load).
//
// The public panel is used as it is, through its host API (window.reflowtex.inspector: open, close, inspect, setDock)
// and its page agent's documented contract (agent.js, "any other tool may evaluate it"). Nothing in it is forked.
// Limiting it to one pane: the agent reads the viewer through window.reflowtex.inspect, once, when it installs.
// We install it ourselves before the panel first asks for it, with an inspect object whose blocks() lists the
// target pane's blocks only (everything else is the viewer's own); the panel then finds the agent there and uses it.
// Moving to another pane: the target changes, and inspect(window) makes the panel start afresh on that pane's blocks.
//
//   inspector.attach({ layout, root }) -> detach
//                                   the editor it inspects: its layout (panes/layout.js), whose panes it follows, and its
//                                   container (app/editor-root.ts). The panel is the page's (one public panel, one
//                                   agent on window.reflowtex.inspect): it inspects one editor at a time, the one
//                                   attached last (the editor the reader works in: main.js, the mount)
//   inspector.available()           the files are beside the page (not in a release)
//   inspector.on                    signal: shown
//   inspector.target                computed: the pane inspected: the one picked in its bar, else the focused one
//   inspector.pinned                signal: the pane picked in its bar (null: follow the focused pane)
//   inspector.open({ block?, pane? }) · inspector.close() · inspector.toggle() · inspector.pick(paneId | null)
//   inspector.whenReady()           a promise: the panel's last open or move has landed
//
// Cost: the panel floats (setDock('float') before each open): it never narrows the page, so showing it, moving it
// and hiding it re-break nothing. Its own dock buttons still dock it (the reader's choice; that re-breaks once).
// The bar (InspectorBar) is a registered view: its content apart from its container (PaneCorner, a frame at
// the inspected pane's bottom-right corner).
import { signal, computed, effect } from '@preact/signals';
import { html, render, Segmented, IconButton, registerView, Frame, FrameContext } from '../design/ui/index.js';
import { advanced, registerAdvanced } from '../settings/advanced.js';
import { registerSetting } from '../settings/registry.ts';
import { isRelease } from '../app/release-mode.js';

export const VIEW_ID = 'inspector';
const BASE = 'lib/viewer/inspector/';

let scope = null;                                        // the editor's container attached
const paneEl = (id) => (id && scope ? scope.$(`main[data-pane="${id}"]`) : null);
/** the shown view of block `id` in pane `pane` (not one coming in) */
export function blockElIn(pane, id) {
  const root = paneEl(pane);
  if (!root || !id) return null;
  const blk = root.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
  return blk?.querySelector('.blk-render > .latex-block:not(.incoming)') ?? blk?.querySelector('.latex-block') ?? null;
}
// The public panel's host (a child of <html> with a shadow root) and the agent's outline layer.
const panelHost = () => [...document.documentElement.children].find((e) => e.hasAttribute('data-rtx-ui') && e.shadowRoot) ?? null;
const panelEl = () => panelHost()?.shadowRoot?.querySelector('.rtx') ?? null;
const outlineLayer = () => document.querySelector('[data-rtx-inspector]');

function createInspector() {
  let layout = null;
  const on = signal(false);
  const pinned = signal(null);
  const panes = signal(['a']);
  const focused = signal('a');
  const target = computed(() => (pinned.value && panes.value.includes(pinned.value) ? pinned.value : focused.value));
  let api = null, loading = null, ready = Promise.resolve(), shownOn = null, watcher = null, barHost = null, stopEffects = null;

  // ── loading: the panel's script, and the agent installed on the target pane's blocks ──
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.dataset.rtxInspectorLoader = '';
      s.onload = resolve; s.onerror = () => reject(new Error(`the inspector could not load (${src})`));
      document.head.append(s);
    });
  }
  async function installAgent() {
    if (window.__rtxInspector) return;
    const real = window.reflowtex?.inspect;
    if (!real) throw new Error('no viewer to inspect');
    const src = await (await fetch(new URL(BASE + 'agent.js', document.baseURI))).text();
    const scoped = new Proxy(real, {
      get(t, k) {
        if (k === 'blocks') return () => { const root = paneEl(target.peek()); return root ? t.blocks().filter((el) => root.contains(el)) : []; };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    window.reflowtex.inspect = scoped;           // (for the install only: the agent keeps what it read)
    try { new Function(src)(); } finally { window.reflowtex.inspect = real; }
  }
  function load() {
    return loading ??= (async () => {
      if (!window.reflowtex?.inspector) await loadScript(new URL(BASE + 'inspector.js', document.baseURI).href);
      await installAgent();
      return (api = window.reflowtex.inspector);
    })().catch((e) => { loading = null; throw e; });
  }

  // ── on and off ──
  async function show({ block = null, pane = null } = {}) {
    if (!available() || !advanced.peek()) return false;
    if (pane && pane !== target.peek()) pinned.value = pane;
    const a = await load();
    on.value = true;
    mountBar();
    await a.setDock('float');                    // floating: the page keeps its width (no re-break)
    const p = target.peek();
    if (shownOn && shownOn !== p) await a.inspect(window);
    shownOn = p;
    const el = block ? blockElIn(p, block) : null;
    await a.open(el ?? undefined, { dock: 'float', scroll: false });
    watchPanel();
    return true;
  }
  /** move the open panel to the target pane: the panel forgets the last pane's rows and lists this one's */
  async function follow() {
    if (!on.peek() || !api) return;
    const p = target.peek();
    if (p === shownOn) return;
    shownOn = p;
    await api.inspect(window);
  }
  async function hide() {
    if (!on.peek()) return;
    on.value = false;
    shownOn = null;
    watcher?.disconnect(); watcher = null;
    unmountBar();
    await api?.close();
    // (the panel's close clears the outlines through the agent, after its own await: then they go)
    await new Promise((r) => setTimeout(r, 0));
    // the panel's host and the outline layer go with it (both are made again on the next open)
    panelHost()?.remove();
    outlineLayer()?.remove();
  }
  const queue = (fn) => (ready = ready.then(fn, fn).catch((e) => console.warn('inspector:', e?.message ?? e)));
  // The panel's own close (its × or Esc) turns it off here too.
  function watchPanel() {
    watcher?.disconnect();
    const root = panelHost()?.shadowRoot;
    if (!root) return;
    watcher = new MutationObserver(() => { if (on.peek() && panelEl()?.hidden) queue(hide); });
    watcher.observe(root, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  // ── the bar: a registered view in the pane-corner container ──
  function mountBar() {
    if (barHost) return;
    barHost = document.createElement('div');
    barHost.setAttribute('data-rtx-ui', '');     // the inspector's own UI: a pick does not see it
    barHost.className = 'rtx-insp-host';
    document.body.append(barHost);
    const V = registered.Component;
    render(html`<${FrameContext.Provider} value=${PaneCorner}><${V} close=${() => queue(hide)} /><//>`, barHost);
  }
  function unmountBar() {
    if (!barHost) return;
    render(null, barHost);
    barHost.remove();
    barHost = null;
  }

  /** @param {{ layout: object, root?: { $(sel: string): Element | null, $$(sel: string): Element[] } | null }} o */
  function attach({ layout: l, root = null }) {
    if (layout === l && scope === root) return () => detach(l);
    stopEffects?.();
    // (here, not at import: a release's boot object may be set after the bundle is evaluated)
    if (available()) registerAdvanced({ id: VIEW_ID, label: 'The inspector (boxes and glue)', where: 'View, block menu, ⌥⇧I' });
    if (layout && layout !== l) pinned.value = null;     // another editor: its panes, not the last one's pick
    layout = l;
    scope = root;
    const stops = [
      effect(() => { panes.value = layout.panes.value.filter((p) => !p.view).map((p) => p.id); }),   // a view pane has no blocks to inspect
      effect(() => { focused.value = layout.focused.value; }),
      effect(() => { target.value; queue(follow); }),
      // the advanced switch off: the inspector goes
      effect(() => { if (!advanced.value) queue(hide); }),
    ];
    stopEffects = () => stops.forEach((s) => s());
    return () => detach(l);
  }
  /** the editor goes: the inspector with it, when it inspects that one */
  function detach(l) {
    if (layout !== l) return;
    stopEffects?.(); stopEffects = null;
    layout = null; scope = null;
    queue(hide);
  }
  const available = () => !isRelease();

  return {
    on, pinned, target, attach, available,
    get root() { return scope; },
    open: (o) => queue(() => show(o)),
    close: () => queue(hide),
    toggle: () => queue(() => (on.peek() ? hide() : show())),
    pick: (id) => { pinned.value = id ?? null; return ready; },
    whenReady: () => ready.then(() => {}),
    get panes() { return panes.value; },
  };
}

export const inspector = createInspector();

// its switch in the View options, with the advanced ones (settings/registry.ts)
registerSetting({ id: 'view-inspector', where: 'view-switch', order: 30, advanced: true, shown: () => inspector.available(),
  Control: () => html`<label title=${'The boxes and glue behind the blocks of one pane (the Reflow TeX inspector; ⌥⇧I)'}>
    <input type="checkbox" id="rtx-vp-inspector" checked=${inspector.on.peek()} onChange=${(e) => (e.currentTarget.checked ? inspector.open() : inspector.close())} /><span>Inspector</span></label>` });

/** the panes in their places on the page, left to right (then top to bottom): a pane is named by its place, not its id */
const byPlace = (ids) => ids.map((id) => ({ id, r: paneEl(id)?.getBoundingClientRect() })).sort((x, y) => (x.r?.left ?? 0) - (y.r?.left ?? 0) || (x.r?.top ?? 0) - (y.r?.top ?? 0)).map((x) => x.id);
// ── the bar's content: which pane, and off ──
function InspectorBar({ close }) {
  const ids = inspector.panes;
  const value = inspector.pinned.value && ids.includes(inspector.pinned.value) ? inspector.pinned.value : 'focused';
  const options = [{ value: 'focused', label: 'Focused', attrs: { 'data-pane-pick': 'focused', title: 'Inspect the pane you work in' } },
    ...byPlace(ids).map((id, k, all) => { const label = all.length === 2 ? ['Left', 'Right'][k] : `Pane ${k + 1}`;
      return { value: id, label, attrs: { 'data-pane-pick': id, 'data-place': String(k), title: `Inspect the ${label.toLowerCase()} pane` } }; })];
  return html`<${Frame} title="Inspector" onClose=${close}>
    ${ids.length > 1 ? html`<${Segmented} class="rtx-insp-seg" label="Pane inspected" options=${options} value=${value}
      onChange=${(v) => inspector.pick(v === 'focused' ? null : v)} />` : null}
  <//>`;
}
// ── its container: a frame at the inspected pane's bottom-right corner ──
function PaneCorner({ title, onClose, children }) {
  const p = inspector.target.value;
  const pos = corner(p);
  return html`<div class="rtx-insp-bar" role="toolbar" aria-label=${title} data-pane-of=${p}
      style=${`right:${pos.right}px;bottom:${pos.bottom}px`}>
    <span class="rtx-insp-title">${title}</span>
    ${children}
    <${IconButton} icon="close" size="sm" quiet label="Close the inspector" class="rtx-insp-close" onClick=${onClose} />
  </div>`;
}
// where the pane's visible box ends, from the window's right and bottom edges
const tick = signal(0);
function corner(id) {
  tick.value;
  const el = paneEl(id);
  const r = el?.getBoundingClientRect();
  if (!r) return { right: 12, bottom: 12 };
  return { right: Math.max(0, innerWidth - Math.min(r.right, innerWidth)) + 12, bottom: Math.max(0, innerHeight - Math.min(r.bottom, innerHeight)) + 12 };
}
let raf = 0;
const again = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (inspector.on.peek()) tick.value++; }); };
if (typeof window !== 'undefined') {
  addEventListener('resize', again, { passive: true });
  // a pane opened or closed, its divider dragged (the panes' widths change after the layout's)
  effect(() => { inspector.target.value; inspector.on.value; again(); setTimeout(again, 300); });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(again);
    effect(() => { ro.disconnect(); if (inspector.on.value) for (const el of scope?.$$('main[data-pane]') ?? []) ro.observe(el); inspector.panes; });
  }
}

const registered = { id: VIEW_ID, title: 'Inspector', Component: InspectorBar, slot: 'pane-corner' };
registerView(registered);

// The public panel's shortcut (Alt+Shift+I) opens it on the whole page: here it is ours, and only with the
// advanced switch on (this listener is in place before the panel's script loads, so it runs first).
if (typeof window !== 'undefined') {
  addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (advanced.peek() && inspector.available()) inspector.toggle();
    }
  }, true);
  const css = document.createElement('style');
  css.id = 'rtx-insp-css';
  css.textContent = `
.rtx-insp-bar { position: fixed; z-index: var(--ui-z-float, 50); display: flex; align-items: center; gap: var(--ui-2, 8px);
  padding: 4px 4px 4px 12px; border-radius: var(--ui-r-lg, 12px); background: var(--ui-surface); color: var(--ui-ink);
  border: 1px solid var(--ui-border); box-shadow: var(--ui-shadow-pop); font: var(--ui-text-sm, 12px) / 1 var(--ui-font); }
.rtx-insp-title { font-weight: var(--ui-semibold, 600); white-space: nowrap; }
.rtx-insp-seg > button { white-space: nowrap; }
@media print { .rtx-insp-bar { display: none; } }`;
  document.head.append(css);
}
