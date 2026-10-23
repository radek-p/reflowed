// svgfig TikZ: the figure as a tikzpicture, for the exported .tex (the
// document's \includegraphics{x.svg} becomes \input{x.tikz}, io/figures-export.ts)
// and for typesetting one text (text.js). Same geometry as render.js: y down
// (y=-1bp), arrowheads as filled paths, exact colours (\definecolor … HTML),
// so the compiled picture matches the SVG. Needs only tikz (todonotes and
// many classes load it; the export adds \usepackage{tikz} when not).

import { SIZES, frameOf } from './model.js';
import { DASHES, lineGeometry } from './render.js';

const n = (v) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
const pt = ([x, y]) => `(${n(x)},${n(y)})`;
export const TIKZ_ANCHOR = { nw: 'north west', n: 'north', ne: 'north east', w: 'west', c: 'center', e: 'east', sw: 'south west', s: 'south', se: 'south east' };
const cname = (hex) => (hex === '#000000' ? 'black' : hex === '#ffffff' ? 'white' : `rtx${hex.slice(1).toLowerCase()}`);

/** The node options and text of a text object (shared with text.js). */
export function textNode(o, { colour = true } = {}) {
  const opt = ['inner sep=0pt', 'outer sep=0pt', `anchor=${TIKZ_ANCHOR[o.anchor] ?? 'north west'}`];
  if (o.box != null) opt.push(`text width=${n(o.box)}bp`, `align=${o.align === 'justify' ? 'justify' : o.align === 'left' ? 'flush left' : o.align === 'right' ? 'flush right' : 'flush center'}`);
  const size = SIZES[o.size] ?? '';
  if (size) opt.push(`font=${size}`);
  if (colour && o.color && o.color !== '#000000') opt.push(`text=${cname(o.color)}`);
  if (colour && o.opacity != null && o.opacity < 1) opt.push(`text opacity=${n(o.opacity)}`);
  if (o.rot) opt.push(`rotate=${n(-o.rot)}`);
  return { opt, text: o.src.trim() || '\\phantom{x}' };
}

function styleOpts(o, closed) {
  const s = [];
  if (o.stroke) {
    s.push(`draw=${cname(o.stroke)}`, `line width=${n(o.width)}bp`);
    if (o.strokeOpacity < 1) s.push(`draw opacity=${n(o.strokeOpacity)}`);
    const d = DASHES[o.dash];
    if (d) s.push(`dash pattern=on ${n(d[0])}bp off ${n(d[1])}bp`);
    if (o.dash === 'dotted') s.push('line cap=round');
  }
  if (closed && o.fill) { s.push(`fill=${cname(o.fill)}`); if (o.fillOpacity < 1) s.push(`fill opacity=${n(o.fillOpacity)}`); }
  return s;
}
const rotAround = (o) => {
  if (!o.rot) return null;
  const f = frameOf(o);
  return `rotate around={${n(-o.rot)}:(${n((f[0] + f[2]) / 2)},${n((f[1] + f[3]) / 2)})}`;
};

function objectTikz(o, out) {
  if (o.hidden) return;
  if (o.type === 'group') { out.push('\\begin{scope}'); for (const c of o.children) objectTikz(c, out); out.push('\\end{scope}'); return; }
  if (o.type === 'rect' || o.type === 'ellipse') {
    const s = styleOpts(o, true);
    if (!s.length) return;
    if (o.type === 'rect' && o.r) s.push(`rounded corners=${n(o.r)}bp`);
    const r = rotAround(o); if (r) s.push(r);
    const body = o.type === 'rect' ? `${pt([o.x, o.y])} rectangle ${pt([o.x + o.w, o.y + o.h])}`
      : `${pt([o.x + o.w / 2, o.y + o.h / 2])} ellipse [x radius=${n(o.w / 2)}bp, y radius=${n(o.h / 2)}bp]`;
    out.push(`\\path[${s.join(', ')}] ${body};`);
    return;
  }
  if (o.type === 'line' || o.type === 'path') {
    const closed = o.type === 'path' && !!o.closed;
    const g = closed ? { pts: o.pts, heads: [] } : lineGeometry(o);
    const s = styleOpts(o, closed);
    if (s.length) out.push(`\\path[${[...s, 'line join=round'].join(', ')}] ${g.pts.map(pt).join(' -- ')}${closed ? ' -- cycle' : ''};`);
    for (const h of g.heads) out.push(`\\fill[${[`fill=${cname(o.stroke)}`, o.strokeOpacity < 1 ? `fill opacity=${n(o.strokeOpacity)}` : null].filter(Boolean).join(', ')}] ${h.map(pt).join(' -- ')} -- cycle;`);
    return;
  }
  if (o.type === 'text') {
    const { opt, text } = textNode(o);
    out.push(`\\node[${opt.join(', ')}] at ${pt([o.x, o.y])} {${text}};`);
    return;
  }
  if (o.type === 'raw') out.push(`% (an imported SVG part, ${o.id}, is not drawn in TikZ)`);
}

function coloursUsed(fig) {
  const set = new Set();
  const visit = (o) => {
    if (o.type === 'group') return o.children.forEach(visit);
    for (const k of ['stroke', 'fill', 'color']) if (typeof o[k] === 'string' && /^#[0-9a-f]{6}$/i.test(o[k]) && o[k] !== '#000000' && o[k] !== '#ffffff') set.add(o[k].toLowerCase());
  };
  fig.objects.forEach(visit);
  return [...set].sort();
}

export const INCLUDE_TAG = 'rtx-figure-include:';
/** The figure as TikZ; `scale` = \includegraphics's scale (a \scalebox around it); `include`: the
 *  \includegraphics it stands for, kept in a comment so an import puts it back (io.js). */
export function toTikz(fig, { scale = 1, name = '', include = '' } = {}) {
  const out = [`% ${name ? `${name}: ` : ''}a reflowtex figure (the SVG is the figure; this is its TikZ rendition, written by the editor)`];
  if (include) out.push(`% ${INCLUDE_TAG} ${include.replace(/\s*\n\s*/g, ' ')}`);
  const pic = [];
  pic.push('\\begin{tikzpicture}[x=1bp, y=-1bp]');
  for (const c of coloursUsed(fig)) pic.push(`\\definecolor{${cname(c)}}{HTML}{${c.slice(1).toUpperCase()}}`);
  pic.push(`\\useasboundingbox (0,0) rectangle (${n(fig.w)},${n(fig.h)});`);
  for (const o of fig.objects) objectTikz(o, pic);
  pic.push('\\end{tikzpicture}');
  if (scale && Math.abs(scale - 1) > 1e-9) { out.push(`\\scalebox{${n(scale)}}{%`, ...pic.map((l) => `  ${l}`), '}%'); } else out.push(...pic.slice(0, -1), `${pic[pic.length - 1]}%`);
  return `${out.join('\n')}\n`;
}

/** The scale a rendition was written with (the \scalebox), 1 without. */
export const scaleOfTikz = (tikz) => Number(/^\\scalebox\{([\d.]+)\}/m.exec(tikz)?.[1]) || 1;
