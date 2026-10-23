// the editor's engine (Tectonic's XeTeX, TeX Live 2022 bundle, pageless
// capture) and still look like the author's PDF. Each rule is small, named,
// and reported (notes) so Document settings can say what was changed.
// Nothing here rewrites the author's source in the store; it only shapes the
// host document the engine runs.

import { commentStart, stripComments } from './tex-comment.ts';

export interface Adapted {
  /** the preamble as run */
  text: string;
  /** lines put after \documentclass, before the capture prelude */
  before: string;
  /** one line per rule that fired */
  notes: string[];
}

export function adaptPreamble(preamble: string, o: { numbering?: boolean } = {}): Adapted {
  const notes: string[] = [];
  let before = '';
  let text = preamble;
  const uses = (pkg: string) => new RegExp(`\\\\usepackage(\\[[^\\]]*\\])?\\{[^}]*\\b${pkg}\\b[^}]*\\}`).test(stripComments(text));

  // todonotes: margin notes are not part of the flow; the editor shows
  // todos itself. `disable` keeps \todo, \missingfigure, \listoftodos
  // defined and typesets nothing.
  if (uses('todonotes')) {
    before += '\\PassOptionsToPackage{disable}{todonotes}';
    notes.push('todonotes: disabled in the engine (the editor lists the notes)');
  }
  // inputenc under XeTeX: LaTeX ignores it with a warning; nothing to do.
  // libertine / inconsolata: libertine.sty loads the OTFs by file name under
  // XeTeX (fontspec), which the engine's file lookup handles; inconsolata
  // has no TU shape (LaTeX falls back to Latin Modern Mono): reported only.
  if (uses('inconsolata')) notes.push('inconsolata: no TU font under XeTeX in TL2022, \\ttfamily falls back to Latin Modern Mono');
  text = publisherFinal(text, notes, (b) => { before += b; });
  // Numbering: the companion (reflowtex.sty) and rtx-numbering.sty after
  // the author's packages and before the first theorem declaration (its
  // \newtheorem/\declaretheorem hooks must see them), on that line so the
  // author's line numbers stay; at the end when nothing is declared. Needs
  // rtx-xetex.sty (the capture prelude loads it).
  if (o.numbering !== false) {
    const load = `${uses('reflowtex') ? '' : '\\usepackage{reflowtex}'}\\usepackage{rtx-numbering}`;
    const m = /^[ \t]*\\(?:declaretheorem|newtheorem)\b/m.exec(text);
    text = m ? text.slice(0, m.index) + load + text.slice(m.index) : `${text.replace(/\s*$/, '')}${load}\n`;
    notes.push(`numbering: reflowtex.sty and rtx-numbering.sty loaded ${m ? 'before the first theorem declaration' : 'after the preamble'}`);
  }
  // Captions: the capture sets figures and tables in the flow
  // (tectonic-capture.sty = engine-api's rtx-template.sty, as reflowtex's
  // LuaTeX template), with a plain caption "\small\centering Figure 1: text".
  // With the caption package loaded (by the class too: lipics-v2021), the
  // caption is made the package's way instead — its label format (lipics'
  // yellow square), separator, fonts and justification — still as an
  // ordinary paragraph. TeX-guarded; a no-op without the caption package.
  text = `${text.replace(/\s*$/, '')}\n${CAPTION_TEX}\n`;
  notes.push('captions: the caption package\'s format in the flow (when it is loaded)');
  return { text, before, notes };
}

/** The preamble without % comments (for the package tests above; the rule: tex-comment.ts). */
export { stripComments };

/** Captions in the flow in the caption package's format (label format,
 *  separator, fonts, justification): caption3's \caption@@@make without its
 *  parbox and without the measuring \sbox (which would run the label, and
 *  rtx-numbering's number slot in it, twice). The number is the same slot
 *  rtx-numbering's \fnum@figure gives. \caption is a plain macro, as in engine-api/tex/rtx-template.sty
 * ltcmd's \caption{o m} collected its arguments with an \edef, and the caption's glyphs lost their
 *  source positions. */
export const CAPTION_TEX = String.raw`\makeatletter\AtBeginDocument{\@ifpackageloaded{caption}{\ifdefined\rtx@flowfloat
\def\rtx@flowfloat#1{\par\addvspace{\intextsep}\begingroup\def\@captype{#1}\parindent\z@
\def\caption{\@ifnextchar[\rtx@caption{\rtx@caption[]}}\long\def\rtx@caption[##1]##2{\refstepcounter{#1}\par\vskip\abovecaptionskip\rtx@capmake{#1}{##2}\vskip\belowcaptionskip}}%
\def\rtx@capnum#1{\ifdefined\rtx@numslot\rtx@numslot{#1}{\csname #1name\endcsname}{\csname the#1\endcsname}\else\csname the#1\endcsname\fi}%
\def\rtx@capmake#1#2{\begingroup\ifx\caption@fmt\@undefined\caption@format\fi\let\caption@lfmt\caption@labelformat
\caption@ifempty{#2}{\caption@set{labelseparator}{none}\caption@set{textformat}{simple}}\caption@labelseparator
\@setpar{\@@par\caption@@par}\caption@@par\caption@applyfont\leavevmode
\caption@fmt{\begingroup\captionlabelfont\caption@labelformat{\csname #1name\endcsname}{\rtx@capnum{#1}}\relax\relax\endgroup}%
{\begingroup\caption@iflabelfont\captionlabelfont\relax\caption@labelsep\endgroup}%
{{\captiontextfont\nobreak\hskip\z@skip\caption@textformat{#2}\ifhmode\unskip\fi}}\par\endgroup}%
\fi}{}}\makeatother`;

/** Final versions from a publisher's pipeline (LIPIcs/Dagstuhl's dagpub, and
 *  any paper written for pdfLaTeX) carry pdfTeX-only settings that stop
 *  XeTeX; each is detected in the preamble (not by paper or class name) and
 *  noted. Lines are never added or removed (the author's line numbers stay).
 *  - `pdfa` class option: dropped. It asks the class for PDF/A output
 *    (lipics-v2021: glyphtounicode.tex, \pdfobjcompresslevel, \pdfcatalog:
 *    pdfTeX primitives); the editor never makes PDF/A.
 *  - `\pdfmapline` / `\pdfmapfile`: no-ops when the engine has none (XeTeX);
 *    the editor reads the map line itself for the font's outline
 *    (doc-fonts.ts), and xdvipdfmx finds a TFM's .pfb by name.
 *  - TikZ externalisation (`\tikzexternalize`, dagpub's
 *    `[prefix=dagpub-tikzpictures/]`): switched off at \begin{document}, so
 *    every picture is typeset from its source (the externalised PDFs are
 *    named by picture count and would not match per block).
 *  - dagpub's `\input{….filtered-aux.tex}` (an artefact of its build):
 *    read only when the document has it. */
export function publisherFinal(text: string, notes: string[], addBefore: (tex: string) => void): string {
  const lines = text.split('\n');
  const code = (l: string) => l.slice(0, commentStart(l));
  const c = lines.findIndex((l) => /^\s*\\documentclass\b/.test(code(l)));
  if (c >= 0) {
    const m = /^(\s*\\documentclass\s*\[)([^\]]*)(\])/.exec(lines[c]);
    if (m) {
      const opts = m[2].split(',');
      const kept = opts.filter((o) => o.trim() !== 'pdfa');
      if (kept.length !== opts.length) {
        lines[c] = m[1] + kept.join(',') + lines[c].slice(m[0].length - 1);
        notes.push('pdfa: the class option dropped (pdfTeX-only PDF/A code; the editor makes no PDF/A)');
      }
    }
  }
  const all = lines.map(code).join('\n');
  if (/\\pdfmap(line|file)\b/.test(all)) {
    addBefore('\\ifdefined\\pdfmapline\\else\\def\\pdfmapline#1{}\\fi\\ifdefined\\pdfmapfile\\else\\def\\pdfmapfile#1{}\\fi');
    notes.push('\\pdfmapline/\\pdfmapfile: no-ops under XeTeX (the document\'s font outlines are found by the editor)');
  }
  const ext = lines.findIndex((l) => /\\tikzexternalize\b(?!\w)/.test(code(l)));
  if (ext >= 0) {
    lines[ext] = `${lines[ext]}\\AtBeginDocument{\\ifdefined\\tikzexternaldisable\\tikzexternaldisable\\fi}`;
    notes.push('TikZ externalisation: switched off (every picture is typeset from its source)');
  }
  let aux = 0;
  for (let i = 0; i < lines.length; i++)
    lines[i] = lines[i].replace(/\\input\s*\{([^}]*\.filtered-aux(?:\.tex)?)\}/g, (_m, f) => { aux++; return `\\InputIfFileExists{${f}}{}{}`; });
  if (aux) notes.push('dagpub: its filtered-aux file read only when the document has it');
  return lines.join('\n');
}
