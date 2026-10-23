// Records the dev seed cache, engine/build/seed-cache.json.gz, from the dev app: the seed papers
// opened cold on a dev server (tests/integration/serve.ts, not seeded) and typeset, and every result the page then
// holds written in the shape scripts/build.ts records ({ build, recorded, results }). test-all runs this once
// when the recorded cache's engine build is not the worker's, instead of a whole release build; the next release
// build reuses what still matches (its own precompiling step) and drops the rest.
//
//   node tests/integration/record-seed-cache.ts http://localhost:8150 [--docs intro,…] [--out <file.json.gz>]
//   node tests/integration/record-seed-cache.ts http://localhost:8150 --fixture [--out <file.json.gz>]
// --fixture: the tests' fixture document instead (?seed=sample), into engine/build/fixture-cache.json.gz with its
// key (tests/integration/fixture-cache.ts): dev and tests only, never in a release.
// Waits on editorAPI.whenIdle(), never on fixed times. One page per document (a page holds the engine's ~0.9 GB).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const FIXTURE = argv.includes('--fixture');
const fx = FIXTURE ? await import('./fixture-cache.ts') : null;
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : fx ? fx.FIXTURE_CACHE : join(ROOT, 'engine/build/seed-cache.json.gz');
const BASE = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8150').replace(/\/$/, '');
// the default documents: the seeds scripts/seed.ts built (build/seed/<name>.json), so a document the checkout lacks is never waited for
const built = () => readdirSync(join(ROOT, 'build/seed')).filter((f) => f.endsWith('.json') && !f.endsWith('-report.json')).map((f) => f.slice(0, -5)).join(',');
const DOCS = fx ? fx.FIXTURE_DOCS : (argv.includes('--docs') ? argv[argv.indexOf('--docs') + 1] : built()).split(',');
const { chromium } = createRequire(join(ROOT, 'app/package.json'))('playwright');

const t0 = Date.now();
const results: Record<string, any> = {};
let build: string | null = null, compiled = 0;
const problems: string[] = [];
for (const doc of DOCS) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e: Error) => problems.push(`${doc}: ${e.message}`));
  await page.goto(`${BASE}/?${fx ? `seed=${doc}&` : ''}engine&store=memory#/doc/${doc}`);
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  const d = await page.evaluate(async () => {
    const api = (window as any).editorAPI, be = api.backendObject?.();
    const bs = api.blocks();
    return { results: be?.dump?.() ?? {}, stats: be?.stats?.() ?? null, info: be?.info?.() ?? null, errors: bs.filter((b: any) => b.state === 'error').length, n: bs.length };
  });
  for (const [k, v] of Object.entries(d.results)) if (!(v as any)?.transient) results[k] = v;
  for (const k of Object.keys(d.results)) { const m = /^(?:pre\.)?e([0-9a-f]{10})\./.exec(k); if (m) build ??= m[1]; }
  compiled += d.stats?.compiled ?? 0;
  if (d.errors) problems.push(`${doc}: ${d.errors} blocks failed to typeset`);
  console.log(`${doc}: ${d.n} blocks, ${Object.keys(d.results).length} results (${d.stats?.compiled ?? '?'} compiled)`);
  await browser.close();
}
if (!build || !Object.keys(results).length) { console.error('no results recorded'); process.exit(1); }
mkdirSync(dirname(OUT), { recursive: true });
const had = existsSync(OUT);
// the fixture cache: its key from the fixture and the worker (fixture-cache.ts); results of another build are a problem
const keyed = fx ? { fixture: await fx.fixtureHash(), key: await fx.expectedKey() } : {};
if (fx && build !== fx.workerBuild()) problems.push(`results of engine ${build}, the worker is ${fx.workerBuild()}`);
writeFileSync(OUT, gzipSync(Buffer.from(JSON.stringify({ build, recorded: new Date().toISOString(), docs: DOCS.map((x) => `${fx ? 'fixture' : 'dev'}:${x}`), ...keyed, results })), { level: 9 }));
console.log(`${had ? 'replaced' : 'wrote'} ${OUT}: ${Object.keys(results).length} results of engine ${build}, ${compiled} compiled, ${Math.round((Date.now() - t0) / 1000)} s${problems.length ? `; problems: ${problems.join(' | ')}` : ''}`);
process.exit(problems.length ? 1 : 0);
