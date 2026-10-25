// test: the editor app (app) in headless Chromium, driven through
// its UI and window.editorAPI. Waits on editorAPI.whenIdle() (no compile due
// or running, results mounted, refs refreshed, viewer idle) and on DOM
// events/selectors; never on fixed times.
//
//   node tests/test-w3.ts http://localhost:8150/ [--no-shots]
//
// On the dev app (tests/integration/serve.ts): the sample document compiles on the engine;
// the long document (?seed=long: the intro repeated) runs with ?backend=none (its checks need no typesetting).
// Screenshots: test-results/w3/*.png; results: test-results/w3/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'w3');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8150/';
const SHOTS = !process.argv.includes('--no-shots');
const MOD = 'Control';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const shot = async (page: any, name: string, opts: any = {}) => { if (SHOTS) await page.screenshot({ path: join(OUT, `${name}.png`), ...opts }); };

const browser = await chromium.launch();
const problems: string[] = [];
// platform: navigator.platform as the page reads it ('Win32', 'MacIntel'), for the shortcut labels; absent: the browser's own
async function newPage(url: string, { width = 1280, height = 900, reduced = true, platform = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  if (platform) await ctx.addInitScript((p: string) => { Object.defineProperty(Navigator.prototype, 'platform', { get: () => p, configurable: true }); }, platform);
  const page = await ctx.newPage();
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r: any) => problems.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r: any) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(BASE + url);
  await page.waitForFunction(() => (window as any).editorAPI);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  return { ctx, page };
}
const api = (page: any, fn: string, ...args: any[]) => page.evaluate(([f, a]: [string, any[]]) => (window as any).editorAPI[f](...a), [fn, args]);
const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
const blocks = (page: any) => api(page, 'blocks');
const idOf = async (page: any, pred: string) => page.evaluate((p: string) => (window as any).editorAPI.blocks().find((b: any) => b.source.includes(p))?.id, pred);

// ── 1. The sample on the engine ────────────────────────────────────────────
const t0 = Date.now();
const { page } = await newPage('?seed=sample&engine#/doc/sample');
const loadMs = Date.now() - t0;
{
  const bs = await blocks(page);
  const mounted = bs.filter((b: any) => b.mounted).length;
  const failing = bs.filter((b: any) => b.state === 'error').map((b: any) => `${b.kind}: ${b.errors[0]?.message.slice(0, 60)}`);
  check('sample: every block typeset or marked, none failed', mounted >= bs.length - 1 && failing.length === 0,
    `${mounted}/${bs.length} mounted in ${loadMs} ms; errors: ${failing.join('; ') || 'none'}`);
  check('sample: \\appendix is a marker, not compiled', bs.some((b: any) => b.kind === 'appendix' && b.state === 'marker'));
  check('modules through the contracts', true, JSON.stringify(await api(page, 'modules')));
  // the save state is the tab's unsaved dot (none: saved); the bar has no save status
  const unsaved = await page.evaluate(() => ({ dot: !!document.querySelector('[data-tab] .wb-st--unsaved'), bar: !!document.querySelector('#save-state, .save-state') }));
  check('saved: no unsaved dot on the tab, no save status in the bar', !unsaved.dot && !unsaved.bar, unsaved);
  await shot(page, '01-document');
}

// ── 2. Slash menu kinds from the preamble ─────────────────────────────────
{
  const kinds = (await api(page, 'kinds')).map((k: any) => k.kind);
  check('kinds: theorem-likes from \\newtheorem', ['theorem', 'lemma', 'claim', 'corollary', 'definition', 'remark'].every((k) => kinds.includes(k)), kinds.join(','));
  check('kinds: built-ins title/abstract/bibliography/appendix/figure/table', ['title', 'abstract', 'bibliography', 'appendix', 'figure', 'table'].every((k) => kinds.includes(k)));
  const pre = (await api(page, 'currentDoc')).preamble.source;
  await api(page, 'setPreamble', `${pre}\n\\usepackage{thmtools}\n\\declaretheorem[name=Bound, refname={bound,bounds}]{bound}\n\\declaretheorem[name=Observation, style=remark, sibling=theorem]{observation}`);
  const k2 = await api(page, 'kinds');
  check('kinds: \\declaretheorem adds Bound and Observation', k2.some((k: any) => k.kind === 'bound' && k.label === 'Bound') && k2.some((k: any) => k.kind === 'observation'));
  await api(page, 'setPreamble', pre);
  await idle(page);
  // through the UI: hover a block's + and pick Claim by filtering
  const id = await idOf(page, 'All categories are locally small');
  const row = page.locator(`.blk[data-id="${id}"]`);
  await row.hover();
  await row.locator('.g-add').click();
  await page.waitForSelector('.menu.slash');
  const titles = await page.locator('.menu.slash .menu-title').allTextContents();
  const items = await page.locator('.menu.slash .menu-item').evaluateAll((els: any[]) => els.map((e) => e.dataset.kind));
  check('slash menu: grouped, lists Claim/Corollary from the preamble', titles.includes('Theorems') && items.includes('claim') && items.includes('corollary'), titles.join(' | '));
  await shot(page, '02-slash-menu');
  await page.keyboard.type('clai');
  const filtered = await page.locator('.menu.slash .menu-item').evaluateAll((els: any[]) => els.map((e) => e.dataset.kind));
  await page.keyboard.press('Enter');
  const caret = await api(page, 'caret');
  const nb = (await blocks(page)).find((b: any) => b.id === caret?.id);
  check('slash menu: filter + Enter inserts \\begin{claim} with the caret inside', filtered[0] === 'claim' && nb?.source.startsWith('\\begin{claim}') && nb?.kind === 'claim', `${filtered.join(',')} → ${nb?.source.replace(/\n/g, '⏎')}`);
  await page.keyboard.type('Every flip is an involution.');
  await page.keyboard.press('Escape');
  await idle(page);
  const after = (await blocks(page)).find((b: any) => b.id === caret?.id);
  check('the new claim typesets', after?.mounted === true && after?.state === 'ok', after?.state);
}

// ── 3. Outline ──────────────────────────────────────────────────────────────
{
  const ol = await api(page, 'outline');
  const titles = ol.map((o: any) => `${o.number} ${o.title}`.trim());
  check('outline: sections numbered, appendix lettered, abstract and references', JSON.stringify(titles) === JSON.stringify(['Abstract', '1 Introduction', '2 Preliminaries', '3 Functors and natural transformations', 'A Omitted proofs', 'References']), titles.join(' | '));
  const n = await page.locator('#panel-outline .ol-item').count();
  check('outline: drawn in the sidebar', n === ol.length, `${n} items`);
  await page.locator('#panel-outline .ol-item', { hasText: 'Omitted proofs' }).locator('button.ol-link').click();
  await page.waitForFunction(() => { const id = (window as any).editorAPI.outline().find((o: any) => o.title === 'Omitted proofs').id; const r = document.querySelector(`.blk[data-id="${id}"]`)!.getBoundingClientRect(); return r.top >= 0 && r.top < 160; }, null, { timeout: 5000 }).catch(() => {});
  const top = await page.evaluate(() => { const id = (window as any).editorAPI.outline().find((o: any) => o.title === 'Omitted proofs').id; return document.querySelector(`.blk[data-id="${id}"]`)!.getBoundingClientRect().top; });
  const active = await page.locator('#panel-outline .ol-item.active').textContent();
  check('outline: click scrolls to the section and marks it active', top >= 0 && top < 160 && /Omitted proofs/.test(active ?? ''), `top ${top.toFixed(0)}; active ${active}; ${JSON.stringify(await page.evaluate(() => { const p = document.querySelector('[data-part="page"]') as HTMLElement; return { scrollTop: p.scrollTop, max: p.scrollHeight - p.clientHeight, h: p.clientHeight }; }))}`);
  await shot(page, '03-outline-scrolled');
  // drag section 3 above section 2 (through the outline), then undo
  const before = (await blocks(page)).map((b: any) => b.id);
  const src = page.locator('#panel-outline .ol-item', { hasText: 'Functors and natural transformations' });
  const dst = page.locator('#panel-outline .ol-item', { hasText: 'Preliminaries' });
  const sb = await src.boundingBox(), db = await dst.boundingBox();
  await page.mouse.move(sb.x + 40, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 40, sb.y - 10, { steps: 4 });
  await page.mouse.move(db.x + 40, db.y + 2, { steps: 6 });
  await page.mouse.up();
  await idle(page);
  const ol2 = (await api(page, 'outline')).map((o: any) => o.title);
  check('outline: dragging a section moves its blocks', ol2.indexOf('Functors and natural transformations') < ol2.indexOf('Preliminaries'), ol2.join(' | '));
  await page.keyboard.press(`${MOD}+z`);
  await idle(page);
  const back = (await blocks(page)).map((b: any) => b.id);
  check('undo (Ctrl-Z) puts the section back', JSON.stringify(back) === JSON.stringify(before));
}

// ── 4. Autocomplete, hover cards, go to definition ─────────────────────────
{
  const id = await idOf(page, 'The proof goes through');
  await api(page, 'edit', id);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(' By \\Cref{');
  await page.waitForSelector('.cm-tooltip-autocomplete li');
  const opts = await page.locator('.cm-tooltip-autocomplete .cm-completionLabel').allTextContents();
  check('\\Cref{ offers the labels', ['lem:yoneda', 'thm:main', 'sec:intro', 'eq:nat'].every((l) => opts.includes(l)), opts.slice(0, 8).join(', '));
  await page.keyboard.type('lem');
  await page.waitForFunction(() => document.querySelectorAll('.cm-tooltip-autocomplete li').length === 1, null, { timeout: 5000 })
    .catch(async () => console.log('DBG', await page.locator('.cm-tooltip-autocomplete li').allTextContents(), await page.evaluate(() => (window as any).editorAPI.caret())));
  await shot(page, '04-autocomplete-ref');
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type(' and \\cite{Obj');
  await page.waitForFunction(() => document.querySelectorAll('.cm-tooltip-autocomplete li').length === 1);
  const copts = await page.locator('.cm-tooltip-autocomplete .cm-completionLabel').allTextContents();
  check('\\cite{Obj offers Obj23 (from the bibliography block)', copts.includes('Obj23'), copts.join(', '));
  // (Enter within CodeMirror's 75 ms interaction delay of the list changing would be a newline: click)
  await page.locator('.cm-tooltip-autocomplete li').first().click();
  const src = (await blocks(page)).find((b: any) => b.id === id).source;
  check('completion writes the keys', src.includes('\\Cref{lem:yoneda}') && src.includes('\\cite{Obj23}'), src.slice(-60));
  // hover card over the key
  const at = await api(page, 'coordsAt', src.indexOf('lem:yoneda') + 4);
  await page.mouse.move(at.x - 20, at.y);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  let card = '';
  try { await page.waitForSelector('.cm-tooltip-hover .hover-card', { timeout: 5000 }); card = await page.locator('.cm-tooltip-hover .hover-card').textContent(); } catch { card = '(none)'; }
  check('hover card on a \\Cref key shows what it points to', /Lemma/.test(card) && /lem:yoneda/.test(card), card.slice(0, 80));
  await shot(page, '05-hover-card');
  // F12 on the key: the lemma's block opens with its \label selected
  const offset = src.indexOf('lem:yoneda') + 3;
  await api(page, 'edit', id, offset);
  await page.keyboard.press('F12');
  await idle(page);
  const c = await api(page, 'caret');
  const target = (await blocks(page)).find((b: any) => b.id === c?.id);
  check('F12 goes to the label', target?.kind === 'lemma' && target.source.includes('\\label{lem:yoneda}'), target?.kind);
  await page.keyboard.press('Escape');
  await idle(page);
}

// ── 5. Diagnostics ──────────────────────────────────────────────────────────
{
  const at = (await blocks(page)).findIndex((b: any) => b.source.includes('All categories are locally small'));
  const bad = await api(page, 'insert', at + 1, 'paragraph', 'See \\ref{nope:missing} and \\cite{Nobody99}; again \\label{lem:yoneda}.');
  await idle(page);
  const d = await api(page, 'diagnostics');
  const kinds = new Set(d.filter((x: any) => x.blockId === bad).map((x: any) => x.kind));
  check('diagnostics: undefined ref, unknown cite, duplicate label', kinds.has('undefined-ref') && kinds.has('unknown-cite') && kinds.has('duplicate-label'), [...kinds].join(','));
  // a TeX error in a block is listed as that block's error (the v1 worker's abstract failed to typeset; the engine's
  // does not, so the error is made here), then the block goes again
  const texBad = await api(page, 'insert', at + 2, 'paragraph', 'An undefined macro: \\nosuchmacroxyz{1}.');
  await idle(page);
  const d2 = await api(page, 'diagnostics');
  check('diagnostics: a block\'s TeX error is listed for it', d2.some((x: any) => x.blockId === texBad && x.kind === 'error'), d2.filter((x: any) => x.blockId === texBad).map((x: any) => `${x.kind}: ${x.message}`.slice(0, 80)).join('; '));
  await api(page, 'remove', texBad);
  await idle(page);
  await page.click('[data-side] [data-ptab="problems"]');
  const count = await page.textContent('[data-side] [data-ptab="problems"] .wb-ptab-badge');
  check('Problems tab shows a count', Number(count) >= 4, count ?? '');
  await shot(page, '06-problems');
  await page.locator('.pb-row[data-kind="undefined-ref"]').first().click();
  await idle(page);
  const c = await api(page, 'caret');
  check('clicking a problem opens its block at the key', c?.id === bad, JSON.stringify(c));
  const marks = await page.locator('.blk.editing .cm-bad-ref').allTextContents();
  check('the open block underlines the bad keys', marks.includes('nope:missing') && marks.includes('Nobody99'), marks.join(','));
  await shot(page, '07-problem-in-editor');
  await page.keyboard.press('Escape');
  await api(page, 'remove', bad);
  await idle(page);
  await page.click('[data-side] [data-ptab="todos"]');
  const todos = await api(page, 'todos');
  check('TODO panel: \\editor and \\referee by author', todos.length === 2 && todos.some((t: any) => t.author === 'Editor') && todos.some((t: any) => t.author === 'Referee'), todos.map((t: any) => `${t.author}: ${t.text}`).join(' · '));
  await shot(page, '08-todos');
  await page.click('[data-side] [data-ptab="outline"]');
}

// ── 6. Find and replace: only touched blocks compile ───────────────────────
{
  await page.keyboard.press(`${MOD}+f`);
  await page.waitForSelector('.find-bar:not([hidden]) .find-input');
  await page.keyboard.type('\\mathcal{C}');
  const count = await page.textContent('.find-count');
  const hits = await api(page, 'find', '\\mathcal{C}');
  const touched = [...new Set(hits.map((h: any) => h.blockId))];
  check('find: counts matches across blocks', count === `${hits.length} in ${touched.length} blocks` && hits.length >= 4, count ?? '');
  await page.keyboard.press('Enter');
  const c = await api(page, 'caret');
  check('find: Enter opens the first match, selected', c?.id === hits[0].blockId, JSON.stringify(c));
  await shot(page, '09-find');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await idle(page);
  await api(page, 'resetCounters');
  const n = await api(page, 'replaceAll', '\\mathcal{C}', '\\mathcal{E}');
  await idle(page);
  const k = await api(page, 'counters');
  const compiled = [...new Set(k.compiledIds)];
  check('replace all recompiles exactly the touched blocks', n === hits.length && compiled.length === touched.length && compiled.every((i: any) => touched.includes(i)),
    `${n} replaced, compiled ${compiled.length} of ${touched.length} touched, ${k.requests} request(s)`);
  await api(page, 'resetCounters');
  await api(page, 'undo');
  await idle(page);
  const k2 = await api(page, 'counters');
  const restored = (await api(page, 'find', '\\mathcal{C}')).length;
  check('undo restores the text and compiles nothing (results cached)', restored === hits.length && k2.compiledIds.length === 0, `${restored} matches, ${k2.compiledIds.length} compiled`);
}

// ── 7. Split and merge ──────────────────────────────────────────────────────
{
  const id = await idOf(page, 'All categories are locally small');
  const src = (await blocks(page)).find((b: any) => b.id === id).source;
  const cut = src.indexOf('For a category');
  const n0 = (await blocks(page)).length;
  await api(page, 'edit', id, cut);
  await page.keyboard.press(`${MOD}+Enter`);
  await idle(page);
  const bs = await blocks(page);
  const i = bs.findIndex((b: any) => b.id === id);
  check('Ctrl-Enter splits at the caret', bs.length === n0 + 1 && bs[i].source === src.slice(0, cut).trimEnd() && bs[i + 1].source === src.slice(cut), `${bs[i].source.slice(-20)} | ${bs[i + 1].source.slice(0, 20)}`);
  const c = await api(page, 'caret');
  check('the caret is at the start of the new block', c?.id === bs[i + 1].id && c.offset === 0);
  await page.keyboard.press('Backspace');
  await idle(page);
  const bs2 = await blocks(page);
  const merged = bs2.find((b: any) => b.id === id);
  check('Backspace at the start merges into the block above', bs2.length === n0 && merged.source === `${src.slice(0, cut).trimEnd()}\n\n${src.slice(cut)}`, merged.source.replace(/\n/g, '⏎').slice(0, 90));
  await page.keyboard.press('Escape');
  await api(page, 'setSource', id, src);
  await idle(page);
}

// ── 8. Keyboard navigation, focus mode ─────────────────────────────────────
{
  const bs = await blocks(page);
  const id = bs[4].id;
  await api(page, 'edit', id);
  await page.keyboard.press('Escape');
  const sel0 = await api(page, 'selected');
  await page.keyboard.press('ArrowDown');
  const sel1 = await api(page, 'selected');
  check('Esc leaves the editor with the block selected; ↓ selects the next', sel0 === id && sel1 === bs[5].id, `${sel0 === id} ${sel1 === bs[5].id}`);
  await page.keyboard.press('Alt+ArrowUp');
  await idle(page);
  const order = (await blocks(page)).map((b: any) => b.id);
  check('⌥↑ moves the selected block up', order[4] === bs[5].id && order[5] === id);
  await page.keyboard.press(`${MOD}+z`);
  await idle(page);
  check('Ctrl-Z undoes the move', (await blocks(page))[4].id === id);
  await page.keyboard.press('Enter');
  const c = await api(page, 'caret');
  check('Enter edits the selected block', c?.id === (await api(page, 'selected')));
  await page.keyboard.press(`${MOD}+Shift+F`);
  const focus = await page.evaluate(() => document.querySelector('.rtx-editor')!.hasAttribute('data-focus-mode'));
  const sidebar = await page.locator('[data-side="left"]').isVisible();
  check('focus mode: the side columns hidden, other blocks dimmed', focus && !sidebar);
  await shot(page, '10-focus-mode');
  await page.keyboard.press(`${MOD}+Shift+F`);
  await page.keyboard.press('Escape');
  await idle(page);
}

// ── 9. Click to source (fuzzy: no backend sends source maps yet) ───────────
{
  const id = await idOf(page, 'All categories are locally small');
  // the viewer draws one <tspan> per glyph: the "r" of "arrows"
  const box = await page.evaluate((i: string) => {
    const ts = [...document.querySelectorAll(`.blk[data-id="${i}"] .blk-render tspan`)];
    const text = ts.map((t) => t.textContent).join('');
    const k = text.indexOf('arrows');
    if (k < 0) return null;
    let n = 0;
    for (const t of ts) { if (n === k + 2) { const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; } n += t.textContent!.length; }
    return null;
  }, id);
  let ok = false, detail = '';
  if (box) {
    const b = box;
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height / 2);
    await idle(page);
    const c = await api(page, 'caret');
    const src = (await blocks(page)).find((x: any) => x.id === id).source;
    const at = src.indexOf('arrows');
    ok = c?.id === id && c.offset >= at && c.offset <= at + 8;
    detail = `${c?.position?.method} offset ${c?.offset}, word at ${at}`;
    await page.keyboard.press('Escape');
  } else detail = 'word not drawn as a tspan';
  check('click on a word puts the caret in it', ok, detail);
}

// ── 10. Persistence (IndexedDB through the store) ──────────────────────────
{
  const id = await idOf(page, 'Functors are the structure-preserving maps');
  await api(page, 'setSource', id, 'Functors are the structure-preserving maps between categories (edited).');
  await idle(page);
  await page.reload();
  await page.waitForFunction(() => (window as any).editorAPI);
  await idle(page);
  const kept = (await blocks(page)).find((b: any) => b.id === id)?.source;
  check('a reload keeps the edit (store)', kept === 'Functors are the structure-preserving maps between categories (edited).', kept?.slice(0, 60));
}

// ── 11. Phone width ────────────────────────────────────────────────────────
{
  await page.setViewportSize({ width: 390, height: 800 });
  await idle(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check('390 px: no horizontal scroll', sw <= 390, `scrollWidth ${sw}`);
  await shot(page, '11-phone');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// ── 12. A long document (source only): the intro repeated (?seed=long, app/long-fixture.ts) ──────────
// (the paper this section ran on had an appendix and thm-restate recalls; no sample has them now: not checked here)
{
  const { page: p } = await newPage('?seed=long&backend=none#/doc/long');
  const ol = await api(p, 'outline');
  const titles = ol.map((o: any) => o.title);
  check('long: outline has its sections', ol.length >= 40 && titles.includes('Mathematics'), `${ol.length} items`);
  const kinds = (await api(p, 'kinds')).map((k: any) => k.kind);
  check('long: slash menu has Theorem, Lemma, Definition from its \\newtheorem', ['theorem', 'lemma', 'definition'].every((k) => kinds.includes(k)), kinds.filter((k: string) => !['paragraph', 'heading'].includes(k)).join(','));
  const bs = await blocks(p);
  check('long: all blocks loaded', bs.length >= 200, `${bs.length} blocks`);
  const wc = await api(p, 'wordCount');
  check('long: word count', wc.words > 3000, JSON.stringify(wc));
  await shot(p, '12-long-outline');
  await p.click('[data-side] [data-ptab="problems"]');
  await shot(p, '13-long-problems');
  // the Ipe figure editor is removed: PDF figures typeset as images, with no "Edit figure"
  {
    const pdfFigs = await p.evaluate(() => (window as any).editorAPI.blocks().filter((b: any) => /\\includegraphics/.test(b.source) && !/\.svg\}/.test(b.source))
      .map((b: any) => ({ id: b.id, ok: b.state === 'ok' || b.state === 'pending' || b.mounted })));
    const editBtns = await p.locator('.blk .fig-edit').count();
    check('long: its pictures are there and have no Edit figure button', pdfFigs.length >= 7 && editBtns === 0, `${pdfFigs.length} PDF figures, ${editBtns} buttons`);
  }
  // versions from the menu
  await p.click('#btn-doc-menu');
  await p.click('.doc-menu [data-action="versions"]');
  await p.waitForSelector('dialog.versions-dialog .rv');
  const vIdle = () => p.evaluate(() => (document.querySelector('dialog.versions-dialog') as any)._versions?.idle?.());
  await vIdle();
  const n0 = await p.locator('dialog.versions-dialog .rv-list > *').count();
  await p.fill('dialog.versions-dialog input[name="label"]', 'Before the talk');
  await p.click('dialog.versions-dialog [data-action="save-version"]');
  await p.waitForFunction((n: number) => document.querySelectorAll('dialog.versions-dialog .rv-list > *').length > n, n0);
  await vIdle();
  const n1 = await p.locator('dialog.versions-dialog .rv-list > *').count();
  const named = await p.locator('dialog.versions-dialog .rv-list').textContent();
  await shot(p, '15-versions');
  check('versions: Save version adds one', n0 >= 1 && n1 === n0 + 1 && /Before the talk/.test(named ?? ''), `${n0} → ${n1}`);
  await p.keyboard.press('Escape');
  // export .tex from the menu
  await p.click('#btn-doc-menu');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.doc-menu [data-action="export-tex"]')]);
  const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  check('export .tex (io.exportTex) has the preamble and the body', /\\documentclass/.test(text) && /\\begin\{document\}/.test(text) && text.includes('Where your document lives'), `${dl.suggestedFilename()} ${text.length} chars`);
}

// ── 13. Routing: home ↔ document ──────────────────────────────────────
{
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.rh-row[data-doc-id]');
  const route = await api(page, 'route');
  const rows = await page.locator('.rh-row[data-doc-id]').count();
  const homeShown = await page.locator('.wb-home .rtx-wb-home').isVisible();
  await shot(page, '16-home');
  check('#/ shows the home screen (W2) in the group\'s home panel', route.name === 'home' && rows >= 1 && homeShown, `${rows} document(s)`);
  // (the Preact migration) the Documents view is the kit's, its footer (the preview pill with the build) in it
  const kit = await page.evaluate(() => ({ newBtn: !!document.querySelector('.wb-home [data-action=new].ui-btn--primary'),
    pill: document.querySelector('.wb-home .home-foot .rtx-preview-pill')?.textContent, title: document.title }));
  check('home: on the kit; the footer\'s pill shows the build; title "Documents · ReflowEd"', kit.newBtn && kit.pill === 'Preview · dev' && kit.title === 'Documents · ReflowEd', kit);
  await page.locator('.rh-row[data-doc-id]').first().click();
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  await idle(page);
  const r2 = await api(page, 'route');
  check('opening a document from home routes to #/doc/<id>', r2.name === 'doc' && (await page.evaluate(() => location.hash)).startsWith('#/doc/'), JSON.stringify(r2));
  check('in a document: no home screen and no home footer', await page.evaluate(() => !document.querySelector('.rh, .home-foot')));
}

// ── 14. Shortcut labels: each platform's, as the workbench writes its own (Ctrl+D on Windows, never "CtrlD") ──
for (const [platform, want] of [
  ['Win32', { find: 'Ctrl+F', focus: 'Ctrl+Shift+F', dup: 'Ctrl+D', undo: 'Ctrl+Z  Ctrl+Shift+Z', split: 'Ctrl+Enter', move: 'Alt+↑' }],
  ['MacIntel', { find: '⌘F', focus: '⇧⌘F', dup: '⌘D', undo: '⌘Z  ⇧⌘Z', split: '⌘Enter', move: '⌥↑' }],
] as const) {
  const { ctx, page: p } = await newPage('?seed=sample&backend=none#/doc/sample', { platform });
  await p.click('#btn-doc-menu');
  const keyOf = (action: string) => p.locator(`.doc-menu [data-action="${action}"] .mi-key`).textContent();
  const menu = { find: await keyOf('find'), focus: await keyOf('focus') };
  await p.click('.doc-menu [data-action="keys"]');
  await p.waitForSelector('dialog.shortcuts dt');
  const rows: Record<string, string> = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('dialog.shortcuts dt')].map((dt) => [dt.nextElementSibling?.textContent ?? '', dt.textContent ?? ''])));
  const dialog = { dup: rows['Duplicate'], undo: rows['Undo / redo block changes'], split: rows['Split the block at the caret'], move: rows['Move the block']?.split(' ')[0] };
  check(`shortcut labels (${platform}): the document menu and the shortcuts dialog`, menu.find === want.find && menu.focus === want.focus && dialog.dup === want.dup
    && dialog.undo === want.undo && dialog.split === want.split && dialog.move === want.move, { menu, dialog });
  await ctx.close();
}

check('no console errors, failed requests or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
