// A document an older ReflowEd made (its core version below this build's, store/policy.ts) opens read-only
// behind the prompt "made by an older ReflowEd": Export .tex gives the marked file, Start anew imports it as a
// new document that exports the same bytes (ids aside), the downloaded .tex re-imports to the same bytes, and the
// older document is never written (not even openedAt). A newer core still gets only the read-only toast.
//
//   node tests/test-older-core.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
import { readFileSync } from 'node:fs';
import { harness } from './qa/lib/harness.ts';
import { CORE_VERSION } from '../app/src/store/policy.ts';

const argv = process.argv.slice(2);
const target = argv[0] === 'file' ? 'file' : 'dev';
const at = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const t = harness('older-core');
const { ctx, page, errors } = await t.launch({ target, at });

const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
function sameUpToIds(a: string, b: string): boolean {
  const ia = [...new Set(a.match(ULID) ?? [])], ib = [...new Set(b.match(ULID) ?? [])];
  if (ia.length !== ib.length) return false;
  const map = new Map(ib.map((x, i) => [x, ia[i]]));
  return b.replace(ULID, (x) => map.get(x)!) === a;
}

// a document as an older build left it: core version - 1, a heading, prose, a theorem, an image
const id: string = await page.evaluate(async (core: number) => {
  const s = (window as any).editorAPI.store();
  const id = await s.createDoc({ title: 'From an older ReflowEd', preamble: '\\documentclass{article}\n\\usepackage{amsthm}\n\\newtheorem{lemma}{Lemma}',
    blocks: [{ kind: 'heading', source: '\\section{Start}', attrs: { level: 'section', before: '\n' } }, { source: 'A paragraph written earlier, with $x^2$.', attrs: { before: '\n\n' } },
      { kind: 'lemma', source: '\\begin{lemma}\\label{l:one}A lemma.\\end{lemma}', attrs: { env: 'lemma', before: '\n\n' } }],
    assets: [{ name: 'img/dot.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }] });
  await s.backend.run(['docs'], 'readwrite', async (tx: any) => { const d = await tx.get('docs', id); await tx.put('docs', { ...d, schema: core }); });
  return id;
}, CORE_VERSION - 1);
const rawOf = (i: string) => page.evaluate(async (i: string) => {
  const s = (window as any).editorAPI.store();
  return JSON.stringify(await s.backend.run(['docs', 'blocks', 'assets'], 'readonly', async (tx: any) => ({ d: await tx.get('docs', i), b: await tx.all('blocks', 'byDoc', { only: i }), a: (await tx.all('assets', 'byDoc', { only: i })).length })));
}, i);
const before = await rawOf(id);
await t.openDoc(page, id);
await page.waitForSelector('#rtx-older-core[open]');
const shown = await page.evaluate(() => {
  const d = document.querySelector('#rtx-older-core')!;
  return { text: d.textContent ?? '', acts: [...d.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act')) };
});
t.check('the prompt appears: made by an older ReflowEd, export (.tex/.zip) and start anew, or use the older build',
  /This document was made by an older ReflowEd\. Export it \(\.tex\/\.zip\) and start anew; to keep editing it, use the older build\./.test(shown.text)
  && ['close', 'export-tex', 'export-zip', 'start-anew'].every((a) => shown.acts.includes(a)), shown);

const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rtx-older-core [data-act="export-tex"]')]);
const tex = readFileSync(await dl.path(), 'utf8');
t.check('Export .tex downloads the marked file', /\.tex$/.test(dl.suggestedFilename()) && tex.startsWith('%% reflowtex-editor v1') && tex.includes('A paragraph written earlier'), dl.suggestedFilename());
const [dz] = await Promise.all([page.waitForEvent('download'), page.click('#rtx-older-core [data-act="export-zip"]')]);
t.check('Export .zip downloads the project with its image', /\.zip$/.test(dz.suggestedFilename()) && readFileSync(await dz.path()).includes(Buffer.from('img/dot.png')), dz.suggestedFilename());

await page.click('#rtx-older-core [data-act="start-anew"]');
await page.waitForFunction((old: string) => { const a = (window as any).editorAPI; return a.route().name === 'doc' && a.currentDoc()?.id && a.currentDoc().id !== old; }, id);
await t.idle(page);
const anew = await page.evaluate(async () => {
  const a = (window as any).editorAPI, s = a.store(), cur = a.currentDoc();
  const d = await s.getDoc(cur.id);
  return { id: cur.id, readOnly: d.readOnly ?? null, schema: d.schema, assets: d.assets.map((x: any) => x.name), tex: a.io().exportTex(d),
    prompt: !!document.querySelector('#rtx-older-core'), ok: document.querySelectorAll('.blk[data-state="ok"]').length };
});
t.check('Start anew opens a new, writable document at the current core with the image copied', anew.readOnly === null && anew.schema === CORE_VERSION && anew.assets.join() === 'img/dot.png' && !anew.prompt, anew);
t.check('… its paragraphs are typeset', anew.ok >= 3, anew.ok);
t.check('… and it exports the downloaded .tex byte for byte (ids aside)', sameUpToIds(tex, anew.tex), anew.tex.split('\n').find((l, i) => l !== tex.split('\n')[i]) ?? '');
const again = await page.evaluate(async (text: string) => {
  const a = (window as any).editorAPI, s = a.store();
  const init = await a.io().importFile({ name: 'again.tex', bytes: new TextEncoder().encode(text) });
  const nid = await s.createDoc(init);
  return a.io().exportTex(await s.getDoc(nid));
}, tex);
t.check('the downloaded .tex re-imports to the same bytes (ids aside)', sameUpToIds(tex, again));
t.check('the older document was not written (record, blocks, assets as stored; no openedAt)', (await rawOf(id)) === before);
await t.openDoc(page, id);
await page.waitForSelector('#rtx-older-core[open]');
await page.click('#rtx-older-core [data-act="close"]');
await page.waitForSelector('#rtx-older-core', { state: 'detached' });
await page.click('.blk[data-state="ok"] .blk-render');
await t.idle(page);
t.check('after Close: read-only, a click does not open the editor', (await page.evaluate(() => document.querySelectorAll('.blk.editing').length)) === 0);

// a newer core: the toast only, no prompt
const nid: string = await page.evaluate(async (core: number) => {
  const s = (window as any).editorAPI.store();
  const id = await s.createDoc({ title: 'From a newer ReflowEd', blocks: [{ source: 'Later.' }] });
  await s.backend.run(['docs'], 'readwrite', async (tx: any) => { const d = await tx.get('docs', id); await tx.put('docs', { ...d, schema: core }); });
  return id;
}, CORE_VERSION + 1);
await t.openDoc(page, nid);
const nw = await page.evaluate(() => ({ prompt: !!document.querySelector('#rtx-older-core'), toast: document.querySelector('#toast-text')?.textContent ?? '' }));
t.check('a newer core: no prompt, the read-only toast', !nw.prompt && /newer version of ReflowEd/.test(nw.toast), nw);
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
