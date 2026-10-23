// A document written by a newer ReflowEd (store schema above this build's) opens read-only: shown,
// with a notice; a click does not open the editor; nothing of it is written back (not even openedAt).
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
  const id = await s.createDoc({ title: 'From a newer ReflowEd', preamble: '\\documentclass{article}', blocks: [{ source: 'A paragraph written later.' }, { source: 'Another one.' }] });
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
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
