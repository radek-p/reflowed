// svgfig model: a figure is { v, w, h, objects } in bp, y down, the origin at
// the figure's top-left corner (the SVG's user space). Objects, bottom first:
//   rect     { x, y, w, h, r?, rot? }             ellipse { x, y, w, h, rot? }
//   line     { pts: [[x, y], …] }  (open; 2 points: a segment)
//   path     { pts, closed? }      (a polyline or polygon)
//   text     { x, y, anchor, src, box?, tw?, align, size, color, opacity, rot? }
//            (x, y) is the text's `anchor` point (nw, n, ne, w, c, e, sw, s, se);
//            `box` (bp) makes it a text box, broken to that width; tw/th: its
//            size as last typeset (bp), for bounds before the LaTeX is back
//   group    { children: [...] }
// and every object: id, name?, hidden?, locked?, and for shapes the style:
//   stroke (hex | null), strokeOpacity, fill (hex | null), fillOpacity,
//   width (bp), dash ('solid' | 'dashed' | 'dotted'), arrowStart, arrowEnd
//   ('none' | 'latex'; line and path).
// The model is plain JSON: the saved SVG carries it (asset.js) and the
// history is copies of it.

export const K = (2 * 72.27) / 72;        // CSS px per bp at zoom 1 (the viewer draws 1 pt as 2 px)
export const SIZES = { tiny: '\\scriptsize', small: '\\small', normal: '', large: '\\large', huge: '\\Large' };
export const ANCHORS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], w: [0, 0.5], c: [0.5, 0.5], e: [1, 0.5], sw: [0, 1], s: [0.5, 1], se: [1, 1] };
export const DEFAULT_STYLE = { stroke: '#000000', strokeOpacity: 1, fill: null, fillOpacity: 1, width: 0.8, dash: 'solid', arrowStart: 'none', arrowEnd: 'none' };
const KINDS = new Set(['rect', 'ellipse', 'line', 'path', 'text', 'group']);

let counter = 0;
export const newId = () => `o${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const clone = (x) => JSON.parse(JSON.stringify(x));

export function newFigure(w = 320, h = 180) { return { v: 1, w: Math.round(w), h: Math.round(h), objects: [] }; }

/** A new object of `type` with the default style, `props` over it. */
export function make(type, props = {}) {
  if (!KINDS.has(type)) throw new Error(`svgfig: no object type ${type}`);
  const base = { id: newId(), type };
  if (type === 'text') return { ...base, x: 0, y: 0, anchor: 'nw', src: '', align: 'center', size: 'normal', color: '#000000', opacity: 1, ...props };
  if (type === 'group') return { ...base, children: [], ...props };
  const style = { ...DEFAULT_STYLE };
  if (type === 'line') style.fill = null;
  return { ...base, ...style, ...props };
}

// ── walking ───────────────────────────────────────────────────────────────
export function* walk(list, parent = null) {
  for (const o of list) { yield [o, parent]; if (o.type === 'group') yield* walk(o.children, o); }
}
export const find = (fig, id) => { for (const [o] of walk(fig.objects)) if (o.id === id) return o; return null; };
/** [list holding id, index] */
export function locate(fig, id, list = fig.objects) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return [list, i];
    if (list[i].type === 'group') { const r = locate(fig, id, list[i].children); if (r) return r; }
  }
  return null;
}
export const parentOf = (fig, id) => { for (const [o, p] of walk(fig.objects)) if (o.id === id) return p; return null; };
/** The top-level object holding id (itself when top-level). */
export function topOf(fig, id) {
  for (const o of fig.objects) { if (o.id === id) return o; if (o.type === 'group') for (const [c] of walk(o.children)) if (c.id === id) return o; }
  return null;
}

// ── geometry ──────────────────────────────────────────────────────────────
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
export { union };
const rotPts = (pts, deg, cx, cy) => {
  if (!deg) return pts;
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};
export { rotPts };
const boxOfPts = (pts) => pts.reduce((b, [x, y]) => union(b, [x, y, x, y]), null);
export { boxOfPts };

/** A text's size in bp: [w, h] (what was typeset last; a guess before). */
export function textSize(o) {
  const w = o.box ?? o.tw ?? Math.max(8, (o.src?.length ?? 1) * 5);
  return [w, o.th ?? 12];
}
/** The unrotated frame of a box-like object: [x0, y0, x1, y1]. */
export function frameOf(o) {
  if (o.type === 'rect' || o.type === 'ellipse') return [o.x, o.y, o.x + o.w, o.y + o.h];
  if (o.type === 'text') {
    const [w, h] = textSize(o), [ax, ay] = ANCHORS[o.anchor] ?? ANCHORS.nw;
    const x0 = o.x - ax * w, y0 = o.y - ay * h;
    return [x0, y0, x0 + w, y0 + h];
  }
  return boundsOf(o);
}
/** Axis-aligned bounds in bp (rotation and arrowheads included; stroke width not). */
export function boundsOf(o) {
  if (o.type === 'group') return o.children.reduce((b, c) => union(b, boundsOf(c)), null);
  if (o.type === 'line' || o.type === 'path') return boxOfPts(o.pts);
  const f = frameOf(o);
  if (!o.rot) return f;
  const cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
  return boxOfPts(rotPts([[f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]]], o.rot, cx, cy));
}
export const boundsOfAll = (objs) => objs.reduce((b, o) => union(b, o && !o.hidden ? boundsOf(o) : null), null);

export function translate(o, dx, dy) {
  if (o.type === 'group') { for (const c of o.children) translate(c, dx, dy); return; }
  if (o.pts) { o.pts = o.pts.map(([x, y]) => [x + dx, y + dy]); return; }
  o.x += dx; o.y += dy;
}

/** Map o from box `from` onto box `to` ([x0, y0, x1, y1]); text boxes take the
 *  new width (and so break again), labels keep their size and move. */
export function mapBox(o, from, to) {
  const sx = (to[2] - to[0]) / ((from[2] - from[0]) || 1), sy = (to[3] - to[1]) / ((from[3] - from[1]) || 1);
  const X = (x) => to[0] + (x - from[0]) * sx, Y = (y) => to[1] + (y - from[1]) * sy;
  if (o.type === 'group') { for (const c of o.children) mapBox(c, from, to); return; }
  if (o.pts) { o.pts = o.pts.map(([x, y]) => [X(x), Y(y)]); return; }
  if (o.type === 'text') {
    if (o.box != null) {
      const f = frameOf(o), [ax] = ANCHORS[o.anchor] ?? ANCHORS.nw;
      const nw = Math.max(12, o.box * Math.abs(sx));
      const x0 = Math.min(X(f[0]), X(f[2]));
      o.box = nw; o.x = x0 + ax * nw;
      const cy = (f[1] + f[3]) / 2, [, ay] = ANCHORS[o.anchor] ?? ANCHORS.nw;
      o.y = Y(cy) + (ay - 0.5) * (f[3] - f[1]);
    } else { o.x = X(o.x); o.y = Y(o.y); }
    return;
  }
  const cx = (o.x + o.w / 2), cy = (o.y + o.h / 2);
  if (o.rot) {
    // a rotated shape in a group resize: its centre follows, its size scales
    const w = o.w * Math.abs(sx), h = o.h * Math.abs(sy);
    o.x = X(cx) - w / 2; o.y = Y(cy) - h / 2; o.w = w; o.h = h;
    return;
  }
  const x0 = X(o.x), x1 = X(o.x + o.w), y0 = Y(o.y), y1 = Y(o.y + o.h);
  o.x = Math.min(x0, x1); o.y = Math.min(y0, y1); o.w = Math.abs(x1 - x0); o.h = Math.abs(y1 - y0);
}

/** Fresh ids for o and everything in it (paste, duplicate). */
export function reId(o) { o.id = newId(); if (o.type === 'group') o.children.forEach(reId); return o; }

/** Human names for the layers panel. */
export function describe(o) {
  if (o.name) return o.name;
  if (o.type === 'text') return (o.src || 'Text').replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}$]/g, '').trim().slice(0, 40) || 'Text';
  if (o.type === 'line') return o.arrowEnd !== 'none' || o.arrowStart !== 'none' ? 'Arrow' : 'Line';
  if (o.type === 'path') return o.closed ? 'Polygon' : 'Polyline';
  return { rect: 'Rectangle', ellipse: 'Ellipse', group: 'Group' }[o.type] ?? o.type;
}

/** A model as read back from JSON: types and fields checked, bad objects dropped. */
export function normalise(fig) {
  const out = { v: 1, w: Math.round(Number(fig?.w) || 320), h: Math.round(Number(fig?.h) || 180), objects: [] };
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const fix = (o) => {
    if (!o || !KINDS.has(o.type)) return null;
    const x = { ...o, id: typeof o.id === 'string' && o.id ? o.id : newId() };
    if (x.type === 'group') { x.children = (o.children ?? []).map(fix).filter(Boolean); return x.children.length ? x : null; }
    if (x.pts) { x.pts = x.pts.filter((p) => Array.isArray(p) && p.length === 2).map(([a, b]) => [num(a), num(b)]); if (x.pts.length < 2) return null; }
    for (const k of ['x', 'y', 'w', 'h']) if (k in x) x[k] = num(x[k]);
    return x;
  };
  out.objects = (fig?.objects ?? []).map(fix).filter(Boolean);
  return out;
}

/** Arrowhead geometry (bp) for a stroke width: the length back from the tip, half its width.
 *  (Close to TikZ's Latex arrow; drawn as a filled path in the SVG and in the TikZ both.) */
export function arrowSize(width) { const L = 2.6 + 3.6 * width; return { L, W: L * 0.36 }; }
/** The arrowhead polygon at tip `p` pointing from `q`, and where the stroke ends. */
export function arrowHead(p, q, width) {
  const { L, W } = arrowSize(width);
  const dx = p[0] - q[0], dy = p[1] - q[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  const bx = p[0] - ux * L, by = p[1] - uy * L;
  const inset = p.length ? L * 0.72 : 0;
  return {
    // tip, one barb, a slight notch towards the tip, the other barb (a Latex-like head)
    poly: [p, [bx - uy * W, by + ux * W], [p[0] - ux * L * 0.82, p[1] - uy * L * 0.82], [bx + uy * W, by - ux * W]],
    end: [p[0] - ux * Math.min(inset, d * 0.9), p[1] - uy * Math.min(inset, d * 0.9)],
  };
}
