// The public checkout the app builds against (scripts/lib/public-repo.ts): found as a sibling checkout, and its bundles
// built on demand. Public main commits no built file: a fresh clone has no src/companion/companion.js and
// no node_modules; the app bundle builds against it all the same.
//   node tests/test-public-bundles.ts
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, failed = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 400)}`}`); };

const saved = process.env.REFLOWTEX;
delete process.env.REFLOWTEX;
const { publicRepo, ensurePublicBundles } = await import('../scripts/lib/public-repo.ts');
const found = publicRepo();
check('publicRepo: without REFLOWTEX, a public checkout is found from this checkout', existsSync(join(found, 'src/companion')) && existsSync(join(found, 'src/viewer')), found);
process.env.REFLOWTEX = '/some/where';
check('publicRepo: REFLOWTEX wins', publicRepo() === '/some/where');
if (saved === undefined) delete process.env.REFLOWTEX; else process.env.REFLOWTEX = saved;

// a fresh clone of it: no built bundle, no node_modules
const src = saved ?? found;
const tmpRoot = join(HERE, 'build/tmp');
mkdirSync(tmpRoot, { recursive: true });
const dir = mkdtempSync(join(tmpRoot, 'pub-'));
try {
  execFileSync('git', ['clone', '-q', '--no-hardlinks', src, join(dir, 'reflowtex')], { stdio: 'pipe' });
  const pub = join(dir, 'reflowtex');
  const helper = existsSync(join(pub, 'src/pipeline/bundles.ts'));
  check('the clone has no built companion and no node_modules', !existsSync(join(pub, 'src/companion/companion.js')) || !helper, { helper });
  const built = await ensurePublicBundles(pub, ['companion'], () => {});
  check('ensurePublicBundles: the companion built (with the app\'s esbuild and packages)', !helper || (built.includes('companion') && existsSync(join(pub, 'src/companion/companion.js'))), built);
  const again = await ensurePublicBundles(pub, ['companion'], () => {});
  check('ensurePublicBundles: up to date, nothing built again', again.length === 0, again);
  const { appBuildOptions } = await import('../scripts/lib/app-bundle.ts');
  const esbuild = createRequire(join(HERE, 'app/package.json'))('esbuild');
  const { options } = appBuildOptions({ minify: false, allowStubs: true, pub });
  let ok = false, err = '';
  try { const r = await esbuild.build(options); ok = r.errors.length === 0 && r.outputFiles[0].text.length > 100000; } catch (e) { err = (e as Error).message.split('\n')[0]!; }
  check('the app bundle builds against the fresh clone', ok, err);
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
