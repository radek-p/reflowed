// ── overlays: the document's own UI (the code popover, the block controls, the citation card) stays in
// its view: under the group's strip and the window bar, never over a neighbouring group; in each form (one group, the
// strip in the bar; two side by side; top and bottom). Sampled by hit-testing the strip's, the bar's and the neighbour's
// boxes with a block edited just under the strip and its controls shown ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^overlays$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, state, makeDoc } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440, height: 900 });
  const second = await makeDoc(page, 'Overlays', 40);
  const forms: [string, () => Promise<void>][] = [
    ['one group', async () => {}],
    ['side by side', async () => { await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight')); await page.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2); }],
    ['top and bottom', async () => {
      await page.evaluate((id: string) => { const E = (window as any).editorAPI, wb = E.workbench(); const g: any[] = []; const w = (n: any) => { if (n.kind === 'split') n.children.forEach(w); else g.push(n); }; w(wb.layout.peek().root);
        wb.replace(g[1].active, { view: 'document', state: { doc: id } }); wb.dropTab(g[1].active, { tabId: g[1].active, group: g[0].id, kind: 'body', side: 'bottom' }); }, second);
      await page.waitForFunction(() => (window as any).editorAPI.workbench().layout.peek().root.dir === 'column');
    }],
    ['top and bottom, narrow (the controls a floating bar)', async () => { await page.setViewportSize({ width: 760, height: 900 }); await page.waitForFunction(() => !!document.querySelector('main.rtx-pane[data-ctl="narrow"]')); }],
  ];
  for (const [form, make] of forms) {
    await make();
    await idle(page);
    const r = await page.evaluate(async () => {
      const E = (window as any).editorAPI, wb = E.workbench();
      const g: any[] = []; const w = (n: any) => { if (n.kind === 'split') n.children.forEach(w); else g.push(n); }; w(wb.layout.peek().root);
      const last = g[g.length - 1], t = last.active, A = E.forPane(t);
      wb.activate(t); E.tabs().focus(t);
      const main = document.querySelector(`main.rtx-pane[data-pane="${t}"]`) as HTMLElement;
      const b = A.blocks().filter((x: any) => x.kind === 'paragraph' && x.source.length > 40)[2];
      A.editIn(t, b.id, 0); await E.whenIdle();
      const blk = main.querySelector(`.blk[data-id="${b.id}"]`) as HTMLElement;
      const inset = parseFloat(getComputedStyle(main).scrollPaddingTop) || 0;
      main.scrollTop += blk.getBoundingClientRect().top - main.getBoundingClientRect().top - inset + 24;   // the block's top 24 px under the strip
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const src = blk.querySelector('.blk-source');   // then the popover's top 20 px under it
      if (src) main.scrollTop += src.getBoundingClientRect().top - main.getBoundingClientRect().top - inset + 20;
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { t, id: b.id, inset };
    });
    // the block's controls shown: the pointer over the block's margin
    const bb = await page.locator(`main.rtx-pane[data-pane="${r.t}"] .blk[data-id="${r.id}"]`).boundingBox();
    await page.mouse.move(bb.x + 4, bb.y + bb.height - 8);
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const hits = await page.evaluate((t: string) => {
      const main = document.querySelector(`main.rtx-pane[data-pane="${t}"]`) as HTMLElement, mr = main.getBoundingClientRect();
      const glassTop = mr.top + (parseFloat(getComputedStyle(main).scrollPaddingTop) || 0);
      const out: string[] = [];
      // the strip over this pane (its glass) and the bar: from the window's top to the pane's visible top, across the pane
      for (let y = 2; y < glassTop - 1; y += 6) for (let x = mr.left + 4; x < mr.right - 4; x += 24) {
        const e = document.elementFromPoint(x, y) as HTMLElement | null;
        if (e && main.contains(e) && e.closest('.blk')) out.push(`${Math.round(x)},${Math.round(y)} ${e.className}`);
      }
      // the other panes' boxes: nothing of this pane
      for (const o of document.querySelectorAll('main.rtx-pane')) {
        if (o === main) continue;
        const q = o.getBoundingClientRect();
        for (let y = q.top + 2; y < q.bottom; y += 12) for (let x = q.left + 2; x < q.right; x += 24) { const e = document.elementFromPoint(x, y); if (e && main.contains(e)) out.push(`neighbour ${Math.round(x)},${Math.round(y)}`); }
      }
      const pop = main.querySelector('.blk.editing .blk-source')?.getBoundingClientRect();
      return { out: out.slice(0, 6), n: out.length, popTop: pop ? Math.round(pop.top) : null, glassTop: Math.round(glassTop) };
    }, r.t);
    check(`overlays (${form}): the code popover and the block controls under the strip and the bar, none over a neighbouring group`, hits.n === 0 && hits.popTop != null, hits);
    await page.keyboard.press('Escape');
    await page.waitForFunction((t: string) => !(window as any).editorAPI.sessions().some((s: any) => s.pane === t), r.t);
    check(`overlays (${form}): Escape closes the block's editor`, true);
  }
  await ctx.close();
  // the citation card (a kit layer placed by the reference): a reference just below the right pane's strip; the card
  // stays in that pane's box, below the strip
  {
    const { ctx: c2, page: p2 } = await open('#/doc/sample', { width: 1440, height: 900 });
    await p2.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    await p2.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2);
    await idle(p2);
    const at = await p2.evaluate(async () => {
      const E = (window as any).editorAPI, ids = Object.keys(E.editors()), t = ids[ids.length - 1];
      E.workbench().activate(t); E.tabs().focus(t);
      const main = document.querySelector(`main.rtx-pane[data-pane="${t}"]`) as HTMLElement, inset = parseFloat(getComputedStyle(main).scrollPaddingTop) || 0;
      const u = E.refnav().units().find((x: any) => E.refnav().elements(x.id)[0]?.closest(`main.rtx-pane[data-pane="${t}"]`) && x.blockId);
      if (!u) return null;
      const g = E.refnav().elements(u.id)[0] as Element;
      main.scrollTop += g.getBoundingClientRect().top - main.getBoundingClientRect().top - inset - 30;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const q = E.refnav().elements(u.id)[0].getBoundingClientRect();
      return { t, x: q.left + q.width / 2, y: q.top + q.height / 2 };
    });
    if (!at) check('overlays: a reference in the right pane', false);
    else {
      await p2.mouse.move(at.x, at.y);
      await p2.waitForFunction(() => { const c = document.getElementById('rn-card'); return !!c && c.getBoundingClientRect().height > 0; });
      const box = await p2.evaluate((t: string) => {
        const main = document.querySelector(`main.rtx-pane[data-pane="${t}"]`) as HTMLElement, m = main.getBoundingClientRect(), top = m.top + (parseFloat(getComputedStyle(main).scrollPaddingTop) || 0);
        const c = document.getElementById('rn-card')!.getBoundingClientRect();
        return { card: [c.left, c.top, c.right, c.bottom].map(Math.round), pane: [m.left, top, m.right, m.bottom].map(Math.round) };
      }, at.t);
      check('overlays: the citation card stays in its pane, below the strip', box.card[0]! >= box.pane[0]! && box.card[1]! >= box.pane[1]! && box.card[2]! <= box.pane[2]! + 1, box);
    }
    await c2.close();
  }
}
