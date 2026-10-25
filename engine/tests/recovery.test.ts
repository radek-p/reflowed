// How the engine fails, and that each failure has a defined recovery:
// web/backend.js + dist/editor-worker.js in Chromium, on the integrated dev
// server (integration/serve.ts, started here on a free port).
//
//   node engine/tests/recovery.test.ts [--url http://localhost:8160]
//
// Each case is a fresh backend on its own cache; every wait is on a promise
// the backend returns (no fixed times). Cases:
//   1. an engine abort in a block (worker.ts recovers: a new engine, the block again)
//   2. two aborts in a row: that block's error only, the next block compiles
//   3. the worker dies (an uncaught error outside its queue): terminated, restarted, the block again
//   4. an endless loop: the block's error after the timeout, the engine restarted, the next block fine
//   5. a PDF export that never ends: its error, and the next compile does not wait behind it
//   6. the worker script missing: the compile fails with why, and again (no hang)
//   7. the bundle server missing: the compile fails naming the file
//   8. a damaged pack (the single file): the failure is kept, later calls fail at once, no restart loop
//   9. an incomplete pack: names what is missing
//  10. a damaged cached result: a miss (the block compiles), and the record is deleted
//  11. damaged seed fonts: dropped with a warning; blocks compile and their fonts are made
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = join(ENGINE, '..');
const req = createRequire(join(ENGINE, 'package.json'));
const { chromium } = req('playwright');
const esbuild = req('esbuild');
const argv = process.argv.slice(2);
const urlArg = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null;

let fail = 0, pass = 0;
const check = (what: string, ok: boolean, detail: unknown = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  ${d.slice(0, 600)}`}`);
  if (ok) pass++; else fail++;
};

// ── the page: backend.js bundled, served next to the app ─────────────────────
const LIB = join(EDITOR, 'app/lib/test-recovery');
mkdirSync(LIB, { recursive: true });
writeFileSync(join(LIB, 'entry.js'), `import { createBackend } from '../../../engine/web/backend.js';\nwindow.createBackend = createBackend;\nwindow.recoveryReady = true;\n`);
await esbuild.build({ entryPoints: [join(LIB, 'entry.js')], bundle: true, format: 'iife', target: 'es2022', outfile: join(LIB, 'recovery.js'), logLevel: 'warning',
  define: { 'import.meta.url': '"http://localhost/lib/test-recovery/recovery.js"' } });
writeFileSync(join(LIB, 'index.html'), '<!doctype html><meta charset="utf-8"><title>recovery</title><body><script src="recovery.js"></script>');

let server: ChildProcess | null = null;
let BASE = urlArg?.replace(/\/$/, '') ?? '';
if (!BASE) {
  // a free port (the system's pick, let go): a pid-derived one met other runs' servers
  const port = await new Promise<number>((r, j) => { const s = createServer().once('error', j); s.listen(0, () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
  server = spawn(process.execPath, [join(EDITOR, 'tests/integration/serve.ts'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  BASE = `http://localhost:${port}`;
  // up when it answers (the server prints nothing we can rely on)
  for (let i = 0; ; i++) {
    try { const r = await fetch(`${BASE}/bundle/info`); await r.arrayBuffer(); if (r.ok) break; } catch { /* not yet */ }
    if (i > 600) throw new Error('the dev server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const warnings: string[] = [];
page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'warn') warnings.push(m.text()); });
page.setDefaultTimeout(300000);
await page.goto(`${BASE}/lib/test-recovery/index.html`);
await page.waitForFunction(() => (window as any).recoveryReady);

/** runs f(ctx) in the page: ctx has mk(opts) (a backend on its own memory cache, the dev server's worker) */
const inPage = <T>(f: string, arg: unknown = null): Promise<T> => page.evaluate(`(async (arg) => {
  const W = '/dist/editor-worker.js', B = location.origin;
  const memCache = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, structuredClone(v)); }, delete: async (k) => { m.delete(k); } }; };
  const mk = (o = {}) => window.createBackend({ workerUrl: W, base: B, cache: memCache(), figures: false, ...o });
  const P = '\\\\documentclass{article}';
  const one = (be, id, source) => be.compile({ preamble: P, keep: [], blocks: [{ id, source }] }).then((r) => r.blocks[id]);
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, message: e.message, dead: !!e.dead, fatal: !!e.fatal }));
  const timed = async (p) => { const t = performance.now(); const r = await settle(p); return { ...r, ms: Math.round(performance.now() - t) }; };
  return (${f})({ mk, memCache, P, one, settle, timed, W, B }, arg);
})(${JSON.stringify(arg)})`);

// 1, 2. aborts inside a block
{
  const r: any = await inPage(`async ({ mk, one }) => {
    const be = mk();
    const warm = await one(be, 'w', 'Warm.');
    await be.simulateCrash(1);
    const a = await one(be, 'a', 'After one abort.');
    await be.simulateCrash(2);
    const c = await one(be, 'c', 'Aborts twice.');
    const d = await one(be, 'd', 'Still fine.');
    return { warm: warm.status, a: [a.status, a.timing?.recovered], c: [c.status, c.errors[0]?.message], d: d.status, mem: await be.memory() };
  }`);
  check('1. an engine abort in a block: a new engine, the block compiled again', r.warm === 'ok' && r.a[0] === 'ok' && r.a[1] === 1, r);
  check('2. two aborts in a row: that block says the engine crashed, the next block compiles', r.c[0] === 'error' && /engine crashed/.test(r.c[1] ?? '') && r.d === 'ok', r);
}

// 3. the worker dies
{
  const r: any = await inPage(`async ({ mk, one, timed }) => {
    const be = mk();
    await one(be, 'w', 'Warm.');
    await be.simulateCrash(1, 'death');
    const t = await timed(one(be, 'x', 'The worker dies under this block.'));
    const after = await one(be, 'y', 'And the next one.');
    return { t, status: t.v?.status, errors: t.v?.errors, after: after.status, stats: be.stats() };
  }`);
  check('3. the worker dies (uncaught error): a new worker, the block compiles', r.t.ok && r.status === 'ok' && r.after === 'ok' && r.stats.deaths === 1 && r.stats.restarts >= 1, r);
}

// 4. an endless loop in a block
{
  const r: any = await inPage(`async ({ mk, one, timed }) => {
    const be = mk({ timeoutMs: 4000 });
    await one(be, 'w', 'Warm.');
    const t = await timed(one(be, 'loop', '\\\\loop\\\\iftrue\\\\repeat'));
    const n = await timed(one(be, 'n', 'Next.'));
    return { status: t.v?.status, message: t.v?.errors?.[0]?.message, ms: t.ms, next: n.v?.status, nextMs: n.ms, stats: be.stats() };
  }`);
  check('4. an endless loop: its error after the timeout, the engine restarted, the next block compiles', r.status === 'error' && /no result after 4000 ms/.test(r.message ?? '') && r.ms < 60000 && r.next === 'ok' && r.stats.restarts >= 1, r);
}

// 5. a PDF export that never ends, then a compile
{
  const r: any = await inPage(`async ({ mk, one, timed, P }) => {
    const be = mk({ timeoutMs: 800 });           // the PDF's own limit is 10×: 8 s
    await one(be, 'w', 'Warm.');
    const pdf = await timed(be.pdf({ preamble: P, blocks: [{ id: 'l', source: '\\\\loop\\\\iftrue\\\\repeat' }] }));
    const r0 = be.stats().restarts;
    const n = await timed(one(be, 'n', 'After the stuck export.'));
    return { pdf: { ok: pdf.ok, message: pdf.message, ms: pdf.ms }, next: n.v?.status, nextMs: n.ms, restarted: be.stats().restarts - r0 };
  }`);
  check('5. a PDF export that never ends: its error; the next compile restarts the engine at once (no timeout)', !r.pdf.ok && /no answer after 8000 ms/.test(r.pdf.message ?? '') && r.next === 'ok' && r.restarted === 1, r);
}

// 6. the worker script missing
{
  const r: any = await inPage(`async ({ mk, one, timed }) => {
    const be = mk({ workerUrl: '/dist/no-such-worker.js' });
    const a = await timed(one(be, 'a', 'Hello.'));
    const b = await timed(one(be, 'b', 'Again.'));
    return { a, b };
  }`);
  check('6. the worker script missing: the compile fails saying the worker could not start, twice, no hang', !r.a.ok && /compile worker failed/.test(r.a.message) && !r.b.ok && /compile worker failed/.test(r.b.message), r);
}

// 7. the bundle server missing
{
  const r: any = await inPage(`async ({ mk, one, timed, B }) => {
    const be = mk({ base: B + '/no-such-server' });
    return await timed(one(be, 'a', 'Hello.'));
  }`);
  check('7. the engine\'s files missing on the server: the compile fails naming the file', !r.ok && /engine's files could not be loaded: .*\/bundle\/(info|index|pack) \(HTTP 404\)/.test(r.message), r);
}

// 8, 9. the single file's pack: damaged, incomplete
{
  const r: any = await inPage(`async ({ memCache, one, timed, W }) => {
    const gz = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const b64 = (u) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const header = new TextEncoder().encode(JSON.stringify([['texmf/x.tex', 0, 1]]));
    const raw = new Uint8Array(4 + header.length + 1); new DataView(raw.buffer).setUint32(0, header.length, true); raw.set(header, 4); raw[4 + header.length] = 65;
    const incomplete = b64(await gz(raw));
    let starts = 0;
    const sa = (pack) => ({ build: 'test', createWorker: () => { starts++; return new Worker(W); }, initArgs: () => ({ pack }) });
    const bad = window.createBackend({ standalone: sa('AAAA////'), cache: memCache(), figures: false });
    const a = await timed(one(bad, 'a', 'Hello.'));
    const b = await timed(one(bad, 'b', 'Again.'));
    const startsBad = starts;
    const inc = window.createBackend({ standalone: sa(incomplete), cache: memCache(), figures: false });
    const c = await timed(one(inc, 'c', 'Hello.'));
    return { a, b, startsBad, c };
  }`);
  check('8. a damaged pack: the compile fails saying so; later calls fail at once with it (one start, no loop)', !r.a.ok && /pack could not be read/.test(r.a.message) && !r.b.ok && r.b.message === r.a.message && r.b.fatal && r.startsBad === 1, r);
  check('9. an incomplete pack: the compile fails naming what is missing', !r.c.ok && /latex\.fmt, tectonic_wasm\.wasm missing from the pack/.test(r.c.message), r);
}

// 10. a damaged cached result
{
  const r: any = await inPage(`async ({ mk, memCache, one }) => {
    const cache = memCache();
    const be = mk({ cache });
    const first = await one(be, 'a', 'A paragraph that gets cached.');
    const key = be.keyFor({ id: 'a', source: 'A paragraph that gets cached.' });
    cache.m.set(key, { status: 'ok', nodelist: 42, errors: 'x' });      // as a partial write or an older shape could leave it
    const be2 = mk({ cache });                                            // a reload: nothing in memory
    const again = await one(be2, 'a', 'A paragraph that gets cached.');
    return { first: first.status, again: again.status, cached: again.cached, stats: be2.stats(), stored: typeof cache.m.get(key)?.nodelist };
  }`);
  check('10. a damaged cached result: treated as a miss (compiled again), counted, and replaced', r.first === 'ok' && r.again === 'ok' && r.cached === false && r.stats.corrupt === 1 && r.stats.compiled === 1 && r.stored === 'string', r);
}

// 11. damaged seed fonts
{
  const w0 = warnings.length;
  const r: any = await inPage(`async ({ mk, one }) => {
    const be = mk({ seed: { results: {}, fonts: { reqs: {}, served: {}, files: { 'broken.otf': '%%% not base64 %%%' } } } });
    const a = await one(be, 'a', 'Fonts are made from the result.');
    return { status: a.status, stats: be.stats(), faces: [...document.fonts].length };
  }`);
  const warned = warnings.slice(w0).some((w) => /seed fonts not used/.test(w));
  check('11. damaged seed fonts: dropped with a warning, the block compiles and its fonts are installed', r.status === 'ok' && r.stats.seedFontsDropped === 1 && warned, { ...r, warned });
}

await browser.close();
server?.kill();
console.log(`\nrecovery: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
