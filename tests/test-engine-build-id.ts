// The engine build id: every input that shapes a block's result is in it. On scratch files:
// touching any bundled source, the wasm, the glue, latex.fmt or a TeX file changes the id. On the real
// worker bundle: the id covers doc-fonts.ts, the public encoder (@pub) and latex.fmt, and the bundle
// carries the id (not the placeholder).
//   node tests/test-engine-build-id.ts      (needs the public reflowtex checkout beside this one)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILD_PLACEHOLDER, engineBuildId } from '../engine/scripts/engine-build-id.ts';
import { publicRepo } from '../scripts/lib/public-repo.ts';

let fail = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); if (!ok) fail++; };

const dir = mkdtempSync(join(tmpdir(), 'rtx-build-id-'));
const names = ['worker.ts', 'doc-fonts.ts', 'pub-pipeline.ts', 'wasm', 'glue.mjs', 'latex.fmt', 'lipics.cls'];
for (const f of names) writeFileSync(join(dir, f), `${f} 1`);
const inputs = () => ({ bundled: ['worker.ts', 'doc-fonts.ts', 'pub-pipeline.ts', 'virtual:glue'], absWorkingDir: dir,
  files: ['wasm', 'glue.mjs', 'latex.fmt', 'lipics.cls'].map((f) => join(dir, f)), texts: ['a.sty\nb.sty', '{}'] });
const id0 = engineBuildId(inputs()).id;
check('the same inputs: the same id', engineBuildId(inputs()).id === id0);
for (const f of names) {
  writeFileSync(join(dir, f), `${f} 2`);
  check(`touching ${f} changes the id`, engineBuildId(inputs()).id !== id0);
  writeFileSync(join(dir, f), `${f} 1`);
}
check('another embedded TeX set changes the id', engineBuildId({ ...inputs(), texts: ['a.sty', '{}'] }).id !== id0);
check('back to the same inputs: the same id again', engineBuildId(inputs()).id === id0);

const { buildWorker } = await import('../engine/scripts/build-worker.ts');
const w = await buildWorker();
const has = (re: RegExp) => w.read.some((p: string) => re.test(p));
check('the worker\'s id covers src/doc-fonts.ts', has(/engine\/src\/doc-fonts\.ts$/));
check('the worker\'s id covers the public encoder (@pub src/pipeline)', has(/\/src\/pipeline\/[^/]+\.ts$/) && w.read.some((p: string) => p.startsWith(`${publicRepo()}/`)));
check('the worker\'s id covers latex.fmt and the wasm', has(/latex\.fmt$/) && has(/tectonic_wasm\.wasm$/));
const js = readFileSync(w.path, 'utf8');
check(`the bundle carries the id ${w.build}, not the placeholder`, js.includes(JSON.stringify(w.build)) && !js.includes(BUILD_PLACEHOLDER));
console.log(`\n${n - fail}/${n} passed (${w.read.length} files in the id)`);
process.exit(fail ? 1 : 0);
