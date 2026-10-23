// the preview's selection band ends where the mirrored caret does. A code selection that ends after
// a space (or starts with one, or is only spaces) ran only to the last selected glyph, so the preview read
// "[selection] |" with an unselected gap; across a line break the band stopped at the last selected glyph.
//
//   node tests/test-selection.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
//
// A fresh document with one paragraph of plain words, several lines long. The caret's x at an offset is
// the mirrored bar's (api.edit(id, k)); a selection is made with the keyboard (Shift+→ from k). Cases:
// ends with a space, starts with a space, only a space, across a line break (the first band runs to the
// line's end: the caret's x after that line's last word). Each band edge within 1 px of the caret's x.
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

const TEXT = 'Every planar graph has bounded merge width and every class of bounded expansion has bounded flip width, so the two notions meet in the sparse case where we compare them carefully across many lines of plain text here.';
const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-sel-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
if (TARGET === 'file') await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(600000);
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`${URL0}#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
const id: string = await page.evaluate(async (t: string) => (window as any).editorAPI.store().createDoc({ title: 'Selection bands', preamble: '\\documentclass{article}', blocks: [{ source: t }] }), TEXT);
await page.evaluate((i: string) => { location.hash = `#/doc/${i}`; }, id);
await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && (window as any).editorAPI.currentDoc());
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await idle();
const bid: string = await page.evaluate(() => (window as any).editorAPI.blocks()[0].id);

/** the mirrored caret at offset k: its x and top */
async function caretAt(k: number) {
  await page.evaluate(([i, o]: [string, number]) => (window as any).editorAPI.edit(i, o), [bid, k] as [string, number]);
  await idle(); await frames();
  return page.evaluate(() => { const b = document.querySelector('.blk.editing .rtx-caret-bar'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, top: Math.round(r.top) }; });
}
/** the bands of a selection from..to (keyboard) */
async function bands(from: number, to: number) {
  await caretAt(from);
  for (let i = from; i < to; i++) await page.keyboard.press('Shift+ArrowRight');
  await idle(); await frames();
  return page.evaluate(() => [...document.querySelectorAll('.blk.editing .rtx-sel-band:not(.rtx-sel-glyph)')].map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, top: Math.round(r.top) }; }).sort((a, b) => a.top - b.top || a.l - b.l));
}
const near = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) <= 1;

await caretAt(0);
const tops: number[] = [];
for (let k = 0; k <= TEXT.length; k++) tops.push((await caretAt(k))?.top ?? -1);
const breaks = tops.map((t, k) => (k && t > tops[k - 1] ? k : -1)).filter((k) => k > 0);      // first offset on a new line
check(`the paragraph runs over several lines (${breaks.length + 1})`, breaks.length >= 1, breaks);

const w = (word: string) => TEXT.indexOf(word);
const cases: [string, number, number][] = [
  ['ends with a space', w('merge'), w('merge') + 'merge '.length],
  ['starts with a space', w('merge') - 1, w('merge') + 'merge'.length],
  ['only a space', w('merge') + 'merge'.length, w('merge') + 'merge '.length],
];
for (const [name, from, to] of cases) {
  const xf = (await caretAt(from))!.x, xt = (await caretAt(to))!.x;
  const bs = await bands(from, to);
  check(`${name} («${TEXT.slice(from, to)}»): one band from the caret at its start to the caret at its end`, bs.length === 1 && near(bs[0].l, xf) && near(bs[0].r, xt),
    { bands: bs.map((b) => [b.l.toFixed(1), b.r.toFixed(1)]), caret: [xf.toFixed(1), xt.toFixed(1)] });
}
// across the first line break: from the start of that line's last word to two letters into the next line
{
  const k = breaks[0];                                    // the next line's first offset (a word's first letter)
  const lineEnd = TEXT.lastIndexOf(' ', k - 1);           // after the previous line's last word
  const from = TEXT.lastIndexOf(' ', lineEnd - 1) + 1, to = k + 2;
  const xEnd = (await caretAt(lineEnd))!.x, xf = (await caretAt(from))!.x, xt = (await caretAt(to))!.x;
  const bs = await bands(from, to);
  check(`across a line break («${TEXT.slice(from, to).replace(/\s/g, '␣')}»): the first band runs to its line's end, the second to the caret`,
    bs.length === 2 && near(bs[0].l, xf) && near(bs[0].r, xEnd) && near(bs[1].r, xt),
    { bands: bs.map((b) => [b.l.toFixed(1), b.r.toFixed(1), b.top]), caret: { from: xf.toFixed(1), lineEnd: xEnd.toFixed(1), to: xt.toFixed(1) } });
  // a selection ending after the line's last space (its caret on the next line): its band runs to the line's end
  const bs2 = await bands(from, k);
  check('ending after the space at a line\'s end: the band runs to the line\'s end', bs2.length === 1 && near(bs2[0].l, xf) && near(bs2[0].r, xEnd), { bands: bs2.map((b) => [b.l.toFixed(1), b.r.toFixed(1)]), lineEnd: xEnd.toFixed(1) });
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.evaluate(async (i: string) => { (window as any).editorAPI.leave(); location.hash = '#/'; await (window as any).editorAPI.store().deleteDoc(i); }, id);
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
