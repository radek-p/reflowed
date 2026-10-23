// DocStore (contracts.d.ts) over a Backend: the rules every store shares.
//   - putBlock sets rev (+1) and updatedAt, keeps doc.blockCount and
//     doc.updatedAt, in one transaction; the op log is the caller's
//     (appendOps: the app logs its own edits, contracts.d.ts Op shapes);
//   - listDocs searches titles, authors, the abstract and block sources,
//     accent- and case-insensitively, and orders by last opened;
//   - snapshots are gzipped JSON of the OpenDoc (no asset bytes); the newest
//     KEEP_AUTO automatic ones are kept, manual ones always;
//   - changes are announced to subscribers here and in other tabs
//     (BroadcastChannel), so an open editor can reload what another tab wrote.

import type { Asset, AssetMeta, Block, Doc, DocInit, DocMeta, DocPatch, DocStore, ListQuery, Op, OpenDoc, Snapshot, SnapshotMeta, StoreEvent } from './types.ts';
import type { Backend } from './backend.ts';
import { ulid as defaultUlid } from './ulid.ts';
import { byPos, nKeysBetween } from './fracindex.ts';
import { searchKey, texToPlain } from '../io/latex-text.ts';
import { gunzipJSON, gzipJSON } from '../io/gzip.ts';
import { SCHEMA, writable, readOnlyError } from './policy.ts';
import { repairAssetRow, repairBlock, repairBlocks, repairDoc, repairs, type Repairs } from './repair.ts';

export interface CoreOptions {
  actor?: string;
  ids?: () => string;
  now?: () => number;
  /** BroadcastChannel name; null = none (default: one for IndexedDB, none for memory) */
  channel?: string | null;
}

export const KEEP_AUTO = 30;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const h = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // no WebCrypto (an insecure context): FNV-1a pair, marked
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const b of bytes) { h1 = Math.imul(h1 ^ b, 16777619) >>> 0; h2 = Math.imul(h2 ^ b, 2246822519) >>> 0; }
  return `fnv-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function blankDoc(id: string, now: number): Doc {
  return {
    id, schema: SCHEMA, title: '', createdAt: now, updatedAt: now,
    meta: { authors: [], tags: [] },
    preamble: { source: '', rev: 1 },
    bib: { kind: 'none', source: '' },
    settings: { class: 'article' },
    files: [{ path: 'main.tex', role: 'main' }],
    blockCount: 0,
  };
}

/** A few words of the body for the list: the abstract, else the first paragraph. */
function snippetOf(doc: Doc, blocks: Block[]): string {
  if (doc.meta?.abstract) return doc.meta.abstract.slice(0, 200);
  const b = blocks.find((x) => (x.kind === 'paragraph' || x.kind === 'abstract') && !(x.attrs as any)?.container);   // not a container's head
  return b ? texToPlain(b.source).slice(0, 200) : '';
}

const metaOf = (d: Doc, blocks: Block[]): DocMeta => ({
  id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, openedAt: d.openedAt,
  meta: { authors: d.meta?.authors ?? [], tags: d.meta?.tags ?? [], ...(d.meta?.arxivId ? { arxivId: d.meta.arxivId } : {}) },
  blockCount: d.blockCount ?? blocks.length, snippet: snippetOf(d, blocks),
});

const stripBytes = (row: any): AssetMeta => { const { bytes: _b, docId: _d, ...m } = row; return m; };
const mainOf = (d: Doc) => d.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
/** asset rows as read, repaired (store/repair.ts); rows without a name are left out */
const assetRows = (rows: any[], r: Repairs) => rows.map((x) => repairAssetRow(x, r)).filter(Boolean);

export class CoreStore implements DocStore {
  readonly kind: 'indexeddb' | 'memory';
  readonly actor: string;
  private b: Backend;
  private ids: () => string;
  private now: () => number;
  private subs = new Set<(e: StoreEvent) => void>();
  private bc: BroadcastChannel | null = null;

  constructor(backend: Backend, opts: CoreOptions = {}) {
    this.b = backend;
    this.kind = backend.kind;
    this.ids = opts.ids ?? defaultUlid;
    this.now = opts.now ?? Date.now;
    this.actor = opts.actor ?? `local-${this.ids().slice(-8)}`;
    const ch = opts.channel === undefined ? (backend.kind === 'indexeddb' ? 'reflowtex-editor-store' : null) : opts.channel;
    if (ch && typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(ch);
      this.bc.onmessage = (m) => { for (const f of this.subs) f({ ...(m.data as StoreEvent), remote: true }); };
    }
  }

  // damaged records (store/repair.ts): said once per record set in the console
  private warned = new Set<string>();
  private report(where: string, r: Repairs) {
    if (!r.fixed.length) return;
    const k = `${where}\u0000${r.fixed.join('\n')}`;
    if (this.warned.has(k)) return;
    this.warned.add(k);
    console.warn(`store: repaired damaged records (${where}): ${r.fixed.slice(0, 12).join('; ')}${r.fixed.length > 12 ? ` … (${r.fixed.length})` : ''}`);
  }

  private emit(e: StoreEvent) {
    for (const f of this.subs) { try { f(e); } catch (err) { console.error(err); } }
    try { this.bc?.postMessage(e); } catch { /* closed */ }
  }
  /** the backend, for store/policy.ts applyStorePolicy */
  get backend(): Backend { return this.b; }
  subscribe(fn: (e: StoreEvent) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  close() { this.bc?.close(); this.bc = null; this.b.close(); }

  // ── documents ──

  async listDocs(q: ListQuery = {}): Promise<DocMeta[]> {
    const words = q.text ? searchKey(q.text).split(/\s+/).filter(Boolean) : [];
    const fullText = q.fullText ?? true;
    const out = await this.b.run(['docs', 'blocks'], 'readonly', async (tx) => {
      const r = repairs();
      const docs = (await tx.all('docs')).map((x) => repairDoc(x, r)).filter((d): d is Doc => !!d && (!!q.includeDeleted || !d.deletedAt));
      const res: DocMeta[] = [];
      for (const d of docs) {
       try {
        const blocks = repairBlocks(await tx.all('blocks', 'byDocPos', { lower: [d.id], upper: [d.id, '￿'] }), d.id, mainOf(d), r);
        const m: DocMeta = metaOf(d, blocks);
        if (words.length) {
          const title = searchKey(d.title);
          const head = `${title} ${searchKey((d.meta?.authors ?? []).join(' '))} ${searchKey(d.meta?.abstract ?? '')} ${d.meta?.arxivId ?? ''}`;
          if (words.every((w) => title.includes(w))) m.match = { in: 'title' };
          else if (words.every((w) => head.includes(w))) m.match = { in: 'meta' };
          else {
            if (!fullText) continue;
            const keys = blocks.map((b) => searchKey(b.source));
            const all = keys.join('\n') + '\n' + head;
            if (!words.every((w) => all.includes(w))) continue;
            let i = keys.findIndex((k) => words.every((w) => k.includes(w)));
            if (i < 0) i = keys.findIndex((k) => words.some((w) => k.includes(w)));
            if (i >= 0) {
              const plain = texToPlain(blocks[i].source);
              const pk = searchKey(plain);
              let k = -1;
              for (const w of words) { k = pk.indexOf(w); if (k >= 0) break; }
              const from = Math.max(0, k - 50);
              m.snippet = (from > 0 ? '…' : '') + plain.slice(from, from + 160) + (plain.length > from + 160 ? '…' : '');
              m.match = { in: 'text', blockId: blocks[i].id };
            } else m.match = { in: 'meta' };
          }
        }
        res.push(m);
       } catch (e) { console.warn(`store: document ${d.id} left out of the list: ${(e as Error).message}`); }   // one bad document never hides the others
      }
      this.report('list', r);
      return res;
    });
    out.sort((x, y) => (y.openedAt ?? y.updatedAt) - (x.openedAt ?? x.updatedAt) || y.updatedAt - x.updatedAt);
    return q.limit ? out.slice(0, q.limit) : out;
  }

  async createDoc(init: DocInit): Promise<string> {
    const now = this.now();
    const id = init.id ?? this.ids();
    const base = blankDoc(id, now);
    const { blocks: iblocks = [], assets: iassets = [], id: _id, preamble, snapshotLabel, meta, settings, ...fields } = init;
    const doc: Doc = { ...base, ...fields, id, schema: SCHEMA, createdAt: now, updatedAt: now,
      meta: { ...base.meta, ...(meta ?? {}) }, settings: { ...base.settings, ...(settings ?? {}) } } as Doc;
    if (preamble !== undefined) doc.preamble = typeof preamble === 'string' ? { source: preamble, rev: 1 } : { source: (preamble as any).source, rev: (preamble as any).rev ?? 1 };
    const keys = nKeysBetween(null, null, iblocks.length);
    const mainPath = doc.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
    const blocks: Block[] = iblocks.map((b: any, i) => ({
      id: b.id ?? this.ids(), docId: id, pos: b.pos ?? keys[i], kind: b.kind ?? 'paragraph', source: b.source,
      file: b.file ?? mainPath, attrs: b.attrs ?? {}, rev: 1, updatedAt: now,
      ...(b.parentId ? { parentId: b.parentId } : {}),            // a paragraph of a container block
    }));
    doc.blockCount = blocks.length;
    const assets: any[] = [];
    for (const a of iassets as any[]) {
      const bytes: Uint8Array = a.bytes;
      const { bytes: _b, ...m } = a;
      assets.push({ ...m, id: m.id ?? this.ids(), mime: m.mime ?? 'application/octet-stream', hash: await sha256Hex(bytes), size: bytes.byteLength, docId: id, bytes });
    }
    await this.b.run(['docs', 'blocks', 'assets'], 'readwrite', async (tx) => {
      await tx.put('docs', doc);
      for (const b of blocks) await tx.put('blocks', b);
      for (const a of assets) await tx.put('assets', a);
    });
    this.emit({ type: 'doc', docId: id });
    if (snapshotLabel) await this.snapshots.put(id, snapshotLabel, { kind: 'auto' });
    return id;
  }

  async getDocRecord(id: string): Promise<Doc | null> {
    const r = repairs();
    const d = repairDoc(await this.b.run(['docs'], 'readonly', (tx) => tx.get('docs', id)) ?? null, r);
    if (d) this.report(`doc ${id}`, r);
    return d;
  }

  async getDoc(id: string): Promise<OpenDoc | null> {
    const r = repairs();
    const out = await this.b.run(['docs', 'blocks', 'assets'], 'readonly', async (tx) => {
      const raw = await tx.get('docs', id);
      if (!raw) return null;
      const d = repairDoc(raw, r);
      if (!d) return null;
      const blocks = repairBlocks(await tx.all('blocks', 'byDocPos', { lower: [id], upper: [id, '￿'] }), id, mainOf(d), r);
      const assets = assetRows(await tx.all('assets', 'byDoc', { only: id }), r).map(stripBytes).sort((a, b) => (a.name < b.name ? -1 : 1));
      return { ...d, blocks, assets };
    });
    // what was repaired is written back once, so the next read is clean and a later
    // edit starts from the repaired record (putBlocks merges into the stored one)
    if (out && r.changed.size && !out.readOnly) {   // a newer schema's records are never rewritten
      this.report(`doc ${id}`, r);
      const { blocks, assets: _a, ...doc } = out;
      try {
        await this.b.run(['docs', 'blocks'], 'readwrite', async (tx) => {
          if (r.changed.has(`doc:${id}`)) await tx.put('docs', doc);
          for (const b of blocks) if (r.changed.has(b.id)) await tx.put('blocks', b);
        });
      } catch (e) { console.warn(`store: the repaired records of ${id} could not be written back: ${(e as Error).message}`); }
    }
    return out;
  }

  async getBlocks(docId: string): Promise<Block[]> {
    const r = repairs();
    const out = await this.b.run(['docs', 'blocks'], 'readonly', async (tx) => {
      const d = repairDoc(await tx.get('docs', docId), repairs());
      return repairBlocks(await tx.all('blocks', 'byDocPos', { lower: [docId], upper: [docId, '￿'] }), docId, d ? mainOf(d) : 'main.tex', r);
    });
    this.report(`blocks of ${docId}`, r);
    return out;
  }

  async deleteDoc(id: string): Promise<void> {
    await this.b.run(['docs', 'blocks', 'assets', 'ops', 'snapshots'], 'readwrite', async (tx) => {
      await tx.del('docs', id);
      for (const k of await tx.keys('blocks', 'byDoc', { only: id })) await tx.del('blocks', k);
      for (const k of await tx.keys('assets', 'byDoc', { only: id })) await tx.del('assets', k);
      for (const k of await tx.keys('ops', 'byDoc', { lower: [id], upper: [id, '￿'] })) await tx.del('ops', k);
      for (const k of await tx.keys('snapshots', 'byDoc', { lower: [id, -Infinity], upper: [id, Infinity] })) await tx.del('snapshots', k);
    });
    this.emit({ type: 'deleted', docId: id });
  }

  async putMeta(id: string, patch: DocPatch): Promise<void> {
    await this.b.run(['docs'], 'readwrite', async (tx) => {
      const d = repairDoc(writable(await tx.get('docs', id))) as Doc | null;
      if (!d) throw new Error(`no document ${id}`);
      const { preamble, meta, ...rest } = patch as any;
      const content = Object.keys(rest).some((k) => k !== 'openedAt' && k !== 'deletedAt') || preamble !== undefined || meta !== undefined;
      for (const [k, v] of Object.entries(rest)) { if (v === undefined) delete (d as any)[k]; else (d as any)[k] = v; }
      if (meta) d.meta = { ...d.meta, ...meta };
      if (preamble !== undefined) {
        const src = typeof preamble === 'string' ? preamble : preamble.source;
        if (src !== d.preamble.source) d.preamble = { source: src, rev: d.preamble.rev + 1 };
      }
      if (content) d.updatedAt = Math.max(this.now(), d.updatedAt + 1);
      await tx.put('docs', d);
    });
    this.emit({ type: 'doc', docId: id });
  }

  // ── blocks ──

  async putBlock(docId: string, block: Partial<Block> & { id: string }): Promise<void> {
    await this.putBlocks(docId, [block]);
  }

  async putBlocks(docId: string, blocks: Array<Partial<Block> & { id: string }>): Promise<Block[]> {
    const now = this.now();
    const out = await this.b.run(['docs', 'blocks'], 'readwrite', async (tx) => {
      const doc = repairDoc(writable(await tx.get('docs', docId)));
      if (!doc) throw new Error(`no document ${docId}`);
      const mainPath = mainOf(doc);
      const res: Block[] = [];
      let changed = false;
      for (const b of blocks) {
        const stored = await tx.get('blocks', b.id);
        if (stored && stored.docId !== docId) throw new Error(`block ${b.id} belongs to another document`);
        const old = stored ? repairBlock(stored, docId, mainPath) ?? undefined : undefined;
        let rec: Block;
        if (!old) {
          if (typeof b.pos !== 'string' || typeof b.source !== 'string') throw new Error('a new block needs pos and source');
          rec = { id: b.id, docId, pos: b.pos, kind: b.kind ?? 'paragraph', source: b.source, file: b.file ?? mainPath,
            attrs: b.attrs ?? {}, rev: 1, updatedAt: now, ...(b.parentId ? { parentId: b.parentId } : {}) };
          doc.blockCount = (doc.blockCount ?? 0) + 1;
        } else {
          const same = (b.pos ?? old.pos) === old.pos && (b.source ?? old.source) === old.source && (b.kind ?? old.kind) === old.kind
            && (b.file ?? old.file) === old.file && JSON.stringify(b.attrs ?? old.attrs) === JSON.stringify(old.attrs)
            && (!('parentId' in b) || (b.parentId ?? null) === (old.parentId ?? null));   // nesting
          if (same) { res.push(old); continue; }
          rec = { ...old, ...b, docId, rev: old.rev + 1, updatedAt: now };
          if (rec.parentId == null) delete rec.parentId;               // left its container
        }
        await tx.put('blocks', rec);
        res.push(rec);
        changed = true;
      }
      if (changed) { doc.updatedAt = Math.max(now, doc.updatedAt + 1); await tx.put('docs', doc); }
      return res;
    });
    for (const b of out) this.emit({ type: 'block', docId, blockId: b.id });
    return out;
  }

  async deleteBlock(docId: string, blockId: string): Promise<void> {
    const gone = await this.b.run(['docs', 'blocks'], 'readwrite', async (tx) => {
      const doc = repairDoc(writable(await tx.get('docs', docId)));
      const old = await tx.get('blocks', blockId) as Block | undefined;
      if (!doc || !old || old.docId !== docId) return false;
      await tx.del('blocks', blockId);
      doc.blockCount = Math.max(0, (doc.blockCount ?? 1) - 1);
      doc.updatedAt = Math.max(this.now(), doc.updatedAt + 1);
      await tx.put('docs', doc);
      return true;
    });
    if (gone) this.emit({ type: 'block', docId, blockId });
  }

  // ── assets ──

  async putAsset(docId: string, asset: Partial<AssetMeta> & { name: string }, bytes: Uint8Array | null): Promise<AssetMeta> {
    const hash = bytes ? await sha256Hex(bytes) : null;
    const meta = await this.b.run(['docs', 'assets'], 'readwrite', async (tx) => {
      const doc = repairDoc(writable(await tx.get('docs', docId)));
      if (!doc) throw new Error(`no document ${docId}`);
      // by id, else by name (replacing a file keeps its id)
      const prev = (asset.id ? await tx.get('assets', [docId, asset.id]) : undefined)
        ?? (await tx.all('assets', 'byName', { only: [docId, asset.name] }))[0];
      const data: Uint8Array | undefined = bytes ?? prev?.bytes;
      if (!data) throw new Error(`asset ${asset.name}: no bytes`);
      const { size: _s, hash: _h, bytes: _b, ...given } = asset as any;
      // new bytes: an edit (model, rendition) of the old file no longer applies, unless given again
      const base = { ...(prev ?? {}) };
      if (prev && hash && hash !== prev.hash) { delete base.model; delete base.rendition; }
      const rec = { ...base, ...given, id: prev?.id ?? asset.id ?? this.ids(), docId, mime: given.mime ?? prev?.mime ?? 'application/octet-stream',
        hash: hash ?? prev.hash, size: data.byteLength, bytes: data };
      for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
      await tx.put('assets', rec);
      doc.updatedAt = Math.max(this.now(), doc.updatedAt + 1);
      await tx.put('docs', doc);
      return stripBytes(rec);
    });
    this.emit({ type: 'asset', docId });
    return meta;
  }

  private static full(row: any): Asset | null {
    const fixed = repairAssetRow(row);
    if (!fixed) return null;
    const { docId: _d, ...a } = fixed;
    return a;
  }

  async getAsset(docId: string, assetId: string): Promise<Asset | null> {
    const row = await this.b.run(['assets'], 'readonly', (tx) => tx.get('assets', [docId, assetId]));
    return row ? CoreStore.full(row) : null;
  }

  async getAssetByName(docId: string, name: string): Promise<Asset | null> {
    const rows = await this.b.run(['assets'], 'readonly', (tx) => tx.all('assets', 'byName', { only: [docId, name] }));
    return rows[0] ? CoreStore.full(rows[0]) : null;
  }

  async listAssets(docId: string): Promise<AssetMeta[]> {
    const rows = assetRows(await this.b.run(['assets'], 'readonly', (tx) => tx.all('assets', 'byDoc', { only: docId })), repairs());
    return rows.map(stripBytes).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async deleteAsset(docId: string, assetId: string): Promise<void> {
    await this.b.run(['docs', 'assets'], 'readwrite', async (tx) => { writable(await tx.get('docs', docId)); await tx.del('assets', [docId, assetId]); });
    this.emit({ type: 'asset', docId });
  }

  // ── op log ──

  async appendOps(docId: string, ops: Array<Partial<Op> & { t: Op['t'] }>): Promise<void> {
    if (!ops.length) return;
    await this.b.run(['docs', 'ops'], 'readwrite', async (tx) => {
      writable(await tx.get('docs', docId));
      for (const o of ops) await tx.put('ops', { payload: null, ...o, id: o.id ?? this.ids(), at: o.at ?? this.now(), actor: o.actor ?? this.actor, docId });
    });
  }

  async getOps(docId: string, since?: string): Promise<Op[]> {
    return this.b.run(['ops'], 'readonly', async (tx) => {
      const rows = await tx.all('ops', 'byDoc', { lower: [docId, since ?? ''], upper: [docId, '￿'] }) as Op[];
      return since ? rows.filter((o) => o.id > since) : rows;
    });
  }

  // ── snapshots ──

  snapshots = {
    list: async (docId: string): Promise<SnapshotMeta[]> => {
      const rows = await this.b.run(['snapshots'], 'readonly', (tx) => tx.all('snapshots', 'byDoc', { lower: [docId, -Infinity], upper: [docId, Infinity] }));
      return (rows as Snapshot[]).map(({ gz: _g, ...m }) => m).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    },
    put: async (docId: string, label: string, opts: { kind?: 'auto' | 'manual'; at?: number } = {}): Promise<string> => {
      const open = await this.getDoc(docId);
      if (!open) throw new Error(`no document ${docId}`);
      if (open.readOnly) throw readOnlyError(open);
      // a drawn figure's edit is its bytes: an SVG asset's text goes into the snapshot too
      for (const a of open.assets as any[]) {
        if (a.mime !== 'image/svg+xml' || a.trashed) continue;
        const full = await this.getAsset(docId, a.id);
        if (full?.bytes) a.svg = new TextDecoder().decode(full.bytes);
      }
      const snap: Snapshot = { id: this.ids(), docId, at: opts.at ?? this.now(), label, kind: opts.kind ?? 'manual',
        blockCount: open.blocks.length, gz: await gzipJSON(open) };
      await this.b.run(['snapshots'], 'readwrite', async (tx) => {
        await tx.put('snapshots', snap);
        if (snap.kind === 'auto') {
          const autos = (await tx.all('snapshots', 'byDoc', { lower: [docId, -Infinity], upper: [docId, Infinity] }) as Snapshot[])
            .filter((s) => s.kind === 'auto').sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
          for (const s of autos.slice(KEEP_AUTO)) await tx.del('snapshots', s.id);
        }
      });
      this.emit({ type: 'snapshot', docId });
      return snap.id;
    },
    get: async (id: string): Promise<OpenDoc | null> => {
      const s = await this.b.run(['snapshots'], 'readonly', (tx) => tx.get('snapshots', id)) as Snapshot | undefined;
      if (!s) return null;
      // a damaged version says which one, instead of a bare decompression error
      try { return await gunzipJSON<OpenDoc>(s.gz instanceof Uint8Array ? s.gz : new Uint8Array(s.gz)); }
      catch (e) { throw new Error(`the version «${s.label ?? id}» cannot be read (it is damaged: ${(e as Error).message})`); }
    },
    meta: async (id: string): Promise<SnapshotMeta | null> => {
      const s = await this.b.run(['snapshots'], 'readonly', (tx) => tx.get('snapshots', id)) as Snapshot | undefined;
      if (!s) return null;
      const { gz: _g, ...m } = s;
      return m;
    },
    delete: async (id: string): Promise<void> => {
      const m = await this.snapshots.meta(id);
      await this.b.run(['snapshots'], 'readwrite', (tx) => tx.del('snapshots', id));
      if (m) this.emit({ type: 'snapshot', docId: m.docId });
    },
  };

  // ── the engine's result cache ──

  cache = {
    get: async (key: string) => (await this.b.run(['cache'], 'readonly', (tx) => tx.get('cache', key))) ?? null,
    put: (key: string, value: unknown) => this.b.run(['cache'], 'readwrite', (tx) => tx.put('cache', value, key)),
    delete: (key: string) => this.b.run(['cache'], 'readwrite', (tx) => tx.del('cache', key)),
    // for engine/web/cache-evict.ts
    keys: async (): Promise<string[]> => (await this.b.run(['cache'], 'readonly', (tx) => tx.keys('cache'))).map(String),
    deleteMany: (keys: string[]) => this.b.run(['cache'], 'readwrite', async (tx) => { for (const k of keys) await tx.del('cache', k); }),
    // keys starting with 'rtx:' are the editor's own records (e.g. rtx:seeds), not compile results: kept
    clear: () => this.b.run(['cache'], 'readwrite', async (tx) => { for (const k of await tx.keys('cache')) if (!String(k).startsWith('rtx:')) await tx.del('cache', k); }),
  };
}
