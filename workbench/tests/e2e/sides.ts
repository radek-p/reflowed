// The workbench's browser suite, area "sides": the side columns: stacks, docking, the splitter, opening and closing. Run by tests/e2e.ts (--area sides).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── sidebars: a left and a right column, a top and a bottom group each ──
/** A side column as text: its panel groups top to bottom (the DOM's), each its tabs' labels. */
const sideCol = (page: any, s: string) => page.evaluate((s: string) => [...document.querySelectorAll(`aside[data-side="${s}"] .wb-side-pane`)]
  .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((p) => [...p.querySelectorAll('[role="tab"]')].map((x) => x.textContent).join()).join(' | '), s);
/** The same from the model (the panel ids). */
const sideModel = (page: any, s: string) => page.evaluate((s: string) => { const d = (window as any).demo; return d.M.sideGroups(d.wb.sides.peek()[s]).map((g: any) => g.panels.join()).join(' | '); }, s);
const waitSide = (page: any, s: string, want: string) => page.waitForFunction(([s, want]: string[]) => { const d = (window as any).demo; return d.M.sideGroups(d.wb.sides.peek()[s]).map((g: any) => g.panels.join()).join(' | ') === want; }, [s, want]);
const stackSizes = (page: any, s: string) => page.evaluate((s: string) => { const r = (window as any).demo.wb.sides.peek()[s].root; return r.kind === 'split' ? r.sizes : [1]; }, s);

group('sidebars: a stack of panel groups per column, docking by strip and halves, the splitter, animated hide (fully gone), toggles, keys, persistence', async () => {
  const page = await fresh({ sides: true });
  await events(page);
  const S = () => page.evaluate(() => (window as any).demo.wb.sides.peek());
  const aria = await page.evaluate(() => [...document.querySelectorAll('aside.wb-side')].map((a) => ({ label: a.getAttribute('aria-label'),
    lists: [...a.querySelectorAll('[role="tablist"]')].map((l) => l.getAttribute('aria-label')),
    visible: [...a.querySelectorAll('.wb-panel')].filter((x) => !(x as HTMLElement).inert).map((x) => document.getElementById(x.getAttribute('aria-labelledby')!)?.textContent),
    seps: [...a.querySelectorAll('[role="separator"]')].map((s) => s.getAttribute('aria-orientation')) })));
  check('the left column: two stacked groups (Outline, Problems | Files), each with its tabs above it',
    aria[0].label === 'Left sidebar' && aria[0].lists.join('|') === 'Left sidebar, panels|Left sidebar, panels' && await sideCol(page, 'left') === 'Outline,Problems | Files'
    && aria[0].visible.join() === 'Outline,Files' && aria[0].seps.join() === 'horizontal,vertical', aria);
  check('the right column: one group, no splitter', await sideCol(page, 'right') === 'References' && aria[1].seps.join() === 'vertical', aria[1]);
  const [lemma, graphs] = await tabsOf(page, 0);
  await page.click(tabSel(graphs));
  await page.waitForSelector('[data-outline="graphs"]');
  check('the outline follows the active tab', true);
  // the splitter between the groups (the document groups' Separator): pointer, keys, double-click
  const SEP = 'aside[data-side="left"] .wb-side-groups > .wb-sep';
  const sp = await center(page, SEP);
  await drag(page, sp, { x: sp.x, y: sp.y + 100 });
  await page.waitForFunction(() => (window as any).demo.wb.sides.peek().left.root.sizes[0] > 0.6);
  const hTop = await page.evaluate(() => document.querySelector('aside[data-side="left"] .wb-side-pane')!.getBoundingClientRect().height);
  check('dragging the splitter gives the top group more height (kept in the layout)', hTop > 400, { hTop, sizes: (await S()).left.root.sizes });
  await page.focus(SEP);
  const s0 = (await S()).left.root.sizes[0];
  await page.keyboard.press('ArrowUp');
  check('↑ moves it up', (await S()).left.root.sizes[0] < s0);
  await page.mouse.dblclick(sp.x, (await center(page, SEP)).y);
  await page.waitForFunction(() => Math.abs((window as any).demo.wb.sides.peek().left.root.sizes[0] - 0.5) < 1e-6);
  check('double-click: equal shares', true);
  // docking by drag (with previews) and by the menu
  const ref = await center(page, '[data-ptab="references"]');
  await drag(page, await center(page, '[data-ptab="problems"]'), { x: ref.b.x + 3, y: ref.y }, { release: false });
  await page.waitForSelector('aside[data-side="right"] .wb-insert');
  check('an insertion bar in the strip of the right column; with both columns open, no edge indicator', await page.locator('[data-edge-half]').count() === 0);
  await page.mouse.up();
  await waitSide(page, 'right', 'problems,references');
  check('into the right column\'s group, by its strip', true);
  // the window splits in halves: just right of its middle is the right column; low: its group's lower half
  const R0 = await page.evaluate(() => { const r = document.querySelector('.wb-root')!.getBoundingClientRect(); return { mid: r.left + r.width / 2, top: r.top, h: r.height }; });
  await drag(page, await center(page, '[data-ptab="problems"]'), { x: R0.mid + 6, y: R0.top + R0.h * 0.8 }, { release: false });
  await page.waitForSelector('aside[data-side="right"] .wb-zone[data-zone="side-bottom"]');
  check('just right of the middle, low: the lower half of the right column\'s group is previewed', await page.locator('.wb-zone').count() === 1);
  await page.mouse.up();
  await waitSide(page, 'right', 'references | problems');
  check('… and dropped there: a new group below it', await sideCol(page, 'right') === 'References | Problems');
  const files = await center(page, '[data-ptab="files"]');
  await drag(page, await center(page, '[data-ptab="problems"]'), { x: files.b.x + files.b.width - 2, y: files.y });
  await waitSide(page, 'left', 'outline | files,problems');
  check('into the left bottom group by its strip; the emptied right group collapses', await sideCol(page, 'right') === 'References' && await page.locator('aside[data-side="right"] .wb-side-groups > .wb-sep').count() === 0);
  // an item drag ends as a content drag does: wb-dropped (no hover tint under the released pointer) until the pointer moves
  const look = () => page.evaluate(() => [...document.documentElement.classList].filter((c) => /^wb-(dragging|dropped)$/.test(c)).join(' '));
  check('after an item drag: wb-dropped, not wb-dragging', await look() === 'wb-dropped', await look());
  await page.mouse.move(files.x + 1, files.y + 1);
  check('… and gone once the pointer moves', await look() === '', await look());
  await page.click('[data-ptab="files"]', { button: 'right' });
  const items = await page.locator('[role="menu"] .wb-menu-item').allTextContents();
  check('the menu: to the other side, a new group below, hide', items.some((x: any) => /Move to the right side/.test(x)) && items.some((x: any) => /new group below/.test(x)) && items.some((x: any) => /Hide the left/.test(x)), items);
  await page.click('[role="menu"] >> text=Move to the right side');
  await waitSide(page, 'right', 'references,files');
  check('to the right side by the menu (into its top group)', true);
  // just left of the middle, high: the left column's top group, its upper half; just right: the right column's
  await drag(page, await center(page, '[data-ptab="files"]'), { x: R0.mid - 6, y: R0.top + R0.h * 0.1 }, { release: false });
  await page.waitForSelector('aside[data-side="left"] .wb-side-pane[data-top="true"] .wb-zone[data-zone="side-top"]');
  await page.mouse.up();
  await waitSide(page, 'left', 'files | outline | problems');
  check('just left of the middle, high: a new group at the left column\'s top (three stacked)', await sideCol(page, 'left') === 'Files | Outline | Problems');
  await drag(page, await center(page, '[data-ptab="files"]'), { x: R0.mid + 6, y: R0.top + R0.h * 0.1 });
  await waitSide(page, 'right', 'files | references');
  check('just right of the middle, high: a new group at the right column\'s top', true);
  await page.evaluate(() => { const w = (window as any).demo.wb; w.movePanel('files', 'left', null, null); w.showPanel('outline'); });
  await waitSide(page, 'left', 'outline,files | problems');
  // hiding: animated, fully gone, the groups laid out once; the strip toggle and the keys bring it back
  const mainW = () => page.evaluate(() => Math.round(document.querySelector('.wb-main')!.getBoundingClientRect().width));
  const w0 = await mainW();
  await page.evaluate(() => {
    const w = window as any; w.__long = []; w.__widths = new Set();
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
    const tick = () => { const art = document.querySelector('.wb-groups .wb-panel:not(.wb-panel--hidden) article'); w.__widths.add(art ? Math.round(art.getBoundingClientRect().width) : -1); if (w.__sampling) requestAnimationFrame(tick); };
    w.__sampling = true; requestAnimationFrame(tick);
  });
  const before = (await evs(page, 'resizeend')).length;
  await page.click('aside[data-side="left"] [data-action="collapse"]');
  await page.waitForSelector('aside[data-side="left"].wb-side--sliding');
  check('hiding animates the column' + 's room', true);
  await page.waitForFunction((n: number) => (window as any).__ev.filter((e: any) => e.k === 'resizeend').length > n, before);
  const gone = await page.evaluate(() => { const a = document.querySelector('aside[data-side="left"]') as HTMLElement; const s = getComputedStyle(a);
    (window as any).__sampling = false; return { vis: s.visibility, pos: s.position, inert: a.inert, rail: document.querySelectorAll('.wb-rail, [data-rail]').length, widths: [...(window as any).__widths], long: (window as any).__long }; });
  const w1 = await mainW();
  check('hidden means fully gone: no rail, no room, not reachable', gone.vis === 'hidden' && gone.pos === 'absolute' && gone.inert && gone.rail === 0 && w1 > w0 + 200, { gone, w0, w1 });
  check('the document keeps its lines during the motion (its width pinned; laid out at the end), no long task', gone.widths.length <= 2 && gone.long.length === 0, gone);
  const ev = (await page.evaluate(() => (window as any).__ev.filter((e: any) => e.k.startsWith('resize')).slice(-2).map((e: any) => e.k + ':' + e.d.how)));
  check('resizestart and resizeend around the slide', ev.join() === 'resizestart:hide,resizeend:hide', ev);
  await page.click('[data-action="show-left"]');
  await page.waitForFunction(() => !(window as any).demo.wb.sides.peek().left.collapsed && !document.querySelector('.wb-side--sliding'));
  check('the show button at the start of the strip brings it back', Math.abs((await mainW()) - w0) < 2);
  await page.keyboard.press('Control+\\');
  await page.waitForFunction(() => (window as any).demo.wb.sides.peek().left.collapsed);
  await page.keyboard.press('Control+\\');
  await page.waitForFunction(() => !(window as any).demo.wb.sides.peek().left.collapsed);
  check('Ctrl+\\ (the app sidebar key) hides and shows the left', true);
  await page.keyboard.press('Control+Shift+\\');
  await page.waitForFunction(() => (window as any).demo.wb.sides.peek().right.collapsed && !document.querySelector('.wb-side--sliding'));
  check('Ctrl+Shift+\\ hides the right; its show button sits at the end of the strip', await page.locator('[data-action="show-right"]').count() === 1);
  await page.click('[data-action="show-right"]');
  await page.waitForFunction(() => !(window as any).demo.wb.sides.peek().right.collapsed);
  await page.keyboard.press('Control+b');
  await page.waitForFunction(() => (window as any).demo.wb.sides.peek().left.collapsed);
  await page.keyboard.press('Control+Alt+b');
  await page.waitForFunction(() => (window as any).demo.wb.sides.peek().right.collapsed);
  check('Ctrl+B and Ctrl+Alt+B (VS Code) too', true);
  // a hidden column: its edge zone appears (only its), and a drop there is a new group at that end of the column
  await page.keyboard.press('Control+b');
  await page.waitForFunction(() => !(window as any).demo.wb.sides.peek().left.collapsed && !document.querySelector('.wb-side--sliding'));
  await drag(page, await center(page, '[data-ptab="problems"]'), { x: R0.mid + 40, y: R0.top + R0.h * 0.8 }, { release: false });
  await page.waitForSelector('.wb-edge--right [data-edge-half="bottom"].is-over');
  check('with the right column hidden, only its edge zone shows', await page.locator('.wb-edge').count() === 1 && await page.locator('.wb-edge--left').count() === 0);
  await page.mouse.up();
  await page.waitForFunction(() => !(window as any).demo.wb.sides.peek().right.collapsed && !document.querySelector('.wb-side--sliding'));
  check('an edge zone docks a new group at the column\'s bottom and shows the hidden column', await sideModel(page, 'right') === 'references | problems', await sideModel(page, 'right'));
  // F6, Escape on a panel drag, a tab drag never reaches a sidebar
  await page.focus('#side-outline-panel');
  await page.keyboard.press('F6');
  await page.waitForFunction(() => !!document.activeElement?.closest('[data-group]'));
  check('F6 goes from the left column to the first group', true);
  const L1 = JSON.stringify(await layout(page));
  await drag(page, await center(page, '[data-ptab="outline"]'), await center(page, '[data-ptab="references"]'), { release: false });
  await page.waitForFunction(() => !!document.querySelector('aside .wb-insert'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('aside .wb-insert, aside .wb-zone') && !document.querySelector('[data-wb-ghost]'));
  await page.mouse.up();
  check('Escape cancels a panel drag', JSON.stringify(await layout(page)) === L1);
  await page.click(tabSel(lemma));
  const L2 = JSON.stringify(await layout(page));
  await drag(page, await center(page, tabSel(lemma)), await center(page, 'aside[data-side="right"] [data-pbody]'), { release: false });
  check('a tab over a sidebar: no zone', await page.evaluate(() => !document.querySelector('.wb-zone, .wb-insert, .wb-edge')));
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('[data-wb-ghost]'));
  check('… and no change', JSON.stringify(await layout(page)) === L2);
  // persistence
  const j = await page.evaluate(() => (window as any).demo.wb.serialize());
  await page.goto('http://wb.test/?theme=light');
  await page.waitForSelector('aside.wb-side');
  check('a reload restores both columns, their stacks and sizes', await page.evaluate(() => (window as any).demo.wb.serialize()) === j);
  await page.close();
});

group('side stacks: three and more groups by drag, the middle one split, the half and strip hints, no side by side, into a group, collapse, splitter sizes (DPR 1 and 2), round trip', async () => {
  const page = await fresh({ sides: true, h: 900 });
  await events(page);
  await page.evaluate(() => { const w = (window as any).demo.wb; w.on('paneldrop', (d: any) => (window as any).__ev.push({ k: 'paneldrop', d })); });
  // the hint while held over a body point: [fx, fy] of the group's body (fractions)
  const body = async (s: string, i: number) => (await page.locator(`aside[data-side="${s}"] [data-pbody]`).nth(i).boundingBox());
  const at = (b: any, fx: number, fy: number) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
  const zones = () => page.evaluate(() => [...document.querySelectorAll('aside .wb-zone')].map((z) => `${z.closest('[data-pgroup]')?.getAttribute('data-pgroup')}:${z.getAttribute('data-zone')}`));
  const hint = () => page.evaluate(() => (window as any).demo.wb.pdnd.peek());
  // three stacked groups by drag: Problems below Files (the lower half of the bottom group)
  await drag(page, await center(page, '[data-ptab="problems"]'), at(await body('left', 1), 0.5, 0.8), { release: false });
  const h1 = await hint();
  const z1 = await zones();
  check('over a group\'s lower half: its lower half previewed (a split hint), nothing else', h1.where === 'bottom' && h1.index == null && z1.length === 1 && /side-bottom$/.test(z1[0]), { h1, z1 });
  await page.mouse.up();
  await waitSide(page, 'left', 'outline | files | problems');
  check('three stacked groups', await sideCol(page, 'left') === 'Outline | Files | Problems' && await page.locator('aside[data-side="left"] .wb-side-groups > .wb-sep').count() === 2);
  // a fourth: References from the right column onto the upper half of the middle group (splitting the middle one)
  await drag(page, await center(page, '[data-ptab="references"]'), at(await body('left', 1), 0.5, 0.2), { release: false });
  check('over the middle group\'s upper half: its upper half previewed', (await zones()).length === 1 && /side-top$/.test((await zones())[0]), await zones());
  await page.mouse.up();
  await waitSide(page, 'left', 'outline | references | files | problems');
  check('the middle group split: the new group above it; the emptied right column takes no room', await sideCol(page, 'left') === 'Outline | References | Files | Problems'
    && await page.evaluate(() => !document.querySelector('aside[data-side="right"]')), await sideCol(page, 'left'));
  check('the sizes: the split group\'s share halved, the stack flat', JSON.stringify((await stackSizes(page, 'left')).map((x: number) => +x.toFixed(4))) === JSON.stringify([0.5, 0.125, 0.125, 0.25]), await stackSizes(page, 'left'));
  // no vertical split: the left and right quarters of a body still offer only the halves
  for (const [fx, fy] of [[0.05, 0.3], [0.95, 0.3], [0.05, 0.7], [0.95, 0.7]]) {
    await drag(page, await center(page, '[data-ptab="outline"]'), at(await body('left', 3), fx, fy), { release: false });
    const h = await hint(), z = await zones();
    check(`at (${fx}, ${fy}) of a body: ${fy < 0.5 ? 'the upper' : 'the lower'} half, no side-by-side zone`, h.where === (fy < 0.5 ? 'top' : 'bottom') && z.length === 1 && !/left|right|center/.test(z[0]), { h, z });
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForFunction(() => !(window as any).demo.wb.pdnd.peek());
  }
  // the strip: an insertion bar at the index (the shared insertX), then a move into that group
  const pb = await center(page, '[data-ptab="problems"]');
  await drag(page, await center(page, '[data-ptab="files"]'), { x: pb.b.x + 2, y: pb.y }, { release: false });
  const ins = await page.evaluate(() => { const h = (window as any).demo.wb.pdnd.peek(), bar = document.querySelector('aside .wb-insert'); const p = document.querySelector('[data-ptab="problems"]')!.getBoundingClientRect();
    return { h, bar: bar ? bar.getBoundingClientRect().left + bar.getBoundingClientRect().width / 2 : null, in: bar?.closest('[data-pgroup]')?.contains(document.querySelector('[data-ptab="problems"]')), p: p.left }; });
  check('over a group\'s strip: the insertion bar in that strip, before the tab (index 0), no body zone', ins.h.index === 0 && ins.in && ins.bar != null && ins.bar <= ins.p + 1 && (await zones()).length === 0, ins);
  await page.mouse.up();
  await waitSide(page, 'left', 'outline | references | files,problems');
  check('moved into the existing group; its emptied group collapsed (its share to the neighbours)', await sideCol(page, 'left') === 'Outline | References | Files,Problems'
    && Math.abs((await stackSizes(page, 'left')).reduce((a: number, b: number) => a + b, 0) - 1) < 1e-9, await stackSizes(page, 'left'));
  // a drop that changes nothing: no commit, no remount
  await page.evaluate(() => { (window as any).__keep = document.querySelector('#side-files-panel'); });
  const L0 = await page.evaluate(() => (window as any).demo.wb.serialize());
  const drops = (await evs(page, 'paneldrop')).length;
  await drag(page, await center(page, '[data-ptab="references"]'), at(await body('left', 1), 0.5, 0.3), { release: false });
  const own = await zones();
  await page.mouse.up();
  await page.waitForFunction((n: number) => (window as any).__ev.filter((e: any) => e.k === 'paneldrop').length > n, drops);
  check('a panel dropped on its own lone group\'s half: offered (the zone shown), and a no-op (the layout unchanged, the panels kept)', own.length === 1 && await page.evaluate(() => (window as any).demo.wb.serialize()) === L0
    && await page.evaluate(() => (window as any).__ev.filter((e: any) => e.k === 'paneldrop').at(-1).d.noop && document.querySelector('#side-files-panel') === (window as any).__keep));
  // an empty group collapses: move References back right
  const before = await page.evaluate(() => [...document.querySelectorAll('aside[data-side="left"] .wb-side-pane')].map((p) => p.getBoundingClientRect().height));
  await page.evaluate(() => (window as any).demo.wb.movePanel('references', 'right'));
  await waitSide(page, 'left', 'outline | files,problems');
  const after = await page.evaluate(() => [...document.querySelectorAll('aside[data-side="left"] .wb-side-pane')].map((p) => p.getBoundingClientRect().height));
  check('an emptied group collapses: its height goes to its neighbours', after.length === 2 && Math.abs(after.reduce((a: any, b: any) => a + b, 0) - before.reduce((a: any, b: any) => a + b, 0)) <= 1 && after.every((h: any, i: any) => h > [before[0], before[2]][i]), { before, after });
  // the splitter: pointer drag, keys (16 px, Shift 64), Home/End to the min, Enter equal; snapped boundary, line centred on it
  const SEP = 'aside[data-side="left"] .wb-side-groups > .wb-sep';
  const geo = () => page.evaluate((SEP: string) => { const s = document.querySelector(SEP)!, c = getComputedStyle(s, '::before'), r = s.getBoundingClientRect();
    const up = document.getElementById(s.getAttribute('aria-controls')!)!.getBoundingClientRect(), low = up.bottom;
    const area = document.querySelector('aside[data-side="left"] .wb-side-groups')!.getBoundingClientRect();
    return { line: r.top + parseFloat(c.top) + parseFloat(c.height) / 2, b: up.bottom - area.top, low, h: up.height, area: area.height, lowTop: [...document.querySelectorAll('aside[data-side="left"] .wb-side-pane')][1].getBoundingClientRect().top }; }, SEP);
  const g0 = await geo();
  const sp = await center(page, SEP);
  const ends = (await evs(page, 'resizeend')).length;
  await drag(page, sp, { x: sp.x, y: sp.y + 57.3 });
  await page.waitForFunction((n: number) => (window as any).__ev.filter((e: any) => e.k === 'resizeend').length > n, ends);
  const g1 = await geo();
  check('a pointer drag moves the boundary by the distance (±1)', Math.abs(g1.h - g0.h - 57.3) <= 1, { g0, g1 });
  const end = (await evs(page, 'resizeend')).at(-1).d;
  check('the stack\'s resizeend carries the split\'s new sizes (two shares)', Array.isArray(end.sizes) && end.sizes.length === 2 && end.sizes.every((x: number) => x > 0), end);
  await page.focus(SEP);
  await page.keyboard.press('ArrowDown'); const g2 = await geo();
  await page.keyboard.press('Shift+ArrowUp'); const g3 = await geo();
  check('↓ 16 px, Shift+↑ 64 px (±1)', Math.abs(g2.h - g1.h - 16) <= 1 && Math.abs(g2.h - g3.h - 64) <= 1, { g1: g1.h, g2: g2.h, g3: g3.h });
  await page.keyboard.press('Home'); const gh = await geo();
  check('Home: the upper group at its least height (80 px)', Math.abs(gh.h - 80) <= 1, gh.h);
  await page.keyboard.press('Enter'); const ge = await geo();
  check('Enter: equal shares', Math.abs(ge.h - ge.area / 2) <= 1, ge);
  await page.keyboard.press('End');
  await page.mouse.dblclick(sp.x, (await center(page, SEP)).y);
  await page.waitForFunction(() => Math.abs((window as any).demo.wb.sides.peek().left.root.sizes[0] - 0.5) < 1e-6);
  check('double-click: equal shares', true);
  await page.close();
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 803 }, deviceScaleFactor: dpr });
    const p2 = await ctx.newPage();
    await p2.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await p2.goto('http://wb.test/?fresh&bar=0&theme=light');
    await p2.waitForSelector('aside .wb-side-pane');
    // three groups with odd shares: boundaries off the pixel grid unless snapped
    await p2.evaluate(() => { const w = (window as any).demo.wb; w.splitPanel('problems', 'left', null, 'bottom'); const r = w.sides.peek().left.root; w.resize(r.id, [1.13, 0.71, 0.97]); });
    await p2.waitForFunction(() => document.querySelectorAll('aside[data-side="left"] .wb-side-groups > .wb-sep').length === 2);
    const m = await p2.evaluate(() => [...document.querySelectorAll('aside[data-side="left"] .wb-side-groups > .wb-sep')].map((s) => {
      const c = getComputedStyle(s, '::before'), r = s.getBoundingClientRect(), up = document.getElementById(s.getAttribute('aria-controls')!)!.getBoundingClientRect();
      const panes = [...document.querySelectorAll('aside[data-side="left"] .wb-side-pane')].map((p) => p.getBoundingClientRect());
      const low = panes.find((p) => Math.abs(p.top - up.bottom) < 2)!;
      return { boundary: up.bottom, lowTop: low.top, centre: r.top + parseFloat(c.top) + 0.5 }; }));
    // at DPR 1 the line is the whole pixel [b, b + 1) (centre b + 0.5); from DPR 2 it is centred exactly on b (--wb-hair)
    check(`DPR ${dpr}: the stack's boundaries on whole pixels, the groups meeting exactly, the line centred on the boundary (within 0.5 px)`,
      m.every((x: any) => Number.isInteger(x.boundary) && x.lowTop === x.boundary && Math.abs(x.centre - x.boundary) <= 0.5), m);
    // persistence round trip: serialize, reload, the same structure
    const j = await p2.evaluate(() => (window as any).demo.wb.serialize());
    await p2.goto('http://wb.test/?bar=0&theme=light');
    await p2.waitForSelector('aside .wb-side-pane');
    check(`DPR ${dpr}: a reload restores the stack (groups, panels, active panels, sizes)`, await p2.evaluate(() => (window as any).demo.wb.serialize()) === j
      && await sideCol(p2, 'left') === 'Outline | Files | Problems');
    await ctx.close();
  }
});

// ── a column opening and closing: its room, the main area's edge and the top bar move together; the bar's slot ──
group('side open/close: the main area and the top bar follow the column' + "'" + 's edge every frame; the bar slot shrinks and grows; chevron close; no long task; reduced motion instant', async () => {
  const page = await fresh({ sides: true, w: 1400, query: 'fresh&single&bar=1' });
  await settled(page);
  const run = (side: string) => page.evaluate(async (side: string) => {
    const w = window as any; w.__long = []; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); }); po.observe({ type: 'longtask' });
    const out: any[] = [];
    const snap = () => { const a = document.querySelector(`aside[data-side="${side}"]`)!.getBoundingClientRect(), m = document.querySelector('.wb-main')!.getBoundingClientRect(), b = document.querySelector('.wb-bar')!.getBoundingClientRect(),
      s = document.querySelector(`.wb-bar-slot--${side}`)!.getBoundingClientRect();
      return { col: side === 'left' ? a.right : a.left, main: side === 'left' ? m.left : m.right, bar: side === 'left' ? b.left : b.right, slot: +s.width.toFixed(1), sliding: !!document.querySelector('.wb-side--sliding') }; };
    out.push(snap());
    w.demo.wb.toggleSide(side);
    for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); out.push(snap()); if (i > 3 && !out.at(-1).sliding && !document.getAnimations().length) break; }
    po.disconnect();
    return { out, long: w.__long };
  }, side);
  for (const side of ['left', 'right']) {
    if (side === 'right') { await page.evaluate(() => (window as any).demo.wb.collapseSide('right', false)); await settled(page); }
    for (const how of ['close', 'open']) {
      const r = await run(side);
      const fr = r.out, mid = fr.filter((f: any) => f.sliding);
      const together = mid.every((f: any) => Math.abs(f.main - f.col) <= 2) && fr.every((f: any) => Math.abs(f.bar - f.main) <= 2);
      const dir = side === 'left' ? (how === 'close' ? -1 : 1) : (how === 'close' ? 1 : -1);
      const mono = fr.every((f: any, i: number) => i === 0 || (f.main - fr[i - 1].main) * dir >= -0.5);
      const steps = new Set(fr.map((f: any) => Math.round(f.main))).size;
      check(`${side}, ${how}: the main area' + "'" + 's and the top bar' + "'" + 's edge follow the column' + "'" + 's edge (≤ 2 px) every frame, moving one way, in steps (no jump)`, together && mono && (steps >= 4 || BROWSER === 'webkit') && mid.length >= 1, { steps, frames: fr.map((f: any) => [Math.round(f.col), Math.round(f.main), Math.round(f.bar)].join('/')).join(' ') });
      const slots = fr.map((f: any) => f.slot);
      const slotOk = how === 'close' ? slots[0] === 0 && slots.at(-1) === 32 && slots.every((s: number, i: number) => i === 0 || s >= slots[i - 1] - 0.5) : slots[0] === 32 && slots.at(-1) === 0 && slots.every((s: number, i: number) => i === 0 || s <= slots[i - 1] + 0.5);
      check(`${side}, ${how}: the bar' + "'" + 's open-button slot ${how === 'close' ? 'grows from 0 to 32 px' : 'shrinks to 0'}`, slotOk, slots);
      check(`${side}, ${how}: no long task`, r.long.length === 0, r.long);
      await settled(page);
    }
    const btn = await page.evaluate((side: string) => { const b = document.querySelector(`aside[data-side="${side}"] .wb-side-hide`)!; return { label: b.getAttribute('aria-label'), icon: b.querySelector('svg')!.getAttribute('data-icon') }; }, side);
    check(`${side}: the close button is a chevron toward the outer edge, named "Hide ${side} panel"`, btn.label === `Hide ${side} panel` && btn.icon === (side === 'left' ? 'chevronLeft' : 'chevronRight'), btn);
  }
  await page.close();
  // reduced motion: instant
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 600 }, reducedMotion: 'reduce' });
  const p2 = await ctx.newPage();
  await p2.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await p2.goto('http://wb.test/?fresh&single&bar=1&theme=light');
  await p2.waitForSelector('.wb-bar');
  await settled(p2);
  const rm = await p2.evaluate(async () => { (window as any).demo.wb.toggleSide('left'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { main: document.querySelector('.wb-main')!.getBoundingClientRect().left, slot: document.querySelector('.wb-bar-slot--left')!.getBoundingClientRect().width, anims: document.getAnimations().filter((a: any) => a.playState === 'running').length }; });
  check('reduced motion: closing is instant (the main area at the edge, the slot at 32 px, nothing running, two frames later)', rm.main === 0 && rm.slot === 32 && rm.anims === 0, rm);
  await ctx.close();
});

// ── a closable panel (panel.onClose): the close on its own tab and Close in its menu call it (the host takes the panel
//    away: unregisters its type); registered again, it comes back where it was; a panel with a default width (panel.width)
//    gives its column that width ──
group('closable panel: the close on its tab and in its menu, back where it was; a panel\'s default width', async () => {
  const page = await fresh({ sides: true, w: 1500 });
  await settled(page);
  const add = () => page.evaluate(() => { const w = window as any, d = w.demo;
    w.__offTool = d.wb.registerView({ id: 'tool', title: () => 'Tool', icon: 'settings', panel: { side: 'right', width: { share: 1 / 3, min: 380, max: 560 }, onClose: () => w.__offTool() }, Component: () => null });
    d.wb.showPanel('tool'); });
  await add();
  await waitSide(page, 'right', 'references,tool');
  await page.waitForSelector('[data-ptab="tool"] [data-action="close-panel"]');
  const t = await page.evaluate(() => ({ inTab: document.querySelectorAll('[data-ptab="tool"] [data-action="close-panel"]').length, others: document.querySelectorAll('[data-ptab]:not([data-ptab="tool"]) [data-action="close-panel"]').length,
    w: Math.round(document.querySelector('aside[data-side="right"]')!.getBoundingClientRect().width), area: Math.round(document.querySelector('.wb-root')!.getBoundingClientRect().width) }));
  check('its close is on its own tab (one), no other panel has one', t.inTab === 1 && t.others === 0, t);
  check('its column takes its default width: a third of the window within its bounds', Math.abs(t.w - Math.max(380, Math.min(560, t.area / 3))) <= 2, t);
  await page.click('[data-ptab="tool"] [data-action="close-panel"]');
  await waitSide(page, 'right', 'references');
  check('the close on its tab closes it (its type gone, out of the column)', await page.evaluate(() => !(window as any).demo.wb.viewType('tool')));
  await add();
  await waitSide(page, 'right', 'references,tool');
  check('registered again: back where it was', true);
  await page.click('[data-ptab="tool"]', { button: 'right' });
  await page.waitForSelector('[role="menu"][aria-label="Panel actions"] [data-item="close-panel"]');
  await page.click('[role="menu"][aria-label="Panel actions"] [data-item="close-panel"]');
  await waitSide(page, 'right', 'references');
  check('its tab\'s menu has Close; it closes it', true);
  await page.close();
});
