// ── typing does no whole-document refresh ──
// The refresh (the numbering and every mounted view's slots, the panels: outline, problems, TODOs, the word count, find)
// ran every 250 ms while typing and at once on each live preview. Now it waits until input is quiet: none while 24
// characters are typed at a steady pace; then one, and the word count has the new words.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^type-quiet$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  const id = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => b.kind === 'paragraph' && b.source.length > 80).id);
  await page.evaluate((i: string) => (window as any).editorAPI.edit(i, 0), id);
  await page.waitForSelector('.blk.editing .cm-editor');
  await idle(page);
  const words0 = await page.evaluate(() => (window as any).editorAPI.wordCount().words);
  const r0 = await page.evaluate(() => (window as any).__rtxPerf.stats().refreshes ?? 0);
  await page.keyboard.type('alpha beta gamma delta ', { delay: 60 });
  const during = (await page.evaluate(() => (window as any).__rtxPerf.stats().refreshes ?? 0)) - r0;
  await idle(page);
  const after = await page.evaluate((r: number) => ({ refreshes: ((window as any).__rtxPerf.stats().refreshes ?? 0) - r, words: (window as any).editorAPI.wordCount().words }), r0);
  check('type-quiet: no whole-document refresh while 24 characters are typed; one after, with the new words counted',
    during === 0 && after.refreshes >= 1 && after.words === words0 + 4, { during, ...after, words0 });
  await ctx.close();
}
