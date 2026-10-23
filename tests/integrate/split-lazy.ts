// ── the split's new pane makes its views lazily: the blocks in view first, the rest after; the click is not
// one task that mounts every block (the workbench's split was one 600 ms task for a 30-block document) ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^split-lazy$'
import { traceWork, calibrate, calibrateAfter, budget, lim, gate } from '../qa/lib/work.ts';
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1500, height: 700 });
  await page.evaluate(() => { const E = (window as any).editorAPI; E.lazyViews().resetStats(); });
  await calibrate(page);
  const w = await traceWork(page, async () => {
    await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    await page.waitForFunction(() => [...document.querySelectorAll('main.rtx-pane')].filter((m) => m.querySelector('.blk')).length > 1);
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
  });
  await calibrateAfter(page);
  const st = await page.evaluate(() => {
    const E = (window as any).editorAPI, mains = [...document.querySelectorAll('main.rtx-pane')] as HTMLElement[];
    const b = mains[mains.length - 1]!, a = mains[0]!;
    return { ...E.lazyViews().stats(), typesetA: a.querySelectorAll('.blk-render > .latex-block').length, typesetB: b.querySelectorAll('.blk-render > .latex-block').length };
  });
  check('split: the new pane defers its views of the blocks out of view, then makes them all (none left waiting)', st.deferred > 0 && st.made >= st.deferred && st.waiting === 0 && st.typesetB === st.typesetA, st);
  const press = w.event('click', 'mousedown', 'pointerdown'), long = w.long(budget(250));
  gate(check, `split: the press's work ${Math.round(press)} ms of CPU (<= ${lim(150)}); no task over ${lim(250)}`, press <= budget(150) && !long.length, { press: Math.round(press), long: long.map((t) => Math.round(t.cpu)) });
  await ctx.close();
}
