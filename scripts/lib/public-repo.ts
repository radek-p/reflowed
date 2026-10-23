// The public reflowtex checkout the editor builds against (its viewer, its companion package, its inspector), found
// from REFLOWTEX or a sibling checkout, and its browser bundles built on demand. The public repository commits no built file: its
// src/pipeline/bundles.ts ensureBundles() builds a bundle when it is missing or was built from other sources.
//
//   publicRepo()                          REFLOWTEX, else /reflowtex, else the nearest ancestor
//   await ensurePublicBundles(pub, only?) the companion (and the inspector) built when missing or stale, with the public
//                                         helper; a checkout without node_modules of its own builds with the app's esbuild
//                                         and packages (scripts/lib/public-esbuild.ts). An older checkout that commits
//                                         its bundles (no helper) is used as it is.
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EDITOR = join(dirname(fileURLToPath(import.meta.url)), '../..');
const isCheckout = (d: string) => existsSync(join(d, 'src/companion')) && existsSync(join(d, 'src/viewer'));

export function publicRepo(from = EDITOR): string {
  if (process.env.REFLOWTEX) return process.env.REFLOWTEX;
  if (isCheckout('/reflowtex')) return '/reflowtex';
  for (let d = from; ; d = dirname(d)) {
    const c = join(d, 'reflowtex');
    if (c !== from && isCheckout(c)) return c;
    if (d === parse(d).root) break;
  }
  return join(EDITOR, '../../reflowtex');
}

type Name = 'viewer' | 'companion' | 'inspector';
let hooked = false;
/** `esbuild` for a module of the public checkout that cannot resolve it itself: the app's (public-esbuild.ts) */
function hookEsbuild() {
  if (hooked) return;
  hooked = true;
  const shim = pathToFileURL(join(EDITOR, 'scripts/lib/public-esbuild.ts')).href;
  register(`data:text/javascript,${encodeURIComponent(`const SHIM = ${JSON.stringify(shim)};
export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s === 'esbuild') return next(SHIM, c); throw e; } }`)}`);
}

export async function ensurePublicBundles(pub: string, only: Name[] = ['companion', 'inspector'], log: (s: string) => void = (s) => console.log(s)): Promise<Name[]> {
  const helper = join(pub, 'src/pipeline/bundles.ts');
  if (!existsSync(helper)) return [];                     // an older checkout: its bundles are committed
  if (!existsSync(join(pub, 'node_modules/esbuild'))) hookEsbuild();
  const m = await import(pathToFileURL(helper).href) as { ensureBundles(o: { only: Name[]; log(s: string): void }): Name[] };
  return m.ensureBundles({ only, log });
}
