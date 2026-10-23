// An Ipe page as a TikZ picture, the figure's rendition in the document.
// Written from the same primitives as the editor's SVG (draw.js): paths with
// their colours, pens, dashes, opacities and fill rules; marks and arrowheads
// expanded from Ipe's symbols into plain paths (so no TikZ library is
// needed and they look as Ipe draws them); text objects as \node's holding
// the same LaTeX (labels at their reference point, minipages with
// `text width`), so they are typeset with the document's fonts. The picture's
// bounding box is the PDF's box (\useasboundingbox), so the rendition takes
// exactly the space \includegraphics gave the PDF.
//
//   toTikz(model, { scale })   scale: \includegraphics's scale= (coordinates,
//                              pens and text all scaled, as the PDF would be)

import { fmt } from './geom.js';
import { figureBox } from './model.js';
import { drawPage } from './draw.js';

const CAP = { 0: 'butt', 1: 'round', 2: 'rect' }, JOIN = { 0: 'miter', 1: 'round', 2: 'bevel' };

export function toTikz(model, { scale = 1, primitives = null } = {}) {
  const k = scale;
  const prims = primitives ?? drawPage(model);
  const colors = new Map();
  const col = (c) => {
    const key = c.map((v) => fmt(Math.round(v * 10000) / 10000)).join(',');
    if (key === '0,0,0') return 'black';
    if (key === '1,1,1') return 'white';
    if (!colors.has(key)) colors.set(key, `ipec${colors.size + 1}`);
    return colors.get(key);
  };
  const pt = (p) => `(${fmt(p[0] * k)},${fmt(p[1] * k)})`;
  const body = [];
  for (const p of prims) {
    if (p.type === 'path') {
      const opts = [];
      if (p.stroke) {
        opts.push(`draw=${col(p.stroke)}`, `line width=${fmt(p.width * k)}bp`);
        if (p.strokeOpacity < 1) opts.push(`draw opacity=${fmt(p.strokeOpacity)}`);
        if (p.dash) opts.push(`dash pattern=${p.dash[0].map((v, i) => `${i % 2 ? 'off' : 'on'} ${fmt(v * k)}bp`).join(' ')}`, ...(p.dash[1] ? [`dash phase=${fmt(p.dash[1] * k)}bp`] : []));
        if (p.cap != null) opts.push(`line cap=${CAP[p.cap] ?? 'butt'}`);
        if (p.join != null) opts.push(`line join=${JOIN[p.join] ?? 'miter'}`);
      }
      if (p.fill) {
        opts.push(`fill=${col(p.fill)}`);
        if (p.opacity < 1) opts.push(`fill opacity=${fmt(p.opacity)}`);
        if (p.evenOdd) opts.push('even odd rule');
      }
      if (!opts.length) continue;
      let d = '';
      for (const s of p.subs) {
        for (const g of s.segs) {
          if (g.t === 'M') d += (d ? ' ' : '') + pt(g.p);
          else if (g.t === 'L') d += ` -- ${pt(g.p)}`;
          else d += ` .. controls ${pt(g.p1)} and ${pt(g.p2)} .. ${pt(g.p)}`;
        }
        if (s.closed) d += ' -- cycle';
      }
      body.push(`\\path[${opts.join(', ')}] ${d};`);
    } else {
      body.push(textNode(p, k, col, pt));
    }
  }
  const [x0, y0, x1, y1] = figureBox(model);
  const defs = [...colors].map(([rgb, name]) => `\\definecolor{${name}}{rgb}{${rgb}}`);
  return [
    '\\begin{tikzpicture}[x=1bp, y=1bp]',
    ...defs,
    `\\useasboundingbox (${fmt(x0 * k)},${fmt(y0 * k)}) rectangle (${fmt(x1 * k)},${fmt(y1 * k)});`,
    ...body,
    '\\end{tikzpicture}',
  ].join('\n');
}

const V = { top: 'north', bottom: 'south', center: '', baseline: 'base' };
const H = { left: 'west', right: 'east', center: '' };

function textNode(p, k, col, pt) {
  const a = p.obj.attrs, m = p.m;
  const minipage = a.type === 'minipage';
  const valign = a.valign ?? (minipage ? 'top' : 'bottom');
  const anchor = [V[valign] ?? '', H[a.halign ?? 'left'] ?? ''].filter(Boolean).join(' ') || 'center';
  const at = [m[0] * p.box.pos[0] + m[2] * p.box.pos[1] + m[4], m[1] * p.box.pos[0] + m[3] * p.box.pos[1] + m[5]];
  const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const mscale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const scale = mscale * p.stretch * k;
  const opts = ['inner sep=0pt', 'outer sep=0pt', `anchor=${anchor}`];
  if (p.color && (p.color[0] || p.color[1] || p.color[2])) opts.push(`text=${col(p.color)}`);
  if (Math.abs(angle) > 1e-6) opts.push(`rotate=${fmt(angle)}`);
  if (Math.abs(scale - 1) > 1e-6) opts.push(`scale=${fmt(scale)}`);
  if (p.sizeCmd) opts.push(`font=${p.sizeCmd}`);
  if (minipage) {
    opts.push(`text width=${fmt(Number(a.width) / p.stretch)}bp`);
    opts.push(`align=${a.style === 'center' ? 'center' : 'justify'}`);
  }
  // a label's line breaks in the XML are spaces to TeX; a blank line would end a paragraph
  const src = p.source.replace(/\n\s*\n/g, '\n');
  return `\\node[${opts.join(', ')}] at ${pt(at)} {${src}};`;
}

/** What the rendition needs in the document's preamble: TikZ, and the
 *  figure's own Ipe preamble (packages its labels use). */
export function tikzPreamble(model) {
  return ['\\usepackage{tikz}', model.styles.preamble].filter(Boolean).join('\n');
}
