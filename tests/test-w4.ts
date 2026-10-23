// units: numbering, references and the bibliography (Node, no browser).
//
//   node tests/test-w4.ts [--units]
//
// Checks: 0a \cref{a,b,…} texts; 0b bbl parse and 0c BibTeX → bbl on the tests' biblatex document
// (tests/qa/fixtures/biblatex-doc.ts); 0d–0f contextFor. (The numbering
// and references in the integrated app: tests/test-cref.ts, test-refs-panel.ts, test-intro.ts.)
import * as FX from './qa/fixtures/biblatex-doc.ts';

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

// ── 0. units (Node, no browser): ranges, bbl, BibTeX, contextFor ─────
{
  const { crefText } = await import('../app/src/refs/cref.ts');
  const { parseBbl, searchBbl } = await import('../app/src/bib/bbl.ts');
  const { addBibtex } = await import('../app/src/bib/bibtex.ts');
  const { contextsFor } = await import('../app/src/refs/context.ts');
  const lab = (label: string, k: string, prefix: string, value: number, names: [string, string, string, string]) =>
    ({ label, number: `${prefix}.${value}`, name: names[2], counter: k, value, prefix, blockId: null, cref: { k, n: names } });
  const L = ['lemma', 'lemmas', 'Lemma', 'Lemmas'] as [string, string, string, string];
  const T = ['theorem', 'theorems', 'Theorem', 'Theorems'] as [string, string, string, string];
  const db = new Map([
    ['a', lab('a', 'lemma', '2', 1, L)], ['b', lab('b', 'lemma', '2', 2, L)], ['c', lab('c', 'lemma', '2', 3, L)],
    ['d', lab('d', 'lemma', '2', 5, L)], ['t', lab('t', 'theorem', '1', 1, T)], ['u', lab('u', 'theorem', '3', 2, T)],
  ]);
  const get = (l: string) => db.get(l) as any;
  const nb = (s: string) => s.replace(/ /g, ' ');
  const cases: [string[], boolean, string][] = [
    [['c', 'a', 'b'], false, 'lemmas 2.1 to 2.3'],
    [['a', 'b'], true, 'Lemmas 2.1 and 2.2'],
    [['d', 'a', 'b', 'c'], false, 'lemmas 2.1 to 2.3 and 2.5'],
    [['t', 'a', 'u'], true, 'Theorems 1.1 and 3.2 and lemma 2.1'],
    [['a', 'zz'], false, 'lemma 2.1, ??'],
  ];
  const badR5 = cases.map(([ls, up, want]) => [ls.join(','), nb(crefText(ls, up, get)), want]).filter(([, got, want]) => got !== want);
  check('0a. \\cref{a,b,…}: grouped, sorted, ranges (cleveref defaults)', !badR5.length, badR5.map(([l, g, w]) => `${l}: “${g}” want “${w}”`).join(' | ') || `${cases.length} cases`);

  const bblSrc: string = FX.BBL;
  const bbl = parseBbl(bblSrc);
  const dt = bbl.byKey.get('DG25a');
  check(`0b. bbl 3.2: ${FX.KEYS.length} entries, labels, search`, bbl.entries.length === FX.KEYS.length && !bbl.errors.length && dt?.label === 'DG25a' && searchBbl(bbl, 'Gdań').some((e: any) => e.key === 'DG25a'),
    `${bbl.entries.length} entries, version ${bbl.version}, DG25a → ${dt?.label}${bbl.errors.length ? `; errors ${bbl.errors.slice(0, 3).join(' | ')}` : ''}`);

  // a second Gdański 2023 entry: the lone Gda23 becomes Gda23a, the new one Gda23b (extraalpha in sorting order)
  const n0 = FX.KEYS.length;
  const add = addBibtex(bblSrc, '@article{Gda23new, author = {Gda{\\\'n}ski, Ola}, title = {Widths, again}, journal = {J. Test}, year = {2023}}');
  const after = parseBbl(add.bbl);
  const nw = after.byKey.get('Gda23new'), old = after.byKey.get('Gda23');
  const re = addBibtex(add.bbl, '@misc{Gda23new, author = {Gda{\\\'n}ski, Ola}, title = {Renamed}, year = {2023}}');
  const after2 = parseBbl(re.bbl);
  check('0c. paste BibTeX → bbl entry: extraalpha, sorted, replace by key',
    after.entries.length === n0 + 1 && old?.label === 'Gda23a' && nw?.label === 'Gda23b' && re.replaced.includes('Gda23new') && after2.entries.length === n0 + 1 && after2.byKey.get('Gda23new')?.card.title === 'Renamed' && after2.byKey.get('Gda23new')?.label === 'Gda23b',
    `Gda23 → ${old?.label}, new → ${nw?.label}; replace: ${after2.entries.length} entries, ${after2.byKey.get('Gda23new')?.label} “${after2.byKey.get('Gda23new')?.card.title}”`);

  const blocks = [
    { kind: 'macros', source: '\\newcommand\\CC{\\mathcal C}' },
    { kind: 'heading', source: '\\section{Intro}' },
    { kind: 'restatable', source: '\\begin{restatable}{lemma}{lemX}\\label{l}x\\end{restatable}', attrs: { restatable: 'lemX' } },
    { kind: 'paragraph', source: 'Text \\cite{K1}.' },
    { kind: 'appendix', source: '\\appendix' },
    { kind: 'paragraph', source: '\\lemX*' },
    { kind: 'bibliography', source: '\\printbibliography' },
  ];
  const cx = contextsFor(blocks);
  const okCx = cx[1].prefix.includes('\\CC') && !cx[0].prefix.includes('\\CC') && cx[2].flags.includes('afterheading')
    && !cx[3].flags.includes('appendix') && cx[5].flags.includes('appendix') && cx[5].restated.includes('lemX') && cx[5].prefix.includes('\\setbox0=\\vbox{\\begin{restatable}')
    && cx[6].prefix.includes('\\rtxcited{K1}') && cx.every((c: any, i: number) => c.defs.every((j: number) => j < i));
  check('0d. contextFor: earlier definitions, afterheading, appendix, restatables, cited keys', okCx, cx.map((c: any, i: number) => `${i}:[${c.flags}]`).join(' '));
  // a block that starts with a definition and then typesets (the MSO paper: \newcommand of a
  // TikZ automaton, the figure using it, a paragraph): only its definitions go into later contexts, not its
  // figure and text (they were typeset again at the top of every later block); a block of definitions and
  // set-up only (\makeatletter … \makeatother) still goes whole
  const mixed = [
    { kind: 'paragraph', source: '\\newcommand{\\auto}{\\begin{tikzpicture}\\node{q};\\end{tikzpicture}}\n\\begin{figure}\\auto\\end{figure}\nObserve that the automaton does not compare.' },
    { kind: 'paragraph', source: '\\makeatletter\n\\def\\@mine{x}\n\\makeatother' },
    { kind: 'paragraph', source: 'Fix a finite alphabet.' },
  ];
  const mx = contextsFor(mixed);
  check('0e. contextFor: a block that defines and typesets gives later blocks its definitions only; a pure definitions block goes whole',
    mx[2].prefix.includes('\\newcommand{\\auto}') && !mx[2].prefix.includes('Observe that') && !mx[2].prefix.includes('\\begin{figure}') && mx[2].prefix.includes('\\makeatletter\n\\def\\@mine{x}\n\\makeatother'),
    JSON.stringify(mx[2].prefix).slice(0, 300));
  // more layouts and both seeds: app/src/refs/definitions.test.ts

  // two documents' refs, asked in turn: each keeps its own contexts memo (no recompute when the
  // other document asks), and neither sees the other's definitions
  const { createRefs } = await import('../app/src/refs/index.ts');
  const A = createRefs(), B = createRefs();
  const docB = [{ id: 'b0', kind: 'macros', source: '\\newcommand\\DD{\\mathcal D}' }, { id: 'b1', kind: 'paragraph', source: 'y' }];
  const docA = blocks.map((b, i) => ({ id: `a${i}`, ...b }));
  const pa: string[] = [], pb: string[] = [];
  for (let round = 0; round < 3; round++) for (let i = 0; i < docA.length; i++) { pa.push(A.contextFor(docA, i)); if (i < docB.length) pb.push(B.contextFor(docB, i)); }
  check('0f. refs per document: alternating documents compute each one\'s contexts once, and keep them apart',
    A.contextRuns() === 1 && B.contextRuns() === 1 && pa[1].includes('\\CC') && !pa.some((p) => p.includes('\\DD')) && pb[1].includes('\\DD') && !pb.some((p) => p.includes('\\CC')),
    JSON.stringify({ a: A.contextRuns(), b: B.contextRuns() }));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
