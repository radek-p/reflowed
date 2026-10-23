// the kit's base: htm bound to Preact, the CSS injected once, small helpers.
import { h, render, Fragment } from 'preact';
import htm from 'htm';
import TOKENS from '../tokens.css.js';
import UI from '../ui.css.js';

export const html = htm.bind(h);
export { h, render, Fragment };

/** Inject tokens.css + ui.css once (both builds: the CSS travels in the bundle). */
export function ensureStyles(doc = document) {
  if (doc.getElementById('rtx-ui-css')) return;
  const s = doc.createElement('style');
  s.id = 'rtx-ui-css';
  s.textContent = `${TOKENS}\n${UI}`;
  // before the app's own sheets: a surface's local rules (app.css, module CSS) can refine the kit
  const first = doc.head.querySelector('link[rel="stylesheet"], style');
  doc.head.insertBefore(s, first ?? null);
}
if (typeof document !== 'undefined') ensureStyles();

/** class names: strings, falsy skipped, { name: bool } objects */
export function cx(...a) {
  const out = [];
  for (const x of a) {
    if (!x) continue;
    if (typeof x === 'string') out.push(x);
    else if (typeof x === 'object') for (const [k, v] of Object.entries(x)) if (v) out.push(k);
  }
  return out.join(' ');
}

let uid = 0;
export const nextId = (p = 'ui') => `${p}-${++uid}`;

/** Render a vnode into a fresh element appended to `parent` (default body); returns { el, update, destroy }. */
export function mountInto(vnode, parent = document.body, tag = 'div') {
  const el = document.createElement(tag);
  el.className = 'ui-host';
  el.style.display = 'contents';
  parent.append(el);
  render(vnode, el);
  return {
    el,
    update(v) { render(v, el); },
    destroy() { render(null, el); el.remove(); },
  };
}
