// ── open: a document in a tab, typeset, its crumbs and status ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^open$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, section, open, idle, state, docTabs } = h;
  const { ctx, page } = await open();
  const s = await state(page);
  const docs = await docTabs(page);
  const [tab] = Object.keys(docs);
  check('open: #/doc/sample opens one document tab, one session with that pane', Object.keys(docs).length === 1 && Object.values(s.sessions).length === 1 && (Object.values(s.sessions)[0] as string[])[0] === tab, { s, docs });
  const v = await page.evaluate((id: string) => {
    const main = document.querySelector(`main[data-pane="${id}"]`);
    const blks = [...(main?.querySelectorAll('.blocks > .blk[data-id]') ?? [])] as HTMLElement[];
    const E = (window as any).editorAPI;
    return { blocks: blks.length, shown: E.blocks().filter((b: any) => b.mounted || b.state === 'marker').length, total: E.blocks().length, states: E.blocks().filter((b: any) => !b.mounted).map((b: any) => `${b.kind}:${b.state}`), inHost: !!main?.closest('.wb-panel'),
      status: E.workbench().getDocStatus(E.route().id) };
  }, tab);
  check('open: the pane is in the tab\'s host, every block typeset', v.inHost && v.blocks > 5 && v.shown === v.total, v);
  const bar = await page.evaluate(() => [...document.querySelectorAll('.rtx-wb-bar button, #btn-main-menu')].map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.height)}:${getComputedStyle(b).borderRadius}`; }));
  check('the bar: the main menu (left) and View (right), no split button; one control metric (the workbench kit\'s height and radius)', bar.length === 2 && new Set(bar).size === 1, bar);
  check('open: idle, the document has no status (nothing typesetting, no error, saved)', !v.status.typesetting && !v.status.errors && !v.status.unsaved, v.status);
  // the crumbs: the tab names the document and the section in view
  const crumb = await page.evaluate((id: string) => {
    const E = (window as any).editorAPI, wb = E.workbench(), t = wb.layout.peek() && wb.contextOf(id);
    const type = wb.viewType('document'), tab = wb.current.peek().tab;
    const sub = type.subtitle(tab, t), sec = E.tabs().section(id).peek();
    return { title: type.title(tab.state, tab), sub: sub && { label: sub.label, kind: sub.kind }, sec: sec && { id: sec.id, number: sec.number, title: sec.title }, docTitle: E.currentDoc().title };
  }, tab);
  check('crumbs: the tab\'s title is the document\'s, its section chip the section in view', crumb.title === crumb.docTitle && !!crumb.sub && crumb.sub.label.includes(crumb.sec.title), crumb);
  // scrolled to a later section: the chip follows
  const later = await page.evaluate(async (id: string) => {
    const E = (window as any).editorAPI, items = E.outline().filter((x: any) => !x.special);
    const it = items[Math.floor(items.length / 2)];   // the middle (at the scroll's end the last one shown is named)
    E.commands().call('nav.scrollTo', { id: it.id });
    await E.whenIdle();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { want: it.title, got: E.tabs().section(id).peek()?.title ?? null };
  }, tab);
  check('crumbs: the section chip follows the scroll (a jump to a later section names it)', later.want === later.got, later);
  await ctx.close();
}
