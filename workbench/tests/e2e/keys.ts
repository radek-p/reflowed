// The workbench's browser suite, area "keys": ARIA, the strip's keys, the keymap, chords, the focus rings and the recorded focus order. Run by tests/e2e.ts (--area keys).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── ARIA ──
group('aria', async () => {
  const page = await fresh();
  const r = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('[role="tablist"]')];
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    return {
      lists: lists.length, listLabels: lists.map((l) => l.getAttribute('aria-label')),
      everyTabAStop: tabs.every((t) => t.getAttribute('tabindex') === '0'),
      emptyTabs: tabs.every((t) => !t.childNodes.length && !!t.getAttribute('aria-label')),
      selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
      controls: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').every((t) => {
        const p = document.getElementById(t.getAttribute('aria-controls')!);
        return p?.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === t.id;
      }),
      visiblePanels: panels.filter((p) => !(p as HTMLElement).inert).length,
      closeHidden: [...document.querySelectorAll('.wb-tab:not(.wb-tab--on) .wb-tab-close')].every((c) => c.getAttribute('aria-hidden') === 'true' && !c.matches('button, [tabindex]')),
      closeActive: [...document.querySelectorAll('.wb-tab--on .wb-tab-close')].map((c) => `${c.getAttribute('role')}|${c.getAttribute('tabindex')}|${c.getAttribute('aria-label')}`),
      sep: [...document.querySelectorAll('[role="separator"]')].map((s) => ({ o: s.getAttribute('aria-orientation'), v: s.getAttribute('aria-valuenow'),
        min: s.getAttribute('aria-valuemin'), max: s.getAttribute('aria-valuemax'), label: s.getAttribute('aria-label'), c: !!document.getElementById(s.getAttribute('aria-controls')!), tab: (s as HTMLElement).tabIndex })),
      live: document.querySelector('.wb-sr')?.getAttribute('aria-live'),
      root: document.querySelector('.wb-root')?.getAttribute('aria-label'),
    };
  });
  check('two tablists labelled Group 1 and Group 2', r.lists === 2 && r.listLabels.join() === 'Group 1,Group 2', r.listLabels);
  check('every tab is a Tab stop (no roving tabindex: the DOM order is the order)', r.everyTabAStop);
  check('a tab element is empty and named (aria-label): its controls are its siblings, not presentational children', r.emptyTabs);
  check('one selected tab per group', r.selected === 2, r.selected);
  check('aria-controls → tabpanel, aria-labelledby ← tab', r.controls);
  check('two panels not inert (the visible ones)', r.visiblePanels === 2, r.visiblePanels);
  check('an inactive tab\'s × is aria-hidden and not focusable', r.closeHidden);
  check('the active tab\'s × is a named button and a Tab stop', r.closeActive.length === 2 && r.closeActive.every((c: string) => /^button\|0\|Close /.test(c)), r.closeActive);
  check('separator: vertical, value 50, 0–100, labelled, controls a group, focusable', r.sep.length === 1 && r.sep[0].o === 'vertical' && r.sep[0].v === '50'
    && r.sep[0].min === '0' && r.sep[0].max === '100' && r.sep[0].label === 'Resize groups' && r.sep[0].c && r.sep[0].tab === 0, r.sep);
  check('a polite live region', r.live === 'polite');
  check('the root is labelled', r.root === 'Demo workbench', r.root);
  await page.close();
});

// ── tabs: click, close, keyboard in the strip ──
group('tabs and strip keyboard', async () => {
  const page = await fresh();
  const [a, b, c] = await tabsOf(page, 0);
  await page.click(tabSel(a));
  check('click activates', await page.getAttribute(stopSel(a), 'aria-selected') === 'true');
  check('click focuses the content', await page.evaluate((id: string) => document.getElementById(`${id}-panel`)!.contains(document.activeElement), a));
  await page.focus(stopSel(a));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, b);
  check('ArrowRight moves focus and activates', await page.getAttribute(stopSel(b), 'aria-selected') === 'true');
  await page.keyboard.press('End');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, c);
  check('End: last tab', true);
  await page.keyboard.press('Home');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, a);
  check('Home: first tab', true);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, c);
  check('ArrowLeft wraps', true);
  await page.keyboard.press('Delete');
  await page.waitForFunction((id: string) => !document.querySelector(`[data-tab="${id}"]`), c);
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab');
  check('Delete closes; the focus stays in the strip on the new active tab', await page.evaluate(() => document.activeElement?.getAttribute('aria-selected')) === 'true');
  // middle click closes
  await page.click(tabSel(b), { button: 'middle' });
  await page.waitForFunction((id: string) => !document.querySelector(`[data-tab="${id}"]`), b);
  check('middle click closes', true);
  // the close button
  await page.hover(tabSel(a));
  await page.click(`${tabSel(a)} .wb-tab-close`);
  await page.waitForFunction(() => document.querySelectorAll('[role="tablist"]').length === 1);
  check('closing the last tab of a group collapses it', (await layout(page)).root.kind === 'group');
  await page.close();
});

// ── workbench keys ──
group('keyboard (Linux bindings; README.md has the table): groups, chords, tabs, moving, close/reopen, new, maximise', async () => {
  const page = await fresh();
  const W = '(window as any).demo';
  const groupsN = () => page.evaluate(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length);
  const cur = () => page.evaluate(() => (window as any).demo.wb.current.peek());
  const inGroup = (g: string) => page.waitForFunction((g: string) => (window as any).demo.wb.layout.peek().active === g && document.querySelector(`[data-group="${g}"]`)!.contains(document.activeElement), g);
  const g1 = await groupEl(page, 0), g2 = await groupEl(page, 1);
  await page.click(`[data-group="${g2}"] .wb-tab.wb-tab--on`);
  await page.keyboard.press('Control+1'); await inGroup(g1);
  check('Ctrl+1 focuses group 1 (its content)', true);
  await page.keyboard.press('Control+2'); await inGroup(g2);
  check('Ctrl+2 focuses group 2', true);
  await page.keyboard.press('Control+k');
  await page.waitForFunction(() => /waiting for the second key/.test(document.querySelector('[data-demo="chord"]')!.textContent!));
  check('Ctrl+K arms a chord (shown and announced)', /Ctrl\+K was pressed/.test(await page.textContent('.wb-sr') ?? ''));
  await page.keyboard.press('Control+ArrowLeft'); await inGroup(g1);
  check('Ctrl+K Ctrl+← focuses the group on the left', true);
  await page.keyboard.press('Control+k'); await page.keyboard.press('q');
  check('a chord with an unknown second key cancels and does nothing', await activeId(page) === g1 && !/waiting/.test(await page.textContent('[data-demo="chord"]') ?? ''));
  await page.keyboard.press('Control+k'); await page.keyboard.press('Control+ArrowRight'); await inGroup(g2);
  check('Ctrl+K Ctrl+→ focuses the group on the right', true);
  const t2 = await tabsOf(page, 1);
  await page.click(tabSel(t2[0]));
  await page.keyboard.press('Control+Alt+PageDown');
  await page.waitForFunction((id: string) => (window as any).demo.wb.current.peek().tab.id === id, t2[1]);
  check('Ctrl+Alt+PageDown: next tab', true);
  await page.keyboard.press('Control+Alt+PageUp');
  await page.waitForFunction((id: string) => (window as any).demo.wb.current.peek().tab.id === id, t2[0]);
  check('Ctrl+Alt+PageUp: previous tab', true);
  await page.keyboard.press('Control+Shift+PageDown');
  check('Ctrl+Shift+PageDown moves the tab right', (await tabsOf(page, 1)).join() === [t2[1], t2[0], ...t2.slice(2)].join(), await tabsOf(page, 1));
  await page.keyboard.press('Control+Shift+PageUp');
  check('Ctrl+Shift+PageUp moves it back', (await tabsOf(page, 1)).join() === t2.join());
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await page.waitForFunction((id: string) => (window as any).demo.M.groupOf((window as any).demo.wb.layout.peek(), id)?.id === (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[0].id, t2[0]);
  check('Ctrl+Alt+← moves the tab to the group on the left; it stays active and focused', await page.evaluate((id: string) => document.getElementById(`${id}-panel`)!.contains(document.activeElement) && (window as any).demo.wb.current.peek().tab.id === id, t2[0]));
  await page.keyboard.press('Control+Alt+ArrowDown');
  await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 3);
  check('Ctrl+Alt+↓ with no group below splits downwards', (await layout(page)).root.children[0].dir === 'column');
  await page.keyboard.press('Control+Alt+w');
  await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 2);
  check('Ctrl+Alt+W closes the tab (its group collapses)', true);
  check('… the focus goes to the group that became active', await page.evaluate(() => { const a = (window as any).demo.wb.layout.peek().active; return document.querySelector(`[data-group="${a}"]`)!.contains(document.activeElement); }));
  await page.keyboard.press('Control+Alt+Shift+T');
  await page.waitForFunction((id: string) => !!document.querySelector(`[data-tab="${id}"]`), t2[0]);
  check('Ctrl+Alt+Shift+T reopens it', true);
  await page.keyboard.press('Control+k'); await page.keyboard.press('n');
  await page.waitForFunction(() => !!document.querySelector(`[data-home="${(window as any).demo.wb.layout.peek().active}"]`));
  check('Ctrl+K N shows the home panel of the focused group (no home tab)', (await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).filter((t: any) => t.view === 'home').length)) === 0);
  await page.keyboard.press('Control+k'); await page.keyboard.press('n');
  await page.waitForFunction(() => !document.querySelector('.wb-home--over'));
  check('… and again hides it; the focus back on the active tab', await page.waitForFunction(() => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === (window as any).demo.wb.current.peek().tab.id, null, { timeout: 2000 }).then(() => true, () => false));
  await page.keyboard.press('Control+k'); await page.keyboard.press('Shift+Enter');
  check('Ctrl+K Shift+Enter pins it', !!(await cur()).tab.pinned);
  await page.keyboard.press('Control+k'); await page.keyboard.press('Shift+Enter');
  check('… and again unpins', !(await cur()).tab.pinned);
  await page.keyboard.press('Control+k'); await page.keyboard.press('Control+m');
  await page.waitForFunction(() => !!(window as any).demo.wb.layout.peek().maximized);
  check('Ctrl+K Ctrl+M maximises: other groups are off and inert', await page.evaluate(() => [...document.querySelectorAll('.wb-group--off')].every((g) => (g as HTMLElement).inert) && document.querySelectorAll('.wb-group--off').length === 1));
  await page.keyboard.press('Control+k'); await page.keyboard.press('Control+m');
  await page.waitForFunction(() => !(window as any).demo.wb.layout.peek().maximized);
  check('… again restores', true);
  const n0 = await groupsN();
  await page.keyboard.press('Control+k'); await page.keyboard.press('Control+\\');
  await page.waitForFunction((n: number) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === n + 1, n0);
  check('Ctrl+K Ctrl+\\ splits to the right (Ctrl+\\ is the app sidebar key)', true);
  await page.keyboard.press('Control+k'); await page.keyboard.press('Control+Shift+\\');
  await page.waitForFunction((n: number) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === n + 2, n0);
  check('Ctrl+K Ctrl+Shift+\\ splits downwards', true);
  const n1 = (await cur()).group.tabs.length;
  await page.keyboard.press('Control+k'); await page.keyboard.press('w');
  await page.waitForFunction((n: number) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === n + 1, n0);
  check('Ctrl+K W closes the tabs of the group (it collapses)', n1 >= 1);
  // keys the browser keeps are not taken; keys that type Polish letters do nothing
  const L0 = JSON.stringify(await layout(page));
  for (const k of ['Alt+w', 'Alt+t', 'Alt+m', 'Control+Alt+a', 'Control+Alt+n', 'Control+Alt+s', 'Control+Alt+z']) await page.keyboard.press(k);
  check('Alt+letter and AltGr letters (ą ń ś ż) do nothing', JSON.stringify(await layout(page)) === L0);
  check('the menu shows the keys of this platform', await page.evaluate(() => (window as any).demo.wb.shortcut('close')) === 'Ctrl+Alt+W');
  void W;
  await page.close();
});

// ── split = the same document in both groups (VS Code), a drag to an edge moves ──
// ── a chord's second key is the keymap's from any focus: a capture listener while a chord is pending ──
group('chords from every focus: Ctrl+K Ctrl+← / → focus the neighbouring group from a splitter, a tab, a chip, the view, a menu; the splitter does not move; Ctrl+← alone on a splitter still moves it', async () => {
  const page = await fresh();
  const gs = await page.evaluate(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).map((g: any) => g.id));
  const sizes = () => page.evaluate(() => JSON.stringify((window as any).demo.wb.layout.peek().root.sizes));
  const s0 = await sizes();
  const from: [string, () => Promise<void>][] = [
    ['the splitter', () => page.focus('[role="separator"]')],
    ['a tab', async () => { const t = (await tabsOf(page, 0))[0]; await page.focus(stopSel(t)); }],
    ['the active tab\'s × (a control)', () => page.focus('.wb-group .wb-tab--on .wb-tab-close[role="button"]')],
    ['the view', () => page.evaluate(() => (document.querySelector('.wb-panel:not(.wb-panel--hidden)') as HTMLElement).focus())],
  ];
  for (const [name, go] of from) {
    await page.evaluate((id: string) => (window as any).demo.wb.focusGroup(id, { focus: false }), gs[1]);
    await go();
    await chord(page, 'Control+ArrowLeft');
    const left = await activeId(page);
    await go();
    await chord(page, 'Control+ArrowRight');
    const right = await activeId(page);
    check(`from ${name}: Ctrl+K Ctrl+← focuses the left group, Ctrl+K Ctrl+→ the right one; the splitter unmoved; no chord left pending`, left === gs[0] && right === gs[1] && (await sizes()) === s0 && !(await page.evaluate(() => (window as any).demo.wb.chord.peek())), { left, right, sizes: await sizes(), s0 });
  }
  // a menu (the tab menu, outside the root: the host routes its keys)
  await page.evaluate((id: string) => (window as any).demo.wb.focusGroup(id, { focus: false }), gs[1]);
  await page.click('.wb-group .wb-tab', { button: 'right' });
  await page.waitForSelector('[role="menu"]');
  await chord(page, 'Control+ArrowLeft');
  check('from an open menu: Ctrl+K Ctrl+← focuses the left group', (await activeId(page)) === gs[0], await activeId(page));
  await page.keyboard.press('Escape');
  // a chord's second key that runs nothing (no group to the left) is still the keymap's: the splitter does not move
  await page.focus('[role="separator"]');
  await chord(page, 'Control+ArrowUp');
  check('a second key that applies to nothing (Ctrl+K Ctrl+↑, no group above) is swallowed: the splitter unmoved', (await sizes()) === s0, await sizes());
  await page.keyboard.press('Control+ArrowLeft');
  check('Ctrl+← alone on a focused splitter still moves it', (await sizes()) !== s0, await sizes());
  await page.close();
});

group('split opens the same document in both groups', async () => {
  const page = await fresh();
  const [lemma] = await tabsOf(page, 0);
  await page.click(tabSel(lemma));
  await page.evaluate((id: string) => { document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop = 400; }, lemma);
  const n0 = (await layout(page)).root.children.length;
  await page.keyboard.press('Control+k'); await page.keyboard.press('Control+\\');
  await page.waitForFunction((n: number) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === n + 1, n0);
  const r = await page.evaluate((id: string) => {
    const w = (window as any).demo.wb, M = (window as any).demo.M, L = w.layout.peek();
    const copy = w.current.peek().tab;
    return { copy: copy.id, view: copy.view, doc: copy.state.doc, still: !!M.findTab(L, id), grp: M.groupOf(L, id).id !== M.groupOf(L, copy.id).id,
      hosts: [id, copy.id].map((t) => !!document.querySelector(`#${t}-panel .demo-doc`)) };
  }, lemma);
  check('Ctrl+\\ keeps the tab and opens the same document in a new group', r.still && r.grp && r.view === 'document' && r.doc === 'lemma', r);
  check('two views, two hosts', r.hosts.every(Boolean), r.hosts);
  const a0 = await page.evaluate((id: string) => document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop, lemma);
  await page.evaluate((id: string) => { document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop = 1200; }, r.copy);
  await page.waitForFunction((id: string) => (window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).state.section, r.copy);
  const st = await page.evaluate(([a, b]: string[]) => ({ a: document.querySelector(`#${a}-panel .demo-doc`)!.scrollTop, b: document.querySelector(`#${b}-panel .demo-doc`)!.scrollTop,
    ca: document.querySelector(`[data-tab="${a}"] :is(.wb-tab-sub-label, .wb-tab-sec-text)`)!.textContent, cb: document.querySelector(`[data-tab="${b}"] :is(.wb-tab-sub-label, .wb-tab-sec-text)`)!.textContent }), [lemma, r.copy]);
  check('each has its own view state (scroll, the section on its tab)', st.a === a0 && a0 > 0 && st.b === 1200 && st.ca !== st.cb, st);
  // the menu: Split down works on a group with one tab
  await page.click(tabSel(r.copy), { button: 'right' });
  await page.click('[role="menu"] >> text=Split down');
  await page.waitForFunction((n: number) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === n + 2, n0);
  check('Split down from the menu, on a one-tab group', (await page.evaluate(() => (window as any).demo.wb.current.peek().tab.state.doc)) === 'lemma');
  // a drag to an edge still moves
  const before = (await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length));
  const t0 = (await tabsOf(page, 0))[1];
  const body = await center(page, `[data-body="${await groupEl(page, 0)}"]`);
  await drag(page, await center(page, tabSel(t0)), { x: body.b.x + body.b.width - 10, y: body.y });
  await page.waitForFunction((id: string) => (window as any).demo.M.groupOf((window as any).demo.wb.layout.peek(), id)?.tabs.length === 1, t0);
  check('a drag to an edge moves (no copy)', (await page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length)) === before);
  await page.close();
});

// ── focus rings and the keyboard in the dropdowns ──
async function ringPainted(page: any, sel: string, box: string = sel) {
  const g = await page.evaluate(([sel, box]: string[]) => {
    const el = document.querySelector(box)!, r = el.getBoundingClientRect(), probe = document.createElement('i');
    probe.style.color = 'var(--rfed-focus)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove();
    return { x: r.x, y: r.y, w: r.width, h: r.height, c: (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number), focused: document.activeElement === document.querySelector(sel) };
  }, [sel, box]);
  const clip = { x: Math.floor(g.x), y: Math.floor(g.y), width: Math.ceil(g.x + g.w) - Math.floor(g.x), height: Math.ceil(g.y + g.h) - Math.floor(g.y) };
  const png = decodePng(await page.screenshot({ clip }));
  const near = (x: number, y: number) => { const i = (y * png.w + x) * 4; return Math.hypot(png.px[i] - g.c[0], png.px[i + 1] - g.c[1], png.px[i + 2] - g.c[2]) < 60; };
  const band = (pts: [number, number][]) => pts.some(([x, y]) => x >= 0 && y >= 0 && x < png.w && y < png.h && near(x, y));
  const mx = Math.floor(png.w / 2), my = Math.floor(png.h / 2), W = png.w - 1, H = png.h - 1;
  const sides = { left: band([0, 1, 2, 3].map((d) => [d, my])), right: band([0, 1, 2, 3].map((d) => [W - d, my])), top: band([0, 1, 2, 3].map((d) => [mx, d])), bottom: band([0, 1, 2, 3].map((d) => [mx, H - d])) };
  return { ok: g.focused && Object.values(sides).every(Boolean), focused: g.focused, sides };
}
group('the focus ring on the tab, its document chip, its section chip and its × (two lines, one line, the top bar; four themes)', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) for (const form of ['two', 'one', 'bar']) {
    const page = await fresh({ theme, query: form === 'bar' ? 'fresh&bar=1' : 'fresh', w: form === 'one' ? 2800 : 1280 });
    await page.evaluate((form: string) => { const W = (window as any).demo, gs = W.M.groups(W.wb.layout.peek());
      if (form === 'bar') W.wb.closeMany([...gs[1].tabs.map((t: any) => t.id), gs[0].tabs[2].id]);
      if (form === 'one') { W.wb.resize(W.wb.layout.peek().root.id, [5, 2]); W.wb.closeMany([gs[0].tabs[2].id]); }
    }, form);
    const id = (await tabsOf(page, 0))[0];
    await page.waitForFunction(([form, id]: string[]) => { const t = document.querySelector(`[data-tab="${id}"]`); return !!t && (form === 'bar' ? !!t.closest('.wb-strip--inbar') : t.closest('.wb-group')?.getAttribute('data-form') === form); }, [form, id]);
    await page.focus(stopSel(id)); await page.keyboard.press('Enter');     // activate it (the focus goes to its content)
    await page.focus(stopSel(id));
    await settle(page);
    const T = tabSel(id), parts: [string, string, string][] = [['the tab', stopSel(id), T], ['its document chip', `${T} [data-name]`, `${T} [data-name]`], ['its section chip', `${T} [data-sub]`, `${T} [data-sub]`], ['its ×', `${T} .wb-tab-close`, `${T} .wb-tab-close`]];
    const res: string[] = [];
    for (const [k, [what, sel, box]] of parts.entries()) {
      if (k) await page.keyboard.press('Tab');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const r = await ringPainted(page, sel, box);
      if (!r.ok) res.push(`${what}: ${JSON.stringify(r)}`);
    }
    check(`${theme}, ${form === 'two' ? 'two lines' : form === 'one' ? 'one line' : 'the top bar'}: Tab reaches the tab, then its chips and its ×, each with the ring painted on all four sides`, !res.length, res);
    await page.close();
  }
});

group('the active tab\'s controls from the keyboard: Enter or Space as a click, ↓ opens a chip\'s dropdown, Escape back to the chip', async () => {
  const page = await fresh();
  const id = (await tabsOf(page, 0))[0], T = tabSel(id);
  await page.focus(stopSel(id)); await page.keyboard.press('Enter'); await page.focus(stopSel(id));
  const back = (sel: string) => page.waitForFunction((sel: string) => !document.querySelector('.wb-pop') && document.activeElement === document.querySelector(sel), sel, { timeout: 3000 }).then(() => true, () => false);
  for (const [chip, grid, key] of [['[data-name]', 'Switch document', 'Enter'], ['[data-name]', 'Switch document', ' '], ['[data-sub]', 'Sections', 'Space'], ['[data-sub]', 'Sections', 'ArrowDown']]) {
    await page.focus(`${T} ${chip}`);
    await page.keyboard.press(key === ' ' ? 'Space' : key);
    const open = await page.waitForFunction((g: string) => !!document.activeElement?.closest(`[role="grid"][aria-label="${g}"]`), grid, { timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.press('Escape');
    check(`${key === ' ' ? 'Space' : key} on the ${chip === '[data-name]' ? 'document' : 'section'} chip opens "${grid}" (the focus in it); Escape closes it, the focus back on the chip`, open && await back(`${T} ${chip}`));
  }
  await page.focus(`${T} .wb-tab-close`);
  await page.keyboard.press('Space');
  check('Space on the ×: the tab closes', await page.waitForFunction((id: string) => !document.querySelector(`[data-tab="${id}"]`), id, { timeout: 3000 }).then(() => true, () => false));
  await page.close();
});

group('dropdowns from the keyboard: the ring on the focused row and button (painted), ↑ ↓ Home End, → the row button, Enter, Escape back to the opener, Tab past the end closes; no ring when a press opens one', async () => {
  const page = await fresh({ query: 'fresh&bar=1' });
  const id = (await tabsOf(page, 0))[0], T = tabSel(id);
  await page.focus(stopSel(id)); await page.keyboard.press('Enter');
  const mark = () => page.evaluate(() => { document.querySelector('[data-probe]')?.removeAttribute('data-probe'); document.activeElement!.setAttribute('data-probe', ''); return document.activeElement!.closest('[role="row"]')?.getAttribute('data-row') ?? document.activeElement!.getAttribute('data-item') ?? document.activeElement!.className; });
  // read once the row's button has faded in (Home onto another row starts its opacity transition; WebKit, slower,
  // was still mid-fade at the screenshot when → came right after it)
  const ring = async () => { await mark(); await settle(page); return (await ringPainted(page, '[data-probe]')).ok; };
  const openers: [string, string, () => Promise<void>][] = [
    ['the document switcher', `${T} [data-name]`, async () => { await page.focus(`${T} [data-name]`); await page.keyboard.press('Enter'); }],
    ['the section menu', `${T} [data-sub]`, async () => { await page.focus(`${T} [data-sub]`); await page.keyboard.press('Enter'); }],
    ['the theme switch', '.wb-bar [data-demo="theme"]', async () => { await page.focus('.wb-bar [data-demo="theme"]'); await page.keyboard.press('Enter'); }],
    ['the tab menu', stopSel(id), async () => { await page.focus(stopSel(id)); await page.keyboard.press('Shift+F10'); }],
    ['the host\'s ⋯ menu', '.wb-bar [data-demo="menu"]', async () => { await page.focus('.wb-bar [data-demo="menu"]'); await page.keyboard.press('Enter'); }],
  ];
  const inPop = () => page.waitForFunction(() => !!document.activeElement?.closest('.wb-pop'), null, { timeout: 3000 }).then(() => true, () => false);
  const backOn = (sel: string) => page.waitForFunction((sel: string) => !document.querySelector('.wb-pop') && document.activeElement === document.querySelector(sel), sel, { timeout: 3000 }).then(() => true, () => false);
  for (const [what, opener, open] of openers) {
    await open();
    const r: Record<string, unknown> = { open: await inPop() };
    await settle(page);
    const first = await mark(); r.first = await ring();
    const rows = await page.evaluate(() => document.querySelectorAll('.wb-pop .wb-menu-item:not(:disabled)').length);
    if (rows > 1) {
      await page.keyboard.press('ArrowDown'); r.down = (await mark()) !== first && await ring();
      await page.keyboard.press('End'); const last = await mark(); r.end = last !== first && await ring();
      await page.keyboard.press('Home'); r.home = (await mark()) === first && await ring();
      await page.keyboard.press('ArrowUp'); r.wrap = (await mark()) === last;
      await page.keyboard.press('Home');
    }
    if (await page.evaluate(() => !!document.querySelector('.wb-pop .wb-row-btn'))) {
      await page.keyboard.press('ArrowRight'); r.btn = await page.evaluate(() => document.activeElement!.classList.contains('wb-row-btn')) && await ring();
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.press('Escape'); r.escape = await backOn(opener);
    await open(); await inPop();
    for (let i = 0; i < 80 && await page.evaluate(() => !!document.querySelector('.wb-pop')); i++) await page.keyboard.press('Tab');
    r.tabOut = await backOn(opener);
    check(`${what}: opened from the keyboard, the focused row has the ring; the keys move it; Escape and Tab past the end close it, the focus back on the opener`, Object.values(r).every((v) => v === true), r);
  }
  // Enter on a row does what a click does (the theme switch: Dark), and the dropdown closes
  await openers[2][2](); await inPop();
  await page.keyboard.press('ArrowDown');     // Light → Dark
  await page.keyboard.press('Enter');
  check('Enter on a row chooses it (the theme switch: the next theme) and closes the dropdown', await page.waitForFunction(() => !document.querySelector('.wb-pop') && document.documentElement.classList.contains('dark'), null, { timeout: 3000 }).then(() => true, () => false));
  // a press (after a key: Chromium carries :focus-visible over) opens it with no ring on the row it focuses
  await page.keyboard.press('Shift');
  await page.click('.wb-bar [data-demo="theme"]'); await inPop(); await settle(page);
  const shadow = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
  check('opened by a press: the row it focuses has no ring (and no keyboard mark)', shadow === 'none' && !(await page.evaluate(() => !!document.querySelector('.wb-pop [data-kbd]'))), shadow);
  await page.close();
});

// ── the focus order: Tab through the demo layout, one line per stop, checked in (tests/focus-order.txt); a change
//    has to be deliberate: rerun with --update-focus-order and review the diff ──
const FOCUS_FILE = join(WB, 'tests/focus-order.txt');
/** The focused element, in words: where (top bar, a side, group N, a dropdown) › what (a tab, its chip, a control). */
const describeFocus = (page: any) => page.evaluate(async () => {
  await Promise.all(document.getAnimations().map((x) => x.finished.catch(() => {})));     // a control fading in as it is reached
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return null;
  const W = (window as any).demo, order = W.M.groups(W.wb.layout.peek()).map((g: any) => g.id);
  const text = (e: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
  const name = (e: Element) => (e.getAttribute('aria-label') || text(e)).slice(0, 48);
  const g = a.closest('[data-group]') as HTMLElement | null, side = a.closest('.wb-side'), pop = a.closest('.wb-pop');
  const where = pop ? `dropdown '${pop.querySelector('[role="grid"], [role="menu"]')?.getAttribute('aria-label')}'`
    : a.closest('.wb-bar') ? 'top bar' : side ? (side.classList.contains('wb-side--left') ? 'left side' : 'right side')
    : g ? `group ${order.indexOf(g.dataset.group) + 1}` : a.closest('.wb-groups') ? 'groups' : 'page';
  const w = a.closest('[data-tab]');
  let what: string;
  if (w) {
    const t = `tab '${text(w.querySelector('.wb-tab-label'))}'${w.classList.contains('wb-tab--on') ? ' (active)' : ''}`;
    what = a.getAttribute('role') === 'tab' ? t : `${t} › ${a.matches('[data-name]') ? 'document chip' : a.matches('[data-sub]') ? 'section chip' : a.matches('.wb-tab-close') ? 'close' : name(a)}`;
  } else if (a.getAttribute('role') === 'tab') what = `tab '${name(a)}'${a.getAttribute('aria-selected') === 'true' ? ' (active)' : ''}`;
  else if (a.closest('[role="row"]')) {
    const r = a.closest('[role="row"]')!, main = r.querySelector('.wb-menu-item')!;
    what = `row '${[...main.children].map((c) => text(c)).filter(Boolean).join(' ')}'${r.classList.contains('is-active') ? ' (current)' : ''}${a === main ? '' : ` › ${name(a)}`}`;
  } else if (a.closest('.wb-panel') && !a.closest('.wb-strip')) {
    const p = a.closest('.wb-panel')!, by = document.getElementById(p.getAttribute('aria-labelledby') ?? '');
    const of = by ? text(by.closest('[data-tab]')?.querySelector('.wb-tab-label') ?? by) : p.getAttribute('aria-label');
    // a scroller with nothing focusable in it is a stop in Chromium only (WebKit skips it): marked, for the comparison
    const role = a.getAttribute('aria-label') || a.getAttribute('role');
    what = `content of '${of}' › ${role ?? (a.scrollHeight > a.clientHeight && !a.matches('button, input, [tabindex]') ? 'scroller' : a.tagName.toLowerCase())}`;
  } else what = name(a);
  // hidden things are never stops: not shown, under inert or aria-hidden, outside the window, transparent
  const r = a.getBoundingClientRect();
  const shown = a.checkVisibility({ visibilityProperty: true, opacityProperty: true } as any) && r.width > 0 && r.height > 0
    && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && !a.closest('[inert], [aria-hidden="true"]');
  return `${where} › ${what}${shown ? '' : '  !! NOT SHOWN'}`;
});
/** Tab (or Shift+Tab) from the page's start round to it again: the stops in order (at most `max`); `within`: stop when
 *  the focus leaves that selector's element. The page's order ends where the browser takes the focus: Chromium and
 *  WebKit leave it on no element (the body), headless Firefox on the last stop (the key moves it nowhere): both end
 *  the list, as does a wrap round to the first stop. */
async function tabStops(page: any, { back = false, within = null as string | null, max = 120 } = {}) {
  if (!within) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const out: string[] = [];
  await page.evaluate(() => { (window as any).__stops = new Set(); });
  for (let i = 0; i < max; i++) {
    await page.evaluate(() => { (window as any).__prev = document.activeElement; });
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    if (within && !(await page.evaluate((s: string) => !!document.activeElement?.closest(s), within))) break;
    // the focus did not move (the end, in Firefox) or came back to a stop already listed (a wrap): the end
    if (await page.evaluate(() => { const w = window as any, a = document.activeElement; if (!a || a === document.body) return false;
      const end = a === w.__prev || w.__stops.has(a); w.__stops.add(a); return end; })) break;
    const d = await describeFocus(page);
    if (d == null) { if (out.length) break; continue; }
    out.push(d);
  }
  return out;
}
const settle = (page: any) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
/** The layouts the list records, each set up from ?fresh (two groups, both sides, the top bar). */
const FOCUS_SCENES: [string, (page: any) => Promise<void>][] = [
  ['two groups, both sides open (?fresh)', async () => {}],
  ['one group of two tabs, in the top bar, both sides hidden', async (page) => {
    await page.evaluate(() => { const W = (window as any).demo, gs = W.M.groups(W.wb.layout.peek()); W.wb.closeMany([...gs[1].tabs.map((t: any) => t.id), gs[0].tabs[2].id]); W.wb.toggleSide('left'); W.wb.toggleSide('right'); });
    await page.waitForFunction(() => !!document.querySelector('.wb-strip--inbar [data-tab]') && document.querySelectorAll('.wb-side--hidden').length === 2);
  }],
];
group('focus order: Tab goes through every stop in reading order; recorded in tests/focus-order.txt', async () => {
  const sections: string[] = [];
  for (const [title, setup] of FOCUS_SCENES) {
    const page = await fresh({ query: 'fresh&bar=1', sides: true });
    await setup(page); await settle(page);
    const fwd = await tabStops(page);
    check(`${title}: every stop is shown`, fwd.every((l) => !l.includes('NOT SHOWN')), fwd.filter((l) => l.includes('NOT SHOWN')));
    await settle(page);
    const back = await tabStops(page, { back: true });
    check(`${title}: Shift+Tab goes the same way back (no trap)`, back.join('\n') === [...fwd].reverse().join('\n'), { fwd: fwd.length, back: back.length });
    sections.push(`## ${title}`, ...fwd, '');
    await page.close();
  }
  // an open dropdown (opened from the keyboard on the first tab's chip): its stops from the one it focuses, until Tab
  // leaves it (it closes, the focus back on the chip)
  for (const [title, chip] of [['the document switcher', 'data-name'], ['the section menu', 'data-sub']]) {
    const page = await fresh({ query: 'fresh&bar=1', sides: true });
    const id = (await tabsOf(page, 0))[0];
    await page.focus(stopSel(id)); await page.keyboard.press('Enter');
    await page.focus(`${tabSel(id)} [${chip}]`); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.activeElement?.closest('.wb-pop'));
    const lines = [(await describeFocus(page))!, ...await tabStops(page, { within: '.wb-pop' })];
    const after = await describeFocus(page), open = await page.evaluate(() => !!document.querySelector('.wb-pop'));
    check(`${title} open: every stop is shown`, lines.every((l) => !l.includes('NOT SHOWN')), lines.filter((l) => l.includes('NOT SHOWN')));
    sections.push(`## ${title} open (Enter on the chip of the first tab of group 1), Tab to its end`, ...lines, `(Tab past the end: ${open ? 'still open' : 'closed'}, the focus on: ${after})`, '');
    await page.close();
  }
  // closing moves the focus to the neighbour: the × of the active tab (Enter) → the group's new active tab; the last tab
  // of a group (Delete) → the active tab of the group that became active
  const page = await fresh({ query: 'fresh&bar=1', sides: true });
  const focusNow = () => page.evaluate(() => { const a = document.activeElement!, W = (window as any).demo, l = W.wb.layout.peek();
    return { role: a.getAttribute('role'), tab: a.parentElement?.getAttribute('data-tab'), group: W.M.groups(l).findIndex((g: any) => a.closest(`[data-group="${g.id}"]`)), active: W.M.groups(l).map((g: any) => g.active) }; });
  const [g1, g2] = [await tabsOf(page, 0), await tabsOf(page, 1)];
  // every tab is a stop, so the focus can be on an inactive tab: an arrow onto the ACTIVE one (nothing to activate,
  // no render) still moves the focus
  await page.focus(stopSel(g1[1]));
  await page.keyboard.press('ArrowRight');
  check('from an inactive tab, → onto the active tab moves the focus there', await page.waitForFunction((id: string) => document.activeElement?.parentElement?.getAttribute('data-tab') === id, g1[2], { timeout: 3000 }).then(() => true, () => false));
  await page.focus(`[data-tab="${g1[2]}"] .wb-tab-close`);
  await page.keyboard.press('Enter');
  await page.waitForFunction((id: string) => !document.querySelector(`[data-tab="${id}"]`), g1[2]);
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab');
  let f = await focusNow();
  check('Enter on the active tab\'s ×: closed; the focus on the group\'s new active tab (its neighbour)', f.group === 0 && f.tab === f.active[0] && g1.slice(0, 2).includes(f.tab), f);
  await page.focus(stopSel(g2[0]));
  await page.keyboard.press('Delete');
  await page.waitForFunction((id: string) => document.activeElement?.parentElement?.getAttribute('data-tab') === id, g2[1]);
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).length === 1);
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab');
  f = await focusNow();
  check('Delete on a group\'s last tab: the group closes; the focus on the active tab of the group that became active', f.group === 0 && f.tab === f.active[0], f);
  await page.close();
  const got = sections.join('\n');
  const header = '# The focus order of the demo (1280 × 800), one line per Tab stop: where › what. Generated by tests/e2e.ts\n# (the group "focus order"); after a deliberate change: node workbench/tests/e2e.ts --only "focus order" --update-focus-order\n\n';
  if (argv.includes('--update-focus-order')) { writeFileSync(FOCUS_FILE, header + got); console.log(`info focus order written: ${FOCUS_FILE}`); return; }
  // WebKit does not stop on a scroller with nothing focusable in it: those lines are Chromium's only
  const want = (existsSync(FOCUS_FILE) ? readFileSync(FOCUS_FILE, 'utf8') : '').replace(/^# .*\n/gm, '').replace(/^\n/, '');
  const norm = (t: string) => BROWSER === 'chromium' ? t.trim() : t.split('\n').filter((l) => !/ › scroller$/.test(l)).join('\n').trim();
  const diff = (a: string[], b: string[]) => { const i = a.findIndex((l, k) => l !== b[k]); return i < 0 ? (a.length === b.length ? null : `length ${a.length} vs ${b.length}`) : `line ${i + 1}: got "${a[i]}", recorded "${b[i]}"`; };
  check('the focus order is the recorded one (a change: --update-focus-order, then review the diff)', norm(got) === norm(want), diff(norm(got).split('\n'), norm(want).split('\n')));
});

//    context key reflowed.field) the host's row runs its bold and the sidebar stays ──
group('Ctrl+B / ⌘B toggles the left sidebar from a tab and from the view (VS Code); Ctrl+Alt+B / ⌥⌘B the right; in a field (reflowed.field) the host\'s bold runs and no sidebar moves; macOS and Linux', async () => {
  const page = await fresh();
  for (const platform of ['mac', 'linux']) {
    const r = await page.evaluate(async (platform: string) => {
      const D = (window as any).demo, { createWorkbench, Workbench, html, render, registerDemoViews } = D.lib;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:300px;width:1200px;height:480px';
      document.body.append(host);
      const ran: string[] = [];
      const wb2 = createWorkbench({ idPrefix: 'b', platform, layout: D.wb.serialize(),
        keys: [{ key: 'ctrl+b', mac: 'meta+b', command: 'editor.bold', when: 'reflowed.field' }], commands: { run: (c: string) => { ran.push(c); } } });
      registerDemoViews(wb2, { panels: true });
      render(html`<${Workbench} wb=${wb2} label="Second" />`, host);
      await wb2.idle();
      const mac = platform === 'mac';
      const press = (el: Element, alt = false) => el.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', ctrlKey: !mac, metaKey: mac, altKey: alt, bubbles: true, cancelable: true }));
      const tab = () => wb2.root().querySelector('.wb-groups [role="tab"]')!, view = () => wb2.root().querySelector('.wb-panel:not(.wb-panel--hidden) .demo-doc, .wb-panel:not(.wb-panel--hidden) .demo-list, .wb-panel:not(.wb-panel--hidden) .wb-view')!;
      const sides = () => [wb2.sides.peek().left.collapsed, wb2.sides.peek().right.collapsed];
      const out: Record<string, unknown> = { s0: sides() };
      press(tab()); await wb2.idle(); out.tab1 = sides();
      press(tab()); await wb2.idle(); out.tab2 = sides();
      press(view()); await wb2.idle(); out.view1 = sides();
      press(view()); await wb2.idle(); out.view2 = sides();
      press(view(), true); await wb2.idle(); out.right1 = sides();
      press(view(), true); await wb2.idle(); out.right2 = sides();
      wb2.setContext('reflowed.field', true);
      press(view()); await wb2.idle(); out.field = sides(); out.ran = [...ran];
      wb2.setContext('reflowed.field', false);
      out.shown = wb2.shortcut('toggleSide');
      render(null, host); host.remove(); wb2.dispose();
      return out;
    }, platform);
    const [l0, r0] = r.s0 as boolean[], same = (a: unknown, b: boolean[]) => JSON.stringify(a) === JSON.stringify(b);
    check(`${platform}: from a tab: the left sidebar toggles, and back`, same(r.tab1, [!l0, r0]) && same(r.tab2, [l0, r0]), r);
    check(`${platform}: from the view: the same`, same(r.view1, [!l0, r0]) && same(r.view2, [l0, r0]), r);
    check(`${platform}: with Alt (⌥⌘B, Ctrl+Alt+B): the right sidebar`, same(r.right1, [l0, !r0]) && same(r.right2, [l0, r0]), r);
    check(`${platform}: in a field: the host's bold, no sidebar moves`, same(r.field, [l0, r0]) && (r.ran as string[]).join() === 'editor.bold', r);
    check(`${platform}: the key shown is ${platform === 'mac' ? '⌘B' : 'Ctrl+B'}`, r.shown === (platform === 'mac' ? '⌘B' : 'Ctrl+B'), r.shown);
  }
  await page.close();
});
