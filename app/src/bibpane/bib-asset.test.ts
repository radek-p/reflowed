// bibpane/bib-asset.ts: which .bib asset the References pane reads.
//   node app/src/bibpane/bib-asset.test.ts      (Node; exit 1 on a failure)
import { bibAssetFor, bibNames } from './bib-asset.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const assets = [{ id: 'a1', name: 'other.bib' }, { id: 'a2', name: 'refs.bib' }, { id: 'a3', name: 'fig.pdf' }];
type Asset = typeof assets[number];
const at = (d: { preamble?: string; blocks?: Array<{ source: string }>; assets?: Asset[] }) => bibAssetFor(d)?.id ?? null;

check('\\addbibresource in the preamble picks that .bib, not the first',
  at({ preamble: '\\usepackage{biblatex}\n\\addbibresource{refs.bib}\n', blocks: [{ source: 'Text \\cite{x}.' }], assets }) === 'a2');
check('\\bibliography{refs} in the body picks refs.bib', at({ preamble: '', blocks: [{ source: '\\bibliography{refs}' }], assets }) === 'a2');
check('a commented-out name is ignored', at({ preamble: '% \\addbibresource{refs.bib}\n', blocks: [], assets }) === 'a1');
check('no name: the first .bib', at({ preamble: '', blocks: [{ source: 'x' }], assets }) === 'a1');
check('a name no asset has: the first .bib', at({ preamble: '\\addbibresource{missing.bib}', blocks: [], assets }) === 'a1');
check('no .bib asset: null', at({ preamble: '\\addbibresource{refs.bib}', blocks: [], assets: [assets[2]] }) === null);
check('a list and an option: names in order', JSON.stringify(bibNames('\\addbibresource[datatype=bibtex]{a.bib}\\bibliography{b, c}')) === '["a","b","c"]', bibNames('\\addbibresource[datatype=bibtex]{a.bib}\\bibliography{b, c}'));

console.log(`${n - bad}/${n} ok`);
process.exit(bad ? 1 : 0);
