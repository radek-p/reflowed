// @ts-check
// What one document's blocks compile against, derived from it: the preamble's hash and
// theorem kinds, each block's refs context and the recalls (thm-restate), the asset hashes, the files each block
// uses (doc/block-files.ts: its last result's record, its source's names), and from them a block's compile key
// (ck), what it shows (viewKey, viewResult) and its source as compiled. No DOM: tests/test-doc-units.ts and
// tests/test-keys.ts.
//
//   const derived = createDerived({ doc, blockById, nest, refs, backend, salt, bibpane, recallsOf, results })
//     derived.preHash · derived.thmSet · derived.contexts · derived.recalls · derived.assetHash   (read; the maps live)
//     derived.enginePreamble() · derived.compileSource(b) · derived.contextOf(b)
//     derived.ck(b) · derived.viewKey(b) · derived.viewResult(b) · derived.kindOf(source)
//     derived.pass(fn)   fn reads many blocks' keys (and changes no block): what they depend on that is the whole list's
//                        (the nesting tree, nest.pass) read once for all of them, not once per block
//     derived.computeContexts()   every block's context and the recalls, again (a structure or source change)
//     derived.preambleChanged()   the preamble's hash (with the bibliography's part) and theorem kinds, again
//     derived.loadAssets(assets)  the asset hashes of an opened document · derived.noteAsset(meta) · forgetAsset(meta)
//     derived.assetOf(name) · derived.assetSig(b) · derived.bibKeyPart()
//     derived.filesOf(b) · derived.preambleFiles()   what a block, the preamble, uses (block-files.ts Used)
//     derived.usedAssets(b)       the document's files a block uses: [{ name, opts, include }] (its \includegraphics
//                                 first, with their options and the command as written)
//     derived.landed(id, key, r)  a block's result landed: its record kept; the block's key now when the result
//                                 belongs there too (it named files the key had not hashed: its first compile)
//   hash(str): cyrb53, the app's 53-bit string hash
import { blockCacheKey } from './cache-key.js';
import { splitMeta, blockSource } from '../meta/compile.ts';
import { guessKind, theoremKinds } from './kinds.ts';
import { includesIn, usedBy } from './block-files.ts';
import { fileSig } from '../../../engine/web/opened.js';   // a file's signature: the engine's, so a result's record compares

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

const EXTS = ['', '.pdf', '.png', '.jpg', '.jpeg', '.svg'];

/** @param {{ doc: () => any, blockById: (id: string) => any, nest: any, refs: any, backend: () => any, salt?: () => string, bibpane?: any, recallsOf?: ((blocks: any[]) => Map<string, string>) | null, results: { cache: Map<string, any>, files: import('./block-files.ts').BlockFiles, preamble?: { peek(): any } } }} o */
export function createDerived({ doc, blockById, nest, refs, backend, salt = () => '', bibpane = null, recallsOf = null, results }) {
  let preHash = '';
  /** @type {Set<string>} */ let thmSet = new Set();
  /** @type {Map<string, string>} */ let contexts = new Map();   // block id -> refs context prefix
  // the contexts as of a nesting tree: a new paragraph in a container gets its role (head, end) only once it
  // typesets something, so its context is made again then (it was sent with its end line but without its head)
  /** @type {any} */ let contextsSig = null;
  /** recall block id -> the original's (thm-restate \name*: shown as the original's render) @type {Map<string, string>} */
  let recalls = new Map();
  /** assets: name -> signature (opened.js fileSig: a figure edited in place changes its blocks' keys) @type {Map<string, string | null>} */
  const assetHash = new Map();

  const pass = (fn) => (nest.pass ? nest.pass(fn) : fn());
  const contextOf = (b) => { if (nest.treeSig && nest.treeSig() !== contextsSig) computeContexts(); return contexts.get(b.id); };
  // the engine's preamble without the \ReflowedMeta data, which goes in front of the title block: a title edit re-keys that block only
  const enginePreamble = () => splitMeta(doc().preamble.source).preamble;
  // nest.compileSource: a container's paragraph compiles with its environment's end line (and its role in the prefix)
  const compileSource = (b) => blockSource(b.kind, nest.compileSource(b), splitMeta(doc().preamble.source));
  const assetOf = (name) => { for (const ext of EXTS) if (assetHash.has(name + ext)) return name + ext; return null; };
  const filesOf = (b) => results.files.of(b);
  /** the document's files a block uses (asset names; none: an empty list), its own \includegraphics first */
  function usedAssets(b) {
    /** @type {Map<string, { name: string, opts: string, include: string }>} */
    const out = new Map();
    const add = (name, opts = '', include = '') => { if (name && !out.has(name)) out.set(name, { name, opts, include }); };
    for (const g of includesIn(b.source)) add(assetOf(g.name), g.opts, g.include);
    const u = filesOf(b);
    for (const n of u.opened) if (assetHash.has(n)) add(n);
    for (const n of u.named) add(assetOf(n));
    return [...out.values()];
  }
  /** the key's part for the files a block uses: each one's signature, in name order (a figure replaced in place, a
   *  macro's figure too, gives its blocks new keys) */
  function assetSig(b) {
    if (!assetHash.size) return '';
    const u = filesOf(b);
    if (!u.opened.length && !u.named.length) return '';
    const names = new Set();
    for (const n of u.opened) if (assetHash.has(n)) names.add(n);
    for (const n of u.named) { const a = assetOf(n); if (a) names.add(a); }
    return [...names].sort().map((n) => `|${n}:${assetHash.get(n)}`).join('');
  }
  /** A block's result landed under `key`: its record of the files kept, when it answers the block as it is (its key
   *  still `key`). When that record named files the key had not hashed (the block's first compile: what TeX opened,
   *  a figure a macro places), the block's key moves: the key it has now, if the result was made with those files as
   *  they are (its signatures are the document's), for the result to be kept under too: nothing typesets again.
   *  @returns {string | null} */
  function landed(id, key, r) {
    const b = blockById(id);
    if (!b || ck(b) !== key || !results.files.note(id, r)) return null;
    for (const n of r.files) if ((r.fileSigs?.[n] ?? null) !== (assetHash.get(n) ?? null)) return null;
    return ck(b);
  }
  const preambleFiles = () => usedBy(doc().preamble.source, results.preamble?.peek());
  // the backend's own key when it has one (it covers every file the block opens,
  // \input included, and the engine build): one scheme for the app's map and the persistent cache
  const ck = (b) => blockCacheKey(backend(), { source: compileSource(b), context: contextOf(b) ?? '' }, { salt: salt(), preHash, assets: assetSig(b) });
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
  function computeContexts() { pass(contextsNow); }
  function contextsNow() {
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
    for (const a of assets ?? []) noteAsset(a);
  }
  /** a file written (svgfig's drawings): its blocks' keys move */
  function noteAsset(a) { assetHash.set(a.name, fileSig(a)); }
  function forgetAsset(a) { assetHash.delete(a.name); }

  return {
    get preHash() { return preHash; }, get thmSet() { return thmSet; }, get contexts() { return contexts; }, get recalls() { return recalls; },
    assetHash, assetOf, assetSig, usedAssets, filesOf, preambleFiles, landed, enginePreamble, compileSource, contextOf, ck, viewKey, viewResult, kindOf,
    computeContexts, preambleChanged, loadAssets, noteAsset, forgetAsset, bibKeyPart, pass,
  };
}
