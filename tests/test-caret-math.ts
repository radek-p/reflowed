// a click on a glyph of a formula puts the code caret at that glyph's own source,
// also where glyphs are stacked (a binomial's lower entry under the upper one, a fraction, scripts,
// limits). Every glyph of \binom{x}{2}, \frac{a}{b}, x_i^2 and \sum_{i=1}^n, inline and displayed.
//
//   node tests/test-caret-math.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
//
// A fresh document with one paragraph (the formulas inline) and one display. For each block: enter
// it (api.edit), take every glyph the viewer draws (inspect.replay: its character and box, the
// viewer's own geometry, not the caret map) whose character is written in the source exactly once
// (x, 2, a, b, i, n, 1, =; ∑ is \sum), click a third of the way into it at its ink's middle height, and
// check the editor's caret: before that character in the source (the click is in its left half).
// Waits on editorAPI.whenIdle() and frames only.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const TARGET = argv[0] === 'file' ? 'file' : 'dev';
const pos = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const URL0 = TARGET === 'file' ? `file://${pos ?? join(HERE, 'dist/reflowtex-editor.html')}` : `${(pos ?? 'http://localhost:8150/').replace(/\/?$/, '/')}?engine`;
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 900)}` : ''}`); if (!ok) fail++; };

// each formula alone in its block, so every character below is written once in that block's source
const FORMULAS = ['\\binom{x}{2}', '\\frac{a}{b}', 'x_i^2', '\\sum_{i=1}^n'];
const BLOCKS = [
  ...FORMULAS.map((f) => `Our $${f}$ holds.`),   // inline in a line of text; the words share no letter with the formulas
  ...FORMULAS.map((f) => `\\[ ${f} \\]`),
];

const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-cm-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
if (TARGET === 'file') await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(600000);
await page.goto(`${URL0}#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
const id: string = await page.evaluate(async (blocks: string[]) => {
  const st = (window as any).editorAPI.store();
  return st.createDoc({ title: 'Caret in formulas', preamble: '\\documentclass{article}\n\\usepackage{amsmath}', blocks: blocks.map((source) => ({ source })) });
}, BLOCKS);
await page.evaluate((i: string) => { location.hash = `#/doc/${i}`; }, id);
await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && (window as any).editorAPI.currentDoc());
await page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const blocks: any[] = await page.evaluate(() => (window as any).editorAPI.blocks().map((b: any) => ({ id: b.id, source: b.source, state: b.state })));
for (const b of blocks) {
  await page.evaluate((i: string) => { document.querySelector(`.blk[data-id="${i}"]`)!.scrollIntoView({ block: 'center' }); (window as any).editorAPI.edit(i, 0); }, b.id);
  await page.evaluate(() => (window as any).editorAPI.whenIdle()); await frames();
  // the glyphs as the viewer draws them: character, and a screen box from its advance and the font's size
  const glyphs = async () => page.evaluate((i: string) => {
    const el = [...document.querySelectorAll(`.blk[data-id="${i}"] .blk-render > .latex-block`)].find((e) => !e.classList.contains('incoming'))!;
    const ins = (window as any).reflowtex.inspect, st = ins.state(el);
    const size = new Map((st.doc.fonts ?? []).map((f: any) => [f.id, (f.size_sp || 655360) * ins.spToPx]));
    const gm = st.doc.glyph_metrics ?? [];
    const out: any[] = [];
    (st.cache.layout?.laid ?? []).forEach((_L: any, s: number) => {
      const m = st.cache.dom.segs[s]?.svg?.getScreenCTM();
      if (!m) return;
      ins.replay(el, s, { node(nd: any, x: number, y: number, adv: number) {
        if (nd.type !== 'glyph') return;
        const g = gm[(nd.metrics || 0) - 1] ?? {}, sz = size.get(nd.font) as number ?? 10;
        const h = (nd.height ?? g.height ?? 0) * ins.spToPx, d = (nd.depth ?? g.depth ?? 0) * ins.spToPx;
        const p0 = new DOMPoint(x, y - Math.max(h, 0.3 * sz)).matrixTransform(m), p1 = new DOMPoint(x + Math.max(adv, 0.3 * sz), y + d).matrixTransform(m);
        out.push({ ch: String.fromCodePoint(nd.char || 32), l: p0.x, r: p1.x, t: p0.y, b: p1.y });
      } });
    });
    return out;
  }, b.id);
  const gs = await glyphs();
  const src: string = b.source;
  // the characters of the formula (not of a control word, not of the words around it) and where each
  // is written: the ones written once are checked
  const f0 = FORMULAS.map((f) => src.indexOf(f)).find((x) => x >= 0) ?? -1;
  const form = FORMULAS.find((f) => src.indexOf(f) >= 0) ?? '';
  const at = new Map<string, number[]>();
  for (let i = f0; i >= 0 && i < f0 + form.length; i++) {
    const w = /^\\[A-Za-z]+/.exec(src.slice(i));
    if (w) { i += w[0].length - 1; continue; }
    if (/[A-Za-z0-9=]/.test(src[i])) at.set(src[i], [...(at.get(src[i]) ?? []), i]);
  }
  const wrong: string[] = [];
  let tried = 0;
  for (let k = 0; k < gs.length; k++) {
    const g = gs[k];
    const want = g.ch === '∑' ? src.indexOf('\\sum') : (at.get(g.ch)?.length === 1 ? at.get(g.ch)![0] : -1);
    if (want < 0) continue;
    const cur = (await glyphs())[k] ?? g;                         // where it is now (entering edit may move the block)
    tried++;
    await page.mouse.click(cur.l + (cur.r - cur.l) / 3, (cur.t + cur.b) / 2);
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
    const got: any = await page.evaluate(() => (window as any).editorAPI.caret());
    if (got?.id !== b.id || got.offset !== want) wrong.push(`«${g.ch}» want ${want} (${JSON.stringify(src.slice(want, want + 4))}) got ${got?.id === b.id ? `${got.offset} (${JSON.stringify(src.slice(got.offset, got.offset + 4))})` : 'another block'}`);
  }
  check(`${JSON.stringify(src)}: every glyph clicked puts the code caret at its own character (${tried} glyphs)`, tried >= 2 && wrong.length === 0, wrong.join(' | '));
  await page.evaluate(() => (window as any).editorAPI.leave());
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
}
await page.evaluate(async (i: string) => { location.hash = '#/'; await (window as any).editorAPI.store().deleteDoc(i); }, id);
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
