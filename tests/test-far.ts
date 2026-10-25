// a far jump (the outline, Back) and End/Home/PageDown do not pass every block on the way: they jump to about one
// pane height before the target, then animate the last stretch from the target's side (nav/far.js, nav/keys.js).
//
//   node tests/test-far.ts dev [http://localhost:8150/] | file [dist/….html]
//
// For the long test document (the intro repeated) and the intro, in pane A alone and in pane B of the split (a pane's
// height: what is seen of it, below the glass strip):
//   - the outline's jump from the top to the last section: the blocks that came into view on the way are at most two
//     pane heights' worth (the target's neighbourhood), no long task (> 50 ms), the heading lands under the pane's top
//     (every heading can: the pane's end space); the last stretch moves towards the target (one way); Back returns to the top the same way
//   - End and Home, five times each, with the focus on the page: the same bound; End: the document's end at the pane's
//     bottom (not the end space below it), Home: the top
//   - one PageDown: one step, of which at most a third of the pane animates (the rest jumps at once)
//   - PageDown held (five presses in a row): one step each, no long task
//   - the end space: below the document's end, empty space of the pane's visible height (±1 px), in pane A and in pane B,
//     and after a window resize; scrolled to the end, the last section's heading can be at the reading line, and the
//     crumb names it until References' heading reaches the line (no rule of its own for the end of the scroll); End from
//     the very end comes back to the document's end at the pane's bottom
//   - End in a text field (the find bar) is left to the field
// Each document starts from the default layout (?fresh): its tab alone, pane A.
// Waits on events (nav:jumped, nav:back, nav:scrolled), whenIdle() and frames; never on fixed times. Long tasks are
// counted in the main thread's CPU time (tests/qa/lib/work.ts); --timing-strict counts them by the clock.
import { createRequire } from 'node:module';
import { paneA, splitB, closePane } from './qa/lib/panes.ts';
import { mkdtempSync } from 'node:fs';
import { docsHere, seedQuery } from './qa/lib/samples.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceWork, TIMING_STRICT, calibrate, calibrateAfter, budget, lim, gate } from './qa/lib/work.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const TARGET = argv[0] === 'file' ? 'file' : 'dev';
// (the URL or file may come first too: `test-x.ts http://127.0.0.1:8150/` is the dev app there)
const pos = argv.find((a, i) => !a.startsWith('--') && (i > 0 || !/^(dev|file)$/.test(a))) ?? null;
const URL0 = TARGET === 'file' ? `file://${pos ?? join(HERE, 'dist/reflowtex-editor.html')}` : `${(pos ?? 'http://localhost:8150/').replace(/\/?$/, '/')}?engine`;
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 600)}` : ''}`); if (!ok) fail++;
};
const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-far-')), { viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message.slice(0, 200)));
const sep = URL0.includes('?') ? '&' : '?';
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (k = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(0)); f(k); }), k);
// the panes: their selectors (SEL) and tab ids (P): pane A the document's tab, pane B the split's; each pane scrolls
const SEL: Record<string, string> = {}, P: Record<string, string> = {};
const idOf = (sel: string) => /data-pane="([^"]+)"/.exec(sel)![1];

// the recorder: per frame, the blocks in the pane's box (their document extent), the scroll position; long tasks
const RECORDER = () => {
  const w = window as any;
  w.__farRec = (sel: string) => {
    const sc = document.querySelector(sel) as HTMLElement;   // the pane is the scroller (its top under the glass bar: its scroll padding)
    const box = () => { const r = sc.getBoundingClientRect(); return { top: r.top + parseFloat(getComputedStyle(sc).scrollPaddingTop || '0'), bottom: r.bottom }; };
    const y = () => sc.scrollTop;
    const blocks = () => [...document.querySelectorAll(`${sel} .blocks > .blk`)] as HTMLElement[];
    const inView = () => { const b = box(); return blocks().filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > b.top && r.top < b.bottom; }); };
    const start = new Set(inView().map((el) => el.dataset.id));
    const seen = new Map<string, number>();
    const ys: number[] = [y()];
    const lt: number[] = [];
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(e.duration); });
    try { po.observe({ type: 'longtask', buffered: false }); } catch { /* no long tasks here */ }
    const paints0 = w.reflowtex?.inspect?.paints ?? 0;
    let stop = false;
    // the document's stretch that came into view, frame by frame: the union of the pane's box over the frames (the start's left out)
    const H = box().bottom - box().top, y0 = y();
    const spans: [number, number][] = [];
    const f = () => { if (stop) return; const yy = y(); ys.push(yy); spans.push([yy, yy + H]); for (const el of inView()) if (!start.has(el.dataset.id)) seen.set(el.dataset.id!, 1); requestAnimationFrame(f); };
    requestAnimationFrame(f);
    return { stop() { stop = true; po.disconnect(); const b = box(); const u: [number, number][] = []; for (const [a, b2] of spans.sort((p, q) => p[0] - q[0])) { if (u.length && a <= u[u.length - 1][1]) u[u.length - 1][1] = Math.max(u[u.length - 1][1], b2); else u.push([a, b2]); }
      let px = 0; for (const [a, b2] of u) px += Math.max(0, Math.min(b2, Math.max(a, y0 + H)) - a) === b2 - a ? 0 : (b2 - Math.max(a, Math.min(b2, y0 + H)) + Math.max(0, Math.min(b2, y0) - a));
      return { seenPx: px, seen: seen.size, paneH: b.bottom - b.top, ys, long: lt, paints: (w.reflowtex?.inspect?.paints ?? 0) - paints0, y: y() }; } };
  };
};
// "long" is the tasks over 50 ms of the main thread's CPU time (a trace of the window, tests/qa/lib/work.ts),
// which load does not stretch; with --timing-strict it is the long tasks by the clock (the PerformanceObserver's), as
// before. The other one is printed whenever they disagree.
async function measure(sel: string, act: () => Promise<unknown>) {
  await calibrate(page);                                         // the factor before the window (re-measured after 30 s)
  await page.mouse.move(120, 880);
  await page.evaluate((s: string) => { (window as any).__r = (window as any).__farRec(s); }, sel);
  const work = await traceWork(page, async () => { await act(); await idle(); await frames(4); });
  const r = await page.evaluate(() => (window as any).__r.stop());
  await calibrateAfter(page);                                    // and after it: the checks use the higher of the two
  const cpu = work.long(50).map((t) => t.cpu), wall: number[] = r.long;
  if (cpu.length !== wall.filter((d) => d > 50).length) console.log(`wall ${wall.some((d) => d > 50) ? 'OVER' : 'ok  '} long tasks by the clock ${JSON.stringify(wall.map(Math.round))}, by CPU ${JSON.stringify(cpu.map(Math.round))}${TIMING_STRICT ? ' (the clock gates: --timing-strict)' : ' (CPU gates)'}`);
  return { ...r, long: TIMING_STRICT ? wall : cpu, wallLong: wall };
}
/** the animated part goes one way (towards the target): no reversal over 1 px */
const oneWay = (ys: number[]) => { let dir = 0, worst = 0; for (let i = 1; i < ys.length; i++) { const d = ys[i] - ys[i - 1]; if (Math.abs(d) < 0.5) continue; if (!dir) dir = Math.sign(d); else if (Math.sign(d) !== dir) worst = Math.max(worst, Math.abs(d)); } return worst; };
const onEvent = async (name: string, act: () => Promise<unknown>) => {
  await page.evaluate((nm: string) => { (window as any).__ev = new Promise((res) => document.addEventListener(nm, (e: any) => res(e.detail ?? {}), { once: true })); }, name);
  await act();
  return page.evaluate(() => Promise.race([(window as any).__ev, new Promise((_, rej) => setTimeout(() => rej(new Error('event timeout')), 30000))]));
};
// a first visit to a place: the viewer lays out and paints about three pane heights there at once (its
// observer's margin is 100 %: the view, one above, one below), a task of 50–70 ms in a long paper on a laptop
// arrival may have tasks up to 100 ms (the viewer's; a public-viewer request); the same way again (the places painted)
// none over 50 ms: that is what the navigation itself costs.
// the limits in CPU time are scaled by the host's factor (calibrate); the clock's, with --timing-strict, are not
const LONG = () => (TIMING_STRICT ? 50 : budget(50)), FIRST = () => (TIMING_STRICT ? 100 : budget(100));
const L = (ms: number) => (TIMING_STRICT ? `${ms} ms` : lim(ms));
const over = (long: number[]) => long.some((d) => d > LONG());
const firstArrivalOk = (long: number[]) => long.every((d) => d <= FIRST());
const bound = (r: any) => r.seenPx <= 2.05 * r.paneH;          // about two pane heights of the document came into view, at most (the window counts from the top bar)

// a pane's scroll position and where the document's end ("Add a block" after the last block) is: its bottom less the
// pane's bottom (0: End's place), less the pane's visible top (0: as far as the pane scrolls); the space below it
// and the pane's visible height (below the glass strip)
const END_AT = (s: string) => {
  const sc = document.querySelector(s) as HTMLElement, end = sc.querySelector(':scope > .add-end-host')!.getBoundingClientRect().bottom;
  const r = sc.getBoundingClientRect(), pad = parseFloat(getComputedStyle(sc).scrollPaddingTop || '0');
  return { y: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, end: end - (r.top + sc.clientHeight), fromTop: end - (r.top + pad),
    space: sc.scrollHeight - (end - r.top + sc.scrollTop), seenH: sc.clientHeight - pad };
};
// pane sel's crumb (its tab's section: one line or two); a heading put dy px under the pane's visible top (where it went)
const crumbOf = (s: string) => page.evaluate((t: string) => document.querySelector(`[data-tab="${t}"] :is(.wb-tab-sec, .wb-tab-sub-label)`)?.textContent?.trim() ?? '', idOf(s));
const scrollHeadingTo = (s: string, id: string, dy: number) => page.evaluate(([q, i, d]: any) => {
  const sc = document.querySelector(q) as HTMLElement, el = sc.querySelector(`.blk[data-id="${i}"]`)!;
  const top = sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(sc).scrollPaddingTop || '0') || 0);
  sc.scrollTop += el.getBoundingClientRect().top - (top + d);
  return el.getBoundingClientRect().top - top;
}, [s, id, dy]);
const READ_LINE = 64;   // the reading line under the pane's visible top (docview/pane-bar.js)

for (const doc of docsHere(['long', 'intro'])) {
  await page.goto('about:blank');
  // ?fresh: the default layout, this document's tab alone. Without it the page restores the last layout (the
  // previous document's tab; a release ignores ?store=memory, so that document is still in its store) and opens this
  // one beside it: pane A, the first document tab, would be the previous document's pane, not this one's
  await page.goto(`${URL0}${sep}${seedQuery(doc)}store=memory&fresh#/doc/${doc}`);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && document.querySelectorAll('[data-part="page"] .blocks > .blk').length > 20);
  await idle();
  SEL.a = await paneA(page); P.a = idOf(SEL.a);
  await page.evaluate(RECORDER);
  for (const p of ['a', 'b']) {
    if (p === 'b') { SEL.b = await splitB(page); P.b = idOf(SEL.b); await idle(); }
    const sel = SEL[p];
    const tag = `${doc} [${p}]`;
    const toTop = () => page.evaluate((s: string) => { const sc = document.querySelector(s) as HTMLElement; if (sc) sc.scrollTop = 0; else scrollTo(0, 0); }, sel);
    await toTop(); await frames(3);
    // the outline's jump to the last section, from the top
    const last = await page.evaluate(() => { const o = (window as any).editorAPI.outline().filter((x: any) => !x.special && x.level === 1); return o[o.length - 1]?.id; });
    const r = await measure(sel, () => onEvent('nav:jumped', () => page.evaluate(([i, pp]: string[]) => (window as any).editorAPI.nav().goTo(i, { pane: pp }), [last, P[p]])));
    const land = await page.evaluate(([s, i]: string[]) => { const sc = document.querySelector(s) as HTMLElement; const el = sc.querySelector(`.blk[data-id="${i}"]`)!; const pad = parseFloat(getComputedStyle(sc).scrollPaddingTop || '0'); return el.getBoundingClientRect().top - (sc.getBoundingClientRect().top + pad); }, [sel, last]);
    check(`${tag}: a jump to the last section passes no blocks on the way (${Math.round(r.seenPx)} px of blocks seen, pane ${Math.round(r.paneH)} px; ${r.paints} paints)`, bound(r), { seen: r.seen, seenPx: Math.round(r.seenPx) });
    gate(check, `${tag}: … no long task on the way (a first arrival: at most one, ≤ ${L(100)})`, firstArrivalOk(r.long), r.long.map(Math.round));
    check(`${tag}: … the heading lands under the pane's top (0–24 px)`, land >= -1 && land <= 24, { land });
    const anim = r.ys.slice(r.ys.findIndex((y: number, i: number) => i > 0 && Math.abs(y - r.ys[i - 1]) > 200) + 1);
    check(`${tag}: … the last stretch moves towards the target, one way`, oneWay(anim) <= 1 && anim.length > 3, { back: oneWay(anim), frames: anim.length });
    const b = await measure(sel, () => onEvent('nav:back', () => page.evaluate(() => (window as any).editorAPI.nav().back())));
    // the same jump again: the places are painted now, so only the navigation's own work is left
    const again = await measure(sel, () => onEvent('nav:jumped', () => page.evaluate(([i, pp]: string[]) => (window as any).editorAPI.nav().goTo(i, { pane: pp }), [last, P[p]])));
    gate(check, `${tag}: the same jump again: no long task (> ${L(50)}), no blocks passed`, !over(again.long), { long: again.long.map(Math.round), seenPx: Math.round(again.seenPx) }, { behaviourOk: bound(again) });
    await onEvent('nav:back', () => page.evaluate(() => (window as any).editorAPI.nav().back()));
    gate(check, `${tag}: Back returns to the top the same way (y ${Math.round(b.y)}; ${Math.round(b.seenPx)} px of blocks seen), no long task (> ${L(50)})`, !over(b.long), { y: b.y, seenPx: Math.round(b.seenPx), long: b.long }, { behaviourOk: Math.abs(b.y) <= 10 && bound(b) });
    // End and Home, five times, the focus on the page
    const focusPage = () => page.evaluate((s: string) => { (document.activeElement as HTMLElement)?.blur?.(); const sc = document.querySelector(s) as HTMLElement; if (sc) { sc.tabIndex = -1; sc.focus({ preventScroll: true }); } }, sel);
    const bad: any[] = [], slow: any[] = [];
    for (let k = 0; k < 5; k++) {
      for (const key of ['End', 'Home']) {
        await focusPage();
        const m = await measure(sel, () => onEvent('nav:scrolled', () => page.keyboard.press(key)));
        const at = await page.evaluate(END_AT, sel);
        const reached = key === 'End' ? Math.abs(at.end) <= 2 : at.y <= 2;
        const row = { k, key, seenPx: Math.round(m.seenPx), long: m.long.map(Math.round), at };
        if (!bound(m) || !reached) bad.push(row);
        else if (k === 0 ? !firstArrivalOk(m.long) : over(m.long)) slow.push(row);
      }
    }
    gate(check, `${tag}: End and Home ×5: no blocks passed, no long task (> ${L(50)}; the first End: its arrival, ≤ ${L(100)}), the document's end at the pane's bottom / the top reached`, slow.length === 0, [...bad, ...slow].slice(0, 3), { behaviourOk: bad.length === 0 });
    // one PageDown: jumps, then animates only the last third of a pane
    await focusPage();
    const one = await measure(sel, () => onEvent('nav:scrolled', () => page.keyboard.press('PageDown')));
    const moved1 = one.ys.findIndex((y: number) => Math.abs(y - one.ys[0]) > 0.5);
    const animated = Math.abs(one.y - one.ys[Math.max(1, moved1)]), total = one.y - one.ys[0];
    check(`${tag}: one PageDown: one step (${Math.round(total)} px), animated at most a third of the pane (${Math.round(animated)} px of ${Math.round(one.paneH)})`, Math.abs(total - 0.875 * one.paneH) <= 0.05 * one.paneH && animated <= 1.05 * one.paneH / 3 && one.ys.length > 3, { total, animated, ys: one.ys.slice(0, 6).map(Math.round) });
    await toTop(); await frames(3);
    // PageDown held: five presses in a row add up, one step each
    await focusPage();
    const y0 = await page.evaluate((s: string) => { const sc = document.querySelector(s) as HTMLElement; return sc ? sc.scrollTop : scrollY; }, sel);
    const held = () => measure(sel, async () => { for (let k = 0; k < 5; k++) await page.keyboard.press('PageDown'); await page.evaluate(() => new Promise((r) => document.addEventListener('nav:scrolled', r, { once: true }))); });
    const pd = await held();
    gate(check, `${tag}: PageDown ×5 held: five steps (${Math.round(pd.y - y0)} px), no long task over ${L(100)} (a first visit: the viewer's paint)`, firstArrivalOk(pd.long), { moved: pd.y - y0, paneH: pd.paneH, long: pd.long }, { behaviourOk: Math.abs(pd.y - y0 - 5 * 0.875 * pd.paneH) <= 0.2 * pd.paneH });
    // the same stretch again (painted): no long task
    await focusPage();
    await page.evaluate(([s, y]: any) => { const sc = document.querySelector(s) as HTMLElement; if (sc) sc.scrollTop = y; else scrollTo(0, y); }, [sel, y0]);
    await frames(3);
    const pd2 = await held();
    gate(check, `${tag}: … the same five steps again: no long task (> ${L(50)})`, !over(pd2.long), pd2.long);
    // the end space, here and after a window resize (the pane's visible height follows it)
    for (const size of [null, { width: 1180, height: 720 }]) {
      if (size) { await page.setViewportSize(size); await idle(); await frames(4); }
      const e = await page.evaluate(END_AT, sel);
      check(`${tag}: the end space is the pane's visible height (±1 px)${size ? `, after a resize to ${size.width}×${size.height}` : ''}`, Math.abs(e.space - e.seenH) <= 1, e);
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await idle(); await frames(4);
    // scrolled to the end: the last section's heading at the reading line is the crumb's section; References' heading
    // just under the line: still the last section; at the line: References; the very end: the end at the pane's top
    const ol = await page.evaluate(() => (window as any).editorAPI.outline().map((o: any) => ({ id: o.id, title: o.title, special: !!o.special, level: o.level })));
    const sec = [...ol].reverse().find((o: any) => !o.special && o.level === 1), refs = ol[ol.length - 1];
    const crumbs: Record<string, unknown> = {};
    for (const [name, id, dy] of [['last section at the line', sec.id, READ_LINE - 2], ['References under the line', refs.id, READ_LINE + 20], ['References at the line', refs.id, READ_LINE - 2]] as const) {
      const at = await scrollHeadingTo(sel, id, dy); await frames(3);
      crumbs[name] = { at: Math.round(at), crumb: await crumbOf(sel) };
    }
    await page.evaluate((s: string) => { const sc = document.querySelector(s) as HTMLElement; sc.scrollTop = sc.scrollHeight; }, sel); await frames(3);
    const maxed = await page.evaluate(END_AT, sel);
    crumbs.end = { fromTop: Math.round(maxed.fromTop), crumb: await crumbOf(sel) };
    const c = crumbs as Record<string, { at?: number; crumb: string; fromTop?: number }>;
    check(`${tag}: the end: "${sec.title}" reaches the reading line and is the crumb's section until References' heading reaches the line`,
      refs.special && Math.abs(c['last section at the line'].at! - (READ_LINE - 2)) <= 1 && c['last section at the line'].crumb.includes(sec.title)
      && c['References under the line'].crumb.includes(sec.title) && /References/.test(c['References at the line'].crumb)
      && /References/.test(c.end.crumb) && Math.abs(c.end.fromTop!) <= 1, crumbs);
    // End from the very end: back to the document's end at the pane's bottom
    await focusPage();
    await onEvent('nav:scrolled', () => page.keyboard.press('End'));
    const back = await page.evaluate(END_AT, sel);
    check(`${tag}: End from the very end: the document's end at the pane's bottom (±2 px)`, Math.abs(back.end) <= 2 && back.y < back.max - 100, back);
    if (p === 'b') { await closePane(page, SEL.b); await idle(); }
  }
  // End in a text field is the field's
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const inField = await page.waitForSelector('.find-bar input', { timeout: 5000 }).then(() => true, () => false);
  if (inField) {
    await page.fill('.find-bar input', 'abc');
    const y1 = await page.evaluate(() => document.querySelector('[data-part="page"]')!.scrollTop);
    await page.keyboard.press('Home');
    await frames(10);
    const st = await page.evaluate(() => ({ y: document.querySelector('[data-part="page"]')!.scrollTop, caret: (document.activeElement as HTMLInputElement).selectionStart }));
    check(`${doc}: Home in the find bar moves its caret, not the page`, st.y === y1 && st.caret === 0, { ...st, y1 });
    await page.keyboard.press('Escape');
  }
}
check('no page errors', errors.length === 0, errors);
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
