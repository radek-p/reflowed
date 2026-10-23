// (a probe) the listeners on attached nodes (the document's subtree) before and after mounts of the right editor,
// after GC, by node and type; and the page's JSEventListeners
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = process.argv[2] ?? 'http://localhost:8170/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}two-editors.html?engine`);
await page.waitForFunction(() => (window as any).twoEditors?.mount);
await page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('a'); await h.api('a').whenIdle(); });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('DOM.enable');
const snap = async () => {
  for (let k = 0; k < 3; k++) await cdp.send('HeapProfiler.collectGarbage');
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true });
  const by = new Map<string, number>();
  const names = new Map<number, string>();
  for (const l of listeners) {
    let n = names.get(l.backendNodeId);
    if (n === undefined) { try { const { node } = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }); const cls = (node.attributes ?? []).reduce((a: string, v: string, i: number, arr: string[]) => (arr[i - 1] === 'class' ? v.split(' ')[0] : a), ''); n = `${node.nodeName.toLowerCase()}.${cls}`; } catch { n = '?'; } names.set(l.backendNodeId, n); }
    const k = `${n} ${l.type}`; by.set(k, (by.get(k) ?? 0) + 1);
  }
  const { metrics } = await cdp.send('Performance.getMetrics');
  return { by, total: metrics.find((m: any) => m.name === 'JSEventListeners').value };
};
const DOC = process.argv[3] ?? null;
const cycle = () => page.evaluate(async (d) => { const h = (window as any).twoEditors; await h.mount('b', d ?? undefined); await h.api('b')?.whenIdle(); h.unmount('b'); await new Promise((r) => setTimeout(r, 100)); }, DOC);
await cycle();
const a = await snap();
for (let k = 0; k < 4; k++) await cycle();
const b = await snap();
console.log('JSEventListeners', a.total, '->', b.total);
for (const [k, v] of b.by) if (v !== (a.by.get(k) ?? 0)) console.log(k, a.by.get(k) ?? 0, '->', v);
for (const [k, v] of a.by) if (!b.by.has(k)) console.log(k, v, '->', 0);
await browser.close();
