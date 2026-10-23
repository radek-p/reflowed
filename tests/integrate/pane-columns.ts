// ── each pane its own column ──
// Two groups side by side, one narrow and one wide: the page had one column (--col, on <body>), measured in the focused
// pane, so both documents took the narrow one's width, and a click in the other changed both. Now each pane has its own
// --col from its own width (Fit: the pane's room; Paper: its document's \textwidth, fitted to the pane when narrower),
// whichever pane has the focus.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^pane-columns$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await idle(page);
  // the split narrow on the left, wide on the right
  await page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const root = wb.layout.peek().root;
    wb.resize(root.id, [0.28, 0.72]);
    await E.whenIdle(); await E.tabs().widths.idle();
  });
  const measure = () => page.evaluate(async () => {
    const E = (window as any).editorAPI;
    await E.whenIdle(); await E.tabs().widths.idle();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [...document.querySelectorAll('main.rtx-pane[data-pane]')].filter((m) => !m.closest('.wb-panel--hidden')).map((m) => {
      const el = m as HTMLElement, blocks = el.querySelector('.blocks > .blk') as HTMLElement | null;
      return { pane: el.dataset.pane!, paneW: Math.round(el.clientWidth), col: parseFloat(getComputedStyle(el).getPropertyValue('--col')), blocksW: Math.round(blocks?.getBoundingClientRect().width ?? 0) };
    }).sort((a, b) => a.paneW - b.paneW);
  });
  // the reader moves the focus: a press in the pane, away from its blocks (its bottom-left corner)
  const focus = async (pane: string) => {
    const r = await page.evaluate((p: string) => { const b = document.querySelector(`main.rtx-pane[data-pane="${p}"]`)!.getBoundingClientRect(); return { x: b.left + 2, y: b.bottom - 6 }; }, pane);
    await page.mouse.click(r.x, r.y);
  };

  await page.evaluate(() => (window as any).editorAPI.view().set({ width: 'fit' }));
  const fit = await measure();
  const [narrow, wide] = fit;
  check('pane-columns (Fit): each pane\'s column is its own room; the wide pane\'s is not the narrow one\'s',
    fit.length === 2 && narrow.col <= narrow.paneW && wide.col <= wide.paneW && wide.col > narrow.col + 200 && wide.blocksW > narrow.blocksW + 200, fit);
  await focus(narrow.pane);
  const afterNarrow = await measure();
  await focus(wide.pane);
  const afterWide = await measure();
  check('pane-columns (Fit): the focus moving to either pane changes neither column',
    afterNarrow.every((x, i) => x.col === fit[i].col) && afterWide.every((x, i) => x.col === fit[i].col), { fit, afterNarrow, afterWide });

  await page.evaluate(() => (window as any).editorAPI.view().set({ width: 'paper' }));
  const paper = await measure();
  await focus(paper[0].pane);
  const paperNarrowFocused = await measure();
  check('pane-columns (Paper): the wide pane shows the document\'s \\textwidth, the narrow one is fitted to itself, whichever has the focus',
    paper[1].col > paper[0].col + 100 && paper[0].col <= paper[0].paneW && paperNarrowFocused.every((x, i) => x.col === paper[i].col), { paper, paperNarrowFocused });
  await ctx.close();
}
