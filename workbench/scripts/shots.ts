// Screenshots of the demo in light and dark, at rest and mid-gesture (test-results/workbench/, ignored), for review.
//   node workbench/scripts/shots.ts [url=http://localhost:8159/]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './bundle.ts';

const req = createRequire(join(REPO, 'app/package.json'));
const { chromium } = req('playwright');
const url = process.argv[2] ?? 'http://localhost:8159/';
const out = join(REPO, 'test-results/workbench');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const box = async (page: any, sel: string) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e: Error) => console.log('pageerror', e.message));
  await page.goto(`${url}?fresh&theme=${theme}`);
  await page.waitForSelector('.wb-tab');
  const tabs = await page.evaluate(() => (window as any).demo.M.groups((window as any).demo.wb.layout.peek()).map((g: any) => g.tabs.map((t: any) => t.id)));
  await page.click(`[data-tab="${tabs[0][0]}"]`);
  await page.screenshot({ path: join(out, `rest-${theme}.png`) });
  // a tab dragged to the right edge of group 2
  const t = await box(page, `[data-tab="${tabs[0][1]}"]`), body = await box(page, '.wb-group:nth-of-type(2) .wb-body');
  await page.mouse.move(t.x, t.y); await page.mouse.down();
  await page.mouse.move(body.b.x + body.b.width - 30, body.y, { steps: 8 });
  await page.waitForSelector('.wb-zone');
  await page.screenshot({ path: join(out, `tabdrag-split-${theme}.png`) });
  const s = await box(page, `[data-tab="${tabs[1][1]}"]`);
  await page.mouse.move(s.b.x + 3, s.y, { steps: 6 });
  await page.waitForSelector('.wb-insert');
  await page.screenshot({ path: join(out, `tabdrag-strip-${theme}.png`) });
  await page.keyboard.press('Escape'); await page.mouse.up();
  // a list item over the other list
  await page.click(`[data-tab="${tabs[0][2]}"]`);
  const it = await box(page, '[data-item="Fruit 2"]'), v = await box(page, '[data-item="Vegetable 3"]');
  await page.mouse.move(it.x, it.y); await page.mouse.down();
  await page.mouse.move(v.x, v.b.y + 4, { steps: 8 });
  await page.waitForSelector('.demo-line');
  await page.screenshot({ path: join(out, `contentdrag-${theme}.png`) });
  const n = await box(page, `[data-tab="${tabs[1][1]}"]`);
  await page.mouse.move(n.x, n.y, { steps: 4 });
  await page.waitForSelector('[data-spring]');
  await page.screenshot({ path: join(out, `spring-${theme}.png`) });
  await page.keyboard.press('Escape'); await page.mouse.up();
  // narrow: crumbs and tabs
  await page.setViewportSize({ width: 760, height: 520 });
  await page.screenshot({ path: join(out, `narrow-${theme}.png`) });
  await page.close();
}
await browser.close();
console.log(out);
