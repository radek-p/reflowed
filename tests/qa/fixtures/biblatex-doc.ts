// A biblatex document for the tests (it replaces the former sample paper, the only biblatex document the tests had):
// made-up references (no real people or publications), style=alphabetic, the .bbl written by the editor's own
// BibTeX → .bbl path (app/src/bib/bibtex.ts addBibtex, biblatex's bbl format 3.2, as biber writes it). Labels: DG25a and
// DG25b (two by the same authors in a year: extraalpha), Gda23, Gda24, Ard+22 (four authors), Mäl24, Smi19, …; one
// accented family name (Gdański) in four entries, written as Unicode and as a TeX accent.
//
//   BIBTEX, BBL (the .bbl text), PREAMBLE, BLOCKS (paragraphs citing every entry, a numbered theorem, \printbibliography)
//   biblatexDoc(title?) -> a createDoc init (title, preamble, bib { kind: 'bbl' }, blocks)
//   Ben20 and Clay18 are cited nowhere (Remove unused).
//   ACCENTED = 'Gdański' (an author in N_ACCENTED entries), COLLIDING = 'DG25a' (a key whose label an added DG25 entry shifts)
import { addBibtex } from '../../../app/src/bib/bibtex.ts';

export const BIBTEX = String.raw`
@article{DG25a, author = {Doe, Jan and Gda{\'n}ski, Ola}, title = {Merging blocks of text}, journal = {Journal of Tests}, volume = {3}, pages = {1--20}, year = {2025}, doi = {10.0000/test.2025.1}}
@inproceedings{DG25b, author = {Doe, Jan and Gdański, Ola}, title = {Reflowing proofs}, booktitle = {Proceedings of the Workshop on Examples}, pages = {33--44}, year = {2025}}
@article{Gda23, author = {Gdański, Ola}, title = {Widths of paragraphs}, journal = {Annals of Made-up Results}, year = {2023}, url = {https://example.org/gda23}}
@book{Gda24, author = {Gda{\'n}ski, Ola}, title = {A Book of Boxes and Glue}, publisher = {Example Press}, address = {Nowhere}, year = {2024}}
@article{Ard22, author = {Arden, Zoë and Clay, Bea and Kowal, Wit and Mäller, Nils}, title = {Four authors at once}, journal = {Letters in Testing}, year = {2022}}
@inproceedings{Mal24, author = {Mäller, Nils}, title = {Counting lines}, booktitle = {Symposium on Sample Data}, year = {2024}, eprint = {2401.00001}, eprinttype = {arXiv}}
@book{Smi19, author = {Smith, John}, title = {Typesetting by Hand}, publisher = {Example Press}, year = {2019}}
@article{Ann21, author = {Author, Ann}, title = {On the first author}, journal = {Journal of Tests}, year = {2021}}
@misc{Ben20, author = {Example, Ben}, title = {A note on notes}, year = {2020}, howpublished = {A made-up note}}
@article{Clay18, author = {Clay, Bea and Kowal, Wit}, title = {Two authors, one label}, journal = {Letters in Testing}, year = {2018}}
`;
export const ACCENTED = 'Gdański';
export const N_ACCENTED = 4;
export const COLLIDING = 'DG25a';
export const BBL = addBibtex(null, BIBTEX).bbl;
export const KEYS = ['DG25a', 'DG25b', 'Gda23', 'Gda24', 'Ard22', 'Mal24', 'Smi19', 'Ann21', 'Ben20', 'Clay18'];

export const PREAMBLE = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage[style=alphabetic,backend=biber]{biblatex}
\addbibresource{refs.bib}
\usepackage{hyperref}
\usepackage[capitalise]{cleveref}
\newtheorem{theorem}{Theorem}[section]
\title{A Biblatex Test Document (made up)}
\author{A. Author}
\date{}`;

export const BLOCKS: { kind?: string; source: string }[] = [
  { kind: 'title', source: '\\maketitle' },
  { kind: 'heading', source: '\\section{References in a test}\\label{sec:refs}' },
  { kind: 'paragraph', source: 'Blocks can be merged~\\cite{DG25a} and proofs reflowed~\\cite{DG25b}. The widths of paragraphs were studied before~\\cite{Gda23}, and a book collects the rest~\\cite{Gda24}. Four authors wrote one paper~\\cite{Ard22}.' },
  { kind: 'theorem', source: '\\begin{theorem}\\label{thm:one}\nEvery line can be counted~\\cite{Mal24}.\n\\end{theorem}' },
  { kind: 'paragraph', source: 'By hand, typesetting is slow~\\cite{Smi19}; see also~\\cite{Ann21}. \\Cref{thm:one} is the main result of \\cref{sec:refs}.' },
  { kind: 'paragraph', source: 'A second paragraph that cites nothing, long enough to be broken into several lines at the usual widths of a column, so that a test can click on its words and find a caret there.' },
  { kind: 'paragraph', source: 'A third paragraph, also without a citation, that talks about lines and words at some length so that it fills a few lines of the column at any width the tests use, which is all it is for.' },
  { kind: 'paragraph', source: 'A fourth paragraph in the same spirit: nothing cited, nothing labelled, only enough plain words to be broken into lines, so that a citation can be put at its end by a test and typeset again.' },
  { kind: 'bibliography', source: '\\printbibliography' },
];

export function biblatexDoc(title = 'Biblatex test document'): { title: string; preamble: string; bib: { kind: 'bbl'; source: string; path: string }; blocks: { kind?: string; source: string }[] } {
  return { title, preamble: PREAMBLE, bib: { kind: 'bbl', source: BBL, path: 'refs.bbl' }, blocks: BLOCKS.map((b) => ({ ...b })) };
}

/** Playwright's Page, as far as openBiblatexDoc needs it */
interface PageLike { evaluate<R, A>(fn: (a: A) => R | Promise<R>, arg: A): Promise<R>; waitForFunction<A>(fn: (a: A) => unknown, arg: A, o?: { timeout?: number }): Promise<unknown> }
/** The biblatex document created in the page's store and opened, typeset (editorAPI.whenIdle()): its doc id. */
export async function openBiblatexDoc(page: PageLike, title?: string): Promise<string> {
  const id = await page.evaluate((i: unknown) => (window as any).editorAPI.store().createDoc(i) as Promise<string>, biblatexDoc(title));
  await page.evaluate((d: string) => { location.hash = `#/doc/${d}`; }, id);
  await page.waitForFunction((d: string) => (window as any).editorAPI?.route?.().id === d && !!(window as any).editorAPI.currentDoc?.(), id, { timeout: 300000 });
  await page.evaluate((_: null) => (window as any).editorAPI.whenIdle(), null);
  return id;
}
