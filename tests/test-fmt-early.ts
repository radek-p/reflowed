// The open does not wait for the engine. A document whose blocks are
// all in the seed cache must be shown whether or not the engine's files (the format, the wasm, the TeX files) have
// arrived: the test holds them back (page.route, HOLD_MS) and times how long until every block of the document is
// shown, against an open where nothing is held back, in Chromium and WebKit. Also: the engine's downloads start before
// the UI is drawn (request start times against the app's bootShown), and the dev server's format is sent compressed
// and cacheable.
// Waits on conditions (every block shown, editorAPI.whenIdle()), never on times; the held-back files are a network delay.
//
//   node tests/test-fmt-early.ts http://localhost:8150/                 the seeded dev server (--seed-cache): the format held
//   node tests/test-fmt-early.ts --release dist/reflowtex-editor [--port <n>]
//                                                                         the multi-file release on a plain static server here:
//                                                                         the format pack held, then the format and wasm packs
//                                                                         (the engine's own: init's TeX files pack makes the fonts
//                                                                         of cached results, so it is not held), then the app's
//                                                                         module held (a slow line): the engine's files asked for meanwhile
//   --measure: print the times only, no checks
// The document is the intro (seed intro.json, #/doc/intro): it is in every seed set (the release ships it always).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const MEASURE = argv.includes('--measure');
const RELEASE = arg('--release');
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

/** how long the held files are held back: longer than any open here takes */
const HOLD_MS = 30000;
/** (the release) the app's module held this long: the essential files on a slow line */
const SLOW_APP_MS = 5000;
const DOC = 'intro';

type Kind = 'format' | 'wasm' | 'texmf' | 'worker' | 'seedcache' | 'app';
const kindOf = (u: string): Kind | null => (/\/formats\/latex\.fmt|engine\/format-/.test(u) ? 'format' : /tectonic_wasm\.wasm|engine\/wasm-/.test(u) ? 'wasm'
  : /\/bundle\/index|engine\/texmf-/.test(u) ? 'texmf' : /editor-worker\.js|engine\/worker-/.test(u) ? 'worker' : /seed-cache|seed\/results-/.test(u) ? 'seedcache' : /\/app\/(app-[^/]+\.js|start-[^/]+\.bin)$/.test(u) ? 'app' : null);

interface Open { shownMs: number; uiMs: number | null; idleMs: number; blocks: number; states: Record<string, number>; stats: Record<string, number> | null;
  starts: Partial<Record<Kind, number>>; errors: string[] }
/** one open of the intro; `hold`: the requests (by kind) held back HOLD_MS. Times in ms from the navigation (one clock: Date.now) */
async function open(which: 'webkit' | 'chromium', url: string, hold: Kind[], holdMs = HOLD_MS): Promise<Open> {
  const browser = await pw[which].launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(300000);
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    const starts: Partial<Record<Kind, number>> = {};
    let t0 = 0;
    page.on('request', (r: { url(): string }) => { const k = kindOf(r.url()); if (k && starts[k] == null) starts[k] = Date.now() - t0; });
    // the UI on screen: the app's bootShown() (app/src/boot/load-status.ts) tells the boot handoff; the dev page has
    // none, so one is put there; the release's loader sets its own, which is wrapped
    await page.addInitScript(() => {
      const g = globalThis as any;
      g.__uiShownAt = null;
      const mine = { shown() { g.__uiShownAt ??= Date.now(); }, failed() { /* none */ } };
      let boot: any = mine;
      Object.defineProperty(g, '__rtxBoot', { configurable: true, get: () => boot, set: (b) => { boot = { shown() { mine.shown(); b.shown(); }, failed: (m: string) => b.failed(m) }; } });
    });
    if (hold.length) await page.route((u: URL) => { const k = kindOf(u.href); return !!k && hold.includes(k); }, async (route: { continue(): Promise<void> }) => {
      await new Promise((r) => setTimeout(r, holdMs));
      await route.continue().catch(() => { /* the page went meanwhile */ });
    });
    t0 = Date.now();
    await page.goto(url);
    await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
    // every block shown: none waiting for a result, each typeset one's result mounted
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
      return { blocks: bs.length, states, stats: api.backendObject?.()?.stats?.() ?? null };
    });
    return { shownMs, uiMs: ui == null ? null : ui - t0, idleMs, ...r, starts, errors };
  } finally { await browser.close(); }
}

const line = (label: string, o: Open) => console.log(`  ${label}: every block shown ${o.shownMs} ms, UI ${o.uiMs} ms, at rest ${o.idleMs} ms; requests issued ${JSON.stringify(o.starts)}; compiled ${o.stats?.compiled}, seed hits ${o.stats?.seedHits}`);
/** the checks of one browser: the held open shows every block before the held files come, within a budget of the plain open's time */
function compare(which: string, what: string, plain: Open, held: Open, engine: Kind[] = []) {
  line(`${which} plain`, plain);
  line(`${which} ${what} held ${HOLD_MS} ms`, held);
  if (MEASURE) return;
  for (const [label, o] of [['plain', plain], ['held', held]] as const) {
    check(`${which} (${label}): the intro opens from the seed cache, nothing compiled, every block typeset`, !!o.stats && o.stats.compiled === 0 && !o.states.pending && !o.states.error && (o.states.ok ?? 0) > 20, { states: o.states, stats: o.stats });
    check(`${which} (${label}): no page errors`, o.errors.length === 0, o.errors.slice(0, 3));
  }
  // the budget does not depend on the held files: well under HOLD_MS, and near the plain open's time
  const budget = Math.min(HOLD_MS * 0.6, 2 * plain.shownMs + 4000);
  check(`${which}: with the ${what} held back, every block is shown in ${held.shownMs} ms (budget ${budget} ms; plain ${plain.shownMs} ms)`, held.shownMs <= budget, { held: held.shownMs, plain: plain.shownMs });
  // the engine's downloads are asked for before the UI is drawn, not after it (plain open: nothing held)
  if (!engine.length) return;
  const late = engine.filter((k) => plain.starts[k] == null || plain.uiMs == null || plain.starts[k]! > plain.uiMs);
  check(`${which}: the engine's files (${engine.join(', ')}) are requested before the UI is drawn (UI at ${plain.uiMs} ms)`, late.length === 0, { starts: plain.starts, ui: plain.uiMs, late });
}

if (!RELEASE) {
  // ── the dev server ──
  const BASE = (argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:8150/').replace(/\/?$/, '');
  const url = `${BASE}/?engine&store=memory#/doc/${DOC}`;
  // the format as the server sends it: compressed, cacheable (a validator), and the bytes the file has
  {
    const raw = readFileSync(join(HERE, 'engine/api/formats/latex.fmt'));
    for (const enc of ['br', 'gzip']) {
      const r = await fetch(`${BASE}/formats/latex.fmt`, { headers: { 'Accept-Encoding': enc } });
      await r.arrayBuffer();
      const ce = r.headers.get('content-encoding'), etag = r.headers.get('etag'), cc = r.headers.get('cache-control') ?? '';
      console.log(`  /formats/latex.fmt (Accept-Encoding ${enc}): ${r.status}, Content-Encoding ${ce}, ${r.headers.get('content-length')} bytes sent, ETag ${etag}, Cache-Control ${cc}`);
      if (MEASURE) continue;
      check(`the dev server's format, asked with ${enc}: compressed (Content-Encoding ${ce}, ${r.headers.get('content-length')} bytes for ${raw.length})`,
        ce === enc && Number(r.headers.get('content-length')) < raw.length / 3, { ce, length: r.headers.get('content-length') });
      check(`  …cacheable: a validator (ETag ${etag}) and no no-store (${cc})`, !!etag && !/no-store/.test(cc));
      const again = await fetch(`${BASE}/formats/latex.fmt`, { headers: { 'Accept-Encoding': enc, 'If-None-Match': etag ?? '' } });
      await again.arrayBuffer();
      check(`  …revalidated: the same ETag again gives 304 with no body`, again.status === 304, again.status);
    }
  }
  for (const which of ['chromium', 'webkit'] as const) {
    const plain = await open(which, url, []);
    const held = await open(which, url, ['format']);
    compare(which, 'format', plain, held, ['format', 'wasm']);
  }
} else {
  // ── the multi-file release, on a plain static server (no compression, no caching headers: the worst case is the tests') ──
  const DIR = resolve(RELEASE.replace(/\.html$/, ''));
  if (!existsSync(join(DIR, 'manifest.json'))) { console.log(`${DIR}: no multi-file release there`); process.exit(1); }
  const PORT0 = Number(arg('--port') ?? 0);   // 0: a free one (a fixed default met other runs' servers)
  const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(DIR, p));
    if (!f.startsWith(DIR) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    const b = readFileSync(f);
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream', 'Content-Length': String(b.length) });
    res.end(b);
  });
  await new Promise<void>((r) => server.listen(PORT0, '127.0.0.1', () => r()));
  const PORT = (server.address() as AddressInfo).port;
  try {
    const url = `http://127.0.0.1:${PORT}/?store=memory#/doc/${DOC}`;
    for (const which of ['chromium', 'webkit'] as const) {
      const plain = await open(which, url, []);
      const fmt = await open(which, url, ['format']);
      compare(which, 'format pack', plain, fmt);
      const eng = await open(which, url, ['format', 'wasm']);
      compare(which, 'format and wasm packs', plain, eng);
      // the essential files on a slow line (the app's module held): the engine's files are asked for meanwhile, not
      // once the essential files have come (main's loader: the rest after them, ~13 s late on a phone)
      const slow = await open(which, url, ['app'], SLOW_APP_MS);
      line(`${which} app module held ${SLOW_APP_MS} ms`, slow);
      if (!MEASURE) {
        const kinds: Kind[] = ['worker', 'texmf', 'wasm', 'format', 'seedcache'];
        const late = kinds.filter((k) => slow.starts[k] == null || slow.starts[k]! >= (slow.starts.app ?? 0) + SLOW_APP_MS / 2);
        check(`${which}: with the essential files slow (the app's module held ${SLOW_APP_MS} ms), the engine's files and the seed cache are asked for meanwhile, not after them`, late.length === 0, { starts: slow.starts, late });
        check(`${which} (app module held): every block typeset, nothing compiled, no page errors`, !!slow.stats && slow.stats.compiled === 0 && !slow.states.pending && slow.errors.length === 0, { states: slow.states, errors: slow.errors.slice(0, 3) });
      }
    }
  } finally { server.close(); }
}
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
