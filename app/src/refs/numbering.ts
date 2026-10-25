// The numbering overlay: numbers and references of a block document, computed
// from the blocks' order and put into the typeset blocks as live text, with no
// compile. The
// TeX side is ../../../tex/rtx-numbering.sty (see its header for the slot
// names).
//
//   numberDocument(blocks)   blocks in document order: [{ id, source, block }],
//                            block a reflowtex.host Block (host.mount) or null
//                            (not shown yet: its numbers do not count; its
//                            source still does for \appendix and \setcounter)
//   numberingState()         what the last run computed (refsState() builds on it)
//
// Changes from numbering/: a counter's format is read from each number's own
// sample (so \appendix's \Alph applies from where it happens, not from the
// first section); aliased counters (thmtools' sibling=) are counted as the
// counter they share; \appendix, \setcounter and \addtocounter in a block's
// source are applied at the block's start; labels carry cleveref's type and
// names, so \cref/\Cref print "Lemma 3.2", "Bounds 1 to 4" (cref.ts); a
// restated theorem (thm-restate's \name*) is a reference to thmtools' label of
// the original; captions and \tag labels are covered. The viewer sets a text
// wherever its slot is, in a box too (an equation's tag, a caption, maths'
// \text), and packs the box again around it.
//
// It keeps module state (numberingState(), the texts last given), so one
// numbering per page at a time; it uses only the host it is given and the
// public Block API.
import { autorefText, crefText, type CrefData, type LabelInfo } from './cref.ts';
import { scanSource } from './scan.ts';
import { texToText } from './tex-text.ts';

interface Instance {
  id: string;
  kind: string;
  placement: string;
  attrs: Readonly<Record<string, string>>;
  setText(text: string | null, options?: { mirror?: boolean }): void;
}
export interface HostBlock {
  el: HTMLElement;
  key?: string;
  instances(query?: unknown): Instance[];
}
interface Host { setText(name: string, text: string | null): void }
export interface BlockEntry { id: string; source?: string; block: HostBlock | null; type?: string }

export interface LabelRec extends CrefData { l: string; s: number; c: string; t: string }
interface NumData { s: number; c: string; r?: string; R?: string; p: string; f: string; h: string; t: string; L: LabelRec[] }
interface Item { data: NumData; inst: Instance; blockId: string; number: string; value: number; prefix: string; index: number }
interface Parsed { items: { data: NumData; inst: Instance }[]; labels: LabelRec[]; refs: Set<string>; refInsts: { name: string; inst: Instance }[] }

export interface NumberedItem {
  blockId: string; counter: string; raw: string; head: string; number: string; value: number; labels: string[];
}
export interface NumberingState {
  items: NumberedItem[];
  labels: Record<string, LabelInfo>;
  /** every reference slot's name -> the text set ("rtxC:lem:a,lem:b" -> "Lemmas 3.1 and 3.2") */
  refs: Record<string, string>;
  /** per mounted block: the labels its reference slots use */
  refsByBlock: Record<string, string[]>;
  /** labels defined more than once (by different items) */
  duplicates: string[];
  /** block ids with a mounted render (the others' numbers did not count) */
  mounted: string[];
  runs: number;
}

const hostOf = (): Host | null => (globalThis as any).reflowtex?.host ?? null;

// ── Reading a block ──────────────────────────────────────────────────────────

const parsed = new WeakMap<HostBlock, Parsed>();
function parse(block: HostBlock): Parsed {
  let p = parsed.get(block);
  if (p) return p;
  p = { items: [], labels: [], refs: new Set(), refInsts: [] };
  for (const inst of block.instances({ placement: 'text' })) {
    const name = inst.attrs.name || '';
    try {
      if (name.startsWith('rtxn ')) {
        const data = JSON.parse(name.slice(5)) as NumData;
        p.items.push({ data, inst });
        p.labels.push(...data.L);
      } else if (name.startsWith('rtxl ')) {
        p.labels.push(...(JSON.parse(name.slice(5)).L as LabelRec[]));
      } else if (/^rtx[racC]:/.test(name)) {
        p.refs.add(name);
        p.refInsts.push({ name, inst });
      }
    } catch { /* a name we did not write */ }
  }
  p.items.sort((a, b) => a.data.s - b.data.s);
  parsed.set(block, p);
  return p;
}
/** The labels a reference slot's name holds ("rtxc:a,b" -> [a, b]). */
export const refLabels = (name: string): string[] => name.slice(5).split(',').map((x) => x.trim()).filter(Boolean);

// ── Formats ──────────────────────────────────────────────────────────────────

type Style = 'arabic' | 'roman' | 'Roman' | 'alph' | 'Alph';
const roman = (n: number): string => {
  if (n <= 0) return '';
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
};
const alph = (n: number): string => (n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : n <= 0 ? '' : String(n));
function fmt(n: number, style: Style): string {
  switch (style) {
    case 'roman': return roman(n);
    case 'Roman': return roman(n).toUpperCase();
    case 'alph': return alph(n);
    case 'Alph': return alph(n).toUpperCase();
    default: return String(n);
  }
}
const STYLES: Style[] = ['arabic', 'roman', 'Roman', 'alph', 'Alph'];
interface Format { style: Style; head: string }
/** A sample ("23.4": \the<counter> with 4, its parent 23): the counter's own
 *  style (the end) and what comes before it. */
function readSample(f: string): Format {
  const ends: [RegExp, Style][] = [[/4$/, 'arabic'], [/iv$/, 'roman'], [/IV$/, 'Roman'], [/d$/, 'alph'], [/D$/, 'Alph']];
  for (const [re, style] of ends) {
    const m = re.exec(f);
    if (m) return { style, head: f.slice(0, m.index) };
  }
  return { style: 'arabic', head: f };
}
/** Where the parent's number (TeX printed 23) stands in a head, and in what style. */
function parentMark(head: string): { at: number; len: number; style: Style } | null {
  let best: { at: number; len: number; style: Style } | null = null;
  for (const style of STYLES) {
    const mark = fmt(23, style);
    const at = head.lastIndexOf(mark);
    if (at >= 0 && (!best || at + mark.length > best.at + best.len || (at + mark.length === best.at + best.len && mark.length > best.len)))
      best = { at, len: mark.length, style };
  }
  return best;
}

const NAMES: Record<string, string> = {
  section: 'Section', subsection: 'Subsection', subsubsection: 'Subsubsection', chapter: 'Chapter',
  paragraph: 'Paragraph', part: 'Part', equation: 'Equation', figure: 'Figure', table: 'Table',
  enumi: 'Item', enumii: 'Item', enumiii: 'Item', enumiv: 'Item', footnote: 'Footnote',
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── The run ──────────────────────────────────────────────────────────────────

let last: NumberingState = { items: [], labels: {}, refs: {}, refsByBlock: {}, duplicates: [], mounted: [], runs: 0 };
const shown = new WeakMap<Instance, string>();   // what an instance was last given
const refShown = new Map<string, string>();        // what a reference name was last given
const listeners = new Set<(s: NumberingState) => void>();

/** How a run gives the reference slots their texts:
 *    'page'       host.setText(name, text): page-global by name, so a block mounted later shows it at once
 *                 (one document on the page);
 *    'instances'  each slot instance of the document's blocks its own text, mirrored into every view
 *                 (inst.setText(text, { mirror: true })): two documents on the page whose slots share a name
 *                 ("rtxC:lem:a") keep their own texts. A block mounted later shows TeX's default until the
 *                 next run (the refresh after every mount).
 *  `names`: what this caller gave each name last (one map per document: refs/index.ts createRefs). */
export interface NumberOptions { slots?: 'page' | 'instances'; names?: Map<string, string> }

/** Called after every run (diagnostics). */
export function onNumbered(fn: (s: NumberingState) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** `recallOf`: block id -> the block it restates (a thm-restate recall, \name*,
 *  shown with a copy of the original's render): its numbers are the
 *  original's, it steps no counter and defines no label. */
export function numberDocument(blocks: BlockEntry[], host: Host | null = hostOf(), recallOf: Map<string, string> = new Map(), o: NumberOptions = {}): NumberingState {
  const byName = o.names ?? refShown;
  const isLive = (b: BlockEntry) => !!b.block && b.block.el?.isConnected !== false;
  const per = blocks.map((entry) => ({ entry, p: isLive(entry) ? parse(entry.block!) : null }));

  // counters: parents, children (from every sample TeX gave), aliases raw -> canonical
  const parent = new Map<string, string>();
  const children = new Map<string, Set<string>>();
  const canon = new Map<string, string>();
  for (const { p } of per) if (p) for (const { data } of p.items) {
    if (!parent.has(data.c)) parent.set(data.c, data.p || '');
    if (data.r) canon.set(data.r, data.c);
    if (data.p) { if (!children.has(data.p)) children.set(data.p, new Set()); children.get(data.p)!.add(data.c); }
  }
  const counts = new Map<string, number>();
  const formats = new Map<string, Format>();          // each counter's latest sample
  const reset = (c: string, seen = new Set<string>()) => {
    for (const k of children.get(c) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k); counts.set(k, 0); reset(k, seen);
    }
  };
  /** a counter's full number now; `style` overrides its own style (as a child's sample shows it) */
  const counterNumber = (c: string, style?: Style, depth = 0): string => {
    const f = formats.get(c) ?? { style: 'arabic' as Style, head: '' };
    const own = fmt(counts.get(c) ?? 0, style ?? f.style);
    return withParent(c, f.head, own, depth);
  };
  const withParent = (c: string, head: string, own: string, depth: number): string => {
    const p = parent.get(c);
    if (!p || depth > 8) return head + own;
    const m = parentMark(head);
    if (!m) return head + own;                         // reset by the parent, but not prefixed
    return counterNumber(p, m.style, depth + 1) + head.slice(m.at + m.len) + own;
  };
  const parentNumber = (c: string, head: string): string => {
    const p = parent.get(c);
    const m = p ? parentMark(head) : null;
    return p && m ? counterNumber(p, m.style, 1) : '';
  };

  // number every item, in document order
  const items: Item[] = [];
  const labels = new Map<string, LabelInfo>();
  const definedBy = new Map<string, Set<string>>();    // label -> distinct definitions
  const refsByBlock: Record<string, string[]> = {};
  let current: Item | null = null;                     // \@currentlabel's item
  const restated: { inst: Instance; number: string }[] = [];
  const hasChapter = parent.has('chapter') || [...parent.values()].includes('chapter');
  for (const { entry, p } of per) {
    // what the source does to counters where the block starts
    const scan = entry.source !== undefined ? scanSource(entry.source) : null;
    if (scan?.appendix) {
      for (const c of hasChapter ? ['chapter', 'section'] : ['section', 'subsection']) counts.set(c, 0);
    }
    for (const op of scan?.counters ?? []) {
      const c = canon.get(op.counter) ?? op.counter;
      counts.set(c, (op.op === 'set' ? 0 : counts.get(c) ?? 0) + op.value);
    }
    if (!p || recallOf.has(entry.id)) continue;
    const atStart = current;
    const bySerial = new Map<number, Item>();
    const restatedK = new Map<string, number>();
    for (const { data, inst } of p.items) {
      if (data.R) {                                    // in a restated copy: the original's number, no step
        const key = `${data.R}/${data.c}`;
        const k = restatedK.get(key) ?? 0;
        restatedK.set(key, k + 1);
        const th = items.find((x) => x.data.L.some((r) => r.l === data.R));
        const orig = th ? items.filter((x) => x.blockId === th.blockId && x.data.c === data.c && x.index > th.index && !x.data.R)[k] : undefined;
        restated.push({ inst, number: orig?.number ?? texToText(data.t).trim() });
        continue;
      }
      counts.set(data.c, (counts.get(data.c) ?? 0) + 1);
      reset(data.c);
      const f = readSample(data.f);
      formats.set(data.c, f);
      const value = counts.get(data.c)!;
      const it: Item = { data, inst, blockId: entry.id, number: withParent(data.c, f.head, fmt(value, f.style), 0),
        value, prefix: parentNumber(data.c, f.head), index: items.length };
      items.push(it); bySerial.set(data.s, it); current = it;
    }
    for (const r of p.labels) {
      let info: LabelInfo;
      const cref: CrefData = { k: r.k, n: r.n, fc: r.fc, fC: r.fC, lf: r.lf };
      const it = r.s > 0 ? bySerial.get(r.s) : undefined;
      if (it) {
        info = { label: r.l, number: it.number, name: headName(it.data), counter: it.data.c, value: it.value, prefix: it.prefix, blockId: entry.id, cref };
      } else if (r.s === 0) {                          // before any number in this block
        info = { label: r.l, number: atStart?.number ?? '', name: atStart ? headName(atStart.data) : '', counter: atStart?.data.c ?? '',
          value: atStart?.value ?? 0, prefix: atStart?.prefix ?? '', blockId: atStart?.blockId ?? null, cref };
      } else {                                         // a counter the overlay does not run: TeX's value
        info = { label: r.l, number: texToText(r.t).trim(), name: NAMES[r.c] ?? capital(r.c), counter: '', value: 0, prefix: '', blockId: entry.id, cref };
      }
      if (!definedBy.has(r.l)) definedBy.set(r.l, new Set());
      definedBy.get(r.l)!.add(`${entry.id}#${r.s}`);
      labels.set(r.l, info);                           // the last definition wins, as in LaTeX
    }
    refsByBlock[entry.id] = [...new Set([...p.refs].flatMap(refLabels))];
  }

  // set the numbers (a recall's: the original's, item by item)
  const set = (inst: Instance, text: string) => {
    // mirrored: the number shows in every view of the block (split view's second pane), those mounted later too
    if (shown.get(inst) !== text) { try { inst.setText(text, { mirror: true }); shown.set(inst, text); } catch { /* block gone */ } }
  };
  for (const it of items) set(it.inst, it.number);
  for (const r of restated) set(r.inst, r.number);
  for (const { entry, p } of per) {
    const orig = p && recallOf.get(entry.id);
    if (!orig) continue;
    // item by item, per counter (a recompiled recall has no head number of its own: that is a reference)
    const queue = new Map<string, Item[]>();
    for (const it of items) if (it.blockId === orig) { if (!queue.has(it.data.c)) queue.set(it.data.c, []); queue.get(it.data.c)!.push(it); }
    for (const { data, inst } of p!.items) {
      const src = queue.get(data.c)?.shift();
      if (src) set(inst, src.number);
    }
    refsByBlock[entry.id] = [...new Set([...p!.refs].flatMap(refLabels))];
  }
  // and every reference any block holds
  const get = (l: string) => labels.get(l);
  const refs: Record<string, string> = {};
  for (const { p } of per) if (p) for (const name of p.refs) refs[name] = refText(name, get);
  if (o.slots === 'instances') {
    // per instance: the names this caller set on the page before are given back first (null: TeX's default)
    if (host) for (const name of [...byName.keys()]) { host.setText(name, null); byName.delete(name); }
    for (const { p } of per) if (p) for (const { name, inst } of p.refInsts) set(inst, refs[name]);
  } else if (host) for (const [name, text] of Object.entries(refs)) {
    if (byName.get(name) !== text) { host.setText(name, text); byName.set(name, text); }
  }

  last = {
    items: items.map((it) => ({ blockId: it.blockId, counter: it.data.c, raw: it.data.r ?? it.data.c, head: it.data.h, number: it.number,
      value: it.value, labels: it.data.L.map((r) => r.l) })),
    labels: Object.fromEntries(labels),
    refs,
    refsByBlock,
    duplicates: [...definedBy].filter(([l, d]) => d.size > 1 && !l.startsWith('thmt@@')).map(([l]) => l),
    mounted: per.filter((x) => x.p).map((x) => x.entry.id),
    runs: last.runs + 1,
  };
  for (const fn of listeners) { try { fn(last); } catch (e) { console.error(e); } }
  return last;
}

function headName(d: NumData): string {
  // a theorem's head is its name ("Lemma"); a section's or an equation's, the counter
  return d.h && d.h !== d.c && d.h !== d.r ? texToText(d.h) : NAMES[d.c] ?? capital(d.c);
}
export function refText(name: string, get: (l: string) => LabelInfo | undefined): string {
  const kind = name.slice(0, 4);
  const ls = refLabels(name);
  if (kind === 'rtxc') return crefText(ls, false, get);
  if (kind === 'rtxC') return crefText(ls, true, get);
  const l = get(ls[0] ?? '');
  if (kind === 'rtxa') return autorefText(l);
  return l ? l.number : '??';                      // rtxr: \ref, \eqref (its parentheses are TeX's)
}

export function numberingState(): NumberingState { return last; }
