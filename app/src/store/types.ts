// The editor's data model: contracts.d.ts plus the fields
// the store and io add. Every addition is optional, so a contract-shaped
// record is always valid here; the additions are listed under "Edits

import type * as C from '../contracts';

export type ULID = C.ULID;
export type Op = C.Op;
export type OpenDocBase = C.OpenDoc;

export interface DocFile {
  path: string;
  role: 'main' | 'input';
  /** the file whose body \input's this one (absent for main) */
  parent?: string;
  /** the exact command in the parent, e.g. '\\input{src/fw}' */
  cmd?: string;
  /** whitespace in the parent before `cmd` */
  before?: string;
  /** main: the `\begin{document}` as written */
  head?: string;
  /** text after the file's last block (main: whitespace, `\end{document}` and anything after) */
  tail?: string;
  /** 'latin1' when the file was not UTF-8 (export writes it back so) */
  encoding?: 'utf8' | 'latin1';
  /** 'crlf' when the file had Windows line ends (blocks hold '\n' only) */
  eol?: 'lf' | 'crlf';
}

export interface Doc extends C.Doc {
  /** last opened (home sorts by it) */
  openedAt?: number;
  /** soft delete (home's undo); listDocs hides these */
  deletedAt?: number;
  /** set when read, never stored: a document of another core version (store/policy.ts), which this build
   *  shows but must not write (every store write throws NewerSchemaError or OlderCoreError): 'newer-schema' a newer
   *  build made it; 'older-core' an older one (the app offers export and start anew, app/older-core.js) */
  readOnly?: 'newer-schema' | 'older-core';
  meta: { authors?: string[]; arxivId?: string; tags?: string[]; abstract?: string; importedFrom?: string; migratedFrom?: string };
  bib: C.Doc['bib'] & { path?: string };
  settings: C.Doc['settings'] & { classOptions?: string };
  files: DocFile[];
  /** kept by the store */
  blockCount?: number;
}

export type Block = C.Block;

/** A bibliography entry as the importer lists it (io/meta.ts bblEntries, bibEntries). */
export interface BibEntryRef { key: string; type: string }

/** Known attrs (all optional): see io/split.ts. */
export interface BlockAttrs {
  before?: string;       // whitespace before the block in its file (export restores it)
  joined?: boolean;      // no blank line before it in the source
  env?: string;          // the environment the block is
  level?: string;        // heading command ('section', 'subsection*')
  restatable?: string;   // \begin{restatable}{type}{name}: name
  restates?: string;     // a \name* copy of a restatable
  theorem?: string;      // restatable's theorem type
  v1Id?: string;         // the v1 id of a migrated block
}

export interface AssetMeta extends C.AssetMeta {
  ipe?: boolean;
}
export interface Asset extends AssetMeta { bytes?: Uint8Array }

export interface OpenDoc extends Doc { blocks: Block[]; assets: AssetMeta[] }

export interface DocMeta extends C.DocMeta {
  /** listDocs with a text query: where it matched (the snippet is then around the match) */
  match?: { in: 'title' | 'meta' | 'text'; blockId?: ULID };
}

export interface ListQuery {
  text?: string;
  limit?: number;
  /** also search block sources (default true) */
  fullText?: boolean;
  includeDeleted?: boolean;
}

export interface SnapshotMeta { id: ULID; docId: ULID; at: number; label: string; kind?: 'auto' | 'manual'; blockCount?: number }
export interface Snapshot extends SnapshotMeta { gz: Uint8Array }

export interface DocInit extends Omit<C.DocInit, 'files' | 'meta' | 'bib' | 'settings'> {
  id?: ULID;
  meta?: Doc['meta'];
  bib?: Doc['bib'];
  settings?: Partial<Doc['settings']>;
  files?: DocFile[];
  /** the doc was imported: take an auto snapshot with this label */
  snapshotLabel?: string;
}

export type DocPatch = Partial<Omit<Doc, 'id' | 'schema' | 'createdAt' | 'blockCount'>>;

export interface StoreEvent {
  type: 'doc' | 'block' | 'asset' | 'snapshot' | 'deleted';
  docId: ULID;
  blockId?: ULID;
  /** from another tab (BroadcastChannel) */
  remote?: boolean;
}

/** contracts.d.ts DocStore, with the extras the store offers. */
export interface DocStore extends C.DocStore {
  readonly kind: 'indexeddb' | 'memory';
  /** who writes the op log's entries from this store (a per-page id unless given) */
  readonly actor: string;
  listDocs(q?: ListQuery): Promise<DocMeta[]>;
  createDoc(init: DocInit): Promise<ULID>;
  getDoc(id: ULID): Promise<OpenDoc | null>;
  /** the doc record only (no blocks) */
  getDocRecord(id: ULID): Promise<Doc | null>;
  /** blocks in document order */
  getBlocks(docId: ULID): Promise<Block[]>;
  putMeta(id: ULID, patch: DocPatch): Promise<void>;
  /** expect: the source the writer last saw stored; another one there (another tab wrote it meanwhile, or deleted the
   *  block): BlockConflict (core.ts), nothing written */
  putBlock(docId: ULID, block: Block | (Partial<Block> & { id: ULID; expect?: string })): Promise<void>;
  /** several blocks in one transaction (a move, a paste, a restore) */
  putBlocks(docId: ULID, blocks: Array<Block | (Partial<Block> & { id: ULID; expect?: string })>): Promise<Block[]>;
  putAsset(docId: ULID, asset: Partial<AssetMeta> & { name: string }, bytes: Uint8Array | null): Promise<AssetMeta>;
  getAsset(docId: ULID, assetId: ULID): Promise<Asset | null>;
  getAssetByName(docId: ULID, name: string): Promise<Asset | null>;
  listAssets(docId: ULID): Promise<AssetMeta[]>;
  deleteAsset(docId: ULID, assetId: ULID): Promise<void>;
  appendOps(docId: ULID, ops: Array<Partial<Op> & { t: Op['t'] }>): Promise<void>;
  getOps(docId: ULID, since?: ULID): Promise<Op[]>;
  snapshots: {
    list(docId: ULID): Promise<SnapshotMeta[]>;
    /** snapshot the current state; kind 'manual' unless said */
    put(docId: ULID, label: string, opts?: { kind?: 'auto' | 'manual'; at?: number }): Promise<ULID>;
    /** decoded */
    get(snapshotId: ULID): Promise<OpenDoc | null>;
    meta(snapshotId: ULID): Promise<SnapshotMeta | null>;
    delete(snapshotId: ULID): Promise<void>;
  };
  cache: {
    get(key: string): Promise<any>;
    put(key: string, result: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  subscribe(fn: (e: StoreEvent) => void): () => void;
  close(): void;
}
