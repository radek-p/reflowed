// nested blocks, the model. A long theorem or proof can be edited as one
// block per paragraph: a *container* block holds only the frame (its source
// is the begin line, `\begin{proof}[Proof of \Cref{x}]`; `attrs.container`
// keeps the end line and the whitespace around it), and each paragraph is an
// ordinary block with `parentId` = the container's id. Pure functions over
// block records (no DOM, no store): used by io/ (import, export, markers),
// store/ (id remapping) and the app (nesting/app.js).
//
//   parseFrame(source)            \begin{env}[opt] … \end{env} → head, body, end, after (or null)
//   nestSource(block, opts)       a plain env block → [container, ...children] (null: not nestable)
//   flattenSource(c, children)    the container's whole source again (byte for byte)
//   treeOrder(blocks)             document order: top level by (pos, id), each container's children after it
//   flattenForExport(blocks)      containers + children → one block each (export, PDF)
//   roles(blocks)                 child id → { parent, first, last } among the children TeX typesets
//   compileParts(child, container, role)   the TeX around a child when it is compiled
//   reassignIds(blocks, newId)    new ids, parentIds remapped (import as new, duplicate, seed)
//   fixBefores(blocks)            whitespace before children after a restructure (paragraph breaks)
//
// Document order: a child's `pos` is a key in the document's one order (between
// its container's and the next top-level block's), so every existing sort by
// pos (store, export, snapshots) sees document order; `treeOrder` is the same
// order derived from the tree, and repairs a child that drifted.
import { splitBody, codeOf, type SplitOptions } from '../io/split.ts';

export interface NestBlock {
  id?: string;
  pos?: string;
  kind?: string;
  source: string;
  file?: string;
  attrs?: Record<string, any>;
  parentId?: string | null;
}

/** What a container keeps besides its head (its source): attrs.container. */
export interface ContainerFrame {
  end: string;          // "\\end{proof}" as written
  before: string;       // whitespace between the last child and the end line
  after: string;        // what followed the end in the block (whitespace, comments, \label)
}

export const isContainer = (b: NestBlock | null | undefined): boolean => !!b?.attrs?.container;
export const frameOf = (b: NestBlock): ContainerFrame => b.attrs!.container as ContainerFrame;

/** Kinds that are never typeset (markers in the app). */
const MARKER_KINDS = new Set(['comment', 'macros', 'appendix']);
/** A block TeX typesets something for (not a comment-only or definitions block). */
export function isTypeset(b: NestBlock): boolean {
  if (isContainer(b)) return false;
  if (MARKER_KINDS.has(b.kind ?? '')) return false;
  const code = b.source.split('\n').map(codeOf).join('\n').trim();
  return !!code && !/^\\appendix$/.test(code);
}

// ── Parsing an environment block ─────────────────────────────────────────────

export interface Frame { env: string; head: string; body: string; end: string; after: string }

const TAIL_OK = /^(?:\s|%[^\n]*|\\label\s*\{[^{}]*\})*$/;

/** The optional [argument] at s[i] (horizontal spaces first): index after it, or i. */
function skipOptional(s: string, i: number): number {
  let j = i;
  while (s[j] === ' ' || s[j] === '\t') j++;
  if (s[j] !== '[') return i;
  let brace = 0;
  for (let k = j + 1; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }
    if (c === '{') brace++;
    else if (c === '}') brace = Math.max(0, brace - 1);
    else if (c === ']' && brace === 0) return k + 1;
    else if (c === '\n' && s[k + 1] === '\n') return i;          // a blank line: not an argument
  }
  return i;
}

/** `\begin{env}[opt] body \end{env} after` (leading comment lines allowed in the head). */
export function parseFrame(source: string): Frame | null {
  const lead = /^(?:[ \t]*%[^\n]*\n|[ \t]*\n)*[ \t]*/.exec(source)![0];
  const m = /^\\begin\s*\{([^{}]+)\}/.exec(source.slice(lead.length));
  if (!m) return null;
  const env = m[1];
  const headEnd = skipOptional(source, lead.length + m[0].length);
  // the matching \end{env}: environments counted, comments and \verb skipped
  let depth = 0;
  for (let i = headEnd; i < source.length; i++) {
    const c = source[i];
    if (c === '%') { const nl = source.indexOf('\n', i); if (nl < 0) break; i = nl; continue; }
    if (c !== '\\') continue;
    const rest = source.slice(i, i + 200);
    let t: RegExpExecArray | null;
    if ((t = /^\\begin\s*\{([^{}]+)\}/.exec(rest))) { if (t[1] === env) depth++; i += t[0].length - 1; continue; }
    if ((t = /^\\end\s*\{([^{}]+)\}/.exec(rest))) {
      if (t[1] === env) {
        if (depth === 0) {
          const after = source.slice(i + t[0].length);
          if (!TAIL_OK.test(after)) return null;
          return { env, head: source.slice(0, headEnd), body: source.slice(headEnd, i), end: t[0], after };
        }
        depth--;
      }
      i += t[0].length - 1;
      continue;
    }
    if ((t = /^\\verb\*?([^A-Za-z\s])/.exec(rest))) { const k = source.indexOf(t[1], i + t[0].length); i = k < 0 ? source.length : k; continue; }
    i++;                                                   // an escaped character
  }
  return null;
}

/** Environments a block may be nested for: proofs and theorem-likes (thm-restate's restatable not: its
 *  body is copied whole by \name*). */
export function nestableEnv(env: string, opts: SplitOptions): boolean {
  if (/^restatable\*?$/.test(env)) return false;
  if (env === 'abstract') return true;                  // its title only above the first paragraph (rtx-numbering.sty)
  const bare = env.replace(/\*$/, '');
  return opts.proofEnvs.has(env) || opts.proofEnvs.has(bare) || opts.theoremEnvs.has(env) || opts.theoremEnvs.has(bare);
}

export interface Piece { before: string; source: string; kind: string; attrs: Record<string, unknown> }

/** The body's paragraphs (cut at blank lines outside environments, braces and displays, as the importer
 *  cuts a file) and the whitespace after the last one. */
export function paragraphsOf(body: string, opts: SplitOptions): { pieces: Piece[]; tail: string } {
  const { items, tail } = splitBody(body, opts, { blankLinesOnly: true });
  const pieces: Piece[] = [];
  for (const it of items) {
    if (it.type !== 'block') return { pieces: [], tail: body };      // (blankLinesOnly gives none)
    const attrs = { ...it.attrs };
    delete attrs.joined;
    pieces.push({ before: it.before, source: it.source, kind: it.kind, attrs });
  }
  return { pieces, tail };
}

/** A plain environment block as a container and its paragraphs; null when it is not an environment we
 *  nest or has fewer than `min` typeset paragraphs. The container keeps the block's id (when it has one),
 *  kind, file and attrs. `split`: also cut the paragraph holding this offset of the block's source there. */
export function nestSource(block: NestBlock, opts: SplitOptions, newId: () => string, o: { min?: number; split?: number } = {}): (NestBlock[] & { splitChild?: string }) | null {
  const f = parseFrame(block.source);
  if (!f || !nestableEnv(f.env, opts)) return null;
  const { pieces, tail } = paragraphsOf(f.body, opts);
  let splitAt = -1;
  if (o.split != null) {
    // offset → body offset; cut that paragraph at it (the part after becomes the next paragraph)
    const at = o.split - f.head.length;
    let off = 0;
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k];
      const s = off + p.before.length, e = s + p.source.length;
      if (at > s && at < e) {
        const a = p.source.slice(0, at - s).replace(/\s+$/, ''), b = p.source.slice(at - s).replace(/^\s+/, '');
        if (a && b) { pieces.splice(k, 1, { ...p, source: a }, { before: '\n\n', source: b, kind: 'paragraph', attrs: {} }); splitAt = k + 1; }
        break;
      }
      off = e;
    }
  }
  if (pieces.filter((p) => isTypeset({ source: p.source, kind: p.kind })).length < (o.min ?? 2)) return null;
  const id = block.id ?? newId();
  const container: NestBlock = { ...block, id, source: f.head, attrs: { ...(block.attrs ?? {}), env: block.attrs?.env ?? f.env, container: { end: f.end, before: tail, after: f.after } } };
  delete container.parentId;
  const children: NestBlock[] = pieces.map((p) => ({
    id: newId(), kind: p.kind, source: p.source, file: block.file, attrs: { ...p.attrs, before: p.before }, parentId: id,
  }));
  const out: NestBlock[] & { splitChild?: string } = [container, ...children];
  if (splitAt >= 0) out.splitChild = children[splitAt].id;
  return out;
}

const beforeOf = (b: NestBlock, first: boolean) => (typeof b.attrs?.before === 'string' ? b.attrs.before : first ? '\n' : '\n\n');

/** The environment's whole source from its container and children (in order): byte for byte what was
 *  nested when nothing was edited. */
export function flattenSource(container: NestBlock, children: NestBlock[]): string {
  const f = frameOf(container);
  return container.source + children.map((c, k) => beforeOf(c, k === 0) + c.source).join('') + f.before + f.end + f.after;
}

/** One plain block for a container and its children: the container's id, pos, kind, file and attrs (less
 *  the frame), the whole source. */
export function joinContainer(container: NestBlock, children: NestBlock[]): NestBlock {
  const { container: _c, ...attrs } = container.attrs ?? {};
  const out: NestBlock = { ...container, source: flattenSource(container, children), attrs };
  delete out.parentId;
  return out;
}

// ── Order ────────────────────────────────────────────────────────────────────

const byPosId = (a: NestBlock, b: NestBlock) => (a.pos! < b.pos! ? -1 : a.pos! > b.pos! ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0);

/** A child's container, if that is a valid one (a top-level container in the list). */
function parentsOf<T extends NestBlock>(blocks: T[]): Map<string, T> {
  const byId = new Map(blocks.filter((b) => b.id).map((b) => [b.id!, b]));
  const out = new Map<string, T>();
  for (const b of blocks) {
    if (!b.parentId || !b.id) continue;
    const p = byId.get(b.parentId);
    if (p && p !== b && isContainer(p) && !p.parentId) out.set(b.id, p);
  }
  return out;
}

/** Document order from the tree. `orphans`: blocks whose parentId names no container (shown top level). */
export function treeOrder<T extends NestBlock>(blocks: T[], opts: { sorted?: boolean } = {}): { order: T[]; orphans: T[] } {
  const parent = parentsOf(blocks);
  const kids = new Map<string, T[]>();
  const top: T[] = [];
  const orphans: T[] = [];
  for (const b of blocks) {
    const p = b.id ? parent.get(b.id) : undefined;
    if (p) { if (!kids.has(p.id!)) kids.set(p.id!, []); kids.get(p.id!)!.push(b); }
    else { top.push(b); if (b.parentId) orphans.push(b); }
  }
  if (!opts.sorted) { top.sort(byPosId); for (const k of kids.values()) k.sort(byPosId); }
  return { order: top.flatMap((t) => [t, ...(kids.get(t.id ?? '') ?? [])]), orphans };
}

/** A tree that lost its links (ids reassigned without mapping parentIds, as older seed builds did): orphans (a parentId naming no block) go back to the childless container right before them in
 *  document order, else to the top level; a container still without children becomes one plain block (its
 *  frame alone, `\begin{proof}\end{proof}`, compiles). Returns the repaired list (document order) and the
 *  blocks that changed (to be written back). */
export function repairTree<T extends NestBlock>(blocks: T[]): { blocks: T[]; changed: T[] } {
  const ids = new Set(blocks.map((b) => b.id));
  if (!blocks.some((b) => (b.parentId && !ids.has(b.parentId)) || isContainer(b))) return { blocks, changed: [] };
  const sorted = [...blocks].sort(byPosId);
  const changed = new Map<string, T>();
  const hasKids = new Set(blocks.filter((b) => b.parentId && ids.has(b.parentId)).map((b) => b.parentId!));
  let open: T | null = null;                  // the last childless container seen, while orphans follow it
  let openFor: string | null = null;          // the missing id its orphans name
  const out = sorted.map((b) => {
    if (isContainer(b) && !b.parentId) { open = hasKids.has(b.id!) ? null : b; openFor = null; return b; }
    if (b.parentId && !ids.has(b.parentId)) {
      let c: T = { ...b };
      if (open && (openFor === null || openFor === b.parentId)) { openFor = b.parentId; c.parentId = open.id; hasKids.add(open.id!); }
      else { c.parentId = null; open = null; }
      changed.set(c.id!, c);
      return c;
    }
    if (!b.parentId) { open = null; openFor = null; }
    return b;
  });
  const final = out.map((b) => {
    if (isContainer(b) && !b.parentId && !hasKids.has(b.id!)) { const j = joinContainer(b, []) as T; changed.set(j.id!, j); return j; }
    return b;
  });
  return { blocks: treeOrder(final).order, changed: [...changed.values()] };
}

/** Children of each container, in order (blocks in document order). */
export function childrenOf<T extends NestBlock>(blocks: T[]): Map<string, T[]> {
  const parent = parentsOf(blocks);
  const out = new Map<string, T[]>();
  for (const b of blocks) {
    if (isContainer(b) && !b.parentId && b.id) { if (!out.has(b.id)) out.set(b.id, []); continue; }
    const p = b.id ? parent.get(b.id) : undefined;
    if (p) { if (!out.has(p.id!)) out.set(p.id!, []); out.get(p.id!)!.push(b); }
  }
  return out;
}

/** Containers and their children as one block each, in document order (the export's view, the PDF's). */
export function flattenForExport<T extends NestBlock>(blocks: T[]): T[] {
  if (!blocks.some((b) => b.parentId || isContainer(b))) return blocks;
  const { order } = treeOrder(blocks);
  const kids = childrenOf(order);
  const parent = parentsOf(order);
  const out: T[] = [];
  for (const b of order) {
    if (b.id && parent.has(b.id)) continue;                       // written with its container
    if (isContainer(b) && !b.parentId) { out.push(joinContainer(b, kids.get(b.id!) ?? []) as T); continue; }
    if (b.parentId) { const c = { ...b }; delete c.parentId; out.push(c); continue; }   // an orphan: its own block
    out.push(b);
  }
  return out;
}

// ── Roles and compiling ──────────────────────────────────────────────────────

export interface Role { parent: string; first: boolean; last: boolean; index: number; count: number }

/** Each child's role among its container's typeset children (the first gets the head, the last the end
 *  mark); children TeX typesets nothing for get none. */
export function roles<T extends NestBlock>(blocks: T[]): Map<string, Role> {
  const out = new Map<string, Role>();
  for (const [pid, kids] of childrenOf(blocks)) {
    const ts = kids.filter(isTypeset);
    ts.forEach((c, k) => out.set(c.id!, { parent: pid, first: k === 0, last: k === ts.length - 1, index: k, count: ts.length }));
  }
  return out;
}

/** The TeX around a child when it is compiled: `prefix` goes after the refs context (before the child's
 *  source, on lines of its own), `suffix` after the source. The flags (rtx-numbering.sty \rtxnestpart):
 *  head = typeset the environment's head (first child), end = its end mark (last child). */
export function compileParts(container: NestBlock, role: Pick<Role, 'first' | 'last'>): { prefix: string; suffix: string } {
  const f = frameOf(container);
  const flags = [role.first ? 'head' : '', role.last ? 'end' : ''].filter(Boolean).join(',');
  return {
    prefix: `\\ifdefined\\rtxnestpart\\rtxnestpart{${flags}}\\fi\n${container.source.replace(/\s+$/, '')}\\ifdefined\\rtxnestdone\\rtxnestdone\\fi`,
    suffix: `\n${f.end}${role.last ? f.after.replace(/\s+$/, '') : ''}`,
  };
}

// ── Restructuring helpers ────────────────────────────────────────────────────

const BLANK = /\n[ \t]*\n/;
/** After children moved: the first child of a container needs no blank line before it (else the head
 *  would stand alone), every later one needs one (else it joins the paragraph before); a block that left
 *  a container needs one too. Only blocks that break the rule are changed (copies returned in place). */
export function fixBefores<T extends NestBlock>(blocks: T[], touched?: Set<string>): T[] {
  const kids = childrenOf(blocks);
  const parent = parentsOf(blocks);
  const firstOf = new Set([...kids.values()].map((k) => k[0]?.id).filter(Boolean));
  return blocks.map((b) => {
    if (!b.id || isContainer(b)) return b;
    const before = typeof b.attrs?.before === 'string' ? b.attrs.before : null;
    const inside = parent.has(b.id);
    let want: string | null = null;
    if (inside && firstOf.has(b.id)) { if (before !== null && BLANK.test(before)) want = '\n'; }
    else if (inside || touched?.has(b.id)) { if (before !== null && !BLANK.test(before)) want = '\n\n'; }
    return want === null ? b : { ...b, attrs: { ...b.attrs, before: want } };
  });
}

/** New ids for every block (`newId`), parentIds mapped to them. Blocks without an id get one. */
export function reassignIds<T extends NestBlock>(blocks: T[], newId: () => string): T[] {
  const map = new Map<string, string>();
  const out = blocks.map((b) => { const id = newId(); if (b.id) map.set(b.id, id); return { ...b, id }; });
  for (const b of out) if (b.parentId) b.parentId = map.get(b.parentId) ?? null;
  for (const b of out) if (b.parentId === null) delete b.parentId;
  return out;
}

/** Map parentIds after some ids were replaced (old id → new id); unknown parents stay. */
export function remapParents<T extends NestBlock>(blocks: T[], map: Map<string, string>): T[] {
  return blocks.map((b) => (b.parentId && map.has(b.parentId) ? { ...b, parentId: map.get(b.parentId)! } : b));
}

/** The heuristic importer's step: every proof or theorem-like block with at least two typeset paragraphs
 *  becomes a container with its paragraphs (ids from `newId`). */
export function nestImported<T extends NestBlock>(blocks: T[], opts: SplitOptions, newId: () => string): T[] {
  const out: T[] = [];
  for (const b of blocks) {
    const n = !b.parentId && !isContainer(b) ? nestSource(b, opts, newId) : null;
    if (n) out.push(...(n as T[])); else out.push(b);
  }
  return out;
}

/** The optional argument of a container's head ("Proof of \Cref{x}"), or null. */
export function headTitle(head: string): string | null {
  const m = /\\begin\s*\{[^{}]+\}[ \t]*\[/.exec(head);
  if (!m) return null;
  const s = head.slice(m.index + m[0].length - 1);
  const j = skipOptional(s, 0);
  if (!j) return null;
  let t = s.slice(1, j - 1).trim();
  if (t.startsWith('{') && t.endsWith('}')) t = t.slice(1, -1);
  return t;
}
/** The environment a container's head begins. */
export const headEnv = (head: string): string | null => /\\begin\s*\{([^{}]+)\}/.exec(head)?.[1] ?? null;
