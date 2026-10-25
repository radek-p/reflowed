// @ts-check
// The editor's compile backend (contracts.d.ts `Backend`, module rtx:backend):
// the warm Tectonic engine with the engine capture in one Web Worker
// (src/worker.ts → dist/editor-worker.js), results cached by key in memory
// and in the document store's cache (IndexedDB), fonts installed in the page.
//
//   import { createBackend } from 'rtx:backend';
//   const be = createBackend({ cache: store.cache });
//   await be.setPreamble(doc.preamble.source); await be.setBib(doc.bib);
//   be.setAssets((name) => store.getAssetByName(…));        // \includegraphics
//   be.setVisible([...ids in view]);                          // viewport first
//   const r = await be.compile({ preamble, blocks, keep, onBlock(id, result) {…} });
//
// Where the worker comes from: the release (globalThis.__rtxEditor =
// { createWorker(), initArgs(), engineArgs?() }, set by its boot script: the single file's, or the
// multi-file build's loader, whose createWorker() may give a Promise of the worker while
// its script is still loading), else the dev server (`workerUrl`, TeX files from /bundle/ on demand).
//
// The open does not wait for the engine. The worker starts in two
// steps: 'init' with initArgs() (the TeX files: what the fonts of cached results need), then 'engine' with
// engineArgs() (the format and the wasm: the multi-file loader's packs; the single file's one pack gave them to init
// already; on a dev page the backend fetches them itself, at a low priority, from the start). Only what runs TeX waits
// for 'engine' (a block typeset, the preamble warmed, TikZ, PDF). Results from a cache are shown without either:
// their keys need the build id (the boot object's, or the dev worker's init, which is quick), seed results' fonts are
// the seed's own (installed in the page at once; the worker checks them later), and other cached results' fonts wait
// for 'init' only.
//
// A stored result (this page's, the seed's, the persistent cache's) is used only while the document's files it read
// are as they were: the worker records what each block's runs opened of them (Result.files, a figure a macro places
// too), the backend adds each file's signature then (fileSigs), and a lookup checks them against the document's now
// (make's dependency rule: a key is a function of the block's text and context; the files are checked, not keyed).
//
// Beyond the contract:
//   compile(req).onBlock(id, result)   each block's result as soon as it is ready (fonts installed)
//   setVisible(ids)                    blocks to compile first (the rest after, in document order)
//   info()                             { build, files, … } after init
//   stats()                            counters (compiled, cache hits by level)
//   usage()                            every bundle file the worker opened (working set)
//   setResourceServer(url, { quiet }?) the TeX resource server ('' none): files the embedded set
//                                      lacks are fetched from it, kept in IndexedDB (resources.js); true when it changed.
//                                      quiet: an address assumed, not set (the tree beside the page): its ls-R is asked
//                                      once per page at most, and when it is not there the server is off, unnamed
//   resources()                        the worker's server provider: { base, status, stats }
import { hash, preambleKey } from './key.js';
import { createIdbCache } from './idb-cache.js';
import { reportQuota } from './quota.js';
import { opened, PICTURE, TEXT_ASSET, fileSig, docName } from './opened.js';
import { createKeys, VersionedMap } from './keys.js';
import { createKept } from './kept-docs.js';               // released documents' states, the last 2
import { evictCache } from './cache-evict.ts';               // (the engine's own, its keys are the engine's)
import { createResourceStore } from '../../loading/cache.ts';  // the TeX resource server's files, kept (disposable)
import { filesStatus } from '../../loading/status.ts';         // the page's one loading status: the worker's requests to the tree go there

const EMPTY = { errors: [], warnings: [] };
// the calls that act for a document (forDoc)
const DOC_METHODS = ['warm', 'isWarm', 'keyPrefix', 'setVisible', 'setAssets', 'setPreamble', 'knownPreamble', 'setBib', 'compile', 'compileSnippet', 'renderTikz', 'pdf', 'keyFor'];
const family = (file) => file.replace(/\.otf$/i, '').replace(/[^a-zA-Z0-9]/g, '_');

// ── Fonts in the page ────────────────────────────────────────────────────────
// The viewer writes `@font-face { font-family: '<family>'; src: url(fontBase +
// served) }` for each original font; fonts made in the worker have no URL, so
// they become blob: URLs. The viewer's rules are taken out of its
// style element as it is appended (a hook on document.head.appendChild) and each
// becomes a FontFace added by script: Chromium makes every CSS @font-face face
// anew, unloaded, whenever a style sheet is added, so each new block's fonts (and
// any other style element) made every family on screen load again: finished
// blocks blank or in a stand-in for a moment, twice or more while others typeset.
// Faces added by script are kept as they are. A font patched again later replaces
// its face once the new file has loaded (swapFace).
const blobUrl = new Map(), current = new Map();
/** family → the url of the face in effect (loaded); current holds the newest patch */
const shown = new Map();
const hooked = new WeakSet();              // heads whose appendChild is hooked (once per document)
function installFontHook() {
  const head = document.head;
  if (hooked.has(head)) return;
  hooked.add(head);
  const RULE = /(@font-face \{ font-family: '([^']+)'; src: url\(')([^']*)('\); \})/g;
  const orig = head.appendChild;
  const scripted = typeof FontFace !== 'undefined' && !!document.fonts?.add;
  head.appendChild = function (node) {
    if (node instanceof HTMLStyleElement && node.textContent.includes('@font-face')) {
      node.textContent = node.textContent.replace(RULE, (all, a, fam, u, b) => {
        // the face on screen (loaded), not a newer patch still loading (that would take effect unloaded)
        const url = shown.get(fam) ?? current.get(fam);
        if (!scripted) return url ? `${a}${url}${b}` : all;
        addFace(fam, url ?? new URL(u, document.baseURI).href);
        return '';
      });
    }
    return orig.call(this, node);
  };
}
function applyFonts(map, fontFiles) {
  for (const [served, bytes] of Object.entries(fontFiles ?? {}))
    if (!blobUrl.has(served)) blobUrl.set(served, URL.createObjectURL(new Blob([bytes], { type: 'font/otf' })));
  for (const [orig, served] of Object.entries(map ?? {})) {
    const url = blobUrl.get(served);
    if (!url) continue;
    const fam = family(orig), prev = current.get(fam);
    if (prev === url) continue;
    current.set(fam, url);
    if (prev) swapFace(fam, url); else shown.set(fam, url);
  }
}
// A font patched again (a later block brought glyphs it lacked) replaces the one on
// screen only once it has loaded: a new @font-face rule took effect at once and the browser drew the
// family's text with nothing (its block period) or a stand-in until the new file loaded, so finished
// blocks flickered while others typeset. Now the new face is loaded first (FontFace API, not in the
// document's set meanwhile), then added and the old face deleted. A face that fails to load leaves the old one in place, with a warning (glyphs only
// the new one has then show as missing; nothing else changes). The newest patch wins a race.
const latestFace = new Map(), liveFace = new Map();
/** a family's first face, added by script (the viewer then loads it and waits for it) */
function addFace(fam, url) {
  if (liveFace.has(fam)) return;
  const face = new FontFace(fam, `url('${url}')`);
  document.fonts.add(face);
  liveFace.set(fam, face);
  shown.set(fam, url);
}
function swapFace(fam, url) {
  if (typeof FontFace === 'undefined' || !document.fonts?.add) {        // no FontFace API: a rule, as before
    const st = document.createElement('style');
    st.dataset.rtxEditorFonts = '';
    st.textContent = `@font-face { font-family: '${fam}'; src: url('${url}'); }\n`;
    document.head.append(st);
    shown.set(fam, url);
    return;
  }
  const face = new FontFace(fam, `url('${url}')`);
  latestFace.set(fam, face);
  pendingFaces.add(face);
  face.load().then(() => {
    if (latestFace.get(fam) !== face) return;
    document.fonts.add(face);
    shown.set(fam, url);
    const old = liveFace.get(fam);
    if (old) document.fonts.delete(old);
    liveFace.set(fam, face);
    swapsDone++;
  }, (e) => { console.warn(`font ${fam}: the patched font could not be loaded (${e?.message ?? e}); the previous one stays`); fontFailures++; })
    .finally(() => pendingFaces.delete(face));
}
/** faces still loading (tests wait for none; the viewer's idle() knows nothing of them) */
const pendingFaces = new Set();
let fontFailures = 0, swapsDone = 0;
export const fontSwaps = () => ({ pending: pendingFaces.size, live: liveFace.size, swaps: swapsDone, failures: fontFailures, settled: Promise.allSettled([...pendingFaces].map((f) => f.loaded)) });

/**
 * @typedef {object} BackendOptions
 * @property {{ get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete?(k: string): Promise<void> } | null} [cache]
 *   the result cache (DocStore.cache); omitted: a local IndexedDB one; null: none
 * @property {{ build?: string, createWorker(): Worker | Promise<Worker>, initArgs(): any, engineArgs?(): any, seedCache?: any } | null} [standalone]
 *   the release's boot object (globalThis.__rtxEditor by default)
 * @property {string | URL} [workerUrl]  the worker script (dev pages)
 * @property {string} [base]              the bundle server's origin (dev pages)
 * @property {number} [timeoutMs]         no answer for a block after this: an error, the engine restarted (30 s)
 * @property {any} [seed]                 prebuilt results: { results, fonts } or { key: result }, or a Promise of it
 * @property {any} [store]                the DocStore assets are looked up in (when setAssets is not called)
 * @property {() => ({ name: string, id?: string } | null)} [route]  the document open in the app (where assets are looked up before setAssets)
 * @property {any} [figures]              the figures module (Ipe renditions), or a function that loads it; none: no Ipe renditions
 * @property {any} [pack]                 a pack given directly (tests)
 * @property {number} [keepReleased]     how many released documents keep their state (2; 0: none)
 * @property {ReturnType<typeof createResourceStore>} [resourceStore]  where the resource server's files are kept (null: nowhere; tests)
 */
/** @param {BackendOptions} [opts] */
export function createBackend(opts = {}) {
  const standalone = () => opts.standalone ?? globalThis.__rtxEditor ?? null;
  const timeoutMs = opts.timeoutMs ?? 30000;
  // { get(key), put(key, result) }: DocStore.cache; none given: a local IndexedDB one; null: none
  let cache = opts.cache !== undefined ? opts.cache : (typeof indexedDB !== 'undefined' ? createIdbCache() : null);
  let worker = null, ready = null, seq = 0, info = null;
  // the TeX resource server: its address, and the files it gave on earlier pages (sent to each new worker)
  let resBase = '', resQuiet = false;
  /** assumed addresses found missing on this page: later workers are not given them (one ls-R per page at most) */
  const resMissing = new Set();
  const resStore = opts.resourceStore !== undefined ? opts.resourceStore : createResourceStore();
  async function sendResources() {
    const base = resQuiet && resMissing.has(resBase) ? '' : resBase;
    const cached = base && resStore ? await resStore.load(base) : {};
    await call('setResources', { base, cached, quiet: resQuiet });
  }
  const pending = new Map();
  let warmedFor = null;
  const mem = new Map();                      // key -> result (this page)
  const counters = { compiled: 0, memHits: 0, seedHits: 0, cacheHits: 0, requests: 0, restarts: 0, deaths: 0, corrupt: 0 };
  // A document's state: what its blocks compile against (the preamble, the .bbl, its files and how they
  // are looked up, its blocks in view). One per document (forDoc(key): two documents open on one page, one
  // engine); `S` is the state of the call running now. The worker is shared: the files it holds are recorded
  // with the state that sent them (workerHas), and a document whose file of a name is not the one there sends
  // its own again.
  //   preamble, bbl, preResult (the preamble's problems), assetLookup, assetsSent (name -> hash sent; null:
  //   looked up, none; its version is part of the key memo), texLooked, wantedExts, visible, keys (keys.js)
  const newDoc = () => {
    counters.docStates = (counters.docStates ?? 0) + 1;   // (tests) states built: a kept one taken back builds none
    const sent = new VersionedMap();
    return { preamble: null, bbl: '', preResult: EMPTY, assetLookup: null, assetsSent: sent, texLooked: new Map(), wantedExts: new Map(), visible: new Set(),
      // memoised (keys.js): the same keys as before, the preamble scanned once per change
      keys: createKeys({ opened: (src) => { counters.opened = (counters.opened ?? 0) + 1; return opened(src); }, sent }) };
  };
  const S0 = newDoc();
  const docs = new Map();                     // forDoc key -> state
  let S = S0;
  let ambient = null;                         // the state a forDoc facade's call is made for (its synchronous part)
  const here = () => ambient ?? S0;
  /** f() with S = st (synchronous) */
  const inDoc = (st, f) => { const prev = S; S = st; try { return f(); } finally { S = prev; } };
  const workerHas = new Map();                // name -> the state whose file of that name the worker has
  const workerSig = new Map();                // name -> the signature of the file of that name the worker has (what a run read)
  // a document closed in its last pane keeps its state (the last 2, unless memory is tight): opened
  // again, nothing is rebuilt; a state dropped takes the worker's record of its files with it
  const kept = createKept({ max: opts.keepReleased ?? 2, onDrop: (st) => { for (const [n, s] of workerHas) if (s === st) workerHas.delete(n); } });
  // a kept document deleted, or changed in another tab: its state is stale
  try { opts.store?.subscribe?.((e) => { if (e?.docId && (e.type === 'deleted' || e.remote)) kept.forget(e.docId); }); } catch { /* no events */ }
  // the build's prebuilt results (the seed paper): { key: result }, or a function key -> result
  //   (a Promise of either, as the single file decodes its seed cache in the background)
  //   { results: { key: result }, fonts: { reqs, served, files: { name: base64 } } } (the build's), or a plain { key: result }
  let seed = opts.seed ?? globalThis.__rtxEditor?.seedCache ?? null;
  let seedFonts = null, fontsLoaded = false;
  const seedGet = (k) => (typeof seed === 'function' ? seed(k) : seed?.[k]) ?? null;
  const unpackSeed = (x) => {
    if (x && typeof x === 'object' && x.results && typeof x.results === 'object') { seedFonts = x.fonts ?? null; return x.results; }
    return x;
  };
  if (seed && typeof seed.then !== 'function') seed = unpackSeed(seed);
  let chain = Promise.resolve();              // one job at a time (the worker is one engine)
  const serial = (f) => { const j = chain.then(f); chain = j.catch(() => {}); return j; };

  // How the worker fails, and what follows:
  //   - an engine abort inside a block: the worker makes a new engine itself (worker.ts recover)
  //   - an error the worker does not catch (an abort outside its queue, a failed script load):
  //     'error' on the worker; it is terminated (an uncaught error leaves it running, holding its
  //     wasm memory), every waiting call fails with dead: true, the next use starts a new one
  //   - no answer in time: the call fails with timeout: true and the worker counts as wedged;
  //     the next use terminates it and starts a new one (compileOne restarts at once)
  //   - init fails (engine files missing or unreadable): the call fails with the worker's
  //     message; with the single file's pack (which cannot change) the failure is kept and
  //     every later use fails at once with it, instead of unpacking the pack again each time
  let wedged = false, fatal = null;
  function kill(reason, extra = {}) {
    try { worker?.terminate(); } catch { /* gone */ }
    worker = null; ready = null; warmedFor = null; fontsLoaded = false; engineMade = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Object.assign(new Error(reason), extra)); }
    pending.clear();
  }
  let starts = 0;
  function start() {
    const sa = standalone();
    if (fatal) { ready = Promise.reject(fatal); ready.catch(() => {}); return ready; }
    wedged = false;
    const made = sa ? sa.createWorker() : new Worker(opts.workerUrl ?? new URL('../dist/editor-worker.js', import.meta.url));
    // (multi-file) a Promise of the worker: it is attached when it comes, unless this start was killed meanwhile
    const gen = ++starts;
    /** @type {Worker | null} */
    let w = null;
    const up = typeof (/** @type {any} */ (made)).then === 'function'
      ? Promise.resolve(made).then((x) => {
        if (gen !== starts || ready !== r) { x.terminate(); throw Object.assign(new Error('the engine was restarted'), { dead: true }); }
        attach(w = x);
      })
      : (attach(w = /** @type {Worker} */ (made)), Promise.resolve());
    const r = up.then(() => (sa ? sa.initArgs() : { base: opts.base ?? location.origin }))
      .then((args) => call('init', args)).then(async (x) => { info = x; if (resBase) await sendResources(); return x; });
    ready = r;
    r.catch((e) => {
      if (w && worker === w) kill(e.message);
      if (sa && !e.dead && !e.timeout) fatal = Object.assign(new Error(e.message), { fatal: true });
    });
    warmedFor = null;
    fontsLoaded = false;
    engineMade = null;
    engineSoon(r);
    S.assetsSent.clear();
    S.texLooked.clear();
    workerHas.clear();                        // other documents' files are sent again when they compile
    workerSig.clear();
    return ready;
  }
  /** @param {Worker} w */
  function attach(w) {
    worker = w;
    w.onmessage = (e) => {
      // a request to the TeX tree, as it happens (loading/tree.ts FetchEvent): the page's loading status
      if (e.data?.files) { filesStatus().report(e.data.files); return; }
      // files the server gave: kept for later pages (not an answer to a call)
      if (e.data?.resources) {
        const { base, fetched, state } = e.data.resources;
        if (state === 'unreachable' && resQuiet && base === resBase) resMissing.add(base);
        counters.resourcesFetched = (counters.resourcesFetched ?? 0) + fetched.length;
        if (fetched.length) resStore?.keep(base, fetched).catch(() => {});
        return;
      }
      const { id, result, error } = e.data ?? {};
      const p = pending.get(id);
      pending.delete(id);
      if (!p) return;
      clearTimeout(p.timer);
      if (error) p.reject(new Error(String(error).split('\n')[0])); else p.resolve(result);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      if (worker !== w) return;
      counters.deaths++;
      kill(`the compile worker failed: ${e.message || 'it could not start or stopped unexpectedly'}`, { dead: true });
    };
    w.onmessageerror = () => { if (worker === w) { counters.deaths++; kill('the compile worker sent a message that could not be read', { dead: true }); } };
  }
  function call(cmd, args, timeout = 0, transfer = []) {
    return new Promise((resolve, reject) => {
      if (!worker) { reject(Object.assign(new Error('the compile worker is not running'), { dead: true })); return; }
      const id = seq++;
      const p = { resolve, reject, timer: 0 };
      if (timeout) p.timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        wedged = true;                                // busy with this call still: restarted on the next use
        reject(Object.assign(new Error(`no answer after ${timeout} ms`), { timeout: true }));
      }, timeout);
      pending.set(id, p);
      try { worker.postMessage({ id, cmd, args }, transfer); } catch (e) { pending.delete(id); clearTimeout(p.timer); reject(e); }
    });
  }
  // ── The engine's own files (the format, the wasm): fetched from the start, given to the worker's 'engine' ──
  /** @type {Promise<any> | null} */
  let engineFiles = null;
  function engineArgs() {
    if (engineFiles) return engineFiles;
    const sa = standalone();
    if (sa) engineFiles = Promise.resolve(sa.engineArgs ? sa.engineArgs() : {});
    else {
      // the dev page: what the worker fetched itself before (one request each, low priority: the UI's files first)
      const base = opts.base ?? location.origin;
      const get = async (u) => {
        let r;
        try { r = await fetch(u, /** @type {RequestInit} */ ({ priority: 'low' })); } catch (e) { throw new Error(`the engine's files could not be loaded: ${u} (${e.message})`); }
        if (!r.ok) throw new Error(`the engine's files could not be loaded: ${u} (HTTP ${r.status})`);
        return new Uint8Array(await r.arrayBuffer());
      };
      engineFiles = Promise.all([get(`${base}/formats/latex.fmt`), get(`${base}/tc/engine/dist/async/tectonic_wasm.wasm`)]).then(([format, wasm]) => ({ format, wasm }));
    }
    const p = engineFiles;
    p.catch(() => { if (engineFiles === p) engineFiles = null; });     // asked again next time
    return p;
  }
  /** @type {Promise<unknown> | null} the worker's 'engine' (this worker's) */
  let engineMade = null;
  /** the engine made in the worker (its files fetched, sent): what runs TeX waits for this, nothing else does */
  function ensureEngine() {
    if (fatal) return Promise.reject(fatal);
    if (engineMade) return engineMade;
    const w = worker, sa = standalone();
    const p = engineMade = engineArgs().then((a) => {
      if (worker !== w || !w) throw Object.assign(new Error('the engine was restarted'), { dead: true });
      return call('engine', a);
    });
    p.catch((e) => {
      if (engineMade !== p) return;
      engineMade = null;
      // the single file's pack cannot change: its failure is kept, as init's is
      if (sa && !e.dead && !e.timeout) { fatal = Object.assign(new Error(e.message), { fatal: true }); kill(e.message); }
    });
    return p;
  }
  /** (worker start) the engine made as soon as its files and the worker are there, off the request chain */
  function engineSoon(up) {
    engineArgs().catch(() => {});
    up.then(() => (ready === up ? ensureEngine() : null)).catch(() => {});
  }
  const buildKnown = () => !!(info?.build ?? standalone()?.build);

  /** The worker up (and the seed's fonts in it); with tex, also warm for the
   *  current preamble. A page whose blocks all come from a cache never warms. */
  // once per page, when the engine is up and the page idle: old builds' results leave the cache
  let evicted = false;
  function evictSoon() {
    const c = /** @type {any} */ (cache);
    if (evicted || !c?.keys || !c?.deleteMany || !info?.build) return;
    evicted = true;
    const run = () => evictCache(c, info.build).then((r) => { if (r.deleted) console.info(`result cache: ${r.deleted} old results removed, ${r.kept} kept`); }, (e) => { reportQuota(e); });
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 10000 }); else setTimeout(run, 2000);
  }
  async function ensure(tex = true) {
    if (seed && typeof seed.then === 'function') seed = unpackSeed(await seed.catch(() => null));
    if (wedged) { counters.restarts++; kill('the engine was restarted'); }
    if (!ready) start();                      // (not !worker: a worker still to come is started already)
    await ready;
    evictSoon();
    if (seedFonts && !fontsLoaded) {
      fontsLoaded = true;
      const files = seedFontsInPage();
      if (files) {
        try { await call('loadFonts', { reqs: seedFonts.reqs, served: seedFonts.served, files }); }
        catch (e) {
          if (e.dead || e.timeout) throw e;
          console.warn(`seed fonts not used (${e.message}): fonts are made again from the results`);
          counters.seedFontsDropped = 1;
          seedFonts = null;
        }
      }
    }
    if (!tex) return;
    if (S.preamble != null && warmedFor !== pkey()) {
      await ensureEngine();
      // the document's own files before the warm: its lipics-v2021.cls or article.cls wins over
      // the embedded copy only if the worker has it when TeX opens the class
      await sendAssets(false, [S.preamble]);
      await flushAssets();
      let r = await call('setPreamble', { preamble: S.preamble, bbl: S.bbl, sig: sigOf(S.preamble) });
      // files TeX looked for and did not find (a class's \includegraphics{\@EventLogo}, a file named
      // through a macro): the ones the document has go to the worker, and the preamble warms again
      if (await sendMissing(r.missing)) r = await call('setPreamble', { preamble: S.preamble, bbl: S.bbl, sig: sigOf(S.preamble), force: true });
      warmedFor = pkey();
      // files: what the warm read of the document (the Files panel's preamble uses)
      S.preResult = { errors: r.errors, warnings: r.warnings, adapted: r.adapted, files: r.files ?? [], ...(r.textwidthPt ? { textwidthPt: r.textwidthPt } : {}) };
      const k = preKey();
      mem.set(k, S.preResult);
      if (cache) { try { await cache.put(k, S.preResult); } catch (e) { reportQuota(e); } }
    }
  }
  /** The seed's fonts as bytes, decoded once, and installed in the page (no worker needed: the seed's results are drawn
   *  with them). seed fonts that cannot be read (a damaged page) are dropped, not fatal: the worker then
   *  makes every font from the cached results' requirements, slower. the page needs them even once the worker
   *  has them: a cached block's 'fonts' request returns no bytes for fonts the worker has, and without a blob: URL the
   *  viewer's @font-face points at fonts/<served> (nothing there from file://). */
  let seedFiles;
  function seedFontsInPage() {
    if (seedFiles !== undefined || !seedFonts) return seedFiles ?? null;
    try {
      const b64 = (x) => (typeof x === 'string' ? Uint8Array.from(atob(x), (c) => c.charCodeAt(0)) : x instanceof Uint8Array ? x : null);
      seedFiles = Object.fromEntries(Object.entries(seedFonts.files ?? {}).map(([k, v]) => { const b = b64(v); if (!b) throw new Error(`font ${k}: not bytes`); return [k, b]; }));
    } catch (e) {
      console.warn(`seed fonts not used (${e.message}): fonts are made again from the results`);
      counters.seedFontsDropped = 1;
      seedFonts = null; seedFiles = null;
      return null;
    }
    installFontHook();
    applyFonts(seedFonts.served, seedFiles);
    return seedFiles;
  }
  // the preamble's own problems, cached like a block's result (a cached page shows them without warming)
  // no fallback id: a key without the engine build would share one key space across engines
  const buildId = () => {
    const b = info?.build ?? standalone()?.build;
    if (!b) throw new Error('engine build id unknown: a cache key was asked for before the engine started');
    return b;
  };
  const preKey = () => `pre.e${buildId()}.${preambleKey(S.preamble ?? '', S.bbl)}`;
  async function cachedPreamble() {
    const k = preKey();
    let r = mem.get(k) ?? seedGet(k);
    if (!r && cache) { try { r = await cache.get(k); } catch { r = null; } }
    if (r) mem.set(k, r);
    return r ?? null;
  }
  async function restart() {
    counters.restarts++;
    const names = [...S.assetsSent.keys()];
    kill('the engine was restarted');
    wedged = false;
    await ensure();
    await sendAssets(false, [], names);              // the new worker gets the document's files again
    await flushAssets();
  }

  // assets: \includegraphics names in the sources → lookup → bytes to the worker
  // Where assets come from: setAssets(lookup); else opts.store (DocStore) for the
  // document open in the app (opts.route(), the app's route, no editorAPI read here); else, in the single file,
  // nothing (the app passes its store, opts.store).
  let storeP = null;
  async function defaultLookup(name) {
    const route = opts.route?.() ?? null;
    if (!route || route.name !== 'doc') return null;
    if (!storeP) storeP = Promise.resolve(opts.store ?? null);      // given by the app; the engine opens no store itself
    const st = await storeP;
    return st?.getAssetByName ? st.getAssetByName(route.id, name).catch(() => null) : null;
  }
  const lookupAsset = (name) => (S.assetLookup ?? defaultLookup)(name);

  // Renditions: an asset's rendition.svg as is; rendition.tikz, or for an
  // Ipe PDF the TikZ of its model, typeset here (worker 'tikz') into SVG.
  const renditions = new Map();               // name + hash -> svg | null
  let figuresMod = null;
  async function renditionOf(a) {
    if (a.rendition?.svg) return a.rendition.svg;
    // an SVG figure (web/src/svgfig) is its own rendition: its bytes, drawn as they are
    if ((/svg/i.test(a.mime ?? '') || /\.svg$/i.test(a.name ?? '')) && a.bytes) return new TextDecoder().decode(a.bytes);
    const key = `${a.name}\u0000${a.hash ?? ''}\u0000${a.rendition?.hash ?? ''}`;
    if (renditions.has(key)) return renditions.get(key);
    let tikz = a.rendition?.tikz ?? null, extra = '';
    if (!tikz && /pdf$/i.test(a.mime ?? a.name) && (a.ipe || a.model) && opts.figures) {
      try {
        figuresMod ??= typeof opts.figures === 'function' ? await opts.figures() : opts.figures;   // the app's, given
        const model = a.model ?? (a.bytes ? await (figuresMod.extractIpeFromPdf ?? figuresMod.extractIpe)(a.bytes) : null);
        if (model) { tikz = figuresMod.toTikz(model); extra = figuresMod.preambleFor?.(model) ?? '\\usepackage{tikz}'; }
      } catch (e) { console.warn(`rendition ${a.name}: ${e.message}`); }
    }
    let svg = null;
    if (tikz) {
      const r = await call('tikz', { source: tikz, extra: extra || '\\usepackage{tikz}' }, 10 * timeoutMs).catch(() => null);
      counters.renditions = (counters.renditions ?? 0) + 1;
      // 'full': the rendition needed a whole compile and a new warm (slow, and memory-hungry in Safari)
      if (r?.via === 'full') counters.renditionsFull = (counters.renditionsFull ?? 0) + 1;
      if (r?.via !== 'warm') console.info(`rendition ${a.name}: ${r?.via ?? 'failed'} (${(r?.errors ?? []).map((e) => e.message).join('; ').slice(0, 300)})`);
      svg = r?.svg ?? null;
      if (!svg) console.warn(`rendition ${a.name}: ${(r?.errors ?? []).map((e) => e.message).join('; ') || 'failed'}`);
    }
    renditions.set(key, svg);
    return svg;
  }

  /** The assets the sources name, looked up every time (a figure edit changes
   *  its rendition), sent to the worker when new or changed. */
  // TeX files of the project (\usepackage{mine}): looked up once per name
  // (until setAssets), and a found one's text scanned for what it loads in turn
  // (S.texLooked: name -> sig | null; S.wantedExts: every name looked up in this page -> extensions)
  /** the worker has this document's file of the name (not another document's) */
  const sentHere = (name, sig) => sig == null || workerHas.get(name) === S;
  async function sendAssets(all = false, sources = [], again = []) {
    const want = new Map();                   // name as written -> extensions
    const scan = (src) => { for (const [n, exts] of S.keys.opened(src)) if (!want.has(n)) want.set(n, exts); };
    for (const s of sources) scan(s);
    for (const n of again) if (!want.has(n)) want.set(n, S.wantedExts.get(n) ?? ['']);
    if (all) for (const n of S.assetsSent.keys()) if (!want.has(n)) want.set(n, S.wantedExts.get(n) ?? ['']);
    for (const [n, exts] of want) S.wantedExts.set(n, exts);
    const list = [];
    for (const [name, exts] of want) {
      const pictures = exts.includes('.pdf') || PICTURE.test(name);      // a picture is looked up each time (edited in place)
      if (!pictures && S.texLooked.has(name) && !all && sentHere(name, S.texLooked.get(name))) continue;
      let a = null;
      for (const ext of exts) { a = await lookupAsset(name + ext); if (a) break; }
      const sig = fileSig(a);
      if (!pictures) S.texLooked.set(name, sig);
      if (!all && S.assetsSent.get(name) === sig && sentHere(name, sig)) continue;
      S.assetsSent.set(name, sig);
      if (a) {
        let bytes = a.bytes;
        if (!bytes && a.base64) bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
        if (!pictures && bytes && TEXT_ASSET.test(a.name)) scan(new TextDecoder().decode(bytes));
        outbox.set(a.name, { a, bytes, pictures, st: S, sig });
      }
    }
  }
  /** Names TeX asked for and did not find (a run's `missing`): looked up in the document once
   *  per page; the ones found are sent. Returns how many were found (the run is then made again).
   *  They are not part of any key (a key never depends on a run): a later change to such a file reaches a block
   *  through its result's file record (filesHold), and the preamble after its next edit. */
  async function sendMissing(names) {
    let found = 0;
    for (const n of names ?? []) {
      if (S.texLooked.has(n) || S.assetsSent.has(n) || !docName(n)) continue;
      const a = await lookupAsset(n);
      const sig = fileSig(a);
      S.texLooked.set(n, sig);
      if (!a) continue;
      S.assetsSent.set(n, sig);
      S.wantedExts.set(n, ['']);
      let bytes = a.bytes;
      if (!bytes && a.base64) bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
      outbox.set(a.name, { a, bytes, pictures: PICTURE.test(a.name), st: S, sig });
      found++;
    }
    if (found) { counters.missingFound = (counters.missingFound ?? 0) + found; await flushAssets(); }
    return found;
  }
  // Looked-up files go to the worker only when something compiles (a page
  // answered from caches sends nothing, and makes no renditions)
  const outbox = new Map();
  // a document's own font files (SegmentSymbol.pfb): the worker makes the page's fonts from
  // them for cached results too, when nothing compiles (no renditions, no TeX)
  const FONT_ASSET = /\.(pfb|pfa|tfm|otf|ttf|afm|enc|map)$/i;
  async function flushFontAssets() {
    if (!worker) return;
    const list = [];
    for (const [k, { a, bytes, st, sig }] of outbox) if (FONT_ASSET.test(a.name)) { list.push({ name: a.name, mime: a.mime, bytes }); workerHas.set(a.name, st); workerSig.set(a.name, sig); outbox.delete(k); }
    if (list.length) await call('setAssets', { assets: list });
  }
  async function flushAssets() {
    if (!outbox.size || !worker) return;
    const list = [];
    for (const { a, bytes, pictures, st, sig } of outbox.values()) {
      workerHas.set(a.name, st);
      workerSig.set(a.name, sig);
      list.push({ name: a.name, mime: a.mime, bytes, svg: pictures ? await renditionOf({ ...a, bytes }) ?? undefined : undefined });
    }
    outbox.clear();
    await call('setAssets', { assets: list });
  }

  /** The document's files of these names (what results' runs read), looked up now: S.assetsSent then holds each
   *  one's signature (null: not in the document), and a changed one goes to the worker before anything compiles.
   *  looked: the names done in this request (each is looked up once per request) */
  async function lookUpFiles(names, looked) {
    const todo = [];
    for (const n of names ?? []) if (!looked.has(n) && docName(n)) { looked.add(n); todo.push(n); }
    if (todo.length) await sendAssets(false, [], todo);
  }
  /** each document file a run read, with the signature of the file the worker gave it (BlockResult.fileSigs); the
   *  names it looked for in vain are left out */
  function sigsOf(files) {
    const out = {};
    for (const n of files ?? []) { const s = docName(n) ? workerSig.get(n) : null; if (s) out[n] = s; }
    return out;
  }
  /** A stored result was made with the document's files as they are now: each file its runs read has the signature
   *  it had then, and each name they looked for in vain is still not in the document. A result without a record
   *  (another engine's) stands. */
  async function filesHold(r, looked) {
    const names = (r.files ?? []).filter(docName);
    if (!names.length) return true;
    await lookUpFiles(names, looked);
    return names.every((n) => (r.fileSigs?.[n] ?? null) === (S.assetsSent.get(n) ?? null));
  }

  // Keys: the preamble's own files in the preamble key, a block's in its
  // block key (only the files it names), so a key never depends on what
  // else was looked up before it in this page.
  // memoised (keys.js, S.keys): the same keys as before, the preamble scanned once per change
  const sigOf = (src) => S.keys.sigOf(src);
  const pkey = () => S.keys.pkey(S.preamble, S.bbl);
  const keyOf = (b) => S.keys.keyOf(buildId(), pkey(), b);

  async function compileOne(b, retry = true) {
    try {
      await ensureEngine();
      return await call('compile', { blocks: [{ id: b.id, key: keyOf(b), source: b.source, context: b.context ?? '', fresh: !!b.fresh }], fonts: false }, timeoutMs);
    } catch (e) {
      if (e.fatal) throw e;                          // the engine cannot start at all: the request fails with why
      if (!e.timeout) {
        // the worker died (the browser killed it, out of memory): a new one, the block once more, then an error on this block only
        await restart();
        if (retry) return compileOne(b, false);
        return { blocks: { [b.id]: { key: keyOf(b), status: 'error', transient: true, nodelist: null, warnings: [],
          errors: [{ severity: 'error', message: `the engine crashed while compiling this block (${e.message}); it was restarted`, line: null }] } } };
      }
      await restart();
      return { blocks: { [b.id]: { key: keyOf(b), status: 'error', transient: false, nodelist: null, warnings: [],
        errors: [{ severity: 'error', message: `no result after ${timeoutMs} ms (an endless loop?); the engine was restarted`, line: null }] } } };
    }
  }

  const snippets = [];
  const snippetContext = (o) => (o.widthBp
    ? `\\hsize=${o.widthBp}bp\\textwidth=\\hsize\\linewidth=\\hsize\\columnwidth=\\hsize\\noindent` : '\\noindent');
  function flushSnippets() {
    // one request per document (a snippet compiles against its document's preamble)
    const all = snippets.splice(0);
    for (const st of new Set(all.map((x) => x.st))) {
      const batch = all.filter((x) => x.st === st);
      const prev = ambient; ambient = st;
      try { flushBatch(batch); } finally { ambient = prev; }
    }
  }
  function flushBatch(batch) {
    const blocks = batch.map((s, i) => ({ id: `snippet${i}`, source: s.o.mode === 'math' ? `$${s.source}$` : s.source, context: snippetContext(s.o) }));
    backend.compile({ blocks, keep: [] }).then((r) => batch.forEach((s, i) => s.resolve(r.blocks[`snippet${i}`])),
      (e) => batch.forEach((s) => s.reject(e)));
  }

  // one compile request (compile() runs it in the serial chain; urgent ones run inside another's loop)
  async function compileJob(req) {
    const t0 = performance.now();
    // an equal text keeps the string held: the key memo then compares one object, not the whole preamble per key
    if (req.preamble != null && req.preamble !== S.preamble) S.preamble = req.preamble;
    if (seed && typeof seed.then === 'function') seed = unpackSeed(await seed.catch(() => null));
    // results from a cache wait for nothing of the engine's but its build id (the keys): the release's boot
    // object has it; a dev page has it from the worker's init (the TeX files' index, quick: no format, no wasm)
    if (!buildKnown()) await ensure(false);
    // the document's files looked up (in the page: they go to the worker only when needed); the keys depend on them
    await sendAssets(false, [S.preamble ?? '', ...req.blocks.map((b) => `${b.context ?? ''}\n${b.source}`)]);
    const pre = await cachedPreamble();
    if (pre) S.preResult = pre;
    const seedFiles = seedFontsInPage();
    const out = {}, todo = [], restored = [], seeded = [];
    let cachedN = 0;
    const looked = new Set();                 // the document's files looked up for this request (results' records)
    for (const b of req.blocks) {
      const key = keyOf(b);
      // a stored result whose files changed since (a figure replaced in place) is not used: the block typesets
      // again, fresh (the worker's own copy of the result is stale too)
      let stale = false;
      const holds = async (x) => { if (x && !(await filesHold(x, looked))) { stale = true; return null; } return x; };
      let r = await holds(mem.get(key));
      if (r) counters.memHits++;
      else {
        r = seedGet(key);
        if (r && !usable(r)) { counters.corrupt++; r = null; }
        r = await holds(r);
        if (r) { counters.seedHits++; mem.set(key, r); if (r.fontReqs) (seedFiles ? seeded : restored).push(r.fontReqs); }
        else if (cache) {
          try { r = await cache.get(key); } catch { r = null; }
          // a damaged record (a partial write, an older shape) is a miss, and it goes
          if (r && !usable(r)) { counters.corrupt++; r = null; try { await cache.delete?.(key); } catch { /* kept */ } }
          r = await holds(r);
          if (r) { counters.cacheHits++; mem.set(key, r); if (r.fontReqs) restored.push(r.fontReqs); }
        }
      }
      if (r) { out[b.id] = { ...r, cached: true }; cachedN++; }
      else if (stale) { counters.staleFiles = (counters.staleFiles ?? 0) + 1; todo.push({ ...b, fresh: true }); }
      else todo.push(b);
    }
    // results from a cache: their fonts, in one request (only fonts that gained glyphs are patched); the worker's
    // TeX files are needed for that (init), not the engine. The seed's results are drawn with the seed's fonts
    // (in the page already); the worker checks their requirements later, off this request (a glyph the seed's fonts
    // lacked is patched in then)
    if (restored.length) { await ensure(false); await flushFontAssets(); const f = await call('fonts', { reqs: restored }); applyFonts(f.fonts, f.fontFiles); }
    if (seeded.length) ensure(false).then(() => call('fonts', { reqs: seeded })).then((f) => applyFonts(f.fonts, f.fontFiles), () => {});
    for (const [id, r] of Object.entries(out)) req.onBlock?.(id, r);
    // viewport first, then document order
    todo.sort((a, b) => (S.visible.has(b.id) ? 1 : 0) - (S.visible.has(a.id) ? 1 : 0));
    // (req.limit) at most that many typeset; the others with no result are left out of the answer (the queue sends them again)
    if (req.limit != null && todo.length > req.limit) todo.length = Math.max(0, req.limit);
    let runs = 0;
    if (todo.length) { await ensure(true); await flushAssets(); }          // warm only when something compiles
    for (const b of todo) {
      await runUrgent();
      const res = await compileOne(b);
      let r = res.blocks[b.id];
      // files the block's run missed that the document has: sent, and the block run once more
      if (r.missing?.length && await sendMissing(r.missing)) r = (await compileOne({ ...b, fresh: true })).blocks[b.id];
      delete r.missing;
      // the document's files the run read, with the signatures of what the worker gave it
      if (r.files?.length) r.fileSigs = sigsOf(r.files);
      runs++; counters.compiled++;
      const f = await call('fonts', {});
      applyFonts(f.fonts, f.fontFiles);
      const { cached: _c, ...clean } = r;
      if (!r.transient) mem.set(r.key, clean);
      out[b.id] = { ...clean, cached: false };
      req.onBlock?.(b.id, out[b.id]);                // shown first, then written (compile() still resolves after the write)
      if (!r.transient && cache && r.status === 'ok') { try { await cache.put(r.key, clean); } catch (e) { reportQuota(e); } }
    }
    return { blocks: out, preamble: S.preResult, fonts: {}, stats: { compiled: runs, cached: cachedN, runs, ms: Math.round(performance.now() - t0) } };
  }
  /** a stored result the page can show: its shape as the worker makes it (build() in worker.ts) */
  function usable(r) {
    if (!r || typeof r !== 'object' || (r.status !== 'ok' && r.status !== 'error')) return false;
    if (!Array.isArray(r.errors ?? []) || !Array.isArray(r.warnings ?? [])) return false;
    if (r.status === 'ok' && (typeof r.nodelist !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.nodelist.slice(-64)))) return false;
    if (r.fontReqs != null && typeof r.fontReqs !== 'object') return false;
    if (r.files != null && !Array.isArray(r.files)) return false;
    return true;
  }
  let running = false;                        // a compile request is in its loop
  const urgent = [];                          // user-priority requests waiting for the loop's next turn
  async function runUrgent() {
    while (urgent.length) {
      const u = urgent.shift();
      const prev = S;
      S = u.st;                                    // the urgent request's document, then back to the running one's
      try { u.resolve(await compileJob(u.req)); } catch (e) { u.reject(e); } finally { S = prev; }
    }
  }

  const backend = {
    id: 'tectonic',
    label: 'In browser · Tectonic (warm)',
    /** the companion's web features work here (patch 0005, rtx-xetex.sty): notes wrapper adds rtx-notes.sty */
    webFeatures: true,
    async available() {
      // the single file (or a given pack): no network; a dev page: its bundle server
      if (standalone() || opts.pack) return true;
      if (!opts.base && !opts.workerUrl && !/[?&]engine\b/.test(globalThis.location?.search ?? '')) return false;
      // the answer is read to its end (a small JSON): a cancelled body, and a HEAD too, show in
      // Chromium as a failed (aborted) request, which the tests rightly count as a fault
      try { const r = await fetch(`${opts.base ?? ''}/bundle/info`, { cache: 'no-store' }); await r.arrayBuffer(); return r.ok; } catch { return false; }
    },
    // warm({ tex: true }): TeX started and warm for the current preamble even when every result
    // is cached (the first edit then compiles as fast as the later ones); in the serial chain, so a
    // compile asked for meanwhile waits for it and finds the engine warm (no second warm)
    // the worker started at once, off the chain (its files and the engine's on their way); the chain waits
    // only for what this warm must do: nothing while the preamble is unknown or cached
    warm: (o = {}) => { const st = here(); if (!ready && !fatal) start(); return serial(async () => { S = st; if (!buildKnown()) await ensure(false); if (o.tex || (S.preamble != null && !(await cachedPreamble()))) await ensure(true); }); },
    /** true once TeX is warm for the current preamble */
    isWarm: () => { const d = here(); return warmedFor != null && d.preamble != null && warmedFor === preambleKey(d.preamble, d.bbl); },
    info: () => info,
    stats: () => ({ ...counters, fontSwaps: fontSwaps().swaps, fontFailures: fontSwaps().failures }),
    /** resolves when every patched font being loaded has been swapped in (or failed) */
    fontsSettled: () => fontSwaps().settled,
    keyPrefix: () => inDoc(here(), () => `e${buildId()}.${pkey()}`),
    setCache(c) { cache = c; },
    setVisible(ids) { here().visible = new Set(ids); },
    setAssets(lookup) {
      const d = here();
      if (Array.isArray(lookup)) { const by = new Map(lookup.map((a) => [a.name, a])); d.assetLookup = async (n) => by.get(n) ?? null; }
      else d.assetLookup = lookup;
      d.assetsSent.clear();
      d.texLooked.clear();
    },
    // a preamble not in a cache is warmed once the engine is there: the wait for its files is off the
    // request chain (cached results asked for meanwhile are shown), and the warm then goes in the chain
    setPreamble: (src) => { const st = here(); return serial(async () => {
      S = st;
      if (src !== S.preamble) S.preamble = src;
      if (!buildKnown()) await ensure(false);
      const pre = await cachedPreamble();            // known: no warm until a block compiles
      if (pre) S.preResult = pre;
      return pre;
    }).then((pre) => pre ?? ensure(false).then(() => ensureEngine()).then(() => serial(async () => { S = st; await ensure(true); return S.preResult; }))); },
    /** the preamble's cached result (its problems, \textwidth) for src, without starting or warming the engine;
     *  null when it has not been warmed yet (or the engine's build is not known yet) */
    async knownPreamble(src) {
      let k;
      try { k = `pre.e${buildId()}.${preambleKey(src ?? '', here().bbl)}`; } catch { return null; }
      let r = mem.get(k) ?? seedGet(k);
      if (!r && cache) { try { r = await cache.get(k); } catch { r = null; } }
      return r ?? null;
    },
    setBib: (bib) => { const st = here(); return serial(async () => { st.bbl = bib?.kind === 'bbl' ? bib.source ?? '' : ''; }); },
    // req.priority === 'user' (the block being edited, its live preview): while a
    // request is compiling, it goes in between that request's blocks (after the block
    // in the engine now) instead of after the whole request
    async compile(req) {
      installFontHook();
      counters.requests++;
      const st = here();
      if (req.priority === 'user' && running) { counters.urgent = (counters.urgent ?? 0) + 1; return new Promise((resolve, reject) => urgent.push({ req, st, resolve, reject })); }
      return serial(async () => {
        S = st;
        running = true;
        try { const r = await compileJob(req); await runUrgent(); return r; } finally { running = false; }
      });
    },
    /** A label or minipage for a figure: calls made in one tick go to the
     * */
    compileSnippet(source, o = {}) {
      installFontHook();
      return new Promise((resolve, reject) => {
        snippets.push({ source, o, resolve, reject, st: here() });
        if (snippets.length === 1) queueMicrotask(flushSnippets);
      });
    },
    /** A tikzpicture as SVG (an Ipe figure's rendition, stored as asset.rendition.svg). */
    // extra: preamble lines the picture needs when the document's lack them (a full compile only then)
    renderTikz: (source, extra = '') => { const st = here(); return serial(async () => { S = st; await ensure(); await ensureEngine(); return call('tikz', extra ? { source, extra } : { source }, timeoutMs); }); },
    async pdf(req) {
      const st = here();
      return serial(async () => {
        S = st;
        await ensure(true);
        await ensureEngine();
        await sendAssets(false, [req.preamble, ...req.blocks.map((b) => b.source)], req.files ?? []);   // and every file of the document (pdf-request.js)
        await flushAssets();
        const body = req.blocks.map((b) => b.source).join('\n\n');
        const r = await call('pdf', { preamble: req.preamble, body, bbl: S.bbl }, 10 * timeoutMs);
        return { pdf: r.pdf ? new Blob([r.pdf], { type: 'application/pdf' }) : null, log: r.log, aux: r.aux, errors: r.errors, ms: r.ms };
      });
    },
    /** Every result this page has (the build's seed-cache recorder). */
    dump: () => Object.fromEntries(mem),
    /** the worker's fonts as they stand (the build's seed: { reqs, served, files }) */
    dumpFonts: () => serial(async () => { await ensure(false); return call('dumpFonts'); }),
    /** the engine's memory: wasm heap and snapshot bytes (tests) */
    /** test hook: the next n block runs in the worker trap like an engine abort; how 'death': the
     *  next block run throws outside the worker's queue (an uncaught error, no answer) */
    simulateCrash: (times = 1, how = 'abort') => serial(async () => { await ensure(false); return call('simulateCrash', { times, how }); }),
    memory: async () => { if (!worker) return null; await ready; return call('memory'); },
    usage: () => serial(async () => { if (!ready) start(); await ready; return call('usage'); }),
    /** The TeX resource server (url, '' for none). A change drops this page's results that failed (a missing file
     *  may be there now; failed results are never stored) and warms again before the next block; resolves true when
     *  it changed. Results are keyed as before: a file from the server never changes a key.
     *  quiet: the address is assumed, not set (the tree beside the page; see the header). */
    setResourceServer(url, { quiet = false } = {}) {
      const u = String(url ?? '').trim();
      const base = u && !u.endsWith('/') ? `${u}/` : u;
      if (base === resBase && !!quiet === resQuiet) return Promise.resolve(false);
      resBase = base; resQuiet = !!quiet && !!base;
      for (const [k, r] of mem) if (r?.status === 'error' || (k.startsWith('pre.') && r?.errors?.length)) mem.delete(k);
      warmedFor = null;
      return serial(async () => { if (worker) { await ready; await sendResources(); } return true; });
    },
    resourceServer: () => resBase,
    /** whether the address in force is an assumed one, and whether it was found missing on this page */
    resourceServerState: () => ({ base: resBase, quiet: resQuiet, missing: resQuiet && resMissing.has(resBase) }),
    resources: () => serial(async () => { if (!worker) return null; await ready; return call('resources'); }),
    /** The persistent cache's key a block would get now (context, source, the files it opens); the app's key should be this */
    keyFor: (b) => inDoc(here(), () => keyOf(b)),
    hash,
    /** the backend for one document (its preamble, .bbl, files, blocks in view): every call above made
     *  through it uses that document's state; the engine, the worker and the result caches are shared. The
     *  backend itself is the page's first document's. Wrappers put on the backend (notes) apply: the facade
     *  calls the backend's methods as they are at the call. */
    /** (tests) the documents that have a state now (forDoc keys, released ones gone) */
    docKeys: () => [...docs.keys()],
    /** (tests) the released documents whose state is kept, oldest first */
    keptKeys: () => kept.keys(),
    forDoc(key) {
      let st = docs.get(key);
      if (!st) docs.set(key, st = kept.take(key) ?? newDoc());   // a kept state is taken back as it was
      const f = Object.create(backend);
      for (const k of DOC_METHODS) f[k] = (...a) => { const prev = ambient; ambient = st; try { return backend[k](...a); } finally { ambient = prev; } };
      f.docKey = key;
      /** the document closed in its last pane: its state is kept for a later forDoc(key) (kept-docs.js), or goes
       *  when memory is tight */
      f.release = () => {
        if (docs.get(key) !== st) { for (const [n, s] of workerHas) if (s === st) workerHas.delete(n); return; }
        docs.delete(key);
        kept.keep(key, st);
      };
      return f;
    },
  };
  globalThis.__rtxEditor?.backends?.push(backend);    // the build's seed-cache recorder finds it here
  return backend;
}

