// Source positions of typeset glyphs – the lookup API over what the engine
// capture records (RTX_SRCPOS, "Source positions").
// No Node APIs: runs in a page next to the viewer.
//
// Addressing. A glyph is named by the content item that holds it and its
// ordinal among that item's glyphs:
//   item  'c<i>'     the i-th item (0-based) of the document's content
//         's<k>.<i>' the i-th item of stream k (0-based; footnotes are streams)
//   glyph the glyph's index in depth-first order over the item's nodes – a
//         paragraph item's paragraph nodes, a display item's box – visiting a
//         node, then its children, pre, post, replace lists, then its leader
//         (src/shared/tree.ts's walk). The hyphen of a discretionary counts.
// The encoder keeps content items, streams and every glyph in that order
// (it drops other nodes and renumbers paragraphs, which is why items, not
// paragraph numbers, are the key), so the same address names the same glyph
// in the viewer's decoded document: locateGlyph() finds it from a node object
// the viewer draws.

import { walk } from './rtx/shared/tree.ts';

type J = Record<string, any>;

export interface SourcePosition {
  file: string;           // as TeX opened it: "input.tex", "chapter1.tex"
  line: number;           // 1-based
  column: number;         // 0-based, in code points of that line
  length: number;         // source characters the glyph stands for (ﬁ: 2, “ for ``: 2; 0: a break point)
  viaMacro: boolean;      // a macro made the glyph: the position is the macro call's
}

export interface GlyphAddress { item: string; glyph: number }

/** The sidecar the capture's output.json yields (compact, for a page to load
 *  next to the viewer's data): per item, 5 numbers per glyph – file index,
 *  line, column, length, via – or file -1 where nothing is known. */
export interface SourceMap { v: 1; files: string[]; items: Record<string, number[]>;
  /** per item: [glyph count, shapeSum] – the glyph-order invariant is checked against the
   *  viewer's document before an address is used (sourcemap-guard.ts) */
  checks?: Record<string, [number, number]> }

const glyphsOf = (nodes: J[]): J[] => {
  const out: J[] = [];
  walk(nodes, (n: J) => { if (n.type === 'glyph') out.push(n); });
  return out;
};

// A paragraph's nodes as captured: the viewer substitutes slot text (numbers,
// \webtext) in place, keeping TeX's list as its slotParas[].orig (a display's
// box as its slotDisplays[].orig), and the map's glyph ordinals count TeX's
// glyphs. With the substituted list every glyph after a changed number would
// be off by the difference in length.
const paraNodes = (doc: J, para: J): J[] => (doc.slotParas?.find((sp: J) => sp.para === para)?.orig ?? para?.nodes ?? []);
const boxOf = (doc: J, it: J): J | undefined => doc.slotDisplays?.find((sd: J) => sd.item === it)?.orig ?? it.box;
const itemNodes = (doc: J, it: J): J[] =>
  it.kind === 'paragraph' ? paraNodes(doc, doc.paragraphs[it.para - 1]) : it.box ? [boxOf(doc, it)] : [];

function* items(doc: J): Generator<[string, J]> {
  for (let i = 0; i < (doc.content ?? []).length; i++) yield [`c${i}`, doc.content[i]];
  const streams = doc.streams ?? [];
  for (let k = 0; k < streams.length; k++) {
    const c = streams[k].content ?? [];
    for (let i = 0; i < c.length; i++) yield [`s${k}.${i}`, c[i]];
  }
}

/** A 16-bit checksum of a glyph list's shape that the encoder keeps: where the font changes from
 *  one glyph to the next (it renumbers fonts and rewrites characters, so neither is kept itself). */
export function shapeSum(gs: J[]): number {
  let h = gs.length & 0xFFFF;
  for (let k = 1; k < gs.length; k++) if (gs[k].font !== gs[k - 1].font) h = (h * 31 + k) & 0xFFFF;
  return h;
}
/** the glyphs of item `key` of a document (output.json or the viewer's), in address order */
export function itemGlyphs(doc: J, key: string): J[] | null {
  for (const [k, it] of items(doc)) if (k === key) return glyphsOf(itemNodes(doc, it));
  return null;
}

/** output.json (with `src` on glyphs and `source_files`) → the sidecar. */
export function buildSourceMap(out: J): SourceMap {
  const map: SourceMap = { v: 1, files: out.source_files ?? [], items: {}, checks: {} };
  for (const [key, it] of items(out)) {
    const gs = glyphsOf(itemNodes(out, it));
    if (!gs.length) continue;
    const a: number[] = [];
    for (const g of gs) {
      if (g.src) a.push(g.src[0], g.src[1], g.src[2], g.src[3], g.src[4] ? 1 : 0);
      else a.push(-1, 0, 0, 0, 0);
    }
    map.items[key] = a;
    map.checks![key] = [gs.length, shapeSum(gs)];
  }
  return map;
}

/** Where the glyph came from, or null. */
export function sourcePositionFor(map: SourceMap, at: GlyphAddress): SourcePosition | null {
  const a = map.items[at.item];
  const o = at.glyph * 5;
  if (!a || o < 0 || o + 5 > a.length || a[o] < 0) return null;
  return { file: map.files[a[o]], line: a[o + 1], column: a[o + 2], length: a[o + 3], viaMacro: a[o + 4] === 1 };
}

/** The glyphs typeset from a source position (the caret in an editor): the
 *  ones whose characters span the column, or – when none does, as for a
 *  character a macro made – the ones placed at that macro call. */
export function nodesForSourcePosition(map: SourceMap, file: string, line: number, column: number): (GlyphAddress & { viaMacro: boolean })[] {
  const f = map.files.indexOf(file);
  if (f < 0) return [];
  const exact: (GlyphAddress & { viaMacro: boolean })[] = [], via: typeof exact = [];
  for (const [item, a] of Object.entries(map.items)) {
    for (let o = 0, g = 0; o < a.length; o += 5, g++) {
      if (a[o] !== f || a[o + 1] !== line) continue;
      const c = a[o + 2], len = a[o + 3];
      if (a[o + 4] === 1) { if (c === column) via.push({ item, glyph: g, viaMacro: true }); }
      else if (len > 0 && column >= c && column < c + len) exact.push({ item, glyph: g, viaMacro: false });
    }
  }
  return exact.length ? exact : via;
}

/** Viewer side: the address of a node object in the viewer's decoded
 *  document (the viewer's Block.document; the node a click hit, e.g. from
 *  Segment.walk's sink.node), or null. */
// through one index per document, made by one walk (it walked the whole tree per glyph: a block's caret map
// was quadratic, 3.5 s of main thread on a wheel pass down the former sample paper). A node the index lacks (the document
// changed since) makes it again, at most once per task.
export function locateGlyph(doc: J, node: J): GlyphAddress | null {
  return cachedGlyphIndex(doc, node).get(node) ?? null;
}
const indexes = new WeakMap<J, { index: Map<J, GlyphAddress>; fresh: boolean }>();
/** glyphIndex(doc), kept per document; made again (once per task) when asked for a node it lacks */
export function cachedGlyphIndex(doc: J, node?: J): Map<J, GlyphAddress> {
  let c = indexes.get(doc);
  if (c && (node === undefined || c.index.has(node) || c.fresh)) return c.index;
  c = { index: glyphIndex(doc), fresh: true };
  indexes.set(doc, c);
  const entry = c;
  queueMicrotask(() => { entry.fresh = false; });
  return c.index;
}

/** A position as an offset into a text – a block's own source when it was
 *  compiled inside a wrapper, starting at wrapper line `firstLine`: UTF-16
 *  index, as JavaScript strings count. -1 outside the text. */
// the text's lines and their offsets, kept for the last text asked about: a block's caret map asks
// once per glyph of the same text (it split the whole text each time: O(glyphs × text), 100 ms on a long paragraph)
let linesMemo: { text: string; lines: string[]; starts: number[]; astral: (boolean | undefined)[] } | null = null;
function linesOf(text: string) {
  if (linesMemo?.text !== text) {
    const lines = text.split('\n'), starts: number[] = [];
    let off = 0;
    for (const l of lines) { starts.push(off); off += l.length + 1; }
    linesMemo = { text, lines, starts, astral: [] };
  }
  return linesMemo;
}
export function toSourceOffset(pos: SourcePosition, text: string, firstLine = 1): number {
  const m = linesOf(text);
  const l = pos.line - firstLine;
  if (l < 0 || l >= m.lines.length) return -1;
  const line = m.lines[l];
  // columns count code points: a line without astral characters counts them as UTF-16 units
  const astral = m.astral[l] ??= /[\uD800-\uDBFF]/.test(line);
  if (!astral) return pos.column > line.length ? -1 : m.starts[l] + pos.column;
  const cps = [...line];
  if (pos.column > cps.length) return -1;
  return m.starts[l] + cps.slice(0, pos.column).join('').length;
}

/** every glyph node of a document → its address */
export function glyphIndex(doc: J): Map<J, GlyphAddress> {
  const index = new Map<J, GlyphAddress>();
  for (const [item, it] of items(doc)) glyphsOf(itemNodes(doc, it)).forEach((g, i) => index.set(g, { item, glyph: i }));
  return index;
}

/** The legacy shape a block editor asks for (contracts.d.ts sourceMap):
 *  `{ glyphs: [source offset | -1, …] }`, one entry per glyph in the order
 *  given – which is the viewer's drawing order: pass the node objects as the
 *  viewer draws them (Segment.walk's sink.node, glyph nodes only) and the
 *  viewer document they belong to. Offsets are into `blockText`, the block's
 *  own source, which sits at `firstLine` of the compiled file `file`. */
export function blockGlyphOffsets(map: SourceMap, doc: J, drawn: J[], blockText: string,
                                  where: { file?: string; firstLine?: number } = {}): { glyphs: number[] } {
  const index = indexFor(doc, drawn);
  return {
    glyphs: drawn.map(n => {
      const at = index.get(n);
      const p = at && sourcePositionFor(map, at);
      if (!p || p.viaMacro || (where.file && p.file !== where.file)) return -1;
      return toSourceOffset(p, blockText, where.firstLine ?? 1);
    }),
  };
}

/** The glyph nodes of a block in the order the viewer draws them (its
 *  segments in order, each line by line, as the viewer's Segment.walk gives
 *  them: the host API's Block.segments()) – the order the legacy
 *  `sourceMap.glyphs` expects. Segments not laid out yet (far below the
 *  fold) are skipped. */
export function drawnGlyphs(segments: readonly { walk(sink: { node?(n: J): void }): boolean }[]): J[] {
  const out: J[] = [];
  for (const sg of segments) sg.walk({ node(n: J) { if (n.type === 'glyph') out.push(n); } });
  return out;
}

/** the document's cached index, made again (once per task) when one of `drawn` is not in it */
export function indexFor(doc: J, drawn: J[]): Map<J, GlyphAddress> {
  const index = cachedGlyphIndex(doc);
  const lost = drawn.find((n) => !index.has(n));
  return lost === undefined ? index : cachedGlyphIndex(doc, lost);
}
