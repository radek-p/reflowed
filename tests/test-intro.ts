// The introduction to ReflowEd (samples/intro/), a default document of every build, in a fresh profile, in the dev app
// or the single file from file://:
//   - it is among the documents on Home (tagged intro), and it opens;
//   - every block typesets with no error, and every placeholder screenshot (figures/shot-*.png) is drawn from its bytes
//     (tests/qa/lib/intro-check.ts, which the release's acceptance runs too);
//   - its labels are numbered and its cross-references resolve (no unknown label or citation in refsState);
//   - the References panel lists its bibliography (refs.bib / refs.bbl): both entries;
//   - an edit and its undo;
//   - microtype is in force: the typeset fonts carry protrusion codes.
// Waits on editorAPI.whenIdle(), never on fixed times.
//
//   node tests/test-intro.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
import { harness } from './qa/lib/harness.ts';
import { introCheck, introProblems } from './qa/lib/intro-check.ts';

const argv = process.argv.slice(2);
const target = argv[0] === 'file' ? 'file' : 'dev';
const at = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const t = harness(`intro-${target}`);
const { ctx, page, errors } = await t.launch({ target, at });
page.setDefaultTimeout(300000);
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home' && document.querySelector('.rh-row[data-doc-id]'));
await page.evaluate(() => (window as any).editorAPI.homeIdle());
const rows = await page.evaluate(() => [...document.querySelectorAll('.rh-row[data-doc-id] .rh-title')].map((e) => e.textContent?.trim()));
t.check('Home lists the introduction among the samples', rows.includes('An Introduction to ReflowEd'), rows);
const r = await introCheck(page);
const probs = introProblems(r);
t.check(`it opens; ${r.n} blocks typeset with no error; its ${r.pictures.length} pictures drawn from their bytes`, !probs.length && r.pictures.length >= 7, probs.length ? probs : r.pictures.map((p) => p.file));
const refs = await page.evaluate(() => {
  const s = (window as any).editorAPI.refsState();
  const labels = Object.keys(s.labels ?? s.numbers ?? {});
  const diags = (s.diagnostics ?? []).filter((d: any) => !/unused/i.test(d.kind ?? d.message ?? ''));
  return { labels, diags: diags.map((d: any) => d.message ?? d.kind) };
});
t.check('labels numbered (the theorem, the equation, every figure); no unknown label or citation', ['thm:gauss', 'eq:gauss', 'fig:tikz', 'fig:shot-split-view', 'fig:shot-figure-editor'].every((l) => refs.labels.includes(l)) && !refs.diags.length, refs);
// the References panel: the intro's two entries (doc.bib, the .bbl from refs.bib)
const refRows = await page.evaluate(async () => { const b = (window as any).editorAPI.bibpane(); b.show(); await b.idle(); return [...document.querySelectorAll('li.bp-row')].map((e) => (e as HTMLElement).dataset.key).sort(); });
t.check('the References panel lists the intro\'s entries', JSON.stringify(refRows) === JSON.stringify(['knuth1984', 'lamport1994']), refRows);
// an edit and its undo
const blk = await page.evaluate(() => { const b = (window as any).editorAPI.blocks().find((x: any) => x.kind === 'paragraph' && x.source.length > 200); return { id: b.id, source: b.source }; });
await page.evaluate(async (id: string) => { const api = (window as any).editorAPI; const b = api.blocks().find((x: any) => x.id === id); api.setSource(id, `${b.source} An added sentence.`); await api.whenIdle(); }, blk.id);
const edited = await page.evaluate((id: string) => (window as any).editorAPI.blocks().find((x: any) => x.id === id), blk.id);
t.check('an edit typesets', edited.source.endsWith('An added sentence.') && edited.state === 'ok', { state: edited.state });
await page.evaluate(async () => { const api = (window as any).editorAPI; api.undo(); await api.whenIdle(); });
const back = await page.evaluate((id: string) => (window as any).editorAPI.blocks().find((x: any) => x.id === id), blk.id);
t.check('… and its undo gives the source back', back.source === blk.source && back.state === 'ok');
// microtype is in force (the intro loads it): its fonts carry protrusion codes, so punctuation hangs at the line ends
const protrusion = await page.evaluate(() => {
  const ins = (window as any).reflowtex?.inspect;
  if (!ins?.blocks) return { inspect: false, blocks: 0, withCodes: 0 };
  const els = ins.blocks().filter((b: Element) => b.matches('[data-nodelist-b64]'));
  const withCodes = els.filter((el: Element) => (ins.state(el)?.doc?.fonts ?? []).some((f: any) => (f.codes ?? []).some((c: any) => (c.rp ?? 0) > 0))).length;
  return { inspect: true, blocks: els.length, withCodes };
});
t.check('microtype in force: the typeset blocks\' fonts carry protrusion codes (punctuation hangs)', protrusion.inspect && protrusion.withCodes > 0, protrusion);
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
