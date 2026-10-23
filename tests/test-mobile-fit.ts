// MOBILE-FIT (phones): the app fits the part of the screen the reader sees, and the bands around it
// are the theme's.
//
//   node tests/test-mobile-fit.ts [http://localhost:8152/]   (a dev server: tests/integration/serve.ts)
//
// keyboard  WebKit with the iPhone 13 profile and Chromium with the Pixel 7 profile. Playwright cannot raise a real
//           keyboard, so window.visualViewport is a stand-in (an init script) whose height the test shrinks, as iOS
//           Safari and Android Chrome (resizes-visual) do: the layout viewport keeps its height. A long paragraph is
//           tapped open, its caret put at its end; the keyboard comes up:
//           - <body> (the app's frame) ends where the keyboard starts; the pane's --pane-h is what is seen of it;
//           - the editing popover is at most half of that and whole in view, the
//             preview above it; the code caret in view in the popover and in the pane;
//           - the keyboard reported again with the same size moves nothing (no-op);
//           - a keyboard animated over 12 frames (Android) is applied once, after it settles: nothing moves meanwhile;
//           - the keyboard goes down: the frame and --pane-h as before, the caret still in view.
// resize    Chromium: the layout viewport itself shrinks (Android with resizes-content): no fit, --pane-h follows, the
//           caret kept in view.
// theme     every theme (light, dark, sepia, contrast), switched at run time: <html>'s ground, <body>'s and
//           <meta name="theme-color"> are the theme's page colour; <html>'s is a plain value (not a variable); the
//           viewport meta has viewport-fit=cover.
// safe      Chromium with safe-area insets emulated (CDP Emulation.setSafeAreaInsetsOverride, an iPhone's 47/34 px): the
//           workbench inside them (its top under the island's band, its bottom above the home indicator), the bands the
//           page colour; with the keyboard up the bottom inset is 0 (the keyboard covers the home indicator).
// sidebar   WebKit iPhone 13 and Chromium Pixel 7: the side column starts closed at phone width (a saved
//           open layout too), and closes when a wide window is narrowed to it; opened from the bar it floats over the document (an overlay with a scrim): the pane's width
//           and every line of the first blocks unchanged, in every frame of the slide; closed by a tap on the scrim, by
//           Escape and by its hide button, the lines unchanged again. A wide window keeps the column in the flow.
// Waits on state (whenIdle, conditions, frames), never on fixed times.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'mobile-fit');
mkdirSync(OUT, { recursive: true });
const { webkit, chromium, devices } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:8152/').replace(/\/?$/, '/');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 600)}` : ''}`);
}

// the stand-in visual viewport: the window's size less a keyboard (__kb(h, top)); its events as the real one's
const FAKE_VV = () => {
  const et = new EventTarget();
  let kb = 0, off = 0;
  const vv = {
    get width() { return innerWidth; }, get height() { return innerHeight - kb; }, get offsetTop() { return off; }, get offsetLeft() { return 0; },
    get pageTop() { return off; }, get pageLeft() { return 0; }, get scale() { return 1; }, onresize: null, onscroll: null,
    addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et), dispatchEvent: et.dispatchEvent.bind(et),
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  addEventListener('resize', () => et.dispatchEvent(new Event('resize')));
  (window as any).__kb = (h: number, top = 0) => { kb = h; off = top; et.dispatchEvent(new Event('resize')); et.dispatchEvent(new Event('scroll')); };
};

async function openPage(ctx: any) {
  await ctx.addInitScript(FAKE_VV);
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e: any) => errors.push(e.message.slice(0, 200)));
  await page.goto(BASE + '?seed=sample&engine&store=memory&fresh#/doc/sample');
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  return { page, errors };
}
const frames = (page: any, k = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(0)); f(k); }), k);
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());

/** what the checks read: the visible part, the frame, the pane, the popover, the caret */
const STATE = () => {
  const vv = visualViewport!, seen = { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
  const r = (e: Element | null | undefined) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
  const blk = document.querySelector('.blk.editing') as HTMLElement | null;
  const pane = blk?.closest('main[data-pane]') as HTMLElement | null;
  const pr = pane?.getBoundingClientRect(), pad = pane ? parseFloat(getComputedStyle(pane).scrollPaddingTop) || 0 : 0;
  const box = pr && pane ? { top: pr.top + pad, bottom: pr.top + pane.clientHeight } : null;
  const cur = blk?.querySelector('.cm-cursor-primary, .cm-cursor');
  const sc = blk?.querySelector('.cm-scroller');
  return {
    seen, inner: innerHeight, body: r(document.body), root: r(document.querySelector('.rtx-editor.rtx-wb')),
    vh: document.body.style.getPropertyValue('--wb-vh'), paneH: pane ? parseFloat(pane.style.getPropertyValue('--pane-h')) : NaN,
    box, scrollTop: pane?.scrollTop ?? null, pop: r(blk?.querySelector('.blk-source')), render: r(blk?.querySelector('.blk-render')),
    caret: r(cur), scroller: r(sc), bar: r(blk?.querySelector('.rtx-caret-bar')), float: !!blk?.classList.contains('rtx-float'), layout: blk?.dataset.editLayout ?? null,
    focused: !!document.activeElement?.closest('.blk.editing .cm-editor'),
    /** how far the popover's shadow reaches below it: the most of each layer's y offset + blur (+ spread) */
    shadow: (() => { const src = blk?.querySelector('.blk-source'); if (!src) return 0; const sh = getComputedStyle(src).boxShadow; let m = 0; for (const layer of sh.split(/,(?![^(]*\))/)) { const n = (layer.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) ?? []).map(parseFloat); if (n.length >= 3) m = Math.max(m, n[1]! + n[2]! + (n[3] ?? 0)); } return m; })(),
  };
};
type State = ReturnType<typeof STATE>;
const inBox = (r: { top: number; bottom: number } | null, b: { top: number; bottom: number } | null, tol = 1) => !!r && !!b && r.top >= b.top - tol && r.bottom <= b.bottom + tol;

/** a long paragraph tapped open, the caret at its end, the editor focused */
async function openLong(page: any, tag: string): Promise<boolean> {
  const id = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.rtx-tab main[data-pane] .blocks > .blk')].find((e) => (e.textContent ?? '').length > 400 && e.querySelector('.blk-render > .latex-block'));
    b?.scrollIntoView({ block: 'start' });
    return (b as HTMLElement | undefined)?.dataset.id ?? null;
  });
  if (!id) { check(`[${tag}] a long paragraph to open`, false); return false; }
  await idle(page);
  await page.tap(`.blk[data-id="${id}"] .blk-render > .latex-block`);
  await page.waitForFunction((i: string) => (window as any).editorAPI.sessions().some((s: any) => s.id === i), id);
  await idle(page);
  await page.waitForFunction(() => !!document.activeElement?.closest('.blk.editing .cm-editor'));
  await page.keyboard.press('Control+End');
  await idle(page);
  await frames(page, 3);
  return true;
}

async function keyboardCase(browserType: any, device: string, tag: string) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...devices[device] });
  const { page, errors } = await openPage(ctx);
  if (!(await openLong(page, tag))) { await browser.close(); return; }
  const s0: State = await page.evaluate(STATE);
  check(`[${tag}] at rest: no fit on <body>, the frame is the window`, s0.vh === '' && !!s0.body && Math.abs(s0.body.bottom - s0.inner) <= 1, s0);
  await page.screenshot({ path: join(OUT, `${tag}-0-open.png`) });

  // the keyboard comes up: 45 % of the window
  const kb = Math.round(s0.inner * 0.45);
  await page.evaluate((h: number) => (window as any).__kb(h), kb);
  await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') !== '');
  await frames(page, 3); await idle(page); await frames(page, 2);
  const s1: State = await page.evaluate(STATE);
  await page.screenshot({ path: join(OUT, `${tag}-1-keyboard.png`) });
  const seenH = s1.seen.bottom - s1.seen.top;
  check(`[${tag}] keyboard: the frame ends where the keyboard starts (body ${s1.body?.bottom}, visible ${s1.seen.bottom})`, !!s1.body && Math.abs(s1.body.bottom - s1.seen.bottom) <= 1 && Math.abs(s1.body.top - s1.seen.top) <= 1, s1);
  check(`[${tag}] keyboard: the pane ends above it and --pane-h is what is seen of it (${s1.paneH} of ${seenH})`, !!s1.box && s1.box.bottom <= s1.seen.bottom + 1 && Math.abs(s1.paneH - (s1.box.bottom - s1.box.top)) <= 1 && s1.paneH < s0.paneH - kb * 0.8, { s0: s0.paneH, s1: s1.paneH, box: s1.box });
  check(`[${tag}] keyboard: the popover is at most half of the visible pane (${s1.pop?.h} ≤ ${s1.paneH / 2})${s1.float ? ', floating' : ''}`, !!s1.pop && s1.pop.h <= s1.paneH / 2 + 1, { pop: s1.pop, paneH: s1.paneH, layout: s1.layout });
  check(`[${tag}] keyboard: the popover whole in view, the preview above it in view`, inBox(s1.pop, s1.box) && !!s1.render && s1.render.bottom > (s1.box?.top ?? 0) + 20 && (s1.render.top < (s1.pop?.top ?? 0)), { pop: s1.pop, render: s1.render, box: s1.box });
  // (mobile-chrome) the popover's shadow is not cut: its reach below it (motion/place.js POP_SHADOW: the
  // largest layer's offset + blur, read here from the computed shadow) ends inside the pane, which clips below its bottom
  check(`[${tag}] keyboard: the popover's shadow inside the pane (${s1.pop?.bottom} + ${s1.shadow} ≤ ${s1.box?.bottom})`, !!s1.pop && !!s1.box && s1.shadow > 0 && s1.pop.bottom + s1.shadow <= s1.box.bottom + 1, { pop: s1.pop, shadow: s1.shadow, box: s1.box });
  check(`[${tag}] keyboard: the code caret in view (in the popover's scroller and above the keyboard)`, s1.focused && inBox(s1.caret, s1.scroller, 2) && inBox(s1.caret, s1.box), { caret: s1.caret, scroller: s1.scroller, box: s1.box, focused: s1.focused });
  // (a caret on the last line: the result's end meets the floating popover there, its line may touch the popover's edge)
  check(`[${tag}] keyboard: the preview's caret (mirrored) in view above the popover`, !!s1.bar && !!s1.box && !!s1.pop && s1.bar.top >= s1.box.top - 1 && s1.bar.bottom <= s1.pop.top + 3, { bar: s1.bar, pop: s1.pop, box: s1.box });

  // a no-op: the same keyboard reported again
  await page.evaluate(() => {
    const w = window as any; w.__moves = 0;
    const sc = document.querySelector('.blk.editing')?.closest('main[data-pane]');
    const pop = document.querySelector('.blk.editing .blk-source');
    const t0 = sc?.scrollTop, y0 = pop?.getBoundingClientRect().top;
    const f = () => { if (sc?.scrollTop !== t0 || pop?.getBoundingClientRect().top !== y0) w.__moves++; if (w.__watch) requestAnimationFrame(f); };
    w.__watch = true; requestAnimationFrame(f);
  });
  await page.evaluate((h: number) => (window as any).__kb(h), kb);
  await frames(page, 6);
  const moved = await page.evaluate(() => { const w = window as any; w.__watch = false; return w.__moves; });
  const s2: State = await page.evaluate(STATE);
  check(`[${tag}] no-op: the same keyboard again moves nothing (${moved} frames moved)`, moved === 0 && s2.scrollTop === s1.scrollTop && s2.pop?.top === s1.pop?.top, { moved, a: s1.scrollTop, b: s2.scrollTop });

  // the keyboard goes down
  await page.evaluate(() => (window as any).__kb(0));
  await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') === '');
  await frames(page, 3); await idle(page); await frames(page, 2);
  const s3: State = await page.evaluate(STATE);
  await page.screenshot({ path: join(OUT, `${tag}-2-down.png`) });
  check(`[${tag}] keyboard down: the frame and --pane-h as before (${s3.paneH} = ${s0.paneH})`, !!s3.body && Math.abs(s3.body.bottom - s3.inner) <= 1 && Math.abs(s3.paneH - s0.paneH) <= 1, { s0: s0.paneH, s3: s3.paneH, body: s3.body });
  check(`[${tag}] keyboard down: the caret still in view`, inBox(s3.caret, s3.box) && inBox(s3.caret, s3.scroller, 2), { caret: s3.caret, box: s3.box });

  // an animated keyboard (Android: a resize each frame): applied once, after it settles; nothing moves meanwhile
  const anim = await page.evaluate(async (h: number) => {
    const w = window as any, body = document.body;
    let sets = 0;
    const mo = new MutationObserver(() => { sets++; });
    mo.observe(body, { attributes: true, attributeFilter: ['style'] });
    const pop = document.querySelector('.blk.editing .blk-source')!, y0 = pop.getBoundingClientRect().top;
    let movedDuring = 0;
    for (let i = 1; i <= 12; i++) {
      w.__kb(Math.round((h * i) / 12));
      await new Promise((r) => requestAnimationFrame(r));
      if (i < 12 && pop.getBoundingClientRect().top !== y0) movedDuring++;
    }
    const t0 = performance.now();
    while (body.style.getPropertyValue('--wb-vh') !== `${innerHeight - h}px` && performance.now() - t0 < 5000) await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    mo.disconnect();
    return { sets, movedDuring, vh: body.style.getPropertyValue('--wb-vh') };
  }, kb);
  check(`[${tag}] an animated keyboard (12 frames): applied once after it settles (${anim.sets} write), nothing moved meanwhile`, anim.sets === 1 && anim.movedDuring === 0 && anim.vh === `${s0.inner - kb}px`, anim);
  await idle(page); await frames(page, 2);
  const s4: State = await page.evaluate(STATE);
  check(`[${tag}] after it: the caret in view above the keyboard`, inBox(s4.caret, s4.box) && !!s4.box && s4.box.bottom <= s4.seen.bottom + 1, { caret: s4.caret, box: s4.box, seen: s4.seen });
  await page.evaluate(() => (window as any).__kb(0));
  await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') === '');
  check(`[${tag}] no page errors`, errors.length === 0, errors);
  await browser.close();
}

async function resizeCase() {
  const tag = 'chromium resizes-content';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const { page, errors } = await openPage(ctx);
  if (!(await openLong(page, tag))) { await browser.close(); return; }
  const s0: State = await page.evaluate(STATE);
  const vp = devices['Pixel 7'].viewport;
  await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
  await page.waitForFunction((h: number) => innerHeight === h, Math.round(vp.height * 0.55));
  await frames(page, 4); await idle(page); await frames(page, 2);
  const s1: State = await page.evaluate(STATE);
  await page.screenshot({ path: join(OUT, `resize-content.png`) });
  check(`[${tag}] the window itself shrinks: no fit written (${s1.vh || 'none'}), --pane-h follows (${s0.paneH} → ${s1.paneH})`, s1.vh === '' && !!s1.box && Math.abs(s1.paneH - (s1.box.bottom - s1.box.top)) <= 1 && s1.paneH < s0.paneH, { s0: s0.paneH, s1: s1.paneH });
  check(`[${tag}] the popover at most half, the caret in view`, !!s1.pop && s1.pop.h <= s1.paneH / 2 + 1 && inBox(s1.caret, s1.box) && inBox(s1.caret, s1.scroller, 2), { pop: s1.pop, caret: s1.caret, box: s1.box });
  check(`[${tag}] no page errors`, errors.length === 0, errors);
  await browser.close();
}

const PAGE: Record<string, string> = { light: '#ffffff', dark: '#191919', sepia: '#f4ecd8', contrast: '#ffffff' };
const hexRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

async function themeCase(browserType: any, device: string, tag: string) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...devices[device] });
  const { page, errors } = await openPage(ctx);
  const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '');
  check(`[${tag}] the viewport meta has viewport-fit=cover (${meta})`, /viewport-fit\s*=\s*cover/.test(meta));
  for (const theme of ['dark', 'sepia', 'contrast', 'light']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await page.waitForFunction((t: string) => document.documentElement.getAttribute('data-theme') === t, theme);
    await frames(page, 2);
    const c = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
      inline: document.documentElement.style.backgroundColor, meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      metas: document.querySelectorAll('meta[name="theme-color"]').length, page: getComputedStyle(document.documentElement).getPropertyValue('--rfed-page').trim(),
    }));
    const want = hexRgb(PAGE[theme]!);
    check(`[${tag}] ${theme}: <html>, <body> and theme-color are the page colour ${PAGE[theme]}`, c.html === want && c.body === want && c.meta?.toLowerCase() === PAGE[theme] && c.metas === 1 && c.page.toLowerCase() === PAGE[theme], c);
    check(`[${tag}] ${theme}: <html>'s ground is a plain value, not a variable`, !/var\(/.test(c.inline) && c.inline !== '', c.inline);
  }
  // a reload with the theme stored: the head's script sets both before the bundle
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'sepia' }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const first = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') }));
  check(`[${tag}] reloaded in sepia: the head's script set <html> and theme-color`, first.html === hexRgb(PAGE.sepia!) && first.meta === PAGE.sepia, first);
  check(`[${tag}] no page errors`, errors.length === 0, errors);
  await browser.close();
}

async function safeCase() {
  const tag = 'chromium safe areas';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const { page, errors } = await openPage(ctx);
  const cdp = await ctx.newCDPSession(page);
  let emulated = true;
  try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } }); } catch (e) { emulated = false; check(`[${tag}] CDP can emulate safe-area insets`, false, (e as Error).message); }
  if (emulated) {
    await page.waitForFunction(() => { const r = document.querySelector('.rtx-editor.rtx-wb')!.getBoundingClientRect(); return r.top > 40; });
    await frames(page, 2);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.rtx-editor.rtx-wb')!.getBoundingClientRect();
      const at = (x: number, y: number) => { const e = document.elementFromPoint(x, y); return e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') : null; };
      return { top: b.top, bottom: b.bottom, inner: innerHeight, topBand: at(innerWidth / 2, 20), bottomBand: at(innerWidth / 2, innerHeight - 10), body: getComputedStyle(document.body).backgroundColor };
    });
    await page.screenshot({ path: join(OUT, 'safe-areas.png') });
    check(`[${tag}] the workbench inside the insets (top ${r.top}, bottom ${r.inner - r.bottom} from the edge)`, Math.abs(r.top - 47) <= 1 && Math.abs(r.inner - r.bottom - 34) <= 1, r);
    check(`[${tag}] the bands are the page's ground (body: ${r.topBand}, ${r.bottomBand})`, r.topBand === 'body' && r.bottomBand === 'body' && r.body === hexRgb(PAGE.light!), r);
    const kb = 300;
    await page.evaluate((h: number) => (window as any).__kb(h), kb);
    await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') !== '');
    await frames(page, 2);
    const k = await page.evaluate(() => { const b = document.querySelector('.rtx-editor.rtx-wb')!.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, seen: visualViewport!.height }; });
    check(`[${tag}] keyboard up: no bottom inset (the keyboard covers the home indicator): the workbench ends at the keyboard`, Math.abs(k.bottom - k.seen) <= 1 && Math.abs(k.top - 47) <= 1, k);
    await page.evaluate(() => (window as any).__kb(0));
    await page.waitForFunction(() => document.body.style.getPropertyValue('--wb-vh') === '');
  }
  check(`[${tag}] no page errors`, errors.length === 0, errors);
  await browser.close();
}

/** the document's lines: the pane's width and the boxes of the first blocks' line pictures (a reflow changes them) */
const LINES = () => {
  const pane = document.querySelector('.rtx-tab main[data-pane]') as HTMLElement;
  const svgs = [...pane.querySelectorAll('.blk-render svg')].slice(0, 40).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)].join(','); });
  return { w: pane.clientWidth, svgs: svgs.join(' '), n: svgs.length };
};
const SIDE = () => { const a = document.querySelector('aside[data-side="left"]') as HTMLElement | null; const r = a?.getBoundingClientRect();
  return { hidden: !a || a.classList.contains('wb-side--hidden'), overlay: !!a?.classList.contains('wb-side--overlay'), left: r ? Math.round(r.left) : null, w: r ? Math.round(r.width) : null,
    scrim: !!document.querySelector('.wb-side-scrim'), root: Math.round(document.querySelector('.wb-root')!.getBoundingClientRect().width) }; };

async function sidebarCase(browserType: any, device: string, tag: string) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...devices[device] });
  const { page, errors } = await openPage(ctx);
  const wbIdle = () => page.evaluate(() => (window as any).editorAPI.workbench().idle());
  const s0 = await page.evaluate(SIDE);
  check(`[${tag}] at phone width the side column starts closed`, s0.hidden && !s0.scrim, s0);
  const l0 = await page.evaluate(LINES);
  // open from the bar, sampling the pane's width every frame of the slide
  await page.evaluate(() => { const w = window as any, p = document.querySelector('.rtx-tab main[data-pane]') as HTMLElement; w.__ws = new Set(); w.__sample = true; const f = () => { w.__ws.add(p.clientWidth); if (w.__sample) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.tap('[data-action="show-left"]');
  await page.waitForFunction(() => !document.querySelector('aside[data-side="left"]')?.classList.contains('wb-side--hidden'));
  await wbIdle(); await idle(page); await frames(page, 3);
  const ws = await page.evaluate(() => { const w = window as any; w.__sample = false; return [...w.__ws]; });
  const s1 = await page.evaluate(SIDE), l1 = await page.evaluate(LINES);
  await page.screenshot({ path: join(OUT, `${tag}-sidebar-open.png`) });
  check(`[${tag}] opened: it floats over the document (an overlay at the left edge, at most 85 % of the window, a scrim)`, !s1.hidden && s1.overlay && s1.scrim && s1.left === 0 && !!s1.w && s1.w <= s1.root * 0.85 + 1 && s1.w >= 160, s1);
  check(`[${tag}] opened: the document keeps its width and its lines (in every frame: ${ws.join('/')} px)`, ws.length === 1 && ws[0] === l0.w && l1.w === l0.w && l1.svgs === l0.svgs && l0.n > 0, { l0: l0.w, l1: l1.w, n: l0.n, same: l1.svgs === l0.svgs });
  // a tap on the scrim closes it
  const pt = { x: Math.round((s1.w! + s1.root) / 2), y: 400 };
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForFunction(() => document.querySelector('aside[data-side="left"]')?.classList.contains('wb-side--hidden'));
  await wbIdle(); await frames(page, 2);
  const s2 = await page.evaluate(SIDE), l2 = await page.evaluate(LINES);
  const sess = await page.evaluate(() => (window as any).editorAPI.sessions().filter((s: any) => s.id).length);
  check(`[${tag}] a tap outside closes it (and does nothing else: no block opened), the lines unchanged`, s2.hidden && !s2.scrim && sess === 0 && l2.svgs === l0.svgs && l2.w === l0.w, { s2, sess });
  // Escape closes it
  await page.tap('[data-action="show-left"]');
  await page.waitForFunction(() => !!document.querySelector('.wb-side-scrim'));
  await wbIdle();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('aside[data-side="left"]')?.classList.contains('wb-side--hidden'));
  check(`[${tag}] Escape closes it`, (await page.evaluate(SIDE)).hidden);
  // its own hide button closes it
  await wbIdle();
  await page.tap('[data-action="show-left"]');
  await page.waitForFunction(() => !!document.querySelector('.wb-side-scrim'));
  await wbIdle();
  await page.tap('aside[data-side="left"] [data-action="collapse"]');
  await page.waitForFunction(() => document.querySelector('aside[data-side="left"]')?.classList.contains('wb-side--hidden'));
  await wbIdle(); await frames(page, 2);
  const l3 = await page.evaluate(LINES);
  check(`[${tag}] the toggle closes it; the lines as at the start`, (await page.evaluate(SIDE)).hidden && l3.svgs === l0.svgs, { w: l3.w });
  // reload with it open (the layout saved open): closed again at phone width
  await page.tap('[data-action="show-left"]');
  await page.waitForFunction(() => !!document.querySelector('.wb-side-scrim'));
  await wbIdle();
  await page.goto(BASE + '?seed=sample&engine&store=memory#/doc/sample');
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await idle(page);
  check(`[${tag}] reloaded with the column left open: closed at phone width`, (await page.evaluate(SIDE)).hidden);
  check(`[${tag}] no page errors`, errors.length === 0, errors);
  await browser.close();
}
async function sidebarWide() {
  const tag = 'chromium 1280 px';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const { page, errors } = await openPage(ctx);
  const s = await page.evaluate(SIDE);
  check(`[${tag}] a wide window: the side column open, in the flow (no overlay, no scrim)`, !s.hidden && !s.overlay && !s.scrim, s);
  // narrowed to a phone's width with the column open: it closes (an overlay is opened on purpose), nothing covers the document
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForFunction(() => document.querySelector('aside[data-side="left"]')?.classList.contains('wb-side--hidden'));
  await idle(page);
  const n = await page.evaluate(SIDE);
  check(`[${tag}] narrowed to 390 px with it open: closed, no scrim`, n.hidden && !n.scrim, n);
  check(`[${tag}] no page errors`, errors.length === 0, errors);
  await browser.close();
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const want = (k: string) => !only || new RegExp(only).test(k);
if (want('keyboard-webkit')) await keyboardCase(webkit, 'iPhone 13', 'webkit iPhone 13');
if (want('keyboard-chromium')) await keyboardCase(chromium, 'Pixel 7', 'chromium Pixel 7');
if (want('resize')) await resizeCase();
if (want('theme-webkit')) await themeCase(webkit, 'iPhone 13', 'webkit iPhone 13');
if (want('theme-chromium')) await themeCase(chromium, 'Pixel 7', 'chromium Pixel 7');
if (want('safe')) await safeCase();
if (want('sidebar-webkit')) await sidebarCase(webkit, 'iPhone 13', 'webkit iPhone 13');
if (want('sidebar-chromium')) await sidebarCase(chromium, 'Pixel 7', 'chromium Pixel 7');
if (want('sidebar-wide')) await sidebarWide();

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
