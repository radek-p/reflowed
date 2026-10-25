// The caret between the preview and the source, clicked through on whole documents.
//
//   node tests/test-caret.ts dev [http://localhost:8150/] [--docs intro] [--per 10] [--sample N] [--browser chromium]
//   (--sample N: N blocks per document spread over it, the standard tier; without it every block)
//   node tests/test-caret.ts file [dist/reflowtex-editor.html] [--docs …]
//   (Playwright; the file must carry the documents: build.ts carries the intro)
//
// For every block of each document that has text (up to all of them), on the app itself:
//   1. identity: every letter the view maps exactly (not through a macro) is the source character at
//      its offset (a control sequence's glyph at its backslash) – the engine's source positions, as the
//      view uses them; and letters without any position are rare (≤ 1 %);
//   2. round trip: for up to --per offsets k between two exactly mapped letters of one word, the editor's
//      caret is put at k (api.edit), the preview's mirrored caret bar is read, and a real click just
//      right of that bar (in the left half of the letter at k) must put the editor's caret back at k.
// Waits on editorAPI.whenIdle() and animation frames, never on fixed times.
// Results: test-results/caret/<target>-<browser>/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { sampleArg, spread } from './qa/lib/sample.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const TARGET = argv[0] === 'file' ? 'file' : 'dev';
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const BROWSER = flag('--browser') ?? 'chromium';
const DOCS = (flag('--docs') ?? 'intro').split(',');
const PER = Number(flag('--per') ?? 10);
const SAMPLE = sampleArg(argv);              // blocks per document, spread over it (null: all)
const pos = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const URL0 = TARGET === 'file' ? `file://${pos ?? join(HERE, 'dist/reflowtex-editor.html')}` : (pos ?? 'http://localhost:8150/').replace(/\/?$/, '/');
const OUT = join(resultsDir(HERE), `caret/${TARGET}-${BROWSER}`);
mkdirSync(OUT, { recursive: true });
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 700)}` : ''}`);
};

const ctx = await pw[BROWSER].launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-caret-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
  ...(TARGET === 'file' && BROWSER !== 'webkit' ? { offline: true } : {}) });
if (TARGET === 'file') await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
// the column: medium (704 px), what this suite was written for; Paper is the editor's default.
// --width paper runs it at \textwidth (20 of 1192 letters of the former sample paper mapped one letter off there)
const WIDTH = process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 'medium';
await ctx.addInitScript((w: string) => { try { const k = 'rtx-editor.view', v = JSON.parse(localStorage.getItem(k) || '{}'); if (!v.width) localStorage.setItem(k, JSON.stringify({ ...v, width: w })); } catch { /* */ } }, WIDTH);
page.setDefaultTimeout(600000);
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message));
await page.goto(`${URL0}${TARGET === 'dev' ? '?engine' : ''}#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const tag of DOCS) {
  // a document the build does not carry (a release with the intro only): said, not waited for
  const has = await page.evaluate(async (t: string) => (await (window as any).editorAPI.store().listDocs()).some((d: any) => d.id === t || d.tags?.includes(t) || d.meta?.tags?.includes(t)), tag);
  if (!has) { console.log(`skip ${tag}: not in this build's store`); continue; }
  // from home, so the route changes whatever was open (an alias resolves to the document's id)
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home');
  await page.evaluate((t: string) => { location.hash = `#/doc/${t}`; }, tag);
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && !!(window as any).editorAPI.currentDoc());
  await idle();
  const title: string = await page.evaluate(() => (window as any).editorAPI.currentDoc()?.title ?? '');
  const ids: string[] = spread(await page.evaluate(() => (window as any).editorAPI.blocks()
    .filter((b: any) => b.mounted && b.state === 'ok' && b.kind !== 'bibliography' && /[A-Za-z]{4}/.test(b.source) && b.source.length > 40).map((b: any) => b.id)), SAMPLE);
  let letters = 0, exact = 0, none = 0, clicks = 0, rotated = 0;
  const wrong: string[] = [], badClicks: string[] = [];
  for (const id of ids) {
    // enter at 0, read the view's map for the render as compiled
    await page.evaluate((i: string) => { document.querySelector(`.blk[data-id="${i}"]`)!.scrollIntoView({ block: 'center' }); (window as any).editorAPI.edit(i, 0); }, id);
    await idle(); await frames();
    const m: any = await page.evaluate((i: string) => {
      const v = (window as any).editorAPI.view();
      const x = v.caretMap(document.querySelector(`.blk[data-id="${i}"] .blk-render`));
      return x && { method: x.method, compiled: x.compiled, glyphs: x.glyphs };
    }, id);
    if (!m || m.method !== 'engine') { wrong.push(`${id.slice(-6)}: no engine map (${m?.method ?? 'none'})`); continue; }
    const text: string = m.compiled;
    const L = /^\p{L}$/u;
    const good: number[] = [];                                  // offsets of exactly mapped letters, drawing order
    for (const g of m.glyphs) {
      if (!L.test(g.ch)) continue;
      letters++;
      if (g.off < 0) { none++; continue; }
      if (g.via) continue;
      const at = text[g.off];
      if (at === '\\' || g.ch.normalize('NFKD')[0] === at.normalize('NFKD')[0]) { exact++; if (at !== '\\') good.push(g.off); }
      else wrong.push(`${id.slice(-6)} «${g.ch}»@${g.off} → ${JSON.stringify(text.slice(g.off, g.off + 8))}`);
    }
    // round trip at offsets between two letters of one word, both exactly mapped and drawn one after the other
    const cand = good.filter((k, i) => i > 0 && good[i - 1] === k - 1 && L.test(text[k - 1]) && L.test(text[k]));
    const pick = cand.filter((_k, i) => i % Math.max(1, Math.floor(cand.length / PER)) === 0).slice(0, PER);
    for (const k of pick) {
      await page.evaluate(([i, o]: [string, number]) => (window as any).editorAPI.edit(i, o), [id, k]);
      await idle(); await frames();
      const bar: any = await page.evaluate((i: string) => {
        const b = document.querySelector(`.blk[data-id="${i}"] .blk-render .rtx-caret-bar`);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, unsure: b.classList.contains('rtx-caret-unsure') };
      }, id);
      clicks++;
      if (!bar || bar.unsure) { badClicks.push(`${id.slice(-6)}@${k}: ${bar ? 'caret unsure' : 'no caret in the preview'}`); continue; }
      // inside the letter at k, its left part: a quarter of the line height right of the bar
      await page.mouse.click(bar.x + Math.max(1.5, bar.h * 0.12), bar.y);
      await idle();
      const got: any = await page.evaluate(() => (window as any).editorAPI.caret());
      if (got?.id === id && got.offset === k) continue;
      // text that does not run left to right on a line (\rotatebox): "right of the bar" is not in the letter;
      // told by the bar at k + 1, which is then not to the right of the one at k on the same line
      await page.evaluate(([i, o]: [string, number]) => (window as any).editorAPI.edit(i, o), [id, k + 1]);
      await idle(); await frames();
      const next: any = await page.evaluate((i: string) => { const b = document.querySelector(`.blk[data-id="${i}"] .blk-render .rtx-caret-bar`); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
      if (next && (Math.abs(next.y - bar.y) > 1 || next.x <= bar.x)) { rotated++; continue; }
      badClicks.push(`${id.slice(-6)}@${k} «${text.slice(k - 3, k)}|${text.slice(k, k + 3)}» → ${got?.id === id ? got.offset : got?.id?.slice(-6) ?? 'none'} «${got?.id === id ? `${text.slice(got.offset - 3, got.offset)}|${text.slice(got.offset, got.offset + 3)}` : ''}»`);
    }
    await page.evaluate(() => (window as any).editorAPI.leave());
    await idle();
  }
  check(`${tag} («${title.slice(0, 40)}»): every exactly mapped letter is its own source character (${ids.length} blocks)`, wrong.length === 0 && exact > 0, wrong.length ? wrong.slice(0, 10) : `${exact}/${letters} letters exact`);
  check(`${tag}: letters without a source position ≤ 1 %`, none <= letters * 0.01, `${none}/${letters}`);
  check(`${tag}: preview caret → click → the same source offset, at ${clicks} places`, clicks > Math.min(ids.length, 20) && badClicks.length === 0, badClicks.length ? `${badClicks.length} wrong: ${badClicks.slice(0, 10).join(' | ')}` : `${clicks} clicks (${rotated} in text not running left to right, not counted)`);
}
// the glyph-order invariant held for every item the clicks used (engine-api sourcemap-guard.ts)
const guard: any = await page.evaluate(() => (globalThis as any).rtxSourceMapGuard ?? null);
check('source map items match the viewer\'s glyphs (S8 guard: no mismatch)', !!guard && guard.checked > 0 && guard.mismatches === 0, guard ? `${guard.checked} items checked, ${guard.mismatches} mismatches${guard.last ? ': ' + guard.last : ''}` : 'guard not loaded');
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await ctx.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), url: URL0, results }, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
