// A release: the dev switches ?stubs= and ?store=memory are ignored (the store stays IndexedDB, so
// documents persist), and every feature installed (globalThis.__rtxFeatureErrors stays empty).
// The inspector (an advanced tool, behind "Show advanced features"):
//   the single file has none of it: no code (its build stubs the module: the HTML has none of its markers), no files,
//     no inspector, no view, no side panel, no style element; Alt+Shift+I reaches a text field;
//   the multi-file release beside it (X/ beside X.html, served over http) has it, loaded on demand: nothing of it is
//     requested before it is opened (the advanced switch off, then on); View › Inspector shows "Loading the inspector…"
//     while its files come (held here), then the panel, with the boxes of a block; each of the public panel's files was
//     requested once; closing and opening it again requests nothing; with its files
//     not reachable (offline) the panel says it could not be loaded, and once they are, opening it again loads it.
//   node tests/test-release-mode.ts [dist/reflowtex-editor.html]
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, EDITOR } from './qa/lib/harness.ts';
import { staticServer } from './qa/lib/static-server.ts';
import type { Manifest } from '../loading/manifest.ts';

const at = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const FILE = at ?? join(EDITOR, 'dist/reflowtex-editor.html');
const t = harness('release-mode');

// ── the single file ──────────────────────────────────────────────────────────
{
  const html = readFileSync(FILE, 'utf8');
  // what only the inspector's modules hold (inspector/index.ts, inspector/panel.ts)
  const MARKERS = ['rtx-insp', '__rtxInspector', 'lib/viewer/inspector/', 'rtxInspectorLoader', 'Loading the inspector', 'The inspector (boxes and glue)', 'inspector-'];
  const found = MARKERS.filter((m) => html.includes(m));
  t.check('the single file has no inspector code (none of its markers in the HTML)', found.length === 0, found);
}
const { ctx, page, errors } = await t.launch({ target: 'file', at, query: 'stubs=store,io,refs&store=memory' });
const kind = await page.evaluate(() => (window as any).editorAPI.store().kind);
t.check('?stubs=store&store=memory ignored: the store is IndexedDB', kind === 'indexeddb', { kind });
await t.newDoc(page, { title: 'Release mode', preamble: '\\documentclass{article}', blocks: [{ source: 'A paragraph.' }] });
const failed = await page.evaluate(() => (globalThis as any).__rtxFeatureErrors ?? []);
t.check('every feature installed (no __rtxFeatureErrors)', !failed.length, failed);
// the inspector: a stub in the single file's build, so nothing of what its module installs
const insp = await page.evaluate(() => ({ api: (window as any).editorAPI.inspector() ?? null,
  view: (window as any).editorAPI.views().some((v: { id: string }) => v.id === 'inspector'), css: !!document.getElementById('rtx-insp-css') }));
t.check('no inspector in the single file: editorAPI.inspector() null, no inspector view registered, no #rtx-insp-css', insp.api === null && !insp.view && !insp.css, insp);
// nor its side panel: Alt+Shift+I opens nothing, the workbench has no such panel type, no column holds it
await page.evaluate(() => (window as any).editorAPI.advanced(true));
await page.keyboard.press('Alt+Shift+KeyI');
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const side = await page.evaluate(() => ({ type: !!(window as any).editorAPI.workbench().viewType('inspector'), tab: !!document.querySelector('[data-ptab="inspector"], [data-panel-view="inspector"]'),
  right: !!document.querySelector('aside[data-side="right"]'), panel: !!(window as any).reflowtex?.inspector }));
t.check('no inspector side panel in the single file (advanced on, Alt+Shift+I pressed): no panel type, no tab, no right column, no public panel', !side.type && !side.tab && !side.right && !side.panel, side);
/** Alt+Shift+I (on a Mac a character in many layouts) in a text field: heard there, its default not prevented */
const keyInField = (p: any) => p.evaluate(() => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  let heard = false;
  input.addEventListener('keydown', () => { heard = true; });
  const done = input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ˆ', code: 'KeyI', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  input.remove();
  return { heard, prevented: !done };
});
const key = await keyInField(page);
t.check('Alt+Shift+I in a text field reaches it, not prevented', key.heard && !key.prevented, key);
/** the main menu's View › Inspector row: there (the menu closed again) */
async function inspectorRow(p: any): Promise<boolean> {
  await p.click('#btn-main-menu');
  await p.click('.main-menu [data-action="view"]');
  const row = await p.evaluate(() => !!document.querySelector('.main-menu [data-action="panel-inspector"]'));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.main-menu'));
  return row;
}
t.check('... and the main menu has no View › Inspector row there', !(await inspectorRow(page)));
t.check('no page errors (the single file)', !errors.length, errors);
await ctx.close();

// ── the multi-file release beside it: the inspector, loaded on demand ────────
const DIR = FILE.replace(/\.html$/, '');
if (!existsSync(join(DIR, 'manifest.json'))) t.check(`the multi-file release is beside the single file (${DIR})`, false);
else {
  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Manifest;
  const own = manifest.files.filter((f) => f.type === 'inspector');
  const names = own.map((f) => f.id.replace(/^inspector:/, ''));
  t.check('the multi-file release has the public inspector\'s files (inspector.js, inspector.css, agent.js, panel/app.js, vendor/preact.js), on demand, in one folder',
    ['inspector.js', 'inspector.css', 'agent.js', 'panel/app.js', 'vendor/preact.js'].every((n) => names.includes(n)) && own.every((f) => f.group === 'demand')
      && new Set(own.map((f) => f.path.split('/')[0])).size === 1 && !names.some((n) => n.startsWith('src/') || n.endsWith('.md')), names);
  const KB = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`  on demand: the public panel, ${own.length} files, ${KB(own.reduce((a, f) => a + f.bytes, 0))}`);
  const lic = readFileSync(join(DIR, manifest.files.find((f) => f.type === 'licences')!.path), 'utf8');
  t.check('its licences name what it ships: reflowtex with the inspector, and the inspector\'s vendor packages (preact, htm, @preact/signals)',
    /reflowtex \(the viewer, the encoder, the companion package, the inspector\)/.test(lic) && ['preact', 'htm', '@preact/signals'].every((n) => new RegExp(`── ${n.replace('/', '\\/')} [\\d.]+ \\([^)]*inspector\\)`).test(lic)),
    lic.split('\n').filter((l) => /^── (preact|htm|@preact\/signals) /.test(l)));

  const server = await staticServer({ root: DIR });
  const pw = createRequire(join(EDITOR, 'app/package.json'))('playwright');
  const ondemand = new Set(own.map((f) => `/${f.path}`));
  const isOurs = (path: string) => ondemand.has(path.split('?')[0]);
  /** a fresh browser on the release, its requests for the inspector's files recorded */
  async function open(o: { advanced?: boolean } = {}) {
    const c = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-release-insp-')), { viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    if (o.advanced) await c.addInitScript(() => { try { localStorage.setItem('rtx-editor.advanced', '1'); } catch { /* */ } });
    const reqs: string[] = [];
    c.on('request', (r: any) => { const p = new URL(r.url()).pathname; if (isOurs(p)) reqs.push(p); });
    const p = c.pages()[0] ?? await c.newPage();
    p.setDefaultTimeout(600000);
    const errs: string[] = [];
    p.on('pageerror', (e: Error) => errs.push(e.message));
    await p.goto(`${server.origin}/#/`);
    await p.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
    await t.newDoc(p, { title: 'Inspector', preamble: '\\documentclass{article}', blocks: [{ source: 'A paragraph with \\emph{some} words.' }] });
    await p.waitForSelector('[data-pane] .blk .blk-render > .latex-block');
    return { c, p, reqs, errs };
  }
  const ready = (p: any) => p.evaluate(() => (window as any).editorAPI.inspector().whenReady());
  const phase = (p: any) => p.evaluate(() => (window as any).editorAPI.inspector().phase.peek());
  const frames = (p: any) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const counts = (reqs: string[]) => { const m: Record<string, number> = {}; for (const r of reqs) m[r] = (m[r] ?? 0) + 1; return m; };
  /** the public panel's tree: its rows by kind */
  const tree = (p: any) => p.evaluate(() => {
    const host = [...document.querySelectorAll('[data-rtx-ui]')].find((e) => (e as any).shadowRoot) as any;
    const rows = [...(host?.shadowRoot?.querySelectorAll('.tree .row') ?? [])] as HTMLElement[];
    return { open: !!host?.shadowRoot?.querySelector('.rtx:not([hidden])'), kinds: [...new Set(rows.map((r) => [...r.classList].find((c) => c.startsWith('t-'))))] };
  });

  // online: nothing before it is opened; then once
  {
    const { c, p, reqs, errs } = await open();
    await t.idle(p);
    t.check('multi-file: an inspector there (the advanced switch off: no View › Inspector row)', await p.evaluate(() => !!(window as any).editorAPI.inspector()?.available()) && !(await inspectorRow(p)));
    await p.keyboard.press('Alt+Shift+KeyI');
    await frames(p);
    const k = await keyInField(p);
    t.check('... the switch off, Alt+Shift+I opens nothing and reaches a text field', k.heard && !k.prevented && !(await p.evaluate(() => (window as any).editorAPI.inspector().on.peek())), k);
    t.check('... nothing of it requested after the start (the switch off)', reqs.length === 0, reqs);
    await p.evaluate(() => (window as any).editorAPI.advanced(true));
    await frames(p);
    t.check('the switch on: the main menu has View › Inspector; still nothing of it requested', (await inspectorRow(p)) && reqs.length === 0, reqs);
    // its first file held, so its loading line can be seen
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await c.route(/\/inspector-[0-9a-f]+\/inspector\.js$/, async (route: any) => { await held; await route.continue(); });
    await p.click('#btn-main-menu');
    await p.click('.main-menu [data-action="view"]');
    await p.click('.main-menu [data-action="panel-inspector"]');
    await p.waitForSelector('.rtx-insp-msg[data-phase="loading"]');
    const loading = await p.evaluate(() => { const m = document.querySelector('.rtx-insp-msg') as HTMLElement; return { text: m.textContent, inPanel: !!m.closest('[data-panel-view="inspector"]'), body: getComputedStyle(document.querySelector('.rtx-insp-body')!).visibility }; });
    t.check('View › Inspector: its panel opens at once with "Loading the inspector…" while its files come (the panel\'s element hidden)', loading.text === 'Loading the inspector…' && loading.inPanel && loading.body === 'hidden', loading);
    release();
    await ready(p);
    await c.unroute(/\/inspector-[0-9a-f]+\/inspector\.js$/);
    const s = await tree(p);
    t.check('... then the public panel, in its side panel, the loading line gone', (await phase(p)) === 'ready' && s.open && !(await p.$('.rtx-insp-msg')), s);
    // the paragraph's block (the first .blk with a typeset block in it: not the preamble's), opened in the tree: the block
    // row selected and open (its segments); its segment opened (its lines), then a line (its glyphs, glue, boxes): the
    // tree opens by a press on a row's twisty
    const block = await p.evaluate(() => (document.querySelector('[data-pane] .blk .blk-render > .latex-block')!.closest('.blk') as HTMLElement).dataset.id);
    await p.evaluate((id: string) => (window as any).editorAPI.inspector().open({ block: id }), block);
    await ready(p);
    const T = '[data-panel-view="inspector"] .tree';
    await p.waitForSelector(`${T} .row.t-block.sel[aria-expanded="true"]`);
    for (const kind of ['t-text', 't-line']) {
      await p.locator(`${T} .row.${kind}[aria-expanded="false"] .twisty`).first().click();
      await p.waitForSelector(`${T} .row.${kind}[aria-expanded="true"]`);
    }
    await p.waitForSelector(`${T} .row.t-glue, ${T} .row.t-glyph, ${T} .row.t-hbox`);
    const b = await tree(p);
    t.check('the panel shows the boxes of a block (the block, its segment, its lines, their glyphs, glue, boxes)', ['t-block', 't-text', 't-line'].every((k) => b.kinds.includes(k)) && b.kinds.some((k) => k === 't-glyph' || k === 't-hbox' || k === 't-glue'), b);
    const n = counts(reqs);
    const wanted = [...ondemand].filter((x) => /\/(inspector\.js|inspector\.css|agent\.js|panel\/app\.js|vendor\/preact\.js)$/.test(x));
    t.check(`... each of the public panel's files requested once (${reqs.length} requests)`, wanted.every((x) => n[x] === 1) && Object.values(n).every((v) => v === 1), n);
    await p.screenshot({ path: join(t.out, 'multifile-inspector.png') });
    const before = reqs.length;
    await p.keyboard.press('Alt+Shift+KeyI');
    await ready(p);
    const closed = await p.evaluate(() => (window as any).editorAPI.inspector().on.peek());
    await p.keyboard.press('Alt+Shift+KeyI');
    await ready(p);
    const again = await tree(p);
    t.check('closed and opened again: shown again, nothing requested', !closed && again.open && reqs.length === before, { closed, again, more: reqs.slice(before) });
    t.check('no page errors (the multi-file release)', !errs.length, errs);
    await c.close();
  }
  // offline: its files cannot be reached; then they can
  {
    const { c, p, errs } = await open({ advanced: true });
    const OFF = (u: URL) => isOurs(u.pathname);
    await c.route(OFF, (route: any) => route.abort('internetdisconnected'));
    await p.keyboard.press('Alt+Shift+KeyI');
    await ready(p);
    const m = await p.evaluate(() => { const el = document.querySelector('.rtx-insp-msg[data-phase="failed"]') as HTMLElement | null; return el ? { text: el.textContent, role: el.getAttribute('role') } : null; });
    t.check('offline: the panel says the inspector could not be loaded', (await phase(p)) === 'failed' && !!m && /could not be loaded/.test(m.text ?? '') && m.role === 'alert', m);
    await c.unroute(OFF);
    await p.keyboard.press('Alt+Shift+KeyI');            // (closed)
    await ready(p);
    await p.keyboard.press('Alt+Shift+KeyI');            // (opened again: another try)
    await ready(p);
    const s = await tree(p);
    t.check('... back online, opening it again loads it', (await phase(p)) === 'ready' && s.open && !(await p.$('.rtx-insp-msg')), { phase: await phase(p), s });
    t.check('no page errors (offline)', !errs.length, errs);
    await c.close();
  }
  await server.close();
}
t.done();
