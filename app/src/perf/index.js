// keeping the page responsive while blocks typeset in the background.
//
//   import { createPerf } from './index.js';
//   const perf = createPerf();            // one per page (app.js createDocEditor)
//   perf.inputActive()                    true for QUIET_MS after the last pointerdown / keydown / wheel / input
//   await perf.untilQuiet()               resolves once no input came for QUIET_MS
//   perf.slice()                          true when the current slice of background work is over its budget
//   await perf.yield()                    give the event loop a turn (scheduler.yield, else a MessageChannel task)
//   perf.count(name, n?) / perf.time(name, ms)   counters for window.__rtxPerf.stats() (tests)
//
// And, once per page, a memo on document.fonts.check (installFontCheckMemo):
// the viewer asks it for every \webtext slot of every block each time a slot
// text changes (host/slots.js slotNodes), ~2.4 ms a call in Chromium, which
// made a slot refresh of the paper a 100–500 ms task. The answer only changes
// when a face is added, removed or loads, so it is remembered until then (a
// generation bumped by those, synchronously).
//
const QUIET_MS = 300, BUDGET_MS = 8;

const off = () => { try { return new URLSearchParams(location.search).get('perf') === 'off'; } catch { return false; } };

export function createPerf(o = {}) {
  const quietMs = o.quietMs ?? QUIET_MS, budgetMs = o.budgetMs ?? BUDGET_MS;
  const disabled = o.disabled ?? off();
  let lastInput = -Infinity, sliceStart = performance.now();
  const stats = { applied: 0, yields: 0, deferredForInput: 0, refreshes: 0, refreshesDeferred: 0, maxSliceMs: 0, urgent: 0 };
  const waiters = [];
  let quietTimer = 0;
  const note = () => {
    lastInput = performance.now();
    if (waiters.length && !quietTimer) arm();
  };
  function arm() {
    quietTimer = setTimeout(() => {
      quietTimer = 0;
      if (quietMs - (performance.now() - lastInput) > 1) { arm(); return; }
      for (const w of waiters.splice(0)) w();
    }, Math.max(1, quietMs - (performance.now() - lastInput)));
  }
  // the reader's input anywhere on the page holds background work back (a window listener: input outside the editor
  // counts too); dispose() removes them (an editor unmounted)
  const INPUTS = ['pointerdown', 'keydown', 'wheel', 'input', 'compositionstart'];
  if (!disabled) for (const t of INPUTS) window.addEventListener(t, note, { capture: true, passive: true });
  const inputActive = () => !disabled && performance.now() - lastInput < quietMs;
  const untilQuiet = () => (inputActive() ? new Promise((r) => { waiters.push(r); if (!quietTimer) arm(); }) : Promise.resolve());

  const mc = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
  const queue = [];
  if (mc) mc.port1.onmessage = () => queue.shift()?.();
  function yieldNow() {
    stats.yields++;
    const t = performance.now() - sliceStart;
    if (t > stats.maxSliceMs) stats.maxSliceMs = Math.round(t);
    const done = () => { sliceStart = performance.now(); };
    if (globalThis.scheduler?.yield) return globalThis.scheduler.yield().then(done);
    if (mc) return new Promise((r) => { queue.push(() => { done(); r(); }); mc.port2.postMessage(0); });
    return new Promise((r) => setTimeout(() => { done(); r(); }, 0));
  }
  const perf = {
    disabled,
    dispose() {
      for (const t of INPUTS) window.removeEventListener(t, note, { capture: true });
      clearTimeout(quietTimer); quietTimer = 0; waiters.splice(0);
      if (mc) { mc.port1.onmessage = null; mc.port1.close(); mc.port2.close(); }   // (its port's handler is a listener that keeps it alive)
    },
    quietMs,
    inputActive,
    untilQuiet,
    /** start a slice of background work now (a task that did not yield: its own start) */
    begin() { sliceStart = performance.now(); },
    slice: () => !disabled && performance.now() - sliceStart > budgetMs,
    yield: yieldNow,
    count(name, n = 1) { stats[name] = (stats[name] ?? 0) + n; },
    stats: () => ({ ...stats, fontChecks: fontMemo.calls, fontCheckHits: fontMemo.hits }),
  };
  if (!disabled) installFontCheckMemo();
  globalThis.__rtxPerf = perf;
  return perf;
}

// ── document.fonts.check, remembered ─────────────────────────────────────────
const fontMemo = { calls: 0, hits: 0, installed: false };
export function installFontCheckMemo() {
  const fonts = globalThis.document?.fonts;
  if (fontMemo.installed || !fonts || typeof fonts.check !== 'function') return;
  fontMemo.installed = true;
  const orig = fonts.check.bind(fonts);
  let gen = 0, memoGen = -1, memo = new Map();
  const bump = () => { gen++; };
  // a face added, removed or loaded; a style sheet (with @font-face rules) added or changed
  for (const ev of ['loading', 'loadingdone', 'loadingerror']) fonts.addEventListener?.(ev, bump);
  for (const m of ['add', 'delete', 'clear']) {
    const f = fonts[m];
    if (typeof f === 'function') fonts[m] = function (...a) { bump(); return f.apply(this, a); };
  }
  const head = document.head, proto = Node.prototype;
  for (const m of ['appendChild', 'insertBefore', 'replaceChild', 'removeChild']) {
    const f = proto[m];
    proto[m] = function (...a) { if (this === head || this.nodeName === 'STYLE') bump(); return f.apply(this, a); };
  }
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const f = Element.prototype[m];
    Element.prototype[m] = function (...a) { if (this === head || this.nodeName === 'STYLE') bump(); return f.apply(this, a); };
  }
  const tc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  if (tc?.set) Object.defineProperty(Node.prototype, 'textContent', { ...tc, set(v) { if (this.nodeName === 'STYLE') bump(); tc.set.call(this, v); } });
  fonts.check = function (font, text) {
    fontMemo.calls++;
    // a face that finished loading answers false here until its loadingdone event (a task later):
    // the viewer then only asks fonts.load() once more, which resolves at once
    if (memoGen !== gen) { memo = new Map(); memoGen = gen; }
    const k = text === undefined ? font : `${font}\u0000${text}`;
    const v = memo.get(k);
    if (v !== undefined) { fontMemo.hits++; return v; }
    const r = orig(font, text);
    memo.set(k, r);
    return r;
  };
}
