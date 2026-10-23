// (a probe) detached elements alive after GC, by tag.class, after 1 and after 4 mounts of the right editor
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const [BASE = 'http://localhost:8170/', DOC = 'nodoc'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}two-editors.html?engine`);
await page.waitForFunction(() => (window as any).twoEditors?.mount);
await page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('a'); await h.api('a').whenIdle(); });
const cdp = await ctx.newCDPSession(page);
const cycle = () => page.evaluate(async (d) => { const h = (window as any).twoEditors; await h.mount('b', d === 'doc' ? undefined : d); await h.api('b')?.whenIdle(); h.unmount('b'); await new Promise((r) => setTimeout(r, 100)); }, DOC);
async function census() {
  for (let k = 0; k < 3; k++) await cdp.send('HeapProfiler.collectGarbage');
  const { result: p } = await cdp.send('Runtime.evaluate', { expression: 'Element.prototype' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: p.objectId });
  const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, returnByValue: true,
    functionDeclaration: `function () { const m = {}; for (const e of this) { try { if (e.isConnected || e.parentNode) continue; } catch { continue; } { const k = e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(' ')[0] + ' (' + e.querySelectorAll('*').length + ')'; m[k] = (m[k] || 0) + 1; } } return m; }` });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  if (exceptionDetails) console.log(JSON.stringify(exceptionDetails).slice(0, 400));
  return result.value as Record<string, number>;
}
await cycle();
const a = await census();
for (let k = 0; k < 3; k++) await cycle();
const b = await census();
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] ?? 0) !== (b[k] ?? 0)) console.log(k, a[k] ?? 0, '->', b[k] ?? 0);
await browser.close();
