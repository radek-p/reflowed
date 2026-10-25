// External links in a block's source: \url{address} and \href[options]{address}{text}, read through
// tex/calls.ts. Offsets are the source's.
//
//   linkCalls(src)                 every \url and \href outside comments, in source order:
//                                  { cmd, address, start, end, at } (at: where the address argument starts)
//   addressKey(s)                  an address as compared: TeX's escapes (\# \% \& \_ \~ \$) read as their
//                                  characters, percent-escapes decoded, spaces trimmed
//   linkCaret(src, href, index)    where the caret goes for the index-th drawn link to `href` in the block:
//                                  the start of that call's address argument; null when no call has that address
import { commandCalls } from './calls.ts';

export interface LinkCall { cmd: 'url' | 'href'; address: string; start: number; end: number; at: number }

export function linkCalls(src: string): LinkCall[] {
  const url = commandCalls(src, 'url', 1).map((c): LinkCall => ({ cmd: 'url', address: c.args[0], start: c.start, end: c.end, at: c.argSpans[0][0] }));
  const href = commandCalls(src, 'href', 2).map((c): LinkCall => ({ cmd: 'href', address: c.args[0], start: c.start, end: c.end, at: c.argSpans[0][0] }));
  return [...url, ...href].sort((a, b) => a.start - b.start);
}

export function addressKey(s: string): string {
  const plain = s.trim().replace(/\\([#%&_~$])/g, '$1');
  try { return decodeURI(plain); } catch { return plain; }
}

export function linkCaret(src: string, href: string, index: number): number | null {
  const key = addressKey(href);
  const same = linkCalls(src).filter((c) => addressKey(c.address) === key);
  const c = same[index] ?? same[0];
  return c ? c.at : null;
}
