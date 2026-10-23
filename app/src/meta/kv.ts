// A key–value list read as expl3's \keyval_parse reads it (reflowed-meta.sty
// stores what this reads): split at commas outside braces, the key before the
// first `=` outside braces, spaces around keys and values dropped, one pair of
// braces around a whole value removed, empty entries skipped; a key with no
// `=` is a flag. TeX drops comments before the list is read, so a `%` (not
// `\%`) runs to the end of its line and the line end with it.
//
// Every entry keeps its source span, so an edit can splice the source and
// leave everything else (unknown keys, comments, layout) as it was. The
// structure is read on the source with its comments blanked (tex/lex.ts:
// same offsets), so a brace or comma in a comment counts for nothing.
import { blankComments, readGroup } from '../tex/lex.ts';
import { isSpaceChar as isSpace } from '../tex/calls.ts';

export interface KvEntry {
  key: string;
  /** the value as stored (outer braces removed); null for a flag */
  value: string | null;
  /** [start, end) of the entry: key start to value end (no separator) */
  start: number;
  end: number;
  /** [start, end) of the value as written (braces included); for a flag the key's end */
  vStart: number;
  vEnd: number;
  /** the separating comma after the entry, if any (its index) */
  comma: number | null;
}

/** The text with comments removed, as TeX reads it: a comment takes its line end and the next line's leading spaces. */
export function dropComments(s: string): string {
  const b = blankComments(s);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (b[i] === s[i]) { out += s[i]; continue; }
    // a comment from i: skip it, its newline and the spaces after
    while (i < s.length && b[i] !== s[i]) i++;
    if (s[i] === '\n') i++;
    while (s[i] === ' ' || s[i] === '\t') i++;
    i--;
  }
  return out;
}

/** Parse the list in s[from, to). Positions are indices into s. */
export function parseKv(s: string, from = 0, to = s.length): KvEntry[] {
  const b = blankComments(s.slice(0, to));
  const out: KvEntry[] = [];
  let i = from;
  const trimStart = (a: number, e: number) => { while (a < e && isSpace(b[a])) a++; return a; };
  const trimEnd = (a: number, e: number) => { while (e > a && isSpace(b[e - 1])) e--; return e; };
  while (i < to) {
    // one entry: up to a comma at depth 0
    let depth = 0, eq = -1, j = i;
    for (; j < to; j++) {
      const c = b[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (depth === 0 && c === ',') break;
      else if (depth === 0 && c === '=' && eq < 0) eq = j;
    }
    const comma = j < to ? j : null;
    const ks = trimStart(i, eq < 0 ? j : eq), ke = trimEnd(ks, eq < 0 ? j : eq);
    if (ks < ke) {
      const key = dropComments(s.slice(ks, ke)).trim();
      if (eq < 0) out.push({ key, value: null, start: ks, end: ke, vStart: ke, vEnd: ke, comma });
      else {
        const vs = trimStart(eq + 1, j), ve = trimEnd(vs, j);
        out.push({ key, value: stripBraces(dropComments(s.slice(vs, ve)).trim()), start: ks, end: ve, vStart: vs, vEnd: ve, comma });
      }
    }
    i = j + 1;
  }
  return out;
}

/** `{x}` → `x` when the braces enclose the whole text. */
export function stripBraces(v: string): string {
  if (v[0] !== '{' || v[v.length - 1] !== '}') return v;
  return readGroup(v, 0)[1] === v.length ? v.slice(1, -1) : v;
}

/** Index of the brace closing the one at `open` (comments and escapes skipped), or -1. */
export function closeBrace(s: string, open: number): number {
  const b = blankComments(s);
  const end = readGroup(b, open)[1];
  return b[end - 1] === '}' && end - 1 > open ? end - 1 : -1;
}

/** The inner span of a braced value as written, or null if it is not braced. */
export function bracedInner(s: string, e: KvEntry): [number, number] | null {
  if (e.value === null || s[e.vStart] !== '{' || closeBrace(s, e.vStart) !== e.vEnd - 1) return null;
  return [e.vStart + 1, e.vEnd - 1];
}

/** A value as written by the editor: always braced. */
export const writeValue = (v: string): string => `{${v}}`;

/** Whether a source value has balanced braces and no comment (else it would break the list). */
export function balanced(v: string): boolean {
  if (blankComments(v) !== v) return false;
  let d = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d < 0) return false;
  }
  return d === 0;
}

/** Where the line of i starts, when only spaces stand before i on it; else null. */
export function lineStart(s: string, i: number): number | null {
  let k = i;
  while (k > 0 && (s[k - 1] === ' ' || s[k - 1] === '\t')) k--;
  return k === 0 || s[k - 1] === '\n' ? k : null;
}
