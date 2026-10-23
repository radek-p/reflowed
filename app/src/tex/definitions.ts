// The definitions a block leaves for the blocks after it: the part of a
// block's source that later blocks' contexts carry (refs/context.ts).
//
//   contributedDefinitions(block) -> string[]   exact source pieces, in order:
//     kind 'macros'                     the whole source (a definitions block typesets nothing)
//     kind 'comment'                    nothing
//     definitions and set-up only       the whole source (so \makeatletter … \makeatother stays around them)
//     anything that also typesets       only its top-level definitions (never its text, figures or displays)
//     no definitions                    nothing
//   topLevelDefinitions(source)        every definition outside braces and environments, as source text
//   definitionSpans(source)            [start, end) of every definition at any depth (the caret mapper:
//                                      a definition's body is not where the text is written)
//   typesetsBeyondDefinitions(source)  true when something other than definitions and set-up is left
//   startsWithDefinition(source)       the first command (after comments and spaces) defines or sets up
//
// Commands: tex/commands.ts (one table). Pure functions of the source; tests: tex/definitions.test.ts.
import { blankComments, readGroup, readOptional, controlSequenceAt } from './lex.ts';
import { DEFINES, isDefinitionsCommand, isSetupCommand } from './commands.ts';

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const skipSpace = (s: string, i: number) => { while (isSpace(s[i])) i++; return i; };

export function startsWithDefinition(source: string): boolean {
  const s = blankComments(source);
  const i = skipSpace(s, 0);
  return s[i] === '\\' && isDefinitionsCommand(controlSequenceAt(s, i).name);
}

/** What block `b` gives later blocks' contexts. */
export function contributedDefinitions(b: { kind?: string; source: string }): string[] {
  if (b.kind === 'macros') return [b.source];
  if (b.kind === 'comment') return [];
  const inner = topLevelDefinitions(b.source);
  if (!inner.length && !startsWithDefinition(b.source)) return [];
  return typesetsBeyondDefinitions(b.source) ? inner : [b.source];
}

/** One argument at i: {group}, a control sequence, or a single character; its end or null. */
function oneArg(s: string, i: number): number | null {
  const j = skipSpace(s, i);
  if (j >= s.length) return null;
  if (s[j] === '{') return readGroup(s, j)[1];
  if (s[j] === '\\') return controlSequenceAt(s, j).end;
  return j + 1;
}
/** Skip optional [..] groups (and a * right after the command). */
function skipOpts(s: string, i: number): number {
  for (let j = i; ;) {
    const k = skipSpace(s, j);
    if (s[k] === '*') { j = k + 1; continue; }
    const o = readOptional(s, k);
    if (!o) return j;
    j = o[1];
  }
}
/** The end of the definition whose command name ends at i, or null when it cannot be read. */
function definitionEnd(s: string, cmd: string, i: number): number | null {
  const n = DEFINES[cmd];
  if (n === -1) {                                   // \def\name<parameter text>{body}
    let j = oneArg(s, i);
    if (j === null) return null;
    while (j < s.length && s[j] !== '{') { if (s[j] === '\\') j++; j++; }
    return s[j] === '{' ? readGroup(s, j)[1] : null;
  }
  if (cmd === 'let') {                              // \let\a=\b, \let\a\b
    const a = oneArg(s, i);
    if (a === null) return null;
    let j = a;
    while (s[j] === ' ' || s[j] === '\t') j++;
    if (s[j] === '=') j++;
    if (s[j] === ' ') j++;
    return oneArg(s, j);
  }
  let j = i;
  for (let k = 0; k < n; k++) {
    j = skipOpts(s, j);
    const e = oneArg(s, j);
    if (e === null) return null;
    j = e;
  }
  return j;                                         // a trailing [..] is left to the text
}

/** Every definition as [start, end), at the top level only or at any depth. */
function spans(source: string, topOnly: boolean): [number, number][] {
  const s = blankComments(source);
  const out: [number, number][] = [];
  let brace = 0, env = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { brace++; continue; }
    if (c === '}') { brace = Math.max(0, brace - 1); continue; }
    if (c !== '\\') continue;
    const cs = controlSequenceAt(s, i);
    if (cs.name === 'begin' || cs.name === 'end') {
      const j = skipSpace(s, cs.end);
      if (s[j] === '{') {
        env = cs.name === 'begin' ? env + 1 : Math.max(0, env - 1);
        i = readGroup(s, j)[1] - 1;
        continue;
      }
    }
    if (cs.name in DEFINES && (!topOnly || (brace === 0 && env === 0))) {
      const end = definitionEnd(s, cs.name, cs.end);
      if (end !== null) { out.push([i, end]); i = end - 1; continue; }
    }
    i = cs.end - 1;
  }
  return out;
}

/** Every top-level definition in a block, as its source text, in order. */
export function topLevelDefinitions(source: string): string[] {
  return spans(source, true).map(([a, b]) => source.slice(a, b));
}

/** Every definition's [start, end) at any depth. */
export function definitionSpans(source: string): [number, number][] {
  return spans(source, false);
}

/** true when a block has more than definitions and set-up: text, a figure, a display.
 *  Such a block is not put whole into later blocks' context (it would be typeset there, in front of
 *  every later block: a long paper's figure and paragraph after its \newcommand appeared again at
 *  the top of each block after it); only its definitions are. An unknown command counts as typesetting
 *  (a block is taken whole only when that is sure to add no output). */
export function typesetsBeyondDefinitions(source: string): boolean {
  let s = blankComments(source);
  for (const [a, b] of spans(source, true)) s = s.slice(0, a) + ' '.repeat(b - a) + s.slice(b);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (isSpace(c) || c === '{' || c === '}') continue;
    if (c !== '\\') return true;
    const cs = controlSequenceAt(s, i);
    if (!isSetupCommand(cs.name)) return true;
    // the set-up command's star, optional argument and braced arguments
    let j = skipSpace(s, cs.end);
    if (s[j] === '*') j = skipSpace(s, j + 1);
    const o = readOptional(s, j);
    if (o) j = o[1];
    for (;;) { const k = skipSpace(s, j); if (s[k] !== '{') break; j = readGroup(s, k)[1]; }
    i = j - 1;
  }
  return false;
}
