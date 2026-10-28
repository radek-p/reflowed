// test: notes as chips in the reflowed document (src/notes/,
// tex/rtx-notes.sty), in headless Chromium against dev server (the
// editor page + the public LuaLaTeX pipeline: src/notes/dev/serve.ts, where
// the companion's widgets work today). Waits on editorAPI.whenIdle() and DOM
// conditions only, never on fixed times.
//
//   node tests/test-w6.ts http://localhost:8156/ [--no-shots]
//
// 1. scan.js on the paper's own comments (the heuristic), the transform, resolve
// 2. the sample: chips where the notes are, colours, open/close (mouse and
//    keyboard), maths in a note, a comment as a note, Resolve + undo, Edit,
//    the TODO panel, the menu (Comments as notes, Hide notes), phone width
// 3. the paper's preamble and blocks with its authors' notes put back
// 4. print mode: a whole document through plain lualatex, with and without
//    rtx-notes.sty: the same text, todonotes' margin notes in it
// Screenshots: test-results/w6/*.png; results: test-results/w6/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'w6');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8156/';
const SHOTS = !process.argv.includes('--no-shots');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const shot = async (page: any, name: string, opts: any = {}) => { if (SHOTS) await page.screenshot({ path: join(OUT, `${name}.png`), ...opts }); };

// ── 1. The source side, in Node ─────────────────────────────────────────────
const scan = await import(join(HERE, 'app/src/notes/scan.js'));
// the notes document (tests/qa/fixtures/notes-doc.ts: note macros and commented-out code)
let paper: any = null;
{ const F = await import('./qa/fixtures/notes-doc.ts'); paper = { preamble: F.PREAMBLE, blocks: F.BLOCKS }; }
if (paper) {
  const names = [...scan.todoMacros(paper.preamble).keys()];
  check('the notes preamble: its todo macros found', ['editor', 'referee', 'editorin', 'refereein', 'proofreader', 'typist'].every((n) => names.includes(n)), names.join(','));
  const groups = paper.blocks.flatMap((b: any) => scan.commentGroups(b.source, names).map((g: any) => ({ ...g, kind: b.kind })));
  const notes = groups.filter((g: any) => g.note);
  const compiled = notes.filter((g: any) => !['comment', 'macros'].includes(g.kind));
  check('notes doc: comments: conservative (commented-out code and text are not notes)', groups.length >= 9 && notes.length <= 3 && compiled.length === 0,
    `${groups.length} own-line comment runs, ${notes.length} read as notes (${notes.map((g: any) => `${g.kind}: "${g.text.slice(0, 40)}…"`).join('; ')}), ${compiled.length} of them in compiled blocks`);
  const why = (start: string) => groups.find((g: any) => g.text.startsWith(start))?.why;
  check('notes doc: comments: a commented-out \\editorin{…} is code', why('\\editorin{Suggestion') === 'starts like code', String(why('\\editorin{Suggestion')));
  check('notes doc: comments: commented-out prose with \\eqref / \\emph is code', why('Statements of the form') === 'a LaTeX command' && why('On the way, we introduce') === 'a command outside maths');
  check('notes doc: comments: commented-out mathematical text is not a note', why('Observe that $u') === 'maths-heavy (commented-out text)');
  check('notes doc: comments: a display in a comment is code', why('In particular, for every category') === 'a display');
  // the transform: line for line, every other line unchanged
  let sameLines = true, changed = 0;
  for (const b of paper.blocks) {
    const t = scan.transformComments(b.source, names);
    const a = b.source.split('\n'), c = t.split('\n');
    if (a.length !== c.length) sameLines = false;
    a.forEach((l: string, i: number) => { if (l !== c[i]) { changed++; if (!/^\s*%/.test(l)) sameLines = false; } });
  }
  check('transform on the paper: line for line, only note comment lines change', sameLines, `${changed} lines changed`);
}
{
  const src = 'Text one\n% please check the naturality square, $t^2$ and 50% of it_x\nText two \\todo{x} end.\n  % \\begin{lemma}\n  % \\end{lemma}\n';
  const t = scan.transformComments(src, []);
  check('transform: a note comment becomes \\rtxcomment{…}, specials escaped', t.split('\n')[1] === '\\rtxcomment{please check the naturality square, $t^2$ and 50\\% of it\\_x}' && t.split('\n')[3] === '  % \\begin{lemma}', JSON.stringify(t.split('\n')[1]));
  const list = scan.notesIn(src, new Map(), { comments: true });
  check('notesIn: source order, comments and \\todo', list.map((n: any) => n.from).join(',') === 'comment,todo', list.map((n: any) => `${n.from}@${n.offset}`).join(' '));
  const r1 = scan.resolveNote(src, list[1]);
  check('resolve: "two \\todo{x} end" -> "two end"', r1.includes('Text two end.'), JSON.stringify(r1.split('\n')[2]));
  const r0 = scan.resolveNote(src, list[0]);
  check('resolve: a comment line goes with its newline (no blank line made)', r0.startsWith('Text one\nText two') && !r0.includes('\n\n'), JSON.stringify(r0.slice(0, 30)));
  const own = 'Before.\n\\editor{alone on a line}\nAfter.';
  const n2 = scan.notesIn(own, new Map([['szym', { author: 'Editor', inline: false }]]), { comments: true });
  check('resolve: a note alone on its line takes the line', scan.resolveNote(own, n2[0]) === 'Before.\nAfter.');
  const pre = scan.notesPreamble('\\newcommand{\\editor}[1]{\\todo[color=blue!40]{Editor: #1}}');
  check('preamble: rtx-notes after it, authors declared', /\\usepackage\{rtx-notes\}\n\\rtxnoteauthor\{szym\}\{Editor\}/.test(pre));
}

// ── the page ──────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const problems: string[] = [];
async function newPage(url: string, { width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
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
const idOf = (page: any, pred: string) => page.evaluate((p: string) => (window as any).editorAPI.blocks().find((b: any) => b.source.includes(p))?.id, pred);
const sourceOf = (page: any, id: string) => page.evaluate((i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source, id);
/** The block's chips: from, author, colour, box, and the glyph just before each on its line. */
const chipsIn = (page: any, id: string) => page.evaluate((i: string) => {
  const root = document.querySelector(`.blk[data-id="${i}"]`);
  if (!root) return [];
  const el = [...root.querySelectorAll('.blk-render > .latex-block')].find((e) => !e.classList.contains('incoming'));
  const glyphs = el ? [...el.querySelectorAll('svg text tspan')].map((t) => ({ t: t.textContent ?? '', r: t.getBoundingClientRect() })).filter((g) => g.t.trim() && g.r.width > 0) : [];
  return [...root.querySelectorAll('.rtx-note-chip')].map((c: any) => {
    const r = c.getBoundingClientRect();
    const mid = (r.top + r.bottom) / 2;
    const before = glyphs.filter((g) => g.r.right <= r.left + 1 && mid > g.r.top - 2 && mid < g.r.bottom + 2).sort((a, b) => b.r.right - a.r.right)[0];
    return { from: c.dataset.from, author: c.dataset.author, inline: c.dataset.inline === 'true', bg: c.style.getPropertyValue('--note-bg'), label: c.textContent,
      w: r.width, h: r.height, visible: r.width > 0 && getComputedStyle(c).display !== 'none', before: before?.t ?? null, gap: before ? r.left - before.r.right : null,
      expanded: c.getAttribute('aria-expanded'), role: c.tagName };
  });
}, id);
const pop = async (page: any) => { await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.()); return page.evaluate(() => {
  const p = document.querySelector('.rtx-note-pop') as HTMLElement | null;
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const ts = [...p.querySelectorAll('.rtx-note-body tspan')];
  return { who: p.querySelector('.rtx-note-who')?.textContent, tag: p.querySelector('.rtx-note-tag')?.textContent, role: p.getAttribute('role'),
    text: ts.map((t) => t.textContent).join(''), fonts: [...new Set(ts.map((t) => t.getAttribute('font-family')))], left: r.left, right: r.right, top: r.top,
    focused: p.contains(document.activeElement) || document.activeElement === p };
}); };
const notesApi = (page: any, fn: string, ...args: any[]) => page.evaluate(([f, a]: [string, any[]]) => (window as any).editorAPI.notes()[f](...a), [fn, args]);
// Hide notes and Comments as notes: the Settings panel's Notes section (the main menu's Settings…); the old menu labels
// name what to do there (the panel closed again after)
async function menu(page: any, label: RegExp) {
  const which = /Comments as notes/.test(label.source) ? '#set-comments' : '#set-note-chips';
  const on = /Comments as notes: off|Show notes/.test(label.source);
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  const box = page.locator(`[data-panel-view="app-settings"] ${which}`);
  if (on) await box.check(); else await box.uncheck();
  await page.click('[data-ptab="app-settings"] [data-action="close-panel"]');
  await page.waitForFunction(() => !document.querySelector('[data-panel-view="app-settings"]'));
}
/** a block brought into view (the viewer draws a block's lines, and so its chips, when they come into view) */
const inView = async (page: any, id: string) => {
  await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }), id);
  await idle(page);
  await page.evaluate(async () => { await (window as any).reflowtex?.inspect?.idle?.(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
};
/** the main menu's actions, its Document submenu's with them (no notes items there) */
const menuActions = async (page: any) => {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="document"]');
  const a = await page.evaluate(() => [...document.querySelectorAll('.main-menu [data-action]')].map((x: any) => x.dataset.action));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  return a;
};

// ── 2. The sample (LuaLaTeX backend) ────────────────────────────────────────
const { page } = await newPage('?backend=lua&store=memory&seed=sample#/doc/sample');
{
  check('backend: the LuaLaTeX dev backend', (await api(page, 'backend')) === 'lua');
  // the viewer draws a block (its chips with it) when it comes into view: each note's block is looked at in view
  const todos = await api(page, 'todos');
  let all = 0;
  for (const bid of [...new Set(todos.map((t: any) => t.blockId as string))]) { await inView(page, bid); all += (await chipsIn(page, bid)).length; }
  check('sample: one chip per \\todo note (each block in view)', all === todos.length && all === 2, `${all} chips, ${todos.length} todos`);
  const szId = await idOf(page, '\\editor{say why size matters}');
  const nkId = await idOf(page, '\\referee{check the naturality square}');
  const sz = (await chipsIn(page, szId))[0], nk = (await chipsIn(page, nkId))[0];
  check('chip in its block, right after the word it follows ("way.")', !!sz && sz.before === '.' && sz.gap! >= -0.5 && sz.gap! < 8, JSON.stringify(sz));
  check('chip right after "(1)." in the proof', !!nk && nk.before === '.' && nk.gap! >= -0.5 && nk.gap! < 8, JSON.stringify(nk));
  check('chips are small (about a line high, under 2 em wide)', sz.h > 8 && sz.h < 24 && sz.w < 40, `${sz.w.toFixed(1)}×${sz.h.toFixed(1)} px`);
  check('chip: author initials, a button', sz.label === 'Ed' && nk.label === 'Re' && sz.role === 'BUTTON', `${sz.label} ${nk.label}`);
  check('colours: todonotes\' color= per author (blue!40, green!40)', sz.bg.toUpperCase() === '#9999FF' && nk.bg.toUpperCase() === '#99FF99', `${sz.bg} ${nk.bg}`);
  await page.locator(`.blk[data-id="${szId}"]`).scrollIntoViewIfNeeded();
  await shot(page, '01-sample-chips');

  // open / close with the mouse
  const chip = page.locator(`.blk[data-id="${szId}"] .rtx-note-chip`).first();
  await chip.click();
  let p = await pop(page);
  check('click opens the popover: author, kind, message typeset by TeX', !!p && p.who === 'Editor' && p.tag === 'margin note' && p.text.includes('saywhysparsematters'.slice(0, 3)) && p.role === 'dialog',
    JSON.stringify(p && { who: p.who, tag: p.tag, text: p.text }));
  check('open: aria-expanded, focus in the popover', (await chipsIn(page, szId))[0].expanded === 'true' && !!p?.focused);
  check('clicking a chip does not open the block\'s editor', !(await api(page, 'caret')));
  await shot(page, '02-popover');
  await page.keyboard.press('Escape');
  check('Esc closes, focus back on the chip', !(await pop(page)) && (await page.evaluate(() => document.activeElement?.classList.contains('rtx-note-chip'))) &&
    (await chipsIn(page, szId))[0].expanded === 'false');
  // keyboard
  await page.keyboard.press('Enter');
  check('Enter on the focused chip opens it', (await pop(page))?.who === 'Editor');
  await page.mouse.click(5, 880);
  check('a press outside closes it', !(await pop(page)));

  // the TODO panel: a row opens its chip
  await page.click('[data-panel="todos"]');
  const dot = await page.evaluate(() => [...document.querySelectorAll('#panel-todos .td-row')].map((r) => ({ who: r.querySelector('.td-author')?.textContent, bg: (r.querySelector('.dot') as HTMLElement)?.style.background })));
  const bgSz = dot.find((d: any) => d.who === 'Editor')?.bg ?? '';
  check('TODO panel dots in the chips\' colours', /153,\s*153,\s*255/.test(bgSz), JSON.stringify(dot));
  await page.locator('#panel-todos .td-row').filter({ hasText: 'Referee' }).first().click();
  p = await pop(page);
  const isOpen = await notesApi(page, 'isOpen');
  check('TODO panel: clicking a note scrolls to its chip and opens it', !!p && p.who === 'Referee' && isOpen?.blockId === nkId, JSON.stringify(isOpen));
  const nkBox = await page.locator(`.blk[data-id="${nkId}"] .rtx-note-chip`).first().boundingBox();
  check('... the chip is in view', !!nkBox && nkBox.y > 0 && nkBox.y < 900, JSON.stringify(nkBox));
  await shot(page, '03-from-todo-panel');
  // Edit: the block's source, caret in the note
  await page.locator('.rtx-note-pop [data-action="edit"]').click();
  const caret = await api(page, 'caret');
  const nkSrc = await sourceOf(page, nkId);
  const at = nkSrc.indexOf('\\referee{');
  check('Edit opens the block\'s source with the caret in the note', caret?.id === nkId && caret.offset > at && caret.offset <= at + '\\referee{check the naturality square}'.length,
    JSON.stringify(caret));
  await shot(page, '04-edit-source');
  await api(page, 'leave');
  await idle(page);

  // Resolve and undo
  const before = await sourceOf(page, szId);
  await page.locator(`.blk[data-id="${szId}"] .rtx-note-chip`).first().click();
  await page.locator('.rtx-note-pop [data-action="resolve"]').click();
  await idle(page);
  const after = await sourceOf(page, szId);
  check('Resolve removes the note from the source', !after.includes('\\editor') && after.endsWith('with nothing lost on the way.'), JSON.stringify(after.slice(-40)));
  check('... its chip goes, the TODO list shrinks', (await chipsIn(page, szId)).length === 0 && (await api(page, 'todos')).length === 1);
  const toast = await page.textContent('#toast-text');
  check('... a toast offers Undo', toast === 'Note resolved' && await page.isVisible('#toast-undo'), String(toast));
  await shot(page, '05-resolved-toast');
  await page.click('#toast-undo');
  await idle(page);
  check('Undo puts the note back, its chip too', (await sourceOf(page, szId)) === before && (await chipsIn(page, szId)).length === 1);
}

// maths in a note, a comment as a note, an authorless note, colour per author
let mathId = '';
{
  mathId = await api(page, 'insert', 4, 'paragraph', String.raw`A note with maths\todo{Check $\alpha^2 + \sum_i x_i$ here} and a comment
% please double-check this claim for $t$-small sets
in the text; Alex's notes\todo[author=Alex Author]{first} have one colour.`);
  const adaId = await api(page, 'insert', 6, 'paragraph', String.raw`Another block\todo[author=Alex Author]{second} by Alex.`);
  await idle(page);
  const cs = await chipsIn(page, mathId);
  check('comment on its own line: a chip of its own kind', cs.map((c: any) => c.from).join(',') === 'todo,comment,todo', cs.map((c: any) => c.from).join(','));
  const ada1 = cs[2], ada2 = (await chipsIn(page, adaId))[0];
  check('an author\'s colour is the same in every block, and not another author\'s', !!ada1 && ada1.bg === ada2?.bg && ada1.bg.toUpperCase() !== '#9999FF' && ada1.label === 'AA', `${ada1?.bg} ${ada2?.bg} ${ada1?.label}`);
  const adaTodos = (await api(page, 'todos')).filter((t: any) => t.author === 'Alex Author').length;
  check('TODO panel: todonotes\' author= is the author there too', adaTodos === 2, `${adaTodos}`);
  await page.locator(`.blk[data-id="${mathId}"] .rtx-note-chip`).first().click();
  const p = await pop(page);
  check('maths in a note is typeset (α, Σ, subscripts in maths fonts)', !!p && p.text.includes('α') && p.fonts.some((f: string) => /cmmi/.test(f)) && p.text.includes('Check'), JSON.stringify(p && { text: p.text, fonts: p.fonts }));
  await shot(page, '06-maths-note');
  await page.keyboard.press('Escape');
  await page.locator(`.blk[data-id="${mathId}"] .rtx-note-chip[data-from="comment"]`).click();
  const pc = await pop(page);
  check('the comment\'s popover: "Comment in the source", its text with maths', pc?.who === 'Comment in the source' && pc.text.includes('double') && pc.fonts.some((f: string) => /cmmi/.test(f)), JSON.stringify(pc && { who: pc.who, text: pc.text }));
  await shot(page, '07-comment-note');
  // Comments as notes: off, then on
  await page.keyboard.press('Escape');
  { const acts = await menuActions(page); check('menu: no notes items in the main menu (they are the Settings panel\'s Notes section); Settings… and Document settings… there', !acts.includes('notes-hidden') && !acts.includes('notes-comments') && acts.includes('settings') && acts.includes('doc-settings'), acts); }
  await menu(page, /Comments as notes: on/);
  await idle(page);
  const off = await chipsIn(page, mathId);
  check('menu: Comments as notes off -> the comment chip goes, the block recompiles', off.length === 2 && !off.some((c: any) => c.from === 'comment') && (await notesApi(page, 'settings')).comments === false,
    off.map((c: any) => c.from).join(','));
  await menu(page, /Comments as notes: off/);
  await idle(page);
  check('... and on again: back', (await chipsIn(page, mathId)).some((c: any) => c.from === 'comment'));
  // resolving a comment removes its line
  const src0 = await sourceOf(page, mathId);
  await page.locator(`.blk[data-id="${mathId}"] .rtx-note-chip[data-from="comment"]`).click();
  await page.locator('.rtx-note-pop [data-action="resolve"]').click();
  await idle(page);
  const src1 = await sourceOf(page, mathId);
  check('Resolve on a comment removes its line, no blank line left', src1.split('\n').length === src0.split('\n').length - 1 && !src1.includes('double-check') && !src1.includes('\n\n'));
  await api(page, 'undo');
  await idle(page);
  // Hide notes
  const hBefore = await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)!.getBoundingClientRect().height, mathId);
  await menu(page, /Hide notes/);
  await idle(page);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('.rtx-note-chip')].filter((c) => c.getBoundingClientRect().width > 0).length);
  check('menu: Hide notes -> no chip shows, the lines close up', hidden === 0 && (await notesApi(page, 'settings')).hidden === true, `${hidden} visible`);
  await shot(page, '08-notes-hidden');
  await menu(page, /Show notes/);
  await idle(page);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.rtx-note-chip')].filter((c) => c.getBoundingClientRect().width > 0).length);
  const hAfter = await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)!.getBoundingClientRect().height, mathId);
  check('... Show notes: back, the block as before', shown >= 6 && Math.abs(hAfter - hBefore) < 0.5, `${shown} chips; height ${hBefore} -> ${hAfter}`);
}
// phone width: the popover stays in the window
{
  await page.setViewportSize({ width: 390, height: 800 });
  await idle(page);
  await page.locator(`.blk[data-id="${mathId}"] .rtx-note-chip`).first().click();
  const p = await pop(page);
  check('390 px: the popover fits the window', !!p && p.left >= 0 && p.right <= 390, JSON.stringify(p && { left: p.left, right: p.right }));
  await shot(page, '09-phone');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
}

// ── 3. The paper's preamble and blocks, its authors' notes put back ─────────
if (paper) {
  const pick = (pred: (b: any) => boolean) => paper.blocks.find(pred);
  const intro = pick((b: any) => b.kind === 'paragraph' && b.source.includes('Blocks are the dense analogue') && b.source.length < 900);
  const withComments = pick((b: any) => b.kind === 'proof' && b.source.includes('% Observe that'));
  const theorem = pick((b: any) => b.kind === 'theorem' && !b.source.includes('%'));
  const blocks = [
    { kind: 'heading', source: '\\section{Notes put back}' },
        { kind: 'paragraph', source: `${intro.source.trim()}\\editor{check}\n\\referee{IMO we can remove the paragraph about $\\tilde\\nabla_{r-1}$.}` },
    { kind: theorem.kind, source: theorem.source.trim().replace(/\\end\{([^}]*)\}\s*$/, '\\todo{cite}\n\\end{$1}') },
    { kind: 'paragraph', source: 'Before the proof.\n\\editorin{compare with \\cite{ref:other}. The strategy is similar, but it does not include $\\set{v_i}$.}' },
    { kind: withComments.kind, source: withComments.source.trim() },
  ];
  const docId = await page.evaluate(async ({ pre, blocks }: any) => {
    const st = (window as any).editorAPI.store();
    return st.createDoc({ title: 'Paper notes (W6)', preamble: pre, bib: { kind: 'none', source: '' }, blocks });
  }, { pre: paper.preamble, blocks });
  await api(page, 'open', docId);
  await idle(page);
  const bs = await api(page, 'blocks');
  const errs = bs.filter((b: any) => b.state === 'error').map((b: any) => `${b.kind}: ${b.errors[0]?.message}`);
  check('notes doc: blocks typeset on LuaLaTeX with the paper\'s preamble', errs.length === 0 && bs.filter((b: any) => b.mounted).length === bs.length, errs.join('; ') || `${bs.length} blocks`);
  const per = await Promise.all(bs.map((b: any) => chipsIn(page, b.id)));
  const flat = per.flat();
  check('paper: \\editor, \\referee, \\todo, \\editorin each a chip; no chip from commented-out text', flat.length === 4 && per[4].length === 0,
    per.map((c: any[], i: number) => `${bs[i].kind}:${c.map((x) => `${x.label || x.from}`).join('+')}`).join(' '));
  const byAuthor = (a: string) => flat.find((c: any) => c.author === a && !c.inline);
  check('notes doc: colours: Editor blue!40, Referee green!40', byAuthor('Editor')?.bg.toUpperCase() === '#9999FF' && byAuthor('Referee')?.bg.toUpperCase() === '#99FF99');
  const plain = per[2][0];
  check('paper: a plain \\todo takes todonotes\' package colour (yellow), softened', !!plain && plain.author === '' && plain.bg.toUpperCase() === '#FFFF8C', JSON.stringify(plain));
  check('paper: \\editorin is an inline note (square chip)', per[3][0]?.inline === true && per[3][0]?.author === 'Editor');
  await page.locator(`.blk[data-id="${bs[1].id}"] .rtx-note-chip[data-author="Referee"]`).click();
  const p = await pop(page);
  check('paper: Referee\'s note typeset with its maths (maths fonts), the "Referee:" prefix taken off', !!p && p.who === 'Referee' && p.text.includes('IMO') && p.fonts.some((f: string) => /cmsy|cmmi/.test(f)) && !p.text.startsWith('Referee:'), JSON.stringify(p && p.text));
  await shot(page, '10-paper-notes');
  await page.keyboard.press('Escape');
  const td = await api(page, 'todos');
  check('paper: the TODO panel lists them by author', td.length === 4 && td.filter((t: any) => t.author === 'Editor').length === 2 && td.some((t: any) => t.author === 'Referee'), td.map((t: any) => t.author).join(','));
}

// ── 4. Print mode ───────────────────────────────────────────────────────────
{
  const preamble = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage[textsize=small, textwidth=2cm, color=yellow]{todonotes}
\newcommand{\referee}[1]{\todo[color=green!40]{Referee: #1}}
\newcommand{\editor}[1]{\todo[color=blue!40]{Editor: #1}}
\newcommand{\editorin}[1]{\todo[inline,size=\normalsize,color=blue!40,caption={}]{Editor: #1}}`;
  const body = String.raw`\begin{document}
Functors are the maps between categories.\editor{check} They preserve composition.\referee{IMO we can remove $\tilde\nabla_{r-1}$.}
\editorin{compare with the strategy} Then \todo{cite} a claim.
\end{document}`;
  const run = async (tex: string) => (await fetch(new URL('api/print', BASE), { method: 'POST', body: JSON.stringify({ tex }) })).json();
  const plainRun = await run(`${preamble}\n${body}`);
  const withRun = await run(`${preamble}\n\\usepackage{rtx-notes}\n\\rtxnoteauthor{editor}{Editor}\\rtxnoteauthor{referee}{Referee}\\rtxnoteauthor{editorin}{Editor}\n${body}`);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  check('print: the document compiles with rtx-notes.sty (plain lualatex)', plainRun.ok && withRun.ok, withRun.log);
  check('print: the same PDF text with and without it', norm(plainRun.text) === norm(withRun.text), norm(withRun.text).slice(0, 160));
  check('print: todonotes\' notes are there (margin and inline)', ['Editor:', 'check', 'Referee: IMO', 'compare with the strategy', 'cite'].every((s) => norm(withRun.text).includes(s)), norm(withRun.text).slice(0, 200));
}

// ── 5. The page's health ────────────────────────────────────────────────────
check('no console errors, page errors or failed requests', problems.length === 0, problems.slice(0, 5).join(' | '));

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nW6: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
