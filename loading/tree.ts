// A TREE: a static file tree beside the page, with an index (index.ts has the directory's whole interface). Two trees
// exist: the release (its index: the build's manifest, manifest.ts) and the TeX Live tree at texlive/2022/ (its index:
// TeX Live's own ls-R, ls-r.ts). Both are fetched the same way, two front ends over one URL builder, one set of checks
// and one set of reasons:
//
//   treeBase(rel, page)                    the tree's base URL from the page's (relative: works in any subdirectory)
//   { id, base, index, quiet? }: Tree      index: TreeIndex | null (null: not read yet)
//   urlOf(tree, path)                      base + path, each segment URL-encoded
//   accept(got, name, size?)               the body, or the reason it is not the file (HTTP status, no answer, a web
//                                          page instead of a TeX file, another length than the index says)
//   fetchSync(tree, name, get, report?)    TeX's I/O in the worker: a synchronous GET (GetSync), → { bytes } | { reason }
//   fetchAsync(tree, name, report?, f?)    the page's: fetch(), the body read in chunks (each chunk reported), → bytes,
//                                          or a TreeError with the same reasons
//   FetchEvent                             what both report (status.ts collects it: one store for the page)
//
// No DOM here: the worker and Node run it.

export interface TreeIndex {
  /** the file's path in the tree, or null when the index does not list it */
  path(name: string): string | null;
  /** its size in bytes when the index knows it (the manifest does; ls-R does not) */
  size(name: string): number | null;
  /** its group (the manifest's: essential, rest; the TeX tree's: tex) */
  group(name: string): string;
  /** how many files it lists */
  count: number;
  /** the other files of the directory a name is in (ls-R: a package's own directory), when the index knows */
  siblings?(name: string): string[];
}
export interface Tree {
  /** 'release' or 'tex' */
  id: string;
  /** the tree's root, ending in / */
  base: string;
  index: TreeIndex | null;
  /** an address assumed, not set (the tree beside the page): its failures are not the reader's problem */
  quiet?: boolean;
}

/** the base of a tree at `rel` beside the page (`page`: the page's base URL); '' when it cannot be resolved */
export function treeBase(rel: string, page: string): string {
  try { const u = new URL(rel, page).href; return u.endsWith('/') ? u : `${u}/`; } catch { return ''; }
}
export const urlOf = (tree: Tree, path: string) => `${tree.base}${path.split('/').map(encodeURIComponent).join('/')}`;

/** one synchronous GET's answer */
export interface Got { status: number; bytes: Uint8Array | null; type?: string | null; error?: string }
export type GetSync = (url: string) => Got;

/** the body, or why it is not the file */
export function accept(got: Got, name: string, size: number | null = null): { bytes: Uint8Array } | { reason: string } {
  if (got.status !== 200 || !got.bytes) return { reason: got.status ? `HTTP ${got.status}` : `no answer (${got.error ?? 'the server is off, or it sends no CORS headers'})` };
  // (a misconfigured server answers a missing file with its HTML page: not the file)
  if (/html/i.test(got.type ?? '') && !/\.html?$/i.test(name)) return { reason: 'the server sent a web page instead of the file' };
  if (size != null && got.bytes.length !== size) return { reason: `${got.bytes.length} bytes, not the ${size} the index says` };
  return { bytes: got.bytes };
}

export class TreeError extends Error {
  readonly tree: string; readonly name: string; readonly reason: string;
  constructor(tree: string, name: string, reason: string) { super(`${name}: ${reason}`); this.tree = tree; this.name = name; this.reason = reason; }
}

/** start: asked for (total when known); bytes: n more came (async only); done; fail: with the reason */
export type FetchEvent =
  | { tree: string; name: string; kind: 'start'; group: string; total: number | null; quiet?: boolean }
  | { tree: string; name: string; kind: 'bytes'; n: number }
  | { tree: string; name: string; kind: 'done'; bytes: number }
  | { tree: string; name: string; kind: 'fail'; reason: string; quiet?: boolean };
export type Report = (e: FetchEvent) => void;

/** a file of the tree at `path` (the index's, or one given: ls-R itself), synchronously */
export function fetchSync(tree: Tree, name: string, get: GetSync, report?: Report, path?: string): { bytes: Uint8Array } | { reason: string } {
  const p = path ?? tree.index?.path(name);
  if (!p) return { reason: 'not in the index' };
  const size = tree.index?.size(name) ?? null;
  report?.({ tree: tree.id, name, kind: 'start', group: tree.index?.group(name) ?? tree.id, total: size, quiet: tree.quiet });
  const r = accept(get(urlOf(tree, p)), name, size);
  report?.('bytes' in r ? { tree: tree.id, name, kind: 'done', bytes: r.bytes.length } : { tree: tree.id, name, kind: 'fail', reason: r.reason, quiet: tree.quiet });
  return r;
}

/** a file of the tree, by fetch(): the body read in chunks against the index's size (no Content-Length needed) */
export async function fetchAsync(tree: Tree, name: string, report?: Report, f: typeof fetch = fetch, init: RequestInit = { cache: 'force-cache' }): Promise<Uint8Array> {
  const p = tree.index?.path(name);
  if (!p) throw new TreeError(tree.id, name, 'not in the index');
  const size = tree.index?.size(name) ?? null;
  report?.({ tree: tree.id, name, kind: 'start', group: tree.index?.group(name) ?? tree.id, total: size, quiet: tree.quiet });
  const fail = (reason: string) => { report?.({ tree: tree.id, name, kind: 'fail', reason, quiet: tree.quiet }); return new TreeError(tree.id, name, reason); };
  let res: Response;
  try { res = await f(urlOf(tree, p), init); } catch (e) { throw fail(`no answer (${(e as Error).message})`); }
  if (!res.ok) throw fail(`HTTP ${res.status}`);
  if (/html/i.test(res.headers.get('content-type') ?? '') && !/\.html?$/i.test(name)) throw fail('the server sent a web page instead of the file');
  let bytes: Uint8Array;
  try { bytes = await readBody(res, size, (n) => report?.({ tree: tree.id, name, kind: 'bytes', n })); } catch (e) { throw fail((e as Error).message); }
  report?.({ tree: tree.id, name, kind: 'done', bytes: bytes.length });
  return bytes;
}

/** the body chunk by chunk (onBytes with each chunk's length); of exactly `expected` bytes when that is known */
export async function readBody(res: Response, expected: number | null, onBytes: (n: number) => void): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) {
    const b = new Uint8Array(await res.arrayBuffer());
    if (expected != null && b.length !== expected) throw new Error(`${b.length} bytes, not the ${expected} the index says`);
    onBytes(b.length);
    return b;
  }
  const parts: Uint8Array[] = [];
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (expected != null && at + value.length > expected) { await reader.cancel().catch(() => {}); throw new Error(`more than the ${expected} bytes the index says`); }
    parts.push(value);
    at += value.length;
    onBytes(value.length);
  }
  if (expected != null && at !== expected) throw new Error(`${at} bytes, not the ${expected} the index says`);
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(at);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** a synchronous GET (allowed in workers; the page is never blocked by it) */
export function xhrGetSync(timeoutMs = 20000): GetSync {
  return (url) => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', url, false);
      x.responseType = 'arraybuffer';
      try { x.timeout = timeoutMs; } catch { /* a browser that refuses a timeout on a synchronous request */ }
      x.send();
      return { status: x.status, bytes: x.status === 200 ? new Uint8Array(x.response as ArrayBuffer) : null, type: x.getResponseHeader('content-type') };
    } catch (e) {
      return { status: 0, bytes: null, error: (e as Error)?.message ?? String(e) };
    }
  };
}
