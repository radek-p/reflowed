// MOTION: the editing popover's motion and the caret it mirrors, in both panes.
//   pinned the code popover keeps its place while the page follows the caret
//   follow the page follows the caret only after a caret move made in the editor; a scroll of the
//            reader's own (wheel, keys outside the editor) stops it until the next caret move
// Waits on editorAPI.whenIdle(), events and DOM state; measurement sections sample frames. The time checks gate on the
// main thread's CPU time (tests/qa/lib/work.ts); the wall clock is reported, and gates with --timing-strict.
//
//   node tests/test-motion.ts [http://localhost:8151/] [--only <regex>]   (a dev server: tests/integration/serve.ts)
// Results: test-results/motion/results.json.
import { createRequire } from 'node:module';
import { paneA, splitB } from './qa/lib/panes.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { traceWork, timed, calibrate, calibrateAfter, budget, lim } from './qa/lib/work.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'motion');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8151/';
const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]) : null;
const section = (name: string) => !ONLY || ONLY.test(name);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 500)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
async function open(url: string, { width = 1600, height = 900, reduced = false, scheme = 'light', theme = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: scheme });
  // a stored theme (the View popover's choice): sepia has no colour scheme of its own
  if (theme) await ctx.addInitScript((t: string) => { try { localStorage.setItem('rtx-editor.view', JSON.stringify({ ...JSON.parse(localStorage.getItem('rtx-editor.view') || '{}'), theme: t })); } catch { /* none */ } }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(180000);
  await page.goto(BASE + url);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  SEL.a = await paneA(page); PID.a = idOf(SEL.a); delete SEL.b; delete PID.b;
  return { ctx, page };
}
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (page: any, n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
// the panes: selectors (SEL) and tab ids (PID); pane A the document's tab (set on open), pane B the split's; each
// pane scrolls
const SEL: Record<string, string> = {}, PID: Record<string, string> = {};
const idOf = (sel: string) => /data-pane="([^"]+)"/.exec(sel)![1];
const api = (page: any, name: string, ...args: any[]) => page.evaluate(([n, a]: any) => (window as any).editorAPI[n](...a), [name, args]);
async function openSplit(page: any) {
  SEL.b = await splitB(page); PID.b = idOf(SEL.b);
  await idle(page);
  await frames(page);
}
/** pane p's scroll position (the window while it is the only pane) */
const scrollOf = (page: any, p: string) => page.evaluate((s: string) => { const el = document.querySelector(s) as HTMLElement; return el.scrollTop; }, SEL[p]);
/** put block `id` at `dy` px below the top of pane p */
const toTop = (page: any, p: string, id: string, dy = 140) => page.evaluate(([s, i, d]: any) => {
  const split = true, sc = document.querySelector(s) as HTMLElement;
  // (from the pane's reading top: below the glass bar and strip, its scroll-padding-top; with two groups the strip is
  // under the bar and a block put at the pane's edge is under it, where a click reaches the tabs, not the text)
  const el = sc.querySelector(`.blk[data-id="${i}"]`)!, top = el.getBoundingClientRect().top - (split ? sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0) : 0) - d;
  if (split) sc.scrollTop += top; else window.scrollBy(0, top);
}, [SEL[p], id, dy]);
const waitSession = (page: any, p: string, id: string) => page.waitForFunction(([pp, i]: string[]) => (window as any).editorAPI.sessions().some((s: any) => s.pane === pp && s.id === i), [PID[p], id]);
/** the mirrored caret's rect and pane p's visible box */
const caretIn = (page: any, p: string) => page.evaluate((s: string) => {
  const bar = document.querySelector(`${s} .blk.editing .rtx-caret-bar`)?.getBoundingClientRect();
  const split = true;
  const box = split ? document.querySelector(s)!.getBoundingClientRect() : { top: 56, bottom: innerHeight };
  return bar ? { top: bar.top, bottom: bar.bottom, visible: bar.bottom > box.top && bar.top < box.bottom } : null;
}, SEL[p]);

const LONG = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long paragraph that is taller than the window, so that its editing popover floats over its lower part.`).join(' ');

// ── the caret is followed only after a caret move made in the editor ──────────────────────────────────────
if (section('follow')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { reduced: true });
  const id = await api(page, 'insert', 2, 'paragraph', LONG);
  await idle(page);
  for (const p of ['a', 'b']) {
    if (p === 'b') await openSplit(page);
    await toTop(page, p, id, 120); await idle(page); await frames(page);
    // open it with a click near its top (the caret there), as the reader does
    const pt = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 14 }; }, [SEL[p], id]);
    await page.mouse.click(pt.x, pt.y);
    await waitSession(page, p, id);
    await idle(page); await frames(page, 3);
    check(`follow [${p}]: opened by a click: followed`, await api(page, 'following', PID[p]) === true);
    // the reader scrolls away with the wheel (over the pane's text, outside the popover)
    const over = await page.evaluate((s: string) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.left + 8, y: Math.min(innerHeight, r.bottom) - 40 }; }, SEL[p]);
    await page.mouse.move(over.x, over.y);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 250);
    await frames(page, 4);
    const y0 = await scrollOf(page, p);
    const followed = await api(page, 'following', PID[p]);
    // what lands while the reader reads elsewhere: a re-mark (a result swapped in, a live preview) and real results
    await api(page, 'remark', PID[p]);
    await frames(page, 3);
    await idle(page); await frames(page, 3);
    const y1 = await scrollOf(page, p);
    check(`follow [${p}]: after a wheel scroll away, a result landing does not scroll the pane back (scroll ${Math.round(y0)} → ${Math.round(y1)})`, followed === false && Math.abs(y1 - y0) <= 1, { followed, y0, y1 });
    // a keystroke in the editor: the caret is followed again, and brought into view
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((pp: string) => (window as any).editorAPI.following(pp), PID[p]);
    await frames(page, 4);
    const c = await caretIn(page, p);
    check(`follow [${p}]: a caret move in the editor follows again: the mirrored caret is in view`, !!c?.visible, c);
    // keys that scroll the page from outside the editor (focus on the page) stop following, as the wheel does
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('PageDown');
    check(`follow [${p}]: PageDown outside the editor stops following`, await api(page, 'following', PID[p]) === false);
    await api(page, 'leave'); await idle(page);
  }
  await ctx.close();
}

// ── the code popover keeps its place while the page follows the caret ─────────────────────────────────────
// Stacked (a 900 px window), a paragraph taller than the window: the popover floats, pinned at the pane's bottom.
// The caret is walked down the whole block with ↓ in the editor; the page follows it. In every frame the popover
// keeps its place (±1 px), the follow included; near the block's end the page scrolls only until the result's
// end meets the popover (before, the result's end rose above it and carried it up); the caret stays in view
// above the popover.
if (section('pinned')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 900, height: 900, reduced: true });
  const id = await api(page, 'insert', 2, 'paragraph', LONG);
  await idle(page);
  for (const p of ['a', 'b']) {
    if (p === 'b') await openSplit(page);
    await toTop(page, p, id, 120); await idle(page); await frames(page);
    const pt = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 14 }; }, [SEL[p], id]);
    await page.mouse.click(pt.x, pt.y);
    await waitSession(page, p, id);
    await idle(page); await frames(page, 3);
    const floats = await page.evaluate(([s, i]: string[]) => document.querySelector(`${s} .blk[data-id="${i}"]`)!.classList.contains('rtx-float'), [SEL[p], id]);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    let scrolls = 0, steps = 0;
    const moved: string[] = [], hidden: string[] = [];
    for (let k = 0; k < 400; k++) {
      // a frame recorder: the popover's top and the scroll, every painted frame from before the key to after it settles
      await page.evaluate((s: string) => { const w = window as any; w.__pin = []; w.__pinStop = false;
        const f = () => { const pop = document.querySelector(`${s} .blk.editing .blk-source`); const sc = (document.querySelector(s) as HTMLElement).scrollTop;
          if (pop) w.__pin.push([sc, pop.getBoundingClientRect().top]); if (!w.__pinStop) requestAnimationFrame(f); };
        f(); }, SEL[p]);
      await page.keyboard.press('ArrowDown');
      await idle(page); await frames(page, 3);
      const fr: number[][] = await page.evaluate(() => { (window as any).__pinStop = true; return (window as any).__pin; });
      const cc = await api(page, 'caret', PID[p]);
      if (cc?.id !== id) break;                     // ↓ on the last line: the next block
      steps++;
      const scrolled = fr.some((f) => Math.abs(f[0] - fr[0][0]) > 0.5);
      if (scrolled) scrolls++;
      const tops = fr.map((f) => f[1]), span = Math.max(...tops) - Math.min(...tops);
      if (span > 1) moved.push(`↓${k + 1}: the popover moved ${span.toFixed(1)} px${scrolled ? ' (the page followed)' : ''}`);
      const c = await page.evaluate((s: string) => { const b = document.querySelector(`${s} .blk.editing .rtx-caret-bar`)?.getBoundingClientRect(), pop = document.querySelector(`${s} .blk.editing .blk-source`)!.getBoundingClientRect();
        return b ? { top: b.top, bottom: b.bottom, pop: pop.top } : null; }, SEL[p]);
      if (c && (c.bottom > c.pop + 1 || c.top < 0)) hidden.push(`↓${k + 1}: caret ${Math.round(c.top)}–${Math.round(c.bottom)}, popover from ${Math.round(c.pop)}`);
    }
    check(`pinned [${p}]: the popover floats over the long paragraph`, floats);
    check(`pinned [${p}]: while the page follows the caret down the block, the popover keeps its place in every frame (${steps} caret moves, ${scrolls} follows)`,
      scrolls >= 3 && moved.length === 0, moved.slice(0, 6).join(' | '));
    check(`pinned [${p}]: the caret stays in view above the popover`, steps > 20 && hidden.length === 0, hidden.slice(0, 6).join(' | '));
    // the paragraph is ONE source line, wrapped in the editor: ↓ and ↑ walk its wrapped lines before they go to
    // the block after or before (they went there from any wrapped line of the last or first source line)
    await api(page, 'editIn', p, id, LONG.length); await waitSession(page, p, id); await idle(page);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    let ups = 0;
    for (; ups < 400; ups++) { await page.keyboard.press('ArrowUp'); await idle(page); if ((await api(page, 'caret', PID[p]))?.id !== id) break; }
    check(`[${p}]: ↓ and ↑ move through the wrapped lines of a one-line source first (${steps} ↓, ${ups} ↑ inside the block)`, !LONG.includes('\n') && steps > 20 && ups > 20, { steps, ups });
    await api(page, 'leave'); await idle(page);
  }
  await ctx.close();
}

// A frame recorder (rAF, so each sample is the frame as it is painted) records the popover, the edited block,
// the block after it, the mirrored caret and the scroll; a PerformanceObserver the long tasks; the open's own task
// is timed from the press to the end of its task (a message posted at the press runs right after it).
const RECORDER = () => {
  const w = window as any;
  w.__lt = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__lt.push({ t: e.startTime, d: e.duration }))).observe({ type: 'longtask', buffered: false }); } catch { /* none */ }
  w.__rec = (sel: string, id: string) => {
    const out: any[] = [];
    let on = true;
    const R = (el: Element | null | undefined) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const f = (t: number) => {
      if (!on) return;
      const root = document.querySelector(`${sel} .blk[data-id="${id}"]`);
      const pop = root?.querySelector(':scope > .blk-main > .blk-source');
      const split = true, sc = document.querySelector(sel) as HTMLElement;
      out.push({ t, editing: !!root?.classList.contains('editing'), pop: pop && !(pop as HTMLElement).hidden ? R(pop) : null, popOpacity: pop ? +getComputedStyle(pop).opacity : 0,
        blk: R(root), render: R(root?.querySelector(':scope > .blk-main > .blk-render')), prev: R(root?.previousElementSibling), next: R(root?.nextElementSibling), caret: R(root?.querySelector('.rtx-caret-bar')), y: split ? sc.scrollTop : scrollY,
        box: split ? { top: sc.getBoundingClientRect().top, bottom: sc.getBoundingClientRect().top + sc.clientHeight } : { top: 56, bottom: innerHeight } });
      // the open's animations, read on the first frame the popover shows: the fade and the slide
      if (pop && !(pop as HTMLElement).hidden && !w.__anims) {
        const fade = (pop as HTMLElement).getAnimations().map((a: any) => ({ d: a.effect.getTiming().duration, s: a.startTime }));
        const slide = [...(root!.parentElement?.children ?? [])].flatMap((e) => e.getAnimations()).filter((a: any) => /translate/.test(JSON.stringify(a.effect.getKeyframes()))).map((a: any) => ({ d: a.effect.getTiming().duration, s: a.startTime }));
        if (fade.length && fade[0].s != null && slide.every((x: any) => x.s != null)) w.__anims = { fade, slide };
      }
      requestAnimationFrame(f);
    };
    w.__anims = null;
    requestAnimationFrame(f);
    return { stop: () => { on = false; return out; } };
  };
  // the work an input event does: from the window's capture listener (the first) to its bubble listener (the last), so
  // every handler and the layout they force (the open's own task, before its first frame)
  w.__task = [];
  const t0s = new Map();
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown']) {
    window.addEventListener(t, (e) => t0s.set(e, performance.now()), true);
    window.addEventListener(t, (e) => { const t0 = t0s.get(e); if (t0 != null) w.__task.push({ type: e.type, ms: performance.now() - t0 }); });
  }
};

/** the edited block's top over the frames goes one way only (a reversal of more than 1 px is a jump back) */
function oneWay(ys: number[]) {
  let dir = 0, worst = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];
    if (Math.abs(d) < 0.01) continue;
    if (!dir) { dir = Math.sign(d); continue; }
    if (Math.sign(d) !== dir) worst = Math.max(worst, Math.abs(d));
  }
  return worst;
}

async function measure(page: any, p: string, id: string, act: () => Promise<void>, settle = true) {
  await calibrate(page);                                         // the factor for this host's load, before the window
  await page.evaluate(([s, i]: string[]) => { (window as any).__lt = []; (window as any).__task = []; (window as any).__r = (window as any).__rec(s, i); }, [SEL[p], id]);
  const t0 = await page.evaluate(() => performance.now());
  // the main thread traced meanwhile: its tasks and the input events in CPU time (the gate); the
  // long tasks and the handlers' time by the clock (lt, task) are reported
  const work = await traceWork(page, async () => {
    await act();
    if (settle) await idle(page);
    await frames(page, 20);                                      // the frames after: any later correction shows here
  });
  const o = await page.evaluate((t: number) => { const w = window as any; return { anims: w.__anims, frames: w.__r.stop(), lt: w.__lt.filter((x: any) => x.t >= t), task: w.__task, t0: t }; }, t0);
  await calibrateAfter(page);                                    // and after it: the checks use the higher of the two
  return { ...o, work };
}

if (section('open')) {
  for (const p of ['a', 'b']) {
    const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1440, height: 900 });
    await page.evaluate(RECORDER);
    // a longer document: the block can then be put anywhere in the window (the sample is short)
    for (let i = 0; i < 12; i++) await api(page, 'insert', 1, 'paragraph', `Filler paragraph ${i + 1}. ${'Some words to make it wrap over a few lines in the pane. '.repeat(4)}`);
    await idle(page);
    if (p === 'b') await openSplit(page);
    // each pane's first editor was made ahead in idle time, and left nothing behind
    await page.waitForFunction((n: number) => (window as any).editorAPI.warmStats().editors >= n, p === 'b' ? 2 : 1, { timeout: 20000 }).catch(() => {});
    const ew = await page.evaluate(() => ({ editors: (window as any).editorAPI.warmStats().editors, left: document.querySelectorAll('.rtx-editor-warm, .cm-editor').length }));
    check(`open [${p}]: the pane's first editor made ahead (${ew.editors} warm-ups), nothing left in the page`, ew.editors >= (p === 'b' ? 2 : 1) && ew.left === 0, ew);
    const blocks = await api(page, 'blocks') as any[];
    const paras = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 200).map((b: any) => b.id);
    const mid = paras[Math.floor(paras.length / 2)] ?? paras[0];          // mid-document: it can be put anywhere in the window
    const tall = await api(page, 'insert', Math.floor(blocks.length / 2) + 6, 'paragraph', LONG);       // taller than the window: the popover floats
    await idle(page);
    // where the block is when it is opened: near the top, in the middle, near the bottom (the popover would reach past
    // the edge); a block taller than the window clicked low (its caret must stay above the floating popover); a block
    // off screen opened by the keyboard/API with its caret at the end
    const cases: [string, string, number, string][] = [['top', mid, 0.08, 'click'], ['middle', mid, 0.45, 'click'], ['bottom', mid, 0.86, 'click'],
      ['tall', tall, -0.2, 'click-low'], ['offscreen', mid, 1.6, 'api-end']];
    for (const [where, id, frac, how] of cases) {
      const box = await page.evaluate((s: string) => { const split = true; const el = document.querySelector(s)!, sc = el.getBoundingClientRect(); return split ? { top: sc.top + (parseFloat(getComputedStyle(el).scrollPaddingTop) || 0), bottom: sc.bottom } : { top: 56, bottom: innerHeight }; }, SEL[p]);
      await toTop(page, p, id, (box.bottom - box.top) * frac); await idle(page); await frames(page, 3);
      const pt = await page.evaluate(([s, i, low]: any) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + Math.min(200, r.width / 2), y: low ? Math.min(r.bottom, innerHeight) - 60 : r.top + 10 }; }, [SEL[p], id, how === 'click-low']);
      const o = await measure(page, p, id, async () => {
        if (how === 'api-end') await page.evaluate(([pp, i]: string[]) => (window as any).editorAPI.editIn(pp, i, 1e9), [PID[p], id]);
        else {
          // as a reader does: the pointer comes over the block and rests, then presses (the caret map is made once the
          // pointer has rested, in idle time: waited for by its count, not by time)
          const w0 = await page.evaluate(() => (window as any).editorAPI.warmStats().warmed);
          await page.mouse.move(pt.x, pt.y);
          await page.waitForFunction((n: number) => (window as any).editorAPI.warmStats().warmed > n, w0, { timeout: 5000 }).catch(() => {});
          await page.mouse.click(pt.x, pt.y);
        }
        await waitSession(page, p, id);
      });
      const fr = o.frames.filter((f: any) => f.editing && f.pop);
      if (process.env.MOTION_DUMP && where === process.env.MOTION_DUMP) console.log(JSON.stringify(o.frames.map((f: any) => [Math.round(f.t - o.t0), f.editing ? 1 : 0, Math.round(f.y), f.blk && Math.round(f.blk.top), f.pop && Math.round(f.pop.top), f.pop && Math.round(f.pop.bottom), f.caret && Math.round(f.caret.top), Math.round(f.popOpacity * 100)])));
      const last = fr[fr.length - 1];
      const tag = `open [${p}, ${where}]`;
      // the fade in can be seen: 190 ms (180-200), from the slide's first frame (the same start), and over several frames
      {
        const a = o.anims, fd = a?.fade?.[0], sl = a?.slide ?? [];
        const mid = fr.filter((f: any) => f.popOpacity > 0.05 && f.popOpacity < 0.95).length;
        check(`${tag}: the popover fades in over 180-200 ms, starting with the slide (${sl.length} sliding), seen in ${mid} frames`, !!fd && fd.d >= 180 && fd.d <= 200 && sl.every((x: any) => Math.abs(x.s - fd.s) < 1) && mid >= 3, { fade: fd, slide: sl.slice(0, 2), mid });
      }
      if (!last) { check(`${tag}: the popover opened`, false, o.frames.slice(-2)); continue; }
      // the final place: the popover whole in the pane, the caret visible and not under it
      const inBox = last.pop.top >= last.box.top - 0.5 && last.pop.bottom <= last.box.bottom + 0.5;
      const caretOk = !!last.caret && last.caret.top >= last.box.top && last.caret.bottom <= last.pop.top + 0.5;
      check(`${tag}: in its final place the popover is whole in the pane and the caret's line is visible above it`, inBox && caretOk, { pop: last.pop, caret: last.caret, box: last.box });
      // reached in the first motion: once the motion is over (220 ms after the first frame with the editor), nothing moves
      const tOpen = fr[0].t, after = fr.filter((f: any) => f.t > tOpen + 300);
      const jump = after.reduce((m: number, f: any) => Math.max(m, Math.abs(f.pop.top - last.pop.top), Math.abs(f.blk.top - last.blk.top), Math.abs(f.y - last.y)), 0);
      check(`${tag}: the final place is reached in the first motion: no move > 1 px after it (${after.length} frames)`, after.length > 3 && jump <= 1, { jump: Math.round(jump * 10) / 10 });
      const back = oneWay(fr.map((f: any) => f.blk.top)), backNext = oneWay(o.frames.filter((f: any) => f.next).map((f: any) => f.next.top));
      check(`${tag}: the block and the one after it move one way only (no jump back > 1 px)`, back <= 1 && backNext <= 1, { back, backNext });
      const hidden = fr.filter((f: any) => f.t > tOpen + 40 && (!f.caret || f.caret.bottom < f.box.top || f.caret.top > f.box.bottom)).length;
      if (how !== 'api-end') check(`${tag}: the caret is visible throughout the motion`, hidden === 0, { hidden, of: fr.length });
      const long = o.lt.filter((x: any) => x.d > 50);
      const task = Math.max(0, ...o.task.filter((x: any) => x.type === 'click' || x.type === 'mousedown' || x.type === 'pointerdown').map((x: any) => x.ms));
      // the press's own work before the first frame of the motion: about a frame (two at most, on a cold first open or a
      // long paragraph, in this container without a GPU)
      const wLong = o.work.long(budget(50)), wTask = o.work.event('click', 'mousedown', 'pointerdown');
      timed(check, `${tag}: no task over ${lim(50)} of CPU while it opens; the press's work ${Math.round(wTask)} ms of CPU (<= ${lim(34)})`, !wLong.length && wTask <= budget(34), { long: wLong.map((x) => Math.round(x.cpu)), task: Math.round(wTask) },
        !long.length && task <= 34, { long: long.map((x: any) => Math.round(x.d)), task: Math.round(task) });
      // and the close: the mirror
      const c = await measure(page, p, id, async () => { await page.keyboard.press('Escape'); await page.waitForFunction(([s, i]: string[]) => !document.querySelector(`${s} .blk[data-id="${i}"].editing`), [SEL[p], id]); });
      const cl = c.frames, clLast = cl[cl.length - 1];
      if (process.env.MOTION_DUMP && where === process.env.MOTION_DUMP) console.log('close', JSON.stringify(cl.map((f: any) => [Math.round(f.t - c.t0), f.editing ? 1 : 0, Math.round(f.y), f.blk && Math.round(f.blk.top), f.next && Math.round(f.next.top), f.pop && Math.round(f.pop.top), Math.round(f.popOpacity * 100)])));
      const tClose = cl.find((f: any) => f.popOpacity < 1 || !f.pop)?.t ?? cl[0].t;
      const cAfter = cl.filter((f: any) => f.t > tClose + 300);
      const cJump = cAfter.reduce((m: number, f: any) => Math.max(m, Math.abs(f.blk.top - clLast.blk.top), Math.abs((f.next?.top ?? 0) - (clLast.next?.top ?? 0)), Math.abs(f.y - clLast.y)), 0);
      const cBack = oneWay(cl.filter((f: any) => f.next).map((f: any) => f.next.top));
      const cLong = c.lt.filter((x: any) => x.d > 50);
      // the popover fades where it was (out of the flow, as it was drawn): no move, no change of size while it fades
      const fading = cl.filter((f: any) => f.pop && f.popOpacity < 0.99 && f.popOpacity > 0.01);
      const moved = fading.reduce((m: number, f: any) => Math.max(m, Math.abs(f.pop.top - last.pop.top), Math.abs(f.pop.bottom - last.pop.bottom)), 0);
      check(`close [${p}, ${where}]: the popover fades out where it was (${fading.length} frames), as it was drawn (within 1 px)`, fading.length >= 2 && moved <= 1, { moved, fading: fading.length });
      const kTask = Math.max(0, ...c.task.filter((x: any) => x.type === 'keydown').map((x: any) => x.ms));
      // A + B < D: what is below the popover (the block after) stays; otherwise the top (the edited block) stays; one way
      const f0 = cl[0], clip = (y: number) => Math.min(f0.box.bottom, Math.max(f0.box.top, y));
      const hA = f0.render && f0.pop ? clip(f0.render.top) - f0.box.top : 0, hB = f0.render && f0.pop ? Math.max(0, clip(Math.min(f0.render.bottom, f0.pop.top)) - clip(f0.render.top)) : 0;
      const keep = f0.pop && f0.next && hA + hB < f0.box.bottom - clip(f0.pop.bottom) - 1 ? 'next' : 'blk';
      check(`close [${p}, ${where}]: A + B ${keep === 'next' ? '<' : '>='} D: ${keep === 'next' ? 'the block after stays' : 'the top (the edited block) stays'}, the other side moves one way, nothing moves after (${cAfter.length} frames)`, Math.abs(cl[0][keep].top - clLast[keep].top) <= 1 && cBack <= 1 && cJump <= 1 && cAfter.length > 3, { keep, at: [cl[0][keep].top, clLast[keep].top], cBack, cJump });
      const wcLong = c.work.long(budget(50)), wkTask = c.work.event('keydown');
      timed(check, `close [${p}, ${where}]: no task over ${lim(50)} of CPU while it closes; Escape's work ${Math.round(wkTask)} ms of CPU (<= ${lim(34)})`, !wcLong.length && wkTask <= budget(34), { long: wcLong.map((x) => Math.round(x.cpu)), task: Math.round(wkTask) },
        !cLong.length && kTask <= 34, { long: cLong.map((x: any) => Math.round(x.d)), task: Math.round(kTask) });
      console.log(`     ${p} ${where}: open task ${Math.round(task)} ms (CPU ${Math.round(wTask)}), close task ${Math.round(kTask)} ms (CPU ${Math.round(wkTask)}), open scrolled ${Math.round(last.y - o.frames[0].y)} px`);
    }
    await ctx.close();
  }
}

// ── closing the editor. Heights seen in the pane: A (the pane's top to the edited preview's
// top), B (the preview seen above the popover), C (the popover), D (the popover's bottom to the pane's bottom). The top
// part (A + B) moves down only if A + B < D; otherwise the top stays and what is below comes up. The popover's 50 % cap ──
if (section('least')) {
  for (const p of ['a', 'b']) {
    const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1440, height: 900 });
    await page.evaluate(RECORDER);
    for (let i = 0; i < 12; i++) await api(page, 'insert', 1, 'paragraph', `Filler paragraph ${i + 1}. ${'Some words to make it wrap over a few lines in the pane. '.repeat(4)}`);
    await idle(page);
    if (p === 'b') await openSplit(page);
    const blocks = await api(page, 'blocks') as any[];
    const paras = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 200).map((b: any) => b.id);
    const id = paras[Math.floor(paras.length / 2)];
    const boxOf = () => page.evaluate((s: string) => { const split = true; const sc = document.querySelector(s)!; return split ? { top: sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0), bottom: sc.getBoundingClientRect().top + (sc as HTMLElement).clientHeight } : { top: 56, bottom: innerHeight }; }, SEL[p]);
    const rectOf = (sel: string) => page.evaluate(([s, q]: string[]) => { const r = document.querySelector(s)!.querySelector(q)?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null; }, [SEL[p], sel]);
    const scrollPane = (dy: number) => page.evaluate(([s, d]: any) => { const sc = document.querySelector(s) as HTMLElement; sc.scrollTop += d; }, [SEL[p], dy]);
    const open1 = async () => {
      await toTop(page, p, id, 300); await idle(page);
      await page.evaluate(([pp, i]: any) => (window as any).editorAPI.editIn(pp, i, 0), [PID[p], id]);
      await waitSession(page, p, id); await idle(page); await frames(page, 20);
    };
    {
      await open1();
      const pop0 = (await rectOf(`.blk[data-id="${id}"] .blk-source`))!.top, h0 = (await rectOf(`.blk[data-id="${id}"]`))!;
      for (let k = 0; k < 2; k++) { await page.keyboard.type('x'); await page.keyboard.press('Enter'); }
      await idle(page); await frames(page, 4);
      const pop1 = (await rectOf(`.blk[data-id="${id}"] .blk-source`))!.top, h1 = (await rectOf(`.blk[data-id="${id}"]`))!;
      check(`least [${p}, typing]: 2 lines typed (B ${Math.round(h0.bottom - h0.top)} → ${Math.round(h1.bottom - h1.top)} px): the code popover keeps its place (moved ${Math.round((pop1 - pop0) * 10) / 10})`, h1.bottom - h1.top > h0.bottom - h0.top + 20 && Math.abs(pop1 - pop0) <= 1);
      for (let k = 0; k < 4; k++) await page.keyboard.press('ControlOrMeta+z');
      await page.keyboard.press('Escape'); await idle(page);
      const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === id), orig = blocks.find((x: any) => x.id === id).source;
      if (b.source !== orig) { await api(page, 'setSource', id, orig); await idle(page); }
    }
    for (const want of ['less', 'more', 'equal']) {
      await open1();
      const box = await boxOf();
      const r0 = (await rectOf(`.blk[data-id="${id}"] .blk-render`))!, q0 = (await rectOf(`.blk[data-id="${id}"] .blk-source`))!;
      const T = box.bottom - box.top, R = r0.bottom - r0.top, G = q0.top - r0.bottom, Ph = q0.bottom - q0.top;
      // where A goes: near the top (A + B well under D), low (the popover whole, 40 px above the bottom), or A + B = D
      const A = want === 'less' ? 40 : want === 'more' ? T - R - G - Ph - 40 : (T - G - Ph) / 2 - R;
      await scrollPane(r0.top - box.top - A); await idle(page); await frames(page, 4);
      const h = await page.evaluate(([s, i]: string[]) => {
        const split = true, sc = document.querySelector(s) as HTMLElement;
        // (the pane's reading box: below the glass, its scroll-padding-top, as the placement's P.box())
        const box = split ? { top: sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0), bottom: sc.getBoundingClientRect().top + sc.clientHeight } : { top: 56, bottom: innerHeight };
        const root = document.querySelector(`${s} .blk[data-id="${i}"]`)!, r = root.querySelector('.blk-render')!.getBoundingClientRect(), q = root.querySelector('.blk-source')!.getBoundingClientRect();
        const clip = (y: number) => Math.min(box.bottom, Math.max(box.top, y));
        return { A: clip(r.top) - box.top, B: Math.max(0, clip(Math.min(r.bottom, q.top)) - clip(r.top)), C: clip(q.bottom) - clip(q.top), D: box.bottom - clip(q.bottom), popBottom: q.bottom };
      }, [SEL[p], id]);
      const e = h.A + h.B - h.D;
      const tag = `least [${p}, A + B ${want === 'less' ? '<' : want === 'more' ? '>' : '='} D]`;
      const setup = want === 'less' ? e < -100 : want === 'more' ? e > 100 : Math.abs(e) <= 1;
      const before = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"]`)!; const R = (e: Element | null) => { const x = e?.getBoundingClientRect(); return x ? { top: x.top, bottom: x.bottom } : null; }; return { A: R(r.previousElementSibling), B: R(r), C: R(r.nextElementSibling) }; }, [SEL[p], id]);
      const c = await measure(page, p, id, async () => { await page.keyboard.press('Escape'); await page.waitForFunction(([s, i]: string[]) => !document.querySelector(`${s} .blk[data-id="${i}"].editing`), [SEL[p], id]); });
      const fr = c.frames.filter((f: any) => f.prev && f.next && f.blk);
      const L = fr[fr.length - 1];
      const heights = `A ${Math.round(h.A)}, B ${Math.round(h.B)}, C ${Math.round(h.C)}, D ${Math.round(h.D)}`;
      // what must stay: below (A + B < D): the line just below the popover's old place (the next block's top); otherwise the
      // top: the edited block's top (the line at the pane's top, the block above, with it)
      const below = want === 'less' && h.A + h.B < h.D - 1;
      const drift = fr.reduce((m: number, f: any) => Math.max(m, below ? Math.abs(f.next.top - before.C!.top) : Math.max(Math.abs(f.blk.top - before.B!.top), Math.abs(f.prev.bottom - before.A!.bottom))), 0);
      const shift = below ? L.blk.top - before.B!.top : before.C!.top - L.next.top;       // the side that moves: the top down, or the rest up
      check(`${tag} (${heights}): ${below ? 'the line below the popover' : 'the top'} keeps its y through the close (${fr.length} frames, within 1 px), ${below ? 'the top comes down' : 'what is below comes up'} ${Math.round(shift)} px`, setup && fr.length > 3 && drift <= 1 && shift > 20, { e, drift: Math.round(drift * 10) / 10, shift, before, box });
      // no blank gap: at the end A, B and C follow each other as in the document (the gaps between them as at rest)
      const gaps = L ? [L.blk.top - L.prev.bottom, L.next.top - L.blk.bottom] : [NaN, NaN];
      const rest = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"]`)!; const a = r.previousElementSibling!.getBoundingClientRect(), b = r.getBoundingClientRect(), c = r.nextElementSibling!.getBoundingClientRect(); return [b.top - a.bottom, c.top - b.bottom]; }, [SEL[p], id]);
      check(`${tag}: no blank gap left (${gaps.map(Math.round)} vs ${rest.map(Math.round)} px at rest)`, Math.abs(gaps[0] - rest[0]) <= 1 && Math.abs(gaps[1] - rest[1]) <= 1, { gaps, rest });
      const back = oneWay(c.frames.filter((f: any) => f.blk).map((f: any) => f.blk.top));
      check(`${tag}: one motion: the edited block moves one way only (no jump back > 1 px)`, back <= 1, { back });
    }
    // the cap: the popover covers at most half the pane, on open and while typing, a block taller than the window too
    const tall = await api(page, 'insert', Math.floor(blocks.length / 2) + 6, 'paragraph', LONG);
    await idle(page);
    for (const [name, bid] of [['a paragraph', id], ['a block taller than the window', tall]] as [string, string][]) {
      await toTop(page, p, bid, 200); await idle(page);
      await page.evaluate(([pp, i]: string[]) => (window as any).editorAPI.editIn(pp, i, 0), [PID[p], bid]);
      await waitSession(page, p, bid); await idle(page); await frames(page, 20);
      const box = await boxOf();
      const pop0 = await rectOf(`.blk[data-id="${bid}"] .blk-source`);
      await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
      for (let k = 0; k < 30; k++) { await page.keyboard.press('Enter'); await page.keyboard.type(`line ${k}`); }
      await idle(page); await frames(page, 4);
      const pop1 = await rectOf(`.blk[data-id="${bid}"] .blk-source`);
      const half = (box.bottom - box.top) / 2, h0 = pop0 ? pop0.bottom - pop0.top : 0, h1 = pop1 ? pop1.bottom - pop1.top : 0;
      check(`cap [${p}]: ${name}: the popover is at most half the pane on open (${Math.round(h0)}) and after 30 lines typed (${Math.round(h1)} <= ${Math.round(half)})`, h0 > 0 && h1 > 0 && h0 <= half && h1 <= half, { h0, h1, half });
      for (let k = 0; k < 2; k++) await page.keyboard.press('ControlOrMeta+z');
      await page.keyboard.press('Escape');
      await idle(page);
      const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === bid);
      const orig = bid === tall ? LONG : blocks.find((x: any) => x.id === bid).source;
      if (b.source !== orig) { await api(page, 'setSource', bid, orig); await idle(page); }
    }
    await ctx.close();
  }
}

// ── scroll gestures over the code view: the document when the code all fits, only the code when it scrolls ──
if (section('wheel')) {
  for (const p of ['a', 'b']) {
    const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1440, height: 900 });
    for (let i = 0; i < 12; i++) await api(page, 'insert', 1, 'paragraph', `Filler paragraph ${i + 1}. ${'Some words to make it wrap over a few lines in the pane. '.repeat(4)}`);
    await idle(page);
    if (p === 'b') await openSplit(page);
    const blocks = await api(page, 'blocks') as any[];
    const short = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 200)[3].id;
    const long = await api(page, 'insert', Math.floor(blocks.length / 2), 'paragraph', Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a source much taller than its popover.`).join('\n'));
    await idle(page);
    const scrollPane = () => scrollOf(page, p);
    const code = (id: string) => page.evaluate(([s, i]: string[]) => { const sc = document.querySelector(`${s} .blk[data-id="${i}"] .blk-source .cm-scroller`) as HTMLElement; const r = sc.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 40), top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight }; }, [SEL[p], id]);
    const wheel = async (x: number, y: number, dy: number, n: number) => { await page.mouse.move(x, y); for (let k = 0; k < n; k++) { await page.mouse.wheel(0, dy); await frames(page, 2); } await frames(page, 6); };
    // the code fits: the gesture scrolls the document
    await toTop(page, p, short, 300); await idle(page);
    await page.evaluate(([pp, i]: string[]) => (window as any).editorAPI.editIn(pp, i, 0), [PID[p], short]);
    await waitSession(page, p, short); await idle(page); await frames(page, 20);
    const c0 = await code(short), y0 = await scrollPane();
    await wheel(c0.x, c0.y, 120, 3);
    const y1 = await scrollPane();
    check(`wheel [${p}]: over a code view that all fits (max ${c0.max}), the gesture scrolls the document (${Math.round(y1 - y0)} px)`, c0.max <= 0 && y1 - y0 >= 200, { y0, y1, max: c0.max });
    await page.keyboard.press('Escape'); await idle(page);
    // the code scrolls: only the code moves, also past its end (no chaining)
    await toTop(page, p, long, 200); await idle(page);
    await page.evaluate(([pp, i]: string[]) => (window as any).editorAPI.editIn(pp, i, 0), [PID[p], long]);
    await waitSession(page, p, long); await idle(page); await frames(page, 20);
    const c1 = await code(long), y2 = await scrollPane();
    await wheel(c1.x, c1.y, 120, 3);
    const c2 = await code(long), y3 = await scrollPane();
    check(`wheel [${p}]: over a code view that scrolls, the code scrolls (${c2.top - c1.top} px) and the document does not`, c1.max > 0 && c2.top > c1.top && Math.abs(y3 - y2) <= 1, { code: [c1.top, c2.top, c1.max], doc: [y2, y3] });
    await wheel(c1.x, c1.y, 400, 12);
    const c3 = await code(long), y4 = await scrollPane();
    check(`wheel [${p}]: at the code's end, more gestures do not scroll the document (no chaining)`, Math.abs(c3.top - c3.max) <= 1 && Math.abs(y4 - y2) <= 1, { code: [c3.top, c3.max], doc: [y2, y4] });
    await ctx.close();
  }
}

// ── the block's side line keeps --rtx-side-gap (12 px) from the text: paragraph, theorem, display; both panes,
// light and dark, and at a phone's width; the text keeps its x ────────────────────────────────────────────────────
if (section('gap')) {
  for (const [scheme, width, split] of [['light', 1440, true], ['dark', 1440, true], ['light', 390, false]] as [string, number, boolean][]) {
    const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width, height: 900, reduced: true, scheme });
    if (split) await openSplit(page);
    const blocks = await api(page, 'blocks') as any[];
    const kinds: [string, string][] = [
      ['paragraph', blocks.find((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 200)?.id],
      ['theorem', blocks.find((b: any) => /\\begin\{(theorem|lemma|definition)/.test(b.source))?.id],
      ['display', blocks.find((b: any) => /\\begin\{(equation|align)|\\\[/.test(b.source))?.id],
    ].filter(([, id]) => id) as [string, string][];
    for (const p of split ? ['a', 'b'] : ['a']) {
      const out: any[] = [];
      for (const [kind, id] of kinds) {
        await toTop(page, p, id, 200); await idle(page);
        const x0 = await page.evaluate(([s, i]: string[]) => document.querySelector(`${s} .blk[data-id="${i}"] .blk-render > .latex-block:not(.incoming)`)!.getBoundingClientRect().left, [SEL[p], id]);
        // the pending/landed line (the same line, before the block is edited)
        const pend = await page.evaluate(([s, i]: string[]) => { const m = document.querySelector(`${s} .blk[data-id="${i}"] > .blk-main`)!, cs = getComputedStyle(m, '::before'); return m.getBoundingClientRect().left + parseFloat(cs.left) + parseFloat(cs.width); }, [SEL[p], id]);
        await page.evaluate(([pp, i]: string[]) => (window as any).editorAPI.editIn(pp, i, 0), [PID[p], id]);
        await waitSession(page, p, id); await idle(page); await frames(page, 3);
        const g = await page.evaluate(([s, i]: string[]) => {
          const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`) as HTMLElement, cs = getComputedStyle(r, '::after');
          const text = r.querySelector(':scope > .latex-block:not(.incoming)')!.getBoundingClientRect().left;
          const line = r.getBoundingClientRect().left + parseFloat(cs.left), pane = document.querySelector(s)!.getBoundingClientRect().left;
          return { text, lineL: line, lineR: line + parseFloat(cs.width), shown: cs.content !== 'none' && cs.display !== 'none', colour: cs.backgroundColor, pane };
        }, [SEL[p], id]);
        out.push({ kind, gap: Math.round((g.text - g.lineR) * 10) / 10, pendGap: Math.round((x0 - pend) * 10) / 10, moved: Math.round((g.text - x0) * 10) / 10, inPane: g.lineL >= g.pane, shown: g.shown });
        await page.keyboard.press('Escape'); await idle(page);
      }
      const ok = out.length === 3 && out.every((o) => o.shown && Math.abs(o.gap - 12) <= 0.5 && Math.abs(o.pendGap - 12) <= 0.5 && Math.abs(o.moved) <= 0.5 && o.inPane);
      check(`gap [${scheme}, ${width} px, pane ${p.toUpperCase()}]: the side line 12 px from the text (editing and pending), the text unmoved, the line in the pane: paragraph, theorem, display`, ok, out);
    }
    await ctx.close();
  }
}

// ── the mirrored caret in a wide display moves with the display when it is scrolled sideways ──────────────
const WIDE = 'Before the display \\[ a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12} + a_{13} + a_{14} + a_{15} + a_{16} + a_{17} + a_{18} + a_{19} + a_{20} + a_{21} + a_{22} + a_{23} + a_{24} + a_{25} + a_{26} + a_{27} + a_{28} = b \\] and after.';
if (section('display')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1000, height: 900, reduced: true });
  const id = await api(page, 'insert', 2, 'paragraph', WIDE);
  await idle(page);
  for (const p of ['a', 'b']) {
    if (p === 'b') await openSplit(page);
    await toTop(page, p, id, 200); await idle(page);
    await page.evaluate(([pp, i, c]: any) => (window as any).editorAPI.editIn(pp, i, c), [PID[p], id, WIDE.indexOf('a_{14}')]);
    await waitSession(page, p, id);
    await idle(page); await frames(page, 3);
    const at = () => page.evaluate(([s, i]: string[]) => {
      const root = document.querySelector(`${s} .blk[data-id="${i}"]`)!, d = root.querySelector('.latex-display') as HTMLElement, svg = d?.querySelector('svg');
      const bar = root.querySelector('.rtx-caret-bar');
      if (!d || !svg || !bar) return null;
      return { bar: bar.getBoundingClientRect().left, svg: svg.getBoundingClientRect().left, sl: d.scrollLeft, max: d.scrollWidth - d.clientWidth, inside: !!bar.closest('.latex-display') };
    }, [SEL[p], id]);
    const a0 = await at();
    // the reader scrolls the display sideways (as a trackpad does), by 80 px each way it can
    const dir = a0 && a0.sl > a0.max / 2 ? -1 : 1;
    await page.evaluate(([s, i, d]: any) => { (document.querySelector(`${s} .blk[data-id="${i}"] .latex-display`) as HTMLElement).scrollLeft += 80 * d; }, [SEL[p], id, dir]);
    await frames(page, 2);
    const a1 = await at();
    const off0 = a0 ? a0.bar - a0.svg : NaN, off1 = a1 ? a1.bar - a1.svg : NaN;
    check(`display [${p}]: scrolled sideways by ${a1 && a0 ? a1.sl - a0.sl : '?'} px, the caret keeps its place on the glyphs (within 1 px)`, !!a0 && !!a1 && Math.abs(a1.sl - a0.sl) > 20 && Math.abs(off1 - off0) <= 1 && a0.inside, { a0, a1, off0, off1 });
    await api(page, 'leave'); await idle(page);
  }
  await ctx.close();
}

// ── the selection is drawn below the glyphs: a selected letter keeps the text's colour ────────────────────
/** pixels of a page region (a screenshot decoded in the page): [r, g, b][] */
async function pixels(page: any, clip: { x: number, y: number, width: number, height: number }) {
  const png: Buffer = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  return page.evaluate(async (b64: string) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bm = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d')!;
    g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data, out: number[][] = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, png.toString('base64'));
}
/** the most frequent colour of a sample (a plain fill under a few glyphs) */
const mode = (ps: number[][]) => { const n = new Map<string, number>(); for (const p of ps) { const k = p.join(); n.set(k, (n.get(k) ?? 0) + 1); } return [...n].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number); };
const lum = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
// the code view's measured shades, kept for both views
const WANT: Record<string, number[]> = { light: [211, 230, 249], dark: [36, 55, 73] };
if (section('selection')) {
  for (const scheme of ['light', 'dark', 'sepia']) {
    const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1200, height: 900, reduced: true, scheme: scheme === 'dark' ? 'dark' : 'light', theme: scheme });
    const text = 'Selected words here, and these words are not selected at all, so the two can be compared. '.repeat(3).trim();
    const id = await api(page, 'insert', 2, 'paragraph', text);
    await idle(page);
    await toTop(page, 'a', id, 200); await idle(page);
    await api(page, 'edit', id, 0);
    await waitSession(page, 'a', id); await idle(page);
    await page.evaluate((pa: string) => { const v = (window as any).editorAPI.editorView(pa); v.dispatch({ selection: { anchor: 0, head: 14 } }); }, PID.a);
    await frames(page, 4);
    // no blinking caret in the samples (the caret line's bands stay: the selection lies over them in both views)
    await page.addStyleTag({ content: '.rtx-caret-bar, .cm-cursorLayer { display: none !important; }' });
    await frames(page, 2);
    const g = await page.evaluate((i: string) => {
      const root = document.querySelector(`[data-part="page"] .blk[data-id="${i}"]`)!;
      const band = root.querySelector('.rtx-sel-band:not(.rtx-sel-glyph)')?.getBoundingClientRect();
      const cm = root.querySelector('.cm-selectionBackground')?.getBoundingClientRect();
      const render = root.querySelector('.blk-render')!.getBoundingClientRect();
      return band ? { band: { x: band.left, y: band.top, w: band.width, h: band.height }, render: { x: render.left, y: render.top, w: render.width }, cm: cm ? { x: cm.left, y: cm.top, w: cm.width, h: cm.height } : null,
        theme: document.documentElement.className } : null;
    }, id);
    if (!g) { check(`selection [${scheme}]: a selection band is drawn`, false); await ctx.close(); continue; }
    const r = (x: number, y: number, w: number, h: number) => ({ x: Math.round(x), y: Math.round(y), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
    const sel = await pixels(page, r(g.band.x + 1, g.band.y + 1, g.band.w - 2, g.band.h - 2));
    // the same line, past the selection: unselected glyphs on the page's background
    const un = await pixels(page, r(g.band.x + g.band.w + 30, g.band.y + 1, Math.min(160, g.render.x + g.render.w - (g.band.x + g.band.w + 30)), g.band.h - 2));
    const pick = (ps: number[][], ink: boolean) => ps.reduce((a, p) => ((scheme !== 'dark') === ink ? (lum(p) < lum(a) ? p : a) : (lum(p) > lum(a) ? p : a)));
    // the page: the next line (no caret line band there); fills by their most frequent colour
    const page2 = await pixels(page, r(g.band.x + 1, g.band.y + g.band.h + 4, g.band.w - 2, g.band.h - 2));
    const inkSel = pick(sel, true), inkUn = pick(un, true), bgSel = mode(sel), bgUn = mode(page2);
    const diff = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));
    check(`selection [${scheme}]: a selected glyph keeps the text's colour (its ink within 16 of an unselected glyph's)`, diff(inkSel, inkUn) <= 16, { inkSel, inkUn });
    check(`selection [${scheme}]: the band is visible (its colour differs from the page by more than 20)`, diff(bgSel, bgUn) > 20, { bgSel, bgUn });
    // one shade: the code view's selection and the preview's band, the same colour (within 2 per channel)
    const cmSel = g.cm ? mode(await pixels(page, r(g.cm.x + 1, g.cm.y + 1, g.cm.w - 2, g.cm.h - 2))) : null, bandSel = bgSel;
    check(`selection [${scheme}]: the preview's band and the code view's selection are one shade (within 2 per channel)`, !!cmSel && diff(cmSel, bandSel) <= 2 && (!WANT[scheme] || diff(cmSel, WANT[scheme]) <= 2) && (scheme === 'light' ? !/dark|sepia/.test(g.theme) : g.theme.includes(scheme)), { band: bandSel, code: cmSel, want: WANT[scheme] ?? null, theme: g.theme });
    await ctx.close();
  }
}

// prefers-reduced-motion: the same final place, at once, nothing animated
if (section('reduced')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1440, height: 900, reduced: true });
  for (let i = 0; i < 12; i++) await api(page, 'insert', 1, 'paragraph', `Filler paragraph ${i + 1}. ${'Some words to make it wrap over a few lines in the pane. '.repeat(4)}`);
  await idle(page);
  const blocks = await api(page, 'blocks') as any[];
  const id = blocks.filter((b: any) => b.kind === 'paragraph' && b.source.length > 200)[6].id;
  await toTop(page, 'a', id, 844 * 0.86); await idle(page); await frames(page, 3);
  const pt = await page.evaluate((i: string) => { const r = document.querySelector(`[data-part="page"] .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + 100, y: r.top + 10 }; }, id);
  await page.mouse.click(pt.x, pt.y);
  await waitSession(page, 'a', id);
  const r = await page.evaluate((i: string) => { const root = document.querySelector(`[data-part="page"] .blk[data-id="${i}"]`)!; const pop = root.querySelector('.blk-source')!.getBoundingClientRect();
    return { anims: document.getAnimations().filter((a) => a.playState === 'running' && a.constructor.name === 'Animation').length,   // script animations (not a CSS hover transition)
      pop: { top: pop.top, bottom: pop.bottom }, opacity: getComputedStyle(root.querySelector('.blk-source')!).opacity }; }, id);
  check('reduced motion: the editor is in its final place at once (whole on screen), nothing animates', r.anims === 0 && r.pop.bottom <= 900 && r.opacity === '1', r);
  await page.keyboard.press('Escape');
  const gone = await page.evaluate((i: string) => ({ editing: !!document.querySelector(`[data-part="page"] .blk[data-id="${i}"].editing`), anims: document.getAnimations().filter((a) => a.playState === 'running' && a.constructor.name === 'Animation').length }), id);
  check('reduced motion: Escape closes at once (no fade, no slide)', !gone.editing && gone.anims === 0, gone);
  await ctx.close();
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, problems }, null, 2));
const failed = results.filter((r) => !r.ok).length;
if (problems.length) console.log(`page problems (${problems.length}):\n  ${problems.slice(0, 10).join('\n  ')}`);
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
