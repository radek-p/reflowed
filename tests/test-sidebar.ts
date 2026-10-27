// The side column on the workbench (was the editor's own sidebar): the brand in the window bar, the left column's
// hide button and Ctrl/⌘B, its panel tabs Outline / Problems / TODOs / Refs with their counts, the word count in its
// status line, the page's "+ Add a block", and what the viewer logs (simulated records) in the Problems panel and
// never as a notice on the page: in headless Chromium on the dev app (the engine). Waits on DOM state and the app's idle.
//
//   node tests/test-sidebar.ts [http://localhost:8175/]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'sidebar');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8175/';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
const URL0 = `${BASE}?seed=sample&engine#/doc/sample`;   // (a reload keeps the document: the URL names it by its id, a memory store would not have it)
await page.goto(URL0);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
const api = (fn: string, ...a: any[]) => page.evaluate(([f, args]: [string, any[]]) => (window as any).editorAPI[f](...args), [fn, a] as [string, any[]]);
const tabs = () => page.evaluate(() => [...document.querySelectorAll('[data-side="left"] .wb-ptabs [role="tab"]')].map((b: any) => ({ panel: b.dataset.ptab, text: b.querySelector('.wb-ptab-label')?.textContent?.trim() ?? '', selected: b.getAttribute('aria-selected'),
  on: b.getAttribute('aria-selected') === 'true', count: b.querySelector('.wb-ptab-badge')?.textContent ?? '' })));
const shownPanel = () => page.evaluate(() => [...document.querySelectorAll('[data-side="left"] [data-panel-view]')].filter((p: any) => !p.closest('.wb-panel--hidden') && getComputedStyle(p).visibility !== 'hidden').map((p: any) => `panel-${p.dataset.panelView}`));
const leftOpen = () => page.evaluate(() => !(window as any).editorAPI.workbench().sides.peek().left.collapsed);

// ── the brand (the window bar's) and the left column's hide button, Ctrl/⌘B ──────────────────────────────────────
{
  const top = await page.evaluate(() => {
    const menu = document.querySelector('.wb-bar #btn-main-menu'), c = document.querySelector('[data-side="left"] .wb-side-hide') as HTMLElement | null;
    return { brand: !menu?.querySelector('.rtx-wb-brand'), logo: !!menu?.querySelector('.rtx-wb-logo svg'),
      close: c && { label: c.getAttribute('aria-label'), title: c.title, tag: c.tagName, h: c.getBoundingClientRect().height } };
  });
  check('brand: the app icon in the window bar (the main menu\'s button), no word', top.brand && top.logo, top);
  check('hide: a labelled button with its shortcut, 20–32 px (a kit control)', !!top.close && top.close.tag === 'BUTTON' && /Hide left/.test(top.close.label ?? '') && /Ctrl\+B|⌘B/.test(top.close.title) && top.close.h >= 20 && top.close.h <= 33, top.close);
  await page.click('[data-side="left"] .wb-side-hide');
  await page.waitForFunction(() => (window as any).editorAPI.workbench().sides.peek().left.collapsed);
  check('hide hides the left column', true);
  await page.click('.wb-side-toggle--left');
  await page.waitForFunction(() => !(window as any).editorAPI.workbench().sides.peek().left.collapsed);
  await page.locator('[data-side="left"] .wb-ptab').first().focus();   // (the focus outside a LaTeX field: Ctrl/⌘B is the sidebar's)
  await page.keyboard.press('ControlOrMeta+b');
  await page.waitForFunction(() => (window as any).editorAPI.workbench().sides.peek().left.collapsed);
  await page.keyboard.press('ControlOrMeta+b');
  await page.waitForFunction(() => !(window as any).editorAPI.workbench().sides.peek().left.collapsed);
  check('Ctrl/⌘B outside a LaTeX field toggles it', await leftOpen());
}
// ── the tabs ─────────────────────────────────────────────────────────────────
{
  const t = await tabs();
  check('tabs: Outline, Problems, TODOs, Refs, one selected', ['outline', 'problems', 'todos', 'references'].every((p, i) => t[i]?.panel === p) && t.filter((x) => x.selected === 'true').length === 1
    && (await page.evaluate(() => document.querySelector('[data-side="left"] .wb-ptabs')?.getAttribute('role'))) === 'tablist', t);
  // the panel tabs share the strip evenly (1/n) while each gets its minimum (its label, else as an icon the kit's
  // icon-button box), else they keep the minimum and the strip scrolls; icons named by their labels, the label a tooltip
  const fits = () => page.evaluate(() => [...document.querySelectorAll('[data-side="left"] .wb-ptabs')].map((e: any) => {
    const ts = [...e.querySelectorAll('[role="tab"]')] as HTMLElement[], ws = ts.map((t) => t.getBoundingClientRect().width);
    const btn = parseFloat(getComputedStyle(e).getPropertyValue('--wb-btn-h')) || 32;
    return { compact: e.hasAttribute('data-compact'), scrolls: e.scrollWidth > e.clientWidth + 1, even: Math.max(...ws) - Math.min(...ws) <= 1, min: Math.min(...ws), btn,
      names: ts.map((t) => `${t.getAttribute('aria-label')}|${t.title}`) };
  }));
  const at = async (w: number) => {
    await page.evaluate((x: number) => (window as any).editorAPI.workbench().resizeSide('left', x), w);
    await page.waitForFunction((x: number) => Math.abs((document.querySelector('[data-side="left"]') as HTMLElement).getBoundingClientRect().width - x) < 2, w);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return (await fits())[0]!;
  };
  const roomy = await at(520), mid = await at(256), tight = await at(170);
  await at(256);
  check('tabs: an even split with labels when they fit (520 px); as icons at the kit\'s button box when not (256 px), still even; at 170 px the icon box kept and the strip scrolls',
    !roomy.compact && roomy.even && !roomy.scrolls && mid.compact && mid.even && mid.min >= mid.btn - 0.5 && !mid.scrolls && tight.compact && tight.min >= tight.btn - 0.5 && tight.scrolls
    && tight.names.join() === 'Outline|Outline,Problems|Problems,TODOs|TODOs,Refs|Refs', { roomy, mid, tight });
  const todos = (await api('todos')).length;
  check('the TODOs tab counts the notes', t.find((x) => x.panel === 'todos')?.count === String(todos) && todos > 0, { t, todos });
  for (const p of ['problems', 'todos', 'outline']) {
    await page.click(`[data-side="left"] [data-ptab="${p}"]`);
    await idle();
    const now = await tabs();
    const sel = now.find((x) => x.panel === p);
    check(`tab ${p}: selected, its panel shown, the others hidden`, sel?.selected === 'true' && sel.on && now.filter((x) => x.selected === 'true').length === 1 && (await shownPanel()).join() === `panel-${p}`, { now, shown: await shownPanel() });
  }
  await page.click('[data-side="left"] [data-ptab="todos"]');
  await idle();
  await page.reload();
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await idle();
  check('the chosen tab is remembered across a reload', (await shownPanel()).join() === 'panel-todos');
  // (a badge of 3, an empty list) the badge and the list are one source: the same count, in the
  // panel shown first, after a reload, in another tab of another document and back, and with a panel in each column
  const agree = (p: string, row: string) => page.evaluate(([pp, r]: string[]) => ({ badge: Number(document.querySelector(`[data-ptab="${pp}"] .wb-ptab-badge`)?.textContent ?? 0),
    rows: document.querySelectorAll(`[data-panel-view="${pp}"] ${r}`).length }), [p, row]);
  const todoRows = '.td-row';
  const a1 = await agree('todos', todoRows);
  const other = await page.evaluate(async () => { const E = (window as any).editorAPI; const id = await E.store().createDoc({ title: 'Two notes', preamble: '\\documentclass{article}\n\\usepackage{todonotes}', blocks: [{ kind: 'paragraph', source: 'One \\todo{first}.' }, { kind: 'paragraph', source: 'Two \\todo{second} \\todo{third}.' }] }); return id; });
  const firstTab = await page.evaluate(() => (window as any).editorAPI.workbench().current.peek().tab.id);
  await page.evaluate((id: string) => { location.hash = `#/doc/${id}`; }, other);
  await page.waitForFunction((id: string) => (window as any).editorAPI.currentDoc()?.id === id, other);
  await idle();
  const a2 = await agree('todos', todoRows);
  await page.evaluate((t: string) => { const E = (window as any).editorAPI; E.workbench().activate(t); E.tabs().focus(t); }, firstTab);
  await idle();
  const a3 = await agree('todos', todoRows);
  // the Problems panel moved to the right column, both shown at once
  await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); wb.movePanel('problems', 'right'); wb.collapseSide('right', false); wb.showPanel('problems'); await E.whenIdle(); });
  const a4 = { todos: await agree('todos', todoRows), problems: await agree('problems', '.pb-row:not([data-kind="unused-label"])') };   // (the badge counts the problems; unused labels are listed apart)
  await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); wb.movePanel('problems', 'left'); wb.showPanel('todos'); await E.whenIdle(); });
  check('TODOs: the badge and the list agree (after a reload, another document, back, Problems shown beside them)',
    [a1, a2, a3, a4.todos].every((x) => x.badge === x.rows) && a1.rows > 0 && a2.rows === 3 && a3.rows === a1.rows && a4.problems.badge === a4.problems.rows, { a1, a2, a3, a4 });
  await page.click('[data-side="left"] [data-ptab="outline"]');
  // a problem: the Problems tab counts it
  const id = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => b.kind === 'paragraph').id);
  const src = await page.evaluate((i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i).source, id);
  await api('setSource', id, `${src} \\undefinedxyz`);
  await idle();
  const tp = (await tabs()).find((x) => x.panel === 'problems');
  const hasErr = await page.evaluate(() => document.querySelector('[data-ptab="problems"] .wb-ptab-badge')?.getAttribute('data-tone') === 'danger');
  check('an error: the Problems tab counts it, marked as errors', Number(tp?.count) > 0 && hasErr, { tp, hasErr });
  await api('setSource', id, src);
  await idle();
}
// ── a panel's content is inset from its body's top as the old sidebar's was (8 px below its tabs):
//    the first painted row of each panel, in a single and a stacked column (Problems in a group of its own), in each theme ──
{
  const gap = () => page.evaluate(() => [...document.querySelectorAll('[data-side="left"] .wb-side-pane')].map((g) => {
    const body = g.querySelector('.wb-side-body')!.getBoundingClientRect();
    const panel = [...g.querySelectorAll('[data-panel-view]')].find((p) => !p.closest('.wb-panel--hidden')) as HTMLElement | undefined;
    if (!panel) return null;
    // the first element with painted content (text or an icon)
    const first = [...panel.querySelectorAll('*')].find((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0 && [...e.childNodes].some((n) => (n.nodeType === 3 && n.textContent!.trim()) || (n as Element).tagName === 'svg'); });
    return { panel: panel.dataset.panelView, gap: first ? Math.round(first.getBoundingClientRect().top - body.top) : null };
  }).filter(Boolean));
  const out: any[] = [];
  for (const theme of ['light', 'dark', 'sepia', 'contrast']) {
    await page.evaluate(async (t: string) => { const E = (window as any).editorAPI; E.view().set({ theme: t }); await E.whenIdle(); }, theme);
    for (const p of ['outline', 'problems', 'todos', 'references']) {
      await page.click(`[data-side="left"] [data-ptab="${p}"]`);
      await idle();
      out.push(...(await gap()).map((x: any) => ({ theme, ...x })));
    }
  }
  // stacked: Problems in a group below
  await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); const g = wb.sides.peek().left.root; wb.dropPanel('problems', { id: 'problems', side: 'left', group: g.kind === 'group' ? g.id : null, index: null, where: 'bottom' }); await E.whenIdle(); });
  const stacked = await gap();
  await page.evaluate(async () => { const E = (window as any).editorAPI; E.view().set({ theme: 'light' }); await E.whenIdle(); });
  const all = [...out, ...stacked];
  check('panels: the first row 8–18 px below the panel body\'s top (the old sidebar\'s inset), every panel and theme, stacked too', all.length >= 16 && stacked.length === 2 && all.every((x: any) => x.gap != null && x.gap >= 8 && x.gap <= 18), { bad: all.filter((x: any) => !(x.gap >= 8 && x.gap <= 18)), stacked });
}
// ── the word count ────────────────────────────────────────────────────────────
{
  const wc = await page.evaluate(() => { const f = document.getElementById('word-count')!; return { text: f.textContent, title: f.title, main: f.querySelector('.wc-main')?.textContent }; });
  const n = (await api('blocks')).length;
  check('word count: "N words · M blocks", the details in its tooltip', /^\d[\d,]* words · \d+ blocks$/.test(wc.text ?? '') && wc.text!.endsWith(`${n} blocks`) && /words of text/.test(wc.title) && /inline formulas/.test(wc.title) && /^\d[\d,]* words$/.test(wc.main ?? ''), wc);
  await api('insert', 1, 'paragraph', 'one two three four five');
  await idle();
  const wc2 = await page.evaluate(() => document.getElementById('word-count')!.textContent);
  check('... follows an edit', wc2!.endsWith(`${n + 1} blocks`) && parseInt(wc2!.replace(/,/g, '')) === parseInt(wc.text!.replace(/,/g, '')) + 5, { wc: wc.text, wc2 });
  await api('undo');
  await idle();
}
// ── + Add a block ─────────────────────────────────────────────────────────────
{
  const n = (await api('blocks')).length;
  const b = await page.evaluate(() => { const e = document.querySelector('[data-part="page"] .add-end'); return e && { text: e.textContent!.replace(/\s+/g, ' ').trim(), tag: e.tagName, inPage: !!e.closest('main.rtx-pane') }; });
  check('"+ Add a block": a button at the end of the page', !!b && b.tag === 'BUTTON' && /Add a block/.test(b.text) && b.inPage, b);
  await page.click('[data-part="page"] .add-end');
  const after = await api('blocks');
  const caret = await api('caret');
  check('... a click adds an empty paragraph at the end and opens it', after.length === n + 1 && after[after.length - 1].kind === 'paragraph' && caret?.id === after[after.length - 1].id, { n: after.length, caret });
  await api('leave');
  await idle();
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('[data-part="page"] .add-end')!).display === 'none');
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');
  check('... hidden in focus mode', hidden);
}
// ── light and dark ─────────────────────────────────────────────────────────────
{
  const measure = () => page.evaluate(() => {
    const cv = document.createElement('canvas').getContext('2d')!;
    const rgba = (c: string) => { const sr = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/); if (sr) return [+sr[1] * 255, +sr[2] * 255, +sr[3] * 255, sr[4] == null ? 1 : +sr[4]];
      cv.fillStyle = '#000'; cv.fillStyle = c; const v = cv.fillStyle as string; if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
      const m = v.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const over = (t: number[], u: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    const painted = (el: Element | null) => { const st: number[][] = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) st.push(c); if (c[3] >= 1) break; } let a = [255, 255, 255, 1]; for (const c of st.reverse()) a = over(c, a); return a; };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const of = (sel: string) => { const x = document.querySelector(sel); if (!x) return null; const op = Number(getComputedStyle(x).opacity); const fg = rgba(getComputedStyle(x).color); fg[3] *= op; const bg = painted(x); const f = over(fg, bg);
      const a = lum(f), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10; };
    return { tab: of('[data-side="left"] .wb-ptab[aria-selected="false"] .wb-ptab-label'), tabOn: of('[data-side="left"] .wb-ptab[aria-selected="true"] .wb-ptab-label'), foot: of('#word-count'), footMain: of('#word-count .wc-main'), add: of('[data-part="page"] .add-end') };
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await page.waitForFunction((t: string) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme);
    const m = await measure();
    await page.screenshot({ path: join(OUT, `01-${theme}.png`), clip: { x: 0, y: 0, width: 300, height: 900 } });
    check(`${theme}: tabs, word count and "Add a block" readable (4.5:1)`, Object.values(m).every((c) => c != null && c >= 4.5), m);
  }
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
}

// ── what the viewer logs (its page log, host.log): in the Problems panel, by block, and never on the page ──────────
// (doc/viewer-log.ts: warnings and errors; a block's records go with its result; the viewer's notice bar is off.)
// The records are simulated through host.log.report: a missing character in a block, a font that failed to load.
{
  await page.click('[data-side="left"] [data-ptab="problems"]');
  await idle();
  const target = await page.evaluate(() => {
    const E = (window as any).editorAPI, host = (window as any).reflowtex.host;
    const b = E.blocks().find((x: any) => x.kind === 'paragraph' && x.mounted && document.querySelector(`.blk[data-id="${x.id}"] .latex-block`));
    const view = host.block(document.querySelector(`.blk[data-id="${b.id}"] .latex-block`));
    host.log.report('warning', 'missing-char', 'There is no ł (U+0142) in font cmr10 (simulated)', { font: 'cmr10' }, { block: view.key });
    host.log.report('info', 'block-transformed', 'an info record (simulated)', {}, { block: view.key });
    host.log.report('error', 'font-load-failed', 'Some fonts could not be downloaded (cmr10) (simulated).', { fonts: 'cmr10' });
    return { id: b.id, source: b.source };
  });
  const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-panel-view="problems"] .pb-row[data-kind="preview"]')]
    .map((r: any) => ({ block: r.dataset.block, level: r.dataset.level, msg: r.querySelector('.pb-msg')?.textContent ?? '' })));
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-view="problems"] .pb-row[data-kind="preview"]').length >= 2);
  const got = await rows();
  const tone = await page.evaluate(() => document.querySelector('[data-ptab="problems"] .wb-ptab-badge')?.getAttribute('data-tone'));
  check('viewer log: a block\'s record in Problems with its block and level, the page\'s with none, no info record, the tab marked as errors',
    got.some((r) => r.block === target.id && r.level === 'warning' && /no ł/.test(r.msg)) && got.some((r) => r.block === '' && r.level === 'error' && /could not be downloaded/.test(r.msg))
    && !got.some((r) => /info record/.test(r.msg)) && tone === 'danger', { got, tone });
  check('viewer log: no notice of the viewer\'s on the page', !(await page.evaluate(() => !!document.querySelector('.latex-notice'))));
  await api('setSource', target.id, `${target.source} More.`);       // another result: the block's record goes with the old one
  await idle();
  await page.waitForFunction((id: string) => !document.querySelector(`[data-panel-view="problems"] .pb-row[data-kind="preview"][data-block="${id}"]`), target.id);
  check('viewer log: the block\'s record gone once it shows another result; the page\'s stays', (await rows()).some((r) => r.block === ''), await rows());
  await api('setSource', target.id, target.source);
  await idle();
}

check('no console errors or page errors', problems.filter((p) => !p.includes('(simulated)')).length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nsidebar: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
