// A seed transform (an editor addition, not in the papers' sources): the sample papers' title and author
// commands (\title, \author, \thanks, LIPIcs's five-argument \author with its email, ORCID and funding,
// \authorrunning …) converted to ReflowedEd's title format, \usepackage{reflowed-meta} + one \ReflowedMeta{…}
//, with the title form's own converter (app/src/meta/import.ts convertPreamble), so the form opens filled and
// the class still prints the same title. Reproducible: scripts/seed.ts calls it on every seed build.
//
//   withTitleForm(preamble) -> { preamble, notes }      throws when anything would be lost (titleLosses)
//   titleLosses(before, after) -> string[]              what the converted preamble no longer says
import { convertPreamble, readPlain } from '../app/src/meta/import.ts';
import { readMeta, get, type Meta } from '../app/src/meta/model.ts';
import { className } from '../app/src/meta/edit.ts';

/** a comparable account of the title data: every author's fields, every affiliation's text, the top keys */
function account(m: Meta): string[] {
  const affil = new Map(m.affiliations.map((a) => [get(a.fields, 'id') ?? '', a.fields.filter(([k]) => k !== 'id').map(([k, v]) => `${k}=${norm(v)}`).join(';')]));
  const out = m.top.map(([k, v]) => `top ${k}=${norm(v)}`);
  m.authors.forEach((a, i) => {
    for (const [k, v] of a.fields) {
      if (k === 'affil') for (const id of (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)) out.push(`author ${i + 1} affil=${affil.get(id) ?? `?${id}`}`);
      else out.push(`author ${i + 1} ${k}=${norm(v)}`);
    }
  });
  return out.sort();
}
const norm = (v: string | null) => (v == null ? '(flag)' : v.replace(/\s+/g, ' ').trim());

/** What `after` (with \ReflowedMeta) no longer carries of `before`'s title commands. */
export function titleLosses(before: string, after: string): string[] {
  const cls = className(before) || 'article';
  const plain = readPlain(before, cls);
  const meta = readMeta(after);
  if (!plain) return ['the original title commands cannot be read'];
  if (!meta.cmd) return ['no \\ReflowedMeta in the converted preamble'];
  const want = account(plain.meta), have = new Set(account(meta.meta));
  return want.filter((x) => !have.has(x));
}

export function withTitleForm(pre: string): { preamble: string; notes: string[] } {
  if (readMeta(pre).cmd) return { preamble: pre, notes: [] };                 // already converted
  const cls = className(pre) || 'article';
  const c = convertPreamble(pre, cls);
  if (!c) throw new Error(`seed: the title of a ${cls} paper cannot be converted to \\ReflowedMeta`);
  const lost = titleLosses(pre, c.preamble);
  if (lost.length) throw new Error(`seed: converting the title to \\ReflowedMeta would lose: ${lost.join(' | ')}`);
  const preamble = c.preamble.replace(/\\usepackage\{reflowed-meta\}/, '\\usepackage{reflowed-meta} % editor addition (not in the source): the title form\'s package');
  return { preamble, notes: c.notes };
}
