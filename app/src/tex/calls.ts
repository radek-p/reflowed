// Commands and their arguments, read from source through tex/lex.ts (the title form's reader and
// importer; no regex over TeX source outside web/src/tex/). Offsets are the source's.
//
//   controlSequences(src)            every control sequence outside comments: { name, start, end, depth }
//                                    (depth: braces open around it)
//   commandCalls(src, name, n)       every \name (a star allowed), an optional [..] first, then n braced
//                                    arguments: { start, end, opt, args, argSpans } (calls with fewer
//                                    braced arguments are left out)
//   removeCalls(src, name)           [src without every \name{..}, the arguments taken]
//   splitTopLevel(src, names)        split at the control sequences `names` outside braces; a \\ keeps its
//                                    [skip] in its separator: [{ text, sep }]
//   usesAny(src, names)              some control sequence of `names` outside comments
//   packageOptions(pre, pkg)         the options of the \usepackage that loads pkg ('' with none), or null
//   skipSpaces(s, i)
import { blankComments, readGroup, readOptional, controlSequenceAt } from './lex.ts';

export const isSpaceChar = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
export const skipSpaces = (s: string, i: number) => { while (isSpaceChar(s[i])) i++; return i; };

export interface ControlSequence { name: string; start: number; end: number; depth: number }
export function controlSequences(src: string): ControlSequence[] {
  const s = blankComments(src);
  const out: ControlSequence[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); continue; }
    if (c !== '\\') continue;
    const cs = controlSequenceAt(s, i);
    out.push({ name: cs.name, start: i, end: cs.end, depth });
    i = cs.end - 1;
  }
  return out;
}

export const usesAny = (src: string, names: Iterable<string>): boolean => {
  const set = new Set(names);
  return controlSequences(src).some((c) => set.has(c.name));
};

export interface Call { start: number; end: number; opt: string | null; args: string[]; argSpans: Array<[number, number]> }
export function commandCalls(src: string, name: string, n: number): Call[] {
  const s = blankComments(src);
  const out: Call[] = [];
  let after = 0;
  for (const cs of controlSequences(src)) {
    if (cs.name !== name || cs.start < after) continue;
    let i = cs.end;
    if (s[i] === '*') i++;
    let opt: string | null = null;
    const o = readOptional(s, i);
    if (o) { opt = src.slice(o[1] - 1 - o[0].length, o[1] - 1); i = o[1]; }       // (the source's text, comments kept)
    const args: string[] = [], argSpans: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const j = skipSpaces(s, i);
      if (s[j] !== '{') break;
      const end = readGroup(s, j)[1];
      if (s[end - 1] !== '}') break;
      args.push(src.slice(j + 1, end - 1));
      argSpans.push([j + 1, end - 1]);
      i = end;
    }
    if (args.length === n) { out.push({ start: cs.start, end: i, opt, args, argSpans }); after = i; }
  }
  return out;
}

export function removeCalls(src: string, name: string): [string, string[]] {
  const found = commandCalls(src, name, 1);
  let rest = src;
  for (const c of [...found].reverse()) rest = rest.slice(0, c.start) + rest.slice(c.end);
  return [rest, found.map((c) => c.args[0])];
}

export function splitTopLevel(src: string, names: Iterable<string>): Array<{ text: string; sep: string }> {
  const set = new Set(names);
  const s = blankComments(src);
  const out: Array<{ text: string; sep: string }> = [];
  let last = 0;
  for (const cs of controlSequences(src)) {
    if (cs.depth !== 0 || !set.has(cs.name) || cs.start < last) continue;
    let end = cs.end;
    if (cs.name === '\\') { const o = readOptional(s, end); if (o) end = o[1]; }
    out.push({ text: src.slice(last, cs.start), sep: src.slice(cs.start, end) });
    last = end;
  }
  out.push({ text: src.slice(last), sep: '' });
  return out;
}

export function packageOptions(pre: string, pkg: string): string | null {
  for (const c of commandCalls(pre, 'usepackage', 1)) {
    if (c.args[0].split(',').map((x) => blankComments(x).trim()).includes(pkg)) return c.opt ?? '';
  }
  return null;
}
