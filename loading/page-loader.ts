// THE MULTI-FILE RELEASE'S BOOT LOADER, the page side (the one file here that touches the DOM): scripts/build.ts
// bundles it as an IIFE and scripts/lib/multifile.ts inlines it into the release's index.html. It does for the
// multi-file release what the single file's inline parts and boot script do, from the release's tree beside the page
// (tree.ts, its index the manifest: manifest.ts), every fetch reported to the page's one status store (status.ts):
//   1. the essential files (group 'essential': the start file, one gzip pack of the style sheets, the protobuf runtime
//      and the viewer, the app and its parts, the default documents),
//      fetched at once; the overlay (#boot) shows the store's fraction of their bytes, 0 % → 100 % (the manifest's sizes,
//      the compressed ones, are the measure: a server may send no Content-Length); the start file is unpacked here
//      (DecompressionStream), so it does not depend on the server's compression;
//   2. then, as the single file's page would have them: the style sheets as <style>, globalThis.__rtxSeeds
//      (app/seeds.ts), globalThis.__rtxEditor (engine/web/backend.js's boot object), the two classic scripts run inline,
//      and the app imported by its bare name through an import map (the app's modules import each other as
//      @rtx/<file name>: the start file's from blob: URLs of its bytes, the lazy parts from their files beside the page);
//   3. the rest (group 'rest': the worker, the engine's packs, the seed cache, the licence texts, the app's lazy parts),
//      asked for at the start too, right after the essential files (not once they have all come), at a
//      low priority (fetch priority 'low': the essential files first, but nothing waits for the UI), except what cached
//      results are shown with: the seed cache, the worker and its TeX files' pack (the fonts are made from it); the app's status line shows them from the
//      same store once the app says its UI is on screen (bootHandoff().shown()); the overlay fades out.
//      __rtxEditor's createWorker(), initArgs() (the TeX files' pack), engineArgs() (the wasm's and the format's packs:
//      only typesetting waits for them) and seedCache wait for the files they need;
//   4. what the app asks for when a feature is used (group 'demand'), never before: the public inspector's folder,
//      whose URL is
//      __rtxEditor.inspector (null when the release has none: inspector/index.ts panelFiles()). The status store is not
//      told of them (nothing waits for them at the start).
// The engine's wasm is compiled from bytes in the worker, so the server's MIME types do not matter.
import { fetchAsync, treeBase, type Tree } from './tree.ts';
import { manifestIndex, moduleName, type Manifest, type ManifestFile, type StartPart } from './manifest.ts';
import { readPack } from './pack.ts';
import { filesStatus, percent, type BootHandoff } from './status.ts';

type Editor = {
  version: string; build: string; backends: unknown[];
  /** the public inspector's folder (a URL ending in /), or null */
  inspector: string | null;
  seedCache: Promise<unknown>;
  createWorker(): Promise<Worker>;
  initArgs(): Promise<{ packs: Uint8Array[] }>;
  engineArgs(): Promise<{ packs: Uint8Array[] }>;
  licences: Promise<void>;
};
const G = globalThis as unknown as { __rtxBoot?: BootHandoff; __rtxEditor?: Editor; __rtxSeeds?: Record<string, string> };

const manifest = JSON.parse(document.getElementById('rtx-manifest')?.textContent ?? 'null') as Manifest | null;
const all: ManifestFile[] = manifest?.files ?? [];
const release: Tree = { id: 'release', base: treeBase('./', document.baseURI), index: manifest ? manifestIndex(manifest) : null };
const status = filesStatus();
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const boot = document.getElementById('boot');
const bar = boot?.querySelector<HTMLElement>('.rtx-load');
const fill = boot?.querySelector<HTMLElement>('.rtx-load-fill');
const pct = boot?.querySelector<HTMLElement>('.rtx-load-pct');
let shownUi = false, failedBoot = false;

G.__rtxBoot = {
  shown() {
    if (shownUi) return;
    shownUi = true;
    if (!boot) return;
    // the overlay fades out over the drawn UI (what still loads goes on in the status line)
    const gone = () => boot.remove();
    if (reduce()) { gone(); return; }
    boot.addEventListener('transitionend', gone, { once: true });
    boot.dataset.leaving = '';
    setTimeout(gone, 600);            // no transitionend (a hidden tab): it goes anyway
  },
  failed(message) { fail(message); },
};

/** the overlay drawn from the store, once per frame */
let frame = 0;
function draw() {
  frame = 0;
  if (failedBoot) return;
  const f = status.fraction('essential'), p = percent(f);
  if (fill) fill.style.transform = `scaleX(${f})`;
  if (pct) pct.textContent = `${p} %`;
  if (bar) { bar.setAttribute('aria-valuenow', String(p)); bar.dataset.loadPercent = String(p); }
}
const off = status.subscribe(() => { if (shownUi) off(); else if (!frame) frame = requestAnimationFrame(draw); });

function fail(message: string) {
  if (shownUi || !boot) return;
  failedBoot = true;
  const box = document.createElement('div');
  box.className = 'rtx-load-error';
  box.setAttribute('role', 'alert');
  const p = document.createElement('p');
  // from a disk (file://) a page cannot fetch the files beside it: the single file is the copy for that
  p.textContent = location.protocol === 'file:'
    ? 'This copy of ReflowEd is several files and needs a web server. To open it from a disk, use the single file (reflowtex-editor.html).'
    : `ReflowEd could not be loaded: ${message}`;
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Reload';
  again.addEventListener('click', () => location.reload());
  box.append(p, again);
  boot.replaceChildren(box);
}

const loads = new Map<string, Promise<Uint8Array>>();
/** a release file's bytes, fetched once (its name is its content: any cached copy is good) */
function load(id: string): Promise<Uint8Array> {
  let p = loads.get(id);
  if (!p) loads.set(id, p = fetchAsync(release, id, (e) => status.report(e), fetch, { cache: 'force-cache', priority: priorityOf(id) }));
  return p;
}
/** the engine's own packs: the worker's 'engine' (typesetting) needs them, its 'init' (the fonts of cached results) does not */
const ENGINE_PACKS = new Set(['pack:wasm', 'pack:format']);
/** Low priority: the rest but what the cached results are shown with (the seed cache, and the worker with its TeX files'
 *  pack: their fonts are made from it), so the UI's files and those come first; nothing waits for the UI */
const priorityOf = (id: string): RequestPriority => {
  const f = all.find((x) => x.id === id);
  if (!f || f.group !== 'rest') return 'auto';
  return f.type === 'seedcache' || f.type === 'worker' || (f.type === 'pack' && !ENGINE_PACKS.has(id)) ? 'auto' : 'low';
};
const text = (b: Uint8Array) => new TextDecoder().decode(b);
/** the files and the start file's parts, by type */
const items: StartPart[] = all.flatMap((f) => (f.type === 'start' ? f.parts ?? [] : [{ id: f.id, type: f.type }]));
const ofType = (t: ManifestFile['type']) => items.filter((f) => f.type === t);
const fileOf = (id: string) => all.find((f) => f.id === id);

const gunzip = (b: Uint8Array) => new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')));
async function gunzipJson(b: Uint8Array): Promise<unknown> { return JSON.parse(await gunzip(b).text()); }

async function start() {
  status.expect('release', all.filter((f) => f.group !== 'demand').map((f) => ({ name: f.id, group: f.group, total: f.bytes })));
  const essential = all.filter((f) => f.group === 'essential');
  const gotP = Promise.all(essential.map((f) => load(f.id)));
  // the rest from now on, asked for right after the essential files (low priority: they come first) and not waited for;
  // one that fails does not stop the UI: the store keeps the reason (the status line shows it), and what needs the
  // file fails with its name
  for (const f of all.filter((x) => x.group === 'rest')) load(f.id).catch(() => {});
  const got = await gotP;
  const bytes = new Map<string, Uint8Array>();
  for (const [i, f] of essential.entries()) {
    if (f.type !== 'start') { bytes.set(f.id, got[i]); continue; }
    let parts: Map<string, Uint8Array>;
    try { parts = readPack(new Uint8Array(await gunzip(got[i]).arrayBuffer())); } catch (e) { throw new Error(`${f.path} could not be unpacked (${(e as Error).message})`); }
    for (const p of f.parts ?? []) {
      const b = parts.get(p.id);
      if (!b) throw new Error(`${f.path} lacks ${p.id}`);
      bytes.set(p.id, b);
    }
  }

  for (const f of ofType('css')) {
    const st = document.createElement('style');
    st.textContent = text(bytes.get(f.id)!);
    document.head.append(st);
  }
  const seeds: Record<string, string> = {};
  for (const f of ofType('seed')) seeds[f.id.replace(/^seed:/, '')] = text(bytes.get(f.id)!);
  G.__rtxSeeds = seeds;

  const packs = ofType('pack').map((f) => f.id);
  const loadPacks = (ids: string[]) => Promise.all(ids.map(load)).then((p) => ({ packs: p }));
  const worker = fileOf(ofType('worker')[0]?.id)!;
  let workerUrl: Promise<string> | null = null;
  const licences = ofType('licences')[0], index = ofType('licences-index')[0];
  const cache = ofType('seedcache')[0];
  // the app's modules by their bare names: the start file's from its bytes, the lazy parts from their files
  const imports: Record<string, string> = {};
  for (const m of [...ofType('module'), ...ofType('chunk')]) {
    const b = bytes.get(m.id), f = fileOf(m.id);
    imports[moduleName(m.id)] = b ? URL.createObjectURL(new Blob([b as BlobPart], { type: 'text/javascript' })) : new URL(f!.path, release.base).href;
  }
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify({ imports });
  document.head.append(map);
  const panel = fileOf('inspector:inspector.js');
  G.__rtxEditor = {
    version: manifest!.version, build: manifest!.build, backends: [],
    inspector: panel ? new URL(panel.path.replace(/[^/]*$/, ''), release.base).href : null,
    seedCache: cache ? load(cache.id).then(gunzipJson).catch(() => null) : Promise.resolve(null),
    createWorker() {
      workerUrl ??= load(worker.id).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'text/javascript' })));
      return workerUrl.then((u) => new Worker(u));
    },
    initArgs: () => loadPacks(packs.filter((id) => !ENGINE_PACKS.has(id))),
    engineArgs: () => loadPacks(packs.filter((id) => ENGINE_PACKS.has(id))),
    // About's data (app/about.js reads the two elements; it waits for this when they are not there yet)
    licences: Promise.all([licences, index].map((f) => (f ? load(f.id) : Promise.resolve(new Uint8Array())))).then(([t, j]) => {
      const el = (id: string, type: string, b: Uint8Array) => { const s = document.createElement('script'); s.type = type; s.id = id; s.textContent = text(b); document.body.append(s); };
      el('third-party-licenses', 'text/plain', t);
      el('rtx-licences', 'application/json', j);
    }),
  };
  G.__rtxEditor.licences.catch(() => {});

  for (const f of ofType('script')) {
    const s = document.createElement('script');
    s.textContent = text(bytes.get(f.id)!);
    document.body.append(s);                 // an inline script runs as it is added
  }
  // (the public viewer, added after DOMContentLoaded, sets the page up at once: src/viewer/src/index.ts)
  await import(/* @vite-ignore */ moduleName(ofType('module')[0].id));
}

if (!manifest || !boot) console.error('the loader found no #rtx-manifest or #boot');
else start().catch((e: Error) => fail(e.message));
