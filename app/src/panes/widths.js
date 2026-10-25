// the preview's width changes (the split on and off, a pane closed, the split dragged, the sidebar) without
// re-breaking the whole document. The viewer re-breaks every block whose element changes width, all in one frame
// (a long paper: about 200 blocks a pane, 100–550 ms a frame). So the panes' blocks are PINNED during the change: each
// viewer element (`.blk-render > .latex-block`) keeps its width (an inline style), its lines and its height; the
// column moves and resizes around it. Where the text sits meanwhile: centred in its pane while the pane has room for
// it (a pinned block narrower than its render is centred in it: app.css), its left edge kept once the pane is narrower
// (it starts at the render's left edge and is clipped at its right one, with a soft fade); under the workbench's lock
// (hold({ locked })) the pane's host is placed in its group by the same rule (app/wb/css.ts lockedLeft). So the lines
// re-broken at the end start where the text was: about the same centre, or at the same left edge.
// Then only what the reader sees is re-broken at the new width, and the rest lazily:
//
//   - an animated change (transition): pinned for the motion, then ONE task re-breaks the blocks in view, the old
//     lines cross-fading into the new ones (120 ms); reduced motion: no fade, the same single re-break;
//   - a live drag (begin, frame, end): each frame re-breaks the blocks in view nearest the reader's place first,
//     within a budget (8 ms), the rest the next frame; nothing out of view is touched;
//   - out of view: re-broken in idle time, a slice of at most BUDGET_MS at a time, the blocks coming near the
//     viewport first (an IntersectionObserver a viewport ahead). Each keeps its old height meanwhile (its render's,
//     clipped: .rtx-w-tall), so the page's height does not change slice by slice (the scrollbar flickered for a second
//     or two in a long document, and the keeper corrected the scroll after each slice); the last
//     slice lets them all go in one write (one change of the scroll height, one correction by the panes' anchor keepers,
//     perf/anchor.js); one the reader comes near (it enters the observer's margin) goes at once.
//
// A re-break is the viewer's own layout at the element's new width (view/viewer-host.ts relayout: Block.relayout), run at once in
// our task, so its ResizeObserver then finds nothing to do. The width a block would have is read from its render
// (the column: never pinned), so finding which blocks changed costs one layout read, no writes. Fitted blocks
// are never pinned: their editor lays them out. A block being edited is held like the others (its lines, and so its
// mirrored caret, stay as they are while a column slides; it re-breaks once at the end: it was laid out mid-slide and
// again at the end before).
//
// Two more changes go the same way:
//
//   - a window resize: the window's 'resize' event comes in the frame the new viewport first applies, before the
//     viewer's ResizeObserver sees the blocks at their new widths. So the blocks are pinned there, at the width the
//     viewer last laid each out at (its lastWidth: no layout read before the pins); the browser then lays the page out
//     with the blocks as they were, the observer finds nothing, and the change ends once no resize came for two frames (and 120 ms)
//     and the shell's motion (a sidebar closing at a breakpoint) is over: then settled as above, cross-faded;
//   - the justification switch (view/index.js): every block needs a new layout, its width unchanged: each is marked
//     (nothing pinned), and settled the same way: those in view first within the budget, the rest in idle slices.
//
//   const widths = createWidths({ panes: () => Pane[], relayout(el), laidAt?(el) -> { widthPt, align } | null, reduced?() })
//   widths.pin(paneList?)                  pin every shown block in those panes (default: all) at its width now
//   widths.resized()                       (the window's resize listener; also for tests) a window resize step
//   widths.restyle() -> Promise            every shown block laid out again (the justification switch), lazily
//   widths.settle({ fade }) -> Promise     the pinned blocks in view re-broken, a frame budget at a time, the rest lazily
//   widths.transition(change, { animate, motion }) -> Promise
//                                          pin, change() (the DOM change; a promise: waited for too), wait for its motion
//                                          (motion(): a promise, or the CSS transitions it started), settle
//   widths.begin() · widths.frame() · widths.end()     a live drag
//   widths.hold({ locked }) · widths.release() -> Promise a motion held: no re-break until released, then once;
//                                          locked: the workbench keeps the hosts' widths for the motion (its lockHosts):
//                                          nothing pinned until the release (it was every block, at the start: 50-60 ms)
//   widths.idle() -> Promise               resolved when nothing is pinned · widths.pinned (count) · widths.moving
//   widths.stats() · widths.resetStats()   { pinned, rebroken, lazy, ghosts, frames: [{ n, ms, visible, left }], slices, pins }
//   widths.dispose()
//   'editor:widths' (document event, detail { moving }): a change of the panes' widths is under way / over. While
//   it is, what follows the column (view/index.js: each pane's --col) waits for the end; the re-break comes a frame
//   after it (a transition's and a hold's alike).
//   const widths = createWidths({ panes: () => Pane[], relayout(el), laidAt?(el) -> { widthPt, align } | null, reduced?(), state? })
//     state: the container's signals (app/page-state.ts): state.widths says when the widths are moving
import { idle, cancelIdle } from '../perf/idle.ts';

const BUDGET_MS = 8, FADE_MS = 120, HEAVY_MS = 2 * BUDGET_MS;
const PX_PER_PT = 2;                 // the viewer lays a block out at clientWidth / 2 pt
const QUIET_FRAMES = 2, QUIET_MS = 120;   // a window resize is over when no resize event came for this many frames
                                     // and this long (a frame dropped under load is not a pause: no re-break mid-drag)
const SKIP = !/[?&]wskip=0/.test(location.search);   // (dev: ?wskip=0 compares without the skipping)
const FAR = Number(/[?&]wfar=([\d.]+)/.exec(location.search)?.[1] ?? 1);   // (dev) how many views away a block is far
const STEP_MS = Number(/[?&]wstep=([\d.]+)/.exec(location.search)?.[1] ?? BUDGET_MS);   // (dev) a settle's budget a frame (tests: the
                                     // blocks in view in one task, as a fast machine does them)
const SEL = ':scope > .blk:not(.rtx-fit) > .blk-main > .blk-render:not([hidden]) > .latex-block:not(.incoming):not(.rtx-w-ghost)';
const now = () => performance.now();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const ric = (fn) => idle(fn, { timeout: 250, budget: BUDGET_MS });
const cancelRic = cancelIdle;

/** @param {{ panes: () => object[], relayout: (el: Element) => unknown, laidAt?: ((el: Element) => { widthPt: number, align: string } | null) | null, reduced?: () => boolean, state?: { widths: { value: { moving: boolean } } } | null }} o */
export function createWidths({ panes, relayout, laidAt = null, state = null, reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches }) {
  // viewer element -> { pane, px (its CSS width), zoom, render, blk, near, held (its width set inline), cached (px from
  // the viewer's last layout: a block the viewer would leave alone within half a px), force (laid out again whatever
  // its width: the alignment changed) }
  const pinned = new Map();
  let idleH = 0, dragging = false, raf = 0, waiters = [], disposed = false, moving = 0, held = 0;   // held: transitions and settles not done yet
  let gen = 0;                       // changes begun: a settle stops when a newer one begins
  let holds = 0;                     // motions of the widths under way (hold, release)
  const st = { rebroken: 0, lazy: 0, ghosts: 0, frames: [], slices: [], pins: [] };
  const cost = new WeakMap();        // viewer element -> its last re-break, ms (a drag leaves the heavy ones to its end)
  let nextH = 0;                     // the frame after a slice or a settle's last step: one batch of re-breaks a frame
  const ios = new Map();             // pane -> IntersectionObserver (a viewport ahead of its box)
  const keep = (a, n) => { if (a.length > n) a.splice(0, a.length - n); };
  const tall = new Map();            // render -> pane: re-broken out of view, its old height kept until the last slice

  const paneOf = (p) => (typeof p === 'string' ? panes().find((x) => x.id === p) : p);
  const els = (p) => [...(p.view.container?.querySelectorAll(SEL) ?? [])];

  /** the pane's observer, made again when its scroller changed (the split on and off) with every pinned block of it */
  function watch(p) {
    let io = ios.get(p);
    const root = p.scroller ?? null;
    if (io && io.root === root) return io;
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      let any = false;
      for (const e of entries) {
        const render = e.target.querySelector(':scope > .blk-main > .blk-render');
        if (e.isIntersecting && render && tall.has(render)) letHeights([render]);
        const el = render?.querySelector(':scope > .latex-block:not(.rtx-w-ghost)');
        const rec = el && pinned.get(el);
        if (rec) { rec.near = e.isIntersecting; any ||= e.isIntersecting; }
      }
      if (any) schedule();
    }, { root, rootMargin: '100% 0px' });
    ios.set(p, io);
    for (const rec of pinned.values()) if (rec.pane === p) io.observe(rec.blk);
    for (const [render, q] of tall) if (q === p) { const b = render.closest('.blk'); if (b) io.observe(b); }
    return io;
  }

  /** pin every shown block of these panes at the width it has now: one read pass, then one write pass */
  function pin(list = panes()) {
    // a pane gone: its observer goes with it (it held the pane's detached blocks)
    const live = panes();
    for (const [p, io] of ios) if (!live.includes(p)) { io.disconnect(); ios.delete(p); }
    const todo = [];
    for (const p0 of list) {
      const p = paneOf(p0);
      if (!p) continue;
      for (const el of els(p)) if (!pinned.has(el)) todo.push({ el, p });
    }
    const cs = todo.map(({ el, p }) => {
      if (el.offsetParent === null) return null;
      const s = getComputedStyle(el), r = el.getBoundingClientRect(), b = p.box(), m = (b.bottom - b.top) * FAR;
      return { w: s.width, h: s.height, zoom: parseFloat(s.zoom) || 1, far: r.bottom < b.top - m || r.top > b.bottom + m };
    });
    let n = 0;
    todo.forEach(({ el, p }, i) => {
      const c = cs[i];
      if (!c || !c.w || c.w === 'auto' || parseFloat(c.w) <= 0) return;
      el.style.width = c.w;
      // out of view (more than a view away): the browser skips its style, layout and paint while it stays there
      // (content-visibility, at the size it has): a change of the panes restyles and lays out what is seen only
      if (SKIP && c.far) { el.style.containIntrinsicSize = `${c.w} ${c.h}`; el.classList.add('rtx-w-skip'); }
      const render = el.parentElement;
      render.classList.add('rtx-w-pin');
      const rec = { pane: p, px: parseFloat(c.w), zoom: c.zoom, render, blk: render.closest('.blk'), near: false, held: true, cached: false, force: false };
      pinned.set(el, rec);
      if (rec.blk) watch(p).observe(rec.blk);
      n++;
    });
    return n;
  }

  /** (window resize) pin every shown block at the width the viewer last laid it out at: written first, with no layout
   *  read (the page is at the new viewport already: a read would lay it out unpinned), then one read pass (zoom, how
   *  far away), then the far ones skipped. A block already marked (restyle) gets its width held too. */
  function pinCached(list = panes()) {
    const t0 = now();
    const todo = [];
    for (const p0 of list) {
      const p = paneOf(p0);
      if (!p) continue;
      for (const el of els(p)) {
        const rec = pinned.get(el);
        if (rec?.held) continue;
        const at = laidAt?.(el);
        if (!at) continue;
        const px = at.widthPt * PX_PER_PT;
        el.style.width = `${px}px`;
        todo.push({ el, p, px, rec });
      }
    }
    const cs = todo.map(({ el, p }) => {
      const r = el.getBoundingClientRect(), b = p.box(), m = (b.bottom - b.top) * FAR;
      return { zoom: parseFloat(getComputedStyle(el).zoom) || 1, h: r.height, far: r.height > 0 && (r.bottom < b.top - m || r.top > b.bottom + m) };
    });
    todo.forEach(({ el, p, px, rec: was }, i) => {
      const c = cs[i];
      if (SKIP && c.far) { el.style.containIntrinsicSize = `${px}px ${c.h / c.zoom}px`; el.classList.add('rtx-w-skip'); }
      if (was) { Object.assign(was, { px, zoom: c.zoom, held: true, cached: true }); return; }
      const render = el.parentElement;
      render.classList.add('rtx-w-pin');
      const rec = { pane: p, px, zoom: c.zoom, render, blk: render.closest('.blk'), near: false, held: true, cached: true, force: false };
      pinned.set(el, rec);
      if (rec.blk) watch(p).observe(rec.blk);
    });
    st.pins.push({ n: todo.length, ms: Math.round(now() - t0) });
    keep(st.pins, 50);
    return todo.length;
  }

  /** (the justification switch) every shown block marked to be laid out again, its width left as it is */
  function mark(list = panes()) {
    let n = 0;
    for (const p0 of list) {
      const p = paneOf(p0);
      if (!p) continue;
      for (const el of els(p)) {
        const was = pinned.get(el);
        if (was) { was.force = true; continue; }
        const render = el.parentElement;
        const rec = { pane: p, px: NaN, zoom: 1, render, blk: render.closest('.blk'), near: false, held: false, cached: false, force: true };
        pinned.set(el, rec);
        if (rec.blk) watch(p).observe(rec.blk);
        n++;
      }
    }
    return n;
  }

  function unpin(el, rec = pinned.get(el)) {
    if (!rec) return;
    pinned.delete(el);
    if (rec.held) el.style.width = '';
    if (el.classList.contains('rtx-w-skip')) { el.classList.remove('rtx-w-skip'); el.style.containIntrinsicSize = ''; }
    if (!rec.render.querySelector(':scope > .rtx-w-ghost')) rec.render.classList.remove('rtx-w-pin', 'rtx-w-over');
    if (rec.blk && !tall.has(rec.render)) ios.get(rec.pane)?.unobserve(rec.blk);
  }

  /** the old heights kept by the idle slices let go (all of them: the last slice; one: near the viewport), in one
   *  write; the keepers then correct once */
  function letHeights(list = [...tall.keys()]) {
    const touched = new Set();
    for (const render of list) {
      const p = tall.get(render);
      if (!p) continue;
      tall.delete(render);
      render.style.height = '';
      render.classList.remove('rtx-w-tall');
      const b = render.closest('.blk');
      if (b && ![...pinned.values()].some((r) => r.blk === b)) ios.get(p)?.unobserve(b);
      touched.add(p);
    }
    for (const p of touched) p.keeper?.sync?.();
  }

  /** the block re-broken at its column's width now (the viewer's layout, in this task) */
  function rebreak(el, rec) {
    unpin(el, rec);
    if (!el.isConnected) return false;
    timed(el);
    st.rebroken++;
    return true;
  }
  function timed(el) { const t = now(); relayout(el); cost.set(el, now() - t); }

  /** one read pass over the pinned blocks: where each is, the width it would have now (its render's), whether it is
   *  in its pane's box and wider than its column; the gone ones dropped */
  function survey() {
    const out = [];
    for (const [el, rec] of [...pinned]) {
      if (!el.isConnected || !rec.render.isConnected) { unpin(el, rec); continue; }
      const r = rec.render.getBoundingClientRect(), b = rec.pane.box();
      const want = r.width / rec.zoom;
      // the same: let go as it is (a width the viewer laid out at itself: within the half px its clientWidth rounds)
      const same = !rec.force && (!rec.held || Math.abs(want - rec.px) < (rec.cached ? 0.45 : 0.05));
      out.push({ el, rec, want, same, vis: r.height > 0 && r.bottom > b.top && r.top < b.bottom,
        d: Math.abs(r.top - b.top), over: rec.held && rec.px > want + 0.5, top: el.offsetTop, left: el.offsetLeft });
    }
    return out;
  }
  /** the soft edge where a pinned block is wider than its column now (a narrowing pane) */
  function edges(s = survey()) { for (const x of s) if (x.vis) x.rec.render.classList.toggle('rtx-w-over', x.over); return s; }
  /** every frame while a motion runs: the edges follow the column */
  function edgesWhile(promise) {
    let on = true;
    const f = () => { if (!on) return; edges(); requestAnimationFrame(f); };
    requestAnimationFrame(f);
    return Promise.resolve(promise).finally(() => { on = false; });
  }

  /** the old lines laid over the block while the new ones fade in (a cross-fade) */
  function ghost(x) {
    const g = x.el.cloneNode(true);
    g.classList.add('rtx-w-ghost');
    g.setAttribute('aria-hidden', 'true');
    g.inert = true;
    for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
    g.style.cssText += `;position:absolute;left:${x.left}px;top:${x.top}px;width:${x.rec.held ? x.rec.px : x.want}px;pointer-events:none;margin:0`;
    x.rec.render.append(g);
    st.ghosts++;
    return g;
  }

  /** the pinned blocks in view re-broken now, nearest the reader's place first (faded: the old lines cross-fade into
   *  the new), as many as fit in a frame's budget, the others in the next frames; the ones whose width did not change
   *  let go as they are; the rest (out of view) lazily. Resolves when those in view are done. */
  function settle({ fade = false } = {}) {
    if (disposed) return Promise.resolve();
    const s = survey();
    for (const x of s) if (x.same) unpin(x.el, x.rec);
    const vis = s.filter((x) => !x.same && x.vis).sort((a, b) => a.d - b.d);
    for (const x of vis) x.rec.render.classList.toggle('rtx-w-over', x.over);
    const fading = fade && !reduced();
    const g = gen;
    held++;
    return new Promise((res) => {
      const step = () => {
        if (g !== gen) { held--; res(); return; }   // a newer change: its settle re-breaks what is left
        const t0 = now();
        const touched = new Set();
        let n = 0;
        while (vis.length && (!n || now() - t0 < STEP_MS)) {
          const x = vis.shift();
          if (!pinned.has(x.el) || !x.el.isConnected) continue;
          const g = fading ? ghost(x) : null;
          if (rebreak(x.el, x.rec)) { touched.add(x.rec.pane); n++; }
          if (g) fadeOver(x, g);
        }
        for (const p of touched) p.keeper?.sync?.();
        st.frames.push({ n, ms: Math.round(now() - t0), visible: n + vis.length, left: vis.length, settle: true });
        keep(st.frames, 600);
        if (vis.length && !disposed) { requestAnimationFrame(step); return; }
        held--;
        nextFrameSchedule();                  // the lazy slices from the next frame on (in this frame's idle time, a slice
        res();                                // doubled the re-breaks of the frame that re-broke the blocks in view)
      };
      step();
    });
  }
  function fadeOver(x, g) {
    const o = { duration: FADE_MS, easing: 'ease-out' };
    x.el.animate([{ opacity: 0 }, { opacity: 1 }], o);
    g.animate([{ opacity: 1 }, { opacity: 0 }], o).finished.catch(() => {}).then(() => {
      g.remove();
      if (![...pinned.values()].some((r) => r.render === x.rec.render)) x.rec.render.classList.remove('rtx-w-pin', 'rtx-w-over');
    });
  }

  // ── out of view: re-broken in idle slices, the ones near the viewport first ──
  function schedule() {
    if (idleH || nextH || dragging || held || disposed) return;
    if (!pinned.size) { done(); return; }
    idleH = ric(slice);
  }
  function slice(deadline) {
    idleH = 0;
    if (dragging || held || disposed) return;
    const t0 = now();
    const budget = Math.min(BUDGET_MS, Math.max(2, deadline?.timeRemaining?.() ?? BUDGET_MS));
    const order = [...pinned].sort((a, b) => b[1].near - a[1].near);
    // no more than the blocks in view now, counted here: at a settle's end the keepers had not put the page back yet
    // (their hold is a microtask), and the viewer's own slices change heights after it
    const shown = countShown();
    // the heights first (one read pass: as many as the slice can take), then the re-breaks: one out of view keeps its
    // height (its render's) until the last slice
    const hs = order.slice(0, shown).map(([, rec]) => (tall.has(rec.render) ? 0 : rec.render.getBoundingClientRect().height));
    const touched = new Set();
    let n = 0;
    for (const [i, [el, rec]] of order.entries()) {
      if (n && (now() - t0 >= budget || n >= shown)) break;
      if (hs[i] > 0) { rec.render.style.height = `${hs[i]}px`; rec.render.classList.add('rtx-w-tall'); tall.set(rec.render, rec.pane); }
      if (rebreak(el, rec)) { touched.add(rec.pane); n++; st.lazy++; }
    }
    for (const p of touched) p.keeper?.sync?.();
    st.slices.push({ n, ms: Math.round(now() - t0) });
    keep(st.slices, 400);
    nextFrameSchedule();
  }
  function nextFrameSchedule() { if (!nextH && !disposed) nextH = requestAnimationFrame(() => { nextH = 0; schedule(); }); }
  // nothing pinned or held tall any more: the observers go too (each held its pane and the blocks it watched: a pane
  // closed after its change kept its detached blocks alive until the next pin); the next change makes them again
  function done() {
    letHeights();
    for (const io of ios.values()) io.disconnect();
    ios.clear();
    for (const fn of waiters.splice(0)) fn();
  }
  /** the typeset blocks in view in every pane now (after the re-breaks: a narrower column holds fewer), at least 1; a
   *  block in view as survey() has it: its render's box in the pane's (a render held at its old height clips its block) */
  function countShown() {
    let n = 0;
    for (const p of panes()) {
      const b = p.box();
      for (const el of p.view.container?.querySelectorAll(':scope > .blk > .blk-main > .blk-render > .latex-block:not(.rtx-w-ghost)') ?? []) {
        const r = el.parentElement.getBoundingClientRect();
        if (r.height > 0 && r.bottom > b.top && r.top < b.bottom) n++;
      }
    }
    return Math.max(1, n);
  }

  // ── a live drag: the blocks in view, the reader's place first, within the frame's budget ──
  function frame() {
    if (!dragging || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!dragging) return;
      pin();                                    // results landed meanwhile: their new elements too
      const t0 = now();
      const s = survey();
      const vis = s.filter((x) => x.vis && !x.same).sort((a, b) => a.d - b.d);
      const touched = new Set();
      let n = 0, left = 0, heavy = 0;
      for (const x of vis) {
        // a block whose re-break alone is over two frames' budget keeps its lines (clipped, faded) until the drag ends
        if ((cost.get(x.el) ?? 0) > HEAVY_MS) { heavy++; continue; }
        if (n && now() - t0 >= BUDGET_MS) { left++; continue; }
        x.el.style.width = `${x.want}px`;
        if (x.el.classList.contains('rtx-w-skip')) { x.el.classList.remove('rtx-w-skip'); x.el.style.containIntrinsicSize = ''; }
        Object.assign(x.rec, { px: x.want, held: true, cached: false, force: false });
        timed(x.el);
        st.rebroken++; n++;
        touched.add(x.rec.pane);
      }
      for (const p of touched) p.keeper?.sync?.();
      for (const x of s) if (x.vis) x.rec.render.classList.toggle('rtx-w-over', x.rec.held && x.rec.px > x.want + 0.5);   // the ones left for the next frame
      st.frames.push({ n, ms: Math.round(now() - t0), visible: s.filter((x) => x.vis).length, left, heavy });
      keep(st.frames, 600);
      if (left) frame();
    });
  }

  let lockedHolds = 0;
  const emit = (on) => {
    const was = moving > 0;
    moving = Math.max(0, moving + (on ? 1 : -1));
    if (was !== moving > 0 && state) state.widths.value = { moving: moving > 0 };   // the container's signal (app/page-state.ts)
  };

  // ── a window resize: pinned in the resize event, at the viewer's widths; settled once it is over ──
  let lastW = innerWidth, resizes = 0, waiting = false;
  /** frames until no resize event came for QUIET_FRAMES of them */
  function quiet() {
    return new Promise((res) => {
      let seen = resizes, n = 0, at = now();
      const f = () => {
        if (disposed) { res(); return; }
        if (resizes !== seen) { seen = resizes; n = 0; at = now(); } else n++;
        if (n >= QUIET_FRAMES && now() - at >= QUIET_MS) res(); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  }
  function resized() {
    if (disposed || !laidAt) return;
    const w = innerWidth;
    if (w === lastW && !waiting) return;     // the height only: no block changes width
    lastW = w;
    resizes++;
    if (waiting) { pinCached(); return; }   // still under way: results landed meanwhile pinned too
    waiting = true;
    transition(() => {}, {
      animate: true, cached: true, always: true,
      motion: async () => { try { await quiet(); await settledMotion(); } finally { waiting = false; } },
    }).catch(() => {});
  }
  addEventListener('resize', resized);

  /** @param {() => unknown} change @param {{ animate?: boolean, motion?: (() => Promise<unknown>) | null, cached?: boolean, always?: boolean }} [o] */
  async function transition(change, { animate = true, motion = null, cached = false, always = false } = {}) {
    // each pane's reading point now: put back where it is at the end (the change may move it a fraction: a scroll
    // offset rounded, a scroller switched), then held by the keeper while the blocks re-break. A window resize: no
    // press started it, so the keepers' anchors from before stand (the new viewport's layout has moved the page
    // already: a reading point taken now would keep that move); its blocks pinned first, before any layout read.
    let marks = [];
    if (cached) pinCached();
    else { marks = panes().map((p) => ({ p, m: p.keeper?.resume?.() ?? null })); pin(); }
    emit(true);
    held++;
    gen++;                                    // a settle under way stops: this one's settle takes its blocks over
    if (idleH) { cancelRic(idleH); idleH = 0; }
    let r, err = null;
    try {
      r = change();
      // (always: the motion is the change itself going on, waited for under reduced motion too)
      if (always && motion) await (animate && !reduced() ? edgesWhile(motion()) : motion());
      else if (animate && !reduced()) await edgesWhile(motion ? motion() : settledMotion());
      if (typeof r?.then === 'function') r = await r;   // a change finished in a later task (split on: pane B's shells)
    } catch (e) { err = e; }
    emit(false);                              // the column's own settings applied now, before the blocks re-break
    // the re-break in the next frame's task: the column's settings (a restyle, a layout) and the re-break are two
    // tasks, neither long
    await nextFrame();
    held--;
    if (!cached) for (const p of panes()) p.keeper?.resume?.();
    for (const { p, m } of marks) if (m && panes().includes(p) && p.contains(m.el)) p.keeper?.holdAt?.(m);
    pin();                                    // a pane opened by the change: its views too
    await settle({ fade: animate });
    if (err) throw err;
    return r;
  }

  const api = {
    pin, settle, transition, resized,
    get moving() { return moving > 0; },
    /** (the justification switch) every shown block laid out again: those in view nearest the reader
     *  first, a frame's budget at a time, cross-faded; the rest in idle slices. Resolves when those in view are done. */
    restyle() {
      if (disposed) return Promise.resolve();
      for (const p of panes()) p.keeper?.resume?.();
      gen++;
      if (idleH) { cancelRic(idleH); idleH = 0; }
      mark();
      return settle({ fade: true });
    },
    begin() {
      if (dragging) return;
      dragging = true;
      emit(true);
      if (idleH) { cancelRic(idleH); idleH = 0; }
      for (const p of panes()) p.keeper?.resume?.();
      pin();
    },
    frame,
    /** a motion of the panes' widths (the workbench's resizestart: a column sliding open or closed, a splitter
     *  or a column's edge dragged): every shown block pinned at its width, its lines kept; nothing re-broken until the
     *  last hold is released (holds nest: two columns moving at once) */
    hold({ locked = false } = {}) {
      // pinned at the width the viewer last laid each block out at, written before any layout read: a column
      // showing has its room in the DOM already when resizestart comes (a read now would see the new widths). Under the
      // workbench's lock nothing changes width until the release: pinned then (release), not now
      if (locked) lockedHolds++; else pinCached();
      if (holds++) return;
      gen++;                                    // a settle under way stops: the release's settle takes its blocks over
      // (no idle slices meanwhile; nothing calls frame(): nothing re-broken). Still dragging: a release's end() not run yet
      // (a column toggled again mid-slide): that motion goes on, counted once (its end() was skipped: moving stayed on)
      if (!dragging) { dragging = true; emit(true); }
      if (idleH) { cancelRic(idleH); idleH = 0; }
      for (const p of panes()) p.keeper?.resume?.();   // the reading point, at the lines as they are (pinned now)
    },
    /** the motion over (resizeend): each pane reflows once at its new width, the blocks in view now (no fade: the
     *  lines change in one frame), the rest lazily; the reading point held by the panes' keepers */
    release() {
      if (!holds || --holds) return undefined;
      // (a locked motion) the hosts' widths are released after this returns (the workbench's resizeend): the blocks are
      // pinned at the widths the viewer laid them out at, before the new ones can reach them
      if (lockedHolds) { lockedHolds = 0; pinCached(); }
      // in the next frame's task: the drop's own work (the workbench's sizes, its effects) and the reflow are two
      // tasks, neither long (a splitter's drop was one task of 146 ms); a hold begun meanwhile keeps it
      const g = gen;
      return nextFrame().then(() => (holds || g !== gen || disposed ? undefined : api.end()));
    },
    end() {
      if (!dragging) return;
      dragging = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      emit(false);                              // the column's settings applied now (view/index.js), the blocks still pinned
      // the re-break in the next frame's task, as a transition's: the column's restyle and layout, and the re-break, are
      // two tasks, neither long (one task of 57-71 ms at the end of a side column's slide in a long document); a change
      // begun meanwhile settles them itself
      const g = gen;
      held++;
      return nextFrame().then(() => {
        held--;
        if (g === gen && !dragging && !disposed) return settle({ fade: false });
        schedule();
        return undefined;
      });
    },
    idle: () => (pinned.size || idleH || nextH || dragging || held ? new Promise((r) => waiters.push(r)) : Promise.resolve()),
    get pinned() { return pinned.size; },
    stats: () => ({ pinned: pinned.size, rebroken: st.rebroken, lazy: st.lazy, ghosts: st.ghosts, frames: [...st.frames], slices: [...st.slices], pins: [...st.pins] }),
    resetStats() { st.rebroken = st.lazy = st.ghosts = 0; st.frames.length = 0; st.slices.length = 0; st.pins.length = 0; },
    dispose() {
      disposed = true;
      if (idleH) cancelRic(idleH);
      if (raf) cancelAnimationFrame(raf);
      if (nextH) cancelAnimationFrame(nextH);
      removeEventListener('resize', resized);
      letHeights();
      for (const [el, rec] of [...pinned]) unpin(el, rec);
      for (const io of ios.values()) io.disconnect();
      ios.clear();
      done();
    },
  };
  return api;
}

/** the CSS transitions and animations running on the page's frame (the sidebar, the shell) once started: the next
 *  two frames, then until they finish */
async function settledMotion() {
  await nextFrame(); await nextFrame();
  const anims = (document.getAnimations?.() ?? []).filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().endTime !== Infinity
    && a.effect?.target?.closest?.('.shell, .sidebar, [data-part="view"], .split-chrome'));
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
}
