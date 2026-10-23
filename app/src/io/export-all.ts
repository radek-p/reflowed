// "Export all first" (the Reset local data dialog): every document of the store as one download, a zip of
// each document's own Export .zip (export.ts), so each one imports back as it is (Import… takes the inner zips).
// Versions are not in it. Names: the documents' slugs, made unique with -2, -3, …
//
//   const z = await exportAllZip(store)      // { name, data, count, warnings }; download(z.name, z.data, 'application/zip')
import type { DocStore } from '../store/types.ts';
import { writeZip, type Entry } from './archive.ts';
import { exportZipFromStore, slug } from './export.ts';

export async function exportAllZip(store: DocStore, now = new Date()): Promise<{ name: string; data: Uint8Array; count: number; warnings: string[] }> {
  const docs = await store.listDocs();
  const entries: Entry[] = [];
  const warnings: string[] = [];
  const taken = new Set<string>();
  for (const d of docs) {
    const z = await exportZipFromStore(store, d.id);
    const base = slug(d.title);
    let name = `${base}.zip`;
    for (let k = 2; taken.has(name); k++) name = `${base}-${k}.zip`;
    taken.add(name);
    entries.push({ path: name, data: z.data });
    for (const w of z.warnings) warnings.push(`${name}: ${w}`);
  }
  const day = now.toISOString().slice(0, 10);
  return { name: `ReflowEd-documents-${day}.zip`, data: await writeZip(entries), count: docs.length, warnings };
}
