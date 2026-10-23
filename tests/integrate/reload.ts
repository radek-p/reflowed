// ── reload: the layout restored (groups, tabs, documents, sides, the section read) ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^reload$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { BASE, Q, browser, check, open, idle, state, docTabs, makeDoc } = h;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, reducedMotion: 'reduce' });
  const { page } = await open('#/doc/sample', { ctx });
  const second = await makeDoc(page, 'Restored');
  await page.evaluate(async (id: string) => {
    const E = (window as any).editorAPI, wb = E.workbench();
    wb.run('splitRight'); await E.whenIdle();
    wb.open({ view: 'document', state: { doc: id } }, { focus: true }); await E.whenIdle();
    wb.collapseSide('left', true);
    const items = E.tabs().editorOf(wb.layout.peek().root.children[0].tabs[0].id).api.outline().filter((x: any) => !x.special);
    const t0 = wb.layout.peek().root.children[0].tabs[0].id;
    wb.activate(t0); E.tabs().focus(t0);
    E.commands().call('nav.scrollTo', { id: items[items.length - 1].id });
    await E.whenIdle();
  }, second);
  await idle(page);
  const was = await page.evaluate(() => { const wb = (window as any).editorAPI.workbench(); return { layout: wb.serialize() }; });
  const tabsWas = await docTabs(page);
  await page.goto(`${BASE}${Q}#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.workbench);
  await idle(page);
  const tabsNow = await docTabs(page);
  const now = await page.evaluate(() => { const E = (window as any).editorAPI, wb = E.workbench(); return { mounted: [...wb.hosts.keys()], active: wb.layout.peek().root.children?.map((g: any) => g.active), left: wb.sides.peek().left.collapsed, groups: document.querySelectorAll('.wb-group').length, sessions: Object.keys(E.docSessions()).length }; });
  check('reload: the same tabs with the same documents, in two groups', JSON.stringify(tabsNow) === JSON.stringify(tabsWas) && now.groups === 2, { tabsWas, tabsNow, now });
  // a hidden tab is mounted when first shown (keepAlive is lazy): the groups' active tabs only, their documents' sessions
  check('reload: the groups\' active tabs mounted (the others when first shown), a session for their document',
    JSON.stringify(now.mounted.sort()) === JSON.stringify([...now.active].sort()) && now.sessions === new Set(now.active.map((t: string) => (tabsNow as any)[t])).size, now);
  check('reload: the left sidebar stays hidden', now.left === true, now);
  const sameLayout = await page.evaluate((s: string) => { const a = JSON.parse(s), b = JSON.parse((window as any).editorAPI.workbench().serialize()); const strip = (x: any) => JSON.stringify(x, (k, v) => (k === 'at' || k === 'mru' ? undefined : v)); const x = strip(a), y = strip(b); if (x === y) return null; let i = 0; while (x[i] === y[i]) i++; return { at: i, was: x.slice(Math.max(0, i - 120), i + 120), now: y.slice(Math.max(0, i - 120), i + 120) }; }, was.layout);
  check('reload: the layout restored as it was (groups, sizes, tabs, sides)', !sameLayout, sameLayout);
  // a document deleted while its tab is in the saved layout (another window, a reset): its tab closes on reload (as the
  // old page went home), no empty or broken pane
  const gone = (Object.entries(tabsNow) as [string, string][]).find(([, d]) => d === second)![0];
  await page.evaluate(async (t: string) => { const E = (window as any).editorAPI, wb = E.workbench(); wb.activate(t); await E.whenIdle(); }, gone);
  await page.evaluate((id: string) => (window as any).editorAPI.store().deleteDoc(id), second);
  await page.goto('about:blank');   // (a real load: the same URL but its hash would only change the route)
  await page.goto(`${BASE}${Q}#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.workbench);
  await page.waitForFunction((t: string) => !(window as any).editorAPI.workbench().layout.peek().root.children?.some((g: any) => g.tabs.some((x: any) => x.id === t))
    && !document.querySelector(`[data-tab="${t}"]`), gone);
  await idle(page);
  const after = await docTabs(page);
  check('reload: a deleted document\'s tab closes; the others stay', !Object.values(after).includes(second) && Object.keys(after).length === Object.keys(tabsNow).length - 1, { tabsNow, after });
  await ctx.close();
}
