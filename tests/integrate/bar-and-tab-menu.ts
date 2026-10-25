// ── the top bar and the tab's menu : no split button in the bar (a split is the tab's context menu
// or its key, which both still work); no Pin item in the tab's menu (wb.pin and its key stay); the bar's and the side
// tabs' icons are the registry's (Lucide's 24-unit grid) ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^bar-and-tab-menu$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1400, height: 800 });
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.wb-bar')!;
    const labels = [...b.querySelectorAll('button')].map((x) => x.getAttribute('aria-label') ?? x.textContent?.trim() ?? '');
    const svgs = [...document.querySelectorAll('.wb-bar svg.ui-icon, .wb-ptabs svg.ui-icon')];
    return { split: !!document.querySelector('#btn-split'), labels, menu: !!b.querySelector('#btn-main-menu'), view: !!b.querySelector('#btn-view'),
      icons: svgs.length, grid: svgs.every((s) => s.getAttribute('viewBox') === '0 0 24 24' && s.getAttribute('stroke-width') === '1.75') };
  });
  check('bar: no split button (no #btn-split, no "Split view" label); the View and the main menu buttons are there',
    !bar.split && !bar.labels.some((l: string) => /split/i.test(l)) && bar.menu && bar.view, bar);
  check('bar and side tabs: the icons are the registry\'s (24-unit grid, stroke 1.75)', bar.icons > 3 && bar.grid, bar);

  // the tab's context menu: no Pin; Split right is there and splits
  const tab = page.locator('.wb-tab[data-tab]').first();
  await tab.click({ button: 'right' });
  await page.waitForSelector('[role="menu"][aria-label="Tab actions"]');
  const items = await page.evaluate(() => [...document.querySelectorAll('[role="menu"][aria-label="Tab actions"] [role^="menuitem"]')].map((x) => x.textContent?.trim() ?? ''));
  check('tab menu: no Pin or Unpin item; Split right and Split down are there', !items.some((t: string) => /^(Un)?pin\b/i.test(t)) && items.some((t: string) => t.startsWith('Split right'))
    && items.some((t: string) => t.startsWith('Split down')), items);
  const groups = () => page.evaluate(() => document.querySelectorAll('.wb-group').length);
  const before = await groups();
  await page.locator('[role="menu"][aria-label="Tab actions"] [role^="menuitem"]', { hasText: 'Split right' }).click();
  await page.waitForFunction((n: number) => document.querySelectorAll('.wb-group').length > n, before);
  await idle(page);
  check('tab menu: Split right still splits (a second group)', (await groups()) === before + 1, { before, after: await groups() });

  // the pin itself stays: wb.pin pins (the pinned tab shows the pin icon in place of its close)
  const pinned = await page.evaluate(async () => {
    const wb = (window as any).editorAPI.workbench(), t = wb.current.peek().tab.id;
    wb.pin(t, true); await wb.idle();
    const r = { pinned: !!wb.layout.peek() && JSON.stringify(wb.layout.peek()).includes('"pinned":true') };
    wb.pin(t, false); await wb.idle();
    return r;
  });
  check('pin: wb.pin still pins a tab (only the menu item went)', pinned.pinned, pinned);
  await ctx.close();
}
