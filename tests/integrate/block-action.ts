// ── a feature's button on a block: svgfig's Edit figure, contributed ──
// The block shell's Edit figure was app.js's (figureButton, a figure flag on every block's state). Now a feature
// returns its action for a block (app/feature.ts blockAction) and the shell draws it: a figure block showing an SVG
// asset has the button, a paragraph has none, and pressing it opens the figure editor on that figure. A figure that
// places its SVG through a macro of the preamble has it too (the block uses what its compile opened).
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^block-action$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/', { width: 1440 });
  await page.evaluate(async () => {
    const E = (window as any).editorAPI, store = E.store();
    const id = await store.createDoc({ title: 'Figures', preamble: '\\documentclass{article}\n\\usepackage{graphicx}\n\\newcommand{\\drawing}[1]{\\includegraphics{#1}}', blocks: [
      { kind: 'paragraph', source: 'A paragraph.' },
      { kind: 'figure', source: '\\begin{figure}\n\\includegraphics{fig.svg}\n\\caption{A drawing.}\n\\end{figure}' },
      { kind: 'figure', source: '\\begin{figure}\n\\drawing{other.svg}\n\\caption{Another, placed by a macro.}\n\\end{figure}' }] });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect x="5" y="5" width="90" height="40" fill="none" stroke="black"/></svg>';
    await store.putAsset(id, { name: 'fig.svg', mime: 'image/svg+xml' }, new TextEncoder().encode(svg));
    await store.putAsset(id, { name: 'other.svg', mime: 'image/svg+xml' }, new TextEncoder().encode(svg));
    await E.open(id);
  });
  await page.waitForFunction(() => (window as any).editorAPI.blocks?.().length === 3);
  await idle(page);
  const r = await page.evaluate(() => {
    const [p, f, m] = (window as any).editorAPI.blocks().map((b: any) => b.id);
    const btn = (id: string) => document.querySelector(`main.rtx-pane .blk[data-id="${id}"] [data-action]`) as HTMLElement | null;
    return { para: !!btn(p), fig: btn(f)?.dataset.action ?? null, cls: btn(f)?.className ?? null, label: btn(f)?.textContent ?? null, f, macro: btn(m)?.dataset.action ?? null, m };
  });
  check('block-action: a figure showing an SVG asset has Edit figure (contributed by svgfig); a paragraph has no button',
    !r.para && r.fig === 'edit-figure' && r.cls === 'fig-edit' && r.label === 'Edit figure', r);
  check('block-action: a figure placing its SVG through a macro has Edit figure too', r.macro === 'edit-figure', r);
  await page.click(`main.rtx-pane .blk[data-id="${r.f}"] [data-action="edit-figure"]`);
  await page.waitForSelector('.svf-root');
  check('block-action: pressing it opens the figure editor on that figure', await page.evaluate(() => /fig\.svg/.test(document.querySelector('.svf-root')?.getAttribute('aria-label') ?? '')));
  await ctx.close();
}
