// (a probe) why detached elements stay alive: their retainer chains in a heap snapshot.
//   node tests/qa/probe-retainers.ts <base> <class, e.g. ui-icon-btn> [nodoc|doc]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const [BASE = 'http://localhost:8170/', CLS = 'rn-card', DOC = 'nodoc'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}two-editors.html?engine`);
await page.waitForFunction(() => (window as any).twoEditors?.mount);
await page.evaluate(async () => { const h = (window as any).twoEditors; await h.mount('a'); await h.api('a').whenIdle(); });
const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
for (let k = 0; k < 3; k++) await page.evaluate(async (d) => { const h = (window as any).twoEditors; await h.mount('b', d === 'doc' ? undefined : d); await h.api('b')?.whenIdle(); h.unmount('b'); await new Promise((r) => setTimeout(r, 100)); }, DOC);
for (let k = 0; k < 3; k++) await cdp.send('HeapProfiler.collectGarbage');
let chunks: string[] = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e: any) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); chunks = [];
const { result: p } = await cdp.send('Runtime.evaluate', { expression: 'Element.prototype' });
const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: p.objectId });
const { result: all } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: `function () { return this.filter((e) => { try { return !e.isConnected && String(e.getAttribute('class') || '').split(' ').includes(${JSON.stringify(CLS)}); } catch { return false; } }); }` });
const { result: n } = await cdp.send('Runtime.callFunctionOn', { objectId: all.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
console.log('detached', CLS, n.value);
const heapIds: number[] = [];
for (let i = 0; i < Math.min(n.value, 8); i++) {
  const { result: el } = await cdp.send('Runtime.callFunctionOn', { objectId: all.objectId, functionDeclaration: `function () { return this[${i}]; }` });
  const { heapSnapshotObjectId } = await cdp.send('HeapProfiler.getHeapObjectId', { objectId: el.objectId });
  heapIds.push(Number(heapSnapshotObjectId));
  await cdp.send('Runtime.releaseObject', { objectId: el.objectId });
}
for (const id of [all.objectId, objects.objectId, p.objectId]) await cdp.send('Runtime.releaseObject', { objectId: id });
for (let k = 0; k < 2; k++) await cdp.send('HeapProfiler.collectGarbage');
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
const snap = JSON.parse(chunks.join('')); chunks = [];
const m = snap.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length;
const nTypes = m.node_types[0], eTypes = m.edge_types[0];
const iName = m.node_fields.indexOf('name'), iId = m.node_fields.indexOf('id'), iEc = m.node_fields.indexOf('edge_count'), iType = m.node_fields.indexOf('type');
const eType = m.edge_fields.indexOf('type'), eName = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node');
const nodes = snap.nodes, edges = snap.edges, strings = snap.strings;
const count = nodes.length / NF;
const byId = new Map<number, number>();
for (let i = 0; i < count; i++) byId.set(nodes[i * NF + iId], i);
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * NF + iEc] * EF; firstEdge[i + 1] = e; }
const retainers: number[][] = Array.from({ length: count }, () => []), retEdge: number[][] = Array.from({ length: count }, () => []);
for (let i = 0; i < count; i++) for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) { const to = edges[e + eTo] / NF; retainers[to].push(i); retEdge[to].push(e); }
const name = (i: number) => `${nTypes[nodes[i * NF + iType]]}:${String(strings[nodes[i * NF + iName]]).slice(0, 90)}`;
const ename = (e: number) => { const t = eTypes[edges[e + eType]]; return t === 'element' || t === 'hidden' ? `[${edges[e + eName]}]` : `${t}:${strings[edges[e + eName]]}`; };
for (const hid of heapIds) {
  const target = byId.get(hid);
  if (target == null) { console.log('not in the snapshot', hid); continue; }
  const seen = new Map<number, [number, number]>(); const q = [target]; seen.set(target, [-1, -1]);
  let hit = -1;
  while (q.length) {
    const i = q.shift()!;
    if (/\(GC roots\)|Window \/|NativeContext/.test(name(i)) && i !== target) { hit = i; break; }
    for (let k = 0; k < retainers[i].length; k++) {
      const r = retainers[i][k], e = retEdge[i][k];
      if (eTypes[edges[e + eType]] === 'weak' || seen.has(r) || /\(Global handles\)|DevTools/.test(name(r))) continue;
      seen.set(r, [i, e]); q.push(r);
    }
  }
  let cur = hit; const path: string[] = [];
  while (cur !== -1 && cur !== target) { const [from, e] = seen.get(cur)!; path.push(`${name(cur)} --${ename(e)}-->`); cur = from; }
  console.log(name(target)); console.log(path.slice(-8).join('\n')); console.log('----');
}
await browser.close();
