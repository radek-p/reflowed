// One document's block operations: insert, remove, duplicate, move, split, merge, set a
// source, and a structural change as a new block list (applyBlocks), each saved (doc/persist.ts through
// doc/model.js) and one undo step (doc/history.js) AS DATA: `change(label, do)` does it and records what
// it changed, { order, blocks: { id: record | null }, meta: { title | preamble | bib } } before and after, and the
// history's 'doc' applier restores either side (restore). No closures are kept. No DOM: what the page does around an
// operation (its editors) are hooks. Nested blocks (nesting/) take their own cases first, through `nest`.
// Every change ends in ONE change record, published: the page does not get told to draw from
// inside each operation; it subscribes (hooks.applied, onChange) and draws what the record names.
//
//   const ops = createOps({ model, persist, history, doc, ids, nest, hooks })
//     ops.insertBlock(index, kind, source, parentId) -> block
//     ops.removeBlock(id, { quiet }) · ops.duplicateBlock(id) · ops.moveBlock(id, to) · ops.moveBlocks(ids, to)
//     ops.splitBlock(id, offset, { edit, pane }) -> new id | null · ops.mergeBlock(id, { edit, pane }) -> boolean
//     ops.setSource(id, source, { record }) · ops.applyBlocks(label, plan, { safety })
//     ops.change(label, do, tags) -> step | null   any change of the document made by do() as one 'doc' step (find's
//                                                    replace, the preamble, the bibliography, svgfig, nesting); a change
//                                                    inside another is part of it (one step, one record)
//     ops.restore(side)                              the document's changed parts set as `side` says (undo, redo)
//     ops.onChange(fn) -> off · ops.revision()       the change records, and how many there were
//   a change record: { label, how: 'do' | 'undo' | 'redo', blocks (ids changed, added or removed), added, removed,
//     order (the order changed), meta (the fields changed: title, preamble, bib) }
//   hooks: {
//     edits: { leaveAll(o), leaveBlock(id, o), editorOf(id), sessionsOf(id) },   the editing sessions (edit/)
//     applied(record)      after every change, once: the page draws and compiles what it names
//     enterEdit(id, event, caret, line, range, pane), kindOf(source), toast(text, undo?), undo(),
//     duplicateOwned(id) -> boolean (svgfig: a block with drawn figures), gone(id) (a block left: the selection),
//     meta(field, value) (the page sets the title, the preamble or the bibliography: an undo of one)
//   }
import { splice } from './persist.ts';

export interface Block {
  id: string; pos: string; kind: string; source: string; file?: string; parentId?: string | null;
  attrs?: Record<string, unknown>; docId?: string; rev?: number; updatedAt?: number;
}
export interface Doc { id: string; title?: string; preamble?: { source: string }; bib?: unknown; blocks: Block[] }
type Rec = Omit<Block, 'rev' | 'updatedAt'>;
type Meta = 'title' | 'preamble' | 'bib';
/** one side of a 'doc' step */
export interface Side { order: string[] | null; blocks: Record<string, Rec | null>; meta: Partial<Record<Meta, unknown>> }
export interface ChangeRecord {
  label: string; how: 'do' | 'undo' | 'redo';
  blocks: string[]; added: string[]; removed: string[]; order: boolean; meta: Meta[];
}
export interface OpsModel {
  blockById(id: string): Block | undefined; indexOf(id: string): number;
  newBlock(kind: string, source: string, file?: string, parentId?: string | null): Block;
  placeBlock(b: Block, index: number): void; unplaceBlock(id: string): unknown; rekey(list: Block[]): void;
}
export interface OpsPersist {
  op(t: string, payload: object, blockId?: string): unknown; logOps(ops: unknown[]): void;
  saveBlock(b: Block): void; putMany(list: Block[]): void; safety(what: string): void; write(fn: () => unknown): unknown;
  cancel(id: string): void; forget(id: string): void; remember(b: Block): void; savedOf(id: string): string | null | undefined;
  store: { deleteBlock(doc: string, id: string): unknown };
}
export interface OpsHistory {
  record(step: object): unknown;
  define?(type: string, apply: (step: { before: Side; after: Side }, how: 'undo' | 'redo') => boolean): void;
}
export interface OpsNest {
  remove(id: string): boolean; duplicate(id: string): boolean; moveBy(id: string, by: number): boolean; moveIndex(id: string, to: number): boolean;
  split(id: string, offset: number, o: { edit: boolean }): string | boolean | null; merge(id: string, o: { edit: boolean }): boolean | null;
}
interface Session { editor?: { text: string } | null }
export interface OpsHooks {
  edits: { leaveAll(o?: object): void; leaveBlock(id: string, o?: object): void; editorOf(id: string): { text: string } | null | undefined; sessionsOf(id: string): Iterable<Session> };
  applied(rec: ChangeRecord): void;
  enterEdit(id: string, event: null, caret: number, line: null, range: null, pane: unknown): void;
  kindOf(source: string): string; toast(text: string, undo?: () => unknown): void; undo(): unknown;
  duplicateOwned(id: string): boolean; gone(id: string): void; meta?(field: string, value: unknown): void;
}

export function createOps({ model, persist, history, doc, ids, nest, hooks: h }: {
  model: OpsModel; persist: OpsPersist; history: OpsHistory; doc: () => Doc; ids: { keyBetween(a: string | null, b: string | null): string };
  nest: OpsNest; hooks: OpsHooks;
}) {
  const { blockById, indexOf, newBlock, placeBlock, unplaceBlock, rekey } = model;
  const { op, logOps, saveBlock, putMany, safety, write } = persist;
  // ── a change as data ──
  const META: Meta[] = ['title', 'preamble', 'bib'];
  const metaOf = (d: Doc, f: Meta): unknown => (f === 'preamble' ? d.preamble?.source ?? '' : f === 'bib' ? d.bib ?? null : d.title ?? '');
  /** a block as a record: what it is, not when it was saved */
  const recOf = (b: Block): Rec => { const { rev, updatedAt, ...r } = b; void rev; void updatedAt; return { ...r, attrs: { ...(b.attrs ?? {}) } }; };
  type Snap = { list: Rec[]; meta: Record<Meta, unknown> };
  const snapshot = (): Snap => { const d = doc(); return { list: d.blocks.map(recOf), meta: Object.fromEntries(META.map((f) => [f, metaOf(d, f)])) as Record<Meta, unknown> }; };
  /** what changed from snapshot a to b: each side's records of the changed blocks (null: not there), the order when it changed, the meta fields */
  function diff(a: Snap, b: Snap) {
    const A = new Map(a.list.map((r) => [r.id, r])), B = new Map(b.list.map((r) => [r.id, r]));
    const before: Side = { order: null, blocks: {}, meta: {} }, after: Side = { order: null, blocks: {}, meta: {} };
    for (const [id, r] of A) { const x = B.get(id); if (!x || JSON.stringify(r) !== JSON.stringify(x)) { before.blocks[id] = r; after.blocks[id] = x ?? null; } }
    for (const [id, x] of B) if (!A.has(id)) { before.blocks[id] = null; after.blocks[id] = x; }
    const oa = a.list.map((r) => r.id), ob = b.list.map((r) => r.id);
    if (oa.join() !== ob.join()) { before.order = oa; after.order = ob; }
    for (const f of META) if (a.meta[f] !== b.meta[f]) { before.meta[f] = a.meta[f]; after.meta[f] = b.meta[f]; }
    const empty = !Object.keys(before.blocks).length && !before.order && !Object.keys(before.meta).length;
    return { before, after, empty };
  }

  // ── the change records ──
  const listeners = new Set<(rec: ChangeRecord) => void>();
  let revision = 0, depth = 0;
  /** the record of going from side `from` to side `to` */
  const recordOf = (label: string, how: ChangeRecord['how'], from: Side, to: Side): ChangeRecord => {
    const blocks = Object.keys(to.blocks);
    return { label, how, blocks, added: blocks.filter((id) => !from.blocks[id] && to.blocks[id]), removed: blocks.filter((id) => from.blocks[id] && !to.blocks[id]),
      order: !!to.order, meta: Object.keys(to.meta) as Meta[] };
  };
  function publish(rec: ChangeRecord) {
    revision++;
    h.applied(rec);
    for (const fn of listeners) fn(rec);
  }

  /** do() now, recorded as one step (nothing recorded when it changed nothing); inside another change, part of it */
  function change(label: string, doFn: () => void, tags: object = {}): unknown {
    if (depth) { doFn(); return null; }
    const a = snapshot();
    depth++;
    try { doFn(); } finally { depth--; }
    const d = diff(a, snapshot());
    if (d.empty) return null;
    const step = history.record({ type: 'doc', label, doc: doc()?.id ?? null, before: d.before, after: d.after, ...tags });
    publish(recordOf(label, 'do', d.before, d.after));
    return step;
  }
  const perform = (label: string, d: () => void) => change(label, d);

  function insertBlock(index: number, kind = 'paragraph', source = '', parentId: string | null = null): Block {
    const p = parentId ? blockById(parentId) : undefined;   // a paragraph of this container
    const b = newBlock(kind, source, p?.file, p ? parentId : null);
    perform('insert block', () => { if (!blockById(b.id)) placeBlock(b, index); });
    return b;
  }

  function removeBlock(id: string, { quiet = false } = {}) {
    const i = indexOf(id);
    if (i < 0) return;
    if (nest.remove(id)) { if (!quiet) h.toast('Block deleted', () => h.undo()); return; }   // a container with its paragraphs; a paragraph
    perform('delete block', () => { unplaceBlock(id); });
    if (!quiet) h.toast('Block deleted', () => h.undo());
  }

  function duplicateBlock(id: string) {
    if (h.duplicateOwned(id)) return;                      // its drawn figures copied too
    const i = indexOf(id);
    const src = doc().blocks[i];
    if (nest.duplicate(id)) return;                        // a container with its paragraphs
    const nb = newBlock(src.kind, src.source, src.file, src.parentId ?? null);
    perform('duplicate block', () => { placeBlock(nb, i + 1); });
  }

  /** Move blocks `list` (ids, contiguous, in order) to before index `to` (in the list without them). */
  function moveBlocks(list: string[], to: number) {
    const blocks = () => doc().blocks;
    const moving = list.map(blockById).filter((b): b is Block => !!b);
    if (!moving.length) return;
    perform(moving.length > 1 ? 'move section' : 'move block', () => {
      for (const b of moving) blocks().splice(indexOf(b.id), 1);
      const target = Math.max(0, Math.min(to, blocks().length));
      let prev = blocks()[target - 1]?.pos ?? null;
      const next = blocks()[target]?.pos ?? null;
      const ops: unknown[] = [];
      for (const b of moving) { const p = ids.keyBetween(prev, next); ops.push(op('move', { from: b.pos, to: p }, b.id)); b.pos = p; prev = p; }
      blocks().splice(target, 0, ...moving);
      putMany(moving);
      logOps(ops);
    });
  }

  /** the document's blocks become `want` (records in order), saved and logged as ops: deletes, inserts, moves and
   *  edits; `rekey`: new keys where the order needs them (applyBlocks), else the records' own (an undo, a redo) */
  function setList(want0: Rec[], { rekey: re = false, what = null as string | null } = {}) {
    h.edits.leaveAll({ animate: false });
    const want: Block[] = want0.map((b) => ({ ...b, attrs: { ...(b.attrs ?? {}) } }));
    const d = doc();
    const cur = new Map(d.blocks.map((b) => [b.id, b]));
    const keep = new Set(want.map((w) => w.id));
    const docId = d.id;
    const ops: unknown[] = [];
    const gone = d.blocks.filter((b) => !keep.has(b.id));
    if (gone.length && what) safety(what);
    for (const b of gone) {
      h.gone(b.id);
      persist.cancel(b.id); persist.forget(b.id);
      write(() => persist.store.deleteBlock(docId, b.id));
      ops.push(op('delete', { block: { ...b } }, b.id));
    }
    if (re) rekey(want);
    const changed: Block[] = [];
    const list = want.map((w) => {
      const b = cur.get(w.id);
      if (!b) {
        const nb: Block = { ...w, docId, parentId: w.parentId ?? null, rev: 0, updatedAt: Date.now() };
        ops.push(op('insert', { block: { ...nb } }, nb.id));
        persist.remember(nb);
        changed.push(nb);
        return nb;
      }
      const moved = b.pos !== w.pos || (b.parentId ?? null) !== (w.parentId ?? null);
      const edited = b.source !== w.source;
      if (moved) ops.push(op('move', { from: b.pos, to: w.pos, parentId: w.parentId ?? null }, b.id));
      if (edited) ops.push(op('edit', { changes: [splice(persist.savedOf(b.id) ?? b.source, w.source)] }, b.id));
      if (moved || edited || b.kind !== w.kind || b.file !== w.file || JSON.stringify(b.attrs) !== JSON.stringify(w.attrs)) {
        const { rev, updatedAt, ...rest } = w;               // a record restored keeps the block's save state
        void rev; void updatedAt;
        Object.assign(b, rest, { parentId: w.parentId ?? null, attrs: w.attrs });
        persist.remember(b);
        changed.push(b);
      }
      return b;
    });
    d.blocks.splice(0, d.blocks.length, ...list);
    if (changed.length) putMany(changed);
    logOps(ops);
  }

  function applyBlocks(label: string, plan: (list: Block[]) => Rec[], { safety: what = null as string | null } = {}) {
    h.edits.leaveAll({ animate: false });
    const snap = (list: Rec[]): Block[] => list.map((b) => ({ ...b, attrs: { ...(b.attrs ?? {}) } }));
    const after = snap(plan(snap(doc().blocks)));
    perform(label, () => { setList(after, { rekey: true, what }); });
  }

  /** the history's 'doc' applier: the parts of the document a step changed set as one side of it says (its
   *  blocks' records, their order, its meta fields); the rest as it is now. `from`: the other side (the record's) */
  function restore(side: Side, how: 'undo' | 'redo' = 'undo', from: Side | null = null, label: string = how): boolean {
    const d = doc();
    if (!d) return false;
    if (Object.keys(side.blocks).length || side.order) {
      const cur = new Map(d.blocks.map((b) => [b.id, b]));
      const order = side.order ?? d.blocks.map((b) => b.id);
      const want: Rec[] = [];
      for (const id of order) {
        if (Object.prototype.hasOwnProperty.call(side.blocks, id)) { const r = side.blocks[id]; if (r) want.push(r); }
        else { const b = cur.get(id); if (b) want.push(b); }
      }
      setList(want);
    }
    for (const [f, v] of Object.entries(side.meta ?? {})) h.meta?.(f, v);
    publish(recordOf(label, how, from ?? { order: null, blocks: {}, meta: {} }, side));
    return true;
  }
  history.define?.('doc', (step, how) => (how === 'undo' ? restore(step.before, 'undo', step.after, (step as { label?: string }).label) : restore(step.after, 'redo', step.before, (step as { label?: string }).label)));

  function moveBlock(id: string, to: number) {
    const i = indexOf(id);
    if (i < 0) return;
    const n = doc().blocks.length;
    if (Math.abs(to - i) === 1 && nest.moveBy(id, Math.sign(to - i))) return;
    if (nest.moveIndex(id, Math.max(0, Math.min(to, n - 1)))) return;   // any other move that touches a container
    to = Math.max(0, Math.min(to, doc().blocks.length - 1));
    if (to === i) return;
    moveBlocks([id], to);
  }

  /** Split at a source offset; the text after goes to a new block below. */
  function splitBlock(id: string, offset: number, { edit = false, pane = null as unknown } = {}): string | null {
    const b = blockById(id);
    if (!b) return null;
    const ns = nest.split(id, offset, { edit });
    if (ns) return typeof ns === 'string' ? ns : null;
    const ed = h.edits.editorOf(id);
    const src = ed ? ed.text : b.source;
    const head = src.slice(0, offset).replace(/\s+$/, ''), tail = src.slice(offset).replace(/^\s+/, '');
    const nb = newBlock(h.kindOf(tail || ''), tail, b.file, b.parentId ?? null);      // a paragraph's new sibling
    const i = indexOf(id);
    h.edits.leaveBlock(id, { animate: false });              // its editor's last typing saved first: the step starts from it
    perform('split block', () => {
      b.source = head; b.kind = head.trim() ? h.kindOf(head) : b.kind; saveBlock(b);
      placeBlock(nb, i + 1);
    });
    if (edit) h.enterEdit(nb.id, null, 0, null, null, pane);
    return nb.id;
  }

  /** Merge a block into the one before it (a blank line between). */
  function mergeBlock(id: string, { edit = false, pane = null as unknown } = {}): boolean {
    const i = indexOf(id);
    if (i <= 0) return false;
    const nm = nest.merge(id, { edit });                     // inside a container; never across its edge
    if (nm !== null) return nm;
    const b = doc().blocks[i], prev = doc().blocks[i - 1];
    h.edits.leaveBlock(id, { animate: false });
    const joinAt = prev.source.replace(/\s+$/, '').length + 2;
    perform('merge blocks', () => {
      prev.source = `${prev.source.replace(/\s+$/, '')}\n\n${b.source.replace(/^\s+/, '')}`;
      prev.kind = h.kindOf(prev.source);
      saveBlock(prev);
      unplaceBlock(b.id);
    });
    if (edit) h.enterEdit(prev.id, null, joinAt, null, null, pane);
    return true;
  }

  /** Set a block's source from outside the editor (replace, tests). `record: false`: no undo step of its own (inside
   *  another change: part of it; alone: published as a change all the same) */
  function setSource(id: string, s: string, { record = true } = {}) {
    const b = blockById(id);
    if (!b) return;
    if (b.source === s) return;
    const apply = () => {
      b.source = s;
      b.kind = s.trim() ? h.kindOf(s) : b.kind;
      for (const x of h.edits.sessionsOf(id)) if (x.editor && x.editor.text !== s) x.editor.text = s;   // every editor of it (outside the history: this step is the change)
      saveBlock(b);
    };
    if (record || depth) { perform('edit', apply); return; }
    apply();
    publish({ label: 'edit', how: 'do', blocks: [id], added: [], removed: [], order: false, meta: [] });
  }

  return {
    insertBlock, removeBlock, duplicateBlock, moveBlocks, moveBlock, applyBlocks, splitBlock, mergeBlock, setSource, change, restore,
    /** every change record, after the page's own (hooks.applied) -> unsubscribe */
    onChange(fn: (rec: ChangeRecord) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    /** how many changes were published (a change of the document moves it) */
    revision: () => revision,
  };
}
