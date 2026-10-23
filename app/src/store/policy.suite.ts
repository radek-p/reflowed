// The store policy (store/policy.ts) and the core-version guards, for any CoreStore (memory and
// fake-indexeddb in Node).
//   - a newer core opens read-only and nothing of it is written;
//   - an older core opens read-only (the app's export-and-start-anew prompt), nothing of it is written, and its
//     marked .tex started anew re-exports byte for byte (block and document ids aside);
//   - on a version bump the disposable data is dropped (ops, snapshots, compile results, derived attrs, UI state)
//     and the core kept exactly; a newer stamp is left alone; no stamp is the baseline;
//   - an additive optional field opens with no bump;
//   - the seeds' "unedited" test survives a drop (no op log: not proof; derived attrs: not content);
//   - after a drop the op log starts again complete (snapshot + ops = stored; store/replay.ts).
import type { DocStore } from './types.ts';
import type { Check } from './store.suite.ts';
import { CORE_VERSION, DISPOSABLE_VERSION, SCHEMA, DERIVED_ATTRS, POLICY_KEY, NewerSchemaError, OlderCoreError, applyStorePolicy } from './policy.ts';
import { insertBlock } from './edit.ts';
import { replay, stateOf, diffStates } from './replay.ts';
import { exportSingle } from '../io/export.ts';
import { exportOlder, startAnew } from '../io/start-anew.ts';
import { contentHash, syncSeeds } from '../io/seeds.ts';

/** a localStorage stand-in */
function fakeStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() } as Storage;
}
const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
/** the second text with its ULIDs renamed, in order of first appearance, to the first text's */
function sameUpToIds(a: string, b: string): boolean {
  const ia = [...new Set(a.match(ULID) ?? [])], ib = [...new Set(b.match(ULID) ?? [])];
  if (ia.length !== ib.length) return false;
  const map = new Map(ib.map((x, i) => [x, ia[i]]));
  return b.replace(ULID, (x) => map.get(x)!) === a;
}

export async function runPolicySuite(label: string, make: () => Promise<DocStore>): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean, info = '') => { out.push({ name: `${label}: ${name}`, ok, info }); };
  const refusedBy = async (Err: Function, name: string, tries: [string, () => Promise<unknown>][]) => {
    const refused: string[] = [];
    for (const [n, f] of tries) { try { await f(); } catch (e) { if (e instanceof (Err as any) || (e as Error)?.name === name) refused.push(n); } }
    return refused;
  };
  const writes = (store: DocStore, id: string, open: any): [string, () => Promise<unknown>][] => [
    ['putMeta', () => store.putMeta(id, { title: 'x' })],
    ['putBlocks (edit)', () => store.putBlocks(id, [{ id: open.blocks[0].id, source: 'Edited.' }])],
    ['putBlocks (new)', () => store.putBlocks(id, [{ id: 'NEWBLOCK0000000000000000000', pos: 'a5', source: 'New.' }])],
    ['deleteBlock', () => store.deleteBlock(id, open.blocks[0].id)],
    ['putAsset', () => store.putAsset(id, { name: 'b.png', mime: 'image/png' }, new Uint8Array([4]))],
    ['deleteAsset', () => store.deleteAsset(id, open.assets[0].id)],
    ['appendOps', () => store.appendOps(id, [{ t: 'meta', payload: { title: 'x' } } as any])],
    ['snapshots.put', () => store.snapshots.put(id, 'x')],
  ];
  const warn0 = console.warn, info0 = console.info;
  console.warn = () => {}; console.info = () => {};
  try {
    const store = await make();
    const b = (store as any).backend as { run: (s: string[], m: string, f: (tx: any) => Promise<any>) => Promise<any> };
    const put = (s: string, v: unknown, k?: unknown) => b.run([s], 'readwrite', (tx) => tx.put(s, v, k));
    const get = (s: string, k: unknown) => b.run([s], 'readonly', (tx) => tx.get(s, k));
    const all = (s: string) => b.run([s], 'readonly', (tx) => tx.all(s));
    const keys = (s: string) => b.run([s], 'readonly', (tx) => tx.keys(s));
    const rawDoc = async (id: string) => JSON.stringify({ d: await get('docs', id), b: (await all('blocks')).filter((x: any) => x.docId === id), a: (await all('assets')).filter((x: any) => x.docId === id).length });

    // ── a newer core ──
    const id = await store.createDoc({ title: 'From the future', blocks: [{ source: 'One.' }, { source: 'Two.' }],
      assets: [{ name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] });
    const d0 = await get('docs', id);
    await put('docs', { ...d0, schema: SCHEMA + 1, title: 42, owners: { 'a.png': 'blk1' } });
    const before = JSON.stringify({ d: await get('docs', id), b: await all('blocks'), a: (await all('assets')).length, o: (await all('ops')).length, s: (await all('snapshots')).length });
    const open = await store.getDoc(id);
    check('a newer core opens, marked read-only, its schema and blocks as stored', !!open && open.readOnly === 'newer-schema' && open.schema === SCHEMA + 1 && open.blocks.length === 2, JSON.stringify({ ro: open?.readOnly, schema: open?.schema }));
    check('it is listed on the home page', (await store.listDocs()).some((m) => m.id === id));
    const tries = writes(store, id, open);
    const refused = await refusedBy(NewerSchemaError, 'NewerSchemaError', tries);
    check('every write to it throws NewerSchemaError', refused.length === tries.length, `refused: ${refused.join(', ')}`);
    const after = JSON.stringify({ d: await get('docs', id), b: await all('blocks'), a: (await all('assets')).length, o: (await all('ops')).length, s: (await all('snapshots')).length });
    check('nothing of it was rewritten: doc, blocks, assets, ops, snapshots as stored (the unknown field kept)', after === before && after.includes('"owners"'));
    const cur = await store.createDoc({ title: 'Now', blocks: [{ source: 'A.' }] });
    await put('docs', { ...(await get('docs', cur)), schema: undefined });
    await store.getDoc(cur);
    check('a document without a version is repaired to the current core and written back', (await get('docs', cur)).schema === CORE_VERSION);

    // ── an additive optional field: no bump ──
    const two = await store.createDoc({ title: 'Two', blocks: [{ source: 'A.' }], assets: [{ name: 'figures/f.svg', mime: 'image/svg+xml', bytes: new Uint8Array([60]) }] });
    const o2 = await store.getDoc(two);
    const fa = o2!.assets[0] as any;
    check('additive field (owner, trashed): a document without them opens writable at the current core; readers default them',
      o2?.schema === CORE_VERSION && !o2.readOnly && fa.owner === undefined && !fa.trashed, JSON.stringify({ schema: o2?.schema, ro: o2?.readOnly }));
    await store.putAsset(two, { id: fa.id, name: fa.name, owner: o2!.blocks[0].id, trashed: { at: 1, block: o2!.blocks[0].id } } as any, null);
    const fa2 = (await store.getDoc(two))!.assets[0] as any;
    check('additive field: kept through a write and a read, with no version change',
      fa2.owner === o2!.blocks[0].id && fa2.trashed?.at === 1 && (await get('docs', two)).schema === CORE_VERSION);
    await put('docs', { ...(await get('docs', two)), futureOptional: { x: 1 } });
    const o3 = await store.getDoc(two);
    check('additive field: an unknown optional doc field from a later build of the same core opens writable and is kept by a write',
      !o3?.readOnly && await store.putMeta(two, { title: 'Two again' }).then(() => true, () => false) && (await get('docs', two)).futureOptional?.x === 1);

    // ── an older core ──
    const oldId = await store.createDoc({ title: 'From the past', preamble: '\\documentclass{article}\n\\newtheorem{lemma}{Lemma}',
      blocks: [{ kind: 'heading', source: '\\section{Start}', attrs: { level: 'section', before: '\n' } }, { source: 'One paragraph, with a $x$.', attrs: { before: '\n\n' } },
        { kind: 'lemma', source: '\\begin{lemma}\\label{l}A lemma.\\end{lemma}', attrs: { env: 'lemma', before: '\n\n' } }],
      assets: [{ name: 'img/a.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 9]) }] });
    await put('docs', { ...(await get('docs', oldId)), schema: CORE_VERSION - 1 });
    const oldBefore = await rawDoc(oldId);
    const oopen = await store.getDoc(oldId);
    check('an older core opens read-only (older-core), its version as stored', oopen?.readOnly === 'older-core' && oopen.schema === CORE_VERSION - 1);
    const orefused = await refusedBy(OlderCoreError, 'OlderCoreError', writes(store, oldId, oopen));
    check('every write to it throws OlderCoreError (never silently rewritten)', orefused.length === tries.length, `refused: ${orefused.join(', ')}`);
    const ex = await exportOlder(store, oldId);
    const anew = await startAnew(store, oldId);
    const nd = await store.getDoc(anew.docId);
    const ex2 = exportSingle(nd!, nd!.blocks, nd!.assets);
    check('start anew: a new writable document at the current core, the image the .tex cannot carry copied',
      !!nd && !nd.readOnly && nd.schema === CORE_VERSION && anew.copied.join() === 'img/a.png' && nd.assets.length === 1 && nd.assets[0].hash === oopen!.assets[0].hash, JSON.stringify({ copied: anew.copied, ro: nd?.readOnly }));
    check('start anew: its export is the older document\'s .tex byte for byte (ids aside)', anew.text === ex.text && sameUpToIds(ex.text, ex2.text),
      ex2.text.split('\n').find((l, i) => l !== ex.text.split('\n')[i]) ?? '');
    check('the older document is left exactly as stored', (await rawDoc(oldId)) === oldBefore);

    // ── disposable data dropped on a bump, core kept ──
    const s2 = await make();
    const b2 = (s2 as any).backend;
    const run2 = (st: string[], m: string, f: (tx: any) => Promise<any>) => b2.run(st, m, f);
    const all2 = (st: string) => run2([st], 'readonly', (tx) => tx.all(st));
    const keys2 = (st: string) => run2([st], 'readonly', (tx) => tx.keys(st));
    const doc = await s2.createDoc({ title: 'Core', preamble: '\\documentclass{article}', bib: { kind: 'bbl', source: '\\begin{thebibliography}{1}\\bibitem{a} A.\\end{thebibliography}', entries: [{ key: 'a', type: 'bibitem' }] } as any,
      blocks: [{ kind: 'heading', source: '\\section{One}', attrs: { level: 'section', before: '\n' } },
        { kind: 'lemma', source: '\\begin{restatable}{lemma}{key}x\\end{restatable}', attrs: { env: 'restatable', theorem: 'lemma', restatable: 'key', before: '\n\n', joined: true } },
        { kind: 'lemma', source: '\\key*', attrs: { restates: 'key', before: '\n\n' } }],
      assets: [{ name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2]) }] });
    const kid = await insertBlock(s2, doc, { kind: 'paragraph', source: 'Inside.', attrs: { env: 'proof', before: '\n' } }, (await s2.getDoc(doc))!.blocks[0].id);
    await s2.putBlocks(doc, [{ id: kid.id, parentId: (await s2.getDoc(doc))!.blocks[0].id }]);
    const olderInS2 = await s2.createDoc({ title: 'Older', blocks: [{ source: 'Old.', attrs: { env: 'x' } }] });
    await run2(['docs'], 'readwrite', async (tx) => tx.put('docs', { ...(await tx.get('docs', olderInS2)), schema: CORE_VERSION - 1 }));
    await s2.appendOps(doc, [{ t: 'meta', payload: { title: 'Core' } } as any]);
    await s2.snapshots.put(doc, 'v1');
    await s2.cache.put('result:abc', { nodelist: 1 });
    await s2.cache.put('rtx:seeds', { x: { seedVersion: 'v', at: 1 } });
    const core = async (d: string) => {
      const o = await s2.getDoc(d);
      const keep = (a: any) => Object.fromEntries(Object.entries(a ?? {}).filter(([k]) => !(DERIVED_ATTRS as readonly string[]).includes(k)));
      return JSON.stringify({ id: o!.id, schema: o!.schema, title: o!.title, meta: o!.meta, preamble: o!.preamble.source, bib: { kind: o!.bib.kind, source: o!.bib.source, path: o!.bib.path }, settings: o!.settings, files: o!.files,
        blocks: o!.blocks.map((x) => [x.id, x.kind, x.source, x.parentId ?? null, x.pos, x.file, keep(x.attrs)]),
        assets: await Promise.all(o!.assets.map(async (a) => [a.name, a.mime, a.hash, Array.from((await s2.getAsset(d, a.id))!.bytes!)])) });
    };
    const coreBefore = await core(doc);
    const olderRaw = JSON.stringify({ d: (await all2('docs')).find((x: any) => x.id === olderInS2), b: (await all2('blocks')).filter((x: any) => x.docId === olderInS2) });
    const hashBefore = await contentHash((await s2.getDoc(doc))!);
    const storage = fakeStorage({ 'rtx-editor.view': '{"width":"medium"}', 'rtx-editor.sidebar': 'closed', 'rtx-editor.migrated-v1': 'X', 'other.key': '1' });
    const code = { core: CORE_VERSION, disposable: DISPOSABLE_VERSION };
    const counts = async () => JSON.stringify([(await all2('ops')).length, (await all2('snapshots')).length, (await keys2('cache')).length - 1, storage.length]);
    const c0 = JSON.stringify([2, 1, 2, 4]);
    const first = await applyStorePolicy(b2, { code, storage });
    check('no stamp: stamped as the baseline, nothing dropped', first.action === 'stamped' && (await counts()) === c0, await counts());
    check('the same versions again: nothing to do', (await applyStorePolicy(b2, { code, storage })).action === 'none');
    const bumped = { core: CORE_VERSION, disposable: DISPOSABLE_VERSION + 1 };
    const r = await applyStorePolicy(b2, { code: bumped, storage, now: () => 1234 });
    const blocksAfter = (await s2.getDoc(doc))!.blocks;
    check('a disposable bump: the op log, snapshots and compile results dropped; the app\'s rtx: records kept',
      r.action === 'dropped' && !(await all2('ops')).length && !(await all2('snapshots')).length && (await keys2('cache')).map(String).sort().join() === `${POLICY_KEY},rtx:seeds`, JSON.stringify(r.dropped));
    check('… the derived attrs and bib.entries dropped, blockCount recounted',
      blocksAfter.every((x) => !DERIVED_ATTRS.some((k) => k in (x.attrs ?? {}))) && !('entries' in (await s2.getDoc(doc))!.bib) && (await s2.getDoc(doc))!.blockCount === 4);
    check('… the core exactly as before (meta, preamble, bib, blocks: id, kind, source, parent, order, file, core attrs; asset bytes)', (await core(doc)) === coreBefore);
    check('… a document of an older core not rewritten (its derived attrs too)', JSON.stringify({ d: (await all2('docs')).find((x: any) => x.id === olderInS2), b: (await all2('blocks')).filter((x: any) => x.docId === olderInS2) }) === olderRaw);
    check('… UI state dropped (rtx-editor.*), the v1 migration marker and other keys kept',
      storage.getItem('rtx-editor.view') === null && storage.getItem('rtx-editor.sidebar') === null && storage.getItem('rtx-editor.migrated-v1') === 'X' && storage.getItem('other.key') === '1');
    const stamp = await run2(['cache'], 'readonly', (tx) => tx.get('cache', POLICY_KEY));
    check('… the stamp moved on, with when it dropped', stamp.disposable === bumped.disposable && stamp.droppedAt === 1234);
    check('the seeds\' content hash ignores derived attrs (a drop does not make a default document look edited)', (await contentHash((await s2.getDoc(doc))!)) === hashBefore);
    check('an older build with the newer stamp: leaves everything', (await applyStorePolicy(b2, { code, storage })).action === 'newer' && (await core(doc)) === coreBefore);
    await s2.snapshots.put(doc, 'kept');
    const rc = await applyStorePolicy(b2, { code: { core: CORE_VERSION + 1, disposable: DISPOSABLE_VERSION + 1 } });
    check('a core bump drops the disposable data too (and leaves documents of the old core as stored)',
      rc.action === 'dropped' && !(await all2('snapshots')).length && JSON.stringify((await all2('docs')).find((x: any) => x.id === doc).schema) === String(CORE_VERSION));

    // ── after a drop the op log starts again complete (store/replay.ts; scripts/test-replay.ts checks the app's edits) ──
    const s3 = await make();
    const rd = await s3.createDoc({ title: 'R', blocks: [{ source: 'A.' }, { source: 'B.' }] });
    await s3.appendOps(rd, [{ t: 'meta', payload: { title: 'R' } } as any]);
    await applyStorePolicy((s3 as any).backend, { code: { core: CORE_VERSION, disposable: DISPOSABLE_VERSION } });
    await applyStorePolicy((s3 as any).backend, { code: { core: CORE_VERSION, disposable: DISPOSABLE_VERSION + 1 }, storage: null });
    const snap = await s3.snapshots.put(rd, 'base');
    await new Promise((res) => setTimeout(res, 2));
    const ins = await insertBlock(s3, rd, { source: 'Inserted.' }, (await s3.getDoc(rd))!.blocks[0].id);
    await s3.putBlocks(rd, [{ id: ins.id, source: 'Inserted, edited.' }]);
    await s3.appendOps(rd, [{ t: 'edit', blockId: ins.id, payload: { from: 'Inserted.', to: 'Inserted, edited.' } } as any]);
    const diff = diffStates(replay((await s3.snapshots.get(snap))!, await s3.getOps(rd, snap)), stateOf((await s3.getDoc(rd))!));
    check('after a drop: a new snapshot + the ops since = the stored document', !diff.length && (await s3.getOps(rd)).length === 2, diff.join('; '));

    // ── seeds: a copy from before versioning (no content hash) is not "unedited" once the op log was dropped ──
    const SID = '01POLICYSEED00000000000000';
    const seed = (para: string) => ({ format: 'rtx-seed', version: 1, id: SID, init: { title: 'S', preamble: '\\documentclass{article}\n', meta: { tags: [] },
      blocks: [{ id: `${SID.slice(0, 20)}B00001`, kind: 'paragraph', source: para, file: 'main.tex', attrs: {} }] } }) as any;
    const s4 = await make();
    await syncSeeds(s4, [seed('Seed text.')]);
    const sd = await s4.getDoc(SID);
    await s4.putMeta(SID, { meta: { ...sd!.meta, seed: { ...(sd!.meta as any).seed, contentHash: undefined } } as any });
    await s4.putBlocks(SID, [{ id: sd!.blocks[0].id, source: 'My words.' }]);   // an edit whose op went with a drop
    await applyStorePolicy((s4 as any).backend, { code: { core: CORE_VERSION, disposable: DISPOSABLE_VERSION } });
    await applyStorePolicy((s4 as any).backend, { code: { core: CORE_VERSION, disposable: DISPOSABLE_VERSION + 1 }, storage: null });
    const sr = await syncSeeds(s4, [seed('Seed text, new build.')]);
    check('seeds: a copy without a content hash after a drop is kept, not replaced (no op log is no proof)', sr[0].action !== 'updated' && (await s4.getDoc(SID))!.blocks[0].source === 'My words.', sr[0].action);
  } finally { console.warn = warn0; console.info = info0; }
  return out;
}
