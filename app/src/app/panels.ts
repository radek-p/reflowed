// A document's side panels' data and what the source editor asks of references (one per document editor: app/app.js).
//   Outline   headings in order, numbered (refs' numbers, else counted: \appendix switches to letters)
//   Problems  errors, what the viewer logged (in the preview: doc/viewer-log.ts), undefined references, unknown
//             citations, duplicate and unused labels
//   TODOs \todo and the preamble's macros on it, by author
//   the word count under them (and at the foot of its panes' end space: docview/end-space.ts)
//   labelOptions / citeOptions (completion), hoverCard, marksFor
//
// The panels themselves are registered views with Components (outline/index.ts,
// sidebar/index.ts) that draw the CURRENT document's lists in whichever container hosts them. This module computes
// the lists (the data: doc/panels.ts) and publishes them as its PanelHost (app/panel-host.ts); while its document is
// the container's current one (c.active()), the container's root.state.panels is that host (app.js activate()). It
// draws nothing.
//
//   const panels = createPanels(c)
//   panels.host · panels.refresh() · panels.setTab(name) · panels.outline() · panels.diagnostics() · panels.todos()
//   panels.problems() (the last list) · panels.activeId() · panels.locator(id) · panels.labelOptions(cmd)
//   panels.citeOptions() · panels.hoverCard(k) · panels.marksFor(blockId, text) · panels.flushPreamble() · panels.dispose()
import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { scanRefs, scanCites, texToText } from '../tex/texscan.js';
import { view, slotsOf } from '../design/ui/views.ts';   // the sidebar's tabs as views (the container's)
import { showWordCount } from '../chrome/sidebar-chrome.ts';             // the word count footer
import { html, render } from '../design/ui/core.js';                  // the hover card
import { outlineOf, diagnosticsOf, todosOf, labelsOf, bibOf, PROBLEM_GROUPS,
  type Block, type BibEntry, type Diagnostic, type OutlineItem, type PanelSource, type Problem, type RefsState, type Todo } from '../doc/panels.ts';
import { viewerLog } from '../doc/viewer-log.ts';                 // the viewer's log as problems (one per page)
import type { EditorRoot } from './editor-root.ts';
import type { Commands, PanelHost, PreambleHost } from './panel-host.ts';
import type { PreambleError, WordCount } from './page-state.ts';

const AUTHOR_COLOURS = ['#2383e2', '#0f9d58', '#b35c00', '#8a3ea3', '#d44c47', '#3558a8', '#1d7a55'];

interface Doc { id: string; blocks: Block[]; preamble: { source: string } }
/** what a document editor gives its panels (app/app.js) */
export interface PanelsContext {
  root: EditorRoot;
  readonly doc: Doc | null;
  refs: { refsState(): RefsState };
  ui: Map<string, { cls(name: string, on: boolean): void }>;
  cache: Map<string, { status?: string; errors?: Problem[] }>;
  ck(b: Block): string;
  /** fn reads every block's key: what the keys depend on read once (doc/derived.js pass) */
  pass?<T>(fn: () => T): T;
  active?(): boolean;
  commands: Commands;
  /** the section in view in the focused pane (a signal read: the crumbs' own, docview/pane-bar.js keeps it) */
  inView?(): OutlineItem | null;
  /** the focused pane's section focus (its heading's id, null: none) */
  focusedSection?(): string | null;
  preambleProblems(): Problem[];
  words: Signal<WordCount | null>;
  thmSet(): Set<string> | null;
  counts(): WordCount;
  indexOf(id: string): number;
  /** the document's title (a signal: the editor's) */
  title: ReadonlySignal<string>;
  /** its preamble: its problems (doc/results.js), whether it can change, a change (one undo step) */
  preamble: { errors: ReadonlySignal<PreambleError[]>; readOnly(): boolean; apply(text: string): void } | null;
  /** the bibliography in a few words (app/doc-meta.ts) */
  bibInfo(): string;
  noteColour?: ((author: string) => string | undefined) | null;
  extraBib?: (() => Record<string, BibEntry> | null) | null;
  problemAction?: ((p: Diagnostic) => HTMLElement | null) | null;
  problemReport?: ((blockId: string | null, tex: Problem & { severity?: string }) => string) | null;
  /** the page's viewer log (doc/viewer-log.ts) kept something new: the editor's refresh (refresh() soon) */
  previewChanged?: (() => void) | null;
  files?: PanelHost['files'];
}

export function createPanels(c: PanelsContext) {
  const { refs, root } = c;
  const slots = slotsOf(root);
  const isActive = () => c.active?.() ?? true;
  // ── tabs ───────────────────────────────────────────────────────────────────
  // every panel's list is filled on every refresh, its tab's count from the same values (one source: a panel shown
  // anywhere, in any column, draws what its badge counts); which panel is shown is its container's. setTab(name) asks
  // the container to show that panel (slots.show).
  const setTab = (name: string) => { if (view(name)) slots.show(name); };
  const unPreview = c.previewChanged ? viewerLog()?.subscribe(c.previewChanged) ?? null : null;

  const doc = () => c.doc;
  const state = (): RefsState => { try { return refs.refsState(); } catch { return { labels: {}, refs: [], cites: [], bib: {}, numbers: {}, duplicates: [] }; } };
  const source = (): PanelSource => {
    const d = doc();
    return { blocks: d?.blocks ?? [], preamble: d?.preamble.source ?? '', refs: state(), thmSet: c.thmSet(), preambleProblems: c.preambleProblems(),
      resultOf: (b) => c.cache.get(c.ck(b)), extraBib: c.extraBib?.() ?? null,
      // what the viewer logged of each block's result (by its compile key) and of the page
      previewOf: (b: Block) => viewerLog()?.problemsOf(c.ck(b)) ?? [], pagePreview: viewerLog()?.pageProblems() ?? [] };
  };
  // the outline memoised: it was made again from every source on each scroll frame (the pane
  // bar's section in view: 10 ms at 600 blocks). Kept while every block is the same object with the same kind and
  // source, and the refs state (numbers, labels) and the theorem set are the same objects (both are replaced, not
  // changed in place, when they change).
  let outlineRuns = 0;                      // (tests) how many times the outline was made
  let outlineMemo: { rows: { b: unknown; kind: unknown; src: string }[]; refs: RefsState; thm: unknown; items: OutlineItem[] } | null = null;
  const outline = (): OutlineItem[] => {
    const d = doc();
    if (!d) return [];
    const st = state(), thm = c.thmSet(), bl = d.blocks as { kind?: unknown; source: string }[], m = outlineMemo;
    if (m && m.refs === st && m.thm === thm && m.rows.length === bl.length && m.rows.every((r, i) => r.b === bl[i] && r.kind === bl[i]!.kind && r.src === bl[i]!.source)) return m.items;
    const items = outlineOf(source());
    outlineRuns++;
    outlineMemo = { rows: bl.map((b) => ({ b, kind: b.kind, src: b.source })), refs: st, thm, items };
    return items;
  };
  // every block's result: one pass over their keys
  const diagnostics = (): Diagnostic[] => {
    if (!doc()) return [];
    const all = () => diagnosticsOf(source());
    return c.pass ? c.pass(all) : all();
  };
  const todos = (): Todo[] => { const d = doc(); return d ? todosOf({ blocks: d.blocks, preamble: d.preamble.source }) : []; };

  /** Where a block is, in words: "§2.1 · Lemma" / its first words. */
  function locator(blockId: string, items: OutlineItem[] = outline()): string {
    const d = doc();
    const i = c.indexOf(blockId);
    if (!d || i < 0) return '';
    let sec: OutlineItem | null = null;
    for (const it of items) { if (c.indexOf(it.id) <= i && it.level >= 1) sec = it; }
    const b = d.blocks[i];
    const words = texToText(b.source.replace(/\\begin\{[^}]*\}(\[[^\]]*\])?|\\end\{[^}]*\}/g, ' ')).slice(0, 48);
    return `${sec ? `${sec.number ? `§${sec.number}` : sec.title.slice(0, 18)} · ` : ''}${words || b.kind}`;
  }

  // ── the lists (the panels' data) and the host the panels follow ──────────────
  // the active row: the focused pane's section in view, the one the crumbs show (one rule for both: docview/in-view.ts;
  // a jump's target stands until the reader scrolls)
  const lists = { outline: signal<OutlineItem[]>([]), problems: signal<Diagnostic[]>([]), todos: signal<Todo[]>([]),
    active: computed<string | null>(() => c.inView?.()?.id ?? null) };

  const report = c.problemReport ? (p: Diagnostic) => reportOf(p) : null;
  // the preamble and the bibliography as the Settings panel shows them (their values set by refresh(), as the lists)
  const preSource = signal(''), bibInfo = signal('');
  let draft: string | null = null;
  const pre = c.preamble;
  const preamble: PreambleHost | null = pre ? {
    problems: computed(() => pre.errors.value.length), errors: pre.errors, source: preSource, readOnly: pre.readOnly,
    blocks: () => doc()?.blocks.length ?? 0,
    draft: (t) => { draft = t; },
    apply: (t) => { draft = null; if (!pre.readOnly() && t !== doc()?.preamble.source) pre.apply(t); },
  } : null;
  const host: PanelHost = {
    get docId() { return doc()?.id ?? null; },
    commands: c.commands,
    lists,
    blocks: () => doc()?.blocks ?? [],
    locators: () => { const items = outline(); return (id) => locator(id, items); },
    title: c.title,
    preamble,
    bibliography: { info: bibInfo, get openReferences() { return view('references') ? () => setTab('references') : null; } },
    groups: PROBLEM_GROUPS,
    report,
    problemAction: c.problemAction ?? null,
    colour: (a, authors) => c.noteColour?.(a) ?? AUTHOR_COLOURS[authors.indexOf(a) % AUTHOR_COLOURS.length],   // the chips' colour
    get files() { return c.files ?? null; },
    focusedSection: () => c.focusedSection?.() ?? null,
  };

  /** a problem of the list as a report: a TeX error with its own details (the block's result), else the message */
  function reportOf(p: Diagnostic): string {
    const d = doc();
    const b = p.blockId && d ? d.blocks[c.indexOf(p.blockId)] : null;
    const r = b ? c.cache.get(c.ck(b)) : null;
    const tex = p.kind === 'error' ? (b ? r?.errors : c.preambleProblems())?.find((e) => e.line === p.line && (e.message === p.message || p.message.endsWith(e.message))) : null;
    return c.problemReport?.(p.blockId ?? null, tex ?? { severity: p.level ?? 'error', message: p.message, line: p.line }) ?? p.message;
  }

  // ── Word count ─────────────────────────────────────────────────────────────
  // counted whether or not the document is the current one (its panes' end space shows it: docview/end-space.ts); the
  // footer shows the current one's
  function count() { if (doc()) c.words.value = c.counts(); }
  function drawCount() {
    if (!doc()) return;
    count();                                          // the footer is a Preact component (chrome/sidebar-chrome.ts)
    showWordCount(root, c.words);                     // this document's count is the one shown
  }

  // ── refresh ────────────────────────────────────────────────────────────────
  let lastProblems: Diagnostic[] = [];
  function refresh() {
    if (!doc()) return;
    const probs = diagnostics();
    lastProblems = probs;
    const nProb = probs.filter((x) => x.kind !== 'unused-label').length;
    const td = todos();
    if (!isActive()) { markers(probs, td); count(); return; }   // another document is the current one: its lists stay
    preSource.value = doc()!.preamble.source;
    bibInfo.value = c.bibInfo();
    // the tabs' counts: the views' badges (chrome/sidebar-chrome.ts draws them)
    slots.badge('problems').value = nProb ? { n: nProb, tone: probs.some((x) => x.kind === 'error' || x.level === 'error') ? 'danger' : undefined } : null;
    slots.badge('todos').value = td.length ? { n: td.length } : null;
    lists.outline.value = outline();
    lists.problems.value = probs;
    lists.todos.value = td;
    drawCount();
    markers(probs, td);
  }
  // per-block markers: the block's decor, in every pane
  function markers(probs: Diagnostic[], td: Todo[]) {
    const withProblem = new Set(probs.filter((x) => x.kind !== 'unused-label' && x.kind !== 'error' && x.blockId).map((x) => x.blockId));
    for (const [id, u] of c.ui) u.cls('has-problem', withProblem.has(id));
    const withTodo = new Set(td.map((t) => t.blockId));
    for (const [id, u] of c.ui) u.cls('has-todo', withTodo.has(id));
  }

  // ── what the source editor asks ────────────────────────────────────────────
  function labelOptions(cmd: string) {
    const labels = labelsOf(source());
    const d = doc();
    const order = new Map((d?.blocks ?? []).map((b, i) => [b.id, i]));
    return Object.values(labels)
      .sort((a, b) => (order.get(a.blockId) ?? 1e9) - (order.get(b.blockId) ?? 1e9) || (a.offset ?? 0) - (b.offset ?? 0))
      .map((l, k) => ({
        label: l.name,
        detail: `${l.refname ?? ''}${l.number ? ` ${l.number}` : ''}`,
        info: () => card({ type: 'ref', key: l.name }),
        boost: cmd === 'eqref' ? (l.counter === 'equation' ? 50 : -50) : -k / 1000,
        type: 'variable',
      }));
  }
  function citeOptions() {
    return Object.values(bibOf(source())).map((e) => ({
      label: e.key,
      detail: e.label && e.label !== e.key ? `[${e.label}]` : (e.year ?? ''),
      info: () => card({ type: 'cite', key: e.key }),
      type: 'text',
    }));
  }
  /** the hover card of a reference or a citation: a DOM element CodeMirror's tooltip shows (rendered by Preact) */
  function card(k: { type: 'ref' | 'cite'; key: string }) {
    const div = root.doc.createElement('div');
    div.className = 'hover-card';
    render(cardBody(k), div);
    return div;
  }
  function cardBody(k: { type: 'ref' | 'cite'; key: string }) {
    const s = source();
    if (k.type === 'ref') {
      const l = labelsOf(s)[k.key];
      if (!l) return html`<div class="hc-head bad">No label ${k.key}</div>`;
      const b = doc()?.blocks[c.indexOf(l.blockId)];
      return html`<div class="hc-head">${`${l.refname ?? l.counter}${l.number ? ` ${l.number}` : ''}${l.title ? ` · ${l.title}` : ''}`}</div>
        ${b ? html`<div class="hc-body">${texToText(b.source.replace(/\\begin\{[^}]*\}(\[[^\]]*\])?|\\end\{[^}]*\}/g, ' ')).slice(0, 180)}</div>` : null}
        <div class="hc-foot">${`\\label{${k.key}} · F12 to go there`}</div>`;
    }
    const e = bibOf(s)[k.key];
    if (!e) return html`<div class="hc-head bad">${k.key} is not in the bibliography</div>`;
    return html`<div class="hc-head">${`[${e.label ?? e.key}]${e.authors?.length ? ` ${e.authors.join(', ')}` : ''}`}</div>
      ${e.title ? html`<div class="hc-body">${`${e.title}${e.venue ? `. ${e.venue}` : ''}${e.year ? `, ${e.year}` : ''}.`}</div>` : null}
      <div class="hc-foot">${k.key}</div>`;
  }
  interface Ref { offset: number; length: number; keys: string[] }
  function marksFor(_blockId: string, text: string) {
    const s = source();
    const labels = labelsOf(s);
    const bib = bibOf(s);
    const checkCites = Object.keys(bib).length > 0;
    const out: { from: number; to: number; cls: string; title: string }[] = [];
    const keysIn = (r: Ref) => {
      const seg = text.slice(r.offset, r.offset + r.length);
      const open = seg.lastIndexOf('{', seg.lastIndexOf('}'));
      let at = r.offset + open + 1;
      // where each key the scan found stands (the scan's rule: a citation's `*` is every entry, never a key)
      return seg.slice(open + 1, seg.lastIndexOf('}')).split(',').map((part) => { const lead = part.length - part.trimStart().length; const k = { key: part.trim(), from: at + lead, to: at + lead + part.trim().length }; at += part.length + 1; return k; })
        .filter((k) => r.keys.includes(k.key));
    };
    for (const r of scanRefs(text) as Ref[]) for (const k of keysIn(r)) if (!labels[k.key]) out.push({ from: k.from, to: k.to, cls: 'cm-bad-ref', title: `No label ${k.key}` });
    if (checkCites) for (const r of scanCites(text) as Ref[]) for (const k of keysIn(r)) if (!bib[k.key]) out.push({ from: k.from, to: k.to, cls: 'cm-bad-ref', title: `${k.key} is not in the bibliography` });
    return out;
  }

  /** the preamble typed in the Settings panel and not applied yet: applied now (the document is closing) */
  function flushPreamble() { if (draft != null) preamble?.apply(draft); }
  /** the listeners this module added; the container stops showing its host */
  function dispose() {
    unPreview?.();
    if (root.state.panels.peek() === host) root.state.panels.value = null;
  }
  return { host, refresh, outline, outlineRuns: () => outlineRuns, diagnostics, todos, labelOptions, citeOptions, hoverCard: card, marksFor, setTab, locator: (id: string) => locator(id),   // the Files panel's "where"
    problems: () => lastProblems, activeId: () => lists.active.peek(), flushPreamble, dispose };
}
