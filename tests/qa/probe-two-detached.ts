// (a probe) event targets kept alive after the right editor is unmounted: detached elements and other targets
// (MediaQueryList, AbortSignal, MessagePort …) with listeners, after GC (Runtime.queryObjects)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8170/';
const DOC = process.argv[3] ?? null;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}two-editors.html?engine`);
await page.waitForFunction(() => (window as any).twoEditors?.mount);
await page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('a'); await h.api('a').whenIdle(); });
const cdp = await ctx.newCDPSession(page);
const cycle = () => page.evaluate(async (d) => { const h = (window as any).twoEditors; await h.mount('b', d ?? undefined); await h.api('b')?.whenIdle(); h.unmount('b'); await new Promise((r) => setTimeout(r, 100)); }, DOC);
async function census() {
  for (let k = 0; k < 3; k++) await cdp.send('HeapProfiler.collectGarbage');
  const out = new Map<string, number>();
  for (const proto of ['EventTarget.prototype']) {
    const { result: p } = await cdp.send('Runtime.evaluate', { expression: proto });
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: p.objectId });
    const { result: len } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    for (let i = 0; i < len.value; i++) {
      const { result: o } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: `function () { return this[${i}]; }` });
      if (!o.objectId) continue;
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: o.objectId });
      if (listeners.length) {
        const { result: d } = await cdp.send('Runtime.callFunctionOn', { objectId: o.objectId, returnByValue: true,
          functionDeclaration: 'function () { const n = this.nodeType === 1 ? `${this.tagName.toLowerCase()}.${String(this.className || "").split(" ")[0]}${this.isConnected ? "" : " (detached)"}` : (this.constructor?.name ?? "?") + (this.media ? ` ${this.media}` : ""); return n; }' });
        const k = `${d.value} [${[...new Set(listeners.map((l: any) => l.type))].join(',')}]`;
        out.set(k, (out.get(k) ?? 0) + listeners.length);
      }
      await cdp.send('Runtime.releaseObject', { objectId: o.objectId });
    }
  }
  return out;
}
await cycle();
const a = await census();
for (let k = 0; k < 3; k++) await cycle();
const b = await census();
for (const [k, v] of b) if (v !== (a.get(k) ?? 0)) console.log(k, a.get(k) ?? 0, '->', v);
await browser.close();
