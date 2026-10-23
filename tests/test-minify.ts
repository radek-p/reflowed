// scripts/minify-pack.ts's TeX comment rules, on small cases (the proof over
// real documents runs in scripts/build.ts).   node tests/test-minify.ts
import { stripTeX, trimMap } from '../scripts/minify-pack.ts';
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
const s = (t: string, n = 'x.sty') => { const r = stripTeX(n, new Uint8Array(Buffer.from(t, 'latin1'))); return 'skip' in r ? `SKIP ${r.skip}` : Buffer.from(r.bytes).toString('latin1'); };
check('a whole-line comment becomes %', s('% a comment\n\\def\\a{1}\n') === '%\n\\def\\a{1}\n', JSON.stringify(s('% a comment\n\\def\\a{1}\n')));
check('an indented comment line becomes %', s('   % x\n') === '%\n');
check('code % text keeps the %', s('\\def\\a{1}% why\n') === '\\def\\a{1}%\n');
check('the space before % stays', s('\\a % why\n') === '\\a %\n');
check('\\% is a percent sign, not a comment', s('\\def\\p{50\\%} rest\n') === '\\def\\p{50\\%} rest\n');
check('\\\\% starts a comment', s('a\\\\% c\n') === 'a\\\\%\n');
check('\\\\\\% is a percent sign after a line break command', s('a\\\\\\% c\n') === 'a\\\\\\% c\n');
check('trailing spaces go, tabs stay', s('a   \nb\t\n') === 'a\nb\t\n', JSON.stringify(s('a   \nb\t\n')));
check('CRLF line ends kept', s('% c\r\na % d\r\n') === '%\r\na %\r\n');
check('a \\verb line is left alone', s('\\verb|%x| % y\n') === '\\verb|%x| % y\n');
check('a ^^ line is left alone', s('\\def\\x{^^25} % y\n') === '\\def\\x{^^25} % y\n');
check('%\'s catcode changed: the file is skipped', s('\\catcode`\\%=12\n% x\n').startsWith('SKIP'));
check('filecontents: skipped', s('\\begin{filecontents}{a.tex}\n% x\n\\end{filecontents}\n').startsWith('SKIP'));
check('.dtx: skipped', s('% x\n', 'a.dtx').startsWith('SKIP'));
check('a font file is not a TeX source', s('% x\n', 'a.pfb').startsWith('SKIP'));
check('Latin-1 bytes survive', s('\\def\\e{\xe9}% c\n') === '\\def\\e{\xe9}%\n');
const map = Buffer.from(trimMap(new Uint8Array(Buffer.from('% comment\ncmr10 CMR10 <cmr10.pfb\nzzz10 ZZZ <zzz.pfb\n  msam10 MSAM10 <msam10.pfb\n')), new Set(['cmr10', 'msam10']))).toString();
check('map: only fonts with a TFM in the pack', map === 'cmr10 CMR10 <cmr10.pfb\n  msam10 MSAM10 <msam10.pfb\n', JSON.stringify(map));
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
