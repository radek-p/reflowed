// tex/texscan.js: its reference, citation and heading commands are refs/scan.ts's (one list),
// so the editor's marks and the Problems list find the same commands.
//   node app/src/tex/texscan.test.ts      (Node; exit 1 on a failure)
import { scanRefs, scanCites, scanHeadings } from './texscan.js';
import { scanSource } from '../refs/scan.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const cites = scanCites('See \\citealp{x}, \\citealt[p.~2]{y,z} and \\cite{w}.') as { cmd: string; keys: string[] }[];
check('scanCites: \\citealp and \\citealt found', cites.map((c) => c.cmd).join() === 'citealp,citealt,cite', cites);
check('scanCites: keys after an optional argument', cites[1]?.keys.join() === 'y,z', cites);

const refs = scanRefs('\\Autoref{a} and \\crefrange{b}{c}') as { cmd: string; keys: string[] }[];
check('scanRefs: \\Autoref found', refs[0]?.cmd === 'Autoref' && refs[0].keys.join() === 'a', refs);
check('scanRefs: \\crefrange reads both keys', refs[1]?.keys.join() === 'b,c', refs);

const heads = scanHeadings('\\subparagraph{Fine print} \\paragraph*{P}') as { cmd: string; title: string; star: boolean }[];
check('scanHeadings: \\subparagraph found', heads[0]?.cmd === 'subparagraph' && heads[0].title === 'Fine print', heads);
check('scanHeadings: \\paragraph* starred', heads[1]?.cmd === 'paragraph' && heads[1].star, heads);

// the editor's scanners and the Problems scanner agree on which commands they find
const src = '\\citealp{m} \\citeauthor{n} \\nocite{o} \\Autoref{p} \\vref{q} \\subparagraph{r}';
const s = scanSource(src);
const both = (a: string[], b: string[]) => a.join() === b.join();
check('cites: texscan = refs/scan', both((scanCites(src) as { cmd: string }[]).map((c) => c.cmd), s.cites.map((c) => c.cmd)), [scanCites(src), s.cites]);
check('refs: texscan = refs/scan', both((scanRefs(src) as { cmd: string }[]).map((c) => c.cmd), s.refs.map((c) => c.cmd)), [scanRefs(src), s.refs]);

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
