// (a probe) the listeners on document and window of the standalone page with a document open
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8170/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}?seed=sample&engine&store=memory#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
await page.evaluate(() => (window as any).editorAPI.whenIdle());
const cdp = await ctx.newCDPSession(page);
const count = async (expr: string) => { const { result } = await cdp.send('Runtime.evaluate', { expression: expr }); const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId }); return listeners.length; };
console.log(JSON.stringify({ document: await count('document'), window: await count('window') }));
await browser.close();
