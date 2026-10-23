// The workbench's browser suite, area "status": document status: marks, the unsaved dot, the progress bar. Run by tests/e2e.ts (--area status).
import { req, pw, argv, ONLY, HTML, JS, fails, check, BROWSER, browser, fresh, oneLine, idle, groups, group, layout, tabsOf, labels, groupEl, center, drag, tabSel, stopSel, chord, activeId, events, evs, WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join, settled, narrowLook, narrowBad } from './harness.ts';

// ── the document status in the pills: marks, names, no shift ──
/** Every pill's box and its text's start (the name's left and top), in DOM order. */
const pillBoxes = (page: any) => page.evaluate(() => [...document.querySelectorAll('.wb-root .wb-tab')].map((t) => {
  const r = t.getBoundingClientRect(), l = t.querySelector('.wb-tab-label')!.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height, l.x, l.y];
}));
const setStatus = (page: any, doc: string, s: any) => page.evaluate(([d, x]: any) => { (window as any).demo.wb.setDocStatus(d, x); }, [doc, s])
  .then(() => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
/** The paper scenario's König tabs (four, in both groups) and the one Sparse graphs tab. */
const docTabs = (page: any, doc: string) => page.evaluate((d: string) => [...document.querySelectorAll('.wb-root .wb-tab')]
  .filter((t) => { const W = (window as any).demo.wb; const tab = (window as any).demo.M.groups(W.layout.peek()).flatMap((g: any) => g.tabs).find((x: any) => x.id === (t as HTMLElement).dataset.tab); return tab?.state?.doc === d; })
  .map((t) => (t as HTMLElement).dataset.tab), doc);
const STATES: [string, any][] = [['typesetting', { typesetting: true }], ['1 error', { errors: 1 }], ['12 errors', { errors: 12 }], ['unsaved', { unsaved: true }], ['all three', { typesetting: true, errors: 2, unsaved: true }]];

group('document status in the tabs: always on, no option; each state on every tab of the document; names and tooltips', async () => {
  // always on: a store made with no option shows what the host sets (no switch: no tabStatus, no ?status); the demo's bar
  // has no status of its own
  {
    const page = await fresh({ query: 'fresh&scenario=paper&bar=1' });
    const r0 = await page.evaluate(() => ({ marks: document.querySelectorAll('.wb-st, .wb-status').length, option: 'tabStatus' in (window as any).demo.wb, bar: document.querySelector('.wb-bar')!.textContent }));
    check('idle and saved: no mark; the store has no tabStatus switch; the bar has no "Up to date" or "Saved"', r0.marks === 0 && !r0.option && !/Up to date|Saved/.test(r0.bar ?? ''), r0);
    await setStatus(page, 'konig', { typesetting: true, errors: 2, unsaved: true });
    const r = await page.evaluate(() => ({ layers: document.querySelectorAll('.wb-status--error').length, dots: document.querySelectorAll('.wb-st--unsaved').length, said: [...document.querySelectorAll('[role="tab"]')].filter((t) => t.getAttribute('aria-description') === 'typesetting, 2 errors, unsaved').length }));
    check('with no option: the four Kőnig tabs show the layer, the dot and the description', r.layers === 4 && r.dots === 4 && r.said === 4, r);
    await page.close();
  }
  const MARK: Record<string, string> = { typesetting: '.wb-status--run .wb-status-fill', error: '.wb-status--error', unsaved: '.wb-tab-close > .wb-st--unsaved' };
  const page = await fresh({ query: 'fresh&scenario=paper' });
  const konig = await docTabs(page, 'konig'), graphs = await docTabs(page, 'graphs');
  const names0 = await page.evaluate((ids: string[]) => ids.map((id) => document.querySelector(`[data-tab="${id}"] > [role="tab"]`)!.getAttribute('aria-label')), konig);
  check('the scenario has four Kőnig tabs and one Sparse graphs tab', konig.length === 4 && graphs.length === 1, { konig, graphs });
  check('idle and saved: no mark', await page.evaluate(() => document.querySelectorAll('.wb-st, .wb-status').length) === 0);
  for (const [kind, st] of [['typesetting', { typesetting: true }], ['error', { errors: 2 }], ['unsaved', { unsaved: true }]] as const) {
    await setStatus(page, 'konig', st);
    const r = await page.evaluate(([ids, sel, other]: any) => ({
      all: ids.every((id: string) => document.querySelector(`[data-tab="${id}"] ${sel}`)),
      notOther: !document.querySelector(`[data-tab="${other}"] :is(.wb-st, .wb-status)`),
      names: ids.map((id: string) => document.querySelector(`[data-tab="${id}"] > [role="tab"]`)!.getAttribute('aria-label')),
      descs: ids.map((id: string) => document.querySelector(`[data-tab="${id}"] > [role="tab"]`)!.getAttribute('aria-description')),
      tip: document.querySelector(`[data-tab="${ids[0]}"]`)!.getAttribute('title'),
      hidden: ids.every((id: string) => [...document.querySelectorAll(`[data-tab="${id}"] :is(.wb-st, .wb-status)`)].every((m) => m.getAttribute('aria-hidden') === 'true')),
    }), [konig, MARK[kind], graphs[0]]);
    const word = { typesetting: 'typesetting', error: '2 errors', unsaved: 'unsaved' }[kind], tip = { typesetting: 'Typesetting…', error: '2 blocks failed to typeset', unsaved: 'Unsaved changes' }[kind];
    check(`f, ${kind}: the mark (${MARK[kind]}) on all four Kőnig tabs, none on the other document's; marks hidden from the tree`, r.all && r.notOther && r.hidden, r);
    check(`f, ${kind}: every Kőnig tab's description is "${word}", its name unchanged ("document, section"); the tooltip says "${tip}"`, r.descs.every((d: string) => d === word) && r.names.every((n: string, i: number) => n === names0[i]) && r.tip.includes(tip), r);
  }
  await setStatus(page, 'graphs', { typesetting: true, errors: 1, unsaved: true });
  const all = await page.evaluate((g: string) => document.querySelector(`[data-tab="${g}"] > [role="tab"]`)!.getAttribute('aria-description'), graphs[0]);
  check('every state at once: the description "typesetting, 1 error, unsaved"', all === 'typesetting, 1 error, unsaved', all);
  await setStatus(page, 'graphs', {}); await setStatus(page, 'konig', {});
  const cleared = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.hasAttribute('aria-description')));
  check('idle and saved again: no description', !cleared);
  await page.close();
});

// ── unsaved: a filled dot in the × slot, one rule (VS Code): the × on hover or focus; saved: nothing
group('document status: unsaved is a dot in the × slot (f): the × on hover or with the keyboard in the tab; saved: no dot, and the hidden × takes no room', async () => {
  for (const look of ['f']) {
    const page = await fresh({ query: `fresh&scenario=paper&status=${look}` });
    const konig = await docTabs(page, 'konig');
    await page.mouse.move(1, 700);
    const at = () => page.evaluate((ids: string[]) => ids.map((id) => {
      const t = document.querySelector(`[data-tab="${id}"]`)!, x = t.querySelector('.wb-tab-close') as HTMLElement, dot = x.querySelector('.wb-st--unsaved'), svg = x.querySelector('svg')!;
      return { on: t.classList.contains('wb-tab--on'), slot: getComputedStyle(x).display !== 'none' ? +x.getBoundingClientRect().width.toFixed(1) : 0, dot: !!dot && getComputedStyle(dot).visibility === 'visible', x: getComputedStyle(svg).visibility === 'visible' && getComputedStyle(x).display !== 'none',
        lead: t.querySelectorAll('.wb-st-lead .wb-st--unsaved').length };
    }), konig);
    const saved = await at();
    await setStatus(page, 'konig', { unsaved: true });
    const uns = await at();
    const inact = konig.findIndex((_: any, i: number) => !uns[i].on);
    check(`${look}, saved: no dot; an inactive tab's × takes no room; the active tab shows its ×`, saved.every((s: any) => !s.dot && (s.on ? s.x : s.slot === 0)), saved);
    check(`${look}, unsaved: every tab of the document shows the dot in the × slot, not the ×; the slot there on the inactive ones too; no other unsaved mark`, uns.every((s: any) => s.dot && !s.x && s.slot > 0 && s.lead === 0), uns);
    const b = await page.locator(tabSel(konig[inact])).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const hov = (await at())[inact];
    await page.mouse.move(1, 700);
    // the keyboard in the tab: Tab onto the active tab's ×, and onto an inactive tab
    await page.focus(stopSel(konig[inact])); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const foc = (await at())[inact];
    check(`${look}, hover or the keyboard in the tab: the × instead of the dot, in the same slot`, hov.x && !hov.dot && hov.slot === uns[inact].slot && foc.x && !foc.dot, { hov, foc });
    await page.locator(':focus').blur();
    await setStatus(page, 'konig', {});
    check(`${look}, saved again: the dot and its slot are gone`, JSON.stringify(await at()) === JSON.stringify(saved), await at());
    await page.close();
  }
});

group('document status: the unsaved dot is --wb-dirty-dot wide, in its tab\'s name ink (active, inactive, unfocused-active), painted centred on the × (±0.5 px); four themes, two lines and one line, DPR 1 and 2', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) for (const form of ['two', 'one']) for (const dpr of theme === 'light' ? [1, 2] : [1]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 600 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto(`http://wb.test/?fresh&sides=0&bar=0&theme=${theme}`);
    await page.waitForSelector('.wb-tab');
    if (form === 'one') await oneLine(page);
    // the left group: lemma (inactive), graphs (inactive), Fruit; the right group focused: its active tab is the unfocused-active look's opposite
    for (const d of ['lemma', 'graphs']) await setStatus(page, d, { unsaved: true });
    await page.evaluate(() => { const W = (window as any).demo.wb, M = (window as any).demo.M; const g = M.groups(W.layout.peek())[0]; W.activate(g.tabs[1].id); W.focusGroup(M.groups(W.layout.peek())[1].id); });
    await page.mouse.move(1, 590);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.wb-tab:has(.wb-st--unsaved)')].map((t) => {
      const d = t.querySelector('.wb-st--unsaved')!, x = t.querySelector('.wb-tab-close')!, r = x.getBoundingClientRect(), dr = d.getBoundingClientRect();
      return { id: (t as HTMLElement).dataset.tab, on: t.classList.contains('wb-tab--on'), dot: getComputedStyle(d).backgroundColor, ink: getComputedStyle(t.querySelector('.wb-tab-label')!).color, size: [dr.width, dr.height], token: getComputedStyle(d).getPropertyValue('--wb-dirty-dot').trim(), box: { x: r.x, y: r.y, w: r.width, h: r.height } };
    }));
    const ink = async (b: any) => {
      const clip = { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.w), height: Math.ceil(b.h) };
      const png = decodePng(await page.screenshot({ clip })), bg = luma(png.px, 0); let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) if (Math.abs(luma(png.px, (y * png.w + x) * 4) - bg) > 30) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return [clip.x + (x0 + x1 + 1) / 2 / dpr, clip.y + (y0 + y1 + 1) / 2 / dpr, x1 - x0 + 1, y1 - y0 + 1];
    };
    const off: any[] = [];
    for (const t of tabs) {
      const d = await ink(t.box);
      await page.evaluate((id: string) => document.querySelector(`[data-tab="${id}"] .wb-st--unsaved`)!.setAttribute('style', 'visibility:hidden'), t.id);
      await page.evaluate((id: string) => document.querySelector(`[data-tab="${id}"] .wb-tab-close > svg`)!.setAttribute('style', 'visibility:visible'), t.id);
      const x = await ink(t.box);
      off.push({ on: t.on, dx: +(d[0] - x[0]).toFixed(2), dy: +(d[1] - x[1]).toFixed(2), device: [d[2], d[3]] });
    }
    check(`${theme}, ${form === 'one' ? 'one line' : 'two lines'}, DPR ${dpr}: the dot is --wb-dirty-dot (10 px) in its tab\'s name ink on every unsaved tab (${tabs.map((t: any) => t.on ? 'active' : 'inactive').join(', ')})`,
      tabs.length >= 2 && tabs.some((t: any) => t.on) && tabs.some((t: any) => !t.on) && tabs.every((t: any) => t.token === '10px' && t.size.every((v: number) => Math.abs(v - 10) < 0.01) && t.dot === t.ink), tabs);
    check(`… painted centred on the × in its slot (±0.5 px)${dpr === 2 ? '; painted 20 device px across (a 10 device px radius at DPR 2)' : ''}`, off.every((o) => Math.abs(o.dx) <= 0.5 && Math.abs(o.dy) <= 0.5 && (dpr !== 2 || o.device.every((v: number) => Math.abs(v - 20) <= 1))), off);
    await ctx.close();
  }
});

group('document status: no layout shift: every state, set and cleared, leaves every pill and its text where they were; two lines, one line, the top bar; f', async () => {
  for (const look of ['f']) for (const form of ['two', 'one', 'inbar']) {
    const page = await fresh(form === 'inbar' ? { w: 1600, query: `fresh&single&bar=1&status=${look}` } : { w: 1400, query: `fresh&scenario=paper&status=${look}` });
    if (form === 'inbar') {
      await page.evaluate(() => { const W = (window as any).demo.wb; for (const d of ['konig', 'graphs', 'streams']) W.open({ view: 'document', state: { doc: d } }); });
      await page.waitForFunction(() => !!document.querySelector('.wb-bar .wb-strip--inbar .wb-tab'));
    } else if (form === 'one') await oneLine(page);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const r0 = await pillBoxes(page);
    let worst = 0, at = '';
    const cmp = async (what: string) => { const r = await pillBoxes(page); r.forEach((q: number[], i: number) => q.forEach((v, k) => { const d = Math.abs(v - r0[i][k]); if (d > worst) { worst = d; at = `${what}: tab ${i}, ${['x', 'y', 'w', 'h', 'text x', 'text y'][k]}`; } })); };
    for (const [name, s] of STATES) for (const doc of ['konig', 'graphs']) {
      await setStatus(page, doc, s); await cmp(`${doc} ${name}`);
      await setStatus(page, doc, {}); await cmp(`${doc} ${name} cleared`);
    }
    const marks = await page.evaluate(() => document.querySelectorAll('.wb-st, .wb-st-line').length);
    check(`${look}, ${form === 'inbar' ? 'the top bar' : form === 'one' ? 'one line' : 'two lines'}: ${r0.length} pills: no box or text start moves (≤ 0.5 px) through ${STATES.length} states on two documents and back; none left`, worst <= 0.5 && marks === 0 && r0.length >= 4, { worst, at, marks });
    await page.close();
  }
});

// ── the status layer: the pill's background: a progress bar while typesetting, a danger tint with errors, the
//    bar full in the success colour and fading when a run ends well ──
async function fPage({ theme = 'light', reduce = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 500 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await page.goto(`http://wb.test/?fresh&scenario=paper&sides=0&bar=0&theme=${theme}`);
  await page.waitForSelector('.wb-tab');
  await page.mouse.move(1, 490);
  return { page, ctx };
}
const fScale = (page: any) => page.evaluate(() => [...document.querySelectorAll('.wb-status-fill')].map((e) => { const m = new DOMMatrix(getComputedStyle(e).transform); return +m.a.toFixed(4); }));
group('status: the progress bar: p = (1 − ε₂)[k/n + (1/n)(1 − ε)z(t)], eased, never backwards (a grown total holds it), short of the end until done; done: 100 % in the success colour, then gone; names; nothing moves', async () => {
  const { page, ctx } = await fPage();
  const r0 = await pillBoxes(page);
  await setStatus(page, 'konig', { typesetting: { done: 3, total: 10 } });
  await page.waitForTimeout(1200);     // (the creep at t ≈ 1.2 s: a value of the formula is checked, not the time)
  const s1 = await fScale(page);
  const name = await page.evaluate(() => document.querySelector('.wb-tab:has(.wb-status-fill) [role="tab"]')!.getAttribute('aria-description'));
  check('k 3 of 10 at ~1.2 s: every Kőnig pill filled past 3/10 and short of 4/10 (of the capped bar); "— typesetting"', s1.length === 4 && s1.every((v: number) => v > 0.93 * 0.3 + 0.01 && v < 0.93 * 0.4), { s1, name });
  check('… the description says it', name === 'typesetting', name);
  // a run, frame by frame: k rising, then the total growing mid-run: never backwards, never past 1 − ε₂
  const frames = await page.evaluate(async () => {
    const W = (window as any).demo.wb, out: number[] = [];
    const sample = () => { const e = document.querySelector('.wb-status-fill'); out.push(e ? new DOMMatrix(getComputedStyle(e).transform).a : -1); };
    for (let k = 3; k <= 8; k++) { W.setDocStatus('konig', { typesetting: { done: k, total: 10 } }); for (let i = 0; i < 8; i++) { await new Promise((r) => requestAnimationFrame(r)); sample(); } }
    W.setDocStatus('konig', { typesetting: { done: 8, total: 20 } });
    for (let i = 0; i < 20; i++) { await new Promise((r) => requestAnimationFrame(r)); sample(); }
    return out;
  });
  const mono = frames.every((v: number, i: number) => i === 0 || v >= frames[i - 1] - 1e-6);
  check('a run frame by frame: monotonic (also when the total grows from 10 to 20 mid-run: the bar holds), always below 1 − ε₂', mono && Math.max(...frames) < 0.93 && frames.at(-1) >= frames[5 * 8 - 1] - 1e-6, { n: frames.length, max: Math.max(...frames), last: frames.at(-1) });
  // done without errors: 100 % in the success colour, then it fades and goes
  const okColour = await page.evaluate(() => { const e = document.createElement('i'); e.style.color = 'color-mix(in srgb, var(--rfed-success) 24%, transparent)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; });
  const t0 = await page.evaluate(() => performance.now());
  await setStatus(page, 'konig', {});
  await page.waitForFunction(() => { const e = document.querySelector('.wb-status--done .wb-status-fill'); return !!e && new DOMMatrix(getComputedStyle(e).transform).a > 0.999; }, null, { timeout: 2000 });
  const full = await page.evaluate(() => { const e = document.querySelector('.wb-status--done .wb-status-fill')!; return { bg: getComputedStyle(e).backgroundColor, op: +getComputedStyle(e).opacity }; });
  check('done: the bar reaches 100 % in the success colour', full.bg === okColour && full.op > 0.9, { full, okColour });
  await page.waitForFunction(() => !document.querySelector('.wb-status'), null, { timeout: 4000 });
  const gone = await page.evaluate(() => performance.now()) - t0;
  check(`… then fades and goes: the normal pill (${Math.round(gone)} ms)`, gone >= 1400 && gone < 2500, gone);
  let worst = 0;
  for (const s of [{ typesetting: { done: 1, total: 4 } }, { errors: 3 }, { errors: 1, typesetting: { done: 0, total: 2 }, unsaved: true }, {}]) {
    await setStatus(page, 'graphs', s);
    const r = await pillBoxes(page); r.forEach((q: number[], i: number) => q.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - r0[i][k])); }));
  }
  check('no pill or text start moves through the states (≤ 0.5 px)', worst <= 0.5, worst);
  await ctx.close();
});
group('status: the active pill takes the bar and the tint at full height; an inactive one shows them as a band 6 device px tall along its bottom, clipped by the radius (DPR 1 and 2)', async () => {
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 500 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    page.on('pageerror', (e: Error) => check('no page error', false, e.message));
    await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
    await page.goto('http://wb.test/?fresh&scenario=paper&sides=0&bar=0');
    await page.waitForSelector('.wb-tab');
    await page.mouse.move(1, 490);
    const r = await page.evaluate(async () => {
      const W = (window as any).demo.wb;
      const tabs: any[] = [], walk = (n: any) => { if (!n) return; if (n.kind === 'group') tabs.push(...n.tabs); for (const c of n.children ?? []) walk(c); };
      walk(W.layout.value.root);
      const docs = [...new Set(tabs.map((t: any) => W.docOf(t)).filter(Boolean))];
      for (const d of docs) W.setDocStatus(d, { typesetting: { done: 5, total: 10 } });
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
      const fills = [...document.querySelectorAll('.wb-tab .wb-status-fill')].map((f) => { const tab = f.closest('.wb-tab')!, pill = f.parentElement!.getBoundingClientRect(), b = f.getBoundingClientRect();
        return { on: tab.classList.contains('wb-tab--on'), h: b.height, ph: pill.height, gap: pill.bottom - b.bottom }; });
      for (const d of docs) W.setDocStatus(d, { errors: 1 });
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
      const tints = [...document.querySelectorAll('.wb-tab .wb-status--error')].map((p) => { const on = p.closest('.wb-tab')!.classList.contains('wb-tab--on'), a = getComputedStyle(p, '::after');
        return { on, h: p.getBoundingClientRect().height, after: a.content === 'none' ? 0 : parseFloat(a.height) }; });
      return { fills, tints };
    });
    const on = r.fills.filter((f: any) => f.on), off = r.fills.filter((f: any) => !f.on);
    check(`DPR ${dpr}: the active pills' bars are the pill's height`, on.length > 0 && on.every((f: any) => Math.abs(f.h - f.ph) < 0.5), on);
    check(`DPR ${dpr}: the inactive pills' bars are 6 device px tall, flush with the pill's bottom`, off.length > 0 && off.every((f: any) => Math.abs(f.h * dpr - 6) < 0.5 && Math.abs(f.gap) < 0.5), off);
    const ton = r.tints.filter((t: any) => t.on), toff = r.tints.filter((t: any) => !t.on);
    check(`DPR ${dpr}: the error tint: the whole active pill, a 6 device px band on the inactive ones`, ton.length > 0 && toff.length > 0 && ton.every((t: any) => Math.abs(t.after - t.h) < 0.5) && toff.every((t: any) => Math.abs(t.after * dpr - 6) < 0.5), r.tints);
    // after the hold (shortened here) the active pill's tint settles down into the band
    await page.evaluate(() => document.querySelector('.wb-root')!.setAttribute('style', '--wb-status-err-hold: 0ms'));
    await page.evaluate(() => { for (const p of document.querySelectorAll('.wb-tab--on .wb-status--error')) { p.classList.remove('wb-status--error'); void (p as HTMLElement).offsetWidth; p.classList.add('wb-status--error'); } });
    await page.waitForFunction((d: number) => [...document.querySelectorAll('.wb-tab--on .wb-status--error')].every((p) => Math.abs(parseFloat(getComputedStyle(p, '::after').height) * d - 6) < 0.5), dpr, { timeout: 5000 }).then(() => check(`DPR ${dpr}: after the hold the active pill's tint settles into the 6 device px band`, true), (e: Error) => check(`DPR ${dpr}: after the hold the active pill's tint settles into the 6 device px band`, false, e.message));
    await ctx.close();
  }
});
group('status: the host picks the bar per run: full (the default) fills the active pill, band keeps the active pill to the 6 device px band as well; the success fill keeps the run\'s bar (DPR 2)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 500 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => route.fulfill(new URL(route.request().url()).pathname === '/demo.js' ? { body: JS, contentType: 'text/javascript' } : { body: HTML, contentType: 'text/html' }));
  await page.goto('http://wb.test/?fresh&scenario=paper&sides=0&bar=0');
  await page.waitForSelector('.wb-tab');
  await page.mouse.move(1, 490);
  const heights = (bar: string | null) => page.evaluate(async (bar: string | null) => {
    const W = (window as any).demo.wb, doc = W.docOf(W.current.peek().tab);
    const frames = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r)); };
    W.setDocStatus(doc, { typesetting: { done: 3, total: 10, ...(bar ? { bar } : {}) } });
    await frames();
    const f = document.querySelector('.wb-tab.wb-tab--on .wb-status-fill')!, p = f.parentElement!.getBoundingClientRect(), b = f.getBoundingClientRect();
    W.setDocStatus(doc, {});     // done: the success fill
    await frames();
    const d = document.querySelector('.wb-tab.wb-tab--on .wb-status--done .wb-status-fill')?.getBoundingClientRect();
    return { h: b.height, ph: p.height, done: d?.height ?? -1, gap: p.bottom - b.bottom };
  }, bar);
  const def = await heights(null), full = await heights('full'), band = await heights('band');
  check('no bar given: the active pill\'s bar fills it (a full render)', Math.abs(def.h - def.ph) < 0.5, def);
  check('bar: full: the same, its success fill too', Math.abs(full.h - full.ph) < 0.5 && Math.abs(full.done - full.ph) < 0.5, full);
  check('bar: band: the active pill shows the 6 device px band at its bottom, and so does its success fill', Math.abs(band.h * 2 - 6) < 0.5 && Math.abs(band.gap) < 0.5 && Math.abs(band.done * 2 - 6) < 0.5, band);
  await ctx.close();
});
group('status: the error tint keeps the text ≥ 4.5:1 (name and section, active and not; four themes); high contrast: hatched (a cue without colour); reduced motion: the steps only, no creep', async () => {
  for (const theme of ['light', 'dark', 'sepia', 'hc']) {
    const { page, ctx } = await fPage({ theme });
    await setStatus(page, 'konig', { errors: 2 });
    const r = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { willReadFrequently: true })!;
      const paint = (...l: string[]) => { x.clearRect(0, 0, 1, 1); for (const c of l) { x.fillStyle = c; x.fillRect(0, 0, 1, 1); } const d = x.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const lum = (s: string) => { const m = s.match(/[\d.]+/g)!.map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const con = (a: string, b: string) => { const p = lum(a), q = lum(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
      const pg = getComputedStyle(document.body).backgroundColor, out: any[] = [];
      for (const t of document.querySelectorAll('.wb-tab:has(.wb-status--error)')) {
        const strip = t.closest('.wb-strip')!, glass = (getComputedStyle(strip, '::before') as any).backgroundColor, pill = getComputedStyle(t).backgroundColor;
        const tint = t.classList.contains('wb-tab--on') ? getComputedStyle(t.querySelector('.wb-status')!, '::after').backgroundColor : 'transparent';   // the active pill's whole tint; an inactive one has only the band, below the text
        for (const sel of ['.wb-tab-label', '.wb-tab-sub']) {
          const ink = getComputedStyle(t.querySelector(sel)!).color;
          // over the strip at rest (the glass over the page): the tint's own effect (the glass's worst content is the
          // glass groups' test; sepia's section misses 4.5:1 there with no tint, a known gap)
          const bg = paint(pg, glass, pill, tint), worst = con(paint(bg, ink), bg);
          out.push({ on: t.classList.contains('wb-tab--on'), sel, c: +worst.toFixed(2) });
        }
      }
      const image = [...document.querySelectorAll('.wb-status--error')].map((pl) => { const own = getComputedStyle(pl).backgroundImage; return (own !== 'none' ? own : getComputedStyle(pl, '::after').backgroundImage).slice(0, 40); });   // the active pill itself, an inactive one's band
      return { out, image };
    });
    check(`${theme}: under the error tint every name and section ≥ 4.5:1 over the strip (active and not)`, r.out.length >= 4 && r.out.every((o: any) => o.c >= 4.5), r.out);
    if (theme === 'hc') check('hc: the error tint is hatched (a pattern: a cue without colour)', r.image.length > 0 && r.image.every((i: string) => /repeating-linear-gradient/.test(i)), r.image);
    await ctx.close();
  }
  const { page, ctx } = await fPage({ reduce: true });
  await setStatus(page, 'konig', { typesetting: { done: 2, total: 5 } });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const a = await fScale(page);
  await page.waitForTimeout(800);     // (time for a creep to show if there were one)
  const b = await fScale(page);
  check('reduced motion: the bar is the step alone, k/n of the capped bar, no creep over time', a.length > 0 && a.every((v: number) => Math.abs(v - 0.93 * 0.4) < 1e-3) && JSON.stringify(a) === JSON.stringify(b), { a, b });
  await ctx.close();
});
