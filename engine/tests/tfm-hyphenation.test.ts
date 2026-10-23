// Hyphenation of 8-bit (TFM) text (patch 0011 + engine-api tfm-hyphenation.ts):
// TeX inserts its discretionaries only in line_break's second pass, after the capture writes the
// paragraph, so a T1/OT1 paragraph had none and never hyphenated in the reader. Now each word of a
// T1 and an OT1 paragraph has a discretionary at every point TeX's own hyphenation gives it
// (\showhyphens on the same words is the reference), ligatures split at a point ("dif-fi-cult"),
// and the hyphen's position is the break point.
//   node tests/tfm-hyphenation.test.ts
import { engine, EXTRA } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';

type J = Record<string, any>;
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const e = await engine('async');
e.setExtraFiles(EXTRA);
let warmFor = '';
const warm = (pre: string) => {
  if (warmFor === pre) return;
  e.reset(); e.addFile('input.tex', buildHost(pre).main);
  if (!e.warm('input.tex').ok) throw new Error('preamble does not warm');
  warmFor = pre;
};
const LIGS: Record<string, Record<number, string>> = {
  T1: { 0x1b: 'ff', 0x1c: 'fi', 0x1d: 'fl', 0x1e: 'ffi', 0x1f: 'ffl' },
  OT1: { 0x0b: 'ff', 0x0c: 'fi', 0x0d: 'fl', 0x0e: 'ffi', 0x0f: 'ffl' },
};
const WORDS = ['hyphenation', 'typographical', 'computational', 'difficult', 'efficient', 'affine', 'transformations', 'representation', 'paragraphs', 'reflowable'];

for (const enc of ['T1', 'OT1'] as const) {
  const pre = `\\documentclass{article}\n\\usepackage[${enc}]{fontenc}\n\\usepackage{lmodern}`;
  warm(pre);
  // the reference: TeX's own points (\showhyphens: one underfull line per word, "hy-phen-ation")
  // (one word a run: the log wraps long lines)
  const shown = WORDS.map((w) => {
    e.runBlock(blockFile(`\\showhyphens{${w}}`).text);
    const log = e.text('input.log');
    return /\/10 ([a-z-]+)/.exec(log.slice(log.lastIndexOf('(rtx-block.tex')))?.[1] ?? '';
  });
  check(`${enc}: TeX's \\showhyphens gives the reference for every word`, WORDS.every((w) => shown.some((s) => s.replace(/-/g, '') === w)), shown.join(' '));

  // the capture: the same words in a paragraph
  const src = WORDS.join(' ') + '.';
  e.runBlock(blockFile(src).text);
  const out = capture(e, () => null).output;
  const para = out.paragraphs?.[0]?.nodes ?? [];
  const text = (n: J): string => (n.type === 'glyph' ? LIGS[enc][n.char] ?? String.fromCharCode(n.char) : '');
  let s = '', discs = 0, hyphenSrc = true;
  for (const n of para) {
    if (n.type === 'glyph') s += text(n);
    else if (n.type === 'glue') s += ' ';
    else if (n.type === 'disc' && n.pre?.length) {
      discs++;
      // a split ligature: its letters in pre (before the hyphen) and post; else the point between nodes
      s += n.post?.length ? n.pre.slice(0, -1).map(text).join('') + '-' + n.post.map(text).join('') : '-' + n.replace.map(text).join('');
      const h = n.pre[n.pre.length - 1];
      if (!h?.src || h.src[3] !== 0) hyphenSrc = false;
    }
  }
  const got = s.trim().replace(/\.$/, '').split(/\s+/);
  check(`${enc}: the paragraph has discretionaries (${discs})`, discs > 0);
  for (const w of WORDS) {
    const ref = shown.find((x) => x.replace(/-/g, '') === w) ?? '';
    const ours = got.find((x) => x.replace(/-/g, '') === w) ?? '(missing)';
    check(`${enc}: ${w}: the points TeX gives (${ref})`, ours === ref, ours);
  }
  check(`${enc}: each discretionary's hyphen is at the break point (length 0)`, hyphenSrc);
  // a ligature split at a point: "dif-fi-cult" (ff+i or ffi in the font)
  const lig = para.find((n: J) => n.type === 'disc' && n.replace?.some((r: J) => LIGS[enc][r.char]?.length > 1) && n.post?.length);
  check(`${enc}: a ligature over a point goes to replace, its letters split into pre and post`, !!lig, '');
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
