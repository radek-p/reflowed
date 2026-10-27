// The editor's compile worker (one classic script: dist/editor-worker.js,
// esbuild IIFE, so a blob: URL can start it on a file:// page).
//
//   block LaTeX --warm Tectonic (Asyncify snapshot after \begin{document},
//     engine-api capture in the engine, patch 0005 attributes)--> input.rtxc.jsonl
//     --engine-api convert.ts--> output.json (+ sourcemap, spacing)
//     --the public pipeline's transform (classic fonts given their faces) and encoder on ../encode's
//       shims--> nodelist (base64; with the block's warnings, for the viewer's log)
//   and the fonts, incrementally: a font is patched again only when a block
//   brings a glyph it did not have (per-font requirement sets: the public FileNeeds).
//
// Messages: { id, cmd, args } -> { id, result } | { id, error }
//   init        { pack: base64 | packBytes: Uint8Array | packs: Uint8Array[] } | { base: dev server origin }
//               (packs: the multi-file build's parts, each a pack of the same format: the wasm, the format, the TeX files)
//               -> { build, files, ms }. The TeX files only: what the fonts of cached results need. It does
//               not wait for the format or the wasm; a pack given here that has them
//               keeps them for 'engine'
//   engine      { packs?: Uint8Array[], format?: Uint8Array, wasm?: Uint8Array } -> { ms }: the engine made (the wasm
//               compiled, an instance) from these or from what init's packs had; once (again: nothing). setPreamble,
//               compile, tikz and pdf need it first (the backend sends it before the first of them)
//   setPreamble { preamble, bbl? } -> { ok, errors, warnings, adapted, ms, pkey, files }   (files: as a block's)
//   setAssets   { assets: [{ name, mime, bytes?, svg? }], replace? }
//   compile     { blocks: [{ id, source, context? }] } -> { blocks: { id: Result }, fonts, fontFiles, stats }
//               (Result.files: the document's files the block's runs opened, and the names they looked for that
//               nothing had, in the order asked; the backend checks a stored result's against the document's)
//   fonts       { reqs: [FontReqs] } -> { fonts, fontFiles }   (results restored from a cache)
//   tikz        { source, extra? } -> { svg, widthBp, heightBp, depthBp, errors }   (Ipe renditions)
//   pdf         { preamble, body, bbl? } -> { pdf: Uint8Array | null, log, errors }
//   usage       -> { files }: every bundle file opened (the working set)
//   setResources { base, cached?, quiet? } -> { base }   the TeX resource server ('' or none: no server);
//               cached: { name: bytes } fetched on earlier pages; quiet: an address assumed (the tree beside the page),
//               asked for its ls-R at most once and not named in problems. Files fetched later, and the server found
//               unreachable, reach the page as unsolicited messages
//               { resources: { base, fetched: [{ name, path, bytes }], state } } after the command that did it, and each
//               request to the tree as it happens: { files: FetchEvent } (loading/tree.ts; the page's loading status)
//   resources   -> { base, status, stats, fetched }: the server provider's state
import { WarmEngine } from './engine.ts';
import { decompress as zstdDecompress } from 'fzstd';     // the single file's pack is zstd (-19: 13 MB where gzip -9 is 20)
import { buildHost, withBody, blockFile, blockProblems, preambleProblems, capture, nameMissing, type Problem, type Host } from './compile.ts';
import { spacingOf } from './spacing.ts';
import { resampler, joinContext } from './fidelity/resample.ts';
import { attachAssetPictures, type AssetEntry } from './assets.ts';
import { pdfToSvg } from './pdf-svg.ts';   // PDF pictures without a rendition
import { mapLines } from './doc-fonts.ts';
import { dropCaptureKeys } from './capture-keys.ts';
import { chain, mapProvider, type ResourceProvider } from '../../loading/provider.ts';
import { httpProvider, texRequires, xhrGetSync, type HttpProvider } from '../../loading/http.ts';
import { readPack } from '../../loading/pack.ts';
import { preambleKey, blockKey } from '../web/key.js';
import createModule from '../dist/async/tectonic.mjs';
import glue from 'virtual:glue';                      // the same file as text (Asyncify export names)
import extraFiles from 'virtual:extra-tex-files';     // { name: text }: rtx-template (as tectonic-capture), reflowtex.sty & co
import * as vfs from '../encode/src/shims/vfs.ts';
import { setKpsewhich } from '../encode/src/shims/child_process.ts';
import { Pipeline } from '@pub/src/pipeline/pipeline.ts';
import { readSerializerOutput } from '@pub/src/pipeline/nodes.ts';
import { encodeDocument } from '@pub/src/pipeline/encode.ts';
import { Fonts, fontNeeds, fontWarnings, type FileNeeds } from '@pub/src/pipeline/fonts/fonts.ts';
import { setDocumentMapLines } from '@pub/src/pipeline/fonts/type1.ts';
import { Log, type LogRecord } from '@pub/src/shared/log.ts';
import type { FileFace } from '@pub/src/shared/font-face.ts';
import protoText from '@pub/src/schema/latex.proto';

declare const self: DedicatedWorkerGlobalScope;
declare const ENGINE_BUILD: string;
const enc = new TextEncoder();

// ── Files ────────────────────────────────────────────────────────────────────
const files = new Map<string, Uint8Array>();
let names = new Set<string>();
let net: string | null = null;
let format: Uint8Array;
const used = new Set<string>();
const assets = new Map<string, AssetEntry>();
/** names TeX asked for that neither the embedded set nor the document's sent files have
 *  (the backend looks them up in the document, sends what it finds and runs again) */
const misses = new Set<string>();
/** the run's record of the document's files: every name answered from `assets`, and every name nothing had (a
 *  block's runs, the resampling ones too, or the preamble's warm; null between them) */
let opened: Set<string> | null = null;

// Where TeX files come from (loading/provider.ts): the embedded set (the single file's pack; on a dev page, the
// bundle server's files on demand), then the TeX resource server when one is set. The engine asks the chain and
// never knows which answered.
const embedded: ResourceProvider = {
  id: 'embedded',
  has: (n) => files.has(n) || names.has(n),
  resolve(n) {
    const hit = files.get(n);
    if (hit || !net || !names.has(n)) return hit ?? null;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', net + encodeURIComponent(n), false);
    xhr.responseType = 'arraybuffer';
    xhr.send();
    if (xhr.status !== 200) return null;
    const data = new Uint8Array(xhr.response as ArrayBuffer);
    files.set(n, data);
    return data;
  },
};
let server: HttpProvider | null = null;
const tex = chain([embedded]);
/** files fetched from the server since the last message: the page keeps them (IndexedDB) */
let fetchedOut: { name: string; path: string; bytes: Uint8Array }[] = [];
/** the server's state the page last heard of */
let toldState = 'idle';
async function setResources({ base = '', cached = {}, quiet = false }: { base?: string; cached?: Record<string, Uint8Array>; quiet?: boolean }) {
  server = base ? httpProvider({ base, quiet, get: xhrGetSync(), cached: new Map(Object.entries(cached)), onFetched: (name, path, bytes) => fetchedOut.push({ name, path, bytes: bytes.slice() }),
    // every request to the tree, as it happens (the worker is blocked in it; the page is not): the page's status store
    report: (e) => self.postMessage({ files: e }) }) : null;
  tex.providers = server ? [embedded, server] : [embedded];
  fetchedOut = [];
  toldState = 'idle';
  // results that failed may not now (a missing package is on the server): made again, and the preamble warmed again
  for (const [k, r] of results) if (r.status === 'error') results.delete(k);
  pre.pkey = '';
  // the engine remembers every name it was refused for its whole life (the driver's file cache): a new instance
  if (eng?.warmed || host) await newEngine();
  return { base: server?.base ?? '' };
}

// The document's own files come first (assets): a paper's own lipics-v2021.cls or
// article.cls wins over the embedded pack's copy of the same name.
function getFile(name: string): Uint8Array | null {
  const a = assets.get(name);
  if (a?.bytes) { opened?.add(name); return a.bytes; }
  const hit = tex.resolveFrom(name);
  if (hit) { if (hit.from === 'embedded') used.add(name); return hit.bytes; }
  if (misses.size < 400) misses.add(name);
  if (opened && opened.size < 400) opened.add(name);
  return null;
}
/** a file the engine can open (the embedded set, the document's assets, what the server already gave) */
const known = (n: string) => names.has(n) || files.has(n) || !!findAssetByName(n) || !!server?.gave(n);
/** where else a missing file was looked for (nameMissing's note) */
const whereElse = (n: string) => (server ? server.why(n) : '');
const findAssetByName = (n: string) => assets.get(n) ?? [...assets.values()].find((a) => a.name.endsWith('/' + n));
const fetchSync = (kind: number, name: string) => (kind === 1 ? (name === 'latex.fmt' ? format : null) : getFile(name));

/** A pack (loading/pack.ts): zstd or gzip of the layout, or the layout itself (the dev server's, sent with Content-Encoding). */
async function unpack(gz: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zstd = gz[0] === 0x28 && gz[1] === 0xb5 && gz[2] === 0x2f && gz[3] === 0xfd;
  const gzip = gz[0] === 0x1f && gz[1] === 0x8b;
  const input = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(gz); c.close(); } });
  const raw = zstd ? zstdDecompress(gz) : gzip ? new Uint8Array(await new Response(input.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : gz;
  return readPack(raw);
}
function base64ToBytes(b64: string): Uint8Array {
  const U = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
  if (U.fromBase64) return U.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ── The engine ───────────────────────────────────────────────────────────────
let eng: WarmEngine;
let host: Host | null = null;
let pre = { preamble: '', bbl: '', pkey: '', ok: false, errors: [] as Problem[], warnings: [] as Problem[], adapted: [] as string[], missing: [] as string[], files: [] as string[], textwidthPt: 0 };
// \textwidth as the document has it at \begin{document}: the page sets its paper column from it
// before any block is typeset (the warm's log; cached with the preamble's result, so a cached page knows it at once)
const TEXTWIDTH_PROBE = '\\typeout{rtx-textwidth=\\the\\textwidth}';
const textwidthOf = (log: string) => { const m = /rtx-textwidth=([\d.]+)pt/.exec(log); return m ? Number(m[1]) : 0; };

/** the engine's own files, kept from init's packs or given to 'engine' */
let wasmBytes: Uint8Array | null = null;
/** the packs, a damaged or incomplete one saying so instead of failing later on undefined */
async function unpackAll(packs: Uint8Array[]): Promise<Map<string, Uint8Array>> {
  const pack = new Map<string, Uint8Array>();
  try { for (const p of packs) for (const [k, v] of await unpack(p)) pack.set(k, v); }
  catch (e) { throw new Error(`the engine's pack could not be read (${(e as Error).message})`); }
  return pack;
}
function takeEngineFiles(pack: Map<string, Uint8Array>) {
  if (pack.get('latex.fmt')?.length) format = pack.get('latex.fmt')!;
  if (pack.get('tectonic_wasm.wasm')?.length) wasmBytes = pack.get('tectonic_wasm.wasm')!;
}
async function init(args: { pack?: string; packBytes?: Uint8Array; packs?: Uint8Array[]; base?: string }) {
  const t0 = performance.now();
  if (args.pack || args.packBytes || args.packs) {
    const pack = await unpackAll(args.packs ?? [args.packBytes ?? base64ToBytes(args.pack!)]);
    takeEngineFiles(pack);
    for (const [k, v] of pack) if (k.startsWith('texmf/')) files.set(k.slice(6), v);
    names = new Set(files.keys());
  } else {
    const base = args.base!;
    // a file the engine needs and the server does not have: named in the error
    const get = async (url: string) => {
      let r: Response;
      try { r = await fetch(url); } catch (e) { throw new Error(`the engine's files could not be loaded: ${url} (${(e as Error).message})`); }
      if (!r.ok) throw new Error(`the engine's files could not be loaded: ${url} (HTTP ${r.status})`);
      return r;
    };
    // the format and the wasm are the page's to fetch (early, at a low priority) and give to 'engine'.
    // The embedded TeX set comes as one pack, as in the release (the dev server's /bundle/pack, compressed and
    // cacheable; it carries the TeX files the bundle lacks too); a file outside it is fetched when TeX opens it
    const [info, index, pack] = await Promise.all([get(`${base}/bundle/info`).then((r) => r.json()), get(`${base}/bundle/index`).then((r) => r.text()),
      get(`${base}/bundle/pack`).then(async (r) => unpack(new Uint8Array(await r.arrayBuffer())))]);
    net = `${base}/bundle/${encodeURIComponent(info.id)}/file/`;
    for (const line of index.split('\n')) { const sp = line.indexOf(' '); if (sp > 0) names.add(line.slice(0, sp)); }
    for (const [k, v] of pack) if (k.startsWith('texmf/')) { files.set(k.slice(6), v); names.add(k.slice(6)); }
  }
  const tUnpacked = performance.now();
  vfs.mount('/texmf', (rel) => getFile(rel));
  vfs.mount('/reflowtex', (rel) => (rel === 'src/schema/latex.proto' ? enc.encode(protoText) : null));
  vfs.mount('/node_modules', () => null);
  setKpsewhich(kpsewhich);
  setDocumentMapLines(docMapLines);
  return { build: ENGINE_BUILD, files: names.size, unpackMs: tUnpacked - t0, ms: performance.now() - t0 };
}

/** The engine from its files (given here, or kept from init's packs): the wasm compiled, an instance made. Once. */
async function engine(args: { packs?: Uint8Array[]; format?: Uint8Array; wasm?: Uint8Array }) {
  if (eng) return { ms: 0 };
  const t0 = performance.now();
  if (args.packs?.length) takeEngineFiles(await unpackAll(args.packs));
  if (args.format?.length) format = args.format;
  if (args.wasm?.length) wasmBytes = args.wasm;
  const lacking = [!format?.length && 'latex.fmt', !wasmBytes?.length && 'tectonic_wasm.wasm'].filter(Boolean);
  if (lacking.length) throw new Error(`the engine's files are incomplete: ${lacking.join(', ')} missing from the pack`);
  wasmModule = await WebAssembly.compile(wasmBytes as BufferSource);
  wasmBytes = null;
  await newEngine();
  return { ms: performance.now() - t0 };
}
/** a command that runs TeX: the engine must have been made ('engine') */
const withEngine = <A, R>(f: (a: A) => R) => (a: A): R => {
  if (!eng) throw new Error('the engine is not loaded yet (no engine command before this one)');
  return f(a);
};

/** The encoder's kpsewhich (fonts: a TFM face's X.pfb, a map's outline and encoding, an OTF):
 *  the embedded set and the document's files. */
function kpsewhich(name: string): string | null {
  return names.has(name) || assets.get(name)?.bytes || server?.has(name) ? `/texmf/${name}` : null;
}
/** The document's own font map lines (\\pdfmapline, \\pdfmapfile{doc.map}), for the encoder's Type 1
 *  conversion (doc-fonts.ts): the same array until the preamble or the document's map files change. */
let mapLinesFor: string | null = null, docLines: string[] = [];
function docMapLines(): string[] {
  const sig = `${pre.preamble}\u0000${[...assets.keys()].filter((n) => /\.map$/i.test(n)).join()}`;
  if (sig !== mapLinesFor) { mapLinesFor = sig; docLines = mapLines(pre.preamble, (n) => getFile(n)); }
  return docLines;
}

let wasmModule: WebAssembly.Module;
/** A fresh engine instance (at init, and after an engine crash: an abort
 *  leaves the instance unusable, so it is dropped and the preamble warmed
 *  again in a new one). */
async function newEngine(): Promise<void> {
  if (eng) { eng.snapshot = null; (eng as any).M = null; }      // let the old instance's memory go first
  eng = await WarmEngine.create({ createModule, wasmBinary: wasmModule, glue, fetchSync });
  eng.setExtraFiles(extraFiles as Record<string, string>);
}
let crashes = 0;
/** test hook (simulateCrash): the next n block runs trap as an abort would */
let crashNext = 0;
/** test hook (simulateCrash how: 'death'): the next block run throws outside the message queue's
 *  catch, as an abort in an Asyncify callback does: the worker reports an uncaught error, no answer */
let dieNext = false;
const run = (text: string) => (crashNext > 0 ? (crashNext--, { status: 3, restoreMs: 0, runMs: 0, trap: 'RuntimeError: Aborted() (simulated)' }) : eng.runBlock(text));
/** After a trap: a new instance, warmed for the current preamble. */
async function recover(): Promise<void> {
  crashes++;
  await newEngine();
  if (host) warm();
}

function warm(): void {
  if (!host) return;
  eng.cool();
  eng.reset();
  if (pre.bbl) eng.addFile('input.bbl', pre.bbl);
  eng.addFile('input.tex', host.main);
  const t = performance.now();
  misses.clear();
  const outer = opened;                     // (a block's run that recovers from a crash warms again: its record is kept)
  opened = new Set();
  const w = eng.warm('input.tex');
  pre.missing = [...misses];
  pre.files = [...opened];
  opened = outer;
  const p = preambleProblems(w.ok ? eng.preambleLog : eng.text('input.log'), host);
  nameMissing(p.errors, known, whereElse);
  pre.ok = w.ok;
  pre.errors = w.ok ? p.errors : (p.errors.length ? p.errors : [{ severity: 'error', message: 'the preamble does not reach \\begin{document}', line: null }]);
  pre.warnings = p.warnings;
  pre.textwidthPt = w.ok ? textwidthOf(eng.preambleLog) : 0;
  warmMs = performance.now() - t;
}
let warmMs = 0;

// sig: the document files the preamble reads (the backend's asset signature): a changed
// class or package warms again; force: warm again anyway (files TeX missed were sent)
async function setPreamble({ preamble, bbl = '', sig = '', force = false }: { preamble: string; bbl?: string; sig?: string; force?: boolean }) {
  const pkey = preambleKey(preamble, sig ? `${bbl}\u0000${sig}` : bbl);
  if (!force && pkey === pre.pkey && eng.warmed) return { ok: pre.ok, errors: pre.errors, warnings: pre.warnings, adapted: pre.adapted, ms: 0, pkey, missing: [], files: pre.files, textwidthPt: pre.textwidthPt };
  // the packages it names that the TeX tree has, fetched in parallel before TeX runs (loading/http.ts
  // prefetch): TeX's synchronous reads then find them
  if (server) await server.prefetch(texRequires(preamble), { skip: (n) => names.has(n) || files.has(n) || !!findAssetByName(n) });
  host = buildHost(preamble, { preload: TEXTWIDTH_PROBE });
  pre = { preamble, bbl, pkey, ok: false, errors: [], warnings: [], adapted: host.adapted, missing: [], files: [], textwidthPt: 0 };
  warm();
  return { ok: pre.ok, errors: pre.errors, warnings: pre.warnings, adapted: pre.adapted, ms: warmMs, pkey, missing: pre.missing ?? [], files: pre.files, textwidthPt: pre.textwidthPt };
}

async function setAssets({ assets: list, replace }: { assets: AssetEntry[]; replace?: boolean }) {
  if (replace) assets.clear();
  // a PDF picture without a rendition (a logo, the ORCID sign): drawn from its own vector graphics when it
  // has only those (pdf-svg.ts); else assets.ts keeps its framed placeholder
  for (const a of list) if (!a.svg && a.bytes && (/pdf/i.test(a.mime ?? '') || /\.pdf$/i.test(a.name))) {
    try { a.svg = (await pdfToSvg(a.bytes)) ?? undefined; } catch (e) { console.warn(`${a.name}: ${(e as Error).message}`); }
  }
  for (const a of list) assets.set(a.name, a);
  return { names: [...assets.keys()] };
}

// ── One block ────────────────────────────────────────────────────────────────
/** What a block needs of one font file (the public fonts.ts FileNeeds, as a result carries it: plain data, for
 *  structured clone and JSON): the TeX name the file stands for and its face (a type1 or bitmap face of a result
 *  restored from a cache is converted again by that name), every code point a glyph reaches it by with the glyph
 *  index TeX set (null: not known), whether a \\webtext slot sets text in it. */
interface FileReq { name: string; face: FileFace; reached: [number, number | null][]; slot: boolean }
type FontReqs = Record<string, FileReq>;
interface Result {
  key: string; status: 'ok' | 'error'; errors: Problem[]; warnings: Problem[]; nodelist: string | null;
  spacing?: unknown; sourcemap?: unknown; capture: { engine: 'tectonic'; build: string; id: string; anchors?: string[]; links?: string[] }; displays?: unknown;
  fontReqs?: FontReqs; ms: number; timing: Record<string, number>; transient?: boolean;
  /** files TeX asked for that were not there (the backend looks for them in the document) */
  missing?: string[];
  /** the document's files the block's runs opened (answered from the assets), and the names they looked for that
   *  nothing had: what the block uses, as TeX saw it (a figure placed by a macro too) */
  files?: string[];
}

let pipe: Pipeline;
/** the pipeline's build lines (the 'log' command): its records' messages, the last few hundred */
const pipeLog: string[] = [];
const plog = new Log('pipeline', [(r: LogRecord) => { pipeLog.push(r.message); if (pipeLog.length > 400) pipeLog.splice(0, 200); }]);
const results = new Map<string, Result>();
let runs = 0;

/** one block typeset, with the record of the document's files its runs opened (Result.files) */
async function build(source: string, context: string, key: string): Promise<Result> {
  opened = new Set();
  try { const res = await typeset(source, context, key); res.files = [...opened]; return res; } finally { opened = null; }
}
async function typeset(source: string, context: string, key: string): Promise<Result> {
  const t0 = performance.now();
  const f = blockFile(source, context);
  const res: Result = { key, status: 'error', errors: [], warnings: [], nodelist: null, capture: { engine: 'tectonic', build: ENGINE_BUILD, id: `${key}#${++runs}` }, ms: 0, timing: {} };
  if (!pre.ok || !eng.warmed) {
    res.errors = [{ severity: 'error', message: 'the preamble has errors', line: null }];
    return res;
  }
  misses.clear();
  if (dieNext) { dieNext = false; setTimeout(() => { throw new Error('RuntimeError: Aborted() (simulated, uncaught)'); }); await new Promise(() => {}); }
  let r = run(f.text);
  res.missing = [...misses];
  if (r.trap) {
    // the engine crashed (an abort: out of memory, a panic): a new instance, and the block once more
    const first = r.trap;
    await recover();
    r = pre.ok && eng.warmed ? run(f.text) : { status: 3, restoreMs: 0, runMs: 0, trap: 'the preamble no longer warms after an engine crash' };
    if (r.trap) {
      await recover();
      res.errors = [{ severity: 'error', message: `engine crashed while compiling this block: ${reason(first)}`, line: null, detail: r.trap }];
      res.ms = performance.now() - t0;
      return res;
    }
    res.timing.recovered = 1;
  }
  res.timing.restoreMs = r.restoreMs; res.timing.texMs = r.runMs;
  res.timing.heapMB = Math.round(eng.memoryBytes() / 1048576);
  const log = eng.text('input.log').slice(eng.preambleLog.length);
  const p = blockProblems(log, f.firstLine, f.lines);
  nameMissing(p.errors, known, whereElse);
  res.errors = p.errors; res.warnings = p.warnings;
  if (r.status >= 2) {
    if (!res.errors.length) res.errors.push({ severity: 'error', message: 'TeX stopped', line: null, detail: log.split('\n').slice(-12).join('\n') });
    res.ms = performance.now() - t0;
    return res;
  }
  let c;
  // route 2: the block run again wider, only when a display route 1 cannot place is there
  const rs = resampler(eng, (pfx) => blockFile(source, joinContext(context, pfx)).text, (n) => getFile(n), { runMs: r.runMs });
  try { c = capture(eng, (n) => getFile(n), 'input', { resample: rs }); }
  catch (e) { if (rs.info.trap) await recover(); res.errors.push({ severity: 'error', message: `capture: ${(e as Error).message}`, line: null }); res.transient = true; return res; }
  res.timing.captureMs = c.ms;
  res.sourcemap = { ...c.sourcemap, file: 'rtx-block.tex', firstLine: f.firstLine };
  // the block's label anchors and the targets its links use (hyperref and the template's \ref links)
  res.capture.anchors = [...new Set((c.output.anchors ?? []).filter(Boolean) as string[])];
  res.capture.links = [...new Set((c.output.links ?? []).map((l: any) => l.label ?? l.url ?? l.action).filter(Boolean) as string[])];
  res.displays = c.displays;
  if (c.fidelity) Object.assign(res, { ligatures: c.fidelity.ligatures, footnotes: c.fidelity.footnotes });
  if (rs.info.runs) { res.timing.sampleRuns = rs.info.runs; res.timing.samplesMs = Math.round(rs.info.ms); }
  if (rs.info.skipped) res.timing.samplesSkipped = 1;
  if (rs.info.trap) await recover();   // a sample run crashed the engine: this result stands, the next block needs a new instance
  try { res.spacing = spacingOf(c.stream, c.output); } catch { /* optional */ }
  const t2 = performance.now();
  try {
    const data = readSerializerOutput(c.json);
    attachAssetPictures(data, assets, c.tikz);
    const dir = `/work/${key}`;
    vfs.mkdirp(dir);
    await pipe.transform(data, dir, { block: key, docTag: key.slice(-8) });
    dropCaptureKeys(data);                     // the capture's own keys (capture-keys.ts): the wire has no field for them
    // the block's warnings travel with it, as the public pipeline's blocks carry theirs (pipeline.ts encodeBlock):
    // those of the transforms, and one per font with no face it sets glyphs in. The viewer adds them to the page's
    // log, which the editor lists (app/doc/viewer-log.ts)
    const bytes = encodeDocument({ ...data, warnings: [...(data.warnings ?? []), ...fontWarnings(data)] });
    vfs.remove(dir, true);
    res.nodelist = bytesToBase64(bytes);
    res.fontReqs = reqsOf(fontNeeds([data]).files);
  } catch (e) {
    res.errors.push({ severity: 'error', message: `encoder: ${(e as Error).message}`, line: null });
    res.ms = performance.now() - t0;
    return res;
  }
  res.timing.encodeMs = performance.now() - t2;
  res.status = 'ok';
  res.ms = performance.now() - t0;
  return res;
}

/** A trap's message as a reader wants it. */
function reason(trap: string): string {
  if (/Aborted\(\)/.test(trap)) return `the engine aborted (${Math.round(eng.memoryBytes() / 1048576)} MB of memory in use; most likely the browser refused more)`;
  if (/memory access out of bounds|out of memory|Cannot enlarge memory|grow/i.test(trap)) return `out of memory (${trap.split('\n')[0]})`;
  if (/call stack|stack/i.test(trap)) return `the engine ran out of stack (${trap.split('\n')[0]})`;
  return trap.split('\n')[0];
}

// ── Fonts, incrementally ─────────────────────────────────────────────────────
// Every font file the blocks drew from (by its original name: the public fonts.ts FileNeeds), merged over every
// block of the worker's life; served: original -> served (newest).
const reqAll = new Map<string, FileNeeds>();
const served = new Map<string, string>();
const sentFiles = new Set<string>();
const reqsOf = (files: Map<string, FileNeeds>): FontReqs =>
  Object.fromEntries([...files].map(([f, n]) => [f, { name: n.name, face: n.face, reached: [...n.reached], slot: n.slot }]));

const dirty = new Set<string>();
/** Merge one result's requirements; the fonts that gained a code point (or are new) are dirty. A requirement of
 *  another shape (a result of an older build) is passed over: its font is made from the results that have one. */
function mergeReqs(r: FontReqs | null | undefined, mark: boolean): void {
  for (const [file, q] of Object.entries(r ?? {})) {
    if (!q || typeof q !== 'object' || !Array.isArray(q.reached) || !q.face || typeof q.name !== 'string') continue;
    let n = reqAll.get(file);
    if (!n) { n = { name: q.name, face: q.face, reached: new Map(), slot: false }; reqAll.set(file, n); if (mark) dirty.add(file); }
    if (q.slot && !n.slot) n.slot = true;
    for (const [cp, gi] of q.reached) if (!n.reached.has(cp) || (n.reached.get(cp) == null && gi != null)) { n.reached.set(cp, gi); if (mark) dirty.add(file); }
  }
}
/** Merge requirements; re-patch (flush) only the fonts that gained a code point. */
function updateFonts(list: FontReqs[], flush = true): { fonts: Record<string, string>; fontFiles: Record<string, Uint8Array>; patched: string[] } {
  for (const r of list) mergeReqs(r, true);
  if (!flush) return { fonts: {}, fontFiles: {}, patched: [] };
  const patched = [...dirty];
  if (dirty.size) {
    const fonts = new Fonts('/fonts');
    // whole: a font is patched once, with every glyph's private-use entry, so its file and name are the same for
    // every document (and a later block never makes the page swap its face for a re-patched one)
    try { fonts.patch(new Map([...dirty].map((f) => [f, reqAll.get(f)!])), plog, { whole: true }); }
    catch (e) { plog.error('font-patch-failed', `fonts: ${(e as Error).message}`); }
    for (const [o, s] of fonts.served) served.set(o, s);
    dirty.clear();
  }
  const fontFiles: Record<string, Uint8Array> = {};
  for (const s of new Set(served.values())) {
    if (sentFiles.has(s)) continue;
    const b = vfs.read(`/fonts/${s}`);
    if (b) { fontFiles[s] = b.slice(); sentFiles.add(s); }
  }
  return { fonts: Object.fromEntries(served), fontFiles, patched };
}

/** The fonts as they stand (the build's seed: the page opens with them
 *  patched already): every font's requirements, served names and files. */
function dumpFonts() {
  const files: Record<string, Uint8Array> = {};
  for (const sv of new Set(served.values())) { const b = vfs.read(`/fonts/${sv}`); if (b) files[sv] = b.slice(); }
  return { reqs: reqsOf(reqAll), served: Object.fromEntries(served), files };
}
/** Start from dumped fonts: later blocks patch a font again only for glyphs it lacks. */
function loadFonts({ reqs, served: sv, files: fl }: { reqs: FontReqs; served: Record<string, string>; files: Record<string, Uint8Array> }) {
  mergeReqs(reqs, false);
  vfs.mkdirp('/fonts');
  for (const [name, bytes] of Object.entries(fl ?? {})) vfs.write(`/fonts/${name}`, bytes);
  for (const [o, s2] of Object.entries(sv ?? {})) served.set(o, s2);
  return { fonts: Object.keys(sv ?? {}).length };
}

// ── Requests ─────────────────────────────────────────────────────────────────
async function compile({ blocks, fonts: flush = true }: { blocks: { id: string; key?: string; source: string; context?: string; fresh?: boolean }[]; fonts?: boolean }) {
  const t0 = performance.now();
  if (!pipe) pipe = new Pipeline({ buildRoot: '/work', fontsDir: '/fonts', log: plog });
  const out: Record<string, Result & { cached: boolean }> = {};
  let compiled = 0, cached = 0;
  const reqs: FontReqs[] = [];
  const sum: Record<string, number> = {};
  for (const b of blocks) {
    const key = b.key ?? blockKey(ENGINE_BUILD, pre.pkey, b.source, b.context ?? '');
    let r = b.fresh ? undefined : results.get(key);
    const hit = !!r;
    if (!r) {
      r = await build(b.source, b.context ?? '', key);
      compiled++;
      for (const [k, v] of Object.entries(r.timing)) sum[k] = (sum[k] ?? 0) + v;
      if (!r.transient) results.set(key, r);
      if (results.size > 600) results.delete(results.keys().next().value!);
    } else cached++;
    if (r.fontReqs) reqs.push(r.fontReqs);
    out[b.id] = { ...r, cached: hit };
  }
  const tf = performance.now();
  const fonts = updateFonts(reqs, flush);
  return {
    blocks: out, preamble: { errors: pre.errors, warnings: pre.warnings }, fonts: fonts.fonts, fontFiles: fonts.fontFiles,
    stats: { ms: Math.round(performance.now() - t0), compiled, cached, runs: compiled, fontsMs: Math.round(performance.now() - tf),
      patched: fonts.patched, ...Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v)])) },
  };
}

/** The first TikZ picture of a run that just ended: its SVG and box (bp). */
function firstPicture(): { svg: string | null; widthBp: number; heightBp: number; depthBp: number } | null {
  const c = capture(eng, (n) => getFile(n));
  let pic: any = null;
  const walk = (ns: any[]) => { for (const n of ns ?? []) { if (!pic && n.type === 'picture' && /^rtx-picture:/.test(n.file ?? '')) pic = n; walk(n.children); } };
  for (const q of c.output.paragraphs ?? []) walk(q.nodes);
  for (const it of c.output.content ?? []) if (it.box) walk([it.box]);
  if (!pic) return null;
  const SPBP = 65781.76;
  return { svg: c.tikz(Number(pic.file.split(':')[1]), pic.width, pic.height, pic.depth), widthBp: pic.width / SPBP, heightBp: pic.height / SPBP, depthBp: pic.depth / SPBP };
}

/** A TikZ picture as SVG: compiled warm with the current
 *  preamble; when that fails (no TikZ in the preamble, a package the figure's
 *  own preamble needs), one full compile with `extra` added to the preamble,
 *  and the warm snapshot made again. */
function tikz({ source, extra = '' }: { source: string; extra?: string }) {
  let errors: Problem[] = [];
  if (pre.ok && eng.warmed) {
    // the figure's own preamble without its \\usepackage lines (definitions and \\usetikzlibrary work in the body): most renditions then need no full compile
    const body = extra.split('\n').filter((l) => !/^\s*\\(usepackage|RequirePackage|documentclass)\b/.test(l)).join('\n');
    const f = blockFile(source, `${body ? `\\makeatletter ${body}\\makeatother\n` : ''}\\noindent`);
    const r = eng.runBlock(f.text);
    errors = blockProblems(eng.text('input.log').slice(eng.preambleLog.length), f.firstLine, f.lines).errors;
    if (r.status <= 1 && !r.trap) { const p = firstPicture(); if (p?.svg) return { ...p, errors, via: 'warm' }; }
  }
  if (!host) return { svg: null, errors: [{ severity: 'error', message: 'no preamble', line: null }] };
  const h = buildHost(`${pre.preamble}\n${extra}`);
  eng.cool(); eng.reset();
  if (pre.bbl) eng.addFile('input.bbl', pre.bbl);
  eng.addFile('input.tex', h.main);
  const st = eng.compile('input.tex', { block: blockFile(source, '\\noindent').text });
  const p = st <= 1 ? firstPicture() : null;
  const errs = preambleProblems(eng.text('input.log'), h).errors;
  warm();
  return p?.svg ? { ...p, errors: errs, via: 'full' } : { svg: null, errors: errs.length ? errs : errors.length ? errors : [{ severity: 'error', message: 'no tikzpicture typeset', line: null }] };
}

/** the whole document, capture off, three passes, xdvipdfmx. The warm
 *  snapshot is dropped and made again afterwards. */
function pdf({ preamble, body, bbl = '' }: { preamble: string; body: string; bbl?: string }) {
  const h = buildHost(preamble, { adapt: false, prelude: '%' });
  eng.cool();
  eng.reset();
  if (bbl) eng.addFile('input.bbl', bbl);
  eng.addFile('input.tex', withBody(h.main, body));
  const t = performance.now();
  const status = eng.compile('input.tex', { capture: 0, maxPasses: 3, pdf: true });
  const bytes = eng.file('input.pdf');
  const log = eng.text('input.log');
  const errors = preambleProblems(log, h).errors;
  const aux = eng.text('input.aux');
  warm();
  return { pdf: bytes, status, log, aux, errors, ms: performance.now() - t };
}

const commands: Record<string, (a: any) => unknown> = {
  init, engine, setPreamble: withEngine(setPreamble), setAssets, compile: withEngine(compile), tikz: withEngine(tikz), pdf: withEngine(pdf),
  fonts: ({ reqs = [] }: { reqs?: FontReqs[] }) => updateFonts(reqs),
  dumpFonts, loadFonts,
  simulateCrash: ({ times = 1, how = 'abort' }: { times?: number; how?: 'abort' | 'death' }) => { if (how === 'death') dieNext = true; else crashNext = times; return { crashNext, dieNext }; },
  memory: () => ({ heap: eng?.memoryBytes() ?? 0, snapshot: eng?.snapshotBytes() ?? 0, warmed: !!eng?.warmed, crashes }),
  usage: () => ({ files: [...used].sort() }),
  setResources,
  resources: () => ({ base: server?.base ?? '', quiet: server?.quiet ?? false, status: server?.status() ?? null, stats: server?.stats ?? null }),
  log: () => ({ lines: pipeLog.slice() }),
};
/** files the server gave during the last command, to the page (it keeps them for later pages), and its state when it
 *  changed (an assumed server found missing is not asked again by later workers of this page) */
function flushFetched() {
  if (!server) return;
  const state = server.status().state;
  if (!fetchedOut.length && state === toldState) return;
  const fetched = fetchedOut; fetchedOut = []; toldState = state;
  self.postMessage({ resources: { base: server.base, fetched, state } }, fetched.map((f) => f.bytes.buffer as ArrayBuffer));
}
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent) => {
  const { id, cmd, args } = e.data;
  queue = queue.then(async () => {
    try {
      const result = await commands[cmd](args ?? {}) as { fontFiles?: Record<string, Uint8Array>; pdf?: Uint8Array | null };
      const transfer: ArrayBuffer[] = [];
      if (result?.fontFiles) for (const u of Object.values(result.fontFiles)) transfer.push(u.buffer as ArrayBuffer);
      if (cmd === 'dumpFonts') for (const u of Object.values((result as any).files as Record<string, Uint8Array>)) transfer.push(u.buffer as ArrayBuffer);
      if (result?.pdf) transfer.push(result.pdf.buffer as ArrayBuffer);
      self.postMessage({ id, result }, transfer);
      flushFetched();
    } catch (err) {
      // an engine crash outside a block (a full compile for the PDF, a TikZ rendition): a new instance
      if (cmd !== 'init' && /Aborted|RuntimeError|unreachable|out of bounds|memory/i.test(String((err as Error)?.message ?? err))) { try { await recover(); } catch { /* the next init */ } }
      flushFetched();
      self.postMessage({ id, error: `${(err as Error)?.name ?? 'Error'}: ${(err as Error)?.message ?? err}\n${(err as Error)?.stack ?? ''}` });
    }
  });
};
