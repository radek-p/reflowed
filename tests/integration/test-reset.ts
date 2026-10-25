// The dev server's /reset page: forgets the app's IndexedDB databases and localStorage keys after the confirmation,
// and nothing else of the origin (another page's database and keys stay). It runs the app's own code (app/src/store/wipe.js, as the Documents view's "Reset local
// data…" does in the release; tests/test-samples.ts tests that one), and the app's other tabs follow it (reload).
//   node tests/integration/test-reset.ts [base=http://127.0.0.1:8150]
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../app/package.json', import.meta.url).pathname)('playwright');

const base = process.argv[2] ?? 'http://127.0.0.1:8150';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` ${info}` : ''}`); if (!ok) failed++; };

await page.goto(`${base}/`);
await page.waitForSelector('.rh-row[data-doc-id]');
check("the Documents view's footer has Reset local data… (no separate dev link)", await page.locator('.home-foot #reset-local').isVisible() && await page.locator('#dev-reset').count() === 0);
await page.evaluate(() => new Promise((ok) => { const r = indexedDB.open('test-reset-db', 1); r.onupgradeneeded = () => r.result.createObjectStore('x'); r.onsuccess = () => { r.result.close(); ok(null); }; }));
await page.evaluate(() => { localStorage.setItem('test-reset', '1'); localStorage.setItem('rtx-editor.test-reset', '1'); sessionStorage.setItem('test-reset', '1'); });
// the reset in the same tab (no app page open meanwhile, so nothing comes back before the checks)
await page.goto(`${base}/reset?stay`);
check('/reset runs the app\'s wipe module', await page.evaluate(() => document.querySelector('script[type=module]')?.textContent?.includes("from '/src/store/wipe.js'") ?? false));
await page.click('#go');
await page.waitForFunction(() => document.title === 'Reset done');
const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
check("the app's databases deleted, another page's kept", JSON.stringify(dbs) === JSON.stringify(['test-reset-db']), JSON.stringify(dbs));
const keys = await page.evaluate(() => Object.keys(localStorage).sort());
check("the app's localStorage keys removed, another page's kept", JSON.stringify(keys) === JSON.stringify(['test-reset']), JSON.stringify(keys));
check('session storage kept (the app keeps nothing there)', await page.evaluate(() => sessionStorage.getItem('test-reset') === '1'));
// an app tab open while the reset happens in another: it is told and reloads, as on a first visit
const app = await ctx.newPage();
await app.goto(`${base}/`);
await app.waitForSelector('.rh-row[data-doc-id]');
await app.evaluate(() => { (window as any).__notReloaded = true; });
await page.goto(`${base}/reset?stay`);
await page.click('#go');
await app.waitForFunction(() => !(window as any).__notReloaded && document.querySelector('.rh-row[data-doc-id]'));
check('the app\'s other tab reloaded and shows the documents again', await app.locator('.rh-row[data-doc-id]').count() > 0);
await browser.close();
process.exit(failed ? 1 : 0);
