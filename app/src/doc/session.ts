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
//     S.results.edited              when the document was last edited: the store's updatedAt on load, then now at each
//                                   edit here (persist onEdit: a keystroke, an op) and each change record (one followed too)
//     S.follow                      what other tabs write to the document, followed while it is open (doc/follow.ts)
//   hooks: { saveChanged(), saveFailed(e), unplaced(id), beforeUndo(entry, how), afterUndo(entry, how), ops: (doc/ops.ts hooks),
//            gone() (the document was deleted in another tab: nothing more is written) }
import { createPersist, type PersistStore } from './persist.ts';
import { createModel } from './model.js';
import { createHistory } from './history.js';
import { createDerived } from './derived.js';
import { createResults } from './results.js';
import { createOps, type Block, type Doc, type OpsHooks, type OpsNest } from './ops.ts';
import { createFollow, type FollowStore } from './follow.ts';

/** the open document as the session holds it: the store's OpenDoc, its blocks sorted */
export interface OpenDoc extends Doc { assets: unknown[]; readOnly?: string; deletedAt?: number; [k: string]: unknown }
/** what the session reads from the store (contracts.d.ts DocStore; the writes are persist's) */
export interface SessionStore extends FollowStore, PersistStore {
  getDoc(id: string): Promise<(Omit<OpenDoc, 'blocks' | 'assets'> & { blocks?: Block[]; assets?: unknown[] }) | null>;
  [k: string]: unknown;
}
/** the nesting (nesting/app.js) as the session uses it: the tree repaired and ordered on open, ops' cases (and derived's) */
export interface SessionNest extends OpsNest {
  repair(blocks: Block[]): { blocks: Block[]; changed: Block[] };
  order(blocks: Block[]): Block[];
}
export interface SessionHooks {
  saveChanged(): void;
  saveFailed(e: unknown): void;
  unplaced(id: string): void;
  beforeUndo(step: unknown, how: 'undo' | 'redo'): void;
  afterUndo(step: unknown, how: 'undo' | 'redo'): void;
  ops: OpsHooks;
  gone?(): void;
}
export interface SessionOptions {
  store: SessionStore;
  ids: { ulid(): string; keyBetween(a: string | null, b: string | null): string };
  refs: unknown;
  backend: () => unknown;
  nest: SessionNest;
  salt?: () => string;
  bibpane?: unknown;
  recallsOf?: ((blocks: Block[]) => Map<string, string>) | null;
  readOnly?: (doc: OpenDoc | null) => boolean;
  beforeDestructive?: ((store: unknown, docId: string, what: string) => unknown) | null;
  hooks: SessionHooks;
}

const byPos = (a: Block, b: Block) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1);

export function createDocSession({ store, ids, refs, backend, nest, salt, bibpane = null, recallsOf = null, readOnly = () => false, beforeDestructive = null, hooks }: SessionOptions) {
  let doc: OpenDoc | null = null;
  const getDoc = () => doc;
  const results = createResults();
  const persist = createPersist({ store, ids, doc: getDoc, readOnly: () => readOnly(doc), beforeDestructive,
    onChange: () => hooks.saveChanged(), onError: (e) => hooks.saveFailed(e), onConflict: (id, stored) => follow.conflict(id, stored),
    onEdit: () => { results.edited.value = Date.now(); } });
  const model = createModel({ ids, persist, doc: getDoc, onUnplace: (id) => hooks.unplaced(id) });
  const history = createHistory({ before: (u, how) => hooks.beforeUndo(u, how), after: (u, how) => hooks.afterUndo(u, how) });
  const derived = createDerived({ doc: getDoc, blockById: model.blockById, nest, refs, backend, salt, bibpane, recallsOf, results });
  const ops = createOps({ model, persist, history, doc: getDoc as () => Doc, ids, nest, hooks: hooks.ops });
  // when it was last edited (results.edited): the store's time on open, then every change here or followed from another tab
  ops.onChange(() => { results.edited.value = Date.now(); });
  const follow = createFollow({ store, doc: getDoc, model, persist, history, derived, nest, ops,
    hooks: { unplaced: (id) => hooks.unplaced(id), edits: hooks.ops.edits, toast: (t, a, o) => hooks.ops.toast(t, a, o), meta: hooks.ops.meta ? (f, v, o) => hooks.ops.meta?.(f, v, o) : undefined, gone: () => hooks.gone?.() } });

  async function load(id: string): Promise<boolean> {
    const d = await store.getDoc(id);
    if (!d || d.deletedAt) return false;
    const opened: OpenDoc = { ...d, blocks: d.blocks ?? await store.getBlocks(id), assets: d.assets ?? [] } as OpenDoc;
    opened.blocks.sort(byPos);
    // each container's paragraphs right after it; a tree that lost its links (orphans, a container without
    // paragraphs: old seed builds) repaired and written back
    const rep = nest.repair(opened.blocks);
    opened.blocks = nest.order(rep.blocks);
    doc = opened;
    results.edited.value = typeof opened.updatedAt === 'number' ? opened.updatedAt : 0;
    persist.start();
    follow.start(id);                                    // from here on, what another tab writes to it is followed
    if (rep.changed.length) { console.warn(`nesting: repaired ${rep.changed.length} block(s) of ${id}`); persist.repaired(rep.changed); }
    derived.loadAssets(opened.assets);
    return true;
  }
  return {
    get doc() { return doc; },
    id: () => doc?.id ?? null,
    load,
    /** the stored sources known (after the page has seen the document: svgfig's own files first) */
    loaded() { if (doc) persist.loaded(doc.blocks); },
    unload() { follow.stop(); doc = null; },
    refs, backend, results, persist, model, history, derived, ops, follow,
  };
}
export type DocSession = ReturnType<typeof createDocSession>;
