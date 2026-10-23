// a multi-label \cref/\Cref ("Adding up \Cref{bound:1,bound:2,bound:3,bound:4}, we can …") drew
// text over text. A reference to labels in other blocks is a live-text slot filled by app/src/refs.
//
//   node tests/test-cref.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
//
// A fresh document: six numbered "bound" theorems with labels, then paragraphs that refer to them with
// 2 labels, 4 labels that make a range (1 to 4), 4 labels that do not, \cref and \Cref. For each
// paragraph a twin with the reference written out as cleveref prints it once the labels are known
// ("Bounds~1 to~4"): what a whole-document compile (two runs) typesets. At three widths:
//   1. no two glyphs on a line of a reference paragraph overlap;
//   2. the paragraph's lines are its twin's, character for character (the same text, broken the same).
// What is drawn is read from the page's SVG text (after every rewrite of a slot), each block in view (an off-screen
// segment is repainted when it scrolls into view). Waits on whenIdle() and frames.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const TARGET = argv[0] === 'file' ? 'file' : 'dev';
const pos = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const URL0 = TARGET === 'file' ? `file://${pos ?? join(HERE, 'dist/reflowtex-editor.html')}` : `${(pos ?? 'http://localhost:8150/').replace(/\/?$/, '/')}?engine`;
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 900)}` : ''}`); if (!ok) fail++; };

const PREAMBLE = '\\documentclass{article}\n\\usepackage{amsmath,amsthm}\n\\usepackage{cleveref}\n\\newtheorem{bound}{Bound}\n\\crefname{bound}{bound}{bounds}\n\\Crefname{bound}{Bound}{Bounds}';
const BOUNDS = [1, 2, 3, 4, 5, 6].map((k) => `\\begin{bound}\\label{bound:${k}}\nThere are less than $${k}t$ vertices of this kind.\n\\end{bound}`);
const TAIL = 'we can exhaustively bound the number of vertices that are separated from the centre by the sets chosen so far, and so the separation number stays small in every step of the construction.';
// [with the reference, the same written out as cleveref prints it]
const CASES: [string, string, string][] = [
  ['range of 4, \\Cref', 'Adding up \\Cref{bound:1,bound:2,bound:3,bound:4}, ', 'Adding up Bounds~1 to~4, '],
  ['2 labels, \\cref', 'Adding up \\cref{bound:2,bound:5}, ', 'Adding up bounds~2 and~5, '],
  ['4 labels, not a range, \\Cref', 'Adding up \\Cref{bound:1,bound:3,bound:5,bound:6}, ', 'Adding up Bounds~1, 3, 5 and~6, '],
  ['range of 3 mid-sentence, \\cref', 'From the three facts in \\cref{bound:2,bound:3,bound:4} together with the first one, ', 'From the three facts in bounds~2 to~4 together with the first one, '],
];
const blocks = [...BOUNDS, ...CASES.flatMap(([, ref, out]) => [ref + TAIL, out + TAIL])];

const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-cref-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
if (TARGET === 'file') await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(600000);
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`${URL0}#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
const id: string = await page.evaluate(async ([pre, bs]: [string, string[]]) => (window as any).editorAPI.store().createDoc({ title: 'Multi-label references', preamble: pre, blocks: bs.map((source) => ({ source })) }), [PREAMBLE, blocks] as [string, string[]]);
await page.evaluate((i: string) => { location.hash = `#/doc/${i}`; }, id);
await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && (window as any).editorAPI.currentDoc());
const settle = async () => {
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
await settle();
const ids: string[] = await page.evaluate(() => (window as any).editorAPI.blocks().map((b: any) => b.id));
check('every block typeset', (await page.evaluate(() => (window as any).editorAPI.blocks().every((b: any) => b.state === 'ok'))), await page.evaluate(() => (window as any).editorAPI.blocks().map((b: any) => b.state)));

/** a block's lines as drawn: the SVG text it shows (TeX's glyphs and the words a slot's text became, as
 *  the page holds them after every rewrite), per line its text and each drawn piece's box (screen px) */
const linesOf = (bid: string) => page.evaluate((i: string) => {
  const el = [...document.querySelectorAll(`.blk[data-id="${i}"] .blk-render > .latex-block`)].find((e) => !e.classList.contains('incoming'))!;
  const rows = new Map<string, { y: number; parts: { t: string; l: number; r: number }[] }>();
  for (const t of el.querySelectorAll('svg tspan')) {
    const txt = t.textContent ?? '';
    if (!txt) continue;
    const r = t.getBoundingClientRect();
    if (!r.width && !/\s/.test(txt)) continue;
    const key = `${(t.closest('svg') as any)?.dataset?.seg ?? ''}:${Math.round((r.top + r.bottom) / 2 / 4)}`;
    const yb = Math.round(r.bottom);
    const row = [...rows.values()].find((w) => Math.abs(w.y - yb) <= 4) ?? (rows.set(key + rows.size, { y: yb, parts: [] }), [...rows.values()].pop()!);
    row.parts.push({ t: txt, l: r.left, r: r.right });
  }
  return [...rows.values()].sort((p, q) => p.y - q.y).map((w) => {
    const ps = w.parts.sort((p, q) => p.l - q.l);
    let text = '';
    ps.forEach((p, k) => { if (k && p.l - ps[k - 1].r > 2.5 && !/\s$/.test(text)) text += ' '; text += p.t; });
    return { text: text.replace(/\s+/g, ' ').trim(), boxes: ps.filter((p) => p.t.trim()).map((p) => ({ ch: p.t, l: p.l, r: p.r })) };
  });
}, bid);

/** the block brought into view and repainted: the viewer draws an off-screen segment's glyphs at the new width only
 *  when it scrolls into view (its box is resized at once; reflowtex runtime/blocks.ts markDirty), so a block below the
 *  fold at 520 px read its 860 px lines */
const shown = async (bid: string) => {
  await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }), bid);
  await settle();
  return bid;
};

for (const width of [1280, 860, 520]) {
  await page.setViewportSize({ width, height: 900 });
  await settle();
  for (let c = 0; c < CASES.length; c++) {
    const refId = ids[BOUNDS.length + 2 * c], twinId = ids[BOUNDS.length + 2 * c + 1];
    const a = await linesOf(await shown(refId)), b = await linesOf(await shown(twinId));
    // a kern (F r: 0.083 em) is not an overlap; text over text is a word's width
    const overlaps: string[] = [];
    a.forEach((l, li) => {
      const bx = [...l.boxes].sort((p, q) => p.l - q.l);
      for (let k = 1; k < bx.length; k++) if (bx[k].l < bx[k - 1].r - 2.5) overlaps.push(`line ${li + 1}: «${bx[k - 1].ch}» ${bx[k - 1].l.toFixed(1)}–${bx[k - 1].r.toFixed(1)} and «${bx[k].ch}» from ${bx[k].l.toFixed(1)}`);
    });
    check(`${width} px, ${CASES[c][0]}: no glyphs overlap`, a.length > 0 && overlaps.length === 0, overlaps.slice(0, 4).join(' | ') || `${a.length} lines`);
    const same = a.length === b.length && a.every((l, k) => l.text === b[k].text);
    check(`${width} px, ${CASES[c][0]}: lines as with the reference written out`, same, same ? '' : { ref: a.map((l) => l.text), written: b.map((l) => l.text) });
  }
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.evaluate(async (i: string) => { location.hash = '#/'; await (window as any).editorAPI.store().deleteDoc(i); }, id);
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
