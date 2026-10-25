// THE PAGE'S SERVICES: what every editor mounted on a page shares, made once by the page's host
// (main.js for the standalone page, a test harness for two editors): the modules (`rtx:<name>`: the module's
// entry or app/stubs.js), the document store, the refs module, the backends (one engine worker per page),
// notes (the viewer's kind and the compile wrapper), the View options and the inspector (outside a release only:
// null in a release, its module never imported). Each editor gets them through app/mount.ts's `services`.
//
//   await pageReady()                                  the viewer is on the page, the companion package loaded
//   const s = await createPageServices({ params, route?, store? })
//     params  the page's options (app/release-mode.js pageParams): ?stubs=, ?backend=, ?store=memory, ?engine
//     route   the route the engine names in its messages (the standalone page's)
//     store   'memory' for a store that keeps nothing (a harness); default: params' ?store=, else IndexedDB
//   s.services (app/mount.ts EditorServices) · s.kinds ({ store: 'real' | 'stub', … }) · s.modules (storeMod, ioMod, refsMod, mountHome)
import * as storeReal from 'rtx:store';
import * as ioReal from 'rtx:io';
import * as homeReal from 'rtx:home';
import * as refsReal from 'rtx:refs';
import * as backendReal from 'rtx:backend';
import which from 'rtx:modules';
import * as stubs from './stubs.js';
import META_STY from '../../../tex/reflowed-meta.sty';     // the title package, for exports
import { featureFailed, isRelease } from './release-mode.js';
import { devSeedCache } from './dev-seed.js';
import { installNotes } from '../notes/index.js';
import { installView } from '../view/index.js';
import type { EditorServices, InspectorService, NotesService, ViewService } from './mount.ts';

const MODULES = ['store', 'io', 'home', 'refs', 'backend'] as const;
type ModuleName = typeof MODULES[number];
export type Kinds = Record<ModuleName, 'real' | 'stub'>;

interface Backend { id: string; webFeatures?: boolean; available?(): Promise<boolean>; warm?(): void }
type BackendOptions = NonNullable<Parameters<typeof backendReal.createBackend>[0]>;
export type Route = { name: string; id?: string } | null;
/** what the services read of the store module (the rest of it goes to the editors as it is) */
interface StoreModule { createDocStore?(o?: { kind?: 'memory' }): Promise<{ cache?: BackendOptions['cache'] }>; ids?: object; AutoSnapshots?: unknown; beforeDestructive?: unknown }
interface IoModule { io?: object; setMetaPackage?(text: string): void }

interface RefsModule { refs?: object; createRefs?(): object; recallsOf?: unknown; numberingState?: () => unknown }

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }

/** the viewer is on the page (its host), and the companion package draws its kinds in the blocks mounted after it */
export async function pageReady(): Promise<void> {
  const w = window as Window & { reflowtex?: { host?: unknown } };
  if (!w.reflowtex?.host) await new Promise<void>((r) => document.addEventListener('reflowtex:host', () => r(), { once: true }));
  try { await import('reflowtex/companion'); } catch (e) { featureFailed('companion', e); }
}

export async function createPageServices({ params, route = () => null, store: storeKind = null }: {
  params: URLSearchParams; route?: () => Route; store?: 'memory' | null;
}) {
  const forced = new Set((params.get('stubs') ?? '').split(',').filter(Boolean));
  const real = (name: ModuleName) => which[name] === 'real' && !forced.has(name);
  const kinds = Object.fromEntries(MODULES.map((k) => [k, real(k) ? 'real' : 'stub'])) as Kinds;
  const storeMod: StoreModule = real('store') ? storeReal : stubs;
  const ioMod: IoModule = real('io') ? ioReal : stubs;
  const mountVersions = real('home') ? homeReal.mountVersions : null;   // (the stubs have no Versions panel)
  const refsMod: RefsModule = real('refs') ? refsReal : stubs;
  ioMod.setMetaPackage?.(META_STY);

  const memory = storeKind === 'memory' || params.get('store') === 'memory';
  const store = await (storeMod.createDocStore ?? stubs.createDocStore)(memory ? { kind: 'memory' } : {});
  const ids = storeMod.ids ?? stubs.ids;
  const refs = refsMod.refs ?? stubs.refs;
  // one refs per open document: the first document's is `refs`, another pane's document gets its own
  const makeRefs = () => (refsMod.createRefs ?? stubs.createStubRefs)();
  const io = ioMod.io ?? stubs.io;

  // backends: the engine's when built, none
  const backends: Backend[] = [];
  // engine: in its single file (a release: its boot object), or with ?engine (a dev page next to its bundle
  // server); elsewhere its availability probe would only 404
  if (kinds.backend === 'real' && (isRelease() || params.has('engine'))) {
    try {
      const seed = devSeedCache(params, isRelease());
      // what the engine needs from the app, given: the store (assets before setAssets), the figures module
      // (Ipe renditions, loaded when a figure needs one), the route
      const be: Backend = await backendReal.createBackend({ cache: store.cache, store, figures: () => import('../figures/index.js').then((m) => m.figures), route, ...(seed ? { seed } : {}) });
      if (await be.available?.()) backends.push(be); else console.info(`backend ${be.id}: not available here (no engine files)`);
    } catch (e) { featureFailed('backend', e); }
  }
  let notes: NotesService | null = null;            // note chips; ?backend=lua adds its dev backend
  try { notes = installNotes({ backends, params }); } catch (e) { notes = featureFailed('notes', e); }
  backends.push(stubs.noneBackend);
  const want = params.get('backend') ?? safeGet('rtx-editor.backend');
  const backend = backends.find((b) => b.id === want) ?? backends[0];
  backend.warm?.();
  let view: ViewService | null = null;              // view options: width, text size, colours, edit layout (the page's)
  try { view = await installView({ notes }); } catch (e) { view = featureFailed('view', e); }
  // the inspector (a developer tool): imported outside a release only, so a release has none of it (its module
  // installs a setting, a view, a key listener and a style element when it is evaluated)
  let inspector: InspectorService | null = null;
  if (!isRelease()) {
    try { inspector = (await import('../inspector/index.js')).inspector; } catch (e) { inspector = featureFailed('inspector', e); }
  }

  const services: EditorServices = {
    store, ids, refs, makeRefs, backends, backend, io, notes, view, inspector, numberingState: refsMod.numberingState ?? null,
    editorContext: {
      recallsOf: refsMod.recallsOf ?? null,
      AutoSnapshots: storeMod.AutoSnapshots ?? null, beforeDestructive: storeMod.beforeDestructive ?? stubs.beforeDestructive,
      mountVersions,
      modulesReal: Object.fromEntries(MODULES.map((k) => [k, kinds[k] === 'real'])),
    },
  };
  const mountHome = homeReal.mountHome;
  return { services, kinds, modules: { storeMod, ioMod, refsMod, mountHome } };
}
