// Characters TeX could not set in a block, from its log ("Missing character: There is no ł (U+0142) in font
// [lmroman10-regular]:mapping=tex-text;!", "… There is no ^^c5 in font cmr10!"), as the public pipeline's
// serializer records them (output.json missing_chars: font, char, count, where): its encoder then gives the block
// one warning per font and character (missing-char), which the viewer adds to the page's log and the editor lists
// (app/src/doc/viewer-log.ts). XeTeX sets nothing for such a character, so the capture has no trace of it; the log
// is where TeX says so. The places (where) are not known from the log: none.
//
//   missingChars(log) -> MissingChar[]   (merged by font and character, in the order first met)

import { unwrap } from './texlog.js';

export interface MissingChar { font: string; char: number; count: number; where: string[] }

/** A character as TeX's log writes it: itself, a ^^ form (^^c5, or ^^M for a control character), with its code
 *  point after it in XeTeX's native fonts. */
function charOf(shown: string, hex: string | undefined): number | null {
  if (hex) return parseInt(hex, 16);
  let m: RegExpExecArray | null;
  if ((m = /^\^\^([0-9a-f]{2})$/.exec(shown))) return parseInt(m[1], 16);
  if ((m = /^\^\^(.)$/.exec(shown))) { const c = m[1].charCodeAt(0); return c < 64 ? c + 64 : c - 64; }
  const cps = [...shown];
  return cps.length === 1 ? cps[0].codePointAt(0)! : null;
}
/** A font as TeX's log names it: a TFM name (cmr10), or a native font's request ("[lmroman10-regular]:mapping=…;",
 *  "Latin Modern Roman/OT:script=latn;"): its name without the features. */
const fontOf = (s: string) => s.replace(/^"|"$/g, '').replace(/^\[([^\]]*)\].*$/, '$1').replace(/[:/].*$/, '');

const LINE = /^Missing character: There is no (.+?) (?:\(U\+([0-9A-Fa-f]{4,6})\) )?in font (.+?)!$/;

export function missingChars(log: string): MissingChar[] {
  const out = new Map<string, MissingChar>();
  for (const line of unwrap(log.split(/\r?\n/)) as string[]) {
    const m = LINE.exec(line.trimEnd());
    if (!m) continue;
    const char = charOf(m[1], m[2]);
    if (char === null) continue;
    const font = fontOf(m[3]);
    const k = `${font}\u0000${char}`;
    const got = out.get(k);
    if (got) got.count++;
    else out.set(k, { font, char, count: 1, where: [] });
  }
  return [...out.values()];
}
