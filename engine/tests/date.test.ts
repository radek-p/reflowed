// the date TeX runs on: a compile without CompileOpts.date runs on the time of the call (\today is the date the block
// was typeset), one with it on that date (BUILD_DATE, 14 Nov 2023: for runs that must compare byte for byte).
//   node tests/date.test.ts        exits 1 on a failure
import { engine, EXTRA } from './node-host.ts';
import { BUILD_DATE } from '../src/engine.ts';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

const e = await engine('async');
e.setExtraFiles({ ...EXTRA });
const DOC = '\\documentclass{article}\\typeout{DATE=\\the\\year/\\the\\month/\\the\\day}\\begin{document}\\today\\end{document}\n';
const dateOf = (date?: number): string => {
  e.reset(); e.addFile('input.tex', DOC);
  const st = e.compile('input.tex', { capture: 0, ...(date != null ? { date } : {}) });
  const log = e.text('input.log');
  return st <= 1 ? (/DATE=(\d+\/\d+\/\d+)/.exec(log)?.[1] ?? `no DATE line: ${log.slice(-200)}`) : `status ${st}: ${log.slice(-200)}`;
};

const before = new Date(), got = dateOf(), after = new Date();
const ymd = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
check(`no date given: today (${got})`, got === ymd(before) || got === ymd(after), `${got} vs ${ymd(before)}`);
const fixed = dateOf(BUILD_DATE), want = ymd(new Date(BUILD_DATE * 1000));
check(`BUILD_DATE given: that date (${fixed})`, fixed === want, `${fixed} vs ${want}`);

console.log(`\n${fail ? 'FAIL' : 'ok'}: ${fail} failure(s)`);
process.exit(fail ? 1 : 0);
