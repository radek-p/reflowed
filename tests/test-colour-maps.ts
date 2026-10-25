// The editor's colour maps in the viewer (view/colour-maps.ts): the editor's map and the figures' colours, given
// to host.setColorMaps when the page starts, before the viewer's first block, are the maps in force once blocks are
// drawn (the viewer keeps them over its #latex-color-maps island), and the blocks are coloured by them.
//
//   node tests/test-colour-maps.ts http://localhost:8150/
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:8150/').replace(/\/?$/, '');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`${BASE}/?engine&store=memory#/doc/intro`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
await page.evaluate(() => (window as any).editorAPI.whenIdle());
const r = await page.evaluate(() => {
  const host = (window as any).reflowtex.host, maps = host.colorMaps();
  const editor = maps.editor ?? null;
  const blocks = [...document.querySelectorAll('.latex-block[data-color-map="editor"]')].length;
  return { names: Object.keys(maps), themes: editor ? Object.keys(editor.colors ?? {}).sort() : [], tints: editor ? Object.keys(editor.tints ?? {}).length : 0,
    blocks, island: !!document.getElementById('latex-color-maps') };
});
check("the editor's map is in force, with its themes and the figures' tints", r.names.includes('editor') && r.themes.includes('dark') && r.tints > 0, r);
check('the blocks are coloured by it', r.blocks > 0, r);
check('no page error', errors.length === 0, errors);
await browser.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
