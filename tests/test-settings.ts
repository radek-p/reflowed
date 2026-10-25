// The Settings panel's two tabs and its document tab (app/src/settings/panel.ts, settings/document.ts), in headless
// Chromium on the dev app (the engine; the dev seed cache when the server has it). Waits on editorAPI.whenIdle() and
// DOM state, never on fixed times.
//
//   node tests/test-settings.ts [http://localhost:8175/]
//
// The tabs: General and the document's (named after it), a tablist with its tabpanels, ← → Home End. Every entry
// point lands on the right tab and place: the outline's Preamble entry, a preamble problem (its line selected), the
// main menu's Document › Document settings… (the document tab, the focus in the preamble) and Settings… (General). The
// preamble: typing changes nothing until the focus leaves the section (or Apply, ⌘↵, Esc), then every block typesets
// again; Revert discards; undo puts the old preamble back and the editor follows; a preamble error: the outline's
// badge, the count on the tab and the heading, the list (a click selects the line). The engine is General's (Advanced,
// with advanced features on), one for every open document; off, the default engine is in force. The notes' switches
// apply at once. Two documents side by side: the document tab follows the focused pane's. A read-only document's
// preamble is shown, never changed. Light and dark; 390 px.
// Screenshots and results: test-results/settings/.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { CORE_VERSION } from '../app/src/store/policy.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'settings');
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
page.setDefaultTimeout(180000);
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
await page.goto(`${BASE}?seed=sample&store=memory&engine&fresh#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
const api = (fn: string, ...a: any[]) => page.evaluate(([f, args]: [string, any[]]) => (window as any).editorAPI[f](...args), [fn, a] as [string, any[]]);
const preamble = () => page.evaluate(() => (window as any).editorAPI.currentDoc().preamble.source as string);
const P = '[data-panel-view="app-settings"]';
/** the panel as the tests see it: its tabs, the page shown, the preamble's editor and its state */
const panel = () => page.evaluate((P: string) => {
  const el = document.querySelector(`${P} .rtx-settings`);
  if (!el) return null;
  const tabs = [...el.querySelectorAll('[role="tablist"] [role="tab"]')] as HTMLElement[];
  const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
  const shown = el.querySelector('[role="tabpanel"]:not([hidden])') as HTMLElement | null;
  const pre = el.querySelector('[data-section="preamble"]');
  const r = el.getBoundingClientRect();
  return {
    tab: sel?.dataset.tab ?? null, tabs: tabs.map((t) => ({ id: t.dataset.tab, text: (t.querySelector('.rtx-set-tab-name') ?? t).textContent!.trim(), controls: t.getAttribute('aria-controls'), tip: t.title, count: t.querySelector('.ui-pill')?.textContent ?? null })),
    page: shown?.dataset.page ?? null, labelledOk: !!shown && document.getElementById(shown.getAttribute('aria-labelledby') ?? '') === sel && sel?.getAttribute('aria-controls') === shown.id,
    tablist: !!el.querySelector('[role="tablist"][aria-label]'),
    text: (pre?.querySelector('.cm-content') as HTMLElement | null)?.innerText ?? '', editors: el.querySelectorAll('.rtx-set-editor .cm-editor').length,
    focusEditor: !!document.activeElement?.closest(`${P} .rtx-set-editor`), focusTab: (document.activeElement as HTMLElement | null)?.getAttribute('role') === 'tab' ? (document.activeElement as HTMLElement).dataset.tab : null,
    note: pre?.querySelector('.rtx-set-pre-note')?.textContent ?? '', acts: pre?.querySelector('.rtx-set-pre-acts')?.getAttribute('data-shown') ?? null,
    editable: (pre?.querySelector('.cm-content') as HTMLElement | null)?.contentEditable ?? null,
    headCount: pre?.querySelector('.rtx-set-h .ui-pill')?.textContent ?? null,
    errors: [...el.querySelectorAll('.rtx-set-err')].map((e: any) => ({ line: e.dataset.line, msg: e.querySelector('.rtx-set-err-msg')?.textContent })),
    bib: el.querySelector('#bib-info')?.textContent ?? null,
    sections: shown ? [...shown.querySelectorAll('.rtx-set-section')].map((s: any) => s.dataset.section) : [],
    box: { left: r.left, right: r.right, width: r.width }, sideways: (el.closest('.sb-panel') as HTMLElement | null) ? (el.closest('.sb-panel') as HTMLElement).scrollWidth > (el.closest('.sb-panel') as HTMLElement).clientWidth + 1 : false,
  };
}, P);
type Panel = NonNullable<Awaited<ReturnType<typeof panel>>>;
const shownPanel = async (): Promise<Panel> => { await page.waitForSelector(`${P} .rtx-settings`); return (await panel())!; };
/** the focus in the preamble's editor (a landing: its frame) */
const focusedEditor = () => page.waitForFunction((P: string) => !!document.activeElement?.closest(`${P} .rtx-set-editor`), P, { timeout: 20000 }).then(() => true, () => false);
async function openFromOutline() {
  await page.click('[data-ptab="outline"]');
  await page.click('[data-panel-view="outline"] .ol-pre');
  await focusedEditor();
}
async function typeAtEnd(text: string) {
  await page.click(`${P} .rtx-set-editor .cm-content`);
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}
/** the focus out of the preamble's section: onto the General tab's button, then back on the document tab */
async function leaveSection() {
  await page.focus(`${P} [role="tab"][data-tab="document"]`);
}
const blockState = (id: string) => page.evaluate((i: string) => { const b = (window as any).editorAPI.blocks().find((x: any) => x.id === i); return { state: b?.state, errors: b?.errors?.length ?? 0, msg: b?.errors?.[0]?.message ?? '' }; }, id);
const docTitle = () => page.evaluate(() => (window as any).editorAPI.currentDoc().title as string);

// ── the outline's Preamble entry: the panel on the document tab, the focus in the preamble ─────────────────────
const pre0 = await preamble();
{
  check('no Document settings sheet in the page', await page.evaluate(() => !document.querySelector('#settings-sheet, dialog.ui-sheet')));
  await openFromOutline();
  const s = await shownPanel();
  const title = await docTitle();
  check('the outline\'s Preamble entry opens the Settings panel on the document tab, the focus in the preamble\'s editor', s.tab === 'document' && s.page === 'document' && s.focusEditor && s.editors === 1, s);
  check('... its editor holds the document\'s preamble', s.text.replace(/\s+/g, '').includes(pre0.split('\n')[0].replace(/\s+/g, '')), s.text.slice(0, 80));
  check('the tabs: General and the document\'s, named after it (its title in the tooltip)', s.tabs.length === 2 && s.tabs[0].id === 'general' && s.tabs[0].text === 'General' && s.tabs[1].id === 'document'
    && s.tabs[1].text === title && s.tabs[1].tip.startsWith(title), s.tabs);
  check('roles: a labelled tablist; the tab shown controls the tabpanel shown, which it labels', s.tablist && s.labelledOk, s);
  check('the document tab: Preamble, then Bibliography (its state)', s.sections.join() === 'preamble,bib' && !!s.bib, s);
  await page.screenshot({ path: join(OUT, '01-document-tab.png') });
  // the keyboard: ← → wrap, Home, End; the panel shown follows
  await page.focus(`${P} [role="tab"][data-tab="document"]`);
  await page.keyboard.press('ArrowRight');
  const a = await panel();
  await page.keyboard.press('ArrowLeft');
  const b = await panel();
  await page.keyboard.press('Home');
  const c = await panel();
  await page.keyboard.press('End');
  const d = await panel();
  check('keys on the tabs: → wraps to General, ← back, Home General, End the document; the focus and the panel shown follow',
    a?.tab === 'general' && a.focusTab === 'general' && a.page === 'general' && b?.tab === 'document' && b.focusTab === 'document' && c?.tab === 'general' && d?.tab === 'document' && d.page === 'document', { a: a?.tab, b: b?.tab, c: c?.tab, d: d?.tab });
  check('... the preamble\'s editor kept (one for the tab\'s life)', d?.editors === 1);
}

// ── edit and apply: the focus leaving applies, the blocks typeset again with it; undo ─────────────────────────
const probeId = await api('insert', 3, 'paragraph', 'Probe: \\rtxsettingsprobe{} ends here.');
await idle();
{
  const b0 = await blockState(probeId);
  await typeAtEnd('\n\\newcommand{\\rtxsettingsprobe}{IT WORKS}');
  const s = (await panel())!;
  check('typing changes nothing yet: the document\'s preamble as before, the note says leaving applies, Apply and Revert shown', (await preamble()) === pre0 && /Not applied yet/.test(s.note) && s.acts === 'true', s.note);
  await leaveSection();
  await idle();
  const pre1 = await preamble();
  const b1 = await blockState(probeId);
  check('the focus leaving the preamble applies it: the block using the macro typesets again without its error', pre1.includes('\\rtxsettingsprobe') && b0.errors > 0 && b1.errors === 0 && b1.state !== 'error', { b0, b1 });
  const text = await page.evaluate((i: string) => document.querySelector(`[data-part="page"] .blk[data-id="${i}"] .latex-block`)?.textContent?.replace(/\s+/g, '') ?? '', probeId);
  check('... its new text is on the page; the note back to its hint, the actions hidden', /ITWORKS/.test(text) && (await panel())!.acts === 'false', text.slice(0, 60));
  await api('undo');
  await idle();
  const b2 = await blockState(probeId);
  const after = (await panel())!;
  check('undo: the old preamble back, the block typeset again (its error back), the editor shows it', (await preamble()) === pre0 && b2.errors > 0 && !after.text.includes('rtxsettingsprobe'), b2);
  await api('redo');
  await idle();
  check('redo: the edit again, in the editor too', (await preamble()) === pre1 && (await panel())!.text.includes('rtxsettingsprobe'));
  await api('undo');
  await idle();
}
// ── Revert discards; Apply, ⌘↵ and Esc apply ──────────────────────────────────────────────────────────────
{
  await typeAtEnd('\n% reverted');
  await page.click(`${P} .rtx-set-revert`);
  const s = (await panel())!;
  check('Revert discards the text typed (the saved preamble back in the editor, nothing applied)', (await preamble()) === pre0 && !s.text.includes('reverted') && s.acts === 'false', s.note);
  await typeAtEnd('\n% by Apply');
  await page.click(`${P} .rtx-set-apply`);
  await idle();
  check('Apply applies', (await preamble()).endsWith('% by Apply'));
  await api('undo'); await idle();
  await typeAtEnd('\n% by mod-enter');
  await page.keyboard.press('ControlOrMeta+Enter');
  await idle();
  check('Ctrl/⌘↵ in the editor applies', (await preamble()).endsWith('% by mod-enter'));
  await api('undo'); await idle();
  await typeAtEnd('\n% by Esc');
  await page.keyboard.press('Escape');
  await idle();
  check('Esc in the editor applies', (await preamble()).endsWith('% by Esc'));
  await api('undo'); await idle();
  const back = await preamble();
  check('... each one undo step', back === pre0, back.slice(pre0.length - 20));
}

// ── a preamble error: the badge, the counts, the list; a problem lands on its line ───────────────────────────
{
  await typeAtEnd('\n\\undefinedmacroxyz');
  await leaveSection();
  await idle();
  const badge = await page.waitForFunction(() => Number(document.querySelector('[data-panel-view="outline"] .ol-pre .ol-badge')?.textContent) > 0, null, { timeout: 60000 }).then(() => true, () => false);
  const s = (await panel())!;
  const lines = (await preamble()).split('\n').length;
  check('an error in the preamble: a badge on the outline entry, a count on the document tab and on the Preamble heading, the problem listed with its line',
    badge && Number(s.tabs[1].count) > 0 && Number(s.headCount) > 0 && s.errors.some((e) => Number(e.line) === lines), s);
  await page.screenshot({ path: join(OUT, '02-error.png') });
  const errLine = s.errors.find((e) => e.line)?.line;
  await page.click(`${P} .rtx-set-err[data-line="${errLine}"]`);
  const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  check('... a click on it selects that line in the editor', sel.includes('\\undefinedmacroxyz'), sel);
  // the Problems panel's preamble problem: the document tab, the line selected
  await page.click(`${P} [role="tab"][data-tab="general"]`);
  await page.click('[data-ptab="problems"]');
  await page.click('[data-panel-view="problems"] .pb-row[data-kind="error"][data-block=""]');
  await focusedEditor();
  const p = (await panel())!;
  const sel2 = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  check('a preamble problem in the Problems panel: the Settings panel on the document tab, that line selected', p.tab === 'document' && p.focusEditor && sel2.includes('\\undefinedmacroxyz'), { tab: p.tab, sel2 });
  await api('undo');
  await idle();
  const gone = await page.waitForFunction(() => !document.querySelector('[data-panel-view="outline"] .ol-pre .ol-badge'), null, { timeout: 60000 }).then(() => true, () => false);
  const back = await preamble();
  check('... undone: the badge and the counts go', gone && back === pre0 && (await panel())!.tabs[1].count === null, { gone, tail: back.slice(pre0.length - 20), count: (await panel())!.tabs[1].count });
}

// ── the main menu: Document settings… on the document tab, Settings… on General ─────────────────────────────
{
  await page.click(`${P} [role="tab"][data-tab="general"]`);
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="document"]');
  await page.click('.main-menu [data-action="doc-settings"]');
  const ok = await focusedEditor();
  check('the main menu\'s Document › Document settings…: the document tab, the focus in the preamble', ok && (await panel())!.tab === 'document');
  await page.click('[data-ptab="app-settings"] [data-action="close-panel"]');
  await page.waitForFunction((P: string) => !document.querySelector(P), P);
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  const s = await shownPanel();
  check('Settings…: General (its sections: Reading, Editing, Notes, Advanced)', s.tab === 'general' && s.page === 'general' && s.sections.join() === 'view,editing,notes,advanced', s);
}

// ── the engine: General's, one for every open document; behind advanced features ───────────────────────────
{
  const b0 = await api('backend');
  check('advanced features off: no engine row', await page.locator(`${P} #backend-select`).count() === 0);
  await api('advanced', true);
  await page.waitForSelector(`${P} [data-section="advanced"] #backend-select`);
  const opts = await page.evaluate(() => [...(document.getElementById('backend-select') as HTMLSelectElement).options].map((o) => o.value));
  const to = opts.find((o) => o !== b0)!;
  check('advanced on: the engine in the Advanced section, the one in force selected', opts.length >= 2 && (await page.inputValue('#backend-select')) === b0, { opts, b0 });
  await page.selectOption('#backend-select', to);
  await idle();
  check('... another engine applies at once (every block typesets again on it)', (await api('backend')) === to, await api('backend'));
  await api('advanced', false);
  await idle();
  check('advanced off: the default engine in force again, the choice kept', (await api('backend')) === opts[0] && (await page.evaluate(() => localStorage.getItem('rtx-editor.backend'))) === to, await api('backend'));
  await api('advanced', true);
  await page.waitForSelector(`${P} #backend-select`);
  await page.selectOption('#backend-select', b0);
  await idle();
  check('... and back', (await api('backend')) === b0);
  await api('advanced', false);
  await idle();
}

// ── the notes' switches apply at once ───────────────────────────────────────────────────────────────────────
{
  await page.uncheck(`${P} #set-note-chips`);
  const hid = await page.evaluate(() => (window as any).editorAPI.notes().settings().hidden);
  await page.check(`${P} #set-note-chips`);
  const shown = await page.evaluate(() => !(window as any).editorAPI.notes().settings().hidden);
  await page.uncheck(`${P} #set-comments`);
  const off = await page.evaluate(() => (window as any).editorAPI.notes().settings().comments);
  check('the Settings panel\'s Note chips and Comments as notes apply at once', hid === true && shown && off === false, { hid, shown, off });
  await page.check(`${P} #set-comments`);
  await idle();
}

// ── two documents side by side: the document tab follows the focused pane's ─────────────────────────────────
const otherId: string = await page.evaluate(async () => (window as any).editorAPI.store().createDoc({ title: 'The other one', preamble: '\\documentclass{article}\n\\newcommand{\\otherdocmacro}{x}', blocks: [{ source: 'Its paragraph.' }] }));
{
  await page.click(`${P} [role="tab"][data-tab="document"]`);
  await page.evaluate(async () => { const E = (window as any).editorAPI; E.workbench().run('splitRight'); await E.whenIdle(); });
  await page.evaluate(async (id: string) => { const E = (window as any).editorAPI; E.workbench().open({ view: 'document', state: { doc: id } }, { focus: true }); await E.whenIdle(); }, otherId);
  await idle();
  const eds = await api('editors') as Record<string, { doc: string }>;
  const paneOf = (doc: string) => Object.entries(eds).find(([, e]) => e.doc === doc)?.[0];
  const pa = paneOf('sample') ?? Object.entries(eds).find(([, e]) => e.doc !== otherId)?.[0], pb = paneOf(otherId);
  const focus = async (pane: string) => { await page.evaluate(async (p: string) => { const E = (window as any).editorAPI; E.workbench().activate(p, { focus: true }); await E.whenIdle(); }, pane); await page.waitForFunction(([P, p]: string[]) => (window as any).editorAPI.editors()[p]?.current, [P, pane]); };
  await focus(pb!);
  await page.waitForFunction((P: string) => document.querySelector(`${P} [role="tab"][data-tab="document"] .rtx-set-tab-name`)?.textContent?.trim() === 'The other one', P);
  const b = (await panel())!;
  await focus(pa!);
  const sampleTitle = await docTitle();
  await page.waitForFunction(([P, t]: string[]) => document.querySelector(`${P} [role="tab"][data-tab="document"] .rtx-set-tab-name`)?.textContent?.trim() === t, [P, sampleTitle]);
  const a = (await panel())!;
  check('two documents side by side: the document tab is the focused pane\'s (its name, its preamble), and follows the focus',
    b.tabs[1].text === 'The other one' && b.text.includes('otherdocmacro') && a.tabs[1].text === sampleTitle && !a.text.includes('otherdocmacro'), { b: b.tabs[1], a: a.tabs[1] });
  await page.screenshot({ path: join(OUT, '03-two-documents.png') });
  // text typed in one document's preamble applies to that one when the focus moves to the other's pane
  await focus(pb!);
  await page.waitForFunction((P: string) => document.querySelector(`${P} [role="tab"][data-tab="document"] .rtx-set-tab-name`)?.textContent?.trim() === 'The other one', P);
  await typeAtEnd('\n% typed in the other one');
  await focus(pa!);
  await idle();
  const otherPre = await page.evaluate(async (id: string) => (await (window as any).editorAPI.store().getDoc(id))?.preamble?.source ?? '', otherId);
  check('... text typed in one document\'s preamble is applied to that document when the focus goes to the other', otherPre.endsWith('% typed in the other one') && (await preamble()) === pre0, otherPre.slice(-40));
  // back to one group: the other document's tab closed
  await page.evaluate(async (p: string) => { const E = (window as any).editorAPI; E.workbench().close(p); await E.whenIdle(); }, pb!);
  await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); for (const p of Object.keys(E.editors()).slice(1)) wb.close(p); await E.whenIdle(); });
  await idle();
}

// ── a read-only document: its preamble shown, never changed ──────────────────────────────────────────────────
{
  const ro: string = await page.evaluate(async (core: number) => {
    const s = (window as any).editorAPI.store();
    const id = await s.createDoc({ title: 'Read only', preamble: '\\documentclass{article}\n% read-only preamble', blocks: [{ source: 'A paragraph.' }] });
    await s.backend.run(['docs'], 'readwrite', async (tx: any) => { const d = await tx.get('docs', id); await tx.put('docs', { ...d, schema: core }); });
    return id;
  }, CORE_VERSION + 1);
  await api('open', ro);
  await idle();
  await page.evaluate(() => (window as any).editorAPI.commands().call('doc.settings', {}));
  await page.waitForFunction((P: string) => document.querySelector(`${P} [role="tab"][data-tab="document"] .rtx-set-tab-name`)?.textContent?.trim() === 'Read only', P);
  const s = (await panel())!;
  check('a read-only document: its preamble shown, the editor not editable, the note says so, no Apply', s.text.includes('read-only preamble') && s.editable === 'false' && /read-only/.test(s.note) && s.acts === null, s);
  await page.click(`${P} .rtx-set-editor .cm-content`);
  await page.keyboard.type('xyz');
  await leaveSection();
  const after = await page.evaluate(async (id: string) => (await (window as any).editorAPI.store().getDoc(id))?.preamble?.source ?? '', ro);
  check('... typing there changes nothing', !after.includes('xyz') && !(await panel())!.text.includes('xyz'), after);
  await api('open', 'sample');
  await idle();
}

// ── light and dark; 390 px ───────────────────────────────────────────────────────────────────────────────
{
  await page.evaluate(() => (window as any).editorAPI.commands().call('doc.settings', {}));
  await focusedEditor();
  const measure = () => page.evaluate((P: string) => {
    const cv = document.createElement('canvas').getContext('2d')!;
    const rgba = (c: string) => { const sr = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/); if (sr) return [+sr[1] * 255, +sr[2] * 255, +sr[3] * 255, sr[4] == null ? 1 : +sr[4]];
      cv.fillStyle = '#000'; cv.fillStyle = c; const v = cv.fillStyle as string; if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
      const m = v.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const over = (t: number[], u: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    const painted = (el: Element | null) => { const st: number[][] = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) st.push(c); if (c[3] >= 1) break; } let a = [255, 255, 255, 1]; for (const c of st.reverse()) a = over(c, a); return a; };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const d = document.querySelector(`${P} .rtx-settings`)!;
    const of = (sel: string) => { const x = d.querySelector(sel); return x ? Math.round(ratio(over(rgba(getComputedStyle(x).color), painted(x)), painted(x)) * 10) / 10 : null; };
    return { lBg: Math.round(lum(painted(d)) * 1000) / 1000, lEditor: Math.round(lum(painted(d.querySelector('.rtx-set-editor .cm-content'))) * 1000) / 1000,
      contrast: { heading: of('.rtx-set-h'), note: of('.rtx-set-pre-note'), tab: of('[role="tab"][aria-selected="true"]'), line: of('.cm-line'), bib: of('#bib-info') } };
  }, P);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await page.waitForFunction((t: string) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme);
    const m = await measure();
    await page.screenshot({ path: join(OUT, `04-${theme}.png`) });
    check(`${theme}: the panel and the preamble's editor follow the theme, the text readable (4.5:1)`, (theme === 'dark' ? m.lBg < 0.05 && m.lEditor < 0.05 : m.lBg > 0.8 && m.lEditor > 0.8)
      && Object.values(m.contrast).every((c) => c == null || c >= 4.5), m);
  }
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as any).editorAPI.commands().call('doc.settings', {}));
  await focusedEditor();
  const p = (await panel())!;
  const ed = await page.evaluate((P: string) => { const r = document.querySelector(`${P} .rtx-set-editor`)!.getBoundingClientRect(); return { left: r.left, right: r.right }; }, P);
  check('390 px: the panel takes the window\'s width, the preamble\'s editor inside it, nothing sideways', p.box.left >= -0.5 && p.box.right <= 390.5 && ed.left >= 0 && ed.right <= 390 && !p.sideways, { box: p.box, ed });
  await page.screenshot({ path: join(OUT, '05-phone.png') });
}

check('no console errors or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nsettings: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
