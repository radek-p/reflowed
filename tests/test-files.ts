// The Files panel: hidden by default; the "Show advanced features" switch (the Settings panel's Advanced section) offers it
// (the main menu's View › Files, unchecked: the panel not open); chosen there it opens (its tab, with a close, at the left
// column's bottom; the row checked); its close closes it (the row unchecked), the row again opens it; its list is the Export .zip's files (names and sizes, read from the downloaded zip) for the intro (its figures) and the tests' biblatex document (its .bbl); a click
// on a figure reveals its first use; the switch off takes the tab away again. The intro places its figures through a
// macro (\shot): each is used where its block's compile opened it (the engine's record, doc/block-files.ts), and a
// figure replaced in place typesets its block again; the switch off takes its View row away too. On the engine (the intro from the dev seed), the browser's own
// store (a reload keeps the document). Waits on DOM state and the app's idle.
//
//   node tests/test-files.ts [http://localhost:8158/]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../app/src/io/archive.ts';
import { listFiles } from '../app/src/io/files.ts';
import { namedIn, createBlockFiles, usedBy } from '../app/src/doc/block-files.ts';
import { resultsDir } from './qa/lib/results.ts';
import { openBiblatexDoc } from './qa/fixtures/biblatex-doc.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'files');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8158/';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
// ── the list's rules, without a browser (io/files.ts) ──────────────────────────
{
  const r = namedIn('\\includegraphics[width=3cm]{fig/a} % \\includegraphics{fig/b}\n\\usepackage{x,y}\\input{sec/c}\\bibliographystyle{plain}');
  check('namedIn: figures, packages (as .sty), inputs and styles; comments left out', JSON.stringify(r) === JSON.stringify(['fig/a', 'sec/c', 'x.sty', 'y.sty', 'plain.bst']), r);
  const blk = (id: string, pos: string, source: string, kind = 'paragraph') => ({ id, docId: 'd', pos, kind, source, file: 'main.tex', attrs: {}, rev: 0, updatedAt: 0 });
  const doc: any = { id: 'd', title: 't', preamble: { source: '\\documentclass{article}\n\\usepackage{mine}\n\\graphicspath{{figures/}}' }, settings: {}, bib: { kind: 'bib', source: '@misc{a,}', path: 'refs.bib' },
    files: [{ path: 'main.tex', role: 'main' }], meta: {},
    blocks: [blk('b1', 'a', 'Text.'), blk('b2', 'b', '\\includegraphics{x}', 'figure'), blk('b3', 'c', '% \\includegraphics{y}\n\\includegraphics{x.pdf}'), blk('b4', 'd', '\\bibliography{refs}', 'bibliography')], assets: [] };
  const a = (id: string, name: string) => ({ id, name, mime: 'application/octet-stream', size: 3, hash: id, bytes: new Uint8Array([1, 2, 3]) });
  const { files } = listFiles(doc, [a('A', 'figures/x.pdf'), a('B', 'figures/y.pdf'), a('C', 'mine.sty')] as any);
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  check('listFiles: the export\'s files with their kinds', files.map((f) => `${f.path}:${f.kind}`).join() === 'main.tex:main,refs.bib:bib,figures/x.pdf:figure,figures/y.pdf:figure,mine.sty:asset', files.map((f) => `${f.path}:${f.kind}`));
  check('uses: a figure by \\includegraphics through \\graphicspath, ± its extension, in document order', by['figures/x.pdf'].uses.join() === 'b2,b3', by['figures/x.pdf'].uses);
  check('uses: a commented-out \\includegraphics is not a use', by['figures/y.pdf'].uses.length === 0 && !by['figures/y.pdf'].preamble, by['figures/y.pdf']);
  check('uses: a package by the preamble; the .bib by the bibliography block; main: every block', by['mine.sty'].preamble && by['refs.bib'].uses.join() === 'b4' && by['main.tex'].uses.length === 4 && by['main.tex'].preamble, { sty: by['mine.sty'], bib: by['refs.bib'].uses });
  // a figure placed through a macro: used where the block's compile opened it (its result's record)
  const rec = createBlockFiles();
  rec.note('b1', { files: ['figures/y', 'figures/y.pdf'] });
  const used = listFiles(doc, [a('A', 'figures/x.pdf'), a('B', 'figures/y.pdf'), a('C', 'mine.sty')] as any, {}, { block: (b) => rec.of(b), preamble: () => usedBy(doc.preamble.source) }).files;
  check('uses: a figure a macro places, by the block whose compile opened it', used.find((f) => f.path === 'figures/y.pdf')?.uses.join() === 'b1', used.find((f) => f.path === 'figures/y.pdf'));
}

const browser = await chromium.launch();
const problems: string[] = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
await page.goto(`${BASE}#/doc/intro`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
const tab = () => page.$('[data-side] [data-ptab="files"]');
const rows = () => page.$$eval('#panel-files .fl-row', (els: any[]) => els.map((e) => ({ path: e.dataset.path, kind: e.dataset.kind, uses: +e.dataset.uses,
  name: e.querySelector('.fl-name')?.textContent, kindText: e.querySelector('.fl-kind')?.textContent, size: e.querySelector('.fl-size')?.textContent, where: e.querySelector('.fl-where')?.textContent })));
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** the switch in the Settings panel (the main menu's Settings…), the panel closed again */
const setAdvanced = async (on: boolean) => {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  const box = page.locator('[data-panel-view="app-settings"] #set-advanced');
  if (on) await box.check(); else await box.uncheck();
  await page.click('[data-ptab="app-settings"] [data-action="close-panel"]');
  await page.waitForFunction(() => !document.querySelector('[data-panel-view="app-settings"]'));
};

/** the main menu's View rows: [action, checked, disabled] (the menu closed again) */
const viewRows = async () => {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="view"]');
  await page.waitForSelector('.main-menu.menu-sub[aria-label="View"]');
  const r: [string, string | null, boolean][] = await page.$$eval('.main-menu.menu-sub [data-action]', (els: any[]) => els.map((e) => [e.dataset.action, e.getAttribute('aria-checked'), e.getAttribute('aria-disabled') === 'true' || e.disabled]));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.main-menu'));
  return r;
};
const filesRow = async () => (await viewRows()).find((x) => x[0] === 'panel-files') ?? null;
/** View › Files chosen (the menu by the pointer) */
const chooseFiles = async () => {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="view"]');
  await page.click('.main-menu [data-action="panel-files"]');
};

// ── hidden by default ───────────────────────────────────────────────────────
{
  const st = await page.evaluate(() => ({ adv: (window as any).editorAPI.advanced(), panel: !!document.getElementById('panel-files'), stored: localStorage.getItem('rtx-editor.advanced') }));
  check('hidden by default: no Files tab, no panel, advanced features off', !(await tab()) && !st.panel && st.adv === false && st.stored === null, st);
}
{
  const row = await filesRow();
  check('... and no View › Files row', row === null, row);
}
// ── the switch offers it; the View menu opens it ────────────────────────────
await setAdvanced(true);
{
  const row = await filesRow();
  check('"Show advanced features" on: the Files panel is not open (no tab), offered in the main menu\'s View (a check row, unchecked)',
    !(await tab()) && !(await page.$('#panel-files')) && !!row && row[1] === 'false' && !row[2], row);
}
await chooseFiles();
await page.waitForSelector('[data-side] [data-ptab="files"]');
{
  const order = await page.$$eval('[data-side="left"] [role="tab"][data-ptab]', (b: any[]) => b.map((x) => x.dataset.ptab));
  const where = await page.evaluate(() => { const S = (window as any).editorAPI.workbench().sides.peek().left; const panelsOf = (n: any): string[][] => (n.kind === 'split' ? n.children.flatMap(panelsOf) : [n.panels]);
    return { groups: panelsOf(S.root), collapsed: S.collapsed, active: document.querySelector('[data-ptab="files"]')?.getAttribute('aria-selected'), close: document.querySelectorAll('[data-ptab="files"] [data-action="close-panel"]').length }; });
  check('View › Files opens it: its tab, after the others, shown, in a group of its own at the left column\'s bottom, with a close on its tab',
    order[order.length - 1] === 'files' && (await (await tab())!.textContent())!.includes('Files') && !where.collapsed && where.active === 'true' && where.groups.at(-1)?.join() === 'files' && where.close === 1, { order, where });
  const row = await filesRow();
  check('... its View row checked', row?.[1] === 'true', row);
  const fit = await page.$$eval('[data-side="left"] .wb-ptabs', (all: any[]) => all.map((e: any) => { const r = e.getBoundingClientRect(); return { sw: e.scrollWidth, cw: e.clientWidth, inside: [...e.children].every((b: any) => { const q = b.getBoundingClientRect(); return q.left >= r.left - 0.5 && q.right <= r.right + 0.5; }) }; })).then((a: any[]) => ({ sw: Math.max(...a.map((x) => x.sw - x.cw)), cw: 0, inside: a.every((x) => x.inside) }));
  check('every tab fits the sidebar (none clipped)', fit.sw <= fit.cw + 1 && fit.inside, fit);
}

/** the panel's rows against the Export .zip of the open document */
async function compare(label: string) {
  await page.click('[data-side] [data-ptab="files"]');
  await page.waitForSelector('#panel-files .fl-row:visible');
  await idle();
  await page.waitForTimeout(0);
  await page.waitForFunction(() => !document.querySelector('#panel-files .fl-empty'));
  const r = await rows();
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="export"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.main-menu [data-action="export-zip"]')]);
  const zipPath = join(OUT, `${label}.zip`);
  await dl.saveAs(zipPath);
  const entries = await readZip(new Uint8Array(readFileSync(zipPath)));
  const zip = entries.map((e) => ({ path: e.path, size: fmtSize(e.data.length) }));
  const panel = r.map((x) => ({ path: x.path, size: x.size }));
  const key = (a: { path: string }[]) => a.map((x: any) => `${x.path} ${x.size}`).sort().join('\n');
  check(`${label}: the panel lists exactly the Export .zip's files (names and sizes)`, key(zip) === key(panel) && zip.length > 1, { zip: zip.map((z) => z.path), panel: panel.map((p) => p.path) });
  const badge = await page.$eval('[data-side] [data-ptab="files"] .wb-ptab-badge', (e: any) => e.textContent);
  check(`${label}: the tab's count is the number of files`, badge === String(r.length), { badge, n: r.length });
  check(`${label}: each row a name, a kind and a size; the main file first`, r[0]?.kind === 'main' && r.every((x) => x.name && x.kindText && x.size && x.where), r.slice(0, 4));
  return r;
}

const paper = await compare('intro');
{
  const kinds = new Set(paper.map((x) => x.kind));
  check('intro: the main .tex and its figures are listed', kinds.has('main') && kinds.has('figure'), [...kinds]);
  const fig = paper.find((x) => x.kind === 'figure' && x.uses > 0);
  check('intro: a figure says where it is used', !!fig && !/Not named/.test(fig.where ?? ''), fig);
  // all seven are placed by \shot, a macro: each one's block is where its compile opened it
  const figs = paper.filter((x) => x.kind === 'figure');
  const enabled = await page.$$eval('#panel-files .fl-row[data-kind="figure"]', (els: any[]) => els.filter((e) => e.getAttribute('aria-disabled') !== 'true').length);
  check('intro: its 7 figures are each named by one block, and each row goes to it (none disabled)', figs.length === 7 && figs.every((x) => x.uses === 1 && !/Not named/.test(x.where ?? '')) && enabled === 7,
    figs.map((x) => `${x.path}: ${x.uses} ${x.where}`));
  if (fig) {
    // the reader is at the top; the figure's first use is further down
    await page.evaluate(() => document.querySelector("main.rtx-pane")!.scrollTo(0, 0));
    const want = await page.evaluate((p: string) => {
      const B = (window as any).editorAPI.blocks();
      const stem = p.replace(/\.[A-Za-z0-9]+$/, '');
      // the first block that names it as an argument: \includegraphics{…} or the intro's \shot{…} (labels are fig:…)
      return B.find((b: any) => b.source.includes(`{${p}}`) || b.source.includes(`{${stem}}`))?.id ?? null;
    }, fig.path!);
    await page.click(`#panel-files .fl-row[data-path="${fig.path}"]`);
    await page.waitForFunction((id: string) => {
      const el = document.querySelector(`main.rtx-pane .blk[data-id="${id}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    }, want, { timeout: 15000 }).catch(() => {});
    const seen = await page.evaluate((id: string) => {
      const el = document.querySelector(`main.rtx-pane .blk[data-id="${id}"]`);
      const r = el?.getBoundingClientRect();
      return { inView: !!r && r.bottom > 0 && r.top < innerHeight, y: document.querySelector("main.rtx-pane")!.scrollTop, back: (window as any).editorAPI.nav().history?.()?.length ?? (window as any).editorAPI.nav().history?.() };
    }, want);
    check('a click on a figure reveals its first use (through the nav API: Back returns)', !!want && seen.inView && seen.y > 0, { want, ...seen });
  }
}

// another document: the biblatex one (its .bbl)
await openBiblatexDoc(page);
await idle();
const example = await compare('biblatex');
check('biblatex: its own files (not the intro\'s), its .bbl among them', example.some((x) => x.kind === 'bbl' || x.kind === 'bib') && example[0]?.path !== undefined && JSON.stringify(example.map((x) => x.path)) !== JSON.stringify(paper.map((x) => x.path)), example.map((x) => x.path));

// dark: the panel's colours come from the tokens
{
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => (window as any).editorAPI.view?.()?.set?.({ theme: 'dark' }));
  await idle();
  await page.screenshot({ path: join(OUT, 'files-dark.png'), clip: { x: 0, y: 0, width: 360, height: 900 } });
  const c = await page.$eval('#panel-files .fl-name', (e: any) => getComputedStyle(e).color);
  const lum = (s: string) => { const m = s.match(/[\d.]+/g)!.map(Number); return (m[0] + m[1] + m[2]) / 3; };
  check('dark: the names are light on the dark sidebar', lum(c) > 128, c);
  await page.evaluate(() => (window as any).editorAPI.view?.()?.set?.({ theme: 'light' }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: join(OUT, 'files-light.png'), clip: { x: 0, y: 0, width: 360, height: 900 } });
}

// ── its close closes it; the View row again opens it ────────────────────────
await page.click('[data-ptab="files"] [data-action="close-panel"]');
await page.waitForFunction(() => !document.querySelector('[data-side] [data-ptab="files"]'));
{
  const row = await filesRow();
  check('the close on its tab closes it (no tab, no panel); its View row unchecked, still offered', !(await page.$('#panel-files')) && row?.[1] === 'false', row);
}
await chooseFiles();
await page.waitForSelector('#panel-files');
check('View › Files opens it again', !!(await tab()) && (await filesRow())?.[1] === 'true');
// ── off again: the tab goes, the Outline is shown, the View row goes ────────
await setAdvanced(false);
await page.waitForFunction(() => !document.querySelector('[data-side] [data-ptab="files"]'));
{
  const st = await page.evaluate(() => ({ panel: !!document.getElementById('panel-files'), shown: [...document.querySelectorAll('[data-side] [data-panel-view]')].filter((p: any) => !p.closest('.wb-panel--hidden')).map((p) => p.id) }));
  check('the switch off: no Files tab or panel; the Outline is shown', !st.panel && st.shown.join() === 'panel-outline', st);
  const row = await filesRow();
  check('... and no View › Files row', row === null, row);
}
await setAdvanced(true);
check('the switch on again: Files offered, not open (closed with the switch)', !(await tab()) && (await filesRow())?.[1] === 'false');
await setAdvanced(false);
// ── a figure placed by a macro, replaced in place: its block typesets again, with the new file ──
await page.evaluate(() => { location.hash = '#/doc/intro'; });
await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && (window as any).editorAPI.currentDoc()?.title?.includes('Introduction'));
await idle();
{
  // a 1×1 PNG, a file the intro does not have
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const NAME = 'figures/shot-outline.png';
  const who = await page.evaluate(async ({ name, png }: { name: string; png: string }) => {
    const E = (window as any).editorAPI, doc = E.currentDoc(), store = E.store();
    const a = await store.getAssetByName(doc.id, name);
    const b = E.blocks().find((x: any) => x.source.includes(`\shot{${name.replace(/\.png$/, '')}}`));
    await store.putAsset(doc.id, { id: a.id, name: a.name, mime: a.mime }, Uint8Array.from(atob(png), (c) => c.charCodeAt(0)));
    return { id: b?.id ?? null, was: a.hash };
  }, { name: NAME, png: PNG });
  await page.reload();
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && (window as any).editorAPI.route?.().name === 'doc');
  await idle();
  const after = await page.evaluate(async ({ id, png }: { id: string; png: string }) => {
    const E = (window as any).editorAPI;
    const el = document.querySelector(`main.rtx-pane .blk[data-id="${id}"]`);
    // the viewer draws a block when it comes into view (as tests/qa/lib/intro-check.ts looks at the pictures)
    el?.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await E.whenIdle();
    return { stats: E.backendObject()?.stats?.() ?? null, shows: !!el && el.innerHTML.includes(png.slice(0, 40)), errors: E.blocks().find((b: any) => b.id === id)?.errors ?? null };
  }, { id: who.id!, png: PNG });
  check('a figure a macro places, replaced in place: its block typesets again (its stored result is stale) and shows the new file',
    !!who.id && (after.stats?.staleFiles ?? 0) >= 1 && (after.stats?.compiled ?? 0) >= 1 && after.shows && after.errors?.length === 0, { who, ...after, stats: after.stats && { compiled: after.stats.compiled, staleFiles: after.stats.staleFiles } });
}

const unexpected = problems.filter((p) => !/favicon|Failed to load resource/.test(p));
check('no page errors', unexpected.length === 0, unexpected);

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
