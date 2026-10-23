// engine/web/kept-docs.js: the engine states of released documents, the last 2 kept; nothing kept
// when memory is tight; dropped on eviction, forget(key), and the tab hidden for a while. Node, no browser.
//   node tests/test-kept-docs.ts
import { createKept, memoryTight } from '../engine/web/kept-docs.js';

let fails = 0, n = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  n++; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail)}`}`);
}

// a document for the visibility timer: an EventTarget with a visibilityState
const doc: any = new EventTarget();
doc.visibilityState = 'visible';
(globalThis as any).document = doc;
const setVis = (v: string) => { doc.visibilityState = v; doc.dispatchEvent(new Event('visibilitychange')); };

{
  const dropped: string[] = [];
  const k = createKept({ max: 2, tight: () => false, onDrop: (st: any) => dropped.push(st.id) });
  const a = { id: 'A' }, b = { id: 'B' }, c = { id: 'C' };
  k.keep('a', a); k.keep('b', b);
  check('two released documents: both kept, oldest first', JSON.stringify(k.keys()) === '["a","b"]', k.keys());
  k.keep('c', c);
  check('a third released document evicts the oldest (its state dropped)', JSON.stringify(k.keys()) === '["b","c"]' && JSON.stringify(dropped) === '["A"]', { keys: k.keys(), dropped });
  check('take gives the kept state back, as it was, and out of the cache', k.take('b') === b && JSON.stringify(k.keys()) === '["c"]', k.keys());
  check('take of a document not kept: null', k.take('a') === null);
  k.forget('c');
  check('forget (deleted or changed elsewhere) drops it', k.keys().length === 0 && dropped.includes('C'), dropped);
  k.keep('a', a); k.keep('a', a);
  check('the same document released again: kept once', JSON.stringify(k.keys()) === '["a"]', k.keys());
}
{
  const dropped: string[] = [];
  const k = createKept({ max: 2, tight: () => true, onDrop: (st: any) => dropped.push(st.id) });
  const kept = k.keep('a', { id: 'A' });
  check('memory tight: nothing kept, the state dropped at once', !kept && k.keys().length === 0 && JSON.stringify(dropped) === '["A"]', { kept, dropped });
}
{
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: 4 }, configurable: true });
  const small = memoryTight();
  Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: 8 }, configurable: true });
  const big = memoryTight();
  const perf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { value: { memory: { usedJSHeapSize: 80, jsHeapSizeLimit: 100 } }, configurable: true });
  const full = memoryTight();
  Object.defineProperty(globalThis, 'performance', { value: { memory: { usedJSHeapSize: 50, jsHeapSizeLimit: 100 } }, configurable: true });
  const half = memoryTight();
  if (nav) Object.defineProperty(globalThis, 'navigator', nav);
  if (perf) Object.defineProperty(globalThis, 'performance', perf);
  check('memoryTight: deviceMemory 4 tight, 8 not; the heap at 80 % of its limit tight, 50 % not', small && !big && full && !half, { small, big, full, half });
}
{
  const dropped: string[] = [];
  const k = createKept({ max: 2, tight: () => false, hiddenMs: 30, onDrop: (st: any) => dropped.push(st.id) });
  k.keep('a', { id: 'A' }); k.keep('b', { id: 'B' });
  setVis('hidden'); setVis('visible');
  await new Promise((r) => setTimeout(r, 60));
  check('hidden, then visible again before the time: kept', k.keys().length === 2, k.keys());
  setVis('hidden');
  await new Promise((r) => setTimeout(r, 60));
  check('hidden longer than the time: every kept state dropped', k.keys().length === 0 && dropped.length === 2, dropped);
  setVis('visible');
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
