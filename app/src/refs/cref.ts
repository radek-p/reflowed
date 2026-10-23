// What \cref / \Cref / \autoref print, from what TeX recorded with each label
// (rtx-numbering.sty: cleveref's type "k", its names "n" = [cref, cref
// plural, Cref, Cref plural], samples of \cref@<type>@format ("fc"), of
// \Cref@<type>@format ("fC") and of the label format ("lf"), each with the
// number as \rtx@N) and the number the overlay computed.
//
// Several labels (\cref{a,b,c}) follow cleveref's defaults: grouped by
// type in order of first appearance, sorted within a group, runs of three or
// more consecutive numbers compressed to a range; conjunctions " and ", ", ",
// " and ", " to ", between groups " and ", ", ", ", and ". A custom
// \crefmultiformat or conjunction is not read.
import { texToText } from './tex-text.ts';

export interface CrefData { k?: string; n?: [string, string, string, string]; fc?: string; fC?: string; lf?: string }
export interface LabelInfo {
  label: string;
  number: string;          // "3.2", "A", "⋆"
  name: string;            // the head or counter's name ("Lemma", "Section"), for \autoref
  counter: string;         // the counter it was numbered by ('' if TeX's own value)
  value: number;           // the counter's value (for ranges), 0 if unknown
  prefix: string;          // the parent's number (ranges need the same prefix)
  blockId: string | null;
  cref: CrefData;
}

const NB = ' ';
const CONJ = { pair: ` and${NB}`, middle: ', ', last: ` and${NB}`, range: ` to${NB}`,
  pairGroup: ` and${NB}`, middleGroup: ', ', lastGroup: `, and${NB}` };

const label1 = (l: LabelInfo): string => (l.cref.lf ? texToText(l.cref.lf, l.number) : l.number);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** cleveref knows the label's type but has no name for it: it prints "??" (and warns). */
const unnamed = (l: LabelInfo) => !!l.cref.k && !(l.cref.n ?? []).some(Boolean) && !l.cref.fc && !l.cref.fC;

function names(l: LabelInfo, upper: boolean): [string, string] {
  if (unnamed(l)) return ['??', '??'];
  const n = l.cref.n;
  const [s, p] = upper ? [n?.[2], n?.[3]] : [n?.[0], n?.[1]];
  const sing = s ? texToText(s) : (upper ? cap(l.name) : l.name.toLowerCase());
  const plur = p ? texToText(p) : `${sing}s`;
  return [sing, plur];
}

/** One label as \cref (upper false) or \Cref (upper true) prints it. */
export function crefOne(l: LabelInfo, upper: boolean): string {
  const sample = upper ? l.cref.fC : l.cref.fc;
  if (sample) return texToText(sample, l.number).replace(/\s+$/, '');
  return `${names(l, upper)[0]}${NB}${label1(l)}`;
}

/** \cref / \Cref of a list of labels; `get` resolves a label (undefined: "??"). */
export function crefText(labels: string[], upper: boolean, get: (l: string) => LabelInfo | undefined): string {
  if (labels.length === 1) {
    const l = get(labels[0]);
    return l ? crefOne(l, upper) : '??';
  }
  const infos = labels.map((x) => get(x));
  if (infos.some((x) => !x)) return infos.map((x, i) => (x ? crefOne(x, upper && i === 0) : '??')).join(', ');
  // groups by type, in order of first appearance
  const groups: LabelInfo[][] = [];
  const byType = new Map<string, LabelInfo[]>();
  for (const l of infos as LabelInfo[]) {
    const t = l.cref.k || l.counter || l.name;
    if (!byType.has(t)) { byType.set(t, []); groups.push(byType.get(t)!); }
    byType.get(t)!.push(l);
  }
  const texts = groups.map((g, gi) => {
    const up = upper && gi === 0;
    if (g.length === 1) return crefOne(g[0], up);
    const sorted = [...g].sort((a, b) => (a.prefix === b.prefix ? a.value - b.value : a.prefix.localeCompare(b.prefix, undefined, { numeric: true })));
    // runs of consecutive numbers
    const runs: LabelInfo[][] = [];
    for (const l of sorted) {
      const r = runs[runs.length - 1];
      const prev = r?.[r.length - 1];
      if (prev && prev.value > 0 && l.prefix === prev.prefix && l.value === prev.value + 1) r.push(l); else runs.push([l]);
    }
    const parts: string[] = [];
    for (const r of runs) {
      if (r.length >= 3) parts.push(`${label1(r[0])}${CONJ.range}${label1(r[r.length - 1])}`);
      else for (const l of r) parts.push(label1(l));
    }
    const [sing, plur] = names(g[0], up);
    if (parts.length === 1) return `${runs.length === 1 && runs[0].length >= 3 ? plur : sing}${NB}${parts[0]}`;
    const list = parts.length === 2 ? parts.join(CONJ.pair)
      : `${parts.slice(0, -1).join(CONJ.middle)}${CONJ.last}${parts[parts.length - 1]}`;
    return `${plur}${NB}${list}`;
  });
  if (texts.length === 1) return texts[0];
  if (texts.length === 2) return texts.join(CONJ.pairGroup);
  return `${texts.slice(0, -1).join(CONJ.middleGroup)}${CONJ.lastGroup}${texts[texts.length - 1]}`;
}

/** \autoref: "Name number" (hyperref's names are not read; the head is used). */
export function autorefText(l: LabelInfo | undefined): string {
  return l ? `${cap(l.name)}${NB}${l.number}` : '??';
}
