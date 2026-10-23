// test-all's suite table and its "changed paths → suites" selector (tests/suites.ts), in Node, in a second.
//   node tests/test-select.ts
// Every suite's script exists; fixed paths give fixed sets; every suite can be selected by some path; an unmapped path
// brings the wide set and is named; test-all --dry makes --file absolute.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUITES, RULES, WIDE, ARCH_STEPS, ROOT, byName, scriptOf, select, globRe, seeded, estimate, colocatedUnits } from './suites.ts';

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };
const names = (paths: string[]) => new Set(select(paths).suites.keys());
const fast = SUITES.filter((s) => s.tier === 'fast').map((s) => s.name);
const missing = (set: Set<string>, want: string[]) => want.filter((w) => !set.has(w));

// the table
check('suite names are unique', byName.size === SUITES.length);
// every row's script is in the repository (test-all fails a suite whose script is missing)
{ const gone = SUITES.filter((s) => !existsSync(join(ROOT, scriptOf(s)))).map((s) => `${s.name}: ${scriptOf(s)}`); check(`every suite's script exists (${SUITES.length} suites)`, gone.length === 0, gone); }
check('workbench/**: its units (fast) and its browser suite', [...names(['workbench/src/model.js'])].filter((x) => x.startsWith('workbench')).sort().join() === 'workbench,workbench-units' && byName.get('workbench-units')!.tier === 'fast' && byName.get('workbench')!.tier === 'full');
// a unit test next to its code is a suite without a row here, and its directory's changes select it
check('every app/src/**/*.test.ts is a suite (listed or found), selected by a change in its directory', colocatedUnits().length > 0 && colocatedUnits().every((f) => SUITES.some((x) => scriptOf(x) === f) && [...names([f.replace(/[^/]+$/, 'any.ts')])].some((x) => scriptOf(byName.get(x)!) === f)), colocatedUnits().filter((f) => ![...names([f.replace(/[^/]+$/, 'any.ts')])].some((x) => scriptOf(byName.get(x)!) === f)));
check('every rule names known suites', RULES.every((r) => r.suites.every((x) => byName.has(x))), RULES.flatMap((r) => r.suites.filter((x) => !byName.has(x))));
check('the exhaustive suites have a sampled form', ['caret-bounds', 'caret-dev', 'caret-file'].every((x) => !!byName.get(x)!.sample));
check('the timing suites run alone (the quiet phase)', SUITES.filter((s) => s.timing).every((s) => s.alone), SUITES.filter((s) => s.timing && !s.alone).map((s) => s.name));
check('the fast tier has no suite that typesets a paper (estimates under 15 s each)', fast.every((x) => estimate(x, false) < 15), fast.filter((x) => estimate(x, false) >= 15));
// cold: the compile path stays covered
const coldDev = ['e2e-dev', 'recovery', 'meta-dev'];
check('e2e-dev, recovery and meta-dev typeset cold; keys, cache, nested-seed, engine-node are cold too', coldDev.every((x) => byName.get(x)!.cold && !seeded(byName.get(x)!)) && ['keys', 'cache', 'nested-seed', 'engine-node'].every((x) => byName.get(x)!.cold));
check('the other dev suites get the seed cache (W3\'s page and app-bundle have no paper)', SUITES.filter((s) => s.group === 'dev' && !s.cold && !['w3', 'app-bundle'].includes(s.name)).every(seeded));

// globs
const g = (p: string, s: string) => globRe(p).test(s);
check('glob ** matches any depth, also none', g('app/src/store/**', 'app/src/store/a.ts') && g('app/src/store/**', 'app/src/store/x/y.js') && g('**/*.md', 'README.md') && g('**/*.md', 'a/b/C.md') && !g('app/src/store/**', 'app/src/storex/a.ts'));
check('glob * stays within a name, {a,b} is either', g('scripts/seed*.ts', 'scripts/seed-title-form.ts') && !g('scripts/seed*.ts', 'scripts/x/seed.ts') && g('engine/{src,api}/**', 'engine/api/x.ts') && !g('engine/{src,api}/**', 'engine/web/x.ts'));

// fixed paths, fixed sets
const docs = names(['docs/TEST-PLAN.md', 'app/src/refs/SHORTCOMINGS.md', 'README.md']);
check('docs only: the fast tier, nothing else', docs.size === fast.length && fast.every((x) => docs.has(x)), [...docs].filter((x) => !fast.includes(x)));
const store = names(['app/src/store/index.js']);
check('store/: the store suites and build-chromium', missing(store, ['home', 'recovery', 'quota-dev', 'cache', 'build-chromium']).length === 0 && !store.has('motion') && !store.has('caret-bounds'), missing(store, ['home', 'recovery', 'quota-dev', 'cache', 'build-chromium']));
const edit = select(['app/src/edit/session.js']);
check('edit/: the caret family, sampled', ['caret-dev', 'caret-bounds'].every((x) => edit.suites.has(x) && edit.sampled.has(x)) && !edit.sampled.has('motion'));
const core = names(['app/src/app/app.js']);
check('app.js: the wide set', missing(core, WIDE).length === 0, missing(core, WIDE));
const script = names(['tests/test-far.ts']);
check('tests/test-far.ts: both twins that run it', script.has('far-dev') && script.has('far-file'));
const engine = names(['engine/src/engine.ts']);
check('engine/src: engine-node, nested-seed, e2e-dev, build-chromium', missing(engine, ['engine-node', 'nested-seed', 'e2e-dev', 'build-chromium']).length === 0);
const build = names(['scripts/build.ts']);
check('scripts/build.ts: the release suites (file twins of the release path)', missing(build, ['build-chromium', 'release-mode', 'e2e-file', 'home-samples-file', 'smoke-firefox-webkit']).length === 0 && !build.has('caret-file'));
const harness = names(['tests/qa/lib/harness.ts']);
check('tests/qa/lib/harness.ts: its users (readonly-dev and readonly-file among them)', harness.has('readonly-dev') && harness.has('readonly-file') && harness.size > fast.length);
const unm = select(['some/new/place.txt']);
check('an unmapped path: the wide set, and the path is named', unm.unmapped.includes('some/new/place.txt') && missing(new Set(unm.suites.keys()), WIDE).length === 0);

// every suite reachable from some path
{
  const probe = new Set<string>();
  for (const s of SUITES) for (const x of select([scriptOf(s)]).suites.keys()) probe.add(x);
  for (const r of RULES) for (const x of r.suites) probe.add(x);
  const lost = SUITES.filter((s) => !probe.has(s.name)).map((s) => s.name);
  check('every suite is selected by some path', lost.length === 0, lost);
}
// every tracked file is mapped (else it would bring the wide set on each change)
{
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const un = select(files).unmapped;
  check(`every tracked file is mapped (${files.length} files)`, un.length === 0, un.slice(0, 12));
}

// sampled forms (tests/qa/lib/sample.ts): spread over the whole list, the kept case among them
{
  const { spread, sampleArg } = await import('./qa/lib/sample.ts');
  const xs = Array.from({ length: 100 }, (_, i) => i);
  const s5 = spread(xs, 5);
  check('spread: 5 of 100 evenly, the first and the last among them', s5.join() === '0,25,50,74,99', s5);
  check('spread: null or n ≥ length gives every item', spread(xs, null).length === 100 && spread(xs, 500).length === 100);
  check('spread: a kept item joins the sample, in order', spread(xs, 3, (x) => x === 7).join() === '0,7,50,99');
  check('sampleArg: --sample 60 → 60, absent → null, bad → an error', sampleArg(['x', '--sample', '60']) === 60 && sampleArg(['x']) === null && (() => { try { sampleArg(['--sample', 'x']); return false; } catch { return true; } })());
  check('the sampled forms pass --sample', SUITES.filter((s) => s.sample).every((s) => s.sample!({ dev: 'http://x', w3: '', file: '/x' }).includes('--sample')));
}

// work-based timing (tests/qa/lib/work.ts): a trace's busiest renderer main thread, tasks and input events in CPU time
{
  const { analyse, timed } = await import('./qa/lib/work.ts');
  const M = (pid: number, tid: number, name: string) => ({ ph: 'M', name: 'thread_name', pid, tid, args: { name } });
  const X = (pid: number, tid: number, name: string, dur: number, tdur: number, args: any = {}) => ({ ph: 'X', name, pid, tid, ts: 1000, dur: dur * 1000, tdur: tdur * 1000, args });
  const w = analyse([M(1, 1, 'CrRendererMain'), M(2, 2, 'CrRendererMain'), M(1, 9, 'DedicatedWorker thread'),
    X(1, 1, 'RunTask', 90, 30), X(1, 1, 'RunTask', 60, 55), X(1, 1, 'EventDispatch', 40, 20, { data: { type: 'click' } }), X(1, 1, 'EventDispatch', 9, 8, { data: { type: 'keydown' } }),
    X(2, 2, 'RunTask', 5, 5), X(1, 9, 'RunTask', 500, 500)]);
  check('work: the busiest renderer main thread, not a worker or another page', w.tasks.length === 2 && Math.round(w.cpu) === 85, { n: w.tasks.length, cpu: w.cpu });
  check('work: a task long by the clock but not in CPU is not long (90 ms wall, 30 ms CPU)', w.long(50).length === 1 && w.long(50)[0].cpu === 55);
  const w2 = analyse([M(3, 3, 'CrRendererMain'), X(3, 3, 'ThreadControllerImpl::RunTask', 40, 12), X(3, 3, 'ThreadControllerImpl::RunTask', 20, 7)]);
  check('work: Chromium 141\'s task name (ThreadControllerImpl::RunTask) counts too', w2.tasks.length === 2 && Math.round(w2.cpu) === 19, { n: w2.tasks.length, cpu: w2.cpu });
  check('work: an input event\'s dispatch in CPU time', w.event('click', 'mousedown') === 20 && w.event('keydown') === 8 && w.event('wheel') === 0);
  const lines: string[] = [], seen: [string, boolean][] = [];
  const log = console.log; console.log = (x: string) => lines.push(x);
  try { timed((n, ok) => seen.push([n, ok]), 'x', true, {}, false, { ms: 99 }); } finally { console.log = log; }
  check('timed: the work gates, the wall clock is only printed (not --timing-strict)', seen.length === 1 && seen[0][1] === true && /^wall OVER x \(wall clock, reported only\)/.test(lines[0] ?? ''), { seen, lines });
}

// calibrated limits: the factor, budget(), gate() at the cap, the baseline file
{
  const W = await import('./qa/lib/work.ts');
  const { tooLoadedLines, factorsIn } = await import('./suites.ts');
  const quiet = (f: () => void) => { const lines: string[] = [], log = console.log; console.log = (x: string) => lines.push(String(x)); try { f(); } finally { console.log = log; } return lines; };
  const f = (m: number, b: number) => W.factorOf(m, b);
  check('factor: measured / baseline, never below 1 (a fast host never tightens a limit), at most the cap',
    f(30, 20).factor === 1.5 && f(10, 20).factor === 1 && f(200, 20).factor === W.CAP && !f(30, 20).tooLoaded && f(200, 20).tooLoaded && f(80, 20).tooLoaded && !f(79, 20).tooLoaded,
    [f(30, 20), f(10, 20), f(200, 20)]);
  check('factor: no baseline or no measurement gives 1', f(30, 0).factor === 1 && f(0, 20).factor === 1);
  check('median of an odd and an even count', W.median([5, 1, 3]) === 3 && W.median([4, 1, 3, 2]) === 2.5);
  const TS = (m: string, ts: number, tts: number, tid = 1) => ({ name: 'TimeStamp', ph: 'I', pid: 1, tid, ts, tts, args: { data: { message: m } } });
  const runs = W.referenceRuns([TS('rtx-calibrate-start', 100, 1000), TS('other', 150, 1500), TS('rtx-calibrate-end', 200, 21000), TS('rtx-calibrate-start', 300, 30000), TS('rtx-calibrate-end', 400, 52500), TS('rtx-calibrate-start', 500, 60000)]);
  check('the reference runs\' CPU time: thread time from each start mark to its end mark (an unmatched start ignored)', runs.length === 2 && runs[0] === 20 && runs[1] === 22.5, runs);
  W.resetCalibration();
  check('uncalibrated: budget(34) is 34', W.budget(34) === 34 && W.factor() === 1);
  const l1 = quiet(() => W.setCalibration(30, 20));
  check('calibrated ×1.5: budget(34) = 51, lim(34) names both; the factor is printed', W.budget(34) === 51 && W.lim(34) === '51 ms (34 × 1.50)' && /factor 1\.50/.test(l1[0] ?? ''), { lim: W.lim(34), l1 });
  const seen: [string, boolean][] = [];
  const g1 = quiet(() => { W.gate((n, ok) => seen.push([n, ok]), 'a', false, {}); W.gate((n, ok) => seen.push([n, ok]), 'b', true, {}); });
  check('below the cap a miss is a failure (a regression is caught), a pass a pass', seen.length === 2 && seen[0][1] === false && seen[1][1] === true && !g1.length && W.tooLoadedCount() === 0, seen);
  seen.length = 0;
  const l2 = quiet(() => W.setCalibration(100, 20));
  const g2 = quiet(() => { W.gate((n, ok) => seen.push([n, ok]), 'press', false, { ms: 140 }); W.gate((n, ok) => seen.push([n, ok]), 'mixed', false, {}, { behaviourOk: false }); W.gate((n, ok) => seen.push([n, ok]), 'fine', true, {}); });
  check('at the cap: a work miss is HOST TOO LOADED (not FAIL, not a check), a behaviour failure still fails, a pass passes; the cap is printed',
    W.budget(34) === 34 * W.CAP && seen.length === 2 && seen[0][0] === 'mixed' && !seen[0][1] && seen[1][1] && g2.length === 1 && /^HOST TOO LOADED press — the reference workload ran 5\.00× its quiet time \(cap 4\)/.test(g2[0]) && W.tooLoadedCount() === 1 && /HOST TOO LOADED to judge/.test(l2[0] ?? ''), { seen, g2, l2 });
  check('test-all reads the per-check HOST TOO LOADED lines (not the summary) and the factors seen',
    tooLoadedLines([g2[0], 'HOST TOO LOADED: 1 work check not judged', 'FAIL x', 'ok  y']).length === 1
    && JSON.stringify(factorsIn('x\ncalibration: 3 measurements, factor 1.02–1.31\n')) === '[1.02,1.31]' && factorsIn('calibration: 1 measurement, factor 4.00–4.00')?.[1] === 4 && factorsIn('nothing') === null);
  W.resetCalibration();
  const b = W.readBaseline();
  check(`the baseline is checked in (tests/qa/lib/work.baseline.json: ${b ? `${b.cpuMs} ms, ${b.recorded}` : 'missing'}) with its spread and how it was made`, !!b && b.cpuMs > 0 && b.spread.length === 2 && b.spread[0] <= b.cpuMs && b.cpuMs <= b.spread[1] && /record-work-baseline/.test(b.how), b);
  { const s = select(['tests/qa/lib/work.baseline.json']).suites; check('a new baseline selects the suites that use work.ts (motion, far, widths, calibrate)', ['motion', 'far-dev', 'far-file', 'widths', 'calibrate'].every((n) => s.has(n)), [...s.keys()]); }
  check('a missing or broken baseline file reads as none (the limits then unscaled, said so)', W.readBaseline('/nonexistent/x.json') === null);
  check('the timing suites calibrate and scale their work limits through work.ts (no bare limit left in a work gate)',
    ['tests/test-motion.ts', 'tests/test-far.ts', 'tests/test-widths.ts'].every((p) => { const t = readFileSync(join(ROOT, p), 'utf8'); return /await calibrate\(page/.test(t) && /budget\(/.test(t); }));
}

// KNOWN entries: each with an issue, the date it was added and an owner; the rerun's verdict for a timing suite
{
  const { KNOWN, knownAge, afterRerun, normLine } = await import('./suites.ts');
  const today = new Date().toISOString().slice(0, 10);
  const bad = KNOWN.filter((k) => !/ISSUES \d+/.test(k.issue) || !/^\d{4}-\d\d-\d\d$/.test(k.added) || k.added > today || !k.owner.trim() || !k.why.trim());
  check(`every KNOWN entry has an ISSUES number, a date (not ahead) and an owner (${KNOWN.length} entries)`, bad.length === 0, bad.map((k) => k.line.source));
  check('every KNOWN entry names a suite of the table', KNOWN.every((k) => SUITES.some((s) => k.suite.test(s.name))));
  check('knownAge counts whole days', knownAge({ added: '2026-10-01' } as any, new Date('2026-10-15T12:00:00Z')) === 14);
  check('a timing suite\'s rerun: passes → flaky; fails busy → unsure; fails quiet → fail', afterRerun('pass', [1, 9], 6) === 'flaky' && afterRerun('known', [1, 1], 6) === 'flaky'
    && afterRerun('fail', [7.5, 2], 6) === 'unsure' && afterRerun('fail', [2, 3], 6) === 'fail' && afterRerun('timeout', [9, 9], 6) === 'fail');
  check('the ledger matches a check across runs without its numbers', normLine("FAIL open [a, top]: the press's work 36 ms (<= 34) — {x}") === normLine("FAIL open [a, top]: the press's work 41 ms (<= 34)"));
}

// a results directory per suite and run: RTX_RESULTS is honoured, and no suite writes to test-results/ by itself
{
  const { resultsDir } = await import('./qa/lib/results.ts');
  const was = process.env.RTX_RESULTS;
  process.env.RTX_RESULTS = '/x/run/w15-file';
  const a = resultsDir(ROOT);
  delete process.env.RTX_RESULTS;
  const b = resultsDir(ROOT);
  if (was != null) process.env.RTX_RESULTS = was;
  check('resultsDir: RTX_RESULTS when set, else test-results/ at the root', a === '/x/run/w15-file' && b === join(ROOT, 'test-results'), { a, b });
  const direct = SUITES.map(scriptOf).filter((f, i, all) => all.indexOf(f) === i && f !== 'tests/test-select.ts' && existsSync(join(ROOT, f)))
    .filter((f) => /join\(\w+, [`']test-results|resolve\(\w+, [`']test-results/.test(readFileSync(join(ROOT, f), 'utf8')));
  check('no suite builds a test-results/ path itself (resultsDir instead: lanes would share it)', direct.length === 0, direct);
}

for (const st of ARCH_STEPS) {
  const set = names(st.paths);
  const lost = missing(set, st.guards);
  check(`step ${st.step}: the selection holds its guarding suites (${st.guards.join(', ')})`, lost.length === 0, lost);
}

// test-all: --file comes out absolute (a relative one fails every file suite); the dry run selects fast
// the lanes estimate from the table, not this machine's history: a run under load (widths 3 h) made 3 lanes look no faster
{
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/test-all.ts'), '--tier', 'fast', '--dry', '--file', 'dist/x.html'], { cwd: ROOT, encoding: 'utf8' });
  check('test-all --dry: --file dist/x.html made absolute', out.includes(`file ${join(ROOT, 'dist/x.html')}`), out.split('\n').slice(0, 2));
  check('test-all --tier fast --dry: the fast suites, nothing run', fast.every((x) => new RegExp(`^  ${x} `, 'm').test(out)) && !/^── /m.test(out));
  const mins = (o: string) => Number(/about (\d+) min/.exec(o)?.[1]);
  const one = execFileSync(process.execPath, [join(ROOT, 'tests/test-all.ts'), '--dry', '--no-history'], { cwd: ROOT, encoding: 'utf8' });
  const three = execFileSync(process.execPath, [join(ROOT, 'tests/test-all.ts'), '--dry', '--no-history', '--lanes', '3'], { cwd: ROOT, encoding: 'utf8' });
  check(`test-all --lanes 3 --dry: 3 lanes then the quiet phase, estimated shorter (${mins(three)} min, one lane ${mins(one)})`, /3 lanes, then the quiet phase/.test(three) && mins(three) < mins(one) * 0.6);
  // the quiet phase is listed last: every suite marked alone after every other
  const order = [...three.matchAll(/^ {2}(\S+) /gm)].map((m) => m[1]);
  const firstAlone = order.findIndex((x) => byName.get(x)?.alone);
  check('the quiet phase (alone) comes after every other suite', firstAlone > 0 && order.slice(firstAlone).every((x) => byName.get(x)?.alone));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
