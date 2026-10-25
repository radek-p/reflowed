// The editor's chrome, by user report, in headless Chromium on the dev app. Waits on DOM state, frames and the app's idle.
//  hovering or focusing a block's drag handle marks the block it moves (the selection's background, softer, in
//       light, dark and sepia); leave or blur removes it; a container marks all its paragraphs; both panes; no layout change.
//  the top bar does not change while the page scrolls: a 3 s wheel scroll through the long test document (the intro repeated) changes no class or
//       style in the bar, and nothing in it but the crumbs moves (its buttons keep their place: a save state beside the
//       section name used to follow it; the save state is now on the tab); the bar is its own compositor layer.
//
//   node tests/test-chrome.ts [http://localhost:8152/] [--only 133|132]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'chrome');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8152/').replace(/\/?$/, '/');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
async function open(path: string, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}${path}`);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && (window as any).editorAPI.route?.().name === 'doc');
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  return { ctx, page };
}
const frame = (page: any) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

// ── the handle marks its block ──────────────────────────────────────────
if (!ONLY || ONLY === '133') {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample');
  // the panes (workbench tabs, a pane's id is its tab's): A the document's first, B the split's
  const paneIds = (): Promise<string[]> => page.evaluate(() => Object.keys((window as any).editorAPI.editors()));
  const A = `main.rtx-pane[data-pane="${(await paneIds())[0]}"]`;
  /** the state of a pane's blocks: marked ones, each one's .blk-main background, and every block's rect (layout) */
  const state = (sel: string) => page.evaluate((s: string) => {
    const blks = [...document.querySelectorAll(`${s} .blocks > .blk`)] as HTMLElement[];
    const probe = document.createElement('div'); probe.style.background = 'var(--sel-soft)'; document.body.append(probe);
    const soft = getComputedStyle(probe).backgroundColor; probe.style.background = 'var(--sel)';
    const sel2 = getComputedStyle(probe).backgroundColor; probe.remove();
    return {
      soft, sel: sel2,
      marked: blks.filter((b) => b.classList.contains('handle-mark')).map((b) => b.dataset.id),
      bg: Object.fromEntries(blks.map((b) => [b.dataset.id, getComputedStyle(b.querySelector(':scope > .blk-main') ?? b).backgroundColor])),
      rects: blks.map((b) => { const r = b.getBoundingClientRect(); return `${r.x},${r.y},${r.width},${r.height}`; }).join(';'),
    };
  }, sel);
  const handleBox = (sel: string, id: string, scroll = true) => page.evaluate(([s, i, sc]: any[]) => {
    const b = document.querySelector(`${s} .blocks > .blk[data-id="${i}"]`)!;
    if (sc) b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect(), h = b.querySelector(':scope > .gutter .g-handle')!.getBoundingClientRect();
    return { bx: r.x + r.width / 2, by: r.y + Math.min(10, r.height / 2), hx: h.x + h.width / 2, hy: h.y + h.height / 2 };
  }, [sel, id, scroll]);
  const away = async () => { await page.mouse.move(5, 895); await frame(page); };
  // a container: a proof of three paragraphs, split (as test-panes makes one)
  const api = (fn: string, ...a: any[]) => page.evaluate(([f, args]: [string, any[]]) => (window as any).editorAPI[f](...args), [fn, a] as [string, any[]]);
  const n = (await api('blocks')).length;
  const pid = await api('insert', n - 2, 'proof', '\\begin{proof}\nThe first paragraph of the proof, long enough to wrap once or twice in a pane.\n\nThe second paragraph of the proof.\n\nThe last paragraph of the proof.\n\\end{proof}');
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  await api('nestSplit', pid);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  const ids = await page.evaluate((s: string) => {
    const blks = [...document.querySelectorAll(`${s} .blocks > .blk`)] as HTMLElement[];
    const plain = blks.find((b) => !b.classList.contains('nest-head') && !b.classList.contains('nest-child') && b.dataset.kind === 'paragraph')?.dataset.id;
    const head = blks.find((b) => b.classList.contains('nest-head'))?.dataset.id;
    return { plain, head };
  }, A);
  check('the sample has a plain paragraph and a container', !!ids.plain && !!ids.head, ids);

  async function plainCase(sel: string, label: string) {
    await away();
    const h = await handleBox(sel, ids.plain!);
    const before = await state(sel);
    await page.mouse.move(h.bx, h.by); await frame(page);
    await page.mouse.move(h.hx, h.hy); await frame(page);
    const on = await state(sel);
    check(`${label}: hovering the handle marks its block only, with --sel-soft`, on.marked.join() === ids.plain && on.bg[ids.plain!] === on.soft && on.soft !== on.sel && on.soft !== 'rgba(0, 0, 0, 0)',
      { marked: on.marked, bg: on.bg[ids.plain!], soft: on.soft });
    check(`${label}: no layout change`, on.rects === before.rects);
    await away();
    const off = await state(sel);
    check(`${label}: leaving the handle removes it`, off.marked.length === 0 && off.bg[ids.plain!] === 'rgba(0, 0, 0, 0)', { marked: off.marked, bg: off.bg[ids.plain!] });
    await page.evaluate(([s, i]: string[]) => (document.querySelector(`${s} .blocks > .blk[data-id="${i}"] > .gutter .g-handle`) as HTMLElement).focus(), [sel, ids.plain!]);
    const f = await state(sel);
    check(`${label}: focusing the handle marks its block`, f.marked.join() === ids.plain && f.bg[ids.plain!] === f.soft, f.marked);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    check(`${label}: blur removes it`, (await state(sel)).marked.length === 0);
  }
  async function containerCase(sel: string, other: string | null, label: string) {
    await away();
    const kids = await page.evaluate(([s, i]: string[]) => [...document.querySelectorAll(`${s} .blocks > .blk.nest-child[data-parent="${i}"]`)].map((b: any) => b.dataset.id), [sel, ids.head!]);
    const k = await handleBox(sel, kids[0]), h = await handleBox(sel, ids.head!, false);
    await page.mouse.move(k.bx, k.by); await frame(page);     // over its first paragraph first: the container's handle shows
    await page.mouse.move(h.hx, h.hy); await frame(page);
    const on = await state(sel);
    check(`${label}: a container's handle marks all its paragraphs`, kids.length >= 2 && on.marked.join() === kids.join() && kids.every((k: string) => on.bg[k] === on.soft), { kids, marked: on.marked });
    if (other) check(`${label}: only in the pane of the handle`, (await state(other)).marked.length === 0);
    await away();
    check(`${label}: leaving removes it`, (await state(sel)).marked.length === 0);
  }
  await plainCase(A, 'one pane');
  await containerCase(A, null, 'one pane');
  // the themes: the mark follows the theme's selection colour, softer
  const themed: Record<string, any> = {};
  for (const t of ['dark', 'sepia', '']) {
    await page.evaluate(async (c: string) => { const E = (window as any).editorAPI; E.view().set({ theme: c || 'light' }); await E.whenIdle(); }, t);   // the JSON themes (design/theme.ts)
    const h = await handleBox(A, ids.plain!);
    await page.mouse.move(h.bx, h.by); await page.mouse.move(h.hx, h.hy); await frame(page);
    const s = await state(A);
    themed[t || 'light'] = { bg: s.bg[ids.plain!], soft: s.soft, sel: s.sel };
    await away();
  }
  const alpha = (c: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(c)?.[1] ?? 1);
  check('light, dark, sepia: the mark is the theme\'s --sel-soft, more transparent than --sel', Object.values(themed).every((v: any) => v.bg === v.soft && alpha(v.soft) < alpha(v.sel) && alpha(v.soft) > 0)
    && new Set(Object.values(themed).map((v: any) => v.soft)).size === 3, themed);
  // the second pane
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await page.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2);
  const B = `main.rtx-pane[data-pane="${(await paneIds()).find((p) => !A.includes(p))}"]`;
  await page.waitForSelector(`${B} .blocks > .blk .blk-render > .latex-block`);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  await plainCase(B, 'second pane');
  await containerCase(B, A, 'second pane');
  await ctx.close();
}

// ── the top bar holds still while the page scrolls ──────────────────────
if (!ONLY || ONLY === '132') {
  const { ctx, page } = await open('?engine&store=memory&seed=long#/doc/long', { width: 1280, height: 800 });
  const cdp = await ctx.newCDPSession(page);
  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.wb-bar' });
  const { node } = await cdp.send('DOM.describeNode', { nodeId });
  let layers: any[] = [];
  cdp.on('LayerTree.layerTreeDidChange', (e: any) => { if (e.layers) layers = e.layers; });
  await cdp.send('LayerTree.enable');
  await page.evaluate(() => {
    const w = window as any, bar = document.querySelector('.wb-bar')!;
    w.__styleChanges = []; w.__places = {}; w.__sections = new Set();
    // class and style on the bar and everything in it but the tabs (their section name follows the page, by design)
    new MutationObserver((l) => l.forEach((m) => { if (!(m.target as Element).closest('.wb-tab, .wb-strip')) w.__styleChanges.push(`${(m.target as Element).id || (m.target as Element).className} ${m.attributeName}`); }))
      .observe(bar, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    const watch = () => {
      for (const e of bar.querySelectorAll('#btn-view, #btn-doc-menu')) {
        const r = e.getBoundingClientRect(); (w.__places[e.id || e.className] ??= new Set()).add(`${Math.round(r.left)},${Math.round(r.top)}`);
      }
      w.__sections.add(bar.querySelector('.wb-tab--on .wb-tab-sec')?.textContent ?? '');
      if (!w.__stop) requestAnimationFrame(watch);
    };
    watch();
  });
  await page.mouse.move(640, 500);
  const t0 = Date.now();
  let steps = 0;
  while (Date.now() - t0 < 3000) { await page.mouse.wheel(0, 120); await frame(page); steps++; }
  const r = await page.evaluate(() => { const w = window as any; w.__stop = true;
    return { changes: w.__styleChanges, places: Object.fromEntries(Object.entries(w.__places).map(([k, v]: any) => [k, [...v]])), sections: [...w.__sections], y: scrollY }; });
  check('the scroll passed several sections (the crumbs changed)', r.sections.length >= 3, { steps, sections: r.sections });
  check('no class or style change in the top bar during the scroll (beyond the first)', r.changes.length <= 1, r.changes);
  // (the bar has no save state: it is on the tab, tests/test-mobile-chrome.ts; the bar's own places are its two buttons)
  check('the buttons keep their place', Object.values(r.places).every((v: any) => v.length === 1) && ['btn-view', 'btn-doc-menu'].every((k) => k in r.places), r.places);
  const bar = layers.filter((l) => l.backendNodeId === node.backendNodeId);
  check('the top bar is its own compositor layer', bar.length === 1, { layers: layers.length, bar: bar.length });
  await ctx.close();
}

await browser.close();
check('no page errors', problems.length === 0, problems);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
