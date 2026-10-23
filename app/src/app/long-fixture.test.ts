// long-fixture.ts: the intro repeated is a long document whose labels are unique and whose references all resolve.
//   node app/src/app/long-fixture.test.ts      (needs build/seed/intro.json: node scripts/seed.ts)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { longSeed, suffixLabels } from './long-fixture.ts';

let n = 0, bad = 0;
const check = (what: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — ${JSON.stringify(d).slice(0, 400)}`}`); };
check('suffixLabels: labels and every key of a reference list', suffixLabels('\\label{a} \\cref{a,b} \\Cref{c} \\cite{k}', '-c1') === '\\label{a-c1} \\cref{a-c1,b-c1} \\Cref{c-c1} \\cite{k}');
const p = fileURLToPath(new URL('../../../build/seed/intro.json', import.meta.url));
if (!existsSync(p)) check('build/seed/intro.json is there (node scripts/seed.ts)', false);
else {
  const intro = JSON.parse(readFileSync(p, 'utf8'));
  const s = longSeed(intro, 6);
  const bs = s.init.blocks ?? [];
  const labels = bs.flatMap((b) => [...b.source.matchAll(/\\label\{([^}]*)\}/g)].map((m) => m[1]));
  const refs = bs.flatMap((b) => [...b.source.matchAll(/\\(?:ref|cref|Cref|eqref)\{([^}]*)\}/g)].flatMap((m) => m[1].split(',')));
  check(`about 6 × the intro's body: ${bs.length} blocks`, bs.length > 200 && bs.length < 6 * intro.init.blocks.length, bs.length);
  check('one title, one bibliography', bs.filter((b) => b.kind === 'title').length === 1 && bs.filter((b) => b.kind === 'bibliography').length === 1);
  check('every label unique', new Set(labels).size === labels.length, labels.length);
  check('every reference has its label', refs.every((r) => labels.includes(r)), refs.filter((r) => !labels.includes(r)).slice(0, 5));
  check('unique block ids, another doc id, tagged long, the intro\'s assets', new Set(bs.map((b) => b.id)).size === bs.length && s.id !== intro.id && s.init.meta?.tags?.[0] === 'long'
    && (s.init.assets as unknown[]).length === intro.init.assets.length);
  check('the same document every time (seeded ids)', JSON.stringify(longSeed(intro, 6)) === JSON.stringify(s));
}
console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
