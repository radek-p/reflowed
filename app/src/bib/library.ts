// the document's bibliography as one list the References pane shows and
// bibtex.ts, which are unchanged):
//
//   biblatex  doc.bib.kind 'bbl' with \entry records (biber's .bbl): entries,
//             labels (labelalpha + extraalpha) from the .bbl; edits write .bbl
//             \entry records and keep the BibTeX alongside
//             in doc.bib.bibtex, so a .bib can be written back.
//   bibtex    doc.bib.kind 'bbl' holding a thebibliography (bibtex's .bbl,
//             e.g. LIPIcs + plainurl): entries from the \bibitem's, fields from
//             the .bib (doc.bib.bibtex or the .bib asset); edits keep every
//             untouched \bibitem as bibtex wrote it and write new ones in TS,
//             approximating plain/plainurl (numbers) or natbib's [Author(Year)].
//   bib       doc.bib.kind 'bib' (a .bib and no .bbl): entries from the .bib;
//             labels computed (alphabetic when the preamble loads biblatex).
//
//   readLibrary(bib, { preamble, bibtex? }) -> Library
//   applyChanges(bib, lib, { upsert, remove }, { preamble }) -> Doc['bib']
//   citeSignature(bib, keys) / bibSignature(bib): what a block's compile key
//     needs from the bibliography (so only blocks whose citations change recompile)
//   exportBibtex(lib) -> a .bib of every entry
//   bblEntryFields, formatBibtex, makeKey, cleanFetched, fold, searchLibrary
import { parseBbl, nameText, type Bbl, type BblEntry, type BblName } from './bbl.ts';
import { parseBibtex, parseNames, labelAlpha, toBblEntry, type BibtexEntry } from './bibtex.ts';
import { texToText } from '../refs/tex-text.ts';
import { bibitemFields as fieldsFromBibitem, bibitemsOf } from './bibitems.ts';
import { blankComments } from '../tex/lex.ts';
import { commandCalls, packageOptions } from '../tex/calls.ts';
import { foldText } from '../io/latex-text.ts';

export type { BibtexEntry };
export interface Person { family: string; given: string; prefix: string; suffix: string }
export interface LibEntry {
  key: string;
  type: string;                        // BibTeX type: article, inproceedings, misc…
  label: string;                       // as printed: "Bon+22a", "3", "Smith et al.(2020)"
  fields: Record<string, string>;      // BibTeX fields (TeX strings), lower-case names
  people: Person[];                    // authors, else editors (TeX strings)
  authors: string;                     // short, plain: "Bonnet et al.", "Doe and Gdańsk"
  authorsFull: string;                 // plain: every name
  authorsFamily: string;               // plain: every family name, "Doe, Roe and Poe" (the pane's rows)
  title: string; year: string; venue: string;
  doi: string; url: string; eprint: string;
  origin: 'bbl' | 'bibitem' | 'bib';
  hasBibtex: boolean;                  // the BibTeX the author wrote is known (not converted from the .bbl)
  search: string;                      // folded text for search
  index: number;                       // position in the bibliography
}
export interface Library {
  mode: 'biblatex' | 'bibtex' | 'none';
  style: string;                       // biblatex style= / \bibliographystyle
  natbib: boolean;
  entries: LibEntry[];
  byKey: Map<string, LibEntry>;
  bibtex: string;                      // the BibTeX text known (doc.bib.bibtex, the .bib)
}
export type DocBib = { kind: 'bbl' | 'bib' | 'none'; source: string; path?: string; entries?: { key: string; type: string }[]; bibtex?: string; bibtexPath?: string; origin?: { all: string; keys: Record<string, string> } };

// ── text helpers ─────────────────────────────────────────────────────────────

/** Accent- and case-insensitive text: "Gda\'{n}sk" and "Gdańsk" both -> "gdansk". */
export function fold(s: string): string {
  return foldText(texToText(s));
}
const plainText = (s: string) => texToText(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** fnv-1a, hex (signatures) */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const bblMemo = new Map<string, Bbl>();
function bblOf(text: string): Bbl {
  let b = bblMemo.get(text);
  if (!b) { b = parseBbl(text); bblMemo.set(text, b); if (bblMemo.size > 8) bblMemo.delete(bblMemo.keys().next().value!); }
  return b;
}
const isBiblatexBbl = (s: string) => /\\entry\{/.test(s) || /\\datalist/.test(s);
const isThebibliography = (s: string) => /\\begin\{thebibliography\}|\\bibitem/.test(s);

/** What the preamble asks for (its \usepackage, \bibliographystyle and \documentclass calls, read through tex/calls.ts). */
export function bibSetup(preamble: string): { engine: 'biblatex' | 'bibtex' | 'none'; style: string; natbib: boolean } {
  const p = preamble ?? '';
  const opts = packageOptions(p, 'biblatex');
  if (opts != null) {
    const style = /(?:^|,)\s*(?:style|citestyle)\s*=\s*([\w-]+)/.exec(blankComments(opts))?.[1] ?? 'numeric';
    return { engine: 'biblatex', style, natbib: false };
  }
  const bs = commandCalls(p, 'bibliographystyle', 1)[0]?.args[0];
  const natbib = packageOptions(p, 'natbib') != null;
  const lipics = commandCalls(p, 'documentclass', 1)[0]?.args[0].trim().startsWith('lipics') ?? false;
  if (bs || natbib || lipics) return { engine: 'bibtex', style: bs ?? 'plain', natbib };
  return { engine: 'none', style: '', natbib: false };
}

// ── people ───────────────────────────────────────────────────────────────────

const cleanGiven = (s: string) => s.replace(/\\bibnamedelim[a-z]\s*/g, ' ').replace(/\\bibinitperiod\s*/g, '.').replace(/\\bibinitdelim\s*/g, ' ')
  .replace(/\\bibinithyphendelim\s*/g, '.-').replace(/\s+/g, ' ').trim();
function personFromBbl(n: BblName): Person {
  return { family: cleanGiven(n.family), given: cleanGiven(n.given), prefix: cleanGiven(n.prefix), suffix: cleanGiven(n.suffix) };
}
/** "von Last, Jr, First" (BibTeX's full form) */
export function personBibtex(p: Person): string {
  const last = `${p.prefix ? `${p.prefix} ` : ''}${p.family}`;
  return p.given || p.suffix ? `${last}${p.suffix ? `, ${p.suffix}` : ''}, ${p.given}` : last;
}
const personPlain = (p: Person) => plainText([p.given, p.prefix, p.family, p.suffix].filter(Boolean).join(' '));
const familyPlain = (p: Person) => plainText(`${p.prefix ? `${p.prefix} ` : ''}${p.family}`);
/** every family name: "Doe", "Doe and Roe", "Doe, Roe and Poe" */
function familyList(ps: Person[]): string {
  const f = ps.map(familyPlain);
  return f.length > 1 ? `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}` : f.join('');
}
function shortAuthors(ps: Person[]): string {
  if (!ps.length) return '';
  if (ps.length === 1) return familyPlain(ps[0]);
  if (ps.length === 2) return `${familyPlain(ps[0])} and ${familyPlain(ps[1])}`;
  return `${familyPlain(ps[0])} et al.`;
}
function peopleOf(fields: Record<string, string>): Person[] {
  const src = fields.author || fields.editor || '';
  return src ? parseNames(src).map((n) => ({ family: n.family, given: n.given, prefix: n.prefix, suffix: n.suffix })) : [];
}

// ── .bbl (biblatex) entry -> BibTeX fields ───────────────────────────────────

const BBL_SKIP = new Set(['labelalpha', 'sortinit', 'sortinithash', 'extraalpha', 'labelnamesource', 'labeltitlesource', 'labeldatesource',
  'extradate', 'labelyear', 'labelmonth', 'labelday', 'datelabelsource', 'singletitle', 'uniquetitle', 'uniquework', 'uniqueprimaryauthor',
  'abstract', 'file', 'urlraw', 'labelprefix', 'extraname', 'sortinit', 'clonesourcekey', 'crossrefsource', 'xrefsource', 'pages@range']);
const BBL_TO_BIB: Record<string, string> = { journaltitle: 'journal', location: 'address', eprinttype: 'archiveprefix', eprintclass: 'primaryclass' };
const BBL_TYPE: Record<string, string> = { online: 'misc', report: 'techreport', thesis: 'phdthesis', mvbook: 'book', bookinbook: 'inbook', collection: 'book', mvcollection: 'book', incollection: 'incollection' };

export function bblEntryFields(e: BblEntry): { type: string; fields: Record<string, string> } {
  const f: Record<string, string> = {};
  for (const role of ['author', 'editor']) {
    const ns = e.names[role];
    if (ns?.length) f[role] = ns.map((n) => personBibtex(personFromBbl(n))).join(' and ');
  }
  for (const [k, v] of Object.entries(e.lists)) f[BBL_TO_BIB[k] ?? k] = v.join(' and ');
  for (const [k0, v] of Object.entries(e.fields)) {
    if (BBL_SKIP.has(k0)) continue;
    const k = BBL_TO_BIB[k0] ?? k0;
    f[k] = k === 'pages' ? v.replace(/\s*\\bibrangedash\s*/g, '--') : v;
  }
  for (const [k, v] of Object.entries(e.verbs)) if (k !== 'urlraw') f[k] = v;
  if (!f.year && f.date) { const y = /\d{4}/.exec(f.date)?.[0]; if (y) f.year = y; }
  let type = BBL_TYPE[e.type] ?? e.type;
  if (e.type === 'thesis' && /master/i.test(f.type ?? '')) { type = 'mastersthesis'; delete f.type; }
  else if (e.type === 'thesis') { if (/phd/i.test(f.type ?? '')) delete f.type; }
  if (type === 'phdthesis' || type === 'mastersthesis') { if (f.institution && !f.school) { f.school = f.institution; delete f.institution; } }
  return { type, fields: f };
}

// ── BibTeX text ──────────────────────────────────────────────────────────────

const FIELD_ORDER = ['author', 'editor', 'title', 'booktitle', 'journal', 'series', 'volume', 'number', 'pages', 'chapter', 'edition',
  'publisher', 'organization', 'institution', 'school', 'address', 'year', 'month', 'note', 'doi', 'url', 'eprint', 'archiveprefix', 'primaryclass'];
const FIELD_CASE: Record<string, string> = { archiveprefix: 'archivePrefix', primaryclass: 'primaryClass' };
/** One entry as BibTeX (fields in the usual order, values braced). */
export function formatBibtex(e: { type: string; key: string; fields: Record<string, string> }): string {
  const names = Object.keys(e.fields).filter((k) => e.fields[k] !== '' && e.fields[k] != null);
  names.sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a), ib = FIELD_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const w = Math.max(0, ...names.map((k) => (FIELD_CASE[k] ?? k).length));
  const body = names.map((k) => `  ${(FIELD_CASE[k] ?? k).padEnd(w)} = {${e.fields[k]}}`).join(',\n');
  return `@${e.type}{${e.key},\n${body}\n}`;
}

/** The entries of a .bib text with each one's own text (to keep untouched entries verbatim). */
function bibtexSegments(text: string): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  const at = /@\s*([a-zA-Z]+)\s*([{(])\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = at.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    const open = m.index + m[0].indexOf(m[2]);
    const close = m[2] === '(' ? ')' : '}';
    let d = 0, j = open;
    for (; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (text[j] === m[2]) d++;
      else if (text[j] === close && --d === 0) break;
    }
    out.set(m[3], { start: m.index, end: Math.min(text.length, j + 1) });
    at.lastIndex = j + 1;
  }
  return out;
}
/** Replace / add / remove entries of a .bib text by key; untouched text stays as it is. */
export function editBibtexText(text: string, upsert: BibtexEntry[], remove: string[]): string {
  let t = text ?? '';
  const drop = new Set([...remove, ...upsert.map((e) => e.key)]);
  const segs = [...bibtexSegments(t)].filter(([k]) => drop.has(k)).sort((a, b) => b[1].start - a[1].start);
  const replaced = new Map<string, number>();
  for (const [k, s] of segs) {
    let end = s.end;
    if (!upsert.some((e) => e.key === k)) while (t[end] === '\n' && t[end + 1] === '\n') end++;   // a removed entry takes one blank line with it
    t = t.slice(0, s.start) + `\u0000${k}\u0000` + t.slice(end);
    replaced.set(k, s.start);
  }
  for (const e of upsert) {
    const mark = `\u0000${e.key}\u0000`;
    if (t.includes(mark)) t = t.replace(mark, formatBibtex(e));
    else t = `${t.replace(/\s*$/, '')}${t.trim() ? '\n\n' : ''}${formatBibtex(e)}\n`;
  }
  return t.replace(/\u0000[^\u0000]*\u0000\n?/g, '');
}

// ── reading ──────────────────────────────────────────────────────────────────

function entryFrom(key: string, type: string, label: string, fields: Record<string, string>, origin: LibEntry['origin'], hasBibtex: boolean, index: number): LibEntry {
  const people = peopleOf(fields);
  const venue = plainText(fields.journal || fields.journaltitle || fields.booktitle || fields.howpublished || fields.publisher || fields.school || fields.institution || fields.organization
    || (fields.archiveprefix && fields.eprint ? `${fields.archiveprefix}:${fields.eprint}` : '') || '');
  const e: LibEntry = {
    key, type, label, fields, people,
    authors: shortAuthors(people), authorsFull: people.map(personPlain).join(', '), authorsFamily: familyList(people),
    title: plainText(fields.title ?? ''), year: plainText(fields.year ?? (/\d{4}/.exec(fields.date ?? '')?.[0] ?? '')), venue,
    doi: (fields.doi ?? '').trim(), url: (fields.url ?? '').trim(), eprint: (fields.eprint ?? '').trim(),
    origin, hasBibtex, search: '', index,
  };
  e.search = fold(`${key} ${label} ${e.authorsFull} ${e.title} ${e.year} ${e.venue} ${e.doi}`);
  return e;
}

/** \bibitem[label]{key} text … of a thebibliography, in order. */
export function parseBibitems(text: string): { key: string; opt: string | null; body: string; start: number; end: number }[] {
  const out: { key: string; opt: string | null; body: string; start: number; end: number }[] = [];
  const s = blankComments(text);
  const re = /\\bibitem\s*(\[((?:[^\[\]]|\[[^\]]*\])*)\])?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  const hits: { key: string; opt: string | null; start: number; bodyStart: number }[] = [];
  while ((m = re.exec(s))) hits.push({ key: m[3].trim(), opt: m[1] ? m[2] : null, start: m.index, bodyStart: re.lastIndex });
  const endAll = (() => { const i = s.search(/\\end\{thebibliography\}/); return i < 0 ? s.length : i; })();
  hits.forEach((h, i) => {
    let end = i + 1 < hits.length ? hits[i + 1].start : endAll;
    out.push({ key: h.key, opt: h.opt, body: text.slice(h.bodyStart, end).trim(), start: h.start, end });
  });
  return out;
}

export function readLibrary(bib: DocBib | null | undefined, o: { preamble?: string; bibtex?: string | null } = {}): Library {
  const setup = bibSetup(o.preamble ?? '');
  const bibtexText = o.bibtex ?? bib?.bibtex ?? (bib?.kind === 'bib' ? bib.source : '') ?? '';
  const bt = new Map(parseBibtex(bibtexText || '').entries.map((e) => [e.key, e]));
  const entries: LibEntry[] = [];
  let mode: Library['mode'] = setup.engine === 'none' ? 'none' : setup.engine;
  const src = bib?.source ?? '';
  if (bib?.kind === 'bbl' && isBiblatexBbl(src)) {
    mode = 'biblatex';
    bblOf(src).entries.forEach((e, i) => {
      const own = bt.get(e.key);
      const conv = bblEntryFields(e);
      // numeric styles: biblatex numbers the list when it typesets (labelnumber); the list order is the number
      const label = e.label || (/^(numeric|ieee|nature|science|phys|chem|trad)/.test(setup.style) ? String(i + 1) : '');
      entries.push(entryFrom(e.key, own?.type ?? conv.type, label, own ? { ...own.fields } : conv.fields, 'bbl', !!own, i));
    });
  } else if (bib?.kind === 'bbl' && isThebibliography(src)) {
    mode = 'bibtex';
    const numbers = bibitemsOf([src]);
    parseBibitems(src).forEach((it, i) => {
      const own = bt.get(it.key);
      const label = it.opt != null ? plainText(it.opt) : (numbers.get(it.key)?.label ?? String(i + 1));   // the number LaTeX gives it
      entries.push(entryFrom(it.key, own?.type ?? 'misc', label, own ? { ...own.fields } : fieldsFromBibitem(it.body), 'bibitem', !!own, i));
    });
  } else if (bib?.kind === 'bib' || bibtexText) {
    const list = parseBibtex(bibtexText).entries;
    if (setup.engine === 'biblatex') {
      // the labels biblatex would print: through the same .bbl writer the edits use
      const bbl = bblOf(upsertBiblatex(null, list));
      bbl.entries.forEach((e, i) => { const own = bt.get(e.key)!; entries.push(entryFrom(e.key, own.type, e.label, { ...own.fields }, 'bib', true, i)); });
    } else {
      sortBibtexStyle(list).forEach((e, i) => entries.push(entryFrom(e.key, e.type, setup.natbib ? natbibLabel(e.fields) : String(i + 1), { ...e.fields }, 'bib', true, i)));
    }
  }
  return { mode, style: setup.style, natbib: setup.natbib || (mode === 'bibtex' && parseBibitems(src).some((x) => x.opt && /\(\d{4}[a-z]?\)/.test(x.opt))), entries, byKey: new Map(entries.map((e) => [e.key, e])), bibtex: bibtexText };
}

// ── searching ────────────────────────────────────────────────────────────────

/** Every word of the query in the entry (key, label, authors, title, year, venue), accents and case ignored; best first. */
export function searchLibrary(entries: LibEntry[], q: string): LibEntry[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return entries.slice();
  const scored: [number, LibEntry][] = [];
  for (const e of entries) {
    if (!words.every((w) => e.search.includes(w))) continue;
    let s = 0;
    const k = e.key.toLowerCase(), l = e.label.toLowerCase();
    for (const w of words) {
      if (k.startsWith(w) || l.startsWith(w)) s += 4;
      if (e.people.some((p) => fold(p.family).startsWith(w))) s += 3;
      if (new RegExp(`\\b${esc(w)}`).test(e.search)) s += 1;
    }
    scored.push([s, e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].index - b[1].index).map(([, e]) => e);
}

// ── writing: biblatex .bbl ───────────────────────────────────────────────────

const EMPTY_BBL = `% $ biblatex auxiliary file $
% $ biblatex bbl format version 3.2 $
% Do not modify the above lines!
%
% This is an auxiliary file used by the 'biblatex' package.
% This file may safely be deleted. It will be recreated by
% biber as required.
%
\\begingroup
\\makeatletter
\\@ifundefined{ver@biblatex.sty}
  {\\@latex@error
     {Missing 'biblatex' package}
     {The bibliography requires the 'biblatex' package.}
      \\aftergroup\\endinput}
  {}
\\endgroup


\\refsection{0}
  \\datalist[entry]{anyt/global//global/global}
  \\enddatalist
\\endrefsection
\\endinput
`;

/** biblatex field names for a BibTeX entry (toBblEntry maps journal/address/school itself). */
function forBiblatex(e: BibtexEntry): BibtexEntry {
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fields)) {
    if (k === 'archiveprefix') f.eprinttype = v.toLowerCase() === 'arxiv' ? 'arxiv' : v;
    else if (k === 'primaryclass') f.eprintclass = v;
    else f[k] = v;
  }
  return { ...e, fields: f };
}
function sortTuple(la: string, names: string, year: string, title: string): string {
  return [la, names, year, title].map((x) => fold(x)).join('\u0001');
}
function tupleOfBbl(e: BblEntry): string {
  const ns = (e.names.author ?? e.names.editor ?? []).map((n) => `${n.family} ${n.given}`).join(' ');
  return sortTuple(e.fields.labelalpha ?? '', ns, e.fields.year ?? e.fields.date ?? '', e.fields.title ?? '');
}
function tupleOfBibtex(e: BibtexEntry, la: string): string {
  const ns = peopleOf(e.fields).map((p) => `${p.family} ${p.given}`).join(' ');
  return sortTuple(la, ns, e.fields.year ?? e.fields.date ?? '', e.fields.title ?? '');
}
function cut(text: string, e: { start: number; end: number }): string {
  const lineStart = text.lastIndexOf('\n', e.start) + 1;
  return text.slice(0, lineStart) + text.slice(e.end).replace(/^[^\n]*\n/, '');
}

/** extraalpha as biblatex would give it: in each group of entries with the
 *  same labelalpha (more than one), 1, 2, … in list order; none for a lone one. */
export function relabelAlpha(text: string): string {
  const bbl = parseBbl(text);
  const groups = new Map<string, BblEntry[]>();
  for (const e of bbl.entries) {
    const la = e.fields.labelalpha;
    if (!la) continue;
    if (!groups.has(la)) groups.set(la, []);
    groups.get(la)!.push(e);
  }
  const edits: { e: BblEntry; n: number }[] = [];
  for (const g of groups.values()) g.forEach((e, i) => {
    const want = g.length > 1 ? i + 1 : 0;
    if (Number(e.fields.extraalpha ?? 0) !== want) edits.push({ e, n: want });
  });
  edits.sort((a, b) => b.e.start - a.e.start);
  for (const { e, n } of edits) {
    let seg = text.slice(e.start, e.end);
    if (/\\field\{extraalpha\}\{[^}]*\}/.test(seg)) seg = n ? seg.replace(/\\field\{extraalpha\}\{[^}]*\}/, `\\field{extraalpha}{${n}}`) : seg.replace(/[ \t]*\\field\{extraalpha\}\{[^}]*\}[ \t]*\n/, '');
    else if (n) seg = seg.replace(/([ \t]*)(\\field\{labelalpha\}\{[^\n]*\}\n)/, `$1$2$1\\field{extraalpha}{${n}}\n`);
    text = text.slice(0, e.start) + seg + text.slice(e.end);
  }
  return text;
}

/** Add or replace BibTeX entries in a biblatex .bbl (null: a new one); remove keys. */
export function upsertBiblatex(bblText: string | null, upsert: BibtexEntry[], remove: string[] = []): string {
  let text = bblText && /\\datalist/.test(bblText) ? bblText : EMPTY_BBL;
  for (const k of remove) { const e = parseBbl(text).byKey.get(k); if (e) text = cut(text, e); }
  for (const e0 of upsert) {
    const e = forBiblatex(e0);
    const names = e.fields.author ? parseNames(e.fields.author) : e.fields.editor ? parseNames(e.fields.editor) : [];
    const la = labelAlpha(names, e.fields.year ?? e.fields.date ?? '');
    const bbl = parseBbl(text);
    const old = bbl.byKey.get(e.key);
    const mine = tupleOfBibtex(e, la);
    if (old && tupleOfBbl(old) === mine) {                   // same place in the list: in place, the letter kept
      const seg = toBblEntry(e, la, Number(old.fields.extraalpha ?? 0));
      const lineStart = text.lastIndexOf('\n', old.start) + 1;
      const lineEnd = text.indexOf('\n', old.end);
      text = text.slice(0, lineStart) + seg + text.slice(lineEnd < 0 ? text.length : lineEnd);
      continue;
    }
    if (old) text = cut(text, old);
    const now = parseBbl(text);
    const next = now.entries.find((x) => tupleOfBbl(x) > mine);
    const at = next ? text.lastIndexOf('\n', next.start) + 1 : text.indexOf('  \\enddatalist');
    text = text.slice(0, at) + toBblEntry(e, la, 0) + '\n' + text.slice(at);
  }
  return relabelAlpha(text);
}

// ── writing: bibtex's thebibliography ────────────────────────────────────────

const t = (s: string | undefined) => (s ?? '').trim();
/** plain.bst's name list: "A. B, C, and D" with full given names (as plainurl). */
function plainNames(ps: Person[]): string {
  const one = (p: Person) => [p.given, p.prefix, p.family].filter(Boolean).join(' ') + (p.suffix ? `, ${p.suffix}` : '');
  if (ps.length <= 1) return ps.map(one).join('');
  if (ps.length === 2) return `${one(ps[0])} and ${one(ps[1])}`;
  return `${ps.slice(0, -1).map(one).join(', ')}, and ${one(ps[ps.length - 1])}`;
}
const dashes = (p: string) => p.replace(/\s*[-–]+\s*/g, '--');
/** One \bibitem as plain/plainurl would write it (approximately). */
export function formatBibitem(e: BibtexEntry, o: { natbib?: boolean; url?: boolean; label?: string } = {}): string {
  const f = e.fields;
  const L: string[] = [];
  const opt = o.natbib ? `[${o.label ?? natbibLabel(f)}]` : o.label ? `[${o.label}]` : '';
  L.push(`\\bibitem${opt}{${e.key}}`);
  const people = peopleOf(f);
  const eds = f.editor ? parseNames(f.editor) : [];
  if (f.author && people.length) L.push(`${plainNames(people)}.`);
  else if (eds.length) L.push(`${plainNames(eds)}, editor${eds.length > 1 ? 's' : ''}.`);
  if (t(f.title)) L.push(`\\newblock ${t(f.title).replace(/[.]$/, '')}.`);
  const vol = [t(f.volume) && `${t(f.volume)}${t(f.number) ? `(${t(f.number)})` : ''}`, t(f.pages) && dashes(t(f.pages))].filter(Boolean);
  const year = t(f.year);
  const type = e.type;
  if (type === 'article' && t(f.journal)) {
    L.push(`\\newblock {\\em ${t(f.journal)}}${t(f.volume) ? `, ${t(f.volume)}${t(f.number) ? `(${t(f.number)})` : ''}${t(f.pages) ? `:${dashes(t(f.pages))}` : ''}` : t(f.pages) ? `, pages ${dashes(t(f.pages))}` : ''}${year ? `, ${year}` : ''}.`);
  } else if ((type === 'inproceedings' || type === 'incollection' || type === 'conference') && t(f.booktitle)) {
    const parts = [`In {\\em ${t(f.booktitle)}}`];
    if (t(f.volume) && t(f.series)) parts.push(`volume ${t(f.volume)} of {\\em ${t(f.series)}}`);
    if (t(f.pages)) parts.push(`pages ${dashes(t(f.pages))}`);
    if (t(f.address)) parts.push(t(f.address));
    if (year) parts.push(year);
    L.push(`\\newblock ${parts.join(', ')}.${t(f.publisher) ? `\n\\newblock ${t(f.publisher)}.` : ''}`);
  } else {
    const parts = [t(f.howpublished), t(f.journal) && `{\\em ${t(f.journal)}}`, t(f.booktitle) && `{\\em ${t(f.booktitle)}}`, t(f.school) || t(f.institution), t(f.publisher),
      t(f.archiveprefix) && t(f.eprint) ? `${/arxiv/i.test(f.archiveprefix) ? 'arXiv' : t(f.archiveprefix)}:${t(f.eprint)}` : '', vol.length && !t(f.journal) ? vol.join(', ') : '', t(f.address), year].filter(Boolean);
    if (parts.length) L.push(`\\newblock ${parts.join(', ')}.`);
  }
  if (t(f.note)) L.push(`\\newblock ${t(f.note).replace(/[.]$/, '')}.`);
  if (o.url !== false) {
    if (t(f.doi)) L.push(`\\newblock \\href {https://doi.org/${t(f.doi)}}\n  {\\path{doi:${t(f.doi)}}}.`);
    else if (t(f.url)) L.push(`\\newblock URL: \\url{${t(f.url)}}.`);
  }
  return L.join('\n');
}
/** natbib's [Author(Year)] label (plainnat-like). */
export function natbibLabel(f: Record<string, string>): string {
  const ps = peopleOf(f);
  const fam = (p: Person) => plainTextKeepTeX(`${p.prefix ? `${p.prefix} ` : ''}${p.family}`);
  const who = ps.length === 0 ? '' : ps.length === 1 ? fam(ps[0]) : ps.length === 2 ? `${fam(ps[0])} and ${fam(ps[1])}` : `${fam(ps[0])} et~al.`;
  return `${who}(${t(f.year)})`;
}
const plainTextKeepTeX = (s: string) => s.replace(/\s+/g, ' ').trim();
/** plain.bst's order: names (family, given), year, title. */
function bibtexSortKey(f: Record<string, string>): string {
  const ps = peopleOf(f);
  return [ps.map((p) => `${p.prefix} ${p.family} ${p.given}`).join(' '), t(f.year), t(f.title)].map(fold).join('\u0001');
}
function sortBibtexStyle(list: BibtexEntry[]): BibtexEntry[] {
  return list.slice().sort((a, b) => (bibtexSortKey(a.fields) < bibtexSortKey(b.fields) ? -1 : bibtexSortKey(a.fields) > bibtexSortKey(b.fields) ? 1 : 0));
}
const EMPTY_THEBIB = '\\begin{thebibliography}{1}\n\n\\end{thebibliography}\n';
/** Add or replace entries in a thebibliography (each new \bibitem at plain's sorted place), remove keys. */
export function upsertThebibliography(text: string | null, upsert: BibtexEntry[], remove: string[], o: { fieldsOf: (key: string) => Record<string, string> | null; natbib?: boolean; unsorted?: boolean }): string {
  let s = text && /\\begin\{thebibliography\}/.test(text) ? text : EMPTY_THEBIB;
  const drop = new Set([...remove, ...upsert.map((e) => e.key)]);
  const items = () => parseBibitems(s);
  for (const it of items().filter((x) => drop.has(x.key)).sort((a, b) => b.start - a.start)) s = s.slice(0, it.start) + s.slice(it.end);
  for (const e of upsert) {
    const mine = bibtexSortKey(e.fields);
    const list = items();
    const next = o.unsorted ? null : list.find((x) => { const f = o.fieldsOf(x.key) ?? fieldsFromBibitem(x.body); return bibtexSortKey(f) > mine; });
    const at = next ? next.start : (() => { const i = s.search(/\\end\{thebibliography\}/); return i < 0 ? s.length : i; })();
    s = `${s.slice(0, at)}${formatBibitem(e, { natbib: o.natbib })}\n\n${s.slice(at)}`;
  }
  const n = items().length;
  s = s.replace(/\\begin\{thebibliography\}\{[^}]*\}/, `\\begin{thebibliography}{${n >= 100 ? '100' : n >= 10 ? '10' : '1'}}`);
  return s.replace(/\n{3,}/g, '\n\n');
}

// ── changes ──────────────────────────────────────────────────────────────────

export interface Changes { upsert?: BibtexEntry[]; remove?: string[] }
/** The document's bibliography after the changes (every kind: see the header). */
export function applyChanges(bib: DocBib | null | undefined, lib: Library, ch: Changes, o: { preamble?: string } = {}): DocBib {
  const upsert = ch.upsert ?? [], remove = ch.remove ?? [];
  const base: DocBib & { origin?: unknown } = bib ? { ...bib } : { kind: 'none', source: '' };
  base.origin ??= bibOrigin(bib);                  // the first change: what it was before (compile keys, citeSignature)
  // the BibTeX alongside: every entry the author wrote (or the pane converted when it was edited)
  const bibtex = editBibtexText(lib.bibtex, upsert, remove);
  const setup = bibSetup(o.preamble ?? '');
  let out: DocBib;
  if (lib.mode === 'biblatex' || (lib.mode === 'none' && setup.engine === 'biblatex')) {
    let source: string;
    if (base.kind === 'bbl' && isBiblatexBbl(base.source)) source = upsertBiblatex(base.source, upsert, remove);
    else source = upsertBiblatex(null, parseBibtex(bibtex).entries);                    // from a .bib: the whole .bbl
    out = { ...base, kind: 'bbl', source, bibtex };
    if (bib?.kind === 'bib') { out.bibtexPath = bib.path; delete out.path; }
  } else if (lib.mode === 'bibtex' || base.kind === 'bbl') {
    const known = new Map(parseBibtex(bibtex).entries.map((e) => [e.key, e.fields]));
    const source = upsertThebibliography(base.kind === 'bbl' ? base.source : null, upsert, remove, { fieldsOf: (k) => known.get(k) ?? null, natbib: lib.natbib, unsorted: /^unsrt/.test(lib.style) });
    out = { ...base, kind: 'bbl', source, bibtex };
    if (bib?.kind === 'bib') { out.bibtexPath = bib.path; delete out.path; }
  } else {
    out = { ...base, kind: 'bib', source: bibtex };
    delete out.bibtex;
  }
  out.entries = out.kind === 'bbl'
    ? (isBiblatexBbl(out.source) ? parseBbl(out.source).entries.map((e) => ({ key: e.key, type: e.type })) : parseBibitems(out.source).map((x) => ({ key: x.key, type: 'bibitem' })))
    : parseBibtex(out.source).entries.map((e) => ({ key: e.key, type: e.type }));
  return out;
}

/** An entry as BibTeX (its own, or converted from the .bbl / \bibitem). */
export function entryBibtex(e: LibEntry): BibtexEntry { return { type: e.type, key: e.key, fields: { ...e.fields } }; }
/** Every entry as one .bib (the BibTeX the author wrote where known, converted otherwise). */
export function exportBibtex(lib: Library): string {
  const own = bibtexSegments(lib.bibtex);
  const parts = lib.entries.map((e) => {
    const s = e.hasBibtex ? own.get(e.key) : null;
    return s ? lib.bibtex.slice(s.start, s.end).trim() : formatBibtex(entryBibtex(e));
  });
  return `% ${lib.entries.length} entries, written by Reflow TeX\n\n${parts.join('\n\n')}\n`;
}

// ── compile keys ─────────────────────────────────────────────────────────────

/** Each key's record as a hash: its .bbl \entry, or its \bibitem with its number (or the whole .bib). */
function recordOf(bib: DocBib, k: string): string {
  const src = bib.source ?? '';
  if (bib.kind === 'bbl' && isBiblatexBbl(src)) { const e = bblOf(src).byKey.get(k); return e ? fnv(src.slice(e.start, e.end)) : '?'; }
  if (bib.kind === 'bbl') return itemsMemo(src).get(k) ?? '?';
  return new Set(parseBibtex(src).entries.map((e) => e.key)).has(k) ? fnv(src) : '?';
}
/** What the bibliography was before the pane first changed it (kept in doc.bib.origin):
 *  the whole one's hash and every record's, so unchanged records add nothing to compile keys. */
export function bibOrigin(bib: DocBib | null | undefined): { all: string; keys: Record<string, string> } {
  const keys: Record<string, string> = {};
  if (bib && bib.kind !== 'none') {
    const src = bib.source ?? '';
    const list = bib.kind === 'bbl' ? (isBiblatexBbl(src) ? bblOf(src).entries.map((e) => e.key) : parseBibitems(src).map((x) => x.key)) : parseBibtex(src).entries.map((e) => e.key);
    for (const k of list) keys[k] = recordOf(bib, k);
  }
  return { all: wholeHash(bib), keys };
}
const wholeHash = (bib: DocBib | null | undefined) => (bib && bib.kind !== 'none' ? fnv(`${bib.kind}\u0000${bib.source ?? ''}`) : '');

/** A block's share of the bibliography: the cited keys whose record differs
 *  from doc.bib.origin (what the document had before the pane changed it).
 *  '' while nothing it cites changed, so compile keys (and seed cache)
 *  stay as they were; else changes exactly when what its \cite's print can change. */
export function citeSignature(bib: (DocBib & { origin?: { all: string; keys: Record<string, string> } }) | null | undefined, keys: string[]): string {
  if (!keys.length || !bib?.origin) return '';
  const parts: string[] = [];
  for (const k of new Set(keys)) { const r = bib.kind === 'none' ? '?' : recordOf(bib, k); if (r !== (bib.origin.keys[k] ?? '?')) parts.push(`${k}=${r}`); }
  return parts.length ? fnv(parts.sort().join(',')) : '';
}
const itemsCache = new Map<string, Map<string, string>>();
function itemsMemo(src: string): Map<string, string> {
  let m = itemsCache.get(src);
  if (!m) {
    m = new Map(parseBibitems(src).map((x, i) => [x.key, `${i + 1}:${fnv(`${x.opt ?? ''}\u0000${x.body}`)}`]));
    itemsCache.set(src, m);
    if (itemsCache.size > 8) itemsCache.delete(itemsCache.keys().next().value!);
  }
  return m;
}
/** The whole bibliography's (the block that prints it): '' while it is the original. */
export const bibSignature = (bib: (DocBib & { origin?: { all: string } }) | null | undefined): string => {
  if (!bib?.origin) return '';
  const h = wholeHash(bib);
  return h === bib.origin.all ? '' : h;
};

// ── keys, fetched records ────────────────────────────────────────────────────

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'with', 'from', 'by', 'at', 'is', 'are', 'towards', 'via']);
/** "doe2026flips": first author's family name, year, first real word of the title; a, b, … when taken. */
export function makeKey(fields: Record<string, string>, taken: (k: string) => boolean): string {
  const p = peopleOf(fields)[0];
  const fam = p ? fold(p.family).replace(/[^a-z]/g, '') : 'anon';
  const year = /\d{4}/.exec(fields.year ?? fields.date ?? '')?.[0] ?? '';
  const word = fold(fields.title ?? '').replace(/(\w)-(\w)/g, '$1$2').split(/[^a-z0-9]+/).find((w) => w && !STOP.has(w)) ?? '';
  const base = `${fam}${year}${word}` || 'ref';
  if (!taken(base)) return base;
  for (let i = 0; i < 26 * 27; i++) {
    const s = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(96 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    if (!taken(base + s)) return base + s;
  }
  return `${base}${Date.now()}`;
}

const FETCH_DROP = new Set(['keywords', 'copyright', 'abstract', 'issn', 'isbn', 'language', 'file', 'urldate', 'note_']);
/** A record from doi.org / DataCite as a tidy entry: our key, no keyword/copyright noise, "--" in pages, arXiv as eprint. */
export function cleanFetched(bibtex: string, taken: (k: string) => boolean): BibtexEntry | null {
  const e = parseBibtex(bibtex).entries[0];
  if (!e) return null;
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fields)) if (!FETCH_DROP.has(k) && v) f[k] = v;
  if (f.pages) f.pages = dashes(f.pages);
  if (f.month && /^[a-z]+$/i.test(f.month)) f.month = f.month.slice(0, 3).toLowerCase();
  const arxiv = /arxiv\.(\d{4}\.\d{4,5})/i.exec(f.doi ?? '')?.[1] ?? /arxiv\.org\/abs\/([^\s}v]+)/i.exec(f.url ?? '')?.[1];
  if (arxiv) {
    f.eprint = arxiv; f.archiveprefix = 'arXiv';
    if (f.doi) f.doi = f.doi.replace(/^10\.48550\/ARXIV\./i, '10.48550/arXiv.');
    if (/^arxiv$/i.test(f.publisher ?? '')) delete f.publisher;
  }
  if (f.url && f.doi && /doi\.org\//.test(f.url)) delete f.url;
  const type = e.type === 'misc' && f.journal ? 'article' : e.type;
  return { type, key: makeKey(f, taken), fields: f };
}

/** "10.1145/…", "https://doi.org/10.…", "doi:10.…" -> DOI; "2602.12926", "arXiv:2602.12926v2", arxiv.org/abs/… -> arXiv id. */
export function parseIdentifier(s: string): { kind: 'doi' | 'arxiv'; id: string } | null {
  const x = s.trim();
  const doi = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)/i.exec(x);
  if (doi && !/arxiv\.org/i.test(x)) return { kind: 'doi', id: doi[1].replace(/[.,;]+$/, '') };
  const ax = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?(\d{4}\.\d{4,5})(v\d+)?/i.exec(x) ?? /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i.exec(x);
  if (ax) return { kind: 'arxiv', id: ax[1] };
  return null;
}
