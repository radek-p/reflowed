// ── a document compiling holds the reader's place ──
// While a document compiles, a tab showing it sometimes scrolled gently up or down (blocks above the reader's
// place changing height as their results land). A 120-block article opened cold, its pane scrolled to the middle at
// once: from there until the compile is done, the first block below the pane's reading top (its top plus the glass
// strip, scroll-padding-top) moves at most 1.5 px (it was 5.4 px on 200 blocks, before the keeper measured from the
// reading top and held once a task).
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
    const f = () => { ys.push(blk.getBoundingClientRect().top - top() - y0); if (go) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    await E.whenIdle();
    go = false;
    return { frames: ys.length, typesetBefore, typesetAfter: main.querySelectorAll('.blk-render > .latex-block').length, connected: blk.isConnected,
      maxAbs: Math.round(Math.max(...ys.map(Math.abs)) * 10) / 10 };
  });
  check('compile-drift: a long document compiling, its pane scrolled to the middle: the reading block moves at most 1.5 px',
    r.connected && r.typesetAfter > r.typesetBefore + 50 && r.frames > 10 && r.maxAbs <= 1.5, r);
  await ctx.close();
}
