// The caret map of the block under the pointer, made ahead so the click that opens it does not wait for it
// — but only when the reader has stopped: the pointer at rest over one block for REST_MS with nothing
// scrolling, then in idle time with room in the frame. Scrolling (wheel, touch, a scroll of any pane) cancels what
// is waiting, by wheel, keys (End, Home) or the scroll bar alike, also under a resting pointer: the block warmed is the
// scrolling was warmed, and each map walked the whole tree per glyph: seconds of main thread on a trackpad pass.
//
//   const w = createWarm({ warm(render) })   w.dispose()   w.stats (tests: { scheduled, warmed, cancelled, starts })
//   starts: performance.now() when each of the last 32 maps began (tests check it against their scroll events)
import { idle as onIdle, cancelIdle } from '../perf/idle.ts';
export const REST_MS = 150;
const MIN_IDLE_MS = 8;            // the idle time a warm needs to start (a map is a few ms with the linear walk)

export function createWarm({ root, warm }) {
  let target = null, timer = 0, idle = 0, lastScroll = -1e9, px = -1, py = -1;
  // what is under the pointer now (the page may have scrolled under a resting pointer: End, Home, the scroll bar)
  const under = () => { if (px < 0) return null; const e = document.elementFromPoint(px, py); return e?.closest?.('.blk-render') ?? null; };
  const stats = { scheduled: 0, warmed: 0, cancelled: 0, starts: [] };
  const idleCall = (fn) => onIdle(fn, { timeout: 1000, delay: 60, budget: 50 });
  const idleCancel = cancelIdle;

  function cancel() {
    if (timer || idle) stats.cancelled++;
    clearTimeout(timer); timer = 0;
    if (idle) { idleCancel(idle); idle = 0; }
  }
  function rest() {
    clearTimeout(timer);
    timer = setTimeout(ready, REST_MS);
  }
  function ready() {
    timer = 0;
    if (performance.now() - lastScroll < REST_MS) { rest(); return; }       // a scroll since: nothing has rested yet
    target = under();
    if (!target) return;
    stats.scheduled++;
    idle = idleCall(run);
  }
  function run(deadline) {
    idle = 0;
    if (performance.now() - lastScroll < REST_MS) { rest(); return; }
    const r = under();
    if (!r || r !== target) return;
    if (!deadline.didTimeout && deadline.timeRemaining() < MIN_IDLE_MS) { idle = idleCall(run); return; }
    stats.starts.push(performance.now()); if (stats.starts.length > 32) stats.starts.shift();
    try { warm(r); stats.warmed++; } catch (err) { console.warn('caret map ahead:', err.message); }
  }

  const onMove = (e) => {
    px = e.clientX; py = e.clientY;
    const r = e.target instanceof Element ? e.target.closest('.blk-render') : null;
    if (r !== target) { cancel(); target = r; }
    if (r) rest();                                  // the pointer moved: the rest starts again
  };
  const onLeave = (e) => { if (!e.relatedTarget) { cancel(); target = null; px = py = -1; } };
  // any scroll (wheel, keys, the scroll bar, a script): what waits is dropped; the rest is timed from the last one
  const onScroll = () => { lastScroll = performance.now(); cancel(); if (px >= 0) rest(); };
  // the editor's container's (app/editor-root.ts): the blocks under the pointer there, its scrolls and the window's
  const offs = [
    root.listen(root.el, 'pointermove', onMove, { passive: true }),
    root.listen(root.el, 'pointerout', onLeave, { passive: true }),
    ...['wheel', 'touchmove'].map((t) => root.listen(root.el, t, onScroll, { capture: true, passive: true })),
    root.onScroll(onScroll),                                          // the window's and every pane's
  ];

  return {
    stats,
    dispose() {
      cancel();
      for (const off of offs.splice(0)) off();
    },
  };
}
