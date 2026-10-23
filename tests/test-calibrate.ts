// CALIBRATE: the timing checks' work limits are scaled by the host's factor (the
// reference workload's CPU time in the page under test over its quiet baseline, tests/qa/lib/work.ts). This checks that
//   - the factor is measured in the page, within [1, cap], and the reference leaves the page as it was;
//   - a genuine regression is still caught: work injected into the press's handler (a test-only flag, window.__rtxSlow:
//     the reference workload run k times in a capture-phase pointerdown listener, k × baseline ≈ 3 × the limit) fails
//     the calibrated gate of test-motion's check (the press's work ≤ 34 ms of CPU), while the same press without it passes;
//   - with the host loaded on purpose (CPU-burning processes in this container, 2 per core) the factor rises, the good
//     press passes its calibrated limit, and the injected regression still fails (or, at the cap, is HOST TOO LOADED,
//     never a pass).
// Waits on whenIdle(), the caret map's count and the session list; no fixed times.
//
//   node tests/test-calibrate.ts [http://localhost:8151/] [--no-load]
// Results: test-results/calibrate/results.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { traceWork, calibrate, calibrateAfter, budget, lim, gate, readBaseline, median, REFERENCE, CAP } from './qa/lib/work.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'calibrate');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0].replace(/\/?$/, '/') : 'http://localhost:8151/';
const NO_LOAD = argv.includes('--no-load');
const PRESS_MS = 34;                                  // test-motion's limit for the press's work

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 500)}` : ''}`);
}
/** the verdict gate() gives (pass, fail or too-loaded), without counting it as this suite's check */
function verdict(ok: boolean): 'pass' | 'fail' | 'too loaded' {
  let v: 'pass' | 'fail' | 'too loaded' = 'too loaded';
  const log = console.log;
  console.log = () => {};
  try { gate((_n, k) => { v = k ? 'pass' : 'fail'; }, 'probe', ok, {}); } finally { console.log = log; }
  return v;
}

const base = readBaseline();
check('a quiet baseline is recorded (tests/qa/lib/work.baseline.json)', !!base, base ?? 'none: node tests/qa/record-work-baseline.ts');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message));
page.setDefaultTimeout(180000);
await page.goto(`${BASE}?seed=sample&engine&store=memory#/doc/sample`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();

// the test-only slowdown: the reference workload, k times, in the press's own dispatch, while window.__rtxSlow = k
await page.evaluate(`window.__rtxRef = ${REFERENCE.toString()};
  window.addEventListener('pointerdown', () => { for (let i = 0; i < (window.__rtxSlow || 0); i++) window.__rtxRef(); }, true);`);

// ── the factor, in this page; the page as it was ──
const before = await page.evaluate(() => ({ blocks: document.querySelectorAll('.blk').length, body: document.body.children.length }));
const quiet = await calibrate(page, { maxAgeMs: 0 });
const after = await page.evaluate(() => ({ blocks: document.querySelectorAll('.blk').length, body: document.body.children.length }));
check(`the factor is measured in the page under test: ${quiet.factor.toFixed(2)} (raw ${quiet.raw.toFixed(2)}), within [1, ${CAP}]`, quiet.runs.length >= 5 && quiet.factor >= 1 && quiet.factor <= CAP, quiet);
check('the reference workload leaves the page as it was (its host removed, the blocks untouched)', JSON.stringify(before) === JSON.stringify(after), { before, after });

// a paragraph to open: mid-document, in view; one open and close first (the editor's first creation is cold)
const id: string = await page.evaluate(() => { const bs = (window as any).editorAPI.blocks().filter((b: any) => b.kind === 'paragraph' && !b.parentId && b.source.length > 120); return bs[Math.floor(bs.length / 2)].id; });
async function press(tag: string) {
  await page.keyboard.press('Escape');
  await page.waitForFunction((i: string) => !document.querySelector(`.blk[data-id="${i}"].editing`), id);
  await idle();
  const pt = await page.evaluate((i: string) => { const el = document.querySelector(`.blk[data-id="${i}"] .blk-render`)!; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(200, r.width / 2), y: r.top + 10 }; }, id);
  await idle();
  const w0 = await page.evaluate(() => (window as any).editorAPI.warmStats().warmed);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction((n: number) => (window as any).editorAPI.warmStats().warmed > n, w0, { timeout: 5000 }).catch(() => {});
  await calibrate(page);                                       // as the suites do: before the window, and after it
  const work = await traceWork(page, async () => {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForFunction((i: string) => (window as any).editorAPI.sessions().some((s: any) => s.id === i), id);
    await idle();
  });
  await calibrateAfter(page);
  const ms = work.event('click', 'mousedown', 'pointerdown');
  console.log(`     ${tag}: the press's work ${ms.toFixed(1)} ms of CPU, limit ${lim(PRESS_MS)}`);
  return { ms, v: verdict(ms <= budget(PRESS_MS)), limit: Math.round(budget(PRESS_MS)) };
}
await press('warm-up');
const k = Math.max(1, Math.ceil((3 * PRESS_MS) / (base?.cpuMs || 20)));

async function round(label: string) {
  const g = await press(`${label}, good code`);
  await page.evaluate((n: number) => { (window as any).__rtxSlow = n; }, k);
  const s = await press(`${label}, ${k} reference runs injected into the press`);
  await page.evaluate(() => { (window as any).__rtxSlow = 0; });
  return { good: g.ms, slow: s.ms, good_v: g.v, slow_v: s.v, good_limit: g.limit, slow_limit: s.limit };
}
const q = await round('as found');
check(`as found: the good press passes its calibrated limit (${Math.round(q.good)} ms ≤ ${q.good_limit} ms)`, q.good_v !== 'fail', q);
check(`as found: the injected regression fails the calibrated limit (${Math.round(q.slow)} ms > ${q.slow_limit} ms)`, q.slow_v !== 'pass', q);

// ── the host loaded on purpose: CPU burners in this container ──
if (!NO_LOAD) {
  const n = 2 * cpus().length;
  let burners: ChildProcess[] = [];
  const stop = () => { for (const b of burners) b.kill('SIGKILL'); burners = []; };
  process.on('exit', stop);
  // the burners started, each once it runs (it says so: an event, not a fixed wait)
  const start = () => Promise.all(Array.from({ length: n }, () => new Promise<void>((res) => {
    const b = spawn(process.execPath, ['-e', 'process.stdout.write("go\\n"); let x = 0; for (;;) x = (x * 31 + 7) | 0;'], { stdio: ['ignore', 'pipe', 'ignore'] });
    burners.push(b);
    b.stdout!.once('data', () => res());
  })));
  try {
    // interleaved, three pairs (as found, then burning), so that a change in the other load on the host during the
    // test does not decide it: the median of the burning measurements against the median of the others
    const sat = loadavg()[0];
    const as: number[] = [], burnt: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (i) as.push((await calibrate(page, { maxAgeMs: 0 })).raw); else as.push(quiet.raw);
      await start();
      burnt.push((await calibrate(page, { maxAgeMs: 0 })).raw);
      if (i < 2) stop();
    }
    const rise = median(burnt) / median(as);
    // a host already saturated (the 1-min load at the cores or more before the burners) has no idle core left for
    // them to take: the rise cannot show there, and is reported, not judged
    if (sat >= cpus().length && rise <= 1.05) console.log(`     not judged: the host was already saturated (1-min load ${sat.toFixed(1)} on ${cpus().length} cores) — raw factors as found ${as.map((x) => x.toFixed(2)).join(' ')}, burning ${burnt.map((x) => x.toFixed(2)).join(' ')}`);
    else check(`${n} CPU burners in the container: the factor rises (raw, median of 3: ${median(as).toFixed(2)} → ${median(burnt).toFixed(2)}, ×${rise.toFixed(2)})`, rise > 1.05, { as, burnt, load: sat });
    const l = await round('loaded');                            // the burners still running
    check(`loaded: the good press passes its calibrated limit (${Math.round(l.good)} ms ≤ ${l.good_limit} ms)${l.good > PRESS_MS ? `; the unscaled ${PRESS_MS} ms would have failed it` : ''}`, l.good_v !== 'fail', l);
    check(`loaded: the injected regression is still caught (${Math.round(l.slow)} ms against ${l.slow_limit} ms: ${l.slow_v}; never a pass)`, l.slow_v !== 'pass', l);
  } finally { stop(); }
}

check('no page errors', errors.length === 0, errors.slice(0, 3));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
