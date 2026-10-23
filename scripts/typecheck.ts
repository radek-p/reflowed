// Types: tsc --strict over the TypeScript the store, io, refs, bib, nesting and the workbench are
// written in (erasable syntax: Node and esbuild run it as is, so nothing else checks the types),
// and // @ts-check JavaScript of the engine's page side. TypeScript is web/'s dev dependency.
//
//   node scripts/typecheck.ts          (0: clean; the errors otherwise)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(HERE, 'app/node_modules/.bin/tsc');
const COMMON = ['--noEmit', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2022,dom,dom.iterable', '--skipLibCheck'];
// every TypeScript module of the editor, strict: found here, not listed (a hand-kept list
// was one more file every branch edited). Left out: unit tests (*.test.ts: Node runs them, with Node's types), dev/
// tools, declarations, and NOT_STRICT_YET, which only shrinks (test-arch-units checks that every entry still exists).
// The JavaScript they import is read for its types, not checked.
const NOT_STRICT_YET = ['src/perf/splice.ts', 'src/perf/summary.ts', 'src/lua-dev/blocks.ts'];
const EDITOR_TS = (readdirSync(join(HERE, 'app/src'), { recursive: true }) as string[]).map((p) => `src/${p.split('\\').join('/')}`)
  .filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.endsWith('.test.ts') && !p.split('/').includes('dev') && !NOT_STRICT_YET.includes(p)).sort();
// every JavaScript module of the editor, for names that are not defined only (TS2304, TS2552): a helper moved
// to a module and one copy's last use left behind is a ReferenceError at run time (motion/flip.js re-exported reduced()
// without importing it, and every stacked open threw). The rest of a JS file's types are its own run's, when it has one.
const EDITOR_JS = (readdirSync(join(HERE, 'app/src'), { recursive: true }) as string[]).map((p) => `src/${p.split('\\').join('/')}`)
  .filter((p) => p.endsWith('.js') && !p.split('/').includes('dev') && !p.split('/').includes('vendor')).sort();
// loading/: every TypeScript module of the page's file loading, strict (found here, not listed; its unit
// test is Node's)
const LOADING_TS = readdirSync(join(HERE, 'loading')).filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts')).sort();
const runs: { name: string; cwd: string; args: string[]; only?: RegExp; codes?: RegExp }[] = [
  { name: 'loading/ (strict)', cwd: join(HERE, 'loading'), args: [...COMMON, '--strict', '--allowImportingTsExtensions', ...LOADING_TS] },
  // the intro's two versions (the seed's and the website's selection; no imports)
  { name: 'samples/intro/variants.ts (strict)', cwd: join(HERE, 'samples/intro'), args: [...COMMON, '--strict', 'variants.ts'] },
  { name: 'web: store, io, refs, bib, nesting, meta (strict)', cwd: join(HERE, 'app'),
    args: [...COMMON, '--strict', '--allowImportingTsExtensions', 'src/store/api.ts', 'src/store/repair.suite.ts', 'src/io/api.ts', 'src/io/damaged.suite.ts',
      'src/refs/index.ts', 'src/bib/bbl.ts', 'src/bib/bibtex.ts', 'src/bib/library.ts', 'src/nesting/model.ts', 'src/nesting/tree.ts', 'src/nesting/settings.ts', 'src/meta/write.ts', 'src/meta/import.ts', 'src/meta/compile.ts', 'src/meta/edit.ts', 'src/meta/plain.ts', 'src/meta/text.ts', 'src/tex/text.ts'] },
  // the page side of the engine: JavaScript with // @ts-check; the modules it imports lazily (the store,
  // the figure editor) are checked on their own terms, so only this directory's errors count
  { name: 'engine/web (checkJs)', cwd: join(HERE, 'engine'), only: /^web\//,
    args: [...COMMON, '--allowJs', '--checkJs', '--allowImportingTsExtensions', 'web/backend.js', 'web/idb-cache.js', 'web/key.js', 'web/spacing.ts'] },
  // the document model: JavaScript with // @ts-check, its own errors only
  { name: 'web: doc/, commands/, app/doc-host.js, app/test-api.js (checkJs)', cwd: join(HERE, 'app'), only: /^src\/(doc\/|commands\/|app\/doc-host\.js|app\/test-api\.js)/,
    args: [...COMMON, '--allowJs', '--checkJs', '--allowImportingTsExtensions', 'src/doc/index.js', 'src/commands/index.js', 'src/app/doc-host.js', 'src/app/test-api.js'] },
  // the workbench: all TypeScript, strict (workbench/tsconfig.json: src/ and demo/, with noUncheckedIndexedAccess;
  // tsconfig.tests.json: its tests and scripts); only its own errors count (a script imports engine/pictures' reader)
  { name: 'workbench: src, demo (strict)', cwd: join(HERE, 'workbench'), only: /^(src|demo|types)\//, args: ['-p', 'tsconfig.json'] },
  { name: 'workbench: tests, scripts (strict)', cwd: join(HERE, 'workbench'), only: /^(scripts|tests|types)\//, args: ['-p', 'tsconfig.tests.json'] },
  // the editor's container and the panes, in TypeScript (strict); the JavaScript they import is read for its
  // types, not checked (its own run, when it has one), so only these files' errors count
  { name: 'web: the editor\'s container, mount, panes, views and panels (strict)', cwd: join(HERE, 'app'), only: new RegExp(`^(${EDITOR_TS.map((f) => f.replace(/[.]/g, '\\.')).join('|')})`),
    args: [...COMMON, '--strict', '--allowJs', '--allowImportingTsExtensions', 'src/rtx-modules.d.ts', ...EDITOR_TS] },
  { name: 'web: every JavaScript module, undefined names (checkJs)', cwd: join(HERE, 'app'), only: /^src\//, codes: /error TS(2304|2552):/,
    args: [...COMMON, '--allowJs', '--checkJs', '--allowImportingTsExtensions', 'src/rtx-modules.d.ts', ...EDITOR_JS] },
];
let bad = 0;
for (const r of runs) {
  const p = spawnSync(process.execPath, [TSC, ...r.args], { cwd: r.cwd, encoding: 'utf8' });
  const lines = (p.stdout + p.stderr).split('\n').filter((l) => /error TS/.test(l));
  const mine = (r.only ? lines.filter((l) => r.only!.test(l)) : lines).filter((l) => !r.codes || r.codes.test(l));
  console.log(`${mine.length ? 'FAIL' : 'ok  '} ${r.name}${mine.length ? `: ${mine.length} errors` : ''}`);
  for (const l of mine.slice(0, 40)) console.log(`     ${l}`);
  bad += mine.length ? 1 : 0;
}
console.log(`\n${runs.length - bad}/${runs.length} passed`);
process.exit(bad ? 1 : 0);
