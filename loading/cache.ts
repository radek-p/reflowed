// THE CACHE of fetched tree files, kept in this browser: what the worker fetched once from the TeX tree is sent to every
// later worker, so a document needs the server only the first time (and opens with the server off after).
// Regenerable, so disposable (store policy): its own IndexedDB database, dropped by a reset (app's store/wipe.js).
// The release's files are not kept here: each is named by its content's hash and fetched with cache: 'force-cache', so
// the browser's HTTP cache already holds them for good; a second copy would only double the space.
//
//   cacheKey(base, name, hash?)        a tree's base (its address: the TeX tree's carries its year, texlive/2022/) + the
//                                      name (+ the content hash when the index has one)
//   const rs = createResourceStore();   rs.keep(base, [{ name, path, bytes }]);   await rs.load(base) -> { name: bytes }
//   rs.clear()
export const RESOURCE_DB = 'reflowed-tex-resources';

export const cacheKey = (base: string, name: string, hash?: string) => `${base}\u0000${name}${hash ? `\u0000${hash}` : ''}`;

export interface ResourceStore {
  keep(base: string, files: { name: string; path: string; bytes: Uint8Array }[]): Promise<void>;
  /** every file kept for this tree: { name: bytes } (none on any failure: the server is asked again) */
  load(base: string): Promise<Record<string, Uint8Array>>;
  clear(): Promise<void>;
}

export function createResourceStore(name = RESOURCE_DB): ResourceStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => (db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    // a reset deleting the database asks open connections to close: let it, open again on the next use
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); db = null; }; resolve(d); };
    req.onerror = () => reject(req.error);
  }));
  return {
    async keep(base, files) {
      const d = await open();
      await new Promise<void>((resolve, reject) => {
        const t = d.transaction('files', 'readwrite');
        const s = t.objectStore('files');
        for (const f of files) s.put({ path: f.path, bytes: f.bytes, at: Date.now() }, cacheKey(base, f.name));
        t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
      });
    },
    async load(base) {
      try {
        const d = await open();
        return await new Promise<Record<string, Uint8Array>>((resolve) => {
          const out: Record<string, Uint8Array> = {};
          const t = d.transaction('files', 'readonly');
          const req = t.objectStore('files').openCursor(IDBKeyRange.bound(cacheKey(base, ''), cacheKey(base, '￿')));
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return;
            out[String(c.key).slice(base.length + 1).split('\u0000')[0]] = (c.value as { bytes: Uint8Array }).bytes;
            c.continue();
          };
          t.oncomplete = () => resolve(out);
          t.onerror = () => resolve({});
        });
      } catch { return {}; }
    },
    async clear() {
      const d = await open();
      await new Promise<void>((resolve) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').clear(); t.oncomplete = () => resolve(); t.onerror = () => resolve(); });
    },
  };
}
