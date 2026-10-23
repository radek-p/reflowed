// The pack: many files as one, for one request (the release's engine packs, the dev server's TeX set, the build's
// minify proof). Uncompressed layout: [u32 LE header length][header JSON: [[name, offset, length]…]][bytes…].
// Compression is the carrier's (zstd or gzip in the release's files, Content-Encoding on the dev server).
//
//   packRaw(entries)   [[name, bytes]…] → the pack's bytes
//   readPack(raw)      the pack's bytes → Map name → bytes (views into raw, no copies)

export function packRaw(entries: [string, Uint8Array][]): Uint8Array {
  const header: [string, number, number][] = [];
  let off = 0;
  for (const [n, b] of entries) { header.push([n, off, b.length]); off += b.length; }
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const raw = new Uint8Array(4 + hb.length + off);
  new DataView(raw.buffer).setUint32(0, hb.length, true);
  raw.set(hb, 4);
  let p = 4 + hb.length;
  for (const [, b] of entries) { raw.set(b, p); p += b.length; }
  return raw;
}

export function readPack(raw: Uint8Array): Map<string, Uint8Array> {
  if (raw.length < 4) throw new Error(`a pack of ${raw.length} bytes`);
  const n = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  if (4 + n > raw.length) throw new Error(`a pack's header of ${n} bytes in ${raw.length}`);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + n))) as [string, number, number][];
  const base = 4 + n;
  const out = new Map<string, Uint8Array>();
  for (const [name, o, l] of header) {
    if (base + o + l > raw.length) throw new Error(`a pack cut off: ${name} past its end`);
    out.set(name, raw.subarray(base + o, base + o + l));
  }
  return out;
}
