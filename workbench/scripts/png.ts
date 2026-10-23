// A small PNG decoder (8-bit RGB/RGBA, non-interlaced: what Playwright's screenshots are) for pixel checks.
import { inflateSync } from 'node:zlib';

export function decodePng(buf: Buffer): { w: number; h: number; px: Uint8Array } {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12] !== 0) throw new Error('png: 8-bit, non-interlaced only'); }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`png: colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++], line = new Uint8Array(raw.subarray(q, q + stride)); q += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = x * bpp; out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = bpp === 4 ? line[s + 3] : 255; }
    prev = line;
  }
  return { w, h, px: out };
}
export const luma = (px: Uint8Array, i: number) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
