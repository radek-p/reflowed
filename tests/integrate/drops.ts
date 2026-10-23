// ── drops (a hang): a document in two groups side by side, the right tab dragged by the pointer to the
// left group's bottom zone, then right, top, left and back; one document and two; with a block being edited. A
// watchdog: the page answers within 5 s after every drop (else the main thread's stack is printed: Debugger.pause), the
// panes are hit at their centres, both panes keep their blocks ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^drops$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, state, makeDoc } = h;
  for (const two of [false, true]) {
    const { ctx, page } = await open('#/doc/sample', { width: 1440, height: 900 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Debugger.enable');
    const second = two ? await makeDoc(page, 'Dropped', 30) : null;
    await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    await page.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2);
    if (second) { await page.evaluate((id: string) => { const wb = (window as any).editorAPI.workbench(); wb.replace(wb.current.peek().tab.id, { view: 'document', state: { doc: id } }); }, second); }
    await idle(page);
    const groups = () => page.evaluate(() => { const out: any[] = []; const w = (n: any) => { if (n.kind === 'split') n.children.forEach(w); else out.push({ id: n.id, tab: n.active }); }; w((window as any).editorAPI.workbench().layout.peek().root); return out; });
    const alive = () => Promise.race([page.evaluate(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
    const stuck: string[] = [];
    let hung = '';
    for (const where of ['bottom', 'right', 'top', 'left', 'bottom', 'right'] as const) {
      const G = await groups();
      // a block edited in the pane that moves
      await page.evaluate((t: string) => { const E = (window as any).editorAPI, A = E.forPane(t); const b = A.blocks().find((x: any) => x.kind === 'paragraph' && x.source.length > 40); E.workbench().activate(t); E.tabs().focus(t); if (b) A.editIn(t, b.id, 3); }, G[1].tab);
      await idle(page);
      const tab = await page.locator(`.wb-tab[data-tab="${G[1].tab}"]`).first().boundingBox();
      const g = await page.locator(`#wbg-${G[0].id}`).boundingBox();
      const to: Record<string, [number, number]> = { top: [g.x + g.width / 2, g.y + 90], bottom: [g.x + g.width / 2, g.y + g.height - 40], left: [g.x + 30, g.y + g.height / 2], right: [g.x + g.width - 30, g.y + g.height / 2] };
      const [x0, y0] = [tab.x + tab.width / 2, tab.y + tab.height / 2], [x1, y1] = to[where]!;
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let k = 1; k <= 24; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 24, y0 + ((y1 - y0) * k) / 24);
      await page.mouse.up();
      if (!(await alive())) {
        const p = new Promise((r) => cdp.once('Debugger.paused', r)); await cdp.send('Debugger.pause');
        const ev: any = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 5000))]);
        hung = `${where}: ${ev ? ev.callFrames.slice(0, 12).map((f: any) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`).join(' < ') : 'no stack'}`;
        break;
      }
      await idle(page);
      const st = await page.evaluate(() => [...document.querySelectorAll('main.rtx-pane')].map((m) => { const r = m.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { hit: !!e && m.contains(e), blocks: m.querySelectorAll('.blocks > .blk').length }; }));
      if (st.length !== 2 || !st.every((s) => s.hit && s.blocks > 3)) stuck.push(`${where}: ${JSON.stringify(st)}`);
    }
    check(`drops (${two ? 'two documents' : 'one document'}): six tab drops by the pointer (bottom, right, top, left, bottom, right), a block edited in the moving pane: the page answers after each, both panes shown and hit`, !hung && !stuck.length, { hung, stuck });
    await ctx.close();
  }
}
