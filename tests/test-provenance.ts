// are recorded; a release refuses a public checkout that is not on main or has changes.
//   node tests/test-provenance.ts [dist/reflowtex-editor-unbaked.html]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provenance, publicProblem, generatorOf } from '../scripts/lib/provenance.ts';
import { EDITOR } from '../scripts/lib/app-bundle.ts';

let n = 0, bad = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

// the reflowtex checkout the website workflow places at the repository's root is ignored, not a change to the source
let ignored = false;
try { execFileSync('git', ['-C', EDITOR, 'check-ignore', '-q', 'reflowtex/package.json']); ignored = true; } catch { /* not ignored */ }
check('a reflowtex checkout inside the tree (the website workflow\'s) is not a change to the source', ignored);

// a throwaway public repo: on main and clean, on a branch, dirty
const g = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsmonitor=false', '-C', dir, ...a], { stdio: 'ignore', timeout: 20000 });
const pub = mkdtempSync(join(tmpdir(), 'rtx-pub-'));
g(pub, 'init', '-q', '-b', 'main'); writeFileSync(join(pub, 'a.txt'), 'a');
g(pub, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'); g(pub, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a');
const files = { wasm: join(EDITOR, 'engine/dist/async/tectonic_wasm.wasm'), fmt: join(EDITOR, 'engine/api/formats/latex.fmt'), bundleUrl: 'https://example.invalid/bundle.tar' };
const p1 = provenance({ tc: join(EDITOR, '..'), pub, ...files });
check('recorded: public rev, branch, clean; wasm and format sha256; bundle URL', /^[0-9a-f]{40}$/.test(p1.public.rev) && p1.public.branch === 'main' && p1.public.dirty === false
  && /^[0-9a-f]{64}$/.test(p1.wasmSha256) && /^[0-9a-f]{64}$/.test(p1.fmtSha256) && p1.bundleUrl === files.bundleUrl, p1);
check('the source: a commit (git, or RTX_LAB_REV) and a dirty flag', p1.lab.rev !== '' && (p1.lab.rev === 'unknown' ? !process.env.RTX_LAB_REV : true), p1.lab);
check('public on main and clean: a release may be built', publicProblem(p1) === null);
writeFileSync(join(pub, 'a.txt'), 'changed');
check('public with changes: refused', /uncommitted/.test(publicProblem(provenance({ tc: EDITOR, pub, ...files })) ?? ''));
g(pub, 'checkout', '-q', '.'); g(pub, 'checkout', '-q', '-b', 'fix/x');
check('public on a branch: refused', /fix\/x, not main/.test(publicProblem(provenance({ tc: EDITOR, pub, ...files })) ?? ''));
check('the generator names source, public, engine and wasm', /source .*public [0-9a-f]{10} \(fix\/x\), engine e1, wasm [0-9a-f]{10}/.test(generatorOf('poc', 'e1', provenance({ tc: EDITOR, pub, ...files }))));
// a built file carries it
const built = process.argv[2] ?? join(EDITOR, 'dist/reflowtex-editor-unbaked.html');
if (existsSync(built.replace(/\.html$/, '.json'))) {
  const st = JSON.parse(readFileSync(built.replace(/\.html$/, '.json'), 'utf8'));
  check(`${built.split('/').pop()}: its .json has the provenance`, !!st.provenance?.public?.rev && !!st.provenance?.wasmSha256 && !!st.provenance?.bundleUrl, st.provenance);
  check(`${built.split('/').pop()}: <meta name="generator"> names the commits`, /<meta name="generator" content="reflowtex editor [^"]*source [^"]*public [0-9a-f]{10}/.test(readFileSync(built, 'utf8').slice(0, 400000)));
}
console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
