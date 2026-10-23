// refsState(): the document's labels, references, citations, numbers and
// bibliography, for the outline, label/ref and cite autocomplete
// and diagnostics. The shape is (contracts.d.ts RefsState);
// fields beyond it are marked "extra".
//
// It joins the overlay's last run (numbers of the blocks shown) with a scan of
// every block's source (labels, references and citations of blocks not
// compiled yet, offsets for the editor) and the parsed .bbl.
import { crefOne } from './cref.ts';
import type { NumberingState } from './numbering.ts';
import { scanSource } from './scan.ts';
import { texToText } from './tex-text.ts';
import { nameText, type Bbl } from '../bib/bbl.ts';
import { bibitemsOf, bibitemFields } from '../bib/bibitems.ts';

type ULID = string;
export interface LabelInfo {
  name: string;
  blockId: ULID | null;
  counter: string;                 // "lemma", "section", "equation" (the environment or counter LaTeX stepped)
  number: string;                  // "3.2" ("" until numbered)
  refname: string;                 // cleveref's name: "Lemma"
  title?: string;                  // a heading's text, a theorem's optional note
  offset?: number;                 // where \label{ starts in the block's source
  /** extra: how \Cref prints it ("Lemma 3.2"), '' until numbered */
  text?: string;
  /** extra: 'overlay' (numbered from a compiled block) or 'source' (seen in a source only) */
  from?: 'overlay' | 'source';
}
export interface RefUse { blockId: ULID; cmd: string; keys: string[]; offset: number; length: number }
export interface CiteUse { blockId: ULID; cmd: string; keys: string[]; offset: number; length: number }
export interface BibEntry {
  key: string; label?: string; type?: string; authors?: string[]; title?: string; year?: string; venue?: string;
  fields?: Record<string, string>;
}
export interface BlockNumbers {
  heading?: { level: number; number: string; title: string; appendix?: boolean };
  items: { counter: string; number: string; head: string; labels: string[] }[];
}
export interface Diagnostic {
  kind: 'undefined-ref' | 'duplicate-label' | 'unused-label' | 'unknown-cite';
  blockId: ULID | null;
  message: string;
  offset?: number;
  key: string;
}
export interface RefsState {
  rev: number;
  labels: Record<string, LabelInfo>;
  refs: RefUse[];
  cites: CiteUse[];
  bib: Record<string, BibEntry>;
  numbers: Record<ULID, BlockNumbers>;
  duplicates: string[];
  /** extra: undefined refs, duplicate/unused labels, unknown cite keys */
  diagnostics: Diagnostic[];
  /** extra: cite keys used but not in the .bbl */
  unknownCites: string[];
  /** extra: blocks with source but no render: their numbers did not count yet */
  pending: ULID[];
  /** extra: every reference slot's text ("rtxC:lem:a" -> "Lemma 3.1") */
  refTexts: Record<string, string>;
}
export interface RefsBlock { id: ULID; kind?: string; source: string }

const internal = (l: string) => l.startsWith('thmt@@');
export const HEADING_LEVEL: Record<string, number> = { part: -1, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };

const unTeX = (s: string) => s.replace(/\\([_%&#$~])/g, '$1');
export function bibEntries(bbl: Bbl | null): Record<string, BibEntry> {
  const out: Record<string, BibEntry> = {};
  if (!bbl) return out;
  for (const e of bbl.entries) {
    out[e.key] = {
      key: e.key, label: e.label, type: e.type, authors: (e.names.author ?? e.names.editor ?? []).map(nameText),
      title: e.card.title, year: e.card.year, venue: e.card.venue,
      // a DOI or URL as TeX wrote it (10.1007/x\_19): its characters, for a link
      fields: { ...(e.card.doi ? { doi: unTeX(e.card.doi) } : {}), ...(e.card.url ? { url: unTeX(e.card.url) } : {}), ...(e.card.eprint ? { eprint: e.card.eprint } : {}) },
    };
  }
  return out;
}

export function buildRefsState(blocks: RefsBlock[], num: NumberingState, bbl: Bbl | null, rev: number,
  recallOf: Map<ULID, ULID> = new Map(), bblText: string | null = null): RefsState {
  const labels: Record<string, LabelInfo> = {};
  const defs = new Map<string, { blockId: ULID; offset: number }[]>();
  const refs: RefUse[] = [];
  const cites: CiteUse[] = [];
  const numbers: Record<ULID, BlockNumbers> = {};
  const mounted = new Set(num.mounted);
  const itemsBy = new Map<string, NumberingState['items']>();
  for (const it of num.items) { if (!itemsBy.has(it.blockId)) itemsBy.set(it.blockId, []); itemsBy.get(it.blockId)!.push(it); }
  let appendix = false;
  for (const b of blocks) {
    const sc = scanSource(b.source);
    if (sc.appendix) appendix = true;
    const recall = recallOf.has(b.id);
    if (!recall) for (const { label, env, offset } of sc.labels) {
      if (internal(label)) continue;
      if (!defs.has(label)) defs.set(label, []);
      defs.get(label)!.push({ blockId: b.id, offset });
      if (!labels[label]) {
        const heading = sc.headings.find((h) => h.label === label);
        const thm = sc.envs.filter((e) => e.offset < offset).pop();
        labels[label] = { name: label, blockId: b.id, counter: heading?.level ?? env ?? '', number: '', refname: '', offset, from: 'source',
          ...(heading ? { title: texToText(heading.title).trim() } : thm?.note ? { title: texToText(thm.note).trim() } : {}) };
      }
    }
    for (const u of sc.refs) refs.push({ blockId: b.id, ...u });
    for (const u of sc.cites) cites.push({ blockId: b.id, ...u });
    const its = itemsBy.get(b.id) ?? [];
    const bn: BlockNumbers = { items: its.map((it) => ({ counter: it.raw, number: it.number, head: it.head, labels: it.labels.filter((l) => !internal(l)) })) };
    const h0 = sc.headings.find((h) => !h.starred) ?? sc.headings[0];
    if (h0) {
      const it = its.find((x) => x.counter in HEADING_LEVEL);
      bn.heading = { level: HEADING_LEVEL[h0.level] ?? 1, number: !h0.starred && mounted.has(b.id) ? it?.number ?? '' : '', title: texToText(h0.title).trim(), appendix };
    }
    numbers[b.id] = bn;
  }
  // the overlay's numbers win for compiled blocks
  const get = (l: string) => num.labels[l];
  for (const [l, info] of Object.entries(num.labels)) {
    if (internal(l)) continue;
    const it = num.items.find((x) => x.labels.includes(l));
    const prev = labels[l];
    const upper = info.cref.n?.[2] ? texToText(info.cref.n[2]) : info.name;
    labels[l] = {
      name: l, blockId: info.blockId ?? prev?.blockId ?? null,
      counter: it?.raw ?? (info.cref.k || prev?.counter || info.name.toLowerCase()),
      number: info.number, refname: upper, offset: prev?.offset, from: 'overlay',
      text: crefOne(get(l)!, true),
      ...(prev?.title ? { title: prev.title } : {}),
    };
  }
  // labels only in sources: the refname from the environment (the preamble's theorem names come with a compile)
  for (const l of Object.values(labels)) if (!l.refname) l.refname = l.counter ? l.counter.charAt(0).toUpperCase() + l.counter.slice(1) : '';

  const duplicates = new Set(num.duplicates.filter((l) => !internal(l)));
  for (const [l, where] of defs) if (where.length > 1) duplicates.add(l);
  const diagnostics: Diagnostic[] = [];
  const used = new Set<string>();
  for (const r of refs) for (const k of r.keys) {
    used.add(k);
    if (!labels[k] && !internal(k)) diagnostics.push({ kind: 'undefined-ref', blockId: r.blockId, message: `\\${r.cmd}{${k}}: no such label`, offset: r.offset, key: k });
  }
  for (const l of duplicates) for (const d of defs.get(l) ?? []) diagnostics.push({ kind: 'duplicate-label', blockId: d.blockId, message: `\\label{${l}} is defined more than once`, offset: d.offset, key: l });
  for (const [l, where] of defs) if (!used.has(l)) diagnostics.push({ kind: 'unused-label', blockId: where[0].blockId, message: `\\label{${l}} is never referenced`, offset: where[0].offset, key: l });
  // the \bibitem[label]{key}s of a bibtex .bbl (a thebibliography) and of thebibliography blocks
  // join the biblatex .bbl's entries, numbered as LaTeX numbers them
  const bib = bibEntries(bbl);
  for (const it of bibitemsOf([bblText, ...blocks.map((b) => b.source)]).values()) {
    if (bib[it.key]) continue;
    const f = bibitemFields(it.body);
    bib[it.key] = { key: it.key, label: it.opt !== null ? texToText(it.opt).trim() : it.label, type: 'bibitem',
      ...(f.author ? { authors: f.author.split(' and ').map((a) => texToText(a).trim()) } : {}),
      ...(f.title ? { title: texToText(f.title).trim() } : {}), ...(f.year ? { year: f.year } : {}),
      ...(f.journal ? { venue: texToText(f.journal).trim() } : {}),
      ...(f.doi || f.url ? { fields: { ...(f.doi ? { doi: unTeX(f.doi) } : {}), ...(f.url ? { url: unTeX(f.url) } : {}) } } : {}) };
  }
  const unknown = new Set<string>();
  if (Object.keys(bib).length) for (const c of cites) for (const k of c.keys) {
    if (bib[k]) continue;
    unknown.add(k);
    diagnostics.push({ kind: 'unknown-cite', blockId: c.blockId, message: `\\${c.cmd}{${k}}: not in the bibliography`, offset: c.offset, key: k });
  }
  return {
    rev, labels, refs, cites, bib, numbers, duplicates: [...duplicates], diagnostics, unknownCites: [...unknown],
    pending: blocks.filter((b) => !mounted.has(b.id) && b.source.trim() && !['macros', 'comment', 'appendix'].includes(b.kind ?? '')).map((b) => b.id),
    refTexts: num.refs,
  };
}
