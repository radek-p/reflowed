// @ts-check
// What one document's blocks compile against, derived from it: the preamble's hash and
// theorem kinds, each block's refs context and the recalls (thm-restate), the asset hashes, and from them a block's
// compile key (ck), what it shows (viewKey, viewResult) and its source as compiled. No DOM: tests/test-doc-units.ts
// and tests/test-keys.ts (every key of both seeds as before).
//
//   const derived = createDerived({ doc, blockById, nest, refs, backend, salt, bibpane, recallsOf, results })
//     derived.preHash · derived.thmSet · derived.contexts · derived.recalls · derived.assetHash   (read; the maps live)
//     derived.enginePreamble() · derived.compileSource(b) · derived.contextOf(b)
//     derived.ck(b) · derived.viewKey(b) · derived.viewResult(b) · derived.kindOf(source)
//     derived.computeContexts()   every block's context and the recalls, again (a structure or source change)
//     derived.preambleChanged()   the preamble's hash (with the bibliography's part) and theorem kinds, again
//     derived.loadAssets(assets)  the asset hashes of an opened document
//     derived.assetOf(name) · derived.assetSig(source) · derived.figureNames(source) · derived.bibKeyPart()
//   hash(str): cyrb53, the app's 53-bit string hash
import { blockCacheKey } from './cache-key.js';
import { splitMeta, blockSource } from '../meta/compile.ts';
import { guessKind, theoremKinds } from './kinds.js';

/** cyrb53: a fast 53-bit string hash. @param {string} str @param {number} [seed] */
export function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const GRAPHICS = /\\includegraphics\*?\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;
const EXTS = ['', '.pdf', '.png', '.jpg', '.jpeg', '.svg'];

/** @param {{ doc: () => any, blockById: (id: string) => any, nest: any, refs: any, backend: () => any, salt?: () => string, bibpane?: any, recallsOf?: ((blocks: any[]) => Map<string, string>) | null, results: { cache: Map<string, any> } }} o */
export function createDerived({ doc, blockById, nest, refs, backend, salt = () => '', bibpane = null, recallsOf = null, results }) {
  let preHash = '';
  /** @type {Set<string>} */ let thmSet = new Set();
  /** @type {Map<string, string>} */ let contexts = new Map();   // block id -> refs context prefix
  // the contexts as of a nesting tree: a new paragraph in a container gets its role (head, end) only once it
  // typesets something, so its context is made again then (it was sent with its end line but without its head)
  /** @type {any} */ let contextsSig = null;
  /** recall block id -> the original's (thm-restate \name*: shown as the original's render) @type {Map<string, string>} */
  let recalls = new Map();
  /** assets: name -> hash (a figure edited in place changes its blocks' keys) @type {Map<string, string>} */
  const assetHash = new Map();

  const contextOf = (b) => { if (nest.treeSig && nest.treeSig() !== contextsSig) computeContexts(); return contexts.get(b.id); };
  // the engine's preamble without the \ReflowedMeta data, which goes in front of the title block: a title edit re-keys that block only
  const enginePreamble = () => splitMeta(doc().preamble.source).preamble;
  // nest.compileSource: a container's paragraph compiles with its environment's end line (and its role in the prefix)
  const compileSource = (b) => blockSource(b.kind, nest.compileSource(b), splitMeta(doc().preamble.source));
  const assetOf = (name) => { for (const ext of EXTS) if (assetHash.has(name + ext)) return name + ext; return null; };
  function assetSig(src) {
    if (!assetHash.size || !src.includes('includegraphics')) return '';
    let sig = '';
    for (const m of src.matchAll(GRAPHICS)) { const n = assetOf(m[2].trim()); if (n) sig += `|${n}:${assetHash.get(n)}`; }
    return sig;
  }
  // the backend's own key when it has one (it covers every file the block opens,
  // \input included, and the engine build): one scheme for the app's map and the persistent cache
  const ck = (b) => blockCacheKey(backend(), { source: compileSource(b), context: contextOf(b) ?? '' }, { salt: salt(), preHash, assets: assetSig(b.source) });
  /** what a block shows: its own result, or a recall's original's */
  const viewKey = (b) => { const o = recalls.get(b.id); const ob = o && blockById(o); return ob ? `recall:${ck(ob)}` : ck(b); };
  const viewResult = (b) => { const o = recalls.get(b.id); const ob = o && blockById(o); return results.cache.get(ob ? ck(ob) : ck(b)); };
  const kindOf = (src) => guessKind(src, thmSet);

  // A change of doc.bib keeps the preamble's key (bibKeyPart: the kind only) and reaches the compile keys through
  // each block's context: the References pane's `%rtxbib:<hash>` line (the cited entries' records; the whole
  // bibliography for the block printing it), so only those blocks typeset again.
  function bibKeyPart() { const d = doc(); return bibpane ? `bib:${d.bib?.kind ?? 'none'}` : (d.bib?.source ?? ''); }
  function withBibContext(b, c) {
    if (!bibpane) return c;
    let sig = '';
    try { sig = bibpane.contextFor(b, doc()) ?? ''; } catch (e) { console.error('bibpane.contextFor:', e); }
    return sig ? (c ? `${sig}\n${c}` : sig) : c;
  }
  function computeContexts() {
    const d = doc();
    // containers are left out (a paragraph follows the block before its container); a paragraph's
    // context ends with its environment's head and its role flags (nest.extraContext)
    const plain = nest.contextView(d.blocks).map((b) => ({ id: b.id, kind: b.kind, source: b.source }));
    const next = new Map();
    const bbl = d.bib?.kind === 'bbl' ? d.bib.source ?? null : null;      // a thebibliography .bbl: the cited \bibitem's
    plain.forEach((b, i) => {
      let c = ''; try { c = refs.contextFor(plain, i, { bbl }) ?? ''; } catch (e) { console.error('contextFor:', e); }
      c = withBibContext(b, c);
      const x = nest.extraContext(blockById(b.id));
      if (x) c = c ? `${c}\n${x}` : x;
      if (c) next.set(b.id, c);
    });
    contexts = next;
    contextsSig = nest.treeSig?.() ?? null;
    try { recalls = recallsOf ? recallsOf(plain) : new Map(); } catch (e) { console.error('recallsOf:', e); recalls = new Map(); }
  }
  function preambleChanged() {
    preHash = hash(`${enginePreamble()}\n${bibKeyPart()}`);
    thmSet = new Set(theoremKinds(doc().preamble.source).map((t) => t.env));
  }
  function loadAssets(assets) {
    assetHash.clear();
    for (const a of assets ?? []) assetHash.set(a.name, a.rendition?.hash ? `${a.hash}+${a.rendition.hash}` : a.hash);
  }
  const figureNames = (src) => [...src.matchAll(GRAPHICS)].map((m) => ({ name: assetOf(m[2].trim()), opts: m[1] ?? '' })).filter((x) => x.name);

  return {
    get preHash() { return preHash; }, get thmSet() { return thmSet; }, get contexts() { return contexts; }, get recalls() { return recalls; },
    assetHash, assetOf, assetSig, figureNames, enginePreamble, compileSource, contextOf, ck, viewKey, viewResult, kindOf,
    computeContexts, preambleChanged, loadAssets, bibKeyPart,
  };
}
