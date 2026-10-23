// svgfig panels (Preact + @preact/signals + htm): the top bar, the tools, the
// layers panel (drag to reorder), and the popover by the selection (stroke,
// fill, opacity, dash, arrowheads; a text's LaTeX, size, alignment; arrange).
// They read the editor's signals (ed.S) and call its operations (editor.js).
// Icons by name from the one registry (design/ui/icon-set.ts). (Still JavaScript: the Lucide change only renamed its
// icons; the file becomes TypeScript with its next substantial edit.)

import { h } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';
import { SOLIDS, FILLS, shown } from './colours.js';
import { describe, walk } from './model.js';
import { Icon as Glyph, ICON_STROKE, ICON_VIEWBOX } from '../design/ui/icon-set.ts';

const html = htm.bind(h);
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const MOD = isMac ? '⌘' : 'Ctrl+';

// the icons: the one registry's (design/ui/icon-set.ts: our names → Lucide), drawn with the figure editor's class
const Icon = ({ name, size = 18 }) => Glyph({ name, size, class: 'svf-ic' });
// a line style's sample (a dash, an arrowhead) in a Seg: a drawing of the style, not an icon; the icons' grid and stroke
const Sample = ({ d }) => html`<svg class="svf-ic" width="15" height="15" viewBox=${ICON_VIEWBOX} aria-hidden="true"><path d=${d} fill="none" stroke="currentColor" stroke-width=${ICON_STROKE} stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const sample = (d) => html`<${Sample} d=${d}/>`;
const glyph = (name) => html`<${Icon} name=${name} size=${15}/>`;
const Btn = ({ icon, label, on, active, disabled, cls = '', children, ...rest }) => html`
  <button type="button" class=${`svf-btn ${active ? 'is-on' : ''} ${cls}`} title=${label} aria-label=${label} aria-pressed=${active ? 'true' : undefined} disabled=${disabled} onClick=${on} ...${rest}>
    ${icon ? html`<${Icon} name=${icon}/>` : null}${children}
  </button>`;

// ── top bar ────────────────────────────────────────────────────────────────
function TopBar({ ed }) {
  const S = ed.S;
  const errs = S.errors.value.size;
  const z = Math.round(S.zoom.value * 100);
  return html`<header class="svf-top svf-frame">
    <div class="svf-title"><span class="svf-kicker">Figure</span><span class="svf-name">${ed.opts.name ?? 'Untitled figure'}</span></div>
    <${FigureSize} ed=${ed}/>
    <div class="svf-status" aria-live="polite">${S.pending.value ? html`<span class="svf-dot"></span>Typesetting…` : errs ? html`<span class="svf-err">${errs} text${errs > 1 ? 's' : ''} did not compile</span>` : null}</div>
    <div class="svf-group">
      <${Btn} icon=${'undo'} label=${`Undo (${MOD}Z)`} on=${ed.undo} disabled=${!S.canUndo.value} data-act="undo"/>
      <${Btn} icon=${'redo'} label=${`Redo (${MOD}⇧Z)`} on=${ed.redo} disabled=${!S.canRedo.value} data-act="redo"/>
    </div>
    <div class="svf-group svf-zoom">
      <${Btn} icon=${'minus'} label="Zoom out" on=${() => ed.setZoom(S.zoom.value / 1.25)}/>
      <button type="button" class="svf-btn svf-zoomval" title=${`Fit (${MOD}0)`} onClick=${ed.fit}>${z}%</button>
      <${Btn} icon=${'plus'} label="Zoom in" on=${() => ed.setZoom(S.zoom.value * 1.25)}/>
    </div>
    <div class="svf-group">
      <button type="button" class="svf-btn svf-text-btn" data-act="cancel" onClick=${() => ed.finish(false)}>Cancel</button>
      <button type="button" class="svf-btn svf-text-btn svf-primary" data-act="done" title=${`Save the figure (${MOD}S)`} onClick=${() => ed.finish(true)}>Done</button>
    </div>
  </header>`;
}

// ── tools ──────────────────────────────────────────────────────────────────
const TOOLS = [
  ['select', 'Select and move (V)', 'pointer'], ['hand', 'Pan (H, or hold Space)', 'hand'], null,
  ['rect', 'Rectangle (R)', 'rect'], ['ellipse', 'Ellipse (O)', 'ellipse'], ['line', 'Line (L)', 'line'], ['arrow', 'Arrow (A)', 'arrow'],
  ['path', 'Polyline: click the points, double-click or Enter to end, the first point to close (P)', 'path'], null,
  ['label', 'LaTeX label (T)', 'label'], ['box', 'LaTeX text box: drag its width (B)', 'textBox'],
];
function Toolbar({ ed }) {
  const t = ed.S.tool.value;
  return html`<nav class="svf-tools svf-frame" aria-label="Tools">
    ${TOOLS.map((x, i) => (x ? html`<${Btn} key=${x[0]} icon=${x[2]} label=${x[1]} active=${t === x[0]} on=${() => ed.setTool(x[0])} data-tool=${x[0]}/>` : html`<span key=${`s${i}`} class="svf-sep"></span>`))}
  </nav>`;
}

// ── layers ─────────────────────────────────────────────────────────────────
const TYPE_ICON = { rect: 'rect', ellipse: 'ellipse', line: 'line', path: 'path', text: 'label', group: 'group' };
function rowsOf(list, depth, parent, out, open) {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    out.push({ o, depth, parent, index: i });
    if (o.type === 'group' && open.has(o.id)) rowsOf(o.children, depth + 1, o, out, open);
  }
  return out;
}
function Layers({ ed }) {
  const S = ed.S;
  void S.version.value;
  const sel = new Set(S.sel.value);
  const [open, setOpen] = useState(() => new Set());
  const [drag, setDrag] = useState(null);       // { id, y, over: { parent, index, depth, top } }
  const [renaming, setRenaming] = useState(null);
  const listRef = useRef(null);
  // a selected child opens its groups
  for (const id of S.sel.value) { let p = ed.parentOf(id); while (p) { if (!open.has(p.id)) { open.add(p.id); } p = ed.parentOf(p.id); } }
  const rows = rowsOf(ed.fig.objects, 0, null, [], open);
  const ROW = 30;

  function dropTarget(clientY) {
    const box = listRef.current.getBoundingClientRect();
    const y = clientY - box.top + listRef.current.scrollTop;
    const k = Math.max(0, Math.min(rows.length, Math.round(y / ROW)));
    // the gap above row k: the new place is above rows[k] in its list (the list is shown top first)
    const below = rows[k], above = rows[k - 1];
    if (below) return { parent: below.parent?.id ?? null, index: below.index + 1, depth: below.depth, top: k * ROW };
    if (above) return { parent: above.parent?.id ?? null, index: above.index, depth: above.depth, top: k * ROW };
    return { parent: null, index: 0, depth: 0, top: 0 };
  }
  function onDown(e, r) {
    if (e.button !== 0 || e.target.closest('.svf-row-act, input')) return;
    const y0 = e.clientY;
    let dragging = false;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientY - y0) < 4) return;
      if (!dragging) { dragging = true; if (!sel.has(r.o.id)) ed.select([r.o.id]); }
      setDrag({ id: r.o.id, dy: ev.clientY - y0, over: dropTarget(ev.clientY) });
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (!dragging) {
        if (ev.shiftKey) ed.select(sel.has(r.o.id) ? S.sel.value.filter((x) => x !== r.o.id) : [...S.sel.value, r.o.id]);
        else ed.select([r.o.id]);
        return;
      }
      const t = dropTarget(ev.clientY);
      setDrag(null);
      ed.moveTo(r.o.id, t.parent, t.index);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  return html`<aside class="svf-layers svf-frame" aria-label="Layers">
    <div class="svf-panel-head">Layers <span class="svf-count">${rows.length}</span></div>
    <div class="svf-rows" ref=${listRef} role="tree">
      ${rows.map((r) => {
        const o = r.o, isDrag = drag?.id === o.id;
        return html`<div key=${o.id} role="treeitem" aria-selected=${sel.has(o.id)} data-layer=${o.id}
            class=${`svf-row ${sel.has(o.id) ? 'is-sel' : ''} ${o.hidden ? 'is-hidden' : ''} ${isDrag ? 'is-drag' : ''}`}
            style=${{ paddingLeft: `${8 + r.depth * 16}px`, transform: isDrag ? `translateY(${drag.dy}px)` : undefined }}
            onPointerDown=${(e) => onDown(e, r)} onDblClick=${(e) => { if (!e.target.closest('.svf-row-act')) setRenaming(o.id); }}>
          ${o.type === 'group' ? html`<button type="button" class=${`svf-row-act svf-twist ${open.has(o.id) ? 'is-open' : ''}`} aria-label="Show the group's objects"
              onClick=${() => { const n = new Set(open); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); setOpen(n); }}><${Icon} name="chevronRight" size=${12}/></button>` : html`<span class="svf-twist-sp"></span>`}
          <span class="svf-row-ic"><${Icon} name=${TYPE_ICON[o.type] ?? 'rect'} size=${14}/></span>
          ${renaming === o.id
            ? html`<input class="svf-rename" value=${o.name ?? describe(o)} ref=${(x) => x && requestAnimationFrame(() => { x.focus(); x.select(); })}
                onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = o.name ?? describe(o); e.currentTarget.blur(); } e.stopPropagation(); }}
                onBlur=${(e) => { const v = e.currentTarget.value.trim(); setRenaming(null); if (v !== (o.name ?? describe(o))) ed.setProps({ name: v || undefined }, { ids: [o.id] }); }}/>`
            : html`<span class="svf-row-name">${describe(o)}</span>`}
          <button type="button" class="svf-row-act" title=${o.hidden ? 'Show' : 'Hide'} aria-label=${o.hidden ? 'Show' : 'Hide'} onClick=${() => ed.setProps({ hidden: o.hidden ? undefined : true }, { ids: [o.id] })}><${Icon} name=${o.hidden ? 'eyeOff' : 'eye'} size=${14}/></button>
          <button type="button" class="svf-row-act" title=${o.locked ? 'Unlock' : 'Lock'} aria-label=${o.locked ? 'Unlock' : 'Lock'} onClick=${() => ed.setProps({ locked: o.locked ? undefined : true }, { ids: [o.id] })}><${Icon} name=${o.locked ? 'lock' : 'unlock'} size=${14}/></button>
        </div>`;
      })}
      ${drag ? html`<div class="svf-drop" style=${{ top: `${drag.over.top - 1}px`, left: `${8 + drag.over.depth * 16}px` }}></div>` : null}
      ${!rows.length ? html`<div class="svf-empty">Nothing yet. Pick a tool below and draw.</div>` : null}
    </div>
  </aside>`;
}

// ── the popover ────────────────────────────────────────────────────────────
function Swatches({ list, value, onPick, label }) {
  return html`<div class="svf-swatches" role="radiogroup" aria-label=${label}>
    ${list.map((c) => html`<button type="button" key=${String(c.hex)} role="radio" aria-checked=${value === c.hex} title=${c.name} aria-label=${c.name}
        class=${`svf-sw ${value === c.hex ? 'is-on' : ''} ${c.hex ? '' : 'svf-sw-none'}`} style=${c.hex ? { background: shown(c.hex) } : undefined}
        data-hex=${c.hex ?? 'none'} onClick=${() => onPick(c.hex)}></button>`)}
  </div>`;
}
function Opacity({ value, onInput, onChange, label }) {
  return html`<label class="svf-slider"><span>${label}</span>
    <input type="range" min="0" max="100" step="5" value=${Math.round((value ?? 1) * 100)} aria-label=${label}
      onInput=${(e) => onInput(Number(e.currentTarget.value) / 100)} onChange=${(e) => onChange(Number(e.currentTarget.value) / 100)}/>
    <output>${Math.round((value ?? 1) * 100)}%</output></label>`;
}
function Seg({ options, value, onPick, label }) {
  return html`<div class="svf-seg" role="radiogroup" aria-label=${label}>
    ${options.map(([v, text, shown]) => html`<button type="button" key=${v} role="radio" aria-checked=${value === v} class=${value === v ? 'is-on' : ''} title=${text} aria-label=${text} data-v=${v} onClick=${() => onPick(v)}>${shown ?? text}</button>`)}
  </div>`;
}
const common = (objs, k) => { const vs = [...new Set(objs.map((o) => o[k] ?? null))]; return vs.length === 1 ? vs[0] : undefined; };
/** A section head; "Mixed" when the selection's values for keys differ (no swatch is then on). */
const Head = ({ text, objs, keys }) => html`<div class="svf-sec-head">${text}${keys.some((k) => objs.length > 1 && common(objs, k) === undefined) ? html`<span class="svf-hint svf-mixed">Mixed</span>` : null}</div>`;
const ROLE = { stroke: 'stroke', fill: 'fill', color: 'text' };
/** The colours a selection uses (strokes, fills, texts' colour), most used first: hex -> roles. */
function usedColours(leaves) {
  const m = new Map();
  for (const o of leaves) for (const k of ['stroke', 'fill', 'color']) {
    const v = k === 'color' ? (o.type === 'text' ? o.color ?? '#000000' : null) : o.type === 'text' ? null : k === 'fill' && (o.type === 'line' || (o.type === 'path' && !o.closed)) ? null : o[k];
    if (!v) continue;
    const e = m.get(v) ?? { hex: v, roles: new Set(), n: 0 };
    e.roles.add(ROLE[k]); e.n++; m.set(v, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
const nameOf = (hex) => [...FILLS, ...SOLIDS].find((c) => c.hex === hex)?.name ?? hex;
/** A group in the selection: one section, the selection's colours (as design tools show a group's
 *  "selection colours"); a colour picked here is replaced by another everywhere in the selection.
 *  Strokes, dashes, sizes are set on the group's objects themselves (double-click into it). */
function SelectionColours({ ed, leaves }) {
  const [picking, setPicking] = useState(null);
  const used = usedColours(leaves);
  const pick = used.find((u) => u.hex === picking);
  const list = pick && [...pick.roles].every((r) => r === 'fill') ? FILLS.filter((c) => c.hex) : SOLIDS;
  return html`<div class="svf-sec" data-sec="colours">
    <div class="svf-sec-head">Colours <span class="svf-hint">${picking ? 'Replace with' : 'Pick one to replace it'}</span></div>
    <div class="svf-swatches" role="radiogroup" aria-label="Selection colours">
      ${used.map((u) => html`<button type="button" key=${u.hex} role="radio" aria-checked=${picking === u.hex} class=${`svf-sw ${picking === u.hex ? 'is-on' : ''}`}
          style=${{ background: shown(u.hex) }} data-hex=${u.hex} title=${`${nameOf(u.hex)}: ${[...u.roles].join(', ')}`} aria-label=${`${nameOf(u.hex)} (${[...u.roles].join(', ')})`}
          onClick=${() => setPicking(picking === u.hex ? null : u.hex)}></button>`)}
    </div>
    ${picking ? html`<div class="svf-replace"><${Swatches} list=${list} value=${picking} label="Replace with" onPick=${(hex) => { ed.recolour(picking, hex); setPicking(null); }}/></div>` : null}
  </div>`;
}

function TextSource({ ed, o }) {
  const ref = useRef(null);
  const editing = ed.S.editing.value === o.id;
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); const n = ref.current.value.length; ref.current.setSelectionRange(n, n); } }, [editing]);
  const box = o.box != null;
  return html`<div class="svf-sec">
    <div class="svf-sec-head">LaTeX <span class="svf-hint">${box ? `${MOD}Enter` : 'Enter'} to finish</span></div>
    <textarea ref=${ref} class="svf-src" rows=${box ? 3 : 1} spellcheck="false" placeholder=${box ? 'A paragraph of LaTeX…' : 'LaTeX, e.g. $G_n$'} value=${o.src}
      onFocus=${() => { if (ed.S.editing.value !== o.id) ed.beginTextEdit(o.id); }}
      onInput=${(e) => ed.setTextSource(o.id, e.currentTarget.value)}
      onKeyDown=${(e) => {
        const finish = box ? (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) : (e.key === 'Enter' && !e.shiftKey);
        if (finish || e.key === 'Escape') { e.preventDefault(); ed.endTextEdit(); e.currentTarget.blur(); e.currentTarget.closest('.svf-root')?.focus(); }
      }}
      onBlur=${() => { if (ed.S.editing.value === o.id) ed.endTextEdit(); }}></textarea>
    ${ed.S.errors.value.get(o.id) ? html`<div class="svf-errmsg">${ed.S.errors.value.get(o.id).split('\n')[0]}</div>` : null}
  </div>`;
}

function Popover({ ed }) {
  const S = ed.S;
  void S.version.value;
  const at = S.popAt.value;
  const objs = ed.selObjs();
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const gesturing = !!S.gesture.value;
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p || !at) return;
    const r = p.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    let left = (at.left + at.right) / 2 - r.width / 2, top = at.bottom + 14;
    if (top + r.height > H - 70) top = at.top - r.height - 14;
    if (top < 64) top = Math.min(H - r.height - 70, Math.max(64, at.bottom + 14));
    left = Math.max(12, Math.min(W - r.width - 12, left));
    if (!pos || Math.abs(pos.left - left) > 0.5 || Math.abs(pos.top - top) > 0.5) setPos({ left, top });
  });
  if (!at || !objs.length) return null;
  const leaves = objs.flatMap((o) => [...walk([o])].map(([x]) => x)).filter((o) => o.type !== 'group');
  const shapes = leaves.filter((o) => o.type !== 'text'), textsSel = leaves.filter((o) => o.type === 'text');
  const lines = shapes.filter((o) => o.type === 'line' || (o.type === 'path' && !o.closed));
  const filled = shapes.filter((o) => o.type === 'rect' || o.type === 'ellipse' || (o.type === 'path' && o.closed));
  const one = objs.length === 1 ? objs[0] : null;
  const set = (p) => ed.setProps(p), liveSet = (p) => ed.setProps(p, { record: false });
  const stroke = common(shapes, 'stroke'), fill = common(filled, 'fill');
  const hasGroup = objs.some((o) => o.type === 'group');
  const title = hasGroup ? (one ? `Group: ${describe(one)}, ${leaves.length} objects` : `${objs.length} objects, ${leaves.length} in all`) : null;
  return html`<div class=${`svf-pop svf-frame ${gesturing ? 'is-quiet' : ''}`} ref=${ref} role="dialog" aria-label="Selection"
      style=${pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { visibility: 'hidden', left: '0px', top: '0px' }}
      onPointerDown=${(e) => e.stopPropagation()} onKeyDown=${(e) => { if (e.target.closest('textarea, input')) e.stopPropagation(); }}>
    ${title ? html`<div class="svf-sec svf-title">${title}</div>` : null}
    ${hasGroup ? html`<${SelectionColours} key=${S.sel.value.join()} ed=${ed} leaves=${leaves}/>` : null}
    ${one?.type === 'text' ? html`<${TextSource} ed=${ed} o=${one}/>` : null}
    ${shapes.length && !hasGroup ? html`<div class="svf-sec">
      <${Head} text="Stroke" objs=${shapes} keys=${['stroke', 'width', 'dash', 'strokeOpacity']}/>
      <${Swatches} list=${[{ hex: null, name: 'No stroke' }, ...SOLIDS]} value=${stroke} onPick=${(hex) => set({ stroke: hex })} label="Stroke colour"/>
      <div class="svf-row2">
        <${Seg} label="Width" value=${common(shapes, 'width')} onPick=${(v) => set({ width: v })} options=${[[0.4, '0.4'], [0.8, '0.8'], [1.2, '1.2'], [2, '2']]}/>
        <${Seg} label="Dash" value=${common(shapes, 'dash')} onPick=${(v) => set({ dash: v })} options=${[['solid', 'Solid', sample('M4 12h16')], ['dashed', 'Dashed', sample('M4 12h4M10 12h4M16 12h4')], ['dotted', 'Dotted', sample('M4 12h.5M9 12h.5M14 12h.5M19 12h.5')]]}/>
      </div>
      <${Opacity} label="Opacity" value=${common(shapes, 'strokeOpacity')} onInput=${(v) => liveSet({ strokeOpacity: v })} onChange=${(v) => set({ strokeOpacity: v })}/>
      ${lines.length ? html`<div class="svf-row2">
        <${Seg} label="Start" value=${common(lines, 'arrowStart')} onPick=${(v) => set({ arrowStart: v })} options=${[['none', 'No arrowhead at the start', sample('M6 12h14')], ['latex', 'Arrowhead at the start', sample('M6 12h14M10 8l-4 4 4 4')]]}/>
        <${Seg} label="End" value=${common(lines, 'arrowEnd')} onPick=${(v) => set({ arrowEnd: v })} options=${[['none', 'No arrowhead at the end', sample('M4 12h14')], ['latex', 'Arrowhead at the end', sample('M4 12h14M14 8l4 4-4 4')]]}/>
      </div>` : null}
    </div>` : null}
    ${filled.length && !hasGroup ? html`<div class="svf-sec">
      <${Head} text="Fill" objs=${filled} keys=${['fill', 'fillOpacity']}/>
      <${Swatches} list=${FILLS} value=${fill} onPick=${(hex) => set({ fill: hex })} label="Fill colour"/>
      <${Opacity} label="Opacity" value=${common(filled, 'fillOpacity')} onInput=${(v) => liveSet({ fillOpacity: v })} onChange=${(v) => set({ fillOpacity: v })}/>
    </div>` : null}
    ${textsSel.length && !hasGroup ? html`<div class="svf-sec">
      <${Head} text="Text" objs=${textsSel} keys=${['color', 'size', 'opacity']}/>
      <${Swatches} list=${SOLIDS} value=${common(textsSel, 'color')} onPick=${(hex) => set({ color: hex })} label="Text colour"/>
      <div class="svf-row2">
        <${Seg} label="Size" value=${common(textsSel, 'size')} onPick=${(v) => set({ size: v })} options=${[['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']].map(([v, t]) => [v, t])}/>
        ${textsSel.some((o) => o.box != null) ? html`<${Seg} label="Align" value=${common(textsSel, 'align')} onPick=${(v) => set({ align: v })} options=${[['left', 'Left', glyph('textLeft')], ['center', 'Centre', glyph('textCentre')], ['right', 'Right', glyph('textRight')], ['justify', 'Justify', glyph('textJustify')]]}/>` : null}
      </div>
      <${Opacity} label="Opacity" value=${common(textsSel, 'opacity')} onInput=${(v) => liveSet({ opacity: v })} onChange=${(v) => set({ opacity: v })}/>
    </div>` : null}
    <div class="svf-sec svf-actions">
      <${Btn} icon=${'forward'} label=${`Bring forward (${MOD}])`} on=${() => ed.arrange(1)} data-act="forward"/>
      <${Btn} icon=${'backward'} label=${`Send backward (${MOD}[)`} on=${() => ed.arrange(-1)} data-act="backward"/>
      <${Btn} icon=${'toFront'} label=${`Bring to front (${MOD}⇧])`} on=${() => ed.arrange('front')}/>
      <${Btn} icon=${'toBack'} label=${`Send to back (${MOD}⇧[)`} on=${() => ed.arrange('back')}/>
      <span class="svf-sep"></span>
      ${objs.length > 1 ? html`
        <${Btn} icon=${'alignLeft'} label="Align left" on=${() => ed.align('left')}/><${Btn} icon=${'alignCentre'} label="Align centres" on=${() => ed.align('hcenter')}/><${Btn} icon=${'alignRight'} label="Align right" on=${() => ed.align('right')}/>
        <${Btn} icon=${'alignTop'} label="Align tops" on=${() => ed.align('top')}/><${Btn} icon=${'alignMiddle'} label="Align middles" on=${() => ed.align('vcenter')}/><${Btn} icon=${'alignBottom'} label="Align bottoms" on=${() => ed.align('bottom')}/>
        <span class="svf-sep"></span>
        <${Btn} icon=${'group'} label=${`Group (${MOD}G)`} on=${ed.group} data-act="group"/>` : null}
      ${one?.type === 'group' ? html`<${Btn} icon=${'group'} label=${`Ungroup (${MOD}⇧G)`} on=${ed.ungroup} data-act="ungroup" cls="is-on"/>` : null}
      <${Btn} icon=${'copy'} label=${`Duplicate (${MOD}D)`} on=${ed.dup}/>
      <${Btn} icon=${'trash'} label="Delete (⌫)" on=${ed.del} data-act="delete"/>
    </div>
  </div>`;
}

/** The figure's own size (in the top bar). */
function FigureSize({ ed }) {
  void ed.S.version.value;
  const f = ed.fig;
  const num = (v, fn) => html`<input type="number" min="8" step="1" value=${v} onChange=${(e) => fn(Number(e.currentTarget.value))} onKeyDown=${(e) => e.stopPropagation()}/>`;
  return html`<div class="svf-figpanel" aria-label="Figure size">
    <label>W ${num(f.w, (w) => ed.setFigureSize(w, f.h))}</label>
    <label>H ${num(f.h, (hh) => ed.setFigureSize(f.w, hh))}</label>
    <span class="svf-unit">bp</span>
    <button type="button" class="svf-btn svf-text-btn svf-quiet" onClick=${() => ed.fitToContent()} title="Make the figure just big enough for what is drawn">Fit</button>
  </div>`;
}

export function App({ ed }) {
  return html`<${TopBar} ed=${ed}/><${Layers} ed=${ed}/><${Toolbar} ed=${ed}/><${Popover} ed=${ed}/>`;
}
