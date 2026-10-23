// The DocStore test suite: the same checks for every implementation (memory
// and fake-indexeddb in Node, real IndexedDB in Chromium). No test framework:
// each check is a named boolean; tests/test-select.ts prints them.

import type { DocStore } from './types.ts';
import { keyBetween } from './fracindex.ts';
import { ulid } from './ulid.ts';
import { sha256Hex, KEEP_AUTO } from './core.ts';
import { restoreSnapshot } from './snapshots.ts';
import { SCHEMA } from './policy.ts';

export interface Check { name: string; ok: boolean; info?: string }

export async function runStoreSuite(label: string, make: () => Promise<DocStore>, reopen?: () => Promise<DocStore>): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean, info = '') => { out.push({ name: `${label}: ${name}`, ok, info }); };
  const store = await make();
  const events: string[] = [];
  const unsub = store.subscribe((e) => events.push(`${e.type}:${e.docId}`));
  const enc = (s: string) => new TextEncoder().encode(s);
  try {
    // 1. create / get
    const png = enc('\x89PNG fake image bytes');
    const id = await store.createDoc({
      title: 'Store suite', preamble: '\\usepackage{amsmath}', meta: { authors: ['A. Author'], tags: ['t'] },
      blocks: [{ kind: 'heading', source: '\\section{One}' }, { source: 'First paragraph about Gda\\\'{n}sk.' }, { kind: 'lemma', source: '\\begin{lemma}x\\end{lemma}', file: 'src/a.tex' }],
      assets: [{ name: 'figures/a.png', mime: 'image/png', bytes: png }],
    });
    let d = await store.getDoc(id);
    check('createDoc/getDoc: blocks in order, kinds, files', !!d && d.blocks.length === 3 && d.blocks.map((b) => b.kind).join() === 'heading,paragraph,lemma'
      && d.blocks[2].file === 'src/a.tex' && d.blocks[0].file === 'main.tex' && d.blocks.every((b) => b.rev === 1 && b.docId === id));
    check('createDoc: preamble string → {source, rev 1}; schema SCHEMA; blockCount', d?.preamble.source === '\\usepackage{amsmath}' && d.preamble.rev === 1 && d.schema === SCHEMA && d.blockCount === 3);
    check('getDoc: asset metadata without bytes, size and sha-256', d?.assets.length === 1 && !('bytes' in d.assets[0]) && d.assets[0].size === png.length
      && d.assets[0].hash === await sha256Hex(png));
    check('getDoc of an unknown id is null', (await store.getDoc(ulid())) === null);

    // 2. putBlock: insert between, edit (rev), no-op keeps rev
    const [b0, b1] = d!.blocks;
    const nb = { id: ulid(), docId: id, pos: keyBetween(b0.pos, b1.pos), kind: 'paragraph', source: 'Inserted.', file: 'main.tex', attrs: {}, rev: 0, updatedAt: 0 };
    await store.putBlock(id, nb);
    let bl = await store.getBlocks(id);
    check('putBlock: a new block between two lands between them', bl.map((b) => b.id).join() === [b0.id, nb.id, b1.id, d!.blocks[2].id].join() && bl[1].rev === 1);
    const before = (await store.getDocRecord(id))!.updatedAt;
    await store.putBlock(id, { ...bl[1], source: 'Inserted and edited.' });
    bl = await store.getBlocks(id);
    check('putBlock: an edit raises rev and doc.updatedAt', bl[1].rev === 2 && bl[1].source === 'Inserted and edited.' && (await store.getDocRecord(id))!.updatedAt > before);
    await store.putBlock(id, { ...bl[1] });
    check('putBlock: writing the same block again keeps rev', (await store.getBlocks(id))[1].rev === 2);
    await store.putBlock(id, { id: bl[1].id, attrs: { joined: true } });
    check('putBlock: a partial update (attrs) merges', (await store.getBlocks(id))[1].attrs.joined === true && (await store.getBlocks(id))[1].source === 'Inserted and edited.');

    // 3. many inserts between the same neighbours
    const doc2 = await store.createDoc({ title: 'Order', blocks: [{ source: 'A' }, { source: 'B' }] });
    let [A, B] = await store.getBlocks(doc2);
    const N = 150;
    let lo = A.pos;
    const expect: string[] = [];
    for (let i = 0; i < N; i++) {           // always just before B: keys converge on B
      const pos = keyBetween(lo, B.pos);
      const bid = ulid();
      await store.putBlock(doc2, { id: bid, docId: doc2, pos, kind: 'paragraph', source: `x${i}`, file: 'main.tex', attrs: {}, rev: 0, updatedAt: 0 });
      lo = pos; expect.push(`x${i}`);
    }
    for (let i = 0; i < N; i++) {           // always right after A: keys converge on A
      const cur = await store.getBlocks(doc2);
      const pos = keyBetween(A.pos, cur[1].pos);
      await store.putBlock(doc2, { id: ulid(), docId: doc2, pos, kind: 'paragraph', source: `y${i}`, file: 'main.tex', attrs: {}, rev: 0, updatedAt: 0 });
    }
    const got = (await store.getBlocks(doc2)).map((b) => b.source);
    const want = ['A', ...Array.from({ length: N }, (_, i) => `y${N - 1 - i}`), ...expect, 'B'];
    const maxLen = Math.max(...(await store.getBlocks(doc2)).map((b) => b.pos.length));
    check(`${2 * N} inserts between the same neighbours keep their order`, got.join() === want.join(), `longest key ${maxLen}`);
    check('fractional keys grow slowly (≤ 40 chars after 150 inserts into one gap)', maxLen <= 40, `longest ${maxLen}`);
    check('blockCount follows inserts', (await store.getDocRecord(doc2))!.blockCount === 2 + 2 * N);

    // 4. delete a block
    await store.deleteBlock(id, nb.id);
    check('deleteBlock: gone, blockCount down', (await store.getBlocks(id)).length === 3 && (await store.getDocRecord(id))!.blockCount === 3);
    await store.deleteBlock(id, nb.id);
    check('deleteBlock of a missing block is a no-op', (await store.getDocRecord(id))!.blockCount === 3);

    // 5. putMeta
    let r = (await store.getDocRecord(id))!;
    await store.putMeta(id, { openedAt: r.updatedAt + 1000 });
    const r2 = (await store.getDocRecord(id))!;
    check('putMeta openedAt: does not count as an edit', r2.updatedAt === r.updatedAt && r2.openedAt === r.updatedAt + 1000);
    await store.putMeta(id, { title: 'Store suite renamed', preamble: { source: '\\usepackage{amsmath,amssymb}', rev: 1 } });
    r = (await store.getDocRecord(id))!;
    check('putMeta title + preamble: saved, preamble rev +1, updatedAt up', r.title === 'Store suite renamed' && r.preamble.rev === 2 && r.updatedAt > r2.updatedAt);
    await store.putMeta(id, { meta: { arxivId: '2602.12926' } });
    check('putMeta meta: merged', (await store.getDocRecord(id))!.meta.authors?.[0] === 'A. Author' && (await store.getDocRecord(id))!.meta.arxivId === '2602.12926');

    // 6. listDocs: order, search, soft delete, limit
    await store.putMeta(doc2, { openedAt: Date.now() + 10_000 });
    let list = await store.listDocs();
    check('listDocs: last opened first; counts', list.length === 2 && list[0].id === doc2 && list[1].id === id && list[1].blockCount === 3 && list[0].blockCount === 2 + 2 * N);
    check('listDocs: meta.authors and a snippet', list[1].meta.authors?.[0] === 'A. Author' && typeof list[1].snippet === 'string');
    check('listDocs limit', (await store.listDocs({ limit: 1 })).length === 1);
    list = await store.listDocs({ text: 'RENAMED suite' });
    check('search: title, case-insensitive, all words', list.length === 1 && list[0].id === id && list[0].match?.in === 'title');
    list = await store.listDocs({ text: 'gdansk' });
    check('search: accents folded (authors “Gdańsk”)', list.length === 1 && list[0].id === id);
    list = await store.listDocs({ text: 'first paragraph' });
    check('search: full text of block sources, with a snippet', list.length === 1 && list[0].match?.in === 'text' && /First paragraph/.test(list[0].snippet ?? ''), list[0]?.snippet);
    list = await store.listDocs({ text: 'first paragraph', fullText: false });
    check('search: fullText false skips sources', list.length === 0);
    check('search: nothing', (await store.listDocs({ text: 'zzzqqq' })).length === 0);
    await store.putMeta(doc2, { deletedAt: Date.now() });
    check('soft delete: hidden from listDocs, shown with includeDeleted',
      (await store.listDocs()).length === 1 && (await store.listDocs({ includeDeleted: true })).length === 2);
    await store.putMeta(doc2, { deletedAt: undefined });
    check('undo soft delete: listed again', (await store.listDocs()).length === 2 && !('deletedAt' in (await store.getDocRecord(doc2))!));

    // 7. assets
    const aid = d!.assets[0].id;
    const png2 = enc('a different picture');
    const m2 = await store.putAsset(id, { name: 'figures/a.png', mime: 'image/png' }, png2);
    const a2 = await store.getAsset(id, aid);
    check('putAsset by an existing name replaces it, keeping the id', m2.id === aid && !!a2 && a2.size === png2.length && new TextDecoder().decode(a2.bytes) === 'a different picture');
    await store.putAsset(id, { id: aid, name: 'figures/a.png', mime: 'image/png', model: { kind: 'ipe', xml: '<ipe/>' } }, null);
    const a3 = await store.getAsset(id, aid);
    check('putAsset with bytes null: metadata only, bytes kept', a3?.model?.xml === '<ipe/>' && a3.bytes?.length === png2.length && a3.hash === await sha256Hex(png2));
    // new bytes drop an edit of the old file (integration issue 13)
    await store.putAsset(id, { id: aid, name: 'figures/a.png', rendition: { tikz: '\\begin{tikzpicture}\\end{tikzpicture}', hash: 'r1' } } as any, null);
    await store.putAsset(id, { name: 'figures/a.png', mime: 'image/png' }, png2);
    const same = await store.getAsset(id, aid);
    const png3 = enc('a third picture');
    await store.putAsset(id, { name: 'figures/a.png', mime: 'image/png' }, png3);
    const repl = await store.getAsset(id, aid);
    await store.putAsset(id, { name: 'figures/a.png', mime: 'image/png', rendition: { tikz: 'T', hash: 'r2' } } as any, png2);
    const given = await store.getAsset(id, aid);
    check('putAsset: new bytes clear model and rendition; the same bytes keep them; given ones stay',
      same?.rendition?.hash === 'r1' && same.model?.xml === '<ipe/>' && !repl?.rendition && !repl?.model && repl?.size === png3.length
      && given?.rendition?.hash === 'r2' && !given.model);
    const pdf = await store.putAsset(id, { name: 'figures/b.pdf', mime: 'application/pdf', ipe: true }, enc('%PDF-1.5 …'));
    check('getAssetByName, listAssets (sorted, no bytes)', (await store.getAssetByName(id, 'figures/b.pdf'))?.id === pdf.id
      && (await store.listAssets(id)).map((a) => a.name).join() === 'figures/a.png,figures/b.pdf' && (await store.listAssets(id)).every((a) => !('bytes' in a)));
    await store.deleteAsset(id, pdf.id);
    check('deleteAsset', (await store.listAssets(id)).length === 1 && (await store.getAsset(id, pdf.id)) === null);

    // 8. op log
    await store.appendOps(id, [{ t: 'insert', blockId: nb.id, payload: { block: nb } }, { t: 'edit', blockId: nb.id, payload: { from: 'a', to: 'b' } }]);
    const ops1 = await store.getOps(id);
    await store.appendOps(id, [{ t: 'delete', blockId: nb.id, payload: { block: nb } }]);
    const ops2 = await store.getOps(id, ops1[ops1.length - 1].id);
    check('appendOps/getOps: in order, id/at/actor filled, since', ops1.length === 2 && ops1[0].t === 'insert' && ops1[1].t === 'edit'
      && ops1.every((o) => o.id && o.at && o.actor === store.actor && o.docId === id) && ops2.length === 1 && ops2[0].t === 'delete');

    // 9. snapshots
    const s1 = await store.snapshots.put(id, 'First version');
    const blk = (await store.getBlocks(id))[1];
    await store.putBlock(id, { ...blk, source: 'Changed after the snapshot.' });
    const snap = await store.snapshots.get(s1);
    check('snapshot: get decodes the OpenDoc as it was', snap?.title === 'Store suite renamed' && snap.blocks.length === 3 && snap.blocks[1].source === blk.source && snap.assets.length === 1);
    const lst = await store.snapshots.list(id);
    check('snapshots.list: newest first, manual, block count', lst.length === 1 && lst[0].label === 'First version' && lst[0].kind === 'manual' && lst[0].blockCount === 3);
    for (let i = 0; i < KEEP_AUTO + 3; i++) await store.snapshots.put(id, `auto ${i}`, { kind: 'auto', at: Date.now() + i });
    const after = await store.snapshots.list(id);
    check(`auto snapshots pruned to ${KEEP_AUTO}; manual kept`, after.filter((s) => s.kind === 'auto').length === KEEP_AUTO && after.some((s) => s.id === s1)
      && !after.some((s) => s.label === 'auto 0') && after[0].label === `auto ${KEEP_AUTO + 2}`);
    // figure edits come back with a version (integration issue 12)
    const fig = await store.putAsset(id, { name: 'figures/f.pdf', mime: 'application/pdf', ipe: true } as any, enc('%PDF-1.5 ipe'));
    await store.putAsset(id, { id: fig.id, name: fig.name, model: { kind: 'ipe', xml: '<ipe>v1</ipe>' }, rendition: { tikz: 'TIKZ v1', hash: 'v1' } } as any, null);
    const sv1 = await store.snapshots.put(id, 'Figure v1');
    await store.putAsset(id, { id: fig.id, name: fig.name, model: { kind: 'ipe', xml: '<ipe>v2</ipe>' }, rendition: { tikz: 'TIKZ v2', hash: 'v2' } } as any, null);
    const sv2 = await store.snapshots.put(id, 'Figure v2');
    const snapFig = (await store.snapshots.get(sv1))!.assets.find((a: any) => a.id === fig.id) as any;
    await restoreSnapshot(store, sv1);
    const r1 = await store.getAsset(id, fig.id);
    const unedited = (await store.snapshots.get(s1))!;         // before the figure existed / was edited
    check('snapshots record each asset\'s model and rendition (no bytes); restore puts them back', snapFig?.rendition?.tikz === 'TIKZ v1' && !('bytes' in snapFig)
      && r1?.rendition?.tikz === 'TIKZ v1' && r1.model?.xml === '<ipe>v1</ipe>' && r1.bytes?.length === 12);
    await restoreSnapshot(store, sv2);
    check('restore forward again: the later figure edit is back', (await store.getAsset(id, fig.id))?.rendition?.hash === 'v2');
    const png2asset = unedited.assets.find((a: any) => a.name === 'figures/a.png') as any;
    await store.putAsset(id, { id: fig.id, name: fig.name, model: undefined, rendition: undefined } as any, null);
    const sNone = await store.snapshots.put(id, 'Figure unedited');
    await store.putAsset(id, { id: fig.id, name: fig.name, model: { kind: 'ipe', xml: '<ipe>v3</ipe>' }, rendition: { tikz: 'TIKZ v3', hash: 'v3' } } as any, null);
    await restoreSnapshot(store, sNone);
    const r3 = await store.getAsset(id, fig.id);
    check('restore to a version without the edit clears model and rendition', !r3?.rendition && !r3?.model && !!png2asset);
    await store.deleteAsset(id, fig.id);
    // a drawn figure's edit is its bytes (an SVG): versions keep its text and bring it back
    const svgA = await store.putAsset(id, { name: 'figures/d.svg', mime: 'image/svg+xml', rendition: { tikz: 'T1', hash: 't1' } } as any, enc('<svg>one</svg>'));
    const sSvg = await store.snapshots.put(id, 'Drawing one');
    await store.putAsset(id, { id: svgA.id, name: svgA.name, mime: 'image/svg+xml', rendition: { tikz: 'T2', hash: 't2' } } as any, enc('<svg>two</svg>'));
    await restoreSnapshot(store, sSvg);
    const svgBack = await store.getAsset(id, svgA.id);
    check('a drawn figure (SVG) comes back with a version: its bytes and its rendition', new TextDecoder().decode(svgBack!.bytes) === '<svg>one</svg>' && svgBack?.rendition?.hash === 't1'
      && (await store.snapshots.get(sSvg))!.assets.some((a: any) => a.svg === '<svg>one</svg>'));
    await store.deleteAsset(id, svgA.id);
    await store.snapshots.delete(s1);
    check('snapshots.delete', !(await store.snapshots.list(id)).some((s) => s.id === s1) && (await store.snapshots.get(s1)) === null);

    // 10. cache
    check('cache: missing key is null', (await store.cache.get('k:none')) === null);
    const res = { key: 'k1', status: 'ok', errors: [], warnings: [], nodelist: 'AAAA', spacing: { above: { pt: 1 } } };
    await store.cache.put('k1', res);
    const back = await store.cache.get('k1');
    check('cache: put/get a result', JSON.stringify(back) === JSON.stringify(res));
    await store.cache.delete('k1');
    await store.cache.put('k2', { a: 1 });
    await store.cache.clear();
    check('cache: delete and clear', (await store.cache.get('k1')) === null && (await store.cache.get('k2')) === null);

    // 11. isolation: what the store hands out is a copy
    const g = (await store.getDoc(id))!;
    g.blocks[0].source = 'mutated'; g.title = 'mutated';
    const g2 = (await store.getDoc(id))!;
    check('returned records are copies', g2.blocks[0].source === '\\section{One}' && g2.title === 'Store suite renamed');

    // 12. a failed batch writes nothing
    const okB = { id: ulid(), docId: id, pos: keyBetween(null, g2.blocks[0].pos), kind: 'paragraph', source: 'ok', file: 'main.tex', attrs: {}, rev: 0, updatedAt: 0 };
    let threw = false;
    try { await store.putBlocks(id, [okB, { id: ulid(), source: 'no pos' } as any]); } catch { threw = true; }
    check('putBlocks: a bad block aborts the whole batch', threw && (await store.getBlocks(id)).length === 3 && (await store.getDocRecord(id))!.blockCount === 3);

    // 13. events
    check('subscribe: doc, block, asset, snapshot events', ['doc', 'block', 'asset', 'snapshot'].every((t) => events.includes(`${t}:${id}`)));

    // 14. delete a document: everything goes
    const sId = await store.snapshots.put(doc2, 'to go');
    await store.appendOps(doc2, [{ t: 'meta', payload: { title: 'x' } }]);
    await store.deleteDoc(doc2);
    check('deleteDoc: doc, blocks, ops, snapshots gone', (await store.getDoc(doc2)) === null && (await store.getBlocks(doc2)).length === 0
      && (await store.getOps(doc2)).length === 0 && (await store.snapshots.get(sId)) === null && (await store.listDocs()).length === 1);

    // 15. persistence (a second connection to the same database)
    if (reopen) {
      const s2 = await reopen();
      const p = await s2.getDoc(id);
      check('reopened store: the document, its blocks and asset are there', p?.title === 'Store suite renamed' && p.blocks.length === 3
        && p.blocks[1].source === 'Changed after the snapshot.' && (await s2.getAsset(id, aid))?.bytes?.length === png2.length);
      s2.close();
    }
  } catch (e: any) {
    check('suite ran without an exception', false, e?.stack ?? String(e));
  } finally {
    unsub();
  }
  store.close();
  return out;
}
