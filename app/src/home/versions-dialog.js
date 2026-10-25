// A document's Versions dialog, the one both the home (a row's ⋯ → Versions) and the editor (the document
// menu's Versions…, app/doc-files.ts) open: the kit's wide Dialog ("Versions of “title”", Close in the footer)
// around the versions panel (versions.js). Esc, the close button, Close and a press on the backdrop close it;
// focus goes back to what had it. dialog.versions-dialog, dialog._versions (the panel: idle()).
//   const d = openVersionsDialog({ store, docId, title, onRestore, back? });  d.close()
// title: the document's ('' or none: "Untitled"); back(): the element to focus on close (default: what had the
// focus when it opened); close() on a dialog already closed does nothing.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html, Button, Dialog, openLayer } from '../design/ui/index.js';
import { mountVersions } from './versions.js';

function Body({ o }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const panel = mountVersions(ref.current, o);
    const d = ref.current.closest('dialog');
    if (d) d._versions = panel;
    return () => panel.destroy();
  }, []);
  return html`<div ref=${ref} class="versions-body"></div>`;
}

/** @param {{ store: unknown, docId: string, title?: string, onRestore?: (docId: string, safety: unknown) => void, back?: () => Element | null }} o
 *  @returns {{ readonly el: HTMLDialogElement | null, close(): void }} */
export function openVersionsDialog(o) {
  const had = document.activeElement;
  const layer = openLayer((close) => html`<${Dialog} class="versions-dialog" wide title=${`Versions of “${o.title || 'Untitled'}”`}
      onClose=${() => { close(); const b = o.back?.() ?? had; if (b?.isConnected) b.focus?.({ preventScroll: true }); }}
      onClick=${(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
      footer=${html`<${Button} variant="ghost" data-action="close-versions" onClick=${(e) => e.currentTarget.closest('dialog').close()}>Close<//>`}>
    <${Body} o=${o} />
  <//>`);
  return {
    get el() { return layer.el.querySelector('dialog'); },
    close() { const d = layer.el.querySelector('dialog'); if (d?.open) d.close(); else layer.close(); },
  };
}
