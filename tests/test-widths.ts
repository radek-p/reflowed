// a change of the preview's width (the split on and off, a pane closed, the split dragged, the sidebar) keeps
// the blocks' lines while it moves, then re-breaks what is in view once and the rest lazily (panes/widths.js,
// panes/lazy-views.js). For the long test document (the intro repeated) and the intro:
//   - split on, the sidebar in split view (off, on), the split dragged across its whole range, split off from pane A,
//     a pane hidden (split closed from pane B), the sidebar in one pane at a narrow window (off, on);
//   - each: no long task (> 50 ms) from the action until its work is done; per frame, the blocks the viewer laid out
//     again (not new views) at most the blocks in view; the reading point (the first block starting below each pane's
//     top) within 1 px of where it was, measured from the pane's visible top (below its tab strip); afterwards nothing
//     pinned, no old lines left, every block at a fresh layout's height for its width (laid out again from scratch:
//     equal) and laid out at its element's width;
//   - a motion of the workbench (the sidebar sliding, the split dragged: resizestart .. resizeend, the hosts locked at
//     their widths): no block laid out again during it, the reading point within 1 px in each of its frames; then each
//     block re-broken at most once, with no cross-fade;
//   - a narrower column picked in View: the text clipped with a soft edge during the motion; the old lines cross-fade
//     (ghosts);
//   - the end of a side column's slide (one pane, a narrow window): no long task from the workbench's resizeend until
//     its work is done (the column applied, then the re-break, in tasks of their own), and no column variables on
//     <body> (they restyled the page outside the panes at every slide's end);
//   - a column width picked in View (its eased motion), narrower and back;
//   - reduced motion: no motion, no cross-fade, each block re-broken at most once.
// Waits on the governor's and the viewer's idle promises and frames, never on fixed times. Long tasks are counted in the
// main thread's CPU time (tests/qa/lib/work.ts); --timing-strict counts them by the clock.
//
//   node tests/test-widths.ts [http://localhost:8153/] [--only <regex>] [--docs long,intro]
// Results: test-results/widths/results.json.
import { createRequire } from 'node:module';
import { paneA, splitB, closePane, paneSel } from './qa/lib/panes.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { docsHere, seedQuery } from './qa/lib/samples.ts';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { traceWork, TIMING_STRICT, calibrate, calibrateAfter, budget, lim, gate } from './qa/lib/work.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'widths');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0].replace(/\/?$/, '/') : 'http://localhost:8153/';
const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]) : null;
const DOCS = argv.includes('--docs') ? argv[argv.indexOf('--docs') + 1].split(',') : docsHere(['long', 'intro']);
const LONG_MS = 50;

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 500)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];

async function open(doc: string, { width = 1440, height = 900, reduced = false, advanced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  // the justification switch is an advanced feature: its value is the default while the switch is off
  if (advanced) await ctx.addInitScript(() => { try { localStorage.setItem('rtx-editor.advanced', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.setDefaultTimeout(240000);
  await page.goto(`${BASE}?engine&${seedQuery(doc)}store=memory#/doc/${doc}`);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && document.querySelectorAll('[data-part="page"] .blocks > .blk').length > 20);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  PA = idOf(await paneA(page)); PB = '';
  await page.evaluate(RECORDER);
  return { ctx, page };
}
// the panes: tab ids of pane A (the document's tab) and pane B (the split's); each pane scrolls under the glass bar
let PA = '', PB = '';
const idOf = (sel: string) => /data-pane="([^"]+)"/.exec(sel)![1];
const splitOn = async (page: any) => { PB = idOf(await splitB(page)); };
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (page: any, n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
/** the change's own work done: the governor's re-breaks, the new pane's views, the viewer */
const settled = (page: any) => page.evaluate(async () => {
  const a = (window as any).editorAPI;
  for (let k = 0; k < 3; k++) { await a.widths().idle(); await a.lazyViews().idle(); await (window as any).reflowtex.inspect.idle(); }
});

// ── in the page: a recorder of frames, long tasks and the viewer's layouts; the reading points; the final layout ──
const RECORDER = () => {
  const w = window as any;
  const panesNow = () => [...document.querySelectorAll('main.rtx-pane')].filter((el) => el.querySelector('.blocks')) as HTMLElement[];
  // a pane's box: below the glass bar (its scroll padding), to its bottom
  const boxOf = (pane: HTMLElement) => { const r = pane.getBoundingClientRect(); return { top: r.top + (parseFloat(getComputedStyle(pane).scrollPaddingTop) || 0), bottom: r.top + pane.clientHeight }; };
  const paneOf = (el: Element) => el.closest('main.rtx-pane') as HTMLElement;
  addEventListener('resize', () => { w.__resizes = (w.__resizes ?? 0) + 1; });
  w.__wt = {
    start() {
      const known = new WeakSet(document.querySelectorAll('.latex-block'));
      const out: any[] = [];
      let cur = new Set<Element>(), stop = false, quick = 0;
      const lt: number[] = [];
      const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); });
      po.observe({ type: 'longtask', buffered: false });
      // a re-break: a block the page had before, laid out at another width or alignment (the viewer also announces a
      // layout when it paints lines that came into view: not a re-break)
      const lw: WeakMap<Element, string> = new WeakMap();
      const key = (el: Element) => { const s = w.reflowtex.inspect.state(el); return `${s?.lastWidth}|${s?.lastAlign}`; };
      for (const el of document.querySelectorAll('.latex-block')) lw.set(el, key(el));
      const on = (e: any) => {
        const el = e.detail?.block; if (!el || !known.has(el)) return;
        const now = key(el);
        if (now === lw.get(el)) return;
        lw.set(el, now); cur.add(el); if (e.detail?.quick) quick++;
      };
      document.addEventListener('reflowtex:layout', on, true);
      // a motion of the workbench (resizestart .. resizeend): the blocks laid out again meanwhile, its frames, and the
      // reading points' most drift in those frames (each pane's, against its box)
      const a0 = w.__wt.anchors();
      const mo = { started: 0, ended: 0, layouts: 0, frames: 0, drift: 0 };
      const wb = w.editorAPI.workbench();
      const offs = [wb.on('resizestart', () => { mo.started++; }), wb.on('resizeend', () => { mo.ended++; })];
      let over = 0, ghosts = 0, anims = 0, prev = Infinity;
      // the layouts counted here were made since the last frame's look, against the blocks in view then (a block
      // re-broken narrower grows: fewer are in view after)
      const f = () => {
        if (stop) return;
        const els = [...cur]; cur = new Set();
        if (mo.started > mo.ended) {
          mo.frames++; mo.layouts += els.length;
          for (const [p, a] of Object.entries(a0) as [string, { id: string; y: number }][]) { const y = w.__wt.yOf(p, a.id); if (y != null) mo.drift = Math.max(mo.drift, Math.abs(y - a.y)); }
        }
        let inView = 0;
        for (const el of document.querySelectorAll('.blk-render > .latex-block:not(.rtx-w-ghost)')) { const r = el.getBoundingClientRect(), b = boxOf(paneOf(el)); if (r.height > 0 && r.bottom > b.top && r.top < b.bottom) inView++; }
        out.push({ layouts: els.length, inView: Math.max(inView, prev === Infinity ? inView : prev) });
        prev = inView;
        over = Math.max(over, document.querySelectorAll('.blk-render.rtx-w-over').length);
        ghosts = Math.max(ghosts, document.querySelectorAll('.rtx-w-ghost').length);
        anims = Math.max(anims, document.getAnimations().filter((a) => a.playState === 'running').length);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
      w.__wtStop = () => { stop = true; po.disconnect(); document.removeEventListener('reflowtex:layout', on, true); for (const off of offs) off(); return { frames: out, long: lt, quick, over, ghosts, anims, motion: { ...mo, drift: Math.round(mo.drift * 10) / 10 } }; };
    },
    stop: () => w.__wtStop(),
    /** each pane's reading point: the first block in the flow that starts at or below the pane's top, and its y from
     *  that top (the visible area's: a second tab strip, the split's, moves the pane's top down, not the text in it) */
    anchors() {
      const out: Record<string, { id: string; y: number }> = {};
      for (const p of panesNow()) {
        const b = boxOf(p);
        for (const el of p.querySelector('.blocks')!.children as any) {
          if (el.offsetParent === null || getComputedStyle(el).position === 'absolute') continue;
          const r = el.getBoundingClientRect();
          if (r.top >= b.top - 0.5) { out[p.dataset.pane ?? p.id] = { id: el.dataset.id, y: r.top - b.top }; break; }
        }
      }
      return out;
    },
    yOf(pane: string, id: string) {
      const p = document.querySelector(`main.rtx-pane[data-pane="${pane}"]`);
      const el = p?.querySelector(`.blocks > .blk[data-id="${CSS.escape(id)}"]`);
      return el ? el.getBoundingClientRect().top - boxOf(p as HTMLElement).top : null;
    },
    /** after the change: nothing pinned, no old lines left; each block laid out at its element's width; its height
     *  that of a layout from scratch (the viewer's relayout) */
    final() {
      const bad: any[] = [];
      const pinnedLeft = [...document.querySelectorAll('.blk-render > .latex-block')].filter((el) => (el as HTMLElement).style.width).length;
      const ghostsLeft = document.querySelectorAll('.rtx-w-ghost, .blk-render.rtx-w-pin, .blk-render.rtx-w-over, .latex-block.rtx-w-skip, .blk.rtx-lazy').length;
      const els = [...document.querySelectorAll('.blocks > .blk:not(.editing) > .blk-main > .blk-render:not([hidden]) > .latex-block:not(.incoming)')] as HTMLElement[];
      const shown = els.filter((el) => el.offsetParent !== null && el.clientWidth > 0 && !el.dataset.latexWidth);
      const st = (el: HTMLElement) => w.reflowtex.inspect.state(el);
      // the alignment the viewer reads at a layout (its alignFromEl)
      const alignOf = (el: HTMLElement) => getComputedStyle(el).getPropertyValue('--latex-align').trim() || el.dataset.align || 'justify';
      const before = shown.map((el) => ({ h: el.getBoundingClientRect().height, lw: st(el)?.lastWidth, cw: el.clientWidth, la: st(el)?.lastAlign, a: alignOf(el) }));
      for (const el of shown) st(el)?.cache?.relayout?.();
      shown.forEach((el, i) => {
        const h = el.getBoundingClientRect().height, b = before[i];
        // the viewer lays out at clientWidth / 2 pt
        if (Math.abs(h - b.h) > 0.5 || Math.abs(b.lw - b.cw / 2) > 0.51 || b.la !== b.a) bad.push({ id: el.closest('.blk')?.getAttribute('data-id'), pane: el.closest('.blk')?.getAttribute('data-pane'), h0: Math.round(b.h * 10) / 10, h: Math.round(h * 10) / 10, lw: b.lw, cw: b.cw, la: b.la, a: b.a });
      });
      return { pinnedLeft, ghostsLeft, blocks: shown.length, bad: bad.length, sample: bad.slice(0, 4) };
    },
  };
};

/** the window resized, and its resize event come (the change under way from there) */
async function resizeTo(page: any, width: number) {
  const n = await page.evaluate(() => (window as any).__resizes ?? 0);
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction((k: number) => ((window as any).__resizes ?? 0) > k, n);
}
const scrollMid = (page: any) => page.evaluate(() => {
  for (const p of document.querySelectorAll('main.rtx-pane') as NodeListOf<HTMLElement>) p.scrollTop = (p.scrollHeight - p.clientHeight) * 0.45;
});
const sidebarBtn = (page: any) => page.evaluate(() => (window as any).editorAPI.workbench().toggleSide('left'));   // the left column (its hide button, Ctrl/⌘B)

/** one width change: recorded from the action until its work is done; the checks */
// Long tasks: none over 50 ms, with two allowances:
//   - switch: the task that switches the layout itself (split on, split off, a pane hidden): the browser restyles and
//     lays out the panes at once; at most two tasks, ≤ 150 ms (split on: pane B comes with its shells, its views
//     later, `split-tasks`);
//   - heavy: a block whose own re-break is over the budget (e.g. a large figure at 1600 px: 30–45 ms of the viewer's
//     layout and paint, not divisible from here): its frame ≤ 100 ms, one per such block in view.
const SWITCH_MS = 150, HEAVY_MS = 100;
// the limits in CPU time are scaled by the host's factor (calibrate); the clock's, with --timing-strict, are not
const LIM = (ms: number) => (TIMING_STRICT ? ms : budget(ms)), L = (ms: number) => (TIMING_STRICT ? `${ms} ms` : lim(ms));
async function measure(page: any, tag: string, act: () => Promise<unknown>, { reduced = false, narrowing = false, locked = false, anchorPanes = null as string[] | null, switching = false } = {}) {
  await calibrate(page);                                       // the factor before the window (re-measured after 30 s)
  await settled(page); await idle(page); await frames(page, 3);
  const a0 = await page.evaluate(() => (window as any).__wt.anchors());
  await page.evaluate(() => { (window as any).editorAPI.widths().resetStats(); (window as any).__wt.start(); });
  // the tasks in the main thread's CPU time (a trace), which load does not stretch; the observer's
  // long tasks (by the clock) gate only with --timing-strict, and are printed when the two disagree
  const work = await traceWork(page, async () => { await act(); await settled(page); await frames(page, 3); });
  const r = await page.evaluate(() => (window as any).__wt.stop());
  await calibrateAfter(page);                                  // and after it: the checks use the higher of the two
  const cpuLong = work.long(LONG_MS).map((t) => Math.round(t.cpu)), wallLong: number[] = r.long;
  if (cpuLong.length !== wallLong.filter((d) => d > LONG_MS).length) console.log(`wall ${wallLong.some((d) => d > LONG_MS) ? 'OVER' : 'ok  '} ${tag}: long tasks by the clock ${JSON.stringify(wallLong)}, by CPU ${JSON.stringify(cpuLong)}${TIMING_STRICT ? ' (the clock gates: --timing-strict)' : ' (CPU gates)'}`);
  r.long = TIMING_STRICT ? wallLong : cpuLong;
  const ws = await page.evaluate(() => (window as any).editorAPI.widths().stats());
  const panes = anchorPanes ?? Object.keys(a0);
  const drift: Record<string, number | null> = {};
  for (const p of panes) { const a = a0[p]; if (!a) continue; const y = await page.evaluate(([pp, id]: string[]) => (window as any).__wt.yOf(pp, id), [p, a.id]); drift[p] = y == null ? null : Math.round((y - a.y) * 10) / 10; }
  const over = r.frames.filter((f: any) => f.layouts > Math.max(1, f.inView));
  const rebreakMs = Math.max(0, ...ws.frames.map((f: any) => f.ms)), heavyN = ws.frames.filter((f: any) => f.ms > 25).length;
  const long = r.long.filter((d: number) => d > LIM(LONG_MS)).sort((a: number, b: number) => b - a);
  const rest = [...long];
  const allowed: string[] = [];
  if (switching) { const k = rest.filter((d: number) => d <= LIM(SWITCH_MS)).slice(0, 2); if (k.length) allowed.push(`switch ${k.join('/')}`); for (const d of k) rest.splice(rest.indexOf(d), 1); }
  if (heavyN) { const k = rest.filter((d: number) => d <= LIM(HEAVY_MS)).slice(0, heavyN); if (k.length) allowed.push(`heavy ${k.join('/')}`); for (const d of k) rest.splice(rest.indexOf(d), 1); }
  gate(check, `${tag}: no long task (> ${L(LONG_MS)})${allowed.length ? ` (allowance: ${allowed.join(', ')})` : ''}`, rest.length === 0, { long: r.long, rebreakMs, sliceMs: Math.max(0, ...ws.slices.map((f: any) => f.ms)) });
  check(`${tag}: per frame, the blocks laid out again ≤ the blocks in view (max ${Math.max(0, ...r.frames.map((f: any) => f.layouts))}; the viewer's own resize path ${r.quick})`,
    over.length === 0 && r.quick === 0, { over: over.slice(0, 5), frames: r.frames.length, quick: r.quick });
  if (panes.length) check(`${tag}: the reading point within 1 px (${JSON.stringify(drift)})`, Object.values(drift).length > 0 && Object.values(drift).every((d) => d != null && Math.abs(d) <= 1), { drift, a0 });
  const fin = await page.evaluate(() => (window as any).__wt.final());
  check(`${tag}: then every block at a fresh layout for its width (${fin.blocks} blocks), nothing pinned or left over`, fin.bad === 0 && fin.pinnedLeft === 0 && fin.ghostsLeft === 0, fin);
  if (reduced) check(`${tag} (reduced motion): no motion, no cross-fade, each block re-broken at most once`, r.ghosts === 0 && ws.ghosts === 0 && ws.rebroken <= (await page.evaluate(() => document.querySelectorAll('.blk-render > .latex-block').length)), { ghosts: ws.ghosts, anims: r.anims, rebroken: ws.rebroken });
  else if (locked) {
    const blocks = await page.evaluate(() => document.querySelectorAll('.blk-render > .latex-block').length);
    const m = r.motion;
    check(`${tag}: the lines kept during the motion (${m.frames} frames: none laid out again, the reading point within 1 px in each, ${m.drift} px), then re-broken once at its end, no cross-fade`,
      m.started > 0 && m.ended === m.started && m.frames > 0 && m.layouts === 0 && m.drift <= 1 && ws.ghosts === 0 && ws.rebroken <= blocks, { motion: m, ghosts: ws.ghosts, rebroken: ws.rebroken, blocks });
  } else if (narrowing) check(`${tag}: the narrowing text clipped with a soft edge during the motion, then cross-faded (ghosts ${ws.ghosts})`, r.over > 0 && ws.ghosts > 0, { over: r.over, ghosts: ws.ghosts });
  return { r, ws, drift };
}

/** the end of a side column's slide: the tasks from the workbench's resizeend (a mark in the trace) until the change's
 *  work is done: none over 50 ms; the column's variables on no page-wide element */
async function slideEnd(page: any, tag: string) {
  await calibrate(page);
  await settled(page); await idle(page); await frames(page, 3);
  await page.evaluate(() => {
    const w = window as any;
    w.__slideEnd?.off();
    const x = { ended: false, off: (() => false) as () => unknown, long: [] as { start: number; ms: number }[], end: Infinity, po: null as PerformanceObserver | null };
    x.off = w.editorAPI.workbench().on('resizeend', () => { if (x.ended) return; x.ended = true; x.end = performance.now(); console.timeStamp('rtx-slide-end'); });
    x.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) x.long.push({ start: e.startTime, ms: Math.round(e.duration) }); });
    x.po.observe({ type: 'longtask', buffered: false });
    w.__slideEnd = x;
  });
  const work = await traceWork(page, async () => {
    await sidebarBtn(page);
    await page.waitForFunction(() => (window as any).__slideEnd.ended);
    await settled(page); await frames(page, 3);
  });
  const wall = await page.evaluate(() => {
    const x = (window as any).__slideEnd;
    x.po.disconnect(); x.off();
    return x.long.filter((t: any) => t.start + t.ms >= x.end).map((t: any) => t.ms);
  });
  await calibrateAfter(page);
  const mark = work.marks.find((m) => m.name === 'rtx-slide-end');
  const cpu = mark ? work.tasks.filter((t) => t.at + t.wall >= mark.at && t.cpu > LIM(LONG_MS)).map((t) => Math.round(t.cpu)) : null;
  const long = TIMING_STRICT ? wall.filter((d: number) => d > LONG_MS) : cpu;
  gate(check, `${tag}: no long task (> ${L(LONG_MS)}) from the slide's end until its work is done`, !!mark && !!long && long.length === 0, { cpu, wall, marked: !!mark });
  const vars = await page.evaluate(() => [document.body, document.documentElement].map((el) => ({ el: el.tagName, col: el.style.getPropertyValue('--col'), free: el.style.getPropertyValue('--rtx-free') })));
  check(`${tag}: no column variable (--col, --rtx-free) on <body> or <html>`, vars.every((v: any) => !v.col && !v.free), vars);
}

const run = (name: string) => !ONLY || ONLY.test(name);
for (const doc of DOCS) {
  // ── split on, the sidebar in split view, the drag, split off, a pane hidden (1440 px) ──
  if (run(`${doc} split`)) {
    const { ctx, page } = await open(doc);
    await scrollMid(page); await frames(page, 3);
    await measure(page, `${doc}: split on`, () => splitOn(page), { narrowing: false, anchorPanes: [PA], switching: true });
    await scrollMid(page); await frames(page, 3);
    await measure(page, `${doc}: sidebar off (split)`, () => sidebarBtn(page), { locked: true });
    await measure(page, `${doc}: sidebar on (split)`, () => sidebarBtn(page), { locked: true });
    // the split dragged across its whole range, one pointer step a frame, and back to the middle
    // the workbench's splitter between the two groups
    const d = await page.evaluate(() => { const r = document.querySelector('.wb-groups .wb-sep')!.getBoundingClientRect(); const s = document.querySelector('.wb-groups')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 300, left: s.left, right: s.right }; });
    await measure(page, `${doc}: the split dragged across its range`, async () => {
      await page.mouse.move(d.x, d.y); await page.mouse.down();
      let x = d.x;
      for (const t of [d.left + 200, d.right - 200, d.x]) { const n = Math.ceil(Math.abs(t - x) / 16); for (let k = 1; k <= n; k++) { await page.mouse.move(x + ((t - x) * k) / n, d.y); await frames(page, 1); } x = t; }
      await page.mouse.up();
    }, { locked: true });
    await measure(page, `${doc}: split off (pane B closed)`, () => closePane(page, paneSel(PB)), { anchorPanes: [PA], switching: true });
    // a pane hidden: the split again, then pane A closed (pane B's place stays, in the pane that is left)
    await splitOn(page); await settled(page); await idle(page);
    await scrollMid(page); await frames(page, 3);
    const b0 = await page.evaluate((b: string) => (window as any).__wt.anchors()[b], PB);
    const hid = await measure(page, `${doc}: pane B kept, pane A closed`, () => closePane(page, paneSel(PA)), { anchorPanes: [], switching: true });
    const yb = b0 ? await page.evaluate(([b, id]: string[]) => (window as any).__wt.yOf(b, id), [PB, b0.id]) : null;
    check(`${doc}: … pane B's reading point within 1 px in the pane that stays`, b0 && yb != null && Math.abs(yb - b0.y) <= 1, { b0, yb, closed: hid.r.long });
    await ctx.close();
  }
  // ── one pane at a narrow window: the sidebar narrows the column ──
  if (run(`${doc} sidebar`)) {
    const { ctx, page } = await open(doc, { width: 1000 });
    await scrollMid(page); await frames(page, 3);
    const opened = await page.evaluate(() => !(window as any).editorAPI.workbench().sides.peek().left.collapsed);
    if (opened) await measure(page, `${doc}: sidebar off (one pane, 1000 px)`, () => sidebarBtn(page), { locked: true });
    await measure(page, `${doc}: sidebar on (one pane, 1000 px)`, () => sidebarBtn(page), { locked: true });
    if (!opened) await measure(page, `${doc}: sidebar off (one pane, 1000 px)`, () => sidebarBtn(page), { locked: true });
    // the slide's end alone, both ways (at this width the sidebar changes the column: 'paper' fitted to the pane)
    const shownNow = () => page.evaluate(() => !(window as any).editorAPI.workbench().sides.peek().left.collapsed);
    for (let k = 0; k < 2; k++) await slideEnd(page, `${doc}: the end of the sidebar's slide, ${(await shownNow()) ? 'off' : 'on'} (one pane, 1000 px)`);
    await ctx.close();
  }
  // ── a column width picked in View: the column eases to it (one pane, 1440 px) ──
  if (run(`${doc} preset`)) {
    const { ctx, page } = await open(doc);
    await scrollMid(page); await frames(page, 3);
    const pick = (w: string) => page.evaluate((x: string) => (window as any).editorAPI.view().set({ width: x }, { animate: true }), w);
    const w0 = await page.evaluate(() => (window as any).editorAPI.view().settings.width);
    await measure(page, `${doc}: a narrow column picked`, () => pick('narrow'), { narrowing: true });
    await measure(page, `${doc}: the column back (${w0})`, () => pick(w0));
    await ctx.close();
  }
  // ── split on: pane B comes with its blocks' shells; its views come later, those in view first (pane A's views
  //    made all at once in the switch's task were one 600 ms task for a 30-block document: panes/lazy-views.js) ──
  if (run(`${doc} split-tasks`)) {
    const { ctx, page } = await open(doc);
    await scrollMid(page); await frames(page, 3);
    const r = await page.evaluate(async () => {
      const panes0 = [...document.querySelectorAll('main.rtx-pane')];
      const paneB = () => [...document.querySelectorAll('main.rtx-pane')].find((m) => !panes0.includes(m)) ?? null;
      const count = (p: Element | null) => ({ shells: p?.querySelectorAll('.blocks > .blk').length ?? 0, views: p?.querySelectorAll('.blk-render > .latex-block').length ?? 0 });
      // pane A's blocks in view: the views pane B makes first
      const A = panes0[0] as HTMLElement, box = A.getBoundingClientRect();
      const seen = [...A.querySelectorAll('.blocks > .blk')].filter((el) => { const q = el.getBoundingClientRect(); return q.height > 0 && q.bottom > box.top && q.top < box.bottom; }).length;
      const a0 = count(A);
      (window as any).editorAPI.workbench().run('splitRight');
      await new Promise((res) => requestAnimationFrame(() => res(null)));
      const first = count(paneB());
      const a = (window as any).editorAPI;
      for (let k = 0; k < 3; k++) { await a.widths().idle(); await a.lazyViews().idle(); }
      return { blocks: a0.shells, views: a0.views, seen, first, after: count(paneB()) };
    });
    check(`${doc}: split on: pane B with its ${r.first.shells} shells at the first frame, ${r.first.views} views (≤ ${r.seen} in view), then all ${r.after.views}`,
      r.blocks > 20 && r.first.shells === r.blocks && r.first.views <= r.seen && r.after.shells === r.blocks && r.after.views === r.views, r);
    await settled(page);
    const fin = await page.evaluate(() => (window as any).__wt.final());
    check(`${doc}: … then every block of both panes at a fresh layout (${fin.blocks})`, fin.bad === 0 && fin.pinnedLeft === 0 && fin.ghostsLeft === 0, fin);
    await ctx.close();
  }
  // ── a window resize, in steps (one pane, then split view): the lines kept, the blocks in view re-broken
  //    nearest the reader first, the rest lazily; never the viewer's own resize path (every block, every frame) ──
  if (run(`${doc} window`)) {
    const { ctx, page } = await open(doc, { width: 1280 });
    await scrollMid(page); await frames(page, 3);
    let w0 = 1280;
    for (const w1 of [900, 1600]) {
      await measure(page, `${doc}: the window ${w0} → ${w1} px`, () => resizeTo(page, w1));
      w0 = w1;
    }
    await splitOn(page); await settled(page); await idle(page);
    await scrollMid(page); await frames(page, 3);
    await measure(page, `${doc}: the window ${w0} → 1200 px (split)`, () => resizeTo(page, 1200));
    await measure(page, `${doc}: the window 1200 → 1500 px (split)`, () => resizeTo(page, 1500));
    await ctx.close();
  }
  // ── the justification switch: every block laid out again, the ones in view first, the rest lazily ──
  if (run(`${doc} align`)) {
    const { ctx, page } = await open(doc, { advanced: true });
    await scrollMid(page); await frames(page, 3);
    const align = (a: string) => page.evaluate((x: string) => (window as any).editorAPI.view().set({ align: x }), a);
    await measure(page, `${doc}: ragged right`, () => align('left'));
    await measure(page, `${doc}: justified again`, () => align('justify'));
    await splitOn(page); await settled(page); await idle(page);
    await scrollMid(page); await frames(page, 3);
    await measure(page, `${doc}: ragged right (split)`, () => align('left'));
    await ctx.close();
  }
  // ── reduced motion: an instant switch, one re-break ──
  if (run(`${doc} reduced`)) {
    const { ctx, page } = await open(doc, { width: 1000, reduced: true });
    await scrollMid(page); await frames(page, 3);
    await measure(page, `${doc}: sidebar toggled`, () => sidebarBtn(page), { reduced: true });
    await page.setViewportSize({ width: 1440, height: 900 }); await settled(page); await idle(page);
    await measure(page, `${doc}: split on`, () => splitOn(page), { reduced: true, anchorPanes: [PA], switching: true });
    await measure(page, `${doc}: split off`, () => closePane(page, paneSel(PB)), { reduced: true, anchorPanes: [PA], switching: true });
    await ctx.close();
  }
}
check('no page errors', problems.length === 0, problems.slice(0, 5));
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
