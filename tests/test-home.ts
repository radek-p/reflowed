// The Documents view (home/) in the dev app, after its Preact migration: on the kit and its tokens in light
// the drop target, touch and phone widths, and the route in and out. Another test drives the same screen's
// actions in its harness (create, import, rename, duplicate, search, delete, export, versions, seeds).
// Waits on events, the DOM and editorAPI.homeIdle(), never on fixed times.
//
//   node tests/test-home.ts [http://localhost:8150/]        (the dev app: tests/integration/serve.ts)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'home');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8150/';
const SHOTS = !process.argv.includes('--no-shots');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 300)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
async function open({ theme = 'light', width = 1100, height = 820, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((t: string) => { try { localStorage.setItem('rtx-editor.view', JSON.stringify({ theme: t })); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}?seed=sample&backend=none&store=memory#/`);
  await page.waitForSelector('.wb-home .rh-row[data-doc-id]');
  await page.evaluate(() => (window as any).editorAPI.homeIdle());
  return { ctx, page };
}
/** a menu is up once it has the focus (the kit's Popover takes it after its first paint) */
const menuUp = (page: any) => page.waitForFunction(() => !!document.activeElement?.closest('.rh-pop'));
const homeIdle = (page: any) => page.evaluate(() => (window as any).editorAPI.homeIdle());
const shot = async (page: any, name: string) => { if (SHOTS) await page.screenshot({ path: join(OUT, `${name}.png`) }); };
const active = (page: any) => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? (a.dataset.action ?? a.className) : null; });

/** colours as the page resolves them: an element's own, and the token's value on a probe */
const colours = (page: any) => page.evaluate(() => {
  const probe = (prop: string, v: string) => { const e = document.createElement('span'); e.style.setProperty(prop, v); document.body.append(e); const c = getComputedStyle(e).getPropertyValue(prop); e.remove(); return c; };
  const cs = (s: string, p: string) => { const e = document.querySelector(s); return e ? getComputedStyle(e).getPropertyValue(p) : null; };
  return {
    ink: probe('color', 'var(--ui-ink)'), ink3: probe('color', 'var(--ui-ink-3)'), page: probe('background-color', 'var(--ui-page)'), surface: probe('background-color', 'var(--ui-surface)'),
    h1: cs('.rh-head h1', 'color'), title: cs('.rh-row .rh-title', 'color'), sub: cs('.rh-row .rh-sub', 'color'), body: getComputedStyle(document.body).backgroundColor,
    status: cs('.rh-status', 'color'), foot: cs('.home-foot', 'color'), search: cs('input[data-action=search]', 'color'),
  };
});
const lum = (c: string) => {
  const m = c.match(/[\d.]+/g)!.map(Number);
  const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
};
/** an opaque light ground (a white box on the dark page)? a mostly transparent tint is not */
const lightBox = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return (m.length < 4 || m[3] > 0.2) && lum(c) > 0.2; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── light: the kit, the footer, menus, keyboard ───────────────────────────────
{
  const { ctx, page } = await open();
  await shot(page, '01-light');
  const c = await colours(page);
  check('light: text from the tokens (h1, titles, the search: --ui-ink; the status and the footer: --ui-ink-3)',
    c.h1 === c.ink && c.title === c.ink && c.search === c.ink && c.status === c.ink3 && c.foot === c.ink3, c);
  check('light: titles readable (contrast ≥ 7 on the page)', contrast(c.title!, c.body) >= 7, contrast(c.title!, c.body).toFixed(1));

  // the footer: the build's version, About, Reset local data… (the release's and the dev server's, one button)
  const foot = await page.evaluate(() => {
    const f = document.querySelector('.wb-home .home-foot') as HTMLElement | null;
    const pill = f?.querySelector('.rtx-preview-pill') as HTMLElement | null;
    const reset = f?.querySelector('#reset-local') as HTMLButtonElement | null;
    return { inView: !!f, pill: pill?.textContent, about: [...(f?.querySelectorAll('[data-about]') ?? [])].length, reset: reset?.textContent ?? null, dev: !!f?.querySelector('#dev-reset'),
      resetKit: !!reset?.matches('.ui-btn.ui-btn--ghost.ui-btn--sm'), staticFoot: document.querySelectorAll('.home-foot').length,
      below: !!f && f.getBoundingClientRect().top >= (document.querySelector('.rh-list') as HTMLElement).getBoundingClientRect().bottom };
  });
  check('footer: in the Documents view, below the list; the preview pill shows the build ("Preview · dev"); About · Licence; one footer only',
    foot.inView && foot.below && foot.pill === 'Preview · dev' && foot.about === 2 && foot.staticFoot === 1, foot);
  check('footer: Reset local data…, a kit ghost button (no separate dev link)', foot.reset === 'Reset local data…' && foot.resetKit && !foot.dev, foot);
  await page.click('.home-foot .rtx-preview-pill');
  await page.waitForSelector('#rtx-about[open]');
  const build = await page.locator('#rtx-about .rtx-about-build').textContent();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('rtx-about'));
  check('footer: the pill opens About (its build line "Build: dev"); Esc closes it', build === 'Build: dev', build);
  // About offers Reset local data… too: it closes About and opens the same reset dialog (Cancel leaves everything)
  await page.click('.home-foot .rtx-preview-pill');
  await page.waitForSelector('#rtx-about[open] #about-reset-local');
  await page.click('#about-reset-local');
  await page.waitForSelector('#rtx-reset-local[open]');
  await page.waitForFunction(() => !document.getElementById('rtx-about'));
  const ar = await page.evaluate(() => ({ about: !!document.getElementById('rtx-about'), rows: document.querySelectorAll('.rh-row[data-doc-id]').length }));
  await page.click('#rtx-reset-local [data-action=cancel]');
  await page.waitForFunction(() => !document.querySelector('#rtx-reset-local[open]'));
  const after = await page.evaluate(() => document.querySelectorAll('.rh-row[data-doc-id]').length);
  check('About: Reset local data… closes About and opens the reset dialog; Cancel keeps every document', !ar.about && ar.rows > 0 && after === ar.rows, { ...ar, after });

  // the New menu and a row's menu: the kit's, keyboard, Esc gives the focus back
  await page.click('[data-action=new]');
  await menuUp(page);
  const nm = await page.evaluate(() => { const p = document.querySelector('.rh-pop') as HTMLElement; return { kit: p.matches('.ui-popover.ui-menu'), shadow: getComputedStyle(p).boxShadow !== 'none',
    bg: getComputedStyle(p).backgroundColor, rows: [...p.querySelectorAll('.ui-menu-item')].map((e) => Math.round(e.getBoundingClientRect().height)) }; });
  await shot(page, '02-new-menu');
  check('New: a kit menu (surface, pop shadow), items at least 28 px', nm.kit && nm.shadow && nm.bg === c.surface && nm.rows.every((h: number) => h >= 28), nm);
  await page.keyboard.press('End');
  const end = await active(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.rh-pop'));
  check('New: End to the last item (Import a file…), Esc closes, the focus back on New', end === 'import-file' && await active(page) === 'new', { end });
  const row = page.locator('.rh-row[data-doc-id]').first();
  await row.hover();
  await row.locator('[data-action=more]').click();
  await menuUp(page);
  const acts = await page.$$eval('.rh-pop .ui-menu-item', (es: any[]) => es.map((e) => e.dataset.action));
  const del = await page.$eval('.rh-pop [data-action=delete]', (e: any) => e.className);
  check('a row\'s ⋯: Open, Rename, Duplicate, Export .zip / .tex, Versions, (Reset to original), Delete (danger)',
    ['open', 'rename', 'duplicate', 'export-zip', 'export-tex', 'versions', 'delete'].every((a) => acts.includes(a)) && /ui-menu-item--danger/.test(del), acts);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => !document.querySelector('.rh-pop'));
  check('a press outside closes the menu', true);
  // the same ⋯ again: a second click closes it
  await row.hover();
  await row.locator('[data-action=more]').click();
  await page.waitForSelector('.rh-pop');
  await row.locator('[data-action=more]').click();
  await page.waitForFunction(() => !document.querySelector('.rh-pop'));
  check('the ⋯ toggles its menu', true);

  // search and keyboard
  await page.locator('body').press('/');
  check('/ focuses the search', await active(page) === 'search');
  await page.keyboard.type('zzqx no such');
  await page.waitForFunction(() => !(document.querySelector('.rh-empty') as HTMLElement).hidden);
  await homeIdle(page);
  const empty = await page.locator('.rh-empty').textContent();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rh-row[data-doc-id]');
  check('search: Nothing found; Esc clears it, the list is back', /Nothing found/.test(empty ?? '') && await page.locator('input[data-action=search]').inputValue() === '', empty);
  await page.keyboard.press('ArrowDown');
  const firstId = await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-doc-id'));
  check('↓ from the search: the first row', !!firstId);

  // delete with the keyboard, then Undo
  const n0 = await page.locator('.rh-row[data-doc-id]').count();
  await page.keyboard.press('Delete');
  await page.waitForSelector('.rh-toast.ui-toast');
  await homeIdle(page);
  const n1 = await page.locator('.rh-row[data-doc-id]').count();
  await shot(page, '03-delete-toast');
  await page.click('.rh-toast [data-action=undo]');
  await page.waitForFunction((n: number) => document.querySelectorAll('.rh-row[data-doc-id]').length === n, n0);
  await homeIdle(page);
  const back = await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-doc-id'));
  check('Delete key: the row goes, the kit toast with Undo; Undo brings it back focused', n1 === n0 - 1 && back === firstId, { n0, n1, back });

  // the drop target
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.tex')); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  const drop = await page.evaluate(() => { const d = document.querySelector('.rh-drop') as HTMLElement; return { on: !!document.querySelector('.rh.dragging'), shown: getComputedStyle(d).display !== 'none', radius: getComputedStyle(d).borderRadius }; });
  await shot(page, '04-drop');
  await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { bubbles: true })));
  const off = await page.evaluate(() => !document.querySelector('.rh.dragging'));
  check('dragging files over the window shows the drop target (radius 12); leaving hides it', drop.on && drop.shown && drop.radius === '12px' && off, drop);

  // in and out of a document: the footer and the dev link only on the Documents view
  await page.locator('.rh-row[data-doc-id]').first().click();
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  const inDoc = await page.evaluate(() => ({ foot: document.querySelectorAll('.home-foot').length, reset: !!document.getElementById('reset-local'), list: !!document.querySelector('.rh') }));
  // what the release build's acceptance does (scripts/build.ts, licence): two frames after #/ the pill is shown
  const pillSoon = await page.evaluate(async () => {
    location.hash = '#/';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const p = document.querySelector('.home-foot .rtx-preview-pill') as HTMLElement | null;
    return !!p && p.offsetParent !== null && getComputedStyle(p).visibility !== 'hidden';
  });
  check('route: two frames after #/ the footer\'s pill is shown (the build acceptance\'s check)', pillSoon);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.wb-home .home-foot #reset-local');
  check('route: in a document no home, footer or Reset local data…; back home they are there again', !inDoc.foot && !inDoc.reset && !inDoc.list, inDoc);
  await ctx.close();
}

// ── dark: the same screen follows the theme ───────────────────────────────────
{
  const { ctx, page } = await open({ theme: 'dark' });
  await shot(page, '05-dark');
  const c = await colours(page);
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check('dark: the page is dark, text from the tokens', dark && lum(c.body) < 0.05 && c.h1 === c.ink && c.title === c.ink && c.search === c.ink && c.foot === c.ink3, c);
  check('dark: titles readable (contrast ≥ 7), secondary lines ≥ 3', contrast(c.title!, c.body) >= 7 && contrast(c.sub!, c.body) >= 3,
    { title: contrast(c.title!, c.body).toFixed(1), sub: contrast(c.sub!, c.body).toFixed(1) });
  await page.click('[data-action=new]');
  await page.waitForSelector('.rh-pop');
  const bg = await page.$eval('.rh-pop', (e: any) => getComputedStyle(e).backgroundColor);
  const field = await page.$eval('input[data-action=search]', (e: any) => getComputedStyle(e).backgroundColor);
  await shot(page, '06-dark-menu');
  await page.keyboard.press('Escape');
  check('dark: the menu on the dark surface; the search field not a light box', bg === c.surface && lum(bg) < 0.05 && lightBox(field) === false, { bg, field });
  await ctx.close();
}

// ── New document: the templates as pages; the layout follows the panel, not the window ──
{
  const { ctx, page } = await open();
  const row = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.rh-new .rh-tpl')] as HTMLElement[];
    const pages = b.map((x) => x.querySelector('.rh-tpl-page')!.getBoundingClientRect());
    return { n: b.length, actions: b.map((x) => x.dataset.action), labels: b.map((x) => x.querySelector('.rh-tpl-label')!.textContent),
      named: b.every((x) => /^New document: /.test(x.getAttribute('aria-label') ?? '')), tops: new Set(pages.map((r) => Math.round(r.top))).size,
      ratio: Math.round((pages[0]!.height / pages[0]!.width) * 100) / 100, sketched: b.filter((x) => x.querySelector('.rh-tpl-page > i')).length,
      above: pages[0]!.bottom <= (document.querySelector('input[data-action=search]') as HTMLElement).getBoundingClientRect().top };
  });
  check('templates: 3–5 under "New document", one row above the search, each a named page (A4) with a sketch',
    row.n >= 3 && row.n <= 5 && row.tops === 1 && row.named && Math.abs(row.ratio - 297 / 210) < 0.03 && row.sketched === row.n && row.above, row);
  // one column: the templates, the search field and the rows' text share their left and right edges; the ⋯ takes the dates' place on hover rather than a column of its own
  await page.mouse.move(2, 2);
  const edges = await page.evaluate(() => {
    const r = (e: Element | null) => { const x = e!.getBoundingClientRect(); return [Math.round(x.left), Math.round(x.right)]; };
    const pages = [...document.querySelectorAll('.rh-tpl-page')];
    return { search: r(document.querySelector('input[data-action=search]')!.closest('.ui-field') ?? document.querySelector('input[data-action=search]')),
      tpls: [r(pages[0]!)[0], r(pages.at(-1)!)[1]], title: r(document.querySelector('.rh-row .rh-title'))[0], meta: r(document.querySelector('.rh-row .rh-meta'))[1],
      tile: !!document.querySelector('.rh-row .rh-tile') };
  });
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  await page.hover('.rh-row[data-doc-id]');
  const hover = await page.evaluate(() => { const row = document.querySelector('.rh-row[data-doc-id]')!; return { more: getComputedStyle(row.querySelector('.rh-more')!).visibility, meta: getComputedStyle(row.querySelector('.rh-meta')!).visibility }; });
  check('home: the templates, the search and the rows share both edges; no letter tile; on hover the ⋯ replaces the dates',
    near(edges.tpls[0]!, edges.search[0]!) && near(edges.tpls[1]!, edges.search[1]!) && near(edges.title, edges.search[0]!) && near(edges.meta, edges.search[1]!) && !edges.tile
    && hover.more === 'visible' && hover.meta === 'hidden', { edges, hover });
  // a narrow panel in a wide window (a workbench group): the container query, not a media query, re-lays it out
  const narrow = await page.evaluate(() => {
    (document.querySelector('.rtx-wb-home') as HTMLElement).style.width = '300px';
    const r = (s: string) => (document.querySelector(s) as HTMLElement).getBoundingClientRect();
    const t = document.querySelector('.rh-tpls') as HTMLElement;
    const btns = [r('[data-action=import]'), r('[data-action=new]')];
    return { scrolls: t.scrollWidth > t.clientWidth, overflowX: getComputedStyle(t).overflowX, inPanel: t.getBoundingClientRect().right <= 300 + r('.rtx-wb-home').left + 1,
      titleAlone: r('.rh-head h1').bottom <= Math.min(...btns.map((b) => b.top)) + 1, buttonsTogether: Math.round(btns[0]!.top) === Math.round(btns[1]!.top),
      meta: getComputedStyle(document.querySelector('.rh-row .rh-meta')!).display };
  });
  check('templates: in a 300 px panel of a wide window the row scrolls sideways inside it; the title on its own line, Import and New together; dates hidden',
    narrow.scrolls && narrow.overflowX === 'auto' && narrow.inPanel && narrow.titleAlone && narrow.buttonsTogether && narrow.meta === 'none', narrow);
  await page.evaluate(() => { (document.querySelector('.rtx-wb-home') as HTMLElement).style.width = ''; });
  // the keyboard reaches a template; Enter creates the document and opens it
  await page.focus('.rh-tpl[data-action=new-article]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  const made = await page.evaluate(async () => { const E = (window as any).editorAPI; const id = E.route().id; const d = await E.store().getDoc(id); return { title: d?.title, kinds: d?.blocks.map((b: any) => b.kind).join() }; });
  check('templates: Enter on Article creates "A Short Article" and opens it', made.title === 'A Short Article' && /^title,abstract,heading/.test(made.kinds ?? ''), made);
  await ctx.close();
}

// ── touch and the phone ───────────────────────────────────────────────────────
{
  const { ctx, page } = await open({ width: 390, height: 760, touch: true });
  await shot(page, '07-phone');
  const t = await page.evaluate(() => {
    const hgt = (s: string) => Math.round((document.querySelector(s) as HTMLElement).getBoundingClientRect().height);
    const more = document.querySelector('.rh-row [data-action=more]') as HTMLElement;
    return { scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, neu: hgt('[data-action=new]'), search: hgt('input[data-action=search]'),
      row: hgt('.rh-row'), more: hgt('.rh-row [data-action=more]'), moreShown: getComputedStyle(more).visibility === 'visible', meta: getComputedStyle(document.querySelector('.rh-meta')!).display,
      font: getComputedStyle(document.querySelector('input[data-action=search]')!).fontSize };
  });
  check('phone, touch: no horizontal scroll; New, the search, rows and ⋯ 44 px; ⋯ shown without hover; search text 16 px; dates hidden',
    !t.scroll && t.neu === 44 && t.search === 44 && t.row >= 44 && t.more === 44 && t.moreShown && t.meta === 'none' && t.font === '16px', t);
  await ctx.close();
}

check('no page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
