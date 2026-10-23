// The contexts memo (refs/context.ts createContexts): a pass over every block, asking for each block's context with one
// list, computes the contexts once and reads each block's source a bounded number of times (the
// memo compared every source on every call, O(n²): 241 ms at 600 blocks). A changed source is seen at once.
//   node app/src/refs/context.test.ts      (Node; exit 1 on a failure)
import { createContexts } from './context.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };

let reads = 0;
const block = (i: number, s: string) => ({ id: `p${i}`, kind: 'paragraph', get source() { reads++; return s; } });
const big = Array.from({ length: 600 }, (_, i) => block(i, i % 50 === 0 ? `\\newcommand\\Def${String.fromCharCode(97 + i / 50)}{x}` : `Paragraph ${i}.`));

const C = createContexts();
const t0 = performance.now();
const prefixes = big.map((_, i) => C.contextFor(big, i));
const ms = performance.now() - t0;
check('a pass over 600 blocks with one list computes the contexts once', C.runs() === 1, `runs ${C.runs()}`);
check('… and reads each source a few times, not once per block asked', reads / big.length < 10, `${(reads / big.length).toFixed(1)} reads per block, ${Math.round(ms)} ms`);
check('… the definitions reach the later blocks', prefixes[51].includes('\\Defa') && prefixes[101].includes('\\Defb') && !prefixes[0].includes('\\Defa'));

// a new list with the same sources: the memo stands (one comparison); a changed source: computed again
const same = big.map((b, i) => block(i, b.source));
C.contextFor(same, 3);
check('a new list with the same sources: no recompute', C.runs() === 1, `runs ${C.runs()}`);
const edited = same.map((b, i) => (i === 100 ? block(i, '\\newcommand\\Edited{y}') : b));
check('a changed source: computed again, and later blocks see it', C.contextFor(edited, 120).includes('\\Edited') && C.runs() === 2, `runs ${C.runs()}`);

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
