// The rest of node:* the encoder's modules import. Only what they call on the
// path from output.json to a page is real; the rest throws when called (it is
// LuaTeX, dvisvgm and friends, which a Tectonic capture does not need).
const unavailable = (what: string) => () => { throw new Error(`${what} is not available in the browser`); };

// node:url
export function fileURLToPath(u: string | URL): string {
  const url = new URL(String(u));
  if (url.protocol !== 'file:') throw new Error(`fileURLToPath: not a file URL: ${u}`);
  return decodeURIComponent(url.pathname);
}
export const pathToFileURL = (p: string) => new URL(`file://${encodeURI(p)}`);

// node:os
export const tmpdir = () => '/tmp';

// node:util
export const promisify = (f: (...a: unknown[]) => unknown) => (...a: unknown[]) =>
  new Promise((res, rej) => f(...a, (e: unknown, v: unknown) => (e ? rej(e) : res(v))));
export const parseArgs = unavailable('util.parseArgs');

// node:module
export const createRequire = () => ({ resolve: (id: string) => `/node_modules/${id}` });

// node:zlib (pictures.ts, for PDF streams)
export const inflateSync = unavailable('zlib.inflateSync');
export const constants = {};
