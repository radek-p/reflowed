// A document written by a newer ReflowEd (store schema above this build's) opens read-only: shown,
// with a notice; a click does not open the editor; nothing of it is written back (not even openedAt).
// A click on a link or a reference there shows its card (nothing to edit) and opens no page; ⌘/Ctrl-click still
// follows it.
//
//   node tests/test-readonly.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
import { harness } from './qa/lib/harness.ts';
import { SCHEMA } from '../app/src/store/policy.ts';

const argv = process.argv.slice(2);
const target = argv[0] === 'file' ? 'file' : 'dev';
const at = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const t = harness('readonly');
const { ctx, page, errors } = await t.launch({ target, at });

// a document as a newer build would leave it: schema + 1 and a field this build does not know
const id: string = await page.evaluate(async (schema: number) => {
  const s = (window as any).editorAPI.store();
  const id = await s.createDoc({ title: 'From a newer ReflowEd', preamble: '\\documentclass{article}\n\\usepackage{hyperref}', blocks: [{ source: 'A paragraph written later.' }, { source: 'Another one.' },
    { source: 'Read more at \\url{https://example.org/ro}, or in Section~\\ref{sec:ro}.' }, { source: '\\section{Later}\\label{sec:ro}' }] });
  await s.b.run(['docs'], 'readwrite', async (tx: any) => { const d = await tx.get('docs', id); await tx.put('docs', { ...d, schema, owners: { x: 'y' } }); });
  return id;
}, SCHEMA + 1);
const rawOf = () => page.evaluate(async (i: string) => {
  const s = (window as any).editorAPI.store();
  return JSON.stringify(await s.b.run(['docs', 'blocks'], 'readonly', async (tx: any) => ({ d: await tx.get('docs', i), b: await tx.all('blocks', 'byDoc', { only: i }) })));
}, id);
const before = await rawOf();
await t.openDoc(page, id);
const state = await page.evaluate(() => ({
  toast: document.querySelector('#toast-text')?.textContent ?? '',
  blocks: document.querySelectorAll('.blk').length,
  ok: document.querySelectorAll('.blk[data-state="ok"]').length,
}));
t.check('it opens and its paragraphs are typeset', state.blocks >= 2 && state.ok >= 2, state);
t.check('a notice says it is read-only (the toast)', /newer version of ReflowEd/.test(state.toast), state);
await page.click('.blk[data-state="ok"] .blk-render');
await t.idle(page);
const editing = await page.evaluate(() => document.querySelectorAll('.blk.editing').length);
t.check('a click on a paragraph does not open the editor', editing === 0, { editing });
await page.keyboard.type('x');
await page.evaluate(() => (window as any).editorAPI.whenIdle());
t.check('nothing of it was written (the record and its blocks as stored: no openedAt, the unknown field kept)', (await rawOf()) === before && before.includes('"owners"'));

// links and references: the click shows the card, edits nothing, opens nothing
await page.evaluate(() => { const w = window as any; const o = window.open.bind(window); w.__opens = []; window.open = (...a: any[]) => { w.__opens.push(String(a[0])); return o(...a); }; });
const unitAt = (kind: string) => page.evaluate(async (k: string) => {
  const rn = (window as any).editorAPI.refnav();
  const u = rn.units().find((x: any) => x.kind === k && x.connected);
  const g = u && rn.elements(u.id)[0];
  if (!g) return null;
  g.scrollIntoView({ block: 'center' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const b = g.getBoundingClientRect();
  return { id: u.id, x: b.left + b.width / 2, y: b.top + b.height / 2 };
}, kind);
await page.waitForFunction(() => { const us = (window as any).editorAPI.refnav().units(); return us.some((u: any) => u.kind === 'link') && us.some((u: any) => u.kind === 'ref'); });
const cardNow = () => page.evaluate(() => { const c = document.querySelector('#rn-card') as HTMLElement; return { open: !c.hidden, kind: c.dataset.kind, hint: c.querySelector('.rn-hint')?.textContent ?? '', editing: document.querySelectorAll('.blk.editing').length, opens: (window as any).__opens.length, url: location.href }; });
const url0 = page.url();
for (const kind of ['link', 'ref']) {
  const p = await unitAt(kind);
  if (!p) { t.check(`a ${kind} unit is drawn`, false); continue; }
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !(document.querySelector('#rn-card') as HTMLElement).hidden, null, { timeout: 10000 }).catch(() => {});
  const c = await cardNow();
  t.check(`read-only: a click on a ${kind} shows its card, edits nothing and opens no page`, c.open && c.kind === kind && c.editing === 0 && c.opens === 0 && c.url === url0, c);
  t.check(`read-only: its card does not say "click to edit" (${kind})`, !/click to edit/i.test(c.hint), c.hint);
  await page.mouse.click(p.x, p.y);
  t.check(`read-only: a second click on the ${kind} keeps its card`, (await cardNow()).open);
  await page.keyboard.press('Escape');
}
{
  await ctx.route('https://example.org/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const p = await unitAt('link');
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }), (async () => { await page.keyboard.down('Control'); await page.mouse.click(p!.x, p!.y); await page.keyboard.up('Control'); })()]);
  t.check('read-only: ⌘/Ctrl-click on a link opens it in a new tab', /example\.org\/ro$/.test(popup.url()), popup.url());
  await popup.close();
}
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
