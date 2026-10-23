// <main> (its scroller and the host its DocumentView mounts into). Rendered once into a `display: contents` host
// right after the pane before it, so both stay grid items of #editor-view; the divider's drag and keys are the
// panes registry's (panes/index.js).
//
//   const c = mountSplitChrome(after, { pane, onPointerDown(e), onKeyDown(e) })    pane: its id ('b')
//   c.divider · c.pane (its <main>: #page-<id>) · c.host · c.add (the host of its "Add a block") · c.destroy()
import { html, mountInto } from '../design/ui/core.js';
import { Island } from '../design/ui/island.js';

function SplitChrome({ pane, ids, onPointerDown, onKeyDown }) {
  return html`<div class="split-divider" role="separator" aria-orientation="vertical" aria-label="Resize the panes" tabindex="0"
      onPointerDown=${onPointerDown} onKeyDown=${onKeyDown}></div>
    <main id=${`${ids}${pane}`} class=${`pane-${pane}`} data-pane=${pane} aria-label="Second pane"><${Island} class="doc-view-host" /><${Island} class="add-end-host" /></main>`;
}

/** @returns {{ divider: HTMLElement, pane: HTMLElement, host: HTMLElement, add: HTMLElement | null, destroy: () => void }} */
export function mountSplitChrome(after, { pane = 'b', ids = 'page-', ...handlers }) {
  const m = mountInto(html`<${SplitChrome} pane=${pane} ids=${ids} ...${handlers} />`, after.parentElement);
  m.el.classList.add('split-chrome');
  after.after(m.el);
  return {
    divider: m.el.querySelector(':scope > .split-divider'),
    pane: m.el.querySelector(':scope > main'),
    host: m.el.querySelector(':scope > main > .doc-view-host'),
    add: m.el.querySelector(':scope > main > .add-end-host'),
    destroy: () => m.destroy(),
  };
}
