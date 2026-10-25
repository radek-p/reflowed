// A document made by an older ReflowEd (store/policy.ts: its core version is older) is never migrated:
// it is exported and started anew. The two steps the prompt (app/older-core.js) offers:
//
//   exportOlder(store, docId, prepare?) → { name, text, missing }   the marked one-file .tex (markers.ts), as Export .tex
//   startAnew(store, docId, prepare?)   → { docId, text, copied }   that .tex imported as a new document (new ids), the
//                                                                    images the .tex cannot carry copied over by name
// The older document stays as it is (the older build keeps working on it). `prepare` is the app's export view of
// the document (svgfig's forExport: the trash left out), the same as Export .tex uses.
import type { DocStore, OpenDoc } from '../store/types.ts';
import { exportSingle } from './export.ts';
import { fileName } from './download.ts';
import { importUpload, freshIds } from './import.ts';

type Prepare = (d: OpenDoc) => OpenDoc;

export async function exportOlder(store: DocStore, docId: string, prepare: Prepare = (d) => d): Promise<{ name: string; text: string; missing: string[] }> {
  const raw = await store.getDoc(docId);
  if (!raw) throw new Error(`no document ${docId}`);
  const d = prepare(raw);
  const { text, missing } = exportSingle(d, d.blocks, d.assets ?? []);
  return { name: `${fileName(d.title)}.tex`, text, missing };
}

export async function startAnew(store: DocStore, docId: string, prepare?: Prepare): Promise<{ docId: string; text: string; copied: string[] }> {
  const ex = await exportOlder(store, docId, prepare);
  const { init } = await importUpload(ex.name, new TextEncoder().encode(ex.text));
  const id = await store.createDoc(freshIds(init));
  const copied: string[] = [];
  for (const name of ex.missing) {
    const a = await store.getAssetByName(docId, name);
    if (!a?.bytes) continue;
    const { id: _i, hash: _h, size: _s, owner: _o, trashed: _t, bytes, ...meta } = a as any;   // owner: an old block id
    await store.putAsset(id, meta, bytes);
    copied.push(name);
  }
  return { docId: id, text: ex.text, copied };
}
