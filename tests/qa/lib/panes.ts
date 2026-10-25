// The panes of the standalone page (the editor on the workbench), for the suites that work in one or two panes.
// A pane is a document tab's <main class="rtx-pane" data-pane="<tab id>">, and it is the scroller (the window never
// scrolls). The focused pane is the container's [data-part="page"].
//
//   FOCUSED                          the focused pane's selector ([data-part="page"])
//   await paneA(page)                pane A: the first document tab's pane (its selector)
//   await splitB(page)               the window bar's split (a second group, the same document): pane B's selector,
//                                    once its blocks are typeset
//   await closePane(page, sel)       closes that pane (its tab)
//   idOf(sel)                        a pane's tab id, from its selector
export const FOCUSED = '[data-part="page"]';
export const paneSel = (id: string) => `main.rtx-pane[data-pane="${id}"]`;
/** a pane's tab id, from its selector */
export const idOf = (sel: string) => /data-pane="([^"]+)"/.exec(sel)![1]!;

/** the document panes in the layout's order (tab ids) */
export const paneIds = (page: any): Promise<string[]> => page.evaluate(() => {
  const all: string[] = [];
  const walk = (n: any) => { if (n.kind === 'split') n.children.forEach(walk); else for (const t of n.tabs) if (t.view === 'document') all.push(t.id); };
  walk((window as any).editorAPI.workbench().layout.peek().root);
  return all.filter((id) => !!document.querySelector(`main.rtx-pane[data-pane="${id}"]`));
});

export async function paneA(page: any): Promise<string> {
  await page.waitForFunction(() => !!document.querySelector('main.rtx-pane'));
  return paneSel((await paneIds(page))[0]!);
}

/** the split button: pane B (a new group beside, the same document); its selector once typeset */
export async function splitB(page: any): Promise<string> {
  const before = await paneIds(page);
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await page.waitForFunction((b: string[]) => Object.keys((window as any).editorAPI.editors()).some((p) => !b.includes(p)), before);
  const id = (await paneIds(page)).find((x) => !before.includes(x))!;
  // (a condition, not waitForSelector: an element handle would keep the pane's view alive, as a page's console would)
  await page.waitForFunction((s: string) => !!document.querySelector(`${s} .blocks > .blk .blk-render > .latex-block`), paneSel(id));
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  return paneSel(id);
}

/** closes the pane `sel` (its tab) */
export async function closePane(page: any, sel: string) {
  const id = idOf(sel);
  await page.evaluate((t: string) => (window as any).editorAPI.workbench().close(t), id);
  await page.waitForFunction((t: string) => !(window as any).editorAPI.editors()[t], id);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
}

/** (tests that name the panes by place) marks the document panes in the layout's order: data-test-pane="a", "b", …;
 *  their tab ids returned. A test-only attribute: the old page's #page / #page-b, by place */
export async function markPanes(page: any): Promise<string[]> {
  const ids = await paneIds(page);
  await page.evaluate((list: string[]) => {
    for (const m of document.querySelectorAll('main.rtx-pane[data-test-pane]')) m.removeAttribute('data-test-pane');
    list.forEach((id, k) => document.querySelector(`main.rtx-pane[data-pane="${id}"]`)?.setAttribute('data-test-pane', 'abcdefgh'[k]!));
  }, ids);
  return ids;
}
