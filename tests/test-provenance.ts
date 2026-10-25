// The release's provenance (scripts/lib/provenance.ts) and the reflowtex lock (scripts/lock-reflowtex.ts): the
// source's and the public checkout's commits, the engine's hashes and the bundle URL are recorded; a release refuses a
// public checkout that is not at the commit reflowtex.lock.json names, or has changes; the bump script's checks; the
// website workflow checks out the locked commit. On scratch repositories, and the real lock.
//   node tests/test-provenance.ts [dist/reflowtex-editor-unbaked.html]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provenance, publicProblem, generatorOf, lockedProblem, repo } from '../scripts/lib/provenance.ts';
import { LOCK, lockCheck, readReflowtexLock, writeReflowtexLock } from '../scripts/lock-reflowtex.ts';
import { publicRepo } from '../scripts/lib/public-repo.ts';
import { EDITOR } from '../scripts/lib/app-bundle.ts';

let n = 0, bad = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const thrown = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return (e as Error).message; } };

// the reflowtex checkout the website workflow places at the repository's root is ignored, not a change to the source
let ignored = false;
try { execFileSync('git', ['-C', EDITOR, 'check-ignore', '-q', 'reflowtex/package.json']); ignored = true; } catch { /* not ignored */ }
check('a reflowtex checkout inside the tree (the website workflow\'s) is not a change to the source', ignored);

// ── the real lock, and the checkout these tests run with
const lock = readReflowtexLock(EDITOR);
check(`${LOCK}: a repository (owner/name) and a full commit`, /^[\w.-]+\/[\w.-]+$/.test(lock.repository) && /^[0-9a-f]{40}$/.test(lock.commit), lock);
const here = lockedProblem(repo(publicRepo()), lock.commit);
console.log(`note: the reflowtex checkout here (${publicRepo()}): ${here ?? 'at the locked commit'}`);

// ── a throwaway public repo with two commits on main, a tag on the first; the lock names the first
const g = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'advice.detachedHead=false', '-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
const pub = mkdtempSync(join(tmpdir(), 'rtx-pub-'));
g(pub, 'init', '-q', '-b', 'main'); writeFileSync(join(pub, 'a.txt'), 'a');
g(pub, 'add', '.'); g(pub, 'commit', '-qm', 'a'); g(pub, 'tag', '-a', 'v1', '-m', 'v1');
const A = g(pub, 'rev-parse', 'HEAD');
writeFileSync(join(pub, 'a.txt'), 'b'); g(pub, 'commit', '-qam', 'b');
const B = g(pub, 'rev-parse', 'HEAD');
g(pub, 'checkout', '-q', '-B', 'main', A);
const files = { wasm: join(EDITOR, 'engine/dist/async/tectonic_wasm.wasm'), fmt: join(EDITOR, 'engine/api/formats/latex.fmt'), bundleUrl: 'https://example.invalid/bundle.tar' };
const prov = (more: { publicAny?: boolean } = {}) => provenance({ tc: EDITOR, pub, lock: A, ...files, ...more });

const p1 = prov();
check('recorded: public rev, branch, clean, the locked commit; wasm and format sha256; bundle URL', p1.public.rev === A && p1.public.branch === 'main' && p1.public.dirty === false
  && p1.publicLock === A && p1.publicAny === false && /^[0-9a-f]{64}$/.test(p1.wasmSha256) && /^[0-9a-f]{64}$/.test(p1.fmtSha256) && p1.bundleUrl === files.bundleUrl, p1);
check('the source: a commit (git, or RTX_LAB_REV) and a dirty flag', p1.lab.rev !== '' && (p1.lab.rev === 'unknown' ? !process.env.RTX_LAB_REV : true), p1.lab);
check('public at the locked commit, clean: a release may be built', publicProblem(p1) === null, publicProblem(p1));
check('the generator names source, public (locked), engine and wasm', /source .*public [0-9a-f]{10} \(locked\), engine e1, wasm [0-9a-f]{10}/.test(generatorOf('poc', 'e1', p1)), generatorOf('poc', 'e1', p1));
writeFileSync(join(pub, 'a.txt'), 'changed');
check('public at the locked commit with changes: refused', /uncommitted/.test(publicProblem(prov()) ?? ''), publicProblem(prov()));
g(pub, 'checkout', '-q', '.');
g(pub, 'checkout', '-q', '-B', 'main', B);
const other = publicProblem(prov());
check('public at another commit (main moved on): refused, naming both', !!other && other.includes(A) && other.includes(B), other);
check('the generator says it is not the locked commit, and --public-any when it was given', new RegExp(`public ${B.slice(0, 10)} \\(not the locked ${A.slice(0, 10)}, --public-any\\)`).test(generatorOf('poc', 'e1', prov({ publicAny: true }))) && prov({ publicAny: true }).publicAny, generatorOf('poc', 'e1', prov({ publicAny: true })));
g(pub, 'checkout', '-q', '--detach', A);
const det = prov();
check('a detached HEAD at the locked commit (a CI checkout of a commit): may be built', det.public.branch === 'HEAD' && publicProblem(det) === null, { det: det.public, problem: publicProblem(det) });
g(pub, 'checkout', '-q', '-b', 'fix/x', A);
check('a branch other than main at the locked commit: may be built (the commit is the rule, not the branch)', publicProblem(prov()) === null, publicProblem(prov()));
check('a checkout whose commit cannot be read: refused', /cannot be read/.test(lockedProblem({ rev: 'unknown', branch: '?', dirty: null }, A) ?? ''));

// ── the bump script's checks (lockCheck) and the lock's reader and writer
const notGit = mkdtempSync(join(tmpdir(), 'rtx-nogit-'));
const c = (dir: string, rev?: string) => lockCheck(dir, rev);
const r0 = c(notGit);
check('lock: a directory that is not a git checkout is refused', !r0.ok && /not a git checkout/.test(r0.problem), r0);
const r1 = c(pub);
check('lock: HEAD resolved to its full commit, the checkout\'s HEAD beside it', r1.ok && r1.commit === A && r1.head === A, r1);
const r2 = c(pub, 'v1');
check('lock: a tag (annotated) resolved to its commit', r2.ok && r2.commit === A, r2);
const r3 = c(pub, B.slice(0, 8));
check('lock: a short hash resolved; the checkout is somewhere else (head says where)', r3.ok && r3.commit === B && r3.head === A, r3);
const r4 = c(pub, 'no-such-ref');
check('lock: a commit the checkout does not have is refused', !r4.ok && /no commit no-such-ref/.test(r4.problem), r4);
const r5 = c(pub, '--all');
check('lock: an option for a commit is refused', !r5.ok, r5);
writeFileSync(join(pub, 'b.txt'), 'untracked');
const r6 = c(pub);
check('lock: a checkout with changes (an untracked file) is refused', !r6.ok && /uncommitted/.test(r6.problem), r6);
rmSync(join(pub, 'b.txt'));
check('lock: a commit no remote branch contains is flagged (not on GitHub, the workflow could not fetch it)', r1.ok && !r1.onRemote, r1);
const clone = mkdtempSync(join(tmpdir(), 'rtx-clone-'));
execFileSync('git', ['clone', '-q', pub, clone], { stdio: 'ignore' });
const r7 = c(clone, A);
check('lock: a commit a remote branch contains is not flagged', r7.ok && r7.onRemote, r7);

const root = mkdtempSync(join(tmpdir(), 'rtx-lock-'));
writeReflowtexLock(root, { repository: 'radek-p/reflowtex', commit: A });
check('lock: written and read back', JSON.stringify(readReflowtexLock(root)) === JSON.stringify({ repository: 'radek-p/reflowtex', commit: A }) && readFileSync(join(root, LOCK), 'utf8').endsWith('}\n'));
writeFileSync(join(root, LOCK), JSON.stringify({ repository: 'radek-p/reflowtex', commit: A.slice(0, 12) }));
check('lock: a short commit is refused when read', /40 hex/.test(thrown(() => readReflowtexLock(root))));
writeFileSync(join(root, LOCK), JSON.stringify({ repository: 'https://github.com/radek-p/reflowtex', commit: A }));
check('lock: a repository that is not owner/name is refused when read', /owner\/name/.test(thrown(() => readReflowtexLock(root))));

// --check, from the command line: the throwaway checkout is not at the real lock's commit
const cli = spawnSync(process.execPath, [join(EDITOR, 'scripts/lock-reflowtex.ts'), '--check', '--from', pub], { encoding: 'utf8', timeout: 30000 });
check('lock-reflowtex --check: another commit exits 1, naming the locked one', cli.status === 1 && cli.stdout.includes(lock.commit), { status: cli.status, out: cli.stdout, err: cli.stderr });
// --check alone (the checkout from REFLOWTEX): checks, never writes the lock (it once took `--check` for no argument and
// locked the checkout's commit)
{
  const before = readFileSync(join(EDITOR, LOCK), 'utf8');
  const alone = spawnSync(process.execPath, [join(EDITOR, 'scripts/lock-reflowtex.ts'), '--check'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, REFLOWTEX: pub } });
  const after = readFileSync(join(EDITOR, LOCK), 'utf8');
  if (after !== before) writeFileSync(join(EDITOR, LOCK), before);
  check('lock-reflowtex --check alone: exits 1 for another commit and leaves the lock as it was', alone.status === 1 && after === before && alone.stdout.includes(lock.commit), { status: alone.status, out: alone.stdout, changed: after !== before });
}

// ── the website workflow builds with the locked commit, from the lock
const wf = readFileSync(join(EDITOR, '.github/workflows/website.yml'), 'utf8');
check('website.yml: reflowtex checked out at the commit reflowtex.lock.json names, no other ref', wf.includes(LOCK) && /ref: \$\{\{ steps\.reflowtex\.outputs\.commit \}\}/.test(wf) && !/REFLOWTEX_REF/.test(wf));

// a built file carries it
const built = process.argv[2] ?? join(EDITOR, 'dist/reflowtex-editor-unbaked.html');
if (existsSync(built.replace(/\.html$/, '.json'))) {
  const st = JSON.parse(readFileSync(built.replace(/\.html$/, '.json'), 'utf8'));
  check(`${built.split('/').pop()}: its .json has the provenance`, !!st.provenance?.public?.rev && !!st.provenance?.wasmSha256 && !!st.provenance?.bundleUrl, st.provenance);
  check(`${built.split('/').pop()}: <meta name="generator"> names the commits`, /<meta name="generator" content="reflowtex editor [^"]*source [^"]*public [0-9a-f]{10}/.test(readFileSync(built, 'utf8').slice(0, 400000)));
}
console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
