// R4: paste BibTeX -> .bbl entries, in TypeScript (no biber in the browser).
//
//   parseBibtex(text) -> { entries: [{ type, key, fields }], errors }
//   addBibtex(bbl, bibtex) -> { bbl, added, replaced, errors }
//     every entry of the BibTeX written as a biblatex \entry (bbl format 3.2,
//     as biber would for style=alphabetic) and put into the .bbl's datalist
//     at its sorted place (by label, then key); an entry with a key the .bbl
//     already has replaces it. labelalpha as biblatex's alphabetic style
//     makes it (1 name: 3 letters of the family name; 2–3: initials; more:
//     3 letters and "+"; then the year's last two digits), extraalpha when the
//     label is taken (a, b, … in the order entries sort).
//
// What biber does and this does not: name parsing beyond "Last, First" /
// "First von Last" / "von Last, Jr, First", crossref/xdata
// inheritance, date parsing beyond a year, sorting by the full sorting
// template, @string macros, hashes (they are made up here: FNV-1a, stable).
import { parseBbl } from './bbl.ts';

export interface BibtexEntry { type: string; key: string; fields: Record<string, string> }

export function parseBibtex(text: string): { entries: BibtexEntry[]; errors: string[] } {
  const entries: BibtexEntry[] = [];
  const errors: string[] = [];
  const at = /@\s*([a-zA-Z]+)\s*[{(]/g;
  let m: RegExpExecArray | null;
  while ((m = at.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') { skipBalanced(); continue; }
    let i = at.lastIndex;
    const close = text[at.lastIndex - 1] === '(' ? ')' : '}';
    const keyEnd = text.indexOf(',', i);
    if (keyEnd < 0) { errors.push(`@${type}: no key`); break; }
    const key = text.slice(i, keyEnd).trim();
    i = keyEnd + 1;
    const fields: Record<string, string> = {};
    for (;;) {
      while (/[\s,]/.test(text[i] ?? '')) i++;
      if (i >= text.length) { errors.push(`${key}: unterminated entry`); break; }
      if (text[i] === close) { i++; break; }
      const fm = /^([A-Za-z_][\w:.+-]*)\s*=\s*/.exec(text.slice(i));
      if (!fm) { errors.push(`${key}: cannot read a field at “${text.slice(i, i + 20)}”`); break; }
      i += fm[0].length;
      let value = '';
      for (;;) {                                    // value parts joined by #
        while (/\s/.test(text[i] ?? '')) i++;
        if (text[i] === '{') { const [v, j] = balanced(text, i, '{', '}'); value += v; i = j; }
        else if (text[i] === '"') { let j = i + 1, d = 0; for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') d--; else if (text[j] === '"' && d === 0) break; } value += text.slice(i + 1, j); i = j + 1; }
        else { const vm = /^[^,\s}#)]+/.exec(text.slice(i)); value += vm ? vm[0] : ''; i += vm ? vm[0].length : 1; }
        while (/\s/.test(text[i] ?? '')) i++;
        if (text[i] === '#') { i++; continue; }
        break;
      }
      fields[fm[1].toLowerCase()] = value.replace(/\s+/g, ' ').trim();
    }
    entries.push({ type, key, fields });
    at.lastIndex = i;
  }
  return { entries, errors };
  function skipBalanced() { const open = at.lastIndex - 1; const [, j] = balanced(text, open, text[open], text[open] === '(' ? ')' : '}'); at.lastIndex = j; }
}
function balanced(s: string, i: number, open: string, close: string): [string, number] {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === open) d++;
    else if (s[j] === close && --d === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

interface Name { family: string; given: string; prefix: string; suffix: string }
/** "Last, First", "Last, Jr, First", "First von Last" */
export function parseNames(s: string): Name[] {
  const parts = splitTop(s, /\s+and\s+/);
  return parts.filter((p) => p.trim() && p.trim() !== 'others').map((p) => {
    const c = splitTop(p, /\s*,\s*/);
    if (c.length >= 2) {
      const [last, ...rest] = c;
      const given = rest.length === 2 ? rest[1] : rest[0];
      const suffix = rest.length === 2 ? rest[0] : '';
      const { prefix, family } = vonLast(last);
      return { family, given: given.trim(), prefix, suffix };
    }
    const words = splitTop(p.trim(), /\s+/);
    if (words.length === 1) return { family: words[0], given: '', prefix: '', suffix: '' };
    // von part: the first lower-case word from the second on
    let k = words.findIndex((w, i) => i > 0 && i < words.length - 1 && /^[a-z]/.test(w));
    if (k < 0) k = words.length - 1;
    return { given: words.slice(0, k).join(' '), prefix: words.slice(k, words.length - 1).filter((w) => /^[a-z]/.test(w)).join(' '), family: words[words.length - 1], suffix: '' };
  });
}
function vonLast(s: string): { prefix: string; family: string } {
  const w = splitTop(s.trim(), /\s+/);
  let k = 0;
  while (k < w.length - 1 && /^[a-z]/.test(w[k])) k++;
  return { prefix: w.slice(0, k).join(' '), family: w.slice(k).join(' ') };
}
/** split at a separator outside braces */
function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let d = 0, cur = '';
  const g = new RegExp(sep.source, 'y');
  for (let i = 0; i < s.length;) {
    if (s[i] === '{') d++; else if (s[i] === '}') d--;
    if (d === 0) { g.lastIndex = i; const m = g.exec(s); if (m && m[0].length) { out.push(cur); cur = ''; i += m[0].length; continue; } }
    cur += s[i++];
  }
  out.push(cur);
  return out;
}

const fnv = (s: string): string => {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0; }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
};
const plain = (s: string) => s.replace(/\\[a-zA-Z]+\s*|[{}\\'"`^~]/g, '');
const initial = (s: string) => {
  const p = plain(s).trim();
  return p ? `${p.charAt(0)}\\bibinitperiod` : '';
};

/** biblatex alphabetic's label (without extraalpha). */
export function labelAlpha(names: Name[], year: string): string {
  const yy = (/\d{4}/.exec(year)?.[0] ?? year).slice(-2);
  const fam = (n: Name) => plain(n.family);
  let lab: string;
  if (!names.length) lab = '';
  else if (names.length === 1) lab = fam(names[0]).slice(0, 3);
  else if (names.length <= 3) lab = names.map((n) => fam(n).charAt(0)).join('');
  else lab = `${fam(names[0]).slice(0, 3)}+`;
  return lab + yy;
}

const TYPE_MAP: Record<string, string> = { conference: 'inproceedings', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', electronic: 'online', www: 'online' };
const FIELD_MAP: Record<string, string> = { journal: 'journaltitle', address: 'location', school: 'institution' };
const LIST_FIELDS = new Set(['location', 'publisher', 'institution', 'organization', 'language']);
const VERB_FIELDS = new Set(['doi', 'url', 'eprint']);
const SKIP = new Set(['author', 'editor', 'month', 'keywords', 'abstract', 'file', 'timestamp', 'biburl', 'bibsource', 'note']);

function nameBlock(role: string, names: Name[]): string[] {
  const out = [`      \\name{${role}}{${names.length}}{}{%`];
  for (const n of names) {
    const parts = [`           family={${n.family}}`, `           familyi={${initial(n.family)}}`];
    if (n.given) parts.push(`           given={${n.given}}`, `           giveni={${n.given.split(/\s+/).map(initial).join('\\bibinitdelim ')}}`);
    if (n.prefix) parts.push(`           prefix={${n.prefix}}`, `           prefixi={${initial(n.prefix)}}`);
    if (n.suffix) parts.push(`           suffix={${n.suffix}}`, `           suffixi={${initial(n.suffix)}}`);
    out.push(`        {{hash=${fnv(JSON.stringify(n)).slice(0, 32)}}{%`, parts.join(',\n') + '}}%');
  }
  out.push('      }');
  return out;
}

/** One BibTeX entry as a bbl \entry (labelalpha given, extraalpha 0 = none). */
export function toBblEntry(e: BibtexEntry, labelalpha: string, extraalpha: number): string {
  const f = e.fields;
  const type = TYPE_MAP[e.type] ?? e.type;
  const L: string[] = [`    \\entry{${e.key}}{${type}}{}`];
  const authors = f.author ? parseNames(f.author) : [];
  const editors = f.editor ? parseNames(f.editor) : [];
  if (authors.length) L.push(...nameBlock('author', authors));
  if (editors.length) L.push(...nameBlock('editor', editors));
  for (const [k0, v] of Object.entries(f)) {
    const k = FIELD_MAP[k0] ?? k0;
    if (LIST_FIELDS.has(k)) L.push(`      \\list{${k}}{1}{%`, `        {${v}}%`, '      }');
  }
  const names = authors.length ? authors : editors;
  const hash = fnv(names.map((n) => n.family + n.given).join('|')).slice(0, 32);
  for (const s of ['namehash', 'fullhash', 'bibnamehash']) L.push(`      \\strng{${s}}{${hash}}`);
  L.push(`      \\field{labelalpha}{${labelalpha}}`);
  L.push(`      \\field{sortinit}{${plain(names[0]?.family ?? e.key).charAt(0).toUpperCase()}}`);
  if (extraalpha > 0) L.push(`      \\field{extraalpha}{${extraalpha}}`);
  if (names.length) L.push(`      \\field{labelnamesource}{${authors.length ? 'author' : 'editor'}}`);
  if (f.title) L.push('      \\field{labeltitlesource}{title}');
  const pages = f.pages;
  for (const [k0, v] of Object.entries(f).sort(([a], [b]) => a.localeCompare(b))) {
    const k = FIELD_MAP[k0] ?? k0;
    if (SKIP.has(k0) || LIST_FIELDS.has(k) || VERB_FIELDS.has(k) || k === 'pages') continue;
    L.push(`      \\field{${k}}{${v}}`);
  }
  if (pages) {
    const pm = /^\s*(\S+?)\s*-+\s*(\S+)\s*$/.exec(pages);
    L.push(`      \\field{pages}{${pm ? `${pm[1]}\\bibrangedash ${pm[2]}` : pages}}`);
    L.push(`      \\range{pages}{${pm && /^\d+$/.test(pm[1]) && /^\d+$/.test(pm[2]) ? Number(pm[2]) - Number(pm[1]) + 1 : -1}}`);
  }
  for (const k of VERB_FIELDS) if (f[k]) L.push(`      \\verb{${k}}`, `      \\verb ${f[k]}`, '      \\endverb');
  L.push('    \\endentry');
  return L.join('\n');
}

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

/** Add (or replace) the BibTeX's entries in a .bbl text. */
export function addBibtex(bblText: string | null, bibtex: string): { bbl: string; added: string[]; replaced: string[]; errors: string[] } {
  let text = bblText && /\\datalist/.test(bblText) ? bblText : EMPTY_BBL;
  const { entries, errors } = parseBibtex(bibtex);
  const added: string[] = [], replaced: string[] = [];
  for (const e of entries) {
    let bbl = parseBbl(text);
    const old = bbl.byKey.get(e.key);
    if (old) {                                     // replace: drop the old one first
      const lineStart = text.lastIndexOf('\n', old.start) + 1;
      text = text.slice(0, lineStart) + text.slice(old.end).replace(/^[^\n]*\n/, '');
      replaced.push(e.key);
      bbl = parseBbl(text);
    } else added.push(e.key);
    const names = e.fields.author ? parseNames(e.fields.author) : e.fields.editor ? parseNames(e.fields.editor) : [];
    const la = labelAlpha(names, e.fields.year ?? e.fields.date ?? '');
    // extraalpha: the next free letter among entries with this labelalpha
    const same = bbl.entries.filter((x) => x.fields.labelalpha === la);
    let extra = 0;
    if (same.length) {
      extra = Math.max(...same.map((x) => Number(x.fields.extraalpha ?? 0))) + 1;
      // an existing lone entry gets its "a" now
      for (const x of same) if (!x.fields.extraalpha) {
        const seg = text.slice(x.start, x.end).replace(/(\\field\{labelalpha\}\{[^\n]*\}\n)/, `$1      \\field{extraalpha}{1}\n`);
        text = text.slice(0, x.start) + seg + text.slice(x.end);
        extra = Math.max(extra, 2);
      }
      bbl = parseBbl(text);
    }
    const entry = toBblEntry(e, la, extra);
    // the sorted place: before the first entry whose label sorts after this one
    const sortKey = (lab: string, key: string) => `${lab.toLowerCase()}\u0000${key.toLowerCase()}`;
    const mine = sortKey(la, e.key);
    const next = bbl.entries.find((x) => sortKey(x.fields.labelalpha ?? '', x.key) > mine);
    const at = next ? text.lastIndexOf('\n', next.start) + 1 : text.indexOf('  \\enddatalist');
    text = text.slice(0, at) + entry + '\n' + text.slice(at);
  }
  return { bbl: text, added, replaced, errors };
}
