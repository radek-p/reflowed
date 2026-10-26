// ── a document compiling holds the reader's place ──
// While a document compiles, a tab showing it sometimes scrolled gently up or down (blocks above the reader's
// place changing height as their results land). A 120-block article opened cold, its pane scrolled to the middle at
// once: from there until the compile is done, the first block below the pane's reading top (its top plus the glass
// strip, scroll-padding-top) moves at most 1.5 px (it was 5.4 px on 200 blocks, before the keeper measured from the
// reading top and held once a task), in every frame as painted: read after the frame's layout and its ResizeObserver
// callbacks, where the keeper puts the page back (perf/anchor.js), as test-w11-anchor's SAMPLE reads. (Read in
// requestAnimationFrame, it saw the page as a task left it, a block's height changed by the viewer's own re-break
// before the frame's layout and the keeper's correction in it: never painted.)
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^compile-drift$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open } = h;
  const { article } = await import('../qa/probe-responsiveness.ts');
  const { ctx, page } = await open('#/', { width: 1440 });
  const id = await page.evaluate(async (tex: string) => { const E = (window as any).editorAPI; return E.store().createDoc(await E.io().importFile({ name: 'drift.tex', bytes: new TextEncoder().encode(tex) })); }, article(120));
  void page.evaluate((d: string) => (window as any).editorAPI.open(d), id);
  await page.waitForFunction(() => document.querySelectorAll('main.rtx-pane .blk').length > 60);
  const r = await page.evaluate(async () => {
    const E = (window as any).editorAPI, main = document.querySelector('main.rtx-pane') as HTMLElement;
    main.scrollTop = (main.scrollHeight - main.clientHeight) / 2;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const top = () => main.getBoundingClientRect().top + (parseFloat(getComputedStyle(main).scrollPaddingTop) || 0);
    const blk = [...main.querySelectorAll('.blk[data-id]')].find((x) => x.getBoundingClientRect().top >= top() - 2) as HTMLElement;
    const y0 = blk.getBoundingClientRect().top - top();
    const typesetBefore = main.querySelectorAll('.blk-render > .latex-block').length;
    const ys: number[] = [];
    let go = true;
    // after each frame's layout: a probe resized in the frame's requestAnimationFrame, read in its ResizeObserver's
    // callback (observers are called in the order they were made: the keeper's first)
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
    document.body.append(probe);
    let flip = false;
    const tick = () => requestAnimationFrame(() => { flip = !flip; probe.style.width = flip ? '2px' : '1px'; });
    const ro = new ResizeObserver(() => { ys.push(blk.getBoundingClientRect().top - top() - y0); if (go) tick(); });
    ro.observe(probe);
    await E.whenIdle();
    go = false;
    ro.disconnect(); probe.remove();
    return { frames: ys.length, typesetBefore, typesetAfter: main.querySelectorAll('.blk-render > .latex-block').length, connected: blk.isConnected,
      maxAbs: Math.round(Math.max(...ys.map(Math.abs)) * 10) / 10 };
  });
  check('compile-drift: a long document compiling, its pane scrolled to the middle: the reading block moves at most 1.5 px',
    r.connected && r.typesetAfter > r.typesetBefore + 50 && r.frames > 10 && r.maxAbs <= 1.5, r);
  await ctx.close();
}
