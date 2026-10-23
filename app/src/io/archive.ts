// Archives in TS, no dependencies: tar (ustar, GNU long names, pax paths),
// zip (read: stored + deflate; write: stored or deflate, whichever is
// smaller), gzip through io/gzip.ts. Also: sniffing what a dropped file is.

import { deflateRaw, gunzip, inflateRaw, isGzip } from './gzip.ts';

export interface Entry { path: string; data: Uint8Array; mtime?: number }

const dec = new TextDecoder();
const cstr = (b: Uint8Array) => { const z = b.indexOf(0); return dec.decode(z < 0 ? b : b.subarray(0, z)); };
const octal = (b: Uint8Array) => parseInt(cstr(b).trim() || '0', 8);

export const isTar = (d: Uint8Array) => d.length >= 512 && cstr(d.subarray(257, 262)) === 'ustar';
export const isZip = (d: Uint8Array) => d.length >= 4 && d[0] === 0x50 && d[1] === 0x4b && (d[2] === 3 || d[2] === 5) && (d[3] === 4 || d[3] === 6);
export const isPdf = (d: Uint8Array) => d.length >= 5 && dec.decode(d.subarray(0, 5)) === '%PDF-';

// ── tar ──

export function readTar(d: Uint8Array): Entry[] {
  const out: Entry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + 512 <= d.length) {
    const h = d.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let name = cstr(h.subarray(0, 100));
    const prefix = cstr(h.subarray(345, 500));
    if (prefix && cstr(h.subarray(257, 263)).startsWith('ustar')) name = `${prefix}/${name}`;
    const size = octal(h.subarray(124, 136));
    const mtime = octal(h.subarray(136, 148));
    const type = String.fromCharCode(h[156] || 48);
    // a file that runs past the end: the archive was cut short (a partial download);
    // taking what is there would import a truncated file without a word
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > d.length) throw new Error(`tar: ${name || 'an entry'} is cut short (the archive is incomplete or damaged)`);
    const body = d.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(body); continue; }
    if (type === 'x') {
      for (const rec of dec.decode(body).split('\n')) { const m = /^\d+ path=(.*)$/.exec(rec); if (m) paxPath = m[1]; }
      continue;
    }
    if (type === 'g') continue;
    const path = paxPath ?? longName ?? name;
    paxPath = longName = null;
    if (type === '0' || type === '\0' || type === '7') out.push({ path, data: body.slice(), mtime: mtime * 1000 });
  }
  return out;
}

export function writeTar(entries: Entry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const field = (h: Uint8Array, off: number, len: number, s: string) => h.set(enc.encode(s).subarray(0, len), off);
  for (const e of entries) {
    const h = new Uint8Array(512);
    let name = e.path, prefix = '';
    if (enc.encode(name).length > 100) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); name = name.slice(i + 1); }
    field(h, 0, 100, name);
    field(h, 100, 8, '0000644\0');
    field(h, 108, 8, '0000000\0'); field(h, 116, 8, '0000000\0');
    field(h, 124, 12, e.data.length.toString(8).padStart(11, '0') + '\0');
    field(h, 136, 12, Math.floor((e.mtime ?? 0) / 1000).toString(8).padStart(11, '0') + '\0');
    field(h, 148, 8, '        ');
    h[156] = 48;
    field(h, 257, 8, 'ustar\u000000');
    field(h, 345, 155, prefix);
    let sum = 0; for (const x of h) sum += x;
    field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    parts.push(h, e.data, new Uint8Array((512 - (e.data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  return concat(parts);
}

// ── zip ──

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

export async function readZip(d: Uint8Array): Promise<Entry[]> {
  // end of central directory: the last "PK\5\6"
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 22 - 65535); i--) {
    if (d[i] === 0x50 && d[i + 1] === 0x4b && d[i + 2] === 5 && d[i + 3] === 6) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no central directory');
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  if (p + 46 > d.length) throw new Error('zip: the central directory is outside the file (damaged)');
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > d.length || u32(d, p) !== 0x02014b50) throw new Error('zip: bad central directory entry (damaged)');
    const flags = u16(d, p + 8), method = u16(d, p + 10);
    const crc = u32(d, p + 16), csize = u32(d, p + 20), nameLen = u16(d, p + 28), extraLen = u16(d, p + 30), commentLen = u16(d, p + 32);
    const local = u32(d, p + 42);
    const nameBytes = d.subarray(p + 46, p + 46 + nameLen);
    const path = (flags & 0x800) ? dec.decode(nameBytes) : latin1(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new Error(`zip: ${path} is encrypted`);
    if (local + 30 > d.length || u32(d, local) !== 0x04034b50) throw new Error(`zip: ${path}: its entry is missing (damaged)`);
    const lo = local + 30 + u16(d, local + 26) + u16(d, local + 28);
    if (lo + csize > d.length) throw new Error(`zip: ${path} is cut short (the archive is incomplete)`);
    const raw = d.subarray(lo, lo + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) { try { data = await inflateRaw(raw); } catch (e) { throw new Error(`zip: ${path} cannot be unpacked (${(e as Error).message})`); } }
    else throw new Error(`zip: ${path}: compression method ${method} not supported`);
    // the checksum every zip carries: damaged bytes are not imported as text
    if (crc32(data) !== crc) throw new Error(`zip: ${path} is damaged (its checksum does not match)`);
    out.push({ path, data });
  }
  return out;
}

const latin1 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; };

let CRC: Uint32Array | null = null;
export function crc32(d: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function writeZip(entries: Entry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.data);
    const deflated = e.data.length > 64 ? await deflateRaw(e.data) : null;
    const useDeflate = !!deflated && deflated.length < e.data.length;
    const body = useDeflate ? deflated! : e.data;
    const t = new Date(e.mtime ?? Date.UTC(2026, 0, 1));
    const dosTime = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, t.getFullYear()) - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
    const lh = new Uint8Array(30 + name.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true); v.setUint16(8, useDeflate ? 8 : 0, true);
    v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
    v.setUint32(14, crc, true); v.setUint32(18, body.length, true); v.setUint32(22, e.data.length, true);
    v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint16(10, useDeflate ? 8 : 0, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(38, 0o100644 << 16, true); cv.setUint32(42, off, true);
    ch.set(name, 46);
    parts.push(lh, body); central.push(ch);
    off += lh.length + body.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true);
  return concat([...parts, cd, end]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── what was dropped ──

/** Any supported upload → its files. A lone gzipped non-tar (an arXiv
 *  e-print of one .tex) becomes `<name>.tex`; a lone file stays itself. */
export async function unpack(name: string, data: Uint8Array): Promise<Entry[]> {
  if (isZip(data)) return readZip(data);
  if (isGzip(data)) {
    let inner: Uint8Array;
    try { inner = await gunzip(data); } catch (e) { throw new Error(`${name.split('/').pop()}: cannot be unpacked (${(e as Error).message}); the file may be incomplete`); }
    if (isTar(inner)) return readTar(inner);
    if (isPdf(inner)) throw new Error('this e-print is only a PDF: there is no LaTeX source to import');
    const base = name.replace(/\.(tar\.gz|tgz|gz)$/i, '').replace(/\.src$/i, '').split('/').pop() || 'main';
    return [{ path: /\.tex$/i.test(base) ? base : `${base}.tex`, data: inner }];
  }
  if (isTar(data)) return readTar(data);
  if (isPdf(data)) throw new Error('a PDF has no LaTeX source to import');
  return [{ path: name.split('/').pop() || 'main.tex', data }];
}
