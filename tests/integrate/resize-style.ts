// ── a change of the panes' sizes restyles the panes' boxes, not every glyph ──
// Inherited variables set high in the tree restyled every element below them at each change: the resizing class's
// user-select on the workbench root (the drag's start and its drop), --col and --rtx-free on <html> (Chromium restyles
// the whole page for a variable changed on the root, whatever resets it below), then on <body>, and a pane's --col inherited
// by every element of its blocks, a group's strip variables when its
// tabs switch between one line and two, --pane-h on a pane. A splitter dragged across both forms: no style recalc of
// more than a quarter of the page's elements at once (it was all of them, up to 9,820, 75 ms); and each change alone.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^resize-style$'
import { traceWork, calibrate, calibrateAfter, budget, lim, gate } from '../qa/lib/work.ts';
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1500 });
  // the split opened: pane A narrows with no motion of its own; held from the layout's change, it is re-broken by the
  // widths governor a frame's budget at a time (the viewer re-laid out all its blocks in one frame: 120 ms)
  await page.evaluate(() => (window as any).editorAPI.tabs().widths.resetStats());
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await page.waitForFunction(() => [...document.querySelectorAll('main.rtx-pane')].filter((m) => m.querySelector('.blk')).length > 1);
  await idle(page);
  await page.evaluate(() => (window as any).editorAPI.tabs().widths.idle());
  const on = await page.evaluate(() => { const s = (window as any).editorAPI.tabs().widths.stats(); return { settles: s.frames.filter((f: any) => f.settle).length, rebroken: s.rebroken }; });
  check('resize-style: the split opened: the pane that narrows is re-broken by the widths governor', on.settles > 0 && on.rebroken > 0, on);
  const cdp = await page.context().newCDPSession(page);
  const recalcs = async (act: () => Promise<unknown>) => {
    const ev: any[] = [];
    const h = (e: any) => { for (const x of e.value) ev.push(x); };
    cdp.on('Tracing.dataCollected', h);
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline'] } });
    await act();
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end'); await done;
    cdp.off('Tracing.dataCollected', h);
    return ev.filter((e) => e.ph === 'X' && e.name === 'UpdateLayoutTree').map((e) => Number(e.args?.elementCount ?? e.args?.endData?.elementCount ?? 0));
  };
  const all = await page.evaluate(() => document.getElementsByTagName('*').length);
  const quarter = Math.round(all / 4);
  const sep = await page.evaluate(() => { const s = [...document.querySelectorAll('.wb-sep:not(.wb-side-sep)')].find((x: any) => x.getBoundingClientRect().height > 100) as HTMLElement; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 300 }; });
  const forms = new Set<string>();
  const drag = await recalcs(async () => {
    await page.mouse.move(sep.x, sep.y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(sep.x - i * 12, sep.y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      for (const f of await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.wb-group[data-form]')].map((g) => g.dataset.form ?? ''))) forms.add(f);
    }
    await page.mouse.up();
    await idle(page);
    await page.evaluate(() => (window as any).editorAPI.tabs().widths.idle());
  });
  check(`resize-style: a splitter dragged 480 px and dropped restyles at most a quarter of the page's ${all} elements at once`,
    drag.length > 0 && Math.max(...drag) <= quarter, { largest: Math.max(0, ...drag), quarter, recalcs: drag.length, forms: [...forms] });
  const one = (fn: string) => recalcs(() => page.evaluate(fn));
  const force = `getComputedStyle(document.querySelector('main.rtx-pane .blk')).color`;
  const form = await one(`(() => { const g = document.querySelector('.wb-group[data-form]'); const was = g.dataset.form; g.dataset.form = was === 'one' ? 'two' : 'one'; ${force}; g.dataset.form = was; ${force}; })()`);
  check('resize-style: a group\'s strip switching between one line and two restyles its strip, not its pane (at most 100 elements)', form.length > 0 && Math.max(...form) <= 100, { form });
  // a pane's column (--col, on its tab: view/index.js) stops below the column's box (app/wb/css.ts): its change
  // restyles the box and the find bar, not the pane's blocks; <body> carries none (it restyled the page outside the panes)
  const col = await one(`(() => { const t = document.querySelector('main.rtx-pane').parentElement, c = parseFloat(t.style.getPropertyValue('--col')); t.style.setProperty('--col', (c - 1) + 'px'); ${force}; t.style.setProperty('--col', c + 'px'); ${force}; })()`);
  check(`resize-style: a change of a pane's column (--col, on its tab) restyles at most 200 elements, not its blocks`, col.length > 0 && Math.max(...col) <= 200, { col });
  const bodyCol = await page.evaluate(() => [document.body.style.getPropertyValue('--col'), document.body.style.getPropertyValue('--rtx-free')]);
  check('resize-style: no column variable (--col, --rtx-free) on <body>', bodyCol.every((v: string) => !v), { bodyCol });
  const ph = await one(`(() => { const m = document.querySelector('main.rtx-pane'), v = m.style.getPropertyValue('--pane-h'); m.style.setProperty('--pane-h', (parseFloat(v) - 1) + 'px'); ${force}; m.style.setProperty('--pane-h', v); ${force}; })()`);
  check('resize-style: a pane\'s height (--pane-h) restyles at most a quarter of the page\'s elements', ph.length > 0 && Math.max(...ph) <= quarter, { ph, quarter });
  const rz = await one(`(() => { const r = document.querySelector('.wb-root'); r.classList.add('wb-root--resizing', 'wb-root--resizing-col'); ${force}; r.classList.remove('wb-root--resizing', 'wb-root--resizing-col'); ${force}; })()`);
  check('resize-style: the resizing classes on the workbench root restyle at most 1,000 elements (no inherited user-select)', rz.length > 0 && Math.max(...rz) <= 1000, { rz });
  // no viewport height on <html> (--wb-vvh was set there at every resize: the whole page restyled);
  // the fit to the visible part (viewport.ts: --wb-vtop, --wb-vh and the class wb-fitted on <body>, only while an
  // on-screen keyboard is up, once per change) stops at the panes: it restyles at most a quarter of the page; a block selected, a class on one block: no :has() on the list of blocks or the
  // workbench root makes them restyle every block
  const vvh = await page.evaluate(() => document.documentElement.style.getPropertyValue('--wb-vvh'));
  check('resize-style: the page sets no viewport height variable on <html> (none of its CSS reads it; it restyled the whole page at each resize)', vvh === '', { vvh });
  const fit = await one(`(() => { const b = document.body; b.style.setProperty('--wb-vtop', '0px'); b.style.setProperty('--wb-vh', '400px'); b.classList.add('wb-fitted'); ${force}; for (const p of ['--wb-vtop', '--wb-vh']) b.style.removeProperty(p); b.classList.remove('wb-fitted'); ${force}; })()`);
  check('resize-style: the keyboard fit on <body> restyles at most a quarter of the page (its variables stop at the panes)', fit.length > 0 && Math.max(...fit) <= quarter, { fit, quarter });
  const sel = await one(`(() => { const b = [...document.querySelectorAll('main.rtx-pane .blk')][3]; b.classList.add('selected'); b.closest('.blocks')?.classList.add('has-selected'); ${force}; b.classList.remove('selected'); b.closest('.blocks')?.classList.remove('has-selected'); ${force}; b.classList.add('rtx-probe-x'); ${force}; b.classList.remove('rtx-probe-x'); ${force}; })()`);
  check('resize-style: a block selected, or any class on one block, restyles at most a quarter of the page (not every block)', sel.length > 0 && Math.max(...sel) <= quarter, { sel, quarter });
  // the focused pane's data-part moves with the focus (doc-tabs markParts): a rule with [data-part] and * as its subject
  // restyled every element of both panes at each move
  const dp = await one(`(() => { const ms = [...document.querySelectorAll('main.rtx-pane')], was = ms.map((m) => m.dataset.part ?? null); ms[0].dataset.part = was[1] ?? 'x'; if (was[1]) ms[1].dataset.part = was[0] ?? 'x'; ${force}; ms.forEach((m, i) => { if (was[i]) m.dataset.part = was[i]; else delete m.dataset.part; }); ${force}; })()`);
  check('resize-style: the focused pane\'s data-part moving restyles at most a quarter of the page\'s elements', dp.length > 0 && Math.max(...dp) <= quarter, { dp, quarter });
  // the split closed: the closed tab's pane parked with no layout read, the other pane held and re-broken by the widths
  // governor a frame's budget at a time (not by the viewer, every block in view in one frame)
  await page.evaluate(() => (window as any).editorAPI.tabs().widths.resetStats());
  const off = await recalcs(async () => {
    await page.evaluate(() => { const wb = (window as any).editorAPI.workbench(); const all: string[] = []; const walk = (n: any) => { if (n.kind === 'split') n.children.forEach(walk); else all.push(...n.tabs.map((t: any) => t.id)); }; walk(wb.layout.peek().root); for (const t of all.slice(1)) wb.close(t); });
    await idle(page);
    await page.evaluate(() => (window as any).editorAPI.tabs().widths.idle());
  });
  const ws = await page.evaluate(() => { const s = (window as any).editorAPI.tabs().widths.stats(); return { settles: s.frames.filter((f: any) => f.settle).length, rebroken: s.rebroken, panes: document.querySelectorAll('main.rtx-pane .blk').length > 0 }; });
  check('resize-style: the split closed: no recalc of more than a quarter of the page, the pane left re-broken by the widths governor',
    off.length > 0 && Math.max(...off) <= quarter && ws.settles > 0 && ws.rebroken > 0 && ws.panes, { largest: Math.max(0, ...off), quarter, ...ws });
  await ctx.close();
}
