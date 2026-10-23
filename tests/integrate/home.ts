// ── home: the editor's own Documents view in the group's home panel ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^home$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, docTabs, makeDoc } = h;
  const { ctx, page } = await open();
  const second = await makeDoc(page, 'From home');
  const before = await docTabs(page);
  const [tab] = Object.keys(before);
  await page.evaluate(() => (window as any).editorAPI.workbench().toggleHome(undefined, true));
  await page.waitForSelector(`.wb-home .rh-row[data-doc-id="${second}"]`);
  const home = await page.evaluate(() => ({ editorHome: !!document.querySelector('.wb-home .rtx-wb-home .rh-row'), mock: !!document.querySelector('.demo-home') }));
  check('home: the group\'s home panel shows the editor\'s Documents view (not the demo\'s)', home.editorHome && !home.mock, home);
  await page.click(`.wb-home .rh-row[data-doc-id="${second}"]`);
  await idle(page);
  const after = await docTabs(page);
  check('home: opening a document from home replaces the active tab (the same tab, the new document)', Object.keys(after).length === 1 && after[tab!] === second, { before, after });
  const homeGone = await page.evaluate(() => !document.querySelector('.wb-home .rtx-wb-home'));
  check('home: the home panel closes once a document opens', homeGone);
  // "Open in a new tab": the row menu's action
  await page.evaluate(() => (window as any).editorAPI.workbench().toggleHome(undefined, true));
  const firstId = Object.values(before)[0] as string;
  await page.waitForSelector(`.wb-home .rh-row[data-doc-id="${firstId}"]`);
  await page.hover(`.wb-home .rh-row[data-doc-id="${firstId}"]`);
  await page.click(`.wb-home .rh-row[data-doc-id="${firstId}"] .rh-more`);
  await page.click('[data-action="open-beside"]');
  await idle(page);
  const three = await docTabs(page);
  check('home: "Open in a new tab" opens the document in a new tab beside the active one', Object.keys(three).length === 2 && Object.values(three).includes(firstId) && Object.values(three).includes(second), three);
  // the URL: #/ shows home in the focused group (the route is home while it shows); #/doc/<a new document> opens it in
  // a new tab, and it is the current document at once (its pane focused once mounted, not the tab shown before)
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home' && !!document.querySelector('.wb-home .rtx-wb-home'));
  const third = await makeDoc(page, 'By its URL');
  await page.evaluate((id: string) => { location.hash = `#/doc/${id}`; }, third);
  await page.waitForFunction((id: string) => (window as any).editorAPI.route().id === id, third);
  await idle(page);
  const viaUrl = await page.evaluate(() => { const E = (window as any).editorAPI; return { route: E.route(), current: E.currentDoc()?.id ?? null, home: !!document.querySelector('.wb-home .rtx-wb-home') }; });
  check('home: #/ shows home (route home); #/doc/<new> opens it in a new tab, the current document at once, home gone', viaUrl.current === third && viaUrl.route.name === 'doc' && !viaUrl.home, viaUrl);
  await ctx.close();
}
