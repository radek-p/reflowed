// The document's files, for the Files panel: exactly the files the Export .zip writes (exportFiles' entries,
// the one list), each with its kind, its size and where it is used.
//
//   projectFiles(doc, getAsset, o?) → { files: ProjectFile[], warnings }   (async: the assets' bytes, as the zip)
//   listFiles(doc, assets, o?)      → { files, warnings }                  (the same, assets already loaded)
//   usesOf(files, doc)                                                     each file's blocks (document order) and
//                                                                          whether the preamble uses it
//
// Where a file is used: the main file and an \input file by the blocks written into them; a figure (or any asset) by
// the blocks whose \includegraphics, \input or \include name it (the path, or its end after a \graphicspath folder,
// with or without the extension); a package, class or style by \usepackage, \documentclass or \bibliographystyle in
// the preamble; the .bib/.bbl by the bibliography's block (\bibliography, \printbibliography); reflowed-meta.sty by
// the preamble and the \maketitle block; a figure's rendition (.tikz, .ipe) where its figure is. Comments do not count.
import type { Asset, OpenDoc } from '../store/types.ts';
import { byPos } from '../store/fracindex.ts';
import { treeOrder } from '../nesting/model.ts';
import { exportFiles, loadAssets, type ExportOptions, type FileKind, type ProjectEntry } from './export.ts';
import { codeOf } from './split.ts';

export interface ProjectFile {
  path: string;
  kind: FileKind;
  /** bytes, as written into the zip */
  size: number;
  assetId?: string;
  /** a rendition's figure */
  of?: string;
  /** the blocks that use it, in document order */
  uses: string[];
  /** the preamble uses it (the main file: it holds the preamble) */
  preamble: boolean;
}

/** The same files as the Export .zip (zipOpenDoc), with their uses. */
export async function projectFiles(doc: OpenDoc, getAsset: (id: string) => Promise<Asset | null>, o: ExportOptions = {}): Promise<{ files: ProjectFile[]; warnings: string[] }> {
  return listFiles(doc, await loadAssets(doc, getAsset), o);
}

export function listFiles(doc: OpenDoc, assets: Asset[], o: ExportOptions = {}): { files: ProjectFile[]; warnings: string[] } {
  const { entries, warnings } = exportFiles(doc, doc.blocks, assets, o);
  return { files: usesOf(entries, doc), warnings };
}

const EXT = /\.[A-Za-z0-9]+$/;
const stem = (p: string) => p.replace(EXT, '');
/** A reference `r` (as written in the source) names file `p`: the path, or its end after a folder, ± the extension. */
function names(p: string, r: string): boolean {
  r = r.trim().replace(/^\.\//, '');
  if (!r) return false;
  for (const x of [p, stem(p)]) if (x === r || x.endsWith(`/${r}`)) return true;
  return false;
}

const ARG = String.raw`\s*(?:\[[^\]]*\]\s*)*\{([^{}]*)\}`;
const REFS: Array<[RegExp, string]> = [
  [new RegExp(String.raw`\\includegraphics\*?${ARG}`, 'g'), ''],
  [new RegExp(String.raw`\\(?:input|include|subfile|includepdf|import\s*\{[^{}]*\})${ARG}`, 'g'), ''],
  [new RegExp(String.raw`\\(?:usepackage|RequirePackage)${ARG}`, 'g'), '.sty'],
  [new RegExp(String.raw`\\documentclass${ARG}`, 'g'), '.cls'],
  [new RegExp(String.raw`\\bibliographystyle${ARG}`, 'g'), '.bst'],
  [new RegExp(String.raw`\\(?:bibliography|addbibresource)${ARG}`, 'g'), '.bib'],
];
/** The file names a source refers to (comments left out); a package as name.sty, a class as name.cls, … */
export function refsIn(source: string): string[] {
  const code = source.split('\n').map(codeOf).join('\n');
  const out: string[] = [];
  for (const [re, ext] of REFS) {
    for (const m of code.matchAll(re)) {
      for (const n of (ext ? m[1].split(',') : [m[1]]).map((s) => s.trim()).filter(Boolean)) out.push(ext && !EXT.test(n) ? n + ext : n);
    }
  }
  return out;
}

const BIB_BLOCK = /\\(?:bibliography|printbibliography)\b|\\begin\s*\{thebibliography\}/;
const MAKETITLE = /\\maketitle\b/;

export function usesOf(entries: ProjectEntry[], doc: OpenDoc): ProjectFile[] {
  const order = treeOrder([...doc.blocks].sort(byPos)).order;
  const code = new Map(order.map((b) => [b.id, b.source.split('\n').map(codeOf).join('\n')]));
  const refs = new Map(order.map((b) => [b.id, refsIn(b.source)]));
  const preRefs = refsIn(doc.preamble.source);
  const mainPath = doc.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
  const known = new Set(doc.files.map((f) => f.path));
  const fileOf = (b: { file: string }) => (known.has(b.file) ? b.file : mainPath);
  const byRef = (path: string) => order.filter((b) => refs.get(b.id)!.some((r) => names(path, r))).map((b) => b.id);
  const out: ProjectFile[] = entries.map((e) => {
    const f: ProjectFile = { path: e.path, kind: e.kind, size: e.data.length, uses: [], preamble: false };
    if (e.assetId) f.assetId = e.assetId;
    if (e.of) f.of = e.of;
    switch (e.kind) {
      case 'main': case 'input':
        f.uses = order.filter((b) => fileOf(b) === e.path).map((b) => b.id);
        f.preamble = e.kind === 'main';
        break;
      case 'bib': case 'bbl':
        f.uses = order.filter((b) => b.kind === 'bibliography' || BIB_BLOCK.test(code.get(b.id)!)).map((b) => b.id);
        f.preamble = preRefs.some((r) => names(e.path, r));
        break;
      case 'package':
        f.uses = order.filter((b) => MAKETITLE.test(code.get(b.id)!)).map((b) => b.id);
        f.preamble = preRefs.some((r) => names(e.path, r));
        break;
      case 'rendition':
        break;                                                 // below: its figure's
      default:
        f.uses = byRef(e.path);
        f.preamble = preRefs.some((r) => names(e.path, r));
    }
    return f;
  });
  const byPath = new Map(out.map((f) => [f.path, f]));
  for (const f of out) if (f.kind === 'rendition' && f.of) { const g = byPath.get(f.of); f.uses = g ? [...g.uses] : byRef(f.of); }
  return out;
}
