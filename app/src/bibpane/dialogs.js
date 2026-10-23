// the References pane's dialogs, on the kit's Dialog (Preact): Add (paste BibTeX / DOI or arXiv / a
// form), Edit (a field form over the BibTeX, or the BibTeX itself), and a small confirm. The pane gives them
// what they need (`pane` below) and they never touch the document themselves.
//
//   openAddDialog(pane, { text?, key?, tab?, id? })     -> Promise<void>     (resolves when it closes)
//   openEditDialog(pane, entry)                          -> Promise<void>
//   confirmDialog({ title, body, ok, danger })           -> Promise<boolean>
//
// pane: { lib(), preview(upsert) -> { labels, shifts, errors }, add(entries, { cite, replace }),
//         save(old, entry, { renameCites }), remove(keys), usesOf(key), target(), lookup(id), short(fields), plain(tex) }
// Hooks kept: dialog.bp-dialog (.bp-add-dialog, .bp-edit-dialog, .bp-confirm), [data-tab], [data-field], .bp-preview
// .bp-prev (.bp-label, .bp-title, .bp-key2, .bp-clash with radios), .bp-shift, .bp-note, .bp-err, .bp-ok, .bp-toggle.
// Esc, the close button and a press on the backdrop close a dialog; ⌘/Ctrl+Enter adds or saves.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, ensureStyles, openLayer, Button, Dialog, Input, Select } from '../design/ui/index.js';
import { formatBibtex, fold, makeKey, cleanFetched, parseIdentifier } from '../bib/library.ts';
import { parseBibtex } from '../bib/bibtex.ts';

const TYPES = ['article', 'inproceedings', 'book', 'incollection', 'phdthesis', 'mastersthesis', 'techreport', 'misc', 'unpublished'];
const TYPE_LABEL = { article: 'Journal article', inproceedings: 'Conference paper', book: 'Book', incollection: 'Book chapter', phdthesis: 'PhD thesis',
  mastersthesis: "Master's thesis", techreport: 'Report', misc: 'Other (preprint, web page…)', unpublished: 'Unpublished' };
const FORM = {
  article: ['journal', 'volume', 'number', 'pages'],
  inproceedings: ['booktitle', 'series', 'volume', 'pages', 'publisher'],
  incollection: ['booktitle', 'editor', 'pages', 'publisher'],
  book: ['publisher', 'address', 'edition'],
  phdthesis: ['school'], mastersthesis: ['school'],
  techreport: ['institution', 'number'],
  misc: ['howpublished', 'eprint', 'archiveprefix'],
  unpublished: ['note'],
};
const LABELS = { author: 'Authors', editor: 'Editors', title: 'Title', year: 'Year', journal: 'Journal', booktitle: 'Proceedings', series: 'Series', volume: 'Volume',
  number: 'Number', pages: 'Pages', publisher: 'Publisher', address: 'Address', edition: 'Edition', school: 'School', institution: 'Institution', howpublished: 'Published',
  eprint: 'arXiv id', archiveprefix: 'Archive', note: 'Note', doi: 'DOI', url: 'URL', key: 'Key' };
const HINTS = { author: 'Last, First and Last, First', pages: '12--34', doi: '10.1145/…', year: '2025', eprint: '2602.12926' };

/** One dialog as a layer; resolves when it has closed. `make(close)` gives the Dialog's vnode. */
function layer(make) {
  ensureStyles();
  const back = document.activeElement;
  return new Promise((resolve) => {
    openLayer((close) => make(() => { close(); if (back?.isConnected) back.focus?.({ preventScroll: true }); resolve(); }));
  });
}
const closeOf = (e) => e.currentTarget.closest('dialog')?.close();
const backdrop = (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); };

/** A small yes/no dialog. */
export function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  let answer = false;
  return layer((done) => html`<${Dialog} class="bp-dialog bp-confirm" title=${title} onClose=${done} onClick=${backdrop}
      footer=${[html`<${Button} variant="ghost" onClick=${closeOf}>Cancel<//>`,
        html`<${Button} variant=${danger ? 'danger' : 'primary'} class=${danger ? 'bp-danger-fill' : ''} autofocus onClick=${(e) => { answer = true; closeOf(e); }}>${ok}<//>`]}>
    <p class="bp-confirm-text">${body}</p>
  <//>`).then(() => answer);
}

// ── the field form (Add → "Type it in", Edit) ────────────────────────────────

/** form: { type, key, fields } kept in a ref (the dialog reads it on each change); onChange after every edit. */
function FieldForm({ form, keyLocked = false, onChange, autofocus = null }) {
  const [raw, setRaw] = useState(false);
  const [, tick] = useState(0);
  const [rawErr, setRawErr] = useState('');
  const f = form.current;
  const changed = () => { tick((n) => n + 1); onChange(); };
  const input = (name, { area = false } = {}) => {
    const value = name === 'key' ? f.key : f.fields[name] ?? '';
    const set = (v) => {
      if (name === 'key') f.key = v.trim();
      else if (v.trim()) f.fields[name] = v.trim(); else delete f.fields[name];
      changed();
    };
    const props = { id: `bp-f-${name}`, 'data-field': name, spellcheck: 'false', value, onInput: (e) => set(e.currentTarget.value), autofocus: autofocus === name };
    return [html`<label for=${`bp-f-${name}`}>${LABELS[name] ?? name}</label>`, area
      ? html`<textarea class="ui-input bp-area" rows="2" ...${props}></textarea>`
      : html`<${Input} type="text" placeholder=${HINTS[name] ?? ''} readOnly=${name === 'key' && keyLocked} title=${name === 'key' && keyLocked ? 'The key the text cites' : undefined} ...${props} />`];
  };
  if (raw) {
    return html`<div class="bp-formwrap">
      <textarea class="ui-input ui-input--mono bp-raw" rows="14" spellcheck="false" aria-label="BibTeX" autofocus
        value=${formatBibtex({ type: f.type, key: f.key || 'key', fields: f.fields })}
        onInput=${(ev) => {
          const p = parseBibtex(ev.currentTarget.value);
          const e = p.entries[0];
          if (!e || p.errors.length) { setRawErr(p.errors[0] ?? 'Write one @type{key, field = {…}, …} entry.'); return; }
          setRawErr('');
          f.type = e.type; if (!keyLocked) f.key = e.key;
          f.fields = { ...e.fields };
          onChange();
        }}></textarea>
      ${rawErr ? html`<p class="bp-err">${rawErr}</p>` : null}
      <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm bp-toggle" onClick=${() => setRaw(false)}>Edit as a form</button>
    </div>`;
  }
  const shown = new Set(['author', 'title', 'year', 'doi', 'url', ...(FORM[f.type] ?? [])]);
  const rest = Object.keys(f.fields).filter((k) => !shown.has(k));
  return html`<div class="bp-formwrap">
    <div class="bp-form">
      <label for="bp-f-type">Type</label>
      <${Select} id="bp-f-type" aria-label="Type" value=${f.type} onChange=${(e) => { f.type = e.currentTarget.value; changed(); }}>
        ${[...new Set([...TYPES, f.type])].map((t) => html`<option value=${t}>${TYPE_LABEL[t] ?? t}</option>`)}
      <//>
      ${input('key')}
      ${input('author', { area: true })}
      ${input('title', { area: true })}
      ${input('year')}
      ${(FORM[f.type] ?? []).map((k) => input(k))}
      ${input('doi')}
      ${input('url')}
      <label for="bp-f-other">Other fields</label>
      <textarea class="ui-input bp-area" id="bp-f-other" rows=${String(Math.min(6, Math.max(2, rest.length)))} spellcheck="false" placeholder="note = {…}" aria-label="Other fields"
        value=${rest.map((k) => `${k} = {${f.fields[k]}}`).join('\n')}
        onInput=${(ev) => {
          for (const k of Object.keys(f.fields)) if (!shown.has(k)) delete f.fields[k];
          const p = parseBibtex(`@x{k,\n${ev.currentTarget.value}\n}`).entries[0];
          if (p) for (const [k, v] of Object.entries(p.fields)) if (!shown.has(k)) f.fields[k] = v;
          onChange();
        }}></textarea>
    </div>
    <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm bp-toggle" onClick=${() => setRaw(true)}>Edit as BibTeX</button>
  </div>`;
}

// ── Add ─────────────────────────────────────────────────────────────────────

const TABS = [['paste', 'Paste BibTeX'], ['lookup', 'DOI or arXiv'], ['form', 'Type it in']];

function AddBody({ pane, text, keyIn, tab, id, setFooter }) {
  const [now, setNow] = useState(tab ?? (text ? 'paste' : id ? 'lookup' : keyIn ? 'form' : 'paste'));
  const [, tick] = useState(0);
  const redraw = () => tick((n) => n + 1);
  const st = useRef(null);
  if (!st.current) st.current = { pasted: parseBibtex(text), pasteText: text, fetched: null, idText: id, look: { kind: 'note', text: 'Fetches the record from doi.org (arXiv ids through their DataCite DOI). Needs the internet; nothing else is sent anywhere.' }, busy: false,
    clash: new Map(), useKey: !!keyIn };
  const s = st.current;
  const form = useRef({ type: 'article', key: keyIn ?? '', fields: {} });
  const root = useRef(null);

  const freeKey = (k, lib) => { for (let i = 2; ; i++) if (!lib.byKey.has(`${k}-${i}`)) return `${k}-${i}`; };
  /** what would be added, after the clash choices */
  function planned() {
    const src = now === 'paste' ? s.pasted : now === 'lookup' ? s.fetched : (() => {
      const e = { ...form.current, fields: { ...form.current.fields } };
      if (!e.fields.title && !e.fields.author) return { entries: [], errors: [] };
      if (!e.key) e.key = makeKey(e.fields, (k) => pane.lib().byKey.has(k));
      return { entries: [e], errors: [] };
    })();
    if (!src) return { list: [], errors: [] };
    const lib = pane.lib();
    const list = [];
    const seen = new Set();
    for (const e0 of src.entries) {
      const e = { type: e0.type, key: e0.key, fields: { ...e0.fields } };
      if (keyIn && s.useKey && src.entries.length === 1) e.key = keyIn;
      const old = lib.byKey.get(e.key);
      const dup = !old && lib.entries.find((x) => (e.fields.doi && x.doi && x.doi.toLowerCase() === e.fields.doi.toLowerCase())
        || (fold(x.title) && fold(x.title) === fold(e.fields.title ?? '') && x.year === (e.fields.year ?? '')));
      let c = s.clash.get(e0.key);
      if (old && !c) {
        const same = fold(old.title) === fold(e.fields.title ?? '') && old.year === (e.fields.year ?? '');
        c = { action: same ? 'skip' : 'new', newKey: freeKey(e.key, lib) };
        s.clash.set(e0.key, c);
      }
      if (dup && !c) { c = { action: 'skip', dup: true, newKey: e.key }; s.clash.set(e0.key, c); }
      const item = { entry: e, old, dup, choice: c ?? null };
      if (c?.action === 'new' && old) item.entry = { ...e, key: c.newKey };
      if (seen.has(item.entry.key)) continue;
      seen.add(item.entry.key);
      list.push(item);
    }
    return { list, errors: src.errors ?? [] };
  }
  const commit = async (cite, e) => {
    const { list } = planned();
    const adding = list.filter((x) => x.choice?.action !== 'skip');
    if (!adding.length) return;
    root.current.closest('dialog')?.close();
    await pane.add(adding.map((x) => x.entry), { cite, replace: adding.filter((x) => x.choice?.action === 'replace').map((x) => x.entry.key) });
  };
  async function doLookup() {
    const v = (s.idText ?? '').trim();
    if (!v) return;
    s.busy = true; s.look = { kind: 'note', text: `Asking doi.org for ${v}…` }; redraw();
    try {
      const r = await pane.lookup(v);
      const e = cleanFetched(r.bibtex, (k) => pane.lib().byKey.has(k));
      if (!e) throw new Error('The record could not be read.');
      if (keyIn) e.key = keyIn;
      s.fetched = { entries: [e], errors: [] };
      s.look = { kind: 'ok', text: `Found: ${r.id.kind === 'arxiv' ? `arXiv:${r.id.id}` : r.doi}. Check it below, then add.` };
    } catch (err) {
      s.fetched = null;
      s.look = { kind: 'err', text: err.message };
    } finally { s.busy = false; redraw(); }
  }
  // a lookup asked for on opening
  useLayoutEffect(() => { if (now === 'lookup' && id && parseIdentifier(id)) doLookup(); }, []);
  // ⌘/Ctrl+Enter adds; the footer (outside this body) is drawn from here
  useLayoutEffect(() => {
    const d = root.current.closest('dialog');
    const key = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(false); } };
    d.addEventListener('keydown', key);
    return () => d.removeEventListener('keydown', key);
  });
  const show = (k) => {
    setNow(k);
    requestAnimationFrame(() => root.current?.querySelector(k === 'paste' ? '.bp-paste' : k === 'lookup' ? '.bp-lookup input' : '[data-field="author"], [data-field="key"]')?.focus());
  };

  const { list, errors } = planned();
  const adding = list.filter((x) => !(x.choice?.action === 'skip'));
  const pv = pane.preview(adding.map((x) => x.entry));
  const n = adding.length;
  const tgt = pane.target();
  useLayoutEffect(() => setFooter({ n, tgt, commit }));

  return html`<div ref=${root} class="bp-addbody">
    <div class="ui-seg bp-seg" role="tablist" aria-label="How to add">
      ${TABS.map(([k, label]) => html`<button key=${k} type="button" role="tab" data-tab=${k} aria-selected=${String(now === k)} onClick=${() => show(k)}>${label}</button>`)}
    </div>
    <div class="bp-tabhost">
      ${now === 'paste' ? html`<div onDragOver=${(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
          onDrop=${async (e) => { const fl = e.dataTransfer?.files?.[0]; if (!fl) return; e.preventDefault(); s.pasteText = await fl.text(); s.pasted = parseBibtex(s.pasteText); redraw(); }}>
        <textarea class="ui-input ui-input--mono bp-paste" rows="9" spellcheck="false" aria-label="BibTeX" autofocus=${tab == null || tab === 'paste'}
          placeholder=${'@article{key,\n  author = {Last, First and …},\n  title  = {…},\n  year   = {2025},\n}'} value=${s.pasteText}
          onInput=${(e) => { s.pasteText = e.currentTarget.value; s.pasted = parseBibtex(s.pasteText); redraw(); }}></textarea>
        <p class="bp-note">One entry or many: from Google Scholar, DBLP, a publisher's "Cite" button, or a .bib file (you can also drop the file here).</p>
      </div>` : null}
      ${now === 'lookup' ? html`<div>
        <div class="bp-lookup">
          <${Input} type="text" placeholder="10.1145/3531130.3533367  or  2602.12926" spellcheck="false" aria-label="DOI or arXiv id" value=${s.idText} autofocus
            onInput=${(e) => { s.idText = e.currentTarget.value; }} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } }} />
          <${Button} variant="primary" disabled=${s.busy} onClick=${doLookup}>${s.busy ? 'Looking up…' : 'Look up'}<//>
        </div>
        <p class=${`bp-${s.look.kind}`}>${s.look.text}</p>
      </div>` : null}
      ${now === 'form' ? html`<${FieldForm} form=${form} keyLocked=${!!keyIn} onChange=${redraw} autofocus=${keyIn ? 'author' : 'key'} />` : null}
    </div>
    <div class="bp-preview" aria-live="polite">
      ${errors.length && now === 'paste' ? html`<p class="bp-err">Could not read all of it: ${errors.slice(0, 2).join('; ')}</p>` : null}
      ${keyIn && now === 'paste' && list.length === 1 && list[0].entry && s.pasted.entries[0]?.key !== keyIn ? html`<label class="bp-note bp-check">
        <input type="checkbox" checked=${s.useKey} onChange=${(e) => { s.useKey = e.currentTarget.checked; redraw(); }} />
        Use the key ${keyIn} (what the text cites) instead of ${s.pasted.entries[0].key}</label>` : null}
      ${list.map((it) => html`<${Preview} key=${it.entry.key} it=${it} pv=${pv} pane=${pane} redraw=${redraw} />`)}
      ${pv.shifts.length ? html`<p class="bp-shift">Also changes ${pv.shifts.length <= 3 ? pv.shifts.map(([a, b]) => `[${a}] → [${b}]`).join(', ') : `${pv.shifts.length} other labels (numbering)`}; the blocks citing them are typeset again.</p>` : null}
    </div>
  </div>`;
}

function Preview({ it, pv, pane, redraw }) {
  const e = it.entry;
  const skip = it.choice?.action === 'skip';
  const label = skip ? (it.old ?? it.dup)?.label : pv.labels[e.key];
  const other = it.old ?? it.dup;
  const opts = it.old ? [['new', `Keep both (new key ${it.choice?.newKey})`], ['replace', `Replace [${other?.label}]`], ['skip', 'Skip']] : [['skip', 'Skip'], ['add', 'Add anyway']];
  return html`<div class=${`bp-prev${skip ? ' skip' : ''}`} data-key=${e.key}>
    <div class="bp-l1"><span class="bp-label">${label ? `[${label}]` : ''}</span><span class="bp-who">${pane.short(e.fields)}</span><span class="bp-year">${e.fields.year ?? ''}</span></div>
    <div class="bp-title">${pane.plain(e.fields.title ?? '(no title)')}</div>
    <div class="bp-key2">${e.type} · ${e.key}</div>
    ${other ? html`<div class="bp-clash">
      ${it.old ? `The key ${other.key} is taken by [${other.label}] ${other.authors ? `${other.authors}, ` : ''}“${other.title.slice(0, 70)}${other.title.length > 70 ? '…' : ''}”.`
        : `This looks like [${other.label}] (${other.key}), already in the bibliography.`}
      <div class="bp-choices" role="radiogroup" aria-label=${`What to do with ${other.key}`}>
        ${opts.map(([v, txt]) => html`<label key=${v}><input type="radio" name=${`clash-${e.key}-${other.key}`} value=${v}
          checked=${(it.choice.action === v) || (v === 'add' && it.choice.action !== 'skip')}
          onChange=${() => { it.choice.action = v === 'add' ? 'keep' : v; redraw(); }} />${txt}</label>`)}
      </div>
    </div>` : null}
  </div>`;
}

/** Add references: paste BibTeX, look up a DOI or arXiv id, or fill a form; a preview (labels, clashes) before adding. */
export function openAddDialog(pane, { text = '', key = null, tab = null, id = '' } = {}) {
  return layer((done) => html`<${AddDialog} pane=${pane} text=${text} keyIn=${key} tab=${tab} id=${id} done=${done} />`);
}
function AddDialog({ pane, text, keyIn, tab, id, done }) {
  // the footer shows what the body plans; the body hands its commit over through a ref (a new function each render)
  const [foot, setFoot] = useState({ n: 0, tgt: '' });
  const commitRef = useRef(() => {});
  const setFooter = (f) => { commitRef.current = f.commit; if (f.n !== foot.n || f.tgt !== foot.tgt) setFoot({ n: f.n, tgt: f.tgt }); };
  const { n, tgt } = foot;
  return html`<${Dialog} class="bp-dialog bp-add-dialog" wide title=${keyIn ? `Add ${keyIn}` : 'Add references'} onClose=${done} onClick=${backdrop}
      footer=${[html`<span class="grow">${tgt ? `Cite goes to ${tgt}` : ''}</span>`,
        html`<${Button} variant="ghost" onClick=${closeOf}>Cancel<//>`,
        html`<${Button} hidden=${!tgt} disabled=${!n} onClick=${() => commitRef.current(true)}>${n > 1 ? `Add and cite ${n}` : 'Add and cite'}<//>`,
        html`<${Button} variant="primary" disabled=${!n} onClick=${() => commitRef.current(false)}>${n > 1 ? `Add ${n} references` : 'Add'}<//>`]}>
    <${AddBody} pane=${pane} text=${text} keyIn=${keyIn} tab=${tab} id=${id} setFooter=${setFooter} />
  <//>`;
}

// ── Edit ─────────────────────────────────────────────────────────────────────

export function openEditDialog(pane, entry) {
  return layer((done) => html`<${EditDialog} pane=${pane} entry=${entry} done=${done} />`);
}
function EditDialog({ pane, entry, done }) {
  const uses = pane.usesOf(entry.key);
  const form = useRef({ type: entry.type, key: entry.key, fields: { ...entry.fields } });
  const [rename, setRename] = useState(true);
  const [, tick] = useState(0);
  const e = form.current;
  const taken = e.key !== entry.key && pane.lib().byKey.has(e.key);
  const err = !e.key ? 'The entry needs a key.' : taken ? `The key ${e.key} is taken by another entry.` : '';
  const showRename = !!(e.key && e.key !== entry.key && uses.length);
  const canSave = !taken && !!e.key;
  const save = async (ev) => {
    if (!canSave) return;
    const out = { type: e.type, key: e.key, fields: { ...e.fields } };
    ev.currentTarget.closest('dialog')?.close();
    await pane.save(entry, out, { renameCites: rename });
  };
  return html`<${Dialog} class="bp-dialog bp-edit-dialog" wide title=${`Edit [${entry.label}]`} onClose=${done} onClick=${backdrop}
      onKeyDown=${(ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && canSave) { ev.preventDefault(); save(ev); } }}
      footer=${[html`<${Button} variant="danger" onClick=${async (ev) => { closeOf(ev); await pane.remove([entry.key]); }}>Delete…<//>`,
        html`<span class="grow"></span>`,
        html`<${Button} variant="ghost" onClick=${closeOf}>Cancel<//>`,
        html`<${Button} variant="primary" disabled=${!canSave} onClick=${save}>Save<//>`]}>
    <${FieldForm} form=${form} onChange=${() => tick((x) => x + 1)} autofocus="title" />
    ${showRename ? html`<label class="bp-note bp-check"><input type="checkbox" checked=${rename} onChange=${(ev) => setRename(ev.currentTarget.checked)} />
      Also change the key in the ${uses.length} citation${uses.length === 1 ? '' : 's'}</label>` : null}
    ${err ? html`<p class="bp-err">${err}</p>` : null}
    ${!entry.hasBibtex ? html`<p class="bp-note">Converted from the .bbl (the BibTeX it was made from is not in this document); saving keeps it as BibTeX too.</p>` : null}
  <//>`;
}
