// The store's entry point (rtx:store resolves to index.js, which re-exports this).
//
//   const store = await createDocStore();      // IndexedDB, or memory if that fails
//   await migrateV1(store);                     // once: the v1 localStorage doc
//
// Everything a caller needs is exported here.

import { CoreStore, type CoreOptions } from './core.ts';
import { memoryBackend, openIndexedDB } from './backend.ts';
import type { DocStore } from './types.ts';
import { ulid } from './ulid.ts';
import { keyBetween } from './fracindex.ts';
import { applyStorePolicy, type PolicyResult } from './policy.ts';

export * from './types.ts';
export { CoreStore, BlockConflict, blankDoc, sha256Hex, KEEP_AUTO } from './core.ts';
export { keyBetween, nKeysBetween, byPos } from './fracindex.ts';
export { ulid, ulidFactory, seededUlid, ulidTime } from './ulid.ts';
export { takeSnapshot, restoreSnapshot, replaceContent, beforeDestructive, AutoSnapshots, AUTO_INTERVAL_MS } from './snapshots.ts';
export { migrateV1, V1_KEY, MIGRATED_KEY } from './migrate.ts';
export { CORE_VERSION, DISPOSABLE_VERSION, CORE_ATTRS, DERIVED_ATTRS, DERIVED_DOC_FIELDS, POLICY_KEY, coreState, isOlder, isNewer, NewerSchemaError, OlderCoreError, applyStorePolicy, dropDisposable, dropUiState, withoutDerived } from './policy.ts';
export { newBlock, insertBlock, moveBlock, duplicateDoc } from './edit.ts';

/** contracts.d.ts `Ids` */
export const ids = { ulid: () => ulid(), keyBetween };

export function memoryStore(opts: CoreOptions = {}): DocStore {
  return new CoreStore(memoryBackend(), opts);
}

export async function indexedDBStore(opts: CoreOptions & { factory?: IDBFactory; name?: string } = {}): Promise<DocStore> {
  return new CoreStore(await openIndexedDB(opts.factory, opts.name), opts);
}

export interface CreateOptions extends CoreOptions {
  /** 'memory' forces the memory store (tests, ?store=memory) */
  kind?: 'indexeddb' | 'memory';
  /** IndexedDB database name (default reflowtex-editor) */
  name?: string;
  factory?: IDBFactory;
}

/** IndexedDB when it opens (and the browser is asked to keep it), else memory with a warning. */
export async function createDocStore(opts: CreateOptions = {}): Promise<DocStore> {
  if (opts.kind === 'memory') return withPolicy(memoryStore(opts));
  try {
    const s = await withPolicy(await indexedDBStore(opts));
    // not awaited: Firefox answers only after the person clicks its permission prompt (never, headless),
    // and the app waited on it before showing anything (tables wiring)
    try { (globalThis.navigator as any)?.storage?.persist?.()?.catch?.(() => {}); } catch { /* best effort */ }
    return s;
  } catch (e) {
    console.warn('IndexedDB unavailable: documents are kept in memory only', e);
    return withPolicy(memoryStore(opts));
  }
}

/** the store policy applied once on open (store/policy.ts): disposable data from an older build dropped.
 *  A failure is said and the store used as it is (documents are never touched by it). */
export let lastPolicy: PolicyResult | null = null;
async function withPolicy(s: DocStore): Promise<DocStore> {
  try { lastPolicy = await applyStorePolicy((s as CoreStore).backend); } catch (e) { console.warn(`store policy: ${(e as Error).message}`); }
  return s;
}
