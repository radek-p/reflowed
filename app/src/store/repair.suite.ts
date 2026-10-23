// Damaged records (store/repair.ts): the checks for any CoreStore
// (memory and fake-indexeddb in Node; scripts/test-w2.ts prints them). The
// damage is written under the store, through its backend, as a crash, an
// older build or a hand-edited database could leave it.

import type { DocStore } from './types.ts';
import type { Check } from './store.suite.ts';
import { isValidKey, keyBetween } from './fracindex.ts';
import { ulid } from './ulid.ts';

export async function runRepairSuite(label: string, make: () => Promise<DocStore>): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean, info = '') => { out.push({ name: `${label}: ${name}`, ok, info }); };
  const store = await make();
  const raw = (store as any).b as { run: (s: string[], m: string, f: (tx: any) => Promise<any>) => Promise<any> };
  const put = (s: string, v: unknown, k?: unknown) => raw.run([s], 'readwrite', (tx) => tx.put(s, v, k));
  const get = (s: string, k: unknown) => raw.run([s], 'readonly', (tx) => tx.get(s, k));
  const warns: string[] = [];
  const warn0 = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
  try {
    const good = await store.createDoc({ title: 'Good document', blocks: [{ source: 'First.' }, { source: 'Second.' }] });
    const hurt = await store.createDoc({ title: 'Damaged document', preamble: '\\usepackage{amsmath}', blocks: [{ source: 'One.' }, { source: 'Two.' }, { source: 'Three.' }],
      assets: [{ name: 'fig.png', mime: 'image/png', bytes: new TextEncoder().encode('png bytes') }] });

    // 1. a document record with fields of the wrong type
    const d0 = await get('docs', hurt);
    await put('docs', { ...d0, title: 42, meta: null, files: 'main.tex', bib: { kind: 'weird' }, settings: [], openedAt: 'yesterday' });
    // 2. a record that cannot be a document (an id that is not a string)
    await put('docs', { id: 7, title: 'not a document' } as any);
    const list = await store.listDocs();
    const titles = list.map((d) => d.title);
    check('listDocs: a damaged document is listed (repaired), a record that is no document is left out, the others stay',
      titles.includes('Good document') && titles.includes('42') && list.length === 2, JSON.stringify(titles));
    const open = await store.getDoc(hurt);
    check('getDoc: the damaged document opens with sane fields (main file, bib none, settings, meta)',
      !!open && open.files.some((f) => f.role === 'main') && open.bib.kind === 'none' && open.settings.class === 'article' && Array.isArray(open.meta.authors) && open.preamble.source === '\\usepackage{amsmath}',
      JSON.stringify(open && { files: open.files, bib: open.bib, settings: open.settings, meta: open.meta }));
    const d1 = await get('docs', hurt);
    check('getDoc: the repaired document record is written back once', typeof d1.title === 'string' && Array.isArray(d1.files) && d1.openedAt === undefined, JSON.stringify(d1).slice(0, 200));
    check('a repair is said in the console (once)', warns.filter((w) => /repaired damaged records \(doc /.test(w)).length === 1, warns.join(' | ').slice(0, 300));

    // 3. blocks: text of the wrong type, attrs null, a pos that is not a key
    const [b0, b1, b2] = open!.blocks;
    await put('blocks', { ...b1, source: 12345, attrs: null, kind: '', pos: 99 });
    await put('blocks', { ...b2, pos: '' });
    const o2 = await store.getDoc(hurt);
    const ids = o2!.blocks.map((b) => b.id);
    check('getDoc: damaged blocks keep their text; a bad pos gets a key after the last good block (in the stored order)',
      o2!.blocks.length === 3 && ids[0] === b0.id && o2!.blocks.every((b) => typeof b.pos === 'string' && isValidKey(b.pos)) && o2!.blocks.find((b) => b.id === b1.id)?.source === '12345'
        && o2!.blocks.find((b) => b.id === b1.id)?.kind === 'paragraph', JSON.stringify(o2!.blocks.map((b) => [b.id.slice(-4), b.pos, b.kind, b.source])));
    const s1 = await get('blocks', b1.id);
    check('the repaired blocks are written back', typeof s1.pos === 'string' && isValidKey(s1.pos) && typeof s1.source === 'string' && s1.attrs && typeof s1.attrs === 'object', JSON.stringify(s1).slice(0, 200));
    // editing next to a repaired block works (keys between its neighbours)
    const nb = o2!.blocks;
    await store.putBlock(hurt, { id: ulid(), docId: hurt, pos: keyBetween(nb[1].pos, nb[2].pos), kind: 'paragraph', source: 'Inserted.', file: 'main.tex', attrs: {}, rev: 0, updatedAt: 0 });
    await store.putBlock(hurt, { id: b1.id, source: 'Edited after the repair.' });
    const o3 = await store.getDoc(hurt);
    check('editing after the repair: insert between repaired blocks, edit a repaired block', o3!.blocks.length === 4 && o3!.blocks[2].source === 'Inserted.' && o3!.blocks.find((b) => b.id === b1.id)?.source === 'Edited after the repair.',
      JSON.stringify(o3!.blocks.map((b) => b.source)));
    check('getBlocks: the same order', (await store.getBlocks(hurt)).map((b) => b.id).join() === o3!.blocks.map((b) => b.id).join());

    // 4. an asset whose bytes are an ArrayBuffer or unreadable
    const a0 = (await store.listAssets(hurt))[0];
    const row = await get('assets', [hurt, a0.id]);
    await put('assets', { ...row, bytes: new TextEncoder().encode('png bytes').buffer, mime: 5 });
    const a1 = await store.getAssetByName(hurt, 'fig.png');
    check('an asset stored as an ArrayBuffer (or with a bad mime) reads as bytes', a1?.bytes instanceof Uint8Array && a1.bytes.length === 9 && a1.mime === 'application/octet-stream', JSON.stringify({ mime: a1?.mime, n: a1?.bytes?.length }));
    await put('assets', { ...row, bytes: 'garbage' });
    const a2 = await store.getAssetByName(hurt, 'fig.png');
    check('an asset whose bytes are unreadable: its metadata, no bytes (the picture shows as missing, not a crash)', !!a2 && a2.bytes === undefined && (await store.listAssets(hurt)).length === 1);

    // 5. a damaged version
    const sid = await store.snapshots.put(good, 'Checkpoint');
    const snap = await get('snapshots', sid);
    await put('snapshots', { ...snap, gz: new Uint8Array([1, 2, 3, 4, 5]) });
    let err = '';
    try { await store.snapshots.get(sid); } catch (e) { err = (e as Error).message; }
    check('a damaged version: reading it says which one is damaged; the list still works', /version «Checkpoint» cannot be read/.test(err) && (await store.snapshots.list(good)).length === 1, err);

    // 6. putMeta on a damaged record
    await put('docs', { ...(await get('docs', good)), meta: 'x', files: null });
    await store.putMeta(good, { title: 'Renamed' });
    const g = await store.getDoc(good);
    check('putMeta on a damaged record: repaired and saved', g?.title === 'Renamed' && Array.isArray(g.files) && typeof g.meta === 'object');
  } catch (e) {
    check('(exception)', false, (e as Error).stack ?? String(e));
  } finally {
    console.warn = warn0;
    store.close();
  }
  return out;
}
