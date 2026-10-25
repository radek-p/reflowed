// The kinds a document offers, in the app: the slash menu (a block's +) and the kind switcher ("/" in an empty
// block) list only what the preamble and its class define (doc/kinds.ts offeredKinds): no Proof, Lemma, Corollary or
// Aligned equations without amsthm, the declarations and amsmath; with them, all of them; no Abstract in a book. In
// headless Chromium on the dev app with no engine (?backend=none: nothing needs typesetting). Waits on the app's idle
// and DOM state, never on fixed times.
//
//   node tests/test-offered-kinds.ts [http://localhost:8150/]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'offered-kinds');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8150/';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d.slice(0, 400)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })).newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
await page.goto(`${BASE}?seed=sample&backend=none#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const api = (fn: string, ...a: any[]) => page.evaluate(([f, args]: [string, any[]]) => (window as any).editorAPI[f](...args), [fn, a] as [string, any[]]);
await idle();

const ART = '\\documentclass{article}\n';
const FULL = `${ART}\\usepackage{amsmath,amsthm}\n\\newtheorem{lemma}{Lemma}\n\\newtheorem{corollary}[lemma]{Corollary}\n`;
const listed = () => page.locator('.menu.slash .menu-item').evaluateAll((els: any[]) => els.map((e) => e.dataset.kind));
/** the slash menu of the first paragraph's +: the kinds it lists */
async function plusMenu(): Promise<string[]> {
  const id = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => b.kind === 'paragraph')?.id);
  const row = page.locator(`.blk[data-id="${id}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator('.g-add').click();
  await page.waitForSelector('.menu.slash');
  const kinds = await listed();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu.slash', { state: 'detached' });
  return kinds;
}
/** the kind switcher: "/" typed in a new empty block; the kinds it lists (Escape: the "/" stays as text, then removed) */
async function switcher(): Promise<string[]> {
  const id = await api('insert', 1, 'paragraph', '');
  await idle();
  await api('edit', id, 0);
  await page.waitForSelector('.cm-editor .cm-content:focus, .cm-content:focus');
  await page.keyboard.type('/');
  await page.waitForSelector('.menu.slash');
  const kinds = await listed();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu.slash', { state: 'detached' });
  await api('leave');
  await api('remove', id);
  await idle();
  return kinds;
}
const setPreamble = async (s: string) => { await api('setPreamble', s); await idle(); };

{
  await setPreamble(ART);
  const plus = await plusMenu(), slash = await switcher();
  const none = (l: string[]) => ['proof', 'lemma', 'corollary', 'align'].filter((k) => l.includes(k));
  check('article without amsthm, amsmath or declarations: the + menu offers no Proof, Lemma, Corollary or Aligned equations', none(plus).length === 0 && plus.includes('abstract') && plus.includes('equation'), plus);
  check('the same in the kind switcher ("/" in an empty block)', none(slash).length === 0 && slash.includes('abstract'), slash);
}
{
  await setPreamble(FULL);
  const plus = await plusMenu(), slash = await switcher();
  const all = (l: string[]) => ['proof', 'lemma', 'corollary', 'align'].every((k) => l.includes(k));
  check('with amsmath, amsthm and \\newtheorem{lemma}, {corollary}: the + menu offers all four', all(plus), plus);
  check('the same in the kind switcher', all(slash), slash);
}
{
  await setPreamble(`${FULL.replace('article', 'book')}`);
  const plus = await plusMenu();
  check('a book: no Abstract (the class defines none); the theorems stay', !plus.includes('abstract') && plus.includes('lemma'), plus);
  await setPreamble(`${ART}% \\usepackage{amsthm}\n`);
  const commented = await plusMenu();
  check('a commented-out amsthm: no Proof', !commented.includes('proof'), commented);
}
check('no page errors', problems.length === 0, problems.slice(0, 5));
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
