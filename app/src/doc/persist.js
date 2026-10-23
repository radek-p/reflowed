// @ts-check
// One document's writes to the store: the ordered writer (app/save-state.js), the op
// log, the typing timers, the safety snapshots and `settled`. No DOM: Node unit tests run it on a Memory store
// (tests/test-doc-units.ts).
//
//   const persist = createPersist({ store, ids, doc, readOnly, beforeDestructive, onChange, onError, clock })
//     persist.write(fn, key)                 a store write, in order; refused while the document is read-only
//     persist.op(t, payload, blockId)        an op of the log (contracts.d.ts DocStore.appendOps)
//     persist.logOps(ops)
//     persist.saveBlock(b, { typing, ops })  the block written (typing: after 400 ms of quiet), its edit op a splice
//     persist.saveMeta(patch)
//     persist.setTitle(title)                the title written after 400 ms of quiet (the top bar's field)
//     persist.flushTyping()                  every typed block written now (pagehide, settled)
//     persist.safety(what)                   a safety snapshot before a destructive change, at most one a minute
//     persist.settled()                      every write done (exports read the store)
//     persist.repaired(list), opened(), putAsset(a, bytes)   the open's repairs, its openedAt, a file
//     persist.putMany(list)                  several blocks in one transaction when the store can
//     persist.loaded(blocks)                 the sources as stored (a document opened)
//     persist.remember(b) / forget(id)       a block's stored source (edit ops are splices from it)
//     persist.savedOf(id)
//     persist.cancel(id)                     a block's typing timer dropped (a removed block: nothing to save)
//     persist.typingOf(id)                   its timer, if any
//     persist.typing()                       is anything waiting to be written after typing?
//     persist.writer                         the writer (its state: failed writes, the tab's unsaved; retry)
import { createWriter } from './save-state.js';

const TYPING_MS = 400;

/** [from, to, insert]: the one change that turns a into b (common prefix and suffix kept) */
export function splice(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return [i, a.length - j, b.slice(i, b.length - j)];
}

/** @param {{ store: any, ids: { ulid(): string }, doc: () => any, readOnly?: () => boolean, beforeDestructive?: ((store: any, docId: string, what: string) => unknown) | null, onChange?: () => void, onError?: (e: any) => void, clock?: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (t: any) => void } }} o */
export function createPersist({ store, ids, doc, readOnly = () => false, beforeDestructive = null, onChange = () => {}, onError = () => {}, clock = globalThis }) {
  const writer = createWriter({ onChange: () => onChange(), onError: (e) => onError(e) });
  const typingTimers = new Map();
  const savedSource = new Map();             // block id -> source as last written (edit ops are splices from it)
  let titleTimer = 0;
  let lastSafety = 0;

  function write(fn, key) {
    if (readOnly()) return Promise.resolve();          // never written: the store would refuse it
    return writer.write(fn, key);
  }
  // The store sets rev and updatedAt; the op log is ours (contracts.d.ts DocStore.appendOps): insert, delete,
  // move, edit (a splice), meta. Every attr the app does not own (attrs.before: export) travels with the block.
  const op = (t, payload, blockId) => ({ id: ids.ulid(), docId: doc().id, blockId, t, payload, at: Date.now(), actor: store.actor ?? 'local' });
  function logOps(ops) { if (ops.length) { const id = doc().id; write(() => store.appendOps(id, ops)); } }
  function saveBlock(b, { typing = false, ops = null } = {}) {
    const docId = doc().id;
    const flush = () => {
      typingTimers.delete(b.id);
      onChange();
      const before = savedSource.get(b.id);
      savedSource.set(b.id, b.source);
      write(() => store.putBlock(docId, { ...b }), `block:${docId}:${b.id}`);   // a newer write of the block supersedes a failed one
      if (ops) logOps(ops);
      else if (before !== undefined && before !== b.source) logOps([op('edit', { changes: [splice(before, b.source)] }, b.id)]);
    };
    clock.clearTimeout(typingTimers.get(b.id));
    if (typing) { typingTimers.set(b.id, clock.setTimeout(flush, TYPING_MS)); onChange(); } else flush();
  }
  // a title typed and not yet written is written now too (it was dropped here: after an export, a
  // pagehide or a close right after a rename, the store kept the old title)
  function flushTyping() {
    const d = doc();
    if (typingTimers.has('title')) { clock.clearTimeout(titleTimer); typingTimers.delete('title'); if (d) saveMeta({ title: d.title }); }
    for (const [id, t] of typingTimers) {
      clock.clearTimeout(t); typingTimers.delete(id);
      const b = d?.blocks.find((x) => x.id === id);
      if (b) saveBlock(b);
    }
  }
  function saveMeta(patch) { const id = doc().id; write(() => store.putMeta(id, patch), `meta:${id}:${Object.keys(patch).sort().join()}`); logOps([op('meta', patch)]); }
  function setTitle() {
    clock.clearTimeout(titleTimer);
    typingTimers.set('title', 1); onChange();
    titleTimer = clock.setTimeout(() => { typingTimers.delete('title'); saveMeta({ title: doc().title }); }, TYPING_MS);
  }
  /** a safety snapshot before a destructive change (beforeDestructive), at most one a minute */
  function safety(what) {
    if (!beforeDestructive || Date.now() - lastSafety < 60_000) return Promise.resolve();
    lastSafety = Date.now();
    const docId = doc().id;
    return write(() => Promise.resolve(beforeDestructive(store, docId, what)).catch((e) => console.warn('snapshot:', e.message)));
  }
  /** every write done (exports read the store) */
  async function settled() {
    flushTyping();                                   // the blocks typed and the title
    while (writer.pending) await writer.idle();
  }
  /** several blocks in one transaction when the store can */
  function putMany(list) {
    const id = doc().id;
    if (store.putBlocks) write(() => store.putBlocks(id, list.map((b) => ({ ...b }))));
    else for (const b of list) write(() => store.putBlock(id, { ...b }));
  }
  /** blocks whose nesting links were repaired on open, written back as they are now */
  function repaired(list) {
    const id = doc().id;
    write(() => store.putBlocks ? store.putBlocks(id, list.map((b) => ({ ...b, parentId: b.parentId ?? null }))) : Promise.all(list.map((b) => store.putBlock(id, { ...b, parentId: b.parentId ?? null }))));
  }
  /** the document was opened (the Documents view sorts by it) */
  function opened() { const id = doc().id; write(() => store.putMeta(id, { openedAt: Date.now() })); }
  function putAsset(a, bytes) { const id = doc().id; return write(() => store.putAsset(id, a, bytes)); }
  function cancel(id) { clock.clearTimeout(typingTimers.get(id)); typingTimers.delete(id); }
  return {
    store, writer, write, op, logOps, saveBlock, saveMeta, setTitle, flushTyping, safety, settled, putMany, cancel, repaired, opened, putAsset,
    typingOf: (id) => typingTimers.get(id),
    typing: () => typingTimers.size > 0,
    loaded(blocks) { savedSource.clear(); for (const b of blocks) savedSource.set(b.id, b.source); },
    remember(b) { savedSource.set(b.id, b.source); },
    forget(id) { savedSource.delete(id); },
    savedOf: (id) => savedSource.get(id),
  };
}
