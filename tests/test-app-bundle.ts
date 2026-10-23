// The app bundle's one configuration (scripts/lib/app-bundle.ts): a release refuses a missing
// module (no silent stub); the dev page and the release bundle the same modules with the same options but
// minification and the source map; build.ts, w3-build.ts and perf/splice.ts all use it.
//   node tests/test-app-bundle.ts
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appBuildOptions, resolveModules, MissingModuleError, SRC, EDITOR } from '../scripts/lib/app-bundle.ts';

let n = 0, bad = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const real = resolveModules({ allowStubs: false });
check('this tree: every module real', Object.values(real.which).every((v) => v === 'real'), real.which);

// a tree where the store's entry is missing (a rename): the release refuses, the dev page takes the stub
const tmp = mkdtempSync(join(tmpdir(), 'rtx-bundle-'));
cpSync(join(SRC, 'app/stubs.js'), join(tmp, 'app/stubs.js'));
for (const f of ['io/index.ts', 'home/index.js', 'refs/index.ts']) try { cpSync(join(SRC, f), join(tmp, f)); } catch { /* not this name */ }
let refused: unknown = null;
try { resolveModules({ allowStubs: false, src: tmp }); } catch (e) { refused = e; }
check('a release build refuses a missing module (MissingModuleError naming rtx:store)', refused instanceof MissingModuleError && /rtx:store/.test(String((refused as Error).message)), String(refused));
check('the dev page takes the stub for it', resolveModules({ allowStubs: true, src: tmp }).which.store === 'stub');
rmSync(tmp, { recursive: true, force: true });

// release and dev: the same configuration but minify, source map and output
const rel = appBuildOptions({ minify: true, allowStubs: false }).options as any;
const dev = appBuildOptions({ minify: false, allowStubs: true, outfile: '/tmp/x.js', sourcemap: true }).options as any;
const strip = (o: any) => { const { minify: _m, outfile: _o, write: _w, sourcemap: _s, plugins: _p, ...rest } = o; return JSON.stringify(rest); };
check('release and dev bundle options differ only in minify, source map and output', strip(rel) === strip(dev), [strip(rel), strip(dev)]);

// every app build goes through it (no copy of the module table left)
for (const f of ['scripts/build.ts', 'scripts/w3-build.ts', 'app/src/perf/splice.ts']) {
  const s = readFileSync(join(EDITOR, f), 'utf8');
  check(`${f} uses lib/app-bundle.ts and has no module table of its own`, s.includes('appBuildOptions(') && !s.includes("store: { files: ['store/index.ts'"));
}
// the dev page runs the release's viewer and worker: app/lib/viewer is the public repo's install (as
// build.ts installs it), and the worker the dev server serves carries this tree's engine build id
{
  const { PUB } = await import('../scripts/lib/app-bundle.ts');
  const site = await import(join(PUB, 'src/pipeline/site.ts'));
  const fresh = mkdtempSync(join(tmpdir(), 'rtx-viewer-'));
  site.installViewer(fresh, { inspector: false, log: () => {} });
  const same = (f: string) => { try { return readFileSync(join(fresh, f)).equals(readFileSync(join(EDITOR, 'app/lib/viewer', f))); } catch { return false; } };
  check('dev viewer = the public repo\'s viewer (latex-viewer.js, protobuf.min.js; run scripts/w3-build.ts)', same('latex-viewer.js') && same('protobuf.min.js'));
  check('dev schema = the public repo\'s', readFileSync(join(EDITOR, 'app/lib/viewer/schema.b64'), 'utf8') === site.schemaBase64());
  rmSync(fresh, { recursive: true, force: true });
  // compare: the served one must be byte for byte this tree's build, carrying its id
  const { buildWorker } = await import(join(EDITOR, 'engine/scripts/build-worker.ts'));
  const served = readFileSync(join(EDITOR, 'engine/dist/editor-worker.js'), 'utf8');
  const { build: id } = await buildWorker();
  const fresh2 = readFileSync(join(EDITOR, 'engine/dist/editor-worker.js'), 'utf8');
  check(`the served worker is this tree's engine build (${id}; run engine/scripts/build-worker.ts)`, served === fresh2 && served.includes(id));
}
// the worker carries the current editor TeX files (a merge brings a newer .sty; engine/dist is not in git)
{
  const { workerProblem } = await import('../engine/scripts/worker-current.ts');
  const prob = workerProblem();
  check('the worker carries this tree\'s rtx-numbering.sty and the other editor TeX files (else rebuild it)', !prob, prob);
  // and the check sees a stale one: a worker stamped with other TeX files
  const tmpw = join(mkdtempSync(join(tmpdir(), 'rtx-worker-')), 'w.js');
  const cur = readFileSync(join(EDITOR, 'engine/dist/editor-worker.js'), 'utf8');
  writeFileSync(tmpw, cur.replace(/rtx-tex:[0-9a-f]{16}/, 'rtx-tex:0000000000000000'));
  check('… and a worker built before a change of the package is reported stale', !!workerProblem(tmpw) && /rtx-numbering\.sty/.test(workerProblem(tmpw) ?? ''), workerProblem(tmpw));
}
// the dev bundle builds with no esbuild warning (a duplicate key in app.js's createBlocks host was only a
// warning in every build's output)
{
  const { createRequire } = await import('node:module');
  const esbuild = createRequire(join(EDITOR, 'app/package.json'))('esbuild') as typeof import('esbuild');
  const o = appBuildOptions({ minify: false, allowStubs: true }).options as any;
  const r = await esbuild.build({ ...o, logLevel: 'silent' });
  check('the app bundle builds with no esbuild warnings', r.warnings.length === 0, r.warnings.map((w) => `${w.location?.file}:${w.location?.line} ${w.text}`));
}
console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
