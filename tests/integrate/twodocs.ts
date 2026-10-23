// ── two documents side by side; the panels follow the current one ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^twodocs$'
import { join } from 'node:path';
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { OUT, check, open, idle, state, docTabs, makeDoc } = h;
  const { ctx, page } = await open();
  const second = await makeDoc(page);
  await page.evaluate(async (id: string) => { const E = (window as any).editorAPI, wb = E.workbench(); wb.run('splitRight'); await E.whenIdle(); const t = wb.current.peek().tab.id; wb.replace(t, { view: 'document', state: { doc: id } }); wb.activate(t); }, second);
  await idle(page);
  const s = await state(page);
  check('two documents: two groups, two sessions, one pane each', s.groups === 2 && Object.keys(s.sessions).length === 2 && Object.values(s.sessions).every((p: any) => p.length === 1), s);
  const outline = (p: any) => p.evaluate(() => [...document.querySelectorAll('[data-panel-view="outline"] .ol-row, [data-panel-view="outline"] [data-id]')].map((e: any) => e.textContent.trim()).filter(Boolean));
  const o2 = await outline(page);
  const ids = Object.entries(await docTabs(page));
  const first = ids.find(([, d]) => d !== second)![0];
  await page.evaluate((t: string) => { const E = (window as any).editorAPI; E.workbench().activate(t); E.tabs().focus(t); }, first);
  await idle(page);
  const o1 = await outline(page);
  check('panels: the outline shows the current document\'s headings (the second\'s: One, Two)', o2.some((x: string) => /One/.test(x)) && o2.some((x: string) => /Two/.test(x)) && o2.length < 8, o2);
  check('panels: focus the first document\'s tab: the outline follows it', JSON.stringify(o1) !== JSON.stringify(o2) && !o1.some((x: string) => /^\d*\s*One$/.test(x)), { o1, o2 });
  await page.screenshot({ path: join(OUT, 'twodocs.png') });
  await ctx.close();
}
