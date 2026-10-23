// the dev seed cache when the server has it). Waits on editorAPI.whenIdle(), the app's
// editor:settings-* events and DOM state, never on fixed times.
//
//   node tests/test-settings.ts [http://localhost:8175/]
//
// The outline's Preamble entry opens it at the Preamble tab (a full CodeMirror editor, the focus in it); the tabs
// (← →); editing the preamble changes nothing until the sheet closes, then every block typesets again with it;
// undo puts the old preamble back (the blocks again); Cancel discards; Esc applies; a preamble error: the outline
// badge, the tab's count, the list (a click selects the line); the engine applies on close; the document menu
// opens it; Show notes / Comments as notes; light and dark; 390 px.
// Screenshots and results: test-results/settings/.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'settings');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8175/';
const BACKEND = '&engine';

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
page.setDefaultTimeout(180000);
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
await page.goto(`${BASE}?seed=sample&store=memory${BACKEND}#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
const api = (fn: string, ...a: any[]) => page.evaluate(([f, args]: [string, any[]]) => (window as any).editorAPI[f](...args), [fn, a] as [string, any[]]);
const preamble = () => page.evaluate(() => (window as any).editorAPI.currentDoc().preamble.source as string);
const sheet = () => page.evaluate(() => {
  const d = document.getElementById('settings-sheet') as HTMLDialogElement | null;
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const tab = d.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null;
  return { open: d.open, modal: d.matches(':modal'), left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom, tab: tab?.dataset.tab ?? null,
    count: d.querySelector('[data-tab="preamble"] .ui-pill')?.textContent ?? null, editor: !!d.querySelector('#ss-panel-preamble .cm-editor'),
    text: (d.querySelector('#ss-panel-preamble .cm-content') as HTMLElement | null)?.innerText ?? '', focusEditor: !!document.activeElement?.closest('#ss-panel-preamble .cm-editor'),
    errors: [...d.querySelectorAll('.ss-err')].map((e: any) => ({ line: e.dataset.line, msg: e.querySelector('.ss-err-msg')?.textContent })), note: d.querySelector('.ui-sheet-note')?.textContent };
});
// the listener is in place before the action (an evaluate not awaited could land after the event)
const armClosed = () => page.evaluate(() => { (window as any).__ssClosed = new Promise((r) => document.addEventListener('editor:settings-closed', (e: any) => r(e.detail), { once: true })); });
const closedEvent = () => page.evaluate(() => Promise.race([(window as any).__ssClosed, new Promise((r) => setTimeout(() => r({ applied: null, timeout: true }), 20000))]));
async function openFromOutline() {
  await page.click('[data-ptab="outline"]');
  await page.click('[data-panel-view="outline"] .ol-pre');
  await page.waitForFunction(() => (document.getElementById('settings-sheet') as HTMLDialogElement | null)?.open && !!document.querySelector('#settings-sheet .cm-editor'));
}
async function closeWith(how: 'done' | 'cancel' | 'escape' | 'close') {
  await armClosed();
  if (how === 'done') await page.click('#settings-sheet .ss-done');
  else if (how === 'cancel') await page.click('#settings-sheet .ss-cancel');
  else if (how === 'close') await page.click('#settings-sheet .sheet-close');
  else await page.keyboard.press('Escape');
  const d = await closedEvent();
  await page.waitForFunction(() => !document.getElementById('settings-sheet'));
  return d as { applied: boolean };
}
async function typeAtEnd(text: string) {
  await page.click('#settings-sheet .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}
const blockState = (id: string) => page.evaluate((i: string) => { const b = (window as any).editorAPI.blocks().find((x: any) => x.id === i); return { state: b?.state, errors: b?.errors?.length ?? 0, msg: b?.errors?.[0]?.message ?? '' }; }, id);

// ── open from the outline entry ───────────────────────────────────────────────
const pre0 = await preamble();
{
  check('no Document settings in the page: the preamble is in no pane', await page.evaluate(() => !document.querySelector('[data-part="page"] #settings, [data-part="page"] .settings, #preamble-sheet')));
  await openFromOutline();
  await page.waitForFunction(() => !!document.activeElement?.closest('#settings-sheet .cm-editor'));
  const s = await sheet();
  check('the outline\'s Preamble entry opens the sheet: a modal at the right edge, at the Preamble tab', !!s && s.open && s.modal && Math.abs(s.right - 1280) < 1 && s.width >= 480 && s.top <= 0.5 && s.bottom >= 899 && s.tab === 'preamble', s);
  check('... a full CodeMirror editor with the document\'s preamble, the focus in it', !!s && s.editor && s.focusEditor && s.text.replace(/\s+/g, '').includes(pre0.split('\n')[0].replace(/\s+/g, '')), s?.text.slice(0, 80));
  await page.screenshot({ path: join(OUT, '01-preamble.png') });
  // tabs: ← → on the strip
  await page.focus('#settings-sheet [data-tab="preamble"]');
  await page.keyboard.press('ArrowRight');
  const t1 = (await sheet())?.tab;
  const bib = await page.evaluate(() => document.querySelector('#ss-panel-bib:not([hidden]) #bib-info')?.textContent ?? null);
  await page.keyboard.press('ArrowRight');
  const t2 = (await sheet())?.tab;
  const eng = await page.evaluate(() => { const s = document.querySelector('#ss-panel-engine:not([hidden]) #backend-select') as HTMLSelectElement | null; return s ? { value: s.value, options: [...s.options].map((o) => o.value) } : null; });
  check('tabs: → Bibliography (its state), → Engine and view (the engine in force, the others offered)', t1 === 'bib' && !!bib && t2 === 'engine' && eng?.value === (await api('backend')) && eng.options.length >= 2, { t1, bib, t2, eng });
  await page.screenshot({ path: join(OUT, '02-engine.png') });
  await page.keyboard.press('ArrowRight');
  check('tabs: → wraps to Preamble, the editor kept (one editor for the sheet\'s life)', (await sheet())?.tab === 'preamble' && (await page.locator('#settings-sheet .cm-editor').count()) === 1);
  const d = await closeWith('escape');
  check('Esc closes it, nothing to apply; the focus goes back to the entry', !d.applied && (await page.evaluate(() => !!document.activeElement?.closest('[data-panel-view="outline"] .ol-pre'))), d);
}

// ── edit and apply: the blocks typeset again with it; undo ─────────────────────
const probeId = await api('insert', 3, 'paragraph', 'Probe: \\rtxsettingsprobe{} ends here.');
await idle();
{
  const b0 = await blockState(probeId);
  await openFromOutline();
  await typeAtEnd('\n\\newcommand{\\rtxsettingsprobe}{IT WORKS}');
  const s = await sheet();
  check('typing changes nothing yet: the document\'s preamble as before, the note says closing applies', (await preamble()) === pre0 && /Closing applies/.test(s?.note ?? ''), s?.note);
  const d = await closeWith('done');
  await idle();
  const pre1 = await preamble();
  const b1 = await blockState(probeId);
  check('Done applies: the preamble has the macro, the block using it typesets again without its error', d.applied && pre1.includes('\\rtxsettingsprobe') && b0.errors > 0 && b1.errors === 0 && b1.state !== 'error', { b0, b1 });
  const text = await page.evaluate((i: string) => document.querySelector(`[data-part="page"] .blk[data-id="${i}"] .latex-block`)?.textContent?.replace(/\s+/g, '') ?? '', probeId);
  check('... its new text is on the page', /ITWORKS/.test(text), text.slice(0, 60));
  await api('undo');
  await idle();
  const b2 = await blockState(probeId);
  check('undo: the old preamble back, the block typeset again (its error back)', (await preamble()) === pre0 && b2.errors > 0, b2);
  await page.evaluate(() => (window as any).editorAPI.redo?.());
  await idle();
  const redone = await preamble();
  check('redo: the edit again', redone === pre1, redone.slice(-60));
  await api('undo');
  await idle();
}
// ── Cancel discards; Esc applies ───────────────────────────────────────────────
{
  await openFromOutline();
  await typeAtEnd('\n% cancelled');
  const d = await closeWith('cancel');
  check('Cancel discards the edit', !d.applied && (await preamble()) === pre0);
  await openFromOutline();
  check('... reopened: the editor shows the saved preamble', !(await sheet())!.text.includes('cancelled'));
  await typeAtEnd('\n% kept by Esc');
  const e = await closeWith('escape');
  const pe = await preamble();
  check('Esc in the editor applies and closes', e.applied && pe.endsWith('% kept by Esc'), { e, end: pe.slice(-30) });
  await api('undo');
  await idle();
  check('... and undo takes it back', (await preamble()) === pre0);
}

// ── a preamble error: the badge, the tab's count, the list ───────────────────────
{
  await openFromOutline();
  await typeAtEnd('\n\\undefinedmacroxyz');
  await closeWith('close');
  await idle();
  const badge = await page.waitForFunction(() => Number(document.querySelector('[data-panel-view="outline"] .ol-pre .ol-badge')?.textContent) > 0, null, { timeout: 60000 }).then(() => true, () => false);
  check('an error in the preamble: a badge on the outline entry (the sheet does not open by itself)', badge && !(await sheet()), await page.evaluate(() => document.querySelector('[data-panel-view="outline"] .ol-pre')?.textContent));
  await openFromOutline();
  const s = await sheet();
  const lines = (await preamble()).split('\n').length;
  check('... the sheet: a count on the Preamble tab, the problem listed with its line', !!s && Number(s.count) > 0 && s.errors.length > 0 && s.errors.some((e) => Number(e.line) === lines), s);
  await page.screenshot({ path: join(OUT, '03-error.png') });
  const errLine = s!.errors.find((e) => e.line)?.line;
  if (errLine) {
    await page.click(`#settings-sheet .ss-err[data-line="${errLine}"]`);
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    check('... a click on it selects that line in the editor', sel.includes('\\undefinedmacroxyz'), sel);
  }
  await closeWith('escape');
  await api('undo');
  await idle();
  const gone = await page.waitForFunction(() => !document.querySelector('[data-panel-view="outline"] .ol-pre .ol-badge'), null, { timeout: 60000 }).then(() => true, () => false);
  check('... undone: the badge goes', gone && (await preamble()) === pre0);
}

// ── the engine applies on close; Cancel keeps the engine ─────────────────────────
{
  const b0 = await api('backend');
  await openFromOutline();
  await page.click('#settings-sheet [data-tab="engine"]');
  const opts = await page.evaluate(() => [...(document.getElementById('backend-select') as HTMLSelectElement).options].map((o) => o.value));
  const to = opts.find((o) => o !== b0 && o !== 'none') ?? opts.find((o) => o !== b0)!;
  await page.selectOption('#backend-select', to);
  check('the engine: chosen, not in force until the sheet closes', (await api('backend')) === b0, { b0, to });
  await closeWith('cancel');
  check('... Cancel keeps the engine', (await api('backend')) === b0);
  await openFromOutline();
  await page.click('#settings-sheet [data-tab="engine"]');
  await page.selectOption('#backend-select', to);
  await closeWith('done');
  await idle();
  check('... Done switches it (every block typesets again on it)', (await api('backend')) === to && (await api('blocks')).every((b: any) => b.state !== 'error' || b.id === probeId), await api('backend'));
  await openFromOutline();
  await page.click('#settings-sheet [data-tab="engine"]');
  await page.selectOption('#backend-select', b0);
  await closeWith('done');
  await idle();
  check('... and back', (await api('backend')) === b0);
}

// ── notes options on the Engine and view tab ──────────────────────────────────
{
  await openFromOutline();
  await page.click('#settings-sheet [data-tab="engine"]');
  const has = await page.locator('#ss-show-notes').count();
  if (has) {
    await page.uncheck('#ss-show-notes');
    const hid = await page.evaluate(() => (window as any).editorAPI.notes().settings().hidden);
    await page.check('#ss-show-notes');
    const shown = await page.evaluate(() => !(window as any).editorAPI.notes().settings().hidden);
    await page.uncheck('#ss-comments');
    const stillOn = await page.evaluate(() => (window as any).editorAPI.notes().settings().comments);
    await closeWith('done');
    const off = await page.evaluate(() => (window as any).editorAPI.notes().settings().comments);
    check('notes: Show notes applies at once (a view option); Comments as notes on close', hid === true && shown && stillOn === true && off === false, { hid, shown, stillOn, off });
    await page.evaluate(() => (window as any).editorAPI.notes().setComments(true));
    await idle();
  } else { check('notes: the options are on the Engine and view tab', false); await closeWith('cancel'); }
}

// ── the document menu; light and dark; 390 px ─────────────────────────────────────
{
  await page.click('#btn-doc-menu');
  await page.locator('.doc-menu [role="menuitem"]').filter({ hasText: /Document settings/ }).first().click();
  const s = await sheet();
  check('the document menu\'s "Document settings" opens it', !!s?.open && s.tab === 'preamble');
  const measure = () => page.evaluate(() => {
    const cv = document.createElement('canvas').getContext('2d')!;
    const rgba = (c: string) => { const sr = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/); if (sr) return [+sr[1] * 255, +sr[2] * 255, +sr[3] * 255, sr[4] == null ? 1 : +sr[4]];
      cv.fillStyle = '#000'; cv.fillStyle = c; const v = cv.fillStyle as string; if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
      const m = v.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const over = (t: number[], u: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    const painted = (el: Element | null) => { const st: number[][] = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) st.push(c); if (c[3] >= 1) break; } let a = [255, 255, 255, 1]; for (const c of st.reverse()) a = over(c, a); return a; };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const d = document.getElementById('settings-sheet')!;
    const of = (sel: string) => { const x = d.querySelector(sel); return x ? Math.round(ratio(over(rgba(getComputedStyle(x).color), painted(x)), painted(x)) * 10) / 10 : null; };
    return { lBg: Math.round(lum(painted(d)) * 1000) / 1000, lEditor: Math.round(lum(painted(d.querySelector('.ss-editor'))) * 1000) / 1000,
      contrast: { title: of('.ui-dialog-title'), hint: of('.ss-hint'), note: of('.ui-sheet-note'), tab: of('[role="tab"][aria-selected="true"]'), line: of('.cm-line'), cancel: of('.ss-cancel') } };
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await page.waitForFunction((t: string) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme);
    const m = await measure();
    await page.screenshot({ path: join(OUT, `04-${theme}.png`) });
    check(`${theme}: the sheet and its editor follow the theme, the text readable (4.5:1)`, (theme === 'dark' ? m.lBg < 0.05 && m.lEditor < 0.05 : m.lBg > 0.8 && m.lEditor > 0.8)
      && Object.values(m.contrast).every((c) => c == null || c >= 4.5), m);
  }
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
  await closeWith('cancel');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => (window as any).editorAPI.settings().open({ tab: 'preamble' }));
  await page.waitForFunction(() => (document.getElementById('settings-sheet') as HTMLDialogElement | null)?.open);
  const p = await sheet();
  check('390 px: the sheet covers the window, nothing outside it', !!p && p.left >= -0.5 && p.right <= 390.5 && p.width >= 389, p);
  await page.screenshot({ path: join(OUT, '05-phone.png') });
  await closeWith('cancel');
}

check('no console errors or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nsettings: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
