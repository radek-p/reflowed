// svgfig lifecycle: drawn figures are files (assets) whose life follows the
// block that made them. The app (app.js) hands in what it has; everything else is here:
//   - "Drawn figure" in the block menus: a new figures/figure-N.svg owned by the new block, the editor
//     opened on it at once; Cancel on the untouched blank takes block and file away again
//   - a drawing edit is one undo step (and the op the app logs for figure edits)
//   - duplicate: the block's drawn figures copied under new names, its labels renamed
//   - sync(): an owned file whose block is gone and that nothing references goes to the trash;
//     back out of it when its block comes back (undo) or something references it again
//   - forExport(doc): the trash stays out of exports
// app: { doc(), store, ids, write(fn), op(t, payload, blockId), logOps(ops), perform(label, do, undo, extra),
//        history (doc/history.js: top, drop, labels), insertBlock(index, kind, source, parentId), unplaceBlock(id), placeBlock(b, i), newBlock(kind, source, file, parentId),
//        indexOf(id), blockById(id), renderAll(), compileSoon(), display(id), redisplay(which?), noteAsset(meta), forgetAsset(meta),
//        leaveEdit(), editFigure(id, name, opts), saveBlock(b), toast(text) }

import { MIME, svgBytes, figureToSvg } from './asset.js';
import { newFigure } from './model.js';

const GRAPHICS = /\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const LABEL = /\\label\s*\{([^}]+)\}/g;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stem = (name) => name.replace(/\.svg$/i, '');
/** Whether source references asset `name` (\includegraphics{figures/x} or {figures/x.svg}). */
export const references = (source, name) => [...source.matchAll(GRAPHICS)].some((m) => { const n = m[1].trim(); return n === name || `${n}.svg` === name; });
/** A figure block's LaTeX, after the document's own figures (their placement, \centering) when it has any. */
export function figureSource(blocks, name, label) {
  const like = blocks.map((b) => b.source).find((s) => /\\begin\{figure\}/.test(s) && /\\includegraphics/.test(s)) ?? '';
  const place = /\\begin\{figure\}(\[[^\]]*\])/.exec(like)?.[1] ?? (like ? '' : '[t]');
  const centre = !like || /\\centering/.test(like);
  return `\\begin{figure}${place}\n${centre ? '  \\centering\n' : ''}  \\includegraphics{${name}}\n  \\caption{}\n  \\label{${label}}\n\\end{figure}`;
}

export function figureLifecycle(app) {
  const doc = () => app.doc();
  const assets = () => doc().assets ?? [];
  const sources = () => doc().blocks.map((b) => b.source);
  const isDrawn = (a) => a && (a.mime === MIME || /\.svg$/i.test(a.name));
  /** The first free name: figures/figure-N.svg, or <stem>-N.svg for a copy. */
  function freeName(base = 'figures/figure', from = 1) {
    const taken = (n) => assets().some((a) => a.name === n) || sources().some((s) => references(s, n));
    for (let i = from; ; i++) { const n = `${base}-${i}.svg`; if (!taken(n)) return n; }
  }
  function freeLabel(key, extra = []) {
    const used = new Set([...sources().flatMap((s) => [...s.matchAll(LABEL)].map((m) => m[1].trim())), ...extra]);
    if (!used.has(key)) return key;
    const base = key.replace(/-\d+$/, '');
    for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  const put = (meta, bytes) => app.store.putAsset(doc().id, meta, bytes).then((m) => { app.noteAsset(m); return m; });
  const assetOp = (m, extra = {}) => app.op('meta', { asset: { id: m.id, name: m.name, hash: m.hash, rendition: m.rendition?.hash ?? null, ...extra } });
  function refresh(names) {
    app.redisplay((b) => names.some((n) => references(b.source, n)));
    app.compileSoon();
  }

  // ── the block menus' item ────────────────────────────────────────────────
  /** The slash/+ menu's entry (its name is picked now; the file is made once the block is in). */
  function menuKind() {
    const name = freeName();
    const label = freeLabel(`fig:${stem(name).split('/').pop()}`);
    const source = figureSource(doc().blocks, name, label);
    return { kind: 'figure', label: 'Drawn figure', icon: '◩', hint: 'figure: draw it here (shapes, LaTeX labels)', group: 'Floats',
      source, caret: source.length, svgfig: name };
  }
  /** After the menu put t.source into a block (a new one, or the empty one being edited): make the
   *  file, owned by that block, and open the editor on it. */
  async function afterPick(t) {
    const name = t.svgfig;
    app.leaveEdit();
    const b = doc().blocks.find((x) => references(x.source, name));
    if (!b) return;
    const meta = await put({ name, mime: MIME, owner: b.id }, svgBytes(figureToSvg(newFigure(320, 160))));
    app.logOps([assetOp(meta, { owner: b.id })]);
    refresh([name]);
    await app.editFigure(b.id, name, { fresh: true });
  }
  /** Cancel on a blank just made: block and file go, and nothing is left to undo. */
  async function discardBlank(blockId, name) {
    const b = app.blockById(blockId);
    // the document's history (doc/history.js): the pick's entry taken away
    if (app.history.drop((e) => e.blockId === blockId)) { app.unplaceBlock(blockId); app.renderAll(); }
    else if (b) { b.source = ''; b.kind = 'paragraph'; app.saveBlock(b); app.renderAll(); }     // the empty block it was typed in
    const a = assets().find((x) => x.name === name);
    if (a) await app.write(async () => { await app.store.deleteAsset(doc().id, a.id); app.forgetAsset(a); app.logOps([app.op('meta', { asset: { id: a.id, name, deleted: true } })]); });
    app.compileSoon();
  }

  // ── a drawing edit: one undo step ────────────────────────────────────────
  function saveEdit(asset, res) {
    const before = { bytes: asset.bytes, rendition: asset.rendition ?? undefined };
    const rendition = { tikz: res.tikz, hash: res.hash };
    const after = { bytes: svgBytes(res.svg), rendition };
    // a step as data: the file's bytes and rendition before and after; the 'asset' applier below writes either
    app.history.record({ type: 'asset', label: 'edit figure', doc: doc().id, asset: { id: asset.id, name: asset.name }, before, after });
    writeAsset(asset, after);
  }
  const writeAsset = (a, s) => app.write(async () => {
    const m = await put({ id: a.id, name: a.name, mime: MIME, rendition: s.rendition }, s.bytes);
    app.logOps([assetOp(m)]);
    refresh([a.name]);
  });
  app.history.define?.('asset', (st, how) => { writeAsset(st.asset, how === 'undo' ? st.before : st.after); });

  // ── duplicate ────────────────────────────────────────────────────────────
  /** The drawn figures a block references (names). */
  const drawnIn = (b) => [...new Set([...b.source.matchAll(GRAPHICS)].map((m) => m[1].trim()).map((n) => assets().find((a) => (a.name === n || a.name === `${n}.svg`) && isDrawn(a))?.name).filter(Boolean))];
  const owns = (id) => assets().some((a) => a.owner === id && isDrawn(a) && !a.trashed);
  /** Copy block id with copies of its drawn figures (all of them: "Duplicate figure"; only the owned
   *  ones: the block's Duplicate) under new names, and its labels renamed. false: nothing to copy. */
  async function duplicate(id, { all = true } = {}) {
    const src = app.blockById(id);
    if (!src) return false;
    const names = drawnIn(src).filter((n) => all || assets().find((a) => a.name === n)?.owner === id);
    if (!names.length) return false;
    const pairs = [];
    for (const n of names) {
      const s = stem(n).replace(/-\d+$/, '');
      let nn = freeName(s, 2);
      while (pairs.some(([, x]) => x === nn)) nn = freeName(s, Number(/-(\d+)\.svg$/.exec(nn)[1]) + 1);
      pairs.push([n, nn]);
    }
    let source = src.source;
    for (const [a, b] of pairs) source = source.replace(new RegExp(`(\\\\includegraphics\\s*(?:\\[[^\\]]*\\])?\\s*\\{)${esc(a)}(\\})`, 'g'), `$1${b}$2`)
      .replace(new RegExp(`(\\\\includegraphics\\s*(?:\\[[^\\]]*\\])?\\s*\\{)${esc(stem(a))}(\\})`, 'g'), `$1${stem(b)}$2`);
    const fresh = [];
    source = source.replace(LABEL, (m, k) => { const k2 = freeLabel(k.trim(), fresh); fresh.push(k2); return `\\label{${k2}}`; });
    const files = [];
    for (const [a, b] of pairs) {
      const full = await app.store.getAssetByName(doc().id, a);
      if (full?.bytes) files.push({ name: b, bytes: full.bytes, rendition: full.rendition ? { ...full.rendition, tikz: full.rendition.tikz?.split(a).join(b) } : undefined });
    }
    const nb = app.newBlock(src.kind, source, src.file, src.parentId ?? null);
    let made = false;
    app.perform('duplicate figure', () => {
      app.placeBlock(nb, app.indexOf(id) + 1);                // (drawn and compiled by the change's record: doc/ops.ts)
      if (!made) {
        made = true;
        app.write(async () => {
          const ms = [];
          for (const f of files) ms.push(await put({ name: f.name, mime: MIME, owner: nb.id, rendition: f.rendition }, f.bytes));
          app.logOps(ms.map((m) => assetOp(m, { owner: nb.id })));
          refresh(files.map((f) => f.name));
          sync();
        });
      }
    }, { blockId: nb.id });
    return nb;
  }

  // ── trash ────────────────────────────────────────────────────────────────
  let syncing = Promise.resolve();
  /** Owned files follow their blocks: trashed when the owner is gone and nothing references them,
   *  back when either returns. Runs after every structural change (renderAll). */
  function sync() {
    const d = doc();
    if (!d) return;
    const changes = [];
    for (const a of assets()) {
      if (!a.owner || !isDrawn(a)) continue;
      const wanted = !!app.blockById(a.owner) || d.blocks.some((b) => references(b.source, a.name));
      if (!wanted && !a.trashed) changes.push({ a, trashed: { at: Date.now(), block: a.owner } });
      else if (wanted && a.trashed) changes.push({ a, trashed: undefined });
    }
    if (!changes.length) return;
    for (const c of changes) c.a.trashed = c.trashed;          // at once: a second sync sees it
    syncing = app.write(async () => {
      const ms = [];
      for (const c of changes) ms.push(await put({ id: c.a.id, name: c.a.name, trashed: c.trashed }, null));
      app.logOps(ms.map((m, i) => assetOp(m, { trashed: changes[i].trashed ? true : false })));
    });
  }

  const forExport = (d) => ({ ...d, assets: (d.assets ?? []).filter((a) => !a.trashed) });
  const hasDrawn = (id) => { const b = app.blockById(id); return !!b && drawnIn(b).length > 0; };
  return { hasDrawn, menuKind, afterPick, discardBlank, saveEdit, duplicate, owns, sync, forExport, freeName, freeLabel, settled: () => syncing };
}
