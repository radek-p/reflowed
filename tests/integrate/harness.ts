// The harness the sections of tests/test-integrate.ts share: one browser, a page opened on the
// workbench (the fixture document, or a hash), the editors' idle, the workbench's state, the document tabs, a second
// small document, and the checks' log. A section is a file of tests/integrate/ whose default export takes it.
//
//   const h = await createHarness(argv)    { HERE, BASE, OUT, Q, browser, problems, results, check, section,
//                                            open, idle, state, docTabs, makeDoc }
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from '../qa/lib/results.ts';

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createHarness(argv: string[]) {
  const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
  const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8151/';
  const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]!) : null;
  const OUT = join(resultsDir(HERE), 'integrate');
  mkdirSync(OUT, { recursive: true });
  const section = (name: string) => !ONLY || ONLY.test(name);
  const results: { name: string; ok: boolean; detail?: string }[] = [];
  function check(name: string, ok: boolean, detail: unknown = '') {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    results.push({ name, ok, detail: d });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d.slice(0, 600)}` : ''}`);
  }
  const browser = await chromium.launch();
  const problems: string[] = [];
  const Q = '?seed=sample&engine';
  const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
  async function open(hash = '#/doc/sample', { width = 1500, height = 900, fresh = true, ctx: given = null as any } = {}) {
    const ctx = given ?? await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.setDefaultTimeout(240000);
    await page.goto(`${BASE}${Q}${fresh ? '&fresh' : ''}${hash}`);
    await page.waitForFunction(() => (window as any).editorAPI?.workbench);
    await idle(page);
    return { ctx, page };
  }
  const state = (page: any) => page.evaluate(() => {
    const E = (window as any).editorAPI, wb = E.workbench();
    const groups = [...wb.layout.peek().root ? document.querySelectorAll('.wb-group') : []].length;
    const tabs = [...document.querySelectorAll('.wb-group .wb-tab[data-tab], .wb-bar .wb-tab[data-tab]')].map((t: any) => t.dataset.tab);
    const sessions = Object.fromEntries(Object.entries(E.docSessions()).map(([d, x]: any) => [d, x.panes]));
    return { groups, tabs: [...new Set(tabs)], sessions, route: E.route(), current: wb.current.peek().tab?.id ?? null };
  });
  /** the document tabs: tab id -> its document */
  const docTabs = (page: any) => page.evaluate(() => {
    const E = (window as any).editorAPI, wb = E.workbench(), M = wb;
    const all: any[] = []; const walk = (n: any) => { if (n.kind === 'split') n.children.forEach(walk); else all.push(...n.tabs); };
    walk(M.layout.peek().root);
    return Object.fromEntries(all.filter((t) => t.view === 'document').map((t) => [t.id, t.state.doc]));
  });
  /** a second small document made in the page's store; its id */
  const makeDoc = (page: any, title = 'Second', n = 6) => page.evaluate(async ([t, k]: any) => {
    const s = (window as any).editorAPI.store();
    const blocks = [{ kind: 'heading', source: '\\section{One}' }, ...Array.from({ length: k }, (_, i) => ({ kind: 'paragraph', source: `Paragraph ${i + 1} of the second document, with $x_${i}$.` })), { kind: 'heading', source: '\\section{Two}' }, { kind: 'paragraph', source: 'The end.' }];
    return s.createDoc({ title: t, preamble: '\\documentclass{article}\n\\usepackage{amsmath}', blocks });
  }, [title, n]);
  return { HERE, BASE, OUT, Q, browser, problems, results, check, section, open, idle, state, docTabs, makeDoc };
}
