// Timing checks measured by work, not by the clock (decision 5). Under load a task takes longer by
// the clock but not in CPU time: the page's main thread is measured from a Chrome trace, per task (RunTask) and per
// input event (EventDispatch), in thread CPU time (the trace's tdur). The checks gate on that; the wall-clock numbers
// they gated on before are printed, and gate only with --timing-strict (or RTX_TIMING_STRICT=1), for a run alone on
// a quiet machine. Chromium only.
//
//   const w = await traceWork(page, async () => { await page.mouse.click(x, y); … });
//   w.long(50)                  tasks over 50 ms of CPU
//   w.event('click', 'keydown') the most CPU one input event's dispatch took (its handlers and the layout they force)
//   w.cpu                       the main thread's CPU time over the window
//   w.marks                     the page's console.timeStamp(label) calls: { name, at } (at: the tasks' clock), so a
//                               check can take the tasks from a point in the window on (t.at + t.wall > mark.at)
//   timed(check, name, workOk, workDetail, wallOk, wallDetail)
//
// Calibrated limits. CPU time grows too on a loaded host (shared caches, frequency
// scaling, SMT, a VM's vCPUs descheduled), so a fixed limit in ms fails good builds under load. A fixed reference
// workload (REFERENCE: some JS, then style and layout of 600 elements in a contained shadow root) runs in the page under
// test before and after each measured window, timed in thread CPU time from the same trace; the median of REPS runs
// over the quiet-machine baseline (work.baseline.json, recorded by tests/qa/record-work-baseline.ts) is the factor,
// clamped to [1, CAP]; a window's checks use the higher of its two ends. Every
// work-based limit is budget(ms) = ms × the factor: a fast machine never tightens a limit. At the cap the host is too
// loaded to judge: a failing work check then prints HOST TOO LOADED (not FAIL), and the run exits 2 (test-all: unsure).
//
//   await calibrate(page)       before a measured window (re-measured when older than 30 s; never inside a window)
//   await calibrateAfter(page)  after it, before its checks: the window's factor is the higher of the two
//   budget(34)                  34 ms × the factor;  lim(34) its label, "39 ms (34 × 1.15)"
//   gate(check, name, ok, d)    a work check: at the cap, a miss is HOST TOO LOADED, not FAIL
// The wall-clock checks (--timing-strict) are not scaled.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TIMING_STRICT = process.argv.includes('--timing-strict') || process.env.RTX_TIMING_STRICT === '1';

export interface Task { at: number; wall: number; cpu: number }
export interface Work {
  tasks: Task[];
  events: { type: string; wall: number; cpu: number }[];
  /** CPU time (ms) of the main thread's tasks in the window */
  cpu: number;
  /** the page's console.timeStamp(label) marks, in the tasks' clock (ms) */
  marks: { name: string; at: number }[];
  /** tasks whose CPU time is over ms */
  long(ms: number): Task[];
  /** the most CPU (ms) a dispatch of one of these input events took; 0 if none */
  event(...types: string[]): number;
}

const sessions = new WeakMap<any, any>();
async function session(page: any) {
  let s = sessions.get(page);
  if (!s) { s = await page.context().newCDPSession(page); sessions.set(page, s); }
  return s;
}

/** Runs act with the page's main thread traced; its tasks and input events, in CPU time. */
export async function traceWork<T>(page: any, act: () => Promise<T>): Promise<Work & { result: T }> {
  const cdp = await session(page);
  const events: any[] = [];
  const take = (e: any) => { for (const x of e.value) events.push(x); };
  cdp.on('Tracing.dataCollected', take);
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline'], recordMode: 'recordAsMuchAsPossible' } });
  let result: T;
  try { result = await act(); } finally {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end');
    await done;
    cdp.off('Tracing.dataCollected', take);
  }
  return { ...analyse(events), result: result! };
}

/** The busiest renderer main thread of a trace (the page under test): its tasks and input events. */
export function analyse(events: any[]): Work {
  const mains = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
  const byThread = new Map<string, any[]>();
  for (const e of events) {
    const k = `${e.pid}:${e.tid}`;
    if (e.ph !== 'X' || !mains.has(k)) continue;
    let a = byThread.get(k);
    if (!a) byThread.set(k, (a = []));
    a.push(e);
  }
  // a top-level task: 'RunTask', or 'ThreadControllerImpl::RunTask' (Chromium 141: the Playwright-bundled builds differ)
  const isTask = (e: any) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask';
  const cpuOf = (es: any[]) => es.filter(isTask).reduce((a, e) => a + (e.tdur ?? e.dur ?? 0), 0);
  const main = [...byThread.values()].sort((a, b) => cpuOf(b) - cpuOf(a))[0] ?? [];
  const tasks: Task[] = main.filter(isTask).map((e) => ({ at: e.ts / 1000, wall: (e.dur ?? 0) / 1000, cpu: (e.tdur ?? e.dur ?? 0) / 1000 }));
  const evs = main.filter((e) => e.name === 'EventDispatch').map((e) => ({ type: String(e.args?.data?.type ?? ''), wall: (e.dur ?? 0) / 1000, cpu: (e.tdur ?? e.dur ?? 0) / 1000 }));
  const marks = events.filter((e) => e.name === 'TimeStamp').map((e) => ({ name: String(e.args?.data?.message ?? e.args?.data?.name ?? ''), at: e.ts / 1000 }));
  return {
    tasks, events: evs, marks,
    cpu: tasks.reduce((a, t) => a + t.cpu, 0),
    long: (ms) => tasks.filter((t) => t.cpu > ms),
    event: (...types) => Math.max(0, ...evs.filter((e) => types.includes(e.type)).map((e) => e.cpu)),
  };
}

// ── calibration ─────────────────────────────────────────────────────────────────────────────────────────────────
export const CAP = 4;
export const REPS = 5;
const MAX_AGE_MS = 30000;
export const BASELINE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'work.baseline.json');
export interface Baseline { cpuMs: number; recorded: string; reps: number; spread: [number, number]; host: string; chromium: string; how: string; provisional?: string }
export interface Calibration { measured: number; baseline: number; raw: number; factor: number; tooLoaded: boolean; runs: number[]; at: number }

/** measured / baseline, clamped to [1, cap]; at or over the cap the host is too loaded to judge */
export function factorOf(measured: number, baseline: number, cap = CAP): { raw: number; factor: number; tooLoaded: boolean } {
  const raw = baseline > 0 && measured > 0 ? measured / baseline : 1;
  return { raw, factor: Math.min(cap, Math.max(1, raw)), tooLoaded: raw >= cap };
}
export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

export function readBaseline(file = BASELINE_FILE): Baseline | null {
  try { const b = JSON.parse(readFileSync(file, 'utf8')); return b.cpuMs > 0 ? b : null; } catch { return null; }
}

/** The reference workload, run in the page (it must be self-contained: Playwright sends its source). Deterministic:
 *  a seeded generator, a sort, string hashing, a Map; then 200 rows × 3 cells built in a shadow root under a
 *  `contain: strict` host off screen (the page's own style and layout untouched), laid out at 4 widths. Marked with
 *  console.timeStamp at its start and end: the trace's thread timestamps (tts) of the two give its CPU time. */
export function REFERENCE(): number {
  console.timeStamp('rtx-calibrate-start');
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = Array.from({ length: 10000 }, rnd).sort((x, y) => x - y);
  let h = 0;
  for (let i = 0; i < 15000; i++) { const t = (Math.imul(i, 2654435761) >>> 0).toString(36); for (let k = 0; k < t.length; k++) h = (Math.imul(h, 31) + t.charCodeAt(k)) | 0; }
  const m = new Map<string, number>();
  for (let i = 0; i < 10000; i++) m.set(`k${i % 4000}`, (m.get(`k${i % 4000}`) ?? 0) + i);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:1000px;height:800px;contain:strict;overflow:hidden;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>.r{display:flex;gap:4px;padding:2px;font:13px/1.3 sans-serif}.r>span{flex:1 1 auto;border:1px solid #888;padding:1px 3px}.w .r>span{flex-basis:30%;font-style:italic}.r:nth-child(3n)>span{font-weight:bold}</style>';
  const box = document.createElement('div');
  root.appendChild(box);
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');
  for (let i = 0; i < 200; i++) {
    const r = document.createElement('div');
    r.className = 'r';
    for (let j = 0; j < 3; j++) { const sp = document.createElement('span'); sp.textContent = `${i}.${j} ${words.slice(0, 1 + ((i * 7 + j * 3) % words.length)).join(' ')}`; r.appendChild(sp); }
    box.appendChild(r);
  }
  document.body.appendChild(host);
  let y = 0;
  for (let k = 0; k < 4; k++) {
    box.classList.toggle('w');
    box.style.width = `${400 + k * 150}px`;
    y += box.offsetHeight;
    for (const sp of box.querySelectorAll('.r:nth-child(10n) > span')) y += (sp as HTMLElement).offsetWidth;
  }
  host.remove();
  console.timeStamp('rtx-calibrate-end');
  return (h ^ a.length ^ m.size ^ y) | 0;
}

/** the reference runs' CPU times (ms) in a trace: from each start mark's thread time to the next end mark's */
export function referenceRuns(events: any[]): number[] {
  const marks = events.filter((e) => e.name === 'TimeStamp' && /^rtx-calibrate-(start|end)$/.test(e.args?.data?.message ?? '') && e.tts != null)
    .sort((a, b) => a.ts - b.ts);
  const runs: number[] = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const s = marks[i], e = marks[i + 1];
    if (s.args.data.message.endsWith('start') && e.args.data.message.endsWith('end') && s.pid === e.pid && s.tid === e.tid) { runs.push((e.tts - s.tts) / 1000); i++; }
  }
  return runs;
}

/** Runs the reference workload REPS times in the page (one warm-up first), in one trace: their CPU times. */
export async function measureReference(page: any, reps = REPS, warmUp = true): Promise<number[]> {
  if (warmUp) await page.evaluate(REFERENCE);                     // the warm-up (once per page): compile, first style
  const cdp = await session(page);
  const events: any[] = [];
  const take = (e: any) => { for (const x of e.value) events.push(x); };
  cdp.on('Tracing.dataCollected', take);
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline'], recordMode: 'recordAsMuchAsPossible' } });
  try { for (let i = 0; i < reps; i++) await page.evaluate(REFERENCE); } finally {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end');
    await done;
    cdp.off('Tracing.dataCollected', take);
  }
  return referenceRuns(events);
}

let last: Calibration | null = null;          // the last measurement
let current: Calibration | null = null;       // what the limits use: the last measurement, or after a window the higher of its two ends
const seen: Calibration[] = [];
let tooLoadedMisses = 0;
const forced = Number(process.env.RTX_WORK_FACTOR) || 0;     // a fixed factor (tests of this module, a manual rerun)
const warmed = new WeakSet<any>();
let warnedProvisional = false;

async function measure(page: any, quiet: boolean, label: string): Promise<Calibration> {
  if (forced) return setCalibration(forced * 20, 20, { quiet, label });
  const base = readBaseline();
  const runs = await measureReference(page, REPS, !warmed.has(page));
  warmed.add(page);
  if (!base) {
    last = current = { measured: median(runs), baseline: 0, raw: 1, factor: 1, tooLoaded: false, runs, at: Date.now() };
    if (!quiet) console.log(`calibration: NO BASELINE (${BASELINE_FILE}); the limits are unscaled (× 1). Record one: node tests/qa/record-work-baseline.ts`);
    return current;
  }
  if (base.provisional && !warnedProvisional && !quiet) { warnedProvisional = true; console.log(`calibration: PROVISIONAL baseline (${base.cpuMs} ms, ${base.recorded}): ${base.provisional}`); }
  return setCalibration(median(runs), base.cpuMs, { runs, quiet, label });
}
/** Before a measured window: the factor for this host's load, measured in this page unless measured within maxAgeMs
 *  (then the last measurement stands). Call it at a quiet point, never inside a window: the workload is a task. */
export async function calibrate(page: any, { maxAgeMs = MAX_AGE_MS, quiet = false } = {}): Promise<Calibration> {
  if (last && Date.now() - last.at < maxAgeMs) return (current = last);
  return measure(page, quiet, '');
}
/** After a measured window (before its checks): measured again; the window's limits use the higher of the factor
 *  before it and this one, so that load which came or went during the window does not decide the check. */
export async function calibrateAfter(page: any, { quiet = false } = {}): Promise<Calibration> {
  const before = last;
  const after = await measure(page, quiet, ' after the window');
  if (before && before.raw > after.raw && Date.now() - before.at < 2 * MAX_AGE_MS) {
    current = { ...after, raw: before.raw, factor: before.factor, tooLoaded: before.tooLoaded };
    if (!quiet) console.log(`calibration: the window's factor ${current.factor.toFixed(2)} (the higher of before and after)`);
  }
  return current!;
}
/** sets the calibration from a measurement (exported for the tests of this module) */
export function setCalibration(measured: number, baseline: number, { runs = [measured], quiet = false, label = '' } = {}): Calibration {
  const f = factorOf(measured, baseline);
  last = current = { measured, baseline, ...f, runs, at: Date.now() };
  seen.push(current);
  if (!quiet) console.log(`calibration${label}: the reference took ${measured.toFixed(1)} ms of CPU (median of ${runs.length}: ${runs.map((r) => r.toFixed(1)).join(' ')}; quiet baseline ${baseline.toFixed(1)}) → factor ${f.factor.toFixed(2)}${f.tooLoaded ? ` — at the cap ${CAP} (raw ${f.raw.toFixed(2)}): HOST TOO LOADED to judge timing` : ''}`);
  return current;
}
export const calibration = () => current;
export const factor = () => current?.factor ?? 1;
/** a work-based limit, scaled by the factor */
export const budget = (ms: number) => ms * factor();
/** its label: "39 ms (34 × 1.15)" */
export const lim = (ms: number) => `${Math.round(budget(ms))} ms (${ms} × ${factor().toFixed(2)})`;

/** A work check. At the cap (the host too loaded to judge) a miss is reported as HOST TOO LOADED, not as a failure;
 *  behaviourOk false (a check that also tests behaviour, which load cannot excuse) always fails. */
export function gate(check: (name: string, ok: boolean, detail?: unknown) => void, name: string, ok: boolean, detail?: unknown, { behaviourOk = true } = {}) {
  if (behaviourOk && !ok && current?.tooLoaded) {
    tooLoadedMisses++;
    console.log(`HOST TOO LOADED ${name} — the reference workload ran ${current.raw.toFixed(2)}× its quiet time (cap ${CAP}): not judged, not a regression; rerun on a quieter host — ${short(detail ?? '')}`);
    return;
  }
  check(name, behaviourOk && ok, detail);
}
export const tooLoadedCount = () => tooLoadedMisses;
/** forgets every calibration and miss (for the tests of this module) */
export function resetCalibration() { current = last = null; seen.length = 0; tooLoadedMisses = 0; }
// the summary at exit: the factors seen; a run with only too-loaded misses exits 2 (unsure), not 0
process.on('exit', (code) => {
  if (!seen.length) return;
  const fs = seen.map((c) => c.factor);
  console.log(`calibration: ${seen.length} measurement${seen.length > 1 ? 's' : ''}, factor ${Math.min(...fs).toFixed(2)}–${Math.max(...fs).toFixed(2)}${seen.some((c) => c.tooLoaded) ? `; at the cap ${seen.filter((c) => c.tooLoaded).length}×` : ''}`);
  if (tooLoadedMisses) {
    console.log(`HOST TOO LOADED: ${tooLoadedMisses} work check${tooLoadedMisses > 1 ? 's' : ''} not judged (the factor at its cap ${CAP}); rerun alone on a quieter host`);
    if (code === 0) process.exitCode = 2;
  }
});

const short = (d: unknown) => (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400);
/** A timing check: the work measure gates (through gate: at the cap, HOST TOO LOADED); the wall-clock one is printed
 *  ("wall ok"/"wall OVER", not a check), and gates only with --timing-strict, as its own check "(wall clock)". */
export function timed(check: (name: string, ok: boolean, detail?: unknown) => void, name: string,
  workOk: boolean, workDetail: unknown, wallOk: boolean, wallDetail: unknown) {
  gate(check, name, workOk, workDetail);
  if (TIMING_STRICT) check(`${name} (wall clock)`, wallOk, wallDetail);
  else console.log(`wall ${wallOk ? 'ok  ' : 'OVER'} ${name} (wall clock, reported only) — ${short(wallDetail)}`);
}
