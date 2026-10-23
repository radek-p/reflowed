// svgfig asset: the saved figure is one SVG file.
//   <!-- %%BoundingBox: 0 0 W H -->   graphicx sizes it by its eps rule (xetex.def
//                                     takes any unknown extension so): the engine's
//                                     PSfile picture (engine/src/pictures.ts)
//   <svg width='Wpt' height='Hpt' viewBox='0 0 W H'>
//     <metadata id='rtx-figure'>{ the model as JSON: every object, the LaTeX sources }</metadata>
//     the objects as render.js draws them (single-quoted #rrggbb colours: the
//     picture step themes them), texts as their typeset glyphs
//   </svg>
// Opening reads the model back from the metadata, and each text's glyphs from
// its <g data-rtx-text='id'>, so a figure saved again unchanged is the same bytes.

import { normalise, walk } from './model.js';
import { renderObject } from './render.js';

export const MIME = 'image/svg+xml';
const META_RE = /<metadata id=(["'])rtx-figure\1>([\s\S]*?)<\/metadata>/;
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Whether an SVG (text) is a figure this editor wrote. */
export const isFigureSvg = (svg) => typeof svg === 'string' && META_RE.test(svg);

/** A stable JSON of the model: key order fixed, numbers rounded. */
export function modelJson(fig) {
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
  const order = ['id', 'type', 'name', 'hidden', 'locked', 'x', 'y', 'w', 'h', 'r', 'rot', 'pts', 'closed', 'anchor', 'box', 'src', 'align', 'size', 'color', 'opacity', 'tw', 'th', 'gsig',
    'stroke', 'strokeOpacity', 'fill', 'fillOpacity', 'width', 'dash', 'arrowStart', 'arrowEnd', 'children'];
  const obj = (o) => {
    const out = {};
    for (const k of [...order, ...Object.keys(o).filter((k) => !order.includes(k)).sort()]) {
      if (!(k in o) || o[k] === undefined || k.startsWith('_')) continue;
      const v = o[k];
      out[k] = k === 'children' ? v.map(obj) : k === 'pts' ? v.map((p) => p.map(r)) : r(v);
    }
    return out;
  };
  return JSON.stringify({ v: 1, w: fig.w, h: fig.h, objects: fig.objects.map(obj) });
}

/** The figure's SVG file. glyphs: id → { svg, w, h } (text.js). */
export function figureToSvg(fig, glyphs = new Map()) {
  const W = fig.w, H = fig.h;
  const body = fig.objects.map((o) => renderObject(o, 'asset', { glyphs })).join('\n');
  return `<!--\n%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}\n%%Creator: reflowtex figure editor\n-->\n`
    + `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='${W}pt' height='${H}pt' viewBox='0 0 ${W} ${H}'>\n`
    + `<metadata id='rtx-figure'>${escText(modelJson(fig))}</metadata>\n${body}\n</svg>\n`;
}

/** The model and the stored glyphs of an SVG this editor wrote (null otherwise). */
export function svgToFigure(svg) {
  const m = META_RE.exec(svg ?? '');
  if (!m) return null;
  let fig;
  try { fig = normalise(JSON.parse(unesc(m[2]))); } catch { return null; }
  const glyphs = new Map();
  for (const [o] of walk(fig.objects)) {
    if (o.type !== 'text' || !o.gsig) continue;
    const re = new RegExp(`<g data-rtx-text='${o.id.replace(/[^\w-]/g, '')}'[^>]*>(<svg[\\s\\S]*?</svg>)</g>`);
    const g = re.exec(svg);
    if (g) glyphs.set(o.id, { sig: o.gsig, svg: g[1], w: o.tw, h: o.th });
  }
  return { fig, glyphs };
}

export const svgBytes = (svg) => new TextEncoder().encode(svg);
export const svgText = (bytes) => (typeof bytes === 'string' ? bytes : bytes ? new TextDecoder().decode(bytes) : '');
