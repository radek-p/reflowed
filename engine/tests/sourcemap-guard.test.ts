// The glyph-order guard: a source map's per-item check against the viewer's document.
// The same glyphs: addresses used; a glyph dropped, glyphs reordered across fonts: the item's
// addresses give nothing and the mismatch is counted; a map without checks: used as before.
//   node tests/sourcemap-guard.test.ts
import { buildSourceMap } from '../api/src/sourcemap.ts';
import { guardStats, guardedBlockGlyphOffsets, guardedLocate } from '../api/src/sourcemap-guard.ts';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
type J = Record<string, any>;
const g = (ch: string, font: number, col: number): J => ({ type: 'glyph', char: ch.codePointAt(0), font, src: [0, 1, col, 1, 0] });
const doc = (glyphs: J[]): J => ({ source_files: ['b.tex'], content: [{ kind: 'paragraph', para: 1 }], paragraphs: [{ nodes: glyphs }] });
// the capture: "ab" in font 1, "x" in font 2, "cd" in font 1
const out = doc([g('a', 1, 0), g('b', 1, 1), g('x', 2, 3), g('c', 1, 5), g('d', 1, 6)]);
const map = buildSourceMap(out);
check('the map carries a check per item', Array.isArray(map.checks?.c0) && map.checks!.c0[0] === 5, JSON.stringify(map.checks));

// the viewer's document: the encoder renumbers fonts and rewrites characters, keeping every glyph in order
const view = doc([g('A', 7, 0), g('B', 7, 0), g('X', 9, 0), g('C', 7, 0), g('D', 7, 0)]);
const before = guardStats.mismatches;
check('the same glyphs (fonts renumbered, characters rewritten): the address is used', guardedLocate(map, view, view.paragraphs[0].nodes[3])?.glyph === 3);
check('… and no mismatch counted', guardStats.mismatches === before);

const dropped = doc([g('A', 7, 0), g('X', 9, 0), g('C', 7, 0), g('D', 7, 0)]);
check('a glyph dropped: no address (the caller falls back to fuzzy)', guardedLocate(map, dropped, dropped.paragraphs[0].nodes[2]) === null);
check('… and the mismatch counted', guardStats.mismatches === before + 1, guardStats.last);

const reordered = doc([g('A', 7, 0), g('X', 9, 0), g('B', 7, 0), g('C', 7, 0), g('D', 7, 0)]);
check('glyphs reordered across a font change: no address', guardedLocate(map, reordered, reordered.paragraphs[0].nodes[4]) === null);
const offs = guardedBlockGlyphOffsets(map, reordered, reordered.paragraphs[0].nodes, 'ab x cd').glyphs;
check('… and no offsets for the item\'s drawn glyphs', offs.every((o) => o === -1), JSON.stringify(offs));
const okOffs = guardedBlockGlyphOffsets(map, view, view.paragraphs[0].nodes, 'ab x cd').glyphs;
check('the matching document: its offsets', JSON.stringify(okOffs) === '[0,1,3,5,6]', JSON.stringify(okOffs));

const old = { ...map, checks: undefined };
check('a map without checks (an older build): used as before', guardedLocate(old, dropped, dropped.paragraphs[0].nodes[1])?.glyph === 1);

check('no map at all (a fuzzy result): no address, no error', guardedLocate(undefined, view, view.paragraphs[0].nodes[0]) === null);

console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
