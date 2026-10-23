// The seed document the single-file build carries (scripts/seed.ts writes
// it): a DocInit as JSON, asset bytes in base64, fixed ids (so the build's
// prebuilt result cache and any links stay valid across rebuilds).
//
//   const id = await loadSeed(store, seedJson)   // one seed through seed versioning (seeds.ts)

import type { DocInit, DocStore } from '../store/types.ts';

export interface SeedFile {
  format: 'rtx-seed';
  version: 1;
  /** the doc id (a ULID) */
  id: string;
  init: Omit<DocInit, 'assets'> & { assets: Array<{ name: string; mime: string; base64: string; ipe?: boolean }> };
  /** content hash of the seed (scripts/seed.ts; seeds.ts computes it when absent) */
  seedHash?: string;
  /** set by the build: content + engine build id (default: seedHash) */
  seedVersion?: string;
  /** set by the build: { engine, date } (the date names "Open alongside" copies) */
  build?: { engine?: string; date?: string };
  /** when scripts/seed.ts wrote it (ISO) */
  builtAt?: string;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** One seed through seed versioning (seeds.ts syncSeeds): created the first
 *  time, brought up to this build's version when unedited, else left for the
 *  document's banner. Returns the doc id. */
export async function loadSeed(store: DocStore, seed: SeedFile | string): Promise<string> {
  const { syncSeeds } = await import('./seeds.ts');
  return (await syncSeeds(store, [seed]))[0].docId;
}
