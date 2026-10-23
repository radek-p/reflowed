// Small helpers over DocStore: make, insert and move blocks by neighbour, so
// callers never compute fractional keys themselves. Each logs its op
// (contracts.d.ts shapes) like the app does for its own edits.

import type { Block, DocStore } from './types.ts';
import { keyBetween, byPos } from './fracindex.ts';
import { ulid } from './ulid.ts';
import { reassignIds } from '../nesting/model.ts';

/** A new block record (not stored) between two neighbours (null = start / end). */
export function newBlock(docId: string, fields: Partial<Block> & { source: string }, after: Block | null, before: Block | null): Block {
  return {
    id: fields.id ?? ulid(), docId, pos: keyBetween(after?.pos ?? null, before?.pos ?? null),
    kind: fields.kind ?? 'paragraph', source: fields.source, file: fields.file ?? after?.file ?? before?.file ?? 'main.tex',
    attrs: fields.attrs ?? {}, rev: 1, updatedAt: Date.now(),
  };
}

/** Neighbours around index i of sorted blocks, stepping past equal keys (two peers' inserts). */
function around(blocks: Block[], i: number): [Block | null, Block | null] {
  const after = i >= 0 ? blocks[i] : null;
  const before = blocks.slice(i + 1).find((b) => !after || b.pos > after.pos) ?? null;
  return [after, before];
}

/** Insert after the block `afterId` (null = at the start). */
export async function insertBlock(store: DocStore, docId: string, fields: Partial<Block> & { source: string }, afterId: string | null): Promise<Block> {
  const blocks = await store.getBlocks(docId);
  const i = afterId ? blocks.findIndex((b) => b.id === afterId) : -1;
  if (afterId && i < 0) throw new Error(`no block ${afterId}`);
  const [after, before] = around(blocks, i);
  const b = newBlock(docId, fields, after, before);
  await store.putBlock(docId, b);
  await store.appendOps(docId, [{ t: 'insert', blockId: b.id, payload: { block: b } }]);
  return b;
}

/** Move a block to just after `afterId` (null = to the start). */
export async function moveBlock(store: DocStore, docId: string, blockId: string, afterId: string | null): Promise<string> {
  const all = await store.getBlocks(docId);
  const cur = all.find((b) => b.id === blockId);
  if (!cur) throw new Error(`no block ${blockId}`);
  const blocks = all.filter((b) => b.id !== blockId).sort(byPos);
  const i = afterId ? blocks.findIndex((b) => b.id === afterId) : -1;
  const [after, before] = around(blocks, i);
  const pos = keyBetween(after?.pos ?? null, before?.pos ?? null);
  await store.putBlock(docId, { id: blockId, pos });
  await store.appendOps(docId, [{ t: 'move', blockId, payload: { from: cur.pos, to: pos } }]);
  return pos;
}

/** A copy of a document: new ids, same order, sources, files and assets; no versions. */
export async function duplicateDoc(store: DocStore, docId: string, title?: string): Promise<string> {
  const d = await store.getDoc(docId);
  if (!d) throw new Error(`no document ${docId}`);
  const assets = [];
  for (const m of d.assets) { const a = await store.getAsset(docId, m.id); if (a?.bytes) { const { id: _i, hash: _h, size: _s, ...rest } = a; assets.push({ ...rest, bytes: a.bytes }); } }
  const { id: _id, blocks, assets: _a, createdAt: _c, updatedAt: _u, openedAt: _o, deletedAt: _d, blockCount: _b, schema: _s, preamble, ...fields } = d;
  return store.createDoc({
    ...fields, title: title ?? `${d.title || 'Untitled'} (copy)`, preamble: preamble.source,
    // new ids, a paragraph's container id mapped to its copy's
    blocks: reassignIds(blocks.map((b) => ({ id: b.id, kind: b.kind, source: b.source, file: b.file, attrs: b.attrs, ...(b.parentId ? { parentId: b.parentId } : {}) })), ulid),
    assets: assets as any,
  });
}
