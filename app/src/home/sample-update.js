// "Updated sample available": a sample paper whose stored copy is older than this build's version
// (io/seeds.ts sampleUpdate: the seed version recorded at seeding differs, or none was recorded) is marked in the
// Documents view; its badge (and the row's ⋯ menu) opens this kit Dialog. Edits are never overwritten:
//   - an unedited copy: Replace (the copy goes to its Versions first, then this build's version, same document);
//   - an edited copy: Open the new version (a new document, the sample from now on; the copy stays as it is,
//     renamed "… (edited)"), or Keep mine (not asked again for this version).
//   dialog#rtx-sample-update [data-action=sample-replace | sample-new | sample-keep | cancel]
//
//   openSampleUpdate({ store, update, onDone(result) })   // result: { action: 'replace' | 'new' | 'keep', docId }
import { signal } from '@preact/signals';
import { html, Button, Dialog, openLayer } from '../design/ui/index.js';
import { keepMine, openNewVersion, resetToSeed } from '../io/seeds.ts';

export const BADGE = 'Updated sample available';
const day = (iso) => (iso ? ` (build ${iso.slice(0, 10)})` : '');

let open = null;

export function openSampleUpdate({ store, update: u, title, onDone, back }) {
  open?.close();
  const had = document.activeElement;
  const busy = signal(false);
  const status = signal({ text: '', kind: '' });
  const name = title || u.title || 'Untitled';
  const act = (action, fn) => async (e) => {
    const d = e.currentTarget.closest('dialog');
    busy.value = true;
    status.value = { text: action === 'replace' ? 'Replacing…' : action === 'new' ? 'Adding the new version…' : '', kind: 'busy' };
    try {
      const docId = await fn();
      result = { action, docId };
      d.close();
    } catch (err) { busy.value = false; status.value = { text: `Could not finish: ${err.message}`, kind: 'error' }; }
  };
  let result = null;
  const layer = openLayer((close) => {
    const done = () => {
      close(); open = null;
      if (!result) { const b = back?.() ?? had; if (b?.isConnected) b.focus?.({ preventScroll: true }); }
      onDone?.(result);
    };
    const shut = (e) => e.currentTarget.closest('dialog').close();
    const Foot = () => html`
      <span class="rtx-sample-status" role="status" aria-live="polite" data-kind=${status.value.kind || undefined}>${status.value.text}</span>
      ${u.edited ? html`<${Button} variant="ghost" data-action="sample-keep" title="Do not ask again for this version" disabled=${busy.value}
        onClick=${act('keep', async () => { await keepMine(store, u.docId); return u.docId; })}>Keep mine<//>` : null}
      <${Button} variant="ghost" data-action="cancel" disabled=${busy.value} onClick=${shut}>Cancel<//>
      ${u.edited
        ? html`<${Button} variant="primary" data-action="sample-new" autofocus disabled=${busy.value} onClick=${act('new', () => openNewVersion(store, u.docId))}>Open the new version<//>`
        : html`<${Button} variant="primary" data-action="sample-replace" autofocus disabled=${busy.value} onClick=${act('replace', async () => { await resetToSeed(store, u.docId); return u.docId; })}>Replace<//>`}`;
    return html`<${Dialog} id="rtx-sample-update" class="rtx-sample-update" title=${BADGE} onClose=${done} footer=${html`<${Foot} />`}>
      <p>This build has a newer version of “${u.title || name}”${day(u.builtAt)}.</p>
      ${u.edited
        ? html`<p>Your copy has edits, so it is kept as it is: it stays in your documents as “${name.endsWith(' (edited)') ? name : `${name} (edited)`}”, and the new version opens as a new document.</p>`
        : html`<p>Your copy has no edits. Replace puts the new version in its place; the copy is kept in its Versions.</p>`}
    <//>`;
  });
  open = { close() { const d = document.getElementById('rtx-sample-update'); if (d?.open) d.close(); else { layer.close(); open = null; } } };
  return open;
}
