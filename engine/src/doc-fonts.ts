// A document's own Type 1 fonts (a paper that ships Name.tfm + Name.pfb and
// declares them with \DeclareFontShape{U}{fam}{m}{n}{<-> Name}{}, e.g. a symbol
// font): TeX reads the .tfm from the document's files; the
// encoder's Type 1 → OTF conversion (the public type1.ts findOutline) asks
// kpsewhich for Name.pfb, and the worker answers that from the document's
// files too. When the outline has another name, or is read through an
// encoding vector, the document's map lines say which:
// \pdfmapline{+Name PSName "Enc ReEncodeFont" <enc.enc <file.pfb} or a map
// file it ships (\pdfmapfile{own.map}). Those lines go to the encoder as they
// are (type1.ts setDocumentMapLines), which takes the outline and the encoding
// from them as it does from pdftex.map.

import { stripComments } from './tex-comment.ts';

/** The font map lines a document declares: each \pdfmapline's, then the lines of each \pdfmapfile's file (read with readFile). */
export function mapLines(tex: string, readFile: (name: string) => Uint8Array | null = () => null): string[] {
  const text = stripComments(tex);
  const out = [...text.matchAll(/\\pdfmapline\s*\{([^}]*)\}/g)].map((m) => m[1]);
  for (const m of text.matchAll(/\\pdfmapfile\s*\{\s*[+=-]?([^}\s]+)\s*\}/g)) {
    const b = readFile(m[1]);
    if (b) out.push(...new TextDecoder('latin1').decode(b).split(/\r?\n/));
  }
  return out;
}
