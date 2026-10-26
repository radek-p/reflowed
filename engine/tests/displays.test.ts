// V3: a display compiled once at the document's width, evaluated by the
// public viewer's own display code (affineDisplayItem + placeEquationNumber)
// at other widths, against the same block compiled at those widths.
// Route 1 (primitive displays: TeX's §1199–§1205 from the recorded inputs)
// and route 2 (amsmath's alignments, a number on its own line: the block
// compiled 24 and 48 pt wider, src/fidelity/resample.ts). For every row:
// the ink's left edge and the equation number's right edge within 1 px
// (0.75 pt) of the real compile's, and a number's right edge on the
// column's right edge; nothing outside the column.
// With microtype (its eqnum patch: \tagform@ sets \leftprotrusion{(} and
// \rightprotrusion{)}, kerns inside the number's box) the number's box is
// flush right and its ")" hangs past the column by the protrusion, as TeX
// sets it: the right edge checked is the box's, and the hang is TeX's at
// every width.
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
const { affineDisplayItem, placeEquationNumber, layoutDisplaySegment } = await import(vout);

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
/** The same preamble with microtype, as the intro has it (protrusion; the engine is XeTeX). */
const MICROTYPE_PREAMBLE = PREAMBLE.replace('\\usepackage{amsmath,amssymb}', '\\usepackage{amsmath,amssymb}\n\\usepackage{microtype}');
type MtCase = Case & { hangs: boolean };
const MICROTYPE_BLOCKS: Record<string, MtCase> = {
  // the intro's Theorem 2.1: an equation in a theorem
  'microtype: equation in a lemma': { src: String.raw`\begin{lemma} For every $n \geq 1$,
\begin{equation}\label{eq:gauss} T_n = \frac{n(n+1)}{2}. \end{equation}
\end{lemma}`, numbered: true, route: 1, hangs: true },
  'microtype: align': { src: String.raw`Text. \begin{align} a &= b + c \\ c &= d \end{align} After.`, numbered: true, route: 2, hangs: true },
  'microtype: equation*': { src: String.raw`Text. \begin{equation*} a^2 + b^2 = c^2 \end{equation*} More.`, numbered: false, route: 1, hangs: false },
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
const W0 = (ds: any[]) => ds[0].display_width as number;

/** Ink extent of a row (sp from the column's left edge): glyphs and rules, the viewer's glue arithmetic.
 *  `right` is the glyphs' advance; `edge` is the same except that a glyph that ends its box and hangs
 *  past the box's end (a negative kern after it: microtype's \rightprotrusion) counts to the box's end,
 *  and `hang` is the most a glyph hangs that way. */
function ink(item: any) {
  let min = Infinity, max = -Infinity, lastGlyphRight = -Infinity, edge = -Infinity, hang = 0;
  const hbox = (b: any, x0: number) => {
    let x = x0;
    let tail: number | null = null;                   // the right of this list's last glyph while only negative kerns follow it
    const settle = () => { if (tail !== null) edge = Math.max(edge, tail); tail = null; };
    for (const n of b.children ?? []) {
      if (n.type === 'kern' && tail !== null && (n.kern ?? 0) <= 0) { x += n.kern ?? 0; continue; }
      settle();
      switch (n.type) {
        case 'glyph': min = Math.min(min, x); max = Math.max(max, x + n.width); lastGlyphRight = Math.max(lastGlyphRight, x + n.width); x += n.width; tail = x; break;
        case 'rule': if ((n.width ?? 0) > 0 && ((n.height ?? 0) + (n.depth ?? 0)) > 0) { min = Math.min(min, x); max = Math.max(max, x + n.width); edge = Math.max(edge, x + n.width); } x += Math.max(0, n.width ?? 0); break;
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
    // the list's last glyph, only negative kerns after it: what hangs past the box's end
    if (tail !== null && tail > x) { hang = Math.max(hang, tail - x); edge = Math.max(edge, x); tail = null; }
    settle();
  };
  hbox(item.box, item.display_shift ?? 0);
  return { left: min, right: max, last: lastGlyphRight, edge, hang };
}

function testBlock(name: string, b: Case & { hangs?: boolean }) {
  const c = run(b.src);
  const ds = displays(c.output);
  const modelled = ds.filter((d) => d.display_width_rate !== undefined);
  const byRoute = ds.every((d) => (b.route === 1 ? d.display_route1 : b.route === 2 ? d.display_sampled : d.display_width_rate === undefined));
  check(`${name}: ${ds.length} display row(s), all modelled by route ${b.route}`, ds.length > 0 && modelled.length === ds.length && byRoute,
    JSON.stringify({ n: ds.length, stats: c.stats, place: ds[0]?.display_place }));
  if (b.hangs !== undefined) {
    // microtype's \rightprotrusion{)} in the number's box, as captured from TeX: the ")" hangs past the box
    const hangs = ds.map((d) => ink(d).hang / PT);
    check(`${name}: ${b.hangs ? 'every number\'s ")" hangs past its box (microtype\'s protrusion, captured)' : 'nothing hangs (no number)'}`,
      hangs.every((h) => (b.hangs ? h > 0.5 : h === 0)), `hang ${hangs.map((h) => h.toFixed(3)).join(', ')} pt`);
    // the viewer at the compile width: its surface (W) covers the ink, so it reaches past the column by the
    // hang; whether the display overflows (gets a scroll box) is decided by where its boxes end (fitW), which
    // a hanging ")" does not move: 0 px past the column
    const g = layoutDisplaySegment(c.output.fonts ?? {}, { kind: 'display', isAlign: b.route === 2, rows: ds.map((item) => ({ item })) }, W0(ds) / PT, { sourceWidthSp: W0(ds), minSpacePt: 10 });
    const columnPx = (W0(ds) / PT) * 2;              // the viewer's ZOOM: 1 pt = 2 px
    const past = (g.fitW ?? g.W) - Math.ceil(columnPx);
    console.log(`info ${name}: the viewer's surface is ${(g.W - columnPx).toFixed(2)} px wider than the column`);
    check(`${name}: the viewer's boxes end at the column (no scroll box): ${past.toFixed(2)} px past it`, past === 0,
      `fitW ${g.fitW} px, surface ${g.W} px, column ${columnPx.toFixed(2)} px`);
  }
  if (modelled.length !== ds.length) return;
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
      // the ink's left edge, its right edge (a hanging ")" included) and the hang, each as TeX set them at this width
      const dl = Math.abs(m.left - r.left) / PX, dr = Math.abs(m.right - r.right) / PX, dh = Math.abs(m.hang - r.hang) / PX;
      worst = Math.max(worst, dl, dr, dh);
      const indent = model.display_indent ?? 0;
      // a number's box flush with the column's right edge; only a protruded glyph hangs past it
      if (b.numbered && (!b.lastOnly || i === ds.length - 1) && Math.abs(m.edge - (indent + z)) > PX) flushOk = false;
      if (m.left < indent - PX || m.edge > indent + z + PX) inside = false;
      rows.push(`${(m.left / PT).toFixed(2)}–${(m.right / PT).toFixed(2)} (box ${(m.edge / PT).toFixed(2)}) vs ${(r.left / PT).toFixed(2)}–${(r.right / PT).toFixed(2)} (box ${(r.edge / PT).toFixed(2)})`);
    });
    check(`${name} at ${target}pt: rows' ink within 1 px of the compile (worst ${worst.toFixed(2)} px)${b.numbered ? ', numbers flush right' : ''}, inside the column`,
      worst <= 1 && flushOk && inside, rows.join('; '));
  }
}
for (const [name, b] of Object.entries(BLOCKS)) testBlock(name, b);
// the same with microtype loaded (the intro's preamble does)
e.reset(); e.addFile('input.tex', buildHost(MICROTYPE_PREAMBLE).main);
check('warm, microtype', e.warm('input.tex').ok);
for (const [name, b] of Object.entries(MICROTYPE_BLOCKS)) testBlock(name, b);
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
