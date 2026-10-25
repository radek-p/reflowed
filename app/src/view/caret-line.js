// the source editor's current *visual* line (the wrapped line holding the caret, not the whole
// logical line), faintly banded — paired with the preview's band on the line of the mirrored caret.
// A CodeMirror view plugin: one element in the scroller, placed from the caret's coordinates on every
// caret move, edit, focus change and re-wrap (geometry change).
import { ViewPlugin } from '@codemirror/view';

export const caretLine = ViewPlugin.fromClass(class {
  constructor(view) {
    this.el = view.dom.ownerDocument.createElement('div');   // the editor's own document (a frame's, say)
    this.el.className = 'cm-caretLine';
    this.el.setAttribute('aria-hidden', 'true');
    view.scrollDOM.prepend(this.el);
    this.place(view);
  }
  update(u) { if (u.selectionSet || u.docChanged || u.geometryChanged || u.viewportChanged || u.focusChanged) this.place(u.view); }
  place(view) {
    view.requestMeasure({
      read: () => {
        // the side the cursor is drawn on (at a wrap, the end of one visual line or the start of the next)
        const sel = view.state.selection.main, side = sel.assoc < 0 ? -1 : 1;
        const c = view.coordsAtPos(sel.head, side) ?? view.coordsAtPos(sel.head, -side);
        if (!c) return null;
        const s = view.scrollDOM.getBoundingClientRect(), lh = view.defaultLineHeight;
        const mid = (c.top + c.bottom) / 2;
        return { top: mid - lh / 2 - s.top + view.scrollDOM.scrollTop, h: lh };
      },
      write: (m) => {
        if (!m) { this.el.style.display = 'none'; return; }
        this.el.style.cssText = `display:block;top:${m.top.toFixed(1)}px;height:${m.h.toFixed(1)}px`;
      },
    });
  }
  destroy() { this.el.remove(); }
});
