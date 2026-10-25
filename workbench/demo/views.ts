// The demo's fake views: home, a "document" with breadcrumbs (kept alive), a list whose items drag between
// tabs (content drag and drop), a text note. They count their renders and size callbacks (window.__wbStats),
// so the tests can tell that hidden tabs do no work.
import { useEffect, useRef, useState, useLayoutEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { html, Icon, openRowMenu, kit, type ChipEvent, type Crumb, type Subtitle, type Tab, type ViewContext, type WorkbenchStore } from '../src/index.ts';
const { Button, IconButton } = kit;

type Counts = Record<string, number>;
export const stats: { renders: Counts; sizes: Counts; mounts: Counts; unmounts: Counts } = { renders: {}, sizes: {}, mounts: {}, unmounts: {} };
Object.assign(globalThis, { __wbStats: stats });
const bump = (o: Counts, k: string) => { o[k] = (o[k] ?? 0) + 1; };
/** The demo views' states. */
type DocState = { doc?: string; section?: string; paras?: number };
type ListState = { name?: string; items?: string[] };
type TextState = { text?: string };
type ViewProps = { tab: Tab; ctx: ViewContext };
type Doc = { title: string; sections: string[]; numbered?: boolean };

export const DOCS: Record<string, Doc> = {
  lemma: { title: 'On the lemma of Kőnig', sections: ['Introduction', 'Preliminaries', 'The lemma', 'Applications', 'Conclusion'] },
  graphs: { title: 'Sparse graphs and their minors', sections: ['Introduction', 'Definitions', 'Main result', 'Proof', 'Open problems'] },
  streams: { title: 'Streaming lower bounds', sections: ['Introduction', 'Model', 'Lower bound', 'Discussion'] },
  // a long paper with numbered sections and an appendix (the scenario: three tabs on different places of it)
  konig: { title: 'Kőnig’s lemma and its variants', numbered: true, sections: ['1 Introduction', '2 Definitions', '3 The main theorem', '4 Proofs', '4.1 Two lemmas',
    '4.2 Proof of Theorem 3', '5 Conclusion', 'A Extended proof of Theorem 3', 'B Tables'] },
  // a book: parts, chapters and their sections (LaTeX's \part, \chapter, \section): the crumb works the same at every
  // level; the kind is named in the tooltip and the chip's name ("Go to chapter: …"), the menu indents by level
  thesis: { title: 'Graph minors in practice', numbered: true, sections: ['Part I Foundations', 'Chapter 1 Introduction', '1.1 Motivation', '1.2 Outline',
    'Chapter 2 Minors and their models', '2.1 Definitions', '2.2 The structure theorem', 'Part II Algorithms', 'Chapter 3 Testing for a minor',
    '3.1 The irrelevant vertex', 'Appendix A Proofs'] },
  // a document with no sections yet
  draft: { title: 'Untitled draft', sections: [] },
};
const LOREM = 'We show that every finite, connected structure of this kind admits a decomposition whose width is bounded by a function of its parameter. The argument is constructive and gives a linear-time algorithm.';

function Home({ ctx }: ViewProps) {
  // a document in a new tab beside, or here: in home's place (the tab it is over), or instead of this tab
  const openNew = (doc: string) => ctx.open({ view: 'document', state: { doc } }, { beside: true });
  const openDoc = (doc: string) => (ctx.kind === 'home' ? ctx.open({ view: 'document', state: { doc } }) : ctx.replace({ view: 'document', state: { doc } }));
  return html`<div class="demo-home">
    <h2>Documents</h2>
    <ul class="demo-docs">
      ${Object.entries(DOCS).map(([id, d]) => html`<li key=${id} class="demo-doc-row"><${Button} class="demo-doc-btn" data-open-doc=${id} icon="file" label=${d.title} onClick=${(e: MouseEvent) => ((e.ctrlKey || e.metaKey) ? openNew(id) : openDoc(id))} /><${IconButton} class="demo-open-new" data-open-new=${id} icon="newTab" label=${`Open ${d.title} in a new tab`} tip="Open in a new tab" onClick=${() => openNew(id)} /></li>`)}
    </ul>
    <h2>Other views</h2>
    <div class="demo-row">
      <${Button} data-open="list" label="A list" onClick=${() => ctx.open({ view: 'list', state: { name: 'New list', items: [] } })} />
      <${Button} data-open="text" label="A note" onClick=${() => ctx.open({ view: 'text', state: { text: '' } })} />
      <${Button} data-open="preview" label="Peek a document (preview tab)" onClick=${() => ctx.open({ view: 'document', state: { doc: 'streams' } }, { preview: true })} />
    </div>
    <p class="demo-hint">A new or empty tab shows this view. Drag tabs to reorder, to another group, or to a group's edge to split it.
    Drag list items between list tabs: hover a tab to open it. Esc cancels a drag.</p>
  </div>`;
}

function DocumentView({ tab, ctx }: ViewProps) {
  bump(stats.renders, tab.id);
  const st = tab.state as DocState, d = docOf(tab);
  const size = ctx.size.value;
  const paras = st.paras ?? 4;
  useEffect(() => { bump(stats.mounts, tab.id); return () => bump(stats.unmounts, tab.id); }, []);
  useEffect(() => { if (size.w) bump(stats.sizes, tab.id); }, [size.w, size.h]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const s = st.section; if (s) requestAnimationFrame(() => goSection(ctx, tab, s)); }, []);
  // (as the editor) a column opening or closing: the text keeps its lines during the motion (its width pinned,
  // clipped at the view's edge: it never scrolls sideways), and is laid out once at the end
  useEffect(() => {
    const pin = () => { const art = scroller.current?.querySelector('article'); if (art && ctx.visible.peek()) { art.style.width = `${art.getBoundingClientRect().width}px`; art.style.flex = 'none'; } };
    const unpin = () => { const art = scroller.current?.querySelector('article'); if (art) { art.style.width = ''; art.style.flex = ''; } };
    const offs = [ctx.wb.on('resizestart', (d) => { if (d?.side) pin(); }), ctx.wb.on('resizeend', (d) => { if (d?.side) unpin(); })];
    return () => offs.forEach((f) => f());
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;                       // a scroll event after the view went (WebKit sends one)
    const top = el.getBoundingClientRect().top + (parseFloat(getComputedStyle(el).paddingTop) || 0) + 8;   // under the glass strip
    const hs = [...el.querySelectorAll('h3')], tops = hs.map((h) => h.getBoundingClientRect().top);
    let cand = 0;
    tops.forEach((t, i) => { if (t <= top) cand = i; });
    const now = Math.max(0, d.sections.indexOf(st.section ?? d.sections[0] ?? ''));
    // hysteresis: a boundary changes the section once: forward when the next heading is 12 px past the line, back
    // when the current heading is 12 px below it (no flipping while a heading sits on the line)
    const HYS = 12;
    let next = now;
    if (cand > now) { next = now; for (let i = now + 1; i <= cand; i++) if (tops[i]! <= top - HYS) next = i; }
    else if (cand < now) { next = now; while (next > 0 && tops[next]! > top + HYS) next--; }
    if (next !== now) ctx.setState({ section: d.sections[next] });
  };
  return html`<div class="demo-doc" ref=${scroller} onScroll=${onScroll} data-doc=${st.doc} data-wb-scroll>
    <article>
      <h1>${d.title}</h1>
      ${d.sections.map((s) => html`<section key=${s}><h3 id=${`${tab.id}-${s}`}>${s}</h3>
        ${Array.from({ length: paras }, (_, i) => html`<p key=${i}>${LOREM}</p>`)}</section>`)}
    </article>
    <div class="demo-size" data-size>${ctx.resizing.value ? 'resizing… ' : ''}${size.w} × ${size.h}</div>
  </div>`;
}
/** The document switcher: pick one to show it here (the same tab); Ctrl/⌘-click, or "In a new tab", to open it beside. */
function openSwitcher(e: ChipEvent, tab: Tab, ctx: ViewContext) {
  const inNew = (id: string) => ctx.wb.open({ view: 'document', state: { doc: id } }, { focus: true });
  const here = (id: string) => ctx.replace({ view: 'document', state: { doc: id } });
  return openRowMenu(e.currentTarget ?? e.anchor!, [
    { heading: 'Documents' },
    ...Object.entries(DOCS).map(([id, x]) => ({ id: `doc-${id}`, label: x.title, active: id === (tab.state as DocState).doc,
      onSelect: (ev?: MouseEvent) => ((ev?.ctrlKey || ev?.metaKey) ? inNew(id) : here(id)),
      action: { icon: 'newTab' as const, label: `Open ${x.title} in a new tab`, onSelect: () => inNew(id) } })),
  ], { label: 'Switch document' });
}
/** A document's name, after a rename (the host's store in the editor): every tab of it reads it. */
export const NAMES = signal<Record<string, string>>({});
const nameOf = (doc: string | undefined) => (doc && (NAMES.value[doc] ?? DOCS[doc]?.title)) ?? doc ?? '';
const docOf = (tab: Tab): Doc => { const doc = (tab.state as DocState).doc; return (doc ? DOCS[doc] : undefined) ?? { title: doc ?? '', sections: ['Body'] }; };
/** Jump to a section: the document's own scroller (never scrollIntoView). */
function goSection(ctx: ViewContext, tab: Tab, s: string) {
  const el = ctx.wb.hosts.get(tab.id)?.el, h = el?.querySelector(`[id="${tab.id}-${s}"]`), sc = el?.querySelector<HTMLElement>('.demo-doc');
  if (h && sc) sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - (parseFloat(getComputedStyle(sc).paddingTop) || 0);
  ctx.setState({ section: s });       // a jump names its section at once (scrolling then keeps it, with hysteresis)
}
/** The section and its siblings: the section menu (navigation to siblings). */
/** The heading kinds a numbered document names before the number (LaTeX's \part, \chapter, a book's appendix). */
const KINDS = ['Part', 'Chapter', 'Appendix'] as const;
/** A heading's kind, number and text: numbered papers carry their own (4.2, A; Part I, Chapter 2), others count. A part,
 *  chapter or appendix names its kind, the rest are sections. depth: the menu's indentation (a part 0, a chapter under
 *  parts 1, a section one more than its chapter, a subsection by its dots). */
function split(d: Doc, s: string): { num: string; text: string; kind: string; depth: number } {
  if (!d.numbered) return { num: String(d.sections.indexOf(s) + 1), text: s, kind: 'Section', depth: 0 };
  const has = (k: string) => d.sections.some((x) => x.startsWith(`${k} `));
  const top = has('Part') ? 1 : 0, kind = KINDS.find((k) => s.startsWith(`${k} `));
  const rest = kind ? s.slice(kind.length + 1) : s, i = rest.indexOf(' '), num = rest.slice(0, i), text = rest.slice(i + 1);
  if (kind) return { num, text, kind, depth: kind === 'Part' ? 0 : top };
  return { num, text, kind: 'Section', depth: (has('Chapter') ? top : 0) + (num.match(/\./g) ?? []).length };
}
function sectionItem(tab: Tab, ctx: ViewContext): Crumb & Subtitle & { num: string; text: string } {
  const d = docOf(tab), section = (tab.state as DocState).section ?? d.sections[0] ?? '', { num, text, kind } = split(d, section);
  const toc = d.sections.some((x) => KINDS.some((k) => x.startsWith(`${k} `)));     // parts or chapters: the menu is the contents
  const lab = (s: string) => { const p = split(d, s); return `${p.num}  ${p.text}`; };
  return { id: 'section', label: lab(section), num, text, kind, title: `${kind} ${num}: ${text}. Other ${toc ? 'headings' : 'sections'}…`, menu: true,
    // the same row menu as the document switcher: a row goes to the section here; its button opens the document at
    // that section in a new tab (Ctrl/⌘-click on the row too)
    onSelect: (e: ChipEvent) => { openRowMenu(e.currentTarget ?? e.anchor!, [
      { heading: toc ? 'Contents' : 'Sections' },
      ...d.sections.map((s) => { const p = split(d, s); const inNew = () => { ctx.wb.open({ view: 'document', state: { doc: (tab.state as DocState).doc, section: s } }, { focus: true }); };
        return { id: `sec-${s}`, num: p.num, label: p.text, depth: p.depth, active: s === section,
          onSelect: (ev?: MouseEvent) => ((ev?.ctrlKey || ev?.metaKey) ? inNew() : goSection(ctx, tab, s)),
          action: { icon: 'newTab' as const, label: `Open ${p.kind === 'Section' ? '' : `${p.kind} `}${p.num} ${p.text} in a new tab`, onSelect: inNew } }; }),
    ], { label: toc ? 'Contents' : 'Sections', returnFocus: (e.returnFocus as HTMLElement | null | undefined) ?? null }); } };
}
const docCrumbs = (tab: Tab, ctx: ViewContext): Crumb[] => {
  const sec = docOf(tab).sections.length ? sectionItem(tab, ctx) : null;
  const doc = (tab.state as DocState).doc;
  const full: Crumb[] = [
    { id: 'home', label: 'Documents', home: true, onSelect: () => { ctx.wb.toggleHome(undefined, true); } },
    // the document switcher (the editor's doc-header): its menu lists the documents
    // the name and its chevron are one button: the document switcher (rename: the tab menu, F2)
    { id: 'doc', label: nameOf(doc), menu: true, title: `${nameOf(doc)}: switch document (Ctrl-click: in a new tab)`,
      onSelect: (e) => { openSwitcher(e, tab, ctx); } },
    ...(sec ? [sec] : []),
  ];
  // the integrated view (no tab) names the document once in its header; beside tabs, the tab names it
  if (ctx.solo?.value) return full;
  return sec ? [sec] : [];
};
const docSubtitle = (tab: Tab, ctx: ViewContext): Subtitle | null => { if (!docOf(tab).sections.length) return null; const s = sectionItem(tab, ctx); return { label: s.label, num: s.num, text: s.text, kind: s.kind, title: s.title, onSelect: s.onSelect }; };

/** A list: its items drag to other lists (in any tab and group), with a live insertion line. */
type ItemDrag = { kind: 'demo-item'; item: string };
const isItem = (p: unknown): p is ItemDrag => (p as ItemDrag | null)?.kind === 'demo-item';
function ListView({ tab, ctx }: ViewProps) {
  bump(stats.renders, tab.id);
  const st = tab.state as ListState, items = st.items ?? [];
  const list = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<number | null>(null);     // the insertion index while a drag is over this list
  const indexAt = (y: number) => {
    const rows = [...list.current!.querySelectorAll('[data-item]')];
    for (let i = 0; i < rows.length; i++) { const r = rows[i]!.getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
    return rows.length;
  };
  useLayoutEffect(() => ctx.dropTarget(list.current!, {
    accepts: (drag) => isItem(drag.payload),
    over: (_drag, pt) => { setLine(indexAt(pt.y)); return 'move'; },
    leave: () => setLine(null),
    drop: (drag, pt) => {
      if (!isItem(drag.payload)) return 'none';
      const at = indexAt(pt.y), item = drag.payload.item;
      ctx.setState((s) => {
        const cur = (s as ListState).items ?? [];
        const from = cur.indexOf(item);
        const rest = cur.filter((x) => x !== item);
        const k = from >= 0 && from < at ? at - 1 : at;
        return { ...s, items: [...rest.slice(0, k), item, ...rest.slice(k)] };
      });
      return 'move';
    },
  }), []);
  const down = (e: PointerEvent, item: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ctx.startDrag(e, {
      payload: { kind: 'demo-item', item },
      label: item,
      preview: () => html`<div class="demo-drag"><${Icon} name="list" /> ${item}</div>`,
      onEnd: (r) => { if (r.dropped && r.targetTab && r.targetTab !== tab.id) ctx.setState((s) => ({ ...s, items: ((s as ListState).items ?? []).filter((x) => x !== item) })); },
    });
  };
  const rowTop = (i: number) => {
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-item]');
    if (!rows?.length) return 4;
    if (i < rows.length) return rows[i]!.offsetTop - 1;
    const r = rows[rows.length - 1]!; return r.offsetTop + r.offsetHeight + 1;
  };
  return html`<div class="demo-list" ref=${list} data-list=${tab.id} data-wb-scroll>
    <h2>${st.name}</h2>
    ${items.length ? null : html`<p class="demo-hint">Empty: drop items here.</p>`}
    ${items.map((it) => html`<div key=${it} class="demo-item" data-item=${it} onPointerDown=${(e: PointerEvent) => down(e, it)}><${Icon} name="list" /> ${it}</div>`)}
    ${line != null ? html`<div class="demo-line" data-line=${line} style=${{ top: `${rowTop(line)}px` }}></div>` : null}
  </div>`;
}

function TextView({ tab, ctx }: ViewProps) {
  bump(stats.renders, tab.id);
  return html`<div class="demo-text"><textarea aria-label="Note" value=${(tab.state as TextState).text ?? ''}
    onInput=${(e: Event) => { ctx.keep(); ctx.setState({ text: (e.currentTarget as HTMLTextAreaElement).value }); }} placeholder="Write something…"></textarea></div>`;
}

// ── sidebar panels: the outline follows the active tab's document ──
function OutlinePanel({ ctx }: ViewProps) {
  const cur = ctx.wb.current.value.tab, cs = cur?.state as DocState | undefined;
  const d = cur?.view === 'document' && cs?.doc ? DOCS[cs.doc] : null;
  if (!d || !cur) return html`<p class="demo-hint demo-pad">No document in the active tab.</p>`;
  // scroll the document's own scroller (never scrollIntoView: it would scroll every ancestor that can)
  const go = (s: string) => { const el = ctx.wb.hosts.get(cur.id)?.el; const h = el?.querySelector(`[id="${cur.id}-${s}"]`), sc = el?.querySelector<HTMLElement>('.demo-doc'); if (h && sc) sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top; };
  return html`<div class="demo-panel" data-outline=${cs?.doc}><div class="demo-panel-title">${d.title}</div>
    ${d.sections.map((s) => html`<${Button} key=${s} class=${`demo-row-btn${(cs?.section ?? d.sections[0]) === s ? ' is-on' : ''}`} label=${s} onClick=${() => go(s)} />`)}</div>`;
}
function StaticPanel({ items }: { items: string[] }) {
  return html`<div class="demo-panel">${items.map((t) => html`<div class="demo-row-btn" key=${t}>${t}</div>`)}</div>`;
}
export function registerDemoViews(wb: WorkbenchStore, { panels = true }: { panels?: boolean } = {}): void {
  if (panels) registerPanels(wb);
  registerTabViews(wb);
}
function registerPanels(wb: WorkbenchStore) {
  wb.registerView({ id: 'outline', title: () => 'Outline', icon: 'outline', panel: { side: 'left' }, Component: OutlinePanel });
  wb.registerView({ id: 'problems', title: () => 'Problems', icon: 'problems', panel: { side: 'left' },
    Component: () => html`<${StaticPanel} items=${['Undefined reference: thm:main', 'Overfull hbox in paragraph 3']} />` });
  wb.registerView({ id: 'files', title: () => 'Files', icon: 'files', panel: { side: 'left', below: true },
    Component: () => html`<${StaticPanel} items=${['main.tex', 'refs.bib', 'figures/graph.svg']} />` });
  wb.registerView({ id: 'references', title: () => 'References', icon: 'book', panel: { side: 'right' },
    Component: () => html`<${StaticPanel} items=${['[1] A. Author, A first book on graphs', '[2] B. Example, Graphs and trees', '[3] A. Author, B. Example, Minors, again']} />` });
}
function registerTabViews(wb: WorkbenchStore) {
  wb.registerView({ id: 'home', title: () => 'Home', icon: 'home', Component: Home });
  wb.registerView<DocState>({ id: 'document', title: (s) => nameOf(s.doc), docId: (s) => s.doc ?? null, rename: (tab, name) => { const doc = (tab.state as DocState).doc; if (doc) NAMES.value = { ...NAMES.value, [doc]: name }; }, icon: 'file', tabIcon: false, keepAlive: true, crumbs: docCrumbs, subtitle: docSubtitle, switcher: (tab, ctx) => ({ onSelect: (e) => { openSwitcher(e, tab, ctx); } }), Component: DocumentView });
  wb.registerView<ListState>({ id: 'list', title: (s) => s.name ?? 'List', icon: 'list', keepAlive: true, Component: ListView });
  wb.registerView<TextState>({ id: 'text', title: (s) => (s.text ? (s.text.split('\n')[0] ?? '').slice(0, 40) : 'Note'), icon: 'text', Component: TextView,
    focus: (ctx) => { ctx.wb.hosts.get(ctx.viewId)?.el.querySelector('textarea')?.focus({ preventScroll: true }); } });
}

export const DEMO_CSS = `
.demo-home { padding: calc(var(--ui-6)) var(--ui-8); max-width: 640px; }
.demo-home h2 { font-size: var(--ui-text-xs); text-transform: uppercase; letter-spacing: var(--ui-caps-track); color: var(--rfed-ink-3); font-weight: var(--ui-semibold); margin: var(--ui-5) 0 var(--ui-2); }
.demo-docs { list-style: none; margin: 0; padding: 0; }
.demo-doc-row { display: flex; align-items: center; gap: 4px; } .demo-doc-row > .demo-doc-btn { flex: 1 1 auto; justify-content: flex-start; }
.demo-open-new { opacity: 0; } .demo-doc-row:hover .demo-open-new, .demo-open-new:focus-visible { opacity: 1; }
.demo-row { display: flex; flex-wrap: wrap; gap: var(--ui-2); }
.demo-hint { color: var(--rfed-ink-3); font-size: var(--ui-text-sm); margin-top: var(--ui-5); }
/* views with their own scroller pad by the workbench's inset: the content starts under the glass strip; they scroll
   up and down only (overflow-x hidden: a sub-pixel overflow never shows a sideways scrollbar, Firefox) */
.demo-doc { position: absolute; inset: 0; overflow: hidden auto; padding-top: var(--wb-inset-top, 0px); scroll-padding-top: var(--wb-inset-top, 0px); }
.demo-doc article { max-width: 640px; margin: 0 auto; padding: var(--ui-6) var(--ui-6) 70vh; font: 15px/1.6 Georgia, "Times New Roman", serif; }
.demo-doc h1 { font-size: 24px; font-weight: 600; margin: 0 0 var(--ui-4); }
.demo-doc h3 { font-size: 17px; margin: var(--ui-6) 0 var(--ui-2); }
.demo-size { position: sticky; bottom: 0; text-align: right; padding: 2px var(--ui-2); color: var(--rfed-ink-3); font: var(--ui-text-xs)/1.4 var(--ui-mono); pointer-events: none; }
.demo-list { position: absolute; inset: 0; overflow: hidden auto; padding: calc(var(--wb-inset-top, 0px) + var(--ui-3)) var(--ui-4) var(--ui-3); scroll-padding-top: var(--wb-inset-top, 0px); }
.demo-list h2 { font-size: var(--ui-text-lg); margin: 0 0 var(--ui-2); }
.demo-item { display: flex; align-items: center; gap: var(--ui-2); height: var(--ui-row); padding: 0 var(--ui-2); border-radius: var(--ui-r-sm); cursor: grab; user-select: none; touch-action: none; }
.demo-item:hover { background: var(--rfed-hover); }
.demo-item svg { width: var(--ui-icon-sm); height: var(--ui-icon-sm); color: var(--rfed-ink-3); }
.demo-line { position: absolute; left: var(--ui-4); right: var(--ui-4); height: 2px; margin-top: -1px; background: var(--rfed-accent); border-radius: 1px; pointer-events: none; }
.demo-drag { display: inline-flex; align-items: center; gap: var(--ui-2); height: var(--ui-row); padding: 0 var(--ui-3); border-radius: var(--ui-r-sm); background: var(--rfed-surface); box-shadow: var(--ui-shadow-pop); font: var(--ui-text-md)/1 var(--ui-font); white-space: nowrap; }
.demo-drag svg { width: var(--ui-icon-sm); height: var(--ui-icon-sm); color: var(--rfed-ink-3); }
.demo-pad { padding: var(--ui-3); }
/* the wordmark (WORDMARK.md): two SVGs in currentColor, each a 20 px high frame: the icon 20 × 20 (the bar centres it:
   --wb-mark-icon), the word as wide as its viewBox makes it, its frame's bottom 8 px under the line's baseline (the tab
   text's), so the baseline is at y 12 of the frame. The icon in the subdued icon ink (wordmark.iconForeground), the
   word in the text's ink */
.demo-logo { display: block; width: var(--wb-mark-icon); height: var(--wb-mark-icon); color: var(--rfed-wordmark-icon-ink); }
.demo-logo > svg { display: block; width: 100%; height: 100%; }
.demo-brand { color: var(--rfed-ink); }
.demo-brand > svg { display: inline-block; width: auto; height: 20px; vertical-align: -8px; }
.demo-side-title { font-size: var(--ui-text-sm); color: var(--rfed-ink-2); }
.demo-panel { padding: var(--ui-1) var(--ui-2); }
.demo-panel-title { font-size: var(--ui-text-xs); text-transform: uppercase; letter-spacing: var(--ui-caps-track); color: var(--rfed-ink-3); padding: var(--ui-2) var(--ui-2) var(--ui-1); }
.demo-row-btn { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--rfed-ink-2); font: var(--ui-text-md)/1.3 var(--ui-font); padding: 6px var(--ui-2); border-radius: var(--ui-r-sm); cursor: pointer; }
.demo-row-btn:hover { background: var(--rfed-hover); color: var(--rfed-ink); }
.demo-row-btn.is-on { color: var(--rfed-ink); font-weight: var(--ui-medium); }
.demo-text { position: absolute; inset: 0; padding: calc(var(--wb-inset-top, 0px) + var(--ui-3)) var(--ui-3) var(--ui-3); }
.demo-text textarea { box-sizing: border-box; width: 100%; height: 100%; resize: none; border: 0; outline: none; background: transparent; color: inherit; font: var(--ui-text-lg)/1.5 var(--ui-font); }
`;
