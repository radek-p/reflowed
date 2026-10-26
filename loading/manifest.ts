// The release's index: the build's manifest (scripts/lib/multifile.ts writes it into index.html as
// <script type="application/json" id="rtx-manifest"> and beside it as manifest.json), read as a tree's index (tree.ts).
//
//   Manifest      { version, build, stamp, files: ManifestFile[] }
//   ManifestFile  { id, path, bytes, group, type, parts? }   path: relative to index.html, named by its content's hash;
//                 bytes: the file's size on disk (what a reader gets once any Content-Encoding is undone: the measure
//                 even when the server sends no Content-Length); group: 'essential' (before the UI), 'rest' (after it),
//                 'demand' (only when the app asks for it: the public inspector's files);
//                 parts: a start file's contents (type 'start': a gzip pack, loading/pack.ts, of the files every start
//                 needs, one request: the style sheets, the classic scripts, the app's modules, the default documents),
//                 each part { id, type } named in the pack by its id
//   manifestIndex(m) → TreeIndex                    by file id

import type { TreeIndex } from './tree.ts';

export type Group = 'essential' | 'rest' | 'demand';
/** css: a style sheet, put in as a <style>; script: a classic script, run inline; module: the app's entry; chunk: one of
 *  its parts (modules import each other by bare names, @rtx/<file name>, which the loader's import map resolves); seed: a
 *  default document (JSON text); start: the gzip pack of the parts above that every start needs; worker: the engine's
 *  worker script; pack: an engine pack (zstd); seedcache: the prebuilt results (gzip JSON); licences / licences-index:
 *  About's texts and index; inspector: a file of the public inspector's folder (id inspector:<its path in the folder>,
 *  the folder named by its content: its files load each other by their own names) */
export type FileType = 'css' | 'script' | 'module' | 'chunk' | 'seed' | 'start' | 'worker' | 'pack' | 'seedcache' | 'licences' | 'licences-index' | 'inspector';
export interface StartPart { id: string; type: FileType }
export interface ManifestFile { id: string; path: string; bytes: number; group: Group; type: FileType; parts?: StartPart[] }
/** the bare name the app's modules import a part by (the loader's import map resolves it): @rtx/<file name> */
export const moduleName = (id: string) => `@rtx/${id.replace(/^app:/, '')}`;
export interface Manifest { version: string; build: string; stamp: string; files: ManifestFile[] }

export function manifestIndex(m: Manifest): TreeIndex {
  const by = new Map(m.files.map((f) => [f.id, f]));
  return { path: (n) => by.get(n)?.path ?? null, size: (n) => by.get(n)?.bytes ?? null, group: (n) => by.get(n)?.group ?? 'rest', count: by.size };
}
