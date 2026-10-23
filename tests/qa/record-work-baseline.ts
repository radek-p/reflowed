// Records the quiet-machine baseline of the timing checks' reference workload (tests/qa/lib/work.ts):
// the median CPU time of the reference in a Chromium page, over --rounds rounds of REPS runs (each round a fresh page),
// the container the timing suites run in, and commit the file:
//
//   node tests/qa/record-work-baseline.ts [http://localhost:<port>/] [--rounds 7] [--dry]
//
// With a dev app's URL the reference runs in the app's page (the long test document open), as in the suites; else in an empty
// page (the workload is in a contained shadow root, so the page matters little). --dry prints and writes nothing. It
// refuses to write when the 1-min load passed a quarter of the cores before or after any round; --force writes anyway,
// taking the quietest round's median (not the median of the rounds), marked "provisional" in the file.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureReference, median, BASELINE_FILE, REPS, readBaseline, type Baseline } from './lib/work.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const URL0 = argv[0] && !argv[0].startsWith('--') ? argv[0].replace(/\/?$/, '/') : null;
const ROUNDS = argv.includes('--rounds') ? Number(argv[argv.indexOf('--rounds') + 1]) : 7;
const DRY = argv.includes('--dry'), FORCE = argv.includes('--force');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');

const cores = cpus().length, QUIET = cores * 0.25;          // quiet: the 1-min load at most a quarter of the cores, before every round and after
const loads = [loadavg()[0]];
const browser = await chromium.launch();
const rounds: number[][] = [];
for (let r = 0; r < ROUNDS; r++) {
  if (r) loads.push(loadavg()[0]);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (URL0) {
    await page.goto(`${URL0}?engine&store=memory&seed=long#/doc/long`);
    await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && (window as any).editorAPI.route?.().name === 'doc', null, { timeout: 600000 });
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
  } else await page.setContent('<!doctype html><title>reference</title><body></body>');
  const runs = await measureReference(page);
  rounds.push(runs);
  console.log(`round ${r + 1}: ${runs.map((x) => x.toFixed(1)).join(' ')} ms (median ${median(runs).toFixed(1)})`);
  await page.close();
}
loads.push(loadavg()[0]);
const load = Math.max(...loads);
const meds = rounds.map(median);
const all = rounds.flat();
const b: Baseline = {
  // quiet: the median of the rounds' medians; on a loaded host (--force) the quietest round is the better estimate
  cpuMs: Math.round((load > QUIET ? Math.min(...meds) : median(meds)) * 100) / 100,
  recorded: new Date().toISOString().slice(0, 16).replace('T', ' '),
  reps: REPS,
  spread: [Math.round(Math.min(...meds) * 100) / 100, Math.round(Math.max(...meds) * 100) / 100],
  host: `${cpus()[0]?.model ?? '?'} ×${cores}, 1-min load at most ${load.toFixed(1)} (${loads.map((l) => l.toFixed(1)).join(' ')})`,
  chromium: browser.version(),
  how: `node tests/qa/record-work-baseline.ts${URL0 ? ' <dev app>' : ''} --rounds ${ROUNDS}: ${load > QUIET ? 'the lowest' : 'the median'} of ${ROUNDS} rounds' medians (${all.length} runs)`,
  ...(load > QUIET ? { provisional: `recorded with --force on a loaded host (1-min load up to ${load.toFixed(1)} on ${cores} cores): the quietest round, likely still above the quiet time (the limits a little loose); record it again on a quiet machine` } : {}),
};
await browser.close();
const old = readBaseline();
console.log(`baseline ${b.cpuMs} ms (rounds' medians ${b.spread.join('–')})${old ? `; was ${old.cpuMs} ms (${old.recorded})` : ''}`);
if (DRY) console.log('(--dry: not written)');
else if (load > QUIET && !FORCE) { console.log(`NOT WRITTEN: the 1-min load reached ${load.toFixed(1)} (> ${QUIET} on ${cores} cores: not a quiet machine; a baseline from a loaded host makes the limits too loose). Rerun when the host is quiet, or --force`); process.exitCode = 1; }
else { writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2) + '\n'); console.log(`written: ${BASELINE_FILE}`); }
