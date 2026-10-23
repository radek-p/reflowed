// io/split.ts detectKind: an inline thebibliography is a bibliography block (as doc/kinds.js guessKind says), so the
// imported intro's bibliography is one (it was a paragraph).
//   node app/src/io/split.test.ts
import { detectKind, envsFromPreamble } from './split.ts';

let n = 0, bad = 0;
const check = (what: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — ${JSON.stringify(d)}`}`); };
const opts = envsFromPreamble('\\newtheorem{theorem}{Theorem}');
const k = detectKind('\\begin{thebibliography}{9}\n\\bibitem{a} A.\n\\end{thebibliography}', opts);
check('a thebibliography environment is a bibliography block', k.kind === 'bibliography' && k.attrs.env === 'thebibliography', k);
check('a theorem stays a theorem', detectKind('\\begin{theorem}x\\end{theorem}', opts).kind === 'theorem');
check('an abstract stays an abstract', detectKind('\\begin{abstract}x\\end{abstract}', opts).kind === 'abstract');
console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
