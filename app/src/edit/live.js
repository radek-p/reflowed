// (out of app.js): the live preview of a block being edited, per BLOCK (any number of editors
// may have it open, in either pane: one source, one result stream, every view follows).
//
// Side by side or stacked, the block's render stays while its source is edited, and is typeset again as it
// changes: at once (the compile queue coalesces: one request in flight, the latest source next, the ones typed
// in between never sent), or PREVIEW_DELAY ms after typing stops when the backend is slow (a live compile took
// over SLOW_MS) or other blocks wait. The newest result wins; an older one landing late is not shown. An error
// shows only once the source has stayed wrong for ERROR_AFTER ms with no good compile (typing `\textbf{`
// before its `}` is not worth a red flash): then the last good render dims and the error shows under the
// editor; a good compile clears both. 'replace' (the view setting) is the old way.
//
//   const live = createLive(core)
//   core: { ui, blockById(id), cache, viewKey(b), viewResult(b), mount(id, r, key) -> Promise, display(id), compileSoon(),
//           needsCompile(b), blocks(), queue, delay(), isLive(id) }
//   live.begin(id) · live.end(id) · live.sending(keys) · live.landed(id, key) · live.soon(id) · live.pending()
//   live.display(id, b, u) -> null (not live) | { kind: 'none' | 'ok' | 'wait' | 'error', errors }   (mounts into every view: panes/blocks.js)
export const SLOW_MS = 250, PREVIEW_DELAY = 300, ERROR_AFTER = 1500;
// a burst of keystrokes (each within BURST_MS of the last) sends one compile at its start and the next
// when it pauses, unless MAX_WAIT ms passed since the last one went (typing on still shows): a burst that ends at a
// source typeset before (a word typed and deleted again) costs at most the one at its start. Before, each keystroke
// landing after the previous compile came back sent another: on a loaded machine, 2 for 7 backspaces.
export const BURST_MS = 150, MAX_WAIT = 700;

export function createLive(core) {
  const state = new Map();          // block id -> { sent: Map(compile key -> { seq, source, at, ms }), timer, errorSince, errorTimer }
  let seq = 0, slow = false;
  const of = (id) => {
    let s = state.get(id);
    if (!s) state.set(id, s = { sent: new Map(), timer: 0, errorSince: null, errorTimer: 0 });
    return s;
  };

  /** the first editor opens on the block: what is shown now is the last source that compiled */
  function begin(id) {
    const u = core.ui.get(id), b = core.blockById(id);
    end(id);
    of(id);
    if (!u) return;
    u.liveShown = 0;
    if (u.mounted && b && u.mounted.ck === core.viewKey(b)) { u.goodSource = b.source; u.goodCk = u.mounted.ck; }
    else if (u.goodCk !== u.mounted?.ck) { u.goodSource = null; u.goodCk = null; }
    // a block opened with no result for its source (the lower half of a split, a new block with text): its
    // first live compile is due at once (an edited block is compiled only when due: it waited for a keystroke)
    if (b && b.source.trim() && !core.viewResult(b)) { core.queue.markDue(id); core.compileSoon(); }
  }
  /** the last editor on the block closed */
  function end(id) {
    const s = state.get(id);
    if (s) { clearTimeout(s.timer); clearTimeout(s.errorTimer); state.delete(id); }
    core.queue.clearDue(id);
    const u = core.ui.get(id);
    if (u) { u.liveSource = u.liveCk = null; }
  }
  /** the queue sent these blocks (id -> compile key) */
  function sending(keys) {
    for (const [id, key] of keys) if (state.has(id)) state.get(id).sent.set(key, { seq: ++seq, source: core.blockById(id)?.source ?? '', at: performance.now() });
  }
  function landed(id, key) {
    const s = state.get(id)?.sent.get(key);
    if (s && !s.ms) { s.ms = performance.now() - s.at; slow = s.ms > SLOW_MS; }
  }

  /** the block's views show the latest result there is: the current source's, else the newest live compile's */
  function display(id, b, u) {
    if (!state.has(id) || !core.isLive(id)) return null;
    const s = state.get(id);
    const key = core.viewKey(b), cur = core.viewResult(b);
    // The current source's own result is always the newest truth, even when it was compiled earlier (deleting a
    // word that was just typed goes back to a source already in the cache): a fresh sequence number, so it is mounted.
    let latest = cur ? { key, r: cur, seq: ++seq, source: b.source } : null;
    if (!latest) for (const [k, x] of s.sent) { const r = core.cache.get(k); if (r && (!latest || x.seq > latest.seq)) latest = { key: k, r, seq: x.seq, source: x.source }; }
    if (!latest) return { kind: 'none', errors: [] };                     // nothing typeset yet: what is shown stays
    if (latest.r.status === 'ok' && latest.r.nodelist) {
      s.errorSince = null; clearTimeout(s.errorTimer);
      if (latest.seq >= (u.liveShown ?? 0) && u.mounted?.ck !== latest.key) {
        u.liveShown = latest.seq;
        u.goodSource = latest.source; u.goodCk = latest.key;             // the last source that compiled: what is being shown
        const mounted = core.mount(id, latest.r, latest.key);
        Promise.resolve(mounted).then(() => { if (u.mounted?.ck === latest.key) { u.liveSource = latest.source; u.liveCk = latest.key; u.goodSource = latest.source; u.goodCk = latest.key; } core.caretSoon(id); });
      } else {
        if (u.mounted?.ck === latest.key) { u.liveSource = latest.source; u.liveCk = latest.key; u.goodSource = latest.source; u.goodCk = latest.key; }
        core.caretSoon(id);
      }
      return { kind: 'ok', errors: [] };
    }
    if (latest.r.status === 'error') {
      s.errorSince ??= performance.now();
      const wait = ERROR_AFTER - (performance.now() - s.errorSince);
      if (wait <= 0 || !u.mounted) return { kind: 'error', errors: latest.r.errors ?? [] };
      clearTimeout(s.errorTimer);
      s.errorTimer = setTimeout(() => { if (state.has(id)) core.display(id); }, wait + 10);
      return { kind: 'wait', errors: [] };
    }
    return { kind: 'none', errors: [] };
  }

  /** the source changed: its live preview, now or after the delay */
  function soon(id) {
    if (!state.has(id) || !core.isLive(id)) return;
    const s = state.get(id);
    if (!core.noteShown(id)) s.errorSince = null;                         // the wait for an error to show runs from the last change
    // a source typeset before (a word typed and deleted again): its result at once, nothing to send
    const b = core.blockById(id);
    if (b && core.viewResult(b)) { clearTimeout(s.timer); s.timer = 0; core.display(id); return; }
    clearTimeout(s.timer); s.timer = 0;
    const now = performance.now();
    const inBurst = now - (s.lastChange ?? -Infinity) < BURST_MS && now - (s.lastSent ?? -Infinity) < MAX_WAIT;
    s.lastChange = now;
    const waiting = slow || inBurst || core.blocks().some((x) => x.id !== id && core.needsCompile(x));
    if (!waiting) { s.lastSent = now; core.queue.markDue(id); core.compileSoon(); return; }
    s.timer = setTimeout(() => {
      s.timer = 0;
      s.lastSent = performance.now();
      if (state.has(id)) core.queue.markDue(id);
      core.compileSoon();                                                  // (also settles whenIdle when there is nothing to send)
    }, inBurst && !slow ? BURST_MS : core.delay() ?? PREVIEW_DELAY);
  }

  return {
    begin, end, sending, landed, display, soon,
    has: (id) => state.has(id),
    /** a preview timer runs (whenIdle waits for it) */
    pending: () => [...state.values()].some((s) => s.timer),
  };
}
