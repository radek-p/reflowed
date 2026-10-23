// V3: displays at the reader's width, from one compilation where TeX's own
// rule is known, from two more runs of the block where it is not.
//
// Route 1 (primitive displays: $$…$$, \[…\], amsmath's equation/equation*
// with its \eqno tag, a number on the formula's line): engine-api's
// display-place.ts evaluates TeX's placement (§1199–§1205) from the inputs
// the capture recorded, at two more widths, and the three placements become
// the affine model the public viewer already evaluates (display-model.ts
// attachModel: *_rate fields and floors on the item and its box). The viewer
// then puts the display at the reader's measure: centred in the column, the
// number flush with the column's right edge (its placeEquationNumber redoes
// TeX's number rule at the evaluated width).
//
// Route 2 (everything else: amsmath's align/gather/multline/flalign/alignat,
// whose geometry is macro arithmetic on \displaywidth; a number on a line of
// its own; a box set to \hsize outside a paragraph): the block compiled again
// with the measure SAMPLE_DELTAS wider (`resample`, a callback the worker
// gives: fidelity/resample.ts), the same display found in each sample by its
// capture id and row, and the three trees go to the same attachModel when
// they have one topology and are affine in the width (checkSamples). This is
// the public pipeline's own sampled model (three LuaTeX compilations), per
// block. Both sample widths are wider than the compile width: narrower
// measures come from the model's floors (the viewer freezes a display at
// its narrowest law-abiding width and scrolls; a regime change TeX would
// make below the compile width – amsmath moving the tags to their own lines
import { placeDisplay, placementOf } from '../build/engine-api-src/display-place.ts';
import { attachModel, attachParagraphRates, checkSamples, topologyError } from '../build/engine-api-src/rtx/pipeline/display-model.ts';

type J = Record<string, any>;
const PT = 65536;
/** The two extra widths (sp over the compile width): wider, as the model's
 *  samples; narrower measures come from the floors. */
export const SAMPLE_DELTAS = [24 * PT, 48 * PT];

/** The block's output.json compiled `deltaSp` wider (fidelity/resample.ts), or null. */
export type Resample = (deltaSp: number) => J | null;

const GEOMETRY = ['display_width', 'display_indent', 'display_shift'];

export interface DisplayStats {
  displays: number; modelled: number;
  /** of `modelled`: by route 1, by the samples */
  route1?: number; sampled?: number;
  /** block runs made for samples (0 or 2) */
  resampled?: number;
  /** paragraphs holding a box or rule set to the measure (a \textwidth rule, a
   *  \parbox{\linewidth}): how many, and how many got rates from the samples */
  wideParagraphs?: number; paragraphsModelled?: number;
  skipped: Record<string, number>;
}

const listsOf = (output: J): J[][] => [output.content ?? [], ...(output.streams ?? []).map((s: J) => s.content ?? [])];
const doc = (items: J[], w: number) => ({ source_width: w, content: items, streams: [], paragraphs: [], fonts: new Map() }) as any;

/** Route 1 on one item: 'modelled' or why not. */
function route1(item: J): string {
  const pl = item.display_place;
  if (!pl) return item.box?.subtype === 4 || item.display_align ? 'alignment' : 'no placement inputs';
  if (pl.separate) return 'number on its own line';
  const P = placementOf([item]);
  if (!P) return 'shape';
  const W = item.display_width as number;
  const at = (z: number) => { const r = placeDisplay(P, z); return r.length === 1 ? r[0] : null; };
  const a = at(W), b = at(W + SAMPLE_DELTAS[0]), c = at(W + SAMPLE_DELTAS[1]);
  if (!a || !b || !c) return 'regime';
  // route 1 must reproduce what TeX did at the compile width
  if (topologyError(item.box, a.box, 'box') || GEOMETRY.some((f) => Math.abs((a[f] ?? 0) - (item[f] ?? 0)) > 3)
    || Math.abs((a.box.width ?? 0) - (item.box.width ?? 0)) > 3) return 'route 1 differs at the compile width';
  if (topologyError(b.box, c.box, 'box') || topologyError(item.box, b.box, 'box')) return 'regime';
  attachModel(doc([item], W), doc([b], W + SAMPLE_DELTAS[0]), doc([c], W + SAMPLE_DELTAS[1]));
  item.display_route1 = true;
  return 'modelled';
}

/** A display's identity across runs of one block: its capture id and row
 *  (an alignment's rows share the id), or, for a box outside a paragraph
 *  (no id), its place among those. */
function keyed(output: J): Map<string, J> {
  const out = new Map<string, J>();
  listsOf(output).forEach((list, li) => {
    let fixed = 0;
    for (const it of list) {
      if (it?.kind !== 'display') continue;
      out.set(it.display_id != null ? `d${it.display_id}.${it.display_row ?? 0}` : `f${li}.${fixed++}`, it);
    }
  });
  return out;
}
const groupOf = (key: string) => key.replace(/\.\d+$/, (m) => (key[0] === 'd' ? '' : m));

/** Put the affine model on every display it can place. Mutates `output`. */
export function modelDisplays(output: J, resample?: Resample): DisplayStats {
  const stats: DisplayStats = { displays: 0, modelled: 0, route1: 0, sampled: 0, resampled: 0, skipped: {} };
  const skip = (why: string) => { stats.skipped[why] = (stats.skipped[why] ?? 0) + 1; };
  const left: [string, string][] = [];                    // [key, why route 1 did not]
  for (const [key, item] of keyed(output)) {
    stats.displays++;
    if (item.display_width_rate !== undefined) { skip('already modelled'); continue; }
    const why = route1(item);
    if (why === 'modelled') { stats.modelled++; stats.route1!++; } else left.push([key, why]);
  }
  const wide = wideParagraphs(output);
  stats.wideParagraphs = wide.length;
  if (!left.length && !wide.length) return stats;
  if (!resample) { for (const [, why] of left) skip(why); return stats; }

  // Route 2: two more runs of the block, wider
  const s1 = resample(SAMPLE_DELTAS[0]);
  const s2 = s1 ? resample(SAMPLE_DELTAS[1]) : null;
  const skipped = (resample as { info?: { skipped?: string } }).info?.skipped;
  stats.resampled = s2 ? 2 : s1 ? 1 : 0;
  if (!s1 || !s2) { for (const [, why] of left) skip(`${why} (no samples${skipped ? ': time budget' : ''})`); return stats; }
  if (wide.length) stats.paragraphsModelled = modelParagraphs(output, s1, s2, wide);
  const k1 = keyed(s1), k2 = keyed(s2);
  const here = keyed(output);
  // an alignment's rows are modelled together (one law for all its rows, or none)
  const groups = new Map<string, string[]>();
  for (const [key] of left) { const g = groupOf(key); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(key); }
  for (const [, keys] of groups) {
    const rows = keys.map((k) => here.get(k)!);
    const all = [...here.keys()].filter((k) => groupOf(k) === groupOf(keys[0]));
    const why = (() => {
      if (all.length !== keys.length) return 'part of the display already modelled';
      const r1 = keys.map((k) => k1.get(k)), r2 = keys.map((k) => k2.get(k));
      if (r1.some((x) => !x) || r2.some((x) => !x)) return 'not in the samples';
      if ([...k1.keys()].filter((k) => groupOf(k) === groupOf(keys[0])).length !== keys.length
        || [...k2.keys()].filter((k) => groupOf(k) === groupOf(keys[0])).length !== keys.length) return 'rows differ in the samples';
      const W = rows[0].display_width as number, W1 = r1[0]!.display_width as number, W2 = r2[0]!.display_width as number;
      if (!(W < W1 && W1 < W2)) return 'sample widths';
      const [ok, err] = checkSamples(doc(rows.map(bare), W), doc((r1 as J[]).map(bare), W1), doc((r2 as J[]).map(bare), W2));
      if (!ok) return /topology|identity|count|presence/.test(err ?? '') ? 'samples: another regime' : 'samples: not affine';
      attachModel(doc(rows, W), doc(r1 as J[], W1), doc(r2 as J[], W2));
      for (const it of rows) it.display_sampled = true;
      return 'modelled';
    })();
    if (why === 'modelled') { stats.modelled += keys.length; stats.sampled! += keys.length; } else for (const _ of keys) skip(why);
  }
  return stats;
}

/** A copy without source positions (not geometry; a sample's are shifted by its widening line). */
function bare(x: J): J {
  return JSON.parse(JSON.stringify(x, (k, v) => (k === 'src' ? undefined : v)));
}

/** Indices of paragraphs with a box, rule or picture (at any depth) at least
 *  half the measure wide: LIPIcs' \rlap{\vrule width\textwidth} under the
 *  Abstract and References headings, a \parbox{\linewidth}, a tabular*. */
export function wideParagraphs(output: J): number[] {
  const sw = Number(output.source_width ?? 0);
  if (!(sw > 0)) return [];
  const wide = (ns: J[] | undefined): boolean => (ns ?? []).some((n) =>
    ((n.type === 'rule' || n.type === 'hlist' || n.type === 'vlist' || n.type === 'picture') && (n.width ?? 0) >= 0.5 * sw && n.width !== -1073741824)
    || wide(n.children));
  const out: number[] = [];
  (output.paragraphs ?? []).forEach((p: J, i: number) => { if (wide(p.nodes)) out.push(i); });
  return out;
}

/** The public pipeline's paragraph rates (attachParagraphRates: one topology at
 *  the three widths, affine) on the paragraphs `which`, from the samples. The
 *  samples' paragraphs are matched by index; source positions are set aside
 *  for the check (the widening line moves them). Returns how many got rates. */
function modelParagraphs(output: J, s1: J, s2: J, which: number[]): number {
  const P = output.paragraphs ?? [], P1 = s1.paragraphs ?? [], P2 = s2.paragraphs ?? [];
  if (P.length !== P1.length || P1.length !== P2.length) return 0;
  const W = Number(output.source_width), W1 = Number(s1.source_width), W2 = Number(s2.source_width);
  if (!(W < W1 && W1 < W2)) return 0;
  let n = 0;
  for (const i of which) {
    const saved: [J, unknown][] = [];
    const hide = (x: unknown) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) { x.forEach(hide); return; } const o = x as J; if ('src' in o) { saved.push([o, o.src]); delete o.src; } for (const v of Object.values(o)) hide(v); };
    hide(P[i].nodes);
    try {
      const d = (p: J, w: number) => ({ source_width: w, content: [], streams: [], paragraphs: [p], fonts: new Map() }) as any;
      n += attachParagraphRates(d(P[i], W), d(P1[i], W1), d(P2[i], W2));
    } finally { for (const [o, v] of saved) o.src = v; }
  }
  return n;
}
