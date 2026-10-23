// ── an undo outside an editor reaches the blocks after it ──
// A text step undone with no editor open set the block's source and displayed that block only: the contexts were not
// made again, so after undoing an edit of a \newcommand the blocks using it kept compiling against the undone
// definition. Every source change now ends in one sourcesChanged (app.js): the contexts, then the blocks that show
// another key than they would now.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^undo-contexts$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/', { width: 1440 });
  const ids = await page.evaluate(async () => {
    const E = (window as any).editorAPI;
    const doc = await E.store().createDoc({ title: 'Macros', preamble: '\\documentclass{article}', blocks: [
      { kind: 'paragraph', source: '\\newcommand\\foo{AAA}' }, { kind: 'paragraph', source: 'See \\foo{} here.' }] });
    await E.open(doc);
    return doc;
  });
  await page.waitForFunction(() => (window as any).editorAPI.blocks?.().length === 2);
  await idle(page);
  const [def, use] = await page.evaluate(() => (window as any).editorAPI.blocks().map((b: any) => b.id));
  const k0 = await page.evaluate((u: string) => (window as any).editorAPI.keys(u).now, use);
  // the definition edited in its editor, the editor left
  await page.evaluate((d: string) => (window as any).editorAPI.edit(d, 0), def);
  await page.waitForSelector('.blk.editing .cm-editor');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('\\newcommand\\foo{BBB}');   // one transaction: one text step
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.blk.editing'));
  await idle(page);
  const k1 = await page.evaluate((u: string) => (window as any).editorAPI.keys(u), use);
  // undone with no editor open (the undo opens the block's editor after; it is not left here: leaving would make the
  // contexts again by itself)
  await page.evaluate(() => (window as any).editorAPI.undo());
  await idle(page);
  const after = await page.evaluate(([d, u]: string[]) => { const E = (window as any).editorAPI; return { def: E.blocks().find((b: any) => b.id === d).source, keys: E.keys(u) }; }, [def, use]);
  check('undo-contexts: an edit of a definition re-keys the block using it; undone, that block is back on its first key, shown',
    k1.now !== k0 && after.def === '\\newcommand\\foo{AAA}' && after.keys.now === k0 && after.keys.shown === k0, { k0, k1, after });
  await ctx.close();
}
