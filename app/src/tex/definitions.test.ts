// definitions.ts and its use in contextsFor: a block gives later blocks
// its definitions, never its text.
//   node web/src/tex/definitions.test.ts      (Node; exit 1 on a failure)
import { existsSync, readFileSync } from 'node:fs';
import { contributedDefinitions, topLevelDefinitions, typesetsBeyondDefinitions, startsWithDefinition } from './definitions.ts';
import { contextsFor } from '../refs/context.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d}` : ''}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const P = (source: string, kind = 'paragraph') => ({ kind, source });

// topLevelDefinitions
const u = topLevelDefinitions;
check('top level: \\newcommand between paragraphs', eq(u('Text.\n\\newcommand{\\x}[1]{\\textsf{#1}}\nMore $\\x{a}$.'), ['\\newcommand{\\x}[1]{\\textsf{#1}}']));
check('top level: \\def with parameters, \\let, \\DeclareMathOperator*', eq(u('a \\def\\f#1.{#1} b \\let\\g=\\f c \\DeclareMathOperator*{\\argmax}{arg\\,max}'),
  ['\\def\\f#1.{#1}', '\\let\\g=\\f', '\\DeclareMathOperator*{\\argmax}{arg\\,max}']));
check('top level: inside braces or an environment: local, not taken', u('{\\def\\a{1}} \\begin{center}\\newcommand\\b{2}\\end{center}').length === 0);
check('top level: in a comment: not taken', u('% \\newcommand{\\c}{3}\ntext').length === 0);
check('top level: \\newenvironment with 3 arguments', eq(u('\\newenvironment{e}[1]{\\begin{center}#1}{\\end{center}} x'), ['\\newenvironment{e}[1]{\\begin{center}#1}{\\end{center}}']));
check('startsWithDefinition: after a comment line', startsWithDefinition('% defs\n  \\newcommand\\a{1}') && !startsWithDefinition('Text \\newcommand\\a{1}'));

// contributedDefinitions: the contract, in the layouts papers use (a block may glue the
// definition to the display: `}\begin{align*}`)
const body = '{\\begin{tikzpicture}\\node{$q$ \\{x\\}};\\end{tikzpicture}\n}';
const layouts: [string, string, string][] = [
  ['glued }\\begin', `\\newcommand{\\autA}${body}\\begin{align*}a &= \\autA\\end{align*}\nObserve A.`, `\\newcommand{\\autA}${body}`],
  ['separate lines', `\\newcommand{\\autB}${body}\n\n\\begin{align*}b &= \\autB\n\\end{align*}\nObserve B.`, `\\newcommand{\\autB}${body}`],
  ['a comment between', `\\newcommand{\\autC}${body}% the automaton } {\n\\begin{align*}c\\end{align*} Observe C.`, `\\newcommand{\\autC}${body}`],
  ['unbraced \\newcommand\\x[1], % in the body', '\\newcommand\\autD[1]{#1 % not the end }\n}Observe D.', '\\newcommand\\autD[1]{#1 % not the end }\n}'],
  ['\\def with a parameter text', '\\def\\autE#1.{(#1)}Observe E \\autE x.', '\\def\\autE#1.{(#1)}'],
  ['text first, definition between paragraphs', 'Observe F.\n\n\\newcommand{\\autF}{f}\n\nMore \\autF.', '\\newcommand{\\autF}{f}'],
];
for (const [name, src, def] of layouts) check(`contributes the definition only: ${name}`, eq(contributedDefinitions(P(src)), [def]), JSON.stringify(contributedDefinitions(P(src))));
const setup = '\\makeatletter\n\\def\\@mine{x}\n\\makeatother';
check('contributes the whole block: definitions and set-up only (\\makeatletter kept)', eq(contributedDefinitions(P(setup)), [setup]));
check('contributes the whole block: kind macros (even an unknown command)', eq(contributedDefinitions(P('\\NiceMatrixOptions{a=1}\\foo', 'macros')), ['\\NiceMatrixOptions{a=1}\\foo']));
check('contributes nothing: a comment block, plain text, a definition inside an environment',
  [P('\\newcommand\\a{1}', 'comment'), P('Fix a finite alphabet.'), P('\\begin{proof}\\newcommand\\b{2} x\\end{proof}')].every((b) => contributedDefinitions(b).length === 0));
check('typesetsBeyondDefinitions: set-up commands do not count, text and unknown commands do',
  !typesetsBeyondDefinitions('\\newcommand\\a{1}\n\\tikzset{x/.style={}}') && typesetsBeyondDefinitions('\\newcommand\\a{1} x') && typesetsBeyondDefinitions('\\newcommand\\a{1}\\foo'));

// contextsFor: the definitions part of the last block's prefix is exactly the definitions, in order
const cx = contextsFor([...layouts.map(([, s]) => P(s)), P(setup), P('Last.')]);
const last = cx[cx.length - 1].prefix;
const defsPart = last.slice(last.indexOf('\\rtxdefsbegin\\fi\n') + 17, last.indexOf('\n\\ifdefined\\rtxdefsend'));
check('contextsFor: the definitions part is exactly the blocks\' definitions', defsPart === [...layouts.map(([, , d]) => d), setup].join('\n') && !/Observe|align/.test(defsPart),
  JSON.stringify(defsPart).slice(0, 400));
check('contextsFor: defs lists the contributing blocks, each before the block', eq(cx[cx.length - 1].defs, [0, 1, 2, 3, 4, 5, 6]) && cx.every((c, i) => c.defs.every((j) => j < i)));

// the seeds: no block that typesets is in a later block's context (outside a thm-restate restatement);
// a block that glues \machineQX to a display gives only its definition
const SEEDS = new URL('../../../build/seed/', import.meta.url);
for (const f of ['intro.json']) {
  const p = new URL(f, SEEDS);
  if (!existsSync(p)) { console.log(`skip ${f}: no seed (node scripts/seed.ts)`); continue; }
  const bl = JSON.parse(readFileSync(p, 'utf8')).init.blocks.filter((b: any) => !b.attrs?.container);
  const cs = contextsFor(bl);
  const whole = bl.map((b: any, i: number) => (b.kind !== 'macros' && b.source.length > 40 && typesetsBeyondDefinitions(b.source) ? i : -1)).filter((i: number) => i >= 0);
  const copies = cs.flatMap((c, i) => whole.filter((j: number) => j < i && c.prefix.split(`\\setbox0=\\vbox{${bl[j].source}}`).join('').includes(bl[j].source)).map((j: number) => `${j}→${i}`));
  check(`${f}: no block that typesets is copied into a later block's context`, !copies.length, `${copies.length} copies ${copies.slice(0, 8).join(' ')}`);
  const glued = bl.findIndex((b: any) => b.source.startsWith('\\newcommand{\\machineQX}'));
  if (glued >= 0) check(`${f}: block ${glued} (\\machineQX + align) gives its definition only`,
    cs[glued + 1].prefix.includes('\\newcommand{\\machineQX}') && !cs.slice(glued + 1).some((c) => c.prefix.includes('Note that $\\mathcal{M}$')));
}
console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
