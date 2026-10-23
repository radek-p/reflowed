// The top bar's View button ("Aa"): the kit's 28 px icon button, rendered into the top bar's slot for it
// (chrome/top-bar.js) of an editor's container (app/editor-root.ts), else at the bar's end. id #btn-view (the
// container's: root.id) and .rtx-view-btn kept (tests, CSS).
//   mountViewButton(root, { title, onClick }) -> { el: the <button>, destroy() }
import { html, render, IconButton } from '../design/ui/index.js';

export function mountViewButton(root, { title, onClick }) {
  const host = root.doc.createElement('span');
  host.style.display = 'contents';
  const bar = root.part('topbar');
  const slot = bar?.querySelector('[data-slot="view"]');
  if (slot) slot.append(host); else bar?.append(host);
  render(html`<${IconButton} icon="textSize" label="View options" title=${title} class="rtx-view-btn" id=${root.id('btn-view')} aria-haspopup="dialog" aria-expanded="false"
    onClick=${(e) => { e.stopPropagation(); onClick(e.currentTarget); }} />`, host);
  return { el: host.firstElementChild, destroy() { render(null, host); host.remove(); } };
}
