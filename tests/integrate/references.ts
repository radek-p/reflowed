// ── References (an empty panel): a mount view gets the current document: its entries listed when it is
// shown first, after a reload (the panel shown before the document opened), after a switch to another document and
// back; Cite from it inserts at the caret ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^references$'
import { openBiblatexDoc } from '../qa/fixtures/biblatex-doc.ts';
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { BASE, browser, check, idle, makeDoc } = h;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();   // (the tests' biblatex document: a .bbl the pane lists)
  page.setDefaultTimeout(240000);
  await page.goto(`${BASE}?engine&fresh#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.workbench);
  await openBiblatexDoc(page);
  await idle(page);
  const rows = () => page.evaluate(() => document.querySelectorAll('[data-panel-view="references"] li.bp-row').length);
  const want = await page.evaluate(() => Object.keys((window as any).editorAPI.refsState().bib ?? {}).length);
  await page.evaluate(async () => { const E = (window as any).editorAPI; E.workbench().showPanel('references'); await E.whenIdle(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-view="references"] li.bp-row').length > 0);
  const r1 = await rows();
  await page.goto(`${BASE}?engine#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.workbench);
  await idle(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-view="references"] li.bp-row').length > 0, null, { timeout: 30000 }).catch(() => {});
  const r2 = await rows();
  const other = await makeDoc(page, 'No bibliography');
  const back = await page.evaluate(() => (window as any).editorAPI.workbench().current.peek().tab.id);
  await page.evaluate((id: string) => { location.hash = `#/doc/${id}`; }, other);
  await page.waitForFunction((id: string) => (window as any).editorAPI.currentDoc()?.id === id, other);
  await idle(page);
  const r3 = await rows();
  await page.evaluate((t: string) => { const E = (window as any).editorAPI; E.workbench().activate(t); E.tabs().focus(t); }, back);
  await idle(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-view="references"] li.bp-row').length > 0, null, { timeout: 30000 }).catch(() => {});
  const r4 = await rows();
  check('references: the entries listed when shown, after a reload, none for a document without them, again after the switch back', r1 > 0 && r1 === want && r2 === r1 && r3 === 0 && r4 === r1, { want, r1, r2, r3, r4 });
  // Cite at the caret
  const target = await page.evaluate(() => { const E = (window as any).editorAPI, b = E.blocks().find((x: any) => x.kind === 'paragraph' && x.source.length > 30); E.editIn(E.tabs().current.peek().pane, b.id, 0); return b.id; });
  await page.waitForFunction(() => !!document.querySelector('.blk.editing .cm-content'));
  const key = await page.evaluate(() => (document.querySelector('[data-panel-view="references"] li.bp-row') as HTMLElement).dataset.key);
  await page.hover('[data-panel-view="references"] li.bp-row');
  await page.click('[data-panel-view="references"] li.bp-row .bp-cite');
  await page.waitForFunction(([i, k]: string[]) => (window as any).editorAPI.blocks().find((b: any) => b.id === i).source.includes(k), [target, key], { timeout: 10000 }).catch(() => {});
  const cited = await page.evaluate(([i, k]: string[]) => (window as any).editorAPI.blocks().find((b: any) => b.id === i).source.includes(`{${k}}`), [target, key]);
  check('references: Cite puts the key at the caret', cited, { key });
  await ctx.close();
}
