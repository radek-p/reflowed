// The multi-file release (scripts/lib/multifile.ts) served as the release server would: static files in a subdirectory
// (/~user/reflowEd/, the TeX tree beside it at texlive/2022/), by a static host that sends no type for .wasm and
// none for .bin, nothing but defaults (no Cache-Control) (tests/qa/lib/static-server.ts, in this process), and on the
// first server gzip on everything (chunked: no Content-Length) with the engine's files slowed to 3 MB/s and the app's
// to 1 MB/s, as a real line would be; the second server plain (Content-Length, no gzip). All on 127.0.0.1.
//
//   node tests/test-multifile.ts [--dir dist/reflowtex-editor] [--file dist/reflowtex-editor.html] [--browsers chromium,firefox,webkit] [--port <n>]
//   (--file X.html: the multi-file release beside it, X/; neither there: a quick build, scripts/build.ts --no-seed-cache)
//
// Per browser, on the gzip server:
//   1. it boots: the overlay's percentage goes 0 → 100 and never back, the overlay goes once the UI is drawn, and the
//      files still loading then are shown in the left column's status line (0 → 100, never back), which then goes
//   2. a new document typesets (the engine from the packs, its wasm compiled from bytes); a package the release does
//      not carry typesets from the tree beside it; a baked release opens the intro with nothing compiled, its pictures drawn
//   3. About lists the licences (their files come after the UI)
//   4. every request stays in the release's directory (the tree included), every file's body is sent once, the
//      engine's files came with no Content-Length; no page errors
// Add to Home Screen: app.webmanifest beside index.html, linked from it, valid, every URL in it relative
// (start_url and scope the release's directory), its icons there; per browser, from the subdirectory: the link's
// manifest and every icon load, start_url and scope resolve to the release's directory.
// And: the release's own files name no absolute URL; Chromium on the plain server boots and typesets; Chromium reloads
// with no file sent again (each is named by its content: any cached copy is good).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { harness, EDITOR } from './qa/lib/harness.ts';
import type { Manifest } from '../loading/manifest.ts';
import { introCheck, introProblems } from './qa/lib/intro-check.ts';
import { staticServer, type StaticServer } from './qa/lib/static-server.ts';

const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const t = harness('multifile');
// the two servers' ports: free ones (port 0), or --port and the next one; fixed defaults met other runs' servers
const PORT = Number(arg('--port') ?? 0), PLAIN = PORT ? PORT + 1 : 0;
const BROWSERS = (arg('--browsers') ?? 'chromium,firefox,webkit').split(',').filter(Boolean) as ('chromium' | 'firefox' | 'webkit')[];
let DIR = resolve(arg('--dir') ?? (arg('--file') ?? join(EDITOR, 'dist/reflowtex-editor.html')).replace(/\.html$/, ''));
if (!existsSync(join(DIR, 'index.html'))) {
  console.log(`${DIR}: no multi-file release there; a quick build (scripts/build.ts --no-seed-cache)`);
  execFileSync(process.execPath, [join(EDITOR, 'scripts/build.ts'), '--no-seed-cache', '--public-any'], { stdio: 'inherit', env: process.env });
  DIR = join(EDITOR, 'dist/reflowtex-editor-unbaked');
}
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Manifest;
const baked = manifest.files.some((f) => f.type === 'seedcache');
const TREE = join(EDITOR, 'build/resources/www/texlive');
const haveTree = existsSync(join(TREE, '2022/texmf-dist/ls-R'));
const BASE = '/~user/reflowEd/';

// ── the release's files: relative URLs only ──
{
  const html = readFileSync(join(DIR, 'index.html'), 'utf8');
  const abs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']?((?:\/|[a-z]+:)[^"' >]*)/gi)].map((m) => m[1]).filter((u) => !/^(data|blob):/.test(u));
  t.check('index.html names no absolute URL (src, href)', abs.length === 0, abs);
  const bad = manifest.files.filter((f) => /^\/|^[a-z]+:|\.\./i.test(f.path) || !existsSync(join(DIR, f.path)) || statSync(join(DIR, f.path)).size !== f.bytes);
  t.check(`the manifest: ${manifest.files.length} files, relative paths, each there with the size it says`, bad.length === 0, bad);
  const css = manifest.files.filter((f) => f.type === 'css').flatMap((f) => [...readFileSync(join(DIR, f.path), 'utf8').matchAll(/url\(\s*["']?((?:\/|https?:)[^)"']*)/g)].map((m) => `${f.path}: ${m[1]}`));
  t.check('the style sheets load nothing by an absolute URL', css.length === 0, css);
  const index = statSync(join(DIR, 'index.html')).size;
  t.check(`index.html is small (${(index / 1024).toFixed(0)} KB: the loader, the manifest, the schema)`, index < 200 * 1024, index);
  // Add to Home Screen: the web app manifest, linked, relative, its icons there
  const wm = (() => { try { return JSON.parse(readFileSync(join(DIR, 'app.webmanifest'), 'utf8')); } catch { return null; } })();
  const urls = wm ? [wm.start_url, wm.scope, wm.id, ...(wm.icons ?? []).map((i: any) => i.src)] : [];
  t.check('app.webmanifest: linked from index.html, name ReflowEd, display standalone, colours', !!wm && /<link rel="?manifest"? href="?app\.webmanifest"?>/.test(html)
    && wm.name === 'ReflowEd' && !!wm.short_name && wm.display === 'standalone' && /^#[0-9a-f]{6}$/i.test(wm.theme_color ?? '') && /^#[0-9a-f]{6}$/i.test(wm.background_color ?? ''), wm);
  t.check('app.webmanifest: every URL relative (start_url and scope "./"), its icons there (192, 512, a maskable 512)', !!wm && wm.start_url === './' && wm.scope === './'
    && urls.every((u: string) => !/^\/|^[a-z]+:|\.\./i.test(u)) && wm.icons.every((i: any) => existsSync(join(DIR, i.src)))
    && ['192x192 any', '512x512 any', '512x512 maskable'].every((k) => wm.icons.some((i: any) => `${i.sizes} ${i.purpose}` === k)), urls);
  // (or is in a folder named by its content: the public inspector's, whose files load each other by their own names)
  const hashed = manifest.files.filter((f) => !/-[0-9a-f]{8,}\.[a-z]+$|-[A-Z0-9]{8}\.js$|^[a-z]+-[0-9a-f]{8,}\//.test(f.path));
  t.check('every file but index.html is named by its content (or is in a folder named so)', hashed.length === 0, hashed.map((f) => f.path));
}

// ── the site and the two servers ──
const WWW = join(t.out, 'www');
rmSync(WWW, { recursive: true, force: true });
const SITE = join(WWW, BASE);
mkdirSync(SITE, { recursive: true });
for (const e of readdirSync(DIR)) symlinkSync(join(DIR, e), join(SITE, e));
if (haveTree) symlinkSync(TREE, join(SITE, 'texlive'));
// no type for wasm or .bin: the release must not depend on MIME types
const AWKWARD = { root: WWW, types: { '.wasm': null, '.bin': null } };
const MB = 1 << 20;
const slowed = (p: string) => (p.startsWith(`${BASE}engine/`) ? 3 * MB : p.startsWith(`${BASE}app/`) || p.startsWith(`${BASE}seed/`) ? MB : 0);
const GZIP = await staticServer({ ...AWKWARD, port: PORT, gzip: true, rate: slowed });
const PLAIN_SERVER = await staticServer({ ...AWKWARD, port: PLAIN });

// what the page shows of its loading, recorded from the DOM as it changes (no timers)
const RECORD = `(() => {
  const r = window.__rec = { overlay: [], status: [], tex: [], failures: [], bootGone: false, statusAtHandoff: null, statusInLine: false, statusGone: false };
  const note = (el) => {
    const w = el.dataset.loadWhere;
    if (w === 'overlay') r.overlay.push(Number(el.dataset.loadPercent));
    if (w !== 'status') return;
    r.statusInLine = r.statusInLine || !!el.closest('.wb-side-status');
    if (el.dataset.loadKind === 'release' && el.dataset.loadPercent != null && !el.hasAttribute('data-failed')) r.status.push(Number(el.dataset.loadPercent));
    if (el.dataset.loadKind === 'tex' && el.dataset.loadFiles) for (const n of el.dataset.loadFiles.split(' ')) if (!r.tex.includes(n)) r.tex.push(n);
    if (el.dataset.loadFailures) r.failures.push({ names: el.dataset.loadFailures, title: el.title });
  };
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches('[data-load-where]')) note(n); for (const e of n.querySelectorAll('[data-load-where]')) note(e); };
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes') { note(m.target); continue; }
      for (const n of m.addedNodes) scan(n);
      for (const n of m.removedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.id === 'boot') { r.bootGone = true; r.statusAtHandoff = !!document.querySelector('[data-load-where="status"]'); }
        if (n.matches('[data-load-where="status"]') || n.querySelector('[data-load-where="status"]')) r.statusGone = true;
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-load-percent', 'data-load-files', 'data-load-failures', 'data-load-kind'] });
})();`;
const rising = (a: number[]) => a.every((v, i) => i === 0 || v >= a[i - 1]);

const pw = createRequire(join(EDITOR, 'app/package.json'))('playwright');
const PRE = '\\documentclass{article}\n\\usepackage{fancyhdr}\n\\pagestyle{fancy}';

async function run(b: 'chromium' | 'firefox' | 'webkit', server: StaticServer, full: boolean, failing = false) {
  const label = `${b}${server === PLAIN_SERVER ? ' (plain server)' : ''}`;
  const origin = server.origin;
  const ctx = await pw[b].launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-mf-')), { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(RECORD);
  // (failing) a TeX tree set in the settings that is not there: its failure is the status line's too
  if (failing) await ctx.addInitScript(`try { localStorage.setItem('rtx-editor.advanced', '1'); localStorage.setItem('rtx-editor.resource-server', '${origin}${BASE}nothere/'); } catch {}`);
  // requests watched, not routed: routing turns Playwright's HTTP cache off (and nothing here can reach another host)
  const outside: string[] = [];
  ctx.on('request', (r: any) => { const u = r.url(); if (!/^(blob|data):/.test(u) && !u.startsWith(`${origin}${BASE}`)) outside.push(u); });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${label} console.${m.type()}] ${m.text().slice(0, 300)}`); });
  const step = (s: string) => console.log(`  … ${label}: ${s}`);
  const n0 = server.log.length;
  await page.goto(`${origin}${BASE}#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name);
  step('the app is up');
  // the overlay gone, and the status line's part gone once everything is in
  await page.waitForFunction(() => (window as any).__rec.bootGone && !(window as any).__rtxFiles.busy());
  await page.waitForFunction(() => !(window as any).__rec.statusAtHandoff || (window as any).__rec.statusGone);
  const rec = await page.evaluate(() => (window as any).__rec);
  t.check(`${label}: the overlay goes 0 → 100 % and never back (${rec.overlay.length} steps)`, rec.overlay[0] === 0 && rec.overlay.at(-1) === 100 && rising(rec.overlay) && rec.overlay.length >= (full ? 3 : 2), rec.overlay);
  t.check(`${label}: the overlay is gone once the UI is drawn`, rec.bootGone && !(await page.evaluate(() => !!document.getElementById('boot'))));
  if (full) t.check(`${label}: what still loads then moves to the status line (left column), 0 → 100 % never back, then goes`,
    rec.statusAtHandoff === true && rec.statusInLine && rec.status.length >= 2 && rising(rec.status) && rec.status.at(-1) === 100 && rec.statusGone, rec);

  // 2. typesetting
  step('loaded; a new document');
  const id = await t.newDoc(page, { title: 'Multi-file', preamble: '\\documentclass{article}', blocks: [{ source: 'Hello multi-file world, $x^2+1$.', kind: 'paragraph' }] });
  const st = await page.evaluate(() => (window as any).editorAPI.blocks().map((x: any) => ({ state: x.state, errors: x.errors?.length ?? 0, mounted: x.mounted })));
  const glyphs = await page.evaluate(() => [...document.querySelectorAll('.latex-block svg tspan, .latex-block svg text')].map((e) => e.textContent).join(''));
  t.check(`${label}: a new document typesets (the engine from the packs)`, !!id && st.length === 1 && st[0].state === 'ok' && st[0].errors === 0 && /Hello/.test(glyphs), { st, glyphs: glyphs.slice(0, 80) });
  if (haveTree && full) {
    const r = await page.evaluate(async (p: string) => {
      const be = (window as any).editorAPI.backendObject();
      const x = await be.compile({ preamble: p, keep: [], blocks: [{ id: 'fh', source: 'A header from fancyhdr.' }] });
      return { status: x.blocks.fh.status, problems: [...(x.preamble?.errors ?? []), ...x.blocks.fh.errors].map((e: any) => e.message) };
    }, PRE);
    t.check(`${label}: a package the release does not carry typesets from the tree beside it`, r.status === 'ok', r);
    await page.waitForFunction(() => !document.querySelector('[data-load-where="status"]'));
    const rec2 = await page.evaluate(() => ({ tex: (window as any).__rec.tex, store: (window as any).__rtxFiles.files().filter((f: any) => f.tree === 'tex').map((f: any) => `${f.name}:${f.state}`) }));
    t.check(`${label}: the TeX files fetched after boot showed in the status line (one loading status), then it went`, rec2.tex.includes('fancyhdr.sty') && rec2.store.includes('fancyhdr.sty:done') && rec2.store.includes('ls-R:done'), rec2);
  }
  if (failing) {
    await page.evaluate(async (p: string) => (window as any).editorAPI.backendObject().compile({ preamble: p, keep: [], blocks: [{ id: 'nf', source: 'No tree.' }] }), PRE);
    await page.waitForFunction(() => (window as any).__rec.failures.length > 0);
    const fl = await page.evaluate(() => (window as any).__rec.failures);
    t.check(`${label}: a TeX tree that cannot be reached shows in the status line as a failure, with the reason`, fl.some((x: any) => /ls-R/.test(x.names) && /HTTP 404/.test(x.title)), fl);
  }
  if (baked && full) {
    const r = await page.evaluate(async () => {
      const api = (window as any).editorAPI;
      const bes = (globalThis as any).__rtxEditor.backends;
      const before = bes.map((x: any) => x.stats().compiled);
      location.hash = '#/doc/intro';
      await new Promise<void>((res) => { const k = () => (api.route().name === 'doc' && api.currentDoc()?.title ? res() : requestAnimationFrame(k)); k(); });
      await api.whenIdle();
      const bs = api.blocks();
      return { n: bs.length, errors: bs.filter((x: any) => x.errors?.length).length, compiled: bes.map((x: any, i: number) => x.stats().compiled - before[i]).reduce((a: number, c: number) => a + c, 0) };
    });
    t.check(`${label}: the intro opens with nothing compiled (the seed cache came after the UI)`, r.n > 10 && r.errors === 0 && r.compiled === 0, r);
    const ir = await introCheck(page), ip = introProblems(ir);
    t.check(`${label}: the intro's pictures are drawn from their bytes, no block error`, !ip.length, ip.length ? ip : ir.pictures.length);
  }

  // 3. About
  step('typeset');
  if (full) {
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home');
    await page.evaluate(() => (document.querySelector('[data-about]') as HTMLElement | null)?.click());
    await page.waitForFunction(() => document.querySelectorAll('#rtx-about [data-list="npm"] li').length > 0 && document.querySelectorAll('#rtx-about [data-list="tex"] li').length > 0);
    t.check(`${label}: About lists the licences`, true);
    await page.evaluate(() => (document.getElementById('rtx-about') as HTMLDialogElement | null)?.close());
  }

  // 4. requests
  const reqs = server.log.slice(n0);
  const strays = reqs.filter((x) => !x.path.startsWith(BASE));
  t.check(`${label}: every request stayed in the release's directory and the tree beside it (${reqs.length} requests)`, strays.length === 0 && outside.length === 0, { strays, outside });
  const sent = new Map<string, number>();
  for (const x of reqs) if (x.status === 200 && x.bytes > 0) sent.set(x.path, (sent.get(x.path) ?? 0) + 1);
  const twice = [...sent].filter(([, k]) => k > 1);
  t.check(`${label}: every file's body was sent once (${reqs.filter((x) => x.status === 304).length} answered 304)`, twice.length === 0, twice);
  const missing = reqs.filter((x) => x.status >= 400 && !x.path.includes('/texlive/') && !x.path.includes('/nothere/'));
  t.check(`${label}: nothing of the release was missing`, missing.length === 0, missing);
  if (server === GZIP) {
    const eng = reqs.filter((x) => x.path.startsWith(`${BASE}engine/`) && x.status === 200);
    t.check(`${label}: the engine's files came gzipped with no Content-Length (the loader measures by the manifest)`, eng.length >= 4 && eng.every((x) => x.length === null && x.encoding === 'gzip'), eng);
  }
  t.check(`${label}: no page errors`, errors.length === 0, errors);

  // Add to Home Screen, from the subdirectory (after the request checks: these fetches are the test's own)
  const wa = await page.evaluate(async () => {
    const l = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!l) return null;
    const r = await fetch(l.href), m = await r.json();
    const icons = await Promise.all((m.icons ?? []).map(async (i: any) => { const u = new URL(i.src, l.href); const x = await fetch(u); const b = await x.blob(); const bm = await createImageBitmap(b); return { src: u.pathname, ok: x.ok, w: bm.width, sizes: i.sizes }; }));
    return { status: r.status, start: new URL(m.start_url, l.href).pathname, scope: new URL(m.scope, l.href).pathname, icons, meta: !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]') };
  });
  t.check(`${label}: the web app manifest loads from ${BASE}, start_url and scope are it, every icon loads at its size`, !!wa && wa.status === 200 && wa.start === BASE && wa.scope === BASE && wa.meta
    && wa.icons.length === 3 && wa.icons.every((i: any) => i.ok && i.src.startsWith(BASE) && `${i.w}x${i.w}` === i.sizes), wa);

  // 5. (Chromium) a reload: the files are cached by their names; the UI comes with nothing fetched again
  if (b === 'chromium' && full) {
    const n1 = server.log.length;
    await page.evaluate(() => { location.hash = '#/'; });
    await page.reload();
    await page.waitForFunction(() => (window as any).editorAPI?.route?.().name && (window as any).__rec.bootGone);
    const again = server.log.slice(n1).filter((x) => x.status === 200 && x.path !== BASE && !x.path.endsWith('/manifest.json') && manifest.files.some((f) => x.path === `${BASE}${f.path}`));
    t.check(`${label}: after a reload no file of the release is sent again`, again.length === 0, again);
  }
  await ctx.close();
}

try {
  for (const b of BROWSERS) await run(b, GZIP, true);
  if (BROWSERS.includes('chromium')) await run('chromium', PLAIN_SERVER, false, true);
} finally {
  await GZIP.close();
  await PLAIN_SERVER.close();
}
if (!haveTree) console.log(`(no TeX tree at ${TREE}: the check of a package from the tree beside the page was skipped)`);
t.done();
