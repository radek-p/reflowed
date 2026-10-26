// PANES: two panes of one document (the workbench's split: a second group, the same document) are equal. The same
// checks run against pane A and pane B: an outline jump lands in the focused pane; a press on a pane's tab focuses
// it; a container's head (bracket, fold) in both, folded from either; the block decor equal in both; an editor in
// each at once (two blocks); find and keyboard selection act in the focused pane; a compile above holds both panes'
// places; drag both ways; no element ever moves between the panes (each element keeps its pane, from the split's
// opening to its end); live-text numbers equal (engine).
// (section 'close') closing the other pane (its tab's close button, or ⌘⌥W in it) leaves one working pane: the one
// worked in, with its scroll, editor (text, selection, undo), caret line and section focus; the closed pane's
// editor and views gone.
// (section 'carets') an editor in each pane: the focused one's carets blink together, the other's stay still and dimmed.
// (section 'leak') a pane opened (an editor in it) and closed 50 times: listeners, observers, editors, DOM nodes,
// viewer blocks and the heap stay flat.
// Waits on editorAPI.whenIdle(), events and DOM state, never on fixed times.
//
//   node tests/test-panes.ts [http://localhost:8151/] [--only <regex>]   (a dev server: tests/integration/serve.ts)
// Results: test-results/panes/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { paneA, paneIds, paneSel, splitB, idOf } from './qa/lib/panes.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'panes');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8151/';
const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]) : null;
const section = (name: string) => !ONLY || ONLY.test(name);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
const URL = '?seed=sample&engine&store=memory#/doc/sample';
// the panes by place: their selectors (SEL) and tab ids (PID); pane A the document's first tab, pane B the split's
const SEL: Record<string, string> = {}, PID: Record<string, string> = {};
const PANES = ['a', 'b'];
const other = (p: string) => (p === 'a' ? 'b' : 'a');
async function open({ width = 1600, height = 900, init = null as null | (() => void) } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(180000);
  await page.goto(BASE + URL);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  SEL.a = await paneA(page); PID.a = idOf(SEL.a); delete SEL.b; delete PID.b;
  return { ctx, page };
}
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (page: any, n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
const api = (page: any, name: string, ...args: any[]) => page.evaluate(([n, a]: any) => (window as any).editorAPI[n](...a), [name, args]);

async function openSplit(page: any) {
  SEL.b = await splitB(page); PID.b = idOf(SEL.b);
  await idle(page);
  await frames(page);
}
/** after a pane closed: the one left is pane A */
async function onePane(page: any) {
  const ids = await paneIds(page);
  SEL.a = paneSel(ids[0]!); PID.a = ids[0]!; delete SEL.b; delete PID.b;
  return ids;
}
/** mark every block element with the pane it is in (a property: survives class and attribute changes) */
const tag = (page: any) => page.evaluate((sels: string[]) => { for (const s of sels) for (const el of document.querySelectorAll(`${s} .blocks > .blk`)) (el as any).__pane ??= s; }, [SEL.a, SEL.b]);
/** no element is in another pane than the one it was made in; the elements tagged then are still there */
const identity = (page: any) => page.evaluate((sels: string[]) => {
  const out: string[] = [];
  let kept = 0;
  for (const s of sels) for (const el of document.querySelectorAll(`${s} .blocks > .blk`)) {
    const t = (el as any).__pane;
    if (t && t !== s) out.push(`${(el as HTMLElement).dataset.id?.slice(-5)} made in ${t}, now in ${s}`);
    if (t) kept++;
  }
  return { moved: out, kept, mirrors: document.querySelectorAll('.blk-mirror').length };
}, [SEL.a, SEL.b]);
/** each block's decor in a pane: its classes and data that are the block's (not the view's own) */
const VIEW_ONLY = /^(selected|editing|g-hot|rtx-float|sf-out|dragging|nest-active|nest-show|landed|flash|incoming|morphing)$/;
const decor = (page: any, p: string) => page.evaluate(([s, re]: string[]) => {
  const rx = new RegExp(re);
  return [...document.querySelectorAll(`${s} .blocks > .blk`)].map((el: any) => [el.dataset.id, [...el.classList].filter((c: string) => !rx.test(c)).sort().join(' '),
    ['kind', 'state', 'role', 'parent', 'marker', 'tex'].map((k) => `${k}=${el.dataset[k] ?? ''}`).join(','), el.style.marginTop]);
}, [SEL[p], VIEW_ONLY.source]);
/** put block `id` at `dy` px below pane p's reading top (below the glass bar and strip: its scroll-padding-top) */
const toTop = (page: any, p: string, id: string, dy = 140) => page.evaluate(([s, i, d]: any) => {
  const sc = document.querySelector(s) as HTMLElement, el = sc.querySelector(`.blk[data-id="${i}"]`)!;
  sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0) - d;
}, [SEL[p], id, dy]);
/** a press in pane p's margin (the pane itself, beside its blocks; not a group's sash): the pane is the focused one */
async function focusPane(page: any, p: string) {
  const pt = await page.evaluate((s: string) => {
    const m = document.querySelector(s)!, r = m.getBoundingClientRect(), y = r.top + r.height * 0.6;
    let x = Math.ceil(r.left);
    while (x < r.right && document.elementFromPoint(x, y) !== m) x++;
    let end = x;
    while (end < r.right && document.elementFromPoint(end, y) === m) end++;
    return end > x ? { x: (x + end - 1) / 2, y } : null;   // the middle of the margin's run
  }, SEL[p]);
  if (!pt) throw new Error(`pane ${p}: no margin to press`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((pp: string) => (window as any).editorAPI.layout().focused.value === pp, PID[p]);
}
const clickRender = async (page: any, p: string, id: string, fx = 0.5) => {
  const r = await page.evaluate(([s, i, f]: any) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + r.width * f, y: r.top + 12 }; }, [SEL[p], id, fx]);
  await page.mouse.click(r.x, r.y);
};
const waitSession = (page: any, p: string, id: string) => page.waitForFunction(([pp, i]: string[]) => (window as any).editorAPI.sessions().some((s: any) => s.pane === pp && s.id === i), [PID[p], id]);
const shownIn = (page: any, id: string, word: string) => page.waitForFunction(([i, w, sels]: any) => sels.every((s: string) =>
  [...document.querySelectorAll(`${s} .blk[data-id="${i}"] .blk-render > .latex-block:not(.incoming) svg tspan`)].map((x) => x.textContent).join('').includes(w)), [id, word, [SEL.a, SEL.b]], { timeout: 60000 });
/** both panes' anchor keepers at rest (a scroll ended, nothing put off): what they hold from here is the reader's place */
const keepersRest = (page: any) => page.waitForFunction((ids: string[]) => ids.every((p) => !(window as any).editorAPI.keeper(p)?.stats().ticking), [PID.a, PID.b]);

// ── the sample on the engine: two equal panes ────────────────────────────────────────────────────────────────────
if (section('symmetry')) {
  const { ctx, page } = await open();
  // a container: a proof of three paragraphs, split
  const n = (await api(page, 'blocks')).length;
  const pid = await api(page, 'insert', n - 2, 'proof', '\\begin{proof}\nThe first paragraph of the proof, long enough to wrap once or twice in a pane of this width at least.\n\nThe second paragraph of the proof, as long, so that the container has some room in it as well.\n\nThe last paragraph of the proof.\n\\end{proof}');
  await idle(page);
  await api(page, 'nestSplit', pid);
  await idle(page);
  await openSplit(page);
  await tag(page);
  const blocks = await api(page, 'blocks') as any[];
  const outline = await api(page, 'outline') as any[];
  const heads = outline.filter((it: any) => !it.special);
  const paras = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container && b.source.length > 120).map((b: any) => b.id);

  // the same blocks, the same decor, in both panes
  {
    const [da, db] = [await decor(page, 'a'), await decor(page, 'b')];
    const diff = da.map((x: any, k: number) => (JSON.stringify(x) === JSON.stringify(db[k]) ? null : { a: x, b: db[k] })).filter(Boolean);
    check('symmetry: both panes list every block, in order, with the same decor (classes, kind, state, nesting role, TeX spacing)', da.length === blocks.length && db.length === blocks.length && !diff.length, { n: blocks.length, a: da.length, b: db.length, diff: diff.slice(0, 3) });
    const hs = await page.evaluate((sels: string[]) => sels.map((x) => { const e = document.querySelector(x) as HTMLElement; return { h: e.scrollHeight, w: e.clientWidth, add: !!e.querySelector(':scope > .add-end-host .add-end') }; }), [SEL.a, SEL.b]);
    check('symmetry: the panes are the same: width, content height (±1 px), "Add a block" at the end of each', Math.abs(hs[0].w - hs[1].w) <= 1 && Math.abs(hs[0].h - hs[1].h) <= 1 && hs[0].add && hs[1].add, hs);
    const id0 = await identity(page);
    check('symmetry: no mirrors: each pane has its own view of each block', id0.mirrors === 0 && id0.kept === 2 * blocks.length, id0);
  }

  // a container's head in both panes: the bracket along its paragraphs in that pane's layout
  const nest = (await api(page, 'nest')) as any[];
  const box = nest.find((c: any) => c.id === pid);
  const geom = (p: string) => page.evaluate(([s, c, kids]: any) => {
    const head = document.querySelector(`${s} .blk[data-id="${c}"]`) as HTMLElement;
    const ks = kids.map((k: string) => document.querySelector(`${s} .blk[data-id="${k}"]`) as HTMLElement).filter((e: any) => e.offsetParent !== null);
    const hr = head.getBoundingClientRect(), f = ks[0].getBoundingClientRect(), l = ks[ks.length - 1].getBoundingClientRect();
    const br = head.querySelector('.nest-bracket')?.getBoundingClientRect();
    return { head: head.classList.contains('nest-head'), bracket: !!br && br.height > 10, fold: !!head.querySelector('.nest-toggle'), top: hr.top - f.top, bottom: hr.bottom - l.bottom, shown: ks.length,
      collapsed: head.classList.contains('nest-collapsed'), handle: head.querySelector('.g-handle')?.getAttribute('aria-label') ?? '' };
  }, [SEL[p], pid, box.children.map((c: any) => c.id)]);
  for (const p of PANES) {
    await toTop(page, p, box.children[0].id, 200); await idle(page); await frames(page);
    const g = await geom(p);
    check(`nesting [${p}]: the container's head, bracket and fold in pane ${p.toUpperCase()}, laid over its paragraphs there (±1 px)`, g.head && g.bracket && g.fold && Math.abs(g.top) <= 1 && Math.abs(g.bottom) <= 1 && /move or edit the whole environment/.test(g.handle), g);
  }
  for (const p of PANES) {
    // fold from pane p: both panes fold; unfold from the other pane
    await toTop(page, p, box.children[0].id, 200); await idle(page);
    await page.hover(`${SEL[p]} .blk[data-id="${box.children[1].id}"] .blk-render`);
    await page.click(`${SEL[p]} .blk[data-id="${pid}"] > .nest-toggle`);
    await idle(page); await frames(page);
    const [ga, gb] = [await geom('a'), await geom('b')];
    check(`nesting [${p}]: folded from pane ${p.toUpperCase()}: folded in both panes (one paragraph shown in each)`, ga.collapsed && gb.collapsed && ga.shown === 1 && gb.shown === 1, { ga, gb });
    const q = other(p);
    await toTop(page, q, box.children[0].id, 200); await idle(page);
    await page.hover(`${SEL[q]} .blk[data-id="${box.children[0].id}"] .blk-render`);
    await page.click(`${SEL[q]} .blk[data-id="${pid}"] > .nest-toggle`);
    await idle(page); await frames(page);
    const [ha, hb] = [await geom('a'), await geom('b')];
    check(`nesting [${p}]: unfolded from pane ${q.toUpperCase()}: open in both`, !ha.collapsed && !hb.collapsed && ha.shown === 3 && hb.shown === 3, { ha, hb });
  }

  // an outline jump lands in the focused pane; the other pane stays where it is
  for (const p of PANES) {
    const q = other(p);
    await toTop(page, q, paras[1], 100); await idle(page); await frames(page);
    await focusPane(page, p);
    const target = heads[heads.length - 1];
    const q0 = await page.evaluate((s: string) => (document.querySelector(s) as HTMLElement).scrollTop, SEL[q]);
    await page.click(`#panel-outline .ol-item[data-id="${target.id}"] .ol-link`);
    await idle(page); await frames(page, 3);
    const r = await page.evaluate(([s, i]: string[]) => { const sc = document.querySelector(s) as HTMLElement; return document.querySelector(`${s} .blk[data-id="${i}"]`)!.getBoundingClientRect().top - sc.getBoundingClientRect().top - (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0); }, [SEL[p], target.id]);
    const q1 = await page.evaluate((s: string) => (document.querySelector(s) as HTMLElement).scrollTop, SEL[q]);
    check(`outline [${p}]: a jump with pane ${p.toUpperCase()} focused brings the heading to its reading top (8 px), pane ${q.toUpperCase()} unmoved`, Math.abs(r - 8) <= 2 && Math.abs(q1 - q0) <= 1, { r, q0, q1 });
    const active = await page.evaluate(() => document.querySelector('#panel-outline .ol-item.active')?.getAttribute('data-id'));
    check(`outline [${p}]: the active entry follows the focused pane`, active === target.id, { active, want: target.id });
  }

  // a press on a pane's tab focuses that pane
  for (const p of PANES) {
    await focusPane(page, other(p));
    await page.click(`[data-tab="${PID[p]}"] [data-name], [data-tab="${PID[p]}"]:not(:has([data-name]))`);
    await page.waitForFunction((pp: string) => (window as any).editorAPI.layout().focused.value === pp, PID[p], { timeout: 5000 }).catch(() => {});
    const f = await page.evaluate(() => (window as any).editorAPI.layout().focused.value);
    check(`focus [${p}]: a press on pane ${p.toUpperCase()}'s tab focuses pane ${p.toUpperCase()}`, f === PID[p], { f, want: PID[p] });
  }

  // two editors at once, crossed: X in p and Y in q, typed in each, each result in both panes
  for (const p of PANES) {
    const q = other(p), X = paras[0], Y = paras[2];
    await toTop(page, p, X); await toTop(page, q, Y); await idle(page);
    await clickRender(page, p, X); await waitSession(page, p, X);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(` Word${p}one`);
    await clickRender(page, q, Y); await waitSession(page, q, Y);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[q]);
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(` Word${p}two`);
    await shownIn(page, X, `Word${p}one`); await shownIn(page, Y, `Word${p}two`);
    const st = await api(page, 'sessions') as any[];
    const pop = await page.evaluate(([a, b, x, y]: string[]) => ({ x: !!document.querySelector(`${a} .blk.editing[data-id="${x}"] .cm-editor`), y: !!document.querySelector(`${b} .blk.editing[data-id="${y}"] .cm-editor`) }), [SEL[p], SEL[q], X, Y]);
    check(`editing [${p}]: an editor in ${p.toUpperCase()} and one in ${q.toUpperCase()} at once, each popover on its own pane's view, each result in both panes`,
      st.length === 2 && st.every((s: any) => s.view === s.pane) && st.some((s: any) => s.pane === PID[p] && s.id === X) && st.some((s: any) => s.pane === PID[q] && s.id === Y) && pop.x && pop.y, { st: st.map((s: any) => `${s.pane}:${s.view}:${s.id.slice(-5)}`), pop });
    await api(page, 'leave');
    await idle(page);
    for (const id of [X, Y]) { const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === id); await api(page, 'setSource', id, b.source.replace(/ Word[ab](one|two)$/, '')); }
    await idle(page);
  }
  {
    const id1 = await identity(page);
    check('identity: after edits in both panes, folds and jumps, no element moved between the panes (none re-made)', !id1.moved.length && id1.kept === 2 * blocks.length, id1);
  }

  // find: the match opens in the focused pane (a word of one paragraph's, in no other block)
  const word = (() => {
    const all = (blocks as any[]).map((b) => b.source as string);
    for (const id of paras) for (const w of (blocks as any[]).find((b) => b.id === id).source.match(/[A-Za-z]{9,}/g) ?? []) if (all.filter((x) => x.includes(w)).length === 1) return w as string;
    return '';
  })();
  for (const p of PANES) {
    await focusPane(page, p);
    await page.keyboard.press('ControlOrMeta+f');
    await page.waitForSelector('.find-bar:not([hidden]) input');
    await page.keyboard.type(word);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).editorAPI.sessions().length === 1);
    const st = await api(page, 'sessions') as any[];
    check(`find [${p}]: with pane ${p.toUpperCase()} focused, the match opens in pane ${p.toUpperCase()}`, !!word && st[0]?.pane === PID[p] && st[0]?.view === PID[p], { word, st: st.map((s: any) => ({ pane: s.pane, view: s.view })) });
    await page.keyboard.press('Escape');
    await api(page, 'leave');
    await idle(page);
  }

  // keyboard selection: in the focused pane (its view takes the focus), shown there only (per pane);
  // the other pane's own selection is untouched
  for (const p of PANES) {
    await toTop(page, p, paras[1], 160); await idle(page);
    await focusPane(page, p);
    await page.keyboard.press('ArrowDown');
    const s = await page.evaluate(() => { const a = document.activeElement; return { in: (a?.closest('main.rtx-pane') as HTMLElement | null)?.dataset.pane ?? null, id: (a?.closest('.blk') as HTMLElement)?.dataset.id ?? null, sel: (window as any).editorAPI.selected() }; });
    const both = await page.evaluate(([i, sels]: any) => sels.map((x: string) => !!document.querySelector(`${x} .blk.selected[data-id="${i}"]`)), [s.sel, [SEL.a, SEL.b]]);
    const own = await page.evaluate(([mine, theirs]: string[]) => ({ mine: (window as any).editorAPI.selected(mine), other: (window as any).editorAPI.selected(theirs) }), [PID[p], PID[other(p)]]);
    check(`selection [${p}]: ↓ selects a block shown in pane ${p.toUpperCase()}, its view focused there; selected in that pane only`,
      s.in === PID[p] && s.id === s.sel && both[PANES.indexOf(p)] && !both[1 - PANES.indexOf(p)] && own.mine === s.sel && own.other !== s.sel, { ...s, both, own });
    await page.keyboard.press('Escape');
  }

  // a compile above holds both panes' places
  {
    const R = blocks[Math.floor(blocks.length * 0.7)].id, first = paras[0];
    for (const p of PANES) await toTop(page, p, R, 120);
    await keepersRest(page);
    const at = (i: string) => page.evaluate(([id, sels]: any) => sels.map((s: string) => document.querySelector(`${s} .blk[data-id="${id}"]`)!.getBoundingClientRect().top), [i, [SEL.a, SEL.b]]);
    const y0 = await at(R);
    const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === first);
    await api(page, 'setSource', first, `${b.source} ${'More words so that this paragraph gets several lines longer than it was before. '.repeat(4)}`);
    await idle(page); await keepersRest(page);
    const y1 = await at(R);
    check('anchoring: a block above typesetting again moves neither pane (within 1 px)', Math.abs(y1[0] - y0[0]) <= 1 && Math.abs(y1[1] - y0[1]) <= 1, { y0, y1 });
    await api(page, 'setSource', first, b.source);
    await idle(page);
  }

  // drag both ways: by the handle in one pane, dropped in the other; nothing moves between the panes
  for (const p of PANES) {
    const q = other(p);
    const top = (await api(page, 'blocks') as any[]).filter((b: any) => b.kind === 'paragraph' && !b.parentId && !b.container);
    const X = top[1].id, Y = top[top.length - 2].id;
    await toTop(page, p, X, 300); await toTop(page, q, Y, 300); await idle(page);
    await page.hover(`${SEL[p]} .blk[data-id="${X}"] .blk-render`);
    const hb = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] > .gutter .g-handle`)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, [SEL[p], X]);
    const tb = await page.evaluate(([s, i]: string[]) => { const col = document.querySelector(`${s} .blocks`)!.getBoundingClientRect(); const r = document.querySelector(`${s} .blk[data-id="${i}"]`)!.getBoundingClientRect(); return { x: col.left + 4, y: r.top - 2 }; }, [SEL[q], Y]);
    await page.mouse.move(hb.x, hb.y); await page.mouse.down();
    await page.mouse.move(hb.x + 30, hb.y + 20, { steps: 4 }); await page.mouse.move(tb.x, tb.y, { steps: 12 });
    await page.mouse.up();
    await page.evaluate(() => (window as any).editorAPI.dragSettled());
    await idle(page);
    const order = (await api(page, 'blocks') as any[]).map((b: any) => b.id);
    const id2 = await identity(page);
    const lists = await page.evaluate((sels: string[]) => sels.map((s) => [...document.querySelectorAll(`${s} .blocks > .blk`)].map((e: any) => e.dataset.id).join()), [SEL.a, SEL.b]);
    check(`drag [${p}→${q}]: dragged from pane ${p.toUpperCase()} into pane ${q.toUpperCase()}: lands there, both panes in the new order, no element moved between them`,
      order[order.indexOf(Y) - 1] === X && lists[0] === order.join() && lists[1] === order.join() && !id2.moved.length, { moved: id2.moved.slice(0, 3) });
  }
  // "Add a block" in pane B: a new block at the end, its editor in pane B
  {
    const n0 = (await api(page, 'blocks')).length;
    await page.evaluate((s: string) => { const e = document.querySelector(`${s} > .add-end-host .add-end`) as HTMLElement; e.scrollIntoView({ block: 'center' }); }, SEL.b);
    await page.click(`${SEL.b} > .add-end-host .add-end`);
    await page.waitForFunction(() => (window as any).editorAPI.sessions().length === 1);
    const st = await api(page, 'sessions') as any[];
    check('add [b]: pane B\'s "Add a block" adds a block at the end and opens it in pane B', (await api(page, 'blocks')).length === n0 + 1 && st[0].pane === PID.b && st[0].view === PID.b, st.map((s: any) => ({ pane: s.pane, view: s.view })));
    await api(page, 'leave'); await idle(page);
  }
  check('symmetry: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await page.screenshot({ path: join(OUT, 'symmetry.png') });
  await ctx.close();
}

// ── live text (numbers, references) in both panes, an edit in either (the engine) ───────────────────────────
if (section('numbers')) {
  const { ctx, page } = await open();
  await openSplit(page);
  const ids = await page.evaluate(() => (window as any).editorAPI.blocks().filter((b: any) => /^\\(sub)*section\{/.test(b.source.trim()) || /\\(c|C|auto|eq)?ref\{/.test(b.source)).map((b: any) => b.id));
  const read = (id: string) => page.evaluate(([i, sels]: any) => sels.map((s: string) => [...document.querySelectorAll(`${s} .blk[data-id="${i}"] .blk-render > .latex-block:not(.incoming) svg tspan`)].map((t) => t.textContent).join('').replace(/[\s­-]+/g, '')), [id, [SEL.a, SEL.b]]);
  const all = async () => { const out: string[][] = []; for (const id of ids) { for (const p of PANES) await toTop(page, p, id, 200); await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.()); out.push(await read(id)); } return out; };
  const t0 = await all();
  const differ0 = t0.filter(([a, b]) => a !== b);
  check('numbers: every heading and reference reads the same in both panes', ids.length > 3 && !differ0.length && t0.some(([a]) => /^\d/.test(a)), { n: ids.length, differ: differ0.slice(0, 3) });
  const heading = ids.find((_: string, k: number) => /^\d/.test(t0[k][0]));
  for (const p of PANES) {
    // a section inserted above it, typed in pane p's editor: both panes renumber
    const before = (await read(heading))[0];
    const at = await page.evaluate((i: string) => (window as any).editorAPI.blocks().findIndex((b: any) => b.id === i), heading);
    const nb = await page.evaluate(([k, pp]: any) => { const A = (window as any).editorAPI; const id = A.insert(k, 'paragraph', ''); A.editIn(pp, id, 0); return id; }, [at, PID[p]]);
    await waitSession(page, p, nb);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    await page.keyboard.type(`\\section{Inserted in ${p}}`);
    await page.keyboard.press('Escape');
    await idle(page);
    for (const q of PANES) await toTop(page, q, heading, 200);
    await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.());
    await page.waitForFunction(([i, sels, was]: any) => {
      const t = sels.map((s: string) => [...document.querySelectorAll(`${s} .blk[data-id="${i}"] .blk-render > .latex-block:not(.incoming) svg tspan`)].map((x) => x.textContent).join('').replace(/[\s­-]+/g, ''));
      return t[0] !== was && t[1] !== was;
    }, [heading, [SEL.a, SEL.b], before], { timeout: 30000 }).catch(() => {});
    const t = await read(heading);
    check(`numbers [${p}]: a section typed above in pane ${p.toUpperCase()} renumbers the heading in both panes alike`, t[0] === t[1] && t[0] !== before, { before: before.slice(0, 24), a: t[0].slice(0, 24), b: t[1].slice(0, 24) });
  }
  check('numbers: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

// ── closing the other pane leaves the one worked in: its scroll, editor, caret, undo, section focus ──
if (section('close')) {
  const { ctx, page } = await open();
  const blocks = await api(page, 'blocks') as any[];
  const outline = (await api(page, 'outline') as any[]).filter((it: any) => !it.special);
  // a heading whose section has a long paragraph (the editor's block), and a paragraph elsewhere (the other pane's)
  const idx = (id: string) => blocks.findIndex((b: any) => b.id === id);
  let H: any = null, X = '';
  for (let k = 0; k < outline.length && !X; k++) {
    const from = idx(outline[k].id), to = k + 1 < outline.length ? idx(outline[k + 1].id) : blocks.length;
    const p = blocks.slice(from + 1, to).find((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 160);
    if (p) { H = outline[k]; X = p.id; }
  }
  const Y = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 120 && b.id !== X).at(-1).id;
  for (const p of PANES) for (const via of ['button', 'key']) {
    const q = other(p), P = p.toUpperCase(), Q = q.toUpperCase();
    await openSplit(page);
    // pane p: its section focus on H (the key round), an editor on X with something typed (undo) and a selection;
    // pane q elsewhere, with its own editor on Y
    const sf = via === 'key';
    if (sf) await page.evaluate(([pp, h]: string[]) => (window as any).editorAPI.sectionFocus().set(pp, h), [PID[p], H.id]);
    await toTop(page, q, Y, 160); await idle(page);
    await clickRender(page, q, Y); await waitSession(page, q, Y);
    await toTop(page, p, X, 220); await idle(page); await frames(page);
    await clickRender(page, p, X); await waitSession(page, p, X);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Keptword');
    await idle(page); await frames(page);
    await page.evaluate((pp: string) => { const v = (window as any).editorAPI.editorView(pp); const n = v.state.doc.length; v.dispatch({ selection: { anchor: n - 30, head: n - 12 } }); }, PID[p]);
    await idle(page); await frames(page);
    const read = (pp: string) => page.evaluate((x: string) => {
      const A = (window as any).editorAPI, v = A.editorView(x);
      if (!v) return null;
      const sel = v.state.selection.main, c = v.coordsAtPos(sel.head);
      // (y from the pane's reading top: below the glass strip, which is one line lower with two groups; the text moves with it)
      const sc = document.querySelector(`main.rtx-pane[data-pane="${x}"]`) as HTMLElement, top = sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0);
      return { text: v.state.doc.toString(), from: sel.from, to: sel.to, y: c ? Math.round(c.top - top) : null, focus: v.hasFocus, heading: A.layout().pane(x)?.focus ?? null,
        atTop: sc.scrollTop <= 0 };
    }, pp);
    const before = await read(PID[p]);
    const keep = PID[p], gone = PID[q];
    if (via === 'button') {
      // the close button on pane q's tab (a press there is not in pane p's text: its editor keeps the focus)
      await page.click(`.wb-tab-close[data-close="${gone}"]`);
    } else {
      // the reader goes to pane q and closes it from the keyboard (the workbench's close: ⌘⌥W, Ctrl+Alt+W)
      await focusPane(page, q);
      await page.keyboard.press('ControlOrMeta+Alt+w');
    }
    await page.waitForFunction((t: string) => !(window as any).editorAPI.editors()[t] && !document.querySelector(`main.rtx-pane[data-pane="${t}"]`), gone);
    await idle(page); await frames(page, 3);
    const ids = await onePane(page);
    const after = await read(keep);
    const st = await api(page, 'sessions') as any[];
    const eds = await page.evaluate(() => Object.keys((window as any).editorAPI.editors()));
    const focused = await page.evaluate(() => (window as any).editorAPI.layout().focused.value);
    const sfOut = await page.evaluate((s: string) => [...document.querySelectorAll(`${s} .blocks > .blk`)].filter((e) => !e.classList.contains('sf-out')).map((e: any) => e.dataset.id), SEL.a);
    check(`close [${p}, ${via}]: pane ${Q} closed: one pane left, pane ${P}, focused; one editor, on pane ${P}'s block; pane ${Q}'s editor gone`,
      ids.length === 1 && ids[0] === keep && focused === keep && eds.join() === keep && st.length === 1 && st[0].id === X && st[0].pane === keep, { ids, keep, focused, eds, st: st.map((s: any) => `${s.pane}:${s.id.slice(-5)}`) });
    // (where the focus goes after a close is the workbench's: not checked here)
    check(`close [${p}, ${via}]: the editor goes on: the same text, selection`, !!after && after.text === before.text && after.from === before.from && after.to === before.to, { before: { ...before, text: before?.text.slice(-20) }, after: { ...after, text: after?.text.slice(-20) }, active: await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}.${a.className.toString().slice(0, 30)}` : null; }) });
    const dy = after?.y != null && before?.y != null ? after.y - before.y : null;
    // (the round with a section focus: the section is short, so the wider pane may not scroll as far as it did)
    check(`close [${p}, ${via}]: the caret's line stays where it was seen, from the pane's reading top, the pane wider now (±2 px${sf ? ', or higher with the pane at its top' : ''})`, dy != null && (Math.abs(dy) <= 2 || (sf && dy < 0 && !!after!.atTop)), { before: before?.y, after: after?.y, atTop: after?.atTop });
    if (sf) check(`close [${p}, ${via}]: pane ${P}'s section focus is kept (only H's section shown)`, after?.heading === H.id && sfOut.includes(H.id) && sfOut.includes(X) && !sfOut.includes(Y), { heading: after?.heading, want: H.id, shown: sfOut.length });
    else check(`close [${p}, ${via}]: no section focus in pane ${P}: none after`, after?.heading == null && sfOut.length === blocks.length, { heading: after?.heading, shown: sfOut.length, n: blocks.length });
    // its undo history is the pane's still
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), keep);
    await page.keyboard.press('ControlOrMeta+z');
    await idle(page);
    const undone = await read(keep);
    check(`close [${p}, ${via}]: its undo history is kept (⌘Z takes back what was typed in pane ${P})`, !!undone && !undone.text.includes('Keptword') && before!.text.includes('Keptword'), { tail: undone?.text.slice(-30) });
    await api(page, 'leave'); await idle(page);
    const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === X);
    if (/ Keptword$/.test(b.source)) { await api(page, 'setSource', X, b.source.replace(/ Keptword$/, '')); await idle(page); }
    await page.evaluate((pp: string) => (window as any).editorAPI.sectionFocus().set(pp, null), keep);
    await idle(page);
  }
  check('close: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

// ── an editor in each pane: the focused one's two carets blink together; the other's two stay, still and dimmed ──
if (section('carets')) {
  const { ctx, page } = await open();
  // (reduced motion keeps the carets steady: this section needs the blink)
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const blocks = await api(page, 'blocks') as any[];
  const paras = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 120).map((b: any) => b.id);
  await openSplit(page);
  const X = paras[0], Y = paras[2];
  await toTop(page, 'a', X); await toTop(page, 'b', Y); await idle(page);
  await clickRender(page, 'a', X); await waitSession(page, 'a', X);
  await clickRender(page, 'b', Y); await waitSession(page, 'b', Y);
  await idle(page);
  /** each pane's two carets on every frame for 1.5 blink periods: shown (display, visibility) and effective opacity */
  const sample = () => page.evaluate((sels: Record<string, string>) => new Promise((done) => {
    const eff = (el: Element | null) => {
      if (!el) return { shown: false, o: 0 };
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return { shown: false, o: 0 };
      let o = 1;
      for (let e: Element | null = el; e && !e.matches('.blk'); e = e.parentElement) o *= +getComputedStyle(e).opacity;
      return { shown: o > 0.05, o: Math.round(o * 100) / 100 };
    };
    const out: any[] = [], t0 = performance.now();
    const f = () => {
      const fr: any = {};
      for (const [p, s] of Object.entries(sels)) {
        const root = document.querySelector(`${s} .blk.editing`);
        fr[p] = { code: eff(root?.querySelector('.cm-cursor-primary') ?? null), preview: eff(root?.querySelector('.rtx-caret-bar') ?? null) };
      }
      out.push(fr);
      if (performance.now() - t0 < 1800) requestAnimationFrame(f); else done(out);
    };
    requestAnimationFrame(f);
  }), { a: SEL.a, b: SEL.b });
  for (const p of PANES) {
    const q = other(p), P = p.toUpperCase(), Q = q.toUpperCase();
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), PID[p]);
    await page.keyboard.press('ArrowRight');                  // a caret move: the blink starts again from here
    await idle(page);
    const fr = await sample() as any[];
    const agree = fr.filter((f) => f[p].code.shown !== f[p].preview.shown).length;
    const offs = fr.filter((f) => !f[p].code.shown).length, ons = fr.filter((f) => f[p].code.shown).length;
    check(`carets [${p}]: pane ${P} focused: its code and preview carets blink together (${ons} frames on, ${offs} off, ${agree} apart)`, agree === 0 && offs > 2 && ons > 2, { agree, ons, offs });
    const idleBad = fr.filter((f) => !f[q].code.shown || !f[q].preview.shown || f[q].code.o > 0.6 || f[q].preview.o > 0.6 || Math.abs(f[q].code.o - f[q].preview.o) > 0.01).length;
    check(`carets [${p}]: pane ${Q} (no focus): both its carets shown on every frame, still and dimmed alike`, idleBad === 0, { idleBad, of: fr.length, first: fr[0][q] });
  }
  check('carets: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

// ── a pane opened, an editor in it, the pane closed, 50 times: nothing it adds stays ────────────────────────────
if (section('leak')) {
  // the observers the page makes (resize, intersection, mutation), each held weakly while it observes: one a closed
  // pane left observing and something still holds is counted after a collection; one that went with its pane is not
  const observers = () => {
    const live = new Set<WeakRef<object>>();
    const w = window as any;
    for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
      const C = w[name];
      if (!C) continue;
      const Counted = class extends C {
        __ref = new WeakRef(this);
        observe(...a: unknown[]) { live.add(this.__ref); return super.observe(...a); }
        disconnect() { live.delete(this.__ref); return super.disconnect(); }
      };
      Object.defineProperty(Counted, 'name', { value: name });
      w[name] = Counted;
    }
    w.__observersLive = () => { let n = 0; for (const r of live) { if (r.deref()) n++; else live.delete(r); } return n; };
  };
  const { ctx, page } = await open({ width: 1440, height: 900, init: observers });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const count = async (expr: string) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
    return listeners.length;
  };
  const measure = async () => {
    for (let k = 0; k < 3; k++) await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));
    const own = await page.evaluate(() => {
      const A = (window as any).editorAPI;
      return { observers: (window as any).__observersLive(), editors: Object.keys(A.editors()).length, roots: A.editorRoots(), sessions: A.sessions().length,
        codemirrors: document.querySelectorAll('.cm-editor').length, viewer: (window as any).reflowtex?.host?.blocks?.().length ?? null,
        layers: document.querySelectorAll('.ui-layer, main.rtx-pane, [data-tab]').length };
    });
    return { document: await count('document'), window: await count('window'), listeners: m.JSEventListeners, nodes: m.Nodes, heap: Math.round(m.JSHeapUsedSize / 1024), ...own };
  };
  const blocks = await api(page, 'blocks') as any[];
  const E = blocks.filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 120)[0].id;
  const cycle = async () => {
    const t = idOf(await splitB(page));
    await page.evaluate(([pp, id]: string[]) => (window as any).editorAPI.editIn(pp, id, 0), [t, E]);
    await page.waitForFunction((pp: string) => (window as any).editorAPI.sessions().some((s: any) => s.pane === pp && s.view === pp), t);
    await idle(page);
    await page.evaluate((pp: string) => (window as any).editorAPI.workbench().close(pp), t);
    await page.waitForFunction((pp: string) => !(window as any).editorAPI.editors()[pp] && !document.querySelector(`main.rtx-pane[data-pane="${pp}"]`), t);
    await idle(page);
  };
  await page.mouse.click(5, 5);
  for (let k = 0; k < 3; k++) await cycle();
  const m0 = await measure();
  for (let k = 0; k < 50; k++) await cycle();
  const m1 = await measure();
  check('leak: 50 × a pane opened, an editor in it, closed: the same listeners on document and window', m1.document === m0.document && m1.window === m0.window, { m0, m1 });
  check('leak: … the same observers kept, one editor and its root, no editor session or CodeMirror left', m1.observers === m0.observers && m1.editors === 1 && m1.roots === m0.roots && m1.sessions === 0 && m1.codemirrors === m0.codemirrors,
    { observers: [m0.observers, m1.observers], editors: m1.editors, roots: [m0.roots, m1.roots], sessions: m1.sessions, codemirrors: [m0.codemirrors, m1.codemirrors] });
  check('leak: … the same number of event listeners in the page, viewer blocks and layers (no views left)', Math.abs(m1.listeners - m0.listeners) <= 4 && m1.viewer === m0.viewer && m1.layers === m0.layers, { listeners: [m0.listeners, m1.listeners], viewer: [m0.viewer, m1.viewer], layers: [m0.layers, m1.layers] });
  check('leak: … DOM nodes and the heap flat (nodes ±2 %, heap +3 MB at most)', m1.nodes <= m0.nodes * 1.02 + 20 && m1.heap - m0.heap <= 3 * 1024, { nodes: [m0.nodes, m1.nodes], heapKB: [m0.heap, m1.heap] });
  check('leak: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
console.log(`\n${passed}/${results.length} passed`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
