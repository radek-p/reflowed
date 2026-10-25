// tests: the engine under Node, the engine in Chromium (dev server), and
// the built single file from file:// with every request other than file:,
// blob: and data: aborted and the browser offline.
//
//   node tests/test-w1.ts [--node] [--browser] [--file] [--intro] [--shots]
//   (no selection: all three; --intro adds the intro to the dev-server test)
//
// Setup: install the engine (node scripts/fetch-engine.ts), build the worker (node engine/scripts/build-worker.ts) and
// the single file (node scripts/build.ts --seed-cache).
// Results: test-results/w1/results.json, screenshots next to it.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(HERE, 'engine');
const OUT = join(resultsDir(HERE), 'w1');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(ENGINE, 'package.json'))('playwright');
const argv = new Set(process.argv.slice(2));
const all = !['--node', '--browser', '--file'].some((a) => argv.has(a));
const results: Record<string, unknown> = { date: new Date().toISOString() };
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

function run(what: string, file: string, extra: string[] = []) {
  console.log(`── ${what}`);
  try { execFileSync(process.execPath, [file, ...extra], { cwd: ENGINE, stdio: 'inherit' }); check(what, true); }
  catch { check(what, false, 'see above'); }
}
if (all || argv.has('--node')) {
  run('the converter copy (engine-api/src)', join(ENGINE, 'scripts/convert-src.ts'));
  run('engine (Node): warm = full compile, isolation, errors, TikZ, re-warm', join(ENGINE, 'tests/engine.test.ts'));
  run('displays (Node): route 1 model vs compiles at 250/300/420 pt', join(ENGINE, 'tests/displays.test.ts'));
  run('picture shim (Node): renditions, images, placeholders', join(ENGINE, 'tests/assets.test.ts'));
  run('protrusion (Node): every used font\'s hyphen character carries its protrusion codes', join(ENGINE, 'tests/protrusion.test.ts'));
  run('embedded set (Node): the intro + tier documents with the packed files only', join(ENGINE, 'tests/embedded-set.test.ts'));
  run('working-set lists (Node): each list file exists, its names are in the embedded set', join(ENGINE, 'tests/working-set-lists.test.ts'));
  run('spacing (Node): page gaps = one document\'s, sample + intro', join(ENGINE, 'tests/spacing.test.ts'), []);
  run('source positions (Node): TFM text, ligatures, hyphenation, accents, maths, peeks', join(ENGINE, 'tests/positions.test.ts'));
  run('virtual fonts under XeTeX (Node): newtx\'s maths and ae\'s T1 drawn from the fonts their packets name, source positions kept', join(ENGINE, 'tests/virtual-fonts.test.ts'));
  run('classic fonts (Node, the worker on the embedded set): lmodern maths, a document\'s own map line, virtual fonts draw the glyphs TeX set', join(ENGINE, 'tests/classic-fonts.test.ts'));
  run('Unicode input in TFM-encoded documents (Node): ń ł ő ř ß é print, with positions', join(ENGINE, 'tests/tfm-unicode.test.ts'));
  run('hyphenation of 8-bit text (Node): every T1/OT1 word has TeX\'s points as discretionaries', join(ENGINE, 'tests/tfm-hyphenation.test.ts'));
  run('source map guard (Node): the glyph-order invariant checked per item', join(ENGINE, 'tests/sourcemap-guard.test.ts'));
  run('date (Node): a compile runs on the time of the call, or on the date it is given', join(ENGINE, 'tests/date.test.ts'));
}
if (all || argv.has('--browser'))
{
  run('engine in Chromium (dev server)', join(ENGINE, 'tests/browser.test.ts'), [...(argv.has('--intro') ? ['--intro'] : []), ...(argv.has('--shots') ? ['--shots'] : [])]);
  // the intro as the app compiles it, in Chromium and WebKit (Safari): heap, snapshot, no crash (slow: ~15 min per browser on a loaded host)
  if (argv.has('--memory') || all) run('engine memory (Chromium + WebKit, the intro)', join(ENGINE, 'tests/memory.test.ts'));
}

// ── the single file ──────────────────────────────────────────────────────────
if (all || argv.has('--file')) {
  console.log('── the single file, file://, offline');
  const file = join(HERE, 'dist/reflowtex-editor.html');
  const stats = JSON.parse(readFileSync(join(HERE, 'dist/reflowtex-editor.json'), 'utf8'));
  const seedId = existsSync(join(HERE, 'build/seed/intro.json')) ? JSON.parse(readFileSync(join(HERE, 'build/seed/intro.json'), 'utf8')).id : null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ offline: true, viewport: { width: 1200, height: 900 } });
  const leaked: string[] = [];
  await ctx.route('**/*', (r: any) => { const u = r.request().url(); if (/^(file|blob|data):/.test(u)) return r.continue(); leaked.push(u); return r.abort(); });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto('file://' + file);
  await page.waitForFunction(() => (window as any).editorAPI, null, { timeout: 120000 });
  const tReady = Date.now() - t0;
  check('editor ready from file://', true);
  const r1 = await page.evaluate(async (id: string | null) => {
    const api = (window as any).editorAPI;
    const be = (globalThis as any).__rtxEditor?.backends?.[0];
    const t = performance.now();
    await api.open(id ?? 'intro');
    await api.whenIdle();
    const blocks = api.blocks();
    return { ms: performance.now() - t, backend: api.backend(), n: blocks.length, states: blocks.reduce((m: any, b: any) => ({ ...m, [b.state]: (m[b.state] ?? 0) + 1 }), {}),
      mounted: blocks.filter((b: any) => b.mounted).length, errors: blocks.filter((b: any) => b.errors?.length).map((b: any) => b.errors[0]?.message).slice(0, 5),
      stats: be?.stats() ?? null, info: be?.info() ?? null, modules: api.modules() };
  }, seedId);
  results.file = { tReady, stats, open: r1 };
  console.log(`  ready ${tReady} ms; intro open → idle ${Math.round(r1.ms)} ms; ${JSON.stringify(r1.states)}; backend ${JSON.stringify(r1.stats)}`);
  check('the engine backend is the one in use', r1.backend === 'tectonic', r1.backend);
  // markers (macros, comments, \appendix) are never compiled or mounted
  check(`intro: every block that typesets is mounted (${r1.mounted}/${r1.n - (r1.states.marker ?? 0)}; ${r1.states.marker ?? 0} markers)`, r1.n > 30 && r1.mounted === r1.n - (r1.states.marker ?? 0), JSON.stringify(r1));
  check('intro: no block or preamble error', r1.errors.length === 0, JSON.stringify(r1.errors));
  // numbered displays at the app's column: the number flush with the column's right edge, at two window widths
  for (const width of [1200, 760]) {
    await page.setViewportSize({ width, height: 900 });
    const v3 = await page.evaluate(async () => {
      await (window as any).editorAPI.whenIdle();
      const out: any[] = [];
      for (const id of ['01M3G2JN00EGFN3Y6G8SNGJ9KE', '01M3G2JN00EGFN3Y6G8SNGJ9JB']) {
        const blk = document.querySelector(`.blk[data-id="${id}"] .latex-block`) as HTMLElement | null;
        if (!blk) { out.push({ id, missing: true }); continue; }
        blk.scrollIntoView();
        await (window as any).editorAPI.whenIdle();
        const col = blk.getBoundingClientRect();
        const gs = [...blk.querySelectorAll('tspan, text')].filter((t) => !t.querySelector('tspan') && t.textContent)
          .map((t) => { const b = t.getBoundingClientRect(); return { s: t.textContent!, x1: b.right, y: Math.round(b.top + b.height / 2) }; });
        // the equation number: a line whose last glyphs are "(", digits, ")" at the far right
        const close = gs.filter((g) => g.s === ')').sort((a, b) => b.x1 - a.x1)[0];
        out.push({ id, colRight: col.right, width: col.width, tagRight: close?.x1 ?? null });
      }
      return out;
    });
    for (const v of v3) check(`in the app (window ${width} px): block ${v.id.slice(-4)}'s number ends at the column's right edge (${v.tagRight?.toFixed(1)} vs ${v.colRight?.toFixed(1)}, column ${v.width?.toFixed(0)} px)`,
      !v.missing && v.tagRight != null && Math.abs(v.tagRight - v.colRight) <= 1, JSON.stringify(v));
    (results.v3 ??= [] as any[]).push(...v3.map((v: any) => ({ ...v, window: width })));
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  // \leqslant (msam): a real glyph from the packed msam10.pfb, offline
  const leq = await page.evaluate(async () => {
    const be = (globalThis as any).__rtxEditor?.backends?.[0];
    const r = await be.compileSnippet('$x \\leqslant y \\geqslant z$');
    const el = document.createElement('div'); el.className = 'latex-block'; el.style.width = '400px'; el.dataset.nodelistB64 = r.nodelist;
    document.body.append(el);
    await (window as any).reflowtex.host.mount(el);
    await document.fonts.ready;
    const t = [...el.querySelectorAll('tspan')].find((x) => /msam/i.test(x.getAttribute('font-family') ?? ''));
    const fam = t?.getAttribute('font-family') ?? '';
    let ink = 0;
    if (t) { const cv = document.createElement('canvas'); cv.width = cv.height = 80; const cx = cv.getContext('2d')!; cx.font = `60px "${fam}"`; cx.fillText(t.textContent!, 10, 60);
      const px = cx.getImageData(0, 0, 80, 80).data; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) ink++; }
    el.remove();
    return { status: r.status, fam, ink, loaded: [...document.fonts].some((f: any) => f.family.replace(/["']/g, '') === fam && f.status === 'loaded') };
  });
  check(`\\leqslant offline: a real msam glyph (${leq.fam}, ${leq.ink} ink pixels)`, leq.status === 'ok' && leq.loaded && leq.ink > 100, JSON.stringify(leq));
  if (stats.seedCacheGzBytes > 0) check('seed cache: the paper opens with 0 compiles', r1.stats?.compiled === 0, JSON.stringify(r1.stats));
  await page.screenshot({ path: join(OUT, 'file-paper.png') });
  // one edit: request → result
  const r2 = await page.evaluate(async () => {
    const api = (window as any).editorAPI;
    const b = api.blocks().find((x: any) => x.kind === 'paragraph' && x.mounted);
    const t = performance.now();
    api.setSource(b.id, b.source + ' An edit.');
    await api.whenIdle();
    return { ms: performance.now() - t, state: api.blocks().find((x: any) => x.id === b.id).state };
  });
  console.log(`  one edited paragraph → idle ${Math.round(r2.ms)} ms (${r2.state})`);
  check('an edited block typesets again', /ok|shown|mounted|ready/i.test(r2.state) || r2.state === 'ok', JSON.stringify(r2));
  // reload: from the store's cache (IndexedDB), nothing compiles
  await page.reload();
  await page.waitForFunction(() => (window as any).editorAPI, null, { timeout: 120000 });
  const r3 = await page.evaluate(async (id: string | null) => {
    const api = (window as any).editorAPI;
    await api.open(id ?? 'intro'); await api.whenIdle();
    const be = (globalThis as any).__rtxEditor?.backends?.[0];
    return { stats: be?.stats(), mounted: api.blocks().filter((b: any) => b.mounted).length };
  }, seedId);
  check('reload: 0 compiles (IndexedDB)', r3.stats?.compiled === 0, JSON.stringify(r3.stats));
  results.reload = r3;
  // PDF export
  const pdf = await page.evaluate(async () => {
    const be = (globalThis as any).__rtxEditor?.backends?.[0];
    const doc = (window as any).editorAPI.currentDoc();
    const t = performance.now();
    const r = await be.pdf({ preamble: doc.preamble.source, blocks: doc.blocks.map((b: any) => ({ id: b.id, source: b.source })) });
    return { ms: performance.now() - t, bytes: r.pdf?.size ?? 0, errors: r.errors.length, newlabels: (r.aux?.match(/\\newlabel/g) ?? []).length };
  });
  console.log(`  PDF ${pdf.bytes} bytes in ${Math.round(pdf.ms)} ms, ${pdf.newlabels} labels`);
  check('PDF export (capture off, xdvipdfmx)', pdf.bytes > 100000, JSON.stringify(pdf));
  results.pdf = pdf;
  check('no request left the page', leaked.length === 0, leaked.slice(0, 3).join(' '));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  results.errors = errors;
  await browser.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
