// bib/library.ts: what the preamble asks for (bibSetup) and a thebibliography's \bibitem's (parseBibitems), both
// read with the one comment rule.
//   node app/src/bib/library.test.ts      (Node; exit 1 on a failure)
import { bibSetup, parseBibitems } from './library.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const listed = bibSetup('\\documentclass{article}\n\\usepackage[style=alphabetic]{x,biblatex}');
check('biblatex in a package list, its style', listed.engine === 'biblatex' && listed.style === 'alphabetic', listed);
const plain = bibSetup('\\usepackage{biblatex}');
check('biblatex alone: numeric', plain.engine === 'biblatex' && plain.style === 'numeric', plain);
const commented = bibSetup('\\usepackage{a}\\\\% \\usepackage{biblatex}\n\\bibliographystyle{plainurl}');
check('a biblatex after \\\\% is in a comment: bibtex', commented.engine === 'bibtex' && commented.style === 'plainurl', commented);
const natbib = bibSetup('\\usepackage[numbers]{natbib, url}');
check('natbib in a package list', natbib.engine === 'bibtex' && natbib.natbib, natbib);
const lipics = bibSetup('\\documentclass[a4paper]{lipics-v2021}');
check('a LIPIcs class: bibtex, plain', lipics.engine === 'bibtex' && lipics.style === 'plain', lipics);
check('nothing asked: none', bibSetup('\\usepackage{amsmath}').engine === 'none');

const items = parseBibitems('\\begin{thebibliography}{9}\n\\bibitem{a} A, 50\\% off.\\\\% \\bibitem{no}\n\\bibitem{b} B.\n\\end{thebibliography}');
check('bibitems: one after \\\\% is in a comment; \\% kept', items.map((i) => i.key).join() === 'a,b' && items[0].body.includes('50\\% off'), items);

console.log(`${n - bad}/${n}`);
process.exit(bad ? 1 : 0);
