// the preview's caret at every inline-maths boundary. In the intro (and any other document named), for every inline formula (\( … \) and
// $ … $): the caret moved by the keyboard across the opening delimiter, the formula's first glyph, its last glyph and
// the closing delimiter (every offset there, inside a command's name too) always shows the preview's caret, at a glyph
// edge (or between two neighbouring glyphs) within 1 px; a click just left of the formula's first glyph and just
// right of its last one shows it as well. (The reported case, "where \(\triangle\) denotes the symmetric difference." in the former
// sample paper, is checked only when a document has it.)
//
//   node tests/test-caret-bounds.ts [http://localhost:8151/] [--docs intro] [--max 400] [--sample 60]
//   --sample N: N formulas per document spread over the whole document, the reported one among them when there (the standard tier;
//   test-all's full tier runs every formula)
// Waits on editorAPI.whenIdle() and animation frames, never on fixed times.
// Results: test-results/caret-bounds/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { sampleArg, spread } from './qa/lib/sample.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const BASE = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8151/').replace(/\/?$/, '/');
const DOCS = (flag('--docs') ?? 'intro').split(',');
const MAX = Number(flag('--max') ?? 100000);           // formulas per document at most (the first ones)
const SAMPLE = sampleArg(argv);                          // formulas per document, spread over it
const OUT = join(resultsDir(HERE), 'caret-bounds');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 900)}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message));
await page.goto(`${BASE}?engine&store=memory#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);

/** the inline formulas of a source: [open, close) of each delimiter pair, with the inner range */
function formulas(src: string) {
  const out: { s: number; i0: number; i1: number; e: number }[] = [];
  const re = /\\\(|\\\)|\\\[|\\\]|\$\$|\$|\\\\|\\\$|%[^\n]*/g;
  let m: RegExpExecArray | null, open: { s: number; i0: number; d: string } | null = null;
  while ((m = re.exec(src))) {
    const t = m[0];
    if (t === '\\\\' || t === '\\$' || t[0] === '%' || t === '$$' || t === '\\[' || t === '\\]') continue;
    if (!open && (t === '\\(' || t === '$')) open = { s: m.index, i0: m.index + t.length, d: t };
    else if (open && ((open.d === '\\(' && t === '\\)') || (open.d === '$' && t === '$'))) { out.push({ s: open.s, i0: open.i0, i1: m.index, e: m.index + t.length }); open = null; }
  }
  return out;
}

/** the preview's caret bar of block `id` (its centre), and how far it is from the nearest glyph edge or the middle
 *  between two neighbouring glyphs on its line */
const barNow = (id: string) => page.evaluate((i: string) => {
  const r = document.querySelector(`.blk[data-id="${i}"] .blk-render`)!;
  const bar = r.querySelector('.rtx-caret-bar');
  if (!bar) return null;
  const b = bar.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
  const m = (window as any).editorAPI.view().caretMap(r, { boxes: true });
  const line = (m?.glyphs ?? []).map((g: any) => g.box).filter((q: any) => q && q.top <= y && q.bottom >= y && q.right > q.left).sort((p: any, q: any) => p.left - q.left);
  let d = Infinity;
  // an edge, or the middle of a gap between one glyph's right and another's left (overlaid glyphs such as \\notin's
  // slash over its \u2208 are not in drawing order by their left edges)
  for (const q of line) {
    d = Math.min(d, Math.abs(x - q.left), Math.abs(x - q.right));
    for (const r of line) if (r !== q && r.left >= q.right - 0.5) d = Math.min(d, Math.abs(x - (q.right + r.left) / 2));
  }
  return { x, d, unsure: bar.classList.contains('rtx-caret-unsure') };
}, id);

for (const tag of DOCS) {
  const has = await page.evaluate(async (t: string) => (await (window as any).editorAPI.store().listDocs()).some((d: any) => d.id === t || d.tags?.includes(t) || d.meta?.tags?.includes(t)), tag);
  if (!has) { console.log(`skip ${tag}: not in the store`); continue; }
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home');
  await page.evaluate((t: string) => { location.hash = `#/doc/${t}`; }, tag);
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && !!(window as any).editorAPI.currentDoc());
  await idle();
  const blocks: any[] = await page.evaluate(() => (window as any).editorAPI.blocks().filter((b: any) => b.state === 'ok' && b.kind !== 'bibliography' && /\\\(|\$/.test(b.source)).map((b: any) => ({ id: b.id, source: b.source })));
  // the formulas to walk: all of them, or a sample over the whole document with the reported one kept
  const REPORTED = '\\(\\triangle\\)';
  const every = blocks.flatMap((b) => formulas(b.source).map((f) => ({ id: b.id, f, text: b.source.slice(f.s, f.e) })));
  const chosen = new Set(spread(every, SAMPLE, (x) => x.text === REPORTED).map((x) => `${x.id}:${x.f.s}`));
  if (SAMPLE) console.log(`${tag}: a sample of ${chosen.size} of ${every.length} formulas`);
  let steps = 0, clicks = 0, done = 0;
  const bad: string[] = [];
  let reported: string | null = null;
  for (const b of blocks) {
    const fs = formulas(b.source).filter((f) => chosen.has(`${b.id}:${f.s}`));
    if (!fs.length || done >= MAX) continue;
    await page.evaluate((i: string) => { document.querySelector(`.blk[data-id="${i}"]`)!.scrollIntoView({ block: 'center' }); (window as any).editorAPI.edit(i, 0); }, b.id);
    await idle(); await frames();
    const m: any = await page.evaluate((i: string) => (window as any).editorAPI.view().caretMap(document.querySelector(`.blk[data-id="${i}"] .blk-render`), { boxes: true }), b.id);
    if (!m || m.compiled !== b.source) { bad.push(`${b.id.slice(-6)}: no caret map for the source`); continue; }
    for (const f of fs) {
      if (done++ >= MAX) break;
      // the formula's glyphs (drawn, with a source offset inside it), first and last by offset
      const gs = m.glyphs.filter((g: any) => g.off >= f.i0 && g.off < f.i1 && !g.via && g.box);
      if (!gs.length) continue;
      const firstOff = Math.min(...gs.map((g: any) => g.off)), lastOff = Math.max(...gs.map((g: any) => g.off));
      const cmd = (o: number) => { const w = /^\\(?:[A-Za-z@]+|.)/.exec(b.source.slice(o)); return w ? w[0].length : 1; };
      const runs: [number, number][] = [[f.s, Math.min(f.i1, firstOff + cmd(firstOff))], [Math.max(f.i0, lastOff), f.e]];
      if (runs[1][0] <= runs[0][1]) runs.splice(0, 2, [f.s, f.e]);
      if (b.source.slice(f.s, f.e) === REPORTED) reported = b.id;
      for (const [from, to] of runs) {
        await page.evaluate(([i, o]: [string, number]) => (window as any).editorAPI.edit(i, o), [b.id, from]);
        await page.evaluate(() => (window as any).editorAPI.editorView('a')?.focus());
        await idle(); await frames();
        for (let k = from; k <= to; k++) {
          if (k > from) { await page.keyboard.press('ArrowRight'); await frames(); }
          const caret = await page.evaluate(() => (window as any).editorAPI.caret()?.offset);
          const bar = await barNow(b.id);
          steps++;
          if (caret !== k) { bad.push(`${b.id.slice(-6)} ${JSON.stringify(b.source.slice(f.s, f.e)).slice(0, 40)} @${k}: the editor's caret is at ${caret}`); break; }
          if (!bar || bar.d > 1) bad.push(`${b.id.slice(-6)} ${JSON.stringify(b.source.slice(f.s, k))}|${JSON.stringify(b.source.slice(k, f.e))}: ${bar ? `the bar ${bar.d.toFixed(1)} px off a glyph edge` : 'no preview caret'}`);
        }
      }
      // a click just outside the formula's first glyph (left) and last glyph (right): the caret shows
      const now: any = await page.evaluate((i: string) => (window as any).editorAPI.view().caretMap(document.querySelector(`.blk[data-id="${i}"] .blk-render`), { boxes: true }), b.id);   // where they are now
      const boxAt = (o: number) => now?.glyphs.find((g: any) => g.off === o && !g.via && g.box)?.box;
      const first = boxAt(firstOff), last = boxAt(lastOff);
      if (!first || !last) continue;
      for (const [x, y, side] of [[first.left - 1, (first.top + first.bottom) / 2, 'left'], [last.right + 1, (last.top + last.bottom) / 2, 'right']] as [number, number, string][]) {
        const at = await page.evaluate(([i, px, py]: [string, number, number]) => { const r = document.querySelector(`.blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom; }, [b.id, x, y]);
        if (!at) continue;
        await page.mouse.click(x, y);
        await idle(); await frames();
        clicks++;
        const bar = await barNow(b.id);
        if (!bar || bar.d > 1) bad.push(`${b.id.slice(-6)} ${JSON.stringify(b.source.slice(f.s, f.e)).slice(0, 40)}: a click ${side} of it: ${bar ? `the bar ${bar.d.toFixed(1)} px off a glyph edge` : 'no preview caret'}`);
      }
    }
    await page.evaluate(() => (window as any).editorAPI.leave());
    await idle();
  }
  check(`${tag}: every offset across each inline formula's delimiters and end glyphs shows the preview caret at a glyph edge (${done} formulas${SAMPLE ? ` sampled of ${every.length}` : ''}, ${steps} caret steps, ${clicks} clicks)`, steps > 0 && bad.length === 0, { n: bad.length, first: bad.slice(0, 12) });
}
check('no page errors', errors.length === 0, errors.slice(0, 3));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
