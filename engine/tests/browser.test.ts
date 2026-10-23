// The engine in Chromium (dev server): web/backend.js + dist/editor-worker.js.
//   node tests/browser.test.ts [http://localhost:8141] [--intro] [--shots]
// Checks: the sample blocks compile warm and mount in the viewer; an error
// stays on its block with its line; the result cache (memory, then a given
// cache object) answers without compiling; the intro's blocks compile
// (context = definitions + restatables); PDF export gives a PDF.
// Writes test-results/engine-*.json (timings) and screenshots.
import { chromium } from 'playwright';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { splitDocument } from '../src/split.ts';
import { defsContexts } from '../src/defs-context.ts';
import { PREAMBLE, BLOCKS } from './sample.ts';

const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:8141';
const INTRO = process.argv.includes('--intro'), SHOTS = process.argv.includes('--shots');
const OUT = new URL('../test-results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}/devpage/index.html`);
await page.waitForFunction(() => (window as any).engineTestReady);

// ── sample blocks ───────────────────────────────────────────────────────────
const sample = await page.evaluate(async ({ PREAMBLE, BLOCKS }) => {
  const T = (window as any).engineTest;
  const store = new Map();
  const cache = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); } };
  const be = T.createBackend({ cache });
  (window as any).be = be;
  const t0 = performance.now();
  const pre = await be.setPreamble(PREAMBLE);
  const tWarm = performance.now() - t0;
  const blocks = Object.entries(BLOCKS).map(([id, source]) => ({ id, source }));
  const r1 = await be.compile({ preamble: PREAMBLE, blocks, keep: [] });
  const mounted: Record<string, unknown> = {};
  for (const b of blocks) if (r1.blocks[b.id].status === 'ok') mounted[b.id] = await T.mountBlock(b.id, r1.blocks[b.id]);
  // one edited block, request → result
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await be.compile({ preamble: PREAMBLE, blocks: [{ id: 'p', source: `${BLOCKS.paragraph} Edit ${i}.` }], keep: [] });
    times.push(performance.now() - t);
  }
  const err = await be.compile({ preamble: PREAMBLE, blocks: [{ id: 'e', source: 'Fine line.\nBad \\undefinedcs{} line.' }], keep: [] });
  const again = await be.compile({ preamble: PREAMBLE, blocks, keep: [] });
  // a second backend on the same cache: answered from the cache (a reload)
  const be2 = T.createBackend({ cache });
  await be2.setPreamble(PREAMBLE);
  const r3 = await be2.compile({ preamble: PREAMBLE, blocks, keep: [] });
  const snip = await be.compileSnippet('x^2+y_1', { mode: 'math' });
  // three snippets in one tick: one request
  const req0 = be.stats().requests;
  const three = await Promise.all([be.compileSnippet('a'), be.compileSnippet('$b^2$'), be.compileSnippet('Some text in a minipage of 60bp width.', { widthBp: 60 })]);
  const snippetBatch = { requests: be.stats().requests - req0, ok: three.every((r: any) => r.status === 'ok') };
  // viewport first: the visible block's result arrives first
  const order: string[] = [];
  be.setVisible(['v3']);
  await be.compile({ preamble: PREAMBLE, blocks: [0, 1, 2, 3].map((i) => ({ id: 'v' + i, source: `Viewport test ${i}.` })), keep: [], onBlock: (id: string) => order.push(id) });
  // the default cache is IndexedDB: a new backend (a reload) compiles nothing
  const i1 = T.createBackend(); await i1.setPreamble(PREAMBLE);
  await i1.compile({ preamble: PREAMBLE, blocks: [{ id: 'x', source: 'IndexedDB cache test.' }], keep: [] });
  const i2 = T.createBackend(); await i2.setPreamble(PREAMBLE);
  const ir = await i2.compile({ preamble: PREAMBLE, blocks: [{ id: 'x', source: 'IndexedDB cache test.' }], keep: [] });
  // TikZ: a picture in a block, and renderTikz's SVG
  const tz = T.createBackend({ cache: null }); const TP = PREAMBLE + '\n\\usepackage{tikz}';
  await tz.setPreamble(TP);
  const tr = await tz.compile({ preamble: TP, blocks: [{ id: 't', source: 'A picture \\begin{tikzpicture}\\draw[blue] (0,0) circle (1) node {$x$};\\end{tikzpicture} inline.' }], keep: [] });
  const tmount = tr.blocks.t.status === 'ok' ? await T.mountBlock('t', tr.blocks.t) : null;
  const tpics = document.querySelectorAll('[data-id="t"] svg .latex-picture, [data-id="t"] g.latex-picture').length;
  const svg = await tz.renderTikz('\\begin{tikzpicture}\\draw (0,0) -- (1,1) node[above] {label};\\end{tikzpicture}');
  return {
    pre, tWarm, stats1: r1.stats, statuses: Object.fromEntries(Object.entries(r1.blocks).map(([k, v]: [string, any]) => [k, v.status])),
    timings: Object.fromEntries(Object.entries(r1.blocks).map(([k, v]: [string, any]) => [k, { ms: v.ms, ...v.timing }])),
    spacing: Object.fromEntries(Object.entries(r1.blocks).map(([k, v]: [string, any]) => [k, v.spacing])),
    sourcemapFiles: (r1.blocks.paragraph as any).sourcemap?.files, sourcemapFirst: (r1.blocks.paragraph as any).sourcemap?.firstLine,
    mounted, editTimes: times, err: err.blocks.e, againStats: again.stats, reloadStats: r3.stats, reloadCounters: be2.stats(),
    snippet: { status: snip.status, hasNodelist: !!snip.nodelist }, info: be.info(), snippetBatch, order, idb: { stats: ir.stats, counters: i2.stats() },
    tikz: { status: tr.blocks.t.status, errors: tr.blocks.t.errors, mount: tmount, pics: tpics, svg: { ok: !!svg.svg && /viewBox/.test(svg.svg), w: svg.widthBp, errors: svg.errors } },
  };
}, { PREAMBLE, BLOCKS });
check('preamble warms without errors', sample.pre.errors.length === 0, JSON.stringify(sample.pre.errors));
check('all sample blocks ok', Object.values(sample.statuses).every((s) => s === 'ok'), JSON.stringify(sample.statuses));
check('each block mounts with glyphs', Object.values(sample.mounted).every((m: any) => m.height > 0 && m.glyphs > 0), JSON.stringify(sample.mounted));
check('source map: rtx-block.tex, first line 1', sample.sourcemapFiles?.includes('rtx-block.tex') && sample.sourcemapFirst === 1, JSON.stringify(sample.sourcemapFiles));
check('spacing: heading has glue above, paragraph indents', (sample.spacing.heading?.above?.pt ?? 0) > 0 && sample.spacing.paragraph?.indent === true, JSON.stringify(sample.spacing));
check('error on its line (2)', sample.err.status === 'error' && sample.err.errors.some((e: any) => e.line === 2 && /Undefined control sequence/.test(e.message)), JSON.stringify(sample.err.errors));
check('same blocks again: memory hits, no compile', sample.againStats.compiled === 0 && sample.againStats.cached === 5, JSON.stringify(sample.againStats));
check('reload (new backend, same cache): 0 compiles', sample.reloadStats.compiled === 0 && sample.reloadCounters.cacheHits === 5, JSON.stringify(sample.reloadStats));
check('compileSnippet (math) ok', sample.snippet.status === 'ok' && sample.snippet.hasNodelist, JSON.stringify(sample.snippet));
check('three snippets in one tick: one request', sample.snippetBatch.requests === 1 && sample.snippetBatch.ok, JSON.stringify(sample.snippetBatch));
check('viewport first: the visible block comes first', sample.order[0] === 'v3', JSON.stringify(sample.order));
check('IndexedDB cache: a reload compiles nothing', sample.idb.stats.compiled === 0 && sample.idb.counters.cacheHits === 1, JSON.stringify(sample.idb));
check('TikZ in a block: a picture drawn', sample.tikz.status === 'ok' && sample.tikz.pics >= 1, JSON.stringify(sample.tikz));
check('renderTikz: an SVG', sample.tikz.svg.ok && sample.tikz.svg.w > 10, JSON.stringify(sample.tikz.svg));
console.log(`warm ${sample.tWarm.toFixed(0)} ms (incl. worker start); first compile of 5: ${JSON.stringify(sample.stats1)}; edit round trips ${sample.editTimes.map((t: number) => t.toFixed(0)).join(' ')} ms`);
console.log('per block:', JSON.stringify(sample.timings));
if (SHOTS) await page.screenshot({ path: OUT + 'engine-sample.png', fullPage: true });
const result: Record<string, unknown> = { sample };


// ── displays at the column's width, symbol fonts, empty blocks, missing files, slots ──
{
  const r = await page.evaluate(async () => {
    const T = (window as any).engineTest;
    const be = T.createBackend({ cache: null });
    const P = '\\documentclass[11pt]{article}\n\\usepackage{amsmath,amssymb}\n\\usepackage{hyperref}\n\\usepackage{cleveref}\n\\newtheorem{lemma}{Lemma}';
    await be.setPreamble(P);
    const res = await be.compile({ preamble: P, keep: [], blocks: [
      { id: 'eq', source: 'Before.\n\\begin{equation}\\label{eq:a} a+b=c \\end{equation}\nAfter.' },
      { id: 'sym', source: '$x \\leqslant y \\geqslant z$' },
      { id: 'empty', source: '\\bigskip' },
      { id: 'miss', source: '\\input{no-such-file-here}' },
      { id: 'ref', source: '\\begin{lemma}\\label{lem:x} A lemma.\\end{lemma} See \\cref{lem:x} and \\ref{lem:x}.' },
    ] });
    // mount a result in a column of a given width
    const mountAt = async (id: string, result: any, px: number) => {
      const el = document.createElement('div'); el.className = 'latex-block'; el.style.width = `${px}px`; el.style.padding = '0'; el.dataset.nodelistB64 = result.nodelist;
      const wrap = document.createElement('div'); wrap.dataset.id = id; wrap.append(el); document.getElementById('blocks')!.append(wrap);
      await (window as any).reflowtex.host.mount(el);
      return el;
    };
    const glyphs = (el: Element) => [...el.querySelectorAll('tspan, text')].filter((t) => !t.querySelector('tspan') && (t.textContent ?? '').length > 0)
      .map((t) => { const b = t.getBoundingClientRect(); return { s: t.textContent!, x0: b.left, x1: b.right, y: b.top + b.height / 2, fam: getComputedStyle(t).fontFamily }; });
    const eq: any[] = [];
    for (const px of [600, 380]) {
      const el = await mountAt(`eq${px}`, res.blocks.eq, px);
      const col = el.getBoundingClientRect();
      const gs = glyphs(el);
      // the display's line: the one holding "=" ; the number: from its last "("
      const eqY = gs.find((g) => g.s.includes('='))?.y ?? 0;
      const line = gs.filter((g) => Math.abs(g.y - eqY) < 4).sort((a, b) => a.x0 - b.x0);
      const open = line.map((g) => g.s).lastIndexOf('(');
      const tag = open >= 0 ? line.slice(open) : [], formula = open >= 0 ? line.slice(0, open) : line;
      eq.push({ px, colLeft: col.left, colRight: col.right, tagRight: tag.length ? Math.max(...tag.map((g) => g.x1)) : null, tag: tag.map((g) => g.s).join(''),
        formulaMid: formula.length ? (Math.min(...formula.map((g) => g.x0)) + Math.max(...formula.map((g) => g.x1))) / 2 : null, colMid: (col.left + col.right) / 2 });
    }
    const symEl = await mountAt('sym', res.blocks.sym, 500);
    const sg = glyphs(symEl);
    await document.fonts.ready;
    // the glyphs drawn in the msam font (the encoder maps them to its own code points)
    const leq = sg.find((g) => /msam/i.test(g.fam)) ?? null;
    const fam = leq?.fam.split(',')[0].replace(/["']/g, '').trim() ?? '';
    const faces = [...document.fonts].filter((f: any) => f.family.replace(/["']/g, '') === fam).map((f: any) => f.status);
    // a real outline: the glyph drawn with that font inks pixels (a missing .pfb would give nothing or a box)
    let ink = 0;
    if (leq) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 80;
      const cx = cv.getContext('2d')!; cx.font = `60px "${fam}"`; cx.fillText(leq.s, 10, 60);
      const px = cx.getImageData(0, 0, 80, 80).data; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) ink++;
    }
    let emptyMounted = null;
    if (res.blocks.empty.status === 'ok' && res.blocks.empty.nodelist) { const el = await mountAt('empty', res.blocks.empty, 500); emptyMounted = el.getBoundingClientRect().height; }
    const refEl = res.blocks.ref.status === 'ok' ? await mountAt('ref', res.blocks.ref, 500) : null;
    return { eq, eqStatus: res.blocks.eq.status, sym: { status: res.blocks.sym.status, leq, fam, faces, ink, text: sg.map((g) => g.s).join('') },
      empty: { status: res.blocks.empty.status, errors: res.blocks.empty.errors, nodelist: !!res.blocks.empty.nodelist, emptyMounted },
      miss: res.blocks.miss.errors.map((e: any) => e.message),
      ref: { status: res.blocks.ref.status, errors: res.blocks.ref.errors, slots: refEl?.querySelectorAll('[data-slot]').length ?? 0, links: refEl?.querySelectorAll('a, [data-link], .latex-link').length ?? 0,
        text: refEl ? glyphs(refEl).map((g) => g.s).join('') : '' } };
  });
  for (const e of r.eq) {
    check(`at a ${e.px} px column: the number "${e.tag}" ends at the column's right edge (${e.tagRight?.toFixed(1)} vs ${e.colRight.toFixed(1)})`, e.tagRight != null && Math.abs(e.tagRight - e.colRight) <= 1, JSON.stringify(e));
    check(`at a ${e.px} px column: the formula centred in the column (${e.formulaMid?.toFixed(1)} vs ${e.colMid.toFixed(1)})`, e.formulaMid != null && Math.abs(e.formulaMid - e.colMid) <= 1, JSON.stringify(e));
  }
  check(`\\leqslant, \\geqslant: real glyphs of msam (font ${r.sym.fam}: ${r.sym.faces.join(',')}, ${r.sym.ink} ink pixels)`, r.sym.status === 'ok' && !!r.sym.leq && /msam/i.test(r.sym.fam) && r.sym.faces.includes('loaded') && r.sym.leq.x1 - r.sym.leq.x0 > 3 && r.sym.ink > 100, JSON.stringify(r.sym));
  check('a block with no typeset output (\\bigskip): ok, an empty render', r.empty.status === 'ok' && r.empty.nodelist, JSON.stringify(r.empty));
  check('a missing file: the error names it and says it is not in the embedded set', r.miss.some((m: string) => /no-such-file-here.*not in the editor's embedded TeX set/.test(m)), JSON.stringify(r.miss));
  check(`slots (engine patch + rtx-xetex + rtx-numbering): \\cref/\\ref as slots (${r.ref.slots}) reading "${r.ref.text.slice(-40)}"`, r.ref.status === 'ok' && r.ref.slots > 0, JSON.stringify(r.ref));
  result.more = r;
}


// ── an engine crash is recovered per block ───────────────────────────────────
{
  const r = await page.evaluate(async () => {
    const T = (window as any).engineTest;
    const be = T.createBackend({ cache: null });
    const P = '\\documentclass{article}';
    await be.setPreamble(P);
    await be.compile({ preamble: P, keep: [], blocks: [{ id: 'w', source: 'Warm.' }] });
    await be.simulateCrash(1);         // one abort: a new instance, the block again, ok
    const one = await be.compile({ preamble: P, keep: [], blocks: [{ id: 'a', source: 'After one crash.' }, { id: 'b', source: 'Next block.' }] });
    await be.simulateCrash(2);         // it aborts again: that block's error, the next block ok
    const two = await be.compile({ preamble: P, keep: [], blocks: [{ id: 'c', source: 'Crashes twice.' }, { id: 'd', source: 'Still fine.' }] });
    return { one: [one.blocks.a.status, one.blocks.a.timing?.recovered, one.blocks.b.status], two: [two.blocks.c.status, two.blocks.c.errors[0]?.message, two.blocks.d.status], mem: await be.memory() };
  });
  check('engine abort in a block: a new instance, the block compiled again, ok', r.one[0] === 'ok' && r.one[1] === 1 && r.one[2] === 'ok', JSON.stringify(r));
  check('engine aborts twice: that block reports "engine crashed …", the next block compiles', r.two[0] === 'error' && /engine crashed while compiling this block/.test(r.two[1] ?? '') && r.two[2] === 'ok', JSON.stringify(r));
}


{
  const r = await page.evaluate(async () => {
    const T = (window as any).engineTest;
    const store = new Map();
    const cache = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); } };
    // a 1×1 PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const assets = [{ name: 'dot.png', mime: 'image/png', hash: 'dot1', bytes: png }];
    const P = '\\documentclass{article}\n\\usepackage{graphicx}';
    const fig = { id: 'f', source: '\\includegraphics[width=1cm]{dot.png}' }, par = { id: 'p', source: 'A paragraph, edited.' };
    const a = T.createBackend({ cache }); a.setAssets(assets); await a.setPreamble(P);
    await a.compile({ preamble: P, keep: [], blocks: [fig, par] });          // the figure looked up first, then the paragraph
    const b = T.createBackend({ cache }); b.setAssets(assets); await b.setPreamble(P);
    const rb = await b.compile({ preamble: P, keep: [], blocks: [par] });      // after a reload: the paragraph alone first
    const rf = await b.compile({ preamble: P, keep: [], blocks: [fig] });
    return { par: rb.stats, fig: rf.stats, keys: [a.keyFor(par), b.keyFor(par)] };
  });
  check('after a "reload" the paragraph and the figure come from the cache (0 compiles)', r.par.compiled === 0 && r.fig.compiled === 0 && r.keys[0] === r.keys[1], JSON.stringify(r));
}

// ── the intro (samples/intro/source: one main.tex, an inline thebibliography) ──
if (INTRO) {
  const SRC = new URL('../../samples/intro/source/', import.meta.url).pathname;
  const read = (p: string) => (existsSync(SRC + p) ? readFileSync(SRC + p, 'utf8') : null);
  const doc = splitDocument(readFileSync(SRC + 'main.tex', 'utf8'), read);
  const ctx = defsContexts(doc.blocks.map((b) => b.source));
  const assets: { name: string; mime: string; b64: string }[] = [];
  await page.evaluate(() => { document.getElementById('blocks')!.innerHTML = ''; });
  const paper = await page.evaluate(async ({ preamble, blocks, bbl, assets }) => {
    const T = (window as any).engineTest;
    const be = T.createBackend({ cache: null });
    be.setAssets(assets.map((a: any) => ({ name: a.name, mime: a.mime, hash: a.name, bytes: Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0)) })));
    const t0 = performance.now();
    if (bbl) await be.setBib({ kind: 'bbl', source: bbl });
    const pre = await be.setPreamble(preamble);
    const tWarm = performance.now() - t0;
    const t1 = performance.now();
    const r = await be.compile({ preamble, blocks: blocks.map((b: any, i: number) => ({ id: `b${i}`, source: b.source, context: b.context })), keep: [] });
    const tAll = performance.now() - t1;
    const rows = Object.entries(r.blocks).map(([id, v]: [string, any]) => ({ id, status: v.status, ms: v.ms, t: v.timing, errors: v.errors.map((e: any) => `${e.line}: ${e.message}`) }));
    const heights: number[] = [];
    for (const [id, v] of Object.entries(r.blocks).slice(0, 12) as [string, any][]) if (v.status === 'ok') heights.push((await T.mountBlock(id, v)).height);
    const t2 = performance.now();
    const pdf = await be.pdf({ preamble, blocks: blocks.map((b: any, i: number) => ({ id: `b${i}`, source: b.source })) });
    const tPdf = performance.now() - t2;
    return { pre, tWarm, tAll, stats: r.stats, rows, heights, pdf: { bytes: pdf.pdf?.size ?? 0, errors: pdf.errors, newlabels: (pdf.aux.match(/\\newlabel/g) ?? []).length }, tPdf };
  }, { preamble: doc.preamble, blocks: doc.blocks.map((b, i) => ({ source: b.source, context: ctx[i] })), bbl: '', assets });
  const ok = paper.rows.filter((r: any) => r.status === 'ok').length;
  check(`intro: ${ok}/${paper.rows.length} blocks ok`, ok === paper.rows.length, JSON.stringify(paper.rows.filter((r: any) => r.status !== 'ok').slice(0, 5)));
  check('intro: first blocks mount', paper.heights.length > 5 && paper.heights.every((h: number) => h > 0), JSON.stringify(paper.heights));
  check('intro: PDF export', paper.pdf.bytes > 10000 && paper.pdf.newlabels > 10, JSON.stringify(paper.pdf));
  const ms = paper.rows.map((r: any) => r.ms).sort((a: number, b: number) => a - b);
  const q = (f: number) => ms[Math.floor(f * (ms.length - 1))].toFixed(0);
  console.log(`intro: warm ${paper.tWarm.toFixed(0)} ms, all ${paper.rows.length} blocks ${paper.tAll.toFixed(0)} ms (per block p10/50/90/max ${q(0.1)}/${q(0.5)}/${q(0.9)}/${q(1)} ms), PDF ${paper.tPdf.toFixed(0)} ms`);
  if (SHOTS) await page.screenshot({ path: OUT + 'engine-intro.png', fullPage: false });
  result.intro = paper;
}
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
writeFileSync(OUT + 'engine-browser.json', JSON.stringify(result, null, 1));
await browser.close();
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
