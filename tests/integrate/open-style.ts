// ── opening a block's popover restyles what changes, not the page ──
// A body:has() rule made every focus or class change restyle every icon and block of the page (its merged invalidation
// set, scheduled on <body>); a classless selector subject behind the block's data-edit-layout restyled every glyph of
// the block edited (4,900 for a tall paragraph). From the press that opens a tall block's popover until its editor is
// up: no style recalc of more than 1,000 elements, no :has() invalidation scheduled on <body>.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^open-style$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440 });
  const LONG = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long paragraph that is taller than the window, so its editing popover floats.`).join(' ');
  const id = await page.evaluate((src: string) => (window as any).editorAPI.insert(3, 'paragraph', src), LONG);
  await idle(page);
  const at = await page.evaluate((i: string) => {
    const b = document.querySelector(`main.rtx-pane .blk[data-id="${i}"]`) as HTMLElement;
    b.scrollIntoView({ block: 'start' });
    const r = (b.querySelector('.blk-main') ?? b).getBoundingClientRect();
    return { x: r.left + 80, y: Math.min(innerHeight - 60, r.bottom - 40), n: b.getElementsByTagName('*').length };
  }, id);
  await idle(page);
  const cdp = await page.context().newCDPSession(page);
  const ev: any[] = [];
  cdp.on('Tracing.dataCollected', (e: any) => { for (const x of e.value) ev.push(x); });
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking'] } });
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.blk.editing .cm-editor');
  await idle(page);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end'); await done;
  const recalcs = ev.filter((e) => e.ph === 'X' && e.name === 'UpdateLayoutTree').map((e) => Number(e.args?.elementCount ?? e.args?.endData?.elementCount ?? 0));
  const bodyHas = ev.filter((e) => e.name === 'ScheduleStyleInvalidationTracking' && /^BODY/.test(e.args?.data?.nodeName ?? '') && e.args?.data?.changedPseudo === 'has').length;
  check(`open-style: opening a tall block (${at.n} elements) restyles at most 1,000 elements at once; no :has() invalidation on <body>`,
    recalcs.length > 0 && Math.max(...recalcs) <= 1000 && bodyHas === 0, { largest: Math.max(0, ...recalcs), recalcs: recalcs.length, bodyHas });
  await ctx.close();
}
