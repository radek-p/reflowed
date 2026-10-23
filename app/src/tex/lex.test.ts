// tex/lex.ts and tex/commands.ts, and the scanners routed through them.
//   node web/src/tex/lex.test.ts      (Node; exit 1 on a failure)
import { blankComments, commentStart, readGroup, readOptional, controlSequenceAt } from './lex.ts';
import { DEFINES, isDefinitionsCommand } from './commands.ts';
import { topLevelDefinitions } from './definitions.ts';
import { contextsFor } from '../refs/context.ts';
import { scanSource } from '../refs/scan.ts';
import { codeOf, isDefinitions } from '../io/split.ts';
import { stripComments as latexTextStrip } from '../io/latex-text.ts';
import { blankComments as texscanBlank } from './texscan.js';
import { stripComments as adapterStrip } from '../../../engine/src/adapter.ts';
import { definitions as caretDefinitions } from '../view/edit-layout.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

// comments: \% is a percent sign; \\% is a line break, then a comment; % at a line's start
const cases: [string, string][] = [
  ['a \\% b', 'a \\% b'],
  ['a \\\\% \\newcommand{\\x}{1}', 'a \\\\'],
  ['% all of it\nnext', '\nnext'],
  ['x \\\\\\% y % z', 'x \\\\\\% y '],
  ['50\\%% of\nit', '50\\%\nit'],
];
for (const [src, code] of cases) {
  const blank = blankComments(src);
  check(`blankComments ${JSON.stringify(src)}`, blank.length === src.length && blank.replace(/ +(\n|$)/g, '$1') === code.replace(/ +(\n|$)/g, '$1'), blank);
  check(`commentStart per line ${JSON.stringify(src)}`, src.split('\n').map((l) => l.slice(0, commentStart(l))).join('\n') === code, src.split('\n').map((l) => l.slice(0, commentStart(l))));
  // every scanner gives the same code
  const lines = src.split('\n').map((l) => l.slice(0, commentStart(l))).join('\n');
  check(`same rule in split.codeOf, latex-text, adapter, texscan ${JSON.stringify(src)}`,
    src.split('\n').map(codeOf).join('\n') === lines && latexTextStrip(src) === lines && adapterStrip(src) === lines && texscanBlank(src) === blank);
}
// a commented-out definition after \\ is not in later blocks' contexts, nor a definition of the block
const cx = contextsFor([{ kind: 'paragraph', source: 'a \\\\% \\newcommand{\\x}{1}\nText.' }, { kind: 'paragraph', source: 'Next.' }]);
check('A6: a definition commented out after \\\\ stays out of the context', !cx[1].prefix.includes('\\newcommand{\\x}'), cx[1].prefix);
check('A6: and out of topLevelDefinitions and the scan', topLevelDefinitions('a \\\\% \\newcommand{\\x}{1}').length === 0 && !scanSource('a \\\\% \\label{gone}').labels.length);

// readers
check('readGroup: nested, escaped braces', JSON.stringify(readGroup('{a{b}\\}c}d', 0)) === JSON.stringify(['a{b}\\}c', 9]));
check('readGroup: unclosed runs to the end', readGroup('{ab', 0)[1] === 3);
check('readOptional: spaces before, a ] inside braces', JSON.stringify(readOptional(' [a{]}b]x', 0)) === JSON.stringify(['a{]}b', 8]) && readOptional('x[a]', 0) === null);
check('controlSequenceAt: a word with @, a symbol', JSON.stringify([controlSequenceAt('\\mov@rlay#', 0), controlSequenceAt('\\%x', 0)]) === JSON.stringify([{ name: 'mov@rlay', end: 9 }, { name: '%', end: 2 }]));

// the one command table: every defining command is read by the context builder, the importer and the caret mapper
const missed = Object.keys(DEFINES).filter((c) => {
  const src = c === 'let' ? '\\let\\a=\\b' : DEFINES[c] === -1 ? `\\${c}\\a#1{x}` : `\\${c}${'{a}'.repeat(DEFINES[c])}`;
  return topLevelDefinitions(src).length !== 1 || !isDefinitions([src]) || caretDefinitions(src).length !== 1;
});
check('commands: every DEFINES entry is a definition for contexts, the importer and the caret mapper', !missed.length, missed);
check('commands: set-up lines make a definitions block for the importer', isDefinitions(['\\makeatletter', '\\global\\long\\def\\a{1}', '\\makeatother']) && !isDefinitions(['\\newcommand\\a{1}', 'Text.']));
check('commands: set-up is a definitions command, text commands are not', isDefinitionsCommand('tikzset') && isDefinitionsCommand('SetKwFunction') && !isDefinitionsCommand('textbf'));

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
