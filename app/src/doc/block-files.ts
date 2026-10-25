// The files a block uses: what its last compile opened of the document (the engine's record, BlockResult.files: a
// figure a macro places, an \input file, a class's logo) and what its source names (the one scan of the source for
// file names; before the block's first compile it is all there is). The Files panel's "where used", a block's key
// (doc/derived.js: a figure replaced in place typesets its blocks again) and the SVG figures (svgfig: Edit figure,
// whether a drawn file is still used) read it. A result's record of the block is kept whole per block (its facts:
// the files today), so more of what TeX reports per block can join it. No DOM.
//
//   namedIn(source)           the file names a source writes (comments left out): \includegraphics, \input,
//                             \include, \subfile, \includepdf, \import; \usepackage as name.sty, \documentclass as
//                             name.cls, \bibliographystyle as name.bst, \bibliography and \addbibresource as name.bib
//   includesIn(source)        its \includegraphics as written: { name, opts, include } (a figure's options, the command)
//   namesFile(path, ref)      a name as written names the file at path: the path, or its end after a folder
//                             (\graphicspath), with or without the extension
//   usedBy(source, result?)   { opened, named }: the result's files (names as TeX opened them) and the source's names
//   usesFile(used, path)      the file at path is among them (opened: that very name; named: namesFile)
//   const files = createBlockFiles()
//     files.note(id, result)  a block's result landed: kept as its last; true when the block's files changed by it
//     files.of(block)         usedBy(block.source, its last result) · files.uses(block, path)
//     files.clear()           the document closed
import { stripComments } from '../../../loading/tex-comment.ts';

/** what a result says of the files (BlockResult.files): the names TeX asked for, found or not */
export interface FilesRecord { files?: unknown; transient?: boolean }
export interface Used {
  /** names as TeX opened them (the last result's record): a file of exactly that name */
  opened: readonly string[];
  /** names as the source writes them */
  named: readonly string[];
}
export interface Include { name: string; opts: string; include: string }

const ARG = String.raw`\s*(?:\[[^\]]*\]\s*)*\{([^{}]*)\}`;
// the only \includegraphics pattern: its options (the last bracket group) and its name
const GRAPHICS = /\\includegraphics\*?\s*(?:\[([^\]]*)\]\s*)*\{([^{}]*)\}/g;
const REFS: Array<[RegExp, string]> = [
  [new RegExp(String.raw`\\(?:input|include|subfile|includepdf|import\s*\{[^{}]*\})${ARG}`, 'g'), ''],
  [new RegExp(String.raw`\\(?:usepackage|RequirePackage)${ARG}`, 'g'), '.sty'],
  [new RegExp(String.raw`\\documentclass${ARG}`, 'g'), '.cls'],
  [new RegExp(String.raw`\\bibliographystyle${ARG}`, 'g'), '.bst'],
  [new RegExp(String.raw`\\(?:bibliography|addbibresource)${ARG}`, 'g'), '.bib'],
];
const EXT = /\.[A-Za-z0-9]+$/;
const stem = (p: string) => p.replace(EXT, '');
const EMPTY: readonly string[] = Object.freeze([]);

/** the source's \includegraphics, as written */
export function includesIn(source: string): Include[] {
  if (!source.includes('includegraphics')) return [];
  return [...stripComments(source).matchAll(GRAPHICS)].map((m) => ({ name: m[2].trim(), opts: m[1] ?? '', include: m[0] })).filter((x) => x.name);
}

// a source's names, once per text (a block's key reads them on every pass)
const scanned = new Map<string, readonly string[]>();
let scannedChars = 0;
/** The file names a source writes (comments left out); a package as name.sty, a class as name.cls, … */
export function namedIn(source: string): readonly string[] {
  if (!source.includes('\\')) return EMPTY;
  let hit = scanned.get(source);
  if (hit) return hit;
  const code = stripComments(source);
  const out: string[] = [];
  for (const m of code.matchAll(GRAPHICS)) { const n = m[2].trim(); if (n) out.push(n); }
  for (const [re, ext] of REFS) {
    for (const m of code.matchAll(re)) {
      for (const n of (ext ? m[1].split(',') : [m[1]]).map((s) => s.trim()).filter(Boolean)) out.push(ext && !EXT.test(n) ? n + ext : n);
    }
  }
  hit = out.length ? Object.freeze(out) : EMPTY;
  // every keystroke is a new text: the memo starts again past a bound (as engine/web/keys.js's)
  if (scanned.size > 20000 || scannedChars > 4_000_000) { scanned.clear(); scannedChars = 0; }
  scanned.set(source, hit);
  scannedChars += source.length;
  return hit;
}

/** A name as written (`ref`) names the file at `path`: the path, or its end after a folder, ± the extension. */
export function namesFile(path: string, ref: string): boolean {
  const r = ref.trim().replace(/^\.\//, '');
  if (!r) return false;
  for (const x of [path, stem(path)]) if (x === r || x.endsWith(`/${r}`)) return true;
  return false;
}

const filesOf = (r: FilesRecord | null | undefined): readonly string[] | null =>
  (r && !r.transient && Array.isArray(r.files) ? (r.files as unknown[]).filter((x): x is string => typeof x === 'string') : null);

/** what a source with that last result uses */
export function usedBy(source: string, result?: FilesRecord | null): Used {
  return { opened: filesOf(result) ?? EMPTY, named: namedIn(source) };
}
/** the file at path is one of them */
export function usesFile(u: Used, path: string): boolean {
  return u.opened.includes(path) || u.named.some((r) => namesFile(path, r));
}

/** One document's blocks: each one's last result's record (what TeX reported of it). */
export function createBlockFiles() {
  const last = new Map<string, { files: readonly string[] }>();
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return {
    /** a block's result landed (not a transient failure): its record kept; true when its files are not the ones
     *  the block had (its first compile, or an edit that changed what it opens) */
    note(id: string, r: FilesRecord | null | undefined): boolean {
      const files = filesOf(r);
      if (!files) return false;
      const was = last.get(id);
      last.set(id, { files });
      return !was || !same(was.files, files);
    },
    of(b: { id: string; source: string }): Used {
      return { opened: last.get(b.id)?.files ?? EMPTY, named: namedIn(b.source) };
    },
    uses(b: { id: string; source: string }, path: string): boolean {
      return usesFile(this.of(b), path);
    },
    clear() { last.clear(); },
  };
}
export type BlockFiles = ReturnType<typeof createBlockFiles>;
