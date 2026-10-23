// MOBILE-CHROME (two rows of chrome over a slice of the document): one row of chrome
// in a narrow window, and the save state on the tab only.
//
//   node tests/test-mobile-chrome.ts [http://localhost:8152/]   (a dev server: tests/integration/serve.ts)
//
// phone    WebKit with the iPhone 13 profile and Chromium with the Pixel 7 profile (a width rule: sides.ts OVERLAY_MAX_W):
//          - one row: the document's tab is in the bar (its name and section), no tab strip row, the bar one row high,
//            the pane's text starting under it; the app's mark not in the bar; no save status in the bar;
//          - unsaved: a block write that fails shows the tab's dot (in its × slot) and a toast "Not saved" with Retry;
//            Retry (the store working again) saves it and the dot goes;
//          - three tabs: still one row, the active tab alone with all the room, a count "3" after it; the count opens
//            the group's tabs as a list, a row activates its tab;
//          - the keyboard (a stand-in visualViewport, as test-mobile-fit) while a block is edited: screenshots.
// desktop  Chromium 1280 × 800: as before: the tabs share the bar (all three drawn, no count), the mark shown, no save
//          status in the bar either.
// Waits on state (whenIdle, conditions, frames), never on fixed times.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'mobile-chrome');
mkdirSync(OUT, { recursive: true });
const { webkit, chromium, devices } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:8152/').replace(/\/?$/, '/');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 600)}` : ''}`);
}

// the stand-in visual viewport (test-mobile-fit's): the window's size less a keyboard (__kb(h))
const FAKE_VV = () => {
  const et = new EventTarget();
  let kb = 0;
  const vv = {
    get width() { return innerWidth; }, get height() { return innerHeight - kb; }, get offsetTop() { return 0; }, get offsetLeft() { return 0; },
    get pageTop() { return 0; }, get pageLeft() { return 0; }, get scale() { return 1; }, onresize: null, onscroll: null,
    addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et), dispatchEvent: et.dispatchEvent.bind(et),
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  addEventListener('resize', () => et.dispatchEvent(new Event('resize')));
  (window as any).__kb = (h: number) => { kb = h; et.dispatchEvent(new Event('resize')); };
};
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (page: any, k = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(0)); f(k); }), k);

async function openPage(ctx: any) {
  await ctx.addInitScript(FAKE_VV);
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e: any) => errors.push(e.message.slice(0, 200)));
  await page.goto(BASE + '?seed=sample&engine&store=memory&fresh#/doc/sample');
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await idle(page);
  await page.waitForFunction(() => document.querySelectorAll('main.rtx-pane .blk').length > 3);
  await idle(page);
  return { page, errors };
}

/** the chrome as the checks read it */
const CHROME = () => {
  const r = (e: Element | null | undefined) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width) }; };
  const bar = document.querySelector('.wb-bar');
  const inBar = [...document.querySelectorAll('.wb-bar .wb-strip--inbar [data-tab]')];
  const rows = [...document.querySelectorAll<HTMLElement>('.wb-groups .wb-strip')].filter((s) => !s.hidden && s.getBoundingClientRect().height > 0);
  const pane = document.querySelector<HTMLElement>('main.rtx-pane[data-pane]');
  const pr = pane?.getBoundingClientRect();
  const count = document.querySelector('.wb-bar .wb-tabs-count');
  return {
    win: innerWidth, bar: r(bar), tabsInBar: inBar.length, rowStrips: rows.length,
    tab: inBar[0] ? { box: r(inBar[0]), name: inBar[0].querySelector('.wb-tab-name')?.textContent ?? '', sec: inBar[0].querySelector('.wb-tab-sec, .wb-tab-sub-label')?.textContent?.trim() ?? '' } : null,
    markOn: document.querySelectorAll('.wb-bar .wb-mark-part[data-on="true"]').length,
    saveInBar: !!document.querySelector('#save-state, .save-state'), barText: (bar?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    count: count ? { text: count.textContent ?? '', label: count.getAttribute('aria-label') } : null,
    textTop: pane && pr ? Math.round(pr.top + (parseFloat(getComputedStyle(pane).scrollPaddingTop) || 0)) : null,
    dot: !!document.querySelector('.wb-bar [data-tab] .wb-st--unsaved'),
  };
};

async function phone(browserType: any, device: string, tag: string) {
  const browser = await browserType.launch();
  try {
    const ctx = await browser.newContext({ ...devices[device] });
    const { page, errors } = await openPage(ctx);
    const c0 = await page.evaluate(CHROME);
    await page.screenshot({ path: join(OUT, `${tag}-1-one-tab.png`) });
    check(`[${tag}] one row: the document's tab in the bar, no tab strip row (${c0.tabsInBar} in the bar, ${c0.rowStrips} rows)`, c0.tabsInBar === 1 && c0.rowStrips === 0, c0);
    check(`[${tag}] one row: the bar one row high (${c0.bar?.h} px) and the text starts under it (${c0.textTop} ≤ ${c0.bar?.bottom})`, !!c0.bar && c0.bar.h <= 56 && c0.textTop != null && c0.textTop <= c0.bar.bottom + 1, c0);
    check(`[${tag}] the tab shows the document's name and its section ("${c0.tab?.name}" › "${c0.tab?.sec}")`, !!c0.tab && c0.tab.name.length > 0 && c0.tab.sec.length > 0 && c0.tab.box.w > c0.win * 0.4, c0.tab);
    check(`[${tag}] no app mark and no save status in the bar, no count with one tab`, c0.markOn === 0 && !c0.saveInBar && !/Saved|Saving/.test(c0.barText) && !c0.count, c0);

    // unsaved: the store refuses block writes; the tab's dot and the toast; Retry once it works again
    const id = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => b.kind === 'paragraph').id);
    await page.evaluate((i: string) => {
      const A = (window as any).editorAPI, s = A.store(), w = window as any;
      w.__put = s.putBlock; s.putBlock = () => Promise.reject(new Error('the write was refused (test)'));
      const b = A.blocks().find((x: any) => x.id === i);
      A.setSource(i, `${b.source} Saved later.`);
    }, id);
    const dotOn = await page.waitForFunction(() => !!document.querySelector('.wb-bar [data-tab] .wb-st--unsaved'), null, { timeout: 15000 }).then(() => true, () => false);
    const toast = await page.evaluate(() => ({ text: document.querySelector('#toast-text')?.textContent ?? '', button: document.querySelector('#toast-undo')?.textContent ?? '', live: document.querySelector('#toast')?.closest('[aria-live]')?.getAttribute('aria-live') ?? document.querySelector('#toast')?.getAttribute('aria-live') ?? null }));
    const said = await page.evaluate(() => document.querySelector('.wb-bar [data-tab] [role="tab"]')?.getAttribute('aria-description') ?? '');
    await page.screenshot({ path: join(OUT, `${tag}-2-unsaved.png`) });
    check(`[${tag}] a failed write: the tab in the bar shows its unsaved dot, its status says "unsaved"; the toast says "Not saved" (Retry)`, dotOn && /unsaved/.test(said) && /Not saved/.test(toast.text) && toast.button === 'Retry' && toast.live === 'polite', { dotOn, said, toast });
    await page.evaluate(() => { const s = (window as any).editorAPI.store(); s.putBlock = (window as any).__put; (document.querySelector('#toast-undo') as HTMLElement | null)?.click(); });
    const dotOff = await page.waitForFunction(() => !document.querySelector('.wb-bar [data-tab] .wb-st--unsaved'), null, { timeout: 15000 }).then(() => true, () => false);
    const stored = await page.evaluate(async (i: string) => { const A = (window as any).editorAPI; const d = await A.store().getDoc(A.currentDoc().id); return d?.blocks?.find((b: any) => b.id === i)?.source ?? null; }, id);
    check(`[${tag}] Retry with the store working: saved, the dot gone`, dotOff && /Saved later\.$/.test(stored ?? ''), { dotOff, stored: stored?.slice(-30) });

    // the keyboard while a block is edited (screenshots: before is main's two rows)
    const bid = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.rtx-tab main[data-pane] .blocks > .blk')].find((e) => (e.textContent ?? '').length > 400 && e.querySelector('.blk-render > .latex-block'));
      b?.scrollIntoView({ block: 'start' });
      return (b as HTMLElement | undefined)?.dataset.id ?? null;
    });
    if (bid) {
      await idle(page);
      await page.tap(`.blk[data-id="${bid}"] .blk-render > .latex-block`);
      await page.waitForFunction(() => !!document.activeElement?.closest('.blk.editing .cm-editor'));
      await page.keyboard.press('Control+End');
      await idle(page);
      const inner = await page.evaluate(() => innerHeight);
      await page.evaluate((h: number) => (window as any).__kb(h), Math.round(inner * 0.45));
      await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') !== '');
      await frames(page, 3); await idle(page); await frames(page, 2);
      const k = await page.evaluate(CHROME);
      await page.screenshot({ path: join(OUT, `${tag}-3-keyboard.png`) });
      check(`[${tag}] keyboard up, a block edited: still one row (the bar ${k.bar?.h} px, the tab in it)`, k.tabsInBar === 1 && k.rowStrips === 0 && !!k.bar && k.bar.h <= 56, k);
      await page.keyboard.press('Escape');
      await page.evaluate(() => (window as any).__kb(0));
      await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') === '');
      await idle(page);
    } else check(`[${tag}] a long paragraph to edit`, false);

    // three tabs: one row, the active tab alone, a count; the count lists them, a row activates its tab
    await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); const doc = E.route().id; for (let k = 0; k < 2; k++) wb.open({ view: 'document', state: { doc } }); await E.whenIdle(); });
    await frames(page, 3); await idle(page);
    const c3 = await page.evaluate(CHROME);
    await page.screenshot({ path: join(OUT, `${tag}-4-three-tabs.png`) });
    check(`[${tag}] three tabs: one row, the active tab alone in the bar with a count "3"`, c3.tabsInBar === 1 && c3.rowStrips === 0 && c3.count?.text === '3' && /3 tabs/.test(c3.count.label ?? '') && !!c3.tab && c3.tab.box.w > c3.win * 0.4, c3);
    const before = await page.evaluate(() => (window as any).editorAPI.workbench().layout.peek().root.active ?? null);
    await page.tap('.wb-bar .wb-tabs-count');
    await page.waitForSelector('[role="grid"] [role="row"]');
    const rows = await page.evaluate(() => [...document.querySelectorAll('[role="grid"] [role="row"]')].map((r) => (r.textContent ?? '').trim()));
    await page.screenshot({ path: join(OUT, `${tag}-5-tab-list.png`) });
    await page.tap('[role="grid"] [role="row"]:first-child [role="gridcell"] > button');
    await frames(page, 3); await idle(page);
    const after = await page.evaluate(() => { const g = (window as any).editorAPI.workbench().layout.peek().root; return { active: g.active ?? null, first: g.tabs?.[0]?.id ?? null }; });
    const c4 = await page.evaluate(CHROME);
    check(`[${tag}] the count lists the 3 tabs; a row activates its tab (still one row)`, rows.length === 3 && after.active === after.first && after.active !== before && c4.tabsInBar === 1 && c4.rowStrips === 0, { rows, before, after });
    check(`[${tag}] no page errors`, errors.length === 0, errors);
  } finally { await browser.close(); }
}

async function desktop() {
  const tag = 'chromium 1280';
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await openPage(ctx);
    const c0 = await page.evaluate(CHROME);
    check(`[${tag}] one tab: in the bar, the mark shown, no count, no save status`, c0.tabsInBar === 1 && c0.rowStrips === 0 && c0.markOn > 0 && !c0.count && !c0.saveInBar && !/Saved|Saving/.test(c0.barText), c0);
    await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); const doc = E.route().id; for (let k = 0; k < 2; k++) wb.open({ view: 'document', state: { doc } }); await E.whenIdle(); });
    await frames(page, 3); await idle(page);
    const c3 = await page.evaluate(CHROME);
    await page.screenshot({ path: join(OUT, `desktop-three-tabs.png`) });
    // (at 1280 the three share the bar, each at least --wb-tab-min, as before)
    const drawn = await page.evaluate(() => document.querySelectorAll('[data-tab]:not(.wb-ptab)').length);
    check(`[${tag}] three tabs: all drawn (in the bar or their row, as before), no count`, drawn >= 3 && !c3.count, { ...c3, drawn });
    check(`[${tag}] no page errors`, errors.length === 0, errors);
  } finally { await browser.close(); }
}

await phone(webkit, 'iPhone 13', 'webkit iPhone 13');
await phone(chromium, 'Pixel 7', 'chromium Pixel 7');
await desktop();
const bad = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
