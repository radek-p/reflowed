// ── the two kits' overlays together: the editor's menus (its layer stack) and the workbench's (its own): each closes
// on Escape and on a press outside, and one never leaves the other open ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^layers$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open } = h;
  const { ctx, page } = await open();
  const editorLayers = () => page.evaluate(() => (window as any).editorAPI.layers().filter((l: any) => l.kind === 'menu' || l.kind === 'popover').length);
  const wbMenus = () => page.evaluate(() => document.querySelectorAll('.wb-menu-pop').length);
  await page.click('#btn-doc-menu');
  await page.waitForFunction(() => (window as any).editorAPI.layers().filter((l: any) => l.kind === 'menu' || l.kind === 'popover').length > 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).editorAPI.layers().filter((l: any) => l.kind === 'menu' || l.kind === 'popover').length === 0);
  check('layers: the document menu (the editor\'s kit) opens from the bar and closes on Escape', true);
  const tab = await page.evaluate(() => (window as any).editorAPI.workbench().current.peek().tab.id);
  await page.locator(`.wb-tab[data-tab="${tab}"]`).first().click({ button: 'right' });   // (the pill takes the context menu; its parts lie over its tab)
  await page.waitForFunction(() => document.querySelectorAll('.wb-menu-pop').length > 0);
  const both = { editor: await editorLayers(), wb: await wbMenus() };
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelectorAll('.wb-menu-pop').length === 0);
  check('layers: the tab menu (the workbench\'s kit) opens alone and closes on Escape', both.wb === 1 && both.editor === 0, both);
  // the editor's menu open, a press on the workbench's tab strip: the menu closes (a press outside it)
  await page.click('#btn-doc-menu');
  await page.waitForFunction(() => (window as any).editorAPI.layers().filter((l: any) => l.kind === 'menu' || l.kind === 'popover').length > 0);
  await page.mouse.click(400, 600);
  await page.waitForFunction(() => (window as any).editorAPI.layers().filter((l: any) => l.kind === 'menu' || l.kind === 'popover').length === 0);
  check('layers: a press in the document closes the document menu', (await editorLayers()) === 0 && (await wbMenus()) === 0);
  await ctx.close();
}
