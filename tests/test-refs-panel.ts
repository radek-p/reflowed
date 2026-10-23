// The References pane's content (bibpane/view.js, style.js): its layout at a side column's widths (240, 300,
// 420 px) in the four themes, on the tests' biblatex document (tests/qa/fixtures/biblatex-doc.ts: 10 entries, alphabetic). Checks: the years form one
// column (equal x within 0.5 px at each width), rows meet the minimum height and padding, the keyboard moves the
// active row and the focus ring shows, ↓ moves between the ⋯ menu's items. Screenshots: test-results/refs-panel/<prefix>-<theme>-<width>.png.
// Waits on the app's idle and DOM state, never on fixed times.
//
//   node tests/test-refs-panel.ts [http://localhost:8160/] [--shots=after] [--no-checks]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { openBiblatexDoc } from './qa/fixtures/biblatex-doc.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'refs-panel');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = (argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8160/').replace(/\/?$/, '/');
const SHOTS = argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? '';
const CHECKS = !argv.includes('--no-checks');
const WIDTHS = [240, 300, 420];
const THEMES = ['light', 'dark', 'sepia', 'contrast'];
// the minimums this design keeps (style.js): a row at least 48 px tall, 10 px of padding above and below, 8 at the sides, 4 px between rows
const MIN_ROW_H = 48, MIN_PAD_Y = 10, MIN_PAD_X = 8, MIN_ROW_GAP = 4;

type R = { name: string; ok: boolean; detail?: string };
const results: R[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
page.setDefaultTimeout(300000);
const problems: string[] = [];
page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`));
await page.goto(`${BASE}?store=memory&engine#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.());
await openBiblatexDoc(page);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
await page.evaluate(() => (window as any).editorAPI.bibpane().show());
await page.locator('#panel-references .bp-row').first().waitFor();
await page.evaluate(() => (window as any).editorAPI.bibpane().idle());

const setWidth = (w: number) => page.evaluate((px: number) => document.documentElement.style.setProperty('--sidebar-w', `${px}px`), w);
const setTheme = (t: string) => page.evaluate((name: string) => {
  document.documentElement.classList.remove('dark', 'sepia', 'contrast');
  if (name !== 'light') document.documentElement.classList.add(name);
}, t);
const frames = (n = 2) => page.evaluate((k: number) => new Promise<void>((res) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : res()); f(k); }), n);
const shot = (name: string) => page.locator('.sidebar').screenshot({ path: join(OUT, `${name}.png`) });

// ── screenshots ──
if (SHOTS) {
  const themes = SHOTS === 'before' ? ['light', 'dark'] : THEMES;
  for (const t of themes) {
    await setTheme(t);
    for (const w of WIDTHS) { await setWidth(w); await frames(); await shot(`${SHOTS}-${t}-${w}`); }
  }
  // states (light, 300 px): hover, the keyboard's active row with the focus ring, an open entry, search, empty search
  if (SHOTS !== 'before') {
    await setTheme('light'); await setWidth(300); await frames();
    const rows = page.locator('#panel-references .bp-row');
    await rows.nth(2).hover(); await frames(); await shot(`${SHOTS}-state-hover`);
    await page.focus('#panel-references .bp-search input');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await frames(); await shot(`${SHOTS}-state-keyboard`);
    await page.keyboard.press('Escape');
    await rows.nth(1).click(); await frames(); await shot(`${SHOTS}-state-open`);
    await rows.nth(1).click();
    await page.fill('#panel-references .bp-search input', 'twin-width'); await frames(); await shot(`${SHOTS}-state-search`);
    await page.fill('#panel-references .bp-search input', 'zzzz'); await frames(); await shot(`${SHOTS}-state-empty`);
    await page.fill('#panel-references .bp-search input', '');
    for (const t of ['dark', 'contrast']) {
      await setTheme(t); await page.focus('#panel-references .bp-search input');
      await page.keyboard.press('ArrowDown'); await frames(); await shot(`${SHOTS}-state-keyboard-${t}`);
      await page.keyboard.press('Escape');
    }
    await page.mouse.move(900, 400);
    await setTheme('light');
  }
}

// ── checks ──
if (CHECKS) {
  await setTheme('light');
  for (const w of WIDTHS) {
    await setWidth(w); await frames();
    const m = await page.evaluate(() => [...document.querySelectorAll('#panel-references .bp-row')].map((r) => {
      const y = r.querySelector('.bp-year') as HTMLElement | null, cs = getComputedStyle(r), b = r.getBoundingClientRect();
      const yr = y?.getBoundingClientRect();
      return { key: (r as HTMLElement).dataset.key, yearRight: yr ? yr.right : null, yearLeft: yr ? yr.left : null, yearText: y?.textContent ?? '',
        h: b.height, top: b.top, bottom: b.bottom, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom), pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight),
        sw: r.scrollWidth, cw: r.clientWidth };
    }));
    const rights = m.map((r) => r.yearRight).filter((x): x is number => x !== null);
    const lefts = m.map((r) => r.yearLeft).filter((x): x is number => x !== null);
    check(`${w} px: every row has a year cell`, rights.length === m.length && m.length >= 10, `${rights.length}/${m.length}`);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    check(`${w} px: the years' columns line up (left and right edges within 0.5 px)`, spread(rights) <= 0.5 && spread(lefts) <= 0.5,
      { right: spread(rights).toFixed(2), left: spread(lefts).toFixed(2), sample: m.slice(0, 4).map((r) => [r.key, r.yearText, r.yearLeft?.toFixed(1)]) });
    const small = m.filter((r) => r.h < MIN_ROW_H || r.pt < MIN_PAD_Y || r.pb < MIN_PAD_Y || r.pl < MIN_PAD_X || r.pr < MIN_PAD_X);
    check(`${w} px: rows at least ${MIN_ROW_H} px tall, padding ≥ ${MIN_PAD_Y} px`, small.length === 0, small.slice(0, 3));
    const gaps = m.slice(1).map((r, i) => r.top - m[i].bottom);
    check(`${w} px: at least ${MIN_ROW_GAP} px between rows`, gaps.every((g) => g >= MIN_ROW_GAP - 0.5), { min: Math.min(...gaps).toFixed(2) });
    const wide = m.filter((r) => r.sw > r.cw + 1);
    check(`${w} px: no row overflows sideways`, wide.length === 0, wide.slice(0, 3).map((r) => r.key));
  }
  // a year that is not four digits (in press, missing) keeps the column: the cell's box is the same width
  const odd = await page.evaluate(() => {
    const list = document.querySelector('#panel-references .bp-list')!;
    const row = list.querySelector('.bp-row')!;
    const clone = row.cloneNode(true) as HTMLElement, clone2 = row.cloneNode(true) as HTMLElement;
    clone.querySelector('.bp-year')!.textContent = 'in press'; clone2.querySelector('.bp-year')!.textContent = '';
    list.append(clone, clone2);
    const r = [row, clone, clone2].map((x) => { const b = x.querySelector('.bp-year')!.getBoundingClientRect(); return [b.left, b.right]; });
    clone.remove(); clone2.remove();
    return r;
  });
  check('"in press" and a missing year keep the column', odd.every(([l, r]) => Math.abs(l - odd[0][0]) <= 0.5 && Math.abs(r - odd[0][1]) <= 0.5), odd);

  // keyboard: ↓ from the search moves the active row (aria-activedescendant), the row shows the ring
  await setWidth(300); await frames();
  await page.fill('#panel-references .bp-search input', 'x');     // a query clears the active row: a known start
  await page.fill('#panel-references .bp-search input', '');
  await page.focus('#panel-references .bp-search input');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const kb = await page.evaluate(() => {
    const inp = document.querySelector('#panel-references .bp-search input')!;
    const id = inp.getAttribute('aria-activedescendant') ?? '';
    const row = id ? document.getElementById(id) : null;
    const rows = [...document.querySelectorAll('#panel-references .bp-row')];
    const cs = row ? getComputedStyle(row) : null;
    return { id, index: row ? rows.indexOf(row) : -1, active: row?.classList.contains('active') ?? false, outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : '', shadow: cs?.boxShadow ?? '' };
  });
  check('↓↓ from the search: the second row is active (aria-activedescendant)', kb.index === 1 && kb.active, kb);
  check('the active row shows a solid 2 px ring', /solid 2px/.test(kb.outline) || /0px 0px 0px 2px/.test(kb.shadow), kb);
  await page.keyboard.press('ArrowUp');
  const up = await page.evaluate(() => { const id = document.querySelector('#panel-references .bp-search input')!.getAttribute('aria-activedescendant') ?? ''; return [...document.querySelectorAll('#panel-references .bp-row')].findIndex((r) => r.id === id); });
  check('↑ moves back to the first row', up === 0, up);
  // the list focused (a click on a row puts the focus there): ↓ moves the active row and the focus stays in the list
  // (it went to the document: the page's ↓ moved the block selection too); the ring shows once the keyboard is used
  await page.keyboard.press('Escape');
  await page.focus('#panel-references .bp-list');
  const listState = () => page.evaluate(() => {
    const row = document.querySelector('#panel-references .bp-row.active') as HTMLElement | null;
    const cs = row ? getComputedStyle(row) : null;
    return { index: row ? [...document.querySelectorAll('#panel-references .bp-row')].indexOf(row) : -1, outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : '',
      focus: document.activeElement?.classList.contains('bp-list') ?? false };
  });
  const l0 = await listState();
  await page.keyboard.press('ArrowDown');
  const l1 = await listState();
  await page.keyboard.press('ArrowDown');
  const l2 = await listState();
  check('list focused, ↓↓: the active row moves by one each time, the focus stays in the list', l1.focus && l2.focus && l1.index === l0.index + 1 && l2.index === l1.index + 1, { l0, l1, l2 });
  check('list focused: the active row shows the solid ring', /solid 2px/.test(l2.outline), l2);
  await page.keyboard.press('Escape');
  // a paste of BibTeX in the pane opens one Add dialog (the pane was mounted twice: two listeners, two dialogs)
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', '@article{q, title={T}, year={2025}}');
    document.querySelector('#panel-references .bp-list')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.locator('dialog.bp-dialog[open]').first().waitFor();
  check('a paste opens one Add dialog', (await page.locator('dialog.bp-dialog[open]').count()) === 1, await page.locator('dialog.bp-dialog[open]').count());
  await page.keyboard.press('Escape');
  // the ⋯ menu is the kit's Menu: ↓ moves the focus from item to item, Esc closes it and gives the focus back
  await page.click('#panel-references .bp-morebtn');
  await page.locator('.bp-menu [role="menu"] .ui-menu-item').first().waitFor();
  // the popover moves the focus in its effect, after the first paint: wait for that (or for the check to fail on it)
  await page.waitForFunction(() => !!document.activeElement?.closest('.bp-menu'), null, { timeout: 5000 }).catch(() => {});
  const focused = () => page.evaluate(() => {
    const items = [...document.querySelectorAll('.bp-menu [role="menu"] .ui-menu-item:not(:disabled)')];
    const a = document.activeElement;
    return { index: items.indexOf(a as Element), n: items.length, active: a ? `${a.tagName.toLowerCase()}.${[...a.classList].join('.')}` : null };
  });
  const m0 = await focused();
  await page.keyboard.press('ArrowDown');
  const m1 = await focused();
  check('⋯ menu: opens on its first item, ↓ moves the focus to the next', m0.n >= 2 && m0.index === 0 && m1.index === 1, { m0, m1 });
  await page.keyboard.press('Escape');
  check('⋯ menu: Esc closes it, the focus is back on its button', (await page.locator('.bp-menu').count()) === 0
    && await page.evaluate(() => document.activeElement?.classList.contains('bp-morebtn') ?? false));
  check('no page errors', problems.length === 0, problems.slice(0, 3));
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, problems }, null, 1));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} ok`);
process.exit(failed ? 1 : 0);
