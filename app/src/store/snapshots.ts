// Versions of a document. A snapshot is the OpenDoc (doc + blocks +
// asset metadata, no asset bytes) gzipped; store.snapshots.put/get/list do the
// storing (core.ts). Here:
//
//   takeSnapshot(store, docId, label, kind)   "Save version" (manual) or auto
//   beforeDestructive(store, docId, what)     auto snapshot before deleting blocks, restore, replace-all …
//   restoreSnapshot(store, snapId)            snapshot of the present first, then doc + blocks become the snapshot's
//   AutoSnapshots                             every 10 min while the document changed since its newest snapshot
//
// Automatic snapshots also happen on import (createDoc with snapshotLabel)
// and on the v1 migration.

import type { AssetMeta, Block, DocPatch, DocStore, Op, SnapshotMeta } from './types.ts';

export const AUTO_INTERVAL_MS = 10 * 60 * 1000;

export async function takeSnapshot(store: DocStore, docId: string, label: string, kind: 'auto' | 'manual' = 'manual', at?: number): Promise<SnapshotMeta> {
  const id = await store.snapshots.put(docId, label, { kind, at });
  return (await store.snapshots.meta(id))!;
}

/** An automatic snapshot before something that throws work away. */
export function beforeDestructive(store: DocStore, docId: string, what: string) {
  return takeSnapshot(store, docId, `Before ${what}`, 'auto');
}

/** Bring a version back. The present is saved first ("Before restoring …"),
 *  then the doc's fields and blocks become the snapshot's (block ids kept, so
 *  caches and references by id still hold), with the op log recording each
 *  change. Assets are left as they are. Returns the safety snapshot. */
export async function restoreSnapshot(store: DocStore, snapId: string): Promise<SnapshotMeta> {
  const meta = await store.snapshots.meta(snapId);
  const snap = await store.snapshots.get(snapId);
  if (!meta || !snap) throw new Error(`no snapshot ${snapId}`);
  const safety = await beforeDestructive(store, meta.docId, `restoring “${meta.label}”`);
  const { title, meta: m, preamble, bib, settings, files } = snap;
  await replaceContent(store, meta.docId, { title, meta: m, preamble, bib, settings, files }, snap.blocks);
  await restoreFigureEdits(store, meta.docId, snap.assets ?? []);
  return safety;
}

/** Figure edits as they were in a snapshot: each asset still there (by id)
 *  gets the snapshot's `model` and `rendition` back, or loses them if it had
 *  none then. Bytes stay as they are (snapshots hold none); an asset whose
 *  bytes changed since the snapshot is left alone. */
async function restoreFigureEdits(store: DocStore, docId: string, then: AssetMeta[]) {
  const now = new Map((await store.listAssets(docId)).map((a) => [a.id, a]));
  const ops: Array<Partial<Op> & { t: Op['t'] }> = [];
  for (const old of then) {
    const cur = now.get(old.id);
    // a drawn figure (an SVG whose text the snapshot kept): its bytes come back too
    const svg = (old as any).svg as string | undefined;
    if (cur && svg != null && cur.hash !== old.hash) {
      await store.putAsset(docId, { id: cur.id, name: cur.name, mime: cur.mime, rendition: old.rendition } as any, new TextEncoder().encode(svg));
      ops.push({ t: 'meta', payload: { asset: { id: cur.id, name: cur.name, hash: old.hash, rendition: old.rendition?.hash ?? null } } } as any);
      continue;
    }
    if (!cur || cur.hash !== old.hash) continue;
    if (JSON.stringify(cur.model ?? null) === JSON.stringify(old.model ?? null) && JSON.stringify(cur.rendition ?? null) === JSON.stringify(old.rendition ?? null)) continue;
    await store.putAsset(docId, { id: cur.id, name: cur.name, mime: cur.mime, model: old.model, rendition: old.rendition } as any, null);
    ops.push({ t: 'meta', payload: { asset: { id: cur.id, name: cur.name, rendition: old.rendition?.hash ?? null } } } as any);
  }
  if (ops.length) await store.appendOps(docId, ops);
}

/** Make a document's fields and blocks these (blocks by id: kept ones updated,
 *  missing ones deleted, new ones inserted), logging each change in the op
 *  log. The caller takes the safety snapshot. */
export async function replaceContent(store: DocStore, docId: string, fields: DocPatch, blocks: Block[]): Promise<void> {
  const ops: Array<Partial<Op> & { t: Op['t'] }> = [];
  await store.putMeta(docId, fields);
  const { title, meta: m, preamble, bib, settings } = fields as any;
  ops.push({ t: 'meta', payload: { title, meta: m, preamble, bib, settings } } as any);
  const now = await store.getBlocks(docId);
  const nowById = new Map(now.map((b) => [b.id, b]));
  const keep = new Set(blocks.map((b) => b.id));
  for (const b of now) if (!keep.has(b.id)) { await store.deleteBlock(docId, b.id); ops.push({ t: 'delete', blockId: b.id, payload: { block: b } } as any); }
  const put: Block[] = [];
  for (const b of blocks) {
    const cur = nowById.get(b.id);
    if (!cur) { put.push(b); ops.push({ t: 'insert', blockId: b.id, payload: { block: b } } as any); continue; }
    if (cur.pos !== b.pos) ops.push({ t: 'move', blockId: b.id, payload: { from: cur.pos, to: b.pos } } as any);
    if (cur.source !== b.source) ops.push({ t: 'edit', blockId: b.id, payload: { from: cur.source, to: b.source } } as any);
    if (cur.pos !== b.pos || cur.source !== b.source || cur.kind !== b.kind || cur.file !== b.file || JSON.stringify(cur.attrs) !== JSON.stringify(b.attrs)
      || (cur.parentId ?? null) !== (b.parentId ?? null)) put.push(b);                     // nesting
  }
  if (put.length) await store.putBlocks(docId, put.map(({ rev: _r, updatedAt: _u, ...b }) => ({ ...b, parentId: b.parentId ?? null })));
  await store.appendOps(docId, ops);
}

/** Every `intervalMs` (default 10 min) an auto snapshot, if the document
 *  changed since its newest snapshot. `tick()` runs one check (tests call it
 *  with their own clock instead of waiting). */
export class AutoSnapshots {
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: DocStore;
  private docId: string;
  private intervalMs: number;
  private now: () => number;
  private checkEveryMs: number;
  constructor(store: DocStore, docId: string, opts: { intervalMs?: number; now?: () => number; checkEveryMs?: number } = {}) {
    this.store = store; this.docId = docId;
    this.intervalMs = opts.intervalMs ?? AUTO_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
    this.checkEveryMs = opts.checkEveryMs ?? 60_000;
  }
  start() {
    this.stop();
    this.timer = setInterval(() => { this.tick().catch((e) => console.error('auto snapshot', e)); }, this.checkEveryMs);
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One check; resolves to the snapshot taken, if any. */
  async tick(): Promise<SnapshotMeta | null> {
    const now = this.now();
    const doc = await this.store.getDocRecord(this.docId);
    if (!doc) return null;
    const last = (await this.store.snapshots.list(this.docId))[0];
    if (last && doc.updatedAt <= last.at) return null;                         // nothing new since
    if (last && now - last.at < this.intervalMs) return null;                  // too soon
    return takeSnapshot(this.store, this.docId, 'Autosave', 'auto', now);
  }
}
