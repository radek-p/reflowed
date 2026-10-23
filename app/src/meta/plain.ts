// The export option "plain class commands": the title data written as the class's own commands
// (\title, \author, \affil …), what tex/reflowed-meta.sty's adapter would call, for venues that refuse
// unknown packages. Mirrors the package's article, authblk and lipics adapters; meta/proof/test-tex.ts
// checks each against the package on native Tectonic, pixel for pixel.
//
//   adapterFor(preamble) → 'article' | 'authblk' | 'lipics' | null    (null: no adapter here yet; keep the package)
//   plainCommands(meta, adapter, { hyperref }) → the commands, one per line
//   plainPreamble(preamble) → the preamble with \usepackage{reflowed-meta} and \ReflowedMeta replaced, or null
import { affilIds, get, isTrue, metaCommands, readMeta, type Item, type Meta } from './model.ts';
import { commandCalls, packageOptions } from '../tex/calls.ts';
import { parseKv } from './kv.ts';

export type Adapter = 'article' | 'authblk' | 'lipics' | 'llncs' | 'amsart' | 'revtex';
const CLASSES: Record<string, Adapter> = { 'lipics-v2021': 'lipics', 'oasics-v2021': 'lipics', llncs: 'llncs', amsart: 'amsart', amsproc: 'amsart', amsbook: 'amsart', 'revtex4-2': 'revtex', 'revtex4-1': 'revtex' };
const ADAPTERS = new Set<string>(['article', 'authblk', 'lipics', 'llncs', 'amsart', 'revtex']);
const ARTICLE = new Set(['article', 'report', 'book', 'scrartcl', 'scrreprt', 'scrbook', 'memoir']);

export function adapterFor(pre: string): Adapter | null {
  const opts = packageOptions(pre, 'reflowed-meta');
  const forced = opts ? parseKv(opts).find((e) => e.key === 'adapter')?.value : null;
  const cls = commandCalls(pre, 'documentclass', 1)[0]?.args[0].trim() ?? '';
  const a = forced ?? CLASSES[cls] ?? (ARTICLE.has(cls) ? 'article' : null);
  if (a === 'article' && packageOptions(pre, 'authblk') !== null) return 'authblk';
  return a && ADAPTERS.has(a) ? (a as Adapter) : null;
}

const val = (fields: Item['fields'] | Meta['top'], k: string) => get(fields, k);
const has = (fields: Item['fields'] | Meta['top'], k: string) => get(fields, k) !== undefined;

export function plainCommands(m: Meta, adapter: Adapter, o: { hyperref?: boolean } = {}): string {
  const T = m.top;
  const byId = new Map(m.affiliations.map((a, k) => [String(get(a.fields, 'id') ?? ''), { a, index: k + 1 }]));
  const affilText = (id: string) => {
    const a = byId.get(id)?.a;
    if (!a) return '';
    if (has(a.fields, 'name')) return val(a.fields, 'name') ?? '';
    return ['department', 'institution', 'address', 'city', 'country'].filter((k) => has(a.fields, k)).map((k) => val(a.fields, k) ?? '').join(', ');
  };
  const names = m.authors.map((a) => val(a.fields, 'name') ?? '');
  const join = (sep: string, last: string) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(sep)}${last}${names[names.length - 1]}`);
  const out: string[] = [];
  const anonymous = isTrue(T, 'anonymous');

  if (adapter === 'lipics') {
    out.push(`\\title{${val(T, 'title') ?? ''}}`);
    if (has(T, 'subtitle')) out.push(`\\subtitle{${val(T, 'subtitle')}}`);
    if (has(T, 'short-title')) out.push(`\\titlerunning{${val(T, 'short-title')}}`);
    for (const a of m.authors) {
      const f = a.fields;
      const orcid = val(f, 'orcid');
      const url = orcid == null ? '' : orcid.startsWith('http') ? orcid : `https://orcid.org/${orcid}`;
      const fund = `${val(f, 'funding') ?? ''}${has(f, 'thanks') ? `${has(f, 'funding') ? ' ' : ''}${val(f, 'thanks')}` : ''}`;
      out.push(`\\author{${val(f, 'name') ?? ''}}{${affilIds(a).map(affilText).join(' \\and ')}}{${val(f, 'email') ?? ''}}{${url}}{${fund}}`);
    }
    out.push(`\\authorrunning{${has(T, 'short-authors') ? val(T, 'short-authors') : join(', ', ' and ')}}`);
    out.push(`\\Copyright{${has(T, 'copyright') ? val(T, 'copyright') : join(', ', ' and ')}}`);
    if (has(T, 'keywords')) out.push(`\\keywords{${val(T, 'keywords')}}`);
    if (has(T, 'funding')) out.push(`\\funding{${val(T, 'funding')}}`);
    return out.join('\n');
  }

  const anonAuthor = () => `\\author{${has(T, 'anonymous-text') ? val(T, 'anonymous-text') : 'Anonymous author(s)'}}`;
  const titleThanks = () => (anonymous ? '' : `${has(T, 'thanks') ? `\\thanks{${val(T, 'thanks')}}` : ''}${has(T, 'funding') ? `\\thanks{${val(T, 'funding')}}` : ''}`);
  const thanksNotes = (a: Item) => {
    const f = a.fields;
    let s = '';
    if (has(f, 'thanks')) s += `\\thanks{${val(f, 'thanks')}}`;
    if (has(f, 'funding')) s += `\\thanks{${val(f, 'funding')}}`;
    if (isTrue(f, 'corresponding')) s += `\\thanks{${has(T, 'corresponding-text') ? val(T, 'corresponding-text') : 'Corresponding author.'}}`;
    if (isTrue(f, 'equal')) s += `\\thanks{${has(T, 'equal-text') ? val(T, 'equal-text') : 'Equal contribution.'}}`;
    return s;
  };
  const sub = has(T, 'subtitle') ? `\\\\{\\large ${val(T, 'subtitle')}}` : '';
  if (adapter === 'llncs') {
    out.push(`\\title{${val(T, 'title') ?? ''}${titleThanks()}}`);
    if (has(T, 'subtitle')) out.push(`\\subtitle{${val(T, 'subtitle')}}`);
    if (has(T, 'short-title')) out.push(`\\titlerunning{${val(T, 'short-title')}}`);
    if (anonymous) { out.push(anonAuthor(), '\\institute{}'); return out.join('\n'); }
    out.push(`\\author{${m.authors.map((a) => {
      const inst = affilIds(a).map((id) => byId.get(id)?.index ?? '').join(',');
      return `${val(a.fields, 'name') ?? ''}${inst ? `\\inst{${inst}}` : ''}${has(a.fields, 'orcid') ? `\\orcidID{${val(a.fields, 'orcid')}}` : ''}${thanksNotes(a)}`;
    }).join(' \\and ')}}`);
    out.push(`\\authorrunning{${has(T, 'short-authors') ? val(T, 'short-authors') : join(', ', ' and ')}}`);
    out.push(`\\institute{${m.affiliations.map((af, k) => {
      const mails = m.authors.filter((a) => has(a.fields, 'email') && byId.get(affilIds(a)[0])?.index === k + 1).map((a) => val(a.fields, 'email')).join(', ');
      return `${affilText(String(get(af.fields, 'id') ?? ''))}${mails ? `\\\\\\email{${mails}}` : ''}`;
    }).join(' \\and ')}}`);
    return out.join('\n');
  }
  if (adapter === 'amsart') {
    out.push(`\\title${has(T, 'short-title') ? `[${val(T, 'short-title')}]` : ''}{${val(T, 'title') ?? ''}${sub}}`);
    if (anonymous) out.push(anonAuthor());
    else {
      const tt = titleThanks();
      if (tt) out.push(tt);
      for (const a of m.authors) {
        out.push(`\\author{${val(a.fields, 'name') ?? ''}}`);
        const ids = affilIds(a);
        if (ids.length) out.push(`\\address{${ids.map(affilText).join('\\newline ')}}`);
        if (has(a.fields, 'email')) out.push(`\\email{${val(a.fields, 'email')}}`);
        const n = thanksNotes(a);
        if (n) out.push(n);
      }
    }
    if (has(T, 'keywords')) out.push(`\\keywords{${val(T, 'keywords')}}`);
    if (has(T, 'date')) out.push(`\\date{${val(T, 'date')}}`);
    return out.join('\n');
  }
  if (adapter === 'revtex') {
    out.push(`\\title{${val(T, 'title') ?? ''}${sub}${titleThanks()}}`);
    if (anonymous) out.push(anonAuthor());
    else for (const a of m.authors) {
      out.push(`\\author{${val(a.fields, 'name') ?? ''}}`);
      if (has(a.fields, 'email')) out.push(`\\email{${val(a.fields, 'email')}}`);
      const n = thanksNotes(a);
      if (n) out.push(n);
      for (const id of affilIds(a)) out.push(`\\affiliation{${affilText(id)}}`);
    }
    if (has(T, 'keywords')) out.push(`\\keywords{${val(T, 'keywords')}}`);
    if (has(T, 'date')) out.push(`\\date{${val(T, 'date')}}`);
    // REVTeX takes its front matter only after \begin{document}
    return `\\AddToHook{begindocument/end}{%\n${out.join('\n')}}`;
  }

  // article and authblk: the title with its notes
  let title = val(T, 'title') ?? '';
  if (has(T, 'subtitle')) title += `\\\\{\\large ${val(T, 'subtitle')}}`;
  if (!anonymous) {
    if (has(T, 'thanks')) title += `\\thanks{${val(T, 'thanks')}}`;
    if (has(T, 'funding')) title += `\\thanks{${val(T, 'funding')}}`;
  }
  out.push(`\\title{${title}}`);
  if (has(T, 'date')) out.push(`\\date{${val(T, 'date')}}`);
  const groups = new Set<string>();
  let usesEqual = false;
  const nameNotes = (a: Item) => {
    const f = a.fields;
    let s = val(f, 'name') ?? '';
    if (has(f, 'thanks')) s += `\\thanks{${val(f, 'thanks')}}`;
    if (has(f, 'funding')) s += `\\thanks{${val(f, 'funding')}}`;
    if (isTrue(f, 'corresponding')) s += `\\thanks{${has(T, 'corresponding-text') ? val(T, 'corresponding-text') : 'Corresponding author.'}}`;
    if (isTrue(f, 'equal')) {
      const g = val(f, 'equal') ?? 'true';
      usesEqual = true;
      if (groups.has(g)) s += `\\rmequalmark{${g}}`;
      else { groups.add(g); s += `\\rmequalnote{${g}}{${has(T, 'equal-text') ? val(T, 'equal-text') : 'Equal contribution.'}}`; }
    }
    return s;
  };
  if (anonymous) out.push(`\\author{${has(T, 'anonymous-text') ? val(T, 'anonymous-text') : 'Anonymous author(s)'}}`);
  else if (adapter === 'authblk') {
    for (const a of m.authors) out.push(`\\author[${affilIds(a).map((id) => byId.get(id)?.index ?? '').join(',')}]{${nameNotes(a)}}`);
    m.affiliations.forEach((af, k) => out.push(`\\affil[${k + 1}]{${affilText(String(get(af.fields, 'id') ?? ''))}}`));
  } else {
    const n = m.authors.length;
    const first = n ? val(m.authors[0].fields, 'affil') : undefined;
    const shared = n > 1 && first !== undefined && m.authors.every((a) => val(a.fields, 'affil') === first);
    const lines = (a: Item) => affilIds(a).map((id) => `\\\\${affilText(id)}`).join('');
    let authors = '';
    if (shared) {
      m.authors.forEach((a, k) => {
        authors += `\\mbox{${nameNotes(a)}}`;
        if (k < n - 1) authors += isTrue(a.fields, 'break-after') ? '\\\\' : ', ';
      });
      authors = `\\parbox{\\dimexpr\\linewidth-2\\tabcolsep\\relax}{\\centering ${authors}\\\\[1ex]${lines(m.authors[0]).slice(2)}}`;
    } else {
      m.authors.forEach((a, k) => {
        if (k > 0) authors += isTrue(m.authors[k - 1].fields, 'break-after') ? '\\end{tabular}\\par\\begin{tabular}[t]{c}' : '\\and ';
        authors += nameNotes(a) + lines(a);
        if (has(a.fields, 'email')) authors += `\\\\\\texttt{${val(a.fields, 'email')}}`;
      });
    }
    out.push(`\\author{${authors}}`);
  }
  if (o.hyperref) {
    const info = [`pdftitle={${val(T, 'title') ?? ''}}`];
    if (!anonymous) info.push(`pdfauthor={${names.join(', ')}}`);
    if (has(T, 'keywords')) info.push(`pdfkeywords={${val(T, 'keywords')}}`);
    out.push(`\\AtBeginDocument{\\hypersetup{${info.join(', ')}}}`);
  }
  // equal contribution: the first author of a group has the note, the others its mark (robust: authblk reads \\author's argument at once)
  if (usesEqual) out.unshift('\\DeclareRobustCommand\\rmequalnote[2]{\\thanks{#2}\\expandafter\\xdef\\csname rmequal@#1\\endcsname{\\the\\value{footnote}}}',
    '\\DeclareRobustCommand\\rmequalmark[1]{\\footnotemark[\\csname rmequal@#1\\endcsname]}');
  return out.join('\n');
}

/** The preamble with the package and its data replaced by the class's commands; null when there is no adapter for it. */
export function plainPreamble(pre: string): string | null {
  const adapter = adapterFor(pre);
  const cmds = metaCommands(pre);
  if (!adapter || !cmds.length) return null;
  const meta = readMeta(pre).meta;
  const hyperref = (adapter === 'article' || adapter === 'authblk') && packageOptions(pre, 'hyperref') !== null;
  let out = pre;
  // the later commands go, the first becomes the class's commands
  for (const [k, [s, , c]] of [...cmds.entries()].reverse()) out = out.slice(0, s) + (k === 0 ? plainCommands(meta, adapter, { hyperref }) : '') + out.slice(c + 1);
  const use = commandCalls(out, 'usepackage', 1).find((u) => u.args[0].split(',').map((x) => x.trim()).includes('reflowed-meta'));
  if (use) {
    const rest = use.args[0].split(',').map((x) => x.trim()).filter((x) => x && x !== 'reflowed-meta');
    let s = use.start, e = use.end;
    if (!rest.length) {
      // the package alone on its line: the line goes, with a comment after it (it is about the package)
      const ls = out.lastIndexOf('\n', s - 1) + 1;
      const le = out.indexOf('\n', e);
      if (/^[ \t]*$/.test(out.slice(ls, s)) && /^[ \t]*(%.*)?$/.test(out.slice(e, le < 0 ? out.length : le))) { s = ls; e = le < 0 ? out.length : le + 1; }
    }
    out = out.slice(0, s) + (rest.length ? `\\usepackage${use.opt ? `[${use.opt}]` : ''}{${rest.join(',')}}` : '') + out.slice(e);
  }
  return out;
}
