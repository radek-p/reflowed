// Title, authors, abstract and class from a preamble (+ the body's abstract
// block); bibliography entry keys from a .bbl or .bib. Heuristics for the
// document list and search, never used to typeset.

import { commandArg, dropCommand, stripComments, texAccents, texToPlain } from './latex-text.ts';
import type { BibEntryRef } from '../store/types.ts';

export function docClass(preamble: string): { class: string; classOptions?: string } {
  const m = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/.exec(stripComments(preamble));
  if (!m) return { class: 'article' };
  const out: { class: string; classOptions?: string } = { class: m[2].trim() };
  if (m[1] !== undefined) out.classOptions = m[1].replace(/\s+/g, ' ').trim();
  return out;
}

export function titleOf(preamble: string, body = ''): string {
  const src = stripComments(preamble + '\n' + body);
  const a = commandArg(src, 'title');
  if (!a) return '';
  return texToPlain(dropCommand(a.arg, 'thanks'));
}

const AFFIL = /\b(universit|institut|department|dept\.|school|college|laborator|faculty|academy|centre|center|inria|cnrs|google|microsoft|research|gmbh|inc\.|ltd|@)/i;

/** Author names: \author{A, B \and C}, several \author{…} (amsart, lipics), authblk's \author[1]{…}. */
export function authorsOf(preamble: string, body = ''): string[] {
  const src = stripComments(preamble + '\n' + body);
  const names: string[] = [];
  const re = /\\author\s*(\[[^\]]*\])?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const a = commandArg(src.slice(m.index), 'author');
    if (!a) break;
    re.lastIndex = m.index + a.end;
    let s = a.arg;
    for (const c of ['thanks', 'footnote', 'email', 'affil', 'address', 'orcid', 'inst', 'footnotemark', 'institute']) s = dropCommand(s, c);
    s = s.replace(/\\(and|AND)\b/g, '\n').replace(/\\\\(\s*\[[^\]]*\])?/g, '\n').replace(/\\newline\b/g, '\n');
    for (let line of s.split('\n')) {
      line = texToPlain(line);
      if (!line || AFFIL.test(line)) continue;
      for (let n of line.split(/,|\band\b|;/)) {
        n = n.replace(/[\d*†‡§¶]+$/g, '').trim();
        if (n && /\p{L}/u.test(n) && n.split(/\s+/).length <= 5) names.push(n);
      }
    }
  }
  return [...new Set(names)];
}

export function abstractOf(source: string): string {
  const s = stripComments(source);
  const m = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(s);
  if (m) return texToPlain(m[1]);
  const a = commandArg(s, 'abstract');
  return a ? texToPlain(a.arg) : '';
}

export function bblEntries(bbl: string): BibEntryRef[] {
  const out: BibEntryRef[] = [];
  // biblatex: \entry{key}{type}{…}; bibtex: \bibitem[label]{key}
  for (const m of bbl.matchAll(/\\entry\{([^}]+)\}\{([^}]+)\}/g)) out.push({ key: m[1], type: m[2] });
  if (!out.length) for (const m of bbl.matchAll(/\\bibitem\s*(?:\[(?:[^\[\]]|\[[^\]]*\])*\])?\s*\{([^}]+)\}/g)) out.push({ key: m[1].trim(), type: 'bibitem' });
  return out;
}

export function bibEntries(bib: string): BibEntryRef[] {
  const out: BibEntryRef[] = [];
  for (const m of bib.matchAll(/@\s*(\w+)\s*[{(]\s*([^,\s]+)\s*,/g)) {
    const t = m[1].toLowerCase();
    if (t !== 'comment' && t !== 'string' && t !== 'preamble') out.push({ key: m[2], type: t });
  }
  return out;
}

export { texAccents };
