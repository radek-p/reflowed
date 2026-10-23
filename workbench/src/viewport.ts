// The workbench owns the viewport (Safari): the page itself never scrolls, so nothing moves the whole app up or
// down for a moment: no rubber-band bounce of the page, no page scroll when focus, a caret or scrollIntoView()
// reaches an inner area. Scrolling happens only inside the views' own scroll areas (overscroll-behavior:
// contain; the workbench's boxes clip, see css.js).
//
//   const off = ownViewport()      the host calls it once for a full-window workbench; off() undoes it
//   visibleBox() -> { top, bottom }   the part of the window the reader sees (client px): the app's available height
//   onVisible(fn, { phase })       fn(box) once per settled change of it; phase 'layout' (default: sizes written)
//                                  runs before 'reveal' (reads the new layout, scrolls something into view)
//
// - html and body: the dynamic viewport's height (100dvh: iOS Safari's toolbars), overflow hidden,
//   overscroll-behavior none (no bounce, no pull-to-refresh);
// - a guard: if the document's scrolling element (or body) scrolls anyway (WebKit scrolls it to show a focused
//   field or a caret even with overflow hidden), it is put back in the same frame, before it is painted;
// - THE VISIBLE PART (mobile-fit): an on-screen keyboard shrinks the visual viewport, not the layout one
//   (iOS Safari always: it has no interactive-widget; Android Chrome by default, resizes-visual), so the app would go
//   on under the keyboard. While the visual viewport is shorter than the layout viewport, <body> (the app's frame)
//   is fitted to it: --wb-vtop and --wb-vh on <body> (its top and height in VIEWPORT_CSS), and the class wb-fitted on
//   <body> (a host's rule drops its bottom safe-area inset with it: the keyboard covers the home indicator); at rest none
//   of them is set (nothing restyles). (mobile-chrome) That inset was a variable, --wb-safe-bottom, read by
//   the host's root in var(--wb-safe-bottom, env(...)): Chromium restyled every element below the root when it changed
//   (6,068 of 6,641; with the same rule as a class, 1). So the variables here are read by <body> and by overlays only. Everything that sizes
//   itself from the frame (panes, the editing popover's cap at half its pane, sticky parts) follows from layout; code
//   that measures the window reads visibleBox(), never innerHeight. A browser that resizes the layout viewport instead
//   (Android with resizes-content) needs no fit: the box follows from the window and onVisible still tells.
//   One change per keyboard move: the box is read every frame while it changes and applied when two frames agree
//   (Android animates the keyboard frame by frame; iOS reports it at once), so nothing jitters with its animation.
// - A PINCH ZOOM is the user's and is left alone: while visualViewport.scale is not 1 the guard does nothing (in
//   WebKit panning and zooming out move window.scrollX/Y; putting them back at 0,0 held the page zoomed in, and
//   Safari restores a pinch scale on reload: "absurdly zoomed on every reload" at 100 % Page Zoom), and the fit
//   keeps what it had (a pinch shrinks the visual viewport; it must never fit the layout to the zoomed area).
//
// The FIRST frame: a host puts VIEWPORT_CSS in its page's <head> as <style id="wb-viewport-css"> (the demo's server
// fills it from here: scripts/bundle.ts demoHtml()), so the page is clipped before any script runs; ownViewport()
// then adopts that element and only adds the guard (off() leaves a style it did not add).
export const VIEWPORT_CSS = `
html, body { height: 100%; height: 100dvh; margin: 0; overflow: hidden; overscroll-behavior: none; }
body { position: fixed; inset: 0; width: 100%; top: var(--wb-vtop, 0px); height: var(--wb-vh, 100dvh); }
`;

export interface VisibleBox { top: number; bottom: number }
type Phase = 'layout' | 'reveal';
const listeners: Record<Phase, Set<(b: VisibleBox) => void>> = { layout: new Set(), reveal: new Set() };
/** the box last applied by ownViewport (null: none owns the viewport, the window is the box) */
let shown: VisibleBox | null = null;

/** The part of the window the reader sees, in client px: above an on-screen keyboard. */
export function visibleBox(): VisibleBox {
  return shown ? { ...shown } : { top: 0, bottom: typeof innerHeight === 'number' ? innerHeight : 0 };
}
/** fn(box) after each settled change of the visible box (the keyboard, a rotation, a window resize); off() */
export function onVisible(fn: (b: VisibleBox) => void, { phase = 'layout' }: { phase?: Phase } = {}): () => void {
  listeners[phase].add(fn);
  return () => { listeners[phase].delete(fn); };
}

/** The guard's off switch, with how many scrolls it put back and how many fits it applied (the tests read them). */
export type ViewportGuard = (() => void) & { readonly resets: number; readonly fits: number };
export function ownViewport(doc: Document = document): ViewportGuard {
  const win = doc.defaultView!;
  const own = !doc.getElementById('wb-viewport-css');
  const style = own ? doc.createElement('style') : null;
  if (style) { style.id = 'wb-viewport-css'; style.textContent = VIEWPORT_CSS; doc.head.append(style); }
  let resets = 0, fits = 0;
  const vv = win.visualViewport;
  const pinched = () => !!vv && Math.abs((vv.scale ?? 1) - 1) > 0.01;
  const back = () => {
    if (pinched()) return;
    for (const el of new Set([doc.scrollingElement, doc.documentElement, doc.body])) {
      if (el && (el.scrollTop || el.scrollLeft)) { el.scrollTop = 0; el.scrollLeft = 0; resets++; }
    }
    if (win.scrollX || win.scrollY) { win.scrollTo(0, 0); resets++; }
  };
  // 'scroll' on the window comes before the frame is painted; capture on the document sees body and html too
  win.addEventListener('scroll', back, { passive: true });
  const docScroll = (e: Event) => { if (e.target === doc || e.target === doc.body || e.target === doc.documentElement) back(); };
  doc.addEventListener('scroll', docScroll, { passive: true, capture: true });

  // ── the visible part ──
  /** the layout viewport's height: the window's (iOS and Chrome keep it when the keyboard shows) */
  const layoutH = () => Math.max(win.innerHeight || 0, doc.documentElement?.clientHeight || 0);
  /** what is visible now: { top, height, fit } (fit: shorter than the layout viewport, so the frame is fitted to it) */
  function read(): { top: number; height: number; fit: boolean } {
    const L = layoutH();
    if (!vv) return { top: 0, height: L, fit: false };
    const h = Math.round(vv.height), top = Math.max(0, Math.round(vv.offsetTop || 0));
    return h < L - 1 ? { top, height: h, fit: true } : { top: 0, height: Math.round(L), fit: false };
  }
  let at = { top: 0, height: -1, fit: false };
  const body = () => doc.body as HTMLElement | null;
  function apply(r: { top: number; height: number; fit: boolean }) {
    const same = r.top === at.top && r.height === at.height && r.fit === at.fit;
    at = r;
    if (same) return;
    const b = body();
    if (b?.style) {
      if (r.fit) {
        b.style.setProperty('--wb-vtop', `${r.top}px`);
        b.style.setProperty('--wb-vh', `${r.height}px`);
        b.classList.add('wb-fitted');
        fits++;
      } else if (b.style.getPropertyValue('--wb-vh')) {
        for (const p of ['--wb-vtop', '--wb-vh']) b.style.removeProperty(p);
        b.classList.remove('wb-fitted');
        fits++;
      }
    }
    shown = { top: r.top, bottom: r.top + r.height };
    const box = { ...shown };
    for (const f of [...listeners.layout, ...listeners.reveal]) { try { f(box); } catch (e) { console.error('onVisible:', e); } }
  }
  // settle: read once a frame while the box changes; apply when two frames agree
  let raf = 0, last: { top: number; height: number; fit: boolean } | null = null;
  const frame = win.requestAnimationFrame?.bind(win) ?? ((f: FrameRequestCallback) => win.setTimeout(() => f(0), 16));
  const cancel = win.cancelAnimationFrame?.bind(win) ?? ((id: number) => win.clearTimeout(id));
  function tick() {
    raf = 0;
    if (pinched()) { last = null; return; }
    const r = read();
    if (last && r.top === last.top && r.height === last.height && r.fit === last.fit) { last = null; apply(r); return; }
    last = r;
    raf = frame(tick);
  }
  const changed = () => { if (!raf) { last = null; raf = frame(tick); } };
  const onVV = () => { back(); changed(); };     // back at scale 1: a scroll left over from the pinch is put back
  vv?.addEventListener('resize', onVV);
  vv?.addEventListener('scroll', changed);
  win.addEventListener('resize', changed);
  if (!pinched()) apply(read());
  back();
  // (getters defined, not assigned: Object.assign would copy their values once, and the counts would stay 0)
  const offFn = () => {
    style?.remove();
    win.removeEventListener('scroll', back);
    doc.removeEventListener('scroll', docScroll, { capture: true });
    vv?.removeEventListener('resize', onVV);
    vv?.removeEventListener('scroll', changed);
    win.removeEventListener('resize', changed);
    if (raf) cancel(raf);
    apply({ top: 0, height: layoutH(), fit: false });
    shown = null;
  };
  return Object.defineProperties(offFn, { resets: { get: () => resets }, fits: { get: () => fits } }) as ViewportGuard;
}
