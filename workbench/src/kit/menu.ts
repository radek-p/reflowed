// Menus. ONE item metric for all of them (a row's height, padding, radius, the leading check slot, the label, a key
// hint at the right), so every list lines up by construction. A Select has no check slot: its current row is bold.
//   - Menu / MenuItem / MenuSeparator / MenuLabel (role="menu"): commands (the tab menu, the panel menu); openMenu();
//   - Select (role="grid": rows, each with an optional action button at its right): choosing one of many (the
//     document switcher, the section menu, the theme); openSelect(). APG grid: a menu item may not hold a control.
// The editor's kit names (Menu, MenuItem, MenuSeparator, MenuLabel); Select is ours (the kit has no row actions).
import type { ComponentChildren, JSX } from 'preact';
import { html, render } from '../html.ts';
import { useRef } from 'preact/hooks';
import { Icon, type IconName } from './icons.ts';
import { Popover, cx, type Anchor, type AnchorRect } from './popover.ts';
import { IconButton } from './button.ts';
import { modality } from './layers.ts';
import { TabMark, tsDepth } from './tabstops.ts';

/** The keyboard's mark on a list (a Menu, a Select): data-kbd while the keyboard drives it (opened by a key, or a key
 *  since; a pointer press clears it). The focus ring of its rows and buttons is drawn from it (kit/css.ts): not
 *  :focus-visible, which Chromium carries over from an earlier key into a menu a press opens, and WebKit never gives
 *  to a row the arrow keys focus. */
const kbd = () => ({ 'data-kbd': modality() === 'key' ? '' : undefined, onPointerDown: (e: PointerEvent) => { delete (e.currentTarget as HTMLElement).dataset.kbd; } });
const keyed = (e: KeyboardEvent) => { (e.currentTarget as HTMLElement).dataset.kbd = ''; };
/** A menu: arrow keys move, Home/End, type-ahead. */
export function Menu({ class: c = '', label, children, onKeyDown, ...rest }: { class?: string; label?: string; children?: ComponentChildren; onKeyDown?: (e: KeyboardEvent) => void } & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'label' | 'onKeyDown'>) {
  const ref = useRef<HTMLDivElement>(null);
  const key = (e: KeyboardEvent) => {
    keyed(e);
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>('.wb-menu-item:not(:disabled)')];
    if (!items.length) return;
    const k = items.indexOf(document.activeElement as HTMLElement);
    let n = -1;
    if (e.key === 'ArrowDown') n = (k + 1) % items.length;
    else if (e.key === 'ArrowUp') n = (k - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const q = e.key.toLowerCase();
      n = items.findIndex((it, i) => i > k && it.textContent.trim().toLowerCase().startsWith(q));
      if (n < 0) n = items.findIndex((it) => it.textContent.trim().toLowerCase().startsWith(q));
    }
    if (n >= 0) { e.preventDefault(); items[n]!.focus(); }
  };
  return html`<div ref=${ref} role="menu" aria-label=${label} class=${cx('wb-menu', c)} ...${kbd()} onKeyDown=${key} ...${rest}>${children}</div>`;
}
/** lead: the leading slot (a check when active, else room for one: every row of a list starts at the same x) */
export type MenuItemProps = { label: ComponentChildren; hint?: ComponentChildren; shortcut?: string | null; icon?: IconName; danger?: boolean; disabled?: boolean; active?: boolean; lead?: boolean;
  onSelect?: (e: MouseEvent) => void; class?: string; role?: string; children?: ComponentChildren } & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'label' | 'icon' | 'role'>;
export function MenuItem({ label, hint, shortcut, icon, danger, disabled, active, lead = false, onSelect, class: c = '', role = 'menuitem', children, ...rest }: MenuItemProps) {
  return html`<button type="button" role=${role} disabled=${disabled} class=${cx('wb-menu-item', danger && 'wb-menu-item--danger', active && 'is-active', c)} onClick=${onSelect} ...${rest}>
    ${lead || active ? html`<span class="wb-mi-lead" aria-hidden="true">${active ? html`<${Icon} name="check" />` : null}</span>` : icon ? html`<span class="wb-mi-lead" aria-hidden="true"><${Icon} name=${icon} /></span>` : null}
    ${hint ? html`<span class="wb-mi-text"><span class="wb-mi-label">${label}</span><span class="wb-mi-hint">${hint}</span></span>` : html`<span class="wb-mi-label">${label}</span>`}
    ${shortcut ? html`<span class="wb-mi-key">${shortcut}</span>` : null}${children}
  </button>`;
}
export const MenuSeparator = () => html`<div class="wb-menu-sep" role="separator"></div>`;
export const MenuLabel = ({ children, class: c = '' }: { children?: ComponentChildren; class?: string }) => html`<div class=${cx('wb-menu-label', c)} role="presentation">${children}</div>`;

const open = new Map<Element, () => void>();      // anchor element → close: a second press on the same anchor closes its menu
/** An anchor that cannot take the focus (a tab's section) is placed by its box: the focus then goes back to the opener. */
/** What a menu opens on: an element (its box, its focus back) or a point's rect (a context menu). */
export type MenuAnchor = Element | AnchorRect;
export const placeOf = (a: MenuAnchor, back: HTMLElement | null = null): Anchor => (a instanceof Element && (back || !a.matches('button, [tabindex], a[href], input'))
  ? { getBoundingClientRect: () => a.getBoundingClientRect(), contains: (n: Node | null) => a.contains(n), get isConnected() { return a.isConnected; },
      focus: (o?: FocusOptions) => (back ?? a.closest<HTMLElement>('[tabindex], button') ?? (a as HTMLElement)).focus(o) }
  : a instanceof Element ? (a as HTMLElement) : { getBoundingClientRect: () => a });
/** Close every menu and select this module opened (a double-click turning a press into a rename). */
export function closeMenus(): void { for (const close of [...open.values()]) close(); }
function host(anchor: MenuAnchor): { el: HTMLDivElement; close: () => void } | null {
  if (anchor instanceof Element && open.has(anchor)) { open.get(anchor)!(); return null; }
  const el = document.createElement('div');
  document.body.append(el);
  const close = () => { if (anchor instanceof Element) open.delete(anchor); render(null, el); el.remove(); };
  if (anchor instanceof Element) open.set(anchor, close);
  return { el, close };
}
/** A command menu's entries: commands, separators, headings. */
export type MenuCommand = { id?: string; label: string; onSelect?: (e: MouseEvent) => void; active?: boolean; hint?: string; shortcut?: string | null; disabled?: boolean; danger?: boolean };
export type MenuEntry = MenuCommand | { separator: true } | { heading: string };
export type Opened = { close: () => void; el: HTMLDivElement };
/**
 * A command menu on an anchor (an element or a rect).
 *   items: [{ id?, label, onSelect(e), active?, hint?, shortcut?, disabled?, danger? } | { separator: true } | { heading }]
 */
export function openMenu(anchor: MenuAnchor, items: readonly MenuEntry[], { label = 'Menu', returnFocus = null }: { label?: string; returnFocus?: HTMLElement | null } = {}): Opened | null {
  const h = host(anchor);
  if (!h) return null;
  const lead = items.some((it) => 'active' in it);      // a list with checks: every row keeps the check's room
  render(html`<${Popover} anchor=${placeOf(anchor, returnFocus)} onClose=${h.close} pad=${false} role="presentation" class="wb-menu-pop">
    <${Menu} label=${label}>
      ${items.map((it) => 'separator' in it ? html`<${MenuSeparator} />` : 'heading' in it ? html`<${MenuLabel}>${it.heading}<//>`
        : html`<${MenuItem} label=${it.label} hint=${it.hint} shortcut=${it.shortcut} disabled=${it.disabled} danger=${it.danger} active=${it.active} lead=${lead} data-item=${it.id}
            onSelect=${(e: MouseEvent) => { h.close(); it.onSelect?.(e); }} />`)}
    <//>
  <//>`, h.el);
  return { close: h.close, el: h.el };
}
/**
 * Select: choose one row; a row may carry an action at its right (the document switcher: a row switches the view,
 * its button opens the document in a new tab). ↑ ↓ rows (the same column), ← → or Tab the row's cells, Home/End,
 * Enter or Space activates, Escape closes (the focus back to the opener).
 *   rows: [{ id, label, num?, depth?, active?, onSelect(e), action?: { label, icon, onSelect(e) }, actions?: [ … ] } | { heading }]
 *   actions: more buttons, before the action (the section menu's pin); Tab and ← → go through the row's buttons in order
 *   num: before the label, in the secondary colour (a section's number); depth: nesting (subsections). A list where a
 *        row has a num or a depth is a tab-stop list (kit/tabstops.ts): one tab per depth, the numbers right-aligned to
 *        end at it, the names from it, a bullet where a row has no number
 *   active: the current one, its label in bold (no check slot: a document's title needs the room)
 */
/** The Select's list (role="grid"): rows as openSelect describes; `onDone` after a row or its action is chosen. Rendered
 *  in a popover by openSelect, or inline (the gallery). */
/** a row's action button: { label, icon, onSelect(e) } (key: its data-act, for tests and hosts) */
export type SelectAction = { label: string; icon?: IconName; onSelect?: (e: MouseEvent) => void; key?: string };
export type SelectRow = { id: string; label: string; num?: string; depth?: number; active?: boolean; onSelect?: (e: MouseEvent) => void; action?: SelectAction; actions?: readonly SelectAction[]; heading?: never }
  | { heading: string };
export function Select({ rows, label = 'Select', onDone, class: c = '' }: { rows: readonly SelectRow[]; label?: string; onDone?: () => void; class?: string }) {
  const tabs = rows.some((r) => 'id' in r && (!!r.num || !!r.depth));   // a tab-stop list (kit/tabstops.ts)
  const key = (e: KeyboardEvent) => {
    keyed(e);     // the focused row shows its button and the ring from now on (a pointer press clears it)
    const cell = (e.target as Element).closest<HTMLElement>('[role="gridcell"] > button');
    if (!cell) return;
    const rowsEl = [...(e.currentTarget as HTMLElement).querySelectorAll('[role="row"]')];
    const row = cell.closest('[role="row"]')!, r = rowsEl.indexOf(row), cells = [...row.querySelectorAll('[role="gridcell"] > button')], col = cells.indexOf(cell);
    const at = (ri: number, ci: number) => { const rr = rowsEl[(ri + rowsEl.length) % rowsEl.length]!; const bs = [...rr.querySelectorAll<HTMLElement>('[role="gridcell"] > button')]; (bs[Math.min(ci, bs.length - 1)])?.focus(); };
    let done = true;
    if (e.key === 'ArrowDown') at(r + 1, col);
    else if (e.key === 'ArrowUp') at(r - 1, col);
    else if (e.key === 'ArrowRight') at(r, col + 1);
    else if (e.key === 'ArrowLeft') at(r, col - 1);
    else if (e.key === 'Home') at(0, col);
    else if (e.key === 'End') at(rowsEl.length - 1, col);
    else if (e.key === 'Tab' && !e.shiftKey && col < cells.length - 1) at(r, col + 1);
    else if (e.key === 'Tab' && e.shiftKey && col > 0) at(r, col - 1);
    else done = false;
    if (done) e.preventDefault();
  };
  const button = (r: Extract<SelectRow, { id: string }>, a: SelectAction, primary: boolean) => html`<div role="gridcell" class="wb-row-act"><${IconButton} class="wb-row-btn" tabindex="-1"
      icon=${a.icon ?? 'newTab'} label=${a.label} data-action-for=${primary ? r.id : undefined} data-act=${a.key}
      onClick=${(e: MouseEvent) => { onDone?.(); a.onSelect?.(e); }} /></div>`;
  // the row's buttons: its actions, then its action (the new tab, at the right). In a tab-stop list they take no room:
  // they overlay the end of the name (.wb-ts-acts) while shown, and the name ellipsises before them only then
  const acts = (r: Extract<SelectRow, { id: string }>) => [...(r.actions ?? []).map((a) => button(r, a, false)), ...(r.action ? [button(r, r.action, true)] : [])];
  return html`    <div class=${cx('wb-menu wb-select', tabs && 'wb-ts', c)} role="grid" aria-label=${label} ...${kbd()} onKeyDown=${key}>
      ${rows.map((r) => 'heading' in r && r.heading ? html`<${MenuLabel}>${r.heading}<//>` : !('id' in r) ? null : html`<div class=${cx('wb-row', tabs && 'wb-ts-sub', r.active && 'is-active')} role="row" data-row=${r.id} data-ts-depth=${tabs ? tsDepth(r.depth) : undefined}
          style=${tabs ? { '--wb-ts-acts': String((r.actions?.length ?? 0) + (r.action ? 1 : 0)) } : undefined}>
        <div role="gridcell" class=${cx('wb-row-main', tabs && 'wb-ts-sub wb-ts-main')}><button type="button" class=${cx('wb-menu-item', tabs && 'wb-ts-sub')} aria-current=${r.active ? 'true' : undefined} data-item=${r.id}
          onClick=${(e: MouseEvent) => { onDone?.(); r.onSelect?.(e); }}>${tabs ? html`<${TabMark} num=${r.num} class="wb-row-num" /><span class="wb-mi-label wb-ts-name">${r.label}</span>` : html`<span class="wb-mi-label">${r.label}</span>`}</button></div>
        ${tabs ? html`<div class="wb-ts-acts" role="presentation">${acts(r)}</div>` : acts(r)}
      </div>`)}
    </div>`;
}
export function openSelect(anchor: MenuAnchor, rows: readonly SelectRow[], { label = 'Select', returnFocus = null }: { label?: string; returnFocus?: HTMLElement | null } = {}): Opened | null {
  const h = host(anchor);
  if (!h) return null;
  render(html`<${Popover} anchor=${placeOf(anchor, returnFocus)} onClose=${h.close} pad=${false} role="presentation" class="wb-menu-pop wb-select-pop">
    <${Select} rows=${rows} label=${label} onDone=${h.close} />
  <//>`, h.el);
  return { close: h.close, el: h.el };
}
