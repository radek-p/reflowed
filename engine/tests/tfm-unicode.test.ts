// Unicode letters in documents set in 8-bit (TFM) fonts (tex/rtx-tfm-unicode.sty): under XeTeX
// "ń" in a T1 document was a "Missing character" and vanished ("Gdańsk" printed "Gdask" in
// LIPIcs). Now every character LaTeX's tables (<enc>enc.dfu) name prints as pdfLaTeX prints it:
// ń, ł, ő, ř, ß, é – in an article/T1 block and in lipics-v2021 (the author in the preamble too),
// each glyph with a position at its own character; é stays a letter (its code is its T1 slot);
// a \label with ń works; a TU (native font) document is left alone.
//   node tests/tfm-unicode.test.ts
import { engine, EXTRA } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
import { walk } from '../build/engine-api-src/rtx/shared/tree.ts';

type J = Record<string, any>;
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const e = await engine('async');
e.setExtraFiles(EXTRA);
let warmFor = '';
function run(preamble: string, source: string): { glyphs: J[]; fonts: J[]; missing: string[]; status: number; log: string } {
  if (warmFor !== preamble) {
    e.reset(); e.addFile('input.tex', buildHost(preamble).main);
    if (!e.warm('input.tex').ok) throw new Error('preamble does not warm: ' + e.text('input.log').slice(-1500));
    warmFor = preamble;
  }
  const r = e.runBlock(blockFile(source).text);
  const log = e.text('input.log');
  const out = capture(e, () => null).output;
  const glyphs: J[] = [];
  for (const it of out.content ?? []) walk(it.kind === 'paragraph' ? out.paragraphs[it.para - 1].nodes : it.box ? [it.box] : [], (n: J) => { if (n.type === 'glyph') glyphs.push(n); });
  return { glyphs, fonts: out.fonts ?? [], missing: log.match(/Missing character[^\n]*/g) ?? [], status: r.status, log };
}
// T1 slots of the letters tested
const T1: Record<string, number> = { 'ń': 0xAB, 'ł': 0xAA, 'ő': 0xAE, 'ř': 0xB0, 'ß': 0xFF, 'é': 0xE9, 'Ł': 0x8A };
const WORDS = 'Gdańsk, Łukasz, Erdős, Dvořák, Straße, café.';

for (const [name, pre] of [
  ['article/T1', '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}'],
  ['lipics-v2021', '\\documentclass[a4paper,UKenglish]{lipics-v2021}'],
] as const) {
  const r = run(pre, WORDS);
  check(`${name}: no "Missing character" in the log`, r.missing.length === 0, r.missing.slice(0, 4).join(' | '));
  const line = [...WORDS];
  for (const [ch, slot] of Object.entries(T1)) {
    if (!WORDS.includes(ch)) continue;
    const col = line.indexOf(ch);
    const g = r.glyphs.find((x) => x.char === slot && /^ec-/.test(r.fonts[x.font]?.name ?? ''));
    check(`${name}: ${ch} printed (T1 slot ${slot.toString(16)})`, !!g, `slots ${r.glyphs.map((x) => x.char.toString(16)).join(' ')}`);
    if (g) check(`${name}: ${ch} placed at its own character (column ${col})`, !!g.src && g.src[2] === col && !g.src[4], JSON.stringify(g.src));
  }
}

// the author in the preamble (LIPIcs's \author): typeset by \maketitle
{
  const r = run('\\documentclass[a4paper,UKenglish]{lipics-v2021}\n\\title{T}\n\\author{A. Nowińska}{Example University}{}{}{}\n\\authorrunning{A. Nowińska}\n\\Copyright{A. Nowińska}\n\\ccsdesc{x}\n\\keywords{x}', '\\maketitle');
  check('lipics-v2021: ń of the author in the preamble printed by \\maketitle', r.glyphs.some((g) => g.char === 0xAB), r.missing.join(' | '));
  check('lipics-v2021 \\maketitle: no "Missing character"', r.missing.length === 0, r.missing.slice(0, 4).join(' | '));
}
// é keeps its letter catcode (its code is its slot): a word with é kerns and hyphenates as before
{
  // (one \showthe a run: the block stops at the first)
  const cat = (ch: string) => run('\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}', `\\showthe\\catcode\`${ch}`).log.match(/^> (\d+)\.$/m)?.[1];
  const cats = [cat('é'), cat('ń')];
  check('é stays a letter (catcode 11), ń is active (13)', cats.join(',') === '11,13', cats.join(','));
}
// ń in a \label key and a \ref (\csname): no error
{
  const r = run('\\documentclass{article}\n\\usepackage[T1]{fontenc}', '\\section{Ań}\\label{sec:Gdańsk} See \\ref{sec:Gdańsk}.');
  check('a \\label and \\ref with ń: no error', r.status <= 1 && !/^! /m.test(r.log), (r.log.match(/^! .*$/m) ?? [''])[0]);
}
// a TU document (native fonts): nothing changes
{
  const r = run('\\documentclass{article}', 'Gdańsk \\showthe\\catcode`ń');
  check('a TU document: ń stays a letter and prints from the native font', /^> 11\.$/m.test(r.log) && r.missing.length === 0, (r.log.match(/^> \d+\.$/m) ?? [''])[0]);
}
// the release packs the tables (a file:// page has nothing else to read them from)
{
  const { workingSetNames } = await import('../scripts/build-worker.ts');
  const names = new Set(workingSetNames());
  const need = ['t1enc.dfu', 'ot1enc.dfu', 'omsenc.dfu', 'ts1enc.dfu'];
  check('the embedded TeX set has the encodings\' Unicode tables', need.every((n) => names.has(n)), need.filter((n) => !names.has(n)).join(' '));
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
