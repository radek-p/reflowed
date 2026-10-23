// The home's Versions dialog: the kit's wide Dialog ("Versions of “title”", Close in the footer) around
// the versions panel. Esc, the close button, Close and a press on the backdrop close it; focus goes back
// to what had it. dialog.versions-dialog.home-versions, dialog._versions (the panel: idle()).
//   const d = openVersionsDialog({ store, docId, title, onRestore, back? });  d.close()
// back(): the element to focus on close (default: what had the focus when it opened)
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

export function openVersionsDialog(o) {
  const had = document.activeElement;
  const layer = openLayer((close) => html`<${Dialog} class="versions-dialog home-versions" wide title=${`Versions of “${o.title}”`}
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
