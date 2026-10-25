// Every suite of the editor, in one run: units in Node, the dev app
// on engine, the single file from file://, a Firefox/WebKit smoke test.
//
//   node tests/test-all.ts [--tier fast|standard|full] [--changed [<base>=main]] [--dry]
//                          [--only <regex>] [--skip <regex>] [--sampled] [--file dist/…/page.html] [--no-bundle] [--list]
//   (where Playwright and its browsers are installed)
//
// Tiers (the suites and their metadata are in tests/suites.ts):
//   --tier fast       units without typesetting, typecheck, the dev smoke (every commit)
//   --tier standard   fast + the suites the changed paths select, the exhaustive ones sampled (every merge):
//                     the same as --changed main
//   --changed <base>  standard for the paths changed since <base> (git diff base...HEAD, plus uncommitted and
//                     untracked files); prints each suite, why it was chosen and the estimated minutes. A path
//                     no rule maps selects the wide set and is printed as "unmapped"
//   --tier full       every suite, exhaustive (the default without --tier or --changed)
//   --dry             print the selection and the estimate, run nothing
//   --no-history      estimate from the suites table only, not from past runs (test-select: the same answer on every machine)
//   --sampled         the exhaustive suites in their sampled form, whatever the tier
//   --only, --skip    filter the chosen suites by name or group (regex)
//   --lanes N         N lanes: the suites that tolerate load run N at a time, longest first, each lane on its own dev
//                     servers and ports; then the quiet phase: the suites marked alone (timing, frame sampling) one
//                     after another with nothing else running
//   --timing-strict   the timing suites gate on the wall clock as well as on their work measures (CPU time, counts;
//                     tests/qa/lib/work.ts): for a run alone on a quiet machine. Without it a wall-clock miss is
//                     printed ("wall OVER") and counted, not failed
//   --no-seed-record  a dev seed cache that does not fit the worker is not recorded again (those suites run cold)
//   --cold            no dev seed cache: every dev suite typesets the papers cold (by default the suites not marked
//                     cold in tests/suites.ts open them from the release's seed cache)
//
//   --known           list the known failures with their reason, note and age, and run nothing
//
// The dev servers are started here on free ports (tests/integration/serve.ts: the app with the engine, cold and
// seeded), one set per lane, and stopped at the end; a dev suite's server is probed before it starts and started
// again when it died. Suites run one after another (or --lanes N at a time, then the timing-sensitive ones alone)
// with a time limit each: at the limit the suite and every process it started are killed.
// Each run has its own directory, test-results/all/runs/<date>-<pid>/ (test-results/all/latest points at the last
// one): each suite's output goes to <name>.log there, and the suite writes its results under <name>/ (RTX_RESULTS,
// tests/qa/lib/results.ts), so that two suites (w15 and w15-file) or two lanes never write the same files. The 10
// newest runs are kept.
//
// A FAIL line that matches a KNOWN entry (tests/suites.ts) is reported as known, with its reason
// and age; entries older than 14 days are listed for review; any other FAIL fails the run. A known failure that no
// longer happens is reported too, so the list is kept honest.
// A failed suite marked timing (only those: a behavioural failure is never retried) runs once more:
//   - passes then: "flaky", not a failure; its FAIL lines go to test-results/all/flakes.log (date, suite, 1-min load,
//   - fails again with the machine busy (1-min load over LOAD_LIMIT at either run): "unsure", rerun it alone before
//     a merge (exit code 2 when nothing else failed);
//   - fails again on a quiet machine: a failure.
// A timing suite's work limits are scaled by the host's factor (tests/qa/lib/work.ts: a reference workload against its
// quiet baseline); the factors a suite saw are shown with its result. A check missed with the factor at
// its cap prints HOST TOO LOADED: a suite with such lines and no FAIL is "unsure" (the host too loaded to judge), not
// a failure, and is not rerun.
//
// Not run here: the browser parts of app/src/refnav/dev, the QA scenarios (tests/test-scenarios.ts, long) and the engine memory
// test in WebKit (engine/tests/memory.test.ts, ~15 min per browser).
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { ensureBrowsers } from './qa/lib/browsers.ts';
import { introBuilt } from './qa/lib/samples.ts';
import { SUITES, scriptOf, KNOWN, KNOWN_REVIEW_DAYS, knownAge, afterRerun, normLine, tooLoadedLines, factorsIn, ROOT, select, estimate, seeded, type Suite, type Ctx } from './suites.ts';

const HERE = ROOT;     // the repository root
// (cloud containers) the browsers Playwright wants, as a shim over the installed revision; the engine's reflowtex
// checkout beside this one when REFLOWTEX is not set
{ const note = ensureBrowsers(HERE); if (note) console.log(note); }
if (!process.env.REFLOWTEX && existsSync(join(HERE, '../reflowtex/src/latex/reflowtex.sty'))) process.env.REFLOWTEX = resolve(HERE, '../reflowtex');
const OUT = join(HERE, 'test-results/all');
const HISTORY = join(OUT, 'history');
const argv = process.argv.slice(2);
const opt = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const ONLY = opt('--only') ? new RegExp(opt('--only')!) : null;
const SKIP = opt('--skip') ? new RegExp(opt('--skip')!) : null;
// absolute: the suites build file:// URLs from it, and a relative path (file://dist/…) fails every file suite
const FILE = resolve(opt('--file') ?? join(HERE, 'dist/reflowtex-editor.html'));
const DRY = argv.includes('--dry');
const LANES = Math.max(1, Number(opt('--lanes') ?? 1));
const COLD = argv.includes('--cold');        // every dev suite typesets cold (no dev seed cache): to compare
const STRICT = argv.includes('--timing-strict');   // the timing suites gate on the wall clock too (alone, on a quiet machine)
const changedArg = argv.includes('--changed') ? (opt('--changed') && !opt('--changed')!.startsWith('--') ? opt('--changed')! : 'main') : null;
const TIER = opt('--tier') ?? (changedArg ? 'standard' : 'full');
if (!['fast', 'standard', 'full'].includes(TIER)) { console.error(`--tier ${TIER}: fast, standard or full`); process.exit(2); }
const BASE = TIER === 'standard' ? (changedArg ?? 'main') : null;
const LOAD_LIMIT = Math.max(2, Math.round(cpus().length * 0.6));
const FLAKES = join(OUT, 'flakes.log');     // untracked: a release may copy a summary into docs

if (argv.includes('--known')) {
  for (const k of KNOWN) { const age = knownAge(k); console.log(`${k.issue.padEnd(36)} ${k.owner.padEnd(32)} added ${k.added}, ${age} days${age > KNOWN_REVIEW_DAYS ? ' — REVIEW' : ''}\n    ${k.suite.source}: ${k.line.source}`); }
  process.exit(0);
}


/** the last recorded seconds per suite (name, or name~sampled), from test-all's own history */
function history(): Record<string, number> {
  const out: Record<string, number> = {};
  if (!existsSync(HISTORY)) return out;
  for (const f of readdirSync(HISTORY).filter((x) => x.endsWith('.json')).sort()) {
    try { for (const r of JSON.parse(readFileSync(join(HISTORY, f), 'utf8')).rows ?? []) if (r.status === 'pass' || r.status === 'known' || r.status === 'fail') out[r.sampled ? `${r.name}~sampled` : r.name] = r.seconds; } catch { /* a broken file */ }
  }
  return out;
}
const git = (...a: string[]) => execFileSync('git', a, { cwd: HERE, encoding: 'utf8' }).split('\n').filter(Boolean);
function changedPaths(base: string): string[] {
  const s = new Set([...git('diff', '--name-only', `${base}...HEAD`), ...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')]);
  return [...s].sort();
}

// ── the selection ────────────────────────────────────────────────────────────
const HIST = argv.includes('--no-history') ? {} : history();
let picked: { s: Suite; sampled: boolean; why: string[] }[];
if (TIER === 'full') picked = SUITES.map((s) => ({ s, sampled: argv.includes('--sampled') && !!s.sample, why: ['full tier'] }));
else if (TIER === 'fast') picked = SUITES.filter((s) => s.tier === 'fast').map((s) => ({ s, sampled: false, why: ['fast tier'] }));
else {
  const paths = changedPaths(BASE!);
  const sel = select(paths);
  console.log(`changed since ${BASE}: ${paths.length} paths`);
  for (const u of sel.unmapped) console.log(`unmapped: ${u} (the wide set; add a rule in tests/suites.ts)`);
  picked = SUITES.filter((s) => sel.suites.has(s.name)).map((s) => ({ s, sampled: sel.sampled.has(s.name), why: sel.suites.get(s.name)! }));
}
picked = picked.filter(({ s }) => (!ONLY || ONLY.test(s.name) || ONLY.test(s.group)) && !(SKIP && (SKIP.test(s.name) || SKIP.test(s.group))));
// the timing suites and those that sample frames last, as in the quiet phase
picked = [...picked.filter((p) => !p.s.alone), ...picked.filter((p) => p.s.alone)];

if (argv.includes('--list')) {
  for (const s of SUITES) console.log(`${s.group.padEnd(6)} ${s.tier.padEnd(5)} ${s.name.padEnd(22)} ${[s.timing && 'timing', s.alone && 'alone', s.cold && 'cold', seeded(s) && 'seed cache', s.sample && 'sampled in standard'].filter(Boolean).join(', ')}${s.note ? ` (${s.note})` : ''}`);
  process.exit(0);
}
const est = (p: (typeof picked)[number]) => estimate(p.s.name, p.sampled, HIST);
const estLoud = picked.filter((p) => !p.s.alone).map(est), estQuiet = picked.filter((p) => p.s.alone).map(est);
// with lanes: the loud work shared out (the longest suite at least), then the quiet phase
const estAll = (LANES > 1 ? Math.max(estLoud.reduce((a, b) => a + b, 0) / LANES, ...estLoud, 0) : estLoud.reduce((a, b) => a + b, 0)) + estQuiet.reduce((a, b) => a + b, 0);
if (DRY || TIER !== 'full') {
  console.log(`tier ${TIER}${BASE ? ` (changed since ${BASE})` : ''}: ${picked.length} suites, about ${Math.round(estAll / 60)} min, ${LANES > 1 ? `${LANES} lanes, then the quiet phase` : 'run one after another'}; file ${FILE}`);
  for (const p of picked) console.log(`  ${p.s.name.padEnd(22)} ${String(Math.round(estimate(p.s.name, p.sampled, HIST))).padStart(5)} s${p.sampled ? ' sampled' : ''}  ${p.why.slice(0, 3).join('; ')}${p.why.length > 3 ? `; +${p.why.length - 3}` : ''}`);
}
if (DRY) process.exit(0);
// this run's directory; older runs beyond the 10 newest go
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = join(OUT, 'runs', `${STAMP}-${process.pid}`);
mkdirSync(RUN, { recursive: true });
try { try { unlinkSync(join(OUT, 'latest')); } catch { /* none yet */ } symlinkSync(join('runs', `${STAMP}-${process.pid}`), join(OUT, 'latest')); } catch { /* a file system without links */ }
for (const old of readdirSync(join(OUT, 'runs')).sort().slice(0, -10)) rmSync(join(OUT, 'runs', old), { recursive: true, force: true });
console.log(`results: ${RUN}`);

// ── servers (one set per lane) ───────────────────────────────────────────────
// Each suite's server is probed before the suite starts: one that died (the OOM killer takes a ~1 GB server on a
// crowded machine) or stopped answering is started again on its port, so one dead server does not fail every later
// suite; one that cannot be started again is reported once, and the suites that need it fail with that line.
interface Server { script: string; port: number; probe: string; more: string[]; p: ChildProcess | null; down?: string }
const servers: Server[] = [];
const byBase = new Map<string, Server>();
const answers = async (url: string, ms: number) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); await r.arrayBuffer(); return r.ok; } catch { return false; }
};
const gone = (p: ChildProcess | null) => !p || p.exitCode != null || p.signalCode != null;
async function start(s: Server): Promise<void> {
  const p = spawn(process.execPath, [join(HERE, s.script), String(s.port), ...s.more], { cwd: HERE, stdio: ['ignore', 'ignore', 'inherit'] });
  s.p = p;
  for (let i = 0; ; i++) {
    if (await answers(`http://localhost:${s.port}${s.probe}`, 5000)) return;
    if (gone(p)) throw new Error(`${s.script} exited (${p.signalCode ?? p.exitCode})`);
    if (i > 1200) throw new Error(`${s.script} did not answer on ${s.port}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function up(script: string, port: number, probe: string, ...more: string[]): Promise<string> {
  const s: Server = { script, port, probe, more, p: null };
  servers.push(s);
  await start(s);
  const base = `http://localhost:${port}`;
  byBase.set(base, s);
  return base;
}
/** the server at `base` answers, or is started again: null, else why it is down (printed once) */
async function serverUp(base: string): Promise<{ down: string | null; restarted?: string }> {
  const s = byBase.get(base);
  if (!s) return { down: null };
  if (s.down) return { down: s.down };
  if (!gone(s.p) && await answers(base + s.probe, 15000)) return { down: null };
  const why = gone(s.p) ? `exited (${s.p?.signalCode ?? s.p?.exitCode})` : 'did not answer';
  console.log(`\n     the dev server ${base} ${why}: starting it again …`);
  if (s.p && !gone(s.p)) { const p = s.p; await new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); }); }
  try { await start(s); return { down: null, restarted: `the dev server ${base} ${why}: started again before this suite` }; }
  catch (e) {
    s.down = `the dev server ${base} is down (${why}; starting it again failed: ${(e as Error).message})`;
    console.log(`     ${s.down}: the suites that need it fail with this line`);
    return { down: s.down };
  }
}
const stop = () => { for (const s of servers) s.p?.kill(); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const needDev = picked.some((p) => p.s.group === 'dev');
const needSeed = !COLD && picked.some((p) => seeded(p.s));
// ports: 8 per lane from a base that depends on the pid (two test-alls side by side do not meet)
const port0 = 21000 + (process.pid % 1000) * 32;
/** a lane: its own dev servers (cold, seeded); the file is shared (read only) */
interface Lane { i: number; ctx: Ctx; seeded: string }
const lanes: Lane[] = Array.from({ length: LANES }, (_, i) => ({ i, ctx: { dev: '', file: FILE }, seeded: '' }));
let seedOk = false;      // the seed cache fits the worker: the suites that are not cold use the seeded server
if (needDev) {
  // the dev page loads app/lib/app.js, a bundle: rebuilt from the sources first, or the dev suites test old code
  if (!argv.includes('--no-bundle')) {
    const code = await new Promise<number | null>((r) => spawn(process.execPath, [join(HERE, 'scripts/w3-build.ts')], { cwd: HERE, stdio: ['ignore', 'ignore', 'inherit'] }).on('close', r));
    if (code !== 0) { console.error(`the dev bundle did not build (scripts/w3-build.ts exit ${code})`); process.exit(1); }
    // and the worker the dev server serves (engine/dist/editor-worker.js), as a release build makes it
    const wcode = await new Promise<number | null>((r) => spawn(process.execPath, [join(HERE, 'engine/scripts/build-worker.ts')], { cwd: join(HERE, 'engine'), stdio: ['ignore', 'ignore', 'inherit'] }).on('close', r));
    if (wcode !== 0) { console.error(`the worker did not build (engine/scripts/build-worker.ts exit ${wcode})`); process.exit(1); }
  }
  for (const L of lanes) {
    const p = port0 + L.i * 8;
    L.ctx.dev = await up('tests/integration/serve.ts', p, '/bundle/info');
    if (needSeed) L.seeded = await up('tests/integration/serve.ts', p + 2, '/bundle/info', '--seed-cache');
    console.log(`lane ${L.i}: dev app ${L.ctx.dev}${L.seeded ? ` · seeded ${L.seeded}` : ''}`);
  }
  if (needSeed) {
    let info = await (await fetch(`${lanes[0].seeded}/dev/seed-cache-info`)).json();
    // a cache recorded for another engine build (or none): recorded again once, from
    // the cold dev app (tests/integration/record-seed-cache.ts, about a minute), not by a release build
    if (!info.ok && !argv.includes('--no-seed-record')) {
      console.log(`note: the dev seed cache does not fit the worker (${info.problem}): recording it again from the dev app…`);
      const t = Date.now();
      const code = await new Promise<number | null>((r) => spawn(process.execPath, [join(HERE, 'tests/integration/record-seed-cache.ts'), lanes[0].ctx.dev], { cwd: HERE, stdio: ['ignore', 'inherit', 'inherit'] }).on('close', r));
      info = await (await fetch(`${lanes[0].seeded}/dev/seed-cache-info`)).json();
      console.log(`note: seed cache recorded in ${Math.round((Date.now() - t) / 1000)} s (exit ${code})${info.ok ? '' : `; still not usable: ${info.problem}`}`);
    }
    seedOk = !!info.ok;
    console.log(info.ok ? `dev seed cache: ${info.results} results of engine ${info.build}` : `dev seed cache NOT used (the seeded suites typeset cold): ${info.problem}`);
    // the fixture cache (?seed=sample's blocks): recorded again from the cold dev app when the fixture
    // or the engine changed (its key), so the seeded suites open the fixture with nothing to compile
    if (!argv.includes('--no-seed-record')) {
      const { ensureFixtureCache } = await import('./integration/fixture-cache.ts');
      const fs = await ensureFixtureCache(lanes[0].ctx.dev);
      if (fs.recorded) console.log(`note: fixture cache recorded in ${fs.seconds} s`);
    }
    const fixture = (await (await fetch(`${lanes[0].seeded}/dev/seed-cache-info`)).json()).fixture;
    console.log(fixture?.ok ? `fixture cache: ${fixture.results} results (key ${fixture.key})` : `fixture cache NOT used (the seeded suites typeset the fixture cold): ${fixture?.problem}`);
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
interface Row { name: string; group: string; status: 'pass' | 'fail' | 'known' | 'skipped' | 'timeout' | 'flaky' | 'unsure'; load?: number[]; first?: string[]; counts: string; seconds: number; fails: string[]; known: string[]; note?: string; wallOver?: number; factors?: [number, number]; tooLoaded?: number; sampled?: boolean; seeded?: boolean; lane?: number; phase?: 'lanes' | 'quiet' }
const rows: Row[] = [];
/** pid and its descendants, read before any is killed (a killed parent's children go to init and out of reach) */
function tree(pid: number): number[] {
  let ps: number[][] = [];
  try { ps = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 2 && r[0] > 0); } catch { /* no ps: the pid alone */ }
  const out = [pid];
  for (let i = 0; i < out.length; i++) for (const [c, pp] of ps) if (pp === out[i] && !out.includes(c)) out.push(c);
  return out;
}
async function run(s: Suite, sampled: boolean, L: Lane): Promise<Row> {
  // every row's script is in the repository (test-select checks it): a missing one fails, it is not skipped
  if (!existsSync(join(HERE, scriptOf(s)))) return { name: s.name, group: s.group, status: 'fail', counts: '', seconds: 0, fails: [`${scriptOf(s)} is not in the repository`], known: [] };
  const miss = s.needs === 'file' && !existsSync(FILE) ? `${FILE} not built (node scripts/build.ts)` : s.needs === 'intro' && !introBuilt() ? 'the intro is not built (node scripts/seed.ts)' : s.seedOnly && !seedOk ? 'no dev seed cache (--cold, or it does not fit the worker)' : null;
  if (miss) return { name: s.name, group: s.group, status: 'skipped', counts: '', seconds: 0, fails: [], known: [], note: miss };
  const useSeed = !!L.seeded && seedOk && seeded(s);
  const srv = s.group === 'dev' ? await serverUp(useSeed ? L.seeded : L.ctx.dev) : { down: null };
  if (srv.down) return { name: s.name, group: s.group, status: 'fail', counts: '', seconds: 0, fails: [srv.down], known: [] };
  return new Promise((resolve) => {
    const [cmd, ...args] = (sampled && s.sample ? s.sample : s.cmd)(useSeed ? { ...L.ctx, dev: L.seeded } : L.ctx);
    const log = createWriteStream(join(RUN, `${s.name}.log`));
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RTX_RESULTS: join(RUN, s.name), ...(STRICT ? { RTX_TIMING_STRICT: '1' } : {}) } });
    let text = '';
    const take = (d: Buffer) => { text += d.toString(); log.write(d); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    // the time limit: the suite and everything it started (its browsers) killed; its output ends with them, or
    // 10 s later at the latest (a process out of reach holding the pipes does not keep the run waiting)
    let timedOut = false, ended = false, grace: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      for (const pid of p.pid ? tree(p.pid) : []) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
      grace = setTimeout(() => { p.stdout.destroy(); p.stderr.destroy(); end(null); }, 10000);
    }, s.minutes * 60000);
    p.on('close', (code) => end(code));
    function end(code: number | null) {
      if (ended) return;
      ended = true;
      clearTimeout(timer); if (grace) clearTimeout(grace);
      log.end();
      const lines = text.split('\n');
      const failLines = lines.filter((l) => /^\s*FAIL\b/.test(l) || /^FAIL /.test(l));
      const known: string[] = [], fails: string[] = [];
      for (const l of failLines) {
        const k = KNOWN.find((x) => x.suite.test(s.name) && x.line.test(l));
        (k ? known : fails).push(k ? `${l.trim().slice(0, 160)} — known: ${k.why}` : l.trim().slice(0, 300));
      }
      const counts = [...text.matchAll(/(\d+)\/(\d+) (?:checks )?passed/g)].pop()?.slice(1, 3).join('/') ?? (/ALL PASS/.test(text) ? 'all' : '');
      const tooLoaded = tooLoadedLines(lines).length, factors = factorsIn(text);
      const loadedOnly = !timedOut && !fails.length && tooLoaded > 0;      // the host too loaded to judge: unsure, not a failure
      const bad = !loadedOnly && (timedOut || fails.length > 0 || (code !== 0 && known.length === 0));
      const status: Row['status'] = timedOut ? 'timeout' : bad ? 'fail' : loadedOnly ? 'unsure' : known.length ? 'known' : 'pass';
      if (code !== 0 && !fails.length && !known.length && !timedOut && !loadedOnly) fails.push(`exit ${code}: ${lines.filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`);
      const wallOver = lines.filter((l) => /^wall OVER/.test(l)).length;      // wall-clock misses the work measures did not share
      resolve({ name: s.name, group: s.group, status, counts, seconds: Math.round((Date.now() - t0) / 1000), fails, known, ...(srv.restarted ? { note: srv.restarted } : {}), ...(wallOver ? { wallOver } : {}), ...(factors ? { factors } : {}), ...(tooLoaded ? { tooLoaded } : {}), ...(sampled ? { sampled: true } : {}), ...(useSeed ? { seeded: true } : {}) });
    }
  });
}
/** a timing suite that failed runs once more (the flaky ledger); load is read before each run */
async function runTimed(s: Suite, sampled: boolean, L: Lane): Promise<Row> {
  const l0 = loadavg()[0];
  const r = await run(s, sampled, L);
  if (!s.timing || r.status !== 'fail') return r;
  const l1 = loadavg()[0];
  console.log(`\n     ${s.name} failed (load ${l0.toFixed(1)}): its one rerun, load ${l1.toFixed(1)} …`);
  const again = await run(s, sampled, L);
  const load = [Math.round(l0 * 10) / 10, Math.round(l1 * 10) / 10];
  const verdict = afterRerun(again.status, [l0, l1], LOAD_LIMIT);
  if (verdict === 'flaky') flaky(s.name, r.fails, l0);
  return { ...again, ...(verdict === 'fail' ? {} : { status: verdict }), load, first: r.fails, seconds: r.seconds + again.seconds };
}
const norm = normLine;
/** the ledger: one line per FAIL line of a run that passed on its rerun; a check flaky twice in 7 days is named */
function flaky(name: string, fails: string[], load: number) {
  const at = new Date();
  let old: string[] = [];
  try { old = readFileSync(FLAKES, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')); } catch { /* the first */ }
  const add = fails.map((f) => [at.toISOString(), name, load.toFixed(1), f.replace(/\s+/g, ' ').slice(0, 300)].join('\t'));
  try {
    if (!existsSync(FLAKES)) writeFileSync(FLAKES, '# test-all: timing checks that failed and passed on their one rerun (date, suite, 1-min load, line)\n');
    writeFileSync(FLAKES, add.join('\n') + '\n', { flag: 'a' });
  } catch (e) { console.log(`     (the flaky ledger could not be written: ${e})`); }
  for (const f of fails) {
    const twice = old.filter((l) => { const [d, n, , line] = l.split('\t'); return n === name && at.getTime() - Date.parse(d) <= 7 * 86400000 && norm(line ?? '') === norm(f); });
    if (twice.length) console.log(`     FLAKY TWICE IN 7 DAYS (${name}): «${norm(f).slice(0, 160)}» — make it work-based rather than time-based`);
  }
}
const label = (s: Suite, sampled: boolean, L: Lane) => `${s.name} (${s.group}${sampled ? ', sampled' : ''}${seedOk && seeded(s) ? ', seeded' : ''}${LANES > 1 ? `, lane ${L.i}` : ''})`;
function report(r: Row, head: string) {
  console.log(`${head}${r.status}${r.counts ? ` ${r.counts}` : ''} in ${r.seconds} s${r.note ? ` (${r.note})` : ''}${r.wallOver ? ` (${r.wallOver} over by the wall clock only: reported)` : ''}${r.factors ? ` (calibration factor ${r.factors[0] === r.factors[1] ? r.factors[0].toFixed(2) : r.factors.map((f) => f.toFixed(2)).join('–')})` : ''}`);
  for (const f of r.fails.slice(0, 8)) console.log(`     ${f}`);
  for (const k of r.known) console.log(`     ${k}`);
  if (r.status === 'flaky' || r.status === 'unsure') for (const f of (r.first ?? []).slice(0, 4)) console.log(`     first run (load ${r.load?.[0]}): ${f}`);
  if (r.status === 'unsure' && r.tooLoaded) console.log(`     unsure: HOST TOO LOADED: ${r.tooLoaded} work check${r.tooLoaded > 1 ? 's' : ''} not judged (the calibration factor at its cap): rerun it alone on a quieter host`);
  else   if (r.status === 'unsure') console.log(`     unsure: failed twice with the machine busy (load ${r.load?.join(', ')} > ${LOAD_LIMIT}): rerun it alone before merging`);
}

const t0 = Date.now();
type Job = (typeof picked)[number];
// Phase 1, the lanes: the suites that tolerate load, LANES at a time, each lane on its own servers (longest first when
// there are several lanes, so the longest does not start last). Phase 2, the quiet phase: the timing suites and those
// that sample frames, one after another, nothing else running.
const loud = picked.filter((p) => !p.s.alone), quiet = picked.filter((p) => p.s.alone);
const queue: Job[] = LANES > 1 ? [...loud].sort((a, b) => estimate(b.s.name, b.sampled, HIST) - estimate(a.s.name, a.sampled, HIST)) : [...loud];
async function lane(L: Lane) {
  for (let job = queue.shift(); job; job = queue.shift()) {
    if (LANES === 1) process.stdout.write(`── ${label(job.s, job.sampled, L)} … `);
    const r = { ...(await runTimed(job.s, job.sampled, L)), lane: L.i, phase: 'lanes' as const };
    rows.push(r);
    report(r, LANES === 1 ? '' : `── ${label(job.s, job.sampled, L)} … `);
  }
}
await Promise.all(lanes.map(lane));
const tLanes = Date.now();
if (quiet.length && LANES > 1) console.log(`── the quiet phase: ${quiet.length} suites alone`);
for (const job of quiet) {
  process.stdout.write(`── ${label(job.s, job.sampled, lanes[0]).replace(/, lane \d+/, ', quiet')} … `);
  const r = { ...(await runTimed(job.s, job.sampled, lanes[0])), lane: 0, phase: 'quiet' as const };
  rows.push(r);
  report(r, '');
}
stop();


// a known failure that did not happen: say so (the list above is then out of date)
const cleared = KNOWN.filter((k) => rows.some((r) => k.suite.test(r.name) && r.status !== 'skipped') && !rows.some((r) => r.known.some((l) => k.line.test(l))));
const failed = rows.filter((r) => r.status === 'fail' || r.status === 'timeout');
const unsure = rows.filter((r) => r.status === 'unsure'), flakyRows = rows.filter((r) => r.status === 'flaky');
const minutes = Math.round((Date.now() - t0) / 60000);
const phases = { lanesMinutes: Math.round((tLanes - t0) / 6000) / 10, quietMinutes: Math.round((Date.now() - tLanes) / 6000) / 10 };
console.log(`\n${rows.length} suites in ${minutes} min${LANES > 1 ? ` (${LANES} lanes ${phases.lanesMinutes} min, quiet phase ${phases.quietMinutes} min)` : ''}: ${rows.filter((r) => r.status === 'pass').length} pass, ${rows.filter((r) => r.status === 'known').length} known failures only, ${failed.length} failed${flakyRows.length ? `, ${flakyRows.length} flaky (passed on the rerun: ${flakyRows.map((r) => r.name).join(', ')})` : ''}${unsure.length ? `, ${unsure.length} UNSURE (${unsure.map((r) => r.name).join(', ')}: rerun alone)` : ''}, ${rows.filter((r) => r.status === 'skipped').length} skipped`);
// the known failures seen, with their age; the old ones for review
for (const k of KNOWN.filter((x) => rows.some((r) => r.known.some((l) => x.line.test(l))))) { const age = knownAge(k); console.log(`known: ${k.issue} (${k.owner}), added ${k.added}, ${age} days${age > KNOWN_REVIEW_DAYS ? ` — over ${KNOWN_REVIEW_DAYS} days: REVIEW` : ''}`); }
for (const k of cleared) console.log(`note: the known failure «${k.line.source}» did not occur: remove it from KNOWN`);
const summary = { at: new Date().toISOString(), run: RUN, tier: TIER, base: BASE, file: FILE, lanes: LANES, minutes, ...phases, rows, cleared: cleared.map((k) => k.line.source) };
writeFileSync(join(RUN, 'summary.json'), JSON.stringify(summary, null, 1));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
mkdirSync(HISTORY, { recursive: true });
writeFileSync(join(HISTORY, `${summary.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(summary));
process.exit(failed.length ? 1 : unsure.length ? 2 : 0);
