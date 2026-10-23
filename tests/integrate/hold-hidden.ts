// ── a width hold pins the tabs shown, not those kept alive behind them ──
// Every pane of the page was pinned by a hold (a column sliding, a splitter dragged), hidden tabs included: with four
// 60-block tabs the hold cost 38 ms for 244 blocks. Now only the shown pane's blocks are pinned. A tab hidden while the
// width changed is laid out at the new width when it is shown again (the viewer's own observer).
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^hold-hidden$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { article } = await import('../qa/probe-responsiveness.ts');
  const { ctx, page } = await open('#/', { width: 1440 });
  const ids: string[] = [];
  for (let k = 0; k < 3; k++) ids.push(await page.evaluate(async (tex: string) => { const E = (window as any).editorAPI; return E.store().createDoc(await E.io().importFile({ name: `t${tex.length}.tex`, bytes: new TextEncoder().encode(tex) })); }, article(30 + k)));
  for (const id of ids) { await page.evaluate((d: string) => (window as any).editorAPI.open(d), id); await page.waitForFunction(() => document.querySelectorAll('main.rtx-pane .blk').length > 10); await idle(page); }
  const r = await page.evaluate(async () => {
    const E = (window as any).editorAPI, W = E.tabs().widths;
    const mains = [...document.querySelectorAll('main.rtx-pane')] as HTMLElement[];
    const shown = mains.filter((m) => !m.closest('.wb-panel--hidden'));
    W.resetStats(); W.hold();
    const pinned = W.stats().pins.reduce((a: number, p: any) => a + p.n, 0);
    await W.release(); await W.idle();
    return { tabs: mains.length, shown: shown.length, pinned, shownBlocks: shown.reduce((a, m) => a + m.querySelectorAll('.blk-render > .latex-block').length, 0) };
  });
  check('hold-hidden: a hold pins the blocks of the tab shown only, not the tabs kept alive behind it', r.tabs >= 3 && r.shown === 1 && r.pinned > 0 && r.pinned <= r.shownBlocks, r);
  // the width changes while a tab is hidden (the left column shut); shown again, its blocks fit their column
  await page.evaluate(() => (window as any).editorAPI.workbench().run('toggleSide', 'left'));
  await page.evaluate(async () => { const E = (window as any).editorAPI; await E.whenIdle(); await E.tabs().widths.idle(); });
  const back = await page.evaluate(async (first: string) => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const all: any[] = []; const walk = (n: any) => { if (n.kind === 'split') n.children.forEach(walk); else all.push(...n.tabs); };
    walk(wb.layout.peek().root);
    const t = all.find((x) => x.state?.doc === first);
    wb.activate(t.id);
    await E.whenIdle(); await E.tabs().widths.idle();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const m = [...document.querySelectorAll('main.rtx-pane')].find((x) => !x.closest('.wb-panel--hidden')) as HTMLElement;
    const over = [...m.querySelectorAll('.blk-render > .latex-block')].filter((el) => { const r = el.getBoundingClientRect(), c = (el.parentElement as HTMLElement).getBoundingClientRect(); return r.width > c.width + 1; }).length;
    return { over, blocks: m.querySelectorAll('.blk-render > .latex-block').length };
  }, ids[0]);
  check('hold-hidden: a tab hidden while the width changed fits its column when shown again', back.blocks > 0 && back.over === 0, back);
  await ctx.close();
}
