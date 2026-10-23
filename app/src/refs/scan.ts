// What a block's source says about references, before (or without) a
// compile: labels, references, citations, headings, \appendix, counter
// commands, definitions and thm-restate restatables. Used for the context
// prefix (contextFor), the cited keys of the bibliography block, counters the
// overlay applies at a block's start (\setcounter, \addtocounter, \appendix),
// and refsState() (offsets for autocomplete, go-to-definition, diagnostics).
// Comments are blanked first (offsets kept); verbatim is not understood.

import { blankComments as stripComments, readGroup as group } from '../tex/lex.ts';
import { startsWithDefinition } from '../tex/definitions.ts';
export { stripComments };

export interface Use { cmd: string; keys: string[]; offset: number; length: number }
export interface SourceScan {
  labels: { label: string; env: string | null; offset: number }[];
  refs: Use[];
  cites: Use[];
  headings: { level: string; starred: boolean; title: string; label: string | null; offset: number }[];
  /** theorem-like environments begun in the block, with their optional note */
  envs: { env: string; note: string | null; offset: number }[];
  appendix: boolean;
  bibliography: boolean;
  counters: { op: 'set' | 'add'; counter: string; value: number }[];
  /** the last thing in the block is a sectioning command (its \label and spaces allowed) */
  endsWithHeading: boolean;
  /** the block only defines (\newcommand, \def, … first): its source is context for later blocks */
  definitions: boolean;
  /** thm-restate: the name a `restatable` in this block defines (\name, \name*) */
  restatable: string | null;
  /** control words used with a star (\name*): candidates for restated theorems */
  starred: string[];
}

/** Optional [args] then one {group} from index i: [content, end, optional args]. */
function argAfter(s: string, i: number): [string, number, string[]] | null {
  let j = i;
  const opts: string[] = [];
  for (;;) {
    while (/\s/.test(s[j] ?? '')) j++;
    if (s[j] === '[') {
      let d = 0; const a = j;
      for (; j < s.length; j++) {
        if (s[j] === '{') { j = group(s, j)[1] - 1; continue; }
        if (s[j] === '[') d++; else if (s[j] === ']' && --d === 0) { j++; break; }
      }
      opts.push(s.slice(a + 1, j - 1));
      continue;
    }
    break;
  }
  if (s[j] !== '{') return null;
  const [g, e] = group(s, j);
  return [g, e, opts];
}

/** An optional [argument] right at i (spaces allowed), or null. */
function optArg(s: string, i: number): string | null {
  let j = i;
  while (/[ \t]/.test(s[j] ?? '')) j++;
  if (s[j] !== '[') return null;
  let d = 0; const a = j;
  for (; j < s.length; j++) {
    if (s[j] === '{') { j = group(s, j)[1] - 1; continue; }
    if (s[j] === '[') d++; else if (s[j] === ']' && --d === 0) return s.slice(a + 1, j);
  }
  return null;
}

/** The sectioning, reference and citation commands, as regex alternatives (tex/texscan.js reads the same lists). */
export const HEADINGS = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
export const REF_NAMES = ['ref', 'eqref', 'autoref', 'Autoref', 'cref', 'Cref', 'pageref', 'nameref', 'crefrange', 'Crefrange', 'labelcref', 'cpageref', 'Cpageref', 'vref', 'Vref'];
export const CITE_NAMES = ['[a-zA-Z]*cite[a-zA-Z]*', 'nocite'];
const REF_CMDS = new RegExp(`\\\\(${REF_NAMES.join('|')})\\*?(?=\\s*[{[])`, 'g');
const CITE_CMDS = new RegExp(`\\\\(${CITE_NAMES.join('|')})\\*?(?=\\s*[{[])`, 'g');
const NOT_THEOREM = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'itemize',
  'enumerate', 'description', 'figure', 'figure*', 'table', 'table*', 'tabular', 'center', 'proof', 'restatable', 'restatable*',
  'minipage', 'array', 'cases', 'split', 'aligned', 'matrix', 'pmatrix', 'bmatrix', 'NiceTabular', 'tikzpicture', 'abstract',
  'quote', 'quotation', 'verbatim', 'thebibliography', 'document', 'alignat', 'alignat*', 'flalign', 'flalign*', 'eqnarray', 'comment']);

const cache = new Map<string, SourceScan>();
export function scanSource(source: string): SourceScan {
  const hit = cache.get(source);
  if (hit) return hit;
  const s = stripComments(source);
  const out: SourceScan = { labels: [], refs: [], cites: [], headings: [], envs: [], appendix: false, bibliography: false, counters: [],
    endsWithHeading: false, definitions: startsWithDefinition(source), restatable: null, starred: [] };

  // labels, with the innermost environment open where each stands; environments
  const envStack: string[] = [];
  const tok = /\\begin\{([^}]+)\}|\\end\{([^}]+)\}|\\label(?:\[[^\]]*\])?\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = tok.exec(s))) {
    if (m[1]) {
      let env = m[1];
      if (env === 'restatable' || env === 'restatable*') {
        const a = argAfter(s, m.index + m[0].length);            // [note]{env}{name}
        if (a) {
          const b = argAfter(s, a[1]);
          if (b) out.restatable ??= b[0].trim();
          out.envs.push({ env: a[0].trim(), note: a[2][0] ?? null, offset: m.index });
          env = a[0].trim();
        }
      } else if (!NOT_THEOREM.has(env)) {
        out.envs.push({ env, note: optArg(s, m.index + m[0].length), offset: m.index });
      }
      envStack.push(env);
    } else if (m[2]) { const k = envStack.lastIndexOf(m[2]); if (k >= 0) envStack.length = k; }
    else out.labels.push({ label: m[3].trim(), env: envStack[envStack.length - 1] ?? null, offset: m.index });
  }
  REF_CMDS.lastIndex = 0;
  while ((m = REF_CMDS.exec(s))) {
    const a = argAfter(s, m.index + m[0].length);
    if (!a) continue;
    const keys = a[0].split(',').map((x) => x.trim()).filter(Boolean);
    let end = a[1];
    if (m[1] === 'crefrange' || m[1] === 'Crefrange') {
      const b = argAfter(s, a[1]);
      if (b) { keys.push(b[0].trim()); end = b[1]; }
    }
    out.refs.push({ cmd: m[1], keys, offset: m.index, length: end - m.index });
  }
  CITE_CMDS.lastIndex = 0;
  while ((m = CITE_CMDS.exec(s))) {
    const a = argAfter(s, m.index + m[0].length);
    if (!a) continue;
    const keys = a[0].split(',').map((x) => x.trim()).filter((k) => k && k !== '*');
    out.cites.push({ cmd: m[1], keys, offset: m.index, length: a[1] - m.index });
  }
  const head = new RegExp(`\\\\(${HEADINGS.join('|')})(\\*?)(?=\\s*[{[])`, 'g');
  while ((m = head.exec(s))) {
    const a = argAfter(s, m.index + m[0].length);
    if (!a) continue;
    const after = s.slice(a[1]);
    const lab = /^\s*\\label\{([^}]*)\}/.exec(after);
    out.headings.push({ level: m[1], starred: m[2] === '*', title: a[0].trim(), label: lab ? lab[1].trim() : null, offset: m.index });
    const rest = after.replace(/^\s*(\\label\{[^}]*\}\s*)?/, '');
    out.endsWithHeading = rest.trim() === '' && m[1] !== 'paragraph' && m[1] !== 'subparagraph';
  }
  out.appendix = /\\appendix(?![a-zA-Z@])/.test(s);
  out.bibliography = /\\printbibliography(?![a-zA-Z@])|\\bibliography\{/.test(s);
  const ctr = /\\(setcounter|addtocounter)\{([^}]*)\}\{\s*(-?\d+)\s*\}/g;
  while ((m = ctr.exec(s))) out.counters.push({ op: m[1] === 'setcounter' ? 'set' : 'add', counter: m[2].trim(), value: Number(m[3]) });
  const star = /\\([A-Za-z]+)\*/g;
  while ((m = star.exec(s))) if (!out.starred.includes(m[1])) out.starred.push(m[1]);
  if (cache.size > 5000) cache.clear();
  cache.set(source, out);
  return out;
}
