// The engine states of documents closed in their last pane, kept for a while so that opening one
// again does not rebuild its state (its preamble, .bbl and files in the worker): the last `max` released ones, least
// recently released dropped first. Nothing is kept when memory is tight (asked of the browser at each release, no
// polling). A kept state is dropped on eviction, by forget(key) (the document deleted or changed elsewhere), and when
// the tab has been hidden for `hiddenMs` (one timer, started on visibilitychange).
//
//   const kept = createKept({ max: 2, onDrop: (st) => …, tight: memoryTight })
//   kept.keep(key, st)   a released state: kept (true), or dropped at once when memory is tight (false)
//   kept.take(key)       the kept state of key, out of the cache (null if none)
//   kept.forget(key)     drop key's kept state
//   kept.keys()          the kept keys, oldest first (tests)

/** memory is tight: a small device (navigator.deviceMemory ≤ 4 GB), or (Chromium) the JS heap over 70 % of its limit */
export function memoryTight() {
  try {
    const dm = /** @type {any} */ (globalThis.navigator)?.deviceMemory;
    if (typeof dm === 'number' && dm <= 4) return true;
    const m = /** @type {any} */ (globalThis.performance)?.memory;
    if (m && m.jsHeapSizeLimit > 0 && m.usedJSHeapSize > 0.7 * m.jsHeapSizeLimit) return true;
  } catch { /* not offered: not tight */ }
  return false;
}

export function createKept({ max = 2, onDrop = (_st) => {}, tight = memoryTight, hiddenMs = 5 * 60 * 1000 } = {}) {
  const kept = new Map();                     // key -> state, in release order (oldest first)
  const drop = (key) => { const st = kept.get(key); if (!st) return; kept.delete(key); onDrop(st); };
  let timer = 0;
  const doc = globalThis.document;
  doc?.addEventListener?.('visibilitychange', () => {
    clearTimeout(timer); timer = 0;
    if (doc.visibilityState === 'hidden') timer = setTimeout(() => { timer = 0; for (const k of [...kept.keys()]) drop(k); }, hiddenMs);
  });
  return {
    keep(key, st) {
      drop(key);
      if (max <= 0 || tight()) { onDrop(st); return false; }
      kept.set(key, st);
      while (kept.size > max) drop(kept.keys().next().value);
      return true;
    },
    take(key) { const st = kept.get(key) ?? null; kept.delete(key); return st; },
    forget: drop,
    keys: () => [...kept.keys()],
  };
}
