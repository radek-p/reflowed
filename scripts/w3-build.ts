// dev build of the editor page (app): the app bundle and the
// assets the page loads next to it. scripts/build.ts makes the single
// file; this is for developing and testing the app.
//
//   node scripts/w3-build.ts [--assets] [--watch]
//
// app/lib/app.js         src/main.js bundled (CodeMirror, the app, the
//                        rtx: modules or app/stubs.js: see `rtx:` below)
// app/lib/two-editors.js, app/lib/gallery.js   the harness and the gallery (app/two-editors.html, app/gallery.html; dev only)
// app/lib/viewer/        latex-viewer.js, protobuf.min.js, schema.b64
// app/lib/companion/     the public companion package (css; js is bundled)
// app/seed/              intro.json (scripts/seed.ts: build/seed/), when built
//
// --assets copies the assets (the public repo, build/seed); without it only
// the bundle is rebuilt. The engine's worker is engine/dist (engine/scripts/build-worker.ts), served by the dev server.
//
// `rtx:<name>` resolves to the module's entry file when it exists
// (contracts.d.ts header), else to src/app/stubs.js; `rtx:modules` tells
// the page which ones are real.
import { createRequire } from 'node:module';
import type * as ESBuild from 'esbuild';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, cpSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appBuildOptions, PUB as PUBLIC, ensurePublicBundles } from './lib/app-bundle.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');     // the repository root
const TC = HERE;                      // the repository root
const PUB = PUBLIC;                   // (scripts/lib/public-repo.ts: REFLOWTEX, else a reflowtex/ checkout next to this one)
await ensurePublicBundles(PUB);       // its companion and inspector built when missing or stale (public main commits none)
const WEB = join(HERE, 'app'), SRC = join(WEB, 'src'), LIB = join(WEB, 'lib');
const args = new Set(process.argv.slice(2));
// the dependencies live in app/node_modules (app/package.json)
const esbuild: typeof ESBuild = createRequire(join(WEB, 'package.json'))('esbuild');

// scripts/lib/app-bundle.ts: the release's configuration, not minified, with a source map
const { options: built, which } = appBuildOptions({ minify: false, allowStubs: true, outfile: join(LIB, 'app.js'), sourcemap: true, pub: PUB });
const opts = built as ESBuild.BuildOptions;
mkdirSync(LIB, { recursive: true });
if (args.has('--watch')) {
  const c = await esbuild.context(opts);
  await c.watch();
  console.log('watching', Object.entries(which).map(([k, v]) => `${k}:${v}`).join(' '));
} else {
  const t0 = performance.now();
  await esbuild.build(opts);
  console.log(`lib/app.js ${(statSync(join(LIB, 'app.js')).size / 1024).toFixed(0)} KB in ${(performance.now() - t0).toFixed(0)} ms; modules`,
    Object.entries(which).map(([k, v]) => `${k}:${v}`).join(' '));
  // the two-editors harness (dev only, never in a release): app/two-editors.html loads lib/two-editors.js
  const { options: harness } = appBuildOptions({ minify: false, allowStubs: true, outfile: join(LIB, 'two-editors.js'), sourcemap: true, pub: PUB });
  await esbuild.build({ ...(harness as ESBuild.BuildOptions), entryPoints: [join(SRC, 'harness/two-editors.ts')] });
  // the gallery (dev only, never in a release): app/gallery.html loads lib/gallery.js (app/src/gallery/main.ts)
  const { options: gallery } = appBuildOptions({ minify: false, allowStubs: true, outfile: join(LIB, 'gallery.js'), sourcemap: true, pub: PUB });
  await esbuild.build({ ...(gallery as ESBuild.BuildOptions), entryPoints: [join(SRC, 'gallery/main.ts')] });
}

// the viewer and its schema from the public repo, installed as the release installs them (scripts/build.ts):
// the dev suites then test the viewer that ships
// (a container without the public repo's node_modules cannot load its pipeline: the copy the last release build
// installed, engine/build/viewer, is the same viewer)
{
  const VIEWER = join(LIB, 'viewer'), RELEASED = join(HERE, 'engine/build/viewer');
  try {
    const site = await import(join(PUB, 'src/pipeline/site.ts'));
    const { Log } = await import(join(PUB, 'src/shared/log.ts'));   // a log with no sinks: the bundles' build lines unprinted
    site.installViewer(VIEWER, { inspector: false, log: new Log('pipeline') });
    writeFileSync(join(VIEWER, 'schema.b64'), site.schemaBase64());
  } catch (e) {
    if (!existsSync(join(RELEASED, 'latex-viewer.js')) || !existsSync(join(RELEASED, 'schema.b64'))) throw e;
    mkdirSync(VIEWER, { recursive: true });
    for (const f of ['latex-viewer.js', 'protobuf.min.js', 'schema.b64']) copyFileSync(join(RELEASED, f), join(VIEWER, f));
    console.warn(`viewer: the public pipeline could not load here (${(e as Error).message.split('\n')[0]}); copied the release build's (engine/build/viewer)`);
  }
  // the public inspector, as the public site serves it (installViewer's `inspector: true` copy): its script and
  // what it loads from beside itself on first use (the multi-file release has the same files in a folder of its own:
  // scripts/lib/multifile.ts; the single file has none).
  const INSPECTOR = join(PUB, 'src/inspector');
  if (existsSync(join(INSPECTOR, 'inspector.js'))) cpSync(INSPECTOR, join(VIEWER, 'inspector'), { recursive: true, filter: (s) => !s.endsWith('README.md') });
  else console.warn(`inspector: ${INSPECTOR} not found; the advanced Inspector is not available on this page`);
}

if (args.has('--assets')) {
  mkdirSync(join(LIB, 'viewer'), { recursive: true });
  mkdirSync(join(LIB, 'companion'), { recursive: true });
  copyFileSync(join(PUB, 'src/companion/companion.css'), join(LIB, 'companion/companion.css'));
  mkdirSync(join(WEB, 'seed'), { recursive: true });
  // the default documents (scripts/seed.ts → build/seed/)
  const seeds = ['intro.json'].filter((n) => existsSync(join(HERE, 'build/seed', n)));
  for (const n of seeds) copyFileSync(join(HERE, 'build/seed', n), join(WEB, 'seed', n));
  console.log(`assets: viewer, schema, companion, seed (${seeds.join(', ') || 'none'})`);
}
