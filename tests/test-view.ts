// The View popover (app/src/view/popover.ts) and its top bar button ("Aa", view/view-button.js), in headless Chromium
// on the dev app (the engine). Written before their Preact migration, run on the old code first, so the migration keeps the
// behaviour. Waits on DOM state and the app's idle, never on fixed times.
//
//   node tests/test-view.ts [http://localhost:8175/]
//
// The button (labelled, aria-haspopup/expanded, at the top bar's right); opening (click, ⌥⌘V) puts the focus
// on the chosen option; the popover under the button, inside the window; every control applies at once and shows
// its state (width segments, the slider, text size, line ends with advanced features on, colours; no switches: the
// Settings panel's); line ends are an advanced setting (off: no row, justified whatever is stored); Esc closes it with
// the focus back on the button, a press outside closes it; light and dark readable; 390 px.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'view');
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
await page.goto(`${BASE}?seed=sample&store=memory&engine#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
// the popover never opened: the document's \textwidth is still read and remembered (the paper column needs it)
{
  const tw = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('rtx-editor.textwidth') || '{}'); } catch { return {}; } });
  check('closed, never opened: the document\'s \\textwidth is remembered once its blocks are typeset', Object.values(tw).some((v: any) => v > 0), tw);
}
await page.evaluate(() => (window as any).editorAPI.view().reset());
await idle();
const settings = () => page.evaluate(() => (window as any).editorAPI.view().settings);
const isOpen = () => page.evaluate(() => { const p = document.getElementById('rtx-view-pop'); return !!p && !p.hidden && p.getBoundingClientRect().width > 0; });
const state = () => page.evaluate(() => {
  const p = document.getElementById('rtx-view-pop')!;
  const checked = (attr: string) => [...p.querySelectorAll(`[role="radio"][${attr}]`)].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.getAttribute(attr));
  const r = p.getBoundingClientRect(), b = document.getElementById('btn-view')!.getBoundingClientRect();
  return { w: checked('data-w'), t: checked('data-t'), a: checked('data-a'), zoom: (p.querySelector('[data-z="0"]') as HTMLElement | null)?.textContent?.trim(),
    range: (p.querySelector('input[type=range]') as HTMLInputElement | null)?.value, out: p.querySelector('output')?.textContent ?? '',
    toggles: [...p.querySelectorAll('input[type=checkbox]')].map((i: any) => ({ label: i.closest('label')?.textContent.trim(), on: i.checked, shown: !i.closest('label')?.hidden })),
    box: { top: r.top, right: r.right, left: r.left, bottom: r.bottom }, btn: { bottom: b.bottom, right: b.right }, focus: document.activeElement?.getAttribute('data-w') ?? document.activeElement?.getAttribute('data-t') ?? document.activeElement?.textContent?.trim() ?? null,
    radios: [...p.querySelectorAll('[role="radio"]')].map((x) => x.textContent!.trim()) };
});

// ── the button ─────────────────────────────────────────────────────────────────
{
  const b = await page.evaluate(() => {
    const el = document.getElementById('btn-view');
    const menu = document.getElementById('btn-main-menu');
    return el && { tag: el.tagName, label: el.getAttribute('aria-label'), popup: el.getAttribute('aria-haspopup'), expanded: el.getAttribute('aria-expanded'), title: el.title,
      inBar: !!el.closest('.wb-bar-right'), h: el.getBoundingClientRect().height, menuH: menu?.getBoundingClientRect().height ?? 0, svg: !!el.querySelector('svg') };
  });
  check('the View button: at the window bar\'s right, labelled, a popup button, an icon, the bar\'s control height (the main menu button\'s)', !!b && b.tag === 'BUTTON' && b.label === 'View options' && b.popup === 'dialog' && b.expanded === 'false'
    && /View: width, text size, colours/.test(b.title) && b.inBar && b.svg && Math.abs(b.h - b.menuH) < 0.5 && b.h >= 24, b);
}
// ── open, close ──────────────────────────────────────────────────────────────
{
  await page.click('#btn-view');
  await page.waitForFunction(() => !document.getElementById('rtx-view-pop')!.hidden);
  const s = await state();
  const exp = await page.getAttribute('#btn-view', 'aria-expanded');
  check('a click opens it: a dialog "View options", the button expanded, the focus on the chosen width', await isOpen() && exp === 'true' && s.focus === (await settings()).width
    && (await page.getAttribute('#rtx-view-pop', 'role')) === 'dialog' && (await page.getAttribute('#rtx-view-pop', 'aria-label')) === 'View options', { s: s.focus, exp });
  // (the button is the bar's last control: right-aligned with it, but kept 8 px inside the window's edge: the kit's place())
  check('under its button, right-aligned with it, inside the window', s.box.top >= s.btn.bottom && s.box.top - s.btn.bottom < 12 && Math.abs(s.box.right - Math.min(s.btn.right, 1280 - 8)) < 2 && s.box.left >= 0, s);
  check('its options: the widths, the colours (no line ends: advanced features are off)', ['Narrow', 'Medium', 'Wide', 'Paper', 'Fit', 'Light', 'Dark'].every((l) => s.radios.some((r) => r.includes(l))) && !s.radios.some((r) => /Justified|Ragged/.test(r)), s.radios);
  await page.screenshot({ path: join(OUT, '01-open.png') });
  await page.keyboard.press('Escape');
  const after = await page.evaluate(() => ({ focus: document.activeElement?.id, exp: document.getElementById('btn-view')!.getAttribute('aria-expanded') }));
  check('Esc closes it, the focus back on the button', !(await isOpen()) && after.focus === 'btn-view' && after.exp === 'false', after);
  await page.keyboard.press('ControlOrMeta+Alt+KeyV');
  const kOpen = await isOpen();
  await page.keyboard.press('ControlOrMeta+Alt+KeyV');
  check('⌥⌘V opens and closes it', kOpen && !(await isOpen()));
  await page.click('#btn-view');
  await page.mouse.click(640, 600);
  check('a press outside closes it', !(await isOpen()));
  await page.click('#btn-view');
  await page.click('#btn-view');
  check('the button again closes it', !(await isOpen()));
}
// ── every control applies at once ──────────────────────────────────────────────
{
  await page.click('#btn-view');
  await page.click('#rtx-view-pop [data-w="narrow"]');
  await idle();
  let s = await state();
  const col = await page.evaluate(() => (window as any).editorAPI.view().measure().columnPx);
  check('width: Narrow applies, its segment checked, the measure shown', (await settings()).width === 'narrow' && s.w.join() === 'narrow' && Math.abs(col - 328) < 2 && /328 px/.test(s.out), { w: s.w, col, out: s.out });
  await page.click('#rtx-view-pop [data-w="medium"]');
  await idle();
  await page.$eval('#rtx-view-pop input[type=range]', (r: any) => { r.value = '600'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await idle();
  s = await state();
  check('the slider: a custom width, no segment checked, the slider at it', (await settings()).width === 'custom' && (await settings()).widthPx === 600 && s.w.length === 0 && s.range === '600', { st: await settings(), w: s.w, range: s.range });
  await page.click('#rtx-view-pop [data-w="medium"]');
  await page.click('#rtx-view-pop [data-z="1"]');
  s = await state();
  const z1 = (await settings()).zoom;
  await page.click('#rtx-view-pop [data-z="0"]');
  const z0 = (await settings()).zoom;
  await page.click('#rtx-view-pop [data-z="-1"]');
  const zm = (await settings()).zoom;
  check('text size: larger, reset, smaller; the percentage shown', z1 > 1 && s.zoom === `${Math.round(z1 * 100)} %` && z0 === 1 && zm < 1, { z1, z0, zm, shown: s.zoom });
  await page.click('#rtx-view-pop [data-z="0"]');
  await page.click('#rtx-view-pop [data-t="sepia"]');
  s = await state();
  check('colours: Sepia applies (the page\'s class), its swatch checked', (await settings()).theme === 'sepia' && s.t.join() === 'sepia' && (await page.evaluate(() => document.documentElement.classList.contains('sepia'))), s.t);
  // the line ends: Justified / Ragged right, an advanced setting (drawn with advanced features on; off, the default,
  // justified, is in force whatever is stored); no switch is here (the Settings panel has the rest)
  check('no switches in the View options (block handles, note chips and the advanced switch are the Settings panel\'s)', s.toggles.length === 0, s.toggles);
  check('advanced features off: no line ends here', s.a.length === 0 && (await page.locator('#rtx-view-pop [data-a]').count()) === 0, s.a);
  await page.evaluate(() => (window as any).editorAPI.advanced(true));
  await page.waitForSelector('#rtx-view-pop [data-a="left"]');
  await page.click('#rtx-view-pop [data-a="left"]');
  s = await state();
  const ragged = await page.evaluate(() => document.documentElement.style.getPropertyValue('--latex-align'));
  check('advanced on: line ends shown; Ragged right applies, checked', (await settings()).align === 'left' && s.a.join() === 'left' && ragged === 'left', { a: s.a, ragged });
  await page.evaluate(() => (window as any).editorAPI.advanced(false));
  await idle();
  const offAlign = await page.evaluate(() => ({ css: document.documentElement.style.getPropertyValue('--latex-align') || 'justify', rows: document.querySelectorAll('#rtx-view-pop [data-a]').length }));
  check('… advanced off again: the row goes, the text is justified, the stored ragged right kept', offAlign.css === 'justify' && offAlign.rows === 0 && (await settings()).align === 'left', offAlign);
  await page.evaluate(() => (window as any).editorAPI.advanced(true));
  await page.waitForSelector('#rtx-view-pop [data-a="justify"]');
  check('… on again: ragged right in force again', await page.evaluate(() => document.documentElement.style.getPropertyValue('--latex-align')) === 'left');
  await page.click('#rtx-view-pop [data-a="justify"]');
  s = await state();
  check('… and Justified again', (await settings()).align === 'justify' && s.a.join() === 'justify');
  await page.evaluate(() => (window as any).editorAPI.advanced(false));
  await page.evaluate(() => (window as any).editorAPI.view().set({ handles: false }));
  await idle();
  const stored = await page.evaluate(() => ({ noHandles: document.documentElement.hasAttribute('data-no-handles') }));
  check('hidden handles apply as they are (an ordinary setting: no advanced switch gates it)', stored.noHandles, stored);
  await page.evaluate(() => (window as any).editorAPI.view().set({ handles: true }));
  await idle();
  check('the popover stays open while its controls are used', await isOpen());
  await page.keyboard.press('Escape');
}
// ── light and dark; 390 px ─────────────────────────────────────────────────────
{
  const measure = () => page.evaluate(() => {
    const cv = document.createElement('canvas').getContext('2d')!;
    const rgba = (c: string) => { const sr = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/); if (sr) return [+sr[1] * 255, +sr[2] * 255, +sr[3] * 255, sr[4] == null ? 1 : +sr[4]];
      cv.fillStyle = '#000'; cv.fillStyle = c; const v = cv.fillStyle as string; if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
      const m = v.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const over = (t: number[], u: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    const painted = (el: Element | null) => { const st: number[][] = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) st.push(c); if (c[3] >= 1) break; } let a = [255, 255, 255, 1]; for (const c of st.reverse()) a = over(c, a); return a; };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const p = document.getElementById('rtx-view-pop')!;
    const worst = (sel: string) => Math.min(...[...p.querySelectorAll(sel)].filter((x) => (x as HTMLElement).offsetParent && x.textContent!.trim()).map((x) => ratio(over(rgba(getComputedStyle(x).color), painted(x)), painted(x))));
    return { lBg: Math.round(lum(painted(p)) * 1000) / 1000, lPage: Math.round(lum(painted(document.body)) * 1000) / 1000,
      caps: Math.round(worst('p span, output') * 10) / 10, buttons: Math.round(worst('[role="radio"]:not([data-t]), [data-z="0"]') * 10) / 10, labels: Math.round(worst('label span') * 10) / 10, keys: Math.round(worst('div:last-child') * 10) / 10 };
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await page.waitForFunction((t: string) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme);
    await page.click('#btn-view');
    const m = await measure();
    await page.locator('#rtx-view-pop').screenshot({ path: join(OUT, `02-${theme}.png`) });
    check(`${theme}: the popover is a surface of the theme, its text readable (4.5:1)`, (theme === 'dark' ? m.lBg <= m.lPage + 0.06 : m.lBg > 0.8) && m.caps >= 4.5 && m.buttons >= 4.5 && m.labels >= 4.5 && m.keys >= 4.5, m);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#btn-view');
  const s = await state();
  check('390 px: inside the window', s.box.left >= 0 && s.box.right <= 390, s.box);
  await page.screenshot({ path: join(OUT, '03-phone.png') });
  await page.keyboard.press('Escape');
}

check('no console errors or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nview: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
