// the References pane's view on the kit (Preact + htm). The pane (index.js) keeps the state and the
// actions and draws this synchronously from draw() (it measures and scrolls right after). Test hooks kept:
// .bp-head (.bp-search input, .bp-addbtn, .bp-morebtn), .bp-chip[data-filter], .bp-target, .bp-hint, .bp-body
// (.bp-unknowns .bp-unknown[data-key], .bp-section, .bp-empty, ul.bp-list#bp-list > li.bp-row[data-key]#bp-opt-…
// with .bp-who, .bp-year, .bp-title, .bp-meta (.bp-label, .bp-venue-s, .bp-tag), .bp-cite, .bp-more .bp-actions
// .bp-btn), .bp-selbar, .bp-foot.
//
// A row is three lines on the list's grid (style.ts): the authors' family names | the year, the title (two lines at
// most), the label TeX prints and the venue. The list is a two-column grid and each row a subgrid, so the year
// column is as wide as the widest year shown and the years line up down the list at every width.
import { html, cx, Button, IconButton, Input, Chip } from '../design/ui/index.js';
import type { LibEntry, Library } from '../bib/library.ts';

type Ref<T> = { current: T | null };
/** a citation of an entry in the text (refs' scan) */
export interface Use { blockId: string; offset: number; length: number; keys: string[] }
/** what draw() gives the view (index.js) */
export interface PaneVm {
  L: Library; um: Map<string, Use[]>; rows: LibEntry[]; unknown: string[];
  t: { id: string; editing: boolean } | null;
  allCited: boolean; nCited: number; sel: string[];
  setup: { engine: 'biblatex' | 'bibtex' | 'none'; style: string };
  query: string; filter: string; active: string | null; openKey: string | null;
  selection: Set<string>; fresh: Set<string>; hint: string; dropping: boolean;
  footText: string; footTitle: string;
}
/** the pane's actions the view calls (index.js viewApi) */
export interface PaneApi {
  optId(key: string): string; orderKeys(keys: string[]): string[]; locator(blockId: string): string;
  cite(keys: string[]): void; remove(keys: string[]): void; addDialog(o?: { key?: string; text?: string }): void; editDialog(e: LibEntry | undefined): void;
  moreMenu(anchor: HTMLElement): void; plain(tex: string): string; entry(key: string): LibEntry | undefined;
  setQuery(v: string): void; setFilter(key: string): void; clearSelection(): void; citeRow(e: LibEntry): void;
  rowClick(ev: MouseEvent, e: LibEntry): void; rowDrag(ev: DragEvent, e: LibEntry): void; onKey(ev: KeyboardEvent): void;
  showUse(u: Use | undefined): void; reveal(blockId: string): void; copyKey(key: string): void;
  bodyDragOver(ev: DragEvent): void; bodyDragLeave(): void; bodyDrop(ev: DragEvent): void;
}
export interface PaneRefs { input: Ref<HTMLInputElement>; list: Ref<HTMLUListElement>; body: Ref<HTMLDivElement> }

const inputOf = (e: Event) => e.currentTarget as HTMLInputElement;

export function Pane({ vm, m, refs }: { vm: PaneVm; m: PaneApi; refs: PaneRefs }) {
  const { L, rows, unknown, t, allCited, sel } = vm;
  const showUnknown = (vm.filter === 'all' || vm.filter === 'unknown') && unknown.length > 0 && !vm.query;
  const chips: [string, string, number, boolean?][] = [['all', 'All', L.entries.length], ['cited', 'Cited', vm.nCited], ['uncited', 'Not cited', L.entries.length - vm.nCited],
    ...(unknown.length || vm.filter === 'unknown' ? [['unknown', 'Unknown', unknown.length, true] as [string, string, number, boolean]] : [])];
  return html`
    <div class="bp-head">
      <span class="bp-search">
        <${Input} size="sm" icon="search" type="search" placeholder="Search references" aria-label="Search references" role="combobox"
          aria-controls="bp-list" aria-expanded="true" aria-autocomplete="list" autocomplete="off" spellcheck="false"
          aria-activedescendant=${vm.active ? m.optId(vm.active) : ''} inputRef=${refs.input} value=${vm.query}
          onInput=${(e: Event) => m.setQuery(inputOf(e).value)} onKeyDown=${m.onKey} />
        <kbd>/</kbd>
      </span>
      <${IconButton} icon="plus" size="sm" class="bp-addbtn" label="Add references" title="Add references: paste BibTeX, a DOI or an arXiv id" onClick=${() => m.addDialog()} />
      <${IconButton} icon="more" size="sm" class="bp-morebtn" label="More actions" title="More" aria-haspopup="menu" onClick=${(e: MouseEvent) => { e.stopPropagation(); m.moreMenu(e.currentTarget as HTMLElement); }} />
    </div>
    <div class="bp-filters" role="group" aria-label="Show">
      ${chips.map(([key, label, n, warn]) => html`
        <${Chip} key=${key} class=${cx('bp-chip', vm.filter === key && 'on', warn && n && 'warn')} selected=${vm.filter === key} data-filter=${key}
          onClick=${() => m.setFilter(key)}>${label}<span class="n">${n}</span><//>`)}
    </div>
    <div class="bp-target" aria-live="polite" title=${t ? `Cite puts \\cite{…} at the caret of this block${t.editing ? ' (being edited)' : ' (where you last edited)'}` : ''}>
      ${t ? html`Cite goes to <b>${m.locator(t.id)}</b>` : 'Click in the text to choose where Cite goes'}
    </div>
    <div class="bp-hint" role="status" hidden=${!vm.hint}>${vm.hint}</div>
    <div class=${cx('bp-body', vm.dropping && 'drop')} ref=${refs.body} onDragOver=${m.bodyDragOver} onDragLeave=${m.bodyDragLeave} onDrop=${m.bodyDrop}>
      ${showUnknown ? html`<div class="bp-unknowns">
        <div class="bp-section">Cited but not in the bibliography (${unknown.length})</div>
        ${unknown.map((k) => { const uses = vm.um.get(k) ?? []; return html`<div key=${k} class="bp-unknown" data-key=${k}>
          <button type="button" class="ui-row bp-use bp-key" title=${`Show where ${k} is cited`} onClick=${() => m.showUse(uses[0])}>${k}</button>
          <span class="bp-n">×${uses.length}</span>
          <${Button} size="sm" class="bp-btn" data-key=${k} onClick=${() => m.addDialog({ key: k })}>Add entry…<//>
        </div>`; })}
      </div>` : null}
      ${showUnknown && vm.filter !== 'unknown' && rows.length ? html`<div class="bp-section">In the bibliography</div>` : null}
      ${!L.entries.length && vm.filter !== 'unknown' ? html`<div class="bp-empty">
          <p>${vm.setup.engine === 'none'
            ? 'No bibliography yet. Add references here (paste BibTeX, a DOI or an arXiv id); the document needs \\usepackage{biblatex} and \\printbibliography, or \\bibliographystyle and \\bibliography, to print them.'
            : 'No references yet. Paste BibTeX here, drop a .bib file, or add one by DOI or arXiv id.'}</p>
          <${Button} size="sm" variant="primary" class="bp-btn primary" onClick=${() => m.addDialog()}>Add references…<//></div>`
        : !rows.length && vm.filter !== 'unknown' ? html`<div class="bp-empty"><p>${vm.query ? `Nothing matches “${vm.query}”.` : vm.filter === 'uncited' ? 'Every reference is cited.' : 'No references cited yet.'}</p></div>` : null}
      <ul class="bp-list" id="bp-list" role="listbox" aria-label="References" aria-multiselectable="true" tabindex="-1" ref=${refs.list} onKeyDown=${m.onKey}>
        ${rows.map((e) => html`<${Row} key=${e.key} e=${e} uses=${vm.um.get(e.key) ?? []} allCited=${allCited} vm=${vm} m=${m} />`)}
      </ul>
    </div>
    <div class="bp-selbar" hidden=${sel.length < 2}>
      <span class="grow">${sel.length} selected</span>
      <${Button} size="sm" variant="ghost" class="bp-btn" onClick=${() => m.clearSelection()}>Clear<//>
      <${Button} size="sm" variant="primary" class="bp-btn primary" onClick=${() => m.cite(m.orderKeys(sel))}>Cite ${sel.length}<//>
    </div>
    <div class="bp-foot" title=${vm.footTitle}>${vm.footText}</div>`;
}

/** the year as the row shows it: biblatex's "n.d." when there is none; "in press" and the like as written */
const yearText = (y: string) => y.trim() || 'n.d.';

function Row({ e, uses, allCited, vm, m }: { e: LibEntry; uses: Use[]; allCited: boolean; vm: PaneVm; m: PaneApi }) {
  const cited = allCited || uses.length > 0;
  const open = vm.openKey === e.key;
  const who = e.authorsFamily || e.authors || e.key;
  const title = e.title || e.venue || '(no title)';
  const venue = e.title ? e.venue : '';
  return html`<li class=${cx('bp-row', !cited && 'uncited', vm.active === e.key && 'active', vm.fresh.has(e.key) && 'fresh', open && 'open')}
      role="option" id=${m.optId(e.key)} aria-selected=${String(vm.selection.has(e.key))} data-key=${e.key} draggable="true"
      onClick=${(ev: MouseEvent) => m.rowClick(ev, e)} onDblClick=${(ev: MouseEvent) => { if (!(ev.target as Element).closest('.bp-more')) m.editDialog(m.entry(e.key)); }}
      onDragStart=${(ev: DragEvent) => m.rowDrag(ev, e)}>
    <span class="bp-who" title=${e.authorsFull || who}>${who}</span>
    <span class=${cx('bp-year', !e.year.trim() && 'none')} title=${e.year.trim() ? e.year : 'No year'}>${yearText(e.year)}</span>
    <span class="bp-title" title=${title}>${title}</span>
    <span class="bp-meta">
      <span class="bp-label">${e.label ? `[${e.label}]` : e.key}</span>
      ${venue ? html`<span class="bp-venue-s" title=${venue}>${venue}</span>` : null}
      ${!cited ? html`<span class="bp-tag">not cited</span>` : null}
      <${Button} size="sm" class="bp-cite" tabindex="-1" title=${`Cite ${e.key} at the caret (Enter)`} aria-label=${`Cite ${e.key}`}
        onClick=${(ev: MouseEvent) => { ev.stopPropagation(); m.citeRow(e); }}>Cite<//>
    </span>
    ${open ? html`<${Details} e=${e} uses=${uses} cited=${cited} m=${m} />` : null}
  </li>`;
}

function Details({ e, uses, cited, m }: { e: LibEntry; uses: Use[]; cited: boolean; m: PaneApi }) {
  const f = e.fields;
  const bits = [e.venue, f.volume && `vol. ${m.plain(f.volume)}`, f.pages && `pp. ${m.plain(f.pages).replace(/--?/g, '–')}`].filter(Boolean);
  const link = e.doi ? `https://doi.org/${e.doi}` : e.url || (e.eprint && /arxiv/i.test(f.archiveprefix ?? f.eprinttype ?? 'arxiv') ? `https://arxiv.org/abs/${e.eprint}` : '');
  const stop = (fn: () => void) => (ev: Event) => { ev.stopPropagation(); fn(); };
  return html`<div class="bp-more">
    <div class="bp-venue">
      ${e.authorsFull ? html`<div class="bp-full">${e.authorsFull}</div>` : null}
      ${bits.length ? html`<div>${bits.join(', ')}</div>` : null}
      ${link ? html`<div><a href=${link} target="_blank" rel="noopener">${e.doi ? `doi:${e.doi}` : link.replace(/^https?:\/\//, '')}</a></div>` : null}
      <div class="bp-key2">${e.type} · ${e.key}</div>
    </div>
    <div class="bp-uses">
      ${uses.length ? html`<span class="bp-k">Cited ${uses.length === 1 ? 'once' : `${uses.length} times`}</span>
        ${uses.slice(0, 12).map((c, i) => html`<button key=${i} type="button" class="ui-row bp-use" title="Show it in the text" onClick=${() => m.reveal(c.blockId)}>${m.locator(c.blockId)}</button>`)}
        ${uses.length > 12 ? html`<span class="bp-k">and ${uses.length - 12} more</span>` : null}`
        : html`<span class="bp-k">${cited ? 'Cited by \\nocite{*}' : 'Not cited yet'}</span>`}
    </div>
    <div class="bp-actions">
      <${Button} size="sm" variant="primary" class="bp-btn primary" onClick=${stop(() => m.cite([e.key]))}>Cite<//>
      <${Button} size="sm" class="bp-btn" onClick=${stop(() => m.editDialog(e))}>Edit<//>
      <${Button} size="sm" class="bp-btn" onClick=${stop(() => m.copyKey(e.key))}>Copy key<//>
      <${Button} size="sm" variant="danger" class="bp-btn danger" onClick=${stop(() => m.remove([e.key]))}>Delete<//>
    </div>
  </div>`;
}
