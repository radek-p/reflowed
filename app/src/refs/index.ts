// numbers, references and the bibliography of an editor document.
// `rtx:refs` (contracts.d.ts `Refs`):
//
//   refs.contextFor(blocks, i)   TeX put before block i when it is compiled
//                                (definitions, restatables, \appendix,
//                                \@afterheading, the cited keys): context.ts
//   refs.update(doc, blocks)     numbers and references of the mounted
//                                blocks, set in place (the overlay,
//                                numbering.ts), and the state below
//   refs.refsState()             labels, refs, cites, bib, numbers per block,
//                                duplicates (+ diagnostics …): state.ts
//   refs.onChange(fn)            after every update
//   createRefs() one document's refs (the above, its own state): one per open document;
//                                `refs` is the first one
//
// Also exported for tools and tests: contextInfo / contextsFor, parseBbl,
// searchBbl, addBibtex (bib/bibtex.ts), numberingState, refText.
import { contextFor, contextInfo, contextsFor, citedKeys, createContexts } from './context.ts';
import { numberDocument, numberingState, refText, type BlockEntry, type NumberingState } from './numbering.ts';
import { buildRefsState, type RefsState } from './state.ts';
import { scanSource, stripComments } from './scan.ts';
import { parseBbl, searchBbl, type Bbl } from '../bib/bbl.ts';
import { addBibtex, parseBibtex } from '../bib/bibtex.ts';

export { contextFor, contextInfo, contextsFor, citedKeys, createContexts, numberDocument, numberingState, refText, parseBbl, searchBbl, addBibtex, parseBibtex, scanSource };
export type { RefsState };

interface DocLike { preamble?: string; bib?: { kind?: string; source?: string } | null }
interface EntryLike { id: string; kind?: string; source: string; el?: HTMLElement | null; block?: unknown | null; key?: string | null }

/** Blocks that restate another (thm-restate: a block that is only \name or \name*). */
export function recallsOf(blocks: { id: string; source: string }[]): Map<string, string> {
  const defining = new Map<string, string>();
  for (const b of blocks) { const r = scanSource(b.source).restatable; if (r && !defining.has(r)) defining.set(r, b.id); }
  const out = new Map<string, string>();
  for (const b of blocks) {
    const m = /^\s*\\([A-Za-z]+)\*?\s*$/.exec(stripComments(b.source));
    const orig = m && defining.get(m[1]);
    if (orig && orig !== b.id) out.set(b.id, orig);
  }
  return out;
}

/** The refs of one document: its labels, numbers, bibliography and listeners. A page with two documents
 *  open (split view, pane B on another one) has one each; `slots` says how the numbering gives reference slots
 *  their texts (numbering.ts NumberOptions: 'page' by name, 'instances' per slot when documents share the page). */
export interface Refs {
  refsState(): RefsState;
  contextFor: typeof contextFor;
  update(doc: DocLike, blocks: EntryLike[]): RefsState;
  onChange(fn: (s: RefsState) => void): () => void;
  setBibliography(source: string | null): Bbl | null;
  bibliography(): Bbl | null;
  /** the numbering's last run for this document (refnav's card copy) */
  numbering(): NumberingState;
  /** 'instances' from the moment another document shares the page (sticky: texts set per slot stay that way) */
  setSlots(mode: 'page' | 'instances'): void;
  /** how many times this document's contexts were computed (tests) */
  contextRuns(): number;
}

export function createRefs(): Refs {
  let bblSource: string | null = null;
  let bbl: Bbl | null = null;
  let rev = 0;
  let state: RefsState = { rev: 0, labels: {}, refs: [], cites: [], bib: {}, numbers: {}, duplicates: [], diagnostics: [], unknownCites: [], pending: [], refTexts: {} };
  let last: NumberingState = { items: [], labels: {}, refs: {}, refsByBlock: {}, duplicates: [], mounted: [], runs: 0 };
  let slots: 'page' | 'instances' = 'page';
  const names = new Map<string, string>();
  const listeners = new Set<(s: RefsState) => void>();
  const ctxs = createContexts();               // this document's contexts memo

  function setBibliography(source: string | null): Bbl | null {
    if (source !== bblSource) { bblSource = source; bbl = source ? parseBbl(source) : null; }
    return bbl;
  }
  function update(doc: DocLike, blocks: EntryLike[]): RefsState {
    setBibliography(doc?.bib && (doc.bib.kind ?? 'bbl') === 'bbl' ? doc.bib.source ?? null : null);
    const recallOf = recallsOf(blocks);
    const entries: BlockEntry[] = blocks.map((b) => ({ id: b.id, source: b.source, type: b.kind, block: (b.block as BlockEntry['block']) ?? null }));
    last = numberDocument(entries, undefined, recallOf, { slots, names });
    state = buildRefsState(blocks, last, bbl, ++rev, recallOf, bblSource);
    for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } }
    return state;
  }
  return {
    refsState: () => state, contextFor: ctxs.contextFor, contextRuns: ctxs.runs, update,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setBibliography, bibliography: () => bbl,
    numbering: () => last,
    setSlots(mode) { if (slots !== 'instances') slots = mode; },
  };
}

export const refs = createRefs();
export const setBibliography = (source: string | null): Bbl | null => refs.setBibliography(source);
export const bibliography = (): Bbl | null => refs.bibliography();
export const update = (doc: DocLike, blocks: EntryLike[]): RefsState => refs.update(doc, blocks);
export function refsState(): RefsState { return refs.refsState(); }
export function onChange(fn: (s: RefsState) => void): () => void { return refs.onChange(fn); }
export default refs;
