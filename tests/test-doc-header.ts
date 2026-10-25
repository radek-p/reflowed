// the document header, on the workbench page: a document's tab is its header. The name of the focused
// active tab is the document switcher (a row menu of the store's documents, this one marked); renaming the tab (F2,
// as the tab menu's Rename…) renames the document: Escape cancels (the old name back), Enter or a press elsewhere
// keeps it, in the store, on every tab of the document and in the window's title. Screen-reader labels; readable in
// light and dark. The workbench's own suite (workbench/tests/e2e/tabs.ts) checks the generic parts (the field, the
// row menu's keys); this suite checks the editor's wiring of them. In the dev app; waits on events and the app's idle.
// (The old pane bar's #doc-switch / #doc-rename are drawn only off the workbench: chrome/doc-header.js.)
//
//   node tests/test-doc-header.ts [http://localhost:8195/]
import { harness } from './qa/lib/harness.ts';
import { CONTRAST } from './qa/lib/contrast.ts';

const at = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8195/';
const t = harness('doc-header');
const { ctx, page, errors } = await t.launch({ target: 'dev', at, viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(60000);
await ctx.addInitScript(CONTRAST);
await page.evaluate(CONTRAST);
const other = await t.newDoc(page, { title: 'Another paper', blocks: [{ source: 'Other.' }] });
const id = await t.newDoc(page, { title: 'Header test', blocks: [{ source: 'A paragraph.' }] });
await t.idle(page);
const tab: string = await page.evaluate(() => (window as any).editorAPI.tabs().current.peek().pane);
// the tab in the visible strip (the strip may hold a hidden copy for measuring), marked
await page.evaluate((sel: string) => { document.querySelectorAll(sel).forEach((e, k) => { if (k === 0 && (e as HTMLElement).offsetParent) e.setAttribute('data-test-header', ''); }); }, `.wb-tab[data-tab="${tab}"]`);
const HEAD = '[data-test-header]';
const title = () => page.evaluate(() => (window as any).editorAPI.currentDoc().title as string);
const names = () => page.evaluate((i: string) => [...document.querySelectorAll(`.wb-tab[data-tab="${i}"] .wb-tab-label`)].map((e) => e.textContent), tab);

// the parts and their labels
const parts = await page.evaluate((h: string) => {
  const el = document.querySelector(h), name = el?.querySelector('.wb-tab-label');
  return { tab: !!el, name: name?.textContent, label: name?.getAttribute('aria-label'), stop: el?.querySelector(':scope > [role="tab"]')?.getAttribute('aria-label') ?? null };
}, HEAD);
t.check('the document\'s tab is its header: the name, labelled "Switch document: <name>"', parts.tab && parts.name === 'Header test' && parts.label === 'Switch document: Header test', parts);

// a click on the name of the focused active tab opens the switcher: the store's documents, this one marked
await page.click(`${HEAD} .wb-tab-label`);
await page.waitForSelector('[role="grid"][aria-label="Switch document"] [role="row"]');
const list = await page.evaluate(() => [...document.querySelectorAll('[role="grid"][aria-label="Switch document"] [role="row"]')].map((r) => ({ text: r.textContent!.trim(), on: r.getAttribute('aria-selected') === 'true' || r.getAttribute('aria-current') != null || r.classList.contains('is-active') })));
t.check('a click on the name opens the switcher: the documents of the store (the other one, this one marked)', list.some((r) => r.text.includes('Another paper')) && list.some((r) => r.text.includes('Header test') && r.on), list);
await page.keyboard.press('Escape');
await page.waitForSelector('[role="grid"][aria-label="Switch document"]', { state: 'detached' });
t.check('Escape closes the switcher', true);

// rename: F2 on the focused tab; Escape cancels
await page.focus(`${HEAD} > [role="tab"]`);
await page.keyboard.press('F2');
await page.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
const edit0 = await page.evaluate(() => { const i = document.activeElement as HTMLInputElement; return { value: i.value, sel: [i.selectionStart, i.selectionEnd] }; });
t.check('F2 renames in place: a field over the name, its text selected', edit0.value === 'Header test' && edit0.sel[0] === 0 && edit0.sel[1] === 11, edit0);
await page.keyboard.type('Changed');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.wb-rename'));
const esc = { title: await title(), names: await names() };
t.check('Escape cancels: the document keeps its name, so does the tab', esc.title === 'Header test' && esc.names.every((n) => n === 'Header test'), esc);

// Enter keeps it: the store, the tab, its label, the window's title
await page.focus(`${HEAD} > [role="tab"]`);
await page.keyboard.press('F2');
await page.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
await page.keyboard.type('Renamed paper');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('.wb-rename'));
await page.waitForFunction(() => (window as any).editorAPI.currentDoc().title === 'Renamed paper');
// (the title is written after 400 ms of quiet, doc/persist.ts: the store waited on)
// (waitForFunction does not await a promise: the store polled from here, on its state)
for (let k = 0; k < 600 && (await page.evaluate(async (i: string) => (await (window as any).editorAPI.store().getDoc(i)).title, id)) !== 'Renamed paper'; k++) await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
const kept = { title: await title(), stored: await page.evaluate(async (i: string) => (await (window as any).editorAPI.store().getDoc(i)).title, id), names: await names(),
  label: await page.getAttribute(`${HEAD} .wb-tab-label`, 'aria-label'), win: await page.title() };
t.check('Enter keeps the new name: the document, the store, the tab, its label, the window\'s title', kept.title === 'Renamed paper' && kept.stored === 'Renamed paper'
  && kept.names.every((n) => n === 'Renamed paper') && kept.label === 'Switch document: Renamed paper' && /^Renamed paper/.test(kept.win), kept);

// a press elsewhere keeps it too
await page.focus(`${HEAD} > [role="tab"]`);
await page.keyboard.press('F2');
await page.waitForFunction(() => document.activeElement?.classList.contains('wb-rename'));
await page.keyboard.press('End');
await page.keyboard.type('!');
await page.mouse.click(640, 600);
await page.waitForFunction(() => !document.querySelector('.wb-rename'));
await page.waitForFunction(() => (window as any).editorAPI.currentDoc().title === 'Renamed paper!');
t.check('a press elsewhere keeps the rename', true);

// the switcher switches: the other document opens in this tab
await page.click(`${HEAD} .wb-tab-label`);
await page.waitForSelector('[role="grid"][aria-label="Switch document"] [role="row"]');
await page.click(`[role="grid"][aria-label="Switch document"] [role="row"]:has-text("Another paper")`);
// (the tab's state names it; its editor opens it)
await page.waitForFunction(([i, o]: string[]) => {
  const find = (n: any): any => (n.kind === 'split' ? n.children.map(find).find(Boolean) : n.tabs.find((x: any) => x.id === i));
  const tb = find((window as any).editorAPI.workbench().layout.peek().root);
  return tb?.state?.doc === o && (window as any).editorAPI.editors()[i]?.doc === o;
}, [tab, other]);
await t.idle(page);
const sw = await page.evaluate(() => (window as any).editorAPI.tabs().current.peek());
t.check('a document chosen in the switcher opens in this tab, which stays the current one', sw.pane === tab && sw.doc === other, { sw, tab });

for (const theme of ['light', 'dark']) {
  await page.evaluate((th: string) => (window as any).editorAPI.view().set({ theme: th }), theme);
  await page.waitForFunction((th: string) => document.documentElement.classList.contains('dark') === (th === 'dark'), theme);
  const c = await page.evaluate((h: string) => ({ name: (window as any).__contrast(document.querySelector(`${h} .wb-tab-label`)) }), HEAD);
  await page.locator(HEAD).screenshot({ path: `${t.out}/header-${theme}.png` });
  t.check(`${theme}: the name readable (4.5:1)`, c.name >= 4.5, c);
}
await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
t.check('no page errors', errors.length === 0, errors.slice(0, 3));
await ctx.close();
t.done();
