// When a document editor refreshes what depends on the whole document (out of app.js):
// the numbering and every view's reference texts, the container heads, the panels (outline, problems, TODOs, the word
// count), the editors' marks and find. The work itself is the host's; this decides when it runs:
//   - changed(): soon (a structure change, a mount, a save);
//   - typed(): within 250 ms (a keystroke), not again for each keystroke meanwhile;
//   - changedLater(): a background result landed: one refresh for the results of the next BG_MS;
//   - never while the reader types or clicks (perf.inputActive): it waits until input is quiet, then runs once
//     (it ran every 250 ms while typing and at once on each live preview).
//
//   const refresh = createRefresh({ hasDoc, perf, work, clock? })
//     refresh.changed() · refresh.typed() · refresh.changedLater() · refresh.now()
//     refresh.pending (a refresh is scheduled: whenIdle waits for it)

export interface RefreshPerf { disabled?: boolean; inputActive(): boolean; quietMs: number; count(name: string): void }
export interface Clock { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }
export interface RefreshHost {
  hasDoc(): boolean;
  perf: RefreshPerf;
  /** the refresh itself (app.js) */
  work(): void;
  clock?: Clock;
}

/** a background result: one refresh for the results of the next BG_MS */
export const BG_MS = 120;
/** a keystroke: the refresh at most this long after it */
export const TYPED_MS = 250;

export function createRefresh(host: RefreshHost) {
  const clock: Clock = host.clock ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };
  const { perf } = host;
  let timer: unknown = 0, bg = false;
  function soon(delay: number, background = false) {
    if (!background) bg = false;
    if (timer) { if (delay) return; clock.clearTimeout(timer); }
    timer = clock.setTimeout(now, delay);
  }
  function now() {
    timer = 0;
    if (!host.hasDoc()) return;
    if (perf.inputActive()) { perf.count('refreshesDeferred'); timer = clock.setTimeout(now, perf.quietMs); return; }
    bg = false;
    perf.count('refreshes');
    host.work();
  }
  return {
    changed() { soon(0); },
    typed() { soon(TYPED_MS); },
    changedLater() {
      if (perf.disabled) { soon(0); return; }
      if (!timer) bg = true;
      soon(BG_MS, true);
    },
    now,
    get pending() { return !!timer; },
    /** (tests) the last refresh asked for was a background one */
    get background() { return bg; },
  };
}
