// What the worker and the Node tests share: the host document for a
// preamble (prelude + preamble adapter), a block as rtx-block.tex (with its
// context prefix), TeX's problems put back on the block's own lines, and the
// capture (engine-api's convert.ts) of a finished run.
import { parseLog } from './texlog.js';
// engine-api's converter with attrs patch (scripts/convert-src.ts makes the copy)
import { convert } from '../build/engine-api-src/convert.ts';
import { buildSourceMap, type SourceMap } from '../build/engine-api-src/sourcemap.ts';
import { applySlots } from '../slots/convert-slots.ts';
import { hostDocument, type WarmEngine } from './engine.ts';
import { adaptPreamble } from './adapter.ts';
import { markPictures, pictureMaker } from './pictures.ts';
import { postConvert } from './postconvert.ts';
import type { DisplayStats, Resample } from './displays.ts';

export interface Problem { severity: 'error' | 'warning'; message: string; line: number | null; context?: string | null; detail?: string; endLine?: number | null }

const CLASS_RE = /^[ \t]*\\documentclass\b/;
/** What the capture needs after \documentclass (engine-api's DEFAULT_PRELUDE:
 *  the LuaTeX template's packages, then rtx-template.sty as tectonic-capture). */
export const CAPTURE_PRELUDE = '\\usepackage{mathtools}\\usepackage{amssymb}\\usepackage{tectonic-capture}\\usepackage{rtx-pictures}\\usepackage{rtx-xetex}';

export interface Host {
  /** input.tex: the preamble with the prelude after \documentclass, \begin{document}, rtx-block.tex */
  main: string;
  /** TeX line (1-based) of the author's preamble line i+1 */
  preLine: number[];
  /** what the adapter changed, for the report and Document settings */
  adapted: string[];
}

/** The host document for a preamble. `prelude` goes after \documentclass (one
 *  line); a preamble without a class gets article. */
export function buildHost(preamble: string, o: { prelude?: string; adapt?: boolean; preload?: string } = {}): Host {
  const { text, notes, before } = o.adapt === false ? { text: preamble, notes: [] as string[], before: '' } : adaptPreamble(preamble);
  const prelude = [before, o.prelude ?? CAPTURE_PRELUDE].filter(Boolean).join('');
  const pre = text.split('\n');
  const lines: string[] = [];
  const preLine: number[] = [];
  const c = pre.findIndex((l) => CLASS_RE.test(l));
  if (c < 0) lines.push('\\documentclass{article}', prelude);
  pre.forEach((l, i) => {
    lines.push(l);
    preLine.push(lines.length);
    if (i === c) lines.push(prelude);
  });
  const main = hostDocument(lines.join('\n'), o.preload ?? '');
  return { main, preLine, adapted: notes };
}

/** The host with the whole body in place of the block (a print compile). A function replacement, so a
 *  body holding `$&`, `$'` or `$<` (a table cell's `$x$&$y$`) is not read as a replacement pattern. */
export function withBody(main: string, body: string): string {
  return main.replace('\\csname @@input\\endcsname rtx-block.tex ', () => `${body}\n`);
}

/** The block as rtx-block.tex: the context prefix (refs.contextFor), then the source. */
export function blockFile(source: string, context = ''): { text: string; firstLine: number; lines: number } {
  const ctx = context ? context.replace(/\n?$/, '\n') : '';
  const firstLine = ctx ? ctx.split('\n').length : 1;
  // the block-end marker (spacing.ts): after it only \\end{document}'s material
  return { text: ctx + source + '\n\\par\\special{rtx:blockend}\n', firstLine, lines: source.split('\n').length };
}

/**
 * TeX's problems of a block run, on the block's own lines. `log` is the part
 * of the log after the warm pause (the block's own). Lines named by `l.<n>`
 * inside rtx-block.tex are the block file's; the host's `\end{document}` line
 * (an environment left open) has no block line.
 */
export function blockProblems(log: string, firstLine: number, lines: number): { errors: Problem[]; warnings: Problem[]; other: Problem[] } {
  const errors: Problem[] = [], warnings: Problem[] = [], other: Problem[] = [];
  for (const p of parseLog(log) as Problem[]) {
    if ((p.severity as string) === 'info') continue;
    const host = p.context != null && /rtx-block\.tex \\end\{document\}|^\\end\{document\}/.test(String(p.context).replace(/^l\.\d+ /, ''));
    const n = p.line;
    if (!host && n != null && n >= firstLine && n < firstLine + lines) {
      const q = { ...p, line: n - firstLine + 1, endLine: p.endLine != null ? p.endLine - firstLine + 1 : null };
      (p.severity === 'error' ? errors : warnings).push(q);
    } else if (p.severity === 'error') {
      // an error outside the block's lines (a package's file, \end{document}): the block's, lineless
      errors.push({ ...p, line: null });
    } else other.push({ ...p, line: null });
  }
  return { errors, warnings, other };
}

/** The preamble's problems (the warm run's log), on the author's preamble lines. */
export function preambleProblems(log: string, host: Host): { errors: Problem[]; warnings: Problem[] } {
  const errors: Problem[] = [], warnings: Problem[] = [];
  for (const p of parseLog(log) as Problem[]) {
    if ((p.severity as string) === 'info') continue;
    const i = p.line == null ? -1 : host.preLine.indexOf(p.line);
    const q = { ...p, line: i >= 0 ? i + 1 : null };
    (p.severity === 'error' ? errors : warnings).push(q);
  }
  return { errors, warnings };
}

export interface Captured { output: any; json: string; displays: DisplayStats; fidelity?: { ligatures?: unknown; footnotes?: unknown }; sourcemap: SourceMap; stream: string; ms: number;
  /** TikZ pictures of the run: id → SVG (null when it could not be built) */
  tikz: (id: number, w: number, h: number, d: number) => string | null }

/** output.json of the run that just ended (input.rtxc.jsonl in the engine's files). */
export function capture(e: WarmEngine, readFile: (n: string) => Uint8Array | null, job = 'input', o: { resample?: Resample } = {}): Captured {
  const t0 = performance.now();
  const stream = e.file(`${job}.rtxc.jsonl`);
  if (!stream) throw new Error(`capture: no ${job}.rtxc.jsonl`);
  const pics = markPictures(new TextDecoder().decode(stream));
  const text = pics.stream;
  const maker = pics.ids.length ? pictureMaker(e.file(`${job}.xdv`), (n) => e.file(n) ?? readFile(n)) : null;
  const output = convert({ stream: text, readFile: (n) => e.file(n) ?? readFile(n), hyphenation: 'luatex', attrs: true });
  // the notes rtx-xetex.sty wrote and the attribute stamps → links, anchors, slots, marks, streams, outline
  applySlots(output, { lua: e.file(`${job}.rtxlua`) ? e.text(`${job}.rtxlua`) : null, aux: e.file(`${job}.aux`) ? e.text(`${job}.aux`) : null });
  // pass (src/postconvert.ts): displays at the reader's width, capture fidelity fixes
  const { displays, ligatures, footnotes } = postConvert(output, { stream: text, readFile: (n) => e.file(n) ?? readFile(n), resample: o.resample }) as any;
  const json = JSON.stringify(output);
  const sourcemap = buildSourceMap(output);
  return { output, json, displays, fidelity: { ligatures, footnotes }, sourcemap, stream: text, ms: performance.now() - t0, tikz: (id, w, h, d) => maker?.svg(id, w, h, d) ?? null };
}

/** A file TeX could not find, named with the package it belongs to and why
 *  (the editor's embedded TeX set does not have it). Rewrites the problems'
 *  messages in place: `! LaTeX Error: File `lipics-v2021.cls' not found.` →
 *  `… not found: the class lipics-v2021 is not in the editor's embedded TeX set`. `more(name)` says where else
 *  it was looked for (the TeX resource server: `…, and it is not on the TeX resource server either`). */
export function nameMissing<T extends Problem>(problems: T[], has: (name: string) => boolean, more: (name: string) => string = () => ''): T[] {
  const kind = (f: string) => (/\.cls$/.test(f) ? 'class' : /\.sty$/.test(f) ? 'package' : /\.(bbx|cbx|lbx)$/.test(f) ? 'biblatex style' : /\.(tfm|pfb|otf|ttf)$/.test(f) ? 'font' : 'file');
  for (const p of problems) {
    const m = /File [`']([^`']+)' not found/.exec(p.message);
    const font = /Font \\\S+=([^\s:]+)[^]*not loadable/.exec(p.message) ?? /The font "([^"]+)" cannot be found/.exec(p.message);
    const file = m?.[1] ?? (font ? font[1] : null);
    if (!file || /embedded TeX set/.test(p.message)) continue;
    const name = /\./.test(file) || font ? file : `${file}.sty`;
    if (has(name) || (font && has(`${name}.tfm`))) continue;
    const k = font ? 'font' : kind(name);
    p.message = `${p.message.replace(/\.+$/, '')}: the ${k} ${k === 'font' || k === 'file' ? name : name.replace(/\.[^.]+$/, '')} is not in the editor's embedded TeX set`;
    const also = more(name);
    if (also) p.message += `, and ${also}`;
  }
  return problems;
}
