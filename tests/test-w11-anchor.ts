// the page holds still while blocks above the reader typeset (scroll
// anchoring). The single file on the long test document (?seed=long: the intro repeated), empty store (every block
// compiles):
//   1. jump: at once after opening, a late section through the outline; its
//      heading's viewport y sampled every frame until everything is typeset;
//   2. by hand: a fresh open, wheel down mid-compile; the block at the top of
//      the viewport sampled the same way.
// Pass: max deviation ≤ 1 px from where the jump / scroll left it.
//
//   node tests/test-w11-anchor.ts [--html /tmp/w11/after.html] [--browser chromium|firefox|webkit] [--motion] [--label x]
//   (--motion: without reduced motion, so the outline's jump is a smooth scroll)
// Results: test-results/w11/anchor-<browser>[-label]/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const BROWSER = flag('--browser') ?? 'chromium';
const HTML = flag('--html') ?? '/tmp/w11/after.html';
const MOTION = argv.includes('--motion');
const LABEL = flag('--label');
const OUT = join(resultsDir(HERE), 'w11', `anchor-${BROWSER}${LABEL ? `-${LABEL}` : ''}`);
mkdirSync(OUT, { recursive: true });
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 500)}` : ''}`);
};

/** a fresh page on an empty store, the long document open, its first block typeset */
async function openFresh(tag: string) {
  const dir = `/tmp/w11-anchor-${BROWSER}-${tag}-${process.pid}`;
  rmSync(dir, { recursive: true, force: true });
  const ctx = await pw[BROWSER].launchPersistentContext(dir, { viewport: { width: 1280, height: 900 }, reducedMotion: MOTION ? 'no-preference' : 'reduce' });
  await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
  // the premise "every block compiles" made true: a release carries a seed cache (the
  // paper opens with 0 compiles), so without this the blocks above only wait to be mounted and a
  // slower (smooth) jump could finish after they had all landed: a vacuous pass or a FAIL on
  // pendingAtStart. The boot script's globalThis.__rtxEditor is caught as it is set and its
  // seedCache dropped; nothing in the page changes otherwise.
  // the scroller: the focused pane (the workbench's window never scrolls), else the page's
  await ctx.addInitScript(() => { (globalThis as any).PANE = () => document.querySelector('main.rtx-pane[data-part="page"]') ?? document.scrollingElement; });
  await ctx.addInitScript(() => {
    Object.defineProperty(globalThis, '__rtxEditor', {
      configurable: true,
      get() { return undefined; },
      set(v: any) { if (v) v.seedCache = null; Object.defineProperty(globalThis, '__rtxEditor', { value: v, writable: true, configurable: true }); },
    });
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.setDefaultTimeout(600000);
  page.on('crash', () => { console.error('FAIL the page crashed'); process.exit(3); });
  await page.goto(`file://${HTML}?seed=long#/doc/long`);
  await page.waitForFunction(() => document.querySelectorAll('.blk[data-state="ok"]').length >= 1, null, { timeout: 300000 });
  return { ctx, page, dir };
}

/** every frame: the element's viewport top as painted, until all blocks are typeset and the app is idle.
 *  Read at the last step before paint: in a ResizeObserver callback of an observer made after
 *  the app's (callbacks run in the order the observers were made, after layout), fired every frame by a
 *  1-px probe whose width flips in requestAnimationFrame. Inside a rAF callback the page can be seen
 *  before the anchor keeper's ResizeObserver puts it back in the same frame (a jump nobody sees); after
 *  paint, a later task may already have changed it (the same). */
const SAMPLE = `(sel, maxFrames = Infinity) => new Promise((res) => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  let next = null, flip = false;
  const ro = new ResizeObserver(() => { const fn = next; next = null; fn?.(); });
  ro.observe(probe);
  const afterPaint = (fn) => { next = fn; requestAnimationFrame(() => { flip = !flip; probe.style.width = flip ? '2px' : '1px'; }); };
  const finish = (v) => { ro.disconnect(); probe.remove(); res(v); };
  const el = document.querySelector(sel);
  const out = { ys: [], states: [], t0: performance.now(), scrolls: 0, why: [] };
  const all = () => [...document.querySelectorAll('.blk')];
  // a block's height and its margin-top (the gap above it, from the engine's spacing data): either moves what is below
  const box = (b) => [b.getBoundingClientRect().height, parseFloat(getComputedStyle(b).marginTop) || 0];
  let hs = new Map(all().map((b) => [b, box(b)]));
  addEventListener('scroll', () => out.scrolls++, { passive: true });
  let done = false;
  window.editorAPI.whenIdle().then(() => { done = true; });
  const f = () => {
    const y = el.getBoundingClientRect().top;
    const prev = out.ys[out.ys.length - 1];
    out.ys.push(Math.round(y * 10) / 10);
    const blocks = all(), me = blocks.indexOf(el.closest('.blk') ?? el);
    const now = new Map(blocks.map((b) => [b, box(b)]));
    // a jump: which blocks changed height or the gap above them in this frame (index relative to the sampled one,
    // state, kind, height px, gap px), and the keeper's anchor then
    const r1 = (v) => Math.round(v * 10) / 10;
    if (prev !== undefined && Math.abs(y - prev) > 1 && out.why.length < 12)
      out.why.push({ frame: out.ys.length - 1, dy: r1(y - prev), scrollY: PANE().scrollTop, keeper: window.editorAPI?.keeper?.()?.stats?.().anchor ?? null,
        changed: blocks.map((b, i) => { const [h0, m0] = hs.get(b) ?? [0, 0], [h1, m1] = now.get(b); return [i - me, b.dataset.state, b.dataset.kind, r1(h1 - h0), r1(m1 - m0)]; })
          .filter((x) => Math.abs(x[3]) > 0.5 || Math.abs(x[4]) > 0.5).slice(0, 8) });
    hs = now;
    const pend = document.querySelectorAll('.blk[data-state="pending"]').length;
    out.states.push(pend);
    if ((done && !pend) || out.ys.length >= maxFrames) { out.scrollEnd = PANE().scrollTop; finish(out); return; }
    afterPaint(f);
  };
  afterPaint(f);
})`;
/** after an input that scrolls (an outline click, a wheel): resolves once that scroll has ended, so measuring
 *  starts where it left the page. "Two frames at the same y" was not enough: it also holds before a scroll
 *  has begun, or in a stall of it, and a smooth jump then went on under the measurement (58–86 px "jumps").
 *  Now: the scroll has begun (the watched value moved from its value before the input; or, for an element,
 *  it is already at its scroll-margin target; or the page is at its end) and then held within 0.5 px for 3
 *  frames. 120 still frames without that end it too (the scroll never happened: the checks then say so).
 *  sel: the element whose viewport top is watched (null: PANE().scrollTop); start: its value before the input. */
const SETTLE = `(sel, start) => new Promise((res) => {
  const el = sel ? document.querySelector(sel) : null;
  const read = () => (el ? el.getBoundingClientRect().top : PANE().scrollTop);
  // in a pane: its visible top (below the glass: its scroll padding) and the reveal's margin; else the heading's scroll margin
  const pane = el?.closest('main.rtx-pane');
  const want = el ? (pane ? pane.getBoundingClientRect().top + (parseFloat(getComputedStyle(pane).scrollPaddingTop) || 0) + 8 : parseFloat(getComputedStyle(el).scrollMarginTop) || 0) : null;
  const maxed = () => Math.abs(PANE().scrollTop + PANE().clientHeight - PANE().scrollHeight) < 2;
  let last = NaN, same = 0, frames = 0, scrolls = 0;
  const onScroll = () => scrolls++;
  addEventListener('scroll', onScroll, { passive: true });
  const f = () => {
    frames++;
    const y = read();
    same = Math.abs(y - last) < 0.5 ? same + 1 : 0;
    last = y;
    const begun = Math.abs(y - start) > 1 || (want !== null && Math.abs(y - want) <= 1) || maxed();
    if ((begun && same >= 3) || same >= 120) { removeEventListener('scroll', onScroll); res({ y, want, start, frames, scrolls, begun, maxed: maxed(), pending: document.querySelectorAll('.blk[data-state="pending"]').length }); }
    else requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
})`;
const topOf = (page: any, sel: string) => page.evaluate((q: string) => document.querySelector(q)!.getBoundingClientRect().top, sel);
function deviation(ys: number[], states: number[]) {
  const ref = ys[0];
  let max = 0, at = 0;
  ys.forEach((y, i) => { const d = Math.abs(y - ref); if (d > max) { max = d; at = i; } });
  const jumps = ys.filter((y, i) => i && Math.abs(y - ys[i - 1]) > 1).length;
  return { ref, max: Math.round(max * 10) / 10, at, frames: ys.length, jumps, pendingAtStart: states[0], pendingAtMax: states[at] };
}
const whyOf = (s: any) => s.why;

const report: any = { browser: BROWSER, html: HTML, motion: MOTION };

// ── 0. the wait itself: a scroll that starts late and glides must be waited out ──
// (a plain page: a heading 5000 px down; nothing moves for 12 frames, then a 40-frame glide to y = 64, as the
// app's reveal does under load). The old wait, "two frames at the same y", returned before the glide began.
{
  const ctx = await pw[BROWSER].launch().then((b: any) => b.newContext({ viewport: { width: 800, height: 600 } }));
  await ctx.addInitScript(() => { (globalThis as any).PANE = () => document.scrollingElement; });
  const page = await ctx.newPage();
  await page.setContent('<div style="height:5000px"></div><h2 id="t" style="scroll-margin-top:64px;margin:0">t</h2><div style="height:5000px"></div>');
  const y0 = await topOf(page, '#t');
  const [st] = await Promise.all([
    page.evaluate(`(${SETTLE})('#t', ${y0})`),
    page.evaluate(() => { let n = 0; const from = PANE().scrollTop, to = from + document.getElementById('t')!.getBoundingClientRect().top - 64;
      const f = () => { n++; if (n > 12) PANE().scrollTo(0, from + (to - from) * Math.min(1, (n - 12) / 40)); if (n < 52) requestAnimationFrame(f); }; requestAnimationFrame(f); }),
  ]);
  check('the wait: a scroll that starts 12 frames late is waited out to its end', Math.abs((st as any).y - 64) <= 0.5 && (st as any).frames >= 52, st);
  await ctx.browser().close();
}

// ── 1. jump through the outline ─────────────────────────────────────────────
{
  const { ctx, page, dir } = await openFresh('jump');
  // a late section: the last numbered top-level section before the appendix / references
  const target = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#panel-outline .ol-item.lv1:not(.special)')] as HTMLElement[];
    const it = items[Math.max(0, items.length - 2)];
    return it ? { id: it.dataset.id, k: it.dataset.k, title: it.textContent } : null;
  });
  check('the outline has a late section', !!target, target);
  if (target) {
    const sel = `.blk[data-id="${target.id}"]`;
    const y0 = await topOf(page, sel);
    await page.click(`#panel-outline .ol-item[data-k="${target.k}"] .ol-link`);
    // the jump itself: until it has ended (SETTLE), so the measurement starts where it put the heading
    const st: any = await page.evaluate(`(${SETTLE})('${sel}', ${y0})`);
    report.jumpSettle = st;
    check('jump: the heading arrived at the top, below the top bar (≤ 4 px)', st.begun && Math.abs(st.y - st.want) <= 4, st);
    const s: any = await page.evaluate(`(${SAMPLE})('.blk[data-id="${target.id}"]')`);
    const d = deviation(s.ys, s.states);
    report.jump = { target, ...d, scrolls: s.scrolls, why: whyOf(s) };
    console.log('  keeper', JSON.stringify(await page.evaluate(() => ({ k: (window as any).editorAPI?.keeper?.()?.stats(), bar: document.querySelector('.topbar')?.getBoundingClientRect().bottom }))), 'target', target.id);
    for (const w of whyOf(s)) console.log('  jump', JSON.stringify(w));
    console.log('  ys', s.ys.filter((_y: number, i: number) => i % 60 === 0).join(' '));
    check('jump: the section stays where the jump put it (≤ 1 px) while the blocks above typeset', d.max <= 1 && d.pendingAtStart > 10, d);
    await page.screenshot({ path: join(OUT, 'jump-end.png') });
  }
  await ctx.close(); rmSync(dir, { recursive: true, force: true });
}

// ── 2. scroll by hand mid-compile ───────────────────────────────────────────
{
  const { ctx, page, dir } = await openFresh('wheel');
  await page.waitForFunction(() => document.querySelectorAll('.blk[data-state="ok"]').length >= 12, null, { timeout: 300000 });
  await page.mouse.move(640, 500);
  const sy0 = await page.evaluate(() => PANE().scrollTop);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, 900);
  const ws: any = await page.evaluate(`(${SETTLE})(null, ${sy0})`);
  check('the wheel scrolled the page', ws.begun, ws);
  // the block being read: the first that starts at or below the pane's visible top (below its glass strip: its
  // scroll padding), as the reader sees it. A fixed y (60 px, the window's top bar) took the next block when one
  // started between the strip and that line, and that block moved as the one above it, in view, typeset.
  const id = await page.evaluate(() => {
    const P = PANE(), top = P.getBoundingClientRect().top + (parseFloat(getComputedStyle(P).scrollPaddingTop) || 0);
    const el = [...P.querySelectorAll('.blk')].find((e) => { const r = e.getBoundingClientRect(); return r.top >= top - 2 && r.top < innerHeight / 2; }) as HTMLElement | undefined;
    return el?.dataset.id ?? null;
  });
  check('a block at the top of the viewport after scrolling', !!id, id);
  // the keeper's reading point is that block (its rule and the reader's view agree)
  const held = await page.evaluate(() => (window as any).editorAPI?.keeper?.()?.stats?.().anchor?.id ?? null);
  check('by hand: the keeper holds the block at the top of the viewport', !!id && held === id, { id, held });
  if (id) {
    const s: any = await page.evaluate(`(${SAMPLE})('.blk[data-id="${id}"]')`);
    const d = deviation(s.ys, s.states);
    report.wheel = { id, scrollY: await page.evaluate(() => PANE().scrollTop), ...d, why: whyOf(s) };
    for (const w of whyOf(s)) console.log('  jump', JSON.stringify(w));
    check('by hand: the block at the top stays put (≤ 1 px) while the blocks above typeset', d.max <= 1 && d.pendingAtStart > 10, d);
  }
  // a scroll without input (the app's or a test's scrollIntoView) is where the reader goes: never undone
  const prog = await page.evaluate(async () => {
    const all = [...document.querySelectorAll('.blk')] as HTMLElement[];
    const el = all[Math.floor(all.length * 0.3)];
    el.scrollIntoView({ block: 'start' });
    const y0 = el.getBoundingClientRect().top;
    for (let k = 0; k < 20; k++) await new Promise((r) => requestAnimationFrame(r));
    return { y0, y1: el.getBoundingClientRect().top };
  });
  check('a programmatic scroll is kept (not pulled back to the old anchor)', Math.abs(prog.y1 - prog.y0) < 50, prog);
  await ctx.close(); rmSync(dir, { recursive: true, force: true });
}

// ── 3. every outline entry, clicked while the paper typesets ─────────────────
{
  const { ctx, page, dir } = await openFresh('outline');
  const items: { id: string; k: string; title: string }[] = await page.evaluate(() => [...document.querySelectorAll('#panel-outline .ol-item')]
    .map((li: any) => ({ id: li.dataset.id, k: li.dataset.k, title: (li.textContent ?? '').slice(0, 40) })));
  // (the y before the click is read by clickRest; rest() alone is for a heading already there)
  const rest = async (id: string, start?: number) => { const sel = `.blk[data-id="${id}"]`; return page.evaluate(`(${SETTLE})('${sel}', ${start ?? await topOf(page, sel)})`); };
  const clickRest = async (it: any) => { const y0 = await topOf(page, `.blk[data-id="${it.id}"]`); await page.click(`#panel-outline .ol-item[data-k="${it.k}"] .ol-link`); return rest(it.id, y0); };
  const landed: any[] = [];
  for (const it of items) {
    const r: any = await clickRest(it);
    // held: the next 60 painted frames (blocks above still typesetting) keep it within 1 px, and the page
    // has stopped (no slow scroll that the "at rest" wait, 3 frames within 0.5 px, would let through)
    const s: any = await page.evaluate(`(${SAMPLE})('.blk[data-id="${it.id}"]', 60)`);
    const d = deviation(s.ys, s.states);
    const drift = Math.abs(s.ys[s.ys.length - 1] - s.ys[0]);
    landed.push({ title: it.title, off: Math.round((r.y - r.want) * 10) / 10, pending: r.pending, held: d.max, drift });   // (every heading can come to the top, the last ones too: the pane's end space)
  }
  // drift ≤ 1 px, as held: a held heading jitters by ±0.5 px between frames (sub-pixel corrections
  // while blocks above typeset: ys 63.6 … 64.5), so the first and last samples can differ by up to 1 px at rest;
  // a page still scrolling slowly moves more than that in 60 frames
  const bad = landed.filter((x) => Math.abs(x.off) > 4 || x.held > 1 || x.drift > 1);
  report.outline = { landed };
  check('outline: every heading lands at the top, below the top bar (≤ 4 px), is held there (±1 px, 60 frames) and the page stops, while typesetting', items.length > 5 && !bad.length, bad.length ? bad : `${landed.length} entries, ${landed.filter((x) => x.pending).length} with blocks pending`);
  // (a regression guard) clicking an entry already reached is idempotent: the same entry
  // clicked 5× (the first one far below, so the first click scrolls up) leaves its heading where it
  // is (±1 px) and the page does not drift afterwards
  const again = items[1] ?? items[0];
  await page.evaluate(() => PANE().scrollTo(0, PANE().scrollHeight));
  const ys: number[] = [];
  for (let n = 0; n < 5; n++) {
    await page.click(`#panel-outline .ol-item[data-k="${again.k}"] .ol-link`);
    ys.push(Math.round(((await rest(again.id)) as any).y * 10) / 10);
  }
  const drift: any = await page.evaluate(`(${SAMPLE})('.blk[data-id="${again.id}"]')`);
  const dd = deviation(drift.ys, drift.states);
  check('outline: the same entry clicked 5× lands at the same place each time (±1 px), and nothing drifts after',
    Math.max(...ys) - Math.min(...ys) <= 1 && dd.max <= 1, { title: again.title, ys, after: { max: dd.max, frames: dd.frames } });
  const last = items[Math.max(0, items.length - 4)];
  const r0: any = await clickRest(last);
  const s: any = await page.evaluate(`(${SAMPLE})('.blk[data-id="${last.id}"]')`);
  const d = deviation(s.ys, s.states);
  check('outline: the heading is still there once everything is typeset (≤ 4 px)', Math.abs(s.ys[s.ys.length - 1] - r0.want) <= 4 && d.max <= 4, { ...d, want: r0.want, end: s.ys[s.ys.length - 1] });
  await ctx.close(); rmSync(dir, { recursive: true, force: true });
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ report, results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
