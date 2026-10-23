// @ts-check
// Result keys, memoised. The keys are exactly the ones backend.js
// computed before (the seed cache and every stored result depend on them):
//   sig(src)  = the files src opens that were sent, "name:hash" sorted, joined by ","
//   pkey      = preambleKey(preamble, bbl \0 sig(preamble))
//   keyOf(b)  = blockKey(build, pkey, source, sig ? context \0 sig : context)   sig over context \n source
// What changed is only when work is done: opened() (regexes over the text) runs
// once per distinct source text, the preamble is scanned and hashed once per
// (preamble, bbl, assets version), and a block's key is made again only when its
// text, the preamble key or the sent files changed. Before, every key re-scanned
// and re-hashed the whole preamble: O(blocks × preamble) per pass (close, display,
// diagnostics, the status line, needsCompile, whenIdle).
import { preambleKey, blockKey } from './key.js';

/** A Map whose version goes up on every change (a set to a new value, a delete, a clear). */
export class VersionedMap extends Map {
  constructor() { super(); this.version = 0; }
  set(k, v) { if (!super.has(k) || super.get(k) !== v) this.version++; return super.set(k, v); }
  delete(k) { const had = super.delete(k); if (had) this.version++; return had; }
  clear() { if (this.size) this.version++; super.clear(); }
}

const LIMIT = 20000;          // memo entries kept before a memo starts again (edits make new texts)
// and the characters of the texts they are keyed by: every keystroke is a new text, so 20,000
// entries of a long paragraph (and its context, once per context) held tens of MB in a long session
const CHARS = 4_000_000;

/**
 * @param {{ opened(src: string): [string, string[]][], sent: VersionedMap }} o
 *   opened: the names a source makes TeX open; sent: name -> the hash sent (null: looked up, none)
 */
export function createKeys({ opened, sent }) {
  /** @type {Map<string, { all: [string, string[]][], names: string[] }>} src -> what it opens, and its distinct names sorted */
  const memo = new Map();
  let memoChars = 0;
  const scan = (src) => {
    let m = memo.get(src);
    if (!m) {
      memoChars += src.length;
      if (memo.size > LIMIT || memoChars > CHARS) { memo.clear(); memoChars = src.length; }
      const all = opened(src);
      m = { all, names: [...new Set(all.map(([x]) => x))].sort() };
      memo.set(src, m);
    }
    return m;
  };
  const names = (src) => scan(src).names;
  const sigFrom = (list) => {
    let s = '';
    for (const n of list) { const h = sent.get(n); if (h) s += `${s ? ',' : ''}${n}:${h}`; }
    return s;
  };
  /** the files src opens that were sent, as part of a key */
  const sigOf = (src) => sigFrom(names(src));

  let pMemo = { pre: /** @type {string | null} */ (null), bbl: '', version: -1, key: '' };
  const pkey = (preamble, bbl) => {
    const pre = preamble ?? '';
    if (pMemo.pre !== pre || pMemo.bbl !== bbl || pMemo.version !== sent.version)
      pMemo = { pre, bbl, version: sent.version, key: preambleKey(pre, `${bbl}\u0000${sigOf(pre)}`) };
    return pMemo.key;
  };

  /** @type {Map<string, Map<string, { build: string, pk: string, version: number, key: string }>>} context -> source -> key */
  const blockMemo = new Map();
  let blockN = 0, blockChars = 0;
  const keyOf = (build, pk, b) => {
    const context = b.context ?? '';
    let byCtx = blockMemo.get(context);
    if (!byCtx) { byCtx = new Map(); blockMemo.set(context, byCtx); blockChars += context.length; }
    let e = byCtx.get(b.source);
    if (e && e.build === build && e.pk === pk && e.version === sent.version) return e.key;
    const sig = sigOf(`${context}\n${b.source}`);
    const key = blockKey(build, pk, b.source, sig ? `${context}\u0000${sig}` : context);
    if (!e) {
      blockChars += b.source.length;
      if (++blockN > LIMIT || blockChars > CHARS) { blockMemo.clear(); blockN = 1; blockChars = context.length + b.source.length; byCtx = new Map(); blockMemo.set(context, byCtx); }
    }
    byCtx.set(b.source, { build, pk, version: sent.version, key });
    return key;
  };
  /** opened(src), memoised (sendAssets scans every block of a request too); do not change the array */
  const openedOf = (src) => scan(src).all;
  return { sigOf, pkey, keyOf, opened: openedOf,
    /** (tests) what the memos hold: entries and the characters of their texts */
    stats: () => ({ scanned: memo.size, scannedChars: memoChars, blocks: blockN, blockChars }) };
}
