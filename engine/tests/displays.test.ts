// V3: a display compiled once at the document's width, evaluated by the
// public viewer's own display code (affineDisplayItem + placeEquationNumber)
// at other widths, against the same block compiled at those widths.
// Route 1 (primitive displays: TeX's §1199–§1205 from the recorded inputs)
// and route 2 (amsmath's alignments, a number on its own line: the block
// compiled 24 and 48 pt wider, src/fidelity/resample.ts). For every row:
// the ink's left edge and the equation number's right edge within 1 px
// (0.75 pt) of the real compile's, and a number's right edge on the
// column's right edge; nothing outside the column.
//   node tests/displays.test.ts
import { engine, EXTRA } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
import { modelDisplays } from '../src/displays.ts';
import { resampler, joinContext } from '../src/fidelity/resample.ts';

(globalThis as any).document ??= { currentScript: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {}, readyState: 'complete', documentElement: { classList: { toggle() {} } } };
(globalThis as any).window ??= globalThis;
(globalThis as any).location ??= { search: '', href: 'file:///' };
for (const k of ['IntersectionObserver', 'ResizeObserver', 'MutationObserver']) (globalThis as any)[k] ??= class { observe() {} unobserve() {} disconnect() {} };
(globalThis as any).matchMedia ??= () => ({ matches: false, addEventListener() {} });
(globalThis as any).addEventListener ??= () => {};
// the viewer's display code, bundled (it imports TypeScript Node cannot strip)
const { publicRepo } = await import('../../scripts/lib/public-repo.ts');
const { join } = await import('node:path');
const esbuild = (await import('esbuild')).default ?? await import('esbuild');
const vout = new URL('../build/viewer-display.mjs', import.meta.url).pathname;
await esbuild.build({ entryPoints: [join(publicRepo(), 'src/viewer/src/engine/layout/display.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: vout, logLevel: 'error' });
const { affineDisplayItem, placeEquationNumber } = await import(vout);

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
const PT = 65536, PX = 0.75 * PT;           // 1 CSS px = 0.75 pt

const PREAMBLE = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb}
\newtheorem{lemma}{Lemma}`;
type Case = { src: string; numbered: boolean; route: 1 | 2 | 0; lastOnly?: boolean };
const BLOCKS: Record<string, Case> = {
  equation: { src: String.raw`Text before.
\begin{equation}\label{eq:a} \sum_{i=1}^{n} x_i \leq \int_0^1 f(t)\,dt \end{equation}
Text after.`, numbered: true, route: 1 },
  'equation*': { src: String.raw`Text. \begin{equation*} a^2 + b^2 = c^2 \end{equation*} More.`, numbered: false, route: 1 },
  brackets: { src: String.raw`Text \[ \frac{a}{b} + \sqrt{x} \] more.`, numbered: false, route: 1 },
  eqno: { src: String.raw`Text $$ x = y \eqno(7) $$ more.`, numbered: true, route: 1 },
  wide: { src: String.raw`A long one: \begin{equation} a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12} + a_{13} \end{equation}`, numbered: true, route: 1 },
  align: { src: String.raw`Text. \begin{align} a &= b + c \\ c &= d \end{align} After.`, numbered: true, route: 2 },
  // the paper's Lemma 1.5: an align in a theorem, labelled rows
  'align in a lemma': { src: String.raw`\begin{lemma}\label{lem:x} For every graph $G$ we have
\begin{align}
\chi(G)&\le \omega(G)+1\le \Delta(G),\label{eq:s1}\\
\chi(G)&\le \omega(G)+1\le \Delta_{2r-1}(G).\label{eq:s2}
\end{align}
\end{lemma}`, numbered: true, route: 2 },
  'align, two columns': { src: String.raw`\begin{align} x &= 1 & y &= 2 \\ x' &= 3 & y' &= 4 \end{align}`, numbered: true, route: 2 },
  'align*': { src: String.raw`Text. \begin{align*} a &= b \\ c &= d + e \end{align*} After.`, numbered: false, route: 2 },
  gather: { src: String.raw`\begin{gather} a = b \\ c + d = e \end{gather}`, numbered: true, route: 2 },
  multline: { src: String.raw`\begin{multline} a + b + c \\ = d + e \end{multline}`, numbered: true, route: 2, lastOnly: true },
  'align in a list': { src: String.raw`\begin{itemize}\item An item: \begin{align} p &= q \\ r &= s \end{align}\end{itemize}`, numbered: true, route: 2 },
};

const e = await engine('async');
e.setExtraFiles({ ...EXTRA });
const host = buildHost(PREAMBLE);
e.reset(); e.addFile('input.tex', host.main);
check('warm', e.warm('input.tex').ok);
const widthCtx = (pt: number) => `\\hsize=${pt}pt\\textwidth=\\hsize\\linewidth=\\hsize\\columnwidth=\\hsize`;
/** The block as the worker compiles it: route 1 in capture, route 2 from the samples. */
function run(src: string, ctx = '', samples = true) {
  const r = e.runBlock(blockFile(src, ctx).text);
  if (r.status > 1) throw new Error(e.text('input.log').slice(-400));
  const rs = samples ? resampler(e, (pre) => blockFile(src, joinContext(ctx, pre)).text, () => null) : undefined;
  const c = (capture as any)(e, () => null, 'input', { resample: rs });
  const stats = rs ? modelDisplays(c.output, rs) : c.displays;
  return { ...c, stats };
}
const displays = (out: any) => (out.content as any[]).filter((it) => it.kind === 'display');

/** Ink extent of a row (sp from the column's left edge): glyphs and rules, the viewer's glue arithmetic. */
function ink(item: any) {
  let min = Infinity, max = -Infinity, lastGlyphRight = -Infinity;
  const hbox = (b: any, x0: number) => {
    let x = x0;
    for (const n of b.children ?? []) {
      switch (n.type) {
        case 'glyph': min = Math.min(min, x); max = Math.max(max, x + n.width); lastGlyphRight = Math.max(lastGlyphRight, x + n.width); x += n.width; break;
        case 'rule': if ((n.width ?? 0) > 0 && ((n.height ?? 0) + (n.depth ?? 0)) > 0) { min = Math.min(min, x); max = Math.max(max, x + n.width); } x += Math.max(0, n.width ?? 0); break;
        case 'kern': x += n.kern ?? 0; break;
        case 'math': x += n.surround ?? 0; break;
        case 'glue': {
          let w = n.width ?? 0;
          if (b.glue_sign === 1 && (n.stretch_order ?? 0) === (b.glue_order ?? 0)) w += (n.stretch ?? 0) * (b.glue_set ?? 0);
          if (b.glue_sign === 2 && (n.shrink_order ?? 0) === (b.glue_order ?? 0)) w -= (n.shrink ?? 0) * (b.glue_set ?? 0);
          x += w; break;
        }
        case 'hlist': hbox(n, x); x += n.width; break;
        case 'vlist': for (const c of n.children ?? []) if (c.type === 'hlist') hbox(c, x + (c.shift ?? 0)); x += n.width; break;
        case 'disc': for (const r of n.replace ?? []) x += r.width ?? r.kern ?? 0; break;
        default: x += n.width ?? 0;
      }
    }
  };
  hbox(item.box, item.display_shift ?? 0);
  return { left: min, right: max, last: lastGlyphRight };
}

for (const [name, b] of Object.entries(BLOCKS)) {
  const c = run(b.src);
  const ds = displays(c.output);
  const modelled = ds.filter((d) => d.display_width_rate !== undefined);
  const byRoute = ds.every((d) => (b.route === 1 ? d.display_route1 : b.route === 2 ? d.display_sampled : d.display_width_rate === undefined));
  check(`${name}: ${ds.length} display row(s), all modelled by route ${b.route}`, ds.length > 0 && modelled.length === ds.length && byRoute,
    JSON.stringify({ n: ds.length, stats: c.stats, place: ds[0]?.display_place }));
  if (modelled.length !== ds.length) continue;
  const W = ds[0].display_width;
  const ctxDelta = W - 360 * PT;                     // a list's indent: the display is narrower than \hsize
  for (const target of [300, 250, 420]) {
    const realItems = displays(run(b.src, widthCtx(target), false).output);
    if (realItems.length !== ds.length || realItems.some((r) => r.display_place?.separate)) {
      console.log(`info ${name} at ${target}pt: TeX sets it another way (${realItems.length} rows vs ${ds.length}; not modelled)`);
      continue;
    }
    const z = target * PT + ctxDelta;                // the display's width at that \hsize
    let worst = 0, flushOk = true, inside = true;
    const rows: string[] = [];
    ds.forEach((d, i) => {
      const model = placeEquationNumber(affineDisplayItem(d, z - W));
      const m = ink(model), r = ink(realItems[i]);
      const dl = Math.abs(m.left - r.left) / PX, dr = Math.abs(m.right - r.right) / PX;
      worst = Math.max(worst, dl, dr);
      const indent = model.display_indent ?? 0;
      if (b.numbered && (!b.lastOnly || i === ds.length - 1) && Math.abs(m.right - (indent + z)) > PX) flushOk = false;
      if (m.left < indent - PX || m.right > indent + z + PX) inside = false;
      rows.push(`${(m.left / PT).toFixed(2)}–${(m.right / PT).toFixed(2)} vs ${(r.left / PT).toFixed(2)}–${(r.right / PT).toFixed(2)}`);
    });
    check(`${name} at ${target}pt: rows' ink within 1 px of the compile (worst ${worst.toFixed(2)} px)${b.numbered ? ', numbers flush right' : ''}, inside the column`,
      worst <= 1 && flushOk && inside, rows.join('; '));
  }
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
