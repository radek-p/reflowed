// the reader's place holds while blocks above it typeset.
//
//   import { createAnchorKeeper } from './anchor.js';
//   const keeper = createAnchorKeeper({ list: () => the pane's .blocks, inset: () => its top bar's bottom in px,
//                                       lines?: view/line-anchor.ts (resume() then holds the reader's line, not a block) });
//   keeper.start(); … keeper.stop();
//
// The browser's scroll anchoring is the page's position model (the viewer
// never scrolls), but it gives up in the cases a typesetting document is full
// of: its anchor node sits inside a block that is re-mounted (the node is
// removed: a new anchor is chosen with no adjustment), or the anchor's own
// ancestors change size (a block above the fold that is also the one the
// anchor is in: the change is below the anchor and nothing is compensated),
// and it anchors to what is under the sticky top bar, not what the reader sees.
//
// So the app keeps its own anchor, as a fallback on top of the browser's: the
// first block that starts below the top bar (else the one across it), and its
// viewport y. After every layout that changed the list's size (a
// ResizeObserver callback runs after layout, before paint: no frame shows the
// jump), and once per frame as a backstop, a block that moved is put back
// with window.scrollBy. Never while the user acts: for 250 ms after a
// pointerdown / keydown / touch, and while a scroll the user (or the app,
// answering the user: the outline, a reference jump) started goes on; the
// anchor is taken at each such scroll event and held once it ends (a change
// meanwhile is put back then). The keeper's own corrections never move the
// anchor; nor does the browser clamping the scroll to a shorter page.
import { reduced as reducedMotion } from '../motion/reduced.ts';
// ACTIVE_MS is under perf's QUIET_MS (300): background results held back during input land when the keeper holds again
// SCROLL_GAP_MS 200 -> 40: a scroll has ended once no scroll event came for ~2 frames (a smooth or momentum
// scroll sends one every frame); the anchor is taken at each of the reader's scroll events, so a result landing
// right after the scroll ends is put back in the same frame (it was uncompensated for 200 ms: "by hand" drift)
const ACTIVE_MS = 250, SCROLL_GAP_MS = 40, GLIDE_MS = 260;
// the per-frame backstop runs while something happens (a resize, a scroll, input, a correction put
// off, the app's calls) and stops after QUIET_FRAMES frames without a change: an idle pane spends no frame on it (each
// keeper read the scroll height every frame, forever)
const QUIET_FRAMES = 30;
// the anchor is always an element the layout places: one laid over others by script (a nested
// container over its paragraphs, positioned in its own ResizeObserver) follows them a step later, so as an
// anchor it read "not moved" while its paragraphs had moved: the outline's Abstract entry was put back 25 px
// late for a frame. A block out of the flow is never picked; a reveal of one holds the block under it.
const inFlow = (el) => { const p = getComputedStyle(el).position; return p !== 'absolute' && p !== 'fixed'; };

/** the app scrolls pane P ({ scroller (null: the window), keeper }) on the reader's behalf, `by` px or `to` a y:
 *  its keeper is told before and after (the scroll event comes later), and holds from where the scroll ends. The one
 *  way to do it: callers told the keeper by hand, around their own scrollTop, scrollTo or scrollBy, and some did not.
 *  hold: not a move but a correction for a change of the page (the stacked editor kept in place as its preview changes
 *  height): the keeper's reading point stays (a line it holds across a width change was dropped by it) */
export function appScroll(P, { by = 0, to = null, hold = false }) {
  if (!hold) P.keeper?.moved?.();
  const sc = P.scroller;
  if (to != null) { if (sc) sc.scrollTo({ top: to, behavior: 'instant' }); else window.scrollTo({ top: to, behavior: 'instant' }); }
  else if (by) { if (sc) sc.scrollBy({ top: by, behavior: 'instant' }); else window.scrollBy({ top: by, behavior: 'instant' }); }
  if (hold) P.keeper?.adjusted?.(); else P.keeper?.moved?.();
}

// (split view) o.scroller: an element that scrolls (a pane) instead of the window; setScroller() switches it
export function createAnchorKeeper(o) {
  let sc = o.scroller ?? null;
  const sY = () => (sc ? sc.scrollTop : scrollY);
  const by = (d) => (sc ? sc.scrollBy({ top: d, behavior: 'instant' }) : window.scrollBy({ top: d, behavior: 'instant' }));
  const sH = () => (sc ? sc.scrollHeight : document.documentElement.scrollHeight);
  const vTop = () => (sc ? sc.getBoundingClientRect().top : 0);
  const vH = () => (sc ? sc.clientHeight : innerHeight);
  const target = () => sc ?? window;
  const anchorEl = () => sc ?? document.documentElement;
  // a pane starts below the top bar: its own inset (a focus chip), else what its top scrolls under (the workbench's
  // glass strip, its scroll-padding-top)
  const ins = () => (sc ? (o.paneInset?.(sc) ?? (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0)) : (o.inset?.() ?? 0));
  // an anchor's y is from the top the reader reads from (below the bar or the glass strip), not the
  // window's: when that top moves (a second group's strip comes, the strip takes two lines) the text moves with it,
  // where a window y held it in place, now under the strip
  const top0 = () => vTop() + ins();
  const yOf = (el) => el.getBoundingClientRect().top - top0();
  let anchor = null, running = false, raf = 0, lastInput = -Infinity, lastUserScroll = -Infinity, gliding = 0;
  let expected = NaN;
  let lastH = -1, streak = 0, streakAt = 0, missed = false, syncQueued = false;    // layout seen last; corrections in a row                          // scrollY as the keeper left it: any other value = someone scrolled
  let rootAnchor = '';
  let reading = null;                   // the line read at the top, taken by a change (resume): until the reader scrolls
  let moves = 0;                        // the reader's input (a press, a key, a wheel) or the app's moved()
  const stats = { corrections: 0, px: 0, picks: 0, clamps: 0 };
  const now = () => performance.now();
  const active = () => now() - lastInput < ACTIVE_MS || now() - lastUserScroll < SCROLL_GAP_MS;
    const onInput = () => { lastInput = now(); anchor = null; moves++; wake(); };
  const onWheel = () => { moves++; wake(); };
  // a scroll the keeper did not make (the user, the app, a test's scrollIntoView): the reader is somewhere else now
  const scrolled = () => Math.abs(sY() - expected) > 0.5;
  // the browser's clamp: the page got shorter than the scroll (blocks near the end of the document
  // shrinking as their results land), so scrollY moved without anyone scrolling. Not the reader moving: the
  // anchor stays, and is put back as soon as the page is long enough again.
  const clamped = () => now() - lastInput >= ACTIVE_MS && sY() < expected && sY() >= sH() - vH() - 1;
  const onScroll = () => {
    wake();
    if (gliding || !scrolled()) return;
    if (clamped()) { expected = sY(); stats.clamps++; return; }
    lastUserScroll = now(); expected = sY(); reading = null;
    anchor = pick();                                     // where the reader is now: held once the scroll ends
  };
  function pick() {
    const list = o.list();
    if (!list) return null;
    const top = top0(), bottom = vTop() + vH();
    let across = null;
    for (const el of list.children) {
      if (el.offsetParent === null || !inFlow(el)) continue;   // hidden (a collapsed container's paragraph), or laid over others
      const r = el.getBoundingClientRect();
      if (r.bottom <= top) continue;
      if (r.top >= top - 2) { stats.picks++; return { el, y: r.top - top }; }
      across ??= { el, y: r.top - top };
      if (r.top > bottom) break;
    }
    if (across) stats.picks++;
    return across;
  }
  // o.lines (view/line-anchor.ts): a width change takes the reader's line, not a block's top (the block the
  // line is in re-breaks too): the caret's line in view, else the first line below the top. Held until the reader moves
  function linePick() {
    const list = o.list(), m = list && o.lines?.pick(list, top0(), vTop() + vH());
    const y = m && o.lines.y(m.mark);
    return y != null ? { el: m.el, y: y - top0(), line: m.mark } : null;
  }
  // the anchor's y now: its line's, else its element's top; null: its line is gone (the block typeset again)
  const anchorY = (a) => { if (!a.line) return yOf(a.el); const y = o.lines.y(a.line); return y == null ? null : y - top0(); };
  function hold(fromApp = false) {
    if (!running || gliding) return;
    if (scrolled()) { if (clamped()) { expected = sY(); stats.clamps++; } else { anchor = pick(); reading = null; expected = sY(); lastUserScroll = now(); } }
    if (active()) { missed = true; wake(); return; }             // a change while the reader acts: put back when they stop
    missed = false;
    if (!anchor || !anchor.el.isConnected) { anchor = pick(); expected = sY(); return; }
    const at = anchorY(anchor);
    if (at == null) { anchor = pick(); expected = sY(); return; }
    const d = at - anchor.y;
    if (Math.abs(d) < 0.5) { streak = 0; return; }
    // loop breaker: corrections that keep coming are the keeper feeding itself, not the page settling: let go
    // a correction the app asked for (sync: a result swapped in) is not the keeper feeding itself
    if (!fromApp) {
      const t = now();
      streak = t - streakAt < 1000 ? streak + 1 : 1; streakAt = t;
      if (streak > 8) { anchor = null; streak = 0; return; }
    }
    by(d);
    expected = sY();
    stats.corrections++; stats.px += Math.abs(d);
    // at the top or the end of the page nothing more can move: hold where it is now (a sub-pixel
    // rest is not a reason: it is measured against the same y next time)
    const max = sH() - vH();
    if ((d < 0 && sY() <= 0) || (d > 0 && sY() >= max - 1)) anchor = pick();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { hold(); wake(); }) : null;
  // the per-frame backstop corrects only when the page height changed: a still page is never scrolled. It runs while
  // there is something to see: wake() starts it, QUIET_FRAMES frames with no change and nothing put off stop it
  let quietFrames = 0, frames = 0;
  const tick = () => {
    raf = 0; frames++;
    const h = sH();
    if (h !== lastH || (missed && !active())) { lastH = h; hold(); quietFrames = 0; } else quietFrames++;
    if (running && (missed || quietFrames < QUIET_FRAMES)) raf = requestAnimationFrame(tick);
  };
  function wake() { quietFrames = 0; if (running && !raf) raf = requestAnimationFrame(tick); }
  // what the list's observer does not see changes the scroll height too (what is beside the list in the scroller)
  const others = () => [...(sc ? sc.children : document.body ? [document.body] : [])];
  // not 'wheel': a wheel is a scroll (its scroll events keep the keeper passive while it goes on); input
  // that is not a scroll (a press, a key) keeps it passive for ACTIVE_MS
  const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'touchmove'];
  return {
    start() {
      if (running) return;
      running = true;
      // the browser's own anchoring off while the keeper holds: every scroll that is not the keeper's is then
      // a real one (the user's or the app's), never an adjustment to tell apart from it
      rootAnchor = anchorEl().style.overflowAnchor;
      anchorEl().style.overflowAnchor = 'none';
      expected = sY();
      for (const t of EVENTS) window.addEventListener(t, onInput, { capture: true, passive: true });
      window.addEventListener('wheel', onWheel, { capture: true, passive: true });
      target().addEventListener('scroll', onScroll, { passive: true });
      const list = o.list();
      if (list && ro) ro.observe(list);
      if (ro) for (const el of others()) if (el !== list) ro.observe(el);
      anchor = null;
      wake();
    },
    stop() {
      running = false;
      anchorEl().style.overflowAnchor = rootAnchor;
      for (const t of EVENTS) window.removeEventListener(t, onInput, true);
      window.removeEventListener('wheel', onWheel, true);
      target().removeEventListener('scroll', onScroll);
      ro?.disconnect();
      cancelAnimationFrame(raf); raf = 0;
      anchor = null;
    },
    /** Bring el to the top of the view (just below the top bar: its scroll-margin-top) or the centre,
     *  re-aimed every frame at where el is now (blocks above may be changing height meanwhile),
     *  then held there like any anchor. Reduced motion: at once. Resolves when it has arrived. */
    reveal(el, { align = 'top' } = {}) {
      const want = () => vTop() + (align === 'center' ? Math.max(ins(), (vH() - el.getBoundingClientRect().height) / 2)
        : (sc ? ins() + 8 : (parseFloat(getComputedStyle(el).scrollMarginTop) || ins() + 8)));
      const off = () => el.getBoundingClientRect().top - want();
      const reduced = reducedMotion();
      const g = ++gliding;
      const done = () => { wake(); reading = null; if (gliding === g) gliding = 0; expected = sY(); lastUserScroll = -Infinity; lastInput = -Infinity; anchor = !el.isConnected ? null : inFlow(el) ? { el, y: yOf(el) } : pick(); stats.picks++; };   // hold where it arrived
      if (reduced) { by(off()); done(); return Promise.resolve(); }
      const t0 = now(), from = off();
      return new Promise((res) => {
        const step = () => {
          if (gliding !== g) { res(); return; }
          if (now() - lastInput < 50 && now() - t0 > 50) { gliding = 0; res(); return; }   // the user took over
          const t = Math.min(1, (now() - t0) / (GLIDE_MS * Math.min(2, Math.max(1, Math.abs(from) / 2000))));
          const ease = 1 - (1 - t) ** 3;
          // the part of the way still to go, measured again this frame
          const rest = off(), left = from * (1 - ease);
          by(rest - left);
          if (t >= 1) { done(); res(); return; }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    /** the app just changed a block's height in a task (a result swapped in): hold now, in the same task, so
     *  no rAF callback (the page's or a test's) sees the page before the ResizeObserver puts it back */
    sync() {
      // once per task: many views swapped in one task (a slice of lazy views, a re-break) each asked for a
      // hold, and each hold's scroll read forced a layout (the splitter drag: 113 ms of them). A microtask still runs
      // before any frame or rAF callback: nothing sees the page before it is put back
      if (syncQueued) return;
      syncQueued = true;
      queueMicrotask(() => { syncQueued = false; hold(true); wake(); });
    },
    /** the app scrolled to make up for a change of the page (appScroll's hold): the anchor stays, held from here */
    adjusted() { expected = sY(); wake(); },
    /** the app scrolled on the user's behalf without an input event of its own (e.g. a reveal from a timer) */
    moved() { lastUserScroll = now(); anchor = null; reading = null; moves++; wake(); },
    /** the app changes the pane's width now, answering a press that was not on the text (the sidebar button,
     *  the split's divider): hold the reader's place from here, as if no input had come, the anchor taken now */
    resume() {
      lastInput = -Infinity; lastUserScroll = -Infinity; missed = false; streak = 0;
      // the caret's line in view; else the line being read, kept from an earlier change until the reader scrolls (taken
      // again, the line at the top starts at another word after each re-break: a column opened and closed came back a
      // line off); else the line at the top now
      if (running && !gliding) {
        if (scrolled()) reading = null;
        const m = linePick();
        anchor = m?.line.kind === 'caret' ? m : reading && anchorY(reading) != null ? reading : (m ?? pick());
        if (anchor?.line?.kind === 'text') reading = anchor;
        expected = sY();
      }
      return anchor ? { ...anchor, moves } : null;
    },
    /** hold `mark` (what resume() returned before the change) where it was then: put back now, held from here */
    holdAt(mark) {
      if (!running || gliding || !mark?.el?.isConnected || !inFlow(mark.el)) return;
      if (mark.moves !== moves) return;      // scrolled since (the reader, or the app placing the page: close-split): theirs stands
      lastInput = -Infinity; lastUserScroll = -Infinity; missed = false; streak = 0;
      if (scrolled()) expected = sY();
      anchor = { el: mark.el, y: mark.y, line: mark.line };
      hold(true); wake();
    },
    /** the app has put the page in its final place and slides the blocks there by transforms until
     *  `done` settles: no correction meanwhile (a block's rect includes its transform), then held where it is.
     *  A glide (reveal) going on ends. */
    quiet(done) {
      const g = ++gliding;
      const end = () => { if (gliding !== g) return; gliding = 0; reading = null; expected = sY(); lastUserScroll = -Infinity; anchor = running ? pick() : null; wake(); };
      // taken in the next frame: the reads (the scroll, the anchor's rect) then use the layout the frame
      // makes anyway. A motion with nothing to move settles at once, and its reads in the press's own task forced a
      // layout of the whole pane after the open's writes (23 ms in a tall block's press)
      const later = () => requestAnimationFrame(end);
      Promise.resolve(done).then(later, later);
    },
    /** (split view) scroll this element instead of the window from now on (null: the window again) */
    setScroller(el) { const was = running; if (was) this.stop(); sc = el ?? null; if (was) this.start(); },
    get scroller() { return sc; },
    /** frames the backstop ran, and whether it runs now */
    stats: () => ({ ...stats, frames, ticking: !!raf, anchor: anchor ? { id: anchor.el.dataset?.id ?? null, y: anchor.y, line: anchor.line?.kind ?? null } : null }),
  };
}
