// ── status during a compile: the full bar for every block again, the band for an edit ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^status$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { results, check, open, idle } = h;
  const { ctx, page } = await open();
  const seen = await page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench(), doc = E.route().id;
    const bars = new Set<string>();
    const off = wb.docStatus.subscribe((m: any) => { const s = m.get(doc); if (s?.typesetting) bars.add(`${s.progress?.bar}`); });
    // the preamble changed: every block typesets again (a full render; Recompile all finds the cached results)
    E.setPreamble(`${E.currentDoc().preamble.source}\n% changed`);
    await E.whenIdle();
    const full = [...bars]; bars.clear();
    const pill = document.querySelector('.wb-tab--status, .wb-status');
    // Typeset every block again with every result cached: no run; it leaves no full bar behind for the next edit
    E.recompileAll();
    await E.whenIdle();
    const b = E.blocks().find((x: any) => x.kind === 'paragraph');
    E.setSource(b.id, `${b.source} More.`);
    await E.whenIdle();
    off();
    return { full, band: [...bars], end: wb.getDocStatus(doc), pill: !!pill };
  });
  check('status: the preamble changed (every block again) shows the full bar while it runs', seen.full.length === 1 && seen.full[0] === 'full', seen);
  check('status: an edit\'s re-render of a block shows the band (after a Recompile all that found everything cached, too)', seen.band.length === 1 && seen.band[0] === 'band', seen);
  check('status: done, the document is idle again (no error, saved)', !seen.end.typesetting && !seen.end.errors && !seen.end.unsaved, seen.end);
  await ctx.close();
}
