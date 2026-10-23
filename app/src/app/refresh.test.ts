// app/refresh.ts with a fake clock and a fake input state: when the whole-document refresh runs.
//   node app/src/app/refresh.test.ts      (Node; exit 1 on a failure)
import { createRefresh, BG_MS, TYPED_MS, type Clock } from './refresh.ts';
import { definitionOf } from './goto-definition.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

// a clock that runs only when told
function fakeClock() {
  let t = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = { setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; }, clearTimeout: (id) => { timers.delete(id as number); } };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
    }
    t = end;
  };
  return { clock, advance, now: () => t };
}
function setup() {
  const c = fakeClock();
  let lastInput = -1e9;
  const counts: Record<string, number> = {};
  const runs: number[] = [];
  const perf = { inputActive: () => c.now() - lastInput < 300, quietMs: 300, count: (k: string) => { counts[k] = (counts[k] ?? 0) + 1; } };
  const r = createRefresh({ hasDoc: () => true, perf, work: () => runs.push(c.now()), clock: c.clock });
  return { r, c, runs, counts, input: () => { lastInput = c.now(); } };
}

{
  const { r, c, runs } = setup();
  r.changed();
  check('changed(): pending, then it runs at once (next task)', r.pending && (c.advance(0), runs.length === 1) && !r.pending, runs);
}
{
  const { r, c, runs, input } = setup();
  // 24 keystrokes, 60 ms apart: each is an input and a typed()
  for (let k = 0; k < 24; k++) { input(); r.typed(); c.advance(60); }
  check('typing at a steady pace: no refresh while it goes on', runs.length === 0, runs);
  c.advance(400);
  check('… one once input has been quiet', runs.length === 1, runs);
}
{
  const { r, c, runs, input } = setup();
  r.typed(); r.typed(); r.typed();
  c.advance(TYPED_MS);
  check('typed() several times, no input meanwhile: one refresh, TYPED_MS later', runs.length === 1 && runs[0] === TYPED_MS, runs);
  input(); r.changed(); c.advance(0);
  check('changed() during input: deferred (counted), then run after the quiet time', runs.length === 1 && (c.advance(300), runs.length === 2), runs);
}
{
  const { r, c, runs } = setup();
  r.changedLater(); c.advance(BG_MS / 2); r.changedLater(); r.changedLater();
  c.advance(BG_MS);
  check('background results within BG_MS: one refresh', runs.length === 1, runs);
  r.changedLater(); r.changed(); c.advance(0);
  check('changed() after changedLater(): at once, not BG_MS later', runs.length === 2 && !r.background, runs);
}

// goto-definition (app/goto-definition.ts): the same unit run (both were app.js's refresh section)
{
  const blocks = [{ id: 'a', source: 'Intro \\label{sec:intro} text' }, { id: 'b', source: '\\bibitem[X]{knuth84} Knuth' }, { id: 'c', kind: 'bibliography', source: '\\printbibliography' }];
  const refs = { labels: { 'sec:intro': { blockId: 'a', offset: 6 } }, bib: { lamport: { label: 'Lamport 1994' } } };
  const r1 = definitionOf({ type: 'ref', key: 'sec:intro' }, { blocks, refs });
  check('a \\ref: its \\label\'s block and range', r1.block === 'a' && 'range' in r1 && r1.range?.from === 6, r1);
  const r2 = definitionOf({ type: 'ref', key: 'nope' }, { blocks, refs: { labels: {}, bib: {} } });
  check('a \\ref with no \\label: says so', !r2.block && r2.say === 'No \\label{nope} in this document', r2);
  const r3 = definitionOf({ type: 'cite', key: 'knuth84' }, { blocks, refs });
  check('a \\cite with a \\bibitem: its key in that block', r3.block === 'b' && 'range' in r3 && blocks[1]!.source.slice(r3.range!.from, r3.range!.to) === 'knuth84', r3);
  const r4 = definitionOf({ type: 'cite', key: 'lamport' }, { blocks, refs });
  check('a \\cite only in the .bbl data: the bibliography block, not edited, and a message', r4.block === 'c' && 'edit' in r4 && r4.edit === false && /Lamport 1994/.test(r4.say ?? ''), r4);
  check('an unknown \\cite: says so', definitionOf({ type: 'cite', key: 'zz' }, { blocks, refs }).say === 'No entry zz in the bibliography');
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
