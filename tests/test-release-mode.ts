// A release: the dev switches ?stubs= and ?store=memory are ignored (the store stays IndexedDB, so
// documents persist), and every feature installed (globalThis.__rtxFeatureErrors stays empty).
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
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
