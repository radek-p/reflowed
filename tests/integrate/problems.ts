// ── a block's problems are its latest compile's, whatever made it compile (a release): a \qty with no
// siunitx fails; the package added to the preamble clears the problem everywhere (the status, the Problems tab's count,
// the diagnostics, the tab's error tint); taken out again, the problem comes back ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^problems$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { problems, check, open } = h;
  const { ctx, page } = await open();
  const shown = () => page.evaluate(() => {
    const E = (window as any).editorAPI, wb = E.workbench(), doc = E.route().id;
    const ptab = document.querySelector('[data-ptab="problems"] .wb-ptab-badge');
    return { status: wb.getDocStatus(doc).errors, said: E.status().shown, badge: ptab ? Number(ptab.textContent) : 0,
      errors: E.diagnostics().filter((d: any) => d.kind === 'error' && d.blockId).length, tint: !!document.querySelector('.wb-status--error, .wb-tab--status .wb-status--error') };
  });
  const id = await page.evaluate(async () => {
    const E = (window as any).editorAPI;
    const at = E.blocks().findIndex((b: any) => b.kind === 'paragraph');
    const bid = E.insert(at + 1, 'paragraph', 'Gravity: \\qty{9.81}{\\metre\\per\\second\\squared}.');
    await E.whenIdle();
    return bid;
  });
  const a = await shown();
  check('problems: a \\qty with no siunitx fails: one error in the status, the Problems count, the diagnostics, the tab\'s tint', a.status === 1 && a.badge >= 1 && a.errors === 1 && a.tint, a);
  const pre = await page.evaluate(async () => {
    const E = (window as any).editorAPI, pre = E.currentDoc().preamble.source;
    E.setPreamble(`${pre}\n\\usepackage{siunitx}`);
    await E.whenIdle();
    return pre;
  });
  const b = await shown();
  const ok = await page.evaluate((bid: string) => (window as any).editorAPI.blocks().find((x: any) => x.id === bid), id);
  check('problems: siunitx added to the preamble: the block typesets', ok.state === 'ok' && ok.errors.length === 0, ok);
  check('problems: … and its problem is gone everywhere (status, Problems count, diagnostics, tint, the status text)', b.status === 0 && b.badge === 0 && b.errors === 0 && !b.tint && !/error/i.test(b.said?.text ?? ''), b);
  await page.evaluate(async (p: string) => { const E = (window as any).editorAPI; E.setPreamble(p); await E.whenIdle(); }, pre);
  const c = await shown();
  check('problems: the package taken out again: the problem is back everywhere', c.status === 1 && c.badge >= 1 && c.errors === 1, c);
  await ctx.close();
}
