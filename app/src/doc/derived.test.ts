// doc/derived.js GRAPHICS: the \includegraphics calls of a block's source (figures and their asset keys).
//   node app/src/doc/derived.test.ts      (Node; exit 1 on a failure)
import { GRAPHICS } from './derived.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const found = (src: string) => [...src.matchAll(GRAPHICS)].map((m) => [m[1] ?? '', m[2]]);
check('plain form', JSON.stringify(found('\\includegraphics{a.png}')) === '[["","a.png"]]', found('\\includegraphics{a.png}'));
check('starred form with options', JSON.stringify(found('\\includegraphics*[width=3cm]{a.png}')) === '[["width=3cm","a.png"]]', found('\\includegraphics*[width=3cm]{a.png}'));
check('both forms counted', found('\\includegraphics[w]{a} \\includegraphics*{b}').length === 2, found('\\includegraphics[w]{a} \\includegraphics*{b}'));

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
