// The TeX resource server on the page's own origin: the single file served
// over http by a static server (tests/qa/lib/static-server.ts), the TeX Live tree beside it (reflowEd/texlive/2022/),
// and the same file in a directory without one. No server address is set anywhere: the page's default does it.
//
//   node tests/test-resources-origin.ts [--file dist/reflowtex-editor.html] [--port 8187] [--browsers chromium,firefox,webkit]
//        [--engine-in firefox,webkit]
//
// Cases:
//   1. with the tree beside the page: the default is <page dir>/texlive/2022/, assumed (quiet); a package the file
//      does not carry typesets; the server sees one ls-R, then the files; after a reload, nothing
//   2. with no tree beside the page: one ls-R (a 404) for the whole page, however many packages are missing; the
//      problem is the one with no server; a reload asks once more at most
//   3. from file:// there is no default
//   4. an address set in the settings (advanced features shown) overrides the default; "none" turns it off
//   5. a blob: worker's synchronous GET to the page's own origin, in Chromium, Firefox and WebKit
// The tree is build/resources/www/texlive/2022/ (the engine release's, scripts/fetch-engine.ts). The server runs in this
// process, on --port (a port in use fails at once), and goes with it; its log is what the server saw.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { harness, EDITOR } from './qa/lib/harness.ts';
import { staticServer } from './qa/lib/static-server.ts';

const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const FILE = resolve(arg('--file') ?? join(EDITOR, 'dist/reflowtex-editor.html'));
const PORT = Number(arg('--port') ?? 8187);
const BROWSERS = (arg('--browsers') ?? 'chromium,firefox,webkit').split(',').filter(Boolean) as ('chromium' | 'firefox' | 'webkit')[];
const TREE = join(EDITOR, 'build/resources/www/texlive');
const t = harness('resources-origin');
// the tree, installed with the engine (scripts/fetch-engine.ts) when it is not there
if (!existsSync(join(TREE, '2022/texmf-dist/ls-R'))) execFileSync(process.execPath, [join(EDITOR, 'scripts/fetch-engine.ts')], { stdio: 'inherit' });

// ── the site: /reflowEd/ with the tree beside the file, /bare/ without, /probe.html ──
const WWW = join(t.out, 'www');
rmSync(WWW, { recursive: true, force: true });
mkdirSync(join(WWW, 'reflowEd'), { recursive: true }); mkdirSync(join(WWW, 'bare'), { recursive: true });
copyFileSync(FILE, join(WWW, 'reflowEd/index.html'));
copyFileSync(FILE, join(WWW, 'bare/index.html'));
symlinkSync(TREE, join(WWW, 'reflowEd/texlive'));
writeFileSync(join(WWW, 'probe.html'), `<!doctype html><meta charset="utf-8"><script>
window.probe = (url) => new Promise((resolve) => {
  const src = 'onmessage = (e) => { try { const x = new XMLHttpRequest(); x.open("GET", e.data, false); x.responseType = "arraybuffer"; x.send(); postMessage({ status: x.status, bytes: x.response ? x.response.byteLength : 0, type: x.getResponseHeader("content-type") }); } catch (err) { postMessage({ error: String(err) }); } };';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = (e) => resolve(e.data);
  w.postMessage(new URL(url, location.href).href);
});
</script>`);
const server = await staticServer({ root: WWW, port: PORT });
const ORIGIN = server.origin;
const requests = () => server.log.filter((r) => r.method === 'GET');
const lsrs = (dir: string) => requests().filter((r) => r.path === `/${dir}/texlive/2022/texmf-dist/ls-R`);
const texFiles = (dir: string) => requests().filter((r) => r.path.startsWith(`/${dir}/texlive/2022/texmf-dist/`) && !r.path.endsWith('/ls-R'));

const pw = createRequire(join(EDITOR, 'app/package.json'))('playwright');
async function open(browser: 'chromium' | 'firefox' | 'webkit', url: string, init?: string) {
  const ctx = await pw[browser].launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-origin-')), { viewport: { width: 1200, height: 900 } });
  if (init) await ctx.addInitScript(init);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.setDefaultTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name);
  return { ctx, page, errors };
}
/** the page's backend: the app makes it when a document opens, so on the home page the introduction is opened
 *  first (a release's default document; the files it needs are all in the release, so the tree is not asked) */
const backend = (page: any) => page.evaluate(async () => {
  const api = (window as any).editorAPI;
  if (!api.backendObject()) {
    const doc = (await api.store().listDocs()).find((d: any) => d.tags?.includes('intro') || d.meta?.tags?.includes('intro'));
    if (doc) { await api.open(doc.id); await api.whenIdle(); }
  }
  return !!api.backendObject();
});
const state = async (page: any) => (await backend(page), page.evaluate(() => (window as any).editorAPI.backendObject()?.resourceServerState?.() ?? null));
/** a block with this preamble on the page's backend (the one the app made and set up): its status and problems */
const compile = async (page: any, preamble: string, id: string, source: string) => (await backend(page), page.evaluate(async ([p, i, s]: string[]) => {
  const be = (window as any).editorAPI.backendObject();
  const r = await be.compile({ preamble: p, keep: [], blocks: [{ id: i, source: s }] });
  return { status: r.blocks[i].status, problems: [...(r.preamble?.errors ?? []), ...r.blocks[i].errors].map((e: any) => e.message) };
}, [preamble, id, source]))

// packages the single file does not carry, in scheme-small (the tree)
const PRE = '\\documentclass{article}\n\\usepackage{fancyhdr}\n\\usepackage{longtable}\n\\pagestyle{fancy}';
const PRE2 = '\\documentclass{article}\n\\usepackage{siunitx}';
const BLOCK = 'A paragraph, with a header from fancyhdr.';

// 1. the tree beside the page
{
  const { ctx, page, errors } = await open('chromium', `${ORIGIN}/reflowEd/#/`);
  t.check('1. nothing is asked of the tree before a document needs it (the home page)', lsrs('reflowEd').length === 0, requests());
  const s = await state(page);
  t.check('1. no address set, an http page: the default is the tree beside it, assumed', s?.base === `${ORIGIN}/reflowEd/texlive/2022/` && s.quiet === true && !s.missing, s);
  const r = await compile(page, PRE, 'a', BLOCK);
  t.check('1. a package the file does not carry typesets from the tree beside the page', r.status === 'ok', r);
  const files = texFiles('reflowEd');
  t.check('1. the server saw one ls-R, then the files, each once, all found', lsrs('reflowEd').length === 1 && files.length > 0 && new Set(files.map((f) => f.path)).size === files.length && files.every((f) => f.status === 200) && files.some((f) => f.path.endsWith('/fancyhdr.sty')), requests());
  const before = requests().length;
  await page.reload();
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name);
  const r2 = await compile(page, PRE, 'b', `${BLOCK} Again.`);
  t.check('1. after a reload: it typesets, and nothing is asked of the tree (the files are kept)', r2.status === 'ok' && requests().slice(before).filter((x) => x.path.includes('/texlive/')).length === 0, requests().slice(before));
  t.check('1. no page errors', errors.length === 0, errors);
  await ctx.close();
}

// 2. no tree beside the page
{
  const { ctx, page, errors } = await open('chromium', `${ORIGIN}/bare/#/`);
  const r = await compile(page, PRE, 'a', BLOCK);
  const r2 = await compile(page, PRE2, 'b', 'More.');
  const s = await state(page);
  t.check('2. no tree: the problem is the one with no server (the package, the embedded set, nothing more)', r.status === 'error' && r.problems.some((m: string) => /the package fancyhdr is not in the editor's embedded TeX set$/.test(m)) && !r.problems.some((m: string) => /server/.test(m)), r);
  t.check('2. another missing package: the same, and still one ls-R for the page (a 404), no file asked for', r2.status === 'error' && r2.problems.some((m: string) => /the package siunitx is not in the editor's embedded TeX set$/.test(m)) && lsrs('bare').length === 1 && lsrs('bare')[0].status === 404 && texFiles('bare').length === 0, { r2, req: requests() });
  t.check('2. the backend knows the assumed tree is missing (a new worker is not given it)', s?.missing === true, s);
  await page.evaluate(() => (window as any).editorAPI.backendObject().simulateCrash(1, 'death'))
  await compile(page, PRE, 'c0', 'The block the crash takes.').catch(() => null);
  await compile(page, PRE, 'c', `${BLOCK} After a crash.`);
  t.check('2. after an engine crash (a new worker), still one ls-R', lsrs('bare').length === 1, lsrs('bare'));
  await page.reload();
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name);
  await compile(page, PRE, 'd', BLOCK);
  t.check('2. a reload asks once more, no more', lsrs('bare').length === 2, lsrs('bare'));
  t.check('2. no page errors', errors.length === 0, errors);
  await ctx.close();
}

// 3. file://
{
  const { ctx, page, errors } = await open('chromium', `file://${FILE}#/`);
  const s = await state(page);
  t.check('3. from file://: no default server', s?.base === '' && s.quiet === false, s);
  t.check('3. no page errors', errors.length === 0, errors);
  await ctx.close();
}

// 4. an explicit setting
{
  const set = (v: string) => `try { localStorage.setItem('rtx-editor.advanced', '1'); localStorage.setItem('rtx-editor.resource-server', ${JSON.stringify(v)}); } catch {}`;
  const there = `${ORIGIN}/reflowEd/texlive/2022/`;
  let o = await open('chromium', `${ORIGIN}/bare/#/`, set(there));
  let s = await state(o.page);
  const r = await compile(o.page, PRE, 'a', BLOCK);
  t.check('4. an address set in the settings overrides the default (not assumed), and is used', s?.base === there && s.quiet === false && r.status === 'ok', { s, r });
  await o.ctx.close();
  o = await open('chromium', `${ORIGIN}/reflowEd/#/`, set('none'));
  s = await state(o.page);
  const before = lsrs('reflowEd').length;
  const r2 = await compile(o.page, PRE2, 'a', 'More.');
  t.check('4. "none" in the settings: no server, beside the tree too', s?.base === '' && r2.status === 'error' && lsrs('reflowEd').length === before, { s, r2 });
  await o.ctx.close();
}

// 5. the blob: worker's synchronous GET to the page's own origin, per browser
for (const b of BROWSERS) {
  const ctx = await pw[b].launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-origin-')), {});
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(`${ORIGIN}/probe.html`);
  const got = await page.evaluate(() => (window as any).probe('reflowEd/texlive/2022/texmf-dist/ls-R'));
  const miss = await page.evaluate(() => (window as any).probe('bare/texlive/2022/texmf-dist/ls-R'));
  t.check(`5. ${b}: a blob: worker reads the page's own origin synchronously (200), and a missing tree is a plain 404`, got.status === 200 && got.bytes > 1000 && miss.status === 404, { got, miss });
  await ctx.close();
}

// 6. --engine-in firefox,webkit: case 1's typesetting in other browsers too (the whole engine path; slow, not in the tier)
for (const b of (arg('--engine-in') ?? '').split(',').filter(Boolean) as ('firefox' | 'webkit')[]) {
  const { ctx, page, errors } = await open(b, `${ORIGIN}/reflowEd/#/`);
  const n0 = lsrs('reflowEd').length;
  const r = await compile(page, PRE, 'a', BLOCK);
  t.check(`6. ${b}: the tree beside the page, by default: the package typesets, one ls-R`, r.status === 'ok' && lsrs('reflowEd').length === n0 + 1 && errors.length === 0, { r, errors });
  await ctx.close();
}

await server.close();
t.done();
