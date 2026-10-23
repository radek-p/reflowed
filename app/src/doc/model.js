// @ts-check
// One document's block list and its writes: where a block goes in the order (fractional
// keys), a new block, a block placed or taken out (saved, with its op), and the keys of a list in a new order.
// No DOM: Node unit tests run it on a Memory store (tests/test-doc-units.ts).
//
//   const model = createModel({ ids, persist, doc, onUnplace })
//     model.blockById(id), model.indexOf(id)
//     model.posBetween(i)                      a pos for a block inserted at index i
//     model.newBlock(kind, source, file, parentId)
//     model.placeBlock(b, index)               into the list at index, saved, an insert op
//     model.unplaceBlock(id) -> { b, i }       out of the list, deleted in the store (a safety snapshot first), a delete op;
//                                              onUnplace(id) first (the app: its editors and selection go with it)
//     model.rekey(list)                        fractional keys for a list in its new order: the longest run already
//                                              in order keeps its keys
// The document itself (`doc()`) is still the editor's (app.js) until the DocSession owns it.

/** @param {{ ids: { ulid(): string, keyBetween(a: string | null, b: string | null): string }, persist: any, doc: () => any, onUnplace?: (id: string) => void }} o */
export function createModel({ ids, persist, doc, onUnplace = () => {} }) {
  // by id in O(1): an id -> index map, checked on every hit (the list is still written in place
  // from many modules, so the map is never trusted): a stale hit or a miss rebuilds it once. Lookups ran inside
  // per-block loops (contexts, the compile order's comparator, panels, nesting): O(n²).
  /** @type {any[] | null} */ let mapped = null;
  /** @type {Map<string, number>} */ let at = new Map();
  const rebuild = (list) => { mapped = list; at = new Map(); list.forEach((b, i) => { if (!at.has(b.id)) at.set(b.id, i); }); };   // (the first, as find did)
  /** @param {string} id */
  function indexOf(id) {
    const list = doc()?.blocks;
    if (!list) return -1;
    let i = mapped === list ? at.get(id) : undefined;
    if (i !== undefined && list[i]?.id === id) return i;
    rebuild(list);
    i = at.get(id);
    return i === undefined ? -1 : i;
  }
  /** @param {string} id */
  const blockById = (id) => { const i = indexOf(id); return i < 0 ? undefined : doc().blocks[i]; };
  function posBetween(i) {
    const list = doc().blocks;
    return ids.keyBetween(list[i - 1]?.pos ?? null, list[i]?.pos ?? null);
  }
  function newBlock(kind, source, file, parentId = null) {
    return { id: ids.ulid(), docId: doc().id, pos: '', kind, source, file: file ?? 'main.tex', attrs: {}, rev: 0, updatedAt: Date.now(), ...(parentId ? { parentId } : {}) };
  }
  function placeBlock(b, index) {
    const list = doc().blocks;
    index = Math.max(0, Math.min(index, list.length));
    b.pos = posBetween(index);
    list.splice(index, 0, b);
    persist.saveBlock(b, { ops: [persist.op('insert', { block: { ...b } }, b.id)] });
  }
  function unplaceBlock(id) {
    const i = indexOf(id);
    if (i < 0) return null;
    onUnplace(id);
    const d = doc();
    const [b] = d.blocks.splice(i, 1);
    persist.cancel(id);
    persist.forget(id);
    const docId = d.id;
    persist.safety('deleting a block');
    persist.write(() => persist.store.deleteBlock(docId, id));
    persist.logOps([persist.op('delete', { block: { ...b } }, id)]);
    return { b, i };
  }
  function rekey(list) {
    const n = list.length, tails = [], prev = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const p = list[i].pos;
      if (!p) continue;
      let lo = 0, hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (list[tails[m]].pos < p) lo = m + 1; else hi = m; }
      prev[i] = lo > 0 ? tails[lo - 1] : -1;
      tails[lo] = i;
    }
    const keep = new Set();
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(k);
    let last = null;
    for (let i = 0; i < n; i++) {
      if (keep.has(i)) { last = list[i].pos; continue; }
      let j = i + 1;
      while (j < n && !keep.has(j)) j++;
      list[i].pos = ids.keyBetween(last, j < n ? list[j].pos : null);
      last = list[i].pos;
    }
  }
  return { blockById, indexOf, posBetween, newBlock, placeBlock, unplaceBlock, rekey };
}
