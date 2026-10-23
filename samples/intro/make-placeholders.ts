// Placeholder screenshots for the introduction (samples/intro/source/figures/shot-<name>.png): a light grey box with
// "Screenshot: <what>" on it, 640 × 360 px. The real screenshots replace these files under the same names; then
// rebuild the seed (node scripts/seed.ts, or node samples/intro/seed-intro.ts). This script writes only the files
// that are missing (--force: all of them), so it never overwrites a real screenshot by accident.
//   node samples/intro/make-placeholders.ts [--force]
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'source/figures');
/** name → what the screenshot shows (main.tex includes figures/shot-<name> with a caption saying the same) */
export const SHOTS: Record<string, string> = {
  'split-view': 'a split view: the same document in two panes',
  'outline': 'the side panel with the Outline',
  'section-menu': 'the section menu',
  'themes': 'the View options and the four themes',
  'code-popover': 'the code popover open on a block',
  'reference-card': 'the reference card of a cross-reference',
  'figure-editor': 'the figure editor',
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const force = process.argv.includes('--force');
  mkdirSync(OUT, { recursive: true });
  const todo = Object.entries(SHOTS).filter(([n]) => force || !existsSync(join(OUT, `shot-${n}.png`)));
  if (!todo.length) { console.log('placeholders: all there (--force rewrites them)'); process.exit(0); }
  const { chromium } = createRequire(join(HERE, '../../app/package.json'))('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  for (const [name, what] of todo) {
    await page.setContent(`<!doctype html><body style="margin:0"><div style="box-sizing:border-box;width:640px;height:360px;background:#e8e8e8;border:2px solid #b0b0b0;display:flex;align-items:center;justify-content:center;font:24px sans-serif;color:#555;text-align:center;padding:40px">Screenshot: ${what}</div></body>`);
    await page.screenshot({ path: join(OUT, `shot-${name}.png`), clip: { x: 0, y: 0, width: 640, height: 360 } });
    console.log(`figures/shot-${name}.png`);
  }
  await browser.close();
}
