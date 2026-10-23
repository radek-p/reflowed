// @ts-check
// What a source makes TeX open from the document's own files (the asset
// store): pictures, and the project's TeX files (a paper's own class or
// package, an \input table, an edited figure's .tikz). [pattern, the
// extensions TeX tries]
import { stripComments } from '../../loading/tex-comment.ts';   // the comment rule (\\% a line break, then a comment)
/** @type {[RegExp, string[]][]} */
const OPENS = [
  [/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg']],
  [/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['.cls']],
  [/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ['.sty']],
  [/\\(?:input|include|subfile|InputIfFileExists|IfFileExists)\s*\{([^}]+)\}/g, ['', '.tex']],
  [/\\bibliographystyle\s*\{([^}]+)\}/g, ['.bst']],
  // lipics-v2021's event logo: the class \includegraphics its argument
  [/\\EventLogo\s*\{([^}]+)\}/g, ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg']],
];
const FONT_SHAPE = /\\DeclareFontShape\s*(?:\{[^}]*\}\s*){4}\{([^}]*)\}/g;
export const PICTURE = /\.(pdf|png|jpe?g|gif|eps|svg)$/i;
export const TEXT_ASSET = /\.(tex|sty|cls|clo|def|cfg|ltx|tikz|bst|bbx|cbx|lbx|fd)$/i;
/** [name as written, extensions] for every file a source names
 * @param {string} src @returns {[string, string[]][]} */
export function opened(src) {
  /** @type {[string, string[]][]} */
  const out = [];
  const text = stripComments(src);
  for (const [re, exts] of OPENS) for (const m of text.matchAll(re)) for (const n of m[1].split(',')) { const t = n.trim(); if (t && !/[#\\]/.test(t)) out.push([t, exts]); }
  // a document's own TFM font: \DeclareFontShape{U}{fam}{m}{n}{<-> [s*[0.9]] Name}{}
  // → Name.tfm (TeX) and Name.pfb (the encoder's outlines); the bundle's fonts find no asset and add nothing
  for (const m of text.matchAll(FONT_SHAPE)) for (const f of m[1].matchAll(/<[^>]*>\s*(?:s\s*\*\s*(?:\[[^\]]*\])?\s*)?([A-Za-z][\w-]*)/g)) out.push([f[1], ['.tfm']], [`${f[1]}.pfb`, ['']]);
  // a map line's outline (\pdfmapline{+Face PSName <file.pfb}) and a map file the document ships
  for (const m of text.matchAll(/\\pdfmapline\s*\{([^}]*)\}/g)) for (const f of m[1].matchAll(/<\[?([\w.-]+\.pf[ab])/gi)) out.push([f[1], ['']]);
  for (const m of text.matchAll(/\\pdfmapfile\s*\{\s*[+=-]?([^}\s]+)\s*\}/g)) out.push([m[1], ['']]);
  return out;
}
