// Glyphs set in virtual fonts (newtx's and newpx's maths, mathdesign, fourier,
// ae …): XeTeX typesets with the virtual face and only xdvipdfmx looks inside,
// so the capture holds glyphs no font file draws. Each becomes what its packet
// draws (the public pipeline's fonts/vf.ts, copied in engine-api's rtx/): the
// glyph itself in the base font, or a box of the pieces. Done here, before the
// source map is made from the output, so the map counts the glyphs the encoder
// keeps (a virtual accented letter is two glyphs, an accent and a letter).
import { FontFiles, resolveVirtualFonts } from '../../build/engine-api-src/rtx/pipeline/fonts/vf.ts';
import { walk } from '../../build/engine-api-src/rtx/shared/tree.ts';

type J = Record<string, any>;

/** Every node of the output: the paragraphs', then the boxes of the content's and the streams' items (wide forms too). */
function eachNode(output: J, visit: (n: J) => void): void {
  for (const p of output.paragraphs ?? []) walk(p.nodes ?? [], visit);
  const boxes = (items: J[]) => { for (const it of items ?? []) for (const x of [it, it.display_wide]) if (x?.box) walk([x.box], visit); };
  boxes(output.content);
  for (const s of output.streams ?? []) boxes(s.content);
}

/** Mutates `output` (its glyphs and its font table); the glyphs replaced. */
export function resolveVirtualGlyphs(output: J, readFile: (name: string) => Uint8Array | null): number {
  const fonts = new Map<string, J & { name: string; size_sp: number }>(Object.entries(output.fonts ?? {}));
  const n = resolveVirtualFonts(fonts, (visit) => eachNode(output, visit), new FontFiles(readFile));
  if (n) output.fonts = Object.fromEntries(fonts);
  return n;
}
