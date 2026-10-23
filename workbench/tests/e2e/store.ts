// The workbench's browser suite, area "store": the store and its container: two workbenches on a page, observers, the ticker, dispose, the view context, idle. Run by tests/e2e.ts (--area store).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── the demo's own toolbar (?bar=0): its key hints name real actions (a hint for an action the keymap lacks read "null") ──
group('demo toolbar: every key hint is a binding', async () => {
  const page = await fresh();
  const hint = await page.evaluate(() => document.querySelector('[data-demo="chord"]')?.textContent ?? '');
  check('the hints: close, reopen, split, maximise, each with its keys; no "null"', !/null/.test(hint) && /close/.test(hint) && /maximise/.test(hint) && hint.split(' · ').length === 4, hint);
  await page.close();
});

// ── two workbenches on one page: each store reaches only its own container (no page-wide lookups, no fields the UI
//    writes on the store); the same ids in both (one idPrefix) must not cross ──
group('two workbenches on one page: the focus, the home toggle and the keymap' + "'" + 's menus stay in their own container (the same ids in both)', async () => {
  const page = await fresh();
  const r = await page.evaluate(async () => {
    const D = (window as any).demo, { createWorkbench, Workbench, html, render, registerDemoViews } = D.lib;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:420px;width:900px;height:360px';
    document.body.append(host);
    const wb2 = createWorkbench({ idPrefix: 'd', layout: D.wb.serialize() });     // the same layout: the same tab ids
    registerDemoViews(wb2, { panels: false });
    render(html`<${Workbench} wb=${wb2} label="Second" />`, host);
    const frame = () => new Promise((f) => requestAnimationFrame(() => f(null)));
    await frame(); await frame();
    const g2 = D.M.activeGroup(wb2.layout.peek()), t2 = g2.tabs[0].id;
    const r1 = D.wb.root(), r2 = wb2.root();
    wb2.activate(t2, { focus: 'tab' });
    await frame(); await frame();
    const focusIn2 = r2.contains(document.activeElement) && !r1.contains(document.activeElement);
    wb2.toggleHome(g2.id, true);
    await frame(); await frame();
    const homeIn2 = r2.contains(document.activeElement) && !!r2.querySelector('[data-home-over]') && !r1.querySelector('[data-home-over]');
    wb2.toggleHome(g2.id, false);
    await frame();
    const docTab = D.M.allTabs(wb2.layout.peek()).find((t: any) => t.view === 'document');
    wb2.activate(docTab.id, { focus: 'tab' });
    await frame(); await frame();
    const opened = wb2.run('sectionMenu') !== false;
    await frame();
    const pop = document.querySelector('.wb-select-pop');
    const popRect = pop?.getBoundingClientRect(), r2Rect = r2.getBoundingClientRect();
    const menuBy2 = !!pop && popRect!.top >= r2Rect.top;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const sameIds = !!r1.querySelector(`[data-tab="${t2}"]`) && !!r2.querySelector(`[data-tab="${t2}"]`);
    render(null, host); host.remove();
    return { focusIn2, homeIn2, opened, menuBy2, sameIds, detached: wb2.root() === null };
  });
  check('both containers have a tab with the same id', r.sameIds, r);
  check('the second store focuses its own tab and its own home panel, never the first' + "'" + 's', r.focusIn2 && r.homeIn2, r);
  check('its section menu (Ctrl+K S) opens on its own tab', r.opened && r.menuBy2, r);
  check('unmounted, the container is detached (the store keeps running without it)', r.detached, r);
  await page.close();
});

// ── layout changes re-render the strips and the bar; none of them makes a new observer or font callback, and the
//    strip rows are decided from the layout (no read of every strip per render) ──
group('re-renders create no observers: 40 layout changes (states, activations, a resize) with the window bar and two groups', async () => {
  const page = await fresh({ query: 'fresh&bar=1' });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const r = await page.evaluate(async () => {
    const W = (window as any).demo.wb, M = (window as any).demo.M, RO = window.ResizeObserver;
    let made = 0, ready = 0;
    (window as any).ResizeObserver = class extends RO { constructor(f: ResizeObserverCallback) { super(f); made++; } };
    const fonts = document.fonts, then0 = fonts.ready.then.bind(fonts.ready);
    (fonts.ready as any).then = (...a: any[]) => { ready++; return then0(...a); };
    const frame = () => new Promise((f) => requestAnimationFrame(() => f(null)));
    const gs = M.groups(W.layout.peek());
    for (let i = 0; i < 20; i++) { const t = gs[i % 2].tabs[0]; W.setState(t.id, { n: i }); await frame(); }
    for (let i = 0; i < 18; i++) { W.activate(gs[i % 2].tabs[i % gs[i % 2].tabs.length].id); await frame(); }
    const s = W.layout.peek().root; W.resize(s.id, [0.6, 0.4]); await frame(); W.resize(s.id, [0.5, 0.5]); await frame();
    (window as any).ResizeObserver = RO;
    return { made, ready, groups: gs.length };
  });
  check('two groups, a window bar', r.groups === 2, r);
  check('no ResizeObserver and no fonts.ready callback made by 40 re-renders (one observer per element, made once)', r.made === 0 && r.ready === 0, r);
  await page.close();
});

// ── the status's ticker is the store's: each workbench moves its own fills from its own documents' progress ──
group('status: two workbenches typeset the same document at different steps: each fill shows its own store\'s progress; the ticker stops when nothing typesets', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await page.goto('http://wb.test/?fresh&scenario=paper&sides=0&bar=0&theme=light');
  await page.waitForSelector('.wb-tab');
  const r = await page.evaluate(async () => {
    const D = (window as any).demo, { createWorkbench, Workbench, html, render, registerDemoViews } = D.lib;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:420px;width:1400px;height:360px';
    document.body.append(host);
    const wb2 = createWorkbench({ idPrefix: 'd', layout: D.wb.serialize() });
    registerDemoViews(wb2, { panels: false });
    render(html`<${Workbench} wb=${wb2} label="Second" />`, host);
    const frame = () => new Promise((f) => requestAnimationFrame(() => f(null)));
    D.wb.setDocStatus('konig', { typesetting: { done: 2, total: 10 } });
    wb2.setDocStatus('konig', { typesetting: { done: 8, total: 10 } });
    for (let i = 0; i < 6; i++) await frame();
    const scale = (root: Element) => [...root.querySelectorAll('.wb-status-fill[data-run]')].map((e) => +new DOMMatrix(getComputedStyle(e).transform).a.toFixed(3));
    const a = scale(D.wb.root()), b = scale(wb2.root()), running = [D.wb.ticker.running, wb2.ticker.running];
    D.wb.setDocStatus('konig', {}); wb2.setDocStatus('konig', {});
    for (let i = 0; i < 3; i++) await frame();
    const stopped = [D.wb.ticker.running, wb2.ticker.running];
    render(null, host); host.remove();
    return { a, b, running, stopped };
  });
  const near = (xs: number[], v: number) => xs.length > 0 && xs.every((x) => Math.abs(x - v) < 0.002);
  check('the first workbench\'s fills at 2 of 10 (0.93 × 0.2), the second\'s at 8 of 10 (0.93 × 0.8)', near(r.a, 0.186) && near(r.b, 0.744), r);
  check('each ticker runs while its document typesets, and stops after', r.running.every(Boolean) && r.stopped.every((x: boolean) => !x), r);
  await ctx.close();
});

// ── wb.dispose() releases what a store holds: its hosts and their Preact roots, its observer, a pending chord's
//    listener, its timers and ticker; nothing of it is left on the page ──
group('dispose: a workbench with 10 tabs, a pending chord, a success fill running and a typesetting document, unmounted and disposed: no host, observer, listener or timer left', async () => {
  const page = await fresh();
  const r = await page.evaluate(async () => {
    const D = (window as any).demo, { createWorkbench, Workbench, html, render, registerDemoViews } = D.lib;
    const RO = window.ResizeObserver, made: { off: boolean }[] = [];
    (window as any).ResizeObserver = class extends RO { rec = { off: false }; constructor(f: ResizeObserverCallback) { super(f); made.push(this.rec); } override disconnect() { this.rec.off = true; super.disconnect(); } };
    const add = window.addEventListener, rem = window.removeEventListener; let keys = 0;
    window.addEventListener = function (this: Window, t: string, f: any, o?: any) { if (t === 'keydown') keys++; return add.call(this, t, f, o); } as any;
    window.removeEventListener = function (this: Window, t: string, f: any, o?: any) { if (t === 'keydown') keys--; return rem.call(this, t, f, o); } as any;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:420px;width:900px;height:360px';
    document.body.append(host);
    const wb2 = createWorkbench({ idPrefix: 'x' });
    registerDemoViews(wb2, { panels: false });
    render(html`<${Workbench} wb=${wb2} label="Second" />`, host);
    const frame = () => new Promise((f) => requestAnimationFrame(() => f(null)));
    for (let i = 0; i < 10; i++) { wb2.open({ view: 'document', state: { doc: ['lemma', 'graphs', 'streams'][i % 3] } }); await frame(); }     // each shown once: kept alive
    wb2.setDocStatus('lemma', { typesetting: { done: 3, total: 9 } });
    wb2.setDocStatus('graphs', { typesetting: true }); wb2.setDocStatus('graphs', {});     // a success fill (a timer)
    await frame();
    const tab = wb2.root().querySelector('[role="tab"]');
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));     // Ctrl+K: a chord pending
    const before = { hosts: wb2.hosts.size, keys, chord: wb2.chord.value, ticking: wb2.ticker.running, observers: made.length };
    render(null, host); host.remove();
    wb2.dispose();
    await frame(); await frame();
    const after = { hosts: wb2.hosts.size, keys, open: made.filter((m) => !m.off).length, ticking: wb2.ticker.running, root: wb2.root(), panels: document.querySelectorAll('[data-panel^="x"]').length, disposed: wb2.disposed };
    (window as any).ResizeObserver = RO; window.addEventListener = add; window.removeEventListener = rem;
    return { before, after };
  });
  check('before: 10 hosts kept alive (documents), a chord pending, the ticker running, observers made', r.before.hosts >= 10 && r.before.keys === 1 && !!r.before.chord && r.before.ticking && r.before.observers > 0, r.before);
  check('after: no host, no element of it in the page, every observer disconnected, the chord listener removed, the ticker stopped, detached', r.after.hosts === 0 && r.after.panels === 0 && r.after.open === 0 && r.after.keys === 0 && !r.after.ticking && r.after.root === null && r.after.disposed, r.after);
  await page.close();
});

// ── one view context: a tab, a side panel and the home panel get the same members; what a container cannot do is
//    a capability (ctx.can), and home's "open beside" is open(spec, { beside: true }) ──
group('one view context: the same members for a tab, a side panel and home; capabilities per container; home opens in place or beside', async () => {
  const page = await fresh({ sides: true });
  const r = await page.evaluate(async () => {
    const W = (window as any).demo.wb, M = (window as any).demo.M, frame = () => new Promise((f) => requestAnimationFrame(() => f(null)));
    const g = M.activeGroup(W.layout.peek()), tabCtx = W.hosts.get(g.active).ctx;
    const panelCtx = [...W.hosts.values()].find((h: any) => h.panel).ctx;
    const homeOver = W.homeContext(g.id, g.active), homeEmpty = W.homeContext(g.id, null);
    const keys = (c: any) => Object.keys(c).sort().join();
    const n0 = g.tabs.length;
    W.toggleHome(g.id, true); await frame();
    homeOver.open({ view: 'document', state: { doc: 'streams' } }, { beside: true }); await frame();
    const g1 = M.findNode(W.layout.peek(), g.id);
    return { same: keys(tabCtx) === keys(panelCtx) && keys(panelCtx) === keys(homeOver) && keys(homeOver) === keys(homeEmpty), keys: keys(tabCtx),
      kinds: [tabCtx.kind, panelCtx.kind, homeOver.kind], can: [tabCtx.can, panelCtx.can, homeOver.can, homeEmpty.can],
      ids: [tabCtx.viewId === g.active, panelCtx.viewId.startsWith('side-'), homeOver.viewId === `home:${g.id}`],
      beside: { added: g1.tabs.length === n0 + 1, homeClosed: !W.homeIn.peek().has(g.id), kept: g1.tabs.some((t: any) => t.id === g.active) } };
  });
  check('every container gives the same members', r.same, r.keys);
  check('kinds and ids: the tab\'s id, side-<panel>, home:<group>', r.kinds.join() === 'tab,panel,home' && r.ids.every(Boolean), r);
  const c = (o: any) => `${+o.keep}${+o.replace}${+o.close}${+o.openBeside}`;
  check('capabilities: a tab all; a panel closes (its column) but keeps or replaces nothing; home over a tab replaces and closes; home of an empty group neither closes nor keeps', r.can.map(c).join() === '1111,0011,0111,0101', r.can);
  check('home: open beside adds a tab next to the one it is over (kept) and closes', r.beside.added && r.beside.homeClosed && r.beside.kept, r.beside);
  await page.close();
});

// ── wb.idle(): at rest means no running animation, no pending focus, no tracked timer (the name's switcher) ──
group('idle: resolves after the tab FLIP of an open, after the name switcher\'s wait (the menu then open), and at once when nothing moves', async () => {
  const page = await fresh({ query: 'fresh&single&bar=1' });
  await idle(page);
  const r = await page.evaluate(async () => {
    const W = (window as any).demo.wb, running = () => document.getAnimations().filter((a) => a.playState === 'running').length;
    W.open({ view: 'document', state: { doc: 'graphs' } });
    await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(() => f(null))));
    const during = running();
    await W.idle();
    const after = running(), t0 = performance.now();
    await W.idle();
    return { during, after, quick: performance.now() - t0 < 200 };
  });
  check('an open moves the tabs; idle returns once they rest; again at once', r.during > 0 && r.after === 0 && r.quick, r);
  await page.click('.wb-tab.wb-tab--on [data-name]');     // the focused group's active tab: its switcher waits NAME_WAIT
  const before = await page.locator('[role="grid"]').count();
  await idle(page);
  check('the name\'s switcher: not open at once (the double-click wait), open once idle', before === 0 && await page.locator('[role="grid"]').count() === 1, { before });
  await page.close();
});

// ── the home toggle focuses its group through the model (model.ts focusGroup): another group's maximised view ends ──
group('the home toggle in another group focuses that group and ends a maximised group', async () => {
  const page = await fresh();
  const r = await page.evaluate(async () => {
    const D = (window as any).demo, W = D.wb, M = D.M;
    if (M.groups(W.layout.peek()).length < 2) W.split(M.activeGroup(W.layout.peek()).active, 'right');
    await W.idle();
    const [a, b] = M.groups(W.layout.peek()).filter((g: any) => g.tabs.length);
    W.focusGroup(a.id, { focus: false }); W.maximize(a.id);
    const was = W.layout.peek().maximized;
    W.toggleHome(b.id, true);
    await W.idle();
    const l = W.layout.peek();
    return { was, a: a.id, b: b.id, active: l.active, maximized: l.maximized, home: W.isHome(b.id) };
  });
  check('home in the other group: that group active, no group maximised, its home shown', r.was === r.a && r.active === r.b && r.maximized === null && r.home, r);
  await page.close();
});

// ── one key table: a host's rows (the editor's commands) before the workbench's, chosen by their when clause on the
//    context keys the views set (wb.setContext); a host command runs through the host ──
group('one key table: a host row runs its command while its when clause holds, the workbench\'s key otherwise; a chord row too', async () => {
  const page = await fresh();
  const r = await page.evaluate(async () => {
    const D = (window as any).demo, { createWorkbench, Workbench, html, render, registerDemoViews } = D.lib;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:420px;width:1200px;height:360px';
    document.body.append(host);
    const ran: string[] = [];
    const wb2 = createWorkbench({ idPrefix: 'k', platform: 'linux', layout: D.wb.serialize(),
      keys: [{ key: 'ctrl+b', command: 'editor.bold', when: 'reflowed.field' }, { key: 'ctrl+k ctrl+t', command: 'editor.typesetAll' }],
      commands: { run: (c: string) => { ran.push(c); } } });
    registerDemoViews(wb2, { panels: true });
    render(html`<${Workbench} wb=${wb2} label="Second" />`, host);
    const frame = () => new Promise((f) => requestAnimationFrame(() => f(null)));
    await frame(); await frame();
    const press = (code: string, key: string) => wb2.root().querySelector('[role="tab"]').dispatchEvent(new KeyboardEvent('keydown', { code, key, ctrlKey: true, bubbles: true, cancelable: true }));
    const left = () => wb2.sides.peek().left.collapsed;
    const l0 = left();
    wb2.setContext('reflowed.field', true);
    press('KeyB', 'b'); await frame();
    const inField = { ran: [...ran], left: left() };
    wb2.setContext('reflowed.field', false);
    press('KeyB', 'b'); await frame();
    const outside = { ran: [...ran], left: left() };
    press('KeyK', 'k'); press('KeyT', 't'); await frame();
    const chord = [...ran];
    const shown = [wb2.shortcut('editor.bold'), wb2.shortcut('editor.typesetAll'), wb2.shortcut('close'), wb2.shortcut('editor.none')];
    render(null, host); host.remove(); wb2.dispose();
    return { l0, inField, outside, chord, shown, table: wb2.keyRows.slice(0, 2).map((x: any) => x.command) };
  });
  check('the host\'s rows first in the table', r.table.join() === 'editor.bold,editor.typesetAll', r.table);
  check('in a field (reflowed.field): Ctrl+B is the editor\'s bold; the sidebar stays', r.inField.ran.join() === 'editor.bold' && r.inField.left === r.l0, r);
  check('elsewhere: Ctrl+B toggles the left sidebar (the workbench\'s row)', r.outside.ran.join() === 'editor.bold' && r.outside.left !== r.l0, r);
  check('a host chord (Ctrl+K Ctrl+T) runs the host\'s command', r.chord.join() === 'editor.bold,editor.typesetAll', r.chord);
  check('shortcut() labels a host row as a workbench action (one row table): Ctrl+B, Ctrl+K Ctrl+T, Ctrl+Alt+W; none for a command without a row', JSON.stringify(r.shown) === JSON.stringify(['Ctrl+B', 'Ctrl+K Ctrl+T', 'Ctrl+Alt+W', null]), r.shown);
  await page.close();
});
