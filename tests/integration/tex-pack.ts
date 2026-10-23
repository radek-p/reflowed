// The dev servers' /bundle/pack: the embedded TeX set as one pack
// (loading/pack.ts), the release's TeX files (engine/scripts/build-worker.ts workingSetNames, unminified, and engine/tex/'s
// files the bundle lacks). The engine worker's dev init takes it, so an open fetches the set in one request, not file by
// file. Made once per version of the set (the sizes and times of build-worker.ts's WORKING_SET_LISTS, tiers.ts and
// engine/tex/'s files); sent compressed (brotli when asked for, else gzip) and
// cacheable (an ETag of the pack's hash, Cache-Control: no-cache, 304 on a match).
//
//   const pack = texPack({ index, getFile, bundleId })     the bundle's index and file reader (engine/server/bundle.ts)
//   pack.built()                                           → { raw, etag, files } (made on the first call; again on a change)
//   await pack.serve(req, res)                             answers a request for /bundle/pack
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, constants as zc, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { packRaw } from '../../loading/pack.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const brotliP = promisify(brotliCompress), gzipP = promisify(gzip);
interface Built { raw: Buffer; etag: string; files: number }

export function texPack(o: { index: Map<string, unknown>; getFile: (n: string) => Promise<{ data: Buffer } | undefined>; bundleId: string }) {
  let made: { sig: string; p: Promise<Built> } | null = null;
  const enc = new Map<string, Promise<Buffer>>();
  async function built(): Promise<Built> {
    const { workingSetNames, WORKING_SET_LISTS, localTexFiles, LOCAL_TEX_DIR } = await import(join(ROOT, 'engine/scripts/build-worker.ts')) as
      { workingSetNames: () => string[]; WORKING_SET_LISTS: string[]; localTexFiles: () => string[]; LOCAL_TEX_DIR: string };
    const lists = [...WORKING_SET_LISTS, join(ROOT, 'engine/scripts/tiers.ts')];     // the list files and TIER_FILES' source
    const local = localTexFiles();
    const st = await Promise.all([...lists, ...local.map((n) => join(LOCAL_TEX_DIR, n))].map((p) => stat(p).catch(() => null)));
    const sig = `${o.bundleId}:${local.join()}:${st.map((s) => `${s?.size}-${s?.mtimeMs}`).join()}`;
    if (made?.sig !== sig) {
      const p = (async () => {
        const entries: [string, Uint8Array][] = [];
        for (const n of workingSetNames()) {
          if (!o.index.has(n)) continue;
          const f = await o.getFile(n);
          if (f) entries.push([`texmf/${n}`, f.data]);
        }
        for (const n of local) entries.push([`texmf/${n}`, await readFile(join(LOCAL_TEX_DIR, n))]);
        const raw = Buffer.from(packRaw(entries));
        return { raw, etag: `"${createHash('sha256').update(raw).digest('hex').slice(0, 16)}"`, files: entries.length };
      })();
      p.catch(() => { if (made?.p === p) made = null; });
      made = { sig, p };
      enc.clear();
    }
    return made.p;
  }
  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const b = await built();
    const accepts = String(req.headers['accept-encoding'] ?? '');
    const how = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
    const head: Record<string, string> = { 'Content-Type': 'application/octet-stream', ETag: b.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === b.etag) { res.writeHead(304, head); res.end(); return; }
    let body = b.raw;
    if (how) {
      const k = `${b.etag}:${how}`;
      let p = enc.get(k);
      if (!p) {
        p = how === 'br' ? brotliP(b.raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: b.raw.length } }) : gzipP(b.raw);
        p.catch(() => enc.delete(k));
        enc.set(k, p);
      }
      body = await p;
      head['Content-Encoding'] = how;
    }
    res.writeHead(200, { ...head, 'Content-Length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  return { built, serve };
}
