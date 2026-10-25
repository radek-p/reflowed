// svgfig's wiring into the document editor (app/app.js): everything the app does for SVG figures, behind
// one facade, so app.js only has one-line hooks (the rule: no feature code in app.js). It is a Feature (app/feature.ts:
// blockItems, slash, loaded, sync, duplicate, forExport, dispose, testApi), composed with the others by app.js.
//
//   const svgFigs = createSvgFigureHooks(host)        host: what app.js hands in (below)
//   svgFigs.isSvg(name)                  an SVG asset of this document (editFigure)
//   svgFigs.blockAction(b)               the block shell's Edit figure, on a block that shows an SVG figure (app/feature.ts)
//   svgFigs.edit(b, u, f, opts)          open the SVG editor on figure f of block b; a save is one undo step
//   svgFigs.loaded(doc)                  after a document opens: its SVG assets, and the figure colours
//   svgFigs.sync()                       after every structural change: owned files follow their blocks (trash)
//   svgFigs.slash.kinds(kinds), .pick(fn)  the slash/+ menu's "Drawn figure"
//   svgFigs.blockItems(id, item)         the block menu's "Duplicate figure"
//   svgFigs.duplicate(id)                a block's Duplicate when it owns drawn figures (true: done)
//   svgFigs.forExport(doc)               exports leave the trash out
//   svgFigs.testApi()                    editorAPI test probes
// and, on its own: a click on a drawn figure's text in the document edits that label in place (label-edit.js)
//
// host: { ctx, doc(), store, backend(), ids, write, op, logOps, perform, history, unplaceBlock, placeBlock,
//         newBlock, indexOf, blockById, renderAll, compileSoon, display, leaveEdit, editing(), editFigure,
//         saveBlock, toast, hash, noteAsset(meta), forgetAsset(meta) (the keys' file signatures),
//         filesOf(b) (doc/block-files.ts: what the block uses, its compile's record and its source's names),
//         usedAssets(b) (the document's files it uses: { name, opts, include }) }
// A figure is the block's when the block uses its file: written in its source, or placed by a macro (what its
// compile opened).

import { svgFigures } from './index.js';
import { createLabelEdits } from './label-edit.js';

export function createSvgFigureHooks(host) {
  const svgAssets = new Set();
  const doc = () => host.doc();

  function noteAsset(m) {
    const d = doc();
    const i = d.assets.findIndex((a) => a.id === m.id);
    if (i >= 0) d.assets[i] = m; else d.assets.push(m);
    host.noteAsset(m);
    if (svgFigures.isSvgAsset(m)) svgAssets.add(m.name);
  }
  function forgetAsset(m) {
    const d = doc();
    d.assets = d.assets.filter((a) => a.id !== m.id);
    host.forgetAsset(m); svgAssets.delete(m.name);
  }
  const figs = svgFigures.lifecycle({ ...host, doc, noteAsset, forgetAsset });

  // an SVG figure: the editor edits the SVG; saved, the asset is the new SVG and its rendition { tikz }
  // (for the export; the backend draws the SVG itself)
  let open = false;
  async function edit(b, u, f, { fresh = false } = {}) {
    if (open) return;
    if (host.editing()) host.leaveEdit({ animate: false });
    const asset = await host.store.getAssetByName?.(doc().id, f.name);
    if (!asset) { host.toast(`${f.name} is not in this document`); return; }
    const scale = Number(/(?:^|,)\s*scale\s*=\s*([\d.]+)/.exec(f.opts)?.[1]) || undefined;
    const backend = host.backend();
    open = true;
    let res;
    try {
      res = await svgFigures.open(asset, {
        compileLabel: (src, o) => backend.compileSnippet(src, o),
        renderTikz: backend.renderTikz ? (src) => backend.renderTikz(src, '\\usepackage{tikz}') : null,
        preamble: doc().preamble.source, scale, name: f.name,
        include: f.include ?? '',
        from: u?.render?.querySelector('.latex-picture') ?? u?.render ?? null,
      });
    } catch (e) { host.toast(`Figure: ${e.message}`); return; } finally { open = false; }
    if (fresh && !res?.saved) { await figs.discardBlank(b.id, f.name); return; }     // a blank cancelled: nothing left
    if (!res?.changed || !res.svg) return;
    figs.saveEdit(asset, { svg: res.svg, tikz: res.tikz, hash: host.hash(res.svg + res.tikz) });   // one undo step
    host.toast('Figure saved');
  }

  // a drawn figure's label edited in place, in the document
  const scaleOf = (opts) => Number(/(?:^|,)\s*scale\s*=\s*([\d.]+)/.exec(opts ?? '')?.[1]) || undefined;
  /** The SVG figure a document picture shows: the block's pictures that carry figure texts, in order, are
   *  the SVG figures it uses, in order (its \includegraphics first, then those its compile opened). */
  function figureAt(pic) {
    const blk = pic.closest('.blk[data-id]');
    const b = blk && host.blockById(blk.dataset.id);
    if (!b) return null;
    const pics = [...blk.querySelectorAll('.latex-picture')].filter((p) => p.querySelector('[data-rtx-text]'));
    const figs = host.usedAssets(b).filter((x) => svgAssets.has(x.name));
    const f = figs[pics.indexOf(pic)];
    return f ? { block: b.id, name: f.name, scale: scaleOf(f.opts), include: f.include } : null;
  }
  const labels = globalThis.document ? createLabelEdits({
    root: () => document.body,
    figureAt,
    asset: (name) => host.store.getAssetByName?.(doc().id, name),
    renderTikz: (src) => host.backend().renderTikz?.(src, '\\usepackage{tikz}'),
    saveEdit: (asset, r) => { figs.saveEdit(asset, { ...r, hash: host.hash(r.svg + r.tikz) }); host.toast('Label saved'); },
    toast: host.toast,
    editable: (pic) => {
      const id = pic.closest('.blk[data-id]')?.dataset.id;
      return !!id && !open && !doc()?.readOnly && host.editing() !== id && !pic.closest('.svf-root');
    },
  }) : null;

  function loaded(d) {
    svgAssets.clear();
    for (const a of d.assets ?? []) if (svgFigures.isSvgAsset(a)) svgAssets.add(a.name);
    // installColours goes through view/colour-maps.ts registerColourMap
    if (svgAssets.size) svgFigures.installColours(host.ctx.view?.colorMap ?? 'editor');
  }

  /** The slash menu's pick: when the pick made a new block, its undo entry is tagged with the block (a
   *  cancelled blank then takes that entry away); a "Drawn figure" pick makes the file and opens the editor. */
  function onPick(fn) {
    return (t) => {
      const before = t.svgfig ? new Set(doc().blocks.map((b) => b.id)) : null;
      const top = host.history.top();
      fn(t);
      if (!t.svgfig) return;
      const last = host.history.top();
      const made = doc().blocks.find((b) => !before.has(b.id));
      if (made && last && last !== top) last.blockId = made.id;
      figs.afterPick(t);
    };
  }
  function kinds(all) {
    const out = [...all];
    out.splice(out.findIndex((k) => k.kind === 'figure') + 1, 0, figs.menuKind());
    return out;
  }

  return {
    id: 'svgfig',
    lifecycle: figs,
    isSvg: (name) => svgAssets.has(name),
    // the shell's button, contributed: it was app.js's figureButton and a figure flag on every block
    blockAction: (b) => (host.usedAssets(b).some((f) => svgAssets.has(f.name))
      ? { id: 'edit-figure', label: 'Edit figure', title: 'Edit the figure', cls: 'fig-edit', run: (view) => host.editFigure(b.id, null, {}, view) } : null),
    edit, loaded,
    slash: { kinds, pick: onPick },
    sync: () => figs.sync(),
    blockItems: (id, item) => (figs.hasDrawn(id) ? [item('Duplicate figure', 'duplicate-figure', () => figs.duplicate(id))] : []),
    duplicate: (id) => { if (!figs.owns(id)) return false; figs.duplicate(id, { all: false }); return true; },
    forExport: (d) => figs.forExport(d),
    /** the page listeners it added (an editor of a second document goes) */
    dispose: () => labels?.dispose(),
    testApi: () => ({
      undoLabels: () => host.history.labels(),   // what an undo would undo
      svgFigures: () => svgFigures,                           // tests and the seed builder
      labelEdit: () => labels,                                // the in-place label field
    }),
  };
}
