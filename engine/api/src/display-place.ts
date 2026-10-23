// Route 1 for primitive displays ($$…$$, \[…\], amsmath's equation with its
// \eqno tag): TeX's own placement (TeX §1199–§1205, after_math) evaluated at
// any \displaywidth, from what the capture recorded – the formula's list
// with its glue specs, the equation number, \leqno, the math quad. Exact at
// every width, including the regime changes (squeezing, the number moving to
// a line of its own) that the sampled model needs extra compilations to find.
// No Node APIs: this is what a viewer would run.
//
// Items are in reflowtex's output.json shape (LuaTeX's numbered-display
// form: a box spanning the band, [lead kern, formula, kern, number]).

type J = Record<string, any>;

export interface Placement {
  formula: J;           // the formula's hlist, glue specs intact
  eqno: J | null;       // the number's hlist
  leqno: boolean;
  mathquad: number;     // math_quad(text size)
  hfuzz?: number;       // \hfuzz and \overfullrule: TeX marks an overfull box with a rule
  overfullrule?: number;
  indent: number;       // \displayindent
}

const RUNNING = -1073741824;
// TeX's glue orders from LuaTeX's numbering (0 normal, 2 fil, 3 fill, 4 filll)
const texOrder = (o: number | undefined) => (!o ? 0 : o - 1);

/** Natural width and total stretch/shrink per order of a list (hpack's sums). */
export function hsums(nodes: J[]): { w: number; stretch: number[]; shrink: number[] } {
  const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0];
  let w = 0;
  for (const n of nodes) {
    switch (n.type) {
      case 'glyph': case 'hlist': case 'vlist': case 'picture': w += n.width; break;
      case 'rule': if (n.width !== RUNNING) w += n.width; break;
      case 'glue': w += n.width; stretch[texOrder(n.stretch_order)] += n.stretch ?? 0; shrink[texOrder(n.shrink_order)] += n.shrink ?? 0; break;
      case 'kern': w += n.kern; break;
      case 'math': w += n.surround ?? 0; break;
      case 'disc': for (const r of n.replace ?? []) w += r.width ?? r.kern ?? 0; break;
      case 'transform': for (const c of n.children ?? []) w += c.width ?? 0; break;
    }
  }
  return { w, stretch, shrink };
}

/** hpack(p, target, EXACTLY): the box's glue setting (TeX §657–§665). */
export function hpackTo(box: J, target: number, hfuzz = 0, overfullrule = 0): J {
  const { w, stretch, shrink } = hsums(box.children);
  const out = { ...box, width: target, glue_set: 0, glue_sign: 0, glue_order: 0 };
  const x = target - w;
  if (x > 0) {
    const o = stretch[3] ? 3 : stretch[2] ? 2 : stretch[1] ? 1 : 0;
    if (stretch[o]) { out.glue_sign = 1; out.glue_order = o ? o + 1 : 0; out.glue_set = x / stretch[o]; }
  } else if (x < 0) {
    // TeX §664–§667
    const o = shrink[3] ? 3 : shrink[2] ? 2 : shrink[1] ? 1 : 0;
    if (shrink[o]) { out.glue_sign = 2; out.glue_order = o ? o + 1 : 0; out.glue_set = -x / shrink[o]; }
    if (shrink[o] < -x && o === 0 && box.children.length) {
      out.glue_set = 1;                                      // overfull: the most it shrinks
      if (overfullrule > 0 && -x - shrink[0] > hfuzz)         // and TeX says so with a rule
        out.children = [...out.children, { type: 'rule', width: overfullrule, height: RUNNING, depth: RUNNING }];
    }
  }
  return out;
}

const half = (x: number) => (x & 1 ? Math.floor((x + 1) / 2) : x / 2);

/** The display items TeX would append at \displaywidth z (one, or two when
 *  the number goes to a line of its own). */
export function placeDisplay(pl: Placement, z: number): J[] {
  const p = pl.formula.children as J[];
  const nat = hsums(p);
  let b = { ...pl.formula, width: nat.w, glue_set: 0, glue_sign: 0, glue_order: 0 };
  let w = nat.w;
  const s = pl.indent;
  let e = pl.eqno ? pl.eqno.width : 0;
  const q = pl.eqno ? e + pl.mathquad : 0;
  if (w + q > z) {
    const infShrink = nat.shrink[1] || nat.shrink[2] || nat.shrink[3];
    if (e !== 0 && (w - nat.shrink[0] + q <= z || infShrink)) b = hpackTo(pl.formula, z - q, pl.hfuzz, pl.overfullrule);
    else {
      e = 0;
      if (w > z) b = hpackTo(pl.formula, z, pl.hfuzz, pl.overfullrule);
    }
    w = b.width;
  }
  let d = half(z - w);
  if (e > 0 && d < 2 * e) {
    d = half(z - w - e);
    if (p.length && p[0].type === 'glue') d = 0;
  }
  const item = (box: J, shift: number): J => ({ kind: 'display', display_width: z, display_indent: s, display_shift: shift, box });
  const out: J[] = [];
  if (pl.eqno && e === 0 && pl.leqno) out.push(item({ ...pl.eqno, subtype: 7 }, s));
  if (e !== 0) {
    const k = z - w - e - d;
    // LuaTeX's shape: the box spans the band
    const children = pl.leqno
      ? [{ ...pl.eqno!, subtype: 7 }, { type: 'kern', kern: k, subtype: 0 }, { ...b, subtype: 6 }]
      : [{ type: 'kern', kern: d, subtype: 0 }, { ...b, subtype: 6 }, { type: 'kern', kern: k, subtype: 0 }, { ...pl.eqno!, subtype: 7 }];
    const lead = pl.leqno ? 0 : d;
    const width = pl.leqno ? e + k + w : lead + w + k + e;
    out.push(item({ ...pl.formula, type: 'hlist', subtype: 6, width, height: Math.max(b.height, pl.eqno!.height),
      depth: Math.max(b.depth, pl.eqno!.depth), glue_set: 0, glue_sign: 0, glue_order: 0, children }, s));
  } else out.push(item({ ...b, subtype: 6 }, s + d));
  if (pl.eqno && e === 0 && !pl.leqno) out.push(item({ ...pl.eqno, subtype: 7 }, s + z - pl.eqno.width));
  return out;
}

/** The placement inputs of a captured primitive display, from its items (one,
 *  or two when the number sat on a line of its own), or null (an alignment,
 *  or a shape this does not know). convert.ts puts `display_place`
 *  ({ mathquad, leqno, eqno, separate }) on the first item. */
export function placementOf(items: J[]): Placement | null {
  const pl = items[0]?.display_place;
  if (!pl) return null;
  let formula: J | null = null, eqno: J | null = null;
  if (pl.eqno && pl.separate) {
    if (items.length !== 2) return null;
    formula = pl.leqno ? items[1].box : items[0].box;
    eqno = pl.leqno ? items[0].box : items[1].box;
  } else if (pl.eqno) {
    const k = items[0].box.children as J[];
    formula = k.find(c => c.subtype === 6) ?? null;
    eqno = k.find(c => c.subtype === 7) ?? null;
    if (!formula || !eqno) return null;
  } else formula = items[0].box;
  // an overfull rule TeX added at this width is not part of the formula
  const k = formula!.children as J[];
  const last = k[k.length - 1];
  if (last?.type === 'rule' && last.height === RUNNING && last.width === pl.overfullrule) formula = { ...formula, children: k.slice(0, -1) };
  return { formula, eqno, leqno: !!pl.leqno, mathquad: pl.mathquad, hfuzz: pl.hfuzz, overfullrule: pl.overfullrule, indent: items[0].display_indent };
}
