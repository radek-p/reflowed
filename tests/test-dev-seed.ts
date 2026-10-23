// The dev seed cache: a dev server started with --seed-cache serves the release's recorded results
// (engine/build/seed-cache.json.gz) while their engine build is the worker's, and the dev app opens the intro
// from them with nothing compiled, every block as it is typeset. Waits on editorAPI.whenIdle(), never on times.
//
//   node tests/test-dev-seed.ts http://localhost:8150/      (a server started with --seed-cache; test-all gives it)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:8150/').replace(/\/?$/, '');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

const info = await (await fetch(`${BASE}/dev/seed-cache-info`)).json();
check('the server is seeded, and the cache\'s engine build is the worker\'s', info.seeded && info.ok && info.build === info.worker && info.results > 30, info);
// the documents the page opens are the ones the release precompiled (build/seed/): a stale copy compiles what changed
{
  const { existsSync, readFileSync } = await import('node:fs');
  const want = join(HERE, 'build/seed/intro.json');
  if (existsSync(want)) check('the server\'s intro.json is the one the seed cache was recorded from (build/seed/)', (await (await fetch(`${BASE}/seed/intro.json`)).text()) === readFileSync(want, 'utf8'));
}
const html = await (await fetch(`${BASE}/?engine`)).text();
check('its index.html names the seed cache for the page', html.includes('<meta name="rtx-dev-seed-cache" content="/dev/seed-cache.json">'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`${BASE}/?engine&store=memory#/doc/intro`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
await page.evaluate(() => (window as any).editorAPI.whenIdle());
const r = await page.evaluate(() => {
  const api = (window as any).editorAPI, bs = api.blocks();
  const states: Record<string, number> = {};
  for (const b of bs) states[b.state] = (states[b.state] ?? 0) + 1;
  return { stats: api.backendObject?.()?.stats?.() ?? null, states, n: bs.length };
});
check(`the intro opens from the seed cache: nothing compiled (${r.stats?.seedHits} seed hits)`, !!r.stats && r.stats.compiled === 0 && r.stats.seedHits > 30, r.stats);
check(`every block typeset (${r.n} blocks, none pending or failed)`, !r.states.pending && !r.states.error && (r.states.ok ?? 0) > 30, r.states);
check('no page errors', errors.length === 0, errors.slice(0, 3));
await browser.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
