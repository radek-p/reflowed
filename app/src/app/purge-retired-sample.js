// Removes the retired made-up sample document from a store, on every start.
//
// Earlier versions seeded a made-up paper as the example on a first run; it
// is gone from the app. People who opened such a version still have that document in IndexedDB: this deletes it (the
// document, its blocks, assets, op log and snapshots: store.deleteDoc) and,
// when it found one, clears the result cache (its entries are content hashes
// that cannot be told apart from other documents'; they only cost a
// recompile). Copies ("… (copy)", "Copy of …") and soft-deleted ones go too.
// The v1 localStorage document (store/api.ts migrateV1) is removed as well if it is that sample.
//
// The retired sample is recognised by fingerprints (FNV-1a of the lowercased
// title or author name), so its text does not appear in the app again.
const RETIRED_TITLES = new Set(['90d57022', '494b3fc1']);
const RETIRED_AUTHORS = new Set(['9814377e', '10d04198']);

/** FNV-1a, 32 bits, hex: a fingerprint of a short string. */
export function fingerprint(s) {
  let h = 0x811c9dc5;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const baseTitle = (t) => {
  let s = norm(t);
  for (let i = 0; i < 5; i++) s = s.replace(/^copy of\s+/, '').replace(/\s*\(copy(?: \d+)?\)$/, '');
  return s;
};
/** Author names from a preamble's \author{A \and B} (plain names only). */
function preambleAuthors(src) {
  const m = /\\author\s*\{([^{}]*)\}/.exec(src ?? '');
  return m ? m[1].split(/\\and\b/).map((a) => a.trim()).filter(Boolean) : [];
}

/** Is this document (a DocMeta and, if at hand, its record) the retired sample? */
export function isRetiredSample(meta, record = null) {
  const titles = [meta?.title, record?.title];
  const authors = [...(meta?.authors ?? []), ...(meta?.meta?.authors ?? []), ...(record?.meta?.authors ?? []), ...preambleAuthors(record?.preamble?.source)];
  return titles.some((t) => t && RETIRED_TITLES.has(fingerprint(baseTitle(t))))
    || authors.some((a) => RETIRED_AUTHORS.has(fingerprint(norm(a))));
}

/** Delete every copy of the retired sample; returns the ids deleted. */
export async function purgeRetiredSample(store, storage = globalThis.localStorage) {
  const gone = [];
  try {
    const list = await store.listDocs({ includeDeleted: true });
    for (const d of list) {
      const rec = store.getDocRecord ? await store.getDocRecord(d.id).catch(() => null) : null;
      if (!isRetiredSample(d, rec)) continue;
      await store.deleteDoc(d.id);
      gone.push(d.id);
    }
    if (gone.length) await store.cache?.clear?.().catch?.(() => {});
  } catch (e) { console.warn('purge of the retired sample:', e.message); }
  try {
    const v1 = storage?.getItem('rtx-blocks.doc');
    if (v1) {
      const d = JSON.parse(v1);
      if (isRetiredSample({ title: d?.title }, { preamble: { source: d?.preamble ?? '' } })) { storage.removeItem('rtx-blocks.doc'); gone.push('v1-localStorage'); }
    }
  } catch { /* no storage, or not JSON: nothing to do */ }
  if (gone.length) console.info(`removed the retired sample document (${gone.length})`);
  return gone;
}
