// The fixture cache: the typeset blocks of the tests' fixture document (?seed=sample,
// app/src/app/test-fixture.js), recorded from the cold dev app into engine/build/fixture-cache.json.gz. Dev and
// tests only: the seeded dev server (serve.ts --seed-cache) serves it with the seed cache, so the suites that open
// the fixture start with nothing to compile. A release never carries it: scripts/build.ts reads only
// seed-cache.json.gz (arch-units guards that build.ts never names this file; test-fixture-cache checks a release).
//
// Its key is sha256(fixture : engine build): the fixture as the app makes it (testFixtureDocument(), so any
// edit to its source counts) and the worker's build id. A file with another key is stale: serve.ts does not
// serve it, and ensureFixtureCache() (test-all, before the suites) records it again (about a minute).
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURE_CACHE = join(ROOT, 'engine/build/fixture-cache.json.gz');
const FIXTURE_JS = join(ROOT, 'app/src/app/test-fixture.js');
const WORKER = join(ROOT, 'engine/dist/editor-worker.js');
/** the fixture documents the cache holds (their #/doc/<id> routes; ?seed=<id> makes them) */
export const FIXTURE_DOCS = ['sample'];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** the worker's engine build id (null: no worker built) */
export function workerBuild(): string | null {
  if (!existsSync(WORKER)) return null;
  return /build:"([0-9a-f]{10})"/.exec(readFileSync(WORKER, 'utf8'))?.[1] ?? null;
}
/** sha256 of the fixture document as the app makes it (the module read again when its file changed) */
export async function fixtureHash(): Promise<string> {
  const m = await import(`${pathToFileURL(FIXTURE_JS).href}?m=${statSync(FIXTURE_JS).mtimeMs}`);
  return sha(JSON.stringify(m.testFixtureDocument())).slice(0, 16);
}
/** the key a fixture cache must carry for this fixture and this worker (null: no worker) */
export async function expectedKey(build = workerBuild()): Promise<string | null> {
  return build ? sha(`${await fixtureHash()}:${build}`).slice(0, 16) : null;
}

export interface FixtureState { ok: boolean; key: string | null; want: string | null; results: number; problem?: string; data?: { build: string; results: Record<string, unknown> } }
/** The recorded fixture cache and whether it fits (its key is the expected one). */
export async function fixtureCacheState(file = FIXTURE_CACHE): Promise<FixtureState> {
  const want = await expectedKey();
  if (!want) return { ok: false, key: null, want, results: 0, problem: 'no worker built (engine/dist/editor-worker.js)' };
  if (!existsSync(file)) return { ok: false, key: null, want, results: 0, problem: `${file} is not recorded` };
  let c: any;
  try { c = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')); } catch (e) { return { ok: false, key: null, want, results: 0, problem: `unreadable: ${e}` }; }
  const results = Object.keys(c.results ?? {}).length;
  if (c.key !== want) return { ok: false, key: c.key ?? null, want, results, problem: `stale: key ${c.key} (fixture ${c.fixture}, engine ${c.build}), the fixture and the worker give ${want}` };
  return { ok: true, key: c.key, want, results, data: { build: c.build, results: c.results ?? {} } };
}

/** Records the fixture cache again from a cold dev server when it is stale or missing; returns its state after. */
export async function ensureFixtureCache(coldDev: string, file = FIXTURE_CACHE, log = console.log): Promise<FixtureState & { recorded: boolean; seconds: number }> {
  const t = Date.now();
  const before = await fixtureCacheState(file);
  if (before.ok) return { ...before, recorded: false, seconds: 0 };
  log(`note: the fixture cache does not fit (${before.problem}): recording it from the dev app…`);
  const code = await new Promise<number | null>((r) => spawn(process.execPath,
    [join(ROOT, 'tests/integration/record-seed-cache.ts'), coldDev, '--fixture', '--out', file],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] }).on('close', r));
  const after = await fixtureCacheState(file);
  if (code !== 0) log(`note: recording the fixture cache exited ${code}`);
  return { ...after, recorded: true, seconds: Math.round((Date.now() - t) / 1000) };
}
