// A probe of the integrated page (dev only): opens ?workbench=1 on a document, prints the page's errors and the
// state, takes a screenshot. node tests/qa/probe-wb.ts [base] [--hash '#/doc/example'] [--out name] [--js 'expr']
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1]! : d);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://127.0.0.1:8151/';
const OUT = join(HERE, 'test-results/integrate/probe');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(opt('--w', '1400')), height: 860 } });
const page = await ctx.newPage();
page.on('pageerror', (e: any) => console.log('pageerror:', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`console.${m.type()}:`, m.text().slice(0, 400)); });
page.setDefaultTimeout(120000);
await page.goto(`${BASE}?engine${argv.includes('--keep') ? '' : '&fresh'}${opt('--q', '')}${opt('--hash', '#/doc/example')}`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle, null, { timeout: 120000 });
await page.evaluate(() => (window as any).editorAPI.whenIdle?.());
const js = opt('--js', '');
if (js) console.log(JSON.stringify(await page.evaluate(js), null, 1)?.slice(0, 4000));
console.log(JSON.stringify(await page.evaluate(() => {
  const E = (window as any).editorAPI;
  return { route: E.route(), editors: Object.fromEntries(Object.entries(E.editors()).map(([p, e]: any) => [p, e.doc])), blocks: document.querySelectorAll('.blk[data-id]').length,
    tabs: [...document.querySelectorAll('[data-tab]')].map((t: any) => t.textContent.trim().slice(0, 60)) };
})));
await page.screenshot({ path: join(OUT, `${opt('--out', 'probe')}.png`) });
await browser.close();
