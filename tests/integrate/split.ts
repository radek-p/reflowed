// ── split: the same document in a new group, one session, two panes, kept equal ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^split$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, state, docTabs } = h;
  const { ctx, page } = await open();
  // every document pane labels its blocks the same way: none is announced as a second pane (each pane is a tab)
  const labels = () => page.evaluate(() => [...document.querySelectorAll('main[data-pane] .blocks')].map((el) => el.getAttribute('aria-label')));
  const one = await labels();
  check("split: the one pane's blocks are labelled Blocks", one.length === 1 && one[0] === 'Blocks', one);
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await idle(page);
  const s = await state(page);
  const docs = await docTabs(page);
  const ids = Object.keys(docs);
  const two = await labels();
  check("split: both panes' blocks are labelled Blocks", two.length === 2 && two.every((l) => l === 'Blocks'), two);
  check('split: two groups, two tabs of the document, one session whose panes are both', s.groups === 2 && ids.length === 2 && Object.keys(s.sessions).length === 1 && (Object.values(s.sessions)[0] as string[]).length === 2, { s, docs });
  const same = await page.evaluate(([a, b]: string[]) => {
    const E = (window as any).editorAPI;
    return E.tabs().editorOf(a) === E.tabs().editorOf(b);
  }, ids);
  check('split: one document editor for both tabs (one DocSession, one history: F1)', same);
  // an edit in one pane shows in the other
  const shown = await page.evaluate(async ([a, b]: string[]) => {
    const E = (window as any).editorAPI, ed = E.tabs().editorOf(a);
    const blk = ed.api.blocks().find((x: any) => x.kind === 'paragraph');
    ed.api.setSource(blk.id, 'Changed in one pane: $y^2$.');
    await E.whenIdle();
    const text = (p: string) => (document.querySelector(`main[data-pane="${p}"] .blk[data-id="${blk.id}"] .blk-render:not([hidden]) .latex-block:not(.incoming)`) as HTMLElement | null)?.textContent ?? '';
    return { a: text(a), b: text(b) };
  }, ids);
  check('split: an edit made through one tab shows in both panes', /Changed in one pane/.test(shown.a.replace(/\s+/g, ' ')) || shown.a === shown.b, shown);
  check('split: the two panes show the same block the same way', shown.a === shown.b && shown.a.length > 0, shown);
  // closing one tab keeps the session (the other pane still shows it)
  await page.evaluate((b: string) => (window as any).editorAPI.workbench().close(b), ids[1]);
  await idle(page);
  const after = await state(page);
  check('split: closing one tab leaves the session with the other pane', Object.keys(after.sessions).length === 1 && (Object.values(after.sessions)[0] as string[]).length === 1, after);
  await ctx.close();
}
