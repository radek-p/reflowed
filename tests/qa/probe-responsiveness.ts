// The responsiveness pass: the editor before the integration (main ≤
// c618197, the old page) against today's (the workbench page), on the same document, by the same real inputs. Each action
// is traced (tests/qa/lib/work.ts: the main thread's CPU per task, per input event) from the input until the page is at
// rest again (editorAPI.whenIdle, then two frames); REPS runs each, the median reported.
//
//   node tests/qa/probe-responsiveness.ts --old http://127.0.0.1:8162/ --new http://127.0.0.1:8161/ [--reps 7] [--blocks 300]
//        [--backend none|engine] [--only <regex>]
//
// Either URL may be left out (one page measured). --backend none (the default here) opens the document without a TeX
// engine: the blocks show their source, so the numbers are the chrome's own cost (panels, tabs, splits, observers,
// popovers), not typesetting; with an engine, --backend engine. The document: a generated article of --blocks blocks
// (sections, paragraphs, displays), imported through the page's own io, so both pages lay out the same blocks.
// Writes test-results/responsiveness/<page>.json and prints a table (CPU ms: median of the action's total, its longest
// task, its input event's dispatch; wall ms: input to rest).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceWork, median } from './lib/work.ts';
import { resultsDir } from './lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(resultsDir(HERE), 'responsiveness');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const arg = (k: string, d: string | null = null) => (argv.includes(k) ? argv[argv.indexOf(k) + 1]! : d);
const REPS = Number(arg('--reps', '7')), BLOCKS = Number(arg('--blocks', '300')), BACKEND = arg('--backend', 'none')!;
const ONLY = arg('--only') ? new RegExp(arg('--only')!) : null;
const PAGES = (['old', 'new'] as const).map((k) => ({ kind: k, url: arg(`--${k}`) })).filter((p) => p.url) as { kind: 'old' | 'new'; url: string }[];

/** a generated article: sections of paragraphs, a display now and then; the same text for both pages */
export function article(blocks: number): string {
  const words = 'flips separate vertices by increasing the distances between them and they underlie flip width and merge width in sparse graphs'.split(' ');
  const para = (k: number) => Array.from({ length: 60 }, (_, i) => words[(i * 7 + k) % words.length]).join(' ') + ` $x_{${k}} + y^2$.`;
  const body: string[] = [];
  for (let k = 0; body.length < blocks; k++) {
    if (k % 8 === 0) body.push(`\\section{Section ${k / 8 + 1}}\\label{sec:${k}}`);
    else if (k % 8 === 5) body.push(`\\begin{equation}\\label{eq:${k}}\n  \\sum_{i=1}^{n} a_i^{${k}} \\leq \\prod_{j} b_j\n\\end{equation}`);
    else body.push(para(k));
  }
  return `\\documentclass{article}\n\\usepackage{amsmath}\n\\title{Responsiveness probe}\n\\author{Probe}\n\\begin{document}\n\\maketitle\n\n${body.join('\n\n')}\n\n\\end{document}\n`;
}

interface Row { action: string; cpu: number; longest: number; input: number; wall: number; n: number }

/** the page's controls: the old page's ids against the workbench's */
const UI = {
  old: { hideSide: '#btn-sidebar-close', showSide: '#btn-sidebar', tab: (n: string) => `.sidebar button:text-is("${n}")`, split: '#btn-split', sep: '.split-divider' },
  new: { hideSide: '.wb-side-hide', showSide: '.wb-side-toggle', tab: (n: string) => `#side-${n.toLowerCase()}-tab`, split: null, sep: '.wb-groups .wb-sep' },
};

async function measurePage(kind: 'old' | 'new', base: string): Promise<Row[]> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.setDefaultTimeout(Number(arg("--timeout", "120000")));
  const q = BACKEND === 'engine' ? '?engine&store=memory' : '?seed=sample&backend=none&store=memory';
  await page.goto(`${base}${q}#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && (window as any).editorAPI.io);
  // two documents, the same text: the probe's and its copy (the document switch)
  const ids: string[] = await page.evaluate(async (tex: string) => {
    const E = (window as any).editorAPI, out: string[] = [];
    for (const name of ['probe.tex', 'probe-2.tex']) out.push(await E.store().createDoc(await E.io().importFile({ name, bytes: new TextEncoder().encode(tex) })));
    return out;
  }, article(BLOCKS));
  // at rest: the editor idle, no animation or transition running (a column's slide), then two frames
  const idle = () => page.evaluate(async () => {
    await (window as any).editorAPI.whenIdle();
    for (let k = 0; k < 3; k++) await Promise.all(document.getAnimations().filter((x) => x.playState === 'running' && x.effect?.getTiming().iterations !== Infinity).map((x) => x.finished.catch(() => {})));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const openDoc = async (id: string) => { await page.evaluate((d: string) => (window as any).editorAPI.open(d), id); await page.waitForSelector('.blk[data-kind=paragraph]'); await idle(); };
  await openDoc(ids[0]!);
  const ui = UI[kind];
  const rows: Row[] = [];
  /** reps of (prepare, act): act traced from its input to rest */
  async function action(name: string, act: () => Promise<unknown>, prepare: () => Promise<unknown> = async () => {}, types = ['click', 'mousedown', 'pointerdown', 'keydown', 'mousemove']) {
    if (ONLY && !ONLY.test(name)) return;
    const runs: Omit<Row, 'action' | 'n'>[] = [];
    for (let r = 0; r < REPS; r++) {
      await prepare(); await idle();
      const t0 = Date.now();
      const w = await traceWork(page, async () => { await act(); await idle(); });
      runs.push({ cpu: w.cpu, longest: Math.max(0, ...w.tasks.map((t) => t.cpu)), input: w.event(...types), wall: Date.now() - t0 });
    }
    const m = (k: keyof (typeof runs)[0]) => Math.round(median(runs.map((x) => x[k])) * 10) / 10;
    rows.push({ action: name, cpu: m('cpu'), longest: m('longest'), input: m('input'), wall: m('wall'), n: runs.length });
    console.log(`  ${kind} ${name}: cpu ${m('cpu')} ms, longest task ${m('longest')} ms, input ${m('input')} ms, wall ${m('wall')} ms`);
  }
  // the old sidebar's hide button shows on hover: the pointer goes there first, as a person's would
  const reveal = async (sel: string) => { if (kind === 'old' && sel === ui.hideSide && await page.isVisible('.sidebar')) await page.hover('.sidebar'); };
  const shown = async (sel: string) => { await reveal(sel); await page.waitForSelector(sel, { state: 'visible' }); };
  const isShown = async (sel: string) => { await reveal(sel); return page.isVisible(sel); };
  // ── the side column ──
  // the left column's state: the workbench's (its show button stays in the bar, under the icon, while open); the old
  // page's show button exists only while the sidebar is closed
  const sideClosed = () => (kind === 'new' ? page.evaluate(() => !!(window as any).editorAPI.workbench().sides.peek().left.collapsed) : page.isVisible(ui.showSide));
  const sideOpen = async () => { if (await sideClosed()) { await page.click(ui.showSide); await idle(); } await shown(ui.hideSide); };
  const sideShut = async () => { if (!(await sideClosed())) { await reveal(ui.hideSide); await page.click(ui.hideSide); await idle(); } };
  await action('side panel: close', () => page.click(ui.hideSide), sideOpen);
  await action('side panel: open', () => page.click(ui.showSide), sideShut);
  await sideOpen();
  let flip = false;
  await action('side panel: switch (Outline ↔ Problems)', () => { flip = !flip; return page.click(ui.tab(flip ? 'Problems' : 'Outline')); });
  await page.click(ui.tab('Outline')); await idle();
  // ── a block's popover and the first keystroke ──
  let k = 0;
  const blockAt = async () => {
    const r = await page.evaluate((n: number) => {
      const ps = [...document.querySelectorAll('[data-part="page"] .blk[data-kind=paragraph], #page .blk[data-kind=paragraph]')].filter((b) => { const x = b.getBoundingClientRect(); return x.top > 120 && x.bottom < innerHeight - 40; });
      const b = ps[n % ps.length]!.querySelector('.blk-main') ?? ps[n % ps.length]!;
      const x = b.getBoundingClientRect();
      return { x: x.left + 60, y: x.top + 12 };
    }, k++);
    return r;
  };
  const leave = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.blk.editing')); };
  let at = { x: 0, y: 0 };
  await action('a block\'s popover: open (click)', async () => { await page.mouse.click(at.x, at.y); await page.waitForSelector('.blk.editing .cm-editor, .rtx-vp .cm-editor'); },
    async () => { if (await page.$('.blk.editing')) await leave(); at = await blockAt(); });
  await action('the first keystroke in a block', async () => { await page.keyboard.type('x'); },
    async () => { if (await page.$('.blk.editing')) await leave(); at = await blockAt(); await page.mouse.click(at.x, at.y); await page.waitForFunction(() => document.activeElement?.closest('.cm-editor')); await idle(); }, ['keydown', 'keypress', 'textInput', 'input', 'beforeinput']);
  if (await page.$('.blk.editing')) await leave();
  // ── documents: the other document (old: the route; new: its tab) ──
  if (kind === 'new') {
    await page.evaluate((d: string) => (window as any).editorAPI.open(d), ids[1]!); await idle();
    let i = 0;
    await action('document: switch (a tab)', async () => { i++; const r = await page.evaluate((n: number) => { const t = document.querySelectorAll('.wb-strip .wb-tab-tab')[n]!.getBoundingClientRect(); return { x: t.left + t.width / 2, y: t.top + t.height / 2 }; }, i % 2); await page.mouse.click(r.x, r.y); /* where a person clicks: the tab label */ await page.waitForFunction((n: number) => (window as any).editorAPI.route().id === n, ids[i % 2]); });
  } else {
    let i = 0;
    await action('document: switch (the route)', async () => { i++; await page.evaluate((d: string) => (window as any).editorAPI.open(d), ids[i % 2]!); await page.waitForSelector('.blk[data-kind=paragraph]'); });
  }
  await openDoc(ids[0]!);
  // ── split view ──
  const splitOff = async () => {
    if (kind === 'old') { if (await page.$('#editor-view.split')) await page.click(ui.split!); }
    else await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); const g = wb.layout.peek(); const all: string[] = []; const walk = (n: any) => { if (n.kind === 'split') n.children.forEach(walk); else all.push(...n.tabs.map((t: any) => t.id)); }; walk(g.root); for (const t of all.slice(1)) wb.close(t); });
    await idle();
  };
  // split on: until the second pane shows blocks (old: #page-b; the workbench: a second document pane)
  const splitOn = async () => {
    if (kind === 'old') await page.click(ui.split!);   // (the workbench page has no split button: its command)
    else await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    if (kind === 'old') await page.waitForSelector('#page-b .blk');
    else await page.waitForFunction(() => [...document.querySelectorAll('main.rtx-pane')].filter((m) => m.querySelector('.blk')).length > 1);
  };
  await action('split view: on', splitOn, splitOff);
  await action('split view: off', splitOff, async () => { await splitOff(); await splitOn(); await idle(); });
  // the splitter dragged 300 px and back, one pointer step a frame
  await splitOff(); await splitOn(); await idle();
  await action('split view: drag the splitter', async () => {
    const r = await page.evaluate((s: string) => { const e = document.querySelector(s)!.getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + Math.min(300, e.height / 2) }; }, ui.sep);
    await page.mouse.move(r.x, r.y); await page.mouse.down();
    for (let s = 1; s <= 30; s++) { await page.mouse.move(r.x - s * 10, r.y); await page.evaluate(() => new Promise(requestAnimationFrame)); }
    for (let s = 29; s >= 0; s--) { await page.mouse.move(r.x - s * 10, r.y); await page.evaluate(() => new Promise(requestAnimationFrame)); }
    await page.mouse.up();
  });
  await splitOff();
  writeFileSync(join(OUT, `${kind}.json`), JSON.stringify({ date: new Date().toISOString(), base, backend: BACKEND, blocks: BLOCKS, reps: REPS, rows, errors }, null, 2));
  if (errors.length) console.log(`  ${kind}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all: Record<string, Row[]> = {};
  for (const p of PAGES) { console.log(`${p.kind}: ${p.url}`); all[p.kind] = await measurePage(p.kind, p.url); }
  const names = [...new Set(Object.values(all).flat().map((r) => r.action.replace(/ \((a tab|the route)\)$/, '')))];
  const get = (k: string, a: string) => all[k]?.find((r) => r.action.replace(/ \((a tab|the route)\)$/, '') === a);
  const f = (r?: Row) => (r ? `${r.cpu} / ${r.longest} / ${r.input} / ${r.wall}` : '—');
  console.log(`\n| action (CPU total / longest task / input dispatch / wall, ms; median of ${REPS}) | old | new |\n|---|---|---|`);
  for (const a of names) console.log(`| ${a} | ${f(get('old', a))} | ${f(get('new', a))} |`);
}
