// the document's \textwidth for the Paper width (out of view/index.js).
// Read from the viewer (the most common source width of the blocks on the page), and remembered per
// document, so a document opened again shows its paper column from the first paint (no column jump
// once the first block is typeset). Until the viewer has laid a block out, the caller asks again when
// the viewer is idle (whenKnown).
//
// Or from the preamble's warm (tw.learn: \textwidth as TeX has it at \begin{document}, cached with
// the preamble's result): a document opened for the first time then has its column before its first paint too,
// instead of the source stand-ins being laid out at the default width and all re-broken when the first block lands.
//
//   const tw = createTextwidth()
//   tw.get() (pt, 0: unknown) · tw.route(docId | null) · tw.read() (from the viewer now) · tw.learn(pt) · tw.whenKnown(fn)
import { inspect, sourceWidthPt } from './viewer-bridge.js';
const KEY = 'rtx-editor.textwidth';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const save = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* not kept */ } };

/** the most common source width (pt) of the viewer's blocks in an editor's first pane */
export function viewerTextwidth() {
  const n = new Map();
  for (const el of inspect()?.blocks?.() ?? []) {
    if (!el.closest?.('[data-part="page"]')) continue;
    const w = sourceWidthPt(el);                           // view/viewer-bridge.js
    if (w > 0) n.set(w, (n.get(w) ?? 0) + 1);
  }
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 0;
}

// the document as the address names it (an id, or a seed's name that a memory store gives a new id each load)
const hashDoc = () => { try { const m = /^#\/doc\/([^/?#]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } };

export function createTextwidth() {
  let pt = 0, doc = null, waiting = false;
  const keep = (w) => {
    pt = w;
    if (doc) { const m = load(); if (m[doc] !== w) { m[doc] = w; const ks = Object.keys(m); if (ks.length > 200) delete m[ks[0]]; save(m); } }
  };
  const api = {
    get: () => pt,
    /** a document opened (null: none): its remembered width, if any */
    route(id) { doc = id ? (hashDoc() ?? id) : null; pt = (doc && Number(load()[doc])) || 0; },
    /** read it from the viewer; remember it for this document */
    read() {
      const w = viewerTextwidth();
      if (w > 0) keep(w);
      return pt;
    },
    /** the width known another way (the preamble's warm): kept as the viewer's would be */
    learn(w) { if (w > 0) { doc ??= hashDoc(); keep(w); } return pt; },
    /** call fn once the viewer is idle (its blocks laid out), at most one wait at a time */
    whenKnown(fn) {
      if (waiting) return;
      const idle = window.reflowtex?.inspect?.idle;
      if (!idle) return;
      waiting = true;
      Promise.resolve(idle()).catch(() => {}).then(() => { waiting = false; fn(); });
    },
  };
  // the document in the address at start: its width is the first column drawn
  const h = hashDoc(); if (h) api.route(h);
  return api;
}
