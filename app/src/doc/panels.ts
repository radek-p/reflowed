// THE PANELS' DATA: what the sidebar's Outline, Problems and TODOs show
// of a document, as plain values computed from the document, its refs state and its results. No DOM, Node-testable
// (tests/test-doc-units.ts); app/panels.ts publishes these as the document's panel lists, and the panels' Components
// (outline/view.ts, sidebar/views.ts) draw them in whichever container hosts them.
//
//   outlineOf(src)          [{ id, level, number, title, special?, appendix }]: the headings in order, numbered by the
//                           refs' numbers when known, else counted here (\appendix switches to letters)
//   diagnosticsOf(src)      [{ kind, blockId, message, line?, offset?, key? }]: preamble and TeX errors, undefined
//                           references, unknown citations, duplicate and unused labels
//   todosOf(src)            [{ …a \todo, blockId }]: \todo and the preamble's own todo macros, in document order
//   labelsOf(src) · bibOf(src)   the labels (the refs' when they have any, else scanned) and the bibliography
//   sectionBlocks(blocks, items, it)   the ids of a section's blocks: its heading's to the next of its level or higher
//   PROBLEM_GROUPS          the Problems list's groups, in order
import { scanHeadings, scanLabels, scanTodos, todoMacros } from '../tex/texscan.js';

export interface Block { id: string; kind: string; source: string }
export interface Label { name: string; blockId: string; offset?: number; number?: string; refname?: string; counter?: string; title?: string }
export interface Use { blockId: string; cmd: string; keys: string[]; offset?: number }
export interface BibEntry { key: string; label?: string; year?: string; authors?: string[]; title?: string; venue?: string }
export interface RefsState {
  labels?: Record<string, Label>;
  refs?: Use[];
  cites?: Use[];
  bib?: Record<string, BibEntry>;
  numbers?: Record<string, { heading?: { number: string; level: number } }>;
  duplicates?: string[];
}
export interface Problem { line?: number; message: string }
/** a document's sources for the panels' data */
export interface PanelSource {
  blocks: Block[];
  preamble: string;
  refs: RefsState;
  /** the theorem environments (labels' kinds) */
  thmSet?: Set<string> | null;
  /** the preamble's problems */
  preambleProblems?: Problem[];
  /** a block's TeX result, when it has one */
  resultOf?: (b: Block) => { status?: string; errors?: Problem[] } | null | undefined;
  /** entries the References pane adds (a .bib, a bibtex .bbl's \bibitem's) */
  extraBib?: Record<string, BibEntry> | null;
}
/** kind: a part or a chapter (the crumb names it: "Go to chapter: 2 …"); a section has none */
export interface OutlineItem { id: string; level: number; number: string; title: string; appendix: boolean; special?: boolean; kind?: 'Part' | 'Chapter' }
export type ProblemKind = 'error' | 'undefined-ref' | 'unknown-cite' | 'duplicate-label' | 'unused-label';
export interface Diagnostic { kind: ProblemKind; blockId: string | null; message: string; line?: number; offset?: number; key?: string }
export interface Todo { blockId: string; cmd: string; offset: number; length: number; author: string; text: string; inline: boolean }

const ALPH = (n: number) => (n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n));

export const PROBLEM_GROUPS: [ProblemKind, string][] = [
  ['error', 'Errors'], ['undefined-ref', 'Undefined references'], ['unknown-cite', 'Unknown citations'],
  ['duplicate-label', 'Duplicate labels'], ['unused-label', 'Unused labels'],
];

export function labelsOf(s: PanelSource): Record<string, Label> {
  if (Object.keys(s.refs.labels ?? {}).length) return s.refs.labels ?? {};
  const out: Record<string, Label> = {};
  for (const b of s.blocks) for (const l of scanLabels(b.source, b.kind, s.thmSet ?? null) as Label[]) out[l.name] ??= { ...l, blockId: b.id, number: '' };
  return out;
}

/** the bibliography: the refs' (the .bbl entries and the \bibitem entries of any block), the References pane's under it */
export function bibOf(s: PanelSource): Record<string, BibEntry> {
  return s.extraBib ? { ...s.extraBib, ...(s.refs.bib ?? {}) } : s.refs.bib ?? {};
}

export function outlineOf(s: PanelSource): OutlineItem[] {
  const out: OutlineItem[] = [];
  const cnt = [0, 0, 0, 0, 0];
  const labels = labelsOf(s);
  const refText = (k: string) => { const l = labels[k]; return l ? `${l.refname ?? ''}${l.number ? ` ${l.number}` : ''}`.trim() || k : '??'; };
  let appendix = false;
  for (const b of s.blocks) {
    if (b.kind === 'abstract') { out.push({ id: b.id, level: 1, number: '', title: 'Abstract', appendix, special: true }); continue; }
    if (b.kind === 'bibliography') { out.push({ id: b.id, level: 1, number: '', title: 'References', appendix, special: true }); continue; }
    for (const hd of scanHeadings(b.source, refText) as { level: number; cmd?: string; title: string; star?: boolean; appendix?: boolean }[]) {
      if (hd.appendix) { appendix = true; cnt.fill(0); continue; }
      if (hd.level > 3) continue;                       // \paragraph: not in the outline
      const lv = Math.max(1, hd.level);
      let number = '';
      if (!hd.star && lv <= 3) {
        cnt[lv]++;
        for (let k = lv + 1; k < cnt.length; k++) cnt[k] = 0;
        const top = appendix ? ALPH(cnt[1]) : String(cnt[1]);
        number = [top, ...cnt.slice(2, lv + 1)].join('.');
      }
      const known = s.refs.numbers?.[b.id]?.heading;
      if (known?.number && known.level === lv) number = known.number;
      const kind = hd.cmd === 'part' ? 'Part' : hd.cmd === 'chapter' ? 'Chapter' : undefined;
      out.push({ id: b.id, level: lv, number, title: hd.title || '(untitled)', appendix, ...(kind ? { kind } : {}) });
    }
  }
  return out;
}

export function diagnosticsOf(s: PanelSource): Diagnostic[] {
  const st = s.refs;
  const out: Diagnostic[] = [];
  for (const p of s.preambleProblems ?? []) out.push({ kind: 'error', blockId: null, message: `Preamble: ${p.message}`, line: p.line });
  for (const b of s.blocks) {
    const r = s.resultOf?.(b);
    if (r?.status === 'error') for (const p of r.errors ?? []) out.push({ kind: 'error', blockId: b.id, message: p.message, line: p.line });
  }
  const labels = labelsOf(s);
  const used = new Set<string>();
  for (const r of st.refs ?? []) {
    for (const key of r.keys) {
      used.add(key);
      if (!labels[key]) out.push({ kind: 'undefined-ref', blockId: r.blockId, message: `\\${r.cmd}{${key}}: no such label`, offset: r.offset, key });
    }
  }
  const bib = bibOf(s);
  if (Object.keys(bib).length || s.blocks.some((b) => b.kind === 'bibliography')) {
    for (const cu of st.cites ?? []) for (const key of cu.keys) if (!bib[key] && key !== '*') out.push({ kind: 'unknown-cite', blockId: cu.blockId, message: `\\${cu.cmd}{${key}}: not in the bibliography`, offset: cu.offset, key });
  }
  for (const name of st.duplicates ?? []) {
    for (const b of s.blocks) {
      const off = b.source.indexOf(`\\label{${name}}`);
      if (off >= 0) out.push({ kind: 'duplicate-label', blockId: b.id, message: `\\label{${name}} is defined more than once`, offset: off, key: name });
    }
  }
  for (const [name, l] of Object.entries(labels)) if (!used.has(name)) out.push({ kind: 'unused-label', blockId: l.blockId, message: `\\label{${name}} is never referenced`, offset: l.offset, key: name });
  return out;
}

export function todosOf(s: Pick<PanelSource, 'blocks' | 'preamble'>): Todo[] {
  const macros = todoMacros(s.preamble);
  return s.blocks.flatMap((b) => (scanTodos(b.source, macros) as Omit<Todo, 'blockId'>[]).map((t) => ({ ...t, blockId: b.id })));
}

/** the blocks of a section: its heading's block up to the next heading of level <= its level */
export function sectionBlocks(blocks: Block[], items: OutlineItem[], it: OutlineItem): string[] {
  const index = (id: string) => blocks.findIndex((b) => b.id === id);
  const from = index(it.id);
  const k = items.indexOf(it);
  const next = items.slice(k + 1).find((x) => x.level <= it.level && index(x.id) > from);
  const to = next ? index(next.id) : blocks.length;
  return blocks.slice(from, to).map((b) => b.id);
}
