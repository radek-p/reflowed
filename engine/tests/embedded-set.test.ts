// The default document (the intro, build/seed/intro.json: what the single
// file opens) compiled with ONLY the embedded TeX set (what scripts/build.ts
// packs: build-worker.ts workingSetNames() + tex/) and the document's own
// assets and bbl, block by block with context prefix, as the editor
// does. Fails on any missing-file error (the user's `size11.clo' not found)
// and on any file TeX asked for that the full bundle has but the set lacks.
// Then the tier documents (scripts/tiers.ts: the default embedded set for
// other papers) the same way: every block compiles, nothing is missing.
//   node tests/embedded-set.test.ts [--no-tiers]   → build/embedded-set.json
import { readFileSync, writeFileSync } from 'node:fs';
import { WarmEngine } from '../src/engine.ts';
import { buildHost, blockFile, blockProblems, preambleProblems, capture, nameMissing } from '../src/compile.ts';
import { fetchSync, index, local, EXTRA, ENGINE } from './node-host.ts';
import { workingSetNames } from '../scripts/build-worker.ts';
import { compileJobs } from '../../app/src/nesting/compile-jobs.ts';
import { TIERS } from '../scripts/tiers.ts';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const seed = JSON.parse(readFileSync(new URL('../../build/seed/intro.json', import.meta.url), 'utf8')).init;
const set = new Set([...workingSetNames(), ...local.keys()]);
for (const a of seed.assets) local.set(a.name, Buffer.from(a.base64, 'base64'));
const refused = new Set<string>();
const restricted = (kind: number, name: string) => {
  if (kind === 1 || local.has(name) || set.has(name)) return fetchSync(kind, name);
  if (index.has(name)) refused.add(name);
  return null;
};
const dir = ENGINE + 'dist/async/';
const e = await WarmEngine.create({ createModule: (await import(dir + 'tectonic.mjs')).default, wasmBinary: readFileSync(dir + 'tectonic_wasm.wasm'),
  glue: readFileSync(dir + 'tectonic.mjs', 'utf8'), fetchSync: restricted });
e.setExtraFiles(EXTRA);
const has = (n: string) => set.has(n) || local.has(n);

const host = buildHost(seed.preamble);
e.reset(); e.addFile('input.bbl', seed.bib.source); e.addFile('input.tex', host.main);
const w = e.warm('input.tex');
const pre = preambleProblems(w.ok ? e.preambleLog : e.text('input.log'), host);
nameMissing(pre.errors, has);
check(`the default document's preamble warms with the embedded set only (${set.size} files)`, w.ok && pre.errors.length === 0, JSON.stringify(pre.errors.slice(0, 3)));

const MARKERS = new Set(['macros', 'comment', 'appendix']);
const blocks = seed.blocks as { id?: string; kind: string; source: string; attrs?: any }[];
// as the app compiles them: a nested seed's containers are not compiled, a child gets its environment's head and end
const rows: { i: number; kind: string; ok: boolean; ms: number; errors: string[] }[] = [];
const disp = { displays: 0, modelled: 0, skipped: {} as Record<string, number> };
for (const { i, block: b, source, context } of compileJobs(blocks, { bbl: seed.bib?.kind === 'bbl' ? seed.bib.source : null })) {
  if (MARKERS.has(b.kind)) continue;
  const f = blockFile(source, context);
  const t = performance.now();
  const r = e.runBlock(f.text);
  const p = blockProblems(e.text('input.log').slice(e.preambleLog.length), f.firstLine, f.lines);
  nameMissing(p.errors, has);
  let ok = r.status <= 1 && p.errors.length === 0;
  if (ok) try {
    const c = capture(e, (n) => restricted(0, n));
    disp.displays += c.displays.displays; disp.modelled += c.displays.modelled;
    for (const [k, v] of Object.entries(c.displays.skipped)) disp.skipped[k] = (disp.skipped[k] ?? 0) + v;
  } catch (x) { ok = false; p.errors.push({ severity: 'error', message: `capture: ${(x as Error).message}`, line: null }); }
  rows.push({ i, kind: b.kind, ok, ms: Math.round(performance.now() - t), errors: p.errors.map((x) => x.message) });
}
const missing = rows.flatMap((r) => r.errors.filter((m) => /not found|embedded TeX set/.test(m)).map((m) => `#${r.i}: ${m}`));
check('no block has a missing-file error', missing.length === 0, missing.slice(0, 5).join(' | '));
const bad = rows.filter((r) => !r.ok);
check(`every block compiles: ${rows.length - bad.length}/${rows.length}`, bad.length === 0, bad.slice(0, 5).map((r) => `#${r.i} ${r.kind}: ${r.errors.join('; ').slice(0, 160)}`).join(' | '));
check('TeX asked for no bundle file the set lacks', refused.size === 0, [...refused].slice(0, 20).join(' '));
const ms = rows.map((r) => r.ms).sort((a, b) => a - b), q = (x: number) => ms[Math.floor(x * (ms.length - 1))];
console.log(`displays: ${disp.displays}, at the reader's width (route 1 model) ${disp.modelled}, kept at the compile width: ${JSON.stringify(disp.skipped)}`);
console.log(`blocks ${rows.length}, ms per block p10/50/90/max ${q(0.1)}/${q(0.5)}/${q(0.9)}/${q(1)} (Node, engine + capture)`);
// ── the tier documents ──────────────────────────────────────────────────────
const tiers: { tier: number; name: string; ok: number; n: number; errors: string[] }[] = [];
if (!process.argv.includes('--no-tiers')) {
  refused.clear();
  for (const d of TIERS) {
    const h = buildHost(d.preamble);
    e.cool(); e.reset(); e.addFile('input.tex', h.main);
    const wd = e.warm('input.tex');
    const pd = preambleProblems(wd.ok ? e.preambleLog : e.text('input.log'), h);
    nameMissing(pd.errors, has);
    const errs: string[] = wd.ok ? [] : pd.errors.map((x) => `preamble: ${x.message}`).concat(pd.errors.length ? [] : ['preamble: does not reach \\begin{document}']);
    let ok = 0;
    if (wd.ok) for (const [i, src] of d.blocks.entries()) {
      const f = blockFile(src);
      const r = e.runBlock(f.text);
      const p = blockProblems(e.text('input.log').slice(e.preambleLog.length), f.firstLine, f.lines);
      nameMissing(p.errors, has);
      if (r.status <= 1 && !p.errors.length) { try { capture(e, (n) => restricted(0, n)); ok++; } catch (x) { errs.push(`#${i} capture: ${(x as Error).message}`); } }
      else errs.push(`#${i}: ${p.errors.map((x) => x.message).join('; ').slice(0, 200)}`);
    }
    tiers.push({ tier: d.tier, name: d.name, ok, n: d.blocks.length, errors: errs });
    check(`tier ${d.tier}: ${d.name}: ${ok}/${d.blocks.length} blocks with the embedded set`, ok === d.blocks.length, errs.slice(0, 3).join(' | '));
  }
  check('tiers: TeX asked for no bundle file the set lacks', refused.size === 0, [...refused].slice(0, 30).join(' '));
}
writeFileSync(ENGINE + 'build/embedded-set.json', JSON.stringify({ set: set.size, refused: [...refused], displays: disp, rows, tiers }, null, 1));
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
