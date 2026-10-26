// A static http server for the suites, in this process (Node's own modules only): a directory served as a static host
// serves it, every request in a log in memory, and on request the ways an awkward host differs.
//
//   const s = await staticServer({ root, port: 8187 });   // listens on 127.0.0.1; port 0 (the default): any free one;
//                                                          // a port in use (or any listen error) rejects
//   s.origin, s.port                                       // 'http://127.0.0.1:8187', 8187
//   s.log                                                  // every request, in the order asked (an array: clear it with s.log.length = 0)
//   await s.close()                                        // stops listening and drops open connections
//
// Serving: GET and HEAD; a directory's index.html; a directory asked for without its trailing slash is redirected
// (301) to it; symbolic links are followed; nothing outside the root. Last-Modified and an ETag, and a 304 for a
// request that names them (If-None-Match, If-Modified-Since); no Cache-Control. Content-Type by extension (or by file
// name, ls-R; TeX sources are text/plain), application/octet-stream otherwise.
//
// Options:
//   types   per extension ('.wasm') or file name ('ls-R'): the Content-Type, over the defaults; null: none sent
//   gzip    every body gzipped for a client that accepts it, streamed: chunked, no Content-Length
//   rate    rate(path): bytes per second for that path's body (0 or undefined: as fast as it goes)
//   hold    hold(path): a promise the body waits for (its headers sent), or none: a file still coming at a given moment
//   cors    Access-Control-Allow-Origin: * on every answer, and OPTIONS answered 204
// A log entry: method, path (as asked, the query included), status, bytes (the body as sent: compressed, 0 for a 304
// or HEAD), length (the Content-Length sent, null for none), encoding (the Content-Encoding sent, or null), type
// (the Content-Type sent, or null). Entries are added when the answer starts; bytes grows until it is sent.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, statSync, type Stats } from 'node:fs';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { Transform, pipeline, type TransformCallback } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { AddressInfo } from 'node:net';

export interface StaticServerOptions {
  root: string;
  port?: number;
  host?: string;
  types?: Record<string, string | null>;
  gzip?: boolean;
  rate?: (path: string) => number | undefined;
  hold?: (path: string) => Promise<unknown> | null | undefined;
  cors?: boolean;
}
export interface Logged { method: string; path: string; status: number; bytes: number; length: string | null; encoding: string | null; type: string | null }
export interface StaticServer { origin: string; port: number; log: Logged[]; close(): Promise<void> }

const TEXT_TEX = ['ls-R', '.sty', '.cls', '.clo', '.tex', '.def', '.fd', '.cfg', '.ldf', '.ltx', '.dtx', '.lua', '.bst', '.bbx', '.cbx', '.lbx', '.dbx', '.enc', '.map', '.ist'];
export const DEFAULT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.pdf': 'application/pdf', ...Object.fromEntries(TEXT_TEX.map((k) => [k, 'text/plain'])),
};

/** counts the body's bytes into the entry and, given a rate, holds them to it */
function meter(entry: Logged, rate: number): Transform {
  const start = Date.now();
  const STEP = 16384;
  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
      if (!rate) { entry.bytes += chunk.length; done(null, chunk); return; }
      const send = (at: number) => {
        if (at >= chunk.length) { done(); return; }
        const piece = chunk.subarray(at, at + STEP);
        entry.bytes += piece.length;
        this.push(piece);
        const wait = start + (entry.bytes / rate) * 1000 - Date.now();
        if (wait > 0) setTimeout(() => send(at + STEP), wait); else send(at + STEP);
      };
      send(0);
    },
  });
}

export async function staticServer(o: StaticServerOptions): Promise<StaticServer> {
  const root = resolve(o.root);
  const types: Record<string, string | null> = { ...DEFAULT_TYPES, ...o.types };
  const log: Logged[] = [];

  const answer = (req: IncomingMessage, res: ServerResponse) => {
    const raw = req.url ?? '/';
    const method = req.method ?? 'GET';
    const entry: Logged = { method, path: raw, status: 0, bytes: 0, length: null, encoding: null, type: null };
    log.push(entry);
    const head = (status: number, headers: Record<string, string> = {}) => {
      if (o.cors) headers['Access-Control-Allow-Origin'] = '*';
      entry.status = status;
      entry.length = headers['Content-Length'] ?? null;
      entry.encoding = headers['Content-Encoding'] ?? null;
      entry.type = headers['Content-Type'] ?? null;
      res.writeHead(status, headers);
    };
    const end = (status: number, headers: Record<string, string> = {}) => { head(status, { ...headers, 'Content-Length': '0' }); res.end(); };
    if (method === 'OPTIONS' && o.cors) { end(204); return; }
    if (method !== 'GET' && method !== 'HEAD') { end(405, { Allow: 'GET, HEAD' }); return; }
    const q = raw.indexOf('?');
    let path: string;
    try { path = decodeURIComponent(q < 0 ? raw : raw.slice(0, q)); } catch { end(400); return; }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { end(404); return; }
    let st: Stats | null = null;
    try { st = statSync(file); } catch { /* not there */ }
    if (st?.isDirectory()) {
      if (!path.endsWith('/')) { end(301, { Location: `${path}/${q < 0 ? '' : raw.slice(q)}` }); return; }
      file = join(file, 'index.html');
      try { st = statSync(file); } catch { st = null; }
    }
    if (!st?.isFile()) { end(404); return; }

    const zip = !!o.gzip && method === 'GET' && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const etag = `${zip ? 'W/' : ''}"${Math.floor(st.mtimeMs).toString(16)}-${st.size.toString(16)}"`;
    const modified = new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString();
    const headers: Record<string, string> = { 'Last-Modified': modified, ETag: etag };
    const key = extname(file) || basename(file);
    const type = key in types ? types[key] : 'application/octet-stream';
    if (type) headers['Content-Type'] = type;
    const inm = req.headers['if-none-match'], ims = req.headers['if-modified-since'];
    const tag = (t: string) => t.trim().replace(/^W\//, '');
    if (inm ? inm.split(',').some((t) => t.trim() === '*' || tag(t) === tag(etag)) : ims ? Date.parse(ims) >= Date.parse(modified) : false) {
      head(304, { 'Last-Modified': modified, ETag: etag }); res.end(); return;
    }
    if (zip) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; } else headers['Content-Length'] = String(st.size);
    head(200, headers);
    if (method === 'HEAD') { res.end(); return; }
    const steps: NodeJS.ReadWriteStream[] = zip ? [createGzip()] : [];
    const send = () => { pipeline([createReadStream(file), ...steps, meter(entry, o.rate?.(path) ?? 0), res], () => { /* a client gone mid-body: nothing to do */ }); };
    const held = o.hold?.(path);
    if (held) held.then(send, send); else send();
  };

  const server = createServer(answer);
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(o.port ?? 0, o.host ?? '127.0.0.1', () => { server.off('error', fail); ok(); });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://${o.host ?? '127.0.0.1'}:${port}`, port, log,
    close: () => new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections(); }),
  };
}
