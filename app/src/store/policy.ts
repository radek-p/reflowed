// The store policy. Migrations are not supported yet: there are none.
//
// CORE: what the person wrote, the only data a document is. Never migrated, never silently rewritten.
//   doc     id, schema (holds the core version), title, meta, preamble.source, bib.kind/source/path,
//           settings, files (paths, roles, the text around \input lines), createdAt
//   blocks  id, docId, kind, source, parentId, pos (the order), file, and the attrs in CORE_ATTRS
//           (the whitespace and container text that export puts back byte for byte)
//   assets  every field (name, mime, bytes, a figure's model and rendition: edits, not caches)
// DISPOSABLE: everything that can be made again. Dropped and regenerated on any schema change, never migrated.
//   stores  ops (the op log), snapshots (versions), cache (compile results and contexts; its 'rtx:' records
//           are the app's own bookkeeping, e.g. the seed registry, and stay)
//   doc     DERIVED_DOC_FIELDS: blockCount (recounted), bib.entries (parsed again from bib.source)
//   blocks  DERIVED_ATTRS: env, level, theorem, restatable, restates (classifier output; readers fall back to
//           scanning the source), and rev/updatedAt (store bookkeeping, kept as they are)
//   UI      localStorage 'rtx-editor.*' (panes, tabs, view), except KEEP_UI_KEYS
//
// Versions:
//   CORE_VERSION        bumped by a change to a core shape. A document whose core is OLDER opens read-only with
//                       the "made by an older ReflowEd" prompt (export it and start anew; app/older-core.js);
//                       NEWER: read-only (an older build must not write what it does not know)
//   DISPOSABLE_VERSION  bumped by a change to a disposable shape (op, snapshot, cache record, derived attr)
//
// On open (applyStorePolicy, from createDocStore): the versions the stores were last stamped with ('rtx:policy'
// in the cache store) against this build's. Older: the disposable data is dropped and the stamp moved on.
// Newer (an older release file opened after a newer one; all file:// releases share one IndexedDB): left
// as it is. Missing: stamped (the policy's own baseline is CORE 2, DISPOSABLE 1: nothing to drop).
// A change to the IndexedDB layout itself (backend.ts DB_VERSION) adds stores in onupgradeneeded; it is a
// disposable change when it touches only disposable stores.

import type { Backend } from './backend.ts';
import { MIGRATED_KEY } from './migrate.ts';

export const CORE_VERSION = 2;
export const DISPOSABLE_VERSION = 1;
/** @deprecated the stored field is still `schema`; it holds the core version */
export const SCHEMA = CORE_VERSION;

export const CORE_ATTRS = ['before', 'joined', 'container', 'v1Id'] as const;
export const DERIVED_ATTRS = ['env', 'level', 'theorem', 'restatable', 'restates'] as const;
export const DERIVED_DOC_FIELDS = ['blockCount', 'bib.entries'] as const;
export const POLICY_KEY = 'rtx:policy';
export const UI_PREFIX = 'rtx-editor.';
export const KEEP_UI_KEYS: readonly string[] = [MIGRATED_KEY];

type Rec = Record<string, any>;

export const schemaOf = (raw: unknown): number | null => {
  const s = (raw as Rec | null)?.schema;
  return typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : null;
};
/** 'current' also for a record without a version (a damaged one: repair stamps it) */
export function coreState(raw: unknown, code = CORE_VERSION): 'current' | 'older' | 'newer' {
  const s = schemaOf(raw);
  return s === null || s === code ? 'current' : s < code ? 'older' : 'newer';
}
export const isNewer = (raw: unknown): boolean => coreState(raw) === 'newer';
export const isOlder = (raw: unknown): boolean => coreState(raw) === 'older';

export class NewerSchemaError extends Error {
  docId: string;
  schema: number;
  constructor(docId: string, schema: number) {
    super(`document ${docId} was written by a newer ReflowEd (core ${schema}; this one knows ${CORE_VERSION}): it is read-only here`);
    this.docId = docId; this.schema = schema;
    this.name = 'NewerSchemaError';
  }
}
export class OlderCoreError extends Error {
  docId: string;
  schema: number;
  constructor(docId: string, schema: number) {
    super(`document ${docId} was made by an older ReflowEd (core ${schema}; this one is ${CORE_VERSION}): export it and start anew, or edit it in the older build`);
    this.docId = docId; this.schema = schema;
    this.name = 'OlderCoreError';
  }
}
/** raw, or throws: every store write checks the stored doc (newer: NewerSchemaError; older: OlderCoreError) */
export function writable<T>(raw: T): T {
  const st = coreState(raw);
  if (st === 'newer') throw new NewerSchemaError(String((raw as Rec).id), schemaOf(raw)!);
  if (st === 'older') throw new OlderCoreError(String((raw as Rec).id), schemaOf(raw)!);
  return raw;
}
/** the error for a document the store marked read-only on read */
export const readOnlyError = (doc: { id: string; schema: number; readOnly?: string }) =>
  doc.readOnly === 'older-core' ? new OlderCoreError(doc.id, doc.schema) : new NewerSchemaError(doc.id, doc.schema);

/** A block's attrs without the derived ones (null when there were none to drop). */
export function withoutDerived(attrs: Rec | undefined): Rec | null {
  if (!attrs || !DERIVED_ATTRS.some((k) => k in attrs)) return null;
  const out = { ...attrs };
  for (const k of DERIVED_ATTRS) delete out[k];
  return out;
}

export interface Versions { core: number; disposable: number }
export interface PolicyStamp extends Versions { droppedAt?: number }
export interface PolicyResult { action: 'stamped' | 'none' | 'dropped' | 'newer'; from: PolicyStamp | null; dropped?: { ops: number; snapshots: number; cache: number; blocks: number; docs: number; ui: number } }

const cmp = (a: Versions, b: Versions) => a.core - b.core || a.disposable - b.disposable;

/** Compare the stores' stamp with this build's versions; drop the disposable data when the stamp is older.
 *  `code` and `now` for tests; `storage` is the UI state's (localStorage). */
export async function applyStorePolicy(backend: Backend, opts: { code?: Versions; storage?: Storage | null; now?: () => number } = {}): Promise<PolicyResult> {
  const code = opts.code ?? { core: CORE_VERSION, disposable: DISPOSABLE_VERSION };
  const now = opts.now ?? Date.now;
  const raw = await backend.run(['cache'], 'readonly', (tx) => tx.get('cache', POLICY_KEY));
  const from: PolicyStamp | null = raw && typeof raw.core === 'number' && typeof raw.disposable === 'number' ? raw : null;
  if (!from) {
    await backend.run(['cache'], 'readwrite', (tx) => tx.put('cache', { ...code }, POLICY_KEY));
    return { action: 'stamped', from };
  }
  const c = cmp(from, code);
  if (c === 0) return { action: 'none', from };
  if (c > 0) return { action: 'newer', from };
  const dropped = await dropDisposable(backend, code.core);
  dropped.ui = dropUiState(opts.storage === undefined ? (globalThis as any).localStorage : opts.storage);
  await backend.run(['cache'], 'readwrite', (tx) => tx.put('cache', { ...code, droppedAt: now() }, POLICY_KEY));
  console.info(`store: data from an older ReflowEd (${from.core}.${from.disposable} → ${code.core}.${code.disposable}): versions, the op log, compile results and UI state were dropped; documents kept`);
  return { action: 'dropped', from, dropped };
}

/** The disposable stores emptied, and the derived fields of current-core documents dropped (older and newer
 *  documents are never rewritten). One transaction: all or nothing. */
export async function dropDisposable(backend: Backend, core = CORE_VERSION) {
  return backend.run(['docs', 'blocks', 'ops', 'snapshots', 'cache'], 'readwrite', async (tx) => {
    const n = { ops: 0, snapshots: 0, cache: 0, blocks: 0, docs: 0, ui: 0 };
    for (const k of await tx.keys('ops')) { await tx.del('ops', k); n.ops++; }
    for (const k of await tx.keys('snapshots')) { await tx.del('snapshots', k); n.snapshots++; }
    for (const k of await tx.keys('cache')) if (!String(k).startsWith('rtx:')) { await tx.del('cache', k); n.cache++; }
    for (const d of await tx.all('docs')) {
      if (!d || typeof d.id !== 'string' || coreState(d, core) !== 'current') continue;
      const blocks = await tx.all('blocks', 'byDoc', { only: d.id });
      for (const b of blocks) {
        const attrs = withoutDerived(b?.attrs);
        if (attrs) { await tx.put('blocks', { ...b, attrs }); n.blocks++; }
      }
      const doc = { ...d };
      let changed = false;
      if (doc.blockCount !== blocks.length) { doc.blockCount = blocks.length; changed = true; }
      if (doc.bib && typeof doc.bib === 'object' && 'entries' in doc.bib) { const { entries: _e, ...bib } = doc.bib; doc.bib = bib; changed = true; }
      if (changed) { await tx.put('docs', doc); n.docs++; }
    }
    return n;
  });
}

/** UI state (localStorage 'rtx-editor.*') dropped, except KEEP_UI_KEYS. */
export function dropUiState(storage: Storage | null | undefined): number {
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(UI_PREFIX) && !KEEP_UI_KEYS.includes(k)) keys.push(k); }
    for (const k of keys) storage.removeItem(k);
    return keys.length;
  } catch { return 0; }
}
