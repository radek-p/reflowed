// MOTION units (Node, no browser):
//  - motion/place.js: the popover's final place (the scroll), its rules one by one;
//  - engine-api toSourceOffset with its line memo: the same answers as the old one (it split the whole text per call);
//  - engine-api locateGlyph in a display whose box the viewer substituted (live text in a tag): TeX's ordinals.
//   node tests/test-motion-units.ts
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p: string) => import(pathToFileURL(join(HERE, p)).href);
const { place, closeAnchor, POP_MARGIN, FLOW_MARGIN, CARET_TOP, TOP_MARGIN } = await imp('app/src/motion/place.js');
const { toSourceOffset, locateGlyph, blockGlyphOffsets } = await imp('engine/api/src/sourcemap.ts');

let failed = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) failed++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };

// ── place() ──
const box = { top: 56, bottom: 900, origin: 0 };
const range = { min: -5000, max: 5000 };
const sp = (top: number, h: number) => ({ top, bottom: top + h });
{
  // a small block in the middle: nothing to do
  const dy = place({ box, render: sp(300, 80), pop: sp(392, 100), caret: sp(310, 20), float: false, range });
  check('in flow, all on screen: no scroll', dy === 0, { dy });
}
{
  // near the bottom: the popover would reach past the edge → scrolled just enough
  const dy = place({ box, render: sp(700, 80), pop: sp(792, 150), caret: sp(710, 20), float: false, range });
  check('in flow, the popover past the bottom: scrolled so its bottom is FLOW_MARGIN above the edge', dy === 792 + 150 - (900 - FLOW_MARGIN), { dy });
}
{
  // the block moved in the new layout (an editor above closed): the base keeps it where it was
  const dy = place({ box, render: sp(200, 80), pop: sp(292, 100), caret: sp(210, 20), float: false, base: -120, range });
  check('in flow: the base (the block kept where it was seen) when nothing else is needed', dy === -120, { dy });
}
{
  // the caret above the pane (block partly scrolled out at the top, caret at its start)
  const dy = place({ box, render: sp(10, 200), pop: sp(222, 100), caret: sp(14, 20), float: false, range });
  check('in flow: a caret above the pane: scrolled back up to show it (and the whole block, as it fits)', dy === Math.min(14 - (56 + CARET_TOP), 10 - (56 + TOP_MARGIN)), { dy });
}
{
  // block + popover taller than the pane: the caret wins over the popover's bottom
  const dy = place({ box, render: sp(100, 500), pop: sp(612, 400), caret: sp(120, 20), float: false, range });
  check('in flow, too tall: the caret stays visible (it wins over the popover\'s bottom)', 120 - dy >= 56 + CARET_TOP - 0.01, { dy });
}
{
  // float: the caret low, under where the popover sits → kept at 30 % of the room
  const room = 900;
  const dy = place({ box, render: sp(-300, 1600), pop: sp(1312, 300), caret: sp(800, 20), float: true, range });
  check('float, the caret under the popover: put at 30 % of the room (keepCaretInView\'s rule)', Math.abs(dy - (800 - room * 0.3)) < 0.01, { dy });
  // after that, keepCaretInView's own test passes (nothing would correct it)
  const popTop = Math.min(1312 - dy, 900 - POP_MARGIN - 300);
  check('float: then the caret is above the popover and in the upper half', 800 - dy >= 56 && 820 - dy <= Math.min(room / 2, popTop - 8), { popTop });
}
{
  const dy = place({ box, render: sp(-300, 1600), pop: sp(1312, 300), caret: sp(200, 20), float: true, range });
  check('float, the caret already high: no scroll', dy === 0, { dy });
}
{
  const dy = place({ box, render: sp(700, 80), pop: sp(792, 150), caret: sp(710, 20), float: false, range: { min: -10, max: 20 } });
  check('the scroll is clamped to what the pane can do', dy === 20, { dy });
}

// ── closeAnchor(): A + B < D moves the top part down; otherwise the top stays ──
{
  const b = { top: 56, bottom: 900 };     // A = render.top - 56; B = the preview seen above the popover; D = 900 - pop.bottom
  check('close: A + B < D (the block near the top): what is below the popover stays', closeAnchor({ box: b, render: sp(100, 100), pop: sp(208, 200) }) === 'below');
  check('close: A + B > D (the block low): the top stays', closeAnchor({ box: b, render: sp(500, 100), pop: sp(608, 200) }) === 'above');
  check('close: A + B = D: the top stays', closeAnchor({ box: b, render: sp(256, 100), pop: sp(356, 244) }) === 'above');
  check('close: within 1 px counts as equal (the top stays); 1.5 px less: the top moves', closeAnchor({ box: b, render: sp(255.6, 100), pop: sp(355.6, 244) }) === 'above' && closeAnchor({ box: b, render: sp(255.25, 100), pop: sp(355.25, 244) }) === 'below');
  check('close: only the visible part counts: B past the top edge (A = 0, B clipped)', closeAnchor({ box: b, render: sp(-500, 700), pop: sp(200, 300) }) === 'below');
  check('close: the preview under a floating popover does not count (B ends at the popover)', closeAnchor({ box: b, render: sp(-100, 1200), pop: sp(600, 290) }) === 'above' && closeAnchor({ box: b, render: sp(60, 1200), pop: sp(200, 290) }) === 'below');
  check('close: the popover past the bottom edge (D = 0): the top stays', closeAnchor({ box: b, render: sp(700, 100), pop: sp(808, 300) }) === 'above');
  check('close: no preview shown (B = 0, A to the popover)', closeAnchor({ box: b, render: null, pop: sp(100, 200) }) === 'below' && closeAnchor({ box: b, render: null, pop: sp(600, 200) }) === 'above');
}

// ── locating glyphs walks the document once (it walked the whole tree per glyph: quadratic) ──
{
  let reads = 0;
  const doc = (n: number) => {
    const nodes = Array.from({ length: n }, (_, i) => ({ get type() { reads++; return 'glyph'; }, char: 97 + (i % 26), font: 1 }));
    return { d: { content: [{ kind: 'paragraph', para: 1 }], paragraphs: [{ nodes }] }, nodes };
  };
  const cost = (n: number) => {
    const { d, nodes } = doc(n);
    reads = 0;
    let found = 0;
    for (const g of nodes) if (locateGlyph(d, g)?.glyph === nodes.indexOf(g)) found++;
    return { reads, found };
  };
  const a = cost(500), b = cost(2000);
  check('locateGlyph: every glyph found, with one walk of the document (reads ~ glyphs, not glyphs²)', a.found === 500 && b.found === 2000 && a.reads <= 2 * 500 && b.reads <= 2 * 2000, { a, b });
  // a node the index lacks (the document changed): found after one new walk; another miss in the same task walks no more
  const { d, nodes } = doc(300);
  locateGlyph(d, nodes[0]);
  const extra = { type: 'glyph', char: 120, font: 1 };
  d.paragraphs[0].nodes.push(extra);
  await Promise.resolve();
  reads = 0;
  const at = locateGlyph(d, extra), r1 = reads, none = locateGlyph(d, { type: 'glyph' }), r2 = reads;
  check('locateGlyph: a node added later is found (one new walk); a node not in it walks no more in that task', at?.glyph === 300 && none === null && r1 <= 2 * 301 && r2 === r1, { at, r1, r2 });
  const map = { v: 1, files: ['b.tex'], items: { c0: Array.from({ length: 301 }, (_, i) => [0, 1, i, 1, 0]).flat() } };
  reads = 0;
  const offs = blockGlyphOffsets(map, d, d.paragraphs[0].nodes, 'x'.repeat(400), { file: 'b.tex', firstLine: 1 });
  check('blockGlyphOffsets: the cached index (no walk when every drawn glyph is in it)', offs.glyphs.length === 301 && offs.glyphs[5] === 5 && reads <= 301, { reads, g5: offs.glyphs[5] });
}

// ── a display whose box holds live text: glyphs are addressed in TeX's box, not the viewer's ──
{
  // the viewer put two words in place of an equation tag's number "1" (reflowtex host/slots.ts),
  // keeping TeX's box in doc.slotDisplays; the ")" after it is still TeX's third glyph
  const g = (char: number) => ({ type: 'glyph', char, font: 1 });
  const open = g(40), one = { ...g(49), slot: 1 }, close = g(41);
  const orig = { type: 'hlist', children: [open, one, close] };
  const item: any = { kind: 'display', box: orig };
  const made = [{ type: 'glyph', text: '12', font: 1, slot: 1 }, { type: 'glyph', text: 'a', font: 1, slot: 1 }];
  item.box = { type: 'hlist', children: [open, ...made, close] };
  const d = { content: [item], paragraphs: [], slotDisplays: [{ owner: item, item, orig, made }] };
  check('locateGlyph: in a display whose box the viewer substituted, a glyph after the slot keeps its ordinal in TeX\'s box',
    locateGlyph(d, close)?.glyph === 2 && locateGlyph(d, open)?.glyph === 0, [locateGlyph(d, open), locateGlyph(d, close)]);
}

// ── toSourceOffset: the line memo gives the old answers ──
function oldOffset(pos: any, text: string, firstLine = 1) {
  const lines = text.split('\n');
  const l = pos.line - firstLine;
  if (l < 0 || l >= lines.length) return -1;
  let off = 0;
  for (let i = 0; i < l; i++) off += lines[i].length + 1;
  const cps = [...lines[l]];
  if (pos.column > cps.length) return -1;
  return off + cps.slice(0, pos.column).join('').length;
}
{
  const texts = ['first line\nsecond', '', 'one', 'a\n\nb\nccc\n', 'math $\\alpha$ 𝔸𝔹 and 😀 here\nnext 𝒳 line\nplain', '\n\n\n'];
  let bad = '', count = 0;
  for (const t of texts) for (const first of [1, 4]) for (let line = first - 1; line < first + 6; line++) for (let column = 0; column < 30; column++) {
    const p = { file: 'x', line, column }, a = toSourceOffset(p, t, first), b = oldOffset(p, t, first);
    count++;
    if (a !== b && !bad) bad = `${JSON.stringify(t)} line ${line} col ${column}: ${a} vs ${b}`;
  }
  // texts alternating (two blocks asked about in turn)
  for (let k = 0; k < 50; k++) { const t = texts[k % texts.length]; const p = { file: 'x', line: 1 + (k % 3), column: k % 7 }; if (toSourceOffset(p, t, 1) !== oldOffset(p, t, 1) && !bad) bad = `alternating ${k}`; count++; }
  check(`toSourceOffset: the memoised one equals the old one (${count} positions, astral characters too)`, !bad, bad);
}

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
