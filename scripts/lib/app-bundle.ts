// The app bundle's configuration, one source for every build:
// scripts/build.ts (the release), scripts/w3-build.ts (the dev page), app/src/perf/splice.ts.
// The release and the dev bundle differ only in minification and the source map.
//
//   resolveModules({ allowStubs })  `rtx:<name>` → the module's entry, or app/stubs.js only when
//                                    allowStubs (dev); a release refuses a stub (a stub store is a
//                                    memory store, nothing would persist) and throws MissingModuleError
//   appBuildOptions({ minify, outfile?, allowStubs, sourcemap?, split? }) → { options, which }   esbuild options
//                                    split: an outdir: ES module parts (the multi-file release, scripts/lib/multifile.ts):
//                                    the entry app-<hash>.js, the dynamic imports and shared code as chunks of their own;
//                                    not written (the build names them by esbuild's hash and writes them itself)
//   ENTRIES                          the module table
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicRepo, ensurePublicBundles } from './public-repo.ts';

export const EDITOR = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const WEB = join(EDITOR, 'app'), SRC = join(WEB, 'src');
// the public checkout: the REFLOWTEX env var, else a sibling checkout (scripts/lib/public-repo.ts);
// its companion bundle is built on demand (ensurePublicBundles) before an app build reads it
export const PUB = publicRepo();
export { ensurePublicBundles };

export const ENTRIES: Readonly<Record<string, { files: string[]; parts?: string[] }>> = {
  store: { files: ['store/index.ts', 'store/index.js'] },
  io: { files: ['io/index.ts', 'io/index.js'], parts: ['io/import.ts', 'io/export.ts'] },
  home: { files: ['home/index.ts', 'home/index.js'] },
  refs: { files: ['refs/index.ts', 'refs/index.js'] },
  backend: { files: ['../../engine/web/backend.js', '../../engine/web/backend.ts'] },
};

export class MissingModuleError extends Error {}

export function resolveModules(o: { allowStubs: boolean; src?: string }) {
  const src = o.src ?? SRC;
  const which: Record<string, 'real' | 'stub'> = {};
  const resolved: Record<string, { path?: string; parts?: string[] }> = {};
  for (const [name, e] of Object.entries(ENTRIES)) {
    const f = e.files.map((q) => join(src, q)).find((q) => existsSync(q));
    const parts = e.parts?.map((q) => join(src, q));
    if (f) { resolved[name] = { path: f }; which[name] = 'real'; }
    else if (parts && parts.every((q) => existsSync(q))) { resolved[name] = { parts }; which[name] = 'real'; }
    else { resolved[name] = { path: join(src, 'app/stubs.js') }; which[name] = 'stub'; }
  }
  const stubs = Object.keys(which).filter((k) => which[k] === 'stub');
  if (stubs.length && !o.allowStubs) {
    throw new MissingModuleError(`app bundle: no entry file for ${stubs.map((k) => `rtx:${k} (${ENTRIES[k].files.join(' | ')})`).join(', ')}: a release never ships a stub (--allow-stubs to build one anyway)`);
  }
  return { which, resolved };
}

export function appBuildOptions(o: { minify: boolean; allowStubs: boolean; outfile?: string; sourcemap?: boolean; keepNames?: boolean; src?: string; pub?: string; split?: string }) {
  const src = o.src ?? SRC;
  const { which, resolved } = resolveModules({ allowStubs: o.allowStubs, src });
  const plugin = {
    name: 'rtx-modules',
    setup(b: any) {
      b.onResolve({ filter: /^rtx:/ }, (a: any) => {
        const name = a.path.slice(4);
        if (name === 'modules') return { path: 'modules', namespace: 'rtx' };
        const r = resolved[name];
        if (!r) return { errors: [{ text: `unknown module ${a.path}` }] };
        return r.path ? { path: r.path } : { path: name, namespace: 'rtx' };
      });
      b.onLoad({ filter: /.*/, namespace: 'rtx' }, (a: any) => {
        if (a.path === 'modules') return { contents: `export default ${JSON.stringify(which)};`, loader: 'js' };
        return { contents: resolved[a.path].parts!.map((q) => `export * from ${JSON.stringify(q)};`).join('\n'), loader: 'js', resolveDir: src };
      });
      b.onResolve({ filter: /^reflowtex\/companion$/ }, () => ({ path: join(o.pub ?? PUB, 'src/companion/companion.js') }));
    },
  };
  const options: Record<string, unknown> = {
    entryPoints: [join(src, 'main.js')],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: o.minify, keepNames: o.keepNames ?? false,
    logLevel: 'warning', legalComments: 'none', nodePaths: [join(WEB, 'node_modules')], metafile: true,
    plugins: [plugin],
    loader: { '.sty': 'text', '.svg': 'text' },     // the wordmark's SVG files (app/src/chrome/wordmark/), inlined as text                    // tex/reflowed-meta.sty ships with exports
    ...(o.outfile ? { outfile: o.outfile, write: true } : { write: false }),
    ...(o.split ? { entryPoints: { app: join(src, 'main.js') }, splitting: true, outdir: o.split, entryNames: '[name]-[hash]', chunkNames: '[name]-[hash]', absWorkingDir: EDITOR } : {}),
    ...(o.sourcemap ? { sourcemap: 'linked' } : {}),
  };
  return { options, which };
}
