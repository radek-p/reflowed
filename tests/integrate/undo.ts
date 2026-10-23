// ── undo across tabs: one history per document; the change revealed where ⌘Z is pressed ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^undo$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, state, docTabs, makeDoc } = h;
  const { ctx, page } = await open();
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await idle(page);
  const ids = Object.keys(await docTabs(page));
  const r = await page.evaluate(async ([a, b]: string[]) => {
    const E = (window as any).editorAPI, T = E.tabs(), wb = E.workbench();
    const ed = T.editorOf(a);
    const blocks = ed.api.blocks().filter((x: any) => x.kind === 'paragraph');
    const blk = blocks[blocks.length - 1];
    const before = blk.source;
    wb.activate(a); T.focus(a);
    ed.api.setSource(blk.id, 'Made in the first tab.');
    await E.whenIdle();
    // both tabs scrolled to the top, the other one focused: ⌘Z there undoes the first tab's change, and reveals it in the
    // tab it was made in (undo returns to the view that made the change)
    const pa = document.querySelector(`main[data-pane="${a}"]`) as HTMLElement;
    wb.activate(b); T.focus(b);
    const pb = document.querySelector(`main[data-pane="${b}"]`) as HTMLElement;
    pa.scrollTop = 0; pb.scrollTop = 0;
    await E.whenIdle();
    const undone = E.undo();
    await E.whenIdle();
    const now = ed.api.blocks().find((x: any) => x.id === blk.id).source;
    const el = pa.querySelector(`.blk[data-id="${blk.id}"]`) as HTMLElement;
    const box = pa.getBoundingClientRect(), r = el.getBoundingClientRect();
    const redone = E.redo();
    await E.whenIdle();
    const again = ed.api.blocks().find((x: any) => x.id === blk.id).source;
    return { undone: !!undone, back: now === before, inView: r.bottom > box.top && r.top < box.bottom, otherStayed: pb.scrollTop === 0, again, focused: E.route() };
  }, ids);
  check('undo: ⌘Z in the second tab undoes the change made in the first (one history per document)', r.undone && r.back, r);
  check('undo: the undone change is revealed in the tab it was made in (scrolled into view there), not in the tab worked in', r.inView && r.otherStayed, r);
  check('undo: redo makes it again', r.again === 'Made in the first tab.', r);
  // the tab it was made in behind another tab of its group: the change is shown in the focused tab (the fallback)
  const other = await makeDoc(page, 'In front', 3);
  const f = await page.evaluate(async ([a, b, d]: string[]) => {
    const E = (window as any).editorAPI, T = E.tabs(), wb = E.workbench();
    const ed = T.editorOf(a), blk = ed.api.blocks().filter((x: any) => x.kind === 'paragraph').at(-1);
    wb.activate(a); T.focus(a);
    ed.api.setSource(blk.id, 'Made in the first tab, again.');
    await E.whenIdle();
    const g = wb.layout.peek(); let ga = ''; const w = (n: any) => { if (n.kind === 'split') n.children.forEach(w); else if (n.tabs.some((t: any) => t.id === a)) ga = n.id; }; w(g.root);
    wb.open({ view: 'document', state: { doc: d } }, { group: ga });
    await E.whenIdle();
    wb.activate(b); T.focus(b);
    const pb = document.querySelector(`main[data-pane="${b}"]`) as HTMLElement;
    pb.scrollTop = 0;
    await E.whenIdle();
    const undone = E.undo();
    await E.whenIdle();
    const el = pb.querySelector(`.blk[data-id="${blk.id}"]`) as HTMLElement, r = el.getBoundingClientRect(), box = pb.getBoundingClientRect();
    const hidden = !!document.querySelector(`main[data-pane="${a}"]`)?.closest('.wb-panel--hidden');
    return { undone: !!undone, hidden, inView: r.bottom > box.top && r.top < box.bottom };
  }, [...ids, other]);
  check('undo: the tab it was made in hidden behind another: the change is revealed in the focused tab', f.undone && f.hidden && f.inView, f);
  await ctx.close();
}
