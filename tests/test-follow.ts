// Two tabs on one document: what one writes, the other follows without a reload (app/src/doc/follow.ts). Two pages
// in one browser context (one IndexedDB, the store's BroadcastChannel between them), each the editor on the same small
// document. Tab A edits, inserts, moves and deletes blocks and renames the document; tab B shows each change typeset,
// the numbering following, only the changed blocks typeset there. Then the editor-open cases in B: nothing typed (the
// editor takes A's text), typed and not yet written (B's is kept, A's offered by the toast: Use theirs), deleted in A
// (B's editor closes, the toast says why). Last, the document deleted in A: B's tab closes and says why. Every wait is on state (the pages' editorAPI), never on a time.
//   node tests/test-follow.ts [http://127.0.0.1:8150/]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:8150/').replace(/\/?$/, '/');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d.slice(0, 700)}` : ''}`); if (!ok) fail++;
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce' });
const problems: string[] = [];
const watch = (p: any, name: string) => {
  p.on('pageerror', (e: any) => problems.push(`${name} pageerror: ${e.message}`));
  // (a 404 is the dev server's answer for a cache it has not got: the seed and fixture caches)
  p.on('console', (m: any) => { if (m.type() === 'error' && !/favicon|ResizeObserver loop|Failed to load resource: the server responded with a status of 404/.test(m.text())) problems.push(`${name} console: ${m.text()}`); });
  p.setDefaultTimeout(180000);
};
/** the page's editors idle (bounded: a hang says what was pending). The viewer's idle is taken as reached when all
 *  that is left is its 'slots' frame: with section numbers on the page, a viewer build asks for that frame again every
 *  frame and never settles (inspect.pending() stays ['slots'] with nothing painted); this suite is about the editor */
async function idle(p: any) {
  await p.evaluate(() => {
    const R = (window as any).reflowtex?.inspect;
    if (!R || R.__slotsTolerated) return;
    R.__slotsTolerated = true;
    R.idle = () => new Promise<void>((res) => { let quiet = 0; const tick = () => { const left = R.pending(); quiet = left.every((x: string) => x === 'slots') ? quiet + 1 : 0; if (quiet >= 3) res(); else requestAnimationFrame(tick); }; tick(); });
  });
  const late = Symbol('late');
  const r = await Promise.race([p.evaluate(() => (window as any).editorAPI.whenIdle()), new Promise((res) => setTimeout(() => res(late), 120000))]);
  if (r === late) throw new Error(`not idle after 120 s: ${JSON.stringify(await p.evaluate(() => (window as any).editorAPI.tabs().editors().map(([pane, e]: any) => ({ pane, doc: e.doc?.id, follow: e.session.follow.pending, writes: e.session.persist.writer.pending, blocks: e.api.blocks().map((b: any) => b.state) }))))}`);
}
/** the page's document: its blocks' ids and sources, in order */
const blocks = (p: any) => p.evaluate(() => (window as any).editorAPI.blocks().map((b: any) => ({ id: b.id, source: b.source, state: b.state })));
const sig = (l: { id: string; source: string }[]) => l.map((b) => `${b.id}:${b.source}`).join('|');
/** wait until fn (run in the page) holds, then until that page is idle */
async function until(p: any, fn: (arg: any) => boolean, arg: unknown = null) {
  await p.waitForFunction(fn, arg, { polling: 50 });
  await idle(p);
}
/** block `id` shows the result of its current source in that page (its key now is the key its view shows) */
const shows = (p: any, id: string) => p.evaluate((i: string) => { const k = (window as any).editorAPI.keys(i); const b = (window as any).editorAPI.blocks().find((x: any) => x.id === i); return !!k && k.now === k.shown && b?.state === 'ok'; }, id);
const outline = (p: any) => p.evaluate(() => (window as any).editorAPI.outline().map((o: any) => `${o.number} ${o.title}`).join('|'));

const A = await ctx.newPage(); watch(A, 'A');
await A.goto(`${BASE}?engine&fresh#/`);
await A.waitForFunction(() => (window as any).editorAPI?.workbench);
const docId: string = await A.evaluate(() => (window as any).editorAPI.store().createDoc({ title: 'Two tabs', preamble: '\\documentclass{article}\n\\usepackage{amsmath}', blocks: [
  { kind: 'heading', source: '\\section{First}' },
  { kind: 'paragraph', source: 'The first paragraph, with $x^2$.' },
  { kind: 'paragraph', source: 'The second paragraph.' },
  { kind: 'heading', source: '\\section{Second}\\label{sec:two}' },
  { kind: 'paragraph', source: 'See Section~\\ref{sec:two}.' },
  { kind: 'paragraph', source: 'The last paragraph.' }] }));
await A.evaluate((id: string) => (window as any).editorAPI.open(id), docId);
await idle(A);
const B = await ctx.newPage(); watch(B, 'B');
await B.goto(`${BASE}?engine#/doc/${docId}`);
await B.waitForFunction((id: string) => (window as any).editorAPI?.currentDoc?.()?.id === id, docId);
await idle(B);
const ids = (await blocks(A)).map((b: any) => b.id);
const [h1, p1, p2, h2, pRef, pLast] = ids;
check('the case: both tabs show the document, every block typeset', sig(await blocks(A)) === sig(await blocks(B)) && (await blocks(B)).every((b: any) => b.state === 'ok'), await blocks(B));

// ── an edit in A: B shows it typeset; only that block typeset there ──
await B.evaluate(() => (window as any).editorAPI.resetCounters());
await A.evaluate(([i, s]: string[]) => (window as any).editorAPI.setSource(i, s), [p1, 'The first paragraph, changed in tab A: $y^3$.']);
await idle(A);
await until(B, (i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source.includes('changed in tab A'), p1);
const compiled: string[] = await B.evaluate(() => (window as any).editorAPI.counters().compiledIds);
check('edit in A: B has the new text, typeset (its view shows its current key), without a reload', await shows(B, p1), await blocks(B));
check('edit in A: in B only that block typesets again (or none: the result is in the shared cache)', compiled.every((i) => i === p1), compiled);

// ── insert, move, delete in A: B has the same blocks in the same order, the numbering follows ──
await A.evaluate(([i]: number[]) => (window as any).editorAPI.insert(i, 'heading', '\\section{Inserted}'), [1]);
await idle(A);
await until(B, (s: string) => (window as any).editorAPI.blocks().map((b: any) => `${b.id}:${b.source}`).join('|') === s, sig(await blocks(A)));
const insId = (await blocks(B))[1].id;
check('insert in A: B has the new block in its place, typeset; the sections after it renumbered there too', (await outline(B)) === (await outline(A)) && /^1 First\|2 Inserted\|3 Second/.test(await outline(B)) && await shows(B, insId), { a: await outline(A), b: await outline(B) });
const label = (p: any) => p.evaluate(() => (window as any).editorAPI.refsState()?.labels?.['sec:two'] ?? null);
const [la, lb] = [await label(A), await label(B)];
check('insert in A: the label of the renumbered section has its new number in B too (the reference to it reads it)', !!lb && JSON.stringify(la) === JSON.stringify(lb) && JSON.stringify(lb).includes('"3"'), { la, lb });
await A.evaluate(([i, to]: [string, number]) => (window as any).editorAPI.move(i, to), [pLast, 2]);
await idle(A);
await until(B, (s: string) => (window as any).editorAPI.blocks().map((b: any) => `${b.id}:${b.source}`).join('|') === s, sig(await blocks(A)));
check('move in A: B has the same order', (await blocks(B)).findIndex((b: any) => b.id === pLast) === 2, (await blocks(B)).map((b: any) => b.id));
await A.evaluate((i: string) => (window as any).editorAPI.remove(i), p2);
await idle(A);
await until(B, (s: string) => (window as any).editorAPI.blocks().map((b: any) => `${b.id}:${b.source}`).join('|') === s, sig(await blocks(A)));
check('delete in A: the block is gone in B, its view too', !(await blocks(B)).some((b: any) => b.id === p2) && await B.evaluate((i: string) => !document.querySelector(`.blk[data-id="${i}"]`), p2));

// ── the title ──
await A.evaluate(() => (window as any).editorAPI.tabs().currentEditor().setTitle('Two tabs, renamed in A'));   // (the tab's rename)
await idle(A);
await until(B, () => (window as any).editorAPI.currentDoc()?.title === 'Two tabs, renamed in A');
check('rename in A: B has the new title (its tab and the window\'s title)', await B.evaluate(() => document.title.startsWith('Two tabs, renamed in A')), await B.evaluate(() => document.title));

// ── B has the block open, nothing typed: the editor takes A's text (a remote change: the caret stays, no toast) ──
await B.bringToFront();
await B.evaluate((i: string) => (window as any).editorAPI.edit(i, 3), pRef);
await until(B, (i: string) => (window as any).editorAPI.sessions().some((s: any) => s.id === i && s.text != null), pRef);
await A.evaluate(([i, s]: string[]) => (window as any).editorAPI.setSource(i, s), [pRef, 'See Section~\\ref{sec:two}, changed in A.']);
await idle(A);
await until(B, (i: string) => (window as any).editorAPI.sessions().find((s: any) => s.id === i)?.text?.endsWith('changed in A.'), pRef);
const s1 = await B.evaluate((i: string) => ({ s: (window as any).editorAPI.sessions().find((x: any) => x.id === i), toast: document.querySelector('#toast-text')?.textContent ?? null }), pRef);
check('B editing, nothing typed: its open editor shows A\'s text, still open there, the caret kept, no toast', s1.s?.caret === 3 && s1.toast === null, s1);
// ⌘Z in B now: the steps that no longer fit are gone; nothing throws
await B.evaluate(() => (window as any).editorAPI.undo());
await idle(B);

// ── B types (not written yet) while A changes the same block: B's is kept, A's offered ──
await B.evaluate((i: string) => { const E = (window as any).editorAPI; const v = E.editorView(E.sessions().find((s: any) => s.id === i).pane); v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); }, pRef);
await B.keyboard.type(' Typed in B.');
await A.evaluate(([i, s]: string[]) => (window as any).editorAPI.setSource(i, s), [pRef, 'A changed it again.']);
await idle(A);
await until(B, () => /yours is kept/.test(document.querySelector('#toast-text')?.textContent ?? ''));
await until(A, (i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source.endsWith('Typed in B.'), pRef);
// (the toast's button pressed while it is shown: a DOM click, the page may have an overlay of its own over it)
const s2 = await B.evaluate((i: string) => { const btn = document.querySelector('#toast-undo') as HTMLElement | null, label = btn?.textContent ?? null, text = (window as any).editorAPI.sessions().find((s: any) => s.id === i)?.text; btn?.click(); return { text, action: label }; }, pRef);
check('B typed, A changed it meanwhile: B\'s text kept in its editor and written (A follows it), the toast says so and offers Use theirs',
  s2.text?.endsWith('Typed in B.') && s2.action === 'Use theirs', s2);
const snaps: string[] = await B.evaluate(async (d: string) => ((await (window as any).editorAPI.store().snapshots.list(d)) as any[]).map((s) => s.label), docId);
check('…and A\'s version is in a snapshot (Versions) taken before B\'s was written over it', snaps.some((l) => /keeping this tab's version/.test(l)), snaps);
await until(A, (i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source === 'A changed it again.', pRef);
await until(B, (i: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source === 'A changed it again.', pRef);
check('Use theirs: A\'s text in B (its editor too), and A keeps it', await B.evaluate((i: string) => (window as any).editorAPI.sessions().find((s: any) => s.id === i)?.text ?? (window as any).editorAPI.blocks().find((b: any) => b.id === i)?.source, pRef) === 'A changed it again.');
// ── B has it open, nothing typed, A deletes it: B's editor closes, and the toast says why ──
await A.evaluate((i: string) => (window as any).editorAPI.remove(i), pRef);
await idle(A);
await until(B, (i: string) => !(window as any).editorAPI.blocks().some((b: any) => b.id === i), pRef);
const s3 = await B.evaluate(() => ({ sessions: (window as any).editorAPI.sessions().length, toast: document.querySelector('#toast-text')?.textContent ?? null }));
check('B has it open with nothing typed, A deletes it: B\'s editor closes, the toast says it was deleted in another tab', s3.sessions === 0 && /open here was deleted in another tab/.test(s3.toast ?? ''), s3);

// ── the document deleted in A: B's tab closes, and says why ──
await A.evaluate(async (d: string) => { await (window as any).editorAPI.store().deleteDoc(d); }, docId);
await B.waitForFunction((d: string) => !Object.values((window as any).editorAPI.editors()).some((e: any) => e.doc === d), docId, { polling: 50 });
const said = await B.evaluate(() => document.querySelector('#toast-text')?.textContent ?? '');
check('deleted in A: B\'s tab of it closes, the toast says it was deleted in another tab', /deleted in another tab/.test(said), said);

check('no page errors in either tab', problems.length === 0, problems);
await browser.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
