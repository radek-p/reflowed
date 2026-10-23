// The TeX source reader every scanner shares. Offsets are the
// source's: nothing here shortens a string. No other module matches TeX source with its own regex.
//
//   blankComments(s)        every % comment blanked with spaces up to its line end (\% is a percent
//                           sign, \\% a line break then a comment: escapes are read as pairs)
//   commentStart(line)      where a line's comment starts (its length when there is none)
//   readGroup(s, i)         the braced group at s[i] === '{': [content, end] (escapes skipped; an
//                           unclosed group runs to the end)
//   readOptional(s, i)      an [optional] argument at i (spaces before it allowed): [content, end] or null
//   controlSequenceAt(s, i) the control sequence at s[i] === '\\': { name, end } (a control word, letters
//                           and @; or a control symbol, one character)

export { commentStart } from '../../../engine/src/tex-comment.ts';   // loading/tex-comment.ts (via the engine), shared

export function blankComments(s: string): string {
  let out = '', from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c !== '%') continue;
    let e = s.indexOf('\n', i);
    if (e < 0) e = s.length;
    out += s.slice(from, i) + ' '.repeat(e - i);
    from = i = e;
  }
  return out + s.slice(from);
}

export function readGroup(s: string, i: number): [string, number] {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') d++;
    else if (s[j] === '}' && --d === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

export function readOptional(s: string, i: number): [string, number] | null {
  let j = i;
  while (s[j] === ' ' || s[j] === '\t' || s[j] === '\n') j++;
  if (s[j] !== '[') return null;
  let d = 0;
  const a = j;
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') { j = readGroup(s, j)[1] - 1; continue; }
    if (s[j] === '[') d++;
    else if (s[j] === ']' && --d === 0) return [s.slice(a + 1, j), j + 1];
  }
  return null;
}

const isLetter = (c: string | undefined) => !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '@');
export function controlSequenceAt(s: string, i: number): { name: string; end: number } {
  let j = i + 1;
  if (!isLetter(s[j])) return { name: s[j] ?? '', end: Math.min(s.length, j + 1) };
  while (isLetter(s[j])) j++;
  return { name: s.slice(i + 1, j), end: j };
}
