// The gallery: the editor's own widgets apart from a document, from their real components with fixture data —
// note chips (every kind) and the note popover, the find bar (every count state), the citation, reference and link cards,
// a block's error rows and the live error note (the code popover's chrome) — the Settings panel's document tab (the
// preamble with problems, a read-only one, no document) and the title form's content (its conversion offer and the
// form) in a pane container instead of the modal Sheet (a view's content is apart from its container:
// design/ui/views.ts FrameContext).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { html, Tabs, FrameContext } from '../design/ui/index.js';
import { NoteChip, chipWidth } from '../notes/chip.js';
import { createNoteLayer } from '../notes/popover.js';
import { authorColour } from '../notes/colours.js';
import { installStyle as installNoteStyle } from '../notes/style.js';
import { mountFindBar } from '../chrome/find-bar.js';
import { CardContent, cardTitle } from '../refnav/card.js';
import { linkTitle } from '../refnav/rule.ts';
import { installStyle as installRefNavStyle } from '../refnav/style.js';
import { ErrorRows, LiveNote } from '../edit/panel.js';
import { DocumentSettings } from '../settings/document.ts';
import { installSettingsStyle } from '../settings/panel.ts';
import { TitleForm } from '../meta/form/sheet.js';
import { convertPreamble } from '../meta/import.ts';
import { testFixtureDocument } from '../app/test-fixture.js';
import { Section, Group, Cell, useInView } from './parts.ts';
import type { Gallery } from './main.ts';
import type { PreambleError } from '../app/page-state.ts';

// ── note chips ──
interface NoteInfo { from: 'todo' | 'comment' | 'figure'; author: string; colour: string; inline?: boolean }
const NOTES: { label: string; info: NoteInfo; text: string }[] = [
  { label: 'margin note, Editor', info: { from: 'todo', author: 'Editor', colour: authorColour('Editor') }, text: 'Say why size matters.' },
  { label: 'margin note, Referee', info: { from: 'todo', author: 'Referee', colour: authorColour('Referee') }, text: 'Cite the survey here.' },
  { label: 'two-word author', info: { from: 'todo', author: 'Ada Lovelace', colour: authorColour('Ada Lovelace') }, text: 'Check the constant.' },
  { label: 'inline note', info: { from: 'todo', author: 'Editor', colour: authorColour('Editor'), inline: true }, text: 'A shorter proof?' },
  { label: 'own colour', info: { from: 'todo', author: 'Referee', colour: '#c9a4f2' }, text: 'color=purple!40' },
  { label: 'authorless', info: { from: 'todo', author: '', colour: authorColour('') }, text: 'A note without an author.' },
  { label: 'comment', info: { from: 'comment', author: '', colour: authorColour('') }, text: 'TODO: the second case.' },
  { label: 'missing figure', info: { from: 'figure', author: '', colour: authorColour('') }, text: 'The naturality square.' },
];

function Chip({ n, fs, open, onToggle }: { n: typeof NOTES[number]; fs: number; open: boolean; onToggle?: (el: HTMLElement) => void }) {
  return html`<span class="gal-chip" style=${{ width: `${chipWidth(n.info, fs).toFixed(2)}px`, height: `${(0.94 * fs).toFixed(2)}px` }}>
    <${NoteChip} info=${n.info} label=${`${n.info.author || 'Note'}: ${n.text}`} fontSize=${fs} open=${open} onToggle=${onToggle} /></span>`;
}

function NoteChips() {
  const layer = useRef<ReturnType<typeof createNoteLayer> | null>(null);
  const first = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const seen = useInView(first);
  const show = (i: number, chip: HTMLElement) => {
    const n = NOTES[i];
    const x = scrollX, y = scrollY;      // the popover takes the focus: the page stays where it is
    layer.current?.show({ chip, info: n.info, title: `Note: ${n.text}`, mountText: () => null, fallback: n.text,
      actions: [{ id: 'edit', label: 'Edit', run: () => {} }, { id: 'resolve', label: 'Resolve', run: () => {} }], onClosed: () => setOpen(null) });
    scrollTo(x, y);
    setOpen(i);
  };
  useLayoutEffect(() => {
    installNoteStyle();
    layer.current = createNoteLayer();
    return () => layer.current?.hide({ focus: false });
  }, []);
  // the first chip's popover open while the chip is in the window
  useLayoutEffect(() => {
    const chip = first.current?.querySelector<HTMLElement>('.rtx-note-chip');
    if (seen && chip) show(0, chip); else layer.current?.hide({ focus: false });
  }, [seen]);
  const toggle = (i: number) => (el: HTMLElement) => { if (open === i) layer.current?.hide({ focus: false }); else show(i, el); };
  return html`<div class="gal-cells">
      ${NOTES.map((n, i) => html`<${Cell} label=${n.label}><span ref=${i === 0 ? first : null}><${Chip} n=${n} fs=${16} open=${open === i} onToggle=${toggle(i)} /></span><//>`)}
      <${Cell} label="at 150 %"><${Chip} n=${NOTES[0]} fs=${24} open=${false} /><//>
    </div>
    <p class="gal-note">The first chip's popover is open (the kit's Popover; a press elsewhere closes it, a chip opens it again). Its message is
      typeset by TeX in the editor; without the engine the popover shows the note's source text, as the editor does.</p>`;
}

// ── the find bar ──
type FindState = { label: string; q: string; repl?: string; opts: { caseSensitive: boolean; regex: boolean; word: boolean }; count: { text: string; kind: string } };
const FINDS: FindState[] = [
  { label: 'open, empty', q: '', opts: { caseSensitive: false, regex: false, word: false }, count: { text: '', kind: '' } },
  { label: 'matches, one current', q: 'functor', repl: 'Functor', opts: { caseSensitive: false, regex: false, word: true }, count: { text: '2 of 7 in 3 blocks', kind: '' } },
  { label: 'no matches', q: 'zebra', opts: { caseSensitive: true, regex: false, word: false }, count: { text: 'No matches', kind: 'none' } },
  { label: 'invalid pattern', q: '(functor', opts: { caseSensitive: false, regex: true, word: false }, count: { text: 'Invalid pattern', kind: 'error' } },
];
function FindBar({ s }: { s: FindState }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nop = () => {};
    const bar = mountFindBar(el, { input: nop, next: nop, replace: nop, replaceAll: nop, close: nop, toggle: nop }, s.opts);
    bar.model.visible.value = true;
    bar.model.count.value = s.count;
    // its inputs (the module's refs, typed loosely in its JavaScript)
    const inputs = bar as unknown as { find: HTMLInputElement | null; repl: HTMLInputElement | null };
    if (inputs.find) inputs.find.value = s.q;
    if (inputs.repl) inputs.repl.value = s.repl ?? '';
  }, []);
  return html`<div class="gal-find" ref=${ref}></div>`;
}

// ── the reference card ──
interface Entry { key: string; entry: { label?: string; authors?: string[]; title?: string; venue?: string; year?: string; fields?: { doi?: string; url?: string } } | null }
const CITE_ENTRIES: Entry[] = [
  { key: 'Obj23', entry: { label: 'Obj23', authors: ['A. Author'], title: 'Objects and arrows (a made-up reference)', venue: 'Journal of Tests', year: '2023', fields: { doi: '10.5555/test.2023.1' } } },
  { key: 'MO25', entry: { label: 'MO25', authors: ['Jan Doe', 'A. Author'], title: 'Morphisms, once more (a made-up reference)', venue: 'arXiv', year: '2025', fields: { url: 'https://arxiv.org/abs/2401.00001' } } },
  { key: 'Arr09', entry: null },
];
interface CardView { open: boolean; kind: 'ref' | 'cite' | 'link'; title: string; keys: string; go: { label: string; text: string }[]; actions: { id: string; text: string }[]; entries: Entry[] | null; source: string | null; address?: string | null; empty: string | null; hint: string }
const CARDS: { label: string; v: CardView }[] = [
  { label: 'a citation: its entries, one not in the bibliography', v: { open: true, kind: 'cite', title: 'Citation [Obj23, MO25, Arr09]', keys: '', go: [], source: null, empty: null, entries: CITE_ENTRIES,
    actions: [{ id: 'show-refs', text: 'Show in References' }, { id: 'goto-list', text: 'Go to the reference list' }], hint: '⌘-click: the reference list · click to edit' } },
  { label: 'a reference (its block\'s source: the typeset copy needs the engine)', v: { open: true, kind: 'ref', title: cardTitle({ counter: 'theorem', refname: 'Theorem', number: '3.1' }), keys: 'thm:main', entries: null, actions: [],
    go: [{ label: 'thm:main', text: 'Go to' }], empty: null, hint: '⌘-click to jump · click to edit',
    source: '\\begin{theorem}\\label{thm:main}\nFor a locally small category $\\mathcal{C}$, the Yoneda embedding\nof $\\mathcal{C}$ into its presheaves is full and faithful.\n\\end{theorem}' } },
  { label: 'an undefined reference', v: { open: true, kind: 'ref', title: cardTitle(null), keys: 'lem:gone', entries: null, actions: [], go: [], source: null,
    empty: 'No \\label{lem:gone} in the document.', hint: 'Click to edit the reference' } },
  { label: 'a link (\\url, \\href): its address', v: { open: true, kind: 'link', title: linkTitle('https://example.org/notes/yoneda'), keys: '', entries: null, go: [], source: null,
    address: 'https://example.org/notes/yoneda', actions: [{ id: 'open-link', text: 'Open link' }], empty: null, hint: '⌘-click to open · click to edit' } },
];
function RefCard({ v }: { v: CardView }) {
  return html`<div class="rn-card gal-static gal-card" role="dialog" aria-label=${v.title} data-kind=${v.kind}>
    <${CardContent} v=${v} onGo=${() => {}} onAction=${() => {}} bodyRef=${{ current: null }} /></div>`;
}

// ── a block's errors (the code popover's chrome) ──
const PROBLEMS = [{ line: 2, message: 'Undefined control sequence \\dsit.', detail: '' }, { line: 4, message: 'Missing $ inserted.', detail: '' }];
const GOOD = 'All categories are locally small. We write $\\Hom(a,b)$ for the arrows.';
const NOW = 'All categories are locally small. We write $\\Hmo(a,b) for the arrows.';

export function WidgetsSection({ g }: { g: Gallery }) {
  useLayoutEffect(() => { installRefNavStyle(); }, []);
  return html`<${Section} g=${g} id="widgets" title="Editor widgets" lead="The editor's own components with fixture data. Their places in a live document: The editor, live (below).">
    <${Group} title="Note chips and the note popover" g="notes"><${NoteChips} /><//>
    <${Group} title="The find bar" g="find" note="chrome/find-bar.js: its count states and options (Match case, Whole words, Regular expression).">
      <div class="gal-stack">${FINDS.map((s) => html`<${Cell} label=${s.label} wide><${FindBar} s=${s} /><//>`)}</div>
    <//>
    <${Group} title="The reference card" g="card" note="refnav/card.js: what a hover or the keyboard opens on a reference, a citation or a link.">
      <div class="gal-cells gal-cells--top">${CARDS.map((c) => html`<${Cell} label=${c.label}><${RefCard} v=${c.v} /><//>`)}</div>
    <//>
    <${Group} title="A block's errors" g="errors" note="edit/panel.js: the error rows under a block, and the live note in the code popover (the preview shows the last version that compiled).">
      <div class="gal-cells gal-cells--top">
        <${Cell} label="error rows"><div class="errors gal-errors"><${ErrorRows} problems=${PROBLEMS} report=${() => ''} open=${() => {}} /></div><//>
        <${Cell} label="live note, with the way back"><div class="live-note-box gal-errors"><${LiveNote} note=${{ errors: PROBLEMS, good: GOOD, current: () => NOW, report: () => '', open: () => {}, revert: () => {} }} /></div><//>
      </div>
    <//>
  <//>`;
}

// ── the sheets' content, in a pane container (FrameContext) ──
interface FrameProps { title?: string; tabs?: Record<string, unknown> | null; footer?: ComponentChildren; note?: ComponentChildren; class?: string; children?: ComponentChildren }
/** The container a sheet's content is drawn in here: the kit Sheet's parts (head, tabs, body, foot) in the page's flow,
 *  not modal (the kit's Sheet is a modal <dialog> with a scrim: one per page). */
function PaneFrame({ title, tabs, footer, note, class: c = '', children }: FrameProps) {
  return html`<section class=${`ui-sheet gal-sheet ${c}`} role="dialog" aria-label=${title}>
    <div class="ui-dialog-head ui-sheet-head"><h2 class="ui-dialog-title">${title}</h2></div>
    ${tabs ? html`<${Tabs} variant="strip" class="ui-sheet-tabs" ...${tabs} />` : null}
    <div class="ui-dialog-body ui-sheet-body">${children}</div>
    ${footer || note != null ? html`<div class="ui-dialog-foot ui-sheet-foot">${note != null ? html`<span class="ui-sheet-note">${note}</span>` : null}${footer}</div>` : null}
  </section>`;
}
function InPane({ children }: { children?: ComponentChildren }) {
  return html`<${FrameContext.Provider} value=${PaneFrame}>${children}<//>`;
}

/** the Settings panel's document tab on the fixture's preamble (a host of its own: nothing is applied) */
function DocTab({ errors, readOnly = false, none = false }: { errors: PreambleError[]; readOnly?: boolean; none?: boolean }) {
  const doc = testFixtureDocument() as { preamble: string; blocks: unknown[] };
  const host = useRef({
    preamble: { problems: signal(errors.length), errors: signal(errors), source: signal(doc.preamble), readOnly: () => readOnly, blocks: () => doc.blocks.length,
      draft: () => {}, apply: () => {} },
    bibliography: { info: signal('bbl · 4 entries'), openReferences: () => {} },
  }).current;
  return html`<div class="rtx-settings gal-settings"><${DocumentSettings} host=${none ? null : host} ask=${() => null} /></div>`;
}

const TITLE_PREAMBLE = String.raw`\documentclass{article}
\title{Functors and Their Transformations}
\author{Ann Author\thanks{University of Somewhere} \and Ben Example\thanks{Institute of Elsewhere}}
\date{}`;
function Title({ convert }: { convert: boolean }) {
  const pre = convert ? TITLE_PREAMBLE : convertPreamble(TITLE_PREAMBLE, 'article')?.preamble ?? TITLE_PREAMBLE;
  const host = useRef({
    preview: async () => ({ status: 'error', errors: [{ message: 'No TeX engine on this page: the preview is typeset by the engine.' }] }),
    mount: async () => null, apply: () => {}, editSource: () => {}, focusBlock: () => {}, previewed: () => {},
  }).current;
  return html`<${InPane}><${TitleForm} host=${host} pre0=${pre} cls="article" blockId="title" done=${() => {}} /><//>`;
}

export function SheetsSection({ g }: { g: Gallery }) {
  useLayoutEffect(() => { installSettingsStyle(); }, []);
  return html`<${Section} g=${g} id="sheets" title="Settings and sheets" lead="The Settings panel's document tab (settings/document.ts) and the title form's content (meta/form/sheet.js) in a pane container; in the editor the title form opens in the kit's side Sheet.">
    <${Group} title="The Settings panel's document tab" g="settings">
      <div class="gal-cells gal-cells--top">
        <${Cell} label="the preamble, with two problems"><${DocTab} errors=${[{ line: 3, message: 'Undefined control sequence \\usepackag.' }, { line: 9, message: 'LaTeX Error: Missing \\begin{document}.' }]} /><//>
        <${Cell} label="a read-only document"><${DocTab} errors=${[]} readOnly=${true} /><//>
        <${Cell} label="no document open"><${DocTab} errors=${[]} none=${true} /><//>
      </div>
    <//>
    <${Group} title="The title form" g="title-form">
      <div class="gal-cells gal-cells--top">
        <${Cell} label="\\title and \\author: the conversion offered"><${Title} convert=${true} /><//>
        <${Cell} label="the form (\\ReflowedMeta); the preview needs the engine"><${Title} convert=${false} /><//>
      </div>
    <//>
  <//>`;
}
