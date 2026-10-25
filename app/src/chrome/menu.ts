// The document's menus as Preact components: the block menu (the handle's click), the main menu (the Re button) and
// the embedded editor's document menu (⋯), the pane bars' menus, and the slash menu (+ and "/": block kinds, grouped,
// type to filter). The entries are data (chrome/menu-model.ts: item, submenu, SEP).
//
//   const m = openMenu({ anchor, cls, items, align, focus, onCancel, onClosed })
//   const m = openSlash({ anchor, kinds, onPick, onCancel, onClosed })
//   m.el (the menu's first panel), m.close(cancelled = true), m.contains(node) (any of its panels); onClosed(m) on any close
//
// A menu: placed before the first paint below the anchor when it fits (else above), and on that side for its life; align
// 'end' puts its right edge at the anchor's. An entry may have an icon (the kit's icon set), a check (a toggle:
// menuitemcheckbox), a shortcut at its right, a hint under its label, and entries of its own (a submenu, opened beside
// its row: to the right, else to the left). When one row has an icon or a check, every row keeps the leading slot.
// Keys: ↑ ↓ Home End move (wrapping, over what can be chosen), a letter goes to the next row it starts, → Enter or Space
// on a submenu's row open it (its first row focused), ← or Escape in a submenu close it (the focus back on its row),
// Escape in the first panel closes the menu (the kit's one overlay layer, design/ui/layers.js: the focus back to what
// had it), Tab closes it. The pointer: a submenu's row opens it on hover or a click (a touch: the tap); hovering another
// row closes it after a short grace (the way to the submenu crosses other rows). With no room beside its panel (a phone),
// a submenu opens under its row. A pick closes the menu (not cancelled; the focus back to
// what had it, then the entry runs); a press outside cancels it; a press on the button that opened it toggles it closed.
// focus: true focuses the first row (opened from the keyboard); else the panel itself, so the keys work at once.
// In the slash menu ↑/↓ move, Enter picks, Escape or Backspace on an empty filter cancel, the pointer selects on move, a
// press on an item keeps the focus in the filter.
// Classes: .menu(.menu-sub)(.block-menu/.main-menu/.doc-menu/.slash), .menu-item[data-action|data-kind](.sel), .mi-lead,
// .mi-icon, .mi-text, .mi-label, .mi-hint, .mi-key, .mi-sub, .menu-title, .menu-filter, .menu-list, .menu-empty, .menu-sep.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { html } from '../design/ui/core.js';
import { Icon } from '../design/ui/icons.ts';
import { openLayer, toggling } from '../design/ui/layers.js';
import { visibleBox } from '../../../workbench/src/viewport.ts';
import { isSep, inactive, step, edge, typeAhead, leads, type MenuEntry, type MenuCommand } from './menu-model.ts';
export { item, submenu, SEP, type MenuEntry, type MenuCommand } from './menu-model.ts';

/** a menu or the slash menu, open or closed */
export interface MenuHandle {
  el: HTMLElement | null;
  readonly open: boolean;
  contains(n: Node | null): boolean;
  close(cancelled?: boolean): void;
  onCancel: (() => void) | null;
  onClosed: ((h: MenuHandle) => void) | null;
}
type Side = { below?: boolean };
const GRACE = 300;     // ms a submenu stays open while the pointer crosses another row on its way there

/** Put `m` (position: absolute, document coordinates) at `anchor`; `side` keeps below/above once chosen. */
function place(m: HTMLElement, anchor: Element, side: Side, align: string) {
  const r = anchor.getBoundingClientRect();
  const mh = m.offsetHeight;
  const seen = visibleBox();                         // (above an on-screen keyboard)
  if (side.below == null) side.below = align === 'end' ? true : r.bottom + 6 + mh < seen.bottom || r.top < seen.top + mh + 12;
  const left = align === 'end' ? Math.max(8, r.right - m.offsetWidth) : Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8));
  m.style.left = `${left + scrollX}px`;
  m.style.top = `${(side.below ? r.bottom + 6 : r.top - mh - 6) + scrollY}px`;
}
/** a submenu beside its row: its first row level with it, to the right of its panel, else to the left; with room for
 *  neither (a phone), under its row, indented (the row it opened from stays in sight, and under the finger) */
function placeSub(m: HTMLElement, row: Element, panel: Element) {
  const r = row.getBoundingClientRect(), p = panel.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const seen = visibleBox(), inset = m.querySelector('.menu-item')?.getBoundingClientRect().top ?? 0;
  const pad = inset ? inset - m.getBoundingClientRect().top : 4;
  let left = p.right - 2, top = r.top - pad;
  if (left + w > innerWidth - 8) {
    if (p.left - w + 2 >= 8) left = p.left - w + 2;
    else { left = Math.max(8, Math.min(p.left + 24, innerWidth - w - 8)); top = r.bottom + 2; }
  }
  top = Math.max(seen.top + 8, Math.min(top, seen.bottom - h - 8));
  m.style.left = `${left + scrollX}px`;
  m.style.top = `${top + scrollY}px`;
}

// a control that opens the menu (a button): a press on it is the menu's toggle, not a press outside
const isToggle = (a: Element | null) => !!a?.matches?.('button, [role="button"], [aria-haspopup]');

function host(make: (h: MenuHandle) => VNode, anchor: Element | null): MenuHandle {
  let open = true, layer: ReturnType<typeof openLayer> | null = null;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const h: MenuHandle = {
    el: null,
    onCancel: null, onClosed: null,
    contains: (n) => !!layer?.contains(n),
    close(cancelled = true) {
      if (!open) return;
      open = false;
      // a pick: the focus goes back to what had it before the menu took it (the entry may then move it)
      const inside = !!layer && layer.el.contains(document.activeElement);
      layer?.close();
      h.el = null;
      if (!cancelled && inside && opener?.isConnected) opener.focus({ preventScroll: true });
      h.onClosed?.(h);
      if (cancelled) h.onCancel?.();
    },
    get open() { return open; },
  };
  // the click that began as a press on this menu's button while it was open: it closed it, it does not reopen it
  if (toggling(anchor)) { open = false; return h; }
  layer = openLayer(() => make(h), { kind: 'menu', anchor, toggle: isToggle(anchor), onDismiss: () => h.close() });
  layer.el.classList.add('menu-host');
  h.el = layer.el.firstElementChild as HTMLElement | null;
  return h;
}

/** the entries of each open panel: the menu's, then each open submenu's */
function panelsOf(items: readonly MenuEntry[], path: readonly number[]): (readonly MenuEntry[])[] {
  const out = [items];
  for (const i of path) {
    const e = out[out.length - 1]![i];
    if (!e || isSep(e) || !e.items) break;
    out.push(e.items);
  }
  return out;
}

function Row({ it, i, lead, open, onPick, onEnter }: { it: MenuCommand; i: number; lead: boolean; open: boolean; onPick: (e: MouseEvent) => void; onEnter: () => void }) {
  const off = inactive(it), sub = !!it.items;
  const L = it.checked ? Icon.check : it.icon ? Icon[it.icon] : null;
  return html`<button type="button" class=${`menu-item${open ? ' sel' : ''}`} role=${it.checked != null ? 'menuitemcheckbox' : 'menuitem'} data-action=${it.key} data-i=${i}
      tabindex="-1" disabled=${off} aria-checked=${it.checked != null ? String(it.checked) : undefined}
      aria-haspopup=${sub ? 'menu' : undefined} aria-expanded=${sub ? String(open) : undefined} onClick=${onPick}
      onPointerEnter=${(e: PointerEvent) => { if (e.pointerType !== 'touch') onEnter(); }}>
    ${lead ? html`<span class="mi-lead" aria-hidden="true">${L ? html`<${L} />` : null}</span>` : null}
    ${it.hint ? html`<span class="mi-text"><span class="mi-label">${it.label}</span><span class="mi-hint">${it.hint}</span></span>` : html`<span class="mi-label">${it.label}</span>`}
    ${it.shortcut ? html`<span class="mi-key">${it.shortcut}</span>` : null}
    ${sub ? html`<span class="mi-sub" aria-hidden="true"><${Icon.chevronRight} /></span>` : null}
  </button>`;
}

function MenuView({ h, anchor, cls, items, align, focus, label }: { h: MenuHandle; anchor: Element; cls: string; items: readonly MenuEntry[]; align: string; focus: boolean; label?: string }) {
  const panels = useRef<(HTMLDivElement | null)[]>([]), side = useRef<Side>({});
  const [path, setPath] = useState<number[]>([]);
  const want = useRef<{ level: number; i: number | 'first' } | null>(null);     // the row to focus once drawn
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levels = panelsOf(items, path);
  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useLayoutEffect(() => {
    place(panels.current[0]!, anchor, side.current, align);
    if (focus) want.current = { level: 0, i: 'first' }; else panels.current[0]!.focus({ preventScroll: true });
    return stopTimer;
  }, []);
  useLayoutEffect(() => {
    for (let k = 1; k < levels.length; k++) {
      const p = panels.current[k], parent = panels.current[k - 1], row = parent?.querySelector(`[data-i="${path[k - 1]}"]`);
      if (p && parent && row) placeSub(p, row, parent);
    }
    const w = want.current;
    if (w) {
      want.current = null;
      const list = levels[w.level], el = panels.current[w.level];
      const i = w.i === 'first' ? (list ? edge(list, false) : -1) : w.i;
      el?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus({ preventScroll: true });
    }
  });
  const rowAt = (level: number, i: number) => panels.current[level]?.querySelector<HTMLElement>(`[data-i="${i}"]`) ?? null;
  const focused = (level: number) => { const a = document.activeElement as HTMLElement | null; return a && panels.current[level]?.contains(a) && a.dataset.i != null ? Number(a.dataset.i) : -1; };
  /** submenu `i` of panel `level` open (its first row focused: from the keyboard) */
  const openSub = (level: number, i: number, first: boolean) => {
    stopTimer();
    if (first) want.current = { level: level + 1, i: 'first' };
    if (path.length === level + 1 && path[level] === i) { if (first) setPath([...path]); return; }
    setPath([...path.slice(0, level), i]);
  };
  /** the submenus after panel `level` closed; `back`: the focus on that panel's open row */
  const closeAfter = (level: number, back: boolean) => {
    stopTimer();
    if (back && path[level] != null) want.current = { level, i: path[level]! };
    if (path.length > level) setPath(path.slice(0, level));
  };
  const pick = (level: number, i: number, it: MenuCommand) => (e: MouseEvent) => {
    if (it.items) { openSub(level, i, e.detail === 0); return; }     // (detail 0: Enter or Space, not a pointer)
    h.close(false);
    it.fn?.();
  };
  const enter = (level: number, i: number, it: MenuCommand) => () => {
    if (it.items && !inactive(it)) { openSub(level, i, false); return; }
    if (path.length > level) { stopTimer(); timer.current = setTimeout(() => { timer.current = null; setPath((p) => p.slice(0, level)); }, GRACE); }
  };
  const key = (level: number) => (e: KeyboardEvent) => {
    const list = levels[level]!, at = focused(level);
    const go = (i: number) => { if (i >= 0) { e.preventDefault(); rowAt(level, i)?.focus({ preventScroll: true }); } };
    if (e.key === 'ArrowDown') go(step(list, at, 1));
    else if (e.key === 'ArrowUp') go(at < 0 ? edge(list, true) : step(list, at, -1));
    else if (e.key === 'Home') go(edge(list, false));
    else if (e.key === 'End') go(edge(list, true));
    else if (e.key === 'ArrowRight') {
      const it = list[at];
      if (it && !isSep(it) && it.items && !inactive(it)) { e.preventDefault(); openSub(level, at, true); }
    } else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && level > 0) {
      e.preventDefault(); e.stopPropagation();       // (Escape: this submenu only, not the menu: the layer sees it prevented)
      closeAfter(level - 1, true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      h.close();
      if (anchor instanceof HTMLElement && anchor.isConnected) anchor.focus({ preventScroll: true });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) go(typeAhead(list, at, e.key));
  };
  return html`${levels.map((list, level) => {
    const lead = leads(list), parent = level ? levels[level - 1]![path[level - 1]!] as MenuCommand : null;
    return html`<div key=${`p${level}`} ref=${(el: HTMLDivElement | null) => { panels.current[level] = el; }} class=${`menu ${cls}${level ? ' menu-sub' : ''}`} role="menu"
        aria-label=${parent ? parent.label : label} tabindex="-1" data-level=${level} onKeyDown=${key(level)} onPointerEnter=${level ? stopTimer : undefined}>
      ${list.map((it, i) => (isSep(it) ? html`<div key=${`s${i}`} class="menu-sep" role="separator"></div>`
        : html`<${Row} key=${it.key ?? i} it=${it} i=${i} lead=${lead} open=${path[level] === i && levels.length > level + 1}
            onPick=${pick(level, i, it)} onEnter=${enter(level, i, it)} />`))}
    </div>`;
  })}`;
}

export function openMenu({ anchor, cls = 'block-menu', items, align = 'start', focus = false, label, onCancel = null, onClosed = null }: {
  anchor: Element; cls?: string; items: readonly MenuEntry[]; align?: string; focus?: boolean; label?: string;
  onCancel?: (() => void) | null; onClosed?: ((h: MenuHandle) => void) | null;
}): MenuHandle {
  const h = host((hh) => html`<${MenuView} h=${hh} anchor=${anchor} cls=${cls} items=${items} align=${align} focus=${focus} label=${label} />`, anchor);
  h.onCancel = onCancel; h.onClosed = onClosed;
  return h;
}

/** a block kind of the slash menu (doc/kinds.js) */
export interface SlashKind { kind: string; label: string; hint?: string; icon?: string; group?: string; env?: string; source?: string; caret?: number }

function SlashView({ h, anchor, kinds, onPick }: { h: MenuHandle; anchor: Element; kinds: readonly SlashKind[]; onPick: (k: SlashKind) => void }) {
  const ref = useRef<HTMLDivElement>(null), side = useRef<Side>({}), filterRef = useRef<HTMLInputElement>(null), listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const qq = q.trim().toLowerCase();
  const items = kinds.filter((t) => !qq || t.label.toLowerCase().includes(qq) || String(t.kind).includes(qq) || (t.hint ?? '').toLowerCase().includes(qq));
  const at = Math.min(sel, Math.max(0, items.length - 1));
  useLayoutEffect(() => { place(ref.current!, anchor, side.current, 'start'); listRef.current!.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); });
  useLayoutEffect(() => { filterRef.current!.focus(); }, []);
  const pick = (t: SlashKind) => { h.close(false); onPick(t); };
  const key = (e: KeyboardEvent) => {
    const n = Math.max(1, items.length);
    if (e.key === 'ArrowDown') { setSel((at + 1) % n); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setSel((at - 1 + items.length) % n); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = items[at]; if (t) pick(t); }
    else if (e.key === 'Backspace' && !(e.currentTarget as HTMLInputElement).value) { e.preventDefault(); h.close(); }   // Escape: the layer
  };
  const rows: VNode[] = [];
  let group: string | undefined | null = null;
  items.forEach((t, k) => {
    if (t.group !== group && !qq) { group = t.group; rows.push(html`<div key=${`g:${group}`} class="menu-title">${group}</div>`); }
    rows.push(html`<button key=${`k:${t.env ?? t.kind}:${t.label}`} class=${`menu-item${k === at ? ' sel' : ''}`} role="option" data-kind=${t.env ?? t.kind} aria-selected=${String(k === at)}
        onPointerDown=${(e: PointerEvent) => e.preventDefault()} onClick=${() => pick(t)} onPointerMove=${() => { if (at !== k) setSel(k); }}>
      <span class="mi-icon">${t.icon ?? ''}</span><span class="mi-text"><span class="mi-label">${t.label}</span><span class="mi-hint">${t.hint ?? ''}</span></span>
    </button>`);
  });
  return html`<div ref=${ref} class="menu slash" role="listbox" aria-label="Block types">
    <input ref=${filterRef} class="menu-filter" placeholder="Filter…" aria-label="Filter block types" spellcheck="false" value=${q}
      onInput=${(e: Event) => { setQ((e.currentTarget as HTMLInputElement).value); setSel(0); }} onKeyDown=${key} />
    <div ref=${listRef} class="menu-list">${rows}${items.length ? null : html`<div class="menu-empty">No block type matches</div>`}</div>
  </div>`;
}

export function openSlash({ anchor, kinds, onPick, onCancel = null, onClosed = null }: {
  anchor: Element; kinds: readonly SlashKind[]; onPick: (k: SlashKind) => void; onCancel?: (() => void) | null; onClosed?: ((h: MenuHandle) => void) | null;
}): MenuHandle {
  const h = host((hh) => html`<${SlashView} h=${hh} anchor=${anchor} kinds=${kinds} onPick=${onPick} />`, anchor);
  h.onCancel = onCancel; h.onClosed = onClosed;
  return h;
}
