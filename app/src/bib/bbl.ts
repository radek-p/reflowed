// The bibliography as data: a biblatex .bbl (format 3.2/3.3, as biber writes
// it) parsed into entries, for citation autocomplete and hover cards,
// the cited-keys prefix of the \printbibliography block and diagnostics
// (unknown keys). TeX itself reads the same .bbl (in the warm snapshot or
// the batch run) and prints the labels; this parser only describes them.
//
//   parseBbl(text) -> { version, entries: BblEntry[], byKey, errors }
//
// An entry, as biber wrote it:
//   \entry{key}{type}{options}[{…}]
//     \name{author}{n}{opts}{%  {{hash=…}{family={…}, familyi={…}, given={…}, …}}% … }
//     \list{publisher}{n}{% {…}% … }
//     \strng{namehash}{…}   \field{labelalpha}{DT25}   \field{extraalpha}{1}
//     \range{pages}{7}      \verb{doi} \verb 10.1/… \endverb
//     \keyw{…}
//   \endentry
import { texToText } from '../refs/tex-text.ts';

export interface BblName { family: string; given: string; prefix: string; suffix: string }
export interface BblEntry {
  key: string;
  type: string;                      // article, inproceedings, …
  names: Record<string, BblName[]>;  // author, editor, …
  lists: Record<string, string[]>;   // publisher, location, institution, …
  fields: Record<string, string>;    // raw TeX: title, year, labelalpha, …
  verbs: Record<string, string>;     // doi, url, eprint, …
  /** the label the alphabetic style prints: labelalpha + extraalpha as a letter ("Bon+22a") */
  label: string;
  /** for a hover card: plain text */
  card: { authors: string; title: string; year: string; venue: string; doi: string; url: string; eprint: string };
  /** offsets of the entry in the .bbl text (\entry … \endentry) */
  start: number; end: number;
}
export interface Bbl { version: string; entries: BblEntry[]; byKey: Map<string, BblEntry>; errors: string[] }

/** The braced group starting at s[i] === '{': [content, index after]. */
function group(s: string, i: number): [string, number] {
  if (s[i] !== '{') return ['', i];
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}
/** n groups in a row (spaces, newlines and %-line ends between them skipped). */
function groups(s: string, i: number, n: number): [string[], number] {
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    i = skip(s, i);
    const [g, j] = group(s, i);
    out.push(g); i = j;
  }
  return [out, i];
}
function skip(s: string, i: number): number {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '%') { while (i < s.length && s[i] !== '\n') i++; continue; }
    return i;
  }
}
/** The groups of a \name or \list body: each item is one top-level {…}. */
function items(body: string): string[] {
  const out: string[] = [];
  for (let i = skip(body, 0); i < body.length; i = skip(body, i)) {
    if (body[i] !== '{') { i++; continue; }
    const [g, j] = group(body, i);
    out.push(g); i = j;
  }
  return out;
}
/** key={value}, … inside a name's part list. */
function keyvals(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-z]+)\s*=\s*/gy;
  let i = 0;
  while (i < s.length) {
    i = skip(s, i);
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) { i++; continue; }
    i = re.lastIndex;
    if (s[i] === '{') { const [g, j] = group(s, i); out[m[1]] = g; i = j; }
    else { const j = s.indexOf(',', i); out[m[1]] = s.slice(i, j < 0 ? s.length : j).trim(); i = j < 0 ? s.length : j; }
    i = skip(s, i);
    if (s[i] === ',') i++;
  }
  return out;
}
function parseName(item: string): BblName {
  // {{hash=…}{family={…}, …}} or {{un=0,…}{%\n family=…}}: the last group holds the parts
  const inner = items(item);
  const parts = keyvals(inner.length ? inner[inner.length - 1] : item);
  return { family: parts.family ?? '', given: parts.given ?? '', prefix: parts.prefix ?? '', suffix: parts.suffix ?? '' };
}

const letter = (n: number): string => {   // extraalpha 1 -> a, 27 -> aa
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + ((n - 1) % 26)) + s;
  return s;
};

export function nameText(n: BblName): string {
  return [texToText(n.given), texToText(n.prefix), texToText(n.family), texToText(n.suffix)].filter(Boolean).join(' ').replace(/ /g, ' ');
}

export function parseBbl(text: string): Bbl {
  const entries: BblEntry[] = [];
  const errors: string[] = [];
  const version = /bbl format version ([\d.]+)/.exec(text)?.[1] ?? '';
  const re = /\\entry\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const endAt = text.indexOf('\\endentry', start);
    if (endAt < 0) { errors.push(`entry at ${start}: no \\endentry`); break; }
    const end = endAt + '\\endentry'.length;
    let [[key, type], i] = groups(text, start + '\\entry'.length, 2);
    // options, and (biber ≥ 2.17) one more group
    [, i] = groups(text, i, 1);
    if (text[skip(text, i)] === '{') [, i] = groups(text, i, 1);
    const e: BblEntry = { key, type, names: {}, lists: {}, fields: {}, verbs: {}, label: '', card: null as any, start, end };
    const body = text.slice(i, endAt);
    const cmd = /\\(name|list|field|strng|range|verb|keyw|true|false|annotation)\b/g;
    let c: RegExpExecArray | null;
    while ((c = cmd.exec(body))) {
      let j = c.index + c[0].length;
      switch (c[1]) {
        case 'name': case 'list': {
          const n = c[1] === 'name' ? 4 : 3;
          const [g, k] = groups(body, j, n);
          const what = g[0], list = g[n - 1];
          if (c[1] === 'name') e.names[what] = items(list).map(parseName);
          else e.lists[what] = items(list).map((x) => x.trim().replace(/%$/, '').trim());
          cmd.lastIndex = k; break;
        }
        case 'field': case 'strng': case 'range': {
          const [[what, val], k] = groups(body, j, 2);
          if (c[1] === 'field') e.fields[what] = val;
          else if (c[1] === 'range') e.fields[`${what}@range`] = val;
          cmd.lastIndex = k; break;
        }
        case 'verb': {
          if (body[skip(body, j)] !== '{') break;     // "\verb value" lines are read with their \verb{name}
          const [[what], k] = groups(body, j, 1);
          const v = /\\verb ([^\n]*)\n\s*\\endverb/y;
          const at = skip(body, k);
          v.lastIndex = at;
          const vm = v.exec(body);
          if (vm) { e.verbs[what] = vm[1].trim(); cmd.lastIndex = v.lastIndex; } else cmd.lastIndex = k;
          break;
        }
        default: {
          const [, k] = groups(body, j, 1);
          cmd.lastIndex = k;
        }
      }
    }
    const la = texToText(e.fields.labelalpha ?? '');
    const ea = Number(e.fields.extraalpha ?? 0);
    e.label = la + (ea > 0 ? letter(ea) : '');
    const authors = (e.names.author ?? e.names.editor ?? []).map(nameText);
    e.card = {
      authors: authors.length > 2 ? `${authors.slice(0, -1).join(', ')} and ${authors[authors.length - 1]}` : authors.join(' and '),
      title: texToText(e.fields.title ?? ''),
      year: texToText(e.fields.year ?? e.fields.date ?? ''),
      venue: texToText(e.fields.journaltitle ?? e.fields.booktitle ?? e.fields.eventtitle ?? (e.lists.publisher ?? e.lists.institution ?? [])[0] ?? ''),
      doi: e.verbs.doi ?? e.fields.doi ?? '',
      url: e.verbs.url ?? e.fields.url ?? '',
      eprint: e.fields.eprint ?? e.verbs.eprint ?? '',
    };
    entries.push(e);
    re.lastIndex = end;
  }
  return { version, entries, byKey: new Map(entries.map((e) => [e.key, e])), errors };
}

/** Entries whose key, label, authors or title start with / contain the query
 *  (for `\cite{DT` autocomplete): best first. */
export function searchBbl(bbl: Bbl, q: string, limit = 20): BblEntry[] {
  const s = q.toLowerCase();
  const score = (e: BblEntry): number => {
    if (!s) return 1;
    if (e.key.toLowerCase().startsWith(s)) return 5;
    if (e.label.toLowerCase().startsWith(s)) return 4;
    if (e.key.toLowerCase().includes(s)) return 3;
    if ((e.names.author ?? []).some((n) => texToText(n.family).toLowerCase().startsWith(s))) return 2;
    if (e.card.title.toLowerCase().includes(s)) return 1;
    return 0;
  };
  return bbl.entries.map((e) => [score(e), e] as const).filter(([x]) => x > 0)
    .sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, limit).map(([, e]) => e);
}

/** A 3.2 .bbl (biber ≤ 2.19, what the paper ships) for biblatex ≥ 3.20
 *  (format 3.3; TeX Live 2026): the version line, and \entry's fourth
 *  argument (3.3 has {key}{type}{options}{annotations}; without it the
 *  entry's first \name is read as that argument and typeset as text). */
export function bblToFormat33(text: string): string {
  if (!/bbl format version 3\.2 \$/.test(text)) return text;
  return text.replace(/bbl format version 3\.2 \$/, 'bbl format version 3.3 $')
    // the refcontext of a data list gained a sixth part (the name-hash template)
    .replace(/(\\datalist\[[^\]]*\]\{)([^}/]*\/[^}/]*\/[^}/]*\/[^}/]*\/[^}/]*)\}/g, '$1$2/global}')
    .replace(/^(\s*\\entry\{[^}]*\}\{[^}]*\}\{[^}]*\})[ \t]*$/gm, '$1{}');
}
