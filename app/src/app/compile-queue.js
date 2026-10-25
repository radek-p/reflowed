// The compile scheduler.
//
// Blocks without a result (needsCompile) go to the backend in one request, the user's block first, then those in view,
// then document order; it typesets at most `batch` of them (the request's limit) and answers at once the ones it has a
// result for (its caches), so a document opened from caches lands in one request; the rest are sent again.
// Results of background blocks are shown from a queue, one mount per task (the viewer's decode + layout of a
// block is one piece of work), blocks in view first, and not while the user clicks or types (perf.untilQuiet);
// the edited block (and the one just left) at once. While a background request is compiling, the edited block goes
// to the backend on its own with priority 'user'.
// Each look over the document (what to send, what to keep, the status, whether more is due) is one pass: every block's
// key is computed once in it (not once per question), inside the host's pass (doc/derived.js pass: what the keys
// depend on read once); results landing while the user types are shown again once, when input is quiet.
//
//   const q = createCompileQueue(host)
//   host: { doc(), backend(), cache (Map), keyOf(b), compileSource(b), preamble()?, contextOf(b), skip(b) (a marker, a recall),
//           isEditing(id) (any pane edits it), visible (Set), indexOf(id), perf, counters, display(id), redisplay(which?), stale(b), token(id), compiling(id, on),
//           liveSending(keys), liveLanded(id, key), persist(key, result), setStatus(text, kind), progress?(left, errors), preHash(),
//           preambleLanded(result), applyFonts(fonts), changed(), changedLater(), batch?,
//           shownStale(b)? (its result is cached, not what the block shows), pass?(fn) (fn: a read of every block's key) }
//   q.soon() · q.needsCompile(b) · q.waiting(except?) (a block, other than `except`, waits to be typeset)
//   q.userBlock(id) · q.left(id) (the block just left: first for 5 s)
//   q.markDue(id) · q.clearDue(id) · q.isDue(id) (an edited block's live preview is due; several: one per pane) · q.settle() · q.reset() (the document closed)
//   q.busy() · q.draining() · q.whenSettled() · q.whenDrained()   (whenIdle's waiting part)
export function createCompileQueue(h) {
  const BATCH = h.batch ?? 8;
  const D = () => h.doc(), B = () => h.backend(), perf = h.perf;
  let compileTimer = 0, inflight = null, again = false;
  const idleWaiters = [];
  const applyQ = new Set(), drainWaiters = [];
  let pumping = false, urgentInflight = null, justLeft = null, justLeftAt = 0, redisplayDue = false;
  const due = new Set();                 // edited blocks whose live preview is due (an editor per pane: two at once)

  // the keys of the pass running (block -> key), null outside one: a key is not kept from one pass to the next
  let passKeys = null;
  const keyOf = (b) => {
    if (!passKeys) return h.keyOf(b);
    let k = passKeys.get(b);
    if (k === undefined) passKeys.set(b, k = h.keyOf(b));
    return k;
  };
  /** fn reads the blocks (their keys), changes nothing; a pass inside a pass is the same pass */
  function pass(fn) {
    if (passKeys) return fn();
    passKeys = new Map();
    try { return h.pass ? h.pass(fn) : fn(); } finally { passKeys = null; }
  }
  const userBlock = (id) => h.isEditing(id) || (id === justLeft && performance.now() - justLeftAt < 5000);
  const needsCompile = (b) => (!h.isEditing(b.id) || due.has(b.id)) && b.source.trim() && !h.skip(b) && !h.cache.has(keyOf(b));
  const waiting = (except = null) => pass(() => !!D()?.blocks.some((b) => b.id !== except && needsCompile(b)));
  const drained = () => { for (const w of drainWaiters.splice(0)) w(); };
  const errorResult = (e) => ({ key: '', status: 'error', transient: true, errors: [{ severity: 'error', message: e.message, line: null }], warnings: [], nodelist: null });
  const persist = (key, r) => { const b = B(); if (b.keyPrefix && r.status === 'ok') h.persist(`${b.keyPrefix()}:${key}`, r); };

  function compileSoon() {
    if (compileTimer || !D()) return;
    compileTimer = setTimeout(compileNow, 30);
  }
  /** the status from the results the blocks have now (their current keys'): `left` still to typeset, the blocks whose result
   *  is an error. One rule whatever made the results current (a compile, a preamble change onto cached results, an undo):
   *  a block's problems are its latest result's */
  function report(left) {
    const d = D();
    if (!d) return;
    const nErr = pass(() => d.blocks.filter((b) => h.cache.get(keyOf(b))?.status === 'error').length);
    h.setStatus(left ? `Typesetting ${left} block${left === 1 ? '' : 's'}…` : nErr ? `${nErr} block${nErr === 1 ? '' : 's'} with errors` : 'All blocks typeset',
      left ? 'busy' : nErr ? 'warn' : 'ok');
    h.progress?.(left, nErr);
  }
  function settle() {
    if (compileTimer || inflight || urgentInflight) return;
    for (const w of idleWaiters.splice(0)) w();
  }

  function applyLater(id) {
    if (perf.disabled || userBlock(id)) { applyQ.delete(id); h.display(id); return; }
    applyQ.add(id);
    if (!pumping) pump();
  }
  async function pump() {
    pumping = true;
    try {
      await perf.yield();                                  // never inside the caller's task (a worker message)
      while (applyQ.size && D()) {
        if (perf.inputActive()) { perf.count('deferredForInput'); await perf.untilQuiet(); continue; }
        let id = null;
        for (const x of applyQ) if (h.visible.has(x)) { id = x; break; }
        id ??= applyQ.values().next().value;
        applyQ.delete(id);
        const t = h.token(id);
        h.display(id);
        perf.count('applied');
        if (h.token(id) !== t || perf.slice()) await perf.yield();   // a mount: its own task
      }
    } finally {
      pumping = false;
      if (!D()) applyQ.clear();
      if (!applyQ.size) drained();
    }
  }

  /** a request's answer, landed: each block's result kept, its live preview told, persisted; the preamble's
   *  result (a background request whose preamble is still the document's: sentPreHash; the urgent one passes null) and
   *  the fonts the answer brought. One for both requests: the urgent one
   *  kept the blocks only, so a font first used by the block being edited came with the next background request. */
  function land(res, keys, sentPreHash) {
    for (const [id, key] of keys) {
      const r = res.blocks?.[id];
      if (!r) continue;
      h.cache.set(key, r);
      h.liveLanded(id, key);
      persist(key, r);
    }
    if (sentPreHash != null && sentPreHash === h.preHash()) h.preambleLanded(res.preamble);
    h.applyFonts(res.fonts);
  }

  /** the block the user works on, compiled ahead of the background request in flight */
  async function compileUrgent(b) {
    const key = h.keyOf(b), keys = new Map([[b.id, key]]);
    urgentInflight = b.id;
    perf.count('urgent');
    due.delete(b.id);
    h.counters.requests++; h.counters.partsSent++; h.counters.compiledIds.push(b.id);
    h.compiling(b.id, true);
    h.liveSending(keys);
    const backendNow = B();
    try {
      const res = await backendNow.compile({ preamble: h.preamble ? h.preamble() : D().preamble.source, blocks: [{ id: b.id, source: h.compileSource(b), kind: b.kind, context: h.contextOf(b) || undefined }], keep: [], priority: 'user',
        onBlock: (id, r) => { if (backendNow !== B() || id !== b.id || !r) return; h.cache.set(key, r); h.liveLanded(id, key); h.display(id); } });
      if (res && backendNow === B()) land(res, keys, null);
    } catch (e) {
      h.cache.set(key, errorResult(e));
    }
    urgentInflight = null;
    h.compiling(b.id, false);
    if (!D()) { settle(); return; }
    h.display(b.id);
    h.changed();
    if (waiting()) compileSoon(); else settle();
  }

  async function compileNow() {
    compileTimer = 0;
    const doc = D();
    if (!doc) { settle(); return; }
    if (inflight) {
      again = true;
      // the edited block (its live preview) or the one just left: not after the background request
      const ub = !perf.disabled && !urgentInflight && pass(() => doc.blocks.find((b) => userBlock(b.id) && needsCompile(b)));
      if (ub) compileUrgent(ub);
      return;
    }
    // (a backend keeps its own caches, persistent ones too: uses DocStore.cache)
    // one pass: the blocks to send, viewport first, then document order, the user's block first; their keys, what
    // they compile and against what; the results the backend keeps
    const plan = pass(() => {
      const want = doc.blocks.filter((b) => b.id !== urgentInflight && needsCompile(b));
      if (!want.length) return null;
      want.sort((a, b) => (userBlock(b.id) - userBlock(a.id)) || (h.visible.has(b.id) - h.visible.has(a.id)) || (h.indexOf(a.id) - h.indexOf(b.id)));
      return {
        want, keys: new Map(want.map((b) => [b.id, keyOf(b)])),
        keep: doc.blocks.map((b) => h.cache.get(keyOf(b))).filter((r) => r?.status === 'ok' && r.key).map((r) => r.key),
        sent: want.map((b) => ({ id: b.id, source: h.compileSource(b), kind: b.kind, context: h.contextOf(b) || undefined })),
      };
    });
    if (!plan) {
      // a key can move with no edit (the backend keys by the preamble it holds, which lands after
      // setPreamble resolves): a block whose result is in the cache under its new key but is not shown gets it now
      h.redisplay((b) => !applyQ.has(b.id) && !!h.shownStale?.(b));
      if (!urgentInflight) report(0);                                    // nothing to typeset: the status from the results as they are (a key moved onto cached ones: the errors theirs)
      settle(); return;
    }
    const { want, keys, keep, sent } = plan;
    const backendNow = B();
    backendNow.setVisible?.([...h.visible]);
    // every block goes in the request: the backend typesets at most BATCH of them (limit) and answers every one it has a
    // result for at once (a document opened from caches: one request, not one per BATCH blocks, each with its own round
    // trip, landing and redisplay); the ones it leaves out are sent again
    const batch = want;
    const wasDue = batch.filter((b) => due.has(b.id));
    for (const b of batch) due.delete(b.id);                              // the live preview is on its way
    const preamble = h.preamble ? h.preamble() : doc.preamble.source;   // the engine's preamble (the title data goes with the title block)
    const sentPreHash = h.preHash();
    h.counters.requests++;
    h.setStatus(`Typesetting ${want.length} block${want.length === 1 ? '' : 's'}…`, 'busy');
    h.progress?.(want.length);                                            // the document's status as data
    for (const b of batch) h.compiling(b.id, true);
    h.liveSending(keys);
    let res = null;
    inflight = backendNow.compile({ preamble, blocks: sent, keep, limit: BATCH,
      // each block as soon as it is ready (others answer all at once)
      onBlock: (id, r) => { if (backendNow !== B() || !keys.has(id) || !r) return; h.cache.set(keys.get(id), r); h.liveLanded(id, keys.get(id)); applyLater(id); } });
    try {
      res = await inflight;
    } catch (e) {
      h.setStatus(e.message, 'error');
      for (const [, key] of keys) h.cache.set(key, errorResult(e));
    }
    inflight = null;
    for (const b of batch) h.compiling(b.id, false);
    // the blocks answered (all of them when the request failed: each has its error now); one left out that was due stays due
    const answered = res ? batch.filter((b) => res.blocks?.[b.id]) : batch;
    h.counters.partsSent += answered.length;
    h.counters.compiledIds.push(...answered.map((b) => b.id));
    for (const b of wasDue) if (res && !res.blocks?.[b.id]) due.add(b.id);
    const now = D(), landed = !!(res && backendNow === B() && now);
    if (landed) land(res, keys, sentPreHash);
    // one pass: the blocks still to typeset (the status; whether to go on)
    const left = now ? pass(() => { const n = now.blocks.filter(needsCompile).length; if (landed) report(n); return n; }) : 0;
    redisplaySoon();
    h.changedLater();
    if (!D()) { settle(); return; }
    if (again || left || D() !== now) { again = false; compileSoon(); } else settle();
  }
  // every block whose key moved or whose result came without onBlock (blocks.stale, not all): at once, or
  // once the user stops clicking or typing (once, however many requests landed meanwhile: what it shows is read when it
  // runs); what the queue holds of a request it shows at its own pace (a mount a task: a document opened from caches
  // lands in one request, and its blocks all at once would be one long task)
  function redisplay() { if (!D()) return; h.redisplay((b) => !applyQ.has(b.id) && h.stale(b)); if (!applyQ.size && !pumping) drained(); }
  function redisplaySoon() {
    if (!perf.inputActive()) { redisplay(); return; }
    if (redisplayDue) return;
    redisplayDue = true;
    perf.untilQuiet().then(() => { redisplayDue = false; redisplay(); drained(); });
  }

  return {
    soon: compileSoon, settle, needsCompile, waiting, userBlock,
    /** the block just left: its recompile and result first (5 s) */
    left(id) { justLeft = id; justLeftAt = performance.now(); },
    markDue(id) { due.add(id); },
    clearDue(id) { due.delete(id); },
    isDue: (id) => due.has(id),
    /** the document closed: nothing queued to show */
    reset() { applyQ.clear(); drained(); },
    busy: () => !!(compileTimer || inflight || urgentInflight),
    draining: () => !!(applyQ.size || pumping || redisplayDue),
    whenSettled: () => new Promise((r) => idleWaiters.push(r)),
    whenDrained: () => new Promise((r) => drainWaiters.push(r)),
    get pending() { return !!(compileTimer || inflight); },
  };
}
