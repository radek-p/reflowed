// The Ipe model: an Ipe XML document read into plain JSON the editor can
// change and write back. Everything the editor does not touch – <info>, the
// style sheets, <preamble>, bitmaps, pages after the first – is kept as the
// parsed nodes and written out as it came in; page objects keep their
// attributes in file order, so an unchanged object is written exactly as it
// was read.
//
//   model = { kind: 'ipe', xml, bbox, ipe: { attrs, head: [node], tail: [node] },
//             page: { attrs, layers: [{ name, attrs }], views: [node], objects: [obj] },
//             styles }                                 (styles: derived, see resolveStyles)
//   obj   = { id, kind: 'path'|'text'|'use'|'group'|'image'|'other', layer, attrs, data, children?, node? }
//
// `layer` is each object's effective layer. Ipe writes the attribute only when
// it changes from the previous object; writeIpe does the same.
//
// bbox = the box the figure is shown with ([x0, y0, x1, y1] in bp, from the
// PDF's CropBox), or null for a bare .ipe file (then the objects' bounds).

import { parseXml, writeXml, elements, textOf } from './xml.js';
import { parseMatrix, parsePath, transformSubpaths, bboxOfSubpaths, apply, mul, translationPart, IDENTITY } from './geom.js';

let seq = 0;
const newId = () => `o${++seq}`;

function readObject(node, layerRef) {
  const attrs = { ...node.attrs };
  if (attrs.layer) layerRef.layer = attrs.layer;
  const base = { id: newId(), layer: layerRef.layer, attrs };
  switch (node.name) {
    case 'path': return { ...base, kind: 'path', data: textOf(node) };
    case 'text': return { ...base, kind: 'text', data: textOf(node) };
    case 'use': return { ...base, kind: 'use', data: '' };
    case 'group': {
      const inner = { layer: layerRef.layer };
      return { ...base, kind: 'group', data: '', children: elements(node).map((c) => readObject(c, inner)) };
    }
    case 'image': return { ...base, kind: 'image', data: textOf(node), node };
    default: return { ...base, kind: 'other', data: '', node };
  }
}

/** Read an Ipe document. `bbox` (the PDF's CropBox) is kept with it. */
export function readIpe(xml, { bbox = null } = {}) {
  const doc = parseXml(xml);
  const ipe = elements(doc, 'ipe')[0];
  if (!ipe) throw new Error('not an Ipe document (no <ipe>)');
  const kids = elements(ipe);
  const pi = kids.findIndex((n) => n.name === 'page');
  if (pi < 0) throw new Error('Ipe document without a page');
  const pageNode = kids[pi];
  const layers = [], views = [], objects = [];
  const layerRef = { layer: null };
  for (const n of elements(pageNode)) {
    if (n.name === 'layer') layers.push({ name: n.attrs.name, attrs: { ...n.attrs } });
    else if (n.name === 'view') views.push(n);
    else objects.push(readObject(n, layerRef));
  }
  if (!layers.length) layers.push({ name: 'alpha', attrs: { name: 'alpha' } });
  const first = layers[0].name;
  const fix = (o) => { o.layer ??= first; o.children?.forEach(fix); };
  objects.forEach(fix);
  const model = {
    kind: 'ipe', xml,
    bbox,
    ipe: { attrs: { ...ipe.attrs }, head: kids.slice(0, pi), tail: kids.slice(pi + 1) },
    page: { attrs: { ...pageNode.attrs }, layers, views, objects },
  };
  model.styles = resolveStyles(model);
  return model;
}

function writeObject(o) {
  const children = o.kind === 'group' ? o.children.map(writeObject) : null;
  if (o.kind === 'other' || o.kind === 'image') return { ...o.node, attrs: { ...o.attrs } };
  const node = { name: o.kind, attrs: o.attrs, children: [] };
  if (children) node.children = children;
  else if (o.data) node.children = [o.kind === 'path' && !o.data.startsWith('\n') ? `\n${o.data}` : o.data];
  return node;
}

/** The Ipe XML of the model (what an .ipe file holds). */
export function writeIpe(model) {
  const { page } = model;
  const pageNode = { name: 'page', attrs: page.attrs, children: [] };
  for (const l of page.layers) pageNode.children.push({ name: 'layer', attrs: l.attrs, children: [] });
  pageNode.children.push(...page.views);
  let prev = null;
  for (const o of page.objects) {
    const attrs = {};
    // layer first when it changes (Ipe's own order), then the rest as read
    if (o.layer !== prev) attrs.layer = o.layer;
    for (const [k, v] of Object.entries(o.attrs)) if (k !== 'layer') attrs[k] = v;
    prev = o.layer;
    pageNode.children.push(writeObject({ ...o, attrs }));
  }
  const nl = (arr) => arr.flatMap((n) => [n, '\n']);
  const root = { name: 'ipe', attrs: model.ipe.attrs, children: ['\n', ...nl(model.ipe.head), ...nl(pageNode.children.length ? [pageNode] : []), ...nl(model.ipe.tail)] };
  // one object per line inside <page>, as Ipe writes it
  pageNode.children = pageNode.children.flatMap((c) => ['\n', c]).concat(['\n']);
  for (const c of pageNode.children) if (typeof c !== 'string' && c.name === 'path' && c.children.length && !String(c.children[0]).endsWith('\n')) c.children[0] += '\n';
  return `<?xml version="1.0"?>\n<!DOCTYPE ipe SYSTEM "ipe.dtd">\n${writeXml(root)}\n`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const BUILTIN = {
  color: { black: [0, 0, 0], white: [1, 1, 1] },
  pen: { normal: 0.4 },
  symbolsize: { normal: 3 },
  arrowsize: { normal: 7 },
  textsize: { normal: '\\normalsize' },
  textstretch: { normal: 1 },
  opacity: { opaque: 1 },
  dashstyle: { normal: null },
};

/** The style sheets' definitions, later sheets overriding earlier ones. */
export function resolveStyles(model) {
  const st = {
    color: { ...BUILTIN.color }, pen: { ...BUILTIN.pen }, symbolsize: { ...BUILTIN.symbolsize },
    arrowsize: { ...BUILTIN.arrowsize }, textsize: { ...BUILTIN.textsize }, textstretch: { ...BUILTIN.textstretch },
    opacity: { ...BUILTIN.opacity }, dashstyle: { ...BUILTIN.dashstyle }, textstyle: {}, symbol: {},
    preambles: [], layout: null,
  };
  let docPreamble = '';
  for (const n of model.ipe.head) {
    if (n.name === 'preamble') docPreamble = textOf(n);
    if (n.name !== 'ipestyle') continue;
    for (const d of elements(n)) {
      const { name, value } = d.attrs;
      switch (d.name) {
        case 'color': st.color[name] = colorValue(value); break;
        case 'pen': case 'symbolsize': case 'arrowsize': case 'textstretch': case 'opacity':
          st[d.name][name] = Number(value); break;
        case 'textsize': st.textsize[name] = value; break;
        case 'dashstyle': st.dashstyle[name] = value; break;
        case 'textstyle': st.textstyle[name] = { begin: d.attrs.begin ?? '', end: d.attrs.end ?? '' }; break;
        case 'symbol': {
          const ref = { layer: null };
          st.symbol[name] = { attrs: d.attrs, objects: elements(d).map((c) => readObject(c, ref)) };
          break;
        }
        case 'preamble': st.preambles.push(textOf(d)); break;
        case 'layout': st.layout = d.attrs; break;
        default: break;
      }
    }
  }
  st.preamble = [...st.preambles, docPreamble].filter((s) => s.trim()).join('\n');
  st.docPreamble = docPreamble;
  return st;
}

export function colorValue(v) {
  const n = String(v).trim().split(/\s+/).map(Number);
  if (n.length === 1 && Number.isFinite(n[0])) return [n[0], n[0], n[0]];
  if (n.length === 3 && n.every(Number.isFinite)) return n;
  return null;
}

/** An attribute's colour as [r, g, b] (null: none / unknown). */
export const colorOf = (styles, v) => (v == null ? null : styles.color[v] ?? colorValue(v));
export const hexOf = (c) => (c ? '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('') : null);

export function numberOf(styles, kind, v, dflt) {
  if (v == null) return dflt;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return styles[kind][v] ?? dflt;
}

/** A dash attribute as [array, offset] in bp (null: solid). */
export function dashOf(styles, v) {
  if (!v || v === 'normal') return null;
  const s = styles.dashstyle[v] ?? v;
  const m = /\[([^\]]*)\]\s*([-\d.]+)?/.exec(s ?? '');
  if (!m) return null;
  const arr = m[1].trim().split(/\s+/).filter(Boolean).map(Number);
  return arr.length ? [arr, Number(m[2] ?? 0)] : null;
}

// ── Views, geometry of objects ───────────────────────────────────────────────

/** Layers shown by the first view (all layers when there is no view). */
export function visibleLayers(model) {
  const v = model.page.views[0];
  if (!v?.attrs.layers) return new Set(model.page.layers.map((l) => l.name));
  return new Set(v.attrs.layers.trim().split(/\s+/));
}

export const objectMatrix = (o) => parseMatrix(o.attrs.matrix);

/** The matrix an object is drawn with, given its parent's: Ipe restricts
 *  objects with transformations="translations" to the translation part. */
export function drawMatrix(parent, o, transformations = o.attrs.transformations) {
  const m = mul(parent, objectMatrix(o));
  if (transformations !== 'translations') return m;
  // Ipe moves the reference point (pos) by the whole matrix but draws the
  // object with the parent's linear part only: this maps pos where m does
  const pos = (o.attrs.pos ?? '0 0').split(/\s+/).map(Number);
  const p = apply(m, pos);
  const L = parent;
  return [L[0], L[1], L[2], L[3], p[0] - (L[0] * pos[0] + L[2] * pos[1]), p[1] - (L[1] * pos[0] + L[3] * pos[1])];
}

/** Approximate bounds of an object in page coordinates ([x0, y0, x1, y1]). */
export function objectBounds(model, o, parent = IDENTITY) {
  const m = mul(parent, objectMatrix(o));
  switch (o.kind) {
    case 'path': return bboxOfSubpaths(transformSubpaths(parsePath(o.data), m));
    case 'group': {
      let b = null;
      for (const c of o.children) b = union(b, objectBounds(model, c, m));
      return b;
    }
    case 'use': {
      const p = apply(m, (o.attrs.pos ?? '0 0').split(/\s+/).map(Number));
      const s = numberOf(model.styles, 'symbolsize', o.attrs.size, 3);
      return [p[0] - s, p[1] - s, p[0] + s, p[1] + s];
    }
    case 'text': {
      const tm = drawMatrix(parent, o);
      const box = textBox(model, o);
      const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map((p) => apply(tm, p));
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    }
    default: return null;
  }
}

export const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

/** A text object's box in its own frame (before its matrix), from the
 *  width/height/depth Ipe stored and its alignment. */
export function textBox(model, o) {
  const a = o.attrs;
  const pos = (a.pos ?? '0 0').split(/\s+/).map(Number);
  const w = Number(a.width ?? 0), h = Number(a.height ?? 0), d = Number(a.depth ?? 0);
  const minipage = a.type === 'minipage';
  const halign = a.halign ?? 'left';
  const valign = a.valign ?? (minipage ? 'top' : 'bottom');
  const dx = halign === 'center' ? -w / 2 : halign === 'right' ? -w : 0;
  // height/depth are TeX's, about the box's baseline (a minipage is centred on the
  // math axis, so its "baseline" is near its middle): the box is height + depth tall
  const total = h + d;
  let top;
  if (valign === "top") top = 0;
  else if (valign === "center") top = total / 2;
  else if (valign === "bottom") top = total;
  else top = h;                                          // baseline
  return { x0: pos[0] + dx, x1: pos[0] + dx + w, y1: pos[1] + top, y0: pos[1] + top - total, pos, w, total, valign, halign };
}

/** The page's bounds: the PDF box when known, else the visible objects' bounds. */
export function figureBox(model) {
  if (model.bbox) return model.bbox;
  const vis = visibleLayers(model);
  let b = null;
  for (const o of model.page.objects) if (vis.has(o.layer)) b = union(b, objectBounds(model, o));
  return b ?? [0, 0, 100, 100];
}
