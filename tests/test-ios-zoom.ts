// IOS-ZOOM: on iOS, tapping the preview to edit must not zoom the page. Safari zooms on focus when the focused
// editable's font size is under 16 px; on touch devices the code editor and every input get at least 16 px (style.js,
// app.css: @media (pointer: coarse)), user zoom stays allowed (no maximum-scale in the viewport meta).
// WebKit with Playwright's iPhone profile: tap a block, the editor opens, visualViewport.scale stays 1, the code is legible.
//
//   node tests/test-ios-zoom.ts [http://localhost:8151/]   (a dev server: tests/integration/serve.ts)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const { webkit, devices } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8151/';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 500)}` : ''}`);
}

const browser = await webkit.launch();
for (const name of ['iPhone 13', 'iPhone SE']) {
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e: any) => problems.push(e.message));
  page.setDefaultTimeout(180000);
  await page.goto(BASE + '?seed=sample&engine&store=memory#/doc/sample');
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '');
  check(`[${name}] user zoom allowed: the viewport meta has no maximum-scale / user-scalable=no (${meta})`, !/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(meta));
  const id = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-part="page"] .blocks > .blk')].find((e) => (e.textContent ?? '').length > 200 && e.querySelector('.blk-render > .latex-block'));
    b?.scrollIntoView({ block: 'center' });
    return (b as HTMLElement | undefined)?.dataset.id ?? null;
  });
  if (!id) { check(`[${name}] a paragraph to tap`, false); await ctx.close(); continue; }
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  await page.tap(`[data-part="page"] .blk[data-id="${id}"] .blk-render > .latex-block`);
  await page.waitForFunction((i: string) => (window as any).editorAPI.sessions().some((s: any) => s.id === i), id);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));     // a focus zoom would have happened by now (WebKit animates it)
  const st = await page.evaluate(() => {
    const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
    const a = document.activeElement as HTMLElement | null;
    const content = document.querySelector('.blk.editing .cm-content');
    const line = document.querySelector('.blk.editing .cm-line');
    const lr = line?.getBoundingClientRect();
    // every editable a tap could focus on a phone: inputs, textareas, selects, contenteditables
    const small = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]):not([type=hidden]), textarea, select, [contenteditable="true"], [contenteditable=""]')]
      .map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e as HTMLElement).className?.toString().slice(0, 40), px: px(e) })).filter((x) => x.px < 16);
    return {
      scale: visualViewport?.scale ?? 1, active: a ? { tag: a.tagName.toLowerCase(), cls: a.className?.toString().slice(0, 40), px: px(a) } : null,
      content: px(content), lineH: lr ? lr.height : 0, lineW: lr ? lr.width : 0, small,
    };
  });
  check(`[${name}] tapping the preview opens the editor without zooming (visualViewport.scale ${st.scale})`, Math.abs(st.scale - 1) < 0.001, st);
  check(`[${name}] the focused editable is at least 16 px (${st.active?.tag}.${st.active?.cls}: ${st.active?.px} px)`, !!st.active && st.active.px >= 16, st.active);
  check(`[${name}] the code is legible: content ${st.content} px, a line ${Math.round(st.lineH)} px high`, st.content >= 16 && st.lineH >= st.content * 1.15 && st.lineW > 100, st);
  check(`[${name}] no editable under 16 px on a touch device (${st.small.length})`, st.small.length === 0, st.small);
  check(`[${name}] no page errors`, problems.length === 0, problems);
  await ctx.close();
}
// a desktop (fine pointer): the code keeps its size (13.5 px)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(BASE + '?seed=sample&engine&store=memory#/doc/sample');
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  const id = await page.evaluate(() => (document.querySelector('[data-part="page"] .blocks > .blk .blk-render > .latex-block')?.closest('.blk') as HTMLElement | null)?.dataset.id ?? null);
  await page.evaluate((i: string) => (window as any).editorAPI.editIn('a', i, 0), id);
  await page.waitForSelector('.blk.editing .cm-content');
  const px = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.blk.editing .cm-content')!).fontSize));
  check(`[desktop] a fine pointer: the code keeps its size (${px} px)`, Math.abs(px - 13.5) < 0.01, { px });
  await ctx.close();
}
await browser.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
