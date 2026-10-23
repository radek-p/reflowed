// "Convert to the form": a preamble's own \title, \author … read into the
// title data, for the classes the package has adapters for (article and its
// relatives, with or without authblk; lipics-v2021). The result is shown to
// the author as a change and applied only when they accept it; what cannot be
// carried over is named in `notes`, never dropped silently.
//
//   readPlain(preamble, cls) → { meta, spans, notes } | null
//   convertPreamble(preamble, cls) → { preamble, meta, notes } | null

import { dropComments, parseKv, stripBraces } from './kv.ts';
import { emptyMeta, get, set, usesPackage, type Fields, type Item, type Meta } from './model.ts';
import { blankComments } from '../tex/lex.ts';
import { commandCalls, controlSequences, isSpaceChar, packageOptions, removeCalls, skipSpaces, splitTopLevel, usesAny } from '../tex/calls.ts';
import { metaBlock } from './write.ts';
import { makeId } from './edit.ts';

export interface PlainRead { meta: Meta; spans: Array<[number, number]>; notes: string[] }

const calls = commandCalls;
/** Text with the comments and spaces around it trimmed (the inside kept as written). */
function trimComments(s: string): string {
  const b = blankComments(s);
  let i = 0, j = s.length;
  while (i < j && isSpaceChar(b[i])) i++;
  while (j > i && isSpaceChar(b[j - 1])) j--;
  return s.slice(i, j);
}
/** Split at commas and the word "and" outside braces (a list of names on one line). */
function splitNames(src: string): string[] {
  const s = blankComments(src);
  const out: string[] = [];
  let d = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') d++;
    else if (c === '}') d--;
    else if (d === 0 && c === ',') { out.push(src.slice(last, i)); last = i + 1; }
    else if (d === 0 && isSpaceChar(c) && s.startsWith('and', skipSpaces(s, i)) && isSpaceChar(s[skipSpaces(s, i) + 3])) {
      out.push(src.slice(last, i)); last = skipSpaces(s, skipSpaces(s, i) + 3); i = last - 1;
    }
  }
  out.push(src.slice(last));
  return out.map(clean).filter(Boolean);
}
const takeCommand = removeCalls;
/** A line that is only an address: \\texttt{a@b} or \\href{mailto:a@b}{…}. */
function emailLine(text: string): string | null {
  const t = trimComments(text);
  for (const [cmd, n] of [['texttt', 1], ['href', 2]] as const) {
    const c = calls(t, cmd, n)[0];
    if (!c || c.start !== 0 || c.end !== t.length) continue;
    const a = cmd === 'href' ? (c.args[0].startsWith('mailto:') ? c.args[0].slice(7) : '') : c.args[0];
    if (a.includes('@') && !a.includes('{')) return a.trim();
  }
  return null;
}

const AFFIL = /\b(universit|institut|department|dept\.|school|college|laborator|faculty|academy|centre|center|inria|cnrs|google|microsoft|research|gmbh|inc\.|ltd)/i;
const clean = (s: string) => dropComments(s).replace(/\s+/g, ' ').trim();

const ORCID = /^(?:https?:\/\/(?:www\.)?orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/i;

class Builder {
  meta = emptyMeta();
  ids = new Set<string>();
  byText = new Map<string, string>();
  affil(text: string): string {
    const key = clean(text);
    const had = this.byText.get(key);
    if (had) return had;
    const id = makeId(key, this.ids);
    this.ids.add(id);
    this.byText.set(key, id);
    this.meta.affiliations.push({ fields: [['id', id], ['name', text.trim()]], origin: null });
    return id;
  }
  top(k: string, v: string | null) { this.meta.top = set(this.meta.top, k, v); }
}

function titleInto(b: Builder, pre: string, spans: Array<[number, number]>, notes: string[]) {
  const t = calls(pre, 'title', 1).pop();
  if (!t) return;
  spans.push([t.start, t.end]);
  const [rest, thanks] = takeCommand(t.args[0], 'thanks');
  b.top('title', trimComments(rest));
  if (t.opt) b.top('short-title', t.opt);
  if (thanks.length) b.top('thanks', thanks.map(trimComments).join('\n\n'));
  for (const [cmd, key] of [['date', 'date'], ['subtitle', 'subtitle'], ['keywords', 'keywords']] as const) {
    const c = calls(pre, cmd, 1).pop();
    if (c) { spans.push([c.start, c.end]); b.top(key, c.args[0].trim()); }
  }
  void notes;
}

/** The whole text is one call of cmd (spaces and comments around it aside): its last argument, else null. */
function wholeCall(text: string, cmd: string, n: number): string | null {
  const t = trimComments(text);
  const c = calls(t, cmd, n)[0];
  return c && c.start === 0 && c.end === t.length ? c.args[n - 1] : null;
}
/** what the plain export writes for authors who share their affiliations: the names in one centred
 *  \parbox, each in an \mbox (meta/plain.ts); the inside reads as a hand-written \author would. */
function unwrapAuthors(text: string): string {
  const inner = wholeCall(text, 'parbox', 2);
  return inner === null ? text : inner.replace(/^\s*\\centering(?![a-zA-Z])\s*/, '');
}
/** the separator the plain export writes after an author marked break-after (meta/plain.ts) */
const TABULAR_BREAK = '\\end{tabular}\\par\\begin{tabular}[t]{c}';

/** The exporter's \AtBeginDocument{\hypersetup{pdftitle=…, pdfauthor=…, pdfkeywords=…}} (meta/plain.ts): the package
 *  sets the same itself when hyperref is loaded, so the converted preamble does without it. Other keys: kept. */
const PDF_INFO = new Set(['pdftitle', 'pdfauthor', 'pdfkeywords']);
function exportedPdfInfo(pre: string, spans: Array<[number, number]>) {
  for (const c of calls(pre, 'AtBeginDocument', 1)) {
    const hs = wholeCall(c.args[0], 'hypersetup', 1);
    const kv = hs === null ? [] : parseKv(hs);
    if (kv[0]?.key === 'pdftitle' && kv.every((e) => PDF_INFO.has(e.key) && e.value !== null)) spans.push([c.start, c.end]);
  }
}

/** article and relatives: \author{A\thanks{…}, B \\ affiliation \and C \\ …} */
function articleAuthors(b: Builder, pre: string, spans: Array<[number, number]>, notes: string[]) {
  const all = calls(pre, 'author', 1);
  if (!all.length) return;
  if (all.length > 1) notes.push(`${all.length} \\author commands: the last counts, as in LaTeX`);
  const a = all[all.length - 1];
  for (const x of all) spans.push([x.start, x.end]);
  exportedPdfInfo(pre, spans);
  const rows = unwrapAuthors(a.args[0]).split(TABULAR_BREAK);
  const blocks = rows.flatMap((row, r) => splitTopLevel(row, ['and']).map((p, k, ps) => ({ text: p.text, rowEnd: k === ps.length - 1 && r < rows.length - 1 })));
  for (const { text: block, rowEnd } of blocks) {
    const lines = splitTopLevel(block, ['\\']);
    const names: Array<{ text: string; breakAfter: boolean }> = [];
    const affLines: string[] = [], emails: string[] = [];
    let inAffil = false;
    lines.forEach((ln, i) => {
      let text = ln.text;
      const [noMail, mails] = takeCommand(text, 'email');
      text = noMail;
      emails.push(...mails);
      const mail = emailLine(text);
      if (mail) { emails.push(mail); return; }
      if (!clean(text)) return;
      if (!inAffil && (AFFIL.test(text) && !usesAny(text, ['thanks']))) inAffil = true;
      if (inAffil) affLines.push(text.trim());
      else {
        const ns = splitNames(text);
        ns.forEach((n, k) => names.push({ text: n, breakAfter: k === ns.length - 1 && !!ln.sep && !ln.sep.includes('[') }));
      }
      if (ln.sep.includes('[')) inAffil = true;      // \\[9pt]: the names end here
      void i;
    });
    if (names.length) names[names.length - 1].breakAfter = rowEnd;
    const affId = affLines.length ? b.affil(affLines.join('\\\\ ')) : null;
    names.forEach((n, k) => {
      let [name, thanks] = takeCommand(wholeCall(n.text, 'mbox', 1) ?? n.text, 'thanks');
      if (usesAny(name, ['footnotemark', 'inst', 'textsuperscript'])) notes.push(`kept as written in a name: ${clean(name)}`);
      let f: Fields = [['name', clean(name)]];
      if (affId) f.push(['affil', affId]);
      if (emails.length === names.length) f.push(['email', emails[k]]);
      else if (emails.length && k === 0) f.push(['email', emails.join(', ')]), emails.length > 1 && notes.push('several emails for one block of names: given to its first name');
      if (thanks.length) f.push(['thanks', thanks.join(' ')]);
      if (n.breakAfter) f.push(['break-after', null]);
      b.meta.authors.push({ fields: f, origin: null } as Item);
      f = [];
    });
  }
}

/** authblk: \author[1,2]{name}, \affil[1]{text} */
function authblkAuthors(b: Builder, pre: string, spans: Array<[number, number]>, notes: string[]) {
  const marks = new Map<string, string>();
  for (const c of calls(pre, 'affil', 1)) {
    spans.push([c.start, c.end]);
    const id = b.affil(c.args[0]);
    for (const m of (c.opt ?? '').split(',').map((s) => s.trim()).filter(Boolean)) marks.set(m, id);
    if (!c.opt) marks.set('', id);
  }
  for (const c of calls(pre, 'author', 1)) {
    spans.push([c.start, c.end]);
    const [name, thanks] = takeCommand(c.args[0], 'thanks');
    const ids = (c.opt ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((m) => marks.get(m)).filter((x): x is string => !!x);
    if (!c.opt && marks.has('')) ids.push(marks.get('')!);
    const f: Fields = [['name', clean(name)]];
    if (ids.length) f.push(['affil', ids.join(', ')]);
    if (thanks.length) f.push(['thanks', thanks.join(' ')]);
    b.meta.authors.push({ fields: f, origin: null });
  }
  void notes;
}

/** lipics-v2021: \author{name}{affiliations, \and between}{email}{orcid}{funding} */
function lipicsAuthors(b: Builder, pre: string, spans: Array<[number, number]>, notes: string[]) {
  for (const c of calls(pre, 'author', 5)) {
    spans.push([c.start, c.end]);
    const [name, email, orcid, funding] = [c.args[0], c.args[2], c.args[3], c.args[4]];
    const ids = splitTopLevel(c.args[1], ['and']).map((p) => p.text.trim()).filter(Boolean).map((t) => b.affil(t));
    const f: Fields = [['name', name.trim()]];
    if (ids.length) f.push(['affil', ids.join(', ')]);
    if (email.trim()) f.push(['email', email.trim()]);
    if (orcid.trim()) {
      const m = ORCID.exec(orcid.trim());
      f.push(['orcid', m ? m[1] : orcid.trim()]);
    }
    if (funding.trim()) f.push(['funding', funding.trim()]);
    b.meta.authors.push({ fields: f, origin: null });
  }
  const names = b.meta.authors.map((a) => a.fields[0][1] as string);
  const dflt = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  for (const [cmd, key] of [['authorrunning', 'short-authors'], ['Copyright', 'copyright'], ['titlerunning', 'short-title'], ['funding', 'funding']] as const) {
    const c = calls(pre, cmd, 1).pop();
    if (!c) continue;
    spans.push([c.start, c.end]);
    const v = c.args[0].trim();
    if ((key === 'copyright' || key === 'short-authors') && v === dflt) continue;   // the package's default
    b.top(key, v);
  }
  void notes;
}

/** Calls at the top level (not inside another command's argument), in source order, of several commands. */
function topCalls(pre: string, names: Array<[string, number]>) {
  const top = new Set(controlSequences(pre).filter((c) => c.depth === 0).map((c) => c.start));
  return names.flatMap(([name, n]) => calls(pre, name, n).map((c) => ({ ...c, name }))).filter((c) => top.has(c.start)).sort((x, y) => x.start - y.start);
}
const ORCID_ID = (v: string) => { const m = ORCID.exec(v.trim()); return m ? m[1] : v.trim(); };

/** llncs: \author{A\inst{1,2}\orcidID{…}\thanks{…} \and B\inst{2}}, \institute{X \\ \email{…} \and Y}, \authorrunning, \titlerunning */
function llncsAuthors(b: Builder, pre: string, spans: Array<[number, number]>, notes: string[]) {
  const inst = calls(pre, 'institute', 1).pop();
  const ids: string[] = [];
  const instMails: string[][] = [];
  if (inst) {
    spans.push([inst.start, inst.end]);
    for (const part of splitTopLevel(inst.args[0], ['and'])) {
      const [noMail, mails] = takeCommand(part.text, 'email');
      const lines = splitTopLevel(noMail, ['\\']).map((l) => trimComments(l.text)).filter(Boolean);
      ids.push(b.affil(lines.join('\\\\ ')));
      instMails.push(mails.map((m) => m.trim()));
    }
  }
  const a = calls(pre, 'author', 1).pop();
  if (!a) return;
  spans.push([a.start, a.end]);
  for (const part of splitTopLevel(a.args[0], ['and'])) {
    let [text, nums] = takeCommand(part.text, 'inst');
    let orcid: string[];
    [text, orcid] = takeCommand(text, 'orcidID');
    let thanks: string[];
    [text, thanks] = takeCommand(text, 'thanks');
    const mine = nums.join(',').split(',').map((x) => Number(x.trim())).filter((x) => x >= 1 && x <= ids.length);
    const f: Fields = [['name', clean(text)]];
    if (mine.length) f.push(['affil', mine.map((k) => ids[k - 1]).join(', ')]);
    if (orcid.length) f.push(['orcid', ORCID_ID(orcid[0])]);
    if (thanks.length) f.push(['thanks', thanks.map(trimComments).join(' ')]);
    b.meta.authors.push({ fields: f, origin: null });
  }
  // an institute's emails: to the authors whose first institute it is, in order, when the counts match
  instMails.forEach((mails, k) => {
    const all = mails.join(',').split(',').map((x) => x.trim()).filter(Boolean);
    if (!all.length) return;
    const who = b.meta.authors.filter((au) => (get(au.fields, 'affil') ?? '').split(',')[0].trim() === ids[k]);
    if (who.length === all.length) who.forEach((au, i) => { au.fields.push(['email', all[i]]); });
    else notes.push(`the emails of institute ${k + 1} (${all.join(', ')}) do not match its authors one to one: not carried over`);
  });
  for (const [cmd, key] of [['authorrunning', 'short-authors'], ['titlerunning', 'short-title']] as const) {
    const c = calls(pre, cmd, 1).pop();
    if (c) { spans.push([c.start, c.end]); b.top(key, c.args[0].trim()); }
  }
}

/** amsart and revtex: a sequence of \author, then that author's \address / \affiliation, \email, \thanks.
 *  revtex: an \affiliation belongs to every author since the last one that has one (a group shares it). */
function sequenceAuthors(b: Builder, pre: string, spans: Array<[number, number]>, notes: string[], revtex: boolean) {
  const seq = topCalls(pre, [['author', 1], ['address', 1], ['affiliation', 1], ['email', 1], ['thanks', 1], ['curraddr', 1]]);
  let group: Item[] = [];
  let lastWasAffil = false;
  for (const c of seq) {
    spans.push([c.start, c.end]);
    const cur = b.meta.authors[b.meta.authors.length - 1];
    if (c.name === 'author') {
      if (lastWasAffil) group = [];
      const it: Item = { fields: [['name', clean(c.args[0])]], origin: null };
      if (c.opt) it.fields.push(['short-name', c.opt]);
      b.meta.authors.push(it);
      group.push(it);
      lastWasAffil = false;
      continue;
    }
    if (!cur && c.name === 'thanks') { b.top('thanks', [get(b.meta.top, 'thanks'), trimComments(c.args[0])].filter(Boolean).join('\n\n')); continue; }   // amsart: a note on the title
    if (!cur) { notes.push(`\\${c.name} before any \\author: left out`); continue; }
    if (c.name === 'address' || c.name === 'affiliation') {
      const lines = splitTopLevel(c.args[0], ['\\\\', 'newline']).map((l) => trimComments(l.text)).filter(Boolean);
      // amsart: one \address may hold several affiliations on separate lines (as the adapter writes them)
      const texts = c.name === 'address' ? lines : [lines.join('\\\\ ')];
      for (const t of texts) {
        const id = b.affil(t);
        for (const au of revtex ? group : [cur]) {
          const had = (get(au.fields, 'affil') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
          if (!had.includes(id)) au.fields = set(au.fields, 'affil', [...had, id].join(', '));
        }
      }
      lastWasAffil = true;
    } else if (c.name === 'email') cur.fields = set(cur.fields, 'email', c.args[0].trim());
    else if (c.name === 'thanks') cur.fields = set(cur.fields, 'thanks', [get(cur.fields, 'thanks'), trimComments(c.args[0])].filter(Boolean).join(' '));
    else notes.push(`\\curraddr kept as written: ${clean(c.args[0])}`), cur.fields.push(['curraddr', c.args[0].trim()]);
  }
}

export function readPlain(pre: string, cls: string): PlainRead | null {
  const b = new Builder();
  const spans: Array<[number, number]> = [], notes: string[] = [];
  const kind = /^(lipics|oasics)-v20/.test(cls) ? 'lipics'
    : cls === 'llncs' ? 'llncs' : /^ams(art|proc|book)$/.test(cls) ? 'amsart' : /^revtex4-[12]$/.test(cls) ? 'revtex'
    : /^(article|report|book|scrartcl|scrreprt|scrbook|memoir|extarticle)$/.test(cls) ? (packageOptions(pre, 'authblk') !== null ? 'authblk' : 'article')
    : null;
  if (!kind) return null;
  titleInto(b, pre, spans, notes);
  if (kind === 'lipics') lipicsAuthors(b, pre, spans, notes);
  else if (kind === 'authblk') authblkAuthors(b, pre, spans, notes);
  else if (kind === 'llncs') llncsAuthors(b, pre, spans, notes);
  else if (kind === 'amsart') sequenceAuthors(b, pre, spans, notes, false);
  else if (kind === 'revtex') {
    // REVTeX takes its front matter after \begin{document}; in a preamble it sits in a begindocument/end hook
    // (as the plain export writes it). A paper with it in the body is not converted here yet.
    const hook = calls(pre, 'AddToHook', 2).find((c) => c.args[0].trim() === 'begindocument/end' && usesAny(c.args[1], ['author', 'title']));
    if (hook) {
      sequenceAuthors(b, hook.args[1], [], notes, true);
      spans.length = 0;
      spans.push([hook.start, hook.end]);
    } else sequenceAuthors(b, pre, spans, notes, true);
  }
  else articleAuthors(b, pre, spans, notes);
  if (!spans.length) return null;
  // affiliations in the order of first use (the numbering classes print)
  const firstUse = new Map<string, number>();
  b.meta.authors.forEach((a, i) => (a.fields.find(([k]) => k === 'affil')?.[1] ?? '').split(',').map((s) => s.trim()).forEach((id) => { if (id && !firstUse.has(id)) firstUse.set(id, i * 100 + firstUse.size); }));
  b.meta.affiliations.sort((x, y) => (firstUse.get(x.fields[0][1] as string) ?? 1e9) - (firstUse.get(y.fields[0][1] as string) ?? 1e9));
  return { meta: b.meta, spans, notes };
}

/** The preamble with its title commands replaced by \usepackage{reflowed-meta} + \ReflowedMeta. */
export function convertPreamble(pre: string, cls: string): { preamble: string; meta: Meta; notes: string[] } | null {
  const r = readPlain(pre, cls);
  if (!r) return null;
  const spans = r.spans.sort((a, b) => a[0] - b[0]);
  const at = spans[0][0];
  let out = pre;
  for (const [s, e0] of [...spans].reverse()) {
    let e = e0, s0 = s;
    // the command alone on its line: the line goes
    const ls = out.lastIndexOf('\n', s - 1) + 1;
    let k = e;
    while (out[k] === ' ' || out[k] === '\t') k++;
    if (/^\s*$/.test(out.slice(ls, s)) && (out[k] === '\n' || k >= out.length)) { s0 = ls; e = Math.min(k + 1, out.length); }
    out = out.slice(0, s0) + (s === at ? '\u0000' : '') + out.slice(e);
  }
  const block = `${usesPackage(pre) ? '' : '\\usepackage{reflowed-meta}\n'}${metaBlock(r.meta)}\n`;
  out = out.replace('\u0000', block);
  return { preamble: out, meta: r.meta, notes: r.notes };
}

export { stripBraces };
