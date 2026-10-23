// svgfig import: an exported project back into an editable figure. The export
// (io/figures-export.ts) wrote figures/x.svg (the figure) and figures/x.tikz
// (its rendition), and put \input{figures/x.tikz} (or a \resizebox around it)
// where \includegraphics{figures/x.svg} was. The rendition's header keeps that
// \includegraphics as it was written (tikz.js), so an import puts it back and
// the figure is an SVG figure again, its rendition kept for the next export.
// The preamble lines the export added for TikZ (between the rtx:added
// markers) go too.

import { isFigureSvg } from './asset.js';
import { INCLUDE_TAG } from './tikz.js';
import { withoutAdditions } from '../io/figures-export.ts';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** entries: [{ path, data }]. Returns { entries, renditions: Map<svg path, { tikz, hash }> }. */
export function restoreSvgFigures(entries) {
  const dec = new TextDecoder(), enc = new TextEncoder();
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const figs = [];
  for (const e of entries) {
    if (!/\.svg$/i.test(e.path)) continue;
    const t = e.path.replace(/\.svg$/i, '.tikz');
    const te = byPath.get(t);
    if (!te) continue;
    const tikz = dec.decode(te.data);
    const include = new RegExp(`^% ${esc(INCLUDE_TAG)} (.*)$`, 'm').exec(tikz)?.[1];
    if (!include || !isFigureSvg(dec.decode(e.data))) continue;
    figs.push({ svg: e.path, tikzPath: t, tikz, include });
  }
  const renditions = new Map();
  if (!figs.length) return { entries, renditions };
  const drop = new Set();
  const out = entries.map((e) => {
    if (!/\.(tex|ltx)$/i.test(e.path)) return e;
    let text = dec.decode(e.data);
    const before = text;
    for (const f of figs) {
      // the export's forms: \input{p}, \resizebox{w}{!}{\input{p}}, \resizebox{!}{h}{\input{p}} (p as the file names it, with or without the folder)
      const names = [f.tikzPath, f.tikzPath.split('/').pop()].map(esc).join('|');
      const re = new RegExp(`\\\\resizebox\\{[^{}]*\\}\\{[^{}]*\\}\\{\\\\input\\{(?:${names})\\}\\}|\\\\input\\{(?:${names})\\}`, 'g');
      text = text.replace(re, () => { drop.add(f.tikzPath); return f.include; });
    }
    return text === before ? e : { ...e, data: enc.encode(text), text };
  }).map((e) => {
    // the preamble's TikZ lines the export added (in main.tex, not where the figure was)
    if (!drop.size || !/\.(tex|ltx)$/i.test(e.path)) return e;
    const text = e.text ?? dec.decode(e.data);
    if (!text.includes('%% rtx:added')) return e;
    return { ...e, data: enc.encode(withoutAdditions(text)) };
  }).map(({ text: _t, ...e }) => e);
  for (const f of figs) if (drop.has(f.tikzPath)) renditions.set(f.svg, { tikz: f.tikz, hash: hashOf(f.tikz) });
  return { entries: out.filter((e) => !drop.has(e.path)), renditions };
}

function hashOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
