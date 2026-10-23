// ── one width lock for every motion of the groups' widths ──
// A side column sliding (or a splitter dragged) emits resizestart .. resizeend; the workbench locks each shown tab's
// host at its width meanwhile (workbench.ts lockHosts: its last ResizeObserver size, its own layer), and takes the lock
// off after resizeend's listeners (the editor pins its blocks there). So nothing in a document lays out while the column
// slides (Firefox re-laid out the whole pane every frame: 170-235 ms tasks), and it reflows once at the end. Meanwhile
// the text stays centred in its group while the group has room for it and the column's least margins (the host placed
// by lockedLeft: app/wb/css.ts), and keeps its left edge once it has not; the lines re-broken at the end start where
// the held text was.
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^width-lock$'
import type { Harness } from './harness.ts';

/** the least distance from a group's left edge to its document's text (the pane's padding and the column's least margin:
 *  app/wb/css.ts) */
const INSET = 20;
type Box = { left: number; width: number };
type Slide = { T: number; d0: number; before: { g: Box; t: Box }; frames: { g: Box; t: Box }[]; last: { g: Box; t: Box } | null; after: { g: Box; t: Box }; starts: number };
/** the left side column toggled, the slide recorded frame by frame: the group's box and the text's (a block in view, its
 *  held lines) while the host is locked, and both once the widths have settled */
function slide(page: any): Promise<Slide> {
  return page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const pane = [...document.querySelectorAll('main.rtx-pane[data-pane]')].find((m) => !m.closest('.wb-panel--hidden')) as HTMLElement;
    const host = pane.closest('.wb-panel') as HTMLElement, group = host.parentElement as HTMLElement;
    const top = pane.getBoundingClientRect().top;
    const blk = [...pane.querySelectorAll('.blocks > .blk')].find((b) => { const r = b.getBoundingClientRect(); return r.top > top + 40 && r.bottom < innerHeight && r.height > 0 && !!b.querySelector('.blk-render > .latex-block'); }) as HTMLElement;
    const text = () => blk.querySelector(':scope > .blk-main > .blk-render > .latex-block:not(.incoming):not(.rtx-w-ghost)') as HTMLElement;
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width }; };
    const at = () => ({ g: box(group), t: box(text()) });
    const b = at();
    const d0 = (b.t.left + b.t.width / 2) - (b.g.left + b.g.width / 2);   // the text's centre against the group's at rest (a classic scrollbar)
    const frames: { g: { left: number; width: number }; t: { left: number; width: number } }[] = [];
    let sliding = true, starts = 0;
    const a = wb.on('resizestart', () => { starts++; }), off = wb.on('resizeend', () => { sliding = false; });
    const frame = () => { if (!sliding) return; if (host.classList.contains('wb-panel--locked')) frames.push(at()); requestAnimationFrame(frame); };
    wb.run('toggleSide', 'left');
    requestAnimationFrame(frame);
    for (let i = 0; i < 600 && sliding; i++) await new Promise((res) => requestAnimationFrame(res));
    a(); off();
    await E.whenIdle(); await E.tabs().widths.idle();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { T: b.t.width, d0, before: b, frames, last: frames[frames.length - 1] ?? null, after: at(), starts };
  });
}
/** where the held text should start in a frame: centred in the group, or at the least inset once it does not fit */
const want = (s: Slide, f: { g: Box }) => f.g.left + Math.max(INSET, (f.g.width - s.T) / 2 + s.d0);
const centred = (s: Slide, f: { g: Box }) => (f.g.width - s.T) / 2 + s.d0 > INSET + 2;
const narrow = (s: Slide, f: { g: Box }) => (f.g.width - s.T) / 2 + s.d0 < INSET - 2;
/** the frames whose text is more than 2 px from where it should be */
const off = (s: Slide) => s.frames.filter((f) => Math.abs(f.t.left - want(s, f)) > 2).map((f) => ({ g: f.g, t: f.t, want: want(s, f) }));
/** the re-broken text against the held text of the last frame: the same centre (centred), or the same left edge */
function jump(s: Slide): number {
  if (!s.last) return Infinity;
  const c = (x: Box) => x.left + x.width / 2;
  return centred(s, s.last) ? Math.abs(c(s.after.t) - c(s.last.t)) : Math.abs(s.after.t.left - s.last.t.left);
}
const brief = (s: Slide) => ({ T: Math.round(s.T), d0: s.d0, frames: s.frames.length, centred: s.frames.filter((f) => centred(s, f)).length, narrow: s.frames.filter((f) => narrow(s, f)).length,
  g: [...new Set(s.frames.map((f) => Math.round(f.g.width)))].slice(0, 6), off: off(s).slice(0, 3), last: s.last, after: s.after, jump: jump(s) });

export default async function (h: Harness): Promise<void> {
  const { check, open, idle, browser } = h;
  // with motion (the harness's pages reduce it: the slide would be over before a frame)
  const { ctx, page } = await open('#/doc/sample', { width: 1440, ctx: await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' }) });
  await idle(page);
  const r = await page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const pane = () => [...document.querySelectorAll('main.rtx-pane[data-pane]')].find((m) => !m.closest('.wb-panel--hidden')) as HTMLElement;
    const w0 = pane().getBoundingClientRect().width;
    const during: number[] = [];
    let lockedSeen = 0, sliding = true;
    const off = wb.on('resizeend', () => { sliding = false; });
    const frame = () => { if (!sliding) return; during.push(Math.round(pane().getBoundingClientRect().width)); if (document.querySelector('.wb-panel--locked')) lockedSeen++; requestAnimationFrame(frame); };
    wb.run('toggleSide', 'left');
    requestAnimationFrame(frame);
    while (sliding) await new Promise((res) => requestAnimationFrame(res));
    off();
    await E.whenIdle(); await E.tabs().widths.idle();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const p = pane();
    const over = [...p.querySelectorAll('.blk-render > .latex-block')].filter((el) => el.getBoundingClientRect().width > (el.parentElement as HTMLElement).getBoundingClientRect().width + 1).length;
    return { w0: Math.round(w0), during: [...new Set(during)], frames: during.length, lockedSeen, locksLeft: document.querySelectorAll('.wb-panel--locked').length, w1: Math.round(p.getBoundingClientRect().width), over, blocks: p.querySelectorAll('.blk-render > .latex-block').length };
  });
  check('width-lock: while the side column slides, the document\'s pane keeps one width, its host locked, in every frame',
    r.frames > 3 && r.during.length === 1 && r.during[0] === r.w0 && r.lockedSeen === r.frames, r);
  // no document is in a size container: a container whose size moves restyles everything in it, every frame (the group was
  // one: Firefox)
  const inContainer = await page.evaluate(() => { const out: string[] = []; for (let e = document.querySelector('main.rtx-pane')?.parentElement ?? null; e; e = e.parentElement) if (getComputedStyle(e).containerType !== 'normal') out.push(e.className); return out; });
  check('width-lock: no size container above a document (its restyle would reach every glyph)', inContainer.length === 0, inContainer);
  check('width-lock: after it, the lock is off, the pane at its new width, every block fitting its column', r.locksLeft === 0 && r.w1 !== r.w0 && r.blocks > 0 && r.over === 0, r);
  // toggled again while it slides: the first slide ends with its resizeend (its cancel lost it: the lock and the widths' hold
  // nest, so the hosts stayed locked and nothing re-broke until a reload)
  const twice = await page.evaluate(async () => {
    const E = (window as any).editorAPI, wb = E.workbench();
    let starts = 0, ends = 0;
    const a = wb.on('resizestart', () => { starts++; }), b = wb.on('resizeend', () => { ends++; });
    wb.run('toggleSide', 'left');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    wb.run('toggleSide', 'left');
    for (let i = 0; i < 120 && ends < starts; i++) await new Promise((r) => requestAnimationFrame(r));
    a(); b();
    await E.whenIdle(); await E.tabs().widths.idle();
    return { starts, ends, locks: document.querySelectorAll('.wb-panel--locked').length, moving: E.tabs().widths.moving };
  });
  check('width-lock: toggled again mid-slide, every slide ends (resizeend), no host stays locked, the widths settle',
    twice.starts === 2 && twice.ends === 2 && twice.locks === 0 && !twice.moving, twice);

  // the text's place while the column slides: a group wider than the text, centred in it, the column's centre
  // following the group's; the side toggled at a window where the group gets narrower than the text and its margins:
  // centred while it fits, then its left edge kept at the least inset; after each, the re-broken text where the held one was
  const wide = await slide(page);
  check('width-lock: the group wider than the text: in every frame of the slide the text is centred in its group (within 2 px)',
    wide.starts === 1 && wide.frames.length > 3 && wide.frames.every((f) => centred(wide, f)) && off(wide).length === 0, brief(wide));
  check('width-lock: the group wider than the text: the re-broken text has the held text\'s centre (within 2 px)', jump(wide) <= 2, brief(wide));
  // a window where the text and its margins fit the wider of the two groups and not the narrower one
  const ga = wide.before.g.width, gb = wide.after.g.width;
  const vw = Math.round(1440 + (wide.T + 2 * INSET - wide.d0 * 2) - (ga + gb) / 2);
  await page.setViewportSize({ width: vw, height: 900 });
  await idle(page);
  await page.evaluate(async () => { const E = (window as any).editorAPI; await E.whenIdle(); await E.tabs().widths.idle(); });
  // from the wider state: toggled once first when the side is where the group is narrower
  if (gb < ga) await slide(page);
  const cross = await slide(page);
  check('width-lock: the group narrowing past the text: centred while it fits, then its left edge kept at the least inset (within 2 px)',
    cross.starts === 1 && cross.frames.some((f) => centred(cross, f)) && cross.frames.some((f) => narrow(cross, f)) && off(cross).length === 0, { vw, ...brief(cross) });
  check('width-lock: the group narrowing past the text: the re-broken text starts where the held text did (within 2 px)', jump(cross) <= 2, { vw, ...brief(cross) });
  // and back: widening from narrower than the text, its left edge kept until it fits, then centred
  const back = await slide(page);
  check('width-lock: the group widening past the text: its left edge kept until it fits, then centred (within 2 px)',
    back.starts === 1 && back.frames.length > 3 && off(back).length === 0, { vw, ...brief(back) });
  check('width-lock: the group widening past the text: no jump when the lines are re-broken (within 2 px)', jump(back) <= 2, { vw, ...brief(back) });
  await ctx.close();
}
