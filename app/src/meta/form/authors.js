// the authors list: one row per author (handle, name, affiliation chips), expanded for the details.
// The name on the first line, the affiliations (muted) on the second: every row the list's full width, one
// left edge, whatever the name's or the affiliations' length.
// Reorder by dragging the handle (pointer: mouse, pen, touch) or with ↑/↓ on the handle (Alt+↑/↓ anywhere
// in the row). Affiliations are chips: + opens a picker of the existing ones (type to filter) with
// "New affiliation" at the end; numbering is automatic (first use, edit.ts renumber).
import { html, cx } from '../../design/ui/core.js';
import { Icon } from '../../design/ui/icons.ts';
import { IconButton, Button } from '../../design/ui/controls.js';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { get, isTrue, affilIds } from '../model.ts';
import { attachAffil, detachAffil, moveAuthor, newAffil, removeAuthor, setAuthorField, affilLabel, affilId, affilNumbers } from '../edit.ts';
import { emailProblem, orcidBare, orcidProblem } from '../text.ts';
import { valueText } from '../../tex/text.ts';
import { ValueField, PlainField, FlagField } from './fields.js';

const SHOWN = new Set(['name', 'affil', 'email', 'orcid', 'thanks', 'funding', 'corresponding', 'equal', 'break-after']);
const nameOf = (a) => { const n = get(a.fields, 'name') ?? ''; return valueText(n) ?? n; };

/** meta: the signal's value; set(next meta); flags: { breakAfter } (the class family shows a line break option) */
export function Authors({ meta, set, expanded, setExpanded, onRemoved, flags }) {
  const list = useRef(null);
  const [drag, setDrag] = useState(null);            // { from, to, dy, shift }
  const nums = affilNumbers(meta);

  function startDrag(e, i) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const rows = [...list.current.querySelectorAll(':scope > .mf-author')];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const y0 = e.clientY;
    let to = i;
    const move = (ev) => {
      const dy = ev.clientY - y0;
      // the place is where the pointer is (not the row's centre: an expanded row is tall)
      to = rects.filter((r, j) => j !== i && r.top + r.height / 2 < ev.clientY).length;
      setDrag({ from: i, to, dy, shift: rects[i].height + gap });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDrag(null);
      if (to !== i) set(moveAuthor(meta, i, to));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    setDrag({ from: i, to: i, dy: 0, shift: rects[i].height + gap });
  }
  const offset = (j) => {
    if (!drag) return undefined;
    if (j === drag.from) return `transform: translateY(${drag.dy}px)`;
    if (drag.from < j && j <= drag.to) return `transform: translateY(${-drag.shift}px)`;
    if (drag.to <= j && j < drag.from) return `transform: translateY(${drag.shift}px)`;
    return undefined;
  };
  const moveBy = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= meta.authors.length) return;
    set(moveAuthor(meta, i, j));
    requestAnimationFrame(() => list.current?.querySelectorAll('.mf-handle')[j]?.focus());
  };

  return html`<ol class=${cx('mf-authors', drag && 'is-dragging')} ref=${list} aria-label="Authors">
    ${meta.authors.map((a, i) => html`<${AuthorRow} key=${a.key ?? `o${a.origin}-${i}`} i=${i} a=${a} meta=${meta} set=${set} nums=${nums} flags=${flags}
      open=${expanded === a.key} toggle=${() => setExpanded(expanded === a.key ? null : a.key)} style=${offset(i)} dragging=${drag?.from === i}
      onHandleDown=${(e) => startDrag(e, i)} moveBy=${(d) => moveBy(i, d)}
      remove=${() => { const before = meta; set(removeAuthor(meta, i)); setExpanded(null); onRemoved(nameOf(a) || 'Author', before); }} />`)}
  </ol>`;
}

function AuthorRow({ i, a, meta, set, nums, open, toggle, style, dragging, onHandleDown, moveBy, remove, flags }) {
  const [picking, setPicking] = useState(false);
  const ids = affilIds(a);
  const name = nameOf(a);
  const field = (key, v) => set(setAuthorField(meta, i, key, v));
  const others = a.fields.filter(([k]) => !SHOWN.has(k));
  const key = (e) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBy(e.key === 'ArrowUp' ? -1 : 1); }
  };
  return html`<li class=${cx('mf-author', open && 'is-open', dragging && 'is-dragged')} style=${style} onKeyDown=${key} data-index=${i}>
    <div class="mf-author-row">
      <button type="button" class="mf-handle ui-icon-btn ui-icon-btn--sm ui-icon-btn--quiet" aria-label=${`Move ${name || 'author'} (↑ ↓)`} title="Drag to reorder"
        onPointerDown=${onHandleDown} onKeyDown=${(e) => { if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBy(e.key === 'ArrowUp' ? -1 : 1); } }}><${Icon.handle} /></button>
      <div class="mf-author-main">
      <button type="button" class="mf-author-name" aria-expanded=${String(open)} onClick=${toggle}>
        <span class=${cx(!name && 'mf-placeholder')}>${name || 'New author'}</span>
        ${isTrue(a.fields, 'corresponding') ? html`<span class="mf-badge" title="Corresponding author">corresponding</span>` : null}
      </button>
      <span class="mf-chips" aria-label=${`Affiliations of ${name || 'this author'}`}>
        ${ids.map((id) => { const af = meta.affiliations.find((x) => affilId(x) === id); return html`<span class="mf-chip ui-chip" data-affil=${id} title=${af ? affilLabel(af) : `${id}: no such affiliation`}>
          <span class="mf-num">${nums.get(id) ?? '?'}</span><span class="mf-chip-text">${af ? affilLabel(af) : id}</span>
          <button type="button" class="mf-chip-x" aria-label=${`Remove ${af ? affilLabel(af) : id} from ${name || 'this author'}`} onClick=${() => set(detachAffil(meta, i, id))}><${Icon.close} /></button></span>`; })}
        <${IconButton} icon="plus" size="sm" quiet label="Add an affiliation" class="mf-add-affil" onClick=${() => setPicking(!picking)} aria-expanded=${String(picking)} />
      </span>
      </div>
      <${IconButton} icon=${open ? 'chevronUp' : 'chevronDown'} size="sm" quiet label=${open ? 'Fewer details' : 'Details'} onClick=${toggle} />
    </div>
    ${picking ? html`<${AffilPicker} meta=${meta} ids=${ids} nums=${nums} close=${() => setPicking(false)}
      pick=${(id) => { set(attachAffil(meta, i, id)); setPicking(false); }}
      create=${(text) => { set(newAffil(meta, text, i)[0]); setPicking(false); }} />` : null}
    ${open ? html`<div class="mf-author-details">
      <${ValueField} name="name" label="Name" value=${get(a.fields, 'name') ?? undefined} onChange=${(v) => field('name', v ?? '')} autoFocus=${!name} />
      <div class="mf-pair">
        <${PlainField} name="email" label="Email" type="email" value=${get(a.fields, 'email') ?? undefined} onChange=${(v) => field('email', v)} check=${emailProblem} placeholder="name@example.org" />
        <${PlainField} name="orcid" label="ORCID iD" value=${get(a.fields, 'orcid') ?? undefined} onChange=${(v) => field('orcid', v)} check=${orcidProblem} normalise=${orcidBare} placeholder="0000-0002-1825-0097" />
      </div>
      <${ValueField} name="thanks" label="Note on the name" value=${get(a.fields, 'thanks') ?? undefined} onChange=${(v) => field('thanks', v || undefined)} multiline />
      <${ValueField} name="funding" label="Funding" value=${get(a.fields, 'funding') ?? undefined} onChange=${(v) => field('funding', v || undefined)} multiline />
      <div class="mf-flags">
        <${FlagField} name="corresponding" label="Corresponding author" on=${isTrue(a.fields, 'corresponding')} onChange=${(on) => field('corresponding', on ? null : undefined)} />
        <${FlagField} name="equal" label="Equal contribution" on=${isTrue(a.fields, 'equal')} onChange=${(on) => field('equal', on ? null : undefined)} />
        ${flags.breakAfter ? html`<${FlagField} name="break-after" label="Line break after this name" hint="When every author shares the affiliations, the names wrap on their own; this breaks the line after this name"
          on=${isTrue(a.fields, 'break-after')} onChange=${(on) => field('break-after', on ? null : undefined)} />` : null}
      </div>
      ${others.length ? html`<div class="mf-others">Also set: ${others.map(([k, v]) => html`<code>${v === null ? k : `${k} = ${v}`}</code> `)}</div>` : null}
      <div class="mf-row-actions"><${Button} size="sm" variant="ghost" icon="trash" class="mf-remove" onClick=${remove}>Remove author<//></div>
    </div>` : null}
  </li>`;
}

/** The affiliation picker: existing ones (filtered by typing), then "New affiliation". */
function AffilPicker({ meta, ids, nums, pick, create, close }) {
  const [q, setQ] = useState('');
  const input = useRef(null);
  useLayoutEffect(() => { input.current?.focus(); }, []);
  const query = q.trim().toLowerCase();
  const options = meta.affiliations.filter((af) => !ids.includes(affilId(af)) && (!query || affilLabel(af).toLowerCase().includes(query) || affilId(af).includes(query)));
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options.length === 1 && query) pick(affilId(options[0])); else if (q.trim()) create(q.trim()); }
  };
  return html`<div class="mf-picker" role="group" aria-label="Add an affiliation" onKeyDown=${key}>
    <input ref=${input} class="ui-input mf-input" placeholder="Find or type a new affiliation" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} aria-label="Affiliation" />
    <div class="mf-picker-list" role="listbox">
      ${options.map((af) => html`<button type="button" role="option" class="ui-menu-item mf-pick" data-affil=${affilId(af)} onClick=${() => pick(affilId(af))}>
        <span class="mf-num">${nums.get(affilId(af)) ?? '–'}</span><span class="ui-mi-label">${affilLabel(af)}</span></button>`)}
      ${q.trim() ? html`<button type="button" role="option" class="ui-menu-item mf-new-affil" onClick=${() => create(q.trim())}><${Icon.plus} /><span class="ui-mi-label">New affiliation “${q.trim()}”</span></button>` : null}
      ${!options.length && !q.trim() ? html`<div class="mf-hint">Type the affiliation's name, then Enter</div>` : null}
    </div>
  </div>`;
}
