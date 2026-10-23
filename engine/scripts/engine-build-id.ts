// (engine/web/key.js), of the seed caches and of IndexedDB. It must change whenever anything that
// shapes a block's result changes, so it is derived from:
//   - every source the worker bundle is made of (esbuild's metafile inputs: the editor engine, the
//     converter, doc-fonts, the public encoder under @pub, the shims), read from disk;
//   - the engine (wasm and glue) and the format (latex.fmt) the release packs;
//   - the embedded TeX set (names), the local TeX files and the extra TeX files (contents).
// build-worker.ts bundles with a placeholder for ENGINE_BUILD and puts the id in afterwards.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const BUILD_PLACEHOLDER = '@@RTX_ENGINE_BUILD@@';

export interface BuildIdInputs {
  /** esbuild metafile input paths (relative to absWorkingDir, or absolute; virtual: ones are skipped) */
  bundled: string[];
  absWorkingDir: string;
  /** files hashed whole: the wasm, the glue, latex.fmt, the local TeX files */
  files: string[];
  /** anything else that shapes a result, as text (the working-set names, the extra TeX files) */
  texts: string[];
}

/** the id and what it was computed from (the files read, for the test and for a report) */
export function engineBuildId(i: BuildIdInputs): { id: string; read: string[] } {
  const h = createHash('sha256');
  const read: string[] = [];
  const add = (label: string, data: Uint8Array | string) => { h.update(`${label}\0`); h.update(data); h.update('\0'); };
  // (inputs in a namespace: virtual:, (disabled): are not files; what they stand for is in files/texts)
  const bundled = i.bundled.filter((p) => !/^[^/]*:/.test(p)).map((p) => (isAbsolute(p) ? p : join(i.absWorkingDir, p))).sort();
  for (const p of [...bundled, ...i.files]) {
    if (!existsSync(p)) throw new Error(`engine build id: ${p} does not exist`);
    add('file', readFileSync(p));          // contents only: the same id wherever the tree is mounted
    read.push(p);
  }
  for (const t of i.texts) add('text', t);
  return { id: h.digest('hex').slice(0, 10), read };
}
