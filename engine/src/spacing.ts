// What the page needs to set the gap between two blocks as
// TeX would. Read from the engine's own flow records (input.rtxc.jsonl): the
// block's part of the main vertical list is everything after rtx-block.tex
// was opened, up to the block-end special that blockFile() appends. The
// capture is pageless, so glue at the top of the block is kept (a page
// builder would discard it), exactly as TeX appended it.
//
//   above      the glue and kerns before the block's first box, without \parskip
//   aboveAddv  every piece of `above` came from \addvspace (attribute 917, rtx-xetex.sty)
//   parskip    the \parskip glue TeX appended before the first box (0 when none)
//   below      the glue and kerns after the last box
//   firstHeight / lastDepth   of the first / last box (lines: XeTeX's extents)
//   baselineskip, lineskip, lineskiplimit: in force at the first paragraph
//   indent     the first paragraph starts with a \parindent box
//
// The gap before block B after block A is then (TeX §679, LaTeX's \addvspace):
//   merge(A.below, B.above) + B.parskip + interline(A.lastDepth, B.firstHeight)
// where merge is the max when both are \addvspace and the sum otherwise.
export interface Glue { pt: number; plus?: number; plusOrder?: 0 | 1 | 2 | 3; minus?: number; minusOrder?: 0 | 1 | 2 | 3 }
export interface BlockSpacing {
  above: Glue; below: Glue; aboveAddv?: boolean; belowAddv?: boolean;
  firstHeight: number; lastDepth: number;
  parskip: Glue; baselineskip: Glue; lineskip: Glue; lineskiplimit: number; indent: boolean;
  /** the pieces as TeX appended them, for the page's gap (web/spacing.ts):
   *  [kind (0 glue, 1 kern, 2 penalty, 3 other: insert, mark, whatsit), glue subtype (kind 3: 1 a special, 2 a hyperref anchor), glue subtype, width sp, stretch, stretch order, shrink, shrink order, addvspace 0|1] */
  raw: { above: number[][]; below: number[][] };
}
export const BLOCK_END = 'rtx:blockend';
export const ADDV_ATTR = 917;
/** the zero-size box reflowtex's \label leaves behind (template.tex \reflowtex@anchorbox, serializer.lua ANCHOR_ATTR) */
export const ANCHOR_ATTR = 910;
const SP = 65536;
const pt = (sp: number) => Math.round((sp / SP) * 1e5) / 1e5;

type Rec = { t: string; [k: string]: any };
/** [w, stretch, stretchOrder, shrink, shrinkOrder] summed (the highest order wins, as TeX's totals) */
function sum(parts: number[][]): Glue {
  let w = 0, st = 0, sto = 0, sh = 0, sho = 0;
  for (const [pw, pst = 0, psto = 0, psh = 0, psho = 0] of parts) {
    w += pw;
    if (pst) { if (psto > sto) { sto = psto; st = pst; } else if (psto === sto) st += pst; }
    if (psh) { if (psho > sho) { sho = psho; sh = psh; } else if (psho === sho) sh += psh; }
  }
  const g: Glue = { pt: pt(w) };
  if (st) { g.plus = pt(st); if (sto) g.plusOrder = sto as 1 | 2 | 3; }
  if (sh) { g.minus = pt(sh); if (sho) g.minusOrder = sho as 1 | 2 | 3; }
  return g;
}
const glueOf = (a: number[] | undefined): Glue => sum(a ? [[a[0], a[1], a[2], a[3], a[4]]] : []);
const hasAttr = (n: Rec, k: number) => Array.isArray(n.a) && n.a.some((v: number, i: number) => i % 2 === 0 && v === k && n.a[i + 1] > 0);
// an anchor point is a box only to carry its attribute: it is not the block's first or last box (a heading ending in
const isAnchor = (n: Rec) => n.t === 'h' && hasAttr(n, ANCHOR_ATTR) && !n.w && !n.h && !n.d;
const isBox = (n: Rec) => ((n.t === 'h' || n.t === 'v') && !isAnchor(n)) || (n.t === 'r' && ((n.h ?? 0) || (n.d ?? 0)));

/** The block's spacing from the capture stream (text) and its output.json. */
export function spacingOf(stream: string, output?: any): BlockSpacing | undefined {
  const flow: Rec[] = [];
  let inBlock = false, par: Rec | null = null;
  for (const line of stream.split('\n')) {
    if (!line) continue;
    if (!inBlock) {
      if (line.includes('"t":"in"') && line.includes('rtx-block.tex')) inBlock = true;
      continue;
    }
    if (line.startsWith('{"t":"flow"')) {
      const n = (JSON.parse(line) as Rec).n as Rec;
      if (n.t === 'x' && typeof n.s === 'string' && n.s.includes(BLOCK_END)) break;
      flow.push(n);
    } else if (!par && line.startsWith('{"t":"par"')) par = JSON.parse(line);
  }
  if (!inBlock) return undefined;
  const first = flow.findIndex(isBox);
  let last = -1;
  for (let i = flow.length - 1; i >= 0; i--) if (isBox(flow[i])) { last = i; break; }
  const piece = (n: Rec) => (n.t === 'g' ? [n.w, n.st ?? 0, n.sto ?? 0, n.sh ?? 0, n.sho ?? 0] : n.t === 'k' ? [n.w, 0, 0, 0, 0] : [0, 0, 0, 0, 0]);
  const rawPiece = (n: Rec) => [n.t === 'g' ? 0 : n.t === 'k' ? 1 : n.t === 'p' ? 2 : 3, n.t === 'x' ? (/^pdf:dest\b/.test(n.s ?? '') ? 2 : 1) : n.sub ?? 0, n.t === 'p' ? n.v : n.w ?? 0, n.st ?? 0, n.sto ?? 0, n.sh ?? 0, n.sho ?? 0, hasAttr(n, ADDV_ATTR) ? 1 : 0];
  // interline glue (\\lineskip 1, \\baselineskip 2) is left out: the page makes it again from the extents
  // other nodes on the list (an insert, a mark, a \\write or \\special whatsit) count too: they hide \\lastskip
  const isSkip = (n: Rec) => (n.t === 'g' && n.sub !== 1 && n.sub !== 2) || n.t === 'k' || n.t === 'p' || n.t === 'i' || n.t === 'W' || n.t === 'M' || n.t === 'x' || isAnchor(n);
  const lead = (first < 0 ? flow : flow.slice(0, first)).filter(isSkip);
  const trail = (last < 0 ? [] : flow.slice(last + 1)).filter(isSkip);
  const aboveParts = lead.filter((n) => (n.t === 'g' || n.t === 'k') && !(n.t === 'g' && n.sub === 3));
  const parskipParts = lead.filter((n) => n.t === 'g' && n.sub === 3);
  const addv = (list: Rec[]) => (list.some((n) => n.t === 'g' && hasAttr(n, ADDV_ATTR)) ? true : undefined);
  const fb = first >= 0 ? flow[first] : null, lb = last >= 0 ? flow[last] : null;
  let indent = false;
  const para0 = output?.content?.find((it: any) => it.kind === 'paragraph');
  if (para0) {
    const p = output.paragraphs?.find((q: any) => q.index === para0.para);
    const n0 = p?.nodes?.[0];
    indent = !!(n0 && n0.type === 'hlist' && n0.subtype === 3 && n0.width > 0);
  }
  return {
    above: sum(aboveParts.map(piece)), below: sum(trail.filter((n) => n.t === 'g' || n.t === 'k').map(piece)),
    aboveAddv: addv(aboveParts), belowAddv: addv(trail),
    firstHeight: pt(fb?.h ?? 0), lastDepth: pt(lb?.d ?? 0),
    parskip: sum(parskipParts.map(piece)),
    baselineskip: glueOf(par?.baselineskip), lineskip: glueOf(par?.lineskip), lineskiplimit: pt(par?.lineskiplimit ?? 0),
    indent,
    raw: { above: lead.map(rawPiece), below: trail.map(rawPiece) },
  };
}
