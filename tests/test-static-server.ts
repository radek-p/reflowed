// tests/qa/lib/static-server.ts, in Node on a small directory (no browser, any free ports):
//   node tests/test-static-server.ts
// A file with its length and type, a directory's index.html, the redirect to a directory's slash, nothing outside the
// root, 304 on a known ETag or date, CORS when asked, and the awkward host's ways: no type for .wasm, gzip with no
// Content-Length, a slowed body; the log says what was sent; a port in use rejects; close() with a connection open.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, Agent, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { staticServer } from './qa/lib/static-server.ts';

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` — ${JSON.stringify(detail)}`}`); };

interface Got { status: number; headers: IncomingHttpHeaders; body: Buffer; ms: number }
/** one request with exactly these headers (the path sent as written, not normalised) */
const get = (origin: string, path: string, headers: Record<string, string> = {}, method = 'GET', agent?: Agent) => new Promise<Got>((ok, bad) => {
  const t0 = Date.now();
  const u = new URL(origin);
  const rq = request({ host: u.hostname, port: u.port, path, method, headers, agent }, (rs) => {
    const parts: Buffer[] = [];
    rs.on('data', (c: Buffer) => parts.push(c));
    rs.on('end', () => ok({ status: rs.statusCode ?? 0, headers: rs.headers, body: Buffer.concat(parts), ms: Date.now() - t0 }));
  });
  rq.on('error', bad);
  rq.end();
});

const root = mkdtempSync(join(tmpdir(), 'rtx-static-'));
mkdirSync(join(root, 'site/sub'), { recursive: true });
const text = 'A line of text. '.repeat(4000);
writeFileSync(join(root, 'site/index.html'), '<!doctype html><title>x</title>');
writeFileSync(join(root, 'site/a.txt'), text);
writeFileSync(join(root, 'site/e.wasm'), Buffer.alloc(1000, 7));
writeFileSync(join(root, 'site/sub/ls-R'), 'ls-R\n');
writeFileSync(join(root, 'secret.txt'), 'outside');
const big = Buffer.alloc(200 * 1024, 1);
writeFileSync(join(root, 'site/slow.bin'), big);

// a plain host
{
  const s = await staticServer({ root: join(root, 'site') });
  const a = await get(s.origin, '/a.txt');
  check('a file: 200, its bytes, Content-Length, its type, no CORS header unless asked', a.status === 200 && a.body.toString() === text && a.headers['content-length'] === String(text.length)
    && a.headers['content-type'] === 'text/plain' && !a.headers['access-control-allow-origin'], a.headers);
  check('ls-R is text/plain, .wasm application/wasm by default', (await get(s.origin, '/sub/ls-R')).headers['content-type'] === 'text/plain' && (await get(s.origin, '/e.wasm')).headers['content-type'] === 'application/wasm');
  const i = await get(s.origin, '/');
  check('a directory with its slash: its index.html', i.status === 200 && i.body.toString().includes('<title>x</title>') && /^text\/html/.test(String(i.headers['content-type'])), i.status);
  const r = await get(s.origin, '/sub?x=1');
  check('a directory without its slash: 301 to it, the query kept', r.status === 301 && r.headers.location === '/sub/?x=1', r.headers);
  const out = await get(s.origin, '/../secret.txt'), out2 = await get(s.origin, '/%2e%2e/secret.txt');
  check('nothing outside the root (.. as written, and encoded): 404', out.status === 404 && out2.status === 404, [out.status, out2.status]);
  check('a missing file: 404; a directory with no index.html: 404', (await get(s.origin, '/nothere.txt')).status === 404 && (await get(s.origin, '/sub/')).status === 404);
  const tag = await get(s.origin, '/a.txt', { 'If-None-Match': String(a.headers.etag) });
  const date = await get(s.origin, '/a.txt', { 'If-Modified-Since': String(a.headers['last-modified']) });
  check('a known ETag or date: 304, no body; no Cache-Control sent', tag.status === 304 && tag.body.length === 0 && date.status === 304 && !a.headers['cache-control'], [tag.status, date.status]);
  const h = await get(s.origin, '/a.txt', {}, 'HEAD');
  check('HEAD: the headers, no body; POST: 405', h.status === 200 && h.body.length === 0 && h.headers['content-length'] === String(text.length) && (await get(s.origin, '/a.txt', {}, 'POST')).status === 405);
  const zip = await get(s.origin, '/a.txt', { 'Accept-Encoding': 'gzip' });
  check('gzip off: a client that accepts gzip gets the plain body', zip.status === 200 && !zip.headers['content-encoding'] && zip.body.toString() === text);
  const own = s.log.find((x) => x.path === '/a.txt');
  check('the log: method, the path as asked, status, bytes sent, Content-Length, type', !!own && own.method === 'GET' && own.status === 200 && own.bytes === text.length && own.length === String(text.length) && own.encoding === null && own.type === 'text/plain', own);
  check('the log: the redirect with its query, the 304 with no bytes, in the order asked', s.log.some((x) => x.path === '/sub?x=1' && x.status === 301) && s.log.filter((x) => x.status === 304).every((x) => x.bytes === 0)
    && s.log.findIndex((x) => x.path === '/sub?x=1') < s.log.findIndex((x) => x.status === 304), s.log);
  // a port in use: the second server's listen fails, loudly
  const taken = await staticServer({ root, port: s.port }).then(() => 'listened', (e: NodeJS.ErrnoException) => e.code);
  check('a port in use: staticServer rejects (EADDRINUSE)', taken === 'EADDRINUSE', taken);
  // close() with a kept-alive connection open
  const agent = new Agent({ keepAlive: true });
  await get(s.origin, '/a.txt', {}, 'GET', agent);
  const t0 = Date.now();
  await s.close();
  check('close() returns at once with a kept-alive connection open, and the port is free again', Date.now() - t0 < 1000 && await staticServer({ root, port: s.port }).then((x) => x.close().then(() => true), () => false));
  agent.destroy();
}

// an awkward host: no type for .wasm, gzip on everything (no Content-Length), a slowed file; CORS
{
  const s = await staticServer({ root: join(root, 'site'), types: { '.wasm': null }, gzip: true, rate: (p) => (p === '/slow.bin' ? 1 << 20 : 0), cors: true });
  const w = await get(s.origin, '/e.wasm');
  check('types { .wasm: null }: no Content-Type at all for .wasm', w.status === 200 && !('content-type' in w.headers) && w.body.length === 1000, w.headers);
  const z = await get(s.origin, '/a.txt', { 'Accept-Encoding': 'gzip, deflate' });
  check('gzip: Content-Encoding gzip, chunked, no Content-Length, the body gunzips to the file', z.headers['content-encoding'] === 'gzip' && z.headers['transfer-encoding'] === 'chunked' && !('content-length' in z.headers)
    && gunzipSync(z.body).toString() === text && z.body.length < text.length, z.headers);
  check('gzip: a client that does not accept it gets the plain body with its length', ((x) => !x.headers['content-encoding'] && x.headers['content-length'] === String(text.length))(await get(s.origin, '/a.txt')));
  const zl = s.log.find((x) => x.path === '/a.txt' && x.encoding === 'gzip');
  check('the log: a gzipped answer has no length, its encoding, the compressed bytes', !!zl && zl.length === null && zl.bytes === z.body.length, zl);
  const again = await get(s.origin, '/a.txt', { 'Accept-Encoding': 'gzip', 'If-None-Match': String(z.headers.etag) });
  check('gzip: the ETag is weak and still answers 304', /^W\//.test(String(z.headers.etag)) && again.status === 304, z.headers.etag);
  const slow = await get(s.origin, '/slow.bin');
  check(`rate: 200 KB at 1 MB/s takes about 0.2 s (${slow.ms} ms; the rest unslowed: ${w.ms} ms)`, slow.body.length > 1000 && slow.ms >= 150 && w.ms < 150, { slow: slow.ms, wasm: w.ms });
  check('cors: Access-Control-Allow-Origin * on files and on a 404; OPTIONS 204', w.headers['access-control-allow-origin'] === '*' && (await get(s.origin, '/nothere')).headers['access-control-allow-origin'] === '*'
    && (await get(s.origin, '/a.txt', {}, 'OPTIONS')).status === 204);
  await s.close();
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
