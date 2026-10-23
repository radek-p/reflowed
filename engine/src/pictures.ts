// Pictures in the engine capture, before convert.ts reads the stream:
//  - TikZ (tex/rtx-pictures.sty): the empty placeholder box holding
//    \special{rtx:pic N} becomes a `pic` record naming "rtx-picture:N";
//    assets.ts gives it the SVG that ../pictures/src/picture.ts builds
//    from the picture's XDV page;
//  - an image graphicx placed with a dvipdfmx special (xetex.def does for
//    some PNGs: a box of the image's size holding `pdf:image … (file)`)
//    becomes a `pic` record naming the file, like an \includegraphics that
//    XeTeX placed as its own picture node;
//  - a file graphicx took by its eps rule (any extension it has no rule
//    for, `.svg` among them: its size from a `%%BoundingBox:` line, as
//    for EPS) is a box holding `PSfile="file" …`: a `pic` record naming the
//    file, so an SVG figure (web/src/svgfig) gets its rendition like a PDF.
// convert.ts turns a `pic` record into a picture node.
import { Pictures } from '../pictures/src/picture.ts';

const FIELDS = '(?:,"[A-Za-z]+":(?:-?[\\d.eE+-]+|\\[[^\\]]*\\]))*';
const TIKZ = new RegExp(`\\{"t":"h","w":(-?\\d+),"h":(-?\\d+),"d":(-?\\d+)${FIELDS},"c":\\[\\{"t":"x","s":"rtx:pic (\\d+)"[^{}]*\\}(?:,\\{[^{}]*\\})*\\]\\}`, 'g');
const IMAGE = new RegExp(`\\{"t":"h","w":(-?\\d+),"h":(-?\\d+),"d":(-?\\d+)${FIELDS},"c":\\[\\{"t":"x","s":"pdf:image [^"]*?\\(((?:[^"()\\\\]|\\\\.)+)\\)\\s*"[^{}]*\\}\\]\\}`, 'g');
const PSFILE = new RegExp(`\\{"t":"h","w":(-?\\d+),"h":(-?\\d+),"d":(-?\\d+)${FIELDS},"c":\\[\\{"t":"x","s":"PSfile=\\\\"((?:[^"\\\\]|\\\\[^"])+)\\\\"[^"]*"[^{}]*\\}\\]\\}`, 'g');
const pic = (w: string, h: string, d: string, path: string) =>
  `{"t":"pic","k":0,"w":${w},"h":${h},"d":${d},"page":1,"box":0,"m":[],"path":${JSON.stringify(path)}}`;

/** The stream with every picture placeholder as a `pic` record; the TikZ ids found. */
export function markPictures(stream: string): { stream: string; ids: number[]; images: string[] } {
  const ids: number[] = [], images: string[] = [];
  let out = stream;
  if (out.includes('rtx:pic ')) out = out.replace(TIKZ, (_m, w, h, d, id) => { ids.push(Number(id)); return pic(w, h, d, `rtx-picture:${id}`); });
  if (out.includes('pdf:image ')) out = out.replace(IMAGE, (_m, w, h, d, file) => { const f = JSON.parse(`"${file}"`); images.push(f); return pic(w, h, d, f); });
  if (out.includes('PSfile=')) out = out.replace(PSFILE, (_m, w, h, d, file) => { const f = JSON.parse(`"${file}"`); images.push(f); return pic(w, h, d, f); });
  return { stream: out, ids, images };
}

/** An SVG maker for the run's TikZ pictures (null when there is no XDV). */
export function pictureMaker(xdv: Uint8Array | null, readFile: (n: string) => Uint8Array | null) {
  if (!xdv) return null;
  const p = new Pictures({ xdv, readFile });
  return { svg: (id: number, w: number, h: number, d: number) => p.svg(id, w, h, d), warnings: p.warnings };
}
