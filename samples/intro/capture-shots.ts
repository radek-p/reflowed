// The introduction's screenshots (samples/intro/source/figures/shot-<name>.png, the names of make-placeholders.ts's
// SHOTS), taken from the real editor: the dev server with its seed cache, through Playwright (on macOS the real Google
// Chrome, so the UI is in the system font; --channel chromium for Playwright's own), a fresh profile with the intro
// created from its source (buildIntroSeed), the light theme (but for the themes shot), device scale factor 2. Each shot sets up its state (the intro open, a
// block's popover, a split, a menu, a hovered reference, the figure editor on a figure this script makes, the View
// options and the four themes), waits on state (editorAPI.whenIdle() and conditions, never on fixed times), crops to
// the feature with a margin and writes the PNG at about twice the column's width in pixels, as a palette PNG when
// sharp (with libimagequant) is found in $REFLOWTEX/node_modules, else as the browser's PNG (the themes shot needs sharp).
// Run it twice: the second run shows the first run's pictures where a figure of the intro is in view.
// Then rebuild the intro's seed: node samples/intro/seed-intro.ts (or node scripts/seed.ts).
//
//   node samples/intro/capture-shots.ts [--only <name>[,<name>…]] [--url <dev server>] [--port 8040] [--out <dir>] [--full] [--channel chrome|chromium]
//     no --url: starts tests/integration/serve.ts <port> --seed-cache itself (REFLOWTEX, TECTONIC_CACHE as for the
//     dev server) and stops it at the end; --full also writes each state's whole window as full-<name>.png (to check
//     the crops); --out: another directory than source/figures.
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS } from './make-placeholders.ts';
import { buildIntroSeed } from './seed-intro.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(opt('--out') ?? join(HERE, 'source/figures'));
const ONLY = opt('--only')?.split(',');
const FULL = argv.includes('--full');
const PORT = Number(opt('--port') ?? 8040);
const OUT_W = 1400;                        // px: about twice the column's width (the figures are \linewidth wide)
const DSF = 2;

// ── Playwright's page, as far as this script uses it ─────────────────────────────────────────────────────────────
interface Box { x: number; y: number; width: number; height: number }
interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<R, A = undefined>(fn: (a: A) => R | Promise<R>, arg?: A): Promise<R>;
  waitForFunction<A>(fn: (a: A) => unknown, arg?: A, o?: { timeout?: number }): Promise<unknown>;
  screenshot(o: { clip?: Box; path?: string; fullPage?: boolean }): Promise<Buffer>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  click(sel: string): Promise<void>;
  mouse: { move(x: number, y: number, o?: { steps?: number }): Promise<void>; click(x: number, y: number): Promise<void> };
  keyboard: { press(k: string): Promise<void> };
  on(ev: 'pageerror', f: (e: Error) => void): void;
  close(): Promise<void>;
  setDefaultTimeout(ms: number): void;
}
interface Context { newPage(): Promise<Page>; close(): Promise<void> }
interface Browser { newContext(o: object): Promise<Context>; close(): Promise<void> }
interface SharpImage {
  resize(o: { width: number }): SharpImage; png(o: object): SharpImage; extend(o: { top: number; bottom: number; left: number; right: number; background: string }): SharpImage;
  composite(l: { input: Buffer; left: number; top: number }[]): SharpImage; extract(o: { left: number; top: number; width: number; height: number }): SharpImage; toBuffer(): Promise<Buffer>; metadata(): Promise<{ width?: number; height?: number }>;
}
interface Sharp {
  (input: Buffer | { create: { width: number; height: number; channels: 3 | 4; background: string } }): SharpImage;
}
type Api = Record<string, (...a: unknown[]) => unknown>;
interface Block { id: string; kind: string; source: string }
declare const window: { editorAPI: Api & { whenIdle(): Promise<void> } };

const req = createRequire(join(ROOT, 'app/package.json'));
const { chromium } = req('playwright') as { chromium: { launch(o: { channel?: string }): Promise<Browser> } };
let sharp: Sharp | null = null;
try { if (process.env.REFLOWTEX) sharp = createRequire(join(process.env.REFLOWTEX, 'package.json'))('sharp') as Sharp; } catch { sharp = null; }

// ── the dev server ──────────────────────────────────────────────────────────────────────────────────────────────
let server: ChildProcess | null = null;
let BASE = opt('--url');
if (!BASE) {
  server = spawn(process.execPath, [join(ROOT, 'tests/integration/serve.ts'), String(PORT), '--seed-cache'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((ok, no) => {
    server!.stdout!.on('data', (d: Buffer) => { if (/http:\/\//.test(String(d))) ok(); });
    server!.on('exit', (c) => no(new Error(`the dev server exited (${c})`)));
  });
  BASE = `http://127.0.0.1:${PORT}/`;
}
BASE = BASE.replace(/\/?$/, '/');

// on macOS the real Google Chrome, so the UI is drawn in the system font (a Linux fallback font has other metrics)
const CHANNEL = opt('--channel') ?? (process.platform === 'darwin' ? 'chrome' : undefined);
const browser = await chromium.launch(CHANNEL && CHANNEL !== 'chromium' ? { channel: CHANNEL } : {});
const errors: string[] = [];
async function freshPage(width = 1280, height = 860): Promise<{ ctx: Context; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: DSF, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const idle = (page: Page) => page.evaluate(() => window.editorAPI.whenIdle());
const frames = (page: Page, k = 3) => page.evaluate((n: number) => new Promise<void>((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r()); f(n); }), k);
/** the viewer's own idle (its deferred drawing), when it has one */
const viewerIdle = (page: Page) => page.evaluate(async () => { await (globalThis as unknown as { reflowtex?: { inspect?: { idle?(): Promise<void> } } }).reflowtex?.inspect?.idle?.(); });
async function settle(page: Page) { await idle(page); await viewerIdle(page); await frames(page, 4); await idle(page); }

/** the intro as a seed, built from samples/intro/source now (so the shots show what the source holds) */
const INTRO_SEED = JSON.stringify((await buildIntroSeed()).seed);
// the capture's own style: the build's version pill is not shown (it says which build took the shot)
const CAPTURE_CSS = '.rtx-preview-pill { visibility: hidden !important; }';

/** a fresh profile (only the tests' fixture as its default document: ?seed=sample), the intro loaded from its seed
 *  when the store does not have it, and opened */
async function openIntro(page: Page) {
  await page.goto(`${BASE}?engine&seed=sample#/`);
  await page.waitForFunction(() => (window.editorAPI?.route?.() as { name?: string } | undefined)?.name === 'home', undefined, { timeout: 300000 });
  await (page as unknown as { addStyleTag(o: { content: string }): Promise<unknown> }).addStyleTag({ content: CAPTURE_CSS });
  const id = await page.evaluate(async (text: string) => {
    const seed = JSON.parse(text) as { id: string; init: { assets?: { base64: string }[] } & Record<string, unknown> };
    const st = (window.editorAPI as unknown as { store(): { listDocs(): Promise<{ id: string; tags?: string[]; meta?: { tags?: string[] } }[]>; createDoc(i: object): Promise<string> } }).store();
    const have = (await st.listDocs()).find((d) => d.tags?.includes("intro") || d.meta?.tags?.includes("intro"));
    if (have) return have.id;
    const assets = (seed.init.assets ?? []).map(({ base64, ...a }) => ({ ...a, bytes: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) }));
    return st.createDoc({ ...seed.init, id: seed.id, assets });
  }, INTRO_SEED);
  await page.evaluate((d: string) => { location.hash = `#/doc/${d}`; }, id);
  await page.waitForFunction((d: string) => (window.editorAPI.currentDoc() as { id?: string } | null)?.id === d, id, { timeout: 300000 });
  await settle(page);
}
const blocks = (page: Page) => page.evaluate(() => (window.editorAPI.blocks() as Block[]).map((b) => ({ id: b.id, kind: b.kind, source: b.source })));
async function blockId(page: Page, test: (b: Block) => boolean): Promise<string> {
  const b = (await blocks(page)).find(test);
  if (!b) throw new Error('capture: no such block');
  return b.id;
}
/** a block of the focused pane brought to `at` px from the pane's top (the pane scrolls, the window never does) */
async function scrollBlockTo(page: Page, id: string, at = 60, pane = '[data-part="page"]') {
  await page.evaluate(([i, y, p]: [string, number, string]) => {
    const el = document.querySelector(`main.rtx-pane${p} .blk[data-id="${i}"]`) as HTMLElement;
    const host = el.closest('main.rtx-pane') as HTMLElement;
    host.scrollTop += el.getBoundingClientRect().top - host.getBoundingClientRect().top - y;
  }, [id, at, pane] as [string, number, string]);
  await settle(page);
}
const rectOf = (page: Page, sel: string) => page.evaluate((s: string) => {
  const el = document.querySelector(s);
  if (!el) throw new Error(`capture: nothing at ${s}`);
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}, sel);
const union = (...bs: Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.width)), y1 = Math.max(...bs.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
/** a box grown by m px on every side, kept in the window */
const pad = (b: Box, m: number, vw: number, vh: number): Box => {
  const x = Math.max(0, Math.floor(b.x - m)), y = Math.max(0, Math.floor(b.y - m));
  return { x, y, width: Math.min(vw, Math.ceil(b.x + b.width + m)) - x, height: Math.min(vh, Math.ceil(b.y + b.height + m)) - y };
};

/** the PNG: at most OUT_W px wide, a palette PNG when sharp is there */
async function writeShot(name: string, png: Buffer, maxW = OUT_W) {
  let out = png;
  if (sharp) {
    const m = await sharp(png).metadata();
    let s = sharp(png);
    if ((m.width ?? 0) > maxW) s = sharp(await s.resize({ width: maxW }).png({}).toBuffer());
    out = await s.png({ palette: true, quality: 90, effort: 10, compressionLevel: 9, dither: 0.5 }).toBuffer();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `shot-${name}.png`), out);
  const m = sharp ? await sharp(out).metadata() : { width: 0, height: 0 };
  console.log(`shot-${name}.png  ${m.width ?? '?'}×${m.height ?? '?'}  ${(out.length / 1024).toFixed(0)} KB`);
}
async function full(page: Page, name: string) { if (FULL) await page.screenshot({ path: join(OUT, `full-${name}.png`) }); }

type Wb = { run(a: string, arg?: unknown): void };
const THEME_CLASSES = ['dark', 'sepia', 'contrast'];
/** the page's theme set through the View options' model, once the page shows it */
async function setTheme(page: Page, theme: string) {
  await page.evaluate((t: string) => (window.editorAPI.view() as unknown as { set(o: object): void }).set({ theme: t }), theme);
  await page.waitForFunction(([t, all]: [string, string[]]) => all.every((c) => document.documentElement.classList.contains(c) === (c === t)), [theme, THEME_CLASSES] as [string, string[]]);
  await settle(page);
}
/** a fresh profile with the intro open in the light theme */
async function introPage(width: number, height: number) {
  const p = await freshPage(width, height);
  await openIntro(p.page);
  await setTheme(p.page, 'light');
  return p;
}
const VW = (page: Page) => page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
async function clipShot(page: Page, b: Box, m = 16) { const v = await VW(page); return page.screenshot({ clip: pad(b, m, v.w, v.h) }); }
/** the block's box in the focused pane */
const blockBox = (page: Page, id: string, pane = '[data-part="page"]') => rectOf(page, `main.rtx-pane${pane} .blk[data-id="${id}"]`);

/** the figure this script draws for the figure editor: the fourth triangular number as dots, with a label */
function dotsFigure() {
  let n = 0;
  const id = () => `f${n++}`;
  const style = { strokeOpacity: 1, fillOpacity: 1, width: 0.8, dash: 'solid', arrowStart: 'none', arrowEnd: 'none' };
  const objects: object[] = [];
  for (let k = 1; k <= 4; k++) for (let j = 1; j <= k; j++) {
    objects.push({ id: id(), type: 'ellipse', x: 24 + (j - 1) * 24, y: 20 + (k - 1) * 24, w: 14, h: 14, ...style, stroke: null, fill: '#3584e4' });
  }
  objects.push({ id: 'stairs', type: 'path', closed: true, pts: [[16, 12], [46, 12], [46, 36], [70, 36], [70, 60], [94, 60], [94, 84], [118, 84], [118, 108], [16, 108]], ...style, stroke: '#9141ac', fill: null, dash: 'dashed' });
  objects.push({ id: 'arrow', type: 'line', pts: [[226, 60], [146, 60]], ...style, stroke: '#77767b', fill: null, arrowEnd: 'latex' });
  objects.push({ id: 'label', type: 'text', x: 234, y: 60, anchor: 'w', src: '$T_4 = 1 + 2 + 3 + 4 = 10$', align: 'left', size: 'normal', color: '#000000', opacity: 1 });
  return { v: 1, w: 370, h: 124, objects };
}

// ── the shots ───────────────────────────────────────────────────────────────────────────────────────────────────
const shots: Record<string, () => Promise<void>> = {
  /** the theorem's source open in the code popover, below its live preview */
  async 'code-popover'() {
    const { ctx, page } = await introPage(1280, 860);
    const id = await blockId(page, (b) => b.kind === 'theorem');
    const def = await blockId(page, (b) => b.kind === 'definition');
    await scrollBlockTo(page, def, 120);
    const pt = await page.evaluate((i: string) => { const r = document.querySelector(`[data-part="page"] .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + r.width * 0.4, y: r.top + 14 }; }, id);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForFunction((i: string) => (window.editorAPI.sessions() as { id: string }[]).some((s) => s.id === i), id);
    await page.waitForFunction(() => !!document.querySelector('[data-part="page"] .blk.editing .cm-content'));
    await settle(page); await frames(page, 20);
    await full(page, 'code-popover');
    const ed = await rectOf(page, '[data-part="page"] .blk.editing');
    const d = await blockBox(page, def);
    await writeShot('code-popover', await clipShot(page, union({ ...ed, x: ed.x - 70, width: ed.width + 70 }, d), 20));
    await ctx.close();
  },
  /** the same document in two panes, side by side, each at its own place */
  async 'split-view'() {
    const { ctx, page } = await introPage(1440, 680);
    await page.evaluate(() => (window.editorAPI.workbench() as unknown as Wb).run('splitRight'));
    await page.waitForFunction(() => document.querySelectorAll('main.rtx-pane').length >= 2 && document.querySelectorAll('main.rtx-pane .blocks > .blk .blk-render > .latex-block').length > 0);
    await settle(page);
    const panes = await page.evaluate(() => [...document.querySelectorAll('main.rtx-pane')].map((m) => m.getAttribute('data-pane')!));
    // each pane at a part of the intro without its screenshots: A at Mathematics, B at Notes and TODOs
    const maths = await blockId(page, (b) => b.kind === 'heading' && /Mathematics/.test(b.source));
    const notes = await blockId(page, (b) => b.kind === 'heading' && /Notes and TODOs/.test(b.source));
    await scrollBlockTo(page, maths, 16, `[data-pane="${panes[0]}"]`);
    await scrollBlockTo(page, notes, 16, `[data-pane="${panes[1]}"]`);
    await full(page, 'split-view');
    await writeShot('split-view', await page.screenshot({}), 1800);
    await ctx.close();
  },
  /** the side panel with the Outline, beside the document at the Mathematics section */
  async 'outline'() {
    const { ctx, page } = await introPage(1000, 700);
    const h = await blockId(page, (b) => b.kind === 'heading' && /Mathematics/.test(b.source));
    await scrollBlockTo(page, h, 20);
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll('button.ol-link')].find((e) => /Mathematics/.test(e.textContent ?? ''))!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(row.x, row.y);
    await settle(page);
    await full(page, 'outline');
    const side = await page.evaluate(() => {
      const ref = [...document.querySelectorAll('button.ol-link')].find((e) => /References/.test(e.textContent ?? ''))!.getBoundingClientRect();
      return { bottom: ref.bottom };
    });
    await writeShot('outline', await page.screenshot({ clip: { x: 0, y: 0, width: 1000, height: Math.ceil(side.bottom + 60) } }));
    await ctx.close();
  },
  /** the section menu, open from the tab's section, a row's actions shown */
  async 'section-menu'() {
    const { ctx, page } = await introPage(1000, 700);
    const id = await blockId(page, (b) => b.kind === 'heading' && /Mathematics/.test(b.source));
    await scrollBlockTo(page, id, 30);
    await page.evaluate(() => (window.editorAPI.workbench() as unknown as Wb).run('sectionMenu'));
    await page.waitForFunction(() => !!document.querySelector('.wb-select-pop [data-row]'));
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.wb-select-pop [data-row]')].find((e) => /Citations/.test(e.textContent ?? ''))!.getBoundingClientRect();
      return { x: r.left + r.width * 0.4, y: r.top + r.height / 2 };
    });
    await page.mouse.move(row.x, row.y);
    await settle(page);
    await full(page, 'section-menu');
    const pop = await rectOf(page, '.wb-select-pop');
    const pane = await rectOf(page, 'main.rtx-pane[data-part="page"]');
    const vw = (await VW(page)).w;
    await writeShot('section-menu', await page.screenshot({ clip: { x: Math.floor(pane.x), y: 0, width: vw - Math.floor(pane.x), height: Math.ceil(pop.y + pop.height + 20) } }));
    await ctx.close();
  },
  /** the card a hovered \Cref opens */
  async 'reference-card'() {
    const { ctx, page } = await introPage(1280, 860);
    const id = await blockId(page, (b) => b.kind === 'paragraph' && b.source.startsWith('\\Cref{thm:gauss}'));
    await scrollBlockTo(page, id, 860 - 200);            // near the bottom: the card opens above it, over the theorem
    const pt = await page.evaluate((i: string) => {
      const rn = window.editorAPI.refnav() as unknown as { rescan(): void; units(): { id: string; blockId: string; labels: string[] }[]; elements(u: string): Element[] };
      rn.rescan();
      const u = rn.units().find((x) => x.blockId === i && x.labels.includes('thm:gauss'))!;
      const r = rn.elements(u.id).find((g) => (g.textContent ?? '').trim())!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, id);
    await page.mouse.move(pt.x - 30, pt.y + 30);
    await page.mouse.move(pt.x, pt.y, { steps: 4 });
    await page.waitForFunction(() => { const c = document.querySelector('#rn-card'); const r = c?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 && !!c!.querySelector('.rn-body svg'); });
    await settle(page);
    await full(page, 'reference-card');
    const card = await rectOf(page, '#rn-card');
    const b = await blockBox(page, id);
    const v = await VW(page), c = pad(union(card, b), 20, v.w, v.h);
    const top = Math.max(c.y, Math.floor(b.y - 4));          // not the line above the paragraph
    await writeShot('reference-card', await page.screenshot({ clip: { ...c, y: top, height: c.y + c.height - top } }));
    await ctx.close();
  },
  /** the figure editor, on a drawn figure in a document this script makes */
  async 'figure-editor'() {
    const { ctx, page } = await introPage(1280, 820);
    const svg = await page.evaluate((fig: object) => (window.editorAPI.svgFigures() as unknown as { toSvg(f: object): string }).toSvg(fig), dotsFigure());
    const doc = await page.evaluate(async (s: string) => (window.editorAPI.store() as unknown as { createDoc(i: object): Promise<string> }).createDoc({
      title: 'A drawn figure',
      preamble: '\\documentclass{article}\n\\usepackage{graphicx}',
      blocks: [
        { kind: 'paragraph', source: 'The fourth triangular number, drawn in the figure editor.' },
        { kind: 'figure', source: '\\begin{figure}[h]\n  \\centering\n  \\includegraphics{figures/dots.svg}\n  \\caption{Ten dots in four rows.}\\label{fig:dots}\n\\end{figure}' },
      ],
      assets: [{ name: 'figures/dots.svg', mime: 'image/svg+xml', bytes: new TextEncoder().encode(s) }],
    }), svg);
    await page.evaluate((d: string) => { location.hash = `#/doc/${d}`; }, doc);
    await page.waitForFunction((d: string) => (window.editorAPI.currentDoc() as { id?: string } | null)?.id === d, doc);
    await settle(page);
    const fid = await blockId(page, (b) => b.kind === 'figure');
    await page.evaluate((i: string) => { (window as unknown as { __edDone: unknown }).__edDone = window.editorAPI.editFigure(i); }, fid);
    await page.waitForFunction(() => !!document.querySelector('.svf-root.svf-ready'));
    const svf = () => page.evaluate(async () => { await (globalThis as unknown as { __svgfig: { idle(): Promise<void> } }).__svgfig.idle(); });
    await svf();
    await page.evaluate(() => (globalThis as unknown as { __svgfig: { ed: { select(ids: string[]): void } } }).__svgfig.ed.select(['arrow']));
    await svf(); await frames(page, 4);
    await full(page, 'figure-editor');
    await writeShot('figure-editor', await page.screenshot({}));
    await ctx.close();
  },
  /** the View options, and the definition and the theorem in each of the four themes */
  async 'themes'() {
    const { ctx, page } = await introPage(1180, 820);
    const def = await blockId(page, (b) => b.kind === 'definition');
    const thm = await blockId(page, (b) => b.kind === 'theorem');
    await scrollBlockTo(page, def, 150);
    const parts: { theme: string; png: string }[] = [];
    await page.evaluate(() => (window.editorAPI.view() as unknown as { set(o: object): void }).set({ width: "narrow" }));
    await settle(page);
    await scrollBlockTo(page, def, 150);
    for (const theme of ['light', 'dark', 'sepia', 'contrast']) {
      await setTheme(page, theme);
      const b = union(await blockBox(page, def), await blockBox(page, thm));
      const c = pad(b, 18, (await VW(page)).w, (await VW(page)).h);
      await full(page, `themes-${theme}`);
      parts.push({ theme, png: (await page.screenshot({ clip: c })).toString('base64') });
    }
    await setTheme(page, "light");
    await page.evaluate(() => (window.editorAPI.view() as unknown as { set(o: object): void }).set({ width: "medium" }));
    await settle(page);
    await page.click('#btn-view');
    await page.waitForFunction(() => !(document.getElementById('rtx-view-pop') as HTMLElement).hidden);
    await settle(page);
    await full(page, 'themes');
    const vp = await rectOf(page, '#rtx-view-pop');
    const popC = pad(vp, 0, (await VW(page)).w, (await VW(page)).h);
    const pop = (await page.screenshot({ clip: popC })).toString('base64');
    // the five pictures on one sheet: the popover, then the four themes in two rows (device pixels throughout)
    if (!sharp) throw new Error("capture: the themes shot puts five pictures together with sharp (REFLOWTEX's node_modules)");
    const sh = sharp;
    // each card in a 2 px grey frame; Contrast in a 6 px black one (the same outer size), so it reads apart from Light
    const framed = await Promise.all(parts.map(async (p) => {
      const img = Buffer.from(p.png, "base64");
      if (p.theme !== "contrast") return sh(img).extend({ top: 2, bottom: 2, left: 2, right: 2, background: "#d4d4d4" }).png({}).toBuffer();
      const m = await sh(img).metadata(), w = m.width ?? 0, h = m.height ?? 0, B = 6, cut = B - 2;
      const inner = await sh(img).extract({ left: cut, top: cut, width: w - 2 * cut, height: h - 2 * cut }).png({}).toBuffer();
      return sh({ create: { width: w + 4, height: h + 4, channels: 4, background: "#000000" } }).composite([{ input: inner, left: B, top: B }]).png({}).toBuffer();
    }));
    const sizes = await Promise.all(framed.map(async (x) => sh(x).metadata()));
    const popPng = Buffer.from(pop, "base64"), popM = await sh(popPng).metadata();
    const G = 28, cw = Math.max(...sizes.map((m) => m.width ?? 0)), ch = Math.max(...sizes.map((m) => m.height ?? 0));
    const left = G + (popM.width ?? 0) + G;
    const W = left + 2 * cw + G + G, H = Math.max((popM.height ?? 0) + 2 * G, 2 * ch + 3 * G);
    const layers = [{ input: popPng, left: G, top: G }, ...framed.map((input, k) => ({ input, left: left + (k % 2) * (cw + G), top: G + Math.floor(k / 2) * (ch + G) }))];
    const sheetPng = await sh({ create: { width: W, height: H, channels: 4, background: "#ffffff" } }).composite(layers).png({}).toBuffer();
    await writeShot("themes", sheetPng);
    await ctx.close();
  },
};

try {
  for (const name of Object.keys(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    await shots[name]!();
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
} finally {
  await browser.close();
  server?.kill();
}
