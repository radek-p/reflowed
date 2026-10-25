// Cutting a LaTeX body into blocks, exactly: every character of the file
// lands either in a block's source, in the whitespace before an item
// (`before`) or in the file's tail, so the file is rebuilt byte for byte.
//
// Rules (outside environments, braces and display maths only):
//   - a blank line ends a block (a paragraph);
//   - a heading (\part … \subsubsection) starts a block; it holds the heading,
//     any \label lines right after it, and ends there;
//   - theorem-like environments, proofs, figures, tables, algorithms and the
//     abstract start a block of their own, and end it at \end;
//   - \maketitle, \appendix, \printbibliography, \bibliography{…},
//     \tableofcontents alone on a line are blocks of their own;
//   - \input / \include alone on a line become an `input` item (the importer
//     follows them);
//   - displays and lists inside a paragraph stay in it; a display or list that
//     starts a paragraph is its block;
//   - comment lines stay where they are: a run of comment lines before a block
//     start joins that block; comment lines between blank lines are a block of
//     kind 'comment';
//   - verbatim-like environments (verbatim, lstlisting, minted, comment,
//     filecontents) and \iffalse … \fi are opaque.
import { commentStart, controlSequenceAt } from '../tex/lex.ts';
import { isDefinitionsCommand } from '../tex/commands.ts';

export interface SplitOptions {
  theoremEnvs: Set<string>;
  proofEnvs: Set<string>;
}

export type Item =
  | { type: 'block'; before: string; source: string; kind: string; attrs: Record<string, unknown> }
  | { type: 'input'; before: string; cmd: string; target: string; include: boolean };

export interface SplitResult { items: Item[]; tail: string }

const OPAQUE = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*', 'alltt']);
const FLOAT_ENVS = ['figure', 'figure*', 'table', 'table*', 'algorithm', 'algorithm*', 'wrapfigure', 'wraptable', 'sidewaysfigure', 'sidewaystable'];
export const STANDARD_THEOREMS = ['theorem', 'lemma', 'corollary', 'proposition', 'definition', 'remark', 'example', 'claim', 'conjecture',
  'observation', 'fact', 'note', 'problem', 'question', 'exercise', 'notation', 'assumption', 'hypothesis', 'property', 'axiom', 'case'];
const HEAD_RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*[[{]/;
const SOLO_RE = /^\s*\\(maketitle|appendix|printbibliography|bibliography|tableofcontents)\b(\s*\[[^\]]*\])?(\s*\{[^}]*\})?\s*(%.*)?$/;
const INPUT_RE = /^(\s*)(\\(input|include)\s*(?:\{([^{}]+)\}|\s([^\s{}%]+)))\s*(%.*)?$/;

/** Theorem-like and proof-like environments declared in a preamble. */
export function envsFromPreamble(preamble: string): SplitOptions {
  const code = stripCommentsKeepLines(preamble);
  const th = new Set<string>();
  for (const m of code.matchAll(/\\(?:newtheorem|spnewtheorem|declaretheorem)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g)) th.add(m[1].trim());
  for (const m of code.matchAll(/\\newtheorem\*?\s*\{([^}]+)\}/g)) th.add(m[1].trim());
  if (!th.size) for (const t of STANDARD_THEOREMS) th.add(t);
  const pr = new Set<string>(['proof']);
  for (const m of code.matchAll(/\\(?:newenvironment|renewenvironment|NewDocumentEnvironment)\s*\{([^}]+)\}[^\n]*?\\begin\{proof\}/g)) pr.add(m[1].trim());
  return { theoremEnvs: th, proofEnvs: pr };
}

function stripCommentsKeepLines(s: string) {
  return s.split('\n').map((l) => codeOf(l)).join('\n');
}

/** A line without its %-comment. */
export function codeOf(line: string): string {
  return line.slice(0, commentStart(line));
}

interface State { envs: string[]; brace: number; math: number; dollars: boolean; opaque: string | null }

/** Update the structural state with one line. */
function scanLine(line: string, st: State) {
  let i = 0;
  if (st.opaque) {
    if (st.opaque === '\\fi') { if (/^\s*\\fi\b/.test(line)) st.opaque = null; return; }
    const endTok = `\\end{${st.opaque}}`;
    const k = line.indexOf(endTok);
    if (k < 0) return;
    st.opaque = null;
    const e = st.envs.lastIndexOf(endTokName(endTok));
    if (e >= 0) st.envs.length = e;
    i = k + endTok.length;
  }
  if (!st.envs.length && st.brace === 0 && /^\s*\\iffalse\b/.test(line)) { st.opaque = '\\fi'; return; }
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '%') return;
    if (c === '\\') {
      const rest = line.slice(i);
      let m: RegExpExecArray | null;
      if ((m = /^\\begin\s*\{([^}]*)\}/.exec(rest))) {
        st.envs.push(m[1]);
        i += m[0].length - 1;
        if (OPAQUE.has(m[1])) { st.opaque = m[1]; const k = line.indexOf(`\\end{${m[1]}}`, i); if (k < 0) return; st.opaque = null; st.envs.pop(); i = k + `\\end{${m[1]}}`.length - 1; }
        continue;
      }
      if ((m = /^\\end\s*\{([^}]*)\}/.exec(rest))) {
        const e = st.envs.lastIndexOf(m[1]);
        if (e >= 0) st.envs.length = e;
        i += m[0].length - 1;
        continue;
      }
      if ((m = /^\\verb\*?([^A-Za-z\s])/.exec(rest))) {
        const k = line.indexOf(m[1], i + m[0].length);
        i = k < 0 ? line.length : k;
        continue;
      }
      if (rest[1] === '[') { st.math++; i++; continue; }
      if (rest[1] === ']') { st.math = Math.max(0, st.math - 1); i++; continue; }
      i++;                                 // an escaped char or the first letter of a command
      continue;
    }
    if (c === '{') st.brace++;
    else if (c === '}') st.brace = Math.max(0, st.brace - 1);
    else if (c === '$' && line[i + 1] === '$') { st.dollars = !st.dollars; i++; }
  }
}
const endTokName = (t: string) => t.slice(5, -1);
const atTop = (st: State) => !st.envs.length && st.brace === 0 && st.math === 0 && !st.dollars && !st.opaque;

/** The kind of a block from its source. */
export function detectKind(source: string, opts: SplitOptions): { kind: string; attrs: Record<string, unknown> } {
  const lines = source.split('\n');
  const code = lines.map(codeOf);
  const firstCode = code.findIndex((l) => l.trim());
  if (firstCode < 0) return { kind: 'comment', attrs: {} };
  const s = code.slice(firstCode).join('\n').trim();
  let m = /^\\(part|chapter|section|subsection|subsubsection)(\*?)/.exec(s);
  if (m) {
    const kind = m[1] === 'subsection' ? 'subheading' : m[1] === 'subsubsection' ? 'subsubheading' : 'heading';
    return { kind, attrs: { level: m[1] + m[2] } };
  }
  if (/^\\(paragraph|subparagraph)\*?\s*[[{]/.test(s)) return { kind: 'paragraph-heading', attrs: {} };
  if ((m = /^\\(maketitle|appendix|printbibliography|bibliography|tableofcontents)\b/.exec(s))) {
    const k = { maketitle: 'title', appendix: 'appendix', printbibliography: 'bibliography', bibliography: 'bibliography', tableofcontents: 'toc' }[m[1]]!;
    return { kind: k, attrs: {} };
  }
  if (isDefinitions(code.slice(firstCode))) return { kind: 'macros', attrs: {} };
  if (/^\\\[[\s\S]*\\\]$/.test(s) || /^\$\$[\s\S]*\$\$$/.test(s)) return { kind: 'equation', attrs: {} };
  if ((m = /^\\begin\s*\{([^}]+)\}/.exec(s))) {
    const env = m[1];
    // is the block this one environment (plus labels/comments after it)?
    const st: State = { envs: [], brace: 0, math: 0, dollars: false, opaque: null };
    const ls = s.split('\n');
    let endLine = -1;
    for (let i = 0; i < ls.length; i++) { scanLine(ls[i], st); if (!st.envs.length && !st.opaque) { endLine = i; break; } }
    let whole = false;
    if (endLine >= 0) {
      const endAt = ls[endLine].lastIndexOf(`\\end{${env}}`);
      const after = (endAt >= 0 ? ls[endLine].slice(endAt + env.length + 6) : '') + '\n' + ls.slice(endLine + 1).join('\n');
      whole = !after.replace(/\\label\s*\{[^}]*\}/g, '').trim();
    }
    const bare = env.replace(/\*$/, '');
    if (!whole) return { kind: 'paragraph', attrs: { env } };
    if (bare === 'restatable') {
      const r = restatableArgs(s);
      if (r) return { kind: opts.theoremEnvs.has(r.type) ? r.type : 'paragraph', attrs: { env, theorem: r.type, restatable: r.name } };
    }
    let kind = 'paragraph';
    if (['equation', 'displaymath', 'gather', 'multline', 'math'].includes(bare)) kind = 'equation';
    else if (['align', 'alignat', 'flalign', 'eqnarray', 'xalignat'].includes(bare)) kind = 'align';
    else if (['figure', 'wrapfigure', 'sidewaysfigure'].includes(bare)) kind = 'figure';
    else if (['table', 'wraptable', 'sidewaystable'].includes(bare)) kind = 'table';
    else if (['algorithm'].includes(bare)) kind = 'algorithm';
    else if (bare === 'itemize' || bare === 'enumerate') kind = bare;
    else if (bare === 'description') kind = 'itemize';
    else if (bare === 'abstract') kind = 'abstract';
    else if (bare === 'thebibliography') kind = 'bibliography';   // as doc/kinds.ts guessKind has it (the Files panel, the e2e)
    else if (opts.proofEnvs.has(env) || opts.proofEnvs.has(bare)) kind = 'proof';
    else if (opts.theoremEnvs.has(env) || opts.theoremEnvs.has(bare)) kind = bare;
    return { kind, attrs: { env } };
  }
  return { kind: 'paragraph', attrs: {} };
}

/** Split one file body. */
export function splitBody(text: string, opts: SplitOptions, how: { blankLinesOnly?: boolean } = {}): SplitResult {
  const splitEnvs = new Set<string>([...FLOAT_ENVS, 'abstract', 'restatable', 'restatable*', ...opts.theoremEnvs, ...opts.proofEnvs]);
  for (const t of [...opts.theoremEnvs]) splitEnvs.add(t + '*');
  // line offsets
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineAt = (i: number) => text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] - 1 : text.length);
  const nLines = starts.length;

  const items: Item[] = [];
  let cursor = 0;                  // end of the previous item
  let chunk: number[] = [];        // line numbers in the current chunk
  let joined = false;              // the current chunk follows an item without a blank line
  let mode: 'para' | 'head' | 'env' | 'solo' = 'para';
  let headDone = false;
  const st: State = { envs: [], brace: 0, math: 0, dollars: false, opaque: null };

  const commentOnly = () => chunk.every((l) => !codeOf(lineAt(l)).trim());
  const flush = (next: 'joined' | 'blank') => {
    if (chunk.length) {
      const from = starts[chunk[0]];
      const last = chunk[chunk.length - 1];
      const to = starts[last] + lineAt(last).length;
      const raw = text.slice(from, to);
      const lead = raw.length - raw.trimStart().length;
      const source = raw.trim();
      if (source) {
        const srcStart = from + lead;
        const { kind, attrs } = detectKind(source, opts);
        if (joined) attrs.joined = true;
        items.push({ type: 'block', before: text.slice(cursor, srcStart), source, kind, attrs });
        cursor = srcStart + source.length;
      }
    }
    chunk = [];
    joined = next === 'joined';
    mode = 'para';
    headDone = false;
  };

  for (let ln = 0; ln < nLines; ln++) {
    const line = lineAt(ln);
    const code = codeOf(line);
    const top = atTop(st);
    if (top) {
      if (!line.trim()) {                                       // blank line
        if (chunk.length) flush('blank'); else joined = false;
        continue;
      }
      if (mode === 'head' && headDone) {
        // labels (and comments) right after a heading stay with it
        if (/^\s*(\\label\s*\{[^}]*\}\s*)+$/.test(code) || (!code.trim() && line.trim())) { chunk.push(ln); continue; }
        flush('joined');
      } else if (mode === 'env' || mode === 'solo') {
        flush('joined');
      }
      const im = how.blankLinesOnly ? null : INPUT_RE.exec(line);
      if (im) {
        flush(chunk.length ? 'joined' : (joined ? 'joined' : 'blank'));
        const cmdStart = starts[ln] + im[1].length;
        const cmd = line.slice(im[1].length).trimEnd();
        items.push({ type: 'input', before: text.slice(cursor, cmdStart), cmd, target: (im[4] ?? im[5]).trim(), include: im[3] === 'include' });
        cursor = cmdStart + cmd.length;
        joined = true;
        continue;
      }
      const envM = /^\s*\\begin\s*\{([^}]+)\}/.exec(code);
      const startsBlock = how.blankLinesOnly ? null : HEAD_RE.test(code) ? 'head' : SOLO_RE.test(line) ? 'solo' : envM && splitEnvs.has(envM[1]) ? 'env' : null;
      if (startsBlock) {
        if (chunk.length && !commentOnly()) flush('joined');
        mode = startsBlock;
      }
    }
    chunk.push(ln);
    scanLine(line, st);
    if (mode === 'head' && atTop(st)) headDone = true;
  }
  flush('blank');
  return { items, tail: text.slice(cursor) };
}

/** Code lines that only define things (macros, lengths, colours …): no output of their own. */
export function isDefinitions(code: string[]): boolean {
  let depth = 0, any = false;
  for (const l of code) {
    const t = l.trim();
    if (!t) { if (depth === 0) continue; }
    else if (depth === 0) {
      if (t[0] !== '\\' || !isDefinitionsCommand(controlSequenceAt(t, 0).name)) return false;   // the one table: tex/commands.ts
      any = true;
    }
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '\\') { i++; continue; }
      if (l[i] === '{') depth++;
      else if (l[i] === '}') depth = Math.max(0, depth - 1);
    }
  }
  return any && depth === 0;
}

/** \begin{restatable}[opt]{type}{name} → type and name. */
export function restatableArgs(s: string): { type: string; name: string } | null {
  const m = /^\\begin\s*\{restatable\*?\}\s*/.exec(s);
  if (!m) return null;
  let i = m[0].length;
  const group = (open: string, close: string) => {
    if (s[i] !== open) return null;
    let d = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '{' || (open === '[' && s[j] === '[' && d === 0 && j === i)) d++;
      else if (s[j] === '}' || (open === '[' && s[j] === ']' && d === 1)) {
        d--;
        if (d === 0) { const out = s.slice(i + 1, j); i = j + 1; while (/\s/.test(s[i] ?? '')) i++; return out; }
      }
    }
    return null;
  };
  if (s[i] === '[') { if (group('[', ']') === null) return null; }
  const type = group('{', '}');
  const name = group('{', '}');
  return type && name ? { type: type.trim(), name: name.trim() } : null;
}
