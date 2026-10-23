// a pane opened (the split on) makes its views of the results lazily, the blocks in view first (in the
// slices right after the opening task: the pane fades in meanwhile), then the ones near its viewport, then the rest.
// Making all of them at once (the former sample paper: 195 viewer views, each decoded and laid out) was one task of
// 450–600 ms. A view that waits keeps the height the same block has in the first pane (a reserved min-height), so
// the pane's scroll geometry is right from the first frame; it is made when it comes near the pane's viewport (an
// IntersectionObserver a viewport ahead) or in idle time, a few per slice within a budget, near ones first. Its
// height then changes to its own (the pane's anchor keeper holds the reading point).
//
//   const lazy = createLazyViews({ ensure(id) })
//   lazy.open(pane, near: Set<block id>, heights: Map<block id, px>)
//                                          from now, `pane`'s views wait (defer), those in `near` (in view) first, each with
//                                          the height its block has in the first pane (read in one pass before)
//   lazy.defer(v) -> true when view v is to wait (its block's ensureViews skips it; it is reserved and queued)
//   lazy.waiting -> count · lazy.idle() -> Promise · lazy.stats() · lazy.dispose()
import { idle, cancelIdle } from '../perf/idle.ts';
const BUDGET_MS = 8, MAX_PER_SLICE = 6;
const now = () => performance.now();
const ric = (fn) => idle(fn, { timeout: 200, budget: BUDGET_MS });
const cancelRic = cancelIdle;

export function createLazyViews({ ensure }) {
  const lazyPanes = new Map();     // pane id -> { pane, near: Set(ids in view at the opening), io, heights }
  const queue = new Map();         // view -> { near: 2 in view at the opening, 1 near the viewport now, 0 }
  const byRoot = new WeakMap();    // a view's root -> the view
  let idleH = 0, waiters = [], urgent = false, nextH = 0;   // nextH: the frame after a slice (one slice a frame)
  const st = { deferred: 0, made: 0, slices: [] };

  function open(pane, near = new Set(), heights = new Map()) {
    const io = new IntersectionObserver((entries) => {
      let any = false;
      for (const e of entries) {
        const v = byRoot.get(e.target), q = v && queue.get(v);
        if (q && q.near < 2) { q.near = e.isIntersecting ? 1 : 0; any ||= e.isIntersecting; }
      }
      if (any) schedule();
    }, { root: pane.scroller ?? pane.el, rootMargin: '100% 0px' });
    lazyPanes.set(pane.id, { pane, near, io, heights });
    pane.onDispose?.(() => drop(pane.id));
  }
  function drop(pid) {
    const l = lazyPanes.get(pid);
    if (!l) return;
    l.io.disconnect();
    lazyPanes.delete(pid);
    for (const v of [...queue.keys()]) if (v.pane === pid) { queue.delete(v); v.root.classList.remove('rtx-lazy'); }
    if (!queue.size) done();
  }

  function defer(v) {
    const l = lazyPanes.get(v.pane);
    if (!l || v.disposed) return false;
    if (queue.has(v)) return true;
    if (v.woken) return false;
    queue.set(v, { near: l.near.has(v.id) ? 2 : 0 });
    const h = l.heights.get(v.id) ?? 0;
    if (h > 0) { v.root.style.minHeight = `${h}px`; v.held = true; v.keepHeld = true; }   // released when its view lands (blocks.js)
    // until it is made, the browser skips its style, layout and paint while it is out of view (a pane of 195 new
    // blocks restyled and laid out at once otherwise)
    v.root.classList.add('rtx-lazy');
    byRoot.set(v.root, v);
    l.io.observe(v.root);
    st.deferred++;
    schedule();
    return true;
  }

  function schedule() {
    if (idleH || nextH) return;
    if (!queue.size) { done(); return; }
    // the views in view at the opening: the next task (the pane is fading in); the rest in idle time
    if ([...queue.values()].some((q) => q.near === 2)) { idleH = setTimeout(() => slice(null), 0); urgent = true; }
    else { idleH = ric(slice); urgent = false; }
  }
  function slice(deadline) {
    idleH = 0;
    const t0 = now();
    const budget = Math.min(BUDGET_MS, Math.max(2, deadline?.timeRemaining?.() ?? BUDGET_MS));
    const order = [...queue].sort((a, b) => b[1].near - a[1].near);
    let n = 0;
    for (const [v] of order) {
      if (n >= MAX_PER_SLICE || (n && now() - t0 >= budget)) break;
      queue.delete(v);
      lazyPanes.get(v.pane)?.io.unobserve(v.root);
      if (v.disposed) continue;
      v.woken = true;
      v.root.classList.remove('rtx-lazy');
      ensure(v.id);
      n++; st.made++;
    }
    st.slices.push({ n, ms: Math.round(now() - t0) });
    if (st.slices.length > 400) st.slices.splice(0, 200);
    // the pane's views are all made: it is an ordinary pane from now
    for (const [pid, l] of lazyPanes) if (![...queue.keys()].some((v) => v.pane === pid)) { l.io.disconnect(); lazyPanes.delete(pid); }
    nextH = requestAnimationFrame(() => { nextH = 0; schedule(); });
  }
  function done() { for (const fn of waiters.splice(0)) fn(); }

  return {
    open, defer,
    get waiting() { return queue.size; },
    idle: () => (queue.size ? new Promise((r) => waiters.push(r)) : Promise.resolve()),
    stats: () => ({ waiting: queue.size, deferred: st.deferred, made: st.made, slices: [...st.slices] }),
    resetStats() { st.deferred = st.made = 0; st.slices.length = 0; },
    dispose() { if (idleH) (urgent ? clearTimeout(idleH) : cancelRic(idleH)); if (nextH) cancelAnimationFrame(nextH); for (const pid of [...lazyPanes.keys()]) drop(pid); queue.clear(); done(); },
  };
}
