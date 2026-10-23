// @ts-check
// A small IndexedDB result cache behind the DocStore `cache` interface
// ({ get(key), put(key, result) }), for pages that give the backend no store
// (the engine's own test page, the editor before store is wired).
// One object store, results by key; failures (private mode, quota) read as misses.
export function createIdbCache(name = 'rtx-engine-cache') {
  let db = null;
  const open = () => (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('results');
    // a reset deleting the database (store/wipe.js) asks open connections to close: let it, open again on the next use
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); db = null; }; resolve(d); };
    req.onerror = () => reject(req.error);
  }));
  const tx = async (mode, f) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('results', mode);
      const r = f(t.objectStore('results'));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    kind: 'indexeddb',
    async get(key) { try { return (await tx('readonly', (s) => s.get(key))) ?? null; } catch { return null; } },
    async put(key, result) { try { await tx('readwrite', (s) => s.put(result, key)); } catch { /* quota, private mode */ } },
    async delete(key) { try { await tx('readwrite', (s) => s.delete(key)); } catch { /* */ } },
    async clear() { try { await tx('readwrite', (s) => s.clear()); } catch { /* */ } },
  };
}
