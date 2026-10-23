// Import: a .tex, a .zip, an arXiv .tar.gz / e-print, a .tar, or several
// loose files → a new document.
//
//   const { init, report } = await importFiles(entries)      // no store involved
//   const { docId, report } = await importIntoStore(store, name, bytes)
//
// The main file is found (00README.json, else \documentclass + \begin{document},
// preferring main/ms/paper), its preamble becomes doc.preamble, its body and
// every \input/\include'd file (recursively, alone on a line) become blocks,
// each keeping its origin `file`. Every other file is an asset (images, PDFs
// (Ipe ones flagged), .sty/.cls, unused .tex …); the main .bbl (or else a
// .bib) becomes doc.bib. Files are rebuilt byte for byte by export.ts.

import type { DocFile, DocInit, DocStore } from '../store/types.ts';
import { type Entry, unpack } from './archive.ts';
import { codeOf, envsFromPreamble, splitBody, type Item } from './split.ts';
import { abstractOf, authorsOf, bblEntries, bibEntries, docClass, titleOf } from './meta.ts';
import { isMarked, parseMarked } from './markers.ts';
import { ulid } from '../store/ulid.ts';
import { nKeysBetween } from '../store/fracindex.ts';
import { beforeDestructive, replaceContent } from '../store/snapshots.ts';
import { nestImported, reassignIds, remapParents } from '../nesting/model.ts';
import { nestOnImport } from '../nesting/settings.ts';
import { metaPackage, PACKAGE_FILE } from '../meta/package.ts';
import { restoreSvgFigures } from '../svgfig/io.js';        // an exported SVG figure back as one

export interface ImportReport {
  main: string;
  files: Array<{ path: string; blocks: number }>;
  blocks: number;
  assets: Array<{ name: string; mime: string; bytes: number; ipe?: boolean }>;
  bib: { kind: string; path?: string; entries: number };
  warnings: string[];
  /** the file carried the editor's block markers (markers.ts): how the blocks came back */
  marked?: { kept: number; edited: number; added: number };
  /** proofs and theorem-likes split into a container and its paragraphs */
  nested?: number;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  pdf: 'application/pdf', eps: 'application/postscript', ps: 'application/postscript',
  tex: 'text/x-tex', sty: 'text/x-tex', cls: 'text/x-tex', clo: 'text/x-tex', def: 'text/x-tex', cfg: 'text/x-tex', ltx: 'text/x-tex',
  bib: 'text/x-bibtex', bbl: 'text/x-tex', bst: 'text/plain', txt: 'text/plain', json: 'application/json', ipe: 'application/xml', xml: 'application/xml',
  tikz: 'text/x-tex', pgf: 'text/x-tex', csv: 'text/csv', dat: 'text/plain',
};
export const mimeOf = (name: string) => MIME[(/\.([^./]+)$/.exec(name)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream';

/** UTF-8 when valid, else Latin-1; CRLF → LF (and say so). */
export function decodeText(data: Uint8Array): { text: string; encoding: 'utf8' | 'latin1'; eol: 'lf' | 'crlf' } {
  let text: string, encoding: 'utf8' | 'latin1' = 'utf8';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch {
    encoding = 'latin1';
    text = ''; for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
  }
  const crlf = text.includes('\r\n');
  return { text: crlf ? text.replace(/\r\n/g, '\n') : text, encoding, eol: crlf ? 'crlf' : 'lf' };
}

const IPE_MARK = [/\/Type\s*\/Ipe\b/];
/** A PDF carrying an Ipe document (Ipe writes an object /Type /Ipe holding its XML). */
export function isIpePdf(data: Uint8Array): boolean {
  // the marker is in an uncompressed object dictionary; scan as Latin-1
  let s = '';
  for (let i = 0; i < data.length; i += 65536) s += String.fromCharCode(...data.subarray(i, i + 65536));
  return IPE_MARK.some((re) => re.test(s));
}

function normalise(entries: Entry[], warnings: string[] = []): Entry[] {
  // '.' and '..' resolved; a path that climbs out of the project (../x, zip-slip) is left
  // out: stored as an asset it would be written back out of the folder by the next export
  const clean = (p: string): string | null => {
    const out: string[] = [];
    for (const seg of p.replace(/\\/g, '/').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (!out.length) return null; out.pop(); continue; }
      out.push(seg);
    }
    return out.join('/') + (/\/$/.test(p) ? '/' : '');
  };
  let es = entries
    .map((e) => { const path = clean(e.path); if (path === null) warnings.push(`${e.path}: outside the project folder; left out`); return { ...e, path: path ?? '' }; })
    .filter((e) => e.path && !e.path.endsWith('/') && !/(^|\/)(__MACOSX|\.git)\//.test(e.path) && !/(^|\/)\.DS_Store$/.test(e.path));
  // one folder around everything (GitHub/Overleaf zips): drop it
  for (;;) {
    const first = es[0]?.path.split('/')[0];
    if (es.length && es.every((e) => e.path.includes('/') && e.path.split('/')[0] === first)) es = es.map((e) => ({ ...e, path: e.path.slice(first.length + 1) }));
    else break;
  }
  return es;
}

function findMain(texts: Map<string, string>, entries: Entry[]): string | null {
  const readme = entries.find((e) => e.path === '00README.json' || e.path === '00README.XXX');
  if (readme && readme.path.endsWith('.json')) {
    try {
      const j = JSON.parse(new TextDecoder().decode(readme.data));
      const top = (j.sources ?? []).find((s: any) => s.usage === 'toplevel')?.filename;
      if (top && texts.has(top)) return top;
    } catch { /* ignore */ }
  }
  const cands = [...texts.entries()].filter(([, t]) => /^[ \t]*\\documentclass/m.test(stripAll(t)) && /\\begin\s*\{document\}/.test(stripAll(t)));
  if (!cands.length) {
    const tex = [...texts.keys()];
    return tex.length ? tex.sort((a, b) => a.split('/').length - b.split('/').length)[0] : null;
  }
  const score = ([p, t]: [string, string]) => (/(^|\/)(main|ms|paper|article|root)\.tex$/i.test(p) ? 100 : 0)
    - p.split('/').length * 10 + (stripAll(t).match(/\\(input|include)\b/g)?.length ?? 0);
  return cands.sort((a, b) => score(b) - score(a))[0][0];
}
/** Comments blanked out with spaces: same length, so offsets hold. */
const stripAll = (t: string) => t.split('\n').map((l) => { const c = codeOf(l); return c + ' '.repeat(l.length - c.length); }).join('\n');

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/** The file a \input{target} names (TeX looks relative to the main file's directory). */
function resolve(target: string, base: string, have: (p: string) => boolean): string | null {
  const t = target.replace(/^"|"$/g, '').trim();
  const norm = (p: string) => { const out: string[] = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };
  for (const c of [t, `${t}.tex`]) { const p = norm(base + c); if (have(p)) return p; }
  return null;
}

/** `nest`: multi-paragraph proofs and theorem-likes become container blocks with one block per
 *  paragraph (default: the setting, on). */
export async function importFiles(input: Entry[], opts: { name?: string; nest?: boolean } = {}): Promise<{ init: DocInit; report: ImportReport }> {
  const warnings: string[] = [];
  const svgFigs = restoreSvgFigures(normalise(input, warnings));   // exported SVG figures back as SVG
  const entries: Entry[] = svgFigs.entries;
  const texts = new Map<string, string>();
  const decoded = new Map<string, ReturnType<typeof decodeText>>();
  for (const e of entries) if (/\.(tex|ltx)$/i.test(e.path)) { const d = decodeText(e.data); decoded.set(e.path, d); texts.set(e.path, d.text); }
  const mainPath = findMain(texts, entries);
  if (!mainPath) throw new Error('no .tex file found');
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const used = new Set<string>([mainPath]);
  if (isMarked(texts.get(mainPath)!)) return markedImport(texts.get(mainPath)!, mainPath, entries, opts);

  const mainText = texts.get(mainPath)!;
  const beginM = /\\begin\s*\{document\}/.exec(stripAll(mainText));
  let preamble = '', head = '', body = mainText, endTail = '';
  const files: DocFile[] = [];
  const mainFile: DocFile = { path: mainPath, role: 'main' };
  files.push(mainFile);
  if (beginM) {
    preamble = mainText.slice(0, beginM.index);
    head = mainText.slice(beginM.index, beginM.index + beginM[0].length);
    const rest = mainText.slice(beginM.index + beginM[0].length);
    const endM = /\\end\s*\{document\}/.exec(stripAll(rest));
    body = endM ? rest.slice(0, endM.index) : rest;
    endTail = endM ? rest.slice(endM.index) : '';
    mainFile.head = head;
  } else {
    // a fragment: a body without preamble; export adds \documentclass{article} + \begin{document}
    warnings.push(`${mainPath} has no \\begin{document}: imported as the body of an article`);
    preamble = '\\documentclass{article}\n';
    mainFile.head = '\\begin{document}\n';
    endTail = '\\end{document}\n';
  }
  const md = decoded.get(mainPath)!;
  if (md.encoding !== 'utf8') mainFile.encoding = md.encoding;
  if (md.eol !== 'lf') mainFile.eol = md.eol;
  const splitOpts = envsFromPreamble(preamble);

  const blocks: NonNullable<DocInit['blocks']> = [];
  const perFile = new Map<string, number>();
  const walk = (text: string, file: string, depth: number): string => {
    const { items, tail } = splitBody(text, splitOpts);
    for (const it of items) {
      if (it.type === 'block') { blocks.push({ kind: it.kind, source: it.source, file, attrs: { ...it.attrs, before: it.before } }); perFile.set(file, (perFile.get(file) ?? 0) + 1); continue; }
      const target = resolve(it.target, dirOf(mainPath), (p) => texts.has(p));
      if (!target || used.has(target) || depth > 20) {
        if (!target) warnings.push(`${file}: ${it.cmd}: file not found; kept as text`);
        else warnings.push(`${file}: ${it.cmd}: ${target} is input a second time; kept as text`);
        blocks.push({ kind: 'input', source: it.cmd, file, attrs: { before: it.before } });
        perFile.set(file, (perFile.get(file) ?? 0) + 1);
        continue;
      }
      used.add(target);
      const d = decoded.get(target)!;
      const f: DocFile = { path: target, role: 'input', parent: file, cmd: it.cmd, before: it.before };
      if (d.encoding !== 'utf8') f.encoding = d.encoding;
      if (d.eol !== 'lf') f.eol = d.eol;
      files.push(f);
      f.tail = walk(d.text, target, depth + 1);
    }
    return tail;
  };
  mainFile.tail = walk(body, mainPath, 0) + endTail;
  // \thmMW* alone: a restatable's copy; it takes the original's kind
  const restatables = new Map<string, string>();
  for (const b of blocks) if (typeof b.attrs?.restatable === 'string') restatables.set(b.attrs.restatable, b.kind ?? 'paragraph');
  for (const b of blocks) {
    const m = /^\\([A-Za-z]+)\*\s*$/.exec(stripAll(b.source).trim());
    if (m && restatables.has(m[1])) { b.kind = restatables.get(m[1])!; b.attrs = { ...b.attrs, restates: m[1] }; }
  }

  // bibliography: <main>.bbl, else the only .bbl, else a .bib the preamble names
  const stem = mainPath.replace(/\.[^.]+$/, '');
  const bbls = entries.filter((e) => /\.bbl$/i.test(e.path));
  const bbl = byPath.get(`${stem}.bbl`) ?? (bbls.length === 1 ? bbls[0] : undefined);
  let bib: DocInit['bib'] = { kind: 'none', source: '' };
  if (bbl) {
    const src = decodeText(bbl.data).text;
    bib = { kind: 'bbl', source: src, path: bbl.path, entries: bblEntries(src) };
    used.add(bbl.path);
  } else {
    const names = [...stripAll(preamble + body).matchAll(/\\(?:addbibresource|bibliography)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const bibE = names.map((n) => byPath.get(n.endsWith('.bib') ? n : `${n}.bib`)).find(Boolean) ?? entries.find((e) => /\.bib$/i.test(e.path));
    if (bibE) {
      const src = decodeText(bibE.data).text;
      bib = { kind: 'bib', source: src, path: bibE.path, entries: bibEntries(src) };
      used.add(bibE.path);
    }
  }

  const assets: Array<{ name: string; mime: string; bytes: Uint8Array; ipe?: boolean }> = [];
  for (const e of entries) {
    if (used.has(e.path) || ownPackage(e)) continue;
    const a: { name: string; mime: string; bytes: Uint8Array; ipe?: boolean } = { name: e.path, mime: mimeOf(e.path), bytes: e.data };
    if (a.mime === 'application/pdf' && isIpePdf(e.data)) a.ipe = true;
    const fr = svgFigs.renditions.get(e.path);
    if (fr) Object.assign(a, { mime: 'image/svg+xml', rendition: fr });
    assets.push(a);
  }

  const abstractBlock = blocks.find((b) => b.kind === 'abstract');
  const abstract = abstractBlock ? abstractOf(abstractBlock.source) : abstractOf(preamble);
  // long proofs, theorems and the abstract: a container and one block per paragraph
  let nested = 0;
  if (opts.nest ?? nestOnImport()) {
    const out = nestImported(blocks, splitOpts, () => ulid());
    nested = out.filter((b: any) => b.attrs?.container).length;
    blocks.splice(0, blocks.length, ...out);
  }
  const cls = docClass(preamble);
  const arxivId = /(\d{4}\.\d{4,5})(v\d+)?/.exec(opts.name ?? '')?.[1];
  const init: DocInit = {
    title: titleOf(preamble) || (opts.name ?? mainPath).split('/').pop()!.replace(/\.(tex|zip|tar\.gz|tgz|tar|gz|src)$/i, ''),
    meta: { authors: authorsOf(preamble), tags: [], abstract, importedFrom: opts.name ?? mainPath, ...(arxivId ? { arxivId } : {}) },
    preamble,
    bib,
    settings: cls,
    files,
    blocks,
    assets,
    snapshotLabel: `Imported ${(opts.name ?? mainPath).split('/').pop()}`,
  };
  const report: ImportReport = {
    main: mainPath,
    files: files.map((f) => ({ path: f.path, blocks: perFile.get(f.path) ?? 0 })),
    blocks: blocks.length,
    assets: assets.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes.length, ...(a.ipe ? { ipe: true } : {}) })),
    bib: { kind: bib.kind, path: bib.path, entries: bib.entries?.length ?? 0 },
    warnings,
    ...(nested ? { nested } : {}),
  };
  return { init, report };
}

/** the title package an export ships beside the main file, byte for byte the editor's own: not an asset (the
 *  engine carries it, and a re-export ships it again); an edited copy stays the document's */
function ownPackage(e: Entry): boolean {
  const own = metaPackage();
  return e.path === PACKAGE_FILE && !!own && decodeText(e.data).text === own;
}

/** The fast path: a one-file export with the editor's markers. */
function markedImport(text: string, mainPath: string, entries: Entry[], opts: { name?: string }): { init: DocInit; report: ImportReport } {
  const r = parseMarked(text, () => ulid());
  const init = r.init;
  const assets: Array<{ name: string; mime: string; bytes: Uint8Array; ipe?: boolean }> = [];
  for (const e of entries) {
    if (e.path === mainPath || ownPackage(e)) continue;
    const a: { name: string; mime: string; bytes: Uint8Array; ipe?: boolean } = { name: e.path, mime: mimeOf(e.path), bytes: e.data };
    if (a.mime === 'application/pdf' && isIpePdf(e.data)) a.ipe = true;
    assets.push(a);
  }
  init.assets = assets;
  if (init.bib?.kind === 'bbl') init.bib.entries = bblEntries(init.bib.source);
  else if (init.bib?.kind === 'bib') init.bib.entries = bibEntries(init.bib.source);
  init.snapshotLabel = `Imported ${(opts.name ?? mainPath).split('/').pop()}`;
  const perFile = new Map<string, number>();
  for (const b of init.blocks ?? []) perFile.set(b.file ?? mainPath, (perFile.get(b.file ?? mainPath) ?? 0) + 1);
  const report: ImportReport = {
    main: mainPath, files: [...perFile].map(([path, blocks]) => ({ path, blocks })), blocks: init.blocks?.length ?? 0,
    assets: assets.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes.length, ...(a.ipe ? { ipe: true } : {}) })),
    bib: { kind: init.bib?.kind ?? 'none', path: init.bib?.path, entries: init.bib?.entries?.length ?? 0 },
    warnings: r.warnings, marked: { kept: r.blocksKept, edited: r.blocksEdited, added: r.blocksNew },
  };
  return { init, report };
}

/** The same content under new ids (a new document next to the one it came from). */
export function freshIds(init: DocInit): DocInit {
  const { id: _id, ...rest } = init as DocInit & { id?: string };
  // a paragraph names its container by id: new ids now, with the parents mapped
  const blocks = rest.blocks ?? [];
  if (blocks.some((b: any) => b.parentId)) return { ...rest, blocks: reassignIds(blocks as any[], () => ulid()) };
  return { ...rest, blocks: blocks.map(({ id: _b, ...b }: any) => b) };
}

/** createDoc for an import: a marked file whose document still exists gets new ids. */
export async function createFromImport(store: DocStore, init: DocInit): Promise<string> {
  const id = (init as DocInit & { id?: string }).id;
  const taken = id ? !!(await store.getDocRecord(id)) : false;
  return store.createDoc(taken ? freshIds(init) : init);
}

/** One upload (any supported format) → DocInit + report. */
export async function importUpload(name: string, data: Uint8Array | Entry[]): Promise<{ init: DocInit; report: ImportReport }> {
  const entries = Array.isArray(data) ? data : await unpack(name, data);
  return importFiles(entries, { name });
}

/** One upload into the store (createDoc takes the "Imported …" auto snapshot). */
export async function importIntoStore(store: DocStore, name: string, data: Uint8Array | Entry[]): Promise<{ docId: string; report: ImportReport }> {
  const { init, report } = await importUpload(name, data);
  const docId = await createFromImport(store, init);
  return { docId, report };
}

export type { Item };

/** Import into an existing document: its blocks (and preamble, bib, files,
 *  settings, meta, title) become the file's, the doc id stays. An automatic
 *  snapshot "Before importing …" is taken first. Block ids from the file are
 *  kept when the file is this document's export (or the id is one of its
 *  blocks), new otherwise. Assets in the upload are added or replace ones of the same name. */
export async function importIntoDocument(store: DocStore, docId: string, name: string, data: Uint8Array | Entry[] | { init: DocInit; report: ImportReport }): Promise<{ docId: string; report: ImportReport; safety: string }> {
  const { init, report } = data instanceof Uint8Array || Array.isArray(data) ? await importUpload(name, data) : data;
  const cur = await store.getDoc(docId);
  if (!cur) throw new Error(`no document ${docId}`);
  const safety = await beforeDestructive(store, docId, `importing ${name.split('/').pop()}`);
  const mine = new Set(cur.blocks.map((b) => b.id));
  const fromHere = (init as DocInit & { id?: string }).id === docId;
  const list = init.blocks ?? [];
  const keys = nKeysBetween(null, null, list.length);
  const now = Date.now();
  const mainPath = init.files?.find((f) => f.role === 'main')?.path ?? 'main.tex';
  const idMap = new Map<string, string>();                         // old id → new, for parentIds
  const blocks = remapParents(list.map((b: any, i) => {
    // this document's own export: every id is its own; another doc's file: only ids this doc has
    const id = b.id && (fromHere || mine.has(b.id)) ? b.id : ulid();
    if (b.id) idMap.set(b.id, id);
    return { id, docId, pos: keys[i], kind: b.kind ?? 'paragraph', source: b.source,
      file: b.file ?? mainPath, attrs: b.attrs ?? {}, rev: 1, updatedAt: now, ...(b.parentId ? { parentId: b.parentId } : {}) };
  }), idMap);
  const preamble = typeof init.preamble === 'string' ? init.preamble : (init.preamble as any)?.source ?? '';
  await replaceContent(store, docId, {
    title: init.title || cur.title, preamble: { source: preamble, rev: cur.preamble.rev }, bib: init.bib ?? { kind: 'none', source: '' },
    settings: { ...cur.settings, ...(init.settings ?? {}) } as any, files: init.files ?? cur.files, meta: { ...cur.meta, ...(init.meta ?? {}) },
  }, blocks);
  for (const a of (init.assets ?? []) as Array<{ name: string; mime: string; bytes: Uint8Array; ipe?: boolean }>) {
    const { bytes, ...meta } = a;
    await store.putAsset(docId, meta, bytes);
  }
  return { docId, report, safety: safety.id };
}
