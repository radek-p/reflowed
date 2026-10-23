// multi-paragraph theorems (tests/qa/fixtures/nested-doc.ts, imported in the page) opens with them as containers of
// paragraphs. (It ran on the former sample paper's seed, which also checked 0 compiles from the seed cache: the
// release's own document has no long environment; test-cache checks the seed cache.)
//
//   node tests/test-nested-seed.ts [dist/reflowtex-editor.html] [--per 3]
//
//   1. the document is imported and opens, every block typeset;
//   2. proofs and multi-paragraph environments are containers (nest()), each with ≥ 2 paragraphs;
//   3. every paragraph is typeset, drawn, and editable on its own (api.edit puts the caret in it);
//   4. lines: for each container, its paragraphs' lines equal the lines of the whole
//      environment compiled as one block in the same place (joined, then the join undone), at the
//      column's default width; the first difference is reported. Digits are masked (numbers the
//      overlay sets).
// Waits on whenIdle() and frames only.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';
import { NESTED_TEX, N_CONTAINERS, N_PROOFS } from './qa/fixtures/nested-doc.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const FILE = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : join(HERE, 'dist/reflowtex-editor.html'));
const OUT = join(resultsDir(HERE), 'nested-seed');
mkdirSync(OUT, { recursive: true });
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 900)}` : ''}`); if (!ok) fail++; };

const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-nest-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(900000);
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`file://${FILE}#/`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const api = (name: string, ...a: unknown[]) => page.evaluate(([nm, args]: [string, unknown[]]) => (window as any).editorAPI[nm](...args), [name, a] as [string, unknown[]]);

// 1. open
const compiled = () => page.evaluate(() => ((globalThis as any).__rtxEditor?.backends ?? []).reduce((s: number, b: any) => s + (b.stats?.().compiled ?? 0), 0));
const docId = await page.evaluate(async (tex: string) => {
  const a = (window as any).editorAPI;
  const init = await a.io().importFile({ name: 'main.tex', bytes: new TextEncoder().encode(tex) });
  const id = await a.store().createDoc(init);
  await a.open(id); await a.whenIdle();
  return id;
}, NESTED_TEX);
check('the document is imported and opens, every block typeset', !!docId && (await api('blocks') as any[]).every((b: any) => ['ok', 'marker', 'container'].includes(b.state)), { compiled: await compiled() });

// 2. containers
const nest: any[] = await api('nest') as any[];
const blocks: any[] = await api('blocks') as any[];
const kinds = nest.map((c) => c.kind);
check(`proofs and multi-paragraph environments are containers (${nest.length}: ${[...new Set(kinds)].join(', ')})`,
  nest.length === N_CONTAINERS && kinds.filter((k) => k === 'proof').length === N_PROOFS && nest.every((c) => c.children.length >= 2), nest.map((c) => `${c.kind}:${c.children.length}`));
const kids = blocks.filter((b) => b.parentId);
check(`paragraphs of containers: ${kids.length}, top-level blocks ${blocks.filter((b) => !b.parentId).length}`, kids.length === nest.reduce((s, c) => s + c.children.length, 0) && kids.length >= 2 * nest.length);

// 3. every paragraph typeset, drawn, editable
// a paragraph of only a comment or definitions is a marker: TeX typesets nothing for it (by design)
const notOk = kids.filter((b) => b.state !== 'marker' && (b.state !== 'ok' || !b.mounted)).map((b) => `${b.id.slice(-6)}: ${b.state}${b.mounted ? '' : ' (not mounted)'}`);
check('every paragraph of a container is typeset and drawn', notOk.length === 0, notOk.slice(0, 6));
const notEditable: string[] = [];
for (const k of kids) {
  await page.evaluate((i: string) => { document.querySelector(`.blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }); (window as any).editorAPI.edit(i, 0); }, k.id);
  await idle();
  const c: any = await api('caret');
  if (c?.id !== k.id || c.offset !== 0) notEditable.push(`${k.id.slice(-6)}: caret ${c ? `${c.id.slice(-6)}@${c.offset}` : 'none'}`);
  await api('leave'); await idle();
}
check(`every paragraph is editable on its own (${kids.length})`, notEditable.length === 0, notEditable.slice(0, 6));

// 4. lines: the paragraphs against the whole environment
const linesNow = (id: string) => page.evaluate((i: string) => {
  const blk = document.querySelector(`.blk[data-id="${i}"] .blk-render .latex-block`);
  if (!blk) return null;
  const out: { text: string; display: boolean }[] = [];
  for (const s of blk.querySelectorAll('svg')) {
    const ts = [...s.querySelectorAll(':scope > text > tspan, :scope > g text > tspan')].map((t, k) => ({ k, y: Number(t.getAttribute('y')), fs: Number(t.getAttribute('font-size') || 10), text: t.textContent ?? '' }));
    const lines: { y0: number; fs: number; items: typeof ts }[] = [];
    for (const t of [...ts].sort((a, b) => a.y - b.y || a.k - b.k)) {
      const cur = lines[lines.length - 1];
      if (cur && t.y - cur.y0 <= 0.8 * Math.max(cur.fs, t.fs)) { cur.items.push(t); cur.fs = Math.max(cur.fs, t.fs); } else lines.push({ y0: t.y, fs: t.fs, items: [t] });
    }
    for (const l of lines) out.push({ text: l.items.sort((a, b) => a.k - b.k).map((t) => t.text).join('').replace(/\s+/g, ' ').trim(), display: !!s.closest('.latex-display') });
  }
  return out;
}, id);
/** a block's lines, all of it drawn: a viewport taller than the block */
async function linesOf(id: string) {
  const h: number = await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)?.getBoundingClientRect().height ?? 0, id);
  await page.setViewportSize({ width: 1280, height: Math.max(900, Math.ceil(h + 300)) });
  await page.evaluate((i: string) => { const el = document.querySelector(`.blk[data-id="${i}"]`)!; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100); }, id);
  await frames(); await idle(); await page.evaluate(() => (window as any).reflowtex?.inspect?.idle?.()); await frames();
  const l = (await linesNow(id)) ?? [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await idle();
  return l;
}
const mask = (ls: { text: string; display: boolean }[]) => ls.filter((l) => !l.display).map((l) => l.text.replace(/[\d-]/g, '#'));
const report: Record<string, unknown> = {};
for (const c of nest) {
  const ch = (await api('blocks') as any[]).filter((b) => b.parentId === c.id);
  const kl: { text: string; display: boolean }[] = [];
  for (const k of ch) kl.push(...await linesOf(k.id));
  await api('nestJoin', c.id); await idle();
  const wl = await linesOf(c.id);
  await api('undo'); await idle();
  const a = mask(kl), b = mask(wl);
  const d = a.findIndex((x, k) => x !== b[k]);
  const eq = a.length === b.length && d < 0;
  report[c.id] = { kind: c.kind, children: ch.length, lines: [a.length, b.length], firstDiff: eq ? null : d, a: eq ? undefined : a, b: eq ? undefined : b };
  check(`${c.kind} ${c.id.slice(-6)} (${ch.length} paragraphs): lines as the whole environment's (${b.length})`, eq && b.length > 0,
    eq ? '' : `paragraphs ${a.length} lines, whole ${b.length}; first difference at ${d}: «${a[d]}» vs «${b[d]}»`);
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(report, null, 1));
const after: any[] = await api('nest') as any[];
check('every container is back after the joins were undone', after.length === nest.length, after.length);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
