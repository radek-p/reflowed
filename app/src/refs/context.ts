// The context prefix of a block: what the blocks before it would have left
// in TeX that shows in this block, as TeX put before the block's source when
// it is compiled on its own. It is part of the block's cache key, so a block
// recompiles only when its context changes.
//
//   contextFor(blocks, i) -> string      (contract: BlockRequest.context)
//   contextInfo(blocks, i) -> { prefix, flags, key, defs, restated }
//   contextsFor(blocks)    -> every block's, in one pass
//
// The prefix, lines joined with "\n" (the backend puts "\n" between it and
// the block's source and subtracts its lines from error line numbers):
//   1. definitions: every earlier block that only defines (its source starts
//      with \newcommand, \def, \let, \DeclareMathOperator, … and nothing in it
//      typesets: tex/definitions.ts), and every
//      top-level definition made inside any other earlier block (a
//      \newcommand between two paragraphs: tex/definitions.ts), in
//      document order, between \rtxdefsbegin … \rtxdefsend (redefining is
//      then allowed, so the same block again in one batch does not fail);
//   2. for each \name* (thm-restate) in the block: the `restatable` block that
//      defines \name, typeset into a discarded box (it defines \name globally);
//   3. \rtxcontext{flags}, last (it starts the block's own numbering state):
//        appendix      a block before this one has \appendix (run again:
//                      \Alph formats, the section counter reset)
//        afterheading  the block before ends with \section/\subsection/…: the
//                      first paragraph is not indented (\@afterheading)
//        (none)        undoes what an earlier part of the same batch left
//   4. for the block with \printbibliography: \rtxcited{every cited key}.
// Before 3, for a block that cites keys of a bibtex-style bibliography
//      (opts.bbl's thebibliography, or a thebibliography block): their
//      \bibitem's, \rtxbibcites{…} (bib/bibitems.ts), so \cite prints the
//      label print gives instead of [?].
// Every command is guarded by \ifdefined, so a preamble without
// rtx-numbering.sty only loses the flags.
//
// Counter values are NOT in the prefix: the overlay renumbers without
// compiling (\setcounter in a block is applied by the overlay at the block's
// start), so moving a block recompiles it only when a flag, the definitions
// before it, or (for the bibliography) the cited keys change.
import { scanSource } from './scan.ts';
import { contributedDefinitions } from '../tex/definitions.ts';
import { bibitemsOf, bibciteContext, type BibItem } from '../bib/bibitems.ts';

/** What the blocks alone do not say: the document's .bbl (doc.bib.source when doc.bib.kind is 'bbl'). */
export interface ContextOptions { bbl?: string | null }

export interface ContextBlock { id?: string; kind?: string; source: string; attrs?: { restatable?: string; [k: string]: unknown } }
export interface BlockContext {
  prefix: string;
  flags: string[];
  key: string;
  /** indices of the blocks whose definitions are included (whole, or their top-level definitions) */
  defs: number[];
  /** restatable names included (\name*) */
  restated: string[];
}

/** Every key cited in the document, in order of first citation. */
export function citedKeys(blocks: ContextBlock[]): string[] {
  const seen = new Set<string>();
  for (const b of blocks) for (const u of scanSource(b.source).cites) for (const k of u.keys) seen.add(k);
  return [...seen];
}

export function contextsFor(blocks: ContextBlock[], opts: ContextOptions = {}): BlockContext[] {
  const scans = blocks.map((b) => scanSource(b.source));
  let items: Map<string, BibItem> | null = null;
  const bibitems = () => (items ??= bibitemsOf([opts.bbl, ...blocks.map((b) => b.source)]));
  const restatables = new Map<string, number>();
  scans.forEach((s, i) => { const r = (blocks[i].attrs?.restatable as string | undefined) ?? s.restatable; if (r && !restatables.has(r)) restatables.set(r, i); });
  const out: BlockContext[] = [];
  let appendix = false;
  let keys: string[] | null = null;
  const defs: number[] = [];
  const defText: string[] = [];                     // the definitions' source, in document order
  for (let i = 0; i < blocks.length; i++) {
    const sc = scans[i];
    const lines: string[] = [];
    if (defText.length) {
      lines.push('\\ifdefined\\rtxdefsbegin\\rtxdefsbegin\\fi');
      for (const t of defText) lines.push(t);
      lines.push('\\ifdefined\\rtxdefsend\\rtxdefsend\\fi');
    }
    const restated: string[] = [];
    for (const name of sc.starred) {
      const j = restatables.get(name);
      if (j === undefined || j === i) continue;
      restated.push(name);
      lines.push(`\\setbox0=\\vbox{${blocks[j].source}}`);
    }
    if (sc.cites.length) {
      const bc = bibciteContext(sc.cites.flatMap((u) => u.keys), bibitems());
      if (bc) lines.push(bc);
    }
    const flags: string[] = [];
    if (appendix) flags.push('appendix');
    if (i > 0 && scans[i - 1].endsWithHeading) flags.push('afterheading');
    lines.push(`\\ifdefined\\rtxcontext\\rtxcontext{${flags.join(',')}}\\fi`);
    if (sc.bibliography) {
      flags.push('bibliography');
      keys ??= citedKeys(blocks);
      if (keys.length) lines.push(`\\ifdefined\\rtxcited\\rtxcited{${keys.join(',')}}\\fi`);
    }
    const prefix = lines.join('\n');
    out.push({ prefix, flags, key: prefix, defs: [...defs], restated });
    if (sc.appendix) appendix = true;
    // its definitions only, or the block whole when it typesets nothing (tex/definitions.ts)
    const given = contributedDefinitions(blocks[i]);
    if (given.length) { defs.push(i); defText.push(...given); }
  }
  return out;
}

// One block's context: every block's is computed at once and kept while
// the sources stay the same (the app asks for each block in turn). one memo per document:
// createContexts() is a refs instance's own (refs/index.ts createRefs), so two documents open at once do not
// throw each other's away; contextInfo / contextFor below are the page's first one.
export interface Contexts {
  contextInfo(blocks: ContextBlock[], i: number, opts?: ContextOptions): BlockContext;
  contextFor(blocks: ContextBlock[], i: number, opts?: ContextOptions): string;
  /** how many times the contexts were computed (tests: a memo hit computes nothing) */
  runs(): number;
}
export function createContexts(): Contexts {
  let memo: { blocks: ContextBlock[]; sources: string[]; bbl: string | null; out: BlockContext[] } | null = null;
  let runs = 0;
  function contextInfo(blocks: ContextBlock[], i: number, opts: ContextOptions = {}): BlockContext {
    const bbl0 = opts.bbl ?? null;
    // the same list asked again (a pass over every block asks with one array): the memo as it is.
    // Comparing every source on every call made a pass O(n²) (241 ms at 600 blocks)
    if (memo && memo.blocks === blocks && memo.bbl === bbl0) return memo.out[i] ?? { prefix: "", flags: [], key: "", defs: [], restated: [] };
    const sources = blocks.map((b) => `${b.kind ?? ''}\0${b.attrs?.restatable ?? ''}\0${b.source}`);
    const bbl = opts.bbl ?? null;
    if (!memo || memo.bbl !== bbl || memo.sources.length !== sources.length || memo.sources.some((s, k) => s !== sources[k])) { runs++; memo = { blocks, sources, bbl, out: contextsFor(blocks, opts) }; }
    else memo.blocks = blocks;
    return memo.out[i] ?? { prefix: "", flags: [], key: "", defs: [], restated: [] };
  }
  /** contract: the prefix only. */
  const contextFor = (blocks: ContextBlock[], i: number, opts: ContextOptions = {}): string => contextInfo(blocks, i, opts).prefix;
  return { contextInfo, contextFor, runs: () => runs };
}
const pageContexts = createContexts();
export function contextInfo(blocks: ContextBlock[], i: number, opts: ContextOptions = {}): BlockContext { return pageContexts.contextInfo(blocks, i, opts); }
/** contract: the prefix only. */
export function contextFor(blocks: ContextBlock[], i: number, opts: ContextOptions = {}): string { return pageContexts.contextFor(blocks, i, opts); }
