// Ipe PDF figures, display only: the Ipe document inside a PDF figure (ipe/pdf.js) and its TikZ rendition (ipe/tikz.js),
// which the engine's backend typesets into the SVG the viewer draws (engine/web/backend.js renditionOf).
// The figure editor over it was removed: SVG figures are edited by svgfig/. A figure the
// Ipe editor edited keeps its stored model and rendition, drawn and exported as before.
import { extractIpeFromPdf as extractFromPdf } from './ipe/pdf.js';
import { readIpe, writeIpe, figureBox } from './ipe/model.js';
import { toTikz as ipeToTikz, tikzPreamble } from './ipe/tikz.js';

/** IpeModel: { kind: 'ipe', xml, bbox }. */
async function extractIpe(pdf) {
  const r = await extractFromPdf(pdf);
  return r ? { kind: 'ipe', xml: r.xml, bbox: r.cropBox ?? r.mediaBox } : null;
}

export const figures = {
  extractIpeFromPdf: extractIpe,
  extractIpe,
  /** The TikZ rendition; `scale` = \includegraphics's scale. */
  toTikz(model, o = {}) { return ipeToTikz(readIpe(model.xml, { bbox: model.bbox ?? null }), o); },
  /** Packages the rendition needs in the document preamble (tikz + the Ipe preamble). */
  preambleFor(model) { return tikzPreamble(readIpe(model.xml, { bbox: model.bbox ?? null })); },
  /** The figure's box in bp ([x0, y0, x1, y1]). */
  box(model) { return figureBox(readIpe(model.xml, { bbox: model.bbox ?? null })); },
};

export { readIpe, writeIpe };
export default figures;
