// The compile queue's two requests land the same way (app/compile-queue.js land()): the urgent one (the
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
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
