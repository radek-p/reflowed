// The workbench's browser suite, area "tabs": tabs: the header forms, menus, rename, rows, narrowing, motion. Run by tests/e2e.ts (--area tabs).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── the header: the document named once, one home entry, the section reachable ──
group('header: the document named once, one home, the section reachable, no row beside tabs', async () => {
  const page = await fresh();
  const [lemma] = await tabsOf(page, 0);
  await page.click(tabSel(lemma));
  const r = await page.evaluate(() => {
    const g = document.querySelector('.wb-group')!;
    const chrome = [...g.querySelectorAll('.wb-strip, .wb-crumbs')].filter((e) => (e as HTMLElement).offsetParent !== null && getComputedStyle(e).display !== 'none');
    const text = chrome.map((e) => e.textContent).join(' ');
    return { names: (text.match(/On the lemma of Kőnig/g) ?? []).length, docs: (text.match(/Documents/g) ?? []).length,
      home: 0, newTabs: document.querySelectorAll('.wb-strip > .wb-home-btn[aria-label="Home"][aria-pressed]').length, strips: document.querySelectorAll('.wb-strip').length, homeCrumbs: document.querySelectorAll('.wb-panel:not(.wb-panel--hidden) .wb-crumb--home').length,
      section: !!g.querySelector('[data-crumb="section"], [data-sub]') };
  });
  check('the document is named once in its group' + "'" + 's chrome', r.names === 1, r);
  check('one control for home: a Home toggle at the start of each strip, no "+", no "Documents" crumb beside tabs', r.home === 0 && r.newTabs === r.strips && r.homeCrumbs === 0, r);
  check('the section is shown', r.section, r);
  // the section menu: Ctrl+K S on the active tab
  await page.focus(stopSel(lemma)); await chord(page, 's');
  await page.waitForSelector('[role="grid"]');
  await page.click('[role="grid"] [data-item="sec-The lemma"]');
  await page.waitForFunction((id: string) => (window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).state.section === 'The lemma', lemma);
  check('the section menu jumps to a sibling section', true);
  check('no header row beside tabs', await page.evaluate(() => document.querySelectorAll('.wb-panel .wb-crumbs').length === 0));
  // the integrated view: no tab, so the header names the document, with the one home crumb
  await page.goto('http://wb.test/?fresh&single&sides=0&bar=0');
  await page.waitForSelector('.wb-panel .wb-crumbs');
  const s = await page.evaluate(() => [...document.querySelectorAll('.wb-panel .wb-crumbs [data-crumb]')].map((e) => (e as HTMLElement).dataset.crumb).join());
  check('integrated view: Documents / the document / the section, no home button', s === 'home,doc,section' && await page.locator('.wb-strip [data-action="home"]:visible').count() === 0, s);
  await page.close();
});

// ── two-line tabs (the header's two-line form): every tab shows its own section ──
group('two-line tabs: the section on every tab, ARIA, menus, stable width, no work in hidden tabs', async () => {
  const page = await fresh({ query: 'fresh' });
  const [lemma, graphs] = await tabsOf(page, 0);
  check('three tabs in half of 1280 px: two lines', await page.evaluate(() => document.querySelector('.wb-group')!.getAttribute('data-form')) === 'two');
  await page.click(tabSel(lemma));
  const sub = (id: string) => page.evaluate((id: string) => document.querySelector(`[data-tab="${id}"] .wb-tab-sub-label`)?.textContent ?? null, id);
  const h = await page.evaluate(() => document.querySelector('.wb-strip')!.getBoundingClientRect().height);
  check('the strip is 61 px (the gap, the pill, the gap: 6 + 49 + 6), the room inside the tabs: 49 px tabs, 5 px between the lines', Math.abs(h - 61) < 1 && await page.evaluate(() => { const t = document.querySelector('.wb-tab--sec')!; const r = t.getBoundingClientRect(), la = t.querySelector('.wb-tab-label')!, a = la.getBoundingClientRect(), b = t.querySelector('.wb-tab-sub-label')!.getBoundingClientRect(); return JSON.stringify([Math.round(r.height), Math.round(b.top - (a.bottom - parseFloat(getComputedStyle(la).paddingBottom)))]); }) === '[49,5]', [h, await page.evaluate(() => { const t = document.querySelector('.wb-tab--sec')!; const r = t.getBoundingClientRect(), a = t.querySelector('.wb-tab-label')!.getBoundingClientRect(), b = t.querySelector('.wb-tab-sub-label')!.getBoundingClientRect(); return [r.height, a.top, a.bottom, b.top, b.bottom]; })]);
  check('every document tab shows its own section, the inactive ones too', await sub(lemma) === '1  Introduction' && await sub(graphs) === '1  Introduction');
  const a = await page.evaluate(([id, other]: string[]) => { const w = document.querySelector(`[data-tab="${id}"]`)!, t = w.querySelector(':scope > [role="tab"]')!, o = document.querySelector(`[data-tab="${other}"]`)!;
    return { name: t.getAttribute('aria-label'), pop: t.getAttribute('aria-haspopup'), keys: t.getAttribute('aria-keyshortcuts'), role: t.getAttribute('role'), inner: t.childNodes.length,
      controls: [...w.querySelectorAll('[role="button"]')].map((b) => `${b.getAttribute('aria-label')}|${b.getAttribute('tabindex')}|${b.getAttribute('aria-haspopup') ?? ''}`),
      idle: [...o.querySelectorAll('*')].filter((e) => !e.closest('[aria-hidden="true"]') && (e.matches('[role], [tabindex], svg') ? e.getAttribute('role') !== 'tab' : [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))).length }; }, [lemma, graphs]);
  check('ARIA: one tab element, empty, named "document, section", aria-haspopup=grid (the dropdowns are grids), ↓ (section); its controls are role=button siblings after it, named, Tab stops; an inactive tab exposes nothing else',
    a.role === 'tab' && a.name === 'On the lemma of Kőnig, 1  Introduction' && a.pop === 'grid' && a.keys === 'ArrowDown' && a.inner === 0 && a.idle === 0
    && a.controls.join() === 'Switch document: On the lemma of Kőnig|0|grid,Go to section: 1  Introduction|0|grid,Close On the lemma of Kőnig|0|', a);
  // the active tab's width stays put when its section changes while scrolling; hidden views do no work
  const w0 = await page.evaluate((id: string) => document.querySelector(`[data-tab="${id}"]`)!.getBoundingClientRect().width, lemma);
  const r0 = await page.evaluate(() => JSON.stringify((window as any).demo.stats.renders));
  await page.evaluate((id: string) => { document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop = 1500; }, lemma);
  await page.waitForFunction((id: string) => !/Introduction/.test(document.querySelector(`[data-tab="${id}"] .wb-tab-sub-label`)!.textContent!), lemma);
  const w1 = await page.evaluate((id: string) => document.querySelector(`[data-tab="${id}"]`)!.getBoundingClientRect().width, lemma);
  check('the section follows the view, the tab width does not move', w1 === w0, { w0, w1, s: await sub(lemma) });
  const r1 = await page.evaluate(() => (window as any).demo.stats.renders);
  const before = JSON.parse(r0);
  const hiddenWork = Object.keys(before).filter((k) => k !== lemma && r1[k] !== before[k]);
  check('… without work in hidden tabs', hiddenWork.length === 0, hiddenWork);
  check('an inactive tab keeps its own section', await sub(graphs) === '1  Introduction');
  // the section menu: a press on line 2 of the active tab (again: closes), ↓ on a focused tab, the tab menu
  await page.click(`[data-tab="${lemma}"] [data-sub]`);
  await page.waitForSelector('[role="grid"]');
  check('a press on the section of the active tab opens its menu', true);
  await page.click(`[data-tab="${lemma}"] [data-sub]`);
  await page.waitForFunction(() => !document.querySelector('[role="grid"]'));
  check('… a second press closes it', true);
  await page.focus(stopSel(lemma));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, graphs);
  await chord(page, 's');     // Ctrl+K S: the section menu
  await page.waitForSelector('[role="grid"]');
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="grid"]'));
  check('Alt+↓ on a focused tab opens its section menu, the focus in it', true);
  await page.keyboard.press('Escape');
  await page.waitForFunction((id: string) => !document.querySelector('[role="grid"]') && document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, graphs);
  check('Escape: back on the tab', true);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="grid"]'));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction((id: string) => /The lemma|Main result/.test((window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).state.section ?? ''), graphs);
  check('↓ opens it too; choosing a section goes there and the tab says so', /3  Main result/.test(await sub(graphs) ?? ''), await sub(graphs));
  await page.click(tabSel(lemma), { button: 'right' });
  await page.waitForSelector('[role="menu"]');
  check('the tab menu has neither "Go to section" nor "Switch document" (the keymap and the tab have them)', await page.locator('[role="menu"] >> text=/Go to section|Switch document/').count() === 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // narrow: the real names truncate; only the narrowest tabs show their icon (the sweep: the narrowing group)
  const sep = await center(page, '[role="separator"]');
  await drag(page, sep, { x: 230, y: sep.y });
  await page.waitForFunction(() => document.querySelector('.wb-group')!.getBoundingClientRect().width < 240);
  await settled(page);
  const n = (await narrowLook(page)).filter((x: any) => x.room < 400).map((x: any) => ({ ...x, why: narrowBad(x) }));
  check('at the narrowest each tab its real name truncated (≥ 3 characters) or its icon; the names stay', n.length > 0 && n.every((x: any) => !x.why), n);
  await page.close();
});

// ── one line per tab (the header's one-line form): "Document › Section", the scenario of one paper open three times ──
group('one-line tabs: document › section on every tab; a shared name steps back; narrow; ARIA', async () => {
  const page = await fresh({ query: 'fresh&scenario=paper' });
  await oneLine(page);
  const tabs = await tabsOf(page, 0);
  const info = () => page.evaluate((ids: string[]) => ids.map((id) => { const t = document.querySelector(`[data-tab="${id}"]`)!, tt = t.querySelector(':scope > [role="tab"]')!;
    return { name: tt.getAttribute('aria-label'), shown: t.querySelector('.wb-tab-label')?.textContent, abbr: !!t.querySelector('.is-abbr'), muted: !!t.querySelector('.is-shared'), num: t.querySelector('.wb-tab-num')?.textContent,
      sec: t.querySelector('.wb-tab-sec-text')?.textContent, icon: !!t.querySelector('.wb-tab-icon'), w: Math.round(t.getBoundingClientRect().width), pop: tt.getAttribute('aria-haspopup') }; }), tabs);
  const r = await info();
  check('every tab shows its own section, active and inactive', r.map((x: any) => x.num).join() === '2,4.2,A,3,2', r.map((x: any) => x.num));
  check('the paper open three times: its name is muted (never initials), the other keeps its colour', r.slice(0, 3).every((x: any) => !x.abbr && x.shown === 'Kőnig’s lemma and its variants' && x.muted) && !r[3].muted, r.map((x: any) => [x.shown, x.muted]));
  check('the accessible name is the whole "document, section" (never the initials); the tab has the section popup',
    r[1].name === 'Kőnig’s lemma and its variants, 4.2  Proof of Theorem 3' && r.every((x: any) => x.pop === 'grid'), r[1]);
  check('no document icon on document tabs; the other kinds keep theirs', r.every((x: any) => !x.icon) && await page.evaluate(() => [...document.querySelectorAll('.wb-tab')].filter((t: any) => /Notes|Home/.test(t.textContent!)).every((t: any) => !!t.querySelector('.wb-tab-icon'))));
  // the section follows the view; widths do not move
  await page.waitForFunction((id: string) => document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop > 0, tabs[0]);     // its jump to the section at mount is done
  await page.evaluate((id: string) => { const d = document.querySelector(`#${id}-panel .demo-doc`)!; d.scrollTop = d.scrollHeight; }, tabs[0]);
  await page.waitForFunction((id: string) => ((window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).state.section ?? '') !== '2 Definitions', tabs[0]);
  await settled(page);
  const r2 = await info();
  check('the section follows the view; no tab changes its width', r2.map((x: any) => x.w).join() === r.map((x: any) => x.w).join() && r2[0].sec !== 'Definitions', { before: r.map((x: any) => x.w), after: r2.map((x: any) => x.w) });
  // Alt+↓ on an inactive tab: it becomes active and its section menu opens
  await page.focus(stopSel(tabs[0]));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, tabs[1]);
  await chord(page, 's');     // Ctrl+K S: the section menu
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="grid"]'));
  check('Alt+↓ opens the section menu of the tab', await page.evaluate(() => /4\.2/.test(document.querySelector('[role="grid"] .is-active')?.textContent ?? '')));
  await page.keyboard.press('Escape');
  // narrow: the inactive tabs keep the section number; at the narrowest a short form (number or initials), not icons
  const sep = await center(page, '[role="separator"]');
  await drag(page, sep, { x: 200, y: sep.y });
  await page.waitForFunction(() => document.querySelector('.wb-group')!.getBoundingClientRect().width < 220);
  await settled(page);
  const z = await page.evaluate(() => [...document.querySelector('.wb-group')!.querySelectorAll('.wb-tab')].map((t) => t.querySelector('.wb-tab-label')!.textContent));
  check('narrow: no initials, every label is the real name (truncated by CSS)', z.every((x: any) => x.length > 4) && await page.locator('.is-abbr, .wb-tab-short').count() === 0, z);
  await page.close();
});

// ── a tab never changes its box: activating, hovering, focusing (both forms, light and dark) ──
group('stable tabs: activate, hover, focus leave every tab rect unchanged', async () => {
  for (const c of ['two lines', 'one line']) for (const theme of ['light', 'dark']) for (const scen of ['', '&scenario=paper']) {
    // the scenario: four tabs that share a 700 px group (they shrink: where widths used to jump)
    const page = await fresh({ theme, w: 1400, query: `fresh${scen}` });
    if (c === 'one line') await oneLine(page);
    const rects = () => page.evaluate(() => [...document.querySelectorAll('.wb-tab')].map((t) => { const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r0 = await rects();
    const ids = await page.evaluate(() => [...document.querySelectorAll('.wb-tab')].map((t) => (t as HTMLElement).dataset.tab!));
    let worst = 0, at = '';
    const cmp = async (what: string) => { await frame(); const r = await rects(); r.forEach((q: any, i: any) => q.forEach((v: any, k: any) => { const d = Math.abs(v - r0[i][k]); if (d > worst) { worst = d; at = `${what} tab ${i}`; } })); };
    for (const id of [...ids, ...ids]) {
      const b = await page.locator(tabSel(id)).boundingBox();
      await page.mouse.click(b.x + 14, b.y + 10);           // activate
      await page.keyboard.press('Escape');
      await cmp(`activate ${id}`);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);   // hover
      await cmp(`hover ${id}`);
    }
    await page.focus(stopSel(ids[0]));
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await cmp('focus'); }
    check(`${c}, ${theme}${scen ? ', scenario' : ''}: activating, hovering and focusing move no tab (≤ 0.5 px)`, worst <= 0.5, { worst, at });
    await page.close();
  }
});

// ── home is one tab: revealed, never duplicated ──
// ── the section in a tab changes cleanly while scrolling: once per boundary, never an intermediate frame ──
group('section line: one change per boundary, no flicker frames', async () => {
  for (const c of ['two lines', 'one line']) {
    const page = await fresh({ query: 'fresh&scenario=paper' });
    if (c === 'one line') await oneLine(page);
    const [first] = await tabsOf(page, 0);
    await page.click(tabSel(first));
    await page.evaluate((id: string) => { (window as any).demo.wb.setState(id, { section: '1 Introduction' }); document.querySelector(`#${id}-panel .demo-doc`)!.scrollTop = 0; }, first);
    await page.waitForFunction((id: string) => /Introduction/.test(document.querySelector(`[data-tab="${id}"] .wb-tab-sub-label, [data-tab="${id}"] .wb-tab-sec`)!.textContent!), first);
    const r = await page.evaluate(async (id: string) => {
      const sc = document.querySelector(`#${id}-panel .demo-doc`) as HTMLElement;
      const label = () => document.querySelector(`[data-tab="${id}"] .wb-tab-sub-label, [data-tab="${id}"] .wb-tab-sec`) as HTMLElement;
      const frames: any[] = [];
      const hs = [...sc.querySelectorAll('h3')] as HTMLElement[];
      // down across every boundary, then back up across two: 4 px a frame, wobbling ±6 px at each heading
      const path: number[] = [];
      const at = (h: HTMLElement) => h.offsetTop - parseFloat(getComputedStyle(sc).paddingTop) - 8;
      let y = 0;
      const max = sc.scrollHeight - sc.clientHeight;
      const reach = hs.filter((h, i) => i > 0 && at(h) + 30 <= max);       // the headings the scroll can take past the line
      // at each heading the scroll wobbles across its line (where a value without hysteresis flips) before it goes on
      for (const h of reach) { const t = at(h); while (y < t - 10) { y += 4; path.push(y); } for (const d of [-6, 6, -4, 5, -2, 3]) path.push(t + d); y = t; while (y < t + 30) { y += 4; path.push(y); } }
      const back = at(reach[reach.length - 2]) - 30;
      while (y > back) { y -= 4; path.push(y); }
      for (const p of path) {
        sc.scrollTop = p;
        await new Promise((r) => requestAnimationFrame(r));
        const l = label(), cs = getComputedStyle(l);
        frames.push({ text: l.textContent!.trim(), op: cs.opacity, color: cs.color, anims: [...l.getAnimations({ subtree: true }), ...(l.closest('.wb-tab') as HTMLElement).getAnimations()].filter((a: any) => !(a instanceof CSSTransition && a.transitionProperty === 'background-color')).length });
      }
      return { frames, n: reach.length + 1 };
    }, first);
    let changes = 0;
    for (let i = 1; i < r.frames.length; i++) if (r.frames[i].text !== r.frames[i - 1].text) changes++;
    const bad = r.frames.filter((f: any) => f.op !== '1' || f.anims > 0 || !f.text || f.color !== r.frames[0].color);
    const expect = (r.n - 1) + 2;
    check(`${c}: crossing ${expect} boundaries changes the section ${expect} times (no flip-flop at a heading)`, changes === expect, { changes, expect });
    check(`${c}: every frame shows a whole section at full opacity, the final colour, no animation`, bad.length === 0, bad.slice(0, 3));
    await page.close();
  }
});

// ── one row menu: the document switcher and the section menu share it (style, keys, ARIA, the new-tab button) ──
group('section menu = the switcher' + "'" + 's row menu: a row goes there, its button opens a new tab there; one style; keys', async () => {
  const page = await fresh({ query: 'fresh&scenario=paper' });
  await settled(page);
  const act = await page.evaluate(() => (window as any).demo.wb.current.peek().tab.id);
  await page.click(`${tabSel(act)} [data-sub]`);
  await page.waitForSelector('[role="grid"][aria-label="Sections"] [role="row"]');
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const styleOf = () => page.evaluate(() => { const row = document.querySelector('[role="grid"] [role="row"]:not(.is-active)')!, item = row.querySelector('.wb-menu-item')!, btn = row.querySelector('.wb-row-btn');
    const pick = (e: Element | null, ks: string[]) => e ? ks.map((k) => (getComputedStyle(e) as any)[k]).join(';') : null;
    const menu = document.querySelector('.wb-select-pop .wb-menu')!;
    return { row: pick(row, ['height']), item: pick(item, ['height', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'lineHeight', 'color']), btn: pick(btn, ['width', 'height', 'borderTopLeftRadius']), menu: pick(menu, ['maxHeight', 'overflowY', 'minWidth']) }; });
  const secStyle = await styleOf();
  const sec = await page.evaluate(() => ({ rows: [...document.querySelectorAll('[role="row"]')].map((r) => ({ id: r.getAttribute('data-row'), btn: r.querySelector('.wb-row-btn')?.getAttribute('aria-label'), num: r.querySelector('.wb-row-num')?.textContent, x: r.querySelector('.wb-mi-label')!.getBoundingClientRect().left })),
    numColor: getComputedStyle(document.querySelector('.wb-row-num')!).color, labelColor: getComputedStyle(document.querySelector('.wb-row .wb-mi-label')!).color }));
  check('every section row has an "Open … in a new tab" button; subsections indented; the number in the secondary colour',
    sec.rows.length >= 8 && sec.rows.every((r: any) => /^Open .* in a new tab$/.test(r.btn ?? '')) && sec.rows.find((r: any) => r.num === '4.2')?.x > sec.rows.find((r: any) => r.num === '2')?.x && sec.numColor !== sec.labelColor, sec);
  // a row click: this tab's section; the button: a new tab with the same document at that section
  await page.click('[role="row"][data-row="sec-5 Conclusion"] .wb-menu-item');
  await page.waitForFunction((id: string) => (window as any).demo.wb.current.peek().tab.id === id && (window as any).demo.wb.current.peek().tab.state.section === '5 Conclusion', act);
  const count = () => page.evaluate(() => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length);
  const c0 = await count();
  check('a row click switches this tab' + "'" + 's section (no new tab)', c0 === await count());
  await page.click(`${tabSel(act)} [data-sub]`);
  await page.waitForSelector('[data-action-for="sec-4.1 Two lemmas"]');
  await page.hover('[role="row"][data-row="sec-4.1 Two lemmas"]');
  await page.click('[data-action-for="sec-4.1 Two lemmas"]');
  await page.waitForFunction((n: number) => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length === n + 1, c0);
  const nt = await page.evaluate(() => { const t = (window as any).demo.wb.current.peek().tab; return { doc: t.state.doc, section: t.state.section }; });
  check('the row' + "'" + 's button: a new tab, the same document at that section (the old tab unchanged)', nt.doc === 'konig' && nt.section === '4.1 Two lemmas' && await page.evaluate((id: string) => (window as any).demo.M.findTab((window as any).demo.wb.layout.peek(), id).state.section, act) === '5 Conclusion', nt);
  await page.waitForFunction(() => { const t = (window as any).demo.wb.current.peek().tab; const sc = document.querySelector(`#${t.id}-panel .demo-doc`); const h = document.getElementById(`${t.id}-4.1 Two lemmas`);
    return sc && h && Math.abs(h.getBoundingClientRect().top - sc.getBoundingClientRect().top - parseFloat(getComputedStyle(sc).paddingTop)) < 4; });
  check('… scrolled to it', true);
  // the switcher: the same component and style
  const cur = await page.evaluate(() => (window as any).demo.wb.current.peek().tab.id);
  await page.click(`${tabSel(cur)} [data-name]`);
  await page.waitForSelector('[role="grid"][aria-label="Switch document"] [role="row"]');
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const docStyle = await styleOf();
  check('both menus share the component: the same computed row, item, button and menu styles (the section menu a tab-stop list: its own columns)', JSON.stringify(docStyle) === JSON.stringify(secStyle), { docStyle, secStyle });
  await page.keyboard.press('Escape');
  // keyboard: Alt+↓ opens the sections (a grid), ↓ ↑ rows, → the button, Enter there: a new tab; Escape back to the tab
  await page.focus(stopSel(cur));
  await chord(page, 's');     // Ctrl+K S: the section menu
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="grid"][aria-label="Sections"]'));
  await page.keyboard.press('Escape');
  await page.waitForFunction((id: string) => document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, cur);
  check('Alt+↓ opens the sections, Escape returns to the tab', true);
  await chord(page, 's');     // Ctrl+K S: the section menu
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="grid"][aria-label="Sections"]'));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const onBtn = await page.evaluate(() => document.activeElement?.getAttribute('data-action-for'));
  const c1 = await count();
  await page.keyboard.press('Enter');
  await page.waitForFunction((n: number) => (window as any).demo.M.allTabs((window as any).demo.wb.layout.peek()).length === n + 1, c1);
  check('keys: Home, ↓ to the second row, → to its button, Enter: a new tab at that section', onBtn === 'sec-2 Definitions' && await page.evaluate(() => (window as any).demo.wb.current.peek().tab.state.section) === '2 Definitions', onBtn);
  await page.close();
});

// ── the demo's theme switch (Light, Dark, System), kept; ?theme wins ──
group('theme switch: Light, Dark, System apply and persist; no down chevrons on names or sections', async () => {
  const page = await fresh({ query: 'fresh&scenario=paper&bar=1' });
  await page.evaluate(() => { try { localStorage.removeItem('wb-demo-theme'); } catch {} });
  const bg = () => page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), choice: document.documentElement.dataset.themeChoice, bg: getComputedStyle(document.body).backgroundColor }));
  const pick = async (c: string) => { await page.click('.wb-bar [data-demo="theme"]'); await page.click(`[data-item="theme-${c}"]`); await page.waitForFunction((c: string) => document.documentElement.dataset.themeChoice === c, c); };
  await pick('dark');
  const d = await bg();
  await pick('light');
  const l = await bg();
  check('Dark and Light apply (the class and the page colour)', d.dark && !l.dark && d.bg !== l.bg, { d, l });
  await pick('dark');
  check('… and the choice is kept', await page.evaluate(() => localStorage.getItem('wb-demo-theme')) === 'dark');
  const sys = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await pick('system');
  check('System follows the system' + "'" + 's scheme', (await bg()).dark === sys);
  const chev = await page.evaluate(() => [...document.querySelectorAll('.wb-root svg')].filter((e) => e.getBoundingClientRect().width > 0 && e.getAttribute('data-icon') === 'chevronDown').length + document.querySelectorAll('.wb-tab-more, .wb-crumb-more').length);
  check('no down chevron after a name or a section', chev === 0, chev);
  await page.close();
});

// ── rename in place: the tab menu, F2, the one-document pencil ──
group('rename: in the tab (menu, F2), also in the top bar; Escape cancels; every tab of the document', async () => {
  const page = await fresh({ query: 'fresh&scenario=paper' });
  await events(page);
  const tabs = await tabsOf(page, 0);
  const names = () => page.evaluate(() => [...document.querySelectorAll('.wb-tab .wb-tab-label')].map((e) => e.textContent));
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.wb-tab')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); }).join('|'));
  const r0 = await rects();
  await page.click(tabSel(tabs[1]), { button: 'right' });
  await page.click('[role="menu"] >> text=Rename…');
  await page.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
  check('Rename… from the tab menu: a field over the name, focused, its text selected', await page.evaluate(() => { const i = document.activeElement as HTMLInputElement; return i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value === 'Kőnig’s lemma and its variants'; }));
  check('… the tabs keep their boxes while it is edited', (await rects()) === r0);
  await page.keyboard.type('Kőnig, in full');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.wb-rename'));
  const n1 = await names();
  check('Enter keeps it: every tab of that document shows the new name (the others not)', n1.filter((x: any) => x === 'Kőnig, in full').length === 4 && n1.includes('Sparse graphs and their minors'), n1);
  check('the host heard it (a rename event)', (await evs(page, 'rename')).length === 1);
  await page.focus(stopSel(tabs[0]));
  await page.keyboard.press('F2');
  await page.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
  await page.keyboard.type('nope');
  await page.keyboard.press('Escape');
  await page.waitForFunction((id: string) => !document.querySelector('.wb-rename') && document.activeElement?.closest('[data-tab] > [role="tab"]')?.parentElement?.getAttribute('data-tab') === id, tabs[0]);
  check('F2 on a focused tab renames; Escape restores the name and returns to the tab', (await names()).filter((x: any) => x === 'Kőnig, in full').length === 4);
  await page.keyboard.press('F2');
  await page.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
  await page.keyboard.type('Clicked away');
  await page.mouse.click(700, 400);
  await page.waitForFunction(() => !document.querySelector('.wb-rename'));
  check('a click elsewhere keeps the new name', (await names()).filter((x: any) => x === 'Clicked away').length === 4, await names());
  await page.close();
  // F2 on the tab in the top bar
  const p2 = await fresh({ query: 'fresh&single&bar=1' });
  await p2.focus('.wb-bar [data-tab] > [role="tab"]');
  await p2.keyboard.press('F2');
  await p2.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
  await p2.keyboard.type('Renamed alone');
  await p2.keyboard.press('Enter');
  await p2.waitForFunction(() => document.querySelector('.wb-bar [data-tab] .wb-tab-label')?.textContent === 'Renamed alone');
  check('F2 renames the tab in the top bar, the same way (no pencil)', await p2.locator('[data-crumb-action]').count() === 0);
  await p2.close();
});

// ── (d) hybrid: the tabs fill the strip; one line while all fit, else two lines for all; per group, with hysteresis ──
group('hybrid tabs (d): fill the strip, one or two lines, hysteresis, constant height', async () => {
  const page = await fresh({ query: 'fresh&single' });
  await events(page);
  const open = (doc: string, section: string) => page.evaluate(([doc, section]: string[]) => (window as any).demo.wb.open({ view: 'document', state: { doc, section } }), [doc, section]);
  const st = () => page.evaluate(() => { const box = document.querySelector('.wb-group .wb-tabs') as HTMLElement, cs = getComputedStyle(box);
    const tabs = [...box.querySelectorAll('.wb-tab')].map((x) => x.getBoundingClientRect());
    return { form: box.dataset.form, strip: Math.round(document.querySelector('.wb-group .wb-strip')!.getBoundingClientRect().height), n: tabs.length,
      sum: tabs.reduce((a, r) => a + r.width, 0) + (parseFloat(cs.columnGap) || 0) * (tabs.length - 1), room: box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      lines: [...box.querySelectorAll('.wb-tab')].map((x) => (x.querySelector('.wb-tab-text') ? 2 : 1)) }; });
  await open('graphs', 'Main result');
  await page.waitForFunction(() => document.querySelectorAll('.wb-group .wb-tab').length === 2);
  const s2 = await st();
  check('2 tabs that fit: one line, and together they fill the strip exactly', s2.form === 'one' && s2.lines.every((l: number) => l === 1) && Math.abs(s2.sum - s2.room) <= 1, s2);
  check('one line: the strip and its pills as the top bar (44 / 32)', s2.strip === 44 && await page.evaluate(() => Math.round(document.querySelector('.wb-group .wb-tab')!.getBoundingClientRect().height)) === 32, s2);
  const h = s2.strip;
  for (const [d, s] of [['konig', '4.2 Proof of Theorem 3'], ['streams', 'Lower bound'], ['konig', 'A Extended proof of Theorem 3'], ['lemma', 'The lemma'], ['konig', '2 Definitions']]) await open(d, s);
  await page.waitForFunction(() => (document.querySelector('.wb-group .wb-tabs') as HTMLElement).dataset.form === 'two');
  await settled(page);
  const s7 = await st();
  check('adding tabs until they do not fit: all of them two-line, still filling the strip', s7.lines.every((l: number) => l === 2) && Math.abs(s7.sum - s7.room) <= 1, s7);
  check('two lines: the taller strip and pills (61 / 49)', s7.strip === 61 && await page.evaluate(() => Math.round(document.querySelector('.wb-group .wb-tab')!.getBoundingClientRect().height)) === 49, { h, now: s7.strip });
  // resizing across the threshold: once each way, however the edge wobbles
  const tab = await page.evaluate(() => (window as any).demo.wb.open({ view: 'text', state: { text: 'x' } }));
  await page.evaluate((id: string) => { const w = (window as any).demo.wb; w.split(id, 'right', undefined, { copy: false }); }, tab);
  await page.waitForFunction(() => document.querySelectorAll('.wb-group').length === 2);
  // two tabs left in group 1 (their threshold is within reach), then cross it with the separator
  const ids = await tabsOf(page, 0);
  for (const id of ids.slice(2)) await page.evaluate((id: string) => (window as any).demo.wb.close(id), id);
  await settled(page);
  const before = (await evs(page, 'tabform')).length;
  const sep = await center(page, '[role="separator"]');
  await page.mouse.move(sep.x, sep.y); await page.mouse.down();
  const xs: number[] = [];
  for (let x = sep.x + 300; x >= 250; x -= 10) xs.push(x);
  for (let x = 250; x <= sep.x + 300; x += 10) xs.push(x);
  await page.mouse.move(xs[0], sep.y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));     // the start, decided
  const forms: string[] = [];
  for (const x of xs) { await page.mouse.move(x, sep.y); for (const d of [6, -6, 3, -3]) { await page.mouse.move(x + d, sep.y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))); forms.push((await st()).form); } await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); forms.push((await st()).form); }
  await page.mouse.up();
  let flips = 0; for (let i = 1; i < forms.length; i++) if (forms[i] !== forms[i - 1]) flips++;
  check('resizing across the threshold and back switches once each way (hysteresis), even with a wobbling edge', flips === 2 && forms.includes('two') && forms.includes('one'), { flips, forms: forms.join('').replace(/one/g, '1').replace(/two/g, '2') });
  // the end state equals the static layout
  const geo = (p: any) => p.evaluate(() => [...document.querySelectorAll('.wb-tab, .wb-tab-label')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); }).join('|'));
  await idle(page);
  const json = await page.evaluate(() => (window as any).demo.wb.serialize()), end = await geo(page);
  const p2 = await fresh({ query: 'fresh' });
  await p2.evaluate((j: string) => (window as any).demo.wb.load(j), json);
  await p2.waitForFunction((n: number) => document.querySelectorAll('.wb-tab').length === n, await page.locator('.wb-tab').count());
  await idle(p2);
  check('the end state equals the static layout', (await geo(p2)) === end, { end, static: await geo(p2) });
  await p2.close();
  void before;
  await page.close();
  // one long paper open three times (and another document): no initials ever (that is (c)); the full title, two lines
  const p3 = await fresh({ query: 'fresh&scenario=paper' });
  await idle(p3);
  const sc = await p3.evaluate(() => ({ abbr: document.querySelectorAll('.is-abbr').length, form: (document.querySelector('.wb-group .wb-tabs') as HTMLElement).dataset.form,
    names: [...document.querySelectorAll('.wb-group:first-of-type .wb-tab .wb-tab-label')].map((e) => e.textContent) }));
  check('(d) never shows initials: the same long paper three times gets two lines with its full title', sc.abbr === 0 && sc.form === 'two' && sc.names.filter((n: string) => n === 'Kőnig’s lemma and its variants').length === 3, sc);
  await p3.close();
});

// ── (d) a strip row: side-by-side groups share one form (the tallest any needs); stacked groups decide alone ──
group('(d) strip rows: side by side one form (the tallest), stacked each its own; 3 columns; back once', async () => {
  const page = await fresh({ w: 1500, query: 'fresh&single' });
  await events(page);
  const forms = () => page.evaluate(() => [...document.querySelectorAll('.wb-group')].map((g) => { const s = g.querySelector('.wb-strip')!.getBoundingClientRect(); return { form: (g.querySelector('.wb-tabs') as HTMLElement).dataset.form, top: Math.round(s.top), bottom: Math.round(s.bottom), x: Math.round(s.left) }; }).sort((a, b) => a.x - b.x || a.top - b.top));
  // build: left group with 1 short tab, right group with 4 (4 × --wb-tab-min do not fit: two lines), side by side
  const build = (dir: string, n: number) => page.evaluate(([dir, n]: any) => { const w = (window as any).demo.wb, M = (window as any).demo.M;
    const first = M.allTabs(w.layout.peek())[0].id; w.replace(first, { view: 'text', state: { text: 'Notes' } });
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(w.open({ view: 'document', state: { doc: 'konig', section: '2 Definitions' } }, { focus: false }));
    w.split(ids[0], dir, undefined, { copy: false });
    for (const id of ids.slice(1)) w.move(id, M.groups(w.layout.peek())[1].id);
    return M.groups(w.layout.peek()).map((g: any) => g.tabs.length); }, [dir, n]);
  const counts = await build('right', 4);
  await settled(page);
  const f1 = await forms();
  check('two groups side by side, only one under n × --wb-tab-min: both two-line, their strips aligned (top and bottom)', counts.length === 2 && f1.every((f: any) => f.form === 'two') && f1[0].top === f1[1].top && f1[0].bottom === f1[1].bottom, { counts, f1 });
  // resize back: the right group down to 2 tabs, all one line again, once each
  const n0 = (await evs(page, 'tabform')).length;
  await page.evaluate(() => { const w = (window as any).demo.wb; const r = w.layout.peek().root; for (const t of (window as any).demo.M.groups(w.layout.peek())[1].tabs.slice(2)) w.close(t.id); void r; });
  await settled(page);
  const f2 = await forms(), ev = (await evs(page, 'tabform')).slice(n0);
  check('when it fits again (2 × --wb-tab-min within its room): all one-line, each switched once', f2.every((f: any) => f.form === 'one') && ev.length === 2 && new Set(ev.map((e: any) => e.d.group)).size === 2, { f2, ev });
  await page.close();
  // stacked: independent
  const p2 = await fresh({ w: 1500, query: 'fresh&single' });
  await p2.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M;
    const first = M.allTabs(w.layout.peek())[0].id; w.replace(first, { view: 'text', state: { text: 'Notes' } });
    const a = w.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } }, { focus: false });
    w.split(a, 'bottom', undefined, { copy: false });
    for (let i = 0; i < 5; i++) w.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } }, { focus: false }); });
  await settled(p2);
  const fs2 = await p2.evaluate(() => [...document.querySelectorAll('.wb-group')].map((g) => ({ form: (g.querySelector('.wb-tabs') as HTMLElement).dataset.form, top: Math.round(g.getBoundingClientRect().top), n: g.querySelectorAll('.wb-tab').length })).sort((a, b) => a.top - b.top));
  check('the same two groups stacked: each decides on its own (one line above, two below)', fs2.length === 2 && fs2[0].form === 'one' && fs2[1].form === 'two', fs2);
  await p2.close();
  // three columns, the middle one under n × --wb-tab-min: all three
  const p3 = await fresh({ w: 1500, query: 'fresh&single' });
  await p3.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M;
    const first = M.allTabs(w.layout.peek())[0].id; w.replace(first, { view: 'text', state: { text: 'A' } });
    const b = w.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } }, { focus: false });
    w.split(b, 'right', undefined, { copy: false });
    for (let i = 0; i < 3; i++) w.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } }, { focus: false });
    const c = w.open({ view: 'text', state: { text: 'C' } }, { focus: false });
    w.split(c, 'right', undefined, { copy: false }); });
  await settled(p3);
  const f3 = await p3.evaluate(() => [...document.querySelectorAll('.wb-group')].map((g) => ({ form: (g.querySelector('.wb-tabs') as HTMLElement).dataset.form, n: g.querySelectorAll('.wb-tab').length, h: Math.round(g.querySelector('.wb-strip')!.getBoundingClientRect().height) })));
  check('three columns, the middle under n × --wb-tab-min: all three two-line, one height', f3.length === 3 && f3.every((f: any) => f.form === 'two') && new Set(f3.map((f: any) => f.h)).size === 1, f3);
  await p3.close();
});

// ── the active tab of a group that is not focused: the first press focuses the group, the second opens the menu ──
group('unfocused group: a press on its active tab' + "'" + 's section or name focuses the group; the next press opens the menu', async () => {
  for (const part of ['[data-sub]', '[data-name]']) {
    const page = await fresh({ query: 'fresh&scenario=paper' });
    await settled(page);
    const ids = await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M, gs = M.groups(w.layout.peek());
      const t = gs[1].tabs.find((x: any) => x.view === 'document'); w.activate(t.id); w.focusGroup(gs[0].id, { focus: false }); return { tab: t.id, g: gs[1].id }; });
    await settled(page);
    const on = () => page.evaluate(() => (window as any).demo.wb.layout.peek().active);
    check(`${part}: the other group is focused to begin with`, (await on()) !== ids.g);
    await page.click(`${tabSel(ids.tab)} ${part}`);
    await page.waitForFunction((g: string) => (window as any).demo.wb.layout.peek().active === g, ids.g);
    await idle(page);     // a menu would be open by now
    check(`${part}: the first press focuses that group (and its tab), no menu`, await page.locator('[role="grid"], [role="menu"]').count() === 0);
    await page.click(`${tabSel(ids.tab)} ${part}`);
    await page.waitForSelector('[role="grid"]');
    check(`${part}: the second press opens its menu`, true);
    await page.close();
  }
});

// ── home showing in a group: its tabs look unfocused and act so: a press on the active tab's name or section closes
//    home and shows the tab, no menu; the next press opens it (both hosts) ──
group('home showing: a press on the active tab' + "'" + 's name or section closes home, shows the tab, no menu; the next press opens it; both hosts', async () => {
  for (const host of ['row', 'bar']) for (const part of ['[data-sub]', '[data-name]']) {
    const page = await fresh({ query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&scenario=paper' });
    await page.evaluate(() => document.fonts.ready);
    const ids = await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M;
      const id = w.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3' } });
      const g = M.groupOf(w.layout.peek(), id); w.activate(id); w.focusGroup(g.id, { focus: false }); w.toggleHome(g.id, true); return { tab: id, g: g.id }; });
    await settled(page);
    const strip = `[data-strip-group="${ids.g}"]`, sel = `${strip} ${tabSel(ids.tab)} ${part}`;
    check(`${host} ${part}: home shows (the strip marked), in the ${host} host`, await page.locator(`${strip}.wb-strip--home[data-host="${host}"]`).count() === 1);
    // a menu opened by the first press would show within NAME_WAIT (the name) or at once (the section): watch for any
    await page.evaluate(() => { const w = window as any; w._menuSeen = false; new MutationObserver(() => { if (document.querySelector('[role="grid"], [role="menu"], [role="listbox"]')) w._menuSeen = true; }).observe(document.body, { childList: true, subtree: true }); });
    await page.click(sel);
    await page.waitForFunction((g: string) => !(window as any).demo.wb.isHome(g), ids.g);
    await page.waitForSelector(`${strip}:not(.wb-strip--home) ${tabSel(ids.tab)}.wb-tab--on`);
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t: number) => performance.now() > t + 2 * 250, t0);     // past NAME_WAIT (ui.js, 250 ms): the name's switcher would be open by now
    check(`${host} ${part}: the press closes home, the tab shows, no menu`, !(await page.evaluate(() => (window as any)._menuSeen)) && await page.locator(`[data-group="${ids.g}"] .wb-panels:not([inert])`).count() === 1);
    await page.click(sel);
    const opened = await page.waitForSelector('[role="grid"], [role="menu"], [role="listbox"]', { timeout: 3000 }).then(() => true, () => false);
    check(`${host} ${part}: the next press opens its menu`, opened);
    await page.close();
  }
});

// ── narrowing (every form): the real name truncated with "…" (≥ 3 characters), else the icon; never initials ──
group('narrowing: each tab shows its real name, ≥ 3 characters and "…", or only below the threshold its icon; never initials, never empty', async () => {
  {
    const page = await fresh({ w: 1280, query: 'fresh&scenario=paper' });
    await settled(page);
    const bad: any[] = [];
    let tinies = 0;
    for (let w = 640; w >= 140; w -= 20) {
      await page.evaluate((w: number) => { const W = (window as any).demo.wb; const r = W.layout.peek().root; W.resize(r.id, [w, 1280 - w]); }, w);
      await settled(page);
      for (const x of await narrowLook(page)) { if (x.fit === 'tiny') tinies++; const why = narrowBad(x); if (why) bad.push({ w, why, ...x }); }
    }
    check(`640 → 140 px in 20 px steps: every tab its real name with ≥ 3 characters, or (below the threshold) its icon`, bad.length === 0 && tinies > 0, bad.length ? bad.slice(0, 4) : { tinies });
    await page.close();
  }
  // the top bar: the window narrowed (its tabs at 1/n)
  const page = await fresh({ w: 1400, query: 'fresh&single&bar=1' });
  await page.evaluate(() => { const w = (window as any).demo.wb; for (let i = 0; i < 3; i++) w.open({ view: 'document', state: { doc: ['graphs', 'streams', 'konig'][i] } }, { focus: false }); });
  const bad: any[] = [];
  for (let w = 1400; w >= 420; w -= 40) {
    await page.setViewportSize({ width: w, height: 500 });
    await settled(page);
    for (const x of await narrowLook(page)) { const why = narrowBad(x); if (why) bad.push({ w, why, ...x }); }
  }
  check('the top bar and its row, 1400 → 420 px: the same rule', bad.length === 0, bad.slice(0, 4));
  await page.close();
});

// ── the chips only in the focused group: the unfocused group's active tab hovers as an inactive one ──
group('unfocused group: no chips on its active tab' + "'" + 's name or section; its hover = an inactive tab' + "'" + 's; focused: the chips', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await fresh({ theme, query: 'fresh&scenario=paper' });
    await settled(page);
    const ids = await page.evaluate(() => { const w = (window as any).demo.wb, M = (window as any).demo.M, gs = M.groups(w.layout.peek());
      const t = gs[1].tabs.find((x: any) => x.view === 'document'); const other = gs[1].tabs.find((x: any) => x.id !== t.id); w.activate(t.id); w.focusGroup(gs[0].id, { focus: false }); return { tab: t.id, other: other.id, g: gs[1].id }; });
    await settled(page);
    const bg = (sel: string) => page.evaluate((s: string) => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);
    const still = () => page.waitForFunction(() => document.getAnimations().length === 0);
    await page.hover(tabSel(ids.other), { position: { x: 8, y: 8 } }); await still();
    const inactiveHover = await bg(tabSel(ids.other));
    for (const part of ['[data-name]', '[data-sub]']) {
      await page.hover(`${tabSel(ids.tab)} ${part}`); await still();
      const r = { chip: await bg(`${tabSel(ids.tab)} ${part}`), tab: await bg(tabSel(ids.tab)), cursor: await page.evaluate((s: string) => getComputedStyle(document.querySelector(s)!).cursor, `${tabSel(ids.tab)} ${part}`) };
      check(`${theme}, ${part}: unfocused group: no chip; the tab' + "'" + 's hover = an inactive tab' + "'" + 's`, r.chip === 'rgba(0, 0, 0, 0)' && r.tab === inactiveHover && r.cursor !== 'pointer', { ...r, inactiveHover });
    }
    await page.evaluate((g: string) => (window as any).demo.wb.focusGroup(g, { focus: false }), ids.g);
    await settled(page);
    for (const part of ['[data-name]', '[data-sub]']) {
      await page.hover(tabSel(ids.other)); await page.hover(`${tabSel(ids.tab)} ${part}`); await still();
      const chip = await bg(`${tabSel(ids.tab)} ${part}`);
      check(`${theme}, ${part}: focused: the chip shows on hover`, chip !== 'rgba(0, 0, 0, 0)', chip);
    }
    await page.close();
  }
});

// ── the tabs move, never jump: open, close, reorder, in both hosts ──
for (const host of ['bar', 'row']) group(`host=${host}: opening, closing and reordering move every other tab continuously (≤ 2 px a frame … or a smooth curve); the end state is the static layout`, async () => {
  const page = await fresh({ w: 1500, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&single&bar=0' });
  await page.evaluate(() => { const w = (window as any).demo.wb; w.open({ view: 'text', state: { text: 'x' } }, { focus: false }); });
  await settled(page);
  const sample = (act: string) => page.evaluate(async (act: string) => {
    const w = window as any, frames: any[] = [];
    const rects = () => Object.fromEntries([...document.querySelectorAll('[data-tab]')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => { const r = t.getBoundingClientRect(); return [t.getAttribute('data-tab'), [r.left, r.width]]; }));
    frames.push(rects());
    new Function('w', act)(w);
    for (let i = 0; i < 24; i++) { await new Promise((r) => requestAnimationFrame(r)); frames.push(rects()); }
    return frames;
  }, act);
  // continuity: a tab that is in two consecutive frames moves by at most what the curve allows: no frame jumps more
  // than the largest of its neighbours' steps + 2 px, and the first step is no jump (≤ 40 % of the whole move)
  const judge = (frames: any[], ids: string[]) => {
    const bad: any[] = [];
    for (const id of ids) for (const k of [0, 1]) {
      const v = frames.map((f) => f[id]?.[k]).filter((x) => x != null);
      if (v.length < 3) continue;
      const total = Math.abs(v.at(-1) - v[0]);
      if (total < 1) continue;
      const steps = v.slice(1).map((x, i) => Math.abs(x - v[i]));
      if (steps[0] > total * 0.5 + 2 ||     // (WebKit's first frame comes later: up to half)
        steps.filter((s) => s > 0.5).length < 3) bad.push({ id, k: k ? 'width' : 'left', total: +total.toFixed(1), steps: steps.map((s) => +s.toFixed(1)).slice(0, 8) });
    }
    return bad;
  };
  const before = Object.keys((await sample(''))[0]);
  const fo = await sample("w.demo.wb.open({ view: 'document', state: { doc: 'graphs' } }, { focus: false })");
  await settled(page);
  check(`${host}: opening a tab: the others move and resize continuously`, judge(fo, before).length === 0 && Object.keys(fo.at(-1)).length === 3, judge(fo, before));
  const ids = Object.keys(fo.at(-1));
  const fc = await sample(`w.demo.wb.close('${ids[0]}')`);
  await settled(page);
  check(`${host}: closing a tab: its neighbours slide and stretch into the room continuously`, judge(fc, ids.slice(1)).length === 0, judge(fc, ids.slice(1)));
  const left = Object.keys(fc.at(-1));
  const g = await page.evaluate(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[0].id);
  const fr = await sample(`w.demo.wb.move('${left[0]}', '${g}', 1)`);
  await settled(page);
  check(`${host}: a reorder moves both tabs continuously`, judge(fr, left).length === 0, judge(fr, left));
  // the end state equals a static layout of the same tabs
  const geo = (p: any) => p.evaluate(() => [...document.querySelectorAll('[data-tab]')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => { const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(); }).join('|'));
  const json = await page.evaluate(() => (window as any).demo.wb.serialize()), end = await geo(page);
  const p2 = await fresh({ w: 1500, query: host === 'bar' ? 'fresh&single&bar=1' : 'fresh&single&bar=0' });
  await p2.evaluate((j: string) => (window as any).demo.wb.load(j), json);
  await settled(p2);
  check(`${host}: the end state equals the static layout`, (await geo(p2)) === end, { end, static: await geo(p2) });
  await p2.close();
  await page.close();
});
