// THE DEFAULT DOCUMENTS (out of main.js, both of the standalone page's hosts seed the same way): an empty store
// gets the example and the introduction; on every later start this build's default documents are synced (io/seeds.ts:
// unedited stored copies follow the build, edited ones get a banner, deleted ones stay deleted).
//   Each is a seed file read through io.loadSeed: inline in the single file (globalThis.__rtxSeeds[name]), else
//   seed/<name>. The example: an optional extra document's seed file (seed/example.json). The introduction to
//   ReflowEd: samples/intro/'s seed file (seed/intro.json), created last so it heads the home list. A build carries
//   the ones it ships (scripts/build.ts --seeds); a seed this page has neither inline nor at seed/<name> is skipped.
//   ?seed=example|intro|sample|long picks one (sample = the tests' fixture, app/test-fixture.js; long = the tests' long
//   document, the intro repeated: app/long-fixture.ts).
//
//   await seedStore({ store, ioMod, what })
//   await resolveAlias(store, id)      #/doc/example, #/doc/intro, #/doc/sample, #/doc/long: the tagged document's id
import { testFixtureDocument } from './test-fixture.js';
import { longSeed, LONG } from './long-fixture.ts';

interface DocMeta { tags?: string[]; authors?: unknown[] }
interface StoreLike {
  listDocs(o?: object): Promise<{ id: string; tags?: string[]; meta?: DocMeta }[]>;
  getDoc(id: string): Promise<{ meta?: DocMeta }>;
  putMeta(id: string, patch: object): Promise<unknown>;
  createDoc(d: object): Promise<unknown>;
}
interface IoLike {
  loadSeed?(store: StoreLike, seed: unknown): Promise<string>;
  syncSeeds?(store: StoreLike, seeds: unknown[]): Promise<unknown>;
}
const g = globalThis as { __rtxSeeds?: Record<string, unknown> };
/** The example (samples/paper2/seed-example.ts writes build/seed/example.json, where its sources are; not in every
 *  checkout or build) */
export const EXAMPLE = Object.freeze({ seed: 'example.json', tag: 'example' });
/** The introduction to ReflowEd (samples/intro/seed-intro.ts writes build/seed/intro.json; the seed tags itself). */
export const INTRO = Object.freeze({ seed: 'intro.json', tag: 'intro' });
/** The default documents, in the order they are created (the last heads the home list). */
const DEFAULTS = [EXAMPLE, INTRO] as const;
const wanted = (what: string | null) => DEFAULTS.filter((d) => !what || what === d.tag);
const get = async (name: string) => { try { const r = await fetch(new URL(`seed/${name}`, document.baseURI)); return r.ok ? r : null; } catch { return null; } };
/** the seed's JSON. A release carries its seeds (the single file inline, the multi-file release from its manifest:
 *  globalThis.__rtxSeeds holds exactly the ones it ships), so it asks for nothing else; the dev app (no __rtxSeeds)
 *  fetches seed/<name>. null when it is not there. */
const seedText = async (name: string): Promise<unknown> => (g.__rtxSeeds ? g.__rtxSeeds[name] ?? null : (await get(name))?.text() ?? null);

export async function seedStore({ store, ioMod, what }: { store: StoreLike; ioMod: IoLike; what: string | null }): Promise<void> {
  const list = await store.listDocs();
  if (list.length) { await syncBuildSeeds(store, ioMod, what); return; }
  const tag = async (docId: string, t: string) => { const d = await store.getDoc(docId); await store.putMeta(docId, { meta: { ...d.meta, tags: [...new Set([...(d.meta?.tags ?? []), t])] } }); };
  if (what === 'sample') {
    const s = testFixtureDocument();
    await store.createDoc({ title: s.title, preamble: s.preamble, bib: s.bib, meta: s.meta, blocks: s.blocks });
  }
  if (!ioMod.loadSeed) return;
  if (what === LONG.tag) {
    try { const intro = await seedText(INTRO.seed); if (intro) await tag(await ioMod.loadSeed(store, longSeed(intro as string)), LONG.tag); }
    catch (e) { console.warn('long seed:', (e as Error).message); }
    return;
  }
  for (const d of wanted(what)) {
    try {
      const seed = await seedText(d.seed);
      if (seed) await tag(await ioMod.loadSeed(store, seed), d.tag);
    } catch (e) { console.warn(`${d.tag} seed:`, (e as Error).message); }
  }
}

async function syncBuildSeeds(store: StoreLike, ioMod: IoLike, what: string | null) {
  if (!ioMod.syncSeeds) return;
  try {
    const seeds: unknown[] = [];
    for (const d of wanted(what)) { const s = await seedText(d.seed); if (s) seeds.push(s); }
    if (seeds.length) await ioMod.syncSeeds(store, seeds);
  } catch (e) { console.warn('seed versioning:', (e as Error).message); }
}

/** the aliases of dev and tests: a tag (sample, long, example, intro) names the document carrying it */
export async function resolveAlias(store: StoreLike, id: string): Promise<string> {
  if (id !== 'sample' && id !== LONG.tag && !DEFAULTS.some((d) => d.tag === id)) return id;
  const list = await store.listDocs();
  return list.find((d) => d.tags?.includes(id) || d.meta?.tags?.includes(id))?.id ?? id;
}
