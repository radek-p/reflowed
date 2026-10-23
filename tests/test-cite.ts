// citations of a bibtex-style bibliography (a thebibliography: plain, plainurl, natbib …) printed
// [?] in the editor, because a block is compiled on its own and has no .aux with the \bibcite lines.
// The block's context now carries the cited keys' \bibitem's (app/src/bib/bibitems.ts) and
// rtx-numbering.sty's \rtxbibcites makes the \bibcite lines from them at once.
//
//   node tests/test-cite.ts --units                 the numbering of \bibitem's and the context lines (Node)
//   node tests/test-cite.ts --engine                the editor engine in Node: every cited key's \bibcite line in a
//                                                     block run equals a whole-document compile's (.aux), for the
//                                                     intro (plain: its .bbl), the example when built
//                                                     (LIPIcs + plainurl + hyperref) and fixtures
//                                                     (article + plain with [labels], natbib author-year, natbib numbers)
//   node tests/test-cite.ts dev [http://localhost:8150/] | file [dist/….html]
//                                                     the app: the intro's citations print its .bbl's
//                                                     numbers (no [?]), refsState().bib has its entries, an unknown key
//                                                     is a problem; the tests' biblatex document is unchanged
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bibitemsOf, bibciteContext, bibitemFields } from '../app/src/bib/bibitems.ts';
import { contextsFor } from '../app/src/refs/context.ts';
import { biblatexDoc, openBiblatexDoc, KEYS as BIBLATEX_KEYS } from './qa/fixtures/biblatex-doc.ts';
import { buildIntroSeed } from '../samples/intro/seed-intro.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d.slice(0, 900)}` : ''}`); if (!ok) fail++;
};
const seedPath = (name: string) => [join(HERE, 'build/seed', name), join(HERE, 'app/seed', name)].find(existsSync) ?? null;

// ── units ────────────────────────────────────────────────────────────────────
async function units() {
  const { withBody } = await import('../engine/src/compile.ts');
  const body = String.raw`$a$&$b$ and $'$ and $<x$ and $$`;
  check('units: withBody keeps a body with $&, $\', $< as written (the print compile)', withBody('A \\csname @@input\\endcsname rtx-block.tex B', body) === `A ${body}\nB`);
  const bbl = String.raw`\begin{thebibliography}{10}
\bibitem{a} Ann. % \bibitem{commented}
\newblock A title.
\bibitem[X{]}1]{b}
Bob.
\bibitem{c} Cy.
\end{thebibliography}
\begin{thebibliography}{1}
\bibitem{d} Dee.
\end{thebibliography}`;
  const it = bibitemsOf([bbl]);
  check('units: every \\bibitem, none from a comment', [...it.keys()].join() === 'a,b,c,d', [...it.keys()]);
  check('units: numbers as the kernel gives them ([opt] does not step the counter)', it.get('a')!.label === '1' && it.get('b')!.label === 'X{]}1' && it.get('c')!.label === '2', [...it.values()].map((x) => x.label));
  check('units: natbib\'s counter counts every item', it.get('c')!.all === 2 && it.get('c')!.plain === 1, it.get('c'));
  check('units: a second thebibliography starts again', it.get('d')!.label === '1' && it.get('d')!.plain === 0);
  check('units: an item\'s text', it.get('a')!.body.startsWith('Ann.') && /A title/.test(it.get('a')!.body) && !/commented/.test(it.get('a')!.body), it.get('a')!.body);
  check('units: the last \\bibitem of a key wins (as the .aux)', bibitemsOf([bbl, '\\bibitem{a} again']).get('a')!.label === '1' && bibitemsOf([bbl, '\\bibitem{a} again']).get('a')!.body === 'again');
  check('units: a biblatex .bbl gives none', bibitemsOf(['\\entry{k}{article}{}\n\\endentry\n\\bibitem{x}']).size === 0);
  check('units: the context line', bibciteContext(['c', 'b', 'zz', 'c'], it) === String.raw`\ifdefined\rtxbibcites\rtxbibcites{\rtxbibitem{1}{2}{\bibitem{c}}\rtxbibitem{1}{1}{\bibitem[X{]}1]{b}}}\fi`, bibciteContext(['c', 'b', 'zz', 'c'], it));
  check('units: no line when no key is a \\bibitem', bibciteContext(['zz'], it) === '');
  const f = bibitemFields(String.raw`Ola Gda{\'n}ski and Jan Doe.
\newblock On widths of paragraphs (a made-up reference).
\newblock {\em Journal of Tests}, 3(1):1--20, 2010.
\newblock \href {https://doi.org/10.5555/test.2010.1}`);
  check('units: an item\'s fields (author, title, venue, year, doi)', /Doe/.test(f.author) && /widths of paragraphs/.test(f.title) && f.journal === 'Journal of Tests' && f.year === '2010' && f.doi === '10.5555/test.2010.1', f);
  // contexts: only blocks that cite a \bibitem key get the line, before \rtxcontext
  const blocks = [{ source: 'Plain text.' }, { source: 'See \\cite{b,a}.' }, { source: 'And \\cite{nope}.' }, { source: '\\bibliography{x}' }];
  const cx = contextsFor(blocks, { bbl });
  check('contexts: a citing block gets its keys\' \\bibitem\'s, before \\rtxcontext', /\\rtxbibcites\{\\rtxbibitem\{1\}\{1\}\{\\bibitem\[X\{\]\}1\]\{b\}\}\\rtxbibitem\{0\}\{0\}\{\\bibitem\{a\}\}\}\\fi\n\\ifdefined\\rtxcontext/.test(cx[1].prefix), cx[1].prefix);
  check('contexts: others get none', !/rtxbibcites/.test(cx[0].prefix + cx[2].prefix + cx[3].prefix));
  check('contexts: without the .bbl, none (a biblatex document is unchanged)', !/rtxbibcites/.test(contextsFor(blocks).map((c) => c.prefix).join()));
  const inDoc = contextsFor([{ source: 'See \\cite{q}.' }, { source: '\\begin{thebibliography}{9}\\bibitem{q} Q.\\end{thebibliography}' }]);
  check('contexts: a thebibliography block\'s items count too', /\\rtxbibitem\{0\}\{0\}\{\\bibitem\{q\}\}/.test(inDoc[0].prefix), inDoc[0].prefix);
  {
    const d = biblatexDoc();
    const all = contextsFor(d.blocks, { bbl: d.bib.source }).map((c) => c.prefix).join('\n');
    check('contexts: the biblatex document (a biblatex .bbl) gets no \\rtxbibcites', !/rtxbibcites/.test(all));
  }
}

// ── the engine in Node: block runs against a whole-document compile ─────────
interface Fixture { name: string; preamble: string; blocks: { kind?: string; source: string }[]; bbl?: string | null; assets?: { name: string; base64: string }[] }
const NATBIB_BBL = String.raw`\begin{thebibliography}{2}
\providecommand{\natexlab}[1]{#1}
\bibitem[Doe(2001)]{doe}
J.~Doe. \newblock A paper. \newblock 2001.
\bibitem[Smith et~al.(2010)Smith, Jones, and Lee]{smith}
A.~Smith, B.~Jones, and C.~Lee. \newblock Another. \newblock 2010.
\end{thebibliography}`;
const FIXTURES: Fixture[] = [
  { name: 'article + plain, [labels], hyperref, a thebibliography block', preamble: '\\documentclass{article}\n\\usepackage{hyperref}',
    blocks: [{ source: 'First \\cite{b} and \\cite{a,c}.' }, { source: 'Then \\cite[p.~3]{c}.' },
      { kind: 'bibliography', source: '\\begin{thebibliography}{9}\n\\bibitem{a} Ann.\n\\bibitem[X1]{b} Bob.\n\\bibitem{c} Cy.\n\\end{thebibliography}' }] },
  { name: 'natbib author-year', preamble: '\\documentclass{article}\n\\usepackage[authoryear]{natbib}',
    blocks: [{ source: 'As \\citet{smith} show, and \\citep{doe}.' }, { kind: 'bibliography', source: '\\bibliography{refs}' }], bbl: NATBIB_BBL },
  { name: 'natbib numbers', preamble: '\\documentclass{article}\n\\usepackage[numbers]{natbib}',
    blocks: [{ source: 'Numbers \\citep{smith,doe}.' }, { kind: 'bibliography', source: '\\bibliography{refs}' }], bbl: NATBIB_BBL },
];

async function engineChecks() {
  const { engine, local, EXTRA } = await import('../engine/tests/node-host.ts');
  const { buildHost, blockFile, withBody } = await import('../engine/src/compile.ts');
  const list = [...FIXTURES];
  const intro = (await buildIntroSeed()).seed.init as any;
  list.push({ name: 'the intro (article, plain, hyperref)', preamble: intro.preamble, blocks: intro.blocks, bbl: intro.bib?.source ?? null, assets: intro.assets });
  const mso = seedPath('example.json');
  if (mso) {
    const init = JSON.parse(readFileSync(mso, 'utf8')).init;
    list.push({ name: 'the MSO paper (LIPIcs, plainurl, hyperref)', preamble: init.preamble, blocks: init.blocks, bbl: init.bib?.kind === 'bbl' ? init.bib.source : null, assets: init.assets });
  } else console.log('(the MSO paper\'s seed is not on disk: build/seed/example.json; skipped)');
  const e = await engine('async');
  const bibcites = (aux: string) => new Map([...aux.matchAll(/^\\bibcite\{([^}]*)\}(.*)$/gm)].map((m) => [m[1], m[2]]));
  for (const fx of list) {
    for (const a of fx.assets ?? []) local.set(a.name, Buffer.from(a.base64, 'base64'));
    e.setExtraFiles({ ...EXTRA, ...(fx.bbl ? { 'input.bbl': fx.bbl } : {}) });
    // the whole document, as print (three passes): its .aux
    const full = buildHost(fx.preamble, { adapt: false, prelude: '%' });
    e.cool(); e.reset();
    e.addFile('input.tex', withBody(full.main, fx.blocks.map((b) => b.source).join('\n\n')));
    const st = e.compile('input.tex', { capture: 0, maxPasses: 3 });
    const perr = e.text('input.log').split(/^! /m).slice(1, 3).map((x: string) => x.slice(0, 300));
    check(`${fx.name}: the whole document compiles as print`, st <= 1 && !perr.length, perr);
    const want = bibcites(e.text('input.aux'));
    // block by block, as the editor
    e.cool(); e.reset(); e.addFile('input.tex', buildHost(fx.preamble).main);
    if (!e.warm('input.tex').ok) { check(`${fx.name}: the preamble warms`, false, e.text('input.log').slice(-600)); continue; }
    const cx = contextsFor(fx.blocks, { bbl: fx.bbl ?? null });
    const bad: string[] = [];
    let cited = 0, same = 0, slots = 0, uses = 0;
    const noSlot: string[] = [];
    fx.blocks.forEach((b, i) => {
      if (!/\\[a-zA-Z]*cite/.test(b.source) || b.kind === 'bibliography') return;
      const r = e.runBlock(blockFile(b.source, cx[i].prefix).text);
      const log = e.text('input.log');
      const own = log.slice(log.lastIndexOf('(rtx-block.tex'));
      const undef = own.match(/Citation `[^']*' [^\n]*undefined/g);
      if (r.status > 1 || undef) bad.push(`block ${i}: status ${r.status} ${undef?.slice(0, 2).join('; ') ?? ''} ${(own.match(/^! .*/m) ?? [''])[0]}`);
      const got = bibcites(e.text('rtx-bibcites.aux'));
      // every cite command printed inside a marker slot named by its keys
      const notes = e.text('input.rtxlua');
      for (const m of b.source.matchAll(/\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g)) { uses++; const name = `rtxk:${m[1].replace(/\s+/g, '')}`; if (notes.includes(name)) slots++; else noSlot.push(`${name} in block ${i}`); }
      for (const k of new Set([...b.source.matchAll(/\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())))) {
        cited++;
        if (got.get(k) !== undefined && got.get(k) === want.get(k)) same++;
        else bad.push(`${k}: block ${JSON.stringify(got.get(k))} vs print ${JSON.stringify(want.get(k))}`);
      }
    });
    check(`${fx.name}: every citation rides a marker slot of its keys (${slots}/${uses})`, uses > 0 && slots === uses, noSlot.slice(0, 4));
    check(`${fx.name}: no citation undefined in any block`, !bad.some((x) => x.startsWith('block')), bad.filter((x) => x.startsWith('block')));
    check(`${fx.name}: each cited key's \\bibcite as print's (${same}/${cited})`, cited > 0 && same === cited, bad.filter((x) => !x.startsWith('block')));
  }
  // the one-.tex export, saved under the document's title (not the main file's name): the .bbl travels
  // in filecontents* as \jobname.bbl, so \bibliography (and biblatex) find it and every citation prints
  const { memoryStore } = await import('../app/src/store/api.ts');
  const { exportSingle } = await import('../app/src/io/export.ts');
  const { loadSeed } = await import('../app/src/io/api.ts');
  const exPath = seedPath('example.json');
  const introSeed = (await buildIntroSeed()).seed;
  const exSeed = exPath ? JSON.parse(readFileSync(exPath, 'utf8')) : null;
  const docs: [string, (st: any) => Promise<string>, { name: string; base64: string }[]][] = [
    ['the intro', async (st) => loadSeed(st, introSeed), (introSeed.init as any).assets ?? []],
    ['the biblatex document', async (st) => st.createDoc(biblatexDoc()), []],
    ...(exSeed ? [['the MSO paper', async (st: any) => loadSeed(st, exSeed), exSeed.init.assets ?? []] as [string, (st: any) => Promise<string>, { name: string; base64: string }[]]] : []),
  ];
  for (const [label, make, assets] of docs) {
    for (const a of assets) local.set(a.name, Buffer.from(a.base64, 'base64'));
    const store = memoryStore();
    const doc = (await store.getDoc(await make(store)))!;
    const one = exportSingle(doc, doc.blocks, doc.assets);
    e.setExtraFiles(EXTRA);
    e.cool(); e.reset();
    e.addFile('A-saved-title.tex', one.text);
    const st = e.compile('A-saved-title.tex', { capture: 0, maxPasses: 3 });
    const log = e.text('A-saved-title.log');
    const undef = log.match(/Citation [`']?[^\s']*'? [^\n]*undefined|There were undefined (citations|references)|Empty bibliography/g) ?? [];
    check(`${label}: the one-.tex export, saved under another name, compiles with every citation (${undef.length} undefined)`,
      st <= 1 && ((doc as any).bib?.kind !== 'bbl' || /filecontents\*\}\[overwrite\]\{\\jobname\.bbl\}/.test(one.text)) && !undef.some((u) => /Citation|citations|Empty/.test(u)), { st, undef: undef.slice(0, 4), err: (log.match(/^! .*$/m) ?? [''])[0] });
  }
}

// ── the app ──────────────────────────────────────────────────────────────────
async function appChecks(target: 'dev' | 'file', pos: string | null) {
  if (target === 'dev') {
    const { workerProblem } = await import('../engine/scripts/worker-current.ts');
    const prob = workerProblem();
    if (prob) { check('the dev app\'s engine worker is current (its rtx-numbering.sty)', false, prob); return; }
  }
  const URL0 = target === 'file' ? `file://${pos ?? join(HERE, 'dist/reflowtex-editor.html')}` : `${(pos ?? 'http://localhost:8150/').replace(/\/?$/, '/')}?engine`;
  const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
  const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-cite-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.setDefaultTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (e: any) => errors.push(e.message.slice(0, 200)));
  const sep = URL0.includes('?') ? '&' : '?';
  const open = async (doc: string) => {
    await page.goto('about:blank');                       // a real load (a hash change alone keeps the old document's blocks)
    await page.goto(`${URL0}${sep}store=memory#/doc/${doc}`);
    await page.waitForFunction(() => (window as any).editorAPI?.whenIdle, null, { timeout: 300000 });
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
  };
  // what each citing block draws: [n, …] groups, read from the SVG text
  // (each block brought into view first: blocks far off screen are not drawn)
  const drawn = async () => {
    const { ids, bib, nBib } = await page.evaluate(() => {
      const st = (window as any).editorAPI.refsState();
      return { ids: [...new Set(st.cites.map((c: any) => c.blockId))] as string[], bib: Object.fromEntries(Object.entries(st.bib).map(([k, v]: any) => [k, v.label])), nBib: Object.keys(st.bib).length };
    });
    const out: { id: string; text: string; keys: string[][] }[] = [];
    for (const id of ids) {
      out.push(await page.evaluate(async (id: string) => {
        const api = (window as any).editorAPI;
        document.querySelector(`.blk[data-id="${id}"]`)?.scrollIntoView({ block: 'center' });
        await api.whenIdle();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const el = document.querySelector(`.blk[data-id="${id}"] .blk-render`);
        return { id, text: (el?.textContent ?? '').replace(/\s+/g, ' '), keys: api.refsState().cites.filter((c: any) => c.blockId === id).map((c: any) => c.keys) };
      }, id));
    }
    return { out, bib, n: nBib };
  };

  await open('intro');
  const d = await drawn();
  const init = (await buildIntroSeed()).seed.init as any;
  const items = bibitemsOf([init.bib.source]);
  check(`intro: refsState().bib has its .bbl's ${items.size} entries (${d.n})`, d.n === items.size && [...items.values()].every((x) => d.bib[x.key] === x.label), d.bib);
  const qs = d.out.filter((b) => /\[\?\]|\[\?,|, \?\]/.test(b.text));
  check(`intro: no citation prints [?] (${d.out.length} blocks cite)`, d.out.length > 0 && qs.length === 0, qs.map((b) => b.text.slice(0, 120)));
  const missing: string[] = [];
  for (const b of d.out) for (const keys of b.keys) {
    const want = `[${keys.map((k) => items.get(k)?.label ?? '?').join(', ')}`;
    if (!b.text.includes(want)) missing.push(`${b.id.slice(-6)}: ${want}] not in "${b.text.slice(0, 100)}"`);
  }
  check('intro: every \\cite prints its keys\' numbers, in its order', missing.length === 0, missing.slice(0, 5));
  // an unknown key is a problem, and prints [?]
  const r = await page.evaluate(async () => {
    const api = (window as any).editorAPI;
    const id = api.insert(3, 'paragraph', 'A citation of \\cite{no-such-key-81} here.');
    await api.whenIdle();
    document.querySelector(`.blk[data-id="${id}"]`)?.scrollIntoView({ block: 'center' });
    await api.whenIdle();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const st = api.refsState();
    return { diag: st.diagnostics.filter((x: any) => x.kind === 'unknown-cite').map((x: any) => x.key), text: document.querySelector(`.blk[data-id="${id}"] .blk-render`)?.textContent ?? '' };
  });
  check('intro: an unknown key is an unknown-cite problem', r.diag.includes('no-such-key-81'), r.diag);
  check('intro: … and prints [?]', /\[\?\]/.test(r.text), r.text);

  await page.goto('about:blank');
  await page.goto(`${URL0}${sep}store=memory#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.route?.(), null, { timeout: 300000 });
  await openBiblatexDoc(page);
  const s = await drawn();
  const ctxs = await page.evaluate(() => { const api = (window as any).editorAPI; const c = api.contexts?.(); return c ? JSON.stringify([...(c instanceof Map ? c.values() : Object.values(c))]) : ''; });
  check(`the biblatex document: ${s.n} entries, alphabetic labels drawn, no [?]`, s.n === BIBLATEX_KEYS.length && s.out.length > 0 && s.out.every((b) => !/\[\?\]/.test(b.text)) && s.out.some((b) => /\[Smi19\]/.test(b.text)), s.out.filter((b) => /\[\?\]/.test(b.text)).map((b) => b.text.slice(0, 100)));
  check('the biblatex document: no \\rtxbibcites in any context', !/rtxbibcites/.test(ctxs));
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
}

if (argv.includes('--units')) await units();
else if (argv.includes('--engine')) await engineChecks();
else await appChecks(argv[0] === 'file' ? 'file' : 'dev', argv.find((a, i) => !a.startsWith('--') && (i > 0 || !/^(dev|file)$/.test(a))) ?? null);   // (the URL may come first)
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
