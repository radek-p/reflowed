// The document's files, for the Files panel: exactly the files the Export .zip writes (exportFiles' entries,
// the one list), each with its kind, its size and where it is used.
//
//   projectFiles(doc, getAsset, o?, used?) → { files: ProjectFile[], warnings }   (async: the assets' bytes, as the zip)
//   listFiles(doc, assets, o?, used?)      → { files, warnings }                  (the same, assets already loaded)
//   usesOf(files, doc, used?)                                                     each file's blocks (document order)
//                                                                                 and whether the preamble uses it
//   used: { block(b), preamble() } → doc/block-files.ts Used: what each block and the preamble use (their last
//         results' records and their sources' names); none given: the sources' names only
//
// Where a file is used: the main file and an \input file by the blocks written into them; a figure (or any asset) by
// the blocks that use it (what their compile opened: a figure a macro places too; what their source names: the path,
// or its end after a \graphicspath folder, with or without the extension); a package, class or style by the
// preamble the same way; the .bib/.bbl by the bibliography's block (\bibliography, \printbibliography);
// reflowed-meta.sty by the preamble and the \maketitle block; a figure's rendition (.tikz, .ipe) where its figure
// is. Comments do not count.
import type { Asset, OpenDoc } from '../store/types.ts';
import { byPos } from '../store/fracindex.ts';
import { treeOrder } from '../nesting/model.ts';
import { exportFiles, loadAssets, type ExportOptions, type FileKind, type ProjectEntry } from './export.ts';
import { codeOf } from './split.ts';
import { usedBy, usesFile, type Used } from '../doc/block-files.ts';

/** what each block and the preamble use (doc/block-files.ts) */
export interface FilesUsed { block(b: { id: string; source: string }): Used; preamble(): Used }

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
export async function projectFiles(doc: OpenDoc, getAsset: (id: string) => Promise<Asset | null>, o: ExportOptions = {}, used?: FilesUsed): Promise<{ files: ProjectFile[]; warnings: string[] }> {
  return listFiles(doc, await loadAssets(doc, getAsset), o, used);
}

export function listFiles(doc: OpenDoc, assets: Asset[], o: ExportOptions = {}, used?: FilesUsed): { files: ProjectFile[]; warnings: string[] } {
  const { entries, warnings } = exportFiles(doc, doc.blocks, assets, o);
  return { files: usesOf(entries, doc, used), warnings };
}

const BIB_BLOCK = /\\(?:bibliography|printbibliography)\b|\\begin\s*\{thebibliography\}/;
const MAKETITLE = /\\maketitle\b/;

export function usesOf(entries: ProjectEntry[], doc: OpenDoc, used?: FilesUsed): ProjectFile[] {
  const order = treeOrder([...doc.blocks].sort(byPos)).order;
  const code = new Map(order.map((b) => [b.id, b.source.split('\n').map(codeOf).join('\n')]));
  const uses = new Map(order.map((b) => [b.id, used ? used.block(b) : usedBy(b.source)]));
  const pre = used ? used.preamble() : usedBy(doc.preamble.source);
  const mainPath = doc.files.find((f) => f.role === 'main')?.path ?? 'main.tex';
  const known = new Set(doc.files.map((f) => f.path));
  const fileOf = (b: { file: string }) => (known.has(b.file) ? b.file : mainPath);
  const byRef = (path: string) => order.filter((b) => usesFile(uses.get(b.id)!, path)).map((b) => b.id);
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
        f.preamble = usesFile(pre, e.path);
        break;
      case 'package':
        f.uses = order.filter((b) => MAKETITLE.test(code.get(b.id)!)).map((b) => b.id);
        f.preamble = usesFile(pre, e.path);
        break;
      case 'rendition':
        break;                                                 // below: its figure's
      default:
        f.uses = byRef(e.path);
        f.preamble = usesFile(pre, e.path);
    }
    return f;
  });
  const byPath = new Map(out.map((f) => [f.path, f]));
  for (const f of out) if (f.kind === 'rendition' && f.of) { const g = byPath.get(f.of); f.uses = g ? [...g.uses] : byRef(f.of); }
  return out;
}
