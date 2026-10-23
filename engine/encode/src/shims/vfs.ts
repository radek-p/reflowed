// An in-memory file system for the public encoder's Node code, plus read-only
// "mounts": a path prefix whose files are fetched on first read (synchronously:
// the encoder's fs calls are synchronous, and this runs in a Web Worker, where
// a sync XHR is allowed) and then kept. Directories under a mount are listed
// from a manifest made at build time (scripts/build.ts).
import { Buffer } from 'buffer';

export type Resolver = (rel: string) => Uint8Array | null;

interface Mount { prefix: string; resolve: Resolver; list?: Set<string> }

export const files = new Map<string, Uint8Array>();
const dirs = new Set<string>(['/']);
const mounts: Mount[] = [];
const missing = new Set<string>();
/** Every mounted file read, for the stats (and to see what the encoder needs). */
export const mountReads: string[] = [];
/** Time spent fetching mounted files (ms). */
export const mountTime = { ms: 0 };

export const norm = (p: string): string => {
  const out: string[] = [];
  for (const s of String(p).split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return '/' + out.join('/');
};
const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

export function mount(prefix: string, resolve: Resolver, list?: string[]): void {
  mounts.push({ prefix: norm(prefix), resolve, list: list ? new Set(list.map(norm)) : undefined });
  mkdirp(norm(prefix));
  for (const f of list ?? []) mkdirp(parent(norm(f)));
}

export function mkdirp(p: string): void {
  for (let d = norm(p); !dirs.has(d); d = parent(d)) dirs.add(d);
}

function mountOf(p: string): Mount | undefined {
  return mounts.find(m => p === m.prefix || p.startsWith(m.prefix + '/'));
}

/** The file's bytes, from memory or a mount; null if there is none. */
export function read(p: string): Uint8Array | null {
  p = norm(p);
  const hit = files.get(p);
  if (hit) return hit;
  if (missing.has(p)) return null;
  const m = mountOf(p);
  if (!m || (m.list && !m.list.has(p))) { missing.add(p); return null; }
  const t0 = performance.now();
  const data = m.resolve(p.slice(m.prefix.length + 1));
  mountTime.ms += performance.now() - t0;
  if (!data) { missing.add(p); return null; }
  mountReads.push(p);
  files.set(p, data);
  mkdirp(parent(p));
  return data;
}

export function write(p: string, data: Uint8Array | string): void {
  p = norm(p);
  files.set(p, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
  missing.delete(p);
  mkdirp(parent(p));
}

export const isDir = (p: string): boolean => dirs.has(norm(p));
export const isFile = (p: string): boolean => read(p) !== null;

export function list(p: string): string[] {
  p = norm(p);
  const out = new Set<string>();
  const add = (f: string) => { if (parent(f) === p) out.add(f.slice(p === '/' ? 1 : p.length + 1)); };
  for (const f of files.keys()) add(f);
  for (const d of dirs) if (d !== p) add(d);
  const m = mountOf(p);
  for (const f of m?.list ?? []) add(f);
  return [...out].sort();
}

export function remove(p: string, recursive = false): void {
  p = norm(p);
  files.delete(p);
  if (recursive) {
    for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f);
    for (const d of [...dirs]) if (d === p || d.startsWith(p + '/')) dirs.delete(d);
  }
}

/** Everything written under `dir` (not the mounts' files), relative paths. */
export function tree(dir: string): Map<string, Uint8Array> {
  dir = norm(dir);
  const out = new Map<string, Uint8Array>();
  for (const [f, b] of files) if (f.startsWith(dir + '/') && !mountOf(f)) out.set(f.slice(dir.length + 1), b);
  return out;
}

export const toBuffer = (b: Uint8Array): Buffer => Buffer.from(b.buffer, b.byteOffset, b.byteLength);
