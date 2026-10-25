// The TeX bundle's disk cache (engine/server/bundle.ts) through the dev server (tests/integration/serve.ts),
// against a fake CDN (a small made-up bundle: relay redirect, gzipped index, range reads) in this process:
//   1. a cold server fills the cache (chunks, their SHA-256, the tar's size, the index, the relay's redirect);
//   2. a second server with the CDN failing every request serves the same files from the cache alone;
//   3. a changed chunk, a truncated chunk without its hash (as an older cache has them) and a broken index are
//      found, fetched again and served right;
//   4. two cold servers on one empty cache at once: both serve right, no temp files left, every chunk checks out;
//   5. the default directory is the same from the main checkout and from a linked git checkout.
// Waits on the servers' answers and log lines, never on fixed times.
//
//   node tests/test-bundle-cache.ts          (the dev servers and the fake CDN on free ports)
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, truncateSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { freePort } from './qa/lib/free-port.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK = 4096;
const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}

// ── the fake bundle and CDN ──────────────────────────────────────────────────
const TAR_NAME = 'fake-2026.0r0.tar', ID = 'fake-2026.0r0';
const tar = randomBytes(10 * CHUNK + 1234);                       // 11 chunks, the last one short
const FILES: Record<string, { offset: number; length: number }> = {
  'small.tex': { offset: 100, length: 50 },                        // inside chunk 0
  'across.sty': { offset: 3 * CHUNK - 200, length: 2 * CHUNK },    // chunks 2, 3, 4
  'last.cls': { offset: 10 * CHUNK + 100, length: 900 },           // the last, short chunk
};
const indexGz = gzipSync(Buffer.from(Object.entries(FILES).map(([n, e]) => `${n} ${e.offset} ${e.length}`).join('\n') + '\n'));
const want = (n: string) => tar.subarray(FILES[n].offset, FILES[n].offset + FILES[n].length);
const cdn = { failing: false, ranges: [] as number[], requests: 0, index: 0, relay: 0 };
const cdnServer: Server = createServer((req, res) => {
  cdn.requests++;
  if (cdn.failing) { res.writeHead(503); return res.end('blocked'); }
  const base = `http://127.0.0.1:${(cdnServer.address() as AddressInfo).port}`;
  if (req.url === '/relay.tar') { cdn.relay++; res.writeHead(302, { Location: `${base}/${TAR_NAME}` }); return res.end(); }
  if (req.url === `/${TAR_NAME}.index.gz`) { cdn.index++; res.writeHead(200, { 'Content-Length': indexGz.length }); return res.end(indexGz); }
  if (req.url === `/${TAR_NAME}`) {
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    if (!m) { res.writeHead(416); return res.end(); }
    const a = Number(m[1]), b = Math.min(Number(m[2]), tar.length - 1);
    cdn.ranges.push(Math.floor(a / CHUNK));
    const body = tar.subarray(a, b + 1);
    res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${tar.length}`, 'Content-Length': body.length });
    return res.end(body);
  }
  res.writeHead(404); res.end();
});
await new Promise<void>((r) => cdnServer.listen(0, '127.0.0.1', () => r()));
const RELAY = `http://127.0.0.1:${(cdnServer.address() as AddressInfo).port}/relay.tar`;

// ── dev servers ──────────────────────────────────────────────────────────────
/** a port nothing listens on now (the OS picks it) */
interface Dev { proc: ChildProcess; port: number; log: string[] }
async function startServer(port: number, cache: string): Promise<Dev> {
  const proc = spawn(process.execPath, [join(ROOT, 'tests/integration/serve.ts'), String(port)], {
    cwd: ROOT, env: { ...process.env, TECTONIC_BUNDLE: RELAY, TECTONIC_CACHE: cache, TECTONIC_CHUNK: String(CHUNK) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const dev: Dev = { proc, port, log: [] };
  const take = (b: Buffer) => dev.log.push(...b.toString('utf8').split('\n').filter(Boolean));
  proc.stdout!.on('data', take); proc.stderr!.on('data', take);
  await new Promise<void>((res, rej) => {
    proc.on('exit', (c) => rej(new Error(`server ${port} exited (${c}): ${dev.log.join(' | ')}`)));
    const t = setInterval(() => { if (dev.log.some((l) => l.includes(`127.0.0.1:${port}/`))) { clearInterval(t); res(); } }, 50);
  });
  return dev;
}
async function stop(d: Dev) {
  if (d.proc.exitCode !== null) return;
  const gone = new Promise((r) => d.proc.once('exit', r));
  d.proc.kill();                                                    // our own child, by its handle
  await gone;
}
const get = async (d: Dev, name: string) => {
  const r = await fetch(`http://127.0.0.1:${d.port}/bundle/${ID}/file/${name}`);
  return { status: r.status, data: Buffer.from(await r.arrayBuffer()) };
};
const getAll = async (d: Dev) => Object.fromEntries(await Promise.all(Object.keys(FILES).map(async (n) => [n, await get(d, n)] as const)));
const allRight = (got: Record<string, { status: number; data: Buffer }>) => Object.keys(FILES).every((n) => got[n].status === 200 && got[n].data.equals(want(n)));
/** the summary line the cache logs after a quiet second */
const summary = (d: Dev) => new Promise<string>((res) => { const t = setInterval(() => { const l = d.log.filter((x) => /bundle cache: \d+ hits/.test(x)).pop(); if (l) { clearInterval(t); res(l); } }, 50); });
const chunkDir = (cache: string) => join(cache, TAR_NAME, 'chunks');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const tmpLeft = (cache: string) => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(join(d, e.name)); else if (e.name.endsWith('.tmp')) out.push(e.name); } };
  walk(cache);
  return out;
};
const allChunksCheck = (cache: string) => readdirSync(chunkDir(cache)).filter((f) => /^\d+-\d+$/.test(f)).every((f) => {
  const data = readFileSync(join(chunkDir(cache), f)), n = Number(f.split('-')[1]);
  return readFileSync(join(chunkDir(cache), `${f}.sha256`), 'utf8').trim() === sha(data) && data.equals(tar.subarray(n * CHUNK, (n + 1) * CHUNK));
});

const CACHE = mkdtempSync(join(tmpdir(), 'bundle-cache-'));
try {
  // 1. cold
  let s = await startServer(await freePort(), CACHE);
  const cold = await getAll(s);
  check('cold: every file served right', allRight(cold), Object.fromEntries(Object.entries(cold).map(([n, r]) => [n, [r.status, r.data.length]])));
  check('cold: the CDN asked once per chunk needed (0, 2, 3, 4, 10)', [...cdn.ranges].sort((a, b) => a - b).join() === '0,2,3,4,10', cdn.ranges);
  const files = readdirSync(chunkDir(CACHE)).sort();
  check('cold: chunks and their SHA-256 on disk, the tar\'s size, the index and the relay\'s redirect', files.length === 10 && allChunksCheck(CACHE)
    && readFileSync(join(CACHE, TAR_NAME, 'size.txt'), 'utf8').trim() === String(tar.length) && readFileSync(join(CACHE, TAR_NAME, 'index.gz')).equals(indexGz)
    && readdirSync(CACHE).some((f) => /^tar-url-relay\.tar\.txt$/.test(f)), files);
  check('cold: the log names each miss', s.log.filter((l) => /bundle cache: miss chunk/.test(l)).length === 5, s.log.filter((l) => l.includes('bundle cache')));
  check('cold: the log\'s summary', /0 hits, 5 misses/.test(await summary(s)), s.log.filter((l) => l.includes('hits')));
  await stop(s);

  // 2. a second server, the CDN failing every request
  cdn.failing = true; cdn.requests = 0;
  s = await startServer(await freePort(), CACHE);
  const offline = await getAll(s);
  check('offline: a new server starts and serves the same files from the cache', allRight(offline), Object.fromEntries(Object.entries(offline).map(([n, r]) => [n, r.status])));
  check('offline: the CDN not asked at all', cdn.requests === 0, cdn.requests);
  const sum2 = await summary(s);
  check('offline: the log counts hits, no misses', /bundle cache: 5 hits, 0 misses/.test(sum2) && !s.log.some((l) => /miss chunk/.test(l)), sum2);
  await stop(s);
  cdn.failing = false;

  // 3. damage: a changed byte (hash differs), the short last chunk truncated with its hash gone (an older cache), a broken index
  const c0 = join(chunkDir(CACHE), `${CHUNK}-0`), c10 = join(chunkDir(CACHE), `${CHUNK}-10`);
  const b0 = readFileSync(c0); b0[120] ^= 0xff; writeFileSync(c0, b0);   // a byte of small.tex
  truncateSync(c10, 500); unlinkSync(`${c10}.sha256`);
  writeFileSync(join(CACHE, TAR_NAME, 'index.gz'), 'not gzip');
  cdn.ranges = []; cdn.index = 0;
  s = await startServer(await freePort(), CACHE);
  const fixed = await getAll(s);
  check('damaged: every file served right', allRight(fixed), Object.fromEntries(Object.entries(fixed).map(([n, r]) => [n, r.data.equals(want(n))])));
  check('damaged: exactly the two bad chunks and the index fetched again', [...cdn.ranges].sort((a, b) => a - b).join() === '0,10' && cdn.index === 1, { ranges: cdn.ranges, index: cdn.index });
  check('damaged: the log names them', s.log.filter((l) => /bad chunk (0|10) /.test(l)).length === 2 && s.log.some((l) => /bad index/.test(l)), s.log.filter((l) => /bad/.test(l)));
  check('damaged: the cache is whole again', allChunksCheck(CACHE));
  await stop(s);

  // 3b. a chunk from before the hashes (no .sha256, the right length): taken, and its hash written
  unlinkSync(join(chunkDir(CACHE), `${CHUNK}-2.sha256`));
  cdn.failing = true;
  s = await startServer(await freePort(), CACHE);
  const older = await get(s, 'across.sty');
  check('an older chunk without a hash: served offline, its hash written', older.status === 200 && older.data.equals(want('across.sty')) && existsSync(join(chunkDir(CACHE), `${CHUNK}-2.sha256`)) && allChunksCheck(CACHE));
  await stop(s);
  cdn.failing = false;

  // 4. two cold servers on one empty cache at once
  const C2 = mkdtempSync(join(tmpdir(), 'bundle-cache-'));
  try {
    const [a, b] = await Promise.all([startServer(await freePort(), C2), startServer(await freePort(), C2)]);
    const [ga, gb] = await Promise.all([getAll(a), getAll(b)]);
    check('two cold servers at once: both serve right', allRight(ga) && allRight(gb));
    check('two cold servers at once: no temp files left, every chunk checks out', tmpLeft(C2).length === 0 && allChunksCheck(C2), tmpLeft(C2));
    await Promise.all([stop(a), stop(b)]);
  } finally { rmSync(C2, { recursive: true, force: true }); }
} finally {
  rmSync(CACHE, { recursive: true, force: true });
}

// 5. the default directory
const { sharedCacheDir } = await import('../engine/server/bundle.ts');
const mine = sharedCacheDir(ROOT);
const gitFile = join(ROOT, '.git');
const isWorktree = statSync(gitFile).isFile();
const mainCheckout = isWorktree ? dirname(dirname(dirname(/^gitdir:\s*(.+)$/m.exec(readFileSync(gitFile, 'utf8'))![1].trim()))) : ROOT;
check('the default cache: <workspace>/.cache/tectonic-bundle, the same from the main checkout and this checkout',
  mine === join(dirname(mainCheckout), '.cache', 'tectonic-bundle') && sharedCacheDir(mainCheckout) === mine && sharedCacheDir(join(ROOT, 'engine/server')) === mine, { mine, mainCheckout });
check('no git checkout above: null (the module falls back to server/cache)', sharedCacheDir(tmpdir()) === null);

cdnServer.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} ok`);
process.exit(failed ? 1 : 0);
