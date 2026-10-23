// Short LaTeX values as text and back (the title form's fields), read through tex/lex.ts.
//
//   valueText(src) → string | null   the text a value prints, when that is lossless: accents
//                                     (Kr\'{o}l, Ma{\"e}l, {\l}), escaped specials (\&), ~ (a
//                                     no-break space), -- and ---, grouping braces; null for anything
//                                     else (maths, \\, other commands), shown as source
//   textValue(text) → string         source for typed text: Unicode as typed, LaTeX's specials escaped
//                                     (valueText(textValue(t)) === t)
import { controlSequenceAt, readGroup } from './lex.ts';
import { skipSpaces } from './calls.ts';

const ACCENTS: Record<string, string> = {
  '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
};
const LETTERS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', i: 'ı', j: 'ȷ',
  dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ',
  textbackslash: '\\', textasciicircum: '^', textasciitilde: '~', textbar: '|', textless: '<', textgreater: '>',
};
const SPECIAL = new Set(['&', '%', '$', '#', '_', '{', '}', ' ']);
const isLetter = (c: string | undefined) => !!c && /^\p{L}$/u.test(c);

/** The accent's argument at i: [letter, end] or null (a group with one letter, \i, \j, or one letter). */
function accentArg(s: string, i: number, word: boolean): [string, number] | null {
  let j = word ? skipSpaces(s, i) : i;
  if (s[j] === '{') {
    const [inner, end] = readGroup(s, j);
    const t = inner.trim();
    if (t === '\\i' || t === '\\j') return [t[1], end];
    return t.length === 1 && isLetter(t) ? [t, end] : null;
  }
  if (s[j] === '\\') { const cs = controlSequenceAt(s, j); return cs.name === 'i' || cs.name === 'j' ? [cs.name, skipBlank(s, cs.end)] : null; }
  return isLetter(s[j]) ? [s[j], j + 1] : null;
}
/** After a control word: one space, or an empty group, is part of it. */
function skipBlank(s: string, i: number): number {
  if (s[i] === '{' && s[i + 1] === '}') return i + 2;
  return s[i] === ' ' ? skipSpaces(s, i) : i;
}

export function valueText(src: string): string | null {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const cs = controlSequenceAt(src, i);
      const n = cs.name;
      if (n in ACCENTS) {
        const word = /^[A-Za-z]$/.test(n);
        const a = accentArg(src, cs.end, word);
        if (!a) return null;
        out += (a[0] + ACCENTS[n]).normalize('NFC');
        i = a[1] - 1;
      } else if (n in LETTERS) { out += LETTERS[n]; i = skipBlank(src, cs.end) - 1; }
      else if (SPECIAL.has(n)) { out += n; i = cs.end - 1; }
      else return null;
      continue;
    }
    if (c === '{' || c === '}') continue;                     // grouping (balanced: values are)
    if (c === '$' || c === '^' || c === '_' || c === '&' || c === '#' || c === '%') return null;
    if (c === '~') { out += ' '; continue; }
    if (c === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '-') { out += '—'; i += 2; } else { out += '–'; i += 1; }
      continue;
    }
    out += c;
  }
  return out;
}

const ESCAPE: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_',
  '^': '\\textasciicircum{}', '~': '\\textasciitilde{}', ' ': '~',
};
export function textValue(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += ESCAPE[c] ?? (c === '-' && text[i + 1] === '-' ? '-{}' : c);
  }
  return out;
}
