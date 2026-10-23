// tex/calls.ts and tex/text.ts (the title form's reader).
//   node web/src/tex/calls.test.ts      (Node; exit 1 on a failure)
import { commandCalls, controlSequences, packageOptions, removeCalls, splitTopLevel, usesAny } from './calls.ts';
import { textValue, valueText } from './text.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const cs = controlSequences('\\a{\\b} % \\c\n\\\\ \\%');
check('control sequences: depth, comments skipped, \\\\ and \\% symbols', JSON.stringify(cs.map((c) => [c.name, c.depth])) === JSON.stringify([['a', 0], ['b', 1], ['\\', 0], ['%', 0]]), cs);
const c = commandCalls('x \\author*[1,2] {A} % \\author{no}\n\\author{B}{C}', 'author', 1);
check('calls: star, optional, spaces; a commented one is not read', c.length === 2 && c[0].opt === '1,2' && c[0].args[0] === 'A' && c[1].args[0] === 'B', c);
check('calls: n arguments', commandCalls('\\author{a}{b}{c}{d}{e} \\author{x}', 'author', 5).length === 1);
check('calls: an argument with a } in a comment', commandCalls('\\title{A % }\n B}', 'title', 1)[0]?.args[0] === 'A % }\n B');
check('removeCalls', JSON.stringify(removeCalls('Ada\\thanks{x {y}} Lovelace', 'thanks')) === JSON.stringify(['Ada Lovelace', ['x {y}']]));
const sp = splitTopLevel('A, B\\\\C {D\\\\E} \\\\[9pt] Inst \\and F', ['\\']);
check('splitTopLevel: \\\\ outside braces, its [skip] kept', JSON.stringify(sp) === JSON.stringify([{ text: 'A, B', sep: '\\\\' }, { text: 'C {D\\\\E} ', sep: '\\\\[9pt]' }, { text: ' Inst \\and F', sep: '' }]), sp);
check('splitTopLevel: \\and, not \\anderson', splitTopLevel('a \\and b \\anderson', ['and']).length === 2);
check('usesAny', usesAny('x \\ReflowedMetaGet{t}', ['ReflowedMetaGet']) && !usesAny('% \\ReflowedMetaGet\n', ['ReflowedMetaGet']));
check('packageOptions', packageOptions('\\usepackage[apply=none]{x,reflowed-meta}', 'reflowed-meta') === 'apply=none' && packageOptions('\\usepackage{reflowed-metax}', 'reflowed-meta') === null && packageOptions('%\\usepackage{reflowed-meta}', 'reflowed-meta') === null);

// values as text
const vt: Array<[string, string | null]> = [
  ["{\\L}ola Kr\\'{o}lik-Testowa", 'Łola Królik-Testowa'], ['Zo{\\"e}', 'Zoë'], ['M\\"{a}ller', 'Mäller'], ['\\v s', 'š'], ['\\c{c}', 'ç'],
  ['Smith \\& Co', 'Smith & Co'], ['a~b', 'a\u00a0b'], ['1--2---3', '1\u20132\u20143'], ['\\ss{}e', 'ße'], ['\\textbackslash{}x', '\\x'],
  ['$x$', null], ['A\\\\B', null], ['\\emph{x}', null], ['x^2', null], ['a_b', null],
];
for (const [src, want] of vt) check(`valueText ${JSON.stringify(src)}`, valueText(src) === want, valueText(src));
for (const t of ['Smith & Co_ 50% Gdańsk', 'a {b} \\c', 'x^y~z', 'a--b---c', 'tab\u00a0x', '#1 $5']) {
  check(`textValue round trip ${JSON.stringify(t)}`, valueText(textValue(t)) === t, textValue(t));
}
check('textValue: one pass (a typed \\ is \\textbackslash{}, its braces not escaped again)', textValue('\\{') === '\\textbackslash{}\\{');
console.log(`${n - bad}/${n}`);
process.exit(bad ? 1 : 0);
