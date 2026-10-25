// Import / export behind contracts.d.ts `IO`, plus the functions
// the home screen, the seed build and the tests use directly.

import type { Asset, DocInit, OpenDoc } from '../store/types.ts';
import { freshIds, importUpload } from './import.ts';
import { exportSingle, zipOpenDoc, type ExportOptions } from './export.ts';
import { projectFiles } from './files.ts';
import { openImportTex } from './import-dialog.ts';
import { syncSeeds, resetToSeed, isSeedDoc, sampleUpdate, openNewVersion, keepMine } from './seeds.ts';
import { mountSeedBanner } from './seed-banner.ts';
import { exportOlder, startAnew } from './start-anew.ts';

export { importFiles, importUpload, importIntoStore, importIntoDocument, createFromImport, freshIds, decodeText, isIpePdf, mimeOf, type ImportReport } from './import.ts';
export { setMetaPackage } from '../meta/package.ts';
export { projectFiles, listFiles, usesOf, refsIn, type ProjectFile } from './files.ts';
export { exportFiles, exportSingle, zipOpenDoc, loadAssets, isFigure, type FileKind, type ProjectEntry, exportZipFromStore, exportTexFromStore } from './export.ts';
export { download, fileName } from './download.ts';
export { unpack, readTar, writeTar, readZip, writeZip, crc32, isZip, isTar, isPdf, type Entry } from './archive.ts';
export { gzip, gunzip } from './gzip.ts';
export { splitBody, detectKind, envsFromPreamble } from './split.ts';
export { titleOf, authorsOf, abstractOf, bblEntries, bibEntries, docClass } from './meta.ts';
export { texToPlain, searchKey } from './latex-text.ts';
export { loadSeed, type SeedFile } from './seed.ts';
export { syncSeeds, seedUpdate, resolveSeedUpdate, resetToSeed, isSeedDoc, contentHash, seedHashOf, sampleUpdate, openNewVersion, keepMine, type SyncResult, type SampleUpdate } from './seeds.ts';
export { mountSeedBanner } from './seed-banner.ts';
export { TEMPLATES, templateInit } from './templates.ts';
export { openImportTex, type ImportTexOptions } from './import-dialog.ts';
export { exportOlder, startAnew } from './start-anew.ts';
export { writeMarked, parseMarked, isMarked, fingerprint } from './markers.ts';

async function bytesOf(file: File | { name: string; bytes: Uint8Array }): Promise<Uint8Array> {
  // a File (a Blob) is read; the other shape carries its bytes (File has a bytes() method too, so test for Blob)
  if (typeof Blob !== 'undefined' && file instanceof Blob) return new Uint8Array(await file.arrayBuffer());
  return (file as { bytes: Uint8Array }).bytes;
}

export const io = {
  /** A .tar.gz / .tgz / arXiv e-print / .zip / .tar / .tex → a DocInit (follows \input, collects assets and bbl). */
  async importFile(file: File | { name: string; bytes: Uint8Array }): Promise<DocInit> {
    // a new document: never the ids of the document the file came from
    return freshIds((await importUpload(file.name, await bytesOf(file))).init);
  },
  async exportZip(doc: OpenDoc, getAsset: (id: string) => Promise<Asset | null>, o: ExportOptions = {}): Promise<Blob> {
    const { data } = await zipOpenDoc(doc, getAsset, o);
    return new Blob([data as BlobPart], { type: 'application/zip' });
  },
  /** the Files panel: the files exportZip writes (one list, files.ts), each with its kind, size and uses */
  files: projectFiles,
  /** Editor's ⋯ → "Import .tex…": pick a file, replace this document or open it as a new one (import-dialog.ts). */
  openImportTex,
  /** seed versioning (seeds.ts): on start, the banner in a default document, "Reset to original" */
  syncSeeds, mountSeedBanner, resetToSeed, isSeedDoc,
  /** the Documents view's "Updated sample available": what it offers, Open the new version, Keep mine */
  sampleUpdate, openNewVersion, keepMine,
  /** a document an older ReflowEd made: its .tex, and that .tex as a new document (start-anew.ts) */
  exportOlder, startAnew,
  /** One .tex with block markers (markers.ts; bib and edited figures in filecontents*); images are not in it. */
  exportTex(doc: OpenDoc): string {
    return exportSingle(doc, doc.blocks, doc.assets ?? []).text;
  },
};
