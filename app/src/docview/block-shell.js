// (out of app.js): a block element's skeleton as a Preact component: each pane's view of a block
// (panes/block-view.js) is one, made the same way in every pane.
//
//   .blk[data-id]                         the root: the island DocumentView places (created here, never re-rendered:
//                                         its classes and data attributes belong to the core, nesting, controls)
//     .gutter                             the + (slash menu), the handle (drag, menu) and a heading's focus icon (gutter.js)
//     .blk-main
//       .blk-render[role=button]          the viewer mounts the typeset block here (an island)
//       pre.blk-preview                   the source shown while there is no render (an island the core writes)
//       .blk-source.cm-host               the editor's panel (edit/panel.js renders into it)
//       .errors                           error rows / the live note (edit/panel.js)
//     button[data-action]                 the block's action while `action` (a signal) holds one (svgfig's: .fig-edit)
//
//   const s = mountBlockShell({ id, mirror, onAdd, onFocus, onAction, action })
//     action: a signal of the block's action (app/feature.ts BlockAction: a feature's one button, e.g. svgfig's Edit figure) | null
//   s.root · s.gutter · s.main · s.render · s.preview · s.source · s.errors · s.add · s.handle · s.focus · s.destroy()
import { html, render } from '../design/ui/core.js';
import { Island } from '../design/ui/island.js';
import { BlockGutter } from './gutter.js';
import { installHandleMark } from './handle-mark.js';   // the handle marks its block

// the block's action: a feature contributes it (app/feature.ts blockAction); the shell draws whichever is set
function ActionButton({ action, onAction }) {
  const a = action?.value;
  if (!a) return null;
  return html`<button type="button" class=${a.cls ?? 'blk-action'} data-action=${a.id} title=${a.title ?? a.label} aria-label=${a.title ?? a.label}
    onClick=${(e) => { e.stopPropagation(); onAction?.(); }}>${a.label}</button>`;
}

function BlockShell({ mirror, action, onAction }) {
  return html`<${Island} class="gutter" />
    <div class="blk-main">
      <${Island} class="blk-render" tabindex="0" role="button" aria-label="Edit block" />
      <${Island} tag="pre" class="blk-preview" hidden=${mirror} />
      <${Island} class="blk-source cm-host" hidden=${mirror} />
      <${Island} class="errors" />
    </div>
    ${action ? html`<${ActionButton} action=${action} onAction=${onAction} />` : null}`;
}

export function mountBlockShell({ id, mirror = false, onAdd = null, onFocus = null, onAction = null, action = null } = {}) {
  installHandleMark();
  const root = document.createElement('div');
  root.className = mirror ? 'blk blk-mirror' : 'blk';
  root.dataset.id = id;
  render(html`<${BlockShell} mirror=${mirror} action=${action} onAction=${onAction} />`, root);
  const gutter = root.querySelector(':scope > .gutter');
  // the gutter's buttons: their own root (gutter.js BlockGutter, the kit's icon buttons)
  render(html`<${BlockGutter} onAdd=${onAdd} onFocus=${onFocus} />`, gutter);
  const q = (s) => root.querySelector(s);
  return {
    root, gutter,
    main: q(':scope > .blk-main'),
    render: q(':scope > .blk-main > .blk-render'),
    preview: q(':scope > .blk-main > .blk-preview'),
    source: q(':scope > .blk-main > .blk-source'),
    errors: q(':scope > .blk-main > .errors'),
    add: gutter.querySelector('.g-add'), handle: gutter.querySelector('.g-handle'), focus: gutter.querySelector('.g-focus'),
    destroy() { render(null, gutter); render(null, root); },
  };
}
