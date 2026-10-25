// The integrated dev app: app with engine behind it,
// on one origin, so the dev app runs the same backend as the single file.
//   node tests/integration/serve.ts [port=8150] [--seed-cache]
// Open http://127.0.0.1:8150/?engine#/doc/intro
//
//   /bundle/info, /bundle/index, /bundle/<id>/file/<name>   the TeX bundle (engine/server/bundle.ts,
//        its disk cache shared by all checkouts, TECTONIC_CACHE to choose another: no network once cached)
//   /bundle/pack the embedded TeX set as one
//        pack, the release's TeX files (./tex-pack.ts): the worker's init takes it, so an open fetches the set in one
//        request, not file by file; sent compressed and cacheable like the format
//   /formats/latex.fmt                    engine-api's format (the one scripts/build.ts packs)
//   /tc/engine/dist/async/*.wasm   the editor engine (the page fetches both: engine/web/backend.js engineArgs)
// these two as a release's server would send them: compressed
//        (brotli when asked for, else gzip; Content-Encoding, made once per file version) and cacheable (an ETag of the
//        file's size and time, Cache-Control: no-cache: a reload revalidates and gets 304), not 24 MB with no-store
//   /tc/engine/tex/*               TeX files the bundle lacks (lipics-v2021 + logos; in /bundle/pack too)
//   /dist/editor-worker.js                engine/dist/editor-worker.js (backend.js's default
//        workerUrl is ../dist/editor-worker.js from lib/app.js)
//   /dev/seed-cache.json the release's seed cache, engine/build/seed-cache.json.gz
//        (scripts/build.ts records it), when its build id is the worker's; 404 with the reason otherwise. With it
//        the fixture cache (engine/build/fixture-cache.json.gz, tests/integration/fixture-cache.ts) while its key fits.
//        /dev/seed-cache-info says which. The page uses it with ?seedcache, or on every page of a server
//        started with --seed-cache (test-all's seeded dev server): the seed papers then open with 0 compiles,
//        as from the single file
//   /seed/intro.json   the default document from build/seed/ (scripts/seed.ts), the one a release
//        precompiles, when there; app/seed/'s copy (w3-build --assets) otherwise. (A copy gone stale opened a block
//        the seed cache did not have: dev-seed compiled 1.)
//   /texlive/2022/…   the TeX Live tree scripts/fetch-engine.ts installs (build/resources/www/texlive/), beside the
//        page as a release has it (app/src/settings/resources.ts: the default resource server); 404 while not installed
//   everything else                       app, index.html with the viewer schema
//        filled in (as scripts/build.ts does)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, constants as zc, gunzipSync, gzip, gzipSync } from 'node:zlib';
import { texPack } from './tex-pack.ts';
import { promisify } from 'node:util';

const EDITOR = join(dirname(fileURLToPath(import.meta.url)), '../..');   // the repository root
const TC = EDITOR;
const WEB = join(EDITOR, 'app');
const WWW = join(EDITOR, 'build/resources/www');   // the TeX tree's parent (scripts/fetch-engine.ts TREE)
// the bundle's disk cache: $TECTONIC_CACHE, else the workspace's shared one (engine/server/bundle.ts); its hits and
// misses go to this log
const { getFile, getIndexGz, getIndex, resolveTarUrl, logCacheTo, CACHE } = await import(join(TC, 'engine/server/bundle.ts'));
logCacheTo((line: string) => console.log(line));
const PORT = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 8150);
const SEEDED = process.argv.includes('--seed-cache');
// a worker older than the editor's TeX files typesets with the old packages, silently: say so at start
{ const { workerProblem } = await import(join(EDITOR, 'engine/scripts/worker-current.ts')); const p = workerProblem(); if (p) console.warn(`WARNING: ${p}`); }
const tarUrl: string = await resolveTarUrl();
const bundleId = tarUrl.split('/').pop()!.replace(/\.tar$/, '');
const index: Map<string, unknown> = await getIndex();
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.b64': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.pdf': 'application/pdf',
};
const counts = { bundleFiles: 0, notFound: 0, seedCache: 0 };

// the dev seed cache: the release's recorded results, served only while their build id is the worker's
// (every key carries it: another build's results would never hit). Read again when either file changes.
const SEED_GZ = join(EDITOR, 'engine/build/seed-cache.json.gz'), WORKER = join(EDITOR, 'engine/dist/editor-worker.js');
type SeedInfo = { ok: boolean; build: string | null; worker: string | null; results: number; problem?: string;
  fixture: { ok: boolean; results: number; key: string | null; problem?: string } };
let seedMemo: { sig: string; gz: Buffer | null; info: SeedInfo } | null = null;
// and the fixture cache (tests/integration/fixture-cache.ts): the tests' fixture document's results,
// merged in only while its key is the fixture's and the worker's (dev and tests only; a release never has it)
const fx = await import('./fixture-cache.ts');
const FIXTURE_JS = join(EDITOR, 'app/src/app/test-fixture.js');
async function devSeed() {
  const [a, b, f, j] = await Promise.all([SEED_GZ, WORKER, fx.FIXTURE_CACHE, FIXTURE_JS].map((p) => stat(p).catch(() => null)));
  const sig = `${a?.mtimeMs}:${a?.size}:${b?.mtimeMs}:${f?.mtimeMs}:${f?.size}:${j?.mtimeMs}`;
  if (seedMemo?.sig === sig) return seedMemo;
  const worker = b ? (/build:"([0-9a-f]{10})"/.exec(await readFile(WORKER, 'utf8'))?.[1] ?? null) : null;
  let cache: any = null, build: string | null = null, results = 0, problem: string | undefined;
  if (!a) problem = `${SEED_GZ} is not recorded (node scripts/build.ts records it)`;
  else {
    try { cache = JSON.parse(gunzipSync(await readFile(SEED_GZ)).toString('utf8')); build = cache.build ?? null; results = Object.keys(cache.results ?? {}).length; } catch (e) { problem = `unreadable: ${e}`; }
    if (!problem && build !== worker) problem = `recorded for engine ${build}, the worker is ${worker}: rebuild the release (node scripts/build.ts) to record it again`;
  }
  const fs = await fx.fixtureCacheState();
  const fixture = { ok: fs.ok, results: fs.results, key: fs.key, ...(fs.problem ? { problem: fs.problem } : {}) };
  // what the page gets: the seed cache's results (when they fit) and the fixture's (when they fit)
  const served = { build: worker, docs: [...(problem ? [] : cache.docs ?? []), ...(fs.ok ? fx.FIXTURE_DOCS.map((d) => `fixture:${d}`) : [])],
    results: { ...(problem ? {} : cache.results ?? {}), ...(fs.ok ? fs.data!.results : {}) }, ...(!problem && cache.fonts ? { fonts: cache.fonts } : {}) };
  const gz = !problem || fs.ok ? gzipSync(Buffer.from(JSON.stringify(served))) : null;
  seedMemo = { sig, gz, info: { ok: !problem, build, worker, results, ...(problem ? { problem } : {}), fixture } };
  if (problem && SEEDED) console.warn(`WARNING: dev seed cache not used: ${problem}`);
  if (!fs.ok && SEEDED) console.warn(`WARNING: fixture cache not used: ${fs.problem}`);
  return seedMemo;
}
if (SEEDED) await devSeed();

// /reset (dev only, a URL to type): forgets everything this origin keeps after a confirmation, then opens the
// app afresh, as on a first visit. The same code as the app's own "Reset local data…" (the Documents
// view's footer, in the release too): app/src/store/wipe.js, imported from here.
const RESET_PAGE = `<!doctype html><meta charset="utf-8"><title>Reset local data</title>
<meta name="color-scheme" content="light dark">
<body style="font:15px/1.5 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px">
<h1 style="font-size:20px">Reset local data</h1>
<p>Forget every document, version and cached result this dev server's page keeps in this browser
(IndexedDB, local and session storage, caches). The app then opens as on a first visit.</p>
<p><button id="go" style="font:inherit;padding:6px 14px">Reset</button> <a href="/">Cancel</a></p>
<p id="out" role="status"></p>
<script type="module">
const out = document.getElementById('out');
import { wipeOrigin, announceReset } from '/src/store/wipe.js';
async function reset() {
  const r = await wipeOrigin({ onBlocked: () => { out.textContent = 'Waiting for the app’s other tabs: close them to finish.'; } });
  announceReset();
  return r.databases.length;
}
document.getElementById('go').onclick = async () => {
  out.textContent = 'Resetting…';
  const n = await reset();
  out.textContent = 'Done (' + n + ' databases). Opening the app…';
  document.title = 'Reset done';
  if (!new URLSearchParams(location.search).has('stay')) location.replace('/');
};
</script>`;

// the engine's big files compressed, once per version of the file (its size and time: the ETag)
const packed = new Map<string, Promise<Buffer>>();
const brotliP = promisify(brotliCompress), gzipP = promisify(gzip);
function compressed(file: string, etag: string, enc: 'br' | 'gzip'): Promise<Buffer> {
  const k = `${file}\0${etag}\0${enc}`;
  let p = packed.get(k);
  if (!p) {
    for (const old of packed.keys()) if (old.startsWith(`${file}\0`) && !old.startsWith(`${file}\0${etag}\0`)) packed.delete(old);
    p = readFile(file).then((b) => (enc === 'br' ? brotliP(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: b.length } }) : gzipP(b)));
    p.catch(() => packed.delete(k));
    packed.set(k, p);
  }
  return p;
}
const pack = texPack({ index, getFile, bundleId });
pack.built().then((b) => console.log(`/bundle/pack: ${b.files} TeX files, ${(b.raw.length / 1048576).toFixed(1)} MB`), (e) => console.warn(`/bundle/pack: ${e}`));
const ENGINE_FILE = /^\/formats\/latex\.fmt$|^\/tc\/engine\/dist\/async\/[^/]+\.wasm$/;

createServer(async (req, res) => {
  const send = (code: number, body: Buffer | string, type = 'application/octet-stream', extra: Record<string, string> = {}) => {
    const buf = typeof body === 'string' ? Buffer.from(body) : body;
    res.writeHead(code, { 'Content-Type': type, 'Content-Length': String(buf.length), 'Cache-Control': 'no-store', ...extra });
    res.end(req.method === 'HEAD' ? undefined : buf);
  };
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    let path = decodeURIComponent(url.pathname);
    // the page itself always with the engine (without ?engine the app would fall back to the v1 worker,
    // whose pack lacks the paper's files: "File `size11.clo' not found"); the #fragment survives the redirect
    if ((path === '/' || path === '/index.html') && !url.searchParams.has('engine')) {
      url.searchParams.set('engine', '');
      res.writeHead(302, { Location: `${path}?${url.searchParams.toString().replace(/engine=(&|$)/, 'engine$1')}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (path === '/bundle/info') return send(200, JSON.stringify({ id: bundleId, url: tarUrl, files: index.size }), 'application/json');
    if (path === '/bundle/index') return send(200, await getIndexGz(), 'text/plain; charset=utf-8', { 'Content-Encoding': 'gzip' });
    if (path === '/stats') return send(200, JSON.stringify(counts), 'application/json');
    if (path === '/reset') return send(200, RESET_PAGE, 'text/html; charset=utf-8');
    if (path === '/dev/seed-cache-info') return send(200, JSON.stringify({ ...(await devSeed()).info, seeded: SEEDED }), 'application/json');
    if (path === '/dev/seed-cache.json') {
      const d = await devSeed();
      if (!d.gz) return send(404, d.info.problem ?? 'no seed cache', 'text/plain');
      counts.seedCache++;
      return send(200, d.gz, 'application/json', { 'Content-Encoding': 'gzip' });
    }
    if (path === '/bundle/pack') return await pack.serve(req, res);
    const m = /^\/bundle\/([^/]+)\/file\/(.+)$/.exec(url.pathname);
    if (m) {
      const f = decodeURIComponent(m[1]) === bundleId ? await getFile(decodeURIComponent(m[2])) : null;
      if (!f) { counts.notFound++; return send(404, 'not in bundle'); }
      counts.bundleFiles++;
      return send(200, f.data);
    }
    let file: string;
    if (path === '/formats/latex.fmt') file = join(TC, 'engine/api/formats/latex.fmt');
    else if (path.startsWith('/tc/engine/dist/') || path.startsWith('/tc/engine/tex/')) file = normalize(join(TC, path.slice(3)));
    else if (path === '/dist/editor-worker.js') file = join(EDITOR, 'engine/dist/editor-worker.js');
    else if (path.startsWith('/texlive/')) {
      file = normalize(join(WWW, path));
      if (!file.startsWith(WWW + '/')) return send(403, 'no');
    }
    else if (path === '/seed/intro.json' && (await stat(join(EDITOR, 'build', path)).catch(() => null))?.isFile()) file = join(EDITOR, 'build', path);
    else {
      if (path.endsWith('/')) path += 'index.html';
      file = normalize(join(WEB, path));
      if (!file.startsWith(WEB)) return send(403, 'no');
    }
    if (!file.startsWith(TC)) return send(403, 'no');
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) return send(404, 'not found', 'text/plain');
    if (ENGINE_FILE.test(path)) {
      const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      const accepts = String(req.headers['accept-encoding'] ?? '');
      const enc = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
      const cacheable = { ETag: etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, cacheable); return res.end(); }
      if (!enc) return send(200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream', cacheable);
      return send(200, await compressed(file, etag, enc), TYPES[extname(file)] ?? 'application/octet-stream', { ...cacheable, 'Content-Encoding': enc });
    }
    let body: Buffer | string = await readFile(file);
    if (path === '/index.html' || path === '/two-editors.html') {   // the two-editors harness: the same page set-up
      const schema = await readFile(join(WEB, 'lib/viewer/schema.b64'), 'utf8').catch(() => '');
      body = body.toString('utf8').replace(/\{\{SCHEMA_B64\}\}/g, schema);
      // a seeded server: every page of the app starts from the seed cache (app/src/main.js reads this)
      if (SEEDED) body = body.replace('</head>', '<meta name="rtx-dev-seed-cache" content="/dev/seed-cache.json">\n</head>');
    }
    return send(200, typeof body === 'string' ? Buffer.from(body) : body, TYPES[extname(file)] ?? 'application/octet-stream');
  } catch (e) {
    return send(500, String(e), 'text/plain');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`editor (integration dev, engine${SEEDED ? ', seed cache' : ''}): http://127.0.0.1:${PORT}/?engine  bundle ${bundleId} (cache ${CACHE})`));
