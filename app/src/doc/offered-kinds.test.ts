// doc/kinds.ts offeredKinds: a kind is offered (the slash menu, guessKind, io/split.ts detectKind) only when the
// preamble and its class define its environment; doc/kind-probe.ts: the engine as the probe for what that leaves open.
//   node app/src/doc/offered-kinds.test.ts      (Node; exit 1 on a failure)
import { offeredKinds, guessKind, type Offered } from './kinds.ts';
import { engineProbe, defined } from './kind-probe.ts';
import { envsFromPreamble, splitBody, detectKind } from '../io/split.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const menu = (o: Offered) => o.kinds.map((k) => k.env ?? k.kind);
const has = (pre: string, ...kinds: string[]) => { const m = menu(offeredKinds(pre)); return kinds.every((k) => m.includes(k)); };
const none = (pre: string, ...kinds: string[]) => { const m = menu(offeredKinds(pre)); return kinds.every((k) => !m.includes(k)); };
const guess = (pre: string, src: string) => guessKind(src, offeredKinds(pre));
const env = (e: string) => `\\begin{${e}}\nx\n\\end{${e}}`;
const ART = '\\documentclass{article}\n';

// ── no preamble: article, nothing declared ──
check('no preamble: the basics, equation, abstract (article\'s) offered', has('', 'paragraph', 'heading', 'equation', 'figure', 'abstract', 'bibliography'));
check('no preamble: no proof, lemma, corollary, align offered', none('', 'proof', 'lemma', 'corollary', 'claim', 'align'), menu(offeredKinds('')));
check('no preamble: a pasted lemma, proof, align is a paragraph; an equation stays one', guess('', env('lemma')) === 'paragraph' && guess('', env('proof')) === 'paragraph'
  && guess('', env('corollary')) === 'paragraph' && guess('', env('align')) === 'paragraph' && guess('', env('equation')) === 'equation');

// ── amsthm, thmtools, a commented-out amsthm ──
check('amsthm: proof offered and guessed', has(`${ART}\\usepackage{amsthm}`, 'proof') && guess(`${ART}\\usepackage{amsthm}`, env('proof')) === 'proof');
check('amsthm in a list of packages', has(`${ART}\\usepackage{amsmath,amssymb,amsthm}`, 'proof', 'align'));
check('amsthm alone declares no theorem: no lemma or corollary', none(`${ART}\\usepackage{amsthm}`, 'lemma', 'corollary'));
check('thmtools without amsthm: no proof (thmtools defines none)', none(`${ART}\\usepackage{thmtools}`, 'proof'));
check('thmtools: \\declaretheorem{lemma} offers Lemma', has(`${ART}\\usepackage{thmtools}\n\\declaretheorem{lemma}`, 'lemma'));
check('a commented-out amsthm: no proof', none(`${ART}% \\usepackage{amsthm}\n`, 'proof') && guess(`${ART}% \\usepackage{amsthm}\n`, env('proof')) === 'paragraph');
check('amsthm as an option of ntheorem: no proof', none(`${ART}\\usepackage[amsthm]{ntheorem}`, 'proof'));
check('a commented-out \\newtheorem: no lemma', none(`${ART}\\usepackage{amsthm}\n%\\newtheorem{lemma}{Lemma}`, 'lemma'));

// ── abstract: book vs article ──
check('article: abstract offered and guessed', has(ART, 'abstract') && guess(ART, env('abstract')) === 'abstract');
check('book: no abstract; a pasted one is a paragraph', none('\\documentclass{book}', 'abstract') && guess('\\documentclass{book}', env('abstract')) === 'paragraph');
check('book with the abstract package: abstract', has('\\documentclass{book}\\usepackage{abstract}', 'abstract'));

// ── align: amsmath vs none ──
check('amsmath: align offered; align and gather guessed', has(`${ART}\\usepackage{amsmath}`, 'align') && guess(`${ART}\\usepackage{amsmath}`, env('align')) === 'align'
  && guess(`${ART}\\usepackage{amsmath}`, env('gather*')) === 'equation');
check('mathtools and amsart bring amsmath: align', has(`${ART}\\usepackage{mathtools}`, 'align') && has('\\documentclass{amsart}', 'align', 'proof'));
check('no amsmath: no align; align and gather are paragraphs, eqnarray (LaTeX\'s) stays aligned', none(ART, 'align') && guess(ART, env('align')) === 'paragraph'
  && guess(ART, env('gather')) === 'paragraph' && guess(ART, env('eqnarray')) === 'align');

// ── declared theorems ──
{
  const pre = `${ART}\\usepackage{amsthm}\n\\newtheorem{corollary}{Corollary}`;
  const k = offeredKinds(pre).kinds.find((x) => x.kind === 'corollary');
  check('\\newtheorem{corollary}: Corollary offered, among the theorems', k?.label === 'Corollary' && k.group === 'Theorems' && k.source === '\\begin{corollary}\n  \n\\end{corollary}');
  check('\\newtheorem{corollary}: a corollary guessed, a lemma not (undeclared)', guess(pre, env('corollary')) === 'corollary' && guess(pre, env('lemma')) === 'paragraph');
  check('a restatable of a declared theorem with thmtools: the theorem', guess(`${pre}\\usepackage{thmtools}`, '\\begin{restatable}{corollary}{c}\nx\n\\end{restatable}') === 'corollary'
    && guess(pre, '\\begin{restatable}{corollary}{c}\nx\n\\end{restatable}') === 'paragraph');
}
check('llncs\'s \\spnewtheorem declares one', has(`\\documentclass{llncs}\n\\spnewtheorem{fact}{Fact}{\\bfseries}{\\itshape}`, 'fact'));
check('\\newenvironment{myproof} beginning a proof: a proof block', guess(`${ART}\\usepackage{amsthm}\n\\newenvironment{myproof}{\\begin{proof}}{\\end{proof}}`, env('myproof')) === 'proof');
check('\\NewDocumentEnvironment{sketch}: offered as an environment', has(`${ART}\\NewDocumentEnvironment{sketch}{o}{}{}`, 'sketch'));

// ── classes that define theorems themselves ──
check('lipics-v2021: its theorems, proof, claimproof, align, abstract without a declaration', has('\\documentclass[a4paper]{lipics-v2021}', 'lemma', 'claim', 'corollary', 'proof', 'align', 'abstract')
  && guess('\\documentclass{lipics-v2021}', env('claimproof')) === 'proof');
check('llncs: lemma, proof; no align (no amsmath)', has('\\documentclass{llncs}', 'lemma', 'proof') && none('\\documentclass{llncs}', 'align'));
check('acmart acmthm=false, beamer notheorems: no theorems', none('\\documentclass[acmthm = false]{acmart}', 'lemma') && none('\\documentclass[notheorems]{beamer}', 'lemma')
  && has('\\documentclass{acmart}', 'lemma', 'proof'));

// ── the companion's environments, the bibliography's template ──
check('reflowtex: Hint and Note; commented out: neither', has(`${ART}\\usepackage{reflowtex}`, 'hint', 'note') && none(`${ART}%\\usepackage{reflowtex}`, 'hint', 'note'));
check('biblatex: \\printbibliography; commented out: \\bibliography', offeredKinds(`${ART}\\usepackage{biblatex}`).kinds.find((k) => k.kind === 'bibliography')?.source === '\\printbibliography'
  && offeredKinds(`${ART}%\\usepackage{biblatex}`).kinds.find((k) => k.kind === 'bibliography')?.source !== '\\printbibliography');

// ── paste, split, import: io/split.ts detectKind ──
{
  const body = '\\begin{lemma}\nA.\n\\end{lemma}\n\n\\begin{corollary}\nB.\n\\end{corollary}\n\n\\begin{proof}\nC.\n\\end{proof}\n\nText.\n';
  const kinds = (pre: string) => splitBody(body, envsFromPreamble(pre)).items.map((it) => (it.type === 'block' ? it.kind : it.type));
  const without = kinds(ART), withDecl = kinds(`${ART}\\usepackage{amsthm}\n\\newtheorem{lemma}{Lemma}\n\\newtheorem{corollary}{Corollary}`);
  check('split without declarations: no lemma, corollary or proof blocks', without.join() === 'paragraph,paragraph,paragraph,paragraph', without);
  check('split with amsthm and the declarations: lemma, corollary, proof', withDecl.join() === 'lemma,corollary,proof,paragraph', withDecl);
  check('detectKind: align only with amsmath', detectKind(env('align'), envsFromPreamble(ART)).kind === 'paragraph' && detectKind(env('align'), envsFromPreamble(`${ART}\\usepackage{amsmath}`)).kind === 'align');
  check('detectKind: abstract in article, not in book', detectKind(env('abstract'), envsFromPreamble(ART)).kind === 'abstract' && detectKind(env('abstract'), envsFromPreamble('\\documentclass{book}')).kind === 'paragraph');
}

// ── the probe: what the tables cannot decide ──
{
  const asked: string[] = [];
  const probe = async (e: string) => { asked.push(e); return e === 'abstract' || e === 'lemma'; };
  const known = await offeredKinds(ART, { probe });
  check('a known class and packages: the probe is not asked', asked.length === 0 && menu(known).includes('abstract'));
  const unknown = '\\documentclass{myclass}';
  check('an unknown class, no probe: no abstract, no lemma', none(unknown, 'abstract', 'lemma'));
  const o = await offeredKinds(unknown, { probe });
  check('an unknown class, the probe says abstract and lemma: offered and guessed', menu(o).includes('abstract') && menu(o).includes('lemma') && !menu(o).includes('corollary')
    && guessKind(env('lemma'), o) === 'lemma', menu(o));
  asked.length = 0;
  await offeredKinds(`${ART}\\usepackage{amsthm}\\usepackage{mymacros}\n\\newtheorem{claim}{Claim}`, { probe });
  check('an unknown package: the probe asked only about what is not defined already', asked.includes('lemma') && !asked.includes('claim') && !asked.includes('proof') && !asked.includes('abstract'), asked);
  const failing = await offeredKinds(unknown, { probe: async () => { throw new Error('no engine'); } });
  check('a probe that fails: not offered', !menu(failing).includes('abstract'));
}

// ── the engine as the probe (doc/kind-probe.ts) ──
{
  check('defined(): TeX\'s "Environment lemma undefined" is not defined; ok is', !defined('lemma', { status: 'error', errors: [{ message: 'LaTeX Error: Environment lemma undefined.' }] })
    && defined('lemma', { status: 'ok', errors: [] }) && defined('abstract', { status: 'error', errors: [{ message: 'Something else.' }] }) && !defined('x', undefined));
  const reqs: { preamble: string; blocks: { id: string; source: string }[] }[] = [];
  const be = { id: 'tectonic', compile: async (req: { preamble: string; blocks: { id: string; source: string }[]; keep: string[] }) => {
    reqs.push(req);
    return { blocks: Object.fromEntries(req.blocks.map((b) => [b.id, b.source.includes('{lemma}') ? { status: 'ok', errors: [] }
      : { status: 'error', errors: [{ message: `LaTeX Error: Environment ${/\{(\w+)\}/.exec(b.source)![1]} undefined.` }] }])) };
  } };
  const pre = '\\documentclass{foo}';
  const probe = engineProbe(be, pre)!;
  const [l, c, a, p] = await Promise.all([probe('lemma'), probe('corollary'), probe('align'), probe('proof')]);
  check('engine probe: one request for one tick\'s questions, against the preamble given', reqs.length === 1 && reqs[0]!.preamble === pre && reqs[0]!.blocks.length === 2
    && reqs[0]!.blocks[0]!.source === '\\begin{lemma}x\\end{lemma}', reqs);
  check('engine probe: lemma defined, corollary not; align and proof (the engine\'s own) not, without asking', l && !c && !a && !p);
  await engineProbe(be, pre)!('lemma');
  check('engine probe: answers kept per preamble text', reqs.length === 1);
  check('engine probe: none for a backend that is not the engine', engineProbe({ id: 'none', compile: be.compile }, pre) === null && engineProbe(null, pre) === null);
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
