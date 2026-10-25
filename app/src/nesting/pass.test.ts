// A pass over the blocks' keys (nesting/app.js pass, doc/derived.js pass): the nesting tree is read once at its start
// instead of once or twice per block (each read compares the whole list: a pass was O(n²), 4 ms at 600 nested blocks).
// The keys, sources as compiled and contexts in a pass are the ones asked for block by block, and the ones the
// independent rule gives (nesting/compile-jobs.ts); a change between two passes (typing into an empty paragraph, a
// paragraph moved out) is seen by the next one; one pass reads the block list a fixed number of times, whatever its length.
//   node app/src/nesting/pass.test.ts      (Node; exit 1 on a failure)
import { createNesting } from './app.js';
import { createDerived } from '../doc/derived.js';
import { nestSource, type NestBlock } from './model.ts';
import { compileJobs } from './compile-jobs.ts';
import { envsFromPreamble } from '../io/split.ts';
import { contextFor } from '../refs/context.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${JSON.stringify(d)}` : ''}`); };

type B = NestBlock & { id: string; kind: string; parentId?: string | null };
const preamble = '\\documentclass{article}\n\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n\\newtheorem{lemma}[theorem]{Lemma}\n';
let seq = 0;
const newId = () => `n${++seq}`;
/** one copy of a small paper: a section, a theorem and a proof split into paragraphs (one paragraph left empty), text after */
function copy(k: number): B[] {
  const env = (id: string, src: string) => nestSource({ id, kind: 'theorem', source: src }, envsFromPreamble(preamble), newId) as B[];
  return [
    { id: `s${k}`, kind: 'section', source: `\\section{Part ${k}}\\label{sec:${k}}` },
    ...env(`t${k}`, `\\begin{theorem}[Main ${k}]\\label{thm:${k}}\nFirst claim, see Section~\\ref{sec:${k}}.\n\nSecond claim with $x_${k}$.\n\n% a comment\n\nThird claim.\n\\end{theorem}`),
    ...env(`p${k}`, `\\begin{proof}\nBy Theorem~\\ref{thm:${k}} and \\eqref{eq:${k}}.\n\n\\begin{equation}\\label{eq:${k}} a = b \\end{equation}\n\nDone.\n\\end{proof}`),
    { id: `a${k}`, kind: 'paragraph', source: `After part ${k}, Theorem~\\ref{thm:${k}} again.` },
  ];
}
const blocks: B[] = [];
for (let k = 0; k < 4; k++) blocks.push(...copy(k));
const doc = { preamble: { source: preamble }, blocks };
const byId = (id: string) => doc.blocks.find((b) => b.id === id);
let listReads = 0;                                          // the nesting's reads of the block list (each one compares all of it)
const nest = createNesting({ doc: () => { listReads++; return doc; }, blockById: byId });
const refs = { contextFor: (plain: { id: string; kind: string; source: string }[], i: number, o: { bbl?: string | null }) => contextFor(plain, i, { bbl: o.bbl ?? undefined }) };
const d = createDerived({ doc: () => doc, blockById: byId, nest, refs, backend: () => ({ id: 'none' }), results: { cache: new Map() } });
d.preambleChanged(); d.computeContexts();

const one = () => doc.blocks.map((b) => d.ck(b));                         // block by block: the tree checked on each ask
const inPass = () => d.pass(() => doc.blocks.map((b) => d.ck(b)));
const jobsMatch = () => d.pass(() => compileJobs(doc.blocks).every((j) => d.compileSource(j.block) === j.source && (d.contextOf(j.block) ?? '') === j.context));

check('the fixture is nested (containers with typeset and untypeset children)', doc.blocks.filter((b) => b.parentId).length >= 16 && doc.blocks.some((b) => b.parentId && !b.source.trim().replace(/^%.*$/m, '')));
const k0 = one();
check('keys in one pass = keys asked block by block', JSON.stringify(inPass()) === JSON.stringify(k0));
check('… sources as compiled and contexts in a pass = compile-jobs.ts (the rule outside the app)', jobsMatch());

// typing into a container's first paragraph (its source, not the tree): only that block's key moves
const first = doc.blocks.find((b) => b.parentId === 't1')!;
first.source += ' Typed.';
const k1 = inPass();
check('typing in a child: the pass sees it, its key alone moved', JSON.stringify(k1) === JSON.stringify(one()) && k1.filter((k, i) => k !== k0[i]).length === 1);

// the theorem's last paragraph emptied: the paragraph before it is now the last (its end line and flags change)
const kids = doc.blocks.filter((b) => b.parentId === 't2');
const last = kids.at(-1)!, saved = last.source;
last.source = '';
const k2 = inPass();
check('a child emptied between passes (roles move): the next pass has the new tree, as block by block does', JSON.stringify(k2) === JSON.stringify(one()) && jobsMatch()
  && k2[doc.blocks.indexOf(kids.at(-3)!)] !== k1[doc.blocks.indexOf(kids.at(-3)!)]);
last.source = saved;

// a paragraph moved out of its container (its parent and the order): the next pass sees it
const moved = doc.blocks.find((b) => b.parentId === 'p3')!;
doc.blocks.splice(doc.blocks.indexOf(moved), 1);
moved.parentId = null;
doc.blocks.push(moved);
const k3 = inPass();
check('a paragraph moved out between passes: the next pass has the new tree', JSON.stringify(k3) === JSON.stringify(one()) && jobsMatch());

// the cost: one pass reads the list a fixed number of times (the tree once); block by block reads it per block
listReads = 0; inPass(); const readsPass = listReads;
listReads = 0; one(); const readsOne = listReads, nSmall = doc.blocks.length;
for (let k = 4; k < 40; k++) doc.blocks.push(...copy(k));
d.computeContexts();
listReads = 0; inPass(); const readsBig = listReads;
check('one pass reads the block list once, at any length (it was once or twice per block)', readsPass === 1 && readsBig === 1 && readsOne >= nSmall,
  { readsPass, readsBig, blockByBlock: readsOne, blocks: [nSmall, doc.blocks.length] });

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
