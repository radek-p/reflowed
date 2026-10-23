// unit checks (Node, no browser): the DocumentView's placement
// (docview/document-view.js placeChildren) on a small fake DOM: the order is
// right after any permutation, insert or removal, and only the elements that
// must move are moved (the rest keep focus, selection and their mounts).
//   node tests/test-w15-units.ts
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const { placeChildren } = await import(pathToFileURL(join(HERE, 'app/src/docview/document-view.js')).href);

let failed = 0, n = 0;
const check = (name: string, ok: boolean, detail = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

class El { parentNode: Box | null = null; name: string; constructor(name: string) { this.name = name; } remove() { this.parentNode?.removeChild(this); } }
class Box {
  kids: El[] = []; moved: string[] = [];
  get children() { return this.kids; }
  removeChild(e: El) { const i = this.kids.indexOf(e); if (i >= 0) this.kids.splice(i, 1); e.parentNode = null; }
  insertBefore(e: El, ref: El | null) {
    if (e.parentNode) e.parentNode.removeChild(e);
    const i = ref ? this.kids.indexOf(ref) : this.kids.length;
    this.kids.splice(i < 0 ? this.kids.length : i, 0, e); e.parentNode = this; this.moved.push(e.name);
  }
}
const names = (b: Box) => b.kids.map((e) => e.name).join('');
function setup(s: string) { const b = new Box(); const els = new Map<string, El>(); for (const c of s) { const e = new El(c); els.set(c, e); b.insertBefore(e, null); } b.moved = []; return { b, els }; }
const el = (els: Map<string, El>, c: string) => { let e = els.get(c); if (!e) { e = new El(c); els.set(c, e); } return e; };

function run(from: string, to: string, maxMoves: number) {
  const { b, els } = setup(from);
  const moves = placeChildren(b, [...to].map((c) => el(els, c)));
  check(`${from} -> ${to}`, names(b) === to && moves <= maxMoves, `got ${names(b)}, ${moves} move(s) [${b.moved.join('')}], at most ${maxMoves}`);
}
run('ABCDE', 'ABCDE', 0);                 // nothing changed: nothing moves
run('ABCDE', 'BCDEA', 1);                 // first to last: one move (the old loop moved 4)
run('ABCDE', 'EABCD', 1);                 // last to first
run('ABCDE', 'ABDCE', 1);                 // a swap of neighbours
run('ABCDE', 'ABXCDE', 1);                // an insert
run('ABCDE', 'ABDE', 0);                  // a removal
run('ABCDE', 'EDCBA', 4);                 // a reversal
run('', 'ABC', 3);                        // the first render
run('ABCDEFGH', 'ABFGCDEH', 2);           // a section (FG) moved up: two moves
// random permutations: always the right order, never more moves than elements out of the longest run
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let okAll = true, worst = '';
for (let t = 0; t < 300; t++) {
  const from = 'ABCDEFGHIJKLMNOP'.slice(0, 1 + Math.floor(rnd() * 16));
  const to = [...from].filter(() => rnd() > 0.15).concat(rnd() > 0.5 ? ['x'] : []).sort(() => rnd() - 0.5).join('');
  const { b, els } = setup(from);
  placeChildren(b, [...to].map((c) => el(els, c)));
  if (names(b) !== to) { okAll = false; worst = `${from} -> ${to}: ${names(b)}`; break; }
}
check('300 random reorders land in order', okAll, worst);

// the controls mode: wide only when the pane gives the gutter on both sides; back to wide past the hysteresis
{
  const { controlsMode, GUTTER, HYST } = await import(pathToFileURL(join(HERE, "app/src/docview/controls.js")).href);
  const need = 704 + 2 * GUTTER;
  const r = [controlsMode(undefined, need, 704), controlsMode("wide", need - 1, 704), controlsMode("narrow", need, 704), controlsMode("narrow", need + HYST - 1, 704), controlsMode("narrow", need + HYST, 704), controlsMode("wide", need, 704)];
  check("controlsMode: wide at col + 2·gutter, narrow below, hysteresis going back", r.join() === "wide,narrow,narrow,narrow,wide,wide", r.join());
}

// scanLabels with the theorem environments as a Set (what panels.js passes): no TypeError (the pane bar's outline() hit it)
{
  const { scanLabels } = await import(pathToFileURL(join(HERE, 'app/src/tex/texscan.js')).href);
  let ok = true, got: any = null;
  try { got = scanLabels('\\begin{lemma}\\label{lem:a} x\\end{lemma} and \\section{S}\\label{sec:s}', 'paragraph', new Set(['lemma'])); } catch (e: any) { ok = false; got = e.message; }
  check('scanLabels: theorem environments as a Set do not throw; labels found', ok && Array.isArray(got) && got.length === 2, JSON.stringify(got));
}
// the section menu's neighbours: parent, siblings, children
{
  const { neighbours } = await import(pathToFileURL(join(HERE, 'app/src/docview/pane-bar.js')).href).catch(() => ({ neighbours: null }));
  if (neighbours) {
    const it = (id: string, level: number) => ({ id, level, title: id });
    const items = [it('A', 1), it('A1', 2), it('A2', 2), it('A2a', 3), it('A3', 2), it('B', 1)];
    const n = neighbours(items, 2);
    check('#73b neighbours: parent A, siblings A1 A2 A3, children A2a', n.parent?.id === 'A' && n.siblings.map((x: any) => x.id).join() === 'A1,A2,A3' && n.children.map((x: any) => x.id).join() === 'A2a', JSON.stringify(n));
    const t = neighbours(items, 0);
    check('#73b neighbours at the top level: no parent, the top-level siblings, the children', !t.parent && t.siblings.map((x: any) => x.id).join() === 'A,B' && t.children.map((x: any) => x.id).join() === 'A1,A2,A3', JSON.stringify(t));
  } else check('#73b neighbours: pane-bar.js loads in Node', false);
}

// the writer: a failed write keeps "Not saved" until it succeeds; a newer write of the same key supersedes it
{
  const { createWriter } = await import(pathToFileURL(join(HERE, 'app/src/doc/save-state.js')).href);
  // the state, as the tab's unsaved reads it: 'unsaved' while a write has failed, else 'saved'
  const label = (s: any) => (s.failed ? 'unsaved' : 'saved');
  const w = createWriter({ retryMs: [600000], onError: () => {} });   // retried by hand here
  let failA = true, aRuns = 0, bRuns = 0;
  w.write(() => { aRuns++; return failA ? Promise.reject(new Error('quota')) : Promise.resolve(); }, 'block:a');
  await w.idle();
  const s1 = label(w.state());
  w.write(() => { bRuns++; return Promise.resolve(); }, 'meta:title');
  await w.idle();
  const s2 = label(w.state());                       // another write succeeded: still not saved
  failA = false;
  w.retry();
  await w.idle();
  const s3 = label(w.state());
  check('a failed write keeps the document unsaved after a later, other write succeeds; its retry succeeding saves it', s1 === 'unsaved' && s2 === 'unsaved' && s3 === 'saved' && aRuns === 2 && bRuns === 1, JSON.stringify({ s1, s2, s3, aRuns, bRuns }));
  // a newer write of the same thing supersedes the failed one
  let n2 = 0;
  w.write(() => Promise.reject(new Error('x')), 'block:b');
  await w.idle();
  w.write(() => { n2++; return Promise.resolve(); }, 'block:b');
  await w.idle();
  check('a newer write of the same block that succeeds clears the failure (it carries the newer state)', label(w.state()) === 'saved' && n2 === 1, label(w.state()));
  // retried by itself (backoff), until it succeeds
  let k = 0;
  const w3 = createWriter({ retryMs: [5], onError: () => {} });
  w3.write(() => (++k < 3 ? Promise.reject(new Error('busy')) : Promise.resolve()), 'block:c');
  const t0 = Date.now();
  while (w3.state().failed || w3.pending) { if (Date.now() - t0 > 3000) break; await new Promise((r) => setTimeout(r, 5)); }
  check('a failed write is retried by itself until it succeeds', !w3.state().failed && k === 3, JSON.stringify({ k, st: w3.state() }));
}

// the compile scheduler (app/compile-queue.js), on a fake backend: order, the user's block ahead of a
// request in flight, results shown, idle when done
{
  (globalThis as any).document ??= { dispatchEvent() { return true; } };
  const { createCompileQueue } = await import(pathToFileURL(join(HERE, 'app/src/app/compile-queue.js')).href);
  const mk = () => {
    const doc = { preamble: { source: '' }, blocks: ['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'paragraph', source: `text ${id}` })) };
    const calls: any[] = [], shown: string[] = [];
    let release: (() => void) | null = null, hold = false;
    const backend = {
      id: 'fake',
      compile(req: any) {
        calls.push({ ids: req.blocks.map((b: any) => b.id), priority: req.priority ?? 'bg' });
        const out = { blocks: Object.fromEntries(req.blocks.map((b: any) => [b.id, { key: `k:${b.id}`, status: 'ok', nodelist: {}, errors: [], warnings: [] }])), preamble: { errors: [], warnings: [] }, fonts: null };
        if (hold && !req.priority) { hold = false; return new Promise((r) => { release = () => r(out); }); }   // only the first background request waits
        return Promise.resolve(out);
      },
    };
    const st = { editing: new Set<string>() };
    const perf = { disabled: false, yield: () => Promise.resolve(), inputActive: () => false, untilQuiet: () => Promise.resolve(), count() {}, slice: () => false };
    const q = createCompileQueue({
      doc: () => doc, backend: () => backend, cache: new Map(), keyOf: (b: any) => `key:${b.id}:${b.source}`, compileSource: (b: any) => b.source, contextOf: () => '',
      skip: () => false, isEditing: (id: string) => st.editing.has(id), visible: new Set(['c']), indexOf: (id: string) => doc.blocks.findIndex((b) => b.id === id), perf,
      counters: { requests: 0, partsSent: 0, mounts: 0, compiledIds: [] }, display: (id: string) => shown.push(id), token: () => 0, compiling() {},
      redisplay: (w: any) => { for (const b of doc.blocks) if (!w || w(b)) shown.push(b.id); }, stale: () => true,   // no shown keys here: every block counts as stale
      liveSending() {}, liveLanded() {}, persist() {}, setStatus() {}, preHash: () => 'p', preambleLanded() {}, applyFonts() {}, changed() {}, changedLater() {}, batch: 8,
    });
    return { q, doc, calls, shown, st, setHold: (v: boolean) => { hold = v; }, release: () => release?.() };
  };
  {
    const t = mk();
    t.q.soon();
    await t.q.whenSettled();
    check('queue: one request, the block in view first then document order; every block shown; idle after', t.calls.length === 1 && t.calls[0].ids.join() === 'c,a,b,d' && ['a', 'b', 'c', 'd'].every((id) => t.shown.includes(id)) && !t.q.busy() && !t.doc.blocks.some((b) => t.q.needsCompile(b)), JSON.stringify({ calls: t.calls, shown: t.shown }));
  }
  {
    const t = mk();
    t.setHold(true);
    t.q.soon();
    const until = async (f: () => boolean) => { while (!f()) await new Promise((r) => setTimeout(r, 1)); };
    await until(() => t.calls.length === 1);                  // the background request went out (after the debounce)
    t.doc.blocks[3].source = 'text d, edited';               // the user's block changes while that request is in flight
    t.st.editing.add('d'); t.q.markDue('d');
    t.q.soon();
    await until(() => t.calls.length === 2);
    const urgent = t.calls.find((c) => c.priority === 'user');
    t.release();
    await t.q.whenSettled();
    check('queue: while a request is in flight, the edited block (its live preview) goes ahead with priority user', !!urgent && urgent.ids.join() === 'd' && t.calls[0].priority === 'bg' && !t.q.busy(), JSON.stringify(t.calls));
  }
  {
    // two editors (one per pane) on two blocks: both live previews are due at once; both go ahead of a
    // request in flight, one after the other, with priority user; neither is left due
    const t = mk();
    t.setHold(true);
    t.q.soon();
    const until = async (f: () => boolean) => { while (!f()) await new Promise((r) => setTimeout(r, 1)); };
    await until(() => t.calls.length === 1);
    t.doc.blocks[1].source = 'text b, edited in pane A';
    t.doc.blocks[3].source = 'text d, edited in pane B';
    t.st.editing.add('b'); t.st.editing.add('d');
    t.q.markDue('b'); t.q.markDue('d');
    t.q.soon();
    await until(() => t.calls.filter((c) => c.priority === 'user').length === 2);
    t.release();
    await t.q.whenSettled();
    const user = t.calls.filter((c) => c.priority === 'user').map((c) => c.ids.join()).sort().join('|');
    check('queue: two edited blocks (two panes) both get their live preview ahead of the request in flight, neither left due',
      user === 'b|d' && !t.q.isDue('b') && !t.q.isDue('d') && !t.q.busy() && !t.doc.blocks.some((b) => t.q.needsCompile(b)), JSON.stringify(t.calls));
    // an edited block that is not due (typing paused, nothing new) is not sent again
    t.doc.blocks[1].source = 'text b, typed on';
    check('queue: an edited block is compiled only when its live preview is due', !t.q.needsCompile(t.doc.blocks[1]) && (t.q.markDue('b'), t.q.needsCompile(t.doc.blocks[1])));
  }
  {
    // a key that moves with no edit (the backend's preamble lands after setPreamble resolves) back to one
    // whose result is cached: nothing to compile, but the blocks that do not show that result are displayed again
    const doc = { preamble: { source: '' }, blocks: ['a', 'b'].map((id) => ({ id, kind: 'paragraph', source: `text ${id}` })) };
    const cache = new Map<string, any>(), shown = new Map<string, string>(), calls: string[][] = [];
    let held = 'P0';
    const keyOf = (b: any) => `${held}:${b.id}`;
    const ok = { status: 'ok', nodelist: {}, errors: [], warnings: [] };
    for (const b of doc.blocks) cache.set(`P0:${b.id}`, ok);
    const perf = { disabled: false, yield: () => Promise.resolve(), inputActive: () => false, untilQuiet: () => Promise.resolve(), count() {}, slice: () => false };
    const display = (id: string) => { const b = doc.blocks.find((x) => x.id === id)!; shown.set(id, cache.has(keyOf(b)) ? keyOf(b) : 'pending'); };
    const q = createCompileQueue({
      doc: () => doc, backend: () => ({ id: 'fake', compile(req: any) { calls.push(req.blocks.map((b: any) => b.id)); return Promise.resolve({ blocks: {}, preamble: { errors: [], warnings: [] }, fonts: null }); } }),
      cache, keyOf, compileSource: (b: any) => b.source, contextOf: () => '', skip: () => false, isEditing: () => false, visible: new Set(), indexOf: () => 0, perf,
      counters: { requests: 0, partsSent: 0, mounts: 0, compiledIds: [] }, display, token: () => 0, compiling() {},
      redisplay: (w: any) => { for (const b of doc.blocks) if (!w || w(b)) display(b.id); }, stale: (b: any) => shown.get(b.id) !== keyOf(b),   // blocks.stale: the shown key is not the current one
      liveSending() {}, liveLanded() {}, persist() {}, setStatus() {}, preHash: () => 'p', preambleLanded() {}, applyFonts() {}, changed() {}, changedLater() {}, batch: 8,
      shownStale: (b: any) => cache.has(keyOf(b)) && shown.get(b.id) !== keyOf(b),
    });
    held = 'P1';                                              // the undo's display: the backend still holds the converted preamble
    for (const b of doc.blocks) display(b.id);
    held = 'P0';                                              // then it takes the original one: the keys are the cached ones again
    q.soon();
    await q.whenSettled();
    check('queue: a key back on a cached result, nothing compiled, every block shown again', !calls.length && doc.blocks.every((b) => shown.get(b.id) === `P0:${b.id}`), JSON.stringify({ calls, shown: [...shown] }));
  }
}

// the live preview coalesces a burst of keystrokes: one compile at its start, none when it ends at a
// source typeset before (edit/live.js), on a fake clock
{
  let now = 1000; const timers: { at: number; fn: () => void; id: number }[] = []; let seq = 0;
  const realPerf = globalThis.performance, realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
  (globalThis as any).setTimeout = (fn: () => void, ms: number) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; };
  (globalThis as any).clearTimeout = (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const tick = (ms: number) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); } now = end; };
  const { createLive } = await import(pathToFileURL(join(HERE, 'app/src/edit/live.js')).href);
  const b = { id: 'p', source: 'Text.' }, cached = new Set(['Text.']);
  let due = 0;
  const live = createLive({ ui: new Map([['p', { render: {}, mounted: null }]]), blockById: () => b, cache: new Map(), viewKey: () => 'k', viewResult: (x: any) => (cached.has(x.source) ? { status: 'ok' } : null),
    mount: () => Promise.resolve(), display() {}, compileSoon() {}, needsCompile: () => false, blocks: () => [b], delay: () => 300,
    queue: { markDue() { due++; }, clearDue() {} }, isLive: () => true, noteShown: () => false, caretSoon() {} });
  live.begin('p');
  // seven backspaces 20 ms apart back to the cached source: the first one sends, the rest wait for the pause
  const steps = ['Text. Zyxwv', 'Text. Zyxw', 'Text. Zyx', 'Text. Zy', 'Text. Z', 'Text. ', 'Text.'];
  for (const src of steps) { b.source = src; live.soon('p'); tick(20); }
  tick(1000);
  check('live: a burst of 7 keystrokes ending at a typeset source sends one compile (its first), not one per landing', due === 1, { due });
  // typing on and on (20 ms apart for 2 s): a compile at least every MAX_WAIT, so the preview follows
  due = 0;
  for (let k = 0; k < 100; k++) { b.source = 'Text. ' + 'x'.repeat(k + 1); live.soon('p'); tick(20); }
  tick(1000);
  check('live: typing on for 2 s still compiles as it goes (at least every 0.7 s), not only at the end', due >= 3 && due <= 6, { due });
  Object.defineProperty(globalThis, 'performance', { value: realPerf, configurable: true });
  globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
}

// the status with hysteresis (chrome/status.js), on a fake clock
{
  const { createStatus } = await import(pathToFileURL(join(HERE, 'app/src/chrome/status.js')).href);
  let now = 0; const timers: { at: number; fn: () => void; id: number }[] = []; let seq = 0;
  const clock = { setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; }, clearTimeout: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); } };
  const tick = (ms: number) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); } now = end; };
  const shown: string[] = [];
  const st = createStatus((text: string, kind: string) => shown.push(`${kind}:${text}`), { ...clock, now: () => now });
  st.set('Typesetting 1 block…', 'busy'); tick(300); st.set('All blocks typeset', 'ok'); tick(5000);
  check('status: a compile faster than 1 s shows nothing (no busy, no all typeset)', shown.length === 0, shown.join(' | '));
  st.set('Typesetting 9 blocks…', 'busy'); tick(999);
  const early = shown.length;
  tick(2); st.set('Typesetting 4 blocks…', 'busy'); st.set('All blocks typeset', 'ok'); tick(500);
  const held = shown.at(-1); tick(2400);
  const mid = [...shown]; tick(800);
  check('status: a slow compile shows busy after 1 s (kept 0.6 s), its count, then all typeset, which goes after 2.5 s', early === 0 && held === 'busy:Typesetting 4 blocks…' && mid.join('|') === 'busy:Typesetting 9 blocks…|busy:Typesetting 4 blocks…|ok:All blocks typeset' && shown.at(-1) === ':', shown.join(' | '));
  shown.length = 0;
  st.set('2 blocks with errors', 'warn'); tick(10000);
  check('status: errors show at once and stay', shown.join() === 'warn:2 blocks with errors' && st.state().kind === 'warn', shown.join(' | '));
}

// the app's result key comes from the backend's own (\input files included), plus the app's parts
{
  const { blockCacheKey } = await import(pathToFileURL(join(HERE, 'app/src/doc/cache-key.js')).href);
  let inputSig = 'x.tikz@1';
  const engine = { id: 'tectonic', keyFor: (b: any) => `e1.p.${b.source.length}.${b.context ?? ''}.${inputSig}` };
  const blk = { source: 'Text \\input{figures/x.tikz}', context: '' };
  const k1 = blockCacheKey(engine, blk, { salt: '', preHash: 'P' });
  inputSig = 'x.tikz@2';                                       // the \input file changed: the backend's key changes
  const k2 = blockCacheKey(engine, blk, { salt: '', preHash: 'P' });
  const k3 = blockCacheKey(engine, blk, { salt: 'n', preHash: 'P' });
  const k4 = blockCacheKey(engine, blk, { salt: '', preHash: 'Q' });
  check('with the backend\'s keyFor, the app\'s key follows it (an \\input file changed: a new key); the notes salt and the preamble hash still count', k1 !== k2 && k2.includes(engine.keyFor(blk)) && k3 !== k2 && k4 !== k2, JSON.stringify({ k1, k2 }));
  const v1 = { id: 'v1' };
  const a = blockCacheKey(v1, blk, { preHash: 'P' }), b = blockCacheKey(v1, { ...blk, source: blk.source + ' ' }, { preHash: 'P' });
  const broken = blockCacheKey({ id: 't', keyFor: () => { throw new Error('no build id'); } }, blk, { preHash: 'P' });
  check('without keyFor (or before the engine knows its build) the key is the hash of context and source', a !== b && a.startsWith('v1:P:') && broken.startsWith('t:P:'), JSON.stringify({ a, broken }));
}
// no read of the viewer's private state outside view/viewer-bridge.js
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const bad: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'dev' && f !== 'node_modules') walk(p); continue; }
    if (!/\.(js|ts)$/.test(f) || /viewer-bridge\.js$|\.test\.ts$/.test(f)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\.cache\??\.(layout|dom|sourceWidthSp|relayout)\b/.test(l)) bad.push(`${p.slice(HERE.length)}:${i + 1}`); }); } };
  walk(join(HERE, 'app/src'));
  check('B8: no .cache.layout / .dom / .sourceWidthSp / .relayout read of viewer state outside view/viewer-bridge.js', bad.length === 0, bad.join(' '));
}

// the route as app state: parse/format, the router writes the hash, a pane opener first
{
  const { parseRoute, formatRoute, createRouter } = await import(pathToFileURL(join(HERE, 'app/src/app/router.js')).href);
  const r1 = parseRoute('#/doc/01ABC'), r2 = parseRoute('#/'), r3 = parseRoute(''), r4 = parseRoute('#/doc/a%20b?x=1');
  check('router: parse #/doc/<id>, home otherwise; format back', r1.name === 'doc' && r1.id === '01ABC' && r2.name === 'home' && r3.name === 'home' && r4.id === 'a b' && formatRoute(r1) === '#/doc/01ABC' && formatRoute(r2) === '#/', JSON.stringify([r1, r4]));
  const handlers: Record<string, Function> = {};
  const loc = { hash: '#/' }, win = { addEventListener: (n: string, f: Function) => { handlers[n] = f; }, removeEventListener: (n: string) => { delete handlers[n]; } };
  const router = createRouter({ loc, win });
  const seen: any[] = [];
  router.onChange((r: any) => seen.push(r));
  router.openDoc('X1');
  const wrote = loc.hash;
  handlers.hashchange?.();
  router.setPaneOpener((id: string, pane: string) => pane === 'b' && id === 'Y2');
  router.openDoc('Y2', { pane: 'b' });
  const stayed = loc.hash;
  router.home(); handlers.hashchange?.();
  router.dispose();
  check('router: openDoc writes the hash, subscribers get the route; a pane opener that takes it leaves the route alone; dispose removes the listener',
    wrote === '#/doc/X1' && seen[0]?.id === 'X1' && stayed === '#/doc/X1' && router.route.peek().name === 'home' && !handlers.hashchange, JSON.stringify({ wrote, stayed, seen }));
}
// the layout as data
{
  const { createLayout } = await import(pathToFileURL(join(HERE, 'app/src/panes/layout.js')).href);
  const L = createLayout();
  const one = L.split.value;
  L.replaceDoc(null, 'D1');
  L.open('b');
  const two = L.split.value && L.pane('b')?.doc === 'D1' && L.ids().join() === 'a,b';
  L.focus('b'); L.setFocus('b', 'H1'); L.setWidth(512.4);
  const st = { f: L.focused.value, cur: L.current()?.id, focus: L.pane('b')?.focus, w: L.width.value };
  L.replaceDoc('D1', 'D2');
  const docs = L.panes.value.map((p: any) => p.doc).join();
  L.close('b');
  const after = { split: L.split.value, f: L.focused.value, w: L.width.value, ids: L.ids().join(), closeLast: L.close('a') };
  check('layout: panes as data (open, focus, section focus, width, the documents they show; closing the focused pane focuses the first; the last pane stays)',
    !one && two && st.f === 'b' && st.cur === 'b' && st.focus === 'H1' && st.w === 512 && docs === 'D2,D2' && !after.split && after.f === 'a' && after.w === null && after.ids === 'a' && after.closeLast === false, JSON.stringify({ st, docs, after }));
}
// a layout entry may name a registered view instead of a document
{
  const { createLayout } = await import(pathToFileURL(join(HERE, 'app/src/panes/layout.js')).href);
  const L = createLayout({ doc: 'D1' });
  L.open('b', { view: 'files', of: { x: 1 } });
  const e = L.pane('b');
  const opened = e.view === 'files' && e.of?.x === 1 && e.doc === null && L.isView(e) && !L.isView(L.pane('a')) && L.split.value;
  L.replaceDoc('D1', 'D2');
  const replaced = L.pane('b').view === 'files' && L.pane('b').doc === null && L.pane('a').doc === 'D2';
  L.setView('b', 'inspector');
  const swapped = L.pane('b').view === 'inspector' && L.pane('b').of === null;
  L.setDoc('b', 'D2');
  const toDoc = !L.isView(L.pane('b')) && L.pane('b').doc === 'D2';
  L.setView('b', 'files'); L.focus('b'); L.setFocus('a', 'H1');
  L.keepOnly('b');
  const kept = L.ids().join() === 'a' && L.pane('a').doc === 'D2' && L.pane('a').focus === 'H1' && !L.isView(L.pane('a'));
  check('layout: a view pane as data (open with a view, replaceDoc leaves it, setView, a document set on it makes it a document pane; keepOnly of a view pane keeps the first pane\'s document)',
    opened && replaced && swapped && toDoc && kept, JSON.stringify({ opened, replaced, swapped, toDoc, kept, panes: L.panes.value }));
}
// (the selection per pane) each pane's own UI state: its selection on its view only, a view made
// later gets it, a gone block deselected, a closed pane forgotten
{
  const { createPaneStates } = await import(pathToFileURL(join(HERE, 'app/src/panes/pane-state.js')).href);
  const mk = () => { const c = new Set<string>(); return { root: { classList: { toggle: (n: string, on: boolean) => (on ? c.add(n) : c.delete(n)), add: (n: string) => c.add(n) } }, c }; };
  const views: Record<string, any> = { 'a:x': mk(), 'a:y': mk(), 'b:x': mk() };
  const st = createPaneStates({ viewOf: (p: string, id: string) => views[`${p}:${id}`] ?? null });
  st.select('a', 'x'); st.select('a', 'y'); st.select('b', 'x');
  const marks = Object.fromEntries(Object.entries(views).map(([k, v]: any) => [k, v.c.has('selected')]));
  const later = mk(); st.applyTo('b', 'x', later.root); const other = mk(); st.applyTo('a', 'x', other.root);
  st.of('a').lastCaret = { id: 'y', offset: 3 };
  st.forget('x'); const gone = st.of('b').selected;
  st.drop('b');
  const ok = !marks['a:x'] && marks['a:y'] && marks['b:x'] && later.c.has('selected') && !other.c.has('selected') && st.of('a').selected === 'y' && gone === null && st.panes().join() === 'a' && st.of('a').lastCaret.offset === 3;
  check('pane state: a selection per pane (marked on that pane\'s view only; a view made later gets it), forget a block, drop a pane, the caret per pane', ok, JSON.stringify({ marks, gone, panes: st.panes() }));
}
// the page's signals: a change reaches its readers (not the current value at subscribing), next() is
// the next change, and the events tests wait on come from them in one place
{
  const { page, createEditorState, bump, onChange, next, dispatchForTests } = await import(pathToFileURL(join(HERE, 'app/src/app/page-state.ts')).href);
  const st = createEditorState(), other = createEditorState();
  const seen: any[] = [], fired: string[] = [];
  const off = onChange(st.displayed, (d: any) => seen.push(d.id));
  const fake = { dispatchEvent: (e: any) => { fired.push(`${e.type}:${e.detail?.id ?? e.detail?.name ?? ''}`); return true; } };
  const stop = dispatchForTests(st, fake);
  const waited = next(st.refreshed);
  bump(st.displayed, { id: 'b1' }); bump(other.displayed, { id: 'x' }); bump(st.displayed, { id: 'b2' }); bump(st.refreshed);
  page.route.value = { name: 'doc', id: 'D' };
  const r = await waited;
  off(); stop();
  bump(st.displayed, { id: 'b3' });
  check('editor state: every change reaches its readers in order (none at subscribing), next() resolves on the next one, the test events dispatched from them in one place (and stop with it); (C3) another editor\'s state is its own',
    seen.join() === 'b1,b2' && r.n >= 1 && st.displayed.peek().id === 'b3' && other.displayed.peek().id === 'x' && fired.join() === 'editor:displayed:b1,editor:displayed:b2,editor:refreshed:,editor:route:D', JSON.stringify({ seen, fired }));
}
// a block's decor reaches every view, those made later too
{
  const { createDecor } = await import(pathToFileURL(join(HERE, 'app/src/panes/decor.js')).href);
  const mk = () => { const cls = new Set<string>(); return { classList: { add: (c: string) => cls.add(c), toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)), contains: (c: string) => cls.has(c) }, dataset: {} as any, style: { m: new Map<string, string>(), setProperty(p: string, v: string) { this.m.set(p, v); }, removeProperty(p: string) { this.m.delete(p); }, getPropertyValue(p: string) { return this.m.get(p) ?? ''; } }, cls }; };
  const a = mk(), views = [a];
  const d = createDecor(() => views);
  d.cls('nest-child', true); d.cls('selected', true); d.cls('selected', false); d.data('role', 'first'); d.style('margin-top', '3px');
  const b = mk(); views.push(b); d.applyTo(b);
  d.data('role', null);
  const ok = [a, b].every((v) => v.cls.has('nest-child') && !v.cls.has('selected') && v.style.m.get('margin-top') === '3px' && v.dataset.role === undefined);
  check('decor: classes, data and styles in every view; a view made later gets them; removals reach all', ok && d.has('nest-child') && !d.has('selected'), JSON.stringify({ a: [...a.cls], b: [...b.cls] }));
}
// no page globals for the anchor keeper or the warmer; the hash written by the router only
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const bad: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'dev' && f !== 'node_modules') walk(p); continue; }
    if (!/\.(js|ts)$/.test(f) || /\.test\.ts$/.test(f)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      if (/__rtxAnchor|__rtxWarm\b|globalThis\.__rtxWarm/.test(l)) bad.push(`global ${p.slice(HERE.length)}:${i + 1}`);
      if (/location\.hash\s*=[^=]/.test(l) && !/app\/router\.js$/.test(p)) bad.push(`hash ${p.slice(HERE.length)}:${i + 1}`);
    }); } };
  walk(join(HERE, 'app/src'));
  check('no __rtxAnchor / __rtxWarm globals; location.hash is written by app/router.js only', bad.length === 0, bad.join(' '));
}
// a ligature is one glyph for 2–3 source letters: its span, and a caret between its letters inside its box
{
  const { ligatureSpan, caretPlace } = await import(pathToFileURL(join(HERE, 'app/src/view/edit-layout.js')).href);
  const src = 'the flip, the office, \\alpha f{}l';
  const spans = [
    ligatureSpan('ﬂ', 4, [0, 1, 2, 4, 6, 7], 3, src),       // ﬂ of «flip»: by Unicode
    ligatureSpan('', 4, [0, 1, 2, 4, 6, 7], 3, src),       // a private-use fl (Latin Modern): up to the next glyph
    ligatureSpan('ﬃ', 15, [14, 15, 18, 19], 1, src),        // ﬃ of «office»
    ligatureSpan('', 15, [14, 15, 18, 19], 1, src),
    ligatureSpan('f', 4, [0, 1, 2, 4, 6, 7], 3, src),            // the letter itself
    ligatureSpan('α', 22, [22, 29, 32], 0, src),            // a command's glyph
    ligatureSpan('', 29, [22, 29, 32], 1, src),            // braces between: not letters
    ligatureSpan('ﬂ', 9, [9, 10], 0, src),                  // the source has no «fl» there
  ];
  check('ligatureSpan: ﬂ, fl (private use), ﬃ, ffi (private use) span their letters; a letter, a command, f{}l and a mismatch do not',
    spans.join(',') === '2,2,3,3,0,0,0,0', spans.join(','));
  const box = (l: number, r: number) => () => ({ left: l, right: r, top: 0, bottom: 10 });
  const gs = [{ off: 2, ch: 'e', line: '0', box: box(0, 5) }, { off: 4, ch: 'ﬂ', line: '0', lig: true, span: 2, box: box(10, 20) }, { off: 6, ch: 'i', line: '0', box: box(20, 23) }];
  const at = [4, 5, 6].map((c) => caretPlace(gs, src, c));
  check('caretPlace: f|l inside ﬂ is its middle, sure; before and after it are its edges',
    at[0]?.x === 10 && at[1]?.x === 15 && at[1]?.sure === true && at[2]?.x === 20, JSON.stringify(at));
  // a hyphenated break (sim- | ulated: no space taken): the offset between m and u is on both lines; the caret is drawn at
  // the start of the next line, before u (it was drawn after the previous line's m)
  const hy = 'simulated', hg = [{ off: 0, ch: 's', line: '0', box: box(500, 505) }, { off: 2, ch: 'm', line: '0', box: box(510, 520) }, { off: -1, ch: '-', line: '0', box: box(520, 525) },
    { off: 3, ch: 'u', line: '1', box: () => ({ left: 0, right: 6, top: 20, bottom: 30 }) }];
  const brk = caretPlace(hg, hy, 3);
  check('caretPlace: at a hyphenated line break the caret is at the start of the next line (before u), not after the previous line\'s m',
    brk?.x === 0 && brk?.line === '1' && brk?.top === 20, JSON.stringify(brk));
}

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
