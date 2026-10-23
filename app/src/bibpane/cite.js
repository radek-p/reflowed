// where a citation goes in a block's source (pure; Node tests use it too).
//
//   citeInsertion(src, pos, keys, cmd) -> { from, to, insert, caret, merged }
//     inside the braces of a \cite… already there (or just after it): the keys join it
//       ("\cite{a|}" + b -> "\cite{a,b}"), keys it has are not repeated;
//     else a new \cite{keys}: after a word, a tie before it ("shown~\cite{x}";
//     a space before the caret becomes the tie), a space after it when a
//     word follows at once.
//   citeCommand(cites) -> the document's usual command (\cite, \citep,
//     \parencite, \autocite …): the one its citations use most.
import { CITE_CMDS, blankComments, readArgs } from '../tex/texscan.js';

const PLAIN_CITES = new Set(['cite', 'citep', 'parencite', 'autocite', 'Cite', 'Parencite', 'Autocite', 'footcite', 'smartcite']);

/** The \cite…{…} group around pos, if pos is inside its braces or right after them: [open brace, close brace]. */
export function citeGroupAt(src, pos) {
  const s = blankComments(src);
  const re = new RegExp(`\\\\(${CITE_CMDS.join('|')})\\*?(?![a-zA-Z])`, 'g');
  let m;
  while ((m = re.exec(s))) {
    if (m.index >= pos) break;
    const a = readArgs(s, re.lastIndex, { opt: 2, req: 1 });
    if (!a.reqs.length) continue;
    const close = a.end - 1;                             // the closing brace
    const open = s.lastIndexOf('{', close - a.reqs[a.reqs.length - 1].length);
    if (pos > open && pos <= close + 1) return { open, close, cmd: m[1], keys: a.reqs[a.reqs.length - 1] };
  }
  return null;
}

export function citeInsertion(src, pos, keys, cmd = '\\cite') {
  pos = Math.max(0, Math.min(pos, src.length));
  const g = citeGroupAt(src, pos);
  if (g) {
    const have = g.keys.split(',').map((k) => k.trim()).filter(Boolean);
    const add = keys.filter((k) => !have.includes(k));
    const inner = [...have, ...add].join(',');
    return { from: g.open + 1, to: g.close, insert: inner, caret: g.open + 1 + inner.length + 1, merged: true, added: add };
  }
  let from = pos;
  let pre = '';
  const prev = src[pos - 1] ?? '', prev2 = src[pos - 2] ?? '';
  if (prev === ' ' && /[\p{L}\p{N})\]}.,;:'$]/u.test(prev2)) { from = pos - 1; pre = '~'; }
  else if (/[\p{L}\p{N})\]}]/u.test(prev)) pre = '~';
  const next = src[pos] ?? '';
  const post = /[\p{L}\p{N}]/u.test(next) ? ' ' : '';
  const text = `${pre}${cmd}{${keys.join(',')}}`;
  return { from, to: pos, insert: text + post, caret: from + text.length, merged: false, added: keys.slice() };
}

/** The citation command the document uses most (for new citations). */
export function citeCommand(cites) {
  const n = new Map();
  for (const c of cites ?? []) if (PLAIN_CITES.has(c.cmd)) n.set(c.cmd, (n.get(c.cmd) ?? 0) + 1);
  let best = 'cite', most = 0;
  for (const [k, v] of n) if (v > most) { best = k; most = v; }
  return `\\${best}`;
}
