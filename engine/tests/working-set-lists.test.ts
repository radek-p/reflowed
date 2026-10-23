// The list files of the embedded TeX set (build-worker.ts WORKING_SET_LISTS): each one exists (a missing list reads
// as empty, so a wrong path would drop its files quietly and the dev pack, tests/integration/tex-pack.ts, would not see
// it change), and every name in each one is in workingSetNames().
//   node tests/working-set-lists.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { WORKING_SET_LISTS, workingSetNames } from '../scripts/build-worker.ts';

let fail = 0, n = 0;
const check = (what: string, ok: boolean, detail = '') => { n++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const names = new Set(workingSetNames());
for (const f of WORKING_SET_LISTS) {
  check(`${basename(f)} exists`, existsSync(f), f);
  if (!existsSync(f)) continue;
  const listed = readFileSync(f, 'utf8').split('\n').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && !s.startsWith('#'));
  const lost = listed.filter((s) => !names.has(s));
  check(`every name in ${basename(f)} is in the embedded set (${listed.length})`, lost.length === 0, lost.slice(0, 8).join(', '));
}
console.log(`\n${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
