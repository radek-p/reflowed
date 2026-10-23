// The workbench's browser suite: the harness (the browser, the demo page served from memory, check(), group(), the
// helpers every area uses). The areas (tests/e2e/<area>.ts) register their groups; tests/e2e.ts runs them. The checks
// wait on DOM state, the workbench's events and wb.idle(), never on fixed times.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WB, REPO, bundle, demoHtml } from '../../scripts/bundle.ts';
import { decodePng, luma } from '../../scripts/png.ts';
export { WB, REPO, decodePng, luma, KEYMAP, readFileSync, writeFileSync, existsSync, join };
import { KEYMAP } from '../../src/keys.ts';

export const req = createRequire(join(REPO, 'app/package.json'));
export const pw = req('playwright');
export const argv = process.argv.slice(2);
export const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]) : null;

export const HTML = demoHtml();
export const JS = await bundle(join(WB, 'demo/main.ts'));

let n = 0, failed = 0;
export const fails: string[] = [];
export function check(name: string, ok: boolean, detail: unknown = '') {
  n++; if (!ok) { failed++; fails.push(`${cur}: ${name}`); }
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${String(d).slice(0, Number(process.env.DETAIL ?? 300))}` : ''}`);
}
let cur = '';

export const BROWSER = argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1] : 'chromium';
// Chromium's headless shell hides scrollbars by default: show them (the scrollbar checks need them)
export const browser = await pw[BROWSER].launch({ headless: !argv.includes('--headed'), ...(BROWSER === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
export async function fresh({ theme = 'light', w = 1280, h = 800, query = 'fresh', sides = false } = {}) {
  if (!sides) query += '&sides=0';
  if (!/bar=/.test(query)) query += '&bar=0';   // the window bar (the app's top bar) is tested by its own groups
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await page.route('http://wb.test/**', (route: any) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/demo.js') return route.fulfill({ body: JS, contentType: 'text/javascript' });
    return route.fulfill({ body: HTML, contentType: 'text/html' });
  });
  await page.goto(`http://wb.test/?${query}&theme=${theme}`);
  await page.waitForSelector('.wb-tab', { state: 'attached' });
  return page;
}
/** The header's one-line form: the tabs given room (a wide window, the first group 5/7 of it; side by side, the
 *  groups of a strip row take one form, so the other one needs its room too). */
export async function oneLine(page: any, w = 2800) {
  await page.setViewportSize({ width: w, height: page.viewportSize().height });
  await page.evaluate(() => { const W = (window as any).demo.wb, r = W.layout.peek().root; if (r.kind === 'split') W.resize(r.id, r.children.map((_: any, i: number) => (i ? 2 : 5))); });
  await page.waitForFunction(() => document.querySelector('.wb-group')?.getAttribute('data-form') === 'one');
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));     // the switch's FLIP
}
/** The workbench at rest (wb.idle(): no pending focus, timer or animation): the tests wait on state, never on time. */
export const idle = (p: any) => p.evaluate(() => (window as any).demo.wb.idle());
export const groups: [string, () => Promise<void>][] = [];
export const group = (name: string, f: () => Promise<void>) => groups.push([name, f]);

// ── helpers (in the page) ──
export const layout = (page: any) => page.evaluate(() => JSON.parse((window as any).demo.wb.serialize()));
export const tabsOf = (page: any, gi: number) => page.evaluate((i: number) => {
  const g = (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[i];
  return g ? g.tabs.map((t: any) => t.id) : null;
}, gi);
export const labels = (page: any, gi: number) => page.evaluate((i: number) => [...document.querySelectorAll('.wb-group')][i]
  ? [...[...document.querySelectorAll('[data-group]')].filter((g) => !g.closest('.wb-park'))[i].querySelectorAll('.wb-tab .wb-tab-label')].map((e) => e.textContent) : null, gi);
export const groupEl = (page: any, gi: number) => page.evaluate((i: number) => (window as any).demo.M.groups((window as any).demo.wb.layout.peek())[i]?.id, gi);
export async function center(page: any, sel: string) {
  // tabs glide (FLIP) after a reorder or a move: measure where they rest, not mid-flight
  await page.waitForFunction(() => !document.getAnimations().some((a: any) => a.playState === 'running' && a.effect?.target?.closest?.('.wb-tab, .wb-strip')), null, { timeout: 5000 }).catch(() => {});
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
/** Press at `from`, move in steps to `to` (and optionally hold there until `until` is true), release unless `release` is false. */
export async function drag(page: any, from: { x: number; y: number }, to: { x: number; y: number }, { steps = 12, release = true } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 2, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps });
  if (release) await page.mouse.up();
}
export const tabSel = (id: string) => `[data-tab="${id}"]`;
/** A tab's Tab stop: the role=tab element, the first child of its pill (the pill is [data-tab]). */
export const stopSel = (id: string) => `[data-tab="${id}"] > [role="tab"]`;
/** A chord of the keymap (the Linux bindings): Ctrl+K, then the key. */
export const chord = async (page: any, k: string) => { await page.keyboard.press('Control+k'); await page.keyboard.press(k); };
export const activeId = (page: any) => page.evaluate(() => (window as any).demo.wb.layout.peek().active);
export const events = (page: any) => page.evaluate(() => {
  const w = window as any;
  w.__ev = [];
  for (const k of ['resizestart', 'resizeend', 'dragstart', 'dragend', 'tabdragstart', 'tabdragend', 'change', 'rename', 'tabform'])
    w.demo.wb.on(k, (d: any) => w.__ev.push({ k, d: k === 'change' ? d.why : d }));
});
export const evs = (page: any, k: string) => page.evaluate((k: string) => (window as any).__ev.filter((e: any) => e.k === k), k);

export const settled = async (page: any) => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return page.waitForFunction(() => !document.querySelector('.wb-moving, .wb-side--sliding') && document.getAnimations().filter((a: any) => !(a instanceof CSSTransition)).length === 0); };
export const narrowLook = (page: any) => page.evaluate(() => [...document.querySelectorAll('[data-tab]')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => {
  const lab = t.querySelector('.wb-tab-label') as HTMLElement, box = (t.querySelector('.wb-tab-text, .wb-tab-line') ?? lab) as HTMLElement;
  const real = (t.getAttribute('title') ?? '').split('\n')[0];
  const cv = document.createElement('canvas').getContext('2d')!; cv.font = getComputedStyle(lab).font;
  // the room with the × shown (the state never changes on hover: a hidden × gives its room to the text, fitTabs counts it out)
  const xs = getComputedStyle(t.querySelector('.wb-tab-close')!), xRoom = xs.display === 'none' ? parseFloat(xs.width) + parseFloat(xs.marginLeft) + parseFloat(xs.marginRight) + (parseFloat(getComputedStyle(t).columnGap) || 0) : 0;
  const room = Math.min(lab.getBoundingClientRect().width, box.getBoundingClientRect().width - xRoom);
  let k = 0; const full = cv.measureText(real).width <= room + 0.5;
  if (full) k = real.length; else while (k < real.length && cv.measureText(real.slice(0, k + 1) + '…').width <= room + 0.5) k++;
  const vis = (e: Element | null) => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  const textShown = vis(lab) && getComputedStyle(box).visibility !== 'hidden' && room > 0;
  const icon = vis(t.querySelector('.wb-tab-tinyicon')) || vis(t.querySelector('.wb-tab-icon'));
  return { id: t.getAttribute('data-tab'), fit: (t as HTMLElement).dataset.fit ?? '', real, text: lab.textContent, k, room: +room.toFixed(1), textShown, icon,
    min: Math.ceil(cv.measureText(real.slice(0, 3) + '…').width) };
}));
export const narrowBad = (x: any) => {
  if (x.text !== x.real) return 'not the real name';          // never initials or another form: the real name (CSS truncates it)
  if (!x.textShown && !x.icon) return 'empty';
  if (x.fit === 'tiny') return x.icon && !x.textShown && x.room < x.min + 4 + 0.5 ? '' : 'icon above the threshold';
  return x.textShown && x.k >= Math.min(3, x.real.length) ? '' : 'fewer than 3 characters';
};
/** Run the registered groups (--only: those whose name matches), then report and exit. */
export async function run(): Promise<void> {
for (const [name, f] of groups) {
  if (ONLY && !ONLY.test(name)) continue;
  cur = name;
  console.log(`\n## ${name}`);
  try { await f(); } catch (e) { check(`${name} ran`, false, (e as Error).stack ?? String(e)); }
}
await browser.close();
console.log(`\n${n - failed}/${n} passed`);
if (failed) { console.log(fails.join('\n')); process.exit(1); }

}
