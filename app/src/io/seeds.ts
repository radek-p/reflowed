// Seed versioning: the default documents a build carries (io/seed.ts files)
// follow the build instead of the first copy winning forever.
//
//   await syncSeeds(store, [seedJson, …])      on every start (main.js), instead of "load when the store is empty"
//
// Per seed (by its fixed doc id):
//   - never seen in this browser → created (as loadSeed did);
//   - stored copy provably unedited since it was loaded (its content hash
//     equals the one recorded at load) and the seed changed → replaced
//     silently (same doc id; a "Before updating the example" auto snapshot first);
//   - any other copy of a changed seed (edited, or from before versioning, when
//     nothing was recorded: treated as older) → kept; the Documents view marks
//     it "Updated sample available" (home/sample-update.js) and the document
//     shows a banner (seed-banner.ts). An unedited copy is offered
//     Replace; an edited one "Open the new version" (openNewVersion: the new
//     version becomes the sample, the copy stays as "… (edited)"); Keep mine
//     (not asked again for this seedVersion);
//   - only the engine build changed (same content) → the recorded version is
//     brought up to date silently, nothing to ask;
//   - deleted by the user → not recreated (the registry remembers it).
// resetToSeed() is "Reset to original" (menu, home card): snapshot, then the
// build's version of the seed.
//
// What a stored seeded doc records, in doc.meta.seed:
//   { id, seedVersion, seedHash, contentHash, loadedAt, builtAt?, keep? }
// The registry (seeds this browser has seen, so deleted ones stay deleted) is
// the cache record `rtx:seeds` (cache.clear keeps `rtx:` keys). Its entry's
// docId: the document that is the sample now (after "Open the new version" no
// longer the seed's fixed id).

import type { AssetMeta, Block, DocStore, OpenDoc } from '../store/types.ts';
import type { SeedFile } from './seed.ts';
import { fromBase64 } from './seed.ts';
import { sha256Hex } from '../store/core.ts';
import { beforeDestructive, replaceContent } from '../store/snapshots.ts';
import { nKeysBetween } from '../store/fracindex.ts';
import { fingerprint } from './markers.ts';
import { freshIds } from './import.ts';
import { withoutDerived } from '../store/policy.ts';
import { ulid } from '../store/ulid.ts';

export interface SeedMeta { id: string; seedVersion: string; seedHash: string; contentHash: string; loadedAt: number; builtAt?: string; keep?: string }
export type SyncAction = 'created' | 'current' | 'updated' | 'rebuilt' | 'pending' | 'kept' | 'deleted';
export interface SyncResult { id: string; title: string; action: SyncAction; seedVersion: string; docId: string }
/** What the Documents view offers for a sample whose build has a newer version. */
export interface SampleUpdate { docId: string; seedId: string; title: string; seedVersion: string; builtAt?: string; edited: boolean }
type Registry = Record<string, { seedVersion: string; at: number; docId?: string }>;

const REGISTRY = 'rtx:seeds';
const enc = new TextEncoder();
const known = new Map<string, SeedFile>();          // this build's seeds by seed id (for the banner and reset)
const sampleDoc = new Map<string, string>();        // doc id → seed id: the documents that are this build's samples now

/** The seed's content hash: its JSON without the version fields. */
export async function seedHashOf(s: SeedFile): Promise<string> {
  const { seedHash: _h, seedVersion: _v, build: _b, builtAt: _t, ...rest } = s as any;
  return (await sha256Hex(enc.encode(JSON.stringify(rest)))).slice(0, 16);
}

/** seedVersion: from the build (content + engine build id) when it set one, else the content hash. */
async function versionOf(s: SeedFile): Promise<{ seedVersion: string; seedHash: string; builtAt?: string }> {
  const seedHash = (s as any).seedHash ?? await seedHashOf(s);
  return { seedVersion: (s as any).seedVersion ?? seedHash, seedHash, builtAt: (s as any).build?.date ?? (s as any).builtAt };
}

/** What counts as the user's content: preamble, bib, blocks in order, figure edits. Not titles' metadata, tags, openedAt.
 *  Core only: a block's derived attrs (store/policy.ts DERIVED_ATTRS) are disposable and left out, so dropping
 * */
export async function contentHash(d: OpenDoc, opts: { legacy?: boolean } = {}): Promise<string> {
  const blocks = d.blocks.map((b) => [b.kind, b.file, b.source, (opts.legacy ? null : withoutDerived(b.attrs)) ?? b.attrs ?? {}, (b as any).parentId ?? null]);
  const assets = [...d.assets].sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((a: AssetMeta) => [a.name, a.hash, a.rendition?.hash ?? null, a.model?.xml ? fingerprint(a.model.xml) : null]);
  return (await sha256Hex(enc.encode(JSON.stringify([d.title, d.preamble.source, d.bib?.source ?? '', blocks, assets])))).slice(0, 16);
}

async function registry(store: DocStore): Promise<Registry> {
  const r = await store.cache.get(REGISTRY).catch(() => null);
  return r && typeof r === 'object' ? r as any : {};
}
async function remember(store: DocStore, id: string, seedVersion: string, docId?: string) {
  const r = await registry(store);
  const at = docId ?? r[id]?.docId;
  r[id] = { seedVersion, at: Date.now(), ...(at && at !== id ? { docId: at } : {}) };
  await store.cache.put(REGISTRY, r);
}
/** The document that is the seed's sample in this browser: its fixed id, or the one "Open the new version" made. */
const target = (reg: Registry, seedId: string) => reg[seedId]?.docId ?? seedId;

const parse = (s: SeedFile | string): SeedFile => {
  const x: SeedFile = typeof s === 'string' ? JSON.parse(s) : s;
  if (x.format !== 'rtx-seed') throw new Error('not a seed file');
  return x;
};

function seedAssets(s: SeedFile) {
  return (s.init.assets ?? []).map(({ base64, ...a }) => ({ ...a, bytes: fromBase64(base64) }));
}

async function stamp(store: DocStore, id: string, s: SeedFile, v: { seedVersion: string; seedHash: string; builtAt?: string }, keep?: string) {
  const d = (await store.getDoc(id))!;
  const seed: SeedMeta = { id: s.id, seedVersion: v.seedVersion, seedHash: v.seedHash, contentHash: await contentHash(d), loadedAt: Date.now(),
    ...(v.builtAt ? { builtAt: v.builtAt } : {}), ...(keep ? { keep } : {}) };
  await store.putMeta(id, { meta: { ...d.meta, seed } as any });
}

/** Make the stored doc the seed's content (same doc id; tags and openedAt kept). */
async function applySeed(store: DocStore, docId: string, s: SeedFile) {
  const cur = (await store.getDoc(docId))!;
  const { assets: _a, blocks: seedBlocks = [], preamble, snapshotLabel: _l, ...fields } = s.init as any;
  // the seed's fixed block ids belong to the seed's fixed doc id; a sample that is another document now (after
  // "Open the new version", whose "(edited)" copy keeps those ids) gets new ones (parents mapped)
  const sb: any[] = docId === s.id ? seedBlocks : (freshIds({ ...(s.init as any) }) as any).blocks ?? [];
  const keys = nKeysBetween(null, null, sb.length);
  const now = Date.now();
  const main = (fields.files ?? cur.files).find((f: any) => f.role === 'main')?.path ?? 'main.tex';
  const blocks: Block[] = sb.map((b: any, i: number) => ({ ...b, id: b.id ?? ulid(), docId, pos: keys[i], kind: b.kind ?? 'paragraph', file: b.file ?? main, attrs: b.attrs ?? {}, rev: 1, updatedAt: now }));
  const tags = [...new Set([...(fields.meta?.tags ?? []), ...(cur.meta?.tags ?? [])])];
  await replaceContent(store, docId, {
    title: fields.title ?? cur.title, preamble: { source: typeof preamble === 'string' ? preamble : preamble?.source ?? '', rev: cur.preamble.rev },
    bib: fields.bib ?? { kind: 'none', source: '' }, settings: { ...cur.settings, ...(fields.settings ?? {}) }, files: fields.files ?? cur.files,
    meta: { ...(fields.meta ?? {}), tags },
  }, blocks);
  // assets by name; the seed's figure edits (rendition/model) come with them, others are cleared by new bytes
  const names = new Map(cur.assets.map((a) => [a.name, a]));
  for (const a of seedAssets(s)) {
    const { bytes, ...m } = a as any;
    const old = names.get(m.name);
    await store.putAsset(docId, { ...m, ...(old ? { id: old.id } : {}), model: m.model, rendition: m.rendition }, bytes);
  }
}

/** 'unedited': the content hash recorded at load still matches (proof); 'no-edits': nothing was recorded (a copy
 *  from before versioning) and the op log shows no edit; 'edited': otherwise. */
async function editState(store: DocStore, d: OpenDoc): Promise<'unedited' | 'no-edits' | 'edited'> {
  const seed = (d.meta as any)?.seed as SeedMeta | undefined;
  if (seed?.contentHash) return (await contentHash(d)) === seed.contentHash || (await contentHash(d, { legacy: true })) === seed.contentHash ? 'unedited' : 'edited';
  // a copy from before versioning. The op log is disposable: once it was dropped (store/policy.ts stamps
  // droppedAt), no ops proves nothing: kept as edited.
  if ((await store.cache.get('rtx:policy'))?.droppedAt) return 'edited';
  const ops = await store.getOps(d.id);
  return ops.some((o) => o.t === 'insert' || o.t === 'delete' || o.t === 'move' || o.t === 'edit' || (o.t === 'meta' && o.payload && Object.keys(o.payload as object).some((k) => k !== 'create'))) ? 'edited' : 'no-edits';
}

/** On start: bring every default document to this build's version (see the header). */
export async function syncSeeds(store: DocStore, seeds: Array<SeedFile | string>): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  const reg = await registry(store);
  for (const raw of seeds) {
    const s = parse(raw);
    known.set(s.id, s);
    const v = await versionOf(s);
    const id = target(reg, s.id);
    const d = await store.getDoc(id);
    const res = (action: SyncAction) => { out.push({ id: s.id, docId: id, title: s.init.title ?? '', action, seedVersion: v.seedVersion }); };
    if (!d) {
      if (reg[s.id]) { res('deleted'); continue; }            // the user deleted it: stays deleted
      const { assets: _a, ...rest } = s.init;
      await store.createDoc({ ...rest, id: s.id, assets: seedAssets(s) as any, snapshotLabel: rest.snapshotLabel ?? 'Seed' });
      await stamp(store, s.id, s, v);
      await remember(store, s.id, v.seedVersion);
      sampleDoc.set(s.id, s.id);
      res('created');
      continue;
    }
    sampleDoc.set(id, s.id);
    const seed = (d.meta as any)?.seed as SeedMeta | undefined;
    if (!reg[s.id]) await remember(store, s.id, v.seedVersion);
    if (seed?.seedVersion === v.seedVersion) { res('current'); continue; }
    if (seed && seed.seedHash === v.seedHash) {                 // only the engine build changed: nothing to ask
      await store.putMeta(id, { meta: { ...d.meta, seed: { ...seed, seedVersion: v.seedVersion, ...(v.builtAt ? { builtAt: v.builtAt } : {}) } } as any });
      res('rebuilt');
      continue;
    }
    if ((await editState(store, d)) === 'unedited') {
      await beforeDestructive(store, id, 'updating to the new version of this example');
      await applySeed(store, id, s);
      await stamp(store, id, s, v);
      await remember(store, s.id, v.seedVersion);
      res('updated');
      continue;
    }
    res(seed?.keep === v.seedVersion ? 'kept' : 'pending');
  }
  return out;
}

const seedOf = (docId: string) => { const id = sampleDoc.get(docId); return id ? known.get(id) ?? null : null; };

/** The Documents view's "Updated sample available" for this document, or null (not a sample, current,
 *  or "Keep mine" said for this version). edited: the copy has (or may have) edits, so it is never replaced
 *  silently; only "Open the new version" is offered for it. */
export async function sampleUpdate(store: DocStore, docId: string): Promise<SampleUpdate | null> {
  const s = seedOf(docId);
  if (!s) return null;
  const rec = await store.getDocRecord(docId);
  if (!rec || rec.deletedAt) return null;
  const seed = (rec.meta as any)?.seed as SeedMeta | undefined;
  const v = await versionOf(s);
  if (seed?.seedVersion === v.seedVersion || seed?.seedHash === v.seedHash || seed?.keep === v.seedVersion) return null;
  const d = await store.getDoc(docId);
  if (!d) return null;
  return { docId, seedId: s.id, title: s.init.title ?? '', seedVersion: v.seedVersion, builtAt: v.builtAt, edited: (await editState(store, d)) === 'edited' };
}

/** The banner's question for this document, or null (not seeded, current, or "Keep mine" said for this version). */
export async function seedUpdate(store: DocStore, docId: string): Promise<{ title: string; seedVersion: string; builtAt?: string; edited: boolean } | null> {
  const u = await sampleUpdate(store, docId);
  return u && { title: u.title, seedVersion: u.seedVersion, builtAt: u.builtAt, edited: u.edited };
}

/** Is this one of the build's default documents (for "Reset to original")? */
export const isSeedDoc = (docId: string) => !!seedOf(docId);

/** "Reset to original" / "Reset to new version" / Replace: a snapshot of the user's copy, then this build's seed. Returns the snapshot id. */
export async function resetToSeed(store: DocStore, docId: string): Promise<string> {
  const s = seedOf(docId);
  if (!s) throw new Error('not a default document of this build');
  const safety = await beforeDestructive(store, docId, 'resetting to the original');
  await applySeed(store, docId, s);
  await stamp(store, docId, s, await versionOf(s));
  await remember(store, s.id, (await versionOf(s)).seedVersion);
  return safety.id;
}

const EDITED = ' (edited)';
/** The app's own tag that names the sample (app/seeds.ts: #/doc/intro): it goes with the sample. */
const SAMPLE_TAGS = new Set(['intro']);

/** "Open the new version": this build's version of the sample as a new document (new ids), which is the
 *  sample from now on (later builds update it, it carries the sample's tags); the user's copy stays as it is,
 *  only renamed "… (edited)" and no longer a sample (an ordinary document). Returns the new document's id. */
export async function openNewVersion(store: DocStore, docId: string): Promise<string> {
  const s = seedOf(docId);
  if (!s) throw new Error('not a default document of this build');
  const v = await versionOf(s);
  const old = (await store.getDocRecord(docId))!;
  const oldTags: string[] = (old.meta as any)?.tags ?? [];
  const { assets: _a, ...rest } = freshIds({ ...(s.init as any) }) as any;
  const id = await store.createDoc({
    ...rest, meta: { ...(rest.meta ?? {}), tags: [...new Set([...(rest.meta?.tags ?? []), ...oldTags.filter((t) => SAMPLE_TAGS.has(t))])] },
    assets: seedAssets(s) as any, snapshotLabel: `New version of “${s.init.title}”`,
  });
  await stamp(store, id, s, v);
  await remember(store, s.id, v.seedVersion, id);
  sampleDoc.delete(docId);
  sampleDoc.set(id, s.id);
  const title = old.title.endsWith(EDITED) ? old.title : `${old.title || 'Untitled'}${EDITED}`;
  const { seed: was, ...meta } = (old.meta ?? {}) as any;
  await store.putMeta(docId, { title, meta: { ...meta, seed: undefined, tags: oldTags.filter((t) => !SAMPLE_TAGS.has(t)), sampleOf: { id: s.id, seedVersion: was?.seedVersion ?? null, until: Date.now() } } as any });
  return id;
}

/** "Keep mine": the user's copy is not asked about this version again. */
export async function keepMine(store: DocStore, docId: string): Promise<void> {
  const s = seedOf(docId);
  if (!s) throw new Error('not a default document of this build');
  const v = await versionOf(s);
  const d = (await store.getDocRecord(docId))!;
  const seed = ((d.meta as any)?.seed ?? {}) as SeedMeta;
  await store.putMeta(docId, { meta: { ...d.meta, seed: { ...seed, keep: v.seedVersion } } as any });
}

/** The banner's answers: reset (Replace), alongside (Open the new version), keep (Keep mine). */
export async function resolveSeedUpdate(store: DocStore, docId: string, choice: 'reset' | 'alongside' | 'keep'): Promise<{ docId: string; snapshot?: string }> {
  if (choice === 'reset') return { docId, snapshot: await resetToSeed(store, docId) };
  if (choice === 'alongside') return { docId: await openNewVersion(store, docId) };
  await keepMine(store, docId);
  return { docId };
}
