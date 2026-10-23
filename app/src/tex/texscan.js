// Reading LaTeX source without TeX: comments, groups, labels, references,
// citations, headings, todos, plain text for counting. Approximate by design
// (no macro expansion); used for the outline, autocomplete, diagnostics, the
// TODO panel and word count, and by the refs stub. Offsets are into the
// source as given (UTF-16).

import { blankComments } from './lex.ts';
import { HEADINGS, REF_NAMES, CITE_NAMES } from '../refs/scan.ts';
/** The source with every comment replaced by spaces (offsets kept). The rule: tex/lex.ts. */
export { blankComments };

/** The balanced group starting at src[i] === open; null if unbalanced. */
export function readGroup(src, i, open = '{', close = '}') {
  if (src[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return { content: src.slice(i + 1, j), start: i, end: j + 1 };
  }
  return null;
}

const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

/** A command's arguments after `i`: optional [..] then mandatory {..}. */
export function readArgs(src, i, { opt = 1, req = 1 } = {}) {
  const opts = [], reqs = [];
  let j = i;
  for (let k = 0; k < opt; k++) {
    const t = skipWs(src, j);
    if (src[t] !== '[') break;
    const g = readGroup(src, t, '[', ']');
    if (!g) break;
    opts.push(g.content); j = g.end;
  }
  for (let k = 0; k < req; k++) {
    const t = skipWs(src, j);
    const g = readGroup(src, t);
    if (!g) break;
    reqs.push(g.content); j = g.end;
  }
  return { opts, reqs, end: j };
}

/** TeX to readable text for titles: commands dropped, their arguments kept,
 *  maths kept; \ref-likes through refText(key) (default: the key). */
export function texToText(s, refText = null) {
  if (refText) s = s.replace(/\\(?:[cC]ref|ref|eqref|autoref|nameref)\*?\{([^}]*)\}/g, (m, keys) => keys.split(',').map((k) => refText(k.trim())).join(', '));
  return s.replace(/\\(label|index|footnote|thanks|todo|hspace|vspace)\*?(\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    .replace(/~/g, ' ').replace(/\\[,;:! ]/g, ' ')
    .replace(/\\(emph|textbf|textit|textsc|texttt|mathrm|mbox|text)\{/g, '{')
    .replace(/\\([a-zA-Z]+)\*?/g, (m, n) => (['LaTeX', 'TeX'].includes(n) ? n : ''))
    .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

const SECTIONS = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };
const COUNTER_ENVS = new Set(['equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray', 'figure', 'figure*', 'table', 'table*', 'enumerate']);

/** Sectioning commands in a block: [{ level, cmd, star, title, offset }]; `\appendix` as { appendix: true }. */
/** @param {string} src @param {((key: string) => string) | null} [refText] */
export function scanHeadings(src, refText = null) {
  const s = blankComments(src), out = [];
  const re = new RegExp(`\\\\(${HEADINGS.join('|')}|appendix)\\b(\\*?)`, 'g');
  let m;
  while ((m = re.exec(s))) {
    if (m[1] === 'appendix') { out.push({ appendix: true, offset: m.index }); continue; }
    const a = readArgs(s, re.lastIndex, { opt: 1, req: 1 });
    if (!a.reqs.length) continue;
    out.push({ level: SECTIONS[m[1]], cmd: m[1], star: m[2] === '*', title: texToText(a.reqs[0], refText), offset: m.index });
  }
  return out;
}

/** Environments open at each offset: a function offset -> [env names, innermost last]. */
function envStackAt(s) {
  const events = [];
  const re = /\\(begin|end)\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(s))) events.push({ at: m.index, begin: m[1] === 'begin', env: m[2], end: re.lastIndex });
  return (off) => {
    const st = [];
    for (const e of events) {
      if (e.at >= off) break;
      if (e.begin) {
        let env = e.env;
        if (env === 'restatable' || env === 'restatable*') {        // \begin{restatable}[opt]{lemma}{name}
          const a = readArgs(s, e.end, { opt: 1, req: 1 });
          if (a.reqs[0]) env = a.reqs[0];
        }
        st.push(env);
      } else {
        const k = st.lastIndexOf(e.env);
        if (k >= 0) st.splice(k, 1); else st.pop();
      }
    }
    return st;
  };
}

/** \label{..} in a block, each with what it probably labels. `theorems`: env -> name. */
/** @param {string} src @param {string} [kind] @param {Set<string> | null} [theorems] */
export function scanLabels(src, kind = 'paragraph', theorems = null) {
  const s = blankComments(src), out = [];
  const stackAt = envStackAt(s);
  const heads = scanHeadings(src).filter((h) => !h.appendix);
  const re = /\\label\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1].trim();
    if (!name) continue;
    const st = stackAt(m.index);
    let counter = null, title;
    for (let k = st.length - 1; k >= 0 && !counter; k--) {
      const env = st[k].replace(/\*$/, '');
      if (COUNTER_ENVS.has(st[k]) || COUNTER_ENVS.has(env)) counter = env === 'align' || env === 'gather' || env === 'multline' || env === 'flalign' || env === 'alignat' || env === 'eqnarray' ? 'equation' : env === 'enumerate' ? 'enumi' : env;
      else if (theorems?.has(env) || /^(theorem|lemma|claim|corollary|proposition|definition|remark|example|observation|conjecture|question|problem|bound|fact)$/.test(env)) counter = env;
    }
    if (!counter) {
      const h = heads.filter((x) => x.offset < m.index).pop();
      if (h) { counter = h.cmd; title = h.title; }
    }
    if (!counter) counter = /^(heading|subheading|subsubheading)$/.test(kind) ? 'section' : kind;
    const refname = (typeof theorems?.get === "function" ? theorems.get(counter) : null) ?? REFNAMES[counter] ?? (counter.charAt(0).toUpperCase() + counter.slice(1));
    out.push({ name, counter, refname, title, offset: m.index });
  }
  return out;
}
const REFNAMES = { section: 'Section', subsection: 'Section', subsubsection: 'Section', equation: 'Equation', figure: 'Figure', table: 'Table', enumi: 'Item', paragraph: 'Paragraph' };

/** Reference and citation commands as regex alternatives (join with '|'); the lists are refs/scan.ts's. */
export const REF_CMDS = REF_NAMES;
export const CITE_CMDS = CITE_NAMES;

function scanKeyed(src, cmds, maxOpt) {
  const s = blankComments(src), out = [];
  const re = new RegExp(`\\\\(${cmds.join('|')})\\*?(?![a-zA-Z])`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const a = readArgs(s, re.lastIndex, { opt: maxOpt, req: m[1].endsWith('range') ? 2 : 1 });
    if (!a.reqs.length) continue;
    const keys = a.reqs.flatMap((r) => r.split(',')).map((k) => k.trim()).filter(Boolean);
    out.push({ cmd: m[1], keys, offset: m.index, length: a.end - m.index });
  }
  return out;
}
export const scanRefs = (src) => scanKeyed(src, REF_CMDS, 0);
export const scanCites = (src) => scanKeyed(src, CITE_CMDS, 2);

/** \bibitem[label]{key} text  (a thebibliography block). */
export function scanBibitems(src) {
  const s = blankComments(src), out = [];
  const re = /\\bibitem\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}([^]*?)(?=\\bibitem|\\end\{thebibliography\}|$)/g;
  let m;
  while ((m = re.exec(s))) {
    const text = texToText(m[3]).slice(0, 240);
    out.push({ key: m[2].trim(), label: m[1] ? texToText(m[1]) : undefined, title: text, fields: { text } });
  }
  return out;
}

/** The bbl (biblatex 3.x) lightly: key, type, labelalpha, title, year, authors' family names. */
export function parseBblLite(bbl) {
  const out = [];
  if (!bbl) return out;
  const re = /\\entry\{([^}]*)\}\{([^}]*)\}/g;
  const starts = [];
  let m;
  while ((m = re.exec(bbl))) starts.push({ key: m[1], type: m[2], at: m.index });
  starts.forEach((st, i) => {
    const body = bbl.slice(st.at, starts[i + 1]?.at ?? bbl.indexOf('\\endentry', st.at) + 10);
    const field = (f) => { const k = body.indexOf(`\\field{${f}}{`); if (k < 0) return undefined; const g = readGroup(body, k + f.length + 9); return g ? texToText(g.content) : undefined; };
    const authors = [];
    const nameStart = body.indexOf('\\name{author}');
    if (nameStart >= 0) {
      const rest = body.slice(nameStart + 13);
      const stop = rest.search(/\n\s*\\(list|strng|field|name|range|verb|keyw)\b/);
      for (const f of rest.slice(0, stop < 0 ? undefined : stop).matchAll(/family=\{([^}]*)\}/g)) authors.push(texToText(f[1]));
    }
    const extra = field('extraalpha');
    const alpha = field('labelalpha');
    out.push({ key: st.key, type: st.type, label: alpha ? `${alpha}${extra ? String.fromCharCode(96 + Number(extra)) : ''}` : undefined,
      title: field('title'), year: field('year'), venue: field('journaltitle') ?? field('booktitle'), authors });
  });
  return out;
}

/** Macros the preamble defines on top of \todo: name -> author ("Editor", from
 *  "{Editor: #1}", else the macro's name). `inline` when they pass [inline]. */
export function todoMacros(preamble) {
  const s = blankComments(preamble), out = new Map();
  const re = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[\d\])?\s*(?:\[[^\]]*\])?\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    const g = readGroup(s, re.lastIndex - 1);
    if (!g || !/\\todo\b/.test(g.content)) continue;
    const who = /\{\s*([A-Z][\w .'-]{0,30}?)\s*:\s*#1/.exec(g.content);
    out.set(m[1], { author: who ? who[1] : m[1], inline: /\binline\b/.test(g.content) });
  }
  return out;
}

/** \todo[..]{..} and the preamble's todo macros in a block. */
export function scanTodos(src, macros = new Map()) {
  const s = blankComments(src), out = [];
  const names = ['todo', 'missingfigure', ...macros.keys()];
  const re = new RegExp(`\\\\(${names.map((n) => n.replace(/[@]/g, '\\$&')).join('|')})(?![a-zA-Z@])`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const a = readArgs(s, re.lastIndex, { opt: 1, req: 1 });
    if (!a.reqs.length) continue;
    const mac = macros.get(m[1]);
    let text = texToText(a.reqs[0]), author = mac?.author ?? '';
    if (!mac) { const w = /^([A-Z][\w .'-]{0,30}?):\s*/.exec(text); if (w) { author = w[1]; text = text.slice(w[0].length); } }
    const au = /(?:^|,)\s*author\s*=\s*\{?([^,{}]+)\}?/.exec(a.opts[0] ?? '');           // todonotes' author= wins, as on the chip
    if (au) author = au[1].trim();
    out.push({ cmd: m[1], author: author || 'Unassigned', text, offset: m.index, length: a.end - m.index,
      inline: mac?.inline ?? /\binline\b/.test(a.opts[0] ?? '') });
  }
  return out;
}

/** Words in a block, texcount-like: text words; inline maths and displays counted apart. */
export function countWords(src) {
  let s = blankComments(src);
  let displays = 0, inline = 0;
  s = s.replace(/\\begin\{(equation|align|gather|multline|flalign|alignat|eqnarray|displaymath)(\*?)\}[^]*?\\end\{\1\2\}/g, () => { displays++; return ' '; });
  s = s.replace(/\\\[[^]*?\\\]|\$\$[^]*?\$\$/g, () => { displays++; return ' '; });
  s = s.replace(/\\\([^]*?\\\)|\$(?:\\.|[^$\\])+\$/g, () => { inline++; return ' '; });
  s = s.replace(/\\(label|ref|cref|Cref|eqref|cite\w*|begin|end|includegraphics|todo|input|include|usepackage|newcommand|renewcommand|def|url|href|bibliographystyle|bibliography|printbibliography|addbibresource|setlength|vspace|hspace|thanks)\*?(\[[^\]]*\])*(\{[^{}]*\})*/g, ' ');
  s = s.replace(/\\[a-zA-Z@]+\*?/g, ' ').replace(/\\./g, ' ').replace(/[{}[\]&~^_#]/g, ' ');
  const words = (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return { words, inline, displays };
}
