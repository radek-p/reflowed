//
// Conventions
// - Ids are ULIDs (26 chars, Crockford base32, time-sortable). A block's id
//   never changes (moves, edits, reloads, export/import round trip keep it).
// - `pos` is a fractional index: a string compared with plain `<` on code
//   units (never localeCompare), between two neighbours there is always
//   another (`keyBetween(a, b)`; a = null: before the first, b = null: after
//   the last). Blocks are ordered by (pos, id).
// - Times are ms since the epoch (Date.now()). Lengths from TeX are in pt
//   (TeX points, 72.27/in); from the page in CSS px; `bp` only where named.
// - Every store and backend call is async. Nothing outside store/ touches
//   IndexedDB; nothing outside engine/ talks to the worker.
// - A block's `source` has no \begin{document}; the preamble has no
//   \documentclass line unless the doc really has one (settings.class then
//   says which).
// - Module entry points, resolved by the app's esbuild as `rtx:<name>` to
//   the first file that exists, else src/app/stubs.js (`?stubs=refs,store`
//   in the URL forces the stub at run time):
//     rtx:store    web/src/store/index.js     createDocStore(opts?): Promise<DocStore>; ids: Ids;
//                                             takeSnapshot, beforeDestructive, AutoSnapshots, …
//     rtx:io       web/src/io/index.js        io: IO; importIntoStore, loadSeed, …
//     rtx:home     web/src/home/index.js      mountHome(el, ctx: HomeContext): Mounted
//     rtx:refs     web/src/refs/index.js      refs: Refs
//     rtx:backend  engine/web/backend.js      createBackend(opts?): Backend
// - Block attrs are the importer's and export's: code that edits a block keeps
//   every attr it does not own (`before` above all: export rebuilds files from it).
// - Nested blocks (web/src/nesting/): a *container* block is a
//   long theorem-like or proof environment split into paragraphs. Its source is
//   only the head (`\\begin{proof}[Proof of \\Cref{x}]`), `attrs.container` keeps
//   the end line; each paragraph is an ordinary block with `parentId` = the
//   container's id. A child's `pos` is in the document's one order (right after
//   its container), so sorting by pos still gives document order; nesting/model.ts
//   `treeOrder` derives the same order from the tree. Export joins them back into
//   one environment; markers write `parent=<id>`. One level only.

// ── Documents ───────────────────────────────────────────────────────────
// store/types.ts extends these (and adds nothing required).

export type ULID = string;
export type FracIndex = string;

export interface DocMeta {
  id: ULID;
  title: string;
  createdAt: number;
  updatedAt: number;
  openedAt?: number;               // last opened (home: "last opened")
  meta: { authors?: string[]; arxivId?: string; tags?: string[] };
  blockCount?: number;
  snippet?: string;                // the abstract, or the text around a search match
}

/** One project file as imported (export rebuilds the files from these). */
export interface DocFile {
  path: string;                    // 'main.tex', 'src/intro.tex'
  role: 'main' | 'input';
  parent?: string;                 // the file that \input's this one
  cmd?: string;                    // the exact command in the parent, '\\input{src/fw}'
  before?: string;                 // whitespace in the parent before `cmd`
  head?: string;                   // main: \begin{document} as written
  tail?: string;                   // text after the file's last block
  encoding?: 'utf8' | 'latin1';
  eol?: 'lf' | 'crlf';
}

export interface Doc {
  id: ULID;
  schema: 2;
  title: string;
  createdAt: number;
  updatedAt: number;
  openedAt?: number;
  deletedAt?: number;              // soft delete (home's undo); listDocs hides these
  blockCount?: number;             // kept by the store
  meta: { authors?: string[]; arxivId?: string; tags?: string[]; abstract?: string; importedFrom?: string; migratedFrom?: string };
  preamble: { source: string; rev: number };   // everything before \begin{document}, \documentclass included when the source had one
  bib: { kind: 'bbl' | 'bib' | 'none'; source: string; path?: string; entries?: BibEntry[] | { key: string; type: string }[] };
  settings: { class: string; classOptions?: string; textwidthPt?: number; engineOpts?: Record<string, unknown> };
  files: DocFile[];
}

/** getDoc: the document with its blocks (sorted by pos) and its assets' metadata (bytes: getAsset). */
export interface OpenDoc extends Doc {
  blocks: Block[];
  assets: AssetMeta[];
}

/** Built-in kinds; a theorem-like block's kind is its environment's name
 *  (`lemma`, `claim`, `bound`: what the preamble declares; a restatable is its
 * */
export type BuiltinKind =
  | 'paragraph' | 'heading' | 'subheading' | 'subsubheading' | 'paragraph-heading'
  | 'title' | 'abstract' | 'equation' | 'align' | 'proof' | 'itemize' | 'enumerate'
  | 'figure' | 'table' | 'algorithm' | 'bibliography' | 'appendix' | 'toc' | 'hint' | 'note' | 'raw'
  | 'macros'     // top-level definitions in the body: typeset nothing; later blocks see them (refs.contextFor)
  | 'comment'    // a comment-only chunk
  | 'input';     // an \input kept as text
export type BlockKind = BuiltinKind | string;

export interface BlockAttrs {
  before?: string;                 // whitespace before the block in its file (keep it when editing)
  joined?: boolean;                // no blank line before it: continues the paragraph above
  container?: { end: string; before: string; after: string };   // a container: its end line, the whitespace before it, what followed it
  env?: string;                    // the environment the block is ('lemma', 'figure*')
  level?: string;                  // heading command ('section', 'subsection*')
  restatable?: string;             // \begin{restatable}{type}{name}: name
  restates?: string;               // a \name* recall of a restatable
  theorem?: string;                // a restatable's theorem type
  v1Id?: string;
  [k: string]: unknown;
}

export interface Block {
  id: ULID;
  docId: ULID;
  pos: FracIndex;
  kind: BlockKind;
  source: string;
  file: string;                    // origin path ("src/intro.tex"); "main.tex" for new blocks
  attrs: BlockAttrs;
  parentId?: ULID | null;          // the container this block is a paragraph of (null/absent: top level)
  rev: number;                     // set by the store (+1 per put)
  updatedAt: number;               // set by the store
}

export interface AssetMeta {
  id: ULID;
  name: string;                    // as referenced: "figures/flips.pdf"
  mime: string;
  hash: string;                    // hex SHA-256 of bytes
  size: number;
  ipe?: boolean;                   // a PDF carrying an Ipe document
  model?: { kind: 'ipe'; xml: string; bbox?: unknown };
  rendition?: { svg?: string; tikz?: string; hash: string };
  owner?: ULID;                    // the block whose "Drawn figure" made it: the file follows that block
  trashed?: { at: number; block: ULID };   // its owner gone and nothing references it: kept, not exported (undo brings it back)
  svg?: string;                    // in a snapshot only: a drawn figure's text (its edit is its bytes)
}
export interface Asset extends AssetMeta { bytes?: Uint8Array }

export type Op =
  | OpBase<'insert', { block: Block }>
  | OpBase<'delete', { block: Block }>                 // the block as it was (undo)
  | OpBase<'move', { from: FracIndex; to: FracIndex; parentId?: ULID | null }>   // parentId: moved into / out of a container
  | OpBase<'edit', { from: string; to: string } | { changes: [number, number, string][] }>
  | OpBase<'meta', Partial<Pick<Doc, 'title' | 'meta' | 'preamble' | 'bib' | 'settings'>>>;
interface OpBase<T extends string, P> {
  id: ULID; docId: ULID; blockId?: ULID; t: T; payload: P; at: number; actor: string;
}

export interface Snapshot {
  id: ULID; docId: ULID; at: number; label: string;
  kind?: 'auto' | 'manual';
  blockCount?: number;
  gz: Uint8Array;                  // gzip(JSON of the OpenDoc without asset bytes)
}

export interface DocInit {
  id?: ULID;
  title?: string;
  preamble?: string;
  bib?: Doc['bib'];
  settings?: Partial<Doc['settings']>;
  meta?: Doc['meta'];
  files?: DocFile[];
  blocks?: { kind?: BlockKind; source: string; file?: string; attrs?: BlockAttrs; id?: ULID; parentId?: ULID }[];   // parentId: needs ids
  assets?: { name: string; mime: string; bytes: Uint8Array; model?: AssetMeta['model'] }[];
  snapshotLabel?: string;          // imported: take an auto snapshot with this label
}

export interface DocStore {
  readonly kind: 'indexeddb' | 'memory' | string;
  listDocs(q?: { text?: string; limit?: number; fullText?: boolean; includeDeleted?: boolean }): Promise<DocMeta[]>;
  createDoc(init: DocInit): Promise<ULID>;
  getDoc(id: ULID): Promise<OpenDoc | null>;
  deleteDoc(id: ULID): Promise<void>;
  putMeta(id: ULID, patch: Partial<Omit<Doc, 'id' | 'schema' | 'createdAt'>>): Promise<void>;
  putBlock(docId: ULID, block: Block): Promise<void>;       // insert or replace (by id); the store sets rev, updatedAt
  deleteBlock(docId: ULID, blockId: ULID): Promise<void>;
  putAsset(docId: ULID, asset: Omit<AssetMeta, 'size' | 'hash'> & Partial<AssetMeta>, bytes: Uint8Array | null): Promise<AssetMeta>;
  getAsset(docId: ULID, assetId: ULID): Promise<Asset | null>;
  /** the op log is the caller's: the app appends one Op per change */
  appendOps(docId: ULID, ops: Op[]): Promise<void>;
  snapshots: {
    list(docId: ULID): Promise<Omit<Snapshot, 'gz'>[]>;
    put(docId: ULID, label: string, opts?: { kind?: 'auto' | 'manual'; at?: number }): Promise<ULID>;   // snapshots the current state
    get(snapshotId: ULID): Promise<OpenDoc | null>;           // decoded
  };
  cache: {
    get(key: string): Promise<BlockResult | null>;
    put(key: string, result: BlockResult): Promise<void>;
  };
  // store also has (optional in the contract): getDocRecord, getBlocks,
  // putBlocks (one transaction: moves, paste), getAssetByName (picture shim),
  // listAssets, deleteAsset, getOps, snapshots.meta/delete, cache.delete/clear,
  // subscribe(fn) (this and other tabs), close.
  getBlocks?(docId: ULID): Promise<Block[]>;
  putBlocks?(docId: ULID, blocks: Block[]): Promise<Block[]>;
  getAssetByName?(docId: ULID, name: string): Promise<Asset | null>;
  subscribe?(fn: (e: { type: 'doc' | 'block' | 'asset' | 'snapshot' | 'deleted'; docId: ULID; blockId?: ULID; remote?: boolean }) => void): () => void;
}

/** Fractional indexing and ids (rtx:store exports `ids`). */
export interface Ids {
  ulid(): ULID;
  keyBetween(a: FracIndex | null, b: FracIndex | null): FracIndex;
}

// ── Import / export ─────────────────────────────────────────────────────

export interface IO {
  /** A .tar.gz / .tgz / arXiv e-print / .zip / .tex → a DocInit (follows \input, collects assets and bbl). */
  importFile(file: File | { name: string; bytes: Uint8Array }): Promise<DocInit>;
  exportZip(doc: OpenDoc, getAsset: (id: ULID) => Promise<Asset | null>): Promise<Blob>;
  exportTex(doc: OpenDoc): string;                            // one file (inputs inlined; images not in it)
}

export interface HomeContext {
  store: DocStore;
  io?: IO;
  open(id: ULID): void;                                       // navigates to #/doc/<id>
  undoMs?: number;
}
export interface Mounted { destroy(): void }


// ── Compile backend ─────────────────────────────────────────────────────

export interface Problem {
  severity: 'error' | 'warning';
  message: string;
  line: number | null;             // the block's own line, 1-based (preamble's for preamble problems)
  context?: string;
  detail?: string;
}

/** TeX glue in pt. */
export interface Glue { pt: number; plus?: number; plusOrder?: 0 | 1 | 2 | 3; minus?: number; minusOrder?: 0 | 1 | 2 | 3 }

/** V5/V6: what the page needs to set the gap between two blocks as TeX would
 *  (the gap = TeX's vertical list between the previous block's last line and
 *  this block's first). All pt. */
export interface BlockSpacing {
  above: Glue;                     // the block's leading vertical glue (before its first box)
  below: Glue;                     // its trailing glue (after its last box)
  aboveAddv?: boolean;             // `above` came from \addvspace (max-merge with the previous `below`)
  belowAddv?: boolean;
  firstHeight: number;             // height of the first line/box
  lastDepth: number;               // depth of the last line/box
  parskip: Glue;                   // \parskip in force at the block's start
  baselineskip: Glue;
  lineskip: Glue;
  lineskiplimit: number;
  indent: boolean;                 // the first paragraph is indented (false after a heading's \@afterheading)
  /** the pieces as TeX appended them (engine/src/spacing.ts), for engine/web/spacing.ts gapBetween */
  raw?: { above: number[][]; below: number[][] };
}

/** engine-api's source-map sidecar for the block (sourcemap.ts `SourceMap`):
 *  per content item, 5 numbers per glyph (file index, line, column, length,
 *  via). `file`/`firstLine`: where the block's own text sits in the compiled
 *  file. The app maps a clicked glyph to an offset in `source` with it. */
export interface BlockSourceMap {
  v: 1;
  files: string[];
  items: Record<string, number[]>;
  file: string;
  firstLine: number;
}

export interface BlockResult {
  key: string;                     // the compile key (cache key)
  status: 'ok' | 'error';
  errors: Problem[];
  warnings: Problem[];
  nodelist: string | null;         // base64, what reflowtex.host.mount reads (data-nodelist-b64)
  cached?: boolean;
  ms?: number;
  spacing?: BlockSpacing;
  sourcemap?: BlockSourceMap;
  /** legacy: one source offset per drawn glyph, viewer order */
  sourceMap?: { glyphs: number[] };
  capture?: {
    engine: 'tectonic' | 'luatex';
    build: string;                 // engine build id (part of cache keys)
    id: string;                    // this capture's id (run / output)
    anchors?: string[];            // label anchors in the block (hyperref dests)
    links?: string[];              // link targets used
  };
  transient?: boolean;             // an infrastructure error (not the source's fault): not cached, compiled again when asked
  /** what the block's runs read of the document: every file of it TeX opened (a figure a macro places too) and
   *  every name TeX looked for that nothing had, in the order asked (the engine's record; a block fact) */
  files?: string[];
  /** the signature each of those files had when the block compiled (name -> hash+rendition; a name not here was
   *  not in the document): a stored result is used only while they still hold */
  fileSigs?: Record<string, string>;
}

export interface BlockRequest {
  id: ULID;
  source: string;
  kind?: BlockKind;
  context?: string;                // refs.contextFor(...): TeX prepended to the block, part of its key
}

export interface CompileRequest {
  preamble: string;
  blocks: BlockRequest[];
  keep: string[];                  // keys of the doc's other blocks (fonts are per document)
  /** typeset at most this many (the rest of the blocks with no stored result are left out of the response: asked
   *  again); the ones with a result come back whatever the limit. None: all. */
  limit?: number;
  /** each block's result as soon as it is ready; the response still carries all */
  onBlock?(id: ULID, result: BlockResult): void;
}

export interface CompileResponse {
  blocks: Record<ULID, BlockResult>;
  /** the preamble's problems; files: what its warm read of the document (as BlockResult.files) */
  preamble: { errors: Problem[]; warnings: Problem[]; files?: string[] };
  fonts: Record<string, string>;   // original -> served (server backends); {} when the backend installs fonts itself
  stats: { compiled: number; cached: number; runs: number; ms: number };
}

export interface Backend {
  id: string;
  label: string;
  available(): Promise<boolean>;
  /** start the engine early; warm for this preamble (and bib) */
  warm?(): Promise<unknown>;
  /** Compile the blocks (cached results come back without compiling). How it fails:
   *  - a block's own problem is its result: status 'error' with its errors, the others unaffected;
   *  - the engine crashing on a block, or a block that never finishes (timeoutMs): that block's
   *    error, the engine restarted, the next block compiled (a crash: transient, so compiling it
   *    again may work; a timeout: not transient, the source loops);
   *  - the promise rejects only when the engine cannot run: its worker did not start
   *    (Error & { dead: true }) or its files are missing or damaged (the single file: Error &
   *    { fatal: true }, and every later call rejects at once with the same message);
   *  - a stored result that is damaged is a miss (compiled again), never shown;
   *  - a stored result whose files (BlockResult.files) are no longer as they were is a miss too (a figure a
   *    macro places, replaced). */
  compile(req: CompileRequest): Promise<CompileResponse>;
  /** A label/minipage for a figure (FigureEditor), not part of the doc: the
   *  current preamble; `widthBp` sets \hsize (minipage). */
  compileSnippet(source: string, opts?: { widthBp?: number; mode?: 'text' | 'math' }): Promise<BlockResult>;
  /** Full compile with capture off → a PDF. `log` is the TeX log. */
  pdf(req: { preamble: string; blocks: BlockRequest[]; title?: string; /** the names of the document's files: all go to the engine */ files?: string[] }): Promise<{ pdf: Blob | null; log: string; errors: Problem[] }>;
  /** Re-warm for a new preamble; answers the preamble's own problems. */
  setPreamble(preamble: string): Promise<{ errors: Problem[]; warnings: Problem[]; files?: string[] }>;
  setBib(bib: Doc['bib']): Promise<void>;
  /** What \includegraphics may find (picture shim). */
  setAssets?(lookup: (name: string) => Promise<Asset | null>): void;
  /** Cache key prefix: engine build + preamble + bib hash. A backend keeps its own
   * */
  keyPrefix?(): string;
  /** blocks in view: compiled first */
  setVisible?(ids: ULID[]): void;
  // ── the calls the app makes beyond the above ──
  /** the persistent cache's key a block would get now (context, source, the files it opens):
   *  app/cache-key.js uses it for the app's own map. Throws while the engine's build is not known. */
  keyFor?(b: { source: string; context?: string }): string;
  /** the preamble's cached result (its problems, \textwidth) without starting or warming the engine; null
   *  when it has not been warmed yet */
  knownPreamble?(preamble: string): Promise<({ errors: Problem[]; warnings: Problem[]; textwidthPt?: number }) | null>;
  /** resolves when every patched font being loaded has been swapped in (or failed): whenIdle waits for it */
  fontsSettled?(): Promise<unknown>;
  /** a tikzpicture as SVG; `extra`: preamble lines the picture needs when the document's lack them */
  renderTikz?(source: string, extra?: string): Promise<{ svg?: string | null; errors?: Problem[]; via?: string }>;
  /** true once TeX is warm for the current preamble */
  isWarm?(): boolean;
  /** this backend for one document: its preamble, .bbl, files and blocks in view are that document's; the
   *  engine (one worker, re-warmed when the document changes) and the result caches are shared. The calls above
   *  made through it act for that document. */
  forDoc?(key: string): Backend & { docKey: string; release(): void };
  /** on a forDoc facade: its document closed; its state kept (the last 2 released, engine/web/kept-docs.js) or,
   *  memory tight, gone */
  release?(): void;
  /** (tests) the keys forDoc has a state for */
  docKeys?(): string[];
  /** (tests) the released documents whose state is kept, oldest first */
  keptKeys?(): string[];
}

// ── Refs, numbering, bibliography ───────────────────────────────────────

export interface BibEntry {
  key: string;                     // "DT25" is the label; key is the citation key
  label?: string;                  // alphabetic label as printed ("DT25")
  type?: string;                   // article, inproceedings…
  authors?: string[];
  title?: string;
  year?: string;
  venue?: string;
  fields?: Record<string, string>;
}

export interface LabelInfo {
  name: string;                    // the label: "lem:main"
  blockId: ULID | null;
  counter: string;                 // "lemma", "section", "equation"
  number: string;                  // "3.2" ("" until numbered)
  refname: string;                 // cleveref's name: "Lemma"
  title?: string;                  // a heading's text, a theorem's optional note
  offset?: number;                 // where \label{ starts in the block's source
  text?: string;                   // how \Cref prints it ("Lemma 3.2"); '' until numbered
  from?: 'overlay' | 'source';     // numbered from a compiled block, or only seen in a source
}

export interface RefUse {
  blockId: ULID;
  cmd: string;                     // ref, cref, Cref, eqref, autoref, pageref, nameref
  keys: string[];
  offset: number;                  // of the backslash in the block's source
  length: number;
}

/** `all`: its keys had `*` (\nocite{*}), every entry is cited */
export interface CiteUse { blockId: ULID; cmd: string; keys: string[]; all?: boolean; offset: number; length: number }

export interface BlockNumbers {
  heading?: { level: number; number: string; title: string; appendix?: boolean };
  items: { counter: string; number: string; head: string; labels: string[] }[];
}

export interface RefsState {
  rev: number;                     // +1 per recompute
  labels: Record<string, LabelInfo>;
  refs: RefUse[];
  cites: CiteUse[];
  bib: Record<string, BibEntry>;
  numbers: Record<ULID, BlockNumbers>;
  duplicates: string[];            // labels defined more than once
  // extras (optional here):
  diagnostics?: { kind: 'undefined-ref' | 'duplicate-label' | 'unused-label' | 'unknown-cite'; blockId: ULID | null; message: string; offset?: number; key: string }[];
  unknownCites?: string[];
  pending?: ULID[];                // blocks with source but no render yet: their numbers did not count
  refTexts?: Record<string, string>;
}

/** What the app hands to refs: blocks in document order, with their mounted
 *  render when there is one. */
export interface BlockEntry {
  id: ULID;
  kind: BlockKind;
  source: string;
  el: HTMLElement | null;          // .latex-block
  block: unknown | null;           // reflowtex.host Block
  key: string | null;
}

export interface Refs {
  refsState(): RefsState;
  /** TeX prepended to block i (\appendix, \setcounter, \@afterheading…); part of its cache key. */
  /** opts.bbl: doc.bib.source when doc.bib.kind is 'bbl' (a thebibliography's cited \bibitem's go into the context) */
  contextFor(blocks: (Pick<Block, 'id' | 'kind' | 'source'> & { attrs?: BlockAttrs })[], i: number, opts?: { bbl?: string | null }): string;
  /** Recompute from the doc and apply numbers/refs to mounted blocks (the overlay). Idempotent. */
  update(doc: { preamble: string; bib: Doc['bib'] }, blocks: BlockEntry[]): void;
  onChange(fn: (s: RefsState) => void): () => void;
}
// rtx:refs also exports recallsOf(blocks) → Map<recall block id, original block id>:
// a block that is only \name or \name* (thm-restate) shows the original's
// render (transclusion, app.js), numbered as the original.

// ── Figures ──────────────────────────────────────────────────────────────────
// The Ipe figure editor (rtx:figures) was removed: SVG figures are edited by svgfig/. What stays is
// display: web/src/figures/ reads the Ipe document in a PDF figure and writes its TikZ rendition, which the
// backend typesets into the SVG drawn (engine/web/backend.js). A figure edited before keeps its model and
// rendition, drawn and exported as before (io/figures-export.ts).

export interface IpeModel { kind: 'ipe'; xml: string; bbox?: unknown }

// ── Theorem kinds from the preamble (app/kinds.js) ───────────────────────

export interface TheoremKind {
  env: string;                     // "lemma"
  name: string;                    // "Lemma"
  numbered: boolean;
  sibling?: string;                // shares this env's counter
  within?: string;                 // numbered within this counter
  style?: string;                  // plain, definition, remark
}

// ── The test surface: window.editorAPI ──────────────────────────────────

export interface OutlineItem { id: ULID; level: number; number: string; title: string; appendix: boolean }
export interface Diagnostic {
  kind: 'undefined-ref' | 'duplicate-label' | 'unused-label' | 'unknown-cite' | 'error' | 'warning';
  blockId: ULID | null;
  message: string;
  offset?: number;
  line?: number | null;
}
export interface TodoItem { blockId: ULID; author: string; text: string; cmd: string; offset: number; inline: boolean }

export interface EditorAPI {
  /** No compile due or running, every ok result mounted, refs updated, viewer idle. */
  whenIdle(): Promise<void>;
  route(): { name: 'home' } | { name: 'doc'; id: ULID };
  open(id: ULID): Promise<void>;
  currentDoc(): OpenDoc | null;    // a deep copy
  /** (tests) the panes' width governor (panes/widths.js): pinned blocks, re-breaks per frame and slice */
  /** (tests) a pane opened makes its views of off-screen blocks lazily (panes/lazy-views.js) */
  lazyViews(): { waiting: number; idle(): Promise<void>; stats(): { waiting: number; deferred: number; made: number; slices: { n: number; ms: number }[] }; resetStats(): void };
  widths(): { pinned: number; idle(): Promise<void>; stats(): { pinned: number; rebroken: number; lazy: number; ghosts: number; frames: { n: number; ms: number; visible: number; left?: number; settle?: boolean }[]; slices: { n: number; ms: number }[] }; resetStats(): void };
  blocks(): { id: ULID; kind: BlockKind; source: string; state: string; height: number; mounted: boolean; errors: Problem[] }[];
  counters(): { requests: number; partsSent: number; mounts: number; compiledIds: ULID[] };   // compiledIds: every block sent to the backend
  resetCounters(): void;
  kinds(): { kind: BlockKind; label: string }[];      // the slash menu's
  edit(id: ULID, caret?: number): void;
  leave(): void;
  caret(): { id: ULID; offset: number } | null;
  setSource(id: ULID, source: string): void;
  insert(index: number, kind: BlockKind, source: string): ULID;
  remove(id: ULID): void;
  move(id: ULID, to: number): void;
  split(id: ULID, offset: number): ULID | null;
  merge(id: ULID): boolean;                            // with the block before
  setPreamble(source: string): void;
  outline(): OutlineItem[];
  diagnostics(): Diagnostic[];
  todos(): TodoItem[];
  find(q: string, o?: { regex?: boolean; caseSensitive?: boolean; word?: boolean }): { blockId: ULID; from: number; to: number }[];
  replaceAll(q: string, r: string, o?: { regex?: boolean; caseSensitive?: boolean; word?: boolean }): number;
  wordCount(): { words: number; characters: number; blocks: number };
  backend(): string;
  backends(): string[];
  modules(): Record<'store' | 'io' | 'home' | 'refs' | 'figures' | 'backend', 'real' | 'stub'>;
  home(): void;
  selected(): ULID | null;                            // the keyboard-selected block
  undo(): boolean;                                    // block-level undo (moves, inserts, deletes, split/merge, replace all)
  redo(): boolean;
  coordsAt(offset: number): { x: number; y: number } | null;   // in the open editor (scrolled into view)
  editFigure(blockId: ULID, name?: string): Promise<void>;
  refsState(): RefsState;
  store(): DocStore;
}
// Events on document: 'editor:ready', 'editor:route' {name, id?}, 'editor:compiled'
// {ids, stats}, 'editor:displayed' {id}, 'editor:refreshed' (refs and panels updated).

declare global {
  interface Window { editorAPI: EditorAPI }
}
