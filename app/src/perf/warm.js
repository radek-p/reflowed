// the engine warm before the first edit (backend warms lazily: with every
// result from a cache, the first edit would pay for TeX's start + the preamble).
//
//   const warmer = createWarmer({ backend: () => backend, key: () => preHash, perf });
//   warmer.watch(listEl)      intent: pointerdown / focus on a block, the pointer resting on one
//                             for 150 ms, Enter on a selected block → warm now (each pane's list; the
//                             window's Enter listener is added once, removed by warmer.dispose())
//   warmer.idle()             after a document opens or its preamble changes: warm when the page is
//                             idle (requestIdleCallback, no input for perf's quiet time), except on
//                             low-memory devices (WebKit, a coarse pointer, deviceMemory < 4), where
//                             only intent warms
// A warm is asked for once per preamble key; the backend runs it in its serial chain (the worker),
// so it never blocks the page, and a compile asked for meanwhile waits for it.
const HOVER_MS = 150;

export function lowMemory() {
  const ua = navigator.userAgent ?? '';
  const webkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory;
  return webkit || coarse || (typeof mem === 'number' && mem < 4);
}

export function createWarmer({ backend, key, perf, root, low = lowMemory() }) {
  let warmed = null, idleHandle = 0, hover = 0, onEnter = null, offEnter = null;
  const watched = new WeakSet();                 // the lists watched (each pane's)
  const stats = { intent: 0, idle: 0, asked: 0, low };
  // OFF by default until its test passes: ?warm=on (intent + idle) or ?warm=idle-off (intent only)
  const off = () => { let v = null; try { v = new URLSearchParams(location.search).get('warm'); } catch { /* */ } return v === 'on' ? null : v ?? 'off'; };
  function warm(why) {
    const be = backend(), k = key();
    if (!be?.warm || !k || warmed === k || off() === 'off') return;
    if (be.isWarm?.()) { warmed = k; return; }
    warmed = k;
    stats.asked++; stats[why]++;
    Promise.resolve(be.warm({ tex: true })).catch(() => { if (warmed === k) warmed = null; });
  }
  return {
    watch(list) {
      if (!list || watched.has(list)) return;
      watched.add(list);
      list.addEventListener('pointerdown', () => warm('intent'), { capture: true, passive: true });
      list.addEventListener('focusin', () => warm('intent'));
      list.addEventListener('pointerover', (e) => {
        if (hover || !e.target.closest?.('.blk')) return;
        hover = setTimeout(() => { hover = 0; if (list.matches(':hover')) warm('intent'); }, HOVER_MS);
      }, { passive: true });
      list.addEventListener('pointerleave', () => { clearTimeout(hover); hover = 0; }, { passive: true });
      if (!onEnter) {
        // Enter on a selected block of this editor (its keys: root.takesKey)
        onEnter = (e) => { if (e.key === 'Enter' && root.takesKey(e) && root.$('.blk.selected')) warm('intent'); };
        offEnter = root.listen(window, 'keydown', onEnter, { capture: true, passive: true });
      }
    },
    dispose() { offEnter?.(); offEnter = null; onEnter = null; },
    idle() {
      if (low || off() === 'idle-off' || off() === 'off') return;
      if (idleHandle) return;
      const go = async () => {
        idleHandle = 0;
        await perf?.untilQuiet?.();
        warm('idle');
      };
      idleHandle = typeof requestIdleCallback === 'function' ? requestIdleCallback(go, { timeout: 5000 }) : setTimeout(go, 1500);
    },
    stats: () => ({ ...stats, warmed }),
  };
}
