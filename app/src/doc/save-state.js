// the store writes, out of app.js.
// Writes run one after another, in the order made (a safety snapshot before a
// destructive change sees the state before it). A write that fails is kept and
// retried (with backoff, and at once on retry()) until it succeeds; the document is
// unsaved until then (its tab's dot) — a later write that succeeds does not clear it,
// unless it is a newer write of the same thing (the same key: the block, the
// metadata), which carries the newer state.
//
//   const w = createWriter({ onChange })   onChange(state) after every change
//   w.write(fn, key?) -> Promise (never rejects)   key: what the write puts ('block:<id>', 'meta'); none: unique
//   w.retry() · w.state() · w.idle() -> Promise (no write pending) · w.pending
export const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

/** @param {{ onChange?: (s: { pending: number, failed: number, error: unknown }) => void, retryMs?: number[], onError?: (e: any) => void }} [o] */
export function createWriter({ onChange = () => {}, retryMs = RETRY_MS, onError = (e) => console.error('store:', e) } = {}) {
  let chain = Promise.resolve(), pending = 0, seq = 0, timer = 0, tries = 0;
  const failed = new Map();                 // key -> { fn, error }
  const idleWaiters = [];
  const state = () => ({ pending, failed: failed.size, error: failed.size ? [...failed.values()].at(-1).error : null });
  const changed = () => { try { onChange(state()); } catch (e) { console.warn('save state:', e); } };

  function write(fn, key = `w${++seq}`) {
    pending++;
    changed();
    const p = chain.then(fn).then(
      () => { failed.delete(key); if (!failed.size) { tries = 0; clearTimeout(timer); timer = 0; } },
      (e) => { failed.set(key, { fn, error: e }); onError(e); schedule(); })
      .finally(() => { pending--; changed(); if (!pending) for (const w of idleWaiters.splice(0)) w(); });
    chain = p;
    return p;
  }
  function schedule() {
    if (timer) return;
    const ms = retryMs[Math.min(tries, retryMs.length - 1)];
    tries++;
    timer = setTimeout(() => { timer = 0; retry(); }, ms);
  }
  /** run every failed write again, in the order they failed */
  function retry() {
    clearTimeout(timer); timer = 0;
    for (const [key, f] of [...failed]) write(f.fn, key);
  }
  return {
    write, retry, state,
    get pending() { return pending; },
    idle: () => (pending ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
    /** forget everything (the document closed) */
    reset() { failed.clear(); clearTimeout(timer); timer = 0; tries = 0; changed(); },
  };
}
