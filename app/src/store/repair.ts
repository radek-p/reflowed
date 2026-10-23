// Records as they come out of IndexedDB, made safe to use.
//
// A record can be damaged: a write cut short by a crash, a field an older
// build wrote differently, an extension or a person editing the database. One
// bad record must not hide the others (the home list) or make a document
// impossible to open. So every record read goes through these functions:
// fields with the wrong type get their default, a block keeps its text and
// its place where it can, and what was repaired is listed so the store can
// write the repaired record back (once) and say so in the console.
//
// Nothing here throws. A record that cannot be a document or a block at all
// (not an object, no string id) is left out, and listed.

import type { Block, Doc, DocFile } from './types.ts';
import { byPos, isValidKey, nKeysBetween } from './fracindex.ts';
import { SCHEMA, coreState, schemaOf } from './policy.ts';

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : d);
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);

/** what was repaired: readable lines, and the ids of the records changed ('doc:<id>', block ids) */
export interface Repairs { fixed: string[]; changed: Set<string> }
export const repairs = (): Repairs => ({ fixed: [], changed: new Set() });

/** A document record, or null when it cannot be one. `r.fixed` lists what was changed. */
export function repairDoc(raw: unknown, r: Repairs = repairs()): Doc | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) { r.fixed.push('not a document record: left out'); return null; }
  const d: any = { ...raw };
  const fix = (what: string) => { r.fixed.push(`doc ${raw.id}: ${what}`); r.changed.add(`doc:${raw.id}`); };
  const now = Date.now();
  if (typeof d.title !== 'string') { d.title = str(d.title); fix('title'); }
  // another core version: read-only here, never written back (no migrations in the PoC).
  // Newer: an older build must not write what it does not know; older: the app offers export and start anew.
  const st = coreState(d);
  if (st === 'newer') { d.readOnly = 'newer-schema'; r.fixed.push(`doc ${raw.id}: core ${d.schema} is newer than ${SCHEMA}: read-only`); }
  else if (st === 'older') { d.readOnly = 'older-core'; r.fixed.push(`doc ${raw.id}: core ${d.schema} is older than ${SCHEMA}: read-only (export and start anew)`); }
  else if (schemaOf(d) === null) { d.schema = SCHEMA; fix('schema'); }
  if (typeof d.createdAt !== 'number') { d.createdAt = num(d.updatedAt, now); fix('createdAt'); }
  if (typeof d.updatedAt !== 'number') { d.updatedAt = d.createdAt; fix('updatedAt'); }
  if (!isObj(d.meta)) { d.meta = { authors: [], tags: [] }; fix('meta'); }
  else {
    if (d.meta.authors !== undefined && !Array.isArray(d.meta.authors)) { d.meta = { ...d.meta, authors: strs(d.meta.authors) }; fix('meta.authors'); }
    if (d.meta.tags !== undefined && !Array.isArray(d.meta.tags)) { d.meta = { ...d.meta, tags: strs(d.meta.tags) }; fix('meta.tags'); }
    if (d.meta.abstract !== undefined && typeof d.meta.abstract !== 'string') { d.meta = { ...d.meta, abstract: str(d.meta.abstract) }; fix('meta.abstract'); }
  }
  if (typeof d.preamble === 'string') { d.preamble = { source: d.preamble, rev: 1 }; fix('preamble'); }
  else if (!isObj(d.preamble) || typeof d.preamble.source !== 'string') { d.preamble = { source: str(d.preamble?.source), rev: num(d.preamble?.rev, 1) }; fix('preamble'); }
  else if (typeof d.preamble.rev !== 'number') { d.preamble = { ...d.preamble, rev: 1 }; fix('preamble.rev'); }
  if (!isObj(d.bib) || !['bbl', 'bib', 'none'].includes(d.bib.kind) || typeof d.bib.source !== 'string') { d.bib = { kind: 'none', source: '' }; fix('bib'); }
  if (!isObj(d.settings) || typeof d.settings.class !== 'string') { d.settings = { ...(isObj(d.settings) ? d.settings : {}), class: str(d.settings?.class, 'article') || 'article' }; fix('settings'); }
  const files: DocFile[] = Array.isArray(d.files) ? d.files.filter((f: any) => isObj(f) && typeof f.path === 'string' && (f.role === 'main' || f.role === 'input')) : [];
  if (!files.some((f) => f.role === 'main')) files.unshift({ path: 'main.tex', role: 'main' });
  if (!Array.isArray(d.files) || files.length !== d.files.length) { d.files = files; fix('files'); }
  if (d.blockCount !== undefined && typeof d.blockCount !== 'number') { delete d.blockCount; fix('blockCount'); }
  for (const k of ['openedAt', 'deletedAt']) if (d[k] !== undefined && typeof d[k] !== 'number') { delete d[k]; fix(k); }
  return d as Doc;
}

/** One block record of `docId`, or null when it cannot be one. A bad `pos` is left for repairBlocks. */
export function repairBlock(raw: unknown, docId: string, mainPath: string, r: Repairs = repairs()): Block | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) { r.fixed.push(`doc ${docId}: a block record without an id: left out`); return null; }
  const b: any = { ...raw };
  const fix = (what: string) => { r.fixed.push(`block ${raw.id}: ${what}`); r.changed.add(raw.id); };
  if (b.docId !== docId) { b.docId = docId; fix('docId'); }
  if (typeof b.source !== 'string') { b.source = str(b.source); fix('source'); }
  if (typeof b.kind !== 'string' || !b.kind) { b.kind = 'paragraph'; fix('kind'); }
  if (typeof b.file !== 'string' || !b.file) { b.file = mainPath; fix('file'); }
  if (!isObj(b.attrs)) { b.attrs = {}; fix('attrs'); }
  if (typeof b.rev !== 'number') { b.rev = 1; fix('rev'); }
  if (typeof b.updatedAt !== 'number') { b.updatedAt = 0; fix('updatedAt'); }
  if (b.parentId != null && typeof b.parentId !== 'string') { delete b.parentId; fix('parentId'); }
  return b as Block;
}

/** A document's blocks in order: each repaired; a block whose `pos` is not a valid key gets a new
 *  one after the last good block before it in the stored order, so it keeps its place. */
export function repairBlocks(rows: unknown[], docId: string, mainPath: string, r: Repairs = repairs()): Block[] {
  const blocks = rows.map((x) => repairBlock(x, docId, mainPath, r)).filter((b): b is Block => !!b);
  const good = blocks.filter((b) => typeof b.pos === 'string' && isValidKey(b.pos)).sort(byPos);
  const bad = blocks.filter((b) => !(typeof b.pos === 'string' && isValidKey(b.pos)));
  if (!bad.length) return good;
  // the stored order (the index's key order) is kept among the bad ones; they go after the last good block
  const last = good.length ? good[good.length - 1].pos : null;
  const keys = nKeysBetween(last, null, bad.length);
  bad.forEach((b, i) => { r.fixed.push(`block ${b.id}: pos ${JSON.stringify(b.pos)} → ${keys[i]}`); r.changed.add(b.id); b.pos = keys[i]; });
  return [...good, ...bad];
}

/** An asset row (metadata, maybe bytes), or null when it has no name (it cannot be looked up). */
export function repairAssetRow(raw: unknown, r: Repairs = repairs()): any | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || typeof raw.id !== 'string') { r.fixed.push('an asset record without a name or id: left out'); return null; }
  const a: any = { ...raw };
  if (a.bytes !== undefined && !(a.bytes instanceof Uint8Array)) {
    if (a.bytes instanceof ArrayBuffer) a.bytes = new Uint8Array(a.bytes);
    else if (ArrayBuffer.isView(a.bytes)) a.bytes = new Uint8Array(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
    else { delete a.bytes; r.fixed.push(`asset ${a.name}: bytes unreadable`); }
  }
  if (typeof a.mime !== 'string') { a.mime = 'application/octet-stream'; r.fixed.push(`asset ${a.name}: mime`); }
  if (typeof a.size !== 'number') { a.size = a.bytes?.byteLength ?? 0; r.fixed.push(`asset ${a.name}: size`); }
  return a;
}
