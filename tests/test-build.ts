// The built single file (dist/reflowtex-editor.html), from file:// with the
// browser offline and every request other than file:, blob: and data: aborted.
//
//   node tests/test-build.ts [--chromium] [--firefox] [--webkit] [--quick] [--file page.html]
//   (no browser named: Chromium in full, Firefox and WebKit as a smoke test;
//    --quick: only the paper-free checks, no document opened)
//
// Checks: the file's size and parts (dist/reflowtex-editor.json); no retired
// sample in it; both seed documents are in the store after the first open and
// each opens with 0 compiles (the prebuilt seed cache), every block mounted
// and none with an error; \leqslant draws a real msam glyph; a missing package
// is named in the error; no request leaves the page; no page errors.
// Results: test-results/build/results.json.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'build');
mkdirSync(OUT, { recursive: true });
const pw = createRequire(join(HERE, 'engine/package.json'))('playwright');
const argv = new Set(process.argv.slice(2));
const named = (['chromium', 'firefox', 'webkit'] as const).filter((b) => argv.has(`--${b}`));
const browsers = named.length ? named : (['chromium', 'firefox', 'webkit'] as const);
// --file <page.html>: another build (a release, a candidate); its .json next to it
const fileArg = process.argv.indexOf('--file');
const FILE = fileArg > 0 ? process.argv[fileArg + 1] : join(HERE, 'dist/reflowtex-editor.html');
const stats = JSON.parse(readFileSync(FILE.replace(/\.html$/, '.json'), 'utf8'));
const results: Record<string, any> = { date: new Date().toISOString(), stats };
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

// ── the file itself ──────────────────────────────────────────────────────────
const html = readFileSync(FILE, 'utf8');
const size = statSync(FILE).size;
console.log(`${FILE}: ${mb(size)}; pack ${mb(stats.packGzBytes * 4 / 3)} (base64 of ${mb(stats.packGzBytes)} gz: format ${mb(stats.formatBytes)}, wasm ${mb(stats.wasmBytes)}, `
  + `${stats.texFiles} TeX files ${mb(stats.texBytes)}), seed docs ${mb(stats.seedDocBytes)}, seed cache ${mb(stats.seedCacheGzBytes * 4 / 3)}, `
  + `worker ${mb(stats.workerBytes)}, app ${mb(stats.appBytes)}, viewer ${mb(stats.viewerBytes)}`);
check(`size within the 35 MB budget (${mb(size)})`, size <= 35 * 1048576);
check('no retired sample in the file', !/Lovelace|Flips and [Dd]eletions/.test(html));
const seedNames = Object.keys(stats.seedDocs ?? {});
check(`the default documents inline (${seedNames.join(', ')}; build.ts --seeds= picks them)`, seedNames.includes('intro.json'));
const cacheOk = stats.seedCacheGzBytes > 0;
check(`seed cache packed for this engine build (${stats.engineBuild}): ${stats.seedCache}`, cacheOk);
const seeds = seedNames.map((n) => ({ name: n, id: JSON.parse(readFileSync(join(HERE, 'build/seed', n), 'utf8')).id as string }));
if (existsSync(join(HERE, 'engine/build/seed-cache.json.gz'))) {
  const c = JSON.parse(gunzipSync(readFileSync(join(HERE, 'engine/build/seed-cache.json.gz'))).toString('utf8'));
  results.seedCache = { build: c.build, docs: c.docs, results: Object.keys(c.results ?? {}).length, fonts: Object.keys(c.fonts?.files ?? {}).length };
}

// ── in a browser ─────────────────────────────────────────────────────────────
async function inBrowser(kind: 'chromium' | 'firefox' | 'webkit', full: boolean) {
  console.log(`── ${kind}${full ? '' : ' (smoke)'}: file://, offline`);
  const r: Record<string, any> = {};
  const browser = await pw[kind].launch();
  // WebKit (Playwright 1.58) cannot open file:// in an offline context: there the route below is what keeps it offline
  const ctx = await browser.newContext({ offline: kind !== 'webkit', viewport: { width: 1200, height: 900 } });
  const leaked: string[] = [];
  await ctx.route('**/*', (q: any) => { const u = q.request().url(); if (/^(file|blob|data):/.test(u)) return q.continue(); leaked.push(u); return q.abort(); });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('crash', () => errors.push('the page crashed'));
  page.on('framenavigated', (f: any) => { if (f === page.mainFrame()) console.log('  (navigated: ' + f.url().slice(0, 80) + ')'); });
  const t0 = Date.now();
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => (window as any).editorAPI, null, { timeout: 180000 });
  r.readyMs = Date.now() - t0;
  const title = await page.title();
  check(`${kind}: the page has a title (${title})`, /ReflowEd/.test(title) && !title.includes('$'), title);
  const listed = await page.evaluate(async () => (await (window as any).editorAPI.store().listDocs()).map((d: any) => ({ id: d.id, title: d.title, tags: d.tags ?? d.meta?.tags ?? [] })));
  r.docs = listed;
  check(`${kind}: ready in ${r.readyMs} ms; the store has every default document (${listed.length} docs)`, seeds.every((s) => listed.some((d: any) => d.id === s.id)), JSON.stringify(listed));
  if (argv.has('--quick')) { await browser.close(); return r; }
  for (const s of seeds) {
    const o = await page.evaluate(async (id: string) => {
      const api = (window as any).editorAPI;
      const bes = (globalThis as any).__rtxEditor?.backends ?? [];
      const before = bes.map((b: any) => b.stats().compiled);
      const t = performance.now();
      await api.open(id);
      await api.whenIdle();
      const ms = performance.now() - t;
      const blocks = api.blocks();
      const missing = blocks.flatMap((b: any) => (b.errors ?? []).map((e: any) => e.message)).filter((m: string) => /not found|missing|File `/i.test(m));
      return { ms: Math.round(ms), backend: api.backend(), n: blocks.length,
        states: blocks.reduce((m: any, b: any) => ({ ...m, [b.state]: (m[b.state] ?? 0) + 1 }), {}),
        mounted: blocks.filter((b: any) => b.mounted).length, markers: blocks.filter((b: any) => b.state === 'marker' || b.state === 'container').length,
        errors: blocks.filter((b: any) => b.errors?.length).map((b: any) => `${b.id}: ${b.errors[0]?.message}`).slice(0, 6), missing,
        compiled: bes.map((b: any, i: number) => b.stats().compiled - before[i]).reduce((a: number, b: number) => a + b, 0),
        stats: bes.map((b: any) => b.stats()),
        // the viewer's "Some fonts could not be downloaded … stand-in font" notice
        fontWarning: [...document.querySelectorAll('div, p')].map((e) => e.textContent ?? '').find((t) => /could not be downloaded/.test(t) && t.length < 600) ?? null };
    }, s.id);
    r[s.name] = o;
    console.log(`  ${s.name}: open → idle ${o.ms} ms; ${JSON.stringify(o.states)}; compiled ${o.compiled}; ${JSON.stringify(o.stats)}`);
    await page.screenshot({ path: join(OUT, `${kind}-${s.name.replace('.json', '')}.png`) });
    check(`${kind}: ${s.name} — every block that typesets is mounted (${o.mounted}/${o.n - o.markers}; markers and containers are not)`, o.n > 20 && o.mounted === o.n - o.markers, JSON.stringify(o.states));
    check(`${kind}: ${s.name} — no block error`, o.errors.length === 0, o.errors.join(' | '));
    check(`${kind}: ${s.name} — no missing-file error`, o.missing.length === 0, o.missing.join(' | '));
    if (cacheOk) check(`${kind}: ${s.name} — opens with 0 compiles`, o.compiled === 0, JSON.stringify(o.stats));
    check(`${kind}: ${s.name} — every font loads (no stand-in font notice)`, !o.fontWarning, o.fontWarning ?? '');
  }
  // (\\leqslant, fonts per family and the live edit: scripts/build.ts's acceptance step, Chromium, blocking)
  if (full) {
    // a package the file does not carry: the error names it
    const miss = await page.evaluate(async () => {
      const be = (globalThis as any).__rtxEditor?.backends?.[0];
      const pre = await be.setPreamble('\\documentclass{article}\n\\usepackage{tikz-feynman}');
      return pre.errors.map((e: any) => e.message);
    });
    r.missingPackage = miss;
    check('a missing package is named in the error (tikz-feynman)', miss.some((m: string) => /tikz-feynman/.test(m)), JSON.stringify(miss));
  }
  check(`${kind}: no request left the page`, leaked.length === 0, leaked.slice(0, 3).join(' '));
  check(`${kind}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  r.errors = errors;
  await browser.close();
  return r;
}
for (const b of browsers) {
  try { results[b] = await inBrowser(b, b === 'chromium' || named.length > 0); }
  catch (e) { check(`${b}: ran`, false, (e as Error).message.split('\n')[0]); }
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
