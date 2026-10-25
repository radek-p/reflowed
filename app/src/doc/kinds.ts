// Block kinds: what a document offers and what a block is, from one rule: a kind is offered (the slash menu, the
// kind switcher, a block's kind guessed from its source: guessKind here, io/split.ts detectKind for paste, split and
// import) only if the preamble and its class define its environment. A block of a kind no longer defined keeps its
// kind and source (TeX's error shows); nothing here changes blocks.
//
//   offeredKinds(preamble) -> Offered                    decided from the source alone: the declarations the preamble
//                                                        makes (\newtheorem, \spnewtheorem, thmtools' \declaretheorem,
//                                                        \newenvironment and its xparse forms, comments blanked:
//                                                        tex/lex.ts) and what its class and packages define (CLASSES,
//                                                        PACKAGES: measured with TeX)
//   offeredKinds(preamble, { probe }) -> Promise<Offered>
//                                                        and what that cannot decide (a class or package not in the
//                                                        tables, an \input) asked of TeX: probe(env) -> Promise<boolean>,
//                                                        "is \begin{env} defined with this preamble?" (the editor's:
//                                                        doc/kind-probe.ts, its engine; cached per preamble text there).
//                                                        No probe: an environment not decided is not offered.
//   Offered = { kinds, envs, theorems }
//     kinds     the slash menu's entries (Kind), in menu order
//     envs      environment -> the kind of a block that is one, for every environment defined that is a block kind
//     theorems  the theorem-like environments
//   guessKind(source, offered) -> kind                   a block's kind from its source; an environment the document
//                                                        does not define is a paragraph
//   kindOfEnv(env, offered) -> kind | null               (a starred form: its base's)
//   kindLabel(kind, preamble) · theoremKinds(preamble) · keyvals(str) · markerOf(b, isContainer)
//
// Pure functions of their arguments, no app state (kindLabel keeps the last preamble's list). Tests: doc/kinds.test.ts,
// doc/offered-kinds.test.ts.
import { blankComments, readGroup, readOptional } from '../tex/lex.ts';
import { commandCalls, usesAny } from '../tex/calls.ts';
import type { TheoremKind } from '../contracts';

/** a block kind the slash menu offers: its template, its caret, its section (chrome/menu.ts SlashKind) */
export interface Kind {
  kind: string; label: string; icon?: string; hint?: string; group?: string;
  env?: string; source: string; caret?: number; theorem?: TheoremKind;
}
/** what a document offers (see the header) */
export interface Offered {
  kinds: Kind[];
  envs: ReadonlyMap<string, string>;
  theorems: ReadonlySet<string>;
}
/** is \begin{env} defined with the preamble? */
export type Probe = (env: string) => Promise<boolean>;
/** a built-in kind: its template may depend on the packages; `needs`: the environment it is offered with */
interface BuiltinKind extends Omit<Kind, 'source'> { source: string | ((packages: ReadonlySet<string>) => string); needs?: string }
type Group = { content: string; start: number; end: number };

/** in declaration order */
export function theoremKinds(preamble: string | null | undefined): TheoremKind[] {
  const s: string = blankComments(preamble ?? ''), out: TheoremKind[] = [];
  let style = 'plain';
  const re = /\\(newtheorem|spnewtheorem|declaretheorem|theoremstyle|declaretheoremstyle)(\*?)(?![a-zA-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const cmd = m[1], star = m[2] === '*';
    if (cmd === 'theoremstyle') { const a = argAt(s, re.lastIndex); if (a) style = a.content.trim(); continue; }
    if (cmd === 'declaretheoremstyle') continue;
    if (cmd === 'newtheorem' || cmd === 'spnewtheorem') {
      // \newtheorem{env}[sibling]{Name}[within]  |  \newtheorem*{env}{Name}   (llncs' \spnewtheorem: two font
      // arguments after these, read as text)
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

/** The environments the preamble defines itself (\newenvironment, \renewenvironment and the xparse forms), in
 *  order; `proof`: one that is a proof (its name ends in "proof", or it begins with \begin{proof}). */
function definedEnvironments(s: string): { env: string; proof: boolean }[] {
  const out = new Map<string, boolean>();
  const re = /\\(newenvironment|renewenvironment|NewDocumentEnvironment|RenewDocumentEnvironment|ProvideDocumentEnvironment|DeclareDocumentEnvironment)(\*?)(?![a-zA-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = argAt(s, re.lastIndex);
    if (!name) continue;
    let j = name.end;
    if (m[1].endsWith('Environment')) { const spec = argAt(s, j); if (spec) j = spec.end; }      // {name}{argument spec}{begin}{end}
    else for (let k = 0; k < 2; k++) { const o = optAt(s, j); if (o) j = o.end; }                 // {name}[n][default]{begin}{end}
    const begin = argAt(s, j);
    const env = name.content.trim();
    if (env) out.set(env, /proof$/.test(env) || /^\s*\\begin\s*\{proof\}/.test(begin?.content ?? ''));
    re.lastIndex = begin?.end ?? j;
  }
  return [...out].map(([env, proof]) => ({ env, proof }));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plain = (s: string) => s.replace(/\$\\star\$/g, '⋆').replace(/[{}$\\]/g, '').trim();
const skip = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };
/** the {group} at i (spaces before it allowed), or null (none, or not closed) */
function argAt(s: string, i: number): Group | null {
  const j = skip(s, i);
  if (s[j] !== '{') return null;
  const [content, end] = readGroup(s, j);
  return s[end - 1] === '}' && end - j - 2 === content.length ? { content, start: j, end } : null;
}
/** the [optional] argument at i (spaces before it allowed), or null */
function optAt(s: string, i: number): Group | null {
  const o = readOptional(s, i);
  return o ? { content: o[0], start: o[1] - o[0].length - 2, end: o[1] } : null;
}

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

// ── What defines an environment that is a block kind ─────────────────────────
// BUNDLES: the environments, by what brings them ('kernel': LaTeX and every class); a starred form is its base's.
// CLASSES and PACKAGES: what a class (with its options) or package brings, measured with TeX (TeX Live 2026: each
// class and package alone, \begin{env} defined when \env and \endenv are). DEFINE_NONE: packages that bring none of
// these (more of them: fewer preambles asked of the probe). Anything else (a class or package not listed, an \input
// in the preamble) leaves THEOREM_NAMES, abstract, align and proof undecided: the probe's to answer.

const BUNDLES: Record<string, [env: string, kind: string][]> = {
  kernel: [['equation', 'equation'], ['displaymath', 'equation'], ['math', 'equation'], ['eqnarray', 'align'], ['figure', 'figure'],
    ['table', 'table'], ['itemize', 'itemize'], ['enumerate', 'enumerate'], ['description', 'itemize'], ['thebibliography', 'bibliography']],
  amsmath: [['align', 'align'], ['alignat', 'align'], ['flalign', 'align'], ['xalignat', 'align'], ['gather', 'equation'], ['multline', 'equation']],
  abstract: [['abstract', 'abstract']],
  proof: [['proof', 'proof']],
  claimproof: [['claimproof', 'proof']],
  restatable: [['restatable', 'restatable']],
  reflowtex: [['webhint', 'hint'], ['webnote', 'note']],
  wrapfig: [['wrapfigure', 'figure'], ['wraptable', 'table']],
  rotating: [['sidewaysfigure', 'figure'], ['sidewaystable', 'table']],
  algorithm: [['algorithm', 'algorithm']],
};
/** the bundle an undecided candidate stands for, when TeX says it is defined */
const PROBED_BUNDLE: Record<string, string> = { abstract: 'abstract', align: 'amsmath', proof: 'proof' };
/** names classes and packages define theorem-like environments under: what a probe is asked about */
const THEOREM_NAMES = ['theorem', 'lemma', 'corollary', 'proposition', 'definition', 'remark', 'example', 'claim', 'conjecture',
  'observation', 'fact', 'note', 'problem', 'question', 'exercise', 'notation', 'assumption', 'hypothesis', 'property', 'axiom', 'case', 'solution'];

interface ClassDefines { bundles: string[]; theorems?: string[] }
const ARTICLE: ClassDefines = { bundles: ['abstract'] };
const AMS: ClassDefines = { bundles: ['abstract', 'amsmath', 'proof'] };
const CLASSES: Record<string, (options: ReadonlySet<string>) => ClassDefines> = {
  article: () => ARTICLE, report: () => ARTICLE, memoir: () => ARTICLE, scrartcl: () => ARTICLE, scrreprt: () => ARTICLE,
  elsarticle: () => ARTICLE, IEEEtran: () => ARTICLE, 'revtex4-2': () => ARTICLE,
  book: () => ({ bundles: [] }), scrbook: () => ({ bundles: [] }),
  amsart: () => AMS, amsproc: () => AMS, amsbook: () => AMS,
  llncs: () => ({ bundles: ['abstract', 'proof'], theorems: ['theorem', 'lemma', 'corollary', 'proposition', 'definition', 'remark', 'example',
    'claim', 'conjecture', 'note', 'problem', 'question', 'exercise', 'property', 'case', 'solution'] }),
  'lipics-v2021': (o) => ({ bundles: ['abstract', 'amsmath', 'proof', 'claimproof', 'rotating', ...(o.has('thm-restate') ? ['restatable'] : [])],
    theorems: ['theorem', 'lemma', 'corollary', 'proposition', 'exercise', 'definition', 'conjecture', 'observation', 'example', 'note', 'note*',
      'remark', 'remark*', 'claim', 'claim*'] }),
  acmart: (o) => ({ bundles: AMS.bundles, theorems: o.has('acmthm=false') ? [] : ['theorem', 'conjecture', 'proposition', 'lemma', 'corollary', 'example', 'definition'] }),
  beamer: (o) => (o.has('noamsthm') ? ARTICLE : { bundles: AMS.bundles, theorems: o.has('notheorems') ? [] : ['theorem', 'corollary', 'definition',
    'definitions', 'fact', 'example', 'examples', 'lemma', 'problem', 'solution'] }),
};
const PACKAGES: Record<string, string[]> = {
  amsmath: ['amsmath'], mathtools: ['amsmath'], empheq: ['amsmath'], physics: ['amsmath'], breqn: ['amsmath'],
  amsthm: ['proof'], abstract: ['abstract'], thmtools: ['restatable'], 'thm-restate': ['restatable'], reflowtex: ['reflowtex'],
  wrapfig: ['wrapfig'], rotating: ['rotating'], algorithm: ['algorithm'], algorithm2e: ['algorithm'],
};
const DEFINE_NONE = new Set(['inputenc', 'fontenc', 'lmodern', 'textcomp', 'babel', 'csquotes', 'microtype', 'geometry', 'fullpage', 'graphicx',
  'graphics', 'xcolor', 'color', 'hyperref', 'url', 'cleveref', 'varioref', 'nameref', 'amssymb', 'amsfonts', 'bm', 'mathrsfs', 'stmaryrd',
  'dsfont', 'bbm', 'upgreek', 'xspace', 'tikz', 'pgfplots', 'tikz-cd', 'booktabs', 'multirow', 'array', 'tabularx', 'longtable', 'enumitem',
  'caption', 'subcaption', 'float', 'algorithmic', 'algpseudocode', 'algorithmicx', 'listings', 'natbib', 'biblatex', 'todonotes', 'comment',
  'etoolbox', 'xparse', 'ifthen', 'calc', 'lipsum', 'times', 'mathptmx', 'newtxtext', 'newtxmath', 'aliascnt', 'fancyhdr', 'setspace',
  'authblk', 'orcidlink', 'doi', 'verbatim', 'fancyvrb', 'siunitx', 'nicefrac', 'xfrac', 'soul', 'ulem', 'cancel', 'titlesec', 'lineno',
  'footmisc', 'placeins', 'pdflscape', 'adjustbox', 'framed', 'ntheorem', 'reflowed-meta', 'rtx-numbering', 'mathpartir', 'bussproofs']);

// ── Built-in kinds ───────────────────────────────────────────────────────────
// `source`: the template; `caret`: where the cursor goes (default: the end);
// `group`: the slash menu's section; `needs`: offered only when this environment is defined.

const env = (e: string, body = '  ') => `\\begin{${e}}\n${body}\n\\end{${e}}`;
const envCaret = (e: string) => `\\begin{${e}}\n  `.length;
/** a template with ‸ where the caret goes */
const tpl = (s: string) => ({ source: s.replace('‸', ''), caret: s.indexOf('‸') });

const BUILTIN: BuiltinKind[] = [
  { kind: 'paragraph', label: 'Text', icon: '¶', hint: 'A paragraph; inline maths with $…$', source: '', group: 'Basic' },
  { kind: 'heading', label: 'Section', icon: 'H1', hint: '\\section', source: '\\section{}', caret: 9, group: 'Basic' },
  { kind: 'subheading', label: 'Subsection', icon: 'H2', hint: '\\subsection', source: '\\subsection{}', caret: 12, group: 'Basic' },
  { kind: 'subsubheading', label: 'Subsubsection', icon: 'H3', hint: '\\subsubsection', source: '\\subsubsection{}', caret: 15, group: 'Basic' },
  { kind: 'paragraph-heading', label: 'Paragraph heading', icon: 'P', hint: '\\paragraph', source: '\\paragraph{}', caret: 11, group: 'Basic' },
  { kind: 'itemize', label: 'Bulleted list', icon: '•', hint: 'itemize', source: env('itemize', '  \\item '), caret: envCaret('itemize') + 6, group: 'Basic' },
  { kind: 'enumerate', label: 'Numbered list', icon: '1.', hint: 'enumerate', source: env('enumerate', '  \\item '), caret: envCaret('enumerate') + 6, group: 'Basic' },
  { kind: 'equation', label: 'Equation', icon: '∑', hint: 'A numbered display', source: env('equation'), caret: envCaret('equation'), group: 'Maths' },
  { kind: 'align', label: 'Aligned equations', icon: '≡', hint: 'align: several lines, aligned at &', source: env('align', '  a &= b \\\\\n  c &= d'), caret: envCaret('align'), group: 'Maths', needs: 'align' },
  { kind: 'proof', label: 'Proof', icon: '∎', hint: 'proof environment', source: env('proof'), caret: envCaret('proof'), group: 'Maths', needs: 'proof' },
  { kind: 'figure', label: 'Figure', icon: '▣', hint: 'figure: a graphic with a caption', group: 'Floats',
    ...tpl('\\begin{figure}[t]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{‸}\n  \\caption{}\n  \\label{fig:}\n\\end{figure}') },
  { kind: 'table', label: 'Table', icon: '▦', hint: 'table: a tabular with a caption', group: 'Floats',
    ...tpl('\\begin{table}[t]\n  \\centering\n  \\begin{tabular}{ll}\n    ‸a & b \\\\\n    c & d\n  \\end{tabular}\n  \\caption{}\n  \\label{tab:}\n\\end{table}') },
  { kind: 'title', label: 'Title', icon: 'T', hint: '\\maketitle: title, authors, date from the preamble', source: '\\maketitle', group: 'Document' },
  { kind: 'abstract', label: 'Abstract', icon: 'A', hint: 'abstract environment', source: env('abstract'), caret: envCaret('abstract'), group: 'Document', needs: 'abstract' },
  { kind: 'appendix', label: 'Appendix', icon: '§', hint: '\\appendix: later sections are lettered', source: '\\appendix', group: 'Document' },
  { kind: 'bibliography', label: 'Bibliography', icon: '[1]', hint: 'the references', group: 'Document',
    source: (pkgs) => (pkgs.has('biblatex') ? '\\printbibliography' : '\\bibliographystyle{plain}\n\\bibliography{}') },
  { kind: 'hint', label: 'Hint', icon: '?', hint: 'webhint: blurred until clicked', source: env('webhint'), caret: envCaret('webhint'), group: 'Web', needs: 'webhint' },
  { kind: 'note', label: 'Note', icon: '▍', hint: 'webnote: set off from the text', source: env('webnote'), caret: envCaret('webnote'), group: 'Web', needs: 'webnote' },
];

const THM_ICON = (name: string) => name.replace(/[^A-Za-z⋆]/g, '').slice(0, 1).toUpperCase() || '⋆';
const bareEnv = (e: string) => e.replace(/\*$/, '');
const names = (list: string) => list.split(',').map((x) => blankComments(x).trim()).filter(Boolean);
const optionSet = (opt: string | null) => new Set(names(opt ?? '').map((o) => o.replace(/\s+/g, '')));

/** what the source decides: the bundles brought, the theorems declared or brought, the environments defined, and
 *  whether something is left to TeX */
interface Decided { packages: Set<string>; bundles: Set<string>; theorems: TheoremKind[]; defined: { env: string; proof: boolean }[]; undecided: boolean }
function decide(preamble: string): Decided {
  const s: string = blankComments(preamble);
  const cls = commandCalls(preamble, 'documentclass', 1)[0];
  const className = cls ? blankComments(cls.args[0]).trim() : 'article';          // none: article (as the engine does)
  const byClass = CLASSES[className]?.(optionSet(cls?.opt ?? null));
  const bundles = new Set(['kernel', ...(byClass?.bundles ?? [])]);
  let undecided = !byClass;
  const packages = new Set<string>();
  for (const cmd of ['usepackage', 'RequirePackage']) for (const c of commandCalls(preamble, cmd, 1)) for (const p of names(c.args[0])) packages.add(p);
  for (const p of packages) {
    if (PACKAGES[p]) PACKAGES[p].forEach((b) => bundles.add(b));
    else if (!DEFINE_NONE.has(p)) undecided = true;
  }
  if (usesAny(preamble, ['input', 'include', 'InputIfFileExists'])) undecided = true;
  const theorems = theoremKinds(s);
  for (const e of byClass?.theorems ?? []) theorems.push(broughtTheorem(e));
  return { packages, bundles, theorems, defined: definedEnvironments(s), undecided };
}
const broughtTheorem = (e: string): TheoremKind => ({ env: e, name: cap(bareEnv(e)), numbered: !e.endsWith('*'), style: 'plain' });

/** the probe's questions: what is undecided and not defined already */
function questions(d: Decided): string[] {
  if (!d.undecided) return [];
  const known = new Set(d.theorems.map((t) => t.env));
  const envs = new Set<string>();
  for (const b of d.bundles) for (const [e] of BUNDLES[b] ?? []) envs.add(e);
  for (const x of d.defined) envs.add(x.env);
  return [...Object.keys(PROBED_BUNDLE), ...THEOREM_NAMES].filter((e) => !envs.has(e) && !known.has(e));
}

function build(d: Decided, yes: ReadonlySet<string>): Offered {
  const bundles = new Set(d.bundles), theorems = [...d.theorems];
  for (const e of yes) { if (PROBED_BUNDLE[e]) bundles.add(PROBED_BUNDLE[e]); else theorems.push(broughtTheorem(e)); }
  const envs = new Map<string, string>();
  for (const b of bundles) for (const [e, k] of BUNDLES[b] ?? []) envs.set(e, k);
  for (const x of d.defined) if (x.proof) envs.set(x.env, 'proof'); else if (BUILTIN.some((k) => k.needs === x.env)) envs.set(x.env, kindNeeding(x.env));
  const thmSet = new Set<string>();
  for (const t of theorems) if (!envs.has(t.env)) { envs.set(t.env, bareEnv(t.env)); thmSet.add(t.env); }
  const items: Kind[] = BUILTIN.filter((k) => !k.needs || envs.has(k.needs)).map(({ needs: _, ...k }) => ({ ...k, source: typeof k.source === 'function' ? k.source(d.packages) : k.source }));
  const seen = new Set(items.map((k) => k.kind));
  const thmItems: Kind[] = [];
  for (const t of theorems) {
    if (seen.has(t.env) || !thmSet.has(t.env)) continue;
    seen.add(t.env);
    thmItems.push({ kind: t.env, label: t.name, icon: THM_ICON(t.name), group: 'Theorems',
      hint: `${t.env}${t.numbered ? '' : ' · unnumbered'}${t.sibling ? ` · shares ${t.sibling}` : ''}${t.within ? ` · within ${t.within}` : ''}`,
      source: env(t.env), caret: envCaret(t.env), theorem: t });
  }
  const custom = d.defined.map((x) => x.env).filter((e) => !seen.has(e)).map((e): Kind => ({
    kind: 'raw', env: e, label: cap(e), icon: '{}', group: 'Environments', hint: `\\begin{${e}} from the preamble`, source: env(e), caret: envCaret(e) }));
  // theorems right after the maths kinds, before floats
  const at = items.findIndex((k) => k.group === 'Floats');
  items.splice(at < 0 ? items.length : at, 0, ...thmItems);
  return { kinds: [...items, ...custom], envs, theorems: thmSet };
}
const kindNeeding = (e: string) => BUILTIN.find((k) => k.needs === e)!.kind;

/** What the document offers (see the header). */
export function offeredKinds(preamble: string | null | undefined, o?: { probe?: undefined }): Offered;
export function offeredKinds(preamble: string | null | undefined, o: { probe: Probe }): Promise<Offered>;
export function offeredKinds(preamble: string | null | undefined, o: { probe?: Probe } = {}): Offered | Promise<Offered> {
  const d = decide(preamble ?? '');
  const probe = o.probe;
  if (!probe) return build(d, new Set());
  const ask = questions(d);
  return Promise.all(ask.map((e) => probe(e).then((y) => y === true, () => false)))
    .then((ys) => build(d, new Set(ask.filter((_, i) => ys[i]))));
}

/** The kind of a block that is environment `env` (a starred form: its base's), or null: not one the document defines. */
export function kindOfEnv(e: string, offered: Offered): string | null {
  return offered.envs.get(e) ?? offered.envs.get(bareEnv(e)) ?? null;
}

/** A block's kind from its source: what it starts with, an environment only when the document defines it. */
export function guessKind(source: string, offered: Offered): string {
  const s: string = blankComments(source).trim();
  let m = /^\\(sub)?(sub)?section\*?\s*[[{]/.exec(s);
  if (m) return m[2] ? 'subsubheading' : m[1] ? 'subheading' : 'heading';
  if (/^\\(part|chapter)\*?\s*[[{]/.test(s)) return 'heading';
  if (/^\\paragraph\*?\s*[[{]/.test(s)) return 'paragraph-heading';
  if (/^\\maketitle\b/.test(s)) return 'title';
  if (/^\\appendix\b/.test(s)) return 'appendix';
  if (/^\\(printbibliography|bibliography\{|bibliographystyle\{)/.test(s)) return 'bibliography';
  m = /^\\begin\{([\w@]+\*?)\}/.exec(s);
  if (m) {
    const k = kindOfEnv(m[1], offered);
    if (k === 'restatable') { const r = /^\\begin\{restatable\*?\}(\[[^\]]*\])?\{(\w+)\}/.exec(s); return r && offered.theorems.has(r[2]) ? r[2] : 'paragraph'; }
    return k ?? 'paragraph';
  }
  if (/^\\\[/.test(s)) return 'equation';
  return 'paragraph';
}

/** Short label of a kind for the gutter/outline tooltips. */
export function kindLabel(kind: string, preamble: string): string {
  if (labelsFor?.preamble !== preamble) labelsFor = { preamble, kinds: offeredKinds(preamble).kinds };
  return labelsFor.kinds.find((x) => x.kind === kind)?.label ?? cap(kind);
}
let labelsFor: { preamble: string; kinds: Kind[] } | null = null;       // the last preamble's (a label per block, one preamble)

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
