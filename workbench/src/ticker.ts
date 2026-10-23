// The status's progress ticker: one per store, over its own container's fills only. While any document of the store
// is typesetting (and the status shows in the tabs) one rAF loop sets each running fill's length from its document's
// progress (progress.ts), eased toward it (a new block glides, never jumps), never backwards within a run (so a total
// that grows mid-run holds the bar until the formula passes it again); under reduced motion the steps alone, at once.
// The memory per document (its run, the length reached) keeps a tab drawn anew mid-run where it was, never from 0.
import { progress } from './progress.ts';
import type { Progress } from './types.ts';
import { reducedMotion } from './motion.ts';

/** A fill element: the length it shows, and its pill's width read for the block in flight (not every frame). */
export type FillEl = HTMLSpanElement & { _p?: number; _w?: { key: string; w: number } };
export type ProgressTicker = { start(): void; stop(): void; readonly running: boolean };

export function createProgressTicker({ root, status, busy }: {
  /** The container the fills are in (null: no UI attached). */
  root(): HTMLElement | null;
  /** A document's progress while it typesets. */
  status(doc: string): Progress | undefined;
  /** Any document typesetting, the status shown: the loop runs (it stops itself otherwise). */
  busy(): boolean;
}): ProgressTicker {
  const last = new Map<string, { run: number; p: number }>();
  let raf = 0;
  const step = () => {
    if (!busy()) { raf = 0; return; }
    const reduced = reducedMotion(), now = performance.now();
    for (const el of root()?.querySelectorAll<FillEl>('.wb-status-fill[data-run]') ?? []) {
      const pill = el.parentElement!, doc = pill.dataset.pdoc ?? '', s = status(doc);
      if (!s) continue;
      let mem = last.get(doc);
      if (mem?.run !== s.run) last.set(doc, mem = { run: s.run, p: 0 });
      const p0 = Math.max(el._p ?? 0, mem!.p);
      el._p = p0;
      const key = `${s.run}:${s.done}:${s.total}`;
      if (el._w?.key !== key) el._w = { key, w: pill.getBoundingClientRect().width };
      const target = progress(s.done, s.total, (now - s.since) / 1000, { width: el._w.w, reduced });
      const p = reduced ? Math.max(p0, target) : Math.max(p0, p0 + (target - p0) * 0.18);
      mem!.p = Math.max(mem!.p, p);
      if (p !== el._p || !el.style.transform) { el._p = p; el.style.transform = `scaleX(${p})`; }
    }
    raf = requestAnimationFrame(step);
  };
  return {
    start() { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(step); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
    get running() { return raf !== 0; },
  };
}
