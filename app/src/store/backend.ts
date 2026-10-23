// The two storage backends under CoreStore: IndexedDB (the app) and memory
// (tests, and the fallback when IndexedDB is unavailable, e.g. some private
// windows). Both offer the same small transactional interface, so CoreStore
// holds every rule (revs, op log, block counts) once and the two cannot drift.
//
// IndexedDB layout (database `reflowtex-editor`, version 1):
//   docs       key id
//   blocks     key id;             indexes byDoc (docId), byDocPos ([docId, pos])
//   assets     key [docId, id];    indexes byDoc (docId), byName ([docId, name])
//   ops        key id (ULID);      index byDoc ([docId, id])
//   snapshots  key id;             index byDoc ([docId, at])
//   cache      out-of-line keys (the engine's result cache)

export type Key = string | number | Array<string | number>;
export interface Range { lower?: Key; upper?: Key; only?: Key }
export type StoreName = 'docs' | 'blocks' | 'assets' | 'ops' | 'snapshots' | 'cache';

export interface Tx {
  get(store: StoreName, key: Key): Promise<any>;
  put(store: StoreName, value: any, key?: Key): Promise<void>;
  del(store: StoreName, key: Key): Promise<void>;
  /** records of a store, or of an index within a range, in key order */
  all(store: StoreName, index?: string, range?: Range): Promise<any[]>;
  /** primary keys, as `all` */
  keys(store: StoreName, index?: string, range?: Range): Promise<Key[]>;
}

export interface Backend {
  readonly kind: 'indexeddb' | 'memory';
  run<T>(stores: StoreName[], mode: 'readonly' | 'readwrite', fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): void;
}

interface StoreDef { keyPath: string | string[] | null; indexes: Record<string, string | string[]> }
export const SCHEMA: Record<StoreName, StoreDef> = {
  docs: { keyPath: 'id', indexes: {} },
  blocks: { keyPath: 'id', indexes: { byDoc: 'docId', byDocPos: ['docId', 'pos'] } },
  assets: { keyPath: ['docId', 'id'], indexes: { byDoc: 'docId', byName: ['docId', 'name'] } },
  ops: { keyPath: 'id', indexes: { byDoc: ['docId', 'id'] } },
  snapshots: { keyPath: 'id', indexes: { byDoc: ['docId', 'at'] } },
  cache: { keyPath: null, indexes: {} },
};
export const DB_NAME = 'reflowtex-editor';
export const DB_VERSION = 1;

// ── IndexedDB ───────────────────────────────────────────────────────────────

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function idbRange(range?: Range): IDBKeyRange | undefined {
  if (!range) return undefined;
  if (range.only !== undefined) return IDBKeyRange.only(range.only);
  if (range.lower !== undefined && range.upper !== undefined) return IDBKeyRange.bound(range.lower, range.upper);
  if (range.lower !== undefined) return IDBKeyRange.lowerBound(range.lower);
  if (range.upper !== undefined) return IDBKeyRange.upperBound(range.upper);
  return undefined;
}

export async function openIndexedDB(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME): Promise<Backend> {
  if (!factory) throw new Error('IndexedDB is not available');
  const open = factory.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const [sname, def] of Object.entries(SCHEMA)) {
      if (db.objectStoreNames.contains(sname)) continue;
      const os = def.keyPath === null ? db.createObjectStore(sname) : db.createObjectStore(sname, { keyPath: def.keyPath });
      for (const [iname, path] of Object.entries(def.indexes)) os.createIndex(iname, path);
    }
  };
  const db = await new Promise<IDBDatabase>((res, rej) => {
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(open.error);
    open.onblocked = () => rej(new Error('IndexedDB open blocked by another tab (older version)'));
  });
  // another tab upgrading: let it (this tab keeps working until reload)
  db.onversionchange = () => db.close();
  return {
    kind: 'indexeddb',
    close: () => db.close(),
    run<T>(stores: StoreName[], mode: 'readonly' | 'readwrite', fn: (tx: Tx) => Promise<T>) {
      const t = db.transaction(stores, mode, { durability: 'relaxed' } as any);
      const done = new Promise<void>((res, rej) => {
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error ?? new Error('transaction aborted'));
      });
      const src = (s: StoreName, index?: string) => (index ? t.objectStore(s).index(index) : t.objectStore(s));
      const tx: Tx = {
        get: (s, k) => req(t.objectStore(s).get(k)),
        put: async (s, v, k) => { await req(k === undefined ? t.objectStore(s).put(v) : t.objectStore(s).put(v, k)); },
        del: async (s, k) => { await req(t.objectStore(s).delete(k)); },
        all: (s, index, range) => req(src(s, index).getAll(idbRange(range))),
        keys: (s, index, range) => req((src(s, index) as any).getAllKeys(idbRange(range))) as Promise<Key[]>,
      };
      return (async () => {
        let out: T;
        try { out = await fn(tx); } catch (e) { try { t.abort(); } catch { /* already finished */ } await done.catch(() => {}); throw e; }
        await done;
        return out;
      })();
    },
  };
}

// ── Memory ──────────────────────────────────────────────────────────────────

/** IndexedDB's key order: numbers < strings < arrays, arrays element-wise. */
export function cmpKey(a: Key, b: Key): number {
  const rank = (k: Key) => (typeof k === 'number' ? 0 : typeof k === 'string' ? 1 : 2);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpKey(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
const keyOf = (v: any, path: string | string[]): Key => (Array.isArray(path) ? path.map((p) => v[p]) : v[path]);
const inRange = (k: Key, r?: Range) => !r || (r.only !== undefined ? cmpKey(k, r.only) === 0
  : (r.lower === undefined || cmpKey(k, r.lower) >= 0) && (r.upper === undefined || cmpKey(k, r.upper) <= 0));
const ser = (k: Key) => JSON.stringify(k);
const DELETED = Symbol('deleted');

export function memoryBackend(): Backend {
  const data = new Map<StoreName, Map<string, { key: Key; value: any }>>();
  for (const s of Object.keys(SCHEMA) as StoreName[]) data.set(s, new Map());
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: 'memory',
    close() {},
    run<T>(stores: StoreName[], mode: 'readonly' | 'readwrite', fn: (tx: Tx) => Promise<T>) {
      // one transaction at a time; writes staged and applied only on success
      const staged = new Map<StoreName, Map<string, { key: Key; value: any } | typeof DELETED>>();
      const check = (s: StoreName, write: boolean) => {
        if (!stores.includes(s)) throw new Error(`store ${s} not in transaction`);
        if (write && mode !== 'readwrite') throw new Error('readonly transaction');
      };
      const view = (s: StoreName) => {
        const base = data.get(s)!;
        const st = staged.get(s);
        const out = new Map(base);
        if (st) for (const [k, v] of st) { if (v === DELETED) out.delete(k); else out.set(k, v); }
        return out;
      };
      const list = (s: StoreName, index?: string, range?: Range) => {
        const def = SCHEMA[s];
        const rows = [...view(s).values()].map((r) => ({ ...r, ik: index ? keyOf(r.value, def.indexes[index]) : r.key }))
          .filter((r) => r.ik !== undefined && (!Array.isArray(r.ik) || r.ik.every((x) => x !== undefined)) && inRange(r.ik, range));
        rows.sort((x, y) => cmpKey(x.ik, y.ik) || cmpKey(x.key, y.key));
        return rows;
      };
      const tx: Tx = {
        async get(s, k) { check(s, false); const r = view(s).get(ser(k)); return r ? structuredClone(r.value) : undefined; },
        async put(s, v, k) {
          check(s, true);
          const def = SCHEMA[s];
          const key = def.keyPath === null ? k! : keyOf(v, def.keyPath);
          if (key === undefined) throw new Error(`put ${s}: no key`);
          if (!staged.has(s)) staged.set(s, new Map());
          staged.get(s)!.set(ser(key), { key, value: structuredClone(v) });
        },
        async del(s, k) { check(s, true); if (!staged.has(s)) staged.set(s, new Map()); staged.get(s)!.set(ser(k), DELETED); },
        async all(s, index, range) { check(s, false); return list(s, index, range).map((r) => structuredClone(r.value)); },
        async keys(s, index, range) { check(s, false); return list(s, index, range).map((r) => r.key); },
      };
      const p = chain.then(async () => {
        const out = await fn(tx);
        for (const [s, m] of staged) {
          const base = data.get(s)!;
          for (const [k, v] of m) { if (v === DELETED) base.delete(k); else base.set(k, v); }
        }
        return out;
      });
      chain = p.catch(() => {});
      return p;
    },
  };
}
