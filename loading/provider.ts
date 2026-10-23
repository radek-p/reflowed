// Where the engine's TeX files come from. The engine reads files synchronously (TeX's I/O runs
// inside one wasm call in the worker), so a provider answers at once: from memory, or after a synchronous request
// (http.ts). The worker asks one chain and never knows which provider answered.
//
//   interface ResourceProvider { id; has(name); resolve(name) -> bytes | null }
//   mapProvider(id, files)          the embedded set (the single file's pack, unpacked), or any name -> bytes map
//   chain([a, b, …])                the first that has the name answers; resolveFrom tells which one did

export interface ResourceProvider {
  readonly id: string;
  /** whether it can give the name (no request: answered from what it knows) */
  has(name: string): boolean;
  /** the file's bytes, or null (not there, or it could not be fetched) */
  resolve(name: string): Uint8Array | null;
}

export function mapProvider(id: string, files: Map<string, Uint8Array>): ResourceProvider & { files: Map<string, Uint8Array> } {
  return { id, files, has: (n) => files.has(n), resolve: (n) => files.get(n) ?? null };
}

export interface Chain extends ResourceProvider {
  /** the bytes and the provider that gave them */
  resolveFrom(name: string): { bytes: Uint8Array; from: string } | null;
  providers: ResourceProvider[];
}

/** Tries the providers in order. A provider that has the name but fails to give it (a request that failed) lets the
 *  next one try. */
export function chain(providers: ResourceProvider[]): Chain {
  const c: Chain = {
    id: `chain(${providers.map((p) => p.id).join(',')})`,
    providers,
    has: (n) => c.providers.some((p) => p.has(n)),
    resolve: (n) => c.resolveFrom(n)?.bytes ?? null,
    resolveFrom(n) {
      for (const p of c.providers) {
        if (!p.has(n)) continue;
        const bytes = p.resolve(n);
        if (bytes) return { bytes, from: p.id };
      }
      return null;
    },
  };
  return c;
}
