// Sampled runs of the exhaustive suites (the standard tier): --sample N takes N items spread evenly over
// the whole list (the first and the last among them), so a sample covers the whole paper, not just its start.
//   const SAMPLE = sampleArg(process.argv);     // null: every item (the full tier)
//   for (const id of spread(ids, SAMPLE)) …
export function sampleArg(argv: string[]): number | null {
  const i = argv.indexOf('--sample');
  if (i < 0) return null;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--sample ${argv[i + 1]}: a whole number of items, at least 1`);
  return n;
}
/** n items of xs, evenly spaced, in order, the first and the last included; all of them when n is null or ≥ the length.
 *  keep: items always in the sample (a reported case) */
export function spread<T>(xs: T[], n: number | null, keep: (x: T) => boolean = () => false): T[] {
  if (n == null || n >= xs.length) return xs.slice();
  const pick = new Set<number>();
  if (n === 1) pick.add(0);
  else for (let j = 0; j < n; j++) pick.add(Math.round((j * (xs.length - 1)) / (n - 1)));
  xs.forEach((x, i) => { if (keep(x)) pick.add(i); });
  return [...pick].sort((a, b) => a - b).map((i) => xs[i]);
}
