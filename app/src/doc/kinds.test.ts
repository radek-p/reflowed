// app/kinds.js markerOf: which blocks are markers the page draws itself (not compiled), and which typeset.
//   node app/src/app/kinds.test.ts      (Node; exit 1 on a failure)
import { markerOf } from './kinds.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const M = (source: string, kind = 'paragraph', container = false) => markerOf({ kind, source }, () => container);

check('a paragraph typesets', M('Some text.') === null);
check('a container: its frame is a marker (its paragraphs compile)', M('\\begin{proof}', 'proof', true) === 'container');
check('\\appendix alone, with a comment after it', M('\\appendix % the rest') === 'appendix');
check('only comments (and blank lines): a comment marker', M('% a note\n\n% another') === 'comment');
check('an escaped percent is text, not a comment', M('50\\% of it') === null);
check('a macros block and a comment block by kind', M('\\newcommand\\x{1}', 'macros') === 'macros' && M('Note', 'comment') === 'comment');
check('no container test given: never a container', markerOf({ kind: 'proof', source: 'x' }) === null);

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
