// the app's key for a block's result, out of app.js.
// A backend that keys its own results (the engine's keyFor: the build, the preamble with every file it
// opens, the block's context and source, every file the block opens — \input included) gives the key;
// the app adds only what is its own: the backend's id, the notes salt (comments on/off change the
// compile), the preamble+bibliography hash and the \includegraphics assets' hashes (a figure edited in
// place). A backend without keyFor (v1, stubs) gets the old scheme: a hash of context and source.
//
//   blockCacheKey(backend, { source, context }, { salt, preHash, assets }) -> string    (pure; test-w15-units)

/** cyrb53, base 36 (the old scheme's hash) */
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function blockCacheKey(backend, { source, context = '' }, { salt = '', preHash = '', assets = '' } = {}) {
  const head = `${backend?.id ?? ''}${salt}:${preHash}`;
  if (typeof backend?.keyFor === 'function') {
    let k = null;
    try { k = backend.keyFor({ source, context: context || undefined }); } catch { k = null; }   // not ready (no build id yet)
    if (k) return `${head}:${k}${assets ? `:${hash(assets)}` : ''}`;
  }
  return `${head}:${hash(`${context}\n${source}${assets}`)}`;
}
