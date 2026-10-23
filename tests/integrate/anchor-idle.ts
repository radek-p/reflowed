// ── an idle pane spends no frames on its anchor keeper ──
// Each pane's keeper read the scroll height in a rAF loop that never stopped (idle CPU, battery). Now the loop runs while
// something happens (a resize, a scroll, input, a correction put off) and stops after half a second without a change.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^anchor-idle$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  await idle(page);
  const st = () => page.evaluate(() => (window as any).editorAPI.keeper().stats() as { frames: number; ticking: boolean; corrections: number });
  await page.waitForFunction(() => !(window as any).editorAPI.keeper().stats().ticking);
  const f0 = (await st()).frames;
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 40 ? r(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const still = await st();
  check('anchor-idle: an idle pane\'s keeper runs no frame (40 frames: none)', !still.ticking && still.frames === f0, { f0, ...still });
  // the reader scrolls: it runs again, and stops again once the page is still
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => (window as any).editorAPI.keeper().stats().ticking);
  await page.waitForFunction(() => !(window as any).editorAPI.keeper().stats().ticking);
  const after = await st();
  check('anchor-idle: a scroll wakes it; it stops again once the page is still', after.frames > f0 && !after.ticking, { f0, ...after });
  await ctx.close();
}
