// Stand-ins for modules not loaded here (contracts.d.ts), so the app
// runs before they land. The app's build resolves `rtx:<name>` to the real
// module when its entry file exists and to this file otherwise (see
// scripts/lib/app-bundle.ts, esbuild plugin); `?stubs=store,refs` in the URL forces a
// stub at run time.
//
//   ids            ulid(), keyBetween(a, b)            (store/ owns the real ones)
//   store          createDocStore(): a Memory DocStore (nothing survives a reload)
//   refs           refsState() from a scan of the sources (labels, refs, cites,
//                  \bibitem and bbl entries), numbers left empty; contextFor = ''
//   io             io.importFile(.tex) via model.parseTex; io.exportTex
//   backend        noneBackend (nothing typeset, instant); the engine (engine/web/backend.js) is the real one
import { scanLabels, scanRefs, scanCites, scanBibitems, parseBblLite } from '../tex/texscan.js';
import { parseTex, toTex, guessKind } from './model.js';

// ── ids ──────────────────────────────────────────────────────────────────────

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0, lastRand = [];
/** A ULID: 48-bit time + 80 random bits, monotonic within one ms. */
export function ulid(now = Date.now()) {
  let rand;
  if (now === lastTime) {
    rand = lastRand.slice();
    for (let i = rand.length - 1; i >= 0; i--) { if (rand[i] < 31) { rand[i]++; break; } rand[i] = 0; }
  } else {
    rand = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b & 31);
  }
  lastTime = now; lastRand = rand;
  let t = '', n = now;
  for (let i = 0; i < 10; i++) { t = B32[n % 32] + t; n = Math.floor(n / 32); }
  return t + rand.map((r) => B32[r]).join('');
}

// Fractional indices over base-62 digits (ASCII order: 0-9 < A-Z < a-z), a
// key is a fraction in (0, 1) written without trailing zeros.
const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function midpoint(a, b) {
  // a: '' is 0; b: null is 1
  if (b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  let n = 0;
  while (b !== null && (a[n] ?? '0') === b[n]) n++;
  if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  const da = a ? D.indexOf(a[0]) : 0, db = b !== null ? D.indexOf(b[0]) : D.length;
  if (db - da > 1) return D[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return D[da] + midpoint(a.slice(1), null);
}
export function keyBetween(a, b) { return midpoint(a ?? '', b ?? null); }
/** n keys in order, evenly spread (an import). */
export function keysFor(n) {
  const out = [];
  let prev = null;
  const width = Math.max(1, Math.ceil(Math.log(n + 2) / Math.log(62)));
  const step = Math.floor(62 ** width / (n + 1));
  for (let i = 1; i <= n; i++) {
    let v = i * step, s = '';
    for (let k = 0; k < width; k++) { s = D[v % 62] + s; v = Math.floor(v / 62); }
    s = s.replace(/0+$/, '');
    if (prev !== null && s <= prev) s = keyBetween(prev, null);
    out.push(s); prev = s;
  }
  return out;
}
export const ids = { ulid, keyBetween };

// ── Memory DocStore (DocStore shape, store/types.ts) ─────────────────

const clone = (x) => (x == null ? x : structuredClone(x));
export const byPos = (a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function memoryStore() {
  const docs = new Map();          // id -> { doc, blocks: Map, assets: Map (id -> { asset, data }), ops: [] }
  const snaps = new Map(), cache = new Map(), subs = new Set();
  const need = (id) => { const e = docs.get(id); if (!e) throw new Error(`no document ${id}`); return e; };
  const emit = (ev) => { for (const f of subs) f(ev); };
  const touch = (e) => { e.doc.updatedAt = Math.max(Date.now(), e.doc.updatedAt + 1); e.doc.blockCount = e.blocks.size; };
  const log = (e, t, blockId, payload) => e.ops.push({ id: ulid(), docId: e.doc.id, blockId, t, payload, at: Date.now(), actor: 'stub' });
  function write(e, b) {
    const prev = e.blocks.get(b.id);
    const next = { attrs: {}, file: 'main.tex', kind: 'paragraph', ...prev, ...clone(b), docId: e.doc.id, rev: (prev?.rev ?? 0) + 1, updatedAt: Date.now() };
    e.blocks.set(b.id, next);
    log(e, prev ? (prev.pos !== next.pos ? 'move' : 'edit') : 'insert', b.id, prev ? { pos: next.pos } : { block: next });
    return clone(next);
  }
  const this_ = {
    kind: 'memory', actor: 'stub',
    async listDocs(q = {}) {
      const t = q.text?.trim().toLowerCase();
      return [...docs.values()].filter((e) => !t || e.doc.title.toLowerCase().includes(t) || [...e.blocks.values()].some((b) => b.source.toLowerCase().includes(t)))
        .map((e) => ({ id: e.doc.id, title: e.doc.title, authors: e.doc.meta.authors ?? [], createdAt: e.doc.createdAt, updatedAt: e.doc.updatedAt,
          openedAt: e.doc.openedAt, blockCount: e.blocks.size, arxivId: e.doc.meta.arxivId, tags: e.doc.meta.tags ?? [] }))
        .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt));
    },
    async createDoc(init = {}) {
      const id = init.id ?? ulid(), now = Date.now();
      const doc = { id, schema: 2, title: init.title ?? '', createdAt: now, updatedAt: now, meta: { authors: [], tags: [], ...(init.meta ?? {}) },
        preamble: { source: init.preamble?.source ?? '\\documentclass{article}\n', rev: 1 }, bib: init.bib ?? { kind: 'none', source: '' },
        settings: { class: 'article', ...(init.settings ?? {}) }, files: init.files ?? [{ path: 'main.tex', role: 'main' }], blockCount: 0 };
      const e = { doc, blocks: new Map(), assets: new Map(), ops: [] };
      const list = init.blocks ?? [];
      const keys = keysFor(list.length);
      list.forEach((b, i) => { const bid = b.id ?? ulid(); e.blocks.set(bid, { attrs: {}, file: 'main.tex', kind: guessKind(b.source), ...clone(b), id: bid, docId: id, pos: b.pos ?? keys[i], rev: 1, updatedAt: now }); });
      doc.blockCount = e.blocks.size;
      docs.set(id, e);
      for (const a of init.assets ?? []) e.assets.set(a.asset.id ?? ulid(), { asset: { ...a.asset, bytes: a.data.length }, data: a.data });
      emit({ type: 'doc', docId: id });
      return id;
    },
    async getDoc(id) { const e = docs.get(id); return e ? { ...clone(e.doc), blocks: [...e.blocks.values()].sort(byPos).map(clone), assets: [...e.assets.values()].map((x) => clone(x.asset)) } : null; },
    async getDocRecord(id) { const e = docs.get(id); return e ? clone(e.doc) : null; },
    async getBlocks(docId) { return [...need(docId).blocks.values()].sort(byPos).map(clone); },
    async deleteDoc(id) { docs.delete(id); emit({ type: 'deleted', docId: id }); },
    async putMeta(id, patch) { const e = need(id); Object.assign(e.doc, clone(patch)); if (patch.preamble) e.doc.preamble.rev = (e.doc.preamble.rev ?? 0) + 1; touch(e); log(e, 'meta', undefined, patch); emit({ type: 'doc', docId: id }); return clone(e.doc); },
    async putBlock(docId, b) { const e = need(docId); const r = write(e, b); touch(e); emit({ type: 'block', docId, blockId: b.id }); return r; },
    async putBlocks(docId, bs) { const e = need(docId); const r = bs.map((b) => write(e, b)); touch(e); return r; },
    async deleteBlock(docId, blockId) { const e = need(docId); const b = e.blocks.get(blockId); e.blocks.delete(blockId); touch(e); log(e, 'delete', blockId, { block: b }); },
    async putAsset(docId, asset, bytes) { const e = need(docId); const a = { id: asset.id ?? ulid(), mime: 'application/octet-stream', hash: '', ...asset, bytes: bytes.length }; e.assets.set(a.id, { asset: a, data: bytes }); return clone(a); },
    async getAsset(docId, id) { return docs.get(docId)?.assets.get(id) ?? null; },
    async getAssetByName(docId, name) { return [...(docs.get(docId)?.assets.values() ?? [])].find((x) => x.asset.name === name) ?? null; },
    async listAssets(docId) { return [...need(docId).assets.values()].map((x) => clone(x.asset)); },
    async deleteAsset(docId, id) { need(docId).assets.delete(id); },
    async appendOps(docId, ops) { need(docId).ops.push(...clone(ops)); },
    async getOps(docId) { return clone(need(docId).ops); },
    snapshots: {
      async list(docId) { return [...snaps.values()].filter((x) => x.docId === docId).map(({ data, ...m }) => m).sort((a, b) => b.at - a.at); },
      async put(docId, label, o = {}) { const e = need(docId); const id = ulid(); snaps.set(id, { id, docId, at: Date.now(), label, kind: o.kind ?? 'manual', blockCount: e.blocks.size, data: await this_.getDoc(docId) }); return id; },
      async get(id) { return clone(snaps.get(id)?.data ?? null); },
      async delete(id) { snaps.delete(id); },
    },
    cache: {
      async get(k) { return cache.get(k) ?? null; },
      async put(k, v) { cache.set(k, v); if (cache.size > 2000) cache.delete(cache.keys().next().value); },
      async delete(k) { cache.delete(k); },
      async clear() { cache.clear(); },
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    close() {},
  };
  return this_;
}
export const createDocStore = async () => memoryStore();
export const beforeDestructive = (store, docId, what) => store.snapshots.put(docId, `Before ${what}`, { kind: 'auto' });

// ── refs: a scan of the sources ──────────────────────────────────────────────

export function createStubRefs() {
  let state = { rev: 0, labels: {}, refs: [], cites: [], bib: {}, numbers: {}, duplicates: [] };
  const listeners = new Set();
  return {
    refsState: () => state,
    contextFor: () => '',
    update(doc, blocks) {
      const labels = {}, dup = new Set(), refs = [], cites = [], bib = {};
      for (const e of parseBblLite(doc.bib?.kind === 'bbl' ? doc.bib.source : '')) bib[e.key] = e;
      for (const b of blocks) {
        for (const l of scanLabels(b.source, b.kind)) {
          if (labels[l.name]) dup.add(l.name);
          else labels[l.name] = { ...l, blockId: b.id, number: '' };
        }
        for (const r of scanRefs(b.source)) refs.push({ ...r, blockId: b.id });
        for (const c of scanCites(b.source)) cites.push({ ...c, blockId: b.id });
        for (const e of scanBibitems(b.source)) bib[e.key] ??= e;
      }
      state = { rev: state.rev + 1, labels, refs, cites, bib, numbers: {}, duplicates: [...dup] };
      for (const fn of listeners) fn(state);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
export const refs = createStubRefs();

// ── io (contracts.d.ts IO) ───────────────────────────────────────────────────

export const io = {
  async importFile(file) {
    const name = file.name ?? 'document.tex';
    if (!/\.(tex|ltx|txt)$/i.test(name)) throw new Error('only .tex files until the importer (io/) is built');
    const text = file.bytes ? new TextDecoder().decode(file.bytes) : await file.text();
    const d = parseTex(text, name.replace(/\.[^.]+$/, ''));
    return { title: d.title, preamble: d.preamble, blocks: d.blocks.map((b) => ({ kind: b.kind, source: b.source, file: name })) };
  },
  async exportZip() { throw new Error('zip export needs io/'); },
  exportTex: (doc) => toTex({ ...doc, preamble: doc.preamble.source }),
};

// ── backends ─────────────────────────────────────────────────────────────────

/** Typesets nothing, at once: every block shows its source. For tests of the
 *  UI that need no engine. */
export const noneBackend = {
  id: 'none',
  label: 'None · source only',
  available: async () => true,
  async compile({ blocks }) {
    const out = {};
    for (const b of blocks) out[b.id] = { key: `none:${b.id}`, status: 'ok', errors: [], warnings: [], nodelist: null, cached: false, ms: 0 };
    return { blocks: out, preamble: { errors: [], warnings: [] }, fonts: {}, stats: { compiled: 0, cached: 0, runs: 0, ms: 0 } };
  },
  compileSnippet: async () => ({ key: 'none', status: 'ok', errors: [], warnings: [], nodelist: null }),
  pdf: async () => ({ pdf: null, log: '', errors: [{ severity: 'error', message: 'no engine', line: null }] }),
  setPreamble: async () => ({ errors: [], warnings: [] }),
  setBib: async () => {},
};
