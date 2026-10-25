// The prompt for a document an older ReflowEd made (store/policy.ts: its core version is older). The
// document is never migrated or rewritten: it opens read-only behind this prompt, which offers
//   Export .tex / Export .zip   the files, as the ⋯ menu's exports
//   Start anew                  that .tex imported as a new document (io/start-anew.ts), which then opens;
//                               the older document stays as it is, for the older build
//   Close                       keep reading it here, read-only
// A newer core's document only gets the toast (app/read-only.js).
//   onReadOnlyOpen(doc, { store, io, prepare, toast, open })   app.js open(), for a read-only document
import { html } from '../design/ui/core.js';
import { Dialog, openLayer } from '../design/ui/overlays.js';
import { Button } from '../design/ui/controls.js';
import { OLDER_NOTE, readOnlyNote } from './read-only.js';
import { download, fileName } from '../io/download.ts';

let layer = null;
export function closeOlderCorePrompt() { layer?.close(); layer = null; }

export function onReadOnlyOpen(doc, host) {
  if (doc?.readOnly === 'older-core' && host.io?.startAnew) return openOlderCorePrompt(doc, host);
  host.toast?.(readOnlyNote(doc));
  return null;
}

export function openOlderCorePrompt(doc, { store, io, prepare = (d) => d, toast = () => {}, open }) {
  closeOlderCorePrompt();
  const back = document.activeElement;
  let busy = false;
  const run = (what) => async (e) => {
    if (busy) return;
    busy = true;
    const btns = e.currentTarget.closest('dialog')?.querySelectorAll('button') ?? [];
    for (const b of btns) b.disabled = true;
    try { await what(); }
    catch (err) { toast(`${err.message}`); }
    finally { busy = false; for (const b of btns) if (b.isConnected) b.disabled = false; }
  };
  const exportTex = run(async () => {
    const { name, text } = await io.exportOlder(store, doc.id, prepare);
    download(name, text, 'text/x-tex');
  });
  const exportZip = run(async () => {
    download(`${fileName(doc.title)}.zip`, await io.exportZip(prepare(await store.getDoc(doc.id)), (aid) => store.getAsset(doc.id, aid)));
  });
  const startAnew = run(async () => {
    const r = await io.startAnew(store, doc.id, prepare);
    closeOlderCorePrompt();
    open?.(r.docId);
    toast(`Started anew from the exported .tex${r.copied.length ? ` (${r.copied.length} image${r.copied.length > 1 ? 's' : ''} copied)` : ''}. The older document is kept as it was.`);
  });
  layer = openLayer((close) => {
    const done = () => { close(); layer = null; if (back?.isConnected) back.focus?.({ preventScroll: true }); };
    return html`<${Dialog} id="rtx-older-core" title="Made by an older ReflowEd" onClose=${done}
        footer=${html`
          <${Button} variant="ghost" data-act="close" onClick=${(e) => e.currentTarget.closest('dialog').close()}>Close<//>
          <${Button} data-act="export-tex" onClick=${exportTex}>Export .tex<//>
          ${io.exportZip ? html`<${Button} data-act="export-zip" onClick=${exportZip}>Export .zip<//>` : null}
          <${Button} variant="primary" data-act="start-anew" onClick=${startAnew}>Start anew<//>`}>
      <p>${OLDER_NOTE}</p>
      <p class="muted">Start anew makes a new document from the exported .tex. This one stays as it is, read-only here.</p>
    <//>`;
  });
  return layer;
}
