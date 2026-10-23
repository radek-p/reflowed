// a document's status as its tabs show it: "typesetting", once shown, stays at least
// MIN_SHOWN ms after the run began (chrome/status.js, the old top bar's rule). Every keystroke's live compile is a run of
// 80–200 ms, so the pills' band and their description flickered on and off while typing. A run that starts within the
// hold continues what is shown, and holds from its own start (so typing keeps it on, with no gap between runs); errors
// and unsaved go through at once (they say something to act on).
//
//   const hold = createStatusHold((docId, status) => …, { minShown?, now?, setTimeout?, clearTimeout? })
//   hold.put(docId, status)    the document's status now (doc/status.ts); passed on, typesetting's end held
//   hold.idle() -> Promise     no end held any more (the tests' whenIdle: the pills say what is)
//   hold.dispose()             the timers dropped
import { MIN_SHOWN } from '../chrome/status.js';

export interface ShownStatus { typesetting: { done: number; total: number; bar: 'full' | 'band' } | false; errors: number; unsaved: boolean }
interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }
export interface StatusHoldOptions extends Partial<Clock> { minShown?: number }

export function createStatusHold(set: (docId: string, s: ShownStatus) => void, o: StatusHoldOptions = {}) {
  const minShown = o.minShown ?? MIN_SHOWN;
  const now = o.now ?? (() => performance.now());
  const T = o.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const C = o.clearTimeout ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  /** per document: when the latest run began (null: none shown), whether one runs, what is shown, the pending end */
  const docs = new Map<string, { since: number | null; running: boolean; shown: ShownStatus | null; timer: unknown }>();
  let waiting: (() => void)[] = [];
  const held = () => [...docs.values()].some((d) => d.timer != null);
  const settle = () => { if (held()) return; const w = waiting; waiting = []; for (const f of w) f(); };
  function put(docId: string, s: ShownStatus): void {
    let d = docs.get(docId);
    if (!d) docs.set(docId, d = { since: null, running: false, shown: null, timer: null });
    if (d.timer != null) { C(d.timer); d.timer = null; }
    const show = (x: ShownStatus) => { d!.shown = x; set(docId, x); };
    if (s.typesetting) {
      if (!d.running) { d.since = now(); d.running = true; }
      show(s);
      return;
    }
    d.running = false;
    const left = d.since == null ? 0 : minShown - (now() - d.since);
    if (left > 0 && d.shown?.typesetting) {
      // the run ended too soon: typesetting stays shown until the hold is over; the rest as it is now
      show({ ...s, typesetting: d.shown.typesetting });
      d.timer = T(() => { d!.timer = null; d!.since = null; show(s); settle(); }, left);
      return;
    }
    d.since = null;
    show(s);
    settle();
  }
  return {
    put,
    idle: (): Promise<void> => (held() ? new Promise<void>((r) => { waiting.push(r); }) : Promise.resolve()),
    dispose() { for (const d of docs.values()) if (d.timer != null) C(d.timer); docs.clear(); settle(); },
  };
}
