// the public Reflow TeX inspector inside ReflowEd, on ONE pane (app/src/inspector/), in headless Chromium on the
// dev app (the engine; the sample document). Waits on editorAPI.whenIdle(), inspector.whenReady() and DOM state,
// never on fixed times.
//
//   node tests/test-inspector.ts [http://localhost:8156/]       (a dev server: tests/integration/serve.ts)
//
// Hidden by default (no control, no menu item, the shortcut does nothing and goes on to a text field unprevented,
// nothing loaded); the advanced switch shows its control; with two panes it inspects pane A only (its blocks, its
// outlines; pane B has no marks); focusing pane B moves it, picking a pane in its bar pins it; its own close and the
// advanced switch turn it off and remove everything (the key then still goes on to a text field unprevented); no
// block is re-broken by any of it (the viewer's paint counter and the blocks' widths stay).
// Results: test-results/inspector/results.json.
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

/** what is on the page of the inspector: its panel, its outline layer, its bar, the viewer's paint count, the blocks' widths */
const state = () => page.evaluate(() => {
  const host = [...document.documentElement.children].find((e) => e.hasAttribute('data-rtx-ui') && (e as any).shadowRoot) as any;
  const panel = host?.shadowRoot?.querySelector('.rtx') as HTMLElement | undefined;
  const layer = document.querySelector('[data-rtx-inspector]');
  const bar = document.querySelector('.rtx-insp-bar') as HTMLElement | null;
  const widths = [...document.querySelectorAll('[data-pane] .blk-render > .latex-block')].map((el) => Math.round((el as HTMLElement).getBoundingClientRect().width)).join(',');
  return { host: !!host, open: !!panel && !panel.hidden, layer: !!layer, marks: layer?.childElementCount ?? 0, bar: bar?.dataset.paneOf ?? null,
    loaded: !!(window as any).reflowtex?.inspector, paints: (window as any).reflowtex.inspect.paints, widths,
    on: (window as any).editorAPI.inspector().on.peek(), target: (window as any).editorAPI.inspector().target.peek() };
});
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
  // (in a pane's column: a label may sit above a block at the pane's top, over the top bar)
  const hit = (r: DOMRect, q: DOMRect) => r.width > 0 && r.left < q.right && r.right > q.left;
  const marks = [...document.querySelectorAll('[data-rtx-inspector] *')].map((d) => d.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const out = { n: marks.length, inA: marks.filter((r) => hit(r, A)).length, inB: marks.filter((r) => hit(r, B)).length,
    rects: marks.map((r) => [r.left, r.top, r.width, r.height].map(Math.round)), A: [A.left, A.top, A.right, A.bottom].map(Math.round) };
  a.hover(null);
  return out;
});
const focusPane = (p: string) => page.evaluate((id: string) => document.querySelector(`[data-pane="${id}"]`)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), p);
async function viewPopover(): Promise<{ advanced: boolean; inspector: boolean; checked: boolean }> {
  if (!(await page.$('#rtx-view-pop:not([hidden])'))) await page.click('#btn-view');
  await page.waitForSelector('#rtx-view-pop:not([hidden])');
  return page.evaluate(() => ({ advanced: (document.getElementById('rtx-vp-advanced') as HTMLInputElement).checked,
    inspector: !!document.getElementById('rtx-vp-inspector'), checked: !!(document.getElementById('rtx-vp-inspector') as HTMLInputElement | null)?.checked }));
}
async function closePopover() {
  if (await page.$('#rtx-view-pop:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForSelector('#rtx-view-pop[hidden]', { state: 'attached' }); }
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
  const v = await viewPopover();
  check('hidden by default: the advanced switch is off and the View options have no Inspector control', !v.advanced && !v.inspector, v);
  await closePopover();
  const acts = await blockMenuActions(P.a);
  check('... the block menu has no Inspect item', !acts.includes('inspect'), acts);
  await closeMenu();
  await page.keyboard.press('Alt+Shift+KeyI');
  await frames();
  const s = await state();
  check('... Alt+Shift+I does nothing: the public panel is not even loaded', !s.loaded && !s.host && !s.layer && !s.bar && !s.on, s);
  const k = await keyInField();
  await frames();
  const s2 = await state();
  check('... Alt+Shift+I in a text field (the inspector cannot show) reaches the field, not prevented (on a Mac: a character)', k.heard && !k.prevented && !s2.on && !s2.loaded, { k, s2 });
  const reg = await page.evaluate(() => (window as any).editorAPI.views().find((x: any) => x.id === 'inspector'));
  check('it is a registered view: id inspector, its own container slot', reg?.slot === 'pane-corner', reg);
}

// ── the switch shows it ───────────────────────────────────────────────────────
{
  await viewPopover();
  await page.click('#rtx-vp-advanced');
  const v = await viewPopover();
  check('the advanced switch shows the Inspector control (unchecked)', v.advanced && v.inspector && !v.checked, v);
  await closePopover();
}

// ── two panes: it inspects pane A only ────────────────────────────────────────
await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
await page.waitForFunction((a: string) => Object.keys((window as any).editorAPI.editors()).some((p) => p !== a), P.a);
P.b = await page.evaluate((a: string) => Object.keys((window as any).editorAPI.editors()).find((p) => p !== a), P.a);
await syncP();
await page.waitForSelector(`[data-pane="${P.b}"] .blocks > .blk .blk-render > .latex-block`);
await idle();
await frames();
await focusPane(P.a);
const s0 = await state();
{
  await viewPopover();
  await page.click('#rtx-vp-inspector');
  await ready();
  await closePopover();
  await idle();
  const s = await state();
  check('the control opens it, on the focused pane (A): the panel open, its bar at pane A', s.open && s.on && s.target === P.a && s.bar === P.a, s);
  const b = await agentBlocks();
  check('it lists pane A\'s blocks only (all of them), none of pane B\'s', !!b && b.by[P.a] === b.a && !b.by[P.b] && !b.by.none && b.a > 0 && b.b > 0, b);
  const m = await marksWhere();
  check('its outlines (a block hovered) lie in pane A; pane B has no inspector marks', m.n > 0 && m.inA === m.n && m.inB === 0, m);
  check('opening it re-broke nothing (the viewer\'s paints and the blocks\' widths unchanged)', s.paints === s0.paints && s.widths === s0.widths, { before: s0.paints, after: s.paints });
  await page.screenshot({ path: join(OUT, '01-pane-a.png') });
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
    const host = [...document.documentElement.children].find((e) => e.hasAttribute('data-rtx-ui') && (e as any).shadowRoot) as any;
    return host.shadowRoot.querySelector('[aria-selected="true"], .sel, .selected')?.textContent?.slice(0, 60) ?? null;
  });
  const s = await state();
  check('Inspect boxes and glue opens it on that block, still on pane A', s.open && s.target === P.a && !!sel, { sel, target: s.target });
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

// ── turning it off removes everything ─────────────────────────────────────────
{
  await page.click('.rtx-insp-bar .rtx-insp-close');
  await ready();
  await frames();
  const s = await state();
  check('its bar\'s close turns it off: no panel, no outline layer, no bar', !s.on && !s.host && !s.layer && !s.bar, s);
  const v = await viewPopover();
  check('... the View control says off', v.inspector && !v.checked, v);
  await closePopover();
  check('turning it off re-broke nothing', s.paints === s0.paints && s.widths === s0.widths, { before: s0.paints, after: s.paints });
  // the shortcut: on, then the panel's own close (Esc in it) turns it off here too
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  const t = await state();
  check('Alt+Shift+I (switch on) opens it on the focused pane', t.on && t.open && t.target === P.b, t);
  await page.evaluate(() => {
    const host = [...document.documentElement.children].find((e) => e.hasAttribute('data-rtx-ui') && (e as any).shadowRoot) as any;
    host.shadowRoot.querySelector('.close').click();
  });
  await page.waitForFunction(() => !(window as any).editorAPI.inspector().on.peek());
  await ready();
  const u = await state();
  check('the panel\'s own close turns it off and removes everything', !u.on && !u.host && !u.layer && !u.bar, u);
  // the advanced switch off while it is open
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  await viewPopover();
  // (the floating panel is above every layer of the page, the popover too: a click through the DOM)
  await page.evaluate(() => { document.getElementById('rtx-vp-advanced')!.click(); });
  await closePopover();
  await ready();
  await frames();
  const w = await state();
  check('the advanced switch off turns it off and removes everything', !w.on && !w.host && !w.layer && !w.bar, w);
  await page.keyboard.press('Alt+Shift+KeyI');
  await ready();
  check('... and the shortcut does nothing again', !(await state()).on);
  // the public panel's script is on the page now (its own listener for the key): in a text field the key is still not
  // prevented, and that listener does not open the panel on the whole page
  const k = await keyInField();
  await frames();
  const ks = await state();
  check('... Alt+Shift+I in a text field, the panel loaded: not prevented, no panel opened', !k.prevented && ks.loaded && !ks.on && !ks.host && !ks.open, { k, ks });
  const z = await state();
  check('no re-break at any toggle (paints and widths as before the first)', z.paints === s0.paints && z.widths === s0.widths, { before: s0.paints, after: z.paints });
}

check('no page errors', problems.length === 0, problems);
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
