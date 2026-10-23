// reduced() (motion/reduced.ts): the OS setting where matchMedia is there; false where it is not or throws.
//   node app/src/motion/reduced.test.ts      (Node; exit 1 on a failure)
import { reduced } from './reduced.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean) => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const g = globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } };
check('no matchMedia: false (it threw in four of the copies)', reduced() === false);
g.matchMedia = () => { throw new Error('no'); };
check('a matchMedia that throws: false', reduced() === false);
g.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
check('the setting on: true', reduced() === true);
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
