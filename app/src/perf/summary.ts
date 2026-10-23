// one line per run from test-results/w11/*/results.json
//   node web/src/perf/summary.ts [dir…]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../test-results/w11');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(ROOT);
for (const d of dirs) {
  const f = join(ROOT, d, 'results.json');
  if (!existsSync(f)) continue;
  const { report: r, results } = JSON.parse(readFileSync(f, 'utf8'));
  const l = (x: any) => `${x.p50}/${x.p95}/${x.max}`;
  console.log(`${d.padEnd(18)} open ${l(r.latency.open)}  caret-click ${l(r.latency.caretClick)}  key ${l(r.latency.caretKey)}  preview ${r.livePreview ? l(r.livePreview) : "-"}  longtasks n=${r.longtasks.n} max=${r.longtasks.max} total=${r.longtasks.totalMs}  gaps>50 n=${r.frameGaps.n} max=${r.frameGaps.max}  typeset ${(r.typesetMs / 1000).toFixed(1)} s  ${results.filter((x: any) => !x.ok).length ? 'FAILS' : 'ok'}`);
}
