// BLOCK DRAG: a block dragged by its handle with real pointer events (down, many small moves, up), in one pane and
// between the panes of its document (docview/drag.ts). The preview (docview/drag-preview.ts) follows the pointer exactly
// (the copy of the block's render at its place plus the pointer's way, ±1 px), across the splitter, above everything,
// masked (the fade), catching no pointer; the block stays in place, dimmed; the drop line in the pane under the
// pointer, none on the block's own place; a drop moves the block there (both panes show it, the reading positions
// hold); over a side column, the tab strip or another document's pane: no line, the cursor says no drop, a release
// changes nothing; Escape cancels; undo restores the order; autoscroll near a pane's edges, either way; into a
// container (indented) and out; nothing the drag set stays (classes, transforms, cursor, layer). Chromium also: no
// long task per move, no layout per move from the preview; a phone-width touch drag. WebKit and Firefox: the core
// scenarios. Screenshots of the preview mid-drag (one pane, over the splitter; light and dark).
// Waits on editorAPI.whenIdle(), editorAPI.dragSettled() and DOM state, never on fixed times.
//
//   node tests/test-block-drag.ts [http://localhost:8151/] [--only <regex>] [--browser chromium|webkit|firefox|all]
// Results: test-results/block-drag/results.json; screenshots: test-results/drag-ghost/.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { paneIds, paneSel } from './qa/lib/panes.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'block-drag');
const SHOTS = join(resultsDir(HERE), 'drag-ghost');
mkdirSync(OUT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8151/';
const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]!) : null;
const BROWSERS = (argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1]! : 'all') === 'all' ? ['chromium', 'webkit', 'firefox'] : [argv[argv.indexOf('--browser') + 1]!];
const section = (name: string) => !ONLY || ONLY.test(name);
const URL = '?seed=sample&engine&store=memory#/doc/sample';

type Pt = { x: number; y: number };
type R = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const results: { name: string; ok: boolean; detail?: string }[] = [];
let B = 'chromium';
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name: `[${B}] ${name}`, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${B}] ${name}${d && !ok ? ` — ${d.slice(0, 600)}` : ''}`);
}
const problems: string[] = [];

async function open(o: { width?: number; height?: number; dark?: boolean; touch?: boolean } = {}) {
  const bt = pw[B];
  const browser = await bt.launch();
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 1600, height: o.height ?? 900 }, colorScheme: o.dark ? 'dark' : 'light',
    ...(o.touch ? { hasTouch: true, isMobile: B === 'chromium' } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`[${B}] pageerror: ${e.message}`));
  page.setDefaultTimeout(180000);
  await page.goto(BASE + URL);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await idle(page);
  return { browser, ctx, page, close: () => browser.close() };
}
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const api = (page: any, name: string, ...args: unknown[]) => page.evaluate(([n, a]: any) => (window as any).editorAPI[n](...a), [name, args]);
const order = async (page: any): Promise<string[]> => (await api(page, 'blocks') as any[]).map((b: any) => b.id);
const settled = async (page: any) => { await page.evaluate(() => (window as any).editorAPI.dragSettled()); await idle(page); };

/** split the document's tab: 'splitRight' or 'splitDown'; the two panes' selectors */
async function split(page: any, how: 'splitRight' | 'splitDown'): Promise<[string, string]> {
  const before = await paneIds(page);
  await page.evaluate((h: string) => (window as any).editorAPI.workbench().run(h), how);
  await page.waitForFunction((b: string[]) => Object.keys((window as any).editorAPI.editors()).some((p) => !b.includes(p)), before);
  const ids = await paneIds(page);
  const b = ids.find((x) => !before.includes(x))!;
  await page.waitForFunction((s: string) => !!document.querySelector(`${s} .blocks > .blk .blk-render > .latex-block`), paneSel(b));
  await idle(page);
  return [paneSel(ids.find((x) => x !== b)!), paneSel(b)];
}
const rectIn = (page: any, sel: string, id: string, part = ''): Promise<R | null> => page.evaluate(([s, i, p]: string[]) => {
  const e = document.querySelector(`${s} .blocks > .blk[data-id="${i}"]${p}`); return e ? e.getBoundingClientRect().toJSON() : null;
}, [sel, id, part]);
const colOf = (page: any, sel: string): Promise<R> => page.evaluate((s: string) => document.querySelector(`${s} .blocks`)!.getBoundingClientRect().toJSON(), sel);
const bandOf = (page: any, sel: string): Promise<{ top: number; bottom: number; left: number; right: number }> => page.evaluate((s: string) => {
  const m = document.querySelector(s) as HTMLElement, r = m.getBoundingClientRect();
  return { top: r.top + (parseFloat(getComputedStyle(m).scrollPaddingTop) || 0), bottom: Math.min(r.bottom, innerHeight), left: r.left, right: r.right };
}, sel);
/** put block `id` `dy` px below pane `sel`'s band top */
const toTop = (page: any, sel: string, id: string, dy = 140) => page.evaluate(([s, i, d]: any) => {
  const sc = document.querySelector(s) as HTMLElement, el = sc.querySelector(`.blk[data-id="${i}"]`)!;
  sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0) - d;
}, [sel, id, dy]);
/** the y between two neighbouring blocks in a pane */
async function gap(page: any, sel: string, above: string, below: string): Promise<number> {
  const a = (await rectIn(page, sel, above))!, b = (await rectIn(page, sel, below))!;
  return (a.bottom + b.top) / 2;
}
/** what a drag can leave behind */
const leftovers = (page: any) => page.evaluate(() => ({
  transformed: [...document.querySelectorAll('.blk')].filter((e) => (e as HTMLElement).style.transform || (e as HTMLElement).style.transition).length,
  dimmed: document.querySelectorAll('.blk.dragging').length,
  previews: document.querySelectorAll('.blk-drag-ghost').length,
  lines: document.querySelectorAll('#drop-line').length,
  cursors: [...document.querySelectorAll('.g-handle')].filter((e) => (e as HTMLElement).style.cursor).length,
  held: document.querySelectorAll('.rtx-editor[data-dragging]').length,
  layers: document.querySelectorAll('.ui-layer').length,
}));
type Left = Awaited<ReturnType<typeof leftovers>>;
const clean = (a: Left, base: Left) => a.transformed <= base.transformed && !a.dimmed && !a.previews && !a.lines && !a.cursors && !a.held && a.layers <= base.layers;

/** the recorder: per pointer move (after the drag's own handler), the pointer, the preview's copy of the first
 *  render, the line, the handle's cursor */
const record = (page: any) => page.evaluate(() => {
  const w = window as any;
  w.__rec = [];
  if (w.__recFn) removeEventListener('pointermove', w.__recFn);
  w.__recFn = (e: PointerEvent) => {
    const c = document.querySelector('.blk-drag-ghost-ink > .blk-render'), l = document.getElementById('drop-line');
    const r = c?.getBoundingClientRect();
    w.__rec.push({ x: e.clientX, y: e.clientY, gx: r?.left ?? null, gy: r?.top ?? null, line: !!l && getComputedStyle(l).visibility === 'visible',
      ly: l ? new DOMMatrix(getComputedStyle(l).transform).m42 : null, cur: (document.querySelector('.g-handle[style*="cursor"]') as HTMLElement | null)?.style.cursor ?? '' });
  };
  addEventListener('pointermove', w.__recFn);
});
const recorded = (page: any): Promise<{ x: number; y: number; gx: number | null; gy: number | null; line: boolean; ly: number | null; cur: string }[]> =>
  page.evaluate(() => { const w = window as any; removeEventListener('pointermove', w.__recFn); w.__recFn = null; return w.__rec; });

/** press block `id`'s handle in pane `sel`; returns the press point and the block's render box then */
async function press(page: any, sel: string, id: string): Promise<{ at: Pt; render: R }> {
  const head = await page.evaluate(([s, i]: string[]) => !!document.querySelector(`${s} .blk.nest-head[data-id="${i}"]`), [sel, id]);
  // a container: its bracket shows its handle; a block: its text
  if (head) await page.hover(`${sel} .blk[data-id="${id}"] > .nest-bracket`);
  else await page.hover(`${sel} .blk[data-id="${id}"] .blk-render`, { position: { x: 30, y: 8 } });
  const h = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] > .gutter .g-handle`)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, [sel, id]);
  const render = (await rectIn(page, sel, id, ' > .blk-main > .blk-render'))!;   // (a container: none of its own)
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  return { at: h, render };
}
/** the pointer to `to` in small steps (≤ 8 px) */
async function glideTo(page: any, from: Pt, to: Pt, step = 8): Promise<Pt> {
  const n = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
  await page.mouse.move(to.x, to.y, { steps: n });
  await frames(page);                     // the drag places its line once a frame: a hand resting there sees it
  return to;
}
const frames = (page: any, n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
/** the preview kept the grab: its copy's corner = the render's corner at the press + the pointer's way (±1 px) */
function follows(rec: Awaited<ReturnType<typeof recorded>>, p: { at: Pt; render: R }) {
  const shown = rec.filter((r) => r.gx != null);
  const dev = Math.max(0, ...shown.map((r) => Math.max(Math.abs(r.gx! - (p.render.left + r.x - p.at.x)), Math.abs(r.gy! - (p.render.top + r.y - p.at.y)))));
  return { ok: shown.length > 3 && dev <= 1, shown: shown.length, of: rec.length, dev: +dev.toFixed(2) };
}
/** the preview at this moment: on top of everything at its drawn corner, masked, catching no pointer */
const previewState = (page: any, pt: Pt) => page.evaluate((p: Pt) => {
  const g = document.querySelector('.blk-drag-ghost') as HTMLElement | null, body = document.querySelector('.blk-drag-ghost-body') as HTMLElement | null;
  const ink = document.querySelector('.blk-drag-ghost-ink') as HTMLElement | null, paper = document.querySelector('.blk-drag-ghost-paper') as HTMLElement | null;
  if (!g || !body) return null;
  const cs = getComputedStyle(g), r = body.getBoundingClientRect();
  const under = document.elementFromPoint(p.x, p.y);
  g.style.pointerEvents = 'auto'; body.style.pointerEvents = 'auto'; g.inert = false;   // (inert is not hit either)
  const corner = { x: r.left + 14, y: r.top + 10 }, mid = { x: r.left + r.width * 0.3, y: r.top + Math.min(r.height * 0.3, 24) };
  const top = [corner, mid].every((q) => q.x < 0 || q.x > innerWidth || g.contains(document.elementFromPoint(q.x, q.y)));
  g.style.pointerEvents = ''; body.style.pointerEvents = ''; g.inert = true;
  const maskOf = (e: HTMLElement | null) => { if (!e) return ''; const c = getComputedStyle(e); return c.maskImage || (c as any).webkitMaskImage || ''; };
  const faded = (m: string) => /gradient.*gradient/.test(m);
  return { top, passThrough: cs.pointerEvents === 'none' && !g.contains(under), masked: faded(maskOf(ink)) && faded(maskOf(paper)), inert: g.inert || g.hasAttribute('inert'),
    w: r.width, h: r.height, bg: paper ? getComputedStyle(paper).backgroundColor : '', z: cs.zIndex, inBody: g.closest('.wb-root') === null };
}, pt);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (B of BROWSERS) {
  const CHROMIUM = B === 'chromium';

  // ── one pane: a short move, the preview, the source dimmed in place; the block's own place: no line; a click: the menu ──
  if (section('one-pane')) {
    const { page, close } = await open();
    const A = paneSel((await paneIds(page))[0]!);
    const base = await leftovers(page);
    const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const ids0 = await order(page);
    const X = top[1].id, i = ids0.indexOf(X), next = ids0[i + 1]!, after = ids0[i + 2]!;
    await toTop(page, A, X, 160); await idle(page);
    await record(page);
    const p = await press(page, A, X);
    let at = await glideTo(page, p.at, { x: p.at.x + 6, y: p.at.y + 10 });
    const mid = await page.evaluate((x: string) => ({ dim: [...document.querySelectorAll(`.blk[data-id="${x}"]`)].map((e) => getComputedStyle(e).opacity), line: getComputedStyle(document.getElementById('drop-line')!).visibility }), X);
    check('one pane: past the threshold the block stays in place, dimmed; on its own place no drop line', mid.dim.length > 0 && mid.dim.every((o: string) => +o < 0.6) && mid.line === 'hidden', mid);
    const y = await gap(page, A, next, after), col = await colOf(page, A);
    at = await glideTo(page, at, { x: col.left + 6, y });
    const over = await page.evaluate(() => ({ line: getComputedStyle(document.getElementById('drop-line')!).visibility, cursor: (document.querySelector('.g-handle[style*="cursor"]') as HTMLElement | null)?.style.cursor ?? '' }));
    check('one pane: resting over a place, the drop line shows there and the cursor says grabbing', over.line === 'visible' && over.cursor === 'grabbing', over);
    const st = await previewState(page, at);
    check('one pane: the preview is above everything, masked (the fade), inert, catches no pointer, in a layer outside the workbench', !!st && st.top && st.passThrough && st.masked && st.inert && st.inBody && +st.z >= 45, st);
    check('one pane: the preview is a handle on the block (capped: at most 560 × 128 px), on the page\'s background', !!st && st.w <= 560 && st.h <= 128 && st.bg !== 'rgba(0, 0, 0, 0)', st);
    await page.screenshot({ path: join(SHOTS, `${B}-one-pane-light.png`) });
    await page.mouse.up();
    await settled(page);
    const rec = await recorded(page);
    const f = follows(rec, p);
    check('one pane: the preview follows the pointer exactly (its corner at the pointer minus the grab, ±1 px)', f.ok, f);
    check('one pane: the cursor said grabbing all the way (over the pane)', rec.filter((r) => r.gx != null).every((r) => r.cur === 'grabbing'), rec.slice(-3));
    const ids1 = await order(page);
    check('one pane: dropped below the next block: the order is the new one', ids1.indexOf(X) === ids1.indexOf(next) + 1 && ids1.length === ids0.length, { X, i: ids1.indexOf(X), next: ids1.indexOf(next) });
    check('one pane: nothing the drag set is left (classes, transforms, cursor, root flag, layer)', clean(await leftovers(page), base), { now: await leftovers(page), base });
    // a short move on its own place: no line, a release changes nothing
    {
      const before = await order(page);
      const q = await press(page, A, X);
      await glideTo(page, q.at, { x: q.at.x + 5, y: q.at.y + 8 }, 2);
      const line = await page.evaluate(() => getComputedStyle(document.getElementById('drop-line')!).visibility);
      await page.mouse.up(); await settled(page);
      check('drop in place: no line on the block\'s own place; the release changes nothing and leaves nothing', line === 'hidden' && (await order(page)).join() === before.join() && clean(await leftovers(page), base), { line });
    }
    // a click on the handle (no move): the block's menu, as before
    {
      const q = await press(page, A, X);
      await page.mouse.up();
      const menu = await page.waitForFunction(() => !!document.querySelector('.block-menu:not(.doc-menu)'), null, { timeout: 5000 }).then(() => true, () => false);
      check('a click on the handle still opens the block\'s menu', menu);
      await page.keyboard.press('Escape');
      void q;
    }
    // Escape mid-drag: nothing changes, nothing left; the release after it does nothing (no menu)
    {
      const before = await order(page);
      const ids = await order(page), k = ids.indexOf(X);
      const q = await press(page, A, X);
      const y2 = await gap(page, A, ids[k + 1]!, ids[k + 2]!);
      const at2 = await glideTo(page, q.at, { x: (await colOf(page, A)).left + 6, y: y2 });
      const shown = await page.evaluate(() => getComputedStyle(document.getElementById('drop-line')!).visibility);
      await page.keyboard.press('Escape');
      await settled(page);
      await glideTo(page, at2, { x: at2.x + 20, y: at2.y + 30 });
      await page.mouse.up();
      await idle(page);
      const menu = await page.evaluate(() => !!document.querySelector('.block-menu'));
      check('Escape mid-drag (over a place with its line): nothing moves, the preview and line go, nothing left; the release after it opens no menu',
        shown === 'visible' && (await order(page)).join() === before.join() && clean(await leftovers(page), base) && !menu, { shown, menu, left: await leftovers(page) });
    }
    await close();
  }

  // ── one pane: a long move with autoscroll down, then up ──
  if (section('autoscroll')) {
    const { page, close } = await open();
    const A = paneSel((await paneIds(page))[0]!);
    const base = await leftovers(page);
    const ids0 = await order(page);
    const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const X = top[1].id;
    await toTop(page, A, X, 120); await idle(page);
    const band = await bandOf(page, A), col = await colOf(page, A);
    const s0 = await page.evaluate((s: string) => document.querySelector(s)!.scrollTop, A);
    const p = await press(page, A, X);
    let at = await glideTo(page, p.at, { x: col.left + 8, y: band.bottom - 6 });
    // held still at the edge: the pane scrolls by itself, smoothly (each frame a few px, never back), the line keeps up
    const steps: [number, number][] = await page.evaluate((s: string) => new Promise((done) => {
      const sc = document.querySelector(s)!, out: [number, number][] = [];
      let last = sc.scrollTop, t0 = 0;
      const f = (t: number) => { if (t0) out.push([sc.scrollTop - last, t - t0]); last = sc.scrollTop; t0 = t; if (out.length < 40) requestAnimationFrame(f); else done(out); };
      requestAnimationFrame(f);
    }), A);
    await page.waitForFunction(([s, t]: any) => document.querySelector(s)!.scrollTop > t + 500, [A, s0]);
    const moved = steps.filter(([d]) => d !== 0);
    // smooth: forward only, never faster than the top speed (1,400 px/s) for the frame's time; it starts gently (the dwell)
    check('autoscroll down: held near the bottom edge, the pane scrolls by itself, smoothly (forward only, within the top speed per frame, starting gently)',
      moved.length > 10 && moved.every(([d, dt]) => d > 0 && d <= 1400 * Math.min(dt, 50) / 1000 + 2) && moved[0]![0] <= 12, steps.map(([d]) => d));
    // back out of the edge zone: it stops; the line marks the place
    at = await glideTo(page, at, { x: col.left + 8, y: band.top + (band.bottom - band.top) / 2 });
    const s1 = await page.evaluate((s: string) => document.querySelector(s)!.scrollTop, A);
    const lineY: number = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('drop-line')!).transform).m42 + 1);
    // the block just below the line: the drop goes before it
    const below: string | null = await page.evaluate(([s, y]: any) => [...document.querySelectorAll(`${s} .blocks > .blk:not(.nest-head)`)].find((e) => e.getBoundingClientRect().top > y && e.getClientRects().length)?.getAttribute('data-id') ?? null, [A, lineY]);
    const s2 = await page.evaluate((s: string) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.querySelector(s)!.scrollTop)))), A);
    check('autoscroll stops once the pointer leaves the edge zone', Math.abs((s2 as number) - s1) < 2, { s1, s2 });
    await page.mouse.up(); await settled(page);
    let ids = await order(page);
    const at1 = below ? ids.indexOf(below) - 1 : ids.length - 1;   // (the line after the last block: the end)
    check('autoscroll down: dropped where the line was (before the block below it), far down', ids.indexOf(X) === at1 && ids.indexOf(X) > ids0.indexOf(X) + 3, { x: ids.indexOf(X), at1 });
    // and up: from there to near the top edge, held, then dropped
    const sUp = await page.evaluate((s: string) => document.querySelector(s)!.scrollTop, A);
    const q = await press(page, A, X);
    at = await glideTo(page, q.at, { x: col.left + 8, y: band.top + 6 });
    await page.waitForFunction(([s, t]: any) => document.querySelector(s)!.scrollTop < t - 500 || document.querySelector(s)!.scrollTop === 0, [A, sUp]);
    at = await glideTo(page, at, { x: col.left + 8, y: band.top + 160 });
    const lineY2: number = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('drop-line')!).transform).m42 + 1);
    const below2: string = await page.evaluate(([s, y]: any) => [...document.querySelectorAll(`${s} .blocks > .blk:not(.nest-head)`)].find((e) => e.getBoundingClientRect().top > y && e.getClientRects().length)!.getAttribute('data-id'), [A, lineY2]);
    const lineIn = lineY2 >= band.top && lineY2 <= band.bottom;
    await page.mouse.up(); await settled(page);
    ids = await order(page);
    check('autoscroll up: held near the top edge (below the glass) it scrolls up; dropped where the line was, the line inside the band', lineIn && ids.indexOf(X) === ids.indexOf(below2) - 1 && ids.indexOf(X) < at1 - 3, { lineY2, band, x: ids.indexOf(X), below2: ids.indexOf(below2) });
    check('autoscroll: nothing left', clean(await leftovers(page), base), await leftovers(page));
    await close();
  }

  // ── into a container (a proof's paragraphs: the indented place) and out of it ──
  if (section('container')) {
    const { page, close } = await open();
    const A = paneSel((await paneIds(page))[0]!);
    const n = (await api(page, 'blocks') as any[]).length;
    const pid = await api(page, 'insert', n - 2, 'proof', '\\begin{proof}\nThe first paragraph of the proof, long enough to wrap once or twice in a pane of this width at least.\n\nThe second paragraph of the proof, as long, so that the container has some room in it as well.\n\nThe last paragraph of the proof.\n\\end{proof}');
    await idle(page);
    await api(page, 'nestSplit', pid); await idle(page);
    const kids = (await api(page, 'blocks') as any[]).filter((b: any) => b.parentId === pid).map((b: any) => b.id);
    const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const ids00 = await order(page);
    const Z = ids00[ids00.indexOf(pid) - 1]!;                 // the block just above the proof
    await toTop(page, A, kids[0], 320); await idle(page);
    const p = await press(page, A, Z);
    const y = await gap(page, A, kids[0], kids[1]), col = await colOf(page, A);
    let at = await glideTo(page, p.at, { x: col.left + 40, y });
    const inside = await page.evaluate(() => document.getElementById('drop-line')!.classList.contains('nest-inside'));
    await page.mouse.up(); await settled(page);
    let bl = await api(page, 'blocks') as any[];
    const z1 = bl.find((b: any) => b.id === Z), ids = bl.map((b: any) => b.id);
    check('container: dropped indented between the proof\'s first two paragraphs: inside it, there (the line was the inside one)', inside && z1.parentId === pid && ids.indexOf(Z) === ids.indexOf(kids[0]) + 1, { inside, parent: z1.parentId, pid });
    // and out: between two top-level blocks above, not indented
    const ab = [ids[ids.indexOf(pid) - 2]!, ids[ids.indexOf(pid) - 1]!, null];   // the two blocks above the proof
    await toTop(page, A, kids[0], 320); await idle(page);
    const q = await press(page, A, Z);
    const y2 = await gap(page, A, ab[0]!, ab[1]!);
    at = await glideTo(page, q.at, { x: col.left + 4, y: y2 });
    await page.mouse.up(); await settled(page);
    bl = await api(page, 'blocks') as any[];
    const ids2 = bl.map((b: any) => b.id);
    check('container: dragged out between two top-level blocks: at the top level, there', !bl.find((b: any) => b.id === Z).parentId && ids2.indexOf(Z) === ids2.indexOf(ab[0]!) + 1, { parent: bl.find((b: any) => b.id === Z).parentId });
    // the container itself (its paragraphs with it): its preview shows them
    await toTop(page, A, kids[0], 300); await idle(page);
    const c = await press(page, A, pid);
    await glideTo(page, c.at, { x: c.at.x + 10, y: c.at.y - 40 });
    const copies = await page.evaluate(() => document.querySelectorAll('.blk-drag-ghost-ink > .blk-render').length);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settled(page);
    check('container: dragging the proof itself, its preview holds its paragraphs (from the top, capped)', copies >= 2, { copies });
    await close();
  }

  // ── two panes of one document: left/right and top/bottom; the preview over the splitter; undo ──
  for (const how of ['splitRight', 'splitDown'] as const) {
    const name = how === 'splitRight' ? 'split left/right' : 'split top/bottom';
    if (!section(how === 'splitRight' ? 'split-right' : 'split-down')) continue;
    for (const dark of CHROMIUM && how === 'splitRight' ? [false, true] : [false]) {
      const { page, close } = await open({ dark });
      const [A, Bp] = await split(page, how);
      const base = await leftovers(page);
      const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
      const ids0 = await order(page);
      const X = top[1].id, Y = top[top.length - 2].id, Yp = ids0[ids0.indexOf(Y) - 1]!;
      const band = await bandOf(page, A), bandB = await bandOf(page, Bp);
      await toTop(page, A, X, how === 'splitRight' ? 260 : 60); await toTop(page, Bp, Y, how === 'splitRight' ? 260 : 120); await idle(page);
      // reading positions: a block above the change in each pane
      // reading positions: in each pane the rows in view above the change (above X in A, above the place in B), X not one of them
      const above = (s: string, id: string, t: number) => page.evaluate(([s, i, t, x]: any) => {
        const els = [...document.querySelectorAll(`${s} .blocks > .blk:not(.nest-head)`)].filter((e) => e.getAttribute('data-id') !== x);
        const k = els.findIndex((e) => e.getAttribute('data-id') === i);
        return els.slice(0, k).filter((e) => e.getBoundingClientRect().bottom > t).map((e) => e.getAttribute('data-id'));
      }, [s, id, t, X]) as Promise<string[]>;
      const refsA = await above(A, X, band.top), refsB = await above(Bp, Y, bandB.top);
      const refA = refsA[0] ?? '', refB = refsB[0] ?? '';
      const topOf = async (s: string, id: string) => (id ? (await rectIn(page, s, id))!.top : 0);
      const tA0 = await topOf(A, refA), tB0 = await topOf(Bp, refB);
      await record(page);
      const p = await press(page, A, X);
      let at = await glideTo(page, p.at, { x: p.at.x + 20, y: p.at.y + 14 });
      if (!dark) await page.screenshot({ path: join(SHOTS, `${B}-${how}-one-pane-light.png`) });
      // over the splitter: between the panes
      const colB = await colOf(page, Bp);
      const sep = how === 'splitRight' ? { x: (band.right + bandB.left) / 2, y: at.y } : { x: at.x, y: (band.bottom + bandB.top) / 2 };
      at = await glideTo(page, at, sep);
      const overSep = await previewState(page, at);
      await page.screenshot({ path: join(SHOTS, `${B}-${how}-over-splitter-${dark ? 'dark' : 'light'}.png`) });
      check(`${name}${dark ? ' (dark)' : ''}: over the splitter the preview is drawn whole and on top, masked, catching no pointer`, !!overSep && overSep.top && overSep.passThrough && overSep.masked, overSep);
      // into pane B, at the place before Y
      const yB = await gap(page, Bp, Yp, Y);
      at = await glideTo(page, at, { x: colB.left + 6, y: yB });
      const inB = await previewState(page, at);
      const line = await page.evaluate(() => { const l = document.getElementById('drop-line')!; return { v: getComputedStyle(l).visibility, x: new DOMMatrix(getComputedStyle(l).transform).m41 }; });
      check(`${name}${dark ? ' (dark)' : ''}: in the other pane the preview is on top; the drop line is drawn in that pane's column`, !!inB && inB.top && line.v === 'visible' && Math.abs(line.x - colB.left) < 2, { inB, line, colB: colB.left });
      if (!dark || true) await page.screenshot({ path: join(SHOTS, `${B}-${how}-in-other-pane-${dark ? 'dark' : 'light'}.png`) });
      await page.mouse.up();
      await settled(page);
      const rec = await recorded(page);
      const f = follows(rec, p);
      check(`${name}${dark ? ' (dark)' : ''}: the preview follows the pointer exactly from pane to pane (±1 px)`, f.ok, f);
      const ids1 = await order(page);
      const lists = await page.evaluate((sels: string[]) => sels.map((s) => [...document.querySelectorAll(`${s} .blocks > .blk`)].map((e: any) => e.dataset.id).join()), [A, Bp]);
      check(`${name}${dark ? ' (dark)' : ''}: dropped in the other pane before Y: the order is the new one, in both panes`, ids1.indexOf(X) === ids1.indexOf(Y) - 1 && lists[0] === ids1.join() && lists[1] === ids1.join(), { x: ids1.indexOf(X), y: ids1.indexOf(Y) });
      const tA1 = await topOf(A, refA), tB1 = await topOf(Bp, refB);
      check(`${name}${dark ? ' (dark)' : ''}: the reading positions hold in both panes (the topmost row in view above each change, within 1 px)`, !!refB && Math.abs(tA1 - tA0) <= 1 && Math.abs(tB1 - tB0) <= 1, { refA, refB, tA0, tA1, tB0, tB1 });
      const l = await leftovers(page);
      check(`${name}${dark ? ' (dark)' : ''}: nothing the drag set is left in either pane`, clean(l, base), { l, base });
      if (!dark) {
        // the drop as the reader sees it: a frame later, both panes
        await page.screenshot({ path: join(SHOTS, `${B}-${how}-after-drop.png`) });
        await api(page, 'undo'); await idle(page);
        check(`${name}: undo after the move between panes restores the order (both panes)`, (await order(page)).join() === ids0.join() &&
          (await page.evaluate((sels: string[]) => sels.map((s) => [...document.querySelectorAll(`${s} .blocks > .blk`)].map((e: any) => e.dataset.id).join()), [A, Bp])).every((x: string) => x === ids0.join()));
      }
      await close();
    }
  }

  // ── no drop: a side column, the tab strip, another document's pane ──
  if (section('no-drop')) {
    const { page, close } = await open();
    const A = paneSel((await paneIds(page))[0]!);
    // another document beside it, in a group of its own
    const second = await page.evaluate(async () => {
      const s = (window as any).editorAPI.store();
      return s.createDoc({ title: 'Second', preamble: '\\documentclass{article}', blocks: [{ kind: 'heading', source: '\\section{One}' }, ...Array.from({ length: 8 }, (_, i) => ({ kind: 'paragraph', source: `Paragraph ${i + 1} of the second document, long enough to take a line or two of the pane it is in.` }))] });
    });
    await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    await page.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2);
    await page.evaluate((id: string) => { const wb = (window as any).editorAPI.workbench(); wb.replace(wb.current.peek().tab.id, { view: 'document', state: { doc: id } }); }, second);
    await page.waitForFunction(() => document.querySelectorAll('main.rtx-pane').length === 2 && [...document.querySelectorAll('main.rtx-pane')].every((m) => m.querySelector('.blocks > .blk .latex-block')));
    await idle(page);
    const panes = await page.evaluate(() => [...document.querySelectorAll('main.rtx-pane')].map((m) => ({ id: (m as HTMLElement).dataset.pane, r: m.getBoundingClientRect().toJSON() })));
    const other = panes.find((q: any) => paneSel(q.id) !== A)!;
    const O = paneSel(other.id);
    const editors = await page.evaluate(() => Object.keys((window as any).editorAPI.editors()));
    const orderOf = (pane: string) => page.evaluate((t: string) => (window as any).editorAPI.forPane(t).blocks().map((b: any) => b.id).join(), pane);
    const aId = (await paneIds(page)).find((x) => paneSel(x) === A)!;
    const o0 = await orderOf(aId), p0 = await orderOf(other.id);
    const base = await leftovers(page);
    const top = (await page.evaluate((t: string) => (window as any).editorAPI.forPane(t).blocks(), aId) as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const X = top[1].id;
    await toTop(page, A, X, 200); await idle(page);
    const oBlk: R = await page.evaluate((s: string) => { const e = [...document.querySelectorAll(`${s} .blocks > .blk`)][3]!; return e.getBoundingClientRect().toJSON(); }, O);
    const side: Pt = await page.evaluate(() => { const e = document.querySelector('.wb-side-body, .sb-panel') as HTMLElement | null; const r = e!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const strip: Pt = await page.evaluate((s: string) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; }, A);
    const spots: [string, Pt][] = [['another document\'s pane', { x: oBlk.left + 30, y: oBlk.top + oBlk.height / 2 }], ['a side column', side], ['the tab strip', strip]];
    for (const [where, pt] of spots) {
      const p = await press(page, A, X);
      let at = await glideTo(page, p.at, { x: p.at.x + 12, y: p.at.y + 30 });
      at = await glideTo(page, at, pt);
      at = await glideTo(page, at, { x: pt.x + 3, y: pt.y + 2 }, 1);
      const st = await page.evaluate(() => ({ line: getComputedStyle(document.getElementById('drop-line')!).visibility, cursor: (document.querySelector('.g-handle[style*="cursor"]') as HTMLElement | null)?.style.cursor ?? '' }));
      const pv = await previewState(page, at);
      if (where === 'another document\'s pane') await page.screenshot({ path: join(SHOTS, `${B}-no-drop-other-document.png`) });
      await page.mouse.up(); await settled(page);
      const o1 = await orderOf(aId), p1 = await orderOf(other.id);
      check(`no drop over ${where}: no drop line, the cursor says no drop, the preview on top; the release changes neither document and leaves nothing`,
        st.line === 'hidden' && st.cursor === 'no-drop' && !!pv?.top && o1 === o0 && p1 === p0 && clean(await leftovers(page), base), { st, same: [o1 === o0, p1 === p0], left: await leftovers(page), editors });
    }
    await close();
  }

  // ── Chromium: no long task per move, no layout per move from the preview ──
  if (CHROMIUM && section('perf')) {
    const { page, ctx, close } = await open();
    const [A, Bp] = await split(page, 'splitRight');
    const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const X = top[2].id;
    await toTop(page, A, X, 260); await idle(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m: any) => m.name === 'LayoutCount').value as number;
    await page.evaluate(() => { const w = window as any; w.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
    const p = await press(page, A, X);
    let at = await glideTo(page, p.at, { x: p.at.x + 20, y: p.at.y + 20 });
    const colB = await colOf(page, Bp);
    at = await glideTo(page, at, { x: colB.left + 100, y: at.y + 60 });
    // 40 moves inside pane B (the line on one place or the next), then 40 over the side column (no pane)
    const l0 = await layouts();
    for (let k = 0; k < 40; k++) { at = { x: at.x + (k % 2 ? -3 : 3), y: at.y + 1 }; await page.mouse.move(at.x, at.y); }
    const l1 = await layouts();
    const side: Pt = await page.evaluate(() => { const r = (document.querySelector('.wb-side-body, .sb-panel') as HTMLElement).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    at = await glideTo(page, at, side);
    const l2 = await layouts();
    for (let k = 0; k < 40; k++) { at = { x: at.x + (k % 2 ? -3 : 3), y: at.y + 1 }; await page.mouse.move(at.x, at.y); }
    const l3 = await layouts();
    const lt: number[] = await page.evaluate(() => (window as any).__lt.slice());
    await page.mouse.up(); await settled(page);
    check('perf: no long task (over 50 ms) while dragging: the start, the moves, across the panes', lt.length === 0, { longTasks: lt });
    check('perf: no layout per move from the preview (40 moves over a side column: no layout; 40 in a pane: a few for the line, not one a move)', l3 - l2 <= 1 && l1 - l0 <= 4, { inPane: l1 - l0, overSide: l3 - l2 });
    await close();
  }

  // ── Chromium: a phone's width, a touch drag by the handle in one pane ──
  if (CHROMIUM && section('phone')) {
    const { page, ctx, close } = await open({ width: 390, height: 844, touch: true });
    const A = paneSel((await paneIds(page))[0]!);
    const base = await leftovers(page);
    const ids0 = await order(page);
    const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const X = top[1].id, i = ids0.indexOf(X), next = ids0[i + 1]!, after = ids0[i + 2]!;
    await toTop(page, A, X, 160); await idle(page);
    // the handle shows on a focused block (the narrow pane's floating bar)
    await page.evaluate(([s, x]: string[]) => (document.querySelector(`${s} .blk[data-id="${x}"] .blk-render`) as HTMLElement).focus(), [A, X]);
    const h: Pt = await page.evaluate(([s, x]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${x}"] > .gutter .g-handle`)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, [A, X]);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type: string, p: Pt | null) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touch('touchStart', h);
    const yTo = await gap(page, A, next, after);
    let cur = h;
    const to = { x: h.x + 10, y: yTo };
    const n = Math.ceil(Math.hypot(to.x - h.x, to.y - h.y) / 6);
    for (let k = 1; k <= n; k++) { cur = { x: h.x + ((to.x - h.x) * k) / n, y: h.y + ((to.y - h.y) * k) / n }; await touch('touchMove', cur); }
    const mid = await page.evaluate(() => ({ preview: !!document.querySelector('.blk-drag-ghost'), line: getComputedStyle(document.getElementById('drop-line') ?? document.body).visibility }));
    await page.screenshot({ path: join(SHOTS, `${B}-phone-touch.png`) });
    await touch('touchEnd', null);
    await settled(page);
    const ids1 = await order(page);
    check('phone width, touch: the handle drag shows the preview and the line, and moves the block below the next one', mid.preview && mid.line === 'visible' && ids1.indexOf(X) === ids1.indexOf(next) + 1, { mid, x: ids1.indexOf(X), next: ids1.indexOf(next) });
    check('phone width, touch: nothing left', clean(await leftovers(page), base), await leftovers(page));
    await close();
  }
}

check('no page errors', !problems.length, problems.slice(0, 5));
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
