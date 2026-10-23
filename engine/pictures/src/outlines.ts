// Glyph outlines for the labels of a picture, from the font files the engine
// used: OpenType with CFF (Type 2 charstrings) or TrueType (glyf) outlines,
// and classic Type 1 fonts (.pfb, which XeTeX's TFM fonts – Computer Modern
// in mathematics – are drawn with). dvisvgm --no-fonts draws the labels of a
// LuaTeX picture as paths; so do these. Pure: bytes in, commands out.
//
// Type 1 follows the public repo's src/pipeline/fonts/type1.ts (itself
// fontTools' T1OutlineExtractor), without Buffer and fs so it runs in the
// capture's worker; tests/outlines.test.ts checks the two agree glyph by
// glyph.

export type Cmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number] | ['Z'];
/** One glyph's outline in font units (y up), and the font's units per em. */
export interface Outline { cmds: Cmd[]; upem: number }

type B = Uint8Array;
const u16 = (b: B, o: number) => (b[o] << 8) | b[o + 1];
const i16 = (b: B, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: B, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

// ── OpenType ────────────────────────────────────────────────────────────────

export interface OtfOutlines { upem: number; glyph(gid: number): Cmd[] | null }

export function otfOutlines(bytes: B, faceIndex = 0): OtfOutlines {
  let base = 0;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'ttcf') base = u32(bytes, 12 + 4 * faceIndex);
  const tables = new Map<string, B>();
  const n = u16(bytes, base + 4);
  for (let i = 0; i < n; i++) {
    const r = base + 12 + 16 * i;
    const tag = String.fromCharCode(bytes[r], bytes[r + 1], bytes[r + 2], bytes[r + 3]);
    tables.set(tag, bytes.subarray(u32(bytes, r + 8), u32(bytes, r + 8) + u32(bytes, r + 12)));
  }
  const head = tables.get('head')!;
  const upem = u16(head, 18);
  let glyph: (g: number) => Cmd[] | null = () => null;
  if (tables.has('CFF ')) glyph = cffGlyphs(tables.get('CFF ')!);
  else if (tables.has('glyf')) glyph = glyfGlyphs(tables.get('glyf')!, tables.get('loca')!, i16(head, 50) === 1);
  const memo = new Map<number, Cmd[] | null>();
  return { upem, glyph: g => { if (!memo.has(g)) memo.set(g, glyph(g)); return memo.get(g)!; } };
}

function readIndex(b: B, o: number): { items: B[]; end: number } {
  const count = u16(b, o);
  if (count === 0) return { items: [], end: o + 2 };
  const offSize = b[o + 2];
  const off = (i: number) => { let v = 0; for (let k = 0; k < offSize; k++) v = v * 256 + b[o + 3 + i * offSize + k]; return v; };
  const start = o + 3 + (count + 1) * offSize - 1;
  const items: B[] = [];
  for (let i = 0; i < count; i++) items.push(b.subarray(start + off(i), start + off(i + 1)));
  return { items, end: start + off(count) };
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

/** Type 2 charstrings → absolute outline commands (the operators as the CFF
 *  spec defines them; opentype.js's parser is the model). */
function cffGlyphs(cff: B): (g: number) => Cmd[] | null {
  const names = readIndex(cff, cff[2]);
  const tops = readIndex(cff, names.end);
  const strings = readIndex(cff, tops.end);
  const gsubrs = readIndex(cff, strings.end).items;
  const top = readDict(tops.items[0]);
  const charStrings = readIndex(cff, top.get(17)![0]).items;
  const privSubrs = (dict: Map<number, number[]>): B[] => {
    const pr = dict.get(18);
    if (!pr) return [];
    const [size, off] = pr;
    const s = readDict(cff.subarray(off, off + size)).get(19);
    return s ? readIndex(cff, off + s[0]).items : [];
  };
  let subrsFor: (g: number) => B[];
  if (top.has(1236)) {
    const fds = readIndex(cff, top.get(1236)![0]).items.map(d => privSubrs(readDict(d)));
    const sel = top.get(1237)![0];
    const fmt = cff[sel];
    subrsFor = (g: number) => {
      if (fmt === 0) return fds[cff[sel + 1 + g]];
      const nr = u16(cff, sel + 1);
      for (let r = 0; r < nr; r++) {
        const first = u16(cff, sel + 3 + 3 * r), next = u16(cff, sel + 3 + 3 * (r + 1));
        if (g >= first && g < next) return fds[cff[sel + 5 + 3 * r]];
      }
      return fds[0];
    };
  } else { const s = privSubrs(top); subrsFor = () => s; }

  return (g: number) => {
    const cs = charStrings[g];
    if (!cs) return null;
    const subrs = subrsFor(g);
    const out: Cmd[] = [];
    let x = 0, y = 0, open = false, nStems = 0, haveWidth = false;
    let st: number[] = [];
    const close = () => { if (open) out.push(['Z']); open = false; };
    const moveTo = (dx: number, dy: number) => { close(); x += dx; y += dy; out.push(['M', x, y]); open = true; };
    const lineTo = (dx: number, dy: number) => { x += dx; y += dy; out.push(['L', x, y]); };
    const curve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      out.push(['C', x1, y1, x2, y2, x3, y3]); x = x3; y = y3;
    };
    const rcurve = (a: number, b: number, c: number, d: number, e: number, f: number) => {
      const x1 = x + a, y1 = y + b, x2 = x1 + c, y2 = y1 + d; curve(x1, y1, x2, y2, x2 + e, y2 + f);
    };
    const width = (odd: boolean) => { if (!haveWidth) { haveWidth = true; if ((st.length % 2 === 1) === odd) st.shift(); } };
    const run = (code: B, depth: number): boolean => {
      if (depth > 10) return true;
      for (let i = 0; i < code.length;) {
        const b0 = code[i];
        if (b0 >= 32 || b0 === 28) {
          if (b0 === 28) { st.push(i16(code, i + 1)); i += 3; }
          else if (b0 <= 246) { st.push(b0 - 139); i++; }
          else if (b0 <= 250) { st.push((b0 - 247) * 256 + code[i + 1] + 108); i += 2; }
          else if (b0 <= 254) { st.push(-(b0 - 251) * 256 - code[i + 1] - 108); i += 2; }
          else { st.push((u32(code, i + 1) | 0) / 65536); i += 5; }
          continue;
        }
        i++;
        switch (b0) {
          case 1: case 3: case 18: case 23: width(true); nStems += st.length >> 1; st = []; break;
          case 19: case 20: width(true); nStems += st.length >> 1; st = []; i += (nStems + 7) >> 3; break;
          case 21: width(true); moveTo(st[st.length - 2], st[st.length - 1]); st = []; break;
          case 22: if (!haveWidth) { haveWidth = true; if (st.length > 1) st.shift(); } moveTo(st[0], 0); st = []; break;
          case 4: if (!haveWidth) { haveWidth = true; if (st.length > 1) st.shift(); } moveTo(0, st[0]); st = []; break;
          case 5: for (let k = 0; k + 1 < st.length; k += 2) lineTo(st[k], st[k + 1]); st = []; break;
          case 6: case 7: {
            let horiz = b0 === 6;
            for (const v of st) { if (horiz) lineTo(v, 0); else lineTo(0, v); horiz = !horiz; }
            st = []; break;
          }
          case 8: for (let k = 0; k + 5 < st.length; k += 6) rcurve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]); st = []; break;
          case 24: {                               // rcurveline
            let k = 0;
            for (; k + 7 < st.length; k += 6) rcurve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
            lineTo(st[k], st[k + 1]); st = []; break;
          }
          case 25: {                               // rlinecurve
            let k = 0;
            for (; k + 7 < st.length; k += 2) lineTo(st[k], st[k + 1]);
            rcurve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]); st = []; break;
          }
          case 26: {                               // vvcurveto
            let k = 0, dx1 = 0;
            if (st.length % 2) { dx1 = st[0]; k = 1; }
            for (; k + 3 < st.length; k += 4) { rcurve(dx1, st[k], st[k + 1], st[k + 2], 0, st[k + 3]); dx1 = 0; }
            st = []; break;
          }
          case 27: {                               // hhcurveto
            let k = 0, dy1 = 0;
            if (st.length % 2) { dy1 = st[0]; k = 1; }
            for (; k + 3 < st.length; k += 4) { rcurve(st[k], dy1, st[k + 1], st[k + 2], st[k + 3], 0); dy1 = 0; }
            st = []; break;
          }
          case 30: case 31: {                      // vhcurveto, hvcurveto
            let horiz = b0 === 31;
            for (let k = 0; k + 3 < st.length; k += 4) {
              const last = st.length - k === 5 ? st[k + 4] : 0;
              if (horiz) rcurve(st[k], 0, st[k + 1], st[k + 2], last, st[k + 3]);
              else rcurve(0, st[k], st[k + 1], st[k + 2], st[k + 3], last);
              horiz = !horiz;
            }
            st = []; break;
          }
          case 10: { const k = st.pop()! + bias(subrs.length); if (run(subrs[k], depth + 1)) return true; break; }
          case 29: { const k = st.pop()! + bias(gsubrs.length); if (run(gsubrs[k], depth + 1)) return true; break; }
          case 11: return false;
          case 14: width(true); close(); st = []; return true;
          case 12: {
            const op2 = code[i++];
            const s = st;
            if (op2 === 35) {                       // flex
              rcurve(s[0], s[1], s[2], s[3], s[4], s[5]); rcurve(s[6], s[7], s[8], s[9], s[10], s[11]);
            } else if (op2 === 34) {                // hflex
              const y0 = y;
              const c1x = x + s[0], c1y = y, c2x = c1x + s[1], c2y = c1y + s[2], jx = c2x + s[3];
              curve(c1x, c1y, c2x, c2y, jx, c2y);
              const c3x = jx + s[4], c4x = c3x + s[5];
              curve(c3x, c2y, c4x, y0, c4x + s[6], y0);
            } else if (op2 === 36) {                // hflex1
              const y0 = y;
              const c1x = x + s[0], c1y = y + s[1], c2x = c1x + s[2], c2y = c1y + s[3], jx = c2x + s[4];
              curve(c1x, c1y, c2x, c2y, jx, c2y);
              const c3x = jx + s[5], c3y = c2y, c4x = c3x + s[6], c4y = c3y + s[7];
              curve(c3x, c3y, c4x, c4y, c4x + s[8], y0);
            } else if (op2 === 37) {                // flex1
              const x0 = x, y0 = y;
              const c1x = x + s[0], c1y = y + s[1], c2x = c1x + s[2], c2y = c1y + s[3], jx = c2x + s[4], jy = c2y + s[5];
              curve(c1x, c1y, c2x, c2y, jx, jy);
              const c3x = jx + s[6], c3y = jy + s[7], c4x = c3x + s[8], c4y = c3y + s[9];
              const dx = c4x - x0, dy = c4y - y0;
              if (Math.abs(dx) > Math.abs(dy)) curve(c3x, c3y, c4x, c4y, c4x + s[10], y0);
              else curve(c3x, c3y, c4x, c4y, x0, c4y + s[10]);
            }
            st = []; break;
          }
          default: st = []; break;
        }
      }
      return false;
    };
    run(cs, 0);
    close();
    return out;
  };
}

/** TrueType quadratic outlines, composites included (offsets as x/y values;
 *  point matching is not supported and places the component unshifted). */
function glyfGlyphs(glyf: B, loca: B, long: boolean): (g: number) => Cmd[] | null {
  const range = (g: number): [number, number] => long
    ? [u32(loca, 4 * g), u32(loca, 4 * g + 4)]
    : [2 * u16(loca, 2 * g), 2 * u16(loca, 2 * g + 2)];
  const one = (g: number, depth: number): Cmd[] => {
    const [a, e] = range(g);
    if (e <= a || depth > 8) return [];
    const d = glyf.subarray(a, e);
    const nc = i16(d, 0);
    if (nc >= 0) {
      const ends: number[] = [];
      for (let k = 0; k < nc; k++) ends.push(u16(d, 10 + 2 * k));
      const np = nc ? ends[nc - 1] + 1 : 0;
      let o = 10 + 2 * nc;
      o += 2 + u16(d, o);                       // instructions
      const flags: number[] = [];
      while (flags.length < np) {
        const f = d[o++]; flags.push(f);
        if (f & 8) { let r = d[o++]; while (r-- > 0) flags.push(f); }
      }
      const xs: number[] = [], ys: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) { const dx = d[o++]; v += f & 16 ? dx : -dx; } else if (!(f & 16)) { v += i16(d, o); o += 2; }
        xs.push(v);
      }
      v = 0;
      for (const f of flags) {
        if (f & 4) { const dy = d[o++]; v += f & 32 ? dy : -dy; } else if (!(f & 32)) { v += i16(d, o); o += 2; }
        ys.push(v);
      }
      const out: Cmd[] = [];
      let s = 0;
      for (const end of ends) {
        const pts: [number, number, boolean][] = [];
        for (let k = s; k <= end; k++) pts.push([xs[k], ys[k], (flags[k] & 1) === 1]);
        s = end + 1;
        if (!pts.length) continue;
        // start at an on-curve point (or the midpoint of the first two off-curve ones)
        let startIdx = pts.findIndex(q => q[2]);
        let start: [number, number];
        if (startIdx < 0) { start = [(pts[0][0] + pts[1 % pts.length][0]) / 2, (pts[0][1] + pts[1 % pts.length][1]) / 2]; startIdx = 0; }
        else { start = [pts[startIdx][0], pts[startIdx][1]]; startIdx++; }
        out.push(['M', start[0], start[1]]);
        let ctrl: [number, number] | null = null;
        for (let k = 0; k < pts.length; k++) {
          const q = pts[(startIdx + k) % pts.length];
          if (q[2]) {
            if (ctrl) { out.push(['Q', ctrl[0], ctrl[1], q[0], q[1]]); ctrl = null; } else out.push(['L', q[0], q[1]]);
          } else {
            if (ctrl) { const mx = (ctrl[0] + q[0]) / 2, my = (ctrl[1] + q[1]) / 2; out.push(['Q', ctrl[0], ctrl[1], mx, my]); }
            ctrl = [q[0], q[1]];
          }
        }
        if (ctrl) out.push(['Q', ctrl[0], ctrl[1], start[0], start[1]]);
        out.push(['Z']);
      }
      return out;
    }
    // composite
    const out: Cmd[] = [];
    let o = 10;
    for (;;) {
      const flags = u16(d, o), gi = u16(d, o + 2); o += 4;
      let dx = 0, dy = 0;
      if (flags & 1) { if (flags & 2) { dx = i16(d, o); dy = i16(d, o + 2); } o += 4; }
      else { if (flags & 2) { dx = (d[o] << 24) >> 24; dy = (d[o + 1] << 24) >> 24; } o += 2; }
      let a = 1, b = 0, c = 0, dd = 1;
      const f2 = (p: number) => i16(d, p) / 16384;
      if (flags & 8) { a = dd = f2(o); o += 2; }
      else if (flags & 0x40) { a = f2(o); dd = f2(o + 2); o += 4; }
      else if (flags & 0x80) { a = f2(o); b = f2(o + 2); c = f2(o + 4); dd = f2(o + 6); o += 8; }
      const tx = (px: number, py: number): [number, number] => [a * px + c * py + dx, b * px + dd * py + dy];
      for (const cmd of one(gi, depth + 1)) {
        if (cmd[0] === 'Z') { out.push(cmd); continue; }
        const nums = cmd.slice(1) as number[];
        const mapped: number[] = [];
        for (let k = 0; k < nums.length; k += 2) mapped.push(...tx(nums[k], nums[k + 1]));
        out.push([cmd[0], ...mapped] as Cmd);
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  };
  return (g: number) => one(g, 0);
}

// ── Type 1 ──────────────────────────────────────────────────────────────────

const latin1 = (b: B) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };

function segments(buf: B): { clear: string; enc: B } {
  if (buf[0] !== 0x80) {                                   // PFA
    const text = latin1(buf);
    const i = text.indexOf('eexec') + 5;
    const hex = text.slice(i).replace(/0{64}[\s\S]*$/, '').replace(/[^0-9a-fA-F]/g, '');
    const enc = new Uint8Array(hex.length >> 1);
    for (let k = 0; k < enc.length; k++) enc[k] = parseInt(hex.substr(2 * k, 2), 16);
    return { clear: text.slice(0, i), enc };
  }
  let clear = '';
  const parts: B[] = [];
  let o = 0;
  while (o < buf.length && buf[o] === 0x80 && buf[o + 1] !== 3) {
    const type = buf[o + 1], len = buf[o + 2] | (buf[o + 3] << 8) | (buf[o + 4] << 16) | (buf[o + 5] << 24);
    const part = buf.subarray(o + 6, o + 6 + len);
    if (type === 1 && !parts.length) clear += latin1(part);
    else if (type === 2) parts.push(part);
    o += 6 + len;
  }
  const enc = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let k = 0;
  for (const p of parts) { enc.set(p, k); k += p.length; }
  return { clear, enc };
}

function decrypt(data: B, r: number, skip: number): B {
  const out = new Uint8Array(Math.max(0, data.length - skip));
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const p = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xFFFF;
    if (i >= skip) out[i - skip] = p;
  }
  return out;
}

export interface Type1 { fontMatrix: number[]; encoding: string[]; subrs: B[]; chars: Map<string, B> }

function parsePrivate(p: B): { subrs: B[]; chars: Map<string, B> } {
  const text = latin1(p);
  const lenIV = Number(text.match(/\/lenIV\s+(-?\d+)/)?.[1] ?? 4);
  const cs = (bytes: B) => (lenIV < 0 ? bytes : decrypt(bytes, 4330, lenIV));
  const skipWs = (i: number) => { while (i < text.length && /\s/.test(text[i])) i++; return i; };
  const skipToken = (i: number) => { while (i < text.length && !/\s/.test(text[i])) i++; return i; };
  const entries = (re: RegExp, from: number, onEntry: (k: string, b: B) => void) => {
    let i = from;
    for (;;) {
      i = skipWs(i);
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) return;
      const start = re.lastIndex, len = Number(m[2]);
      onEntry(m[1], p.subarray(start, start + len));
      i = skipToken(skipWs(start + len));
    }
  };
  const subrs: B[] = [];
  const sAt = text.indexOf('/Subrs');
  if (sAt >= 0) entries(/dup\s+(\d+)\s+(\d+)\s+\S+ /y, text.indexOf('dup', sAt), (k, b) => { subrs[Number(k)] = cs(b); });
  const chars = new Map<string, B>();
  const cAt = text.indexOf('/CharStrings');
  entries(/\/([^\s/[\]{}()<>%]+)\s+(\d+)\s+\S+ /y, text.indexOf('begin', cAt) + 5, (k, b) => { chars.set(k, cs(b)); });
  return { subrs, chars };
}

/** StandardEncoding, which seac's accent and base characters index. */
export const STANDARD = (() => {
  const names = `space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde`.split(' ');
  const e: string[] = new Array(256).fill('.notdef');
  names.forEach((n, k) => { e[32 + k] = n; });
  const hi: Record<number, string> = { 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin', 167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft', 172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger', 179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase', 185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis', 189: 'perthousand', 191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex', 196: 'tilde', 197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla', 205: 'hungarumlaut', 206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash', 233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash', 250: 'oe', 251: 'germandbls' };
  for (const [k, v] of Object.entries(hi)) e[Number(k)] = v;
  return e;
})();

export function parseType1(bytes: B): Type1 {
  const { clear, enc } = segments(bytes);
  const priv = decrypt(enc, 55665, 4);
  const fm = clear.match(/\/FontMatrix\s*\[\s*([^\]]+)\]/);
  const fontMatrix = fm ? fm[1].trim().split(/\s+/).map(Number) : [0.001, 0, 0, 0.001, 0, 0];
  return { fontMatrix, encoding: readBuiltinEncoding(clear), ...parsePrivate(priv) };
}

/** The 256 glyph names of a PostScript encoding vector (.enc). */
export function readEncodingVector(text: string): string[] {
  const t = text.replace(/%[^\n]*/g, '');
  const body = t.slice(t.indexOf('[') + 1, t.lastIndexOf(']'));
  const names = [...body.matchAll(/\/([^\s/[\]{}()<>%]+)/g)].map(m => m[1]);
  return [...names, ...new Array(256).fill('.notdef')].slice(0, 256);
}

/** The font's own encoding, running the PostScript after /Encoding as far as
 *  encodings use it (see the public type1.ts). */
function readBuiltinEncoding(clear: string): string[] {
  const at = clear.search(/\/Encoding\b/);
  if (at < 0) return STANDARD.slice();
  const tokens = clear.slice(at + '/Encoding'.length).match(/\/?[^\s/[\]{}()<>%]+|[{}]|%[^\n]*/g) ?? [];
  type Arr = { a: string[]; off: number; len: number };
  type Val = number | string | Arr | { proc: string[] };
  const stack: Val[] = [];
  const arr = (v: Val): Arr => { if (typeof v === 'object' && 'a' in v) return v; throw new Error('Encoding: not an array'); };
  const num = (v: Val): number => { if (typeof v === 'number') return v; throw new Error('Encoding: not a number'); };
  const pop = (): Val => { if (!stack.length) throw new Error('Encoding: stack underflow'); return stack.pop()!; };
  let done = false;
  const run = (toks: string[]): void => {
    for (let i = 0; i < toks.length && !done; i++) {
      const t = toks[i];
      if (t.startsWith('%')) continue;
      if (t === '{') {
        let depth = 1, j = i + 1;
        for (; j < toks.length && depth; j++) depth += toks[j] === '{' ? 1 : toks[j] === '}' ? -1 : 0;
        stack.push({ proc: toks.slice(i + 1, j - 1) }); i = j - 1; continue;
      }
      if (/^-?\d+$/.test(t)) { stack.push(Number(t)); continue; }
      if (t.startsWith('/')) { stack.push(t.slice(1)); continue; }
      switch (t) {
        case 'StandardEncoding': stack.push({ a: STANDARD.slice(), off: 0, len: 256 }); break;
        case 'array': { const n = num(pop()); stack.push({ a: new Array(n).fill('.notdef'), off: 0, len: n }); break; }
        case 'dup': { const v = pop(); stack.push(v, v); break; }
        case 'exch': { const b = pop(), a = pop(); stack.push(b, a); break; }
        case 'pop': pop(); break;
        case 'index': { const n = num(pop()); stack.push(stack[stack.length - 1 - n]); break; }
        case 'put': { const v = pop(), k = num(pop()), a = arr(pop()); a.a[a.off + k] = String(v); break; }
        case 'get': { const k = num(pop()), a = arr(pop()); stack.push(a.a[a.off + k]); break; }
        case 'getinterval': { const n = num(pop()), k = num(pop()), a = arr(pop()); stack.push({ a: a.a, off: a.off + k, len: n }); break; }
        case 'putinterval': {
          const src = arr(pop()), k = num(pop()), dst = arr(pop());
          src.a.slice(src.off, src.off + src.len).forEach((v, j) => { dst.a[dst.off + k + j] = v; });
          break;
        }
        case 'for': {
          const pr = pop(), lim = num(pop()), step = num(pop()), from = num(pop());
          if (typeof pr !== 'object' || !('proc' in pr)) throw new Error('Encoding: for without a procedure');
          for (let x = from; step > 0 ? x <= lim : x >= lim; x += step) { stack.push(x); run(pr.proc); }
          break;
        }
        case 'readonly': case 'noaccess': case 'executeonly': break;
        case 'def': done = true; break;
        default: throw new Error(`Encoding: unsupported operator ${t}`);
      }
    }
  };
  run(tokens);
  const topv = stack.length ? stack[stack.length - 1] : null;
  const v = topv && typeof topv === 'object' && 'a' in topv ? topv : null;
  if (!v) throw new Error('Encoding: no array');
  return Array.from({ length: 256 }, (_, i) => v.a[v.off + i] ?? '.notdef');
}

type Point = [number, number];
interface Pen { moveTo(p: Point): void; lineTo(p: Point): void; curveTo(a: Point, b: Point, c: Point): void; closePath(): void; endPath(): void }

function t1outline(name: string, font: Type1, pen: Pen, depth = 0): void {
  if (depth > 2) throw new Error(`seac nested too deep at ${name}`);
  const st: number[] = [];
  let cur: Point = [0, 0], saw = false, flexing = false, sbx = 0;
  const moveTo = (d: Point) => { cur = [cur[0] + d[0], cur[1] + d[1]]; pen.moveTo(cur); saw = true; };
  const endPath = () => { if (saw) pen.endPath(); saw = false; };
  const lineTo = (d: Point) => { if (!saw) moveTo([0, 0]); cur = [cur[0] + d[0], cur[1] + d[1]]; pen.lineTo(cur); };
  const curveTo = (a: Point, b: Point, c: Point) => {
    if (!saw) moveTo([0, 0]);
    const p1: Point = [cur[0] + a[0], cur[1] + a[1]], p2: Point = [p1[0] + b[0], p1[1] + b[1]], p3: Point = [p2[0] + c[0], p2[1] + c[1]];
    pen.curveTo(p1, p2, p3); cur = p3;
  };
  const popall = () => st.splice(0);
  const run = (code: B | undefined): 'end' | void => {
    if (!code) return;
    for (let i = 0; i < code.length;) {
      const v = code[i++];
      if (v >= 32) {
        if (v <= 246) st.push(v - 139);
        else if (v <= 250) st.push((v - 247) * 256 + code[i++] + 108);
        else if (v <= 254) st.push(-(v - 251) * 256 - code[i++] - 108);
        else { st.push((code[i] << 24) | (code[i + 1] << 16) | (code[i + 2] << 8) | code[i + 3]); i += 4; }
        continue;
      }
      const op = v === 12 ? 1200 + code[i++] : v;
      switch (op) {
        case 13: { const [s] = popall(); sbx = s; cur = [s, cur[1]]; break; }
        case 1207: popall(); break;
        case 21: if (flexing) break; endPath(); { const a = popall(); moveTo([a[0], a[1]]); } break;
        case 22: if (flexing) { st.push(0); break; } endPath(); moveTo([popall()[0], 0]); break;
        case 4:
          if (flexing) { st.push(0); const n = st.length; [st[n - 1], st[n - 2]] = [st[n - 2], st[n - 1]]; break; }
          endPath(); moveTo([0, popall()[0]]); break;
        case 5: { const a = popall(); lineTo([a[0], a[1]]); break; }
        case 6: { const a = popall(); lineTo([a[0], 0]); break; }
        case 7: { const a = popall(); lineTo([0, a[0]]); break; }
        case 8: { const a = popall(); curveTo([a[0], a[1]], [a[2], a[3]], [a[4], a[5]]); break; }
        case 30: { const a = popall(); curveTo([0, a[0]], [a[1], a[2]], [a[3], 0]); break; }
        case 31: { const a = popall(); curveTo([a[0], 0], [a[1], a[2]], [0, a[3]]); break; }
        case 9: if (saw) pen.closePath(); saw = false; break;
        case 14: endPath(); return 'end';
        case 10: { const n = st.pop()!; if (run(font.subrs[n]) === 'end') return 'end'; break; }
        case 11: return;
        case 1216: {
          const idx = st.pop(), n = st.pop();
          if (idx === 0 && n === 3) {
            const fy = st.pop()!, fx = st.pop()!; st.pop();
            const vv = st.splice(st.length - 14, 14);
            const [rpx, rpy, b1x, b1y, b2x, b2y, p2x, p2y, b3x, b3y, b4x, b4y, p3x, p3y] = vv;
            curveTo([b1x + rpx, b1y + rpy], [b2x, b2y], [p2x, p2y]);
            curveTo([b3x, b3y], [b4x, b4y], [p3x, p3y]);
            st.push(fx, fy); flexing = false;
          } else if (idx === 1 && n === 0) flexing = true;
          break;
        }
        case 1217: break;
        case 1233: { const [x, y] = popall(); cur = [x, y]; break; }
        case 1212: { const b = st.pop()!, a = st.pop()!; st.push(a / b); break; }
        case 1206: {
          const [asb, adx, ady, bchar, achar] = popall();
          t1outline(STANDARD[bchar], font, pen, depth + 1);
          const dx = adx + sbx - asb;
          const shift = (q: Point): Point => [q[0] + dx, q[1] + ady];
          t1outline(STANDARD[achar], font, {
            moveTo: q => pen.moveTo(shift(q)), lineTo: q => pen.lineTo(shift(q)),
            curveTo: (a, b, c) => pen.curveTo(shift(a), shift(b), shift(c)),
            closePath: () => pen.closePath(), endPath: () => pen.endPath(),
          }, depth + 1);
          return 'end';
        }
        default: popall();
      }
    }
  };
  const code = font.chars.get(name);
  if (!code) throw new Error(`no glyph ${name}`);
  run(code);
}

/** A Type 1 glyph by name, as absolute commands in font units. */
export function type1Glyph(font: Type1, name: string): Cmd[] | null {
  if (!font.chars.has(name)) return null;
  const out: Cmd[] = [];
  let open = false;
  t1outline(name, font, {
    moveTo: p => { if (open) out.push(['Z']); out.push(['M', p[0], p[1]]); open = true; },
    lineTo: p => out.push(['L', p[0], p[1]]),
    curveTo: (a, b, c) => out.push(['C', a[0], a[1], b[0], b[1], c[0], c[1]]),
    closePath: () => { if (open) out.push(['Z']); open = false; },
    endPath: () => { if (open) out.push(['Z']); open = false; },
  });
  return out;
}
