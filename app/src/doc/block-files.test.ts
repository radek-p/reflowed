// doc/block-files.ts: the files a block uses (its last compile's record, its source's names), and what reads them:
// a block's key (doc/derived.js: a figure placed by a macro, replaced in place, gives its block a new key; the first
// compile's record moves the key once, and the result belongs under the new key too) and svgfig's trash rule (a
// drawing placed by a macro is used).
//   node app/src/doc/block-files.test.ts      (Node; exit 1 on a failure)
import { namedIn, includesIn, namesFile, usedBy, usesFile, createBlockFiles } from './block-files.ts';
import { createDerived } from './derived.js';
import { createResults } from './results.js';
import { figureLifecycle } from '../svgfig/lifecycle.js';
import { fileSig } from '../../../engine/web/opened.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

// ── the source's names: the one scan ──
{
  const r = namedIn('\\includegraphics[width=3cm]{fig/a} % \\includegraphics{fig/b}\n\\usepackage{x,y}\\input{sec/c}\\bibliographystyle{plain}');
  check('namedIn: figures, inputs, packages (as .sty) and styles; comments left out', JSON.stringify(r) === JSON.stringify(['fig/a', 'sec/c', 'x.sty', 'y.sty', 'plain.bst']), r);
  check('namedIn: a macro\'s figure is not named (\\shot{x})', namedIn('\\shot{figures/x}').length === 0);
  const g = (src: string) => includesIn(src).map((x) => [x.opts, x.name]);
  check('includesIn: plain form', JSON.stringify(g('\\includegraphics{a.png}')) === '[["","a.png"]]', g('\\includegraphics{a.png}'));
  check('includesIn: starred form with options, the command as written', JSON.stringify(g('\\includegraphics*[width=3cm]{a.png}')) === '[["width=3cm","a.png"]]' && includesIn('x \\includegraphics[scale=2]{a} y')[0]?.include === '\\includegraphics[scale=2]{a}', g('\\includegraphics*[width=3cm]{a.png}'));
  check('includesIn: both forms counted', g('\\includegraphics[w]{a} \\includegraphics*{b}').length === 2);
  check('namesFile: the path, its end after a folder, with or without the extension', namesFile('figures/x.pdf', 'x') && namesFile('figures/x.pdf', 'figures/x.pdf') && namesFile('figures/x.pdf', './figures/x') && !namesFile('figures/x.pdf', 'y') && !namesFile('figures/xx.pdf', 'x'));
}

// ── the record: the last result's files ──
{
  const f = createBlockFiles();
  const b = { id: 'b', source: 'A \\shot{figures/x}.' };
  check('before a compile: the source\'s names only', f.of(b).opened.length === 0 && !f.uses(b, 'figures/x.png'));
  check('a result names its files: the block\'s files changed', f.note('b', { files: ['figures/x', 'figures/x.pdf', 'figures/x.png'] }));
  check('… the block uses the figure TeX opened (a macro placed it)', f.uses(b, 'figures/x.png'));
  check('… a name TeX looked for in vain is a use of that very name only, not of a file it is the stem of', usesFile(f.of(b), 'figures/x') && !usesFile({ opened: ['figures/x'], named: [] }, 'figures/x.png'));
  check('the same files again: no change', !f.note('b', { files: ['figures/x', 'figures/x.pdf', 'figures/x.png'] }));
  check('a transient failure, or a result without a record: nothing noted', !f.note('b', { files: [], transient: true }) && !f.note('b', {}) && f.uses(b, 'figures/x.png'));
  check('an edit that opens another file: changed', f.note('b', { files: ['figures/y.png'] }) && !f.uses(b, 'figures/x.png') && f.uses(b, 'figures/y.png'));
  check('usedBy: a source with a result (the preamble\'s)', usesFile(usedBy('\\documentclass{lipics-v2021}', { files: ['logo.pdf'] }), 'logo.pdf') && usesFile(usedBy('\\documentclass{lipics-v2021}'), 'lipics-v2021.cls'));
  f.clear();
  check('clear(): the records go', !f.uses(b, 'figures/y.png'));
}

// ── a block's key (doc/derived.js) ──
{
  const asset = (name: string, hash: string) => ({ name, hash, size: 3 });
  const d = { id: 'd', preamble: { source: '\\documentclass{article}\n\\newcommand{\\shot}[1]{\\includegraphics{#1}}' }, bib: { kind: 'none', source: '' },
    assets: [asset('figures/x.png', 'h1'), asset('figures/z.png', 'hz')],
    blocks: [{ id: 'f', kind: 'figure', source: '\\begin{figure}\\shot{figures/x}\\end{figure}' }, { id: 'g', kind: 'figure', source: '\\includegraphics[width=2cm]{figures/z}' }] };
  const results = createResults();
  const nest = { contextView: (l: unknown[]) => l, extraContext: () => '', compileSource: (b: { source: string }) => b.source, treeSig: () => 'flat' };
  const backend = { id: 'tectonic', keyFor: (b: { source: string; context?: string }) => `e1.${b.context ?? ''}.${b.source}` };
  const blockById = (id: string) => d.blocks.find((b) => b.id === id);
  const refs = { contextFor: () => '' };
  const derived = createDerived({ doc: () => d, blockById, nest, refs, backend: () => backend, results });
  derived.loadAssets(d.assets); derived.preambleChanged(); derived.computeContexts();
  const f = d.blocks[0]!, g = d.blocks[1]!;
  const k0 = derived.ck(f);
  check('the first compile: a macro\'s figure is not in the key yet', derived.assetSig(f) === '' && derived.usedAssets(f).length === 0);
  const r = { status: 'ok', files: ['figures/x', 'figures/x.pdf', 'figures/x.png'], fileSigs: { 'figures/x.png': fileSig(d.assets[0]) as string } };
  const k1 = derived.landed('f', k0, r);
  check('its result names the figure: the key the block has now, for the result to be kept under too', !!k1 && k1 !== k0 && k1 === derived.ck(f) && derived.assetSig(f).includes('figures/x.png'), { k0, k1 });
  check('… the figure is the block\'s (no options, no command: a macro placed it)', JSON.stringify(derived.usedAssets(f)) === JSON.stringify([{ name: 'figures/x.png', opts: '', include: '' }]));
  check('… the same record again: the key stays', derived.landed('f', k1!, r) === null && derived.ck(f) === k1);
  derived.noteAsset(asset('figures/x.png', 'h2'));
  const k2 = derived.ck(f);
  check('the figure replaced in place: the block\'s key moves (it typesets again)', k2 !== k1);
  check('… a result made with the old file is not kept under the new key', derived.landed('f', k2, { ...r, files: ['figures/x.png', 'figures/w.png'] }) === null);
  check('an \\includegraphics block: its figure with its options, as before', JSON.stringify(derived.usedAssets(g)) === JSON.stringify([{ name: 'figures/z.png', opts: 'width=2cm', include: '\\includegraphics[width=2cm]{figures/z}' }]) && derived.assetSig(g).includes('figures/z.png'));
  check('an answer for an older text of the block is not its record', derived.landed('g', 'some older key', { files: ['figures/q.png'] }) === null && !derived.filesOf(g).opened.length);
}

// ── svgfig's trash: a drawing used only through a macro stays when its owner block goes ──
{
  const files = createBlockFiles();
  const drawing = { id: 'a1', name: 'figures/figure-1.svg', mime: 'image/svg+xml', owner: 'gone' as string, trashed: undefined as unknown };
  const d = { id: 'd', blocks: [{ id: 'p', source: 'See \\shot{figures/figure-1}.' }], assets: [drawing] };
  const writes: unknown[] = [];
  const app = { doc: () => d, blockById: (id: string) => d.blocks.find((b) => b.id === id), filesOf: (b: { id: string; source: string }) => files.of(b), usedAssets: () => [],
    write: (fn: () => Promise<void>) => { writes.push(fn); return Promise.resolve(); }, store: {}, history: {}, op: () => ({}), logOps() {}, noteAsset() {} };
  const life = figureLifecycle(app);
  files.note('p', { files: ['figures/figure-1', 'figures/figure-1.pdf', 'figures/figure-1.svg'] });
  life.sync();
  check('trash: the owner gone, another block places the drawing through a macro: kept', !drawing.trashed && writes.length === 0, drawing.trashed);
  files.clear();
  life.sync();
  check('trash: the owner gone and no block uses it: trashed', !!drawing.trashed && writes.length === 1);
}

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
