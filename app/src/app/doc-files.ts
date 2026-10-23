// A document's files (the first part of createDocEditor moved out of app.js): the Versions
// dialog, "Reset to original" and the newer-example banner of a default document, "Import .tex…", and the exports
// (.tex, .zip, PDF). A new export format goes here and in commands/editor.js; app.js only wires the host.
//
//   const files = createDocFiles(host)
//     files.openVersions() · files.closeVersions()
//     files.resetSeed() · files.showSeedBanner(docId) · files.removeSeedBanner()
//     files.importTex()
//     files.exportTex() · files.exportZip({ plain? }) · files.exportPdf()
//     files.exportDoc() -> what an export writes (the stored document, SVG figures' trash left out) · files.assetOf(docId)
import { openVersionsDialog } from '../chrome/versions.js';

/** The open document, as the files need it. */
export interface FilesDoc { id: string; title?: string }
type Closeable = { close(): void };
type Destroyable = { destroy(): void };
/** The page's io module (io/api.ts), the parts the files use: absent in a container without it. */
export interface FilesIo {
  resetToSeed(store: unknown, docId: string): Promise<unknown>;
  mountSeedBanner?(host: HTMLElement | null, o: { store: unknown; docId: string; reopen(id: string): void; open(id: string): void }): Destroyable | null;
  openImportTex(o: { store: unknown; docId: string; reopen(id: string): void; open(id: string): void }): void;
  exportTex(doc: unknown): string;
  exportZip(doc: unknown, assetOf: (assetId: string) => Promise<unknown>, o: object): Promise<Blob>;
}
export interface PdfResult { pdf?: Blob | null; errors?: { message: string }[] }

/** What createDocEditor (app.js) gives the files: narrow on purpose (the document, the store, the page's io and actions). */
export interface DocFilesHost {
  doc(): FilesDoc | null;
  store: { getDoc(id: string): Promise<unknown>; getAsset(docId: string, assetId: string): Promise<unknown> };
  io(): FilesIo | undefined;
  /** every editor closed and every write done (an export reads the store) */
  leaveEditors(): void;
  settled(): Promise<void>;
  toast(text: string): void;
  setStatus(text: string, kind: string): void;
  /** svgfig: the stored document with the drawn figures' trash left out */
  forExport(doc: unknown): unknown;
  /** the backend's PDF of what Export PDF compiles, now (null: the backend has none) */
  pdf(): Promise<PdfResult> | null;
  mountVersions?(body: HTMLElement, o: { store: unknown; docId: string; title?: string; onRestore(): void }): void;
  reopen(docId: string): void;
  openDoc(docId: string): void;
  /** where the newer-example banner goes; null: this pane shows none */
  bannerHost(): HTMLElement | null;
}

export function createDocFiles(host: DocFilesHost) {
  let versions: Closeable | null = null;
  let banner: Destroyable | null = null;
  const doc = () => host.doc()!;
  const fileBase = () => (doc().title || 'document').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'document';
  function download(blob: Blob, name: string) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** what an export writes: the stored document, the SVG figures' trash left out (exports and the Files panel) */
  const exportDoc = async () => host.forExport(await host.store.getDoc(doc().id));
  const assetOf = (docId: string) => (assetId: string) => host.store.getAsset(docId, assetId);
  const reopen = (id: string) => host.reopen(id), open = (id: string) => host.openDoc(id);

  return {
    exportDoc, assetOf,
    /** versions panel in the kit's Dialog (chrome/versions.js); a restore reopens the document */
    async openVersions() {
      await host.settled();
      const { id: docId, title } = doc();
      const vd: Closeable = openVersionsDialog((body: HTMLElement) => host.mountVersions?.(body, { store: host.store, docId, title, onRestore: () => { vd.close(); reopen(docId); } }),
        { onClosed: () => { if (versions === vd) versions = null; } });
      versions = vd;
    },
    closeVersions() { versions?.close(); },
    /** "Reset to original" for a default document (io/seeds.ts): a version of the user's copy first, then reopened */
    async resetSeed() {
      host.leaveEditors();
      await host.settled();
      const id = doc().id;
      try { await host.io()!.resetToSeed(host.store, id); reopen(id); } catch (e) { host.toast(`Reset failed: ${(e as Error).message}`); }
    },
    /** the "newer version of this example" banner (io/seed-banner.ts), shown on open, removed on close */
    showSeedBanner(docId: string) {
      banner?.destroy();
      banner = null;
      const where = host.bannerHost();
      if (!where) return;
      banner = host.io()?.mountSeedBanner?.(where, { store: host.store, docId, reopen, open }) ?? null;
    },
    removeSeedBanner() { banner?.destroy(); banner = null; },
    /** "Import .tex…" (io/import-dialog.ts): replace this document (snapshot first, reopened) or open as a new one */
    async importTex() {
      host.leaveEditors();
      await host.settled();
      host.io()!.openImportTex({ store: host.store, docId: doc().id, reopen, open });
    },
    async exportTex() {
      host.leaveEditors();
      try {
        await host.settled();
        const text = host.io()!.exportTex(await exportDoc());
        download(new Blob([text], { type: 'text/x-tex' }), `${fileBase()}.tex`);
      } catch (e) { host.toast(`Export failed: ${(e as Error).message}`); }
    },
    async exportZip(o: object = {}) {
      host.leaveEditors();
      try {
        await host.settled();
        download(await host.io()!.exportZip(await exportDoc(), assetOf(doc().id), o), `${fileBase()}.zip`);
      } catch (e) { host.toast(`Export failed: ${(e as Error).message}`); }
    },
    async exportPdf() {
      host.leaveEditors();
      host.setStatus('Making the PDF…', 'busy');
      try {
        const p = host.pdf();
        if (!p) { host.setStatus('No PDF', 'error'); return; }
        const r = await p;
        if (!r.pdf) { host.setStatus(r.errors?.[0]?.message ?? 'No PDF', 'error'); return; }
        window.open(URL.createObjectURL(r.pdf), '_blank');
        host.setStatus('PDF ready', 'ok');
      } catch (e) { host.setStatus(`PDF: ${(e as Error).message}`, 'error'); }
    },
  };
}
