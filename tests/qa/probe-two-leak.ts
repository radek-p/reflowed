// (a probe for tests/test-two-editors.ts' leak check) which window and document listeners an unmounted editor leaves
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
const list = async (expr: string) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  return listeners.map((l: any) => `${l.type}@${l.scriptId}:${l.lineNumber}:${l.columnNumber}`);
};
const before = { w: await list('window'), d: await list('document') };
for (let k = 0; k < 2; k++) await page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('b'); await h.api('b').whenIdle(); h.unmount('b'); });
const after = { w: await list('window'), d: await list('document') };
const extra = (a: string[], b: string[]) => { const m = new Map<string, number>(); for (const x of a) m.set(x, (m.get(x) ?? 0) - 1); for (const x of b) m.set(x, (m.get(x) ?? 0) + 1); return [...m].filter(([, n]) => n > 0); };
const scripts = new Map<string, string>();
cdp.on('Debugger.scriptParsed', (e: any) => scripts.set(e.scriptId, e.url));
await cdp.send('Debugger.enable');
for (const [k, n] of [...extra(before.w, after.w), ...extra(before.d, after.d)]) {
  const [type, loc] = k.split('@'); const [sid, line, col] = loc.split(':');
  const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: sid }).catch(() => ({ scriptSource: '' }));
  const src = scriptSource.split('\n')[Number(line)] ?? '';
  console.log(n, type, scripts.get(sid) ?? sid, line, src.slice(Math.max(0, Number(col) - 120), Number(col) + 60).replace(/\s+/g, ' '));
}
await browser.close();
