// "Import .tex…" in the editor (the main menu's Document submenu calls io.openImportTex): pick a
// file, see what it holds (the editor's block markers or not), then
// "Replace this document" (after an automatic snapshot, doc id kept) or
// "Open as new document". The home screen's import is separate (home/screen.js).
// The kit's Dialog (dialog.rtx-import-tex; [data-action=import-cancel|import-new|import-replace]):
// Esc, the close button, Cancel and a press on the backdrop cancel.

import type { DocStore } from '../store/types.ts';
import { createFromImport, importIntoDocument, importUpload, type ImportReport } from './import.ts';
import { html, ensureStyles, openLayer, showToast, Button, Dialog } from '../design/ui/index.js';
import { injectHomeStyle } from '../home/css.ts';

export interface ImportTexOptions {
  store: DocStore;
  /** the open document */
  docId: string;
  /** after "Replace": reload this document */
  reopen?(docId: string): void;
  /** after "Open as new": go to the new document */
  open?(docId: string): void;
  /** tests: a file instead of the picker */
  file?: File | { name: string; bytes: Uint8Array };
}

export interface ImportTexHandle {
  /** resolves with what happened once the dialog is closed */
  done: Promise<{ action: 'replace' | 'new' | 'cancel'; docId?: string; report?: ImportReport; error?: string }>;
  input: HTMLInputElement;
}

type Result = Awaited<ImportTexHandle['done']>;

const describe = (r: ImportReport) => r.marked
  ? `Block markers found: ${r.blocks} blocks (${r.marked.kept} unchanged, ${r.marked.edited} edited, ${r.marked.added} new).`
  : `No block markers: the ${r.blocks} blocks are cut from the text by the usual rules.`;

export function openImportTex(o: ImportTexOptions): ImportTexHandle {
  ensureStyles();
  injectHomeStyle();
  let finish!: (v: Result) => void;
  const done = new Promise<Result>((r) => { finish = r; });
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.tex,.ltx,.zip,.tar,.gz,.tgz,text/x-tex';
  input.hidden = true;
  input.dataset.action = 'import-tex-file';
  document.body.append(input);

  const show = async (name: string, bytes: Uint8Array) => {
    let parsed: Awaited<ReturnType<typeof importUpload>>;
    try { parsed = await importUpload(name, bytes); } catch (e: any) { finish({ action: 'cancel', error: e.message }); input.remove(); alertBox(`Could not read ${name}: ${e.message}`); return; }
    const back = document.activeElement as HTMLElement | null;
    let result: Result = { action: 'cancel' };
    let busy = false;
    const layer = openLayer((close) => {
      // the dialog's close event (Esc, the close button, Cancel, the backdrop, or after an action) ends it
      const closed = () => { close(); input.remove(); if (back?.isConnected) back.focus?.({ preventScroll: true }); finish(result); };
      const end = (e: Event, r: Result) => { result = r; (e.currentTarget as HTMLElement).closest('dialog')?.close(); };
      const act = async (e: Event, action: 'replace' | 'new') => {
        if (busy) return;
        busy = true; layer.update();
        const dlg = (e.currentTarget as HTMLElement).closest('dialog');
        try {
          if (action === 'replace') {
            const r = await importIntoDocument(o.store, o.docId, name, parsed);
            result = { action: 'replace', docId: o.docId, report: r.report };
            dlg?.close();
            o.reopen?.(o.docId);
          } else {
            const id = await createFromImport(o.store, parsed.init);
            result = { action: 'new', docId: id, report: parsed.report };
            dlg?.close();
            o.open?.(id);
          }
        } catch (err: any) { result = { action, error: err.message }; dlg?.close(); alertBox(`Import failed: ${err.message}`); }
      };
      return html`<${Dialog} class="rtx-import-tex" title=${`Import ${name}`} onClose=${closed}
          onClick=${(e: MouseEvent) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close(); }}
          footer=${[
            html`<${Button} variant="ghost" data-action="import-cancel" disabled=${busy} onClick=${(e: Event) => end(e, { action: 'cancel' })}>Cancel<//>`,
            html`<${Button} data-action="import-new" disabled=${busy} onClick=${(e: Event) => act(e, 'new')}>Open as new document<//>`,
            html`<${Button} variant="primary" data-action="import-replace" autofocus disabled=${busy} onClick=${(e: Event) => act(e, 'replace')}>Replace this document<//>`,
          ]}>
        <p class="rtx-import-what">${describe(parsed.report)}</p>
        <p class="rtx-import-note">${parsed.report.warnings.length ? `${parsed.report.warnings.length} warning(s): ${parsed.report.warnings[0]}` : '“Replace” saves a version of this document first.'}</p>
      <//>`;
    });
    // showModal focuses the autofocus button (Replace), as the plain dialog did
    layer.el.querySelector<HTMLElement>('[data-action="import-replace"]')?.focus();
  };

  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) { input.remove(); finish({ action: 'cancel' }); return; }
    await show(f.name, new Uint8Array(await f.arrayBuffer()));
  };
  if (o.file) {
    const f = o.file;
    (async () => show(f.name, typeof Blob !== 'undefined' && f instanceof Blob ? new Uint8Array(await f.arrayBuffer()) : (f as { bytes: Uint8Array }).bytes))();
  } else input.click();
  return { done, input };
}

function alertBox(text: string) {
  showToast(text, { duration: 6000, class: 'rtx-import-alert' });
}
