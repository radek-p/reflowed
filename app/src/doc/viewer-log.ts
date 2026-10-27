// THE VIEWER'S LOG AS PROBLEMS: what the Reflow TeX viewer on this page logs (its page log, host.log: the warnings
// each block's data carries from the build – a font with no face, a character a font lacks – and the viewer's own –
// a font that failed to load, a kind whose drawing threw), as the author's problems. The editor shows every record
// that matters to an author (warning and error) in its own surfaces, through one path: the Problems panel
// (doc/panels.ts diagnosticsOf, the 'preview' group), each with the block it concerns, or with none for the page.
// The viewer's own notice bar is turned off (host.log.setShown([])): nothing of the log is drawn on the page.
// No DOM; one per page (one viewer).
//
// A block's records are its RESULT's: the viewer names the view it set up (its Block.key), and the editor says which
// result that view shows (bind(viewKey, resultKey), panes/blocks.js on each mount); a block's problems are those of
// the result it shows now (its compile key), so they go when the block's result changes or the block goes. Records
// are kept once per result, code and message (the same warnings come again with every view mounted from it).
// A record about no block (block null) is the page's, kept once per code (the latest: font-load-failed names every
// font that failed so far); it stands for the page's life, as the viewer's own record of it does.
//
//   const vl = createViewerLog(host.log)   installViewerLog(host.log) · viewerLog() (the page's, or null)
//   vl.bind(viewKey, resultKey)            the view shows that result
//   vl.problemsOf(resultKey)               [{ level, code, message }]: that result's records
//   vl.pageProblems()                      the records about no block
//   vl.subscribe(fn) -> unsubscribe        fn() after each change (a record kept, a binding that brings some)
//   vl.dispose()

export type ViewerLevel = 'debug' | 'info' | 'warning' | 'error';
/** a record of the viewer's page log (reflowtex src/shared/log.ts LogRecord), as far as this reads it */
export interface ViewerRecord { seq: number; level: ViewerLevel; code: string; message: string; block: string | null; details?: Record<string, string> }
/** host.log (reflowtex src/viewer/src/host/types.ts HostLog), as far as this uses it */
export interface ViewerHostLog {
  records(after?: number): ViewerRecord[];
  subscribe(fn: (r: ViewerRecord) => void): () => void;
  setShown(selection: readonly string[] | null): void;
}
export interface ViewerProblem { level: 'warning' | 'error'; code: string; message: string }

/** the levels an author is shown */
/** views whose records wait for their result (bind) */
const UNBOUND = 400;
const shown = (r: ViewerRecord): r is ViewerRecord & { level: 'warning' | 'error' } => r.level === 'warning' || r.level === 'error';
const problem = (r: ViewerRecord & { level: 'warning' | 'error' }): ViewerProblem => ({ level: r.level, code: r.code, message: r.message });

export interface ViewerLog {
  bind(viewKey: string, resultKey: string): void;
  problemsOf(resultKey: string): ViewerProblem[];
  pageProblems(): ViewerProblem[];
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

export function createViewerLog(log: ViewerHostLog): ViewerLog {
  log.setShown([]);
  const byView = new Map<string, Map<string, ViewerProblem>>();     // view key → (code + message → problem)
  const resultOf = new Map<string, string>();                        // view key → result key
  const byResult = new Map<string, Map<string, ViewerProblem>>();    // result key → (code + message → problem)
  const page = new Map<string, ViewerProblem>();                      // code → the latest
  const subs = new Set<() => void>();
  const tell = () => { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error('viewer log listener:', e); } } };
  const put = (m: Map<string, ViewerProblem>, p: ViewerProblem): boolean => {
    const k = `${p.code}\u0000${p.message}`;
    if (m.has(k)) return false;
    m.set(k, p);
    return true;
  };
  const resultMap = (key: string) => { let m = byResult.get(key); if (!m) byResult.set(key, m = new Map()); return m; };
  function take(r: ViewerRecord): boolean {
    if (!shown(r)) return false;
    const p = problem(r);
    if (r.block === null) {
      const was = page.get(p.code);
      if (was && was.message === p.message && was.level === p.level) return false;
      page.set(p.code, p);
      return true;
    }
    const result = resultOf.get(r.block);
    if (result !== undefined) return put(resultMap(result), p);
    // (a view no result is bound to yet: its mount is under way. Views never bound – a reference card's copy, the
    // live preview's – are let go, the oldest first)
    let m = byView.get(r.block);
    if (!m) { byView.set(r.block, m = new Map()); if (byView.size > UNBOUND) byView.delete(byView.keys().next().value!); }
    put(m, p);
    return false;
  }
  let last = 0;
  for (const r of log.records()) { take(r); last = Math.max(last, r.seq); }
  const stop = log.subscribe((r) => { if (r.seq > last && take(r)) tell(); });
  return {
    bind(viewKey, resultKey) {
      if (resultOf.get(viewKey) === resultKey) return;
      resultOf.set(viewKey, resultKey);
      const held = byView.get(viewKey);
      byView.delete(viewKey);
      let added = false;
      for (const p of held?.values() ?? []) added = put(resultMap(resultKey), p) || added;
      if (added) tell();
    },
    problemsOf: (resultKey) => [...(byResult.get(resultKey)?.values() ?? [])],
    pageProblems: () => [...page.values()],
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    dispose() { stop(); subs.clear(); },
  };
}

// ── the page's ───────────────────────────────────────────────────────────────
let pageLog: ViewerLog | null = null;
/** made once the viewer is on the page (app/services.ts pageReady); again for another host log (a test's page) */
export function installViewerLog(log: ViewerHostLog): ViewerLog {
  pageLog?.dispose();
  pageLog = createViewerLog(log);
  return pageLog;
}
export const viewerLog = (): ViewerLog | null => pageLog;
