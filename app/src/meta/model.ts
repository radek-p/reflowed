// The title data of a document: the preamble's \ReflowedMeta{…} (see
// ) read into a small model, and
// written back by splicing the source (write.ts).
//
// Values are LaTeX source, as written. Top-level keys and each author's or
// affiliation's fields keep their order; a key given twice: the last counts
// (as in TeX). Items remember which source entry they came from (`origin`),
// so a reorder moves that entry's text as it was.

import { closeBrace, parseKv, bracedInner, type KvEntry } from './kv.ts';
import { blankComments } from '../tex/lex.ts';
import { controlSequences, packageOptions, skipSpaces } from '../tex/calls.ts';

export type Value = string | null;              // null: a flag (true)
export type Fields = Array<[string, Value]>;
export interface Item { fields: Fields; origin: number | null }
export interface Meta { top: Fields; authors: Item[]; affiliations: Item[] }

export const LISTS = { author: 'authors', affiliation: 'affiliations' } as const;
export type ListKey = keyof typeof LISTS;

/** Canonical order of known keys (new keys are written in this order). */
export const TOP_KEYS = ['title', 'subtitle', 'short-title', 'date', 'keywords', 'thanks', 'funding', 'short-authors', 'copyright', 'anonymous'];
export const AUTHOR_KEYS = ['name', 'short-name', 'affil', 'email', 'orcid', 'url', 'thanks', 'funding', 'corresponding', 'equal', 'break-after'];
export const AFFIL_KEYS = ['id', 'name', 'department', 'institution', 'address', 'city', 'country', 'ror', 'url'];

export const emptyMeta = (): Meta => ({ top: [], authors: [], affiliations: [] });

export function get(fields: Fields, key: string): Value | undefined {
  for (let i = fields.length - 1; i >= 0; i--) if (fields[i][0] === key) return fields[i][1];
  return undefined;
}
/** Set (the last occurrence, else appended); undefined removes every occurrence. */
export function set(fields: Fields, key: string, v: Value | undefined): Fields {
  if (v === undefined) return fields.filter(([k]) => k !== key);
  const out = fields.slice();
  for (let i = out.length - 1; i >= 0; i--) if (out[i][0] === key) { out[i] = [key, v]; return out; }
  out.push([key, v]);
  return out;
}
/** A flag or a value other than `false`. */
export const isTrue = (fields: Fields, key: string) => { const v = get(fields, key); return v !== undefined && v !== 'false'; };
/** An author's affiliation ids. */
export const affilIds = (a: Item): string[] => (get(a.fields, 'affil') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Fields with duplicates folded (last wins), as compared by the writer. */
export function effective(fields: Fields): Map<string, Value> {
  const m = new Map<string, Value>();
  for (const [k, v] of fields) { m.delete(k); m.set(k, v); }
  return m;
}
export function metaEqual(a: Meta, b: Meta): boolean {
  const fe = (x: Fields, y: Fields) => { const p = effective(x), q = effective(y); if (p.size !== q.size) return false; for (const [k, v] of p) if (!q.has(k) || q.get(k) !== v) return false; return true; };
  const le = (x: Item[], y: Item[]) => x.length === y.length && x.every((it, i) => fe(it.fields, y[i].fields));
  return fe(a.top, b.top) && le(a.authors, b.authors) && le(a.affiliations, b.affiliations);
}

/** Where \ReflowedMeta stands in the source. */
export interface MetaCommand {
  start: number; end: number;          // the command, \ReflowedMeta … }
  argStart: number; argEnd: number;    // inside its braces
  top: KvEntry[];                      // the argument's entries
  items: Record<ListKey, Array<{ entry: KvEntry; fields: KvEntry[]; inner: [number, number] | null }>>;
}
export interface MetaSource { meta: Meta; cmd: MetaCommand | null; more: number; usesPackage: boolean }

/** Commands \ReflowedMeta{…} not in a comment: [start, open brace, close brace]. */
export function metaCommands(src: string): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const b = blankComments(src);
  for (const cs of controlSequences(src)) {
    if (cs.name !== 'ReflowedMeta' || (out.length && cs.start < out[out.length - 1][2])) continue;
    const open = skipSpaces(b, cs.end);
    if (b[open] !== '{') continue;
    const close = closeBrace(src, open);
    if (close < 0) break;
    out.push([cs.start, open, close]);
  }
  return out;
}
/** The preamble loads reflowed-meta. */
export const usesPackage = (pre: string) => packageOptions(pre, 'reflowed-meta') !== null;

/** The first \ReflowedMeta of a preamble, read (more: how many others follow). */
export function readMeta(pre: string): MetaSource {
  const cmds = metaCommands(pre);
  const pkg = usesPackage(pre);
  if (!cmds.length) return { meta: emptyMeta(), cmd: null, more: 0, usesPackage: pkg };
  const [start, open, close] = cmds[0];
  const top = parseKv(pre, open + 1, close);
  const meta = emptyMeta();
  const items: MetaCommand['items'] = { author: [], affiliation: [] };
  for (const e of top) {
    if (e.key === 'author' || e.key === 'affiliation') {
      const inner = bracedInner(pre, e);
      const fields = inner ? parseKv(pre, inner[0], inner[1]) : e.value ? parseKv(e.value) : [];
      const list = items[e.key];
      list.push({ entry: e, fields: inner ? fields : [], inner });
      meta[LISTS[e.key]].push({ fields: fields.map((f) => [f.key, f.value]), origin: list.length - 1 });
    } else meta.top.push([e.key, e.value]);
  }
  return { meta, cmd: { start, end: close + 1, argStart: open + 1, argEnd: close, top, items }, more: cmds.length - 1, usesPackage: pkg };
}
