// The TeX resource server in the browser: the engine with ONLY the release's embedded set (its
// pack, with this checkout's format and wasm), and the TeX tree of the engine's release (scripts/fetch-engine.ts)
// served by a static server started here (tests/qa/lib/static-server.ts: CORS, a request log), or another one
// (--resources <url>).
// Chromium, the dev server (started here, or --url).
//
//   node tests/test-resources.ts [--url http://localhost:8196] [--file dist/reflowtex-editor.html] [--resources <url>]
//
// Cases:
//   1. a document needing packages the embedded set lacks typesets with the server on; each file is asked for once
//   2. a new worker (a reload) on the same browser: the files come from IndexedDB, the server is not asked
//   3. the server off (and nothing kept): the preamble's problem names the package, the embedded set and the server
//   4. no server set: the problem says the embedded set, as before
//   5. a package the server does not have: "not on the TeX resource server either"
//   6. the server set after a failure, without a reload: the failed block typesets
//   7. the numbers for a paper-like preamble: requests, bytes, time (printed)
import { createRequire } from 'node:module';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resultsDir } from './qa/lib/results.ts';
import { staticServer } from './qa/lib/static-server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(ROOT), 'resources');
mkdirSync(OUT, { recursive: true });
const req = createRequire(join(ROOT, 'engine/package.json'));
const { chromium } = req('playwright');
const esbuild = req('esbuild');
const { decompress: zstd } = req('fzstd');
const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);

let fail = 0, pass = 0;
const check = (what: string, ok: boolean, detail: unknown = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  ${d.slice(0, 800)}`}`);
  if (ok) pass++; else fail++;
};

// ── the embedded set: the release's pack (its texmf/ files), with this checkout's format and wasm ──
const FILE = arg('--file') ?? join(ROOT, 'dist/reflowtex-editor.html');
const html = readFileSync(FILE, 'utf8');
const pick = (id: string) => { const i = html.indexOf(`<script id="${id}"`); if (i < 0) throw new Error(`${id} not in ${FILE}`); const a = html.indexOf('>', i) + 1; return html.slice(a, html.indexOf('</script>', a)); };
const packed = new Uint8Array(Buffer.from(pick('rtx-pack'), 'base64'));
const raw = packed[0] === 0x28 && packed[1] === 0xb5 ? zstd(packed) : new Uint8Array(gunzipSync(packed));
const hlen = new DataView(raw.buffer, raw.byteOffset).getUint32(0, true);
const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hlen))) as [string, number, number][];
const entries: [string, Uint8Array][] = header.filter(([n]) => n.startsWith('texmf/')).map(([n, o, l]) => [n, raw.subarray(4 + hlen + o, 4 + hlen + o + l)]);
entries.push(['latex.fmt', readFileSync(join(ROOT, 'engine/api/formats/latex.fmt'))], ['tectonic_wasm.wasm', readFileSync(join(ROOT, 'engine/dist/async/tectonic_wasm.wasm'))]);
const embeddedNames = new Set(entries.map(([n]) => n.replace(/^texmf\//, '')));
function packOf(es: [string, Uint8Array][]): Buffer {
  let off = 0;
  const h = es.map(([n, b]) => { const r = [n, off, b.length]; off += b.length; return r; });
  const hb = Buffer.from(JSON.stringify(h));
  const len = Buffer.alloc(4); len.writeUInt32LE(hb.length);
  return gzipSync(Buffer.concat([len, hb, ...es.map(([, b]) => Buffer.from(b))]), { level: 1 });
}
const pack = packOf(entries);

// ── the resource server: the tree and the pack, CORS, a log of what was asked ──
const TREE = join(ROOT, 'build/resources/www/texlive');
// the tree, installed with the engine (scripts/fetch-engine.ts) when it is not there
if (!arg('--resources') && !existsSync(join(TREE, '2022/texmf-dist/ls-R'))) execFileSync(process.execPath, [join(ROOT, 'scripts/fetch-engine.ts')], { stdio: 'inherit' });
const WWW = join(OUT, 'www');
rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });
if (existsSync(TREE)) symlinkSync(TREE, join(WWW, 'texlive'));
writeFileSync(join(WWW, 'pack.gz'), pack);
const files = await staticServer({ root: WWW, cors: true });
const FILES = files.origin;
/** the paths the server was asked for (files.log.length = 0 starts afresh) */
const asked = () => files.log.map((r) => r.path);
const RES = arg('--resources') ?? `${FILES}/texlive/2022/`;
const OFF = 'http://127.0.0.1:9/texlive/2022/';          // nothing listens there

// ── the page: backend.js bundled, served by the dev server ──
const LIB = join(ROOT, 'app/lib/test-resources');
mkdirSync(LIB, { recursive: true });
writeFileSync(join(LIB, 'entry.js'), `import { createBackend } from '../../../engine/web/backend.js';\nimport { createResourceStore } from '../../../loading/cache.ts';\nwindow.createBackend = createBackend; window.createResourceStore = createResourceStore;\nwindow.resourcesReady = true;\n`);
await esbuild.build({ entryPoints: [join(LIB, 'entry.js')], bundle: true, format: 'iife', target: 'es2022', outfile: join(LIB, 'resources.js'), logLevel: 'warning',
  define: { 'import.meta.url': '"http://localhost/lib/test-resources/resources.js"' } });
writeFileSync(join(LIB, 'index.html'), '<!doctype html><meta charset="utf-8"><title>resources</title><body><script src="resources.js"></script>');

let server: ChildProcess | null = null;
let BASE = arg('--url')?.replace(/\/$/, '') ?? '';
if (!BASE) {
  const port = 20000 + (process.pid % 20000);
  server = spawn(process.execPath, [join(ROOT, 'tests/integration/serve.ts'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  BASE = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try { const r = await fetch(`${BASE}/lib/test-resources/index.html`); await r.arrayBuffer(); if (r.ok) break; } catch { /* not yet */ }
    if (i > 600) throw new Error('the dev server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(600000);
const pageErrors: string[] = [];
page.on('pageerror', (e: Error) => pageErrors.push(e.message));
await page.goto(`${BASE}/lib/test-resources/index.html`);
await page.waitForFunction(() => (window as any).resourcesReady);
await page.evaluate(async (u: string) => { (window as any).packBytes = new Uint8Array(await (await fetch(u)).arrayBuffer()); }, `${FILES}/pack.gz`);

/** f(ctx) in the page: mk(server, o) a backend on the embedded set only, with its own memory cache and resource store */
const inPage = <T>(f: string, a: unknown = null): Promise<T> => page.evaluate(`(async (arg) => {
  const W = '/dist/editor-worker.js';
  const memCache = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, structuredClone(v)); }, delete: async (k) => { m.delete(k); } }; };
  const sa = { build: 'test-resources', createWorker: () => new Worker(W), initArgs: () => ({ packBytes: window.packBytes.slice() }) };
  const mk = async (server, o = {}) => { const be = window.createBackend({ standalone: sa, cache: memCache(), figures: false, ...o }); await be.setResourceServer(server); return be; };
  const run = async (be, preamble, id, source) => { const r = await be.compile({ preamble, keep: [], blocks: [{ id, source }] }); return { status: r.blocks[id].status, errors: r.blocks[id].errors.map((e) => e.message), pre: (r.preamble?.errors ?? []).map((e) => e.message), stats: be.stats() }; };
  return (${f})({ mk, run, memCache, store: window.createResourceStore }, arg);
})(${JSON.stringify(a)})`);

// two packages of the tree (scheme-small) the embedded set lacks
const PRE = '\\documentclass{article}\n\\usepackage{fancyhdr}\n\\usepackage{ragged2e}\n\\pagestyle{fancy}';
const BLOCK = '\\begin{FlushLeft}A paragraph set ragged right.\\end{FlushLeft}';
check('the test\'s premise: fancyhdr and ragged2e are not embedded', !embeddedNames.has('fancyhdr.sty') && !embeddedNames.has('ragged2e.sty'));
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('test-res-1'); q.onsuccess = q.onerror = q.onblocked = () => r(null); }));

// 1. server on
files.log.length = 0;
const r1: any = await inPage(`async ({ mk, run, store }, { RES, PRE, BLOCK }) => {
  const be = await mk(RES, { resourceStore: store('test-res-1') });
  const t = performance.now();
  const a = await run(be, PRE, 'a', BLOCK);
  const ms = Math.round(performance.now() - t);
  const b = await run(be, PRE, 'b', BLOCK + ' Again.');
  return { a, b, ms, res: await be.resources() };
}`, { RES, PRE, BLOCK });
const fileReqs = asked().filter((u) => !u.endsWith('/ls-R'));
check('1. a document needing packages the embedded set lacks typesets with the server on', r1.a.status === 'ok' && r1.b.status === 'ok', r1);
if (!arg('--resources')) {
  check('1. the server was asked for ls-R once and for each file once', asked().filter((u) => u.endsWith('/ls-R')).length === 1 && new Set(fileReqs).size === fileReqs.length && fileReqs.some((u) => u.endsWith('/fancyhdr.sty')) && fileReqs.some((u) => u.endsWith('/ragged2e.sty')), asked());
}
check('1. the worker reports what it fetched; the page received the files', r1.res?.stats?.fetched > 0 && r1.a.stats.resourcesFetched === r1.res.stats.fetched, { res: r1.res, stats: r1.a.stats });
console.log(`     first compile: ${r1.ms} ms, ${r1.res?.stats?.requests} requests, ${Math.round((r1.res?.stats?.bytes ?? 0) / 1024)} KB, ${Math.round(r1.res?.stats?.ms ?? 0)} ms waiting for the server`);

// 2. a reload: a new worker on the same browser store
files.log.length = 0;
const r2: any = await inPage(`async ({ mk, run, store }, { RES, PRE, BLOCK }) => {
  const be = await mk(RES, { resourceStore: store('test-res-1') });
  const a = await run(be, PRE, 'a', BLOCK);
  return { a, res: await be.resources() };
}`, { RES, PRE, BLOCK });
check('2. a reload: the files come from this browser\'s store; no file is asked of the server', r2.a.status === 'ok' && (arg('--resources') ? r2.res.stats.fetched === 0 : asked().filter((u) => !u.endsWith('/ls-R')).length === 0), { r2, asked: asked() });

// 3. the server off, nothing kept
const r3: any = await inPage(`async ({ mk, run }, { OFF, PRE, BLOCK }) => {
  const be = await mk(OFF, { resourceStore: null });
  return run(be, PRE, 'a', BLOCK);
}`, { OFF, PRE, BLOCK });
const msg3 = [...r3.pre, ...r3.errors].join(' | ');
check('3. the server off: the problem names the package, the embedded set and the unreachable server', r3.status === 'error' && /the package fancyhdr is not in the editor's embedded TeX set, and the TeX resource server could not be reached/.test(msg3), msg3);

// 4. no server
const r4: any = await inPage(`async ({ mk, run }, { PRE, BLOCK }) => run(await mk('', { resourceStore: null }), PRE, 'a', BLOCK)`, { PRE, BLOCK });
const msg4 = [...r4.pre, ...r4.errors].join(' | ');
check('4. no server: the problem says the embedded set, as before', r4.status === 'error' && /the package fancyhdr is not in the editor's embedded TeX set(?!,)/.test(msg4) && !/server/.test(msg4), msg4);

// 5. a package nobody has
const r5: any = await inPage(`async ({ mk, run }, { RES }) => run(await mk(RES, { resourceStore: null }), '\\\\documentclass{article}\\n\\\\usepackage{nosuchpackage}', 'a', 'Hello.')`, { RES });
const msg5 = [...r5.pre, ...r5.errors].join(' | ');
check('5. a package the server lacks: "not on the TeX resource server either"', /the package nosuchpackage is not in the editor's embedded TeX set, and not on the TeX resource server either/.test(msg5), msg5);

// 6. the server set after a failure, without a reload
const r6: any = await inPage(`async ({ mk, run, store }, { RES, PRE, BLOCK }) => {
  const be = await mk('', { resourceStore: store('test-res-1') });
  const before = await run(be, PRE, 'a', BLOCK);
  const changed = await be.setResourceServer(RES);
  const after = await run(be, PRE, 'a', BLOCK);
  const same = await be.setResourceServer(RES);
  return { before: before.status, changed, after: after.status, same, errors: after.errors, pre: after.pre };
}`, { RES, PRE, BLOCK });
check('6. the server set after a failure, without a reload: the block typesets', r6.before === 'error' && r6.changed === true && r6.after === 'ok' && r6.same === false, r6);

// 7. a paper-like preamble: packages corpus papers load that the embedded set lacks and the tree (scheme-small) has
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('test-res-7'); q.onsuccess = q.onerror = q.onblocked = () => r(null); }));
files.log.length = 0;
const PAPER = ['\\documentclass{article}', '\\usepackage{amsmath,amssymb,amsthm}', '\\usepackage{hyperref}', '\\usepackage{cleveref}',
  '\\usepackage{fancyhdr}', '\\usepackage{ragged2e}', '\\usepackage{longtable}', '\\usepackage{euscript}', '\\usepackage{amscd}', '\\usepackage{epsfig}',
  '\\usepackage{times}', '\\usepackage{xfrac}', '\\usepackage{dcolumn}', '\\usepackage{hhline}', '\\usepackage{afterpage}'].join('\n');
const r7: any = await inPage(`async ({ mk, run, store }, { RES, PAPER }) => {
  const be = await mk(RES, { resourceStore: store('test-res-7') });
  const t = performance.now();
  const a = await run(be, PAPER, 'a', 'A paragraph with $\\\\sfrac{1}{2}$ and $\\\\EuScript{E}$.');
  return { a, ms: Math.round(performance.now() - t), res: await be.resources() };
}`, { RES, PAPER });
check('7. a paper-like preamble (11 packages the embedded set lacks) typesets', r7.a.status === 'ok', r7);
console.log(`     paper-like preamble: ${r7.res?.stats?.requests} requests (${r7.res?.stats?.fetched} files, ${Math.round((r7.res?.stats?.bytes ?? 0) / 1024)} KB), first compile ${r7.ms} ms, ${Math.round(r7.res?.stats?.ms ?? 0)} ms of it waiting for the server`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ r1, r2, r3, r4, r5, r6, r7, asked7: asked() }, null, 1));

// 8. the single file's situation: a file:// page (origin "null"), its worker a blob: script, a synchronous GET to the
// server (what http.ts does), and IndexedDB on the page (where the files are kept)
{
  const probe = join(OUT, 'file-probe.html');
  writeFileSync(probe, `<!doctype html><meta charset="utf-8"><script>
window.probe = (url) => new Promise((resolve) => {
  const src = 'onmessage = (e) => { try { const x = new XMLHttpRequest(); x.open("GET", e.data, false); x.responseType = "arraybuffer"; x.send(); postMessage({ status: x.status, bytes: x.response.byteLength, type: x.getResponseHeader("content-type") }); } catch (err) { postMessage({ error: String(err) }); } };';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = (e) => resolve(e.data);
  w.postMessage(url);
});
window.idb = () => new Promise((resolve) => { try { const r = indexedDB.open('probe', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => resolve(true); r.onerror = () => resolve(String(r.error)); } catch (e) { resolve(String(e)); } });
</script>`);
  const p2 = await browser.newPage();
  await p2.goto(`file://${probe}`);
  const got: any = await p2.evaluate((u: string) => (window as any).probe(u), `${RES}texmf-dist/ls-R`);
  const idb = await p2.evaluate(() => (window as any).idb());
  check('8. from a file:// page, a blob: worker reads the server synchronously (CORS), and IndexedDB works', got.status === 200 && got.bytes > 1000 && idb === true, { got, idb });
  await p2.close();
}

check('no page errors', pageErrors.length === 0, pageErrors);
await browser.close();
server?.kill();
await files.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
