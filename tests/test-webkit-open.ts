// Opening the intro from the seed cache in WebKit: the work per
// block is bounded (each block's result mounted once, displayed a few times, the whole document in a few requests),
// and WebKit's time to rest is within a factor of Chromium's measured in the same run (a ratio, not a clock: the
// machine's load moves both). Before the fix every block was mounted twice (the request's redisplay found the first
// mount still on its way and started another), every block without a mounted result was displayed again after every
// request of 8 (3,832 displays for 230 blocks), and the paper took 25 requests.
// Waits on editorAPI.whenIdle(), never on times.
//
//   node tests/test-webkit-open.ts http://localhost:8150/      (a server started with --seed-cache; test-all gives it)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:8150/').replace(/\/?$/, '');
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

/** WebKit may take this many times Chromium's time to rest (measured 2–3× on a loaded machine after the fix; 2.5–5× before) */
const RATIO = 4;

interface Run { ms: number; blocks: number; states: Record<string, number>; mounts: number; mountedTwice: number; requests: number; displays: number; stats: Record<string, number> | null; errors: string[] }
async function open(which: 'webkit' | 'chromium'): Promise<Run> {
  const browser = await pw[which].launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(300000);
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    // every viewer mount, by block (a view of another pane's result counts too: one pane here)
    await page.addInitScript(() => {
      const g = globalThis as any;
      g.__mounts = new Map<string, number>();
      const iv = setInterval(() => {
        const h = g.reflowtex?.host;
        if (!h?.mount) return;
        clearInterval(iv);
        const m = h.mount.bind(h);
        h.mount = (el: HTMLElement, o?: unknown) => { const id = el.closest<HTMLElement>('.blk')?.dataset.id ?? '?'; g.__mounts.set(id, (g.__mounts.get(id) ?? 0) + 1); return m(el, o); };
      }, 1);
    });
    await page.goto(`${BASE}/?seed=intro&engine&store=memory#/doc/intro`);
    await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
    const t0 = Date.now();
    await page.evaluate(() => (window as any).editorAPI.whenIdle());
    const ms = Date.now() - t0;
    const r = await page.evaluate(() => {
      const api = (window as any).editorAPI, bs = api.blocks(), c = api.counters();
      const states: Record<string, number> = {};
      for (const b of bs) states[b.state] = (states[b.state] ?? 0) + 1;
      const counts = [...((globalThis as any).__mounts as Map<string, number>).values()];
      return { blocks: bs.length, states, mounts: counts.reduce((a, x) => a + x, 0), mountedTwice: counts.filter((x) => x > 1).length,
        requests: c.requests, displays: c.displays ?? 0, stats: api.backendObject?.()?.stats?.() ?? null };
    });
    return { ms, ...r, errors };
  } finally { await browser.close(); }
}

const wk = await open('webkit');
const cr = await open('chromium');
for (const [name, r] of [['WebKit', wk], ['Chromium', cr]] as const) {
  check(`${name}: the intro opens from the seed cache, nothing compiled, every block typeset`, !!r.stats && r.stats.compiled === 0 && !r.states.pending && !r.states.error && (r.states.ok ?? 0) > 30, { states: r.states, stats: r.stats });
  check(`${name}: each block's result mounted once (${r.mounts} mounts for ${r.states.ok} typeset blocks)`, r.mountedTwice === 0 && r.mounts === (r.states.ok ?? 0), { mounts: r.mounts, twice: r.mountedTwice });
  check(`${name}: the document in at most 3 requests (${r.requests})`, r.requests <= 3, r.requests);
  check(`${name}: at most 3 displays a block (${r.displays} for ${r.blocks})`, r.displays <= 3 * r.blocks, r.displays);
  check(`${name}: no page errors`, r.errors.length === 0, r.errors.slice(0, 3));
}
check(`WebKit at rest within ${RATIO}× Chromium's time (${wk.ms} ms against ${cr.ms} ms: ${(wk.ms / cr.ms).toFixed(1)}×)`, wk.ms <= RATIO * cr.ms, { webkit: wk.ms, chromium: cr.ms });
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
