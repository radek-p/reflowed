// The fixture cache (tests/integration/fixture-cache.ts): the tests' fixture document's typeset
// blocks, served by the seeded dev server, recorded again when stale, never in a release.
//   - a stale file (another key) is recorded again from the cold dev app, and a fresh one is left alone;
//   - the seeded server opens the fixture with nothing compiled; the cold one (the suites that opt out: `cold`
//     in tests/suites.ts) still compiles it;
//   - the release file's seed cache has none of the fixture's results.
// Waits on editorAPI.whenIdle(), never on times.
//
//   node tests/test-fixture-cache.ts http://localhost:8150/ [dist/reflowtex-editor.html]   (a --seed-cache server)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { freePort } from './qa/lib/free-port.ts';
import { ensureFixtureCache, fixtureCacheState, FIXTURE_CACHE } from './integration/fixture-cache.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDED = (process.argv[2] ?? 'http://localhost:8150/').replace(/\/?$/, '');
const FILE = process.argv[3] ?? join(HERE, 'dist/reflowtex-editor.html');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

// a cold dev server of its own (no --seed-cache): what the suites that opt out get
const port = await freePort();
const cold = spawn(process.execPath, [join(HERE, 'tests/integration/serve.ts'), String(port)], { cwd: HERE, stdio: 'ignore' });
const COLD = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) { try { if ((await fetch(`${COLD}/bundle/info`)).ok) break; } catch { /* not up yet */ } if (i > 600) throw new Error('the cold server did not start'); await new Promise((r) => setTimeout(r, 100)); }

// 1. stale → recorded again; fresh → left alone
const dir = mkdtempSync(join(tmpdir(), 'fixture-cache-'));
const tmp = join(dir, 'fixture-cache.json.gz');
writeFileSync(tmp, gzipSync(Buffer.from(JSON.stringify({ build: 'stale', key: 'stale-key', results: { 'e0000000000.x': {} } }))));
check('a stale fixture cache (another key) is seen as stale', !(await fixtureCacheState(tmp)).ok);
const again = await ensureFixtureCache(COLD, tmp, () => {});
check(`a stale fixture cache is recorded again (${again.results} results, ${again.seconds} s)`, again.recorded && again.ok && again.results > 10, { ...again, data: undefined });
const twice = await ensureFixtureCache(COLD, tmp, () => {});
check('a fresh one is left alone', !twice.recorded && twice.ok);
const mine = twice.data?.results ?? {};
rmSync(dir, { recursive: true, force: true });

// 2. the seeded server serves it; the fixture opens there with nothing compiled, and compiles on the cold one
const info = await (await fetch(`${SEEDED}/dev/seed-cache-info`)).json();
check('the seeded server serves a fitting fixture cache', info.seeded && info.fixture?.ok && info.fixture.results > 10, info);
const browser = await chromium.launch();
const errors: string[] = [];
async function openFixture(base: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e: Error) => errors.push(e.message));
  // a crashed renderer (out of memory) answers no wait: fail at once rather than at the timeout
  page.on('crash', () => { console.log(`FAIL the page crashed (out of memory?) on ${base}`); cold.kill(); process.exit(1); });
  await page.goto(`${base}/?seed=sample&engine&store=memory#/doc/sample`);
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  const r = await page.evaluate(() => {
    const api = (window as any).editorAPI, bs = api.blocks();
    return { stats: api.backendObject?.()?.stats?.() ?? null, ok: bs.filter((b: any) => b.state === 'ok').length, n: bs.length };
  });
  await page.close();
  return r;
}
const s = await openFixture(SEEDED);
check(`seeded: the fixture opens with nothing compiled (${s.stats?.seedHits} seed hits, ${s.ok}/${s.n} blocks typeset)`, s.stats?.compiled === 0 && s.stats?.seedHits > 10 && s.ok > 10, s.stats);
const c = await openFixture(COLD);
check(`cold (the suites that opt out): the fixture still compiles (${c.stats?.compiled} compiled, ${c.ok}/${c.n} typeset)`, c.stats?.compiled > 10 && c.stats?.seedHits === 0 && c.ok === s.ok, c.stats);
check('no page errors', errors.length === 0, errors.slice(0, 3));
await browser.close();
cold.kill();

// 3. a release never carries it: its seed cache names no fixture and holds none of the fixture's own results
if (!existsSync(FILE)) check(`the release file is there (${FILE})`, false);
else {
  const m = /<script id="rtx-seed-cache" type="application\/octet-stream">([^<]*)<\/script>/.exec(readFileSync(FILE, 'utf8'));
  const rel = m ? JSON.parse(gunzipSync(Buffer.from(m[1], 'base64')).toString('utf8')) : { docs: [], results: {} };
  const seedKeys = new Set(existsSync(join(HERE, 'engine/build/seed-cache.json.gz')) ? Object.keys(JSON.parse(gunzipSync(readFileSync(join(HERE, 'engine/build/seed-cache.json.gz'))).toString('utf8')).results ?? {}) : []);
  const own = Object.keys(mine).filter((k) => !seedKeys.has(k));         // the fixture's results no seed paper shares
  const inRel = own.filter((k) => k in (rel.results ?? {}));
  check(`the release has none of the fixture's results (${own.length} of its own, ${Object.keys(rel.results ?? {}).length} in the release; ${FIXTURE_CACHE.split('/').pop()} not read by builds)`,
    own.length > 10 && inRel.length === 0 && !(rel.docs ?? []).some((d: string) => /fixture|sample/.test(d)), { inRel: inRel.slice(0, 3), docs: rel.docs });
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
