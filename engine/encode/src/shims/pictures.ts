// The public encoder's picture step (src/pipeline/pictures.ts
// convertPictures), for pictures that arrive as SVG. The Tectonic capture
// builds each TikZ picture's SVG itself (../../../pictures/) and puts it on
// the picture node as `svg`: there is no PDF page to run dvisvgm on, and no
// dvisvgm or Ghostscript in the browser. What the public step does to
// dvisvgm's output – rewritePictureSvg: ids prefixed per picture and
// document, colours themed – is done to that SVG instead, with the same
// prefixes, so a picture reaches Document.pictures exactly as a LuaTeX one
// would. A document without such nodes goes to the public step unchanged.
//
// includedPictureFiles is the public one: Pipeline.compile records the files a
// block's \includegraphics read (with their hashes) beside its key. The
// worker calls only Pipeline.transform, and its cache keys carry the assets a
// block names (web/backend.js), so the editor does not reach it; the Node
// reference gets the public meaning.
//
// engine/scripts/build-worker.ts aliases pipeline.ts's './pictures.ts' to this file.
import { basename } from 'node:path';
import { convertPictures as publicConvertPictures, includedPictureFiles, rewritePictureSvg, type Picture } from '../../../../../reflowtex/src/pipeline/pictures.ts';
import { forEachNode, type SerializerOutput } from '../../../../../reflowtex/src/pipeline/nodes.ts';
import { PictureError } from '../../../../../reflowtex/src/pipeline/errors.ts';

export { includedPictureFiles, rewritePictureSvg };
export type { Picture };

export async function convertPictures(data: SerializerOutput, buildDir: string, block?: string,
                                      docTag = basename(buildDir).replace(/[^0-9A-Za-z]/g, '').slice(0, 8)): Promise<number> {
  const nodes: Record<string, unknown>[] = [];
  forEachNode(data, n => { if (n.type === 'picture') nodes.push(n as Record<string, unknown>); });
  if (!nodes.some(n => typeof n.svg === 'string')) return publicConvertPictures(data, buildDir, block, docTag);
  if (!Array.isArray(data.pictures)) data.pictures = [];
  const pictures = data.pictures as Picture[];
  const bySvg = new Map<string, number>();
  let converted = 0;
  for (const n of nodes) {
    const svg = n.svg;
    if (typeof svg !== 'string') throw new PictureError('a picture without SVG in a document whose pictures arrive as SVG (dvisvgm is not available here)', block);
    delete n.svg;
    if (!bySvg.has(svg)) {
      pictures.push(rewritePictureSvg(svg, `p${docTag}-${pictures.length + 1}-`));
      bySvg.set(svg, pictures.length);        // 1-based
      converted++;
    }
    n.picture = bySvg.get(svg);
  }
  return converted;
}
