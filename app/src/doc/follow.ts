// An open document follows what another tab writes to it. The store announces every write to the tabs (store/
// core.ts: a BroadcastChannel; this tab's own writes are not `remote`); the session listens for its own document
// and, a moment after the first event (a burst of them is one read), reads what was named back from the store and
// sets it in the document here: a block changed, added or removed (its source, kind, attrs, its place and nesting),
// the title, the preamble and the bibliography, the asset list. Nothing is written back (no echo): the other tab
// wrote it. The change is published as a change record (ops.announce), so the views, the numbering and the refs
// follow, and only the blocks whose compile key moved typeset again. No DOM: tests/test-doc-units.ts runs two
// sessions on two stores over one Memory backend.
//
// The two tabs' writes to one block, the policy:
//   - nothing typed here that is not written yet: theirs is taken, also into the block's open editors (as a remote
//     change: outside their undo, the caret mapped through it); the block's typing steps leave the undo history
//     (they no longer fit its text: applyText would put them in the wrong place);
//   - typed here and not written yet (its typing timer runs, or its write failed), or this tab's write found theirs
//     in the store instead of the source it started from (store/core.ts `expect`: persist's onConflict, `conflict`):
//     ours is kept and written now, the store's version saved first in a snapshot (Versions: "Before keeping this
//     tab's version"), and a toast says so, with Use theirs (an undo step of its own). Deleted there while typed here:
//     ours is kept and written back, with Delete (deleted there while open here with nothing typed: its editor
//     closes, and a toast says why);
//   - changed here while the store was being read: ours is newer (it is written after), and the block is looked at
//     again once that write is done.
// So neither side is lost without a word: the one not shown is in a snapshot, or the toast offers it.
// The document deleted in another tab (or moved to the deleted ones): nothing more is written, `gone()`.
//
//   const follow = createFollow(parts)
//     follow.start(docId) · follow.stop()       listen for that document's changes from other tabs / no longer
//     follow.conflict(id, stored)               this tab's write of block `id` found `stored` there (null: deleted)
//     follow.pending                            something is waiting to be read or applied
//     follow.idle() -> Promise                  resolves when nothing is (tests: editorAPI.whenIdle)
import { splice, type Persist } from './persist.ts';
import type { Block, ChangeRecord } from './ops.ts';
import type { StoreEvent } from '../store/types.ts';

type Meta = 'title' | 'preamble' | 'bib';
interface DocLike { id: string; title?: string; preamble?: { source: string; rev?: number }; bib?: unknown; blocks: Block[]; assets: unknown[]; deletedAt?: number }
type DocRecord = Omit<DocLike, 'blocks' | 'assets'>;

export interface FollowStore {
  subscribe(fn: (e: StoreEvent) => void): () => void;
  getDocRecord(id: string): Promise<DocRecord | null>;
  getBlocks(id: string): Promise<Block[]>;
  listAssets(id: string): Promise<unknown[]>;
}
export interface FollowParts {
  store: FollowStore;
  doc(): DocLike | null;
  model: { blockById(id: string): Block | undefined; indexOf(id: string): number };
  persist: Pick<Persist, 'writer' | 'typingOf' | 'writtenOf' | 'remember' | 'cancel' | 'forget' | 'saveBlock' | 'op' | 'safety' | 'stop'>;
  history: { forget(pred: (step: { type?: string; block?: string }) => boolean): number };
  derived: { loadAssets(assets: unknown[]): void; assetSig(source: string): string };
  nest: { order(blocks: Block[]): Block[] };
  ops: { announce(rec: ChangeRecord): void; setSource(id: string, source: string): void; removeBlock(id: string, o?: { quiet?: boolean }): void };
  hooks: {
    /** a block went in another tab: its editors (nothing saved from them) and the selection go */
    unplaced(id: string): void;
    edits: { followed?(id: string, change: { from: number; to: number; insert: string }, source: string): void; sessionsOf?(id: string): Iterable<unknown> };
    toast(text: string, action?: (() => unknown) | null, o?: { label?: string }): void;
    /** a meta field set as another tab wrote it: drawn here, not saved again */
    meta?(field: Meta, value: unknown, o: { save: false }): void;
    /** the document was deleted in another tab */
    gone?(): void;
  };
  /** after the first event of a burst, ms */
  delay?: number;
  clock?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void };
}

const byPos = (a: Block, b: Block) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1);
/** what a block is (not when it was saved) */
const sig = (b: Block | null | undefined) => (b ? JSON.stringify([b.pos, b.parentId ?? null, b.kind, b.file ?? null, b.attrs ?? {}, b.source]) : null);
const metaOf = (d: DocRecord, f: Meta): string => (f === 'title' ? d.title ?? '' : f === 'preamble' ? d.preamble?.source ?? '' : JSON.stringify(d.bib ?? null));
const valueOf = (d: DocRecord, f: Meta): unknown => (f === 'title' ? d.title ?? '' : f === 'preamble' ? d.preamble?.source ?? '' : d.bib ?? null);
const METAS: Meta[] = ['title', 'preamble', 'bib'];

export function createFollow(p: FollowParts) {
  const { store, model, persist, history, derived, nest, ops, hooks } = p;
  const clock = p.clock ?? { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) };
  const delay = p.delay ?? 40;
  let docId: string | null = null, off: (() => void) | null = null;
  let timer: unknown = 0, running: Promise<void> | null = null;
  // what the events named since the last read
  let want = { blocks: new Set<string>(), meta: false, assets: false, deleted: false };
  const empty = () => !want.blocks.size && !want.meta && !want.assets && !want.deleted;
  let waiters: (() => void)[] = [];

  function onEvent(e: StoreEvent) {
    if (!e.remote || e.docId !== docId) return;          // this tab's own writes, another document
    if (e.type === 'block' && e.blockId) want.blocks.add(e.blockId);
    else if (e.type === 'doc') want.meta = true;
    else if (e.type === 'asset') want.assets = true;
    else if (e.type === 'deleted') want.deleted = true;
    else return;                                          // a snapshot: nothing of the document changed
    schedule();
  }
  function schedule() {
    if (timer || running || empty()) return;
    timer = clock.setTimeout(() => { timer = 0; running = run().catch((err) => console.warn('following another tab:', err)).finally(() => { running = null; settle(); }); }, delay);
  }
  function settle() {
    if (!empty() && docId) { schedule(); return; }
    if (!timer && !running) for (const w of waiters.splice(0)) w();
  }

  async function run() {
    const id = docId;
    if (!id) return;
    const named = want;
    want = { blocks: new Set(), meta: false, assets: false, deleted: false };
    // this tab's writes reach the store first: what is read after them is another tab's
    while (persist.writer.pending) await persist.writer.idle();
    const d0 = p.doc();
    if (!d0 || d0.id !== id) return;
    const before = new Map([...named.blocks].map((b) => [b, sig(model.blockById(b))]));
    const metaBefore = Object.fromEntries(METAS.map((f) => [f, metaOf(d0, f)])) as Record<Meta, string>;
    const rec = named.meta || named.deleted ? await store.getDocRecord(id) : null;
    if ((named.meta || named.deleted) && (!rec || rec.deletedAt)) { if (docId === id) gone(); return; }
    const stored = named.blocks.size ? await store.getBlocks(id) : [];
    const assets = named.assets ? await store.listAssets(id) : null;
    const d = p.doc();
    if (!d || d.id !== id || docId !== id) return;        // closed meanwhile

    const theirs = new Map(stored.map((b) => [b.id, b]));
    const changed: string[] = [], added: string[] = [], removed: string[] = [];
    const kept: { id: string; theirs: string | null }[] = [], closed: string[] = [];
    const again: string[] = [];
    let moved = false;
    for (const bid of named.blocks) {
      const mine = model.blockById(bid) ?? null, t = theirs.get(bid) ?? null;
      if (sig(mine) !== before.get(bid)) { again.push(bid); continue; }   // changed here meanwhile: ours goes after; looked at again then
      if (!mine && !t) continue;
      const last = persist.writtenOf(bid);
      const typed = !!mine && (persist.typingOf(bid) != null || (last !== undefined && last !== mine.source) || persist.writer.failing(`block:${id}:${bid}`));
      if (!t) {                                           // deleted there
        if (typed) { kept.push({ id: bid, theirs: null }); persist.forget(bid); continue; }   // put back as new
        if ([...(hooks.edits.sessionsOf?.(bid) ?? [])].length) closed.push(bid);              // open here, nothing typed: said
        hooks.unplaced(bid);
        const i = model.indexOf(bid);
        if (i >= 0) d.blocks.splice(i, 1);
        persist.cancel(bid); persist.forget(bid);
        history.forget((s) => s.type === 'text' && s.block === bid);
        removed.push(bid);
        continue;
      }
      if (!mine) {                                        // added there
        const nb: Block = { ...t, attrs: { ...(t.attrs ?? {}) } };
        d.blocks.push(nb);
        persist.remember(nb);
        added.push(bid);
        moved = true;
        continue;
      }
      if (sig(mine) === sig(t)) continue;                 // as it is here (this tab's own write, read back)
      if ((mine.pos !== t.pos) || (mine.parentId ?? null) !== (t.parentId ?? null)) moved = true;
      const was = mine.source;
      // its place, nesting, file and attrs are theirs either way; its source (and the kind that follows it) by the policy
      mine.pos = t.pos; mine.file = t.file; mine.attrs = { ...(t.attrs ?? {}) }; mine.rev = t.rev; mine.updatedAt = t.updatedAt;
      if (t.parentId) mine.parentId = t.parentId; else delete mine.parentId;
      if (t.source !== was && typed) { kept.push({ id: bid, theirs: t.source }); persist.remember(t); }   // ours is written from theirs
      else {
        mine.kind = t.kind;
        if (t.source !== was) {
          mine.source = t.source;
          history.forget((s) => s.type === 'text' && s.block === bid);
          const [from, to, insert] = splice(was, t.source) as [number, number, string];
          hooks.edits.followed?.(bid, { from, to, insert }, t.source);
        }
        persist.remember(mine);
      }
      changed.push(bid);
    }
    if (moved) {
      const order = d.blocks.map((b) => b.id).join();
      const next = nest.order([...d.blocks].sort(byPos));
      d.blocks.splice(0, d.blocks.length, ...next);
      moved = d.blocks.map((b) => b.id).join() !== order;
    }
    keep(kept);
    if (closed.length && !kept.length) hooks.toast(closed.length > 1 ? 'Blocks open here were deleted in another tab' : 'The block open here was deleted in another tab');

    // the title, the preamble, the bibliography: theirs unless changed here meanwhile (or the title typed here)
    const metas: Meta[] = [];
    if (rec) for (const f of METAS) {
      if (metaOf(d, f) !== metaBefore[f] || metaOf(rec, f) === metaOf(d, f)) continue;
      if (f === 'title' && persist.typingOf('title') != null) continue;   // typed here: ours is written after
      hooks.meta?.(f, valueOf(rec, f), { save: false });
      metas.push(f);
    }
    // the files: their hashes again; the blocks that show one typeset again (their keys moved)
    if (assets) {
      const sigs = new Map(d.blocks.filter((b) => b.source.includes('includegraphics')).map((b) => [b.id, derived.assetSig(b.source)]));
      d.assets = assets;
      derived.loadAssets(assets);
      for (const [bid, s] of sigs) { const b = model.blockById(bid); if (b && derived.assetSig(b.source) !== s && !changed.includes(bid)) changed.push(bid); }
    }
    if (changed.length || added.length || removed.length || moved || metas.length) {
      ops.announce({ label: 'changed in another tab', how: 'remote', blocks: [...new Set([...changed, ...added, ...removed])], added, removed, order: moved || added.length > 0 || removed.length > 0, meta: metas });
    }
    for (const bid of again) want.blocks.add(bid);
  }

  /** ours kept: the store's version into a snapshot first, then ours written over it (deleted there: put back) */
  function keep(kept: { id: string; theirs: string | null }[]) {
    if (!kept.length) return;
    if (kept.some((k) => k.theirs != null)) persist.safety('keeping this tab\'s version of a block', { force: true });
    for (const k of kept) {
      const b = model.blockById(k.id);
      if (b) persist.saveBlock(b, k.theirs == null ? { ops: [persist.op('insert', { block: { ...b } }, b.id)] } : {});
    }
    tellKept(kept);
  }
  /** this tab's write of block `bid` found another tab's source there, or none (persist's onConflict): nothing was written */
  function conflict(bid: string, stored: Block | null) {
    const b = model.blockById(bid);
    if (!b || !docId) return;
    if (stored && stored.source === b.source) { persist.remember(stored); return; }   // the same text both ways
    if (stored) persist.remember(stored); else persist.forget(bid);                   // ours is written from theirs
    keep([{ id: bid, theirs: stored?.source ?? null }]);
  }
  function tellKept(kept: { id: string; theirs: string | null }[]) {
    if (kept.length > 1) { hooks.toast(`${kept.length} blocks were also changed in another tab: yours are kept (theirs are in Versions)`); return; }
    const k = kept[0]!;
    if (k.theirs == null) hooks.toast('This block was deleted in another tab: yours is kept', () => ops.removeBlock(k.id, { quiet: true }), { label: 'Delete' });
    else { const theirs = k.theirs; hooks.toast('This block was also changed in another tab: yours is kept', () => ops.setSource(k.id, theirs), { label: 'Use theirs' }); }
  }

  function gone() {
    stop();
    persist.stop();                                       // nothing more written: the store would refuse it
    hooks.gone?.();
  }

  function stop() {
    off?.(); off = null; docId = null;
    clock.clearTimeout(timer); timer = 0;
    want = { blocks: new Set(), meta: false, assets: false, deleted: false };
    settle();
  }

  return {
    start(id: string) { stop(); docId = id; off = store.subscribe(onEvent); },
    stop, conflict,
    get pending() { return !!timer || !!running || !empty(); },
    idle(): Promise<void> { return timer || running || !empty() ? new Promise((r) => { waiters.push(r); if (!timer && !running) schedule(); }) : Promise.resolve(); },
  };
}
export type Follow = ReturnType<typeof createFollow>;
