// @ts-check
// Result keys, shared by the page (backend.js, the result cache) and the
// worker, so a result can be looked up before the worker is asked:
//   key = e<build>.<preamble hash>.<block hash>
// build: the engine build id (wasm + worker); preamble hash: the preamble as
// the author wrote it + the bibliography; block hash: context prefix + source.

/** cyrb53: a fast 53-bit string hash, hex. */
export function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export const preambleKey = (preamble, bbl = '') => hash(`${preamble}\u0000${bbl}`);
export const blockKey = (build, pkey, source, context = '') => `e${build}.${pkey}.${hash(`${context}\u0000${source}`)}`;
