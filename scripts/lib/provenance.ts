// hashes, the TeX bundle URL. Written into the release's .json and its <meta name="generator">.
//
//   provenance({ tc, pub, wasm, fmt, bundleUrl }) -> Provenance
//   publicProblem(p) -> string | null   a release needs the public checkout on main and clean
//
// RTX_LAB_REV and RTX_LAB_DIRTY, when set, give the source revision and its count of changed files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface Repo { rev: string; branch: string; dirty: boolean | null }
export interface Provenance { lab: Repo; public: Repo; wasmSha256: string; fmtSha256: string; bundleUrl: string }

const git = (dir: string, ...a: string[]): string | null => {
  try { return execFileSync('git', ['-c', `safe.directory=${dir}`, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', '-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim(); } catch { return null; }
};
function repo(dir: string, envRev?: string, envDirty?: string): Repo {
  const rev = git(dir, 'rev-parse', 'HEAD');
  if (rev) {
    const st = git(dir, 'status', '--porcelain', '--', '.', ':!*/test-results/*');
    return { rev, branch: git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') ?? '?', dirty: st === null ? null : st.length > 0 };
  }
  return { rev: envRev || 'unknown', branch: '?', dirty: envDirty === undefined || envDirty === '' ? null : envDirty !== '0' };
}
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function provenance(o: { tc: string; pub: string; wasm: string; fmt: string; bundleUrl: string }): Provenance {
  return {
    lab: repo(o.tc, process.env.RTX_LAB_REV, process.env.RTX_LAB_DIRTY),
    public: repo(o.pub),
    wasmSha256: sha(o.wasm), fmtSha256: sha(o.fmt), bundleUrl: o.bundleUrl,
  };
}

export function publicProblem(p: Provenance): string | null {
  if (p.public.rev === 'unknown') return 'the public checkout\'s commit cannot be read';
  if (p.public.branch !== 'main') return `the public checkout is on ${p.public.branch}, not main`;
  if (p.public.dirty) return 'the public checkout has uncommitted changes';
  return null;
}

export const generatorOf = (version: string, engine: string, p: Provenance) =>
  `reflowtex editor ${version} (source ${p.lab.rev.slice(0, 10)}${p.lab.dirty ? '+dirty' : ''}), public ${p.public.rev.slice(0, 10)}${p.public.dirty ? '+dirty' : ''} (${p.public.branch}), engine ${engine}, wasm ${p.wasmSha256.slice(0, 10)}`;
