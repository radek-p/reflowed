// The release build's engine check (scripts/build.ts): the engine in engine/dist/async (tectonic.mjs,
// tectonic_wasm.wasm, STAMP.txt) and the format engine/api/formats/latex.fmt are the ones the lock,
// engine/reflow-tectonic.json, names, as scripts/fetch-engine.ts installed them. They are not in git, so a change
// of the lock (a merge) leaves the old engine here until fetch-engine runs again. The TeX tree is not checked: a
// release does not carry it.
//
//   node scripts/engine-stamp.ts [repository root]      exit 1 on a problem (says which)
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedProblems, readLock } from './fetch-engine.ts';

/** null when the installed engine and format are the lock's; else what differs, and what to run */
export function stampProblem(root: string): string | null {
  const p = installedProblems(root, readLock(root), { tree: false });
  return p.length ? `the engine is not the one engine/reflow-tectonic.json names (${p.join('; ')}): run node scripts/fetch-engine.ts` : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const p = stampProblem(root);
  console.log(p ?? `engine ok: ${readLock(root).tag}, as engine/reflow-tectonic.json names it`);
  process.exit(p ? 1 : 0);
}
