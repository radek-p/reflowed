// The first editor of a pane, made ahead. The first CodeMirror view a page (and then a pane) makes pays
// one-time work in the press that opens it: CodeMirror's style modules mounted, its input state and observers set
// up, the first measure of its line height and text size in that pane's styles. Measured on the first open
// (test-motion "open [p, top]"): the press's work 35–47 ms, of which 6–16 ms creating the view. So once a pane has
// a document, in idle time, a throwaway view is made in that pane (hidden, out of the flow, in a .blk-source like a
// real editor's), measured once and destroyed: the first real open then finds that work done.
//
//   const w = createEditorWarm({ create(parent) -> { view } (core.createEditor), panes() -> [{ id, el }] })
//   w.soon() (a document shown, a pane opened) · w.stats · w.dispose()
import { idle, cancelIdle } from '../perf/idle.ts';
export function createEditorWarm({ create, panes }) {
  const done = new WeakSet();               // pane elements warmed (a pane made again is warmed again)
  const stats = { warmed: 0 };
  let handle = 0, disposed = false;
  const idleCall = (fn) => idle(fn, { timeout: 2000, delay: 100, budget: 50 });
  const idleCancel = cancelIdle;

  function warmOne(el) {
    const host = document.createElement('div');
    host.className = 'blk-source rtx-editor-warm';
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    // out of the flow and of sight; contained, so the page's layout is not touched beyond this box
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:400px;visibility:hidden;contain:strict;height:200px;pointer-events:none';
    el.append(host);
    let ed = null;
    try {
      ed = create(host);
      ed?.view?.requestMeasure?.();
      ed?.view?.measure?.();
    } catch (e) { console.warn('editor warm-up:', e.message); }
    try { ed?.view?.destroy?.(); } catch { /* gone */ }
    host.remove();
    stats.warmed++;
  }
  function run(deadline) {
    handle = 0;
    if (disposed) return;
    for (const p of panes()) {
      if (!p.el || done.has(p.el) || !p.el.isConnected) continue;
      if (!deadline.didTimeout && deadline.timeRemaining() < 12) { handle = idleCall(run); return; }   // one per idle period with room
      done.add(p.el);
      warmOne(p.el);
    }
  }
  return {
    stats,
    soon() { if (!handle && !disposed) handle = idleCall(run); },
    dispose() { disposed = true; if (handle) idleCancel(handle); handle = 0; },
  };
}
