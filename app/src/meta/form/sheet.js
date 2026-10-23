// the title and authors sheet: title fields, the authors, the affiliations, a live preview (the
// class's own \maketitle, compiled with the edited data), the \ReflowedMeta source. Edits stay in the
// sheet until it closes: Done, Esc or a press outside apply them as one undoable preamble edit; Cancel
// discards. A document whose title is written with \title and \author is offered the conversion first
// (one undoable edit of its own, never automatic).
// The content only: it renders the kit's Frame (design/ui/views.js); the container it is opened in (THE
// kit Sheet, via openView) draws the header, the footer and the scrim.
import { html, cx } from '../../design/ui/core.js';
import { Frame } from '../../design/ui/views.js';
import { Button, IconButton } from '../../design/ui/controls.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { get, isTrue, readMeta } from '../model.ts';
import { writeMeta } from '../write.ts';
import { convertPreamble } from '../import.ts';
import { addAuthor, affilId, affilLabel, affilNumbers, affilUses, removeAffil, setAffilField, setTop, ANON_OPTION_CLASSES, classOptionSet, withClassOption } from '../edit.ts';
import { metaCommands } from '../model.ts';
import { ValueField, FlagField } from './fields.js';
import { Authors } from './authors.js';
import { ensureFormStyles } from './style.js';

let keySeq = 0;
const keyed = (m) => { m.authors.forEach((a) => { if (!a.key) a.key = `k${++keySeq}`; }); return m; };
const ARTICLE_LIKE = /^(article|report|book|scrartcl|scrreprt|scrbook|memoir|extarticle)$/;

/** host: the app's hook (index.js); pre0: the preamble at open; done(preamble | null) */
export function TitleForm({ host, pre0, cls, blockId, done }) {
  ensureFormStyles();
  const [pre, setPre] = useState(pre0);                      // after a conversion: the converted preamble
  const read = useMemo(() => readMeta(pre), [pre]);
  const [meta, setMetaRaw] = useState(() => keyed(read.meta));
  const setMeta = (m) => setMetaRaw(keyed(m));
  const [expanded, setExpanded] = useState(null);            // the open author's key (follows it when it moves)
  const [removed, setRemoved] = useState(null);              // { label, before }
  const hasAnonOption = ANON_OPTION_CLASSES.test(cls);
  const [anonOpt, setAnonOpt] = useState(() => classOptionSet(pre0, 'anonymous'));
  const flags = { breakAfter: ARTICLE_LIKE.test(cls) };

  const next = useMemo(() => {
    if (!read.cmd) return pre;
    let p = writeMeta(pre, meta);
    if (hasAnonOption) p = withClassOption(p, 'anonymous', anonOpt);
    return p;
  }, [pre, meta, anonOpt]);
  const finish = (apply) => done(apply ? next : null);
  useEffect(() => { if (!removed) return; const t = setTimeout(() => setRemoved(null), 8000); return () => clearTimeout(t); }, [removed]);

  const footer = html`<${Button} variant="ghost" class="mf-cancel" onClick=${() => finish(false)}>Cancel<//>
    <${Button} variant="primary" class="mf-done" onClick=${() => finish(true)}>Done<//>`;
  return html`<${Frame} class="mf-sheet" title="Title and authors" onClose=${() => finish(true)} footer=${read.cmd ? footer : null}>
    ${read.cmd ? html`
      ${read.more ? html`<div class="mf-note">Also set in the preamble: ${read.more} more \\ReflowedMeta (not edited here).</div>` : null}
      <section class="mf-section" aria-label="Title">
        <${ValueField} name="title" label="Title" value=${get(meta.top, 'title') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'title', v ?? ''))} multiline />
        <${ValueField} name="subtitle" label="Subtitle" value=${get(meta.top, 'subtitle') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'subtitle', v || undefined))} />
        <${FlagField} name="anonymous" label="Anonymous submission" hint=${hasAnonOption ? `The class option anonymous (${cls}) hides the authors` : 'The authors print as "Anonymous author(s)"; the data stays in the file'}
          on=${hasAnonOption ? anonOpt : isTrue(meta.top, 'anonymous')} onChange=${(on) => (hasAnonOption ? setAnonOpt(on) : setMeta(setTop(meta, 'anonymous', on ? null : undefined)))} />
        <details class="mf-more"><summary>More: running title, date, keywords, notes, funding</summary>
          <${ValueField} name="short-title" label="Running title" value=${get(meta.top, 'short-title') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'short-title', v || undefined))} />
          <${ValueField} name="short-authors" label="Running authors" value=${get(meta.top, 'short-authors') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'short-authors', v || undefined))} />
          <${ValueField} name="date" label="Date" hint="Empty: no date. Remove the key in the source for today's date." value=${get(meta.top, 'date') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'date', v ?? ''))} />
          <${ValueField} name="keywords" label="Keywords" value=${get(meta.top, 'keywords') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'keywords', v || undefined))} />
          <${ValueField} name="thanks" label="Note on the title" value=${get(meta.top, 'thanks') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'thanks', v || undefined))} multiline />
          <${ValueField} name="funding" label="Funding" value=${get(meta.top, 'funding') ?? undefined} onChange=${(v) => setMeta(setTop(meta, 'funding', v || undefined))} multiline />
        </details>
      </section>
      <section class="mf-section" aria-labelledby="mf-authors-h">
        <div class="mf-section-head"><h3 id="mf-authors-h">Authors</h3>
          <${Button} size="sm" variant="ghost" icon="plus" class="mf-add-author" onClick=${() => { const m = keyed(addAuthor(meta)); setMeta(m); setExpanded(m.authors[m.authors.length - 1].key); }}>Add<//></div>
        <${Authors} meta=${meta} set=${setMeta} expanded=${expanded} setExpanded=${setExpanded} flags=${flags}
          onRemoved=${(label, before) => setRemoved({ label, before })} />
        ${removed ? html`<div class="mf-removed" role="status">Removed ${removed.label}.
          <${Button} size="sm" variant="ghost" icon="undo" class="mf-undo" onClick=${() => { setMeta(removed.before); setRemoved(null); }}>Undo<//></div>` : null}
      </section>
      <${Affiliations} meta=${meta} setMeta=${setMeta} />
      <${Preview} host=${host} blockId=${blockId} pre=${next} />
      <details class="mf-source"><summary>Source</summary><pre class="mf-pre">${sourceOf(next)}</pre></details>
    ` : html`<${Convert} pre=${pre} cls=${cls} onConvert=${(p) => { host.apply('Convert the title to the form', p); setPre(p); setMetaRaw(keyed(readMeta(p).meta)); }}
        editSource=${() => { done(null); host.editSource(blockId); }} />`}
  <//>`;
}

const sourceOf = (pre) => { const c = metaCommands(pre)[0]; return c ? pre.slice(c[0], c[2] + 1) : ''; };

function Affiliations({ meta, setMeta }) {
  const nums = affilNumbers(meta);
  if (!meta.affiliations.length) return null;
  return html`<section class="mf-section" aria-labelledby="mf-affils-h">
    <div class="mf-section-head"><h3 id="mf-affils-h">Affiliations</h3><span class="mf-count">${meta.affiliations.length}</span></div>
    <ol class="mf-affils">${meta.affiliations.map((af) => {
      const id = affilId(af), uses = affilUses(meta, id);
      const parts = ['name', 'department', 'institution', 'address', 'city', 'country'].filter((k) => get(af.fields, k) != null);
      return html`<li class="mf-affil" key=${id} data-affil=${id}>
        <span class="mf-num">${nums.get(id) ?? '–'}</span>
        <div class="mf-affil-fields">
          ${(parts.length ? parts : ['name']).map((k) => html`<${ValueField} name=${`affil-${k}`} label=${k === 'name' ? (uses ? `Used by ${uses} author${uses === 1 ? '' : 's'}` : 'Not used') : k[0].toUpperCase() + k.slice(1)}
            value=${get(af.fields, k) ?? undefined} onChange=${(v) => setMeta(setAffilField(meta, id, k, v ?? ''))} multiline=${(get(af.fields, k) ?? '').includes('\\\\')} />`)}
        </div>
        <${IconButton} icon="trash" size="sm" quiet label=${`Delete ${affilLabel(af)}${uses ? ` (from ${uses} author${uses === 1 ? '' : 's'})` : ''}`} class="mf-affil-del" onClick=${() => setMeta(removeAffil(meta, id))} />
      </li>`;
    })}</ol>
  </section>`;
}

function Convert({ pre, cls, onConvert, editSource }) {
  const c = useMemo(() => convertPreamble(pre, cls), [pre, cls]);
  if (!c) return html`<p>This document's title cannot be read into the form (class ${cls}).</p><${Button} onClick=${editSource}>Edit the LaTeX<//>`;
  return html`<div class="mf-convert">
    <p>The title and authors are written with <code>\\title</code> and <code>\\author</code>. Convert them to the form? The preamble gets one
      <code>\\ReflowedMeta</code> command instead (the class prints the same title); you can undo it.</p>
    ${c.notes.length ? html`<ul class="mf-notes">${c.notes.map((n) => html`<li>${n}</li>`)}</ul>` : null}
    <pre class="mf-pre">${sourceOf(c.preamble)}</pre>
    <div class="mf-convert-actions"><${Button} variant="ghost" onClick=${editSource}>Edit the LaTeX instead<//>
      <${Button} variant="primary" class="mf-convert-go" onClick=${() => onConvert(c.preamble)}>Convert<//></div>
  </div>`;
}

/** The title block as the class prints it, compiled with the edited data (debounced). */
function Preview({ host, blockId, pre }) {
  const box = useRef(null);
  const [state, setState] = useState('pending');            // pending | ok | error
  const [errors, setErrors] = useState([]);
  const seq = useRef(0);
  const mounted = useRef(null);
  useEffect(() => {
    const n = ++seq.current;
    setState('pending');
    const t = setTimeout(async () => {
      let r = null;
      try { r = await host.preview(pre, blockId); } catch (e) { r = { status: 'error', errors: [{ message: e.message }] }; }
      if (n !== seq.current || !box.current) return;
      if (!r || r.status !== 'ok' || !r.nodelist) { setState('error'); setErrors(r?.errors ?? []); host.previewed?.(); return; }
      const el = document.createElement('div');
      el.className = 'latex-block';
      try {
        const block = await host.mount(el, r, box.current);
        if (n !== seq.current) { block?.destroy?.(); el.remove(); return; }
        try { mounted.current?.block?.destroy?.(); } catch { /* gone */ }
        mounted.current?.el.remove();
        mounted.current = { el, block };
        setState('ok'); setErrors([]);
      } catch (e) { el.remove(); setState('error'); setErrors([{ message: e.message }]); }
      host.previewed?.();
    }, 300);
    return () => clearTimeout(t);
  }, [pre]);
  useEffect(() => () => { try { mounted.current?.block?.destroy?.(); } catch { /* gone */ } }, []);
  return html`<section class="mf-section" aria-labelledby="mf-preview-h">
    <div class="mf-section-head"><h3 id="mf-preview-h">Preview</h3><span class="mf-preview-state" data-state=${state}>${state === 'pending' ? 'Typesetting…' : state === 'error' ? 'LaTeX errors' : ''}</span></div>
    <div class=${cx('mf-preview', state === 'pending' && 'is-pending')} ref=${box} data-state=${state}></div>
    ${errors.length ? html`<ul class="mf-errors">${errors.slice(0, 4).map((e) => html`<li>${e.message}</li>`)}</ul>` : null}
  </section>`;
}
