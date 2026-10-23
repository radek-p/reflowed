// The editor's engine: one Asyncify build of Tectonic's XeTeX with the capture, from a release of
// github.com/radek-p/reflow-tectonic (dist/async/, installed by scripts/fetch-engine.ts).
//
//   const e = await WarmEngine.create({ createModule, wasmBinary, glue, fetchSync });
//   e.compile('input.tex', { maxPasses: 3, capture: 0 })   a full run (0 spotless … 3 abort)
//   e.warm(hostTex)          run until the engine opens rtx-block.tex (just after
//                            \begin{document}), unwind the wasm stack (Asyncify),
//                            copy linear memory
//   e.runBlock(src)          restore the copy, rewind, hand the block over; the
//                            rest of the run is the block + \end{document}
//   e.file(name) / e.text(name)   the run's outputs (input.log, input.rtxc.jsonl, …)
//
// The warm start is a memory snapshot (an Asyncify unwind at rtx-block.tex), with the
// capture flags of the driver: bits 16..23 of the driver flags carry
// the capture flags (0: the driver's default 1|2|4|16), FLAG_NO_CAPTURE turns
// the capture off (PDF export).

export const FLAG_INITEX = 1, FLAG_PDF = 2, FLAG_SYNCTEX = 4, FLAG_KEEP_GOING = 8, FLAG_NO_CAPTURE = 64, FLAG_RTX_SAMPLES = 128;
/** xetex-rtxcapture.h: capture, pageless, math lists, (samples), source positions, attributes (0005). */
export const RTX = { CAPTURE: 1, PAGELESS: 2, MATHLISTS: 4, SAMPLES: 8, SRCPOS: 16, ATTRS: 32 } as const;
/** What the editor runs with: 7|16 + attributes (patch 0005). */
export const EDITOR_CAPTURE = RTX.CAPTURE | RTX.PAGELESS | RTX.MATHLISTS | RTX.SRCPOS | RTX.ATTRS;
/** A fixed date (14 Nov 2023), for runs that must compare byte for byte (pass it as CompileOpts.date). */
export const BUILD_DATE = 1700000000;
const ASYNC_DATA = 1 << 20;
const PAGE = 65536;
/** a 64 KB page of zeros (reading an untouched page commits nothing) */
function zeroPage(words: Int32Array, p: number): boolean {
  let acc = 0;
  for (let i = p * (PAGE >> 2), e = i + (PAGE >> 2); i < e; i += 8)
    acc |= words[i] | words[i + 1] | words[i + 2] | words[i + 3] | words[i + 4] | words[i + 5] | words[i + 6] | words[i + 7];
  return acc === 0;
}               // Asyncify's buffer for the unwound stack
const enc = new TextEncoder(), dec = new TextDecoder();

export type FetchSync = (kind: number, name: string) => Uint8Array | null;

/** The document that brings the engine to the block: preamble, \begin{document}, the block file. */
export function hostDocument(preamble: string, preload = ''): string {
  return `${preamble.replace(/\s*$/, '')}\n\\begin{document}${preload}\n\\csname @@input\\endcsname rtx-block.tex \\end{document}\n`;
}

export interface CompileOpts {
  format?: string; initex?: boolean; pdf?: boolean; keepGoing?: boolean; maxPasses?: number;
  /** capture flags (RTX.*); 0 = the capture off */
  capture?: number;
  /** the date TeX runs on (\today, \year, \time), in Unix seconds; default the time of the call: a result keeps the date
   *  it was typeset on (the warm snapshot keeps the date of the warm) */
  date?: number;
}

type Hook = (outPtr: number, outLen: number, logPtr: number, logLen: number) => number;

export class WarmEngine {
  M: any;
  raw: any;
  A: Record<string, (...a: number[]) => void> = {};
  async = false;
  astate = 0;                          // 0 normal, 1 unwinding, 2 rewinding
  hook: Hook | null = null;
  extra: Record<string, Uint8Array> = {};
  snapshot: Uint8Array | null = null;
  snapLen = 0;
  sp = 0;
  asyncData = 0;
  pending: Uint8Array | string = '';
  /** the log as it stood at the pause (the block's log is what follows it) */
  preambleLog = '';

  static async create(o: { createModule: any; wasmBinary: Uint8Array | WebAssembly.Module; glue?: string; fetchSync: FetchSync;
    log?: (level: number, s: string) => void }): Promise<WarmEngine> {
    const self = new WarmEngine();
    const M = await o.createModule({
      ...(o.wasmBinary instanceof Uint8Array ? { wasmBinary: o.wasmBinary } : {}),
      ttwFetch: o.fetchSync,
      ttwLog: o.log ?? (() => {}),
      ttwBlock: (...a: number[]) => (self.hook ? self.hook(a[0], a[1], a[2], a[3]) : 0),
      print: () => {}, printErr: () => {},
      locateFile: (p: string) => p,
      instantiateWasm(imports: WebAssembly.Imports, receive: (i: WebAssembly.Instance, m?: WebAssembly.Module) => void) {
        const src = o.wasmBinary;
        (src instanceof Uint8Array ? WebAssembly.instantiate(src, imports).then((r) => [r.instance, r.module] as const)
          : WebAssembly.instantiate(src, imports).then((i) => [i, src] as const))
          .then(([instance, module]) => { self.raw = instance.exports; receive(instance, module); });
        return {};
      },
    });
    self.M = M;
    // -sASYNCIFY exports asyncify_{start,stop}_{unwind,rewind} under minified
    // names; the glue says which (…=wasmExports["Ca"]).
    for (const m of (o.glue ?? '').matchAll(/_(asyncify_(?:start|stop)_(?:unwind|rewind))=wasmExports\["([^"]+)"\]/g))
      self.A[m[1]] = self.raw[m[2]];
    self.async = typeof self.A.asyncify_start_unwind === 'function';
    return self;
  }

  // ── plain driver calls ──────────────────────────────────────────────────
  private alloc(b: Uint8Array | string): [number, number] {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    const p = this.M._malloc(Math.max(1, bytes.length));
    this.M.HEAPU8.set(bytes, p);
    return [p, bytes.length];
  }
  addFile(name: string, data: Uint8Array | string): void {
    const [np, nl] = this.alloc(name), [dp, dl] = this.alloc(data);
    this.M._ttw_add_file(np, nl, dp, dl);
    this.M._free(np); this.M._free(dp);
  }
  clearFiles(): void { this.M._ttw_clear_files(); }
  /** Files every run needs besides the document (packages not in the bundle). */
  setExtraFiles(files: Record<string, Uint8Array | string>): void {
    this.extra = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]));
  }
  reset(): void { this.clearFiles(); for (const [n, d] of Object.entries(this.extra)) this.addFile(n, d); }
  files(): string[] { return this.M.UTF8ToString(this.M._ttw_file_list()).split('\n').filter(Boolean); }
  file(name: string): Uint8Array | null {
    const lenp = this.M._malloc(4), [np, nl] = this.alloc(name);
    try {
      const p = this.M._ttw_file_data(np, nl, lenp);
      if (!p) return null;
      return this.M.HEAPU8.slice(p, p + this.M.HEAPU32[lenp >> 2]);
    } finally { this.M._free(lenp); this.M._free(np); }
  }
  text(name: string): string { const f = this.file(name); return f ? dec.decode(f) : ''; }

  private flags(o: CompileOpts): number {
    const capture = o.capture ?? EDITOR_CAPTURE;
    return (o.initex ? FLAG_INITEX : 0) | (o.pdf ? FLAG_PDF : 0) | (o.keepGoing ? FLAG_KEEP_GOING : 0)
      | (capture ? (capture & 0xff) << 16 : FLAG_NO_CAPTURE);
  }
  private compileRaw(main: string, o: CompileOpts = {}) {
    const [mp, ml] = this.alloc(main), [fp, fl] = this.alloc(o.format ?? 'latex.fmt');
    const status: number = this.M._ttw_compile(mp, ml, fp, fl, this.flags(o), o.maxPasses ?? 1, o.date ?? Math.floor(Date.now() / 1000));
    return { status, free: () => { this.M._free(mp); this.M._free(fp); } };
  }
  /** A normal run. With `block`, rtx-block.tex answers with it (no pause). */
  compile(main: string, o: CompileOpts & { block?: string } = {}): number {
    this.hook = o.block != null ? this.answer(o.block) : null;
    try {
      const { status, free } = this.compileRaw(main, o);
      free();
      return status;
    } finally { this.hook = null; }
  }
  private answer(src: Uint8Array | string): Hook {
    return (outPtr, outLen) => {
      const [p, n] = this.alloc(src);
      this.M.HEAPU32[outPtr >> 2] = p;
      this.M.HEAPU32[outLen >> 2] = n;
      return 1;
    };
  }

  // ── the warm snapshot ────────────────────────────────────────────────────
  /**
   * Run `main` (already added, with the extra files) until the engine opens
   * rtx-block.tex, then pause: the hook starts an Asyncify unwind, the wasm
   * stack is saved into linear memory, _ttw_compile returns, and linear
   * memory is copied. ok false: the run ended without reaching the block.
   */
  warm(main: string, o: CompileOpts = {}): { ok: boolean; status?: number; ms: number; bytes?: number } {
    if (!this.async) throw new Error('warm() needs the Asyncify build');
    const M = this.M, A = this.A;
    const t0 = performance.now();
    this.snapshot = null;
    const data = M._malloc(ASYNC_DATA);
    M.HEAPU32[data >> 2] = data + 8;
    M.HEAPU32[(data + 4) >> 2] = data + ASYNC_DATA;
    this.preambleLog = '';
    this.hook = (outPtr, outLen, logPtr, logLen) => {
      if (this.astate === 2) return this.rewound(outPtr, outLen);
      this.preambleLog = dec.decode(M.HEAPU8.subarray(logPtr, logPtr + logLen));
      this.astate = 1;
      A.asyncify_start_unwind(data);
      return 0;
    };
    const { status } = this.compileRaw(main, o);     // the arguments stay allocated: part of the snapshot
    if (this.astate !== 1) {
      this.hook = null;
      M._free(data);
      return { ok: false, status, ms: performance.now() - t0 };
    }
    A.asyncify_stop_unwind();
    this.astate = 0;
    this.sp = M.stackSave();
    this.asyncData = data;
    this.takeSnapshot(M.HEAPU8);
    return { ok: true, ms: performance.now() - t0, bytes: this.snapLen };
  }
  private rewound(outPtr: number, outLen: number): number {
    this.A.asyncify_stop_rewind();
    this.astate = 0;
    return this.answer(this.pending)(outPtr, outLen);
  }
  get warmed(): boolean { return !!this.snapshot; }

  // ── the snapshot, sparse ─────────────────────────────────────────────────
  // Only the 64 KB pages that are not all zero are kept (57 % of the paper's
  // 380 MB heap are zero: TeX's arrays past what the format fills). Restoring
  // copies those back and zeroes a zero page only if the block wrote to it,
  // so a page no block touches is never written: the browser never has to
  // commit it (Safari: the web process stays ~0.4 GB smaller).
  pageOf: Int32Array = new Int32Array(0);   // page -> index into snapshot (in pages), -1: a zero page
  private takeSnapshot(heap: Uint8Array): void {
    const n = Math.ceil(heap.length / PAGE);
    const pageOf = new Int32Array(n).fill(-1);
    const words = new Int32Array(heap.buffer, 0, (n * PAGE) >> 2);
    let kept = 0;
    for (let p = 0; p < n; p++) if (!zeroPage(words, p)) pageOf[p] = kept++;
    const snap = new Uint8Array(kept * PAGE);
    for (let p = 0; p < n; p++) if (pageOf[p] >= 0) snap.set(heap.subarray(p * PAGE, (p + 1) * PAGE), pageOf[p] * PAGE);
    this.snapshot = snap; this.pageOf = pageOf; this.snapLen = n * PAGE;
  }
  private restoreSnapshot(heap: Uint8Array): void {
    const snap = this.snapshot!, pageOf = this.pageOf, n = pageOf.length;
    const words = new Int32Array(heap.buffer, 0, (n * PAGE) >> 2);
    // runs of kept pages are contiguous in the snapshot: one copy per run
    for (let p = 0; p < n;) {
      const k = pageOf[p];
      if (k >= 0) {
        let q = p + 1;
        while (q < n && pageOf[q] === k + (q - p)) q++;
        heap.set(snap.subarray(k * PAGE, (k + q - p) * PAGE), p * PAGE);
        p = q;
      } else {
        if (!zeroPage(words, p)) heap.fill(0, p * PAGE, (p + 1) * PAGE);
        p++;
      }
    }
    if (heap.length > this.snapLen) heap.fill(0, this.snapLen);
  }
  /**
   * One block from the snapshot: memory put back (grown memory zeroed), the
   * stack pointer too, the paused _ttw_compile re-entered in rewind mode; the
   * hook returns the block and the run ends as a normal one would.
   */
  runBlock(block: Uint8Array | string): { status: number; restoreMs: number; runMs: number; trap?: string } {
    if (!this.snapshot) throw new Error('runBlock before warm');
    const M = this.M, A = this.A;
    const t0 = performance.now();
    const heap: Uint8Array = M.HEAPU8;
    this.restoreSnapshot(heap);
    M.stackRestore(this.sp);
    const t1 = performance.now();
    this.pending = block;
    this.astate = 2;
    A.asyncify_start_rewind(this.asyncData);
    let status: number;
    try {
      status = M._ttw_compile(0, 0, 0, 0, 0, 1, 0);    // arguments ignored while rewinding (the date too: the snapshot's)
    } catch (e) {
      this.astate = 0;
      return { status: 3, restoreMs: t1 - t0, runMs: performance.now() - t1, trap: String(e) };
    }
    if (this.astate === 1) { this.astate = 0; return { status: 3, restoreMs: t1 - t0, runMs: performance.now() - t1, trap: 'the engine paused again inside a block' }; }
    return { status, restoreMs: t1 - t0, runMs: performance.now() - t1 };
  }
  /** Drop the snapshot (before a new warm or a full compile). The paused run
   *  is finished first (an empty block): while it is paused the driver's
   *  state is still borrowed (a RefCell in linear memory), and a new
   *  _ttw_compile would panic ("Aborted()"). */
  cool(): void {
    if (this.snapshot) { try { this.runBlock('\\relax'); } catch { /* the memory is restored by the next warm anyway */ } }
    this.snapshot = null; this.hook = null;
  }
  memoryBytes(): number { return this.M.HEAPU8.length; }
  /** what the snapshot holds in JS memory */
  snapshotBytes(): number { return this.snapshot?.byteLength ?? 0; }
}
