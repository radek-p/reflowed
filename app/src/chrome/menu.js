// the document's menus as Preact components (were built by hand in
// app/app.js): the block menu (the handle's click), the document menu (⋯) and
// the slash menu (+ and "/": block kinds, grouped, type to filter).
//
//   item(label, key, fn, { disabled, shortcut })   a menu item (what nesting/ and notes/ contribute too)
//   SEP                                           a separator
//   const m = openMenu({ anchor, cls, items, align, focus, onCancel })
//   const m = openSlash({ anchor, kinds, onPick, onCancel })
//   m.el (the .menu element), m.close(cancelled = true), m.contains(node); onClosed(m) on any close
//
// Behaviour kept: placed before the first paint below the anchor when it fits
// (else above), and on that side for the menu's life (the slash menu grows and
// shrinks as it filters); the document menu aligns its right edge to the
// anchor; a pick closes the menu (not cancelled), Escape and a press outside
// cancel it (the kit's one overlay layer, design/ui/layers.js, the
// focus goes back to what had it after Escape; a press on the button that
// opened the menu toggles it closed); in the slash menu ↑/↓ move, Enter
// picks, Escape or Backspace on an empty filter cancel, the pointer selects on
// move, a press on an item keeps the focus in the filter. The block menu
// focuses its first enabled item. Classes: .menu(.block-menu/.doc-menu/.slash),
// .menu-item[data-action|data-kind](.sel), .mi-icon, .mi-text, .mi-label,
// .mi-hint, .mi-key, .menu-title, .menu-filter, .menu-list, .menu-empty, .menu-sep.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { openLayer, toggling } from '../design/ui/layers.js';
import { visibleBox } from '../../../workbench/src/viewport.ts';

export const SEP = { sep: true };
export const item = (label, key, fn, { disabled = false, shortcut = '' } = {}) => ({ label, key, fn, disabled, shortcut });

/** Put `m` (position: absolute, document coordinates) at `anchor`; `side` keeps below/above once chosen. */
function place(m, anchor, side, align) {
  const r = anchor.getBoundingClientRect();
  const mh = m.offsetHeight;
  const seen = visibleBox();                         // (above an on-screen keyboard)
  if (side.below == null) side.below = align === 'end' ? true : r.bottom + 6 + mh < seen.bottom || r.top < seen.top + mh + 12;
  const left = align === 'end' ? Math.max(8, r.right - m.offsetWidth) : Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8));
  m.style.left = `${left + scrollX}px`;
  m.style.top = `${(side.below ? r.bottom + 6 : r.top - mh - 6) + scrollY}px`;
}

// a control that opens the menu (a button): a press on it is the menu's toggle, not a press outside
const isToggle = (a) => !!a?.matches?.('button, [role="button"], [aria-haspopup]');

function host(make, anchor) {
  let open = true, onCancel = null, onClosed = null, layer = null;
  const h = {
    el: null,
    contains: (n) => !!h.el?.contains(n),
    close(cancelled = true) {
      if (!open) return;
      open = false;
      layer?.close();
      h.el = null;
      onClosed?.(h);
      if (cancelled) onCancel?.();
    },
    get open() { return open; },
    set onCancel(f) { onCancel = f; },
    set onClosed(f) { onClosed = f; },
  };
  // the click that began as a press on this menu's button while it was open: it closed it, it does not reopen it
  if (toggling(anchor)) { open = false; return h; }
  layer = openLayer(() => make(h), { kind: 'menu', anchor, toggle: isToggle(anchor), onDismiss: () => h.close() });
  layer.el.classList.add('menu-host');
  h.el = layer.el.firstElementChild;
  return h;
}

function MenuView({ h, anchor, cls, items, align, focus }) {
  const ref = useRef(null), side = useRef({});
  useLayoutEffect(() => {
    place(ref.current, anchor, side.current, align);
    if (focus) ref.current.querySelector('button:not([disabled])')?.focus();
  }, []);
  return html`<div ref=${ref} class=${`menu ${cls}`} role="menu">
    ${items.map((it, k) => (it.sep ? html`<div key=${`s${k}`} class="menu-sep"></div>`
      : html`<button key=${it.key ?? k} class="menu-item" role="menuitem" data-action=${it.key} disabled=${it.disabled}
          onClick=${() => { h.close(false); it.fn(); }}>
          <span class="mi-label">${it.label}</span>${it.shortcut ? html`<span class="mi-key">${it.shortcut}</span>` : null}
        </button>`))}
  </div>`;
}

/** @param {{ anchor: Element | null, cls?: string, items: any[], align?: string, focus?: boolean, onCancel?: (() => void) | null, onClosed?: ((h: any) => void) | null }} o */
export function openMenu({ anchor, cls = 'block-menu', items, align = 'start', focus = false, onCancel = null, onClosed = null }) {
  const h = host((hh) => html`<${MenuView} h=${hh} anchor=${anchor} cls=${cls} items=${items} align=${align} focus=${focus} />`, anchor);
  h.onCancel = onCancel; h.onClosed = onClosed;
  return h;
}

function SlashView({ h, anchor, kinds, onPick }) {
  const ref = useRef(null), side = useRef({}), filterRef = useRef(null), listRef = useRef(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const qq = q.trim().toLowerCase();
  const items = kinds.filter((t) => !qq || t.label.toLowerCase().includes(qq) || String(t.kind).includes(qq) || t.hint.toLowerCase().includes(qq));
  const at = Math.min(sel, Math.max(0, items.length - 1));
  useLayoutEffect(() => { place(ref.current, anchor, side.current, 'start'); listRef.current.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); });
  useLayoutEffect(() => { filterRef.current.focus(); }, []);
  const pick = (t) => { h.close(false); onPick(t); };
  const key = (e) => {
    const n = Math.max(1, items.length);
    if (e.key === 'ArrowDown') { setSel((at + 1) % n); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setSel((at - 1 + items.length) % n); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = items[at]; if (t) pick(t); }
    else if (e.key === 'Backspace' && !e.currentTarget.value) { e.preventDefault(); h.close(); }   // Escape: the layer
  };
  const rows = [];
  let group = null;
  items.forEach((t, k) => {
    if (t.group !== group && !qq) { group = t.group; rows.push(html`<div key=${`g:${group}`} class="menu-title">${group}</div>`); }
    rows.push(html`<button key=${`k:${t.env ?? t.kind}:${t.label}`} class=${`menu-item${k === at ? ' sel' : ''}`} role="option" data-kind=${t.env ?? t.kind} aria-selected=${String(k === at)}
        onPointerDown=${(e) => e.preventDefault()} onClick=${() => pick(t)} onPointerMove=${() => { if (at !== k) setSel(k); }}>
      <span class="mi-icon">${t.icon}</span><span class="mi-text"><span class="mi-label">${t.label}</span><span class="mi-hint">${t.hint}</span></span>
    </button>`);
  });
  return html`<div ref=${ref} class="menu slash" role="listbox" aria-label="Block types">
    <input ref=${filterRef} class="menu-filter" placeholder="Filter…" aria-label="Filter block types" spellcheck="false" value=${q}
      onInput=${(e) => { setQ(e.currentTarget.value); setSel(0); }} onKeyDown=${key} />
    <div ref=${listRef} class="menu-list">${rows}${items.length ? null : html`<div class="menu-empty">No block type matches</div>`}</div>
  </div>`;
}

/** @param {{ anchor: Element | null, kinds: any[], onPick: (k: any) => void, onCancel?: (() => void) | null, onClosed?: ((h: any) => void) | null }} o */
export function openSlash({ anchor, kinds, onPick, onCancel = null, onClosed = null }) {
  const h = host((hh) => html`<${SlashView} h=${hh} anchor=${anchor} kinds=${kinds} onPick=${onPick} />`, anchor);
  h.onCancel = onCancel; h.onClosed = onClosed;
  return h;
}
