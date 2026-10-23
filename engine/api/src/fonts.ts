// Font metrics the XDV and the log leave out, read from the font files the
// engine used (in the browser: the files in its virtual file system).
//   * TFM: widths, heights, depths, italic corrections, scaled exactly as TeX
//     scales them (store_scaled, TeX §571–572) – what XeTeX used, and what
//     LuaTeX's TFM reader produces too;
//   * OpenType: cmap (glyph → character), hmtx (nominal advances), name
//     (PostScript name), and each glyph's outline bounds (CFF charstrings or
//     glyf), scaled as luaotfload scales them, for the height and depth
//     LuaTeX's capture gives every glyph.
// Pure: bytes in, tables out.

// ── TFM ─────────────────────────────────────────────────────────────────────

export interface TfmChar { width: number; height: number; depth: number; italic: number }
export interface Tfm { designSize: number; chars: Map<number, (at: number) => TfmChar>; params: number[]; scaled(at: number): Map<number, TfmChar> }

/** TeX's fix_word × at-size, bit-exact (TeX §571–572 store_scaled). */
export function texScale(fix: number, z0: number): number {
  let z = z0, alpha = 16;
  while (z >= 0o40000000) { z = Math.trunc(z / 2); alpha += alpha; }
  const beta = Math.trunc(256 / alpha);
  alpha *= z;
  const b = [(fix >>> 24) & 255, (fix >>> 16) & 255, (fix >>> 8) & 255, fix & 255];
  const sw = Math.trunc((Math.trunc((Math.trunc(b[3] * z / 256) + b[2] * z) / 256) + b[1] * z) / beta);
  if (b[0] === 0) return sw;
  if (b[0] === 255) return sw - alpha;
  throw new Error('tfm: bad fix_word');
}

export function readTfm(bytes: Uint8Array): Tfm {
  const w = (i: number) => ((bytes[4 * i] << 24) | (bytes[4 * i + 1] << 16) | (bytes[4 * i + 2] << 8) | bytes[4 * i + 3]) >>> 0;
  const h16 = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  const lh = h16(2), bc = h16(4), ec = h16(6), nw = h16(8), nh = h16(10), nd = h16(12), ni = h16(14);
  const nl = h16(16), nk = h16(18), ne = h16(20), np = h16(22);
  const header = 6;
  const charBase = header + lh;
  const widthBase = charBase + (ec - bc + 1);
  const heightBase = widthBase + nw, depthBase = heightBase + nh, italicBase = depthBase + nd;
  const paramBase = italicBase + ni + nl + nk + ne;
  const designSize = Math.trunc(w(header + 1) / 16);   // fix_word pt → sp (TeX: z / 16)
  const signed = (x: number) => (x | 0);
  const info = new Map<number, [number, number, number, number]>();
  for (let c = bc; c <= ec; c++) {
    const ci = w(charBase + c - bc);
    const wi = ci >>> 24;
    if (wi === 0) continue;
    info.set(c, [wi, (ci >>> 20) & 15, (ci >>> 16) & 15, (ci >>> 10) & 63]);
  }
  const params: number[] = [];
  for (let i = 1; i <= np; i++) params.push(signed(w(paramBase + i - 1)));
  const cache = new Map<number, Map<number, TfmChar>>();
  const scaled = (at: number): Map<number, TfmChar> => {
    let m = cache.get(at);
    if (m) return m;
    m = new Map();
    for (const [c, [wi, hi, di, ii]] of info) {
      m.set(c, {
        width: texScale(w(widthBase + wi), at),
        height: texScale(w(heightBase + hi), at),
        depth: texScale(w(depthBase + di), at),
        italic: texScale(w(italicBase + ii), at),
      });
    }
    cache.set(at, m);
    return m;
  };
  const chars = new Map<number, (at: number) => TfmChar>();
  for (const c of info.keys()) chars.set(c, (at: number) => scaled(at).get(c)!);
  return { designSize, chars, params, scaled };
}

// ── OpenType ────────────────────────────────────────────────────────────────

export interface Bounds { xMin: number; yMin: number; xMax: number; yMax: number }
export interface Otf {
  unitsPerEm: number;
  psName: string;
  numGlyphs: number;
  advance(gid: number): number;             // font units
  bounds(gid: number): Bounds | null;       // font units; null for an empty glyph
  cmap: Map<number, number>;                // code point → gid
  reverse: Map<number, number[]>;           // gid → code points (ascending)
}

type B = Uint8Array;
const u8 = (b: B, o: number) => b[o];
const u16 = (b: B, o: number) => (b[o] << 8) | b[o + 1];
const i16 = (b: B, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: B, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

export function readOtf(bytes: Uint8Array): Otf {
  const tables = new Map<string, B>();
  const n = u16(bytes, 4);
  for (let i = 0; i < n; i++) {
    const r = 12 + 16 * i;
    const tag = String.fromCharCode(bytes[r], bytes[r + 1], bytes[r + 2], bytes[r + 3]);
    tables.set(tag, bytes.subarray(u32(bytes, r + 8), u32(bytes, r + 8) + u32(bytes, r + 12)));
  }
  const head = tables.get('head')!, hhea = tables.get('hhea')!, hmtx = tables.get('hmtx')!, maxp = tables.get('maxp')!;
  const unitsPerEm = u16(head, 18);
  const numGlyphs = u16(maxp, 4);
  const numHMetrics = u16(hhea, 34);
  const advance = (g: number) => u16(hmtx, 4 * Math.min(g, numHMetrics - 1));

  // cmap: prefer a full-repertoire (format 12) subtable, else format 4
  const cmap = new Map<number, number>();
  const ct = tables.get('cmap');
  if (ct) {
    const subs: { fmt: number; off: number; pid: number; eid: number }[] = [];
    for (let i = 0; i < u16(ct, 2); i++) {
      const pid = u16(ct, 4 + 8 * i), eid = u16(ct, 6 + 8 * i), off = u32(ct, 8 + 8 * i);
      subs.push({ pid, eid, off, fmt: u16(ct, off) });
    }
    const pick = subs.find(s => s.fmt === 12 && (s.pid === 3 || s.pid === 0))
      ?? subs.find(s => s.fmt === 4 && ((s.pid === 3 && s.eid === 1) || s.pid === 0));
    if (pick?.fmt === 12) {
      const o = pick.off, groups = u32(ct, o + 12);
      for (let g = 0; g < groups; g++) {
        const start = u32(ct, o + 16 + 12 * g), end = u32(ct, o + 20 + 12 * g), gid = u32(ct, o + 24 + 12 * g);
        for (let c = start; c <= end; c++) cmap.set(c, gid + c - start);
      }
    } else if (pick?.fmt === 4) {
      const o = pick.off, segX2 = u16(ct, o + 6);
      const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = u16(ct, ends + 2 * s), start = u16(ct, starts + 2 * s);
        const delta = i16(ct, deltas + 2 * s), ro = u16(ct, ranges + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const gi = u16(ct, ranges + 2 * s + ro + 2 * (c - start));
            g = gi === 0 ? 0 : (gi + delta) & 0xffff;
          }
          if (g) cmap.set(c, g);
        }
      }
    }
  }
  const reverse = new Map<number, number[]>();
  for (const [c, g] of [...cmap].sort((a, b) => a[0] - b[0])) {
    if (!reverse.has(g)) reverse.set(g, []);
    reverse.get(g)!.push(c);
  }

  // PostScript name (name id 6)
  let psName = '';
  const nt = tables.get('name');
  if (nt) {
    const count = u16(nt, 2), strOff = u16(nt, 4);
    for (let i = 0; i < count; i++) {
      const r = 6 + 12 * i;
      const pid = u16(nt, r), nid = u16(nt, r + 6), len = u16(nt, r + 8), off = u16(nt, r + 10);
      if (nid !== 6) continue;
      const s = nt.subarray(strOff + off, strOff + off + len);
      if (pid === 1) psName = String.fromCharCode(...s);
      else { let t = ''; for (let k = 0; k + 1 < s.length; k += 2) t += String.fromCharCode(u16(s, k)); psName = t; }
      if (pid === 3) break;
    }
  }

  let bounds: (g: number) => Bounds | null = () => null;
  if (tables.has('CFF ')) bounds = cffBounds(tables.get('CFF ')!);
  else if (tables.has('glyf')) {
    const glyf = tables.get('glyf')!, loca = tables.get('loca')!;
    const long = i16(head, 50) === 1;
    bounds = (g: number) => {
      const a = long ? u32(loca, 4 * g) : 2 * u16(loca, 2 * g);
      const b = long ? u32(loca, 4 * g + 4) : 2 * u16(loca, 2 * g + 2);
      if (b <= a) return null;
      return { xMin: i16(glyf, a + 2), yMin: i16(glyf, a + 4), xMax: i16(glyf, a + 6), yMax: i16(glyf, a + 8) };
    };
  }
  const memo = new Map<number, Bounds | null>();
  return {
    unitsPerEm, psName, numGlyphs, advance, cmap, reverse,
    bounds: (g: number) => { if (!memo.has(g)) memo.set(g, bounds(g)); return memo.get(g)!; },
  };
}

// ── CFF charstrings (Type 2) → outline bounds ───────────────────────────────
// The bounds of the outline itself: on-curve points and the extrema of each
// Bézier segment, rounded outwards to whole units (what LuaTeX's font loader
// computes for a glyph's boundingbox).

function readIndex(b: B, o: number): { items: B[]; end: number } {
  const count = u16(b, o);
  if (count === 0) return { items: [], end: o + 2 };
  const offSize = u8(b, o + 2);
  const off = (i: number) => { let v = 0; for (let k = 0; k < offSize; k++) v = v * 256 + b[o + 3 + i * offSize + k]; return v; };
  const base = o + 3 + (count + 1) * offSize - 1;
  const items: B[] = [];
  for (let i = 0; i < count; i++) items.push(b.subarray(base + off(i), base + off(i + 1)));
  return { items, end: base + off(count) };
}

function readDict(d: B): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let ops: number[] = [];
  for (let i = 0; i < d.length;) {
    const b0 = d[i];
    if (b0 <= 21) {
      let key = b0; i++;
      if (b0 === 12) key = 1200 + d[i++];
      out.set(key, ops); ops = [];
    } else if (b0 === 28) { ops.push(i16(d, i + 1)); i += 3; }
    else if (b0 === 29) { ops.push(u32(d, i + 1) | 0); i += 5; }
    else if (b0 === 30) {
      let s = ''; i++;
      const nib = '0123456789.EE?-?';
      for (;;) {
        const x = d[i++]; const a = x >> 4, c = x & 15;
        if (a === 15) break; s += a === 12 ? 'E-' : nib[a];
        if (c === 15) break; s += c === 12 ? 'E-' : nib[c];
      }
      ops.push(parseFloat(s));
    } else if (b0 >= 32 && b0 <= 246) { ops.push(b0 - 139); i++; }
    else if (b0 >= 247 && b0 <= 250) { ops.push((b0 - 247) * 256 + d[i + 1] + 108); i += 2; }
    else if (b0 >= 251 && b0 <= 254) { ops.push(-(b0 - 251) * 256 - d[i + 1] - 108); i += 2; }
    else i++;
  }
  return out;
}

const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

function cffBounds(cff: B): (g: number) => Bounds | null {
  const hdrSize = u8(cff, 2);
  const names = readIndex(cff, hdrSize);
  const tops = readIndex(cff, names.end);
  const strings = readIndex(cff, tops.end);
  const gsubrs = readIndex(cff, strings.end).items;
  const top = readDict(tops.items[0]);
  const charStrings = readIndex(cff, top.get(17)![0]).items;
  const privFor = (dict: Map<number, number[]>): B[] => {
    const p = dict.get(18);
    if (!p) return [];
    const [size, off] = p;
    const priv = readDict(cff.subarray(off, off + size));
    const s = priv.get(19);
    return s ? readIndex(cff, off + s[0]).items : [];
  };
  let subrsFor: (g: number) => B[];
  if (top.has(1236)) {            // CID-keyed: FDArray + FDSelect
    const fds = readIndex(cff, top.get(1236)![0]).items.map(d => privFor(readDict(d)));
    const sel = top.get(1237)![0];
    const fmt = u8(cff, sel);
    subrsFor = (g: number) => {
      if (fmt === 0) return fds[u8(cff, sel + 1 + g)];
      const nr = u16(cff, sel + 1);
      for (let r = 0; r < nr; r++) {
        const first = u16(cff, sel + 3 + 3 * r), next = u16(cff, sel + 3 + 3 * (r + 1));
        if (g >= first && g < next) return fds[u8(cff, sel + 5 + 3 * r)];
      }
      return fds[0];
    };
  } else {
    const subrs = privFor(top);
    subrsFor = () => subrs;
  }

  return (g: number) => {
    const cs = charStrings[g];
    if (!cs) return null;
    const subrs = subrsFor(g);
    let x = 0, y = 0, open = false, nStems = 0, haveWidth = false;
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    const pt = (px: number, py: number) => {
      if (px < xMin) xMin = px; if (px > xMax) xMax = px;
      if (py < yMin) yMin = py; if (py > yMax) yMax = py;
    };
    const ext = (p0: number, p1: number, p2: number, p3: number, cb: (v: number) => void) => {
      // extrema of a cubic Bézier coordinate on (0,1)
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
      const roots: number[] = [];
      if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) roots.push(-c / b); }
      else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) { const s = Math.sqrt(disc); roots.push((-b + s) / (2 * a), (-b - s) / (2 * a)); }
      }
      for (const t of roots) if (t > 0 && t < 1) {
        const mt = 1 - t;
        cb(mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3);
      }
    };
    const moveTo = (dx: number, dy: number) => { x += dx; y += dy; open = true; pt(x, y); };
    const lineTo = (dx: number, dy: number) => { x += dx; y += dy; pt(x, y); };
    const curveTo = (dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number) => {
      const x0 = x, y0 = y, x1 = x0 + dx1, y1 = y0 + dy1, x2 = x1 + dx2, y2 = y1 + dy2, x3 = x2 + dx3, y3 = y2 + dy3;
      ext(x0, x1, x2, x3, v => pt(v, y0));      // only the coordinate matters for the bound
      ext(y0, y1, y2, y3, v => pt(x0, v));
      x = x3; y = y3; pt(x, y);
    };
    let stack: number[] = [];
    const run = (code: B, depth: number): boolean => {
      for (let i = 0; i < code.length;) {
        const b0 = code[i];
        if (b0 >= 32 || b0 === 28) {
          if (b0 === 28) { stack.push(i16(code, i + 1)); i += 3; }
          else if (b0 <= 246) { stack.push(b0 - 139); i++; }
          else if (b0 <= 250) { stack.push((b0 - 247) * 256 + code[i + 1] + 108); i += 2; }
          else if (b0 <= 254) { stack.push(-(b0 - 251) * 256 - code[i + 1] - 108); i += 2; }
          else { stack.push((u32(code, i + 1) | 0) / 65536); i += 5; }
          continue;
        }
        i++;
        const takeWidth = (even: boolean) => {
          if (!haveWidth) { haveWidth = true; if ((stack.length % 2 === 1) === even) stack.shift(); }
        };
        switch (b0) {
          case 1: case 3: case 18: case 23: takeWidth(true); nStems += stack.length >> 1; stack = []; break;
          case 19: case 20: takeWidth(true); nStems += stack.length >> 1; stack = []; i += (nStems + 7) >> 3; break;
          case 21: takeWidth(true); moveTo(stack[0], stack[1]); stack = []; break;
          case 22: if (!haveWidth) { haveWidth = true; if (stack.length > 1) stack.shift(); } moveTo(stack[0], 0); stack = []; break;
          case 4: if (!haveWidth) { haveWidth = true; if (stack.length > 1) stack.shift(); } moveTo(0, stack[0]); stack = []; break;
          case 5: for (let k = 0; k + 1 < stack.length; k += 2) lineTo(stack[k], stack[k + 1]); stack = []; break;
          case 6: case 7: {
            let horiz = b0 === 6;
            for (const v of stack) { if (horiz) lineTo(v, 0); else lineTo(0, v); horiz = !horiz; }
            stack = []; break;
          }
          case 8: for (let k = 0; k + 5 < stack.length; k += 6) curveTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5]); stack = []; break;
          case 24: {
            let k = 0;
            for (; k + 5 < stack.length - 2; k += 6) curveTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5]);
            lineTo(stack[k], stack[k + 1]); stack = []; break;
          }
          case 25: {
            let k = 0;
            for (; k + 1 < stack.length - 6; k += 2) lineTo(stack[k], stack[k + 1]);
            curveTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5]); stack = []; break;
          }
          case 26: {           // vvcurveto
            let k = 0, dx1 = 0;
            if (stack.length % 4 === 1) { dx1 = stack[0]; k = 1; }
            for (; k + 3 < stack.length; k += 4) { curveTo(dx1, stack[k], stack[k + 1], stack[k + 2], 0, stack[k + 3]); dx1 = 0; }
            stack = []; break;
          }
          case 27: {           // hhcurveto
            let k = 0, dy1 = 0;
            if (stack.length % 4 === 1) { dy1 = stack[0]; k = 1; }
            for (; k + 3 < stack.length; k += 4) { curveTo(stack[k], dy1, stack[k + 1], stack[k + 2], stack[k + 3], 0); dy1 = 0; }
            stack = []; break;
          }
          case 30: case 31: {  // vhcurveto / hvcurveto
            let horiz = b0 === 31;
            for (let k = 0; k + 3 < stack.length; k += 4) {
              const last = k + 4 >= stack.length - 1 ? (stack.length - (k + 4) === 1 ? stack[k + 4] : 0) : 0;
              if (horiz) curveTo(stack[k], 0, stack[k + 1], stack[k + 2], last, stack[k + 3]);
              else curveTo(0, stack[k], stack[k + 1], stack[k + 2], stack[k + 3], last);
              horiz = !horiz;
            }
            stack = []; break;
          }
          case 10: { const idx = stack.pop()! + bias(subrs.length); if (run(subrs[idx], depth + 1)) return true; break; }
          case 29: { const idx = stack.pop()! + bias(gsubrs.length); if (run(gsubrs[idx], depth + 1)) return true; break; }
          case 11: return false;
          case 14: takeWidth(true); stack = []; return true;
          case 12: {
            const op2 = code[i++];
            const s = stack;
            if (op2 === 35) { curveTo(s[0], s[1], s[2], s[3], s[4], s[5]); curveTo(s[6], s[7], s[8], s[9], s[10], s[11]); }
            else if (op2 === 34) { curveTo(s[0], 0, s[1], s[2], s[3], 0); curveTo(s[4], 0, s[5], -s[2], s[6], 0); }
            else if (op2 === 36) { curveTo(s[0], s[1], s[2], s[3], s[4], 0); curveTo(s[5], 0, s[6], s[7], s[8], -(s[1] + s[3] + s[7])); }
            else if (op2 === 37) {
              const dx = s[0] + s[2] + s[4] + s[6] + s[8], dy = s[1] + s[3] + s[5] + s[7] + s[9];
              const x0 = x, y0 = y;
              curveTo(s[0], s[1], s[2], s[3], s[4], s[5]);
              if (Math.abs(dx) > Math.abs(dy)) curveTo(s[6], s[7], s[8], s[9], s[10], y0 - (y + s[7] + s[9]));
              else curveTo(s[6], s[7], s[8], s[9], x0 - (x + s[6] + s[8]), s[10]);
            }
            stack = []; break;
          }
          default: stack = []; break;
        }
      }
      return false;
    };
    run(cs, 0);
    void open;
    if (xMin === Infinity) return null;
    // outward to whole units, as LuaTeX's font loader stores a boundingbox
    // (a curve's extremum at 624.25 is 625: LM Mono's circumflex)
    const e = 1e-7;
    return { xMin: Math.floor(xMin + e), yMin: Math.floor(yMin + e), xMax: Math.ceil(xMax - e), yMax: Math.ceil(yMax - e) };
  };
}
