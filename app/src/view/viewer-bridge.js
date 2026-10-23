// Every read of the public viewer's internals goes through here.
// The viewer's documented surface is `window.reflowtex.inspect` (blocks, state, replay, idle, spToPx);
// what `state(el).cache` holds (the layout's laid segments, their SVGs, the source width, relayout) is
// private to it. Rule: no `.cache` read of viewer state outside this file, so a change in the viewer
// breaks here, in one place, and a stable hit API (glyphAt, glyphRects) can replace these later.
//
//   inspect() · docOf(el) · laidCount(el) · laidKind(el, i) · segmentSvg(el, i) · sourceWidthPt(el)
//   laidAt(el) · relayout(el) · madeElements(el, nodes => …) (the viewer's slot texts) · replay(el, i, cb)

/** the viewer's inspect API (null before the viewer runs) */
export const inspect = () => globalThis.reflowtex?.inspect ?? null;
const stateOf = (el) => { try { return inspect()?.state?.(el) ?? null; } catch { return null; } };

/** the block's decoded document (fonts, glyph metrics, slot paragraphs), or null */
export const docOf = (el) => stateOf(el)?.doc ?? null;
/** how many laid-out segments (paragraph parts, displays) the block has now */
export const laidCount = (el) => stateOf(el)?.cache?.layout?.laid?.length ?? 0;
/** segment i's kind ('display', …) */
export const laidKind = (el, i) => stateOf(el)?.cache?.layout?.laid?.[i]?.seg?.kind ?? null;
/** segment i's SVG element (for its screen transform) */
export const segmentSvg = (el, i) => stateOf(el)?.cache?.dom?.segs?.[i]?.svg ?? null;
/** the width the block was typeset at, pt (TeX's \hsize there: \textwidth for a paragraph), 0 if unknown */
export const sourceWidthPt = (el) => { const w = stateOf(el)?.cache?.sourceWidthSp; return w > 0 ? w / 65536 : 0; };
/** the width (pt) and alignment the viewer last laid the block out at, or null before its first layout */
export const laidAt = (el) => { const st = stateOf(el); return st && st.lastWidth > 0 ? { widthPt: st.lastWidth, align: st.lastAlign } : null; };
/** lay the block out again (after a change the viewer cannot see, like --latex-align) */
export function relayout(el) { try { stateOf(el)?.cache?.relayout?.(); } catch { /* gone */ } }
/** the elements the viewer drew for these nodes, through every nested segment: fn(doc) -> nodes */
export function madeElements(el, nodesOf) {
  const out = new Set();
  const st = stateOf(el);
  const walk = (doc, cache) => {
    const byNode = cache?.dom?.byNode;
    if (!byNode) return;
    for (const n of nodesOf(doc)) { const e = byNode.get(n); if (e) out.add(e); }
    for (const seg of cache.dom.segs ?? []) if (seg?.sub) walk(doc, seg.sub);
  };
  walk(st?.doc, st?.cache);
  return out;
}
/** replay segment i's drawing (inspect.replay) */
export const replay = (el, i, cb) => inspect()?.replay?.(el, i, cb) ?? false;
