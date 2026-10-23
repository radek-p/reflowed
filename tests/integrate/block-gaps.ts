// ── the gaps between blocks as drawn: for each two neighbouring blocks with the engine's
// spacing data, the distance from the one's render bottom (its last line's depth) to the other's render top (its first
// line's height) is engine/web/spacing.ts gapBetween's total at the blocks' scale (the viewer's 2 px/pt times their
// zoom), within 0.5 px. engine-node's spacing check holds gapBetween to TeX's own gaps; this holds the page to it (the
// gaps were drawn at 96/72.27 px/pt, two thirds of their size, and the blocks' padding was taken as 8 px, not 10).
// Also at a larger text size (the zoom changes, the gaps follow it).
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^block-gaps$'
import { gapBetween } from '../../engine/web/spacing.ts';
import type { Harness } from './harness.ts';

const PX_PER_PT = 2;   // app/src/view/settings.js: the viewer's 1 pt = 2 CSS px at zoom 1

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1500 });
  const measure = () => page.evaluate(() => {
    const E = (window as any).editorAPI;
    const pane = document.querySelector('main.rtx-pane')!;
    return E.blocks().filter((b: any) => !b.container).map((b: any) => {
      const el = pane.querySelector(`.blk[data-id="${b.id}"]`) as HTMLElement | null;
      const lb = el?.querySelector('.blk-render > .latex-block') as HTMLElement | null;
      const r = lb?.getBoundingClientRect();
      return { id: b.id, source: b.source.slice(0, 30), tex: el?.dataset.tex === '1', top: r?.top ?? null, bottom: r?.bottom ?? null,
        zoom: lb ? Number(getComputedStyle(lb).zoom) || 1 : 1, spacing: b.spacing };
    });
  });
  for (const step of [0, 1]) {
    if (step) { await page.evaluate(() => (window as any).editorAPI.view().zoomBy(1)); await idle(page); }
    const m = await measure();
    const rows: string[] = [];
    let compared = 0, bad = 0;
    for (let i = 1; i < m.length; i++) {
      const a = m[i - 1], b = m[i];
      if (!b.tex || !a.spacing || !b.spacing || a.bottom == null || b.top == null) continue;
      const want = gapBetween(a.spacing, b.spacing)!.totalPt * PX_PER_PT * b.zoom;
      const got = b.top - a.bottom;
      compared++;
      if (Math.abs(got - want) > 0.5) { bad++; rows.push(`${JSON.stringify(a.source)} → ${JSON.stringify(b.source)}: drawn ${got.toFixed(2)} px, TeX ${want.toFixed(2)} px`); }
    }
    const z = m.find((x: any) => x.tex)?.zoom ?? 1;
    check(`block-gaps (zoom ${z.toFixed(2)}): ${compared - bad}/${compared} gaps between blocks drawn at TeX's size within 0.5 px`, compared >= 6 && bad === 0, rows.join('; '));
  }
  await ctx.close();
}
