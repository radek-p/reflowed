// Virtual fonts under XeTeX (fidelity/virtual-fonts.ts): XeTeX typesets with a virtual face (newtx's
// maths, ae's T1 over Computer Modern) and leaves its packets to the driver, so the capture held glyphs
// no font file draws (metric boxes in the editor). After the converter, each glyph is drawn from the
// fonts its packet names: newtx's α from NewTXMI, ae's é an acute and an e in a box where the packet
// puts them. Every glyph keeps its source position, and the source map counts the glyphs the output has.
//   node tests/virtual-fonts.test.ts
import { engine, EXTRA, fetchSync } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
import { itemMatches } from '../build/engine-api-src/sourcemap-guard.ts';
import { walk } from '../build/engine-api-src/rtx/shared/tree.ts';

type J = Record<string, any>;
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const e = await engine('async');
e.setExtraFiles(EXTRA);
/** One block: its glyphs as "face:char" in document order (boxes marked), the output and the source map. */
function run(preamble: string, source: string) {
  e.reset(); e.addFile('input.tex', buildHost(preamble).main);
  if (!e.warm('input.tex').ok) throw new Error('preamble does not warm: ' + e.text('input.log').slice(-1500));
  const r = e.runBlock(blockFile(source).text);
  const c = capture(e, (n) => fetchSync(0, n));
  const fonts = c.output.fonts as Record<string, J>;
  const glyphs: J[] = [], seen: string[] = [];
  for (const p of c.output.paragraphs) walk(p.nodes, (n: J) => {
    if (n.type === 'hlist' && n.subtype === 2 && n.children?.length) seen.push('[');
    if (n.type === 'glyph') { glyphs.push(n); seen.push(`${fonts[n.font]?.name}:${n.char.toString(16)}`); }
  });
  return { status: r.status, output: c.output, sourcemap: c.sourcemap, glyphs, seen: seen.join(' '), fonts };
}
const virtual = (name: string) => !!fetchSync(0, `${name}.vf`);

{
  const r = run('\\documentclass{article}\n\\usepackage{newtxtext,newtxmath}', 'Let $\\alpha+\\sum_i x_i \\leq \\infty, a=12$.');
  check('newtx: the block compiles', r.status <= 1);
  const inVirtual = r.glyphs.filter((g) => virtual(r.fonts[g.font].name));
  check('newtx: no glyph left in a virtual face', inVirtual.length === 0, [...new Set(inVirtual.map((g) => r.fonts[g.font].name))].join(' '));
  // slots, as LuaTeX's capture resolves them too (a [ opens a box: the virtual font's, or the formula's own
  // subscript box): α is NewTXMI's 0x55 moved 0.007 em right, so a box; + txsys's 0xb8; ∑ txexs's 0xcd; x and
  // the subscript i NewTXMI's and NewTXMI7's own; a moved, a box; the digits ntx-Regular-tlf-ot1r's
  const maths = r.seen.split(' ').filter((s) => !/^TeXGyreTermesX/.test(s)).join(' ');
  check('newtx: each maths glyph from the font its packet names', maths ===
    '[ NewTXMI:55 txsys:b8 txexs:cd NewTXMI7:38 NewTXMI:47 NewTXMI7:38 [ txsys:14 txsys:31 NewTXMI:96 [ NewTXMI:30 txmiaX:3d ntx-Regular-tlf-ot1r:31 ntx-Regular-tlf-ot1r:32', maths);
  check('newtx: every glyph keeps its source position', r.glyphs.every((g) => g.src), JSON.stringify(r.glyphs.filter((g) => !g.src).map((g) => g.char)));
}
{
  const r = run('\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{ae}', 'Caf\\\'e, na\\"ive.');
  check('ae: the block compiles', r.status <= 1);
  check('ae: é an acute and an e in a box, ï a dieresis (raised: a box in it) and a dotless i; the rest cmr10\'s own',
    r.seen === 'cmr10:43 cmr10:61 cmr10:66 [ cmr10:13 cmr10:65 cmr10:2c cmr10:6e cmr10:61 [ [ cmr10:7f cmr10:10 cmr10:76 cmr10:65 cmr10:2e', r.seen);
  const e1 = r.glyphs.filter((g) => g.char === 0x13 || g.char === 0x65).slice(0, 2);
  check('ae: the acute and its e share the source position of é', e1.length === 2 && JSON.stringify(e1[0].src) === JSON.stringify(e1[1].src), JSON.stringify(e1.map((g) => g.src)));
  const keys = Object.keys(r.sourcemap.checks ?? {});
  check('ae: the source map counts the glyphs the output has', keys.length > 0 && keys.every((k) => itemMatches(r.sourcemap, r.output, k)), JSON.stringify(r.sourcemap.checks));
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
