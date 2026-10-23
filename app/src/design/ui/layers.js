// SURFACES: the editor's ONE overlay layer. Every floating thing (menus, popovers, the reference card,
// dialogs and sheets, toasts, the Back pill) registers here, so there is one stacking order, one Escape order, one
// outside-press rule and one focus return, instead of a handler and an exclusion list per module.
//
//   const l = pushLayer({ el, kind, anchor, toggle, onDismiss(reason), returnFocus })   an element already in the page
//   l.remove() · l.contains(node) · l.el
//   openLayer(make, { kind, … })    a fresh host on <body> for make(close); with `kind` it is pushed as a layer
//   owns(node)                      a press on `node` belongs to a layer, to a foreign floating box (CodeMirror's
//                                   tooltips) or to the app's chrome ([data-ui-chrome]): not "outside" for a document
//   toggling(anchor)                this click began as a press on `anchor` while its layer was open (the opener
//                                   then closes instead of opening again)
//   layerState()                    tests: [{ kind, z, el }] bottom to top
//
// kinds: 'menu', 'popover', 'card' (float tier: Escape and an outside press dismiss them); 'modal' (native modal
// <dialog>s: the browser's top layer; Escape dismisses, the backdrop is the dialog's own); 'toast' and 'pill'
// (stacking only: they are never dismissed by Escape or a press).
//
// The rules:
// - Stacking: z-index from the tokens, per tier (--ui-z-pill < --ui-z-float < --ui-z-toast < --ui-z-tip), plus the
//   layer's place in the stack: a later layer of a tier is above an earlier one.
// - Escape dismisses the topmost layer that Escape dismisses, and nothing else sees that key. With the focus inside
//   that layer, the layer's own listener decides, after the widgets inside it (an Escape a CodeMirror completion or a
//   field consumed, i.e. defaultPrevented, is theirs); with the focus elsewhere, a window capture listener does.
// - An outside press dismisses, from the top, every float layer the press is outside of, and stops at the first
//   layer that contains it, at a modal, or at a toggle anchor (a press on the button that opened the layer: its own
//   click toggles it). The press itself goes on to where it was aimed.
// - Focus: after an Escape, the focus goes back to `returnFocus` (default: what had the focus when the layer opened)
//   unless the dismiss moved it somewhere on purpose.
import { render } from './core.js';

const TIER = { menu: 'float', popover: 'float', card: 'float', modal: 'modal', toast: 'toast', pill: 'pill' };
const ESCAPES = { float: true, modal: true, toast: false, pill: false };
const stack = [];
const pressed = new Set();
let installed = false;

function restack() {
  const at = {};
  for (const l of stack) {
    const t = TIER[l.kind];
    if (t === 'modal') continue;            // native modal dialogs live in the browser's top layer
    at[t] = (at[t] ?? 0) + 1;
    l.el.style.zIndex = `calc(var(--ui-z-${t}) + ${at[t]})`;
  }
}
const topEscapable = () => { for (let i = stack.length - 1; i >= 0; i--) if (ESCAPES[TIER[stack[i].kind]]) return stack[i]; return null; };
const inside = (l, n) => !!n && (l.el.contains(n) || (l.toggle && !!l.anchor?.contains?.(n)));

function focusBack(l) {
  const a = document.activeElement;
  if (a && a !== document.body && !l.el.contains(a) && a.isConnected) return;   // the dismiss put it somewhere
  const f = typeof l.returnFocus === 'function' ? l.returnFocus() : l.returnFocus ?? l.opener;
  if (f?.isConnected && typeof f.focus === 'function') f.focus({ preventScroll: true });
}
function dismiss(l, reason, e) {
  if (!stack.includes(l)) return;
  if (e) { e.preventDefault(); e.stopPropagation(); }
  l.onDismiss?.(reason, e);
  if (reason === 'escape') focusBack(l);
}

function install() {
  if (installed) return;
  installed = true;
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    const l = topEscapable();
    if (!l || l.el.contains(e.target)) return;      // inside: the layer's own listener, after its widgets
    dismiss(l, 'escape', e);
  }, true);
  addEventListener('pointerdown', (e) => {
    pressed.clear();
    const t = e.target;
    for (let i = stack.length - 1; i >= 0; i--) {
      const l = stack[i], tier = TIER[l.kind];
      if (tier === 'toast' || tier === 'pill') { if (l.el.contains(t)) return; continue; }
      if (l.el.contains(t)) return;
      if (l.toggle && l.anchor?.contains?.(t)) { pressed.add(l.anchor); return; }
      if (tier === 'modal') return;
      dismiss(l, 'outside');
    }
  }, true);
  // a click's own handlers have run (bubble, at the window): the press that began it is over
  addEventListener('click', () => pressed.clear());
}

/** Register an element that floats. Returns { el, remove(), contains(node) }. */
export function pushLayer({ el, kind = 'popover', anchor = null, toggle = false, onDismiss = null, returnFocus = null }) {
  install();
  const l = { el, kind, anchor, toggle, onDismiss, returnFocus, opener: document.activeElement };
  const key = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || topEscapable() !== l) return;
    dismiss(l, 'escape', e);
  };
  if (ESCAPES[TIER[kind]]) el.addEventListener('keydown', key);
  stack.push(l);
  restack();
  return {
    el,
    contains: (n) => inside(l, n),
    remove() {
      const i = stack.indexOf(l);
      if (i < 0) return;
      stack.splice(i, 1);
      el.removeEventListener('keydown', key);
      if (TIER[kind] !== 'modal') el.style.zIndex = '';
      restack();
    },
  };
}

/** A host on <body> for make(close). With `kind`, the host is a layer (pushLayer) and `onDismiss` defaults to close.
 *  The host is position: absolute at the page's origin, 0 × 0: its children place themselves in page (absolute)
 *  or viewport (fixed) coordinates, inside the host's stacking context. */
export function openLayer(make, { kind = null, anchor = null, toggle = false, onDismiss = null, returnFocus = null } = {}) {
  install();
  const el = document.createElement('div');
  el.className = 'ui-layer';
  document.body.append(el);
  let open = true, layer = null;
  const close = () => { if (!open) return; open = false; layer?.remove(); render(null, el); el.remove(); };
  if (kind) layer = pushLayer({ el, kind, anchor, toggle, returnFocus, onDismiss: onDismiss ?? (() => close()) });
  render(make(close), el);
  return { close, el, update: () => open && render(make(close), el), contains: (n) => (layer ? layer.contains(n) : el.contains(n)) };
}

/** Foreign floating boxes: in the page's DOM, not ours to register (CodeMirror's completion and hover tooltips). */
const FOREIGN = '.cm-tooltip';
/** A press on `node` belongs to a layer or the app's chrome: a document's "press outside" rule ignores it. */
export function owns(node) {
  const n = node?.nodeType === 1 ? node : node?.parentElement;
  if (!n) return false;
  if (stack.some((l) => l.el.contains(n))) return true;
  return !!n.closest(`${FOREIGN}, [data-ui-chrome]`);
}
/** This click began with a press on `anchor` while the layer it opened was open: the opener toggles it closed. */
export const toggling = (anchor) => !!anchor && pressed.has(anchor);
/** tests: the stack, bottom to top */
export const layerState = () => stack.map((l) => ({ kind: l.kind, z: l.el.style.zIndex, el: l.el }));
