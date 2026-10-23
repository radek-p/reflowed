// Smoke check of the live demo: each page loads with no page error and renders (run before each commit).
//   node workbench/scripts/smoke.ts [--port 8159] [--browser chromium|webkit|all]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { REPO } from './bundle.ts';

const req = createRequire(join(REPO, 'app/package.json'));
const pw = req('playwright');
const argv = process.argv.slice(2);
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8159';
const which = argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1] : 'all';
const engines = which === 'all' ? ['chromium', 'webkit'] : [which];
// [query, what must be on the page]
const PAGES: [string, string][] = [
  ['?fresh', '.wb-tab'], ['?fresh&theme=dark', '.wb-tab'], ['?fresh&theme=sepia', '.wb-tab'], ['?fresh&theme=hc', '.wb-tab'],
  ['?single', '.wb-root'], ['?fresh&scenario=paper', '.wb-tab'], ['?gallery', '[data-gallery-frame]'], ['?gallery&theme=hc', '[data-gallery]'],
];
let bad = 0;
for (const name of engines) {
  const browser = await pw[name].launch();
  for (const [query, sel] of PAGES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('frameattached', () => {});
    await page.goto(`http://localhost:${PORT}/${query}`);
    const found = await page.waitForSelector(sel, { state: 'attached', timeout: 10000 }).then(() => true, () => false);
    if (query === '?gallery') {        // the frames' own errors
      for (const f of page.frames().slice(1)) await f.waitForSelector('[data-gallery]', { state: 'attached', timeout: 10000 }).catch(() => errors.push(`frame ${f.url()}: no tab`));
    }
    await page.waitForTimeout(300);
    const ok = found && errors.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${query}${found ? '' : ` (no ${sel})`}${errors.length ? ` — ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  await browser.close();
}
console.log(bad ? `${bad} failed` : 'smoke: all pages load');
process.exit(bad ? 1 : 0);
