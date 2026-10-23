// svgfig render: an object as SVG markup, for the editor's canvas (colours as
// the current theme shows them, ids on the elements) and for the saved figure
// (colours as fill='#rrggbb' / stroke='#rrggbb', single-quoted as dvisvgm
// writes them, which the picture step themes; texts as their typeset glyphs).

import { ANCHORS, arrowHead, frameOf } from './model.js';
import { shown } from './colours.js';

export const DASHES = { solid: null, dashed: [3, 3], dotted: [0.8, 2] };
const n = (v) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const attrs = (a) => Object.entries(a).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${k}='${typeof v === 'number' ? n(v) : esc(v)}'`).join('');

export const pathD = (pts, closed) => pts.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join('') + (closed ? 'Z' : '');

/** Colour attribute value: the hex (asset) or what the theme shows (canvas). */
const col = (hex, mode) => (hex == null ? 'none' : mode === 'asset' ? hex : shown(hex));

function strokeAttrs(o, mode) {
  if (!o.stroke) return { stroke: 'none' };
  const d = DASHES[o.dash];
  return {
    stroke: col(o.stroke, mode), 'stroke-width': o.width, 'stroke-opacity': o.strokeOpacity < 1 ? o.strokeOpacity : null,
    'stroke-dasharray': d ? d.map(n).join(' ') : null, 'stroke-linecap': o.dash === 'dotted' ? 'round' : null,
    'stroke-linejoin': o.type === 'line' || o.type === 'path' ? 'round' : null,
  };
}
const fillAttrs = (o, mode) => (o.fill ? { fill: col(o.fill, mode), 'fill-opacity': o.fillOpacity < 1 ? o.fillOpacity : null } : { fill: 'none' });
const rotAttr = (o) => {
  if (!o.rot) return null;
  const f = frameOf(o);
  return `rotate(${n(o.rot)} ${n((f[0] + f[2]) / 2)} ${n((f[1] + f[3]) / 2)})`;
};

/** The open path's drawn points (its ends pulled back under arrowheads) and the heads. */
export function lineGeometry(o) {
  const pts = o.pts.map((p) => p.slice());
  const heads = [];
  if (o.stroke && pts.length >= 2) {
    if (o.arrowEnd && o.arrowEnd !== 'none') { const k = pts.length - 1, h = arrowHead(pts[k], pts[k - 1], o.width); heads.push(h.poly); pts[k] = h.end; }
    if (o.arrowStart && o.arrowStart !== 'none') { const h = arrowHead(pts[0], pts[1], o.width); heads.push(h.poly); pts[0] = h.end; }
  }
  return { pts, heads };
}

/**
 * Markup for one object.
 *   mode 'canvas': <g data-id> around it; a text is its hit area plus, while its
 *                  LaTeX is not mounted, the stored glyphs (opts.glyphs)
 *   mode 'asset':  as saved; a text is its glyphs (opts.glyphs: id → { svg, w, h })
 */
export function renderObject(o, mode = 'asset', opts = {}) {
  if (o.hidden && mode === 'asset') return '';
  const id = mode === 'canvas' ? { 'data-id': o.id, class: `svf-obj svf-${o.type}`, visibility: o.hidden ? 'hidden' : null } : {};
  let inner = '';
  switch (o.type) {
    case 'group':
      inner = o.children.map((c) => renderObject(c, mode, opts)).join('');
      return `<g${attrs({ ...id, 'data-rtx-group': mode === 'asset' ? o.id : null })}>${inner}</g>`;
    case 'rect':
      inner = `<rect${attrs({ x: o.x, y: o.y, width: Math.max(0, o.w), height: Math.max(0, o.h), rx: o.r || null, ...fillAttrs(o, mode), ...strokeAttrs(o, mode), transform: rotAttr(o) })}/>`;
      break;
    case 'ellipse':
      inner = `<ellipse${attrs({ cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.max(0, o.w / 2), ry: Math.max(0, o.h / 2), ...fillAttrs(o, mode), ...strokeAttrs(o, mode), transform: rotAttr(o) })}/>`;
      break;
    case 'line': case 'path': {
      const closed = o.type === 'path' && o.closed;
      const g = closed ? { pts: o.pts, heads: [] } : lineGeometry(o);
      inner = `<path${attrs({ d: pathD(g.pts, closed), ...(closed ? fillAttrs(o, mode) : { fill: 'none' }), ...strokeAttrs(o, mode) })}/>`;
      for (const hd of g.heads) inner += `<path${attrs({ d: pathD(hd, true), fill: col(o.stroke, mode), 'fill-opacity': o.strokeOpacity < 1 ? o.strokeOpacity : null, stroke: 'none' })}/>`;
      if (mode === 'canvas') inner += `<path class='svf-hit'${attrs({ d: pathD(o.pts, closed), fill: 'none', stroke: 'transparent', 'stroke-width': opts.hitWidth ?? 6 })}/>`;
      break;
    }
    case 'text': {
      const f = frameOf(o);
      const gl = opts.glyphs?.get?.(o.id) ?? null;
      const t = [`translate(${n(f[0])} ${n(f[1])})`];
      if (o.rot) t.unshift(rotAttr(o));
      if (mode === 'canvas') {
        inner = `<rect class='svf-hit'${attrs({ x: f[0], y: f[1], width: f[2] - f[0], height: f[3] - f[1], fill: 'transparent', transform: rotAttr(o) })}/>`;
        if (gl && !opts.mounted?.has?.(o.id)) inner += `<g class='svf-glyphs'${attrs({ transform: t.join(' '), fill: o.color && o.color !== '#000000' ? col(o.color, mode) : 'currentColor', opacity: o.opacity < 1 ? o.opacity : null })}>${gl.svg}</g>`;
      } else if (gl) {
        inner = `<g${attrs({ 'data-rtx-text': o.id, transform: t.join(' '), fill: o.color && o.color !== '#000000' ? o.color : null, opacity: o.opacity < 1 ? o.opacity : null })}>${gl.svg}</g>`;
      } else {
        // not typeset (the LaTeX failed): its source in a plain font, so nothing is lost
        const [ax] = ANCHORS[o.anchor] ?? ANCHORS.nw;
        inner = `<text${attrs({ 'data-rtx-text': o.id, x: f[0] + ax * (f[2] - f[0]), y: f[3] - 2, 'text-anchor': ax === 0 ? 'start' : ax === 1 ? 'end' : 'middle', 'font-family': 'serif', 'font-size': 10, fill: o.color && o.color !== '#000000' ? o.color : null })}>${esc(o.src)}</text>`;
      }
      break;
    }
    default: return '';
  }
  return mode === 'canvas' ? `<g${attrs(id)}>${inner}</g>` : inner;
}

/** A typeset text's SVG (the worker's `tikz` result) as markup to nest: ids
 *  prefixed with `pre`, as a <svg> the size of the text, overflow shown. */
export function nestGlyphs(svg, pre, w, h) {
  const body = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const vb = /viewBox=(["'])([^"']*)\1/.exec(svg)?.[2] ?? `0 0 ${n(w)} ${n(h)}`;
  const fixed = body
    .replace(/\bid=(["'])([^"']+)\1/g, (_m, q, x) => `id=${q}${pre}${x}${q}`)
    .replace(/(xlink:href|href)=(["'])#([^"']+)\2/g, (_m, a, q, x) => `${a}=${q}#${pre}${x}${q}`)
    .replace(/url\(#([^)]+)\)/g, (_m, x) => `url(#${pre}${x})`)
    // pgf sets black explicitly: dropped, so the text takes its object's colour (and the theme's text colour)
    .replace(/\s(fill|stroke)=(['"])#0{3}(?:0{3})?\2/g, '');
  return `<svg x='0' y='0' width='${n(w)}' height='${n(h)}' viewBox='${vb}' overflow='visible'>${fixed}</svg>`;
}
