// from each block's `spacing` (BlockResult.spacing, src/spacing.ts). The
// blocks are compiled apart, so the gap is rebuilt as TeX would build it on
// one list: A's trailing items, then B's leading ones, with LaTeX's
// \addvspace and \addpenalty made again on A's tail, then the interline glue
// for B's first box. The page (app/src/panes/blocks.js applySpacing) sets the
// gap from this; engine/tests/spacing.test.ts holds it to TeX's own list.
//
//   import { gapBetween } from '…/engine/web/spacing.ts';
//   const g = gapBetween(prev.spacing, next.spacing);
//   g.explicitPt    the gap's \vskip/\parskip glue (what output.json's `vspace.amount` holds between paragraphs)
//   g.interlinePt   \baselineskip − depth − height (or \lineskip), what the viewer adds between lines
//   g.totalPt       everything (glue, kerns, display skips, interline): the distance from A's last baseline
//                   plus A's depth to B's first box top, at natural size
//
// B's leading \addvspace glue are the RESULTS of LaTeX's \addvspace calls,
// made in B's own compile where \lastskip was B's own (0 at its top): a call
// with a skip larger than \lastskip left `-\lastskip, skip`, one with a
// negative skip (\addvspace{-\parskip} at a list's first \item) left
// `-\lastskip, \lastskip + skip`. The calls are read back from those pieces
// and made again on A's tail, with \addvspace's own rule (latex.ltx
// \@xaddvskip). A box, a \write, a mark or a special at A's end hides
// \lastskip, as it does for TeX.
//
// Without the \addvspace attribute (patch 0005, rtx-xetex.sty) a leading
// user skip (subtype 0) of B is taken to be \addvspace, which is what LaTeX's
// sections, lists and theorems use.

/** src/spacing.ts BlockSpacing, the part read here (pt) */
export interface GapGlue { pt: number }
export interface GapSpacing {
  firstHeight?: number; lastDepth?: number;
  baselineskip?: GapGlue; lineskip?: GapGlue; lineskiplimit?: number;
  /** [kind (0 glue, 1 kern, 2 penalty, 3 other), subtype (kind 3: 2 a hyperref anchor), width sp (kind 2: the penalty),
   *  stretch, stretch order, shrink, shrink order, addvspace 0|1] */
  raw?: { above?: number[][]; below?: number[][] };
}
export interface Gap { explicitPt: number; interlinePt: number; totalPt: number }

const SP = 65536;
const G = 0, K = 1, P = 2;   // (3: another node: a box, an insert, a mark, a whatsit; it hides \lastskip)
interface Piece { k: number; sub: number; w: number }

export function gapBetween(a: GapSpacing | null | undefined, b: GapSpacing | null | undefined): Gap | null {
  if (!a || !b) return null;
  const below = a.raw?.below ?? [], above = b.raw?.above ?? [];
  const list: Piece[] = below.map((x) => ({ k: x[0], sub: x[1], w: x[0] === P ? 0 : x[2] }));
  const lastskip = () => { const t = list[list.length - 1]; return t && t.k === G ? t.w : 0; };
  // latex.ltx \addvspace / \@xaddvskip, on the joined list
  const addvspace = (skip: number) => {
    const last = lastskip();
    if (last === 0) list.push({ k: G, sub: 0, w: skip });
    else if (last < skip) list.push({ k: G, sub: 0, w: -last }, { k: G, sub: 0, w: skip });
    else if (skip < 0 && last >= 0) list.push({ k: G, sub: 0, w: -last }, { k: G, sub: 0, w: last + skip });
  };
  const known = [...below, ...above].some((x) => x[7]);
  const isAddv = (x: number[] | undefined, first: boolean) => !!x && x[0] === G && (known ? !!x[7] : first && x[1] === 0);
  let own = 0;          // B's \lastskip in its own compile, before the piece read
  let first = true;
  for (let i = 0; i < above.length; i++) {
    const x = above[i];
    const [k, sub, w] = x;
    if (k === P) {
      // \addpenalty (LaTeX: section, list and theorem starts) goes before the
      // last skip and keeps \lastskip; told apart by the \addvspace glue that
      // follows it. Any other penalty (\nobreak) ends the skip run.
      own = 0;
      if (isAddv(above[i + 1], first)) continue;
      list.push({ k: P, sub: 0, w: 0 });
      continue;
    }
    // a hyperref anchor (pdf:dest) in vertical mode is put in with the last
    // skip taken off and put back (\Hy@SaveLastskip), with its \nobreak
    if (k === 3 && sub === 2) { if (above[i + 1]?.[0] === P && above[i + 1][2] === 10000) i++; continue; }
    if (k !== G && k !== K) { list.push({ k, sub, w: 0 }); own = 0; continue; }
    if (isAddv(x, first)) {
      first = false;
      const next = above[i + 1];
      if (own !== 0 && w === -own && isAddv(next, false)) {
        // a call that replaced B's own \lastskip: a larger skip, or a negative one added to it
        const y = next![2];
        addvspace(y > own ? y : y - own);
        own = y; i++;
        continue;
      }
      if (own === 0) { addvspace(w); own = w; continue; }
    }
    first = false;
    list.push({ k, sub, w });
    own = k === G ? w : 0;
  }
  const explicit = list.filter((x) => x.k === G && (x.sub === 0 || x.sub === 3)).reduce((s, x) => s + x.w, 0);
  const all = list.reduce((s, x) => s + x.w, 0);
  const bls = (b.baselineskip?.pt ?? 12) * SP, ls = (b.lineskip?.pt ?? 1) * SP, lsl = (b.lineskiplimit ?? 0) * SP;
  const d = (a.lastDepth ?? 0) * SP, h = (b.firstHeight ?? 0) * SP;
  let interline = bls - d - h;
  if (interline < lsl) interline = ls;
  return { explicitPt: explicit / SP, interlinePt: interline / SP, totalPt: (all + interline) / SP };
}
