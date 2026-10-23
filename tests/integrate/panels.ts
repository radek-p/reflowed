// ── the side panels: docked as the workbench's, movable; content drawn with the editor's context ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^panels$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { problems, check, open } = h;
  const { ctx, page } = await open();
  const r = await page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const sides = wb.sides.peek();
    const panels = (s: any) => { const out: string[] = []; const walk = (n: any) => { if (n.kind === 'split') n.children.forEach(walk); else out.push(...n.panels); }; walk(s.root); return out; };
    const left = panels(sides.left), right = panels(sides.right);
    wb.movePanel('problems', 'right');
    wb.collapseSide('right', false);
    wb.showPanel('problems');
    await E.whenIdle();
    const host = document.querySelector('[data-side="right"] [data-panel-view="problems"]');
    return { left, right, moved: panels(wb.sides.peek().right), drawn: !!host && host.childElementCount > 0, oldSidebar: !!document.querySelector('aside.sidebar') };
  });
  check('panels: Outline, Problems, TODOs and References in the left column (the editor\'s sidebar\'s order), the workbench\'s side panels', JSON.stringify(r.left) === JSON.stringify(['outline', 'problems', 'todos', 'references']) && r.right.length === 0, r);
  check('panels: the editor\'s own sidebar is gone', !r.oldSidebar, r);
  check('panels: Problems moved to the right column is drawn there', r.moved.includes('problems') && r.drawn, r);
  await ctx.close();
}
