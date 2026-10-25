// A release: the dev switches ?stubs= and ?store=memory are ignored (the store stays IndexedDB, so
// documents persist), and every feature installed (globalThis.__rtxFeatureErrors stays empty). The inspector (a
// developer tool) is not there at all: no inspector, no view, no style element; Alt+Shift+I reaches a text field.
//   node tests/test-release-mode.ts [dist/reflowtex-editor.html]
import { harness } from './qa/lib/harness.ts';

const at = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const t = harness('release-mode');
const { ctx, page, errors } = await t.launch({ target: 'file', at, query: 'stubs=store,io,refs&store=memory' });
const kind = await page.evaluate(() => (window as any).editorAPI.store().kind);
t.check('?stubs=store&store=memory ignored: the store is IndexedDB', kind === 'indexeddb', { kind });
await t.newDoc(page, { title: 'Release mode', preamble: '\\documentclass{article}', blocks: [{ source: 'A paragraph.' }] });
const failed = await page.evaluate(() => (globalThis as any).__rtxFeatureErrors ?? []);
t.check('every feature installed (no __rtxFeatureErrors)', !failed.length, failed);
// the inspector: never imported in a release (app/services.ts), so nothing of what its module installs
const insp = await page.evaluate(() => ({ api: (window as any).editorAPI.inspector() ?? null,
  view: (window as any).editorAPI.views().some((v: { id: string }) => v.id === 'inspector'), css: !!document.getElementById('rtx-insp-css') }));
t.check('no inspector in a release: editorAPI.inspector() null, no inspector view registered, no #rtx-insp-css', insp.api === null && !insp.view && !insp.css, insp);
// Alt+Shift+I (on a Mac a character in many layouts) reaches a text field, its default not prevented
const key = await page.evaluate(() => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  let heard = false;
  input.addEventListener('keydown', () => { heard = true; });
  const done = input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ˆ', code: 'KeyI', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  input.remove();
  return { heard, prevented: !done };
});
t.check('Alt+Shift+I in a text field reaches it, not prevented', key.heard && !key.prevented, key);
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
