// The Documents screen's components (Preact + htm on the kit). State and actions are the model's
// (screen.js); these only draw it and call back. Test hooks kept from the plain-DOM screen: rows are
// .rh-row[data-doc-id] (.rh-title, .rh-sub, .rh-hit, .rh-count), menus .rh-pop with [data-action] items,
// the rename field .rh-rename, the status line .rh-status, the empty state .rh-empty, the footer
// .home-foot with the .rtx-preview-pill. A sample with a newer version in this build: .rh-update (its badge,
// a button) in the title line, and "Updated sample…" in its ⋯ menu; the footer's Reset local data… (#reset-local).
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html, cx, Button, IconButton, Input, Popover, MenuItem, MenuSeparator, MenuLabel } from '../design/ui/index.js';
import { buildVersion } from '../app/build-version.js';
import { TEMPLATES } from '../io/templates.ts';
import { isSeedDoc } from '../io/seeds.ts';
import { markParts, relTime } from './text.js';
import { BADGE } from './sample-update.js';

const Marked = ({ text, words }) => markParts(text, words).map((p) => (p.mark ? html`<mark>${p.text}</mark>` : p.text));

export function HomeView({ m }) {
  const ref = useRef(null);
  m.tick.value;                                   // idle() forces a render through this
  useLayoutEffect(() => { m.rendered(ref.current); });
  const rows = m.rows.value, q = m.query.value.trim(), words = m.words.value;
  // .rh-c is the size container the layout adapts to (any panel's width); the menu and the drop overlay stay outside
  // it (fixed: placed by the window's coordinates, which a container would change)
  return html`<div ref=${ref} class=${cx('rh', m.dragging.value && 'dragging')}>
    <div class="rh-c">
    <div class="rh-head">
      <h1>ReflowEd</h1>
      <${Button} data-action="import" title="A .tex, a .zip, or an arXiv .tar.gz / e-print" onClick=${() => m.pickFiles()}>Import…<//>
      <${Button} variant="primary" data-action="new" aria-haspopup="menu" aria-expanded=${String(m.menu.value?.kind === 'new')}
        onClick=${(e) => m.toggleMenu({ kind: 'new', anchor: e.currentTarget })}>New<//>
    </div>
    <${TemplateRow} m=${m} />
    <div class="rh-find">
      <${Input} size="lg" icon="search" type="search" placeholder="Search titles, authors and text" aria-label="Search documents"
        spellcheck="false" data-action="search" inputRef=${m.searchRef} value=${m.query.value}
        onInput=${(e) => m.setQuery(e.currentTarget.value)} onKeyDown=${m.searchKey} />
    </div>
    <div class="rh-status" role="status" aria-live="polite" data-kind=${m.status.value.kind || undefined}>${m.status.value.text}</div>
    <div class="rh-list" role="list">${rows.map((d) => html`<${DocRow} key=${d.id} m=${m} d=${d} words=${words} />`)}</div>
    <div class="rh-empty" hidden=${!m.loaded.value || rows.length > 0}>
      ${q ? html`<strong>Nothing found</strong>No document matches “${q}”.`
        : html`<strong>No documents yet</strong>Create one with New, or drop a paper (.tex, .zip, arXiv .tar.gz) here.`}
    </div>
    <${HomeFooter} m=${m} />
    </div>
    <div class="rh-drop">Drop a .tex, a .zip or an arXiv .tar.gz to import it</div>
    <input type="file" multiple accept=${m.ACCEPT} hidden data-action="file" ref=${m.fileRef} onChange=${m.filesPicked} />
    ${m.menu.value ? html`<${HomeMenu} m=${m} menu=${m.menu.value} />` : null}
  </div>`;
}

/** (home) "New document" as Word or Pages offer it: a row of templates drawn as small pages, one press creates. A
 *  sketch is the page's outline (SKETCH: title, authors, abstract, heading, text, display, theorem, list, problems);
 *  the row wraps to fill the panel, and scrolls sideways when the panel is too narrow for two pages. */
const SKETCH = { blank: 't', article: 'tabhpmp', notes: 'hpepl', problems: 'thqqhp', lipics: 'Ltabhpm' };
const LINE = {
  t: html`<i class="s-title" />`, a: html`<i class="s-auth" />`, b: html`<i class="s-abs" /><i class="s-abs s-short" />`,
  h: html`<i class="s-head" />`, p: html`<i class="s-line" /><i class="s-line" /><i class="s-line s-short" />`, e: html`<i class="s-eq" />`,
  m: html`<i class="s-thm" /><i class="s-line s-thm-line" />`, l: html`<i class="s-item" /><i class="s-item s-short" />`,
  q: html`<i class="s-num" /><i class="s-line s-num-line s-short" />`, L: html`<i class="s-logo" />`,
};
function TemplateRow({ m }) {
  return html`<section class="rh-new" aria-label="New document">
    <h2 class="rh-new-head">New document</h2>
    <div class="rh-tpls" role="list">${TEMPLATES.map((t) => html`<div role="listitem" key=${t.id}>
      <button type="button" class="rh-tpl" data-action=${`new-${t.id}`} title=${t.hint} aria-label=${`New document: ${t.label}. ${t.hint}`} onClick=${() => m.create(t.id)}>
        <span class="rh-tpl-page" aria-hidden="true">${[...(SKETCH[t.id] ?? '')].map((k) => LINE[k])}</span>
        <span class="rh-tpl-label">${t.label}</span>
      </button></div>`)}</div>
  </section>`;
}

function DocRow({ m, d, words }) {
  const authors = (d.meta?.authors ?? []).join(', ');
  const textHit = d.match?.in === 'text' && d.snippet;
  const renaming = m.renaming.value === d.id;
  const open = m.menu.value?.doc?.id === d.id;
  const update = m.updates.value.get(d.id);
  const click = (e) => { if (e.target.closest('.rh-more, .rh-rename')) return; if ((e.ctrlKey || e.metaKey) && m.canBeside) m.openBeside(d.id); else m.openDoc(d.id); };
  const key = (e) => {
    const r = e.currentTarget;
    if (e.target !== r) return;
    if (e.key === 'Enter') { e.preventDefault(); m.openDoc(d.id); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); r.nextElementSibling?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (r.previousElementSibling ?? m.searchRef.current)?.focus(); }
    else if (e.key === 'F2') { e.preventDefault(); m.rename(d); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); m.remove(d); }
  };
  return html`<div class=${cx('rh-row', open && 'menu-open')} role="listitem" tabindex="0" data-doc-id=${d.id} data-update=${update ? (update.edited ? 'edited' : 'unedited') : undefined}
      aria-label=${`${d.title || 'Untitled'}${update ? `, ${BADGE.toLowerCase()}` : ''}`}
      onClick=${click} onKeyDown=${key}>
    <div class="rh-main">
      <div class="rh-title-line">
        <div class=${cx('rh-title', !d.title && !renaming && 'untitled')}>
          ${renaming ? html`<${RenameField} m=${m} d=${d} />` : html`<${Marked} text=${d.title || 'Untitled'} words=${words} />`}
        </div>
        ${update && !renaming ? html`<button type="button" class="rh-update" data-action="sample-update" aria-haspopup="dialog"
          aria-label=${`${BADGE}: ${update.edited ? 'open the new version; your edited copy is kept' : 'replace your unedited copy'}`}
          title=${update.edited ? 'Your copy has edits: the new version opens as a new document' : 'Your copy has no edits: replace it with the new version'}
          onClick=${(e) => { e.stopPropagation(); m.sampleUpdate(d); }} onKeyDown=${(e) => e.stopPropagation()}>${BADGE}</button>` : null}
      </div>
      <div class="rh-sub">${authors ? html`<span class="rh-authors"><${Marked} text=${authors} words=${words} /></span>` : null}${d.snippet && !textHit ? `${authors ? ' · ' : ''}${d.snippet}` : null}</div>
      ${textHit ? html`<div class="rh-hit"><${Marked} text=${d.snippet} words=${words} /></div>` : null}
    </div>
    <div class="rh-meta">
      <span class="rh-count">${d.blockCount ?? 0} block${d.blockCount === 1 ? '' : 's'}</span>
      <span class="rh-time" title=${`Edited ${new Date(d.updatedAt).toLocaleString()}`}>${relTime(d.updatedAt)}</span>
    </div>
    <${IconButton} icon="more" quiet class="rh-more" label="More actions" title="Rename, duplicate, export, versions, delete" data-action="more"
      aria-haspopup="menu" aria-expanded=${String(open)} onClick=${(e) => { e.stopPropagation(); m.toggleMenu({ kind: 'row', anchor: e.currentTarget, doc: d }); }} />
  </div>`;
}

function RenameField({ m, d }) {
  const ref = useRef(null);
  const done = useRef(false);
  useLayoutEffect(() => { ref.current.focus(); ref.current.select(); }, []);
  const finish = (save) => { if (done.current) return; done.current = true; m.finishRename(d, save ? ref.current.value : null); };
  return html`<${Input} inputRef=${ref} class="rh-rename" value=${d.title} aria-label="Title" data-action="rename-input"
    onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); }}
    onBlur=${() => finish(true)} onClick=${(e) => e.stopPropagation()} />`;
}

/** The New menu or a row's menu: the kit's Popover drawn as a menu (arrow keys, Escape, a press outside). */
function HomeMenu({ m, menu }) {
  // the focus goes back to the menu's button first (a dialog opened from the menu returns it there)
  const pick = (fn) => () => { menu.anchor?.focus?.({ preventScroll: true }); m.closeMenu(); fn(); };
  const it = (label, action, fn, o = {}) => html`<${MenuItem} key=${action} label=${label} data-action=${action} onSelect=${pick(fn)} ...${o} />`;
  let items;
  if (menu.kind === 'new') {
    items = [
      html`<${MenuLabel} key="l">New document<//>`,
      ...TEMPLATES.map((t) => it(t.label, `template-${t.id}`, () => m.create(t.id), { hint: t.hint })),
      html`<${MenuSeparator} key="s" />`,
      it('Import a file…', 'import-file', () => m.pickFiles(), { hint: '.tex, .zip, .tar.gz' }),
    ];
  } else {
    const d = menu.doc;
    items = [
      it('Open', 'open', () => m.openDoc(d.id)),
      m.canBeside ? it('Open in a new tab', 'open-beside', () => m.openBeside(d.id)) : null,
      it('Rename', 'rename', () => m.rename(d), { shortcut: 'F2' }),
      it('Duplicate', 'duplicate', () => m.duplicate(d)),
      html`<${MenuSeparator} key="s1" />`,
      it('Export .zip', 'export-zip', () => m.exportZip(d), { shortcut: 'all files' }),
      it('Export .tex', 'export-tex', () => m.exportTex(d), { shortcut: 'one file' }),
      it('Versions…', 'versions', () => m.versions(d)),
      m.updates.peek().get(d.id) ? it('Updated sample…', 'sample-update', () => m.sampleUpdate(d), { hint: 'This build has a newer version' }) : null,
      isSeedDoc(d.id) ? it('Reset to original', 'reset-seed', () => m.resetSeed(d), { hint: 'A version is saved first' }) : null,
      html`<${MenuSeparator} key="s2" />`,
      it('Delete', 'delete', () => m.remove(d), { danger: true, icon: 'trash' }),
    ];
  }
  return html`<${Popover} anchor=${menu.anchor} placement="bottom-end" pad=${false} role="menu" class="ui-menu rh-pop"
      label=${menu.kind === 'new' ? 'New document' : `Actions for ${menu.doc.title || 'Untitled'}`} onClose=${m.closeMenu} onKeyDown=${menuKeys}>
    ${items}
  <//>`;
}

/** ↑ ↓ Home End move between a menu's items (the kit's Menu does the same; this menu is the Popover itself). */
function menuKeys(e) {
  const items = [...e.currentTarget.querySelectorAll('.ui-menu-item:not(:disabled)')];
  const k = items.indexOf(document.activeElement);
  const n = e.key === 'ArrowDown' ? (k + 1) % items.length : e.key === 'ArrowUp' ? (k - 1 + items.length) % items.length
    : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
  if (n >= 0 && items.length) { e.preventDefault(); items[n].focus(); }
}

/** The preview pill with the build's version, About · Licence (app/about.js opens it on [data-about]), and
 *  Reset local data… (home/reset-dialog.js; the release and the dev server alike). */
export function HomeFooter({ m }) {
  return html`<footer class="home-foot">
    <button class="rtx-preview-pill" type="button" data-about title="About and licence">${buildVersion().label}</button>
    <${Button} variant="ghost" size="sm" data-about>About · Licence<//>
    <${Button} variant="ghost" size="sm" id="reset-local" data-action="reset-local" aria-haspopup="dialog" title="Forget every document, version and setting kept in this browser"
      onClick=${() => m?.resetLocal()}>Reset local data…<//>
  </footer>`;
}
