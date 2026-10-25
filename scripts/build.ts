// The editor in ONE HTML file: dist/reflowtex-editor.html. It opens from file:// with no network.
// And the same parts as a multi-file release beside it (scripts/lib/multifile.ts): dist/reflowtex-editor/
// (index.html, its loader, content-named files), for a static server in any directory.
//
//   node scripts/build.ts [--no-seed-cache] [--engine=node|browser] [--no-seed] [--no-multi]
//   (--no-multi: the single file only)
//   (every build precompiles the default documents, reusing the recorded results
//    that still match: see "Precompiling" below; exits 1 if one of their blocks fails;
//    --no-seed-cache: a quick build with nothing baked in)
//
// In the page:
//   <script id="rtx-worker-js" type="text/plain">   engine/dist/editor-worker.js (a blob: URL starts it)
//   <script id="rtx-pack" type="application/octet-stream">   base64 of the gzipped pack:
//       [u32 header length][JSON [[name, offset, length]…]][bytes…] with latex.fmt,
//       tectonic_wasm.wasm (the editor engine: Asyncify + engine capture) and
//       texmf/<name> for every working-set file
//   <script id="rtx-seed-doc" type="application/json">   { 'intro.json': … }:
//       the default documents (build/seed/, scripts/seed.ts); the boot script sets
//       globalThis.__rtxSeeds and answers seed/<name> fetches from them
//   <script id="rtx-seed-cache" type="application/octet-stream">   base64 gzip of
//       { build, docs, results: { key: BlockResult }, fonts } for the default documents
//       (engine/build/seed-cache.json.gz), so opening one compiles nothing
//   a boot script: globalThis.__rtxEditor = { createWorker, initArgs, seedCache, backends }
//   the viewer, the app (src/main.js with its modules, bundled)
//
// Working set: engine/working-set.txt (scripts/record.ts) ∪ engine/working-set-v1.txt
// ∪ engine/working-set-add.txt, read from the bundle cache (engine/build/tectonic-cache).
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appBuildOptions, PUB as PUBLIC, ensurePublicBundles } from './lib/app-bundle.ts';
import { provenance, publicProblem, generatorOf } from './lib/provenance.ts';
import { writeMultiFile, appOutputs, zstdCached } from './lib/multifile.ts';
import * as zlib from 'node:zlib';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');     // the repository root
const TC = HERE;                      // the repository root
const ENGINE = join(HERE, 'engine'), WEB = join(HERE, 'app'), SRC = join(WEB, 'src');
const PUB = PUBLIC;                   // (scripts/lib/public-repo.ts) REFLOWTEX, /reflowtex, else the workspace's
await ensurePublicBundles(PUB);       // the companion and the inspector built when missing or stale (public main commits none)
const DIST = join(HERE, 'dist'), BUILD = join(ENGINE, 'build');
const VERSION = process.env.EDITOR_VERSION ?? 'poc';
const args = new Set(process.argv.slice(2));
const req = createRequire(join(ENGINE, 'package.json'));
const esbuild = req('esbuild') as typeof import('esbuild');
mkdirSync(DIST, { recursive: true });
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`, kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const t0 = performance.now();

// the engine and the format must be the ones engine/reflow-tectonic.json names (scripts/engine-stamp.ts): they are not
// in git, so a change of the lock leaves the old ones here until scripts/fetch-engine.ts runs
{
  const { stampProblem } = await import('./engine-stamp.ts');
  const problem = stampProblem(HERE);
  if (problem) { console.error(`build: ${problem}`); process.exit(1); }
}

// ── Worker ───────────────────────────────────────────────────────────────────
const { buildWorker, workingSetNames, localTexFiles, LOCAL_TEX_DIR } = await import(join(ENGINE, 'scripts/build-worker.ts'));
// --pin-worker: package engine/dist/editor-worker.js as it is (last build) instead of
// rebuilding it from the sources; its build id is read from the bundle (ENGINE_BUILD)
const worker = [...args].some((a) => a.startsWith('--pin-worker'))
  ? (() => {
    const path = join(ENGINE, 'dist/editor-worker.js');
    const ids = [...new Set([...readFileSync(path, 'utf8').matchAll(/"([0-9a-f]{10})"/g)].map((m) => m[1]))];
    const build = [...args].find((a) => a.startsWith('--pin-worker='))?.slice(13) ?? (ids.length === 1 ? ids[0] : null);
    if (!build) throw new Error(`--pin-worker: cannot tell the build id in ${path} (${ids.join(', ')}); pass --pin-worker=<id>`);
    console.log(`worker: pinned ${path} (build ${build}), not rebuilt`);
    return { path, build, bytes: statSync(path).size };
  })()
  : await buildWorker();
const workerJs = readFileSync(worker.path, 'utf8');

// ── Pack ─────────────────────────────────────────────────────────────────────
process.env.TECTONIC_CACHE ??= join(BUILD, 'tectonic-cache');
const { getIndex, resolveTarUrl, getFileCachedSync } = await import(join(TC, 'engine/server/bundle.ts'));
const bundleUrl: string = await resolveTarUrl();
// provenance; a release is built from the public repo's main, clean (--public-any to override)
const PROV = provenance({ tc: TC, pub: PUB, wasm: join(ENGINE, 'dist/async/tectonic_wasm.wasm'), fmt: join(TC, 'engine/api/formats/latex.fmt'), bundleUrl });
const PUB_PROBLEM = publicProblem(PROV);
if (PUB_PROBLEM && !args.has('--no-seed-cache') && !args.has('--public-any')) {
  console.error(`BUILD REFUSED: ${PUB_PROBLEM}; a release is built from the public main with no local changes (--public-any to override)`);
  process.exit(1);
}
console.log(`provenance: ${generatorOf(VERSION, '…', PROV)}${PUB_PROBLEM ? ` (${PUB_PROBLEM})` : ''}`);
const index: Map<string, unknown> = await getIndex();
const names: string[] = workingSetNames();
const entries: [string, Uint8Array][] = [
  ['latex.fmt', readFileSync(join(TC, 'engine/api/formats/latex.fmt'))],
  ['tectonic_wasm.wasm', readFileSync(join(ENGINE, 'dist/async/tectonic_wasm.wasm'))],
];
let texBytes = 0;
const missing: string[] = [];
const fileBytes = new Map<string, number>();
for (const n of names) {
  if (!index.has(n)) { missing.push(n); continue; }
  const b: Uint8Array = getFileCachedSync(n) ?? execFileSync(process.execPath, [join(TC, 'engine/server/fetch-one.ts'), n], { maxBuffer: 1 << 30, env: process.env });
  texBytes += b.length;
  fileBytes.set(n, b.length);
  entries.push([`texmf/${n}`, b]);
}
// TeX files the bundle lacks (engine/tex: lipics-v2021 and its logos)
for (const n of localTexFiles() as string[]) {
  const b = readFileSync(join(LOCAL_TEX_DIR, n));
  texBytes += b.length;
  fileBytes.set(n, b.length);
  entries.push([`texmf/${n}`, b]);
}
// ── Minify (default; --no-minify) and compress (zstd -19; gzip -9 with a pinned or --gzip-pack) ─
// scripts/minify-pack.ts: TeX comments out, font maps trimmed, proven by compiling
// every recorded document with both packs in Node (byte-identical results and
// fonts; a file that makes a difference is kept as it is). The proof is kept in
// engine/build/minify-proof.json and rerun when the worker or a file changes.
const { minifyEntries, prove, packRaw } = await import('./minify-pack.ts');
const MINIFY = !args.has('--no-minify');
let packEntries = entries;
let minifyNote = 'off (--no-minify)';
if (MINIFY) {
  const proofPath = join(BUILD, 'minify-proof.json');
  const first = minifyEntries(entries);
  const sig = createHash('sha256').update(worker.build);
  for (const [n, b] of entries) if (first.changed.has(n.replace(/^texmf\//, ''))) sig.update(n).update(b);
  const key = sig.digest('hex').slice(0, 16);
  let proof: { key: string; exclude: string[]; ok: boolean; date?: string; seconds?: number } | null = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : null;
  if (!proof || proof.key !== key) {
    const t = performance.now();
    console.log(`minify: proving ${first.changed.size} minified files over the recorded documents (Node, two packs)…`);
    const docs = await (await import('./record-docs.ts')).recordDocs();
    const r = await prove({ workerJs, entries, docs, gzip: (b) => gzipSync(b, { level: 1 }), log: (s) => console.log(s) });
    proof = { key, exclude: [...r.exclude].sort(), ok: r.ok, date: new Date().toISOString(), seconds: Math.round((performance.now() - t) / 1000) };
    writeFileSync(proofPath, JSON.stringify({ ...proof, diffs: r.diffs.slice(0, 50), report: r.report }, null, 1));
    if (!r.ok) console.log(`minify: the proof did not settle (${r.diffs.slice(0, 3).join(', ')}): the pack goes unminified`);
  }
  if (proof.ok) {
    const m = minifyEntries(entries, new Set(proof.exclude));
    packEntries = m.entries;
    minifyNote = `${m.report.stripped} TeX files stripped (−${mb(m.report.savedTex)}), maps trimmed (−${mb(m.report.savedMaps)}), ${Object.keys(m.report.skipped).length} left as they are (risky), ${proof.exclude.length} excluded by the proof, ${m.report.duplicates} duplicates`;
  } else minifyNote = 'NOT applied: the proof found differences it could not attribute (engine/build/minify-proof.json)';
  console.log(`minify: ${minifyNote}`);
}
const raw = packRaw(packEntries);
const ZSTD = !args.has('--gzip-pack') && !([...args].some((a) => a.startsWith('--pin-worker')));
const packGz: Buffer = ZSTD
  ? (zlib as any).zstdCompressSync(raw, { params: { [(zlib.constants as any).ZSTD_c_compressionLevel]: 19, [(zlib.constants as any).ZSTD_c_windowLog]: 26 } })
  : gzipSync(raw, { level: 9 });
const packB64 = Buffer.from(packGz).toString('base64');
// (multi-file) the pack as three files: the wasm, the format, the TeX files (each changes on its own; zstd -19, kept by hash)
const MULTI = !args.has('--no-multi');
const multiPacks = MULTI ? [
  { id: 'wasm', bytes: zstdCached(packRaw(packEntries.filter(([n]) => n === 'tectonic_wasm.wasm')), join(BUILD, 'zstd-cache')) },
  { id: 'format', bytes: zstdCached(packRaw(packEntries.filter(([n]) => n === 'latex.fmt')), join(BUILD, 'zstd-cache')) },
  { id: 'texmf', bytes: zstdCached(packRaw(packEntries.filter(([n]) => n.startsWith('texmf/'))), join(BUILD, 'zstd-cache')) },
] : [];
console.log(`pack: ${entries.length - 2} TeX files ${mb(texBytes)}${missing.length ? ` (${missing.length} not in the bundle: ${missing.slice(0, 5).join(', ')})` : ''}, `
  + `format ${mb(entries[0][1].length)}, wasm ${mb(entries[1][1].length)}; ${mb(raw.length)} -> ${mb(packGz.length)} ${ZSTD ? 'zstd -19' : 'gzip -9'} -> ${mb(packB64.length)} base64`);

// ── Viewer, schema ───────────────────────────────────────────────────────────
const site = await import(join(PUB, 'src/pipeline/site.ts'));
site.installViewer(join(BUILD, 'viewer'), { inspector: false, log: () => {} });
const viewerJs = readFileSync(join(BUILD, 'viewer/latex-viewer.js'), 'utf8');
const protobufJs = readFileSync(join(BUILD, 'viewer/protobuf.min.js'), 'utf8');
const schemaB64: string = site.schemaBase64();
writeFileSync(join(BUILD, 'viewer/schema.b64'), schemaB64);   // beside the viewer: the dev page's copy when it cannot load the public pipeline

// ── The app (src/main.js; `rtx:<name>` as scripts/w3-build.ts resolves it) ─
// scripts/lib/app-bundle.ts: the same configuration as the dev page; a missing module fails the build
const ALLOW_STUBS = process.argv.includes('--allow-stubs');
const { options: appOptions, which } = appBuildOptions({ minify: true, allowStubs: ALLOW_STUBS, pub: PUB });
const app = await esbuild.build(appOptions as any);
const appJs = app.outputFiles[0].text;
// (multi-file) the same app in parts: the entry, the code it shares, the lazy features (scripts/lib/multifile.ts LAZY)
const SPLIT_DIR = join(DIST, '.split');
const appParts = MULTI ? appOutputs(await esbuild.build(appBuildOptions({ minify: true, allowStubs: ALLOW_STUBS, pub: PUB, split: SPLIT_DIR }).options as any) as any, SPLIT_DIR, HERE) : [];
// (multi-file) its boot loader (loading/page-loader.ts), inlined in its index.html
const loaderJs = MULTI ? (await esbuild.build({ entryPoints: [join(HERE, 'loading/page-loader.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: MINIFY, legalComments: 'none', write: false, logLevel: 'warning' })).outputFiles[0].text : '';

// ── Minified page parts, and the third-party licences in one place ───────────
// The worker and the app are esbuild-minified bundles already; the viewer, the
// protobuf runtime, the boot script and the style sheets go through esbuild's
// minifier here; the HTML loses comments and blank runs (not inside pre,
// textarea, script, style). Licence banners are dropped from the code, and the
// licence texts of every package bundled into the page or the worker are in
// one <script type="text/plain" id="third-party-licenses"> block.
const minJs = async (js: string) => (MINIFY ? (await esbuild.transform(js, { minify: true, legalComments: 'none', target: 'es2022' })).code : js);
const minCss = async (f: string) => { const c = readFileSync(f, 'utf8'); return MINIFY ? (await esbuild.transform(c, { loader: 'css', minify: true, legalComments: 'none' })).code : c; };
function minHtml(h: string): string {
  if (!MINIFY) return h;
  const keep: string[] = [];
  h = h.replace(/<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  h = h.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/[ \t]*\n[\s]*/g, '\n').replace(/[ \t]{2,}/g, ' ');
  return h.replace(/\u0000(\d+)\u0000/g, (_m, i) => keep[+i]);
}
const viewerMin = await minJs(viewerJs), protobufMin = await minJs(protobufJs);
const cssText = {
  companion: await minCss(join(PUB, 'src/companion/companion.css')),
  app: await minCss(join(WEB, 'app.css')),
};
const builtAt = new Date().toISOString();
const { collectLicences, licencesText, NOTICE } = await import('./licences.ts');
// the default documents this build carries: the intro always (samples/intro/, rebuilt from its source below), and
// what --seeds=<name>.json adds (other seed files in build/seed/)
const SEED_NAMES = [...new Set(['intro.json', ...([...args].find((a) => a.startsWith('--seeds='))?.slice(8) ?? '').split(',').filter(Boolean)])];
const LIC = await collectLicences({ appMeta: app.metafile!, engineDir: ENGINE, pub: PUB, tc: TC, texFiles: entries, seeds: SEED_NAMES,
  roots: [join(ENGINE, 'node_modules'), join(WEB, 'node_modules'), join(TC, 'engine/encode/node_modules'), join(PUB, 'node_modules')] });
const LICENCES_RAW = licencesText(LIC, `reflowtex editor ${VERSION}, engine ${worker.build}, ${builtAt}`);
const LICENCES = LICENCES_RAW.replace(/<\//g, '<\\/');
// the About panel's index (names, licences; the texts are in the plain block above)
const LICENCES_JSON = JSON.stringify({ ...LIC, npm: LIC.npm.map(({ text: _t, ...p }) => p), engine: LIC.engine.map(({ text: _t, ...e }) => e), build: { engine: worker.build, version: VERSION, date: builtAt } }).replace(/</g, '\\u003c');
console.log(`licences: ${LIC.npm.length} npm packages, ${LIC.engine.length} engine parts, ${LIC.tex.length} TeX files (${LIC.tex.filter((t) => !/not stated/.test(t.licence)).length} with a stated licence), 2 documents`);

// ── Seed documents and seed cache ────────────────────────────────────────────
// build/seed/intro.json (the introduction to ReflowEd, samples/intro/) and any --seeds, each inline; the app loads
// them into an empty store.
// The seed cache, engine/build/seed-cache.json.gz =
//   { build, docs, results: { key: result }, fonts: { reqs, served, files: { name: base64 } } }
// is kept up to date on every build (below, "Precompiling"): results whose key
// is still what the runtime asks for are reused, the rest are compiled.
const seedFiles: Record<string, string> = {};
// Each seed gets version fields (seed version field";
// app/src/io/seeds.ts): seedHash (content: the JSON without the version fields,
// as seedHashOf computes it), seedVersion = sha256(seedHash:engine)[0,16], build { engine, date }.
{
  // the intro from its committed source, every build (deterministic ids: the seed cache's results stay valid)
  const { buildIntroSeed } = await import('../samples/intro/seed-intro.ts');
  const { stampSeed } = await import('./seed.ts');
  mkdirSync(join(HERE, 'build/seed'), { recursive: true });
  writeFileSync(join(HERE, 'build/seed/intro.json'), JSON.stringify(await stampSeed((await buildIntroSeed()).seed)));
}
for (const n of SEED_NAMES) {
  const p = join(HERE, 'build/seed', n);
  if (!existsSync(p)) { console.error(`BUILD FAILED: build/seed/${n} is not there (node scripts/seed.ts)`); process.exit(1); }
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const { seedHash: _h, seedVersion: _v, build: _b, builtAt: _t, ...rest } = s;
  const sha = (x: string) => createHash('sha256').update(x).digest('hex');
  const seedHash: string = s.seedHash ?? sha(JSON.stringify(rest)).slice(0, 16);
  seedFiles[n] = JSON.stringify({ ...s, seedHash, seedVersion: sha(`${seedHash}:${worker.build}`).slice(0, 16), build: { engine: worker.build, date: builtAt } });
}
const seedDocBytes = Object.values(seedFiles).reduce((a, s) => a + s.length, 0);
const seedCachePath = join(BUILD, 'seed-cache.json.gz');
type SeedCache = { build: string; recorded?: string; docs: string[]; results: Record<string, any>; fonts?: any };
/** The recorded cache, limited to this engine build (every key carries the build id: others can never hit). */
function loadSeedCache(): { cache: SeedCache | null; dropped: number } {
  if (!existsSync(seedCachePath)) return { cache: null, dropped: 0 };
  let c: SeedCache;
  try { c = JSON.parse(gunzipSync(readFileSync(seedCachePath)).toString('utf8')); } catch { return { cache: null, dropped: 0 }; }
  const results = c.results ?? (c as any);                      // the old shape: a plain { key: result }
  const mine = (k: string) => k.startsWith(`e${worker.build}.`) || k.startsWith(`pre.e${worker.build}.`);
  const keep = Object.fromEntries(Object.entries(results).filter(([k]) => mine(k)));
  const dropped = Object.keys(results).length - Object.keys(keep).length;
  if (!Object.keys(keep).length) return { cache: null, dropped };
  return { cache: { build: worker.build, docs: c.docs ?? [], results: keep, fonts: c.build === worker.build ? c.fonts : undefined }, dropped };
}
// ── Size per tier (engine/working-set-tiers.json, scripts/record.ts) ─────────
// Each recorded document's files counted in the first tier that opened them;
// the files no document opened (the v1 file's set, TIER_FILES, tex/) are "other".
function tierReport() {
  const path = join(ENGINE, 'working-set-tiers.json');
  const docs: { tier: number | 'base'; name: string; ok: boolean; files: string[] }[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  const byName = new Map(entries.map(([n, b]) => [n.replace(/^texmf\//, ''), b]));
  const seen = new Set<string>();
  const out: Record<string, { files: number; bytes: number; gzBytes: number; docs: string[]; failed: string[] }> = {};
  const add = (tier: string, name: string | null, files: string[], ok = true) => {
    const t = (out[tier] ??= { files: 0, bytes: 0, gzBytes: 0, docs: [], failed: [] });
    if (name) (ok ? t.docs : t.failed).push(name);
    for (const f of files) {
      const b = byName.get(f);
      if (!b || seen.has(f)) continue;
      seen.add(f); t.files++; t.bytes += b.length; t.gzBytes += gzipSync(b, { level: 9 }).length;
    }
  };
  for (const tier of ['base', 1, 2] as const) for (const d of docs.filter((x) => x.tier === tier)) add(String(tier), d.name, d.files, d.ok);
  add('other', null, [...byName.keys()].filter((n) => n !== 'latex.fmt' && n !== 'tectonic_wasm.wasm'));
  return out;
}

// ── The page ─────────────────────────────────────────────────────────────────
function inlineJs(js: string, what: string): string {
  const out = js.replace(/<(\/script|!--)/gi, '\\x3C$1');
  if (/<\/script|<!--/i.test(out)) throw new Error(`${what}: could not make it safe to inline`);
  return out;
}
const boot = `
// The single file's side of engine/web/backend.js: the worker from #rtx-worker-js
// (a blob: URL: file:// allows no worker by path), the pack from #rtx-pack (the
// worker decodes it), the default documents' prebuilt results from #rtx-seed-cache,
// and seed/<name> fetches answered from the page (file:// has no fetch).
(() => {
  const take = (id) => { const el = document.getElementById(id); if (!el) return null; const t = el.textContent; el.remove(); return t; };
  let workerSrc = null, pack = null;
  const once = () => { if (workerSrc === null) { workerSrc = take('rtx-worker-js'); pack = take('rtx-pack'); } };
  const b64 = (s) => { const U = Uint8Array; if (U.fromBase64) return U.fromBase64(s); const bin = atob(s); const o = new U(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
  const gunzip = async (bytes) => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }).pipeThrough(new DecompressionStream('gzip'))).text();
  const cacheText = take('rtx-seed-cache');
  const seedDoc = take('rtx-seed-doc');
  globalThis.__rtxEditor = {
    version: ${JSON.stringify(VERSION)}, build: ${JSON.stringify(worker.build)},
    backends: [],
    seedCache: cacheText ? gunzip(b64(cacheText)).then((t) => JSON.parse(t)).catch(() => null) : null,
    createWorker() { once(); return new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }))); },
    initArgs() { once(); return { pack }; },
  };
  // the app reads globalThis.__rtxSeeds[name] first, seed/<name> otherwise
  const seeds = seedDoc ? JSON.parse(seedDoc) : {};
  globalThis.__rtxSeeds = seeds;
  const realFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const m = /\\/seed\\/([^/?#]+)$/.exec(url);
    if (m) return Promise.resolve(seeds[m[1]] != null ? new Response(seeds[m[1]], { headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 }));
    return realFetch.call(this, input, init);
  };
})();`;
const bootMin = await minJs(boot);

// Where the file goes. The pages the precompiling step opens: dist/.work/. The
// result: a release, dist/releases/reflowtex-editor-YYYY-MM-DD-HHMM.html (London
// time) + its .json, never deleted; when every acceptance check passes it is
// copied to dist/reflowtex-editor.html (+ .json), the newest good one. A release
// that fails is renamed …-HHMM.broken.html and the latest stays as it was.
// --no-seed-cache (nothing baked in, no acceptance): dist/reflowtex-editor-unbaked.html only.
const WORK = join(DIST, '.work'), RELEASES = join(DIST, 'releases');
mkdirSync(WORK, { recursive: true }); mkdirSync(RELEASES, { recursive: true });
const stampOf = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
};
const BUILT = new Date();
const BUILD_STAMP = stampOf(BUILT).replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/, '$1 $2:$3');   // as the release file's name, for the UI
let RELEASE = join(RELEASES, `reflowtex-editor-${stampOf(BUILT)}.html`);
for (let i = 2; existsSync(RELEASE) || existsSync(RELEASE.replace(/\.html$/, '.broken.html')); i++) RELEASE = join(RELEASES, `reflowtex-editor-${stampOf(new Date())}-${i}.html`);
const LATEST = join(DIST, 'reflowtex-editor.html');
let out = join(WORK, 'reflowtex-editor.html');
const jsonOf = (f: string) => f.replace(/\.html$/, '.json');
/** (multi-file) the directory beside a single file: its name without .html */
const multiDirOf = (f: string) => f.replace(/\.html$/, '');
/** the single file with only the intro: under 40 MB (decimal, as a file manager shows it) */
const SIZE_LIMIT = 40e6;
const tiers = tierReport();
/** The page with this seed cache (gzipped JSON, or null), and its stats file. */
function emit(seedCacheGz: Buffer | null, seedCacheNote: string) {
  const seedCacheB64 = seedCacheGz ? seedCacheGz.toString('base64') : '';
  let html = minHtml(readFileSync(join(WEB, 'index.html'), 'utf8'));
  const swap = (from: RegExp, to: string) => {
    if (!from.test(html)) throw new Error(`index.html: ${from} not found – the page changed; update scripts/build.ts`);
    html = html.replace(from, () => to);
  };
  const css = (t: string) => `<style>${t}</style>`;
  swap(/\{\{SCHEMA_B64\}\}/g, schemaB64);
  // (the title as it is: swap() inserts its text literally, so no $1)
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'Reflow TeX';
  swap(/<title>([^<]*)<\/title>/, `<title>${title}</title>\n<meta name="generator" content="${generatorOf(VERSION, worker.build, PROV)}">\n<meta name="license" content="${NOTICE.replace(/"/g, '&quot;')}">\n<meta name="reflowed-build" content="${BUILD_STAMP} · ${(PROV.lab?.rev ?? '').slice(0, 7)}${PROV.lab?.dirty ? '+' : ''}">`);   // the version the UI shows
  const baseHtml = html;            // (multi-file) the page before the single file's parts go in
  swap(/<link rel="stylesheet" href="lib\/companion\/companion\.css">/, css(cssText.companion));
  swap(/<link rel="stylesheet" href="app\.css">/, css(cssText.app));
  swap(/<script src="lib\/viewer\/protobuf\.min\.js"><\/script>\s*<script src="lib\/viewer\/latex-viewer\.js"><\/script>\s*<script type="module" src="lib\/app\.js"><\/script>/,
    `<script id="rtx-worker-js" type="text/plain">${inlineJs(workerJs, 'worker')}</script>\n`
    + `<script id="rtx-pack" type="application/octet-stream">${packB64}</script>\n`
    + (seedDocBytes ? `<script id="rtx-seed-doc" type="application/json">${inlineJs(JSON.stringify(seedFiles).replace(/</g, '\\u003c'), 'seed')}</script>\n` : '')
    + (seedCacheB64 ? `<script id="rtx-seed-cache" type="application/octet-stream">${seedCacheB64}</script>\n` : '')
    + `<script>${inlineJs(bootMin, 'boot')}</script>\n`
    + `<script>${inlineJs(protobufMin, 'protobuf.min.js')}</script>\n`
    + `<script>${inlineJs(viewerMin, 'latex-viewer.js')}</script>\n`
    + `<script type="text/plain" id="third-party-licenses">${LICENCES}</script>\n`
    + `<script type="application/json" id="rtx-licences">${LICENCES_JSON}</script>\n`
    + `<script type="module">${inlineJs(appJs, 'app')}</script>`);
  // the author's notice first, before anything else in the file
  html = `<!--\n${NOTICE}\nThird-party components, the example documents and their licences: the script #third-party-licenses near the end of this file (and About · Licence in the app).\n-->\n` + html;
  writeFileSync(out, html);
  const size = statSync(out).size, gz = gzipSync(Buffer.from(html), { level: 9 }).length;
  // (multi-file) beside it, under its name without .html (not for the precompiling step's pages)
  const multi = MULTI && !out.startsWith(WORK) ? writeMultiFile(multiDirOf(out), {
    html: baseHtml, notice: NOTICE, version: VERSION, build: worker.build, stamp: BUILD_STAMP,
    css: [{ id: 'companion.css', text: cssText.companion }, { id: 'app.css', text: cssText.app }],
    scripts: [{ id: 'protobuf', text: protobufMin }, { id: 'viewer', text: viewerMin }],
    app: appParts, seeds: seedFiles, worker: workerJs, packs: multiPacks, seedCacheGz, licences: LICENCES_RAW, licencesJson: LICENCES_JSON, loader: loaderJs,
  }) : null;
  const multiStats = multi ? { dir: multiDirOf(out), bytes: multi.bytes, indexBytes: multi.index, files: multi.files.length,
    essentialBytes: multi.files.filter((x) => x.group === 'essential').reduce((a, x) => a + x.bytes, 0), restBytes: multi.files.filter((x) => x.group === 'rest').reduce((a, x) => a + x.bytes, 0),
    inventory: multi.files.map(({ id, path, bytes, group }) => ({ id, path, bytes, group })) } : null;
  const stats = {
    version: VERSION, built: new Date().toISOString(), engineBuild: worker.build, bytes: size, gzipBytes: gz,
    texFiles: entries.length - 2, texBytes, formatBytes: entries[0][1].length, wasmBytes: entries[1][1].length,
    packBytes: raw.length, packGzBytes: packGz.length, workerBytes: workerJs.length, appBytes: appJs.length,
    viewerBytes: viewerMin.length + protobufMin.length, licencesBytes: LICENCES.length, packCompression: ZSTD ? 'zstd-19' : 'gzip-9', minify: minifyNote, seedDocBytes, seedDocs: Object.fromEntries(Object.entries(seedFiles).map(([k, v]) => [k, v.length])),
    seedCacheGzBytes: seedCacheGz?.length ?? 0, seedCache: seedCacheNote,
    modules: which, tiers, provenance: PROV, multiFile: multiStats,
  };
  writeFileSync(jsonOf(out), JSON.stringify(stats, null, 2));
  // with only the intro (the default) the single file stays under 40 MB: it inlines only the essentials
  // (the embedded set: what the papers, the plain classes and the tier documents open), the rest is the TeX resource
  // server's. A larger file fails the build.
  const onlyIntro = Object.keys(seedFiles).every((n) => n === 'intro.json');
  if (onlyIntro && size >= SIZE_LIMIT) { console.error(`BUILD FAILED: ${out} is ${(size / 1e6).toFixed(1)} MB with only the intro; the limit is 40 MB (docs/RESOURCES.md §4)`); process.exit(1); }
  if (multiStats && onlyIntro && multiStats.bytes >= SIZE_LIMIT) { console.error(`BUILD FAILED: ${multiStats.dir} is ${(multiStats.bytes / 1e6).toFixed(1)} MB with only the intro; the limit is 40 MB`); process.exit(1); }
  if (multiStats) console.log(`${multiStats.dir}/: ${multiStats.files + 1} files, ${mb(multiStats.bytes)}; before the UI ${mb(multiStats.essentialBytes)} + index.html ${kb(multiStats.indexBytes)}, after it ${mb(multiStats.restBytes)}`);
  console.log(`${out}: ${mb(size)} (${mb(gz)} gz); worker ${kb(workerJs.length)}, app ${kb(appJs.length)}, viewer ${kb(viewerMin.length + protobufMin.length)}, `
    + `seed docs ${Object.entries(seedFiles).map(([k, v]) => `${k} ${kb(v.length)}`).join(' + ') || 'none'}, seed cache ${kb(stats.seedCacheGzBytes)} gz (${seedCacheNote}); `
    + `modules ${Object.entries(which).map(([k, v]) => `${k}:${v}`).join(' ')}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
for (const [t, v] of Object.entries(tiers)) console.log(`  tier ${t}: ${v.files} files, ${mb(v.bytes)} (${mb(v.gzBytes)} gz)${v.failed.length ? `; failed: ${v.failed.join(', ')}` : ''}`);

// ── Precompiling the default documents (every build) ─────────────────────────
// The page is built with the recorded results that still match (same engine
// build; a block's key = engine build, preamble + bbl hash, context + source
// hash, exactly as the runtime computes it, because the runtime computes it),
// opened offline in Chromium (one page per document), and the document opened and typeset:
// the backend answers matching blocks from the seed and compiles only the
// missing or stale ones. The results the page then holds (only those the
// documents asked for: stale entries fall out) and the worker's fonts become
// the new cache, and the page is built again with it. A block that fails to
// compile fails the build (non-zero exit, listed). --no-seed-cache: no
// precompiling, nothing baked in. --engine=node: the page's compile worker runs
// in a Node thread instead (scripts/node-engine.ts; the same bundle, results
// byte-identical: tests/test-node-engine.ts); the app stays in the page.
let failed = false;
const seedNames = Object.keys(seedFiles);
// --accept=<file>: only the acceptance checks, on a file already built (seed ids from build/seed/)
const acceptOnly = [...args].find((a) => a.startsWith('--accept='))?.slice(9);
if (acceptOnly) {
  out = acceptOnly;
  const problems = await acceptance(true);
  for (const p of problems) console.error(`  ${p}`);
  console.log(`acceptance of ${out}: ${problems.length ? `${problems.length} problem(s)` : 'passed'}`);
  process.exit(problems.length ? 1 : 0);
}
if (!seedNames.length) emit(null, 'no seed documents');
else if (args.has('--no-seed-cache')) { out = join(DIST, 'reflowtex-editor-unbaked.html'); emit(null, 'NOT BAKED IN (--no-seed-cache): the default documents compile on first open'); console.log('seed cache: NOT BAKED IN (--no-seed-cache)'); }
else {
  const { cache: old, dropped } = loadSeedCache();
  const oldN = Object.keys(old?.results ?? {}).length;
  const ENGINE_WHERE = [...args].find((a) => a.startsWith('--engine='))?.slice(9) ?? 'browser';
  console.log(`seed cache: ${oldN} recorded results match engine ${worker.build}${dropped ? `, ${dropped} for other builds dropped` : ''}; `
    + `typesetting the default documents (worker in ${ENGINE_WHERE === 'node' ? 'Node' : 'Chromium'})…`);
  const { chromium } = req('playwright');
  const packBytes = ENGINE_WHERE === 'node' ? new Uint8Array(packGz) : null;
  const t1 = performance.now();
  // what this build's documents asked for (the new cache), and the fonts as the last page left them
  const fresh: Record<string, any> = {};
  // fonts in the seed only with --seed-fonts: the worker's dumpFonts() lists served fonts
  // whose files it no longer has, and a seed with
  // them leaves those fonts with no bytes anywhere (every such font fails from file://).
  // Without them the worker patches the fonts from the results' fontReqs on open (no TeX).
  const SEED_FONTS = args.has('--seed-fonts');
  let fonts: any = SEED_FONTS ? old?.fonts ?? null : null;
  const seedGz = () => {
    const c: SeedCache = { build: worker.build, recorded: new Date().toISOString(), docs: seedNames, results: { ...(old?.results ?? {}), ...fresh }, ...(fonts ? { fonts } : {}) };
    return gzipSync(Buffer.from(JSON.stringify(c)), { level: 9 });
  };
  const save = () => writeFileSync(seedCachePath, seedGz());
  const perDoc: Record<string, any> = {};
  const bad: string[] = [], pageErrors: string[] = [];
  let compiledAll = 0;
  // One page per document (a page holds the engine's ~0.9 GB; the host is shared),
  // built with everything recorded so far; results checkpointed every minute,
  // so a crashed page loses at most a minute and the next build goes on from there.
  for (const n of seedNames) {
    const id = JSON.parse(seedFiles[n]).id as string;
    emit(seedGz(), `precompiling ${n}`);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ offline: true, viewport: { width: 1200, height: 900 } });
    await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    let crashed = false;
    page.on('pageerror', (e: Error) => { pageErrors.push(`${n}: ${e.message}`); console.log('  pageerror', e.message); });
    page.on('crash', () => { crashed = true; pageErrors.push(`${n}: the page crashed (out of memory?)`); });
    const eng = packBytes ? await (await import('./node-engine.ts')).attachNodeEngine(page, { workerJs, packBytes }) : null;
    const t = performance.now();
    const dump = async () => {
      const d = await page.evaluate(async () => {
        const bes = (globalThis as any).__rtxEditor.backends;
        const results: Record<string, any> = {};
        for (const be of bes) Object.assign(results, be.dump());
        const f = bes[0]?.dumpFonts ? await bes[0].dumpFonts() : null;
        const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
        if (f?.files) for (const k of Object.keys(f.files)) f.files[k] = b64(f.files[k]);
        return { results, fonts: f, stats: bes.map((b: any) => b.stats()) };
      });
      for (const [k, v] of Object.entries(d.results)) if (!(v as any).transient) fresh[k] = v;
      if (d.fonts && SEED_FONTS) fonts = d.fonts;
      save();
      return d;
    };
    try {
      await page.goto('file://' + out);
      await page.waitForFunction(() => (window as any).editorAPI, null, { timeout: 300000 });
      await page.evaluate((id: string) => {
        const api = (window as any).editorAPI;
        const bes = (globalThis as any).__rtxEditor?.backends ?? [];
        (window as any).__w1cDone = (async () => {
          const before = bes.map((b: any) => b.stats().compiled);
          await api.open(id);
          await api.whenIdle();
          const bs = api.blocks();
          return { title: api.currentDoc?.()?.title ?? null, n: bs.length,
            states: bs.reduce((m: Record<string, number>, b: any) => ({ ...m, [b.state]: (m[b.state] ?? 0) + 1 }), {}),
            errors: bs.filter((b: any) => b.errors?.length).map((b: any) => `${b.id} (${b.kind}): ${b.errors[0]?.message}`),
            compiled: bes.map((b: any, i: number) => b.stats().compiled - before[i]).reduce((a: number, b: number) => a + b, 0) };
        })();
      }, id);
      let st: any = null;
      while (!st) {
        // the document typeset, or a minute gone: then a checkpoint
        st = await page.evaluate(() => Promise.race([(window as any).__w1cDone.then((r: any) => r), new Promise((r) => setTimeout(() => r(null), 60000))]));
        const d = await dump();
        if (!st) console.log(`  ${n}: ${Object.keys(fresh).length} results so far (${JSON.stringify(d.stats[0])}), ${((performance.now() - t) / 1000).toFixed(0)} s`);
      }
      perDoc[n] = { id, s: +((performance.now() - t) / 1000).toFixed(1), ...st, engine: eng?.stats() ?? 'chromium' };
      compiledAll += st.compiled;
      console.log(`  ${n} "${st.title}": ${st.n} blocks ${JSON.stringify(st.states)}; compiled ${st.compiled}, ${perDoc[n].s} s`);
      for (const e of st.errors) bad.push(`${n}: ${e}`);
    } catch (e) {
      perDoc[n] = { id, crashed, error: (e as Error).message.split('\n')[0] };
      pageErrors.push(`${n}: ${crashed ? 'the page crashed' : (e as Error).message.split('\n')[0]} (${Object.keys(fresh).length} results saved: the next build goes on from them)`);
    }
    await eng?.close();
    await browser.close();
  }
  // the new cache: what the documents asked for (stale entries fall out), unless a page died before finishing
  const complete = !pageErrors.some((e) => /crashed|Timeout|Target/.test(e));
  const results = complete ? fresh : { ...(old?.results ?? {}), ...fresh };
  const cache: SeedCache = { build: worker.build, recorded: new Date().toISOString(), docs: seedNames, results, ...(fonts ? { fonts } : {}) };
  const gzc = gzipSync(Buffer.from(JSON.stringify(cache)), { level: 9 });
  writeFileSync(seedCachePath, gzc);            // an errored block's result too (not transient ones): the build fails on it anyway
  const keys = Object.keys(results);
  const reused = keys.filter((k) => old?.results[k]).length;
  const secs = +((performance.now() - t1) / 1000).toFixed(1);
  const note = `${keys.length} results (${reused} reused, ${compiledAll} compiled) + ${Object.keys(fonts?.files ?? {}).length} fonts for ${seedNames.join(', ')}, engine ${worker.build}`;
  writeFileSync(join(BUILD, 'seed-cache-report.json'), JSON.stringify({ build: worker.build, date: new Date().toISOString(), engine: ENGINE_WHERE, seconds: secs, reused, compiled: compiledAll, results: keys.length,
    gzBytes: gzc.length, resultsGzBytes: gzipSync(Buffer.from(JSON.stringify(results)), { level: 9 }).length, docs: perDoc, failures: bad, pageErrors }, null, 1));
  console.log(`seed cache: ${note}; ${mb(gzc.length)} gz; precompiling took ${secs} s`);
  out = RELEASE;
  emit(gzc, note);
  if (bad.length || pageErrors.length) {
    failed = true;
    console.error(`\nBUILD FAILED: ${bad.length} default-document block(s) did not compile${pageErrors.length ? `, ${pageErrors.length} page problem(s)` : ''} (the file is written without them):`);
    const all = [...pageErrors, ...bad];
    for (const b of all.slice(0, 12)) console.error(`  ${b}`);
    if (all.length > 12) console.error(`  … and ${all.length - 12} more (all in engine/build/seed-cache-report.json)`);
    const why = new Map<string, number>();
    for (const b of bad) { const m = b.replace(/^[^:]+: \S+ \([^)]*\): /, '').replace(/\d+(\.\d+)?/g, 'N'); why.set(m, (why.get(m) ?? 0) + 1); }
    if (why.size) console.error('  by message:');
    for (const [m, k] of why) console.error(`    ${k} × ${m}`);
  }
}
// ── Acceptance: the built file from file://, offline, fonts (blocking) ────────
// Both default documents opened in a fresh Chromium: 0 compiles when baked in,
// no failed font load (document.fonts loadingerror, requests to fonts/), no
// "Some fonts could not be downloaded" notice, and every font family the
// mounted blocks use draws its own glyphs (a canvas width test: the text
// measures the same with a serif and a monospace fallback behind the family,
// and draws some ink: any at all, as cmsy10's centred dot covers 14 pixels at
// 40 px); maths fonts and a typewriter font must be among them. A failure
// renames the file to reflowtex-editor.broken.html and exits 1. --no-verify skips it.
/** After a click on a late section in the outline, the page settles and then holds still:
 *  scrollY sampled every frame for 2 s once the glide ends varies by at most 1 px. */
async function outlineStillCheck(page: any, id: string | undefined): Promise<string[]> {
  if (!id) return [];
  const r = await page.evaluate(async (id: string) => {
    const api = (window as any).editorAPI;
    if (api.route()?.id !== id) { await api.open(id); await api.whenIdle(); }
    const items = [...document.querySelectorAll('#panel-outline .ol-item.lv1:not(.special)')] as HTMLElement[];
    const it = items[Math.max(0, items.length - 2)];
    const link = it?.querySelector('.ol-link') as HTMLElement | null;
    if (!link) return { found: false };
    const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
    const scroller = (document.querySelector('main.rtx-pane[data-part="page"]') as HTMLElement | null) ?? document.scrollingElement!;   // the pane scrolls
    link.click();
    // the glide: until scrollY has not moved for 30 frames (at most 20 s)
    let last = -1, still = 0;
    const t0 = performance.now();
    while (still < 30 && performance.now() - t0 < 20000) { await frame(); const y = scroller.scrollTop; still = Math.abs(y - last) < 0.5 ? still + 1 : 0; last = y; }
    const settledMs = Math.round(performance.now() - t0);
    const ys: number[] = [];
    const t1 = performance.now();
    while (performance.now() - t1 < 2000) { await frame(); ys.push(scroller.scrollTop); }
    return { found: true, title: it.textContent?.slice(0, 40), settledMs, min: Math.min(...ys), max: Math.max(...ys), frames: ys.length };
  }, id);
  console.log(`  acceptance outline: ${JSON.stringify(r)}`);
  if (!r.found) return ['outline: no late section to click'];
  if (r.settledMs >= 20000) return [`outline: the page did not settle within 20 s of the click (${r.title})`];
  if (!(r.min > 0)) return [`outline: the click did not move the page (${r.title})`];
  return r.max - r.min <= 1 ? [] : [`outline: after the glide the page still moves (${(r.max - r.min).toFixed(1)} px over 2 s, ${r.title})`];
}

/** anchor test on this file, Chromium, reduced motion and with motion (subprocesses; exit code). */
function anchorTests(file: string): string[] {
  const out: string[] = [];
  for (const motion of [false, true]) {
    try { execFileSync(process.execPath, [join(HERE, 'tests/test-w11-anchor.ts'), '--html', file, '--browser', 'chromium', ...(motion ? ['--motion', '--label', 'release-motion'] : ['--label', 'release'])], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 1200000 }); console.log(`  acceptance W11 anchor${motion ? ' (motion)' : ''}: pass`); }
    catch (e) { const t = String((e as any).stdout ?? ''); const f = t.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 3).join(' | ') || (e as Error).message.split('\n')[0]; out.push(`W11 anchor${motion ? ' (motion)' : ''}: ${f}`); }
  }
  return out;
}

// margin protrusion: tests/test-protrusion.ts compared a sample paper with its whole-paper PDF; no
// release document loads microtype now, so the release no longer runs it (engine/tests/protrusion.test.ts checks the codes)
/** Live edit in the file: a paragraph of the first default document in edit mode;
 *  type a word → the preview shows it; delete it → the preview is the original again (0–1
 *  compiles); delete the paragraph's last word (never typed) → the preview updates after its compile. */
async function liveEditCheck(page: any, id: string | undefined): Promise<string[]> {
  if (!id) return ['live edit: no default document'];
  const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.blk.editing .blk-render > .latex-block:not(.incoming) svg tspan')].map((t) => t.textContent).join(''));
  const compiled = (bid: string) => page.evaluate((bid: string) => (window as any).editorAPI.counters().compiledIds.filter((x: string) => x === bid).length, bid);
  const blk = await page.evaluate(async (id: string) => {
    const api = (window as any).editorAPI;
    if (api.route()?.id !== id) { await api.open(id); await api.whenIdle(); }
    const b = api.blocks().find((b: any) => b.kind === 'paragraph' && b.mounted && !b.parentId && b.source.length > 200 && b.source.length < 1500
      && /\s([A-Za-z]{4,})\.\s*$/.test(b.source) && !/[%$\\]/.test(b.source.slice(-40)));
    if (!b) return null;
    document.querySelector(`.blk[data-id="${b.id}"]`)?.scrollIntoView();
    api.resetCounters();
    api.edit(b.id, b.source.replace(/\s+$/, '').length);
    await api.whenIdle();
    return { id: b.id, source: b.source, last: /\s([A-Za-z]{4,})\.\s*$/.exec(b.source)![1] };
  }, id);
  if (!blk) return ['live edit: no suitable paragraph in the default document'];
  await page.waitForFunction(() => document.querySelector('.blk.editing .blk-render > .latex-block svg tspan'), null, { timeout: 60000 });
  const orig = await shown();
  const word = ' Zyxwvq';
  await page.keyboard.type(word, { delay: 60 });
  await idle();
  const typed = await shown(), c1 = await compiled(blk.id);
  // at typing speed but in one burst: the app coalesces them into at most one compile
  for (let i = 0; i < word.length; i++) await page.keyboard.press('Backspace');
  await idle();
  // the preview may land after idle (a mount): wait for it, up to 20 s, then take what is shown
  await page.waitForFunction((o: string) => [...document.querySelectorAll('.blk.editing .blk-render > .latex-block:not(.incoming) svg tspan')].map((t) => t.textContent).join('') === o, orig, { timeout: 20000 }).catch(() => null);
  const back = await shown(), c2 = await compiled(blk.id) - c1;
  for (let i = 0; i < blk.last.length + 1; i++) await page.keyboard.press('Backspace', { delay: 40 });
  await idle();
  const cut = await shown(), c3 = await compiled(blk.id) - c1 - c2;
  const src = await page.evaluate((bid: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === bid).source, blk.id);
  await page.evaluate(() => (window as any).editorAPI.leave());
  const out: string[] = [];
  const r = { block: blk.id, word: blk.last, compiles: [c1, c2, c3], orig: orig.slice(-30), typed: typed.slice(-30), back: back.slice(-30), cut: cut.slice(-30) };
  console.log(`  acceptance live edit: ${JSON.stringify(r)}`);
  if (!orig) out.push('live edit: no preview shown in edit mode');
  if (!typed.includes('Zyxwvq') || c1 < 1) out.push(`live edit: the typed word does not appear in the preview (${c1} compiles)`);
  let at = 0; while (at < orig.length && orig[at] === back[at]) at++;
  if (back !== orig || c2 > 1) out.push(`live edit: after deleting the typed word the preview is not the original (${c2} compiles; first difference at ${at}/${orig.length}: ${JSON.stringify(orig.slice(at, at + 20))} vs ${JSON.stringify(back.slice(at, at + 20))})`);
  if (cut === orig || cut.includes(blk.last + '.') || c3 < 1 || src.trimEnd().endsWith(`${blk.last}.`))
    out.push(`live edit: deleting "${blk.last}." did not update the preview (${c3} compiles): …${cut.slice(-40)}`);
  return out;
}

/** p, or a rejection with `what` after ms (a page that hangs fails the check instead of the build hanging) */
function hangGuard<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_r, rej) => { t = setTimeout(() => rej(new Error(what)), ms); })]).finally(() => clearTimeout(t));
}

async function acceptance(baked: boolean): Promise<string[]> {
  const { chromium } = req('playwright');
  const problems: string[] = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ offline: true, viewport: { width: 1200, height: 900 } });
  const outside: string[] = [];
  await ctx.route('**/*', (r: any) => { const u = r.request().url(); if (/^(blob|data):/.test(u) || u === 'file://' + out) return r.continue(); outside.push(u); return r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => problems.push(`page error: ${e.message}`));
  page.on('crash', () => problems.push('the page crashed'));
  await page.addInitScript(() => { (window as any).__fontErr = []; document.fonts.addEventListener('loadingerror', (e: any) => (window as any).__fontErr.push(...e.fontfaces.map((f: any) => f.family))); });
  await page.goto('file://' + out);
  await page.waitForFunction(() => (window as any).editorAPI, null, { timeout: 300000 });
  // the licence: the author's notice first in the file, the preview pill on the home screen and in a
  // document's top bar, and About · Licence listing every npm package and every packed TeX file
  {
    const head = readFileSync(out, 'utf8').slice(0, 2000);
    if (!head.startsWith('<!--\n' + NOTICE)) problems.push('licence: the notice is not the first thing in the file');
    // the notice names the licence, the AGPL (the bundled reflowtex parts are under the same licence)
    if (!/GNU Affero General Public License/.test(NOTICE)) problems.push('licence: the notice does not name the AGPL');
    if (!head.includes('<meta name="license"') && !readFileSync(out, 'utf8').slice(0, 20000).includes('<meta name="license"')) problems.push('licence: no <meta name="license">');
    const want = { npm: LIC.npm.map((p) => p.name), tex: LIC.tex.map((t) => t.file), docs: LIC.documents.map((d) => d.source), lic: LIC.documents.map((d) => d.licence) };
    const r = await page.evaluate(async (want: { npm: string[]; tex: string[]; docs: string[]; lic: string[] }) => {
      const vis = (e: Element | null) => !!e && (e as HTMLElement).offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
      location.hash = '#/';
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const homePill = vis(document.querySelector('.home-foot .rtx-preview-pill'));
      (document.querySelector('.home-foot .rtx-preview-pill') as HTMLElement | null)?.click();
      const d = document.getElementById('rtx-about') as HTMLDialogElement | null;
      const opened = !!d?.open;
      const pillText = document.querySelector('.home-foot .rtx-preview-pill')?.textContent ?? '', aboutBuild = d?.querySelector('.rtx-about-build')?.textContent ?? '';
      const npm = new Set([...(d?.querySelectorAll('[data-list="npm"] li') ?? [])].map((li) => (li as HTMLElement).dataset.name));
      const tex = new Set([...(d?.querySelectorAll('[data-list="tex"] li') ?? [])].map((li) => (li as HTMLElement).dataset.name));
      const docs = want.docs.every((s) => d?.textContent?.includes(s)) && want.lic.every((s) => d?.textContent?.includes(s));
      d?.close();
      return { homePill, opened, pillText, aboutBuild, docs, npmMissing: want.npm.filter((n) => !npm.has(n)), texMissing: want.tex.filter((n) => !tex.has(n)), title: document.title };
    }, want);
    console.log(`  acceptance licence: home pill ${r.homePill}, About opens ${r.opened}, ${want.npm.length - r.npmMissing.length}/${want.npm.length} npm packages, ${want.tex.length - r.texMissing.length}/${want.tex.length} TeX files listed; title "${r.title}"`);
    if (!r.homePill) problems.push('licence: no preview pill on the home screen');
    // the version the UI shows is the release file's stamp
    { const [d0, t0] = BUILD_STAMP.split(' '); const [y, mo, d] = d0.split('-'); const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1];
      const fileStamp = basename(RELEASE).match(/(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
      const okV = !!fileStamp && `${fileStamp[1]} ${fileStamp[2]}:${fileStamp[3]}` === BUILD_STAMP && r.pillText === `Preview · ${Number(d)} ${MON} ${y} ${t0}` && r.aboutBuild.startsWith(`Build ${BUILD_STAMP}`);
      console.log(`  acceptance version: pill "${r.pillText}", About "${r.aboutBuild}", file ${basename(RELEASE)}`);
      if (!okV) problems.push(`version: the pill/About do not show the release stamp ${BUILD_STAMP}`); }
    if (!r.opened) problems.push('licence: the pill does not open About · Licence');
    if (!r.docs) problems.push('licence: About does not credit every default document with its licence');
    if (r.npmMissing.length || !want.npm.length) problems.push(`licence: npm packages missing from About: ${r.npmMissing.slice(0, 8).join(', ')}`);
    if (r.texMissing.length || !want.tex.length) problems.push(`licence: TeX files missing from About: ${r.texMissing.slice(0, 8).join(', ')}`);
  }
  const kinds = new Set<string>();
  for (const n of seedNames) {
    const id = JSON.parse(seedFiles[n]).id as string;
    const r: any = await hangGuard(page.evaluate(async (id: string) => {
      const api = (window as any).editorAPI;
      const bes = (globalThis as any).__rtxEditor?.backends ?? [];
      const before = bes.map((b: any) => b.stats().compiled);
      await api.open(id); await api.whenIdle();
      await document.fonts.ready;
      const compiled = bes.map((b: any, i: number) => b.stats().compiled - before[i]).reduce((a: number, b: number) => a + b, 0);
      const bs = api.blocks();
      const errors = bs.filter((b: any) => b.errors?.length).map((b: any) => `${b.id}: ${b.errors[0]?.message}`);
      const warn = [...document.querySelectorAll('div, p')].map((e) => e.textContent ?? '').find((t) => /could not be downloaded/.test(t) && t.length < 600) ?? null;
      // one sample of text per font family, over every block: the viewer draws a block
      // when it comes into view, so the document is scrolled through, block by block
      const sample = new Map<string, string>();
      // a picture the engine could not draw (assets.ts: its file name in a frame, in a generic family): every one
      const placeholders: { block: string | null; s: string }[] = [];
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      for (const blk of [...document.querySelectorAll('main.rtx-pane[data-part="page"] .blk')] as HTMLElement[]) {
        blk.scrollIntoView({ block: 'center' });
        await frame();
        for (const t of blk.querySelectorAll('.latex-block text, .latex-block tspan')) {
          if (t.querySelector('tspan')) continue;
          const fam = (t.getAttribute('font-family') ?? (t.parentElement?.getAttribute('font-family') ?? '')).replace(/["']/g, '').split(',')[0].trim();
          const s = (t.textContent ?? '').replace(/\s+/g, '');     // TeX draws no spaces: a subset font has none
          if (fam && s && /^(serif|sans-serif|monospace|system-ui)$/.test(fam)) placeholders.push({ block: blk.dataset.id ?? null, s: s.slice(0, 40) });
          if (fam && s && (!sample.has(fam) || s.length > sample.get(fam)!.length && s.length < 12)) sample.set(fam, s.slice(0, 12));
        }
      }
      await api.whenIdle();
      await document.fonts.ready;
      const cv = document.createElement('canvas'); cv.width = 400; cv.height = 80; const cx = cv.getContext('2d')!;
      const faces = [...document.fonts];
      const fams = [];
      for (const [fam, s] of sample) {
        const face = faces.find((f: any) => f.family.replace(/["']/g, '') === fam);
        if (face && face.status !== 'loaded') await face.load().catch(() => null);
        cx.font = `40px "${fam}", serif`; const w1 = cx.measureText(s).width;
        cx.font = `40px "${fam}", monospace`; const w2 = cx.measureText(s).width;
        cx.clearRect(0, 0, 400, 80); cx.fillText(s, 5, 60);
        const px = cx.getImageData(0, 0, 400, 80).data; let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) ink++;
        fams.push({ fam, s, status: face?.status ?? 'none', own: Math.abs(w1 - w2) < 0.01, ink });
      }
      const pill = document.querySelector('.rtx-wb .rtx-preview-pill[data-about]') as HTMLElement | null;   // the side status's
      const docPill = !!pill && pill.offsetParent !== null && getComputedStyle(pill).visibility !== 'hidden';
      return { docPill, compiled, errors, warn, fams, placeholders, fontErr: [...new Set((window as any).__fontErr as string[])], n: bs.length };
    }, id), 600000, `acceptance: ${n} did not settle in 10 min`).catch((e: Error) => ({ hung: e.message }));
    if (r.hung) { problems.push(r.hung); continue; }
    if (!r.docPill) problems.push(`${n}: no preview pill beside the document`);
    // a picture drawn as a placeholder (the engine could not draw it: assets.ts) fails the build; any other text
    // in a generic family is said
    for (const p of r.placeholders ?? []) problems.push(`${n}: a picture drawn as a placeholder "${p.s}" (block ${p.block})`);
    for (const f of r.fams.filter((f: any) => /^(serif|sans-serif|monospace|system-ui)$/.test(f.fam))) console.log(`  acceptance ${n}: text in a generic family "${f.s}" (${f.fam})`);
    const bad = r.fams.filter((f: any) => !/^(serif|sans-serif|monospace|system-ui)$/.test(f.fam) && (f.status !== 'loaded' || !f.own || f.ink === 0));
    console.log(`  acceptance ${n}: ${r.fams.length} font families, ${bad.length} not drawn by their own font; compiled ${r.compiled}; ${r.errors.length} block errors`);
    if (baked && r.compiled) problems.push(`${n}: ${r.compiled} blocks compiled on open (not baked in)`);
    for (const e of r.errors) problems.push(`${n}: block error ${e.slice(0, 200)}`);
    if (r.warn) problems.push(`${n}: the viewer's notice: ${r.warn.slice(0, 200)}`);
    if (r.fontErr.length) problems.push(`${n}: ${r.fontErr.length} fonts failed to load: ${r.fontErr.slice(0, 6).join(', ')}`);
    for (const f of bad) problems.push(`${n}: font ${f.fam} (${f.status}) does not draw "${f.s}" (${!f.own ? 'a fallback font draws it' : 'no ink'})`);
    for (const f of r.fams) {
      if (/^(cm(mi|sy|ex)|msam|msbm|rsfs|eufm|lmmi|lmsy|lmex)/i.test(f.fam)) kinds.add('maths');
      if (/tt|mono|inconsolata|courier/i.test(f.fam)) kinds.add('typewriter');
    }
  }
  for (const k of ['maths', 'typewriter']) if (!kinds.has(k)) problems.push(`no ${k} text found in the documents to check`);
  // the introduction (every release carries it): there, opens, no block error, every picture drawn from its bytes
  {
    const { introCheck, introProblems } = await import('../tests/qa/lib/intro-check.ts');
    const r = await hangGuard(introCheck(page), 600000, 'intro: did not settle in 10 min').catch((e: Error) => null);
    console.log(`  acceptance intro: ${r ? `${r.n} blocks, ${r.errors.length} errors, ${r.pictures.filter((p) => p.drawn && !p.frame).length}/${r.pictures.length} pictures drawn, ${r.compiled} compiled` : 'did not settle'}`);
    problems.push(...(r ? introProblems(r, { baked }) : ['intro: did not settle in 10 min']));
  }
  problems.push(...await hangGuard(outlineStillCheck(page, JSON.parse(seedFiles[seedNames[0]] ?? 'null')?.id), 120000, 'outline: did not settle in 2 min').catch((e: Error) => [e.message]));
  problems.push(...await hangGuard(liveEditCheck(page, JSON.parse(seedFiles[seedNames[0]] ?? 'null')?.id), 300000, 'live edit: did not settle in 5 min').catch((e: Error) => [e.message]));
  
  // the editor's colour maps (view/index.js EDITOR_COLOURS) are in force after load: the viewer
  // replaced maps set before its first block; dark mode keeps the LIPIcs yellow readable
  {
    const cm = await page.evaluate(() => (window as any).reflowtex?.host?.colorMaps?.() ?? null);
    const dark = cm?.editor?.colors?.dark ?? null;
    console.log(`  acceptance colour maps: ${cm ? Object.keys(cm).join(', ') : 'none'}; dark #fcc712 → ${dark?.['#fcc712'] ?? '-'}`);
    if (!dark || !dark['#000000'] || !dark['#fcc712']) problems.push(`colour maps: the editor's map is not in force after load (${JSON.stringify(cm).slice(0, 200)})`);
  }
  if (outside.length) problems.push(`${outside.length} requests left the page: ${outside.slice(0, 3).join(' ')}`);
  console.log(`  acceptance: fonts seen: ${[...kinds].join(', ')}`);
  await browser.close();
  if (!args.has('--no-anchor')) problems.push(...anchorTests(out));
  return problems;
}
if (out === RELEASE) {
  const t2 = performance.now();
  const problems = args.has('--no-verify') ? [] : await acceptance(true);
  if (args.has('--no-verify')) console.log('acceptance: SKIPPED (--no-verify)');
  else console.log(`acceptance (file://, offline: fonts, errors, live edit): ${problems.length ? `${problems.length} problem(s)` : 'passed'} in ${((performance.now() - t2) / 1000).toFixed(0)} s`);
  // (multi-file) the same release served over http from a subdirectory, as on a static server (tests/test-multifile.ts, Chromium)
  if (MULTI && !args.has('--no-verify') && !problems.length && !failed) {
    try { execFileSync(process.execPath, [join(HERE, 'tests/test-multifile.ts'), '--dir', multiDirOf(RELEASE), '--browsers', 'chromium'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 1200000 }); console.log('  acceptance multi-file (http, a subdirectory, Chromium): pass'); }
    catch (e) { const t = String((e as any).stdout ?? ''); problems.push(`multi-file: ${t.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 3).join(' | ') || (e as Error).message.split('\n')[0]}`); }
  }
  if (problems.length) for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
  if (failed || problems.length) {
    failed = true;
    const broken = RELEASE.replace(/\.html$/, '.broken.html');
    renameSync(RELEASE, broken); renameSync(jsonOf(RELEASE), jsonOf(broken));
    if (existsSync(multiDirOf(RELEASE))) renameSync(multiDirOf(RELEASE), multiDirOf(broken));
    console.error(`\nBUILD FAILED: ${broken} (not the latest; ${LATEST} unchanged)`);
  } else if (!args.has('--no-verify')) {
    writeFileSync(LATEST, readFileSync(RELEASE)); writeFileSync(jsonOf(LATEST), readFileSync(jsonOf(RELEASE)));
    if (MULTI) { rmSync(multiDirOf(LATEST), { recursive: true, force: true }); cpSync(multiDirOf(RELEASE), multiDirOf(LATEST), { recursive: true }); }
    console.log(`RELEASE ${RELEASE} (${mb(statSync(RELEASE).size)}, engine ${worker.build}) → ${LATEST}${MULTI ? `; the multi-file release ${multiDirOf(LATEST)}/` : ''}`);
    // Firefox and WebKit, as a smoke test of the release (reported, not blocking): tests/test-build.ts
    if (!args.has('--no-smoke')) {
      try { execFileSync(process.execPath, [join(HERE, 'tests/test-build.ts'), '--firefox', '--webkit'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 1800000 }); console.log('smoke (Firefox, WebKit): ALL PASS'); }
      catch (e) { const t = String((e as any).stdout ?? ''); console.log(`smoke (Firefox, WebKit): ${t.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 6).join(' | ') || (e as Error).message.split('\n')[0]}`); }
      if (MULTI) {
        try { execFileSync(process.execPath, [join(HERE, 'tests/test-multifile.ts'), '--dir', multiDirOf(LATEST), '--browsers', 'firefox,webkit'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 1800000 }); console.log('smoke multi-file (Firefox, WebKit): ALL PASS'); }
        catch (e) { const t = String((e as any).stdout ?? ''); console.log(`smoke multi-file (Firefox, WebKit): ${t.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 6).join(' | ') || (e as Error).message.split('\n')[0]}`); }
      }
    }
  } else console.log(`release ${RELEASE} (not checked: not the latest)`);
}
process.exit(failed ? 1 : 0);
