// the loading screen follows the theme. For each theme (light, dark, sepia, contrast, and system with either
// colour scheme): the loader's first painted frame is the editor's background colour, and nothing else is painted
// on the way to the editor (no flash), on a load and on a reload; from file:// too (the head's script and the loader
// alone: the stored theme is read there as well). The bundle is held back (its first script waits on the test) so
// the loader can be sampled; frames are recorded by requestAnimationFrame from before the page's first script.
// Waits on events and the app's idle, never on fixed times.
//
//   node tests/test-boot.ts [http://localhost:8151/]          (a dev server: tests/integration/serve.ts)
// Results: test-results/boot/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'boot');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8151/';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}

// the stored theme (the View popover's key), and a frame recorder: what each frame paints as the page's ground
// (the loader while it is shown, else the body), from the first frame
const INIT = (theme: string) => {
  try { localStorage.setItem('rtx-editor.view', JSON.stringify({ theme })); } catch { /* none */ }
  const w = window as any;
  w.__frames = [];
  const f = () => {
    const boot = document.getElementById('boot');
    const shown = !!boot && getComputedStyle(boot).display !== 'none';
    const el = shown ? boot : document.body ?? document.documentElement;
    if (el) w.__frames.push({ boot: shown, bg: getComputedStyle(el!).backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor });
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
};
const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const near = (a: number[], b: number[]) => a.length === 3 && b.length === 3 && a.every((v, k) => Math.abs(v - b[k]) <= 1);
// (CDP's capture: Playwright's screenshot waits for the fonts, which a held-back page never finishes)
async function pixel(page: any, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 1, height: 1, scale: 1 } });
  await cdp.detach();
  return page.evaluate(async (b64: string) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(1, 1), g = c.getContext('2d')!;
    g.drawImage(bm, 0, 0);
    return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, data);
}

const browser = await chromium.launch();
const CASES: [string, string, 'light' | 'dark'][] = [['light', 'light', 'light'], ['dark', 'dark', 'light'], ['sepia', 'sepia', 'light'], ['contrast', 'contrast', 'light'],
  ['system (light)', 'system', 'light'], ['system (dark)', 'system', 'dark']];
const editorBg: Record<string, number[]> = {};
for (const [name, theme, scheme] of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: scheme });
  await ctx.addInitScript(INIT, theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: any) => errors.push(e.message));
  let release: () => void = () => {};
  for (const round of ['load', 'reload']) {
    // the first script after the loader waits until the loader is sampled
    let gate = new Promise<void>((r) => { release = r; });
    await page.unroute('**/lib/viewer/protobuf.min.js').catch(() => {});
    await page.route('**/lib/viewer/protobuf.min.js', async (r: any) => { await gate; await r.continue(); });
    if (round === 'load') await page.goto(`${BASE}?seed=sample&engine&store=memory#/doc/sample`, { waitUntil: 'commit' });
    else await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => (window as any).__frames?.some((f: any) => f.boot));
    const seen = await pixel(page, 8, 790);
    release();
    await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await page.evaluate(() => {
      const w = window as any, fr = w.__frames;
      w.__frames = [];
      return { frames: fr, bg: getComputedStyle(document.body).backgroundColor, cls: document.documentElement.className, data: document.documentElement.dataset.theme };
    });
    const after = await pixel(page, 1190, 790);
    const want = rgb(r.bg);
    editorBg[name] = want;
    // the first frame (before the loader is parsed, the page's own ground) and the loader's first frame
    const first = r.frames[0], loader = r.frames.find((f: any) => f.boot);
    check(`${name} [${round}]: the first painted frame and the loader's are the editor's background ${JSON.stringify(want)}`, !!first && !!loader && near(rgb(first.bg), want) && near(rgb(first.html), want) && near(rgb(loader.bg), want) && near(seen, want), { first, loader, seen, want, cls: r.cls, data: r.data });
    const off = r.frames.filter((f: any) => !near(rgb(f.bg), want) || !near(rgb(f.html), want));
    check(`${name} [${round}]: no other ground on the way to the editor (${r.frames.length} frames)`, r.frames.length > 1 && off.length === 0 && near(after, want), { off: off.slice(0, 3), after });
  }
  check(`${name}: no page errors`, errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

// file://: the page's head and loader alone (the bundle's scripts left out, so the loader stays), the theme stored
// for that origin
{
  const src = readFileSync(join(HERE, 'app/index.html'), 'utf8').replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
  const file = join(OUT, 'boot.html');
  writeFileSync(file, src);
  for (const [name, theme, scheme] of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: scheme });
    await ctx.addInitScript(INIT, theme);
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => (window as any).__frames?.length > 1);
    const r = await page.evaluate(() => (window as any).__frames[0]);
    const seen = await pixel(page, 8, 790);
    const want = editorBg[name];
    check(`${name} [file://]: the loader's first frame is the editor's background`, !!r && r.boot && near(rgb(r.bg), want) && near(seen, want), { first: r, seen, want });
    await ctx.close();
  }
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
