// svgfig text: LaTeX texts typeset with the document's preamble.
//  - glyphs: each text as a one-node tikzpicture (tikz.js textNode, the same
//    node the TikZ rendition writes), through the engine's `tikz` job
//    (backend.renderTikz, warm): an SVG of the glyph outlines and its TeX size.
//    The canvas and the saved figure show these, so what is edited is what
//    the document shows.
//  - live: while a text box is being resized, the text as a viewer block
//    (backend.compileSnippet at its width, mounted by the viewer), which
//    breaks again at every width with no compile. On release the glyphs are
//    typeset for the new width and replace it.

import { textNode } from './tikz.js';
import { nestGlyphs } from './render.js';

const TOKEN = 'rtxP_';
const r2 = (v) => Math.round(v * 100) / 100;

/** What decides a text's glyphs (the saved figure keeps it as `gsig`). */
export const sigOf = (o) => JSON.stringify([o.src, o.size ?? 'normal', o.box != null ? r2(o.box) : null, o.box != null ? o.align ?? 'center' : null]);
export const glyphSource = (o) => {
  const { opt, text } = textNode({ ...o, anchor: 'nw', rot: 0 }, { colour: false });
  return `\\begin{tikzpicture}\\node[${opt.join(', ')}] at (0,0) {${text}};\\end{tikzpicture}`;
};
const forId = (svg, id) => svg.split(TOKEN).join(`t${id}_`);
const toToken = (svg, id) => svg.split(`t${id}_`).join(TOKEN);

export function createTypesetter({ renderTikz, compileLabel }) {
  const bySig = new Map();          // sig -> Promise<{ svg (TOKEN ids), w, h } | { error }>
  const glyphs = new Map();         // id -> { sig, svg, w, h }  (what is drawn and saved)
  let pending = 0;
  const listeners = new Set();
  const note = () => { for (const f of listeners) f(pending); };

  /** Take the glyphs a saved figure carried (asset.js svgToFigure). */
  function adopt(map) {
    for (const [id, g] of map) {
      glyphs.set(id, g);
      if (!bySig.has(g.sig)) bySig.set(g.sig, Promise.resolve({ svg: toToken(g.svg, id), w: g.w, h: g.h }));
    }
  }

  function run(o) {
    const sig = sigOf(o);
    if (!bySig.has(sig)) {
      const src = glyphSource(o);
      pending++; note();
      const p = (async () => {
        if (!renderTikz) return { error: 'no LaTeX engine here' };
        const r = await renderTikz(src);
        if (!r?.svg) return { error: (r?.errors ?? []).map((e) => e.message).join('\n') || 'did not typeset' };
        const w = r.widthBp, h = r.heightBp + r.depthBp;
        return { svg: nestGlyphs(r.svg, TOKEN, w, h), w, h };
      })().catch((e) => ({ error: String(e?.message ?? e) })).finally(() => { pending--; note(); });
      bySig.set(sig, p);
      p.then((x) => { if (x.error) bySig.delete(sig); });
    }
    return bySig.get(sig).then((x) => ({ ...x, sig }));
  }

  /** Typeset o (when its glyphs are not for its current source/size/width).
   *  Resolves to { changed, error? }; o.tw/o.th/o.gsig are set on success.
   *  { interim: true } (a box being resized): glyphs typeset for a width the box has left meanwhile
   *  are still taken (drawn, o.tw/o.th theirs; o.gsig stays, so the final typeset still runs). */
  async function typeset(o, { interim = false } = {}) {
    const sig = sigOf(o);
    const have = glyphs.get(o.id);
    // (the size too: a resize gesture maps the text from its snapshot, which carries the size of the
    // glyphs it started with, though glyphs for the new width were typeset meanwhile)
    if (have && have.sig === sig) { const moved = o.tw !== r2(have.w) || o.th !== r2(have.h); o.gsig = sig; o.tw = r2(have.w); o.th = r2(have.h); return { changed: moved }; }
    const x = await run(o);
    if (x.error) return { changed: false, error: x.error, stale: sigOf(o) !== x.sig };
    if (sigOf(o) !== x.sig) {
      if (!interim) return { changed: false, stale: true };
      glyphs.set(o.id, { sig: x.sig, svg: forId(x.svg, o.id), w: x.w, h: x.h });
      o.tw = r2(x.w); o.th = r2(x.h);
      return { changed: true, stale: true };
    }
    glyphs.set(o.id, { sig, svg: forId(x.svg, o.id), w: x.w, h: x.h });
    o.tw = r2(x.w); o.th = r2(x.h); o.gsig = sig;
    return { changed: true };
  }

  /** A viewer block of o's text at width widthBp (live re-breaking); the element. */
  async function liveBlock(o, host) {
    if (!compileLabel) return null;
    const { SIZES } = await import('./model.js');
    const size = SIZES[o.size] ? `${SIZES[o.size]} ` : '';
    const res = await compileLabel(`\\noindent ${size}${o.src}`, o.box != null ? { widthBp: o.box } : {});
    if (!res || res.status === 'error' || !res.nodelist) return null;
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.dataset.nodelistB64 = res.nodelist;
    el.dataset.align = o.box != null ? (o.align === 'justify' ? 'justify' : o.align === 'left' ? 'left' : o.align === 'right' ? 'right' : 'center') : 'left';
    if (o.box == null) el.dataset.latexWidth = 'natural';
    host.append(el);
    const block = await globalThis.window?.reflowtex?.host?.mount?.(el);
    return { el, block };
  }

  return {
    glyphs, adopt, typeset, liveBlock,
    forget: (id) => glyphs.delete(id),
    copy: (from, to) => { const g = glyphs.get(from); if (g) glyphs.set(to, { ...g, svg: forId(toToken(g.svg, from), to) }); },
    pending: () => pending,
    onPending: (f) => { listeners.add(f); return () => listeners.delete(f); },
  };
}
