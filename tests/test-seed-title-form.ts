// the seed transform scripts/seed-title-form.ts (Node): the sample documents' title commands become one
// \ReflowedMeta, nothing lost (names, emails, ORCIDs, affiliations, funding, the title's \thanks), the rest of the
// preamble untouched, idempotent; and the built seeds (build/seed/*.json, paper content: on disk, not in git) carry
// it when they are there.
//   node tests/test-seed-title-form.ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTitleForm, titleLosses } from '../scripts/seed-title-form.ts';
import { readMeta, get } from '../app/src/meta/model.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
let n = 0, failed = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400)}` : ''}`); };

const LIPICS = String.raw`\documentclass[a4paper,UKenglish]{lipics-v2021}
\usepackage{tikz}
\title{A Title}
\author{Ada Lovelace}{University of Somewhere, UK \and Other Place}{ada@example.org}{https://orcid.org/0000-0002-1825-0097}{Funded by a grant.}
\author{Bo Li}{Other Place}{}{}{}
\authorrunning{A. Lovelace and B. Li}
\keywords{one, two}
\EventLogo{eatcs}
`;
const ARTICLE = String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Flips\thanks{Funded by ERC.}}
\date{}
\author{Ann One, Bob Two\\Cat Three
\\[9pt]
Institute of Informatics\\
University of Warsaw, Poland
}
\newcommand{\x}{y}
`;
for (const [label, pre] of [['lipics', LIPICS], ['article', ARTICLE]] as const) {
  const r = withTitleForm(pre);
  const m = readMeta(r.preamble);
  check(`${label}: one \\ReflowedMeta with the package, marked as an editor addition`, !!m.cmd && /\\usepackage\{reflowed-meta\} % editor addition/.test(r.preamble) && !/\\author\b/.test(r.preamble.replace(/\\ReflowedMeta[\s\S]*$/, '')), r.preamble);
  check(`${label}: nothing lost`, titleLosses(pre, r.preamble).length === 0, titleLosses(pre, r.preamble));
  check(`${label}: the rest of the preamble untouched`, pre.split('\n').filter((l) => !/\\(title|author|date|authorrunning|keywords)\b|^\s*(Institute|University|\\\\)|^\}$|Cat Three/.test(l)).every((l) => r.preamble.includes(l)));
  check(`${label}: idempotent`, withTitleForm(r.preamble).preamble === r.preamble);
  if (label === 'lipics') {
    const a = m.meta.authors[0];
    check('lipics: email, ORCID, funding, both affiliations, the running authors', get(a.fields, 'email') === 'ada@example.org' && get(a.fields, 'orcid') === '0000-0002-1825-0097'
      && get(a.fields, 'funding') === 'Funded by a grant.' && (get(a.fields, 'affil') ?? '').split(',').length === 2 && m.meta.affiliations.length === 2 && /\\EventLogo\{eatcs\}/.test(r.preamble), m.meta);
  } else {
    check('article: three names, one affiliation for all, the title\'s \\thanks', m.meta.authors.length === 3 && m.meta.affiliations.length === 1 && /ERC/.test(get(m.meta.top, 'thanks') ?? ''), m.meta);
  }
}
check('a lost field is caught (titleLosses)', titleLosses(LIPICS, withTitleForm(LIPICS).preamble.replace(/, email = \{ada@example.org\}/, '')).some((x) => /email/.test(x)));

// the built seeds
for (const [f, authors, orcids, emails, affil] of [['build/seed/intro.json', 0, 0, 0, false], ['build/seed/example.json', 1, 1, 1, true]] as const) {
  const p = join(HERE, f);
  if (!existsSync(p)) { console.log(`(${f} not built: skipped)`); continue; }
  const pre: string = JSON.parse(readFileSync(p, 'utf8')).init.preamble;
  const m = readMeta(pre);
  const as = m.meta.authors;
  check(`${f}: the title in \\ReflowedMeta (the form opens filled): ${authors} authors, ${orcids} ORCID, ${emails} email`, !!m.cmd && as.length === authors
    && as.filter((a) => get(a.fields, 'orcid')).length === orcids && as.filter((a) => get(a.fields, 'email')).length === emails && as.every((a) => !!get(a.fields, 'affil') === affil), as.map((a) => a.fields));
}
console.log(`\n${n - failed}/${n} checks passed`);
process.exit(failed ? 1 : 0);
