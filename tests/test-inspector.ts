// the public Reflow TeX inspector inside ReflowEd, on ONE pane (app/src/inspector/), in headless Chromium on the
// dev app (the engine; the sample document). Waits on editorAPI.whenIdle(), inspector.whenReady() and DOM state,
// never on fixed times.
//
//   node tests/test-inspector.ts [http://localhost:8156/]       (a dev server: tests/integration/serve.ts)
//
// Hidden by default (no control, no menu item, no view, the shortcut does nothing and goes on to a text field
// unprevented, nothing loaded); the advanced switch (the Settings panel's) shows its row in the main menu (View ›); ⌥⇧I opens it as a side panel on the right, its
// column a third of the window wide, the public panel hosted in it; with two panes it inspects the focused one only (its
// blocks, its outlines); focusing the other moves it, picking a pane in its bar pins it; the shortcut, the main menu's row
// and its tab's close button close it (everything goes); moved to the left it is hosted there, comes back there, and a
// width the user gives its column is kept; the advanced switch off closes it.
// Flush: the public panel fills its side panel edge to edge (no radius, border, padding or margin of its own, none of
// the side panel's around it; below the pane bar when there is one), in light and dark, split, and on a phone.
// Results: test-results/inspector/results.json (and screenshots beside it).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'inspector');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8156/';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
await page.goto(`${BASE}?seed=sample&store=memory&engine#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const ready = () => page.evaluate(() => (window as any).editorAPI.inspector().whenReady());
const frames = (n = 3) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
await idle();
// the panes by their place (a pane is a workbench tab, its id the tab's): A the first document tab, B the split's
const P: Record<string, string> = { a: await page.evaluate(() => Object.keys((window as any).editorAPI.editors())[0]) };
const syncP = () => page.evaluate((p: Record<string, string>) => { (window as any).P = p; }, P);
await syncP();

/** what is on the page of the inspector: the public panel's host (where it is: the side column), the outline layer's
 *  marks, its pane bar, the column's width (and the window's), the viewer's paint count, the blocks' widths */
const state = () => page.evaluate(() => {
  const w = window as any;
  const host = [...document.querySelectorAll('[data-rtx-ui]')].find((e) => (e as any).shadowRoot) as any;
  const panel = host?.shadowRoot?.querySelector('.rtx') as HTMLElement | undefined;
  const layer = document.querySelector('[data-rtx-inspector]');
  const bar = document.querySelector('.rtx-insp-bar') as HTMLElement | null;
  const aside = host?.closest('aside[data-side]') as HTMLElement | null;
  const S = w.editorAPI.workbench().sides.peek();
  const panelsOf = (n: any): string[] => (n.kind === 'split' ? n.children.flatMap(panelsOf) : n.panels);
  const docked = ['left', 'right'].find((s) => panelsOf(S[s].root).includes('inspector')) ?? null;
  const widths = [...document.querySelectorAll('[data-pane] .blk-render > .latex-block')].map((el) => Math.round((el as HTMLElement).getBoundingClientRect().width)).join(',');
  return { host: !!host, open: !!panel && !panel.hidden, embedded: !!panel?.classList.contains('docked'), marks: layer?.childElementCount ?? 0, bar: bar?.dataset.paneOf ?? null,
    side: aside?.dataset.side ?? null, inView: !!host?.closest('[data-panel-view="inspector"]'), docked, width: aside ? Math.round(aside.getBoundingClientRect().width) : null,
    vw: document.documentElement.clientWidth,
    loaded: !!w.reflowtex?.inspector, paints: w.reflowtex.inspect.paints, widths,
    on: w.editorAPI.inspector().on.peek(), target: w.editorAPI.inspector().target.peek() };
});
/** the public panel's outer box (its .rtx in the shadow root) against its side panel's box (the workbench's panel
 *  element: its border box, so none of its padding either) and the pane bar's bottom when there is one */
const flushOf = (p: any = page) => p.evaluate(() => {
  const host = [...document.querySelectorAll('[data-rtx-ui]')].find((e) => (e as any).shadowRoot) as HTMLElement | undefined;
  const rtx = host?.shadowRoot?.querySelector('.rtx') as HTMLElement | null | undefined;
  const panel = host?.closest('[data-panel-view="inspector"]') as HTMLElement | null | undefined;
  if (!rtx || !panel) return null;
  const a = rtx.getBoundingClientRect(), b = panel.getBoundingClientRect(), cs = getComputedStyle(rtx);
  const bar = panel.querySelector('.rtx-insp-bar');
  const top = bar ? bar.getBoundingClientRect().bottom : b.top;
  const four = (k: string) => ['Top', 'Right', 'Bottom', 'Left'].map((s) => (cs as any)[k.replace('*', s)]).join(' ');
  return { d: [a.left - b.left, b.right - a.right, a.top - top, b.bottom - a.bottom].map((v) => Math.round(v * 10) / 10), bar: !!bar,
    radius: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => (cs as any)[`border${s}Radius`]).join(' '),
    border: four('border*Width'), padding: four('padding*'), margin: four('margin*'), shadow: cs.boxShadow, dark: rtx.classList.contains('dark'),
    line: cs.getPropertyValue('--line').trim(), w: Math.round(a.width), h: Math.round(a.height) };
});
const zero = (v: string) => v.split(' ').every((x) => parseFloat(x) === 0);
const flushOk = (f: Awaited<ReturnType<typeof flushOf>>) => !!f && f.d.every((v: number) => Math.abs(v) <= 1) && zero(f.radius) && zero(f.border) && zero(f.padding) && zero(f.margin) && f.shadow === 'none' && f.w > 0 && f.h > 0;
/** the editor's theme (the View options'), and the public panel following it (its poll reads the page's ground) */
async function theme(name: 'light' | 'dark') {
  await page.evaluate((th: string) => (window as any).editorAPI.view().set({ theme: th }), name);
  await page.waitForFunction((th: string) => document.documentElement.classList.contains('dark') === (th === 'dark'), name);
  await page.waitForFunction((th: string) => { const host = [...document.querySelectorAll('[data-rtx-ui]')].find((e) => (e as any).shadowRoot) as any;
    return host?.shadowRoot?.querySelector('.rtx')?.classList.contains('dark') === (th === 'dark'); }, name);
  await frames();
}
/** the side column's width is a third of the window (the inspector's default), within a few px */
const third = (s: { width: number | null; vw: number }) => s.width != null && Math.abs(s.width - s.vw / 3) <= 4;
/** gone: no public panel on the page, nothing outlined, no bar, not docked in either column */
const gone = (s: Awaited<ReturnType<typeof state>>) => !s.on && !s.host && s.marks === 0 && !s.bar && !s.docked;
const settle = async () => { await ready(); await frames(); await page.waitForFunction(() => ![...document.querySelectorAll('[data-rtx-ui]')].some((e) => (e as any).shadowRoot) || (window as any).editorAPI.inspector().on.peek()); };
/** the blocks the agent lists, by the pane their element is in */
const agentBlocks = () => page.evaluate(() => {
  const a = (window as any).__rtxInspector;
  if (!a) return null;
  const by: Record<string, number> = {};
  for (const b of a.blocks()) { const el = a.elementOf(b.id); const p = el?.closest('[data-pane]')?.dataset.pane ?? 'none'; by[p] = (by[p] ?? 0) + 1; }
  const inPane = (p: string) => [...document.querySelectorAll(`[data-pane="${p}"] .blk-render > .latex-block`)].filter((el) => (window as any).reflowtex.inspect.blocks().includes(el)).length;
  return { by, a: inPane((window as any).P.a), b: inPane((window as any).P.b) };
});
/** outline the first listed block (as hovering its row does), and say where the outlines lie */
const marksWhere = () => page.evaluate(async () => {
  const a = (window as any).__rtxInspector;
  const first = a.blocks()[0];
  a.hover(first.id);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const rect = (p: string) => document.querySelector(`[data-pane="${p}"]`)!.getBoundingClientRect();
  const A = rect((window as any).P.a), B = rect((window as any).P.b);
  // (in a pane's column, by where a mark starts: a label may sit above a block at the pane's top, over the top bar, and
  // a long one, a block's text quoted, may run on past a narrow pane's right edge)
  const hit = (r: DOMRect, q: DOMRect) => r.width > 0 && r.left >= q.left - 1 && r.left < q.right;
  const marks = [...document.querySelectorAll('[data-rtx-inspector] *')].map((d) => d.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const out = { n: marks.length, inA: marks.filter((r) => hit(r, A)).length, inB: marks.filter((r) => hit(r, B)).length,
    rects: marks.map((r) => [r.left, r.top, r.width, r.height].map(Math.round)), A: [A.left, A.top, A.right, A.bottom].map(Math.round) };
  a.hover(null);
  return out;
});
const focusPane = (p: string) => page.evaluate((id: string) => document.querySelector(`[data-pane="${id}"]`)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), p);
/** the advanced switch (editorAPI) and the main menu's View › Inspector row: there, checked (the menu closed again) */
async function viewMenu(): Promise<{ advanced: boolean; inspector: boolean; checked: boolean }> {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="view"]');
  const v = await page.evaluate(() => { const row = document.querySelector('.main-menu [data-action="panel-inspector"]');
    return { advanced: (window as any).editorAPI.advanced(), inspector: !!row, checked: row?.getAttribute('aria-checked') === 'true' }; });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.main-menu'));
  return v;
}
/** the Settings panel's "Show advanced features" switch clicked (the panel opened from the main menu, closed after) */
async function toggleAdvanced() {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  await page.click('[data-panel-view="app-settings"] #set-advanced');
  await page.click('[data-ptab="app-settings"] [data-action="close-panel"]');
  await page.waitForFunction(() => !document.querySelector('[data-panel-view="app-settings"]'));
}
async function blockMenuActions(pane: string, k = 2) {
  const blk = page.locator(`[data-pane="${pane}"] .blocks > .blk`).nth(k);
  await blk.scrollIntoViewIfNeeded();
  await blk.hover();
  await blk.locator('.g-handle').click();
  await page.waitForSelector('.block-menu:not(.doc-menu)');
  return page.evaluate(() => [...document.querySelectorAll('.block-menu .menu-item')].map((x: any) => x.dataset.action));
}
/** Alt+Shift+I pressed in a text field (a keydown dispatched on an input): did the field hear it, was its default prevented */
const keyInField = () => page.evaluate(() => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  let heard = false;
  input.addEventListener('keydown', () => { heard = true; });
  const done = input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ˆ', code: 'KeyI', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  input.remove();
  return { heard, prevented: !done };
});
async function closeMenu() { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.menu')); }

// ── hidden by default ─────────────────────────────────────────────────────────
{
  const v = await viewMenu();
  check('hidden by default: the advanced switch is off and the main menu has no Inspector row', !v.advanced && !v.inspector, v);
  const acts = await blockMenuActions(P.a);
  check('... the block menu has no Inspect item', !acts.includes('inspect'), acts);
  await closeMenu();
  await page.keyboard.press('Alt+Shift+KeyI');
  await frames();
  const s = await state();
  check('... Alt+Shift+I does nothing: the public panel is not even loaded', !s.loaded && gone(s), s);
  const k = await keyInField();
  await frames();
  const s2 = await state();
  check('... Alt+Shift+I in a text field (the inspector cannot show) reaches the field, not prevented (on a Mac: a character)', k.heard && !k.prevented && !s2.on && !s2.loaded, { k, s2 });
  const reg = await page.evaluate(() => (window as any).editorAPI.views().find((x: any) => x.id === 'inspector') ?? null);
  check('... no inspector view registered while it is closed', reg === null, reg);
}

// ── the switch shows it ───────────────────────────────────────────────────────
{
  await toggleAdvanced();
  const v = await viewMenu();
  check('the advanced switch (the Settings panel\'s) shows the main menu\'s Inspector row (unchecked)', v.advanced && v.inspector && !v.checked, v);
}

// ── two panes: it inspects the focused one only, in a side panel on the right ──
await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
await page.waitForFunction((a: string) => Object.keys((window as any).editorAPI.editors()).some((p) => p !== a), P.a);
P.b = await page.evaluate((a: string) => Object.keys((window as any).editorAPI.editors()).find((p) => p !== a), P.a);
await syncP();
await page.waitForSelector(`[data-pane="${P.b}"] .blocks > .blk .blk-render > .latex-block`);
await idle();
await frames();
await focusPane(P.a);
let s0 = await state();
{
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  await idle();
  const s = await state();
  check('Alt+Shift+I opens it as a side panel on the right: the public panel hosted in the right column\'s Inspector view',
    s.open && s.on && s.embedded && s.inView && s.side === 'right' && s.docked === 'right', s);
  check('... its column is a third of the window wide (the view\'s default width), wider than the left column\'s default',
    third(s) && s.width! > 256, { width: s.width, vw: s.vw, third: s.vw / 3 });
  check('... it inspects the focused pane (A): its bar says so', s.target === P.a && s.bar === P.a, s);
  const reg = await page.evaluate(() => (window as any).editorAPI.views().find((x: any) => x.id === 'inspector') ?? null);
  check('... a registered side-panel view (slot sidebar) while it is open', reg?.slot === 'sidebar', reg);
  const b = await agentBlocks();
  check('it lists pane A\'s blocks only (all of them), none of pane B\'s', !!b && b.by[P.a] === b.a && !b.by[P.b] && !b.by.none && b.a > 0 && b.b > 0, b);
  const m = await marksWhere();
  check('its outlines (a block hovered) lie in pane A; pane B has no inspector marks', m.n > 0 && m.inA === m.n && m.inB === 0, m);
  await page.screenshot({ path: join(OUT, '01-pane-a.png') });
  const f = await flushOf();
  check('flush (light, split): the public panel fills its side panel below the pane bar, edge to edge (±1 px), no radius, border, padding, margin or shadow of its own', flushOk(f) && f!.bar, f);
  await theme('dark');
  const fd = await flushOf();
  check('... the same in the dark theme, the panel dark too, its separators the kit\'s', flushOk(fd) && fd!.dark && !!fd!.line && fd!.line !== '#e3e3e3', fd);
  await page.screenshot({ path: join(OUT, '01-pane-a-dark.png') });
  await theme('light');
  s0 = await state();
}
// a block of pane A, from its block menu: the tree shows that block
{
  // a block without a note: on the engine a note's chip repaints when its block is hovered (not the inspector's doing)
  const k = await page.evaluate(() => [...document.querySelectorAll(`[data-pane="${(window as any).P.a}"] .blocks > .blk`)].findIndex((b, i) => i >= 2 && !b.classList.contains('has-todo')));
  const acts = await blockMenuActions(P.a, k);
  check('with the switch on, the block menu has Inspect boxes and glue', acts.includes('inspect'), acts);
  await page.click('.block-menu [data-action="inspect"]');
  await ready();
  const sel = await page.evaluate(() => {
    const host = [...document.querySelectorAll('[data-rtx-ui]')].find((e) => (e as any).shadowRoot) as any;
    return host.shadowRoot.querySelector('[aria-selected="true"], .sel, .selected')?.textContent?.slice(0, 60) ?? null;
  });
  const s = await state();
  check('Inspect boxes and glue opens it on that block, still on pane A, still in its side panel', s.open && s.side === 'right' && s.target === P.a && !!sel, { sel, target: s.target });
}

// ── switching panes moves it ──────────────────────────────────────────────────
{
  await focusPane(P.b);
  await ready();
  await frames();
  const s = await state();
  const b = await agentBlocks();
  check('focusing pane B moves it there: its bar at pane B, pane B\'s blocks only', s.open && s.target === P.b && s.bar === P.b && !!b && b.by[P.b] === b.b && !b.by[P.a], { s, b });
  const m = await marksWhere();
  check('... its outlines now in pane B, none in pane A', m.n > 0 && m.inB === m.n && m.inA === 0, m);
  await page.screenshot({ path: join(OUT, '02-pane-b.png') });
  const labels = await page.$$eval('.rtx-insp-bar [data-pane-pick]', (els: any[]) => els.map((e) => [e.textContent.trim(), e.dataset.panePick]));
  check('its bar names the panes by their place (Focused, Left: pane A, Right: pane B), not by id', JSON.stringify(labels) === JSON.stringify([['Focused', 'focused'], ['Left', P.a], ['Right', P.b]]), labels);
  // picked in its bar: pinned to A, focusing B leaves it on A
  await page.click(`.rtx-insp-bar [data-pane-pick="${P.a}"]`);
  await ready();
  await focusPane(P.b);
  await ready();
  const p = await state();
  check('picked in its bar (Left), it stays on pane A while pane B is focused', p.target === P.a && p.bar === P.a && (await agentBlocks())!.by[P.a] > 0, p);
  await page.click('.rtx-insp-bar [data-pane-pick="focused"]');
  await ready();
  check('... Focused: it follows the focused pane again (B)', (await state()).target === P.b);
  const s2 = await state();
  check('moving between the panes re-broke nothing', s2.paints === s0.paints && s2.widths === s0.widths, { before: s0.paints, after: s2.paints });
}

// ── closing: the shortcut, its tab's close, the advanced switch ───────────────
{
  await page.keyboard.press('Alt+Shift+KeyI');
  await settle();
  const s = await state();
  check('Alt+Shift+I again closes it: no public panel, no outlines, no bar, its view gone from the column', gone(s), s);
  check('... the right column goes with it (it had no other panel)', !(await page.$('aside[data-side="right"]')));
  const v = await viewMenu();
  check('... the main menu\'s Inspector row says off', v.inspector && !v.checked, v);
  // the main menu's View › Inspector opens it
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="view"]');
  await page.click('.main-menu [data-action="panel-inspector"]');
  await page.waitForFunction(() => (window as any).editorAPI.inspector().on.peek());   // (the row opens its view; the inspector follows)
  await ready();
  const t = await state();
  check('the main menu\'s View › Inspector opens it again, on the right, a third wide, on the focused pane', t.on && t.open && t.side === 'right' && third(t) && t.target === P.b, t);
  const vc = await viewMenu();
  check('... its row checked now', vc.inspector && vc.checked, vc);
  // the row again closes it (as its close does), and once more opens it
  for (const want of [false, true]) {
    await page.click('#btn-main-menu');
    await page.click('.main-menu [data-action="view"]');
    await page.click('.main-menu [data-action="panel-inspector"]');
    await page.waitForFunction((w: boolean) => (window as any).editorAPI.inspector().on.peek() === w, want);
    await settle();
    const r = await state();
    check(want ? '... and once more opens it' : 'View › Inspector, checked, closes it', want ? r.on && r.side === 'right' : gone(r), r);
  }
  // closable: its tab's close button
  await page.click('[data-ptab="inspector"] .wb-ptab-close');
  await settle();
  const u = await state();
  check('its tab\'s close button closes it', gone(u), u);
}

// ── moved to the left, resized: the workbench's own rules ─────────────────────
{
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  await page.click('[data-ptab="inspector"]', { button: 'right' });
  await page.click('[data-item="move-left"]');
  await page.waitForFunction(() => (window as any).editorAPI.workbench().sides.peek().left.root && [...document.querySelectorAll('aside[data-side="left"] [data-ptab]')].some((e: any) => e.dataset.ptab === 'inspector'));
  await ready();
  await frames();
  const s = await state();
  const b = await agentBlocks();
  check('moved to the left (its tab\'s menu): hosted in the left column, still inspecting the focused pane', s.on && s.open && s.side === 'left' && s.docked === 'left' && s.target === P.b && !!b && b.by[P.b] === b.b, { s, b });
  check('... the left column takes its default width (a third) while it holds it', third(s), { width: s.width, vw: s.vw });
  await page.keyboard.press('Alt+Shift+KeyI');
  await settle();
  check('... Alt+Shift+I closes it there', gone(await state()));
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  const t = await state();
  check('... and opens it where it was (the left)', t.on && t.side === 'left', t);
  // the user's width: kept as it closes and opens
  await page.evaluate(() => (window as any).editorAPI.workbench().resizeSide('left', 520));
  await frames();
  await page.keyboard.press('Alt+Shift+KeyI');
  await settle();
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  await frames();
  const r = await state();
  check('a width the user gives its column is kept as it closes and opens', r.on && r.side === 'left' && r.width === 520, r);
  await page.click('[data-ptab="inspector"]', { button: 'right' });
  await page.click('[data-item="move-right"]');
  await ready();
  await frames();
  const q = await state();
  check('moved back to the right: a third wide there again (the left keeps the user\'s width)', q.side === 'right' && third(q), q);
}

// ── the advanced switch off while it is open ──────────────────────────────────
{
  // (as the Settings panel's switch does; its own UI path: above)
  await page.evaluate(() => (window as any).editorAPI.advanced(false));
  await settle();
  const w = await state();
  check('the advanced switch off closes it and removes everything', gone(w), w);
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  check('... and the shortcut does nothing again', !(await state()).on);
  // the public panel's script is on the page now (its own listener for the key): in a text field the key is still not
  // prevented, and that listener does not show the panel
  const k = await keyInField();
  await frames();
  const ks = await state();
  check('... Alt+Shift+I in a text field, the panel loaded: not prevented, no panel shown', !k.prevented && ks.loaded && gone(ks), { k, ks });
}

// ── a phone: the side column floats over the documents, and a panel's default width is the whole width ──
{
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
  await phone.addInitScript(() => { try { localStorage.setItem('rtx-editor.advanced', '1'); } catch { /* */ } });
  const p2 = await phone.newPage();
  p2.setDefaultTimeout(120000);
  p2.on('pageerror', (e: any) => problems.push(`phone pageerror: ${e.message}`));
  await p2.goto(`${BASE}?seed=sample&store=memory&engine#/doc/sample`);
  await p2.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await p2.evaluate(() => (window as any).editorAPI.whenIdle());
  await p2.keyboard.press('Alt+Shift+KeyI');
  await p2.evaluate(() => (window as any).editorAPI.inspector().whenReady());
  await p2.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const g = await p2.evaluate(() => { const a = document.querySelector('aside[data-side="right"]') as HTMLElement | null;
    return { on: (window as any).editorAPI.inspector().on.peek(), overlay: !!a?.classList.contains('wb-side--overlay'), w: a ? Math.round(a.getBoundingClientRect().width) : null, vw: document.documentElement.clientWidth }; });
  check('on a phone (390 px) it opens over the documents, the whole width', g.on && g.overlay && g.w === g.vw, g);
  const pf = await flushOf(p2);
  check('... flush there too (one pane: no pane bar): edge to edge in its side panel, no radius, border, padding or margin', flushOk(pf) && !pf!.bar, pf);
  await p2.screenshot({ path: join(OUT, '03-phone.png') });
  await phone.close();
}

check('no page errors', problems.length === 0, problems);
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
