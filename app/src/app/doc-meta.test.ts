// app/doc-meta.ts with a fake host: what a new preamble and a new bibliography ask of the editor, in order; an unchanged
// preamble asks nothing; the References pane's follow-up runs when it gave one, and again on an undo or a redo.
//   node app/src/app/doc-meta.test.ts      (Node; exit 1 on a failure)
import { createDocMeta, type DocMetaHost, type MetaDoc, type Bib } from './doc-meta.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const tick = () => new Promise((r) => setTimeout(r, 0));

function fake(preambleErrors: unknown[] = []) {
  const log: string[] = [];
  const d: MetaDoc = { preamble: { source: '\\documentclass{article}', rev: 1 }, bib: null, blocks: [{}, {}] };
  const host: DocMetaHost = {
    doc: () => d,
    saveMeta: (p) => log.push(`save ${Object.keys(p).join()}`),
    backend: () => ({ setPreamble: async (s) => { log.push(`engine preamble ${s.length}`); return { errors: preambleErrors }; }, setBib: (b) => log.push(`engine bib ${b?.kind ?? 'none'}`) }),
    enginePreamble: () => d.preamble.source,
    preambleChanged: () => log.push('derived'), statusFull: () => log.push('full bar'),
    setPreambleResult: (r) => log.push(`result ${r.errors?.length ?? 0}`), showPreambleState: () => log.push('shown'),
    everyBlockChanged: () => log.push('every block'), compileSoon: () => log.push('compile'), warm: () => log.push('warm'),
    perform: (label, f) => { log.push(`step ${label}`); f(); },
  };
  return { meta: createDocMeta(host), log, d };
}

{
  const { meta, log, d } = fake();
  meta.putPreamble(d.preamble.source);
  check('the same preamble: nothing saved, nothing recompiled', log.length === 0, log);
  meta.putPreamble('\\documentclass{amsart}');
  await tick(); await tick();
  check('a new preamble: saved (its revision moved), every block again, the engine told, then the queue looks again',
    d.preamble.rev === 2 && log.join('|') === 'save preamble|full bar|derived|result 0|shown|engine preamble 22|every block|warm|compile', log);
}
{
  const { meta, log } = fake([{ message: 'Undefined control sequence' }]);
  meta.onPreamble();
  await tick(); await tick();
  check('the engine finds errors in the preamble: they are shown', log.includes('result 1') && log.filter((x) => x === 'shown').length === 2, log);
}
{
  const { meta, log, d } = fake();
  const follow: string[] = [];
  const bib: Bib = { kind: 'bbl', entries: [1, 2, 3] };
  meta.setBibliography(bib, 'Import a .bbl', (b) => follow.push(`pane ${b?.kind}`));
  check('a new bibliography: one undo step, saved, the engine told, every block again; the pane\'s follow-up runs',
    d.bib === bib && log.join('|') === 'step Import a .bbl|save bib|engine bib bbl|every block' && follow.join() === 'pane bbl', log);
  meta.applyBib(null);
  check('applyBib without a follow-up: the pane\'s last one does not run', follow.length === 1, follow);
  meta.bibAgain(bib);
  check('an undo or a redo of it: the pane\'s last follow-up runs again', follow.length === 2 && d.bib === bib, follow);
  check('bibInfo: the kind and the entries', meta.bibInfo() === 'bbl · 3 entries', meta.bibInfo());
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
