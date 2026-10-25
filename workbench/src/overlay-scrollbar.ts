// The workbench's own overlay scrollbar. A view's content runs under the glass header (the strip, the window bar, the
// breadcrumbs: css.ts), so a scrollbar spanning the view's whole box runs under it too. Where the platform's bars are
// classic (scrollbars.ts measures), css.ts styles them and insets their track below the header. Overlay bars (macOS,
// iOS) cannot be styled so (a styled ::-webkit-scrollbar is a classic one) and Firefox has no track inset: there css.ts
// hides the native bar of the workbench's scrollers (SCROLLERS) and this module draws a thin one instead, as the
// platform's own overlay bar looks and behaves:
//   - its track is the scroller's padding box less its scroll-padding (the bands its owner says are covered: the
//     header above, anything below), so it starts at the header's bottom;
//   - it shows while the user scrolls (wheel, touch, keys, its own drag: a scroll without input, as a host's scroll
//     anchoring or a jump, moves a shown bar but does not bring it up) and while the pointer is over its track, and
//     fades out after HIDE_MS (the CSS fades: none with reduced motion);
//   - its thumb drags (pointer capture), a press on the track pages towards the press (and repeats while held);
//   - it follows the scroll (a passive listener) and the pointer, one update per frame; the scroller's size and its
//     children's (ResizeObserver); it is not drawn when nothing scrolls;
//   - it is presentational: aria-hidden, never focusable; scrolling itself stays native (wheel, touch, keys,
//     momentum, a host's anchor keeping).
// The bar is the scroller's next sibling, absolutely placed over the scroller's box (its offsets, re-read when the
// scroller or the bar's header changes size): it moves with the scroller through every transform of the layout and
// never lays out the view (contain: strict; the thumb moves by transform). It is made lazily, on the first scroll or
// hover of a scroller, and goes when its scroller leaves the page.
//
//   watchOverlayScrollbars(root)          the workbench root's listeners (ui.ts); returns the off switch (removes the bars)
//   thumbGeometry(track, view, content, scroll, min?)   the thumb's { size, offset } on a track, null when nothing scrolls
//   scrollPerPixel(track, view, content, min?)          the scroll a thumb drag of 1 px moves
//   pageDirection(at, thumb)              which way a press on the track at `at` pages: -1, 0 (on the thumb), 1
//   SCROLLERS                             the workbench's scrollers: its views, the home panel, a host's [data-wb-scroll]
import { ownScrollbars } from './scrollbars.ts';

export const SCROLLERS = '.wb-view, .wb-home, .wb-panel [data-wb-scroll]';
/** The shortest thumb, px (a long document's), about the platform's. */
export const MIN_THUMB = 24;
/** After the last scroll the bar fades out (the platform's: about a second). */
export const HIDE_MS = 900;
/** A scroll this soon after an input (or after the scroller's previous user scroll: momentum, a smooth scroll) is the
 *  user's; so is the first scroll after an input up to LATE_MS later (a frame late on a busy machine). */
const USER_MS = 250, LATE_MS = 1000;
/** A press on the track pages once, then again every REPEAT_EVERY ms after REPEAT_WAIT while held. */
const REPEAT_WAIT = 350, REPEAT_EVERY = 60;
/** A page is this much of the visible band (Chromium's kMinFractionToStepWhenPaging). */
const PAGE = 0.875;
/** The keys that scroll: a scroll right after one is the user's. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);

export type Thumb = { size: number; offset: number };

/** The thumb on a track `track` px long, for a scrollport `view` px over content `content` px scrolled by `scroll`:
 *  its length is the visible fraction of the track (at least `min`, at most the track), its offset the scroll's
 *  fraction of the room left; null when nothing scrolls (less than a pixel to scroll) or there is no track. */
export function thumbGeometry(track: number, view: number, content: number, scroll: number, min = MIN_THUMB): Thumb | null {
  const range = content - view;
  if (!(track > 0) || !(view > 0) || !(range >= 1)) return null;
  const size = Math.max(Math.min(min, track), Math.min(track, (track * view) / content));
  const at = Math.min(Math.max(scroll, 0), range);
  return { size, offset: ((track - size) * at) / range };
}
/** The scroll a thumb drag of one pixel moves (0 when the thumb fills its track). */
export function scrollPerPixel(track: number, view: number, content: number, min = MIN_THUMB): number {
  const t = thumbGeometry(track, view, content, 0, min);
  return t && track - t.size > 0 ? (content - view) / (track - t.size) : 0;
}
/** A press `at` px along the track: page back (-1) above the thumb, forward (1) below it, nothing (0) on it. */
export function pageDirection(at: number, t: Thumb): -1 | 0 | 1 {
  return at < t.offset ? -1 : at > t.offset + t.size ? 1 : 0;
}

type AxisName = 'y' | 'x';
type Axis = { k: AxisName; track: HTMLElement; thumb: HTMLElement; on: boolean; len: number; size: number; box: string };
type OwnBar = { el: HTMLElement; scroller: HTMLElement; poke(user: boolean): void; hover(on: boolean): void; near(x: number, y: number): boolean; dispose(): void };

const px = (v: string, of: number): number => (v.endsWith('%') ? (parseFloat(v) * of) / 100 : parseFloat(v) || 0);
const scrolls = (o: string): boolean => o === 'auto' || o === 'scroll';

function makeBar(sc: HTMLElement, registry: WeakMap<Element, OwnBar>): OwnBar {
  const doc = sc.ownerDocument, win = doc.defaultView!;
  const el = doc.createElement('div');
  el.className = 'wb-sb';
  el.setAttribute('aria-hidden', 'true');
  const axis = (k: AxisName): Axis => {
    const track = doc.createElement('div'), thumb = doc.createElement('div');
    track.className = `wb-sb-track wb-sb-track--${k}`;
    thumb.className = 'wb-sb-thumb';
    track.append(thumb);
    el.append(track);
    return { k, track, thumb, on: false, len: 0, size: -1, box: '' };
  };
  const Y = axis('y'), X = axis('x');
  let box = '', hit = 0, padT = 0, padB = 0, canY = false, canX = false, dirty = true, frame = 0, hideT = 0, shown = false, hot = false, held = false, want = false, lastUser = -Infinity;

  /** the bar right after its scroller (a host's re-render may have dropped it) */
  const place = () => { if (el.previousSibling !== sc) sc.after(el); };
  /** read the scroller's box, insets and overflow; place the bar and its tracks over it */
  function measure(): void {
    dirty = false;
    place();
    const cs = getComputedStyle(sc);
    const H = sc.clientHeight, W = sc.clientWidth, cl = sc.clientLeft, ct = sc.clientTop;
    hit = parseFloat(cs.getPropertyValue('--wb-sb-hit')) || 0;
    padT = px(cs.scrollPaddingTop, H); padB = px(cs.scrollPaddingBottom, H);
    canY = scrolls(cs.overflowY); canX = scrolls(cs.overflowX);
    const yOn = canY && sc.scrollHeight - H >= 1, xOn = canX && sc.scrollWidth - W >= 1;
    const b = `top:${sc.offsetTop}px;left:${sc.offsetLeft}px;width:${sc.offsetWidth}px;height:${sc.offsetHeight}px`;
    if (b !== box) el.style.cssText = box = b;
    setAxis(Y, yOn, ct + padT, cl + W - hit, hit, Math.max(0, H - padT - padB - (xOn ? hit : 0)));
    setAxis(X, xOn, ct + H - padB - hit, cl, Math.max(0, W - (yOn ? hit : 0)), hit);
  }
  function setAxis(A: Axis, on: boolean, top: number, left: number, w: number, h: number): void {
    if (A.on !== on) { A.on = on; A.track.classList.toggle('wb-sb-track--on', on); }
    A.len = A.k === 'y' ? h : w;
    const b = `top:${top}px;left:${left}px;width:${w}px;height:${h}px`;
    if (b !== A.box) A.track.style.cssText = A.box = b;
  }
  /** one per frame: the thumbs where the scroll is; shown if asked */
  function update(): void {
    frame = 0;
    if (!sc.isConnected) { dispose(); return; }
    const H = sc.clientHeight, W = sc.clientWidth, CH = sc.scrollHeight, CW = sc.scrollWidth;
    if (dirty || (want && !shown) || Y.on !== (canY && CH - H >= 1) || X.on !== (canX && CW - W >= 1)) measure();     // (coming up: read again, the header may have changed)
    for (const [A, view, content, pos] of [[Y, H, CH, sc.scrollTop], [X, W, CW, sc.scrollLeft]] as const) {
      if (!A.on) continue;
      const t = thumbGeometry(A.len, view, content, pos);
      if (!t) continue;
      if (t.size !== A.size) { A.size = t.size; A.thumb.style[A.k === 'y' ? 'height' : 'width'] = `${t.size}px`; }
      A.thumb.style.transform = A.k === 'y' ? `translate3d(0,${t.offset}px,0)` : `translate3d(${t.offset}px,0,0)`;
    }
    if (!Y.on && !X.on) { want = false; if (shown) { shown = false; el.classList.remove('wb-sb--on'); } return; }     // nothing scrolls (now): not drawn
    if (want) {
      want = false;
      if (!shown) { shown = true; el.classList.add('wb-sb--on'); }
      armHide();
    }
  }
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  function armHide(): void {
    win.clearTimeout(hideT);
    if (!hot && !held) hideT = win.setTimeout(hide, HIDE_MS);
  }
  function hide(): void {
    win.clearTimeout(hideT);
    if (hot || held || !shown) return;
    shown = false;
    el.classList.remove('wb-sb--on');
  }
  /** a scroll (the user's: show; another: follow only while shown), a hover, a drag */
  function poke(user: boolean): void {
    const now = win.performance.now();
    if (user || now - lastUser < USER_MS) { lastUser = now; want = true; }
    else if (!shown) { dirty = true; return; }     // a scroll nobody made, the bar hidden: read again when it shows
    schedule();
  }
  function hover(on: boolean): void {
    if (hot === on) return;
    hot = on;
    el.classList.toggle('wb-sb--hot', on);
    if (on) { want = true; schedule(); } else armHide();
  }
  /** the point is over a track that would show (the bar measured first if it has not been) */
  function near(x: number, y: number): boolean {
    const r = sc.getBoundingClientRect();
    if (dirty || !shown) measure();
    const inside = (A: Axis) => {
      if (!A.on) return false;
      const t = A.track.style;
      const L = r.left + parseFloat(t.left), T = r.top + parseFloat(t.top);
      return x >= L && x <= L + parseFloat(t.width) && y >= T && y <= T + parseFloat(t.height);
    };
    return inside(Y) || inside(X);
  }

  // the thumb's drag, the track's paging
  let drag: { A: Axis; from: number; start: number; k: number } | null = null, pager: { A: Axis; dir: -1 | 1; at: number; t: number } | null = null;
  const along = (A: Axis, e: PointerEvent) => { const r = A.track.getBoundingClientRect(); return A.k === 'y' ? e.clientY - r.top : e.clientX - r.left; };
  const metrics = (A: Axis) => (A.k === 'y' ? { view: sc.clientHeight, content: sc.scrollHeight, pos: sc.scrollTop } : { view: sc.clientWidth, content: sc.scrollWidth, pos: sc.scrollLeft });
  const scrollTo = (A: Axis, v: number) => { lastUser = win.performance.now(); sc.scrollTo(A.k === 'y' ? { top: v, behavior: 'instant' } : { left: v, behavior: 'instant' }); };
  function page(): void {
    if (!pager) return;
    const A = pager.A, m = metrics(A), t = thumbGeometry(A.len, m.view, m.content, m.pos);
    if (!t || pageDirection(pager.at, t) !== pager.dir) { stopPaging(); return; }     // the thumb has reached the press
    const band = A.k === 'y' ? m.view - padT - padB : m.view;
    scrollTo(A, m.pos + pager.dir * Math.max(1, band * PAGE));
  }
  function stopPaging(): void { if (pager) { win.clearTimeout(pager.t); pager = null; } }
  function down(e: PointerEvent): void {
    const A = e.currentTarget === Y.track ? Y : X;
    if (e.button !== 0 || !A.on) return;
    e.preventDefault();
    A.track.setPointerCapture(e.pointerId);
    held = true; el.classList.add('wb-sb--held');
    const m = metrics(A), t = thumbGeometry(A.len, m.view, m.content, m.pos), at = along(A, e);
    if (!t) return;
    const dir = pageDirection(at, t);
    if (dir === 0) { drag = { A, from: at, start: m.pos, k: scrollPerPixel(A.len, m.view, m.content) }; return; }
    pager = { A, dir, at, t: 0 };
    page();
    const again = () => { if (!pager) return; page(); if (pager) pager.t = win.setTimeout(again, REPEAT_EVERY); };
    if (pager) pager.t = win.setTimeout(again, REPEAT_WAIT);
  }
  function move(e: PointerEvent): void {
    if (drag) scrollTo(drag.A, drag.start + (along(drag.A, e) - drag.from) * drag.k);
    else if (pager) pager.at = along(pager.A, e);
  }
  function up(): void {
    if (!held) return;
    drag = null; stopPaging();
    held = false; el.classList.remove('wb-sb--held');
    armHide();
  }
  for (const A of [Y, X]) {
    A.track.addEventListener('pointerdown', down);
    A.track.addEventListener('pointermove', move);
    for (const k of ['pointerup', 'pointercancel', 'lostpointercapture']) A.track.addEventListener(k, up);
  }
  el.addEventListener('mousedown', (e) => e.preventDefault());     // no focus move, no selection from a press on the bar

  // the scroller's size and its children's (the content's height): read again, at once if shown
  const ro = new ResizeObserver(() => { if (!sc.isConnected) { dispose(); return; } dirty = true; if (shown) schedule(); });
  const watchKids = () => { for (const c of sc.children) ro.observe(c); };
  ro.observe(sc); watchKids();
  const mo = new MutationObserver((recs) => { for (const r of recs) for (const n of r.removedNodes) if (n instanceof Element) ro.unobserve(n); watchKids(); dirty = true; if (shown) schedule(); });
  mo.observe(sc, { childList: true });

  function dispose(): void {
    ro.disconnect(); mo.disconnect();
    if (frame) win.cancelAnimationFrame(frame);
    win.clearTimeout(hideT); stopPaging();
    registry.delete(sc); registry.delete(el);
    el.remove();
  }
  const bar: OwnBar = { el, scroller: sc, poke, hover, near, dispose };
  registry.set(sc, bar); registry.set(el, bar);
  return bar;
}

/** Draw the workbench's own bars on the scrollers inside `root` (where ownScrollbars(): overlay bars, Firefox): one per
 *  scroller, made on its first scroll or hover. Returns the off switch, which removes them. */
export function watchOverlayScrollbars(root: HTMLElement): () => void {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const bars = new WeakMap<Element, OwnBar>();
  const barOf = (sc: HTMLElement) => bars.get(sc) ?? makeBar(sc, bars);
  let inputAt = -Infinity, fresh = false, hot: OwnBar | null = null;
  const input = (e: Event) => {
    // typing is no scroll (a host's anchoring while one types is not the user's scroll); Space only outside text
    if (e instanceof win.KeyboardEvent && (!SCROLL_KEYS.has(e.key) || (e.key === ' ' && (e.target as HTMLElement).isContentEditable))) return;
    inputAt = e.timeStamp; fresh = true;
  };
  const onScroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof win.HTMLElement) || !t.matches(SCROLLERS) || !ownScrollbars(doc)) return;
    const since = e.timeStamp - inputAt;
    barOf(t).poke(since < USER_MS || (fresh && since < LATE_MS));
    fresh = false;
  };
  const setHot = (b: OwnBar | null) => { if (hot === b) return; hot?.hover(false); hot = b; b?.hover(true); };
  // the pointer: read once a frame (the last move), as the scroll
  let moved: { t: Element; x: number; y: number } | null = null, moveFrame = 0;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !ownScrollbars(doc)) { moved = null; setHot(null); return; }
    moved = { t: e.target as Element, x: e.clientX, y: e.clientY };
    if (!moveFrame) moveFrame = win.requestAnimationFrame(hoverCheck);
  };
  const hoverCheck = () => {
    moveFrame = 0;
    if (!moved) return;
    const { t, x, y } = moved;
    moved = null;
    const over = t.closest?.('.wb-sb');
    if (over) { setHot(bars.get(over) ?? null); return; }
    // the innermost of the workbench's scrollers under the pointer whose track (a band along its far edge) is there
    let found: OwnBar | null = null, edge = -1;
    for (let n = t.closest?.<HTMLElement>(SCROLLERS) ?? null; n && root.contains(n) && !found; n = n.parentElement?.closest<HTMLElement>(SCROLLERS) ?? null) {
      const r = n.getBoundingClientRect();
      if (edge < 0) edge = parseFloat(getComputedStyle(root).getPropertyValue('--wb-sb-hit')) || 0;
      const right = r.left + n.clientLeft + n.clientWidth, bottom = r.top + n.clientTop + n.clientHeight;
      if ((x > right - edge && x <= right) || (y > bottom - edge && y <= bottom)) {
        const b = bars.get(n) ?? (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth ? barOf(n) : null);
        if (b?.near(x, y)) found = b;
      }
    }
    setHot(found);
  };
  const leave = () => { moved = null; setHot(null); };
  const opts = { capture: true, passive: true } as const;
  for (const k of ['wheel', 'touchstart', 'touchmove', 'keydown']) root.addEventListener(k, input, opts);
  root.addEventListener('scroll', onScroll, opts);
  root.addEventListener('pointermove', onMove, opts);
  root.addEventListener('pointerleave', leave);
  return () => {
    for (const k of ['wheel', 'touchstart', 'touchmove', 'keydown']) root.removeEventListener(k, input, opts);
    root.removeEventListener('scroll', onScroll, opts);
    root.removeEventListener('pointermove', onMove, opts);
    root.removeEventListener('pointerleave', leave);
    if (moveFrame) win.cancelAnimationFrame(moveFrame);
    for (const b of root.querySelectorAll('.wb-sb')) bars.get(b)?.dispose();
  };
}
