// Export: the document back as files.
//
//   exportFiles(doc, blocks, assets)      → { entries, warnings }   main + every input file, assets, .bbl/.bib
//   exportSingle(doc, blocks, assets)     → { text, missing, warnings }   one .tex with block markers (markers.ts), bbl in filecontents*
//   zipOpenDoc(doc, getAsset)             → { name, data, warnings }   (io.exportZip wraps it as a Blob)
//   exportZipFromStore(store, docId), exportTexFromStore(store, docId)
//
// Each block goes back to its `file`; a file is \input where its first block
// comes, with the command it was input with; whitespace between blocks is
// what the import recorded (attrs.before), so an untouched import comes back
// byte for byte. A block moved away from its file's run is written into the
// file open at that point (document order wins), with a warning.

import type { Asset, AssetMeta, Block, Doc, DocFile, DocStore, OpenDoc } from '../store/types.ts';
import { byPos } from '../store/fracindex.ts';
import { type Entry, writeZip } from './archive.ts';
import { ADDED_END, ADDED_START, editedFigures, preambleAdditions, rewriteSource, withAdditions, type EditedFigure } from './figures-export.ts';
import { writeMarked, type MarkedBlock } from './markers.ts';
import { flattenForExport, treeOrder } from '../nesting/model.ts';
import { packageOptions } from '../tex/calls.ts';
import { plainPreamble } from '../meta/plain.ts';
import { metaPackage, PACKAGE_FILE } from '../meta/package.ts';

/** plainTitle: the title data as the class's own commands, no reflowed-meta package (venues that refuse unknown packages) */
export interface ExportOptions { plainTitle?: boolean }
/** the preamble as exported: plain class commands on request; whether the package must ship */
function titleData(pre: string, o: ExportOptions, warnings: string[]): { pre: string; ship: boolean } {
  if (packageOptions(pre, 'reflowed-meta') === null) return { pre, ship: false };
  if (o.plainTitle) {
    const p = plainPreamble(pre);
    if (p !== null) return { pre: p, ship: false };
    warnings.push('plain title commands: no adapter for this class here; reflowed-meta.sty is shipped instead');
  }
  if (!metaPackage()) warnings.push(`${PACKAGE_FILE} is not in this build: add it beside the main file`);
  return { pre, ship: !!metaPackage() };
}

export interface ExportResult { files: Map<string, string>; warnings: string[] }

/** what each exported file is: the Files panel lists exportFiles' entries (files.ts), so the panel and the
 *  export can never disagree. assetId: the stored asset; of: the figure a rendition (.tikz, .ipe) belongs to */
export type FileKind = 'main' | 'input' | 'bib' | 'bbl' | 'package' | 'figure' | 'asset' | 'rendition';
export interface ProjectEntry extends Entry { kind: FileKind; assetId?: string; of?: string }
const FIGURE = /\.(pdf|svg|png|jpe?g|eps|gif|webp)$/i;
export const isFigure = (name: string) => FIGURE.test(name);

const MARK = (path: string) => `\u0000INPUT:${path}\u0000`;
const MARK_RE = /\u0000INPUT:([^\u0000]*)\u0000/g;

/** Every text file of the project as strings (inputs as markers, resolved by the callers). */
function buildTexts(doc: Doc, blocks: Block[], figs: Map<string, EditedFigure> = new Map(), o: ExportOptions = {}): { texts: Map<string, string>; cmds: Map<string, string>; warnings: string[]; used: EditedFigure[]; ship: boolean } {
  const usedStems = new Set<string>();
  const warnings: string[] = [];
  const main = doc.files.find((f) => f.role === 'main') ?? { path: 'main.tex', role: 'main' as const };
  const fileOf = new Map<string, DocFile>(doc.files.map((f) => [f.path, f]));
  const chain = (p: string): string[] => {
    const out: string[] = [];
    let f = fileOf.get(p);
    const seen = new Set<string>();
    while (f && f.role !== 'main' && !seen.has(f.path)) { seen.add(f.path); out.unshift(f.path); f = f.parent ? fileOf.get(f.parent) : undefined; }
    return [main.path, ...out];
  };
  const texts = new Map<string, string>([[main.path, '']]);
  const cmds = new Map<string, string>();
  const closed = new Set<string>();
  const stack = [main.path];
  const started = new Set<string>();
  const close = (p: string) => { texts.set(p, texts.get(p)! + (fileOf.get(p)?.tail ?? '\n')); closed.add(p); };
  for (const b of [...blocks].sort(byPos)) {
    let target = fileOf.has(b.file) ? b.file : main.path;
    let want = chain(target);
    if (closed.has(target) || want.some((p) => closed.has(p))) {
      warnings.push(`block ${b.id} (${b.file}) is outside its file's run: written into ${stack[stack.length - 1]}`);
      want = stack.slice();
      target = want[want.length - 1];
    }
    let common = 0;
    while (common < stack.length && common < want.length && stack[common] === want[common]) common++;
    while (stack.length > common) close(stack.pop()!);
    for (let i = common; i < want.length; i++) {
      const f = fileOf.get(want[i])!;
      const parent = stack[stack.length - 1];
      const cmd = f.cmd ?? `\\input{${f.path.replace(/\.tex$/, '')}}`;
      cmds.set(f.path, cmd);
      texts.set(parent, texts.get(parent)! + (f.before ?? (started.has(parent) ? '\n\n' : '\n')) + MARK(f.path));
      started.add(parent);
      texts.set(f.path, '');
      stack.push(f.path);
    }
    const before = typeof b.attrs?.before === 'string' ? b.attrs.before : (started.has(target) ? '\n\n' : (target === main.path ? '\n' : ''));
    texts.set(target, texts.get(target)! + before + rewriteSource(b.source, figs, usedStems));
    started.add(target);
  }
  while (stack.length > 1) close(stack.pop()!);
  // main: preamble + \begin{document} + body + tail (\end{document} …)
  let pre = doc.preamble.source;
  if (!/^[ \t]*\\documentclass\b/m.test(pre)) pre = `\\documentclass${doc.settings.classOptions ? `[${doc.settings.classOptions}]` : ''}{${doc.settings.class || 'article'}}\n${pre}`;
  const used = [...usedStems].map((s) => figs.get(s)!);
  pre = withAdditions(pre, preambleAdditions(pre, used));
  const td = titleData(pre, o, warnings);
  pre = td.pre;
  const mainTail = main.tail ?? '\n\n\\end{document}\n';
  texts.set(main.path, pre + (main.head ?? '\\begin{document}') + texts.get(main.path)! + mainTail);
  return { texts, cmds, warnings, used, ship: td.ship };
}

function encode(text: string, f?: DocFile): Uint8Array {
  if (f?.eol === 'crlf') text = text.replace(/\n/g, '\r\n');
  if (f?.encoding === 'latin1') { const b = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i) & 255; return b; }
  return new TextEncoder().encode(text);
}

/** The multi-file project. */
export function exportFiles(doc: Doc, blocks: Block[], assets: Asset[], o: ExportOptions = {}): { entries: ProjectEntry[]; warnings: string[] } {
  const figs = editedFigures(assets);
  // a container and its paragraphs are one environment in the file again
  const { texts, cmds, warnings, ship } = buildTexts(doc, flattenForExport(blocks), figs, o);
  const fileOf = new Map(doc.files.map((f) => [f.path, f]));
  const entries: ProjectEntry[] = [];
  const mainPath = doc.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
  for (const [path, t] of texts) entries.push({ path, kind: path === mainPath ? 'main' : 'input', data: encode(t.replace(MARK_RE, (_, p) => cmds.get(p) ?? ''), fileOf.get(path)) });
  const names = new Set(entries.map((e) => e.path));
  if (doc.bib.kind !== 'none' && doc.bib.source) {
    const main = doc.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
    const path = doc.bib.path ?? main.replace(/\.[^.]+$/, doc.bib.kind === 'bbl' ? '.bbl' : '.bib');
    entries.push({ path, kind: doc.bib.kind === 'bbl' ? 'bbl' : 'bib', data: new TextEncoder().encode(doc.bib.source) });
    names.add(path);
  }
  // the title package beside the main file (a file of the project's own wins)
  if (ship && !names.has(PACKAGE_FILE)) { entries.push({ path: PACKAGE_FILE, kind: 'package', data: new TextEncoder().encode(metaPackage()) }); names.add(PACKAGE_FILE); }
  for (const a of assets) {
    if (names.has(a.name)) { warnings.push(`asset ${a.name} has the name of a text file; skipped`); continue; }
    if (!a.bytes) { warnings.push(`asset ${a.name}: no bytes; skipped`); continue; }
    entries.push({ path: a.name, kind: isFigure(a.name) ? 'figure' : 'asset', assetId: a.id, data: a.bytes });
    names.add(a.name);
  }
  // edited figures: the rendition and the Ipe document next to the (stale) original
  for (const f of figs.values()) {
    for (const [path, text] of [[f.tikzPath, f.tikz], [f.ipePath, f.xml]] as Array<[string | null, string | null]>) {
      if (!path || text == null) continue;
      if (names.has(path)) { warnings.push(`${path} exists already; the edited figure's file replaces it`); const i = entries.findIndex((e) => e.path === path); entries.splice(i, 1); }
      entries.push({ path, kind: 'rendition', of: f.asset.name, data: new TextEncoder().encode(text.endsWith('\n') ? text : text + '\n') });
      names.add(path);
    }
  }
  return { entries, warnings };
}

/** One .tex with the editor's block structure in comment lines (markers.ts):
 *  every block in document order after its marker, the bibliography and edited
 *  figures in filecontents* at the top (flat names). \input files are not
 *  kept as files (each block's marker names its file). Images cannot be
 *  inlined: `missing` names them. */
export function exportSingle(doc: Doc, blocks: Block[], assets: AssetMeta[], o: ExportOptions = {}): { text: string; missing: string[]; warnings: string[] } {
  const figs = editedFigures(assets, { flat: true });
  const warnings: string[] = [];
  const main = doc.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
  const used = new Set<string>();
  // document order from the tree: a container, its paragraphs (marked parent=), then the next block
  const marked: MarkedBlock[] = treeOrder([...blocks].sort(byPos)).order.map((b) => {
    const figures: Array<[string, string]> = [];
    const source = rewriteSource(b.source, figs, used, figures);
    return { block: b, source, figures };
  });
  let pre = doc.preamble.source;
  if (!/^[ \t]*\\documentclass\b/m.test(pre)) {
    pre = `${ADDED_START}\n\\documentclass${doc.settings.classOptions ? `[${doc.settings.classOptions}]` : ''}{${doc.settings.class || 'article'}}\n${ADDED_END}\n${pre}`;
  }
  pre = withAdditions(pre, preambleAdditions(pre, [...used].map((s) => figs.get(s)!)));
  const td = titleData(pre, o, warnings);
  pre = td.pre;
  const fc = (name: string, body: string) => `\\begin{filecontents*}[overwrite]{${name}}\n${body.replace(/\s+$/, '')}\n\\end{filecontents*}\n`;
  let top = '';
  if (doc.bib.kind !== 'none' && doc.bib.source) {
    // LaTeX reads the .bbl as \jobname.bbl (\bibliography, biblatex), and the file is saved under the
    // document's title, not the main file's name: so the .bbl is written for whatever name the .tex has
    top += fc(doc.bib.kind === 'bbl' ? '\\jobname.bbl' : (doc.bib.path ?? main.replace(/\.[^.]+$/, '.bib')).split('/').pop()!, doc.bib.source);
  }
  if (td.ship) top += fc(PACKAGE_FILE, metaPackage());                // the title package travels inside the file
  // edited figures travel inside the file (the .tikz is \input, the .ipe to reopen in Ipe)
  for (const f of figs.values()) { top += fc(f.tikzPath, f.tikz); if (f.ipePath && f.xml) top += fc(f.ipePath, f.xml); }
  const text = writeMarked(doc, marked, pre, top);
  return { text, missing: assets.filter((a) => !figs.has(a.name.replace(/\.[A-Za-z0-9]+$/, ''))).map((a) => a.name), warnings };
}

export const slug = (s: string) => (s || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';

/** An OpenDoc (contracts.d.ts) as a zip; asset bytes through getAsset. */
/** An OpenDoc's assets with their bytes, as the export takes them (zipOpenDoc; files.ts's list) */
export async function loadAssets(doc: OpenDoc, getAsset: (id: string) => Promise<Asset | null>): Promise<Asset[]> {
  const assets: Asset[] = [];
  for (const m of doc.assets ?? []) { const a = await getAsset(m.id); if (a) assets.push(a); }
  return assets;
}

export async function zipOpenDoc(doc: OpenDoc, getAsset: (id: string) => Promise<Asset | null>, o: ExportOptions = {}): Promise<{ name: string; data: Uint8Array; warnings: string[] }> {
  const { entries, warnings } = exportFiles(doc, doc.blocks, await loadAssets(doc, getAsset), o);
  return { name: `${slug(doc.title)}.zip`, data: await writeZip(entries), warnings };
}

export async function exportZipFromStore(store: DocStore, docId: string) {
  const doc = await store.getDoc(docId);
  if (!doc) throw new Error(`no document ${docId}`);
  return zipOpenDoc(doc, (id) => store.getAsset(docId, id));
}

export async function exportTexFromStore(store: DocStore, docId: string): Promise<{ name: string; text: string; missing: string[]; warnings: string[] }> {
  const doc = await store.getDoc(docId);
  if (!doc) throw new Error(`no document ${docId}`);
  return { name: `${slug(doc.title)}.tex`, ...exportSingle(doc, doc.blocks, doc.assets) };
}

/** Save bytes as a download (browser). */
export function download(name: string, data: Uint8Array | string | Blob, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
