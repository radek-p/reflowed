// The engine guards: scripts/fetch-engine.ts (the lock read and checked, every asset checked against its sha256
// before anything is installed, the install, nothing done when it is installed already, the download cache, the
// tar reader) and scripts/engine-stamp.ts (the release build refuses an engine other than the lock's). On scratch
// repositories with small assets, served by a local HTTP server for the downloads; and the real lock.
//   node tests/test-engine-stamp.ts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ASSETS, FORMAT, RECORD, TREE, installEngine, installedProblems, readLock, untar, type Lock } from '../scripts/fetch-engine.ts';
import { stampProblem } from '../scripts/engine-stamp.ts';

let fail = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !d ? '' : ` — ${d}`}`); if (!ok) fail++; };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const refused = async (f: () => Promise<unknown>): Promise<string> => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };
const ROOT = new URL('../', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'rtx-engine-'));

// ── a tar written here (ustar headers, a GNU long name), so the reader is tested without a tar program
function tar(entries: { name: string; data?: string; type?: string }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = new Uint8Array(512), put = (s: string, at: number) => h.set(new TextEncoder().encode(s), at);
    put(name.slice(0, 100), 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
    put(size.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136); put(type, 156); put('ustar  \0', 257);
    h.fill(32, 148, 156);
    put(h.reduce((s, x) => s + x, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const body = (b: Uint8Array) => { const p = new Uint8Array(Math.ceil(b.length / 512) * 512); p.set(b); return p; };
  for (const e of entries) {
    const data = new TextEncoder().encode(e.data ?? '');
    if (e.name.length > 100) { const ln = new TextEncoder().encode(e.name + '\0'); blocks.push(header('././@LongLink', ln.length, 'L'), body(ln)); }
    blocks.push(header(e.name, data.length, e.type ?? (e.name.endsWith('/') ? '5' : '0')), body(data));
  }
  blocks.push(new Uint8Array(1024));
  return Buffer.concat(blocks);
}

// ── the untar
{
  const long = `texlive/2022/texmf-dist/tex/latex/${'a'.repeat(90)}/b.sty`;
  const d = join(scratch, 'untar');
  const count = untar(tar([{ name: 'texlive/' }, { name: 'texlive/2022/ls-R', data: 'x' }, { name: long, data: 'long' }]), d);
  check('untar: files and directories, a GNU long name', count === 2 && readFileSync(join(d, 'texlive/2022/ls-R'), 'utf8') === 'x' && readFileSync(join(d, long), 'utf8') === 'long');
  const out = join(scratch, 'outside');
  let msg = '';
  try { untar(tar([{ name: 'texlive/ok', data: '1' }, { name: '../outside', data: 'no' }]), join(scratch, 'untar2')); } catch (e) { msg = (e as Error).message; }
  check('untar: a path outside the directory is refused, and nothing is written', /outside the directory/.test(msg) && !existsSync(out) && !existsSync(join(scratch, 'untar2')), msg);
  msg = '';
  try { untar(tar([{ name: 'texlive/link', type: '2' }]), join(scratch, 'untar3')); } catch (e) { msg = (e as Error).message; }
  check('untar: a link is refused', /only files and directories/.test(msg), msg);
  const bad = tar([{ name: 'texlive/a', data: '1' }]); bad[0] ^= 1;
  msg = '';
  try { untar(bad, join(scratch, 'untar4')); } catch (e) { msg = (e as Error).message; }
  check('untar: a damaged header is refused', /checksum/.test(msg), msg);
}

// ── a release of small assets, and a scratch repository with its lock
const WASM_SHA = sha256('wasm');
const release: Record<string, Uint8Array> = {
  'tectonic.mjs': Buffer.from('export default () => {};\n'),
  'tectonic_wasm.wasm': Buffer.from('wasm'),
  'STAMP.txt': Buffer.from(`commit 0123456789abcdef\nwasm ${WASM_SHA}\n`),
  'latex.fmt.gz': gzipSync('the format'),
  'texlive-tree.tar.gz': gzipSync(tar([{ name: 'texlive/' }, { name: 'texlive/2022/' }, { name: 'texlive/2022/texmf-dist/ls-R', data: '% ls-R\n' }])),
};
const relDir = join(scratch, 'release');
mkdirSync(relDir);
for (const [k, v] of Object.entries(release)) writeFileSync(join(relDir, k), v);
const lockOf = (assets: Record<string, Uint8Array>) => ({ repository: 'example/engine', tag: 'reflow-test', assets: ASSETS.map((name) => ({ name, sha256: sha256(assets[name]) })) });
const repo = (name: string, lock: unknown = lockOf(release)) => {
  const r = join(scratch, name);
  mkdirSync(join(r, 'engine'), { recursive: true });
  writeFileSync(join(r, 'engine/reflow-tectonic.json'), JSON.stringify(lock));
  return r;
};

// the lock
{
  const r = repo('lock-bad', { ...lockOf(release), assets: lockOf(release).assets.slice(1) });
  check('readLock: an asset without a sha256 is refused', /no sha256 for tectonic\.mjs/.test(await refused(async () => readLock(r))));
  const r2 = repo('lock-extra', { ...lockOf(release), assets: [...lockOf(release).assets, { name: 'other.bin', sha256: '0'.repeat(64) }] });
  check('readLock: an asset the engine does not have is refused', /other\.bin/.test(await refused(async () => readLock(r2))));
}

// install from a directory
const A = repo('a');
const lock: Lock = readLock(A);
check('nothing installed: the release build refuses, naming scripts/fetch-engine.ts', /engine\/dist\/async\/tectonic_wasm\.wasm missing.*run node scripts\/fetch-engine\.ts/.test(stampProblem(A) ?? ''), stampProblem(A) ?? '');
check('install from a directory: done', await installEngine(A, lock, { from: relDir }) === true);
check('the files are where ReflowEd reads them', readFileSync(join(A, 'engine/dist/async/tectonic_wasm.wasm'), 'utf8') === 'wasm' && readFileSync(join(A, FORMAT), 'utf8') === 'the format'
  && readFileSync(join(A, TREE, '2022/texmf-dist/ls-R'), 'utf8') === '% ls-R\n' && existsSync(join(A, RECORD)));
check('installed: no problems, the release build accepts it', installedProblems(A, lock).length === 0 && stampProblem(A) === null, [...installedProblems(A, lock), stampProblem(A)].join('; '));
const mtime = statSync(join(A, FORMAT)).mtimeMs;
check('installed already: nothing is done', await installEngine(A, lock, { from: join(scratch, 'nowhere') }) === false && statSync(join(A, FORMAT)).mtimeMs === mtime);

// changed after the install
writeFileSync(join(A, 'engine/dist/async/tectonic_wasm.wasm'), 'another wasm');
check('a wasm other than the lock\'s: refused by the release build, naming fetch-engine', /tectonic_wasm\.wasm is not the lock's.*fetch-engine/.test(stampProblem(A) ?? ''), stampProblem(A) ?? '');
await installEngine(A, lock, { from: relDir });
check('fetch-engine puts the lock\'s wasm back', stampProblem(A) === null, stampProblem(A) ?? '');
writeFileSync(join(A, FORMAT), 'another format');
check('a format other than the one installed: refused', /latex\.fmt has changed/.test(stampProblem(A) ?? ''), stampProblem(A) ?? '');
await installEngine(A, lock, { from: relDir });
writeFileSync(join(A, TREE, '2022/texmf-dist/ls-R'), 'edited');
check('an edited TeX tree: a problem for fetch-engine (not for the release build, which does not carry it)', installedProblems(A, lock).some((p) => /texlive has changed/.test(p)) && stampProblem(A) === null);
await installEngine(A, lock, { from: relDir });
check('fetch-engine puts the tree back', readFileSync(join(A, TREE, '2022/texmf-dist/ls-R'), 'utf8') === '% ls-R\n' && installedProblems(A, lock).length === 0);

// a lock that names another engine
{
  const other = { ...release, 'tectonic_wasm.wasm': Buffer.from('wasm 2'), 'STAMP.txt': Buffer.from(`commit 1\nwasm ${sha256('wasm 2')}\n`) };
  const B = repo('b');
  cpSync(join(A, 'engine/dist'), join(B, 'engine/dist'), { recursive: true }); cpSync(join(A, 'engine/api'), join(B, 'engine/api'), { recursive: true });
  writeFileSync(join(B, 'engine/reflow-tectonic.json'), JSON.stringify(lockOf(other)));
  check('the lock changed (a merge), the old engine still installed: refused', /is not the lock's/.test(stampProblem(B) ?? ''), stampProblem(B) ?? '');
  const msg = await refused(() => installEngine(B, readLock(B), { from: relDir }));
  check('an asset other than the lock\'s: refused, nothing changed', /tectonic_wasm\.wasm: sha256 .* the lock .* names/.test(msg) && readFileSync(join(B, 'engine/dist/async/tectonic_wasm.wasm'), 'utf8') === 'wasm', msg);
  const C = repo('c', lockOf({ ...release, 'STAMP.txt': Buffer.from('commit 1\nwasm ' + '0'.repeat(64) + '\n') }));
  const cDir = join(scratch, 'release-c'); cpSync(relDir, cDir, { recursive: true }); writeFileSync(join(cDir, 'STAMP.txt'), 'commit 1\nwasm ' + '0'.repeat(64) + '\n');
  check('a release whose STAMP.txt names another wasm: refused', /STAMP\.txt names another wasm/.test(await refused(() => installEngine(C, readLock(C), { from: cDir }))));
}

// downloads: from a local server, into the cache; a second install reads the cache; a damaged download is not kept
{
  const asked: string[] = [];
  let corrupt = false;
  const server = createServer((rq, rs) => {
    const name = decodeURIComponent((rq.url ?? '').split('/').pop() ?? '');
    asked.push(name);
    const b = release[name];
    if (!b) { rs.writeHead(404); rs.end(); return; }
    rs.writeHead(200); rs.end(corrupt && name === 'tectonic.mjs' ? Buffer.from('tampered') : b);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/releases/download/reflow-test`;
  const cache = join(scratch, 'cache');
  corrupt = true;
  const D = repo('d');
  const msg = await refused(() => installEngine(D, readLock(D), { baseUrl, cache }));
  check('a download that is not the lock\'s asset: refused, not cached, nothing installed', /tectonic\.mjs: sha256/.test(msg) && !existsSync(join(cache, lock.assets['tectonic.mjs'])) && !existsSync(join(D, 'engine/dist')), msg);
  corrupt = false; asked.length = 0;
  check('download: installed', await installEngine(D, readLock(D), { baseUrl, cache }) === true && installedProblems(D, lock).length === 0 && asked.length === ASSETS.length);
  check('the cache: <cache>/<sha256>/<name>', ASSETS.every((a) => existsSync(join(cache, lock.assets[a], a))));
  const E = repo('e');
  asked.length = 0;
  await installEngine(E, readLock(E), { baseUrl, cache });
  check('a second checkout installs from the cache, nothing downloaded', asked.length === 0 && installedProblems(E, lock).length === 0, asked.join());
  writeFileSync(join(cache, lock.assets['latex.fmt.gz'], 'latex.fmt.gz'), 'damaged');
  const F = repo('f');
  await installEngine(F, readLock(F), { baseUrl, cache });
  check('a damaged cache entry is fetched again', asked.join() === 'latex.fmt.gz' && installedProblems(F, lock).length === 0, asked.join());
  server.close();
}

// the command line, on a scratch copy of the script's repository layout
{
  const G = repo('g');
  mkdirSync(join(G, 'scripts')); mkdirSync(join(G, 'engine/server'), { recursive: true });
  cpSync(join(ROOT, 'scripts/fetch-engine.ts'), join(G, 'scripts/fetch-engine.ts')); cpSync(join(ROOT, 'scripts/engine-stamp.ts'), join(G, 'scripts/engine-stamp.ts'));
  cpSync(join(ROOT, 'engine/server/bundle.ts'), join(G, 'engine/server/bundle.ts'));
  const run = (...a: string[]) => { try { return { ok: true, out: execFileSync(process.execPath, a, { cwd: G, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { const x = e as { stdout?: string; stderr?: string }; return { ok: false, out: `${x.stdout ?? ''}${x.stderr ?? ''}` }; } };
  check('engine-stamp.ts before the install: exit 1', !run('scripts/engine-stamp.ts').ok);
  const r = run('scripts/fetch-engine.ts', '--from', relDir);
  check('fetch-engine.ts --from <dir>: installs', r.ok && /installed example\/engine reflow-test/.test(r.out), r.out);
  check('fetch-engine.ts again: nothing to do', /is installed/.test(run('scripts/fetch-engine.ts', '--from', relDir).out));
  check('engine-stamp.ts after it: exit 0', run('scripts/engine-stamp.ts').ok);
  check('fetch-engine.ts with an unknown option: usage, exit 2', /usage/.test(run('scripts/fetch-engine.ts', '--frm', relDir).out));
}

// ── the real lock
{
  let l: Lock | null = null;
  try { l = readLock(ROOT); } catch (e) { check('engine/reflow-tectonic.json reads', false, (e as Error).message); }
  if (l) check('engine/reflow-tectonic.json: radek-p/reflow-tectonic, a reflow-* tag, the five assets', l.repository === 'radek-p/reflow-tectonic' && /^reflow-/.test(l.tag) && ASSETS.every((a) => /^[0-9a-f]{64}$/.test(l.assets[a])));
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
