// Ipe geometry: matrices and path data. Ipe's coordinates are PostScript
// points (bp), y up. A matrix "a b c d e f" maps (x, y) to
// (a x + c y + e, b x + d y + f), as in PDF.
//
// Path data (the text of <path>) is numbers followed by an operator:
//   x y m           move to                 x y l        line to
//   x1 y1 x2 y2 x3 y3 c   cubic Bézier; with other than 3 points an
//                         old-style (Ipe 6) B-spline through the current point
//   x1 y1 x2 y2 q   quadratic Bézier
//   m11 m21 m12 m22 t1 t2 e        a whole ellipse (the unit circle mapped)
//   m11 m21 m12 m22 t1 t2 x y a    an arc of that ellipse to (x, y), counter-
//                                  clockwise in the unit circle's frame
//   x1 y1 … s       uniform B-spline, ends clamped
//   x1 y1 … u       closed uniform B-spline (its own subpath)
//   … C / L         cardinal spline / spiro: drawn through their points
//   h               close the subpath
// Everything becomes subpaths of M, L and C (cubic) segments, which SVG, TikZ
// and the editor all draw the same way.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function parseMatrix(s) {
  if (!s) return IDENTITY.slice();
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 6 && v.every(Number.isFinite) ? v : IDENTITY.slice();
}

/** m ∘ n: first n, then m. */
export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const translation = (dx, dy) => [1, 0, 0, 1, dx, dy];
export const det = (m) => m[0] * m[3] - m[1] * m[2];
export const isIdentity = (m) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

export function invert(m) {
  const d = det(m);
  if (!d) return IDENTITY.slice();
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

/** Keep only the translation part, as Ipe does for objects with transformations="translations". */
export const translationPart = (m) => [1, 0, 0, 1, m[4], m[5]];
/** Rigid part (rotation + translation) for transformations="rigid". */
export function rigidPart(m) {
  const a = Math.atan2(m[1], m[0]);
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), m[4], m[5]];
}

export const fmt = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
export const matrixString = (m) => m.map(fmt).join(' ');

// ── path data ────────────────────────────────────────────────────────────────

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const comb = (...terms) => terms.reduce((acc, [w, p]) => [acc[0] + w * p[0], acc[1] + w * p[1]], [0, 0]);

/** Unit-circle arc from angle a0 to a1 (a1 > a0) as cubic Béziers, mapped by m. */
function arcBeziers(m, a0, a1) {
  const out = [];
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2) - 1e-9));
  const step = (a1 - a0) / n, k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step, e = s + step;
    const p0 = [Math.cos(s), Math.sin(s)], p3 = [Math.cos(e), Math.sin(e)];
    const p1 = [p0[0] - k * p0[1], p0[1] + k * p0[0]], p2 = [p3[0] + k * p3[1], p3[1] - k * p3[0]];
    out.push({ t: 'C', p1: apply(m, p1), p2: apply(m, p2), p: apply(m, p3) });
  }
  return out;
}

/** Uniform cubic B-spline through control points (open: consecutive quadruples). */
function bsplineSegs(P) {
  const segs = [];
  for (let i = 0; i + 3 < P.length; i++) {
    const [a, b, c, d] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
    segs.push({
      t: 'C',
      p0: comb([1 / 6, a], [4 / 6, b], [1 / 6, c]),
      p1: comb([2 / 3, b], [1 / 3, c]),
      p2: comb([1 / 3, b], [2 / 3, c]),
      p: comb([1 / 6, b], [4 / 6, c], [1 / 6, d]),
    });
  }
  return segs;
}

/** Ipe's open spline through `v` (v[0] = the current point): 3 points a
 *  quadratic, 4 a cubic, more a uniform B-spline with its end points tripled. */
function openSpline(v) {
  if (v.length === 2) return [{ t: 'L', p: v[1] }];
  if (v.length === 3) return [{ t: 'C', p1: comb([1 / 3, v[0]], [2 / 3, v[1]]), p2: comb([2 / 3, v[1]], [1 / 3, v[2]]), p: v[2] }];
  if (v.length === 4) return [{ t: 'C', p1: v[1], p2: v[2], p: v[3] }];
  const P = [v[0], v[0], ...v, v[v.length - 1], v[v.length - 1]];
  return bsplineSegs(P).map(({ t, p1, p2, p }) => ({ t, p1, p2, p }));
}

/** Parse path data into subpaths [{ closed, segs: [{t:'M'|'L'|'C', p, p1?, p2?}] }]. */
export function parsePath(data) {
  const toks = data.trim().split(/\s+/).filter(Boolean);
  const subs = [];
  let cur = null, pt = null, nums = [];
  const pts = () => { const r = []; for (let i = 0; i + 1 < nums.length; i += 2) r.push([nums[i], nums[i + 1]]); return r; };
  const start = (p) => { cur = { closed: false, segs: [{ t: 'M', p }] }; subs.push(cur); pt = p; };
  for (const tk of toks) {
    const n = Number(tk);
    if (tk !== '' && Number.isFinite(n) && !/^[a-zA-Z]$/.test(tk)) { nums.push(n); continue; }
    switch (tk) {
      case 'm': start(pts().at(-1)); break;
      case 'l': for (const p of pts()) { cur.segs.push({ t: 'L', p }); pt = p; } break;
      case 'c': case 's': {
        const v = [pt, ...pts()];
        cur.segs.push(...openSpline(v));
        pt = v.at(-1);
        break;
      }
      case 'q': {
        const [c1, p] = pts();
        cur.segs.push({ t: 'C', p1: lerp(pt, c1, 2 / 3), p2: lerp(p, c1, 2 / 3), p });
        pt = p;
        break;
      }
      case 'e': {
        const m = nums.slice(0, 6);
        const segs = arcBeziers(m, 0, 2 * Math.PI);
        subs.push({ closed: true, segs: [{ t: 'M', p: apply(m, [1, 0]) }, ...segs], ellipse: m });
        cur = null;
        break;
      }
      case 'a': {
        const m = nums.slice(0, 6), end = [nums[6], nums[7]];
        const inv = invert(m), u0 = apply(inv, pt), u1 = apply(inv, end);
        let a0 = Math.atan2(u0[1], u0[0]), a1 = Math.atan2(u1[1], u1[0]);
        while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI;
        const segs = arcBeziers(m, a0, a1);
        if (segs.length) segs[segs.length - 1].p = end;
        cur.segs.push(...segs);
        pt = end;
        break;
      }
      case 'u': {
        const P = pts(), n = P.length;
        const ring = [...P, P[0], P[1], P[2]];
        const segs = bsplineSegs(ring.slice(0, n + 3));
        subs.push({ closed: true, segs: [{ t: 'M', p: segs[0].p0 }, ...segs.map(({ t, p1, p2, p }) => ({ t, p1, p2, p }))] });
        cur = null;
        break;
      }
      case 'C': case 'L': for (const p of pts()) { cur.segs.push({ t: 'L', p }); pt = p; } break;
      case 'h': if (cur) cur.closed = true; break;
      default: throw new Error(`Ipe path: unknown operator ${tk}`);
    }
    nums = [];
  }
  return subs;
}

export function transformSubpaths(subs, m) {
  const f = (p) => (p ? apply(m, p) : p);
  return subs.map((s) => ({ ...s, segs: s.segs.map((g) => ({ t: g.t, p: f(g.p), p1: f(g.p1), p2: f(g.p2) })) }));
}

export function bboxOfSubpaths(subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of subs) for (const g of s.segs) for (const p of [g.p, g.p1, g.p2]) {
    if (!p) continue;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/** Tangent direction at the end (atEnd) or start of the first/last subpath, for arrowheads. */
export function endTangent(subs, atEnd) {
  const s = atEnd ? subs.at(-1) : subs[0];
  if (!s) return null;
  const segs = s.segs;
  if (atEnd) {
    const g = segs.at(-1), prev = segs.length > 1 ? segs.at(-2).p : g.p;
    const from = g.t === 'C' ? (dist(g.p2, g.p) > 1e-9 ? g.p2 : g.p1) : prev;
    return { at: g.p, dir: norm([g.p[0] - from[0], g.p[1] - from[1]]) };
  }
  const p0 = segs[0].p, g = segs[1];
  if (!g) return null;
  const to = g.t === 'C' ? (dist(g.p1, p0) > 1e-9 ? g.p1 : g.p2) : g.p;
  return { at: p0, dir: norm([p0[0] - to[0], p0[1] - to[1]]) };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (v) => { const d = Math.hypot(v[0], v[1]) || 1; return [v[0] / d, v[1] / d]; };

/** Serialise subpaths back to Ipe path data (M/L/C only; used for new shapes). */
export function subpathsToIpe(subs) {
  const lines = [];
  for (const s of subs) {
    for (const g of s.segs) {
      if (g.t === 'M') lines.push(`${fmt(g.p[0])} ${fmt(g.p[1])} m`);
      else if (g.t === 'L') lines.push(`${fmt(g.p[0])} ${fmt(g.p[1])} l`);
      else lines.push(`${fmt(g.p1[0])} ${fmt(g.p1[1])} ${fmt(g.p2[0])} ${fmt(g.p2[1])} ${fmt(g.p[0])} ${fmt(g.p[1])} c`);
    }
    if (s.closed) lines.push('h');
  }
  return lines.join('\n');
}
