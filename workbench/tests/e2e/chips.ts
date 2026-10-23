// The workbench's browser suite, area "chips": the pill's parts as painted: buttons, chips, the ×, dropdown edges, the insertion bar, strip lines, the gaps. Run by tests/e2e.ts (--area chips).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── one button everywhere: the pill's radius; in each bar the same inset on every side ──
group('uniform buttons: the radius and the inset to their bar, equal across each bar, light and dark', async () => {
  for (const theme of ['light', 'dark']) for (const q of ['fresh&bar=1&single', 'fresh&bar=1&scenario=paper', 'fresh&bar=0&scenario=paper']) {
    const page = await fresh({ theme, sides: true, query: q });
    await idle(page);
    const r = await page.evaluate(() => {
      const out: any[] = [];
      const bars = [...document.querySelectorAll('.wb-bar, .wb-strip:not([hidden]):not(.wb-strip--inbar), aside:not(.wb-side--hidden) .wb-side-strip')];
      for (const bar of bars) {
        const br0 = bar.getBoundingClientRect(), hair = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-hair')) || 0, gEl = bar.closest('.wb-group');
        // measured from what is seen: beside a splitter the line takes its share of the strip (1 - h on its right, h on its left)
        const br = { top: br0.top, bottom: br0.bottom, left: br0.left + (gEl?.getAttribute('data-left') === 'false' ? 1 - hair : 0), right: br0.right - (gEl?.getAttribute('data-right') === 'false' ? hair : 0) };
        const items = [...bar.querySelectorAll('.wb-btn, .wb-tab')].filter((e) => { const s = getComputedStyle(e), q = e.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && q.width > 0 && !e.closest('.wb-crumbs:not(.wb-crumbs--bar)'); });
        if (!items.length) continue;
        const rs = items.map((e) => e.getBoundingClientRect());
        const left = Math.min(...rs.map((q) => q.left)), right = Math.max(...rs.map((q) => q.right));
        out.push({ bar: bar.className.split(' ')[0], radius: [...new Set(items.map((e) => getComputedStyle(e).borderTopLeftRadius))],
          tops: [...new Set(rs.map((q) => Math.round((q.top - br.top) * 2) / 2))], bottoms: [...new Set(rs.map((q) => Math.round((br.bottom - q.bottom) * 2) / 2))],
          left: Math.round((left - br.left) * 2) / 2, right: Math.round((br.right - right) * 2) / 2, n: items.length });
      }
      return out;
    });
    const tag = `${theme}, ${q.includes('single') ? 'one document' : 'tabs'}`;
    const bad = r.filter((b: any) => b.radius.length !== 1 || b.radius[0] !== '8px' || b.tops.length !== 1 || b.bottoms.length !== 1 || Math.abs(b.tops[0] - b.bottoms[0]) > 0.5 || Math.abs(b.left - b.tops[0]) > 0.5);
    check(`${tag}: every button and tab has the pill radius; top = bottom = left inset in its bar`, bad.length === 0 && r.length >= 2, bad.length ? bad : r.map((b: any) => `${b.bar}:${b.tops[0]}/${b.left} ×${b.n}`));
    const strips = r.filter((b: any) => b.bar === 'wb-strip');
    if (strips.length) check(`${tag}: the last tab ends at the same inset as the first begins`, strips.every((b: any) => Math.abs(b.right - b.left) <= 0.5), strips);
    await page.close();
  }
});

// ── a press on any part of a tab that moves is a tab drag; one that does not: the menu (active) or the tab ──
group('drag from the section text drags the tab (both forms); a click there still opens the menu or activates', async () => {
  for (const c of ['two lines', 'one line']) {
    const page = await fresh({ query: 'fresh&scenario=paper' });
    if (c === 'one line') await oneLine(page);
    const ids = await tabsOf(page, 0);
    const part = '.wb-tab-sub-label, .wb-tab-sec-text';
    await page.click(tabSel(ids[0]), { position: { x: 6, y: 6 } });     // its corner: not the section (that opens the menu)
    // a drag that starts on the section of the active tab moves the tab to the end
    const from = await center(page, `${tabSel(ids[0])} :is(${part})`);
    const last = await center(page, tabSel(ids.at(-1)));
    await drag(page, from, { x: last.b.x + last.b.width - 3, y: last.y });
    await page.waitForFunction((id: string) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[0].tabs.at(-1).id === id, ids[0]);
    check(`${c}: a drag from the section reorders the tab`, true);
    {
      await page.click(`${tabSel(ids[0])} :is(${part})`);
      await page.waitForSelector('[role="grid"]');
      check(`${c}: a click on the section of the active tab opens its menu`, true);
      await page.keyboard.press('Escape');
      await page.click(`${tabSel(ids[1])} :is(${part})`);
      await page.waitForFunction((id: string) => (window as any).demo.wb.current.peek().tab.id === id, ids[1]);
      check(`${c}: a click on the section of an inactive tab activates it (no menu)`, await page.locator('[role="menu"], [role="grid"]').count() === 0);
    }
    await page.close();
  }
});

// ── a 100 % tab has the same inset on both sides in every group position (left, inner, right), DPR 1 and 2 ──
group('one full tab per group: equal left and right insets at every position, with or without columns, DPR 1 and 2', async () => {
  for (const dpr of [1, 2]) for (const sides of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1283, height: 600 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&single&bar=1&theme=light${sides ? '' : '&sides=0'}`);
    await page.waitForSelector('.wb-bar');
    await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M;
      const a = M.allTabs(w.layout.peek())[0].id;
      const b = w.open({ view: 'document', state: { doc: 'graphs' } }); w.split(b, 'right', undefined, { copy: false });
      const c = w.open({ view: 'document', state: { doc: 'streams' } }); w.split(c, 'right', undefined, { copy: false });
      w.resize(w.layout.peek().root.id, [1, 1.3, 0.9]); void a; });
    await page.waitForFunction(() => document.querySelectorAll('.wb-group').length === 3 && !document.querySelector('.wb-side--sliding'));
    await idle(page);
    const r = await page.evaluate(() => [...document.querySelectorAll('.wb-group')].map((g) => { const s = g.querySelector('.wb-strip')!.getBoundingClientRect(), t = g.querySelector('.wb-tab')!.getBoundingClientRect();
      const hair = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-hair')) || 0;     // the splitter line's share (seen edges)
      const sl = s.left + (g.getAttribute('data-left') === 'false' ? 1 - hair : 0), sr = s.right - (g.getAttribute('data-right') === 'false' ? hair : 0);
      const h = g.querySelector('.wb-strip .wb-home-btn')!.getBoundingClientRect();     // home first: edge → home = home → tab = tab → edge
      return { e: +(h.left - sl).toFixed(3), l: +(t.left - h.right).toFixed(3), r: +(sr - t.right).toFixed(3), gr: +g.getBoundingClientRect().right.toFixed(3) }; }));
    const bad = r.filter((x: any) => Math.abs(x.l - x.r) > 0.25 || Math.abs(x.e - x.r) > 0.25);
    check(`DPR ${dpr}, ${sides ? 'columns' : 'no columns'}: the one tab of the left, inner and right group: edge → home = home → tab = tab → edge (±0.25 px)`, bad.length === 0, r);
    await ctx.close();
  }
});

// ── the divider between groups is drawn: at rest and hovered, ≥ 3:1 against both neighbours, light and dark, DPR 1 and 2 ──
group('splitter divider: visible and subtle at rest and on hover, horizontal and vertical, light and dark, DPR 1 and 2', async () => {
  for (const theme of ['light', 'dark']) for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 }, deviceScaleFactor: dpr, colorScheme: theme as any });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&sides=0&bar=0&theme=${theme}`);
    await page.waitForSelector('.wb-tab');
    await page.evaluate(() => { const w = (window as any).demo.wb; w.split(w.current.peek().tab.id, 'bottom', undefined, { copy: false }); });
    await page.waitForFunction(() => document.querySelectorAll('[role="separator"]').length >= 2);
    const read = () => page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d')!;
      const solid = (f: string, b: string) => { x.fillStyle = b; x.fillRect(0, 0, 1, 1); x.fillStyle = f; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const lum = (c: number[]) => { const k = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
      const page = getComputedStyle(document.body).backgroundColor;
      return [...document.querySelectorAll('.wb-groups [role="separator"]')].map((s) => { const b = getComputedStyle(s, '::before');
        const line = solid(b.backgroundColor, page), bg = solid(page, page), a = lum(line), c = lum(bg);
        return { o: s.getAttribute('aria-orientation'), w: parseFloat(b.width) || s.getBoundingClientRect().width, h: parseFloat(b.height) || s.getBoundingClientRect().height, op: b.opacity, hit: Math.min(s.getBoundingClientRect().width, s.getBoundingClientRect().height),
          ratio: +((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)).toFixed(2) }; });
    });
    const rest = await read();
    // the editor's own border (its sidebar's): 8 % ink over the page; the divider may be a little stronger, never harsh
    const ref = await page.evaluate(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d')!; const pg = getComputedStyle(document.body).backgroundColor; const ink = getComputedStyle(document.body).color;
      x.fillStyle = pg; x.fillRect(0, 0, 1, 1); x.globalAlpha = 0.08; x.fillStyle = ink; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; x.globalAlpha = 1; x.fillStyle = pg; x.fillRect(0, 0, 1, 1); const e = x.getImageData(0, 0, 1, 1).data;
      const lum = (c: any) => { const k = [c[0], c[1], c[2]].map((v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
      const a = lum(d), b = lum(e); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
    const ok = (r: any[]) => r.length >= 2 && r.every((s) => s.op === '1' && s.w > 0 && s.h > 0 && s.ratio > 1.05 && s.ratio <= ref + 0.35 && s.hit >= 8) && new Set(r.map((s) => s.o)).size === 2;
    check(`${theme}, DPR ${dpr}: the dividers are drawn at rest (both orientations), visible and subtle (≤ the editor' + 's border + 0.35), an 8 px hit area`, ok(rest), { rest, ref });
    const s = await center(page, '.wb-groups [role="separator"][aria-orientation="vertical"]');
    await page.mouse.move(s.x, s.y + 40);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.wb-groups [role="separator"][aria-orientation="vertical"]')!, '::before').transform !== 'none');
    check(`${theme}, DPR ${dpr}: hovered: the line stays, thickened`, (await read()).every((s: any) => s.op === '1' && s.w > 0));
    await ctx.close();
  }
});

// ── two lines: the section's chevron starts exactly where the title starts ──
group('two-line chevron flush with the title as PAINTED (its first stroke pixel = the title\'s first glyph pixel, ±0.5), the section 4 px after the chevron; active and inactive, light and dark, DPR 1 and 2', async () => {
  for (const theme of ['light', 'dark']) for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&sides=0&bar=0&scenario=paper&theme=${theme}`);
    await page.waitForSelector('.wb-tab-text .wb-tab-chev');
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(5, 395);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.wb-tab')].filter((t) => t.querySelector('.wb-tab-text .wb-tab-chev')).slice(0, 3).map((t) => {
      const T = t.getBoundingClientRect(), g = document.createRange(); g.selectNodeContents(t.querySelector('.wb-tab-label')!); const n = g.getBoundingClientRect(), ch = t.querySelector('.wb-tab-chev svg')!.getBoundingClientRect(), s = t.querySelector('.wb-tab-sub-label')!.getBoundingClientRect();
      return { on: t.querySelector('[role="tab"]')!.getAttribute('aria-selected'), T: { x: T.x, y: T.y, h: T.height }, name: [n.top, n.bottom], chev: [ch.top, ch.bottom], gap: +(s.left - ch.right).toFixed(2) }; }));
    const out: any[] = [];
    for (const t of tabs) {
      const clip = { x: Math.floor(t.T.x), y: Math.floor(t.T.y), width: 40, height: Math.ceil(t.T.h) };
      const png = decodePng(await page.screenshot({ clip }));
      // the first pixel off the pill's own ground (sampled 6 px in, on the same row) in a band of rows
      const first = (band: number[]) => { let best = 1e9; for (let y = Math.ceil((band[0] - clip.y) * dpr); y < Math.floor((band[1] - clip.y) * dpr); y++) { const g = luma(png.px, (y * png.w + Math.round((t.T.x - clip.x + 6) * dpr)) * 4);
        for (let x = Math.round((t.T.x - clip.x + 6) * dpr); x < png.w; x++) if (Math.abs(luma(png.px, (y * png.w + x) * 4) - g) > 24) { best = Math.min(best, x); break; } } return clip.x + best / dpr; };
      out.push({ on: t.on, d: +(first(t.chev) - first(t.name)).toFixed(2), gap: t.gap });
    }
    check(`${theme}, DPR ${dpr}: the chevron's painted left edge on the title's first glyph (±0.5); the section 4 px after the chevron`, out.length > 1 && out.every((x) => Math.abs(x.d) <= 0.5 && Math.abs(x.gap - 4) <= 0.5), out);
    await ctx.close();
  }
});

group('no gap between the chips and the close box (one line: they overlap by the chip overlap): two lines and one line, wide and narrow, light and dark', async () => {
  for (const [c, w] of [['two', 1280], ['two', 760], ['two', 900], ['one', 2800], ['one', 3600]] as const) for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, w: c === 'one' ? 1280 : w, query: 'fresh&scenario=paper' });
    if (c === 'one') await oneLine(page, w);
    await idle(page);
    const r = await page.evaluate(() => [...document.querySelectorAll('.wb-group--active .wb-tab.wb-tab--on, .wb-strip--inbar .wb-tab.wb-tab--on')].map((t) => {
      const x = t.querySelector('.wb-tab-close')!.getBoundingClientRect();
      const box = (t.querySelector('.wb-tab-text, .wb-tab-line') ?? t.querySelector('.wb-tab-label'))!.getBoundingClientRect();
      const two = !!t.querySelector('.wb-tab-text');
      // two lines: both chips span the text's width; one line: the last chip (the section, else the name) ends the line
      const vis = [...t.querySelectorAll('[data-name], [data-sub]')].filter((e) => getComputedStyle(e).display !== 'none');
      const chips = two ? vis : vis.slice(-1);
      const p = document.createElement('div'); p.style.cssText = 'position:absolute;width:var(--wb-chip-overlap)'; t.appendChild(p); const O = two ? 0 : parseFloat(getComputedStyle(p).width); p.remove();
      const fills = !two && chips[0] && Math.abs(chips[0].getBoundingClientRect().right - O - box.right) <= 0.5;
      return { two, O, room: +(x.left - box.right).toFixed(2), chips: chips.map((e) => +(x.left - e.getBoundingClientRect().right).toFixed(2)), cut: chips.map(() => fills) };
    }));
    // the text box runs up to the close box; a chip that fills its line touches it (one line: reaches the overlap under it)
    check(`${c} ${w}px, ${theme}: the text box ends at the close box; every filling chip's right edge = the close box's left (one line: + the overlap) (±0.5)`,
      r.length > 0 && r.every((x: any) => (x.two || x.O === 6) && Math.abs(x.room) <= 0.5 && x.chips.every((d: number, i: number) => (x.two || x.cut[i]) ? Math.abs(d + x.O) <= 0.5 : d >= -x.O - 0.5)), r);
    await page.close();
  }
});

// ── a long name or section grows until its text is flush with the ×, then truncates ──
group('long texts reach the ×: the text grows into the chip\'s right padding until it is flush with the × (±0.5 px) and only then truncates with "…"; a short one keeps the padding; the × hidden: the text box\'s end; two lines (name, section), one line (the section), the top bar', async () => {
  for (const [form, host] of [['two', 'row'], ['one', 'row'], ['one', 'bar']] as const) {
    const page = await fresh({ w: form === 'one' && host === 'row' ? 1280 : 1280, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&scenario=paper' });
    if (host === 'bar') { await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } }, { focus: false })); await settled(page); }
    else if (form === 'one') await oneLine(page);
    await page.mouse.move(1, 790);
    const parts = form === 'two' ? ['.wb-tab-name', '.wb-tab-sub-label'] : ['.wb-tab-sec-text'];
    for (const part of parts) for (const which of ['active', 'inactive']) {
      const r = await page.evaluate(([part, which, host]: string[]) => {
        const scope = host === 'bar' ? '.wb-bar' : '.wb-strip--focused';
        const t = document.querySelector(`${scope} .wb-tab${which === 'active' ? '.wb-tab--on' : ':not(.wb-tab--on)'}`)!, el = t.querySelector(part) as HTMLElement, x = t.querySelector('.wb-tab-close') as HTMLElement;
        const xShown = getComputedStyle(x).display !== 'none';
        const limit = xShown ? x.getBoundingClientRect().left : (t.querySelector('.wb-tab-text, .wb-tab-line') as HTMLElement).getBoundingClientRect().right;
        const pad = (() => { const c = el.closest('[data-name], [data-sub]'); if (!c || which !== 'active') return 0; const a = getComputedStyle(c, '::after'); return /^(none|normal)$/.test(a.content) ? 0 : parseFloat(a.width); })();
        const base = 'Theorem 3 and the construction spelled out in every one of its cases, at length';
        const out: any[] = [];
        for (let n = 1; n <= base.length; n++) {
          el.textContent = base.slice(0, n);
          const rg = document.createRange(); rg.selectNodeContents(el); const end = rg.getBoundingClientRect().right;
          const cut = el.scrollWidth > el.clientWidth + 0.5;
          out.push({ n, end: +end.toFixed(2), right: +el.getBoundingClientRect().right.toFixed(2), cut, pad: (() => { const c = el.closest('[data-name], [data-sub]'); const a = c && getComputedStyle(c, '::after'); return a && !/^(none|normal)$/.test(a.content) ? parseFloat(a.width) : null; })() });
        }
        return { limit: +limit.toFixed(2), xShown, pad, out };
      }, [part, which, host]);
      const firstCut = r.out.find((o: any) => o.cut), lastWhole = [...r.out].reverse().find((o: any) => !o.cut);
      const okOrder = r.out.every((o: any) => o.cut === (o.end > r.limit + 0.5));     // truncated exactly when the whole text would pass the limit
      const flush = !!firstCut && Math.abs(firstCut.right - r.limit) <= 0.5;          // truncated: the text box (and its "…") ends at the limit
      const short = r.out[0];
      check(`${form} line${form === 'two' ? 's' : ''}, ${host}, ${part.slice(1)}, ${which} (${r.xShown ? 'the × shown' : 'the × hidden'}): no "…" while the text fits up to the ${r.xShown ? '×\'s edge' : 'text box\'s end'}; past it the "…", the text box flush with it (±0.5 px); the last whole text ends ${lastWhole ? +(r.limit - lastWhole.end).toFixed(2) : '?'} px before it`,
      okOrder && flush && !!lastWhole && lastWhole.end <= r.limit + 0.5, { limit: r.limit, firstCut, lastWhole, bad: r.out.filter((o: any) => o.cut !== (o.end > r.limit + 0.5)).slice(0, 3) });
      if (which === 'active') check(`… a short text keeps its chip\'s right padding (the spacer ${short.pad} px = --wb-cpl); a truncated one has used it up (${firstCut?.pad} px)`, short.pad === 9 && (firstCut?.pad ?? 9) <= (form === 'one' ? 6 : 0) + 0.01, { short, firstCut });
    }
    await page.close();
  }
});

// ── the chips: one inset from the pill's border, one radius, the two-line overlap; the text never moves ──
group('chips: one inset, one radius; two lines overlap; one line mirrored around the chevron; the × alike; rename = the name chip; both forms; both hosts; light and dark', async () => {
  for (const [c, host] of [['two', 'strip'], ['one', 'strip'], ['one', 'bar']] as const) for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, w: 1280, query: `fresh${host === 'bar' ? '&single&bar=1' : '&scenario=paper'}` });
    if (c === 'one' && host === 'strip') await oneLine(page);
    await page.evaluate(() => document.fonts.ready);
    const TAB = '.wb-strip--focused .wb-tab.wb-tab--on';
    await page.waitForSelector(`${TAB} [data-name]`);
    const geo = () => page.evaluate((sel: string) => {
      const t = document.querySelector(sel)!, T = t.getBoundingClientRect(), cs = getComputedStyle(t);
      const R = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left - T.left, t: r.top - T.top, r: r.right - T.left, b: r.bottom - T.top }; };
      const rad = (e: Element | null) => { if (!e) return null; const s = getComputedStyle(e); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat); };
      // the text's own box: the chip less its padding and the spacer after the text that is its right padding
      const box = (e: Element | null) => { if (!e) return null; const r = R(e)!, s = getComputedStyle(e), a = getComputedStyle(e, '::after'), aw = /^(none|normal)$/.test(a.content) ? 0 : parseFloat(a.width) || 0; return { t: r.t + parseFloat(s.paddingTop), b: r.b - parseFloat(s.paddingBottom), l: r.l + parseFloat(s.paddingLeft), r: r.r - parseFloat(s.paddingRight) - aw }; };
      const glyphs = [...t.querySelectorAll('.wb-tab-label, .wb-tab-sub-label, .wb-tab-sec-text, .wb-tab-num, .wb-tab-chev svg, .wb-tab-close svg')].map((e) => {
        let r: DOMRect; if (e instanceof SVGElement) r = e.getBoundingClientRect(); else { const g = document.createRange(); g.selectNodeContents(e); r = g.getBoundingClientRect(); }
        return [r.left, r.top, r.width].map((v) => +v.toFixed(2)).join(); });
      const vis = (e: Element | null) => e && getComputedStyle(e).display !== 'none' ? e : null;
      const name = t.querySelector('[data-name]'), sub = vis(t.querySelector('[data-sub]')), x = t.querySelector('.wb-tab-close');
      const tok = (v: string) => { const p = document.createElement("div"); p.style.cssText = `position:absolute;width:var(${v})`; t.appendChild(p); const w = parseFloat(getComputedStyle(p).width); p.remove(); return w; };
      return { strip: t.closest('.wb-strip')!.getBoundingClientRect().height, W: T.width, H: T.height, R: parseFloat(cs.borderTopLeftRadius), I: tok('--wb-chip-inset'), O: tok('--wb-chip-overlap'), two: !!t.querySelector('.wb-tab-text'),
        name: R(name), sub: R(sub), x: R(x), chev: R(vis(t.querySelector('.wb-tab-line > .wb-tab-chev'))),
        nameB: box(name), subB: box(sub), rad: [rad(name), rad(sub), rad(x)].filter(Boolean), glyphs, svg: R(x!.querySelector('svg')) };
    }, TAB);
    const g = await geo();
    const id = `${c} ${host} ${theme}${g.two ? ' (two lines)' : ' (one line)'}`, I = g.I, r = g.R - I, near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
    const n = g.name!, x = g.x!, s = g.sub;
    check(`${id}: the tokens: inset 3 px, the radius concentric (the pill's less the inset), the overlap the line gap + 1 px (6)`, I === 3 && r === 5 && g.O === 6, { I, r, R: g.R, O: g.O });
    if (g.two) check(`${id}: two lines: the pill 49 px, the strip 61, the lines 5 px apart, the name 7 px below the pill's top`, g.H === 49 && g.strip === 61 && near(g.subB!.t - g.nameB!.b, 5) && near(g.nameB!.t, 7), { H: g.H, strip: g.strip, gap: g.subB!.t - g.nameB!.b, top: g.nameB!.t });
    check(`${id}: every chip and the × take the one radius on all four corners`, g.rad.every((q: number[]) => q.every((v) => near(v, r))), g.rad);
    check(`${id}: the × box: the inset from the top, right and bottom; the × centred in it`,
      near(x.t, I) && near(x.b, g.H - I) && near(x.r, g.W - I) && near((g.svg!.l + g.svg!.r) / 2, (x.l + x.r) / 2) && near((g.svg!.t + g.svg!.b) / 2, (x.t + x.b) / 2), { x, svg: g.svg, W: g.W, H: g.H });
    if (g.two) {
      check(`${id}: the name chip: the inset from the left and the top, to the × box`, near(n.l, I) && near(n.t, I) && near(n.r, x.l), { n, x });
      if (s) {
        check(`${id}: the section chip: the inset from the left and the bottom, to the × box`, near(s.l, I) && near(s.b, g.H - I) && near(s.r, x.l), { s, x });
        check(`${id}: the name and section chips overlap by the token across the band between the lines`,
          near(n.b - s.t, g.O) && s.t <= g.nameB!.b + 0.5 && n.b >= g.subB!.t - 0.5, { nb: n.b, st: s.t, O: g.O });
      }
    } else {
      const lpad = g.nameB!.l - n.l, ext = n.r - g.nameB!.r;      // the name chip's pill-side padding, its reach toward the chevron
      check(`${id}: the name chip: the inset from the left, the top and the bottom`, near(n.l, I) && near(n.t, I) && near(n.b, g.H - I), n);
      if (s) {
        check(`${id}: the section chip mirrors the name chip around the chevron (the same height, reach and outer padding)`,
          near(s.t, n.t) && near(s.b, n.b) && near(g.subB!.l - s.l, ext) && near(s.r - g.subB!.r, lpad) && near(lpad, 12 - I) && near(ext, 16) && s.r <= x.l + g.O + 0.5 && n.r >= g.chev!.r - 2.5 && s.l <= g.chev!.l + 2.5,
          { n, s, lpad, ext, sl: g.subB!.l - s.l, sr: s.r - g.subB!.r, chev: g.chev, x });
      }
    }
    // hover each chip: it shows, and no glyph moves
    const moved: string[] = [];
    for (const [part, sel] of [['name', '[data-name]'], ['section', '[data-sub]'], ['×', '.wb-tab-close']] as const) {
      if (part === 'section' && !s) continue;
      const r = await page.locator(`${TAB} ${sel}`).first().boundingBox();
      await page.mouse.move(r!.x + Math.min(r!.width / 2, 16), r!.y + r!.height / 2);
      await page.waitForFunction((q: string) => getComputedStyle(document.querySelector(q)!).backgroundColor !== 'rgba(0, 0, 0, 0)', `${TAB} ${sel}`);
      if ((await geo()).glyphs.join('|') !== g.glyphs.join('|')) moved.push(part);
    }
    check(`${id}: every chip shows on hover; no glyph moves between rest and hover`, moved.length === 0, moved);
    // the rename field takes the name chip's box, its text where the name's is
    await page.mouse.move(2, 790);
    await page.keyboard.press('F2').catch(() => {});
    await page.evaluate((sel: string) => { const t = document.querySelector(sel) as HTMLElement; (window as any).demo.wb.rename(t.dataset.tab); }, TAB);
    await page.waitForSelector('.wb-rename');
    const rn = await page.evaluate((sel: string) => { const t = document.querySelector(sel)!, T = t.getBoundingClientRect(), f = document.querySelector('.wb-rename')!, r = f.getBoundingClientRect(), cs = getComputedStyle(f);
      return { l: r.left - T.left, t: r.top - T.top, r: r.right - T.left, b: r.bottom - T.top, textL: r.left - T.left + parseFloat(cs.paddingLeft), rad: parseFloat(cs.borderTopLeftRadius) }; }, TAB);
    check(`${id}: the rename field = the name chip's box and radius; its text where the name's starts`,
      near(rn.l, n.l) && near(rn.t, n.t) && near(rn.b, n.b) && near(rn.r, n.r) && near(rn.textL, g.nameB!.l) && near(rn.rad, r), { rn, n, nameL: g.nameB!.l });
    await page.keyboard.press('Escape');
    await page.close();
  }
});

// ── the chips as PAINTED: the in-bar tabs' the same as the one-line row's (insets, corners, the mirror) ──
group('chips as painted: in the top bar exactly as in the one-line row (the insets, the four corners, the section mirroring the name); light and dark', async () => {
  for (const theme of ['light', 'dark']) {
    const shapes: Record<string, any> = {};
    for (const host of ['row', 'bar']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
      await page.goto(`http://wb.test/?fresh&sides=0&theme=${theme}${host === 'bar' ? '&single&bar=1' : '&scenario=paper&bar=0'}`);
      await page.waitForSelector('.wb-tab');
      if (host === 'row') await oneLine(page);
      if (host === 'bar') { await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } }, { focus: false })); await page.waitForSelector('.wb-strip--inbar .wb-tab:not(.wb-tab--on)'); }
      await page.evaluate(() => document.fonts.ready);
      const TAB = `${host === 'bar' ? '.wb-strip--inbar' : '.wb-strip--focused'} .wb-tab.wb-tab--on`;
      const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      await page.mouse.move(2, 590); await settle();
      const T = (await page.locator(TAB).boundingBox())!;
      // a whole-pixel clip 2 px around the pill; the insets are taken back to the pill's own (fractional) edges
      const C = { x: Math.floor(T.x) - 2, y: Math.floor(T.y) - 2, width: Math.ceil(T.width) + 4, height: Math.ceil(T.height) + 4 };
      const shot = async () => decodePng(await page.screenshot({ clip: C }));
      await page.mouse.move(2, 590); await settle();
      const rest = await shot();
      for (const [part, sel] of [['name', '[data-name]'], ['section', '[data-sub]']]) {
        const r = (await page.locator(`${TAB} ${sel}`).boundingBox())!;
        await page.mouse.move(r.x + 6, r.y + r.height / 2);
        await page.waitForFunction((q: string) => getComputedStyle(document.querySelector(q)!).backgroundColor !== 'rgba(0, 0, 0, 0)', `${TAB} ${sel}`);
        await settle();
        const h = await shot();
        // the changed pixels: the chip's painted area (device px)
        let l = 1e9, t = 1e9, rr = -1, b = -1; const on = (x: number, y: number) => Math.abs(luma(h.px, (y * h.w + x) * 4) - luma(rest.px, (y * h.w + x) * 4)) > 1.5;
        for (let y = 0; y < h.h; y++) for (let x = 0; x < h.w; x++) if (on(x, y)) { l = Math.min(l, x); t = Math.min(t, y); rr = Math.max(rr, x); b = Math.max(b, y); }
        const corner = (x0: number, y0: number, dx: number, dy: number) => { let n = 0; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) if (on(x0 + dx * i, y0 + dy * j)) n++; return n; };
        shapes[`${host} ${part}`] = { top: C.y + t / 2 - T.y, bottom: T.y + T.height - (C.y + (b + 1) / 2), ...(part === 'name' ? { left: C.x + l / 2 - T.x } : { right: T.x + T.width - (C.x + (rr + 1) / 2) }),
          corners: [corner(l, t, 1, 1), corner(rr, t, -1, 1), corner(rr, b, -1, -1), corner(l, b, 1, -1)] };
      }
      await ctx.close();
    }
    // alike: the insets within 0.5 px (a pill at a fractional x antialiases its edge), each corner's painted pixels within 4 (a square corner differs by ~17)
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5, corners = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 4);
    const alike = (a: any, b: any, side: string) => near(a.top, b.top) && near(a.bottom, b.bottom) && near(a[side], b[side]) && corners(a.corners, b.corners);
    check(`${theme}: the name chip painted alike in the bar and the row (the insets, the four corners); 3 px from the pill`, alike(shapes['bar name'], shapes['row name'], 'left') && near(shapes['row name'].top, 3) && near(shapes['row name'].left, 3), shapes);
    check(`${theme}: the section chip painted alike in the bar and the row; its four corners as the name chip's, all four alike`,
      near(shapes['bar section'].top, shapes['row section'].top) && near(shapes['bar section'].bottom, shapes['row section'].bottom) && corners(shapes['bar section'].corners, shapes['row section'].corners)
      && corners(shapes['row section'].corners, shapes['row name'].corners) && shapes['row name'].corners.every((c: number) => Math.abs(c - shapes['row name'].corners[0]) <= 4), shapes);
  }
});

// ── a hidden × takes no room; the text's last part takes it; shown, it takes it back at once ──
group('the hidden × takes no room: the text reaches the pill side padding; hover or focus shows it at once (no transition); the pill and its neighbours keep their boxes; two lines, one line, the top bar', async () => {
  for (const [c, host] of [['two', 'strip'], ['one', 'strip'], ['one', 'bar']] as const) {
    const page = await fresh({ query: `fresh${host === 'bar' ? '&single&bar=1' : '&scenario=paper'}` });
    if (c === 'one' && host === 'strip') await oneLine(page);
    if (host === 'bar') { await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } }, { focus: false })); await page.waitForSelector('.wb-strip--inbar .wb-tab:not(.wb-tab--on) .wb-tab-sec'); }
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(2, 790);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const STRIP = host === 'bar' ? '.wb-strip--inbar' : '.wb-strip--focused';
    // an inactive tab with a section; one line: its section made long, so it truncates (the room it takes shows)
    const id = await page.evaluate((st: string) => {
      const t = [...document.querySelectorAll(`${st} .wb-tab:not(.wb-tab--on)`)].find((e) => e.querySelector('[data-sub]')) as HTMLElement;
      const sec = t.querySelector('.wb-tab-sec-text'); if (sec) sec.textContent = 'A very long section name that cannot fit in its tab at all';
      return t.dataset.tab;
    }, STRIP);
    const TAB = `${STRIP} .wb-tab[data-tab="${id}"]`;
    const geo = () => page.evaluate(([sel, st]: string[]) => {
      const t = document.querySelector(sel)!, T = t.getBoundingClientRect(), x = t.querySelector('.wb-tab-close')!;
      const tok = (v: string) => { const p = document.createElement('div'); p.style.cssText = `position:absolute;width:var(${v})`; t.appendChild(p); const w = parseFloat(getComputedStyle(p).width); p.remove(); return w; };
      const R = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: +(r.left - T.left).toFixed(2), r: +(r.right - T.left).toFixed(2), w: +r.width.toFixed(2) }; };
      return { W: T.width, I: tok('--wb-chip-inset'), cpl: tok('--wb-cpl'), O: tok('--wb-chip-overlap'), shown: getComputedStyle(x).display !== 'none', x: R(x), box: R(t.querySelector('.wb-tab-text, .wb-tab-line')),
        name: R(t.querySelector('.wb-tab-label')), sub: R(t.querySelector('.wb-tab-sub')), sec: R(t.querySelector('.wb-tab-sec')), chev: R(t.querySelector('.wb-tab-line > .wb-tab-chev')),
        anims: [...x.getAnimations(), ...t.querySelector('.wb-tab-text, .wb-tab-line')!.getAnimations({ subtree: true })].length,
        pills: [...document.querySelectorAll(`${st} .wb-tab`)].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.width].map((v) => +v.toFixed(2)).join(); }).join('|') };
    }, [TAB, STRIP]);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
    const rest = await geo(), end = rest.W - rest.I - rest.cpl;     // where the × box ends, less the pill-side padding
    const O = c === 'one' ? rest.O : 0;     // one line: the last chip and the × overlap
    const tag = `${c} ${host}`;
    check(`${tag}: at rest the × takes no room; the text box reaches the × box's end less the pill-side padding`,
      !rest.shown && near(rest.box!.r, end) && (c === 'two' ? near(rest.name!.r, end) && near(rest.sub!.r, end) : near(rest.sec!.r, end)), { rest, end });
    // hover the name: the × shows, in the same frame (read right after the move), no animation
    const b = (await page.locator(TAB).boundingBox())!;
    await page.mouse.move(b.x + 16, b.y + b.height / 2);
    const hov = await geo(), room = rest.box!.r - hov.box!.r;
    check(`${tag}: hovered the × shows at once (no animation on the × or the text), its box the inset from the pill's right; the text box up to it, shorter by its room`,
      hov.shown && hov.anims === 0 && near(hov.x!.r, rest.W - rest.I) && near(room, hov.x!.r - hov.x!.l - rest.cpl) && near(hov.box!.r, hov.x!.l), { hov, room });
    check(`${tag}: hovered the name keeps its place${c === 'one' ? ', the chevron too, the section gives the room' : ', both lines give the room'}`,
      near(hov.name!.l, rest.name!.l) && (c === 'two' ? near(hov.name!.r, hov.box!.r) && near(hov.sub!.r, hov.box!.r)
        : near(hov.name!.w, rest.name!.w) && near(hov.chev!.l, rest.chev!.l) && near(hov.sec!.r, hov.box!.r) && near(rest.sec!.w - hov.sec!.w, room)), { rest, hov });
    check(`${tag}: the pill's box and every other pill's unchanged`, hov.pills === rest.pills, { rest: rest.pills, hov: hov.pills });
    // the keyboard inside the tab shows it too
    await page.mouse.move(2, 790);
    const back = await geo();
    await page.evaluate((sel: string) => (document.querySelector(`${sel} > [role="tab"]`) as HTMLElement).focus(), TAB);
    const foc = await geo();
    check(`${tag}: away again it hides at once; focused, it shows`, !back.shown && near(back.box!.r, end) && foc.shown, { back: back.box, foc: foc.shown });
    await page.close();
  }
});

// ── one line: the last chip and the × overlap as the two lines' chips do ──
group('one line: the section chip and the × overlap by the two lines\' chip overlap (painted); the × keeps its whole box', async () => {
  // painted: one line (the section made long, so its chip fills its line) hover the section then the ×; two lines the name then the section
  const ext: Record<string, any> = {};
  for (const c of ['one', 'two']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto('http://wb.test/?fresh&sides=0&scenario=paper&bar=0');
    await page.waitForSelector('.wb-tab');
    if (c === 'one') await oneLine(page);
    await page.evaluate(() => document.fonts.ready);
    const TAB = '.wb-strip--focused .wb-tab.wb-tab--on';
    if (c === 'one') await page.evaluate((q: string) => { document.querySelector(`${q} .wb-tab-sec-text`)!.textContent = 'A very long section name that cannot fit in its tab at all'; }, TAB);
    const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await page.mouse.move(2, 590); await settle();
    const T = (await page.locator(TAB).boundingBox())!;
    const C = { x: Math.floor(T.x) - 2, y: Math.floor(T.y) - 2, width: Math.ceil(T.width) + 4, height: Math.ceil(T.height) + 4 };
    const shot = async () => decodePng(await page.screenshot({ clip: C }));
    const rest = await shot();
    for (const [part, sel] of (c === 'one' ? [['a', '[data-sub]'], ['b', '.wb-tab-close']] : [['a', '[data-name]'], ['b', '[data-sub]']])) {
      const r = (await page.locator(`${TAB} ${sel}`).boundingBox())!;
      await page.mouse.move(part === 'a' ? r.x + 6 : r.x + r.width - 4, r.y + r.height / 2);
      await page.waitForFunction((q: string) => getComputedStyle(document.querySelector(q)!).backgroundColor !== 'rgba(0, 0, 0, 0)', `${TAB} ${sel}`);
      await settle();
      const h = await shot();
      let l = 1e9, t = 1e9, rr = -1, b = -1;
      for (let y = 0; y < h.h; y++) for (let x = 0; x < h.w; x++) if (Math.abs(luma(h.px, (y * h.w + x) * 4) - luma(rest.px, (y * h.w + x) * 4)) > 1.5) { l = Math.min(l, x); t = Math.min(t, y); rr = Math.max(rr, x); b = Math.max(b, y); }
      ext[`${c} ${part}`] = { l: C.x + l / 2, t: C.y + t / 2, r: C.x + (rr + 1) / 2, b: C.y + (b + 1) / 2 };
    }
    if (c === 'one') {
      // the × above the section chip: its box hits it (its edges and middle; the rounded corners aside)
      const hit = await page.evaluate((q: string) => { const x = document.querySelector(`${q} .wb-tab-close`)!, r = x.getBoundingClientRect(); const pts = [];
        for (const [fx, fy] of [[0.06, 0.5], [0.15, 0.5], [0.2, 0.5], [0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.94, 0.5], [0.5, 0.06], [0.5, 0.94], [0.25, 0.25], [0.25, 0.75]]) { const e = document.elementFromPoint(r.left + fx * r.width, r.top + fy * r.height); pts.push(x.contains(e) ? 1 : (e?.className as unknown as SVGAnimatedString)?.baseVal ?? e?.className); } return pts; }, TAB);
      check('one line: the × takes every point of its box (above the section chip under it)', hit.every((v: any) => v === 1), hit);
      const el = await page.evaluate((q: string) => { const s = document.querySelector(`${q} .wb-tab-sec`)!, l = s.querySelector('.wb-tab-sec-text')!; return { cut: l.scrollWidth > l.clientWidth + 1, ell: getComputedStyle(l).textOverflow }; }, TAB);
      check('one line: the long section still truncates with "…"', el.cut && el.ell === 'ellipsis', el);
    }
    await ctx.close();
  }
  const one = ext['one a'].r - ext['one b'].l, two = ext['two a'].b - ext['two b'].t;
  check('the painted one-line overlap (the section ground under the × ground) equals the two lines\' (the name ground over the section ground): 6 px', Math.abs(one - two) <= 0.5 && Math.abs(two - 6) <= 0.5, { one, two, ext });
});

// ── a chip and the menu it opens share one edge: the rows' grounds start where the chip does ──
group('dropdowns: the rows line up with the chip that opened them; the popover the pill radius, the rows the chip radius, the chip inset; both forms; both hosts', async () => {
  for (const [c, host] of [['two', 'strip'], ['one', 'strip'], ['one', 'bar']] as const) {
    const page = await fresh({ query: `fresh${host === 'bar' ? '&single&bar=1' : '&scenario=paper'}` });
    if (c === 'one' && host === 'strip') await oneLine(page);
    await page.evaluate(() => document.fonts.ready);
    const TAB = `${host === 'bar' ? '.wb-strip--inbar' : '.wb-strip--focused'} .wb-tab.wb-tab--on`;
    for (const [part, sel] of [['document', '[data-name]'], ['section', '[data-sub]']] as const) {
      await page.click(`${TAB} ${sel}`);
      await page.waitForSelector('.wb-pop :is(.wb-row, .wb-menu-item)');
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      const g = await page.evaluate(([t, s]: string[]) => {
        const chip = document.querySelector(`${t} ${s}`)!.getBoundingClientRect(), pill = document.querySelector(t)!, pop = document.querySelector('.wb-pop')!, row = pop.querySelector('.wb-row, .wb-menu-item')!;
        const pr = pop.getBoundingClientRect(), rr = row.getBoundingClientRect(), rad = (e: Element) => parseFloat(getComputedStyle(e).borderTopLeftRadius);
        return { chip: chip.left, row: rr.left, inset: +(rr.left - pr.left + parseFloat(getComputedStyle(pop).getPropertyValue('--wb-pop-ring'))).toFixed(2),     // from the ring's outer edge
          popR: rad(pop), pillR: rad(pill), rowR: rad(row), chipR: rad(document.querySelector(`${t} ${s}`)!),
          chipInset: parseFloat(getComputedStyle(pill).getPropertyValue('--wb-chip-inset')) };
      }, [TAB, sel]);
      check(`${c} ${host}, ${part}: the rows' left edge = the chip's (±0.5); the inset (from the ring's outer edge) the chip's; the popover the pill radius, the rows the chip radius`,
        Math.abs(g.row - g.chip) <= 0.5 && g.inset === g.chipInset && g.popR === g.pillR && g.rowR === g.chipR, g);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.wb-pop', { state: 'detached' });
    }
    await page.close();
  }
});

// ── the rows' hover ground: the one-line chip's (height, radius); between rows the inset, no hover target ──
group('dropdowns: each row\'s hover ground = the one-line chip\'s (painted height, radius); between rows the inset, hovering it highlights nothing; the row button the same height', async () => {
  const page = await fresh({ query: 'fresh&scenario=paper' });
  await oneLine(page);
  await page.evaluate(() => document.fonts.ready);
  const TAB = '.wb-strip--focused .wb-tab.wb-tab--on';
  const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  // the painted height of a hover: the device pixels of a column that change when the pointer comes over (x, y)
  const painted = async (x: number, y: number, top: number, h: number, hover = { x, y }) => {
    const clip = { x: Math.round(x), y: Math.floor(top), width: 1, height: Math.ceil(h) };
    await page.mouse.move(2, 2); await settle();
    const a = decodePng(await page.screenshot({ clip }));
    await page.mouse.move(hover.x, hover.y); await settle();
    const b = decodePng(await page.screenshot({ clip }));
    let k = 0; for (let i = 0; i < a.px.length; i += 4) if (Math.abs(luma(a.px, i) - luma(b.px, i)) > 1) k++;
    return k;
  };
  const chip = await page.evaluate((t: string) => { const c = document.querySelector(`${t} [data-name]`)!, r = c.getBoundingClientRect();
    return { x: r.left + 2, y: r.top + r.height / 2, top: r.top - 4, h: r.height + 8, r: parseFloat(getComputedStyle(c).borderTopLeftRadius), boxH: r.height }; }, TAB);
  const chipH = await painted(chip.x, chip.y, chip.top, chip.h);
  check('the one-line chip ground: painted as tall as its box', chipH === Math.round(chip.boxH), { chipH, chip });
  for (const [part, sel] of [['document', '[data-name]'], ['section', '[data-sub]']] as const) {
    await page.click(`${TAB} ${sel}`);
    await page.waitForSelector('.wb-pop .wb-row');
    await settle();
    const g = await page.evaluate(() => { const pop = document.querySelector('.wb-pop .wb-menu')!, rows = [...pop.querySelectorAll('.wb-row')], pick = rows.findIndex((r, i) => i > 0 && i + 1 < rows.length && !r.classList.contains('is-active') && !rows[i + 1].classList.contains('is-active'));
      const a = rows[pick].getBoundingClientRect(), b = rows[pick + 1].getBoundingClientRect(), gapY = (a.bottom + b.top) / 2, x = a.left + 2, btn = rows[pick].querySelector('.wb-row-btn');
      const hit = document.elementFromPoint(x, gapY);
      return { pick, x, y: a.top + a.height / 2, top: a.top - 4, h: a.height + 8, rowH: a.height, gap: +(b.top - a.bottom).toFixed(2), gapY, hitList: hit === pop, hitRow: !!hit?.closest('.wb-row'),
        r: parseFloat(getComputedStyle(rows[pick]).borderTopLeftRadius), btnH: btn ? btn.getBoundingClientRect().height : null, inset: parseFloat(getComputedStyle(pop).getPropertyValue('--wb-chip-inset')) }; });
    const rowH = await painted(g.x, g.y, g.top, g.h);
    check(`${part}: the row's hover ground painted as tall as the chip's; the chip's radius`, rowH === chipH && g.r === chip.r, { rowH, chipH, g });
    check(`${part}: the gap between rows = the inset; the point there is the list's, no row's`, g.gap === g.inset && g.hitList && !g.hitRow, g);
    const gapPaint = await painted(g.x, g.y, g.top, g.h, { x: g.x, y: g.gapY });
    const hovered = await page.evaluate(() => document.querySelectorAll('.wb-pop .wb-row:hover, .wb-pop .wb-menu-item:hover').length);
    check(`${part}: the pointer in the gap highlights nothing`, gapPaint === 0 && hovered === 0, { gapPaint, hovered });
    if (part === 'document') check(`${part}: the row button the row's height`, g.btnH === g.rowH, g);
    // the keyboard: the focused row's ground, the row's box (not the gap)
    await page.keyboard.press('ArrowDown');
    const f = await page.evaluate(() => { const a = document.activeElement!, r = a.closest('.wb-row')!; return { a: a.getBoundingClientRect().height, r: r.getBoundingClientRect().height }; });
    check(`${part}: the keyboard focus on the row's ground (its box the row's)`, f.a === f.r && f.r === g.rowH, f);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.wb-pop', { state: 'detached' });
  }
  await page.close();
});

// ── the insertion bar: drawn whole (2 px) at the first, a middle and the last position, centred in the gap ──
group('insertion bar: 2 px drawn whole at index 0, in the middle and at the end, centred in the gap between tabs; one line, two lines, the bar, a side panel', async () => {
  for (const [name, q, row, item] of [['one line', 'fresh&sides=0', '.wb-strip--focused .wb-tabs', '[data-tab]'], ['two lines', 'fresh&sides=0', '.wb-strip--focused .wb-tabs', '[data-tab]'],
    ['the top bar', 'fresh&single&bar=1&sides=0', '.wb-strip--inbar .wb-tabs', '[data-tab]'], ['a side panel', 'fresh&sides=1', 'aside[data-side="right"] .wb-ptabs', '[data-ptab]']] as const) {
    const page = await fresh({ query: q, sides: q.includes('sides=1') });
    if (name === 'one line') await oneLine(page);
    if (name === 'the top bar') for (const doc of ['graphs']) await page.evaluate((d: string) => (window as any).demo.wb.open({ view: 'document', state: { doc: d } }, { focus: false }), doc);
    await page.waitForFunction(([r, i]: string[]) => (document.querySelector(r)?.querySelectorAll(i).length ?? 0) >= (r.includes('ptabs') ? 1 : 2), [row, item]);
    const tabs = async () => page.evaluate(([r, i]: string[]) => [...document.querySelector(r)!.querySelectorAll(i)].map((t) => { const b = t.getBoundingClientRect(); return { l: b.left, r: b.right, y: b.top + b.height / 2 }; }), [row, item]);
    const t0 = await tabs(), src = await center(page, name === 'a side panel' ? '[data-ptab="problems"]' : `${row} ${item}:nth-child(2)`);
    const seen: any[] = [];
    // (the top bar holds two tabs: dragging the second, only the first place is a move)
    for (const [at, x] of [['first', t0[0].l + 3], ...(name === 'the top bar' ? [] : [...(t0.length > 1 ? [['middle', t0[1].l + 3]] : []), ['end', t0.at(-1)!.r - 3]])] as [string, number][]) {
      await drag(page, src, { x, y: t0[0].y }, { release: false });
      if (!await page.waitForSelector(`${row} .wb-insert`, { timeout: 3000 }).then(() => true, () => false)) { seen.push({ at, none: true }); await page.keyboard.press('Escape'); await page.mouse.up(); continue; }
      // as the strip is now (mid-drag): centred in the gap; at an end half a gap out, as near it as the scroll box allows
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));     // the bar glides to its place
      const m = await page.evaluate(([r, i, at]: string[]) => { const el = document.querySelector(r)!, box = el.getBoundingClientRect(), b = el.querySelector('.wb-insert')!.getBoundingClientRect(), half = (parseFloat(getComputedStyle(el).columnGap) || 0) / 2;
        const ts = [...el.querySelectorAll(i)].map((t) => t.getBoundingClientRect());
        const want = at === 'first' ? Math.max(box.left + 1, ts[0].left - half) : at === 'end' ? Math.min(box.right - 1, ts.at(-1)!.right + half) : (ts[0].right + ts[1].left) / 2;
        return { vis: +(Math.min(b.right, box.right) - Math.max(b.left, box.left)).toFixed(2), mid: (b.left + b.right) / 2, want }; }, [row, item, at]);
      const want = m.want;
      seen.push({ at, vis: m.vis, d: +(m.mid - want).toFixed(2) });
      await page.keyboard.press('Escape'); await page.mouse.up();
      await page.waitForSelector(`${row} .wb-insert`, { state: 'detached' });
    }
    check(`${name}: the bar 2 px wide where it shows (first, middle, end), centred in its gap (±0.5)`, seen.every((s) => Math.abs(s.vis - 2) <= 0.05 && Math.abs(s.d) <= 0.5), seen);
    await page.close();
  }
});

// ── the glass: the content shows through the strip and the top bar (blurred), never opaque; high contrast solid ──
group('glass: 40 px stripes under the strip and the top bar show through (luma spread over a flat strip area); light, dark, sepia; high contrast solid', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) {
    const page = await fresh({ theme, query: 'fresh&bar=1' });
    await page.addStyleTag({ content: '.wb-panel, .wb-panel * { background: repeating-linear-gradient(90deg, #000 0 40px, #fff 40px 80px) !important; }' });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    // empty glass: the strip's band above its pills (the tabs fill the strip: no free end) and the bar's middle
    const g = await page.evaluate(() => { const s = [...document.querySelectorAll('.wb-strip')].find((e) => e.getBoundingClientRect().height > 0 && !e.classList.contains('wb-strip--inbar'))!.getBoundingClientRect(), b = document.querySelector('.wb-bar')!.getBoundingClientRect();
      const st = [...document.querySelectorAll('.wb-strip')].find((e) => e.getBoundingClientRect().height > 0 && !e.classList.contains('wb-strip--inbar'))!, top = Math.min(...[...st.querySelectorAll('.wb-tab, .wb-btn')].map((t) => t.getBoundingClientRect().top));
      return { s: { x: Math.round(s.left + 60), y: Math.ceil(s.top) + 1, w: 180, h: Math.max(1, Math.floor(top) - Math.ceil(s.top) - 2) }, b: { x: Math.round(b.left + 400), y: Math.round(b.top + 2), w: 180, h: 4 } }; });
    const png = decodePng(await page.screenshot());
    const sd = (r: any) => { const v: number[] = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) v.push(luma(png.px, (y * png.w + x) * 4)); const m = v.reduce((a, b) => a + b, 0) / v.length; return +Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length).toFixed(2); };
    const r = { strip: sd(g.s), bar: sd(g.b) };
    if (theme === 'hc') check(`${theme}: solid: nothing shows through`, r.strip < 0.5 && r.bar < 0.5, r);
    else check(`${theme}: the stripes show through the strip and the bar (spread ≥ 4; opaque glass gives 0, today ~10)`, r.strip >= 4 && r.bar >= 4, r);
    await page.close();
  }
});

// ── the popover's painted edge (its shadow's ring included) on the pill's left edge, to the device pixel ──
group('dropdowns: the popover\'s painted left edge (the ring) = the pill\'s, to the device pixel; DPR 1, 2, 3; two lines, one line, the bar; every theme', async () => {
  const runs: [number, string][] = [[1, 'light'], [3, 'light'], [2, 'light'], [2, 'dark'], [2, 'sepia'], [2, 'hc']];
  for (const [dpr, theme] of runs) for (const [c, host] of [['two', 'strip'], ['one', 'strip'], ['one', 'bar']] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&sides=0&theme=${theme}${host === 'bar' ? '&single&bar=1' : '&scenario=paper&bar=0'}`);
    await page.waitForSelector('.wb-tab');
    if (c === 'one' && host === 'strip') await oneLine(page);
    const TAB = `${host === 'bar' ? '.wb-strip--inbar' : '.wb-strip--focused'} .wb-tab.wb-tab--on`;
    await page.click(`${TAB} [data-name]`);
    await page.waitForSelector('.wb-pop :is(.wb-row, .wb-menu-item)');
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const g = await page.evaluate((t: string) => { const pop = document.querySelector('.wb-pop')!, sh = getComputedStyle(pop).boxShadow, m = sh.match(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/);
      const ring = m && +m[1] === 0 && +m[2] === 0 && +m[3] === 0 ? +m[4] : 0;
      const row = pop.querySelector('.wb-row, .wb-menu-item')!, anchor = document.querySelector(`${t} [data-name]`)!;
      return { pop: pop.getBoundingClientRect().left - ring, pill: document.querySelector(t)!.getBoundingClientRect().left, ring, dpr: devicePixelRatio, rowOff: +(row.getBoundingClientRect().left - anchor.getBoundingClientRect().left).toFixed(4) }; }, TAB);
    check(`DPR ${dpr}, ${theme}, ${c} ${host}: the popover's painted left edge on the pill's (the same device pixel)`, Math.round(g.pop * g.dpr) === Math.round(g.pill * g.dpr), g);
    // (the row's inset was measured mid-opening, under wb-float-in's scale: 0.04 px off, a device pixel when the pill sat near a half pixel)
    check(`DPR ${dpr}, ${theme}, ${c} ${host}: the first row on the anchor to a layout unit (1/64 px; the opening scale taken out)`, Math.abs(g.rowOff) <= 1 / 64, g);
    await ctx.close();
  }
});

// ── a line under every tab strip, always: the groups' (one and two lines, home showing, no tabs), the bar's, the side panels' ──
group('strip line: painted under every strip kind (one line, two lines, home showing, no tabs, the top bar, a side panel) to both ends, just below the strip; the gaps above and below the active pill equal; every theme, DPR 1 and 2', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    const out: any[] = [];
    // the line: the strip's bottom device row differs from the ground 3 px above it, at both ends and the middle
    const probe = async (kind: string, sel: string) => {
      // the pressed home button and the closed tabs fade their grounds (transitions): measure them settled
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      const els = await page.evaluate((s: string) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().height > 0).map((e) => { const r = e.getBoundingClientRect(), p = e.querySelector('.wb-tab.wb-tab--on, .wb-ptab[aria-selected="true"], .wb-home-btn[aria-pressed="true"]')?.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, px: p ? p.left + 10 : null }; }), sel);
      const png = decodePng(await page.screenshot());
      for (const e of els) {
        const xs = [e.l + 2, (e.l + e.r) / 2, e.r - 2].map((x) => Math.round(x * dpr));
        const lineAt = (y: number) => xs.every((x) => Math.abs(luma(png.px, (y * png.w + x) * 4) - luma(png.px, ((y - 1 - 3 * dpr) * png.w + x) * 4)) > 2);
        // Chromium paints a strip laid out at a half CSS px (below a stack's splitter at DPR 2: the line's share,
        // calc(1px - --wb-hair)) on the next whole CSS px, the line, the pills and the splitter's line alike: the
        // painted line is then one device row below its box's edge
        const y0 = Math.round(e.b * dpr), yl = !lineAt(y0) && e.b % 1 && lineAt(y0 + 1) ? y0 + 1 : y0, ok = lineAt(yl);
        // the active pill's painted top and bottom in a column through it: the gaps to the strip's top and to the line
        let gaps: number[] | null = null;
        // (from the last line above it, where a splitter line sits on the strip's top)
        if (e.px != null) { const x = Math.round(e.px * dpr), at = (y: number) => luma(png.px, (y * png.w + x) * 4); let y0 = Math.round(e.t * dpr); const g = at(y0 + 2 * dpr);
          while (Math.abs(at(y0) - g) > 3 && y0 < yl) y0++;
          let top = -1, bot = -1; for (let y = y0; y < yl; y++) if (Math.abs(at(y) - g) > 3) { if (top < 0) top = y; bot = y; }
          gaps = [(top - y0) / dpr, (yl - bot - 1) / dpr]; }
        out.push({ kind, ok: ok && (!gaps || Math.abs(gaps[0] - gaps[1]) <= 0.5), gaps });
      }
      if (!els.length) out.push({ kind, ok: false, none: true });
    };
    await page.goto(`http://wb.test/?fresh&bar=0&theme=${theme}`); await page.waitForSelector('.wb-tab'); await oneLine(page); await page.mouse.move(600, 590);
    await probe('one line', '.wb-groups .wb-strip'); await probe('side panel', '.wb-side-strip');
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`http://wb.test/?fresh&bar=0&theme=${theme}`); await page.waitForSelector('.wb-tab'); await page.mouse.move(600, 590);
    await probe('two lines', '.wb-groups .wb-strip');
    await page.click('.wb-strip--focused .wb-home-btn'); await page.waitForSelector('.wb-strip--home'); await page.mouse.move(600, 590);
    await probe('home showing', '.wb-strip--home');
    await page.goto(`http://wb.test/?fresh&single&bar=1&sides=0&theme=${theme}`); await page.waitForSelector('.wb-tab');
    await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } }, { focus: false }));
    await page.waitForSelector('.wb-strip--inbar .wb-tab:not(.wb-tab--on)'); await page.mouse.move(600, 590);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await probe('the top bar', '.wb-bar');
    await page.evaluate(() => { const w = (window as any).demo.wb; for (const id of [...document.querySelectorAll('.wb-strip--inbar [data-tab]')].map((t) => (t as HTMLElement).dataset.tab)) w.close(id); });
    await page.waitForFunction(() => !document.querySelector('.wb-groups .wb-tab, .wb-strip--inbar .wb-tab'));
    await probe('no tabs', '.wb-strip:not([hidden])');
    check(`${theme}, DPR ${dpr}: a line under every strip kind, at both ends and the middle`, out.every((o) => o.ok) && new Set(out.map((o) => o.kind)).size === 6, out.filter((o) => !o.ok).concat([{ kinds: [...new Set(out.map((o) => o.kind))] } as any]));
    await ctx.close();
  }
});

// ── after the click that activates a tab, its chips wait: a move past the threshold, a second press, or leave and back ──
group('activating click: no chip at once; 2 px: none; past the threshold: the chip; a second click: the switcher and the chip; leave and back: the chip; both hosts', async () => {
  for (const host of ['strip', 'bar']) {
    const page = await fresh({ w: 1280, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&scenario=paper' });
    await page.evaluate(() => document.fonts.ready);
    if (host === 'bar') { await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } })); await page.waitForSelector('.wb-strip--inbar .wb-tab:not(.wb-tab--on) [data-name]'); await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))); }
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const bg = (id: string) => page.evaluate(([i, s]: string[]) => getComputedStyle(document.querySelector(`${s} [data-tab="${i}"] [data-name]`)!).backgroundColor, [id, S]);
    const S = host === 'bar' ? '.wb-strip--inbar' : '.wb-strip--focused';
    const NONE = 'rgba(0, 0, 0, 0)';
    // press on an inactive tab's name; returns its id and the press point
    const activate = async () => {
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));     // the tabs at their places (an opening tab grows; an activation re-divides)
      const id = await page.evaluate((s: string) => (document.querySelector(`${s} .wb-tab:not(.wb-tab--on):has([data-name])`) as HTMLElement)?.dataset.tab, S);
      const r = await page.locator(`${S} [data-tab="${id}"] [data-name]`).boundingBox();
      const p = { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 };
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
      await page.waitForSelector(`${S} [data-tab="${id}"].wb-tab--on`);
      await frames();
      return { id: id!, p };
    };
    let a = await activate(), id = a.id, p = a.p;
    check(`${host}: right after the activating click, the pointer still on the name: no chip`, await bg(id) === NONE, await bg(id));
    await page.mouse.move(p.x + 2, p.y); await frames();
    check(`${host}: moved 2 px: still no chip`, await bg(id) === NONE, await bg(id));
    await page.mouse.move(p.x + 7, p.y);
    const shown = await page.waitForFunction(([i, s]: string[]) => getComputedStyle(document.querySelector(`${s} [data-tab="${i}"] [data-name]`)!).backgroundColor !== 'rgba(0, 0, 0, 0)', [id, S], { timeout: 2000 }).then(() => true, () => false);
    check(`${host}: moved past the threshold: the chip shows`, shown);
    // a second click at the same point: the switcher opens, the chip state shows
    await page.mouse.move(2, 790); await frames();
    a = await activate(); id = a.id; p = a.p;
    await page.mouse.down(); await page.mouse.up();
    const menu = await page.waitForSelector('[role="grid"] [role="row"], [role="menu"], [role="listbox"]', { timeout: 3000 }).then(() => true, () => false);
    const second = await page.waitForFunction(([i, s]: string[]) => getComputedStyle(document.querySelector(`${s} [data-tab="${i}"] [data-name]`)!).backgroundColor !== 'rgba(0, 0, 0, 0)', [id, S], { timeout: 2000 }).then(() => true, () => false);
    check(`${host}: a second click: the switcher opens and the chip shows`, menu && second, { menu, second });
    await page.keyboard.press('Escape');
    // leave and come back: the chip on hover
    await page.mouse.move(2, 790); await frames();
    a = await activate(); id = a.id; p = a.p;
    await page.mouse.move(2, 790); await frames();
    await page.mouse.move(p.x, p.y);
    const back = await page.waitForFunction(([i, s]: string[]) => getComputedStyle(document.querySelector(`${s} [data-tab="${i}"] [data-name]`)!).backgroundColor !== 'rgba(0, 0, 0, 0)', [id, S], { timeout: 2000 }).then(() => true, () => false);
    check(`${host}: out of the tab and back: the chip shows on hover`, back);
    await page.close();
  }
});

group('home keeps its one-line width in two lines (tall and narrow), its icon centred, the pill radius and the strip inset; both hosts', async () => {
  const geo: Record<string, any> = {};
  for (const [k, q] of [['one', 'fresh&scenario=paper'], ['two', 'fresh&scenario=paper'], ['bar', 'fresh&single&bar=1']]) {
    const page = await fresh({ query: q });
    if (k === 'one') await oneLine(page);
    geo[k] = await page.evaluate(() => { const h = document.querySelector('.wb-strip:not([hidden]) .wb-home-btn')!, r = h.getBoundingClientRect(), s = h.closest('.wb-strip')!.getBoundingClientRect(), i = h.querySelector('svg')!.getBoundingClientRect(), t = document.querySelector('.wb-strip:not([hidden]) .wb-tab')!.getBoundingClientRect();
      return { w: r.width, h: r.height, tabH: t.height, top: r.top - s.top, tabTop: t.top - s.top, icon: [(i.left + i.right) / 2 - (r.left + r.right) / 2, (i.top + i.bottom) / 2 - (r.top + r.bottom) / 2].map((v) => +v.toFixed(2)), rad: getComputedStyle(h).borderTopLeftRadius, tabRad: getComputedStyle(document.querySelector('.wb-strip:not([hidden]) .wb-tab')!).borderTopLeftRadius }; });
    await page.close();
  }
  check('the home button: the same width in one line, two lines and the bar (32 px)', geo.one.w === 32 && geo.two.w === 32 && geo.bar.w === 32, geo);
  check('two lines: home as tall as the pills, at their inset; its icon centred; the pills\' radius', geo.two.h === geo.two.tabH && geo.two.top === geo.two.tabTop && geo.two.icon.every((v: number) => Math.abs(v) <= 0.5) && geo.two.rad === geo.two.tabRad, geo.two);
});

// ── home: one place in every host: the gap from the leading edge (the strip's or the bar's, or the side toggle's
//    right edge), the gap to the first tab, centred in its strip; the painted icon, in the bar and a row, one line and two ──
group('home: its painted icon at the same offset from the leading edge (the edge, or the side toggle) and centred alike, in the top bar and a row, one line and two lines, the column open or hidden', async () => {
  const got: Record<string, any> = {};
  for (const host of ['bar', 'one', 'two']) for (const hidden of [false, true]) {
    const page = await fresh({ sides: true, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&scenario=paper' });
    await page.evaluate(() => document.fonts.ready);
    if (hidden) await page.evaluate(() => (window as any).demo.wb.toggleSide('left'));
    if (host === 'one') await oneLine(page);
    await settled(page);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await page.mouse.move(640, 790);
    const g = await page.evaluate(() => {
      const h = document.querySelector('.wb-strip:not([hidden]) .wb-home-btn')!, s = h.closest('.wb-strip')!;
      const box = (s.classList.contains('wb-strip--inbar') ? document.querySelector('.wb-bar')! : s).getBoundingClientRect(), r = h.getBoundingClientRect();
      const tg = [...(s.classList.contains('wb-strip--inbar') ? document.querySelector('.wb-bar')! : s).querySelectorAll('.wb-side-toggle, .wb-mark-part[data-on="true"] > .wb-mark-in > *')].map((x) => x.getBoundingClientRect()).filter((x) => x.width > 0 && x.right <= r.left);     // what is before it: the toggle, the bar's mark
      const t = s.querySelector('.wb-tab')!.getBoundingClientRect(), gap = parseFloat(getComputedStyle(s).getPropertyValue('--wb-gap'));
      return { lead: tg.length ? Math.max(...tg.map((x) => x.right)) : box.left, toggle: tg.length > 0, cy: (box.top + box.bottom) / 2, r: { x: r.x, y: r.y, w: r.width, h: r.height }, toTab: +(t.left - r.right).toFixed(2), gap };
    });
    const clip = { x: Math.round(g.r.x), y: Math.round(g.r.y), width: Math.round(g.r.w), height: Math.round(g.r.h) };
    const png = decodePng(await page.screenshot({ clip }));
    const bg = luma(png.px, 0); let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) if (Math.abs(luma(png.px, (y * png.w + x) * 4) - bg) > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    got[`${host}${hidden ? ', column hidden' : ''}`] = { toggle: g.toggle, w: g.r.w, toTab: g.toTab, gap: g.gap, dx: +(clip.x + (x0 + x1 + 1) / 2 - g.lead).toFixed(2), dy: +(clip.y + (y0 + y1 + 1) / 2 - g.cy).toFixed(2) };
    await page.close();
  }
  const v = Object.values(got), ref = got.bar;
  check('every case: home 32 px wide, the gap (--wb-gap) to the first tab; hidden column: after its toggle', v.every((x: any) => x.w === 32 && Math.abs(x.toTab - x.gap) <= 0.5) && got['bar, column hidden'].toggle && got['one, column hidden'].toggle && got['two, column hidden'].toggle, got);
  check('the painted icon: the same offset from the leading edge (or the toggle) in the bar and a row, one line and two (≤ 0.5 px)', v.every((x: any) => Math.abs(x.dx - ref.dx) <= 0.5), got);
  check('the painted icon: centred in its strip alike in the bar and a row, one line and two (≤ 0.5 px)', v.every((x: any) => Math.abs(x.dy - ref.dy) <= 0.5), got);
});

// ── home shown: home takes the focused-active look, the group's active tab the unfocused-active one ──
group('home shown: home focused-active, the active tab unfocused-active; another group focused: home unfocused-active; home hidden: back; both hosts, light and dark', async () => {
  for (const host of ['strip', 'bar']) for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, w: 1280, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&scenario=paper' });
    await page.evaluate(() => document.fonts.ready);
    // the looks, as the tokens resolve in each element (its own ink: the unfocused token mixes currentColor)
    const look = (sel: string) => page.evaluate(async (s: string) => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
      const e = document.querySelector(s); if (!e) return null;
      const probe = (v: string) => { const p = document.createElement('span'); p.style.background = v; e.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
      const bg = getComputedStyle(e).backgroundColor;
      return bg === probe('var(--rfed-tab-active-bg)') ? 'on' : bg === probe('var(--rfed-tab-unfocused-active-bg)') ? 'idle' : bg;
    }, sel);
    const F = '.wb-strip--focused', HOME = '.wb-home-btn', TAB = '.wb-tab.wb-tab--on';
    await page.mouse.move(2, 790);
    check(`${host}, ${theme}: at rest: the focused group's active tab focused-active`, await look(`${F} ${TAB}`) === 'on', await look(`${F} ${TAB}`));
    const gid = await page.evaluate((s: string) => document.querySelector(s)!.getAttribute('data-strip-group'), F);
    const strip = `.wb-strip[data-strip-group="${gid}"]`;
    await page.click(`${strip} ${HOME}`);
    await page.waitForSelector(`${strip}.wb-strip--home.wb-strip--focused`);
    await page.mouse.move(2, 790);
    const shown = { home: await look(`${strip} ${HOME}`), tab: await look(`${strip} ${TAB}`) };
    check(`${host}, ${theme}: home shown in the focused group: home focused-active, the active tab unfocused-active`, shown.home === 'on' && shown.tab === 'idle', shown);
    if (host === 'strip') {
      await page.click(`.wb-strip:not(${strip}) ${TAB}`);
      await page.waitForSelector(`${strip}.wb-strip--home:not(.wb-strip--focused)`);
      await page.mouse.move(2, 790);
      const away = { home: await look(`${strip} ${HOME}`), tab: await look(`${strip} ${TAB}`), other: await look(`${F} ${TAB}`) };
      check(`${host}, ${theme}: another group focused: home unfocused-active (the tab too); the other group's tab focused-active`, away.home === 'idle' && away.tab === 'idle' && away.other === 'on', away);
    }
    await page.click(`${strip} ${HOME}`);
    await page.waitForSelector(`${strip}.wb-strip--focused:not(.wb-strip--home)`);
    await page.mouse.move(2, 790);
    const back = { tab: await look(`${strip} ${TAB}`), pressed: await page.getAttribute(`${strip} ${HOME}`, 'aria-pressed') };
    check(`${host}, ${theme}: home hidden: the active tab focused-active again`, back.tab === 'on' && back.pressed === 'false', back);
    await page.close();
  }
});

group('switcher rows: the new-tab button only on the hovered or keyboard-focused row, never because a row is current; its room kept', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, query: 'fresh&single&bar=1' });
    await idle(page);
    await page.click('.wb-tab.wb-tab--on [data-name]');
    await page.waitForSelector('[role="grid"] [role="row"] .wb-row-btn');
    await page.mouse.move(2, 790);
    const shown = () => page.evaluate(async () => { await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
      await (window as any).demo.wb.idle();
      return [...document.querySelectorAll('[role="grid"] [role="row"]')].map((r) => ({ id: r.getAttribute('data-row'), on: r.classList.contains('is-active'),
        vis: +getComputedStyle(r.querySelector('.wb-row-btn')!).opacity > 0.5, w: r.querySelector('.wb-row-btn')!.getBoundingClientRect().width })); });
    const rest = await shown();
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {     // no hover (touch; headless Firefox says so): every button shows
      check(`${theme}: no hover in this browser: every row shows its button`, rest.every((r: any) => r.vis), rest);
      await page.close(); continue;
    }
    check(`${theme}: menu open, no hover: no row shows its button (the current row neither); every button keeps its room`, rest.length > 1 && rest.some((r: any) => r.on) && rest.every((r: any) => !r.vis && r.w > 0), rest);
    const other = rest.findIndex((r: any) => !r.on);
    const box = await page.locator('[role="grid"] [role="row"]').nth(other).boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + box!.height / 2);
    const hov = await shown();
    check(`${theme}: hovering a row shows only its button`, hov.filter((r: any) => r.vis).map((r: any) => r.id).join() === rest[other].id, hov);
    await page.mouse.move(2, 790);
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.closest('[role="row"]')?.getAttribute('data-row'));
    const kb = await shown();
    check(`${theme}: the keyboard-focused row (an arrow key) shows its button, only it`, !!focused && kb.filter((r: any) => r.vis).map((r: any) => r.id).join() === focused, { focused, kb });
    await page.close();
  }
});

group('splitter = one more gap: edge-pill, pill-pill and pill-line on both sides equal; the line centred on the boundary; 2 and 3 groups, stacked, DPR 1 and 2', async () => {
  for (const dpr of [1, 2]) for (const n of [2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 1283, height: 700 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto('http://wb.test/?fresh&sides=0&bar=0&theme=light');
    await page.waitForSelector('.wb-tab');
    if (n === 3) await page.evaluate(() => { const w = (window as any).demo.wb; w.split(w.current.peek().tab.id, 'right', undefined, { copy: false }); });
    await page.waitForFunction((n: number) => document.querySelectorAll('.wb-sep[aria-orientation="vertical"]').length === n - 1, n);
    const settle = () => page.evaluate(async () => { await (window as any).demo.wb.idle(); await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))); });
    await settle();
    // in the page: a separator's drawn line, [a, b] along its axis
    const LINE = '(s) => { const r = s.getBoundingClientRect(), c = getComputedStyle(s, "::before"); return s.getAttribute("aria-orientation") === "vertical" ? { a: r.left + parseFloat(c.left), b: r.left + parseFloat(c.left) + parseFloat(c.width) } : { a: r.top + parseFloat(c.top), b: r.top + parseFloat(c.top) + parseFloat(c.height) }; }';
    const row = await page.evaluate((LINE: string) => {
      const lineOf = (0, eval)(LINE);
      const gs = [...document.querySelectorAll('.wb-group')].filter((g) => !g.closest('.wb-park')).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const seps = [...document.querySelectorAll('.wb-sep[aria-orientation="vertical"]')].map(lineOf).sort((a: any, b: any) => a.a - b.a);
      const root = document.querySelector('.wb-root')!, rr = root.getBoundingClientRect(), rcs = getComputedStyle(root);     // the window border's inner edges
      const L0 = rr.left + parseFloat(rcs.borderLeftWidth), R0 = rr.right - parseFloat(rcs.borderRightWidth);
      const xs: any[] = [{ a: L0, b: L0 }];
      gs.forEach((g, i) => { const ps = [...g.querySelectorAll('.wb-strip .wb-tab, .wb-strip .wb-home-btn')].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0).sort((p, q) => p.left - q.left);
        for (const r of ps) xs.push({ a: r.left, b: r.right }); if (seps[i]) xs.push(seps[i]); });
      xs.push({ a: R0, b: R0 });
      return { gaps: xs.slice(1).map((x, i) => +(x.a - xs[i].b).toFixed(2)), centres: seps.map((s: any, i: number) => +(((s.a + s.b) / 2) - gs[i].getBoundingClientRect().right).toFixed(2)) };
    }, LINE);
    const g0 = row.gaps[0];
    check(`DPR ${dpr}, ${n} groups: every horizontal gap equal (±0.5)`, row.gaps.length > 4 && row.gaps.every((g: number) => Math.abs(g - g0) <= 0.5), row);
    check(`DPR ${dpr}, ${n} groups: each line centred on its boundary (±0.5)`, row.centres.length === n - 1 && row.centres.every((c: number) => Math.abs(c) <= 0.5 + 1e-6), row.centres);
    if (n === 2) {    // stacked: the line centred on the boundary, the lower pills as far below it as the upper pills below their top
      await page.evaluate(() => { const w = (window as any).demo.wb; w.split(w.current.peek().tab.id, 'bottom', undefined, { copy: false }); });
      await page.waitForSelector('.wb-sep[aria-orientation="horizontal"]');
      await settle();
      const v = await page.evaluate((LINE: string) => {
        const lineOf = (0, eval)(LINE), l = lineOf(document.querySelector('.wb-sep[aria-orientation="horizontal"]'));
        const gs = [...document.querySelectorAll('.wb-group')].filter((g) => !g.closest('.wb-park'));
        const low = gs.find((g) => g.getAttribute('data-top') === 'false')!, lr = low.getBoundingClientRect();
        const up = gs.find((g) => g.getAttribute('data-top') === 'true' && Math.abs(g.getBoundingClientRect().bottom - lr.top) < 1)!;
        // the lower strip's own inset (its form may differ from the upper one's: d decides stacked groups alone)
        const st = low.querySelector('.wb-strip')!.getBoundingClientRect(), pt = low.querySelector('.wb-tab')!.getBoundingClientRect();
        const top = (st.height - pt.height) / 2; void up;
        return { centre: +(((l.a + l.b) / 2) - lr.top).toFixed(2), below: +(low.querySelector('.wb-tab')!.getBoundingClientRect().top - l.b).toFixed(2), top: +top.toFixed(2) };
      }, LINE);
      check(`DPR ${dpr}, stacked: the line centred on the boundary (±0.5); line → the lower pills = its strip's inset (±0.5)`, Math.abs(v.centre) <= 0.5 + 1e-6 && Math.abs(v.below - v.top) <= 0.5, v);
    }
    await ctx.close();
  }
});

// ── the gaps as PAINTED: the window border, the strip ends beside every neighbour, between the pills ──
group('painted gaps: the edge inset (macOS in a dark theme: 1 px left and right in the ground colour under the rim; elsewhere none; a live theme switch follows), never a line; edge → pill, pill → pill, pill → splitter or column line all one gap; every theme, DPR 1 and 2', async () => {
  const MAG = [255, 0, 255], same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  for (const os of ['mac', 'other']) for (const dpr of [1, 2]) for (const theme of ['light', 'dark', 'sepia', 'hc']) for (const sides of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1281, height: 500 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.addInitScript((mac: boolean) => { Object.defineProperty(navigator, 'platform', { get: () => mac ? 'MacIntel' : 'Linux x86_64' }); Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: mac ? 'macOS' : 'Linux' }) }); }, os === 'mac');
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&bar=0&theme=${theme}${sides ? '' : '&sides=0'}`);
    await page.waitForSelector('.wb-strip .wb-tab');
    await page.evaluate(() => document.fonts.ready);
    const id = `${os}, DPR ${dpr}, ${theme}, ${sides ? 'both side columns open' : 'no side columns'}`, E = os === 'mac' && theme === 'dark' ? 1 : 0;     // the rim shows on a dark macOS window only
    const geo = await page.evaluate(() => {
      const root = document.querySelector('.wb-root')!, r = root.getBoundingClientRect(), cs = getComputedStyle(root), strip = document.querySelector('.wb-strip')!.getBoundingClientRect();
      return { l: r.left, r: r.right, b: r.bottom, bw: [cs.borderLeftWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderTopWidth].map(parseFloat), y: strip.top + strip.height / 2, mid: r.top + 200,
        sides: [...document.querySelectorAll('aside[data-side]')].filter((a) => a.getBoundingClientRect().width > 0).length };
    });
    check(`${id}: the edge inset: ${E} px left and right, none at the bottom and the top`, same(geo.bw, [E, E, 0, 0]) && (!sides || geo.sides === 2), geo);
    const W = Math.round(geo.r * dpr), X0 = Math.round(geo.l * dpr), lo = X0 + E * dpr, hi = W - E * dpr;     // the effective edges: inside the rim
    const png = decodePng(await page.screenshot());
    const px = (x: number, y: number) => { const i = (y * png.w + x) * 4; return [png.px[i], png.px[i + 1], png.px[i + 2]]; };
    // the border as painted: the outermost device pixel(s) differ from the page next to them, on every side, at mid height
    const ym = Math.round(geo.mid * dpr), differs = (a: number[], b: number[]) => a.some((v, i) => Math.abs(v - b[i]) > 2);
    const bL = px(X0, ym), bR = px(W - 1, ym), inL = px(X0 + dpr, ym), inR = px(W - 1 - dpr, ym), bB = px(X0 + 300 * dpr, Math.round(geo.b * dpr) - 1), inB = px(X0 + 300 * dpr, Math.round(geo.b * dpr) - 1 - dpr);
    check(`${id}: no line at the left, right and bottom edges (the edge pixels the page's colour)`, !differs(bL, inL) && !differs(bR, inR) && !differs(bB, inB), { bL, inL, bR, inR, bB, inB });
    // the strip row: paint every pill and home solid magenta (their content hidden), then scan
    await page.addStyleTag({ content: '.wb-strip :is(.wb-tab, .wb-home-btn) { background: #f0f !important; box-shadow: none !important; transition: none !important; } .wb-strip :is(.wb-tab, .wb-home-btn) * { visibility: hidden !important; } .wb-strip-actions { display: none !important; }' });
    await page.mouse.move(300, 495);     // off every splitter (a hovered one is drawn thick)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const row = decodePng(await page.screenshot());
    const y = Math.round(geo.y * dpr);
    const at = (x: number) => { const i = (y * row.w + x) * 4; return [row.px[i], row.px[i + 1], row.px[i + 2]]; };
    // the magenta share of a pixel over a ground g (0: the ground, 1: a pill), or null when it is neither (a line)
    const share = (p: number[], g: number[]) => { const d = MAG.map((m, i) => m - g[i]), n = d.reduce((a, v) => a + v * v, 0), t = d.reduce((a, v, i) => a + v * (p[i] - g[i]), 0) / n;
      const off = p.some((v, i) => Math.abs(g[i] + t * d[i] - v) > 3); return off ? null : Math.max(0, Math.min(1, t)); };
    const runs: { a: number; b: number }[] = [];
    for (let x = X0; x < W; x++) { const isM = at(x)[0] > 200 && at(x)[1] < 80 && at(x)[2] > 200;
      if (isM) { if (runs.length && runs[runs.length - 1].b === x - 1) runs[runs.length - 1].b = x; else runs.push({ a: x, b: x }); } }
    // a gap: from a pill's solid edge outward, the ground's share summed until a pixel off the ground-magenta line (a line, the border) or the next pill
    const gapFrom = (x: number, dir: number) => { const g = at(x + dir * 3 < lo || x + dir * 3 >= hi ? x + dir : x + dir * 3); let s = 0, k = x + dir;
      for (; k >= lo && k < hi; k += dir) { const p = at(k); if (p[0] > 200 && p[1] < 80 && p[2] > 200) break; const t = share(p, g); if (t === null) break; s += 1 - t; }
      return { gap: +(s / dpr).toFixed(2), stop: k }; };
    const gaps = runs.flatMap((r, i) => [gapFrom(r.a, -1), ...(i === runs.length - 1 ? [gapFrom(r.b, 1)] : [])]).map((g) => g.gap);
    const g0 = gaps[1];
    check(`${id}: every painted gap in the strip row equal: the border or the column line → home, home → tab, tab → tab, tab → the splitter line → home, the last tab → the border or line (±0.5 device px)`,
      runs.length >= 5 && gaps.every((g) => Math.abs(g - g0) <= 0.5 / dpr + 0.01) && Math.abs(g0 - 6) <= 0.5, { g0, gaps, runs: runs.length });
    if (os === 'mac' && !sides && dpr === 1) {      // a live switch: the inset follows the theme's dark flag
      const flip = await page.evaluate(async (th: string) => { const T = (globalThis as any).demoThemes, w = () => parseFloat(getComputedStyle(document.querySelector('.wb-root')!).borderLeftWidth);
        const out: number[] = []; for (const t of [th === 'dark' ? 'light' : 'dark', th]) { T.setTheme(t); await new Promise((r) => requestAnimationFrame(r)); out.push(w()); } return out; }, theme);
      check(`${id}: a live theme switch: the inset follows (dark 1, else 0)`, same(flip, theme === 'dark' ? [0, 1] : [1, 0]), flip);
    }
    if (sides) {      // no line where a side column meets the window
      const o = await page.evaluate(() => [...document.querySelectorAll('aside[data-side]')].map((a) => { const r = a.getBoundingClientRect(); return { l: r.left, r: r.right }; }));
      const ys = Math.round((geo.mid + 40) * dpr), atY = (x: number) => { const i = (ys * row.w + x) * 4; return [row.px[i], row.px[i + 1], row.px[i + 2]]; };
      // the 4 CSS px inside the border: one ground, no line
      const lines = (from: number, dir: number) => { let n = 0; for (let k = 1; k < 4 * dpr; k++) if (differs(atY(from + dir * k), atY(from))) n++; return n; };
      check(`${id}: a side column's outer edge: no line (one ground over the 4 px inside the window edge)`, lines(X0, 1) === 0 && lines(W - 1, -1) === 0 && o.length === 2, o);
    }
    await ctx.close();
  }
});

group('switcher rows: one hover target, nested as a tab and its chips (the row ground over the full width, the button its own on top); keyboard the same', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, query: 'fresh&single&bar=1' });
    await idle(page);
    await page.click('.wb-tab.wb-tab--on [data-name]');
    await page.waitForSelector('[role="grid"] [role="row"]:not(.is-active) .wb-row-btn');
    const row = page.locator('[role="grid"] [role="row"]:not(.is-active)').first();
    const read = () => row.evaluate(async (r: Element) => {
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));     // the hover applied: its transitions started
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
      // the tokens, resolved in the row (the same currentColor): the tab's hover ground, and the chip's on top of it
      const probe = (bg: string) => { const d = document.createElement('div'); d.style.background = bg; r.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
      const btn = r.querySelector('.wb-row-btn')!, main = r.querySelector('.wb-menu-item')!, rr = r.getBoundingClientRect(), br = btn.getBoundingClientRect();
      return { row: getComputedStyle(r).backgroundColor, main: getComputedStyle(main).backgroundColor, btn: getComputedStyle(btn).backgroundColor,
        tabHover: probe('var(--rfed-tab-hover-bg)'), chipHover: probe('var(--rfed-hover)'), covers: br.left >= rr.left && br.right <= rr.right && br.top >= rr.top && br.bottom <= rr.bottom,
        inset: +(rr.right - br.right).toFixed(2), radius: [getComputedStyle(r).borderTopLeftRadius, getComputedStyle(btn).borderTopLeftRadius] };
    });
    const clear = 'rgba(0, 0, 0, 0)';
    const tb = await row.locator('.wb-mi-label').boundingBox();
    await page.mouse.move(tb!.x + 4, tb!.y + tb!.height / 2);
    const a = await read();
    check(`${theme}: hovering the text: the row ground (the tab hover token) over the full row, the button inside it, not highlighted`, a.row === a.tabHover && a.row !== clear && a.main === clear && a.btn === clear && a.covers, a);
    const bb = await row.locator('.wb-row-btn').boundingBox();
    await page.mouse.move(bb!.x + bb!.width / 2, bb!.y + bb!.height / 2);
    const b = await read();
    check(`${theme}: hovering the button: the row ground kept, the button's own (the chip hover token) added; flush with the row's end, its radius (the row's ground: the same height)`, b.row === b.tabHover && b.btn === b.chipHover && b.inset === 0 && b.radius[0] === b.radius[1], b);
    await page.mouse.move(2, 790);
    await page.keyboard.press('ArrowDown');
    const k = await page.evaluate(async () => { await (window as any).demo.wb.idle(); const r = document.activeElement!.closest('[role="row"]')!; return { row: getComputedStyle(r).backgroundColor, btn: getComputedStyle(r.querySelector('.wb-row-btn')!).backgroundColor }; });
    await page.keyboard.press('ArrowRight');
    const k2 = await page.evaluate(async () => { await (window as any).demo.wb.idle(); const e = document.activeElement!; return { on: e.classList.contains('wb-row-btn'), row: getComputedStyle(e.closest('[role="row"]')!).backgroundColor, btn: getComputedStyle(e).backgroundColor }; });
    check(`${theme}: keyboard: the focused row shows the row ground; → to its button adds the button's`, k.row !== clear && k.btn === clear && k2.on && k2.row !== clear && k2.btn !== clear, { k, k2 });
    await page.close();
  }
});

group('side column edge: one line over the full height (at the top, mid-bar, the bottom), never under the bar; the hit area above it; both sides, light and dark, after closing and opening', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, query: 'fresh&bar=1', sides: true });
    await idle(page);
    const run = async (tag: string) => {
      const geo = await page.evaluate(() => [...document.querySelectorAll('.wb-side-sep')].map((sp) => {
        const r = sp.getBoundingClientRect(), c = getComputedStyle(sp, '::before'), x = r.left + parseFloat(c.left), bar = document.querySelector('.wb-bar')!.getBoundingClientRect();
        const side = sp.classList.contains('wb-side-sep--left') ? 'left' : 'right';
        // the hit area wins over the bar at its every x, at the top and the bar's middle
        const hits = [2, bar.top + bar.height / 2].flatMap((y) => [r.left + 0.5, r.left + r.width / 2, r.right - 0.5].map((hx) => document.elementFromPoint(hx, y) === sp));
        return { side, x, inner: side === 'left' ? x + 1 : x - 1, outer: side === 'left' ? x - 2 : x + 2, mid: bar.top + bar.height / 2, h: innerHeight, hits, shadow: getComputedStyle(sp.closest('.wb-side')!).boxShadow };
      }));
      for (const g of geo) {
        const png = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: g.h } }));
        const at = (x: number, y: number) => { const i = (Math.round(y) * png.w + Math.floor(x)) * 4; return [png.px[i], png.px[i + 1], png.px[i + 2]].join(); };
        const ys = [2, g.mid, g.h / 2, g.h - 3];
        const line = ys.map((y) => at(g.x, y)), col = ys.map((y) => at(g.outer, y));
        check(`${theme} ${tag} ${g.side}: the line's colour at y = 2, the bar's middle, the middle and the bottom, distinct from the column beside it (the middle may cross a panel row)`,
          line[0] === line[3] && line[1] === line[3] && line.every((c, i) => c !== col[i]), { line, col });
        check(`${theme} ${tag} ${g.side}: the splitter's hit area is above the bar; one line (the column draws none)`, g.hits.every(Boolean) && g.shadow === 'none', g);
      }
      return geo.length;
    };
    check(`${theme}: both columns open`, (await run('open')) === 2);
    for (const side of ['left', 'right']) {
      await page.evaluate((s: string) => (window as any).demo.wb.toggleSide(s), side);
      const sliding = await page.waitForFunction(() => { const e = document.querySelector('.wb-side--sliding'); return e ? getComputedStyle(e).boxShadow : false; }, null, { timeout: 2000 }).then((h: any) => h.jsonValue(), () => null);
      check(`${theme}: ${side} closing: while it slides, the column draws the line itself`, sliding == null || /inset/.test(sliding), sliding);
      await page.waitForFunction(() => !document.querySelector('.wb-side--sliding'));
      await page.evaluate((s: string) => (window as any).demo.wb.toggleSide(s), side);
      await page.waitForFunction(() => !document.querySelector('.wb-side--sliding') && document.querySelectorAll('.wb-side-sep').length === 2);
      await idle(page);
    }
    await run('reopened');
    await page.close();
  }
});

// ── one line: the name matters more than the section: the section yields first, down to its number and 3
//    characters and "…" (--wb-sec-min); then both shrink in proportion, down to their floors (the name's 3 characters
//    and "…", the section's number and "…") ──
group('one line: the section yields first (to its number, 3 characters and "…"), then both shrink; the name whole while the section is above its minimum; the number never cut; floors; active and inactive; the bar too', async () => {
  for (const [host, which] of [['row', 'active'], ['row', 'inactive'], ['bar', 'active']] as const) {
    const page = await fresh({ query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&scenario=paper' });
    if (host === 'bar') await page.evaluate(() => { const W = (window as any).demo.wb; W.open({ view: 'document', state: { doc: 'thesis', section: 'Chapter 2 Minors and their models' } }, { focus: false }); });
    else {
      await oneLine(page);
      await page.evaluate((which: string) => { const W = (window as any).demo.wb, M = (window as any).demo.M, L = W.layout.peek();
        const t = M.groups(L).flatMap((g: any) => g.tabs).find((x: any) => x.state?.doc === 'thesis');
        if (which === 'active') W.activate(t.id, { focus: 'tab' }); else { const g = M.groups(L).find((g: any) => g.tabs.some((x: any) => x.id === t.id)); W.activate(g.tabs.find((x: any) => x.id !== t.id).id, { focus: 'tab' }); } }, which);
    }
    await idle(page);
    await page.mouse.move(1, 790);
    const r = await page.evaluate(() => {
      const W = (window as any).demo.wb, M = (window as any).demo.M;
      const id = M.groups(W.layout.peek()).flatMap((g: any) => g.tabs).find((x: any) => x.state?.doc === 'thesis').id;
      const tab = document.querySelector(`[data-tab="${id}"]`) as HTMLElement, line = tab.querySelector('.wb-tab-line') as HTMLElement;
      const name = line.querySelector('.wb-tab-label') as HTMLElement, sec = line.querySelector('.wb-tab-sec') as HTMLElement;
      const nameText = name.querySelector('.wb-tab-name') as HTMLElement, secText = sec.querySelector('.wb-tab-sec-text') as HTMLElement, num = sec.querySelector('.wb-tab-num') as HTMLElement;
      const cs = getComputedStyle(sec), ns = getComputedStyle(name);     // the minimum is the section's basis, the floors the min-widths (fitTabs' measures with the chip's padding)
      line.style.flex = '0 0 auto';
      const out: any[] = [];
      for (let w = 600; w >= 20; w -= 1) {
        line.style.width = `${w}px`;
        out.push({ w, n: +name.getBoundingClientRect().width.toFixed(2), s: +sec.getBoundingClientRect().width.toFixed(2),
          nCut: nameText.scrollWidth > nameText.clientWidth + 0.5, sCut: secText.scrollWidth > secText.clientWidth + 0.5,
          numCut: num.scrollWidth > num.getBoundingClientRect().width + 0.5 || num.getBoundingClientRect().right > sec.getBoundingClientRect().right + 0.5 });
      }
      return { out, on: tab.classList.contains('wb-tab--on'), num: num.textContent, text: secText.textContent, secMin: parseFloat(cs.flexBasis), secFloor: parseFloat(cs.minWidth), nameMin: parseFloat(ns.minWidth) };
    });
    const o = r.out, N = o[0].n, S = o[0].s;
    const whole = o.filter((x: any) => !x.nCut && !x.sCut), secFirst = o.filter((x: any) => x.sCut && !x.nCut), both = o.filter((x: any) => x.nCut);
    check(`${host}, ${which} (${r.on ? 'active' : 'inactive'}): the chapter's number "${r.num}" and text "${r.text}"; wide: both whole`, r.num === '2' && r.text === 'Minors and their models' && whole.length > 0 && r.on === (which === 'active'), { num: r.num, text: r.text, on: r.on });
    check(`${host}, ${which}: the section truncates first: while it is above its minimum (${r.secMin.toFixed(1)} px) the name is whole (${N} px)`, o.every((x: any) => x.s <= r.secMin + 0.5 || (!x.nCut && Math.abs(x.n - N) < 0.5)) && secFirst.length > 20, { secFirst: secFirst.length, bad: o.filter((x: any) => x.s > r.secMin + 0.5 && x.nCut).slice(0, 3) });
    check(`${host}, ${which}: the name truncates only once the section is at its minimum or below`, both.length > 0 && both.every((x: any) => x.s <= r.secMin + 0.5), both.slice(0, 3));
    const shrink = both.filter((x: any) => x.n > r.nameMin + 0.5 && x.s > r.secFloor + 0.5);
    check(`${host}, ${which}: then both shrink together, in proportion to their widths (the section ${r.secMin.toFixed(1)} px at the start, the name ${N} px)`, shrink.length > 5 && shrink.every((x: any, i: number) => i === 0 || (x.n <= shrink[i - 1].n + 0.01 && x.s <= shrink[i - 1].s + 0.01))
      && shrink.slice(1).every((x: any) => Math.abs((N - x.n) / N - (r.secMin - x.s) / r.secMin) < 0.06), shrink.filter((_: any, i: number) => i % 10 === 0).slice(0, 6));
    check(`${host}, ${which}: every width monotonic, the number never cut, the floors kept (name ${r.nameMin.toFixed(1)}, section ${r.secFloor.toFixed(1)} px)`, o.every((x: any, i: number) => i === 0 || (x.n <= o[i - 1].n + 0.01 && x.s <= o[i - 1].s + 0.01)) && o.every((x: any) => !x.numCut)
      && o.every((x: any) => x.n >= r.nameMin - 0.5 && x.s >= r.secFloor - 0.5), o.slice(-2));
    void S;
    await page.close();
  }
});

// ── a chapter (and a part) in the crumb as a section: its number and text, the kind in its names, the contents menu ──
group('a chapter crumb: the number and text as a section\'s; "Go to chapter" and its tooltip; the menu: Contents, parts, chapters and sections indented by level, the current one checked; going to a section there; one line and two lines', async () => {
  for (const form of ['one', 'two']) {
    const page = await fresh({ query: 'fresh&scenario=paper' });
    if (form === 'one') await oneLine(page);
    const id = await page.evaluate(() => { const W = (window as any).demo.wb, M = (window as any).demo.M; const t = M.groups(W.layout.peek()).flatMap((g: any) => g.tabs).find((x: any) => x.state?.doc === 'thesis'); W.activate(t.id, { focus: 'tab' }); return t.id; });
    await idle(page);
    if (form === 'two') await page.waitForFunction((id: string) => document.querySelector(`[data-tab="${id}"]`)?.closest('.wb-group')?.getAttribute('data-form') === 'two', id).catch(() => {});
    const r = await page.evaluate((id: string) => {
      const t = document.querySelector(`[data-tab="${id}"]`)!, chip = t.querySelector('[data-sub]')!;
      return { form: t.closest('.wb-group')!.getAttribute('data-form'), name: chip.getAttribute('aria-label'), tip: t.getAttribute('title'), tab: t.querySelector('[role="tab"]')!.getAttribute('aria-label'),
        num: t.querySelector('.wb-tab-num')?.textContent ?? null, text: (t.querySelector('.wb-tab-sec-text, .wb-tab-sub-label')!.textContent ?? '').trim() };
    }, id);
    check(`${r.form}: the chapter chip: "Go to chapter: 2  Minors and their models"; the tab "Graph minors in practice, 2  Minors…"; the tooltip names the chapter`, r.form === form && r.name === 'Go to chapter: 2  Minors and their models' && r.tab === 'Graph minors in practice, 2  Minors and their models' && /Chapter 2: Minors and their models/.test(r.tip ?? '')
      && (form === 'two' ? r.text === '2  Minors and their models' : r.num === '2' && r.text === 'Minors and their models'), r);
    await page.evaluate(() => (window as any).demo.wb.run('sectionMenu'));
    await page.waitForSelector('.wb-pop [data-row]');
    const m = await page.evaluate(() => { const pop = document.querySelector('.wb-pop')!;
      return { heading: pop.querySelector('.wb-menu-label')?.textContent?.trim() ?? '',
        rows: [...pop.querySelectorAll('[data-row]')].map((row) => ({ num: row.querySelector('.wb-row-num')?.textContent ?? '', label: row.querySelector('.wb-mi-label')!.textContent, depth: +(row.getAttribute('data-ts-depth') ?? 0), on: row.classList.contains('is-active'), bold: +getComputedStyle(row.querySelector('.wb-mi-label')!).fontWeight >= 600 })), leads: pop.querySelectorAll('.wb-mi-lead').length }; });
    const depth = (n: string) => m.rows.find((x: any) => x.num === n)?.depth;
    check(`${form}: the menu is the contents: Part I, Chapter 1, 1.1 … Appendix A; parts 0, chapters 1, sections 2; Chapter 2 checked`, /Contents/.test(m.heading) && m.rows.length === 11 && depth('I') === 0 && depth('II') === 0 && depth('1') === 1 && depth('3') === 1 && depth('A') === 1 && depth('2.1') === 2
      && m.rows.filter((x: any) => x.on).map((x: any) => x.num).join() === '2', m);
    check(`${form}: the current chapter in bold, no check slot (a title needs the room)`, m.leads === 0 && m.rows.every((x: any) => x.bold === x.on), m);
    await page.locator('.wb-pop [data-row="sec-2.1 Definitions"] button').first().click();
    await idle(page);
    const after = await page.evaluate((id: string) => document.querySelector(`[data-tab="${id}"] [data-sub]`)!.getAttribute('aria-label'), id);
    check(`${form}: a section chosen there: the chip "Go to section: 2.1  Definitions"`, after === 'Go to section: 2.1  Definitions', after);
    await page.close();
  }
});
