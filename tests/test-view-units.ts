// Units for view/diff.js (charDiff, Show changes) and view/copy-errors.js (errorReport, Copy), in Node; and the
// check that their plain-DOM builders are gone (the UI that shows them is Preact: edit/panel.js, sidebar/index.js)
// and that no module still imports them.
//   node tests/test-view-units.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 300)}`}`); };

const { charDiff } = await import(join(HERE, 'app/src/view/diff.js'));
const { errorReport } = await import(join(HERE, 'app/src/view/copy-errors.js'));

{
  const d = charDiff('the flip of a set', 'the flips of a set');
  check('charDiff: one insertion, prefix and suffix kept', d.prefix === 'the flip' && d.suffix === ' of a set' && d.ops.length === 1 && d.ops[0].t === '+' && d.ops[0].s === 's', d);
  const e = charDiff('abc', 'abc');
  check('charDiff: no change, no ops', e.ops.length === 0 && e.prefix === 'abc');
  const r = charDiff('x = 1', 'y = 1');
  check('charDiff: a replacement is a deletion and an insertion', r.ops.map((o: any) => o.t).join('') === '-+' && r.ops[0].s === 'x' && r.ops[1].s === 'y', r.ops);
  const big = charDiff('a'.repeat(600) + 'Q', 'b'.repeat(600) + 'Q');
  check('charDiff: a large middle is one deletion and one insertion', big.ops.length === 2 && big.ops[0].s.length === 600 && big.suffix === 'Q');
}
{
  const t = errorReport({ title: 'Paper', backend: 'tectonic', build: 'abc', where: { kind: 'paragraph', id: 'B1', index: 2, count: 9, section: '§1 Intro' },
    problem: { message: 'Undefined control sequence.', line: 3, context: 'l.3 \\foo' }, source: 'a\nb\n\\foo\nd', firstLine: 10, file: 'main.tex' });
  const lines = t.split('\n');
  check('errorReport: the document, the block and its place, the message, the line in the block and the file', lines[0] === 'Reflow TeX error report' && lines.includes('Document: Paper')
    && lines.includes('Block: paragraph B1 (block 3 of 9, in §1 Intro)') && lines.includes('Error: Undefined control sequence.') && lines.includes('Line: 3 of the block (main.tex, line 12)'), lines);
  check('errorReport: the source around the line, the line marked; the engine last', lines.includes('> 3 | \\foo') && lines[lines.length - 1] === 'Engine: tectonic, build abc', lines);
  const p = errorReport({ where: { preamble: true }, problem: { message: 'x', line: 1 } });
  check('errorReport: a preamble problem says so', p.includes('Where: the preamble (Document settings)') && p.includes('Line: 1 of the preamble'));
}
{
  const diff = readFileSync(join(HERE, 'app/src/view/diff.js'), 'utf8'), copy = readFileSync(join(HERE, 'app/src/view/copy-errors.js'), 'utf8');
  check('view/diff.js builds no DOM (diffView gone)', !/document\.createElement|export function diffView/.test(diff));
  // copyText and the one Copy button are the kit's (design/ui/copy.js): copy-errors.js builds no DOM at all
  check('view/copy-errors.js: no DOM builder (copyButton gone; copyText is the kit\'s)', !/export function copyButton/.test(copy) && !/document\.createElement/.test(copy) && /from '..\/design\/ui\/copy.js'/.test(copy));
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/^(dev|build|node_modules)$/.test(f)) walk(p); } else if (/\.(js|ts)$/.test(f)) files.push(p); } };
  walk(join(HERE, 'app/src'));
  const users = files.filter((f) => /\b(copyButton|diffView)\b/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('no module uses copyButton or diffView', users.length === 0, users.map((f) => f.slice(HERE.length)));
}
const failed = results.filter((r) => !r.ok);
console.log(`\nview units: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
