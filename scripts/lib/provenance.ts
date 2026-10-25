// What a release is built from: the source's commit, the public reflowtex checkout's commit (and the one
// reflowtex.lock.json names), the engine's and the format's hashes, the TeX bundle URL. Written into the release's
// .json and its <meta name="generator">.
//
//   provenance({ tc, pub, lock, publicAny, wasm, fmt, bundleUrl }) -> Provenance
//   publicProblem(p) -> string | null   a release needs the public checkout at the locked commit, with no changes
//   lockedProblem(repo, commit)         the same rule for any checkout (scripts/lock-reflowtex.ts --check)
//   repo(dir) -> Repo                   a checkout's commit, branch ('HEAD' when detached) and changes
//
// RTX_LAB_REV and RTX_LAB_DIRTY, when set, give the source revision and its count of changed files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface Repo { rev: string; branch: string; dirty: boolean | null }
export interface Provenance {
  lab: Repo; public: Repo;
  /** the reflowtex commit reflowtex.lock.json names */
  publicLock: string;
  /** built with --public-any: a public checkout other than the lock's was allowed */
  publicAny: boolean;
  wasmSha256: string; fmtSha256: string; bundleUrl: string;
}

export const git = (dir: string, ...a: string[]): string | null => {
  try { return execFileSync('git', ['-c', `safe.directory=${dir}`, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', '-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim(); } catch { return null; }
};
export function repo(dir: string, envRev?: string, envDirty?: string): Repo {
  const rev = git(dir, 'rev-parse', 'HEAD');
  if (rev) {
    const st = git(dir, 'status', '--porcelain', '--', '.', ':!*/test-results/*');
    return { rev, branch: git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') ?? '?', dirty: st === null ? null : st.length > 0 };
  }
  return { rev: envRev || 'unknown', branch: '?', dirty: envDirty === undefined || envDirty === '' ? null : envDirty !== '0' };
}
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function provenance(o: { tc: string; pub: string; lock: string; publicAny?: boolean; wasm: string; fmt: string; bundleUrl: string }): Provenance {
  return {
    lab: repo(o.tc, process.env.RTX_LAB_REV, process.env.RTX_LAB_DIRTY),
    public: repo(o.pub), publicLock: o.lock, publicAny: !!o.publicAny,
    wasmSha256: sha(o.wasm), fmtSha256: sha(o.fmt), bundleUrl: o.bundleUrl,
  };
}

/** null when the checkout is at the locked commit with no changes (a branch or a detached HEAD alike) */
export function lockedProblem(r: Repo, commit: string): string | null {
  if (r.rev === 'unknown') return 'the public checkout\'s commit cannot be read';
  if (r.rev !== commit) return `the public checkout is at ${r.rev} (${r.branch}), not at ${commit}, the commit reflowtex.lock.json names`;
  if (r.dirty) return 'the public checkout has uncommitted changes';
  return null;
}
export const publicProblem = (p: Provenance): string | null => lockedProblem(p.public, p.publicLock);

export const generatorOf = (version: string, engine: string, p: Provenance) =>
  `reflowtex editor ${version} (source ${p.lab.rev.slice(0, 10)}${p.lab.dirty ? '+dirty' : ''}), public ${p.public.rev.slice(0, 10)}${p.public.dirty ? '+dirty' : ''} (${p.public.rev === p.publicLock ? 'locked' : `not the locked ${p.publicLock.slice(0, 10)}${p.publicAny ? ', --public-any' : ''}`}), engine ${engine}, wasm ${p.wasmSha256.slice(0, 10)}`;
