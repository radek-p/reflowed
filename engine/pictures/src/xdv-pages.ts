// The pages tectonic-capture.sty ships for TikZ pictures, read from the XDV
// with positions. capture/src/xdv.ts keeps what each node was and drops the
// movements; a picture needs where each glyph, rule and special stands, so
// this is a second, complete DVI interpreter (h, v, w, x, y, z and the
// stack), run only over the pages that start with \special{rtx:picture N}.
// Pure: bytes in, data out.

export interface PicFont {
  num: number;
  kind: 'tfm' | 'native';
  name: string;           // TFM name ("cmmi10") or font file ("lmroman10-regular")
  size: number;           // sp
  index?: number;
  flags?: number;
  rgba?: number; extend?: number; slant?: number; embolden?: number;
}

export type PicOp =
  | { t: 'char'; font: number; code: number; h: number; v: number }
  | { t: 'glyphs'; font: number; h: number; v: number; glyphs: { gid: number; x: number; y: number }[] }
  | { t: 'rule'; h: number; v: number; width: number; height: number }
  | { t: 'special'; text: string; h: number; v: number };

export interface PicPage { id: number; page: number; ops: PicOp[] }

/** A TFM character's width in sp at a font's size, for set_char's advance. */
export type CharWidth = (font: PicFont, code: number) => number;

const MARK = /^rtx:picture (\d+)$/;

/** Indexes (0-based, in bop order) of the pages that are captured pictures,
 *  without interpreting anything: cheap enough to run on every capture. */
export function picturePageIndexes(pages: { ops: { t: string; text?: string }[] }[]): Set<number> {
  const out = new Set<number>();
  pages.forEach((p, k) => {
    for (const o of p.ops) {
      if (o.t !== 'special') break;
      if (MARK.test(o.text!)) { out.add(k); break; }
    }
  });
  return out;
}

export function readPicturePages(bytes: Uint8Array, charWidth: CharWidth): { fonts: Map<number, PicFont>; pages: Map<number, PicPage> } {
  const b = bytes;
  let p = 0;
  const u = (n: number): number => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p++]; return v; };
  const s = (n: number): number => { const v = u(n); const lim = 2 ** (8 * n - 1); return v >= lim ? v - 2 * lim : v; };
  const fonts = new Map<number, PicFont>();
  const pages = new Map<number, PicPage>();
  let pageNo = -1;
  let cur: PicPage | null = null;      // the picture page being read, else null
  let seenDrawing = false;             // on a page: something but specials came first
  let h = 0, v = 0, w = 0, x = 0, y = 0, z = 0, f = -1;
  const stack: number[][] = [];
  const font = () => { const ft = fonts.get(f); if (!ft) throw new Error(`xdv-pages: font ${f} used before definition`); return ft; };
  const setChar = (code: number, move: boolean) => {
    if (cur) cur.ops.push({ t: 'char', font: f, code, h, v });
    seenDrawing = true;
    if (move) h += charWidth(font(), code);
  };
  const rule = (move: boolean) => {
    const height = s(4), width = s(4);
    if (cur && height > 0 && width > 0) cur.ops.push({ t: 'rule', h, v, width, height });
    seenDrawing = true;
    if (move) h += width;
  };
  const glyphs = () => {
    const width = s(4), n = u(2);
    const gl: { gid: number; x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) gl.push({ gid: 0, x: s(4), y: s(4) });
    for (let i = 0; i < n; i++) gl[i].gid = u(2);
    if (cur) cur.ops.push({ t: 'glyphs', font: f, h, v, glyphs: gl });
    seenDrawing = true;
    h += width;                        // as xdvipdfmx's do_glyphs: the word's width
  };
  while (p < b.length) {
    const op = b[p++];
    if (op <= 127) { setChar(op, true); continue; }
    if (op >= 171 && op <= 234) { f = op - 171; continue; }
    switch (op) {
      case 128: case 129: case 130: case 131: setChar(u(op - 127), true); break;
      case 133: case 134: case 135: case 136: setChar(u(op - 132), false); break;
      case 132: rule(true); break;
      case 137: rule(false); break;
      case 138: break;
      case 139: {
        for (let i = 0; i < 11; i++) s(4);
        pageNo++; cur = null; seenDrawing = false;
        h = v = w = x = y = z = 0; stack.length = 0; f = -1;
        break;
      }
      case 140: cur = null; break;
      case 141: stack.push([h, v, w, x, y, z]); break;
      case 142: [h, v, w, x, y, z] = stack.pop()!; break;
      case 143: case 144: case 145: case 146: h += s(op - 142); break;
      case 147: h += w; break;
      case 148: case 149: case 150: case 151: w = s(op - 147); h += w; break;
      case 152: h += x; break;
      case 153: case 154: case 155: case 156: x = s(op - 152); h += x; break;
      case 157: case 158: case 159: case 160: v += s(op - 156); break;
      case 161: v += y; break;
      case 162: case 163: case 164: case 165: y = s(op - 161); v += y; break;
      case 166: v += z; break;
      case 167: case 168: case 169: case 170: z = s(op - 166); v += z; break;
      case 235: case 236: case 237: case 238: f = u(op - 234); break;
      case 239: case 240: case 241: case 242: {
        const k = u(op - 238);
        const text = new TextDecoder('utf-8').decode(b.subarray(p, p + k)); p += k;
        if (!cur && !seenDrawing) {
          const m = MARK.exec(text);
          if (m) { cur = { id: Number(m[1]), page: pageNo, ops: [] }; pages.set(cur.id, cur); break; }
        }
        if (cur) cur.ops.push({ t: 'special', text, h, v });
        break;
      }
      case 243: case 244: case 245: case 246: {
        const num = u(op - 242); u(4);
        const size = s(4); s(4);
        const a = u(1), l = u(1);
        const name = new TextDecoder('latin1').decode(b.subarray(p, p + a + l)); p += a + l;
        fonts.set(num, { num, kind: 'tfm', name, size });
        break;
      }
      case 247: { u(1); u(4); u(4); u(4); const k = u(1); p += k; break; }
      case 248: { u(4); u(4); u(4); u(4); u(4); u(4); u(2); u(2); break; }
      case 249: { p = b.length; break; }
      case 252: {
        const num = u(4), size = s(4), flags = u(2), l = u(1);
        const name = new TextDecoder('utf-8').decode(b.subarray(p, p + l)); p += l;
        const index = u(4);
        const ft: PicFont = { num, kind: 'native', name, size, index, flags };
        if (flags & 0x0200) ft.rgba = u(4);
        if (flags & 0x1000) ft.extend = s(4) / 65536;
        if (flags & 0x2000) ft.slant = s(4) / 65536;
        if (flags & 0x4000) ft.embolden = s(4) / 65536;
        fonts.set(num, ft);
        break;
      }
      case 253: glyphs(); break;
      case 254: { const len = u(2); p += 2 * len; glyphs(); break; }
      default: throw new Error(`xdv-pages: unknown opcode ${op} at byte ${p - 1}`);
    }
  }
  return { fonts, pages };
}
