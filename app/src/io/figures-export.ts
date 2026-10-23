// Edited figures in an export. A figure edited in the figure editor
// carries `asset.rendition.tikz` and an updated Ipe `model.xml`, while its
// stored PDF is the old one. In the exported project only:
//   - `figures/x.pdf` stays as it was, and `figures/x.tikz` (the rendition)
//     and `figures/x.ipe` (the Ipe XML, to reopen in Ipe) are written next to it;
//   - `\includegraphics[…]{figures/x}` / `{figures/x.pdf}` in the blocks
//     becomes `\input{figures/x.tikz}` (the rendition has \includegraphics's
//     scale in it; width= / height= become a \resizebox around it);
//   - the preamble gets `\usepackage{tikz}` (and the packages the Ipe
//     preamble loads) when it does not load them already.
// Nothing changes when no figure was edited (exports stay byte for byte).

import type { AssetMeta } from '../store/types.ts';
import { codeOf } from './split.ts';

export interface EditedFigure { asset: AssetMeta; stem: string; tikzPath: string; ipePath: string | null; tikz: string; xml: string | null }

const stemOf = (name: string) => name.replace(/\.[A-Za-z0-9]+$/, '');

/** Assets with a TikZ rendition, by stem (path without extension). */
export function editedFigures(assets: AssetMeta[], opts: { flat?: boolean } = {}): Map<string, EditedFigure> {
  const out = new Map<string, EditedFigure>();
  for (const a of assets) {
    const tikz = a.rendition?.tikz;
    if (typeof tikz !== 'string' || !tikz.trim()) continue;
    const stem = stemOf(a.name);
    const xml = a.model?.kind === 'ipe' && a.model.xml ? a.model.xml : null;
    // flat (one-file export): filecontents* cannot write into a folder that does not exist
    const base = opts.flat ? stem.split('/').pop()! : stem;
    out.set(stem, { asset: a, stem, tikzPath: `${base}.tikz`, ipePath: xml ? `${base}.ipe` : null, tikz, xml });
  }
  return out;
}

const INCLUDE_RE = /\\includegraphics\*?\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g;

/** `\includegraphics` of an edited figure → `\input{….tikz}`, outside comments. */
export function rewriteSource(source: string, figs: Map<string, EditedFigure>, used: Set<string>, pairs?: Array<[string, string]>): string {
  if (!figs.size || !source.includes('\\includegraphics')) return source;
  return source.split('\n').map((line) => {
    const code = codeOf(line);
    const rest = line.slice(code.length);
    const out = code.replace(INCLUDE_RE, (m, opts: string | undefined, target: string) => {
      const f = figs.get(stemOf(target.trim())) ?? figs.get(target.trim());
      if (!f) return m;
      used.add(f.stem);
      const input = `\\input{${f.tikzPath}}`;
      const kv = Object.fromEntries((opts ?? '').split(',').map((s) => s.split('=').map((x) => x.trim())).filter((p) => p[0]));
      const out = kv.width ? `\\resizebox{${kv.width}}{!}{${input}}` : kv.height ? `\\resizebox{!}{${kv.height}}{${input}}` : input;
      pairs?.push([out, m]);
      return out;
    });
    return out + rest;
  }).join('\n');
}

const loaded = (preamble: string, pkg: string) =>
  preamble.split('\n').map(codeOf).some((l) => new RegExp(`\\\\(usepackage|RequirePackage)\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}`).test(l));

/** Lines to add to the preamble for the used edited figures. */
export function preambleAdditions(preamble: string, figs: EditedFigure[]): string[] {
  if (!figs.length) return [];
  const add: string[] = [];
  if (!loaded(preamble, 'tikz') && !loaded(preamble, 'pgf')) add.push('\\usepackage{tikz}');
  for (const f of figs) {
    const pre = f.xml ? /<preamble>([\s\S]*?)<\/preamble>/.exec(f.xml)?.[1] ?? '' : '';
    for (const m of pre.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').matchAll(/\\usepackage\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      for (const p of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
        const line = `\\usepackage${m[1] ?? ''}{${p}}`;
        if (!loaded(preamble, p) && !add.includes(line)) add.push(line);
      }
    }
  }
  return add;
}

export const ADDED_START = '%% rtx:added (export only: packages for the edited figures, which are TikZ)';
export const ADDED_END = '%% rtx:added-end';

/** The preamble with the additions after it (before \begin{document}), between
 *  marker comments so an import of the exported file can take them out again. */
export function withAdditions(preamble: string, add: string[]): string {
  if (!add.length) return preamble;
  const trail = /\s*$/.exec(preamble)![0];
  return `${preamble.slice(0, preamble.length - trail.length)}\n${ADDED_START}\n${add.join('\n')}\n${ADDED_END}${trail || '\n'}`;
}

/** Undo withAdditions (and a \documentclass line added the same way at the start). */
export function withoutAdditions(preamble: string): string {
  return preamble.replace(/^%% rtx:added[^\n]*\n[\s\S]*?%% rtx:added-end\n/, '').replace(/\n%% rtx:added[^\n]*\n[\s\S]*?%% rtx:added-end/g, '');
}
