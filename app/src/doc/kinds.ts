// Block kinds: the built-in ones and the theorem-like environments the
// preamble declares (\newtheorem, thmtools' \declaretheorem), plus
// environments it defines with \newenvironment. The slash menu lists them.
import { blankComments, readGroup, readArgs } from '../tex/texscan.js';
import type { TheoremKind } from '../contracts';

/** a block kind the slash menu offers: its template, its caret, its section (chrome/menu.ts SlashKind) */
export interface Kind {
  kind: string; label: string; icon?: string; hint?: string; group?: string;
  env?: string; source: string; caret?: number; theorem?: TheoremKind;
}
/** a built-in kind: its template may depend on the preamble; `when(pre)`: offered only if true */
interface BuiltinKind extends Omit<Kind, 'source'> { source: string | ((pre: string) => string); when?: (pre: string) => boolean }
type Group = { content: string; start: number; end: number };

/** in declaration order */
export function theoremKinds(preamble: string | null | undefined): TheoremKind[] {
  const s: string = blankComments(preamble ?? ''), out: TheoremKind[] = [];
  let style = 'plain';
  const re = /\\(newtheorem|declaretheorem|theoremstyle|declaretheoremstyle)(\*?)(?![a-zA-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const cmd = m[1], star = m[2] === '*';
    if (cmd === 'theoremstyle') { const a = readArgs(s, re.lastIndex, { opt: 0, req: 1 }); if (a.reqs[0]) style = a.reqs[0].trim(); continue; }
    if (cmd === 'declaretheoremstyle') continue;
    if (cmd === 'newtheorem') {
      // \newtheorem{env}[sibling]{Name}[within]  |  \newtheorem*{env}{Name}
      let j = re.lastIndex;
      const env = argAt(s, j); if (!env) continue; j = env.end;
      const sib = optAt(s, j); if (sib) j = sib.end;
      const name = argAt(s, j); if (!name) continue; j = name.end;
      const within = !sib ? optAt(s, j) : null;
      out.push({ env: env.content.trim(), name: plain(name.content), numbered: !star, sibling: sib?.content.trim(), within: within?.content.trim(), style });
      re.lastIndex = within?.end ?? j;
      continue;
    }
    // \declaretheorem[opts]{env}  (or {env}[opts], the old form)
    let j = re.lastIndex;
    let opts = optAt(s, j); if (opts) j = opts.end;
    const env = argAt(s, j); if (!env) continue; j = env.end;
    if (!opts) { opts = optAt(s, j); if (opts) j = opts.end; }
    const o = keyvals(opts?.content ?? '');
    for (const e of env.content.split(',').map((x) => x.trim()).filter(Boolean)) {
      out.push({ env: e, name: plain(o.name ?? o.title ?? cap(e)), numbered: !(o.numbered === 'no' || star),
        sibling: o.sibling ?? o.sharenumber, within: o.numberwithin ?? o.within ?? o.parent, style: o.style ?? style });
    }
    re.lastIndex = j;
  }
  return out;
}

/** \newenvironment{name} in the preamble (not theorem-like). */
export function customEnvironments(preamble: string | null | undefined): string[] {
  const s: string = blankComments(preamble ?? ''), out: string[] = [];
  const re = /\\(?:new|renew)environment\*?\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1].trim());
  return [...new Set(out)];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plain = (s: string) => s.replace(/\$\\star\$/g, '⋆').replace(/[{}$\\]/g, '').trim();
const skip = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };
const argAt = (s: string, i: number): Group | null => readGroup(s, skip(s, i));
const optAt = (s: string, i: number): Group | null => readGroup(s, skip(s, i), '[', ']');

/** key=value, key={value, with commas} → object */
export function keyvals(str: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0, cur = '';
  const parts: string[] = [];
  for (const c of str) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  for (const p of parts) {
    const k = p.indexOf('=');
    const key = (k < 0 ? p : p.slice(0, k)).trim();
    if (!key) continue;
    let v = k < 0 ? 'true' : p.slice(k + 1).trim();
    if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
    out[key] = v;
  }
  return out;
}

// ── Built-in kinds ───────────────────────────────────────────────────────────
// `source`: the template; `caret`: where the cursor goes (default: the end);
// `group`: the slash menu's section; `when(pre)`: offered only if true.

const env = (e: string, body = '  ') => `\\begin{${e}}\n${body}\n\\end{${e}}`;
const envCaret = (e: string) => `\\begin{${e}}\n  `.length;
/** a template with ‸ where the caret goes */
const tpl = (s: string) => ({ source: s.replace('‸', ''), caret: s.indexOf('‸') });

export const BUILTIN: BuiltinKind[] = [
  { kind: 'paragraph', label: 'Text', icon: '¶', hint: 'A paragraph; inline maths with $…$', source: '', group: 'Basic' },
  { kind: 'heading', label: 'Section', icon: 'H1', hint: '\\section', source: '\\section{}', caret: 9, group: 'Basic' },
  { kind: 'subheading', label: 'Subsection', icon: 'H2', hint: '\\subsection', source: '\\subsection{}', caret: 12, group: 'Basic' },
  { kind: 'subsubheading', label: 'Subsubsection', icon: 'H3', hint: '\\subsubsection', source: '\\subsubsection{}', caret: 15, group: 'Basic' },
  { kind: 'paragraph-heading', label: 'Paragraph heading', icon: 'P', hint: '\\paragraph', source: '\\paragraph{}', caret: 11, group: 'Basic' },
  { kind: 'itemize', label: 'Bulleted list', icon: '•', hint: 'itemize', source: env('itemize', '  \\item '), caret: envCaret('itemize') + 6, group: 'Basic' },
  { kind: 'enumerate', label: 'Numbered list', icon: '1.', hint: 'enumerate', source: env('enumerate', '  \\item '), caret: envCaret('enumerate') + 6, group: 'Basic' },
  { kind: 'equation', label: 'Equation', icon: '∑', hint: 'A numbered display', source: env('equation'), caret: envCaret('equation'), group: 'Maths' },
  { kind: 'align', label: 'Aligned equations', icon: '≡', hint: 'align: several lines, aligned at &', source: env('align', '  a &= b \\\\\n  c &= d'), caret: envCaret('align'), group: 'Maths' },
  { kind: 'proof', label: 'Proof', icon: '∎', hint: 'proof environment', source: env('proof'), caret: envCaret('proof'), group: 'Maths', when: (p) => /amsthm|thmtools|ntheorem/.test(p) },
  { kind: 'figure', label: 'Figure', icon: '▣', hint: 'figure: a graphic with a caption', group: 'Floats',
    ...tpl('\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{‸}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}') },
  { kind: 'table', label: 'Table', icon: '▦', hint: 'table: a tabular with a caption', group: 'Floats',
    ...tpl('\\begin{table}[t]\n  \\centering\n  \\begin{tabular}{ll}\n    ‸a & b \\\\\n    c & d\n  \\end{tabular}\n  \\caption{}\n  \\label{tab:}\n\\end{table}') },
  { kind: 'title', label: 'Title', icon: 'T', hint: '\\maketitle: title, authors, date from the preamble', source: '\\maketitle', group: 'Document' },
  { kind: 'abstract', label: 'Abstract', icon: 'A', hint: 'abstract environment', source: env('abstract'), caret: envCaret('abstract'), group: 'Document' },
  { kind: 'appendix', label: 'Appendix', icon: '§', hint: '\\appendix: later sections are lettered', source: '\\appendix', group: 'Document' },
  { kind: 'bibliography', label: 'Bibliography', icon: '[1]', hint: 'the references', group: 'Document',
    source: (p) => (/\\usepackage(\[[^\]]*\])?\{biblatex\}/.test(p) ? '\\printbibliography' : '\\bibliographystyle{plain}\n\\bibliography{}') },
  { kind: 'hint', label: 'Hint', icon: '?', hint: 'webhint: blurred until clicked', source: env('webhint'), caret: envCaret('webhint'), group: 'Web', when: (p) => /\{reflowtex\}/.test(p) },
  { kind: 'note', label: 'Note', icon: '▍', hint: 'webnote: set off from the text', source: env('webnote'), caret: envCaret('webnote'), group: 'Web', when: (p) => /\{reflowtex\}/.test(p) },
];

const THM_ICON = (name: string) => name.replace(/[^A-Za-z⋆]/g, '').slice(0, 1).toUpperCase() || '⋆';

/** Everything the slash menu offers for this preamble, in menu order. */
export function kindsFor(preamble: string | null | undefined): Kind[] {
  const p = preamble ?? '';
  const items: Kind[] = BUILTIN.filter((k) => !k.when || k.when(p)).map((k) => ({ ...k, source: typeof k.source === 'function' ? k.source(p) : k.source }));
  const thms = theoremKinds(p);
  const seen = new Set(items.map((k) => k.kind));
  const thmItems: Kind[] = [];
  for (const t of thms) {
    if (seen.has(t.env)) continue;
    seen.add(t.env);
    thmItems.push({ kind: t.env, label: t.name, icon: THM_ICON(t.name), group: 'Theorems',
      hint: `${t.env}${t.numbered ? '' : ' · unnumbered'}${t.sibling ? ` · shares ${t.sibling}` : ''}${t.within ? ` · within ${t.within}` : ''}`,
      source: env(t.env), caret: envCaret(t.env), theorem: t });
  }
  const custom = customEnvironments(p).filter((e) => !seen.has(e)).map((e): Kind => ({
    kind: 'raw', env: e, label: cap(e), icon: '{}', group: 'Environments', hint: `\\begin{${e}} from the preamble`, source: env(e), caret: envCaret(e) }));
  // theorems right after the maths kinds, before floats
  const at = items.findIndex((k) => k.group === 'Floats');
  items.splice(at < 0 ? items.length : at, 0, ...thmItems);
  return [...items, ...custom];
}

/** A block's kind from its source. `thms`: Set of theorem env names. */
export function guessKind(source: string, thms: ReadonlySet<string> | null = null): string {
  const s = source.replace(/^(\s*%[^\n]*\n)+/, '').trim();
  let m = /^\\(sub)?(sub)?section\*?\s*[[{]/.exec(s);
  if (m) return m[2] ? 'subsubheading' : m[1] ? 'subheading' : 'heading';
  if (/^\\(part|chapter)\*?\s*[[{]/.test(s)) return 'heading';
  if (/^\\paragraph\*?\s*[[{]/.test(s)) return 'paragraph-heading';
  if (/^\\maketitle\b/.test(s)) return 'title';
  if (/^\\appendix\b/.test(s)) return 'appendix';
  if (/^\\(printbibliography|bibliography\{|bibliographystyle\{)/.test(s) || /^\\begin\{thebibliography\}/.test(s)) return 'bibliography';
  m = /^\\begin\{([\w@]+)(\*?)\}/.exec(s);
  if (m) {
    const e = m[1];
    if (e === 'restatable') { const r = /^\\begin\{restatable\*?\}(\[[^\]]*\])?\{(\w+)\}/.exec(s); if (r) return r[2]; }
    if (['equation', 'displaymath', 'gather', 'multline'].includes(e)) return 'equation';
    if (['align', 'alignat', 'flalign', 'eqnarray'].includes(e)) return 'align';
    if (e === 'figure' || e === 'wrapfigure') return 'figure';
    if (e === 'table') return 'table';
    if (e === 'abstract') return 'abstract';
    if (e === 'webhint') return 'hint';
    if (e === 'webnote') return 'note';
    if (e === 'proof' || /proof$/.test(e)) return 'proof';
    if (e === 'itemize' || e === 'enumerate' || e === 'description') return e === 'description' ? 'itemize' : e;
    if (thms?.has(e)) return e;
    if (/^(theorem|lemma|corollary|proposition|definition|claim|remark|example|observation|conjecture|question|problem|fact)$/.test(e)) return e;
    return 'paragraph';
  }
  if (/^\\\[/.test(s)) return 'equation';
  return 'paragraph';
}

/** Short label of a kind for the gutter/outline tooltips. */
export function kindLabel(kind: string, preamble: string): string {
  const k = kindsFor(preamble).find((x) => x.kind === kind);
  return k?.label ?? cap(kind);
}

/** (out of app.js) what a block is when it is not typeset content: a marker the page draws itself
 *  and the compile queue skips: 'container' (its paragraphs are compiled, not the frame), 'appendix' (\appendix
 *  alone), 'comment' (nothing but comments), 'macros' (top-level definitions); null: a block that typesets. */
export function markerOf<B extends { kind?: string; source: string }>(b: B, isContainer: (b: B) => boolean = () => false): 'container' | 'appendix' | 'comment' | 'macros' | null {
  if (isContainer(b)) return 'container';
  const code: string = blankComments(b.source).trim();
  if (/^\\appendix$/.test(code)) return 'appendix';
  if (!code) return 'comment';
  if (b.kind === 'macros' || b.kind === 'comment') return b.kind;
  return null;
}
