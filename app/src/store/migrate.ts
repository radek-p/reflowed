// One-time migration of the document of the first version of the editor (v1) from localStorage:
//   localStorage['rtx-blocks.doc'] = { version: 1, title, preamble, blocks: [{ id, type, source }] }
// becomes a schema-2 document (new ULIDs; the v1 id kept in attrs.v1Id), with
// an auto snapshot "Migrated from v1". The v1 key is left in place (the first version
// still reads it); a marker key makes the migration run once per browser
// profile, and a document with meta.migratedFrom is never made twice.

import type { DocStore } from './types.ts';

export const V1_KEY = 'rtx-blocks.doc';
export const MIGRATED_KEY = 'rtx-editor.migrated-v1';

interface V1Doc { version: 1; title?: string; preamble: string; blocks: Array<{ id: string; type?: string; source: string }> }

function readV1(storage: Storage): V1Doc | null {
  try {
    const raw = storage.getItem(V1_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && d.version === 1 && typeof d.preamble === 'string' && Array.isArray(d.blocks)
      && d.blocks.every((b: any) => b && typeof b.id === 'string' && typeof b.source === 'string')) return d;
  } catch { /* unreadable */ }
  return null;
}

/** v1 block types were the first version's slash-menu types; the kinds are the same names. */
const kindOf = (t?: string) => t || 'paragraph';

/** Migrate if there is a v1 document not yet migrated. Resolves to the new doc id, or null. */
export async function migrateV1(store: DocStore, storage: Storage | undefined = (globalThis as any).localStorage): Promise<string | null> {
  if (!storage) return null;
  let done: string | null = null;
  try { done = storage.getItem(MIGRATED_KEY); } catch { return null; }
  if (done) return null;
  const v1 = readV1(storage);
  if (!v1) return null;
  const already = (await store.listDocs({ includeDeleted: true }));
  for (const m of already) {
    const d = await store.getDocRecord(m.id);
    if (d?.meta.migratedFrom === 'v1-localStorage') { try { storage.setItem(MIGRATED_KEY, d.id); } catch { /* */ } return null; }
  }
  const id = await store.createDoc({
    title: v1.title ?? '',
    meta: { authors: [], tags: [], migratedFrom: 'v1-localStorage' },
    // v1 kept no \documentclass (the first version added article): settings.class says so
    preamble: v1.preamble,
    settings: { class: 'article' },
    files: [{ path: 'main.tex', role: 'main' }],
    blocks: v1.blocks.map((b) => ({ kind: kindOf(b.type), source: b.source, file: 'main.tex', attrs: { v1Id: b.id } })),
    snapshotLabel: 'Migrated from v1',
  });
  try { storage.setItem(MIGRATED_KEY, id); } catch { /* blocked storage: the meta check prevents a second copy */ }
  return id;
}
