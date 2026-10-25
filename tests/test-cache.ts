// The result cache across reloads and files: what is typeset once is not typeset again.
//
//   node tests/test-cache.ts [dist/reflowtex-editor.html] [--doc intro] [--browser chromium]
//
// On the single file from file://, one browser profile (so one IndexedDB: the store and its result
// cache) through every step:
//   1. open the document: 0 compiles (the file's seed cache);
//   2. edit one paragraph: exactly that block compiles; the blocks whose context changed with the edit
//      (refs/numbering) are reported (context churn) and must be ones the edit can affect;
//   3. reload the page and open the document again: 0 compiles (the edited block from IndexedDB, the
//      rest from the seed);
//   4. a second copy of the file (another path, the same engine): the document opens with 0 compiles;
//   5. edit the preamble: every block that typesets compiles again.
// Compiles are counted by the backends' own counters (stats().compiled: real engine runs, not hits).
// Waits on editorAPI.whenIdle() only.
import { createRequire } from 'node:module';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const FILE = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : join(HERE, 'dist/reflowtex-editor.html'));
const DOC = flag('--doc') ?? 'intro';
const BROWSER = flag('--browser') ?? 'chromium';
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 900)}` : ''}`); if (!ok) fail++; };

const dir = mkdtempSync(join(tmpdir(), 'rtx-cache-'));
const second = join(dir, 'second-copy.html');
copyFileSync(FILE, second);
const ctx = await pw[BROWSER].launchPersistentContext(join(dir, 'profile'), { viewport: { width: 1280, height: 900 } });
await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(300000);   // a wait (not an evaluate): the suite's own limit (tests/suites.ts) covers the rest
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));

/** compiles so far, over every backend of the page (their counters start at 0 with the page) */
const compiled = () => page.evaluate(() => ((globalThis as any).__rtxEditor?.backends ?? []).reduce((a: number, b: any) => a + (b.stats?.().compiled ?? 0), 0));
/** the counters summed over the backends */
const sums = () => page.evaluate(() => { const o: Record<string, number> = {}; for (const b of (globalThis as any).__rtxEditor?.backends ?? []) for (const [k, v] of Object.entries(b.stats?.() ?? {})) if (typeof v === 'number') o[k] = (o[k] ?? 0) + v; return o; });
const stats = () => page.evaluate(() => ((globalThis as any).__rtxEditor?.backends ?? []).map((b: any) => b.stats?.()));
/** a real page load (a goto that changes only the hash would keep the page and its memory), on the home view:
 *  ?fresh, the default layout (a reload otherwise restores the last layout, its document's tab open and shown) */
async function load(file: string) {
  await page.goto('about:blank');
  await page.goto(`file://${file}?fresh#/`);
  await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
  await page.evaluate(() => (window as any).editorAPI.homeIdle?.());
}
/** open a document on a freshly loaded page: the compiles since the page loaded (home screen included) */
async function open(id: string) {
  await page.evaluate(async (i: string) => { const api = (window as any).editorAPI; await api.open(i); await api.whenIdle(); }, id);
  return compiled();
}
const contexts = () => page.evaluate(() => (window as any).editorAPI.contexts() as Record<string, string>);

// 1. the seeded document
await load(FILE);
const c1 = await open(DOC);
check(`open «${DOC}»: 0 compiles (seed cache)`, c1 === 0, { compiled: c1, stats: await stats() });

// 2. one paragraph edited
const target: any = await page.evaluate(() => {
  const bs = (window as any).editorAPI.blocks();
  // a paragraph of words in the middle of the document: no label, no heading, no command at its start
  const ok = bs.filter((b: any) => b.state === 'ok' && b.mounted && !b.container && /^[A-Z][a-z]+ [a-z]+ [a-z]+/.test(b.source) && !/\\label|\\section|\\cite/.test(b.source) && b.source.length > 200);
  return ok[Math.floor(ok.length / 2)] ?? null;
});
check('a plain paragraph to edit', !!target);
if (!target) process.exit(1);
const edited = target.source.replace(/\.\s*$/, '') + ' (an edit).';
const ctxBefore = await contexts();
const c2 = await page.evaluate(async ([id, s]: string[]) => {
  const api = (window as any).editorAPI, bes = (globalThis as any).__rtxEditor?.backends ?? [];
  const before = bes.reduce((a: number, b: any) => a + b.stats().compiled, 0);
  api.setSource(id, s);
  await api.whenIdle();
  return bes.reduce((a: number, b: any) => a + b.stats().compiled, 0) - before;
}, [target.id, edited]);
const ctxAfter = await contexts();
const churn = Object.keys({ ...ctxBefore, ...ctxAfter }).filter((id) => id !== target.id && ctxBefore[id] !== ctxAfter[id]);
check('edit one paragraph: exactly that block compiles', c2 === 1, { compiled: c2, churn: churn.length });
check('edit one paragraph: no other block\'s context changes (no context churn)', churn.length === 0, churn.slice(0, 5).map((id) => {
  const a = ctxBefore[id] ?? '', b = ctxAfter[id] ?? '';
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return `${id}: …${JSON.stringify(a.slice(Math.max(0, i - 40), i + 60))} → ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 60))}`;
}).join(' | '));
const blockStateAfterEdit = await page.evaluate((id: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === id)?.source, target.id);
check('the edit is in the document', blockStateAfterEdit === edited);

// 2b. a section's title renamed (its number and label unchanged): only blocks that print the title
// (\nameref, a ToC) may change; the numbering contexts of the blocks after it must not
const heading: any = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => /^\\(sub)*section\{[^}]+\}/.test(b.source) && b.state === 'ok') ?? null);
if (heading) {
  const renamed = heading.source.replace(/^(\\(?:sub)*section\{)([^}]+)\}/, '$1$2 renamed}');
  const hb = await contexts();
  const ch = await page.evaluate(async ([id, s]: string[]) => {
    const api = (window as any).editorAPI, bes = (globalThis as any).__rtxEditor?.backends ?? [];
    const before = bes.reduce((a: number, b: any) => a + b.stats().compiled, 0);
    api.setSource(id, s);
    await api.whenIdle();
    return bes.reduce((a: number, b: any) => a + b.stats().compiled, 0) - before;
  }, [heading.id, renamed]);
  const ha = await contexts();
  const hchurn = Object.keys({ ...hb, ...ha }).filter((id) => id !== heading.id && hb[id] !== ha[id]);
  const cites = await page.evaluate((ids: string[]) => (window as any).editorAPI.blocks().filter((b: any) => ids.includes(b.id) && !/\\(name|auto|c)?ref|\\tableofcontents/.test(b.source)).map((b: any) => b.id), hchurn);
  check(`rename a section title: the heading compiles, and only blocks that refer to it (${ch} compiles, ${hchurn.length} contexts changed)`, ch === 1 + hchurn.length && cites.length === 0,
    cites.length ? `contexts changed in blocks with no reference: ${cites.slice(0, 5).join(', ')}` : { compiled: ch, churn: hchurn.length });
  await page.evaluate(async ([id, s]: string[]) => { const api = (window as any).editorAPI; api.setSource(id, s); await api.whenIdle(); }, [heading.id, heading.source]);
}

// 3. reload: the edited block from IndexedDB
await load(FILE);
const c3 = await open(DOC);
const kept = await page.evaluate((id: string) => (window as any).editorAPI.blocks().find((b: any) => b.id === id)?.source, target.id);
check('after a reload the edit is kept', kept === edited);
check('after a reload the document opens with 0 compiles (the edited block from IndexedDB)', c3 === 0, { compiled: c3, stats: await stats() });

// 4. another copy of the file, the same engine
await load(second);
const c4 = await open(DOC);
check('a second copy of the file (another path): the document opens with 0 compiles', c4 === 0, { compiled: c4, stats: await stats() });

// 5. the preamble edited: everything again
// the blocks the engine typesets: every block but markers (comments, definitions), containers, recalls and empty ones.
// (Not the hits at open: a block asked for twice while the document opens, in view and then in the background,
// counts two memory hits for one block: 12 of the 205 on the former sample paper.)
const s0 = await sums();
const typesetting = await page.evaluate(() => {
  const api = (window as any).editorAPI, cx = api.contexts();
  const rec = (id: string) => !!document.querySelector('.blk[data-id="' + id + '"]')?.hasAttribute('data-recall');   // a recall (thm-restate) shows its original's render
  // two blocks with the same source and context (\\bigskip twice) are one compile
  return new Set(api.blocks().filter((b: any) => !b.container && b.state !== 'marker' && b.state !== 'empty' && b.source.trim() && !rec(b.id)).map((b: any) => (cx[b.id] ?? '') + '\u0000' + b.source)).size;
});
await page.evaluate(async () => {
  const api = (window as any).editorAPI;
  api.setPreamble(`${api.currentDoc().preamble.source}\n\\newcommand\\rtxCacheProbe{}`);
  await api.whenIdle();
});
const s1 = await sums(), d = (k: string) => (s1[k] ?? 0) - (s0[k] ?? 0);
// every block that typesets is compiled again or (two blocks with the same source and context) shares a
// result compiled in this run; none comes from a cache made under the old preamble
check(`edit the preamble: every block that typesets is typeset again (${typesetting})`, d('compiled') > 0 && d('compiled') + d('memHits') >= typesetting && d('seedHits') === 0 && d('cacheHits') === 0,
  { compiled: d('compiled'), memHits: d('memHits'), seedHits: d('seedHits'), cacheHits: d('cacheHits'), typesetting });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await ctx.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
