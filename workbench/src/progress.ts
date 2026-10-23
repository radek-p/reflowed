// The typesetting progress in the tab status: the fraction of a tab pill a run has filled.
//   p = (1 − ε₂) · [ k/n + (1/n) · (1 − ε) · z(t) ],   z(t) = 1 − 1/(1 + c·t)
// k of n blocks done, t seconds since k last changed. z is a Zeno-like creep for the block in flight (it cannot be
// tracked): 0 at the start, ½ at t = 1/c, approaching 1 and never reaching it. ε keeps that creep short of a whole block
// (a block only looks done when k says so), ε₂ keeps the whole bar short of the pill's end until the run is done (then
// the bar goes to 100 %, in the success colour, and fades: ui.js). Pure: no DOM; tests/progress.test.ts.

/** c: about the inverse of a block's median typesetting time, so a typical block shows half done at its median.
 *  An estimate: a block restores from the warm snapshot (12–100 ms in Chromium) and typesets and lays out in a few
 *  hundred ms more; median taken as 0.7 s. */
export const C = 1 / 0.7;
/** ε: the share of a block the creep never fills (with at least MIN_GAP_PX on the pill, see gapShare). */
export const EPS = 0.15;
/** ε₂: the share of the pill the unfinished bar never fills: 7 % (20 px on a 280 px pill, 10 px on 140 px). */
export const EPS2 = 0.07;
/** The least visible gap (px) the creep leaves before the next block's start. */
export const MIN_GAP_PX = 3;

/** The creep's share of a block left open: ε, or more so that the gap is at least MIN_GAP_PX on a pill `width` px wide. */
export function gapShare(n: number, width = 0): number {
  const block = width > 0 ? (width * (1 - EPS2)) / Math.max(1, n) : 0;
  return block > 0 ? Math.min(1, Math.max(EPS, MIN_GAP_PX / block)) : EPS;
}
/** p in [0, 1 − ε₂): the bar's length as a fraction of the pill. done = k, total = n, t in seconds; reduced: no creep. */
export function progress(done: number, total: number, t: number, { c = C, width = 0, reduced = false }: { c?: number; width?: number; reduced?: boolean } = {}): number {
  const n = Math.max(1, total | 0), k = Math.min(Math.max(0, done | 0), n);
  const z = reduced || k >= n ? 0 : 1 - 1 / (1 + c * Math.max(0, t));
  return (1 - EPS2) * (k / n + (1 / n) * (1 - gapShare(n, width)) * z);
}
