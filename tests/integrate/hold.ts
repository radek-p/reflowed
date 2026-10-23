// ── hold: a side column's slide and a splitter's drag keep every pane's lines; each pane reflows once at the end ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^hold$'
import type { Harness } from './harness.ts';
import { installReadingLine } from '../qa/lib/reading-line.ts';

export default async function (h: Harness): Promise<void> {
  const { browser, check, open, idle, state } = h;
  // (narrow enough that the column fills the pane: its width follows the pane's)
  const ctx = await browser.newContext({ viewport: { width: 860, height: 900 }, reducedMotion: 'no-preference' });
  const { page } = await open('#/doc/sample', { ctx });
  // the viewer's re-breaks (a layout at a width other than the block's last), counted per block and per pane, split
  // at the motion's end: from the workbench's resizestart until the hold is released (the editor's resizeend listener
  // runs before the test's: the widths' own state says it). Its other layouts (a segment painted as it nears the view)
  // keep the lines: not counted.
  await page.evaluate(() => {
    const w = window as any, wb = w.editorAPI.workbench();
    const laid = (el: Element) => w.reflowtex.inspect.state(el)?.lastWidth ?? null;
    w.__hold = { phase: 'rest', during: 0, after: new Map(), panes: new Map(), w: new Map(), laid };
    document.addEventListener('reflowtex:layout', (e: any) => {
      const h = w.__hold, el = e.detail?.block ?? e.target, pane = el.closest?.('main[data-pane]')?.dataset.pane ?? '?';
      if (el.closest('.rtx-w-ghost')) return;
      const lw = laid(el);
      if (h.w.get(el) === lw) return;
      h.w.set(el, lw);
      if (h.phase === 'rest') return;
      if (h.phase === 'motion' && w.editorAPI.tabs().widths.moving) h.during++;
      else { h.after.set(el, (h.after.get(el) ?? 0) + 1); h.panes.set(pane, (h.panes.get(pane) ?? 0) + 1); }
    }, true);
    wb.on('resizestart', () => { w.__hold.phase = 'motion'; });
    wb.on('resizeend', () => { w.__hold.phase = 'after'; });
  });
  // the reader's place in each pane: the line at its top, marked when the reader scrolls there (tests/qa/lib/reading-line.ts),
  // and where that line is (the keeper holds the line read, not a block's top: the block re-breaks too)
  await installReadingLine(page);
  const panesNow = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main[data-pane]')].map((m) => m.dataset.pane!));
  const readingLine = async () => Object.fromEntries(await page.evaluate((ps: string[]) => ps.map((p) => [p, (window as any).__readingLine.y(p)]), await panesNow()));
  const scrollAll = async () => {
    await page.evaluate(async () => {
      for (const m of document.querySelectorAll('main[data-pane]') as any) m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * 0.25);   // (room below: a pane widened is shorter, never clamped)
      await (window as any).editorAPI.whenIdle();
    });
    await page.evaluate((ps: string[]) => ps.forEach((p) => (window as any).__readingLine.mark(p)), await panesNow());
  };
  const reset = () => page.evaluate(() => { const h = (window as any).__hold; h.phase = 'rest'; h.during = 0; h.after = new Map(); h.panes = new Map(); h.w = new Map([...document.querySelectorAll('main[data-pane] .latex-block')].map((el) => [el, h.laid(el)])); });
  const result = () => page.evaluate(async () => {
    const w = window as any, E = w.editorAPI;
    await E.whenIdle();
    await E.tabs().widths.idle();
    const h = w.__hold;
    return { during: h.during, maxPerBlock: Math.max(0, ...h.after.values()), panes: Object.fromEntries(h.panes), phase: h.phase };
  });
  const near = (a: any, b: any) => Object.keys(a).every((p) => a[p] != null && b[p] != null && Math.abs(a[p] - b[p]) <= 2);

  // (1) the left column hidden and shown again by each real path: its close chevron, the bar's toggle, the key
  // (Ctrl/⌘B), focus mode (the columns go at once: no motion, one reflow); animated (220 ms), the lines kept while
  // it moves. At a wide window the column is capped: its width does not change, so nothing is re-broken at all.
  const key = process.platform === 'darwin' ? 'Meta+b' : 'Control+b';
  const focus = () => page.evaluate(() => { (window as any).__hold.phase = 'motion'; (window as any).editorAPI.tabs().currentEditor().toggleFocus(); });
  const paths: [string, () => Promise<unknown>][] = [
    ['hide (its chevron)', () => page.click('.wb-side-hide--left')], ['show (the bar\'s toggle)', () => page.click('.wb-bar [data-action="show-left"]')],
    ['hide (the key)', () => page.keyboard.press(key)], ['show (the key)', () => page.keyboard.press(key)],
    ['focus mode on', focus], ['focus mode off', focus]];
  for (const wide of [false, true]) {
    if (wide) { await page.setViewportSize({ width: 1500, height: 900 }); await idle(page); await page.evaluate(() => (window as any).editorAPI.tabs().widths.idle()); }
    await scrollAll();
    for (const [how, act] of paths) {
      const at = `hold (${wide ? '1500 px: capped' : '860 px'}): ${how}`;
      const before = await readingLine();
      await reset();
      await act();
      const r = await result();
      const after = await readingLine();
      check(`${at}: no re-break while it changes`, r.during === 0 && r.phase !== 'rest', r);
      check(`${at}: ${wide ? 'no re-break at the end either (the width is the same)' : 'every pane reflows once at the end (each block at most once)'}`, wide ? r.maxPerBlock === 0 : r.maxPerBlock === 1 && Object.keys(r.panes).length >= 1, r);
      check(`${at}: the line read at the top stays in place`, near(before, after), { before, after });
    }
    if (wide) { await page.setViewportSize({ width: 860, height: 900 }); await idle(page); await page.evaluate(() => (window as any).editorAPI.tabs().widths.idle()); }
  }
  // (2) the window resized in steps (the widths' own resize hold, at the viewer's last widths): no re-break
  // while it goes on, one when it pauses
  {
    const before = await readingLine();
    await reset();
    await page.evaluate(() => { (window as any).__hold.phase = 'motion'; });
    for (const w of [840, 820, 800, 780]) { await page.setViewportSize({ width: w, height: 900 }); await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))); }
    const r = await result();
    const after = await readingLine();
    check('hold: a window resize: no re-break while it goes on', r.during === 0, r);
    check('hold: a window resize: the pane reflows once when it pauses (each block at most once)', r.maxPerBlock === 1, r);
    check('hold: a window resize: the line read at the top stays in place', near(before, after), { before, after });
  }
  // (3) two panes and the splitter between them dragged
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await idle(page);
  await scrollAll();
  const sep = await page.evaluate(() => { const s = [...document.querySelectorAll('.wb-sep:not(.wb-side-sep)')].find((x: any) => x.getBoundingClientRect().height > 100) as HTMLElement; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const before = await readingLine();
  await reset();
  await page.mouse.move(sep.x, sep.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(sep.x - i * 12, sep.y); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
  const mid = await page.evaluate(() => (window as any).__hold.during);
  await page.mouse.up();
  const r = await result();
  const after = await readingLine();
  check('hold: a splitter drag: no layout while it moves', mid === 0 && r.during === 0, { mid, r });
  check('hold: a splitter drag: both panes reflow once at the end (each block at most once)', r.maxPerBlock === 1 && Object.keys(r.panes).length === 2, r);
  check('hold: a splitter drag: the line read at the top stays in place in both panes', near(before, after), { before, after });
  await ctx.close();
}
