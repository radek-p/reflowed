// The one-file export with the editor's block structure in comment lines,
// and the import that splits on them. The markers are plain TeX comments, so
// the file compiles as it is.
//
//   %% reflowtex-editor v1 doc=<ulid> title="…"
//   %% rtx:doc {"files":[…],"settings":{…},"meta":{…},"bib":{"kind":"bbl","path":"main.bbl"}}
//   \begin{filecontents*}[overwrite]{\jobname.bbl} … (bibliography, edited figures)
//   %% rtx:preamble
//   \documentclass… (the preamble as stored; figure packages between %% rtx:added lines)
//   \begin{document}
//   %% rtx:block id=<ulid> kind=<kind> file=<path> h=<hash> {"before":"\n\n",…}
//   <the block's source>
//   …
//   %% rtx:end
//   \end{document}
//
// A container block (a proof or theorem split into paragraphs) is its
// head line after its marker, then each paragraph with `parent=<container id>`
// in its marker, then `%% rtx:close id=<container id>` and the end line: the
// file still reads as one \begin{proof} … \end{proof}.
//
// Between blocks is the block's own `before` whitespace (so paragraph breaks
// are TeX's as in the editor); a marker line always starts a line.
//
// Reading back: text between two markers is the first marker's block. When
// its hash `h` still matches, it is taken as is. When it was edited, the
// segment goes through the heuristic splitter: the first piece keeps the
// marker's id, kind, file and attrs. It is cut at blank lines only (outside
// environments and braces): text added after a blank line becomes a new
// block after it; text added without a blank line joins the block. Text
// before the first marker becomes new blocks at the start.

import type { Block, Doc, DocInit } from '../store/types.ts';
import { splitBody, envsFromPreamble } from './split.ts';
import { withoutAdditions } from './figures-export.ts';

export const HEAD = '%% reflowtex-editor v1';
const BLOCK = '%% rtx:block ';
const CLOSE = '%% rtx:close ';

/** FNV-1a 32 of a string, base 36: a short fingerprint of a block's source. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

// a value in a marker line: no spaces, no newlines (JSON when it needs quoting)
const val = (s: string) => (/^[^\s"{}]+$/.test(s) ? s : JSON.stringify(s));

export interface MarkedBlock { block: Block; source: string; figures?: Array<[string, string]> }

/** The marked one-file text. `sources` are the blocks' export sources (figure rewrites applied). */
export function writeMarked(doc: Doc, blocks: MarkedBlock[], preamble: string, pre: string): string {
  const out: string[] = [];
  out.push(`${HEAD} doc=${doc.id} title=${JSON.stringify(doc.title ?? '')}\n`);
  // tail: the bibliography's trailing whitespace (filecontents* drops it)
  const bibMeta = doc.bib.kind === 'none' ? { kind: 'none' } : { kind: doc.bib.kind, path: doc.bib.path, tail: /\s*$/.exec(doc.bib.source)![0] };
  out.push(`%% rtx:doc ${JSON.stringify({ files: doc.files, settings: doc.settings, meta: doc.meta, bib: bibMeta })}\n`);
  out.push(pre);                                      // filecontents* (bibliography, figures)
  out.push('%% rtx:preamble\n');
  const main = doc.files.find((f) => f.role === 'main');
  out.push(preamble.endsWith('\n') ? preamble : preamble + '\n');
  out.push((main?.head ?? '\\begin{document}').trim());
  let prevFile: string | null = null;
  // the open container: its end line comes after its last paragraph
  let open: { id: string; end: string } | null = null;
  const close = () => { if (open) { out.push(`\n${CLOSE}id=${open.id}\n${open.end}`); open = null; } };
  for (const { block: b, source, figures } of blocks) {
    if (open && b.parentId !== open.id) close();
    let sep = typeof b.attrs?.before === 'string' ? b.attrs.before : '\n\n';
    if (!sep.includes('\n')) sep = prevFile !== null && prevFile !== b.file ? '\n\n' : '\n' + sep;
    sep = sep.replace(/[ \t]+$/, '');                 // the marker starts its line (attrs keep the exact whitespace)
    const attrs: Record<string, unknown> = { ...b.attrs };
    if (figures?.length) attrs.figures = figures;
    const json = Object.keys(attrs).length ? ` ${JSON.stringify(attrs)}` : '';
    const parent = b.parentId ? ` parent=${b.parentId}` : '';
    out.push(`${sep}${BLOCK}id=${b.id}${parent} kind=${val(b.kind)} file=${val(b.file)} h=${fingerprint(b.source)}${json}\n${source}`);
    prevFile = b.file;
    const frame = (b.attrs as any)?.container;
    if (frame) open = { id: b.id, end: `${frame.end}${String(frame.after ?? '').replace(/\s+$/, '')}` };
  }
  close();
  out.push('\n%% rtx:end\n\\end{document}\n');
  return out.join('');
}

export const isMarked = (text: string) => text.replace(/^﻿/, '').trimStart().startsWith(HEAD);

function parseValue(s: string, i: number): [string, number] {
  if (s[i] === '"') {
    let j = i + 1;
    while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
    // a hand-damaged quote (no end, a bad escape): the text as it stands, not a failed import
    try { return [JSON.parse(s.slice(i, j + 1)), j + 1]; } catch { return [s.slice(i + 1, j).replace(/\\"/g, '"'), j + 1]; }
  }
  let j = i;
  while (j < s.length && s[j] !== ' ') j++;
  return [s.slice(i, j), j];
}

/** key=value … {json} after a marker keyword. */
function parseMarker(rest: string): { kv: Record<string, string>; json: any } {
  const kv: Record<string, string> = {};
  let i = 0, json: any = null;
  while (i < rest.length) {
    while (rest[i] === ' ') i++;
    if (i >= rest.length) break;
    if (rest[i] === '{') { try { json = JSON.parse(rest.slice(i)); } catch { /* hand-damaged: ignore */ } break; }
    const eq = rest.indexOf('=', i);
    if (eq < 0) break;
    const key = rest.slice(i, eq);
    const [v, j] = parseValue(rest, eq + 1);
    kv[key] = v; i = j;
  }
  return { kv, json };
}

export interface MarkedImport { init: DocInit & { id?: string }; blocksKept: number; blocksEdited: number; blocksNew: number; warnings: string[] }

/** Read a marked one-file export back. Blocks keep their ids unless hand-added. */
export function parseMarked(text: string, newId: () => string): MarkedImport {
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const head = /^\s*%% reflowtex-editor v1 (.*)$/m.exec(lines)!;
  const { kv: hkv } = parseMarker(head[1]);
  const docLine = /^%% rtx:doc (\{.*\})$/m.exec(lines);
  let docInfo: any = {};
  if (docLine) { try { docInfo = JSON.parse(docLine[1]); } catch { warnings.push('the %% rtx:doc line is damaged: files and settings not restored'); } }
  // header region: filecontents* (the bibliography)
  const preAt = lines.search(/^%% rtx:preamble[^\n]*$/m);
  if (preAt < 0) throw new Error('marked file without a %% rtx:preamble line');
  const headerText = lines.slice(0, preAt);
  const files = new Map<string, string>();
  for (const m of headerText.matchAll(/\\begin\{filecontents\*?\}(?:\[[^\]]*\])?\{([^}]+)\}\n([\s\S]*?)\n?\\end\{filecontents\*?\}/g)) files.set(m[1], m[2]);
  const afterPre = lines.indexOf('\n', preAt) + 1;
  const beginM = /^[ \t]*\\begin\s*\{document\}[^\n]*$/m.exec(lines.slice(afterPre));
  if (!beginM) throw new Error('marked file without \\begin{document}');
  const preamble = withoutAdditions(lines.slice(afterPre, afterPre + beginM.index));
  const bodyStart = afterPre + beginM.index + beginM[0].length;
  let body = lines.slice(bodyStart);
  const endAt = body.search(/^%% rtx:end[^\n]*$/m);
  if (endAt >= 0) body = body.slice(0, endAt);
  else {
    const e = /^[ \t]*\\end\s*\{document\}/m.exec(body);
    if (e) body = body.slice(0, e.index);
    warnings.push('no %% rtx:end line: the body ends at \\end{document}');
  }

  // segments: [text before the first marker], then one per marker
  const markerRe = /^[ \t]*%% rtx:(block|close) (.*)$/gm;
  const marks: Array<{ start: number; end: number; rest: string; close: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(body))) marks.push({ start: m.index, end: m.index + m[0].length + 1, rest: m[2], close: m[1] === 'close' });
  const opts = envsFromPreamble(preamble);
  const blocks: NonNullable<DocInit['blocks']> & Array<{ id?: string }> = [];
  let kept = 0, edited = 0, added = 0;
  const mainPath = (docInfo.files ?? []).find((f: any) => f.role === 'main')?.path ?? 'main.tex';
  const pieces = (seg: string, file: string) => splitBody(seg, opts, { blankLinesOnly: true }).items.map((it) => (it.type === 'block'
    ? { kind: it.kind, source: it.source, file, attrs: { ...it.attrs, before: it.before } }
    : { kind: 'input', source: it.cmd, file, attrs: { before: it.before } }));
  const lead = body.slice(0, marks[0]?.start ?? body.length);
  if (lead.trim()) for (const p of pieces(lead, mainPath)) { blocks.push({ ...p, id: newId() }); added++; }
  for (let i = 0; i < marks.length; i++) {
    const seg = body.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : body.length);
    const { kv, json } = parseMarker(marks[i].rest);
    if (marks[i].close) {
      // a container's end line; text added after it (by hand) becomes new blocks
      const c = blocks.find((b) => b.id === kv.id) as any;
      let rest = seg.trim();
      const frame = c?.attrs?.container;
      if (frame && rest.startsWith(frame.end)) rest = rest.slice(frame.end.length);
      const after = String(frame?.after ?? '').trim();
      if (after && rest.trimStart().startsWith(after)) rest = rest.trimStart().slice(after.length);
      if (rest.trim()) for (const p of pieces(rest.trim(), c?.file ?? mainPath)) { blocks.push({ ...p, id: newId() }); added++; }
      continue;
    }
    const parentId = kv.parent ? { parentId: kv.parent } : {};
    const attrs: Record<string, unknown> = json && typeof json === 'object' ? { ...json } : {};
    const figures = Array.isArray(attrs.figures) ? attrs.figures as Array<[string, string]> : [];
    delete attrs.figures;
    const file = kv.file || mainPath;
    let source = seg.trim();
    // edited figures: back to the stored \includegraphics
    for (const [rewritten, orig] of figures) if (source.includes(rewritten)) source = source.replace(rewritten, orig);
    const id = kv.id || newId();
    if (!source) { warnings.push(`block ${id}: empty, dropped`); continue; }
    if ((kv.h && fingerprint(source) === kv.h) || attrs.container) {
      // (a container's head is taken as it is, edited or not)
      blocks.push({ id, kind: kv.kind || 'paragraph', source, file, attrs, ...parentId });
      kept++;
      continue;
    }
    // edited by hand: split what is there now
    const ps = pieces(source, file);
    if (!ps.length) continue;
    const [first, ...more] = ps;
    const firstKind = kv.kind && kv.kind === first.kind ? kv.kind : (first.kind !== 'paragraph' ? first.kind : kv.kind || first.kind);
    blocks.push({ id, kind: firstKind, source: first.source, file, attrs, ...parentId });
    edited++;
    for (const p of more) { blocks.push({ ...p, id: newId(), ...parentId }); added++; }
  }
  const title = typeof hkv.title === 'string' ? hkv.title : '';
  const bib: Doc['bib'] = { kind: 'none', source: '' };
  if (docInfo.bib?.kind && docInfo.bib.kind !== 'none') {
    const name = (docInfo.bib.path ?? '').split('/').pop();
    const src = files.get(name) ?? [...files.entries()].find(([n]) => n.endsWith(docInfo.bib.kind === 'bbl' ? '.bbl' : '.bib'))?.[1];
    if (src != null) Object.assign(bib, { kind: docInfo.bib.kind, source: src.replace(/\s+$/, '') + (typeof docInfo.bib.tail === 'string' ? docInfo.bib.tail : '\n'), path: docInfo.bib.path });
    else warnings.push('the bibliography named in %% rtx:doc is not in the file');
  }
  const init: DocInit & { id?: string } = {
    ...(hkv.doc ? { id: hkv.doc } : {}),
    title, preamble,
    meta: docInfo.meta ?? { authors: [], tags: [] },
    settings: docInfo.settings ?? { class: 'article' },
    files: docInfo.files ?? [{ path: 'main.tex', role: 'main' }],
    bib,
    blocks,
  };
  return { init, blocksKept: kept, blocksEdited: edited, blocksNew: added, warnings };
}
