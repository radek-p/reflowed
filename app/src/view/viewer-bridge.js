// The one read of the public viewer's internals left: the elements it drew for the texts it set in \webtext slots,
// for refs/numbering.ts's fallback for slots inside boxes (which the viewer cannot replace yet). Everything else the
// editor reads of the viewer is its documented host API (view/viewer-host.ts).
//
//   madeElements(el, nodes => …) (the viewer's slot texts)

/** the viewer's inspect API (null before the viewer runs) */
const inspect = () => globalThis.reflowtex?.inspect ?? null;
const stateOf = (el) => { try { return inspect()?.state?.(el) ?? null; } catch { return null; } };

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
