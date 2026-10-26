// THE INSPECTOR'S PANEL HOSTING: the public Reflow TeX inspector (reflowtex src/inspector) loaded and hosted in an
// element of ReflowEd's side panel, its files loaded the first time the inspector is shown. Its state, view, key and
// menu row are inspector/index.ts's, which uses this. (Not an app part of its own, loaded on demand: a browser keeps
// a module that failed to load, offline, as failed for the page's life, so the inspector could not be opened again
// once back online; this part is 3 KB. The public panel's files are fetched afresh after a failure.)
//
//   hostPanel({ base, listed }) -> panel
//     base     where the public panel's files are (a folder's URL: inspector.js, agent.js, inspector.css, panel/, vendor/)
//     listed() the element whose blocks the panel lists now (a pane's), or null (hidden: it lists none)
//   panel.show(el, pane)   the public panel hosted in `el`, inspecting `pane`: its files loaded once (the script, then
//                          its page agent), then docked into `el` (again when `el` is another element: the panel moves),
//                          or started afresh on another pane; resolves once it is styled and open (rejects when a file
//                          could not be loaded)
//   panel.hide()           shown nowhere: the agent's pick and outlines cleared (the panel stays in its element, listing
//                          nothing: the public API has no way back out of an element)
//   panel.open(blockEl)    the tree on that block (the page not scrolled)
//
// The public panel is used as it is, through its host API (window.reflowtex.inspector: dock(el) puts the panel inside an
// element, open for good; inspect(win) starts it afresh; open(block, { scroll: false }) shows a block) and its page
// agent's documented contract (agent.js, "any other tool may evaluate it": cancelPick, clear). Nothing in it is forked.
// Limiting it to one pane: the agent reads the viewer through window.reflowtex.inspect, once, when it installs. It is
// installed here before the panel first asks for it, with an inspect object whose blocks() lists the blocks inside
// listed() only (none while it is hidden); the panel then finds the agent there and uses it.
//
// FLUSH: docked, the public panel draws a frame of its own (a 1 px border, a 12 px radius: its .rtx.docked rule). In
// ReflowEd it fills its side panel edge to edge, as the other side panels do: a style sheet added to its shadow root
// (open) takes the frame away and maps its colours and type to the kit's tokens (the side column's ground, the kit's
// separators, ink and accent, --ui-text-sm and --ui-font). It depends on the public panel's dock markup: its host
// element ([data-rtx-ui] with an open shadow root) appended into the element dock() is given, the panel's root
// .rtx.docked inside it, its bars .bar and .foot, its sticky section heads .rhead. The sheet goes in as soon as the host
// is appended (a mutation observer: before the panel's first paint), so the frame never shows.

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

export interface HostedPanel {
  show(el: HTMLElement, pane: string): Promise<void>;
  hide(): void;
  open(blockEl: Element): Promise<void>;
}

const FLUSH_ID = 'rtx-insp-flush';
/** the public panel's frame taken away, its colours and type the kit's (see FLUSH in the header) */
const FLUSH_CSS = `
:host .rtx.docked {
  --fg: var(--ui-ink, #1f1f1f); --muted: var(--ui-ink-3, #6b6b6b); --icon: var(--ui-ink-2, #474747);
  --line: var(--ui-border-soft, #e3e3e3); --hover: var(--ui-hover, #eef3fd); --sel: var(--ui-selected, #d3e3fd);
  --accent: var(--ui-accent, #0b57d0); --bg: var(--ui-surface, #fff); --bar: var(--ui-hover, #f3f3f3);
  --mono: var(--ui-mono, ui-monospace, Menlo, Consolas, monospace);
  margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent;
  font: var(--ui-text-sm, 12px) / var(--ui-leading, 1.4) var(--ui-font, system-ui, sans-serif);
}
:host .rtx.docked .bar, :host .rtx.docked .foot { background: transparent; }
:host .rtx.docked .rhead { background: linear-gradient(var(--ui-tint, transparent), var(--ui-tint, transparent)), var(--ui-page, #fff); }`;

/** the public panel's host element in `el` (its shadow root open), if it is there */
const hostIn = (el: Element): HTMLElement | null => [...el.children].find((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-rtx-ui') && !!c.shadowRoot) ?? null;
function flush(host: HTMLElement) {
  const sr = host.shadowRoot;
  if (!sr || sr.getElementById(FLUSH_ID)) return;
  const st = document.createElement('style');
  st.id = FLUSH_ID;
  st.textContent = FLUSH_CSS;
  sr.append(st);                              // (after the panel's own sheet: equal rules go to this one)
}
/** the public panel's own style sheet loaded (its <link> in the shadow root); rejects when it could not be (a sheet
 *  that failed is asked for again the next time: a fresh <link> in its place) */
function styled(host: HTMLElement): Promise<void> {
  let link = host.shadowRoot?.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
  if (!link || link.sheet) return Promise.resolve();
  if (link.hasAttribute('data-rtx-failed')) {
    const fresh = link.cloneNode() as HTMLLinkElement;
    fresh.removeAttribute('data-rtx-failed');
    link.replaceWith(fresh);
    link = fresh;
  }
  const l = link;
  return new Promise((resolve, reject) => {
    l.addEventListener('load', () => resolve(), { once: true });
    l.addEventListener('error', () => { l.setAttribute('data-rtx-failed', ''); reject(new Error(`the inspector's style sheet could not load (${l.href})`)); }, { once: true });
  });
}

export function hostPanel({ base, listed }: { base: string; listed(): Element | null }): HostedPanel {
  let api: PanelApi | null = null, loading: Promise<PanelApi> | null = null;
  let shownOn: string | null = null, hostEl: HTMLElement | null = null;
  const url = (name: string) => new URL(name, base).href;

  function loadScript(src: string) {
    return new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.dataset.rtxInspectorLoader = '';
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error(`the inspector could not load (${src})`)); };
      document.head.append(s);
    });
  }
  async function installAgent() {
    if (W().__rtxInspector) return;
    const rt = W().reflowtex, real = rt?.inspect;
    if (!rt || !real) throw new Error('no viewer to inspect');
    const res = await fetch(url('agent.js'));
    if (!res.ok) throw new Error(`the inspector could not load (${url('agent.js')}: ${res.status})`);
    const src = await res.text();
    const scoped = new Proxy(real, {
      get(t, k) {
        if (k === 'blocks') return () => { const root = listed(); return root ? t.blocks().filter((el) => root.contains(el)) : []; };
        const v: unknown = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    rt.inspect = scoped;                      // (for the install only: the agent keeps what it read)
    try { new Function(src)(); } finally { rt.inspect = real; }
  }
  function load(): Promise<PanelApi> {
    return loading ??= (async () => {
      if (!W().reflowtex?.inspector) await loadScript(url('inspector.js'));
      await installAgent();
      const a = W().reflowtex?.inspector;
      if (!a) throw new Error('the inspector did not install');
      return (api = a);
    })().catch((e: unknown) => { loading = null; throw e; });
  }
  /** the public script and its API forgotten, so the next show loads them afresh (its API keeps a panel that failed to
   *  load for good) */
  function forget() {
    loading = null; api = null;
    const rt = W().reflowtex;
    if (rt) delete rt.inspector;
    for (const s of document.querySelectorAll('script[data-rtx-inspector-loader]')) s.remove();
  }
  /** docked into `el`: the flush sheet in its shadow root as soon as its host is appended there */
  async function dockInto(a: PanelApi, el: HTMLElement) {
    const mo = new MutationObserver(() => { const h = hostIn(el); if (h) flush(h); });
    mo.observe(el, { childList: true });
    try { await a.dock(el); } catch (e) { if (!hostIn(el)) forget(); throw e; } finally { mo.disconnect(); }
    const h = hostIn(el);
    if (!h) throw new Error('the inspector did not open');
    flush(h);
    await styled(h);
  }

  return {
    async show(el, pane) {
      const a = await load();
      if (hostEl !== el) {
        const first = !hostEl;
        await dockInto(a, el);                // (the first time it opens there, on the pane its agent lists)
        hostEl = el;
        if (first) { shownOn = pane; return; }
      }
      if (shownOn !== pane) { shownOn = pane; await a.inspect(window); }
    },
    hide() {
      if (!shownOn) return;
      shownOn = null;
      const ag = W().__rtxInspector;
      try { ag?.cancelPick(); ag?.clear(); } catch { /* the agent's */ }
    },
    async open(blockEl) { if (api) await api.open(blockEl, { scroll: false }); },
  };
}
