// How many requests an open makes, as gates, in Chromium and WebKit.
//   dev      the seeded dev server: the intro opened from the seed cache fetches the embedded TeX set as one pack
//            (/bundle/pack), not file by file (/bundle/<id>/file/<name>); the pack is sent compressed and cacheable
//   release  the multi-file release on a plain static server: what the UI needs is at most RELEASE_ESSENTIAL_MAX requests
//            (the start file app/start-*.bin, gzip, unpacked by the loader: the style sheets, protobuf, the viewer, the
//            app's modules, the default documents), each sent once; no app module or lib file fetched on its own
// Every request is watched (context.on('request'), no routing: routing turns the HTTP cache off). Waits on conditions
// (every block shown, editorAPI.whenIdle()), never on times.
//
//   node tests/test-fewer-requests.ts http://localhost:8150/                        the seeded dev server (--seed-cache)
//   node tests/test-fewer-requests.ts --release dist/reflowtex-editor [--port 8051] [--latency <ms>]
//            --latency: each answer of the static server waits this long first (a phone's round trip; the gates do not
//            depend on it, the times do)
//            --tree <dir>: a TeX Live tree (build/resources/www, installed by scripts/fetch-engine.ts) served beside the release at texlive/2022/
//            (where the release looks by default); after the open, a preamble with packages the release lacks is typeset
//            and the tree's requests are counted: the package's files in one round of parallel requests (the worker's
//            prefetch, loading/http.ts), not one by one
//   --measure: print the counts and times only, no checks
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const MEASURE = argv.includes('--measure');
const RELEASE = arg('--release');
const BROWSERS = (arg('--browsers') ?? 'chromium,webkit').split(',') as ('chromium' | 'webkit')[];
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

/** the dev page's single TeX file requests (one per file) allowed in a seeded open of the intro */
const DEV_TEX_SINGLE_MAX = 5;
/** the release's requests for what the UI needs (index.html not counted) */
const RELEASE_ESSENTIAL_MAX = 3;
const DOC = 'intro';

interface Req { url: string; at: number }
interface Open { shownMs: number; uiMs: number | null; idleMs: number; reqs: Req[]; states: Record<string, number>; stats: Record<string, number> | null; errors: string[]; after?: unknown }
interface Page { evaluate<T, A>(f: (a: A) => T | Promise<T>, a: A): Promise<T> }

async function open(which: 'chromium' | 'webkit', url: string, after?: (page: Page) => Promise<unknown>): Promise<Open> {
  const browser = await pw[which].launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(300000);
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    const reqs: Req[] = [];
    let t0 = 0;
    // the worker's requests too (context-wide)
    context.on('request', (r: { url(): string }) => reqs.push({ url: r.url(), at: Date.now() - t0 }));
    await page.addInitScript(() => {
      const g = globalThis as any;
      g.__uiShownAt = null;
      const mine = { shown() { g.__uiShownAt ??= Date.now(); }, failed() { /* none */ } };
      let boot: any = mine;
      Object.defineProperty(g, '__rtxBoot', { configurable: true, get: () => boot, set: (b) => { boot = { shown() { mine.shown(); b.shown(); }, failed: (m: string) => b.failed(m) }; } });
    });
    t0 = Date.now();
    await page.goto(url);
    await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
    await page.waitForFunction(() => {
      const bs = (window as any).editorAPI.blocks() as { state?: string; mounted: boolean }[];
      return bs.length > 0 && bs.every((b) => b.state !== 'pending' && (b.state !== 'ok' || b.mounted)) && bs.some((b) => b.state === 'ok');
    }, null, { polling: 50 });
    const shownMs = Date.now() - t0;
    const ui = await page.evaluate(() => (globalThis as any).__uiShownAt as number | null);
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
    const idleMs = Date.now() - t0;
    const r = await page.evaluate(() => {
      const api = (window as any).editorAPI, bs = api.blocks();
      const states: Record<string, number> = {};
      for (const b of bs) states[b.state ?? 'none'] = (states[b.state ?? 'none'] ?? 0) + 1;
      return { states, stats: api.backendObject?.()?.stats?.() ?? null };
    });
    const more = after ? await after(page) : undefined;
    return { shownMs, uiMs: ui == null ? null : ui - t0, idleMs, reqs: [...reqs], ...r, errors, after: more };
  } finally { await browser.close(); }
}

const count = (o: Open, re: RegExp, before = Infinity) => o.reqs.filter((r) => re.test(r.url) && r.at <= before).length;
function opened(which: string, o: Open) {
  check(`${which}: the intro opens from the seed cache, nothing compiled, every block typeset`, !!o.stats && o.stats.compiled === 0 && !o.states.pending && !o.states.error && (o.states.ok ?? 0) > 20, { states: o.states, stats: o.stats });
  check(`${which}: no page errors`, o.errors.length === 0, o.errors.slice(0, 3));
}

if (!RELEASE) {
  const BASE = (argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8150/').replace(/\/?$/, '');
  const url = `${BASE}/?engine&store=memory#/doc/${DOC}`;
  const SINGLE = /\/bundle\/[^/]+\/file\//, PACK = /\/bundle\/pack(\?|$)/;
  // the pack as the server sends it: compressed, cacheable, revalidated with 304
  {
    const r = await fetch(`${BASE}/bundle/pack`, { headers: { 'Accept-Encoding': 'br' } });
    const body = new Uint8Array(await r.arrayBuffer());
    const ce = r.headers.get('content-encoding'), etag = r.headers.get('etag'), cc = r.headers.get('cache-control') ?? '';
    console.log(`  /bundle/pack: ${r.status}, Content-Encoding ${ce}, ${r.headers.get('content-length')} bytes sent, ${body.length} bytes, ETag ${etag}, Cache-Control ${cc}`);
    if (!MEASURE) {
      check('the dev server sends the TeX set as one pack, compressed (br)', r.ok && ce === 'br' && Number(r.headers.get('content-length')) < body.length / 2, { status: r.status, ce, sent: r.headers.get('content-length'), bytes: body.length });
      check('  …cacheable: a validator and no no-store', !!etag && !/no-store/.test(cc), { etag, cc });
      const again = await fetch(`${BASE}/bundle/pack`, { headers: { 'Accept-Encoding': 'br', 'If-None-Match': etag ?? '' } });
      await again.arrayBuffer();
      check('  …revalidated: the same ETag gives 304', again.status === 304, again.status);
    }
  }
  for (const which of BROWSERS) {
    const o = await open(which, url);
    const single = count(o, SINGLE), pack = count(o, PACK), all = o.reqs.length;
    console.log(`  ${which}: every block shown ${o.shownMs} ms (UI ${o.uiMs} ms), at rest ${o.idleMs} ms; ${all} requests, ${single} single TeX files, ${pack} pack; compiled ${o.stats?.compiled}, seed hits ${o.stats?.seedHits}`);
    if (single) console.log(`    single: ${o.reqs.filter((r) => SINGLE.test(r.url)).slice(0, 12).map((r) => decodeURIComponent(r.url.replace(/.*\/file\//, ''))).join(', ')}`);
    if (MEASURE) continue;
    opened(which, o);
    check(`${which}: the TeX set comes as one pack (${pack} request${pack === 1 ? '' : 's'})`, pack === 1, pack);
    check(`${which}: at most ${DEV_TEX_SINGLE_MAX} TeX files fetched one by one (${single})`, single <= DEV_TEX_SINGLE_MAX, single);
  }
} else {
  // the multi-file release on a plain static server (no compression: the precompressed start-up file must not need it)
  const DIR = resolve(RELEASE.replace(/\.html$/, ''));
  if (!existsSync(join(DIR, 'manifest.json'))) { console.log(`${DIR}: no multi-file release there`); process.exit(1); }
  const PORT = Number(arg('--port') ?? 8051);
  const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' };
  const LATENCY = Number(arg('--latency') ?? 0);
  const TREE = arg('--tree') ? resolve(arg('--tree')!) : null;
  /** the tree's requests: path, when asked, when answered (ms, this process's clock) */
  const treeLog: { path: string; start: number; end: number }[] = [];
  const server = createServer(async (req, res) => {
    const start = Date.now();
    if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const inTree = !!TREE && p.startsWith('/texlive/');
    const root = inTree ? TREE! : DIR;
    const f = normalize(join(root, p));
    if (inTree) res.on('finish', () => treeLog.push({ path: p, start, end: Date.now() }));
    if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    const b = readFileSync(f);
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream', 'Content-Length': String(b.length) });
    res.end(b);
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
  try {
    const url = `http://127.0.0.1:${PORT}/?store=memory#/doc/${DOC}`;
    const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { files: { id: string; path: string; bytes: number; group: string; type: string; parts?: unknown[] }[] };
    const essential = manifest.files.filter((f) => f.group === 'essential');
    const rest = new Set(manifest.files.filter((f) => f.group === 'rest').map((f) => f.path));
    console.log(`  manifest: ${manifest.files.length} files, ${essential.length} essential (${essential.map((f) => `${f.path} ${f.bytes} bytes${f.parts ? `, ${f.parts.length} parts` : ''}`).join('; ')})`);
    if (!MEASURE) check(`the release has at most ${RELEASE_ESSENTIAL_MAX} essential files (${essential.length})`, essential.length <= RELEASE_ESSENTIAL_MAX, essential.map((f) => f.path));
    const pathOf = (u: string) => u.startsWith('blob:') ? null : decodeURIComponent(new URL(u).pathname.slice(1));
    const PRE: [string, string, string][] = [
      ['siunitx', '\\documentclass{article}\n\\usepackage{siunitx}', 'A length of \\SI{3}{\\metre}.'],
      ['a paper-like preamble', ['\\documentclass{article}', '\\usepackage{amsmath,amssymb,amsthm}', '\\usepackage{hyperref}', '\\usepackage{cleveref}',
        '\\usepackage{fancyhdr}', '\\usepackage{ragged2e}', '\\usepackage{longtable}', '\\usepackage{euscript}', '\\usepackage{amscd}', '\\usepackage{epsfig}',
        '\\usepackage{times}', '\\usepackage{xfrac}', '\\usepackage{dcolumn}', '\\usepackage{hhline}', '\\usepackage{afterpage}'].join('\n'), 'A paragraph with $\\sfrac{1}{2}$ and $\\EuScript{E}$.'],
    ];
    const after = TREE ? async (page: Page) => {
      const runs = [];
      for (const [name, preamble, source] of PRE) {
        const t0 = Date.now();
        const r = await page.evaluate(async ({ preamble, source, name }) => {
          const be = (window as any).editorAPI.backendObject();
          const t = performance.now();
          const out = await be.compile({ preamble, keep: [], blocks: [{ id: `fr-${name}`, source }] });
          return { status: out.blocks[`fr-${name}`]?.status as string, ms: Math.round(performance.now() - t), res: await be.resources?.() ?? null };
        }, { preamble, source, name });
        runs.push({ name, ...r, t0, t1: Date.now() });
      }
      return { runs };
    } : undefined;
    for (const which of BROWSERS) {
      const o = await open(which, url, after);
      const before = o.uiMs ?? Infinity;
      const net = o.reqs.filter((r) => pathOf(r.url) != null);
      const ui = net.filter((r) => r.at <= before && !rest.has(pathOf(r.url)!) && pathOf(r.url) !== '');
      const ess = ui.filter((r) => essential.some((f) => f.path === pathOf(r.url)));
      console.log(`  ${which}: every block shown ${o.shownMs} ms (UI ${o.uiMs} ms), at rest ${o.idleMs} ms; ${net.length} requests; before the UI ${ui.length} not of the rest: ${ui.map((r) => pathOf(r.url)).join(', ')}; compiled ${o.stats?.compiled}`);
      if (MEASURE) continue;
      opened(which, o);
      check(`${which}: what the UI needs came in ${ess.length} requests (at most ${RELEASE_ESSENTIAL_MAX}), each essential file once`, ess.length <= RELEASE_ESSENTIAL_MAX && ess.length === essential.length, ess.map((r) => pathOf(r.url)));
      if (TREE) {
        const t = o.after as { runs: { name: string; status: string; ms: number; t0: number; t1: number; res: { stats?: Record<string, number> } | null }[] };
        for (const run of t.runs) {
          const log = treeLog.filter((r) => r.start >= run.t0 && r.start <= run.t1 && !/ls-R$/.test(r.path));
          // waves: a request asked for after every earlier one was answered starts a new one (sequential requests: one each)
          let waves = 0, lastEnd = -Infinity;
          for (const r of [...log].sort((a, b) => a.start - b.start)) { if (r.start >= lastEnd) waves++; lastEnd = Math.max(lastEnd, r.end); }
          console.log(`    ${which} tree, ${run.name}: ${run.status} in ${run.ms} ms; ${log.length} files from the tree in ${waves} wave${waves === 1 ? '' : 's'}; worker: ${JSON.stringify(run.res?.stats ?? null)}`);
          if (argv.includes('--waves')) { let w = 0, e = -Infinity; for (const r of [...log].sort((a, b) => a.start - b.start)) { if (r.start >= e) { w++; process.stdout.write(`\n      wave ${w}:`); } e = Math.max(e, r.end); process.stdout.write(` ${r.path.replace(/.*texmf-dist\//, '')}`); } console.log(); }
          if (MEASURE) continue;
          check(`${which}: ${run.name} typesets with the tree beside the release`, run.status === 'ok', run);
          if (run.name === 'siunitx') check(`${which}: siunitx's files come in a few rounds of parallel requests (${waves} waves for ${log.length} files; one by one would be ${log.length})`, log.length >= 3 && waves <= 4 && waves < log.length / 2, { waves, files: log.map((r) => r.path.replace(/.*\//, '')) });
        }
      }
      const loose = net.filter((r) => /^(lib\/.*\.(js|css)|app\/(app|chunk|companion|seeds|model)-.*\.js)$/.test(pathOf(r.url)!));
      check(`${which}: no app module or lib file fetched on its own (they are in the start file)`, loose.length === 0, loose.map((r) => pathOf(r.url)));
    }
  } finally { server.close(); }
}
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
