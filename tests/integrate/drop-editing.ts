// ── a block deleted while it is edited leaves nothing of the session behind ──
// Leaving an editor, its close motion and dropping it (the block deleted, the document closed) each took the session
// off its surface with their own copy of the list; drop's was short (its frame, the source shown, the stale mark). One
// pair now (quiet, strip). Deleted while edited: no surface is marked editing, the block's next neighbour edits and
// leaves as usual, and the page reports no error.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^drop-editing$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await idle(page);
  const [a, b] = await page.evaluate(() => (window as any).editorAPI.blocks().filter((x: any) => x.kind === 'paragraph').slice(0, 2).map((x: any) => x.id));
  await page.evaluate((i: string) => (window as any).editorAPI.edit(i, 0), a);
  await page.waitForSelector('.blk.editing .cm-editor');
  await page.evaluate((i: string) => (window as any).editorAPI.remove(i), a);
  await idle(page);
  const after = await page.evaluate((i: string) => ({ editing: document.querySelectorAll('.blk.editing, .rtx-float').length, gone: !(window as any).editorAPI.blocks().some((x: any) => x.id === i) }), a);
  await page.evaluate((i: string) => (window as any).editorAPI.edit(i, 0), b);
  await page.waitForSelector('.blk.editing .cm-editor');
  await page.evaluate(() => (window as any).editorAPI.leave());
  await page.waitForFunction(() => !document.querySelector('.blk.editing'));
  await idle(page);
  check('drop-editing: a block deleted while edited leaves no editing surface; the next one edits and leaves; no page error',
    after.gone && after.editing === 0 && errors.length === 0, { ...after, errors });
  await ctx.close();
}
