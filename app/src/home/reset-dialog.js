// "Reset local data…" (the Documents view's footer, in the release and on the dev server): the kit's Dialog
// says what goes (every document with its versions, settings and view preferences, cached results) and offers
// "Export all first" (io/export-all.ts: one zip of every document's Export .zip); Reset then forgets the origin's
// data (store/wipe.js, the code the dev server's /reset page runs too) and reloads, so the page opens as in a new
// profile: the sample papers only. Esc, the close button and Cancel close it; the focus goes back to the button.
//   dialog#rtx-reset-local [data-action=export-all | cancel | reset], .rtx-reset-status (role=status)
//
//   openResetDialog({ store, reload? })   // reload(): after the wipe (default location.reload())
import { signal } from '@preact/signals';
import { html, Button, Dialog, openLayer } from '../design/ui/index.js';
import { exportAllZip } from '../io/export-all.ts';
import { download } from '../io/download.ts';
import { announceReset, wipeOrigin } from '../store/wipe.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function ResetBody({ count, fromDisk }) {
  return html`
    <p class="rtx-reset-lead">Everything ReflowEd keeps in this browser goes:</p>
    <ul class="rtx-reset-list">
      <li>every document${count.value == null ? '' : ` (${plural(count.value, 'document')})`}, with its versions;</li>
      <li>settings and view preferences;</li>
      <li>cached typesetting results.</li>
    </ul>
    <p>The page then opens as on a first visit, with the sample papers only. This cannot be undone.
      “Export all first” saves every document as a .zip you can import again; versions are not in it.</p>
    ${fromDisk ? html`<p class="rtx-reset-note">ReflowEd files opened from disk usually share this data in a browser, so it goes for them too.</p>` : null}`;
}

let open = null;

export function openResetDialog({ store, reload = () => location.reload() }) {
  if (open) return open;
  const back = document.activeElement;
  const count = signal(null);
  const status = signal({ text: '', kind: '' });
  const busy = signal(false);
  store.listDocs().then((l) => { count.value = l.length; }, () => {});
  const say = (text, kind = '') => { status.value = { text, kind }; };

  const exportAll = async () => {
    busy.value = true;
    say('Exporting…', 'busy');
    try {
      const z = await exportAllZip(store);
      download(z.name, z.data, 'application/zip');
      say(`Saved ${z.name} (${plural(z.count, 'document')})${z.warnings.length ? `, ${plural(z.warnings.length, 'warning')}` : ''}.`, 'done');
    } catch (e) { say(`Export failed: ${e.message}`, 'error'); }
    busy.value = false;
  };
  const reset = async () => {
    busy.value = true;
    say('Resetting…', 'busy');
    try {
      store.close?.();                                 // our own connection first; other tabs close theirs on versionchange
      await wipeOrigin({ onBlocked: () => say('Waiting for other ReflowEd tabs to let go of the data: close them to finish.', 'busy') });
      announceReset();
      say('Done. Opening as on a first visit…', 'done');
      document.documentElement.dataset.resetDone = '1';
      reload();
    } catch (e) { busy.value = false; say(`Reset failed: ${e.message}`, 'error'); }
  };

  const layer = openLayer((close) => {
    const done = () => { close(); open = null; if (back?.isConnected) back.focus?.({ preventScroll: true }); };
    const shut = (e) => e.currentTarget.closest('dialog').close();
    const Foot = () => html`
      <span class="rtx-reset-status" role="status" aria-live="polite" data-kind=${status.value.kind || undefined}>${status.value.text}</span>
      <${Button} data-action="export-all" disabled=${busy.value} onClick=${exportAll}>Export all first<//>
      <${Button} variant="ghost" data-action="cancel" autofocus disabled=${busy.value} onClick=${shut}>Cancel<//>
      <${Button} variant="danger" data-action="reset" disabled=${busy.value} onClick=${reset}>Reset<//>`;
    return html`<${Dialog} id="rtx-reset-local" class="rtx-reset" title="Reset local data" onClose=${done}
        footer=${html`<${Foot} />`}>
      <${ResetBody} count=${count} fromDisk=${location.protocol === 'file:'} />
    <//>`;
  });
  open = {
    get el() { return document.getElementById('rtx-reset-local'); },
    close() { const d = document.getElementById('rtx-reset-local'); if (d?.open) d.close(); else { layer.close(); open = null; } },
  };
  return open;
}
