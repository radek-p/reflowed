// addresses a glyph by its item and its ordinal among the item's glyphs; that holds only while the
// encoder keeps every glyph, in order. An encoder change that merges, drops or reorders glyphs would
// shift every address after it, silently. So the map carries, per item, the glyph count and a
// shape checksum (sourcemap.ts `checks`), and before an address is used the viewer's item is checked
// against them: on a mismatch the item's addresses give nothing (the caller falls back to its fuzzy
// map) and `guardStats.mismatches` counts it (globalThis.rtxSourceMapGuard; test-caret asserts 0).
// A map without `checks` (an older build) is used as before.
import { blockGlyphOffsets, indexFor, itemGlyphs, locateGlyph, shapeSum, type GlyphAddress, type SourceMap } from './sourcemap.ts';

type J = Record<string, any>;

export const guardStats = { checked: 0, mismatches: 0, last: '' };
(globalThis as any).rtxSourceMapGuard = guardStats;

const verdicts = new WeakMap<object, WeakMap<object, Map<string, boolean>>>();   // map → doc → item → ok

/** Does item `key` of the viewer's document match the map's check for it? (cached per map and doc) */
export function itemMatches(map: SourceMap, doc: J, key: string): boolean {
  const want = map.checks?.[key];
  if (!want) return !map.checks;            // an older map: unchecked; a checked map without the item: no glyphs there
  let byDoc = verdicts.get(map);
  if (!byDoc) verdicts.set(map, (byDoc = new WeakMap()));
  let byItem = byDoc.get(doc);
  if (!byItem) byDoc.set(doc, (byItem = new Map()));
  const known = byItem.get(key);
  if (known !== undefined) return known;
  const gs = itemGlyphs(doc, key) ?? [];
  const ok = gs.length === want[0] && shapeSum(gs) === want[1];
  guardStats.checked++;
  if (!ok) { guardStats.mismatches++; guardStats.last = `${key}: ${gs.length} glyphs (map ${want[0]}), shape ${shapeSum(gs)} (map ${want[1]})`; }
  byItem.set(key, ok);
  return ok;
}

/** locateGlyph, or null when the node's item does not match the map */
export function guardedLocate(map: SourceMap | null | undefined, doc: J, node: J): GlyphAddress | null {
  if (!map) return null;                    // no map (a fuzzy result): no address
  const at = locateGlyph(doc, node);
  return at && itemMatches(map, doc, at.item) ? at : null;
}

/** blockGlyphOffsets, with -1 for every glyph of an item that does not match the map */
export function guardedBlockGlyphOffsets(map: SourceMap, doc: J, drawn: J[], blockText: string,
                                         where: { file?: string; firstLine?: number } = {}): { glyphs: number[] } {
  const r = blockGlyphOffsets(map, doc, drawn, blockText, where);
  if (!map.checks) return r;
  const index = indexFor(doc, drawn);
  return { glyphs: r.glyphs.map((off, k) => { const at = index.get(drawn[k]); return off >= 0 && at && !itemMatches(map, doc, at.item) ? -1 : off; }) };
}
