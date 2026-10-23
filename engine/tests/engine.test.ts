// under Node: the merged engine (Asyncify pause + engine-api capture)
// gives, per block, the output.json a full compile of the same document
// gives; nothing leaks from block to block; a block after an error is right;
// errors land on the block's own lines (context prefix included).
//   node tests/engine.test.ts        exits 1 on a failure
import { engine, fetchSync , EXTRA } from './node-host.ts';
import { buildHost, blockFile, blockProblems, capture } from '../src/compile.ts';
import { PREAMBLE, BLOCKS, LEAK_A, LEAK_B, ERRORS } from './sample.ts';
import { readFileSync } from 'node:fs';
const captureSty = readFileSync(new URL('../api/tex/rtx-template.sty', import.meta.url), 'utf8');

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
const sty = captureSty.replace('\\ProvidesPackage{rtx-template}', '\\ProvidesPackage{tectonic-capture}');

const e = await engine('async');
e.setExtraFiles({ ...EXTRA, });
const host = buildHost(PREAMBLE);
const ref: Record<string, string> = {};
const fullMs: number[] = [];
for (const [k, b] of Object.entries(BLOCKS)) {
  e.reset(); e.addFile('input.tex', host.main);
  const t = performance.now();
  const st = e.compile('input.tex', { block: blockFile(b).text });
  fullMs.push(performance.now() - t);
  check(`full compile ${k} runs`, st <= 1, e.text('input.log').slice(-300));
  ref[k] = capture(e, (n) => fetchSync(0, n)).json;
}
e.reset(); e.addFile('input.tex', host.main);
const w = e.warm('input.tex');
check('warm reaches the block', w.ok, String(w.status));
const ms: number[] = [];
for (const [k, b] of Object.entries(BLOCKS)) {
  const t = performance.now();
  const r = e.runBlock(blockFile(b).text);
  const c = capture(e, (n) => fetchSync(0, n));
  ms.push(performance.now() - t);
  check(`${k}: output.json = full compile (${(r.restoreMs + r.runMs).toFixed(0)} ms engine, ${c.ms.toFixed(0)} ms convert)`, r.status <= 1 && c.json === ref[k],
    `status ${r.status}, ${c.json.length} vs ${ref[k].length} bytes`);
  const glyphs = Object.values(c.sourcemap.items).reduce((s, a) => s + a.length / 5, 0);
  if (k === 'paragraph') check('paragraph: source map has positions', glyphs > 100 && c.sourcemap.files.some((f) => f.includes('rtx-block')), JSON.stringify(c.sourcemap.files));
}
e.runBlock(LEAK_A);
e.runBlock(LEAK_B);
const iso = /ISO: ([\s\S]*?shape=\w+)/.exec(e.text('input.log'))?.[1].replace(/\s+/g, ' ') ?? '';
check('nothing leaks', iso === 'G=no, L=no, N=no, sec=0, eq=0, parindent=15.0pt, shape=n', iso);
for (const [k, b] of Object.entries(ERRORS)) {
  const r = e.runBlock(blockFile(b).text);
  const r2 = e.runBlock(blockFile(BLOCKS.paragraph).text);
  const same = capture(e, (n) => fetchSync(0, n)).json === ref.paragraph;
  check(`error ${k}: reported, next block right`, r.status >= 2 && r2.status <= 1 && same);
}
// errors on the block's own line, with a context prefix of two lines
{
  const f = blockFile('First line.\nSecond \\undefinedcs{} line.', '\\makeatletter\\@afterheading\\makeatother\n\\relax');
  e.runBlock(f.text);
  const log = e.text('input.log').slice(e.preambleLog.length);
  const p = blockProblems(log, f.firstLine, f.lines);
  check('error line is the block\'s own (context prefix skipped)', p.errors[0]?.line === 2, JSON.stringify(p.errors));
  const f2 = blockFile('\\begin{itemize}\\item open');
  e.runBlock(f2.text);
  const p2 = blockProblems(e.text('input.log').slice(e.preambleLog.length), f2.firstLine, f2.lines);
  check('unclosed environment: an error without a line', p2.errors.length > 0 && p2.errors.every((x) => x.line === null), JSON.stringify(p2.errors));
}
// TikZ in the warm engine: a picture node and its SVG from the XDV page (tex/rtx-pictures.sty)
{
  const h2 = buildHost(`${PREAMBLE}\n\\usepackage{tikz}`);
  e.reset(); e.addFile('input.tex', h2.main);
  check('warm with tikz', e.warm('input.tex').ok);
  const r = e.runBlock(blockFile(String.raw`Before \begin{tikzpicture}\draw[red,->] (0,0) -- (2,1) node[right] {$f(x)$};\end{tikzpicture} after.`).text);
  const c = capture(e, (n) => fetchSync(0, n));
  const pics: any[] = [];
  const walk = (ns: any[]) => { for (const n of ns ?? []) { if (n.type === 'picture') pics.push(n); walk(n.children); } };
  for (const p of c.output.paragraphs) walk(p.nodes);
  const svg = pics[0] ? c.tikz(1, pics[0].width, pics[0].height, pics[0].depth) : null;
  check('tikz: one picture node with its SVG (path + label glyphs)', r.status <= 1 && pics.length === 1 && pics[0].file === 'rtx-picture:1'
    && !!svg && /viewBox='0 0 /.test(svg) && /<path/.test(svg) && /<use/.test(svg), `${pics.length} ${String(svg).slice(0, 200)}`);
  e.reset(); e.addFile('input.tex', host.main); e.warm('input.tex');
}
// warm twice in a row, and a full compile right after a warm: the paused run
// is finished first (a regression: the driver's state stayed borrowed → "Aborted()")
{
  e.cool(); e.reset(); e.addFile('input.tex', host.main);
  const a = e.warm('input.tex');
  e.cool(); e.reset(); e.addFile('input.tex', buildHost(`${PREAMBLE}\n\\usepackage{xcolor}`).main);
  const b = e.warm('input.tex');
  e.cool(); e.reset(); e.addFile('input.tex', host.main.replace('\\csname @@input\\endcsname rtx-block.tex ', 'Full.\n'));
  const st = e.compile('input.tex', { capture: 0 });
  e.reset(); e.addFile('input.tex', host.main);
  const c = e.warm('input.tex');
  check('re-warm and full compile after a warm', a.ok && b.ok && st <= 1 && c.ok, JSON.stringify([a.ok, b.ok, st, c.ok]));
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`median ms: full compile ${med(fullMs).toFixed(0)}, warm block (engine + convert) ${med(ms).toFixed(0)}; snapshot ${(w.bytes! / 1e6).toFixed(0)} MB`);
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
