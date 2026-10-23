// The TeX resource server's address in Document settings, Engine and view: shown only with
// "Show advanced features", checked as it is typed in, applied to the engine at once (no reload), kept per
// browser across reloads, and the default while advanced features are hidden: on an http page the tree beside it
// (texlive/2022/); emptied, the default again; "none", no server. The dev app on the engine.
//
//   node tests/test-resources-setting.ts [http://localhost:8196/]
import { harness } from './qa/lib/harness.ts';

const at = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8196/';
const t = harness('resources-setting');
const { ctx, page, errors } = await t.launch({ target: 'dev', at });
page.setDefaultTimeout(120000);
const URL1 = 'http://127.0.0.1:8197/texlive/2022/';
const DEFAULT = new URL('texlive/2022/', at).href;

const id = await t.newDoc(page, { title: 'Resource server setting', preamble: '\\documentclass{article}\n', blocks: [{ source: 'A paragraph.' }] });
const server = () => page.evaluate(() => (window as any).editorAPI.backendObject()?.resourceServer?.() ?? null);
const openEngineTab = async () => {
  await page.evaluate(() => (window as any).editorAPI.settings().open({ tab: 'engine' }));
  await page.waitForSelector('#settings-sheet[open] #ss-panel-engine:not([hidden])');
};
const closeSheet = async () => { await page.evaluate(() => (window as any).editorAPI.settings().close({ apply: false })); await page.waitForSelector('#settings-sheet[open]', { state: 'detached' }); };
const reload = async () => { await page.reload(); await page.waitForFunction(() => (window as any).editorAPI?.route?.().name); await t.openDoc(page, id); };

// advanced features hidden: no field, no server
await page.evaluate(() => { localStorage.removeItem('rtx-editor.advanced'); localStorage.removeItem('rtx-editor.resource-server'); });
await reload();
await openEngineTab();
t.check('advanced features hidden: the Engine tab has no server field', await page.locator('#ss-resource-server').count() === 0);
t.check('the default: the tree beside the page (an http page), assumed', await server() === DEFAULT && (await page.evaluate(() => (window as any).editorAPI.backendObject()?.resourceServerState?.()))?.quiet === true, await server());
await closeSheet();

// advanced features shown
await page.evaluate(() => localStorage.setItem('rtx-editor.advanced', '1'));
await reload();
await openEngineTab();
const field = page.locator('#ss-resource-server');
t.check('advanced features shown: the field is there, empty, the default as its placeholder', await field.count() === 1 && await field.inputValue() === '' && /beside this page/.test(await field.getAttribute('placeholder') ?? ''));
await field.fill('ftp://example.org/tex');
await field.press('Enter');
await page.waitForSelector('#settings-sheet .ss-problem');
t.check('not an http(s) address: said under the field, nothing applied', /must start with http/.test(await page.locator('#settings-sheet .ss-problem').innerText()) && await server() === DEFAULT, await server());
await field.fill(URL1);
t.check('typing again clears the problem', await page.locator('#settings-sheet .ss-problem').count() === 0);
await field.press('Enter');
await page.waitForFunction((u: string) => (window as any).editorAPI.backendObject()?.resourceServer?.() === u, URL1);
t.check('Enter applies it to the engine at once (no reload)', await server() === URL1, await server());
t.check('the sheet stays open (a preference, not a document change)', await page.locator('#settings-sheet[open]').count() === 1);
await closeSheet();
t.check('Cancel does not undo it (it was applied on Enter)', await server() === URL1, await server());

// kept across a reload
await reload();
await page.waitForFunction((u: string) => (window as any).editorAPI.backendObject()?.resourceServer?.() === u, URL1);
await openEngineTab();
t.check('after a reload: the field and the engine have it', await page.locator('#ss-resource-server').inputValue() === URL1 && await server() === URL1);
// leaving the field applies too; empty means the default, "none" no server
await page.locator('#ss-resource-server').fill('');
await page.locator('#ss-resource-server').blur();
await page.waitForFunction((u: string) => (window as any).editorAPI.backendObject()?.resourceServer?.() === u, DEFAULT);
t.check('emptied and left: the default again', await server() === DEFAULT && await page.evaluate(() => localStorage.getItem('rtx-editor.resource-server')) === null);
await page.locator('#ss-resource-server').fill('none');
await page.locator('#ss-resource-server').press('Enter');
await page.waitForFunction(() => (window as any).editorAPI.backendObject()?.resourceServer?.() === '');
t.check('"none": no server, and no problem said', await server() === '' && await page.locator('#settings-sheet .ss-problem').count() === 0);
await page.locator('#ss-resource-server').fill(URL1);
await page.locator('#ss-resource-server').blur();
await page.waitForFunction((u: string) => (window as any).editorAPI.backendObject()?.resourceServer?.() === u, URL1);
await closeSheet();

// advanced features hidden again: the default, and the typed address comes back with them
await page.evaluate(() => localStorage.removeItem('rtx-editor.advanced'));
await reload();
t.check('advanced features hidden again: the default', await server() === DEFAULT, await server());
t.check('the typed address is kept for when they show again', await page.evaluate(() => localStorage.getItem('rtx-editor.resource-server')) === URL1);

t.check('no page errors', errors.length === 0, errors);
await ctx.close();
t.done();
