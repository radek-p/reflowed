// The editor's compile worker (engine/dist/editor-worker.js, the same bundle the
// single file carries) run in Node worker threads, for a page driven by
// Playwright: the page's backend (engine/web/backend.js) and the app stay in
// the page, where the compile requests and their cache keys are made; every
// message the backend posts to "its worker" goes to a Node thread instead, and
// the answers come back. TeX, the capture, the converter and the encoder run
// in Node; the page only builds requests and keeps results.
//
//   import { attachNodeEngine } from './node-engine.ts';
//   const eng = await attachNodeEngine(page, { workerJs, packBytes });   // before page.goto
//   …; eng.stats(); await eng.close();
//
// Why not the whole thing in Node: what a default document asks the engine
// for (which blocks, each block's source and context, the preamble, the bib
// signature, the asset signatures in the keys) is the app's logic (app.js,
// nesting, notes, the References pane, refs), which lives in the page. Running
// it here would mean a second copy of that logic and keys that drift from the
// runtime's; the page is where the runtime computes them.
import { Worker } from 'node:worker_threads';

// `self` for a classic worker script in a worker thread
const PRELUDE = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
let handler = null;
Object.defineProperty(globalThis, 'onmessage', { set(f) { handler = f; }, get() { return handler; }, configurable: true });
globalThis.postMessage = (m, t) => parentPort.postMessage(m, t);
parentPort.on('message', (data) => { if (handler) handler({ data }); });
`;

// Uint8Array / ArrayBuffer across the Playwright binding: { __u8: base64 }
function encNode(x: unknown): unknown {
  if (x instanceof Uint8Array) return { __u8: Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('base64') };
  if (x instanceof ArrayBuffer) return { __u8: Buffer.from(x).toString('base64') };
  if (Array.isArray(x)) return x.map(encNode);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, encNode(v)]));
  return x;
}
function decNode(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(decNode);
  if (x && typeof x === 'object') {
    if (typeof (x as any).__u8 === 'string' && Object.keys(x).length === 1) return new Uint8Array(Buffer.from((x as any).__u8, 'base64'));
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, decNode(v)]));
  }
  return x;
}

// the page's side: installed before any page script runs
const PAGE = () => {
  const b64e = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const enc = (x: any): any => {
    if (x instanceof Uint8Array) return { __u8: b64e(x) };
    if (x instanceof ArrayBuffer) return { __u8: b64e(new Uint8Array(x)) };
    if (Array.isArray(x)) return x.map(enc);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)]));
    return x;
  };
  const dec = (x: any): any => {
    if (Array.isArray(x)) return x.map(dec);
    if (x && typeof x === 'object') {
      if (typeof x.__u8 === 'string' && Object.keys(x).length === 1) return Uint8Array.from(atob(x.__u8), (c) => c.charCodeAt(0));
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, dec(v)]));
    }
    return x;
  };
  const workers = new Map<number, any>();
  let next = 1;
  class NodeWorker {
    id = next++; onmessage: any = null; onerror: any = null;
    constructor() { workers.set(this.id, this); (window as any).__w1cNew(this.id); }
    // init: the pack stays in Node (the page's copy is 26 MB of base64)
    postMessage(m: any) { (window as any).__w1cPost(this.id, m.cmd === 'init' ? { ...m, args: {} } : enc(m)); }
    terminate() { workers.delete(this.id); (window as any).__w1cTerminate(this.id); }
  }
  (window as any).__w1cDeliver = (id: number, m: any) => { const w = workers.get(id); w?.onmessage?.({ data: dec(m) }); };
  (window as any).__w1cError = (id: number, message: string) => { const w = workers.get(id); workers.delete(id); w?.onerror?.({ message }); };
  let real: any = null;
  Object.defineProperty(globalThis, '__rtxEditor', {
    configurable: true,
    get: () => real,
    set: (v) => { real = v; if (v) { v.createWorker = () => new NodeWorker(); v.nodeEngine = true; } },
  });
};

export async function attachNodeEngine(page: any, o: { workerJs: string; packBytes: Uint8Array }) {
  const src = PRELUDE + o.workerJs;
  const threads = new Map<number, Worker>();
  const counters = { workers: 0, messages: 0, ms: 0 };
  const deliver = (id: number, m: unknown) => page.evaluate(([i, x]: [number, unknown]) => (window as any).__w1cDeliver(i, x), [id, encNode(m)]).catch(() => {});
  await page.exposeFunction('__w1cNew', (id: number) => {
    const w = new Worker(src, { eval: true });
    counters.workers++;
    threads.set(id, w);
    w.on('message', (m: any) => deliver(id, m));
    w.on('error', (e: Error) => { threads.delete(id); page.evaluate(([i, msg]: [number, string]) => (window as any).__w1cError(i, msg), [id, e.message]).catch(() => {}); });
  });
  await page.exposeFunction('__w1cPost', (id: number, m: any) => {
    counters.messages++;
    const w = threads.get(id);
    if (!w) return;
    const msg = decNode(m) as any;
    if (msg.cmd === 'init') msg.args = { packBytes: o.packBytes };
    w.postMessage(msg);
  });
  await page.exposeFunction('__w1cTerminate', (id: number) => { threads.get(id)?.terminate(); threads.delete(id); });
  await page.addInitScript(PAGE);
  return {
    stats: () => ({ ...counters, live: threads.size }),
    async close() { for (const w of threads.values()) await w.terminate(); threads.clear(); },
  };
}

/** The worker bundle alone in a Node thread, called directly (no page): the pack proof. */
export function spawnWorker(workerJs: string) {
  const w = new Worker(PRELUDE + workerJs, { eval: true });
  let id = 0;
  const pend = new Map<number, { res: (x: any) => void; rej: (e: Error) => void }>();
  w.on('message', (m: any) => { const p = pend.get(m.id); pend.delete(m.id); if (!p) return; if (m.error) p.rej(new Error(m.error.split('\n')[0])); else p.res(m.result); });
  w.on('error', (e: Error) => { for (const p of pend.values()) p.rej(e); pend.clear(); });
  const call = (cmd: string, args: unknown = {}) => new Promise<any>((res, rej) => { const i = ++id; pend.set(i, { res, rej }); w.postMessage({ id: i, cmd, args }); });
  return { call, terminate: () => w.terminate() };
}
