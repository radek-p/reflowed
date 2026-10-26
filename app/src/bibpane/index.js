// the References pane: the document's bibliography in the sidebar, next
// to Outline / Problems / TODOs.
//
//   const pane = createBibPane({ h });
//   pane.installDom()          before the app's createPanels (registers its sidebar view: the tab and its panel)
//
// What it does: lists every entry (label, short authors, year, title; the
// venue, DOI/URL and where it is cited when opened), instant search
// (accent-insensitive, every word), filters All / Cited / Not cited / Unknown;
// Cite (button, Enter, drag onto the text) puts \cite{key} at the caret of
// the block being edited, else at the last caret; several selected ->
// \cite{a,b}; inside an existing \cite{…} the key joins it. Add (paste
// BibTeX anywhere in the pane, drop a .bib, DOI/arXiv lookup when online, a
// form), Edit, Delete (warns when cited), Remove unused, Export .bib; each
// change is one undo step and goes through the store (doc.bib, putMeta);
// the bibliography data is rewritten in TS (bib/library.ts) so only the
// bibliography block and the blocks whose citations print differently
// typeset again.
//
// (Preact migration) the pane's view is view.js and the dialogs dialogs.js, on the kit; this module keeps
// the state and the actions and draws the view synchronously in draw(). The sidebar tab and the panel's host are the
// sidebar slot's (a registered view, design/ui/views.js): nothing is made here by hand.
import { readLibrary, applyChanges, searchLibrary, citeSignature, bibSignature, exportBibtex, entryBibtex, parseIdentifier, fold, bibSetup } from '../bib/library.ts';
import { parseBibtex, parseNames } from '../bib/bibtex.ts';
import { texToText } from '../refs/tex-text.ts';
import { scanCites } from '../tex/texscan.js';
import { citeInsertion, citeCommand } from './cite.js';
import { lookupBibtex } from './lookup.js';
import { injectStyle } from './style.ts';
import { bibAssetFor } from './bib-asset.ts';
import { openAddDialog, openEditDialog, confirmDialog } from './dialogs.js';
import { html, render, ensureStyles, openLayer, Popover, Menu, MenuItem } from '../design/ui/index.js';
import { registerView, slotsOf } from '../design/ui/views.ts';   // its sidebar tab as a view (the container's)
import { Pane } from './view.ts';
import { page, onChange } from '../app/page-state.ts';
import { download } from '../io/download.ts';

const PRINTS_BIB = /\\(printbibliography|bibliography\s*\{|printbibheading)/;

// the References pane is a registered side panel (the page's type); its content is each
// container's own pane (installDom(root)), drawn into the host its container gives (mount): one per editor
const panesOf = new WeakMap();                    // editor container -> its References pane
registerView({ id: 'references', title: 'Refs', label: 'References', icon: 'book', tip: 'References: search, cite, add', panel: { side: 'left', order: 40 }, count: true,
  mount: (host, ctx) => panesOf.get(ctx.owner)?.mountInto(host) ?? { unmount() {} } });

export function createBibPane({ h }) {
  let host = null;
  let panel = null;
  let root = null;                           // the editor's container (app/editor-root.ts): installDom(root)
  // view state
  let query = '', filter = 'all';
  let active = null;                         // key with the keyboard's focus (aria-activedescendant)
  const selection = new Set();
  let openKey = null;                        // the entry shown with its details
  let anchor = null;                         // shift-click range start
  let hintTimer = 0;
  let fresh = new Set();
  // data
  let docId = null;
  let bibAsset = null;                       // bibtex documents: the .bib asset { id, name, mime, text }
  let memo = { bib: null, pre: null, text: null, lib: null };
  const pending = new Set();
  const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

  // ── data ───────────────────────────────────────────────────────────────────
  const doc = () => host?.doc() ?? null;
  function lib(d = doc()) {
    // another document than the pane's (an editor of a second document asks for its own): not memoised
    if (d !== doc()) return readLibrary(d?.bib ?? null, { preamble: d?.preamble?.source ?? '', bibtex: d?.bib?.bibtex ?? null });
    const bib = d?.bib ?? null, pre = d?.preamble?.source ?? '';
    const text = bib?.bibtex ?? bibAsset?.text ?? null;
    if (memo.lib && memo.bib === bib && memo.pre === pre && memo.text === text) return memo.lib;
    memo = { bib, pre, text, lib: readLibrary(bib, { preamble: pre, bibtex: text }) };
    return memo.lib;
  }
  const refsState = () => { try { return host.refsState(); } catch { return { cites: [] }; } };
  /** key -> [{blockId, offset, length, cmd}] */
  function usesMap() {
    const out = new Map();
    // `*`: a \nocite{*} (c.all) cites every entry, the key the checks below look for
    for (const c of refsState().cites ?? []) for (const k of c.all ? [...c.keys, '*'] : c.keys) { if (!out.has(k)) out.set(k, []); out.get(k).push(c); }
    return out;
  }
  const usesOf = (key) => usesMap().get(key) ?? [];

  async function loadAsset() {
    const d = doc();
    bibAsset = null;
    if (!d || d.bib?.bibtex) return;
    const a = bibAssetFor({ preamble: d.preamble?.source ?? '', blocks: d.blocks, assets: d.assets ?? [] });
    if (!a) return;
    const full = await host.store.getAsset(d.id, a.id).catch(() => null);
    if (!full?.bytes || doc()?.id !== d.id) return;
    bibAsset = { id: a.id, name: a.name, mime: a.mime || 'text/x-bibtex', text: new TextDecoder().decode(full.bytes) };
    memo.lib = null;
    draw();
  }

  // ── the app's hooks ────────────────────────────────────────────────────────
  /** A comment line the app puts before a block's refs context: what the block's citations print (compile key). */
  function contextFor(block, d = doc()) {   // d: the block's document
    if (!d?.bib || d.bib.kind === 'none') return '';
    const line = (sig) => (sig ? `%rtxbib:${sig}` : '');                 // nothing while unchanged: the keys (and seed cache) stay
    if (block.kind === 'bibliography' || PRINTS_BIB.test(block.source)) return line(bibSignature(d.bib));
    if (!block.source.includes('cite')) return '';
    const cites = scanCites(block.source);
    if (cites.some((c) => c.all)) return line(bibSignature(d.bib));      // \nocite{*}: every entry
    const keys = [...new Set(cites.flatMap((c) => c.keys))];
    if (!keys.length) return '';
    return line(citeSignature(d.bib, keys));
  }
  /** Entries refs does not know (a bibtex document's \bibitem's in doc.bib, a .bib), for autocomplete and problems. */
  function extraBib(d = doc()) {
    const out = {};
    for (const e of lib(d).entries) out[e.key] = { key: e.key, label: e.label, type: e.type, authors: e.people.map((p) => texToText(p.family)), title: e.title, year: e.year, venue: e.venue };
    return out;
  }
  /** Problems panel: an "Add entry…" button on an unknown citation. */
  function problemAction(p) {
    if (p.kind !== 'unknown-cite' || !p.key) return null;
    // the Problems row places a node: a plain button with the kit's classes
    const b = h('button', 'ui-btn ui-btn--sm bp-btn pb-add', { type: 'button', text: `Add entry ${p.key}…`, 'data-key': p.key });
    b.addEventListener('click', (e) => { e.stopPropagation(); addDialog({ key: p.key }); });
    return b;
  }

  // ── where a citation goes ──────────────────────────────────────────────────
  function locator(blockId) {
    const d = doc();
    const i = d.blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return '';
    let sec = null;
    const items = host.outline();
    const pos = new Map(d.blocks.map((b, k) => [b.id, k]));
    for (const it of items) if ((pos.get(it.id) ?? 1e9) <= i && it.level >= 1) sec = it;
    const words = texToText(d.blocks[i].source.replace(/\\begin\{[^}]*\}(\[[^\]]*\])?|\\end\{[^}]*\}|\\(label|cite\w*)\{[^}]*\}/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 42);
    return `${sec ? `${sec.number ? `§${sec.number}` : sec.title.slice(0, 16)} · ` : ''}${words || d.blocks[i].kind}`;
  }
  /** { id, offset, editing, view } or null */
  function target() {
    const ed = host.editing();
    if (ed) return { id: ed.id, offset: ed.view.state.selection.main.to, editing: true, view: ed.view };
    const lc = host.lastCaret();
    if (lc && doc()?.blocks.some((b) => b.id === lc.id)) return { id: lc.id, offset: lc.offset, editing: false };
    return null;
  }
  const targetText = () => { const t = target(); return t ? `the caret in ${locator(t.id)}` : ''; };

  let hintText = '';
  function hint(text) {
    hintText = text;
    draw(true);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintText = ''; draw(true); }, 7000);
  }

  /** \cite{keys} at the caret (or merged into the \cite there). */
  function cite(keys) {
    keys = keys.filter(Boolean);
    if (!keys.length) return false;
    const t = target();
    if (!t) {
      hint('Click in the text where the citation should go, then press Cite. You can also drag a reference onto a paragraph.');
      host.toast('Click in the text first: Cite goes to the caret');
      return false;
    }
    const cmd = citeCommand(refsState().cites);
    if (t.editing) {
      const v = t.view;
      const src = v.state.doc.toString();
      const ins = citeInsertion(src, t.offset, keys, cmd);
      v.dispatch({ changes: { from: ins.from, to: ins.to, insert: ins.insert }, selection: { anchor: ins.caret }, scrollIntoView: true, userEvent: 'input.cite' });
      v.focus();
      announce(keys, t.id, ins);
      return true;
    }
    const b = doc().blocks.find((x) => x.id === t.id);
    const ins = citeInsertion(b.source, t.offset, keys, cmd);
    const next = b.source.slice(0, ins.from) + ins.insert + b.source.slice(ins.to);
    host.setSource(t.id, next);
    host.setLastCaret({ id: t.id, offset: ins.caret });
    host.flash(t.id);
    announce(keys, t.id, ins, true);
    return true;
  }
  function announce(keys, blockId, ins, undoable = false) {
    const L = lib();
    const labels = keys.map((k) => `[${L.byKey.get(k)?.label ?? k}]`).join(' ');
    const what = ins.merged ? (ins.added.length ? `Added ${labels} to the citation` : `${labels} already cited there`) : `Cited ${labels}`;
    host.toast(`${what} · ${locator(blockId)}`, undoable ? () => host.undo() : null);
  }
  /** Drop on a rendered block: the caret where the pointer is (the app's click-to-source), then cite. */
  function citeAtPoint(blockId, ev, keys) {
    host.editAtPoint(blockId, ev);
    requestAnimationFrame(() => cite(keys));
  }

  // ── changes ────────────────────────────────────────────────────────────────
  function preview(upsert) {
    const d = doc();
    const L = lib();
    try {
      const next = applyChanges(d.bib, L, { upsert }, { preamble: d.preamble.source });
      const N = readLibrary(next, { preamble: d.preamble.source, bibtex: next.bibtex ?? null });
      const labels = Object.fromEntries(upsert.map((e) => [e.key, N.byKey.get(e.key)?.label ?? '']));
      const mine = new Set(upsert.map((e) => e.key));
      const shifts = L.entries.filter((e) => !mine.has(e.key) && N.byKey.get(e.key) && N.byKey.get(e.key).label !== e.label).map((e) => [e.label, N.byKey.get(e.key).label]);
      return { labels, shifts, errors: [] };
    } catch (e) { return { labels: {}, shifts: [], errors: [e.message] }; }
  }
  /** Apply a change to doc.bib: one undo step, saved, the .bib asset kept in step, TeX in sync. */
  function change(ch, label) {
    const d = doc();
    const next = applyChanges(d.bib, lib(), ch, { preamble: d.preamble.source });
    if (bibAsset && next.bibtex != null) next.bibtexPath ??= bibAsset.name;
    host.setBib(next, label, (bib) => syncAsset(bib));
    return next;
  }
  function syncAsset(bib) {
    if (!bibAsset || bib?.bibtex == null || bib.bibtex === bibAsset.text) return;
    bibAsset.text = bib.bibtex;
    host.putAsset({ id: bibAsset.id, name: bibAsset.name, mime: bibAsset.mime }, new TextEncoder().encode(bib.bibtex));
  }
  async function add(entries, { cite: andCite = false, replace = [] } = {}) {
    if (!entries.length) return;
    if (replace.length) await host.safety('replacing a reference');
    const before = lib();
    change({ upsert: entries }, entries.length === 1 ? `add ${entries[0].key}` : `add ${entries.length} references`);
    const L = lib();
    fresh = new Set(entries.map((e) => e.key));
    filter = 'all'; query = ''; selection.clear();
    for (const e of entries) selection.add(e.key);
    active = entries[0].key; openKey = entries.length === 1 ? entries[0].key : null;
    draw();
    scrollToActive();
    const labels = entries.map((e) => `[${L.byKey.get(e.key)?.label ?? e.key}]`).join(' ');
    const shifted = before.entries.filter((e) => L.byKey.get(e.key) && L.byKey.get(e.key).label !== e.label).length;
    if (andCite && cite(entries.map((e) => e.key))) return;
    host.toast(`Added ${labels}${replace.length ? ' (replaced)' : ''}${shifted ? ` · ${shifted} other label${shifted === 1 ? '' : 's'} changed` : ''}`, () => host.undo());
  }
  async function save(old, e, { renameCites = true } = {}) {
    const keyChanged = e.key !== old.key;
    const uses = keyChanged && renameCites ? usesOf(old.key) : [];
    if (keyChanged) await host.safety('renaming a reference');
    const entry = { type: e.type, key: e.key, fields: e.fields };
    const ch = { upsert: [entry], remove: keyChanged ? [old.key] : [] };
    if (!uses.length) {
      change(ch, `edit ${e.key}`);
    } else {
      // the key in every citation too: one undo step for all of it
      const d = doc();
      const prevBib = d.bib;
      const next = applyChanges(d.bib, lib(), ch, { preamble: d.preamble.source });
      if (bibAsset) next.bibtexPath ??= bibAsset.name;
      const blocks = [...new Set(uses.map((u) => u.blockId))];
      const olds = new Map(blocks.map((id) => [id, d.blocks.find((b) => b.id === id)?.source ?? '']));
      const news = new Map([...olds].map(([id, s]) => [id, renameKey(s, old.key, e.key)]));
      host.group(`rename ${old.key} to ${e.key}`, () => {
        host.applyBib(next, (bib) => syncAsset(bib));
        for (const [id, s] of news) host.setSource(id, s, { record: false });
      }, () => {
        host.applyBib(prevBib, (bib) => syncAsset(bib));
        for (const [id, s] of olds) host.setSource(id, s, { record: false });
      });
    }
    openKey = e.key; active = e.key; selection.clear(); selection.add(e.key); fresh = new Set([e.key]);
    draw();
    host.toast(`Saved [${lib().byKey.get(e.key)?.label ?? e.key}]${uses.length ? ` · ${uses.length} citation${uses.length === 1 ? '' : 's'} renamed` : ''}`, () => host.undo());
  }
  function renameKey(src, from, to) {
    const cites = scanCites(src).filter((c) => c.keys.includes(from)).sort((a, b) => b.offset - a.offset);
    for (const c of cites) {
      const seg = src.slice(c.offset, c.offset + c.length);
      const open = seg.lastIndexOf('{');
      const inner = seg.slice(open + 1, -1).split(',').map((k) => (k.trim() === from ? k.replace(from, to) : k)).join(',');
      src = src.slice(0, c.offset) + seg.slice(0, open + 1) + inner + '}' + src.slice(c.offset + c.length);
    }
    return src;
  }
  async function remove(keys, { confirm = true } = {}) {
    const L = lib();
    keys = keys.filter((k) => L.byKey.has(k));
    if (!keys.length) return false;
    const um = usesMap();
    const cited = keys.filter((k) => um.get(k)?.length);
    if (confirm && cited.length) {
      const n = cited.reduce((s, k) => s + um.get(k).length, 0);
      const one = keys.length === 1;
      const ok = await confirmDialog({
        title: one ? `Delete [${L.byKey.get(keys[0]).label}]?` : `Delete ${keys.length} references?`,
        body: `${one ? `${keys[0]} is` : `${cited.length} of them are`} cited ${n === 1 ? 'once' : `${n} times`} in the text. Those citations will show as unknown (listed under Problems) until you add the entry again or undo.`,
        ok: 'Delete', danger: true,
      });
      if (!ok) return false;
    }
    await host.safety(keys.length === 1 ? `deleting the reference ${keys[0]}` : `deleting ${keys.length} references`);
    change({ remove: keys }, keys.length === 1 ? `delete ${keys[0]}` : `delete ${keys.length} references`);
    for (const k of keys) selection.delete(k);
    if (keys.includes(openKey)) openKey = null;
    if (keys.includes(active)) active = null;
    draw();
    host.toast(keys.length === 1 ? `Deleted [${L.byKey.get(keys[0]).label}]${cited.length ? ' · its citations are now unknown' : ''}` : `Deleted ${keys.length} references`, () => host.undo());
    return true;
  }
  async function removeUnused() {
    const um = usesMap();
    if ([...um.keys()].includes('*')) { host.toast('\\nocite{*} cites every entry: nothing is unused'); return; }
    const unused = lib().entries.filter((e) => !um.get(e.key)?.length).map((e) => e.key);
    if (!unused.length) { host.toast('Every reference is cited'); return; }
    const ok = await confirmDialog({ title: `Remove ${unused.length} unused reference${unused.length === 1 ? '' : 's'}?`, body: `${unused.join(', ')}: not cited anywhere in the text. You can undo this.`, ok: 'Remove', danger: true });
    if (ok) await remove(unused, { confirm: false });
  }
  function exportBib() {
    const text = exportBibtex(lib());
    download('references.bib', text, 'text/x-bibtex');
    host.toast(`references.bib: ${lib().entries.length} entries`);
    return text;
  }
  const dialogPane = () => ({
    lib, preview, add, save, remove: (keys) => remove(keys), usesOf, target: () => (target() ? targetText() : ''),
    lookup: (v) => lookupBibtex(v), short: (f) => shortOf(f), plain: (s) => texToText(s),
  });
  const shortOf = (f) => {
    const ps = f.author ? parseNames(f.author) : f.editor ? parseNames(f.editor) : [];
    const fam = (p) => texToText(`${p.prefix ? `${p.prefix} ` : ''}${p.family}`);
    return ps.length === 0 ? '' : ps.length === 1 ? fam(ps[0]) : ps.length === 2 ? `${fam(ps[0])} and ${fam(ps[1])}` : `${fam(ps[0])} et al.`;
  };
  const addDialog = (o = {}) => openAddDialog(dialogPane(), o);
  const editDialog = (e) => openEditDialog(dialogPane(), e);

  // ── the pane ───────────────────────────────────────────────────────────────
  const refs = { input: { current: null }, list: { current: null }, body: { current: null } };
  let dropping = false;
  /** this editor's pane (its container), before the sidebar draws its panels */
  function installDom(r) {
    injectStyle();
    ensureStyles();
    if (root) return;
    root = r;
    panesOf.set(root, api);
    root.onDispose(() => panesOf.delete(root));
    // drag an entry onto a rendered block (a CodeMirror editor takes the text/plain itself)
    const blocks = root.part('page')?.querySelector('.blocks');
    if (!blocks) return;
    root.listen(blocks, 'dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('application/x-rtx-cite')) return;
      if (e.target.closest?.('.cm-editor')) return;
      const blk = e.target.closest?.('.blk');
      if (blk && blk.querySelector('.blk-render:not([hidden])')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    root.listen(blocks, 'drop', (e) => {
      if (!e.dataTransfer?.types?.includes('application/x-rtx-cite') || e.target.closest?.('.cm-editor')) return;
      const blk = e.target.closest?.('.blk');
      if (!blk) return;
      e.preventDefault();
      const keys = e.dataTransfer.getData('application/x-rtx-cite').split(',').filter(Boolean);
      citeAtPoint(blk.dataset.id, { clientX: e.clientX, clientY: e.clientY, target: e.target }, keys);
    });
  }
  /** the pane drawn in the host its container gives (the view's mount); unmount: it goes */
  let mounted = null;
  function mountInto(host) {
    // the pane draws into one host: a second mount (the same host again, or another) takes over from the first, whose
    // listeners go (two mounts left two paste listeners: one paste opened the Add dialog twice)
    mounted?.unmount();
    panel = host;
    lastSig = '';                                // a new host is empty: the next draw paints it, whatever was drawn before
    const ac = new AbortController(), on = { signal: ac.signal };
    // "/" anywhere in the pane: the search box
    host.addEventListener('keydown', (e) => {
      const input = refs.input.current;
      if (e.key === '/' && e.target !== input && !e.target.closest?.('input, textarea')) { e.preventDefault(); e.stopPropagation(); input?.focus(); input?.select(); }
    }, on);
    // paste BibTeX (or a DOI) anywhere in the pane
    host.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (/@\s*[a-zA-Z]+\s*[{(]/.test(text)) { e.preventDefault(); addDialog({ text }); return; }
      const id = parseIdentifier(text);
      if (id && e.target !== refs.input.current) { e.preventDefault(); addDialog({ id: text.trim(), tab: 'lookup' }); }
    }, on);
    const mo = new MutationObserver(() => { if (!host.hidden) draw(); });
    mo.observe(host, { attributes: true, attributeFilter: ['hidden'] });
    if (!host.hidden) draw();
    const m = { unmount() { ac.abort(); mo.disconnect(); render(null, host); if (panel === host) panel = null; if (mounted === m) mounted = null; } };
    mounted = m;
    return m;
  }

  /** ⋯: the kit's Menu (↑ ↓ Home End, type-ahead) in a Popover on its button (Esc gives the focus back, a press outside closes it) */
  let menuLayer = null;
  function moreMenu(anchorEl) {
    if (menuLayer) { menuLayer.close(); menuLayer = null; return; }
    const um = usesMap();
    const unused = lib().entries.filter((e) => !um.get(e.key)?.length).length;
    menuLayer = openLayer((close) => {
      const done = () => { close(); menuLayer = null; };
      const it = (label, fn, o = {}) => html`<${MenuItem} label=${label} onSelect=${() => { anchorEl.focus({ preventScroll: true }); done(); fn(); }} ...${o} />`;
      return html`<${Popover} anchor=${anchorEl} placement="bottom-end" pad=${false} role="none" class="bp-menu" onClose=${done}><${Menu} label="References">
        ${it('Add references…', () => addDialog())}
        ${it('Export references.bib', () => exportBib(), { disabled: !lib().entries.length })}
        ${it(`Remove unused${unused ? ` (${unused})` : ''}…`, () => removeUnused(), { disabled: !unused || um.has('*') })}
      <//><//>`;
    });
  }

  /** the rows shown now */
  function visible() {
    const L = lib();
    const um = usesMap();
    const all = um.has('*');
    let list = searchLibrary(L.entries, query);
    if (filter === 'cited') list = list.filter((e) => all || um.get(e.key)?.length);
    else if (filter === 'uncited') list = list.filter((e) => !all && !um.get(e.key)?.length);
    else if (filter === 'unknown') list = [];
    return list;
  }
  function unknownKeys() {
    const L = lib();
    const um = usesMap();
    return [...um.keys()].filter((k) => k !== '*' && !L.byKey.has(k)).sort();
  }

  let lastSig = '';
  function draw(force = false) {
    if (!panel || panel.hidden || !host || !doc()) return;
    const d = doc();
    if (d.id !== docId) { docId = d.id; query = ''; filter = 'all'; active = null; openKey = null; selection.clear(); track(loadAsset()); }
    const L = lib();
    const um = usesMap();
    const rows = visible();
    const unknown = unknownKeys();
    const t = target();
    const sig = [L.entries.length, memo.bib?.source?.length, fnvLite(memo.bib?.source ?? ''), memo.text?.length ?? 0, query, filter, active, openKey, [...selection].join(','), [...fresh].join(','),
      [...um].map(([k, v]) => `${k}:${v.map((u) => u.blockId).join('.')}`).join('|'), unknown.join(','), t ? `${t.id}:${t.editing}` : '', host.outline().length, hintText, dropping].join('\u0001');
    if (sig === lastSig && !force) return;
    lastSig = sig;
    const allCited = um.has('*');
    const nCited = L.entries.filter((e) => allCited || um.get(e.key)?.length).length;
    // tab count: unknown keys (the tab is the sidebar's static tablist's)
    slotsOf(root).badge('references').value = unknown.length ? { n: unknown.length, title: `${unknown.length} cited key${unknown.length === 1 ? '' : 's'} not in the bibliography` } : null;
    if (active && !rows.some((e) => e.key === active)) active = null;
    const sel = [...selection].filter((k) => L.byKey.has(k));
    const setup = bibSetup(d.preamble.source);
    const vm = { L, um, rows, unknown, t, allCited, nCited, sel, setup, query, filter, active, openKey, selection, fresh, hint: hintText, dropping,
      footText: `${L.entries.length} reference${L.entries.length === 1 ? '' : 's'}${L.mode === 'biblatex' ? ` · biblatex${setup.style ? ` ${setup.style}` : ''}` : L.mode === 'bibtex' ? ` · BibTeX ${L.style}` : ''}`,
      footTitle: L.mode === 'bibtex' ? 'New and edited entries are typeset by Reflow TeX, approximating the style; a real LaTeX run with BibTeX regenerates the bibliography from the exported .bib.'
        : L.mode === 'biblatex' ? 'Entries are written as biblatex .bbl records by Reflow TeX (no biber here); the BibTeX is kept for export.' : '' };
    render(html`<${Pane} vm=${vm} m=${viewApi} refs=${refs} />`, panel);
    if (fresh.size) setTimeout(() => { fresh.clear(); }, 1700);
  }
  const fnvLite = (s) => { let x = 0; for (let i = 0; i < s.length; i += 97) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };
  const optId = (key) => `bp-opt-${key.replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0)}`)}`;
  const orderKeys = (keys) => { const L = lib(); return keys.slice().sort((a, b) => (L.byKey.get(a)?.index ?? 0) - (L.byKey.get(b)?.index ?? 0)); };

  function rowClick(ev, e) {
    if (ev.target.closest('.bp-more')) return;
    if (ev.metaKey || ev.ctrlKey) { if (selection.has(e.key)) selection.delete(e.key); else selection.add(e.key); anchor = e.key; }
    else if (ev.shiftKey && anchor) {
      const rows = visible().map((x) => x.key);
      const [a, b] = [rows.indexOf(anchor), rows.indexOf(e.key)].sort((x, y) => x - y);
      if (a >= 0) for (const k of rows.slice(a, b + 1)) selection.add(k);
    } else { selection.clear(); selection.add(e.key); anchor = e.key; openKey = openKey === e.key ? null : e.key; }
    active = e.key;
    draw();
    if (!refs.input.current?.matches(':focus')) refs.list.current?.focus({ preventScroll: true });
  }
  function rowDrag(ev, e) {
    const keys = selection.size > 1 && selection.has(e.key) ? orderKeys([...selection]) : [e.key];
    const cmd = citeCommand(refsState().cites);
    ev.dataTransfer.setData('text/plain', `${cmd}{${keys.join(',')}}`);
    ev.dataTransfer.setData('application/x-rtx-cite', keys.join(','));
    ev.dataTransfer.effectAllowed = 'copy';
  }
  const viewApi = {
    optId, orderKeys, locator, cite, remove: (keys) => remove(keys), addDialog: (o) => addDialog(o), editDialog: (e) => editDialog(e), moreMenu,
    plain: (x) => texToText(x), entry: (k) => lib().byKey.get(k),
    setQuery(v) { query = v; active = null; draw(); },
    setFilter(key) { filter = filter === key && key !== 'all' ? 'all' : key; active = null; draw(); },
    clearSelection() { selection.clear(); draw(); },
    citeRow(e) { active = e.key; cite(selection.size > 1 && selection.has(e.key) ? orderKeys([...selection]) : [e.key]); },
    rowClick, rowDrag, onKey: (e) => onKey(e),
    showUse(u) { if (u) host.revealBlock(u.blockId, { from: u.offset, to: u.offset + u.length }); },
    reveal(blockId) { host.revealBlock(blockId, null, { edit: false }); },
    copyKey(k) { navigator.clipboard?.writeText(k).then(() => host.toast(`Copied ${k}`), () => host.toast(k)); },
    // drop a .bib file on the list
    bodyDragOver(e) { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); if (!dropping) { dropping = true; draw(); } } },
    bodyDragLeave() { if (dropping) { dropping = false; draw(); } },
    async bodyDrop(e) {
      if (dropping) { dropping = false; draw(); }
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => /\.(bib|txt)$/i.test(x.name)) ?? e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      addDialog({ text: await f.text() });
    },
  };

  function scrollToActive() {
    requestAnimationFrame(() => panel?.querySelector(`[id="${CSS.escape(optId(active ?? ''))}"]`)?.scrollIntoView({ block: 'nearest' }));
  }
  function onKey(e) {
    const rows = visible().map((x) => x.key);
    const i = active ? rows.indexOf(active) : -1;
    const move = (k) => {
      if (!rows.length) return;
      const n = Math.max(0, Math.min(rows.length - 1, k));
      const prev = active;
      active = rows[n];
      if (e.shiftKey) { if (prev) selection.add(prev); selection.add(active); }
      draw(); scrollToActive();
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(i < 0 ? 0 : i + 1); break;
      case 'ArrowUp': e.preventDefault(); move(i <= 0 ? 0 : i - 1); break;
      case 'Home': if (e.target === refs.list.current) { e.preventDefault(); move(0); } break;
      case 'End': if (e.target === refs.list.current) { e.preventDefault(); move(rows.length - 1); } break;
      case 'Enter': {
        e.preventDefault();
        const key = active ?? (rows.length === 1 || query ? rows[0] : null);
        if (e.altKey && key) { editDialog(lib().byKey.get(key)); break; }
        if (selection.size > 1 && (!key || selection.has(key))) cite(orderKeys([...selection]));
        else if (key) { active = key; cite([key]); }
        break;
      }
      case ' ':
        if (e.target === refs.list.current && active) { e.preventDefault(); if (selection.has(active)) selection.delete(active); else selection.add(active); draw(); }
        break;
      case 'Escape':
        e.preventDefault();
        if (query) { query = ''; draw(); }
        else if (selection.size > 1) { selection.clear(); draw(); }
        else { const ed = host.editing(); if (ed) ed.view.focus(); else e.target.blur(); }
        break;
      default:
        if (e.target === refs.list.current && e.key.length === 1 && !e.metaKey && !e.ctrlKey && e.key !== '/' && e.key !== ' ') { refs.input.current?.focus(); }
    }
    // a key the pane handled is not the page's too (app.js moves the block selection on ↑↓ and j/k when the focus is
    // not in a field: with the list focused, ↓ moved the focus to the document)
    if (e.defaultPrevented) e.stopPropagation();
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  function connect(h0) {
    host = h0;
    // the container's signals (app/page-state.ts) and the page's route
    const again = () => { memo = { bib: null, pre: null, text: null, lib: null }; lastSig = ''; draw(); };
    root.onDispose(onChange(root.state.refreshed, () => draw()));
    root.onDispose(onChange(page.route, again));
    // the current document changed (the focused pane shows another one): the pane follows it
    root.onDispose(onChange(root.state.current, again));
    // the target line follows the caret's block
    root.listen(root.el, 'focusin', (e) => { if (e.target.closest?.('.cm-editor')) draw(); });
  }
  function show() {
    slotsOf(root).show('references');
    return new Promise((r) => requestAnimationFrame(() => { draw(true); r(); }));
  }
  /** the pane open on a citation's entries (the first with its details): its row shown with its details, scrolled into view, the list's focus on it */
  async function reveal(keys) {
    const ks = [].concat(keys).filter(Boolean), key = ks[0];
    if (!key) return false;
    await show();                                  // (its first draw takes the document: then the entry)
    query = ''; filter = 'all'; active = key; openKey = key; selection.clear(); for (const k of ks) selection.add(k);
    draw(true);
    const row = panel?.querySelector(`li.bp-row[data-key="${CSS.escape(key)}"]`);
    if (!row) return false;
    row.scrollIntoView({ block: 'nearest' });
    refs.list.current?.focus({ preventScroll: true });
    return true;
  }

  const api = {
    installDom, mountInto, connect, contextFor, extraBib, problemAction,
    // tests (editorAPI.bibpane())
    show, reveal, draw: () => draw(true), library: () => lib(), cite, add, remove, removeUnused, exportBib, addDialog, editDialog, usesOf, unknownKeys,
    target: () => { const t = target(); return t ? { id: t.id, offset: t.offset, editing: t.editing } : null; },
    idle: async () => { while (pending.size) await Promise.all([...pending]).catch(() => {}); },
    state: () => ({ query, filter, active, open: openKey, selection: [...selection] }),
  };
  return api;
}
