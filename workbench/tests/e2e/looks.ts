// The workbench's browser suite, area "looks": looks: glass, the viewport, the kit gallery, light and dark, overflow. Run by tests/e2e.ts (--area looks).
import { req, pw, argv, ONLY, HTML, JS, fails, check, skip, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── the glass strip: text contrast over any content; the name above the section; the solid fallback ──
group('glass strip: contrast over content, name above section, fallback', async () => {
  // both forms: two lines (the scenario: a shared name), one line (a wide window, distinct documents)
  for (const [c, w, q] of [['two lines', 1280, 'fresh&scenario=paper'], ['one line', 2400, 'fresh']] as const) for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, w, query: q });
    await page.waitForFunction((f: string) => document.querySelector('.wb-group')?.getAttribute('data-form') === f, c === 'one line' ? 'one' : 'two');
    const r = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true })!;
      const paint = (...layers: string[]) => { x.clearRect(0, 0, 1, 1); for (const l of layers) { x.fillStyle = l; x.fillRect(0, 0, 1, 1); } const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const cs = (e: Element, p = 'color') => (getComputedStyle(e) as any)[p];
      const lum = (rgb: string) => { const m = rgb.match(/[\d.]+/g)!.map(Number); const k = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
      const con = (a: string, b: string) => { const p = lum(a), q = lum(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
      const page = cs(document.body, 'backgroundColor');
      // the worst content under the glass: solid text colour (and also the page itself)
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--rfed-ink').trim();
      const out: any[] = [];
      const strip = document.querySelector('.wb-strip')!, glass = (getComputedStyle(strip, '::before') as any).backgroundColor;
      for (const under of [ink, page]) {
        const ground = paint(page, under, glass);
        for (const t of document.querySelectorAll('.wb-group .wb-tab')) {
          const bg = paint(page, under, glass, cs(t, 'backgroundColor'));
          const name = t.querySelector('.wb-tab-label'), sec = t.querySelector('.wb-tab-sub-label, .wb-tab-sec-text');
          if (!name || getComputedStyle(name).display === 'none') continue;
          const n = con(paint(bg, cs(name)), bg), s = sec && getComputedStyle(sec).display !== 'none' ? con(paint(bg, cs(sec)), bg) : null;
          out.push({ where: 'tab', on: t.querySelector('[role="tab"]')!.getAttribute('aria-selected'), shared: !!t.querySelector('.is-shared'), n: +n.toFixed(2), s: s && +s.toFixed(2) });
        }
        void ground;
      }
      return out;
    });
    const tabs = r.filter((x: any) => x.where === 'tab');
    const low = r.filter((x: any) => (x.n != null && x.n < 4.5) || (x.s != null && x.s < 4.5));
    const inverted = tabs.filter((x: any) => x.s != null && x.n < x.s - 0.01);
    check(`${c}, ${theme}: every name and section ≥ 4.5:1 over the worst content under the glass`, low.length === 0 && r.length > 0, low.length ? low : { n: r.length, min: Math.min(...r.map((x: any) => Math.min(x.n ?? 99, x.s ?? 99))) });
    check(`${c}, ${theme}: the name never reads below its section (active, inactive, shared)`, inverted.length === 0, inverted);
    await page.close();
  }
  const page = await fresh();
  const g = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.wb-strip')!, '::before'); return { bf: (s as any).backdropFilter || (s as any).webkitBackdropFilter, bg: s.backgroundColor,
    under: document.querySelector('.wb-panel:not(.wb-panel--hidden) .wb-view')!.getBoundingClientRect().top - document.querySelector('.wb-group')!.getBoundingClientRect().top,
    strip: document.querySelector('.wb-group .wb-strip')!.getBoundingClientRect().height }; });
  const ff = !(await page.evaluate(() => CSS.supports('selector(::-webkit-scrollbar)')));
  // (no ::-webkit-scrollbar, no track margin: the view starts below the strip, by the strip's height, whatever the pills')
  check('the strip blurs what is under it (its own masked layer); the view runs under the strip' + (ff ? ' (Firefox: below it)' : ''), /blur/.test(g.bf) && g.strip > 0 && Math.abs(g.under - (ff ? g.strip : 0)) <= 0.01, g);
  const pad = await page.evaluate(() => { const v = document.querySelector('.wb-panel:not(.wb-panel--hidden) .demo-doc, .wb-panel:not(.wb-panel--hidden) .demo-list')!; const first = v.firstElementChild!.getBoundingClientRect(); return first.top - document.querySelector('.wb-group')!.getBoundingClientRect().top - document.querySelector('.wb-strip')!.getBoundingClientRect().height; });
  check('at rest the first line is below the strip (padded)', pad >= 0, pad);
  const mask = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.wb-strip')!, '::before') as any; const r = document.querySelector('.wb-strip')!.getBoundingClientRect(); return { top: s.top, bottom: s.bottom, mask: s.maskImage || s.webkitMaskImage, tr: s.transform }; });
  check('the blur layer bleeds past the strip by the blur radius (14 px) and is masked back, on its own layer', mask.top === '-14px' && mask.bottom === '-14px' && /gradient/.test(mask.mask) && mask.tr !== 'none', mask);
  const css = await page.evaluate(() => document.getElementById('wb-css')!.textContent!);
  check('a solid fallback: prefers-reduced-transparency and no backdrop-filter', /@media \(prefers-reduced-transparency: reduce\)[^}]*--rfed-tab-strip-bg: var\(--rfed-page\)/.test(css) && /@supports not \(\(backdrop-filter/.test(css));
  await page.evaluate(() => document.querySelector('.wb-root')!.classList.add('wb-solid'));
  const solid = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.wb-strip')!, '::before'); return { bg: s.backgroundColor, page: getComputedStyle(document.body).backgroundColor, bf: (s as any).backdropFilter }; });
  check('… which is opaque (the page colour, no blur)', solid.bg === solid.page && (!solid.bf || solid.bf === 'none'), solid);
  await page.evaluate(() => document.querySelector('.wb-root')!.classList.remove('wb-solid'));
  // the scrollbar starts below the strip: Chromium and WebKit inset its track; Firefox starts the view below it
  const sc = await page.evaluate(() => { const v = document.querySelector('.wb-panel:not(.wb-panel--hidden) [data-wb-scroll]') as HTMLElement; v.scrollTop = 0;
    const r = v.getBoundingClientRect(), s = document.querySelector('.wb-group .wb-strip')!.getBoundingClientRect();
    return { right: r.right, top: r.top, bottom: r.bottom, sb: v.offsetWidth - v.clientWidth, strip: s.bottom, webkit: CSS.supports('selector(::-webkit-scrollbar)'), mode: document.documentElement.dataset.wbScrollbars }; });
  // overlay bars (macOS, iOS; headless WebKit on Linux has them too) stay the platform's own (scrollbars.ts): no styled
  // track to inset, nothing to measure
  if (sc.webkit && sc.mode === 'overlay') skip('the scrollbar thumb starts at or below the strip', 'overlay scrollbars here: the platform\'s own, not styled');
  else if (sc.webkit) {
    await page.evaluate(() => { for (const e of document.querySelectorAll('.wb-strip, .wb-crumbs')) (e as HTMLElement).style.visibility = 'hidden'; });
    const png = decodePng(await page.screenshot({ clip: { x: Math.floor(sc.right - sc.sb + 3), y: Math.floor(sc.top), width: Math.max(2, sc.sb - 6), height: 240 } }));
    await page.evaluate(() => { for (const e of document.querySelectorAll('.wb-strip, .wb-crumbs')) (e as HTMLElement).style.visibility = ''; });
    const bg = luma(png.px, (png.w * (png.h - 1)) * 4 + 0 * 4 + 0);
    let first = -1;
    for (let y = 0; y < png.h && first < 0; y++) for (let x = 0; x < png.w; x++) if (Math.abs(luma(png.px, (y * png.w + x) * 4) - 255 * 0 - (luma(png.px, 0))) > 25) { first = y; break; }
    check('the scrollbar thumb starts at or below the strip (its track inset)', sc.sb >= 8 && first >= 0 && sc.top + first >= sc.strip - 1, { ...sc, first, bg });
  } else check('Firefox: the scroller starts at or below the strip', sc.top >= sc.strip - 0.5, sc);
  check('no maximise button in the strip (the shortcut and the tab menu keep it)', await page.locator('[data-action="maximize"]').count() === 0);
  await page.close();
});

// ── the workbench owns the viewport: the page never scrolls (Safari) ──
group('viewport: no page scroll from overscroll, focus, scrollIntoView or drags', async () => {
  const page = await fresh({ sides: true, h: 700 });
  const geo = () => page.evaluate(() => ({
    page: [document.scrollingElement!.scrollTop, document.scrollingElement!.scrollLeft, document.body.scrollTop, window.scrollY],
    rects: [...document.querySelectorAll('.wb-root, .wb-group, aside.wb-side')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(); }).join('|'),
  }));
  const g0 = await geo();
  const css = await page.evaluate(() => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body); return [h.overflow, h.overscrollBehaviorY, b.overflow, b.overscrollBehaviorY, getComputedStyle(document.querySelector('.wb-view')!).overscrollBehaviorY, getComputedStyle(document.querySelector('.wb-group')!).overflowY]; });
  check('html and body: overflow hidden, no overscroll; views contain theirs; groups clip', css.join() === 'hidden,none,hidden,none,contain,clip', css);
  const [lemma] = await tabsOf(page, 0);
  await page.click(tabSel(lemma));
  const doc = await center(page, `#${lemma}-panel .demo-doc`);
  // overscroll at the top and the bottom of a view (wheel; WebKit's rubber band would move the page)
  await page.mouse.move(doc.x, doc.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
  await page.waitForFunction((id: string) => document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop === 0, lemma);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 800);
  await page.waitForFunction((id: string) => { const d = document.querySelector(`#${id}-panel .demo-doc`)!; return d.scrollTop + d.clientHeight >= d.scrollHeight - 1; }, lemma);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 800);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const g1 = await geo();
  check('overscroll at the top and the bottom: the page and every group stay put', g1.page.every((v: number) => v === 0) && g1.rects === g0.rects, { g0, g1 });
  // focus without preventScroll, and scrollIntoView, on an element deep in a view: only the view scrolls
  await page.evaluate((id: string) => { const d = document.querySelector(`#${id}-panel .demo-doc`)!; d.scrollTop = 0; const p = d.querySelectorAll('p'); const last = p[p.length - 1] as HTMLElement; last.tabIndex = 0; last.focus(); }, lemma);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const g2 = await geo();
  check('focus() deep in a view moves no group and not the page', g2.page.every((v: number) => v === 0) && g2.rects === g0.rects && await page.evaluate((id: string) => document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop > 0, lemma), g2);
  await page.evaluate(() => { document.querySelector('#side-outline-panel')!.scrollIntoView({ block: 'end', inline: 'end' }); document.querySelector('.wb-group:last-of-type .wb-tab')!.scrollIntoView({ block: 'end', inline: 'end' }); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const g3 = await geo();
  check('scrollIntoView() of inner elements moves nothing of the frame', g3.page.every((v: number) => v === 0) && g3.rects === g0.rects, { g0: g0.rects, g3: g3.rects });
  // the guard: a page scroll that happens anyway is put back before it shows
  await page.evaluate(() => { document.documentElement.scrollTop = 60; document.body.scrollTop = 60; window.scrollTo(0, 60); });
  await page.waitForFunction(() => document.scrollingElement!.scrollTop === 0 && window.scrollY === 0);
  check('a page scroll that happens anyway is undone', true);
  // a tab dragged to the bottom edge of the window does not scroll the page
  const t = (await tabsOf(page, 1))[0];
  await drag(page, await center(page, tabSel(t)), { x: 640, y: 699 }, { release: false });
  for (let i = 0; i < 10; i++) await page.mouse.move(640 + (i % 2), 699);
  const g4 = await geo();
  await page.keyboard.press('Escape'); await page.mouse.up();
  check('dragging a tab at the edge of the window scrolls nothing', g4.page.every((v: number) => v === 0) && g4.rects === g0.rects, g4);
  await page.close();
});

// ── the kit (?gallery): one metric for the buttons, the menus and the selects, in every built-in theme ──
async function galleryPage(theme: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await page.goto(`http://wb.test/?gallery&theme=${theme}`);
  await page.waitForSelector('[data-gallery] [data-g="popover"] .wb-pop');
  return page;
}
group('kit gallery: the buttons one metric in a bar; menus and selects one row metric; the theme, document and section selects aligned; every theme', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) {
    const page = await galleryPage(theme);
    const m = await page.evaluate(() => {
      const bar = document.querySelector('[data-g-bar]')!, br = bar.getBoundingClientRect();
      const btns = [...bar.querySelectorAll('.wb-btn')].map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, top: +(r.top - br.top).toFixed(2), bottom: +(br.bottom - r.bottom).toFixed(2), rad: getComputedStyle(b).borderTopLeftRadius, icon: b.classList.contains('wb-btn--icon') }; });
      const lead = (sel: string) => [...document.querySelectorAll(`[data-g="${sel}"] [role="row"]`)].map((row) => { const pop = row.closest('.wb-pop')!.getBoundingClientRect();
        const mark = row.querySelector('.wb-ts-num, .wb-ts-bul'), name = row.querySelector('.wb-mi-label')!, depth = +(row.getAttribute('data-ts-depth') ?? 0);
        // a tab-stop list (the sections): its numbers end at the tab, so the column starts where the widest one does
        return { x: +((mark ?? name).getBoundingClientRect().left - pop.left).toFixed(2), name: +(name.getBoundingClientRect().left - pop.left).toFixed(2), h: row.getBoundingClientRect().height, depth }; });
      const items = [...document.querySelectorAll('[data-g="menu"] .wb-menu-item')].map((e) => e.getBoundingClientRect().height);
      return { btns, theme: lead('select-theme'), docs: lead('select-docs'), secs: lead('select-sections'), items };
    });
    const b0 = m.btns[0];
    check(`${theme}: every button in the bar: one height, one radius, top inset = bottom inset; icon buttons square`,
      m.btns.length >= 8 && m.btns.every((b: any) => b.h === b0.h && b.rad === b0.rad && Math.abs(b.top - b.bottom) <= 0.5 && Math.abs(b.top - b0.top) <= 0.5 && (!b.icon || b.w === b.h)), m.btns);
    const s0 = m.secs.filter((r: any) => !r.depth), top = [...m.theme, ...m.docs, ...(s0.length ? [s0.reduce((a: any, b: any) => (b.x < a.x ? b : a))] : [])];
    check(`${theme}: the theme, document and section selects: the text starts at one x; one row height (= the menu item's)`,
      top.length >= 9 && top.every((r: any) => r.x === top[0].x && r.h === top[0].h) && m.items.every((h: number) => h === top[0].h), { top: top.map((r: any) => r.x + '/' + r.h), items: m.items });
    check(`${theme}: subsections indented (their names right of the sections' names)`, s0.length > 0 && m.secs.some((r: any) => r.depth > 0 && r.name > s0[0].name), m.secs);
    await page.close();
  }
});

group('themes: light, dark, sepia, high contrast and a registered JSON theme: the hierarchy and the text floor, the focus ring, the lines from the tokens, hc solid', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc', 'night']) {
    const page = await fresh({ theme: theme === 'night' ? 'dark' : theme, query: 'fresh&bar=1' });     // distinct documents (a shared name steps back to the section's colour on purpose)
    if (theme === 'night') {
      const r = await page.evaluate(() => { const d = (window as any).demoThemes;
        const res = d.registerTheme({ id: 'night', label: 'Night', type: 'dark', extends: 'dark', colors: { 'pageBackground': '#101826', 'tab.activeBackground': 'rgba(120, 160, 255, 0.18)', 'splitter.border': 'rgba(160, 190, 255, 0.22)' } });
        d.setTheme('night'); return { res, listed: d.themes().some((t: any) => t.id === 'night'), at: document.documentElement.dataset.wbTheme }; });
      check('night: registered from JSON, listed, applied', r.res.ok && r.listed && r.at === 'night', r);
      await page.click('.wb-bar [data-demo="theme"]');
      check('night: the theme switch lists it', await page.locator('[data-item="theme-night"]').count() === 1);
      await page.keyboard.press('Escape');
    }
    // a document tab (with a section) active in the focused group, a distinct one inactive
    await page.evaluate(() => { const w = (window as any).demo.wb, t = [...document.querySelectorAll('.wb-tab')].find((e) => e.querySelector('.wb-tab-sub-label')); if (t) w.activate(t.getAttribute('data-tab')); });
    await idle(page);
    const m = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true })!;
      const solid = (fg: string, bg: string) => { x.clearRect(0, 0, 1, 1); x.fillStyle = bg; x.fillRect(0, 0, 1, 1); x.fillStyle = fg; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const alpha = (c: string) => { x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data[3]; };
      const tok = (v: string, el: Element = document.querySelector('.wb-strip')!) => { const d = document.createElement('div'); d.style.background = `var(${v})`; el.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
      const page = getComputedStyle(document.body).backgroundColor;
      const strip = solid(tok('--rfed-tab-strip-bg'), page);
      const act = document.querySelector('.wb-group--active .wb-tab.wb-tab--on')!;
      const ground = solid(tok('--rfed-tab-active-bg', act), strip);
      const idle = [...document.querySelectorAll('.wb-tab:not(.wb-tab--on)')].find((t) => t.querySelector('.wb-tab-sub-label') && !t.querySelector('.is-shared'))!;
      const c = (e: Element | null) => (e ? getComputedStyle(e).color : '');
      const sep = document.querySelector('.wb-sep[data-sep]');
      // every colour flattened on its ground (rgb), so the contrast helper reads it
      return { page, strip, ground, name: solid(c(act.querySelector('.wb-tab-label')), ground), sec: solid(c(act.querySelector('.wb-tab-sub-label')), ground),
        idleName: solid(c(idle.querySelector('.wb-tab-label')), strip), idleSec: solid(c(idle.querySelector('.wb-tab-sub-label')), strip),
        ring: solid(tok('--rfed-focus', act), ground), line: sep ? getComputedStyle(sep, '::before').backgroundColor : null, lineTok: tok('--rfed-splitter-border'),
        glassA: alpha(tok('--rfed-tab-strip-bg')), barA: alpha(tok('--rfed-top-bar-bg', document.querySelector('.wb-bar')!)), type: document.documentElement.dataset.wbThemeType };
    });
    const k = { name: contrast(m.name, m.ground), sec: contrast(m.sec, m.ground), idleName: contrast(m.idleName, m.strip), idleSec: contrast(m.idleSec, m.strip), ring: contrast(m.ring, m.ground) };
    void k;
    check(`${theme}: name above section (active and inactive), each ≥ 4.5:1 over its ground`, k.name > k.sec && k.idleName > k.idleSec && Math.min(k.name, k.sec, k.idleName, k.idleSec) >= 4.5, { k, m });
    check(`${theme}: the focus ring ≥ 3:1 against the active tab's ground (the non-text floor)`, k.ring >= 3, { ring: k.ring, m: m.ring });
    check(`${theme}: the splitter line is the theme's token`, m.line != null && m.line === m.lineTok, { line: m.line, tok: m.lineTok });
    if (theme === 'hc') check('hc: the strips and the top bar are solid (no translucency)', m.glassA === 255 && m.barA === 255, m);
    await page.close();
  }
});

// ── light and dark ──
function lum(rgb: string) {
  const m = rgb.match(/[\d.]+/g)!.map(Number);
  const c = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
group('light and dark: contrast, the active tab' + "'" + 's ground without the accent, quiet chrome', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme });
    const r = await page.evaluate(() => {
      // resolve a colour with color-mix against its ground: paint it on a 1×1 canvas
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d')!;
      const solid = (fg: string, bg: string) => { x.fillStyle = bg; x.fillRect(0, 0, 1, 1); x.fillStyle = fg; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const page = getComputedStyle(document.body).backgroundColor;
      const strip = solid(getComputedStyle(document.querySelector('.wb-strip')!).backgroundColor, page);
      const act = document.querySelector('.wb-group--active .wb-tab.wb-tab--on')!;
      const ina = document.querySelector('.wb-tab:not(.wb-tab--on)')!;
      const actBg = solid(getComputedStyle(act).backgroundColor, strip);
      const marks = [getComputedStyle(act.querySelector('.wb-tab-icon')!).color, getComputedStyle(act, '::before').backgroundColor];
      const sep = getComputedStyle(document.querySelector('[role="separator"]')!, '::after').content;
      return { page, strip, actBg, actInk: getComputedStyle(act).color, inaInk: solid(getComputedStyle(ina).color, strip), marks, sep };
    });
    const accent = theme === 'dark' ? 'rgb(74, 159, 240)' : 'rgb(35, 131, 226)';
    const tag = theme;
    check(`${tag}: active label ≥ 7:1`, contrast(r.actInk, r.actBg) >= 7, contrast(r.actInk, r.actBg).toFixed(2));
    check(`${tag}: inactive labels ≥ 4.5:1`, contrast(r.inaInk, r.strip) >= 4.5, contrast(r.inaInk, r.strip).toFixed(2));
    check(`${tag}: the active tab: the kit' + 's selected-tab ground (one set everywhere), no accent`, r.actBg !== r.strip && !r.marks.includes(accent), { actBg: r.actBg, strip: r.strip, marks: r.marks });
    check(`${tag}: no split handle`, r.sep === 'none', r.sep);
    check(`${tag}: the page ground`, r.page === (theme === 'dark' ? 'rgb(25, 25, 25)' : 'rgb(255, 255, 255)'), r.page);
    check(`${tag}: the strip is the page (quiet), the active pill tinted`, r.strip === r.page && r.actBg !== r.page, r);
    await page.close();
  }
});

// ── overflow (Firefox showed scrollbars flashing over the window and in the menus): nothing reaches past its scroller ──
/** A page on the demo with a device scale (0.9 and 1.1 stand for a browser zoom of 90 % and 110 %), an optional saved layout. */
async function scaled({ w = 1280, h = 800, dpr = 1, query = 'fresh', saved = '', init }: { w?: number; h?: number; dpr?: number; query?: string; saved?: string; init?: () => void } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  if (saved) await page.addInitScript((s: string) => { try { localStorage.setItem('wb-demo-layout', s); } catch { /* none */ } }, saved);
  if (init) await page.addInitScript(init);
  await page.goto(`http://wb.test/?${query}`);
  await page.waitForSelector('.wb-tab');
  await page.evaluate(() => document.fonts.ready);
  return page;
}
/** A box's overflow past its padding box, from its children's rects (sub-pixel: scrollWidth rounds, a 0.5 px overflow
 *  is invisible to it, yet Firefox scrolls it), skipping what a nested clip or scroller holds and fixed layers. */
const OVERFLOW = `(e) => {
  // the padding box from the border box (clientWidth rounds): less the borders and a classic scrollbar's room
  const r = e.getBoundingClientRect(), c = getComputedStyle(e), bl = parseFloat(c.borderLeftWidth), br = parseFloat(c.borderRightWidth), bt = parseFloat(c.borderTopWidth), bb = parseFloat(c.borderBottomWidth);
  const L = r.left + bl, T = r.top + bt, R = r.right - br - Math.max(0, e.offsetWidth - e.clientWidth - Math.round(bl + br)), B = r.bottom - bb - Math.max(0, e.offsetHeight - e.clientHeight - Math.round(bt + bb));
  let x = 0, y = 0, who = '';
  for (const d of e.querySelectorAll('*')) {
    let a = d.parentElement, inner = false;
    while (a && a !== e) { const c = getComputedStyle(a); if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { inner = true; break; } a = a.parentElement; }
    if (inner || /fixed|sticky/.test(getComputedStyle(d).position)) continue;     // a sticky box's rect is where it sticks
    const q = d.getBoundingClientRect(); if (!q.width && !q.height) continue;
    const ox = Math.max(q.right + e.scrollLeft - R, L - q.left - e.scrollLeft), oy = q.bottom + e.scrollTop - B;     // from the scroll origin
    if (ox > x) { x = ox; who = d.className.toString().slice(0, 30); }
    if (oy > y) y = oy;
  }
  return { x: +x.toFixed(2), y: +y.toFixed(2), who, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, pr: parseFloat(c.paddingRight), pb: parseFloat(c.paddingBottom) };
}`;
group('overflow: every dropdown sizes from its rows: no sideways overflow (its rows inside its padding box, the separator too), it scrolls only past its max-height; DPR 1, 2, zoom 90 % and 110 %; light and high contrast', async () => {
  for (const dpr of [1, 2, 0.9, 1.1]) for (const theme of ['light', 'hc']) {
    const page = await scaled({ dpr, query: `fresh&scenario=paper&bar=1&sides=0&theme=${theme}` });
    const TAB = '.wb-strip--focused .wb-tab.wb-tab--on';
    const menus: [string, () => Promise<void>][] = [
      ['the tab menu', () => page.locator('.wb-groups .wb-tab:not(.wb-tab--on)').first().click({ button: 'right' })],
      ['the switcher', () => page.click(`${TAB} [data-name]`)],
      ['the section menu', () => page.click(`${TAB} [data-sub]`)],
      ['the theme switch', () => page.click('.wb-bar [data-demo="theme"]')],
      ["the host's menu", () => page.click('[data-demo="menu"]')],
    ];
    const bad: unknown[] = [];
    let seen = 0;
    for (const [name, open] of menus) {
      await open();
      await page.waitForSelector('.wb-pop .wb-menu');
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      const m = await page.evaluate(`(() => { const e = document.querySelector('.wb-pop .wb-menu'); const o = (${OVERFLOW})(e);
        return { ...o, max: parseFloat(getComputedStyle(e).maxHeight), h: e.getBoundingClientRect().height, seps: e.querySelectorAll('.wb-menu-sep').length }; })()`) as any;
      seen++;
      const full = Math.abs(m.h - m.max) < 1;      // at its max-height: then (only then) it scrolls
      if (m.x > 0.01 || m.sw > m.cw || (!full && (m.y > 0.01 || m.sh > m.ch))) bad.push({ name, ...m });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.wb-pop', { state: 'detached' });
    }
    check(`DPR ${dpr}, ${theme}: ${seen} dropdowns (the tab menu, the switcher, the section menu, the theme switch, the host's menu) overflow nothing`, seen === 5 && bad.length === 0, bad);
    await page.context().close();
  }
});
/** The demo saved as a person leaves it: three groups (one spanning the top, its tabs in the top bar when the window
 *  is wide enough; two below), both columns open, home showing in one, a document scrolled to a section. */
async function savedLayout() {
  const page = await scaled({ query: 'fresh&single&bar=1&theme=light' });
  await page.evaluate(() => { const W = (window as any).demo.wb, M = (window as any).demo.M;
    W.collapseSide('left', false); W.collapseSide('right', false);
    W.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } });
    const l = W.open({ view: 'list', state: { name: 'Fruit', items: Array.from({ length: 40 }, (_, i) => `Fruit ${i + 1}`) } }); W.split(l, 'bottom', undefined, { copy: false });
    const n = W.open({ view: 'text', state: { text: 'A note' } }); W.split(n, 'right', undefined, { copy: false });
    const g = M.groups(W.layout.peek()); W.toggleHome(g[1].id, true); W.activate(g[0].active); });
  await page.waitForFunction(() => document.querySelectorAll('.wb-groups .wb-group').length === 3 && !document.querySelector('.wb-side--sliding'));
  const saved = await page.evaluate(() => (window as any).demo.wb.serialize());
  await page.context().close();
  return saved as string;
}
group('overflow: a restored layout at several window sizes, DPR 1 and 2, zoom 90 % and 110 %: the page cannot scroll; no scroller overflows by a fraction (a decoration); the documents and lists never sideways', async () => {
  const saved = await savedLayout();
  for (const [w, h] of [[1280, 800], [1001, 703], [1513, 947], [1920, 1080]]) for (const dpr of [1, 2, 0.9, 1.1]) {
    const page = await scaled({ w, h, dpr, saved, query: 'bar=1&theme=light' });
    // home is not saved (a reload shows the tabs): it is opened again, as the person had it
    await page.evaluate(() => { const W = (window as any).demo.wb; W.toggleHome((window as any).demo.M.groups(W.layout.peek())[1].id, true); });
    await page.waitForFunction(() => document.querySelector('.wb-home') && !document.querySelector('.wb-booting'));
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const r = await page.evaluate(`(() => {
      const se = document.scrollingElement, f = (${OVERFLOW});
      const page = { sw: se.scrollWidth, cw: se.clientWidth, sh: se.scrollHeight, ch: se.clientHeight };
      const bad = [];
      for (const e of document.querySelectorAll('.wb-root *')) {
        const c = getComputedStyle(e); if (!/(auto|scroll)/.test(c.overflowX + c.overflowY) || !e.getClientRects().length) continue;
        const o = f(e), name = e.className.toString().slice(0, 30);
        // what the boxes inside reach is content (a box that is really wider); what scrolls beyond it is not a box: a
        // pseudo-element's line or glass, a transform, a negative margin's decoration; a fraction past the box is a
        // rounding that still scrolls (Firefox, WebKit)
        const deco = o.sw > o.cw + (o.x > 0 ? Math.ceil(o.x + o.pr) + 1 : 0);     // content's overflow ends at its padding
        if (deco || (o.x > 0.01 && o.x < 0.5) || (o.y > 0.01 && o.y < 0.5)) bad.push({ name, deco, ...o });
        if (/demo-(doc|list)/.test(name) && (o.sw > o.cw || c.overflowX !== 'hidden')) bad.push({ name, sideways: true, ...o });
      }
      return { page, bad, n: document.querySelectorAll('.wb-groups .wb-group').length, inbar: !!document.querySelector('.wb-bar .wb-strip--inbar') };
    })()`) as any;
    check(`${w}×${h} DPR ${dpr}: the page cannot scroll (${r.page.sw}×${r.page.sh} in ${r.page.cw}×${r.page.ch}); no scroller overflows by a fraction${r.inbar ? '; a strip in the top bar' : ''}`, r.n === 3 && (w < 1900 || r.inbar) && r.page.sw <= r.page.cw && r.page.sh <= r.page.ch && r.bad.length === 0, r);
    await page.context().close();
  }
});
group('overflow: from the navigation start through the load, the page never overflows on any frame; the viewport CSS is in the head before any script', async () => {
  const saved = await savedLayout();
  for (const [dpr, query] of [[1, 'bar=1&theme=light'], [2, 'bar=1&theme=dark'], [2, 'fresh&scenario=paper&bar=1'], [1, 'fresh&single']] as const) {
    const page = await scaled({ dpr, saved, query, init: () => {
      const w = window as any; w.__pf = [];
      const tick = () => {
        const se = document.scrollingElement;
        if (se) w.__pf.push({ x: se.scrollWidth - se.clientWidth, y: se.scrollHeight - se.clientHeight, css: !!document.getElementById('wb-viewport-css')?.textContent?.includes('overflow: hidden'),
          wb: !!document.querySelector('.wb-root [data-tab]') });
        if (w.__pf.filter((f: any) => f.wb).length < 20) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } });
    const fr = await page.waitForFunction(() => (window as any).__pf.filter((f: any) => f.wb).length >= 20).then(() => page.evaluate(() => (window as any).__pf)) as any[];
    const over = fr.map((f, i) => ({ i, ...f })).filter((f) => f.x > 0 || f.y > 0);
    check(`DPR ${dpr}, ?${query}: ${fr.length} frames from the first: the page overflows on none; the viewport CSS present from frame 0`, over.length === 0 && fr.every((f) => f.css), { over: over.slice(0, 3), first: fr[0] });
    await page.context().close();
  }
});
