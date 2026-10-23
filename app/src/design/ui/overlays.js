// Popover, Menu/MenuItem, Dialog, Sheet, Toast, Tooltip. Positioned before the
// first paint (useLayoutEffect), kept on the anchor while the page scrolls, no
// jump: a popover that fits below stays below for its whole life.
import { html, cx, nextId, render } from './core.js';
import { useLayoutEffect, useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { Icon } from './icons.ts';
import { Tabs } from './controls.js';
import { pushLayer, openLayer } from './layers.js';
import { viewBox } from './view-box.ts';
import { visibleBox } from '../../../../workbench/src/viewport.ts';
export { openLayer };

const GAP = 6, EDGE = 8;

/** a start along one axis, kept inside [lo, hi] when the size fits there, else inside the window [0, max]
 *  (a popover wider than a narrow pane: it was pushed past the window's edge); larger than the window: from its start */
function clampIn(start, size, lo, hi, max) {
  if (size + 2 * EDGE > hi - lo) { lo = 0; hi = max; }
  return Math.max(lo + EDGE, Math.min(start, hi - size - EDGE));
}

/** Place `el` (position: fixed) next to `anchor` (an element or a DOMRect-like), inside the box it may use: anchored in a
 *  document view (or `within` one), that view below its strip and the bar (view-box.ts); else the window. */
export function place(el, anchor, { placement = 'bottom-start', keep = null, within = null } = {}) {
  const isEl = typeof anchor?.getBoundingClientRect === 'function';
  const r = isEl ? anchor.getBoundingClientRect() : anchor;
  if (!r) return keep;
  const B = viewBox(within ?? (isEl ? anchor : null));
  const w = el.offsetWidth, hgt = el.offsetHeight;
  const [side, align] = placement.split('-');
  let below = keep ?? (side === 'bottom' ? r.bottom + GAP + hgt <= B.bottom - EDGE || r.top < B.top + hgt + GAP + EDGE : !(r.top - GAP - hgt >= B.top + EDGE) && r.bottom + GAP + hgt <= B.bottom);
  let top = below ? r.bottom + GAP : r.top - GAP - hgt;
  top = clampIn(top, hgt, B.top, B.bottom, visibleBox().bottom);
  let left = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
  left = clampIn(left, w, B.left, B.right, innerWidth);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  return below;
}

/** A floating panel on `anchor`. Closes on Escape and on a press outside (onClose). */
export function Popover({ anchor, placement = 'bottom-start', onClose, pad = true, class: c = '', role = 'dialog', label, children, focus = true, ...rest }) {
  const ref = useRef(null);
  const side = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    side.current = place(el, anchor, { placement });
    let raf = 0;
    const follow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { side.current = place(el, anchor, { placement, keep: side.current }); }); };
    addEventListener('scroll', follow, { capture: true, passive: true });
    addEventListener('resize', follow);
    const ro = new ResizeObserver(follow); ro.observe(el);
    return () => { cancelAnimationFrame(raf); removeEventListener('scroll', follow, { capture: true }); removeEventListener('resize', follow); ro.disconnect(); };
  }, [anchor, placement]);
  // Escape and an outside press: the one overlay layer (layers.js); a press on the anchor is its toggle;
  // after Escape the focus goes back to the anchor
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const l = pushLayer({ el: ref.current, kind: 'popover', anchor: anchor?.contains ? anchor : null, toggle: true,
      returnFocus: anchor?.focus ? anchor : null, onDismiss: (reason) => closeRef.current?.(reason) });
    return () => l.remove();
  }, [anchor]);
  useEffect(() => {
    if (focus) (ref.current.querySelector('[autofocus], input, button:not([disabled]), [tabindex="0"]') ?? ref.current).focus({ preventScroll: true });
  }, [anchor]);
  return html`<div ref=${ref} role=${role} aria-label=${label} tabindex="-1" class=${cx('ui-popover ui-float-in', pad && 'ui-popover--pad', c)} ...${rest}>${children}</div>`;
}

/** A menu: MenuItem, MenuSeparator, MenuLabel children; arrow keys move, type-ahead finds. */
export function Menu({ class: c = '', label, children, onKeyDown, ...rest }) {
  const ref = useRef(null);
  const key = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const items = [...ref.current.querySelectorAll('.ui-menu-item:not(:disabled)')];
    if (!items.length) return;
    const k = items.indexOf(document.activeElement);
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
    if (n >= 0) { e.preventDefault(); items[n].focus(); }
  };
  return html`<div ref=${ref} role="menu" aria-label=${label} class=${cx('ui-menu', c)} onKeyDown=${key} ...${rest}>${children}</div>`;
}

/** icon: an Icon name or node; tile: a glyph in a framed square (the slash menu); hint: a second line; shortcut: at the right */
export function MenuItem({ label, hint, shortcut, icon, tile, danger, disabled, active, onSelect, class: c = '', role = 'menuitem', children, ...rest }) {
  return html`<button type="button" role=${role} disabled=${disabled} class=${cx('ui-menu-item', danger && 'ui-menu-item--danger', active && 'is-active', c)}
    onClick=${onSelect} ...${rest}>
    ${tile != null ? html`<span class="ui-mi-tile" aria-hidden="true">${tile}</span>` : icon ? (typeof icon === 'string' ? html`<${Icon[icon]} />` : icon) : null}
    ${hint ? html`<span class="ui-mi-text"><span class="ui-mi-label">${label}</span><span class="ui-mi-hint">${hint}</span></span>` : html`<span class="ui-mi-label">${label}</span>`}
    ${shortcut ? html`<span class="ui-mi-key">${shortcut}</span>` : null}${children}
  </button>`;
}
export const MenuSeparator = () => html`<div class="ui-menu-sep" role="separator"></div>`;
export const MenuLabel = ({ children, class: c = '' }) => html`<div class=${cx('ui-menu-label', c)} role="presentation">${children}</div>`;

/** A modal dialog (native <dialog>): title row with a close button, body, optional footer. */
export function Dialog({ open = true, title, onClose, footer, wide = false, class: c = '', label, children, ...rest }) {
  const ref = useRef(null);
  const tid = useRef(nextId('dlg')).current;
  // the close listener is attached before the dialog opens, in a layout effect: an Esc right after it
  // opened (before a passive effect ran) closed it without telling onClose, and the closed dialog stayed
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const d = ref.current;
    const closed = () => closeRef.current?.();
    d.addEventListener('close', closed);
    return () => d.removeEventListener('close', closed);
  }, []);
  // a modal layer while open: Escape through the one overlay layer (the dialog closes, onClose follows)
  useLayoutEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
    if (!open) return undefined;
    const l = pushLayer({ el: d, kind: 'modal', onDismiss: () => { if (d.open) d.close(); } });
    return () => l.remove();
  }, [open]);
  return html`<dialog ref=${ref} class=${cx('ui-dialog', wide && 'ui-dialog--wide', c)} aria-labelledby=${title ? tid : undefined} aria-label=${title ? undefined : label} ...${rest}>
    ${title != null ? html`<div class="ui-dialog-head"><h2 class="ui-dialog-title" id=${tid}>${title}</h2>
      <button type="button" class="ui-icon-btn ui-icon-btn--quiet dlg-close" aria-label="Close" title="Close" onClick=${() => ref.current.close()}><${Icon.close} /></button></div>` : null}
    <div class="ui-dialog-body">${children}</div>
    ${footer ? html`<div class="ui-dialog-foot">${footer}</div>` : null}
  </dialog>`;
}

/** THE side sheet: one for every right-edge panel (Document settings, the title form). A native modal
 *  <dialog> at the right edge, one width (--ui-sheet-w), one header (title, close), optional tabs under the header
 *  (outside the scrolling body), one body layout (a flex column, one gap), one footer (a note at the left, the
 *  actions at the right), the scrim, the motion. Behaviour:
 *  - onClose(reason): 'escape' (Esc, through the one overlay layer, after the widgets inside it), 'outside' (a press
 *    that starts and ends on the scrim), 'close' (the close button); the caller decides what each means and
 *    unmounts it;
 *  - the first focus: [autofocus] inside, else the first field of the body, else the sheet; the focus goes back to
 *    what had it before when the sheet goes (if nothing else took it);
 *  - the page under it does not scroll (wheel and touch on the scrim, and a wheel inside that nothing inside can
 *    take, stop there): no overflow: hidden on the page, so nothing reflows under the sheet.
 *  tabs: { items, value, onChange, label, idPrefix } (the kit's Tabs, strip variant); note: the footer's leading text
 *  (aria-live); footer: the actions. */
export function Sheet({ title, onClose, footer, note, tabs, class: c = '', label, children, ...rest }) {
  const ref = useRef(null);
  const tid = useRef(nextId('sheet')).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const d = ref.current;
    const opener = document.activeElement;
    d.showModal();
    const shown = (el) => el.getClientRects().length > 0;
    const first = [...d.querySelectorAll('[autofocus], .ui-sheet-body :is(input:not([type=hidden]), textarea, select, [contenteditable="true"]):not([disabled])')].find(shown);
    (first ?? d).focus({ preventScroll: true });
    const cancel = (e) => { e.preventDefault(); closeRef.current?.('escape'); };
    // Escape through the one overlay layer, on the sheet itself after the widgets inside it (an Escape a completion
    // consumed is theirs); registered before `key`, which keeps every key typed in the sheet from the page's own
    // handlers and shortcuts (the sheet is modal)
    const layer = pushLayer({ el: d, kind: 'modal', onDismiss: (reason) => closeRef.current?.(reason) });
    const key = (e) => { e.stopPropagation(); };
    // a press that starts and ends on the scrim (the dialog element itself, outside its box)
    let downOut = false;
    const outside = (e) => { const r = d.getBoundingClientRect(); return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); };
    const down = (e) => { downOut = outside(e); };
    const up = (e) => { if (downOut && outside(e)) closeRef.current?.('outside'); downOut = false; };
    // the page does not scroll under the sheet: a wheel nothing inside can take stops here
    const wheel = (e) => { if (e.target === d || !scrollsInside(e.target, d, e.deltaY, e.deltaX)) e.preventDefault(); };
    const touch = (e) => { if (e.target === d) e.preventDefault(); };
    d.addEventListener('cancel', cancel);
    d.addEventListener('keydown', key);
    d.addEventListener('pointerdown', down);
    d.addEventListener('click', up);
    d.addEventListener('wheel', wheel, { passive: false });
    d.addEventListener('touchmove', touch, { passive: false });
    return () => {
      d.removeEventListener('cancel', cancel); d.removeEventListener('keydown', key); d.removeEventListener('pointerdown', down); d.removeEventListener('click', up);
      d.removeEventListener('wheel', wheel); d.removeEventListener('touchmove', touch);
      layer.remove();
      const had = d.contains(document.activeElement);
      if (d.open) d.close();
      const a = document.activeElement;
      if ((had || !a || a === document.body) && opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, []);
  return html`<dialog ref=${ref} class=${cx('ui-sheet', c)} aria-labelledby=${title ? tid : undefined} aria-label=${title ? undefined : label} ...${rest}>
    <div class="ui-dialog-head ui-sheet-head"><h2 class="ui-dialog-title" id=${tid}>${title}</h2>
      <button type="button" class="ui-icon-btn ui-icon-btn--quiet sheet-close" aria-label="Close" title="Close" onClick=${() => closeRef.current?.('close')}><${Icon.close} /></button></div>
    ${tabs ? html`<${Tabs} variant="strip" class="ui-sheet-tabs" ...${tabs} />` : null}
    <div class="ui-dialog-body ui-sheet-body">${children}</div>
    ${footer || note ? html`<div class="ui-dialog-foot ui-sheet-foot">${note != null ? html`<span class="ui-sheet-note" aria-live="polite">${note}</span>` : null}${footer}</div>` : null}
  </dialog>`;
}
/** can something between `el` and `root` scroll by (dy, dx)? */
function scrollsInside(el, root, dy, dx) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (dy && /(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      if ((dy < 0 && n.scrollTop > 0) || (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return true;
    }
    if (dx && /(auto|scroll)/.test(st.overflowX) && n.scrollWidth > n.clientWidth + 1) {
      if ((dx < 0 && n.scrollLeft > 0) || (dx > 0 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1)) return true;
    }
  }
  return false;
}

/** One toast; action: { key, label, onClick, id? }; textId: the text's id (the app's #toast-text hook) */
export function Toast({ text, action, leaving = false, textId, class: c = '', ...rest }) {
  return html`<div role="status" aria-live="polite" class=${cx('ui-toast', leaving && 'is-leaving', c)} ...${rest}>
    <span class="ui-toast-text" id=${textId}>${text}</span>
    ${action ? html`<button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" id=${action.id} data-action=${action.key ?? 'action'} onClick=${action.onClick}>${action.label}</button>` : null}
  </div>`;
}

/** A tooltip on its child (hover after 500 ms, focus at once); `text` and an optional `keys` hint. */
export function Tooltip({ text, keys, placement = 'bottom-center', children }) {
  const [anchor, setAnchor] = useState(null);
  const timer = useRef(0);
  const id = useRef(nextId('tip')).current;
  const show = useCallback((e, now) => { const t = e.currentTarget; clearTimeout(timer.current); timer.current = setTimeout(() => setAnchor(t), now ? 0 : 500); }, []);
  const hide = useCallback(() => { clearTimeout(timer.current); setAnchor(null); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return html`<span class="ui-tip-host" style="display: contents"
      onPointerEnter=${(e) => show(e, false)} onPointerLeave=${hide} onFocusIn=${(e) => { if (e.target.matches(':focus-visible')) show(e, true); }} onFocusOut=${hide} onPointerDown=${hide}>
    ${children}${anchor ? html`<${TipBubble} anchor=${anchor.firstElementChild ?? anchor} id=${id} text=${text} keys=${keys} placement=${placement} />` : null}</span>`;
}
function TipBubble({ anchor, id, text, keys, placement }) {
  const ref = useRef(null);
  useLayoutEffect(() => { place(ref.current, anchor, { placement }); anchor.setAttribute?.('aria-describedby', id); return () => anchor.removeAttribute?.('aria-describedby'); }, [anchor]);
  return html`<div ref=${ref} id=${id} role="tooltip" class="ui-tooltip">${text}${keys ? html`<kbd>${keys}</kbd>` : null}</div>`;
}

// ── imperative hosts (plain-DOM code: app.js, modules) ─────────────────────────

let toastHost = null, toastSeq = 0;
const toasts = [];
function drawToasts() {
  if (!toastHost) {
    toastHost = document.createElement('div'); toastHost.className = 'ui-toasts'; document.body.append(toastHost);
    pushLayer({ el: toastHost, kind: 'toast' });     // the one toast stack, in the one layer order
  }
  render(html`${toasts.map((t) => html`<${Toast} key=${t.id} ...${t.props} leaving=${t.leaving} />`)}`, toastHost);
}
/** Show a toast; returns { close }. One at a time by default (a new one replaces the last). */
export function showToast(text, { action = null, duration = 7000, stack = false, class: c = '', ...props } = {}) {
  if (!stack) for (const t of toasts.splice(0)) clearTimeout(t.timer);
  const t = { id: ++toastSeq, leaving: false, props: { text, class: c, ...props, action: action && { ...action, onClick: () => { close(); action.onClick?.(); } } } };
  const close = () => {
    const i = toasts.indexOf(t);
    if (i < 0 || t.leaving) return;
    clearTimeout(t.timer);
    t.leaving = true; drawToasts();
    setTimeout(() => { const k = toasts.indexOf(t); if (k >= 0) toasts.splice(k, 1); drawToasts(); t.onGone?.(); }, 130);
  };
  t.timer = duration ? setTimeout(close, duration) : 0;
  toasts.push(t);
  drawToasts();
  return { close, get element() { return toastHost?.querySelectorAll('.ui-toast')[toasts.indexOf(t)] ?? null; }, set onGone(f) { t.onGone = f; } };
}
