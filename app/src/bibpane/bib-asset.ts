// Which of a document's .bib assets is its bibliography: the first one the source names with \bibliography{…} or
// \addbibresource{…} (preamble and body, comments ignored; a name with or without .bib), else the first .bib.
//
//   const a = bibAssetFor({ preamble, blocks, assets })     the asset, or null when there is no .bib
import { codeOf } from '../io/split.ts';

const NAMES = /\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const stem = (n: string) => n.trim().replace(/\.bib$/i, '');

/** the .bib names `source` gives \bibliography / \addbibresource, without .bib, in order */
export function bibNames(source: string): string[] {
  const code = source.split('\n').map(codeOf).join('\n');
  return [...code.matchAll(NAMES)].flatMap((m) => m[1].split(',').map(stem));
}

export function bibAssetFor<A extends { name: string }>(d: { preamble?: string; blocks?: Array<{ source: string }>; assets?: A[] }): A | null {
  const bibs = (d.assets ?? []).filter((a) => /\.bib$/i.test(a.name));
  const names = bibNames([d.preamble ?? '', ...(d.blocks ?? []).map((b) => b.source)].join('\n'));
  for (const n of names) { const a = bibs.find((x) => stem(x.name) === n); if (a) return a; }
  return bibs[0] ?? null;
}
