// Margin protrusion through the capture: with microtype, every font used carries the protrusion codes
// of the characters a line can end or start with, the hyphen character included (a discretionary's pre-break
// hyphen: patch 0008; before it the hyphen had no code unless one was typeset, so a break's hyphen did not
// hang in the reader). A Libertine preamble (OpenType, XeTeX) and a T1 Latin Modern one (TFM).
//   node tests/protrusion.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { engine, local, TC, EXTRA, fetchSync, ENGINE } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
import { walk } from '../build/engine-api-src/rtx/shared/tree.ts';
const { MICROTYPE } = await import('../../scripts/seed.ts');

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d).slice(0, 600)}` : ''}`); };
const TEXT = 'Words instrumentalisation characteristically counterrevolutionary internationalisation representationalism, in a paragraph long enough to break at hyphens: incomprehensibility, unconstitutionally, electroencephalographically.';

for (const f of readdirSync(ENGINE + 'tex')) if (!f.endsWith('.sty')) local.set(f, readFileSync(ENGINE + 'tex/' + f));
const cases: [string, string, Record<string, string>][] = [
  ['Libertine (OpenType, XeTeX)', `\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{libertine}\n${MICROTYPE}`, {}],
  ['Latin Modern T1 (TFM)', `\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n${MICROTYPE}`, {}],
];
for (const [name, preamble, extra] of cases) {
  const e = await engine(process.env.RTX_ENGINE_VARIANT ?? 'async');   // (an unshipped build: ../dist-next/async)
  e.setExtraFiles({ ...EXTRA, ...extra });
  e.reset(); e.addFile('input.tex', buildHost(preamble).main);
  if (!e.warm('input.tex').ok) { check(`${name}: the preamble warms`, false); continue; }
  const r = e.runBlock(blockFile(TEXT).text);
  const out: any = capture(e, (x) => fetchSync(0, x)).output;
  const p = out.paragraphs?.[0];
  check(`${name}: the block compiles, protrusion on`, r.status <= 1 && p?.protrude_chars > 0, { status: r.status, protrude: p?.protrude_chars });
  const discs: any[] = [], count = new Map<number, number>();
  walk(p?.nodes ?? [], (x: any) => { if (x.type === 'disc') discs.push(x); if (x.type === 'glyph') count.set(x.font, (count.get(x.font) ?? 0) + 1); });
  // the text font: the one most glyphs are in; its hyphen: a discretionary's pre glyph, else the font's hyphen character
  const main = [...count].sort((x, y) => y[1] - x[1])[0]?.[0];
  const codes: any[] = out.fonts?.[main]?.codes ?? [];
  const hy = discs.map((d) => (d.pre ?? []).find((g: any) => g.type === 'glyph' && g.font === main)).find(Boolean);
  const hyChars = hy ? [hy.char] : [45, 127];
  const code = codes.find((c: any) => hyChars.includes(c.char) && c.rp > 0);
  check(`${name}: the text font's hyphen (${hy ? `a discretionary's, char ${hy.char}` : 'char 45 or 127'}) has its right protrusion code`, !!code,
    { discs: discs.length, codes: codes.map((c: any) => [c.char, c.rp]) });
  check(`${name}: and the comma has one (codes captured at all)`, codes.some((c: any) => c.char === 44 && c.rp > 0), codes.map((c: any) => c.char));
}
console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
