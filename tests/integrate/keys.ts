// ── keys: Ctrl/⌘B bold in a LaTeX field, the sidebar elsewhere ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^keys$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const id = await page.evaluate(async () => {
    const E = (window as any).editorAPI;
    const b = E.blocks().find((x: any) => x.kind === 'paragraph' && x.source.length > 20);
    E.edit(b.id, 0);
    await E.whenIdle();
    const v = E.editorView(E.caret().pane);
    v.focus();
    v.dispatch({ selection: { anchor: 0, head: 4 } });
    return b.id;
  });
  const side0 = await page.evaluate(() => (window as any).editorAPI.workbench().sides.peek().left.collapsed);
  await page.keyboard.press(`${mod}+b`);
  const inField = await page.evaluate((bid: string) => { const E = (window as any).editorAPI; return { text: E.editorView(E.caret().pane).state.doc.toString().slice(0, 20), side: E.workbench().sides.peek().left.collapsed, bid }; }, id);
  check('keys: Ctrl/⌘B in a block\'s source wraps the selection in \\textbf{…}', inField.text.startsWith('\\textbf{'), inField);
  check('keys: … and the sidebar stays as it was', inField.side === side0, { side0, inField });
  await page.evaluate(async () => { const E = (window as any).editorAPI; E.leave(); await E.whenIdle(); (document.activeElement as HTMLElement | null)?.blur(); });
  await page.keyboard.press(`${mod}+b`);
  await idle(page);
  const outside = await page.evaluate(() => (window as any).editorAPI.workbench().sides.peek().left.collapsed);
  check('keys: Ctrl/⌘B outside a field shows or hides the left sidebar', outside === !side0, { side0, outside });
  // the preamble's editor (the Settings panel's document tab) with a block still open: Ctrl/⌘B there bolds nothing in
  // the block (only the source with the focus)
  const bid = await page.evaluate(async () => { const E = (window as any).editorAPI; const b = E.blocks().find((x: any) => x.kind === 'paragraph' && x.source.length > 20); E.edit(b.id, 0); await E.whenIdle(); return b.id; });
  const src0 = await page.evaluate((i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i).source, bid);
  await page.evaluate(() => (window as any).editorAPI.commands().call('doc.settings', {}));
  await page.waitForFunction(() => !!document.activeElement?.closest('[data-panel-view="app-settings"] .rtx-set-editor'));
  await page.keyboard.press(`${mod}+b`);
  const pre = await page.evaluate(() => (document.querySelector('[data-panel-view="app-settings"] .rtx-set-editor .cm-content') as HTMLElement).innerText);
  await page.evaluate(async () => { const E = (window as any).editorAPI; E.leave(); await E.whenIdle(); });
  const src1 = await page.evaluate((i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i).source, bid);
  check('keys: Ctrl/⌘B in the preamble (the Settings panel) leaves the open block alone and types nothing there', src1 === src0 && !pre.includes('\\textbf'), { src0: src0.slice(0, 30), src1: src1.slice(0, 30) });
  // an overlay keeps its keys: in a modal dialog (Versions) the workbench's keys do nothing; Escape closes it
  await page.evaluate(async () => { const E = (window as any).editorAPI; E.commands().call('doc.versions', {}); await E.whenIdle(); });
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => ((document.querySelector('dialog[open]') as HTMLElement).querySelector('button, input, [tabindex]') as HTMLElement | null)?.focus());
  const sideIn = await page.evaluate(() => (window as any).editorAPI.workbench().sides.peek().left.collapsed);
  await page.keyboard.press(`${mod}+b`);
  const sideAfter = await page.evaluate(() => (window as any).editorAPI.workbench().sides.peek().left.collapsed);
  check('keys: in a modal dialog (Versions) Ctrl/⌘B leaves the sidebar alone', sideIn === sideAfter, { sideIn, sideAfter });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  check('keys: Escape closes the dialog', true);
  await ctx.close();
}
