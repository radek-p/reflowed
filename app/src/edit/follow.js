// When the page follows an editor's caret.
//
// The mirrored caret is re-marked often: on a caret move, but also when a result lands (the live preview,
// a compile, a swap of the views) and when the caret blink restarts. Bringing the caret back into view is
// right only after the reader did something IN THE EDITOR (typed, moved the caret, clicked in the preview,
// opened the block). A scroll of the reader's own — the wheel, a touch, the scroll bar, scrolling keys
// outside the editor — means "I am reading elsewhere": following stops until the next caret move.
//
//   const f = createFollow({ paneOf(el) })  f.isUserScroll(e, pane) -> bool (the event scrolls that pane)
//   session.follow: true | false, armed by the session, disarmed by edit/index.js through isUserScroll

/** keys that scroll the page when focus is not in a text field */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar']);
export const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];

/**
 * @param {{ paneOf(el: Element): string | null, single(): boolean, focused(): string | null }} o
 *   paneOf: the pane an element is in (null: outside every pane); single: one pane (the window scrolls);
 *   focused: the focused pane (keys pressed with the focus on the page itself scroll it)
 */
export function createFollow({ paneOf, single, focused }) {
  /** does event e scroll pane `pane` on the reader's behalf? */
  function isUserScroll(e, pane) {
    const t = e.target instanceof Element ? e.target : document.documentElement;
    if (e.type === 'keydown') {
      if (!SCROLL_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return false;
      // in a text field (the editor, the find bar, a form): the keys move a caret there, not the page
      if (t.closest('.cm-editor, input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false;
      const p = paneOf(t);
      return p ? p === pane : single() || focused() === pane;
    }
    if (e.type === 'pointerdown') {
      // a press on a scroll bar: on the page's own (outside the root's client area) or a pane's (its <main>, outside its client box)
      const de = document.documentElement;
      if (single() && /** @type {PointerEvent} */ (e).clientX >= de.clientWidth) return true;
      const main = t.closest('main[data-pane]');
      if (!main || paneOf(main) !== pane || t !== main) return false;
      const r = main.getBoundingClientRect(), pe = /** @type {PointerEvent} */ (e);
      return pe.clientX >= r.left + main.clientLeft + main.clientWidth || pe.clientY >= r.top + main.clientTop + main.clientHeight;
    }
    // wheel, touch: in the pane (or, with one pane, anywhere the window scrolls: not a sidebar or a sheet of its own)
    const p = paneOf(t);
    if (p) return p === pane;
    return single() && !t.closest('.sidebar, .sheet, .menu, .find-bar, [data-own-scroll]');
  }
  return { isUserScroll };
}
