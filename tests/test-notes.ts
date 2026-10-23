// The notes' browser test on engine (the dev app, tests/integration/serve.ts): test-w6's page parts, which ran
// only against LuaLaTeX server, ported to the editor's own backend (it draws \webwidget now: webFeatures),
// plus the TODOs panel feed and light/dark. Written before the notes' Preact migration (app/src/notes/), so the
// migration is checked against the old behaviour. Waits on editorAPI.whenIdle(), the viewer's inspect.idle() and
// DOM conditions, never on fixed times.
//
//   node tests/test-notes.ts [http://localhost:8175/] [--no-paper] [--no-shots]
//
// 1. scan.js in Node (the paper's own comments, the transform, resolve) — as test-w6
// 2. the sample: chips where the notes are, colours, open/close (mouse, keyboard, outside), Edit, Resolve + Undo
// 3. maths in a note, a comment as a note, an author's colour across blocks, the menu (Comments as notes, Hide notes)
// 4. the TODOs panel: one row per note, the dots in the chips' colours, a row opens its chip; hidden notes: the
//    row opens the source instead
// 5. 390 px; light and dark (the chip's ink on its colour, the popover a surface of the theme, its text readable)
// 6. the paper's preamble with its authors' notes put back (--no-paper skips it: one more warm-up)
// Not here (LuaLaTeX server only): print mode (test-w6.ts section 4).
// Screenshots: test-results/notes/*.png; results: test-results/notes/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'notes');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8175/';
const SHOTS = !argv.includes('--no-shots');
const PAPER = !argv.includes('--no-paper');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const shot = async (page: any, name: string, opts: any = {}) => { if (SHOTS) await page.screenshot({ path: join(OUT, `${name}.png`), ...opts }); };

// ── 1. The source side, in Node ─────────────────────────────────────────────
const scan = await import(join(HERE, 'app/src/notes/scan.js'));
let paper: any = null;
// the notes document (tests/qa/fixtures/notes-doc.ts: note macros and commented-out code; it stands in for the former sample paper)
{ const F = await import('./qa/fixtures/notes-doc.ts'); paper = { preamble: F.PREAMBLE, blocks: F.BLOCKS }; }
if (paper) {
  const names = [...scan.todoMacros(paper.preamble).keys()];
  check('the notes preamble: its todo macros found', ['editor', 'referee', 'editorin', 'refereein', 'proofreader', 'typist'].every((n) => names.includes(n)), names.join(','));
  const groups = paper.blocks.flatMap((b: any) => scan.commentGroups(b.source, names).map((g: any) => ({ ...g, kind: b.kind })));
  const notes = groups.filter((g: any) => g.note);
  const compiled = notes.filter((g: any) => !['comment', 'macros'].includes(g.kind));
  check('notes doc: comments: conservative (commented-out code and text are not notes)', groups.length >= 9 && notes.length <= 3 && compiled.length === 0,
    `${groups.length} runs, ${notes.length} notes, ${compiled.length} in compiled blocks`);
  let sameLines = true;
  for (const b of paper.blocks) {
    const a = b.source.split('\n'), c = scan.transformComments(b.source, names).split('\n');
    if (a.length !== c.length) sameLines = false;
    a.forEach((l: string, i: number) => { if (l !== c[i] && !/^\s*%/.test(l)) sameLines = false; });
  }
  check('transform on the paper: line for line, only note comment lines change', sameLines);
}
{
  const src = 'Text one\n% please check the naturality square, $t^2$ and 50% of it_x\nText two \\todo{x} end.\n';
  const list = scan.notesIn(src, new Map(), { comments: true });
  check('notesIn: source order, comments and \\todo', list.map((n: any) => n.from).join(',') === 'comment,todo');
  check('resolve: "two \\todo{x} end" -> "two end"', scan.resolveNote(src, list[1]).includes('Text two end.'));
  check('resolve: a comment line goes with its newline', scan.resolveNote(src, list[0]).startsWith('Text one\nText two'));
}

// ── the page ──────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const problems: string[] = [];
async function newPage(url: string, { width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  await page.goto(BASE + url);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  return { ctx, page };
}
const api = (page: any, fn: string, ...args: any[]) => page.evaluate(([f, a]: [string, any[]]) => (window as any).editorAPI[f](...a), [fn, args]);
const idle = (page: any) => page.evaluate(async () => { await (window as any).editorAPI.whenIdle(); await (window as any).reflowtex?.inspect?.idle?.(); });
const idOf = (page: any, pred: string) => page.evaluate((p: string) => (window as any).editorAPI.blocks().find((b: any) => b.source.includes(p))?.id, pred);
const sourceOf = (page: any, id: string) => page.evaluate((i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source, id);
/** The block's chips: from, author, colour, box, and the glyph just before each on its line. */
const chipsIn = (page: any, id: string) => page.evaluate((i: string) => {
  const root = document.querySelector(`[data-part="page"] .blk[data-id="${i}"]`);
  if (!root) return [];
  const el = [...root.querySelectorAll('.blk-render > .latex-block')].find((e) => !e.classList.contains('incoming'));
  const glyphs = el ? [...el.querySelectorAll('svg text tspan')].map((t) => ({ t: t.textContent ?? '', r: t.getBoundingClientRect() })).filter((g) => g.t.trim() && g.r.width > 0) : [];
  return [...root.querySelectorAll('.rtx-note-chip')].map((c: any) => {
    const r = c.getBoundingClientRect();
    const mid = (r.top + r.bottom) / 2;
    const before = glyphs.filter((g) => g.r.right <= r.left + 1 && mid > g.r.top - 2 && mid < g.r.bottom + 2).sort((a, b) => b.r.right - a.r.right)[0];
    return { from: c.dataset.from, author: c.dataset.author, inline: c.dataset.inline === 'true', bg: c.style.getPropertyValue('--note-bg'), label: c.textContent.trim(),
      w: r.width, h: r.height, before: before?.t?.slice(-1) ?? null, gap: before ? r.left - before.r.right : null,
      expanded: c.getAttribute('aria-expanded'), haspopup: c.getAttribute('aria-haspopup'), aria: c.getAttribute('aria-label'), role: c.tagName };
  });
}, id);
const pop = async (page: any) => { await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.()); return page.evaluate(() => {
  const p = document.querySelector('.rtx-note-pop') as HTMLElement | null;
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const ts = [...p.querySelectorAll('.rtx-note-body tspan')];
  return { who: p.querySelector('.rtx-note-who')?.textContent, tag: p.querySelector('.rtx-note-tag')?.textContent, role: p.getAttribute('role'), label: p.getAttribute('aria-label'),
    text: ts.map((t) => t.textContent).join(''), fonts: [...new Set(ts.map((t) => t.getAttribute('font-family')))], left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    focused: p.contains(document.activeElement) || document.activeElement === p, actions: [...p.querySelectorAll('[data-action]')].map((b: any) => `${b.dataset.action}${b.disabled ? '(off)' : ''}`) };
}); };
const notesApi = (page: any, fn: string, ...args: any[]) => page.evaluate(([f, a]: [string, any[]]) => (window as any).editorAPI.notes()[f](...a), [fn, args]);
// Hide notes and Comments as notes left the document's ⋯ menu: they are in Document settings (Engine and view);
// the old menu labels name what to do there
async function menu(page: any, label: RegExp) {
  const which = /Comments as notes/.test(label.source) ? '#ss-comments' : '#ss-show-notes';
  const on = /Comments as notes: off|Show notes/.test(label.source);
  await page.evaluate(() => (window as any).editorAPI.settings().open({ tab: 'engine' }));
  await page.waitForSelector('#settings-sheet[open]');
  if (on) await page.check(`#settings-sheet ${which}`); else await page.uncheck(`#settings-sheet ${which}`);
  await page.click('#settings-sheet .ss-done');
  await page.waitForSelector('#settings-sheet', { state: 'detached' });
}
/** the ⋯ menu's actions (the notes items are no longer there) */
const menuActions = async (page: any) => { await page.click('#btn-doc-menu'); const a = await page.evaluate(() => [...document.querySelectorAll('.doc-menu [data-action]')].map((x: any) => x.dataset.action)); await page.keyboard.press('Escape'); return a; };
const visibleChips = (page: any) => page.evaluate(() => [...document.querySelectorAll('[data-part="page"] .rtx-note-chip')].filter((c) => c.getBoundingClientRect().width > 0).length);

const { ctx, page } = await newPage('?seed=sample&store=memory#/doc/sample');
check('backend: W1\'s engine, with web features (the notes wrapper is on it)', (await api(page, 'backend')) !== 'v1' && (await notesApi(page, 'keySalt', { webFeatures: true })) !== '', await api(page, 'backend'));

// ── 2. the sample ─────────────────────────────────────────────────────────────
const szId = await idOf(page, '\\editor{say why size matters}');
const nkId = await idOf(page, '\\referee{check the naturality square}');
{
  const todos = await api(page, 'todos');
  const all = await page.locator('[data-part="page"] .rtx-note-chip').count();
  check('sample: one chip per \\todo note', all === todos.length && all === 2, `${all} chips, ${todos.length} todos`);
  const sz = (await chipsIn(page, szId))[0], nk = (await chipsIn(page, nkId))[0];
  check('chip in its block, right after the word it follows ("way.")', !!sz && sz.before === '.' && sz.gap! >= -0.5 && sz.gap! < 8, sz);
  check('chip right after "(1)." in the proof', !!nk && nk.before === '.' && nk.gap! >= -0.5 && nk.gap! < 8, nk);
  check('chips are small (about a line high, under 2 em wide)', sz.h > 8 && sz.h < 24 && sz.w < 40, `${sz.w.toFixed(1)}×${sz.h.toFixed(1)} px`);
  check('chip: author initials, a button with a popup, labelled with the author and the message', sz.label === 'Ed' && nk.label === 'Re' && sz.role === 'BUTTON' && sz.haspopup === 'dialog'
    && /^Note by Editor: say why size matters/.test(sz.aria ?? ''), sz);
  check('colours: todonotes\' color= per author (blue!40, green!40)', sz.bg.toUpperCase() === '#9999FF' && nk.bg.toUpperCase() === '#99FF99', `${sz.bg} ${nk.bg}`);
  await page.locator(`[data-part="page"] .blk[data-id="${szId}"]`).scrollIntoViewIfNeeded();
  await shot(page, '01-sample-chips');

  const chip = page.locator(`[data-part="page"] .blk[data-id="${szId}"] .rtx-note-chip`).first();
  await chip.click();
  let p = await pop(page);
  check('click opens the popover: author, kind, message typeset by TeX', !!p && p.who === 'Editor' && p.tag === 'margin note' && /say/.test(p.text) && p.role === 'dialog' && /Editor/.test(p.label ?? ''),
    p && { who: p.who, tag: p.tag, text: p.text, label: p.label });
  check('popover: Edit and Resolve, both enabled', p?.actions.join() === 'edit,resolve', p?.actions);
  const chipBox = await chip.boundingBox();
  check('popover: next to its chip, inside the window', !!p && !!chipBox && p.left >= 0 && p.right <= 1280 && (p.top >= chipBox.y + chipBox.height - 1 || p.bottom <= chipBox.y + 1), { p, chipBox });
  check('open: aria-expanded, focus in the popover', (await chipsIn(page, szId))[0].expanded === 'true' && !!p?.focused);
  check('clicking a chip does not open the block\'s editor', !(await api(page, 'caret')));
  await shot(page, '02-popover');
  // the popover follows its chip on scroll
  const y0 = (await pop(page))!.top;
  await page.mouse.wheel(0, 120);
  await page.waitForFunction((y: number) => { const p = document.querySelector('.rtx-note-pop'); return !p || Math.abs(p.getBoundingClientRect().top - y) > 20; }, y0, { timeout: 5000 }).catch(() => {});
  const p2 = await pop(page);
  const cb2 = await chip.boundingBox();
  check('popover: stays on its chip when the page scrolls', !!p2 && !!cb2 && Math.abs((p2.top - (cb2.y + cb2.height)) - (y0 - (chipBox!.y + chipBox!.height))) < 2, { y0, top: p2?.top, chip: cb2?.y });
  await page.keyboard.press('Escape');
  check('Esc closes, focus back on the chip', !(await pop(page)) && (await page.evaluate(() => document.activeElement?.classList.contains('rtx-note-chip'))) &&
    (await chipsIn(page, szId))[0].expanded === 'false');
  await page.keyboard.press('Enter');
  check('Enter on the focused chip opens it', (await pop(page))?.who === 'Editor');
  await chip.click();
  check('the chip again closes it', !(await pop(page)));
  await page.keyboard.press(' ');
  check('Space on the focused chip opens it', (await pop(page))?.who === 'Editor');
  await page.mouse.click(5, 880);
  check('a press outside closes it', !(await pop(page)) && (await chipsIn(page, szId))[0].expanded === 'false');
  await chip.click();
  await page.locator(`[data-part="page"] .blk[data-id="${nkId}"] .rtx-note-chip`).first().click();
  check('one popover at a time: opening another chip closes the first', (await page.locator('.rtx-note-pop').count()) === 1 && (await pop(page))?.who === 'Referee'
    && (await chipsIn(page, szId))[0].expanded === 'false');
  await page.keyboard.press('Escape');

  // Edit: the block's source, caret in the note
  await page.locator(`[data-part="page"] .blk[data-id="${nkId}"] .rtx-note-chip`).first().click();
  await page.locator('.rtx-note-pop [data-action="edit"]').click();
  const caret = await api(page, 'caret');
  const nkSrc = await sourceOf(page, nkId);
  const at = nkSrc.indexOf('\\referee{');
  check('Edit opens the block\'s source with the caret in the note, the popover closed', caret?.id === nkId && caret.offset > at && caret.offset <= at + '\\referee{check the naturality square}'.length && !(await pop(page)), caret);
  await shot(page, '04-edit-source');
  await api(page, 'leave');
  await idle(page);

  // Resolve and undo
  const before = await sourceOf(page, szId);
  await page.locator(`[data-part="page"] .blk[data-id="${szId}"] .rtx-note-chip`).first().click();
  await page.locator('.rtx-note-pop [data-action="resolve"]').click();
  await idle(page);
  const after = await sourceOf(page, szId);
  check('Resolve removes the note from the source', !after.includes('\\editor') && after.endsWith('with nothing lost on the way.'), after.slice(-40));
  check('... its chip goes, the TODO list shrinks', (await chipsIn(page, szId)).length === 0 && (await api(page, 'todos')).length === 1);
  const toast = await page.textContent('#toast-text');
  check('... a toast offers Undo', toast === 'Note resolved' && await page.isVisible('#toast-undo'), String(toast));
  await shot(page, '05-resolved-toast');
  await page.click('#toast-undo');
  await idle(page);
  check('Undo puts the note back, its chip too', (await sourceOf(page, szId)) === before && (await chipsIn(page, szId)).length === 1);
}

// ── 3. maths, a comment as a note, colour per author, the menu ─────────────────
let mathId = '';
{
  mathId = await api(page, 'insert', 4, 'paragraph', String.raw`A note with maths\todo{Check $\alpha^2 + \sum_i x_i$ here} and a comment
% please double-check this claim for $t$-small sets
in the text; Alex's notes\todo[author=Alex Author]{first} have one colour.`);
  const adaId = await api(page, 'insert', 6, 'paragraph', String.raw`Another block\todo[author=Alex Author]{second} by Alex.`);
  await idle(page);
  const cs = await chipsIn(page, mathId);
  check('comment on its own line: a chip of its own kind (an icon, no initials)', cs.map((c: any) => c.from).join(',') === 'todo,comment,todo' && cs[1].label === '', cs.map((c: any) => `${c.from}:${c.label}`).join(','));
  const ada1 = cs[2], ada2 = (await chipsIn(page, adaId))[0];
  check('an author\'s colour is the same in every block, and not another author\'s', !!ada1 && ada1.bg === ada2?.bg && ada1.bg.toUpperCase() !== '#9999FF' && ada1.label === 'AA', `${ada1?.bg} ${ada2?.bg} ${ada1?.label}`);
  check('an authorless \\todo: an icon chip, todonotes\' colour softened', cs[0].label === '' && /^#[0-9a-f]{6}$/i.test(cs[0].bg), cs[0]);
  await page.locator(`[data-part="page"] .blk[data-id="${mathId}"] .rtx-note-chip`).first().click();
  const p = await pop(page);
  check('maths in a note is typeset (α and the Σ in maths fonts)', !!p && p.text.includes('α') && p.text.includes('Check') && p.fonts.length >= 2, p && { text: p.text, fonts: p.fonts });
  check('an authorless note\'s popover: "Note", margin note', p?.who === 'Note' && p?.tag === 'margin note', p);
  await shot(page, '06-maths-note');
  await page.keyboard.press('Escape');
  await page.locator(`[data-part="page"] .blk[data-id="${mathId}"] .rtx-note-chip[data-from="comment"]`).click();
  const pc = await pop(page);
  const ring = await page.evaluate((i: string) => getComputedStyle(document.querySelector(`[data-part="page"] .blk[data-id="${i}"] .rtx-note-chip[data-from="comment"]`)!).boxShadow, mathId);
  check('an open chip shows the focus ring (a comment\'s too)', (ring.match(/rgb/g) ?? []).length >= 3, ring);
  check('the comment\'s popover: "Comment in the source", "%", its text with maths', pc?.who === 'Comment in the source' && pc.tag === '%' && pc.text.includes('double'), pc && { who: pc.who, text: pc.text });
  await shot(page, '07-comment-note');
  await page.keyboard.press('Escape');
  { const acts = await menuActions(page); check('menu: advanced features off (the default): the ⋯ menu has no notes items (in Document settings)', !acts.includes('notes-hidden') && !acts.includes('notes-comments') && acts.includes('settings'), acts);
    await page.evaluate(() => (window as any).editorAPI.advanced?.(true));
    const on = await menuActions(page);
    await page.evaluate(() => (window as any).editorAPI.advanced?.(false));
    check('menu: advanced features on: Hide notes and Comments as notes are in the ⋯ menu', on.includes('notes-hidden') && on.includes('notes-comments'), on); }
  await menu(page, /Comments as notes: on/);
  await idle(page);
  const off = await chipsIn(page, mathId);
  check('menu: Comments as notes off -> the comment chip goes, the block recompiles', off.length === 2 && !off.some((c: any) => c.from === 'comment') && (await notesApi(page, 'settings')).comments === false,
    off.map((c: any) => c.from).join(','));
  await menu(page, /Comments as notes: off/);
  await idle(page);
  check('... and on again: back', (await chipsIn(page, mathId)).some((c: any) => c.from === 'comment'));
  const src0 = await sourceOf(page, mathId);
  await page.locator(`[data-part="page"] .blk[data-id="${mathId}"] .rtx-note-chip[data-from="comment"]`).click();
  await page.locator('.rtx-note-pop [data-action="resolve"]').click();
  await idle(page);
  const src1 = await sourceOf(page, mathId);
  check('Resolve on a comment removes its line, no blank line left; the toast says so', src1.split('\n').length === src0.split('\n').length - 1 && !src1.includes('double-check') && !src1.includes('\n\n')
    && (await page.textContent('#toast-text')) === 'Comment removed');
  await api(page, 'undo');
  await idle(page);
  check('⌘Z (the editor\'s undo) brings the comment back', (await sourceOf(page, mathId)) === src0);
  const hBefore = await page.evaluate((i: string) => document.querySelector(`[data-part="page"] .blk[data-id="${i}"]`)!.getBoundingClientRect().height, mathId);
  await menu(page, /Hide notes/);
  await idle(page);
  const hidden = await visibleChips(page);
  check('menu: Hide notes -> no chip shows', hidden === 0 && (await notesApi(page, 'settings')).hidden === true, `${hidden} visible`);
  await shot(page, '08-notes-hidden');
  // ── 4a. the TODOs panel with notes hidden: a row opens the source (no chip to open)
  await page.click('[data-ptab="todos"]');
  await page.locator('[data-panel-view="todos"] .td-row').filter({ hasText: 'Referee' }).first().click();
  const c2 = await api(page, 'caret');
  check('TODOs panel, notes hidden: a row opens the note\'s source instead (no popover)', !(await pop(page)) && c2?.id === nkId, c2);
  await api(page, 'leave');
  await idle(page);
  await menu(page, /Show notes/);
  await idle(page);
  const shown = await visibleChips(page);
  const hAfter = await page.evaluate((i: string) => document.querySelector(`[data-part="page"] .blk[data-id="${i}"]`)!.getBoundingClientRect().height, mathId);
  check('... Show notes: back, the block as before', shown >= 6 && Math.abs(hAfter - hBefore) < 0.5, `${shown} chips; height ${hBefore} -> ${hAfter}`);
}

// ── 4. the TODOs panel feed ───────────────────────────────────────────────────
{
  await page.click('[data-ptab="todos"]');
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-panel-view="todos"] .td-row')].map((r: any) => ({ block: r.dataset.block, who: r.querySelector('.td-author')?.textContent, msg: r.querySelector('.td-msg')?.textContent, bg: (r.querySelector('.dot') as HTMLElement)?.style.background })));
  const todos = await api(page, 'todos');
  check('TODOs panel: one row per note, in the document\'s order, with author and message', rows.length === todos.length && rows.length >= 5 && rows.every((r: any, i: number) => r.block === todos[i].blockId),
    rows.map((r: any) => `${r.who}: ${r.msg}`).join(' | '));
  check('TODOs panel: todonotes\' author= is the author there too', todos.filter((t: any) => t.author === 'Alex Author').length === 2);
  const colourOf = (who: string) => rows.find((r: any) => r.who === who)?.bg ?? '';
  const chipAA = (await chipsIn(page, mathId))[2]?.bg ?? '';
  const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; };
  check('TODOs panel dots in the chips\' colours (Editor\'s blue!40, Alex\'s hash colour)', /153,\s*153,\s*255/.test(colourOf('Editor')) && colourOf('Alex Author').replace(/\s/g, '').includes(rgb(chipAA).replace(/\s/g, '')),
    { sz: colourOf('Editor'), aa: colourOf('Alex Author'), chipAA });
  await page.evaluate(() => document.querySelector('[data-part="page"]')!.scrollTo(0, 0));
  await page.locator('[data-panel-view="todos"] .td-row').filter({ hasText: 'Referee' }).first().click();
  const p = await pop(page);
  const isOpen = await notesApi(page, 'isOpen');
  check('TODOs panel: clicking a note scrolls to its chip and opens it', !!p && p.who === 'Referee' && isOpen?.blockId === nkId, isOpen);
  const nkBox = await page.locator(`[data-part="page"] .blk[data-id="${nkId}"] .rtx-note-chip`).first().boundingBox();
  check('... the chip is in view, the popover by it', !!nkBox && nkBox.y > 0 && nkBox.y < 900 && !!p && Math.abs(p.top - (nkBox.y + nkBox.height)) < 40, { nkBox, top: p?.top });
  await shot(page, '03-from-todo-panel');
  await page.keyboard.press('Escape');
  // a new note in a block: the panel follows
  const n0 = rows.length;
  const src = await sourceOf(page, nkId);
  await api(page, 'setSource', nkId, `${src} More.\\referee{a second one}`);
  await idle(page);
  const n1 = await page.locator('[data-panel-view="todos"] .td-row').count();
  check('TODOs panel: a note added in the source appears in the panel and as a chip', n1 === n0 + 1 && (await chipsIn(page, nkId)).length === 2, `${n0} -> ${n1}`);
  await api(page, 'setSource', nkId, src);
  await idle(page);
}

// ── 5. phone width, light and dark ─────────────────────────────────────────────
{
  await page.setViewportSize({ width: 390, height: 800 });
  await idle(page);
  await page.locator(`[data-part="page"] .blk[data-id="${mathId}"] .rtx-note-chip`).first().click();
  const p = await pop(page);
  check('390 px: the popover fits the window', !!p && p.left >= 0 && p.right <= 390, p && { left: p.left, right: p.right });
  await shot(page, '09-phone');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await idle(page);
}
{
  const measure = (sel: string, texts: string[]) => page.evaluate(([s, ts]: [string, string[]]) => {
    const cv = document.createElement('canvas').getContext('2d')!;
    const rgba = (c: string) => {
      const sr = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
      if (sr) return [+sr[1] * 255, +sr[2] * 255, +sr[3] * 255, sr[4] == null ? 1 : +sr[4]];
      cv.fillStyle = '#000'; cv.fillStyle = c; const v = cv.fillStyle as string;
      if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
      const m = v.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const painted = (el: Element | null): number[] => {
      const stack: number[][] = [];
      for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; }
      let acc = [255, 255, 255, 1];
      for (const c of stack.reverse()) acc = over(c, acc);
      return acc;
    };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const els = [...document.querySelectorAll(s)];
    if (!els.length) return null;
    const page = painted(document.body);
    return els.map((el) => {
      const bg = painted(el);
      const contrast = Object.fromEntries(ts.map((t) => { const x = el.matches(t) ? el : el.querySelector(t); if (!x) return [t, null];
        return [t, Math.round(ratio(over(rgba(getComputedStyle(x).color), painted(x)), painted(x)) * 10) / 10]; }));
      return { bg: bg.slice(0, 3).map(Math.round), lBg: Math.round(lum(bg) * 1000) / 1000, lPage: Math.round(lum(page) * 1000) / 1000, contrast };
    });
  }, [sel, texts]);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await page.waitForFunction((t: string) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme);
    await idle(page);
    const chips = await measure(`[data-part="page"] .blk[data-id="${mathId}"] .rtx-note-chip`, ['.rtx-note-chip']);
    check(`${theme}: every chip's ink reads on its colour (4.5:1)`, !!chips && chips.every((c: any) => c.contrast['.rtx-note-chip'] >= 4.5), chips);
    await page.locator(`[data-part="page"] .blk[data-id="${mathId}"] .rtx-note-chip`).first().click();
    await pop(page);
    const m = (await measure('.rtx-note-pop', ['.rtx-note-who', '.rtx-note-tag', '[data-action="edit"]']))?.[0];
    await shot(page, `10-popover-${theme}`, { clip: await page.locator('.rtx-note-pop').boundingBox() });
    check(`${theme}: the popover is a surface of the theme (${theme === 'dark' ? 'no bright panel' : 'light'}), its labels and buttons readable`,
      !!m && (theme === 'dark' ? m.lBg <= m.lPage + 0.06 : m.lBg > 0.8) && Object.values(m.contrast).every((c: any) => c == null || c >= 4.5), m);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
}
await ctx.close();

// ── 6. the paper's preamble, its authors' notes put back ─────────────────────────
if (paper && PAPER) {
  const { ctx: c2, page: pg } = await newPage('?seed=sample&store=memory#/doc/sample');
  const pick = (pred: (b: any) => boolean) => paper.blocks.find(pred);
  const intro = pick((b: any) => b.kind === 'paragraph' && b.source.includes('Blocks are the dense analogue') && b.source.length < 900);
  // the seed is nested now (a long proof is a container of paragraphs): the block with the comments is either
  const withComments = pick((b: any) => b.kind === 'proof' && b.source.includes('% Observe that')) ?? pick((b: any) => b.source.includes('% Observe that'));
  const theorem = pick((b: any) => b.kind === 'theorem' && !b.source.includes('%') && /\\end\{/.test(b.source));
  const blocks = [
    { kind: 'heading', source: '\\section{Notes put back}' },
    { kind: 'paragraph', source: `${intro.source.trim()}\\editor{check}\n\\referee{IMO we can remove the paragraph about $\\tilde\\nabla_{r-1}$.}` },
    { kind: theorem.kind, source: theorem.source.trim().replace(/\\end\{([^}]*)\}\s*$/, '\\todo{cite}\n\\end{$1}') },
    { kind: 'paragraph', source: 'Before the proof.\n\\editorin{compare with \\cite{ref:other}. The strategy is similar, but it does not include $\\set{v_i}$.}' },
    { kind: withComments.kind, source: withComments.source.trim() },
  ];
  const docId = await pg.evaluate(async ({ pre, blocks }: any) => (window as any).editorAPI.store().createDoc({ title: 'Paper notes', preamble: pre, bib: { kind: 'none', source: '' }, blocks }), { pre: paper.preamble, blocks });
  await api(pg, 'open', docId);
  await idle(pg);
  const bs = await api(pg, 'blocks');
  const errs = bs.filter((b: any) => b.state === 'error').map((b: any) => `${b.kind}: ${b.errors[0]?.message}`);
  check('notes doc: blocks typeset on the engine with the paper\'s preamble', errs.length === 0, errs.join('; ') || `${bs.length} blocks`);
  const per = await Promise.all(bs.map((b: any) => chipsIn(pg, b.id)));
  const flat = per.flat();
  check('paper: \\editor, \\referee, \\todo, \\editorin each a chip; no chip from commented-out text', flat.length === 4 && per[4].length === 0,
    per.map((c: any[], i: number) => `${bs[i].kind}:${c.map((x) => `${x.label || x.from}`).join('+')}`).join(' '));
  const byAuthor = (a: string) => flat.find((c: any) => c.author === a && !c.inline);
  check('notes doc: colours: Editor blue!40, Referee green!40', byAuthor('Editor')?.bg.toUpperCase() === '#9999FF' && byAuthor('Referee')?.bg.toUpperCase() === '#99FF99');
  check('paper: \\editorin is an inline note (its own shape)', per[3][0]?.inline === true && per[3][0]?.author === 'Editor');
  await pg.locator(`[data-part="page"] .blk[data-id="${bs[1].id}"] .rtx-note-chip[data-author="Referee"]`).click();
  const p = await pop(pg);
  check('paper: Referee\'s note typeset, the "Referee:" prefix taken off', !!p && p.who === 'Referee' && p.text.includes('IMO') && !p.text.startsWith('Referee:'), p && p.text);
  await pg.keyboard.press('Escape');
  const td = await api(pg, 'todos');
  check('paper: the TODO panel lists them by author', td.length === 4 && td.filter((t: any) => t.author === 'Editor').length === 2 && td.some((t: any) => t.author === 'Referee'), td.map((t: any) => t.author).join(','));
  await c2.close();
}

check('no console errors or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nnotes: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
