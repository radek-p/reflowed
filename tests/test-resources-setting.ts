// The TeX resource server's address in the Settings panel's Advanced section: shown only with
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
const PANEL = '[data-panel-view="app-settings"]';
/** the Settings panel (the main menu's Settings…), at its Advanced section */
const openEngineTab = async () => {
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  await page.waitForSelector(`${PANEL} [data-section="advanced"]`);
};
const closeSheet = async () => { await page.click('[data-ptab="app-settings"] [data-action="close-panel"]'); await page.waitForSelector(PANEL, { state: 'detached' }); };
const reload = async () => { await page.reload(); await page.waitForFunction(() => (window as any).editorAPI?.route?.().name); await t.openDoc(page, id); };

// advanced features hidden: no field, no server
await page.evaluate(() => { localStorage.removeItem('rtx-editor.advanced'); localStorage.removeItem('rtx-editor.resource-server'); });
await reload();
await openEngineTab();
t.check('advanced features hidden: the Advanced section has no server field', await page.locator('#ss-resource-server').count() === 0);
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
await page.waitForSelector(`${PANEL} .rtx-set-problem`);
t.check('not an http(s) address: said under the field, nothing applied', /must start with http/.test(await page.locator(`${PANEL} .rtx-set-problem`).innerText()) && await server() === DEFAULT, await server());
await field.fill(URL1);
t.check('typing again clears the problem', await page.locator(`${PANEL} .rtx-set-problem`).count() === 0);
await field.press('Enter');
await page.waitForFunction((u: string) => (window as any).editorAPI.backendObject()?.resourceServer?.() === u, URL1);
t.check('Enter applies it to the engine at once (no reload)', await server() === URL1, await server());
t.check('the panel stays open', await page.locator(PANEL).count() === 1);
await closeSheet();
t.check('closing the panel keeps it (it was applied on Enter)', await server() === URL1, await server());

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
t.check('"none": no server, and no problem said', await server() === '' && await page.locator(`${PANEL} .rtx-set-problem`).count() === 0);
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
