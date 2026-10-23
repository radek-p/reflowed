// a block's hover gutter (+ and the drag handle) as a Preact component
//. The core keeps the behaviour: onAdd opens the
// slash menu on the + button, the handle's drag / click-for-menu is wired by
// the core on the element (app.js dragging()). Classes .g-add / .g-handle and
import { html, render } from '../design/ui/core.js';
import { IconButton } from '../design/ui/controls.js';
import { Icon } from '../design/ui/icons.ts';

export function BlockGutter({ onAdd, onFocus }) {
  // the focus icon: shown on a sectioning heading only (app.css), in the column left of the +; pin, or pin-off
  // (its second icon) while its section is the pane's focus (data-on, docview/focus.js)
  return html`${onFocus ? html`<${IconButton} class="g-focus" size="sm" quiet icon="focus" label="Focus this pane on the section" title="Focus this pane on the section" onClick=${onFocus}><${Icon.unfocus} class="g-unfocus" /><//>` : null}
    <${IconButton} class="g-add" size="sm" quiet icon="plus" label="Add a block below" onClick=${onAdd} />
    <${IconButton} class="g-handle" size="sm" quiet icon="handle" label="Move or edit block" title="Drag to move · click for options" />`;
}

/** Render the gutter into `el` (synchronous); returns its buttons and a destroy(). */
export function mountGutter(el, props) {
  render(html`<${BlockGutter} ...${props} />`, el);
  return { add: el.querySelector('.g-add'), focus: el.querySelector('.g-focus'), handle: el.querySelector('.g-handle'), destroy: () => render(null, el) };
}
