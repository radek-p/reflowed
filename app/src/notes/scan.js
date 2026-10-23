// Notes in a block's source, without TeX: the \todo notes (and the
// preamble's macros on \todo) the TODO panel lists, and — a setting, on by
// default — comments that stand on their own lines and read as notes, not
// as commented-out code. Offsets are into the source as given (UTF-16).
//
//   notesIn(source, macros, { comments })  every note, in source order (the
//       order TeX typesets them in, so the k-th chip of a block is the k-th)
//   commentGroups(source)       own-line comment runs: { offset, end, lines, note, why }
//   transformComments(source)   the source with each note comment made
//       \rtxcomment{…}, line for line (so line/column source maps still hold
//       on every other line, and error lines are the block's own)
//   resolveNote(source, note)   the source without the note (its line too,
//       when nothing else is on it)
//   notesPreamble(preamble)     what the web compile adds: \usepackage{rtx-notes}
//       and \rtxnoteauthor{name}{Author} for each macro on \todo
import { blankComments, scanTodos, todoMacros } from '../tex/texscan.js';

export { todoMacros };

/** Environments a note comment may not stand in (maths, alignments, pictures, verbatim, floats). */
const NO_NOTE_ENV = /^(equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math|split|aligned|gathered|cases|array|[a-zA-Z]*matrix|tabular[x*]?|NiceTabular\*?|NiceArray|longtable|tikzpicture|picture|pgfpicture|verbatim|Verbatim|lstlisting|minted|comment|figure|table|algorithm|algorithmic|thebibliography)\*?$/;

/** Commands that say a comment line is LaTeX (commented-out code), wherever they stand. */
const CODE_CMD = /\\(begin|end|item|label|ref|cref|Cref|eqref|autoref|pageref|cite\w*|footnote|section|subsection|subsubsection|paragraph|chapter|input|include|usepackage|newcommand|renewcommand|def|let|hline|Block|todo|missingfigure|vspace|hspace|includegraphics|caption|centering|noindent|newline|par)\b/;

/** Maths spans ($…$, \(…\)) of a line: [from, to) pairs; null if unbalanced. */
function mathSpans(t) {
  const out = [];
  let open = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\') {
      if (t[i + 1] === '(' && open < 0) { open = i; i++; continue; }
      if (t[i + 1] === ')' && open >= 0) { out.push([open, i + 2]); open = -1; i++; continue; }
      i++; continue;
    }
    if (t[i] === '$') {
      if (t[i + 1] === '$') return null;                     // $$: a display
      if (open < 0) open = i; else { out.push([open, i + 1]); open = -1; }
    }
  }
  return open < 0 ? out : null;
}
const inSpans = (spans, i) => spans.some(([a, b]) => i >= a && i < b);

/** Why a comment line's text is LaTeX code rather than a note (null: it reads as text). */
function codeReason(t, macroNames) {
  if (/^[\\$&{}[\]]/.test(t)) return 'starts like code';
  if (/&|\\\\/.test(t)) return '& or \\\\';
  if (/^[-=*#~_.%]{3,}/.test(t) || /^!\s*TeX/i.test(t)) return 'a rule or magic comment';
  if (/\$\$|\\\[|\\\]/.test(t)) return 'a display';
  if (CODE_CMD.test(t)) return 'a LaTeX command';
  if (macroNames.length && new RegExp(`\\\\(${macroNames.join('|')})(?![a-zA-Z@])`).test(t)) return 'a todo macro';
  const spans = mathSpans(t);
  if (!spans) return 'unbalanced maths';
  // a control sequence outside maths: commented-out text (\emph{…}) or code
  for (let i = 0; i < t.length; i++) if (t[i] === '\\' && /[a-zA-Z]/.test(t[i + 1] ?? '') && !inSpans(spans, i)) return 'a command outside maths';
  return null;
}
function balanced(t) {
  let d = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\') { i++; continue; }
    if (t[i] === '{') d++;
    else if (t[i] === '}' && --d < 0) return false;
  }
  return d === 0;
}

/** Where a note comment may not stand: inside maths or one of NO_NOTE_ENV. */
function blockedAt(src) {
  const s = blankComments(src);
  const events = [];
  const re = /\\(begin|end)\{([^}]+)\}|\\\[|\\\]|\$\$/g;
  let m;
  while ((m = re.exec(s))) events.push({ at: m.index, tok: m[0], begin: m[1] === 'begin', env: m[2] });
  return (off) => {
    const st = [];
    let disp = false, dd = false;
    for (const e of events) {
      if (e.at >= off) break;
      if (e.tok === '\\[') disp = true;
      else if (e.tok === '\\]') disp = false;
      else if (e.tok === '$$') dd = !dd;
      else if (e.begin) st.push(e.env);
      else { const k = st.lastIndexOf(e.env); if (k >= 0) st.splice(k, 1); }
    }
    return disp || dd || st.some((env) => NO_NOTE_ENV.test(env));
  };
}

/** Own-line comment runs of a block. A run is a note when no line of it looks
 *  like code and it does not stand in maths, an alignment, a picture or a float. */
export function commentGroups(src, macroNames = []) {
  const groups = [];
  const lines = src.split('\n');
  let off = 0, cur = null;
  const blocked = blockedAt(src);
  const close = () => {
    if (!cur) return;
    const texts = cur.lines.map((l) => l.text).filter(Boolean);
    let why = null;
    if (!texts.length) why = 'empty';
    for (const l of cur.lines) { if (why) break; if (l.text) why = codeReason(l.text, macroNames); }
    if (!why && !balanced(texts.join('\n'))) why = 'unbalanced braces';
    // two or more formulas with commands in them: commented-out mathematical text, not a note
    if (!why && texts.flatMap((t) => (mathSpans(t) ?? []).map(([a, b]) => t.slice(a, b))).filter((m) => /\\[a-zA-Z]/.test(m)).length >= 2) why = 'maths-heavy (commented-out text)';
    if (!why && blocked(cur.offset)) why = 'in maths, an alignment, a picture or a float';
    groups.push({ ...cur, note: !why, why, text: texts.join(' ') });
    cur = null;
  };
  for (const line of lines) {
    const m = /^([ \t]*)(%+)[ \t]?(.*)$/.exec(line);
    if (m) {
      const l = { offset: off, indent: m[1], marks: m[2], text: m[3].replace(/\s+$/, ''), length: line.length };
      if (!cur) cur = { offset: off, end: off + line.length, lines: [] };
      cur.lines.push(l);
      cur.end = off + line.length;
    } else close();
    off += line.length + 1;
  }
  close();
  return groups;
}

/** A note comment's text as TeX: specials outside maths escaped. */
function escapeText(t) {
  const spans = mathSpans(t) ?? [];
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') { out += t.slice(i, i + 2); i++; continue; }
    if (!inSpans(spans, i) && '#&_%'.includes(c)) { out += `\\${c}`; continue; }
    if (!inSpans(spans, i) && c === '^') { out += '\\^{}'; continue; }
    if (c === '#') { out += '\\#'; continue; }
    out += c;
  }
  return out;
}

/** The source with each note comment run as \rtxcomment{…}, line for line. */
export function transformComments(src, macroNames = []) {
  const groups = commentGroups(src, macroNames).filter((g) => g.note);
  if (!groups.length) return src;
  const lines = src.split('\n');
  let off = 0;
  const lineAt = new Map();
  lines.forEach((l, i) => { lineAt.set(off, i); off += l.length + 1; });
  for (const g of groups) {
    const idx = g.lines.map((l) => lineAt.get(l.offset));
    g.lines.forEach((l, k) => {
      let body = escapeText(l.text);
      if (k === 0) body = `\\rtxcomment{${body}`;
      if (k === g.lines.length - 1) body += '}';
      lines[idx[k]] = l.indent + body;
    });
  }
  return lines.join('\n');
}

/** Every note of a block, in source order: \todo-likes and (when on) note comments. */
export function notesIn(src, macros = new Map(), { comments = true } = {}) {
  const todos = scanTodos(src, macros).map((t) => ({ ...t, from: t.cmd === 'missingfigure' ? 'figure' : 'todo' }));
  const out = [...todos];
  if (comments) {
    for (const g of commentGroups(src, [...macros.keys()])) {
      if (g.note) out.push({ cmd: '%', author: '', text: g.text, offset: g.offset, length: g.end - g.offset, inline: false, from: 'comment' });
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/** The source without a note: the command (or the comment lines); a line left
 *  with only spaces goes too, so no blank line (a new paragraph) is made. */
export function resolveNote(src, note) {
  let a = note.offset, b = note.offset + note.length;
  const ls = src.lastIndexOf('\n', a - 1) + 1;
  let le = src.indexOf('\n', b); if (le < 0) le = src.length;
  if (!src.slice(ls, a).trim() && !src.slice(b, le).trim()) {
    // the whole line(s): take the newline after them (or the one before, at the end)
    a = ls; b = le < src.length ? le + 1 : le;
    if (b === src.length && a > 0) a -= 1;
  } else if (src[a - 1] === ' ' && /[\s]/.test(src[b] ?? ' ')) a -= 1;     // "word \todo{x} word" -> "word word"
  return src.slice(0, a) + src.slice(b);
}

const SAFE_AUTHOR = /^[\p{L}\p{N} .'-]{1,40}$/u;
/** What the web compile adds to the preamble (after it: the author's macros exist). */
export function notesPreamble(preamble) {
  const decls = [];
  for (const [name, m] of todoMacros(preamble)) {
    if (/^[a-zA-Z]+$/.test(name) && SAFE_AUTHOR.test(m.author)) decls.push(`\\rtxnoteauthor{${name}}{${m.author}}`);
  }
  return `${preamble}\n% (editor) notes as web widgets\n\\usepackage{rtx-notes}\n${decls.join('\n')}\n`;
}
