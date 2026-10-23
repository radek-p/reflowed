// Discretionaries for 8-bit (TFM) words. TeX inserts its discretionaries only in
// line_break's second pass, after the capture has written the paragraph; for a native word the engine
// writes its hyphenation points ("hy") and convert.ts's nativeWord makes the discretionaries. For an
// 8-bit word (a T1/OT1 document: most papers written for pdfLaTeX) the engine (patch 0011) writes the
// points of a run of character nodes, ligatures and font kerns on the run's first node: indices of the
// letters (a ligature's original characters count one each, from the run's first letter) a hyphen may
// go before. Here the run's converted nodes (one per engine node) get a discretionary at each point,
// as LuaTeX would have them:
//   - between two nodes: pre = the font's hyphen character; a font kern there goes into replace (it is
//     not there when the line breaks);
//   - inside a ligature ("dif|fi|cult"): pre = the letters before the point and the hyphen, post = the
//     letters after it (as single characters: TeX would ligature them again, "fi"; we do not have the
//     font's ligature program here), each with its own source column, replace = the ligature.
// The hyphen's source position is the break point (the letter after it, length 0), as for native words.
type J = Record<string, any>;

export interface TfmHyphContext {
  /** a glyph node of font `f` for character `c` (convert.ts tfmGlyph) */
  glyph(f: number, c: number): J;
  /** the font's \hyphenchar, or -1 */
  hyphenchar(f: number): number;
}

/** letters each engine node stands for: a character 1, a ligature its originals, a kern 0 */
const lettersOf = (n: J): number => (n.t === 'c' ? 1 : n.t === 'L' ? (n.o?.length || 1) : 0);

/** the engine nodes of the run that starts at list[i] (character nodes, ligatures, font kerns in one font) */
export function tfmRunEnd(list: J[], i: number): number {
  const f = list[i].f;
  let j = i;
  while (j < list.length && ((list[j].t === 'c' || list[j].t === 'L') ? list[j].f === f : list[j].t === 'k' && !list[j].sub && !list[j].it)) j++;
  return j;
}

/** LuaTeX leaves a compound's parts alone: no points in a word next to an explicit hyphen (XeTeX's empty discretionary) */
export function tfmMayHyphenate(list: J[], start: number, end: number): boolean {
  const emptyDisc = (m: J | undefined) => m?.t === 'd' && !m.pre?.length && !m.post?.length && !m.rc;
  return !emptyDisc(list[start - 1]) && !emptyDisc(list[end]);
}

/** The run's converted nodes (`conv[k]` made from `run[k]`) with discretionaries at the points. */
export function tfmDiscretionaries(run: J[], conv: J[], points: number[], ctx: TfmHyphContext): J[] {
  if (conv.length !== run.length) return conv;
  const f = run[0].f;
  const hc = ctx.hyphenchar(f);
  if (hc < 0 || hc > 255) return conv;
  const hyphenAt = (src: number[] | undefined): J => {
    const h = ctx.glyph(f, hc);
    if (src) h.src = [src[0], src[1], src[2], 0, src[4]];      // the break point: no source of its own
    return h;
  };
  const out: J[] = [];
  let k = 0, letters = 0;                 // run[k] starts at letter `letters`
  const advance = () => { out.push(conv[k]); letters += lettersOf(run[k]); k++; };
  for (const p of [...points].sort((a, b) => a - b)) {
    // nodes wholly before the point
    while (k < run.length && letters + lettersOf(run[k]) <= p && !(lettersOf(run[k]) > 0 && letters === p)) advance();
    if (k >= run.length) break;
    if (letters === p) {
      // between nodes: a font kern just before the point belongs to the unbroken text
      const replace: J[] = [];
      if (out.length && out[out.length - 1].type === 'kern') replace.push(out.pop()!);
      out.push({ type: 'disc', subtype: 3, pre: [hyphenAt(conv[k].src)], post: [], replace });
      continue;
    }
    // inside a ligature
    const n = run[k], g = conv[k];
    if (n.t !== 'L' || !n.o?.length) { advance(); continue; }
    const cut = p - letters;
    // each piece its own character (a ligature's characters are consecutive in the source); a macro's
    // ligature (via): the call's position for each
    const pieces = (cs: number[], from: number) => cs.map((c, i) => {
      const x = ctx.glyph(f, c);
      if (g.src) x.src = g.src[4] ? g.src : [g.src[0], g.src[1], g.src[2] + from + i, 1, 0];
      return x;
    });
    const right = pieces(n.o.slice(cut), cut);
    out.push({ type: 'disc', subtype: 3, pre: [...pieces(n.o.slice(0, cut), 0), hyphenAt(right[0]?.src ?? g.src)], post: right, replace: [g] });
    letters += lettersOf(n); k++;
  }
  while (k < run.length) advance();
  return out;
}
