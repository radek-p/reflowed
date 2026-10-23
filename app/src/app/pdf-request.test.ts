// pdf-request.js: the PDF export's request names every file of the document, also one no \includegraphics names
// (a figure placed through the document's own macro).
//   node app/src/app/pdf-request.test.ts      (Node; exit 1 on a failure)
import { pdfRequest } from './pdf-request.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

type B = { id: string; source: string; kind: string };
const flat = (bs: B[]) => bs;
const doc = {
  title: 'T',
  preamble: { source: '\\newcommand{\\shot}[1]{\\includegraphics{#1}}' },
  blocks: [{ id: 'a', source: '\\shot{figures/a}', kind: 'paragraph' }],
  assets: [{ name: 'figures/a.png' }, { name: 'refs.bib' }],
};
const r = pdfRequest(doc, flat);
check('every file of the document, in order', JSON.stringify(r.files) === JSON.stringify(['figures/a.png', 'refs.bib']), r.files);
check('the blocks and the preamble as before', r.preamble === doc.preamble.source && r.blocks.length === 1 && r.blocks[0].source === '\\shot{figures/a}', r);
check('a document without files: none', JSON.stringify(pdfRequest({ ...doc, assets: undefined }, flat).files) === '[]');

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
