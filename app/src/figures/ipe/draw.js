// An Ipe page as a flat list of drawing primitives in page coordinates (bp,
// y up), in z-order – what both the SVG (editor, preview) and the TikZ
// rendition are written from, so the two agree:
//
//   { type: 'path', id, subs, stroke: [r,g,b]|null, fill, width, dash, opacity,
//     strokeOpacity, evenOdd, cap, join }
//   { type: 'text', id, obj, m (matrix it is drawn with), box (textBox), color,
//     sizeCmd, stretch, source }
//
// Groups are flattened (their matrices applied); symbols (<use> marks) and
// arrowheads are expanded from the style sheet's symbol definitions, with
// sym-stroke / sym-fill / sym-pen replaced by the object's own values, as Ipe
// draws them. Objects on layers the first view hides are left out.

import { parsePath, transformSubpaths, endTangent, mul, apply, IDENTITY } from './geom.js';
import { colorOf, numberOf, dashOf, visibleLayers, drawMatrix, textBox } from './model.js';

// Ipe's built-in arrow (style sheets define the others)
const NORMAL_ARROW = { attrs: {}, objects: [{ kind: 'path', attrs: { stroke: 'sym-stroke', fill: 'sym-stroke', pen: 'sym-pen' }, data: '0 0 m -1 0.333 l -1 -0.333 l h' }] };

function symbolFor(styles, prefix, name) {
  if (styles.symbol[`${prefix}/${name}`]) return styles.symbol[`${prefix}/${name}`];
  const key = Object.keys(styles.symbol).find((k) => k.startsWith(`${prefix}/${name}(`));
  return key ? styles.symbol[key] : (prefix === 'arrow' && name === 'normal' ? NORMAL_ARROW : null);
}

/** Attribute value inside a symbol: sym-* take the caller's values. */
function symAttr(v, params) {
  if (v === 'sym-stroke') return params.stroke;
  if (v === 'sym-fill') return params.fill;
  if (v === 'sym-pen') return params.pen;
  return v;
}

function pathPrim(styles, o, m, params, out, id) {
  const a = o.attrs;
  const fill = symAttr(a.fill, params);
  // Ipe strokes a path in black when it names neither a stroke nor a fill
  const stroke = symAttr(a.stroke ?? (a.fill == null ? 'black' : undefined), params);
  const penV = symAttr(a.pen, params);
  const pen = numberOf(styles, 'pen', penV, 0.4);
  const opacity = numberOf(styles, 'opacity', a.opacity, 1);
  const strokeOpacity = a['stroke-opacity'] ? numberOf(styles, 'opacity', a['stroke-opacity'], 1) : opacity;
  const dash = dashOf(styles, a.dash);
  const own = parsePath(o.data);
  const subs = transformSubpaths(own, m);
  // Ipe does not scale pens (or dashes) with the object's matrix
  const lineWidth = pen;
  out.push({
    type: 'path', id, subs,
    stroke: colorOf(styles, stroke), fill: colorOf(styles, fill),
    width: lineWidth, dash,
    opacity, strokeOpacity, evenOdd: a.fillrule === 'eofill', cap: a.cap, join: a.join,
  });
  // arrowheads: the symbol arrow/<shape>(…) scaled by the arrow size, turned along the path's end
  for (const [attr, atEnd] of [['arrow', true], ['rarrow', false]]) {
    if (!a[attr] || !colorOf(styles, stroke)) continue;
    const [shape, sizeName] = a[attr].split('/');
    const sym = symbolFor(styles, 'arrow', shape);
    const t = endTangent(subs, atEnd);
    if (!sym || !t) continue;
    const size = numberOf(styles, 'arrowsize', sizeName, 7) * (params.unscaledPen ? 1 : 1);
    const [c, s] = t.dir;
    const am = [c * size, s * size, -s * size, c * size, t.at[0], t.at[1]];
    for (const so of sym.objects) drawObject(styles, so, am, { stroke, fill: 'white', pen: penV ?? 'normal', unscaledPen: true }, out, id);
  }
}

function drawObject(styles, o, parent, params, out, id) {
  if (o.kind === 'path') return pathPrim(styles, o, mul(parent, o.attrs.matrix ? o.attrs.matrix.split(/\s+/).map(Number) : IDENTITY), params, out, id);
  if (o.kind === 'group') {
    const m = mul(parent, o.attrs.matrix ? o.attrs.matrix.split(/\s+/).map(Number) : IDENTITY);
    for (const c of o.children) drawObject(styles, c, m, params, out, id);
    return;
  }
  if (o.kind === 'use') {
    const sym = styles.symbol[o.attrs.name];
    if (!sym) return;
    const m0 = drawMatrix(parent, o, sym.attrs.transformations ?? 'affine');
    const pos = (o.attrs.pos ?? '0 0').split(/\s+/).map(Number);
    const p = apply(m0, pos);
    const size = /\(s[a-z]*\)$/.test(o.attrs.name) ? numberOf(styles, 'symbolsize', o.attrs.size, 3) : 1;
    const sm = [m0[0] * size, m0[1] * size, m0[2] * size, m0[3] * size, p[0], p[1]];
    const sp = { stroke: o.attrs.stroke ?? 'black', fill: o.attrs.fill ?? 'white', pen: o.attrs.pen ?? 'normal', unscaledPen: true };
    for (const so of sym.objects) drawObject(styles, so, sm, sp, out, id);
    return;
  }
  if (o.kind === 'text') {
    const m = drawMatrix(parent, o);
    const a = o.attrs;
    const sizeCmd = a.size ? (styles.textsize[a.size] ?? (a.size.startsWith('\\') ? a.size : null)) : null;
    const stretch = a.size ? numberOf(styles, 'textstretch', a.size, 1) : 1;
    out.push({ type: 'text', id, obj: o, m, box: textBox(null, o), color: colorOf(styles, symAttr(a.stroke ?? 'black', params)) ?? [0, 0, 0], sizeCmd, stretch, source: textSource(styles, o) });
  }
}

/** The LaTeX an Ipe text object stands for (without its size): a label in
 *  style math is $…$; a text style's begin/end wrap it. */
export function textSource(styles, o) {
  const a = o.attrs;
  let s = o.data;
  if (a.style === 'math') return `$${s}$`;
  const ts = a.style && a.style !== 'normal' ? styles.textstyle[a.style] : null;
  if (ts && a.style !== 'center') s = `${ts.begin}${s}${ts.end}`;
  return s;
}

/** Primitives of the page's visible objects, in z-order. `only`: ids to draw. */
export function drawPage(model, { includeHidden = false, only = null } = {}) {
  const vis = visibleLayers(model);
  const out = [];
  for (const o of model.page.objects) {
    if (!includeHidden && !vis.has(o.layer)) continue;
    if (only && !only.has(o.id)) continue;
    drawObject(model.styles, o, IDENTITY, { stroke: 'black', fill: 'white', pen: 'normal' }, out, o.id);
  }
  return out;
}
