// One test harness for the editor's suites: checks with a fixed summary line,
// the browser launch, the app's idle wait, a fresh document. New and touched suites use it.
//
//   const t = harness('readonly');                    // results under test-results/<name>/
//   t.check(name, ok, detail?)                        // "ok   name" / "FAIL name — detail"
//   const { ctx, page, errors } = await t.launch({ target: 'dev' | 'file', at?: url or path, browser? })
//   await t.idle(page)                                // editorAPI.whenIdle() (the app: typesetting, writes)
//   const id = await t.newDoc(page, init)             // createDoc in the page's store, then opened
//   t.done()                                          // "N/M checks passed" and the exit code (test-all reads it)
//
// The summary line and the "ok  "/"FAIL" prefixes are what tests/test-all.ts parses.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropSeedCache } from './no-seed-cache.ts';
import { resultsDir } from './results.ts';

export const EDITOR = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface LaunchOptions { target?: 'dev' | 'file'; at?: string; browser?: 'chromium' | 'firefox' | 'webkit'; noSeedCache?: boolean; query?: string; viewport?: { width: number; height: number } }

export function harness(name: string) {
  const out = join(resultsDir(EDITOR), name);
  mkdirSync(out, { recursive: true });
  let n = 0, bad = 0;
  const failed: string[] = [];
  const check = (what: string, ok: boolean, detail: unknown = '') => {
    n++;
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d && d !== '[]' ? ` — ${d.slice(0, 900)}` : ''}`);
    if (!ok) { bad++; failed.push(what); }
    return ok;
  };
  async function launch(o: LaunchOptions = {}) {
    const target = o.target ?? 'dev';
    const url = target === 'file'
      ? `file://${o.at ?? join(EDITOR, 'dist/reflowtex-editor.html')}${o.query ? `?${o.query}` : ''}`
      : `${(o.at ?? 'http://localhost:8150/').replace(/\/?$/, '/')}?engine${o.query ? `&${o.query}` : ''}`;
    const pw = createRequire(join(EDITOR, 'app/package.json'))('playwright');
    const ctx = await pw[o.browser ?? 'chromium'].launchPersistentContext(mkdtempSync(join(tmpdir(), `rtx-${name}-`)),
      { viewport: o.viewport ?? { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    if (target === 'file') await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
    if (o.noSeedCache) await ctx.addInitScript(dropSeedCache);
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`${url}#/`);
    await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'home');
    return { ctx, page, errors, url };
  }
  const idle = (page: any) => page.evaluate(() => (window as any).editorAPI.whenIdle());
  async function newDoc(page: any, init: Record<string, unknown>): Promise<string> {
    const id: string = await page.evaluate((i: any) => (window as any).editorAPI.store().createDoc(i), init);
    await openDoc(page, id);
    return id;
  }
  async function openDoc(page: any, id: string) {
    await page.evaluate((i: string) => { location.hash = `#/doc/${i}`; }, id);
    await page.waitForFunction((i: string) => (window as any).editorAPI.route().name === 'doc' && (window as any).editorAPI.currentDoc()?.id === i, id);
    await idle(page);
  }
  const done = () => {
    console.log(`\n${n - bad}/${n} checks passed${bad ? `; FAILED: ${failed.join('; ')}` : ''}`);
    process.exit(bad ? 1 : 0);
  };
  return { check, launch, idle, newDoc, openDoc, done, out };
}
