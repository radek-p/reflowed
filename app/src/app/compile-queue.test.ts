// The compile queue (app/compile-queue.js). Its two requests land the same way (app/compile-queue.js land()): the urgent one (the
// edited block, ahead of a background request in flight) brings its fonts too. It kept the block's result only, so a
// font first used by the block being edited was served with the next background request.
//   node app/src/app/compile-queue.test.ts      (Node; exit 1 on a failure)
import { createCompileQueue } from './compile-queue.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };
type Block = { id: string; source: string; kind: string };
type Req = { blocks: { id: string }[]; priority?: string };
const doc = { preamble: { source: '' }, blocks: [{ id: 'A', source: 'a', kind: 'paragraph' }, { id: 'B', source: 'b', kind: 'paragraph' }] as Block[] };
const cache = new Map<string, unknown>();
const editing = new Set<string>();
const fonts: Record<string, string>[] = [];
const preambles: unknown[] = [];
let background: ((r: unknown) => void) | null = null;
let urgentFontsSeen: (() => void) | null = null;          // the urgent request ended (the queue calls changed())
const ok = (id: string) => ({ key: id, status: 'ok', nodelist: 'x', errors: [], warnings: [] });
const backend = {
  id: 'fake',
  compile(req: Req) {
    if (req.priority === 'user') return Promise.resolve({ blocks: { B: ok('B') }, fonts: { 'new.otf': 'new-1.otf' } });
    return new Promise((r) => { background = r; });
  },
};
const perf = { disabled: false, count() {}, inputActive: () => false, untilQuiet: () => Promise.resolve(), yield: () => Promise.resolve(), slice: () => false };
const q = createCompileQueue({
  doc: () => doc, backend: () => backend, cache, keyOf: (b: Block) => `${b.id}:${b.source}`, compileSource: (b: Block) => b.source, contextOf: () => '',
  skip: () => false, isEditing: (id: string) => editing.has(id), visible: new Set(), indexOf: (id: string) => doc.blocks.findIndex((b) => b.id === id), perf,
  counters: { requests: 0, partsSent: 0, compiledIds: [] }, display() {}, redisplay() {}, stale: () => false, token: () => 0, compiling() {},
  liveSending() {}, liveLanded() {}, persist() {}, setStatus() {}, preHash: () => 'p', preambleLanded: (r: unknown) => preambles.push(r),
  applyFonts: (f: Record<string, string>) => { fonts.push(f); }, changed: () => urgentFontsSeen?.(), changedLater() {},
});
q.soon();                                                               // the background request: A (B is not edited yet)
await new Promise<void>((r) => { const t = setInterval(() => { if (background) { clearInterval(t); r(); } }, 5); });
editing.add('B'); q.markDue('B');                                       // B is edited meanwhile: its live preview is due
const seen = new Promise<void>((r) => { urgentFontsSeen = r; });
q.soon();
await seen;
check('the urgent request\'s fonts are applied when it lands, the background request still in flight', fonts.some((f) => f['new.otf'] === 'new-1.otf') && cache.has('B:b'));
check('… and the urgent request does not set the preamble\'s result (the background one\'s is the document\'s)', preambles.length === 0);
background!({ blocks: { A: ok('A') }, preamble: { errors: [] }, fonts: {} });
await q.whenSettled();
check('the background request lands its blocks, its preamble result and its fonts', cache.has('A:a') && preambles.length === 1 && fonts.length === 2);

// A long document typed in: each look over the document is one pass (every block's key once, inside the host's pass),
// and results landing while the user types are shown again once, when input is quiet (it was once per landing, all in
// one task when typing stopped).
{
  const blocks: Block[] = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, source: `text ${i}`, kind: 'paragraph' }));
  const doc2 = { preamble: { source: '' }, blocks };
  const keyCalls = new Map<string, number>();
  const perPass: number[] = [];                          // the most keys of one block computed in each pass
  let inPass = 0, outside = 0, redisplays = 0, atRequest: number[] = [];
  let quiet: (() => void) | null = null;
  const quietNow = new Promise<void>((r) => { quiet = r; });
  const perf2 = { ...perf, inputActive: () => !!quiet, untilQuiet: () => quietNow };
  const backend2 = { id: 'fake', compile(req: Req) {
    atRequest = blocks.map((b) => keyCalls.get(b.id) ?? 0);
    return Promise.resolve({ blocks: Object.fromEntries(req.blocks.map((b) => [b.id, ok(b.id)])), fonts: {} });
  } };
  const q2 = createCompileQueue({
    doc: () => doc2, backend: () => backend2,
    cache: new Map(), keyOf: (b: Block) => { if (!inPass) outside++; keyCalls.set(b.id, (keyCalls.get(b.id) ?? 0) + 1); return `${b.id}:${b.source}`; },
    pass: (fn: () => unknown) => {
      inPass++; keyCalls.clear();
      try { return fn(); } finally { inPass--; perPass.push(Math.max(0, ...keyCalls.values())); }
    },
    compileSource: (b: Block) => b.source, contextOf: () => '', skip: () => false, isEditing: () => false, visible: new Set(), indexOf: (id: string) => blocks.findIndex((b) => b.id === id),
    perf: perf2, counters: { requests: 0, partsSent: 0, compiledIds: [] }, display() {}, redisplay() { redisplays++; }, stale: () => true, token: () => 0, compiling() {},
    liveSending() {}, liveLanded() {}, persist() {}, setStatus() {}, preHash: () => 'p', preambleLanded() {}, applyFonts() {}, changed() {}, changedLater() {},
  });
  for (let k = 0; k < 3; k++) {                         // three keystrokes, each compiled and landed while input is active
    blocks[2]!.source = `text 2, typed ${k}`;
    q2.soon();
    await q2.whenSettled();
  }
  check('typing: three results landed while typing, none shown again yet', redisplays === 0 && q2.draining());
  check('typing: each pass computes every block\'s key once (want, keys, keep before the request; the count and the status after it)',
    perPass.length > 0 && perPass.every((m) => m === 1) && outside === 0, JSON.stringify({ perPass, outside }));
  check('typing: … the request carries keys computed once per block', atRequest.length === blocks.length && atRequest.every((c) => c === 1), JSON.stringify(atRequest));
  quiet!(); quiet = null;
  await quietNow; await Promise.resolve();
  check('typing: input quiet: the landed results shown again once (one redisplay for three landings)', redisplays === 1 && !q2.draining(), `redisplays ${redisplays}`);
  check('typing: waiting() is one pass and false when everything is typeset', !q2.waiting() && perPass.at(-1) === 1);
}

// A block's first compile names the files it opened (a figure a macro places): its key, which hashes them, moves. The
// result is kept under the key it moved to as well (host.landed), so the block is not sent again for the same answer.
{
  const blocks: Block[] = [{ id: 'f', source: '\\shot{x}', kind: 'figure' }, { id: 'p', source: 'text', kind: 'paragraph' }];
  const doc3 = { preamble: { source: '' }, blocks };
  const known = new Set<string>();                       // the blocks whose files are known (doc/block-files.ts note)
  const keyOf = (b: Block) => `${b.id}:${b.source}${known.has(b.id) && b.id === 'f' ? ':x.png' : ''}`;
  let requests = 0;
  // as the engine's backend: each block's result through onBlock as it is ready, then the answer
  const backend3 = { id: 'fake', compile(req: Req & { onBlock?(id: string, r: unknown): void }) {
    requests++;
    const blocks = Object.fromEntries(req.blocks.map((b) => [b.id, ok(b.id)]));
    for (const [id, r] of Object.entries(blocks)) req.onBlock?.(id, r);
    return Promise.resolve({ blocks, fonts: {} });
  } };
  const cache3 = new Map<string, unknown>();
  const q3 = createCompileQueue({
    doc: () => doc3, backend: () => backend3, cache: cache3, keyOf, compileSource: (b: Block) => b.source, contextOf: () => '', skip: () => false, isEditing: () => false,
    visible: new Set(), indexOf: (id: string) => blocks.findIndex((b) => b.id === id), perf, counters: { requests: 0, partsSent: 0, compiledIds: [] }, display() {}, redisplay() {},
    stale: () => false, token: () => 0, compiling() {}, liveSending() {}, liveLanded() {}, persist() {}, setStatus() {}, preHash: () => 'p', preambleLanded() {}, applyFonts() {},
    changed() {}, changedLater() {},
    landed: (id: string, key: string) => { const b = blocks.find((x) => x.id === id)!; if (keyOf(b) !== key || known.has(id)) return null; known.add(id); return keyOf(b); },
  });
  q3.soon();
  await q3.whenSettled();
  check('first compile: the result kept under the key it was asked for and the key the block moved to', cache3.has('f:\\shot{x}') && cache3.has('f:\\shot{x}:x.png') && cache3.has('p:text'), JSON.stringify([...cache3.keys()]));
  q3.soon();
  await q3.whenSettled();
  check('… and nothing is sent again (one request)', requests === 1 && !q3.waiting(), `requests ${requests}`);
}
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
