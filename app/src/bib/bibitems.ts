// The \bibitem's of a bibtex-style bibliography (a thebibliography: the
// .bbl bibtex writes for plain, plainurl, alpha, natbib styles …, or a
// thebibliography block in the document), with the numbers LaTeX gives them,
// and what a block that cites some of them needs in front of it.
//
// A block is compiled on its own, so the .aux of a second LaTeX run (its
// \bibcite lines) is not there and every \cite printed [?]. The block's
// context now carries the cited keys' \bibitem's (rtx-numbering.sty's
// \rtxbibcites runs them in a discarded box with the .aux write caught, and
// reads the \bibcite lines back), so the label is the one the class, natbib
// and hyperref make, exactly as in print.
//
//   bibitemsOf(texts)                 -> Map<key, BibItem>   (the last \bibitem of a key wins, as the .aux does)
//   bibciteContext(keys, items)       -> the context line ('' when none of the keys is a \bibitem)
//   bibitemFields(body)              what an item's text says: author, title, journal, year, doi, url
//   isBiblatexBbl(text)               biber's .bbl (\entry records), which biblatex reads itself
import { blankComments } from '../tex/lex.ts';

export interface BibItem {
  key: string;
  /** the optional argument as written (\bibitem[opt]{key}), or null */
  opt: string | null;
  /** the kernel's list counter (enumiv) before this item: the \bibitem's without [opt] before it in its thebibliography */
  plain: number;
  /** natbib's counter (NAT@ctr) before this item: every \bibitem before it in its thebibliography */
  all: number;
  /** what LaTeX prints for it in plain style: opt, or the number */
  label: string;
  /** the item's text up to the next \bibitem or \end{thebibliography} (raw TeX) */
  body: string;
}

export const isBiblatexBbl = (text: string): boolean => /\\entry\s*\{/.test(text) && /\\endentry/.test(text);

/** The balanced [..] at s[i] (brace groups inside may hold ]): [content, index after], or null. */
function optAt(s: string, i: number): [string, number] | null {
  if (s[i] !== '[') return null;
  let depth = 0;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ']' && depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return null;
}
/** The balanced {..} at s[i]: [content, index after], or null. */
function groupAt(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return null;
}
const skipSpace = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

/** Every \bibitem in the texts (in order: the .bbl, then the document's blocks), numbered per thebibliography. */
export function bibitemsOf(texts: (string | null | undefined)[]): Map<string, BibItem> {
  const out = new Map<string, BibItem>();
  for (const text of texts) {
    if (!text || !text.includes('\\bibitem') || isBiblatexBbl(text)) continue;
    const s = blankComments(text);
    const tok = /\\begin\s*\{thebibliography\}|\\end\s*\{thebibliography\}|\\bibitem(?![a-zA-Z@])/g;
    let plain = 0, all = 0;
    let last: { item: BibItem; bodyAt: number } | null = null;
    const close = (end: number) => { if (last) { last.item.body = s.slice(last.bodyAt, end).replace(/[ \t]+\n/g, '\n').trim(); last = null; } };   // comments blanked
    let m: RegExpExecArray | null;
    while ((m = tok.exec(s))) {
      if (m[0].startsWith('\\begin')) { close(m.index); plain = 0; all = 0; continue; }
      if (m[0].startsWith('\\end')) { close(m.index); continue; }
      close(m.index);
      const at = skipSpace(s, m.index + m[0].length);
      const o = optAt(s, at);                // offsets are the text's (blankComments keeps them)
      const i = o ? skipSpace(s, o[1]) : at;
      const g = groupAt(s, i);
      if (!g) continue;
      const key = g[0].trim();
      const opt = o ? text.slice(at + 1, o[1] - 1) : null;
      const item: BibItem = { key, opt, plain, all, label: opt ?? String(plain + 1), body: '' };
      if (!opt) plain++;
      all++;
      out.delete(key);                       // the last one wins, and keeps its place last
      out.set(key, item);
      last = { item, bodyAt: g[1] };
      tok.lastIndex = g[1];
    }
    close(text.length);
  }
  return out;
}

/** The context line for a block citing `keys`: their \bibitem's for rtx-numbering's \rtxbibcites. */
export function bibciteContext(keys: string[], items: Map<string, BibItem>): string {
  const parts: string[] = [];
  for (const k of new Set(keys)) {
    const it = items.get(k);
    if (!it) continue;
    parts.push(`\\rtxbibitem{${it.plain}}{${it.all}}{\\bibitem${it.opt !== null ? `[${it.opt}]` : ''}{${it.key}}}`);
  }
  return parts.length ? `\\ifdefined\\rtxbibcites\\rtxbibcites{${parts.join('')}}\\fi` : '';
}

/** What a bibitem's text says (when the .bib has no such key): authors, title, venue, year, doi, url. */
export function bibitemFields(body: string): Record<string, string> {
  const parts = body.split(/\\newblock\s*/).map((p) => p.trim()).filter(Boolean);
  const f: Record<string, string> = {};
  const strip = (s: string) => s.replace(/\{\\em\s+/g, '{').replace(/\\(emph|textit|textbf)\{/g, '{').replace(/\.\s*$/, '').trim();
  if (parts[0]) {
    const a = strip(parts[0]).replace(/,?\s+and\s+/g, ' and ').split(/\s*,\s*|\s+and\s+/).filter(Boolean);
    f.author = a.join(' and ');
  }
  if (parts[1]) f.title = strip(parts[1]);
  const rest = parts.slice(2).join(' ');
  const venue = /\{\\em\s+([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(rest)?.[1];
  if (venue) f.journal = venue.trim();
  // not from a DOI or URL (10.1016/j.tcs.2009.10.009)
  const years = body.replace(/\\(href|url|path)\s*\{[^}]*\}|doi:\S+|https?:\S+/g, ' ').match(/\b(1[89]|20)\d\d\b/g);
  if (years) f.year = years[years.length - 1];
  const doi = /doi\.org\/([^\s}]+)|doi:\s*([^\s}]+)/i.exec(body);
  if (doi) f.doi = (doi[1] ?? doi[2]).replace(/[.}]+$/, '');
  const url = /\\url\s*\{([^}]+)\}/.exec(body)?.[1];
  if (url) f.url = url;
  return f;
}

