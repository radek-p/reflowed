// gzip / deflate through the platform's (De)CompressionStream: browsers and
// Node 18+ have them, so no inflate code of our own.

async function pipe(data: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<any> }, what: string): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  // damaged input fails the read and the write alike: the write's failure is
  // caught here (it was an unhandled rejection), and the error says what could not be read
  const writing = w.write(data).then(() => w.close());
  writing.catch(() => {});
  const chunks: Uint8Array[] = [];
  let n = 0;
  const r = stream.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      chunks.push(value); n += value.byteLength;
    }
    await writing;
  } catch (e) {
    const cause = (e as any)?.cause?.message ?? (e as Error)?.message ?? '';
    throw new Error(`not valid ${what} data${cause ? ` (${cause})` : ''}`);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export const gunzip = (d: Uint8Array) => pipe(d, new DecompressionStream('gzip'), 'gzip');
export const gzip = (d: Uint8Array) => pipe(d, new CompressionStream('gzip'), 'gzip');
export const inflateRaw = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate-raw'), 'deflate');
export const deflateRaw = (d: Uint8Array) => pipe(d, new CompressionStream('deflate-raw'), 'deflate');
export const inflate = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate'), 'zlib');

export const isGzip = (d: Uint8Array) => d.length > 2 && d[0] === 0x1f && d[1] === 0x8b;

export async function gzipJSON(v: unknown): Promise<Uint8Array> { return gzip(new TextEncoder().encode(JSON.stringify(v))); }
export async function gunzipJSON<T>(d: Uint8Array): Promise<T> { return JSON.parse(new TextDecoder().decode(await gunzip(d))); }
