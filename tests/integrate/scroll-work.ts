// ── scrolling does no whole-document work ──
// The pane bar's section in view asked for the outline on every scroll frame, and the outline was made again from
// every block's source each time (10 ms at 600 blocks). Now memoised: 30 frames of scrolling make it 0 times; a
// heading edited is in the outline at once.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^scroll-work$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, section, open } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  const r = await page.evaluate(async () => {
    const E = (window as any).editorAPI, main = document.querySelector('main.rtx-pane') as HTMLElement;
    E.outline();
    const before = E.outlineRuns();
    for (let k = 0; k < 30; k++) { main.scrollTop += 40; await new Promise((res) => requestAnimationFrame(res)); }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const during = E.outlineRuns() - before;
    const head = E.blocks().find((b: any) => /\\section\{/.test(b.source));
    E.setSource(head.id, head.source.replace(/\\section\{[^}]*\}/, '\\section{Renamed while scrolling}'));
    await E.whenIdle();
    return { during, renamed: E.outline().some((i: any) => i.title === 'Renamed while scrolling') };
  });
  check('scroll-work: 30 frames of scrolling make the outline 0 times; an edited heading is in it at once', r.during === 0 && r.renamed, r);
  await ctx.close();
}
