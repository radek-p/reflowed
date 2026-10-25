// One document's writes to the store: the ordered writer (app/save-state.js), the op
// log, the typing timers, the safety snapshots and `settled`. No DOM: Node unit tests run it on a Memory store
// (tests/test-doc-units.ts).
//
//   const persist = createPersist({ store, ids, doc, readOnly, beforeDestructive, onChange, onError, onConflict, clock })
//     persist.write(fn, key)                 a store write, in order; refused while the document is read-only
//     persist.op(t, payload, blockId)        an op of the log (contracts.d.ts DocStore.appendOps)
//     persist.logOps(ops)
//     persist.saveBlock(b, { typing, ops })  the block written (typing: after 400 ms of quiet), its edit op a splice; a
//                                            changed source only over the one this tab wrote last (store/core.ts
//                                            expect): another tab's there instead, onConflict(id, stored), nothing written
//     persist.saveMeta(patch)
//     persist.setTitle(title)                the title written after 400 ms of quiet (the top bar's field)
//     persist.flushTyping()                  every typed block written now (pagehide, settled)
//     persist.safety(what, { force })        a safety snapshot before a destructive change, at most one a minute (force:
//                                            this one all the same: another tab's text about to be replaced)
//     persist.settled()                      every write done (exports read the store)
//     persist.repaired(list), opened(), putAsset(a, bytes)   the open's repairs, its openedAt, a file
//     persist.putMany(list)                  several blocks in one transaction when the store can
//     persist.loaded(blocks)                 the sources as stored (a document opened)
//     persist.remember(b) / forget(id)       a block's stored source (edit ops are splices from it; the store has it)
//     persist.savedOf(id)                    the source edit ops splice from
//     persist.writtenOf(id)                  the source this tab last wrote (or read): a write of another one expects it
//                                            there (another tab's instead: onConflict)
//     persist.cancel(id)                     a block's typing timer dropped (a removed block: nothing to save)
//     persist.typingOf(id)                   its timer, if any
//     persist.typing()                       is anything waiting to be written after typing?
//     persist.writer                         the writer (its state: failed writes, the tab's unsaved; retry)
//     persist.stop() / start()               nothing more written (the document was deleted in another tab: its typing
//                                            and failed writes dropped) / written again (a document opened)
import { createWriter } from './save-state.js';

const TYPING_MS = 400;

/** a block as persist writes it (the store sets rev and updatedAt) */
export interface PersistBlock { id: string; source: string; parentId?: string | null }
/** a block record as the store holds it, given back by a conflict */
export interface StoredBlock extends PersistBlock { pos: string; kind: string; rev?: number; updatedAt?: number }
/** an op of the log (contracts.d.ts Op) */
export interface PersistOp { id: string; docId: string; blockId?: string; t: string; payload: unknown; at: number; actor: string }
/** the store, as persist writes to it (contracts.d.ts DocStore) */
export interface PersistStore {
  readonly actor?: string;
  putBlock(docId: string, block: PersistBlock & { expect?: string }): Promise<unknown>;
  putBlocks?(docId: string, blocks: PersistBlock[]): Promise<unknown>;
  deleteBlock(docId: string, id: string): Promise<unknown>;
  putMeta(docId: string, patch: object): Promise<unknown>;
  putAsset(docId: string, asset: object, bytes: Uint8Array | null): Promise<unknown>;
  appendOps(docId: string, ops: PersistOp[]): Promise<unknown>;
  [k: string]: unknown;
}
export interface PersistClock { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }
export interface PersistOptions {
  store: PersistStore;
  ids: { ulid(): string };
  /** the open document (its id, its blocks, its title) */
  doc(): { id: string; title?: string; blocks: PersistBlock[] } | null;
  readOnly?: () => boolean;
  beforeDestructive?: ((store: PersistStore, docId: string, what: string) => unknown) | null;
  onChange?: () => void;
  onError?: (e: unknown) => void;
  /** this tab's write of block `id` found another source stored than the one it last wrote (another tab's), or no
   *  block: nothing was written (doc/follow.ts decides) */
  onConflict?: (id: string, stored: StoredBlock | null) => void;
  clock?: PersistClock;
}

/** [from, to, insert]: the one change that turns a into b (common prefix and suffix kept) */
export function splice(a: string, b: string): [number, number, string] {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return [i, a.length - j, b.slice(i, b.length - j)];
}

const globalClock: PersistClock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function createPersist({ store, ids, doc: docOf, readOnly = () => false, beforeDestructive = null, onChange = () => {}, onError = () => {}, onConflict = () => {}, clock = globalClock }: PersistOptions) {
  const writer = createWriter({ onChange: () => onChange(), onError: (e) => onError(e) });
  const doc = () => docOf()!;                // (every write is of the open document)
  const typingTimers = new Map<string, unknown>();
  const savedSource = new Map<string, string>();   // block id -> source as last written (edit ops are splices from it)
  const written = new Map<string, string>();       // block id -> source of this tab's last write of it (the store has it, unless another tab wrote since)
  let titleTimer: unknown = 0;
  let lastSafety = 0;
  let stopped = false;

  function write(fn: () => unknown, key?: string): Promise<void> {
    if (readOnly() || stopped) return Promise.resolve();   // never written: the store would refuse it (or it is gone)
    return writer.write(fn, key);
  }
  // The store sets rev and updatedAt; the op log is ours (contracts.d.ts DocStore.appendOps): insert, delete,
  // move, edit (a splice), meta. Every attr the app does not own (attrs.before: export) travels with the block.
  const op = (t: string, payload: unknown, blockId?: string): PersistOp => ({ id: ids.ulid(), docId: doc().id, blockId, t, payload, at: Date.now(), actor: store.actor ?? 'local' });
  function logOps(ops: PersistOp[]) { if (ops.length) { const id = doc().id; write(() => store.appendOps(id, ops)); } }
  function saveBlock(b: PersistBlock, { typing = false, ops = null as PersistOp[] | null } = {}) {
    const docId = doc().id;
    const flush = () => {
      typingTimers.delete(b.id);
      onChange();
      const before = savedSource.get(b.id), last = written.get(b.id);
      savedSource.set(b.id, b.source);
      written.set(b.id, b.source);
      // a changed source over the one written last: another tab's there instead is a conflict (doc/follow.ts), not
      // overwritten; the block as it is now (what `written` says, not what it is when the write runs)
      const rec = { ...b, ...(last !== undefined && last !== b.source ? { expect: last } : {}) };
      let lost = false;
      write(async () => {
        try { await store.putBlock(docId, rec); }
        catch (e) {
          if ((e as Error)?.name !== 'BlockConflict') throw e;
          lost = true;
          onConflict(b.id, (e as { stored?: StoredBlock | null }).stored ?? null);
        }
      }, `block:${docId}:${b.id}`);   // a newer write of the block supersedes a failed one
      const list = ops ?? (before !== undefined && before !== b.source ? [op('edit', { changes: [splice(before, b.source)] }, b.id)] : []);
      if (list.length) write(() => (lost ? null : store.appendOps(docId, list)));   // (not logged when it was not written)
    };
    clock.clearTimeout(typingTimers.get(b.id));
    if (typing) { typingTimers.set(b.id, clock.setTimeout(flush, TYPING_MS)); onChange(); } else flush();
  }
  // a title typed and not yet written is written now too (it was dropped here: after an export, a
  // pagehide or a close right after a rename, the store kept the old title)
  function flushTyping() {
    const d = docOf();
    if (typingTimers.has('title')) { clock.clearTimeout(titleTimer); typingTimers.delete('title'); if (d) saveMeta({ title: d.title }); }
    for (const [id, t] of typingTimers) {
      clock.clearTimeout(t); typingTimers.delete(id);
      const b = d?.blocks.find((x) => x.id === id);
      if (b) saveBlock(b);
    }
  }
  function saveMeta(patch: Record<string, unknown>) { const id = doc().id; write(() => store.putMeta(id, patch), `meta:${id}:${Object.keys(patch).sort().join()}`); logOps([op('meta', patch)]); }
  function setTitle() {
    clock.clearTimeout(titleTimer);
    typingTimers.set('title', 1); onChange();
    titleTimer = clock.setTimeout(() => { typingTimers.delete('title'); saveMeta({ title: doc().title }); }, TYPING_MS);
  }
  /** a safety snapshot before a destructive change (beforeDestructive), at most one a minute unless forced */
  function safety(what: string, { force = false } = {}): Promise<void> {
    if (!beforeDestructive || (!force && Date.now() - lastSafety < 60_000)) return Promise.resolve();
    lastSafety = Date.now();
    const docId = doc().id, made = beforeDestructive;
    return write(() => Promise.resolve(made(store, docId, what)).catch((e: Error) => console.warn('snapshot:', e.message)));
  }
  /** every write done (exports read the store) */
  async function settled() {
    flushTyping();                                   // the blocks typed and the title
    while (writer.pending) await writer.idle();
  }
  /** several blocks in one transaction when the store can */
  function putMany(list: PersistBlock[]) {
    const id = doc().id, recs = list.map((b) => ({ ...b }));
    for (const b of recs) written.set(b.id, b.source);
    if (store.putBlocks) write(() => store.putBlocks!(id, recs));
    else for (const b of recs) write(() => store.putBlock(id, b));
  }
  /** blocks whose nesting links were repaired on open, written back as they are now */
  function repaired(list: PersistBlock[]) {
    const id = doc().id, recs = list.map((b) => ({ ...b, parentId: b.parentId ?? null }));
    for (const b of recs) written.set(b.id, b.source);
    write(() => store.putBlocks ? store.putBlocks(id, recs) : Promise.all(recs.map((b) => store.putBlock(id, b))));
  }
  /** the document was opened (the Documents view sorts by it) */
  function opened() { const id = doc().id; write(() => store.putMeta(id, { openedAt: Date.now() })); }
  function putAsset(a: object, bytes: Uint8Array | null) { const id = doc().id; return write(() => store.putAsset(id, a, bytes)); }
  function cancel(id: string) { clock.clearTimeout(typingTimers.get(id)); typingTimers.delete(id); }
  function stop() {
    stopped = true;
    clock.clearTimeout(titleTimer);
    for (const t of typingTimers.values()) clock.clearTimeout(t);
    typingTimers.clear();
    writer.reset();
    void writer.idle().then(() => { if (stopped) writer.reset(); });   // a write in flight that fails then is not retried
  }
  return {
    store, writer, write, op, logOps, saveBlock, saveMeta, setTitle, flushTyping, safety, settled, putMany, cancel, repaired, opened, putAsset,
    stop, start() { stopped = false; },
    typingOf: (id: string) => typingTimers.get(id),
    typing: () => typingTimers.size > 0,
    loaded(blocks: PersistBlock[]) { savedSource.clear(); written.clear(); for (const b of blocks) { savedSource.set(b.id, b.source); written.set(b.id, b.source); } },
    remember(b: PersistBlock) { savedSource.set(b.id, b.source); written.set(b.id, b.source); },
    forget(id: string) { savedSource.delete(id); written.delete(id); },
    savedOf: (id: string) => savedSource.get(id),
    writtenOf: (id: string) => written.get(id),
  };
}
export type Persist = ReturnType<typeof createPersist>;
