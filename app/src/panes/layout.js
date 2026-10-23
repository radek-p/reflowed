// PANES: the window's layout as data. One small model, signals only, no DOM: the panes in order,
// each a view of (document, view state), the focused pane, and the first pane's width when there are two.
// Everything that used to be layout state on elements (#editor-view.split, --split-a, a pane's section focus,
// which pane the outline acts in) is read from here; the DOM follows (panes/index.js applies it).
//
//   const layout = createLayout({ empty? })   empty: no first pane (the workbench's tabs: app/doc-tabs.ts)
//   layout.panes        signal: [{ id, doc, focus, view?, of? }]   id 'a', 'b', …; doc: the document it shows (id | null);
//                                                      focus: the section heading it is narrowed to | null;
// view: a registered view's id (design/ui/views.js)
//                                                      the pane shows instead of a document, of: its content's props
//   layout.focused      signal: the focused pane's id (the outline, find, keyboard selection act there)
//   layout.width        signal: the first pane's width in px when split (null: half)
//   layout.split        computed: more than one pane
//   layout.pane(id) · layout.open(id, { doc, view, of }) · layout.close(id) · layout.focus(id)
//   layout.setView(id, view, of) (the pane shows a view) · layout.isView(entry)
//   layout.keepOnly(id) (split view closed from pane id, one pane left, with id's view state)
//   layout.setDoc(id, doc) · layout.setFocus(id, heading) · layout.setWidth(px) · layout.ids() · layout.current()
import { signal, computed, batch } from '@preact/signals';

export const PANE_IDS = ['a', 'b'];

export function createLayout({ doc = null, empty = false } = {}) {
  // empty: the workbench's layout mirror (app/doc-tabs.ts): no first pane, each document tab a pane, any closed
  const panes = signal(empty ? [] : [{ id: 'a', doc, focus: null }]);
  const focused = signal(empty ? '' : 'a');
  const least = empty ? 1 : 2;
  const width = signal(null);
  const split = computed(() => panes.value.length > 1);

  const find = (id) => panes.peek().find((p) => p.id === id) ?? null;
  const patch = (id, fields) => { panes.value = panes.peek().map((p) => (p.id === id ? { ...p, ...fields } : p)); };

  return {
    panes, focused, width, split,
    pane: find,
    ids: () => panes.peek().map((p) => p.id),
    /** the focused pane's entry (its document is "the current document" of every panel) */
    current: () => find(focused.peek()) ?? panes.peek()[0] ?? null,
    open(id, { doc: d = panes.peek()[0]?.doc ?? null, view = null, of = null } = {}) {
      if (find(id)) return false;
      panes.value = [...panes.peek(), view ? { id, doc: null, focus: null, view, of } : { id, doc: d, focus: null }];
      return true;
    },
    close(id) {
      if (!find(id) || panes.peek().length < least) return false;
      batch(() => {
        panes.value = panes.peek().filter((p) => p.id !== id);
        if (focused.peek() === id) focused.value = panes.peek()[0]?.id ?? '';
        if (panes.peek().length < 2) width.value = null;
      });
      return true;
    },
    /** split view closed from pane `id`: the pane the reader works in stays. One pane is left, in the first
     *  slot (the window's pane), with `id`'s view state (its document, its section focus); the others go. The rest
     *  of the kept pane's state (its scroll, editor, caret) is carried over by panes/close-split.js. */
    keepOnly(id) {
      const k = find(id), first = panes.peek()[0];
      if (!k || panes.peek().length < 2) return false;
      batch(() => {
        // a view pane kept: the window's pane stays a document's (the first pane is always one)
        panes.value = [{ ...first, doc: k.view ? first.doc : k.doc, focus: k.view ? first.focus : k.focus }];
        focused.value = first.id;
        width.value = null;
      });
      return true;
    },
    focus(id) { if (find(id) && focused.peek() !== id) focused.value = id; },
    // a document opened in a view pane: it becomes that document's pane
    setDoc(id, d) { const p = find(id); if (p && (p.doc !== d || p.view)) patch(id, { doc: d, view: null, of: null }); },
    /** pane `id` shows registered view `view` (its content gets `of`) */
    setView(id, v, of = null) { const p = find(id); if (p && (p.view !== v || p.of !== of)) patch(id, { doc: null, focus: null, view: v, of }); },
    isView: (entry) => !!entry?.view,
    /** every pane showing document `from` shows `to` (the whole editor opened another document) */
    replaceDoc(from, to) { const hit = (p) => !p.view && (p.doc === from || p.doc == null); if (panes.peek().some(hit)) panes.value = panes.peek().map((p) => (hit(p) ? { ...p, doc: to, focus: null } : p)); },
    setFocus(id, heading) { if (find(id) && find(id).focus !== heading) patch(id, { focus: heading }); },
    setWidth(px) { width.value = px == null ? null : Math.round(px); },
  };
}
