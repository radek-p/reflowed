// (a probe for tests/test-two-editors.ts' leak check) listeners added and not removed across mounts of the right
// editor, by target and type (addEventListener / removeEventListener counted in the page)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8170/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
await ctx.addInitScript(() => {
  const live = new Map<string, number>();
  const name = (t: any) => (t === window ? 'window' : t === document ? 'document' : t?.nodeType === 1 ? `${t.tagName.toLowerCase()}.${String(t.className || '').split(' ')[0]}` : t?.constructor?.name ?? '?');
  const keyOf = new WeakMap<object, Map<string, string>>();
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type: string, fn: any, o?: any) {
    const cap = typeof o === 'boolean' ? o : !!o?.capture;
    const id = `${type}|${cap}`;
    let m = keyOf.get(this); if (!m) keyOf.set(this, m = new Map());
    const k = `${name(this)} ${type}`;
    if (fn && !m.has(id + '#' + (fn.__lid ??= Math.random()))) { m.set(id + '#' + fn.__lid, k); live.set(k, (live.get(k) ?? 0) + 1); }
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type: string, fn: any, o?: any) {
    const cap = typeof o === 'boolean' ? o : !!o?.capture;
    const m = keyOf.get(this), id = `${type}|${cap}#${fn?.__lid}`;
    const k = m?.get(id);
    if (k) { m!.delete(id); live.set(k, (live.get(k) ?? 0) - 1); }
    return rem.call(this, type, fn, o);
  };
  (window as any).__live = () => Object.fromEntries(live);
});
const page = await ctx.newPage();
await page.goto(`${BASE}two-editors.html?engine`);
await page.waitForFunction(() => (window as any).twoEditors?.mount);
await page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('a'); await h.api('a').whenIdle(); });
const cycle = () => page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('b'); await h.api('b').whenIdle(); h.unmount('b'); await new Promise((r) => setTimeout(r, 50)); });
await cycle();
const a = await page.evaluate(() => (window as any).__live());
for (let k = 0; k < 4; k++) await cycle();
const b = await page.evaluate(() => (window as any).__live());
for (const k of Object.keys(b)) if ((b[k] ?? 0) - (a[k] ?? 0) > 0) console.log(k, a[k] ?? 0, '->', b[k]);
await browser.close();
