// ── the top inset: at scroll 0 every pane's text starts below the glass over it (the bar, its group's strip), in every
// form of the bar and the strip; a reveal never lands under it; the reading point holds when the form changes ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^inset$'
import { join } from 'node:path';
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { OUT, check, open, state } = h;
  /** each visible document pane: the glass over its top (the bottom of the bar or strip above it), its first block's top
   *  at scroll 0, and (reveal) a middle heading revealed: its top */
  const measure = (page: any, reveal = false) => page.evaluate(async (rv: boolean) => {
    const E = (window as any).editorAPI;
    const out: any[] = [];
    for (const main of [...document.querySelectorAll('main.rtx-pane')] as HTMLElement[]) {
      const pr = main.getBoundingClientRect();
      if (!pr.width || main.closest('.wb-panel--hidden')) continue;
      const glass = Math.max(pr.top, ...[...document.querySelectorAll('.wb-bar, .wb-strip')].map((g) => g.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.left < pr.right - 1 && r.right > pr.left + 1 && r.top <= pr.top + 1 && r.bottom > pr.top).map((r) => r.bottom));
      main.scrollTop = 0;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const first = main.querySelector('.blocks > .blk[data-id]')!.getBoundingClientRect().top;
      let shown: number | null = null;
      if (rv) {
        const id = main.dataset.pane!, ed = E.tabs().editorOf(id);
        E.workbench().activate(id); E.tabs().focus(id);
        const items = ed.outline().filter((x: any) => !x.special);
        const it = items[Math.floor(items.length / 2)];
        ed.run('nav.scrollTo', { id: it.id });
        await E.whenIdle();
        shown = (main.querySelector(`.blk[data-id="${it.id}"]`) as HTMLElement).getBoundingClientRect().top;
      }
      out.push({ pane: main.dataset.pane, glass: Math.round(glass), first: Math.round(first), shown: shown == null ? null : Math.round(shown), form: document.querySelector('.wb-root')!.className });
    }
    return out;
  }, reveal);
  const below = (m: any[], gap = 8) => m.length > 0 && m.every((x) => x.first >= x.glass + gap && (x.shown == null || x.shown >= x.glass - 0.5));
  const { ctx, page } = await open('#/doc/sample', { width: 1500 });
  for (const theme of ['light', 'dark', 'sepia', 'contrast']) {
    await page.evaluate(async (t: string) => { const E = (window as any).editorAPI; E.view().set({ theme: t }); await E.whenIdle(); }, theme);
    const m = await measure(page);
    check(`inset (${theme}, one tab, in the bar): the text starts below the bar at scroll 0`, below(m), m);
  }
  const one = await measure(page, true);
  check('inset (one tab): a revealed heading is not under the bar', below(one), one);
  // the reading point held while the form changes: a heading in view, then a second group (each strip a row under the bar)
  const held = await page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const main = document.querySelector('main.rtx-pane') as HTMLElement, ed = E.tabs().editorOf(main.dataset.pane);
    const items = ed.outline().filter((x: any) => !x.special), it = items[Math.floor(items.length / 2)];
    ed.run('nav.scrollTo', { id: it.id }); await E.whenIdle();
    const el = main.querySelector(`.blk[data-id="${it.id}"]`) as HTMLElement;
    const before = el.getBoundingClientRect().top - main.getBoundingClientRect().top - parseFloat(getComputedStyle(main).scrollPaddingTop);
    wb.run('splitRight'); await E.whenIdle();
    const after = el.getBoundingClientRect().top - main.getBoundingClientRect().top - parseFloat(getComputedStyle(main).scrollPaddingTop);
    return { before: Math.round(before), after: Math.round(after) };
  });
  check('inset: the strip coming (a second group): the reading point keeps its place below the glass (no jump)', Math.abs(held.after - held.before) <= 2 && held.after >= 0, held);
  const two = await measure(page, true);
  check('inset (two groups, their strips under the bar): the text starts below each strip; reveals land below it', below(two), two);
  // many tabs in a narrow group: the strip takes two lines
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); for (let k = 0; k < 4; k++) wb.run('splitRight'); await E.whenIdle(); });
  await page.evaluate(async () => { const E = (window as any).editorAPI, wb = E.workbench(); const doc = E.route().id; for (let k = 0; k < 3; k++) wb.open({ view: 'document', state: { doc } }); await E.whenIdle(); });
  const narrow = await measure(page);
  const lines = await page.evaluate(() => [...document.querySelectorAll('.wb-strip')].map((s) => Math.round(s.getBoundingClientRect().height)));
  check('inset: the narrow groups\' strips are two-line (taller than a one-line strip)', lines.some((h: number) => h > 44), lines);
  await page.screenshot({ path: join(OUT, 'inset-narrow.png') });
  check('inset (narrow groups, two-line strips): the text starts below each strip', below(narrow), narrow);
  await ctx.close();
}
