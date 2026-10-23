// The editor engine under Node: support files from Tectonic's bundle through
// ../server/bundle.ts (read-only) with this track's own disk cache
// (build/tectonic-cache, unless TECTONIC_CACHE names another); misses fetched
// synchronously through a child process (../server/fetch-one.ts). Records every bundle
// file opened (the working set).
process.env.TECTONIC_CACHE ??= new URL('../build/tectonic-cache', import.meta.url).pathname;
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { WarmEngine } from '../src/engine.ts';

export const TC = new URL('../../', import.meta.url).pathname;
export const ENGINE = new URL('../', import.meta.url).pathname;
const { getIndex, resolveTarUrl, getFileCachedSync } = await import(TC + 'engine/server/bundle.ts');
await resolveTarUrl();
export const index: Map<string, unknown> = await getIndex();
export const files = new Map<string, Uint8Array>();
export const used = new Set<string>();
/** Files that are not in the bundle (assets, the paper's own files): looked up first. */
export const local = new Map<string, Uint8Array>();
export const FORMAT = TC + 'engine/api/formats/latex.fmt';
// TeX files the bundle lacks (engine/tex: lipics-v2021 and its logos), as the pack has them
for (const f of (await import('node:fs')).readdirSync(ENGINE + 'tex')) if (!f.endsWith('.sty')) local.set(f, readFileSync(ENGINE + 'tex/' + f));

export function fetchSync(kind: number, name: string): Uint8Array | null {
  if (kind === 1) return name === 'latex.fmt' && existsSync(FORMAT) ? readFileSync(FORMAT) : null;
  const l = local.get(name);
  if (l) return l;
  const hit = files.get(name);
  if (hit) { used.add(name); return hit; }
  if (!index.has(name)) return null;
  const data: Uint8Array = getFileCachedSync(name) ??
    execFileSync(process.execPath, [TC + 'engine/server/fetch-one.ts', name], { maxBuffer: 1 << 30, env: process.env });
  files.set(name, data);
  used.add(name);
  return data;
}

export async function engine(variant = 'async'): Promise<WarmEngine> {
  const dir = ENGINE + `dist/${variant}/`;
  const createModule = (await import(dir + 'tectonic.mjs')).default;
  return WarmEngine.create({ createModule, wasmBinary: readFileSync(dir + 'tectonic_wasm.wasm'),
    glue: readFileSync(dir + 'tectonic.mjs', 'utf8'), fetchSync });
}

/** The TeX files the worker adds (scripts/build-worker.ts extraTexFiles), for the Node tests. */
export const EXTRA: Record<string, string> = (await import('../scripts/build-worker.ts')).extraTexFiles();
