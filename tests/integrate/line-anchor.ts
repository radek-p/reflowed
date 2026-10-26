// ── the reader's line holds across a width change ──
// A long document (one paragraph a hundred times, made here), read from its middle: the side column opened and closed
// (the workbench's width lock, then one reflow) must leave the line at the top of the view where it was, and with a
// paragraph being edited, the caret's line where it was. Every block's height changes in the reflow, the one across the
// top included, so holding a block's top (the keeper's anchor before) let the line itself move by up to a block. And the
// page's height changes once for the blocks out of view (each keeps its old height until the last idle slice), not once
// a slice (the scrollbar flickered for a second or two). At a busy machine's pace (CPU throttled 4×).
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^line-anchor$'
import type { Harness } from './harness.ts';

const PARA = 'The reader keeps their place while the column changes width. Every paragraph of this document is the same one, '
  + 'long enough to take several lines at any width: $a^2 + b^2 = c^2$ holds for the sides of a right triangle, and the '
  + 'lines break again at every width the pane is given, so each block grows or shrinks when the side column comes or goes. '
  + 'The line the reader was reading must stay where it was, not the top of the block it is in.';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, browser } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 960, ctx: await browser.newContext({ viewport: { width: 960, height: 900 }, reducedMotion: 'no-preference' }) });
  // at a busy machine's pace (the CPU throttled 4×, as Chromium's DevTools do), where the viewer's own slices (it lays
  // out a re-broken block's part off the screen in idle time) lag the width governor's: its last re-broken blocks were
  // laid out after it had let the old heights go, a second change of the page's height
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const id = await page.evaluate(async (p: string) => {
    const blocks = [{ kind: 'heading', source: '\\section{Long}' }, ...Array.from({ length: 100 }, () => ({ kind: 'paragraph', source: `${p} ${p}` }))];
    return (window as any).editorAPI.store().createDoc({ title: 'Long', preamble: '\\documentclass{article}\n\\usepackage{amsmath}', blocks });
  }, PARA);
  await page.evaluate((d: string) => { const wb = (window as any).editorAPI.workbench(); wb.replace(wb.current.peek().tab.id, { view: 'document', state: { doc: d } }); }, id);
  await page.evaluate(() => (window as any).editorAPI.view().set({ width: 'fit' }));   // (Paper: a column that fits stays as it is)
  await idle(page);
  await page.waitForFunction(() => document.querySelectorAll('main.rtx-pane .blk-render > .latex-block').length > 50, null, { timeout: 120000 });
  await idle(page);

  // in the page: the line of the document at client y (the first line whose baseline is below it), as a node of it and
  // its baseline's y; and where a node's line is now. Read through the viewer's replay (no DOM of its own)
  await page.evaluate(() => {
    const W = window as any, ins = W.reflowtex.inspect;
    const segsOf = (lb: HTMLElement) => { const st = ins.state(lb); return st?.cache?.layout?.laid?.length ? { st, n: st.cache.layout.laid.length } : null; };
    const lines = (lb: HTMLElement) => {
      const out: { nodes: any[]; y: number }[] = [], s = segsOf(lb);
      for (let i = 0; s && i < s.n; i++) {
        const svg = s.st.cache.dom?.segs?.[i]?.svg, M = svg?.getScreenCTM();
        if (M) ins.replay(lb, i, { line: (_j: number, line: any, _x: number, by: number) => out.push({ nodes: line.nodes, y: M.d * by + M.f }) });
      }
      return out;
    };
    const shown = () => [...document.querySelectorAll('main.rtx-pane[data-pane]')].find((m) => !m.closest('.wb-panel--hidden')) as HTMLElement;
    W.__lineAt = (y: number) => {
      for (const lb of shown().querySelectorAll<HTMLElement>('.blk-render > .latex-block:not(.incoming):not(.rtx-w-ghost)')) {
        const r = lb.getBoundingClientRect();
        if (r.bottom <= y) continue;
        const l = lines(lb).find((q) => q.y > y);
        if (!l) continue;
        const node = l.nodes.find((n: any) => n.type === 'glyph');
        W.__mark = { lb, node };
        return l.y;
      }
      return null;
    };
    W.__markY = () => { const m = W.__mark; return lines(m.lb).find((q) => q.nodes.includes(m.node))?.y ?? null; };
    W.__shown = shown;
  });
  const scroller = () => page.evaluate(() => { let e: HTMLElement | null = (window as any).__shown().querySelector('.blocks'); while (e && !/(auto|scroll)/.test(getComputedStyle(e).overflowY)) e = e.parentElement; return e ? e.getBoundingClientRect().top + (parseFloat(getComputedStyle(e).scrollPaddingTop) || 0) : 0; });
  // the side column toggled with its motion; then the reflow's frames: the marked line's y
  const toggled = (side: string) => page.evaluate(async (s: string) => {
    const E = (window as any).editorAPI, wb = E.workbench();
    E.tabs().widths.resetStats();
    let sliding = true; const off = wb.on('resizeend', () => { sliding = false; });
    wb.run('toggleSide', s);
    while (sliding) await new Promise((r) => requestAnimationFrame(r));
    off();
    const ys: number[] = [], hs: number[] = [];
    let sc: HTMLElement | null = (window as any).__shown().querySelector('.blocks'); while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    let going = true;
    const frame = () => { if (!going) return; const y = (window as any).__markY(); if (y != null) ys.push(Math.round(y)); hs.push(sc!.scrollHeight); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    await E.whenIdle(); await E.tabs().widths.idle();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    going = false;
    hs.push(sc!.scrollHeight);
    // the scroll height's changes: one a frame while the blocks in view re-break (a frame's budget each), then one when
    // the ones out of view (re-broken in idle slices) let go of their old heights together
    const changes = hs.filter((h, i) => i > 0 && h !== hs[i - 1]).length, W = E.tabs().widths.stats();
    return { ys, after: (window as any).__markY(), col: (window as any).__mark.lb.getBoundingClientRect().width, changes, inView: W.frames.filter((x: any) => x.settle).length, slices: W.slices.length };
  }, side);

  // read from the middle: the view's top across a paragraph's middle (its first lines above the view)
  const top = await scroller();
  await page.evaluate(async () => {
    const W = window as any, p = W.__shown(), blks = p.querySelectorAll('.blocks > .blk'), b = blks[50] as HTMLElement;
    let e: HTMLElement | null = b.parentElement; while (e && !/(auto|scroll)/.test(getComputedStyle(e).overflowY)) e = e.parentElement;
    e!.scrollBy({ top: b.getBoundingClientRect().top - e!.getBoundingClientRect().top - (parseFloat(getComputedStyle(e!).scrollPaddingTop) || 0) + b.getBoundingClientRect().height / 2, behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await idle(page);
  const y0 = await page.evaluate((t: number) => (window as any).__lineAt(t + 4), top);
  const open1 = await toggled('left');
  const close1 = await toggled('left');
  const near = (y: number | null) => y != null && Math.abs(y - y0!) <= 2;
  check('line-anchor: the side column opened, then closed: the line at the top of the reading stays where it was',
    y0 != null && open1.col !== close1.col && near(open1.after) && near(close1.after), { y0, open: open1.after, close: close1.after, columns: [open1.col, close1.col] });
  check('line-anchor: the page\'s height changes once for the blocks out of view, however many idle slices re-broke them (and once a frame for those in view)',
    [open1, close1].every((r) => r.slices > 2 && r.changes <= r.inView + 1), [open1, close1].map(({ changes, inView, slices }) => ({ changes, inView, slices })));
  check('line-anchor: and in every frame of the reflows it never left the view',
    [...open1.ys, ...close1.ys].every((y) => y > top && y < 900), { y0, open: open1.ys, close: close1.ys });

  // a paragraph edited, its caret in view: the caret's line holds
  const caretY = () => page.evaluate(() => { const c = document.querySelector('main.rtx-pane .cm-editor .cm-cursor, main.rtx-pane .cm-editor .cm-caretLine') as HTMLElement | null; return c ? Math.round(c.getBoundingClientRect().top) : null; });
  await page.evaluate(async () => {
    const W = window as any, E = W.editorAPI;
    const p = W.__shown(), b = p.querySelectorAll('.blocks > .blk')[52] as HTMLElement;
    E.edit(b.dataset.id, 300);
    await E.whenIdle();
  });
  await idle(page);
  const c0 = await caretY();
  const open2 = await toggled('left');
  const c1 = await caretY();
  const close2 = await toggled('left');
  const c2 = await caretY();
  check('line-anchor: with a paragraph edited, the caret\'s line stays where it was as the column opens and closes',
    c0 != null && c1 != null && c2 != null && Math.abs(c1 - c0) <= 2 && Math.abs(c2 - c0) <= 2, { c0, c1, c2, open: open2.after, close: close2.after });
  await ctx.close();
}
