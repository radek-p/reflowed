// Source positions of 8-bit (TFM) text through the editor engine (Node):
// every typeset text glyph has an exact position in the block, and it is the
// right one (the source there spells the glyph). T1 Latin Modern (ec-lm*) and
// OT1 Computer Modern; ligatures (ff fi fl ffi ffl, -- ``), kerning, accents,
// \char, words the line breaker hyphenated (rebuilt by reconstitute), a long
// paragraph with \emph and \textbf.
//   node tests/positions.test.ts
import { engine, TC, EXTRA } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
import { walk } from '../build/engine-api-src/rtx/shared/tree.ts';

type J = Record<string, any>;
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
void TC;

const T1_LIGS: Record<number, string> = { 0x1b: 'ff', 0x1c: 'fi', 0x1d: 'fl', 0x1e: 'ffi', 0x1f: 'ffl', 0x15: '--', 0x16: '---', 0x10: '``', 0x11: "''" };
const OT1_LIGS: Record<number, string> = { 0x0b: 'ff', 0x0c: 'fi', 0x0d: 'fl', 0x0e: 'ffi', 0x0f: 'ffl', 0x7b: '--', 0x7c: '---', 0x5c: '``', 0x22: "''" };

interface G { ch: string; font: string; src?: number[]; file?: string; text?: string; hyphen?: boolean }

const e = await engine('async');
e.setExtraFiles(EXTRA);
let warmFor = '';
function typeset(preamble: string, source: string): G[] {
  if (warmFor !== preamble) {
    e.reset(); e.addFile('input.tex', buildHost(preamble).main);
    if (!e.warm('input.tex').ok) throw new Error('preamble does not warm: ' + preamble + '\n' + e.text('input.log').slice(-1500));
    warmFor = preamble;
  }
  const f = blockFile(source);
  const r = e.runBlock(f.text);
  if (r.status > 1) throw new Error('block failed: ' + e.text('input.log').slice(-800));
  const out = capture(e, () => null).output;
  const lines = f.text.split('\n');
  const fonts: J[] = out.fonts ?? [];
  const t1 = (name: string) => /^ec-/.test(name);
  const gs: G[] = [];
  const visit = (nodes: J[]) => walk(nodes, (n: J, path: string) => {
    if (n.type !== 'glyph') return;
    const font = fonts[n.font]?.name ?? '';
    const lig = (t1(font) ? T1_LIGS : OT1_LIGS)[n.char];
    const ch = lig ?? String.fromCharCode(n.char);
    const g: G = { ch, font, src: n.src, hyphen: n.char === 45 && (/\.pre\[\d+\]$/.test(path) || n.src?.[3] === 0) };
    if (n.src) {
      g.file = out.source_files[n.src[0]];
      const cps = [...(lines[n.src[1] - 1] ?? '')];
      g.text = cps.slice(n.src[2], n.src[2] + Math.max(1, n.src[3])).join('');
    }
    gs.push(g);
  });
  for (const it of out.content ?? []) if (it.kind === 'paragraph') visit(out.paragraphs[it.para - 1].nodes); else if (it.box) visit([it.box]);
  return gs;
}

const SYM = /^(cmsy|lmsy|cmex|lmex|msam|msbm)/;
const exactRight = (g: G) => !!g.src && !g.src[4] && g.file === 'rtx-block.tex' && g.text === g.ch;
const describe = (g: G) => `"${g.ch}"(${g.font}) ${g.src ? `${g.file}:${g.src[1]}:${g.src[2]}+${g.src[3]}${g.src[4] ? ' via' : ''} "${g.text}"` : 'no position'}`;
/** the letters, digits and their ligatures: each exact and right */
function allRight(what: string, gs: G[], filter = (g: G) => /^[A-Za-z0-9]+$|^(--|---|``|'')$/.test(g.ch) && !g.hyphen) {
  const bad = gs.filter(filter).filter((g) => !exactRight(g));
  const n = gs.filter(filter).length;
  check(`${what}: ${n - bad.length}/${n} text glyphs at their own characters`, n > 0 && !bad.length, bad.slice(0, 6).map(describe).join('; '));
}

const T1 = '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}';
const OT1 = '\\documentclass{article}\n\\usepackage[OT1]{fontenc}';

// 1. ligatures: one glyph, the span of its letters
{
  const gs = typeset(T1, 'office affine fluffy difficult baffle -- `quoted\'\' --- done');
  allRight('T1 ligatures', gs);
  const ffi = gs.find((g) => g.ch === 'ffi');
  check('T1: "ffi" is one glyph spanning 3 source characters', !!ffi && ffi.src?.[3] === 3 && ffi.text === 'ffi', ffi ? describe(ffi) : 'no ffi glyph');
  const en = gs.find((g) => g.ch === '--');
  check('T1: "--" is one glyph spanning 2', !!en && en.src?.[3] === 2, en ? describe(en) : 'no en dash');
}
// 2. kerning: kerns between, glyphs at their own columns
{
  const gs = typeset(T1, 'AVAWAY To Tea WAVE Yo');
  allRight('T1 kerning', gs);
}
// 3. a paragraph in TFM text: \emph, \textbf, braces, line breaks in the source
{
  const gs = typeset(T1, 'Register automata are a classical model for languages over infinite alphabets;\n'
    + 'we show that \\emph{scoped} monadic second-order logic, \\textbf{data regular expressions}\n'
    + 'and {\\itshape nondeterministic} register automata are equivalent, with effective translations.');
  allRight('T1 paragraph (\\emph, \\textbf, \\itshape, line breaks)', gs);
}
// 4. hyphenation: words the line breaker rebuilt (reconstitute: a box's lines,
//    captured after the break) keep their positions; the hyphen is a break point
{
  const words = 'characterization incomprehensibilities officially effectiveness';
  allRight('T1 words of a paragraph (captured before the break)', typeset(T1, '\\hsize=4em \\noindent ' + words));
  const gs = typeset(T1, '\\parbox{3em}{\\hspace{0pt}' + words + '}');
  allRight('T1 hyphenated words in a box', gs);
  const hy = gs.filter((g) => g.hyphen);
  check(`T1: hyphens at break points (${hy.length})`, hy.length > 2 && hy.every((h) => h.src && h.src[3] === 0 && !h.src[4]), hy.slice(0, 4).map(describe).join('; '));
}
// 5. \char and \symbol: the command's position
{
  const gs = typeset(T1, 'x\\char65 y');
  const a = gs.find((g) => g.ch === 'A');
  check('T1: \\char65 placed at \\char', !!a?.src && !a.src[4] && a.text === '\\', a ? describe(a) : 'no A');
}
//    \csname): via, at the accent command, spanning the call with its argument.
//    OT1: \accent – the accentee is the letter's own, the accent the command's.
{
  const src = 'caf\\\'e na\\"\\i ve \\c{c}a r\\^{o}le';
  const gs = typeset(T1, src);
  allRight('T1 accents: the other letters', gs, (g) => /^[a-z]$/.test(g.ch) && g.font.startsWith('ec-'));
  for (const [ch, call] of [['é', "\\'e"], ['ï', '\\"\\i'], ['ç', '\\c{c}'], ['ô', '\\^{o}']]) {
    const g = gs.find((x) => x.ch === ch);
    const span = g?.src ? [...src].slice(g.src[2], g.src[2] + g.src[3]).join('') : '';
    check(`T1: ${ch} (${call}) via its call, spanning it`, !!g?.src && !!g.src[4] && g.file === 'rtx-block.tex' && span === call, g ? describe(g) + ` span "${span}"` : 'no glyph');
  }
  const o = typeset(OT1, 'na\\"ive r\\^ole');
  allRight('OT1 \\accent: the accentee and the other letters', o);
  const acc = o.filter((g) => g.ch === '\x7f' || g.ch === '\x5e');
  check(`OT1: the accents at their commands (${acc.length})`, acc.length === 2 && acc.every((g) => !!g.src?.[4] && g.text?.startsWith('\\')), acc.map(describe).join('; '));
}
// 7. OT1 Computer Modern text
{
  allRight('OT1 paragraph', typeset(OT1, 'The fluffy office --- efficient, affine and difficult; ``quoted\'\'.'));
}

// 8. a file opened after a page was shipped (SyncTeX, off, turned itself off at
//    the first shipout and every later file had tag 0: no positions): the .bbl
//    of a \bibliography after a \clearpage
{
  e.setExtraFiles({ ...EXTRA, 'input.bbl': '\\begin{thebibliography}{1}\n\\bibitem{a} Henrik Bj\\"orklund. Data words.\n\\end{thebibliography}\n' });
  warmFor = '';
  const gs = typeset(T1, 'Some text.\\clearpage\n\\bibliography{refs}');
  const bbl = gs.filter((g) => g.src && g.file === 'input.bbl' && !g.src[4] && /^[A-Za-z]$/.test(g.ch));
  check(`the .bbl after a shipout: its letters placed in it (${bbl.length})`, bbl.length >= 18, gs.filter((g) => /^[A-Z]$/.test(g.ch)).slice(0, 6).map(describe).join('; '));
  e.setExtraFiles(EXTRA); warmFor = '';
}
// 9. maths constructions: a radical's sign and a math accent at their
//    commands (via, spanning the call), not at the radicand or the nucleus;
//    an operator with limits at its command, spanning its name; the letters
//    and digits of nuclei, scripts, fractions and binomials their own
{
  const AMS = '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern,amsmath,amssymb}';
  const src = '$\\sqrt{y} + \\hat{a} + \\sum_{i=1}^n x_i + \\frac{c}{d} + \\binom{n}{k} + \\mathbb{N}$';
  const gs = typeset(AMS, src);
  const span = (g?: G) => (g?.src ? [...src].slice(g.src[2], g.src[2] + Math.max(1, g.src[3])).join('') : '');
  allRight('maths: letters and digits', gs, (g) => /^[a-zA-Z0-9]$/.test(g.ch) && !SYM.test(g.font));
  const rad = gs.find((g) => /sy/.test(g.font) && g.ch.charCodeAt(0) === 0x70);
  check('maths: \\sqrt\'s sign at \\sqrt (the radicand is read by TeX, not the macro)', !!rad?.src?.[4] && ['\\sqrt', '\\sqrt{y}'].includes(span(rad)), rad ? describe(rad) + ` span "${span(rad)}"` : 'no radical sign');
  const hat = gs.find((g) => /^rm-|^cmr|^lmr/.test(g.font) && g.ch === '^');
  check('maths: \\hat\'s accent at \\hat{a}', !!hat?.src?.[4] && span(hat) === '\\hat{a}', hat ? describe(hat) + ` span "${span(hat)}"` : 'no accent');
  const sum = gs.find((g) => /ex/.test(g.font) && (g.ch.charCodeAt(0) === 0x50 || g.ch.charCodeAt(0) === 0x58));
  check('maths: \\sum at \\sum', !!sum?.src && span(sum) === '\\sum', sum ? describe(sum) + ` span "${span(sum)}"` : 'no sum');
  // the sign after a peek (\@ifnextchar's \futurelet reads the next character from the file and
  // backs it up after \sqrt's lists have ended): a space before the radicand, an optional argument
  for (const s of ['$\\sqrt {y}$', '$\\sqrt[3]{y}$', '$a\\sqrt y$']) {
    const r = typeset(AMS, s).find((g) => /sy/.test(g.font) && g.ch.charCodeAt(0) === 0x70);
    const at = r?.src ? [...s].slice(r.src[2], r.src[2] + 5).join('') : '';
    check(`maths: \\sqrt's sign at \\sqrt in ${s}`, !!r?.src?.[4] && at === '\\sqrt', r ? describe(r) + ` at "${at}"` : 'no radical sign');
  }
}
// 10. text a package macro makes after a peek (\@ifnextchar, \@ifstar): at the call, not at the
//     peeked character (its body is the package's, so the glyphs are placed via the call)
{
  e.setExtraFiles({ ...EXTRA, 'rtxpeek.sty': '\\def\\pk{\\@ifnextchar[{X}{Y}}\\def\\st{\\@ifstar{S}{Z}}\n' });
  const line = 'ab \\pk cd \\st* ef \\st gh';
  const gs = typeset(T1 + '\n\\usepackage{rtxpeek}', line);
  for (const [ch, call, want] of [['Y', '\\pk', line.indexOf('\\pk')], ['S', '\\st*', line.indexOf('\\st*')], ['Z', '\\st', line.lastIndexOf('\\st')]] as const) {
    const g = gs.find((x) => x.ch === ch);
    check(`a peek: ${ch} at its call ${call}`, !!g?.src?.[4] && g.src[2] === want, g ? describe(g) : `no ${ch}`);
  }
  e.setExtraFiles(EXTRA); warmFor = '';
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
