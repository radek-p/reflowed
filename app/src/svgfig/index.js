// svgfig: figures that are SVG files, edited in the browser.
// The asset is the SVG (asset.js: the model and its LaTeX sources as metadata,
// the drawing with themable colours, the texts as typeset glyphs); the
// document draws it through the picture path (\includegraphics{x.svg}: the
// engine's PSfile picture, then the picture step themes its colours); the
// export writes it and its TikZ rendition (tikz.js) so the .tex compiles.
// contracts.d.ts: SvgFigures.
// The editor itself (editor.js, ui.js, svg.js: about 180 KB) is imported when a figure is opened: the multi-file
// release loads it as its own file then (scripts/lib/multifile.ts LAZY), the single file and the dev page inline it.

import { MIME, figureToSvg, svgToFigure, isFigureSvg, svgBytes, svgText } from './asset.js';
import { toTikz, scaleOfTikz } from './tikz.js';
import { newFigure, normalise } from './model.js';
import { installFigureColours, FIGURE_COLOURS } from './colours.js';
import { figureLifecycle } from './lifecycle.js';

export const svgFigures = {
  MIME,
  /** Whether an asset is an SVG figure this editor can open (any .svg; a foreign one opens empty). */
  isSvgAsset: (a) => /\.svg$/i.test(a?.name ?? '') || a?.mime === MIME,
  isFigureSvg,
  /** Open the editor on an asset ({ bytes } or { svg }); resolves when closed. */
  async open(asset, opts = {}) {
    const svg = asset.svg ?? svgText(asset.bytes);
    const { openSvgFigureEditor } = await import('./editor.js');
    return openSvgFigureEditor({ svg: isFigureSvg(svg) ? svg : null }, opts);
  },
  /** A new, empty figure's SVG (w × h bp). */
  blank(w = 320, h = 160) { return figureToSvg(newFigure(w, h)); },
  toTikz(svg, o = {}) { const f = svgToFigure(svg); return f ? toTikz(f.fig, o) : null; },
  fromSvg: svgToFigure, toSvg: figureToSvg, normalise, scaleOfTikz, svgBytes, svgText,
  installColours: installFigureColours, COLOURS: FIGURE_COLOURS,
  /** drawn figures as files that follow their blocks (lifecycle.js; the app's hooks) */
  lifecycle: figureLifecycle,
};
export default svgFigures;
