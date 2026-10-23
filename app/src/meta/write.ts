// Writing the title data back into the preamble by splicing the source:
// a changed value replaces only its value, a new entry is inserted after its
// neighbour with that neighbour's indentation, a removed one goes with its
// line, a moved author or affiliation carries its text as it was. Unknown
// keys, comments and layout stay. Nothing changed: the source comes back as
// it was (the same string).
//
//   writeMeta(preamble, meta) → preamble'
//   metaBlock(meta) → the canonical \ReflowedMeta{…} text (a new command)

import { lineStart, parseKv, writeValue, type KvEntry } from './kv.ts';
import { AFFIL_KEYS, AUTHOR_KEYS, TOP_KEYS, effective, metaEqual, readMeta, type Fields, type Item, type ListKey, type Meta, type MetaCommand, type Value } from './model.ts';

interface Edit { at: number; end: number; text: string }

const order = (keys: string[]) => (a: string, b: string) => {
  const i = keys.indexOf(a), j = keys.indexOf(b);
  return (i < 0 ? 1e9 : i) - (j < 0 ? 1e9 : j);
};
const entryText = (k: string, v: Value) => (v === null ? k : `${k} = ${writeValue(v)}`);
/** Fields in canonical order (known keys first, the rest as given), duplicates folded. */
function canonical(fields: Fields, keys: string[]): Fields {
  const m = effective(fields);
  return [...m.keys()].sort(order(keys)).map((k) => [k, m.get(k)!]);
}
export function itemText(list: ListKey, it: Item): string {
  const f = canonical(it.fields, list === 'author' ? AUTHOR_KEYS : AFFIL_KEYS);
  return `${list} = {${f.map(([k, v]) => entryText(k, v)).join(', ')}}`;
}
/** The whole command, canonical: one entry per line, trailing commas. */
export function metaBlock(meta: Meta): string {
  const lines = [
    ...canonical(meta.top, TOP_KEYS).map(([k, v]) => entryText(k, v)),
    ...meta.authors.map((a) => itemText('author', a)),
    ...meta.affiliations.map((a) => itemText('affiliation', a)),
  ];
  return `\\ReflowedMeta{\n${lines.map((l) => `  ${l},\n`).join('')}}`;
}

/** Apply edits (non-overlapping) to s. */
function apply(s: string, edits: Edit[]): string {
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.at - a.at || b.end - a.end || b.i - a.i);
  for (const e of sorted) s = s.slice(0, e.at) + e.text + s.slice(e.end);
  return s;
}

/** Splicing inside one key–value list s[from, to). */
class ListWriter {
  edits: Edit[] = [];
  multiline: boolean;
  private s: string; private from: number; private to: number;
  constructor(s: string, from: number, to: number) {
    this.s = s; this.from = from; this.to = to;
    this.multiline = s.slice(from, to).includes('\n');
  }
  private indent(e: KvEntry) {
    const ls = lineStart(this.s, e.start);
    return ls === null ? '  ' : this.s.slice(ls, e.start);
  }
  /** Remove an entry (its line, when it is alone on it). */
  remove(e: KvEntry) {
    const s = this.s;
    const after = e.comma !== null ? e.comma + 1 : e.end;
    const ls = lineStart(s, e.start);
    let k = after;
    while (k < this.to && (s[k] === ' ' || s[k] === '\t')) k++;
    if (this.multiline && ls !== null && s[k] === '\n') { this.edits.push({ at: ls, end: k + 1, text: '' }); return; }
    if (e.comma !== null) { this.edits.push({ at: e.start, end: k, text: '' }); return; }
    // the last entry without a comma: take the comma before it
    let p = e.start;
    while (p > this.from && /\s/.test(s[p - 1])) p--;
    this.edits.push({ at: s[p - 1] === ',' ? p - 1 : e.start, end: e.end, text: '' });
  }
  /** Insert entries (texts) after `a`, or at the list's start when a is null. */
  insertAfter(a: KvEntry | null, texts: string[]) {
    if (!texts.length) return;
    const s = this.s;
    if (!a) {
      if (this.multiline) {
        // before the first entry's line, with its indentation
        const first = parseKv(s, this.from, this.to)[0];
        const ind = first ? this.indent(first) : '  ';
        const at = first ? (lineStart(s, first.start) ?? first.start) : this.to;
        const lead = first ? '' : (s[this.from] === '\n' ? '' : '\n');
        this.edits.push({ at: first ? at : this.from + (s[this.from] === '\n' ? 1 : 0), end: first ? at : this.from + (s[this.from] === '\n' ? 1 : 0), text: lead + texts.map((t) => `${ind}${t},\n`).join('') });
      } else {
        const first = parseKv(s, this.from, this.to)[0];
        this.edits.push(first ? { at: first.start, end: first.start, text: texts.map((t) => `${t}, `).join('') } : { at: this.from, end: this.to, text: texts.join(', ') });
      }
      return;
    }
    // a multi-line list, the anchor at its line's start: new lines with its indentation; else on its line
    if (this.multiline && lineStart(s, a.start) !== null) {
      const ind = this.indent(a);
      if (a.comma !== null) this.edits.push({ at: a.comma + 1, end: a.comma + 1, text: texts.map((t) => `\n${ind}${t},`).join('') });
      else this.edits.push({ at: a.end, end: a.end, text: texts.map((t) => `,\n${ind}${t}`).join('') });
    } else {
      if (a.comma !== null) this.edits.push({ at: a.comma + 1, end: a.comma + 1, text: texts.map((t) => ` ${t},`).join('') });
      else this.edits.push({ at: a.end, end: a.end, text: texts.map((t) => `, ${t}`).join('') });
    }
  }
  replace(at: number, end: number, text: string) { this.edits.push({ at, end, text }); }
}

/** Fields edits within one list: values replaced, removed keys removed, new keys after the last kept. */
function fieldEdits(w: ListWriter, s: string, old: KvEntry[], next: Fields, keys: string[]) {
  const want = effective(next);
  const lastOf = new Map<string, KvEntry>();
  for (const e of old) lastOf.set(e.key, e);
  let anchor: KvEntry | null = null;
  for (const e of old) {
    if (!want.has(e.key)) { w.remove(e); continue; }
    if (lastOf.get(e.key) !== e) { w.remove(e); continue; }           // an earlier duplicate
    anchor = e;
    const v = want.get(e.key)!;
    if (v === e.value) continue;
    if (v === null || e.value === null) w.replace(e.start, e.end, entryText(e.key, v));
    else w.replace(e.vStart, e.vEnd, writeValue(v));
  }
  const added = [...want.keys()].filter((k) => !lastOf.has(k)).sort(order(keys));
  // new keys go after the last kept entry (or first, if there is none)
  w.insertAfter(anchor, added.map((k) => entryText(k, want.get(k)!)));
}

/** Longest increasing subsequence of origins: the items that stay in place. */
function staying(origins: Array<number | null>): Set<number> {
  const idx: number[] = [], prev: number[] = new Array(origins.length).fill(-1), tails: number[] = [];
  origins.forEach((o, i) => {
    if (o === null) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if ((origins[tails[m]] as number) < o) lo = m + 1; else hi = m; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
    idx.push(i);
  });
  const out = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i);
  return out;
}

/** The text of an item, its fields edited (for a moved item: its source text, spliced). */
function itemSource(s: string, list: ListKey, src: MetaCommand['items'][ListKey][number], it: Item): string {
  if (!src.inner) return itemText(list, it);
  const [a, b] = [src.entry.start, src.entry.end];
  const sub = s.slice(a, b);
  const fw = new ListWriter(sub, src.inner[0] - a, src.inner[1] - a);
  fieldEdits(fw, sub, parseKv(sub, src.inner[0] - a, src.inner[1] - a), it.fields, list === 'author' ? AUTHOR_KEYS : AFFIL_KEYS);
  return apply(sub, fw.edits);
}

/** The preamble with `meta` written into its first \ReflowedMeta (added, with the package, when missing). */
export function writeMeta(pre: string, meta: Meta): string {
  const src = readMeta(pre);
  if (!src.cmd) {
    if (!meta.top.length && !meta.authors.length && !meta.affiliations.length) return pre;
    const block = `${src.usesPackage ? '' : '\\usepackage{reflowed-meta}\n'}${metaBlock(meta)}\n`;
    return pre + (pre.endsWith('\n') || !pre ? '' : '\n') + block;
  }
  if (metaEqual(src.meta, meta)) return pre;
  const cmd = src.cmd;
  const w = new ListWriter(pre, cmd.argStart, cmd.argEnd);
  // top-level keys
  const scalars = cmd.top.filter((e) => e.key !== 'author' && e.key !== 'affiliation');
  const sw = new ListWriter(pre, cmd.argStart, cmd.argEnd);
  fieldEditsTop(sw, scalars, meta.top);
  w.edits.push(...sw.edits);
  // the lists: authors after the scalars, affiliations after the authors
  let before: KvEntry | null = lastKept(scalars, meta.top);
  for (const list of ['author', 'affiliation'] as const) {
    const olds = cmd.items[list];
    const news = (list === 'author' ? meta.authors : meta.affiliations);
    const origins = news.map((n) => (n.origin !== null && n.origin < olds.length ? n.origin : null));
    // an origin used twice: the second is new
    const seen = new Set<number>();
    origins.forEach((o, i) => { if (o !== null) { if (seen.has(o)) origins[i] = null; else seen.add(o); } });
    const stay = staying(origins);
    const used = new Set(origins.filter((o): o is number => o !== null));
    for (let j = 0; j < olds.length; j++) if (!used.has(j)) w.remove(olds[j].entry);
    let anchor: KvEntry | null = null, pending: string[] = [];
    const firstStay = [...stay].sort((a, b) => a - b)[0];
    const flush = () => {
      if (!pending.length) return;
      if (anchor) w.insertAfter(anchor, pending);
      else if (firstStay !== undefined) insertBefore(w, pre, olds[origins[firstStay]!].entry, pending);
      else w.insertAfter(before, pending);
      pending = [];
    };
    news.forEach((it, i) => {
      const o = origins[i];
      if (o !== null && stay.has(i)) {
        flush();
        const src0 = olds[o];
        if (src0.inner) {
          const fw = new ListWriter(pre, src0.inner[0], src0.inner[1]);
          fieldEdits(fw, pre, src0.fields, it.fields, list === 'author' ? AUTHOR_KEYS : AFFIL_KEYS);
          w.edits.push(...fw.edits);
        } else if (!sameFields(src0.fields, it.fields)) w.replace(src0.entry.start, src0.entry.end, itemText(list, it));
        anchor = src0.entry;
      } else {
        if (o !== null) w.remove(olds[o].entry);
        pending.push(o !== null ? itemSource(pre, list, olds[o], it) : itemText(list, it));
      }
    });
    flush();
    const lastStay = [...stay].sort((a, b) => b - a)[0];
    if (lastStay !== undefined) before = olds[origins[lastStay]!].entry;
    else if (news.length && !anchor) { /* inserted after `before`: keep it as the anchor for the next list */ }
  }
  return apply(pre, w.edits);
}

function sameFields(a: KvEntry[], b: Fields): boolean {
  const p = effective(a.map((e) => [e.key, e.value])), q = effective(b);
  if (p.size !== q.size) return false;
  for (const [k, v] of p) if (q.get(k) !== v) return false;
  return true;
}
function lastKept(scalars: KvEntry[], top: Fields): KvEntry | null {
  const want = effective(top);
  let a: KvEntry | null = null;
  for (const e of scalars) if (want.has(e.key)) a = e;
  return a;
}
function fieldEditsTop(w: ListWriter, old: KvEntry[], next: Fields) {
  const want = effective(next);
  const lastOf = new Map<string, KvEntry>();
  for (const e of old) lastOf.set(e.key, e);
  let anchor: KvEntry | null = null;
  for (const e of old) {
    if (!want.has(e.key) || lastOf.get(e.key) !== e) { w.remove(e); continue; }
    anchor = e;
    const v = want.get(e.key)!;
    if (v === e.value) continue;
    if (v === null || e.value === null) w.replace(e.start, e.end, entryText(e.key, v));
    else w.replace(e.vStart, e.vEnd, writeValue(v));
  }
  const added = [...want.keys()].filter((k) => !lastOf.has(k)).sort(order(TOP_KEYS));
  w.insertAfter(anchor, added.map((k) => entryText(k, want.get(k)!)));
}
function insertBefore(w: ListWriter, s: string, e: KvEntry, texts: string[]) {
  const ls = lineStart(s, e.start);
  if (w.multiline && ls !== null) w.replace(ls, ls, texts.map((t) => `${s.slice(ls, e.start)}${t},\n`).join(''));
  else w.replace(e.start, e.start, texts.map((t) => `${t}, `).join(''));
}
