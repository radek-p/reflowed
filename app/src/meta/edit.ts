// The form's operations on the title data (meta/model.ts), as pure functions:
// each returns a new Meta and leaves its argument alone. Affiliations are
// kept in the order of first use (the numbering classes print), unused ones
// after them, so renumbering is automatic.
//
//   addAuthor, removeAuthor, moveAuthor, setAuthorField, setTop
//   attachAffil(meta, author, id), detachAffil(meta, author, id)
//   newAffil(meta, name) → [meta, id]      an id from the name's initials (uw, mpi …), unique
//   removeAffil(meta, id)                  (from every author too)
//   setAffilField(meta, id, key, value)
//   renumber(meta)                         affiliations by first use
//   affilNumbers(meta) → Map id → 1, 2 …   (used ones only)
//   affilUses(meta, id) → how many authors
//   affilLabel(item) → the text an affiliation shows (its name, else its parts joined)
//   className(preamble) / classOptionSet(preamble, option) / withClassOption(preamble, option, on)
import { affilIds, get, set, type Fields, type Item, type Meta, type Value } from './model.ts';
import { valueText } from '../tex/text.ts';
import { commandCalls, controlSequences } from '../tex/calls.ts';

const copy = (m: Meta): Meta => ({ top: m.top.slice(), authors: m.authors.map((a) => ({ ...a, fields: a.fields.slice() })), affiliations: m.affiliations.map((a) => ({ ...a, fields: a.fields.slice() })) });

export function addAuthor(m: Meta, fields: Fields = [['name', '']]): Meta {
  const n = copy(m);
  n.authors.push({ fields, origin: null });
  return renumber(n);
}
export function removeAuthor(m: Meta, i: number): Meta {
  const n = copy(m);
  n.authors.splice(i, 1);
  return renumber(n);
}
export function moveAuthor(m: Meta, from: number, to: number): Meta {
  if (from === to || to < 0 || to >= m.authors.length) return m;
  const n = copy(m);
  const [a] = n.authors.splice(from, 1);
  n.authors.splice(to, 0, a);
  return renumber(n);
}
/** value undefined removes the key; null is a flag */
export function setAuthorField(m: Meta, i: number, key: string, v: Value | undefined): Meta {
  const n = copy(m);
  n.authors[i] = { ...n.authors[i], fields: set(n.authors[i].fields, key, v) };
  return key === 'affil' ? renumber(n) : n;
}
export function setTop(m: Meta, key: string, v: Value | undefined): Meta {
  const n = copy(m);
  n.top = set(n.top, key, v);
  return n;
}

const writeIds = (ids: string[]) => (ids.length ? ids.join(', ') : undefined);
export function attachAffil(m: Meta, i: number, id: string): Meta {
  const ids = affilIds(m.authors[i]);
  return ids.includes(id) ? m : setAuthorField(m, i, 'affil', writeIds([...ids, id]));
}
export function detachAffil(m: Meta, i: number, id: string): Meta {
  return setAuthorField(m, i, 'affil', writeIds(affilIds(m.authors[i]).filter((x) => x !== id)));
}

export const affilId = (a: Item) => (get(a.fields, 'id') ?? '') as string;
/** An id for an affiliation: the initials of its capitalised words (uw, mpi …), unique among `used`. */
export function makeId(text: string, used: Set<string>): string {
  let plain = valueText(text) ?? text;
  for (const cs of controlSequences(plain).reverse()) plain = plain.slice(0, cs.start) + ' '.repeat(cs.end - cs.start) + plain.slice(cs.end);
  const words = plain.replace(/[{}\\,.;:()]/g, ' ').split(/\s+/).filter((w) => /^\p{Lu}/u.test(w));
  let base = words.map((w) => w.normalize('NFD')[0].toLowerCase()).join('').replace(/[^a-z]/g, '').slice(0, 6) || 'affil';
  if (!/^[a-z]/.test(base)) base = `a${base}`;
  let id = base, k = 2;
  while (used.has(id)) id = `${base}${k++}`;
  return id;
}
export function newAffil(m: Meta, name: string, author: number | null = null): [Meta, string] {
  const id = makeId(name, new Set(m.affiliations.map(affilId)));
  let n = copy(m);
  n.affiliations.push({ fields: [['id', id], ['name', name]], origin: null });
  if (author !== null) n = attachAffil(n, author, id);
  return [renumber(n), id];
}
export function removeAffil(m: Meta, id: string): Meta {
  let n = copy(m);
  n.authors.forEach((a, i) => { if (affilIds(a).includes(id)) n = detachAffil(n, i, id); });
  n.affiliations = n.affiliations.filter((a) => affilId(a) !== id);
  return renumber(n);
}
export function setAffilField(m: Meta, id: string, key: string, v: Value | undefined): Meta {
  const n = copy(m);
  n.affiliations = n.affiliations.map((a) => (affilId(a) === id ? { ...a, fields: set(a.fields, key, v) } : a));
  return n;
}

/** Affiliations in the order of first use, unused ones after (in their order). Same order: the same object. */
export function renumber(m: Meta): Meta {
  const rank = new Map<string, number>();
  for (const a of m.authors) for (const id of affilIds(a)) if (!rank.has(id)) rank.set(id, rank.size);
  const sorted = m.affiliations.map((a, k) => ({ a, k })).sort((x, y) => (rank.get(affilId(x.a)) ?? 1e6 + x.k) - (rank.get(affilId(y.a)) ?? 1e6 + y.k)).map((x) => x.a);
  if (sorted.every((a, k) => a === m.affiliations[k])) return m;
  return { ...m, affiliations: sorted };
}
export function affilNumbers(m: Meta): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of m.authors) for (const id of affilIds(a)) if (!out.has(id)) out.set(id, out.size + 1);
  return out;
}
export const affilUses = (m: Meta, id: string) => m.authors.filter((a) => affilIds(a).includes(id)).length;
const PARTS = ['department', 'institution', 'address', 'city', 'country'];
export function affilLabel(a: Item): string {
  const name = get(a.fields, 'name');
  const src = name != null ? name : PARTS.map((k) => get(a.fields, k)).filter((x): x is string => !!x).join(', ');
  return valueText(src) ?? src;
}

// ── the class and its options (anonymous mode drives the class option where there is one) ──
export function className(pre: string): string {
  return commandCalls(pre, 'documentclass', 1)[0]?.args[0].trim() ?? '';
}
/** Classes with an `anonymous` option that hides the authors themselves. */
export const ANON_OPTION_CLASSES = /^(lipics-v20\d\d|oasics-v20\d\d|acmart)$/;
export function classOptionSet(pre: string, opt: string): boolean {
  const c = commandCalls(pre, 'documentclass', 1)[0];
  return !!c?.opt && c.opt.split(',').map((x) => x.trim()).includes(opt);
}
export function withClassOption(pre: string, opt: string, on: boolean): string {
  const c = commandCalls(pre, 'documentclass', 1)[0];
  if (!c || classOptionSet(pre, opt) === on) return pre;
  const opts = (c.opt ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const next = on ? [...opts, opt] : opts.filter((x) => x !== opt);
  const sep = c.opt && /,\s/.test(c.opt) ? ', ' : ',';
  const rebuilt = `\\documentclass${next.length ? `[${next.join(sep)}]` : ''}`;
  return pre.slice(0, c.start) + rebuilt + pre.slice(c.argSpans[0][0] - 1);      // from the class's {
}
