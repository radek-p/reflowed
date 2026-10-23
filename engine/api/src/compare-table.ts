// Tooling (Node): one Markdown table row per case, Tectonic capture vs
// LuaTeX's output.json (see compare.ts).
//   node compare-table.ts <ref-build-dir> case…
import { readFileSync, existsSync } from 'node:fs';
import { compareOutputs, lcs, type ParaReport } from './compare.ts';

const [ref, ...cases] = process.argv.slice(2);
const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');
console.log('| case | items T/L (unpaired) | paragraphs, text equal | glyphs T/L | glue T/L | kern T/L | pen. T/L | disc T/L | tokens aligned | glue specs equal | glyph metrics equal | vspace equal | displays T/L, box equal |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const tp = `${process.env.RTX_BUILD ?? "build"}/${c}/output.json`, lp = process.env.RTX_REF_FLAT ? `${ref}/${c}/output.json` : `${ref}/${c}/w0/output.json`;
  if (!existsSync(tp) || !existsSync(lp)) continue;
  const T = JSON.parse(readFileSync(tp, 'utf8')), L = JSON.parse(readFileSync(lp, 'utf8'));
  const r = compareOutputs(T, L);
  const sum = (f: (p: ParaReport) => number) => r.paragraphs.reduce((a, p) => a + f(p), 0);
  const cnt = (k: 'glyph' | 'glue' | 'kern' | 'penalty' | 'disc') => `${sum(p => p.t[k])}/${sum(p => p.l[k])}`;
  const vsT = r.vspace.t, vsL = r.vspace.l;
  // (aligned as sequences: an item more on one side shifts the rest)
  const vsEq = lcs(vsT.map(String), vsL.map(String)).length;
  console.log(`| ${c} | ${T.content.length}/${L.content.length} (${r.unpaired.t}/${r.unpaired.l}) | ${r.paragraphs.length}, ${r.paragraphs.filter(p => p.textEqual).length} | ${cnt('glyph')} | ${cnt('glue')} | ${cnt('kern')} | ${cnt('penalty')} | ${cnt('disc')} | ${pct(sum(p => p.matched), sum(p => p.tokens))} | ${pct(sum(p => p.glueEqual), sum(p => p.glueTotal))} | ${pct(sum(p => p.glyphWidthsEqual), sum(p => p.glyphWidthsTotal))} | ${vsEq}/${Math.max(vsT.length, vsL.length)} | ${r.displays.t}/${r.displays.l}, ${r.displays.boxEqual} |`);
}
