// Bundle src/worker.ts into ONE classic worker script: dist/editor-worker.js
// (esbuild IIFE; a blob: URL starts it on a file:// page): the public encoder on
// ../encode's shims, the editor engine's Asyncify glue
// (dist/async/tectonic.mjs, bundled, and again as text for the Asyncify
// export names), and the TeX files the engine needs that are not in the
// bundle (virtual:extra-tex-files).
//     node scripts/build-worker.ts
import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ensureConvertSrc } from './convert-src.ts';
import { BUILD_PLACEHOLDER, engineBuildId, type BuildIdInputs } from './engine-build-id.ts';
import { TIER_FILES } from './tiers.ts';
import { publicRepo } from '../../scripts/lib/public-repo.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');     // engine/
const EDITOR = join(HERE, '..');
const TC = EDITOR;                    // the repository root
const PUB = publicRepo();
const EB = join(TC, 'engine/encode');
const shim = (f: string) => join(EB, 'src/shims', f);
const OUT = join(HERE, 'dist/editor-worker.js');

const listFile = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && !s.startsWith('#')) : []);
/** TeX files that are not in Tectonic's bundle, packed as they are (tex/: lipics-v2021 and its logos; .sty files there are extra files instead). */
export const LOCAL_TEX_DIR = join(HERE, 'tex');
export const localTexFiles = (): string[] => (existsSync(LOCAL_TEX_DIR) ? readdirSync(LOCAL_TEX_DIR).filter((f) => !f.endsWith('.sty')).sort() : []);

/** The list files of the embedded TeX set: the recorded working set (scripts/record.ts: the paper, the samples, the
 *  tier documents of scripts/tiers.ts), the v1 file's (working-set-v1.txt, from standalone/) and working-set-add.txt. */
export const WORKING_SET_LISTS = ['working-set.txt', 'working-set-v1.txt', 'working-set-add.txt'].map((f) => join(HERE, f));
/** The embedded TeX set (scripts/build.ts packs it): the names in WORKING_SET_LISTS and TIER_FILES. */
export function workingSetNames(): string[] {
  return [...new Set([...WORKING_SET_LISTS.flatMap(listFile), ...TIER_FILES[1], ...TIER_FILES[2]])].sort();
}

/** The TeX files a block document may load that are not in Tectonic's bundle. */
export function extraTexFiles(): Record<string, string> {
  const compat = readFileSync(join(HERE, 'src/reflowtex-compat.tex'), 'utf8');   // (layout) a copy of standalone/src/reflowtex-compat.tex
  const sty = readFileSync(join(PUB, 'src/latex/reflowtex.sty'), 'utf8');
  const at = sty.indexOf('\n', sty.indexOf('\\ProvidesPackage{reflowtex}')) + 1;
  if (at <= 0) throw new Error('reflowtex.sty: no \\ProvidesPackage{reflowtex}');
  const out: Record<string, string> = {
    // engine-api's template-parity package under the capture's usual name
    'tectonic-capture.sty': readFileSync(join(TC, 'engine/api/tex/rtx-template.sty'), 'utf8')
      .replace('\\ProvidesPackage{rtx-template}', '\\ProvidesPackage{tectonic-capture}'),
    'reflowtex.sty': sty.slice(0, at) + compat + sty.slice(at),
    'reflowtex-lean.sty': readFileSync(join(PUB, 'src/latex/reflowtex-lean.sty'), 'utf8'),
    'rtx-pictures.sty': readFileSync(join(HERE, 'tex/rtx-pictures.sty'), 'utf8'),
  };
  for (const [name, path] of [['rtx-xetex.sty', join(EDITOR, 'tex/rtx-xetex.sty')],
    ['rtx-tfm-unicode.sty', join(EDITOR, 'tex/rtx-tfm-unicode.sty')],
    ['rtx-notes.sty', join(EDITOR, 'tex/rtx-notes.sty')], ['reflowed-meta.sty', join(EDITOR, 'tex/reflowed-meta.sty')],   // the title data
    ['rtx-numbering.sty', join(EDITOR, 'tex/rtx-numbering.sty')]])
    if (existsSync(path)) out[name] = readFileSync(path, 'utf8');
  return out;
}

/** a stamp of the editor TeX files the worker carries (engine/scripts/worker-current.ts reads it) */
export const texStamp = () => `rtx-tex:${createHash('sha256').update(JSON.stringify(extraTexFiles())).digest('hex').slice(0, 16)}`;

/** What the engine build id is made of besides the bundled sources (engine-build-id.ts). */
export function buildIdInputs(bundled: string[], absWorkingDir: string): BuildIdInputs {
  return {
    bundled, absWorkingDir,
    files: [join(HERE, 'dist/async/tectonic_wasm.wasm'), join(HERE, 'dist/async/tectonic.mjs'), join(TC, 'engine/api/formats/latex.fmt'),
      ...localTexFiles().map((f) => join(LOCAL_TEX_DIR, f))],
    // the embedded TeX set: a file added or removed changes what a block gives (a missing-file error)
    texts: [workingSetNames().join('\n'), JSON.stringify(extraTexFiles())],
  };
}

const plugins: esbuild.Plugin[] = [
  { name: 'pub', setup(b) { b.onResolve({ filter: /^@pub\// }, (a) => ({ path: join(PUB, a.path.slice(5)) })); } },
  // the encoder's shims reach the public repo by a relative path (../../../../../reflowtex/…, right from the main
  {
    name: 'pub-relative',
    setup(b) {
      b.onResolve({ filter: /^(\.\.\/)+reflowtex\/src\// }, (a) => {
        const at = join(a.resolveDir, a.path);
        return existsSync(at) ? undefined : { path: join(PUB, a.path.replace(/^(\.\.\/)+reflowtex\//, '')) };
      });
    },
  },
  {
    name: 'virtual',
    setup(b) {
      b.onResolve({ filter: /^virtual:(extra-tex-files|glue)$/ }, (a) => ({ path: a.path.slice(8), namespace: 'virtual' }));
      b.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => (a.path === 'glue'
        ? { contents: readFileSync(join(HERE, 'dist/async/tectonic.mjs'), 'utf8'), loader: 'text' }
        : { contents: JSON.stringify(extraTexFiles()), loader: 'json' }));
    },
  },
  {
    name: 'svg-pictures',
    setup(b) {
      b.onResolve({ filter: /^\.\/pictures\.ts$/ }, (a) => (a.importer === join(PUB, 'src/pipeline/pipeline.ts') ? { path: shim('pictures.ts') } : undefined));
    },
  },
  {
    name: 'public-import-meta',
    setup(b) {
      b.onLoad({ filter: /\.ts$/ }, (a) => {
        if (!a.path.startsWith(PUB + '/')) return undefined;
        const url = `file:///reflowtex/${relative(PUB, a.path)}`;
        const src = readFileSync(a.path, 'utf8').replaceAll('import.meta.url', JSON.stringify(url)).replaceAll('import.meta.main', 'false');
        return { contents: src, loader: 'ts', resolveDir: dirname(a.path) };
      });
    },
  },
];

export async function buildWorker(): Promise<{ path: string; build: string; bytes: number; read: string[] }> {
  mkdirSync(dirname(OUT), { recursive: true });
  ensureConvertSrc();
  // the id is known only once the bundle's inputs are (its metafile): a placeholder first
  const res = await esbuild.build({
    metafile: true,
    entryPoints: [join(HERE, 'src/worker.ts')],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
    outfile: OUT, minify: true, logLevel: 'error', legalComments: 'none',
    banner: { js: `/*${texStamp()}*/` },            // what worker-current.ts compares: the TeX files it was built with
    nodePaths: [join(EB, 'node_modules')],
    inject: [shim('globals.ts')],
    loader: { '.sty': 'text', '.proto': 'text', '.tex': 'text' },
    external: ['module'],
    define: { 'import.meta.url': '"file:///editor-worker.js"', ENGINE_BUILD: JSON.stringify(BUILD_PLACEHOLDER) },
    alias: {
      'node:fs': shim('fs.ts'), 'node:crypto': shim('crypto.ts'), 'node:child_process': shim('child_process.ts'),
      'node:url': shim('misc.ts'), 'node:os': shim('misc.ts'), 'node:util': shim('misc.ts'),
      'node:module': shim('misc.ts'), 'node:zlib': shim('misc.ts'),
      // an absolute path: a bare 'path-browserify' resolved from the cwd (engine/ or encode-browser's copy), so the
      // build id depended on where the build ran
      'node:path': join(EB, 'node_modules/path-browserify/index.js'),
      'speech-rule-engine': shim('sre-stub.ts'), 'protobufjs': shim('protobufjs.ts'),
    },
    plugins,
  });
  const { id: build, read } = engineBuildId(buildIdInputs(Object.keys(res.metafile!.inputs), process.cwd()));
  const text = readFileSync(OUT, 'utf8');
  if (!text.includes(BUILD_PLACEHOLDER)) throw new Error('build-worker: ENGINE_BUILD placeholder not in the bundle');
  writeFileSync(OUT, text.replaceAll(BUILD_PLACEHOLDER, build));
  return { path: OUT, build, bytes: Buffer.byteLength(text.replaceAll(BUILD_PLACEHOLDER, build)), read };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await buildWorker();
  const js = readFileSync(r.path);
  console.log(`dist/editor-worker.js ${(js.length / 1024).toFixed(0)} KB (${(gzipSync(js).length / 1024).toFixed(0)} KB gz), build ${r.build}; `
    + `extra TeX files: ${Object.keys(extraTexFiles()).join(', ')}`);
}
