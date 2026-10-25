// Fonts in the single file: finished blocks do not flicker while others typeset. The cause was font swaps: a
// font patched again for a later block's glyphs took effect as a new @font-face rule before its file
// had loaded, so every block drawn with that family went blank (the block period) or to a stand-in. Now a font is
// patched whole, once, and the viewer replaces a face only once its new file has loaded.
// The single file on the intro with its seed cache dropped (every block compiles, fonts are
// patched block by block):
//   1. no face of a family already on screen is in the document's font set before it has loaded (its
//      text would be blank or a stand-in until it loads), sampled every frame and at every load event;
//   2. no font failed, and a font's face was replaced at most once (a font is patched whole, once: one that needed
//      no patch at first may gain its private-use entries later; backend stats);
//   3. at the end every font face is loaded and the page's text is drawn by its own fonts;
//   4. (the reported case) the abstract, once drawn in its final form, is never redrawn, hidden or swapped for
//      another drawing while the later blocks typeset (sampled every frame: its drawing's element, opacity,
//      visibility, height and number of text nodes).
//
//   node tests/test-fonts.ts [dist/reflowtex-editor.html] [--browser chromium]
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const FILE = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : join(HERE, 'dist/reflowtex-editor.html'));
const BROWSER = argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1] : 'chromium';
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { const d = typeof detail === 'string' ? detail : JSON.stringify(detail); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 600)}` : ''}`); if (!ok) fail++; };

const dir = mkdtempSync(join(tmpdir(), 'rtx-fonts-'));
const ctx = await pw[BROWSER].launchPersistentContext(dir, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
await ctx.addInitScript(() => {
  // every block compiles: the release's seed cache dropped
  Object.defineProperty(globalThis, '__rtxEditor', { configurable: true, get() { return undefined; },
    set(v: any) { if (v) v.seedCache = null; Object.defineProperty(globalThis, '__rtxEditor', { value: v, writable: true, configurable: true }); } });
  const w = globalThis as any;
  w.__fontLog = { loaded: new Set<string>(), blankings: [] as string[], loads: 0 };
  const hook = () => {
    if (!document.fonts) return;
    // a face of a family that already has a loaded face, in the document's set but not loaded yet: if it is
    // the family's newest face (a patch as a CSS rule), the family's text is blank or a stand-in until it
    // loads. Sampled every frame and at every load event. (Chromium re-reports already loaded faces in
    // 'loadingdone' when a style sheet changes, so those events alone cannot tell a reload.)
    const fam = (f: any) => String(f.family).replace(/^["']|["']$/g, '');
    const seen = new WeakSet<object>();
    const sample = () => {
      for (const f of document.fonts as any) {
        const name = fam(f);
        if (f.status === 'loaded') { w.__fontLog.loaded.add(name); continue; }
        if (f.status === 'error' || !w.__fontLog.loaded.has(name) || seen.has(f)) continue;
        seen.add(f); w.__fontLog.blankings.push(name);
      }
    };
    document.fonts.addEventListener('loading', sample);
    document.fonts.addEventListener('loadingdone', (e: any) => { w.__fontLog.loads += e.fontfaces?.length ?? 0; sample(); });
    // the abstract's drawing, every frame
    // (a container's paragraphs, each on its own)
    w.__abstract = {} as Record<string, string[]>;
    let absIds: string[] | null = null, n = 0;
    const abstract = () => {
      if (!absIds) {
        const bs = w.editorAPI?.blocks?.() ?? [], a = bs.find((b: any) => b.kind === 'abstract');
        if (!a) return;
        absIds = a.container ? bs.filter((b: any) => b.parentId === a.id).map((b: any) => b.id) : [a.id];
      }
      for (const id of absIds!) {
        const r = document.querySelector(`.blk[data-id="${id}"] .blk-render`);
        const el = r && [...r.querySelectorAll(':scope > .latex-block')].find((e: any) => !e.classList.contains('incoming')) as any;
        if (!el) continue;
        el.__k ??= ++n;
        const cs = getComputedStyle(el), log = (w.__abstract[id] ??= []);
        const state = `drawing ${el.__k}, opacity ${cs.opacity}, ${cs.visibility}, ${Math.round(el.getBoundingClientRect().height)} px, ${el.querySelectorAll('text, tspan').length} text nodes`;
        if (log[log.length - 1] !== state) log.push(state);
      }
    };
    const tick = () => { sample(); abstract(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
});
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(900000);
await page.goto(`file://${FILE}#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
await page.evaluate(() => { location.hash = '#/doc/intro'; });
await page.waitForFunction(() => (window as any).editorAPI.route().name === 'doc' && (window as any).editorAPI.currentDoc());
await page.evaluate(() => (window as any).editorAPI.whenIdle());
const r: any = await page.evaluate(() => {
  const w = window as any, be = w.editorAPI.backendObject?.();
  const faces = [...document.fonts];
  return { abstract: w.__abstract, blankings: w.__fontLog.blankings, loads: w.__fontLog.loads, families: w.__fontLog.loaded.size, stats: be?.stats?.(),
    notLoaded: faces.filter((f) => f.status !== 'loaded' && f.status !== 'unloaded').map((f) => `${f.family}:${f.status}`), errors: faces.filter((f) => f.status === 'error').length };
});
check('no family already on screen goes blank while later blocks typeset (a face of it starting to load)', r.blankings.length === 0, r.blankings.length ? `${r.blankings.length}: ${[...new Set(r.blankings)].slice(0, 8).join(', ')}` : `${r.loads} face loads, ${r.families} families`);
check('no font failed; a font\'s face replaced at most once (patched whole, once)', (r.stats?.fontFailures ?? 0) === 0 && (r.stats?.fontSwapsPerFont ?? 0) <= 1, r.stats);
check('at the end no face is loading or failed', r.notLoaded.length === 0 && r.errors === 0, r);
// from the first frame in its final form on, the abstract's drawing does not change
{
  const logs = Object.entries(r.abstract ?? {}) as [string, string[]][];
  const bad = logs.filter(([, st]) => { const last = st[st.length - 1]; return st.indexOf(last) !== st.length - 1 || !/opacity 1, visible/.test(last); });
  check(`the abstract (${logs.length} paragraphs), once drawn in its final form, is not redrawn, hidden or swapped while the later blocks typeset (every frame)`,
    logs.length > 0 && bad.length === 0, bad.length ? bad.slice(0, 2).map(([id, st]) => `${id.slice(-6)}: ${st.join(' → ')}`).join(' | ') : logs.map(([id, st]) => `${id.slice(-6)}: ${st.length > 1 ? st.join(" → ") : st.length + " state"}`).join(', '));
}
await ctx.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${4 - fail}/4 passed`);
process.exit(fail ? 1 : 0);
