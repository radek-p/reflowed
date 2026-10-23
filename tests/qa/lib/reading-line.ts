// The line a reader reads at the top of a pane, as the tests measure it: the first typeset line whose
// baseline is below the pane's reading top (its top plus scroll-padding-top), known by one of its glyph nodes, so the
// same text is found again after a re-break at any width (the viewer's inspect.replay; no DOM of its own).
//   await installReadingLine(page)
//   in the page: __readingLine.mark(pane) -> y | null    the line now at the top of main[data-pane=pane], marked; its y from the pane's reading top
//                __readingLine.y(pane) -> y | null       where the marked line is now (null: its block typeset again)
export async function installReadingLine(page: { evaluate(fn: () => void): Promise<unknown> }): Promise<void> {
  await page.evaluate(() => {
    type L = { nodes: unknown[]; y: number };
    const W = window as unknown as Record<string, any>;
    const ins = () => W.reflowtex.inspect;
    const lines = (lb: HTMLElement): L[] => {
      const out: L[] = [], st = ins().state(lb), n = st?.cache?.layout?.laid?.length ?? 0;
      for (let i = 0; i < n; i++) {
        const M = st.cache.dom?.segs?.[i]?.svg?.getScreenCTM();
        if (M) ins().replay(lb, i, { line: (_j: number, line: { nodes: unknown[] }, _x: number, by: number) => out.push({ nodes: line.nodes, y: M.d * by + M.f }) });
      }
      return out;
    };
    const paneEl = (p: string) => document.querySelector<HTMLElement>(`main[data-pane="${p}"]`);
    const top = (m: HTMLElement) => m.getBoundingClientRect().top + (parseFloat(getComputedStyle(m).scrollPaddingTop) || 0);
    const marks = new Map<string, { lb: HTMLElement; node: unknown }>();
    W.__readingLine = {
      mark(p: string): number | null {
        const m = paneEl(p);
        if (!m) return null;
        const t = top(m);
        for (const lb of m.querySelectorAll<HTMLElement>('.blk-render > .latex-block:not(.incoming):not(.rtx-w-ghost)')) {
          if (lb.getBoundingClientRect().bottom <= t) continue;
          const l = lines(lb).find((q) => q.y > t), node = l?.nodes.find((x) => (x as { type: string }).type === 'glyph');
          if (l && node) { marks.set(p, { lb, node }); return Math.round((l.y - t) * 10) / 10; }
        }
        return null;
      },
      y(p: string): number | null {
        const m = paneEl(p), k = marks.get(p);
        if (!m || !k || !k.lb.isConnected) return null;
        const l = lines(k.lb).find((q) => q.nodes.includes(k.node));
        return l ? Math.round((l.y - top(m)) * 10) / 10 : null;
      },
    };
  });
}
