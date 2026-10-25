// The workbench's browser suite, area "layout": layout: one tab, the boot, home, tab and content drags, resizing, lifecycle, persistence, the context menu, performance. Run by tests/e2e.ts (--area layout).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── one tab: the integrated look ──
group('one tab: no strip, the document fills the area with its breadcrumbs', async () => {
  const page = await fresh({ query: 'fresh&single' });
  const geo = () => page.evaluate(() => {
    const strip = document.querySelector('.wb-strip') as HTMLElement, p = document.querySelector('.wb-panel:not(.wb-panel--hidden)') as HTMLElement;
    const root = document.querySelector('.wb-root')!.getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { strip: getComputedStyle(strip).display, role: p.getAttribute('role'), name: p.getAttribute('aria-label'), tablists: document.querySelectorAll('[role="tablist"]').length,
      top: pr.top - root.top, h: pr.height, rootH: root.height, crumbs: !!p.querySelector('.wb-crumbs'), solo: document.querySelector('.wb-root')!.classList.contains('wb-root--solo') };
  });
  const a = await geo();
  check('one tab: no strip (not shown, not in the accessibility tree)', a.strip === 'none' && a.tablists === 1 && a.solo, a);
  check('the document fills the area', a.top === 0 && Math.abs(a.h - a.rootH) < 1, a);
  check('its breadcrumbs stay as its header', a.crumbs);
  check('the panel is a region named by the document', a.role === 'region' && a.name === 'On the lemma of Kőnig', a);
  await page.click('.wb-crumb--home');         // the Documents crumb shows the home panel over the one tab
  await page.waitForSelector('.wb-home--over [data-open-new="graphs"]');
  check('the Documents crumb shows the home panel (no tab made)', await page.evaluate(() => document.querySelectorAll('.wb-tab').length) === 1 || (await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length)) === 1);
  await page.hover('.wb-home--over [data-open-new="graphs"]');
  await page.click('.wb-home--over [data-open-new="graphs"]');     // "open in a new tab": the second tab
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.wb-strip')!).display !== 'none');
  check('the strip comes in with a reveal', await page.evaluate(() => !!document.querySelector('.wb-strip--reveal')));
  await page.waitForFunction(() => !document.querySelector('.wb-strip--reveal'));
  const b2 = await geo();
  check('a second tab brings the strip back; the view starts under it', !b2.solo && await page.evaluate(() => { const p = document.querySelector('.wb-panel:not(.wb-panel--hidden)')!; const v = p.querySelector('.wb-view')!, sh = document.querySelector('.wb-strip')!.getBoundingClientRect();
    // the view runs under the strip, padded (every engine: Firefox too)
    return parseFloat(getComputedStyle(v).paddingTop) >= sh.height && v.getBoundingClientRect().top <= sh.top + 0.5; }), b2);
  check('… and the panels are tabpanels again', await page.evaluate(() => [...document.querySelectorAll('.wb-panel')].every((p) => p.getAttribute('role') === 'tabpanel' && !!document.getElementById(p.getAttribute('aria-labelledby')!))));
  await page.keyboard.press('Control+Alt+w');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.wb-strip')!).display === 'none');
  check('back to one tab: the strip goes again', (await geo()).role === 'region');
  await page.close();
});

// ── the first layout is placed, not animated: a load, a restore; the side panels never move with the tab bar ──
group('boot: a load and a reload are placed instantly (no animation, frames 0..10 identical); the side panels keep their y through every change', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await page.addInitScript(() => {
    const w = window as any; w.__fr = [];
    const snap = () => { const r = (s: string) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(1)).join(); };
      return { strip: r('.wb-bar [data-tab], .wb-groups .wb-strip:not([hidden]) [data-tab]'), head: r('aside[data-side="left"] .wb-panel:not(.wb-panel--hidden) .demo-panel-title'),
        anims: document.getAnimations().filter((a: any) => a.playState === 'running' && !(a instanceof CSSTransition && /background-color|color|opacity/.test(a.transitionProperty))).length }; };
    const tick = () => { if (document.querySelector('.wb-root [data-tab]')) w.__fr.push(snap()); if (w.__fr.length < 12) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const frames = () => page.waitForFunction(() => (window as any).__fr.length >= 12).then(() => page.evaluate(() => (window as any).__fr));
  const same = (fr: any[]) => fr.every((f) => f.strip === fr[0].strip && f.head === fr[0].head && f.anims === 0);
  await page.goto('http://wb.test/?fresh&single&theme=dark');
  const f1 = await frames();
  check('a load in single mode: no animation runs; the strip and the side heading identical in frames 0..10 after the first paint', same(f1), f1.slice(0, 4));
  // a reload (the saved layout restored): the same
  await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } }));
  await settled(page);
  await page.goto('http://wb.test/?single&theme=dark');
  const f2 = await frames();
  check('a reload restores the final state instantly (no animation, identical frames)', same(f2), f2.slice(0, 4));
  // the side heading's y through every change of the document area
  const y0 = await page.evaluate(() => document.querySelector('aside[data-side="left"] .wb-panel:not(.wb-panel--hidden) .demo-panel-title')!.getBoundingClientRect().top);
  const ys: number[] = [];
  const watch = async (act: () => Promise<void>) => {
    await page.evaluate(() => { const w = window as any; w.__ys = []; const tick = () => { const e = document.querySelector('aside[data-side="left"] .wb-panel:not(.wb-panel--hidden) .demo-panel-title'); w.__ys.push(e ? e.getBoundingClientRect().top : null); if (w.__ys.length < 30) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await act();
    await page.waitForFunction(() => (window as any).__ys.length >= 30);
    await settled(page);
    ys.push(...(await page.evaluate(() => (window as any).__ys)));
  };
  await watch(async () => { await page.evaluate(() => { const w = (window as any).demo.wb; for (let i = 0; i < 5; i++) w.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } }, { focus: false }); }); });    // bar → row
  await watch(async () => { await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; for (const t of M.allTabs(w.layout.peek()).slice(1)) w.close(t.id); }); });    // row → bar
  await watch(async () => { await page.setViewportSize({ width: 900, height: 600 }); });
  await watch(async () => { await page.setViewportSize({ width: 1400, height: 600 }); });
  await watch(async () => { await page.evaluate(() => { const w = (window as any).demo.wb; const t = w.open({ view: 'document', state: { doc: 'streams' } }); w.split(t, 'right', undefined, { copy: false }); }); });     // (a document: the outline keeps a heading)
  const off = ys.filter((y) => y !== y0);
  check('the outline heading keeps its y exactly (0 px) through bar ⇄ row, adding and closing tabs, resizes and a split, every frame', ys.length >= 100 && off.length === 0, { y0, off: [...new Set(off)].slice(0, 5) });
  await ctx.close();
});

// ── home: a toggle in every group, the first item of its strip; its panel over that group only ──
group('home in every group: first, narrow, not in 1/n, pinned while the tabs scroll; its panel in that group only (both highlights); again hides; open replaces, a new tab adds; the other group untouched; rows and the bar', async () => {
  for (const host of ['row', 'bar']) {
    const page = await fresh({ w: 1600, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh' });
    if (host === 'bar') await page.evaluate(() => { const w = (window as any).demo.wb; w.open({ view: 'list', state: { name: 'Fruit', items: [] } }); w.open({ view: 'text', state: { text: 'A note' } }); });
    await idle(page);
    if (host === 'bar') check('bar: the tabs are in the top bar', await page.evaluate(() => !!document.querySelector('.wb-strip--inbar .wb-tab')));
    const geo = await page.evaluate(() => [...document.querySelectorAll('.wb-strip')].filter((s) => (s as HTMLElement).offsetParent && !s.closest('.wb-park') && s.querySelector('.wb-tab')).map((s) => {
      const home = s.querySelector('.wb-home-btn')!, hr = home.getBoundingClientRect(), tabs = [...s.querySelectorAll('.wb-tab')].map((t) => t.getBoundingClientRect());
      const first = [...s.querySelectorAll('.wb-btn, .wb-tab')].filter((e) => e.getBoundingClientRect().width > 0 && !e.closest('.wb-side-toggle, .wb-strip-actions'))[0];
      return { group: s.getAttribute('data-strip-group'), first: first === home, w: hr.width, h: hr.height, tabH: tabs[0].height, widths: tabs.map((r) => +r.width.toFixed(1)), inList: !!home.closest('[role="tablist"]'), pressed: home.getAttribute('aria-pressed'), name: home.getAttribute('aria-label') };
    }));
    const n = host === 'bar' ? 1 : 2;
    check(`${host}: each group has its own home, first, an icon (32 px wide, the tabs' height), a toggle named Home outside the tablist`,
      geo.length === n && new Set(geo.map((g: any) => g.group)).size === n && geo.every((g: any) => g.first && g.w === 32 && Math.abs(g.h - g.tabH) <= 0.5 && !g.inList && g.pressed === 'false' && g.name === 'Home'), geo);
    check(`${host}: home is not one of n: the tabs share the rest equally (d)`, geo.every((g: any) => Math.max(...g.widths) - Math.min(...g.widths) <= 1 && g.widths[0] > g.w * 1.5), geo.map((g: any) => g.widths));
    // the panel in one group
    const gid = geo[geo.length - 1].group;
    const state = () => page.evaluate((gid: string) => { const wb = (window as any).demo.wb, M = (window as any).demo.M;
      return M.groups(wb.layout.peek()).map((g: any) => { const s = document.querySelector(`[data-strip-group="${g.id}"]:not([hidden])`) ?? document.querySelector(`.wb-strip--inbar`), home = s?.querySelector('.wb-home-btn'), act = s?.querySelector('.wb-tab.wb-tab--on');
        return { id: g.id, active: g.active, tabs: g.tabs.length, panel: !!document.querySelector(`[data-home="${g.id}"]`), pressed: home?.getAttribute('aria-pressed'), homeBg: home ? getComputedStyle(home).backgroundColor : null,
          actSel: act?.getAttribute('data-tab') === g.active, actBg: act ? getComputedStyle(act).backgroundColor : null, doc: g.tabs.find((t: any) => t.id === g.active)?.state?.doc ?? null }; }); }, gid);
    const before = await state();
    const homeSel = `[data-strip-group="${gid}"] .wb-home-btn:visible`;
    await page.click(homeSel);
    await page.waitForSelector(`[data-home="${gid}"]`);
    await idle(page);
    const on = await state();
    const me = on.find((g: any) => g.id === gid)!, others = on.filter((g: any) => g.id !== gid);
    check(`${host}: a click shows the home panel in that group only; home pressed and highlighted, the active tab still highlighted`,
      me.panel && me.pressed === 'true' && me.homeBg !== 'rgba(0, 0, 0, 0)' && me.actSel && me.actBg !== 'rgba(0, 0, 0, 0)' && others.every((g: any) => !g.panel && g.pressed === 'false'), on);
    check(`${host}: the other group is untouched`, others.every((g: any) => { const b = before.find((x: any) => x.id === g.id); return b && b.active === g.active && b.tabs === g.tabs; }));
    await page.click(homeSel);
    await page.waitForFunction((gid: string) => !document.querySelector(`[data-home="${gid}"]`), gid);
    const off = await state();
    check(`${host}: a second click hides it; the active tab as before`, off.find((g: any) => g.id === gid)!.active === me.active && off.find((g: any) => g.id === gid)!.pressed === 'false');
    // open from the panel: replaces the active tab
    await page.click(homeSel);
    await page.waitForSelector(`[data-home="${gid}"] [data-open-doc="streams"]`);
    await page.click(`[data-home="${gid}"] [data-open-doc="streams"]`);
    await page.waitForFunction((gid: string) => !document.querySelector(`[data-home="${gid}"]`), gid);
    const rep = (await state()).find((g: any) => g.id === gid)!;
    check(`${host}: opening a document from home replaces the active tab (the same tab, the new document); the panel closes`, rep.active === me.active && rep.tabs === me.tabs && rep.doc === 'streams', rep);
    // in a new tab: adds one
    await page.click(homeSel);
    await page.waitForSelector(`[data-home="${gid}"] [data-open-new="konig"]`);
    await page.hover(`[data-home="${gid}"] [data-open-new="konig"]`);
    await page.click(`[data-home="${gid}"] [data-open-new="konig"]`);
    await page.waitForFunction((gid: string) => !document.querySelector(`[data-home="${gid}"]`), gid);
    const add = (await state()).find((g: any) => g.id === gid)!;
    check(`${host}: "open in a new tab" adds a tab in that group, active; the panel closes`, add.tabs === me.tabs + 1 && add.active !== me.active && add.doc === 'konig', add);
    // keyboard: the first stop of the strip, and the shortcut toggles it in the focused group
    await idle(page);     // the new tab's own focus (into its content) lands first
    await page.evaluate((id: string) => (document.querySelector(`[data-tab="${id}"]`)!.closest('[role="tablist"]')!.querySelector('[role="tab"]') as HTMLElement).focus(), add.active);     // the strip's first tab
    await page.keyboard.press('Shift+Tab');
    const back = await page.evaluate(() => document.activeElement?.classList.contains('wb-home-btn') || document.activeElement?.className);
    await page.keyboard.press('Control+K'); await page.keyboard.press('n');
    const kb = await page.waitForSelector(`[data-home="${gid}"]`, { timeout: 3000 }).then(() => true, () => false);
    check(`${host}: home is the stop before the tabs (Shift+Tab from the first tab); Ctrl+K N toggles the panel of the focused group`, back === true && kb, { back, kb });
    await page.close();
  }
  // scrolling: home stays at the leading edge
  const page = await fresh({ query: 'fresh' });
  await page.evaluate(() => { const w = (window as any).demo.wb; for (let i = 0; i < 24; i++) w.open({ view: 'list', state: { name: `List ${i}`, items: [] } }); });
  await idle(page);
  const sc = await page.evaluate(async () => { const s = [...document.querySelectorAll('.wb-tabs')].find((t) => t.scrollWidth > t.clientWidth + 10) as HTMLElement;
    if (!s) return null; const home = s.closest('.wb-strip')!.querySelector('.wb-home-btn')!, a = home.getBoundingClientRect().left;
    s.scrollLeft = s.scrollWidth; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = home.getBoundingClientRect(), st = s.getBoundingClientRect(); return { a, b: b.left, scrolled: s.scrollLeft, visible: b.width > 0 && b.right <= st.left + 0.5 }; });
  check('home stays visible at the leading edge while the tabs scroll', !!sc && sc.scrolled > 0 && sc.a === sc.b && sc.visible, sc);
  await page.close();
});

group('double-click on the name renames (text selected), Escape cancels; one click still opens the switcher; no menu left; inactive tabs too; both hosts', async () => {
  for (const host of ['row', 'bar']) {
    const page = await fresh({ query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh' });
    if (host === 'bar') await page.evaluate(() => (window as any).demo.wb.open({ view: 'list', state: { name: 'Fruit', items: [] } }));
    await idle(page);
    // a document tab, active in the focused group
    const id = await page.evaluate(() => { const t = [...document.querySelectorAll('.wb-tab')].find((e) => e.querySelector('[data-name]') && (e as HTMLElement).offsetParent)!; (window as any).demo.wb.activate(t.getAttribute('data-tab')); return t.getAttribute('data-tab')!; });
    await idle(page);
    const name = `[data-tab="${id}"] [data-name]`;
    await page.click(name);
    const sw = await page.waitForSelector('[role="grid"]', { timeout: 3000 }).then(() => true, () => false);
    check(`${host}: one click on the name opens the switcher`, sw);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="grid"]'));
    await page.dblclick(name);
    await page.waitForSelector(`[data-rename="${id}"]`, { timeout: 3000 }).catch(() => {});
    await idle(page);
    const r = await page.evaluate((id: string) => { const i = document.querySelector(`[data-rename="${id}"]`) as HTMLInputElement | null;
      return { field: !!i, focused: document.activeElement === i, all: i ? i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value.length > 0 : false, menus: document.querySelectorAll('[role="grid"], [role="menu"]').length }; }, id);
    check(`${host}: a double-click on the name starts the rename, the name selected, no menu left open`, r.field && r.focused && r.all && r.menus === 0, r);
    await page.keyboard.press('Escape');
    await page.waitForFunction((id: string) => !document.querySelector(`[data-rename="${id}"]`), id);
    check(`${host}: Escape cancels`, await page.evaluate(() => document.querySelectorAll('[role="grid"], [role="menu"]').length === 0));
    // an inactive tab: a double-click activates it and renames
    const other = await page.evaluate((id: string) => [...document.querySelectorAll('.wb-tab:not(.wb-tab--on)')].find((e) => (e as HTMLElement).offsetParent && e.querySelector('.wb-tab-label') && (window as any).demo.wb.canRename(e.getAttribute('data-tab')))?.getAttribute('data-tab') ?? null, id);
    if (other) {
      await page.dblclick(`[data-tab="${other}"] .wb-tab-label`);
      const ok = await page.waitForSelector(`[data-rename="${other}"]`, { timeout: 3000 }).then(() => true, () => false);
      check(`${host}: a double-click on an inactive tab's name activates it and renames`, ok && await page.evaluate((o: string) => (window as any).demo.wb.current.peek().tab.id === o, other));
      await page.keyboard.press('Escape');
    }
    await page.close();
  }
});

group('no tabs: the strip of the single group (home alone) stays in the top bar, home pressed, the home panel shown, no tab row; a document opened there comes back as a tab in the bar', async () => {
  const page = await fresh({ query: 'fresh&single&bar=1' });
  await idle(page);
  await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; for (const t of M.allTabs(w.layout.peek())) w.close(t.id); });
  await page.waitForFunction(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length === 0);
  await idle(page);
  const st = () => page.evaluate(() => ({ inbar: (window as any).demo.wb.inbar.peek(), home: document.querySelector('.wb-bar .wb-strip--inbar .wb-home-btn')?.getAttribute('aria-pressed') ?? null,
    rows: [...document.querySelectorAll('.wb-groups .wb-strip')].filter((s) => (s as HTMLElement).offsetParent && getComputedStyle(s).display !== 'none').length,
    panel: !!document.querySelector('.wb-home [data-open-doc]'), barTabs: document.querySelectorAll('.wb-bar [data-tab]').length }));
  const a = await st();
  check('every tab closed: home alone in the top bar, pressed; the home panel; no tab row', a.inbar && a.home === 'true' && a.rows === 0 && a.panel && a.barTabs === 0, a);
  await page.click('.wb-home [data-open-doc="graphs"]');
  await page.waitForFunction(() => document.querySelectorAll('.wb-bar [data-tab]').length === 1);
  const b = await st();
  check('a document opened from it: a tab in the bar, home released', b.inbar && b.home === 'false' && b.rows === 0 && !b.panel, b);
  await page.close();
});

group('no chip during the press that activates: an inactive tab, the active tab of an unfocused group; the chip only after the pointer leaves and comes back', async () => {
  for (const c of ['two lines']) {
    const page = await fresh({ query: 'fresh' });
    // the focused group shows a document (its other document tabs inactive); the other group's active tab is a document
    const setup = () => page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; let gs = M.groups(w.layout.peek());
      if (!gs[1].tabs.some((t: any) => t.view === 'document')) w.open({ view: 'document', state: { doc: 'streams' } }, { group: gs[1].id });
      gs = M.groups(w.layout.peek()); w.activate(gs[1].tabs.find((t: any) => t.view === 'document').id); w.activate(gs[0].tabs[0].id); w.focusGroup(gs[0].id); });
    await setup();
    await idle(page);
    const bg = (sel: string) => page.evaluate((sel: string) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundColor : 'none'; }, sel);
    const clear = (v: string) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
    const cases = await page.evaluate(() => {
      const M = (window as any).demo.M, L = (window as any).demo.wb.layout.peek(), gs = M.groups(L), act = L.active;
      const focused = gs.find((g: any) => g.id === act), other = gs.find((g: any) => g.id !== act);
      const inactive = focused.tabs.find((t: any) => t.id !== focused.active && document.querySelector(`[data-tab="${t.id}"] [data-sub]`));
      return [inactive ? { id: inactive.id, what: 'an inactive tab' } : null, other ? { id: other.active, what: 'the active tab of an unfocused group' } : null].filter(Boolean);
    });
    for (const k of cases as any[]) for (const part of ['[data-name]', '[data-sub]']) {
      const sel = `[data-tab="${k.id}"] ${part}`;
      if (await page.locator(sel).count() === 0) continue;
      // start from a settled state: this tab inactive or its group unfocused again
      const b = (await page.locator(sel).boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const d = await bg(sel);
      await page.mouse.up();
      await idle(page);
      const u = await bg(sel);
      const menus = await page.evaluate(() => document.querySelectorAll('[role="grid"], [role="menu"]').length);
      check(`${c}, ${k.what}, ${part}: no chip during the press nor after it (the pointer still there); no menu`, clear(d) && clear(u) && menus === 0, { d, u, menus });
      await page.mouse.move(2, 790); await idle(page);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await idle(page);
      const h = await bg(sel);
      check(`${c}, ${k.what}, ${part}: the next hover shows the chip`, !clear(h), h);
      await page.mouse.move(2, 790);
      // undo: make the other side focused again for the next case
      await setup();
      await idle(page);
    }
    await page.close();
  }
});

group('the top bar takes the strip of the group spanning the whole top edge: one group, the top of a vertical stack; none when the top is split side by side; each change moves once; end states as the static layouts', async () => {
  const page = await fresh({ w: 1600, query: 'fresh&single&bar=1' });
  await page.evaluate(() => { const w = (window as any).demo.wb; w.open({ view: 'list', state: { name: 'Fruit', items: [] } }); w.open({ view: 'text', state: { text: 'A note' } }); });
  await idle(page);
  await page.evaluate(() => { const w = window as any; w.__place = []; w.demo.wb.on('tabsplace', (d: any) => w.__place.push(d.inbar)); });
  const st = () => page.evaluate(async () => { await (window as any).demo.wb.idle();
    const w = (window as any).demo.wb, M = (window as any).demo.M, L = w.layout.peek();
    return { inbar: w.inbar.peek(), bar: M.barGroup(L)?.id ?? null, inBar: [...document.querySelectorAll('.wb-bar .wb-strip--inbar')].map((s) => s.getAttribute('data-strip-group')),
      rows: [...document.querySelectorAll('.wb-groups .wb-strip')].filter((s) => (s as HTMLElement).offsetParent && getComputedStyle(s).display !== 'none' && !s.hasAttribute('hidden')).map((s) => s.getAttribute('data-strip-group')).sort(),
      groups: M.groups(L).length, place: [...(window as any).__place] }; });
  const one = await st();
  check('one group: its strip in the bar, no row', one.inbar && one.inBar.length === 1 && one.inBar[0] === one.bar && one.rows.length === 0, one);
  // a vertical stack: the top group in the bar, the bottom one in a row
  await page.evaluate(() => { const w = (window as any).demo.wb; w.split(w.current.peek().tab.id, 'bottom', undefined, { copy: false }); });
  const stack = await st();
  const top = await page.evaluate(() => { const M = (window as any).demo.M, L = (window as any).demo.wb.layout.peek(); return { top: L.root.children[0].id, bottom: L.root.children[1].id }; });
  check('a vertical stack: the top group in the bar, the bottom one in its row', stack.inbar && stack.inBar[0] === top.top && stack.rows.join() === top.bottom, { stack, top });
  // the top split side by side: no group in the bar
  await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M, L = w.layout.peek(); const t = L.root.children[0]; w.split(t.tabs[0].id, 'right', t.id, { copy: true }); });
  const side = await st();
  check('the top split side by side: no group in the bar; every group in a row', !side.inbar && side.inBar.length === 0 && side.rows.length === side.groups && side.groups === 3, side);
  check('the strip moved into the bar and out once each', JSON.stringify(side.place) === JSON.stringify([false]), side.place);
  // the end states equal the static layouts (loaded fresh)
  const json = await page.evaluate(() => (window as any).demo.wb.serialize());
  await page.evaluate((j: string) => (window as any).demo.wb.load(j), json);
  const re = await st();
  check('reloading the side-by-side layout: the same state', !re.inbar && re.rows.join() === side.rows.join(), re);
  // and back: closing the top-right group's tab makes the stack again: in the bar once more
  await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M, L = w.layout.peek(); const tr = L.root.children[0].children[1]; for (const t of tr.tabs) w.close(t.id); });
  const back = await st();
  check('back to a stack: the top group in the bar again, the bottom in its row', back.inbar && back.inBar.length === 1 && back.rows.length === 1, back);
  await page.close();
});

group('drops: every zone the geometry offers is shown (own group too); a drop that changes nothing commits nothing (no remount, no motion, the scroll kept); the article at one offset after a split, a no-op drop and a reload', async () => {
  const page = await fresh({ w: 1400, query: 'fresh&single&bar=1' });
  await page.evaluate(() => (window as any).demo.wb.open({ view: 'document', state: { doc: 'graphs' } }));
  await idle(page);
  const ids = await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).map((t: any) => t.id));
  check('two documents, both in the top bar', await page.evaluate(() => document.querySelectorAll('.wb-bar [data-tab]').length) === 2);
  const settle = () => page.evaluate(async () => { await (window as any).demo.wb.idle(); await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))); });
  const bodyOf = (gi: number) => page.evaluate((gi: number) => { const M = (window as any).demo.M, g = M.groups((window as any).demo.wb.layout.peek())[gi]; const r = document.querySelector(`[data-body="${g.id}"]`)!.getBoundingClientRect(); const st = document.querySelector(`[data-strip-group="${g.id}"]:not([hidden])`)?.getBoundingClientRect(); const top = st && st.height ? st.bottom - r.top : 0; return { x: r.left, y: r.top + top, w: r.width, h: r.height - top, id: g.id }; }, gi);     // below the strip (the body runs under its glass)
  // split: the second tab dragged to the body's right edge
  let b = await bodyOf(0);
  await drag(page, await center(page, tabSel(ids[1])), { x: b.x + b.w - 12, y: b.y + b.h / 2 });
  await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 2);
  await settle();
  const offset = () => page.evaluate((id: string) => { const p = document.getElementById(`${id}-panel`)!, a = p.querySelector('article')!; return +(a.getBoundingClientRect().left - p.getBoundingClientRect().left).toFixed(2); }, ids[1]);
  const o1 = await offset();
  // every zone shown: the own group (one tab) and the other group, at the centre and the four edges
  const want: [number, string, (r: any) => { x: number; y: number }][] = [];
  for (const gi of [0, 1]) {
    want.push([gi, 'center', (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })], [gi, 'left', (r) => ({ x: r.x + 12, y: r.y + r.h / 2 })], [gi, 'right', (r) => ({ x: r.x + r.w - 12, y: r.y + r.h / 2 })],
      [gi, 'top', (r) => ({ x: r.x + r.w / 2, y: r.y + 12 })], [gi, 'bottom', (r) => ({ x: r.x + r.w / 2, y: r.y + r.h - 12 })]);
  }
  const shown: string[] = [];
  for (const [gi, zone, at] of want) {
    const r = await bodyOf(gi);
    await drag(page, await center(page, tabSel(ids[1])), at(r), { release: false });
    const z = await page.waitForSelector('.wb-zone', { timeout: 2000 }).then(() => page.evaluate(() => document.querySelector('.wb-zone')!.getAttribute('data-zone')), () => null);
    shown.push(`${gi}:${zone}=${z}`);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.wb-zone') && !document.querySelector('[data-wb-ghost]'));
  }
  check('every zone the geometry offers is shown, the own group (its only tab) included', shown.every((x) => { const [k, z] = x.split('='); return k.split(':')[1] === z; }), shown);
  // the no-op drop: the right pane's only tab onto the left group's split-right zone
  await page.evaluate((id: string) => { const v = document.getElementById(`${id}-panel`)!.querySelector('.demo-doc') as any; v.scrollTop = 200; v.__mark = 'same'; }, ids[1]);
  const json0 = await page.evaluate(() => (window as any).demo.wb.serialize());
  const rects = () => [...document.querySelectorAll('.wb-tab, .wb-strip')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2).join(); }).join('|');
  const before = await page.evaluate(`(${rects.toString()})()`);
  b = await bodyOf(0);
  await drag(page, await center(page, tabSel(ids[1])), { x: b.x + b.w - 12, y: b.y + b.h / 2 }, { release: false });
  const zone = await page.waitForSelector('.wb-zone[data-zone="right"]', { timeout: 2000 }).then(() => true, () => false);
  check('the no-op target is offered as any zone (split right of the left group)', zone);
  await page.evaluate(`window.__frames = []; (function rec(n) { window.__frames.push({ r: (${rects.toString()})(), anims: document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.wb-tab, .wb-strip')).length }); if (n > 0) requestAnimationFrame(() => rec(n - 1)); })(24);`);
  await page.evaluate(() => { const w = window as any; w.__acts = 0; w.demo.wb.on('activate', () => { w.__acts++; }); });
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__frames.length >= 25, null, { timeout: 5000 }).catch(() => {});     // every frame recorded (WebKit paces its frames slower)
  const fr = await page.evaluate(() => (window as any).__frames);
  const after = await page.evaluate((id: string) => { const v = document.getElementById(`${id}-panel`)!.querySelector('.demo-doc') as any; return { json: (window as any).demo.wb.serialize(), same: v?.__mark === 'same', top: v?.scrollTop }; }, ids[1]);
  const moved = fr.filter((f: any) => f.r !== before || f.anims);
  check('the no-op drop: the layout JSON equal, the same view node, the scroll kept', after.json === json0 && after.same && after.top === 200, { same: after.same, top: after.top, eq: after.json === json0 });
  check('… and no motion: every pill and strip at its place in every frame through the drop and after, no animation on them', fr.length >= 20 && moved.length === 0, { frames: fr.length, moved: moved.slice(0, 2) });
  const inContent = await page.waitForFunction((id: string) => !!document.getElementById(`${id}-panel`)?.contains(document.activeElement), ids[1], { timeout: 2000 }).then(() => true, () => false);
  const acts = await page.evaluate(() => (window as any).__acts);
  check('… the dropped tab activated once (the drop decides its focus), the focus in its content', inContent && acts === 1, { inContent, acts });
  const o2 = await offset();
  await page.evaluate(() => { const w = (window as any).demo.wb; w.load(w.serialize()); });
  await settle();
  const o3 = await offset();
  check('the offset of the article in its pane: the same after the split, the no-op drop and a reload (±0.5)', Math.abs(o1 - o2) <= 0.5 && Math.abs(o1 - o3) <= 0.5, { o1, o2, o3 });
  await page.close();
});

group('keys: Ctrl+K S and Ctrl+K D open the section menu and the switcher on the focused active tab; the Keyboard shortcuts view lists every keymap entry, searchable, from Ctrl+K Ctrl+S and the menu; light and dark', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, query: 'fresh&bar=1' });
    await idle(page);
    const doc = await page.evaluate(() => { const w = (window as any).demo.wb; const t = (window as any).demo.M.allTabs(w.layout.peek()).find((x: any) => x.view === 'document'); w.activate(t.id); return t.id; });
    await idle(page);
    await page.focus(stopSel(doc));
    await chord(page, 's');
    const sec = await page.waitForSelector('[role="grid"][aria-label="Sections"]', { timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="grid"]'));
    await page.focus(stopSel(doc));
    await chord(page, 'd');
    const sw = await page.waitForSelector('[role="grid"][aria-label="Switch document"]', { timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.press('Escape');
    check(`${theme}: Ctrl+K S opens the section menu, Ctrl+K D the switcher, on the focused active tab`, sec && sw, { sec, sw });
    await page.focus(stopSel(doc));
    await page.keyboard.press('Control+k'); await page.keyboard.press('Control+s');
    await page.waitForSelector('[data-shortcuts] tr[data-shortcut]', { timeout: 3000 });
    const v = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-shortcuts] tr[data-shortcut]').length, areas: [...document.querySelectorAll('[data-shortcuts] [data-area]')].map((a) => a.getAttribute('data-area')),
      tab: (window as any).demo.wb.current.peek().tab.view, chordShown: [...document.querySelectorAll('[data-shortcuts] tr[data-shortcut="splitRight"] kbd')].map((k) => k.textContent),
      ink: getComputedStyle(document.querySelector('[data-shortcuts] th')!).color, bg: getComputedStyle(document.body).backgroundColor }));
    check(`${theme}: Ctrl+K Ctrl+S opens the Keyboard shortcuts tab: one row per keymap entry (${KEYMAP.length}), grouped by area, a chord as its two keys`, v.tab === 'shortcuts' && v.rows === KEYMAP.length && v.areas.length >= 4 && v.chordShown.length === 2 && v.chordShown[0] === 'Ctrl+K', v);
    await page.fill('[data-shortcuts] input[type="search"]', 'split');
    const f = await page.evaluate(() => [...document.querySelectorAll('[data-shortcuts] tr[data-shortcut]')].map((r) => r.textContent!.toLowerCase()));
    check(`${theme}: search filters the rows`, f.length > 0 && f.length < KEYMAP.length && f.every((t: string) => t.includes('split')), f.length);
    // the ⋯ menu brings it forward (it is open already: no second tab)
    await page.click('[data-demo="menu"]');
    await page.click('[role="menu"] [data-item="shortcuts"]');
    const n = await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).filter((t: any) => t.view === 'shortcuts').length);
    check(`${theme}: the ⋯ menu has it; it brings the open one forward`, n === 1, n);
    await page.close();
  }
});

group('rename in place: the glyphs do not move (first glyph x, baseline) entering rename and after confirming or cancelling; the tab keeps its box; rows (b, c) and the bar, light and dark', async () => {
  for (const [host, q] of [['two lines', 'fresh'], ['one line', 'fresh'], ['bar', 'fresh&single&bar=1']]) for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, w: 1400, query: q });
    if (host === 'one line') await oneLine(page);
    await page.addStyleTag({ content: '.wb-root .wb-tab.wb-tab { box-shadow: none !important; } .wb-rename { caret-color: transparent !important; box-shadow: none !important; background: transparent !important; } .wb-rename::selection { background: transparent !important; color: inherit !important; }' });
    await idle(page);
    const id = await page.evaluate(() => { const w = (window as any).demo.wb; const t = [...document.querySelectorAll('.wb-tab')].find((e) => (e as HTMLElement).offsetParent && e.querySelector('[data-name]') && w.canRename(e.getAttribute('data-tab')))!; w.activate(t.getAttribute('data-tab')); return t.getAttribute('data-tab')!; });
    await idle(page);
    await page.mouse.move(2, 790);
    const box = await page.evaluate((id: string) => { const l = document.querySelector(`[data-tab="${id}"] .wb-tab-label`)!.getBoundingClientRect(), t = document.querySelector(`[data-tab="${id}"]`)!.getBoundingClientRect();
      return { clip: { x: Math.floor(l.left - 4), y: Math.floor(l.top - 4), width: Math.ceil(l.width + 8), height: Math.ceil(l.height + 8) }, tab: [t.x, t.y, t.width, t.height].map((v) => Math.round(v * 2) / 2).join() }; }, id);
    // the ink: the pixels far from the ground (the corners' colour), their left edge and their bottom
    const ink = async () => { const png = decodePng(await page.screenshot({ clip: box.clip })); const bg = luma(png.px, 0); let left = 1e9, bottom = -1;
      const on = (x: number, y: number) => Math.abs(luma(png.px, (y * png.w + x) * 4) - bg) > 60;
      for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) if (on(x, y)) left = Math.min(left, x);
      // the baseline: the first glyph's bottom (its own columns: the field shows the whole name, the label maybe a cut one)
      for (let y = 0; y < png.h; y++) for (let x = left; x < Math.min(png.w, left + 5); x++) if (on(x, y)) bottom = Math.max(bottom, y);
      return { left, bottom }; };
    const tabBox = () => page.evaluate((id: string) => { const t = document.querySelector(`[data-tab="${id}"]`)!.getBoundingClientRect(); return [t.x, t.y, t.width, t.height].map((v) => Math.round(v * 2) / 2).join(); }, id);
    const a = await ink();
    await page.evaluate((id: string) => (window as any).demo.wb.rename(id), id);
    await page.waitForSelector(`[data-rename="${id}"]`);
    await page.evaluate((id: string) => { const i = document.querySelector(`[data-rename="${id}"]`) as HTMLInputElement; i.setSelectionRange(i.value.length, i.value.length); }, id);
    await idle(page);
    const b = await ink(), tb = await tabBox();
    check(`${host}, ${theme}: entering rename: the first glyph and the baseline where they were (±0.5 px); the tab's box unchanged`, Math.abs(a.left - b.left) <= 0.5 && Math.abs(a.bottom - b.bottom) <= 0.5 && tb === box.tab, { a, b, tb, was: box.tab });
    await page.keyboard.press('Escape');
    await page.waitForFunction((id: string) => !document.querySelector(`[data-rename="${id}"]`), id);
    await page.mouse.move(2, 790); await idle(page);
    const c = await ink();
    await page.evaluate((id: string) => (window as any).demo.wb.rename(id), id);
    await page.waitForSelector(`[data-rename="${id}"]`);
    await page.keyboard.press('Enter');     // confirmed unchanged
    await page.waitForFunction((id: string) => !document.querySelector(`[data-rename="${id}"]`), id);
    await page.mouse.move(2, 790); await idle(page);
    const d = await ink();
    check(`${host}, ${theme}: after cancelling and after confirming the text is back in its place`, Math.abs(a.left - c.left) <= 0.5 && Math.abs(a.bottom - c.bottom) <= 0.5 && Math.abs(a.left - d.left) <= 0.5 && Math.abs(a.bottom - d.bottom) <= 0.5, { a, c, d });
    await page.close();
  }
});

group('every splitter alike: the groups\' vertical and horizontal ones, the side columns\' edges and their stacks: one thickness (sampled), one colour token, one hit area, no handle; hovered and dragged 3× as thick, centred, nothing moves; the stack\'s line on its snapped boundary; DPR 1 and 2, light and dark', async () => {
  for (const theme of ['light', 'dark']) for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&bar=1&theme=${theme}`);
    await page.waitForSelector('.wb-tab');
    await page.evaluate(() => { const w = (window as any).demo.wb; w.collapseSide('right', false); w.split(w.current.peek().tab.id, 'bottom', undefined, { copy: true }); });
    await page.evaluate(async () => { await (window as any).demo.wb.idle(); await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))); });
    const seps = await page.evaluate(() => [...document.querySelectorAll('[role="separator"]')].filter((e) => (e as HTMLElement).offsetParent && e.getBoundingClientRect().width > 0).map((e) => {
      const r = e.getBoundingClientRect(), c = getComputedStyle(e, '::before'), v = e.getAttribute('aria-orientation') === 'vertical';
      const kind = e.classList.contains('wb-side-sep') ? 'side edge' : e.closest('.wb-side-groups') ? 'side stack' : v ? 'groups, vertical' : 'groups, horizontal';
      const a = v ? r.left + parseFloat(c.left) : r.top + parseFloat(c.top);
      const mid = v ? r.top + Math.min(r.height / 2, 300) : r.left + r.width / 2;
      // the boundary it sits on: a stack's (the upper group's bottom: aria-controls), else the hit area's centre (the groups' edges: the gap test)
      const up = e.closest('.wb-side-groups') ? document.getElementById(e.getAttribute('aria-controls')!)?.getBoundingClientRect() : null;
      return { kind, v, a, mid, hit: v ? r.width : r.height, bg: c.backgroundColor, handle: getComputedStyle(e, '::after').content, at: v ? r.left + r.width / 2 : r.top + r.height / 2, boundary: up ? up.bottom : null, cx: v ? r.left + r.width / 2 : r.left + r.width / 2, cy: v ? r.top + Math.min(r.height / 2, 300) : r.top + r.height / 2 }; }));
    // a strip of pixels across the line: the run that differs from both sides is the line (its count, its centre in CSS px)
    const paint = async (sp: any) => { const clip = sp.v ? { x: Math.floor(sp.a) - 6, y: Math.floor(sp.mid), width: 13, height: 1 } : { x: Math.floor(sp.mid), y: Math.floor(sp.a) - 6, width: 1, height: 13 };
      const png = decodePng(await page.screenshot({ clip }));
      const n = sp.v ? png.w : png.h, at = (i: number) => luma(png.px, (sp.v ? i : i * png.w) * 4);
      const side = at(0), other = at(n - 1);
      let run = 0, sum = 0;
      for (let i = 0; i < n; i++) if (Math.abs(at(i) - side) > 2 && Math.abs(at(i) - other) > 2) { run++; sum += i; }
      return { run, centre: (sp.v ? clip.x : clip.y) + (run ? (sum / run + 0.5) / dpr : 0) }; };
    const boxes = () => page.evaluate(() => [...document.querySelectorAll('.wb-group, .wb-side, .wb-side-pane, .wb-tab')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(); }).join('|'));
    const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const out: any[] = [];
    for (const sp of seps) {
      const rest = await paint(sp);
      const b0 = await boxes();
      await page.mouse.move(sp.cx, sp.cy); await settle();
      const hov = await paint(sp), b1 = await boxes();
      await page.mouse.down(); await page.mouse.move(sp.cx + (sp.v ? 0 : 1), sp.cy, { steps: 1 }); await settle();
      const drag = await page.evaluate(() => !!document.querySelector('.wb-sep--drag')) ? await paint(sp) : null;
      await page.keyboard.press('Escape'); await page.mouse.up(); await page.mouse.move(5, 795); await settle();
      out.push({ kind: sp.kind, px: rest.run, hover: hov.run, drag: drag?.run ?? null, moved: hov.centre - rest.centre, still: b0 === b1, bg: sp.bg, hit: sp.hit, handle: sp.handle, boundary: sp.boundary, onBoundary: sp.boundary == null ? 0 : rest.centre - sp.boundary });
    }
    const kinds = new Set(out.map((o) => o.kind));
    check(`${theme}, DPR ${dpr}: every kind present; one thickness (${dpr} device px), one colour token, one 8 px hit area, no handle`,
      kinds.size === 4 && out.every((o) => o.px === dpr && o.bg === out[0].bg && o.hit === 8 && o.handle === 'none'), out);
    check(`${theme}, DPR ${dpr}: hovered and dragged, every line 3× as thick (${3 * dpr} device px), centred (±0.5), nothing moving`,
      out.every((o) => o.hover === 3 * dpr && (o.drag == null || o.drag === 3 * dpr) && Math.abs(o.moved) <= 0.5 && o.still) && out.some((o) => o.drag != null), out);
    check(`${theme}, DPR ${dpr}: the side stack's line centred on its boundary (±0.5), the boundary on a whole pixel`, out.filter((o) => o.kind === 'side stack').every((o) => Math.abs(o.onBoundary) <= 0.5 && Number.isInteger(o.boundary)), out.filter((o) => o.kind === 'side stack'));
    await ctx.close();
  }
});

// ── tab drag and drop ──
group('tab drag: reorder, move, split by edge, Escape', async () => {
  const page = await fresh();
  await events(page);
  const [a, b, c] = await tabsOf(page, 0);
  const g2 = await groupEl(page, 1);
  // reorder: a after c
  const pa = await center(page, tabSel(a)), pc = await center(page, tabSel(c));
  await drag(page, pa, { x: pc.b.x + pc.b.width - 4, y: pc.y }, { release: false });
  await page.waitForSelector('.wb-insert');
  check('an insertion bar shows over the strip', true);
  check('the ghost is in the top layer', await page.evaluate(() => { const g = document.querySelector('[data-wb-ghost]'); return !!g && g.matches(':popover-open'); }));
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.wb-insert') && !document.querySelector('[data-wb-ghost]'));
  check('reorder: a moves after c', (await tabsOf(page, 0)).join() === [b, c, a].join(), await tabsOf(page, 0));
  // move into the other group's strip, before its first tab
  const t2 = await tabsOf(page, 1);
  const pb = await center(page, tabSel(b)), first2 = await center(page, tabSel(t2[0]));
  await drag(page, pb, { x: first2.b.x + 4, y: first2.y });
  await page.waitForFunction((id: string) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[1].tabs[0].id === id, b);
  check('move to another group\'s strip at an index', true);
  check('the moved tab is active in its new group', await page.evaluate((id: string) => (window as any).demo.wb.current.peek().tab.id === id, b));
  // drop on the body centre of group 1
  const body1 = await center(page, `[data-body="${await groupEl(page, 0)}"]`);
  const pb2 = await center(page, tabSel(b));
  await drag(page, pb2, body1, { release: false });
  await page.waitForSelector('.wb-zone[data-zone="center"]');
  check('the centre zone previews a move', true);
  await page.mouse.up();
  await page.waitForFunction((id: string) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[0].tabs.some((t: any) => t.id === id), b);
  check('dropped on a body: moved into that group', true);
  // split by the right edge of group 2
  const body2 = await center(page, `[data-body="${g2}"]`);
  const pc2 = await center(page, tabSel(c));
  await drag(page, pc2, { x: body2.b.x + body2.b.width - 10, y: body2.y }, { release: false });
  await page.waitForSelector('.wb-zone[data-zone="right"]');
  check('the right edge previews a split', true);
  await page.mouse.move(1279, body2.y, { steps: 2 });
  check('the ghost stays inside the viewport at its edge', await page.evaluate(() => document.querySelector('[data-wb-ghost]')!.getBoundingClientRect().right <= innerWidth + 0.5));
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 3);
  const L = await layout(page);
  check('split: three groups in a row, the new one last with c', L.root.dir === 'row' && L.root.children.length === 3 && L.root.children[2].tabs[0].id === c, L.root.children.map((x: any) => x.id));
  // bottom edge
  const pa2 = await center(page, tabSel(a));
  const body1b = await center(page, `[data-body="${await groupEl(page, 0)}"]`);
  await drag(page, pa2, { x: body1b.x, y: body1b.b.y + body1b.b.height - 8 });
  await page.waitForFunction(() => (window as any).demo.wb.layout.peek().root.children[0].kind === 'split');
  check('split by the bottom edge: a column', (await layout(page)).root.children[0].dir === 'column');
  // Escape cancels
  const t = (await tabsOf(page, 0))[0];
  await page.click(tabSel(t));
  const before = JSON.stringify(await layout(page));
  const pt = await center(page, tabSel(t));
  const lastBody = await center(page, `[data-body="${await groupEl(page, 3)}"]`);
  await drag(page, pt, { x: lastBody.b.x + 10, y: lastBody.y }, { release: false });
  await page.waitForSelector('.wb-zone');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.wb-zone') && !document.querySelector('[data-wb-ghost]'));
  await page.mouse.up();
  check('Escape cancels: nothing changed', JSON.stringify(await layout(page)) === before);
  const ends = await evs(page, 'tabdragend');
  check('tabdragend events: dropped ×5, then cancelled', ends.length === 6 && ends.slice(0, 5).every((e: any) => e.d.dropped) && ends[5].d.cancelled, ends.map((e: any) => e.d.dropped));
  // a short press is a click, not a drag
  const t0 = (await tabsOf(page, 1)).at(-1);
  await page.click(tabSel(t0));
  check('a click is not a drag', (await evs(page, 'tabdragstart')).length === 6);
  await page.close();
});

// ── content drag and drop ──
group('content drag: spring-loading, drop in another tab and group, preview, Escape, auto-scroll', async () => {
  const page = await fresh();
  await events(page);
  const g1 = await groupEl(page, 0);
  const [lemma, , fruit] = await tabsOf(page, 0);
  const veg = (await tabsOf(page, 1))[0];
  // a spare list in group 1, not active
  const spare = await page.evaluate((g: string) => (window as any).demo.wb.open({ view: 'list', state: { name: 'Spare', items: [] } }, { group: g, activate: false }), g1);
  await page.waitForSelector(tabSel(spare));
  // drag Fruit 1 over the Vegetables list (other group): the line shows, the preview follows
  const item = await center(page, '[data-item="Fruit 1"]');
  const vegRow = await center(page, '[data-item="Vegetable 3"]');
  await drag(page, item, { x: vegRow.x, y: vegRow.b.y + 3 }, { release: false });
  await page.waitForSelector(`[data-list="${veg}"] .demo-line`);
  check('the target draws its insertion line', await page.getAttribute(`[data-list="${veg}"] .demo-line`, 'data-line') === '2');
  const g0 = await page.evaluate(() => { const r = document.querySelector('[data-wb-ghost]')!.getBoundingClientRect(); return { x: r.x, y: r.y, top: (document.querySelector('[data-wb-ghost]') as HTMLElement).matches(':popover-open') }; });
  check('the preview is in the top layer', g0.top);
  await page.mouse.move(vegRow.x + 40, vegRow.b.y + 30, { steps: 3 });
  const g1p = await page.evaluate(() => { const r = document.querySelector('[data-wb-ghost]')!.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  check('the preview follows the pointer', Math.abs(g1p.x - g0.x - 40) < 1.5 && Math.abs(g1p.y - g0.y - 27) < 1.5, { g0, g1p });
  check('the host\'s preview is used', await page.evaluate(() => !!document.querySelector('[data-wb-ghost] .demo-drag')));
  check('no tab-drag zones during a content drag', await page.evaluate(() => !document.querySelector('.wb-zone, .wb-insert')));
  await page.mouse.move(vegRow.x, vegRow.b.y + 3, { steps: 2 });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('[data-wb-ghost]') && !document.querySelector('.demo-line'));
  const st = await page.evaluate(([f, v]: string[]) => { const L = (window as any).demo.wb.layout.peek(), M = (window as any).demo.M; return { f: M.findTab(L, f).state.items, v: M.findTab(L, v).state.items }; }, [fruit, veg]);
  check('dropped into another group: inserted at the line', st.v.indexOf('Fruit 1') === 2, st.v);
  check('… and moved out of the source', !st.f.includes('Fruit 1'));
  // spring-loading: hold over the Spare tab (same group, not active) → it opens; drop into it
  const item2 = await center(page, '[data-item="Fruit 2"]');
  const spareTab = await center(page, tabSel(spare));
  await drag(page, item2, spareTab, { release: false });
  await page.waitForSelector(`${tabSel(spare)}[data-spring]`);
  check('a hovered tab shows the spring wait', true);
  await page.waitForFunction((id: string) => document.querySelector(`[data-tab="${id}"]`)!.classList.contains('wb-tab--on'), spare);
  check('spring-loading activates the hovered tab', true);
  const spareList = await center(page, `[data-list="${spare}"]`);
  await page.mouse.move(spareList.x, spareList.y, { steps: 4 });
  await page.waitForSelector(`[data-list="${spare}"] .demo-line`);
  await page.mouse.up();
  await page.waitForFunction((id: string) => { const L = (window as any).demo.wb.layout.peek(); return (window as any).demo.M.findTab(L, id).state.items.includes('Fruit 2'); }, spare);
  check('dropped into another tab of the same group', true);
  const fr = await page.evaluate((id: string) => (window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).state.items, fruit);
  check('… and removed from the source tab (now hidden)', !fr.includes('Fruit 2'));
  // Escape cancels: nothing changes, the line and preview go, onEnd says cancelled
  await page.click(tabSel(fruit));
  const before = JSON.stringify(await layout(page));
  const item3 = await center(page, '[data-item="Fruit 3"]');
  const vr = await center(page, '[data-item="Vegetable 1"]');
  await drag(page, item3, vr, { release: false });
  await page.waitForSelector(`[data-list="${veg}"] .demo-line`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-wb-ghost]') && !document.querySelector('.demo-line'));
  await page.mouse.up();
  check('Escape cancels a content drag: nothing changed', JSON.stringify(await layout(page)) === before);
  const ends = await evs(page, 'dragend');
  check('dragend: dropped, dropped, cancelled', ends.length === 3 && ends[0].d.dropped && ends[1].d.dropped && ends[2].d.cancelled, ends.map((e: any) => e.d.dropped));
  check('announced', (await page.textContent('.wb-sr')) === 'Cancelled');
  // auto-scroll: hold near the bottom edge of the Fruit list
  const list = await center(page, `[data-list="${fruit}"]`);
  const item4 = await center(page, '[data-item="Fruit 4"]');
  await drag(page, item4, { x: list.x, y: list.b.y + list.b.height - 10 }, { release: false });
  await page.waitForFunction((id: string) => document.querySelector(`[data-list="${id}"]`)!.scrollTop > 100, fruit);
  check('auto-scroll near the edge', true);
  await page.mouse.move(list.x, list.b.y - 4);    // over the strip: no scrolling, no target
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // spring-loading does not trigger for tab drags; a tab drag still works after content drags
  const t = await tabsOf(page, 0);
  const p0 = await center(page, tabSel(t[0])), pl = await center(page, tabSel(t.at(-1)));
  await drag(page, p0, { x: pl.b.x + pl.b.width - 3, y: pl.y });
  await page.waitForFunction((id: string) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[0].tabs.at(-1).id === id, t[0]);
  check('a tab drag still works unchanged', true);
  check('… and never reaches a view\'s drop targets', (await evs(page, 'dragstart')).length === 4);
  void lemma;
  await page.close();
});

// ── split resizing ──
group('resize: pointer, min size, keyboard, double-click, events', async () => {
  const page = await fresh();
  await events(page);
  const g1 = await groupEl(page, 0);
  const w0 = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  const sep = await center(page, '[role="separator"]');
  await page.mouse.move(sep.x, sep.y);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="separator"]')!, '::before').transform !== 'none');
  check('hovering a separator thickens its line', true);
  await page.mouse.down();
  await page.mouse.move(sep.x + 50, sep.y, { steps: 5 });
  await page.waitForFunction(() => (window as any).__ev.some((e: any) => e.k === 'resizestart'));
  check('resizestart fired', true);
  check('ctx.resizing true in visible tabs of the split', await page.evaluate(() => [...(window as any).demo.wb.hosts.values()].filter((h: any) => h.ctx.visible.peek()).every((h: any) => h.ctx.resizing.peek())));
  await page.mouse.move(sep.x + 100, sep.y, { steps: 5 });
  await page.waitForFunction(([g, w]: [string, number]) => document.querySelector(`[data-group="${g}"]`)!.getBoundingClientRect().width > w + 95, [g1, w0]);
  check('the group follows the pointer while dragging (before the commit)', (await evs(page, 'change')).length === 0);
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__ev.some((e: any) => e.k === 'resizeend'));
  const w1 = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  check('pointer resize: +100 px', Math.abs(w1 - w0 - 100) < 2, { w0, w1 });
  check('committed once, at the end', (await evs(page, 'change')).filter((e: any) => e.d === 'resize').length === 1);
  check('aria-valuenow follows', Number(await page.getAttribute('[role="separator"]', 'aria-valuenow')) === Math.round((w1 / 1280) * 100));
  check('resizing flags cleared', await page.evaluate(() => [...(window as any).demo.wb.hosts.values()].every((h: any) => !h.ctx.resizing.peek())));
  // min size
  const s2 = await center(page, '[role="separator"]');
  await drag(page, s2, { x: 5, y: s2.y });
  await page.waitForFunction(() => (window as any).__ev.filter((e: any) => e.k === 'resizeend').length === 2);
  const wmin = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  check('min size 120 px', Math.abs(wmin - 120) < 1.5, wmin);
  // keyboard
  await page.focus('[role="separator"]');
  await page.keyboard.press('ArrowRight');
  const wk = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  check('ArrowRight: +16 px', Math.abs(wk - wmin - 16) < 1.5, wk);
  await page.keyboard.press('Shift+ArrowRight');
  const wk2 = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  check('Shift+ArrowRight: +64 px', Math.abs(wk2 - wk - 64) < 1.5, wk2);
  await page.keyboard.press('End');
  const wend = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  check('End: the max (the other at its min)', Math.abs(wend - (1280 - 120)) < 1.5, wend);
  await page.keyboard.press('Enter');
  const weq = (await page.locator(`[data-group="${g1}"]`).boundingBox()).width;
  check('Enter equalises', Math.abs(weq - 640) < 1.5, weq);
  check('keyboard resizes send start/end pairs', (await evs(page, 'resizestart')).length === (await evs(page, 'resizeend')).length);
  await page.keyboard.press('ArrowLeft');
  const s3 = await center(page, '[role="separator"]');
  await page.mouse.dblclick(s3.x, s3.y);
  await page.waitForFunction((g: string) => Math.abs(document.querySelector(`[data-group="${g}"]`)!.getBoundingClientRect().width - 640) < 1.5, g1);
  check('double-click equalises', true);
  // Escape during a pointer resize restores
  const s4 = await center(page, '[role="separator"]');
  await drag(page, s4, { x: s4.x - 200, y: s4.y }, { release: false });
  await page.waitForFunction((g: string) => document.querySelector(`[data-group="${g}"]`)!.getBoundingClientRect().width < 500, g1);
  await page.keyboard.press('Escape');
  await page.waitForFunction((g: string) => Math.abs(document.querySelector(`[data-group="${g}"]`)!.getBoundingClientRect().width - 640) < 1.5, g1);
  await page.mouse.up();
  check('Escape cancels a pointer resize', true);
  // column split: vertical keys
  await page.evaluate(() => { const w = (window as any).demo.wb; const t = w.current.peek().tab.id; w.split(t, 'bottom'); });
  await page.waitForSelector('[role="separator"][aria-orientation="horizontal"]');
  await page.focus('[role="separator"][aria-orientation="horizontal"]');
  const v0 = await page.getAttribute('[role="separator"][aria-orientation="horizontal"]', 'aria-valuenow');
  await page.keyboard.press('ArrowDown');
  const v1 = await page.getAttribute('[role="separator"][aria-orientation="horizontal"]', 'aria-valuenow');
  check('a column split resizes with ↑ ↓', Number(v1) > Number(v0), { v0, v1 });
  await page.close();
});

// ── lifecycle: hidden tabs stay mounted and inert; views never remount on layout changes ──
group('lifecycle: kept alive, inert, scroll kept, no remount on move/split/maximise', async () => {
  for (const fallback of [false, true]) {
    const page = await fresh();
    if (fallback) await page.evaluate(() => { delete (Element.prototype as any).moveBefore; });
    const tag = fallback ? ' (without moveBefore)' : '';
    const [lemma, graphs, fruit] = await tabsOf(page, 0);
    await page.click(tabSel(lemma));
    await page.waitForSelector(`#${lemma}-panel .demo-doc`);
    await page.evaluate((id: string) => { document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop = 300; }, lemma);
    await page.click(tabSel(graphs));
    const hid = await page.evaluate((id: string) => { const p = document.getElementById(`${id}-panel`) as HTMLElement; return { there: !!p?.isConnected, inert: p?.inert, cls: p?.classList.contains('wb-panel--hidden'), cv: getComputedStyle(p).contentVisibility }; }, lemma);
    check(`a hidden document stays mounted, inert, not laid out${tag}`, hid.there && hid.inert && hid.cls && hid.cv === 'hidden', hid);
    const note = (await tabsOf(page, 1))[1];
    await page.click(tabSel(note));
    await page.waitForSelector(`#${note}-panel textarea`);
    await page.click(tabSel((await tabsOf(page, 1))[0]));
    await page.waitForFunction((id: string) => !document.getElementById(`${id}-panel`), note);
    check(`a view without keepAlive unmounts when hidden${tag}`, true);
    check(`the hidden panel cannot take focus${tag}`, await page.evaluate((id: string) => { const b = document.querySelector(`#${id}-panel .demo-doc`) as HTMLElement; b.tabIndex = 0; b.focus(); return !document.getElementById(`${id}-panel`)!.contains(document.activeElement); }, lemma));
    await page.click(tabSel(lemma));
    check(`the scroll offset is kept${tag}`, await page.evaluate((id: string) => document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop, lemma) === 300);
    // move lemma to group 2 by dragging, then split, then maximise: one mount, no unmount, scroll kept
    const target = await center(page, `[data-body="${await groupEl(page, 1)}"]`);
    await drag(page, await center(page, tabSel(lemma)), target);
    await page.waitForFunction((id: string) => (window as any).demo.M.groupOf((window as any).demo.wb.layout.peek(), id)?.id === (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[1].id, lemma);
    await page.waitForFunction((id: string) => !(document.getElementById(`${id}-panel`) as HTMLElement).inert, lemma);
    const s1 = await page.evaluate((id: string) => document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop, lemma);
    check(`moved to another group: scroll kept${tag}`, s1 === 300, s1);
    await page.evaluate((id: string) => (window as any).demo.wb.split(id, 'bottom'), lemma);
    await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 3);
    await page.evaluate(() => (window as any).demo.wb.maximize());
    await page.waitForSelector('.wb-group--max');
    await page.evaluate(() => (window as any).demo.wb.restore());
    await page.waitForFunction(() => !document.querySelector('.wb-group--max'));
    // the last tab of group 1 (fruit) moves away: group 1 collapses; fruit's host is parked and adopted
    await page.evaluate(([id]: string[]) => { const w = (window as any).demo.wb, M = (window as any).demo.M; for (const t of M.groups(w.layout.peek())[0].tabs.filter((x: any) => x.id !== id)) w.close(t.id); }, [fruit]);
    await page.evaluate((id: string) => document.querySelector(`#${id}-panel .demo-list`)!.scrollTop = 200, fruit);
    await page.evaluate((id: string) => { const w = (window as any).demo.wb, M = (window as any).demo.M; w.move(id, M.groups(w.layout.peek())[1].id, 0); }, fruit);
    await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 2);
    await page.evaluate((id: string) => (window as any).demo.wb.activate(id), fruit);
    await page.waitForFunction((id: string) => !(document.getElementById(`${id}-panel`) as HTMLElement).inert, fruit);
    const st = await page.evaluate(([l, f]: string[]) => ({ m: (window as any).demo.stats.mounts[l], u: (window as any).demo.stats.unmounts[l] ?? 0,
      s: document.querySelector(`#${l}-panel .demo-doc`)!.scrollTop, fs: document.querySelector(`#${f}-panel .demo-list`)!.scrollTop }), [lemma, fruit]);
    check(`no remount through move, split, maximise, restore, collapse${tag}`, st.m === 1 && st.u === 0, st);
    check(`scroll kept through all of it${tag}`, st.s === 300 && st.fs === 200, st);
    await page.close();
  }
});

// ── persistence ──
// ── a saved layout is a disposable preference: an old shape (round 5's two-slot side columns) or a broken save is dropped
//    quietly at creation and the workbench starts anew (wb.layoutDropped), never a throw ──
group('an old or broken saved layout: dropped quietly at creation (no throw, no page error), the workbench starts anew', async () => {
  const OLD = { root: { kind: 'group', id: 'dg1', tabs: [{ id: 'dt1', view: 'document', state: { doc: 'lemma' } }], active: 'dt1' }, active: 'dg1', maximized: null,
    sides: { left: { top: { panels: ['outline'], active: 'outline' }, bottom: { panels: ['problems'], active: 'problems' }, split: 0.5, collapsed: false, size: 256 },
      right: { top: { panels: [], active: null }, bottom: { panels: [], active: null }, split: 0.5, collapsed: true, size: 256 } } };
  for (const [name, saved] of [['the old two-slot side layout', JSON.stringify(OLD)], ['a broken save', '{"root": 3']] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    const errs: string[] = []; page.on('pageerror', (e: Error) => errs.push(e.message));
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.addInitScript((v: string) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('wb-demo-layout', v); sessionStorage.setItem('seeded', '1'); } } catch { /* */ } }, saved);
    await page.goto('http://wb.test/?sides=1&theme=light');
    await page.waitForSelector('.wb-tab', { state: 'attached' });
    const r = await page.evaluate(() => ({ dropped: (window as any).demo.wb.layoutDropped, tabs: document.querySelectorAll('[data-tab]').length, sides: !!document.querySelector('aside[data-side="left"] .wb-side-pane') }));
    check(`${name}: no throw, no page error; wb.layoutDropped; the demo's start layout instead (tabs and the side panels)`, errs.length === 0 && r.dropped === true && r.tabs > 1 && r.sides, { errs, r });
    await ctx.close();
  }
});

// ── a tab still opening must reach its width (one was seen to stay 24 px wide; not reproduced): random opens, closes and
//    activations at random intervals (some in the same frame, some mid-animation), then every strip's tabs equal (1/n) ──
group('tabs opening and closing in quick succession all reach their width: every strip\'s tabs equal and wider than their padding once settled; the bar, rows, no bar', async () => {
  for (const [query, w] of [['fresh&single&bar=1', 1500], ['fresh', 1400], ['fresh&single', 1400]] as const) for (const seed of [1, 4]) {
    const page = await fresh({ w, query });
    const r = await page.evaluate(async (seed: number) => {
      let x = seed * 9301; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const W = (window as any).demo.wb, M = (window as any).demo.M, docs = ['graphs', 'streams', 'konig', 'lemma'];
      for (let i = 0; i < 40; i++) {
        const tabs = M.allTabs(W.layout.peek()), a = rnd();
        if (a < 0.5 || tabs.length < 2) W.open({ view: 'document', state: { doc: docs[Math.floor(rnd() * 4)] } }, { activate: rnd() < 0.7 });
        else if (a < 0.8) W.close(tabs[Math.floor(rnd() * tabs.length)].id);
        else W.activate(tabs[Math.floor(rnd() * tabs.length)].id);
        await new Promise((r) => (rnd() < 0.5 ? requestAnimationFrame(r) : setTimeout(r, rnd() * 250)));     // (the input's own jitter: random gaps between the user's actions, not a wait for state)
      }
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [...document.querySelectorAll('.wb-tabs')].filter((s) => s.getBoundingClientRect().width > 0).map((s) => [...s.querySelectorAll('[data-tab]')].map((t) => +t.getBoundingClientRect().width.toFixed(1)));
    }, seed);
    check(`${query}, seed ${seed}: every strip's tabs equal (±1 px), none at its padding alone (> 30 px)`, r.length > 0 && r.every((ws: number[]) => !ws.length || (Math.max(...ws) - Math.min(...ws) <= 1 && Math.min(...ws) > 30)), r);
    await page.close();
  }
});

group('persistence round trip', async () => {
  const page = await fresh();
  await page.evaluate(() => { const w = (window as any).demo.wb; const t = w.current.peek().tab.id; w.pin(t); w.split(w.current.peek().group.tabs.at(-1).id, 'bottom'); w.resize(w.layout.peek().root.id, [2, 1]); });
  const j1 = await page.evaluate(() => (window as any).demo.wb.serialize());
  const d1 = await page.evaluate(() => [...document.querySelectorAll('.wb-tab')].map((t) => t.textContent + t.classList.contains('wb-tab--on')).join('|'));
  await page.goto('http://wb.test/?theme=light&sides=0');       // not ?fresh: the saved layout
  await page.waitForSelector('.wb-tab');
  const j2 = await page.evaluate(() => (window as any).demo.wb.serialize());
  const d2 = await page.evaluate(() => [...document.querySelectorAll('.wb-tab')].map((t) => t.textContent + t.classList.contains('wb-tab--on')).join('|'));
  check('a reload restores the layout exactly', j1 === j2);
  check('… and the same tabs show', d1 === d2);
  await page.evaluate(() => (window as any).demo.wb.load((window as any).demo.initial()));
  await page.waitForFunction(() => document.querySelectorAll('[role="tablist"]').length === 2);
  check('load() replaces the layout (the old views unmount)', await page.evaluate(() => (window as any).demo.wb.hosts.size) === 2);
  check('load() refuses a broken layout', await page.evaluate(() => { try { (window as any).demo.wb.load('{"v":1}'); return false; } catch { return true; } }));
  const ids = await page.evaluate(() => { const w = (window as any).demo.wb; const id = w.open({ view: 'home' }); return { id, all: (window as any).demo.M.allTabs(w.layout.peek()).map((t: any) => t.id) }; });
  check('ids continue after a load (no clash)', ids.all.filter((x: string) => x === ids.id).length === 1);
  await page.close();
});

// ── breadcrumbs, narrow tabs, home view ──
group('breadcrumbs, narrow tabs, home', async () => {
  // the breadcrumbs: the integrated view's header (one tab, no strip; beside tabs the tab names the document)
  const one = await fresh({ query: 'fresh&single' });
  const [lemma] = await tabsOf(one, 0);
  const cr = await one.evaluate((id: string) => {
    const nav = document.querySelector(`#${id}-panel .wb-crumbs nav`)!;
    const b = [...nav.querySelectorAll('button')];
    const home = nav.querySelector('.wb-crumb--home') as HTMLElement;
    return { n: b.length, label: nav.getAttribute('aria-label'), last: b.at(-1)!.getAttribute('aria-current'), name: home.getAttribute('aria-label'), title: home.title,
      shown: getComputedStyle(home.querySelector('.wb-crumb-label')!).display, icon: !!home.querySelector('svg') };
  }, lemma);
  check('the integrated view has a breadcrumbs bar: Documents / title / section', cr.n === 3 && cr.label === 'Breadcrumbs' && cr.last === 'page', cr);
  check('the home crumb: icon + label when wide; accessible name and tooltip "Documents"', cr.icon && cr.shown !== 'none' && cr.name === 'Documents' && cr.title === 'Documents', cr);
  await one.evaluate((id: string) => { document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop = 900; }, lemma);
  await one.waitForFunction((id: string) => !/Introduction/.test(document.querySelector(`#${id}-panel .wb-crumbs [aria-current="page"]`)!.textContent!), lemma);
  check('the section crumb follows the view (host data)', true);
  // narrow: the home crumb becomes its icon
  await one.setViewportSize({ width: 420, height: 800 });
  await one.waitForFunction((id: string) => getComputedStyle(document.querySelector(`#${id}-panel .wb-crumb--home .wb-crumb-label`)!).display === 'none', lemma);
  check('narrow: the home crumb is its icon; its name stays', await one.evaluate((id: string) => document.querySelector(`#${id}-panel .wb-crumb--home`)!.getAttribute('aria-label'), lemma) === 'Documents');
  await one.setViewportSize({ width: 1280, height: 800 });
  // the home crumb shows the home panel over its tab; a document opened there replaces that tab (the same tab)
  await one.click(`#${lemma}-panel .wb-crumb--home`);
  const gidL = await one.evaluate((id: string) => (window as any).demo.M.groupOf((window as any).demo.wb.layout.peek(), id).id, lemma);
  await one.waitForSelector(`[data-home="${gidL}"] [data-open-doc="streams"]`);
  await one.click(`[data-home="${gidL}"] [data-open-doc="streams"]`);
  await one.waitForFunction((id: string) => (window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id)?.state?.doc === 'streams', lemma);
  check('a document opened from the home panel replaces the active tab (same tab)', await one.evaluate((id: string) => !!document.querySelector(`#${id}-panel .demo-doc[data-doc="streams"]`), lemma));
  await one.close();
  // narrow the group: the tabs truncate (their real names), or show their icon
  const page = await fresh();
  const sep = await center(page, '[role="separator"]');
  await drag(page, sep, { x: 300, y: sep.y });
  await page.waitForFunction(() => document.querySelector('.wb-group')!.getBoundingClientRect().width < 320);
  await settled(page);
  const titles = await page.evaluate(() => [...document.querySelector('.wb-group')!.querySelectorAll('.wb-tab')].every((t) => !!(t as HTMLElement).title));
  const nl = (await narrowLook(page)).map((x: any) => ({ ...x, why: narrowBad(x) }));
  check('narrow: each tab its real name truncated (≥ 3 characters) or its icon; tooltips stay', nl.every((x: any) => !x.why) && titles, { nl: nl.filter((x: any) => x.why), titles });
  // the empty root group shows the home view
  await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M; for (const t of M.allTabs(w.layout.peek())) w.close(t.id); });
  await page.waitForSelector('.wb-home [data-open-doc]');
  check('no tabs: the home view fills the empty group', await page.evaluate(() => document.querySelectorAll('.wb-group').length === 1 && document.querySelectorAll('.wb-tab').length === 0));
  await page.click('.wb-home [data-open-doc="graphs"]');
  await page.waitForSelector('.wb-tab', { state: 'attached' });
  check('opening from it makes a tab (one tab: the integrated look)', await page.evaluate(() => (window as any).demo.wb.current.peek().tab.view === 'document' && document.querySelector('.wb-root--solo') != null));
  await page.evaluate(() => (window as any).demo.wb.open({ view: 'text', state: {} }));
  await page.click('.wb-home-btn:visible');
  await page.waitForSelector('.wb-home--over');
  check('the home toggle shows the home panel over the group (no home tab)', await page.evaluate(() => !(window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).some((t: any) => t.view === 'home')));
  await page.close();
});

// ── pin, preview, context menu ──
group('pin, preview tabs, context menu', async () => {
  const page = await fresh();
  const [a, b, c] = await tabsOf(page, 0);
  await page.click(tabSel(c), { button: 'right' });
  await page.waitForSelector('[role="menu"]');
  check('right click opens the tab menu', true);
  // no Pin item in the menu; pinning stays, by its key (Ctrl+K Shift+Enter)
  check('the tab menu has no Pin item', await page.evaluate(() => ![...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].some((x) => /^(Un)?pin\b/i.test(x.textContent?.trim() ?? ''))));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  await page.focus(stopSel(c));
  await chord(page, 'Shift+Enter');
  await page.waitForFunction((id: string) => !!(window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id)?.pinned, c);
  check('Pin (its key): first in the strip, with the pin glyph, named "…, pinned"', (await tabsOf(page, 0))[0] === c && (await page.getAttribute(stopSel(c), 'aria-label'))!.endsWith(', pinned'));
  await page.focus(stopSel(a));
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('[role="menu"]');
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="menu"]'));     // the kit moves the focus in an effect
  check('Shift+F10 opens it from the keyboard, focus in the menu', true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  check('Escape closes it; the focus goes back to the tab', await page.evaluate(() => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab')) === a);
  await page.focus(stopSel(a));
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('[role="menu"]');
  await page.click('[role="menu"] >> text=Close others');
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  check('Close others keeps the pinned tab', (await tabsOf(page, 0)).join() === [c, a].join(), await tabsOf(page, 0));
  await page.click(`${tabSel(c)} .wb-tab-close`);
  check('the pin glyph unpins', !(await page.evaluate((id: string) => (window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).pinned, c)));
  // preview tabs: italic, replaced by the next preview, kept by double-click
  const g2 = await groupEl(page, 1), homeBtn = `[data-strip-group="${g2}"] .wb-home-btn`, peek = `[data-home="${g2}"] [data-open="preview"]`;     // from the group's home panel
  await page.click(homeBtn);
  await page.click(peek);
  await page.waitForSelector('.wb-tab--preview');
  check('a preview tab is italic', await page.evaluate(() => getComputedStyle(document.querySelector('.wb-tab--preview .wb-tab-label')!).fontStyle) === 'italic');
  const p1 = await page.getAttribute('.wb-tab--preview', 'data-tab');
  await page.click(homeBtn);
  await page.click(peek);
  await page.waitForFunction((id: string) => !document.querySelector(`[data-tab="${id}"]`) && !!document.querySelector('.wb-tab--preview'), p1);
  check('the next preview replaces it', (await page.locator('.wb-tab--preview').count()) === 1);
  await page.dblclick('.wb-tab--preview');
  await page.waitForFunction(() => !document.querySelector('.wb-tab--preview'));
  check('double-click keeps it', true);
  void b;
  await page.close();
});

// ── performance: resizing with many kept-alive tabs ──
group('performance: no long tasks, no work in hidden tabs while resizing', async () => {
  // 60 more documents × 5 sections × 40 paragraphs in group 2, each shown once (so all are mounted and kept alive),
  // then a list on top. The control run (hidden panels laid out: content-visibility overridden) shows the test
  // can see the cost: it is reported, not checked (it depends on the machine).
  for (const control of [false, true]) {
    const page = await fresh();
    await events(page);
    if (control) await page.addStyleTag({ content: '.wb-panel--hidden { content-visibility: visible !important; }' });
    await page.evaluate(() => (window as any).demo.many(60, 40));
    await page.evaluate(async () => {
      const w = (window as any).demo.wb, M = (window as any).demo.M;
      const g = M.activeGroup(w.layout.peek());
      for (const t of g.tabs) { w.activate(t.id); await new Promise((r) => requestAnimationFrame(r)); }
      w.activate(g.tabs.find((t: any) => t.view === 'list').id);
    });
    await page.waitForFunction(() => (window as any).demo.wb.hosts.size >= 62);
    const s0 = await page.evaluate(() => {
      const w = window as any;
      w.__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
      const hidden = [...w.demo.wb.hosts.entries()].filter(([, h]: any) => !h.ctx.visible.peek()).map(([id]: any) => id);
      const sum = (o: any) => hidden.reduce((a: number, id: string) => a + (o[id] ?? 0), 0);
      w.__hidden = hidden;
      return { renders: sum(w.demo.stats.renders), sizes: sum(w.demo.stats.sizes), n: hidden.length };
    });
    const sep = await center(page, '[role="separator"]');
    await page.mouse.move(sep.x, sep.y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(sep.x - i * 12, sep.y);
    for (let i = 1; i <= 30; i++) await page.mouse.move(sep.x - 360 + i * 20, sep.y);
    await page.mouse.up();
    await page.waitForFunction(() => (window as any).__ev.some((e: any) => e.k === 'resizeend'));
    await page.focus('[role="separator"]');
    for (let i = 0; i < 20; i++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'Shift+ArrowRight');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const s1 = await page.evaluate(() => {
      const w = window as any, hidden = w.__hidden;
      const sum = (o: any) => hidden.reduce((a: number, id: string) => a + (o[id] ?? 0), 0);
      return { renders: sum(w.demo.stats.renders), sizes: sum(w.demo.stats.sizes), long: w.__long };
    });
    if (control) { console.log(`info control (hidden panels laid out): long tasks ` + JSON.stringify(s1.long)); await page.close(); continue; }
    check(`${s0.n} hidden documents kept alive`, s0.n >= 60, s0.n);
    check('no long task (> 50 ms) while resizing', s1.long.length === 0, s1.long);
    check('hidden tabs: zero renders while resizing', s1.renders === s0.renders, { s0, s1 });
    check('hidden tabs: zero size callbacks while resizing', s1.sizes === s0.sizes, { s0, s1 });
    await page.close();
  }
});

/** Is the keyboard's ring painted round `sel`'s box: on each of its four sides, a pixel of the focus colour within the
 *  ring's band (3 px in from the box's edge, at the side's middle)? The colour is --rfed-focus, resolved. */
