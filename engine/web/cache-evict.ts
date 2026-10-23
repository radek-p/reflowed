// (moved from app/src/store, the engine owns its keys) The result cache shrinks: every engine build changes every key, and all release files share one
// IndexedDB, so results of old builds would stay for ever (and a full origin then fails document writes too).
//
//   evictCache(cache, build) -> { deleted, kept }   keeps the results of the current build and the one before
//                                                   it (the builds seen, newest first, in the 'rtx:builds'
//                                                   record), then at most CAP results in all
//   buildOfKey(key)                                 the engine build a cache key belongs to, or null
// Keys: 'e<build>.…' (results), 'pre.e<build>.…' (a preamble's problems); 'rtx:…' are the editor's own records.
export const KEEP_BUILDS = 2;
export const CAP = 20000;

export interface EvictableCache {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<unknown>;
  keys(): Promise<string[]>;
  deleteMany(keys: string[]): Promise<unknown>;
}

export function buildOfKey(key: string): string | null {
  const k = key.startsWith('pre.') ? key.slice(4) : key;
  if (k[0] !== 'e') return null;
  const dot = k.indexOf('.');
  return dot > 1 ? k.slice(1, dot) : null;
}

export async function evictCache(cache: EvictableCache, build: string, cap = CAP): Promise<{ deleted: number; kept: number }> {
  if (!build) throw new Error('evictCache: no engine build id');
  const seen = ((await cache.get('rtx:builds')) as string[] | null) ?? [];
  const builds = [build, ...seen.filter((b) => b !== build)].slice(0, KEEP_BUILDS);
  await cache.put('rtx:builds', builds);
  const keys = (await cache.keys()).map(String);
  const doomed: string[] = [];
  const keptBy = new Map<string, string[]>(builds.map((b) => [b, []]));
  for (const k of keys) {
    if (k.startsWith('rtx:')) continue;
    const b = buildOfKey(k);
    if (b === null) continue;                          // not a result key: not ours to delete
    const list = keptBy.get(b);
    if (list) list.push(k); else doomed.push(k);
  }
  // over the cap: the older build's results go first, then the current build's beyond the cap
  let kept = [...keptBy.values()].reduce((n, l) => n + l.length, 0);
  for (const b of [...builds].reverse()) {
    const l = keptBy.get(b)!;
    while (kept > cap && l.length) { doomed.push(l.pop()!); kept--; }
  }
  if (doomed.length) await cache.deleteMany(doomed);
  return { deleted: doomed.length, kept };
}
