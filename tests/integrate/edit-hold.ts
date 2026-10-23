// ── editing while a column closes: the block stays in edit mode with its editor focused
// every frame of the slide, and its preview is laid out once (at the end), not mid-slide and again ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^edit-hold$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { browser, check, open, idle } = h;
  const ctx = await browser.newContext({ viewport: { width: 860, height: 900 }, reducedMotion: 'no-preference' });
  const { page } = await open('#/doc/sample', { ctx });
  const at = await page.evaluate(() => {
    const p = [...document.querySelectorAll('main.rtx-pane .blk[data-kind=paragraph]')].find((x) => { const r = x.getBoundingClientRect(); return r.top > 150 && r.bottom < 700; }) as HTMLElement;
    const r = (p.querySelector('.blk-main') ?? p).getBoundingClientRect();
    return { x: r.left + 80, y: r.top + 10, id: p.dataset.id! };
  });
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.blk.editing .cm-editor');
  await idle(page);
  const r = await page.evaluate(async (id: string) => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const blk = () => document.querySelector(`main.rtx-pane .blk[data-id="${id}"]`) as HTMLElement;
    let layouts = 0, moving = false, during = 0;
    const laid = (e: any) => { const el = e.detail?.block ?? e.target; if (el.closest?.(`.blk[data-id="${id}"]`) && !el.closest('.rtx-w-ghost')) { layouts++; if (moving) during++; } };
    document.addEventListener('reflowtex:layout', laid, true);
    const offs = [wb.on('resizestart', () => { moving = true; }), wb.on('resizeend', () => { moving = false; })];
    const frames: string[] = []; let go = true;
    const tick = () => { frames.push(`${blk()?.classList.contains('editing') ? 'E' : '-'}${document.activeElement?.closest('.cm-editor') ? 'F' : '-'}`); if (go) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    (document.querySelector('.wb-side-hide--left') as HTMLElement).click();
    await new Promise((res) => requestAnimationFrame(res));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
    await E.whenIdle(); await E.tabs().widths.idle();
    go = false;
    document.removeEventListener('reflowtex:layout', laid, true);
    for (const off of offs) (off as any)?.();
    return { frames: frames.length, notEditing: frames.filter((f) => f !== 'EF').length, layouts, during };
  }, at.id);
  check('edit-hold: a block being edited while the left column slides shut stays in edit mode, focused, every frame', r.frames > 5 && r.notEditing === 0, r);
  check('edit-hold: … and its preview is laid out at most once, never while the column moves', r.layouts <= 1 && r.during === 0, r);
  await ctx.close();
}
