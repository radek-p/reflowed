// ── a change of one block's source shows that block again, not the document ──
// Every source change (a replace, setSource, an editor closing) displayed every block of the document; seven loops did
// it, each with its own skip. Now one traversal (blocks.redisplay) takes the blocks the change names and those whose
// view shows another key than they would now (blocks.stale: a context moved). A paragraph edited in a document of
// many: a few displays, not one per block.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^redisplay-narrow$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  await idle(page);
  const r = await page.evaluate(async () => {
    const E = (window as any).editorAPI;
    const blocks = E.blocks();
    const p = blocks.find((b: any) => b.kind === 'paragraph' && b.source.length > 60 && !/\\(label|newcommand|def)\b/.test(b.source));
    const d0 = E.counters().displays ?? 0;
    E.setSource(p.id, `${p.source} Added.`);
    await E.whenIdle();
    const shown = (document.querySelector(`main.rtx-pane .blk[data-id="${p.id}"]`) as HTMLElement | null)?.textContent?.includes('Added') ?? false;
    return { n: blocks.length, displays: (E.counters().displays ?? 0) - d0, shown };
  });
  check('redisplay-narrow: one paragraph\'s new source shows it again (typeset), with a few displays, not one per block',
    r.n > 10 && r.shown && r.displays >= 1 && r.displays < r.n / 2, r);
  await ctx.close();
}
