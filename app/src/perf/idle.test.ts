// The idle helper (perf/idle.ts): without requestIdleCallback (Safari; Node here) the callback runs with the
// caller's budget, and a cancel stops it; with it, the browser's is used with the caller's timeout.
//   node app/src/perf/idle.test.ts      (Node; exit 1 on a failure)
import { idle, cancelIdle, type Deadline } from './idle.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };

const got = await new Promise<Deadline>((r) => idle(r, { timeout: 100, delay: 1, budget: 42 }));
check('no requestIdleCallback: the callback runs, with the caller\'s budget', got.timeRemaining() === 42 && got.didTimeout === false);
let ran = false;
const h = idle(() => { ran = true; }, { timeout: 100, delay: 1 });
cancelIdle(h);
await new Promise<void>((r) => idle(() => r(), { timeout: 100, delay: 5 }));    // a later one has run: the cancelled one would have
check('a cancelled callback does not run', !ran);
const g = globalThis as unknown as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
let asked: unknown = null;
g.requestIdleCallback = (fn: unknown, o: unknown) => { asked = o; return 7; };
g.cancelIdleCallback = (x: number) => { asked = `cancel ${x}`; };
check('with requestIdleCallback: it is used, with the caller\'s timeout', idle(() => {}, { timeout: 250 }) === 7 && JSON.stringify(asked) === '{"timeout":250}');
cancelIdle(7);
check('… and cancelIdleCallback', asked === 'cancel 7');
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
