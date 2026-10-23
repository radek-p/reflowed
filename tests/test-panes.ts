// PANES: the two panes are equal. The same checks run against pane A and pane B: an outline jump lands in
// the focused pane; a container's head (bracket, fold) in both, folded from either; the block decor equal in
// both; an editor in each at once (two blocks, then the same one); find and keyboard selection act in the
// focused pane; a compile above holds both panes' places; drag both ways; no element ever moves between the
// panes (each element keeps its pane, from the split's opening to its end); live-text numbers equal (engine).
// (section 'close') closing split view from either pane keeps that pane: its scroll, editor (text, selection,
// undo), caret line and section focus.
// (section 'carets') an editor in each pane: the focused one's carets blink together, the other's stay still and dimmed.
// (milestone 3, section 'leak') open/close split 50 times: listeners, DOM nodes, viewer blocks and the heap stay flat.
// (section 'viewpane') a pane shows a registered view (Files) in a pane frame; Close; a document set on it; 50× open/close flat.
// Waits on editorAPI.whenIdle(), events and DOM state, never on fixed times.
//
//   node tests/test-panes.ts [http://localhost:8151/] [--only <regex>]   (a dev server: tests/integration/serve.ts)
// Results: test-results/panes/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

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
async function open(url: string, { width = 1600, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(180000);
  await page.goto(BASE + url);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  return { ctx, page };
}
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (page: any, n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
const SEL: Record<string, string> = { a: '#page', b: '#page-b' };
const PANES = ['a', 'b'];
const other = (p: string) => (p === 'a' ? 'b' : 'a');
const api = (page: any, name: string, ...args: any[]) => page.evaluate(([n, a]: any) => (window as any).editorAPI[n](...a), [name, args]);

async function openSplit(page: any) {
  await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
  await page.waitForSelector('#page-b .blocks > .blk .blk-render > .latex-block');
  await idle(page);
  await frames(page);
}
/** mark every block element with the pane it is in (a property: survives class and attribute changes) */
const tag = (page: any) => page.evaluate(() => { for (const p of ['a', 'b']) for (const el of document.querySelectorAll(`${p === 'a' ? '#page' : '#page-b'} .blocks > .blk`)) (el as any).__pane ??= p; });
/** no element is in another pane than the one it was made in; the elements tagged then are still there */
const identity = (page: any) => page.evaluate(() => {
  const out: string[] = [];
  let kept = 0;
  for (const p of ['a', 'b']) for (const el of document.querySelectorAll(`${p === 'a' ? '#page' : '#page-b'} .blocks > .blk`)) {
    const t = (el as any).__pane;
    if (t && t !== p) out.push(`${(el as HTMLElement).dataset.id?.slice(-5)} made in ${t}, now in ${p}`);
    if (t) kept++;
  }
  return { moved: out, kept, mirrors: document.querySelectorAll('.blk-mirror').length };
});
/** each block's decor in a pane: its classes and data that are the block's (not the view's own) */
const VIEW_ONLY = /^(selected|editing|g-hot|rtx-float|sf-out|dragging|lifted|nest-active|nest-show|landed|flash|incoming|morphing)$/;
const decor = (page: any, p: string) => page.evaluate(([s, re]: string[]) => {
  const rx = new RegExp(re);
  return [...document.querySelectorAll(`${s} .blocks > .blk`)].map((el: any) => [el.dataset.id, [...el.classList].filter((c: string) => !rx.test(c)).sort().join(' '),
    ['kind', 'state', 'role', 'parent', 'marker', 'tex'].map((k) => `${k}=${el.dataset[k] ?? ''}`).join(','), el.style.marginTop]);
}, [SEL[p], VIEW_ONLY.source]);
/** put block `id` at `dy` px below the top of pane p */
const toTop = (page: any, p: string, id: string, dy = 140) => page.evaluate(([s, i, d]: any) => { const sc = document.querySelector(s) as HTMLElement; const el = sc.querySelector(`.blk[data-id="${i}"]`)!; sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - d; }, [SEL[p], id, dy]);
/** a press in pane p's margin (no block): the pane is the focused one */
async function focusPane(page: any, p: string) {
  const pt = await page.evaluate((s: string) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.left + 3, y: r.top + 6 }; }, SEL[p]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((pp: string) => (window as any).editorAPI.layout().focused.value === pp, p);
}
const clickRender = async (page: any, p: string, id: string, fx = 0.5) => {
  const r = await page.evaluate(([s, i, f]: any) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + r.width * f, y: r.top + 12 }; }, [SEL[p], id, fx]);
  await page.mouse.click(r.x, r.y);
};
const waitSession = (page: any, p: string, id: string) => page.waitForFunction(([pp, i]: string[]) => (window as any).editorAPI.sessions().some((s: any) => s.pane === pp && s.id === i), [p, id]);
const shownIn = (page: any, id: string, word: string) => page.waitForFunction(([i, w]: any) => ['#page', '#page-b'].every((s) =>
  [...document.querySelectorAll(`${s} .blk[data-id="${i}"] .blk-render > .latex-block:not(.incoming) svg tspan`)].map((x) => x.textContent).join('').includes(w)), [id, word], { timeout: 60000 });

// ── the sample on the engine: two equal panes ────────────────────────────────────────────────────────────────────
if (section('symmetry')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample');
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
    const hs = await page.evaluate(() => ['#page', '#page-b'].map((x) => { const e = document.querySelector(x) as HTMLElement; return { h: e.scrollHeight, w: e.clientWidth, add: !!e.querySelector(':scope > .add-end-host .add-end') }; }));
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
    const r = await page.evaluate(([s, i]: string[]) => { const sc = document.querySelector(s)!; return document.querySelector(`${s} .blk[data-id="${i}"]`)!.getBoundingClientRect().top - sc.getBoundingClientRect().top; }, [SEL[p], target.id]);
    const q1 = await page.evaluate((s: string) => (document.querySelector(s) as HTMLElement).scrollTop, SEL[q]);
    check(`outline [${p}]: a jump with pane ${p.toUpperCase()} focused brings the heading to its top (8 px), pane ${q.toUpperCase()} unmoved`, Math.abs(r - 8) <= 2 && Math.abs(q1 - q0) <= 1, { r, q0, q1 });
    const active = await page.evaluate(() => document.querySelector('#panel-outline .ol-item.active')?.getAttribute('data-id'));
    check(`outline [${p}]: the active entry follows the focused pane`, active === target.id, { active, want: target.id });
  }

  // a press in a pane's breadcrumb bar focuses that pane
  for (const p of PANES) {
    await focusPane(page, other(p));
    await page.click(`.pane-bar-host[data-pane="${p}"] .crumb-sep`);
    const f = await page.evaluate(() => (window as any).editorAPI.layout().focused.value);
    check(`focus [${p}]: a press in pane ${p.toUpperCase()}'s bar focuses pane ${p.toUpperCase()}`, f === p, { f });
  }

  // two editors at once, crossed: X in p and Y in q, typed in each, each result in both panes
  for (const p of PANES) {
    const q = other(p), X = paras[0], Y = paras[2];
    await toTop(page, p, X); await toTop(page, q, Y); await idle(page);
    await clickRender(page, p, X); await waitSession(page, p, X);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), p);
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(` Word${p}one`);
    await clickRender(page, q, Y); await waitSession(page, q, Y);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), q);
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(` Word${p}two`);
    await shownIn(page, X, `Word${p}one`); await shownIn(page, Y, `Word${p}two`);
    const st = await api(page, 'sessions') as any[];
    const pop = await page.evaluate(([a, b, x, y]: string[]) => ({ x: !!document.querySelector(`${a} .blk.editing[data-id="${x}"] .cm-editor`), y: !!document.querySelector(`${b} .blk.editing[data-id="${y}"] .cm-editor`) }), [SEL[p], SEL[q], X, Y]);
    check(`editing [${p}]: an editor in ${p.toUpperCase()} and one in ${q.toUpperCase()} at once, each popover on its own pane's view, each result in both panes`, st.length === 2 && st.every((s: any) => s.view === s.pane) && pop.x && pop.y, { st: st.map((s: any) => `${s.pane}:${s.view}`), pop });
    await api(page, 'leave');
    await idle(page);
    for (const id of [X, Y]) { const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === id); await api(page, 'setSource', id, b.source.replace(/ Word[ab](one|two)$/, '')); }
    await idle(page);
  }
  {
    const id1 = await identity(page);
    check('identity: after edits in both panes, folds and jumps, no element moved between the panes (none re-made)', !id1.moved.length && id1.kept === 2 * blocks.length, id1);
  }

  // find: the match opens in the focused pane
  for (const p of PANES) {
    await focusPane(page, p);
    await page.keyboard.press('ControlOrMeta+f');
    await page.waitForSelector('.find-bar:not([hidden]) input');
    await page.keyboard.type('separation-width');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).editorAPI.sessions().length === 1);
    const st = await api(page, 'sessions') as any[];
    check(`find [${p}]: with pane ${p.toUpperCase()} focused, the match opens in pane ${p.toUpperCase()}`, st[0]?.pane === p && st[0]?.view === p, st);
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
    const s = await page.evaluate(() => { const a = document.activeElement; return { in: a?.closest('main')?.id ?? null, id: (a?.closest('.blk') as HTMLElement)?.dataset.id ?? null, sel: (window as any).editorAPI.selected() }; });
    const both = await page.evaluate((i: string) => ['#page', '#page-b'].map((x) => !!document.querySelector(`${x} .blk.selected[data-id="${i}"]`)), s.sel);
    const own = await page.evaluate((q: string) => ({ mine: (window as any).editorAPI.selected(q), other: (window as any).editorAPI.selected(q === 'a' ? 'b' : 'a') }), p);
    check(`selection [${p}]: ↓ selects a block shown in pane ${p.toUpperCase()}, its view focused there; selected in that pane only`,
      s.in === SEL[p].slice(1) && s.id === s.sel && both[PANES.indexOf(p)] && !both[1 - PANES.indexOf(p)] && own.mine === s.sel && own.other !== s.sel, { ...s, both, own });
    await page.keyboard.press('Escape');
  }

  // a compile above holds both panes' places
  {
    const R = blocks[Math.floor(blocks.length * 0.7)].id, first = paras[0];
    for (const p of PANES) await toTop(page, p, R, 120);
    await frames(page, 2); await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));   // the keepers take the reader's scroll as the anchor once it ends
    const y0 = await page.evaluate((i: string) => ['#page', '#page-b'].map((s) => document.querySelector(`${s} .blk[data-id="${i}"]`)!.getBoundingClientRect().top), R);
    const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === first);
    await api(page, 'setSource', first, `${b.source} ${'More words so that this paragraph gets several lines longer than it was before. '.repeat(4)}`);
    await idle(page); await frames(page);
    const y1 = await page.evaluate((i: string) => ['#page', '#page-b'].map((s) => document.querySelector(`${s} .blk[data-id="${i}"]`)!.getBoundingClientRect().top), R);
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
    const lists = await page.evaluate(() => ['#page', '#page-b'].map((s) => [...document.querySelectorAll(`${s} .blocks > .blk`)].map((e: any) => e.dataset.id).join()));
    check(`drag [${p}→${other(p)}]: dragged from pane ${p.toUpperCase()} into pane ${q.toUpperCase()}: lands there, both panes in the new order, no element moved between them`,
      order[order.indexOf(Y) - 1] === X && lists[0] === order.join() && lists[1] === order.join() && !id2.moved.length, { moved: id2.moved.slice(0, 3) });
  }
  // "Add a block" in pane B: a new block at the end, its editor in pane B
  {
    const n0 = (await api(page, 'blocks')).length;
    await page.evaluate(() => { const e = document.querySelector('#page-b > .add-end-host .add-end') as HTMLElement; e.scrollIntoView({ block: 'center' }); });
    await page.click('#page-b > .add-end-host .add-end');
    await page.waitForFunction(() => (window as any).editorAPI.sessions().length === 1);
    const st = await api(page, 'sessions') as any[];
    check('add [b]: pane B\'s "Add a block" adds a block at the end and opens it in pane B', (await api(page, 'blocks')).length === n0 + 1 && st[0].pane === 'b' && st[0].view === 'b', st);
    await api(page, 'leave'); await idle(page);
  }
  check('symmetry: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await page.screenshot({ path: join(OUT, 'symmetry.png') });
  await ctx.close();
}

// ── live text (numbers, references) in both panes, an edit in either (the engine) ───────────────────────────
if (section('numbers')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample');
  await openSplit(page);
  const ids = await page.evaluate(() => (window as any).editorAPI.blocks().filter((b: any) => /^\\(sub)*section\{/.test(b.source.trim()) || /\\(c|C|auto|eq)?ref\{/.test(b.source)).map((b: any) => b.id));
  const read = (id: string) => page.evaluate((i: string) => ['#page', '#page-b'].map((s) => [...document.querySelectorAll(`${s} .blk[data-id="${i}"] .blk-render > .latex-block:not(.incoming) svg tspan`)].map((t) => t.textContent).join('').replace(/[\s­-]+/g, '')), id);
  const all = async () => { const out: string[][] = []; for (const id of ids) { for (const p of PANES) await toTop(page, p, id, 200); await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.()); out.push(await read(id)); } return out; };
  const t0 = await all();
  const differ0 = t0.filter(([a, b]) => a !== b);
  check('numbers: every heading and reference reads the same in both panes', ids.length > 3 && !differ0.length && t0.some(([a]) => /^\d/.test(a)), { n: ids.length, differ: differ0.slice(0, 3) });
  const heading = ids.find((_: string, k: number) => /^\d/.test(t0[k][0]));
  for (const p of PANES) {
    // a section inserted above it, typed in pane p's editor: both panes renumber
    const before = (await read(heading))[0];
    const at = await page.evaluate((i: string) => (window as any).editorAPI.blocks().findIndex((b: any) => b.id === i), heading);
    const nb = await page.evaluate(([k, pp]: any) => { const A = (window as any).editorAPI; const id = A.insert(k, 'paragraph', ''); A.editIn(pp, id, 0); return id; }, [at, p]);
    await waitSession(page, p, nb);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), p);
    await page.keyboard.type(`\\section{Inserted in ${p}}`);
    await page.keyboard.press('Escape');
    await idle(page);
    for (const q of PANES) await toTop(page, q, heading, 200);
    await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.());
    let t = await read(heading);
    for (let k = 0; k < 120 && (t[0] === before || t[1] === before); k++) { await frames(page, 1); t = await read(heading); }
    check(`numbers [${p}]: a section typed above in pane ${p.toUpperCase()} renumbers the heading in both panes alike`, t[0] === t[1] && t[0] !== before, { before: before.slice(0, 24), a: t[0].slice(0, 24), b: t[1].slice(0, 24) });
  }
  check('numbers: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

// ── closing split view keeps the pane the reader works in: its scroll, editor, caret, undo, section focus ──
if (section('close')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample');
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
    const q = other(p), P = p.toUpperCase();
    await openSplit(page);
    // pane p: its section focus on H, an editor on X with something typed (undo) and a selection; pane q elsewhere,
    // with its own editor on Y
    // (the shortcut round with a section focus: the section is short, so the window may not scroll as far as the pane did)
    const sf = via === 'key';
    if (sf) await page.evaluate(([pp, h]: string[]) => (window as any).editorAPI.sectionFocus().set(pp, h), [p, H.id]);
    await toTop(page, q, Y, 160); await idle(page);
    await clickRender(page, q, Y); await waitSession(page, q, Y);
    await toTop(page, p, X, 220); await idle(page); await frames(page);
    await clickRender(page, p, X); await waitSession(page, p, X);
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), p);
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Keptword');
    await idle(page); await frames(page);
    await page.evaluate((pp: string) => { const v = (window as any).editorAPI.editorView(pp); const n = v.state.doc.length; v.dispatch({ selection: { anchor: n - 30, head: n - 12 } }); }, p);
    await idle(page); await frames(page);
    const read = (pp: string) => page.evaluate((x: string) => {
      const A = (window as any).editorAPI, v = A.editorView(x);
      if (!v) return null;
      const sel = v.state.selection.main, c = v.coordsAtPos(sel.head);
      return { text: v.state.doc.toString(), from: sel.from, to: sel.to, y: c ? Math.round(c.top) : null, scroll: Math.round(v.scrollDOM.scrollTop),
        focus: v.hasFocus, heading: A.layout().pane(x)?.focus ?? null, top: scrollY <= 0 && x === 'a' && !A.layout().split.value };
    }, pp);
    const before = await read(p);
    const focused = await page.evaluate(() => (window as any).editorAPI.layout().focused.value);
    if (via === 'button') await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight')); else await page.keyboard.press('ControlOrMeta+Alt+Backslash');
    await page.waitForFunction(() => !(window as any).editorAPI.layout().split.value && !document.querySelector('#page-b'));
    await idle(page); await frames(page, 3);
    const after = await read('a');
    const st = await api(page, 'sessions') as any[];
    const sfOut = await page.evaluate((h: string) => [...document.querySelectorAll('#page .blocks > .blk')].filter((e) => !e.classList.contains('sf-out')).map((e: any) => e.dataset.id), H.id);
    check(`close [${p}, ${via}]: closed from pane ${P} (focused: ${focused}): one pane left, one editor, on pane ${P}'s block`, focused === p && st.length === 1 && st[0].id === X && st[0].pane === 'a', { focused, st });
    check(`close [${p}, ${via}]: the editor goes on: the same text, selection, its focus`, !!after && after.text === before.text && after.from === before.from && after.to === before.to && after.focus, { before, after });
    const dy = after?.y != null && before?.y != null ? after.y - before.y : null;
    check(`close [${p}, ${via}]: the caret's line stays where it was seen (±2 px${sf ? ', or higher with the window at its top' : ''})`, dy != null && (Math.abs(dy) <= 2 || (sf && dy < 0 && after!.top)), { before: before?.y, after: after?.y, top: after?.top });
    if (sf) check(`close [${p}, ${via}]: pane ${P}'s section focus is kept (only H's section shown)`, after?.heading === H.id && sfOut.includes(H.id) && sfOut.includes(X) && !sfOut.includes(Y), { heading: after?.heading, want: H.id, shown: sfOut.length });
    else check(`close [${p}, ${via}]: no section focus in pane ${P}: none after`, after?.heading == null && sfOut.length === blocks.length, { heading: after?.heading, shown: sfOut.length, n: blocks.length });
    // its undo history came with it
    await page.keyboard.press('ControlOrMeta+z');
    await idle(page);
    const undone = await read('a');
    check(`close [${p}, ${via}]: its undo history is kept (⌘Z takes back what was typed in pane ${P})`, !!undone && !undone.text.includes('Keptword') && before!.text.includes('Keptword'), { tail: undone?.text.slice(-30) });
    await api(page, 'leave'); await idle(page);
    const b = (await api(page, 'blocks') as any[]).find((x: any) => x.id === X);
    if (/ Keptword$/.test(b.source)) { await api(page, 'setSource', X, b.source.replace(/ Keptword$/, '')); await idle(page); }
    await page.evaluate(() => (window as any).editorAPI.sectionFocus().set('a', null));
    await idle(page);
  }
  check('close: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

// ── an editor in each pane: the focused one's two carets blink together; the other's two stay, still and dimmed ──
if (section('carets')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1600, height: 900 });
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
  const sample = () => page.evaluate(() => new Promise((done) => {
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
      for (const [p, s] of [['a', '#page'], ['b', '#page-b']]) {
        const root = document.querySelector(`${s} .blk.editing`);
        fr[p] = { code: eff(root?.querySelector('.cm-cursor-primary') ?? null), preview: eff(root?.querySelector('.rtx-caret-bar') ?? null) };
      }
      out.push(fr);
      if (performance.now() - t0 < 1800) requestAnimationFrame(f); else done(out);
    };
    requestAnimationFrame(f);
  }));
  for (const p of PANES) {
    const q = other(p), P = p.toUpperCase(), Q = q.toUpperCase();
    await page.evaluate((pp: string) => (window as any).editorAPI.editorView(pp).focus(), p);
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

// ── (milestone 3) open and close split view 50 times: nothing it adds stays ────────────────────────────────
if (section('leak')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1440, height: 900 });
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
    return { document: await count('document'), window: await count('window'), listeners: m.JSEventListeners, nodes: m.Nodes, heap: Math.round(m.JSHeapUsedSize / 1024),
      viewer: await page.evaluate(() => (window as any).reflowtex.host.blocks().length), layers: await page.evaluate(() => document.querySelectorAll('.ui-layer, .pane-bar-host, .split-chrome').length) };
  };
  const cycle = async () => {
    await page.keyboard.press('ControlOrMeta+Alt+Backslash');
    // (not waitForSelector: its element handle would keep a view alive, as a page's console would)
    await page.waitForFunction(() => !!document.querySelector('#page-b .blocks > .blk .blk-render > .latex-block'));
    await idle(page);
    await page.keyboard.press('ControlOrMeta+Alt+Backslash');
    await page.waitForFunction(() => !document.getElementById('page-b'));
    await idle(page);
  };
  await page.mouse.click(5, 5);
  for (let k = 0; k < 3; k++) await cycle();
  const m0 = await measure();
  for (let k = 0; k < 50; k++) await cycle();
  const m1 = await measure();
  check('leak: 50 × split open/close: the same listeners on document and window', m1.document === m0.document && m1.window === m0.window, { m0, m1 });
  check('leak: … the same number of event listeners in the page and viewer blocks (no views left)', Math.abs(m1.listeners - m0.listeners) <= 4 && m1.viewer === m0.viewer && m1.layers === m0.layers, { listeners: [m0.listeners, m1.listeners], viewer: [m0.viewer, m1.viewer], layers: [m0.layers, m1.layers] });
  check('leak: … DOM nodes and the heap flat (nodes ±2 %, heap +3 MB at most)', m1.nodes <= m0.nodes * 1.02 + 20 && m1.heap - m0.heap <= 3 * 1024, { nodes: [m0.nodes, m1.nodes], heapKB: [m0.heap, m1.heap] });
  check('leak: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

// ── a pane shows a registered view (the Files panel's content), not a document; 50× open/close ──
if (section('viewpane')) {
  const { ctx, page } = await open('?seed=sample&engine&store=memory#/doc/sample', { width: 1440, height: 900 });
  await api(page, 'advanced', true);                                   // the Files view is registered with the advanced switch on
  const blocksA = await page.evaluate(() => document.querySelectorAll('#page .blocks > .blk').length);
  const openView = () => page.evaluate(() => (window as any).editorAPI.layout().open('b', { view: 'files' }));
  await openView();
  await page.waitForFunction(() => !!document.querySelector('#page-b .view-pane .view-pane-title'));
  await idle(page);
  const shown = await page.evaluate(() => {
    const b = document.getElementById('page-b')!;
    const P = (window as any).editorAPI.panes();
    return { title: b.querySelector('.view-pane-title')?.textContent, blocksB: b.querySelectorAll('.blk').length, split: document.getElementById('editor-view')?.classList.contains('split'),
      viewPanes: P.viewPanes().map((v: any) => `${v.id}:${v.view}`).join(), isPane: !!P.get('b'), blocksA: document.querySelectorAll('#page .blocks > .blk').length,
      inSheet: !!document.querySelector('.ui-layer .view-pane') };
  });
  check('viewpane: a layout entry { view: "files" } shows the Files view in pane B, in a pane frame (no sheet), split on; pane B has no blocks and is no document pane; pane A unchanged',
    shown.title === 'Files' && shown.blocksB === 0 && shown.split && shown.viewPanes === 'b:files' && !shown.isPane && shown.blocksA === blocksA && !shown.inSheet, shown);
  await page.click('#page-b .view-pane-close');
  await page.waitForFunction(() => !document.getElementById('page-b'));
  await idle(page);
  const closed = await page.evaluate(() => ({ ids: (window as any).editorAPI.layout().ids().join(), split: document.getElementById('editor-view')?.classList.contains('split'), views: (window as any).editorAPI.panes().viewPanes().length }));
  check('viewpane: its Close closes the pane (the layout entry goes, split off)', closed.ids === 'a' && !closed.split && closed.views === 0, closed);
  // a document opened in a view pane: it becomes that document's pane again
  await openView();
  await page.waitForFunction(() => !!document.querySelector('#page-b .view-pane'));
  await page.evaluate(() => { const L = (window as any).editorAPI.layout(); L.setDoc('b', L.pane('a').doc); });
  await page.waitForFunction(() => !!document.querySelector('#page-b .blocks > .blk .blk-render > .latex-block') && !document.querySelector('#page-b .view-pane'));
  await idle(page);
  const back = await page.evaluate(() => ({ blocksB: document.querySelectorAll('#page-b .blocks > .blk').length, views: (window as any).editorAPI.panes().viewPanes().length, isPane: !!(window as any).editorAPI.panes().get('b') }));
  check('viewpane: the document set on a view pane makes it that document\'s pane (its blocks, no view)', back.blocksB === blocksA && back.views === 0 && back.isPane, back);
  await page.evaluate(() => (window as any).editorAPI.layout().close('b'));
  await page.waitForFunction(() => !document.getElementById('page-b'));
  await idle(page);
  // 50 × open and close: listeners, nodes, layers and the heap flat
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
    return { document: await count('document'), window: await count('window'), listeners: m.JSEventListeners, nodes: m.Nodes, heap: Math.round(m.JSHeapUsedSize / 1024),
      layers: await page.evaluate(() => document.querySelectorAll('.ui-layer, .split-chrome, .view-pane').length) };
  };
  const cycle = async () => {
    await openView();
    await page.waitForFunction(() => !!document.querySelector('#page-b .view-pane'));
    await idle(page);
    await page.evaluate(() => (window as any).editorAPI.layout().close('b'));
    await page.waitForFunction(() => !document.getElementById('page-b'));
    await idle(page);
  };
  for (let k = 0; k < 3; k++) await cycle();
  const m0 = await measure();
  for (let k = 0; k < 50; k++) await cycle();
  const m1 = await measure();
  check('viewpane: 50 × a view pane opened and closed: the same listeners on document and window, no layers left', m1.document === m0.document && m1.window === m0.window && m1.layers === m0.layers && Math.abs(m1.listeners - m0.listeners) <= 4, { m0, m1 });
  check('viewpane: … DOM nodes and the heap flat (nodes ±2 %, heap +3 MB at most)', m1.nodes <= m0.nodes * 1.02 + 20 && m1.heap - m0.heap <= 3 * 1024, { nodes: [m0.nodes, m1.nodes], heapKB: [m0.heap, m1.heap] });
  check('viewpane: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
console.log(`\n${passed}/${results.length} passed`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
