// wb/status-hold.ts with a fake clock: a short run's "typesetting" stays MIN_SHOWN, a run again within the hold goes
// on showing, a long run ends at once, errors and unsaved pass through at once.
//   node app/src/wb/status-hold.test.ts      (Node; exit 1 on a failure)
import { createStatusHold, type ShownStatus } from './status-hold.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

function rig() {
  let t = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log: { at: number; doc: string; s: ShownStatus }[] = [];
  const hold = createStatusHold((doc, s) => log.push({ at: t, doc, s }), {
    minShown: 600, now: () => t,
    setTimeout: (fn, ms) => { timers.set(++seq, { at: t + ms, fn }); return seq; },
    clearTimeout: (k) => { timers.delete(k as number); },
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
    }
    t = end;
  };
  return { hold, log, advance };
}
const run = (done = 0, total = 1): ShownStatus => ({ typesetting: { done, total, bar: 'band' }, errors: 0, unsaved: false });
const idle: ShownStatus = { typesetting: false, errors: 0, unsaved: false };
const typesettingAt = (log: { s: ShownStatus }[]) => log.map((x) => !!x.s.typesetting);

{
  const { hold, log, advance } = rig();
  hold.put('d', run()); advance(90); hold.put('d', idle);
  check('a run of 90 ms: typesetting still shown when it ends', typesettingAt(log).join() === 'true,true', log);
  let idle1 = false; void hold.idle().then(() => { idle1 = true; });
  advance(509);
  await Promise.resolve();
  check('… until 600 ms after it began (not idle meanwhile)', log.length === 2 && !idle1);
  advance(1);
  await Promise.resolve();
  check('… then idle (and idle() resolved)', log.length === 3 && !log[2].s.typesetting && log[2].at === 600 && idle1, log);
}
{
  const { hold, log, advance } = rig();
  hold.put('d', run()); advance(100); hold.put('d', idle); advance(100); hold.put('d', run()); advance(100); hold.put('d', idle);
  advance(299);
  check('typing: runs again within the hold: typesetting shown throughout, never off between them', typesettingAt(log).every(Boolean), log);
  advance(1);
  check('… still on: each run holds from its own start', !!log.at(-1)!.s.typesetting, log.at(-1));
  advance(200);
  check('… and off 600 ms after the last run began', !log.at(-1)!.s.typesetting && log.at(-1)!.at === 800, log.at(-1));
}
{
  const { hold, log, advance } = rig();
  hold.put('d', run()); advance(900); hold.put('d', idle);
  check('a run longer than the hold ends at once', !log.at(-1)!.s.typesetting && log.at(-1)!.at === 900, log);
}
{
  const { hold, log, advance } = rig();
  hold.put('d', run()); advance(50); hold.put('d', { typesetting: false, errors: 2, unsaved: true });
  check('errors and unsaved go through at once (typesetting held beside them)', log.at(-1)!.s.errors === 2 && log.at(-1)!.s.unsaved && !!log.at(-1)!.s.typesetting, log.at(-1));
  advance(600);
  check('… then the run ends with them kept', log.at(-1)!.s.errors === 2 && !log.at(-1)!.s.typesetting, log.at(-1));
}
{
  const { hold, log } = rig();
  hold.put('a', run()); hold.put('b', idle);
  check('each document on its own', log.length === 2 && log[1].doc === 'b' && !log[1].s.typesetting, log);
  hold.dispose();
}

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
