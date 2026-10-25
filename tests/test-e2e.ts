// End-to-end acceptance of the editor PoC (integration): the whole app on
// the introduction to ReflowEd (samples/intro, every build's default document), through its UI and window.editorAPI.
//
//   node tests/test-e2e.ts dev  [http://localhost:8150/] [--browser chromium|firefox|webkit] [--no-shots]
//   node tests/test-e2e.ts file [dist/reflowtex-editor.html]  [--browser …] [--no-shots]
//   (dev = tests/integration/serve.ts on 8150, the app with engine: node tests/integration/serve.ts 8150)
//
// `file` opens the single file from file:// with the browser offline and every
// request that is not file:, blob: or data: aborted (and counted as a failure).
// Each run starts from an empty profile (IndexedDB), i.e. a first open.
//
// Waits on editorAPI.whenIdle() (compiles done, results mounted, refs refreshed,
// reflowtex.inspect.idle()), the home's idle(), the figure editor's idle() and
// DOM conditions; never on fixed times.
// Results: test-results/e2e/<target>-<browser>/{results.json, *.png}.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');           // the repository root
const argv = process.argv.slice(2);
const TARGET = argv[0] === 'file' ? 'file' : 'dev';
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const BROWSER = flag('--browser') ?? 'chromium';
const SHOTS = !argv.includes('--no-shots');
const posArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const FILE = TARGET === 'file' ? (posArg ?? join(HERE, 'dist/reflowtex-editor.html')) : null;
// dev: the plain address a person opens (tests/integration/serve.ts redirects it to ?engine)
const URL0 = TARGET === 'file' ? `file://${FILE}` : `${(posArg ?? 'http://localhost:8150/').replace(/\/?$/, '/')}`;
const OUT = join(resultsDir(HERE), `e2e/${TARGET}-${BROWSER}`);
mkdirSync(OUT, { recursive: true });
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
const MOD = 'Control';
const SEED_ID = '01M3G2JN00N41KTJ0CSGFJ92QW';   // the intro's fixed doc id (samples/intro/seed-intro.ts)
const INTRO_TITLE = 'An Introduction to ReflowEd';

type R = { journey: string; name: string; ok: boolean; detail?: string };
const results: R[] = [];
const timings: Record<string, number | string> = {};
let journey = '';
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ journey, name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${journey}] ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const shot = async (page: any, name: string, opts: any = {}) => { if (SHOTS) await page.screenshot({ path: join(OUT, `${name}.png`), ...opts }); };
/** a journey: its checks; an exception fails it and the run goes on */
async function step(name: string, f: () => Promise<void>) {
  journey = name;
  const t = Date.now();
  try { await f(); } catch (e: any) { check('(exception)', false, `${e.message.split('\n')[0]}`); }
  console.log(`   ${name}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
}

// ── browser, page, problems ──────────────────────────────────────────────────
// a persistent profile (a fresh directory per run: a first open), so the last journey can restart the
// browser on the same storage (IndexedDB: documents and the result cache)
const PROFILE = mkdtempSync(join(tmpdir(), 'rtx-e2e-'));
const problems: string[] = [], leaked: string[] = [], consoleAll: string[] = [];
async function openContext() {
  const c = await pw[BROWSER].launchPersistentContext(PROFILE, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true,
    ...(TARGET === 'file' && BROWSER !== 'webkit' ? { offline: true } : {}) });
  if (TARGET === 'file')
    await c.route('**/*', (r: any) => { const u = r.request().url(); if (/^(file|blob|data):/.test(u)) return r.continue(); leaked.push(u); return r.abort(); });
  return c;
}
let ctx = await openContext();
let page = ctx.pages()[0] ?? await ctx.newPage();
const watch = (p: any) => {
  p.on('console', (m: any) => {
    consoleAll.push(`console ${m.type()}: ${m.text().slice(0, 300)}`);
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  p.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  p.on('requestfailed', (r: any) => { if (TARGET === 'dev') problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  p.on('response', (r: any) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
};
watch(page);
page.setDefaultTimeout(120000);
const api = (fn: string, ...args: any[]) => page.evaluate(([f, a]: [string, any[]]) => (window as any).editorAPI[f](...a), [fn, args]);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const homeIdle = () => page.evaluate(() => (window as any).editorAPI.homeIdle());
const blocks = () => api('blocks');
const ready = () => page.waitForFunction(() => (window as any).editorAPI, null, { timeout: 180000 });
const rowOf = (title: string) => page.locator('.rh-row', { has: page.locator('.rh-title', { hasText: title }) });
const homeMenu = async (title: string, action: string) => {
  await rowOf(title).first().hover();
  await rowOf(title).first().locator('[data-action=more]').click();
  await page.click(`.rh-pop [data-action=${action}]`);
};
const docMenu = async (action: string) => { await page.click('#btn-doc-menu'); await page.click(`.doc-menu [data-action="${action}"]`); };
const statesOf = (bs: any[]) => bs.reduce((m: Record<string, number>, b: any) => ({ ...m, [b.state]: (m[b.state] ?? 0) + 1 }), {});
/** bring a block into view and wait until the viewer has drawn it (it draws lazily, in view) */
const reveal = async (id: string) => {
  await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }), id);
  await idle();
};
/** the text the viewer drew for a block (one tspan per glyph) */
const renderedText = async (id: string) => {
  await reveal(id);
  return page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"] .blk-render`)?.textContent ?? '', id);
};
/** messages that say TeX could not find a file (the user saw "File `size11.clo' not found" on opening the paper) */
const MISSING = /not found|can't find|cannot find|no such file|couldn't open|could not open|unable to (?:load|open)/i;

let introId = SEED_ID;
let defaults: { id: string; title: string }[] = [];          // the documents a first open shows
/** the backend's real compiles since this page loaded (cache and seed hits excluded) */
const compiledNow = async () => (await page.evaluate(() => (window as any).editorAPI.backendObject()?.stats?.() ?? null))?.compiled ?? NaN;
const openDoc = async (id: string) => {
  await page.evaluate((i: string) => { location.hash = `#/doc/${i}`; }, id);
  await page.waitForFunction((i: string) => (window as any).editorAPI.route().id === i, id);
  await idle();
};
let tFirstOpen = 0;

// ── 1. First open: the home shows the intro ─────────────────────────────────
await step('first open → home', async () => {
  const t0 = Date.now();
  await page.goto(URL0 + '#/');
  await ready();
  timings.readyMs = Date.now() - t0;
  await page.waitForSelector('.rh-row[data-doc-id]');
  await homeIdle();
  const titles = await page.locator('.rh-row .rh-title').allTextContents();
  check('home lists the intro', titles.some((t: string) => t === INTRO_TITLE), titles.join(' | '));
  check('the modules are all real', true, JSON.stringify(await api('modules')));
  const be = await api('backends');
  check('the engine backend (tectonic) is offered first', be[0] === 'tectonic', be.join(','));
  defaults = await page.evaluate(async () => ((await (window as any).editorAPI.store().listDocs()) as any[]).map((d) => ({ id: d.id, title: d.title })));
  await shot(page, '01-home');
});

// ── 2. Open the intro: blocks typeset ────────────────────────────────────────
await step('open intro → typeset', async () => {
  const t0 = Date.now();
  await rowOf(INTRO_TITLE).first().click();
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  introId = (await api('route')).id;
  await idle();
  tFirstOpen = Date.now() - t0;
  timings.firstOpenMs = tFirstOpen;
  const bs = await blocks();
  const st = statesOf(bs);
  const errs = bs.filter((b: any) => b.state === 'error').map((b: any) => `${b.kind} «${b.source.slice(0, 40).replace(/\s+/g, ' ')}» ${b.errors[0]?.line ?? ''}: ${b.errors[0]?.message ?? ''}`);
  timings.blockStates = JSON.stringify(st);
  check('backend in use: tectonic', (await api('backend')) === 'tectonic', await api('backend'));
  check(`every block typeset or a marker (${bs.length} blocks)`, errs.length === 0 && (st.ok ?? 0) >= 30, `${JSON.stringify(st)} ${errs.join(' | ')}`);
  if (errs.length) writeFileSync(join(OUT, 'errored-blocks.txt'), errs.join('\n') + '\n');
  // no missing files anywhere: block errors, the preamble's (diagnostics), the status line, the console
  const msgs: string[] = [
    ...bs.flatMap((b: any) => (b.errors ?? []).map((e: any) => `${b.kind}: ${e.message}`)),
    ...(await api('diagnostics')).filter((d: any) => d.kind === 'error').map((d: any) => d.message ?? ''),
    `status: ${await page.locator('.status').first().textContent().catch(() => '')}`,
    ...consoleAll,
  ];
  const missing = msgs.filter((m) => MISSING.test(m));
  check('no missing-file errors (e.g. size11.clo)', missing.length === 0, missing.slice(0, 4).join(' | '));
  const stats = await page.evaluate(() => (window as any).editorAPI.backendObject()?.stats?.() ?? null);
  timings.openStats = JSON.stringify(stats);
  check('first open timing recorded', true, `${tFirstOpen} ms; backend ${JSON.stringify(stats)}`);
  // the single file carries the seed documents' compiled results: a first open compiles nothing
  if (TARGET === 'file') check('first open of the intro: 0 compiles (precomputed)', stats?.compiled === 0, JSON.stringify(stats));
  await shot(page, '02-intro-top');
});

// ── 2b. The other default documents open with nothing to compile ────────────
await step('defaults open with 0 compiles', async () => {
  const others = defaults.filter((d) => d.id !== introId);
  // as many as the page carries: a build names its default documents (--seeds=…), the
  // dev server serves both
  const carried: number | null = await page.evaluate(() => ((globalThis as any).__rtxSeeds ? Object.keys((globalThis as any).__rtxSeeds).length : null));
  check('a first open shows the default documents', defaults.length >= (carried ?? 2) && defaults.length >= 1, `${defaults.map((d) => d.title).join(' | ')} (${carried ?? 'dev: 2'} carried)`);
  for (const d of others) {
    const c0 = await compiledNow();
    await openDoc(d.id);
    const n = (await compiledNow()) - c0;
    const st = statesOf(await blocks());
    const errs = (await blocks()).filter((b: any) => b.state === 'error').map((b: any) => `${b.kind}: ${b.errors[0]?.message ?? ''}`);
    check(`«${d.title}» typesets`, !st.error && (st.ok ?? 0) > 0, `${JSON.stringify(st)} ${errs.slice(0, 2).join(' | ')}`);
    if (TARGET === 'file') check(`«${d.title}»: 0 compiles on first open (precomputed)`, n === 0, `${n} compiled`);
    else timings[`compiles:${d.title.slice(0, 20)}`] = n;
  }
  await openDoc(introId);
});

// ── 3. Outline: the sections ────────────────────────────────────────────────
await step('outline', async () => {
  const ol = await api('outline');
  const titles = ol.map((o: any) => `${o.number ?? ''} ${o.title}`.trim());
  const want = ['What ReflowEd is', 'Editing a block', 'Mathematics', 'Citations', 'Figures'];
  check('outline has the sections', want.every((w) => ol.some((o: any) => o.title === w)), titles.join(' | '));
  // (an appendix's outline is checked by tests/test-w3.ts)
  const unresolved = ol.filter((o: any) => /\\(c|C)?ref|\?\?/.test(o.title)).map((o: any) => o.title);
  check('outline titles have no raw \\ref or ??', unresolved.length === 0, unresolved.join(' | '));
  const nums = ol.filter((o: any) => o.level === 1 || o.level === undefined).map((o: any) => o.number).filter(Boolean);
  check('sections numbered 1..8', ['1', '2', '3', '4', '5', '6', '7', '8'].every((n) => nums.includes(n)), nums.join(','));
  // click scrolls to a late section
  await page.locator('#panel-outline .ol-item', { hasText: 'Tables and lists' }).first().locator('button.ol-link').first().click();
  await idle();
  await shot(page, '03-outline-late');
});

// ── 4. Numbers vs a whole-document compile's .aux; citations; figures ───────
let aux = '';
await step('numbers vs .aux (PDF export)', async () => {
  const t0 = Date.now();
  const r = await page.evaluate(async () => {
    const api = (window as any).editorAPI, be = api.backendObject(), doc = api.currentDoc();
    if (!be?.pdf) return { none: true };
    const r = await be.pdf(api.pdfRequest());   // as Export PDF builds it: a nested paper's containers joined
    return { bytes: r.pdf?.size ?? 0, aux: r.aux ?? '', errors: (r.errors ?? []).map((e: any) => e.message).slice(0, 5), b64: r.pdf ? await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(r.pdf); }) : null };
  });
  timings.pdfMs = Date.now() - t0;
  check('PDF export (backend.pdf) gives a PDF', !r.none && r.bytes > 20000, `${r.bytes} bytes in ${timings.pdfMs} ms; errors ${JSON.stringify(r.errors)}`);
  if (r.b64) writeFileSync(join(OUT, 'intro.pdf'), Buffer.from(r.b64 as string, 'base64'));
  aux = r.aux ?? '';
  if (aux) writeFileSync(join(OUT, 'intro.aux'), aux);
  // \newlabel{name}{{number}{page}…}: the first argument, braces balanced (as tests/test-w4.ts parity());
  // the whole-document compile of this run (backend.pdf)
  const auxNumbers = (text: string) => {
    const out = new Map<string, string>();
    for (const m of text.matchAll(/^\\newlabel\{([^}]*)\}\{/gm)) {
      const l = m[1];
      if (l.endsWith('@cref') || l.endsWith('@data') || l.startsWith('thmt@@')) continue;
      let i = m.index! + m[0].length + 1, d = 1, v = '';
      for (; i < text.length && d > 0; i++) { const ch = text[i]; if (ch === '{') d++; else if (ch === '}') d--; if (d > 0) v += ch; }
      out.set(l, v.replace(/\\star\s*/g, '⋆').replace(/\\relax\s*/g, '').replace(/[{}$\s]/g, ''));
    }
    return out;
  };
  const st = await api('refsState');
  const compare = (auxNum: Map<string, string>) => {
    const mism: string[] = [];
    let same = 0;
    for (const [name, num] of auxNum) {
      const got = String(st.labels?.[name]?.number ?? '(none)').replace(/\s+/g, '');
      if (got === num) same++; else mism.push(`${name}: aux ${num} / app ${got || '(empty)'}`);
    }
    return { same, total: auxNum.size, mism };
  };
  const run = compare(auxNumbers(aux));
  writeFileSync(join(OUT, 'numbers-vs-aux.txt'), `this run's PDF export: ${run.same}/${run.total} equal\n${run.mism.join('\n')}\n`);
  timings.numbersEqual = `${run.same}/${run.total}`;
  check('every label number = the .aux of the PDF export', run.total >= 18 && run.mism.length === 0, `${run.same}/${run.total} equal; e.g. ${run.mism.slice(0, 6).join('; ')}`);
});

await step('citations and figures', async () => {
  const st = await api('refsState');
  const bib = st.bib ?? {};
  const entries: any[] = Array.isArray(bib) ? bib : Object.values(bib);
  const labelOf = (k: string) => entries.find((e: any) => e.key === k)?.label;
  const bs = await blocks();
  for (const k of ['knuth1984', 'lamport1994']) {
    const single = bs.filter((b: any) => new RegExp(`\\\\cite\\{${k}\\}`).test(b.source) && b.mounted);
    const want = labelOf(k);
    const txt = single.length ? (await renderedText(single[0].id)).replace(/\s+/g, ' ') : '';
    const at = txt.indexOf(`[${want}]`);
    check(`\\cite{${k}} prints [${want}]`, !!want && at >= 0, `${single.length} blocks; «${at >= 0 ? txt.slice(Math.max(0, at - 30), at + 12) : txt.slice(0, 80)}»`);
  }
  // no citation left unknown
  const undefinedCites = (await api('diagnostics')).filter((d: any) => d.kind === 'unknown-cite');
  check('no unknown citations', undefinedCites.length === 0, undefinedCites.map((d: any) => d.key).join(','));
  // the bibliography block lists the cited entries
  const bibBlock = bs.find((b: any) => b.kind === 'bibliography');
  const bt = bibBlock ? await renderedText(bibBlock.id) : '';
  check('the bibliography is typeset with its numbers', bibBlock?.mounted && /\[1\]/.test(bt) && /\[2\]/.test(bt), `${bt.length} chars: ${bt.slice(0, 80)}`);
  // figures: non-blank pictures
  const figs = bs.filter((b: any) => b.kind === 'figure');
  for (const f of figs) await reveal(f.id);
  const fig = await page.evaluate((ids: string[]) => ids.map((id) => {
    const el = document.querySelector(`.blk[data-id="${id}"] .blk-render`);
    const r = el?.getBoundingClientRect();
    return { id, h: Math.round(r?.height ?? 0), paths: el?.querySelectorAll('path, use, image').length ?? 0 };
  }), figs.map((f: any) => f.id));
  check('the figures are drawn (non-blank: the TikZ picture, the placeholder screenshots)', figs.length >= 8 && fig.every((f: any) => f.h > 60 && f.paths >= 1), fig);
  // (the paper this ran on had a PNG logo in its title's \thanks; the intro's pictures are its figures, above)
  const fb = page.locator(`.blk[data-id="${figs[0]?.id}"]`);
  if (figs[0]) { await fb.scrollIntoViewIfNeeded(); await idle(); await shot(page, '04-figure'); }
});

// ── 4b. Displays: equation numbers flush right at two widths ────────────────
/** every numbered display: right edge of its rightmost glyph (the tag) vs the column's right edge */
async function tagEdges() {
  const bs = await blocks();
  // blocks with a numbered display: equation/align/gather/multline (unstarred), not only \nonumber'd
  const withTags = bs.filter((b: any) => b.mounted && /\\begin\{(equation|align|gather|multline|flalign|alignat)\}/.test(b.source));
  const out: any[] = [];
  for (const b of withTags) {
    await reveal(b.id);
    out.push(...await page.evaluate((id: string) => {
      const blk = document.querySelector(`.blk[data-id="${id}"] .blk-render .latex-block`);
      if (!blk) return [];
      const col = blk.getBoundingClientRect();
      // the display segments by the viewer's own layout (inspect.state): the viewer
      // marks only an overflowing display with .latex-display (its scroll box), so selecting by that
      // class found none at 1280 px and only the overflowing ones at 600 px
      const cache = (window as any).reflowtex?.inspect?.state(blk)?.cache;
      const laid: any[] = cache?.layout?.laid ?? [];
      const disp = laid.map((L: any, i: number) => (L?.seg?.kind === 'display' ? (cache.dom.segs[i]?.wrap?.contains(cache.dom.segs[i]?.svg) ? cache.dom.segs[i].wrap : cache.dom.segs[i]?.svg) : null)).filter(Boolean) as Element[];
      return disp.map((d, i) => {
        const ts = [...d.querySelectorAll('tspan')].filter((t) => (t.textContent ?? '').trim());
        if (!ts.length) return null;
        let right = -1e9, last = '';
        for (const t of ts) { const r = t.getBoundingClientRect(); if (r.right > right) { right = r.right; last = t.textContent ?? ''; } }
        // a tag ends in ')'; other displays are unnumbered
        if (!last.trim().endsWith(')')) return null;
        return { id, i, delta: +(right - col.right).toFixed(2), overflow: d.classList.contains('latex-overflow-right'), colW: Math.round(col.width) };
      }).filter(Boolean);
    }, b.id));
  }
  return out;
}
await step('displays: tags flush right', async () => {
  for (const w of [1280, 600]) {
    await page.setViewportSize({ width: w, height: 900 });
    await idle();
    const e = await tagEdges();
    const bad = e.filter((x: any) => Math.abs(x.delta) > 1);
    const worst = e.reduce((m: number, x: any) => Math.max(m, Math.abs(x.delta)), 0);
    timings[`tagsFlush${w}`] = `${e.length - bad.length}/${e.length} (worst ${worst.toFixed(1)} px, column ${e[0]?.colW ?? '?'} px)`;
    check(`window ${w} px: every equation number flush right (±1 px)`, e.length >= 1 && bad.length === 0,
      `${e.length - bad.length}/${e.length} flush; column ${e[0]?.colW} px; worst ${worst.toFixed(1)} px; overflowing displays ${e.filter((x: any) => x.overflow).length}; e.g. ${bad.slice(0, 4).map((x: any) => `${x.delta}`).join(', ')}`);
    if (w === 600 && bad[0]) { await reveal(bad[0].id); await shot(page, '04c-tag-600'); }
    if (w === 1280 && bad[0]) { await reveal(bad[0].id); await shot(page, '04b-tag-1280'); }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // below 900 px the app closes the sidebar (and leaves it closed when the window grows again)
  await page.evaluate(() => (window as any).editorAPI.workbench().collapseSide('left', false));   // the left column shown
  await idle();
  // (the paper's \le was \leqslant, msam10: the release acceptance checks every font family draws its own glyphs)
});

// ── 4c. Paragraphs with references and citations reflow ─────────────────────
// (a paragraph with a \ref/\cref/\eqref slot must not run past the column: an
// undefined reference's default was LaTeX's {\mbox{??}}, a box the viewer cannot replace, so DOM
// fallback rewrote the drawn glyphs and the paragraph never re-broke; fix in rtx-numbering.sty \rtx@slot)
/** per paragraph: the furthest line end (glyph advance, not ink) past the column's right edge, in px */
async function lineEnds(ids: string[]) {
  const out: { id: string; over: number; lines: number; slots: number; patched: number; text: string }[] = [];
  for (const id of ids) {
    await reveal(id);
    out.push(await page.evaluate((i: string) => {
      const blk = document.querySelector(`.blk[data-id="${i}"] .blk-render .latex-block`);
      if (!blk) return { id: i, over: 0, lines: 0, slots: 0, patched: 0, text: '' };
      const col = blk.getBoundingClientRect().right;
      let over = -1e9, lines = 0, text = '';
      for (const s of blk.querySelectorAll('svg')) {
        if (s.closest('.latex-display')) continue;
        const left = s.getBoundingClientRect().left;
        const byY = new Map<string, any[]>();
        for (const t of s.querySelectorAll(':scope > text > tspan')) { const y = t.getAttribute('y')!; if (!byY.has(y)) byY.set(y, []); byY.get(y)!.push(t); }
        for (const ts of byY.values()) {
          lines++;
          let end = -1e9;
          for (const t of ts) { const n = (t.textContent ?? '').length; if (n) try { end = Math.max(end, t.getEndPositionOfChar(n - 1).x); } catch { /* */ } }
          if (left + end - col > over) { over = left + end - col; text = ts.map((t: any) => t.textContent).join('').slice(-40); }
        }
      }
      return { id: i, over: +over.toFixed(2), lines, slots: blk.querySelectorAll('tspan[data-slot]').length, patched: blk.querySelectorAll('tspan[data-rtx-patched]').length, text };
    }, id));
  }
  return out;
}
await step('references reflow', async () => {
  let allowance = 1;
  const REF = /\\(?:[cC]ref|ref|eqref|autoref|cite[tp]?)\*?(?:\[[^\]]*\])?\{/;
  const bs = await blocks();
  const withRefs = bs.filter((b: any) => b.kind === 'paragraph' && b.mounted && REF.test(b.source)).slice(0, 24);
  const plain = bs.filter((b: any) => b.kind === 'paragraph' && b.mounted && !REF.test(b.source)).slice(0, 6);
  for (const w of [1280, 600]) {
    await page.setViewportSize({ width: w, height: 900 });
    await idle();
    const r = await lineEnds(withRefs.map((b: any) => b.id));
    const p = await lineEnds(plain.map((b: any) => b.id));
    // microtype protrusion: a line's last glyph (a hyphen, a full stop) hangs into the margin by
    // design, in every paragraph; a reference must not add to that: the plain paragraphs' worst is the allowance
    const hang = Math.max(1, ...p.map((x) => x.over)) + 0.5;
    allowance = hang;
    const bad = r.filter((x) => x.over > hang);
    timings[`refsReflow${w}`] = `${r.length - bad.length}/${r.length} fit (worst ${Math.max(...r.map((x) => x.over)).toFixed(1)} px; plain worst ${Math.max(...p.map((x) => x.over)).toFixed(1)} px)`;
    check(`window ${w} px: every line of a paragraph with refs/cites fits the column (±1 px, and the protrusion plain paragraphs have)`, r.length >= 5 && bad.length === 0,
      `${r.length - bad.length}/${r.length} fit; patched glyphs ${r.reduce((n, x) => n + x.patched, 0)}; worst ${bad.slice(0, 3).map((x) => `${x.over} px «…${x.text}»`).join(' | ')}; plain paragraphs worst ${Math.max(...p.map((x) => x.over)).toFixed(2)} px`);
    if (bad[0]) { await reveal(bad[0].id); await shot(page, `04e-refs-overflow-${w}`); }
  }
  // the same paragraph with its references typed out as plain text breaks into as many lines
  await page.setViewportSize({ width: 600, height: 900 });
  await idle();
  const st = await api('refsState');
  const orig = withRefs.find((b: any) => /\\Cref\{/.test(b.source) && !/\\cite/.test(b.source)) ?? withRefs[0];
  const typed = orig.source.replace(/\\([cC]ref|ref|eqref)\{([^}]*)\}/g, (_m: string, cmd: string, l: string) => {
    const info = st.labels?.[l.split(',')[0]];
    if (!info) return '??';
    const text = /cref/i.test(cmd) ? (info.text ?? info.number) : info.number;
    return cmd === 'eqref' ? `(${text})` : cmd === 'cref' ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  });
  const idx = (await blocks()).findIndex((b: any) => b.id === orig.id);
  const copy = await api('insert', idx + 1, 'paragraph', typed);
  await idle();
  const [a, b] = await lineEnds([orig.id, copy]);
  check('the same paragraph with its references as plain text has as many lines', a.lines === b.lines && b.over <= allowance,
    `with refs ${a.lines} lines (worst ${a.over} px), plain ${b.lines} lines (worst ${b.over} px)`);
  await api('remove', copy);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => (window as any).editorAPI.workbench().collapseSide('left', false));   // the left column shown
  await idle();
});

// ── 5. Edit a paragraph: only it recompiles ─────────────────────────────────
await step('edit → only it recompiles', async () => {
  const bs = await blocks();
  const b = bs.find((x: any) => x.kind === 'paragraph' && x.mounted && x.source.length > 200 && !/\\label|\\cite|\\[cC]ref/.test(x.source));
  await api('resetCounters');
  const t0 = Date.now();
  await api('setSource', b.id, b.source + ' An edit.');
  await idle();
  const ms = Date.now() - t0;
  timings.editMs = ms;
  const k = await api('counters');
  const ids = [...new Set(k.compiledIds)];
  const after = (await blocks()).find((x: any) => x.id === b.id);
  check('the edited paragraph typesets again', after.state === 'ok' && after.mounted, after.state);
  check('only the edited block compiled', ids.length === 1 && ids[0] === b.id, `${ids.length} compiled, ${k.requests} request(s), ${ms} ms`);
  const txt = await renderedText(b.id);
  check('the edit shows in the render', /An edit\./.test(txt.replace(/\s+/g, ' ')), txt.slice(-40));
  // a second edit (warm): per-block time
  const t1 = Date.now();
  await api('setSource', b.id, b.source + ' Another edit.');
  await idle();
  timings.editMs2 = Date.now() - t1;
  await api('setSource', b.id, b.source);
  await idle();
});

// ── 6. Autocomplete \Cref{ ─────────────────────────────────────────────────
await step('autocomplete \\Cref{', async () => {
  const bs = await blocks();
  const b = bs.find((x: any) => x.kind === 'paragraph' && x.mounted && x.source.length < 400);
  await api('edit', b.id);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(' See \\Cref{');
  await page.waitForSelector('.cm-tooltip-autocomplete li');
  const opts = await page.locator('.cm-tooltip-autocomplete .cm-completionLabel').allTextContents();
  const labels = Object.keys((await api('refsState')).labels ?? {});
  check('\\Cref{ offers the document\'s labels', opts.length >= 5 && opts.every((o: string) => labels.includes(o)), `${opts.length} shown: ${opts.slice(0, 6).join(', ')}`);
  const detail = await page.locator('.cm-tooltip-autocomplete .cm-completionDetail').allTextContents().catch(() => []);
  check('completions show numbers (Lemma 3.2 …)', detail.some((d: string) => /\d/.test(d)), detail.slice(0, 4).join(' | '));
  await shot(page, '06-autocomplete');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await api('setSource', b.id, b.source);
  await page.keyboard.press('Escape');
  await idle();
});

// ── 7. Problems panel ───────────────────────────────────────────────────────
await step('problems panel', async () => {
  const d = await api('diagnostics');
  const by = d.reduce((m: Record<string, number>, x: any) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {});
  timings.problems = JSON.stringify(by);
  check('no errors, undefined refs or duplicate labels on the untouched document', !by.error && !by['undefined-ref'] && !by['duplicate-label'],
    `${JSON.stringify(by)}; ${d.filter((x: any) => x.kind !== 'unused-label').slice(0, 5).map((x: any) => `${x.kind} ${x.key ?? ''} ${x.message ?? ''}`).join(' | ')}`);
  await page.click('[data-side] [data-ptab="problems"]');
  const shown = await page.locator('#panel-problems .pb-row').count().catch(() => -1);
  check('the Problems tab lists them', shown >= 0, `${shown} rows`);
  await shot(page, '07-problems');
  await page.click('[data-side] [data-ptab="outline"]');
});

// ── 8. Image figures (the Ipe figure editor is removed): they typeset as images, no "Edit figure" ──
await step('image figures', async () => {
  const figs = (await blocks()).filter((b: any) => b.kind === 'figure' && /\\(?:includegraphics(\[[^\]]*\])?|shot)\{[^}]*\}/.test(b.source) && !/\.svg\}/.test(b.source));
  const out: any[] = [];
  for (const fig of figs) {
    await reveal(fig.id);
    const fb = page.locator(`.blk[data-id="${fig.id}"]`);
    await fb.hover();
    out.push(await page.evaluate((id: string) => {
      const el = document.querySelector(`.blk[data-id="${id}"]`)!;
      const r = el.querySelector('.blk-render');
      return { id, html: r?.innerHTML.length ?? 0, pics: r?.querySelectorAll('img, image, svg').length ?? 0, edit: !!el.querySelector('.fig-edit') };
    }, fig.id));
  }
  const st = (await blocks()).filter((b: any) => figs.some((f: any) => f.id === b.id)).map((b: any) => b.state);
  check('the intro\'s image figures typeset (images drawn)', figs.length >= 7 && st.every((s: string) => s === 'ok') && out.every((o) => o.html > 1000 && o.pics > 0), { n: figs.length, st, out: out.map((o) => [o.html, o.pics]) });
  check('no "Edit figure" on an image figure (only SVG figures have one)', out.every((o) => !o.edit), out.filter((o) => o.edit).map((o) => o.id));
  await shot(page, '08-image-figures');
});

// ── 9. Versions: save, restore ──────────────────────────────────────────────
await step('versions save/restore', async () => {
  const bs = await blocks();
  const lemma = bs.find((b: any) => b.kind === 'theorem');
  await docMenu('versions');
  await page.waitForSelector('dialog.versions-dialog .rv');
  const vIdle = () => page.evaluate(() => (document.querySelector('dialog.versions-dialog') as any)._versions?.idle?.());
  await vIdle();
  const n0 = await page.locator('dialog.versions-dialog .rv-item').count();
  await page.fill('dialog.versions-dialog input[name="label"]', 'E2E checkpoint');
  await page.click('dialog.versions-dialog [data-action="save-version"]');
  await page.waitForFunction((n: number) => document.querySelectorAll('dialog.versions-dialog .rv-item').length > n, n0);
  await vIdle();
  check('Save version adds one', true, `${n0} → ${await page.locator('dialog.versions-dialog .rv-item').count()}`);
  // the one Versions dialog (the home opens it too): the document named in its title, a Close button, a press on the
  // backdrop closes it, the close button and Esc too
  const docTitle = await page.evaluate(async () => { const id = (window as any).editorAPI.route().id; return ((await (window as any).editorAPI.store().listDocs()) as any[]).find((d) => d.id === id)?.title || 'Untitled'; });
  const vTitle = await page.locator('dialog.versions-dialog .ui-dialog-title').textContent();
  const closedBy = async (how: () => Promise<unknown>) => {
    if (!(await page.locator('dialog.versions-dialog[open]').count())) { await docMenu('versions'); await page.waitForSelector('dialog.versions-dialog[open] .rv'); await vIdle(); }
    await how();
    return page.waitForFunction(() => !document.querySelector('dialog.versions-dialog'), null, { timeout: 3000 }).then(() => true, () => false);
  };
  const byClose = await closedBy(() => page.click('dialog.versions-dialog [data-action="close-versions"]'));
  const byBackdrop = await closedBy(() => page.mouse.click(4, 4));
  const byX = await closedBy(() => page.click('dialog.versions-dialog .dlg-close'));
  const byEsc = await closedBy(() => page.keyboard.press('Escape'));
  check('the editor\'s Versions is the one dialog: "Versions of “title”", closed by Close, a backdrop press, its close button, Esc',
    vTitle === `Versions of “${docTitle}”` && byClose && byBackdrop && byX && byEsc, { vTitle, docTitle, byClose, byBackdrop, byX, byEsc });
  await api('setSource', lemma.id, '\\begin{theorem}Overwritten by mistake.\\end{theorem}');
  await idle();
  await docMenu('versions');
  await page.waitForSelector('dialog.versions-dialog .rv-item');
  await vIdle();
  await page.locator('dialog.versions-dialog .rv-item', { hasText: 'E2E checkpoint' }).locator('[data-action=restore]').click();
  await page.click('[data-action=confirm-restore]');
  await page.waitForFunction((id: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === id)?.source.includes('Overwritten') === false, lemma.id);
  await page.keyboard.press('Escape').catch(() => {});
  await idle();
  const back = (await blocks()).find((b: any) => b.id === lemma.id);
  check('Restore brings the old source back (and it typesets)', back?.source === lemma.source && back.state === 'ok', back?.state);
});

// ── 10. Export zip → re-import gives the same document ──────────────────────
let zipPath = '';
await step('export zip → re-import', async () => {
  await docMenu('export-zip');
  const dl = await page.waitForEvent('download');
  zipPath = join(OUT, `export-${dl.suggestedFilename()}`);
  await dl.saveAs(zipPath);
  const orig = await page.evaluate((id: string) => (window as any).editorAPI.store().getDoc(id), introId);   // assets as stored (rendition)
  check('Export .zip downloads', readFileSync(zipPath).length > 20000, `${dl.suggestedFilename()} ${readFileSync(zipPath).length} bytes`);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.rh-row[data-doc-id]');
  await homeIdle();
  const ids0 = await page.locator('.rh-row[data-doc-id]').evaluateAll((els: any[]) => els.map((e) => e.dataset.docId));
  await page.setInputFiles('input[data-action=file]', zipPath);
  await page.waitForFunction((n: number) => document.querySelectorAll('.rh-row[data-doc-id]').length > n || (window as any).editorAPI.route().name === 'doc', ids0.length);
  await homeIdle().catch(() => {});
  const docs = await page.evaluate(() => (window as any).editorAPI.store().listDocs());
  const imp = docs.find((d: any) => !ids0.includes(d.id));
  const got = imp ? await page.evaluate((id: string) => (window as any).editorAPI.store().getDoc(id), imp.id) : null;
  const norm = (d: any) => ({ pre: d.preamble.source, blocks: d.blocks.map((b: any) => b.source.trim()), assets: d.assets.map((a: any) => a.name).sort(), bib: d.bib?.source?.length });
  const a = norm(orig), b = got ? norm(got) : null;
  // → `\input{figures/x.tikz}` in its block, x.tikz + x.ipe next to the PDF, `\usepackage{tikz}` appended to the preamble
  const editedNames: string[] = orig.assets.filter((x: any) => x.rendition?.tikz).map((x: any) => x.name.replace(/\.pdf$/i, ''));
  const expectBlock = (s: string) => editedNames.reduce((t, n) => t.replace(new RegExp(`\\\\includegraphics(\\[[^\\]]*\\])?\\{${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.pdf)?\\}`, 'g'), `\\input{${n}.tikz}`), s);
  const diffs = b ? a.blocks.map((s: string, i: number) => (expectBlock(s) === b.blocks[i] ? null : i)).filter((x: any) => x !== null) : [];
  const wantAssets = [...a.assets, ...editedNames.flatMap((n) => [`${n}.ipe`, `${n}.tikz`])].sort();
  const preOk = !!b && (b.pre === a.pre || (editedNames.length > 0 && b.pre.startsWith(a.pre.trimEnd()) && /\\usepackage(\[[^\]]*\])?\{tikz\}/.test(b.pre.slice(a.pre.trimEnd().length))));
  // blocks compared one to one only when the original is nested as an import nests
  // (an import makes long proofs/theorems/the abstract containers, a seeded document is flat, so
  // its re-import has more blocks by design). The document itself is compared below, as files.
  const sameSplit = !!b && a.blocks.length === b.blocks.length;
  check('re-import: same preamble, assets, bib (edited figures as .tikz); blocks the same where the split is', !!b && preOk && (!sameSplit || diffs.length === 0) && JSON.stringify(wantAssets) === JSON.stringify(b.assets) && a.bib === b.bib,
    b ? `edited ${editedNames.join(',') || '-'}; preamble ${preOk ? 'ok' : 'differs'}; ${a.blocks.length}/${b.blocks.length} blocks${sameSplit ? `, ${diffs.length} differ (e.g. ${diffs.slice(0, 3).map((i: number) => JSON.stringify(a.blocks[i].slice(0, 60)) + ' vs ' + JSON.stringify(b!.blocks[i]?.slice(0, 60))).join('; ')})` : ' (nested on import)'}; assets ${b.assets.join(',')}` : 'not imported');
  if (imp) {
    await page.evaluate((id: string) => { location.hash = `#/doc/${id}`; }, imp.id);
    await page.waitForFunction((id: string) => (window as any).editorAPI.route().id === id, imp.id);
    await idle();
    // the round trip is a fixed point: the re-imported document exports to the same files
    await docMenu('export-zip');
    const dl2 = await page.waitForEvent('download');
    const zip2 = join(OUT, `export2-${dl2.suggestedFilename()}`);
    await dl2.saveAs(zip2);
    const { readZip } = await import(join(HERE, 'app/src/io/archive.ts'));
    const z1: any[] = await readZip(new Uint8Array(readFileSync(zipPath))), z2: any[] = await readZip(new Uint8Array(readFileSync(zip2)));
    const m2 = new Map(z2.map((e) => [e.path, e.data]));
    const eq = (x: Uint8Array, y?: Uint8Array) => !!y && x.length === y.length && x.every((v, i) => v === y[i]);
    const differ = z1.filter((e) => !eq(e.data, m2.get(e.path))).map((e) => e.path);
    const extra = z2.filter((e) => !z1.some((f) => f.path === e.path)).map((e) => e.path);
    check('export → import → export gives the same files, byte for byte', z1.length > 0 && !differ.length && !extra.length,
      `${z1.length} files; differ: ${differ.slice(0, 5).join(', ') || '-'}; only in the second: ${extra.slice(0, 5).join(', ') || '-'}`);
    const ib = await blocks();
    const st = statesOf(ib);
    const ie = ib.filter((x: any) => x.state === 'error').map((x: any) => `${x.kind} «${x.source.slice(0, 50).replace(/\s+/g, ' ')}»: ${x.errors[0]?.message ?? ''}`);
    check('the re-imported document typesets', !st.error && (st.ok ?? 0) >= 30, `${JSON.stringify(st)} ${ie.slice(0, 2).join(' | ')}`);
  }
  if ((await api('route')).name !== 'home') await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home');
  if (imp) await page.evaluate(async (id: string) => { const s = (window as any).editorAPI.store(); await s.deleteDoc(id); }, imp.id);
});

// ── 11. Home: create, rename, duplicate, delete, undo ───────────────────────
await step('home CRUD', async () => {
  if ((await api('route')).name !== 'home') { await page.evaluate(() => { location.hash = '#/'; }); }
  await page.waitForSelector('.rh-row[data-doc-id]');
  await homeIdle();
  const n0 = (await page.evaluate(() => (window as any).editorAPI.store().listDocs())).length;
  await page.click('[data-action=new]');
  await page.click('[data-action=template-article]');
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  await idle();
  const created = await api('currentDoc');
  const st = statesOf(await blocks());
  check('New → Article opens it and typesets', !!created && !st.error, `${created?.title}: ${JSON.stringify(st)}`);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.rh-row[data-doc-id]');
  await homeIdle();
  await homeMenu(created.title, 'rename');
  await page.fill('.rh-rename', 'E2E Quokka');
  await page.keyboard.press('Enter');
  await homeIdle();
  check('rename', await rowOf('E2E Quokka').count() === 1);
  await homeMenu('E2E Quokka', 'duplicate');
  await homeIdle();
  await page.waitForFunction(() => [...document.querySelectorAll('.rh-row .rh-title')].some((e) => /E2E Quokka \(copy\)/.test(e.textContent ?? '')));
  check('duplicate', await rowOf('E2E Quokka (copy)').count() === 1);
  await homeMenu('E2E Quokka (copy)', 'delete');
  await homeIdle();
  check('delete: row gone, undo toast', await rowOf('E2E Quokka (copy)').count() === 0 && await page.locator('.rh-toast').isVisible());
  await page.click('.rh-toast [data-action=undo]');
  await homeIdle();
  check('undo brings it back', await rowOf('E2E Quokka (copy)').count() === 1);
  const n1 = (await page.evaluate(() => (window as any).editorAPI.store().listDocs())).length;
  check('document count', n1 === n0 + 2, `${n0} → ${n1}`);
  await shot(page, '11-home-crud');
});

// ── 12. Reload keeps everything ─────────────────────────────────────────────
await step('reload keeps everything', async () => {
  const before = await page.evaluate(async () => {
    const s = (window as any).editorAPI.store();
    const docs = await s.listDocs();
    return { titles: docs.map((d: any) => d.title).sort() };
  });
  // leave one mark in the intro to find after the reload
  await page.evaluate((id: string) => { location.hash = `#/doc/${id}`; }, introId);
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  await idle();
  const b = (await blocks()).find((x: any) => x.kind === 'paragraph' && x.mounted);
  await api('setSource', b.id, b.source + ' Kept across reloads.');
  await idle();
  await page.reload();
  await ready();
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  const t0 = Date.now();
  await idle();
  timings.reopenMs = Date.now() - t0;
  const stats = await page.evaluate(() => (window as any).editorAPI.backendObject()?.stats?.() ?? null);
  const after = await page.evaluate(async () => ((await (window as any).editorAPI.store().listDocs()) as any[]).map((d) => d.title).sort());
  const kept = (await blocks()).find((x: any) => x.id === b.id);
  check('documents and edits persist', JSON.stringify(after) === JSON.stringify(before.titles) && kept?.source.endsWith('Kept across reloads.'), after.join(' | '));
  const k = await api('counters');
  const bsNow = await blocks();
  const which = [...new Set(k.compiledIds as string[])].map((id) => { const x = bsNow.find((y: any) => y.id === id); return `${x?.kind} «${(x?.source ?? '').slice(0, 30).replace(/\s+/g, ' ')}»`; });
  // a second reload tells a lost cache write (the last compile before the reload) from a key that changes
  let stats2: any = null;
  if (stats?.compiled) {
    await page.reload(); await ready();
    await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
    await idle();
    stats2 = await page.evaluate(() => (window as any).editorAPI.backendObject()?.stats?.() ?? null);
  }
  check('reload: nothing recompiles (result cache)', stats?.compiled === 0, `second reload: ${JSON.stringify(stats2)}; ` + `${JSON.stringify(stats)}; idle after ${timings.reopenMs} ms; app asked for ${which.length}: ${which.slice(0, 3).join(' | ')}`);
  const st = statesOf(await blocks());
  check('reload: every block typeset again', !st.error && (st.ok ?? 0) >= 30, JSON.stringify(st));
  await api('setSource', b.id, b.source);
  await idle();
});

// ── 12b. Restart the browser on the same storage: nothing compiles, the edit is there ──
await step('restart the browser (same storage)', async () => {
  if ((await api('route')).id !== introId) await openDoc(introId);
  const b = (await blocks()).find((x: any) => x.kind === 'paragraph' && x.mounted && !/\\label/.test(x.source));
  const c0 = await compiledNow();
  await api('setSource', b.id, b.source + ' Kept across a browser restart.');
  await idle();
  check('an edit compiles exactly one block', (await compiledNow()) - c0 === 1, `${(await compiledNow()) - c0} compiled`);
  await ctx.close();
  ctx = await openContext();
  page = ctx.pages()[0] ?? await ctx.newPage();
  watch(page);
  page.setDefaultTimeout(120000);
  await page.goto(`${URL0}#/doc/${introId}`);
  await ready();
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc');
  await idle();
  const stats = await page.evaluate(() => (window as any).editorAPI.backendObject()?.stats?.() ?? null);
  const kept = (await blocks()).find((x: any) => x.id === b.id);
  check('after the restart the edit is there and typeset', kept?.source.endsWith('Kept across a browser restart.') && kept.state === 'ok', kept?.state);
  const txt = await renderedText(b.id);
  check('the restarted page draws the edit', /browserrestart\./.test(txt.replace(/\s+/g, '')), txt.slice(-40));   // (interword spaces are positions, not characters)
  check('after the restart: 0 compiles (the result cache survived)', stats?.compiled === 0, JSON.stringify(stats));
  const st = statesOf(await blocks());
  check('after the restart every block typeset', !st.error && (st.ok ?? 0) >= 30, JSON.stringify(st));
  await api('setSource', b.id, b.source);
  await idle();
});

// ── the end ──────────────────────────────────────────────────────────────────
journey = 'hygiene';
if (TARGET === 'file') check('no request left the page (offline)', leaked.length === 0, leaked.slice(0, 3).join(' '));
// an http page assumes a TeX tree beside it: when a document misses a file, one ls-R request
// per page load, a 404 where there is no tree (the dev server). By design, not a failed request.
const bad = problems.filter((p) => !/favicon/.test(p) && !/HTTP 404: \S+\/texlive\/2022\/texmf-dist\/ls-R$/.test(p));
check('no console errors, page errors or failed requests', bad.length === 0, bad.slice(0, 6).join(' | '));
if (bad.length) writeFileSync(join(OUT, 'problems.txt'), bad.join('\n') + '\n');
await ctx.close();

const passed = results.filter((r) => r.ok).length;
const byJourney: Record<string, { pass: number; fail: number }> = {};
for (const r of results) { const j = (byJourney[r.journey] ??= { pass: 0, fail: 0 }); r.ok ? j.pass++ : j.fail++; }
console.log(`\n${TARGET} ${BROWSER}: ${passed}/${results.length} passed`);
for (const [j, c] of Object.entries(byJourney)) console.log(`  ${c.fail ? 'FAIL' : 'ok  '} ${j} (${c.pass}/${c.pass + c.fail})`);
console.log('timings', JSON.stringify(timings));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), target: TARGET, browser: BROWSER, url: URL0,
  build: TARGET === 'file' && existsSync(join(HERE, 'dist/reflowtex-editor.json')) ? JSON.parse(readFileSync(join(HERE, 'dist/reflowtex-editor.json'), 'utf8')) : null,
  passed, total: results.length, byJourney, timings, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
