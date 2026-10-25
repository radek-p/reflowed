// reflowtex, the repository ReflowEd builds on (the viewer, the encoder, the companion package, the inspector), is
// pinned as the engine is: reflowtex.lock.json (the lock) names the repository (owner/name on GitHub) and the commit
// every build and test of this commit uses. The release build (scripts/build.ts) refuses a public checkout that is not
// at that commit or has changes (scripts/lib/provenance.ts publicProblem); the website workflow checks that commit out.
// This script writes the lock.
//
//   node scripts/lock-reflowtex.ts                 lock the commit the checkout is at
//   node scripts/lock-reflowtex.ts <commit>        lock <commit> (a hash, a tag or a branch, resolved in the checkout)
//   node scripts/lock-reflowtex.ts --from <dir>    the checkout in <dir>; else REFLOWTEX, else a reflowtex/ beside
//                                                  this checkout (scripts/lib/public-repo.ts)
//   node scripts/lock-reflowtex.ts --check         exit 1 unless the checkout is at the locked commit, with no changes
//
// The commit must be in the checkout, and the checkout must have no changes. Nothing is fetched: the website workflow
// fetches the commit from GitHub, so a commit that no remote branch of the checkout contains is warned about.
//
// As a module: LOCK, readReflowtexLock(root), lockCheck(dir, rev?), writeReflowtexLock(root, lock).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, lockedProblem, repo } from './lib/provenance.ts';

export const LOCK = 'reflowtex.lock.json';
export const REPOSITORY = 'radek-p/reflowtex';
export interface ReflowtexLock { repository: string; commit: string }

const isCommit = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);

/** the lock, checked: a repository owner/name and a full commit hash */
export function readReflowtexLock(root: string): ReflowtexLock {
  const path = join(root, LOCK);
  const j = JSON.parse(readFileSync(path, 'utf8')) as { repository?: unknown; commit?: unknown };
  if (typeof j.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(j.repository)) throw new Error(`${path}: "repository" must be owner/name`);
  if (!isCommit(j.commit)) throw new Error(`${path}: "commit" must be a full commit hash (40 hex digits)`);
  return { repository: j.repository, commit: j.commit };
}

export function writeReflowtexLock(root: string, lock: ReflowtexLock): void {
  writeFileSync(join(root, LOCK), `${JSON.stringify({ repository: lock.repository, commit: lock.commit }, null, 2)}\n`);
}

export type LockCheck =
  | { ok: true; commit: string; head: string; onRemote: boolean }
  | { ok: false; problem: string };

/** what the lock may name from the checkout in dir: rev (default its HEAD) resolved to a commit there, the checkout
 *  with no changes; head is the commit the checkout is at, onRemote whether a remote branch of it contains the commit */
export function lockCheck(dir: string, rev = 'HEAD'): LockCheck {
  const r = repo(dir);
  if (r.rev === 'unknown') return { ok: false, problem: `${dir} is not a git checkout` };
  if (rev.startsWith('-')) return { ok: false, problem: `${rev}: not a commit` };
  const commit = git(dir, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  if (!isCommit(commit)) return { ok: false, problem: `no commit ${rev} in ${dir} (fetch it there first)` };
  if (r.dirty !== false) return { ok: false, problem: `${dir} has uncommitted changes (or its status cannot be read): the lock names a commit, not a working tree` };
  const remote = git(dir, 'branch', '-r', '--contains', commit);
  return { ok: true, commit, head: r.rev, onRemote: !!remote };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);
  const fromAt = argv.indexOf('--from');
  if (fromAt >= 0 && !argv[fromAt + 1]) { console.error('lock-reflowtex: --from needs a directory'); process.exit(2); }
  const { publicRepo } = await import('./lib/public-repo.ts');
  const dir = resolve(fromAt >= 0 ? argv[fromAt + 1] : publicRepo());
  const rest = fromAt < 0 ? argv : argv.filter((a, i) => i !== fromAt && i !== fromAt + 1);
  if (rest.includes('--check')) {
    const lock = readReflowtexLock(root);
    const p = lockedProblem(repo(dir), lock.commit);
    console.log(p ? `lock-reflowtex: ${dir}: ${p}` : `reflowtex ok: ${dir} is at ${lock.commit}, as ${LOCK} names it`);
    process.exit(p ? 1 : 0);
  }
  if (rest.length > 1 || rest.some((a) => a.startsWith('-'))) { console.error('usage: node scripts/lock-reflowtex.ts [<commit>] [--from <dir>] | --check'); process.exit(2); }
  const c = lockCheck(dir, rest[0]);
  if (!c.ok) { console.error(`lock-reflowtex: ${c.problem}`); process.exit(1); }
  let repository = REPOSITORY;
  try { repository = readReflowtexLock(root).repository; } catch { /* no lock yet: the default repository */ }
  writeReflowtexLock(root, { repository, commit: c.commit });
  console.log(`${LOCK}: ${repository} at ${c.commit}`);
  if (c.head !== c.commit) console.log(`  the checkout is at ${c.head}: check the locked commit out before building (git -C ${dir} checkout ${c.commit})`);
  if (!c.onRemote) console.log(`  warning: no remote branch of ${dir} contains it; the website workflow fetches it from github.com/${repository}: push it there`);
}
