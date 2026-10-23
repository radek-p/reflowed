// one blink clock for the source caret (CodeMirror's, its own blink off:
// editor-entry.js cursorBlinkRate 0) and the caret mirrored in the preview.
// `html.rtx-caret-off` is set in the off half of each 1.2 s period (CSS in
// style.js hides both carets then); restart() — on every caret move and
// every change — shows both at once and starts the period again. While no
// source editor has the focus, and under reduced motion, both stay steady.
export const PERIOD = 1200;

export function installBlink() {
  const root = document.documentElement;
  let timer = 0, on = true;
  const steady = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const focused = () => !!document.activeElement?.closest?.('.cm-editor');
  const set = (visible) => { on = visible; root.classList.toggle('rtx-caret-off', !visible); };
  function tick() {
    timer = 0;
    if (!focused() || steady()) { set(true); return; }
    set(!on);
    timer = setTimeout(tick, PERIOD / 2);
  }
  function restart() {
    clearTimeout(timer); timer = 0;
    set(true);
    if (!steady()) timer = setTimeout(tick, PERIOD / 2);
  }
  document.addEventListener('focusin', (e) => { if (e.target.closest?.('.cm-editor')) restart(); });
  document.addEventListener('focusout', () => { clearTimeout(timer); timer = 0; set(true); });
  return { restart, visible: () => on, PERIOD };
}
