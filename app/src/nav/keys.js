// The page's scrolling keys, done the far-scroll way (far.js): End and Home (fn+→/← on a Mac, ⌘↓/⌘↑ too)
// jump and animate only the last pane height; End brings the document's end to the pane's bottom (far.js endOf), from
// wherever the pane is, not the empty space below it (the end space, app.css). PageDown and PageUp step 7/8 of a pane
// height (jump, then animate the last third); PageDown steps on into the end space, as the wheel scrolls, so the last
// sections can reach the reading line. A key held down adds to the step under way instead of starting a scroll over
// a long way. The browser's own smooth scroll for these keys passes every block on the way, and the viewer painted
// each one.
//
// Only when the document has the focus: the page itself, a pane's scroller, a block's own focusable parts. Never in
// a text field, the code editor, a menu, a dialog, a sheet or the sidebar (their keys are theirs).
//
//   installScrollKeys({ pane(p) -> far.js P | null, paneOf(el) -> pane id | null, focused() -> pane id }) -> uninstall
import { endOf, glide, paneHeight, pendingTarget } from './far.js';
import { isMacPlatform } from '../../../workbench/src/keys.ts';

const MAC = isMacPlatform();
const NOT_THE_PAGE = '.cm-editor, input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="listbox"], [role="menu"], [role="dialog"], dialog, .ui-sheet, .sidebar, #sidebar, aside';

export function installScrollKeys(host) {
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.isComposing) return;
    const t = e.target instanceof Element ? e.target : document.body;
    if (t.closest(NOT_THE_PAGE)) return;
    const page = t === document.body || t === document.documentElement || !!t.closest('main[data-pane], [data-part="view"]');
    if (!page) return;
    const mod = MAC ? e.metaKey : e.ctrlKey;
    let kind = null;
    if (e.key === 'End' || (MAC && e.metaKey && e.key === 'ArrowDown')) kind = 'end';
    else if (e.key === 'Home' || (MAC && e.metaKey && e.key === 'ArrowUp')) kind = 'home';
    else if (e.key === 'PageDown' && !mod) kind = 'down';
    else if (e.key === 'PageUp' && !mod) kind = 'up';
    if (!kind) return;
    const P = host.pane(host.paneOf(t) ?? host.focused());
    if (!P) return;
    e.preventDefault();
    const step = paneHeight(P) * 0.875;
    const to = kind === 'end' ? endOf(P) : kind === 'home' ? 0 : pendingTarget(P) + (kind === 'down' ? step : -step);
    const tail = kind === 'down' || kind === 'up' ? paneHeight(P) / 3 : 0;
    glide(P, to, { tail }).then(() => document.dispatchEvent(new CustomEvent('nav:scrolled', { detail: { key: kind } })));
  }
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
