// Is engine/dist/editor-worker.js built from the TeX files it should carry? The worker bundles the editor's own
// packages (build-worker.ts extraTexFiles: rtx-numbering.sty, rtx-xetex.sty, …); engine/dist is not in git, so a
// checkout that gets a newer .sty (a merge) keeps serving the older worker until build-worker.ts runs again, and
// the page silently typesets with the old package.
//
//   workerProblem(workerPath?) -> null | 'what is stale, and the command that fixes it'
//
// build-worker.ts writes a stamp of those files (a hash, texStamp()) at the top of the bundle; it must be today's.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extraTexFiles, texStamp } from './build-worker.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');

export function workerProblem(workerPath = join(HERE, 'dist/editor-worker.js')): string | null {
  if (!existsSync(workerPath)) return `${workerPath} is not built (node engine/scripts/build-worker.ts)`;
  const head = readFileSync(workerPath, 'utf8').slice(0, 200);
  const had = /rtx-tex:[0-9a-f]{16}/.exec(head)?.[0] ?? null;
  if (had === texStamp()) return null;
  // which files changed is not known from a hash: name the editor's own packages
  const stale = [had ? `built with other versions of ${Object.keys(extraTexFiles()).join(', ')}` : 'built before the TeX stamp (2026-10-05)'];
  return stale.length ? `the worker is older than its TeX files: ${stale.join('; ')}; rebuild it: node engine/scripts/build-worker.ts` : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = workerProblem();
  console.log(p ? `STALE: ${p}` : 'the worker carries the current TeX files');
  process.exit(p ? 1 : 0);
}
