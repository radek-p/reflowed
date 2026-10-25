// The workbench's browser suite, area "bar": the window bar: the tabs in it, the side status bar, the wordmark, the glass top bar, the fit. Run by tests/e2e.ts (--area bar).
import { req, pw, argv, ONLY, HTML, JS, fails, check, skip, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── the window bar (the editor's top bar): home, one group's tabs in it while they fit, the host's controls ──
// The reference: the editor's top bar (scripts/app-ref.ts on the dev app): 44 px; the right-hand controls
// 38 px apart (the one 6 px gap); the version pill 11 px; the sidebar 256 px. With tabs in the bar no wordmark: the app's name is the bar's accessible name
// and the document title.
const visTabs = (page: any, where: string) => page.evaluate((w: string) => [...document.querySelectorAll(`${w} [data-tab]`)].filter((t) => t.getBoundingClientRect().width > 0).length, where);
group('window bar: home, the tabs in the bar, the controls, the columns, the switcher', async () => {
  const page = await fresh({ sides: true, w: 1500, query: 'fresh&single&bar=1' });
  await events(page);
  await settled(page);
  const g = await page.evaluate(() => {
    const r = (s: string) => { const e = document.querySelector(s) as HTMLElement; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, font: getComputedStyle(e).fontSize }; };
    return { bar: r('.wb-bar'), tab: r('.wb-bar [data-tab]'), noSplit: !document.querySelector('[data-demo="split"]'), view: r('[data-demo="view"]'), menu: r('[data-demo="menu"]'), pill: r('.wb-side-status [data-demo="version"]'),
      side: r('aside[data-side="left"]'), home: r('.wb-bar .wb-home-btn'), homeName: document.querySelector('.wb-bar .wb-home-btn')!.getAttribute('aria-label'),
      mark: [...document.querySelectorAll('.wb-bar-center, [data-demo="brand"]')].filter((e) => getComputedStyle(e).visibility !== 'hidden').length, label: document.querySelector('.wb-bar')!.getAttribute('aria-label'), title: document.title,
      crumbs: document.querySelectorAll('.wb-bar .wb-crumbs, [data-crumb-action], .wb-bar .wb-crumb-sep').length,
      next: document.querySelector('.wb-bar .wb-home-btn')!.nextElementSibling!.className, lastR: Math.max(...[...document.querySelectorAll('.wb-bar .wb-btn')].map((e) => e.getBoundingClientRect().right)) };
  });
  const near = (a: number, b: number, d = 1) => Math.abs(a - b) <= d;
  check('one document: the bar is 44 px; its one tab is in the bar (32 px at y 6), no tab row', near(g.bar.h, 44) && g.bar.y === 0 && near(g.tab.h, 32) && near(g.tab.y, 6) && (await visTabs(page, '.wb-groups')) === 0, { bar: g.bar, tab: g.tab });
  check('the app' + 's name is the bar' + 's accessible name and the document title', g.label === 'ReflowEd' && /ReflowEd/.test(g.title), { mark: g.mark, label: g.label, title: g.title });
  check('no pencil, no crumbs, no chevron: home is the first item of the strip, the tabs follow it', g.crumbs === 0 && /wb-tabs/.test(g.next), g);
  check('the controls: no split button (the tab menu and the key split); the uniform 32 px buttons at y 6, the last 6 px from the edge; the version not in the bar (the side status, 12 px)', g.noSplit && near(g.view.y, 6) && near(g.view.h, 32) && near(g.menu.y, 6) && near(g.menu.h, 32) && near(g.bar.x + g.bar.w - g.lastR, 6) && g.pill.font === '12px' && g.pill.y > g.bar.h, { noSplit: g.noSplit, view: g.view, menu: g.menu, pill: g.pill, bar: g.bar });
  check('the sidebar 256 px, full height from the top; the bar between the columns', near(g.side.w, 256) && g.side.y === 0 && near(g.bar.x, g.side.x + g.side.w), { side: g.side, bar: g.bar });
  check('home: an icon toggle named Home, square, 32 px', g.homeName === 'Home' && g.home.h === 32 && g.home.w === 32, g.home);
  // both columns open: the bar between them, their tabs level with it; hiding one: the bar follows its edge, smoothly
  await page.evaluate(() => (window as any).demo.wb.collapseSide('right', false));
  await page.waitForFunction(() => !document.querySelector('.wb-side--sliding') && !!document.querySelector('aside[data-side="right"]:not(.wb-side--hidden)'));
  const both = await page.evaluate(() => { const b = document.querySelector('.wb-bar')!.getBoundingClientRect(), l = document.querySelector('aside[data-side="left"]')!.getBoundingClientRect(), r = document.querySelector('aside[data-side="right"]')!.getBoundingClientRect(),
    ls = document.querySelector('aside[data-side="left"] .wb-side-strip')!.getBoundingClientRect(); return { b: [b.left, b.right], l: [l.top, l.right], r: [r.top, r.left], strip: [ls.top, ls.height, b.height] }; });
  check('both open: the bar from the left column' + 's right to the right column' + 's left; the columns from the top; their tabs level with the bar',
    near(both.b[0], both.l[1]) && near(both.b[1], both.r[1]) && both.l[0] === 0 && both.r[0] === 0 && both.strip[0] === 0 && near(both.strip[1], both.strip[2]), both);
  const frames = await page.evaluate(async () => {
    const out: any[] = [];
    const w = window as any; w.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(e.duration); }).observe({ type: 'longtask' });
    w.demo.wb.toggleSide('left');
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const a = document.querySelector('aside[data-side="left"]')!.getBoundingClientRect(), hm = document.querySelector('.wb-bar .wb-home-btn')!.getBoundingClientRect();
      void hm; const bl = document.querySelector('.wb-bar')!.getBoundingClientRect();
      out.push({ edge: a.right, home: bl.left, sliding: !!document.querySelector('.wb-side--sliding') });
      if (!out.at(-1).sliding && i > 2) break;
    }
    return { out, long: w.__long };
  });
  const gaps = frames.out.filter((f: any) => f.sliding).map((f: any) => Math.round(f.home - f.edge));
  check('hiding: the bar (home at its start, after the growing slot) follows the column' + 's edge through the motion, no long task', gaps.length >= (BROWSER === "webkit" ? 1 : 3) && Math.max(...gaps) - Math.min(...gaps) <= 2 && frames.long.length === 0, { gaps, long: frames.long });     // (headless WebKit paints few frames)
  const endL = await page.evaluate(() => document.querySelector('.wb-bar')!.getBoundingClientRect().left);
  check('… and in the end the bar starts at the window edge', near(endL, 0), endL);
  await page.evaluate(() => (window as any).demo.wb.toggleSide('left'));
  await page.waitForFunction(() => !document.querySelector('.wb-side--sliding') && !(window as any).demo.wb.sides.peek().left.collapsed);
  await page.evaluate(() => (window as any).demo.wb.collapseSide('right', true));
  await settled(page);
  // the switcher: the name of the tab in the bar; picking switches here (no new tab); the row's button: a new tab
  await page.click('.wb-bar [data-tab] [data-name]');
  await page.waitForSelector('[role="grid"] [data-item="doc-graphs"]');
  await page.waitForFunction(() => document.getAnimations().length === 0);     // the menu's entrance (a scale) is over
  const rw0 = await page.evaluate(() => [...document.querySelectorAll('[role="row"]')].map((r) => Math.round(r.getBoundingClientRect().width)).join());
  await page.hover('[role="row"][data-row="doc-streams"]');
  check('the switcher (a click on the name): a grid of rows, each with an "Open … in a new tab" button; hovering moves no row', await page.getAttribute('[data-action-for="doc-streams"]', 'aria-label') === 'Open Streaming lower bounds in a new tab' && rw0 === await page.evaluate(() => [...document.querySelectorAll('[role="row"]')].map((r) => Math.round(r.getBoundingClientRect().width)).join()), rw0);
  await page.click('[role="grid"] [data-item="doc-graphs"]');
  await page.waitForFunction(() => (window as any).demo.wb.current.peek().tab.state.doc === 'graphs');
  check('picking a document switches the view, with no new tab', await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length) === 1);
  await page.focus('.wb-bar [data-tab] > [role="tab"]');
  await chord(page, 'd');     // Ctrl+K D: the document switcher
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="grid"]'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  check('… and from the keyboard (Alt+Shift+↓): ↓ moves between rows, → reaches the row' + 's button', await page.evaluate(() => document.activeElement?.classList.contains('wb-row-btn')));
  const ctl = () => page.evaluate(() => ['[data-demo="view"]', '[data-demo="menu"]', '.wb-bar .wb-home-btn'].map((s) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(); }).join('|'));
  const r0 = await ctl();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="grid"]'));
  await page.click('.wb-bar [data-tab] [data-name]');
  await page.waitForSelector('[data-action-for="doc-lemma"]');
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.focus('[data-action-for="doc-lemma"]');
  await page.keyboard.press('Enter');      // Enter on the row's button: a new tab
  await page.waitForFunction(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length === 2);
  await settled(page);
  const after = await page.evaluate(() => ({ docs: [...document.querySelectorAll('[data-tab]')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.querySelector('.wb-tab-label')!.textContent) }));
  check('the row' + 's button: a second tab, the first keeps its document', after.docs.length === 2 && after.docs[0] === 'Sparse graphs and their minors', after);
  check('home and the window controls stay where they were', (await ctl()) === r0, { r0, now: await ctl() });
  await page.click('.wb-tab:first-child', { button: 'right' });
  check('the tab menu has no switcher entry (the name and Ctrl+K D have it)', await page.locator('[role="menu"] >> text=Switch document').count() === 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+w');
  await page.waitForFunction(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length === 1);
  await settled(page);
  check('back to one: its tab in the bar, the controls unmoved', (await visTabs(page, '.wb-bar')) === 1 && (await ctl()) === r0);
  await page.close();
});

// ── the left column's status bar: the host's sideStatus at the column's bottom, below its groups ──
group('side status bar: the host\'s sideStatus at the bottom of the left column, below its stacked groups; 24 px, 12 px text, a hairline above; hides with the column; none on the right or without the slot; four themes', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) {
    const page = await fresh({ theme, sides: true, w: 1400, query: 'fresh&bar=1' });
    await settled(page);
    // a second group in the column (stacked): the status stays below both
    await page.evaluate(() => { const W = (window as any).demo.wb, d = W.sides.peek().left, M = (window as any).demo.M, g = M.sideGroups(d)[0]; if (g.panels.length > 1) W.splitPanel(g.panels[1], 'left', g.id, 'bottom'); });
    await settled(page);
    const r = await page.evaluate(() => {
      const aside = document.querySelector('aside[data-side="left"]')!, st = aside.querySelector('.wb-side-status') as HTMLElement, a = aside.getBoundingClientRect(), b = st.getBoundingClientRect();
      const panes = [...aside.querySelectorAll('.wb-side-pane')].map((p) => p.getBoundingClientRect());
      const cs = getComputedStyle(st), line = getComputedStyle(document.documentElement).getPropertyValue('--rfed-splitter-border');
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true })!;
      const paint = (...l: string[]) => { x.clearRect(0, 0, 1, 1); for (const c of l) { x.fillStyle = c; x.fillRect(0, 0, 1, 1); } const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const lum = (m: number[]) => { const k = m.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
      const pg = getComputedStyle(document.body).backgroundColor, bg = paint(pg, getComputedStyle(aside).backgroundColor), fg = paint(pg, getComputedStyle(aside).backgroundColor, getComputedStyle(st.firstElementChild!).color), L1 = lum(bg), L2 = lum(fg);
      return { panes: panes.length, groupsEnd: Math.max(...panes.map((p) => p.bottom)), top: b.top, bottom: b.bottom, asideB: a.bottom, l: b.left - a.left, w: b.width - a.width, h: b.height,
        font: getComputedStyle(st.firstElementChild!).fontSize, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, borderColor: cs.borderTopColor, line: line.trim(), text: st.textContent, name: st.getAttribute('aria-label'),
        contrast: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2), right: !!document.querySelector('aside[data-side="right"] .wb-side-status'), inBar: !!document.querySelector('.wb-bar [data-demo="version"]') };
    });
    check(`${theme}: the status at the column\'s bottom, full width, below its ${r.panes} stacked groups (they end where it starts); 24 px, 12 px text, a 1 px line above`, r.panes >= 2 && Math.abs(r.groupsEnd - r.top) <= 0.5 && Math.abs(r.bottom - r.asideB) <= 0.5 && Math.abs(r.l) <= 0.5 && Math.abs(r.w) <= 1 && r.h === 24 && r.font === '12px' && r.border === '1px solid', r);
    check(`${theme}: the host\'s content (Preview · dev, no longer in the top bar), named Status, ≥ 4.5:1; none in the right column`, r.text === 'Preview · dev' && r.name === 'Status' && !r.inBar && r.contrast >= 4.5 && !r.right, r);
    if (theme === 'light') {
      await page.evaluate(() => (window as any).demo.wb.collapseSide('left', true));
      await settled(page);
      const hid = await page.evaluate(() => { const st = document.querySelector('.wb-side-status')!; return { vis: getComputedStyle(st).visibility, inert: !!st.closest('[inert]') }; });
      check('the column hidden: its status bar hides with it (not visible, inert)', hid.vis === 'hidden' && hid.inert, hid);
      const p2 = await fresh({ sides: true, w: 1400, query: 'fresh&bar=0' });
      check('no slot from the host (no bar here): no status bar', await p2.evaluate(() => !document.querySelector('.wb-side-status')));
      await p2.close();
    }
    await page.close();
  }
});

// ── the wordmark: the host's mark at the bar's left, its icon and text OPTIONAL items after the tabs (one
//    ordered list: the tabs, the icon, the text, each in while the room left takes it, with a band); optically centred ──
const markGeo = (page: any) => page.evaluate(() => {
  const bar = document.querySelector('.wb-bar')!, br = bar.getBoundingClientRect(), gap = parseFloat(getComputedStyle(bar).getPropertyValue('--wb-gap'));
  const part = (k: string) => { const p = bar.querySelector(`.wb-mark-part[data-part="${k}"]`) as HTMLElement, r = p.getBoundingClientRect(); return { on: p.dataset.on === 'true' && r.width > 0.5, l: r.left, r: r.right, w: r.width }; };
  const icon = part('icon'), text = part('text'), logo = bar.querySelector('[data-demo="logo"]')!.getBoundingClientRect(), brand = bar.querySelector('[data-demo="brand"]')!.getBoundingClientRect();
  const right = [...bar.querySelectorAll('.wb-bar-right > *, .wb-bar > .wb-bar-slot--right')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
  const before = [...bar.querySelectorAll('.wb-bar > .wb-bar-slot--left')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
  const home = bar.querySelector('.wb-strip--inbar .wb-home-btn')?.getBoundingClientRect();
  const layer = bar.querySelector('.wb-bar-mark') as HTMLElement;
  const ends = [icon, text].filter((p) => p.on).map((p) => p.r);
  return { icon: icon.on, text: text.on, inbar: (window as any).demo.wb.inbar.peek(), gap, inset: logo.left - (before.length ? before[0].right : br.left), iconToText: brand.left - logo.right,
    markR: ends.length ? Math.max(...ends) : null, homeL: home?.left ?? null, rightL: right.length ? Math.min(...right.map((r) => r.left)) : br.right, logoL: logo.left, brandL: brand.left,
    hidden: layer.getAttribute('aria-hidden'), stops: layer.querySelectorAll('a, button, input, [tabindex]').length, label: bar.getAttribute('aria-label') };
});
/** The logo's painted square against the bar (its left from the bar's edge or the show button, its top, its bottom), the
 *  word's baseline against the in-bar tab text's (a zero-size inline-block on
 *  the line: its bottom is the baseline), and the two frames' sizes. */
const markMetrics = async (page: any, dpr: number) => {
  const g = await page.evaluate(() => {
    const bar = document.querySelector('.wb-bar')!.getBoundingClientRect(), logo = document.querySelector('[data-demo="logo"]')!.getBoundingClientRect();
    const tg = [...document.querySelectorAll('.wb-bar > .wb-bar-slot--left')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
    const base = (host: Element) => { const p = document.createElement('span'); p.style.cssText = 'display:inline-block;width:0;height:0'; host.append(p); const y = p.getBoundingClientRect().bottom; p.remove(); return y; };
    const svg = document.querySelector('[data-demo="brand"] > svg')!, sr = svg.getBoundingClientRect(), vb = (svg as SVGSVGElement).viewBox.baseVal, tab = document.querySelector('.wb-bar [data-tab] .wb-tab-name');
    const icon = document.querySelector('[data-demo="logo"] > svg')!, ir = icon.getBoundingClientRect();
    return { bar: { l: bar.left, t: bar.top, b: bar.bottom }, lead: tg.length ? tg[0].right : null, logo: { x: logo.x - 1, y: logo.y - 1, w: logo.width + 2, h: logo.height + 2 }, gap: parseFloat(getComputedStyle(document.querySelector('.wb-bar')!).getPropertyValue('--wb-gap')),
      wordBase: sr.top + 12 * sr.height / 20, tabBase: tab ? base(tab) : null, word: { w: sr.width, h: sr.height, vbw: vb.width * 20 / vb.height }, icon: { w: ir.width, h: ir.height } };
  });
  const clip = { x: Math.floor(g.logo.x), y: Math.floor(g.logo.y), width: Math.ceil(g.logo.w), height: Math.ceil(g.logo.h) };
  const png = decodePng(await page.screenshot({ clip })), bg = luma(png.px, 0); let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) if (Math.abs(luma(png.px, (y * png.w + x) * 4) - bg) > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const L = clip.x + x0 / dpr, T = clip.y + y0 / dpr, B = clip.y + (y1 + 1) / dpr;
  return { left: +(L - (g.lead ?? g.bar.l)).toFixed(2), top: +(T - g.bar.t).toFixed(2), bottom: +(g.bar.b - B).toFixed(2), toggle: g.lead != null, gap: g.gap,
    base: g.tabBase == null ? null : +(g.wordBase - g.tabBase).toFixed(2), word: g.word, icon: g.icon };
};
group('wordmark: the placeholders (demo/wordmark/*.svg); the icon\'s 20 px frame at one inset from the bar\'s left, top and bottom (painted; after the show button, the gap); the word\'s 20 px frame with its baseline (y 12) on the tab text\'s (DPR 1 and 2); beside the tabs when there is room; narrowing drops the text, then the icon, then the tabs move down (and back, with a band); no jump; never over the controls; four themes', async () => {
  for (const dpr of [1, 2]) for (const hidden of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 500 }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    await p.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await p.goto('http://wb.test/?fresh&single&theme=light');
    await p.waitForSelector('.wb-tab'); await p.evaluate(() => document.fonts.ready);
    if (hidden) await p.evaluate(() => (window as any).demo.wb.collapseSide('left', true));
    await settled(p);
    await p.waitForFunction(() => document.getAnimations().length === 0);     // the mark's inset follows the slot (a transition)
    const m = await markMetrics(p, dpr);
    const inset = hidden ? Math.abs(m.left - m.gap) <= 0.5 && m.toggle : Math.abs(m.left - m.top) <= 0.5;
    check(`DPR ${dpr}${hidden ? ', the column hidden' : ''}: the logo ${hidden ? 'one gap after the show button' : 'at one inset from the bar\'s left, top and bottom'} (±0.5 px, painted); the icon a button's size (32 × 32); the word 20 px high, as wide as its viewBox; its baseline (y 12) on the tab text\'s (±0.5 px)`,
      inset && Math.abs(m.top - m.bottom) <= 0.5 && m.icon.w === 32 && m.icon.h === 32 && m.word.h === 20 && Math.abs(m.word.w - m.word.vbw) <= 0.02 && m.base != null && Math.abs(m.base) <= 0.5, m);
    await ctx.close();
  }
  // no options left: the switches of the faces and the ε are gone; the two SVGs inlined as they are
  {
    const p = await fresh({ w: 1400, query: 'fresh&single&bar=1&wordmark=lmr&eps=lunate&logo=plain' });
    const e = await p.evaluate(() => { const l = document.querySelector('[data-demo="logo"]')!, b = document.querySelector('[data-demo="brand"]')!;
      return { icon: l.querySelectorAll(':scope > svg').length, word: b.querySelectorAll(':scope > svg').length, attrs: [...l.attributes, ...b.attributes].map((x) => x.name).filter((n) => /face|eps|tile/.test(n)), fill: !!b.querySelector('[fill="currentColor"]') && !!l.querySelector('[fill="currentColor"]'), vb: [l.querySelector('svg')!.getAttribute('viewBox'), b.querySelector('svg')!.getAttribute('viewBox')] }; });
    check('the old switches (?wordmark, ?eps, ?logo=plain) do nothing: one icon svg, one word svg, in currentColor; viewBoxes 20 × 20 and W × 20', e.icon === 1 && e.word === 1 && e.attrs.length === 0 && e.fill && e.vb[0] === '0 0 20 20' && /^0 0 [\d.]+ 20$/.test(e.vb[1] ?? ''), e);
    await p.close();
  }
  const page = await fresh({ sides: true, w: 1400, query: 'fresh&bar=1' });
  await page.addInitScript(() => { const w = window as any, a = Element.prototype.animate; w.__markAnims = [];
    Element.prototype.animate = function (this: Element, k: any, o: any) { if (this.classList?.contains('wb-mark-part')) w.__markAnims.push(JSON.stringify(k)); return a.call(this, k, o); }; });
  await page.reload(); await page.waitForSelector('.wb-tab', { state: 'attached' });
  await settled(page);
  const rows = await markGeo(page);
  check('two groups (no tabs in the bar): icon and text, the icon at its inset from the bar' + 's edge ((44 − 32) / 2), one gap between them', rows.icon && rows.text && !rows.inbar && Math.abs(rows.inset - 6) <= 0.5 && Math.abs(rows.iconToText - rows.gap) <= 0.5, rows);
  check('… not interactive: aria-hidden, nothing focusable; the bar' + 's name stays ReflowEd', rows.hidden === 'true' && rows.stops === 0 && rows.label === 'ReflowEd', rows);
  check('… no animation on load', (await page.evaluate(() => (window as any).__markAnims.length)) === 0);
  await page.evaluate(() => (window as any).demo.wb.collapseSide('left', true));
  await settled(page);
  const tog = await markGeo(page);
  check('the left sidebar hidden: the icon one gap after the show-sidebar button', tog.icon && Math.abs(tog.inset - tog.gap) <= 0.5, tog);
  await page.close();
  // one group: the tabs in the bar AND the mark while there is room; home one gap after the mark
  const single = await fresh({ sides: true, w: 1400, query: 'fresh&single&bar=1' });
  await settled(single);
  const inb = await markGeo(single);
  check('one group, wide: the tabs in the bar and the whole mark before them; home one gap after the text', inb.inbar && inb.icon && inb.text && Math.abs(inb.homeL - inb.markR) <= 0.5 && Math.abs(inb.inset - 6) <= 0.5, inb);
  // the sweep: narrowing drops the text, then the icon, then the tabs move down; widening brings them back in the
  // reverse order, each from a band past where it left; the end states are static (nothing animating)
  const seq: any[] = [];
  const st = (m: any) => `${m.inbar ? 'B' : '-'}${m.icon ? 'I' : '-'}${m.text ? 'T' : '-'}`;
  const ws: number[] = []; for (let w = 1400; w >= 700; w -= 10) ws.push(w); for (let w = 700; w <= 1400; w += 10) ws.push(w);
  let over = 0;
  for (const w of ws) {
    await single.setViewportSize({ width: w, height: 500 });
    await settled(single);
    const m = await markGeo(single);
    if (m.markR != null && m.markR > m.rightL - m.gap + 0.5) over++;
    if (!seq.length || seq.at(-1).s !== st(m)) seq.push({ w, s: st(m) });
  }
  const order = seq.map((x) => x.s).join(' ');
  check('narrowing: BIT → BI- → B-- → (the tabs move down) -IT …; widening back: … BI- … BIT', /^BIT BI- B-- -I?T?/.test(order) && /BI- BIT$/.test(order) && order.includes('-IT'), seq);
  const at = (s: string, from: number) => seq.slice(from).find((x) => x.s === s)?.w;
  const half = seq.findIndex((x, i) => i > 0 && x.w > seq[i - 1].w);
  check('a band: each part comes back at a wider width than it left', (at('BIT', half) ?? 0) > (at('BI-', 0) ?? 1e9) && (at('BI-', half) ?? 0) > (at('B--', 0) ?? 1e9), { seq, half });
  check('the mark never reaches the gap before the right controls', over === 0, over);
  // no jump: a part leaving animates its box's width (the strip after it follows it every frame)
  await single.setViewportSize({ width: (at('BI-', 0) ?? 1100) + 30, height: 500 }); await settled(single);
  await single.evaluate(() => { const w = window as any, a = Element.prototype.animate; w.__markAnims = [];
    Element.prototype.animate = function (this: Element, k: any, o: any) { if (this.classList?.contains('wb-mark-part')) w.__markAnims.push(JSON.stringify(k)); return a.call(this, k, o); }; });
  const frames = [await single.evaluate(() => document.querySelector('.wb-bar [data-tab]')!.getBoundingClientRect().left)];
  await single.setViewportSize({ width: (at('BI-', 0) ?? 1100) - 10, height: 500 });
  const { fr, ts } = await single.evaluate(async () => { const fr: number[] = [], ts: number[] = []; for (let i = 0; i < 30; i++) { ts.push(await new Promise<number>((r) => requestAnimationFrame(r))); fr.push(+document.querySelector('.wb-bar [data-tab]')!.getBoundingClientRect().left.toFixed(1)); } return { fr, ts }; });
  const anims = await single.evaluate(() => (window as any).__markAnims ?? []);
  // no step over what the motion's curve covers in that frame's time: its ease (bar.ts: 220 ms, cubic-bezier(0.16, 1,
  // 0.3, 1)) is steepest at the start, 40 % in its first 16.7 ms, so a fixed 40 % bound failed on any frame a little
  // late; a jump (no animation) is the whole move in one frame
  const ease = (t: number) => { let lo = 0, hi = 1; const bx = (m: number) => 3 * (1 - m) ** 2 * m * 0.16 + 3 * (1 - m) * m * m * 0.3 + m ** 3;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (bx(m) < t) lo = m; else hi = m; } const m = (lo + hi) / 2; return 3 * (1 - m) ** 2 * m + 3 * (1 - m) * m * m + m ** 3; };
  const move = Math.abs(fr.at(-1)! - frames[0]);
  const late = fr.slice(1).map((x: number, i: number) => ({ step: +Math.abs(x - fr[i]).toFixed(1), dt: +(ts[i + 1] - ts[i]).toFixed(1) }))
    .filter((s: { step: number; dt: number }) => s.step > ease(Math.min(1, s.dt / 220)) * move + 0.5);
  check('the text leaving: its width animates to 0 and the tabs follow continuously (no step over the curve\'s share of the move in its frame\'s time)', anims.length >= 1 && /"width"/.test(anims[0] ?? '') && move > 10 && late.length === 0, { late, fr, anims, frames });
  await single.close();
  // themes: legible over the glass's worst ground
  for (const theme of ['light', 'dark', 'sepia', 'hc']) {
    const p = await fresh({ theme, w: 1400, query: 'fresh&bar=1' });
    await settled(p);
    const r = await p.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true })!;
      const paint = (...layers: string[]) => { x.clearRect(0, 0, 1, 1); for (const l of layers) { x.fillStyle = l; x.fillRect(0, 0, 1, 1); } const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const lum = (rgb: string) => { const m = rgb.match(/[\d.]+/g)!.map(Number); const k = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
      const con = (a: string, b: string) => { const p = lum(a), q = lum(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
      const bar = document.querySelector('.wb-bar')!, glass = (getComputedStyle(bar, '::before') as any).backgroundColor, pg = getComputedStyle(document.body).backgroundColor;
      const brand = document.querySelector('[data-demo="brand"]')!, logo = document.querySelector('[data-demo="logo"]')!, ink = getComputedStyle(brand).color, lb = getComputedStyle(logo).color;     // the tile: the icon's currentColor
      const word = Math.min(...[pg, ink].map((u) => { const bg = paint(pg, u, glass); return con(paint(bg, ink), bg); }));
      const b = brand.getBoundingClientRect();
      // the icon: the theme's wordmark.iconForeground (--rfed-wordmark-icon-ink), a step under the text's ink, ≥ 3:1 over the bar's worst ground
      const probe = document.createElement('span'); probe.style.color = 'var(--rfed-wordmark-icon-ink)'; document.body.append(probe); const mark = getComputedStyle(probe).color; probe.style.color = 'var(--rfed-tab-section-ink)'; const sec = getComputedStyle(probe).color; probe.remove();
      const markCon = Math.min(...[pg, ink].map((u) => { const bg = paint(pg, u, glass); return con(paint(bg, mark), bg); }));
      return { word: +word.toFixed(2), w: b.width, svg: !!brand.querySelector('svg'),
        mark, tile: lb, markCon: +markCon.toFixed(2), subdued: con(paint(mark), paint(pg)) < con(paint(ink), paint(pg)), lighter: con(paint(mark), paint(pg)) < con(paint(sec), paint(pg)), hc: document.documentElement.dataset.wbTheme === 'hc' };
    });
    check(`${theme}: the word renders (its svg) with ≥ 4.5:1 against the bar over any content`, r.w > 40 && r.svg && r.word >= 4.5, r);
    check(`${theme}: the icon's tile in the subdued icon ink (wordmark.iconForeground: less contrast with the page than the text's ink and, but in high contrast (≥ 7:1), the section's), ≥ 3:1 against the bar over any content`, r.tile === r.mark && r.subdued && (r.hc ? r.markCon >= 7 : r.lighter) && r.markCon >= 3, r);
    await p.close();
  }
});

// ── in-bar tabs: 1/n of the room between home and the right controls; in while they fit, else the row; FLIP ──
const barGeo = (page: any) => page.evaluate(() => {
  const bar = document.querySelector('.wb-bar')!, br = bar.getBoundingClientRect(), home = bar.querySelector('.wb-home-btn')?.getBoundingClientRect() ?? bar.querySelector('.wb-bar-fill')!.getBoundingClientRect();     // home is in the bar with the tabs
  const right = [...bar.querySelectorAll('.wb-bar-right > *, .wb-bar > .wb-bar-slot--right')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
  const rightL = right.length ? Math.min(...right.map((r) => r.left)) : br.right;
  const tabs = [...bar.querySelectorAll('[data-tab]')].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
  const strip = bar.querySelector('.wb-strip--inbar');
  const gap = strip ? parseFloat(getComputedStyle(strip.querySelector('.wb-tabs')!).columnGap) || 0 : 0;
  return { inbar: (window as any).demo.wb.inbar.peek(), n: tabs.length, widths: tabs.map((r) => +r.width.toFixed(2)), first: tabs[0]?.left ?? 0, last: tabs.at(-1)?.right ?? 0,
    homeR: home.width ? home.right : home.left - 4, rightL, sum: tabs.reduce((a, r) => a + r.width, 0) + gap * Math.max(0, tabs.length - 1), row: [...document.querySelectorAll('.wb-groups [data-tab]')].filter((t) => t.getBoundingClientRect().width > 0).length };
});
group('in-bar tabs: 1/n of the free room up to the right controls, a comfortable gap; to the row and back once; FLIP; focus', async () => {
  const page = await fresh({ w: 1400, query: 'fresh&single&bar=1' });
  await events(page);
  await page.evaluate(() => { const w = window as any; w.__place = []; w.demo.wb.on('tabsplace', (d: any) => w.__place.push(d.inbar)); });
  await settled(page);
  const g1 = await barGeo(page);
  const free = (g: any) => g.rightL - 6 - (g.homeR + 6);
  check('1 tab: in the bar, it fills the free room from home to the right controls (±1 px)', g1.inbar && g1.n === 1 && Math.abs(g1.sum - free(g1)) <= 1 && Math.abs(g1.first - (g1.homeR + 6)) <= 1, g1);
  check('… the one gap (--wb-gap, 6 px) before the right controls, no more', Math.abs(g1.rightL - g1.last - 6) <= 0.5, g1);
  const trail = await page.evaluate(() => [...document.querySelectorAll('.wb-bar-right > *, .wb-bar > .wb-bar-slot--right')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0).map((r, i, a) => i ? +(r.left - a[i - 1].right).toFixed(2) : null).slice(1));
  check('… and between the trailing items (the status, Saved, the buttons): the one gap each', trail.length >= 2 && trail.every((d: number) => Math.abs(d - 6) <= 0.5), trail);
  // 1 → 2: the room re-divides smoothly (the first tab narrows over frames, then equals the other)
  const fr = await page.evaluate(async () => {
    const w = (window as any).demo.wb, first = document.querySelector('.wb-bar [data-tab]')!;
    w.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } }, { focus: false });
    const out: number[] = [];
    let anim: any = null;
    for (let i = 0; i < 24; i++) { await new Promise((r) => requestAnimationFrame(r)); out.push(+first.getBoundingClientRect().width.toFixed(1));
      if (!anim) { const a = first.getAnimations().find((x: any) => x.effect.getKeyframes().some((k: any) => k.width)) as any; if (a) anim = { d: a.effect.getTiming().duration, k: a.effect.getKeyframes().map((k: any) => k.width) }; } }
    return { out, anim };
  });
  const g2 = await barGeo(page);
  const ws = fr.out, mids = ws.filter((x: number) => x < g1.widths[0] - 1 && x > g2.widths[0] + 1);
  const mono = ws.every((x: number, i: number) => i === 0 || x <= ws[i - 1] + 0.5);
  // a width animation from the old width to the new (≥ 150 ms); the frames in between where the engine paints them (headless WebKit's frames are sparse)
  const anim = fr.anim && fr.anim.d >= 150 && parseFloat(fr.anim.k[0]) > parseFloat(fr.anim.k.at(-1));
  check('1 → 2: the first tab narrows smoothly (a width animation, monotonic frames), to half', anim && mids.length >= (BROWSER === 'webkit' ? 1 : 3) && mono && Math.abs(ws.at(-1) - g2.widths[0]) <= 0.5, fr);
  check('2 tabs: both in the bar, equal (1/n), together they fill the free room exactly (±1 px)', g2.inbar && g2.n === 2 && Math.abs(g2.widths[0] - g2.widths[1]) <= 0.5 && Math.abs(g2.sum - free(g2)) <= 1 && g2.row === 0, g2);
  // the widths come from the bar and the count, never the text: a longer section and a rename change nothing
  const w0 = (await barGeo(page)).widths.join();
  await page.evaluate(() => { const w = (window as any).demo.wb; const t = (window as any).demo.M.allTabs(w.layout.peek())[0]; w.setState(t.id, { section: 'A much, much longer section name than before' }); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  check('a longer section text changes no in-bar tab width (it truncates inside)', (await barGeo(page)).widths.join() === w0, { w0, now: (await barGeo(page)).widths.join() });
  await page.evaluate(() => { const w = (window as any).demo.wb; const t = (window as any).demo.M.allTabs(w.layout.peek())[0]; w.setState(t.id, { section: '1 Introduction' }); });
  // narrowing and widening: one move each way; never past the controls; in the bar only with no truncation
  await page.focus('.wb-bar [data-tab].wb-tab--on');
  const focused = await page.evaluate(() => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab'));
  const seen: any[] = [];
  const steps: number[] = []; for (let w = 1400; w >= 700; w -= 25) steps.push(w); for (let w = 700; w <= 1400; w += 25) steps.push(w);
  for (const w of steps) {
    await page.setViewportSize({ width: w, height: 600 });
    await settled(page);
    const g = await barGeo(page);
    seen.push({ w, ...g, over: g.inbar && g.last > g.rightL - 6 + 0.5 });
  }
  const place = await page.evaluate(() => (window as any).__place);
  check('narrowing to 700 px and back: to the row once, into the bar once (hysteresis)', place.join() === 'false,true', { place, ws: seen.filter((s, i) => i && s.inbar !== seen[i - 1].inbar).map((s) => s.w) });
  check('in the bar the tabs never reach the controls' + "'" + ' gap; in the row, the bar holds no tab', seen.every((s) => !s.over && (s.inbar ? s.row === 0 : s.n === 0 && s.row === 2)), seen.filter((s) => s.over || (!s.inbar && s.n)).slice(0, 3));
  check('the focus stays on its tab through both moves', await page.evaluate(() => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab')) === focused);
  // the moved end state equals the static one
  await page.setViewportSize({ width: 700, height: 600 });
  await settled(page);
  const geo = (p: any) => p.evaluate(() => [...document.querySelectorAll('.wb-bar .wb-btn, [data-tab], .wb-tab-label')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); }).join('|'));
  const json = await page.evaluate(() => (window as any).demo.wb.serialize()), end = await geo(page);
  const ctx2 = await browser.newContext({ viewport: { width: 700, height: 600 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await p2.goto('http://wb.test/?fresh&single&bar=1&sides=0&theme=light');
  await p2.waitForSelector('.wb-bar');
  await p2.evaluate((j: string) => (window as any).demo.wb.load(j), json);
  await p2.waitForFunction(() => !(window as any).demo.wb.inbar.peek());
  await p2.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  check('the end state after the move equals the static layout', (await geo(p2)) === end, { end, static: await geo(p2) });
  await ctx2.close();
  // a second group: the tabs go to their rows; one group again: back in the bar
  await page.setViewportSize({ width: 1400, height: 600 });
  await settled(page);
  await page.evaluate(() => { const w = (window as any).demo.wb; const t = w.open({ view: 'text', state: { text: 'x' } }); w.split(t, 'right', undefined, { copy: false }); });
  await settled(page);
  const two = await barGeo(page);
  await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; const gs = M.groups(w.layout.peek()); for (const t of gs[1].tabs) w.close(t.id); });
  await settled(page);
  const back = await barGeo(page);
  check('a second group: the tabs leave the bar for their rows; one group again: back in the bar', !two.inbar && two.n === 0 && back.inbar && back.n >= 1, { two, back });
  await page.close();
});

group('in-bar tabs: no count limit: 2, 3, 4 tabs stay in the bar while n × --wb-tab-min fits; a fifth past it moves them to the row', async () => {
  const page = await fresh({ w: 2000, query: 'fresh&single&bar=1' });
  await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; w.replace(M.allTabs(w.layout.peek())[0].id, { view: 'text', state: { text: 'a' } }); });
  for (const n of [2, 3, 4]) {
    await page.evaluate(() => (window as any).demo.wb.open({ view: 'text', state: { text: 'b' } }, { focus: false }));
    await settled(page);
    const g = await barGeo(page);
    const f = await fitNow(page, 'bar');
    check(`${n} tabs, n × MIN + the gaps within the room: all in the bar`, f.room >= n * f.min + (n - 1) * f.gap && g.inbar && g.n === n && g.row === 0, { g, f });
  }
  await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } }, { focus: false }));
  await settled(page);
  const f5 = await shareTo(page, 'bar', (await fitNow(page, 'bar')).min - 1);     // a window where 5 × MIN no longer fits
  const g5 = await barGeo(page);
  check('a fifth past n × --wb-tab-min: all five move to the row', !g5.inbar && g5.n === 0 && g5.row === 5 && f5.n === 5, { g5, f5 });
  await page.close();
});

// ── one tab T in the top bar: a title (no chip, no ×); home shows over T; a document from there replaces T ──
// ── one active-tab look: in the top bar and in the row, light and dark, after the move ──
group('active tab: the same ground, ring and ink in the top bar and in the row (light, dark, after the move)', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, w: 1400, query: 'fresh&single&bar=1' });
    await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } }));
    await settled(page);
    const st = () => page.evaluate(() => { const t = document.querySelector('[data-tab].wb-tab--on:not([style*="display: none"])') as HTMLElement;
      const all = [...document.querySelectorAll('[data-tab].wb-tab--on')].filter((e) => e.getBoundingClientRect().width > 0)[0]!;
      const cs = getComputedStyle(all); void t; return { where: all.closest('.wb-bar') ? 'bar' : 'row', bg: cs.backgroundColor, ring: cs.boxShadow, ink: cs.color, name: getComputedStyle(all.querySelector('.wb-tab-label')!).color }; });
    const a = await st();
    await page.setViewportSize({ width: 660, height: 600 });     // (above the narrow rule, 640: there the bar keeps its active tab, strip.ts single)
    await settled(page);
    const b = await st();
    const strip = (x: any) => ({ bg: x.bg, ring: x.ring, ink: x.ink, name: x.name });
    check(`${theme}: the active tab looks the same in the bar and, after the move, in the row`, a.where === 'bar' && b.where === 'row' && JSON.stringify(strip(a)) === JSON.stringify(strip(b)), { a, b });
    await page.close();
  }
});

// ── the one TabStrip in both hosts: the same tab behaviour in the top bar and in a row ──
for (const host of ['bar', 'row']) group(`host=${host}: keyboard, reorder by drag, Escape cancels a drag, drag out to split, the section menu, stable boxes, the active look`, async () => {
  const page = await fresh({ w: 1500, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&single&bar=0' });
  await page.evaluate(() => { const w = (window as any).demo.wb; w.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } }, { focus: false }); w.open({ view: 'text', state: { text: 'x' } }, { focus: false }); });
  await settled(page);
  const where = host === 'bar' ? '.wb-bar .wb-strip--inbar' : '.wb-groups .wb-strip';
  const ids = () => page.evaluate((w: string) => [...document.querySelectorAll(`${w} [data-tab]`)].filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.getAttribute('data-tab')), where);
  const i0 = await ids();
  check(`${host}: three tabs in the ${host === 'bar' ? 'top bar' : 'row'}`, i0.length === 3 && await page.evaluate(() => (window as any).demo.wb.inbar.peek()) === (host === 'bar'), i0);
  // keyboard: → moves, End, Home; the focus on the tab
  await page.focus(stopSel(i0[0]!));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, i0[1]);
  await page.keyboard.press('End');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, i0[2]);
  await page.keyboard.press('Home');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, i0[0]);
  check(`${host}: → End Home move between the tabs`, true);
  // stable boxes: hover and activate move no tab
  const rects = () => page.evaluate((w: string) => [...document.querySelectorAll(`${w} [data-tab]`)].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => v.toFixed(1)).join(); }).join('|'), where);
  const r0 = await rects();
  await page.hover(tabSel(i0[2]!)); await page.click(tabSel(i0[1]!), { position: { x: 6, y: 6 } }); await settled(page);
  check(`${host}: hover and activation leave every tab box unchanged`, (await rects()) === r0, { r0, now: await rects() });
  // the active look: the shared tokens
  const look = await page.evaluate((id: string) => { const t = document.querySelector(`[data-tab="${id}"]`)!, cs = getComputedStyle(t), probe = document.createElement('div');
    probe.style.background = 'var(--rfed-tab-active-bg)'; t.closest('.wb-root')!.append(probe); probe.style.color = 'currentColor'; const want = getComputedStyle(probe).backgroundColor; probe.remove(); return { bg: cs.backgroundColor, want }; }, i0[1]);
  check(`${host}: the active tab has the shared ground (--rfed-tab-active-bg)`, look.bg !== 'rgba(0, 0, 0, 0)', look);
  // the section menu: a press on the active tab's section opens the row menu; Escape back to the tab
  await page.click(`${tabSel(i0[1]!)} [data-sub]`);
  await page.waitForSelector('[role="grid"][aria-label="Sections"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="grid"]'));
  check(`${host}: the section menu opens and closes`, true);
  // reorder by drag: the first tab past the last
  const a = await center(page, tabSel(i0[0]!)), z = await center(page, tabSel(i0[2]!));
  await drag(page, a, { x: z.b.x + z.b.width - 4, y: z.y });
  await page.waitForFunction(([w, id]: string[]) => [...document.querySelectorAll(`${w} [data-tab]`)].filter((t) => t.getBoundingClientRect().width > 0).at(-1)?.getAttribute('data-tab') === id, [where, i0[0]]);
  check(`${host}: a drag reorders the tabs (the first is now last)`, true);
  // Escape cancels a drag
  const i1 = await ids();
  const b = await center(page, tabSel(i1[0]!));
  await drag(page, b, { x: b.x + 200, y: b.y }, { release: false });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settled(page);
  check(`${host}: Escape cancels a drag (the order unchanged)`, JSON.stringify(await ids()) === JSON.stringify(i1), { i1, now: await ids() });
  // drag out to the body's right edge: a split (in the bar host the tabs leave the bar for their rows)
  const c = await center(page, tabSel(i1[0]!));
  await drag(page, c, { x: 1490, y: 420 });
  await page.waitForFunction(() => document.querySelectorAll('.wb-group').length === 2);
  await settled(page);
  const after = await page.evaluate(() => ({ groups: document.querySelectorAll('.wb-group').length, inbar: (window as any).demo.wb.inbar.peek(), row: [...document.querySelectorAll('.wb-groups [data-tab]')].filter((t) => t.getBoundingClientRect().width > 0).length }));
  check(`${host}: a drag to the edge splits; the tabs in their rows`, after.groups === 2 && !after.inbar && after.row === 3, after);
  await page.close();
});

// ── the tab rects never depend on the scroll: in the bar and in the rows ──
group('scrolling through every section moves no tab (in the bar and in the rows)', async () => {
  for (const [n, w] of [[2, 1400], [5, 1100]] as [number, number][]) {
    const page = await fresh({ w, query: 'fresh&single&bar=1' });
    await page.evaluate((n: number) => { const w = (window as any).demo.wb, M = (window as any).demo.M; const first = M.allTabs(w.layout.peek())[0].id;
      w.replace(first, { view: 'document', state: { doc: 'konig', section: '1 Introduction', paras: 2 } });
      for (let i = 1; i < n; i++) w.open({ view: 'document', state: { doc: ['graphs', 'streams', 'lemma', 'konig'][i % 4], paras: 2 } }, { focus: false });
      w.activate(first); }, n);
    await settled(page);
    const r = await page.evaluate(async () => {
      const id = (window as any).demo.wb.current.peek().tab.id, sc = document.querySelector(`#${id}-panel .demo-doc`) as HTMLElement;
      const rects = () => [...document.querySelectorAll('[data-tab]')].map((t) => t.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => [b.x, b.y, b.width, b.height]);
      const r0 = rects(), texts = new Set<string>();
      let worst = 0;
      for (let y = 0; y <= sc.scrollHeight - sc.clientHeight; y += 40) {
        sc.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const now = rects();
        texts.add(document.querySelector(`[data-tab="${id}"] .wb-tab-sec-text, [data-tab="${id}"] .wb-tab-sub-label`)?.textContent ?? '');
        for (let i = 0; i < Math.max(now.length, r0.length); i++) for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs((now[i]?.[k] ?? 1e6) - (r0[i]?.[k] ?? 0)));
      }
      return { worst: +worst.toFixed(2), sections: texts.size, inbar: (window as any).demo.wb.inbar.peek() };
    });
    check(`${n} tabs (${r.inbar ? 'in the bar' : 'in the row'}): ${r.sections} sections scrolled through, no tab rect moves (≤ 0.5 px)`, r.sections >= 5 && r.worst <= 0.5, r);
    await page.close();
  }
});

// ── the top bar is glass, as the strips: contrast over any content, the content under it, the fallback, stable ──
group('glass top bar: 4.5:1 over any content, content under it (first line clear), scrollbar below, fallback, no flicker', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, query: 'fresh&single&bar=1' });
    await settled(page);
    const r = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true })!;
      const paint = (...layers: string[]) => { x.clearRect(0, 0, 1, 1); for (const l of layers) { x.fillStyle = l; x.fillRect(0, 0, 1, 1); } const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const lum = (rgb: string) => { const m = rgb.match(/[\d.]+/g)!.map(Number); const k = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
      const con = (a: string, b: string) => { const p = lum(a), q = lum(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
      const pg = getComputedStyle(document.body).backgroundColor, ink = getComputedStyle(document.documentElement).getPropertyValue('--rfed-ink').trim() || getComputedStyle(document.body).color;
      const bar = document.querySelector('.wb-bar')!, glass = (getComputedStyle(bar, '::before') as any).backgroundColor;
      const out: any[] = [];
      const els = [...bar.querySelectorAll('.wb-btn, .wb-tab-label, .wb-tab-sec')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden');
      for (const under of [ink, pg]) for (const e of els) {
        // the ground: the glass over the content, then every ground between it and the element
        const grounds: string[] = []; for (let n: Element | null = e; n && n !== bar; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)') grounds.unshift(b); }
        const bg = paint(pg, under, glass, ...grounds);
        out.push({ el: (e as HTMLElement).dataset.demo ?? e.className.split(' ')[0], c: +con(paint(bg, getComputedStyle(e).color), bg).toFixed(2) });
      }
      const bf = (getComputedStyle(bar, '::before') as any).backdropFilter || (getComputedStyle(bar, '::before') as any).webkitBackdropFilter;
      const grp = document.querySelector('.wb-group')!.getBoundingClientRect(), b = bar.getBoundingClientRect();
      const sc = document.querySelector('.wb-panel:not(.wb-panel--hidden) .demo-doc') as HTMLElement;
      return { low: out.filter((o) => o.c < 4.5), n: out.length, min: Math.min(...out.map((o) => o.c)), bf, under: grp.top - b.top, first: sc.firstElementChild!.getBoundingClientRect().top - b.bottom };
    });
    check(`${theme}: every text and button in the top bar ≥ 4.5:1 over the worst content under the glass`, r.low.length === 0 && r.n > 4, r.low.length ? r.low : { n: r.n, min: r.min });
    check(`${theme}: the bar blurs; the top group runs under it; at rest the first line is below it`, /blur/.test(r.bf) && r.under === 0 && r.first >= 0, r);
    if (theme === 'light') {
      // the scrollbar starts below the bar (in the bar mode), and below the tab row too (with a row)
      for (const row of [false, true]) {
        if (row) { await page.evaluate(() => { const w = (window as any).demo.wb; for (let i = 0; i < 7; i++) w.open({ view: 'document', state: { doc: 'konig', section: '2 Definitions' } }, { focus: false }); }); await settled(page); }
        const sc = await page.evaluate(() => { const v = document.querySelector('.wb-panel:not(.wb-panel--hidden) [data-wb-scroll]') as HTMLElement; v.scrollTop = 0;
          const r = v.getBoundingClientRect(), strip = document.querySelector('.wb-groups .wb-strip:not([hidden])'), sb = strip && strip.getBoundingClientRect().height > 0 ? strip.getBoundingClientRect().bottom : 0;
          return { right: r.right, top: r.top, sb: v.offsetWidth - v.clientWidth, line: Math.max(document.querySelector('.wb-bar')!.getBoundingClientRect().bottom, sb), inbar: (window as any).demo.wb.inbar.peek(), webkit: CSS.supports('selector(::-webkit-scrollbar)'), mode: document.documentElement.dataset.wbScrollbars }; });
        // overlay bars (macOS, iOS, headless WebKit on Linux) stay the platform's own (scrollbars.ts): no styled track to inset
        if (sc.webkit && sc.mode === 'overlay') skip(`the scrollbar thumb starts at or below the ${row ? 'bar and the tab row' : 'top bar'}`, 'overlay scrollbars here: the platform\'s own, not styled');
        else if (sc.webkit) {
          await page.evaluate(() => { for (const e of document.querySelectorAll('.wb-bar, .wb-strip')) (e as HTMLElement).style.visibility = 'hidden'; });
          const png = decodePng(await page.screenshot({ clip: { x: Math.floor(sc.right - sc.sb + 3), y: 0, width: Math.max(2, sc.sb - 6), height: 300 } }));
          await page.evaluate(() => { for (const e of document.querySelectorAll('.wb-bar, .wb-strip')) (e as HTMLElement).style.visibility = ''; });
          let first = -1;
          for (let y = 0; y < png.h && first < 0; y++) for (let x = 0; x < png.w; x++) if (Math.abs(luma(png.px, (y * png.w + x) * 4) - luma(png.px, 0)) > 25) { first = y; break; }
          check(`the scrollbar thumb starts at or below the ${row ? 'bar and the tab row' : 'top bar'}`, sc.inbar === !row && first >= 0 && first >= sc.line - 1, { ...sc, first });
        } else check(`Firefox: the scroller starts at or below the ${row ? 'bar and the row' : 'bar'}`, sc.top >= sc.line - 0.5, sc);
      }
    }
    // the fallback: opaque, no blur
    await page.evaluate(() => document.querySelector('.wb-root')!.classList.add('wb-solid'));
    const solid = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.wb-bar')!, '::before') as any; return { bg: s.backgroundColor, page: getComputedStyle(document.body).backgroundColor, bf: s.backdropFilter }; });
    check(`${theme}: the fallback (reduced transparency, no backdrop-filter, .wb-solid): the bar opaque, no blur`, solid.bg === solid.page && (!solid.bf || solid.bf === 'none'), solid);
    await page.evaluate(() => document.querySelector('.wb-root')!.classList.remove('wb-solid'));
    // flicker: the frame-to-frame change of the bar while the content scrolls under it, as the strips' measurement
    // (scripts/blur-bench.ts): no more than the strip's under the same scroll, and small
    await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; for (const t of M.allTabs(w.layout.peek()).slice(1)) w.close(t.id); w.open({ view: 'document', state: { doc: 'konig' } }, { focus: false }); });
    await page.setViewportSize({ width: 1280, height: 800 });
    await settled(page);
    const measure = async (sel: string) => {
      const b = await page.locator(sel).first().boundingBox();
      const clip = { x: Math.round(b.x + 40), y: Math.round(b.y), width: 400, height: Math.round(b.height) };
      const frames: Uint8Array[] = [];
      for (let i = 0; i < 24; i++) {
        await page.evaluate((i: number) => { document.querySelector('.wb-panel:not(.wb-panel--hidden) .demo-doc')!.scrollTop = 40 + i * 6; }, i);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const png = decodePng(await page.screenshot({ clip }));
        const l = new Uint8Array(png.w * png.h); for (let k = 0; k < l.length; k++) l[k] = luma(png.px, k * 4); frames.push(l);
      }
      let f = 0; for (let i = 1; i < frames.length; i++) { let s = 0; for (let k = 0; k < frames[i].length; k++) s += Math.abs(frames[i][k] - frames[i - 1][k]); f += s / frames[i].length; }
      return +(f / (frames.length - 1)).toFixed(3);
    };
    const fb = await measure('.wb-bar-right');     // the bar's quiet part: its controls do not move
    check(`${theme}: no flicker: the bar changes ≤ 1 luma level per pixel per frame while the content scrolls under it`, fb <= 1, { bar: fb });
    await page.close();
  }
});

// ── the fit is a minimum, never the text: one line (and the top bar) while every tab gets --wb-tab-min ──
// the room for tabs, from the DOM. A row: its tabs box (home and the side toggles outside it). The top bar: from the
// strip's (or the filler's) start past home and the gap, to the right controls less the gap.
const fitNow = (page: any, host: string) => page.evaluate((host: string) => {
  const W = (window as any).demo, root = document.querySelector('.wb-root')!, min = parseFloat(getComputedStyle(root).getPropertyValue('--wb-tab-min'));
  if (host === 'row') {
    const box = document.querySelector('.wb-group .wb-tabs') as HTMLElement, cs = getComputedStyle(box);
    return { min, n: box.querySelectorAll('.wb-tab').length, gap: parseFloat(cs.columnGap) || 0, room: box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), one: box.dataset.form === 'one' };
  }
  const bar = document.querySelector('.wb-bar')!, bs = getComputedStyle(bar), gap = parseFloat(bs.getPropertyValue('--wb-gap')) || 0;
  const lead = bar.querySelector('.wb-strip--inbar, .wb-bar-fill')!.getBoundingClientRect(), home = bar.querySelector('.wb-strip--inbar .wb-home-btn')?.getBoundingClientRect().width ?? parseFloat(bs.getPropertyValue('--wb-btn-h'));
  const right = [...bar.querySelectorAll('.wb-bar-right > *, .wb-bar > .wb-bar-slot--right')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
  const rightL = right.length ? Math.min(...right.map((r) => r.left)) : bar.getBoundingClientRect().right - parseFloat(bs.paddingRight);
  return { min, n: W.M.allTabs(W.wb.layout.peek()).length, gap, room: rightL - gap - (lead.left + home + gap), one: W.wb.inbar.peek() };
}, host);
// a tab's share (its 1/n of the room) set to `per` by the window's width (re-measured: the columns may scale)
async function shareTo(page: any, host: string, per: number) {
  for (let i = 0; i < 4; i++) {
    const f = await fitNow(page, host), want = per * f.n + f.gap * (f.n - 1);
    if (Math.abs(f.room - want) <= 0.25 * f.n) break;
    const vw = page.viewportSize().width + Math.round(want - f.room);
    await page.setViewportSize({ width: vw, height: page.viewportSize().height });
    // the observers' delivery, the decision in the next frame, then the switch's moves
    await page.evaluate(() => new Promise((r) => { let k = 4; const f = () => (--k ? requestAnimationFrame(f) : r(0)); requestAnimationFrame(f); }));
    await settled(page);
  }
  const f = await fitNow(page, host);
  return { ...f, per: +((f.room - f.gap * (f.n - 1)) / f.n).toFixed(2), spare: +((f.room - f.gap * (f.n - 1)) / f.n - f.min).toFixed(2) };
}
group('(d) fit: one line (the top bar) while every tab gets --wb-tab-min (n × MIN + the gaps); the switch at the minimum, the band 0 … 8 px a tab; the text never decides', async () => {
  for (const host of ['row', 'bar']) {
    const page = await fresh({ w: 1400, query: `fresh&single&bar=${host === 'bar' ? 1 : 0}` });
    await events(page);
    await page.evaluate(() => { const w = (window as any).demo.wb; w.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } }); });
    await settled(page);
    for (const n of [2, 3]) {
      if (n === 3) { await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'streams', section: 'Lower bound' } })); await settled(page); }
      const min = (await fitNow(page, host)).min;
      if (n === 2) check(`${host}: the minimum is the token, 280 px`, min === 280, min);
      const at = async (spare: number, one: boolean, what: string) => { const f = await shareTo(page, host, min + spare); check(`${host}, ${n} tabs: ${what}`, f.n === n && f.one === one, f); };
      await at(8.5, true, '8 px a tab over the minimum: one line');
      await at(-1, false, '1 px a tab under the minimum: the other form');
      await at(4, false, 'back to 4 px over: still the other form (the band)');
      await at(8.5, true, 'back to 8 px over: one line again');
      await at(1, true, 'down to 1 px over: still one line (the switch is at n × MIN)');
      // the text never decides: a much longer section and name change no form
      const k = (await evs(page, host === 'bar' ? 'change' : 'tabform')).length, place = await page.evaluate(() => (window as any).demo.wb.inbar.peek());
      await page.evaluate(() => { const w = (window as any).demo.wb; w.setState(w.current.peek().tab.id, { section: '4.2 Proof of Theorem 3 and a much, much longer section name than any tab holds' }); });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await settled(page);
      const f = await fitNow(page, host);
      check(`${host}, ${n} tabs: a section far longer than the tab: the same form`, f.one && (host === 'bar' ? (await page.evaluate(() => (window as any).demo.wb.inbar.peek())) === place : (await evs(page, 'tabform')).length === k), f);
      await page.evaluate(() => { const w = (window as any).demo.wb; w.setState(w.current.peek().tab.id, { section: '1 Introduction' }); });
    }
    await page.close();
  }
  // the token decides: overridden, the switch point follows it
  const page = await fresh({ w: 1400, query: 'fresh&single&bar=0' });
  await page.evaluate(() => { const w = (window as any).demo.wb; w.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } }); });
  await settled(page);
  await page.evaluate(() => (document.querySelector('.wb-root') as HTMLElement).style.setProperty('--wb-tab-min', '400px'));
  const a = await shareTo(page, 'row', 401);
  const b = await shareTo(page, 'row', 399);
  check('--wb-tab-min 400 px: one line at 401 px a tab, two at 399', a.min === 400 && a.one && !b.one, { a, b });
  await page.close();
});

// ── one line (the top bar, a row): too long, the name and the section both truncate with "…", sharing the line ──
group('one line: a long name and a long section: the section truncates first (to its minimum), then the name; neither disappears, the name keeping its minimum; the top bar and a row; active and not (wbdecide: the name matters more)', async () => {
  for (const host of ['bar', 'row']) {
    const page = await fresh({ w: 1400, query: `fresh&single&bar=${host === 'bar' ? 1 : 0}` });
    const LONG = 'A Extended proof of Theorem 3, with every case of the construction spelled out';
    await page.evaluate((s: string) => { const w = (window as any).demo.wb, M = (window as any).demo.M; w.replace(M.allTabs(w.layout.peek())[0].id, { view: 'document', state: { doc: 'konig', section: s } });
      w.open({ view: 'document', state: { doc: 'lemma', section: s } }, { focus: false }); w.open({ view: 'document', state: { doc: 'streams', section: s } }, { focus: false }); }, LONG);
    await settled(page);
    const f = await shareTo(page, host, 290);
    const tabs = await page.evaluate((host: string) => [...document.querySelectorAll(host === 'bar' ? '.wb-bar [data-tab]' : '.wb-groups [data-tab]')].map((t) => {
      const content = (e: Element) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(), af = getComputedStyle(e, '::after'), aw = /^(none|normal)$/.test(af.content) ? 0 : parseFloat(af.width) || 0; return r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - aw; };     // (the right padding is the ::after spacer)
      const lab = t.querySelector('.wb-tab-line .wb-tab-label')!, sec = t.querySelector('.wb-tab-line .wb-tab-sec')!, st = sec.querySelector('.wb-tab-sec-text')!, nm = lab.querySelector('.wb-tab-name')!;
      return { active: t.querySelector('[role="tab"]')!.getAttribute('aria-selected') === 'true', name: lab.textContent, nameCut: nm.scrollWidth > nm.clientWidth + 1 && getComputedStyle(nm).textOverflow === 'ellipsis',
        secCut: st.scrollWidth > st.clientWidth + 1 && getComputedStyle(st).textOverflow === 'ellipsis', nameW: +content(lab).toFixed(1), secW: +content(sec).toFixed(1),
        min: parseFloat((t as HTMLElement).style.getPropertyValue('--wb-name-min')), secOuter: sec.getBoundingClientRect().width, secBasis: parseFloat(getComputedStyle(sec).flexBasis), shown: getComputedStyle(sec).display !== 'none' && sec.getBoundingClientRect().width > 0 };
    }), host);
    check(`${host}: one line at 290 px a tab`, f.one && tabs.length === 3, f);
    check(`${host}: every tab: the section truncates with "…" (never disappears)`, tabs.every((t: any) => t.secCut && t.shown), tabs);
    check(`${host}: the name truncates only with the section at its minimum or below, and keeps its own minimum`, tabs.every((t: any) => (!t.nameCut || t.secOuter <= t.secBasis + 0.5) && t.nameW >= t.min - 1.5), tabs);
    check(`${host}: the short names ("On the lemma of Kőnig", "Streaming lower bounds") whole`, tabs.filter((t: any) => !/Kőnig’s/.test(t.name)).every((t: any) => !t.nameCut), tabs);
    await page.close();
  }
});
