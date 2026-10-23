// Damaged uploads: each fails with a message a person can act on,
// or imports with a warning, and never leaves half a document in the store.
// For Node (scripts/test-w2.ts prints the checks) on a memory store.

import type { Check } from '../store/store.suite.ts';
import type { DocStore } from '../store/types.ts';
import { importIntoStore, importUpload } from './import.ts';
import { writeTar, writeZip } from './archive.ts';
import { gzip } from './gzip.ts';
import { exportSingle } from './export.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const MAIN = '\\documentclass{article}\n\\begin{document}\nHello.\n\n\\input{sec}\n\\end{document}\n';
const SEC = 'A section file with some text that is long enough to be worth cutting in the middle of it.\n';

export async function runDamagedSuite(label: string, make: () => Promise<DocStore>): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean, info = '') => { out.push({ name: `${label}: ${name}`, ok, info }); };
  const store = await make();
  const count = async () => (await store.listDocs({ includeDeleted: true })).length;
  const fails = async (name: string, data: Uint8Array): Promise<string> => {
    try { await importIntoStore(store, name, data); return ''; } catch (e) { return (e as Error).message; }
  };
  try {
    const n0 = await count();
    const tar = writeTar([{ path: 'main.tex', data: enc(MAIN) }, { path: 'sec.tex', data: enc(SEC) }]);
    const zip = await writeZip([{ path: 'main.tex', data: enc(MAIN) }, { path: 'sec.tex', data: enc(SEC.repeat(20)) }]);

    // a partial download of each kind
    const cutTar = tar.subarray(0, 512 + 512 + 512 + 40);          // main.tex whole, sec.tex's header and part of its text
    let m = await fails('paper.tar', cutTar);
    check('a tar cut short: fails naming the file, instead of importing it truncated', /tar: sec\.tex is cut short/.test(m), m);
    const tgz = await gzip(tar);
    m = await fails('paper.tar.gz', tgz.subarray(0, tgz.length - 30));
    check('a .tar.gz cut short: fails saying it cannot be unpacked (maybe incomplete)', /paper\.tar\.gz: cannot be unpacked .*incomplete/.test(m), m);
    m = await fails('paper.zip', zip.subarray(0, zip.length - 30));
    check('a zip cut short (no central directory): fails saying so', /zip: no central directory/.test(m), m);
    const broken = zip.slice();
    broken[60] ^= 0xff; broken[61] ^= 0xff;                     // inside main.tex's data
    m = await fails('paper.zip', broken);
    check('a zip whose data is damaged: fails naming the file (checksum or unpacking)', /zip: main\.tex (cannot be unpacked|is damaged)/.test(m), m);
    m = await fails('empty.zip', await writeZip([{ path: 'figure.png', data: enc('png') }]));
    check('a zip with no .tex: fails saying so', /no \.tex file found/.test(m), m);
    check('nothing half-imported: no document was created by the failures', (await count()) === n0, `${n0} → ${await count()}`);

    // paths that climb out of the project
    const slip = await importUpload('slip.zip', [{ path: 'main.tex', data: enc(MAIN) }, { path: 'sec.tex', data: enc(SEC) }, { path: '../../evil.sty', data: enc('%') }, { path: 'figs/../fig.png', data: enc('p') }]);
    const names = (slip.init.assets ?? []).map((a) => a.name);
    check('a path out of the project (../) is left out with a warning; a/../b is b', !names.some((n) => n.includes('..')) && names.includes('fig.png') && slip.report.warnings.some((w) => /evil\.sty: outside the project folder/.test(w)),
      `${names.join(',')} | ${slip.report.warnings.join(' | ')}`);

    // a marked export edited by hand: a quote with no end in a marker line
    const id = await importIntoStore(store, 'ok.tar', tar);
    const doc = await store.getDoc(id.docId);
    const single = exportSingle(doc!, doc!.blocks, doc!.assets).text.replace(/title="[^"]*"/, 'title="Hand \\edited');
    const back = await importUpload('main.tex', [{ path: 'main.tex', data: enc(single) }]);
    check('a marked file with a damaged marker line still imports (its blocks back)', (back.init.blocks ?? []).length === doc!.blocks.length, `${(back.init.blocks ?? []).length} vs ${doc!.blocks.length}`);
  } catch (e) {
    check('(exception)', false, (e as Error).stack ?? String(e));
  } finally {
    store.close();
  }
  return out;
}
