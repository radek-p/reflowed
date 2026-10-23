// \thanks in \maketitle (LaTeX: \footnotemark in the title, \footnotetext
// after it), or an author's own \footnotemark … \footnotetext — reaches the
// capture as a footnote stream with no mark pointing at it: the converter
// ties a mark to its stream only when the insertion follows the mark's box
// (a plain \footnote). The viewer shows a footnote from its mark, so the
// thanks (and a funding logo in it) were never seen.
//
// The mark is recoverable: the footnote's own text opens with the mark as
// \@makefntext set it (\@makefnmark: a box holding the symbol), and the
// flow holds a mark box with the same symbol and no stream. Each unmarked
// footnote, in order, takes the first such box of the main flow, in order.
type J = Record<string, any>;

const glyphText = (ns: J[] | undefined): string => (ns ?? []).map((n) => (n.type === 'glyph' ? String.fromCodePoint(n.char) : n.children ? glyphText(n.children) : '')).join('');
const glyphs = (ns: J[] | undefined, out: J[] = []): J[] => { for (const n of ns ?? []) { if (n.type === 'glyph') out.push(n); if (n.children) glyphs(n.children, out); } return out; };
/** A box made of boxes, glyphs, kerns and math only (no rules, no space: \rlap's \hss is 0pt): a mark's shape. */
const markish = (b: J): boolean => (b.children ?? []).every((c: J) => c.type === 'glyph' || c.type === 'kern' || c.type === 'math' || c.type === 'penalty' || c.type === 'whatsit'
  || (c.type === 'glue' && !(c.width > 0)) || ((c.type === 'hlist' || c.type === 'vlist') && markish(c)));

export interface FootnoteStats { unmarked: number; linked: number }

/** Point each unmarked footnote's mark in the flow at its stream. Mutates `output`. */
export function linkFootnoteMarks(output: J): FootnoteStats {
  const stats: FootnoteStats = { unmarked: 0, linked: 0 };
  const streams: J[] = output.streams ?? [];
  const paras: J[] = output.paragraphs ?? [];
  const para = (i: number) => paras[i - 1] ?? null;              // items name paragraphs 1-based
  const linked = new Set<number>();
  const all = [...paras.flatMap((p) => glyphs(p.nodes)), ...(output.content ?? []).flatMap((it: J) => (it.box ? glyphs([it.box]) : []))];
  for (const g of all) if (g.stream) linked.add(g.stream);
  // the unmarked footnotes and their marks (the first glyph box of their first paragraph)
  const want: { sid: number; mark: string }[] = [];
  streams.forEach((s, k) => {
    const sid = k + 1;
    if (s.kind !== 'footnote' || linked.has(sid)) return;
    const first = (s.content ?? []).find((it: J) => it.kind === 'paragraph');
    const nodes = first ? para(first.para)?.nodes : null;
    const box = (nodes ?? []).find((n: J) => (n.type === 'hlist' || n.type === 'vlist') && glyphs([n]).length > 0);
    const mark = box && markish(box) ? glyphText([box]).trim() : '';
    if (!mark || mark.length > 4) return;
    stats.unmarked++;
    want.push({ sid, mark });
  });
  if (!want.length) return stats;
  // candidate mark boxes in the main flow, in order: glyph-only boxes whose text is a mark, their glyphs in no stream
  const cands: { box: J; text: string; used?: boolean }[] = [];
  const scan = (ns: J[] | undefined) => {
    for (const n of ns ?? []) {
      if ((n.type === 'hlist' || n.type === 'vlist') && markish(n)) {
        const gs = glyphs([n]);
        if (gs.length && gs.every((g) => !g.stream)) { cands.push({ box: n, text: glyphText([n]).trim() }); continue; }
      }
      if (n.children) scan(n.children);
    }
  };
  for (const it of output.content ?? []) {
    if (it.kind === 'paragraph') scan(para(it.para)?.nodes);
    else if (it.box) scan([it.box]);
  }
  for (const w of want) {
    const c = cands.find((x) => !x.used && x.text === w.mark);
    if (!c) continue;
    c.used = true;
    for (const g of glyphs([c.box])) g.stream = w.sid;
    stats.linked++;
  }
  return stats;
}
