// A document's own Type 1 fonts (a paper that ships Name.tfm + Name.pfb and
// declares them with \DeclareFontShape{U}{fam}{m}{n}{<-> Name}{}, e.g. a symbol
// font): TeX reads the .tfm from the document's files; the
// encoder's Type 1 → OTF conversion (the public type1.ts findOutline) asks
// kpsewhich for Name.pfb first, and the worker answers that from the
// document's files too. When the outline has another name, the document's
// map lines say which: \pdfmapline{+Name PSName <file.pfb} or a map file it
// ships (\pdfmapfile{own.map}). Only the outline file is taken from a map
// line (its encoding: the outline's own).

import { stripComments } from './tex-comment.ts';

/** face → outline file named by the document's map lines (\pdfmapline, and \pdfmapfile's files read with readFile). */
export function mapOutlines(tex: string, readFile: (name: string) => Uint8Array | null = () => null): Map<string, string> {
  const out = new Map<string, string>();
  const text = stripComments(tex);
  const line = (l: string) => {
    const words = l.trim().replace(/^[+=-]/, '').match(/"[^"]*"|\S+/g) ?? [];
    if (!words.length || '%#*;'.includes(words[0][0])) return;
    const file = words.slice(1).map((w) => w.replace(/^[<[]+/, '')).find((w) => /\.pf[ab]$/i.test(w));
    if (file && !out.has(words[0])) out.set(words[0], file);
  };
  for (const m of text.matchAll(/\\pdfmapline\s*\{([^}]*)\}/g)) line(m[1]);
  for (const m of text.matchAll(/\\pdfmapfile\s*\{\s*[+=-]?([^}\s]+)\s*\}/g)) {
    const b = readFile(m[1]);
    if (b) for (const l of new TextDecoder('latin1').decode(b).split(/\r?\n/)) line(l);
  }
  return out;
}
