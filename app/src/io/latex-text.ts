// LaTeX source → plain text, for titles, author names, the abstract in the
// document list, and search. A heuristic reading, never used to typeset.
import { commentStart } from '../tex/lex.ts';

const ACCENTS: Record<string, string> = {
  '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
};
const LETTERS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', i: 'ı', j: 'ȷ',
  dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ',
};

/** TeX accent commands → Unicode: {\"a}, \"{a}, \"a, \v{s}, {\l}, \ss{} … */
export function texAccents(s: string): string {
  // \v{\i}, \'{\i}: dotless i under an accent is plain i
  s = s.replace(/\\([\"'`^~=.uvHckrdb])\s*\{\\[ij]\}/g, (_, a, ) => `\\${a}{i}`);
  s = s.replace(/\{\\([\"'`^~=.])\s*\{?([A-Za-z])\}?\}/g, (_, a, c) => (c + ACCENTS[a]).normalize('NFC'));
  s = s.replace(/\{\\([uvHckrdb])\s*\{?([A-Za-z])\}?\}/g, (_, a, c) => (c + ACCENTS[a]).normalize('NFC'));
  s = s.replace(/\\([\"'`^~=.])\s*\{([A-Za-z])\}/g, (_, a, c) => (c + ACCENTS[a]).normalize('NFC'));
  s = s.replace(/\\([\"'`^~=.])([A-Za-z])/g, (_, a, c) => (c + ACCENTS[a]).normalize('NFC'));
  s = s.replace(/\\([uvHckrdb])\s*\{([A-Za-z])\}/g, (_, a, c) => (c + ACCENTS[a]).normalize('NFC'));
  s = s.replace(/\\([uvHckrdb]) ([A-Za-z])/g, (_, a, c) => (c + ACCENTS[a]).normalize('NFC'));
  s = s.replace(/\{\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j|dh|DH|th|TH|ng|NG)\}/g, (_, n) => LETTERS[n]);
  s = s.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j|dh|DH|th|TH|ng|NG)(?![A-Za-z])(\{\})?\s?/g, (_, n) => LETTERS[n]);
  return s;
}

/** Remove %-comments (not \%). */
export function stripComments(s: string): string {
  return s.split('\n').map((l) => l.slice(0, commentStart(l))).join('\n');   // the rule: tex/lex.ts
}

/** The argument of the first `\cmd[...]{...}` (balanced braces), or null. */
export function commandArg(src: string, cmd: string): { arg: string; start: number; end: number } | null {
  const re = new RegExp(`\\\\${cmd}\\*?\\s*(\\[[^\\]]*\\])?\\s*\\{`, 'g');
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(src, open);
  if (close < 0) return null;
  return { arg: src.slice(open + 1, close), start: m.index, end: close + 1 };
}

/** Index of the brace closing the one at `open`, or -1. */
export function matchBrace(s: string, open: number): number {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '%') { const nl = s.indexOf('\n', i); if (nl < 0) return -1; i = nl; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}

/** Drop `\cmd{...}` wholly (e.g. \thanks, \footnote, \label). */
export function dropCommand(s: string, cmd: string): string {
  for (;;) {
    const a = commandArg(s, cmd);
    if (!a) return s;
    s = s.slice(0, a.start) + s.slice(a.end);
  }
}

/** A readable one-line plain text of a LaTeX fragment. */
export function texToPlain(src: string): string {
  let s = stripComments(src);
  for (const c of ['thanks', 'footnote', 'label', 'index', 'todo', 'marginpar', 'vspace', 'hspace', 'includegraphics']) s = dropCommand(s, c);
  s = texAccents(s);
  s = s.replace(/\\(begin|end)\{[^}]*\}(\[[^\]]*\])?/g, ' ');
  s = s.replace(/\\\\(\[[^\]]*\])?/g, ' ');
  s = s.replace(/~/g, ' ').replace(/---/g, '—').replace(/--/g, '–').replace(/``|''/g, '"');
  s = s.replace(/\\([%&$#_{}])/g, '$1');
  // keep a command's text argument, drop the command name
  s = s.replace(/\\[A-Za-z@]+\*?(\[[^\]]*\])?/g, '');
  s = s.replace(/[{}]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

const FOLD: Record<string, string> = { ł: 'l', Ł: 'l', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ß: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ı: 'i', þ: 'th', ð: 'd' };
/** Unicode text folded for search: marks dropped, letters without a decomposition spelled plainly (ł -> l, ß -> ss), lower case. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[łŁøØđĐßæÆœŒıþð]/g, (c) => FOLD[c] ?? c).toLowerCase();
}

/** For search: TeX accents resolved, then foldText. */
export function searchKey(s: string): string {
  return foldText(texAccents(s));
}
