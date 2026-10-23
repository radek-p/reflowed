// The engine ReflowEd runs comes from a release of github.com/radek-p/reflow-tectonic: Tectonic's XeTeX with the
// capture, built to WebAssembly, with its LaTeX format and its TeX Live tree. engine/reflow-tectonic.json (the lock)
// names the release (repository, tag) and each asset's sha256. This script fetches the assets, checks them against
// the lock and installs them where ReflowEd reads them:
//   tectonic.mjs, tectonic_wasm.wasm, STAMP.txt   engine/dist/async/
//   latex.fmt.gz                                  engine/api/formats/latex.fmt (unpacked)
//   texlive-tree.tar.gz                           build/resources/www/texlive/2022/ (unpacked: the TeX Live tree a
//                                                 release reads beside its page; the tests serve it from there)
//
//   node scripts/fetch-engine.ts                  download https://github.com/<repository>/releases/download/<tag>/<name>
//   node scripts/fetch-engine.ts --from <dir>     the assets from a directory instead (a local reflow-tectonic build:
//                                                 its reflow/dist/release/); also $REFLOW_ENGINE_FROM
//
// Every asset is checked against the lock's sha256 before anything is installed: one that differs stops the install
// with nothing changed (an engine build other than the lock's: put its sha256s in the lock first). When what is
// installed is already the lock's, nothing is done. Downloads are kept outside the checkout: $REFLOW_ENGINE_CACHE,
// else the workspace's shared <workspace>/.cache/reflow-tectonic (beside the TeX bundle's cache), else build/engine-cache;
// as <cache>/<sha256>/<name>, checked on every use. What was installed is recorded in
// engine/dist/reflow-tectonic.installed.json (the assets' and the installed files' sha256s): the check
// (installedProblems; scripts/engine-stamp.ts for the release build) compares the files with it and it with the lock.
//
// As a module: readLock(root), installedProblems(root, lock, { tree }), installEngine(root, lock, options),
// untar(tar bytes, dir).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { sharedCacheDir } from '../engine/server/bundle.ts';

export const ASSETS = ['tectonic.mjs', 'tectonic_wasm.wasm', 'STAMP.txt', 'latex.fmt.gz', 'texlive-tree.tar.gz'] as const;
export type AssetName = typeof ASSETS[number];
export interface Lock { repository: string; tag: string; assets: Record<AssetName, string> }

/** where each asset goes, from the repository root (the tree: the directory its texlive/ becomes) */
export const LOCK = 'engine/reflow-tectonic.json';
export const RECORD = 'engine/dist/reflow-tectonic.installed.json';
const COPIED: Partial<Record<AssetName, string>> = {
  'tectonic.mjs': 'engine/dist/async/tectonic.mjs',
  'tectonic_wasm.wasm': 'engine/dist/async/tectonic_wasm.wasm',
  'STAMP.txt': 'engine/dist/async/STAMP.txt',
};
export const FORMAT = 'engine/api/formats/latex.fmt';
export const TREE = 'build/resources/www/texlive';
interface Installed { repository: string; tag: string; assets: Record<string, string>; files: Record<string, string>; tree: string }

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const isSha = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

/** the lock, checked: a repository owner/name, a tag, and a sha256 for each of the five assets (no other) */
export function readLock(root: string): Lock {
  const path = join(root, LOCK);
  const j = JSON.parse(readFileSync(path, 'utf8')) as { repository?: unknown; tag?: unknown; assets?: unknown };
  if (typeof j.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(j.repository)) throw new Error(`${path}: "repository" must be owner/name`);
  if (typeof j.tag !== 'string' || !/^[\w.-]+$/.test(j.tag)) throw new Error(`${path}: "tag" must be a release tag`);
  if (!Array.isArray(j.assets)) throw new Error(`${path}: "assets" must be a list of { name, sha256 }`);
  const assets: Partial<Record<AssetName, string>> = {};
  for (const a of j.assets as { name?: unknown; sha256?: unknown }[]) {
    const name = ASSETS.find((n) => n === a.name);
    if (!name) throw new Error(`${path}: an asset named ${JSON.stringify(a.name)}: the engine has ${ASSETS.join(', ')}`);
    if (!isSha(a.sha256)) throw new Error(`${path}: ${name} needs a sha256 (64 hex digits)`);
    assets[name] = a.sha256;
  }
  const missing = ASSETS.filter((n) => !assets[n]);
  if (missing.length) throw new Error(`${path}: no sha256 for ${missing.join(', ')}`);
  return { repository: j.repository, tag: j.tag, assets: assets as Record<AssetName, string> };
}

/** a tree's digest: every file under dir, by its path and contents */
function treeDigest(dir: string): string {
  const lines = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => { const p = join(e.parentPath, e.name); return `${relative(dir, p).split(sep).join('/')}\0${sha256(readFileSync(p))}`; }).sort();
  return sha256(lines.join('\n'));
}

/** STAMP.txt's wasm line (reflow-tectonic writes "commit <sha>\nwasm <sha256>\n") */
const stampWasm = (stamp: string) => /^wasm ([0-9a-f]{64})$/m.exec(stamp)?.[1] ?? null;

/** what differs between the lock and what is installed (empty: the lock's engine is installed); tree: false leaves the
 *  TeX tree out (the release build does not read it) */
export function installedProblems(root: string, lock: Lock, o: { tree?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const [name, path] of Object.entries(COPIED) as [AssetName, string][]) {
    const f = join(root, path);
    if (!existsSync(f)) out.push(`${path} missing`);
    else if (sha256(readFileSync(f)) !== lock.assets[name]) out.push(`${path} is not the lock's ${name}`);
  }
  const stamp = join(root, COPIED['STAMP.txt']!);
  if (existsSync(stamp) && stampWasm(readFileSync(stamp, 'utf8')) !== lock.assets['tectonic_wasm.wasm']) out.push(`${COPIED['STAMP.txt']} names another wasm than the lock's`);
  const rec = join(root, RECORD);
  if (!existsSync(rec)) return [...out, `${RECORD} missing (nothing installed by scripts/fetch-engine.ts)`];
  const r = JSON.parse(readFileSync(rec, 'utf8')) as Installed;
  const fmt = join(root, FORMAT);
  if (r.assets['latex.fmt.gz'] !== lock.assets['latex.fmt.gz']) out.push(`${FORMAT} is from another latex.fmt.gz than the lock's`);
  else if (!existsSync(fmt)) out.push(`${FORMAT} missing`);
  else if (sha256(readFileSync(fmt)) !== r.files[FORMAT]) out.push(`${FORMAT} has changed since it was installed`);
  if (o.tree !== false) {
    const tree = join(root, TREE);
    if (r.assets['texlive-tree.tar.gz'] !== lock.assets['texlive-tree.tar.gz']) out.push(`${TREE} is from another texlive-tree.tar.gz than the lock's`);
    else if (!existsSync(tree)) out.push(`${TREE} missing`);
    else if (treeDigest(tree) !== r.tree) out.push(`${TREE} has changed since it was installed`);
  }
  return out;
}

/** a tar's entries written under dir: files and directories only (ustar, GNU long names, pax paths); a path that
 *  leaves dir, a link or another kind of entry is refused before anything is written */
export function untar(tar: Uint8Array, dir: string): number {
  const text = (b: Uint8Array) => { const z = b.indexOf(0); return new TextDecoder().decode(z < 0 ? b : b.subarray(0, z)); };
  const octal = (b: Uint8Array) => (b[0] & 0x80 ? b.subarray(1).reduce((n, x) => n * 256 + x, 0) : parseInt(text(b).trim() || '0', 8));
  const entries: { path: string; dir: boolean; data: Uint8Array }[] = [];
  let at = 0, longName: string | null = null, paxPath: string | null = null;
  while (at + 512 <= tar.length) {
    const h = tar.subarray(at, at + 512);
    if (h.every((x) => x === 0)) break;
    const sum = h.reduce((n, x, i) => n + (i >= 148 && i < 156 ? 32 : x), 0);
    if (sum !== octal(h.subarray(148, 156))) throw new Error(`tar: a bad header checksum at byte ${at}`);
    const size = octal(h.subarray(124, 136)), type = String.fromCharCode(h[156] || 48);
    const data = tar.subarray(at + 512, at + 512 + size);
    if (data.length !== size) throw new Error('tar: the archive ends inside an entry');
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = text(data); continue; }
    if (type === 'x') { paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(data))?.[1] ?? null; continue; }
    if (type === 'g') continue;
    const posix = text(h.subarray(257, 263)) === 'ustar' && h[262] === 0;
    const name = paxPath ?? longName ?? (posix && h[345] ? `${text(h.subarray(345, 500))}/` : '') + text(h.subarray(0, 100));
    longName = paxPath = null;
    if (type !== '0' && type !== '5') throw new Error(`tar: ${name}: only files and directories are installed (type ${type})`);
    const path = normalize(name);
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error(`tar: ${name} is outside the directory`);
    entries.push({ path, dir: type === '5', data });
  }
  for (const e of entries) {
    const p = join(dir, e.path);
    if (e.dir) mkdirSync(p, { recursive: true });
    else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, e.data); }
  }
  return entries.filter((e) => !e.dir).length;
}

/** the download cache: $REFLOW_ENGINE_CACHE, the workspace's, else build/engine-cache */
export function cacheDir(root: string): string {
  const shared = sharedCacheDir(root);
  return process.env.REFLOW_ENGINE_CACHE ?? (shared ? join(dirname(shared), 'reflow-tectonic') : join(root, 'build/engine-cache'));
}

const writeAtomic = (path: string, data: Uint8Array | string) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
};

/** one asset's bytes, checked: from the directory, else the cache, else downloaded (and then cached) */
async function asset(lock: Lock, name: AssetName, o: { from?: string; baseUrl: string; cache: string }): Promise<Uint8Array> {
  const want = lock.assets[name];
  const check = (b: Uint8Array, where: string) => {
    const got = sha256(b);
    if (got !== want) throw new Error(`${where}: sha256 ${got.slice(0, 12)}…, the lock (${LOCK}) names ${want.slice(0, 12)}…`);
    return b;
  };
  if (o.from) {
    const f = join(o.from, name);
    if (!existsSync(f)) throw new Error(`${f} missing`);
    return check(readFileSync(f), f);
  }
  const cached = join(o.cache, want, name);
  if (existsSync(cached)) {
    const b = readFileSync(cached);
    if (sha256(b) === want) return b;
    rmSync(cached);                            // damaged: fetched again
  }
  const url = `${o.baseUrl}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const b = check(new Uint8Array(await res.arrayBuffer()), url);
  writeAtomic(cached, b);
  return b;
}

export interface InstallOptions {
  /** a directory with the assets (a local build); else they are downloaded */
  from?: string;
  /** where the assets are downloaded from: by default the lock's release on GitHub */
  baseUrl?: string;
  cache?: string;
  log?: (line: string) => void;
}
/** installs the lock's engine; false when it was installed already (nothing is done then) */
export async function installEngine(root: string, lock: Lock, o: InstallOptions = {}): Promise<boolean> {
  const log = o.log ?? (() => {});
  const problems = installedProblems(root, lock);
  if (!problems.length) { log(`engine: ${lock.repository} ${lock.tag} is installed`); return false; }
  log(`engine: ${problems.join('; ')}`);
  const where = { from: o.from, baseUrl: o.baseUrl ?? `https://github.com/${lock.repository}/releases/download/${lock.tag}`, cache: o.cache ?? cacheDir(root) };
  const got = {} as Record<AssetName, Uint8Array>;
  for (const name of ASSETS) got[name] = await asset(lock, name, where);
  if (stampWasm(new TextDecoder().decode(got['STAMP.txt'])) !== lock.assets['tectonic_wasm.wasm']) throw new Error(`STAMP.txt names another wasm than the lock's tectonic_wasm.wasm`);
  // the tree first, beside its place (a refused archive leaves the installed tree as it was)
  const tree = join(root, TREE), tmp = `${tree}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  const n = untar(gunzipSync(got['texlive-tree.tar.gz']), tmp);
  if (!existsSync(join(tmp, 'texlive'))) { rmSync(tmp, { recursive: true, force: true }); throw new Error('texlive-tree.tar.gz has no texlive/'); }
  rmSync(tree, { recursive: true, force: true });
  renameSync(join(tmp, 'texlive'), tree);
  rmSync(tmp, { recursive: true, force: true });
  const fmt = gunzipSync(got['latex.fmt.gz']);
  writeAtomic(join(root, FORMAT), fmt);
  for (const [name, path] of Object.entries(COPIED) as [AssetName, string][]) writeAtomic(join(root, path), got[name]);
  const rec: Installed = {
    repository: lock.repository, tag: lock.tag, assets: lock.assets,
    files: { ...Object.fromEntries(Object.entries(COPIED).map(([name, path]) => [path, lock.assets[name as AssetName]])), [FORMAT]: sha256(fmt) },
    tree: treeDigest(tree),
  };
  writeAtomic(join(root, RECORD), JSON.stringify(rec, null, 1) + '\n');
  log(`engine: installed ${lock.repository} ${lock.tag} from ${o.from ?? where.baseUrl} (the engine, latex.fmt, ${n} files of the TeX tree)`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const f = args.indexOf('--from');
  const from = f >= 0 ? args[f + 1] : process.env.REFLOW_ENGINE_FROM || undefined;
  if ((f >= 0 && !from) || args.some((a, i) => a !== '--from' && i !== f + 1)) {
    console.error('usage: node scripts/fetch-engine.ts [--from <directory of the release assets>]');
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await installEngine(root, readLock(root), { from: from && resolve(from), log: (l) => console.log(l) });
  } catch (e) {
    console.error(`fetch-engine: ${(e as Error).message}`);
    process.exit(1);
  }
}
