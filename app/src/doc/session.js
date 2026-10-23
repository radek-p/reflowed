// @ts-check
// ONE OPEN DOCUMENT (§2 "DocSession"): the document itself and what is its own, composed
// from doc/: its writes (persist), its block list (model), its undo history (history), what its blocks compile
// against (derived), its results (results), its block operations (ops), its refs (refs/ createRefs) and its backend
// state (the engine's forDoc). No DOM: the page around it (editors, views, the compile queue) is reached through
// hooks. One per open document (an editor per document makes one); tests/test-doc-units.ts runs it on a
// Memory store.
//
//   const S = createDocSession({ store, ids, refs, backend, nest, salt, bibpane, recallsOf, readOnly, beforeDestructive, hooks })
//     S.doc                         the OpenDoc (blocks sorted by pos) | null; S.id()
//     await S.load(id) -> boolean   read from the store: sorted, its nesting repaired (and written back), its asset
//                                   hashes and stored sources known; false when it is gone
//     S.unload()                    the document closed: its results and history go
//     S.persist · S.model · S.history · S.derived · S.results · S.ops · S.refs · S.backend()
//   hooks: { saveChanged(), saveFailed(e), unplaced(id), beforeUndo(entry, how), afterUndo(entry, how), ops: (doc/ops.js hooks) }
import { createPersist } from './persist.js';
import { createModel } from './model.js';
import { createHistory } from './history.js';
import { createDerived } from './derived.js';
import { createResults } from './results.js';
import { createOps } from './ops.ts';

/** @param {{ store: any, ids: any, refs: any, backend: () => any, nest: any, salt?: () => string, bibpane?: any, recallsOf?: any, readOnly?: (doc: any) => boolean, beforeDestructive?: any, hooks: any }} o */
export function createDocSession({ store, ids, refs, backend, nest, salt, bibpane = null, recallsOf = null, readOnly = () => false, beforeDestructive = null, hooks }) {
  /** @type {any} */ let doc = null;
  const getDoc = () => doc;
  const results = createResults();
  const persist = createPersist({ store, ids, doc: getDoc, readOnly: () => readOnly(doc), beforeDestructive,
    onChange: () => hooks.saveChanged(), onError: (e) => hooks.saveFailed(e) });
  const model = createModel({ ids, persist, doc: getDoc, onUnplace: (id) => hooks.unplaced(id) });
  const history = createHistory({ before: (u, how) => hooks.beforeUndo(u, how), after: (u, how) => hooks.afterUndo(u, how) });
  const derived = createDerived({ doc: getDoc, blockById: model.blockById, nest, refs, backend, salt, bibpane, recallsOf, results });
  const ops = createOps({ model, persist, history, doc: getDoc, ids, nest, hooks: hooks.ops });

  async function load(id) {
    const d = await store.getDoc(id);
    if (!d || d.deletedAt) return false;
    doc = { ...d, blocks: d.blocks ?? await store.getBlocks(id), assets: d.assets ?? [] };
    doc.blocks.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1));
    // each container's paragraphs right after it; a tree that lost its links (orphans, a container without
    // paragraphs: old seed builds) repaired and written back
    const rep = nest.repair(doc.blocks);
    doc.blocks = nest.order(rep.blocks);
    if (rep.changed.length) { console.warn(`nesting: repaired ${rep.changed.length} block(s) of ${id}`); persist.repaired(rep.changed); }
    derived.loadAssets(doc.assets);
    return true;
  }
  return {
    get doc() { return doc; },
    id: () => doc?.id ?? null,
    load,
    /** the stored sources known (after the page has seen the document: svgfig's own files first) */
    loaded() { persist.loaded(doc.blocks); },
    unload() { doc = null; },
    refs, backend, results, persist, model, history, derived, ops,
  };
}
